import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { buildAgenticSdlcScorecard } from "./graphAgenticSdlcScorecard.js";
import { evaluateContextNoise } from "./graphContextNoise.js";
import { buildGraphPublicScorecard } from "./graphPublicScorecard.js";

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
    ],
    edges: [],
  };
}

const minimalReleaseResults = [
  {
    fixture: "fixture-csharp-wpf",
    graph: makeGraph(),
    scanMs: 1,
  },
];

describe("graph public scorecard honesty", () => {
  it("reports update benchmarks as not_run when update inputs are omitted", () => {
    const scorecard = buildGraphPublicScorecard({ releaseResults: minimalReleaseResults });

    expect(scorecard.updateBenchmarkStatus).toBe("not_run");
    expect(scorecard.rows.find((row) => row.metric === "Update benchmark status")?.value).toBe("not_run");
  });

  it("reports CLI clean-install smoke as not_run by default", () => {
    const scorecard = buildGraphPublicScorecard({ releaseResults: minimalReleaseResults });

    expect(scorecard.cliCleanInstallSmokeStatus).toBe("not_run");
    expect(scorecard.rows.find((row) => row.metric === "CLI clean-install smoke")?.value).toBe("not_run");
  });

  it("reports explicit CLI clean-install smoke pass as PASS", () => {
    const scorecard = buildGraphPublicScorecard({
      releaseResults: minimalReleaseResults,
      cliCleanInstallSmokeStatus: "pass",
    });

    expect(scorecard.cliCleanInstallSmokeStatus).toBe("PASS");
    expect(scorecard.rows.find((row) => row.metric === "CLI clean-install smoke")?.value).toBe("PASS");
  });

  it("reports explicit CLI clean-install smoke fail as FAIL and known gap", () => {
    const scorecard = buildGraphPublicScorecard({
      releaseResults: minimalReleaseResults,
      cliCleanInstallSmokeStatus: "fail",
    });

    expect(scorecard.cliCleanInstallSmokeStatus).toBe("FAIL");
    expect(scorecard.rows.find((row) => row.metric === "CLI clean-install smoke")?.value).toBe("FAIL");
    expect(scorecard.knownGaps.some((gap) => /CLI clean-install smoke test failed/i.test(gap))).toBe(true);
  });

  it("reflects lower agentic context readiness when fixture samples use harness context-noise diagnostics", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1",
      workspaceRoot: "/workspace/noisy",
      generatedAt: "2026-06-29T00:00:00.000Z",
      activeScannerIds: ["typescript"],
      diagnostics: ["Broken doc link in README.md:4: docs/missing.md"],
      nodes: [
        { id: "file:0", kind: "doc_file", label: "README.md", path: "README.md" },
        { id: "file:1", kind: "code_file", label: "generated-output.js", path: "generated-output.js" },
        { id: "file:2", kind: "code_file", label: "build/output.js", path: "build/output.js" },
        { id: "file:3", kind: "doc_file", label: "PLAN-STALE-1.5.md", path: "PLAN-STALE-1.5.md" },
      ],
      edges: [],
    };

    const bareNoise = evaluateContextNoise(graph);
    const diagnosticNoise = evaluateContextNoise(graph, {
      trackedGeneratedPaths: ["generated-output.js", "build/output.js"],
      rootPlanFiles: ["PLAN-STALE-1.5.md"],
    });
    const withDiagnostics = buildAgenticSdlcScorecard({
      workspaceRoot: "/workspace/noisy",
      graph,
      contextNoise: diagnosticNoise,
    });
    const withoutDiagnostics = buildAgenticSdlcScorecard({
      workspaceRoot: "/workspace/noisy",
      graph,
      contextNoise: bareNoise,
    });

    expect(diagnosticNoise.score).toBeLessThan(bareNoise.score);
    expect(diagnosticNoise.noiseItems.some((item) => item.path === "generated-output.js")).toBe(true);
    const diagnosticContext = withDiagnostics.categories.find((category) => category.id === "context_readiness");
    const bareContext = withoutDiagnostics.categories.find((category) => category.id === "context_readiness");
    expect(diagnosticContext?.score).toBeLessThan(bareContext?.score ?? 100);
    expect(buildGraphPublicScorecard({
      releaseResults: minimalReleaseResults,
      agenticSdlcFixtureSamples: [
        { fixture: "fixture-agentic-harness-noisy", overallScore: withDiagnostics.overallScore, ok: withDiagnostics.ok },
      ],
    }).agenticSdlcNoisyScore).toBe(withDiagnostics.overallScore);
  });

  it("includes measured agentic SDLC fixture scores when provided", () => {
    const scorecard = buildGraphPublicScorecard({
      releaseResults: minimalReleaseResults,
      agenticSdlcFixtureSamples: [
        { fixture: "fixture-agentic-harness-good", overallScore: 86, ok: true },
        { fixture: "fixture-agentic-harness-missing", overallScore: 52, ok: false },
        { fixture: "fixture-agentic-harness-conflicting", overallScore: 61, ok: false },
        { fixture: "fixture-agentic-harness-noisy", overallScore: 58, ok: false },
      ],
    });

    expect(scorecard.agenticSdlcGoodScore).toBe(86);
    expect(scorecard.agenticSdlcMissingScore).toBe(52);
    expect(scorecard.agenticSdlcConflictingScore).toBe(61);
    expect(scorecard.agenticSdlcNoisyScore).toBe(58);
    expect(scorecard.agenticSdlcGoodScore).toBeGreaterThan(scorecard.agenticSdlcNoisyScore ?? 0);
    expect(scorecard.rows.some((row) => row.metric === "Agentic SDLC readiness (good fixture)")).toBe(true);
  });

  it("includes measured harness context noise fixture scores when provided", () => {
    const scorecard = buildGraphPublicScorecard({
      releaseResults: minimalReleaseResults,
      harnessContextNoiseSamples: [
        { fixture: "fixture-agentic-harness-good", score: 92 },
        { fixture: "fixture-agentic-harness-noisy", score: 41 },
      ],
    });

    expect(scorecard.harnessContextNoiseGoodScore).toBe(92);
    expect(scorecard.harnessContextNoiseNoisyScore).toBe(41);
    expect(scorecard.harnessContextNoiseGoodScore).toBeGreaterThan(scorecard.harnessContextNoiseNoisyScore ?? 0);
    expect(scorecard.rows.some((row) => row.metric === "Harness context noise (good fixture)")).toBe(true);
    expect(scorecard.rows.some((row) => row.metric === "Harness context noise (noisy fixture)")).toBe(true);
  });
});