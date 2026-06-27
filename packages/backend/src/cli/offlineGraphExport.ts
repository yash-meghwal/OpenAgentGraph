import {
  GraphWorkflowTimingCollector,
  type GraphWorkflowTimingReport,
} from "@openagentgraph/shared";
import { buildGraphIncrementalManifest } from "@openagentgraph/shared/graphIncremental";
import type { ProductGraphProjection, UnifiedCodeGraph, WorkspaceKernelProfile } from "@openagentgraph/shared";
import { collectWorkspaceFileFingerprints } from "../scanner/kernel/graphFingerprints.js";
import { GRAPH_INCREMENTAL_TOOL_VERSION } from "../scanner/kernel/graphIncrementalScan.js";
import { runKernelWorkspaceScan, type KernelScanResult } from "../scanner/kernel/scanKernel.js";
import { writeGraphArtifacts, type WriteGraphArtifactsOptions } from "./graphArtifactsWrite.js";

export interface OfflineGraphExportResult {
  graph: UnifiedCodeGraph;
  kernelProfile: WorkspaceKernelProfile;
  scanResult: KernelScanResult;
  writtenPaths: string[];
  stageTimings?: GraphWorkflowTimingReport;
}

export interface OfflineGraphExportOptions extends WriteGraphArtifactsOptions {
  scanResult?: KernelScanResult;
  captureStageTimings?: boolean;
  workflowTiming?: GraphWorkflowTimingCollector;
  scanLimits?: Parameters<typeof runKernelWorkspaceScan>[1] extends infer T
    ? T extends { scanLimits?: infer L } ? L : never
    : never;
  semanticScanLimits?: Parameters<typeof runKernelWorkspaceScan>[1] extends infer T
    ? T extends { semanticScanLimits?: infer L } ? L : never
    : never;
  semanticAnalysisBudget?: Parameters<typeof runKernelWorkspaceScan>[1] extends infer T
    ? T extends { semanticAnalysisBudget?: infer L } ? L : never
    : never;
  projection?: ProductGraphProjection;
}

export async function runOfflineKernelGraphExport(
  workspaceRoot: string,
  options: OfflineGraphExportOptions = {}
) {
  const timing = options.workflowTiming
    ?? (options.captureStageTimings ? new GraphWorkflowTimingCollector() : undefined);
  const scanResult = options.scanResult ?? await runKernelWorkspaceScan(workspaceRoot, {
    workflowTiming: timing,
    captureStageTimings: options.captureStageTimings,
    projection: options.projection,
    scanLimits: options.scanLimits,
    semanticScanLimits: options.semanticScanLimits,
    semanticAnalysisBudget: options.semanticAnalysisBudget,
  });
  const graph = scanResult.unifiedGraph;
  const fingerprintResult = timing
    ? await timing.measure("fingerprint_cache_load", () => collectWorkspaceFileFingerprints(workspaceRoot))
    : await collectWorkspaceFileFingerprints(workspaceRoot);
  const manifest = buildGraphIncrementalManifest({
    graph,
    kernelProfile: scanResult.kernelProfile,
    incrementalToolVersion: GRAPH_INCREMENTAL_TOOL_VERSION,
    ignoreRuleFingerprint: fingerprintResult.ignoreRuleFingerprint,
    files: fingerprintResult.files,
  });

  const artifactOptions = {
    writeJson: true,
    writeHtml: true,
    writeWiki: true,
    writeReport: true,
    manifest,
    kernelProfile: scanResult.kernelProfile,
    workflowTiming: timing,
    ...options,
  } satisfies WriteGraphArtifactsOptions;

  const writtenPaths = timing
    ? await timing.measure("static_artifact_rendering", () => writeGraphArtifacts(workspaceRoot, graph, artifactOptions))
    : await writeGraphArtifacts(workspaceRoot, graph, artifactOptions);

  const stageTimings = timing?.buildReport() ?? scanResult.stageTimings;

  return {
    graph,
    kernelProfile: scanResult.kernelProfile,
    scanResult,
    writtenPaths,
    stageTimings,
  } satisfies OfflineGraphExportResult;
}