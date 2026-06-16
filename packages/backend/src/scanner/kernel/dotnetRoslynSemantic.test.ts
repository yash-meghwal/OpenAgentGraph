import { describe, expect, it } from "vitest";
import {
  createDotNetSymbolLookup,
  registerDotNetSymbolNode,
} from "./dotnetScanner.js";
import { mapRoslynSemanticEdges } from "./dotnetRoslynSemantic.js";

describe("dotnet Roslyn semantic bridge", () => {
  it("maps Roslyn payload edges only when both symbol endpoints exist", () => {
    const lookup = createDotNetSymbolLookup();
    const knownNodeIds = new Set<string>();

    const register = (filePath: string, kind: string, name: string, parentType?: string) => {
      const symbolId = `sym:${filePath}:${parentType ?? "file"}:${kind}:${name}`;
      knownNodeIds.add(symbolId);
      registerDotNetSymbolNode(lookup, { filePath, symbolId, kind, name, parentType });
      return symbolId;
    };

    const sourceId = register(
      "SampleMediaPlayer.App/ViewModels/MainViewModel.cs",
      "method",
      "Play",
      "MainViewModel"
    );
    const targetId = register(
      "SampleMediaPlayer.Core/Services/PlaybackService.cs",
      "method",
      "Play",
      "PlaybackService"
    );

    const edges = mapRoslynSemanticEdges({
      payload: [
        {
          sourceFile: "SampleMediaPlayer.App/ViewModels/MainViewModel.cs",
          sourceKind: "method",
          sourceName: "Play",
          sourceParentType: "MainViewModel",
          targetFile: "SampleMediaPlayer.Core/Services/PlaybackService.cs",
          targetKind: "method",
          targetName: "Play",
          targetParentType: "PlaybackService",
          edgeKind: "calls",
          relation: "semantic_calls",
          line: 16,
        },
        {
          sourceFile: "SampleMediaPlayer.App/ViewModels/MainViewModel.cs",
          sourceKind: "method",
          sourceName: "Play",
          sourceParentType: "MainViewModel",
          targetFile: "SampleMediaPlayer.Core/Services/ExternalService.cs",
          targetKind: "method",
          targetName: "Run",
          targetParentType: "ExternalService",
          edgeKind: "calls",
          relation: "semantic_calls",
          line: 17,
        },
      ],
      symbolLookup: lookup,
      knownNodeIds,
      scanId: "scan-1",
      scannedAt: "2026-06-15T12:00:00.000Z",
      stableId: (prefix, raw) => `${prefix}:${raw}`,
      compactMetadata: (values) => values as Record<string, string>,
      sourceRef: (projectPath, line) => ({ kind: "code_scan", label: "Codebase scan", path: projectPath, line }),
      maxEdgeLabelLength: 180,
    });

    expect(edges).toHaveLength(1);
    expect(edges[0]?.sourceNodeId).toBe(sourceId);
    expect(edges[0]?.targetNodeId).toBe(targetId);
    expect(edges[0]?.kind).toBe("uses");
    expect(edges[0]?.metadata?.scannerResolution).toBe("semantic");
  });
});