import { describe, expect, it } from "vitest";
import type { DashboardRunSummary } from "@openagentgraph/shared";
import { filterDashboardItems, findMostUrgentRun, sortDashboardItems, summarizeDashboard } from "./dashboard.js";

function makeItem(overrides: Partial<DashboardRunSummary> = {}): DashboardRunSummary {
  return {
    graphId: "graph-1",
    goalTitle: "Build dashboard",
    lifecycleBucket: "active",
    graphStatus: "running",
    runControlState: "running",
    frontierStatus: "on_track",
    needsHumanReview: false,
    approvalState: "not_requested",
    waitingForApproval: false,
    latestDecisionSummary: undefined,
    latestNotificationSummary: "Everything is on track.",
    alertCount: 0,
    completedNodeCount: 1,
    plannedNodeCount: 3,
    passRate: 1,
    revisionRate: 0,
    evidenceCoverageRate: 0.8,
    lastEventAt: "2026-04-16T10:00:00.000Z",
    lastEventSequence: 4,
    attentionScore: 10,
    attentionLabel: "low",
    ...overrides,
  };
}

describe("dashboard helpers", () => {
  it("keeps summary counts stable when client-side filtering changes", () => {
    const items = [
      makeItem({ graphId: "graph-1", attentionScore: 120, attentionLabel: "urgent", needsHumanReview: true }),
      makeItem({ graphId: "graph-2", frontierStatus: "blocked", runControlState: "paused", attentionScore: 70, attentionLabel: "high" }),
    ];

    const baseSummary = summarizeDashboard(items);
    const filtered = filterDashboardItems(items, "needs_review");
    expect(filtered).toHaveLength(1);
    expect(summarizeDashboard(items)).toEqual(baseSummary);
  });

  it("finds the most urgent run deterministically", () => {
    const items = [
      makeItem({ graphId: "graph-b", attentionScore: 100, attentionLabel: "urgent" }),
      makeItem({ graphId: "graph-a", attentionScore: 100, attentionLabel: "urgent" }),
    ];

    expect(findMostUrgentRun(items)?.graphId).toBe("graph-a");
  });

  it("sorts dashboard items by progress deterministically", () => {
    const items = [
      makeItem({ graphId: "graph-a", completedNodeCount: 1, plannedNodeCount: 4 }),
      makeItem({ graphId: "graph-b", completedNodeCount: 3, plannedNodeCount: 4 }),
    ];

    expect(sortDashboardItems(items, "progress").map((item) => item.graphId)).toEqual(["graph-b", "graph-a"]);
  });

  it("keeps blocked runs visible in the blocked filter without changing alert-derived data", () => {
    const blocked = makeItem({
      graphId: "graph-blocked",
      frontierStatus: "blocked",
      highestAlertSeverity: "critical",
      attentionScore: 140,
      attentionLabel: "urgent",
      latestNotificationSummary: "The run cannot continue because no runnable step is available.",
    });

    const filtered = filterDashboardItems([blocked], "blocked");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.highestAlertSeverity).toBe("critical");
    expect(filtered[0]?.latestNotificationSummary).toBe(
      "The run cannot continue because no runnable step is available."
    );
  });
});
