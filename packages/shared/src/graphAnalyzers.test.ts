import { describe, expect, it } from "vitest";
import type { GraphAnalyzerAvailability } from "./codeGraph.js";
import { appendAnalyzerFusionChecks, formatGraphAnalyzerDiagnostic } from "./graphAnalyzers.js";
import type { GraphFusionCheck } from "./graphFusion.js";

const roslynUnavailable: GraphAnalyzerAvailability = {
  id: "dotnet-roslyn",
  label: "C# Roslyn semantic analyzer",
  requiredRuntime: ".NET SDK (dotnet CLI)",
  buildProbeCommand: "dotnet build scanner-tools/roslyn-helper/RoslynHelper.csproj -c Release",
  status: "unavailable",
  fallbackReason: "dotnet CLI unavailable.",
  autoBuildCapable: true,
};

describe("graph analyzers", () => {
  it("formats enabled, disabled, and unavailable analyzer states", () => {
    expect(formatGraphAnalyzerDiagnostic({
      ...roslynUnavailable,
      status: "enabled",
      preparedAt: "2026-01-01T00:00:00.000Z",
    })).toBe("C# Roslyn semantic analyzer: enabled (auto-prepared).");
    expect(formatGraphAnalyzerDiagnostic({
      ...roslynUnavailable,
      status: "disabled",
    })).toBe("C# Roslyn semantic analyzer: disabled.");
    expect(formatGraphAnalyzerDiagnostic(roslynUnavailable))
      .toBe("C# Roslyn semantic analyzer: unavailable (dotnet CLI unavailable.).");
  });

  it("warns in fusion checks when dotnet scanner is active but Roslyn is unavailable", () => {
    const checks: GraphFusionCheck[] = [];
    appendAnalyzerFusionChecks(checks, [roslynUnavailable], {
      schemaVersion: "1.0",
      root: "/repo",
      effectiveRoots: ["/repo"],
      primaryType: "csharp-wpf",
      secondaryTypes: [],
      typeSignals: [],
      sourceRoots: ["."],
      markerPaths: ["App.sln"],
      activeScannerIds: ["dotnet"],
      ignoreRules: [],
      sourceExtensionCounts: { ".cs": 3 },
      skippedCountsByReason: {},
      warnings: [],
    });

    expect(checks).toEqual([
      expect.objectContaining({
        code: "analyzer_unavailable_dotnet_roslyn",
        severity: "warn",
      }),
    ]);
  });
});