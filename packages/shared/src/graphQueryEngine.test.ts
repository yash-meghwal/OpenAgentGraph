import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  explainGraphNode,
  findGraphPath,
  queryUnifiedCodeGraph,
  resolveGraphNode,
} from "./graphQueryEngine.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      { id: "file:xaml", kind: "code_file", label: "Views/MainView.xaml", path: "Views/MainView.xaml" },
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
      { id: "sym:svc", kind: "symbol", label: "PlaybackService (class)", path: "Services/PlaybackService.cs" },
      { id: "comm:ui", kind: "community", label: "ui", path: "SampleMediaPlayer.App" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "file:xaml", targetNodeId: "sym:vm", kind: "references", provenance: "inferred", label: "View -> MainViewModel" },
      { id: "e2", sourceNodeId: "sym:vm", targetNodeId: "sym:svc", kind: "depends_on", provenance: "extracted", label: "using service" },
      { id: "e3", sourceNodeId: "file:xaml", targetNodeId: "comm:ui", kind: "belongs_to", provenance: "extracted" },
    ],
  };
}

describe("graph query engine", () => {
  it("queries related nodes with BFS around matching seeds", () => {
    const result = queryUnifiedCodeGraph(makeGraph(), "MainViewModel playback", { budget: 10 });
    expect(result.seeds.map((node) => node.id)).toContain("sym:vm");
    expect(result.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["sym:vm", "sym:svc"]));
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it("finds a path between view and service symbols", () => {
    const result = findGraphPath(makeGraph(), "MainView.xaml", "PlaybackService");
    expect(result.found).toBe(true);
    expect(result.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["file:xaml", "sym:vm", "sym:svc"]));
  });

  it("explains a node with neighbors and summary", () => {
    const node = resolveGraphNode(makeGraph(), "MainViewModel");
    expect(node?.id).toBe("sym:vm");
    const explained = explainGraphNode(makeGraph(), "MainViewModel");
    expect(explained.resolved).toBe(true);
    expect(explained.neighbors.map((neighbor) => neighbor.id)).toEqual(expect.arrayContaining(["sym:svc", "file:xaml"]));
    expect(explained.summary).toContain("MainViewModel");
  });
});