import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  collectDependencyNeighborhoodPaths,
  diffFileFingerprints,
  mergeUnifiedGraphUpdate,
  planGraphIncrementalUpdate,
  removeUnifiedGraphPaths,
} from "./graphIncremental.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-15T10:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      { id: "workspace", kind: "workspace", label: "workspace" },
      { id: "file:old", kind: "code_file", label: "Services/Old.cs", path: "Services/Old.cs" },
      { id: "sym:old", kind: "symbol", label: "OldService (class)", path: "Services/Old.cs" },
      { id: "file:keep", kind: "code_file", label: "Services/Keep.cs", path: "Services/Keep.cs" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "file:old", targetNodeId: "sym:old", kind: "declares", provenance: "extracted" },
    ],
  };
}

describe("graph incremental", () => {
  it("treats mtime-only changes as unchanged when content hash matches", () => {
    const diff = diffFileFingerprints(
      [{ path: "a.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "hash-a" }],
      [{ path: "a.cs", sizeBytes: 1, mtimeMs: 99, contentHash: "hash-a" }]
    );
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual(["a.cs"]);
  });

  it("detects added, changed, and deleted fingerprints", () => {
    const diff = diffFileFingerprints(
      [{ path: "a.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "hash-a" }],
      [
        { path: "a.cs", sizeBytes: 2, mtimeMs: 2, contentHash: "hash-a2" },
        { path: "b.cs", sizeBytes: 3, mtimeMs: 3, contentHash: "hash-b" },
      ]
    );
    expect(diff.changed).toEqual(["a.cs"]);
    expect(diff.added).toEqual(["b.cs"]);
    expect(diff.deleted).toEqual([]);
  });

  it("falls back to full scan when manifest tool version changes", () => {
    const plan = planGraphIncrementalUpdate({
      cachedGraph: makeGraph(),
      manifest: {
        schemaVersion: "1",
        graphSchemaVersion: "1",
        incrementalToolVersion: "old",
        workspaceRoot: "/workspace",
        generatedAt: "2026-06-15T10:00:00.000Z",
        primaryType: "csharp-solution",
        activeScannerIds: ["dotnet"],
        ignoreRuleFingerprint: "abc",
        files: [{ path: "Services/Keep.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "hash" }],
      },
      currentFingerprints: [{ path: "Services/Keep.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "hash" }],
      kernelProfile: {
        schemaVersion: "1",
        root: "/workspace",
        effectiveRoots: ["."],
        primaryType: "csharp-solution",
        secondaryTypes: [],
        typeSignals: [],
        sourceRoots: ["."],
        markerPaths: [],
        activeScannerIds: ["dotnet"],
        ignoreRules: [],
        sourceExtensionCounts: { ".cs": 1 },
        skippedCountsByReason: {},
        warnings: [],
      },
      incrementalToolVersion: "new",
      ignoreRuleFingerprint: "abc",
    });
    expect(plan.mode).toBe("full");
  });

  it("expands incremental scan paths to dependency neighbors", () => {
    const graph = {
      ...makeGraph(),
      nodes: [
        ...makeGraph().nodes,
        { id: "file:consumer", kind: "code_file" as const, label: "Services/Consumer.cs", path: "Services/Consumer.cs" },
        { id: "sym:consumer", kind: "symbol" as const, label: "Consumer (class)", path: "Services/Consumer.cs" },
      ],
      edges: [
        ...makeGraph().edges,
        { id: "e2", sourceNodeId: "sym:consumer", targetNodeId: "sym:old", kind: "references", provenance: "inferred" as const },
      ],
    };

    const neighbors = collectDependencyNeighborhoodPaths(graph, ["Services/Old.cs"]);
    expect(neighbors).toEqual(["Services/Consumer.cs"]);

    const plan = planGraphIncrementalUpdate({
      cachedGraph: graph,
      manifest: {
        schemaVersion: "1",
        graphSchemaVersion: "1",
        incrementalToolVersion: "tool",
        workspaceRoot: "/workspace",
        generatedAt: "2026-06-15T10:00:00.000Z",
        primaryType: "csharp-solution",
        activeScannerIds: ["dotnet"],
        ignoreRuleFingerprint: "abc",
        files: [
          { path: "Services/A.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "a" },
          { path: "Services/B.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "b" },
          { path: "Services/C.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "c" },
          { path: "Services/Consumer.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "consumer" },
          { path: "Services/D.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "d" },
          { path: "Services/E.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "e" },
          { path: "Services/F.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "f" },
          { path: "Services/Keep.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "keep" },
          { path: "Services/Old.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "old" },
        ],
      },
      currentFingerprints: [
        { path: "Services/A.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "a" },
        { path: "Services/B.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "b" },
        { path: "Services/C.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "c" },
        { path: "Services/Consumer.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "consumer" },
        { path: "Services/D.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "d" },
        { path: "Services/E.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "e" },
        { path: "Services/F.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "f" },
        { path: "Services/Keep.cs", sizeBytes: 1, mtimeMs: 1, contentHash: "keep" },
        { path: "Services/Old.cs", sizeBytes: 2, mtimeMs: 2, contentHash: "old2" },
      ],
      kernelProfile: {
        schemaVersion: "1",
        root: "/workspace",
        effectiveRoots: ["."],
        primaryType: "csharp-solution",
        secondaryTypes: [],
        typeSignals: [],
        sourceRoots: ["."],
        markerPaths: [],
        activeScannerIds: ["dotnet"],
        ignoreRules: [],
        sourceExtensionCounts: { ".cs": 3 },
        skippedCountsByReason: {},
        warnings: [],
      },
      incrementalToolVersion: "tool",
      ignoreRuleFingerprint: "abc",
    });

    expect(plan.mode).toBe("incremental");
    expect(plan.scanPaths).toEqual(["Services/Consumer.cs", "Services/Old.cs"]);
    expect(plan.neighborPaths).toEqual(["Services/Consumer.cs"]);
  });

  it("removes deleted paths and merges partial graph updates", () => {
    const stripped = removeUnifiedGraphPaths(makeGraph(), ["Services/Old.cs"]);
    expect(stripped.nodes.some((node) => node.id === "file:old")).toBe(false);
    expect(stripped.nodes.some((node) => node.id === "file:keep")).toBe(true);

    const merged = mergeUnifiedGraphUpdate({
      base: stripped,
      partial: {
        ...makeGraph(),
        generatedAt: "2026-06-15T11:00:00.000Z",
        nodes: [
          { id: "file:new", kind: "code_file", label: "Services/New.cs", path: "Services/New.cs" },
          { id: "sym:new", kind: "symbol", label: "NewService (class)", path: "Services/New.cs" },
        ],
        edges: [],
      },
      removedPaths: [],
      generatedAt: "2026-06-15T11:00:00.000Z",
      diagnostics: ["Partial update."],
    });
    expect(merged.nodes.some((node) => node.path === "Services/New.cs")).toBe(true);
    expect(merged.nodes.some((node) => node.path === "Services/Old.cs")).toBe(false);
  });
});