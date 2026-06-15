import { findGraphPath } from "@openagentgraph/shared";
import {
  joinGraphCliPositionals,
  loadWorkspaceUnifiedGraph,
  normalizeGraphCliArg,
  parseGraphWorkspaceArgv,
  requireWorkspaceOption,
} from "./graphWorkspace.js";

export async function runGraphPathCli(argv = process.argv.slice(2)) {
  const { options, positionals } = parseGraphWorkspaceArgv(argv);
  const workspaceRoot = requireWorkspaceOption(options.workspace);
  if (positionals.length < 2) {
    throw new Error('graph:path requires --workspace "<path>" "<from>" "<to>".');
  }

  const fromQuery = normalizeGraphCliArg(positionals[0]!);
  const toQuery = joinGraphCliPositionals(positionals.slice(1));
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: options.refresh });
  const result = findGraphPath(loaded.graph, fromQuery, toQuery);

  const payload = {
    status: "graph_path_complete",
    workspaceRoot,
    fromCache: loaded.fromCache,
    from: result.from,
    to: result.to,
    found: result.found,
    fromNode: result.fromNode,
    toNode: result.toNode,
    nodes: result.nodes,
    edges: result.edges,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Path: ${result.from} -> ${result.to}`);
  if (!result.found) {
    console.log("No path found.");
    return payload;
  }
  for (const node of result.nodes) {
    const nodePath = node.path ? ` (${node.path})` : "";
    console.log(`- [${node.kind}] ${node.label}${nodePath}`);
  }
  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphPath\.(?:ts|js)$/.test(invokedPath)) {
  runGraphPathCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}