import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateGraphRelevanceBaseline,
  GRAPH_PATH_QUALITY_BENCHMARKS,
  GRAPH_QUERY_MODE_BENCHMARKS,
  GRAPH_QUERY_MODE_BASELINE_MIN_SUCCESS_RATE,
  type GraphWorkflowStageId,
} from "@openagentgraph/shared";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";

vi.setConfig({ testTimeout: 120_000 });

function fixtureRoot(...segments: string[]) {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..", "tests", "fixtures", "graph", ...segments);
}

const RELEVANCE_FIXTURES = [
  "fixture-csharp-media-player",
  "fixture-docs-mixed-code",
  "fixture-next-app",
] as const;

const CORE_WORKFLOW_STAGES: GraphWorkflowStageId[] = [
  "workspace_detection",
  "file_collection",
  "structural_indexing",
  "community_construction",
];

function expectStagesPresent(stageIds: GraphWorkflowStageId[], expected: GraphWorkflowStageId[]) {
  for (const stage of expected) {
    expect(stageIds).toContain(stage);
  }
}

describe("graph relevance baseline fixtures", () => {
  for (const fixture of RELEVANCE_FIXTURES) {
    it(`captures baseline measurements for ${fixture}`, async () => {
      const scan = await runKernelWorkspaceScan(fixtureRoot(fixture), { captureStageTimings: true });
      const baseline = evaluateGraphRelevanceBaseline({
        fixture,
        graph: scan.unifiedGraph,
        stageTimings: scan.stageTimings,
      });

      expect(baseline.version).toBeTruthy();
      const pathBenchmarks = GRAPH_PATH_QUALITY_BENCHMARKS.filter((entry) => entry.fixture === fixture);
      if (pathBenchmarks.length > 0) {
        expect(baseline.pathQuality).toHaveLength(pathBenchmarks.length);
        for (const benchmark of pathBenchmarks) {
          const result = baseline.pathQuality.find((entry) => entry.from === benchmark.from && entry.to === benchmark.to);
          expect(result).toBeDefined();
          expect(typeof result?.passed).toBe("boolean");
          expect(result?.metrics.endpointFidelityOk).toBe(true);
        }
      }
      const queryBenchmarks = GRAPH_QUERY_MODE_BENCHMARKS.filter((entry) => entry.fixture === fixture);
      expect(baseline.queryMode).toHaveLength(queryBenchmarks.length);
      expect(baseline.queryMode.every((entry) => entry.passed)).toBe(true);
      expect(baseline.queryModePassRate).toBeGreaterThanOrEqual(GRAPH_QUERY_MODE_BASELINE_MIN_SUCCESS_RATE);

      const stageIds = scan.stageTimings?.stages.map((entry) => entry.stage) ?? [];
      expectStagesPresent(stageIds, CORE_WORKFLOW_STAGES);
      expect(scan.stageTimings?.totalMs).toBeGreaterThan(0);

      if (fixture === "fixture-csharp-media-player") {
        expectStagesPresent(stageIds, ["ecosystem_augmentation", "roslyn_preparation", "roslyn_analysis"]);
        const symbols = scan.unifiedGraph.nodes
          .filter((node) => node.kind === "symbol")
          .map((node) => node.label);
        expect(symbols.some((label) => /ObservableObject|IPlayerAdapter|AlphaHelperService/i.test(label))).toBe(true);
      }
      if (fixture === "fixture-docs-mixed-code") {
        expectStagesPresent(stageIds, ["documentation_indexing", "typescript_semantic_analysis"]);
        const paths = scan.unifiedGraph.nodes.map((node) => node.path ?? node.label);
        expect(paths.some((entry) => /architecture\.md|runbook\.md|controller\.ts/i.test(entry))).toBe(true);
      }
      if (fixture === "fixture-next-app") {
        expectStagesPresent(stageIds, ["typescript_semantic_analysis"]);
        const paths = scan.unifiedGraph.nodes.map((node) => node.path ?? node.label);
        expect(paths.some((entry) => /orders-controller|orders-service|orders-repository/i.test(entry))).toBe(true);
      }
    });
  }

  it("records baseline pass rates that reflect non-zero quality on relevance fixtures", async () => {
    const results = [];
    for (const fixture of RELEVANCE_FIXTURES) {
      const scan = await runKernelWorkspaceScan(fixtureRoot(fixture), { captureStageTimings: true });
      results.push(evaluateGraphRelevanceBaseline({
        fixture,
        graph: scan.unifiedGraph,
        stageTimings: scan.stageTimings,
      }));
    }

    const pathRates = results.map((entry) => entry.pathQualityPassRate);
    const queryRates = results.map((entry) => entry.queryModePassRate);
    expect(GRAPH_PATH_QUALITY_BENCHMARKS.length).toBeGreaterThan(0);
    expect(GRAPH_QUERY_MODE_BENCHMARKS.length).toBeGreaterThan(0);
    for (const result of results) {
      if (result.pathQuality.length > 0) {
        expect(result.pathQuality.every((entry) => typeof entry.passed === "boolean")).toBe(true);
        expect(result.pathQuality.every((entry) => entry.metrics.endpointFidelityOk)).toBe(true);
      }
      expect(result.queryModePassRate).toBeGreaterThanOrEqual(GRAPH_QUERY_MODE_BASELINE_MIN_SUCCESS_RATE);
    }
    expect(pathRates.some((rate) => rate > 0 && rate <= 1)).toBe(true);
    expect(queryRates.every((rate) => rate >= GRAPH_QUERY_MODE_BASELINE_MIN_SUCCESS_RATE)).toBe(true);
  });
});
