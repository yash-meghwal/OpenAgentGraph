import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import { formatGraphAnalyzerDiagnostics } from "./graphAnalyzers.js";
import {
  evaluateContextNoise,
  type ContextNoiseDiagnostics,
  type GraphContextNoiseSummary,
} from "./graphContextNoise.js";
import { summarizeDocLinkRepair } from "./graphDocRepair.js";
import { summarizeEcosystemSupportForAgents } from "./graphEcosystemHealth.js";
import { evaluateHandoffFreshness, type GraphHandoffFreshnessResult } from "./graphFusion.js";
import {
  evaluateGraphSpecQuality,
  GRAPH_SPEC_QUALITY_GOOD_THRESHOLD,
  type GraphSpecQualitySummary,
} from "./graphSpecQuality.js";
import { getReadTheseFirstNodes } from "./graphReadFirst.js";
import {
  type HarnessWorkspaceMetadata,
} from "./graphHarnessReadiness.js";
import {
  buildVerificationMap,
  type GraphVerificationMap,
} from "./graphVerificationMap.js";

export interface GraphAgentHarnessReportSummary {
  ok: boolean;
  specQualityScore: number;
  contextNoiseScore: number;
  readBeforeCoding: string[];
  verifyBeforeDone: string[];
  guardrailCommands: Array<{ command: string; category: string; confidence: string }>;
  missingInstructions: string[];
  conflictingInstructions: string[];
  contextNoiseHighlights: string[];
  setupChecklist: string[];
  structuralOnlyEcosystems: string[];
  graphFreshness: GraphHandoffFreshnessResult;
  provenanceSummary: string;
  docsRepairSummary: string;
  analyzerLines: string[];
  verificationGaps: string[];
}

export interface BuildAgentHarnessReportInput {
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  metadata?: HarnessWorkspaceMetadata;
  handoffFreshness?: GraphHandoffFreshnessResult;
  handoffPath?: string;
  contextNoiseDiagnostics?: ContextNoiseDiagnostics;
  specQuality?: GraphSpecQualitySummary;
  verificationMap?: GraphVerificationMap;
  contextNoise?: GraphContextNoiseSummary;
}

function structuralOnlyEcosystems(
  graph: UnifiedCodeGraph,
  kernelProfile?: WorkspaceKernelProfile
) {
  return summarizeEcosystemSupportForAgents({ graph, kernelProfile })
    .filter((row) => !row.semanticSupported || row.tier === "T1" || row.tier === "T3")
    .map((row) => `${row.scannerId} (${row.tier}): ${row.limitation}`);
}

function guardrailCommandsFromMap(verificationMap: GraphVerificationMap) {
  const entries = verificationMap.commands.filter((entry) =>
    entry.risky
    || entry.category === "risky"
    || entry.category === "release"
    || entry.category === "packaging"
  );
  return [...new Map(entries.map((entry) => [entry.command, entry])).values()]
    .slice(0, 8)
    .map((entry) => ({
      command: entry.command,
      category: entry.category,
      confidence: entry.confidence,
    }));
}

function verifyCommandsFromMap(verificationMap: GraphVerificationMap) {
  const commands = [
    ...verificationMap.recommendedDefault,
    ...verificationMap.taskHints.flatMap((hint) => hint.commands),
  ];
  return [...new Set(commands)].slice(0, 8);
}

function buildProvenanceSummary(graph: UnifiedCodeGraph) {
  const extractedEdgeCount = graph.edges.filter((edge) => edge.provenance === "extracted").length;
  const inferredEdgeCount = graph.edges.filter((edge) => edge.provenance === "inferred").length;
  const extractedPercent = graph.edges.length > 0
    ? Math.round((extractedEdgeCount / graph.edges.length) * 100)
    : 0;
  return `${extractedPercent}% extracted edges (${extractedEdgeCount}/${graph.edges.length}); ${inferredEdgeCount} inferred.`;
}

function readBeforeCodingPaths(
  graph: UnifiedCodeGraph,
  specQuality: GraphSpecQualitySummary
) {
  const readFirst = getReadTheseFirstNodes(graph)
    .map((node) => node.path ?? node.label)
    .filter(Boolean);
  const instructionDocs = specQuality.present.filter((item) =>
    /^(README\.md|AGENTS\.md|CLAUDE\.md|GEMINI\.md|llms\.txt|LLMS\.md|CONTRIBUTING\.md|docs\/)/i.test(item)
    || item.includes("copilot-instructions")
  );
  return [...new Set([...instructionDocs, ...readFirst])].slice(0, 12);
}

function buildSetupChecklist(
  specQuality: GraphSpecQualitySummary,
  verificationMap: GraphVerificationMap,
  contextNoise: GraphContextNoiseSummary
) {
  return [...new Set([
    ...specQuality.recommendations,
    ...verificationMap.gaps.map((gap) => gap.replace(/\.$/, "")),
    ...contextNoise.recommendations,
  ])].slice(0, 10);
}

export function buildAgentHarnessReport(input: BuildAgentHarnessReportInput): GraphAgentHarnessReportSummary {
  const specQuality = input.specQuality
    ?? evaluateGraphSpecQuality(input.graph, { metadata: input.metadata });
  const verificationMap = input.verificationMap
    ?? buildVerificationMap(input.graph, input.metadata ?? {});
  const contextNoise = input.contextNoise
    ?? evaluateContextNoise(input.graph, input.contextNoiseDiagnostics ?? {});
  const docsRepair = summarizeDocLinkRepair(input.graph);
  const provenanceSummary = buildProvenanceSummary(input.graph);
  const handoffFreshness = input.handoffFreshness
    ?? evaluateHandoffFreshness({
      graphGeneratedAt: input.graph.generatedAt,
      handoffPath: input.handoffPath ?? "GRAPH_REPORT.md",
    });

  const conflictingInstructions = [
    ...specQuality.conflicts.map((conflict) => conflict.detail),
    ...verificationMap.conflicts.map((conflict) => conflict.detail),
  ].slice(0, 8);

  const missingInstructions = [
    ...specQuality.missing,
    ...verificationMap.gaps,
  ].slice(0, 10);

  const analyzerLines = input.graph.analyzers?.length
    ? formatGraphAnalyzerDiagnostics(input.graph.analyzers).slice(0, 6)
    : ["No optional analyzer metadata recorded for this export."];

  const docsRepairSummary = docsRepair.brokenCount > 0
    ? `${docsRepair.brokenCount} broken doc link(s); ${docsRepair.actionableCount} actionable repair proposal(s).`
    : "No broken documentation links detected.";

  const ok = specQuality.ok
    && contextNoise.score >= 70
    && conflictingInstructions.length === 0
    && !handoffFreshness.isStale;

  return {
    ok,
    specQualityScore: specQuality.score,
    contextNoiseScore: contextNoise.score,
    readBeforeCoding: readBeforeCodingPaths(input.graph, specQuality),
    verifyBeforeDone: verifyCommandsFromMap(verificationMap),
    guardrailCommands: guardrailCommandsFromMap(verificationMap),
    missingInstructions,
    conflictingInstructions,
    contextNoiseHighlights: contextNoise.noiseItems
      .slice(0, 6)
      .map((item) => item.path ? `${item.kind}: ${item.path} — ${item.detail}` : `${item.kind}: ${item.detail}`),
    setupChecklist: buildSetupChecklist(specQuality, verificationMap, contextNoise),
    structuralOnlyEcosystems: structuralOnlyEcosystems(input.graph, input.kernelProfile).slice(0, 6),
    graphFreshness: handoffFreshness,
    provenanceSummary: provenanceSummary,
    docsRepairSummary,
    analyzerLines,
    verificationGaps: verificationMap.gaps.slice(0, 6),
  };
}

export function formatAgentHarnessReportMarkdown(summary: GraphAgentHarnessReportSummary): string[] {
  const lines = [
    "## Agentic SDLC harness",
    "",
    `- Harness status: ${summary.ok ? "READY" : "NEEDS ATTENTION"}`,
    `- Spec quality: ${summary.specQualityScore}/100 (min ${GRAPH_SPEC_QUALITY_GOOD_THRESHOLD})`,
    `- Context noise: ${summary.contextNoiseScore}/100`,
    `- Graph handoff: ${summary.graphFreshness.isStale ? "stale" : "current"} — ${summary.graphFreshness.detail}`,
    `- Edge provenance: ${summary.provenanceSummary}`,
    `- Docs repair: ${summary.docsRepairSummary}`,
    "",
    "### Read before coding",
    "",
    ...(summary.readBeforeCoding.length > 0
      ? summary.readBeforeCoding.map((item) => `- \`${item}\``)
      : ["- No read-first files or instruction docs detected."]),
    "",
    "### Verify before claiming done",
    "",
    ...(summary.verifyBeforeDone.length > 0
      ? summary.verifyBeforeDone.map((command) => `- \`${command}\``)
      : ["- No verification commands discovered; run `graph:check` after adding package scripts or CI workflows."]),
    "",
    "### Guardrails and risky commands",
    "",
    ...(summary.guardrailCommands.length > 0
      ? summary.guardrailCommands.map((entry) =>
        `- \`${entry.command}\` (${entry.category}, ${entry.confidence})`
      )
      : ["- No risky or release commands discovered."]),
    "",
    "### Missing or conflicting instructions",
    "",
  ];

  if (summary.missingInstructions.length > 0) {
    lines.push("**Missing**", "");
    for (const item of summary.missingInstructions.slice(0, 8)) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (summary.conflictingInstructions.length > 0) {
    lines.push("**Conflicts**", "");
    for (const item of summary.conflictingInstructions.slice(0, 6)) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (summary.missingInstructions.length === 0 && summary.conflictingInstructions.length === 0) {
    lines.push("- No missing or conflicting agent instructions detected.", "");
  }

  lines.push(
    "### Context noise",
    "",
    ...(summary.contextNoiseHighlights.length > 0
      ? summary.contextNoiseHighlights.map((item) => `- ${item}`)
      : ["- No significant context noise detected."]),
    "",
    "### Agent setup checklist",
    "",
    ...(summary.setupChecklist.length > 0
      ? summary.setupChecklist.map((item) => `- ${item}`)
      : ["- Harness docs and verification commands look sufficient for agent onboarding."]),
    "",
  );

  if (summary.structuralOnlyEcosystems.length > 0) {
    lines.push("### Structural-only ecosystems", "");
    for (const item of summary.structuralOnlyEcosystems) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (summary.analyzerLines.length > 0) {
    lines.push("### Optional analyzers", "");
    for (const line of summary.analyzerLines) {
      lines.push(`- ${line}`);
    }
    lines.push("");
  }

  return lines;
}

export function formatAgentHarnessReportHtml(summary: GraphAgentHarnessReportSummary) {
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return "";
    const list = items.slice(0, 6).map((item) => `<li>${escapeHarnessHtml(item)}</li>`).join("");
    return `<h3>${escapeHarnessHtml(title)}</h3><ul>${list}</ul>`;
  };

  return `
    <p class="meta">Status: ${summary.ok ? "READY" : "NEEDS ATTENTION"} · Spec ${summary.specQualityScore}/100 · Noise ${summary.contextNoiseScore}/100 · Handoff ${summary.graphFreshness.isStale ? "stale" : "current"}</p>
    ${section("Read before coding", summary.readBeforeCoding.map((item) => item))}
    ${section("Verify before claiming done", summary.verifyBeforeDone)}
    ${section("Guardrails", summary.guardrailCommands.map((entry) => `${entry.command} (${entry.category})`))}
    ${section("Missing or conflicts", [...summary.missingInstructions, ...summary.conflictingInstructions])}
    ${section("Context noise", summary.contextNoiseHighlights)}
    ${section("Setup checklist", summary.setupChecklist)}
  `;
}

function escapeHarnessHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}