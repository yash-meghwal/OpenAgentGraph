import path from "path";
import type { ProductGraphProjection, SkipReason, UnifiedCodeGraph, WorkspaceKernelProfile } from "@openagentgraph/shared";
import {
  flattenEcosystemScannerHealthDiagnostics,
  formatGraphAnalyzerDiagnostics,
  GraphWorkflowTimingCollector,
  type GraphWorkflowTimingReport,
} from "@openagentgraph/shared";
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
  stageTimings?: GraphWorkflowTimingReport;
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
    captureStageTimings?: boolean;
  } = {}
): Promise<KernelScanResult> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const timing = input.captureStageTimings ? new GraphWorkflowTimingCollector() : undefined;
  const ignoreEngine = timing
    ? await timing.measure("workspace_detection", () => IgnoreEngine.load(resolvedRoot))
    : await IgnoreEngine.load(resolvedRoot);
  const scanPlan = await scanWorkspaceCodebase({
    workspaceRoot: resolvedRoot,
    projection: input.projection ?? emptyProjection(),
    scanLimits: input.scanLimits,
    workflowTiming: timing,
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

  const kernelProfile = await (timing
    ? timing.measure("workspace_detection", () => detectWorkspaceKernelProfile(resolvedRoot, {
      ignoreEngine,
      ignoreRules: ignoreEngine.rules,
      sourceExtensionCounts: extensionCounts,
      skippedCountsByReason: skippedCounts,
      warnings: scanPlan.summary.workspaceProfile?.warnings,
    }))
    : detectWorkspaceKernelProfile(resolvedRoot, {
      ignoreEngine,
      ignoreRules: ignoreEngine.rules,
      sourceExtensionCounts: extensionCounts,
      skippedCountsByReason: skippedCounts,
      warnings: scanPlan.summary.workspaceProfile?.warnings,
    }));

  const diagnostics = [
    ...kernelProfileDiagnostics(kernelProfile),
    ignoreEngine.diagnosticsSummary(skippedCounts),
    ...scanPlan.summary.diagnostics,
    ...formatGraphAnalyzerDiagnostics(scanPlan.summary.analyzers),
    ...flattenEcosystemScannerHealthDiagnostics({
      kernelProfile,
      analyzers: scanPlan.summary.analyzers,
    }),
  ];

  timing?.start("community_construction");
  let unifiedGraph;
  try {
    unifiedGraph = buildUnifiedCodeGraph({
      workspaceRoot: resolvedRoot,
      generatedAt: scanPlan.scannedAt,
      analyzers: scanPlan.summary.analyzers,
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
  } finally {
    timing?.end("community_construction");
  }

  return {
    kernelVersion: SCAN_KERNEL_VERSION,
    workspaceRoot: resolvedRoot,
    scanPlan,
    kernelProfile,
    unifiedGraph,
    stageTimings: timing?.buildReport(),
  };
}