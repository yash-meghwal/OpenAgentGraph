import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { getReadTheseFirstNodes } from "./graphReadFirst.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-22T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      {
        id: "sym:workflow-result",
        kind: "symbol",
        label: "BatchSubtitleWorkflowResult (record)",
        path: "Core/ViewModels/BatchSubtitleWorkflowResult.cs",
        metadata: { scannerSymbolKind: "record" },
      },
      {
        id: "sym:about-nav",
        kind: "symbol",
        label: "AboutNavigationService (class)",
        path: "Services/AboutNavigationService.cs",
        metadata: { scannerSymbolKind: "class" },
      },
      {
        id: "sym:main-vm",
        kind: "symbol",
        label: "MainViewModel (class)",
        path: "ViewModels/MainViewModel.cs",
        metadata: { scannerSymbolKind: "class" },
      },
      {
        id: "sym:field",
        kind: "symbol",
        label: "MainViewModel._playbackService (field)",
        path: "ViewModels/MainViewModel.cs",
        metadata: { scannerSymbolKind: "field" },
      },
      {
        id: "file:main-vm",
        kind: "code_file",
        label: "ViewModels/MainViewModel.cs",
        path: "ViewModels/MainViewModel.cs",
      },
      {
        id: "file:about-nav",
        kind: "code_file",
        label: "Services/AboutNavigationService.cs",
        path: "Services/AboutNavigationService.cs",
      },
    ],
    edges: [],
  };
}

describe("graph read-first ranking", () => {
  it("prefers view model class entrypoints before generic service symbols", () => {
    const readFirst = getReadTheseFirstNodes(makeGraph(), 6);
    expect(readFirst[0]?.path).toBe("ViewModels/MainViewModel.cs");
    expect(readFirst[0]?.label).toBe("MainViewModel (class)");
    expect(readFirst.findIndex((node) => node.label === "MainViewModel (class)")).toBeLessThan(
      readFirst.findIndex((node) => node.label === "AboutNavigationService (class)")
    );
    expect(readFirst.findIndex((node) => node.label === "MainViewModel (class)")).toBeLessThan(
      readFirst.findIndex((node) => node.label === "BatchSubtitleWorkflowResult (record)")
    );
    expect(readFirst.findIndex((node) => node.label === "MainViewModel._playbackService (field)")).toBeGreaterThan(
      readFirst.findIndex((node) => node.label === "MainViewModel (class)")
    );
  });
});
