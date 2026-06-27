import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { evaluateGraphGuidanceConsistency } from "./graphGuidanceConsistency.js";
import { buildGraphGodNodeSummaries } from "./graphLenses.js";
import {
  buildCommunityStartGuidanceBuckets,
  classifyStartGuidanceBucket,
  getStartGuidanceReadFirstNodes,
  rankStartGuidanceNodes,
} from "./graphStartGuidance.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs", metadata: { scannerSymbolKind: "class" } },
      { id: "sym:test", kind: "symbol", label: "MainViewModelTests.SetUp (method)", path: "tests/MainViewModelTests.cs" },
      { id: "file:vm", kind: "code_file", label: "ViewModels/MainViewModel.cs", path: "ViewModels/MainViewModel.cs" },
      {
        id: "comm:app",
        kind: "community",
        label: "SampleMediaPlayer.App",
        path: "SampleMediaPlayer.App",
        metadata: { scannerCommunityLabel: "SampleMediaPlayer.App", scannerCommunityFileCount: 2 },
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "file:vm", targetNodeId: "comm:app", kind: "belongs_to", provenance: "extracted" },
      { id: "e2", sourceNodeId: "sym:vm", targetNodeId: "file:vm", kind: "belongs_to", provenance: "extracted" },

    ],
  };
}

function makeCommunityBucketGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["typescript"],
    diagnostics: [],
    nodes: [
      { id: "sym:svc", kind: "symbol", label: "CheckoutService (class)", path: "src/checkout/service.ts", metadata: { scannerSymbolKind: "class" } },
      { id: "file:svc", kind: "code_file", label: "src/checkout/service.ts", path: "src/checkout/service.ts" },
      { id: "test:svc", kind: "test", label: "CheckoutServiceTests", path: "tests/CheckoutServiceTests.ts" },
      { id: "doc:arch", kind: "doc_file", label: "docs/architecture.md", path: "docs/architecture.md" },
      { id: "doc:section", kind: "doc_section", label: "Architecture", path: "docs/architecture.md" },
      { id: "cfg:pkg", kind: "config_file", label: "package.json", path: "package.json" },
      {
        id: "comm:checkout",
        kind: "community",
        label: "checkout",
        path: "src/checkout",
        metadata: { scannerCommunityLabel: "checkout", scannerCommunityFileCount: 4 },
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "sym:svc", targetNodeId: "file:svc", kind: "belongs_to", provenance: "extracted" },
      { id: "e2", sourceNodeId: "file:svc", targetNodeId: "comm:checkout", kind: "belongs_to", provenance: "extracted" },
      { id: "e3", sourceNodeId: "test:svc", targetNodeId: "comm:checkout", kind: "belongs_to", provenance: "extracted" },
      { id: "e4", sourceNodeId: "doc:arch", targetNodeId: "comm:checkout", kind: "belongs_to", provenance: "extracted" },
      { id: "e5", sourceNodeId: "doc:section", targetNodeId: "doc:arch", kind: "belongs_to", provenance: "extracted" },
      { id: "e6", sourceNodeId: "cfg:pkg", targetNodeId: "comm:checkout", kind: "belongs_to", provenance: "extracted" },
    ],
  };
}

describe("graphStartGuidance", () => {
  it("ranks view models before tests in general mode", () => {
    const ranked = rankStartGuidanceNodes(makeGraph().nodes);
    expect(ranked[0]?.label).toMatch(/MainViewModel/i);
    expect(ranked.findIndex((node) => /Tests/i.test(node.label))).toBeGreaterThan(0);
  });

  it("classifies guidance buckets for code, tests, and docs roles", () => {
    expect(classifyStartGuidanceBucket(makeGraph().nodes[0]!)).toBe("start_with");
    expect(classifyStartGuidanceBucket(makeGraph().nodes[1]!)).toBe("related_tests");
  });

  it("builds community buckets with start-with and related tests separated", () => {
    const buckets = buildCommunityStartGuidanceBuckets(makeGraph().nodes, makeGraph());
    expect(buckets.startWith.some((entry) => /MainViewModel/i.test(entry))).toBe(true);
    expect(buckets.relatedTests.some((entry) => /Tests/i.test(entry))).toBe(true);
  });

  it("community buckets include first-class docs and tests", () => {
    const graph = makeCommunityBucketGraph();
    const memberNodes = graph.nodes.filter((node) => node.id !== "comm:checkout");
    const buckets = buildCommunityStartGuidanceBuckets(memberNodes, graph);

    expect(buckets.startWith.some((entry) => /CheckoutService|service\.ts/i.test(entry))).toBe(true);
    expect(buckets.relatedTests.some((entry) => /CheckoutServiceTests/i.test(entry))).toBe(true);
    expect(buckets.supportingDocs.some((entry) => /architecture\.md|Architecture/i.test(entry))).toBe(true);
    expect(buckets.operationalConfig.some((entry) => /package\.json/i.test(entry))).toBe(true);
  });

  it("global read-first does not lead with docs/tests by default", () => {
    const graph = makeCommunityBucketGraph();
    const readFirst = getStartGuidanceReadFirstNodes(graph, 3);

    expect(readFirst[0]?.label).toMatch(/CheckoutService/i);
    expect(readFirst.some((node) => node.kind === "test")).toBe(false);
    expect(readFirst.some((node) => node.kind === "doc_file" || node.kind === "doc_section")).toBe(false);
  });

  it("classifies Windows test paths as related tests without leading global read-first", () => {
    const base = makeCommunityBucketGraph();
    const graph: UnifiedCodeGraph = {
      ...base,
      nodes: [
        ...base.nodes.filter((node) => node.id !== "test:svc"),
        { id: "test:win", kind: "test", label: "CheckoutServiceTests", path: "tests\\CheckoutServiceTests.cs" },
      ],
      edges: base.edges.map((edge) =>
        edge.sourceNodeId === "test:svc" ? { ...edge, sourceNodeId: "test:win" } : edge
      ),
    };
    const memberNodes = graph.nodes.filter((node) => node.id !== "comm:checkout");
    const buckets = buildCommunityStartGuidanceBuckets(memberNodes, graph);

    expect(buckets.relatedTests.some((entry) => /CheckoutServiceTests/i.test(entry))).toBe(true);
    expect(getStartGuidanceReadFirstNodes(graph, 3)[0]?.label).toMatch(/CheckoutService/i);
  });

  it("aligns god-node tops with global read-first primary", () => {
    const graph = makeGraph();
    const globalPrimary = getStartGuidanceReadFirstNodes(graph, 1)[0]?.path ?? "";
    const godTops = buildGraphGodNodeSummaries(graph, 3).flatMap((entry) => [...entry.topSymbols, ...entry.topFiles]);
    expect(godTops.some((label) => label.includes("MainViewModel"))).toBe(true);
    expect(evaluateGraphGuidanceConsistency(graph).ok).toBe(true);
    expect(globalPrimary).toMatch(/MainViewModel/i);
  });
});