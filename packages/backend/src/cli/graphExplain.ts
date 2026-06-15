import { explainGraphNode } from "@openagentgraph/shared";
import {
  joinGraphCliPositionals,
  loadWorkspaceUnifiedGraph,
  parseGraphWorkspaceArgv,
  requireWorkspaceOption,
} from "./graphWorkspace.js";

export async function runGraphExplainCli(argv = process.argv.slice(2)) {
  const { options, positionals } = parseGraphWorkspaceArgv(argv);
  const workspaceRoot = requireWorkspaceOption(options.workspace);
  const target = joinGraphCliPositionals(positionals);
  if (!target) {
    throw new Error('graph:explain requires --workspace "<path>" "<node-or-file>".');
  }

  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: options.refresh });
  const result = explainGraphNode(loaded.graph, target);

  const payload = {
    status: "graph_explain_complete",
    workspaceRoot,
    fromCache: loaded.fromCache,
    target: result.target,
    resolved: result.resolved,
    summary: result.summary,
    node: result.node,
    neighbors: result.neighbors,
    edges: result.edges,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(`Workspace: ${workspaceRoot}`);
  console.log(result.summary);
  if (result.neighbors.length > 0) {
    console.log("Neighbors:");
    for (const neighbor of result.neighbors) {
      const neighborPath = neighbor.path ? ` (${neighbor.path})` : "";
      console.log(`- [${neighbor.kind}] ${neighbor.label}${neighborPath}`);
    }
  }
  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphExplain\.(?:ts|js)$/.test(invokedPath)) {
  runGraphExplainCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}