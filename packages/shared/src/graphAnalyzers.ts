import type { GraphAnalyzerAvailability, WorkspaceKernelProfile } from "./codeGraph.js";
import type { GraphFusionCheck } from "./graphFusion.js";

export type GraphAnalyzerId = "dotnet-roslyn" | (string & {});

export function formatGraphAnalyzerDiagnostic(analyzer: GraphAnalyzerAvailability) {
  if (analyzer.status === "enabled") {
    const prepared = analyzer.preparedAt ? " (auto-prepared)" : "";
    return `${analyzer.label}: enabled${prepared}.`;
  }
  if (analyzer.status === "disabled") {
    return `${analyzer.label}: disabled.`;
  }
  return `${analyzer.label}: unavailable (${analyzer.fallbackReason ?? "unknown reason"}).`;
}

export function formatGraphAnalyzerDiagnostics(analyzers: GraphAnalyzerAvailability[] | undefined) {
  return (analyzers ?? []).map(formatGraphAnalyzerDiagnostic);
}

export function appendAnalyzerFusionChecks(
  checks: GraphFusionCheck[],
  analyzers: GraphAnalyzerAvailability[] | undefined,
  kernelProfile?: WorkspaceKernelProfile
) {
  if (!analyzers?.length) return;

  const dotnetActive = kernelProfile?.activeScannerIds.includes("dotnet") ?? false;
  for (const analyzer of analyzers) {
    if (analyzer.id === "dotnet-roslyn" && dotnetActive && analyzer.status === "unavailable") {
      checks.push({
        code: "analyzer_unavailable_dotnet_roslyn",
        title: "C# semantic analyzer unavailable",
        severity: "warn",
        detail: analyzer.fallbackReason ?? "Roslyn helper is not available; structural C# indexing still applies.",
      });
    }
  }
}