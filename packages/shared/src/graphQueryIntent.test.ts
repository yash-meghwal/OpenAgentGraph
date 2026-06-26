import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { queryUnifiedCodeGraph } from "./graphQueryEngine.js";
import {
  inferGraphQueryShape,
  parseGraphQueryIntentMode,
  resolveEffectiveGraphQueryIntentMode,
} from "./graphQueryIntent.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["typescript"],
    diagnostics: [],
    nodes: [
      { id: "sym:controller", kind: "symbol", label: "CheckoutController (class)", path: "src/checkout/controller.ts" },
      { id: "sym:service", kind: "symbol", label: "CheckoutService (class)", path: "src/checkout/service.ts" },
      { id: "doc:arch", kind: "doc_file", label: "docs/architecture.md", path: "docs/architecture.md" },
      { id: "doc:section", kind: "doc_section", label: "Checkout flow (doc_section)", path: "docs/architecture.md" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "sym:controller", targetNodeId: "sym:service", kind: "depends_on", provenance: "extracted" },
      { id: "e2", sourceNodeId: "doc:section", targetNodeId: "sym:service", kind: "documents", provenance: "inferred" },
    ],
  };
}

describe("graph query intent", () => {
  it("rejects unknown query modes", () => {
    expect(() => parseGraphQueryIntentMode("semantic")).toThrow(/Unknown graph query mode/);
  });

  it("infers docs-oriented balanced queries deterministically", () => {
    expect(inferGraphQueryShape("how does checkout work")).toBe("docs_oriented");
    expect(resolveEffectiveGraphQueryIntentMode("how does checkout work", "balanced")).toBe("docs");
  });

  it("infers code-oriented balanced queries deterministically", () => {
    expect(inferGraphQueryShape("CheckoutController service")).toBe("code_oriented");
    expect(resolveEffectiveGraphQueryIntentMode("CheckoutController service", "balanced")).toBe("code");
  });

  it("ranks code mode toward symbols and away from documentation", () => {
    const result = queryUnifiedCodeGraph(makeGraph(), "CheckoutController service", {
      budget: 8,
      intentMode: "code",
    });
    expect(result.intent?.effectiveMode).toBe("code");
    expect(result.seeds[0]?.label).toMatch(/CheckoutController|CheckoutService/i);
    expect(result.seeds[0]?.kind).toBe("symbol");
  });

  it("ranks docs mode toward documentation surfaces", () => {
    const result = queryUnifiedCodeGraph(makeGraph(), "architecture checkout guide", {
      budget: 8,
      intentMode: "docs",
    });
    expect(result.intent?.effectiveMode).toBe("docs");
    expect(result.seeds[0]?.kind).toMatch(/doc_file|doc_section/);
  });

  it("ranks matching code before docs in explicit code mode", () => {
    const result = queryUnifiedCodeGraph(makeGraph(), "CheckoutController service", {
      budget: 8,
      intentMode: "code",
    });
    expect(result.seeds[0]?.kind).toBe("symbol");
    expect(result.seeds[0]?.label).toMatch(/CheckoutController|CheckoutService/i);
    expect(result.intent?.fallbackUsed).toBe(false);
    expect(result.intent?.topResultKinds[0]).not.toBe("doc_section");
  });

  it("does not promote zero-base-score code nodes via surface bonus", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      nodes: [
        { id: "sym:unrelated", kind: "symbol", label: "MpvPlayerAdapter (class)", path: "src/player.cs" },
        { id: "doc:section", kind: "doc_section", label: "Checkout flow (doc_section)", path: "docs/architecture.md" },
        { id: "doc:arch", kind: "doc_file", label: "docs/architecture.md", path: "docs/architecture.md" },
      ],
      edges: [],
    };
    const result = queryUnifiedCodeGraph(graph, "architecture checkout guide", {
      budget: 8,
      intentMode: "code",
    });
    expect(result.seeds[0]?.kind).toMatch(/doc_file|doc_section/);
    expect(result.intent?.fallbackUsed).toBe(true);
    expect(result.intent?.appliedPenalties).toContain("fallback_surface");
    expect(result.intent?.appliedPenalties).toContain("doc_surface_penalty");
    expect(result.seeds.some((seed) => seed.label.includes("MpvPlayerAdapter"))).toBe(false);
  });

  it("returns matching code only without docs fallback when code matches", () => {
    const result = queryUnifiedCodeGraph(makeGraph(), "CheckoutController", {
      budget: 8,
      intentMode: "code",
    });
    expect(result.seeds.every((seed) => seed.kind === "symbol")).toBe(true);
    expect(result.intent?.fallbackUsed).toBe(false);
    expect(result.intent?.docResultCount).toBe(0);
  });

  it("ranks matching code before strongly matching docs in code mode", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      nodes: [
        { id: "sym:auth", kind: "symbol", label: "AuthenticationService (class)", path: "src/auth/service.ts" },
        {
          id: "doc:section",
          kind: "doc_section",
          label: "Authentication architecture guide (doc_section)",
          path: "docs/authentication.md",
        },
        { id: "doc:file", kind: "doc_file", label: "docs/authentication.md", path: "docs/authentication.md" },
      ],
      edges: [],
    };
    const result = queryUnifiedCodeGraph(graph, "authentication service architecture guide", {
      budget: 8,
      intentMode: "code",
    });
    expect(result.seeds[0]?.label).toMatch(/AuthenticationService/i);
    expect(result.seeds[0]?.kind).toBe("symbol");
    expect(result.intent?.fallbackUsed).toBe(false);
  });

  it("falls back to matching code when docs mode has only unrelated docs", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      nodes: [
        { id: "sym:auth", kind: "symbol", label: "AuthenticationService (class)", path: "src/auth/service.ts" },
        {
          id: "doc:unrelated",
          kind: "doc_section",
          label: "Deployment runbook (doc_section)",
          path: "docs/runbook.md",
        },
        { id: "doc:file", kind: "doc_file", label: "docs/runbook.md", path: "docs/runbook.md" },
      ],
      edges: [],
    };
    const result = queryUnifiedCodeGraph(graph, "AuthenticationService fix", {
      budget: 8,
      intentMode: "docs",
    });
    expect(result.seeds[0]?.label).toMatch(/AuthenticationService/i);
    expect(result.seeds[0]?.kind).toBe("symbol");
    expect(result.intent?.fallbackUsed).toBe(true);
    expect(result.intent?.appliedPenalties).toContain("fallback_surface");
  });

  it("does not place an unrelated doc before a weak code fallback", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      nodes: [
        { id: "sym:id", kind: "symbol", label: "Id (class)", path: "src/id.ts" },
        {
          id: "doc:unrelated",
          kind: "doc_section",
          label: "Deployment runbook (doc_section)",
          path: "docs/runbook.md",
        },
      ],
      edges: [],
    };
    const result = queryUnifiedCodeGraph(graph, "Id fix", {
      budget: 8,
      intentMode: "docs",
    });
    expect(result.seeds.map((seed) => seed.id)).toEqual(["sym:id"]);
    expect(result.intent?.fallbackUsed).toBe(true);
    expect(result.intent?.docResultCount).toBe(0);
  });

  it("preserves a weak documentation match as the code-mode fallback", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      nodes: [
        { id: "sym:unrelated", kind: "symbol", label: "Player (class)", path: "src/player.ts" },
        { id: "doc:auth", kind: "doc_file", label: "auth.md", path: "docs/auth.md" },
      ],
      edges: [],
    };
    const result = queryUnifiedCodeGraph(graph, "auth", {
      budget: 8,
      intentMode: "code",
    });
    expect(result.seeds.map((seed) => seed.id)).toEqual(["doc:auth"]);
    expect(result.intent?.fallbackUsed).toBe(true);
    expect(result.intent?.appliedPenalties).toEqual(
      expect.arrayContaining(["doc_surface_penalty", "fallback_surface"])
    );
  });
});
