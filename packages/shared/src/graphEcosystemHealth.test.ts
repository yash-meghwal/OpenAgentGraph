import { describe, expect, it } from "vitest";
import type { WorkspaceKernelProfile } from "./codeGraph.js";
import {
  buildEcosystemScannerHealthSections,
  buildEcosystemSupportMatrix,
  buildTypeScriptSemanticHealthLine,
  flattenEcosystemScannerHealthDiagnostics,
  parseExtensionCounts,
  renderEcosystemScannerHealthMarkdown,
  renderEcosystemSupportMatrixMarkdown,
  renderEcosystemTierLegendMarkdown,
  scanMetadataToHealthInput,
  shouldReportTypeScriptSemanticHealth,
  summarizeEcosystemSupportForAgents,
} from "./graphEcosystemHealth.js";
import type { UnifiedCodeGraph } from "./codeGraph.js";

function makeProfile(overrides: Partial<WorkspaceKernelProfile> = {}): WorkspaceKernelProfile {
  return {
    schemaVersion: "1.0",
    root: "/workspace",
    effectiveRoots: ["/workspace"],
    primaryType: "generic",
    secondaryTypes: [],
    typeSignals: [],
    sourceRoots: ["."],
    markerPaths: [],
    activeScannerIds: ["generic"],
    ignoreRules: [],
    sourceExtensionCounts: {},
    skippedCountsByReason: {},
    warnings: [],
    ...overrides,
  };
}

describe("graph ecosystem health", () => {
  it("reports .NET solution health without TypeScript config language", () => {
    const sections = buildEcosystemScannerHealthSections({
      kernelProfile: makeProfile({
        primaryType: "csharp-wpf",
        activeScannerIds: ["dotnet"],
        markerPaths: ["SampleMediaPlayer.sln", "SampleMediaPlayer.App/SampleMediaPlayer.App.csproj"],
        sourceExtensionCounts: { ".cs": 12, ".xaml": 2 },
      }),
      analyzers: [{
        id: "dotnet-roslyn",
        label: "C# Roslyn semantic analyzer",
        requiredRuntime: ".NET SDK (dotnet CLI)",
        status: "enabled",
        autoBuildCapable: true,
      }],
    });

    const markdown = renderEcosystemScannerHealthMarkdown({
      kernelProfile: makeProfile({
        primaryType: "csharp-wpf",
        activeScannerIds: ["dotnet"],
        markerPaths: ["SampleMediaPlayer.sln"],
        sourceExtensionCounts: { ".cs": 12 },
      }),
    }).join("\n");

    expect(sections.some((section) => section.scannerId === "dotnet")).toBe(true);
    expect(sections.some((section) => section.scannerId === "typescript")).toBe(false);
    expect(markdown).toContain(".NET solution/project detected");
    expect(markdown).not.toContain("TypeScript project config");
  });

  it("reports documentation corpus mode honestly", () => {
    const markdown = renderEcosystemScannerHealthMarkdown({
      kernelProfile: makeProfile({
        primaryType: "documentation-corpus",
        activeScannerIds: ["generic"],
        sourceExtensionCounts: { ".md": 8 },
      }),
    }).join("\n");

    expect(markdown).toContain("Documentation corpus mode");
    expect(markdown).not.toContain("TypeScript");
  });

  it("omits TypeScript semantic health when no TS/JS sources were scanned", () => {
    expect(shouldReportTypeScriptSemanticHealth({
      activeScannerIds: ["dotnet"],
      sourceExtensionCounts: { ".cs": 4 },
    })).toBe(false);
    expect(buildTypeScriptSemanticHealthLine({
      scannerActiveScannerIds: "dotnet",
      scannerSourceExtensionCounts: ".cs:4",
      scannerSemanticAnalysisEnabled: false,
      scannerSemanticFallbackReason: "No TypeScript project config covered scanned source files.",
    })).toBeUndefined();
  });

  it("parses colon-form extension counts from scan metadata producers", () => {
    const producerSummary = ".tsx:1, .js:1, .cs:12";
    expect([...parseExtensionCounts(producerSummary).entries()]).toEqual([
      [".tsx", 1],
      [".js", 1],
      [".cs", 12],
    ]);
    expect(shouldReportTypeScriptSemanticHealth({
      sourceExtensionSummary: producerSummary,
    })).toBe(true);

    const healthInput = scanMetadataToHealthInput({
      scannerSourceExtensionCounts: producerSummary,
      scannerSemanticAnalysisEnabled: true,
      scannerSemanticAnalysisSucceeded: false,
      scannerSemanticFallbackReason: "No TypeScript project config covered scanned source files.",
    });
    expect(buildTypeScriptSemanticHealthLine(healthInput)).toContain("TypeScript semantic analysis: fallback");
  });

  it("still accepts legacy equals-form extension counts", () => {
    expect([...parseExtensionCounts(".ts=2,.tsx=1").entries()]).toEqual([
      [".ts", 2],
      [".tsx", 1],
    ]);
  });

  it("avoids doubled punctuation in flattened ecosystem diagnostics", () => {
    const lines = flattenEcosystemScannerHealthDiagnostics({
      kernelProfile: makeProfile({
        primaryType: "documentation-corpus",
        activeScannerIds: ["generic"],
        sourceExtensionCounts: { ".md": 8 },
      }),
    });

    expect(lines.some((line) => line.endsWith(".."))).toBe(false);
    expect(lines.join("\n")).toContain("Documentation corpus mode:");
  });

  it("includes game engine and mobile ecosystem health sections", () => {
    const sections = buildEcosystemScannerHealthSections({
      kernelProfile: makeProfile({
        primaryType: "godot-project",
        activeScannerIds: ["godot", "unity", "unreal", "swift", "cpp", "flutter"],
        markerPaths: ["project.godot", "ProjectSettings/ProjectVersion.txt", "Demo.uproject", "Package.swift", "CMakeLists.txt", "pubspec.yaml"],
      }),
    });

    expect(sections.map((section) => section.scannerId)).toEqual(
      expect.arrayContaining(["godot", "unity", "unreal", "swift", "cpp", "flutter"])
    );
  });

  it("renders support matrix and tier legend for active scanners", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1.0",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      nodes: [
        { id: "file:1", kind: "code_file", label: "scripts/player.gd", path: "scripts/player.gd" },
        { id: "sym:1", kind: "symbol", label: "Player", path: "scripts/player.gd" },
      ],
      edges: [],
      activeScannerIds: ["godot"],
      diagnostics: [],
    };
    const matrix = renderEcosystemSupportMatrixMarkdown({
      graph,
      kernelProfile: makeProfile({
        primaryType: "godot-project",
        activeScannerIds: ["godot"],
      }),
    });
    expect(matrix.join("\n")).toContain("godot (T1)");
    expect(renderEcosystemTierLegendMarkdown().join("\n")).toContain("T1.5");
    expect(summarizeEcosystemSupportForAgents({
      graph,
      kernelProfile: makeProfile({ activeScannerIds: ["godot"], primaryType: "godot-project" }),
    })[0]?.tier).toBe("T1");
    expect(buildEcosystemSupportMatrix({
      graph,
      kernelProfile: makeProfile({ activeScannerIds: ["godot"], primaryType: "godot-project" }),
    })[0]?.semanticSupported).toBe(false);
  });

  it("includes multiple ecosystem blocks for mixed-polyglot profiles", () => {
    const sections = buildEcosystemScannerHealthSections({
      kernelProfile: makeProfile({
        primaryType: "mixed-polyglot",
        secondaryTypes: ["typescript"],
        activeScannerIds: ["dotnet", "typescript", "python"],
        markerPaths: ["App.sln", "package.json", "pyproject.toml"],
        sourceExtensionCounts: { ".cs": 3, ".ts": 2, ".py": 4 },
      }),
    });

    expect(sections.map((section) => section.scannerId)).toEqual(
      expect.arrayContaining(["dotnet", "typescript", "python"])
    );
  });
});