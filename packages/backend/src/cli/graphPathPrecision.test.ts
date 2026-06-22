import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { evaluateGraphPathBenchmark, GRAPH_PATH_BENCHMARKS } from "@openagentgraph/shared";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";

vi.setConfig({ testTimeout: 60_000 });

function fixtureRoot(...segments: string[]) {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..", "tests", "fixtures", "graph", ...segments);
}

describe("graph path precision fixtures", () => {
  it("avoids doc_section detours for MainViewModel -> MpvPlayerAdapter", async () => {
    const scan = await runKernelWorkspaceScan(fixtureRoot("fixture-csharp-media-player"));
    const benchmark = GRAPH_PATH_BENCHMARKS.find(
      (entry) => entry.fixture === "fixture-csharp-media-player" && entry.to === "MpvPlayerAdapter"
    );
    expect(benchmark).toBeDefined();
    const evaluated = evaluateGraphPathBenchmark(scan.unifiedGraph, benchmark!);
    expect(evaluated.passed).toBe(true);
    expect(evaluated.pathLabels.join(" ")).toMatch(/MpvPlayerAdapter/i);
    expect(evaluated.pathLabels.some((label) => /doc_section/i.test(label))).toBe(false);
  });
});