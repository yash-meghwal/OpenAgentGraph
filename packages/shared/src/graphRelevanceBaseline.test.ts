import { describe, expect, it } from "vitest";
import { evaluateGraphRelevanceBaseline, evaluateGraphRelevanceBaselineSuite, GRAPH_QUERY_MODE_BASELINE_MIN_SUCCESS_RATE } from "./graphRelevanceBaseline.js";
import { evaluateGraphGuidanceConsistency } from "./graphGuidanceConsistency.js";
import {
  evaluateGraphPathQualityBenchmark,
  GRAPH_PATH_QUALITY_BENCHMARKS,
  hasOrderedRelationSubsequence,
} from "./graphPathQuality.js";
import { evaluateGraphQueryModeBenchmark, GRAPH_QUERY_MODE_BENCHMARKS } from "./graphQueryModeBenchmark.js";
import { GraphWorkflowTimingCollector } from "./graphWorkflowTiming.js";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { getReadTheseFirstNodes } from "./graphReadFirst.js";
import { buildGraphGodNodeSummaries } from "./graphLenses.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-22T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "App/ViewModels/MainViewModel.cs", metadata: { scannerSymbolKind: "class" } },
      { id: "sym:iface", kind: "symbol", label: "IPlayerAdapter (interface)", path: "Core/Services/IPlayerAdapter.cs", metadata: { scannerSymbolKind: "interface" } },
      { id: "sym:adapter", kind: "symbol", label: "MpvPlayerAdapter (class)", path: "Core/Services/MpvPlayerAdapter.cs", metadata: { scannerSymbolKind: "class" } },
      { id: "sym:svc", kind: "symbol", label: "PlaybackService (class)", path: "Core/Services/PlaybackService.cs", metadata: { scannerSymbolKind: "class" } },
      { id: "doc:playback", kind: "doc_file", label: "docs/playback.md", path: "docs/playback.md" },
      { id: "comm:app", kind: "community", label: "App", path: "App" },
      { id: "comm:core", kind: "community", label: "Core", path: "Core" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "sym:vm", targetNodeId: "sym:iface", kind: "depends_on", provenance: "extracted" },
      { id: "e2", sourceNodeId: "sym:iface", targetNodeId: "sym:adapter", kind: "uses", provenance: "extracted", metadata: { scannerRelation: "references" } },
      { id: "e2b", sourceNodeId: "sym:adapter", targetNodeId: "sym:svc", kind: "depends_on", provenance: "extracted" },
      { id: "e3", sourceNodeId: "doc:playback", targetNodeId: "sym:adapter", kind: "documents", provenance: "inferred", confidence: 0.8, metadata: { scannerRelation: "doc_code_ref" } },
      { id: "e4", sourceNodeId: "sym:vm", targetNodeId: "comm:app", kind: "belongs_to", provenance: "extracted" },
      { id: "e5", sourceNodeId: "sym:adapter", targetNodeId: "comm:core", kind: "belongs_to", provenance: "extracted" },
      { id: "e6", sourceNodeId: "sym:svc", targetNodeId: "comm:core", kind: "belongs_to", provenance: "extracted" },
    ],
  };
}

describe("graph relevance baseline contracts", () => {
  it("defines path-quality and query-mode benchmark contracts", () => {
    expect(GRAPH_PATH_QUALITY_BENCHMARKS.length).toBeGreaterThanOrEqual(3);
    expect(GRAPH_QUERY_MODE_BENCHMARKS.length).toBeGreaterThanOrEqual(6);
    expect(GRAPH_QUERY_MODE_BENCHMARKS.some((entry) => entry.mode === "code")).toBe(true);
    expect(GRAPH_QUERY_MODE_BENCHMARKS.some((entry) => entry.mode === "docs")).toBe(true);
    expect(GRAPH_QUERY_MODE_BENCHMARKS.some((entry) => entry.mode === "balanced")).toBe(true);
  });

  it("evaluates path quality metrics for connected code paths", () => {
    const benchmark = GRAPH_PATH_QUALITY_BENCHMARKS.find((entry) =>
      entry.fixture === "fixture-csharp-media-player" && entry.to === "MpvPlayerAdapter"
    );
    expect(benchmark).toBeDefined();
    const result = evaluateGraphPathQualityBenchmark(makeGraph(), benchmark!);
    expect(result.passed).toBe(true);
    expect(result.metrics.directnessScore).toBeGreaterThan(0);
    expect(hasOrderedRelationSubsequence(result.metrics.relationSequence, benchmark!.preferredRelationSequence ?? [])).toBe(true);
    expect(result.pathLabels.join(" ")).toMatch(/MainViewModel|MpvPlayerAdapter/i);
  });

  it("fails preferredRelationSequence when only partial semantic edges are present", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      edges: [
        { id: "e1", sourceNodeId: "sym:vm", targetNodeId: "sym:adapter", kind: "depends_on", provenance: "extracted" },
        { id: "e2", sourceNodeId: "sym:adapter", targetNodeId: "sym:svc", kind: "depends_on", provenance: "extracted" },
      ],
    };
    const result = evaluateGraphPathQualityBenchmark(graph, {
      fixture: "fixture-csharp-media-player",
      from: "MainViewModel",
      to: "MpvPlayerAdapter",
      fromPattern: /MainViewModel/i,
      toPattern: /MpvPlayerAdapter/i,
      preferredRelationSequence: ["calls", "references"],
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/Preferred relation sequence 'calls>references' not present/);
    expect(hasOrderedRelationSubsequence(["depends_on"], ["calls", "references"])).toBe(false);
    expect(hasOrderedRelationSubsequence(["depends_on", "references"], ["depends_on", "references"])).toBe(true);
  });

  it("detects guidance disagreement between god nodes and read-first", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      nodes: [
        ...makeGraph().nodes,
        { id: "sym:zebra", kind: "symbol", label: "ZebraTelemetryService (class)", path: "Core/Services/ZebraTelemetryService.cs", metadata: { scannerSymbolKind: "class" } },
      ],
    };
    expect(getReadTheseFirstNodes(graph, 3)[0]?.label).toMatch(/MainViewModel/i);
    expect(buildGraphGodNodeSummaries(graph, 3).length).toBeGreaterThan(0);
    const consistency = evaluateGraphGuidanceConsistency(graph);
    expect(consistency.ok).toBe(false);
    expect(consistency.globalTopLabels[0]).toMatch(/MainViewModel/i);
    expect(consistency.godNodeTopLabels.length + consistency.hubStartLabels.length).toBeGreaterThan(0);
    expect(consistency.disagreements).toContain(
      "God-node guidance does not include global read-first primary 'App/ViewModels/MainViewModel.cs'."
    );
  });

  it("fails path quality when resolved endpoints do not match required patterns", () => {
    const result = evaluateGraphPathQualityBenchmark(makeGraph(), {
      fixture: "fixture-csharp-media-player",
      from: "MainViewModel",
      to: "MpvPlayerAdapter",
      fromPattern: /NoSuchSymbol/i,
      toPattern: /AlsoMissing/i,
    });
    expect(result.passed).toBe(false);
    expect(result.metrics.endpointFidelityOk).toBe(false);
    expect(result.detail).toMatch(/From endpoint .* does not match/);
    expect(result.detail).toMatch(/To endpoint .* does not match/);
  });

  it("records workflow stage timings without paths in stage ids", () => {
    const timing = new GraphWorkflowTimingCollector();
    timing.start("file_collection");
    timing.end("file_collection");
    const report = timing.buildReport(true);
    expect(report.stages.some((entry) => entry.stage === "file_collection")).toBe(true);
    expect(report.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("aggregates baseline suite measurements without requiring release-gate pass", () => {
    const suite = evaluateGraphRelevanceBaselineSuite({
      results: [
        {
          fixture: "fixture-csharp-media-player",
          graph: makeGraph(),
        },
      ],
    });
    expect(suite.results).toHaveLength(1);
    expect(suite.pathQualityPassRate).toBe(1);
    expect(suite.queryModePassRate).toBeGreaterThanOrEqual(GRAPH_QUERY_MODE_BASELINE_MIN_SUCCESS_RATE);
    expect(suite.results[0]?.pathQuality.every((entry) => entry.passed)).toBe(true);
    expect(suite.version).toBeTruthy();
  });

  it("measures query-mode baseline ranking on synthetic graphs", () => {
    const codeBenchmark = GRAPH_QUERY_MODE_BENCHMARKS.find((entry) =>
      entry.fixture === "fixture-csharp-media-player" && entry.mode === "code"
    );
    expect(codeBenchmark).toBeDefined();
    const codeResult = evaluateGraphQueryModeBenchmark(makeGraph(), codeBenchmark!);
    expect(codeResult.topLabels.length).toBeGreaterThan(0);

    const baseline = evaluateGraphRelevanceBaseline({
      fixture: "fixture-csharp-media-player",
      graph: makeGraph(),
    });
    expect(baseline.pathQuality.length).toBeGreaterThan(0);
    expect(baseline.pathQuality.every((entry) => entry.passed)).toBe(true);
    expect(baseline.queryMode.length).toBeGreaterThan(0);
    expect(baseline.queryModePassRate).toBeGreaterThanOrEqual(GRAPH_QUERY_MODE_BASELINE_MIN_SUCCESS_RATE);
    expect(codeResult.passed).toBe(true);
  });
});