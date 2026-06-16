import path from "path";
import type { GraphIncrementalManifest, GraphUpdatePlan, UnifiedCodeGraph, WorkspaceKernelProfile } from "@openagentgraph/shared";
import {
  buildGraphIncrementalManifest,
  mergeUnifiedGraphUpdate,
  planGraphIncrementalUpdate,
  removeUnifiedGraphPaths,
} from "@openagentgraph/shared/graphIncremental";
import { scanWorkspaceRelativePaths } from "../codeScanner.js";
import { IGNORE_ENGINE_VERSION } from "./ignoreEngine.js";
import { collectWorkspaceFileFingerprints } from "./graphFingerprints.js";
import { SCAN_KERNEL_VERSION, runKernelWorkspaceScan } from "./scanKernel.js";
import { SCANNER_REGISTRY_VERSION } from "./scannerRegistry.js";
import { buildUnifiedCodeGraph } from "./unifiedGraph.js";
import { detectWorkspaceKernelProfile } from "./workspaceDetection.js";
import { IgnoreEngine } from "./ignoreEngine.js";

export const GRAPH_INCREMENTAL_TOOL_VERSION = `${SCAN_KERNEL_VERSION}+${SCANNER_REGISTRY_VERSION}+${IGNORE_ENGINE_VERSION}`;

export interface GraphWorkspaceUpdateResult {
  plan: GraphUpdatePlan;
  graph: UnifiedCodeGraph;
  kernelProfile: WorkspaceKernelProfile;
  manifest: GraphIncrementalManifest;
  fingerprints: Awaited<ReturnType<typeof collectWorkspaceFileFingerprints>>["files"];
  durationMs: number;
  dryRun: boolean;
}

function extensionCountsFromFingerprints(files: Array<{ path: string }>) {
  const counts = new Map<string, number>();
  for (const file of files) {
    const extension = path.extname(file.path).toLowerCase() || "(none)";
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return counts;
}

async function detectCurrentKernelProfile(workspaceRoot: string, files: Array<{ path: string }>) {
  const ignoreEngine = await IgnoreEngine.load(workspaceRoot);
  return detectWorkspaceKernelProfile(workspaceRoot, {
    ignoreEngine,
    ignoreRules: ignoreEngine.rules,
    sourceExtensionCounts: extensionCountsFromFingerprints(files),
    skippedCountsByReason: new Map(),
  });
}

function buildPartialUnifiedGraph(input: {
  workspaceRoot: string;
  kernelProfile: WorkspaceKernelProfile;
  partialScan: Awaited<ReturnType<typeof scanWorkspaceRelativePaths>>;
  diagnostics: string[];
}) {
  return buildUnifiedCodeGraph({
    workspaceRoot: input.workspaceRoot,
    generatedAt: input.partialScan.scannedAt,
    projection: {
      schemaVersion: "1",
      productGraphId: "graph-update-partial",
      nodes: input.partialScan.nodes.map((node) => ({
        ...node,
        incomingEdgeIds: [],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      })),
      edges: input.partialScan.edges,
      events: [],
      summary: {
        nodeCount: input.partialScan.nodes.length,
        edgeCount: input.partialScan.edges.length,
        nodesByKind: {},
        edgesByKind: {},
        unresolvedOpenQuestionCount: 0,
        blockedTaskCount: 0,
      },
    },
    kernelProfile: input.kernelProfile,
    diagnostics: input.diagnostics,
  });
}

export async function runGraphWorkspaceUpdate(
  workspaceRoot: string,
  input: {
    cachedGraph?: UnifiedCodeGraph;
    manifest?: GraphIncrementalManifest;
    refresh?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<GraphWorkspaceUpdateResult> {
  const startedAt = Date.now();
  const resolvedRoot = path.resolve(workspaceRoot);
  const fingerprintResult = await collectWorkspaceFileFingerprints(resolvedRoot);
  const kernelProfile = await detectCurrentKernelProfile(resolvedRoot, fingerprintResult.files);
  const plan = planGraphIncrementalUpdate({
    cachedGraph: input.cachedGraph,
    manifest: input.manifest,
    currentFingerprints: fingerprintResult.files,
    kernelProfile,
    incrementalToolVersion: GRAPH_INCREMENTAL_TOOL_VERSION,
    ignoreRuleFingerprint: fingerprintResult.ignoreRuleFingerprint,
    forceFull: input.refresh,
  });

  if (plan.mode === "noop" && input.cachedGraph) {
    const manifest = buildGraphIncrementalManifest({
      graph: input.cachedGraph,
      kernelProfile,
      incrementalToolVersion: GRAPH_INCREMENTAL_TOOL_VERSION,
      ignoreRuleFingerprint: fingerprintResult.ignoreRuleFingerprint,
      files: fingerprintResult.files,
    });
    return {
      plan,
      graph: input.cachedGraph,
      kernelProfile,
      manifest,
      fingerprints: fingerprintResult.files,
      durationMs: Date.now() - startedAt,
      dryRun: Boolean(input.dryRun),
    };
  }

  if (plan.mode === "full" || !input.cachedGraph) {
    const scanResult = await runKernelWorkspaceScan(resolvedRoot);
    const manifest = buildGraphIncrementalManifest({
      graph: scanResult.unifiedGraph,
      kernelProfile: scanResult.kernelProfile,
      incrementalToolVersion: GRAPH_INCREMENTAL_TOOL_VERSION,
      ignoreRuleFingerprint: fingerprintResult.ignoreRuleFingerprint,
      files: fingerprintResult.files,
    });
    return {
      plan: plan.mode === "full" ? plan : { ...plan, mode: "full", reasons: [...plan.reasons, "No cached graph available."] },
      graph: scanResult.unifiedGraph,
      kernelProfile: scanResult.kernelProfile,
      manifest,
      fingerprints: fingerprintResult.files,
      durationMs: Date.now() - startedAt,
      dryRun: Boolean(input.dryRun),
    };
  }

  const stripPaths = plan.stripPaths.length > 0 ? plan.stripPaths : [...plan.changed, ...plan.deleted];
  let mergedGraph = removeUnifiedGraphPaths(input.cachedGraph, stripPaths);
  const diagnostics = [
    `Incremental update touched ${plan.scanPaths.length} file(s); stripped ${stripPaths.length}; removed ${plan.deleted.length}.`,
    ...(plan.neighborPaths.length > 0
      ? [`Dependency neighborhood refresh: ${plan.neighborPaths.join(", ")}.`]
      : []),
  ];

  if (plan.scanPaths.length > 0) {
    const partialScan = await scanWorkspaceRelativePaths({
      workspaceRoot: resolvedRoot,
      relativePaths: plan.scanPaths,
    });
    const partialGraph = buildPartialUnifiedGraph({
      workspaceRoot: resolvedRoot,
      kernelProfile,
      partialScan,
      diagnostics: [...diagnostics, ...partialScan.summary.diagnostics],
    });
    mergedGraph = mergeUnifiedGraphUpdate({
      base: mergedGraph,
      partial: partialGraph,
      removedPaths: plan.scanPaths,
      generatedAt: partialScan.scannedAt,
      diagnostics: partialGraph.diagnostics,
    });
  } else {
    mergedGraph = {
      ...mergedGraph,
      generatedAt: new Date().toISOString(),
      diagnostics: [...mergedGraph.diagnostics, ...diagnostics],
    };
  }

  const manifest = buildGraphIncrementalManifest({
    graph: mergedGraph,
    kernelProfile,
    incrementalToolVersion: GRAPH_INCREMENTAL_TOOL_VERSION,
    ignoreRuleFingerprint: fingerprintResult.ignoreRuleFingerprint,
    files: fingerprintResult.files,
  });

  return {
    plan,
    graph: mergedGraph,
    kernelProfile,
    manifest,
    fingerprints: fingerprintResult.files,
    durationMs: Date.now() - startedAt,
    dryRun: Boolean(input.dryRun),
  };
}