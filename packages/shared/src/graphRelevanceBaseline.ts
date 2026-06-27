import type { UnifiedCodeGraph } from "./codeGraph.js";
import { summarizeDocLinkHygiene } from "./graphDocLinks.js";
import { summarizeDocLinkRepair } from "./graphDocRepair.js";
import { evaluateGraphGuidanceConsistency } from "./graphGuidanceConsistency.js";
import {
  countGraphPathQualityFailures,
  evaluateGraphPathQualityBenchmark,
  GRAPH_PATH_QUALITY_BENCHMARKS,
  type GraphPathQualityBenchmarkResult,
} from "./graphPathQuality.js";
import type { GraphQueryIntentMode } from "./graphQueryIntent.js";
import {
  evaluateGraphQueryModeBenchmark,
  GRAPH_QUERY_MODE_BENCHMARKS,
  type GraphQueryModeBenchmarkResult,
} from "./graphQueryModeBenchmark.js";
import type { GraphWorkflowTimingReport } from "./graphWorkflowTiming.js";

export const GRAPH_RELEVANCE_BASELINE_VERSION = "1.0";
export const GRAPH_QUERY_MODE_BASELINE_MIN_SUCCESS_RATE = 0.95;
export const GRAPH_QUERY_MODE_CODE_MIN_SUCCESS_RATE = 0.95;
export const GRAPH_QUERY_MODE_DOCS_MIN_SUCCESS_RATE = 0.95;
export const GRAPH_RELEASE_MAX_PATH_DIRECTNESS_FAILURES = 0;
export const GRAPH_RELEASE_MAX_PATH_ENDPOINT_FAILURES = 0;
export const GRAPH_RELEASE_MAX_PATH_DETOUR_FAILURES = 0;
export const GRAPH_RELEASE_MAX_DUPLICATE_KERNEL_SCANS = 0;

export interface GraphRelevanceBaselineInput {
  fixture: string;
  graph: UnifiedCodeGraph;
  stageTimings?: GraphWorkflowTimingReport;
}

export interface GraphRelevanceBaselineResult {
  fixture: string;
  version: string;
  pathQuality: GraphPathQualityBenchmarkResult[];
  pathQualityPassRate: number;
  queryMode: GraphQueryModeBenchmarkResult[];
  queryModePassRate: number;
  guidanceConsistencyOk: boolean;
  guidanceDisagreements: string[];
  docRepairSuggestionCoverage: number;
  duplicateKernelScanCount: number;
  stageTimings?: GraphWorkflowTimingReport;
  ok: boolean;
  errors: string[];
}

export function evaluateGraphRelevanceBaseline(input: GraphRelevanceBaselineInput): GraphRelevanceBaselineResult {
  const pathQuality = GRAPH_PATH_QUALITY_BENCHMARKS
    .filter((benchmark) => benchmark.fixture === input.fixture)
    .map((benchmark) => evaluateGraphPathQualityBenchmark(input.graph, benchmark));
  const queryMode = GRAPH_QUERY_MODE_BENCHMARKS
    .filter((benchmark) => benchmark.fixture === input.fixture)
    .map((benchmark) => evaluateGraphQueryModeBenchmark(input.graph, benchmark));
  const guidance = evaluateGraphGuidanceConsistency(input.graph);
  const docHygiene = summarizeDocLinkHygiene(input.graph);
  const docRepair = summarizeDocLinkRepair(input.graph);

  const pathQualityPassRate = pathQuality.length > 0
    ? pathQuality.filter((entry) => entry.passed).length / pathQuality.length
    : 1;
  const queryModePassRate = queryMode.length > 0
    ? queryMode.filter((entry) => entry.passed).length / queryMode.length
    : 1;

  const docRepairSuggestionCoverage = docRepair.actionableCount > 0
    ? docRepair.withRecommendationCount / docRepair.actionableCount
    : 1;

  const errors: string[] = [];
  for (const entry of pathQuality.filter((result) => !result.passed)) {
    errors.push(`path-quality ${entry.from}->${entry.to}: ${entry.detail}`);
  }
  for (const entry of queryMode.filter((result) => !result.passed)) {
    errors.push(`query-mode ${entry.mode} '${entry.query}': ${entry.detail}`);
  }
  for (const disagreement of guidance.disagreements) {
    errors.push(`guidance: ${disagreement}`);
  }

  return {
    fixture: input.fixture,
    version: GRAPH_RELEVANCE_BASELINE_VERSION,
    pathQuality,
    pathQualityPassRate,
    queryMode,
    queryModePassRate,
    guidanceConsistencyOk: guidance.ok,
    guidanceDisagreements: guidance.disagreements,
    docRepairSuggestionCoverage,
    duplicateKernelScanCount: input.stageTimings?.duplicateKernelScanCount ?? 0,
    stageTimings: input.stageTimings,
    ok: errors.length === 0,
    errors,
  };
}

function queryModePassRateForMode(
  results: GraphQueryModeBenchmarkResult[],
  mode: GraphQueryIntentMode
) {
  const scoped = results.filter((entry) => entry.mode === mode);
  return scoped.length > 0
    ? scoped.filter((entry) => entry.passed).length / scoped.length
    : 1;
}

export function evaluateGraphRelevanceBaselineSuite(input: {
  results: GraphRelevanceBaselineInput[];
  pathDetourFailures?: number;
  generatedArtifactBrokenLinkCount?: number;
}) {
  const baselineResults = input.results.map((entry) => evaluateGraphRelevanceBaseline(entry));
  const pathQualityBenchmarked = baselineResults.flatMap((result) => result.pathQuality);
  const queryModeBenchmarked = baselineResults.flatMap((result) => result.queryMode);
  const pathQualityPassRate = pathQualityBenchmarked.length > 0
    ? pathQualityBenchmarked.filter((entry) => entry.passed).length / pathQualityBenchmarked.length
    : 1;
  const queryModePassRate = queryModeBenchmarked.length > 0
    ? queryModeBenchmarked.filter((entry) => entry.passed).length / queryModeBenchmarked.length
    : 1;
  const codeModePassRate = queryModePassRateForMode(queryModeBenchmarked, "code");
  const docsModePassRate = queryModePassRateForMode(queryModeBenchmarked, "docs");
  const balancedModePassRate = queryModePassRateForMode(queryModeBenchmarked, "balanced");
  const guidanceConsistencyFailures = baselineResults.filter((result) => !result.guidanceConsistencyOk).length;
  const pathQualityFailures = countGraphPathQualityFailures(pathQualityBenchmarked);
  const duplicateKernelScanCount = Math.max(
    0,
    ...baselineResults.map((result) => result.duplicateKernelScanCount)
  );
  const docRepairCoverageValues = baselineResults
    .map((result) => result.docRepairSuggestionCoverage)
    .filter((value) => Number.isFinite(value));
  const docRepairSuggestionCoverage = docRepairCoverageValues.length > 0
    ? docRepairCoverageValues.reduce((sum, value) => sum + value, 0) / docRepairCoverageValues.length
    : 1;

  const errors: string[] = baselineResults.flatMap((result) =>
    result.errors.map((error) => `${result.fixture}: ${error}`)
  );
  if (codeModePassRate < GRAPH_QUERY_MODE_CODE_MIN_SUCCESS_RATE) {
    errors.push(
      `Code-mode query success ${Math.round(codeModePassRate * 100)}% is below ${Math.round(GRAPH_QUERY_MODE_CODE_MIN_SUCCESS_RATE * 100)}%.`
    );
  }
  if (docsModePassRate < GRAPH_QUERY_MODE_DOCS_MIN_SUCCESS_RATE) {
    errors.push(
      `Docs-mode query success ${Math.round(docsModePassRate * 100)}% is below ${Math.round(GRAPH_QUERY_MODE_DOCS_MIN_SUCCESS_RATE * 100)}%.`
    );
  }
  if (pathQualityFailures.pathDirectnessFailures > GRAPH_RELEASE_MAX_PATH_DIRECTNESS_FAILURES) {
    errors.push(
      `Path directness failures ${pathQualityFailures.pathDirectnessFailures} exceed max ${GRAPH_RELEASE_MAX_PATH_DIRECTNESS_FAILURES}.`
    );
  }
  if (pathQualityFailures.pathEndpointFidelityFailures > GRAPH_RELEASE_MAX_PATH_ENDPOINT_FAILURES) {
    errors.push(
      `Path endpoint fidelity failures ${pathQualityFailures.pathEndpointFidelityFailures} exceed max ${GRAPH_RELEASE_MAX_PATH_ENDPOINT_FAILURES}.`
    );
  }
  if (duplicateKernelScanCount > GRAPH_RELEASE_MAX_DUPLICATE_KERNEL_SCANS) {
    errors.push(
      `Duplicate kernel scans ${duplicateKernelScanCount} exceed max ${GRAPH_RELEASE_MAX_DUPLICATE_KERNEL_SCANS}.`
    );
  }
  if ((input.pathDetourFailures ?? 0) > GRAPH_RELEASE_MAX_PATH_DETOUR_FAILURES) {
    errors.push(
      `Path detour failures ${input.pathDetourFailures} exceed max ${GRAPH_RELEASE_MAX_PATH_DETOUR_FAILURES}.`
    );
  }
  if ((input.generatedArtifactBrokenLinkCount ?? 0) > 0) {
    errors.push(
      `Generated artifact broken links ${input.generatedArtifactBrokenLinkCount} must be 0 outside broken-link fixtures.`
    );
  }

  return {
    version: GRAPH_RELEVANCE_BASELINE_VERSION,
    ok: errors.length === 0,
    pathQualityPassRate,
    queryModePassRate,
    codeModePassRate,
    docsModePassRate,
    balancedModePassRate,
    guidanceConsistencyFailures,
    pathQualityFailures,
    duplicateKernelScanCount,
    docRepairSuggestionCoverage,
    results: baselineResults,
    errors,
  };
}