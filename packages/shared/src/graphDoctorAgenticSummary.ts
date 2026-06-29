import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import { buildAgenticSdlcScorecard } from "./graphAgenticSdlcScorecard.js";
import { evaluateContextNoise, type GraphContextNoiseSummary } from "./graphContextNoise.js";
import { summarizeDocLinkHygiene } from "./graphDocLinks.js";
import { summarizeDocLinkRepair } from "./graphDocRepair.js";
import { summarizeEcosystemSupportForAgents } from "./graphEcosystemHealth.js";
import type { GraphHandoffFreshnessResult } from "./graphFusion.js";
import {
  evaluateGraphSpecQuality,
  GRAPH_SPEC_QUALITY_GOOD_THRESHOLD,
  type GraphSpecQualitySummary,
} from "./graphSpecQuality.js";
import type { HarnessWorkspaceMetadata } from "./graphHarnessReadiness.js";
import {
  buildVerificationMap,
  type GraphVerificationMap,
  type VerificationCommandCategory,
} from "./graphVerificationMap.js";

export type DoctorReadinessLabel = "good" | "needs_attention";
export type DoctorNoiseLabel = "low" | "moderate" | "high";

export interface DoctorAgenticReadinessSummary {
  overallScore: number;
  ok: boolean;
  specQuality: {
    score: number;
    label: DoctorReadinessLabel;
    present: string[];
    missing: string[];
  };
  verificationMap: {
    summary: string;
    categoriesFound: string[];
    recommendedDefaults: string[];
    gapCount: number;
  };
  contextNoise: {
    score: number;
    label: DoctorNoiseLabel;
  };
  docsHealth: {
    brokenCount: number;
    repairActionableCount: number;
  };
  supportTiers: {
    summary: string;
    structuralOnlyCount: number;
    ecosystems: Array<{ scannerId: string; tier: string; semanticSupported: boolean }>;
  };
}

const VERIFICATION_CATEGORY_LABELS: Partial<Record<VerificationCommandCategory, string>> = {
  install: "install",
  build: "build",
  typecheck: "typecheck",
  lint: "lint",
  unit_test: "test",
  integration_test: "integration-test",
  graph_verification: "graph-check",
  docs_check: "docs-check",
};

function specQualityLabel(score: number, ok: boolean): DoctorReadinessLabel {
  return ok || score >= GRAPH_SPEC_QUALITY_GOOD_THRESHOLD ? "good" : "needs_attention";
}

function contextNoiseLabel(score: number): DoctorNoiseLabel {
  if (score >= 80) return "low";
  if (score >= 60) return "moderate";
  return "high";
}

export function summarizeVerificationMapForDoctor(map: GraphVerificationMap) {
  const categoriesFound = [...new Set(
    map.commands
      .filter((entry) => !entry.risky)
      .map((entry) => VERIFICATION_CATEGORY_LABELS[entry.category] ?? entry.category)
  )];
  let summary: string;
  if (categoriesFound.length > 0) {
    summary = `${categoriesFound.join("/")} found`;
  } else if (map.gaps.length > 0) {
    summary = "gaps detected";
  } else {
    summary = "none discovered";
  }
  return {
    summary,
    categoriesFound,
    recommendedDefaults: map.recommendedDefault,
    gapCount: map.gaps.length,
  };
}

export function summarizeSupportTiersForDoctor(
  graph: UnifiedCodeGraph,
  kernelProfile?: WorkspaceKernelProfile
) {
  const ecosystems = summarizeEcosystemSupportForAgents({ graph, kernelProfile }).map((row) => ({
    scannerId: row.scannerId,
    tier: row.tier,
    semanticSupported: row.semanticSupported,
  }));
  const structuralOnly = ecosystems.filter((row) => !row.semanticSupported || row.tier === "T3");
  const summary = structuralOnly.length > 0
    ? `${structuralOnly.length} structural-only ecosystem(s)`
    : "semantic support available";
  return {
    summary,
    structuralOnlyCount: structuralOnly.length,
    ecosystems,
  };
}

export function buildDoctorAgenticReadinessSummary(input: {
  workspaceRoot: string;
  graph: UnifiedCodeGraph;
  metadata?: HarnessWorkspaceMetadata;
  kernelProfile?: WorkspaceKernelProfile;
  handoffFreshness?: GraphHandoffFreshnessResult;
  contextNoise?: GraphContextNoiseSummary;
  specQuality?: GraphSpecQualitySummary;
  verificationMap?: GraphVerificationMap;
}): DoctorAgenticReadinessSummary {
  const specQuality = input.specQuality
    ?? evaluateGraphSpecQuality(input.graph, { metadata: input.metadata });
  const verificationMap = input.verificationMap
    ?? buildVerificationMap(input.graph, input.metadata);
  const contextNoise = input.contextNoise ?? evaluateContextNoise(input.graph);
  const docHygiene = summarizeDocLinkHygiene(input.graph);
  const docRepair = summarizeDocLinkRepair(input.graph);
  const scorecard = buildAgenticSdlcScorecard({
    workspaceRoot: input.workspaceRoot,
    graph: input.graph,
    kernelProfile: input.kernelProfile,
    metadata: input.metadata,
    handoffFreshness: input.handoffFreshness,
    specQuality,
    verificationMap,
    contextNoise,
  });

  return {
    overallScore: scorecard.overallScore,
    ok: scorecard.ok,
    specQuality: {
      score: specQuality.score,
      label: specQualityLabel(specQuality.score, specQuality.ok),
      present: specQuality.present,
      missing: specQuality.missing,
    },
    verificationMap: summarizeVerificationMapForDoctor(verificationMap),
    contextNoise: {
      score: contextNoise.score,
      label: contextNoiseLabel(contextNoise.score),
    },
    docsHealth: {
      brokenCount: docHygiene.brokenCount,
      repairActionableCount: docRepair.actionableCount,
    },
    supportTiers: summarizeSupportTiersForDoctor(input.graph, input.kernelProfile),
  };
}

export function formatDoctorAgenticReadinessHuman(summary: DoctorAgenticReadinessSummary): string[] {
  const docsLine = summary.docsHealth.brokenCount === 0
    ? "Docs health: no broken links"
    : `Docs health: ${summary.docsHealth.brokenCount} broken link${summary.docsHealth.brokenCount === 1 ? "" : "s"}`;
  return [
    `Agentic readiness: ${summary.overallScore}/100`,
    `Spec quality: ${summary.specQuality.label}`,
    `Verification map: ${summary.verificationMap.summary}`,
    `Context noise: ${summary.contextNoise.label}`,
    docsLine,
  ];
}