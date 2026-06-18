import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import type { ProductGraphEdge } from "./productGraph.js";
import {
  evaluateEdgeProvenanceReleaseGates,
  finalizeUnifiedGraphEdge,
  inferProductEdgeDerivationSource,
  mapProductTrustToProvenance,
  renderEdgeProvenanceMarkdown,
} from "./graphEdgeProvenance.js";

function makeGraph(edges: UnifiedCodeGraph["edges"]): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-17T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      { id: "sym:a", kind: "symbol", label: "A", path: "A.cs" },
      { id: "sym:b", kind: "symbol", label: "B", path: "B.cs" },
      { id: "comm:ui", kind: "community", label: "UI", path: "UI" },
    ],
    edges,
  };
}

describe("graph edge provenance", () => {
  it("maps Roslyn semantic edges to roslyn derivation source", () => {
    const productEdge: ProductGraphEdge = {
      id: "edge:1",
      sourceNodeId: "sym:a",
      targetNodeId: "sym:b",
      kind: "depends_on",
      trust: "extracted",
      metadata: {
        edgeDerivationSource: "roslyn",
        scannerResolution: "semantic",
        scannerLanguage: "csharp",
        scannerDotNetRoslynVersion: "1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(inferProductEdgeDerivationSource(productEdge)).toBe("roslyn");
    const unified = finalizeUnifiedGraphEdge({
      id: "e1",
      sourceNodeId: "sym:a",
      targetNodeId: "sym:b",
      kind: "references",
      provenance: mapProductTrustToProvenance(productEdge.trust),
    }, { productEdge });
    expect(unified.source).toBe("roslyn");
    expect(unified.confidence).toBeGreaterThan(0.8);
  });

  it("requires confidence on inferred edges in release gates", () => {
    const gate = evaluateEdgeProvenanceReleaseGates(makeGraph([
      {
        id: "e1",
        sourceNodeId: "sym:a",
        targetNodeId: "sym:b",
        kind: "references",
        provenance: "inferred",
        source: "generic",
      },
    ]));
    expect(gate.ok).toBe(false);
    expect(gate.missingConfidence).toContain("e1");
  });

  it("passes release gates when edges include source and confidence", () => {
    const gate = evaluateEdgeProvenanceReleaseGates(makeGraph([
      {
        id: "e1",
        sourceNodeId: "sym:a",
        targetNodeId: "sym:b",
        kind: "references",
        provenance: "extracted",
        source: "roslyn",
        confidence: 0.92,
      },
      {
        id: "e2",
        sourceNodeId: "sym:a",
        targetNodeId: "comm:ui",
        kind: "belongs_to",
        provenance: "extracted",
        source: "kernel",
        confidence: 0.92,
      },
    ]));
    expect(gate.ok).toBe(true);
  });

  it("renders provenance markdown for exports", () => {
    const markdown = renderEdgeProvenanceMarkdown(makeGraph([
      {
        id: "e1",
        sourceNodeId: "sym:a",
        targetNodeId: "sym:b",
        kind: "references",
        provenance: "extracted",
        source: "roslyn",
        confidence: 0.92,
      },
    ]));
    expect(markdown.join("\n")).toContain("## Edge provenance");
    expect(markdown.join("\n")).toContain("roslyn");
    expect(markdown.join("\n")).toContain("Extracted:");
    expect(markdown.join("\n")).not.toContain("No provenance summary recorded");
  });
});