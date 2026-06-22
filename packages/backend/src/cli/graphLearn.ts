import fs from "fs/promises";
import path from "path";
import { analyzeGraphLearnLog } from "@openagentgraph/shared";
import { readRequiredCliValue } from "./productGraphDataDir.js";
import { normalizeWorkspaceCliPath, requireWorkspaceOption } from "./graphWorkspace.js";

interface GraphLearnCliOptions {
  workspace?: string;
  fromLog?: string;
  output?: string;
}

function parseGraphLearnArgv(argv: string[]) {
  const options: GraphLearnCliOptions = {};

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
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown graph:learn option: ${arg}`);
    } else {
      throw new Error(`Unknown graph:learn argument: ${arg}`);
    }
  }

  if (!options.fromLog?.trim()) {
    throw new Error('graph:learn requires --from-log "<path-to-log>".');
  }

  return options;
}

export async function runGraphLearnCli(argv = process.argv.slice(2)) {
  const options = parseGraphLearnArgv(argv);
  const workspaceRoot = options.workspace ? requireWorkspaceOption(options.workspace) : undefined;
  const logPath = path.resolve(options.fromLog!);
  const logText = await fs.readFile(logPath, "utf8");
  const result = analyzeGraphLearnLog(logText, { workspaceRoot });
  const outputPath = path.resolve(options.output ?? "OAG-LEARN-PROPOSAL.md");

  await fs.writeFile(outputPath, result.markdown, "utf8");

  console.log(`Wrote learn proposal to ${outputPath}`);
  console.log(`Findings: ${result.findingCount}`);
  return { ...result, outputPath };
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphLearn\.(?:ts|js)$/.test(invokedPath)) {
  runGraphLearnCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}