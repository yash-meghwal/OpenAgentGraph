import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import {
  GRAPH_EXTERNAL_BENCHMARK_CATALOG,
  GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS,
  evaluateGraphExternalBenchmarkSuite,
  type GraphExternalBenchmarkScorecard,
} from "./graphExternalBenchmark.js";
import type { GraphPathQualityFailureCounts } from "./graphPathQuality.js";
import {
  GRAPH_RELEASE_FIXTURE_IDS,
  GRAPH_RELEASE_MIN_PATH_SUCCESS_RATE,
  GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE,
  evaluateReleaseBenchmarkSuite,
} from "./graphReleaseGates.js";
import {
  evaluateGraphRelevanceBaselineSuite,
  GRAPH_QUERY_MODE_CODE_MIN_SUCCESS_RATE,
  GRAPH_QUERY_MODE_DOCS_MIN_SUCCESS_RATE,
} from "./graphRelevanceBaseline.js";
import {
  evaluateGraphUpdateBenchmarkSuite,
  formatGraphUpdateBenchmarkSummaryLine,
  GRAPH_UPDATE_BENCHMARK_WARM_REPEAT_MAX_RATIO,
  type GraphUpdateBenchmarkResult,
} from "./graphUpdateBenchmark.js";
import { sanitizeOperationalText } from "./safeText.js";

export interface GraphPublicScorecardInput {
  releaseResults: Array<{
    fixture: string;
    graph: UnifiedCodeGraph;
    kernelProfile?: WorkspaceKernelProfile;
    scanMs: number;
  }>;
  externalResults?: GraphExternalBenchmarkScorecard[];
  updateBenchmarkResults?: GraphUpdateBenchmarkResult[];
  updateBenchmarkOk?: boolean;
  updateBenchmarkSummary?: string;
  relevanceBaseline?: ReturnType<typeof evaluateGraphRelevanceBaselineSuite>;
  pathDetourFailures?: number;
  cliCleanInstallSmokeStatus?: "pass" | "fail" | "not_run";
  harnessContextNoiseSamples?: Array<{ fixture: string; score: number }>;
  agenticSdlcFixtureSamples?: Array<{ fixture: string; overallScore: number; ok: boolean }>;
}

export interface GraphPublicScorecard {
  generatedAt: string;
  fixtureCount: number;
  releaseGateStatus: "pass" | "fail";
  querySuccessRate: number;
  codeModeQuerySuccessRate: number;
  docsModeQuerySuccessRate: number;
  balancedModeQuerySuccessRate: number;
  pathSuccessRate: number;
  pathDetourFailures: number;
  pathDirectnessFailures: number;
  pathEndpointFidelityFailures: number;
  guidanceConsistencyFailures: number;
  readFirstFailures: number;
  hubStartFailures: number;
  docRepairSuggestionCoverage: number;
  generatedArtifactBrokenLinkCount: number;
  duplicateKernelScanCount: number;
  warmColdPerformanceRatio: string;
  cliCleanInstallSmokeStatus: string;
  misleadingHandoffRate: number;
  provenanceCoverage: number;
  externalCategories: number;
  externalPassCount: number;
  updateBenchmarkStatus: string;
  ecosystemTiers: Record<string, number>;
  harnessContextNoiseGoodScore?: number;
  harnessContextNoiseNoisyScore?: number;
  agenticSdlcGoodScore?: number;
  agenticSdlcMissingScore?: number;
  agenticSdlcConflictingScore?: number;
  agenticSdlcNoisyScore?: number;
  knownGaps: string[];
  rows: Array<{ metric: string; value: string; reproducible: string }>;
}

function computeAverageProvenance(graphs: UnifiedCodeGraph[]) {
  if (graphs.length === 0) return 1;
  let total = 0;
  for (const graph of graphs) {
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const scopedEdges = graph.edges.filter((edge) => {
      const source = nodeById.get(edge.sourceNodeId);
      const target = nodeById.get(edge.targetNodeId);
      return source?.kind !== "community" && target?.kind !== "community";
    });
    if (scopedEdges.length === 0) {
      total += 1;
      continue;
    }
    let covered = 0;
    for (const edge of scopedEdges) {
      const needsConfidence = edge.provenance === "inferred" || edge.provenance === "ambiguous";
      const hasConfidence = !needsConfidence || typeof edge.confidence === "number";
      if (edge.provenance && edge.source && hasConfidence) covered += 1;
    }
    total += covered / scopedEdges.length;
  }
  return total / graphs.length;
}

function summarizeEcosystemTiers(graphs: UnifiedCodeGraph[]) {
  const tiers: Record<string, number> = {};
  for (const graph of graphs) {
    for (const scanner of graph.activeScannerIds ?? []) {
      tiers[scanner] = (tiers[scanner] ?? 0) + 1;
    }
  }
  return tiers;
}

function summarizeGeneratedArtifactBrokenLinks(
  releaseResults: ReturnType<typeof evaluateReleaseBenchmarkSuite>["releaseResults"]
) {
  return releaseResults
    .filter((result) => result.fixture !== "fixture-docs-broken-links")
    .reduce((sum, result) => sum + result.docLinkHygiene.brokenCount, 0);
}

function summarizeWarmColdPerformanceRatio(updateResults: GraphUpdateBenchmarkResult[] | undefined) {
  const unchangedWarm = updateResults?.find((result) => result.scenarioId === "unchanged-warm");
  if (!unchangedWarm || unchangedWarm.coldScanMs <= 0) {
    return "not_measured";
  }
  const ratio = unchangedWarm.warmUpdateMs / unchangedWarm.coldScanMs;
  return `${ratio.toFixed(2)}x (max ${GRAPH_UPDATE_BENCHMARK_WARM_REPEAT_MAX_RATIO}x)`;
}

function pathQualityFailuresFromBaseline(
  relevanceBaseline?: GraphPublicScorecardInput["relevanceBaseline"]
): GraphPathQualityFailureCounts {
  return relevanceBaseline?.pathQualityFailures ?? {
    pathDirectnessFailures: 0,
    pathEndpointFidelityFailures: 0,
    pathHubDetourFailures: 0,
  };
}

export function buildGraphPublicScorecard(input: GraphPublicScorecardInput): GraphPublicScorecard {
  const releaseSuite = evaluateReleaseBenchmarkSuite({ results: input.releaseResults });
  const externalSuite = input.externalResults
    ? evaluateGraphExternalBenchmarkSuite(input.externalResults)
    : undefined;
  const updateSuite = input.updateBenchmarkResults
    ? evaluateGraphUpdateBenchmarkSuite(input.updateBenchmarkResults)
    : undefined;
  const provenanceCoverage = computeAverageProvenance(input.releaseResults.map((result) => result.graph));
  const ecosystemTiers = summarizeEcosystemTiers(input.releaseResults.map((result) => result.graph));
  const relevance = input.relevanceBaseline;
  const pathQualityFailures = pathQualityFailuresFromBaseline(relevance);
  const pathDetourFailures = input.pathDetourFailures ?? releaseSuite.releaseResults.flatMap((result) =>
    result.pathBenchmarks.filter((benchmark) => !benchmark.passed && /forbidden node kind/i.test(benchmark.detail))
  ).length;
  const readFirstFailures = releaseSuite.releaseResults.filter((result) => !result.readFirstQuality.ok).length;
  const hubStartFailures = releaseSuite.releaseResults.filter((result) => !result.hubStartQuality.ok).length;
  const generatedArtifactBrokenLinkCount = summarizeGeneratedArtifactBrokenLinks(releaseSuite.releaseResults);
  const warmColdPerformanceRatio = summarizeWarmColdPerformanceRatio(input.updateBenchmarkResults);
  const cliCleanInstallSmokeStatus = input.cliCleanInstallSmokeStatus ?? "not_run";

  const knownGaps: string[] = [];
  if (!releaseSuite.ok) {
    knownGaps.push(...releaseSuite.errors.slice(0, 6).map((error) => sanitizeOperationalText(error, { maxLength: 220 })));
  }
  if (relevance && !relevance.ok) {
    knownGaps.push(...relevance.errors.slice(0, 6).map((error) => sanitizeOperationalText(error, { maxLength: 220 })));
  }
  if (externalSuite && !externalSuite.ok) {
    knownGaps.push(...externalSuite.errors.slice(0, 4).map((error) => sanitizeOperationalText(error, { maxLength: 220 })));
  }
  if (releaseSuite.misleadingHandoffRate > 0) {
    knownGaps.push("Misleading handoff guidance detected in release fixtures.");
  }
  if (pathQualityFailures.pathDirectnessFailures > 0) {
    knownGaps.push("Path directness benchmarks still have measured failures; see verify:graph path-quality output.");
  }
  if (cliCleanInstallSmokeStatus === "fail") {
    knownGaps.push("CLI clean-install smoke test failed; see npm test --workspace=packages/cli.");
  }

  const harnessGoodScore = input.harnessContextNoiseSamples
    ?.find((sample) => sample.fixture === "fixture-agentic-harness-good")?.score;
  const harnessNoisyScore = input.harnessContextNoiseSamples
    ?.find((sample) => sample.fixture === "fixture-agentic-harness-noisy")?.score;
  const agenticGoodScore = input.agenticSdlcFixtureSamples
    ?.find((sample) => sample.fixture === "fixture-agentic-harness-good")?.overallScore;
  const agenticMissingScore = input.agenticSdlcFixtureSamples
    ?.find((sample) => sample.fixture === "fixture-agentic-harness-missing")?.overallScore;
  const agenticConflictingScore = input.agenticSdlcFixtureSamples
    ?.find((sample) => sample.fixture === "fixture-agentic-harness-conflicting")?.overallScore;
  const agenticNoisyScore = input.agenticSdlcFixtureSamples
    ?.find((sample) => sample.fixture === "fixture-agentic-harness-noisy")?.overallScore;

  const rows = [
    {
      metric: "Release benchmark fixtures",
      value: String(GRAPH_RELEASE_FIXTURE_IDS.length),
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Release gate status",
      value: releaseSuite.ok && (relevance?.ok ?? true) ? "PASS" : "FAIL",
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Balanced query success rate",
      value: `${Math.round(releaseSuite.querySuccessRate * 100)}% (min ${Math.round(GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE * 100)}%)`,
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Code-mode query success rate",
      value: `${Math.round((relevance?.codeModePassRate ?? 1) * 100)}% (min ${Math.round(GRAPH_QUERY_MODE_CODE_MIN_SUCCESS_RATE * 100)}%)`,
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Docs-mode query success rate",
      value: `${Math.round((relevance?.docsModePassRate ?? 1) * 100)}% (min ${Math.round(GRAPH_QUERY_MODE_DOCS_MIN_SUCCESS_RATE * 100)}%)`,
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Path success rate",
      value: `${Math.round(releaseSuite.pathSuccessRate * 100)}% (min ${Math.round(GRAPH_RELEASE_MIN_PATH_SUCCESS_RATE * 100)}%)`,
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Path detour failures",
      value: String(pathDetourFailures),
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Path directness failures",
      value: String(pathQualityFailures.pathDirectnessFailures),
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Path endpoint fidelity failures",
      value: String(pathQualityFailures.pathEndpointFidelityFailures),
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Guidance consistency failures",
      value: String(relevance?.guidanceConsistencyFailures ?? releaseSuite.releaseResults.filter((result) => !result.guidanceConsistency.ok).length),
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Read-first failures",
      value: String(readFirstFailures),
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Hub-start failures",
      value: String(hubStartFailures),
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Docs repair suggestion coverage",
      value: `${Math.round((relevance?.docRepairSuggestionCoverage ?? 1) * 100)}%`,
      reproducible: "npm run graph:docs:check -- --suggest",
    },
    {
      metric: "Generated artifact broken links",
      value: String(generatedArtifactBrokenLinkCount),
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Duplicate kernel scans (max per workflow)",
      value: String(relevance?.duplicateKernelScanCount ?? 0),
      reproducible: "npm run graph:benchmark:update",
    },
    {
      metric: "Warm/cold performance ratio",
      value: warmColdPerformanceRatio,
      reproducible: "npm run graph:benchmark:update",
    },
    {
      metric: "CLI clean-install smoke",
      value: cliCleanInstallSmokeStatus === "pass" ? "PASS" : cliCleanInstallSmokeStatus === "fail" ? "FAIL" : "not_run",
      reproducible: "npm test --workspace=packages/cli",
    },
    {
      metric: "Misleading handoff rate",
      value: `${Math.round(releaseSuite.misleadingHandoffRate * 100)}%`,
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Provenance coverage",
      value: `${Math.round(provenanceCoverage * 100)}%`,
      reproducible: "npm run graph:scorecard",
    },
    {
      metric: "External benchmark categories",
      value: `${externalSuite?.results.filter((result) => result.passed).length ?? 0}/${GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS.length}`,
      reproducible: "npm run graph:benchmark:external -- --catalog --report",
    },
    {
      metric: "Update benchmark status",
      value: input.updateBenchmarkSummary ?? (updateSuite ? (updateSuite.ok ? "PASS" : "FAIL") : "not_run"),
      reproducible: "npm run graph:benchmark:update",
    },
    ...(typeof harnessGoodScore === "number"
      ? [{
        metric: "Harness context noise (good fixture)",
        value: `${harnessGoodScore}/100`,
        reproducible: "npm run graph:check -- --workspace tests/fixtures/graph/fixture-agentic-harness-good --json",
      }]
      : []),
    ...(typeof harnessNoisyScore === "number"
      ? [{
        metric: "Harness context noise (noisy fixture)",
        value: `${harnessNoisyScore}/100`,
        reproducible: "npm run graph:check -- --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --json",
      }]
      : []),
    ...(typeof agenticGoodScore === "number"
      ? [{
        metric: "Agentic SDLC readiness (good fixture)",
        value: `${agenticGoodScore}/100`,
        reproducible: "npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-good --agentic-sdlc --json",
      }]
      : []),
    ...(typeof agenticMissingScore === "number"
      ? [{
        metric: "Agentic SDLC readiness (missing fixture)",
        value: `${agenticMissingScore}/100`,
        reproducible: "npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-missing --agentic-sdlc --json",
      }]
      : []),
    ...(typeof agenticConflictingScore === "number"
      ? [{
        metric: "Agentic SDLC readiness (conflicting fixture)",
        value: `${agenticConflictingScore}/100`,
        reproducible: "npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-conflicting --agentic-sdlc --json",
      }]
      : []),
    ...(typeof agenticNoisyScore === "number"
      ? [{
        metric: "Agentic SDLC readiness (noisy fixture)",
        value: `${agenticNoisyScore}/100`,
        reproducible: "npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --agentic-sdlc --json",
      }]
      : []),
  ];

  return {
    generatedAt: new Date().toISOString(),
    fixtureCount: GRAPH_RELEASE_FIXTURE_IDS.length,
    releaseGateStatus: releaseSuite.ok && (relevance?.ok ?? true) ? "pass" : "fail",
    querySuccessRate: releaseSuite.querySuccessRate,
    codeModeQuerySuccessRate: relevance?.codeModePassRate ?? 1,
    docsModeQuerySuccessRate: relevance?.docsModePassRate ?? 1,
    balancedModeQuerySuccessRate: relevance?.balancedModePassRate ?? releaseSuite.querySuccessRate,
    pathSuccessRate: releaseSuite.pathSuccessRate,
    pathDetourFailures,
    pathDirectnessFailures: pathQualityFailures.pathDirectnessFailures,
    pathEndpointFidelityFailures: pathQualityFailures.pathEndpointFidelityFailures,
    guidanceConsistencyFailures: relevance?.guidanceConsistencyFailures
      ?? releaseSuite.releaseResults.filter((result) => !result.guidanceConsistency.ok).length,
    readFirstFailures,
    hubStartFailures,
    docRepairSuggestionCoverage: relevance?.docRepairSuggestionCoverage ?? 1,
    generatedArtifactBrokenLinkCount,
    duplicateKernelScanCount: relevance?.duplicateKernelScanCount ?? 0,
    warmColdPerformanceRatio,
    cliCleanInstallSmokeStatus: cliCleanInstallSmokeStatus === "pass"
      ? "PASS"
      : cliCleanInstallSmokeStatus === "fail"
        ? "FAIL"
        : "not_run",
    misleadingHandoffRate: releaseSuite.misleadingHandoffRate,
    provenanceCoverage,
    externalCategories: GRAPH_EXTERNAL_BENCHMARK_CATALOG.length,
    externalPassCount: externalSuite?.results.filter((result) => result.passed).length ?? 0,
    updateBenchmarkStatus: input.updateBenchmarkSummary ?? (updateSuite ? (updateSuite.ok ? "PASS" : "FAIL") : "not_run"),
    ecosystemTiers,
    harnessContextNoiseGoodScore: harnessGoodScore,
    harnessContextNoiseNoisyScore: harnessNoisyScore,
    agenticSdlcGoodScore: agenticGoodScore,
    agenticSdlcMissingScore: agenticMissingScore,
    agenticSdlcConflictingScore: agenticConflictingScore,
    agenticSdlcNoisyScore: agenticNoisyScore,
    knownGaps,
    rows,
  };
}

export function formatGraphPublicScorecardMarkdown(scorecard: GraphPublicScorecard): string {
  const lines = [
    "# OAG Public Benchmark Scorecard",
    "",
    `Generated: ${scorecard.generatedAt}`,
    "",
    "Reproduce with `npm run graph:scorecard`. Source bodies and private paths are intentionally omitted.",
    "",
    "| Metric | Value | Reproduce |",
    "| --- | --- | --- |",
    ...scorecard.rows.map((row) => `| ${row.metric} | ${row.value} | \`${row.reproducible}\` |`),
    "",
  ];

  if (scorecard.knownGaps.length > 0) {
    lines.push("## Known gaps", "");
    for (const gap of scorecard.knownGaps) {
      lines.push(`- ${gap}`);
    }
    lines.push("");
  }

  if (Object.keys(scorecard.ecosystemTiers).length > 0) {
    lines.push("## Active scanners (fixture sample)", "");
    for (const [scanner, count] of Object.entries(scorecard.ecosystemTiers).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${scanner}: seen in ${count} fixture scan(s)`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatGraphPublicScorecardReadmeTable(scorecard: GraphPublicScorecard): string {
  return [
    "| Proof metric | Current value |",
    "| --- | --- |",
    ...scorecard.rows.map((row) => `| ${row.metric} | ${row.value} |`),
  ].join("\n");
}

export { evaluateGraphUpdateBenchmarkSuite, formatGraphUpdateBenchmarkSummaryLine };