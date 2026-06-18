import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { evaluateAnalyzerReleaseGates, evaluateSemanticLiteEdgeKindPreservation } from "./graphAnalyzerGates.js";

function baseGraph(overrides: Partial<UnifiedCodeGraph> = {}): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/repo",
    generatedAt: "2026-06-17T00:00:00.000Z",
    nodes: [],
    edges: [],
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    ...overrides,
  };
}

describe("analyzer release gates", () => {
  it("flags dangling semantic edges", () => {
    const graph = baseGraph({
      nodes: [{ id: "a", kind: "symbol", label: "A" }],
      edges: [{
        id: "edge-1",
        sourceNodeId: "a",
        targetNodeId: "missing",
        kind: "depends_on",
        provenance: "extracted",
        metadata: { scannerResolution: "semantic", scannerRelation: "calls" },
      }],
    });

    const result = evaluateAnalyzerReleaseGates({ graph });
    expect(result.ok).toBe(false);
    expect(result.danglingSemanticEdges).toEqual(["edge-1"]);
  });

  it("requires explicit external nodes for unresolved imports", () => {
    const graph = baseGraph({
      nodes: [
        { id: "file-a", kind: "code_file", label: "a.rb", path: "a.rb" },
        { id: "sym-b", kind: "symbol", label: "B" },
      ],
      edges: [{
        id: "edge-import",
        sourceNodeId: "file-a",
        targetNodeId: "sym-b",
        kind: "depends_on",
        provenance: "extracted",
        metadata: { scannerRelation: "imports", scannerResolution: "unresolved" },
      }],
    });

    const result = evaluateAnalyzerReleaseGates({ graph });
    expect(result.ok).toBe(false);
    expect(result.importEdgesWithoutExternalNodes).toEqual(["edge-import"]);
  });

  it("requires unavailable analyzer fallback visibility in handoff or diagnostics", () => {
    const graph = baseGraph({
      analyzers: [{
        id: "java-javac",
        label: "Java semantic-lite analyzer",
        requiredRuntime: "JDK",
        status: "unavailable",
        fallbackReason: "JDK not found on PATH.",
        autoBuildCapable: false,
      }],
    });

    const missing = evaluateAnalyzerReleaseGates({ graph });
    expect(missing.ok).toBe(false);
    expect(missing.missingFallbackAnalyzers).toEqual(["java-javac"]);

    const visible = evaluateAnalyzerReleaseGates({
      graph,
      handoffMarkdown: "Java semantic-lite analyzer: unavailable (JDK not found on PATH.).",
    });
    expect(visible.missingFallbackAnalyzers).toEqual([]);
  });

  it("requires semantic-lite extends/implements edges to preserve unified edge kinds", () => {
    const passing = evaluateSemanticLiteEdgeKindPreservation({
      ...baseGraph(),
      edges: [
        {
          id: "edge-extends",
          sourceNodeId: "a",
          targetNodeId: "b",
          kind: "inherits",
          provenance: "extracted",
          metadata: { scannerRelation: "extends", scannerResolution: "semantic-lite" },
        },
        {
          id: "edge-implements",
          sourceNodeId: "a",
          targetNodeId: "c",
          kind: "implements",
          provenance: "extracted",
          metadata: { scannerRelation: "implements", scannerResolution: "semantic-lite" },
        },
      ],
      nodes: [
        { id: "a", kind: "symbol", label: "A" },
        { id: "b", kind: "symbol", label: "B" },
        { id: "c", kind: "symbol", label: "C" },
      ],
    });
    expect(passing.ok).toBe(true);

    const failing = evaluateSemanticLiteEdgeKindPreservation({
      ...baseGraph(),
      edges: [{
        id: "edge-extends",
        sourceNodeId: "a",
        targetNodeId: "b",
        kind: "depends_on",
        provenance: "extracted",
        metadata: { scannerRelation: "extends", scannerResolution: "semantic-lite" },
      }],
      nodes: [
        { id: "a", kind: "symbol", label: "A" },
        { id: "b", kind: "symbol", label: "B" },
      ],
    });
    expect(failing.ok).toBe(false);
  });

  it("rejects analyzer diagnostics that may include source body fields", () => {
    const graph = baseGraph({
      analyzers: [{
        id: "php-tokenizer",
        label: "PHP tokenizer helper",
        requiredRuntime: "php CLI",
        status: "unavailable",
        fallbackReason: "php CLI unavailable.",
        autoBuildCapable: false,
        body: "function secret() { return 1; }",
      } as UnifiedCodeGraph["analyzers"] extends (infer T)[] | undefined ? T : never],
    });

    const result = evaluateAnalyzerReleaseGates({ graph });
    expect(result.ok).toBe(false);
    expect(result.analyzerDiagnosticsWithBodies).toEqual(["php-tokenizer"]);
  });
});