import type { UnifiedCodeGraph, UnifiedCodeGraphNode } from "./codeGraph.js";
import type { GraphQueryIntentMode } from "./graphQueryIntent.js";

export type StartGuidanceBucket =
  | "start_with"
  | "core_implementation"
  | "public_contracts"
  | "related_tests"
  | "supporting_docs"
  | "operational_config";

export type StartGuidanceQueryMode = GraphQueryIntentMode | "all";

const READ_FIRST_NODE_KINDS = new Set<UnifiedCodeGraphNode["kind"]>([
  "symbol",
  "code_file",
  "community",
  "config_file",
]);

const GENERATED_PATH_PATTERN = /(?:^|\/)(?:bin|obj|node_modules|dist|build|\.git|\.next|\.turbo|coverage)(?:\/|$)/i;

export interface StartGuidanceRankOptions {
  queryMode?: StartGuidanceQueryMode;
  communityId?: string;
  degreeByNodeId?: Map<string, number>;
  /** Include kind=test and test-like nodes in candidate lists (community buckets). */
  allowTests?: boolean;
  /** Include doc_file and doc_section nodes in candidate lists (community buckets). */
  includeDocs?: boolean;
}

function nodeText(node: UnifiedCodeGraphNode) {
  return `${node.label} ${node.path ?? ""}`.toLowerCase();
}

function nodeLabelText(node: UnifiedCodeGraphNode) {
  return node.label.toLowerCase();
}

function scannerSymbolKind(node: UnifiedCodeGraphNode) {
  return typeof node.metadata?.scannerSymbolKind === "string"
    ? node.metadata.scannerSymbolKind.toLowerCase()
    : undefined;
}

function isClassLikeSymbol(node: UnifiedCodeGraphNode) {
  const kind = scannerSymbolKind(node);
  return kind
    ? ["class", "record", "struct", "interface", "actor", "enum", "trait"].includes(kind)
    : /\((class|record|struct|interface|actor|enum|trait)\)/i.test(node.label);
}

function isInterfaceSymbol(node: UnifiedCodeGraphNode) {
  const kind = scannerSymbolKind(node);
  return kind === "interface" || /\(interface\)/i.test(node.label);
}

function isTestNode(node: UnifiedCodeGraphNode) {
  const path = (node.path ?? node.label).replace(/\\/g, "/");
  return node.kind === "test"
    || /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)/i.test(path)
    || /\.tests\./i.test(path);
}

function isGeneratedOrDependencyPath(node: UnifiedCodeGraphNode) {
  const path = (node.path ?? node.label).replace(/\\/g, "/");
  return GENERATED_PATH_PATTERN.test(path)
    || /\(external\)/i.test(node.label);
}

export function isStartGuidanceEligibleNode(
  node: UnifiedCodeGraphNode,
  options: StartGuidanceRankOptions = {}
) {
  const allowTests = options.allowTests ?? false;
  const includeDocs = options.includeDocs ?? false;

  if (node.kind === "directory" || node.kind === "workspace" || node.kind === "package") return false;
  if (isGeneratedOrDependencyPath(node)) return false;

  if (READ_FIRST_NODE_KINDS.has(node.kind)) return true;
  if (allowTests && node.kind === "test") return true;
  if (includeDocs && (node.kind === "doc_file" || node.kind === "doc_section")) return true;

  return false;
}

export function classifyStartGuidanceBucket(node: UnifiedCodeGraphNode): StartGuidanceBucket {
  if (isTestNode(node)) return "related_tests";
  if (node.kind === "doc_file" || node.kind === "doc_section") return "supporting_docs";
  if (node.kind === "config_file") return "operational_config";
  if (node.kind === "symbol" && isInterfaceSymbol(node)) return "public_contracts";
  if (node.kind === "symbol" && isClassLikeSymbol(node)) {
    const label = nodeLabelText(node);
    if (/viewmodel|controller|entrypoint|\bmain\b|program|startup|appdelegate|service|adapter|repository|manager|provider/.test(label)) {
      return "start_with";
    }
    return "core_implementation";
  }
  if (node.kind === "code_file") {
    const text = nodeText(node);
    if (/viewmodel|controller|\bmain\b|program|startup|appdelegate|service|adapter|repository/.test(text)) {
      return "start_with";
    }
    return "core_implementation";
  }
  if (node.kind === "community") return "core_implementation";
  return "core_implementation";
}

export function buildStartGuidanceDegreeMap(graph: UnifiedCodeGraph) {
  const degree = new Map<string, number>();
  const bump = (nodeId: string) => degree.set(nodeId, (degree.get(nodeId) ?? 0) + 1);
  for (const edge of graph.edges) {
    bump(edge.sourceNodeId);
    bump(edge.targetNodeId);
  }
  return degree;
}

function queryModeAdjustment(node: UnifiedCodeGraphNode, queryMode: StartGuidanceQueryMode) {
  if (queryMode === "all" || queryMode === "balanced") return 0;
  if (queryMode === "code") {
    if (node.kind === "doc_file" || node.kind === "doc_section") return 8;
    if (isTestNode(node)) return 6;
    return 0;
  }
  if (node.kind === "doc_file" || node.kind === "doc_section") return -2;
  if (isTestNode(node)) return 4;
  return 2;
}

function centralityAdjustment(node: UnifiedCodeGraphNode, degreeByNodeId?: Map<string, number>) {
  if (!degreeByNodeId) return 0;
  const degree = degreeByNodeId.get(node.id) ?? 0;
  if (degree < 3) return 0;
  if (node.kind !== "symbol" && node.kind !== "code_file") return 0;
  return -Math.min(3, Math.floor(degree / 4));
}

/**
 * Lower scores rank earlier. Mirrors the historical read-first contract with centrality and mode modifiers.
 */
export function scoreStartGuidanceNode(
  node: UnifiedCodeGraphNode,
  options: StartGuidanceRankOptions = {}
) {
  const queryMode = options.queryMode ?? "balanced";
  const allowTests = options.allowTests ?? false;

  if (!allowTests && isTestNode(node) && queryMode !== "docs") {
    return 80;
  }

  let score: number;
  const text = nodeText(node);
  if (node.kind === "symbol") {
    const label = nodeLabelText(node);
    if (isClassLikeSymbol(node) && /mainviewmodel|main-view-model/.test(label)) score = 0;
    else if (isClassLikeSymbol(node) && /viewmodel|view-model/.test(label)) score = 1;
    else if (isClassLikeSymbol(node) && /controller|entrypoint|\bmain\b|program|startup|appdelegate/.test(label)) score = 2;
    else if (isClassLikeSymbol(node) && /service|adapter|manager|provider|repository/.test(label)) score = 3;
    else if (isClassLikeSymbol(node)) score = 4;
    else if (/viewmodel|controller|entrypoint|\bmain\b|service|adapter/.test(label)) score = 5;
    else score = 8;
  } else if (node.kind === "code_file") {
    if (/mainviewmodel|main-view-model/.test(text)) score = 6;
    else if (/viewmodel|view-model|controller|\bmain\b|program|startup|appdelegate/.test(text)) score = 7;
    else if (/service|adapter|manager|provider|repository/.test(text)) score = 8;
    else if (/\.(cs|ts|tsx|js|jsx|kt|java|rb|php|py|go|rs|swift|cpp|c|h|hpp|dart|gd|ps1|sh|bash)$/i.test(node.path ?? node.label)) {
      score = 9;
    } else {
      score = 10;
    }
  } else if (node.kind === "community") {
    score = 10;
  } else if (node.kind === "config_file") {
    score = 11;
  } else {
    score = 12;
  }

  score += queryModeAdjustment(node, queryMode);
  score += centralityAdjustment(node, options.degreeByNodeId);
  return score;
}

export function compareStartGuidanceNodes(
  left: UnifiedCodeGraphNode,
  right: UnifiedCodeGraphNode,
  options: StartGuidanceRankOptions = {}
) {
  const leftScore = scoreStartGuidanceNode(left, options);
  const rightScore = scoreStartGuidanceNode(right, options);
  if (leftScore !== rightScore) return leftScore - rightScore;
  const leftPath = left.path ?? left.label;
  const rightPath = right.path ?? right.label;
  const pathCompare = leftPath.localeCompare(rightPath);
  if (pathCompare !== 0) return pathCompare;
  return left.label.localeCompare(right.label);
}

export function rankStartGuidanceNodes(
  nodes: UnifiedCodeGraphNode[],
  options: StartGuidanceRankOptions = {}
) {
  return [...nodes]
    .filter((node) => isStartGuidanceEligibleNode(node, options))
    .sort((left, right) => compareStartGuidanceNodes(left, right, options));
}

export function getStartGuidanceReadFirstNodes(
  graph: UnifiedCodeGraph,
  limit = 8,
  options: StartGuidanceRankOptions = {}
) {
  const degreeByNodeId = options.degreeByNodeId ?? buildStartGuidanceDegreeMap(graph);
  return rankStartGuidanceNodes(graph.nodes, { ...options, degreeByNodeId }).slice(0, limit);
}

export interface CommunityStartGuidanceBuckets {
  startWith: string[];
  coreImplementation: string[];
  publicContracts: string[];
  relatedTests: string[];
  supportingDocs: string[];
  operationalConfig: string[];
}

function displayLabel(node: UnifiedCodeGraphNode) {
  return node.path ?? node.label;
}

function uniqueDisplayLabels(nodes: UnifiedCodeGraphNode[], limit: number) {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const label = displayLabel(node);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= limit) break;
  }
  return labels;
}

export function buildCommunityStartGuidanceBuckets(
  memberNodes: UnifiedCodeGraphNode[],
  graph: UnifiedCodeGraph,
  options: StartGuidanceRankOptions = {}
): CommunityStartGuidanceBuckets {
  const degreeByNodeId = options.degreeByNodeId ?? buildStartGuidanceDegreeMap(graph);
  const ranked = rankStartGuidanceNodes(memberNodes, {
    ...options,
    degreeByNodeId,
    allowTests: true,
    includeDocs: true,
  });
  const byBucket = new Map<StartGuidanceBucket, UnifiedCodeGraphNode[]>();
  for (const node of ranked) {
    const bucket = classifyStartGuidanceBucket(node);
    const current = byBucket.get(bucket) ?? [];
    current.push(node);
    byBucket.set(bucket, current);
  }

  const startCandidates = [
    ...(byBucket.get("start_with") ?? []),
    ...(byBucket.get("core_implementation") ?? []),
  ].filter((node) => !isTestNode(node) && ["symbol", "code_file"].includes(node.kind));

  return {
    startWith: uniqueDisplayLabels(startCandidates, 3),
    coreImplementation: uniqueDisplayLabels(byBucket.get("core_implementation") ?? [], 5),
    publicContracts: uniqueDisplayLabels(byBucket.get("public_contracts") ?? [], 4),
    relatedTests: uniqueDisplayLabels(byBucket.get("related_tests") ?? [], 3),
    supportingDocs: uniqueDisplayLabels(byBucket.get("supporting_docs") ?? [], 3),
    operationalConfig: uniqueDisplayLabels(byBucket.get("operational_config") ?? [], 3),
  };
}

export function communityStartGuidanceScore(
  memberNodes: UnifiedCodeGraphNode[],
  graph: UnifiedCodeGraph,
  options: StartGuidanceRankOptions = {}
) {
  const degreeByNodeId = options.degreeByNodeId ?? buildStartGuidanceDegreeMap(graph);
  const ranked = rankStartGuidanceNodes(
    memberNodes.filter((node) => !isTestNode(node)),
    { ...options, degreeByNodeId }
  );
  const top = ranked[0];
  return top ? scoreStartGuidanceNode(top, { ...options, degreeByNodeId }) : Number.POSITIVE_INFINITY;
}