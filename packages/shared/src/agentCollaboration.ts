import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import {
  buildAgentCodeContextSlice,
  evaluateOagFusionChecks,
  type GraphHandoffFreshnessResult,
} from "./graphFusion.js";
import type {
  ActorIdentity,
  AgentActivityRecord,
  AgentContextPack,
  AgentPlanProposalRecord,
  AgentPlanProposalNode,
  GraphFrontierNodeSummary,
  GraphProjection,
  NodeEvidenceMetadataValue,
  Node,
  OpenAgentGraphAgentIdentity,
} from "./types";
import type { ProductGraphProjection } from "./productGraph.js";
import { sanitizeOperationalText } from "./safeText";

const DEFAULT_FRONTIER_LIMIT = 8;
const DEFAULT_ACTIVITY_LIMIT = 8;
const DEFAULT_PROPOSAL_LIMIT = 8;

export interface BuildGraphFrontierOptions {
  limit?: number;
  workspaceRoot?: string;
}

export interface BuildAgentContextPackOptions {
  nodeId?: string;
  frontierLimit?: number;
  activityLimit?: number;
  proposalLimit?: number;
  generatedAt?: string;
  workspaceRoot?: string;
  codeGraph?: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  handoffFreshness?: GraphHandoffFreshnessResult;
  productGraph?: ProductGraphProjection;
  previousSymbolCount?: number;
}

export interface AgentSchedulingSummary {
  claimableReadyCount: number;
  inProgressCount: number;
  blockedActionCount: number;
  deferredReadyCount: number;
}

function safeText(value: string, workspaceRoot?: string, maxLength = 500): string {
  return sanitizeOperationalText(value, { workspaceRoot, maxLength });
}

function safeOptionalText(value: string | undefined, workspaceRoot?: string, maxLength = 500): string | undefined {
  if (value === undefined) return undefined;
  return safeText(value, workspaceRoot, maxLength);
}

function sanitizeActor(actor: ActorIdentity | undefined, workspaceRoot?: string): ActorIdentity | undefined {
  if (!actor) return undefined;
  return {
    ...actor,
    actorId: safeText(actor.actorId, workspaceRoot, 160),
    displayName: safeText(actor.displayName, workspaceRoot, 160),
  };
}

function sanitizeAgent(
  agent: OpenAgentGraphAgentIdentity | undefined,
  workspaceRoot?: string
): OpenAgentGraphAgentIdentity | undefined {
  if (!agent) return undefined;
  return {
    ...agent,
    agentId: safeText(agent.agentId, workspaceRoot, 160),
    displayName: safeText(agent.displayName, workspaceRoot, 160),
    model: safeOptionalText(agent.model, workspaceRoot, 160),
    version: safeOptionalText(agent.version, workspaceRoot, 160),
    capabilities: agent.capabilities?.map((capability) => safeText(capability, workspaceRoot, 120)),
    sessionId: safeOptionalText(agent.sessionId, workspaceRoot, 160),
  };
}

function sanitizeMetadata(
  metadata: Record<string, NodeEvidenceMetadataValue> | undefined,
  workspaceRoot?: string
): Record<string, NodeEvidenceMetadataValue> | undefined {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      safeText(key, workspaceRoot, 160),
      typeof value === "string" ? safeText(value, workspaceRoot, 500) : value,
    ])
  );
}

function sanitizeProposalNode(
  node: AgentPlanProposalNode,
  workspaceRoot?: string
): AgentPlanProposalNode {
  return {
    ...node,
    title: safeText(node.title, workspaceRoot, 240),
    intent: safeText(node.intent, workspaceRoot, 1000),
    humanSummary: safeOptionalText(node.humanSummary, workspaceRoot, 500),
    acceptanceCriteria: node.acceptanceCriteria?.map((criterion) => safeText(criterion, workspaceRoot, 500)),
  };
}

function schedulingForNode(status: Node["status"]): Pick<GraphFrontierNodeSummary, "schedulingState" | "agentAction"> {
  switch (status) {
    case "ready":
      return { schedulingState: "claimable", agentAction: "start" };
    case "running":
      return { schedulingState: "in_progress", agentAction: "observe" };
    case "blocked":
    case "failed":
      return { schedulingState: "blocked", agentAction: "unblock" };
    case "pending":
      return { schedulingState: "waiting", agentAction: "wait" };
    case "completed":
    case "superseded":
      return { schedulingState: "not_actionable", agentAction: "none" };
  }
}

export function buildAgentSchedulingSummary(projection: GraphProjection): AgentSchedulingSummary {
  return {
    claimableReadyCount: projection.nodes.filter((node) => node.status === "ready").length,
    inProgressCount: projection.nodes.filter((node) => node.status === "running").length,
    blockedActionCount: projection.nodes.filter((node) => node.status === "blocked" || node.status === "failed").length,
    deferredReadyCount: projection.nodes.filter((node) => node.status === "pending").length,
  };
}

function nodeToFrontierSummary(node: Node, workspaceRoot?: string): GraphFrontierNodeSummary {
  return {
    nodeId: node.id,
    title: safeText(node.title, workspaceRoot, 240),
    kind: node.kind,
    status: node.status,
    ...schedulingForNode(node.status),
    humanSummary: safeText(node.humanSummary, workspaceRoot, 500),
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
    .map((node) => nodeToFrontierSummary(node, options.workspaceRoot));
}

function recentActivity(projection: GraphProjection, limit: number, workspaceRoot?: string): AgentActivityRecord[] {
  return [...(projection.agentActivity ?? [])]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, limit))
    .map((activity) => ({
      ...activity,
      summary: safeText(activity.summary, workspaceRoot, 500),
      agent: sanitizeAgent(activity.agent, workspaceRoot),
      actor: sanitizeActor(activity.actor, workspaceRoot),
    }));
}

function openProposals(projection: GraphProjection, limit: number, workspaceRoot?: string): AgentPlanProposalRecord[] {
  return [...(projection.agentPlanProposals ?? [])]
    .filter((proposal) => !proposal.acceptedAt && !proposal.dismissedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, limit))
    .map((proposal) => ({
      ...proposal,
      agent: sanitizeAgent(proposal.agent, workspaceRoot) ?? proposal.agent,
      actor: sanitizeActor(proposal.actor, workspaceRoot),
      acceptedBy: sanitizeActor(proposal.acceptedBy, workspaceRoot),
      dismissedBy: sanitizeActor(proposal.dismissedBy, workspaceRoot),
      title: safeText(proposal.title, workspaceRoot, 240),
      summary: safeText(proposal.summary, workspaceRoot, 1000),
      reason: safeOptionalText(proposal.reason, workspaceRoot, 1000),
      dismissalReason: safeOptionalText(proposal.dismissalReason, workspaceRoot, 500),
      metadata: sanitizeMetadata(proposal.metadata, workspaceRoot),
      nodes: proposal.nodes.map((node) => sanitizeProposalNode(node, workspaceRoot)),
    }));
}

function collectLinkedRunPaths(projection: GraphProjection, selectedNode?: Node) {
  const paths = new Set<string>();
  const addPath = (value: string | undefined) => {
    if (!value) return;
    const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (normalized) paths.add(normalized);
  };

  const nodesToInspect = selectedNode
    ? [selectedNode]
    : projection.nodes.filter((node) => node.status === "running" || node.status === "ready");

  for (const node of nodesToInspect) {
    for (const diff of node.evidence?.fileDiffs ?? []) {
      addPath(diff.path);
    }
    for (const [key, value] of Object.entries(node.evidence?.metadata ?? {})) {
      if (/path|file/i.test(key) && typeof value === "string") addPath(value);
    }
  }

  return [...paths];
}

export function buildAgentContextPack(
  projection: GraphProjection,
  options: BuildAgentContextPackOptions = {}
): AgentContextPack {
  const scheduling = buildAgentSchedulingSummary(projection);
  const frontier = buildGraphFrontier(projection, {
    limit: options.frontierLimit,
    workspaceRoot: options.workspaceRoot,
  });
  const selectedNode = options.nodeId
    ? projection.nodes.find((node) => node.id === options.nodeId)
    : undefined;
  const focusQuery = [
    selectedNode?.title,
    selectedNode?.humanSummary,
    selectedNode?.intent,
    projection.graph.goal,
  ].filter(Boolean).join(" ");
  const fusion = options.codeGraph
    ? evaluateOagFusionChecks({
        graph: options.codeGraph,
        kernelProfile: options.kernelProfile,
        handoffFreshness: options.handoffFreshness,
        productGraph: options.productGraph,
        previousSymbolCount: options.previousSymbolCount,
      })
    : undefined;
  const codeContext = options.codeGraph
    ? buildAgentCodeContextSlice(options.codeGraph, {
        focusQuery,
        linkedRunPaths: collectLinkedRunPaths(projection, selectedNode),
        kernelProfile: options.kernelProfile,
        workspaceRoot: options.workspaceRoot,
      })
    : undefined;

  return {
    graphId: projection.graph.id,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    graph: {
      id: projection.graph.id,
      title: safeText(projection.graph.title, options.workspaceRoot, 240),
      goal: safeText(projection.graph.goal, options.workspaceRoot, 1000),
      status: projection.graph.status,
      activeGoalVersionId: projection.graph.activeGoalVersionId,
    },
    run: {
      runControlState: projection.runControlState,
      frontierStatus: projection.frontierStatus,
      plannedNodeCount: projection.plannedNodeCount,
      completedNodeCount: projection.completedNodeCount,
      failedNodeCount: projection.failedNodeCount,
      ...scheduling,
      runHealthSummary: safeText(projection.runHealthSummary, options.workspaceRoot, 500),
    },
    selectedNode: selectedNode ? nodeToFrontierSummary(selectedNode, options.workspaceRoot) : undefined,
    frontier,
    recentAgentActivity: recentActivity(projection, options.activityLimit ?? DEFAULT_ACTIVITY_LIMIT, options.workspaceRoot),
    planProposals: openProposals(projection, options.proposalLimit ?? DEFAULT_PROPOSAL_LIMIT, options.workspaceRoot),
    ...(codeContext ? { codeContext } : {}),
    ...(fusion ? { fusionChecks: fusion.checks } : {}),
    instructions: [
      "Read GRAPH_REPORT.md first when it exists, then use this context pack for live run state.",
      "Use frontier nodes for orientation; do not treat external agent progress as runner completion.",
      "Use codeContext for bounded code neighborhoods; verify source files directly before editing.",
      "Submit bounded progress, evidence, or plan proposals instead of writing source bodies into OAG.",
      ...(fusion?.checks.some((check) => check.code === "stale_handoff")
        ? ["Refresh GRAPH_REPORT.md or rerun graph export because the handoff is stale relative to the code graph."]
        : []),
    ],
  };
}
