import type {
  GraphTaskLensId,
  ProductGraphProjection,
  WorkspaceGraphOperationalContext,
} from "@openagentgraph/shared";
import {
  GRAPH_TASK_LENS_DEFINITIONS,
  buildAgentCodeContextSlice,
  buildGraphGodNodeSummaries,
  buildGraphHealthSummary,
  buildGraphLensSummaries,
  buildWorkspaceGraphQueryEntryPoints,
  evaluateOagFusionChecks,
  filterUnifiedGraphByLens,
  recommendPrimaryGraphLens,
} from "@openagentgraph/shared";
import {
  readHandoffFreshness,
  readPreviousSymbolCount,
  tryLoadCachedWorkspaceGraph,
} from "./graphWorkspace.js";

function countProductGraphCodeFiles(projection?: ProductGraphProjection) {
  return projection?.nodes.filter((node) => node.kind === "code_file").length ?? 0;
}

export async function buildWorkspaceGraphOperationalContext(input: {
  workspaceRoot: string;
  lens?: GraphTaskLensId;
  productGraph?: ProductGraphProjection;
  kernelProfile?: import("@openagentgraph/shared").WorkspaceKernelProfile;
}): Promise<WorkspaceGraphOperationalContext> {
  const lens = input.lens ?? "all";
  const codeGraph = await tryLoadCachedWorkspaceGraph(input.workspaceRoot);
  const codeFileCount = countProductGraphCodeFiles(input.productGraph);

  if (!codeGraph) {
    if (codeFileCount === 0) {
      return {
        available: false,
        unavailableReason: "no_code_scan",
        unavailableDetail: "Run Scan Codebase from Product Graph before exporting a unified graph.",
        workspaceRoot: input.workspaceRoot,
        lens,
      };
    }
    return {
      available: false,
      unavailableReason: "no_graph_export",
      unavailableDetail: "Export .oag/graph.json with graph:export or write GRAPH_REPORT.md after scanning.",
      workspaceRoot: input.workspaceRoot,
      lens,
    };
  }

  const handoffFreshness = await readHandoffFreshness(input.workspaceRoot, codeGraph.generatedAt);
  const previousSymbolCount = await readPreviousSymbolCount(input.workspaceRoot);
  const summaries = buildGraphLensSummaries(codeGraph);
  const primaryLens = recommendPrimaryGraphLens(codeGraph, input.kernelProfile);
  const godNodes = buildGraphGodNodeSummaries(codeGraph, 6);
  const health = buildGraphHealthSummary(codeGraph, input.kernelProfile);
  const fusion = evaluateOagFusionChecks({
    graph: codeGraph,
    kernelProfile: input.kernelProfile,
    handoffFreshness,
    productGraph: input.productGraph,
    previousSymbolCount,
  });
  const codeContext = buildAgentCodeContextSlice(codeGraph, {
    kernelProfile: input.kernelProfile,
    workspaceRoot: input.workspaceRoot,
    nodeBudget: 12,
    edgeBudget: 16,
  });
  const scopedGraph = filterUnifiedGraphByLens(codeGraph, lens);
  const activeLens = summaries.find((summary) => summary.id === lens);
  const lensLabel = GRAPH_TASK_LENS_DEFINITIONS.find((definition) => definition.id === lens)?.label ?? lens;
  const queryEntryPoints = buildWorkspaceGraphQueryEntryPoints({
    workspaceRoot: input.workspaceRoot,
    lens,
  });

  if (lens !== "all" && scopedGraph.nodes.length === 0) {
    return {
      available: true,
      unavailableReason: "lens_no_matches",
      unavailableDetail: `No indexed nodes match the ${lensLabel} lens.`,
      workspaceRoot: input.workspaceRoot,
      generatedAt: codeGraph.generatedAt,
      fromCache: true,
      lens,
      primaryLens,
      health,
      lenses: summaries,
      godNodes,
      fusion,
      readTheseFirst: codeContext.readTheseFirst.slice(0, 8),
      scopedNodeCount: 0,
      scopedEdgeCount: 0,
      activeScannerIds: codeGraph.activeScannerIds,
      ecosystemSupport: codeContext.ecosystemSupport,
      analyzers: codeContext.analyzers,
      diagnostics: codeGraph.diagnostics.slice(0, 12),
      queryEntryPoints,
    };
  }

  return {
    available: true,
    workspaceRoot: input.workspaceRoot,
    generatedAt: codeGraph.generatedAt,
    fromCache: true,
    lens,
    primaryLens,
    health,
    lenses: summaries,
    godNodes,
    fusion,
    readTheseFirst: codeContext.readTheseFirst.slice(0, 8),
    scopedNodeCount: scopedGraph.nodes.length,
    scopedEdgeCount: scopedGraph.edges.length,
    activeScannerIds: codeGraph.activeScannerIds,
    ecosystemSupport: codeContext.ecosystemSupport,
    analyzers: codeContext.analyzers,
    diagnostics: codeGraph.diagnostics.slice(0, 12),
    queryEntryPoints,
  };
}