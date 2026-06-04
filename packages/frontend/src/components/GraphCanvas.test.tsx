import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { Edge, Node, NodeStatus } from "@openagentgraph/shared";
import { useStore } from "../lib/store.js";
import { GRAPH_THEMES } from "../lib/graphTheme.js";
import { GraphCanvas } from "./GraphCanvas.js";

type RenderedGraphNode = Node & {
  synthetic?: boolean;
};

type ForceGraphMockProps = {
  backgroundColor: string;
  graphData: {
    nodes: RenderedGraphNode[];
    links: Edge[];
  };
  linkColor: (link: Edge) => string;
  nodeThreeObject: (node: RenderedGraphNode) => {
    children: Array<{
      material?: {
        color?: {
          getHexString?: () => string;
        };
      };
    }>;
  };
};

const forceGraphMock = vi.hoisted(() => ({
  props: null as ForceGraphMockProps | null,
}));

vi.mock("react-force-graph-3d", () => ({
  default: (props: ForceGraphMockProps) => {
    forceGraphMock.props = props;
    return (
      <div
        data-background={props.backgroundColor}
        data-link-count={props.graphData.links.length}
        data-node-count={props.graphData.nodes.length}
        data-testid="force-graph"
      />
    );
  },
}));

const NOW = "2026-06-04T00:00:00.000Z";

function makeNode(id: string, status: NodeStatus): Node {
  return {
    id,
    graphId: "graph-1",
    kind: "work",
    title: id,
    intent: "Test graph theme rendering.",
    humanSummary: "Theme test node.",
    status,
    contract: {
      expectedArtifact: "Theme regression.",
      allowedTools: [],
      acceptanceCriteria: ["Colors are theme driven."],
      humanSummary: "Verify graph theme colors.",
    },
    baselineGoalVersionId: "goal-v1",
    activeGoalVersionId: "goal-v1",
    dependsOnNodeIds: [],
    coordinates: {
      depth: 1,
      branch: 0,
      abstractionLevel: 1,
      driftDistance: 0,
      baselineDriftDistance: 0,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buttonText(children: unknown): string {
  if (Array.isArray(children)) return children.map(buttonText).join("");
  return String(children ?? "");
}

function renderedNodeColor(props: ForceGraphMockProps, node: RenderedGraphNode): string {
  const object = props.nodeThreeObject(node);
  const color = object.children[0]?.material?.color?.getHexString?.();
  return color ? `#${color}` : "";
}

describe("GraphCanvas", () => {
  it("lets users switch execution graph color themes", () => {
    const readyNode = makeNode("node-ready", "ready");
    const completedNode = makeNode("node-completed", "completed");
    const revisesEdge: Edge = {
      id: "edge-revises",
      graphId: "graph-1",
      sourceNodeId: readyNode.id,
      targetNodeId: completedNode.id,
      kind: "revises",
      createdAt: NOW,
    };
    useStore.setState({
      nodes: [readyNode, completedNode],
      edges: [revisesEdge],
      graphs: [],
      activeGraphId: null,
      selectedNodeId: readyNode.id,
      filterStatus: null,
      filterBranch: null,
      graphQuality: "standard",
      graphDetailMode: "auto",
      showSupersededNodes: true,
      showRevisionBranches: true,
      showReplanBranches: true,
      focusActivePath: false,
      collapseSupersededBranches: false,
      collapseRevisionClusters: false,
      showActiveNeighborhoodOnly: false,
      uiMode: "developer",
      driftSummary: "",
    });

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<GraphCanvas />);
    });

    const initialGraphProps = forceGraphMock.props;
    expect(initialGraphProps).toBeTruthy();
    if (!initialGraphProps) throw new Error("ForceGraph mock did not render.");
    expect(initialGraphProps.backgroundColor).toBe(GRAPH_THEMES.signal.background);
    expect(renderedNodeColor(initialGraphProps, initialGraphProps.graphData.nodes[0])).toBe(
      GRAPH_THEMES.signal.executionStatus.ready
    );
    expect(initialGraphProps.linkColor(initialGraphProps.graphData.links[0])).toBe(GRAPH_THEMES.signal.executionRelation.revises);

    const highContrastButton = renderer!.root
      .findAllByType("button")
      .find((button) => buttonText(button.props.children) === "High contrast");
    expect(highContrastButton).toBeTruthy();

    act(() => {
      highContrastButton!.props.onClick();
    });

    const switchedGraphProps = forceGraphMock.props;
    expect(switchedGraphProps).toBeTruthy();
    if (!switchedGraphProps) throw new Error("ForceGraph mock did not rerender.");
    expect(switchedGraphProps.backgroundColor).toBe(GRAPH_THEMES.highContrast.background);
    expect(renderedNodeColor(switchedGraphProps, switchedGraphProps.graphData.nodes[0])).toBe(
      GRAPH_THEMES.highContrast.executionStatus.ready
    );
    expect(switchedGraphProps.linkColor(switchedGraphProps.graphData.links[0])).toBe(GRAPH_THEMES.highContrast.executionRelation.revises);
    expect(JSON.stringify(renderer!.toJSON())).toContain('"aria-label":"Execution graph theme"');
  });
});
