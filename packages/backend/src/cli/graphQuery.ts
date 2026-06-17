import { queryUnifiedCodeGraph } from "@openagentgraph/shared";
import {
  joinGraphCliPositionals,
  loadWorkspaceUnifiedGraph,
  parseGraphWorkspaceArgv,
  requireWorkspaceOption,
  warnIgnoredGraphCliOptions,
} from "./graphWorkspace.js";

export async function runGraphQueryCli(argv = process.argv.slice(2)) {
  const { options, positionals } = parseGraphWorkspaceArgv(argv);
  if (!options.json) warnIgnoredGraphCliOptions("query", options);
  const workspaceRoot = requireWorkspaceOption(options.workspace);
  const query = joinGraphCliPositionals(positionals);
  if (!query) {
    throw new Error('graph:query requires a question, e.g. graph:query -- --workspace "<path>" "how does auth work?"');
  }

  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: options.refresh });
  const result = queryUnifiedCodeGraph(loaded.graph, query, {
    mode: options.dfs ? "dfs" : "bfs",
    budget: options.budget,
    lens: options.lens,
  });

  const payload = {
    status: "graph_query_complete",
    workspaceRoot,
    fromCache: loaded.fromCache,
    lens: options.lens ?? "all",
    query: result.query,
    mode: result.mode,
    truncated: result.truncated,
    seeds: result.seeds,
    nodes: result.nodes,
    edges: result.edges,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Query: ${result.query}`);
  console.log(`Mode: ${result.mode}${result.truncated ? " (truncated)" : ""}`);
  if (result.seeds.length === 0) {
    console.log("No matching seed nodes.");
    return payload;
  }
  console.log(`Seeds: ${result.seeds.map((node) => node.label).join(", ")}`);
  for (const node of result.nodes) {
    const nodePath = node.path ? ` (${node.path})` : "";
    console.log(`- [${node.kind}] ${node.label}${nodePath}`);
  }
  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphQuery\.(?:ts|js)$/.test(invokedPath)) {
  runGraphQueryCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}