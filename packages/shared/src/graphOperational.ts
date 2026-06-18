import type { AgentAnalyzerSummary, AgentCodeContextNodeSummary, AgentEcosystemSupportSummary } from "./types.js";
import type { GraphFusionResult } from "./graphFusion.js";
import type {
  GraphGodNodeSummary,
  GraphHealthSummary,
  GraphLensSummary,
  GraphTaskLensId,
} from "./graphLenses.js";

export type WorkspaceGraphUnavailableReason =
  | "workspace_not_configured"
  | "no_graph_export"
  | "no_code_scan"
  | "lens_no_matches";

export interface WorkspaceGraphQueryEntryPoints {
  queryHint: string;
  pathHint: string;
  explainHint: string;
}

export function buildWorkspaceGraphQueryEntryPoints(input: {
  workspaceRoot: string;
  lens?: GraphTaskLensId;
}): WorkspaceGraphQueryEntryPoints {
  const lens = input.lens ?? "all";
  return {
    queryHint: `npm run graph:query -- --workspace "${input.workspaceRoot}" --lens ${lens} "<search terms>"`,
    pathHint: `npm run graph:path -- --workspace "${input.workspaceRoot}" "<from>" "<to>"`,
    explainHint: `npm run graph:explain -- --workspace "${input.workspaceRoot}" "<node-or-file>"`,
  };
}

export interface WorkspaceGraphOperationalContext {
  available: boolean;
  unavailableReason?: WorkspaceGraphUnavailableReason;
  unavailableDetail?: string;
  workspaceRoot?: string;
  generatedAt?: string;
  fromCache?: boolean;
  lens: GraphTaskLensId;
  primaryLens?: GraphTaskLensId;
  health?: GraphHealthSummary;
  lenses?: GraphLensSummary[];
  godNodes?: GraphGodNodeSummary[];
  fusion?: GraphFusionResult;
  readTheseFirst?: AgentCodeContextNodeSummary[];
  scopedNodeCount?: number;
  scopedEdgeCount?: number;
  activeScannerIds?: string[];
  ecosystemSupport?: AgentEcosystemSupportSummary[];
  analyzers?: AgentAnalyzerSummary[];
  diagnostics?: string[];
  queryEntryPoints?: WorkspaceGraphQueryEntryPoints;
}

export function describeWorkspaceGraphEmptyState(input: {
  available: boolean;
  unavailableReason?: WorkspaceGraphUnavailableReason;
  lens?: GraphTaskLensId;
  lensLabel?: string;
  scopedNodeCount?: number;
}): string {
  if (input.available && input.lens && input.lens !== "all" && (input.scopedNodeCount ?? 0) === 0) {
    const label = input.lensLabel ?? input.lens;
    return `No indexed files match the ${label} lens. Scanned data is still present — switch lenses or run a broader scan.`;
  }
  switch (input.unavailableReason) {
    case "workspace_not_configured":
      return "Configure a workspace root before graph health, lenses, and fusion checks can load.";
    case "no_code_scan":
      return "No codebase scan has run yet. Scan Codebase from Product Graph to populate the Code Map.";
    case "no_graph_export":
      return "No .oag/graph.json export found. Run graph:export or write GRAPH_REPORT.md after scanning to enable lens and fusion views.";
    case "lens_no_matches":
      return describeWorkspaceGraphEmptyState({
        available: true,
        lens: input.lens,
        lensLabel: input.lensLabel,
        scopedNodeCount: 0,
      });
    default:
      return "Graph operational context is not available yet.";
  }
}