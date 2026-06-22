import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import {
  GRAPH_EXTERNAL_BENCHMARK_CATALOG,
  GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS,
  evaluateGraphExternalBenchmarkSuite,
  type GraphExternalBenchmarkScorecard,
} from "./graphExternalBenchmark.js";
import {
  GRAPH_RELEASE_FIXTURE_IDS,
  GRAPH_RELEASE_MIN_PATH_SUCCESS_RATE,
  GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE,
  evaluateReleaseBenchmarkSuite,
} from "./graphReleaseGates.js";
import {
  evaluateGraphUpdateBenchmarkSuite,
  formatGraphUpdateBenchmarkSummaryLine,
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
  updateBenchmarkOk?: boolean;
  updateBenchmarkSummary?: string;
}

export interface GraphPublicScorecard {
  generatedAt: string;
  fixtureCount: number;
  releaseGateStatus: "pass" | "fail";
  querySuccessRate: number;
  pathSuccessRate: number;
  misleadingHandoffRate: number;
  provenanceCoverage: number;
  externalCategories: number;
  externalPassCount: number;
  updateBenchmarkStatus: string;
  ecosystemTiers: Record<string, number>;
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

export function buildGraphPublicScorecard(input: GraphPublicScorecardInput): GraphPublicScorecard {
  const releaseSuite = evaluateReleaseBenchmarkSuite({ results: input.releaseResults });
  const externalSuite = input.externalResults
    ? evaluateGraphExternalBenchmarkSuite(input.externalResults)
    : undefined;
  const provenanceCoverage = computeAverageProvenance(input.releaseResults.map((result) => result.graph));
  const ecosystemTiers = summarizeEcosystemTiers(input.releaseResults.map((result) => result.graph));

  const knownGaps: string[] = [];
  if (!releaseSuite.ok) {
    knownGaps.push(...releaseSuite.errors.slice(0, 6).map((error) => sanitizeOperationalText(error, { maxLength: 220 })));
  }
  if (externalSuite && !externalSuite.ok) {
    knownGaps.push(...externalSuite.errors.slice(0, 4).map((error) => sanitizeOperationalText(error, { maxLength: 220 })));
  }
  if (releaseSuite.misleadingHandoffRate > 0) {
    knownGaps.push("Misleading handoff guidance detected in release fixtures.");
  }

  const rows = [
    {
      metric: "Release benchmark fixtures",
      value: String(GRAPH_RELEASE_FIXTURE_IDS.length),
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Release gate status",
      value: releaseSuite.ok ? "PASS" : "FAIL",
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Query success rate",
      value: `${Math.round(releaseSuite.querySuccessRate * 100)}% (min ${Math.round(GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE * 100)}%)`,
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Path success rate",
      value: `${Math.round(releaseSuite.pathSuccessRate * 100)}% (min ${Math.round(GRAPH_RELEASE_MIN_PATH_SUCCESS_RATE * 100)}%)`,
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Path detour gate (no doc_section on code-to-code)",
      value: releaseSuite.releaseResults.every((result) =>
        result.pathBenchmarks.every((benchmark) =>
          benchmark.passed || !/forbidden node kind 'doc_section'/i.test(benchmark.detail)
        )
      ) ? "PASS" : "FAIL",
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Read-first quality gate",
      value: releaseSuite.releaseResults.every((result) => result.readFirstQuality.ok) ? "PASS" : "FAIL",
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Hub start quality gate",
      value: releaseSuite.releaseResults.every((result) => result.hubStartQuality.ok) ? "PASS" : "FAIL",
      reproducible: "npm run verify:graph",
    },
    {
      metric: "Docs link hygiene gate",
      value: releaseSuite.releaseResults.every((result) => result.docLinkHygiene.ok) ? "PASS" : "FAIL",
      reproducible: "npm run graph:docs:check",
    },
    {
      metric: "npm CLI packaging",
      value: "see @openagentgraph/cli pack/smoke tests",
      reproducible: "npm run build --workspace=packages/cli && npm test --workspace=packages/cli",
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
      value: String(GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS.length),
      reproducible: "npm run graph:benchmark:external -- --catalog --report",
    },
    {
      metric: "Update benchmark status",
      value: input.updateBenchmarkSummary ?? (input.updateBenchmarkOk === false ? "FAIL" : "see verify:graph"),
      reproducible: "npm run graph:benchmark:update",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    fixtureCount: GRAPH_RELEASE_FIXTURE_IDS.length,
    releaseGateStatus: releaseSuite.ok ? "pass" : "fail",
    querySuccessRate: releaseSuite.querySuccessRate,
    pathSuccessRate: releaseSuite.pathSuccessRate,
    misleadingHandoffRate: releaseSuite.misleadingHandoffRate,
    provenanceCoverage,
    externalCategories: GRAPH_EXTERNAL_BENCHMARK_CATALOG.length,
    externalPassCount: externalSuite?.results.filter((result) => result.passed).length ?? 0,
    updateBenchmarkStatus: input.updateBenchmarkSummary ?? "not_run",
    ecosystemTiers,
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
    lines.push("");
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
