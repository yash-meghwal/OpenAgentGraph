import type {
  AnnotationRecord,
  ApprovalState,
  ChangesSinceLastViewed,
  ConfidenceBadge,
  DriftTrend,
  EvidenceCoverage,
  FrontierStatus,
  GraphAlert,
  LineageDescriptor,
  RunComparison,
  RunComparisonSide,
  GoalPacket,
  Graph,
  GraphEvent,
  GraphProjection,
  Node,
  RunControlState,
} from "./types";
import { toPlainEnglishFailureSummary, toPlainEnglishSummary } from "./safeText";

export interface PlainEnglishReportInput {
  graph: Graph;
  nodes: Node[];
  frontierStatus: FrontierStatus;
  currentDriftSummary: string | null;
  originalGoalText?: string;
  runHealthSummary?: string;
  attentionSummary?: string;
  decisionSummary?: string;
  lineageSummary?: string;
  peopleSummary?: string;
}

export interface GraphRunReportNode {
  id: string;
  title: string;
  kind: Node["kind"];
  status: Node["status"];
  humanSummary: string;
  semanticSummary?: string;
  evidenceSummary?: string;
  branchId?: string;
  parentNodeId?: string;
  depth: number;
  createdAt: string;
  activeGoalVersionId: string;
  evidenceCoverage?: EvidenceCoverage;
  confidenceBadge?: ConfidenceBadge;
  lineageSummary?: string;
  lineageBindings?: Node["lineageBindings"];
}

export interface GraphRunReport {
  schemaVersion: "1";
  graphId: string;
  graphStatus: Graph["status"];
  runControlState: RunControlState;
  frontierStatus: FrontierStatus;
  driftSummary: string | null;
  runHealthSummary: string;
  approvalState: ApprovalState;
  waitingForApproval: boolean;
  latestDecisionSummary?: string;
  peopleSummary?: string;
  lineageSummary?: string;
  needsHumanReview: boolean;
  humanReviewReason?: string;
  reviewRequestedAt?: string;
  annotations: AnnotationRecord[];
  plainEnglishReport: string;
  lineage: {
    lineageDescriptors: LineageDescriptor[];
    lineageCount: number;
    latestPlannerLineageSummary?: string;
    latestExecutorLineageSummary?: string;
    latestEvaluatorLineageSummary?: string;
    latestRetrieverLineageSummary?: string;
    latestPolicyLineageSummary?: string;
  };
  goalPackets: Array<Pick<GoalPacket, "id" | "version" | "originalText" | "successCriteria" | "forbiddenScope" | "createdAt">>;
  nodes: GraphRunReportNode[];
  revisions: Array<{
    id: string;
    title: string;
    kind: Node["kind"];
    humanSummary: string;
    branchId?: string;
    parentNodeId?: string;
    createdAt: string;
  }>;
  replay: {
    eventCount: number;
    latestEventTimestamp: string | null;
  };
  health: {
    plannedNodeCount: number;
    completedNodeCount: number;
    failedNodeCount: number;
    supersededNodeCount: number;
    revisedNodeCount: number;
    passRate: number;
    revisionRate: number;
    driftTrend: DriftTrend;
    evidenceCoverageRate: number;
  };
  alerts: GraphAlert[];
  latestNotificationSummary?: string;
  changesSinceLastViewed?: ChangesSinceLastViewed;
}

function summarizeComparison(left: RunComparisonSide, right: RunComparisonSide): string {
  const progressWinner =
    left.completedNodeCount === right.completedNodeCount
      ? null
      : left.completedNodeCount > right.completedNodeCount
        ? left
        : right;
  const reviewRun =
    left.needsHumanReview && !right.needsHumanReview
      ? left
      : right.needsHumanReview && !left.needsHumanReview
        ? right
        : null;

  if (progressWinner && reviewRun && progressWinner.graphId !== reviewRun.graphId) {
    return `${progressWinner.goalTitle} completed more planned work, while ${reviewRun.goalTitle} currently needs review.`;
  }

  if (progressWinner) {
    return `${progressWinner.goalTitle} completed more planned work than the other run.`;
  }

  if (reviewRun) {
    return `${reviewRun.goalTitle} currently needs review, while the other run is steadier.`;
  }

  if (left.evaluatorVersion !== right.evaluatorVersion && left.evaluatorVersion && right.evaluatorVersion) {
    return `${left.goalTitle} and ${right.goalTitle} used different evaluator versions, which may explain score differences.`;
  }

  if (left.executorVersion !== right.executorVersion && left.executorVersion && right.executorVersion) {
    return `${left.goalTitle} and ${right.goalTitle} used different executor versions during real work.`;
  }

  return "Both runs are in a similar state right now, with no major difference in recent progress.";
}

function frontierToPlainEnglish(status: FrontierStatus): string {
  switch (status) {
    case "on_track":
      return "On track";
    case "exploring":
      return "Exploring";
    case "drifting":
      return "Drifting";
    case "blocked":
      return "Blocked";
  }
}

function safeNodeSummary(node: Node): string {
  if (node.status === "failed" || node.evaluation?.passed === false) {
    return toPlainEnglishFailureSummary(
      node.evaluation?.humanSummary?.trim() ||
        node.evidenceSummary?.trim() ||
        node.humanSummary?.trim(),
      "This step didn't complete as expected. The system is deciding what to do next."
    );
  }

  return toPlainEnglishSummary(
    node.semanticSummary?.trim() ||
      node.evidenceSummary?.trim() ||
      node.humanSummary?.trim(),
    "This step is waiting for a plain-English summary."
  );
}

export function sortNodesForReport(nodes: Node[]): Node[] {
  return [...nodes].sort((a, b) => {
    const depthDiff = (a.coordinates?.depth ?? 0) - (b.coordinates?.depth ?? 0);
    if (depthDiff !== 0) return depthDiff;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function buildPlainEnglishRunReport(input: PlainEnglishReportInput): string {
  const sortedNodes = sortNodesForReport(input.nodes);
  const plannedSteps = sortedNodes.filter((node) => node.kind !== "revision" && node.kind !== "replan");
  const completedSteps = plannedSteps.filter((node) => node.status === "completed");
  const worked = [...completedSteps]
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 5)
    .map((node) => `- ${safeNodeSummary(node)}`);
  const revised = [...sortedNodes]
    .filter((node) => node.kind === "revision" || node.kind === "replan" || Boolean(node.branchId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3)
    .map((node) => `- ${safeNodeSummary(node)}`);

  return [
    `Goal: ${input.originalGoalText ?? input.graph.goal}`,
    `Progress: ${completedSteps.length} of ${plannedSteps.length} planned steps completed`,
    "Recent progress:",
    ...(worked.length > 0 ? worked : ["- No completed steps yet."]),
    "Course changes:",
    ...(revised.length > 0 ? revised : ["- No revisions or replans yet."]),
    "Current status:",
    input.currentDriftSummary ?? "The run has not produced enough evaluated work to assess drift yet.",
    "Frontier:",
    frontierToPlainEnglish(input.frontierStatus),
    `Run health: ${input.runHealthSummary ?? "The run health summary is not available yet."}`,
    `Attention: ${input.attentionSummary ?? "No important updates right now."}`,
    `Decision: ${input.decisionSummary ?? "No pending decision."}`,
    `Lineage: ${input.lineageSummary ?? "Lineage information is not available."}`,
    `People: ${input.peopleSummary ?? "No recent human actions."}`,
  ].join("\n");
}

export function buildGraphRunReport(params: {
  projection: GraphProjection;
  events: GraphEvent[];
}): GraphRunReport {
  const { projection, events } = params;
  const orderedNodes = sortNodesForReport(projection.nodes);

  return {
    schemaVersion: "1",
    graphId: projection.graph.id,
    graphStatus: projection.graph.status,
    runControlState: projection.runControlState,
    frontierStatus: projection.frontierStatus,
    driftSummary: projection.currentDriftSummary,
    runHealthSummary: projection.runHealthSummary,
    approvalState: projection.approvalState,
    waitingForApproval: projection.waitingForApproval,
    latestDecisionSummary: projection.latestDecisionSummary,
    peopleSummary: projection.peopleSummary,
    lineageSummary: projection.lineageSummary,
    needsHumanReview: projection.needsHumanReview,
    humanReviewReason: projection.humanReviewReason,
    reviewRequestedAt: projection.reviewRequestedAt,
    annotations: [
      ...projection.graphAnnotations,
      ...projection.nodes.flatMap((node) => node.annotations ?? []),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    lineage: {
      lineageDescriptors: projection.lineageDescriptors,
      lineageCount: projection.lineageCount,
      latestPlannerLineageSummary: projection.latestPlannerLineageSummary,
      latestExecutorLineageSummary: projection.latestExecutorLineageSummary,
      latestEvaluatorLineageSummary: projection.latestEvaluatorLineageSummary,
      latestRetrieverLineageSummary: projection.latestRetrieverLineageSummary,
      latestPolicyLineageSummary: projection.latestPolicyLineageSummary,
    },
    plainEnglishReport: buildPlainEnglishRunReport({
      graph: projection.graph,
      nodes: projection.nodes,
      frontierStatus: projection.frontierStatus,
      currentDriftSummary: projection.currentDriftSummary,
      runHealthSummary: projection.runHealthSummary,
      attentionSummary: projection.latestNotificationSummary ?? "No important updates right now.",
      decisionSummary: projection.latestDecisionSummary ?? "No pending decision.",
      lineageSummary: projection.lineageSummary ?? "Lineage information is not available.",
      peopleSummary: projection.peopleSummary ?? "No recent human actions.",
      originalGoalText:
        projection.goalPackets.find((packet) => packet.id === projection.graph.originalGoalVersionId)?.originalText ??
        projection.graph.goal,
    }),
    goalPackets: projection.goalPackets.map((packet) => ({
      id: packet.id,
      version: packet.version,
      originalText: packet.originalText,
      successCriteria: packet.successCriteria,
      forbiddenScope: packet.forbiddenScope,
      createdAt: packet.createdAt,
    })),
    nodes: orderedNodes.map((node) => ({
      id: node.id,
      title: node.title,
      kind: node.kind,
      status: node.status,
      humanSummary: safeNodeSummary(node),
      semanticSummary: node.semanticSummary,
      evidenceSummary: node.evidenceSummary,
      branchId: node.branchId,
      parentNodeId: node.parentNodeId,
      depth: node.coordinates?.depth ?? 0,
      createdAt: node.createdAt,
      activeGoalVersionId: node.activeGoalVersionId,
      evidenceCoverage: node.evidenceCoverage,
      confidenceBadge: node.confidenceBadge,
      lineageSummary: node.lineageSummary,
      lineageBindings: node.lineageBindings,
    })),
    revisions: orderedNodes
      .filter((node) => node.kind === "revision" || node.kind === "replan" || Boolean(node.branchId))
      .map((node) => ({
        id: node.id,
        title: node.title,
        kind: node.kind,
        humanSummary: safeNodeSummary(node),
        branchId: node.branchId,
        parentNodeId: node.parentNodeId,
        createdAt: node.createdAt,
      })),
    replay: {
      eventCount: events.length,
      latestEventTimestamp: events.at(-1)?.ts ?? null,
    },
    health: {
      plannedNodeCount: projection.plannedNodeCount,
      completedNodeCount: projection.completedNodeCount,
      failedNodeCount: projection.failedNodeCount,
      supersededNodeCount: projection.supersededNodeCount,
      revisedNodeCount: projection.revisedNodeCount,
      passRate: projection.passRate,
      revisionRate: projection.revisionRate,
      driftTrend: projection.driftTrend,
      evidenceCoverageRate: projection.evidenceCoverageRate,
    },
    alerts: projection.alerts,
    latestNotificationSummary: projection.latestNotificationSummary,
  };
}

export function buildRunComparison(left: RunComparisonSide, right: RunComparisonSide): RunComparison {
  return {
    left,
    right,
    summary: summarizeComparison(left, right),
  };
}
