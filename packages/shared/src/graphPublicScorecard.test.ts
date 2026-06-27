import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
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
});