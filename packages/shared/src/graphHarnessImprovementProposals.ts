import type { DocLinkDiagnostic } from "./graphDocLinks.js";
import type { GraphContextNoiseSummary } from "./graphContextNoise.js";
import type { GraphFusionCheck } from "./graphFusion.js";
import type { GraphHandoffFreshnessResult } from "./graphFusion.js";
import type { GraphSpecQualitySummary } from "./graphSpecQuality.js";
import type { GraphVerificationMap } from "./graphVerificationMap.js";
import type { GraphLearnFinding } from "./graphLearnProposal.js";
import type { DocLinkRepairSummary } from "./graphDocRepair.js";
import type { GraphAgentHarnessReportSummary } from "./graphAgentHarnessReport.js";
import { sanitizeOperationalText } from "./safeText.js";

export type HarnessFailureKind = "harness_failure" | "model_failure" | "unknown";

export type HarnessImprovementCategory =
  | "missing_setup_command"
  | "missing_test_command"
  | "conflicting_agent_instructions"
  | "broken_architecture_doc_link"
  | "stale_graph_export"
  | "missing_generated_artifact_ignore"
  | "unsupported_ecosystem_gap"
  | "verification_map_gap"
  | "docs_hygiene"
  | "path_query_miss"
  | "update_benchmark_failure"
  | "missing_agent_instructions"
  | "other";

export type HarnessImprovementConfidence = "high" | "medium" | "low";

export interface HarnessImprovementProposal {
  id: string;
  category: HarnessImprovementCategory;
  title: string;
  failureKind: HarnessFailureKind;
  evidence: string[];
  affectedPath?: string;
  suggestedEdit: string;
  confidence: HarnessImprovementConfidence;
  reproduceCommand: string;
  safeForAgentAutoApply: false;
}

export interface HarnessImprovementProposalResult {
  generatedAt: string;
  workspaceRoot: string;
  proposalCount: number;
  harnessFailureCount: number;
  modelFailureCount: number;
  proposals: HarnessImprovementProposal[];
  markdown: string;
  reviewOnlyDisclaimer: string;
}

export interface EcosystemSupportRow {
  scannerId: string;
  label: string;
  tier: string;
  semanticSupported: boolean;
  limitation: string;
}

export interface BuildHarnessImprovementProposalsInput {
  workspaceRoot: string;
  specQuality?: GraphSpecQualitySummary;
  contextNoise?: GraphContextNoiseSummary;
  verificationMap?: GraphVerificationMap;
  handoffFreshness?: GraphHandoffFreshnessResult;
  docLinkDiagnostics?: DocLinkDiagnostic[];
  docsRepair?: DocLinkRepairSummary;
  agentHarnessReport?: GraphAgentHarnessReportSummary;
  fusionChecks?: GraphFusionCheck[];
  ecosystemSupport?: EcosystemSupportRow[];
  updateBenchmarkFailures?: string[];
  pathQueryMisses?: Array<{
    kind: "path" | "query";
    detail: string;
    from?: string;
    to?: string;
    query?: string;
  }>;
  learnLogFindings?: GraphLearnFinding[];
}

const REVIEW_ONLY_DISCLAIMER =
  "Review-only proposals. OAG does not auto-edit AGENTS.md, README.md, LLMS.md, or source files.";

const MAX_EVIDENCE_LINES = 4;
const MAX_SNIPPET_LENGTH = 240;

function sanitizedWorkspaceLabel(workspaceRoot: string) {
  return sanitizeOperationalText(workspaceRoot, { workspaceRoot, maxLength: 160 });
}

function quoteWorkspace(workspaceRoot: string) {
  const label = sanitizedWorkspaceLabel(workspaceRoot);
  return label.includes(" ") ? `"${label}"` : label;
}

function defaultReproduceCommand(workspaceRoot: string) {
  return `npm run graph:check -- --workspace ${quoteWorkspace(workspaceRoot)} --json`;
}

function learnLogReproduceCommand(workspaceRoot: string) {
  return `npm run graph:learn -- --workspace ${quoteWorkspace(workspaceRoot)} --from-log <agent-log> --json`;
}

export function parsePathQueryMissEndpoints(detail: string): { from?: string; to?: string } {
  const match = detail.match(/path from (.+?) to (.+?)(?:\s+not found)?$/i);
  if (!match) return {};
  return { from: match[1].trim(), to: match[2].trim() };
}

function quoteCliArg(value: string) {
  return value.includes(" ") ? `"${value}"` : value;
}

function reproduceCommandForPathMiss(
  workspaceRoot: string,
  miss: { from?: string; to?: string; detail: string }
) {
  const parsed = miss.from && miss.to
    ? { from: miss.from, to: miss.to }
    : parsePathQueryMissEndpoints(miss.detail);
  if (parsed.from && parsed.to) {
    return `npm run graph:path -- --workspace ${quoteWorkspace(workspaceRoot)} ${quoteCliArg(parsed.from)} ${quoteCliArg(parsed.to)} --json`;
  }
  return `npm run graph:path -- --workspace ${quoteWorkspace(workspaceRoot)} "<from>" "<to>" --json`;
}

function reproduceCommandForQueryMiss(
  workspaceRoot: string,
  miss: { query?: string; detail: string }
) {
  if (miss.query?.trim()) {
    return `npm run graph:query -- --workspace ${quoteWorkspace(workspaceRoot)} ${quoteCliArg(miss.query)} --json`;
  }
  return `npm run graph:query -- --workspace ${quoteWorkspace(workspaceRoot)} "<query>" --json`;
}

function sanitizeEvidenceLine(line: string, workspaceRoot: string): string {
  return sanitizeOperationalText(line, { workspaceRoot, maxLength: MAX_SNIPPET_LENGTH });
}

function pushProposal(
  proposals: HarnessImprovementProposal[],
  seen: Set<string>,
  proposal: Omit<HarnessImprovementProposal, "safeForAgentAutoApply">
) {
  const key = `${proposal.category}:${proposal.title}:${proposal.affectedPath ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  proposals.push({ ...proposal, safeForAgentAutoApply: false });
}

function proposalsFromSpecQuality(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  const spec = input.specQuality;
  if (!spec) return;
  const reproduce = defaultReproduceCommand(input.workspaceRoot);

  if (spec.missing.includes("setup_instructions")) {
    pushProposal(proposals, seen, {
      id: "missing_setup_command",
      category: "missing_setup_command",
      title: "Missing setup command",
      failureKind: "harness_failure",
      evidence: spec.recommendations.filter((line) => /install|setup/i.test(line)).slice(0, MAX_EVIDENCE_LINES)
        .map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      affectedPath: "README.md",
      suggestedEdit: "Document install/setup commands (for example `npm ci`) in README.md before agent onboarding.",
      confidence: "high",
      reproduceCommand: reproduce,
    });
  }

  if (spec.missing.includes("test_instructions") || spec.missing.includes("test_command")) {
    pushProposal(proposals, seen, {
      id: "missing_test_command",
      category: "missing_test_command",
      title: "Missing focused test command",
      failureKind: "harness_failure",
      evidence: [
        ...spec.missing.filter((item) => /test/i.test(item)),
        ...spec.recommendations.filter((line) => /test/i.test(line)),
      ].slice(0, MAX_EVIDENCE_LINES).map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      affectedPath: "package.json",
      suggestedEdit: "Add a focused unit-test script and document it in README.md and agent instruction files.",
      confidence: "high",
      reproduceCommand: reproduce,
    });
  }

  if (spec.missing.includes("agent_instructions")) {
    pushProposal(proposals, seen, {
      id: "missing_agent_instructions",
      category: "missing_agent_instructions",
      title: "Missing agent instructions",
      failureKind: "harness_failure",
      evidence: spec.missing.slice(0, MAX_EVIDENCE_LINES).map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      affectedPath: "AGENTS.md",
      suggestedEdit: "Add AGENTS.md or llms.txt describing repo guardrails, verification commands, and files to read first.",
      confidence: "high",
      reproduceCommand: reproduce,
    });
  }

  for (const conflict of spec.conflicts) {
    const isAgentConflict = /agent instruction|test runner|test command/i.test(conflict.detail);
    pushProposal(proposals, seen, {
      id: `conflict_${conflict.kind}`,
      category: isAgentConflict ? "conflicting_agent_instructions" : "verification_map_gap",
      title: isAgentConflict ? "Conflicting agent instructions" : "Conflicting verification guidance",
      failureKind: "harness_failure",
      evidence: [conflict.detail, ...conflict.sources].slice(0, MAX_EVIDENCE_LINES)
        .map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      affectedPath: conflict.sources[0],
      suggestedEdit: isAgentConflict
        ? "Align AGENTS.md, CLAUDE.md, README.md, and package scripts on one primary test command."
        : "Pick one primary test/build command and reflect it consistently in README, CI, and package scripts.",
      confidence: "high",
      reproduceCommand: reproduce,
    });
  }
}

function proposalsFromContextNoise(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  const noise = input.contextNoise;
  if (!noise) return;
  const reproduce = `npm run graph:check -- --workspace ${quoteWorkspace(input.workspaceRoot)} --json`;

  for (const item of noise.noiseItems) {
    if (item.kind === "generated_artifact") {
      pushProposal(proposals, seen, {
        id: `generated_artifact_${item.path ?? "unknown"}`,
        category: "missing_generated_artifact_ignore",
        title: "Missing generated-artifact ignore",
        failureKind: "harness_failure",
        evidence: [item.detail, item.path ? `Indexed path: ${item.path}` : ""].filter(Boolean)
          .map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
        affectedPath: item.path ?? ".gitignore",
        suggestedEdit: "Stop tracking generated artifacts; add dist/build/coverage/.oag patterns to .gitignore.",
        confidence: "high",
        reproduceCommand: reproduce,
      });
      continue;
    }

    if (item.kind === "stale_plan") {
      pushProposal(proposals, seen, {
        id: `stale_plan_${item.path ?? "root"}`,
        category: "other",
        title: "Stale plan file at repo root",
        failureKind: "harness_failure",
        evidence: [item.detail].map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
        affectedPath: item.path,
        suggestedEdit: "Archive or remove stale root-level plan files after the work completes.",
        confidence: "medium",
        reproduceCommand: reproduce,
      });
      continue;
    }

    if (item.kind === "missing_gitignore_protection") {
      pushProposal(proposals, seen, {
        id: `gitignore_${item.detail}`,
        category: "missing_generated_artifact_ignore",
        title: "Missing generated-artifact ignore",
        failureKind: "harness_failure",
        evidence: [item.detail].map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
        affectedPath: ".gitignore",
        suggestedEdit: "Add common generated directories (dist, build, coverage, .oag) to .gitignore.",
        confidence: "medium",
        reproduceCommand: reproduce,
      });
    }

    if (item.kind === "unsupported_ecosystem") {
      pushProposal(proposals, seen, {
        id: `ecosystem_noise_${item.detail}`,
        category: "unsupported_ecosystem_gap",
        title: "Unsupported ecosystem gap",
        failureKind: "harness_failure",
        evidence: [item.detail].map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
        suggestedEdit: "Document structural-only coverage limits and inspect source directly for unsupported ecosystems.",
        confidence: "medium",
        reproduceCommand: reproduce,
      });
    }
  }
}

function proposalsFromVerificationMap(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  const map = input.verificationMap;
  if (!map) return;
  const reproduce = defaultReproduceCommand(input.workspaceRoot);

  for (const gap of map.gaps) {
    const category: HarnessImprovementCategory = /test/i.test(gap)
      ? "missing_test_command"
      : /build/i.test(gap)
        ? "verification_map_gap"
        : "verification_map_gap";
    pushProposal(proposals, seen, {
      id: `verification_gap_${gap}`,
      category,
      title: /test/i.test(gap) ? "Missing focused test command" : "Verification map gap",
      failureKind: "harness_failure",
      evidence: [gap].map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      suggestedEdit: gap,
      confidence: "medium",
      reproduceCommand: reproduce,
    });
  }
}

function proposalsFromDocs(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  const diagnostics = input.docLinkDiagnostics ?? [];
  const reproduce = `npm run graph:docs:check -- --workspace ${quoteWorkspace(input.workspaceRoot)} --json --suggest`;

  for (const diagnostic of diagnostics.slice(0, 8)) {
    const architectureRelated = /architecture|contributing|readme|setup|agent/i.test(diagnostic.sourcePath)
      || /architecture|contributing|setup/i.test(diagnostic.rawTarget);
    pushProposal(proposals, seen, {
      id: `doc_link_${diagnostic.sourcePath}_${diagnostic.line ?? 0}_${diagnostic.rawTarget}`,
      category: architectureRelated ? "broken_architecture_doc_link" : "docs_hygiene",
      title: architectureRelated ? "Broken architecture doc link" : "Broken documentation link",
      failureKind: "harness_failure",
      evidence: [
        `${diagnostic.sourcePath}${diagnostic.line ? `:${diagnostic.line}` : ""} → ${diagnostic.rawTarget}`,
        `Reason: ${diagnostic.reason}`,
      ].map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      affectedPath: diagnostic.sourcePath,
      suggestedEdit: input.docsRepair?.proposals.find((proposal) =>
        proposal.sourcePath === diagnostic.sourcePath && proposal.rawTarget === diagnostic.rawTarget
      )?.recommended
        ? `Repair link target using docs repair suggestion for ${diagnostic.rawTarget}.`
        : `Repair or remove broken link '${diagnostic.rawTarget}' in ${diagnostic.sourcePath}.`,
      confidence: "high",
      reproduceCommand: reproduce,
    });
  }
}

function proposalsFromHandoff(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  const handoff = input.handoffFreshness;
  if (!handoff?.isStale) return;
  pushProposal(proposals, seen, {
    id: "stale_graph_export",
    category: "stale_graph_export",
    title: "Stale graph export",
    failureKind: "harness_failure",
    evidence: [handoff.detail].map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
    affectedPath: handoff.handoffPath,
    suggestedEdit: "Run graph:export or dogfood to refresh GRAPH_REPORT.md and .oag handoff artifacts.",
    confidence: "high",
    reproduceCommand: `npm run graph:export -- --workspace ${quoteWorkspace(input.workspaceRoot)} --offline-only`,
  });
}

function proposalsFromEcosystem(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  for (const row of input.ecosystemSupport ?? []) {
    if (row.semanticSupported && row.tier !== "T3") continue;
    pushProposal(proposals, seen, {
      id: `ecosystem_${row.scannerId}`,
      category: "unsupported_ecosystem_gap",
      title: "Unsupported ecosystem gap",
      failureKind: "harness_failure",
      evidence: [`${row.label} (${row.tier}): ${row.limitation}`]
        .map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      suggestedEdit: `Document that ${row.label} is ${row.tier} and may require direct source inspection.`,
      confidence: "medium",
      reproduceCommand: defaultReproduceCommand(input.workspaceRoot),
    });
  }
}

function proposalsFromFusionChecks(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  for (const check of input.fusionChecks ?? []) {
    if (check.severity === "info") continue;
    const stale = /stale|handoff|GRAPH_REPORT/i.test(check.detail);
    if (stale) {
      proposalsFromHandoff({
        ...input,
        handoffFreshness: {
          isStale: true,
          handoffPath: "GRAPH_REPORT.md",
          graphGeneratedAt: "",
          detail: check.detail,
        },
      }, proposals, seen);
      continue;
    }
    pushProposal(proposals, seen, {
      id: `fusion_${check.code}`,
      category: "other",
      title: check.title,
      failureKind: /symbol|scanner|analyzer/i.test(check.code) ? "harness_failure" : "unknown",
      evidence: [check.detail].map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      suggestedEdit: check.detail,
      confidence: check.severity === "fail" ? "high" : "medium",
      reproduceCommand: defaultReproduceCommand(input.workspaceRoot),
    });
  }
}

function proposalsFromUpdateBenchmarks(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  for (const failure of input.updateBenchmarkFailures ?? []) {
    pushProposal(proposals, seen, {
      id: `update_benchmark_${failure}`,
      category: "update_benchmark_failure",
      title: "Update benchmark failure",
      failureKind: "harness_failure",
      evidence: [failure].map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      suggestedEdit: "Investigate graph:benchmark:update failures and refresh cached graph exports.",
      confidence: "medium",
      reproduceCommand: "npm run graph:benchmark:update",
    });
  }
}

function proposalsFromPathQueryMisses(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  for (const miss of input.pathQueryMisses ?? []) {
    const isPath = miss.kind === "path";
    const hasConcreteEndpoints = Boolean((miss.from && miss.to) || parsePathQueryMissEndpoints(miss.detail).from);
    const hasConcreteQuery = Boolean(miss.query?.trim());
    const reproduceCommand = isPath
      ? reproduceCommandForPathMiss(input.workspaceRoot, miss)
      : reproduceCommandForQueryMiss(input.workspaceRoot, miss);
    pushProposal(proposals, seen, {
      id: `${miss.kind}_miss_${miss.detail}`,
      category: "path_query_miss",
      title: isPath
        ? (hasConcreteEndpoints ? "Path query miss" : "Path query miss (template reproduce command)")
        : (hasConcreteQuery ? "Query miss" : "Query miss (template reproduce command)"),
      failureKind: "model_failure",
      evidence: [miss.detail].map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      suggestedEdit: isPath
        ? "Try graph:explain on a known symbol before graph:path, or refresh the graph export."
        : "Run graph:context or graph:query with a narrower seed before broad repo search.",
      confidence: hasConcreteEndpoints || hasConcreteQuery ? "high" : "medium",
      reproduceCommand,
    });
  }
}

const LEARN_CODE_TO_CATEGORY: Record<string, HarnessImprovementCategory> = {
  wrong_file_first: "other",
  missing_setup: "missing_setup_command",
  ignored_support_tier: "unsupported_ecosystem_gap",
  stale_graph: "stale_graph_export",
  missing_analyzer: "unsupported_ecosystem_gap",
  bad_path_query: "path_query_miss",
};

const LEARN_CODE_FAILURE_KIND: Record<string, HarnessFailureKind> = {
  wrong_file_first: "model_failure",
  missing_setup: "harness_failure",
  ignored_support_tier: "model_failure",
  stale_graph: "harness_failure",
  missing_analyzer: "harness_failure",
  bad_path_query: "model_failure",
};

function proposalsFromLearnLog(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  for (const finding of input.learnLogFindings ?? []) {
    const category = LEARN_CODE_TO_CATEGORY[finding.code] ?? "other";
    const failureKind = LEARN_CODE_FAILURE_KIND[finding.code] ?? "unknown";
    const topProposal = finding.proposals[0];
    let reproduceCommand = defaultReproduceCommand(input.workspaceRoot);
    if (finding.code === "bad_path_query") {
      const pathEvidence = finding.evidence.find((line) => /path from/i.test(line));
      if (pathEvidence) {
        reproduceCommand = reproduceCommandForPathMiss(input.workspaceRoot, { detail: pathEvidence });
      } else {
        reproduceCommand = learnLogReproduceCommand(input.workspaceRoot);
      }
    } else if (input.learnLogFindings?.length) {
      reproduceCommand = learnLogReproduceCommand(input.workspaceRoot);
    }

    pushProposal(proposals, seen, {
      id: `learn_${finding.code}`,
      category,
      title: finding.title,
      failureKind,
      evidence: finding.evidence.map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      affectedPath: topProposal?.target,
      suggestedEdit: topProposal?.suggestion ?? "Review the recurring failure pattern and update harness docs.",
      confidence: finding.evidence.length >= 2 ? "high" : "medium",
      reproduceCommand,
    });
  }
}

function proposalsFromHarnessReport(
  input: BuildHarnessImprovementProposalsInput,
  proposals: HarnessImprovementProposal[],
  seen: Set<string>
) {
  const report = input.agentHarnessReport;
  if (!report) return;

  for (const missing of report.missingInstructions.slice(0, 6)) {
    if (/test/i.test(missing)) {
      proposalsFromSpecQuality({
        ...input,
        specQuality: {
          ok: false,
          score: report.specQualityScore,
          present: [],
          missing: ["test_instructions"],
          conflicts: [],
          risks: [],
          recommendations: [missing],
        },
      }, proposals, seen);
    }
  }

  for (const conflict of report.conflictingInstructions.slice(0, 4)) {
    pushProposal(proposals, seen, {
      id: `harness_conflict_${conflict}`,
      category: "conflicting_agent_instructions",
      title: "Conflicting agent instructions",
      failureKind: "harness_failure",
      evidence: [conflict].map((line) => sanitizeEvidenceLine(line, input.workspaceRoot)),
      suggestedEdit: "Align agent instruction files and package scripts on one verification workflow.",
      confidence: "high",
      reproduceCommand: defaultReproduceCommand(input.workspaceRoot),
    });
  }
}

export function buildHarnessImprovementProposals(
  input: BuildHarnessImprovementProposalsInput
): HarnessImprovementProposalResult {
  const proposals: HarnessImprovementProposal[] = [];
  const seen = new Set<string>();

  proposalsFromSpecQuality(input, proposals, seen);
  proposalsFromVerificationMap(input, proposals, seen);
  proposalsFromContextNoise(input, proposals, seen);
  proposalsFromDocs(input, proposals, seen);
  proposalsFromHandoff(input, proposals, seen);
  proposalsFromEcosystem(input, proposals, seen);
  proposalsFromFusionChecks(input, proposals, seen);
  proposalsFromUpdateBenchmarks(input, proposals, seen);
  proposalsFromPathQueryMisses(input, proposals, seen);
  proposalsFromHarnessReport(input, proposals, seen);
  proposalsFromLearnLog(input, proposals, seen);

  const harnessFailureCount = proposals.filter((proposal) => proposal.failureKind === "harness_failure").length;
  const modelFailureCount = proposals.filter((proposal) => proposal.failureKind === "model_failure").length;

  const sanitizedWorkspaceRoot = sanitizeOperationalText(input.workspaceRoot, {
    workspaceRoot: input.workspaceRoot,
    maxLength: 160,
  });

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot: sanitizedWorkspaceRoot,
    proposalCount: proposals.length,
    harnessFailureCount,
    modelFailureCount,
    proposals,
    markdown: renderHarnessImprovementProposalsMarkdown(proposals),
    reviewOnlyDisclaimer: REVIEW_ONLY_DISCLAIMER,
  };
}

export function renderHarnessImprovementProposalsMarkdown(proposals: HarnessImprovementProposal[]): string {
  const lines = [
    "## Harness improvement proposals",
    "",
    REVIEW_ONLY_DISCLAIMER,
    "",
  ];

  if (proposals.length === 0) {
    lines.push("No harness improvement proposals detected for the supplied inputs.", "");
    return `${lines.join("\n")}\n`;
  }

  for (const proposal of proposals) {
    lines.push(`### ${proposal.title}`, "");
    lines.push(`- Category: \`${proposal.category}\``);
    lines.push(`- Failure kind: \`${proposal.failureKind}\``);
    lines.push(`- Confidence: ${proposal.confidence}`);
    lines.push(`- Safe for agent auto-apply: ${proposal.safeForAgentAutoApply ? "yes" : "no"}`);
    if (proposal.affectedPath) {
      lines.push(`- Affected path: \`${proposal.affectedPath}\``);
    }
    lines.push(`- Reproduce: \`${proposal.reproduceCommand}\``);
    lines.push("", "Evidence:", "");
    for (const line of proposal.evidence) {
      lines.push(`- ${line}`);
    }
    lines.push("", "Suggested human edit:", "", proposal.suggestedEdit, "");
  }

  return `${lines.join("\n")}\n`;
}

export function summarizeHarnessImprovementProposalsHuman(result: HarnessImprovementProposalResult): string[] {
  if (result.proposalCount === 0) {
    return ["Harness proposals: none"];
  }
  const lines = [
    `Harness proposals: ${result.proposalCount} (${result.harnessFailureCount} harness, ${result.modelFailureCount} model)`,
  ];
  for (const proposal of result.proposals.slice(0, 6)) {
    lines.push(`- [${proposal.failureKind}] ${proposal.title}${proposal.affectedPath ? ` (${proposal.affectedPath})` : ""}`);
  }
  return lines;
}