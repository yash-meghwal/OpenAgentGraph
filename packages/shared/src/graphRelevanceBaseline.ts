import type { UnifiedCodeGraph } from "./codeGraph.js";
import { summarizeDocLinkHygiene } from "./graphDocLinks.js";
import { evaluateGraphGuidanceConsistency } from "./graphGuidanceConsistency.js";
import {
  evaluateGraphPathQualityBenchmark,
  GRAPH_PATH_QUALITY_BENCHMARKS,
  type GraphPathQualityBenchmarkResult,
} from "./graphPathQuality.js";
import {
  evaluateGraphQueryModeBenchmark,
  GRAPH_QUERY_MODE_BENCHMARKS,
  type GraphQueryModeBenchmarkResult,
} from "./graphQueryModeBenchmark.js";
import type { GraphWorkflowTimingReport } from "./graphWorkflowTiming.js";

export const GRAPH_RELEVANCE_BASELINE_VERSION = "1.0";
export const GRAPH_QUERY_MODE_BASELINE_MIN_SUCCESS_RATE = 0.95;

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

  const pathQualityPassRate = pathQuality.length > 0
    ? pathQuality.filter((entry) => entry.passed).length / pathQuality.length
    : 1;
  const queryModePassRate = queryMode.length > 0
    ? queryMode.filter((entry) => entry.passed).length / queryMode.length
    : 1;

  const docRepairSuggestionCoverage = docHygiene.brokenCount > 0
    ? 0
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

export function evaluateGraphRelevanceBaselineSuite(input: {
  results: GraphRelevanceBaselineInput[];
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
  const guidanceConsistencyFailures = baselineResults.filter((result) => !result.guidanceConsistencyOk).length;

  return {
    version: GRAPH_RELEVANCE_BASELINE_VERSION,
    ok: baselineResults.every((result) => result.ok),
    pathQualityPassRate,
    queryModePassRate,
    guidanceConsistencyFailures,
    results: baselineResults,
    errors: baselineResults.flatMap((result) => result.errors.map((error) => `${result.fixture}: ${error}`)),
  };
}