import type { UnifiedCodeGraph, UnifiedCodeGraphEdge, UnifiedCodeGraphNode } from "./codeGraph.js";
import { filterUnifiedGraphByLens, type GraphTaskLensId } from "./graphLenses.js";

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
}

export interface GraphPathResult {
  from: string;
  to: string;
  fromNode?: UnifiedCodeGraphNode;
  toNode?: UnifiedCodeGraphNode;
  found: boolean;
  nodes: UnifiedCodeGraphNode[];
  edges: UnifiedCodeGraphEdge[];
}

export interface GraphExplainResult {
  target: string;
  resolved: boolean;
  node?: UnifiedCodeGraphNode;
  neighbors: UnifiedCodeGraphNode[];
  edges: UnifiedCodeGraphEdge[];
  summary: string;
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function tokenizeGraphQuery(query: string) {
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

export function scoreGraphNodeForQuery(node: UnifiedCodeGraphNode, tokens: string[]) {
  if (tokens.length === 0) return 0;
  const haystack = normalizeSearchText(
    [
      node.id,
      node.kind,
      node.label,
      node.path ?? "",
      node.scannerId ?? "",
      node.projectType ?? "",
      ...Object.values(node.metadata ?? {}).map((value) => String(value)),
    ].join(" ")
  );
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length;
  }
  return score;
}

export function findGraphSeedNodes(
  graph: UnifiedCodeGraph,
  query: string,
  seedLimit = 5
) {
  const tokens = tokenizeGraphQuery(query);
  return [...graph.nodes]
    .map((node) => ({ node, score: scoreGraphNodeForQuery(node, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.node.label.localeCompare(right.node.label))
    .slice(0, seedLimit)
    .map((entry) => entry.node);
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
    return { query, mode, seeds, nodes: [], edges: [], truncated: false };
  }
  const subgraph = collectSubgraph(scopedGraph, seeds.map((node) => node.id), { mode, budget, maxDepth });
  return {
    query,
    mode,
    seeds,
    nodes: subgraph.nodes,
    edges: subgraph.edges,
    truncated: subgraph.truncated,
  };
}

export function resolveGraphNode(graph: UnifiedCodeGraph, target: string) {
  const normalizedTarget = target.trim().toLowerCase();
  const exactId = graph.nodes.find((node) => node.id.toLowerCase() === normalizedTarget);
  if (exactId) return exactId;
  const exactPath = graph.nodes.find((node) => (node.path ?? "").toLowerCase() === normalizedTarget);
  if (exactPath) return exactPath;
  const exactLabel = graph.nodes.find((node) => node.label.toLowerCase() === normalizedTarget);
  if (exactLabel) return exactLabel;
  const tokens = tokenizeGraphQuery(target);
  const ranked = [...graph.nodes]
    .map((node) => ({ node, score: scoreGraphNodeForQuery(node, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.node.label.localeCompare(right.node.label));
  return ranked[0]?.node;
}

export function findGraphPath(
  graph: UnifiedCodeGraph,
  fromQuery: string,
  toQuery: string
): GraphPathResult {
  const fromNode = resolveGraphNode(graph, fromQuery);
  const toNode = resolveGraphNode(graph, toQuery);
  if (!fromNode || !toNode) {
    return {
      from: fromQuery,
      to: toQuery,
      fromNode,
      toNode,
      found: false,
      nodes: [fromNode, toNode].filter((node): node is UnifiedCodeGraphNode => Boolean(node)),
      edges: [],
    };
  }

  const adjacency = buildGraphAdjacency(graph);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const previous = new Map<string, string | null>([[fromNode.id, null]]);
  const queue = [fromNode.id];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toNode.id) break;
    for (const neighborId of [...(adjacency.get(current) ?? [])].sort()) {
      if (previous.has(neighborId)) continue;
      previous.set(neighborId, current);
      queue.push(neighborId);
    }
  }

  if (!previous.has(toNode.id)) {
    return { from: fromQuery, to: toQuery, fromNode, toNode, found: false, nodes: [fromNode, toNode], edges: [] };
  }

  const pathIds: string[] = [];
  let cursor: string | null = toNode.id;
  while (cursor) {
    pathIds.unshift(cursor);
    cursor = previous.get(cursor) ?? null;
  }

  const pathNodeSet = new Set(pathIds);
  const nodes = pathIds.map((id) => nodesById.get(id)).filter((node): node is UnifiedCodeGraphNode => Boolean(node));
  const edges = graph.edges.filter((edge) => pathNodeSet.has(edge.sourceNodeId) && pathNodeSet.has(edge.targetNodeId));
  return { from: fromQuery, to: toQuery, fromNode, toNode, found: true, nodes, edges };
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

  const summary = [
    `${node.label} (${node.kind})`,
    node.path ? `path: ${node.path}` : undefined,
    node.scannerId ? `scanner: ${node.scannerId}` : undefined,
    `${edges.length} connected edge(s), ${neighbors.length} neighbor(s).`,
  ].filter(Boolean).join(" ");

  return { target, resolved: true, node, neighbors, edges, summary };
}