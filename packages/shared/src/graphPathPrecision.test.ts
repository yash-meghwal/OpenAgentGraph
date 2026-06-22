import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { findGraphPath } from "./graphQueryEngine.js";

describe("graph path precision", () => {
  it("still allows docs when a doc endpoint is selected", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["generic"],
      diagnostics: [],
      nodes: [
        { id: "doc:sec", kind: "doc_section", label: "Architecture (doc_section)", path: "docs/guide.md" },
        { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
      ],
      edges: [
        {
          id: "e1",
          sourceNodeId: "doc:sec",
          targetNodeId: "sym:vm",
          kind: "documents",
          provenance: "inferred",
          source: "docs",
          confidence: 0.8,
          metadata: { scannerRelation: "doc_code_ref" },
        },
      ],
    };
    const result = findGraphPath(graph, "Architecture", "MainViewModel", { mode: "balanced" });
    expect(result.found).toBe(true);
    expect(result.nodes.some((node) => node.kind === "doc_section")).toBe(true);
  });
});