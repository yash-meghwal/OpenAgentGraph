import { describe, expect, it } from "vitest";
import { buildPlainEnglishRunReport } from "@openagentgraph/shared";
import type { Graph, Node } from "@openagentgraph/shared";
import { deriveGraphRuntime, LARGE_GRAPH_NODE_THRESHOLD } from "./graphRuntime.js";

function makeGraph(): Graph {
  return {
    id: "graph-1",
    title: "Large graph",
    goal: "Inspect the graph",
    status: "running",
    originalGoalVersionId: "goal-1",
    activeGoalVersionId: "goal-1",
    createdAt: "2026-04-16T10:00:00.000Z",
    updatedAt: "2026-04-16T10:10:00.000Z",
  };
}

function makeNode(id: string): Node {
  return {
    id,
    graphId: "graph-1",
    kind: "work",
    title: `Node ${id}`,
    intent: "Inspect runtime state",
    humanSummary: "A step completed.",
    status: "completed",
    contract: {
      expectedArtifact: "Artifact",
      allowedTools: ["readFile"],
      acceptanceCriteria: ["Artifact exists"],
      humanSummary: "Inspect runtime state",
    },
    baselineGoalVersionId: "goal-1",
    activeGoalVersionId: "goal-1",
    dependsOnNodeIds: [],
    createdAt: "2026-04-16T10:00:00.000Z",
    updatedAt: "2026-04-16T10:00:00.000Z",
    completedAt: "2026-04-16T10:00:00.000Z",
  };
}

describe("graphRuntime", () => {
  it("activates deterministic large-graph mode at the configured threshold", () => {
    expect(
      deriveGraphRuntime({
        totalNodeCount: LARGE_GRAPH_NODE_THRESHOLD - 1,
        selectedNodeId: null,
        activeNodeId: null,
        graphQuality: "standard",
        graphDetailMode: "auto",
        showSupersededNodes: true,
        showRevisionBranches: true,
        showReplanBranches: true,
      }).largeGraphModeActive
    ).toBe(false);

    expect(
      deriveGraphRuntime({
        totalNodeCount: LARGE_GRAPH_NODE_THRESHOLD,
        selectedNodeId: "node-1",
        activeNodeId: "node-2",
        graphQuality: "standard",
        graphDetailMode: "auto",
        showSupersededNodes: true,
        showRevisionBranches: true,
        showReplanBranches: true,
      })
    ).toEqual({
      largeGraphModeActive: true,
      effectiveGraphQuality: "performance",
      effectiveShowSupersededNodes: false,
      effectiveShowRevisionBranches: false,
      effectiveShowReplanBranches: false,
      suppressHoverDetails: true,
      statusMessage: "Large graph mode is active to keep this run responsive.",
    });
  });

  it("keeps large-graph fallback presentation-only and reversible", () => {
    const graph = makeGraph();
    const nodes = [makeNode("node-1"), makeNode("node-2")];
    const reportBefore = buildPlainEnglishRunReport({
      graph,
      nodes,
      frontierStatus: "on_track",
      currentDriftSummary: "The run is on track.",
      runHealthSummary: "2 of 2 planned steps completed.",
      originalGoalText: graph.goal,
    });

    const runtime = deriveGraphRuntime({
      totalNodeCount: LARGE_GRAPH_NODE_THRESHOLD + 20,
      selectedNodeId: "node-1",
      activeNodeId: "node-2",
      graphQuality: "standard",
      graphDetailMode: "full",
      showSupersededNodes: true,
      showRevisionBranches: true,
      showReplanBranches: true,
    });

    expect(runtime.largeGraphModeActive).toBe(false);

    const reportAfter = buildPlainEnglishRunReport({
      graph,
      nodes,
      frontierStatus: "on_track",
      currentDriftSummary: "The run is on track.",
      runHealthSummary: "2 of 2 planned steps completed.",
      originalGoalText: graph.goal,
    });

    expect(reportAfter).toBe(reportBefore);
  });

  it("preserves selected and active node visibility rules while large-graph mode is active", () => {
    const runtime = deriveGraphRuntime({
      totalNodeCount: LARGE_GRAPH_NODE_THRESHOLD + 1,
      selectedNodeId: "selected-node",
      activeNodeId: "active-node",
      graphQuality: "standard",
      graphDetailMode: "auto",
      showSupersededNodes: true,
      showRevisionBranches: true,
      showReplanBranches: true,
    });

    expect(runtime.largeGraphModeActive).toBe(true);
    expect(runtime.suppressHoverDetails).toBe(true);
    expect(runtime.statusMessage).toBe("Large graph mode is active to keep this run responsive.");
  });
});
