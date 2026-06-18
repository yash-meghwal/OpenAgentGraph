import type { GraphAnalyzerAvailability, GraphAnalyzerMode, ScannerSupportTier, WorkspaceKernelProfile } from "./codeGraph.js";
import type { GraphFusionCheck } from "./graphFusion.js";

export function inferAnalyzerMode(analyzer: GraphAnalyzerAvailability): GraphAnalyzerMode {
  if (analyzer.mode) return analyzer.mode;
  if (analyzer.status === "disabled") return "disabled";
  if (analyzer.status === "unavailable") return "unavailable";
  if (analyzer.tierContribution === "T0") return "semantic";
  if (analyzer.tierContribution === "T1.5") return "semantic-lite";
  return "structural";
}

export type GraphAnalyzerId = "dotnet-roslyn" | (string & {});

export function buildGraphAnalyzerAvailability(
  input: Partial<GraphAnalyzerAvailability> & Pick<GraphAnalyzerAvailability, "id" | "label" | "status">
): GraphAnalyzerAvailability {
  const analyzer: GraphAnalyzerAvailability = {
    requiredRuntime: "optional local toolchain",
    autoBuildCapable: false,
    ...input,
  };
  if (!analyzer.mode) {
    analyzer.mode = inferAnalyzerMode(analyzer);
  }
  return analyzer;
}

export function formatGraphAnalyzerDiagnostic(analyzer: GraphAnalyzerAvailability) {
  const mode = analyzer.mode ?? inferAnalyzerMode(analyzer);
  const tierSuffix = analyzer.tierContribution ? ` (${analyzer.tierContribution} ${mode})` : "";
  if (analyzer.status === "enabled") {
    const prepared = analyzer.preparedAt ? " (auto-prepared)" : "";
    return `${analyzer.label}: enabled${tierSuffix}${prepared}.`;
  }
  if (analyzer.status === "disabled") {
    return `${analyzer.label}: disabled${tierSuffix}.`;
  }
  return `${analyzer.label}: unavailable${tierSuffix} (${analyzer.fallbackReason ?? "unknown reason"}).`;
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
      continue;
    }
    if (analyzer.status === "unavailable" && analyzer.fallbackReason) {
      checks.push({
        code: `analyzer_unavailable_${analyzer.id.replace(/[^a-z0-9]+/gi, "_")}`,
        title: `${analyzer.label} unavailable`,
        severity: "warn",
        detail: analyzer.fallbackReason,
      });
    }
  }
}

export function analyzerModeForTier(tier: ScannerSupportTier): GraphAnalyzerMode {
  if (tier === "T0") return "semantic";
  if (tier === "T1.5") return "semantic-lite";
  return "structural";
}