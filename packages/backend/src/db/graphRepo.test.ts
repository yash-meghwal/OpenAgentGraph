import { describe, expect, it, vi } from "vitest";
import { buildGraphRunReport, buildRunComparison } from "@openagentgraph/shared";
import type { GoalPacket, GraphEvent, NodeEvaluation, NodePlannedPayload } from "@openagentgraph/shared";

vi.mock("./client.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("./schema.js", () => ({
  graphEvents: {},
}));

import {
  buildChangesSinceLastViewed,
  buildComparisonSide,
  buildDashboardOverviewFromProjections,
  buildDashboardRunSummary,
  buildReplayFrame,
  buildSimilarRuns,
  findRelevantNodeOutputsInProjection,
  replayProjection,
} from "./graphRepo.js";

function makeGoalPacket(id: string, text: string): GoalPacket {
  return {
    id,
    version: 1,
    originalText: text,
    successCriteria: ["Ship the requested work"],
    forbiddenScope: [],
    embedding: [1, 0],
    criteriaEmbeddings: [[1, 0]],
    createdAt: new Date().toISOString(),
  };
}

function makeNodeEvents(input: {
  graphId: string;
  nodeId: string;
  title: string;
  tsBase: string;
  summary: string;
  embedding: number[];
  evaluation?: Partial<NodeEvaluation>;
  superseded?: boolean;
}): GraphEvent[] {
  const graphId = input.graphId;
  const planned: GraphEvent<"node.planned"> = {
    id: `${input.nodeId}-planned`,
    graphId,
    kind: "node.planned",
    nodeId: input.nodeId,
    payload: {
      kind: "work",
      title: input.title,
      intent: `Complete ${input.title}`,
      humanSummary: `${input.title} human summary`,
      contract: {
        expectedArtifact: `${input.title} artifact`,
        allowedTools: ["listDirectory"],
        acceptanceCriteria: ["Artifact exists"],
        humanSummary: `${input.title} contract`,
      },
      baselineGoalVersionId: "goal-1",
      activeGoalVersionId: "goal-1",
      dependsOnNodeIds: [],
    } satisfies NodePlannedPayload,
    ts: `${input.tsBase}.000Z`,
  };

  const completed: GraphEvent<"node.completed"> = {
    id: `${input.nodeId}-completed`,
    graphId,
    kind: "node.completed",
    nodeId: input.nodeId,
    payload: {
      output: `${input.title} output`,
      evidence: {
        fileDiffs: [],
        commandResults: [],
        toolCallLog: [
          {
            id: `${input.nodeId}-tool`,
            nodeId: input.nodeId,
            tool: "listDirectory",
            input: { path: "." },
            output: "src",
            startedAt: `${input.tsBase}.100Z`,
            completedAt: `${input.tsBase}.200Z`,
          },
        ],
        workspaceChecksum: `${input.nodeId}-checksum`,
        workspaceChecksumBefore: `${input.nodeId}-before`,
        workspaceChecksumAfter: `${input.nodeId}-after`,
      },
    },
    ts: `${input.tsBase}.300Z`,
  };

  const summarized: GraphEvent<"node.summarized"> = {
    id: `${input.nodeId}-summarized`,
    graphId,
    kind: "node.summarized",
    nodeId: input.nodeId,
    payload: {
      summary: input.summary,
      embedding: input.embedding,
      summaryGeneratedAt: `${input.tsBase}.350Z`,
    },
    ts: `${input.tsBase}.350Z`,
  };

  const events: GraphEvent[] = [planned, completed, summarized];

  if (input.evaluation) {
    events.push({
      id: `${input.nodeId}-evaluated`,
      graphId,
      kind: "node.evaluated",
      nodeId: input.nodeId,
      payload: {
        evaluation: {
          llmPassed: true,
          deterministicPassed: true,
          passed: true,
          driftScore: 0.71,
          baselineDriftScore: 0.71,
          direction: "holding",
          humanSummary: "",
          suggestedAction: "complete",
          findings: [],
          ruleViolations: [],
          ...input.evaluation,
        },
      },
      ts: `${input.tsBase}.400Z`,
    });
  }

  if (input.superseded) {
    events.push({
      id: `${input.nodeId}-superseded`,
      graphId,
      kind: "node.superseded",
      nodeId: input.nodeId,
      payload: {
        branchId: "replan-1",
        supersededByNodeId: "replacement-node",
        reason: "Replanned away from this node",
      },
      ts: `${input.tsBase}.500Z`,
    });
  }

  return events;
}

function makeProjection(events: GraphEvent[]) {
  const graphId = events[0]?.graphId ?? "graph-1";
  const projection = replayProjection(
    graphId,
    events.map((event, index) => ({ ...event, seq: event.seq ?? index + 1 }))
  );
  if (!projection) {
    throw new Error("Projection was not created");
  }
  return projection;
}

describe("graphRepo semantic retrieval", () => {
  it("ignores a pause request while idle without corrupting projection state", () => {
    const projection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Idle pause graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "pause-request",
        graphId: "graph-1",
        kind: "run.pause_requested",
        payload: {
          reason: "Pause while idle",
        },
        ts: "2026-04-16T10:00:10.000Z",
      },
    ]);

    expect(projection.graph.status).toBe("idle");
    expect(projection.runControlState).toBe("idle");
    expect(projection.nodes).toHaveLength(0);
  });

  it("projects external agent collaboration without mutating node lifecycle", () => {
    const projection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "External coordination graph",
          goal: "Coordinate external agents",
          goalPacket: makeGoalPacket("goal-1", "Coordinate external agents"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "node-planned",
        graphId: "graph-1",
        kind: "node.planned",
        nodeId: "node-1",
        payload: {
          kind: "work",
          title: "Implement context pack",
          intent: "Add external-agent context APIs.",
          humanSummary: "Implement context APIs.",
          contract: {
            expectedArtifact: "Agent context API",
            allowedTools: [],
            acceptanceCriteria: ["Context pack is available."],
            humanSummary: "Verify context API.",
          },
          baselineGoalVersionId: "goal-1",
          activeGoalVersionId: "goal-1",
          dependsOnNodeIds: [],
        },
        ts: "2026-04-16T10:01:00.000Z",
      },
      {
        id: "node-ready",
        graphId: "graph-1",
        kind: "node.ready",
        nodeId: "node-1",
        payload: {
          readyReason: "No dependencies.",
        },
        ts: "2026-04-16T10:02:00.000Z",
      },
      {
        id: "agent-progress",
        graphId: "graph-1",
        kind: "agent.progress_reported",
        nodeId: "node-1",
        payload: {
          progressId: "progress-1",
          graphId: "graph-1",
          agent: { agentId: "codex", displayName: "Codex", kind: "codex" },
          nodeId: "node-1",
          status: "completed",
          summary: "External agent finished a review.",
          createdAt: "2026-04-16T10:03:00.000Z",
        },
        ts: "2026-04-16T10:03:00.000Z",
      },
      {
        id: "proposal-open",
        graphId: "graph-1",
        kind: "agent.plan_proposed",
        payload: {
          proposalId: "proposal-open",
          graphId: "graph-1",
          agent: { agentId: "gemini", displayName: "Gemini", kind: "gemini" },
          title: "Add follow-up tests",
          summary: "A proposed follow-up.",
          nodes: [{ title: "Write tests", intent: "Add focused coordination tests." }],
          createdAt: "2026-04-16T10:04:00.000Z",
        },
        ts: "2026-04-16T10:04:00.000Z",
      },
      {
        id: "proposal-dismissed",
        graphId: "graph-1",
        kind: "agent.plan_proposed",
        payload: {
          proposalId: "proposal-dismissed",
          graphId: "graph-1",
          agent: { agentId: "grok", displayName: "Grok", kind: "grok" },
          title: "Dismissed follow-up",
          summary: "A dismissed follow-up.",
          nodes: [{ title: "Skip work", intent: "No longer needed." }],
          createdAt: "2026-04-16T10:05:00.000Z",
        },
        ts: "2026-04-16T10:05:00.000Z",
      },
      {
        id: "proposal-dismiss-event",
        graphId: "graph-1",
        kind: "agent.plan_dismissed",
        payload: {
          proposalId: "proposal-dismissed",
          graphId: "graph-1",
          dismissedAt: "2026-04-16T10:06:00.000Z",
          dismissedBy: { actorId: "operator", displayName: "Operator", role: "operator" },
          reason: "Out of scope.",
        },
        ts: "2026-04-16T10:06:00.000Z",
      },
    ] satisfies GraphEvent[]);

    expect(projection.nodes.find((node) => node.id === "node-1")?.status).toBe("ready");
    expect(projection.agentActivity?.map((activity) => activity.kind)).toContain("plan_dismissed");
    expect(projection.agentPlanProposals?.find((proposal) => proposal.proposalId === "proposal-open")?.acceptedAt).toBeUndefined();
    expect(projection.agentPlanProposals?.find((proposal) => proposal.proposalId === "proposal-dismissed")?.dismissedAt).toBe(
      "2026-04-16T10:06:00.000Z"
    );
  });

  it("returns the most relevant completed node summaries", () => {
    const projection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Semantic retrieval graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-dashboard",
        title: "Dashboard work",
        tsBase: "2026-04-16T10:01:00",
        summary: "Implemented the dashboard flow so the requested UI can load and render.",
        embedding: [1, 0],
      }),
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-auth",
        title: "Auth cleanup",
        tsBase: "2026-04-16T10:02:00",
        summary: "Refactored authentication helpers to simplify unrelated login code.",
        embedding: [0, 1],
      }),
    ]);

    const results = findRelevantNodeOutputsInProjection(projection, [0.98, 0.02], 1);

    expect(results).toHaveLength(1);
    expect(results[0]?.nodeId).toBe("node-dashboard");
    expect(results[0]?.summary).toContain("dashboard flow");
  });

  it("excludes superseded nodes from retrieval by default even when they are the closest match", () => {
    const projection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Superseded retrieval graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-closest",
        title: "Old dashboard attempt",
        tsBase: "2026-04-16T10:01:00",
        summary: "Built an early dashboard attempt that is closest to the requested work.",
        embedding: [1, 0],
        superseded: true,
      }),
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-live",
        title: "Replacement dashboard",
        tsBase: "2026-04-16T10:02:00",
        summary: "Built the active dashboard path that is slightly less similar but still relevant.",
        embedding: [0.9, 0.1],
      }),
    ]);

    const results = findRelevantNodeOutputsInProjection(projection, [1, 0], 2);

    expect(results.map((result) => result.nodeId)).toEqual(["node-live"]);
  });
});

describe("graphRepo drift projection", () => {
  it("uses the exact fallback drift summary format when no natural-language summary is available", () => {
    const projection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Fallback drift graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-1",
        title: "Inspect workspace",
        tsBase: "2026-04-16T10:01:00",
        summary: "Inspected the workspace so the next step can target the dashboard files.",
        embedding: [1, 0],
        evaluation: {
          driftScore: 0.71,
          direction: "holding",
          humanSummary: "",
        },
      }),
    ]);

    expect(projection.frontierStatus).toBe("exploring");
    expect(projection.currentDriftSummary).toBe(
      "1 of 1 nodes completed. Most recent node was 'Inspect workspace' — drift score 0.71, direction holding."
    );
  });

  it("keeps the latest replay frame consistent with the latest report state", () => {
    const events = [
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Consistency graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-1",
        title: "Inspect workspace",
        tsBase: "2026-04-16T10:01:00",
        summary: "Inspected the workspace so dashboard work can continue.",
        embedding: [1, 0],
        evaluation: {
          driftScore: 0.88,
          direction: "closer",
          humanSummary: "The AI is still moving toward the dashboard goal.",
        },
      }),
      {
        id: "run-complete",
        graphId: "graph-1",
        kind: "run.completed",
        payload: {
          completedNodeIds: ["node-1"],
        },
        ts: "2026-04-16T10:02:00.000Z",
      },
    ] as GraphEvent[];

    const projection = makeProjection(events);
    const report = buildGraphRunReport({ projection, events });
    const replayFrame = buildReplayFrame("graph-1", events, events.length);

    expect(report.graphStatus).toBe(replayFrame.projection.graph.status);
    expect(report.frontierStatus).toBe(replayFrame.projection.frontierStatus);
    expect(report.runControlState).toBe(replayFrame.projection.runControlState);
  });

  it("derives human review when repeated revisions accumulate on the same original node", () => {
    const baseEvents: GraphEvent[] = [
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Review graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "node-root",
        graphId: "graph-1",
        kind: "node.planned",
        nodeId: "root-node",
        payload: {
          kind: "work",
          title: "Root step",
          intent: "Do the root work",
          humanSummary: "Root step",
          contract: {
            expectedArtifact: "Root artifact",
            allowedTools: ["listDirectory"],
            acceptanceCriteria: ["Artifact exists"],
            humanSummary: "Root step",
          },
          baselineGoalVersionId: "goal-1",
          activeGoalVersionId: "goal-1",
          dependsOnNodeIds: [],
        },
        ts: "2026-04-16T10:01:00.000Z",
      },
      {
        id: "node-root-completed",
        graphId: "graph-1",
        kind: "node.completed",
        nodeId: "root-node",
        payload: {
          output: "done",
          evidence: {
            fileDiffs: [],
            commandResults: [],
            toolCallLog: [],
            workspaceChecksum: "a",
            workspaceChecksumBefore: "a",
            workspaceChecksumAfter: "a",
          },
        },
        ts: "2026-04-16T10:01:30.000Z",
      },
      ...[1, 2, 3].flatMap((index) => [
        {
          id: `revision-${index}`,
          graphId: "graph-1",
          kind: "node.planned",
          nodeId: `revision-${index}`,
          payload: {
            kind: "revision",
            title: `Revision ${index}`,
            intent: "Retry the root step",
            humanSummary: `Revision ${index}`,
            contract: {
              expectedArtifact: "Revision artifact",
              allowedTools: ["listDirectory"],
              acceptanceCriteria: ["Artifact exists"],
              humanSummary: `Revision ${index}`,
            },
            parentNodeId: "root-node",
            baselineGoalVersionId: "goal-1",
            activeGoalVersionId: "goal-1",
            dependsOnNodeIds: [],
          },
          ts: `2026-04-16T10:02:0${index}.000Z`,
        } satisfies GraphEvent,
      ]),
    ];

    const projection = makeProjection(baseEvents);
    expect(projection.needsHumanReview).toBe(true);
    expect(projection.humanReviewReason).toBe(
      "The system has revised the same step several times and may need guidance."
    );
  });

  it("maps confidence badges from evidence coverage and evaluation results", () => {
    const projection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Confidence graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-grounded",
        title: "Grounded step",
        tsBase: "2026-04-16T10:01:00",
        summary: "Grounded work completed.",
        embedding: [1, 0],
        evaluation: {
          llmPassed: true,
          deterministicPassed: true,
          passed: true,
          driftScore: 0.9,
          direction: "closer",
          humanSummary: "Grounded work passed.",
        },
      }),
      {
        id: "node-low-planned",
        graphId: "graph-1",
        kind: "node.planned",
        nodeId: "node-low",
        payload: {
          kind: "work",
          title: "Low confidence step",
          intent: "Low confidence",
          humanSummary: "Low confidence step",
          contract: {
            expectedArtifact: "Low artifact",
            allowedTools: ["listDirectory"],
            acceptanceCriteria: ["Artifact exists"],
            humanSummary: "Low confidence step",
          },
          baselineGoalVersionId: "goal-1",
          activeGoalVersionId: "goal-1",
          dependsOnNodeIds: [],
        },
        ts: "2026-04-16T10:02:00.000Z",
      },
      {
        id: "node-low-failed",
        graphId: "graph-1",
        kind: "node.failed",
        nodeId: "node-low",
        payload: {
          reason: "Deterministic checks failed",
        },
        ts: "2026-04-16T10:02:10.000Z",
      },
    ]);

    expect(projection.nodes.find((node) => node.id === "node-grounded")?.confidenceBadge).toBe("high");
    expect(projection.nodes.find((node) => node.id === "node-low")?.confidenceBadge).toBe("low");
  });

  it("includes review requests in report output and replay state", () => {
    const events = [
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Review report graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "review-evt",
        graphId: "graph-1",
        kind: "run.review_requested",
        payload: {
          reason: "Manual review",
        },
        ts: "2026-04-16T10:00:30.000Z",
      },
    ] as GraphEvent[];

    const projection = makeProjection(events);
    const report = buildGraphRunReport({ projection, events });
    const replayFrame = buildReplayFrame("graph-1", events, events.length);

    expect(report.reviewRequestedAt).toBe("2026-04-16T10:00:30.000Z");
    expect(report.plainEnglishReport).toContain("Run health:");
    expect(report.plainEnglishReport).toContain("Attention:");
    expect(replayFrame.plainEnglishSummary).toContain("marked for human review");
  });

  it("derives blocked and worsening-drift alerts with the right severity", () => {
    const blockedProjection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Alert graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "run-failed",
        graphId: "graph-1",
        kind: "run.failed",
        payload: {
          reason: "Blocked",
          blocked: true,
        },
        ts: "2026-04-16T10:01:00.000Z",
      },
    ]);

    expect(blockedProjection.alerts[0]?.type).toBe("run_blocked");
    expect(blockedProjection.alerts[0]?.severity).toBe("critical");

    const driftProjection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Drift alert graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-1",
        title: "Step one",
        tsBase: "2026-04-16T10:01:00",
        summary: "Step one drifted.",
        embedding: [0, 1],
        evaluation: {
          driftScore: 0.2,
          direction: "drifting",
          humanSummary: "The work is drifting away from the goal.",
        },
      }),
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-2",
        title: "Step two",
        tsBase: "2026-04-16T10:02:00",
        summary: "Step two drifted more.",
        embedding: [0, 1],
        evaluation: {
          driftScore: 0.1,
          direction: "drifting",
          humanSummary: "The work is drifting farther away from the goal.",
        },
      }),
    ]);

    expect(driftProjection.alerts.some((alert) => alert.type === "drift_worsening" && alert.severity === "warning")).toBe(true);
  });

  it("builds deterministic continuity summaries for the same projection and last seen sequence", () => {
    const projection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Continuity graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-1",
        title: "Inspect workspace",
        tsBase: "2026-04-16T10:01:00",
        summary: "Inspected the workspace.",
        embedding: [1, 0],
        evaluation: {
          driftScore: 0.9,
          direction: "closer",
          humanSummary: "The AI is still moving toward the dashboard goal.",
        },
      }),
      {
        id: "run-paused",
        graphId: "graph-1",
        kind: "run.paused",
        payload: {},
        ts: "2026-04-16T10:02:00.000Z",
      },
    ]);

    const summaryA = buildChangesSinceLastViewed(projection, 1);
    const summaryB = buildChangesSinceLastViewed(projection, 1);

    expect(summaryA.changesSinceLastViewedSummary).toBe(summaryB.changesSinceLastViewedSummary);
    expect(summaryA.newEventCount).toBe(summaryB.newEventCount);
  });

  it("derives dashboard summaries from the same projection fields used by per-graph views", () => {
    const projection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Dashboard alignment",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-1",
        title: "Inspect workspace",
        tsBase: "2026-04-16T10:01:00",
        summary: "Inspected the workspace.",
        embedding: [1, 0],
        evaluation: {
          driftScore: 0.91,
          direction: "closer",
          humanSummary: "The AI is still moving toward the dashboard goal.",
        },
      }),
      {
        id: "run-paused",
        graphId: "graph-1",
        kind: "run.paused",
        payload: {},
        ts: "2026-04-16T10:02:00.000Z",
      },
    ]);

    const summary = buildDashboardRunSummary(projection, 1);

    expect(summary.graphStatus).toBe(projection.graph.status);
    expect(summary.frontierStatus).toBe(projection.frontierStatus);
    expect(summary.runControlState).toBe(projection.runControlState);
    expect(summary.needsHumanReview).toBe(projection.needsHumanReview);
    expect(summary.latestNotificationSummary).toBe(projection.latestNotificationSummary);
  });

  it("assigns urgent attention to runs with critical alerts", () => {
    const blockedProjection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Blocked dashboard",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "run-failed",
        graphId: "graph-1",
        kind: "run.failed",
        payload: {
          reason: "Blocked",
          blocked: true,
        },
        ts: "2026-04-16T10:01:00.000Z",
      },
    ]);

    const summary = buildDashboardRunSummary(blockedProjection, 0);
    expect(summary.highestAlertSeverity).toBe("critical");
    expect(summary.attentionLabel).toBe("urgent");
    expect(summary.attentionScore).toBeGreaterThanOrEqual(100);
  });

  it("keeps dashboard blocked and review counts aligned with per-graph state", () => {
    const blockedProjection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Blocked run",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "run-failed",
        graphId: "graph-1",
        kind: "run.failed",
        payload: {
          reason: "Blocked",
          blocked: true,
        },
        ts: "2026-04-16T10:01:00.000Z",
      },
    ]);
    const reviewProjection = makeProjection([
      {
        id: "goal-evt-2",
        graphId: "graph-2",
        kind: "goal.version_created",
        goalVersionId: "goal-2",
        payload: {
          graphTitle: "Review run",
          goal: "Build the settings page",
          goalPacket: makeGoalPacket("goal-2", "Build the settings page"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...[1, 2, 3].map((index) => ({
        id: `revision-${index}`,
        graphId: "graph-2",
        kind: "node.planned",
        nodeId: `revision-${index}`,
        payload: {
          kind: "revision",
          title: `Revision ${index}`,
          intent: "Retry the step",
          humanSummary: `Revision ${index}`,
          contract: {
            expectedArtifact: "Artifact",
            allowedTools: ["listDirectory"],
            acceptanceCriteria: ["Artifact exists"],
            humanSummary: "Revision",
          },
          parentNodeId: "root-node",
          baselineGoalVersionId: "goal-2",
          activeGoalVersionId: "goal-2",
          dependsOnNodeIds: [],
        },
        ts: `2026-04-16T10:0${index}:00.000Z`,
      })) as GraphEvent[],
    ]);

    const overview = buildDashboardOverviewFromProjections([blockedProjection, reviewProjection]);

    expect(overview.summary.blockedRunCount).toBe(1);
    expect(overview.summary.needsReviewCount).toBe(2);
    expect(blockedProjection.alerts.some((alert) => alert.type === "run_blocked" && alert.severity === "critical")).toBe(true);
    expect(reviewProjection.needsHumanReview).toBe(true);
  });

  it("classifies archived runs deterministically and keeps them replayable/exportable", () => {
    const events = [
      {
        id: "goal-evt",
        graphId: "graph-archive",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Archive graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-01T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-archive",
        nodeId: "node-1",
        title: "Finish work",
        tsBase: "2026-04-01T10:01:00",
        summary: "Finished the requested dashboard work.",
        embedding: [1, 0],
        evaluation: {
          driftScore: 0.9,
          direction: "closer",
          humanSummary: "The AI is still moving toward the dashboard goal.",
        },
      }),
      {
        id: "run-complete",
        graphId: "graph-archive",
        kind: "run.completed",
        payload: {
          completedNodeIds: ["node-1"],
        },
        ts: "2026-04-01T10:02:00.000Z",
      },
    ] as GraphEvent[];

    const projection = makeProjection(events);
    const overview = buildDashboardOverviewFromProjections(
      [projection],
      { "graph-archive": events.length },
      { now: "2026-04-16T10:02:00.000Z" }
    );
    const report = buildGraphRunReport({ projection, events });
    const replay = buildReplayFrame("graph-archive", events, events.length);

    expect(overview.items[0]?.lifecycleBucket).toBe("archived");
    expect(report.graphStatus).toBe("completed");
    expect(replay.projection.graph.status).toBe("completed");
  });

  it("uses only projection-safe fields for dashboard search snippets and orders equal matches deterministically", () => {
    const projectionA = makeProjection([
      {
        id: "goal-a",
        graphId: "graph-a",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Search A",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-a",
        nodeId: "node-a",
        title: "Dashboard step",
        tsBase: "2026-04-16T10:01:00",
        summary: "Implemented dashboard search safely.",
        embedding: [1, 0],
        evaluation: {
          driftScore: 0.8,
          direction: "closer",
          humanSummary: "The AI is still moving toward the dashboard goal.",
        },
      }),
    ]);
    const projectionB = makeProjection([
      {
        id: "goal-b",
        graphId: "graph-b",
        kind: "goal.version_created",
        goalVersionId: "goal-2",
        payload: {
          graphTitle: "Search B",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-2", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-b",
        nodeId: "node-b",
        title: "Dashboard step",
        tsBase: "2026-04-16T10:02:00",
        summary: "Implemented dashboard search safely.",
        embedding: [1, 0],
        evaluation: {
          driftScore: 0.8,
          direction: "closer",
          humanSummary: "The AI is still moving toward the dashboard goal.",
        },
      }),
    ]);

    const overview = buildDashboardOverviewFromProjections(
      [projectionA, projectionB],
      {},
      { q: "dashboard" }
    );

    expect(overview.items[0]?.graphId).toBe("graph-b");
    expect(overview.items[0]?.searchSnippet?.toLowerCase()).toContain("dashboard");
    expect(overview.items[0]?.searchSnippet).not.toContain("stderr");
  });

  it("finds similar runs with deterministic text-overlap fallback when embeddings are unavailable", () => {
    const target = makeProjection([
      {
        id: "goal-target",
        graphId: "graph-target",
        kind: "goal.version_created",
        goalVersionId: "goal-target-v1",
        payload: {
          graphTitle: "Target",
          goal: "Build dashboard search",
          goalPacket: {
            ...makeGoalPacket("goal-target-v1", "Build dashboard search"),
            embedding: [],
            criteriaEmbeddings: [],
          },
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-target",
        nodeId: "node-target",
        title: "Dashboard search",
        tsBase: "2026-04-16T10:01:00",
        summary: "Implemented dashboard search and archive views.",
        embedding: [],
      }),
    ]);
    const similar = makeProjection([
      {
        id: "goal-similar",
        graphId: "graph-similar",
        kind: "goal.version_created",
        goalVersionId: "goal-similar-v1",
        payload: {
          graphTitle: "Similar",
          goal: "Build dashboard archive search",
          goalPacket: {
            ...makeGoalPacket("goal-similar-v1", "Build dashboard archive search"),
            embedding: [],
            criteriaEmbeddings: [],
          },
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-similar",
        nodeId: "node-similar",
        title: "Archive search",
        tsBase: "2026-04-16T10:02:00",
        summary: "Implemented dashboard archive search and comparison.",
        embedding: [],
      }),
    ]);
    const different = makeProjection([
      {
        id: "goal-different",
        graphId: "graph-different",
        kind: "goal.version_created",
        goalVersionId: "goal-different-v1",
        payload: {
          graphTitle: "Different",
          goal: "Refactor authentication",
          goalPacket: {
            ...makeGoalPacket("goal-different-v1", "Refactor authentication"),
            embedding: [],
            criteriaEmbeddings: [],
          },
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-different",
        nodeId: "node-different",
        title: "Auth work",
        tsBase: "2026-04-16T10:03:00",
        summary: "Refactored unrelated authentication helpers.",
        embedding: [],
      }),
    ]);

    const results = buildSimilarRuns(target, [target, similar, different]);

    expect(results[0]?.graphId).toBe("graph-similar");
    expect(results.some((item) => item.graphId === "graph-target")).toBe(false);
  });

  it("builds comparison output from the same report values used elsewhere", () => {
    const leftEvents = [
      {
        id: "goal-left",
        graphId: "graph-left",
        kind: "goal.version_created",
        goalVersionId: "goal-left-v1",
        payload: {
          graphTitle: "Left run",
          goal: "Build dashboard comparison",
          goalPacket: makeGoalPacket("goal-left-v1", "Build dashboard comparison"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-left",
        nodeId: "node-left",
        title: "Left step",
        tsBase: "2026-04-16T10:01:00",
        summary: "Completed more dashboard work.",
        embedding: [1, 0],
      }),
      {
        id: "run-left-complete",
        graphId: "graph-left",
        kind: "run.completed",
        payload: {
          completedNodeIds: ["node-left"],
        },
        ts: "2026-04-16T10:02:00.000Z",
      },
    ] as GraphEvent[];
    const rightEvents = [
      {
        id: "goal-right",
        graphId: "graph-right",
        kind: "goal.version_created",
        goalVersionId: "goal-right-v1",
        payload: {
          graphTitle: "Right run",
          goal: "Build dashboard comparison",
          goalPacket: makeGoalPacket("goal-right-v1", "Build dashboard comparison"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "run-right-failed",
        graphId: "graph-right",
        kind: "run.failed",
        payload: {
          reason: "Blocked",
          blocked: true,
        },
        ts: "2026-04-16T10:02:00.000Z",
      },
    ] as GraphEvent[];

    const leftProjection = makeProjection(leftEvents);
    const rightProjection = makeProjection(rightEvents);
    const comparison = buildRunComparison(
      buildComparisonSide(buildGraphRunReport({ projection: leftProjection, events: leftEvents })),
      buildComparisonSide(buildGraphRunReport({ projection: rightProjection, events: rightEvents }))
    );

    expect(comparison.left.graphStatus).toBe(leftProjection.graph.status);
    expect(comparison.right.graphStatus).toBe(rightProjection.graph.status);
    expect(comparison.right.highestAlertSeverity).toBe(rightProjection.alerts[0]?.severity);
  });

  it("marks human review for repeated deterministic failure, repeated drift, and blocked graphs", () => {
    const deterministicFailureProjection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Deterministic failures",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-1",
        title: "Step one",
        tsBase: "2026-04-16T10:01:00",
        summary: "First failing step",
        embedding: [1, 0],
        evaluation: {
          llmPassed: false,
          deterministicPassed: false,
          passed: false,
          driftScore: 0.52,
          direction: "holding",
          humanSummary: "Checks failed for step one.",
        },
      }),
      ...makeNodeEvents({
        graphId: "graph-1",
        nodeId: "node-2",
        title: "Step two",
        tsBase: "2026-04-16T10:02:00",
        summary: "Second failing step",
        embedding: [1, 0],
        evaluation: {
          llmPassed: false,
          deterministicPassed: false,
          passed: false,
          driftScore: 0.5,
          direction: "holding",
          humanSummary: "Checks failed for step two.",
        },
      }),
    ]);

    expect(deterministicFailureProjection.needsHumanReview).toBe(true);
    expect(deterministicFailureProjection.humanReviewReason).toContain("did not pass their checks");

    const driftingProjection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Drift review",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      ...["node-1", "node-2", "node-3"].flatMap((nodeId, index) =>
        makeNodeEvents({
          graphId: "graph-1",
          nodeId,
          title: `Step ${index + 1}`,
          tsBase: `2026-04-16T10:0${index + 1}:00`,
          summary: `Drifting step ${index + 1}`,
          embedding: [0, 1],
          evaluation: {
            llmPassed: false,
            deterministicPassed: true,
            passed: false,
            driftScore: 0.2,
            baselineDriftScore: 0.2,
            direction: "drifting",
            humanSummary: "The work is drifting away from the goal.",
          },
        })
      ),
    ]);

    expect(driftingProjection.needsHumanReview).toBe(true);
    expect(driftingProjection.humanReviewReason).toContain("drifting away from the goal");

    const blockedProjection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Blocked review",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "run-failed",
        graphId: "graph-1",
        kind: "run.failed",
        payload: {
          reason: "Blocked",
          blocked: true,
        },
        ts: "2026-04-16T10:01:00.000Z",
      },
    ]);

    expect(blockedProjection.needsHumanReview).toBe(true);
    expect(blockedProjection.humanReviewReason).toBe("Work is blocked because no runnable step is available.");
  });

  it("projects annotations from events only and does not let annotation text change execution state by itself", () => {
    const projection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Annotation graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "graph-annotation",
        graphId: "graph-1",
        kind: "run.annotated",
        payload: {
          annotationId: "ann-1",
          graphId: "graph-1",
          createdAt: "2026-04-16T10:00:05.000Z",
          authorLabel: "Operator",
          text: "Please be careful with auth, but do not change scope.",
          kind: "note",
        },
        ts: "2026-04-16T10:00:05.000Z",
      },
    ]);

    expect(projection.graphAnnotations).toHaveLength(1);
    expect(projection.graph.status).toBe("idle");
    expect(projection.runControlState).toBe("idle");
    expect(projection.waitingForApproval).toBe(false);
  });

  it("derives waitingForApproval from decision event order and surfaces it consistently", () => {
    const waitingProjection = makeProjection([
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Approval graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "approval-request",
        graphId: "graph-1",
        kind: "run.approval_requested",
        payload: {
          decisionId: "dec-1",
          graphId: "graph-1",
          createdAt: "2026-04-16T10:00:10.000Z",
          authorLabel: "Operator",
          reason: "Need a go/no-go before the next step.",
        },
        ts: "2026-04-16T10:00:10.000Z",
      },
    ]);

    expect(waitingProjection.approvalState).toBe("requested");
    expect(waitingProjection.waitingForApproval).toBe(true);
    expect(waitingProjection.latestDecisionSummary).toBe("This run is waiting for approval before continuing.");

    const resumedProjection = makeProjection([
      ...waitingProjection.events,
      {
        id: "approval-continue",
        graphId: "graph-1",
        kind: "run.continue_requested",
        payload: {
          decisionId: "dec-2",
          graphId: "graph-1",
          createdAt: "2026-04-16T10:00:20.000Z",
          authorLabel: "Reviewer",
          reason: "Continue from the current state.",
        },
        ts: "2026-04-16T10:00:20.000Z",
      } as GraphEvent,
    ]);

    expect(resumedProjection.approvalState).toBe("approved");
    expect(resumedProjection.waitingForApproval).toBe(false);
    expect(resumedProjection.latestDecisionSummary).toBe("A human asked this run to continue after review.");
    expect(buildDashboardRunSummary(resumedProjection, 0).waitingForApproval).toBe(false);
  });

  it("keeps replay and report decision summaries aligned with projection-derived state", () => {
    const events = [
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Decision report graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "node-planned",
        graphId: "graph-1",
        kind: "node.planned",
        nodeId: "node-1",
        payload: {
          kind: "work",
          title: "Inspect workspace",
          intent: "Inspect the workspace",
          humanSummary: "Inspect the workspace",
          contract: {
            expectedArtifact: "Workspace summary",
            allowedTools: ["listDirectory"],
            acceptanceCriteria: ["Workspace listing captured"],
            humanSummary: "Inspect the workspace",
          },
          baselineGoalVersionId: "goal-1",
          activeGoalVersionId: "goal-1",
          dependsOnNodeIds: [],
        },
        ts: "2026-04-16T10:00:05.000Z",
      },
      {
        id: "node-annotation",
        graphId: "graph-1",
        kind: "node.annotated",
        nodeId: "node-1",
        payload: {
          annotationId: "ann-1",
          graphId: "graph-1",
          nodeId: "node-1",
          createdAt: "2026-04-16T10:00:06.000Z",
          authorLabel: "Operator",
          text: "This step needs a quick human sanity check.",
          kind: "decision_context",
        },
        ts: "2026-04-16T10:00:06.000Z",
      },
      {
        id: "decision-request",
        graphId: "graph-1",
        kind: "run.approval_requested",
        payload: {
          decisionId: "dec-1",
          graphId: "graph-1",
          createdAt: "2026-04-16T10:00:10.000Z",
          authorLabel: "Operator",
          reason: "Need explicit approval before continuing.",
        },
        ts: "2026-04-16T10:00:10.000Z",
      },
    ] as GraphEvent[];

    const projection = makeProjection(events);
    const report = buildGraphRunReport({ projection, events });
    const replayFrame = buildReplayFrame("graph-1", events, events.length);

    expect(report.latestDecisionSummary).toBe(projection.latestDecisionSummary);
    expect(report.plainEnglishReport).toContain("Decision: This run is waiting for approval before continuing.");
    expect(report.annotations).toHaveLength(1);
    expect(replayFrame.plainEnglishSummary).toContain("waiting for approval");
  });

  it("replays lineage descriptors and node bindings deterministically", () => {
    const events = [
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Lineage graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "node-planned",
        graphId: "graph-1",
        kind: "node.planned",
        nodeId: "node-1",
        payload: {
          kind: "work",
          title: "Inspect workspace",
          intent: "Inspect the workspace",
          humanSummary: "Inspect the workspace",
          contract: {
            expectedArtifact: "Workspace summary",
            allowedTools: ["listDirectory"],
            acceptanceCriteria: ["Workspace listing captured"],
            humanSummary: "Inspect the workspace",
          },
          baselineGoalVersionId: "goal-1",
          activeGoalVersionId: "goal-1",
          dependsOnNodeIds: [],
        },
        ts: "2026-04-16T10:00:05.000Z",
      },
      {
        id: "lineage-declared",
        graphId: "graph-1",
        kind: "system.lineage_declared",
        payload: {
          lineageId: "planner-1",
          graphId: "graph-1",
          createdAt: "2026-04-16T10:00:06.000Z",
          kind: "planner",
          label: "OpenAI planner",
          version: "gpt-4o",
          contentHash: "plannerhash",
          summary: "This run used planner gpt-4o.",
          source: "built_in",
        },
        ts: "2026-04-16T10:00:06.000Z",
      },
      {
        id: "lineage-bound",
        graphId: "graph-1",
        kind: "node.lineage_bound",
        nodeId: "node-1",
        payload: {
          graphId: "graph-1",
          nodeId: "node-1",
          createdAt: "2026-04-16T10:00:07.000Z",
          bindings: [{ kind: "planner", lineageId: "planner-1" }],
        },
        ts: "2026-04-16T10:00:07.000Z",
      },
    ] as GraphEvent[];

    const projection = makeProjection(events);
    const replayFrame = buildReplayFrame("graph-1", events, events.length);

    expect(projection.lineageCount).toBe(1);
    expect(projection.lineageSummary).toContain("planner gpt-4o");
    expect(projection.nodes[0]?.lineageBindings?.[0]?.lineageId).toBe("planner-1");
    expect(replayFrame.plainEnglishSummary).toContain("Lineage");
  });

  it("shows lineage differences in comparison output and report lines, including fallback visibility", () => {
    const leftProjection = makeProjection([
      {
        id: "goal-left",
        graphId: "graph-left",
        kind: "goal.version_created",
        goalVersionId: "goal-left-v1",
        payload: {
          graphTitle: "Left run",
          goal: "Build dashboard comparison",
          goalPacket: makeGoalPacket("goal-left-v1", "Build dashboard comparison"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "left-lineage",
        graphId: "graph-left",
        kind: "system.lineage_declared",
        payload: {
          lineageId: "left-evaluator",
          graphId: "graph-left",
          createdAt: "2026-04-16T10:00:01.000Z",
          kind: "evaluator",
          label: "OpenAI evaluator",
          version: "gpt-4o",
          contentHash: "left-hash",
          summary: "Evaluator lineage",
          source: "built_in",
        },
        ts: "2026-04-16T10:00:01.000Z",
      },
      {
        id: "left-policy",
        graphId: "graph-left",
        kind: "system.lineage_declared",
        payload: {
          lineageId: "left-retriever",
          graphId: "graph-left",
          createdAt: "2026-04-16T10:00:02.000Z",
          kind: "retriever",
          label: "OpenAgentGraph retriever",
          version: "text-embedding-3-large",
          contentHash: "retriever-hash",
          summary: "Fallback retrieval logic was used for this step.",
          source: "built_in",
          fallbackUsed: true,
        },
        ts: "2026-04-16T10:00:02.000Z",
      },
    ] as GraphEvent[]);
    const rightProjection = makeProjection([
      {
        id: "goal-right",
        graphId: "graph-right",
        kind: "goal.version_created",
        goalVersionId: "goal-right-v1",
        payload: {
          graphTitle: "Right run",
          goal: "Build dashboard comparison",
          goalPacket: makeGoalPacket("goal-right-v1", "Build dashboard comparison"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "right-lineage",
        graphId: "graph-right",
        kind: "system.lineage_declared",
        payload: {
          lineageId: "right-evaluator",
          graphId: "graph-right",
          createdAt: "2026-04-16T10:00:01.000Z",
          kind: "evaluator",
          label: "OpenAI evaluator",
          version: "gpt-4.1",
          contentHash: "right-hash",
          summary: "Evaluator lineage",
          source: "built_in",
        },
        ts: "2026-04-16T10:00:01.000Z",
      },
    ] as GraphEvent[]);

    const leftReport = buildGraphRunReport({ projection: leftProjection, events: leftProjection.events });
    const rightReport = buildGraphRunReport({ projection: rightProjection, events: rightProjection.events });
    const comparison = buildRunComparison(buildComparisonSide(leftReport), buildComparisonSide(rightReport));

    expect(leftReport.plainEnglishReport).toContain("Lineage:");
    expect(leftReport.lineageSummary).toContain("fallback retrieval logic");
    expect(comparison.summary).toContain("different evaluator versions");
  });

  it("surfaces actor-attributed human events in replay and reports when actor identity is present", () => {
    const events: GraphEvent[] = [
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Actor graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "review-evt",
        graphId: "graph-1",
        kind: "run.review_requested",
        payload: {
          reason: "Need a reviewer",
          actor: {
            actorId: "yash",
            displayName: "Yash",
            role: "operator",
          },
        },
        ts: "2026-04-16T10:01:00.000Z",
      },
    ];

    const projection = makeProjection(events);
    const report = buildGraphRunReport({ projection, events });
    const replayFrame = buildReplayFrame("graph-1", events, events.length);

    expect(projection.peopleSummary).toContain("Yash requested review");
    expect(replayFrame.plainEnglishSummary).toContain("Yash requested review");
    expect(report.plainEnglishReport).toContain("People: Yash requested review.");
  });

  it("keeps legacy human events without actor identity replay-safe with neutral wording", () => {
    const events: GraphEvent[] = [
      {
        id: "goal-evt",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Legacy actor graph",
          goal: "Build the dashboard",
          goalPacket: makeGoalPacket("goal-1", "Build the dashboard"),
          activate: true,
        },
        ts: "2026-04-16T10:00:00.000Z",
      },
      {
        id: "review-evt",
        graphId: "graph-1",
        kind: "run.review_requested",
        payload: {
          reason: "Need a reviewer",
        },
        ts: "2026-04-16T10:01:00.000Z",
      },
    ];

    const projection = makeProjection(events);
    const report = buildGraphRunReport({ projection, events });

    expect(projection.peopleSummary).toContain("A user requested review");
    expect(report.plainEnglishReport).toContain("People: A user requested review.");
  });
});
