import type { UnifiedCodeGraph, UnifiedCodeGraphEdge, UnifiedCodeGraphNode } from "./codeGraph.js";
import { formatEdgeProvenanceLabel } from "./graphEdgeProvenance.js";
import {
  buildGraphCommunitySummaries,
  findGraphCommunityForNode,
  type GraphCommunityContext,
} from "./graphCommunities.js";
import { filterUnifiedGraphByLens, type GraphTaskLensId } from "./graphLenses.js";
import {
  countIndexedSymbols,
  isDocsOrientedQuery,
  summarizeDocSectionNeighbors,
} from "./graphDocs.js";
import {
  rankGraphPathSeedCandidates,
  scoreGraphPathSeedNodeForQuery,
  tokenizeGraphPathSeedQuery,
} from "./graphPathSeedResolution.js";
import {
  classifyGraphPathIntent,
  isDocPathEdgeRelation,
  shouldPenalizeDocPathDetour,
  type GraphPathIntent,
} from "./graphPathIntent.js";
import {
  evaluateGraphPathQuality,
  isTestConstructorGraphEdge,
  isTestContextGraphNode,
  normalizeGraphPathEdgeRelation,
  SEMANTIC_PATH_RELATIONS,
} from "./graphPathQuality.js";

export interface GraphPathEdgeCostContext {
  sourceNode?: UnifiedCodeGraphNode;
  targetNode?: UnifiedCodeGraphNode;
}

const SEMANTIC_RELATION_COSTS = new Map<string, number>([
  ["calls", 3],
  ["references", 4],
  ["depends_on", 5],
  ["uses", 5],
  ["route_to_handler", 6],
  ["asset_references", 8],
]);

function constructorRelationCost(mode: GraphPathMode) {
  if (mode === "structural") return 90;
  if (mode === "semantic") return 32;
  return 28;
}

function lookupSemanticRelationCost(relation: string, mode: GraphPathMode, lens?: GraphTaskLensId) {
  if (relation === "constructor") {
    return constructorRelationCost(mode);
  }
  if (relation === "tests") {
    return lens === "tests" ? 4 : 24;
  }
  return SEMANTIC_RELATION_COSTS.get(relation);
}
import {
  buildGraphQueryIntentSummary,
  rankGraphNodesForQueryIntent,
  resolveEffectiveGraphQueryIntentMode,
  type GraphQueryIntentMode,
  type GraphQueryIntentRankedCandidate,
  type GraphQueryIntentSummary,
} from "./graphQueryIntent.js";

export type GraphTraversalMode = "bfs" | "dfs";

export interface GraphQueryEngineOptions {
  mode?: GraphTraversalMode;
  intentMode?: GraphQueryIntentMode;
  budget?: number;
  maxDepth?: number;
  seedLimit?: number;
  lens?: GraphTaskLensId;
}

export interface GraphQueryResult {
  query: string;
  mode: GraphTraversalMode;
  seeds: UnifiedCodeGraphNode[];
  nodes: UnifiedCodeGraphNode[];
  edges: UnifiedCodeGraphEdge[];
  truncated: boolean;
  communities?: GraphCommunityContext[];
  intent?: GraphQueryIntentSummary;
}

export type GraphPathMode = "semantic" | "balanced" | "structural";

const GRAPH_PATH_MODES = new Set<GraphPathMode>(["semantic", "balanced", "structural"]);

export function parseGraphPathMode(value: string): GraphPathMode {
  const normalized = value.trim().toLowerCase();
  if (!GRAPH_PATH_MODES.has(normalized as GraphPathMode)) {
    throw new Error(`Unknown graph path mode '${value}'. Expected semantic, balanced, or structural.`);
  }
  return normalized as GraphPathMode;
}

export interface GraphPathOptions {
  lens?: GraphTaskLensId;
  maxHops?: number;
  explainRanking?: boolean;
  mode?: GraphPathMode;
  pathIntent?: GraphPathIntent;
}

export interface GraphPathSeedResolution {
  query: string;
  nodeId?: string;
  label?: string;
  kind?: UnifiedCodeGraphNode["kind"];
  score: number;
  matchReason: string;
}

export interface GraphPathStep {
  node: UnifiedCodeGraphNode;
  viaEdge?: UnifiedCodeGraphEdge;
  edgeCost?: number;
  nodePenalty?: number;
  hop: number;
}

export interface GraphPathPenalizedAlternative {
  summary: string;
  nodeLabels: string[];
  bridgeKinds: string[];
  totalCost?: number;
  mode?: GraphPathMode;
  directnessScore?: number;
  semanticEdgeCount?: number;
  structuralEdgeCount?: number;
  decidingPenalty?: string;
}

export interface GraphPathExplanation {
  lens: GraphTaskLensId;
  mode: GraphPathMode;
  pathIntent: GraphPathIntent;
  seedResolution: {
    from: GraphPathSeedResolution;
    to: GraphPathSeedResolution;
  };
  steps: GraphPathStep[];
  totalCost: number;
  penalizedAlternatives: GraphPathPenalizedAlternative[];
  docPenaltyNotes: string[];
}

export interface GraphPathResult {
  from: string;
  to: string;
  fromNode?: UnifiedCodeGraphNode;
  toNode?: UnifiedCodeGraphNode;
  found: boolean;
  nodes: UnifiedCodeGraphNode[];
  edges: UnifiedCodeGraphEdge[];
  explanation?: GraphPathExplanation;
}

export interface GraphExplainResult {
  target: string;
  resolved: boolean;
  node?: UnifiedCodeGraphNode;
  neighbors: UnifiedCodeGraphNode[];
  edges: UnifiedCodeGraphEdge[];
  summary: string;
  community?: GraphCommunityContext;
}

export function tokenizeGraphQuery(query: string) {
  return tokenizeGraphPathSeedQuery(query);
}

export function scoreGraphNodeForQuery(node: UnifiedCodeGraphNode, tokens: string[]) {
  return scoreGraphPathSeedNodeForQuery(node, tokens);
}

function mapSeedsToRankedCandidates(
  seeds: UnifiedCodeGraphNode[],
  ranked: GraphQueryIntentRankedCandidate[]
): GraphQueryIntentRankedCandidate[] {
  const rankedById = new Map(ranked.map((entry) => [entry.node.id, entry]));
  return seeds
    .map((seed) => rankedById.get(seed.id))
    .filter((entry): entry is GraphQueryIntentRankedCandidate => Boolean(entry));
}

export function resolveGraphSeedNodes(
  graph: UnifiedCodeGraph,
  query: string,
  seedLimit = 5,
  intentMode: GraphQueryIntentMode = "balanced"
) {
  const effectiveMode = resolveEffectiveGraphQueryIntentMode(query, intentMode);
  const { ranked } = rankGraphNodesForQueryIntent(graph.nodes, query, intentMode);

  const seeds = ranked.slice(0, seedLimit).map((entry) => entry.node);
  const symbolSeeds = seeds.filter((node) => node.kind === "symbol");
  const sparseSymbols = countIndexedSymbols(graph) <= 3 || symbolSeeds.length === 0;
  let finalSeeds = seeds;
  if (!((effectiveMode === "code" || effectiveMode === "balanced") && !sparseSymbols && !isDocsOrientedQuery(query))) {
    const docSeeds = ranked
      .filter((entry) => entry.node.kind === "doc_section" || entry.node.kind === "doc_file")
      .slice(0, Math.max(2, Math.floor(seedLimit / 2)))
      .map((entry) => entry.node);
    finalSeeds = [...new Set([...seeds, ...docSeeds])].slice(0, seedLimit);
  }

  return {
    seeds: finalSeeds,
    rankedSeeds: mapSeedsToRankedCandidates(finalSeeds, ranked),
  };
}

export function findGraphSeedNodes(
  graph: UnifiedCodeGraph,
  query: string,
  seedLimit = 5,
  intentMode: GraphQueryIntentMode = "balanced"
) {
  return resolveGraphSeedNodes(graph, query, seedLimit, intentMode).seeds;
}

export function buildGraphAdjacency(graph: UnifiedCodeGraph) {
  const adjacency = new Map<string, Set<string>>();
  const add = (sourceId: string, targetId: string) => {
    const current = adjacency.get(sourceId) ?? new Set<string>();
    current.add(targetId);
    adjacency.set(sourceId, current);
  };
  for (const edge of graph.edges) {
    add(edge.sourceNodeId, edge.targetNodeId);
    add(edge.targetNodeId, edge.sourceNodeId);
  }
  return adjacency;
}

function collectSubgraph(
  graph: UnifiedCodeGraph,
  startNodeIds: string[],
  options: Required<Pick<GraphQueryEngineOptions, "mode" | "budget" | "maxDepth">>
) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildGraphAdjacency(graph);
  const visited = new Set<string>(startNodeIds);
  const ordered: string[] = [...startNodeIds];
  const queue = [...startNodeIds.map((id) => ({ id, depth: 0 }))];
  const stack = [...startNodeIds.map((id) => ({ id, depth: 0 }))];

  while (ordered.length < options.budget) {
    const current = options.mode === "bfs" ? queue.shift() : stack.pop();
    if (!current) break;
    if (current.depth >= options.maxDepth) continue;
    const neighbors = [...(adjacency.get(current.id) ?? [])].sort((left, right) => left.localeCompare(right));
    for (const neighborId of neighbors) {
      if (visited.has(neighborId)) continue;
      if (ordered.length >= options.budget) break;
      visited.add(neighborId);
      ordered.push(neighborId);
      const next = { id: neighborId, depth: current.depth + 1 };
      if (options.mode === "bfs") queue.push(next);
      else stack.push(next);
    }
  }

  const nodeSet = new Set(ordered);
  const nodes = ordered.map((id) => nodesById.get(id)).filter((node): node is UnifiedCodeGraphNode => Boolean(node));
  const edges = graph.edges.filter((edge) => nodeSet.has(edge.sourceNodeId) && nodeSet.has(edge.targetNodeId));
  return {
    nodes,
    edges,
    truncated: visited.size > ordered.length || ordered.length >= options.budget,
  };
}

export function queryUnifiedCodeGraph(
  graph: UnifiedCodeGraph,
  query: string,
  options: GraphQueryEngineOptions = {}
): GraphQueryResult {
  const scopedGraph = options.lens && options.lens !== "all"
    ? filterUnifiedGraphByLens(graph, options.lens)
    : graph;
  const mode = options.mode ?? "bfs";
  const intentMode = options.intentMode ?? "balanced";
  const budget = options.budget ?? 40;
  const maxDepth = options.maxDepth ?? 4;
  const seedLimit = options.seedLimit ?? 5;
  const { seeds, rankedSeeds } = resolveGraphSeedNodes(scopedGraph, query, seedLimit, intentMode);
  if (seeds.length === 0) {
    return {
      query,
      mode,
      seeds,
      nodes: [],
      edges: [],
      truncated: false,
      communities: buildGraphCommunitySummaries(scopedGraph, 6).map((summary) => ({
        id: summary.id,
        label: summary.label,
        path: summary.path,
        summary: summary.summary,
        fileCount: summary.fileCount,
        taskLens: summary.taskLens,
      })),
      intent: buildGraphQueryIntentSummary({
        query,
        requestedMode: intentMode,
        seeds: [],
        nodes: [],
        rankedSeeds: [],
      }),
    };
  }
  const subgraph = collectSubgraph(scopedGraph, seeds.map((node) => node.id), { mode, budget, maxDepth });
  const communityIds = new Set<string>();
  for (const node of subgraph.nodes) {
    const community = findGraphCommunityForNode(scopedGraph, node.id);
    if (community) communityIds.add(community.id);
  }
  const communities = [...communityIds]
    .map((communityId) => findGraphCommunityForNode(scopedGraph, communityId))
    .filter((community): community is GraphCommunityContext => Boolean(community))
    .sort((left, right) => right.fileCount - left.fileCount || left.label.localeCompare(right.label));
  const intent = buildGraphQueryIntentSummary({
    query,
    requestedMode: intentMode,
    seeds,
    nodes: subgraph.nodes,
    rankedSeeds,
  });
  return {
    query,
    mode,
    seeds,
    nodes: subgraph.nodes,
    edges: subgraph.edges,
    truncated: subgraph.truncated,
    communities,
    intent,
  };
}

export function rankGraphNodeCandidates(graph: UnifiedCodeGraph, target: string, limit = 5) {
  return rankGraphPathSeedCandidates(graph.nodes, target, limit);
}

export function resolveGraphNode(graph: UnifiedCodeGraph, target: string) {
  return rankGraphNodeCandidates(graph, target, 1)[0]?.node;
}

function isLowValueBridgeNode(node: UnifiedCodeGraphNode) {
  if (node.kind === "workspace") return true;
  if (node.kind === "project" && (node.label === "workspace-root" || node.path === ".")) return true;
  if (node.kind === "package" || node.kind === "directory") return true;
  if (node.kind === "community") return true;
  if (node.kind === "god_node") return true;
  if (node.kind === "symbol" && /\(namespace\)/i.test(node.label)) return true;
  if (node.kind === "symbol" && /\(external\)/i.test(node.label)) return true;
  return false;
}

const SEMANTIC_PATH_EDGE_KINDS = new Set<UnifiedCodeGraphEdge["kind"]>([
  "references",
  "depends_on",
  "implements",
  "inherits",
  "tests",
  "declares",
]);

interface GraphPathRank {
  cost: number;
  testHops: number;
  structuralHops: number;
  hubHops: number;
  inheritanceHops: number;
  hopCount: number;
}

function compareGraphPathRanks(left: GraphPathRank, right: GraphPathRank) {
  if (left.cost !== right.cost) return left.cost - right.cost;
  if (left.testHops !== right.testHops) return left.testHops - right.testHops;
  if (left.structuralHops !== right.structuralHops) return left.structuralHops - right.structuralHops;
  if (left.hubHops !== right.hubHops) return left.hubHops - right.hubHops;
  if (left.inheritanceHops !== right.inheritanceHops) return left.inheritanceHops - right.inheritanceHops;
  return left.hopCount - right.hopCount;
}

function isStructuralPathRelation(relation: string, edgeKind: UnifiedCodeGraphEdge["kind"]) {
  return relation === "belongs_to"
    || relation === "source_file"
    || relation === "declares"
    || relation === "constructor"
    || relation === "project_reference"
    || relation === "using_directive"
    || edgeKind === "belongs_to"
    || edgeKind === "declares";
}

function isInheritancePathRelation(relation: string, edgeKind: UnifiedCodeGraphEdge["kind"]) {
  return relation === "inherits" || relation === "implements" || edgeKind === "inherits" || edgeKind === "implements";
}

function resolveGraphPathMode(options: GraphPathOptions): GraphPathMode {
  return options.mode ?? "balanced";
}

function isSemanticPathEdge(edge: UnifiedCodeGraphEdge, mode: GraphPathMode) {
  if (mode !== "semantic") return true;
  if (edge.provenance !== "extracted" && edge.provenance !== "manual") return false;
  if (SEMANTIC_PATH_EDGE_KINDS.has(edge.kind)) return true;
  const relation = normalizeGraphPathEdgeRelation(edge);
  return relation === "belongs_to" || relation === "declares";
}

function buildNodeDegreeMap(graph: UnifiedCodeGraph) {
  const degree = new Map<string, number>();
  const bump = (nodeId: string) => degree.set(nodeId, (degree.get(nodeId) ?? 0) + 1);
  for (const edge of graph.edges) {
    bump(edge.sourceNodeId);
    bump(edge.targetNodeId);
  }
  return degree;
}

function isHighDegreeHubNode(graph: UnifiedCodeGraph, node: UnifiedCodeGraphNode, degreeMap: Map<string, number>) {
  if (isLowValueBridgeNode(node)) return true;
  return (degreeMap.get(node.id) ?? 0) >= 12;
}

export function computeGraphPathNodePenalty(node: UnifiedCodeGraphNode, options: GraphPathOptions = {}) {
  const mode = resolveGraphPathMode(options);
  const pathIntent = options.pathIntent ?? "mixed_or_unknown";
  if (mode === "semantic" && isLowValueBridgeNode(node)) {
    return 50_000;
  }
  if (shouldPenalizeDocPathDetour(pathIntent, mode)) {
    if (node.kind === "doc_section" || node.kind === "doc_file") {
      return 50_000;
    }
  }
  if (pathIntent === "code_to_code" && options.lens !== "tests" && isTestContextGraphNode(node)) {
    return 12_000;
  }

  let symbolPenalty = 2;
  if (/\(namespace\)/i.test(node.label)) {
    symbolPenalty = 900;
  } else if (/\(external\)/i.test(node.label)) {
    symbolPenalty = 700;
  } else if (/\(interface\)/i.test(node.label)) {
    symbolPenalty = pathIntent === "code_to_code" ? 180 : 80;
  } else if (/\(field\)|\(property\)/i.test(node.label)) {
    symbolPenalty = 240;
  } else if (/\(method\)|\(function\)/i.test(node.label)) {
    symbolPenalty = 12;
  }

  const balancedPenalty: Partial<Record<UnifiedCodeGraphNode["kind"], number>> = {
    workspace: 5_000,
    project: node.label === "workspace-root" || node.path === "." ? 2_500 : 600,
    package: 450,
    directory: 400,
    community: 350,
    god_node: 250,
    config_file: 120,
    doc_section: shouldPenalizeDocPathDetour(pathIntent, mode) ? 50_000 : 35,
    doc_file: shouldPenalizeDocPathDetour(pathIntent, mode) ? 50_000 : 100,
    asset_file: 90,
    external_dep: 500,
    test: options.lens === "tests" ? 4 : 12_000,
    code_file: 18,
    symbol: symbolPenalty,
    route: 24,
    command: 24,
  };

  const structuralMultiplier = mode === "structural" ? 0.35 : 1;
  const penalty = balancedPenalty[node.kind] ?? 40;
  return Math.round(penalty * structuralMultiplier);
}

export function computeGraphPathEdgeCost(
  edge: UnifiedCodeGraphEdge,
  options: GraphPathOptions = {},
  context: GraphPathEdgeCostContext = {}
) {
  const mode = resolveGraphPathMode(options);
  if (!isSemanticPathEdge(edge, mode)) {
    return Number.POSITIVE_INFINITY;
  }

  const rawRelation = typeof edge.metadata?.scannerRelation === "string"
    ? edge.metadata.scannerRelation
    : undefined;
  const relation = normalizeGraphPathEdgeRelation(edge);
  const pathIntent = options.pathIntent ?? "mixed_or_unknown";
  if (shouldPenalizeDocPathDetour(pathIntent, mode)
    && isDocPathEdgeRelation(rawRelation, edge.kind)) {
    return Number.POSITIVE_INFINITY;
  }
  if (isTestConstructorGraphEdge(edge, context.sourceNode, context.targetNode, options.lens)) {
    return Number.POSITIVE_INFINITY;
  }

  const balancedKindBase: Record<UnifiedCodeGraphEdge["kind"], number> = {
    references: 4,
    depends_on: 5,
    implements: pathIntent === "code_to_code" ? 14 : 8,
    inherits: pathIntent === "code_to_code" ? 16 : 9,
    tests: options.lens === "tests" ? 4 : 24,
    declares: 28,
    belongs_to: mode === "structural" ? 45 : relation === "belongs_to" ? 220 : 120,
    documents: 55,
    related_to: 50,
    build_produces: 75,
  };
  const provenanceMultiplier: Record<UnifiedCodeGraphEdge["provenance"], number> = {
    extracted: 1,
    manual: 1,
    inferred: mode === "structural" ? 1.1 : 1.25,
    ambiguous: mode === "structural" ? 1.25 : 1.6,
  };
  const relationCost = lookupSemanticRelationCost(relation, mode, options.lens);
  let cost = relationCost ?? (balancedKindBase[edge.kind] ?? 35);
  cost *= (provenanceMultiplier[edge.provenance] ?? 1.4);
  if (relation === "belongs_to" && pathIntent === "code_to_code" && mode !== "structural") {
    cost = Math.max(cost, mode === "semantic" ? 320 : 220);
  }
  if (relationCost !== undefined && SEMANTIC_PATH_RELATIONS.has(relation) && pathIntent === "code_to_code") {
    cost = Math.min(cost, relationCost);
  }
  if (!Number.isFinite(cost)) {
    return Number.POSITIVE_INFINITY;
  }
  return cost;
}

function buildWeightedAdjacency(graph: UnifiedCodeGraph, options: GraphPathOptions) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Array<{ neighborId: string; edge: UnifiedCodeGraphEdge; cost: number }>>();
  const add = (sourceId: string, targetId: string, edge: UnifiedCodeGraphEdge, cost: number) => {
    const current = adjacency.get(sourceId) ?? [];
    current.push({ neighborId: targetId, edge, cost });
    adjacency.set(sourceId, current);
  };
  for (const edge of graph.edges) {
    const cost = computeGraphPathEdgeCost(edge, options, {
      sourceNode: nodesById.get(edge.sourceNodeId),
      targetNode: nodesById.get(edge.targetNodeId),
    });
    if (!Number.isFinite(cost)) continue;
    add(edge.sourceNodeId, edge.targetNodeId, edge, cost);
    add(edge.targetNodeId, edge.sourceNodeId, edge, cost);
  }
  for (const entries of adjacency.values()) {
    entries.sort((left, right) =>
      left.neighborId.localeCompare(right.neighborId) || left.edge.id.localeCompare(right.edge.id)
    );
  }
  return adjacency;
}

function buildUnweightedEdgeAdjacency(graph: UnifiedCodeGraph) {
  const adjacency = new Map<string, Array<{ neighborId: string; edge: UnifiedCodeGraphEdge }>>();
  const add = (sourceId: string, targetId: string, edge: UnifiedCodeGraphEdge) => {
    const current = adjacency.get(sourceId) ?? [];
    current.push({ neighborId: targetId, edge });
    adjacency.set(sourceId, current);
  };
  for (const edge of graph.edges) {
    add(edge.sourceNodeId, edge.targetNodeId, edge);
    add(edge.targetNodeId, edge.sourceNodeId, edge);
  }
  for (const entries of adjacency.values()) {
    entries.sort((left, right) => left.neighborId.localeCompare(right.neighborId));
  }
  return adjacency;
}

function findUnweightedGraphPath(
  graph: UnifiedCodeGraph,
  fromNode: UnifiedCodeGraphNode,
  toNode: UnifiedCodeGraphNode,
  maxHops?: number
) {
  const adjacency = buildUnweightedEdgeAdjacency(graph);
  const previous = new Map<string, { nodeId: string; edge: UnifiedCodeGraphEdge } | null>([[fromNode.id, null]]);
  const hops = new Map<string, number>([[fromNode.id, 0]]);
  const queue = [fromNode.id];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toNode.id) break;
    const currentHops = hops.get(current) ?? 0;
    if (maxHops !== undefined && currentHops >= maxHops) continue;
    for (const entry of adjacency.get(current) ?? []) {
      if (previous.has(entry.neighborId)) continue;
      previous.set(entry.neighborId, { nodeId: current, edge: entry.edge });
      hops.set(entry.neighborId, currentHops + 1);
      queue.push(entry.neighborId);
    }
  }

  if (!previous.has(toNode.id)) return undefined;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const pathIds: string[] = [];
  const pathEdges: UnifiedCodeGraphEdge[] = [];
  let cursor: string | null = toNode.id;
  while (cursor) {
    pathIds.unshift(cursor);
    const step = previous.get(cursor);
    if (step) {
      pathEdges.unshift(step.edge);
      cursor = step.nodeId;
    } else {
      cursor = null;
    }
  }
  const nodes = pathIds.map((id) => nodesById.get(id)).filter((node): node is UnifiedCodeGraphNode => Boolean(node));
  return {
    nodes,
    edges: pathEdges,
  };
}

function buildGraphPathRank(
  previousRank: GraphPathRank,
  edge: UnifiedCodeGraphEdge,
  edgeCost: number,
  nodePenalty: number,
  neighbor: UnifiedCodeGraphNode,
  graph: UnifiedCodeGraph,
  degreeMap: Map<string, number>
): GraphPathRank {
  const relation = normalizeGraphPathEdgeRelation(edge);
  return {
    cost: previousRank.cost + edgeCost + nodePenalty,
    testHops: previousRank.testHops + (isTestContextGraphNode(neighbor) ? 1 : 0),
    structuralHops: previousRank.structuralHops + (isStructuralPathRelation(relation, edge.kind) ? 1 : 0),
    hubHops: previousRank.hubHops + (isHighDegreeHubNode(graph, neighbor, degreeMap) ? 1 : 0),
    inheritanceHops: previousRank.inheritanceHops + (isInheritancePathRelation(relation, edge.kind) ? 1 : 0),
    hopCount: previousRank.hopCount + 1,
  };
}

function dijkstraGraphPath(
  graph: UnifiedCodeGraph,
  fromNode: UnifiedCodeGraphNode,
  toNode: UnifiedCodeGraphNode,
  options: GraphPathOptions
) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildWeightedAdjacency(graph, options);
  const degreeMap = buildNodeDegreeMap(graph);
  const rankById = new Map<string, GraphPathRank>([[fromNode.id, {
    cost: 0,
    testHops: 0,
    structuralHops: 0,
    hubHops: 0,
    inheritanceHops: 0,
    hopCount: 0,
  }]]);
  const previous = new Map<string, { nodeId: string; edge: UnifiedCodeGraphEdge } | null>([[fromNode.id, null]]);
  const visited = new Set<string>();
  const queue = [fromNode.id];

  while (queue.length > 0) {
    queue.sort((left, right) => {
      const leftRank = rankById.get(left) ?? {
        cost: Number.POSITIVE_INFINITY,
        testHops: Number.POSITIVE_INFINITY,
        structuralHops: Number.POSITIVE_INFINITY,
        hubHops: Number.POSITIVE_INFINITY,
        inheritanceHops: Number.POSITIVE_INFINITY,
        hopCount: Number.POSITIVE_INFINITY,
      };
      const rightRank = rankById.get(right) ?? {
        cost: Number.POSITIVE_INFINITY,
        testHops: Number.POSITIVE_INFINITY,
        structuralHops: Number.POSITIVE_INFINITY,
        hubHops: Number.POSITIVE_INFINITY,
        inheritanceHops: Number.POSITIVE_INFINITY,
        hopCount: Number.POSITIVE_INFINITY,
      };
      const compared = compareGraphPathRanks(leftRank, rightRank);
      return compared !== 0 ? compared : left.localeCompare(right);
    });
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === toNode.id) break;

    const currentRank = rankById.get(current) ?? {
      cost: Number.POSITIVE_INFINITY,
      testHops: 0,
      structuralHops: 0,
      hubHops: 0,
      inheritanceHops: 0,
      hopCount: 0,
    };

    for (const entry of adjacency.get(current) ?? []) {
      const neighbor = nodesById.get(entry.neighborId);
      if (!neighbor) continue;
      const nextRankBase = buildGraphPathRank(
        currentRank,
        entry.edge,
        entry.cost,
        computeGraphPathNodePenalty(neighbor, options),
        neighbor,
        graph,
        degreeMap
      );
      if (options.maxHops !== undefined && nextRankBase.hopCount > options.maxHops) continue;
      const knownRank = rankById.get(entry.neighborId);
      if (knownRank !== undefined && compareGraphPathRanks(nextRankBase, knownRank) >= 0) continue;
      rankById.set(entry.neighborId, nextRankBase);
      previous.set(entry.neighborId, { nodeId: current, edge: entry.edge });
      if (!visited.has(entry.neighborId)) queue.push(entry.neighborId);
    }
  }

  if (!rankById.has(toNode.id)) return undefined;

  const pathIds: string[] = [];
  const pathEdges: UnifiedCodeGraphEdge[] = [];
  let cursor: string | null = toNode.id;
  while (cursor) {
    pathIds.unshift(cursor);
    const step = previous.get(cursor);
    if (step) {
      pathEdges.unshift(step.edge);
      cursor = step.nodeId;
    } else {
      cursor = null;
    }
  }

  const steps: GraphPathStep[] = pathIds.map((nodeId, index) => {
    const node = nodesById.get(nodeId)!;
    const viaEdge = index > 0 ? pathEdges[index - 1] : undefined;
    const edgeCost = viaEdge ? computeGraphPathEdgeCost(viaEdge, options) : undefined;
    const nodePenalty = index > 0 ? computeGraphPathNodePenalty(node, options) : 0;
    return { node, viaEdge, edgeCost, nodePenalty, hop: index };
  });

  return {
    nodes: pathIds.map((id) => nodesById.get(id)!).filter(Boolean),
    edges: pathEdges,
    steps,
    totalCost: rankById.get(toNode.id)?.cost ?? 0,
  };
}

function buildSeedResolution(query: string, candidate?: ReturnType<typeof rankGraphNodeCandidates>[number]): GraphPathSeedResolution {
  if (!candidate) {
    return { query, score: 0, matchReason: "no match" };
  }
  return {
    query,
    nodeId: candidate.node.id,
    label: candidate.node.label,
    kind: candidate.node.kind,
    score: candidate.score,
    matchReason: candidate.matchReason,
  };
}

const PATH_SEED_CANDIDATE_LIMIT = 3;

function pathHasHubDetour(
  graph: UnifiedCodeGraph,
  nodes: UnifiedCodeGraphNode[],
  degreeMap: Map<string, number>
) {
  if (nodes.length <= 2) return false;
  return nodes.slice(1, -1).some((node) => isHighDegreeHubNode(graph, node, degreeMap));
}

function buildPathExplanation(
  graph: UnifiedCodeGraph,
  options: GraphPathOptions,
  lens: GraphTaskLensId,
  fromQuery: string,
  toQuery: string,
  chosenFrom: ReturnType<typeof rankGraphNodeCandidates>[number],
  chosenTo: ReturnType<typeof rankGraphNodeCandidates>[number],
  weighted: NonNullable<ReturnType<typeof dijkstraGraphPath>>,
  alternatives: GraphPathPenalizedAlternative[],
  pathIntent: GraphPathIntent
): GraphPathExplanation {
  const docPenaltyNotes: string[] = [];
  if (shouldPenalizeDocPathDetour(pathIntent, resolveGraphPathMode(options))) {
    docPenaltyNotes.push("Detected code-to-code path intent; doc_file and doc_section hops are heavily penalized.");
    const docHops = weighted.steps.filter((step) =>
      step.node.kind === "doc_section" || step.node.kind === "doc_file"
    );
    if (docHops.length > 0) {
      docPenaltyNotes.push(`Doc detour nodes in chosen path: ${docHops.map((step) => step.node.label).join(", ")}`);
    }
  } else if (pathIntent === "doc_to_code" || pathIntent === "doc_to_doc") {
    docPenaltyNotes.push("Docs-oriented path intent; documentation nodes and edges are allowed.");
  }

  return {
    lens,
    mode: resolveGraphPathMode(options),
    pathIntent,
    seedResolution: {
      from: buildSeedResolution(fromQuery, chosenFrom),
      to: buildSeedResolution(toQuery, chosenTo),
    },
    steps: weighted.steps,
    totalCost: weighted.totalCost,
    penalizedAlternatives: alternatives,
    docPenaltyNotes,
  };
}

export function findGraphPath(
  graph: UnifiedCodeGraph,
  fromQuery: string,
  toQuery: string,
  options: GraphPathOptions = {}
): GraphPathResult {
  const lens = options.lens ?? "all";
  const pathMode = resolveGraphPathMode(options);
  const scopedGraph = lens !== "all" ? filterUnifiedGraphByLens(graph, lens) : graph;
  const degreeMap = buildNodeDegreeMap(scopedGraph);
  const fromCandidates = rankGraphNodeCandidates(scopedGraph, fromQuery, PATH_SEED_CANDIDATE_LIMIT);
  const toCandidates = rankGraphNodeCandidates(scopedGraph, toQuery, PATH_SEED_CANDIDATE_LIMIT);
  const fallbackFromNode = fromCandidates[0]?.node;
  const fallbackToNode = toCandidates[0]?.node;

  if (!fallbackFromNode || !fallbackToNode) {
    return {
      from: fromQuery,
      to: toQuery,
      fromNode: fallbackFromNode,
      toNode: fallbackToNode,
      found: false,
      nodes: [fallbackFromNode, fallbackToNode].filter((node): node is UnifiedCodeGraphNode => Boolean(node)),
      edges: [],
    };
  }

  let weighted: ReturnType<typeof dijkstraGraphPath> | undefined;
  let chosenFrom = fromCandidates[0]!;
  let chosenTo = toCandidates[0]!;
  const pathIntent = options.pathIntent ?? classifyGraphPathIntent({
    fromNode: chosenFrom.node,
    toNode: chosenTo.node,
    fromQuery,
    toQuery,
  });
  const pathOptions: GraphPathOptions = { ...options, lens, mode: pathMode, pathIntent };

  const tryCandidatePair = (
    fromCandidate: (typeof fromCandidates)[number],
    toCandidate: (typeof toCandidates)[number]
  ) => {
    if (fromCandidate.node.id === toCandidate.node.id) return;
    const candidatePath = dijkstraGraphPath(
      scopedGraph,
      fromCandidate.node,
      toCandidate.node,
      {
        ...pathOptions,
        pathIntent: options.pathIntent ?? classifyGraphPathIntent({
          fromNode: fromCandidate.node,
          toNode: toCandidate.node,
          fromQuery,
          toQuery,
        }),
      }
    );
    if (!candidatePath) return;
    if (!weighted || candidatePath.totalCost < weighted.totalCost) {
      weighted = candidatePath;
      chosenFrom = fromCandidate;
      chosenTo = toCandidate;
    }
  };

  tryCandidatePair(fromCandidates[0]!, toCandidates[0]!);
  if (!weighted) {
    const primaryConnected = findUnweightedGraphPath(
      scopedGraph,
      fromCandidates[0]!.node,
      toCandidates[0]!.node,
      options.maxHops
    )?.nodes;
    if (!primaryConnected && options.maxHops === undefined) {
      for (const fromCandidate of fromCandidates) {
        for (const toCandidate of toCandidates) {
          if (fromCandidate === fromCandidates[0] && toCandidate === toCandidates[0]) continue;
          tryCandidatePair(fromCandidate, toCandidate);
        }
      }
    }
  }

  const fromNode = chosenFrom.node;
  const toNode = chosenTo.node;

  if (!weighted || fromNode.id === toNode.id) {
    return {
      from: fromQuery,
      to: toQuery,
      fromNode: fallbackFromNode,
      toNode: fallbackToNode,
      found: false,
      nodes: [fallbackFromNode, fallbackToNode].filter((node, index, array) =>
        array.findIndex((entry) => entry.id === node.id) === index
      ),
      edges: [],
    };
  }

  const penalizedAlternatives: GraphPathPenalizedAlternative[] = [];
  const balancedPath = weighted;

  const annotateAlternative = (
    alternative: GraphPathPenalizedAlternative,
    nodes: UnifiedCodeGraphNode[],
    edges: UnifiedCodeGraphEdge[],
    decidingPenalty?: string
  ): GraphPathPenalizedAlternative => {
    const metrics = evaluateGraphPathQuality(scopedGraph, {
      from: fromQuery,
      to: toQuery,
      fromNode,
      toNode,
      found: true,
      nodes,
      edges,
    });
    return {
      ...alternative,
      directnessScore: metrics.directnessScore,
      semanticEdgeCount: metrics.semanticEdgeCount,
      structuralEdgeCount: metrics.structuralEdgeCount,
      decidingPenalty,
    };
  };

  if (pathMode === "balanced" && pathHasHubDetour(scopedGraph, balancedPath.nodes, degreeMap)) {
    const semanticPath = dijkstraGraphPath(
      scopedGraph,
      fromNode,
      toNode,
      { ...pathOptions, mode: "semantic" }
    );
    if (semanticPath && !pathHasHubDetour(scopedGraph, semanticPath.nodes, degreeMap)) {
      penalizedAlternatives.push(annotateAlternative({
        summary: "Balanced path detoured through high-degree or low-value hubs; semantic path preferred.",
        nodeLabels: balancedPath.nodes.map((node) => node.label),
        bridgeKinds: [...new Set(
          balancedPath.nodes
            .filter((node) => isHighDegreeHubNode(scopedGraph, node, degreeMap))
            .map((node) => node.kind)
        )],
        totalCost: balancedPath.totalCost,
        mode: "balanced",
      }, balancedPath.nodes, balancedPath.edges, "hub_detour_penalty"));
      weighted = semanticPath;
    }
  }

  if (options.explainRanking) {
    const hopPath = findUnweightedGraphPath(scopedGraph, fromNode, toNode, options.maxHops);
    const weightedIds = weighted.nodes.map((node) => node.id).join("|");
    const hopIds = hopPath?.nodes.map((node) => node.id).join("|");
    if (hopPath && hopIds !== weightedIds) {
      const bridgeKinds = hopPath.nodes
        .filter((node) => isLowValueBridgeNode(node))
        .map((node) => node.kind);
      penalizedAlternatives.push(annotateAlternative({
        summary: "Shorter hop-count path avoided due to low-value bridge nodes or weak edge provenance.",
        nodeLabels: hopPath.nodes.map((node) => node.label),
        bridgeKinds: [...new Set(bridgeKinds)],
        mode: "structural",
      }, hopPath.nodes, hopPath.edges, "structural_bridge_penalty"));
    }

    const structuralCandidate = dijkstraGraphPath(
      scopedGraph,
      fromNode,
      toNode,
      { ...pathOptions, mode: "structural" }
    );
    const structuralIds = structuralCandidate?.nodes.map((node) => node.id).join("|");
    if (structuralCandidate && structuralIds !== weightedIds) {
      const decidingPenalty = isTestContextGraphNode(structuralCandidate.nodes[1] ?? fromNode)
        ? "test_context_penalty"
        : structuralCandidate.edges.some((edge) => normalizeGraphPathEdgeRelation(edge) === "belongs_to")
          ? "structural_source_file_penalty"
          : "structural_fallback_penalty";
      penalizedAlternatives.push(annotateAlternative({
        summary: "Structural fallback path rejected in favor of a more direct semantic explanation.",
        nodeLabels: structuralCandidate.nodes.map((node) => node.label),
        bridgeKinds: [...new Set(structuralCandidate.nodes.map((node) => node.kind))],
        totalCost: structuralCandidate.totalCost,
        mode: "structural",
      }, structuralCandidate.nodes, structuralCandidate.edges, decidingPenalty));
    }
  }

  const explanation: GraphPathExplanation | undefined = options.explainRanking
    ? buildPathExplanation(
      scopedGraph,
      pathOptions,
      lens,
      fromQuery,
      toQuery,
      chosenFrom,
      chosenTo,
      weighted,
      penalizedAlternatives,
      pathIntent
    )
    : undefined;

  return {
    from: fromQuery,
    to: toQuery,
    fromNode,
    toNode,
    found: true,
    nodes: weighted.nodes,
    edges: weighted.edges,
    explanation,
  };
}

export function explainGraphNode(graph: UnifiedCodeGraph, target: string): GraphExplainResult {
  const node = resolveGraphNode(graph, target);
  if (!node) {
    return {
      target,
      resolved: false,
      neighbors: [],
      edges: [],
      summary: `No graph node matched '${target}'.`,
    };
  }

  const neighborIds = new Set<string>();
  const edges = graph.edges.filter((edge) => {
    if (edge.sourceNodeId === node.id) {
      neighborIds.add(edge.targetNodeId);
      return true;
    }
    if (edge.targetNodeId === node.id) {
      neighborIds.add(edge.sourceNodeId);
      return true;
    }
    return false;
  });
  const nodesById = new Map(graph.nodes.map((entry) => [entry.id, entry]));
  const neighbors = [...neighborIds]
    .map((id) => nodesById.get(id))
    .filter((entry): entry is UnifiedCodeGraphNode => Boolean(entry))
    .sort((left, right) => left.label.localeCompare(right.label));

  const community = findGraphCommunityForNode(graph, node.id);
  const docSectionSummary = summarizeDocSectionNeighbors(node, neighbors, edges);
  const provenanceSummary = edges.length > 0
    ? `edge trust: ${edges.slice(0, 4).map((edge) => formatEdgeProvenanceLabel(edge)).join("; ")}`
    : undefined;
  const summary = [
    `${node.label} (${node.kind})`,
    node.path ? `path: ${node.path}` : undefined,
    community ? `community: ${community.label} (${community.fileCount} files)` : undefined,
    community?.summary,
    docSectionSummary,
    node.scannerId ? `scanner: ${node.scannerId}` : undefined,
    `${edges.length} connected edge(s), ${neighbors.length} neighbor(s).`,
    provenanceSummary,
  ].filter(Boolean).join(" ");

  return { target, resolved: true, node, neighbors, edges, summary, community };
}