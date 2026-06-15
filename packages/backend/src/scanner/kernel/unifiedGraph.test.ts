import { describe, expect, it } from "vitest";
import type { ProductGraphProjection } from "@openagentgraph/shared";
import { buildUnifiedCodeGraph } from "./unifiedGraph.js";
import type { WorkspaceKernelProfile } from "@openagentgraph/shared";

function makeProfile(overrides: Partial<WorkspaceKernelProfile> = {}): WorkspaceKernelProfile {
  return {
    schemaVersion: "1.0",
    root: "/workspace",
    effectiveRoots: ["/workspace"],
    primaryType: "typescript",
    secondaryTypes: [],
    typeSignals: [],
    sourceRoots: ["."],
    markerPaths: ["package.json"],
    activeScannerIds: ["typescript"],
    ignoreRules: [],
    sourceExtensionCounts: { ".ts": 1 },
    skippedCountsByReason: {},
    warnings: [],
    ...overrides,
  };
}

function makeProjection(): ProductGraphProjection {
  return {
    schemaVersion: "1",
    productGraphId: "test",
    nodes: [
      {
        id: "file:src/index.ts",
        kind: "code_file",
        title: "src/index.ts",
        status: "active",
        source: { kind: "code_scan", label: "scan", path: "src/index.ts" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "symbol:src/index.ts:main",
        kind: "code_symbol",
        title: "main (function)",
        status: "active",
        source: { kind: "code_scan", label: "scan", path: "src/index.ts", line: 1 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    edges: [],
    events: [],
    summary: {
      nodeCount: 2,
      edgeCount: 0,
      nodesByKind: {},
      edgesByKind: {},
      unresolvedOpenQuestionCount: 0,
      blockedTaskCount: 0,
    },
  };
}

describe("unified code graph", () => {
  it("emits workspace, project, file, and symbol nodes with belongs_to edges", () => {
    const graph = buildUnifiedCodeGraph({
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      projection: makeProjection(),
      kernelProfile: makeProfile(),
      diagnostics: ["Primary project type: typescript."],
    });

    expect(graph.schemaVersion).toBe("1");
    expect(graph.activeScannerIds).toEqual(["typescript"]);
    expect(graph.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining([
      "workspace",
      "project",
      "code_file",
      "symbol",
    ]));
    expect(graph.edges.some((edge) => edge.kind === "belongs_to")).toBe(true);
    expect(graph.diagnostics).toContain("Primary project type: typescript.");
  });
});