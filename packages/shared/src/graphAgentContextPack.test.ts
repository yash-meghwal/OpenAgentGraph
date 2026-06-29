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

  it("applies docs query mode intent to agent context packs", () => {
    const pack = buildGraphAgentContextPack(makeGraph(), {
      goal: "architecture guide authentication",
      queryMode: "docs",
    });
    expect(pack.queryIntent?.requestedMode).toBe("docs");
    expect(pack.queryIntent?.effectiveMode).toBe("docs");
    expect(pack.relevantDocs.length).toBeGreaterThan(0);
    expect(pack.readFirstNodes[0]?.kind).toMatch(/doc_file|doc_section/);
  });

  it("places matching code before docs in code query mode context packs", () => {
    const pack = buildGraphAgentContextPack(makeGraph(), {
      goal: "fix auth bug login",
      queryMode: "code",
    });
    expect(pack.readFirstNodes[0]?.kind).toMatch(/symbol|code_file/);
  });

  it("preserves balanced mode mixed ordering with code context first", () => {
    const pack = buildGraphAgentContextPack(makeGraph(), {
      goal: "fix auth bug",
      queryMode: "balanced",
    });
    expect(pack.readFirstNodes.length).toBeGreaterThan(0);
    const kinds = pack.readFirstNodes.map((node) => node.kind);
    expect(new Set(kinds).size).toBeGreaterThan(0);
  });

  it("includes context noise summary in every context pack", () => {
    const pack = buildGraphAgentContextPack(makeGraph(), { goal: "auth" });
    expect(pack.contextNoise).toBeDefined();
    expect(typeof pack.contextNoise.score).toBe("number");
    expect(Array.isArray(pack.contextNoise.noiseItems)).toBe(true);
  });

  it("includes task verification plan when includeVerification is enabled", () => {
    const pack = buildGraphAgentContextPack(makeGraph(), {
      goal: "fix auth bug",
      includeVerification: true,
      harnessMetadata: {
        packageScripts: {
          test: "vitest run",
          "verify:graph": "node scripts/verify-graph.js",
        },
      },
    });

    expect(pack.taskVerification).toBeDefined();
    expect(pack.taskVerification?.verificationPlan).toBeDefined();
    expect(pack.taskVerification?.suggestedCommands.length).toBeGreaterThan(0);
    expect(pack.taskVerification?.suggestedCommands.every((command) => command.length > 0)).toBe(true);
  });
});