import { describe, expect, it } from "vitest";
import {
  buildDocsHubSummaries,
  buildDocsLinkedToCodeSummaries,
  isDocsOrientedQuery,
  renderDocsGraphMarkdown,
  scoreDocSectionForQuery,
} from "./graphDocs.js";
import type { UnifiedCodeGraph } from "./codeGraph.js";

function makeGraph(nodes: UnifiedCodeGraph["nodes"], edges: UnifiedCodeGraph["edges"] = []): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-18T00:00:00.000Z",
    nodes,
    edges,
    activeScannerIds: ["generic"],
    diagnostics: [],
  };
}

describe("graphDocs", () => {
  it("detects docs-oriented queries and scores doc sections", () => {
    expect(isDocsOrientedQuery("how does checkout work")).toBe(true);
    const score = scoreDocSectionForQuery(
      {
        id: "section-1",
        kind: "doc_section",
        label: "Checkout flow (doc_section)",
        path: "docs/guide.md",
        metadata: { scannerDocSectionSlug: "checkout-flow" },
      },
      ["checkout", "flow"]
    );
    expect(score).toBeGreaterThan(0);
  });

  it("renders docs hub and linkage sections", () => {
    const graph = makeGraph(
      [
        { id: "doc-1", kind: "doc_file", label: "docs/guide.md", path: "docs/guide.md" },
        { id: "section-1", kind: "doc_section", label: "Architecture (doc_section)", path: "docs/guide.md" },
        { id: "symbol-1", kind: "symbol", label: "CheckoutService (class)", path: "src/service.ts" },
      ],
      [
        {
          id: "edge-1",
          sourceNodeId: "section-1",
          targetNodeId: "symbol-1",
          kind: "documents",
          provenance: "ambiguous",
          source: "docs",
          confidence: 0.45,
          metadata: { scannerRelation: "doc_code_ref" },
        },
      ]
    );
    expect(buildDocsHubSummaries(graph)).toHaveLength(1);
    expect(buildDocsLinkedToCodeSummaries(graph)).toHaveLength(1);
    const markdown = renderDocsGraphMarkdown(graph).join("\n");
    expect(markdown).toContain("## Docs hubs");
    expect(markdown).toContain("## Docs linked to code");
    expect(markdown).toContain("src/service.ts");
  });
});