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
  scoreDocSectionForQuery,
  summarizeDocSectionNeighbors,
} from "./graphDocs.js";
import {
  rankGraphPathSeedCandidates,
  scoreGraphPathSeedNodeForQuery,
  tokenizeGraphPathSeedQuery,
} from "./graphPathSeedResolution.js";

export type GraphTraversalMode = "bfs" | "dfs";

export interface GraphQueryEngineOptions {
  mode?: GraphTraversalMode;
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
}

export type GraphPathMode = "semantic" | "balanced" | "structural";

export interface GraphPathOptions {
  lens?: GraphTaskLensId;
  maxHops?: number;
  explainRanking?: boolean;
  mode?: GraphPathMode;
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
}

export interface GraphPathExplanation {
  lens: GraphTaskLensId;
  mode: GraphPathMode;
  seedResolution: {
    from: GraphPathSeedResolution;
    to: GraphPathSeedResolution;
  };
  steps: GraphPathStep[];
  totalCost: number;
  penalizedAlternatives: GraphPathPenalizedAlternative[];
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

export function findGraphSeedNodes(
  graph: UnifiedCodeGraph,
  query: string,
  seedLimit = 5
) {
  const tokens = tokenizeGraphQuery(query);
  const ranked = [...graph.nodes]
    .map((node) => {
      let score = scoreGraphNodeForQuery(node, tokens);
      if (node.kind === "doc_section") {
        score = Math.max(score, scoreDocSectionForQuery(node, tokens));
      }
      if (isDocsOrientedQuery(query) && (node.kind === "doc_section" || node.kind === "doc_file")) {
        score += 40;
      }
      return { node, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.node.label.localeCompare(right.node.label));

  const seeds = ranked.slice(0, seedLimit).map((entry) => entry.node);
  const symbolSeeds = seeds.filter((node) => node.kind === "symbol");
  const sparseSymbols = countIndexedSymbols(graph) <= 3 || symbolSeeds.length === 0;
  if (!sparseSymbols && !isDocsOrientedQuery(query)) {
    return seeds;
  }

  const docSeeds = ranked
    .filter((entry) => entry.node.kind === "doc_section" || entry.node.kind === "doc_file")
    .slice(0, Math.max(2, Math.floor(seedLimit / 2)))
    .map((entry) => entry.node);
  return [...new Set([...seeds, ...docSeeds])].slice(0, seedLimit);
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
  const budget = options.budget ?? 40;
  const maxDepth = options.maxDepth ?? 4;
  const seedLimit = options.seedLimit ?? 5;
  const seeds = findGraphSeedNodes(scopedGraph, query, seedLimit);
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
  return {
    query,
    mode,
    seeds,
    nodes: subgraph.nodes,
    edges: subgraph.edges,
    truncated: subgraph.truncated,
    communities,
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

function resolveGraphPathMode(options: GraphPathOptions): GraphPathMode {
  return options.mode ?? "balanced";
}

function isSemanticPathEdge(edge: UnifiedCodeGraphEdge, mode: GraphPathMode) {
  if (mode !== "semantic") return true;
  if (edge.provenance !== "extracted" && edge.provenance !== "manual") return false;
  return SEMANTIC_PATH_EDGE_KINDS.has(edge.kind);
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
  if (mode === "semantic" && isLowValueBridgeNode(node)) {
    return 50_000;
  }

  const balancedPenalty: Partial<Record<UnifiedCodeGraphNode["kind"], number>> = {
    workspace: 5_000,
    project: node.label === "workspace-root" || node.path === "." ? 2_500 : 600,
    package: 450,
    directory: 400,
    community: 350,
    god_node: 250,
    config_file: 120,
    doc_section: 35,
    doc_file: 100,
    asset_file: 90,
    external_dep: 500,
    test: options.lens === "tests" ? 4 : 60,
    code_file: 18,
    symbol: /\(namespace\)/i.test(node.label) ? 900 : /\(external\)/i.test(node.label) ? 700 : 2,
    route: 24,
    command: 24,
  };

  const structuralMultiplier = mode === "structural" ? 0.35 : 1;
  const penalty = balancedPenalty[node.kind] ?? 40;
  return Math.round(penalty * structuralMultiplier);
}

export function computeGraphPathEdgeCost(edge: UnifiedCodeGraphEdge, options: GraphPathOptions = {}) {
  const mode = resolveGraphPathMode(options);
  if (!isSemanticPathEdge(edge, mode)) {
    return Number.POSITIVE_INFINITY;
  }

  const balancedKindBase: Record<UnifiedCodeGraphEdge["kind"], number> = {
    references: 4,
    depends_on: 6,
    implements: 5,
    inherits: 7,
    tests: options.lens === "tests" ? 4 : 8,
    declares: 20,
    belongs_to: mode === "structural" ? 45 : 120,
    documents: 55,
    related_to: 50,
    build_produces: 75,
  };
  const provenanceMultiplier: Record<UnifiedCodeGraphEdge["provenance"], number> = {
    extracted: 1,
    manual: 1,
    inferred: mode === "structural" ? 1.1 : 1.35,
    ambiguous: mode === "structural" ? 1.25 : 1.75,
  };
  const relation = typeof edge.metadata?.scannerRelation === "string"
    ? edge.metadata.scannerRelation
    : undefined;
  let cost = (balancedKindBase[edge.kind] ?? 35) * (provenanceMultiplier[edge.provenance] ?? 1.4);
  if (relation === "extends" || relation === "implements") {
    cost *= 0.9;
  }
  if (edge.kind === "belongs_to" && mode === "balanced") {
    cost *= 1.15;
  }
  return cost;
}

function buildWeightedAdjacency(graph: UnifiedCodeGraph, options: GraphPathOptions) {
  const adjacency = new Map<string, Array<{ neighborId: string; edge: UnifiedCodeGraphEdge; cost: number }>>();
  const add = (sourceId: string, targetId: string, edge: UnifiedCodeGraphEdge, cost: number) => {
    const current = adjacency.get(sourceId) ?? [];
    current.push({ neighborId: targetId, edge, cost });
    adjacency.set(sourceId, current);
  };
  for (const edge of graph.edges) {
    const cost = computeGraphPathEdgeCost(edge, options);
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

function findUnweightedGraphPath(
  graph: UnifiedCodeGraph,
  fromNode: UnifiedCodeGraphNode,
  toNode: UnifiedCodeGraphNode,
  maxHops?: number
) {
  const adjacency = buildGraphAdjacency(graph);
  const previous = new Map<string, string | null>([[fromNode.id, null]]);
  const hops = new Map<string, number>([[fromNode.id, 0]]);
  const queue = [fromNode.id];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toNode.id) break;
    const currentHops = hops.get(current) ?? 0;
    if (maxHops !== undefined && currentHops >= maxHops) continue;
    for (const neighborId of [...(adjacency.get(current) ?? [])].sort()) {
      if (previous.has(neighborId)) continue;
      previous.set(neighborId, current);
      hops.set(neighborId, currentHops + 1);
      queue.push(neighborId);
    }
  }

  if (!previous.has(toNode.id)) return undefined;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const pathIds: string[] = [];
  let cursor: string | null = toNode.id;
  while (cursor) {
    pathIds.unshift(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  return pathIds.map((id) => nodesById.get(id)).filter((node): node is UnifiedCodeGraphNode => Boolean(node));
}

function dijkstraGraphPath(
  graph: UnifiedCodeGraph,
  fromNode: UnifiedCodeGraphNode,
  toNode: UnifiedCodeGraphNode,
  options: GraphPathOptions
) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildWeightedAdjacency(graph, options);
  const dist = new Map<string, number>([[fromNode.id, 0]]);
  const hops = new Map<string, number>([[fromNode.id, 0]]);
  const previous = new Map<string, { nodeId: string; edge: UnifiedCodeGraphEdge } | null>([[fromNode.id, null]]);
  const visited = new Set<string>();
  const queue = [fromNode.id];

  while (queue.length > 0) {
    queue.sort((left, right) => {
      const leftDist = dist.get(left) ?? Number.POSITIVE_INFINITY;
      const rightDist = dist.get(right) ?? Number.POSITIVE_INFINITY;
      if (leftDist !== rightDist) return leftDist - rightDist;
      const leftHops = hops.get(left) ?? Number.POSITIVE_INFINITY;
      const rightHops = hops.get(right) ?? Number.POSITIVE_INFINITY;
      if (leftHops !== rightHops) return leftHops - rightHops;
      return left.localeCompare(right);
    });
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === toNode.id) break;

    const currentDist = dist.get(current) ?? Number.POSITIVE_INFINITY;
    const currentHops = hops.get(current) ?? 0;

    for (const entry of adjacency.get(current) ?? []) {
      const neighbor = nodesById.get(entry.neighborId);
      if (!neighbor) continue;
      const nextHops = currentHops + 1;
      if (options.maxHops !== undefined && nextHops > options.maxHops) continue;
      const nodePenalty = computeGraphPathNodePenalty(neighbor, options);
      const nextDist = currentDist + entry.cost + nodePenalty;
      const knownDist = dist.get(entry.neighborId);
      if (knownDist !== undefined && nextDist >= knownDist) continue;
      dist.set(entry.neighborId, nextDist);
      hops.set(entry.neighborId, nextHops);
      previous.set(entry.neighborId, { nodeId: current, edge: entry.edge });
      if (!visited.has(entry.neighborId)) queue.push(entry.neighborId);
    }
  }

  if (!dist.has(toNode.id)) return undefined;

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
    totalCost: dist.get(toNode.id) ?? 0,
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
  alternatives: GraphPathPenalizedAlternative[]
): GraphPathExplanation {
  return {
    lens,
    mode: resolveGraphPathMode(options),
    seedResolution: {
      from: buildSeedResolution(fromQuery, chosenFrom),
      to: buildSeedResolution(toQuery, chosenTo),
    },
    steps: weighted.steps,
    totalCost: weighted.totalCost,
    penalizedAlternatives: alternatives,
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

  const tryCandidatePair = (
    fromCandidate: (typeof fromCandidates)[number],
    toCandidate: (typeof toCandidates)[number]
  ) => {
    if (fromCandidate.node.id === toCandidate.node.id) return;
    const candidatePath = dijkstraGraphPath(
      scopedGraph,
      fromCandidate.node,
      toCandidate.node,
      { ...options, lens, mode: pathMode }
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
    );
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

  if (pathMode === "balanced" && pathHasHubDetour(scopedGraph, balancedPath.nodes, degreeMap)) {
    const semanticPath = dijkstraGraphPath(
      scopedGraph,
      fromNode,
      toNode,
      { ...options, lens, mode: "semantic" }
    );
    if (semanticPath && !pathHasHubDetour(scopedGraph, semanticPath.nodes, degreeMap)) {
      penalizedAlternatives.push({
        summary: "Balanced path detoured through high-degree or low-value hubs; semantic path preferred.",
        nodeLabels: balancedPath.nodes.map((node) => node.label),
        bridgeKinds: [...new Set(
          balancedPath.nodes
            .filter((node) => isHighDegreeHubNode(scopedGraph, node, degreeMap))
            .map((node) => node.kind)
        )],
        totalCost: balancedPath.totalCost,
        mode: "balanced",
      });
      weighted = semanticPath;
    }
  }

  if (options.explainRanking) {
    const hopPath = findUnweightedGraphPath(scopedGraph, fromNode, toNode, options.maxHops);
    const weightedIds = weighted.nodes.map((node) => node.id).join("|");
    const hopIds = hopPath?.map((node) => node.id).join("|");
    if (hopPath && hopIds !== weightedIds) {
      const bridgeKinds = hopPath
        .filter((node) => isLowValueBridgeNode(node))
        .map((node) => node.kind);
      penalizedAlternatives.push({
        summary: "Shorter hop-count path avoided due to low-value bridge nodes or weak edge provenance.",
        nodeLabels: hopPath.map((node) => node.label),
        bridgeKinds: [...new Set(bridgeKinds)],
        mode: "structural",
      });
    }
  }

  const explanation: GraphPathExplanation | undefined = options.explainRanking
    ? buildPathExplanation(
      scopedGraph,
      options,
      lens,
      fromQuery,
      toQuery,
      chosenFrom,
      chosenTo,
      weighted,
      penalizedAlternatives
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