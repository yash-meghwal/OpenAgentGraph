import { describe, expect, it } from "vitest";
import { buildPlainEnglishRunReport } from "@openagentgraph/shared";
import type { Edge, Graph, Node } from "@openagentgraph/shared";
import { buildPresentedGraph } from "./graphPresentation.js";

function makeGraph(): Graph {
  return {
    id: "graph-1",
    title: "Presentation graph",
    goal: "Build the dashboard",
    status: "running",
    originalGoalVersionId: "goal-1",
    activeGoalVersionId: "goal-1",
    createdAt: "2026-04-16T10:00:00.000Z",
    updatedAt: "2026-04-16T10:10:00.000Z",
  };
}

function makeNode(overrides: Partial<Node>): Node {
  return {
    id: "node-1",
    graphId: "graph-1",
    kind: "work",
    title: "Main node",
    intent: "Do the main work",
    humanSummary: "Main node finished.",
    status: "completed",
    contract: {
      expectedArtifact: "Artifact",
      allowedTools: ["listDirectory"],
      acceptanceCriteria: ["Artifact exists"],
      humanSummary: "Main node",
    },
    baselineGoalVersionId: "goal-1",
    activeGoalVersionId: "goal-1",
    dependsOnNodeIds: [],
    coordinates: {
      depth: 0,
      branch: 0,
      abstractionLevel: 0,
      driftDistance: 0,
      baselineDriftDistance: 0,
    },
    createdAt: "2026-04-16T10:00:00.000Z",
    updatedAt: "2026-04-16T10:01:00.000Z",
    completedAt: "2026-04-16T10:01:00.000Z",
    ...overrides,
  };
}

describe("graphPresentation", () => {
  it("collapses decluttered history without changing report content", () => {
    const graph = makeGraph();
    const nodes = [
      makeNode({ id: "main", title: "Main path", humanSummary: "Main path completed." }),
      makeNode({
        id: "revision-1",
        title: "Revision node",
        kind: "revision",
        status: "completed",
        parentNodeId: "main",
        humanSummary: "Revision completed.",
      }),
      makeNode({
        id: "superseded-1",
        title: "Superseded node",
        status: "superseded",
        branchId: "replan-1",
        humanSummary: "Superseded branch remained visible.",
      }),
    ];
    const edges: Edge[] = [
      {
        id: "e1",
        graphId: "graph-1",
        sourceNodeId: "main",
        targetNodeId: "revision-1",
        kind: "revises",
        createdAt: "2026-04-16T10:02:00.000Z",
      },
    ];

    const reportBefore = buildPlainEnglishRunReport({
      graph,
      nodes,
      frontierStatus: "on_track",
      currentDriftSummary: "The AI is still moving toward the dashboard goal.",
      runHealthSummary: "2 of 2 steps completed. Most recent work is on track.",
      originalGoalText: graph.goal,
    });

    const presented = buildPresentedGraph(nodes, edges, {
      selectedNodeId: null,
      activeNodeId: "main",
      showSupersededNodes: true,
      showRevisionBranches: true,
      showReplanBranches: true,
      collapseSupersededBranches: true,
      collapseRevisionClusters: true,
      showActiveNeighborhoodOnly: false,
    });

    expect(presented.nodes.some((node) => node.synthetic)).toBe(true);

    const reportAfter = buildPlainEnglishRunReport({
      graph,
      nodes,
      frontierStatus: "on_track",
      currentDriftSummary: "The AI is still moving toward the dashboard goal.",
      runHealthSummary: "2 of 2 steps completed. Most recent work is on track.",
      originalGoalText: graph.goal,
    });

    expect(reportAfter).toBe(reportBefore);
  });
});
