import {
  buildGraphGodNodeSummaries,
  buildGraphHealthSummary,
  buildGraphLensSummaries,
  filterUnifiedGraphByLens,
  recommendPrimaryGraphLens,
} from "@openagentgraph/shared";
import {
  loadWorkspaceUnifiedGraph,
  parseGraphWorkspaceArgv,
  requireWorkspaceOption,
} from "./graphWorkspace.js";

export async function runGraphLensCli(argv = process.argv.slice(2)) {
  const { options, positionals } = parseGraphWorkspaceArgv(argv);
  const workspaceRoot = requireWorkspaceOption(options.workspace);
  if (positionals.length > 0) {
    throw new Error(`Unknown graph:lens arguments: ${positionals.join(" ")}`);
  }

  const lens = options.lens ?? "all";
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: options.refresh });
  const summaries = buildGraphLensSummaries(loaded.graph);
  const primaryLens = recommendPrimaryGraphLens(loaded.graph, loaded.kernelProfile);
  const godNodes = buildGraphGodNodeSummaries(loaded.graph);
  const health = buildGraphHealthSummary(loaded.graph, loaded.kernelProfile);
  const scopedGraph = filterUnifiedGraphByLens(loaded.graph, lens);
  const activeLens = summaries.find((summary) => summary.id === lens);

  const payload = {
    status: "graph_lens_complete",
    workspaceRoot,
    fromCache: loaded.fromCache,
    lens,
    primaryLens,
    activeLens,
    summaries,
    godNodes,
    health,
    scopedNodeCount: scopedGraph.nodes.length,
    scopedEdgeCount: scopedGraph.edges.length,
    diagnostics: loaded.graph.diagnostics,
    activeScannerIds: loaded.graph.activeScannerIds,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Primary lens: ${primaryLens}`);
  console.log(`Active lens: ${lens}${activeLens ? ` (${activeLens.fileCount} files, ${activeLens.symbolCount} symbols)` : ""}`);
  console.log("Health:");
  for (const badge of health.badges) {
    console.log(`- [${badge.tone}] ${badge.label}: ${badge.detail}`);
  }
  console.log("God nodes:");
  for (const godNode of godNodes.slice(0, 6)) {
    console.log(`- ${godNode.label}: ${godNode.summary}`);
  }
  if (loaded.graph.diagnostics.length > 0) {
    console.log("Diagnostics:");
    for (const diagnostic of loaded.graph.diagnostics.slice(0, 8)) {
      console.log(`- ${diagnostic}`);
    }
  }
  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphLens\.(?:ts|js)$/.test(invokedPath)) {
  runGraphLensCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}