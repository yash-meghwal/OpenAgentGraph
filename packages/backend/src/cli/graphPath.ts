import { findGraphPath } from "@openagentgraph/shared";
import {
  joinGraphCliPositionals,
  loadWorkspaceUnifiedGraph,
  normalizeGraphCliArg,
  parseGraphWorkspaceArgv,
  requireWorkspaceOption,
  warnIgnoredGraphCliOptions,
} from "./graphWorkspace.js";

export async function runGraphPathCli(argv = process.argv.slice(2)) {
  const { options, positionals } = parseGraphWorkspaceArgv(argv);
  if (!options.json) warnIgnoredGraphCliOptions("path", options);
  const workspaceRoot = requireWorkspaceOption(options.workspace);
  if (positionals.length < 2) {
    throw new Error('graph:path requires --workspace "<path>" "<from>" "<to>".');
  }

  const fromQuery = normalizeGraphCliArg(positionals[0]!);
  const toQuery = joinGraphCliPositionals(positionals.slice(1));
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: options.refresh });
  const result = findGraphPath(loaded.graph, fromQuery, toQuery, {
    lens: options.lens,
    maxHops: options.maxHops,
    explainRanking: options.explainRanking,
    mode: options.pathMode ?? "balanced",
  });

  const payload = {
    status: "graph_path_complete",
    workspaceRoot,
    fromCache: loaded.fromCache,
    lens: options.lens ?? "all",
    mode: options.pathMode ?? "balanced",
    maxHops: options.maxHops,
    from: result.from,
    to: result.to,
    found: result.found,
    fromNode: result.fromNode,
    toNode: result.toNode,
    nodes: result.nodes,
    edges: result.edges,
    explanation: result.explanation,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Path: ${result.from} -> ${result.to}`);
  if (options.lens) console.log(`Lens: ${options.lens}`);
  console.log(`Mode: ${options.pathMode ?? "balanced"}`);
  if (options.maxHops) console.log(`Max hops: ${options.maxHops}`);
  if (!result.found) {
    console.log("No path found.");
    return payload;
  }
  if (result.explanation) {
    console.log(`Path intent: ${result.explanation.pathIntent}`);
    console.log(
      `Seed resolution: ${result.explanation.seedResolution.from.label ?? result.from}`
        + ` (${result.explanation.seedResolution.from.matchReason}) -> `
        + `${result.explanation.seedResolution.to.label ?? result.to}`
        + ` (${result.explanation.seedResolution.to.matchReason})`
    );
    for (const note of result.explanation.docPenaltyNotes) {
      console.log(`Doc ranking: ${note}`);
    }
  }
  for (const node of result.nodes) {
    const nodePath = node.path ? ` (${node.path})` : "";
    console.log(`- [${node.kind}] ${node.label}${nodePath}`);
  }
  if (result.explanation) {
    console.log("Path steps:");
    for (const step of result.explanation.steps.slice(1)) {
      const edgeSummary = step.viaEdge
        ? `${step.viaEdge.kind}/${step.viaEdge.provenance}${step.viaEdge.source ? `/${step.viaEdge.source}` : ""}`
        : "n/a";
      const weightSummary = typeof step.edgeCost === "number"
        ? ` cost=${Math.round(step.edgeCost)}${typeof step.nodePenalty === "number" ? ` penalty=${Math.round(step.nodePenalty)}` : ""}`
        : "";
      console.log(`  hop ${step.hop}: via ${edgeSummary}${weightSummary} -> [${step.node.kind}] ${step.node.label}`);
    }
    for (const alternative of result.explanation.penalizedAlternatives) {
      console.log(`Penalized alternative: ${alternative.summary}`);
      console.log(`  ${alternative.nodeLabels.join(" -> ")}`);
    }
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