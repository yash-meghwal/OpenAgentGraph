import { describe, expect, it } from "vitest";
import { buildAgentContextPack, buildGraphFrontier } from "./agentCollaboration";
import type { GraphProjection, Node } from "./types";

function makeNode(input: Partial<Node> & Pick<Node, "id" | "title" | "status">): Node {
  return {
    id: input.id,
    graphId: "graph-1",
    kind: input.kind ?? "work",
    title: input.title,
    intent: input.intent ?? input.title,
    humanSummary: input.humanSummary ?? `${input.title} summary`,
    status: input.status,
    contract: {
      expectedArtifact: "verified change",
      allowedTools: [],
      acceptanceCriteria: ["Works as intended"],
      humanSummary: "Verify the change.",
    },
    baselineGoalVersionId: "goal-1",
    activeGoalVersionId: "goal-1",
    dependsOnNodeIds: input.dependsOnNodeIds ?? [],
    createdAt: input.createdAt ?? "2026-04-16T10:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-16T10:00:00.000Z",
  };
}

function makeProjection(overrides: Partial<GraphProjection> = {}): GraphProjection {
  return {
    graph: {
      id: "graph-1",
      title: "Graph 1",
      goal: "Coordinate agents",
      status: "running",
      originalGoalVersionId: "goal-1",
      activeGoalVersionId: "goal-1",
      createdAt: "2026-04-16T10:00:00.000Z",
      updatedAt: "2026-04-16T10:00:00.000Z",
    },
    goalPackets: [],
    nodes: [],
    edges: [],
    events: [],
    driftState: "on_track",
    driftSummary: "",
    currentDriftSummary: null,
    frontierStatus: "on_track",
    runControlState: "running",
    canResume: false,
    canPause: true,
    canStop: true,
    approvalState: "not_requested",
    waitingForApproval: false,
    needsHumanReview: false,
    graphAnnotations: [],
    annotationCount: 0,
    lineageDescriptors: [],
    lineageCount: 0,
    plannedNodeCount: 0,
    completedNodeCount: 0,
    failedNodeCount: 0,
    supersededNodeCount: 0,
    revisedNodeCount: 0,
    passRate: 0,
    revisionRate: 0,
    driftTrend: "steady",
    evidenceCoverageRate: 0,
    runHealthSummary: "No steps have finished yet.",
    alerts: [],
    ...overrides,
  };
}

describe("agent collaboration helpers", () => {
  it("builds a bounded frontier without completed lifecycle noise", () => {
    const projection = makeProjection({
      nodes: [
        makeNode({ id: "completed", title: "Completed", status: "completed" }),
        makeNode({ id: "pending", title: "Pending", status: "pending" }),
        makeNode({ id: "ready", title: "Ready", status: "ready" }),
      ],
    });

    expect(buildGraphFrontier(projection).map((node) => node.nodeId)).toEqual(["ready", "pending"]);
    expect(buildGraphFrontier(projection, { limit: 1 })).toHaveLength(1);
  });

  it("builds context packs with agent activity and inert open proposals", () => {
    const projection = makeProjection({
      nodes: [makeNode({ id: "ready", title: "Ready", status: "ready" })],
      agentActivity: [
        {
          id: "activity-1",
          graphId: "graph-1",
          kind: "evidence",
          summary: "Checked dashboard state.",
          createdAt: "2026-04-16T10:02:00.000Z",
        },
      ],
      agentPlanProposals: [
        {
          proposalId: "proposal-1",
          graphId: "graph-1",
          createdAt: "2026-04-16T10:03:00.000Z",
          agent: {
            agentId: "codex",
            displayName: "Codex",
            kind: "codex",
          },
          title: "Add tests",
          summary: "Propose a test node.",
          nodes: [{ title: "Write tests", intent: "Add focused tests" }],
        },
        {
          proposalId: "proposal-2",
          graphId: "graph-1",
          createdAt: "2026-04-16T10:04:00.000Z",
          acceptedAt: "2026-04-16T10:05:00.000Z",
          acceptedNodeIds: ["node-accepted"],
          acceptedBy: { actorId: "admin", displayName: "Admin", role: "admin" },
          agent: {
            agentId: "gemini",
            displayName: "Gemini",
            kind: "gemini",
          },
          title: "Accepted",
          summary: "Already accepted.",
          nodes: [{ title: "Accepted node", intent: "Already accepted" }],
        },
        {
          proposalId: "proposal-3",
          graphId: "graph-1",
          createdAt: "2026-04-16T10:05:30.000Z",
          dismissedAt: "2026-04-16T10:05:45.000Z",
          dismissedBy: { actorId: "operator", displayName: "Operator", role: "operator" },
          agent: {
            agentId: "grok",
            displayName: "Grok",
            kind: "grok",
          },
          title: "Dismissed",
          summary: "Already dismissed.",
          nodes: [{ title: "Dismissed node", intent: "No longer needed" }],
        },
      ],
    });

    const pack = buildAgentContextPack(projection, {
      generatedAt: "2026-04-16T10:06:00.000Z",
      nodeId: "ready",
    });

    expect(pack.generatedAt).toBe("2026-04-16T10:06:00.000Z");
    expect(pack.selectedNode?.nodeId).toBe("ready");
    expect(pack.recentAgentActivity[0].summary).toBe("Checked dashboard state.");
    expect(pack.planProposals.map((proposal) => proposal.proposalId)).toEqual(["proposal-1"]);
    expect(JSON.stringify(pack)).not.toContain("proposal-3");
    expect(JSON.stringify(pack)).not.toContain("source body");
  });
});
