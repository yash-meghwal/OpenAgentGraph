import type { UnifiedCodeGraph, UnifiedCodeGraphEdge, UnifiedCodeGraphNode } from "./codeGraph.js";
import { filterUnifiedGraphByLens, type GraphTaskLensId } from "./graphLenses.js";
import { isGraphPathFileExtension } from "./sourceExtensions.js";

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

export interface GraphPathOptions {
  lens?: GraphTaskLensId;
  maxHops?: number;
  explainRanking?: boolean;
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
}

export interface GraphPathExplanation {
  lens: GraphTaskLensId;
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

function pathBasename(value: string) {
  return value.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
}

function normalizePathQuery(query: string) {
  return query.trim().replace(/\\/g, "/").toLowerCase();
}

function looksLikeFileQuery(normalizedPathQuery: string) {
  const extension = pathBasename(normalizedPathQuery).split(".").pop()?.toLowerCase() ?? "";
  return extension.length >= 2 && isGraphPathFileExtension(extension);
}

function fileQueryStemTokens(normalizedPathQuery: string) {
  const queryBasename = pathBasename(normalizedPathQuery);
  const stem = queryBasename.replace(/\.[^.]+$/, "");
  return tokenizeGraphQuery(stem);
}

function hasFileQueryPathAlignment(
  normalizedPath: string,
  basename: string,
  normalizedPathQuery: string
) {
  if (normalizedPath === normalizedPathQuery) return true;
  if (basename && basename === normalizedPathQuery) return true;
  if (normalizedPath.endsWith(`/${normalizedPathQuery}`)) return true;
  const stemTokens = fileQueryStemTokens(normalizedPathQuery);
  return stemTokens.length > 0 && stemTokens.every((token) =>
    basename.includes(token) || normalizedPath.includes(token)
  );
}

function scoreGraphNodeForPathResolution(node: UnifiedCodeGraphNode, query: string, tokens: string[]) {
  const normalizedPathQuery = normalizePathQuery(query);
  const fileQuery = looksLikeFileQuery(normalizedPathQuery);
  const resolutionTokens = fileQuery ? fileQueryStemTokens(normalizedPathQuery) : tokens;
  const normalizedQuery = normalizeSearchText(query);
  const normalizedPath = (node.path ?? "").replace(/\\/g, "/").toLowerCase();
  const normalizedLabel = normalizeSearchText(node.label);
  const basename = pathBasename(node.path ?? node.label);
  let score = scoreGraphNodeForQuery(node, resolutionTokens);
  let matchReason = score > 0 ? "token overlap" : "no match";
  let hasPathMatch = false;

  if (node.id.toLowerCase() === query.trim().toLowerCase()) {
    return { score: 10_000, matchReason: "exact node id" };
  }
  if (normalizedPath === normalizedPathQuery) {
    return { score: 9_000, matchReason: "exact path" };
  }
  if (basename && basename === normalizedPathQuery) {
    score += 2_000;
    matchReason = "path basename";
    hasPathMatch = true;
  } else if (normalizedPath.endsWith(`/${normalizedPathQuery}`)) {
    score += 1_500;
    matchReason = "path suffix";
    hasPathMatch = true;
  }
  if (node.label.toLowerCase() === normalizedPathQuery) {
    score += 1_200;
    matchReason = "exact label";
    hasPathMatch = true;
  } else if (node.label.toLowerCase().startsWith(`${normalizedPathQuery} `)) {
    score += 1_000;
    matchReason = "label prefix";
    hasPathMatch = true;
  }

  if (fileQuery) {
    const pathAligned = hasPathMatch || hasFileQueryPathAlignment(normalizedPath, basename, normalizedPathQuery);
    if (node.kind === "code_file") {
      if (!pathAligned) {
        score = 0;
        matchReason = "no match";
      } else if (!hasPathMatch && score > 0) {
        matchReason = "filename token";
      }
    } else if (!pathAligned) {
      score = 0;
      matchReason = "no match";
    }
  }
  if (node.kind === "symbol") {
    if (normalizedLabel.startsWith(`${normalizedQuery} `) && node.label.includes("(class)")) {
      score += 800;
      matchReason = "class symbol";
    }
    if (/\(field\)|\(method\)|\(property\)|\.|_/i.test(node.label) && !/[._]/.test(query)) {
      score -= 250;
    }
  }
  if (node.kind === "workspace" || (node.kind === "project" && (node.label === "workspace-root" || node.path === "."))) {
    score -= 500;
  }

  return { score, matchReason };
}

export function rankGraphNodeCandidates(graph: UnifiedCodeGraph, target: string, limit = 5) {
  const tokens = tokenizeGraphQuery(target);
  return [...graph.nodes]
    .map((node) => {
      const scored = scoreGraphNodeForPathResolution(node, target, tokens);
      return { node, ...scored };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.node.label.localeCompare(right.node.label))
    .slice(0, limit);
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
  return false;
}

function scoreGraphNodePenalty(node: UnifiedCodeGraphNode, options: GraphPathOptions) {
  switch (node.kind) {
    case "workspace":
      return 1_000;
    case "project":
      return node.label === "workspace-root" || node.path === "." ? 500 : 250;
    case "package":
    case "directory":
      return 200;
    case "community":
      return 150;
    case "god_node":
      return 100;
    case "config_file":
      return 80;
    case "doc_file":
    case "asset_file":
      return 60;
    case "external_dep":
      return 40;
    case "test":
      return options.lens === "tests" ? 2 : 25;
    case "code_file":
      return 5;
    case "symbol":
      return 1;
    case "route":
    case "command":
      return 8;
    default:
      return 20;
  }
}

function scoreGraphEdgeForPath(edge: UnifiedCodeGraphEdge, options: GraphPathOptions) {
  const kindBase: Record<UnifiedCodeGraphEdge["kind"], number> = {
    tests: options.lens === "tests" ? 4 : 18,
    implements: 8,
    depends_on: 10,
    references: 12,
    inherits: 15,
    declares: 90,
    belongs_to: 100,
    documents: 55,
    related_to: 45,
    build_produces: 70,
  };
  const provenanceMultiplier: Record<UnifiedCodeGraphEdge["provenance"], number> = {
    extracted: 1,
    manual: 1,
    inferred: 1.25,
    ambiguous: 1.6,
  };
  return (kindBase[edge.kind] ?? 30) * (provenanceMultiplier[edge.provenance] ?? 1.3);
}

function buildWeightedAdjacency(graph: UnifiedCodeGraph, options: GraphPathOptions) {
  const adjacency = new Map<string, Array<{ neighborId: string; edge: UnifiedCodeGraphEdge; cost: number }>>();
  const add = (sourceId: string, targetId: string, edge: UnifiedCodeGraphEdge, cost: number) => {
    const current = adjacency.get(sourceId) ?? [];
    current.push({ neighborId: targetId, edge, cost });
    adjacency.set(sourceId, current);
  };
  for (const edge of graph.edges) {
    const cost = scoreGraphEdgeForPath(edge, options);
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
      const nodePenalty = scoreGraphNodePenalty(neighbor, options);
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
    const edgeCost = viaEdge ? scoreGraphEdgeForPath(viaEdge, options) : undefined;
    const nodePenalty = index > 0 ? scoreGraphNodePenalty(node, options) : 0;
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

export function findGraphPath(
  graph: UnifiedCodeGraph,
  fromQuery: string,
  toQuery: string,
  options: GraphPathOptions = {}
): GraphPathResult {
  const lens = options.lens ?? "all";
  const scopedGraph = lens !== "all" ? filterUnifiedGraphByLens(graph, lens) : graph;
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
      { ...options, lens }
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
      toCandidates[0]!.node
    );
    if (!primaryConnected) {
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

  if (!weighted) {
    return {
      from: fromQuery,
      to: toQuery,
      fromNode: fallbackFromNode,
      toNode: fallbackToNode,
      found: false,
      nodes: [fallbackFromNode, fallbackToNode],
      edges: [],
    };
  }

  const explanation: GraphPathExplanation | undefined = options.explainRanking
    ? {
        lens,
        seedResolution: {
          from: buildSeedResolution(fromQuery, chosenFrom),
          to: buildSeedResolution(toQuery, chosenTo),
        },
        steps: weighted.steps,
        totalCost: weighted.totalCost,
        penalizedAlternatives: [],
      }
    : undefined;

  if (explanation) {
    const hopPath = findUnweightedGraphPath(scopedGraph, fromNode, toNode, options.maxHops);
    const weightedIds = weighted.nodes.map((node) => node.id).join("|");
    const hopIds = hopPath?.map((node) => node.id).join("|");
    if (hopPath && hopIds !== weightedIds) {
      const bridgeKinds = hopPath
        .filter((node) => isLowValueBridgeNode(node))
        .map((node) => node.kind);
      explanation.penalizedAlternatives.push({
        summary: "Shorter hop-count path avoided due to low-value bridge nodes or weak edge provenance.",
        nodeLabels: hopPath.map((node) => node.label),
        bridgeKinds: [...new Set(bridgeKinds)],
      });
    }
  }

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

  const summary = [
    `${node.label} (${node.kind})`,
    node.path ? `path: ${node.path}` : undefined,
    node.scannerId ? `scanner: ${node.scannerId}` : undefined,
    `${edges.length} connected edge(s), ${neighbors.length} neighbor(s).`,
  ].filter(Boolean).join(" ");

  return { target, resolved: true, node, neighbors, edges, summary };
}