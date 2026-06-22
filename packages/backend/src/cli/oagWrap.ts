import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { runGraphContextCli } from "./graphContext.js";
import { runGraphExportCli } from "./graphExport.js";
import { normalizeWorkspaceCliPath, requireWorkspaceOption, tryLoadCachedWorkspaceGraph } from "./graphWorkspace.js";
import { readRequiredCliValue } from "./productGraphDataDir.js";

type SupportedAgent = "codex" | "claude" | "gemini" | "grok";

interface OagWrapCliOptions {
  workspace?: string;
  goal?: string;
  agent?: SupportedAgent;
  printOnly: boolean;
  launch: boolean;
  redactRoot: boolean;
}

const AGENT_EXECUTABLES: Record<SupportedAgent, string[]> = {
  codex: ["codex", "codex.cmd"],
  claude: ["claude", "claude.cmd"],
  gemini: ["gemini", "gemini.cmd"],
  grok: ["grok", "grok.cmd"],
};

function parseOagWrapArgv(argv: string[]) {
  const options: OagWrapCliOptions = { printOnly: false, launch: false, redactRoot: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      options.workspace = normalizeWorkspaceCliPath(readRequiredCliValue(argv, index, "--workspace"));
      index += 1;
    } else if (arg === "--goal") {
      options.goal = readRequiredCliValue(argv, index, "--goal");
      index += 1;
    } else if (arg === "--agent") {
      const value = readRequiredCliValue(argv, index, "--agent");
      if (!["codex", "claude", "gemini", "grok"].includes(value)) {
        throw new Error("--agent must be codex, claude, gemini, or grok.");
      }
      options.agent = value as SupportedAgent;
      index += 1;
    } else if (arg === "--print") {
      options.printOnly = true;
    } else if (arg === "--launch") {
      options.launch = true;
    } else if (arg === "--redact-root") {
      options.redactRoot = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown oag:wrap option: ${arg}`);
    } else {
      throw new Error(`Unknown oag:wrap argument: ${arg}`);
    }
  }

  if (!options.goal?.trim()) {
    throw new Error('oag:wrap requires --goal "<task>".');
  }

  return options;
}

function findAgentExecutable(agent: SupportedAgent): string | undefined {
  for (const candidate of AGENT_EXECUTABLES[agent]) {
    const result = spawnSync(process.platform === "win32" ? "where" : "which", [candidate], {
      encoding: "utf8",
      shell: true,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function buildAgentInstructions(agent: SupportedAgent | undefined, goal: string, workspaceRoot: string) {
  const agentLabel = agent ?? "your agent";
  return [
    `# OAG Wrapper Instructions for ${agentLabel}`,
    "",
    `Goal: ${goal}`,
    `Workspace: ${workspaceRoot}`,
    "",
    "1. Read the OAG context pack printed below.",
    "2. Prefer read-first nodes and retrieval IDs before broad file scanning.",
    "3. Run suggested graph:query and graph:path commands when you need more detail.",
    "4. Do not commit generated .oag artifacts or GRAPH_REPORT.md.",
    "",
  ].join("\n");
}

export async function runOagWrapCli(argv = process.argv.slice(2)) {
  const options = parseOagWrapArgv(argv);
  const workspaceRoot = requireWorkspaceOption(options.workspace);

  const cached = await tryLoadCachedWorkspaceGraph(workspaceRoot);
  if (!cached) {
    console.log("No .oag/graph.json found — running graph:export first.");
    await runGraphExportCli([
      "--workspace",
      workspaceRoot,
      "--offline-only",
      ...(options.redactRoot ? ["--redact-root"] : []),
    ]);
  }

  const contextArgv = [
    "--workspace",
    workspaceRoot,
    "--goal",
    options.goal!,
    "--json",
    ...(options.redactRoot ? ["--redact-root"] : []),
  ];
  const context = await runGraphContextCli(contextArgv);

  const instructions = buildAgentInstructions(options.agent, options.goal!, workspaceRoot);
  console.log(instructions);
  console.log(JSON.stringify(context, null, 2));

  if (options.launch && options.agent) {
    const executable = findAgentExecutable(options.agent);
    if (!executable) {
      console.warn(`Agent executable not found for ${options.agent}; printed context only.`);
      return { launched: false, context };
    }
    console.log(`Launching ${executable} (wrapper does not pass hidden prompts).`);
    spawnSync(executable, [], { stdio: "inherit", shell: true });
    return { launched: true, context };
  }

  if (!options.printOnly && !options.launch) {
    console.log("Copy the context pack and instructions above into your agent session.");
  }

  return { launched: false, context };
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/oagWrap\.(?:ts|js)$/.test(invokedPath)) {
  runOagWrapCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}