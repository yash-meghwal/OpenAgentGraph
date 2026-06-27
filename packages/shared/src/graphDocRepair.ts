import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  collectDocLinkDiagnostics,
  extractBrokenDocTarget,
  resolveRelativeDocTarget,
  splitDocLinkTarget,
  type DocLinkDiagnostic,
  type DocLinkFailureReason,
} from "./graphDocLinks.js";

export type DocRepairCandidateKind =
  | "exact"
  | "case_only"
  | "moved_file"
  | "basename"
  | "heading_similarity"
  | "nearby_directory"
  | "graph_node";

export interface DocRepairCandidate {
  targetPath?: string;
  anchor?: string;
  kind: DocRepairCandidateKind;
  confidence: number;
  insideWorkspace: boolean;
}

export interface DocLinkRepairProposal {
  sourcePath: string;
  line?: number;
  rawTarget: string;
  reason: DocLinkFailureReason;
  candidateTargetPaths: string[];
  candidateAnchors: string[];
  candidates: DocRepairCandidate[];
  confidence: number;
  explanation: string;
  ambiguous: boolean;
  recommended?: DocRepairCandidate;
}

export interface DocLinkRepairSummary {
  brokenCount: number;
  actionableCount: number;
  withRecommendationCount: number;
  ambiguousCount: number;
  byReason: Record<DocLinkFailureReason, number>;
  reproduceCommand: string;
  proposals: DocLinkRepairProposal[];
  topSuggestions: DocLinkRepairProposal[];
  ok: boolean;
}

const GENERATED_ARTIFACT_PATHS = new Set([
  "graph_report.md",
  ".oag/graph.html",
  ".oag/wiki/index.md",
]);

const IGNORED_PATH_SEGMENTS = /(?:^|\/)(?:bin|obj|node_modules|dist|build|\.git|\.next|\.turbo|coverage|\.venv|\.terraform)(?:\/|$)/i;

function normalizeWorkspacePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

export function slugifyDocHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function posixDirname(filePath: string) {
  const normalized = normalizeWorkspacePath(filePath);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function posixBasename(filePath: string) {
  const normalized = normalizeWorkspacePath(filePath);
  return normalized.split("/").pop() ?? normalized;
}

function fileStem(filePath: string) {
  const base = posixBasename(filePath);
  return base.replace(/\.[a-z0-9]+$/i, "");
}

function isSecretOrIgnoredPath(filePath: string) {
  const normalized = normalizeWorkspacePath(filePath);
  return IGNORED_PATH_SEGMENTS.test(normalized);
}

interface WorkspacePathIndex {
  paths: Set<string>;
  canonicalByLower: Map<string, string>;
  basenameToPaths: Map<string, string[]>;
  stemToPaths: Map<string, string[]>;
  sectionsByFile: Map<string, Array<{ slug: string; label: string }>>;
  graphNodePaths: string[];
}

function buildWorkspacePathIndex(graph: UnifiedCodeGraph): WorkspacePathIndex {
  const paths = new Set<string>();
  const canonicalByLower = new Map<string, string>();
  const basenameToPaths = new Map<string, string[]>();
  const stemToPaths = new Map<string, string[]>();
  const sectionsByFile = new Map<string, Array<{ slug: string; label: string }>>();
  const graphNodePaths: string[] = [];

  const registerPath = (rawPath: string) => {
    const normalized = normalizeWorkspacePath(rawPath);
    if (!normalized || isSecretOrIgnoredPath(normalized)) return;
    paths.add(normalized);
    canonicalByLower.set(normalized.toLowerCase(), normalized);
    const basename = posixBasename(normalized).toLowerCase();
    const basenameBucket = basenameToPaths.get(basename) ?? [];
    if (!basenameBucket.includes(normalized)) basenameBucket.push(normalized);
    basenameToPaths.set(basename, basenameBucket);
    const stem = fileStem(normalized).toLowerCase();
    const stemBucket = stemToPaths.get(stem) ?? [];
    if (!stemBucket.includes(normalized)) stemBucket.push(normalized);
    stemToPaths.set(stem, stemBucket);
    graphNodePaths.push(normalized);
  };

  for (const node of graph.nodes) {
    if (node.kind === "doc_file" || node.kind === "code_file" || node.kind === "config_file") {
      registerPath(node.path ?? node.label);
      continue;
    }
    if (node.kind === "doc_section") {
      const filePath = normalizeWorkspacePath(
        String(node.path ?? node.metadata?.scannerSourceFile ?? "")
      );
      if (!filePath) continue;
      const slug = typeof node.metadata?.scannerDocSectionSlug === "string"
        ? node.metadata.scannerDocSectionSlug
        : slugifyDocHeading(node.label);
      const bucket = sectionsByFile.get(filePath) ?? [];
      bucket.push({ slug, label: node.label });
      sectionsByFile.set(filePath, bucket);
    }
  }

  return {
    paths,
    canonicalByLower,
    basenameToPaths,
    stemToPaths,
    sectionsByFile,
    graphNodePaths: [...new Set(graphNodePaths)].sort((left, right) => left.localeCompare(right)),
  };
}

function pushCandidate(
  candidates: DocRepairCandidate[],
  seen: Set<string>,
  candidate: DocRepairCandidate
) {
  const key = `${candidate.targetPath ?? ""}|${candidate.anchor ?? ""}|${candidate.kind}`;
  if (seen.has(key)) return;
  if (candidate.targetPath && isSecretOrIgnoredPath(candidate.targetPath)) return;
  seen.add(key);
  candidates.push(candidate);
}

function headingSimilarityScore(left: string, right: string) {
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.82;
  const leftTokens = left.split("-").filter(Boolean);
  const rightTokens = right.split("-").filter(Boolean);
  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  if (overlap === 0) return 0;
  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

function suggestFileCandidates(input: {
  sourcePath: string;
  rawTarget: string;
  index: WorkspacePathIndex;
}) {
  const candidates: DocRepairCandidate[] = [];
  const seen = new Set<string>();
  const resolution = resolveRelativeDocTarget(input.sourcePath, input.rawTarget);
  const { fileTarget, anchor } = resolution;
  if (!fileTarget || resolution.outsideWorkspace) return { candidates, anchor };

  const normalized = resolution.resolvedPath ?? "";
  if (input.index.paths.has(normalized)) {
    pushCandidate(candidates, seen, {
      targetPath: normalized,
      anchor,
      kind: "exact",
      confidence: 0.98,
      insideWorkspace: true,
    });
    return { candidates, anchor };
  }

  const caseMatch = input.index.canonicalByLower.get(normalized.toLowerCase());
  if (caseMatch) {
    pushCandidate(candidates, seen, {
      targetPath: caseMatch,
      anchor,
      kind: "case_only",
      confidence: 0.92,
      insideWorkspace: true,
    });
  }

  const basename = posixBasename(normalized).toLowerCase();
  const basenameMatches = (input.index.basenameToPaths.get(basename) ?? [])
    .filter((path) => path !== normalized);
  if (basenameMatches.length === 1) {
    pushCandidate(candidates, seen, {
      targetPath: basenameMatches[0],
      anchor,
      kind: "basename",
      confidence: 0.8,
      insideWorkspace: true,
    });
  } else if (basenameMatches.length > 1) {
    for (const match of basenameMatches.slice(0, 3)) {
      pushCandidate(candidates, seen, {
        targetPath: match,
        anchor,
        kind: "basename",
        confidence: 0.45,
        insideWorkspace: true,
      });
    }
  }

  const stem = fileStem(normalized).toLowerCase();
  const stemMatches = (input.index.stemToPaths.get(stem) ?? [])
    .filter((path) => path.toLowerCase() !== normalized.toLowerCase());
  if (stemMatches.length === 1) {
    pushCandidate(candidates, seen, {
      targetPath: stemMatches[0],
      anchor,
      kind: "moved_file",
      confidence: 0.85,
      insideWorkspace: true,
    });
  }

  const sourceDir = posixDirname(input.sourcePath);
  const nearbyMatches = input.index.graphNodePaths.filter((path) => {
    const dir = posixDirname(path);
    return (dir === sourceDir || dir.startsWith(`${sourceDir}/`))
      && fileStem(path).toLowerCase() === stem;
  });
  if (nearbyMatches.length === 1) {
    pushCandidate(candidates, seen, {
      targetPath: nearbyMatches[0],
      anchor,
      kind: "nearby_directory",
      confidence: 0.7,
      insideWorkspace: true,
    });
  }

  const graphMatches = input.index.graphNodePaths.filter((path) =>
    path.toLowerCase().endsWith(`/${basename}`)
    || path.toLowerCase() === basename
  );
  if (graphMatches.length === 1 && !candidates.some((entry) => entry.targetPath === graphMatches[0])) {
    pushCandidate(candidates, seen, {
      targetPath: graphMatches[0],
      anchor,
      kind: "graph_node",
      confidence: 0.75,
      insideWorkspace: true,
    });
  }

  const extensionless = !/\.[a-z0-9]+$/i.test(normalized);
  if (extensionless) {
    for (const suffix of [".md", "/README.md"]) {
      const withSuffix = `${normalized}${suffix}`;
      const match = input.index.canonicalByLower.get(withSuffix.toLowerCase());
      if (match) {
        pushCandidate(candidates, seen, {
          targetPath: match,
          anchor,
          kind: "graph_node",
          confidence: 0.72,
          insideWorkspace: true,
        });
      }
    }
  }

  return { candidates, anchor };
}

function suggestAnchorCandidates(input: {
  sourcePath: string;
  rawTarget: string;
  filePath: string;
  index: WorkspacePathIndex;
}) {
  const candidates: DocRepairCandidate[] = [];
  const seen = new Set<string>();
  const extracted = extractBrokenDocTarget(input.rawTarget);
  const anchor = extracted.startsWith("#")
    ? extracted.slice(1)
    : splitDocLinkTarget(extracted).anchor ?? extracted;
  const wantedSlug = slugifyDocHeading(decodeURIComponent(anchor));
  const sections = input.index.sectionsByFile.get(input.filePath) ?? [];
  const exact = sections.filter((section) => section.slug === wantedSlug);
  if (exact.length === 1) {
    pushCandidate(candidates, seen, {
      targetPath: input.filePath,
      anchor: exact[0]!.slug,
      kind: "heading_similarity",
      confidence: 0.9,
      insideWorkspace: true,
    });
    return candidates;
  }

  const ranked = sections
    .map((section) => ({
      section,
      score: headingSimilarityScore(wantedSlug, section.slug),
    }))
    .filter((entry) => entry.score >= 0.6)
    .sort((left, right) => right.score - left.score || left.section.slug.localeCompare(right.section.slug));

  if (ranked.length === 1) {
    pushCandidate(candidates, seen, {
      targetPath: input.filePath,
      anchor: ranked[0]!.section.slug,
      kind: "heading_similarity",
      confidence: 0.78,
      insideWorkspace: true,
    });
    return candidates;
  }

  if (ranked.length > 1) {
    for (const entry of ranked.slice(0, 3)) {
      pushCandidate(candidates, seen, {
        targetPath: input.filePath,
        anchor: entry.section.slug,
        kind: "heading_similarity",
        confidence: 0.55,
        insideWorkspace: true,
      });
    }
  }

  const duplicateBase = wantedSlug.replace(/-\d+$/, "");
  const duplicateMatches = sections.filter((section) =>
    section.slug === duplicateBase || section.slug.startsWith(`${duplicateBase}-`)
  );
  if (duplicateMatches.length > 0) {
    for (const section of duplicateMatches.slice(0, 3)) {
      pushCandidate(candidates, seen, {
        targetPath: input.filePath,
        anchor: section.slug,
        kind: "heading_similarity",
        confidence: duplicateMatches.length === 1 ? 0.82 : 0.5,
        insideWorkspace: true,
      });
    }
  }

  return candidates;
}

function buildProposalExplanation(
  diagnostic: DocLinkDiagnostic,
  candidates: DocRepairCandidate[],
  ambiguous: boolean,
  recommended?: DocRepairCandidate
) {
  if (diagnostic.reason === "outside_workspace") {
    return "Target path is outside the workspace; no in-workspace replacement is suggested.";
  }
  if (diagnostic.reason === "unsupported_scheme") {
    return "External URL or mailto links are not rewritten by OAG repair guidance.";
  }
  if (candidates.length === 0) {
    return `No safe in-workspace candidate found for '${diagnostic.rawTarget}'.`;
  }
  if (ambiguous) {
    return `Multiple plausible candidates found for '${diagnostic.rawTarget}'; review before editing.`;
  }
  if (recommended?.kind === "case_only") {
    return `Use the case-correct workspace path '${recommended.targetPath}'.`;
  }
  if (recommended?.kind === "moved_file") {
    return `Target may have moved to '${recommended.targetPath}'.`;
  }
  if (recommended?.kind === "heading_similarity" && recommended.anchor) {
    return `Use heading anchor '#${recommended.anchor}' in '${recommended.targetPath ?? diagnostic.sourcePath}'.`;
  }
  if (recommended?.targetPath) {
    return `Replace with '${recommended.targetPath}' (${recommended.kind.replace(/_/g, " ")}).`;
  }
  return "Review candidate anchors before editing.";
}

function selectRecommendation(candidates: DocRepairCandidate[]) {
  const ranked = [...candidates].sort((left, right) => right.confidence - left.confidence);
  const top = ranked[0];
  if (!top) return { recommended: undefined, ambiguous: false, confidence: 0 };
  const competing = ranked.filter((entry) =>
    Math.abs(entry.confidence - top.confidence) < 0.04
    && (`${entry.targetPath ?? ""}|${entry.anchor ?? ""}` !== `${top.targetPath ?? ""}|${top.anchor ?? ""}`)
  );
  const ambiguous = ranked.length > 1 && (top.confidence < 0.8 || competing.length > 0);
  return {
    recommended: ambiguous ? undefined : top,
    ambiguous,
    confidence: top.confidence,
  };
}

function effectiveDocLinkFailureReason(diagnostic: DocLinkDiagnostic): DocLinkFailureReason {
  if (diagnostic.reason === "unsupported_scheme") return diagnostic.reason;
  const resolution = resolveRelativeDocTarget(diagnostic.sourcePath, diagnostic.rawTarget);
  if (resolution.outsideWorkspace) return "outside_workspace";
  return diagnostic.reason;
}

function emptyDocLinkRepairProposal(
  diagnostic: DocLinkDiagnostic,
  reason: DocLinkFailureReason
): DocLinkRepairProposal {
  const explanation = reason === "outside_workspace"
    ? "Target path is outside the workspace; no in-workspace replacement is suggested."
    : reason === "unsupported_scheme"
      ? "External URL or mailto links are not rewritten by OAG repair guidance."
      : `No safe in-workspace candidate found for '${diagnostic.rawTarget}'.`;
  return {
    sourcePath: diagnostic.sourcePath,
    line: diagnostic.line,
    rawTarget: diagnostic.rawTarget,
    reason,
    candidateTargetPaths: [],
    candidateAnchors: [],
    candidates: [],
    confidence: 0,
    explanation,
    ambiguous: false,
  };
}

function resolveAnchorSearchFilePath(diagnostic: DocLinkDiagnostic) {
  const extracted = extractBrokenDocTarget(diagnostic.rawTarget);
  const { fileTarget } = splitDocLinkTarget(extracted);
  if (!fileTarget) return diagnostic.sourcePath;
  const resolution = resolveRelativeDocTarget(diagnostic.sourcePath, diagnostic.rawTarget);
  return resolution.resolvedPath ?? diagnostic.sourcePath;
}

export function suggestDocLinkRepair(
  diagnostic: DocLinkDiagnostic,
  graph: UnifiedCodeGraph,
  index = buildWorkspacePathIndex(graph)
): DocLinkRepairProposal {
  const reason = effectiveDocLinkFailureReason(diagnostic);
  if (reason === "outside_workspace" || reason === "unsupported_scheme") {
    return emptyDocLinkRepairProposal(diagnostic, reason);
  }

  let candidates: DocRepairCandidate[] = [];

  if (reason === "missing_file") {
    const fileSuggestions = suggestFileCandidates({
      sourcePath: diagnostic.sourcePath,
      rawTarget: diagnostic.rawTarget,
      index,
    });
    candidates = fileSuggestions.candidates;
    if (fileSuggestions.anchor && candidates.length === 1) {
      const anchorCandidates = suggestAnchorCandidates({
        sourcePath: diagnostic.sourcePath,
        rawTarget: `#${fileSuggestions.anchor}`,
        filePath: candidates[0]!.targetPath ?? diagnostic.sourcePath,
        index,
      });
      candidates = [...candidates, ...anchorCandidates];
    }
  } else if (reason === "missing_anchor") {
    const extracted = extractBrokenDocTarget(diagnostic.rawTarget);
    const anchorToken = extracted.startsWith("#")
      ? extracted
      : splitDocLinkTarget(extracted).anchor
        ? `#${splitDocLinkTarget(extracted).anchor}`
        : diagnostic.rawTarget;
    candidates = suggestAnchorCandidates({
      sourcePath: diagnostic.sourcePath,
      rawTarget: anchorToken,
      filePath: resolveAnchorSearchFilePath(diagnostic),
      index,
    });
  }

  const { recommended, ambiguous, confidence } = selectRecommendation(candidates);
  const candidateTargetPaths = [...new Set(
    candidates.map((entry) => entry.targetPath).filter((value): value is string => Boolean(value))
  )];
  const candidateAnchors = [...new Set(
    candidates.map((entry) => entry.anchor).filter((value): value is string => Boolean(value))
  )];

  return {
    sourcePath: diagnostic.sourcePath,
    line: diagnostic.line,
    rawTarget: diagnostic.rawTarget,
    reason,
    candidateTargetPaths,
    candidateAnchors,
    candidates,
    confidence,
    explanation: buildProposalExplanation({ ...diagnostic, reason }, candidates, ambiguous, recommended),
    ambiguous,
    recommended,
  };
}

export function buildDocLinkRepairProposals(graph: UnifiedCodeGraph): DocLinkRepairProposal[] {
  const index = buildWorkspacePathIndex(graph);
  return collectDocLinkDiagnostics(graph).map((diagnostic) =>
    suggestDocLinkRepair(diagnostic, graph, index)
  );
}

export function summarizeDocLinkRepair(graph: UnifiedCodeGraph): DocLinkRepairSummary {
  const proposals = buildDocLinkRepairProposals(graph);
  const byReason = proposals.reduce<Record<DocLinkFailureReason, number>>((counts, entry) => {
    counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
    return counts;
  }, {
    missing_file: 0,
    missing_anchor: 0,
    unsupported_scheme: 0,
    outside_workspace: 0,
  });

  const actionable = proposals.filter((entry) =>
    entry.reason === "missing_file" || entry.reason === "missing_anchor"
  );
  const withRecommendation = actionable.filter((entry) => Boolean(entry.recommended)).length;
  const ambiguousCount = actionable.filter((entry) => entry.ambiguous).length;
  const topSuggestions = [...actionable]
    .filter((entry) => entry.recommended)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5);

  return {
    brokenCount: proposals.length,
    actionableCount: actionable.length,
    withRecommendationCount: withRecommendation,
    ambiguousCount,
    byReason,
    reproduceCommand: "npm run graph:docs:check -- --workspace <path> --suggest",
    proposals,
    topSuggestions,
    ok: proposals.every((entry) => {
      if (entry.reason === "outside_workspace" || entry.reason === "unsupported_scheme") {
        return entry.candidates.length === 0 && !entry.recommended;
      }
      if (entry.reason === "missing_file" || entry.reason === "missing_anchor") {
        return Boolean(entry.recommended) || entry.ambiguous || entry.candidates.length === 0;
      }
      return true;
    }),
  };
}

export function renderDocRepairSuggestionsMarkdown(proposals: DocLinkRepairProposal[]) {
  if (proposals.length === 0) {
    return ["## Documentation repair suggestions", "", "- No broken doc links detected.", ""];
  }
  const lines = ["## Documentation repair suggestions", ""];
  for (const proposal of proposals) {
    const location = proposal.line
      ? `\`${proposal.sourcePath}:${proposal.line}\``
      : `\`${proposal.sourcePath}\``;
    lines.push(`- ${location} — ${proposal.reason.replace(/_/g, " ")}: \`${proposal.rawTarget}\``);
    lines.push(`  - ${proposal.explanation}`);
    if (proposal.recommended?.targetPath) {
      const anchorSuffix = proposal.recommended.anchor ? `#${proposal.recommended.anchor}` : "";
      lines.push(`  - Suggested: \`${proposal.recommended.targetPath}${anchorSuffix}\` (${proposal.recommended.kind.replace(/_/g, " ")}, ${Math.round(proposal.recommended.confidence * 100)}%)`);
    } else if (proposal.candidates.length > 0) {
      lines.push(`  - Candidates: ${proposal.candidateTargetPaths.slice(0, 3).map((entry) => `\`${entry}\``).join(", ")}`);
    }
  }
  lines.push("");
  return lines;
}

export function evaluateDocRepairReleaseGate(input: {
  graph: UnifiedCodeGraph;
  fixture?: string;
  expectBrokenLinks?: boolean;
}) {
  const summary = summarizeDocLinkRepair(input.graph);
  const errors: string[] = [];

  if (input.expectBrokenLinks && summary.brokenCount === 0) {
    errors.push("Expected broken doc-link diagnostics but none were emitted.");
  }

  const actionable = summary.proposals.filter((entry) =>
    entry.reason === "missing_file" || entry.reason === "missing_anchor"
  );
  for (const proposal of actionable) {
    if (!proposal.recommended && !proposal.ambiguous && proposal.candidates.length > 0) {
      errors.push(`Actionable doc repair '${proposal.rawTarget}' lacks a recommendation or ambiguity flag.`);
    }
    if (proposal.ambiguous && proposal.recommended) {
      errors.push(`Ambiguous doc repair '${proposal.rawTarget}' must not include an automatic recommendation.`);
    }
  }

  const outside = summary.proposals.filter((entry) => entry.reason === "outside_workspace");
  for (const proposal of outside) {
    if (proposal.recommended || proposal.candidates.length > 0) {
      errors.push(`Outside-workspace doc link '${proposal.rawTarget}' must not receive in-workspace suggestions.`);
    }
  }

  if (input.fixture === "fixture-docs-broken-links") {
    const anchorCase = actionable.find((entry) => entry.reason === "missing_anchor");
    if (!anchorCase || anchorCase.candidates.length === 0) {
      errors.push("fixture-docs-broken-links missing-anchor case should expose heading candidates.");
    }
    const missingFile = actionable.find((entry) => entry.reason === "missing_file" && /missing\.md/i.test(entry.rawTarget));
    if (missingFile?.recommended) {
      errors.push("fixture-docs-broken-links missing-file case must remain unresolved when no safe candidate exists.");
    }
  }

  return {
    ...summary,
    ok: errors.length === 0,
    errors,
  };
}

export function isGeneratedArtifactSelfLink(sourcePath: string, rawTarget: string) {
  const normalizedSource = normalizeWorkspacePath(sourcePath).toLowerCase();
  const resolution = resolveRelativeDocTarget(sourcePath, rawTarget);
  if (!resolution.fileTarget) return false;
  const directTarget = normalizeWorkspacePath(resolution.fileTarget).toLowerCase();
  if (GENERATED_ARTIFACT_PATHS.has(directTarget)) return true;
  const normalizedTarget = (resolution.resolvedPath ?? "").toLowerCase();
  return normalizedSource === normalizedTarget
    || GENERATED_ARTIFACT_PATHS.has(normalizedTarget);
}