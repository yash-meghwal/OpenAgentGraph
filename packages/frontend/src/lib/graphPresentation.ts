import type { Edge, Node } from "@openagentgraph/shared";

const SYNTHETIC_TS = new Date(0).toISOString();

export interface GraphPresentationOptions {
  selectedNodeId: string | null;
  activeNodeId: string | null;
  showSupersededNodes: boolean;
  showRevisionBranches: boolean;
  showReplanBranches: boolean;
  collapseSupersededBranches: boolean;
  collapseRevisionClusters: boolean;
  showActiveNeighborhoodOnly: boolean;
}

export interface PresentedNode extends Node {
  synthetic?: boolean;
  hiddenCount?: number;
}

export interface PresentedGraph {
  nodes: PresentedNode[];
  edges: Edge[];
}

function averageCoordinate(nodes: Node[]) {
  const count = Math.max(nodes.length, 1);
  const depth = nodes.reduce((sum, node) => sum + (node.coordinates?.depth ?? 0), 0) / count;
  const branch = nodes.reduce((sum, node) => sum + (node.coordinates?.branch ?? 0), 0) / count;
  const abstractionLevel =
    nodes.reduce((sum, node) => sum + (node.coordinates?.abstractionLevel ?? 0), 0) / count;
  const driftDistance = nodes.reduce((sum, node) => sum + (node.coordinates?.driftDistance ?? 0), 0) / count;
  const baselineDriftDistance =
    nodes.reduce((sum, node) => sum + (node.coordinates?.baselineDriftDistance ?? 0), 0) / count;

  return { depth, branch, abstractionLevel, driftDistance, baselineDriftDistance };
}

function buildPlaceholderNode(id: string, title: string, hiddenNodes: Node[], status: Node["status"]): PresentedNode {
  const anchor = hiddenNodes[0];
  const coordinates = averageCoordinate(hiddenNodes);
  return {
    ...(anchor ?? {
      id,
      graphId: "",
      kind: "work",
      title,
      intent: title,
      humanSummary: title,
      status,
      contract: {
        expectedArtifact: title,
        allowedTools: [],
        acceptanceCriteria: [],
        humanSummary: title,
      },
      baselineGoalVersionId: "",
      activeGoalVersionId: "",
      dependsOnNodeIds: [],
      createdAt: SYNTHETIC_TS,
      updatedAt: SYNTHETIC_TS,
    }),
    id,
    title,
    intent: title,
    humanSummary: `${hiddenNodes.length} nodes hidden in this cluster.`,
    semanticSummary: `${hiddenNodes.length} nodes hidden in this cluster.`,
    status,
    coordinates,
    synthetic: true,
    hiddenCount: hiddenNodes.length,
  };
}

function collectNeighborhood(nodeId: string, edges: Edge[]): Set<string> {
  const visible = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.sourceNodeId === current && !visible.has(edge.targetNodeId)) {
        visible.add(edge.targetNodeId);
        queue.push(edge.targetNodeId);
      }
      if (edge.targetNodeId === current && !visible.has(edge.sourceNodeId)) {
        visible.add(edge.sourceNodeId);
        queue.push(edge.sourceNodeId);
      }
    }
  }
  return visible;
}

export function buildPresentedGraph(
  nodes: Node[],
  edges: Edge[],
  options: GraphPresentationOptions
): PresentedGraph {
  const noFiltering =
    options.showSupersededNodes &&
    options.showRevisionBranches &&
    options.showReplanBranches &&
    !options.collapseSupersededBranches &&
    !options.collapseRevisionClusters &&
    !options.showActiveNeighborhoodOnly;

  if (noFiltering) {
    return {
      nodes,
      edges,
    };
  }

  const keepAlways = new Set<string>([options.selectedNodeId, options.activeNodeId].filter(Boolean) as string[]);

  let visibleNodes = nodes.filter((node) => {
    if (keepAlways.has(node.id)) return true;
    if (!options.showSupersededNodes && node.status === "superseded") return false;
    if (!options.showRevisionBranches && node.kind === "revision") return false;
    if (!options.showReplanBranches && node.branchId) return false;
    return true;
  });

  if (options.showActiveNeighborhoodOnly && options.activeNodeId) {
    const neighborhood = collectNeighborhood(options.activeNodeId, edges);
    visibleNodes = visibleNodes.filter((node) => neighborhood.has(node.id) || keepAlways.has(node.id));
  }

  const hiddenNodes = new Map<string, Node[]>();
  const filteredNodes: PresentedNode[] = [];

  for (const node of visibleNodes) {
    const collapseSuperseded =
      options.collapseSupersededBranches && node.status === "superseded" && !keepAlways.has(node.id);
    const collapseRevision =
      options.collapseRevisionClusters && node.kind === "revision" && !keepAlways.has(node.id);

    if (collapseSuperseded) {
      const key = `superseded:${node.branchId ?? "main"}`;
      hiddenNodes.set(key, [...(hiddenNodes.get(key) ?? []), node]);
      continue;
    }
    if (collapseRevision) {
      const key = `revision:${node.parentNodeId ?? node.id}`;
      hiddenNodes.set(key, [...(hiddenNodes.get(key) ?? []), node]);
      continue;
    }

    filteredNodes.push(node);
  }

  for (const [key, group] of hiddenNodes.entries()) {
    const status = key.startsWith("superseded") ? "superseded" : "ready";
    const title = key.startsWith("superseded")
      ? `${group.length} superseded nodes hidden`
      : `${group.length} revision nodes hidden`;
    filteredNodes.push(buildPlaceholderNode(`placeholder:${key}`, title, group, status));
  }

  const visibleIds = new Set(filteredNodes.map((node) => node.id));
  const presentedEdges = edges.filter(
    (edge) =>
      (visibleIds.has(edge.sourceNodeId) && visibleIds.has(edge.targetNodeId)) ||
      keepAlways.has(edge.sourceNodeId) ||
      keepAlways.has(edge.targetNodeId)
  );

  return {
    nodes: filteredNodes,
    edges: presentedEdges,
  };
}
