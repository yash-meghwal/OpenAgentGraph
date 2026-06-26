import type { UnifiedCodeGraphNode } from "./codeGraph.js";
import { isDocsOrientedQuery, scoreDocSectionForQuery } from "./graphDocs.js";
import { scoreGraphPathSeedNodeForQuery, tokenizeGraphPathSeedQuery } from "./graphPathSeedResolution.js";

export type GraphQueryIntentMode = "balanced" | "code" | "docs";

export type GraphQueryShape = "code_oriented" | "docs_oriented" | "ambiguous";

export const GRAPH_QUERY_INTENT_MODES = new Set<GraphQueryIntentMode>(["balanced", "code", "docs"]);

const CODE_SURFACE_KINDS = new Set<UnifiedCodeGraphNode["kind"]>([
  "symbol",
  "code_file",
  "test",
  "route",
  "command",
]);

const DOC_SURFACE_KINDS = new Set<UnifiedCodeGraphNode["kind"]>(["doc_file", "doc_section"]);

const CODE_ORIENTED_QUERY = /\b(fix|change|implement|debug|call|construct|handle|service|controller|class|method|function|adapter|repository)\b/i;
const DOCS_ORIENTED_QUERY = /\b(architecture|contract|guide|how does|how do|why|decision|runbook|readme|overview|handoff|wiki|docs?|documentation)\b/i;

export function parseGraphQueryIntentMode(value: string): GraphQueryIntentMode {
  const normalized = value.trim().toLowerCase();
  if (!GRAPH_QUERY_INTENT_MODES.has(normalized as GraphQueryIntentMode)) {
    throw new Error(`Unknown graph query mode '${value}'. Expected code, docs, or balanced.`);
  }
  return normalized as GraphQueryIntentMode;
}

export function inferGraphQueryShape(query: string): GraphQueryShape {
  const codeOriented = CODE_ORIENTED_QUERY.test(query);
  const docsOriented = DOCS_ORIENTED_QUERY.test(query) || isDocsOrientedQuery(query);
  if (codeOriented && docsOriented) return "ambiguous";
  if (docsOriented) return "docs_oriented";
  if (codeOriented) return "code_oriented";
  return "ambiguous";
}

export function resolveEffectiveGraphQueryIntentMode(
  query: string,
  requestedMode: GraphQueryIntentMode
): GraphQueryIntentMode {
  if (requestedMode !== "balanced") return requestedMode;
  const shape = inferGraphQueryShape(query);
  if (shape === "docs_oriented") return "docs";
  if (shape === "code_oriented") return "code";
  return "balanced";
}

export function isGraphCodeSurfaceKind(kind: UnifiedCodeGraphNode["kind"]) {
  return CODE_SURFACE_KINDS.has(kind);
}

export function isGraphDocSurfaceKind(kind: UnifiedCodeGraphNode["kind"]) {
  return DOC_SURFACE_KINDS.has(kind);
}

export function scoreGraphSeedTextMatch(node: UnifiedCodeGraphNode, tokens: string[]) {
  let score = scoreGraphPathSeedNodeForQuery(node, tokens);
  if (node.kind === "doc_section") {
    score = Math.max(score, scoreDocSectionForQuery(node, tokens));
  }
  return score;
}

function applyGraphQuerySeedBoost(
  node: UnifiedCodeGraphNode,
  query: string,
  rawScore: number,
  effectiveMode: GraphQueryIntentMode
) {
  if (rawScore <= 0) return rawScore;
  if (effectiveMode === "docs" && isGraphDocSurfaceKind(node.kind)) {
    return rawScore + 40;
  }
  if (effectiveMode === "balanced" && isDocsOrientedQuery(query) && isGraphDocSurfaceKind(node.kind)) {
    return rawScore + 40;
  }
  return rawScore;
}

function compareGraphQueryIntentRankedCandidates(
  left: GraphQueryIntentRankedCandidate,
  right: GraphQueryIntentRankedCandidate,
  effectiveMode: GraphQueryIntentMode
) {
  const surfaceRank = (candidate: GraphQueryIntentRankedCandidate) => {
    if (!candidate.queryRelevant) return 3;
    if (effectiveMode === "code") {
      if (isGraphCodeSurfaceKind(candidate.node.kind)) return 0;
      if (isGraphDocSurfaceKind(candidate.node.kind)) return 1;
      return 2;
    }
    if (effectiveMode === "docs") {
      if (isGraphDocSurfaceKind(candidate.node.kind)) return 0;
      if (isGraphCodeSurfaceKind(candidate.node.kind)) return 1;
      return 2;
    }
    return 0;
  };
  const rankDifference = surfaceRank(left) - surfaceRank(right);
  if (rankDifference !== 0) {
    return rankDifference;
  }
  return right.score - left.score || left.node.label.localeCompare(right.node.label);
}

export function preferredGraphQueryNodeKinds(mode: GraphQueryIntentMode): UnifiedCodeGraphNode["kind"][] {
  if (mode === "code") {
    return ["symbol", "code_file", "test", "route", "command", "community"];
  }
  if (mode === "docs") {
    return ["doc_section", "doc_file", "community"];
  }
  return ["symbol", "doc_section", "code_file", "doc_file", "test", "route", "command", "community"];
}

export function scoreGraphNodeForQueryIntent(
  node: UnifiedCodeGraphNode,
  query: string,
  baseScore: number,
  effectiveMode: GraphQueryIntentMode
) {
  const penalties: string[] = [];
  let score = baseScore;
  if (baseScore <= 0) {
    return { score, penalties };
  }
  const label = `${node.label} ${node.path ?? ""}`.toLowerCase();
  const tokens = tokenizeGraphPathSeedQuery(query);

  if (effectiveMode === "code") {
    if (isGraphCodeSurfaceKind(node.kind) && baseScore > 0) score += 20;
    if (isGraphDocSurfaceKind(node.kind)) {
      score -= 30;
      penalties.push("doc_surface_penalty");
    }
    if (node.kind === "community" && /\bdocs?\b/i.test(node.label)) {
      score -= 15;
      penalties.push("documentation_community_penalty");
    }
  } else if (effectiveMode === "docs") {
    if (isGraphDocSurfaceKind(node.kind)) score += 25;
    if (isGraphCodeSurfaceKind(node.kind)) score += 5;
  } else {
    const shape = inferGraphQueryShape(query);
    if (isGraphCodeSurfaceKind(node.kind)) score += shape === "docs_oriented" ? 6 : 12;
    if (isGraphDocSurfaceKind(node.kind)) score += shape === "code_oriented" ? 2 : 10;
    if (shape !== "docs_oriented" && isGraphDocSurfaceKind(node.kind)) {
      score -= 10;
      penalties.push("doc_surface_balanced_penalty");
    }
    const repeatedKeywordOnly = tokens.length > 0
      && tokens.every((token) => label.includes(token))
      && !/(class|interface|service|controller|section|guide|architecture)/i.test(node.label);
    if (repeatedKeywordOnly) {
      score -= 6;
      penalties.push("keyword_only_penalty");
    }
  }

  return { score: Math.max(1, score), penalties };
}

export interface GraphQueryIntentRankedCandidate {
  node: UnifiedCodeGraphNode;
  score: number;
  baseScore: number;
  queryRelevant: boolean;
  penalties: string[];
}

export function rankGraphNodesForQueryIntent(
  nodes: UnifiedCodeGraphNode[],
  query: string,
  requestedMode: GraphQueryIntentMode
) {
  const effectiveMode = resolveEffectiveGraphQueryIntentMode(query, requestedMode);
  const tokens = tokenizeGraphPathSeedQuery(query);
  const ranked = nodes
    .map((node) => {
      const rawScore = scoreGraphSeedTextMatch(node, tokens);
      const queryRelevant = rawScore > 0;
      const baseScore = applyGraphQuerySeedBoost(node, query, rawScore, effectiveMode);
      const adjusted = scoreGraphNodeForQueryIntent(node, query, baseScore, effectiveMode);
      return {
        node,
        score: adjusted.score,
        baseScore,
        queryRelevant,
        penalties: adjusted.penalties,
      };
    })
    .filter((entry) => entry.queryRelevant && entry.score > 0)
    .sort((left, right) => compareGraphQueryIntentRankedCandidates(left, right, effectiveMode));

  return { effectiveMode, ranked };
}

export interface GraphQueryIntentSummary {
  requestedMode: GraphQueryIntentMode;
  effectiveMode: GraphQueryIntentMode;
  inferredQueryShape: GraphQueryShape;
  preferredNodeKinds: UnifiedCodeGraphNode["kind"][];
  appliedPenalties: string[];
  fallbackUsed: boolean;
  fallbackReason?: string;
  topSelectionReason: string;
  topResultKinds: UnifiedCodeGraphNode["kind"][];
  codeResultCount: number;
  docResultCount: number;
}

export function buildGraphQueryIntentSummary(input: {
  query: string;
  requestedMode: GraphQueryIntentMode;
  seeds: UnifiedCodeGraphNode[];
  nodes: UnifiedCodeGraphNode[];
  rankedSeeds?: GraphQueryIntentRankedCandidate[];
}): GraphQueryIntentSummary {
  const inferredQueryShape = inferGraphQueryShape(input.query);
  const effectiveMode = resolveEffectiveGraphQueryIntentMode(input.query, input.requestedMode);
  const selectedRanked = input.rankedSeeds ?? [];
  const queryRelevantCode = selectedRanked.filter(
    (entry) => entry.queryRelevant && isGraphCodeSurfaceKind(entry.node.kind)
  );
  const queryRelevantDocs = selectedRanked.filter(
    (entry) => entry.queryRelevant && isGraphDocSurfaceKind(entry.node.kind)
  );
  const codeResults = input.seeds.filter((node) => isGraphCodeSurfaceKind(node.kind));
  const docResults = input.seeds.filter((node) => isGraphDocSurfaceKind(node.kind));
  const top = input.seeds[0];
  const fallbackUsed = input.requestedMode === "code"
    ? queryRelevantCode.length === 0 && queryRelevantDocs.length > 0
    : input.requestedMode === "docs"
      ? queryRelevantDocs.length === 0 && queryRelevantCode.length > 0
      : false;

  let topSelectionReason = "Matched query tokens with intent-aware ranking.";
  if (top) {
    if (effectiveMode === "code" && isGraphCodeSurfaceKind(top.kind)) {
      topSelectionReason = "Code mode prioritized code symbols and source files.";
    } else if (effectiveMode === "docs" && isGraphDocSurfaceKind(top.kind)) {
      topSelectionReason = "Docs mode prioritized documentation sections and files.";
    } else if (effectiveMode === "balanced") {
      topSelectionReason = inferredQueryShape === "ambiguous"
        ? "Balanced mode mixed code and documentation evidence."
        : `Balanced mode inferred ${inferredQueryShape.replace("_", " ")} query shape.`;
    }
  }

  const fallbackReason = fallbackUsed
    ? input.requestedMode === "code"
      ? "No strong code matches; returning documentation as labeled fallback context."
      : "No strong documentation matches; returning code as supporting context."
    : undefined;

  const appliedPenalties = new Set<string>();
  for (const entry of selectedRanked) {
    for (const penalty of entry.penalties) {
      appliedPenalties.add(penalty);
    }
  }
  if (fallbackUsed) {
    appliedPenalties.add("fallback_surface");
  }

  return {
    requestedMode: input.requestedMode,
    effectiveMode,
    inferredQueryShape,
    preferredNodeKinds: preferredGraphQueryNodeKinds(effectiveMode),
    appliedPenalties: [...appliedPenalties],
    fallbackUsed,
    fallbackReason,
    topSelectionReason,
    topResultKinds: input.seeds.slice(0, 5).map((node) => node.kind),
    codeResultCount: codeResults.length,
    docResultCount: docResults.length,
  };
}
