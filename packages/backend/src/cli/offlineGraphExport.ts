import { buildGraphIncrementalManifest } from "@openagentgraph/shared/graphIncremental";
import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "@openagentgraph/shared";
import { collectWorkspaceFileFingerprints } from "../scanner/kernel/graphFingerprints.js";
import { GRAPH_INCREMENTAL_TOOL_VERSION } from "../scanner/kernel/graphIncrementalScan.js";
import { runKernelWorkspaceScan, type KernelScanResult } from "../scanner/kernel/scanKernel.js";
import { writeGraphArtifacts, type WriteGraphArtifactsOptions } from "./graphArtifactsWrite.js";

export interface OfflineGraphExportResult {
  graph: UnifiedCodeGraph;
  kernelProfile: WorkspaceKernelProfile;
  scanResult: KernelScanResult;
  writtenPaths: string[];
}

export async function runOfflineKernelGraphExport(
  workspaceRoot: string,
  options: WriteGraphArtifactsOptions = {}
) {
  const scanResult = await runKernelWorkspaceScan(workspaceRoot);
  const graph = scanResult.unifiedGraph;
  const fingerprintResult = await collectWorkspaceFileFingerprints(workspaceRoot);
  const manifest = buildGraphIncrementalManifest({
    graph,
    kernelProfile: scanResult.kernelProfile,
    incrementalToolVersion: GRAPH_INCREMENTAL_TOOL_VERSION,
    ignoreRuleFingerprint: fingerprintResult.ignoreRuleFingerprint,
    files: fingerprintResult.files,
  });

  const writtenPaths = await writeGraphArtifacts(workspaceRoot, graph, {
    writeJson: true,
    writeHtml: true,
    writeWiki: true,
    writeReport: true,
    manifest,
    kernelProfile: scanResult.kernelProfile,
    ...options,
  });

  return {
    graph,
    kernelProfile: scanResult.kernelProfile,
    scanResult,
    writtenPaths,
  } satisfies OfflineGraphExportResult;
}