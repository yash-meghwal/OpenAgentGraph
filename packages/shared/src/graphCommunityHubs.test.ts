import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  buildGraphCommunityHubSummaries,
  evaluateCommunityHubReleaseGates,
  formatHighDegreeHubWarnings,
  formatReadFirstByCommunityMarkdown,
  formatRichCommunityHubMarkdown,
  GRAPH_COMMUNITY_HUB_HIGH_DEGREE_THRESHOLD,
} from "./graphCommunityHubs.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      { id: "file:vm", kind: "code_file", label: "ViewModels/MainViewModel.cs", path: "SampleMediaPlayer.App/ViewModels/MainViewModel.cs" },
      { id: "file:controller", kind: "code_file", label: "Controllers/AppController.cs", path: "SampleMediaPlayer.App/Controllers/AppController.cs" },
      { id: "file:zebra", kind: "code_file", label: "Services/ZebraTelemetryService.cs", path: "SampleMediaPlayer.Core/Services/ZebraTelemetryService.cs" },
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "SampleMediaPlayer.App/ViewModels/MainViewModel.cs", metadata: { scannerSymbolKind: "class" } },
      { id: "file:svc", kind: "code_file", label: "Services/PlaybackService.cs", path: "SampleMediaPlayer.Core/Services/PlaybackService.cs" },
      { id: "sym:svc", kind: "symbol", label: "PlaybackService (class)", path: "SampleMediaPlayer.Core/Services/PlaybackService.cs", metadata: { scannerSymbolKind: "class" } },
      { id: "sym:zebra", kind: "symbol", label: "ZebraTelemetryService (class)", path: "SampleMediaPlayer.Core/Services/ZebraTelemetryService.cs", metadata: { scannerSymbolKind: "class" } },
      { id: "sym:controller", kind: "symbol", label: "AppController (class)", path: "SampleMediaPlayer.App/Controllers/AppController.cs", metadata: { scannerSymbolKind: "class" } },
      { id: "doc:guide", kind: "doc_file", label: "docs/guide.md", path: "docs/guide.md" },
      {
        id: "comm:app",
        kind: "community",
        label: "SampleMediaPlayer.App",
        path: "SampleMediaPlayer.App",
        metadata: {
          scannerCommunityLabel: "SampleMediaPlayer.App",
          scannerCommunityKind: "project",
          scannerCommunityFileCount: 1,
          scannerCommunityTopFiles: "SampleMediaPlayer.App/ViewModels/MainViewModel.cs",
          scannerCommunitySummary: "UI project with view models.",
          scannerCommunityLens: "frontend",
        },
      },
      {
        id: "comm:core",
        kind: "community",
        label: "SampleMediaPlayer.Core",
        path: "SampleMediaPlayer.Core",
        metadata: {
          scannerCommunityLabel: "SampleMediaPlayer.Core",
          scannerCommunityKind: "project",
          scannerCommunityFileCount: 1,
          scannerCommunityTopFiles: "SampleMediaPlayer.Core/Services/PlaybackService.cs",
          scannerCommunitySummary: "Core playback services.",
          scannerCommunityLens: "backend-runtime",
        },
      },
      { id: "file:orphan", kind: "code_file", label: "orphan-lib/util.ts", path: "orphan-lib/util.ts" },
      {
        id: "comm:thin",
        kind: "community",
        label: "orphan-lib",
        path: "orphan-lib",
        metadata: {
          scannerCommunityLabel: "orphan-lib",
          scannerCommunityKind: "directory",
          scannerCommunityFileCount: 1,
          scannerCommunityTopFiles: "orphan-lib/util.ts",
          scannerCommunitySummary: "Thin helper folder.",
          scannerCommunityLens: "backend-runtime",
        },
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "sym:vm", targetNodeId: "file:vm", kind: "belongs_to", provenance: "extracted" },
      { id: "e2", sourceNodeId: "file:vm", targetNodeId: "comm:app", kind: "belongs_to", provenance: "extracted" },
      { id: "e3", sourceNodeId: "sym:svc", targetNodeId: "file:svc", kind: "belongs_to", provenance: "extracted" },
      { id: "e4", sourceNodeId: "file:svc", targetNodeId: "comm:core", kind: "belongs_to", provenance: "extracted" },
      { id: "e5", sourceNodeId: "sym:vm", targetNodeId: "sym:svc", kind: "depends_on", provenance: "extracted" },
      { id: "e9", sourceNodeId: "sym:controller", targetNodeId: "file:controller", kind: "belongs_to", provenance: "extracted" },
      { id: "e10", sourceNodeId: "file:controller", targetNodeId: "comm:app", kind: "belongs_to", provenance: "extracted" },
      { id: "e11", sourceNodeId: "sym:zebra", targetNodeId: "file:zebra", kind: "belongs_to", provenance: "extracted" },
      { id: "e12", sourceNodeId: "file:zebra", targetNodeId: "comm:core", kind: "belongs_to", provenance: "extracted" },
      { id: "e6", sourceNodeId: "doc:guide", targetNodeId: "sym:svc", kind: "documents", provenance: "inferred", confidence: 0.8 },
      { id: "e7", sourceNodeId: "file:orphan", targetNodeId: "comm:thin", kind: "belongs_to", provenance: "extracted" },
      { id: "e8", sourceNodeId: "file:orphan", targetNodeId: "sym:svc", kind: "depends_on", provenance: "inferred", confidence: 0.7 },
    ],
  };
}

describe("graph community hubs", () => {
  it("builds rich hub summaries with symbols, relationships, provenance, and docs", () => {
    const hubs = buildGraphCommunityHubSummaries(makeGraph(), { mergeThinForPresentation: false });
    const appHub = hubs.find((hub) => hub.label === "SampleMediaPlayer.App");
    const coreHub = hubs.find((hub) => hub.label === "SampleMediaPlayer.Core");

    expect(appHub?.topSymbols).toContain("MainViewModel (class)");
    expect(appHub?.outgoingRelationships.some((rel) => rel.targetLabel === "SampleMediaPlayer.Core")).toBe(true);
    expect(coreHub?.incomingRelationships.some((rel) => rel.targetLabel === "SampleMediaPlayer.App")).toBe(true);
    expect(coreHub?.docLinks).toContain("docs/guide.md");
    expect(coreHub?.provenanceMix.total).toBeGreaterThan(0);
    expect(appHub?.hubSummary).toContain("SampleMediaPlayer.App");
    expect(appHub?.readFirstNodes.length).toBeGreaterThan(0);
  });

  it("merges thin communities in presentation output only", () => {
    const hubs = buildGraphCommunityHubSummaries(makeGraph());
    expect(hubs.some((hub) => hub.label === "orphan-lib")).toBe(false);
    const mergedHub = hubs.find((hub) => hub.mergedFromLabels?.includes("orphan-lib"));
    expect(mergedHub).toBeTruthy();
    expect(mergedHub?.mergedFromLabels).toContain("orphan-lib");
    expect(mergedHub?.provenanceMix.total).toBeGreaterThanOrEqual(2);
    expect(mergedHub?.incomingRelationships.some((rel) => rel.targetLabel === "SampleMediaPlayer.App")).toBe(true);
    expect(mergedHub?.interCommunityDegree).toBeGreaterThan(0);
  });

  it("renders markdown sections for hubs, read-first, and high-degree warnings", () => {
    const hubs = buildGraphCommunityHubSummaries(makeGraph());
    const hubLines = formatRichCommunityHubMarkdown(hubs);
    const readFirst = formatReadFirstByCommunityMarkdown(hubs);
    const warnings = formatHighDegreeHubWarnings(
      hubs.map((hub) => ({ ...hub, interCommunityDegree: GRAPH_COMMUNITY_HUB_HIGH_DEGREE_THRESHOLD })),
    );

    expect(hubLines.some((line) => line.includes("**SampleMediaPlayer.App**"))).toBe(true);
    expect(hubLines.some((line) => line.includes("symbols:"))).toBe(true);
    expect(readFirst[0]).toBe("## Read first by community");
    expect(readFirst.some((line) => line.startsWith("### SampleMediaPlayer."))).toBe(true);
    expect(warnings[0]).toBe("## High-degree hub warnings");
    expect(warnings.some((line) => line.includes("cross-community relationship"))).toBe(true);
  });

  it("passes hub release gates for meaningful top communities", () => {
    const result = evaluateCommunityHubReleaseGates(makeGraph());
    expect(result.ok).toBe(true);
    expect(result.topHubLabels).toContain("SampleMediaPlayer.App");
  });

  it("ranks role-aware start-with nodes ahead of alphabetical services", () => {
    const hubs = buildGraphCommunityHubSummaries(makeGraph(), { mergeThinForPresentation: false });
    const appHub = hubs.find((hub) => hub.label === "SampleMediaPlayer.App");
    const coreHub = hubs.find((hub) => hub.label === "SampleMediaPlayer.Core");
    expect(appHub?.startWithNodes?.[0]).toMatch(/MainViewModel|AppController/i);
    expect(coreHub?.startWithNodes?.findIndex((entry) => /ZebraTelemetry/i.test(entry))).toBeGreaterThan(
      coreHub?.startWithNodes?.findIndex((entry) => /PlaybackService/i.test(entry)) ?? -1
    );
    const readFirst = formatReadFirstByCommunityMarkdown(hubs).join("\n");
    expect(readFirst).toContain("**Start with**");
    expect(readFirst).toMatch(/MainViewModel|AppController/);
    expect(readFirst.indexOf("PlaybackService")).toBeLessThan(readFirst.indexOf("ZebraTelemetry"));
  });
});