import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import {
  buildAgentCodeContextSlice,
  evaluateOagFusionChecks,
  type GraphHandoffFreshnessResult,
} from "./graphFusion.js";
import { buildGraphCommunityHubSummaries } from "./graphCommunityHubs.js";
import {
  buildDocsHubSummaries,
  buildDocsLinkedToCodeSummaries,
  scoreDocSectionForQuery,
} from "./graphDocs.js";
import {
  buildGraphGodNodeSummaries,
  filterUnifiedGraphByLens,
  recommendPrimaryGraphLens,
  type GraphTaskLensId,
} from "./graphLenses.js";
import { buildWorkspaceGraphQueryEntryPoints } from "./graphOperational.js";
import { findGraphSeedNodes } from "./graphQueryEngine.js";
import { summarizeEcosystemSupportForAgents } from "./graphEcosystemHealth.js";
import { sanitizeOperationalText } from "./safeText.js";
import { attachRetrievalIdsToNodes, encodeOagRetrievalId } from "./graphRetrieval.js";

export interface GraphAgentContextPackOptions {
  goal?: string;
  lens?: GraphTaskLensId;
  budget?: number;
  workspaceRoot?: string;
  redactRoot?: boolean;
  kernelProfile?: WorkspaceKernelProfile;
  handoffFreshness?: GraphHandoffFreshnessResult;
}

export interface GraphAgentContextPack {
  status: "graph_context_ready" | "graph_context_unavailable";
  workspaceRoot: string;
  goal?: string;
  lens: GraphTaskLensId;
  generatedAt: string;
  fromCache: boolean;
  budget: number;
  estimatedSize: number;
  truncated: boolean;
  workspaceSummary: {
    nodeCount: number;
    edgeCount: number;
    symbolCount: number;
    docFileCount: number;
    primaryLens: GraphTaskLensId;
  };
  supportMatrix: ReturnType<typeof summarizeEcosystemSupportForAgents>;
  analyzers: UnifiedCodeGraph["analyzers"];
  graphFreshness: GraphHandoffFreshnessResult | { detail: string };
  readFirstNodes: Array<{
    id: string;
    kind: string;
    label: string;
    path?: string;
    retrievalId: string;
  }>;
  communities: Array<{
    label: string;
    hubSummary: string;
    retrievalId: string;
  }>;
  relevantDocs: Array<{
    path: string;
    label: string;
    retrievalId: string;
  }>;
  likelyEntrypoints: string[];
  suggestedQueries: string[];
  suggestedPaths: string[];
  provenanceSummary: {
    hardFailCount: number;
    warnCount: number;
    ok: boolean;
  };
  risks: string[];
  retrievalHints: string[];
  queryEntryPoints: ReturnType<typeof buildWorkspaceGraphQueryEntryPoints>;
}

const DEFAULT_CONTEXT_BUDGET = 12_000;

function safeText(value: string, workspaceRoot?: string, maxLength = 500): string {
  return sanitizeOperationalText(value, { workspaceRoot, maxLength });
}

function tokenizeGoal(goal?: string): string[] {
  if (!goal?.trim()) return [];
  return goal
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function buildSuggestedQueries(goal: string | undefined, lens: GraphTaskLensId, seeds: string[]) {
  const suggestions = new Set<string>();
  if (goal?.trim()) suggestions.add(goal.trim());
  for (const seed of seeds.slice(0, 3)) {
    suggestions.add(seed);
  }
  if (lens !== "all") suggestions.add(`${lens} entrypoints`);
  return [...suggestions].slice(0, 6);
}

function buildSuggestedPaths(seeds: string[]) {
  if (seeds.length < 2) return [];
  return [`${seeds[0]} → ${seeds[1]}`];
}

function enforceBudget(pack: GraphAgentContextPack, budget: number): { pack: GraphAgentContextPack; truncated: boolean } {
  let serialized = JSON.stringify(pack);
  if (serialized.length <= budget) {
    return { pack, truncated: false };
  }

  const mutable = structuredClone(pack) as GraphAgentContextPack;
  const listKeys = ["readFirstNodes", "communities", "relevantDocs", "risks", "retrievalHints", "suggestedQueries"] as const;
  let truncated = false;

  while (JSON.stringify(mutable).length > budget) {
    let reduced = false;
    for (const key of listKeys) {
      const list = mutable[key];
      if (Array.isArray(list) && list.length > 1) {
        list.pop();
        reduced = true;
        truncated = true;
        break;
      }
    }
    if (!reduced) break;
  }

  return { pack: mutable, truncated };
}

export function buildGraphAgentContextPack(
  graph: UnifiedCodeGraph,
  options: GraphAgentContextPackOptions = {}
): GraphAgentContextPack {
  const lens = options.lens ?? recommendPrimaryGraphLens(graph, options.kernelProfile);
  const budget = Math.max(2000, options.budget ?? DEFAULT_CONTEXT_BUDGET);
  const workspaceRoot = options.redactRoot
    ? safeText(graph.workspaceRoot, graph.workspaceRoot, 120)
    : (options.workspaceRoot ?? graph.workspaceRoot);
  const goal = options.goal?.trim() ? safeText(options.goal.trim(), graph.workspaceRoot, 500) : undefined;
  const tokens = tokenizeGoal(goal);

  const codeContext = buildAgentCodeContextSlice(graph, {
    focusQuery: goal,
    nodeBudget: 16,
    edgeBudget: 12,
    kernelProfile: options.kernelProfile,
    workspaceRoot: graph.workspaceRoot,
  });

  const fusion = evaluateOagFusionChecks({
    graph,
    kernelProfile: options.kernelProfile,
    handoffFreshness: options.handoffFreshness,
  });

  const scopedGraph = filterUnifiedGraphByLens(graph, lens);
  const hubs = buildGraphCommunityHubSummaries(graph, { mergeThinForPresentation: true, limit: 6 });
  const docsHubs = buildDocsHubSummaries(graph, 6);
  const docsLinked = buildDocsLinkedToCodeSummaries(graph, 6);

  const docSections = graph.nodes
    .filter((node) => node.kind === "doc_section")
    .map((node) => ({ node, score: scoreDocSectionForQuery(node, tokens) }))
    .filter((entry) => entry.score > 0 || tokens.length === 0)
    .sort((left, right) => right.score - left.score || left.node.label.localeCompare(right.node.label))
    .slice(0, 6)
    .map((entry) => entry.node);

  const seedNodes = findGraphSeedNodes(graph, goal ?? "entrypoint main service controller", 6);
  const readFirst = attachRetrievalIdsToNodes(
    uniqueById([
      ...codeContext.readTheseFirst,
      ...seedNodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        label: safeText(node.label, graph.workspaceRoot, 240),
        path: node.path ? safeText(node.path, graph.workspaceRoot, 500) : undefined,
      })),
    ]).slice(0, 12)
  );

  const risks: string[] = [];
  if (options.handoffFreshness?.isStale) {
    risks.push("GRAPH_REPORT.md or .oag/graph.json may be stale — run graph:export or graph:update.");
  }
  for (const check of fusion.checks.filter((entry) => entry.severity === "fail" || entry.severity === "warn").slice(0, 6)) {
    risks.push(`[${check.severity}] ${check.title}: ${safeText(check.detail, graph.workspaceRoot, 240)}`);
  }
  for (const row of codeContext.ecosystemSupport ?? []) {
    if (row.tier === "T2" || row.tier === "T3") {
      risks.push(`${row.scannerId} is ${row.tier}: ${row.limitation}`);
    }
  }

  const seedLabels = readFirst.map((node) => node.label);
  const pack: GraphAgentContextPack = {
    status: "graph_context_ready",
    workspaceRoot: safeText(workspaceRoot, graph.workspaceRoot, 500),
    goal,
    lens,
    generatedAt: graph.generatedAt,
    fromCache: true,
    budget,
    estimatedSize: 0,
    truncated: codeContext.truncated,
    workspaceSummary: {
      nodeCount: scopedGraph.nodes.length,
      edgeCount: scopedGraph.edges.length,
      symbolCount: graph.nodes.filter((node) => node.kind === "symbol").length,
      docFileCount: graph.nodes.filter((node) => node.kind === "doc_file").length,
      primaryLens: codeContext.primaryLens as GraphTaskLensId,
    },
    supportMatrix: summarizeEcosystemSupportForAgents({
      graph,
      kernelProfile: options.kernelProfile,
    }),
    analyzers: graph.analyzers,
    graphFreshness: options.handoffFreshness ?? { detail: "No handoff freshness data available." },
    readFirstNodes: readFirst,
    communities: hubs.map((hub) => ({
      label: safeText(hub.label, graph.workspaceRoot, 240),
      hubSummary: safeText(hub.hubSummary, graph.workspaceRoot, 500),
      retrievalId: encodeOagRetrievalId("community", hub.id),
    })),
    relevantDocs: [
      ...docSections.map((section) => ({
        path: safeText(section.path ?? section.label, graph.workspaceRoot, 500),
        label: safeText(section.label, graph.workspaceRoot, 240),
        retrievalId: encodeOagRetrievalId("doc", section.id),
      })),
      ...docsHubs.slice(0, 3).map((hub) => ({
        path: safeText(hub.path, graph.workspaceRoot, 500),
        label: safeText(hub.label, graph.workspaceRoot, 240),
        retrievalId: encodeOagRetrievalId("doc", hub.path),
      })),
      ...docsLinked.slice(0, 2).map((link) => ({
        path: safeText(link.docPath ?? link.docLabel, graph.workspaceRoot, 500),
        label: safeText(`${link.docLabel} → ${link.targetLabel}`, graph.workspaceRoot, 240),
        retrievalId: encodeOagRetrievalId("node", link.targetLabel),
      })),
    ].slice(0, 8),
    likelyEntrypoints: buildGraphGodNodeSummaries(graph, 4).map((godNode) =>
      safeText(godNode.label, graph.workspaceRoot, 240)
    ),
    suggestedQueries: buildSuggestedQueries(goal, lens, seedLabels),
    suggestedPaths: buildSuggestedPaths(seedLabels),
    provenanceSummary: {
      hardFailCount: fusion.hardFailCount,
      warnCount: fusion.warnCount,
      ok: fusion.ok,
    },
    risks: risks.slice(0, 8),
    retrievalHints: [
      "Use graph:retrieve --id <oag-id> for deeper neighborhoods without source bodies.",
      "Prefer .oag/graph.json and GRAPH_REPORT.md before broad repo scanning.",
      "Run graph:check --mode hard before trusting semantic claims.",
    ],
    queryEntryPoints: buildWorkspaceGraphQueryEntryPoints({
      workspaceRoot: safeText(workspaceRoot, graph.workspaceRoot, 500),
      lens,
    }),
  };

  const bounded = enforceBudget(pack, budget);
  bounded.pack.estimatedSize = JSON.stringify(bounded.pack).length;
  bounded.pack.truncated = bounded.pack.truncated || bounded.truncated;
  return bounded.pack;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

export function renderGraphAgentContextMarkdown(pack: GraphAgentContextPack): string {
  const lines = [
    "# OAG Agent Context Pack",
    "",
    `Workspace: \`${pack.workspaceRoot}\``,
    pack.goal ? `Goal: ${pack.goal}` : undefined,
    `Lens: \`${pack.lens}\``,
    `Generated: ${pack.generatedAt}`,
    "",
    "## Read first",
    ...(pack.readFirstNodes.length > 0
      ? pack.readFirstNodes.map(
        (node) => `- [${node.kind}] ${node.label}${node.path ? ` (\`${node.path}\`)` : ""} — \`${node.retrievalId}\``
      )
      : ["- No read-first nodes available."]),
    "",
    "## Communities",
    ...(pack.communities.length > 0
      ? pack.communities.map((hub) => `- ${hub.label}: ${hub.hubSummary} (\`${hub.retrievalId}\`)`)
      : ["- No community hubs indexed."]),
    "",
    "## Suggested commands",
    `- ${pack.queryEntryPoints.queryHint}`,
    `- ${pack.queryEntryPoints.pathHint}`,
    `- ${pack.queryEntryPoints.explainHint}`,
    "",
    "## Risks",
    ...(pack.risks.length > 0 ? pack.risks.map((risk) => `- ${risk}`) : ["- No active risks flagged."]),
    "",
    "## Retrieval",
    ...pack.retrievalHints.map((hint) => `- ${hint}`),
    "",
  ].filter((line): line is string => line !== undefined);

  return `${lines.join("\n")}\n`;
}