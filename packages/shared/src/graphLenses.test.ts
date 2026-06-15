import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  buildGraphGodNodeSummaries,
  buildGraphHealthSummary,
  buildGraphLensSummaries,
  filterUnifiedGraphByLens,
  graphLensIdsForPath,
  recommendPrimaryGraphLens,
} from "./graphLenses.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-15T00:00:00.000Z",
    activeScannerIds: ["dotnet", "typescript"],
    diagnostics: ["Python: T1 structural indexing; AST-level semantic edges not yet enabled."],
    nodes: [
      { id: "comm:app", kind: "community", label: "OpenViewPlayer.App", path: "OpenViewPlayer.App" },
      { id: "file:xaml", kind: "code_file", label: "Views/MainView.xaml", path: "OpenViewPlayer.App/Views/MainView.xaml" },
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "OpenViewPlayer.App/ViewModels/MainViewModel.cs" },
      { id: "file:svc", kind: "code_file", label: "Services/PlaybackService.cs", path: "OpenViewPlayer.Core/Services/PlaybackService.cs" },
      { id: "file:test", kind: "code_file", label: "MainViewModelTests.cs", path: "OpenViewPlayer.Tests/MainViewModelTests.cs" },
      { id: "file:tf", kind: "config_file", label: "main.tf", path: "infra/main.tf" },
      { id: "file:doc", kind: "doc_file", label: "README.md", path: "README.md" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "file:xaml", targetNodeId: "sym:vm", kind: "references", provenance: "extracted" },
      { id: "e2", sourceNodeId: "file:xaml", targetNodeId: "comm:app", kind: "belongs_to", provenance: "extracted" },
      { id: "e3", sourceNodeId: "file:svc", targetNodeId: "sym:vm", kind: "depends_on", provenance: "inferred" },
    ],
  };
}

describe("graph lenses", () => {
  it("classifies paths into deterministic task lenses", () => {
    expect(graphLensIdsForPath("app/page.tsx")).toContain("frontend");
    expect(graphLensIdsForPath("OpenViewPlayer.Tests/MainViewModelTests.cs")).toContain("tests");
    expect(graphLensIdsForPath("infra/main.tf")).toContain("infra");
    expect(graphLensIdsForPath("myapp/models.py")).toContain("database");
  });

  it("filters unified graphs by lens without leaking cross-lens edges", () => {
    const filtered = filterUnifiedGraphByLens(makeGraph(), "frontend");
    expect(filtered.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["file:xaml", "sym:vm"]));
    expect(filtered.nodes.some((node) => node.id === "file:test")).toBe(false);
    expect(filtered.edges.every((edge) =>
      filtered.nodes.some((node) => node.id === edge.sourceNodeId)
      && filtered.nodes.some((node) => node.id === edge.targetNodeId)
    )).toBe(true);
  });

  it("builds lens summaries, god nodes, and health badges", () => {
    const graph = makeGraph();
    const summaries = buildGraphLensSummaries(graph);
    expect(summaries.find((summary) => summary.id === "frontend")?.fileCount).toBeGreaterThan(0);
    expect(buildGraphGodNodeSummaries(graph).length).toBeGreaterThan(0);
    expect(buildGraphHealthSummary(graph).badges.length).toBeGreaterThan(0);
  });

  it("recommends a primary lens from kernel profile", () => {
    expect(
      recommendPrimaryGraphLens(makeGraph(), {
        schemaVersion: "1",
        root: "/workspace",
        effectiveRoots: ["/workspace"],
        primaryType: "django-app",
        secondaryTypes: [],
        typeSignals: [],
        sourceRoots: ["."],
        markerPaths: ["manage.py"],
        activeScannerIds: ["python"],
        ignoreRules: [],
        sourceExtensionCounts: { ".py": 2 },
        skippedCountsByReason: {},
        warnings: [],
      })
    ).toBe("database");
  });
});