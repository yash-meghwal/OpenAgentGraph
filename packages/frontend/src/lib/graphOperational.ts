import type {
  GraphFusionCheck,
  GraphTaskLensId,
  WorkspaceGraphOperationalContext,
  WorkspaceGraphUnavailableReason,
} from "@openagentgraph/shared";
import { describeWorkspaceGraphEmptyState, GRAPH_TASK_LENS_DEFINITIONS } from "@openagentgraph/shared";

export function fusionCheckTone(severity: GraphFusionCheck["severity"]) {
  switch (severity) {
    case "fail":
      return { border: "#7f1d1d", accent: "#fca5a5", background: "rgba(127, 29, 29, 0.2)" };
    case "warn":
      return { border: "#78350f", accent: "#fcd34d", background: "rgba(120, 53, 15, 0.2)" };
    case "info":
    default:
      return { border: "#1e3a5f", accent: "#93c5fd", background: "rgba(30, 58, 95, 0.2)" };
  }
}

export function healthBadgeTone(tone: "good" | "warn" | "bad") {
  switch (tone) {
    case "good":
      return { border: "#276749", accent: "#68d391" };
    case "bad":
      return { border: "#7f1d1d", accent: "#fca5a5" };
    case "warn":
    default:
      return { border: "#744210", accent: "#f6ad55" };
  }
}

export function workspaceGraphEmptyMessage(context: WorkspaceGraphOperationalContext | null | undefined) {
  if (!context) return "Loading graph operational context...";
  if (!context.available) {
    return describeWorkspaceGraphEmptyState({
      available: false,
      unavailableReason: context.unavailableReason,
      lens: context.lens,
    });
  }
  if (context.unavailableReason === "lens_no_matches") {
    const lensLabel = GRAPH_TASK_LENS_DEFINITIONS.find((definition) => definition.id === context.lens)?.label;
    return describeWorkspaceGraphEmptyState({
      available: true,
      lens: context.lens,
      lensLabel,
      scopedNodeCount: context.scopedNodeCount,
    });
  }
  return "";
}

export function dashboardLensOptions(context: WorkspaceGraphOperationalContext | null | undefined) {
  const summaries = context?.lenses ?? GRAPH_TASK_LENS_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    nodeCount: 0,
    fileCount: 0,
    symbolCount: 0,
    communityCount: 0,
    topPaths: [],
  }));
  return summaries.map((summary) => ({
    id: summary.id as GraphTaskLensId,
    label: summary.label,
    description: summary.description,
    count: summary.fileCount + summary.symbolCount,
  }));
}

export function hardFusionChecks(context: WorkspaceGraphOperationalContext | null | undefined) {
  return (context?.fusion?.checks ?? []).filter((check) => check.severity === "fail");
}

export function warnFusionChecks(context: WorkspaceGraphOperationalContext | null | undefined) {
  return (context?.fusion?.checks ?? []).filter((check) => check.severity === "warn");
}

export function unavailableReasonLabel(reason?: WorkspaceGraphUnavailableReason) {
  switch (reason) {
    case "workspace_not_configured":
      return "Workspace not configured";
    case "no_graph_export":
      return "No graph export";
    case "no_code_scan":
      return "No codebase scan";
    case "lens_no_matches":
      return "Lens has no matches";
    default:
      return "Unavailable";
  }
}