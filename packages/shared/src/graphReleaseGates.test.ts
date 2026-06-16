import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  evaluateGraphQueryBenchmark,
  evaluateHandoffReadFirstHygiene,
  evaluateReleaseBenchmarkSuite,
  GRAPH_QUERY_BENCHMARKS,
  GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE,
} from "./graphReleaseGates.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-15T12:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
      { id: "file:vm", kind: "code_file", label: "ViewModels/MainViewModel.cs", path: "ViewModels/MainViewModel.cs" },
      { id: "sym:svc", kind: "symbol", label: "PlaybackService (class)", path: "Services/PlaybackService.cs" },
      { id: "file:svc", kind: "code_file", label: "Services/PlaybackService.cs", path: "Services/PlaybackService.cs" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "sym:vm", targetNodeId: "sym:svc", kind: "references", provenance: "inferred" },
    ],
  };
}

function makeBenchmarkGraph(labels: string[]): UnifiedCodeGraph {
  return {
    ...makeGraph(),
    nodes: labels.map((label, index) => ({
      id: `node:${index}`,
      kind: "symbol",
      label,
      path: `${label.replace(/[^A-Za-z0-9]+/g, "-")}.txt`,
    })),
    edges: [],
  };
}

describe("graph release gates", () => {
  it("keeps generated junk out of read-these-first recommendations", () => {
    const hygiene = evaluateHandoffReadFirstHygiene({
      ...makeGraph(),
      nodes: [
        ...makeGraph().nodes,
        { id: "file:bin", kind: "code_file", label: "bin/Debug/libvlc/plugin.js", path: "bin/Debug/libvlc/plugin.js" },
      ],
    });

    expect(hygiene.ok).toBe(true);
    expect(hygiene.junkPaths).toEqual([]);
    expect(hygiene.misleadingHandoffRate).toBe(0);
  });

  it("passes csharp query benchmarks", () => {
    const benchmark = GRAPH_QUERY_BENCHMARKS.find((entry) => entry.fixture === "fixture-csharp-wpf");
    expect(benchmark).toBeTruthy();
    const result = evaluateGraphQueryBenchmark(makeGraph(), benchmark!);
    expect(result.passed).toBe(true);
  });

  it("aggregates release benchmark suite success rate", () => {
    const suite = evaluateReleaseBenchmarkSuite({
      results: [
        {
          fixture: "fixture-csharp-wpf",
          graph: makeGraph(),
          scanMs: 120,
        },
      ],
    });

    expect(suite.querySuccessRate).toBeGreaterThanOrEqual(GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE);
    expect(suite.misleadingHandoffRate).toBe(0);
    expect(suite.ok).toBe(true);
  });

  it("uses the suite-wide query threshold instead of requiring every benchmark to pass", () => {
    const passingLabels = [
      "MainViewModel",
      "PlaybackService",
      "page",
      "User",
      "CheckoutService",
      "Runner",
      "CoreService",
      "aws_s3_bucket",
      "AppService",
      "architecture guide",
    ];
    const fixtureGraphs = [
      { fixture: "fixture-csharp-wpf", labels: ["No expected query seed here"] },
      { fixture: "fixture-csharp-media-player", labels: passingLabels },
      { fixture: "fixture-next-app", labels: passingLabels },
      { fixture: "fixture-python-django", labels: passingLabels },
      { fixture: "fixture-java-maven", labels: passingLabels },
      { fixture: "fixture-go-module", labels: passingLabels },
      { fixture: "fixture-rust-workspace", labels: passingLabels },
      { fixture: "fixture-terraform", labels: passingLabels },
      { fixture: "fixture-mixed-polyglot", labels: passingLabels },
      { fixture: "fixture-docs-only", labels: passingLabels },
      { fixture: "fixture-empty", labels: [] },
    ];

    const suite = evaluateReleaseBenchmarkSuite({
      results: fixtureGraphs.map((entry) => ({
        fixture: entry.fixture,
        graph: makeBenchmarkGraph(entry.labels),
        scanMs: 1,
      })),
    });

    expect(suite.querySuccessRate).toBeGreaterThanOrEqual(GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE);
    expect(suite.querySuccessRate).toBeLessThan(1);
    expect(suite.ok).toBe(true);
  });
});
