import type { UnifiedCodeGraph, UnifiedCodeGraphNode } from "./codeGraph.js";
import { buildGraphAdjacency } from "./graphQueryEngine.js";
import { sanitizeOperationalText } from "./safeText.js";
import type { GraphExternalBenchmarkCategoryId } from "./graphExternalBenchmark.js";

export type OagRetrievalKind = "node" | "community" | "doc" | "path" | "benchmark";

const OAG_RETRIEVAL_PREFIX = "oag:";

export function encodeOagRetrievalId(kind: OagRetrievalKind, ...parts: string[]): string {
  return `${OAG_RETRIEVAL_PREFIX}${kind}:${parts.join(":")}`;
}

export function parseOagRetrievalId(id: string): { kind: OagRetrievalKind; parts: string[] } | null {
  if (!id.startsWith(OAG_RETRIEVAL_PREFIX)) return null;
  const body = id.slice(OAG_RETRIEVAL_PREFIX.length);
  const colonIndex = body.indexOf(":");
  if (colonIndex < 0) return null;
  const kind = body.slice(0, colonIndex) as OagRetrievalKind;
  if (!["node", "community", "doc", "path", "benchmark"].includes(kind)) return null;
  const remainder = body.slice(colonIndex + 1);
  if (!remainder) return null;
  if (kind === "path") {
    const splitIndex = remainder.indexOf(":");
    if (splitIndex < 0) return { kind, parts: [remainder] };
    return {
      kind,
      parts: [remainder.slice(0, splitIndex), remainder.slice(splitIndex + 1)],
    };
  }
  return { kind, parts: [remainder] };
}

export interface OagRetrievalResult {
  id: string;
  kind: OagRetrievalKind;
  label: string;
  summary: string;
  metadata: Record<string, string | number | boolean>;
  neighbors: Array<{ id: string; label: string; kind: string; path?: string; edgeKind?: string }>;
  hints: string[];
  retrievalIds: string[];
}

function safeText(value: string, workspaceRoot?: string, maxLength = 500): string {
  return sanitizeOperationalText(value, { workspaceRoot, maxLength });
}

function summarizeNodeForRetrieval(
  node: UnifiedCodeGraphNode,
  workspaceRoot?: string
): { id: string; label: string; kind: string; path?: string } {
  return {
    id: node.id,
    label: safeText(node.label, workspaceRoot, 240),
    kind: node.kind,
    path: node.path ? safeText(node.path, workspaceRoot, 500) : undefined,
  };
}

function retrieveNode(
  graph: UnifiedCodeGraph,
  nodeId: string,
  workspaceRoot?: string,
  neighborBudget = 8
): OagRetrievalResult | null {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;

  const adjacency = buildGraphAdjacency(graph);
  const neighborIds = [...(adjacency.get(node.id) ?? [])].slice(0, neighborBudget);
  const nodeById = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const neighbors = neighborIds
    .map((neighborId) => {
      const neighbor = nodeById.get(neighborId);
      if (!neighbor) return null;
      const edge = graph.edges.find(
        (candidate) =>
          (candidate.sourceNodeId === node.id && candidate.targetNodeId === neighborId)
          || (candidate.targetNodeId === node.id && candidate.sourceNodeId === neighborId)
      );
      return {
        ...summarizeNodeForRetrieval(neighbor, workspaceRoot),
        edgeKind: edge?.kind,
      };
    })
    .filter(Boolean) as OagRetrievalResult["neighbors"];

  const retrievalIds = neighbors.map((neighbor) => encodeOagRetrievalId("node", neighbor.id));

  return {
    id: encodeOagRetrievalId("node", node.id),
    kind: "node",
    label: safeText(node.label, workspaceRoot, 240),
    summary: [
      `kind=${node.kind}`,
      node.path ? `path=${safeText(node.path, workspaceRoot, 500)}` : undefined,
      node.metadata?.scannerSymbolKind ? `symbolKind=${node.metadata.scannerSymbolKind}` : undefined,
    ]
      .filter(Boolean)
      .join("; "),
    metadata: {
      nodeKind: node.kind,
      neighborCount: neighbors.length,
    },
    neighbors,
    hints: [
      "Retrieval returns graph metadata only — open source files directly for implementation detail.",
      neighbors.length >= neighborBudget ? "Neighbor list truncated; use graph:path for longer routes." : "",
    ].filter(Boolean),
    retrievalIds,
  };
}

function retrieveCommunity(
  graph: UnifiedCodeGraph,
  communityId: string,
  workspaceRoot?: string
): OagRetrievalResult | null {
  const community = graph.nodes.find(
    (candidate) => candidate.id === communityId && candidate.kind === "community"
  );
  if (!community) return null;

  const members = graph.nodes
    .filter((node) => {
      const edge = graph.edges.find(
        (candidate) =>
          candidate.kind === "belongs_to"
          && candidate.targetNodeId === community.id
          && candidate.sourceNodeId === node.id
      );
      return Boolean(edge);
    })
    .slice(0, 12);

  const retrievalIds = members.map((member) => encodeOagRetrievalId("node", member.id));

  return {
    id: encodeOagRetrievalId("community", community.id),
    kind: "community",
    label: safeText(community.label, workspaceRoot, 240),
    summary: safeText(String(community.metadata?.scannerCommunitySummary ?? community.label), workspaceRoot, 500),
    metadata: { memberCount: members.length },
    neighbors: members.map((member) => summarizeNodeForRetrieval(member, workspaceRoot)),
    hints: ["Communities group related files and symbols — prefer read-first nodes before broad scanning."],
    retrievalIds,
  };
}

function retrieveDoc(
  graph: UnifiedCodeGraph,
  docId: string,
  workspaceRoot?: string
): OagRetrievalResult | null {
  const docNode = graph.nodes.find(
    (candidate) =>
      candidate.id === docId
      && (candidate.kind === "doc_file" || candidate.kind === "doc_section")
  );
  if (!docNode) return null;

  const linked = graph.edges
    .filter((edge) => edge.sourceNodeId === docNode.id || edge.targetNodeId === docNode.id)
    .slice(0, 8);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbors = linked
    .map((edge) => {
      const otherId = edge.sourceNodeId === docNode.id ? edge.targetNodeId : edge.sourceNodeId;
      const other = nodeById.get(otherId);
      if (!other) return null;
      return { ...summarizeNodeForRetrieval(other, workspaceRoot), edgeKind: edge.kind };
    })
    .filter(Boolean) as OagRetrievalResult["neighbors"];

  return {
    id: encodeOagRetrievalId("doc", docNode.id),
    kind: "doc",
    label: safeText(docNode.label, workspaceRoot, 240),
    summary: docNode.path ? safeText(docNode.path, workspaceRoot, 500) : docNode.kind,
    metadata: { docKind: docNode.kind },
    neighbors,
    hints: ["Doc retrieval links to code nodes — inspect source files for full text."],
    retrievalIds: neighbors.map((neighbor) => encodeOagRetrievalId("node", neighbor.id)),
  };
}

function retrieveBenchmark(categoryId: GraphExternalBenchmarkCategoryId): OagRetrievalResult {
  return {
    id: encodeOagRetrievalId("benchmark", categoryId),
    kind: "benchmark",
    label: categoryId,
    summary: `External benchmark category ${categoryId}. Run graph:scorecard to reproduce public metrics.`,
    metadata: { categoryId },
    neighbors: [],
    hints: [
      "Use npm run graph:benchmark:external -- --catalog --report for full category scorecards.",
      "Benchmark retrieval never includes source bodies or private repo paths.",
    ],
    retrievalIds: [],
  };
}

export function retrieveOagById(
  graph: UnifiedCodeGraph,
  retrievalId: string,
  options: { workspaceRoot?: string; neighborBudget?: number } = {}
): OagRetrievalResult | null {
  const parsed = parseOagRetrievalId(retrievalId);
  if (!parsed) return null;

  switch (parsed.kind) {
    case "node":
      return retrieveNode(graph, parsed.parts[0]!, options.workspaceRoot, options.neighborBudget);
    case "community":
      return retrieveCommunity(graph, parsed.parts[0]!, options.workspaceRoot);
    case "doc":
      return retrieveDoc(graph, parsed.parts[0]!, options.workspaceRoot);
    case "path":
      return {
        id: retrievalId,
        kind: "path",
        label: `${parsed.parts[0]} → ${parsed.parts[1] ?? "?"}`,
        summary: "Path explanation retrieval — run graph:path for full ranked route.",
        metadata: { from: parsed.parts[0] ?? "", to: parsed.parts[1] ?? "" },
        neighbors: [],
        hints: [
          `npm run graph:path -- --workspace "<path>" "${parsed.parts[0]}" "${parsed.parts[1]}"`,
        ],
        retrievalIds: parsed.parts.map((part) => encodeOagRetrievalId("node", part)),
      };
    case "benchmark":
      return retrieveBenchmark(parsed.parts.join(":") as GraphExternalBenchmarkCategoryId);
    default:
      return null;
  }
}

export function attachRetrievalIdsToNodes<T extends { id: string }>(items: T[]): Array<T & { retrievalId: string }> {
  return items.map((item) => ({
    ...item,
    retrievalId: encodeOagRetrievalId("node", item.id),
  }));
}