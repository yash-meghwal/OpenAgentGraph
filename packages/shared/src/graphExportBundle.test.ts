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
} from "./graphExportBundle.js";

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