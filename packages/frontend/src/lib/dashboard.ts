import type {
  DashboardFilter,
  DashboardOverview,
  DashboardRunSummary,
  DashboardSort,
} from "@openagentgraph/shared";

function severityRank(severity?: DashboardRunSummary["highestAlertSeverity"]): number {
  return severity === "critical" ? 3 : severity === "warning" ? 2 : severity === "info" ? 1 : 0;
}

export function sortDashboardItems(
  items: DashboardRunSummary[],
  sort: DashboardSort
): DashboardRunSummary[] {
  const sorted = [...items];

  sorted.sort((left, right) => {
    if (sort === "progress") {
      const leftProgress = left.plannedNodeCount > 0 ? left.completedNodeCount / left.plannedNodeCount : 0;
      const rightProgress = right.plannedNodeCount > 0 ? right.completedNodeCount / right.plannedNodeCount : 0;
      if (rightProgress !== leftProgress) return rightProgress - leftProgress;
      if (right.completedNodeCount !== left.completedNodeCount) {
        return right.completedNodeCount - left.completedNodeCount;
      }
      return left.graphId.localeCompare(right.graphId);
    }

    if (sort === "most_recent") {
      const timeDiff = (right.lastEventAt ?? "").localeCompare(left.lastEventAt ?? "");
      if (timeDiff !== 0) return timeDiff;
      return left.graphId.localeCompare(right.graphId);
    }

    if (right.attentionScore !== left.attentionScore) {
      return right.attentionScore - left.attentionScore;
    }
    const severityDiff = severityRank(right.highestAlertSeverity) - severityRank(left.highestAlertSeverity);
    if (severityDiff !== 0) return severityDiff;
    return left.graphId.localeCompare(right.graphId);
  });

  return sorted;
}

export function filterDashboardItems(
  items: DashboardRunSummary[],
  filter: DashboardFilter
): DashboardRunSummary[] {
  switch (filter) {
    case "needs_review":
      return items.filter((item) => item.needsHumanReview);
    case "blocked":
      return items.filter((item) => item.frontierStatus === "blocked");
    case "active":
      return items.filter((item) => item.runControlState === "running");
    case "completed":
      return items.filter((item) => item.graphStatus === "completed");
    case "attention_first":
      return items.filter((item) => item.attentionScore >= 25);
    case "all":
    default:
      return items;
  }
}

export function findMostUrgentRun(items: DashboardRunSummary[]): DashboardRunSummary | null {
  return sortDashboardItems(items, "highest_attention")[0] ?? null;
}

export function summarizeDashboard(items: DashboardRunSummary[]): DashboardOverview["summary"] {
  return {
    urgentRunCount: items.filter((item) => item.attentionLabel === "urgent").length,
    needsReviewCount: items.filter((item) => item.needsHumanReview).length,
    blockedRunCount: items.filter((item) => item.frontierStatus === "blocked").length,
    activeRunCount: items.filter((item) => item.runControlState === "running").length,
    archivedRunCount: items.filter((item) => item.lifecycleBucket === "archived").length,
  };
}
