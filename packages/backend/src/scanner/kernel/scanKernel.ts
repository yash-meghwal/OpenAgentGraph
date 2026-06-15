import path from "path";
import type { ProductGraphProjection, SkipReason, UnifiedCodeGraph, WorkspaceKernelProfile } from "@openagentgraph/shared";
import { scanWorkspaceCodebase } from "../codeScanner.js";
import { IgnoreEngine } from "./ignoreEngine.js";
import { buildUnifiedCodeGraph } from "./unifiedGraph.js";
import { detectWorkspaceKernelProfile, kernelProfileDiagnostics } from "./workspaceDetection.js";

export const SCAN_KERNEL_VERSION = "1.0";

export interface KernelScanResult {
  kernelVersion: string;
  workspaceRoot: string;
  scanPlan: Awaited<ReturnType<typeof scanWorkspaceCodebase>>;
  kernelProfile: WorkspaceKernelProfile;
  unifiedGraph: UnifiedCodeGraph;
}

function emptyProjection(): ProductGraphProjection {
  return {
    schemaVersion: "1",
    productGraphId: "kernel-verify",
    nodes: [],
    edges: [],
    events: [],
    summary: {
      nodeCount: 0,
      edgeCount: 0,
      nodesByKind: {},
      edgesByKind: {},
      unresolvedOpenQuestionCount: 0,
      blockedTaskCount: 0,
    },
  };
}

export async function runKernelWorkspaceScan(
  workspaceRoot: string,
  input: {
    projection?: ProductGraphProjection;
    scanLimits?: Parameters<typeof scanWorkspaceCodebase>[0]["scanLimits"];
  } = {}
): Promise<KernelScanResult> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const ignoreEngine = await IgnoreEngine.load(resolvedRoot);
  const scanPlan = await scanWorkspaceCodebase({
    workspaceRoot: resolvedRoot,
    projection: input.projection ?? emptyProjection(),
    scanLimits: input.scanLimits,
  });

  const skippedCounts = new Map<SkipReason, number>();
  for (const [reason, count] of Object.entries(scanPlan.summary.skippedCountsByReason ?? {})) {
    if (typeof count === "number" && count > 0) {
      skippedCounts.set(reason as SkipReason, count);
    }
  }

  const extensionCounts = new Map<string, number>(
    Object.entries(scanPlan.summary.workspaceProfile?.sourceExtensionCounts ?? scanPlan.summary.kernelProfile?.sourceExtensionCounts ?? {})
      .map(([extension, count]) => [extension, count])
  );

  const kernelProfile = await detectWorkspaceKernelProfile(resolvedRoot, {
    ignoreEngine,
    ignoreRules: ignoreEngine.rules,
    sourceExtensionCounts: extensionCounts,
    skippedCountsByReason: skippedCounts,
    warnings: scanPlan.summary.workspaceProfile?.warnings,
  });

  const diagnostics = [
    ...kernelProfileDiagnostics(kernelProfile),
    ignoreEngine.diagnosticsSummary(skippedCounts),
    ...scanPlan.summary.diagnostics,
  ];

  const unifiedGraph = buildUnifiedCodeGraph({
    workspaceRoot: resolvedRoot,
    generatedAt: scanPlan.scannedAt,
    projection: {
      ...(input.projection ?? emptyProjection()),
      nodes: scanPlan.nodes.map((node) => ({
        ...node,
        incomingEdgeIds: [],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      })),
      edges: scanPlan.edges,
      summary: {
        nodeCount: scanPlan.nodes.length,
        edgeCount: scanPlan.edges.length,
        nodesByKind: {},
        edgesByKind: {},
        unresolvedOpenQuestionCount: 0,
        blockedTaskCount: 0,
      },
    },
    kernelProfile,
    diagnostics,
  });

  return {
    kernelVersion: SCAN_KERNEL_VERSION,
    workspaceRoot: resolvedRoot,
    scanPlan,
    kernelProfile,
    unifiedGraph,
  };
}