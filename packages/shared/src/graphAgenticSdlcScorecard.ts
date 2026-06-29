import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import { evaluateContextNoise, type GraphContextNoiseSummary } from "./graphContextNoise.js";
import {
  evaluateHandoffFreshness,
  evaluateOagFusionChecks,
  type GraphFusionResult,
  type GraphHandoffFreshnessResult,
} from "./graphFusion.js";
import { summarizeDocLinkHygiene } from "./graphDocLinks.js";
import { summarizeEcosystemSupportForAgents } from "./graphEcosystemHealth.js";
import {
  evaluateHarnessReadiness,
  type GraphHarnessReadinessSummary,
  type HarnessWorkspaceMetadata,
} from "./graphHarnessReadiness.js";
import {
  evaluateGraphSpecQuality,
  GRAPH_SPEC_QUALITY_GOOD_THRESHOLD,
  type GraphSpecQualitySummary,
} from "./graphSpecQuality.js";
import {
  buildVerificationMap,
  type GraphVerificationMap,
} from "./graphVerificationMap.js";

export const AGENTIC_SDLC_GOOD_THRESHOLD = 70;

export type AgenticSdlcCategoryId =
  | "graph_quality"
  | "context_readiness"
  | "spec_readiness"
  | "verification_readiness"
  | "docs_health"
  | "support_tier_honesty"
  | "provenance_coverage"
  | "update_readiness"
  | "install_package_readiness";

export type AgenticSdlcCategoryStatus = "good" | "moderate" | "needs_attention";

export interface AgenticSdlcScoreCategory {
  id: AgenticSdlcCategoryId;
  label: string;
  score: number;
  status: AgenticSdlcCategoryStatus;
  detail: string;
  gaps: string[];
}

export interface AgenticSdlcScorecard {
  generatedAt: string;
  workspaceRoot: string;
  overallScore: number;
  ok: boolean;
  deterministic: true;
  disclaimer: string;
  categories: AgenticSdlcScoreCategory[];
  knownGaps: string[];
}

export interface BuildAgenticSdlcScorecardInput {
  workspaceRoot: string;
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  metadata?: HarnessWorkspaceMetadata;
  handoffFreshness?: GraphHandoffFreshnessResult;
  fusion?: GraphFusionResult;
  specQuality?: GraphSpecQualitySummary;
  verificationMap?: GraphVerificationMap;
  contextNoise?: GraphContextNoiseSummary;
  harnessReadiness?: GraphHarnessReadinessSummary;
  updateBenchmarkOk?: boolean;
}

function categoryStatus(score: number): AgenticSdlcCategoryStatus {
  if (score >= 80) return "good";
  if (score >= 60) return "moderate";
  return "needs_attention";
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function computeProvenanceCoverage(graph: UnifiedCodeGraph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const scopedEdges = graph.edges.filter((edge) => {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    return source?.kind !== "community" && target?.kind !== "community";
  });
  if (scopedEdges.length === 0) return 100;
  let covered = 0;
  for (const edge of scopedEdges) {
    const needsConfidence = edge.provenance === "inferred" || edge.provenance === "ambiguous";
    const hasConfidence = !needsConfidence || typeof edge.confidence === "number";
    if (edge.provenance && edge.source && hasConfidence) covered += 1;
  }
  return clampScore((covered / scopedEdges.length) * 100);
}

function scoreGraphQuality(fusion: GraphFusionResult, graph: UnifiedCodeGraph) {
  const hardFails = fusion.hardFailCount;
  const warns = fusion.warnCount;
  const symbolCount = graph.nodes.filter((node) => node.kind === "symbol").length;
  let score = 100 - hardFails * 25 - warns * 8;
  if (graph.nodes.length === 0) score -= 40;
  if (symbolCount === 0 && graph.nodes.some((node) => node.kind === "code_file")) score -= 10;
  const gaps = fusion.checks
    .filter((check) => check.severity === "fail" || check.severity === "warn")
    .slice(0, 4)
    .map((check) => check.detail);
  return {
    score: clampScore(score),
    detail: hardFails > 0
      ? `${hardFails} hard graph-quality failure(s) and ${warns} warning(s).`
      : warns > 0
        ? `${warns} graph-quality warning(s); no hard failures.`
        : "Graph quality gates are clean for this workspace export.",
    gaps,
  };
}

function scoreContextReadiness(
  contextNoise: GraphContextNoiseSummary,
  handoffFreshness: GraphHandoffFreshnessResult
) {
  const freshnessScore = handoffFreshness.isStale ? 55 : 100;
  const score = clampScore((contextNoise.score * 0.7) + (freshnessScore * 0.3));
  const gaps = [
    ...contextNoise.noiseItems.slice(0, 3).map((item) => item.path ? `${item.path}: ${item.detail}` : item.detail),
    ...(handoffFreshness.isStale ? [handoffFreshness.detail] : []),
  ];
  return {
    score,
    detail: `Context noise ${contextNoise.score}/100; handoff ${handoffFreshness.isStale ? "stale" : "current"}.`,
    gaps,
  };
}

function scoreSpecReadiness(specQuality: GraphSpecQualitySummary) {
  const gaps = [
    ...specQuality.missing.slice(0, 4).map((item) => `Missing: ${item}`),
    ...specQuality.conflicts.slice(0, 2).map((conflict) => conflict.detail),
  ];
  return {
    score: specQuality.score,
    detail: specQuality.ok
      ? "Agent/setup instructions meet the spec-quality threshold."
      : `${specQuality.missing.length} spec gap(s) and ${specQuality.conflicts.length} conflict(s) detected.`,
    gaps,
  };
}

function scoreVerificationReadiness(verificationMap: GraphVerificationMap) {
  const hasBuild = verificationMap.commands.some((entry) => entry.category === "build" && !entry.risky);
  const hasTest = verificationMap.commands.some((entry) =>
    (entry.category === "unit_test" || entry.category === "integration_test") && !entry.risky
  );
  const hasGraphCheck = verificationMap.commands.some((entry) => entry.category === "graph_verification");
  let score = 35;
  if (hasBuild) score += 20;
  if (hasTest) score += 25;
  if (hasGraphCheck) score += 10;
  if (verificationMap.recommendedDefault.length > 0) score += 10;
  score -= verificationMap.conflicts.length * 12;
  score -= Math.min(verificationMap.gaps.length * 6, 24);

  const gaps = [
    ...verificationMap.gaps.slice(0, 4),
    ...verificationMap.conflicts.slice(0, 2).map((conflict) => conflict.detail),
  ];
  if (!hasTest) gaps.unshift("No non-risky unit/integration test command discovered.");
  if (!hasBuild) gaps.unshift("No non-risky build command discovered.");

  return {
    score: clampScore(score),
    detail: `${verificationMap.commands.length} command(s) mapped; ${verificationMap.recommendedDefault.length} recommended default(s).`,
    gaps: [...new Set(gaps)].slice(0, 6),
  };
}

function scoreDocsHealth(
  graph: UnifiedCodeGraph,
  specQuality: GraphSpecQualitySummary
) {
  const docHygiene = summarizeDocLinkHygiene(graph);
  let score = 100 - docHygiene.brokenCount * 12;
  if (!specQuality.present.some((item) => /architecture/i.test(item))) score -= 12;
  if (!specQuality.present.includes("README.md")) score -= 18;
  const gaps = [
    ...(docHygiene.brokenCount > 0 ? [`${docHygiene.brokenCount} broken documentation link(s).`] : []),
    ...specQuality.risks.filter((risk) => /broken doc/i.test(risk)).slice(0, 3),
  ];
  return {
    score: clampScore(score),
    detail: docHygiene.brokenCount > 0
      ? `${docHygiene.brokenCount} broken doc link(s) affect onboarding docs.`
      : "Documentation links and setup docs look healthy.",
    gaps,
  };
}

function scoreSupportTierHonesty(
  graph: UnifiedCodeGraph,
  kernelProfile?: WorkspaceKernelProfile
) {
  const matrix = summarizeEcosystemSupportForAgents({ graph, kernelProfile });
  const structuralOnly = matrix.filter((row) => !row.semanticSupported || row.tier === "T2" || row.tier === "T3");
  const undisclosedHighFileCount = structuralOnly.length > 0
    && graph.nodes.filter((node) => ["code_file", "config_file"].includes(node.kind)).length >= 12
    && !graph.diagnostics.some((line) => /T2|T3|structural-only|honest file-level/i.test(line));
  let score = 100;
  if (structuralOnly.length > 0) score -= Math.min(structuralOnly.length * 8, 32);
  if (undisclosedHighFileCount) score -= 15;

  const gaps = structuralOnly
    .slice(0, 4)
    .map((row) => `${row.scannerId} (${row.tier}): ${row.limitation}`);
  if (undisclosedHighFileCount) {
    gaps.push("Large structural-only workspace without explicit limitation diagnostics.");
  }

  return {
    score: clampScore(score),
    detail: structuralOnly.length > 0
      ? `${structuralOnly.length} ecosystem(s) are structural-only or lower-trust for agents.`
      : "Support tiers are disclosed with semantic coverage where available.",
    gaps,
  };
}

function scoreUpdateReadiness(
  handoffFreshness: GraphHandoffFreshnessResult,
  updateBenchmarkOk?: boolean
) {
  let score = handoffFreshness.isStale ? 50 : 92;
  if (updateBenchmarkOk === false) score -= 25;
  if (updateBenchmarkOk === true) score += 4;
  const gaps = [
    ...(handoffFreshness.isStale ? [handoffFreshness.detail] : []),
    ...(updateBenchmarkOk === false ? ["Graph update benchmarks failed in the latest public scorecard run."] : []),
  ];
  return {
    score: clampScore(score),
    detail: handoffFreshness.isStale
      ? "Handoff artifacts are stale relative to the latest graph export."
      : updateBenchmarkOk === false
        ? "Handoff is current, but update benchmarks reported failures."
        : "Handoff freshness and update posture look current.",
    gaps,
  };
}

function scoreInstallPackageReadiness(harnessReadiness: GraphHarnessReadinessSummary) {
  const installSignals = ["setup_instructions", "package_scripts", "package.json"];
  const presentInstallSignals = harnessReadiness.present.filter((item) => installSignals.includes(item));
  let score = harnessReadiness.score;
  if (!harnessReadiness.present.includes("setup_instructions")) score = Math.min(score, 55);
  if (!harnessReadiness.present.includes("package_scripts") && !harnessReadiness.present.includes("package.json")) {
    score = Math.min(score, 45);
  }

  const gaps = [
    ...harnessReadiness.missing
      .filter((item) => ["setup_instructions", "package_scripts", "test_instructions", "build_instructions"].includes(item))
      .map((item) => `Missing: ${item}`),
    ...harnessReadiness.conflicts.map((conflict) => conflict.detail),
  ];

  return {
    score: clampScore(score),
    detail: presentInstallSignals.length > 0
      ? "Install/package signals are present for agent onboarding."
      : "Install or package-script guidance is sparse for agent onboarding.",
    gaps: gaps.slice(0, 6),
  };
}

export function buildAgenticSdlcScorecard(input: BuildAgenticSdlcScorecardInput): AgenticSdlcScorecard {
  const specQuality = input.specQuality
    ?? evaluateGraphSpecQuality(input.graph, { metadata: input.metadata });
  const verificationMap = input.verificationMap
    ?? buildVerificationMap(input.graph, input.metadata ?? {});
  const contextNoise = input.contextNoise
    ?? evaluateContextNoise(input.graph);
  const harnessReadiness = input.harnessReadiness
    ?? evaluateHarnessReadiness(input.graph, {
      profile: input.kernelProfile,
      metadata: input.metadata,
    });
  const handoffFreshness = input.handoffFreshness
    ?? evaluateHandoffFreshness({
      graphGeneratedAt: input.graph.generatedAt,
      handoffPath: "GRAPH_REPORT.md",
    });
  const fusion = input.fusion
    ?? evaluateOagFusionChecks({
      graph: input.graph,
      kernelProfile: input.kernelProfile,
      handoffFreshness,
    });

  const categoryBuilders: Array<{ id: AgenticSdlcCategoryId; label: string; result: ReturnType<typeof scoreGraphQuality> }> = [
    { id: "graph_quality", label: "Graph quality", result: scoreGraphQuality(fusion, input.graph) },
    { id: "context_readiness", label: "Context readiness", result: scoreContextReadiness(contextNoise, handoffFreshness) },
    { id: "spec_readiness", label: "Spec readiness", result: scoreSpecReadiness(specQuality) },
    { id: "verification_readiness", label: "Verification readiness", result: scoreVerificationReadiness(verificationMap) },
    { id: "docs_health", label: "Docs health", result: scoreDocsHealth(input.graph, specQuality) },
    { id: "support_tier_honesty", label: "Support tier honesty", result: scoreSupportTierHonesty(input.graph, input.kernelProfile) },
    { id: "provenance_coverage", label: "Provenance coverage", result: {
      score: computeProvenanceCoverage(input.graph),
      detail: "Measures how many non-community edges carry provenance and confidence metadata.",
      gaps: [],
    } },
    { id: "update_readiness", label: "Update readiness", result: scoreUpdateReadiness(handoffFreshness, input.updateBenchmarkOk) },
    { id: "install_package_readiness", label: "Install/package readiness", result: scoreInstallPackageReadiness(harnessReadiness) },
  ];

  const categories: AgenticSdlcScoreCategory[] = categoryBuilders.map((entry) => ({
    id: entry.id,
    label: entry.label,
    score: entry.result.score,
    status: categoryStatus(entry.result.score),
    detail: entry.result.detail,
    gaps: entry.result.gaps,
  }));

  const overallScore = clampScore(
    categories.reduce((sum, category) => sum + category.score, 0) / categories.length
  );
  const knownGaps = [
    ...categories.flatMap((category) => category.gaps.map((gap) => `${category.label}: ${gap}`)),
    ...(specQuality.score < GRAPH_SPEC_QUALITY_GOOD_THRESHOLD
      ? ["Spec readiness is below the recommended agent-onboarding threshold."]
      : []),
  ].slice(0, 12);

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    overallScore,
    ok: overallScore >= AGENTIC_SDLC_GOOD_THRESHOLD
      && categories.filter((category) => category.status === "needs_attention").length <= 2,
    deterministic: true,
    disclaimer: "Deterministic local readiness only. A high score means the repo harness and graph context look agent-ready; it does not mean the code is correct.",
    categories,
    knownGaps: [...new Set(knownGaps)],
  };
}

export function formatAgenticSdlcScorecardMarkdown(scorecard: AgenticSdlcScorecard): string {
  const lines = [
    "# Agentic SDLC readiness scorecard",
    "",
    `Generated: ${scorecard.generatedAt}`,
    `Workspace: ${scorecard.workspaceRoot}`,
    "",
    scorecard.disclaimer,
    "",
    `- Overall score: ${scorecard.overallScore}/100 (${scorecard.ok ? "READY" : "NEEDS ATTENTION"})`,
    "",
    "## Categories",
    "",
    "| Category | Score | Status | Detail |",
    "| --- | ---: | --- | --- |",
    ...scorecard.categories.map((category) =>
      `| ${category.label} | ${category.score}/100 | ${category.status} | ${category.detail} |`
    ),
    "",
  ];

  if (scorecard.knownGaps.length > 0) {
    lines.push("## Known gaps", "");
    for (const gap of scorecard.knownGaps) {
      lines.push(`- ${gap}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function summarizeAgenticSdlcScorecardHuman(scorecard: AgenticSdlcScorecard): string[] {
  const lowest = [...scorecard.categories].sort((left, right) => left.score - right.score).slice(0, 3);
  return [
    `Agentic SDLC readiness: ${scorecard.overallScore}/100 (${scorecard.ok ? "good" : "needs attention"})`,
    ...lowest.map((category) => `${category.label}: ${category.score}/100 (${category.status})`),
  ];
}