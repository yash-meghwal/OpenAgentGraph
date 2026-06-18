import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  evaluateGraphExternalBenchmark,
  evaluateGraphExternalBenchmarkSuite,
  formatGraphExternalBenchmarkReport,
  GRAPH_EXTERNAL_BENCHMARK_CATALOG,
  GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS,
  reportContainsSourceBodyLeak,
} from "./graphExternalBenchmark.js";

function makeGraph(overrides: Partial<UnifiedCodeGraph> = {}): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: ".",
    generatedAt: "2026-06-18T00:00:00.000Z",
    nodes: [
      { id: "file:src/app.ts", kind: "code_file", label: "src/app.ts", path: "src/app.ts" },
      { id: "symbol:App", kind: "symbol", label: "App (class)", path: "src/app.ts", scannerId: "typescript" },
    ],
    edges: [
      {
        id: "edge:1",
        sourceNodeId: "symbol:App",
        targetNodeId: "file:src/app.ts",
        kind: "belongs_to",
        provenance: "extracted",
        source: "typescript",
        confidence: 0.92,
      },
    ],
    activeScannerIds: ["typescript"],
    diagnostics: [],
    ...overrides,
  };
}

describe("graphExternalBenchmark", () => {
  it("defines all public benchmark categories with local fixtures", () => {
    expect(GRAPH_EXTERNAL_BENCHMARK_CATALOG).toHaveLength(GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS.length);
    for (const categoryId of GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS) {
      expect(GRAPH_EXTERNAL_BENCHMARK_CATALOG.some((entry) => entry.id === categoryId)).toBe(true);
    }
  });

  it("builds scorecards with actionable scanner tasks on failure", () => {
    const result = evaluateGraphExternalBenchmark({
      categoryId: "typescript-web",
      workspaceRoot: "/tmp/demo",
      graph: makeGraph({ nodes: [], edges: [] }),
      scanMs: 12,
      localFixture: "fixture-next-app",
    });
    expect(result.passed).toBe(false);
    expect(result.errors.some((error) => error.includes("No useful symbol"))).toBe(true);
    expect(result.scannerTasks.some((task) => task.includes("typescript-web"))).toBe(true);
  });

  it("formats reports without source body leaks", () => {
    const result = evaluateGraphExternalBenchmark({
      categoryId: "docs-only",
      workspaceRoot: "/tmp/docs",
      graph: makeGraph(),
      scanMs: 8,
      localFixture: "fixture-docs-only",
    });
    const report = formatGraphExternalBenchmarkReport([result]);
    expect(report).toContain("scorecard metrics only");
    expect(reportContainsSourceBodyLeak(report)).toBe(false);
    expect(report).not.toMatch(/export function|public class/);
  });

  it("evaluates suites and reports missing categories", () => {
    const suite = evaluateGraphExternalBenchmarkSuite([
      {
        categoryId: "typescript-web",
        label: "TypeScript web app",
        workspaceRoot: ".",
        referenceRepo: "https://example.com",
        scanSuccess: true,
        scanMs: 1,
        indexedFileCount: 1,
        usefulSymbolCount: 1,
        queryBenchmarkPassRate: 1,
        pathBenchmarkPassRate: 1,
        misleadingHandoffRate: 0,
        exportCompleteness: true,
        provenanceCoverage: 1,
        updateTimeMs: null,
        passed: true,
        errors: [],
        scannerTasks: [],
      },
    ]);
    expect(suite.ok).toBe(false);
    expect(suite.errors.some((error) => error.includes("missing"))).toBe(true);
  });
});