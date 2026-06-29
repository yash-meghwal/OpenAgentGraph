import type { UnifiedCodeGraph } from "./codeGraph.js";
import type { HarnessWorkspaceMetadata } from "./graphHarnessReadiness.js";
import type { GraphQueryIntentMode } from "./graphQueryIntent.js";
import {
  buildVerificationMap,
  type GraphVerificationCommand,
  type GraphVerificationMap,
  type VerificationCommandCategory,
  type VerificationCommandConfidence,
} from "./graphVerificationMap.js";

export type GoalTaskIntent =
  | "general"
  | "docs"
  | "graph"
  | "backend"
  | "frontend"
  | "tests";

export interface GraphVerificationPlan {
  beforeEditing: string[];
  afterEditing: string[];
  fallback: string[];
  confidence: VerificationCommandConfidence | "mixed" | "low";
}

export interface BuildTaskVerificationPlanInput {
  graph: UnifiedCodeGraph;
  goal?: string;
  queryMode?: GraphQueryIntentMode;
  metadata?: HarnessWorkspaceMetadata;
  verificationMap?: GraphVerificationMap;
  readFirstPaths?: string[];
  relevantDocPaths?: string[];
}

export interface GraphTaskVerificationSummary {
  likelyFiles: string[];
  likelyTests: string[];
  suggestedCommands: string[];
  docsToCheck: string[];
  riskNotes: string[];
  unsupportedAssumptions: string[];
  verificationPlan: GraphVerificationPlan;
  goalIntent: GoalTaskIntent;
}

const GOAL_INTENT_TOKENS: Record<Exclude<GoalTaskIntent, "general">, string[]> = {
  docs: ["doc", "docs", "readme", "architecture", "guide", "llms", "handoff", "contributing"],
  graph: ["graph", "oag", "export", "query", "path", "fusion", "handoff", "wiki"],
  backend: ["backend", "server", "api", "service", "core", "controller", "middleware"],
  frontend: ["frontend", "view", "component", "react", "ui", "xaml", "page"],
  tests: ["test", "tests", "spec", "fixture", "regression"],
};

const CATEGORY_BY_INTENT: Record<GoalTaskIntent, VerificationCommandCategory[]> = {
  general: ["graph_verification", "unit_test", "build", "lint"],
  docs: ["docs_check", "graph_verification", "lint"],
  graph: ["graph_verification", "docs_check"],
  backend: ["unit_test", "build", "typecheck", "lint"],
  frontend: ["unit_test", "build", "lint"],
  tests: ["unit_test", "integration_test", "graph_verification"],
};

function tokenizeGoal(goal?: string): string[] {
  if (!goal?.trim()) return [];
  return goal
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

export function classifyGoalTaskIntent(
  goal?: string,
  queryMode: GraphQueryIntentMode = "balanced"
): GoalTaskIntent {
  const tokens = tokenizeGoal(goal);
  if (tokens.length === 0) {
    if (queryMode === "docs") return "docs";
    if (queryMode === "code") return "general";
    return "general";
  }

  const scores = new Map<GoalTaskIntent, number>();
  for (const [intent, keywords] of Object.entries(GOAL_INTENT_TOKENS) as Array<
    [Exclude<GoalTaskIntent, "general">, string[]]
  >) {
    const score = tokens.filter((token) => keywords.some((keyword) => token.includes(keyword) || keyword.includes(token))).length;
    if (score > 0) scores.set(intent, score);
  }

  if (scores.size === 0) return queryMode === "docs" ? "docs" : "general";

  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]);
  const topScore = ranked[0][1];
  const topIntents = ranked.filter(([, score]) => score === topScore).map(([intent]) => intent);
  if (topIntents.includes("graph")) return "graph";
  if (topIntents.includes("docs")) return "docs";
  if (topIntents.includes("backend")) return "backend";
  if (topIntents.includes("frontend")) return "frontend";
  if (topIntents.includes("tests")) return "tests";
  return topIntents[0] ?? "general";
}

function pathMatchesGoal(path: string, tokens: string[]): boolean {
  const normalized = normalizePath(path).toLowerCase();
  if (tokens.length === 0) return true;
  return tokens.some((token) => normalized.includes(token));
}

function isTestNodePath(path: string) {
  const normalized = normalizePath(path);
  return /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)/i.test(normalized)
    || /\.tests?\./i.test(normalized)
    || /Tests?\./.test(normalized);
}

function collectLikelyFiles(graph: UnifiedCodeGraph, tokens: string[], readFirstPaths: string[]): string[] {
  const fromReadFirst = readFirstPaths.filter((path) => pathMatchesGoal(path, tokens));
  const fromGraph = graph.nodes
    .filter((node) => ["code_file", "symbol", "config_file"].includes(node.kind))
    .map((node) => node.path ?? node.label)
    .filter((path): path is string => Boolean(path))
    .filter((path) => pathMatchesGoal(path, tokens));

  return [...new Set([...fromReadFirst, ...fromGraph])].slice(0, 8);
}

function collectLikelyTests(graph: UnifiedCodeGraph, tokens: string[]): string[] {
  const tests = graph.nodes
    .filter((node) => {
      const path = node.path ?? node.label;
      if (!path) return false;
      if (node.kind === "test") return true;
      return isTestNodePath(path);
    })
    .map((node) => node.path ?? node.label)
    .filter((path): path is string => Boolean(path))
    .filter((path) => tokens.length === 0 || pathMatchesGoal(path, tokens));

  return [...new Set(tests)].slice(0, 8);
}

function collectDocsToCheck(
  graph: UnifiedCodeGraph,
  tokens: string[],
  relevantDocPaths: string[],
  intent: GoalTaskIntent
): string[] {
  const docPaths = graph.nodes
    .filter((node) => node.kind === "doc_file" || node.kind === "doc_section")
    .map((node) => node.path ?? node.label)
    .filter((path): path is string => Boolean(path))
    .filter((path) => intent === "docs" || tokens.length === 0 || pathMatchesGoal(path, tokens));

  const prioritized = [
    ...relevantDocPaths,
    ...docPaths.filter((path) => /readme|agents|architecture|contributing|llms/i.test(path)),
    ...docPaths,
  ];

  return [...new Set(prioritized.map(normalizePath))].slice(0, 8);
}

function inferWorkspaceScope(goal?: string, likelyFiles: string[] = []): string | undefined {
  const haystack = `${goal ?? ""} ${likelyFiles.join(" ")}`.toLowerCase();
  const packageMatch = haystack.match(/packages\/([a-z0-9_-]+)/i)
    ?? likelyFiles.map((file) => file.match(/^packages\/([^/]+)/i)?.[1]).find(Boolean);
  if (packageMatch) {
    const pkg = typeof packageMatch === "string" ? packageMatch : packageMatch[1];
    return `packages/${pkg}`;
  }
  if (/\bbackend\b/.test(haystack)) return "packages/backend";
  if (/\bshared\b/.test(haystack)) return "packages/shared";
  if (/\bcli\b/.test(haystack)) return "packages/cli";
  return undefined;
}

function commandMatchesScope(entry: GraphVerificationCommand, scope?: string) {
  if (!scope) return false;
  const normalizedScope = scope.replace(/\\/g, "/");
  return entry.command.includes(`--workspace=${normalizedScope}`)
    || entry.command.includes(`--workspace ${normalizedScope}`)
    || entry.command.includes(normalizedScope)
    || entry.source.includes(`${normalizedScope}/package.json`);
}

function filterDiscoveredCommands(commands: string[], map: GraphVerificationMap): string[] {
  const discovered = new Set(map.commands.map((entry) => entry.command));
  return [...new Set(commands.filter((command) => discovered.has(command)))];
}

function isUsableCommand(command: GraphVerificationCommand) {
  return !command.risky && command.category !== "risky" && command.category !== "release" && command.category !== "packaging";
}

function pickCommands(
  map: GraphVerificationMap,
  categories: VerificationCommandCategory[],
  options: {
    scope?: string;
    limit?: number;
    preferConfidence?: VerificationCommandConfidence[];
  } = {}
): string[] {
  const limit = options.limit ?? 4;
  const preferConfidence = options.preferConfidence ?? ["script_defined", "ci_observed", "doc_mentioned"];

  const candidates = map.commands.filter((entry) =>
    isUsableCommand(entry) && categories.includes(entry.category)
  );

  const ranked = candidates.sort((left, right) => {
    const leftScope = commandMatchesScope(left, options.scope) ? 1 : 0;
    const rightScope = commandMatchesScope(right, options.scope) ? 1 : 0;
    if (leftScope !== rightScope) return rightScope - leftScope;

    const leftConfidence = preferConfidence.indexOf(left.confidence);
    const rightConfidence = preferConfidence.indexOf(right.confidence);
    const leftRank = leftConfidence === -1 ? preferConfidence.length : leftConfidence;
    const rightRank = rightConfidence === -1 ? preferConfidence.length : rightConfidence;
    if (leftRank !== rightRank) return leftRank - rightRank;

    return left.command.localeCompare(right.command);
  });

  return [...new Set(ranked.map((entry) => entry.command))].slice(0, limit);
}

function aggregateConfidence(commands: string[], map: GraphVerificationMap): GraphVerificationPlan["confidence"] {
  if (commands.length === 0) return "low";
  const confidences = commands
    .map((command) => map.commands.find((entry) => entry.command === command)?.confidence)
    .filter((value): value is VerificationCommandConfidence => Boolean(value));

  if (confidences.length === 0) return "low";
  if (confidences.every((value) => value === "inferred")) return "inferred";
  if (new Set(confidences).size > 1) return "mixed";
  return confidences[0];
}

function buildScopedTestCommand(map: GraphVerificationMap, scope?: string): string | undefined {
  const scoped = pickCommands(map, ["unit_test"], { scope, limit: 1 });
  if (scoped[0]) return scoped[0];
  if (scope) return undefined;
  return pickCommands(map, ["unit_test"], { limit: 1 })[0];
}

function hasDiscoveredScopedCommand(map: GraphVerificationMap, scope?: string) {
  if (!scope) return true;
  return map.commands.some((entry) => isUsableCommand(entry) && commandMatchesScope(entry, scope));
}

function buildVerificationPlan(
  map: GraphVerificationMap,
  intent: GoalTaskIntent,
  scope?: string
): GraphVerificationPlan {
  const categories = CATEGORY_BY_INTENT[intent];
  const beforeCategories: VerificationCommandCategory[] = intent === "docs"
    ? ["docs_check", "graph_verification"]
    : intent === "graph"
      ? ["graph_verification", "docs_check"]
      : ["graph_verification"];

  const beforeEditing = filterDiscoveredCommands(
    pickCommands(map, beforeCategories, { scope, limit: 3 }),
    map
  );
  const afterEditing = filterDiscoveredCommands(
    intent === "docs"
      ? pickCommands(map, ["docs_check", "lint"], { scope, limit: 3 })
      : intent === "graph"
        ? pickCommands(map, ["graph_verification"], { scope, limit: 2 })
        : [
          buildScopedTestCommand(map, scope),
          ...pickCommands(map, ["build", "typecheck", "lint"], { scope, limit: 2 }),
        ].filter((command): command is string => Boolean(command)).slice(0, 3),
    map
  );

  let resolvedFallback = filterDiscoveredCommands(
    map.recommendedDefault
      .filter((command) => map.commands.some((entry) => entry.command === command && isUsableCommand(entry)))
      .slice(0, 2),
    map
  );
  if (resolvedFallback.length === 0) {
    resolvedFallback = filterDiscoveredCommands(pickCommands(map, categories, { scope, limit: 2 }), map);
  }

  const confidence = aggregateConfidence(
    [...beforeEditing, ...afterEditing, ...resolvedFallback],
    map
  );

  return {
    beforeEditing,
    afterEditing,
    fallback: resolvedFallback,
    confidence,
  };
}

function collectRiskNotes(map: GraphVerificationMap, plan: GraphVerificationPlan): string[] {
  const notes: string[] = [];
  for (const conflict of map.conflicts.slice(0, 3)) {
    notes.push(`Conflicting ${conflict.category.replace(/_/g, " ")} commands: ${conflict.commands.slice(0, 3).join(", ")}`);
  }

  const riskyNearSuggested = map.commands
    .filter((entry) => entry.risky || entry.category === "risky")
    .slice(0, 2)
    .map((entry) => `Risky command available but not suggested: ${entry.command}`);
  notes.push(...riskyNearSuggested);

  if (plan.afterEditing.length === 0) {
    notes.push("No focused after-editing verification command matched this goal; use fallback commands.");
  }

  return notes.slice(0, 6);
}

function collectUnsupportedAssumptions(
  map: GraphVerificationMap,
  intent: GoalTaskIntent,
  scope?: string,
  likelyTests: string[] = []
): string[] {
  const assumptions: string[] = [];

  if (scope) {
    assumptions.push(`Scoped verification suggestions to workspace path ${scope} based on goal/file hints.`);
    if (!hasDiscoveredScopedCommand(map, scope)) {
      assumptions.push("A workspace-scoped npm command may be needed, but no discovered command was found.");
    }
  }

  if (intent === "backend" && !map.commands.some((entry) => entry.category === "unit_test" && isUsableCommand(entry))) {
    assumptions.push("No backend unit test command was discovered; after-editing checks may be incomplete.");
  }

  if (intent === "docs" && !map.commands.some((entry) => entry.category === "docs_check" && isUsableCommand(entry))) {
    assumptions.push("No docs-check command was discovered for this repo.");
  }

  if (likelyTests.length === 0 && (intent === "tests" || intent === "backend" || intent === "frontend")) {
    assumptions.push("No graph-indexed test files matched the goal tokens.");
  }

  if (map.commands.some((entry) => entry.confidence === "inferred" && map.gaps.length > 0)) {
    assumptions.push("Some commands are inferred from ecosystem files rather than scripts or CI.");
  }

  return assumptions.slice(0, 6);
}

export function buildTaskVerificationPlan(input: BuildTaskVerificationPlanInput): GraphTaskVerificationSummary {
  const tokens = tokenizeGoal(input.goal);
  const goalIntent = classifyGoalTaskIntent(input.goal, input.queryMode);
  const verificationMap = input.verificationMap ?? buildVerificationMap(input.graph, input.metadata ?? {});
  const readFirstPaths = (input.readFirstPaths ?? []).map(normalizePath);
  const relevantDocPaths = (input.relevantDocPaths ?? []).map(normalizePath);

  const likelyFiles = collectLikelyFiles(input.graph, tokens, readFirstPaths);
  const likelyTests = collectLikelyTests(input.graph, tokens);
  const docsToCheck = collectDocsToCheck(input.graph, tokens, relevantDocPaths, goalIntent);
  const scope = inferWorkspaceScope(input.goal, likelyFiles);
  const verificationPlan = buildVerificationPlan(verificationMap, goalIntent, scope);

  const suggestedCommands = filterDiscoveredCommands([
    ...verificationPlan.beforeEditing,
    ...verificationPlan.afterEditing,
    ...verificationPlan.fallback,
  ], verificationMap).slice(0, 8);

  return {
    likelyFiles,
    likelyTests,
    suggestedCommands,
    docsToCheck,
    riskNotes: collectRiskNotes(verificationMap, verificationPlan),
    unsupportedAssumptions: collectUnsupportedAssumptions(verificationMap, goalIntent, scope, likelyTests),
    verificationPlan,
    goalIntent,
  };
}