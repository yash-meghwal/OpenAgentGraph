export const GRAPH_WORKFLOW_TIMING_VERSION = "1.0";

export type GraphWorkflowStageId =
  | "workspace_detection"
  | "fingerprint_cache_load"
  | "file_collection"
  | "structural_indexing"
  | "typescript_semantic_analysis"
  | "roslyn_preparation"
  | "roslyn_analysis"
  | "ecosystem_augmentation"
  | "documentation_indexing"
  | "community_construction"
  | "static_artifact_rendering"
  | "product_graph_handoff"
  | "total";

export interface GraphWorkflowStageTiming {
  stage: GraphWorkflowStageId;
  durationMs: number;
}

export interface GraphWorkflowTimingReport {
  version: string;
  stages: GraphWorkflowStageTiming[];
  totalMs: number;
  duplicateKernelScanCount?: number;
}

export class GraphWorkflowTimingCollector {
  private readonly startedAt = Date.now();
  private readonly stageStarts = new Map<GraphWorkflowStageId, number>();
  private readonly stageDurations = new Map<GraphWorkflowStageId, number>();
  private duplicateKernelScanCount = 0;

  start(stage: GraphWorkflowStageId) {
    this.stageStarts.set(stage, Date.now());
  }

  end(stage: GraphWorkflowStageId) {
    const started = this.stageStarts.get(stage);
    if (started === undefined) return;
    const elapsed = Date.now() - started;
    this.stageDurations.set(stage, (this.stageDurations.get(stage) ?? 0) + elapsed);
    this.stageStarts.delete(stage);
  }

  async measure<T>(stage: GraphWorkflowStageId, work: () => Promise<T> | T): Promise<T> {
    this.start(stage);
    try {
      return await work();
    } finally {
      this.end(stage);
    }
  }

  recordDuplicateKernelScan(count = 1) {
    this.duplicateKernelScanCount += count;
  }

  buildReport(redactPaths = false): GraphWorkflowTimingReport {
    const stages = [...this.stageDurations.entries()]
      .map(([stage, durationMs]) => ({ stage, durationMs }))
      .sort((left, right) => left.stage.localeCompare(right.stage));
    const measuredTotal = stages.reduce((sum, entry) => sum + entry.durationMs, 0);
    const wallClockMs = Date.now() - this.startedAt;
    const totalMs = Math.max(measuredTotal, wallClockMs, this.stageDurations.get("total") ?? 0);
    return {
      version: GRAPH_WORKFLOW_TIMING_VERSION,
      stages,
      totalMs,
      duplicateKernelScanCount: this.duplicateKernelScanCount,
    };
  }
}

export function summarizeGraphWorkflowTiming(report: GraphWorkflowTimingReport) {
  const lines = [
    `Workflow timing v${report.version}: total ${report.totalMs}ms`,
    ...report.stages.map((entry) => `- ${entry.stage}: ${entry.durationMs}ms`),
  ];
  if (typeof report.duplicateKernelScanCount === "number") {
    lines.push(`- duplicate_kernel_scans: ${report.duplicateKernelScanCount}`);
  }
  return lines;
}