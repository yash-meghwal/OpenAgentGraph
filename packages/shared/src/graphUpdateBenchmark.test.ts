import { describe, expect, it } from "vitest";
import {
  assertGraphUpdateFallbackReasons,
  evaluateGraphUpdateBenchmarkResult,
  evaluateGraphUpdateBenchmarkSuite,
  formatGraphUpdateBenchmarkReport,
  GRAPH_UPDATE_BENCHMARK_FIXTURE_MAX_WARM_MS,
  parseGraphUpdateBenchmarkScenarioId,
} from "./graphUpdateBenchmark.js";

describe("graph update benchmark", () => {
  it("rejects unknown benchmark scenario ids", () => {
    expect(() => parseGraphUpdateBenchmarkScenarioId("not-a-scenario")).toThrow(/Unknown graph update benchmark scenario/);
    expect(parseGraphUpdateBenchmarkScenarioId("generated-noop")).toBe("generated-noop");
  });

  it("requires explicit fallback reasons for unexpected full scans", () => {
    expect(assertGraphUpdateFallbackReasons("full", []).some((error) => error.includes("missing an explicit reason"))).toBe(true);
    expect(assertGraphUpdateFallbackReasons("full", ["No graph-manifest.json found."])).toEqual([]);
    expect(assertGraphUpdateFallbackReasons("full", [], { forcedFull: true })).toEqual([]);
  });

  it("evaluates warm update budgets and noop rescans", () => {
    const incrementalErrors = evaluateGraphUpdateBenchmarkResult({
      scenarioId: "typescript-10",
      label: "typescript",
      workspaceRoot: "/tmp",
      passed: false,
      errors: [],
      coldScanMs: 1000,
      warmUpdateMs: GRAPH_UPDATE_BENCHMARK_FIXTURE_MAX_WARM_MS + 1,
      changedFileCount: 10,
      rescannedFileCount: 12,
      neighborExpansionCount: 2,
      updateMode: "incremental",
      fallbackReasons: [],
      touchedPaths: [],
    });
    expect(incrementalErrors.some((error) => error.includes("exceeds"))).toBe(true);

    const noopErrors = evaluateGraphUpdateBenchmarkResult({
      scenarioId: "generated-noop",
      label: "generated noop",
      workspaceRoot: "/tmp",
      passed: false,
      errors: [],
      coldScanMs: 1000,
      warmUpdateMs: 5,
      changedFileCount: 0,
      rescannedFileCount: 1,
      neighborExpansionCount: 0,
      updateMode: "noop",
      fallbackReasons: [],
      touchedPaths: [],
    }, { expectMode: "noop" });
    expect(noopErrors.some((error) => error.includes("rescanned"))).toBe(true);
  });

  it("formats a copyable benchmark report", () => {
    const suite = evaluateGraphUpdateBenchmarkSuite([
      {
        scenarioId: "csharp-10",
        label: "10 changed C# files",
        workspaceRoot: "/tmp/workspace",
        passed: true,
        errors: [],
        coldScanMs: 1200,
        warmUpdateMs: 240,
        changedFileCount: 10,
        rescannedFileCount: 11,
        neighborExpansionCount: 3,
        updateMode: "incremental",
        fallbackReasons: [],
        touchedPaths: ["Services/A.cs"],
      },
    ]);
    const report = formatGraphUpdateBenchmarkReport(suite.results);
    expect(report).toContain("# Graph Update Benchmark");
    expect(report).toContain("Cold scan: 1200ms");
    expect(report).toContain("Warm update: 240ms");
    expect(report).toContain("Dependency neighbors: 3");
  });
});