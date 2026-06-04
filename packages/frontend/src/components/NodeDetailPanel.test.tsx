import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { AgentContextPack, Node } from "@openagentgraph/shared";
import { useStore } from "../lib/store.js";
import { NodeDetailPanel } from "./NodeDetailPanel.js";

const NOW = "2026-06-04T00:00:00.000Z";

function makeNode(id: string): Node {
  return {
    id,
    graphId: "graph-1",
    kind: "work",
    title: "Verify agent context",
    intent: "Expose selected-node context to external agents.",
    humanSummary: "Selected node context is available.",
    status: "ready",
    contract: {
      expectedArtifact: "Context pack preview.",
      allowedTools: [],
      acceptanceCriteria: ["The selected node context can be copied."],
      humanSummary: "Preview the selected node context.",
    },
    baselineGoalVersionId: "goal-v1",
    activeGoalVersionId: "goal-v1",
    dependsOnNodeIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buttonText(children: unknown): string {
  if (Array.isArray(children)) return children.map(buttonText).join("");
  return String(children ?? "");
}

describe("NodeDetailPanel", () => {
  it("loads and copies a selected-node agent context pack", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText } },
    });

    const node = makeNode("node-1");
    const context: AgentContextPack = {
      graphId: "graph-1",
      generatedAt: NOW,
      graph: {
        id: "graph-1",
        title: "Agent graph",
        goal: "Coordinate external workers.",
        status: "running",
        activeGoalVersionId: "goal-v1",
      },
      run: {
        runControlState: "running",
        frontierStatus: "on_track",
        plannedNodeCount: 1,
        completedNodeCount: 0,
        failedNodeCount: 0,
        runHealthSummary: "Run is healthy.",
      },
      selectedNode: {
        nodeId: node.id,
        title: node.title,
        kind: node.kind,
        status: node.status,
        humanSummary: node.humanSummary,
        dependsOnNodeIds: [],
        updatedAt: node.updatedAt,
      },
      frontier: [
        {
          nodeId: node.id,
          title: node.title,
          kind: node.kind,
          status: node.status,
          humanSummary: node.humanSummary,
          dependsOnNodeIds: [],
          updatedAt: node.updatedAt,
        },
      ],
      recentAgentActivity: [],
      planProposals: [],
      instructions: ["Verify source files directly before editing."],
    };
    const loadAgentContext = vi.fn(async () => {
      useStore.setState({
        agentContext: context,
        agentCollaborationLoading: false,
        agentCollaborationError: "",
        agentCollaborationMessage: "Context pack loaded.",
      });
      return context;
    });

    useStore.setState({
      activeGraphId: "graph-1",
      nodes: [node],
      edges: [],
      selectedNodeId: node.id,
      events: [],
      currentActor: { actorId: "operator", displayName: "Operator", role: "operator" },
      capabilities: null,
      agentContext: null,
      agentCollaborationLoading: false,
      agentCollaborationError: "",
      agentCollaborationMessage: "",
      loadAgentContext,
      retryNode: vi.fn(),
      replanNode: vi.fn(),
      annotateNode: vi.fn(),
      uiMode: "default",
      needsHumanReview: false,
      humanReviewReason: "",
      waitingForApproval: false,
      latestDecisionSummary: "",
      lineageSummary: "",
      lineageDescriptors: [],
    });

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<NodeDetailPanel />);
    });

    const loadButton = renderer!.root
      .findAllByType("button")
      .find((button) => buttonText(button.props.children) === "Load context");
    expect(loadButton).toBeTruthy();

    await act(async () => {
      await loadButton!.props.onClick();
    });

    expect(loadAgentContext).toHaveBeenCalledWith("graph-1", "node-1");
    const loadedMarkup = JSON.stringify(renderer!.toJSON());
    expect(loadedMarkup).toContain("Agent Context Pack");
    expect(loadedMarkup).toContain("selectedNode");
    expect(loadedMarkup).toContain("Context pack loaded.");

    const copyButton = renderer!.root
      .findAllByType("button")
      .find((button) => buttonText(button.props.children) === "Copy JSON");
    expect(copyButton).toBeTruthy();

    await act(async () => {
      await copyButton!.props.onClick();
    });

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("\"graphId\": \"graph-1\""));
    expect(JSON.stringify(renderer!.toJSON())).toContain("Context JSON copied.");
  });
});
