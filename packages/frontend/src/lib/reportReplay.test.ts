import { describe, expect, it } from "vitest";
import { buildPlainEnglishRunReport } from "@openagentgraph/shared";
import type { Edge, Graph, GraphEvent, Node } from "@openagentgraph/shared";
import { buildFrontendReplayFrame } from "./replay.js";

function makeGraph(): Graph {
  return {
    id: "graph-1",
    title: "Report graph",
    goal: "Current goal text",
    status: "completed",
    originalGoalVersionId: "goal-1",
    activeGoalVersionId: "goal-2",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: "node-1",
    graphId: "graph-1",
    kind: "work",
    title: "Inspect workspace",
    intent: "Inspect the workspace",
    humanSummary: "Inspect the workspace before making changes.",
    status: "completed",
    contract: {
      expectedArtifact: "Workspace summary",
      allowedTools: ["listDirectory"],
      acceptanceCriteria: ["Workspace listing captured"],
      humanSummary: "Inspect the workspace",
    },
    evidenceSummary: "No files changed. Ran 1 command: npm. All recorded checks passed. The workspace state stayed the same.",
    evaluation: {
      llmPassed: true,
      deterministicPassed: true,
      passed: true,
      driftScore: 0.9,
      baselineDriftScore: 0.9,
      direction: "closer",
      humanSummary: "The AI is still moving toward the dashboard goal.",
      suggestedAction: "complete",
      findings: [],
      ruleViolations: [],
    },
    baselineGoalVersionId: "goal-1",
    activeGoalVersionId: "goal-2",
    dependsOnNodeIds: [],
    createdAt: "2026-04-16T10:00:00.000Z",
    updatedAt: "2026-04-16T10:01:00.000Z",
    completedAt: "2026-04-16T10:01:00.000Z",
    ...overrides,
  };
}

describe("report and replay helpers", () => {
  it("keeps the latest replay frame consistent with the report latest state", () => {
    const graph = makeGraph();
    const nodes = [makeNode()];
    const edges: Edge[] = [];
    const events: GraphEvent[] = [
      {
        id: "goal-1",
        graphId: "graph-1",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: graph.title,
          goal: "Original dashboard goal",
          goalPacket: {
            id: "goal-1",
            version: 1,
            originalText: "Original dashboard goal",
            successCriteria: [],
            forbiddenScope: [],
            embedding: [],
            criteriaEmbeddings: [],
            createdAt: "2026-04-16T09:59:00.000Z",
          },
          activate: true,
        },
        ts: "2026-04-16T09:59:00.000Z",
      },
      {
        id: "run-1",
        graphId: "graph-1",
        kind: "run.completed",
        payload: {
          completedNodeIds: ["node-1"],
        },
        ts: "2026-04-16T10:02:00.000Z",
      },
    ];

    const report = buildPlainEnglishRunReport({
      graph,
      nodes,
      frontierStatus: "on_track",
      currentDriftSummary: "The AI is still moving toward the dashboard goal.",
      originalGoalText: "Original dashboard goal",
    });
    const replayFrame = buildFrontendReplayFrame(
      events,
      nodes,
      edges,
      graph.status,
      "idle",
      "on_track",
      "The AI is still moving toward the dashboard goal.",
      events.length
    );

    expect(report.startsWith("Goal: Original dashboard goal")).toBe(true);
    expect(replayFrame.graphStatus).toBe(graph.status);
    expect(replayFrame.runControlState).toBe("idle");
    expect(replayFrame.frontierStatus).toBe("on_track");
  });

  it("does not let presentation filtering change report content", () => {
    const graph = makeGraph();
    const nodes = [
      makeNode(),
      makeNode({
        id: "node-2",
        title: "Old branch",
        status: "superseded",
        humanSummary: "Superseded branch",
        evidenceSummary: "A command ran but did not complete successfully. The system is deciding whether to retry or take a different path.",
      }),
    ];

    const reportBefore = buildPlainEnglishRunReport({
      graph,
      nodes,
      frontierStatus: "on_track",
      currentDriftSummary: "The AI is still moving toward the dashboard goal.",
      originalGoalText: "Original dashboard goal",
    });

    const visibleNodes = nodes.filter((node) => node.status !== "superseded");
    void visibleNodes;

    const reportAfter = buildPlainEnglishRunReport({
      graph,
      nodes,
      frontierStatus: "on_track",
      currentDriftSummary: "The AI is still moving toward the dashboard goal.",
      originalGoalText: "Original dashboard goal",
    });

    expect(reportAfter).toBe(reportBefore);
  });

  it("keeps run control state visible in replay frames", () => {
    const replayFrame = buildFrontendReplayFrame(
      [
        {
          id: "goal-1",
          graphId: "graph-1",
          kind: "goal.version_created",
          goalVersionId: "goal-1",
          payload: {
            graphTitle: "Paused graph",
            goal: "Original dashboard goal",
            goalPacket: {
              id: "goal-1",
              version: 1,
              originalText: "Original dashboard goal",
              successCriteria: [],
              forbiddenScope: [],
              embedding: [],
              criteriaEmbeddings: [],
              createdAt: "2026-04-16T09:59:00.000Z",
            },
            activate: true,
          },
          ts: "2026-04-16T09:59:00.000Z",
        },
        {
          id: "run-1",
          graphId: "graph-1",
          kind: "run.started",
          payload: {
            workspaceRoot: "C:\\workspace",
            goalVersionId: "goal-1",
          },
          ts: "2026-04-16T10:00:00.000Z",
        },
        {
          id: "pause-1",
          graphId: "graph-1",
          kind: "run.paused",
          payload: {},
          ts: "2026-04-16T10:01:00.000Z",
        },
      ],
      [],
      [],
      "running",
      "paused",
      "on_track",
      "The AI is waiting to continue.",
      3
    );

    expect(replayFrame.runControlState).toBe("paused");
    expect(replayFrame.plainEnglishSummary).toContain("paused");
  });
});
