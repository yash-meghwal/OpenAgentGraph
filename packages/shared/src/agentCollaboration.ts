import type {
  AgentActivityRecord,
  AgentContextPack,
  AgentPlanProposalRecord,
  GraphFrontierNodeSummary,
  GraphProjection,
  Node,
} from "./types";

const DEFAULT_FRONTIER_LIMIT = 8;
const DEFAULT_ACTIVITY_LIMIT = 8;
const DEFAULT_PROPOSAL_LIMIT = 8;

export interface BuildGraphFrontierOptions {
  limit?: number;
}

export interface BuildAgentContextPackOptions {
  nodeId?: string;
  frontierLimit?: number;
  activityLimit?: number;
  proposalLimit?: number;
  generatedAt?: string;
}

function nodeToFrontierSummary(node: Node): GraphFrontierNodeSummary {
  return {
    nodeId: node.id,
    title: node.title,
    kind: node.kind,
    status: node.status,
    humanSummary: node.humanSummary,
    dependsOnNodeIds: [...node.dependsOnNodeIds],
    evidenceCoverage: node.evidenceCoverage,
    confidenceBadge: node.confidenceBadge,
    updatedAt: node.updatedAt,
  };
}

function frontierPriority(status: Node["status"]): number {
  switch (status) {
    case "ready":
      return 0;
    case "running":
      return 1;
    case "blocked":
      return 2;
    case "failed":
      return 3;
    case "pending":
      return 4;
    case "completed":
      return 5;
    case "superseded":
      return 6;
  }
}

export function buildGraphFrontier(
  projection: GraphProjection,
  options: BuildGraphFrontierOptions = {}
): GraphFrontierNodeSummary[] {
  const limit = Math.max(0, options.limit ?? DEFAULT_FRONTIER_LIMIT);
  if (limit === 0) return [];

  return [...projection.nodes]
    .filter((node) => node.status !== "completed" && node.status !== "superseded")
    .sort((left, right) => {
      const priorityDelta = frontierPriority(left.status) - frontierPriority(right.status);
      if (priorityDelta !== 0) return priorityDelta;
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, limit)
    .map(nodeToFrontierSummary);
}

function recentActivity(projection: GraphProjection, limit: number): AgentActivityRecord[] {
  return [...(projection.agentActivity ?? [])]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, limit));
}

function openProposals(projection: GraphProjection, limit: number): AgentPlanProposalRecord[] {
  return [...(projection.agentPlanProposals ?? [])]
    .filter((proposal) => !proposal.acceptedAt && !proposal.dismissedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, limit));
}

export function buildAgentContextPack(
  projection: GraphProjection,
  options: BuildAgentContextPackOptions = {}
): AgentContextPack {
  const frontier = buildGraphFrontier(projection, { limit: options.frontierLimit });
  const selectedNode = options.nodeId
    ? projection.nodes.find((node) => node.id === options.nodeId)
    : undefined;

  return {
    graphId: projection.graph.id,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    graph: {
      id: projection.graph.id,
      title: projection.graph.title,
      goal: projection.graph.goal,
      status: projection.graph.status,
      activeGoalVersionId: projection.graph.activeGoalVersionId,
    },
    run: {
      runControlState: projection.runControlState,
      frontierStatus: projection.frontierStatus,
      plannedNodeCount: projection.plannedNodeCount,
      completedNodeCount: projection.completedNodeCount,
      failedNodeCount: projection.failedNodeCount,
      runHealthSummary: projection.runHealthSummary,
    },
    selectedNode: selectedNode ? nodeToFrontierSummary(selectedNode) : undefined,
    frontier,
    recentAgentActivity: recentActivity(projection, options.activityLimit ?? DEFAULT_ACTIVITY_LIMIT),
    planProposals: openProposals(projection, options.proposalLimit ?? DEFAULT_PROPOSAL_LIMIT),
    instructions: [
      "Read GRAPH_REPORT.md first when it exists, then use this context pack for live run state.",
      "Use frontier nodes for orientation; do not treat external agent progress as runner completion.",
      "Submit bounded progress, evidence, or plan proposals instead of writing source bodies into OAG.",
      "Verify source files directly before editing.",
    ],
  };
}
