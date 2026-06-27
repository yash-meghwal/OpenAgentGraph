import {
  collectDocLinkDiagnostics,
  renderBrokenDocLinksMarkdown,
  renderDocRepairSuggestionsMarkdown,
  summarizeDocLinkHygiene,
  summarizeDocLinkRepair,
} from "@openagentgraph/shared";
import {
  loadWorkspaceUnifiedGraph,
  parseGraphWorkspaceArgv,
  requireWorkspaceOption,
  warnIgnoredGraphCliOptions,
} from "./graphWorkspace.js";

export async function runGraphDocsCheckCli(argv = process.argv.slice(2)) {
  const { options, positionals } = parseGraphWorkspaceArgv(argv, "docs-check");
  if (!options.json) warnIgnoredGraphCliOptions("docs-check", options);
  const workspaceRoot = requireWorkspaceOption(options.workspace);
  if (positionals.length > 0) {
    throw new Error(`Unknown graph:docs:check arguments: ${positionals.join(" ")}`);
  }

  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: options.refresh });
  const hygiene = summarizeDocLinkHygiene(loaded.graph);
  const repair = summarizeDocLinkRepair(loaded.graph);
  const payload = {
    status: hygiene.ok ? "doc_links_ok" : "doc_links_broken",
    workspaceRoot,
    fromCache: loaded.fromCache,
    ok: hygiene.ok,
    brokenCount: hygiene.brokenCount,
    byReason: hygiene.byReason,
    diagnostics: hygiene.diagnostics,
    repair: {
      actionableCount: repair.actionableCount,
      withRecommendationCount: repair.withRecommendationCount,
      ambiguousCount: repair.ambiguousCount,
      reproduceCommand: repair.reproduceCommand,
      proposals: repair.proposals,
      topSuggestions: repair.topSuggestions,
    },
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Workspace: ${workspaceRoot}`);
    console.log(`Broken doc links: ${hygiene.brokenCount}`);
    for (const line of renderBrokenDocLinksMarkdown(collectDocLinkDiagnostics(loaded.graph))) {
      if (line.length > 0) console.log(line);
    }
    if (options.suggest) {
      for (const line of renderDocRepairSuggestionsMarkdown(repair.proposals)) {
        if (line.length > 0) console.log(line);
      }
      console.log(`Repair suggestions: ${repair.withRecommendationCount}/${repair.actionableCount} actionable`);
      console.log(`Reproduce: ${repair.reproduceCommand} --workspace "${workspaceRoot}"`);
    }
    console.log(hygiene.ok ? "Result: PASS" : "Result: WARN");
  }

  if (!hygiene.ok) {
    process.exitCode = 1;
  }

  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphDocsCheck\.(?:ts|js)$/.test(invokedPath)) {
  runGraphDocsCheckCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}