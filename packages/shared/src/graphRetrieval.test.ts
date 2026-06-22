import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { encodeOagRetrievalId, parseOagRetrievalId, retrieveOagById } from "./graphRetrieval.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace/demo",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["typescript"],
    nodes: [
      { id: "file:app", kind: "code_file", label: "app.ts", path: "src/app.ts" },
      { id: "sym:main", kind: "symbol", label: "main", path: "src/app.ts" },
      { id: "comm:core", kind: "community", label: "Core", path: "src" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "sym:main", targetNodeId: "file:app", kind: "belongs_to", provenance: "extracted", source: "typescript" },
      { id: "e2", sourceNodeId: "file:app", targetNodeId: "comm:core", kind: "belongs_to", provenance: "extracted", source: "typescript" },
    ],
    diagnostics: [],
  };
}

describe("graphRetrieval", () => {
  it("round-trips retrieval ids", () => {
    const id = encodeOagRetrievalId("node", "sym:main");
    expect(parseOagRetrievalId(id)).toEqual({ kind: "node", parts: ["sym:main"] });
  });

  it("retrieves node metadata without source bodies", () => {
    const result = retrieveOagById(makeGraph(), encodeOagRetrievalId("node", "sym:main"));
    expect(result?.kind).toBe("node");
    expect(result?.label).toBe("main");
    expect(JSON.stringify(result)).not.toMatch(/function\s+main|export\s+default/);
  });

  it("returns null for unknown ids", () => {
    expect(retrieveOagById(makeGraph(), "bad-id")).toBeNull();
  });
});