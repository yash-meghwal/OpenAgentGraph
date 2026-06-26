import vm from "node:vm";
import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import { renderUnifiedGraphHandoffReport } from "./graphArtifacts.js";
import {
  buildGraphExportDocument,
  buildGraphExplorerPayload,
  evaluateStaticExportReleaseGates,
  extractExplorerPayloadFromHtml,
  findForbiddenExportContent,
  renderGraphExplorerHtml,
  sanitizeGraphForExport,
  serializeJsonForScriptTag,
  type GraphExplorerPayload,
} from "./graphExportBundle.js";
import {
  buildGraphPathExplorerBrowserScript,
  computeExplorerPathEdgeCost,
  explorerEdgeCostBlocked,
  GRAPH_EXPLORER_PATH_MODEL_VERSION,
} from "./graphPathBrowserModel.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: ["C# semantic: unavailable on this host."],
    nodes: [
      { id: "file:vm", kind: "code_file", label: "ViewModels/MainViewModel.cs", path: "ViewModels/MainViewModel.cs" },
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
      {
        id: "comm:app",
        kind: "community",
        label: "SampleMediaPlayer.App",
        path: "SampleMediaPlayer.App",
        metadata: {
          scannerCommunityLabel: "SampleMediaPlayer.App",
          scannerCommunityFileCount: 2,
          scannerCommunitySummary: "App UI project.",
        },
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "file:vm", targetNodeId: "comm:app", kind: "belongs_to", provenance: "extracted" },
      { id: "e2", sourceNodeId: "sym:vm", targetNodeId: "file:vm", kind: "belongs_to", provenance: "extracted" },
    ],
  };
}

function browserComputeEdgeCost(
  payload: GraphExplorerPayload,
  edgeId: string,
  mode: string,
  pathIntent: string,
  lensId: string
) {
  const script = `
    const data = ${JSON.stringify({ nodes: payload.nodes, edges: payload.edges })};
    const nodesById = new Map(data.nodes.map((node) => [node.id, node]));
    ${buildGraphPathExplorerBrowserScript()}
    const edge = data.edges.find((entry) => entry.id === ${JSON.stringify(edgeId)});
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    computeEdgeCost(edge, ${JSON.stringify(mode)}, ${JSON.stringify(pathIntent)}, ${JSON.stringify(lensId)}, sourceNode, targetNode);
  `;
  return vm.runInNewContext(script) as number;
}

function makeProfile(): WorkspaceKernelProfile {
  return {
    schemaVersion: "1.0",
    root: "/workspace",
    effectiveRoots: ["/workspace"],
    primaryType: "dotnet",
    secondaryTypes: [],
    typeSignals: [],
    sourceRoots: ["."],
    markerPaths: ["SampleMediaPlayer.sln"],
    activeScannerIds: ["dotnet"],
    ignoreRules: [],
    sourceExtensionCounts: { ".cs": 3 },
    skippedCountsByReason: {},
    warnings: ["Roslyn helper unavailable."],
  };
}

describe("graph export bundle", () => {
  it("strips forbidden body metadata and adds export envelope", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      nodes: [
        {
          id: "file:vm",
          kind: "code_file",
          label: "ViewModels/MainViewModel.cs",
          path: "ViewModels/MainViewModel.cs",
          metadata: { body: "class MainViewModel {}", scannerCommunityLabel: "App" },
        },
        {
          id: "comm:app",
          kind: "community",
          label: "SampleMediaPlayer.App",
          path: "SampleMediaPlayer.App",
          metadata: {
            scannerCommunityLabel: "SampleMediaPlayer.App",
            scannerCommunityFileCount: 1,
            scannerCommunitySummary: "App UI project.",
          },
        },
      ],
    };

    const graphWithEdgeBody: UnifiedCodeGraph = {
      ...graph,
      edges: [
        ...graph.edges,
        {
          id: "e-body",
          sourceNodeId: "file:vm",
          targetNodeId: "sym:vm",
          kind: "declares",
          provenance: "extracted",
          metadata: { body: "class MainViewModel {}", scannerRelation: "declares" },
        },
      ],
    };

    const exported = buildGraphExportDocument(graphWithEdgeBody, makeProfile(), { exportedAt: "2026-06-17T12:00:00.000Z" });
    expect(exported.nodes[0]?.metadata?.body).toBeUndefined();
    expect(exported.nodes[0]?.metadata?.scannerCommunityLabel).toBe("App");
    expect(exported.edges.find((edge) => edge.id === "e-body")?.metadata?.body).toBeUndefined();
    expect(exported.edges.find((edge) => edge.id === "e-body")?.metadata?.scannerRelation).toBe("declares");
    expect(exported.export?.graphVersion).toBe("1");
    expect(exported.export?.exportedAt).toBe("2026-06-17T12:00:00.000Z");
    expect(exported.export?.scannerProfile?.primaryType).toBe("dotnet");
    expect(exported.export?.communities.length).toBeGreaterThan(0);
    expect(exported.export?.provenance.extractedEdgeCount).toBeGreaterThanOrEqual(0);
    expect(exported.export?.refreshCommands.length).toBeGreaterThan(0);
    expect(exported.export?.risks.some((risk) => /Roslyn|semantic/i.test(risk))).toBe(true);
  });

  it("builds explorer payload with lens and community context", () => {
    const payload = buildGraphExplorerPayload(makeGraph(), makeProfile());
    expect(payload.nodes.some((node) => node.id === "sym:vm" && node.communityLabel === "SampleMediaPlayer.App")).toBe(true);
    expect(payload.lenses.length).toBeGreaterThan(1);
    expect(payload.edges).toHaveLength(2);
  });

  it("renders interactive explorer html without embedding raw source bodies", () => {
    const graph = sanitizeGraphForExport(makeGraph());
    const html = renderGraphExplorerHtml(graph, { kernelProfile: makeProfile() });
    expect(html).toContain('id="oag-search"');
    expect(html).toContain('id="oag-lens"');
    expect(html).toContain('id="oag-community"');
    expect(html).toContain('id="oag-explain-panel"');
    expect(html).toContain('id="oag-path-from"');
    expect(html).toContain("Community navigation");
    expect(html).toContain('id="oag-hub-search"');
    expect(html).toContain('role="button"');
    expect(html).toContain('event.key !== "Enter" && event.key !== " "');
    expect(html).toContain("graphPathSeedResolution.ts");
    expect(html).toContain("const hopCount = Math.max(0, result.nodes.length - 1)");
    expect(html).not.toContain("Raw JSON");
    expect(html).not.toContain("class MainViewModel");
    expect(html).not.toContain("&quot;workspaceRoot&quot;");
    const payload = extractExplorerPayloadFromHtml(html);
    expect(payload.workspaceRoot).toBe("/workspace");
    expect(payload.nodes.length).toBeGreaterThan(0);
  });

  it("serializes explorer payload for script tags without HTML entity escaping", () => {
    const serialized = serializeJsonForScriptTag({ workspaceRoot: "/workspace", label: "A & B <C>" });
    expect(serialized).toContain('"workspaceRoot":"/workspace"');
    expect(serialized).not.toContain("&quot;");
    expect(JSON.parse(serialized)).toEqual({ workspaceRoot: "/workspace", label: "A & B <C>" });
  });

  it("flags forbidden export content and secret-like values", () => {
    const violations = findForbiddenExportContent('{"metadata":{"body":"class Secret {}"},"token":"sk_123456789012"}');
    expect(violations).toContain("forbidden metadata key 'body'");
    expect(violations).toContain("secret-looking API key value");
  });

  it("redacts workspace roots in share-safe export presentation", () => {
    const graph = makeGraph();
    const exported = buildGraphExportDocument(graph, makeProfile(), { redactRoot: true });
    const handoff = renderUnifiedGraphHandoffReport(exported, { kernelProfile: makeProfile(), redactRoot: true });
    const html = renderGraphExplorerHtml(graph, { kernelProfile: makeProfile(), redactRoot: true });

    expect(exported.workspaceRoot).toBe("/workspace");
    expect(exported.export?.refreshCommands?.[0]).toContain('"<workspace>"');
    expect(handoff).toContain("Workspace: `<workspace>`");
    expect(handoff).not.toContain("/workspace");
    expect(html).toContain("Workspace: &lt;workspace&gt;");
    expect(extractExplorerPayloadFromHtml(html).workspaceRoot).toBe("<workspace>");
  });

  it("passes static export release gates for a complete export bundle", () => {
    const exported = buildGraphExportDocument(makeGraph(), makeProfile());
    const handoff = renderUnifiedGraphHandoffReport(exported, { kernelProfile: makeProfile() });
    const gate = evaluateStaticExportReleaseGates({
      graph: makeGraph(),
      kernelProfile: makeProfile(),
      handoffMarkdown: handoff,
    });
    expect(gate.ok).toBe(true);
    expect(gate.errors).toEqual([]);
  });

  it("blocks test constructor edges for lens=all code_to_code in browser model from exported payload", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["dotnet"],
      diagnostics: [],
      nodes: [
        { id: "sym:test", kind: "test", label: "FixtureTests.SetUp (method)", path: "tests/FixtureTests.cs" },
        { id: "sym:sut", kind: "symbol", label: "SutService (class)", path: "Services/SutService.cs" },
      ],
      edges: [
        {
          id: "e-ctor",
          sourceNodeId: "sym:test",
          targetNodeId: "sym:sut",
          kind: "references",
          provenance: "extracted",
          metadata: { scannerRelation: "semantic_constructor" },
        },
      ],
    };
    const payload = buildGraphExplorerPayload(graph, makeProfile());
    expect(payload.edges.find((edge) => edge.id === "e-ctor")?.pathCosts).toBeUndefined();
    const edge = {
      kind: "references",
      provenance: "extracted",
      scannerRelation: "semantic_constructor",
    };
    const context = {
      sourceNode: { kind: "test", label: "FixtureTests.SetUp (method)", path: "tests/FixtureTests.cs" },
      targetNode: { kind: "symbol", label: "SutService (class)", path: "Services/SutService.cs" },
    };
    expect(explorerEdgeCostBlocked(computeExplorerPathEdgeCost(edge, {
      mode: "balanced",
      pathIntent: "code_to_code",
      lens: "all",
    }, context))).toBe(true);
    expect(browserComputeEdgeCost(payload, "e-ctor", "balanced", "code_to_code", "all")).toBeGreaterThanOrEqual(9000);
  });

  it("allows test constructor edges for lens=tests code_to_code in browser model from exported payload", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["dotnet"],
      diagnostics: [],
      nodes: [
        { id: "sym:test", kind: "test", label: "FixtureTests.SetUp (method)", path: "tests/FixtureTests.cs" },
        { id: "sym:sut", kind: "test", label: "SutService (class)", path: "tests/SutService.cs" },
      ],
      edges: [
        {
          id: "e-ctor",
          sourceNodeId: "sym:test",
          targetNodeId: "sym:sut",
          kind: "references",
          provenance: "extracted",
          metadata: { scannerRelation: "semantic_constructor" },
        },
      ],
    };
    const payload = buildGraphExplorerPayload(graph, makeProfile());
    const edge = {
      kind: "references",
      provenance: "extracted",
      scannerRelation: "semantic_constructor",
    };
    const context = {
      sourceNode: { kind: "test", label: "FixtureTests.SetUp (method)", path: "tests/FixtureTests.cs" },
      targetNode: { kind: "test", label: "SutService (class)", path: "tests/SutService.cs" },
    };
    expect(computeExplorerPathEdgeCost(edge, {
      mode: "balanced",
      pathIntent: "code_to_code",
      lens: "tests",
    }, context)).toBe(28);
    expect(browserComputeEdgeCost(payload, "e-ctor", "balanced", "code_to_code", "tests")).toBe(28);
  });

  it("blocks doc edges for code_to_code but allows them for doc_to_code from exported payload", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["typescript"],
      diagnostics: [],
      nodes: [
        { id: "doc:arch", kind: "doc_section", label: "Architecture", path: "docs/architecture.md" },
        { id: "sym:svc", kind: "symbol", label: "CheckoutService (class)", path: "src/checkout/service.ts" },
      ],
      edges: [
        {
          id: "e-doc",
          sourceNodeId: "doc:arch",
          targetNodeId: "sym:svc",
          kind: "documents",
          provenance: "extracted",
          metadata: { scannerRelation: "doc_code_ref" },
        },
      ],
    };
    const payload = buildGraphExplorerPayload(graph, makeProfile());
    const edge = {
      kind: "documents",
      provenance: "extracted",
      scannerRelation: "doc_code_ref",
    };
    const context = {
      sourceNode: { kind: "doc_section", label: "Architecture", path: "docs/architecture.md" },
      targetNode: { kind: "symbol", label: "CheckoutService (class)", path: "src/checkout/service.ts" },
    };
    expect(explorerEdgeCostBlocked(computeExplorerPathEdgeCost(edge, {
      mode: "balanced",
      pathIntent: "code_to_code",
    }, context))).toBe(true);
    expect(browserComputeEdgeCost(payload, "e-doc", "balanced", "code_to_code", "all")).toBeGreaterThanOrEqual(9000);
    expect(computeExplorerPathEdgeCost(edge, {
      mode: "balanced",
      pathIntent: "doc_to_code",
    }, context)).toBeLessThan(9000);
    expect(browserComputeEdgeCost(payload, "e-doc", "balanced", "doc_to_code", "all")).toBeLessThan(9000);
  });

  it("browser path model prefers runtime chains over test constructor shortcuts from exported payload", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["dotnet"],
      diagnostics: [],
      nodes: [
        { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
        { id: "sym:vm-play", kind: "symbol", label: "MainViewModel.Play (method)", path: "ViewModels/MainViewModel.cs" },
        { id: "sym:svc-play", kind: "symbol", label: "PlaybackService.Play (method)", path: "Services/PlaybackService.cs" },
        { id: "sym:svc", kind: "symbol", label: "PlaybackService (class)", path: "Services/PlaybackService.cs" },
        { id: "sym:test", kind: "symbol", label: "MainViewModelTests.Title_is_set (method)", path: "tests/MainViewModelTests.cs" },
      ],
      edges: [
        { id: "e0", sourceNodeId: "sym:vm", targetNodeId: "sym:vm-play", kind: "belongs_to", provenance: "extracted", metadata: { scannerRelation: "source_file" } },
        { id: "e1", sourceNodeId: "sym:vm-play", targetNodeId: "sym:svc-play", kind: "references", provenance: "extracted", metadata: { scannerRelation: "semantic_calls" } },
        { id: "e4", sourceNodeId: "sym:svc-play", targetNodeId: "sym:svc", kind: "belongs_to", provenance: "extracted", metadata: { scannerRelation: "source_file" } },
        { id: "e2", sourceNodeId: "sym:test", targetNodeId: "sym:vm", kind: "references", provenance: "extracted", metadata: { scannerRelation: "semantic_constructor" } },
        { id: "e3", sourceNodeId: "sym:test", targetNodeId: "sym:svc", kind: "references", provenance: "extracted", metadata: { scannerRelation: "semantic_constructor" } },
      ],
    };
    const payload = buildGraphExplorerPayload(graph, makeProfile());
    const script = `
      const data = ${JSON.stringify({ nodes: payload.nodes, edges: payload.edges })};
      const nodesById = new Map(data.nodes.map((node) => [node.id, node]));
      const lensSelect = { value: "all" };
      ${buildGraphPathExplorerBrowserScript()}
      function classifyPathIntent(fromNode, toNode) {
        return "code_to_code";
      }
      function buildWeightedAdjacency(mode, pathIntent, lensId) {
        const adjacency = new Map();
        const add = (sourceId, targetId, edge, cost) => {
          const current = adjacency.get(sourceId) || [];
          current.push({ neighborId: targetId, edge, cost });
          adjacency.set(sourceId, current);
        };
        for (const edge of data.edges) {
          const sourceNode = nodesById.get(edge.sourceNodeId);
          const targetNode = nodesById.get(edge.targetNodeId);
          const cost = edgeCost(edge, mode, pathIntent, lensId, sourceNode, targetNode);
          if (cost >= 9000) continue;
          add(edge.sourceNodeId, edge.targetNodeId, edge, cost);
          add(edge.targetNodeId, edge.sourceNodeId, edge, cost);
        }
        return adjacency;
      }
      function findWeightedPath(fromNode, toNode, mode) {
        const pathIntent = classifyPathIntent(fromNode, toNode);
        const lensId = lensSelect.value;
        const adjacency = buildWeightedAdjacency(mode, pathIntent, lensId);
        const infiniteRank = { cost: Infinity, testHops: Infinity, structuralHops: Infinity, hubHops: Infinity, inheritanceHops: Infinity, hopCount: Infinity };
        const rankById = new Map([[fromNode.id, { cost: 0, testHops: 0, structuralHops: 0, hubHops: 0, inheritanceHops: 0, hopCount: 0 }]]);
        const previous = new Map([[fromNode.id, null]]);
        const visited = new Set();
        const queue = [fromNode.id];
        while (queue.length > 0) {
          queue.sort((left, right) => {
            const leftRank = rankById.get(left) ?? infiniteRank;
            const rightRank = rankById.get(right) ?? infiniteRank;
            const compared = comparePathRanks(leftRank, rightRank);
            return compared !== 0 ? compared : left.localeCompare(right);
          });
          const currentId = queue.shift();
          if (!currentId || visited.has(currentId)) continue;
          visited.add(currentId);
          if (currentId === toNode.id) break;
          const currentRank = rankById.get(currentId) ?? infiniteRank;
          for (const entry of adjacency.get(currentId) || []) {
            const neighbor = nodesById.get(entry.neighborId);
            if (!neighbor) continue;
            const penalty = nodePenalty(neighbor, mode, pathIntent, lensId);
            const nextRank = buildPathRank(currentRank, entry.edge, entry.cost, penalty, neighbor, mode);
            const knownRank = rankById.get(entry.neighborId);
            if (knownRank !== undefined && comparePathRanks(nextRank, knownRank) >= 0) continue;
            rankById.set(entry.neighborId, nextRank);
            previous.set(entry.neighborId, { nodeId: currentId, edge: entry.edge });
            if (!visited.has(entry.neighborId)) queue.push(entry.neighborId);
          }
        }
        const pathIds = [];
        let cursor = toNode.id;
        while (cursor) {
          pathIds.unshift(cursor);
          const step = previous.get(cursor);
          cursor = step ? step.nodeId : null;
        }
        return pathIds.map((id) => nodesById.get(id)).filter(Boolean);
      }
      findWeightedPath(nodesById.get("sym:vm"), nodesById.get("sym:svc"), "balanced");
    `;
    const result = vm.runInNewContext(script) as Array<{ id: string; label: string }>;
    expect(result.some((node) => node.label.includes("MainViewModelTests"))).toBe(false);
    expect(result.some((node) => node.label.includes("Play (method)"))).toBe(true);
  });

  it("advertises the shared path model version and in-browser cost computation in explorer html", () => {
    const html = renderGraphExplorerHtml(makeGraph(), { kernelProfile: makeProfile() });
    expect(html).toContain(`Path model v${GRAPH_EXPLORER_PATH_MODEL_VERSION}`);
    expect(html).toContain("computed in-browser per mode, path intent, and lens");
    expect(html).toContain("computeEdgeCost");
    expect(html).toContain("lensAllowsNode");
    expect(html).toContain("ensureDegreeMap");
  });

  it("drops explorer edges that point at hidden node kinds", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      nodes: [
        ...makeGraph().nodes,
        { id: "workspace", kind: "workspace", label: "workspace", path: "." },
        { id: "dir:src", kind: "directory", label: "src", path: "src" },
      ],
      edges: [
        ...makeGraph().edges,
        { id: "e3", sourceNodeId: "file:vm", targetNodeId: "workspace", kind: "belongs_to", provenance: "extracted" },
        { id: "e4", sourceNodeId: "workspace", targetNodeId: "dir:src", kind: "declares", provenance: "extracted" },
      ],
    };

    const payload = buildGraphExplorerPayload(graph, makeProfile());
    const nodeIds = new Set(payload.nodes.map((node) => node.id));
    expect(payload.edges.every((edge) =>
      nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)
    )).toBe(true);
    expect(payload.edges.some((edge) => edge.targetNodeId === "workspace")).toBe(false);
  });
});