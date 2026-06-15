import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { renderUnifiedGraphHandoffReport, renderUnifiedGraphWiki } from "./graphArtifacts.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: ["dotnet scanner is file-level only for some constructs."],
    nodes: [
      { id: "workspace", kind: "workspace", label: "workspace", metadata: { primaryType: "dotnet" } },
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
      { id: "file:cs", kind: "code_file", label: "ViewModels/MainViewModel.cs", path: "ViewModels/MainViewModel.cs" },
      { id: "comm:ui", kind: "community", label: "ui", path: "OpenViewPlayer.App" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "file:cs", targetNodeId: "sym:vm", kind: "declares", provenance: "extracted" },
    ],
  };
}

describe("graph artifacts", () => {
  it("renders wiki and handoff reports with read-these-first guidance", () => {
    const graph = makeGraph();
    const wiki = renderUnifiedGraphWiki(graph);
    const handoff = renderUnifiedGraphHandoffReport(graph, { handoffPath: "GRAPH_REPORT.md" });

    expect(wiki).toContain("# OpenAgentGraph Wiki");
    expect(wiki).toMatch(/MainViewModel/i);
    expect(handoff).toContain("# OpenAgentGraph Handoff");
    expect(handoff).toContain("## Read these first");
    expect(handoff).toContain("## OAG fusion checks");
    expect(handoff).toContain("## Agent context APIs");
    expect(handoff).toMatch(/MainViewModel/i);
    expect(handoff).not.toContain("/bin/");
  });
});