import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import { renderUnifiedGraphHandoffReport } from "./graphArtifacts.js";
import { evaluateStaticExportReleaseGates } from "./graphExportBundle.js";
import {
  AGENTIC_SDLC_GOOD_THRESHOLD,
  type AgenticSdlcScorecard,
} from "./graphAgenticSdlcScorecard.js";
import type { GraphContextNoiseSummary } from "./graphContextNoise.js";
import {
  type GraphHarnessReadinessSummary,
  type HarnessWorkspaceMetadata,
} from "./graphHarnessReadiness.js";
import type { GraphSpecQualitySummary } from "./graphSpecQuality.js";
import type {
  GraphVerificationMap,
  VerificationCommandConfidence,
} from "./graphVerificationMap.js";

export const AGENTIC_HARNESS_FIXTURE_IDS = [
  "fixture-agentic-harness-good",
  "fixture-agentic-harness-missing",
  "fixture-agentic-harness-conflicting",
  "fixture-agentic-harness-noisy",
] as const;

export type AgenticHarnessFixtureId = (typeof AGENTIC_HARNESS_FIXTURE_IDS)[number];

export const AGENTIC_HARNESS_GOOD_CONTEXT_NOISE_MIN = 80;

export interface AgenticHarnessFixtureEvalInput {
  fixture: AgenticHarnessFixtureId;
  workspaceRoot: string;
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  metadata: HarnessWorkspaceMetadata;
  scorecard: AgenticSdlcScorecard;
  harnessReadiness: GraphHarnessReadinessSummary;
  specQuality: GraphSpecQualitySummary;
  verificationMap: GraphVerificationMap;
  contextNoise: GraphContextNoiseSummary;
}

export interface AgenticHarnessFixtureGateResult {
  fixture: AgenticHarnessFixtureId;
  overallScore: number;
  scorecardOk: boolean;
  contextNoiseScore: number;
  passed: boolean;
  errors: string[];
  warnings: string[];
  verificationCommandCount: number;
  exportGateOk: boolean;
}

export interface AgenticSdlcMeasuredFixtureSample {
  fixture: string;
  overallScore: number;
  contextNoiseScore: number;
  verificationCommandCount: number;
  measuredOnly: true;
}

export interface AgenticSdlcReleaseGateSuiteResult {
  ok: boolean;
  errors: string[];
  fixtureResults: AgenticHarnessFixtureGateResult[];
  measuredSamples: AgenticSdlcMeasuredFixtureSample[];
  commandConfidenceCounts: Partial<Record<VerificationCommandConfidence, number>>;
  summary: {
    goodScore: number;
    missingScore: number;
    conflictingScore: number;
    noisyScore: number;
    goodContextNoiseScore: number;
    noisyContextNoiseScore: number;
  };
}

function isAgenticHarnessFixtureId(value: string): value is AgenticHarnessFixtureId {
  return (AGENTIC_HARNESS_FIXTURE_IDS as readonly string[]).includes(value);
}

function hasSafeVerificationCommand(
  verificationMap: GraphVerificationMap,
  category: "unit_test" | "build" | "install"
) {
  return verificationMap.commands.some((entry) => entry.category === category && !entry.risky);
}

function evaluateExportLeakGates(input: {
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
}) {
  const handoffMarkdown = renderUnifiedGraphHandoffReport(input.graph, {
    kernelProfile: input.kernelProfile,
    handoffFreshness: {
      isStale: false,
      handoffPath: "GRAPH_REPORT.md",
      graphGeneratedAt: input.graph.generatedAt,
      detail: "Release-gate synthetic handoff for export leak checks.",
    },
  });
  return evaluateStaticExportReleaseGates({
    graph: input.graph,
    kernelProfile: input.kernelProfile,
    handoffMarkdown,
  });
}

function evaluateHarnessFixtureGate(input: AgenticHarnessFixtureEvalInput): AgenticHarnessFixtureGateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const exportGates = evaluateExportLeakGates({
    graph: input.graph,
    kernelProfile: input.kernelProfile,
  });

  if (!exportGates.ok) {
    errors.push(...exportGates.errors.map((error) => `export/report leak: ${error}`));
  }

  switch (input.fixture) {
    case "fixture-agentic-harness-good": {
      if (input.scorecard.overallScore < AGENTIC_SDLC_GOOD_THRESHOLD) {
        errors.push(`Good harness fixture score ${input.scorecard.overallScore} is below threshold ${AGENTIC_SDLC_GOOD_THRESHOLD}.`);
      }
      if (!input.scorecard.ok) {
        errors.push("Good harness fixture should pass the agentic SDLC scorecard.");
      }
      if (!input.harnessReadiness.ok) {
        errors.push("Good harness fixture should pass harness readiness.");
      }
      if (!hasSafeVerificationCommand(input.verificationMap, "install")) {
        errors.push("Good harness fixture should expose a safe install command.");
      }
      if (!hasSafeVerificationCommand(input.verificationMap, "build")) {
        errors.push("Good harness fixture should expose a safe build command.");
      }
      if (!hasSafeVerificationCommand(input.verificationMap, "unit_test")) {
        errors.push("Good harness fixture should expose a safe unit_test command.");
      }
      if (input.contextNoise.score < AGENTIC_HARNESS_GOOD_CONTEXT_NOISE_MIN) {
        errors.push(`Good harness fixture context noise ${input.contextNoise.score} is below ${AGENTIC_HARNESS_GOOD_CONTEXT_NOISE_MIN}.`);
      }
      break;
    }
    case "fixture-agentic-harness-missing": {
      if (input.scorecard.ok) {
        errors.push("Missing harness fixture should not pass the agentic SDLC scorecard.");
      }
      if (input.harnessReadiness.ok) {
        errors.push("Missing harness fixture should fail harness readiness.");
      }
      if (!input.harnessReadiness.missing.includes("setup_instructions")) {
        errors.push("Missing harness fixture should flag setup_instructions.");
      }
      if (!input.harnessReadiness.missing.includes("test_instructions")) {
        errors.push("Missing harness fixture should flag test_instructions.");
      }
      if (!input.harnessReadiness.missing.includes("agent_instructions")) {
        errors.push("Missing harness fixture should flag agent_instructions.");
      }
      if (!input.specQuality.missing.includes("agent_instructions")) {
        errors.push("Missing harness fixture should flag missing agent instructions in spec quality.");
      }
      warnings.push(...input.scorecard.knownGaps.slice(0, 4));
      break;
    }
    case "fixture-agentic-harness-conflicting": {
      if (input.scorecard.ok) {
        errors.push("Conflicting harness fixture should not pass the agentic SDLC scorecard.");
      }
      if (input.harnessReadiness.ok) {
        errors.push("Conflicting harness fixture should fail harness readiness.");
      }
      if (!input.harnessReadiness.conflicts.some((conflict) => conflict.kind === "test_command")) {
        errors.push("Conflicting harness fixture should report test_command conflicts.");
      }
      if (!input.harnessReadiness.conflicts.some((conflict) => conflict.kind === "agent_instructions")) {
        errors.push("Conflicting harness fixture should report agent_instructions conflicts.");
      }
      if (!input.verificationMap.conflicts.some((conflict) => conflict.category === "unit_test")) {
        errors.push("Conflicting harness fixture should report unit_test verification conflicts.");
      }
      warnings.push(...input.harnessReadiness.conflicts.map((conflict) => conflict.detail));
      break;
    }
    case "fixture-agentic-harness-noisy": {
      if (input.scorecard.overallScore >= AGENTIC_SDLC_GOOD_THRESHOLD) {
        errors.push("Noisy harness fixture should score below the good threshold.");
      }
      if (input.harnessReadiness.ok) {
        errors.push("Noisy harness fixture should fail harness readiness.");
      }
      if (!input.contextNoise.noiseItems.some((item) => item.kind === "generated_artifact")) {
        errors.push("Noisy harness fixture should report generated_artifact noise.");
      }
      if (!input.contextNoise.noiseItems.some((item) => item.kind === "stale_plan")) {
        errors.push("Noisy harness fixture should report stale_plan noise.");
      }
      if (!input.contextNoise.noiseItems.some((item) => item.kind === "broken_doc_link")) {
        errors.push("Noisy harness fixture should report broken_doc_link noise.");
      }
      if (!input.specQuality.risks.some((risk) => /broken doc link/i.test(risk))) {
        errors.push("Noisy harness fixture should warn about broken doc links in spec quality.");
      }
      warnings.push(...input.contextNoise.noiseItems.slice(0, 4).map((item) => item.detail));
      break;
    }
    default:
      errors.push(`Unknown agentic harness fixture '${input.fixture}'.`);
  }

  return {
    fixture: input.fixture,
    overallScore: input.scorecard.overallScore,
    scorecardOk: input.scorecard.ok,
    contextNoiseScore: input.contextNoise.score,
    passed: errors.length === 0,
    errors,
    warnings,
    verificationCommandCount: input.verificationMap.commands.length,
    exportGateOk: exportGates.ok,
  };
}

function countVerificationConfidence(verificationMap: GraphVerificationMap) {
  const counts: Partial<Record<VerificationCommandConfidence, number>> = {};
  for (const command of verificationMap.commands) {
    counts[command.confidence] = (counts[command.confidence] ?? 0) + 1;
  }
  return counts;
}

export function evaluateAgenticSdlcReleaseGateSuite(input: {
  harnessFixtures: AgenticHarnessFixtureEvalInput[];
  measuredFixtures?: Array<{
    fixture: string;
    scorecard: AgenticSdlcScorecard;
    contextNoise: GraphContextNoiseSummary;
    verificationMap: GraphVerificationMap;
  }>;
}): AgenticSdlcReleaseGateSuiteResult {
  const errors: string[] = [];
  const fixtureResults: AgenticHarnessFixtureGateResult[] = [];

  const expectedIds = new Set(AGENTIC_HARNESS_FIXTURE_IDS);
  const seenIds = new Set<AgenticHarnessFixtureId>();

  for (const fixtureInput of input.harnessFixtures) {
    if (!isAgenticHarnessFixtureId(fixtureInput.fixture)) {
      errors.push(`Unsupported harness fixture '${fixtureInput.fixture}'.`);
      continue;
    }
    seenIds.add(fixtureInput.fixture);
    const result = evaluateHarnessFixtureGate(fixtureInput);
    fixtureResults.push(result);
    if (!result.passed) {
      errors.push(...result.errors.map((error) => `${fixtureInput.fixture}: ${error}`));
    }
  }

  for (const fixtureId of AGENTIC_HARNESS_FIXTURE_IDS) {
    if (!seenIds.has(fixtureId)) {
      errors.push(`Missing agentic harness fixture evaluation for ${fixtureId}.`);
    }
  }

  const good = fixtureResults.find((result) => result.fixture === "fixture-agentic-harness-good");
  const noisy = fixtureResults.find((result) => result.fixture === "fixture-agentic-harness-noisy");
  if (good && noisy && noisy.overallScore >= good.overallScore) {
    errors.push("Noisy harness fixture should score lower than the good harness fixture.");
  }
  if (good && noisy && noisy.contextNoiseScore >= good.contextNoiseScore) {
    errors.push("Noisy harness fixture context noise should be lower than the good harness fixture.");
  }

  const measuredSamples: AgenticSdlcMeasuredFixtureSample[] = (input.measuredFixtures ?? []).map((sample) => ({
    fixture: sample.fixture,
    overallScore: sample.scorecard.overallScore,
    contextNoiseScore: sample.contextNoise.score,
    verificationCommandCount: sample.verificationMap.commands.length,
    measuredOnly: true as const,
  }));

  const goodFixtureInput = input.harnessFixtures.find((fixture) => fixture.fixture === "fixture-agentic-harness-good");
  const commandConfidenceCounts = goodFixtureInput
    ? countVerificationConfidence(goodFixtureInput.verificationMap)
    : {};

  const scoreFor = (fixtureId: AgenticHarnessFixtureId) =>
    fixtureResults.find((result) => result.fixture === fixtureId)?.overallScore ?? 0;

  return {
    ok: errors.length === 0,
    errors,
    fixtureResults,
    measuredSamples,
    commandConfidenceCounts,
    summary: {
      goodScore: scoreFor("fixture-agentic-harness-good"),
      missingScore: scoreFor("fixture-agentic-harness-missing"),
      conflictingScore: scoreFor("fixture-agentic-harness-conflicting"),
      noisyScore: scoreFor("fixture-agentic-harness-noisy"),
      goodContextNoiseScore: good?.contextNoiseScore ?? 0,
      noisyContextNoiseScore: noisy?.contextNoiseScore ?? 0,
    },
  };
}

export function formatAgenticSdlcReleaseGateSummaryLine(suite: AgenticSdlcReleaseGateSuiteResult) {
  const { summary } = suite;
  return `Agentic SDLC gates: ${suite.ok ? "PASS" : "FAIL"} good=${summary.goodScore} missing=${summary.missingScore} conflicting=${summary.conflictingScore} noisy=${summary.noisyScore} contextNoiseGood=${summary.goodContextNoiseScore} contextNoiseNoisy=${summary.noisyContextNoiseScore}`;
}