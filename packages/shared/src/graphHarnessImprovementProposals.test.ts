import { describe, expect, it } from "vitest";
import { analyzeGraphLearnLog } from "./graphLearnProposal.js";
import { buildHarnessImprovementProposals } from "./graphHarnessImprovementProposals.js";
import type { GraphSpecQualitySummary } from "./graphSpecQuality.js";
import type { GraphContextNoiseSummary } from "./graphContextNoise.js";

const workspaceRoot = "/workspace/demo";

function sparseSpecQuality(): GraphSpecQualitySummary {
  return {
    ok: false,
    score: 12,
    present: ["README.md"],
    missing: ["setup_instructions", "test_instructions", "agent_instructions"],
    conflicts: [],
    risks: ["No unit test command discovered."],
    recommendations: ["Document install/setup commands in README.md."],
  };
}

function conflictingSpecQuality(): GraphSpecQualitySummary {
  return {
    ok: false,
    score: 32,
    present: ["README.md", "AGENTS.md", "package_scripts"],
    missing: ["setup_instructions", "ci_workflow"],
    conflicts: [
      {
        kind: "test_command",
        detail: "README, package scripts, or CI workflows disagree on the primary test command.",
        sources: ["README.md", "package.json", "AGENTS.md"],
      },
      {
        kind: "agent_instructions",
        detail: "Agent instruction files recommend different test runners.",
        sources: ["AGENTS.md", "CLAUDE.md"],
      },
    ],
    risks: [],
    recommendations: [],
  };
}

describe("graphHarnessImprovementProposals", () => {
  it("maps missing harness pieces from spec and verification gaps", () => {
    const result = buildHarnessImprovementProposals({
      workspaceRoot,
      specQuality: sparseSpecQuality(),
      verificationMap: {
        commands: [],
        recommendedDefault: [],
        taskHints: [],
        conflicts: [],
        gaps: ["No unit test command discovered."],
      },
    });

    expect(result.proposalCount).toBeGreaterThan(0);
    expect(result.proposals.some((proposal) => proposal.category === "missing_setup_command")).toBe(true);
    expect(result.proposals.some((proposal) => proposal.category === "missing_test_command")).toBe(true);
    expect(result.proposals.some((proposal) => proposal.category === "missing_agent_instructions")).toBe(true);
    expect(result.proposals.every((proposal) => proposal.safeForAgentAutoApply === false)).toBe(true);
    expect(result.markdown).toContain("does not auto-edit");
  });

  it("classifies conflicting fixture guidance as harness failures", () => {
    const result = buildHarnessImprovementProposals({
      workspaceRoot,
      specQuality: conflictingSpecQuality(),
    });

    const conflictProposals = result.proposals.filter((proposal) =>
      proposal.category === "conflicting_agent_instructions"
    );
    expect(conflictProposals.length).toBeGreaterThan(0);
    expect(conflictProposals.every((proposal) => proposal.failureKind === "harness_failure")).toBe(true);
    expect(result.proposals.some((proposal) => proposal.affectedPath === "AGENTS.md")).toBe(true);
  });

  it("maps context noise to generated-artifact and gitignore proposals", () => {
    const contextNoise: GraphContextNoiseSummary = {
      score: 36,
      noiseItems: [
        {
          kind: "generated_artifact",
          path: "generated-output.js",
          detail: "Tracked or indexed generated artifact likely to pollute agent context.",
          severity: "medium",
        },
        {
          kind: "missing_gitignore_protection",
          detail: "Common generated path 'build/' is not protected by .gitignore.",
          severity: "medium",
        },
      ],
      recommendations: ["Add build/ to .gitignore to keep exports and agents focused."],
    };

    const result = buildHarnessImprovementProposals({ workspaceRoot, contextNoise });
    expect(result.proposals.some((proposal) =>
      proposal.category === "missing_generated_artifact_ignore"
      && proposal.evidence.some((line) => /generated-output\.js/.test(line))
    )).toBe(true);
  });

  it("redacts secrets and absolute paths from evidence", () => {
    const learn = analyzeGraphLearnLog(
      [
        "ENOENT: no such file C:\\Users\\demo\\project\\src\\missing.ts",
        "npm ERR! command failed",
        "sk_test_1234567890abcdef",
      ].join("\n"),
      { workspaceRoot: "C:\\Users\\demo\\project" }
    );

    const result = buildHarnessImprovementProposals({
      workspaceRoot: "C:\\Users\\demo\\project",
      learnLogFindings: learn.findings,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk_test");
    expect(serialized).not.toContain("C:\\\\Users");
    expect(result.proposals.some((proposal) => proposal.failureKind === "model_failure")).toBe(true);
  });

  it("merges learn-log model failures with harness failures without auto-edit", () => {
    const learn = analyzeGraphLearnLog(
      "graph freshness stale .oag/graph.json missing\nNo matching seed for graph:path",
      { workspaceRoot }
    );

    const result = buildHarnessImprovementProposals({
      workspaceRoot,
      handoffFreshness: {
        isStale: true,
        handoffPath: "GRAPH_REPORT.md",
        graphGeneratedAt: "2026-06-29T00:00:00.000Z",
        detail: "GRAPH_REPORT.md is missing; export or run dogfood to refresh handoff context.",
      },
      learnLogFindings: learn.findings,
    });

    expect(result.proposals.some((proposal) => proposal.category === "stale_graph_export")).toBe(true);
    expect(result.proposals.some((proposal) => proposal.category === "path_query_miss")).toBe(true);
    expect(result.harnessFailureCount).toBeGreaterThan(0);
    expect(result.modelFailureCount).toBeGreaterThan(0);
    expect(result.markdown).toContain("Safe for agent auto-apply: no");
  });

  it("emits valid path reproduce commands with endpoints or placeholders", () => {
    const withEndpoints = buildHarnessImprovementProposals({
      workspaceRoot,
      pathQueryMisses: [
        {
          kind: "path",
          detail: "path from MainView.xaml to MissingService not found",
        },
      ],
    });
    const pathProposal = withEndpoints.proposals.find((proposal) => proposal.category === "path_query_miss");
    expect(pathProposal?.reproduceCommand).toContain("graph:path");
    expect(pathProposal?.reproduceCommand).toContain("MainView.xaml");
    expect(pathProposal?.reproduceCommand).toContain("MissingService");
    expect(pathProposal?.reproduceCommand).not.toMatch(/graph:path -- --workspace [^\s]+ --json$/);

    const withTemplate = buildHarnessImprovementProposals({
      workspaceRoot,
      pathQueryMisses: [{ kind: "path", detail: "No matching seed for graph:path" }],
    });
    const templateProposal = withTemplate.proposals.find((proposal) => proposal.category === "path_query_miss");
    expect(templateProposal?.reproduceCommand).toContain('"<from>"');
    expect(templateProposal?.reproduceCommand).toContain('"<to>"');
  });

  it("emits valid query reproduce commands with query text or placeholders", () => {
    const withQuery = buildHarnessImprovementProposals({
      workspaceRoot,
      pathQueryMisses: [
        { kind: "query", detail: "graph_query_complete seeds: []", query: "MainViewModel" },
      ],
    });
    const queryProposal = withQuery.proposals.find((proposal) => proposal.category === "path_query_miss");
    expect(queryProposal?.reproduceCommand).toContain("graph:query");
    expect(queryProposal?.reproduceCommand).toContain("MainViewModel");
    expect(queryProposal?.reproduceCommand).not.toMatch(/graph:query -- --workspace [^\s]+ --json$/);

    const withTemplate = buildHarnessImprovementProposals({
      workspaceRoot,
      pathQueryMisses: [{ kind: "query", detail: "graph_query_complete seeds: []" }],
    });
    const templateProposal = withTemplate.proposals.find((proposal) => proposal.category === "path_query_miss");
    expect(templateProposal?.reproduceCommand).toContain('"<query>"');
  });

  it("uses graph:learn or concrete path command for log-derived path misses", () => {
    const learn = analyzeGraphLearnLog(
      "No matching seed for graph:path\npath from MainView.xaml to MissingService not found",
      { workspaceRoot }
    );
    const result = buildHarnessImprovementProposals({
      workspaceRoot,
      learnLogFindings: learn.findings,
    });
    const proposal = result.proposals.find((proposal) => proposal.id === "learn_bad_path_query");
    expect(proposal?.reproduceCommand).toContain("graph:path");
    expect(proposal?.reproduceCommand).toContain("MainView.xaml");
    expect(proposal?.reproduceCommand).not.toMatch(/graph:path -- --workspace [^\s]+ --json$/);
  });
});