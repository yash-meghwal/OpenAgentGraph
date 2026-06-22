import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

export const OAG_CLI_COMMANDS = [
  "graph:export",
  "graph:query",
  "graph:path",
  "graph:explain",
  "graph:check",
  "graph:docs:check",
  "graph:context",
] as const;

export type OagCliCommand = (typeof OAG_CLI_COMMANDS)[number];

const COMMAND_ENTRY: Record<OagCliCommand, string> = {
  "graph:export": "graphExport.js",
  "graph:query": "graphQuery.js",
  "graph:path": "graphPath.js",
  "graph:explain": "graphExplain.js",
  "graph:check": "graphCheck.js",
  "graph:docs:check": "graphDocsCheck.js",
  "graph:context": "graphContext.js",
};

export function resolveBackendCliEntry(command: string) {
  if (!(command in COMMAND_ENTRY)) return undefined;
  const backendRoot = path.dirname(require.resolve("@openagentgraph/backend/package.json"));
  return path.join(backendRoot, "dist", "cli", COMMAND_ENTRY[command as OagCliCommand]);
}

export function renderOagCliHelp() {
  const lines = [
    "OpenAgentGraph CLI (oag)",
    "",
    "Usage:",
    "  oag <command> [options]",
    "",
    "Commands:",
    ...OAG_CLI_COMMANDS.map((command) => `  ${command}`),
    "",
    "Global options are forwarded to the underlying graph command.",
    "All graph commands require --workspace <path>.",
    "",
    "Examples:",
    '  oag graph:export --workspace "./my-app" --offline-only --redact-root',
    '  oag graph:path --workspace "./my-app" "MainViewModel" "PlaybackService"',
    '  oag graph:docs:check --workspace "./my-app" --json',
  ];
  return lines.join("\n");
}

export function packageRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}