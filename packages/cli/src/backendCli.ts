import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

export const OAG_CLI_COMMANDS = [
  "doctor",
  "dogfood",
  "graph:export",
  "graph:query",
  "graph:path",
  "graph:explain",
  "graph:check",
  "graph:docs:check",
  "graph:context",
  "graph:scorecard",
  "graph:learn",
  "graph:retrieve",
  "graph:update",
] as const;

export type OagCliCommand = (typeof OAG_CLI_COMMANDS)[number];

const COMMAND_ENTRY: Record<OagCliCommand, string> = {
  doctor: "doctor.js",
  dogfood: "dogfood.js",
  "graph:export": "graphExport.js",
  "graph:query": "graphQuery.js",
  "graph:path": "graphPath.js",
  "graph:explain": "graphExplain.js",
  "graph:check": "graphCheck.js",
  "graph:docs:check": "graphDocsCheck.js",
  "graph:context": "graphContext.js",
  "graph:scorecard": "graphScorecard.js",
  "graph:learn": "graphLearn.js",
  "graph:retrieve": "graphRetrieve.js",
  "graph:update": "graphUpdate.js",
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
    '  oag doctor --workspace "./my-app"',
    '  oag dogfood --workspace "./my-app"',
    '  oag graph:export --workspace "./my-app" --offline-only --redact-root',
    '  oag graph:query --workspace "./my-app" --mode code "entry point"',
    '  oag graph:path --workspace "./my-app" "MainViewModel" "PlaybackService"',
    '  oag graph:docs:check --workspace "./my-app" --json --suggest',
    '  oag graph:context --workspace "./my-app" --goal "orient me" --include-verification --json',
    '  oag graph:scorecard --workspace "./my-app" --agentic-sdlc --json',
    '  oag graph:learn --workspace "./my-app" --json',
    '  oag graph:retrieve --workspace "./my-app" --id "oag:node:<id>" --json',
    '  oag graph:update --workspace "./my-app"',
  ];
  return lines.join("\n");
}

export function packageRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}