import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENTIC_SDLC_GOOD_THRESHOLD } from "./graphAgenticSdlcScorecard.js";
import type { AgenticHarnessFixtureEvalInput } from "./graphAgenticSdlcReleaseGates.js";
import {
  evaluateAgenticSdlcReleaseGateSuite,
  formatAgenticSdlcReleaseGateSummaryLine,
} from "./graphAgenticSdlcReleaseGates.js";
import * as graphExportBundle from "./graphExportBundle.js";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import type { GraphContextNoiseSummary } from "./graphContextNoise.js";
import type { GraphHarnessReadinessSummary } from "./graphHarnessReadiness.js";
import type { GraphSpecQualitySummary } from "./graphSpecQuality.js";
import type { GraphVerificationMap } from "./graphVerificationMap.js";
import type { AgenticSdlcScorecard } from "./graphAgenticSdlcScorecard.js";

function minimalGraph(overrides: Partial<UnifiedCodeGraph> = {}): UnifiedCodeGraph {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [
      {
        id: "file-readme",
        kind: "code_file",
        title: "README.md",
        path: "README.md",
        label: "README.md",
      },
    ],
    edges: [],
    diagnostics: [],
    activeScannerIds: ["generic"],
    communities: [],
    ...overrides,
  };
}

function baseScorecard(overrides: Partial<AgenticSdlcScorecard> = {}): AgenticSdlcScorecard {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    workspaceRoot: "/tmp/harness-fixture",
    overallScore: 60,
    ok: false,
    deterministic: true,
    disclaimer: "test",
    categories: [],
    knownGaps: ["Spec readiness is below the recommended agent-onboarding threshold."],
    ...overrides,
  };
}

function buildFixtureInput(
  fixture: AgenticHarnessFixtureEvalInput["fixture"],
  overrides: {
    scorecard?: Partial<AgenticSdlcScorecard>;
    harnessReadiness?: Partial<GraphHarnessReadinessSummary>;
    specQuality?: Partial<GraphSpecQualitySummary>;
    verificationMap?: Partial<GraphVerificationMap>;
    contextNoise?: Partial<GraphContextNoiseSummary>;
  } = {}
): AgenticHarnessFixtureEvalInput {
  const workspaceRoot = `/tmp/${fixture}`;
  const graph = minimalGraph();
  const metadata = { readmeText: "# Demo\n" };

  const harnessReadiness: GraphHarnessReadinessSummary = {
    score: 55,
    ok: false,
    present: [],
    missing: [],
    conflicts: [],
    recommendations: [],
    ...overrides.harnessReadiness,
  };

  const specQuality: GraphSpecQualitySummary = {
    score: 55,
    ok: false,
    present: [],
    missing: [],
    conflicts: [],
    risks: [],
    ...overrides.specQuality,
  };

  const verificationMap: GraphVerificationMap = {
    commands: [],
    recommendedDefault: [],
    taskHints: [],
    conflicts: [],
    gaps: [],
    ...overrides.verificationMap,
  };

  const contextNoise: GraphContextNoiseSummary = {
    score: 70,
    noiseItems: [],
    recommendations: [],
    ...overrides.contextNoise,
  };

  const scorecard = baseScorecard({
    workspaceRoot,
    ...overrides.scorecard,
  });

  switch (fixture) {
    case "fixture-agentic-harness-good":
      harnessReadiness.ok = overrides.harnessReadiness?.ok ?? true;
      harnessReadiness.score = overrides.harnessReadiness?.score ?? 90;
      scorecard.overallScore = overrides.scorecard?.overallScore ?? 88;
      scorecard.ok = overrides.scorecard?.ok ?? true;
      contextNoise.score = overrides.contextNoise?.score ?? 100;
      verificationMap.commands = overrides.verificationMap?.commands ?? [
        { command: "npm ci", category: "install", confidence: "script_defined", source: "README.md" },
        { command: "npm run build", category: "build", confidence: "script_defined", source: "package.json" },
        { command: "npm test", category: "unit_test", confidence: "script_defined", source: "package.json" },
      ];
      break;
    case "fixture-agentic-harness-missing":
      harnessReadiness.missing = overrides.harnessReadiness?.missing ?? [
        "setup_instructions",
        "test_instructions",
        "agent_instructions",
      ];
      specQuality.missing = overrides.specQuality?.missing ?? ["agent_instructions"];
      scorecard.overallScore = overrides.scorecard?.overallScore ?? 62;
      break;
    case "fixture-agentic-harness-conflicting":
      harnessReadiness.conflicts = overrides.harnessReadiness?.conflicts ?? [
        { kind: "test_command", detail: "README and AGENTS.md disagree on test command", sources: ["README.md", "AGENTS.md"] },
        { kind: "agent_instructions", detail: "AGENTS.md and CLAUDE.md disagree", sources: ["AGENTS.md", "CLAUDE.md"] },
      ];
      verificationMap.conflicts = overrides.verificationMap?.conflicts ?? [
        { category: "unit_test", detail: "Conflicting unit test commands", commands: ["npm test", "pnpm test"] },
      ];
      scorecard.overallScore = overrides.scorecard?.overallScore ?? 67;
      break;
    case "fixture-agentic-harness-noisy":
      contextNoise.score = overrides.contextNoise?.score ?? 76;
      contextNoise.noiseItems = overrides.contextNoise?.noiseItems ?? [
        { kind: "generated_artifact", detail: "Tracked generated artifact", severity: "high" },
        { kind: "stale_plan", detail: "Stale plan file", severity: "medium", path: "PLAN-STALE-1.5.md" },
        { kind: "broken_doc_link", detail: "Broken doc link", severity: "medium" },
      ];
      specQuality.risks = overrides.specQuality?.risks ?? ["1 broken doc link(s) detected."];
      scorecard.overallScore = overrides.scorecard?.overallScore ?? 67;
      break;
    default:
      break;
  }

  return {
    fixture,
    workspaceRoot,
    graph,
    metadata,
    scorecard,
    harnessReadiness,
    specQuality,
    verificationMap,
    contextNoise,
  };
}

function allHarnessFixtures(
  overrides: Partial<Record<AgenticHarnessFixtureEvalInput["fixture"], Parameters<typeof buildFixtureInput>[1]>> = {}
) {
  return ([
    "fixture-agentic-harness-good",
    "fixture-agentic-harness-missing",
    "fixture-agentic-harness-conflicting",
    "fixture-agentic-harness-noisy",
  ] as const).map((fixture) => buildFixtureInput(fixture, overrides[fixture]));
}

beforeEach(() => {
  vi.spyOn(graphExportBundle, "evaluateStaticExportReleaseGates").mockReturnValue({
    ok: true,
    errors: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("graphAgenticSdlcReleaseGates", () => {
  it("requires every dedicated harness fixture id", () => {
    const suite = evaluateAgenticSdlcReleaseGateSuite({ harnessFixtures: [] });
    expect(suite.ok).toBe(false);
    expect(suite.errors.some((error) => error.includes("fixture-agentic-harness-good"))).toBe(true);
  });

  it("formats a human summary line", () => {
    const line = formatAgenticSdlcReleaseGateSummaryLine({
      ok: true,
      errors: [],
      fixtureResults: [],
      measuredSamples: [],
      commandConfidenceCounts: {},
      summary: {
        goodScore: 88,
        missingScore: 62,
        conflictingScore: 67,
        noisyScore: 67,
        goodContextNoiseScore: 100,
        noisyContextNoiseScore: 76,
      },
    });
    expect(line).toContain("Agentic SDLC gates: PASS");
    expect(line).toContain("good=88");
    expect(line).toContain("contextNoiseNoisy=76");
  });

  it("flags a good fixture that falls below the threshold", () => {
    const suite = evaluateAgenticSdlcReleaseGateSuite({
      harnessFixtures: [buildFixtureInput("fixture-agentic-harness-good", {
        scorecard: {
          overallScore: AGENTIC_SDLC_GOOD_THRESHOLD - 1,
          ok: false,
        },
      })],
    });
    expect(suite.ok).toBe(false);
    expect(suite.errors.some((error) => /below threshold/i.test(error))).toBe(true);
  });

  it("passes all four negative harness fixture contracts on the happy path", () => {
    const suite = evaluateAgenticSdlcReleaseGateSuite({
      harnessFixtures: allHarnessFixtures(),
    });
    expect(suite.ok).toBe(true);
    expect(suite.fixtureResults).toHaveLength(4);
    expect(suite.fixtureResults.every((result) => result.passed)).toBe(true);
    expect(suite.summary.goodScore).toBeGreaterThan(suite.summary.noisyScore);
    expect(suite.summary.goodContextNoiseScore).toBeGreaterThan(suite.summary.noisyContextNoiseScore);
  });

  it("fails when conflicting fixture reports harnessReadiness.ok=true", () => {
    const fixtures = allHarnessFixtures({
      "fixture-agentic-harness-conflicting": {
        harnessReadiness: {
          ok: true,
          conflicts: [
            { kind: "test_command", detail: "conflict", sources: ["README.md", "AGENTS.md"] },
            { kind: "agent_instructions", detail: "conflict", sources: ["AGENTS.md", "CLAUDE.md"] },
          ],
        },
        verificationMap: {
          conflicts: [{ category: "unit_test", detail: "conflict", commands: ["npm test", "pnpm test"] }],
        },
      },
    });
    const suite = evaluateAgenticSdlcReleaseGateSuite({ harnessFixtures: fixtures });
    expect(suite.ok).toBe(false);
    expect(suite.errors.some((error) =>
      error.includes("fixture-agentic-harness-conflicting")
      && /should fail harness readiness/i.test(error)
    )).toBe(true);
  });

  it("fails when noisy fixture reports harnessReadiness.ok=true", () => {
    const fixtures = allHarnessFixtures({
      "fixture-agentic-harness-noisy": {
        harnessReadiness: { ok: true },
        contextNoise: {
          score: 76,
          noiseItems: [
            { kind: "generated_artifact", detail: "noise", severity: "high" },
            { kind: "stale_plan", detail: "noise", severity: "medium" },
            { kind: "broken_doc_link", detail: "noise", severity: "medium" },
          ],
        },
        specQuality: { risks: ["1 broken doc link(s) detected."] },
        scorecard: { overallScore: 67, ok: false },
      },
    });
    const suite = evaluateAgenticSdlcReleaseGateSuite({ harnessFixtures: fixtures });
    expect(suite.ok).toBe(false);
    expect(suite.errors.some((error) =>
      error.includes("fixture-agentic-harness-noisy")
      && /should fail harness readiness/i.test(error)
    )).toBe(true);
  });

  it("fails when missing fixture reports harnessReadiness.ok=true", () => {
    const fixtures = allHarnessFixtures({
      "fixture-agentic-harness-missing": {
        harnessReadiness: {
          ok: true,
          missing: ["setup_instructions", "test_instructions", "agent_instructions"],
        },
        specQuality: { missing: ["agent_instructions"] },
        scorecard: { ok: false, overallScore: 62 },
      },
    });
    const suite = evaluateAgenticSdlcReleaseGateSuite({ harnessFixtures: fixtures });
    expect(suite.ok).toBe(false);
    expect(suite.errors.some((error) =>
      error.includes("fixture-agentic-harness-missing")
      && /should fail harness readiness/i.test(error)
    )).toBe(true);
  });

  it("propagates export leak failures with the export/report leak prefix", () => {
    vi.spyOn(graphExportBundle, "evaluateStaticExportReleaseGates").mockReturnValue({
      ok: false,
      errors: ["graph.json contains secret-looking API key value."],
    });

    const suite = evaluateAgenticSdlcReleaseGateSuite({
      harnessFixtures: [buildFixtureInput("fixture-agentic-harness-good")],
    });

    expect(suite.ok).toBe(false);
    expect(suite.fixtureResults[0]?.exportGateOk).toBe(false);
    expect(suite.errors.some((error) => error.includes("export/report leak:"))).toBe(true);
  });
});