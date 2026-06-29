import fs from "fs/promises";
import path from "path";
import { analyzeGraphLearnLog, type GraphLearnProposalResult } from "@openagentgraph/shared";
import { buildWorkspaceHarnessImprovementProposals } from "./graphHarnessSnapshot.js";
import { loadWorkspaceUnifiedGraph, normalizeWorkspaceCliPath, requireWorkspaceOption } from "./graphWorkspace.js";
import { readRequiredCliValue } from "./productGraphDataDir.js";

interface GraphLearnCliOptions {
  workspace?: string;
  fromLog?: string;
  output?: string;
  json: boolean;
  refresh: boolean;
}

function parseGraphLearnArgv(argv: string[]) {
  const options: GraphLearnCliOptions = {
    json: false,
    refresh: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      options.workspace = normalizeWorkspaceCliPath(readRequiredCliValue(argv, index, "--workspace"));
      index += 1;
    } else if (arg === "--from-log") {
      options.fromLog = readRequiredCliValue(argv, index, "--from-log");
      index += 1;
    } else if (arg === "--output") {
      options.output = readRequiredCliValue(argv, index, "--output");
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--refresh") {
      options.refresh = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown graph:learn option: ${arg}`);
    } else {
      throw new Error(`Unknown graph:learn argument: ${arg}`);
    }
  }

  if (!options.workspace?.trim() && !options.fromLog?.trim()) {
    throw new Error('graph:learn requires --workspace "<path>" and/or --from-log "<path-to-log>".');
  }

  return options;
}

function renderCombinedLearnMarkdown(
  harnessProposalsMarkdown: string | undefined,
  logResult: GraphLearnProposalResult | undefined,
  combinedMode: boolean
) {
  const lines = [
    "# OAG Learn Proposal",
    "",
    "Review-only proposals. OAG does not auto-edit AGENTS.md, README.md, LLMS.md, or source files.",
    "",
  ];

  if (harnessProposalsMarkdown) {
    lines.push("## Workspace harness proposals", "");
    lines.push(harnessProposalsMarkdown.trim(), "");
  }

  if (logResult) {
    if (combinedMode) {
      lines.push(
        "## Log analysis (merged into harness proposals above)",
        "",
        `Log findings analyzed: ${logResult.findingCount}`,
        ""
      );
      for (const finding of logResult.findings) {
        lines.push(`- \`${finding.code}\`: ${finding.title}`);
        for (const evidence of finding.evidence.slice(0, 3)) {
          lines.push(`  - ${evidence}`);
        }
      }
      lines.push("");
    } else {
      lines.push(logResult.markdown.replace(/^# OAG Learn Proposal\s*/i, "").trim(), "");
    }
  }

  return `${lines.filter((line) => line !== undefined).join("\n")}\n`;
}

export async function runGraphLearnCli(argv = process.argv.slice(2)) {
  const options = parseGraphLearnArgv(argv);
  const workspaceRoot = options.workspace ? requireWorkspaceOption(options.workspace) : undefined;
  const logText = options.fromLog ? await fs.readFile(path.resolve(options.fromLog), "utf8") : undefined;
  const combinedMode = Boolean(workspaceRoot && logText);

  const logResult = logText
    ? analyzeGraphLearnLog(logText, { workspaceRoot })
    : undefined;

  let harnessProposals;
  if (workspaceRoot) {
    const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: options.refresh });
    harnessProposals = await buildWorkspaceHarnessImprovementProposals(workspaceRoot, loaded, {
      learnLogText: logText,
    });
  }

  const markdown = renderCombinedLearnMarkdown(
    harnessProposals?.markdown,
    logResult,
    combinedMode
  );
  const outputPath = path.resolve(options.output ?? "OAG-LEARN-PROPOSAL.md");
  await fs.writeFile(outputPath, markdown, "utf8");

  const payload = {
    status: "graph_learn_complete",
    workspaceRoot,
    outputPath,
    harnessProposals,
    logFindings: logResult,
    proposalCount: harnessProposals?.proposalCount ?? 0,
    findingCount: logResult?.findingCount ?? 0,
    combinedMode,
    reviewOnlyDisclaimer: harnessProposals?.reviewOnlyDisclaimer
      ?? "Review-only proposals. OAG does not auto-edit AGENTS.md, README.md, LLMS.md, or source files.",
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Wrote learn proposal to ${outputPath}`);
    if (harnessProposals) {
      console.log(`Harness proposals: ${harnessProposals.proposalCount}`);
    }
    if (logResult) {
      console.log(`Log findings: ${logResult.findingCount}`);
    }
    if (combinedMode) {
      console.log("Combined mode: log findings merged into harness proposals");
    }
  }

  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphLearn\.(?:ts|js)$/.test(invokedPath)) {
  runGraphLearnCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}