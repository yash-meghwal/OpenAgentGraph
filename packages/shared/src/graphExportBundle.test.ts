import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import {
  buildGraphExportDocument,
  buildGraphExplorerPayload,
  renderGraphExplorerHtml,
  sanitizeGraphForExport,
  serializeJsonForScriptTag,
} from "./graphExportBundle.js";

function extractExplorerPayloadFromHtml(html: string) {
  const match = html.match(/<script type="application\/json" id="oag-explorer-data">([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("Explorer payload script tag not found.");
  return JSON.parse(match[1]) as ReturnType<typeof buildGraphExplorerPayload>;
}

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

    const exported = buildGraphExportDocument(graph, makeProfile(), { exportedAt: "2026-06-17T12:00:00.000Z" });
    expect(exported.nodes[0]?.metadata?.body).toBeUndefined();
    expect(exported.nodes[0]?.metadata?.scannerCommunityLabel).toBe("App");
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