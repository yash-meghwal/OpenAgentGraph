import type { GraphUpdateMode } from "./graphIncremental.js";
import type { GraphWorkflowTimingReport } from "./graphWorkflowTiming.js";

export const GRAPH_UPDATE_BENCHMARK_DOGFOOD_MAX_WARM_MS = 30_000;
export const GRAPH_UPDATE_BENCHMARK_FIXTURE_MAX_WARM_MS = 15_000;
export const GRAPH_UPDATE_BENCHMARK_WARM_REPEAT_MAX_RATIO = 0.5;

export type GraphUpdateBenchmarkScenarioId =
  | "typescript-10"
  | "csharp-10"
  | "mixed-10"
  | "docs-heavy-10"
  | "unchanged-warm"
  | "generated-noop";

export interface GraphUpdateBenchmarkScenario {
  id: GraphUpdateBenchmarkScenarioId;
  label: string;
  baseFixture: string;
  changedFiles: number;
  expectMode: GraphUpdateMode;
  generatedOnly?: boolean;
}

export const GRAPH_UPDATE_BENCHMARK_SCENARIO_IDS = [
  "typescript-10",
  "csharp-10",
  "mixed-10",
  "docs-heavy-10",
  "unchanged-warm",
  "generated-noop",
] as const satisfies readonly GraphUpdateBenchmarkScenarioId[];

export function isGraphUpdateBenchmarkScenarioId(
  value: string
): value is GraphUpdateBenchmarkScenarioId {
  return (GRAPH_UPDATE_BENCHMARK_SCENARIO_IDS as readonly string[]).includes(value);
}

export function parseGraphUpdateBenchmarkScenarioId(value: string): GraphUpdateBenchmarkScenarioId {
  if (!isGraphUpdateBenchmarkScenarioId(value)) {
    throw new Error(
      `Unknown graph update benchmark scenario '${value}'. Valid scenarios: ${GRAPH_UPDATE_BENCHMARK_SCENARIO_IDS.join(", ")}.`
    );
  }
  return value;
}

export const GRAPH_UPDATE_BENCHMARK_SCENARIOS: GraphUpdateBenchmarkScenario[] = [
  {
    id: "typescript-10",
    label: "10 changed TypeScript files",
    baseFixture: "fixture-next-app",
    changedFiles: 10,
    expectMode: "incremental",
  },
  {
    id: "csharp-10",
    label: "10 changed C# files",
    baseFixture: "fixture-csharp-wpf",
    changedFiles: 10,
    expectMode: "incremental",
  },
  {
    id: "mixed-10",
    label: "10 changed mixed repo files",
    baseFixture: "mixed-dotnet-node",
    changedFiles: 10,
    expectMode: "incremental",
  },
  {
    id: "docs-heavy-10",
    label: "10 changed files in docs-heavy workspace",
    baseFixture: "fixture-docs-mixed-code",
    changedFiles: 10,
    expectMode: "incremental",
  },
  {
    id: "unchanged-warm",
    label: "unchanged warm repeat",
    baseFixture: "fixture-next-app",
    changedFiles: 0,
    expectMode: "noop",
  },
  {
    id: "generated-noop",
    label: "generated-only change noop",
    baseFixture: "fixture-csharp-wpf",
    changedFiles: 0,
    expectMode: "noop",
    generatedOnly: true,
  },
];

export interface GraphUpdateBenchmarkResult {
  scenarioId: GraphUpdateBenchmarkScenarioId | "workspace-custom";
  label: string;
  /** Benchmark execution root (temp copy for custom workspaces unless --in-place). */
  workspaceRoot: string;
  /** Original workspace path when a temp copy was used. */
  sourceWorkspaceRoot?: string;
  passed: boolean;
  errors: string[];
  coldScanMs: number;
  warmUpdateMs: number;
  changedFileCount: number;
  rescannedFileCount: number;
  neighborExpansionCount: number;
  updateMode: GraphUpdateMode;
  fallbackReasons: string[];
  touchedPaths: string[];
  stageTimings?: GraphWorkflowTimingReport;
  filesScanned?: number;
  filesReused?: number;
}

export interface GraphUpdateBenchmarkSuiteResult {
  ok: boolean;
  results: GraphUpdateBenchmarkResult[];
  errors: string[];
  maxWarmMs: number;
}

export function assertGraphUpdateFallbackReasons(
  mode: GraphUpdateMode,
  reasons: string[],
  options: { forcedFull?: boolean } = {}
) {
  const errors: string[] = [];
  if (mode !== "full") return errors;
  if (options.forcedFull) return errors;
  if (reasons.length === 0) {
    errors.push("Full scan fallback is missing an explicit reason.");
    return errors;
  }
  const combined = reasons.join(" ").trim();
  if (combined.length < 8) {
    errors.push(`Full scan fallback reason is too vague: "${combined}".`);
  }
  return errors;
}

export function evaluateGraphUpdateBenchmarkResult(
  result: GraphUpdateBenchmarkResult,
  options: { maxWarmMs: number; expectMode?: GraphUpdateMode } = { maxWarmMs: GRAPH_UPDATE_BENCHMARK_FIXTURE_MAX_WARM_MS }
): string[] {
  const errors: string[] = [];
  const expectMode = options.expectMode ?? result.updateMode;

  if (result.updateMode !== expectMode) {
    errors.push(`Expected update mode '${expectMode}' but got '${result.updateMode}'.`);
  }

  errors.push(...assertGraphUpdateFallbackReasons(result.updateMode, result.fallbackReasons));

  if (result.updateMode === "incremental" && result.warmUpdateMs > options.maxWarmMs) {
    errors.push(`Warm update ${result.warmUpdateMs}ms exceeds ${options.maxWarmMs}ms budget.`);
  }

  if (result.updateMode === "noop" && result.rescannedFileCount > 0) {
    errors.push(`Noop update rescanned ${result.rescannedFileCount} file(s).`);
  }

  if (result.scenarioId === "generated-noop" && result.changedFileCount > 0) {
    errors.push("Generated-only benchmark reported changed source files.");
  }

  if (result.scenarioId === "unchanged-warm" && result.coldScanMs > 0) {
    const warmRatio = result.warmUpdateMs / result.coldScanMs;
    if (warmRatio > GRAPH_UPDATE_BENCHMARK_WARM_REPEAT_MAX_RATIO) {
      errors.push(
        `Warm repeat ${result.warmUpdateMs}ms exceeds ${Math.round(GRAPH_UPDATE_BENCHMARK_WARM_REPEAT_MAX_RATIO * 100)}% of cold ${result.coldScanMs}ms (${warmRatio.toFixed(2)}x).`
      );
    }
  }

  return errors;
}

export function evaluateGraphUpdateBenchmarkSuite(
  results: GraphUpdateBenchmarkResult[],
  options: { maxWarmMs?: number; requireAllScenarios?: boolean } = {}
): GraphUpdateBenchmarkSuiteResult {
  const maxWarmMs = options.maxWarmMs ?? GRAPH_UPDATE_BENCHMARK_FIXTURE_MAX_WARM_MS;
  const scenarioIds = new Set(GRAPH_UPDATE_BENCHMARK_SCENARIOS.map((scenario) => scenario.id));
  const errors: string[] = [];

  if (options.requireAllScenarios !== false) {
    for (const scenarioId of scenarioIds) {
      if (!results.some((result) => result.scenarioId === scenarioId)) {
        errors.push(`Update benchmark scenario '${scenarioId}' is missing.`);
      }
    }
  }

  const evaluated = results.map((result) => {
    const scenario = GRAPH_UPDATE_BENCHMARK_SCENARIOS.find((entry) => entry.id === result.scenarioId);
    const scenarioErrors = evaluateGraphUpdateBenchmarkResult(result, {
      maxWarmMs,
      expectMode: scenario?.expectMode,
    });
    const passed = scenarioErrors.length === 0;
    if (!passed) {
      errors.push(`${result.label}: ${scenarioErrors.join(" ")}`);
    }
    return { ...result, passed, errors: scenarioErrors };
  });

  return {
    ok: errors.length === 0,
    results: evaluated,
    errors,
    maxWarmMs,
  };
}

export function formatGraphUpdateBenchmarkReport(results: GraphUpdateBenchmarkResult[]) {
  const lines = ["# Graph Update Benchmark", ""];
  for (const result of results) {
    lines.push(`## ${result.label}`);
    lines.push(`- Workspace: \`${result.workspaceRoot}\``);
    lines.push(`- Passed: ${result.passed ? "yes" : "no"}`);
    lines.push(`- Cold scan: ${result.coldScanMs}ms`);
    lines.push(`- Warm update: ${result.warmUpdateMs}ms`);
    lines.push(`- Update mode: ${result.updateMode}`);
    lines.push(`- Changed files: ${result.changedFileCount}`);
    lines.push(`- Rescanned files: ${result.rescannedFileCount}`);
    lines.push(`- Dependency neighbors: ${result.neighborExpansionCount}`);
    if (result.fallbackReasons.length > 0) {
      lines.push(`- Fallback reasons: ${result.fallbackReasons.join("; ")}`);
    }
    if (result.touchedPaths.length > 0) {
      lines.push(`- Touched paths: ${result.touchedPaths.join(", ")}`);
    }
    if (typeof result.filesScanned === "number") {
      lines.push(`- Files scanned: ${result.filesScanned}`);
    }
    if (typeof result.filesReused === "number") {
      lines.push(`- Files reused: ${result.filesReused}`);
    }
    if (result.stageTimings) {
      lines.push(`- Stage timings: total ${result.stageTimings.totalMs}ms`);
      for (const stage of result.stageTimings.stages.slice(0, 8)) {
        lines.push(`  - ${stage.stage}: ${stage.durationMs}ms`);
      }
    }
    if (result.errors.length > 0) {
      lines.push(`- Errors: ${result.errors.join("; ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function formatGraphUpdateBenchmarkSummaryLine(
  suite: GraphUpdateBenchmarkSuiteResult
) {
  const warmMs = suite.results
    .filter((result) => result.updateMode === "incremental")
    .reduce((max, result) => Math.max(max, result.warmUpdateMs), 0);
  return `Update benchmarks: ${suite.ok ? "PASS" : "FAIL"} scenarios=${suite.results.length} maxWarmMs=${warmMs} budget=${suite.maxWarmMs}ms`;
}