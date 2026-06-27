import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  evaluateEcosystemSupportMatrixGate,
  evaluateGraphPathBenchmark,
  evaluateGraphQueryBenchmark,
  evaluateHandoffReadFirstHygiene,
  evaluateReleaseBenchmarkSuite,
  GRAPH_PATH_BENCHMARKS,
  GRAPH_QUERY_BENCHMARKS,
  GRAPH_RELEASE_FIXTURE_IDS,
  GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE,
  type GraphReleaseFixtureId,
} from "./graphReleaseGates.js";
import { renderUnifiedGraphHandoffReport } from "./graphArtifacts.js";

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

  it("passes csharp path benchmarks", () => {
    const benchmark = GRAPH_PATH_BENCHMARKS.find((entry) => entry.fixture === "fixture-csharp-wpf");
    expect(benchmark).toBeTruthy();
    const result = evaluateGraphPathBenchmark(makeGraph(), benchmark!);
    expect(result.passed).toBe(true);
  });

  it("requires active scanners in the ecosystem support matrix", () => {
    const graph = makeGraph();
    const handoff = renderUnifiedGraphHandoffReport(graph, {
      kernelProfile: {
        schemaVersion: "1.0",
        root: "/workspace",
        effectiveRoots: ["/workspace"],
        primaryType: "dotnet",
        secondaryTypes: [],
        typeSignals: [],
        sourceRoots: ["."],
        markerPaths: ["App.sln"],
        activeScannerIds: ["dotnet"],
        ignoreRules: [],
        sourceExtensionCounts: { ".cs": 2 },
        skippedCountsByReason: {},
        warnings: [],
      },
    });
    const gate = evaluateEcosystemSupportMatrixGate({ graph, handoffMarkdown: handoff });
    expect(gate.ok).toBe(true);
    expect(gate.missingInHandoff).toEqual([]);
  });

  it("defines query or path benchmarks for every release fixture", () => {
    for (const fixtureId of GRAPH_RELEASE_FIXTURE_IDS) {
      const hasBenchmark =
        GRAPH_QUERY_BENCHMARKS.some((benchmark) => benchmark.fixture === fixtureId)
        || GRAPH_PATH_BENCHMARKS.some((benchmark) => benchmark.fixture === fixtureId);
      expect(hasBenchmark, fixtureId).toBe(true);
    }
  });

  it("fails when release fixtures are missing from benchmark suite input", () => {
    const suite = evaluateReleaseBenchmarkSuite({
      results: [
        {
          fixture: "fixture-csharp-wpf",
          graph: makeGraph(),
          scanMs: 1,
        },
      ],
    });

    expect(suite.ok).toBe(false);
    expect(suite.errors.some((error) => error.includes("missing from benchmark suite input"))).toBe(true);
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

    expect(suite.agentBenchmarkSuccessRate).toBeGreaterThanOrEqual(GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE);
    expect(suite.misleadingHandoffRate).toBe(0);
    expect(suite.ok).toBe(false);
    expect(suite.errors.some((error) => error.includes("missing from benchmark suite input"))).toBe(true);
  });

  it("uses the suite-wide benchmark threshold instead of requiring every benchmark to pass", () => {
    const fixtureGraphs = [
      { fixture: "fixture-next-app", labels: ["No expected query seed here"] },
      { fixture: "fixture-python-django", labels: ["User model"] },
      { fixture: "fixture-go-module", labels: ["Runner service"] },
      { fixture: "fixture-rust-workspace", labels: ["CoreService api"] },
      { fixture: "fixture-terraform", labels: ["aws_s3_bucket main"] },
      { fixture: "fixture-docs-only", labels: ["architecture guide"] },
      { fixture: "fixture-empty", labels: ["workspace"] },
      { fixture: "fixture-ruby-gem", labels: ["Mygem Runner module"] },
      { fixture: "fixture-dart-package", labels: ["Calculator add"] },
      { fixture: "fixture-unreal-lite", labels: ["DemoGameMode module"] },
    ];

    const suite = evaluateReleaseBenchmarkSuite({
      results: fixtureGraphs.map((entry) => ({
        fixture: entry.fixture,
        graph: makeBenchmarkGraph(entry.labels),
        scanMs: 1,
      })),
    });

    expect(suite.agentBenchmarkSuccessRate).toBeGreaterThanOrEqual(GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE);
    expect(suite.agentBenchmarkSuccessRate).toBeLessThan(1);
    expect(suite.errors.some((error) => error.includes("missing from benchmark suite input"))).toBe(true);
  });

  it("fails the query floor when path benchmarks mask low query success", () => {
    const queryFailFixtures = new Set<GraphReleaseFixtureId>([
      "fixture-next-app",
      "fixture-python-django",
      "fixture-go-module",
      "fixture-rust-workspace",
      "fixture-terraform",
    ]);

    function makeConnectedBenchmarkGraph(labels: string[]): UnifiedCodeGraph {
      const graph = makeBenchmarkGraph(labels);
      if (labels.length >= 2) {
        graph.edges = [
          {
            id: "e1",
            sourceNodeId: "node:0",
            targetNodeId: "node:1",
            kind: "references",
            provenance: "inferred",
          },
        ];
      }
      return graph;
    }

    const suite = evaluateReleaseBenchmarkSuite({
      results: GRAPH_RELEASE_FIXTURE_IDS.map((fixture) => {
        const queryBenchmark = GRAPH_QUERY_BENCHMARKS.find((benchmark) => benchmark.fixture === fixture);
        const pathBenchmarks = GRAPH_PATH_BENCHMARKS.filter((benchmark) => benchmark.fixture === fixture);
        const labels = queryFailFixtures.has(fixture)
          ? ["No expected query seed here"]
          : pathBenchmarks.length > 0
            ? [pathBenchmarks[0].from, pathBenchmarks[0].to, queryBenchmark?.query.split(" ")[0] ?? pathBenchmarks[0].from]
            : queryBenchmark
              ? [queryBenchmark.query]
              : ["workspace"];

        return {
          fixture,
          graph: makeConnectedBenchmarkGraph(labels),
          scanMs: 1,
        };
      }),
    });

    expect(suite.querySuccessRate).toBeLessThan(GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE);
    expect(suite.agentBenchmarkSuccessRate).toBeGreaterThanOrEqual(GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE);
    expect(suite.ok).toBe(false);
    expect(
      suite.errors.some((error) => /Query benchmark success rate .* is below 90%/.test(error))
    ).toBe(true);
  });
});
