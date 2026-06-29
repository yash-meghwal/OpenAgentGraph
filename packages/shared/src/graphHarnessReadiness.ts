import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";

export const HARNESS_READINESS_GOOD_THRESHOLD = 70;

export const HARNESS_AGENT_INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "llms.txt",
  "LLMS.md",
  ".github/copilot-instructions.md",
] as const;

export const HARNESS_ARCHITECTURE_DOC_PATHS = [
  "docs/architecture.md",
  "docs/ARCHITECTURE.md",
  "architecture.md",
] as const;

export interface HarnessWorkspaceMetadata {
  readmeText?: string;
  packageScripts?: Record<string, string>;
  workspacePackageScripts?: Record<string, Record<string, string>>;
  workflowTexts?: Record<string, string>;
  agentInstructionTexts?: Record<string, string>;
  pyprojectTexts?: Record<string, string>;
  pytestIniTexts?: Record<string, string>;
  toxIniTexts?: Record<string, string>;
  cargoTomlTexts?: Record<string, string>;
  goModTexts?: Record<string, string>;
  csprojTexts?: Record<string, string>;
  slnTexts?: Record<string, string>;
  makefileTexts?: Record<string, string>;
  cmakeListsTexts?: Record<string, string>;
  pubspecTexts?: Record<string, string>;
  gradleTexts?: Record<string, string>;
  mavenTexts?: Record<string, string>;
  docTexts?: Record<string, string>;
}

export interface GraphHarnessConflict {
  kind: "test_command" | "agent_instructions" | "build_command";
  detail: string;
  sources: string[];
}

export interface GraphHarnessReadinessSummary {
  score: number;
  ok: boolean;
  present: string[];
  missing: string[];
  conflicts: GraphHarnessConflict[];
  recommendations: string[];
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

function collectIndexedPaths(graph: UnifiedCodeGraph) {
  const paths = new Set<string>();
  for (const node of graph.nodes) {
    const candidate = node.path ?? node.label;
    if (!candidate) continue;
    if (!["code_file", "config_file", "doc_file", "test", "command"].includes(node.kind)) continue;
    paths.add(normalizePath(candidate));
  }
  return paths;
}

function hasPath(paths: Set<string>, target: string) {
  const normalized = normalizePath(target);
  return paths.has(normalized) || [...paths].some((path) => path.endsWith(`/${normalized}`) || path === normalized);
}

function readmeText(paths: Set<string>, metadata?: HarnessWorkspaceMetadata) {
  if (metadata?.readmeText) return metadata.readmeText;
  if (hasPath(paths, "README.md")) return "README.md present";
  return "";
}

function mentionsPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeTestCommand(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized === "npm test") return "npm run test";
  return normalized;
}

function extractMentionedTestCommands(text: string) {
  const matches = new Set<string>();
  const patterns = [
    /npm run ([a-z0-9:_-]+)/gi,
    /npm test(?:\s+--[^\n]*)?/gi,
    /yarn test(?:\s+--[^\n]*)?/gi,
    /pnpm test(?:\s+--[^\n]*)?/gi,
    /vitest(?:\s+run)?/gi,
    /jest(?:\s+--[^\n]*)?/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      matches.add(match[0].trim());
    }
  }
  return [...matches];
}

function detectAgentInstructionConflicts(
  paths: Set<string>,
  metadata?: HarnessWorkspaceMetadata
): GraphHarnessConflict[] {
  const conflicts: GraphHarnessConflict[] = [];
  const presentFiles = HARNESS_AGENT_INSTRUCTION_FILES.filter((file) => hasPath(paths, file));
  const texts: Array<{ source: string; text: string }> = [];

  for (const file of presentFiles) {
    const text = metadata?.agentInstructionTexts?.[file];
    if (text) texts.push({ source: file, text });
  }

  if (texts.length >= 2) {
    const runners = texts.map((entry) => ({
      source: entry.source,
      runner: /vitest/i.test(entry.text)
        ? "vitest"
        : /jest/i.test(entry.text)
          ? "jest"
          : /mocha/i.test(entry.text)
            ? "mocha"
            : undefined,
    }));
    const defined = runners.filter((entry) => entry.runner);
    const uniqueRunners = new Set(defined.map((entry) => entry.runner));
    if (uniqueRunners.size > 1) {
      conflicts.push({
        kind: "agent_instructions",
        detail: "Agent instruction files recommend different test runners.",
        sources: defined.map((entry) => `${entry.source} (${entry.runner})`),
      });
    }
  }

  return conflicts;
}

function isTestLikeCommand(command: string) {
  return /test|vitest|jest|mocha|pytest/i.test(command);
}

function detectTestCommandConflicts(
  paths: Set<string>,
  metadata?: HarnessWorkspaceMetadata
): GraphHarnessConflict[] {
  const readme = readmeText(paths, metadata);
  const readmeTestCommand = extractMentionedTestCommands(readme).find((command) => isTestLikeCommand(command));
  const packageTest = metadata?.packageScripts?.test;
  const workflowTexts = Object.values(metadata?.workflowTexts ?? {}).join("\n");
  const workflowTestCommand = extractMentionedTestCommands(workflowTexts).find((command) => isTestLikeCommand(command));

  const sources: Array<{ source: string; command: string }> = [];
  if (readmeTestCommand) sources.push({ source: "README.md", command: readmeTestCommand });
  if (packageTest) sources.push({ source: "package.json#scripts.test", command: "npm run test" });
  if (workflowTestCommand) sources.push({ source: "ci_workflow", command: workflowTestCommand });

  const normalized = sources.map((entry) => normalizeTestCommand(entry.command));
  const unique = new Set(normalized);
  if (unique.size <= 1 || sources.length <= 1) return [];

  return [{
    kind: "test_command",
    detail: "README, package scripts, or CI workflows disagree on the primary test command.",
    sources: sources.map((entry) => `${entry.source}: ${entry.command}`),
  }];
}

export function evaluateHarnessReadiness(
  graph: UnifiedCodeGraph,
  options: {
    profile?: WorkspaceKernelProfile;
    metadata?: HarnessWorkspaceMetadata;
    goodThreshold?: number;
  } = {}
): GraphHarnessReadinessSummary {
  const paths = collectIndexedPaths(graph);
  const metadata = options.metadata;
  const readme = readmeText(paths, metadata);
  const present: string[] = [];
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  if (hasPath(paths, "README.md")) {
    present.push("README.md");
    score += 12;
  } else {
    missing.push("README.md");
    recommendations.push("Add a README.md with setup and verification commands.");
  }

  if (mentionsPattern(readme, [/npm ci/i, /npm install/i, /pnpm install/i, /yarn install/i])) {
    present.push("setup_instructions");
    score += 14;
  } else {
    missing.push("setup_instructions");
    recommendations.push("Document install/setup commands in README.md.");
  }

  if (
    metadata?.packageScripts?.test
    || mentionsPattern(readme, [/npm test/i, /npm run test/i, /vitest/i, /jest/i, /pytest/i])
    || mentionsPattern(Object.values(metadata?.workflowTexts ?? {}).join("\n"), [/npm test/i, /npm run test/i])
  ) {
    present.push("test_instructions");
    score += 14;
  } else {
    missing.push("test_instructions");
    recommendations.push("Document or define a focused test command.");
  }

  if (
    metadata?.packageScripts?.build
    || mentionsPattern(readme, [/npm run build/i, /cargo build/i, /dotnet build/i, /make\b/i])
  ) {
    present.push("build_instructions");
    score += 10;
  } else {
    missing.push("build_instructions");
  }

  const architectureDoc = HARNESS_ARCHITECTURE_DOC_PATHS.find((docPath) => hasPath(paths, docPath));
  if (architectureDoc) {
    present.push(architectureDoc);
    score += 10;
  } else {
    missing.push("architecture_docs");
    recommendations.push("Add docs/architecture.md describing repo boundaries and verification.");
  }

  const agentFiles = HARNESS_AGENT_INSTRUCTION_FILES.filter((file) => hasPath(paths, file));
  if (agentFiles.length > 0 || hasPath(paths, ".cursor/rules")) {
    present.push(...agentFiles);
    if (hasPath(paths, ".cursor/rules")) present.push(".cursor/rules");
    score += 15;
  } else {
    missing.push("agent_instructions");
    recommendations.push("Add AGENTS.md or llms.txt so coding agents know repo guardrails.");
  }

  const workflowFiles = [...paths].filter((path) => path.startsWith(".github/workflows/") && path.endsWith(".yml"));
  if (workflowFiles.length > 0) {
    present.push("ci_workflow");
    score += 10;
  } else {
    missing.push("ci_workflow");
  }

  if (metadata?.packageScripts && Object.keys(metadata.packageScripts).length > 0) {
    present.push("package_scripts");
    score += 10;
    if (metadata.packageScripts.lint) score += 5;
  } else if (hasPath(paths, "package.json")) {
    present.push("package.json");
    score += 4;
    missing.push("package_scripts");
  }

  const conflicts = [
    ...detectTestCommandConflicts(paths, metadata),
    ...detectAgentInstructionConflicts(paths, metadata),
  ];
  if (conflicts.length > 0) {
    score = Math.max(0, score - conflicts.length * 8);
    recommendations.push("Resolve conflicting setup, test, or agent instruction guidance.");
  }

  score = Math.min(100, score);
  const threshold = options.goodThreshold ?? HARNESS_READINESS_GOOD_THRESHOLD;

  return {
    score,
    ok: score >= threshold && conflicts.length === 0,
    present,
    missing,
    conflicts,
    recommendations,
  };
}