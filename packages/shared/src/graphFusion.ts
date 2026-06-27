import type { UnifiedCodeGraph, UnifiedCodeGraphNode, WorkspaceKernelProfile } from "./codeGraph.js";
import { appendAnalyzerFusionChecks } from "./graphAnalyzers.js";
import {
  buildGraphGodNodeSummaries,
  recommendPrimaryGraphLens,
  type GraphTaskLensId,
} from "./graphLenses.js";
import { buildGraphAdjacency, findGraphSeedNodes, queryUnifiedCodeGraph } from "./graphQueryEngine.js";
import { getStartGuidanceReadFirstNodes } from "./graphStartGuidance.js";
import {
  findProductGraphAcceptanceEvidenceGaps,
  summarizeProductGraphCodeIntentDrift,
  summarizeProductGraphCodeScanFreshness,
  summarizeProductGraphExecutionDrift,
  summarizeProductGraphExecutionTestEvidence,
  type ProductGraphProjection,
} from "./productGraph.js";
import { summarizeEcosystemSupportForAgents } from "./graphEcosystemHealth.js";
import { sanitizeOperationalText } from "./safeText.js";
import type { AgentCodeContextNodeSummary, AgentCodeContextSlice } from "./types.js";

export type GraphFusionSeverity = "fail" | "warn" | "info";

export interface GraphFusionCheck {
  code: string;
  title: string;
  severity: GraphFusionSeverity;
  detail: string;
  count?: number;
}

export interface GraphFusionResult {
  ok: boolean;
  hardFailCount: number;
  warnCount: number;
  checks: GraphFusionCheck[];
}

export interface GraphHandoffFreshnessInput {
  graphGeneratedAt: string;
  handoffUpdatedAt?: string;
  handoffPath?: string;
}

export interface GraphHandoffFreshnessResult {
  isStale: boolean;
  handoffPath: string;
  graphGeneratedAt: string;
  handoffUpdatedAt?: string;
  detail: string;
}

export interface BuildAgentCodeContextSliceOptions {
  focusQuery?: string;
  linkedRunPaths?: string[];
  nodeBudget?: number;
  edgeBudget?: number;
  kernelProfile?: WorkspaceKernelProfile;
  workspaceRoot?: string;
}

export interface EvaluateOagFusionChecksInput {
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  handoffFreshness?: GraphHandoffFreshnessResult;
  productGraph?: ProductGraphProjection;
  previousSymbolCount?: number;
}

const GENERATED_PATH_PATTERNS = ["/bin/", "/obj/", "/dist/", "/.next/", "/node_modules/", "/target/debug/"];
const DOCUMENTATION_PRIMARY_TYPES = new Set(["documentation-corpus", "fixture-docs-only", "docs-only"]);

function indexedFilePaths(graph: UnifiedCodeGraph) {
  return graph.nodes
    .filter((node) => node.kind === "code_file" || node.kind === "config_file")
    .map((node) => node.path ?? node.label);
}

function indexedSymbolExtensions(graph: UnifiedCodeGraph) {
  const extensions = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== "symbol") continue;
    const nodePath = node.path ?? node.label;
    const extension = nodePath.split(".").pop()?.toLowerCase();
    if (extension) extensions.add(extension);
  }
  return extensions;
}

function hasMarker(profile: WorkspaceKernelProfile | undefined, pattern: RegExp) {
  return (profile?.markerPaths ?? []).some((marker) => pattern.test(marker));
}

function countGeneratedIndexedPaths(paths: string[]) {
  return paths.filter((indexedPath) =>
    GENERATED_PATH_PATTERNS.some((pattern) => indexedPath.includes(pattern))
  ).length;
}

function safeCodeContextText(value: string, workspaceRoot: string | undefined, maxLength = 500) {
  return sanitizeOperationalText(value, { workspaceRoot, maxLength });
}

function summarizeNode(node: UnifiedCodeGraphNode, workspaceRoot?: string): AgentCodeContextNodeSummary {
  return {
    id: node.id,
    kind: node.kind,
    label: safeCodeContextText(node.label, workspaceRoot, 240),
    path: node.path ? safeCodeContextText(node.path, workspaceRoot, 500) : undefined,
  };
}

function sanitizeCodeContextList(values: string[], workspaceRoot: string | undefined, limit: number) {
  return values
    .slice(0, limit)
    .map((value) => safeCodeContextText(value, workspaceRoot, 500));
}

function uniqueNodes(nodes: UnifiedCodeGraphNode[], limit: number) {
  const seen = new Set<string>();
  const output: UnifiedCodeGraphNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    output.push(node);
    if (output.length >= limit) break;
  }
  return output;
}

export function evaluateHandoffFreshness(input: GraphHandoffFreshnessInput): GraphHandoffFreshnessResult {
  const handoffPath = input.handoffPath ?? "GRAPH_REPORT.md";
  if (!input.handoffUpdatedAt) {
    return {
      isStale: true,
      handoffPath,
      graphGeneratedAt: input.graphGeneratedAt,
      detail: `${handoffPath} is missing; export or run dogfood to refresh handoff context.`,
    };
  }

  const graphTime = Date.parse(input.graphGeneratedAt);
  const handoffTime = Date.parse(input.handoffUpdatedAt);
  if (!Number.isFinite(graphTime) || !Number.isFinite(handoffTime)) {
    return {
      isStale: false,
      handoffPath,
      graphGeneratedAt: input.graphGeneratedAt,
      handoffUpdatedAt: input.handoffUpdatedAt,
      detail: "Handoff freshness could not be compared; timestamps were invalid.",
    };
  }

  const isStale = handoffTime < graphTime;
  return {
    isStale,
    handoffPath,
    graphGeneratedAt: input.graphGeneratedAt,
    handoffUpdatedAt: input.handoffUpdatedAt,
    detail: isStale
      ? `${handoffPath} is older than the latest code graph scan.`
      : `${handoffPath} is current relative to the latest code graph scan.`,
  };
}

export function evaluateUnifiedGraphQualityGates(
  graph: UnifiedCodeGraph,
  kernelProfile?: WorkspaceKernelProfile
): GraphFusionCheck[] {
  const checks: GraphFusionCheck[] = [];
  const paths = indexedFilePaths(graph);
  const symbolCount = graph.nodes.filter((node) => node.kind === "symbol").length;
  const tsJsIndexed = paths.some((indexedPath) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(indexedPath));
  const csharpIndexed = paths.some((indexedPath) => indexedPath.endsWith(".cs"));
  const generatedCount = countGeneratedIndexedPaths(paths);
  const generatedPercent = paths.length > 0 ? Math.round((generatedCount / paths.length) * 100) : 0;
  const primaryType = kernelProfile?.primaryType
    ?? (typeof graph.nodes.find((node) => node.kind === "workspace")?.metadata?.primaryType === "string"
      ? String(graph.nodes.find((node) => node.kind === "workspace")?.metadata?.primaryType)
      : "unknown");

  if (hasMarker(kernelProfile, /\.sln$/i) && !csharpIndexed) {
    checks.push({
      code: "marker_sln_without_csharp",
      title: "Solution marker without indexed C# source",
      severity: "fail",
      detail: "A .sln marker was detected but no .cs files were indexed.",
    });
  }

  if (hasMarker(kernelProfile, /package\.json$/i) && !tsJsIndexed) {
    checks.push({
      code: "marker_package_without_ts_js",
      title: "package.json marker without indexed TS/JS source",
      severity: "fail",
      detail: "package.json was detected but no .ts/.js source files were indexed in source roots.",
    });
  }

  if (generatedPercent > 40) {
    checks.push({
      code: "generated_path_dominance",
      title: "Generated or build output dominates indexed source",
      severity: "fail",
      detail: `${generatedPercent}% of indexed paths look like generated/build output.`,
      count: generatedCount,
    });
  }

  if (symbolCount === 0 && !DOCUMENTATION_PRIMARY_TYPES.has(primaryType)) {
    checks.push({
      code: "no_symbols_non_docs",
      title: "No symbols indexed for a non-documentation workspace",
      severity: "warn",
      detail: `Primary type '${primaryType}' has zero indexed symbols.`,
    });
  }

  const breakerSkips = kernelProfile?.skippedCountsByReason?.breaker ?? 0;
  if (breakerSkips > 0 || graph.diagnostics.some((line) => /breaker|safety cap|partial scan/i.test(line))) {
    checks.push({
      code: "partial_scan_breaker",
      title: "Scan stopped early due to safety limits",
      severity: "warn",
      detail: breakerSkips > 0
        ? `${breakerSkips} file(s) skipped by scan breaker limits.`
        : "Diagnostics indicate a partial scan.",
      count: breakerSkips,
    });
  }

  const unsupportedSkips = kernelProfile?.skippedCountsByReason?.unsupported ?? 0;
  if (unsupportedSkips > 0) {
    checks.push({
      code: "unsupported_language_risk",
      title: "Unsupported files detected in workspace",
      severity: "warn",
      detail: `${unsupportedSkips} file(s) were skipped as unsupported language or format.`,
      count: unsupportedSkips,
    });
  }

  return checks;
}

export function linkRunPathsToCodeNodes(
  graph: UnifiedCodeGraph,
  runPaths: string[]
): AgentCodeContextNodeSummary[] {
  const normalizedTargets = new Set(
    runPaths
      .map((runPath) => runPath.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase())
      .filter(Boolean)
  );
  if (normalizedTargets.size === 0) return [];

  return graph.nodes
    .filter((node) => {
      const nodePath = (node.path ?? node.label).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
      return normalizedTargets.has(nodePath)
        || [...normalizedTargets].some((target) => nodePath.endsWith(`/${target}`) || target.endsWith(`/${nodePath}`));
    })
    .map((node) => summarizeNode(node));
}

export function buildAgentCodeContextSlice(
  graph: UnifiedCodeGraph,
  options: BuildAgentCodeContextSliceOptions = {}
): AgentCodeContextSlice {
  const nodeBudget = Math.max(4, options.nodeBudget ?? 24);
  const edgeBudget = Math.max(4, options.edgeBudget ?? 32);
  const workspaceRoot = options.workspaceRoot ?? graph.workspaceRoot;
  const primaryLens = recommendPrimaryGraphLens(graph, options.kernelProfile);
  const godNodes = buildGraphGodNodeSummaries(graph, 4);
  const readTheseFirst = getStartGuidanceReadFirstNodes(graph, 8)
    .map((node) => summarizeNode(node, workspaceRoot));

  const linkedNodes = linkRunPathsToCodeNodes(graph, options.linkedRunPaths ?? []);
  const focusQuery = options.focusQuery?.trim();
  const focusResult = focusQuery
    ? queryUnifiedCodeGraph(graph, focusQuery, { budget: nodeBudget, lens: primaryLens })
    : { nodes: [], edges: [], truncated: false };

  const mergedFocusNodes = uniqueNodes(
    [
      ...linkedNodes.map((summary) => graph.nodes.find((node) => node.id === summary.id)).filter(Boolean) as UnifiedCodeGraphNode[],
      ...focusResult.nodes,
    ],
    nodeBudget
  );

  const adjacency = buildGraphAdjacency(graph);
  const focusNodeIds = new Set(mergedFocusNodes.map((node) => node.id));
  const focusEdges = graph.edges
    .filter((edge) => focusNodeIds.has(edge.sourceNodeId) || focusNodeIds.has(edge.targetNodeId))
    .slice(0, edgeBudget)
    .map((edge) => ({
      kind: edge.kind,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      provenance: edge.provenance,
      source: edge.source,
      confidence: edge.confidence,
    }));

  if (mergedFocusNodes.length < nodeBudget) {
    for (const node of mergedFocusNodes) {
      for (const neighborId of adjacency.get(node.id) ?? []) {
        if (mergedFocusNodes.length >= nodeBudget) break;
        const neighbor = graph.nodes.find((candidate) => candidate.id === neighborId);
        if (neighbor && !focusNodeIds.has(neighbor.id)) {
          mergedFocusNodes.push(neighbor);
          focusNodeIds.add(neighbor.id);
        }
      }
    }
  }

  const ecosystemSupport = summarizeEcosystemSupportForAgents({
    graph,
    kernelProfile: options.kernelProfile,
  });
  const analyzers = graph.analyzers?.map((analyzer) => ({
    id: analyzer.id,
    label: safeCodeContextText(analyzer.label, workspaceRoot, 120),
    status: analyzer.status,
    fallbackReason: analyzer.fallbackReason
      ? safeCodeContextText(analyzer.fallbackReason, workspaceRoot, 240)
      : undefined,
  }));

  return {
    source: "unified_code_graph",
    workspaceRoot: safeCodeContextText(graph.workspaceRoot, workspaceRoot, 500),
    generatedAt: graph.generatedAt,
    primaryLens,
    ecosystemSupport,
    analyzers,
    readTheseFirst,
    godNodes: godNodes.map((godNode) => ({
      label: safeCodeContextText(godNode.label, workspaceRoot, 240),
      summary: safeCodeContextText(godNode.summary, workspaceRoot, 500),
      topFiles: sanitizeCodeContextList(godNode.topFiles, workspaceRoot, 8),
      topSymbols: sanitizeCodeContextList(godNode.topSymbols, workspaceRoot, 8),
    })),
    focusNodes: mergedFocusNodes.map((node) => summarizeNode(node, workspaceRoot)),
    focusEdges,
    linkedRunPaths: sanitizeCodeContextList(options.linkedRunPaths ?? [], workspaceRoot, nodeBudget),
    truncated: focusResult.truncated || mergedFocusNodes.length >= nodeBudget,
  };
}

function appendProductGraphChecks(
  checks: GraphFusionCheck[],
  productGraph: ProductGraphProjection
) {
  const codeIntent = summarizeProductGraphCodeIntentDrift(productGraph);
  if (codeIntent.codeNodesMissingIntentCount > 0) {
    checks.push({
      code: "code_intent_drift",
      title: "Run-touched code lacks linked product intent",
      severity: "warn",
      detail: `${codeIntent.codeNodesMissingIntentCount} run-touched code node(s) have no linked intent.`,
      count: codeIntent.codeNodesMissingIntentCount,
    });
  }

  const executionDrift = summarizeProductGraphExecutionDrift(productGraph);
  if (executionDrift.tasksWithDriftCount > 0) {
    checks.push({
      code: "execution_evidence_drift",
      title: "Completed tasks lack linked run or evidence",
      severity: "warn",
      detail: `${executionDrift.tasksWithDriftCount} completed task(s) are missing execution evidence.`,
      count: executionDrift.tasksWithDriftCount,
    });
  }

  const testEvidence = summarizeProductGraphExecutionTestEvidence(productGraph);
  if (testEvidence.tasksMissingTestEvidenceCount > 0) {
    checks.push({
      code: "missing_test_evidence",
      title: "Completed tasks lack test evidence",
      severity: "warn",
      detail: `${testEvidence.tasksMissingTestEvidenceCount} completed task(s) have run evidence but no test evidence.`,
      count: testEvidence.tasksMissingTestEvidenceCount,
    });
  }

  const acceptanceGaps = findProductGraphAcceptanceEvidenceGaps(productGraph);
  if (acceptanceGaps.length > 0) {
    const missingCriteriaCount = acceptanceGaps.reduce((total, gap) => total + gap.criteria.length, 0);
    checks.push({
      code: "acceptance_evidence_gap",
      title: "Acceptance criteria lack verification evidence",
      severity: "warn",
      detail: `${missingCriteriaCount} acceptance criterion/criteria still lack verification evidence.`,
      count: missingCriteriaCount,
    });
  }

  const codeMapFreshness = summarizeProductGraphCodeScanFreshness(productGraph);
  if (codeMapFreshness.isCodeMapMissing) {
    checks.push({
      code: "code_scan_missing",
      title: "Run-touched code lacks a native codebase scan",
      severity: "warn",
      detail: "Runs touched code paths but no native codebase scan map is loaded.",
      count: codeMapFreshness.runTouchedCodeNodeCount,
    });
  } else if (codeMapFreshness.isCodeMapStale) {
    checks.push({
      code: "code_scan_stale",
      title: "Run-touched code changed after the latest codebase scan",
      severity: "warn",
      detail: `${codeMapFreshness.codeNodesChangedAfterCodeScanCount} code node(s) changed after the latest scan.`,
      count: codeMapFreshness.codeNodesChangedAfterCodeScanCount,
    });
  }
}

export function evaluateOagFusionChecks(input: EvaluateOagFusionChecksInput): GraphFusionResult {
  const checks = evaluateUnifiedGraphQualityGates(input.graph, input.kernelProfile);

  if (input.handoffFreshness?.isStale) {
    checks.push({
      code: "stale_handoff",
      title: "Handoff report is stale relative to code graph",
      severity: "warn",
      detail: input.handoffFreshness.detail,
    });
  }

  const symbolCount = input.graph.nodes.filter((node) => node.kind === "symbol").length;
  if (
    typeof input.previousSymbolCount === "number"
    && input.previousSymbolCount > 0
    && symbolCount < Math.floor(input.previousSymbolCount * 0.8)
  ) {
    checks.push({
      code: "source_graph_coverage_regression",
      title: "Symbol coverage regressed versus previous export",
      severity: "warn",
      detail: `Indexed symbols dropped from ${input.previousSymbolCount} to ${symbolCount}.`,
      count: symbolCount,
    });
  }

  const symbolExtensions = indexedSymbolExtensions(input.graph);
  if (symbolExtensions.size === 0 && !DOCUMENTATION_PRIMARY_TYPES.has(input.kernelProfile?.primaryType ?? "")) {
    checks.push({
      code: "low_symbol_coverage",
      title: "No language symbols extracted",
      severity: "info",
      detail: "The workspace graph has files but no extracted symbols for agent navigation.",
    });
  }

  if (input.productGraph) {
    appendProductGraphChecks(checks, input.productGraph);
  }

  appendAnalyzerFusionChecks(checks, input.graph.analyzers, input.kernelProfile);

  const hardFailCount = checks.filter((check) => check.severity === "fail").length;
  const warnCount = checks.filter((check) => check.severity === "warn").length;
  return {
    ok: hardFailCount === 0,
    hardFailCount,
    warnCount,
    checks,
  };
}
