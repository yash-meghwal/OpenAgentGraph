import { retrieveOagById } from "@openagentgraph/shared";
import { readRequiredCliValue } from "./productGraphDataDir.js";
import {
  loadWorkspaceUnifiedGraph,
  parseGraphWorkspaceArgv,
  requireWorkspaceOption,
  warnIgnoredGraphCliOptions,
} from "./graphWorkspace.js";

function parseGraphRetrieveArgv(argv: string[]) {
  let retrievalId: string | undefined;
  const stripped: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--id") {
      retrievalId = readRequiredCliValue(argv, index, "--id");
      index += 1;
    } else {
      stripped.push(arg);
    }
  }

  const parsed = parseGraphWorkspaceArgv(stripped);
  if (parsed.positionals.length > 0) {
    throw new Error(`Unknown graph:retrieve arguments: ${parsed.positionals.join(" ")}`);
  }
  if (!retrievalId?.trim()) {
    throw new Error('graph:retrieve requires --id "<oag-id>".');
  }

  return { graphOptions: parsed.options, retrievalId: retrievalId.trim() };
}

export async function runGraphRetrieveCli(argv = process.argv.slice(2)) {
  const { graphOptions, retrievalId } = parseGraphRetrieveArgv(argv);
  if (!graphOptions.json) warnIgnoredGraphCliOptions("generic", graphOptions);
  const workspaceRoot = requireWorkspaceOption(graphOptions.workspace);
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: graphOptions.refresh });
  const result = retrieveOagById(loaded.graph, retrievalId, { workspaceRoot });

  if (!result) {
    throw new Error(`Unknown or unavailable retrieval id: ${retrievalId}`);
  }

  const payload = {
    status: "graph_retrieve_complete",
    workspaceRoot,
    fromCache: loaded.fromCache,
    retrieval: result,
  };

  if (graphOptions.json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(`Retrieval: ${result.id}`);
  console.log(`Label: ${result.label}`);
  console.log(`Summary: ${result.summary}`);
  if (result.neighbors.length > 0) {
    console.log("Neighbors:");
    for (const neighbor of result.neighbors) {
      console.log(`- [${neighbor.kind}] ${neighbor.label}${neighbor.path ? ` (${neighbor.path})` : ""}`);
    }
  }
  for (const hint of result.hints) {
    console.log(`Hint: ${hint}`);
  }
  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphRetrieve\.(?:ts|js)$/.test(invokedPath)) {
  runGraphRetrieveCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}