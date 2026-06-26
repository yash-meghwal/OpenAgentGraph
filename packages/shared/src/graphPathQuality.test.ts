import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph, UnifiedCodeGraphEdge } from "./codeGraph.js";
import { findGraphPath } from "./graphQueryEngine.js";
import {
  classifyGraphPathEdgeForQuality,
  evaluateGraphPathQuality,
  normalizeGraphPathEdgeRelation,
} from "./graphPathQuality.js";

function makeEdge(
  overrides: Partial<UnifiedCodeGraphEdge> & Pick<UnifiedCodeGraphEdge, "id" | "sourceNodeId" | "targetNodeId">
): UnifiedCodeGraphEdge {
  return {
    kind: "references",
    provenance: "extracted",
    ...overrides,
  };
}

function makeMinimalGraph(edges: UnifiedCodeGraphEdge[]): UnifiedCodeGraph {
  const nodeIds = new Set<string>();
  for (const edge of edges) {
    nodeIds.add(edge.sourceNodeId);
    nodeIds.add(edge.targetNodeId);
  }
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [...nodeIds].map((id) => ({
      id,
      kind: "symbol" as const,
      label: id,
      path: `${id}.cs`,
    })),
    edges,
  };
}

describe("graphPathQuality", () => {
  it("classifies constructor edges as structural, not semantic", () => {
    const edge = makeEdge({
      id: "e1",
      sourceNodeId: "a",
      targetNodeId: "b",
      kind: "references",
      metadata: { scannerRelation: "semantic_constructor" },
    });
    expect(normalizeGraphPathEdgeRelation(edge)).toBe("constructor");
    expect(classifyGraphPathEdgeForQuality(edge)).toBe("structural");
  });

  it("classifies semantic_calls as semantic", () => {
    const edge = makeEdge({
      id: "e1",
      sourceNodeId: "a",
      targetNodeId: "b",
      metadata: { scannerRelation: "semantic_calls" },
    });
    expect(classifyGraphPathEdgeForQuality(edge)).toBe("semantic");
  });

  it("classifies source_file as structural", () => {
    const edge = makeEdge({
      id: "e1",
      sourceNodeId: "a",
      targetNodeId: "b",
      kind: "belongs_to",
      metadata: { scannerRelation: "source_file" },
    });
    expect(classifyGraphPathEdgeForQuality(edge)).toBe("structural");
  });

  it("reports constructor-only path as structural with zero semantic edges", () => {
    const edge = makeEdge({
      id: "e1",
      sourceNodeId: "order",
      targetNodeId: "payment",
      metadata: { scannerRelation: "semantic_constructor" },
    });
    const graph = makeMinimalGraph([edge]);
    const metrics = evaluateGraphPathQuality(graph, {
      from: "OrderService",
      to: "PaymentClient",
      found: true,
      nodes: graph.nodes,
      edges: [edge],
    });
    expect(metrics.semanticEdgeCount).toBe(0);
    expect(metrics.structuralEdgeCount).toBe(1);
    expect(metrics.directnessScore).toBeLessThan(1);
  });

  it("scores mixed call + constructor path lower than pure call path", () => {
    const callEdge = makeEdge({
      id: "e-call",
      sourceNodeId: "a",
      targetNodeId: "b",
      metadata: { scannerRelation: "semantic_calls" },
    });
    const ctorEdge = makeEdge({
      id: "e-ctor",
      sourceNodeId: "a",
      targetNodeId: "c",
      metadata: { scannerRelation: "semantic_constructor" },
    });
    const graph = makeMinimalGraph([callEdge, ctorEdge]);
    const pureCall = evaluateGraphPathQuality(graph, {
      from: "a",
      to: "b",
      found: true,
      nodes: graph.nodes.filter((node) => node.id === "a" || node.id === "b"),
      edges: [callEdge],
    });
    const mixed = evaluateGraphPathQuality(graph, {
      from: "a",
      to: "c",
      found: true,
      nodes: graph.nodes.filter((node) => node.id === "a" || node.id === "c"),
      edges: [ctorEdge],
    });
    expect(pureCall.semanticEdgeCount).toBe(1);
    expect(pureCall.structuralEdgeCount).toBe(0);
    expect(mixed.semanticEdgeCount).toBe(0);
    expect(mixed.structuralEdgeCount).toBe(1);
    expect(mixed.directnessScore).toBeLessThan(pureCall.directnessScore);
  });

  it("annotates rejected unweighted structural shortcut with real edge metrics", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["dotnet"],
      diagnostics: [],
      nodes: [
        { id: "sym:a", kind: "symbol", label: "ServiceA (class)", path: "Services/ServiceA.cs" },
        { id: "sym:m1", kind: "symbol", label: "ServiceA.Run (method)", path: "Services/ServiceA.cs" },
        { id: "sym:m2", kind: "symbol", label: "ServiceB.Handle (method)", path: "Services/ServiceB.cs" },
        { id: "sym:b", kind: "symbol", label: "ServiceB (class)", path: "Services/ServiceB.cs" },
        { id: "comm:hub", kind: "community", label: "shared-hub", path: "shared-hub" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "sym:a", targetNodeId: "sym:m1", kind: "belongs_to", provenance: "extracted", metadata: { scannerRelation: "source_file" } },
        { id: "e2", sourceNodeId: "sym:m1", targetNodeId: "sym:m2", kind: "references", provenance: "extracted", metadata: { scannerRelation: "semantic_calls" } },
        { id: "e3", sourceNodeId: "sym:m2", targetNodeId: "sym:b", kind: "belongs_to", provenance: "extracted", metadata: { scannerRelation: "source_file" } },
        { id: "e4", sourceNodeId: "sym:a", targetNodeId: "comm:hub", kind: "belongs_to", provenance: "extracted" },
        { id: "e5", sourceNodeId: "comm:hub", targetNodeId: "sym:b", kind: "belongs_to", provenance: "extracted" },
      ],
    };
    const result = findGraphPath(graph, "ServiceA", "ServiceB", {
      mode: "balanced",
      explainRanking: true,
    });
    expect(result.found).toBe(true);
    expect(result.nodes.some((node) => node.kind === "community")).toBe(false);
    const hopAlternative = result.explanation?.penalizedAlternatives.find((entry) =>
      entry.summary.includes("Shorter hop-count path")
    );
    expect(hopAlternative).toBeDefined();
    expect(hopAlternative?.semanticEdgeCount).toBe(0);
    expect(hopAlternative?.structuralEdgeCount).toBeGreaterThan(0);
    expect(typeof hopAlternative?.directnessScore).toBe("number");
    expect(hopAlternative?.decidingPenalty).toBe("structural_bridge_penalty");
  });

  it("uses the actual BFS edge for parallel connections when annotating rejected alternatives", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["dotnet"],
      diagnostics: [],
      nodes: [
        { id: "sym:a", kind: "symbol", label: "ServiceA (class)", path: "Services/ServiceA.cs" },
        { id: "sym:c", kind: "community", label: "shared-hub", path: "shared-hub" },
        { id: "sym:b", kind: "symbol", label: "ServiceB (class)", path: "Services/ServiceB.cs" },
        { id: "sym:m1", kind: "symbol", label: "ServiceA.Run (method)", path: "Services/ServiceA.cs" },
        { id: "sym:m2", kind: "symbol", label: "ServiceB.Handle (method)", path: "Services/ServiceB.cs" },
      ],
      edges: [
        { id: "z-semantic", sourceNodeId: "sym:a", targetNodeId: "sym:c", kind: "references", provenance: "extracted", metadata: { scannerRelation: "semantic_calls" } },
        { id: "a-structural", sourceNodeId: "sym:a", targetNodeId: "sym:c", kind: "belongs_to", provenance: "extracted", metadata: { scannerRelation: "source_file" } },
        { id: "e-cb", sourceNodeId: "sym:c", targetNodeId: "sym:b", kind: "references", provenance: "extracted", metadata: { scannerRelation: "semantic_calls" } },
        { id: "e-am1", sourceNodeId: "sym:a", targetNodeId: "sym:m1", kind: "belongs_to", provenance: "extracted", metadata: { scannerRelation: "source_file" } },
        { id: "e-m1m2", sourceNodeId: "sym:m1", targetNodeId: "sym:m2", kind: "references", provenance: "extracted", metadata: { scannerRelation: "semantic_calls" } },
        { id: "e-m2b", sourceNodeId: "sym:m2", targetNodeId: "sym:b", kind: "belongs_to", provenance: "extracted", metadata: { scannerRelation: "source_file" } },
      ],
    };
    const result = findGraphPath(graph, "ServiceA", "ServiceB", {
      mode: "balanced",
      explainRanking: true,
    });
    expect(result.found).toBe(true);
    expect(result.nodes.some((node) => node.kind === "community")).toBe(false);
    const hopAlternative = result.explanation?.penalizedAlternatives.find((entry) =>
      entry.summary.includes("Shorter hop-count path")
    );
    expect(hopAlternative).toBeDefined();
    expect(hopAlternative?.semanticEdgeCount).toBeGreaterThan(0);
    expect(hopAlternative?.structuralEdgeCount).toBe(0);
  });
});