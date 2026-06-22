import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { buildGraphAgentContextPack } from "./graphAgentContextPack.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "C:\\Users\\demo\\project",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["typescript"],
    nodes: [
      { id: "file:auth", kind: "code_file", label: "auth.ts", path: "src/auth.ts" },
      { id: "sym:login", kind: "symbol", label: "login", path: "src/auth.ts" },
      { id: "doc:readme", kind: "doc_file", label: "README.md", path: "README.md" },
      { id: "docsec:auth", kind: "doc_section", label: "Authentication", path: "README.md" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "sym:login", targetNodeId: "file:auth", kind: "belongs_to", provenance: "extracted", source: "typescript" },
      { id: "e2", sourceNodeId: "docsec:auth", targetNodeId: "sym:login", kind: "documents", provenance: "inferred", source: "docs", confidence: 0.8 },
    ],
    diagnostics: [],
  };
}

describe("graphAgentContextPack", () => {
  it("builds a bounded context pack for a goal", () => {
    const pack = buildGraphAgentContextPack(makeGraph(), {
      goal: "fix auth bug",
      budget: 8000,
      redactRoot: true,
    });
    expect(pack.status).toBe("graph_context_ready");
    expect(pack.readFirstNodes.length).toBeGreaterThan(0);
    expect(pack.estimatedSize).toBeLessThanOrEqual(8000);
    expect(JSON.stringify(pack)).not.toContain("C:\\\\Users");
  });

  it("includes retrieval ids on read-first nodes", () => {
    const pack = buildGraphAgentContextPack(makeGraph(), { goal: "auth" });
    expect(pack.readFirstNodes[0]?.retrievalId).toMatch(/^oag:node:/);
  });
});