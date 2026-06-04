import { asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  ActorIdentity,
  AgentActivityRecord,
  AgentEvidenceSubmittedPayload,
  AgentPlanAcceptedPayload,
  AgentPlanDismissedPayload,
  AgentPlanProposedPayload,
  AgentPlanProposalRecord,
  AgentProgressReportedPayload,
  AgentRegisteredPayload,
  AnnotationEventPayload,
  AnnotationRecord,
  AttentionLabel,
  AlertSeverity,
  AlertType,
  ApprovalState,
  ChangesSinceLastViewed,
  ConfidenceBadge,
  DashboardLifecycleBucket,
  DashboardOverview,
  DashboardRunSummary,
  GraphRunReport,
  CreateGraphRequest,
  DriftTrend,
  Edge,
  EvidenceCoverage,
  FrontierStatus,
  GraphAlert,
  GoalPacket,
  Graph,
  GraphCoordinates,
  GraphEvent,
  GraphEventKind,
  GraphEventPayloadMap,
  GraphProjection,
  GraphCapabilities,
  HumanDriftState,
  LineageDescriptor,
  Node,
  NodeLineageBoundPayload,
  ReplayFrame,
  NodeCompletedPayload,
  NodeEvaluatedPayload,
  NodeFailedPayload,
  NodeOutputPayload,
  NodePlannedPayload,
  NodeReadyPayload,
  NodeSummarizedPayload,
  NodeSupersededPayload,
  NodeToolCallPayload,
  SystemLineageDeclaredPayload,
  RelevantNodeOutput,
  ReplanBranchedPayload,
  RunComparison,
  RunControlState,
  RunCompletedPayload,
  DecisionEventPayload,
  RunFailedPayload,
  RunPausedPayload,
  RunPauseRequestedPayload,
  RunResumedPayload,
  RunResumeRequestedPayload,
  RunReviewRequestedPayload,
  RunStartedPayload,
  RunStopRequestedPayload,
  RunStoppedPayload,
  SimilarRunSummary,
} from "@openagentgraph/shared";
import { applyTailSamplingToGraphEventPayload, buildGraphRunReport, buildRunComparison } from "@openagentgraph/shared";
import { toPlainEnglishFailureSummary, toPlainEnglishSummary } from "@openagentgraph/shared";
import { deriveCapabilities } from "../auth/actors.js";
import { getAppConfig } from "../config.js";
import { exportGraphEventToOpenTelemetry } from "../observability/otel.js";
import { db } from "./client.js";
import { graphEvents } from "./schema.js";

function now() {
  return new Date().toISOString();
}

function describeActor(actor?: ActorIdentity, fallback = "A human"): string {
  if (!actor) return fallback;
  return actor.displayName || fallback;
}

function describeActorWithRole(actor?: ActorIdentity, fallback = "A human"): string {
  if (!actor) return fallback;
  if (actor.role === "reviewer") return `A reviewer (${actor.displayName})`;
  if (actor.role === "operator") return `An operator (${actor.displayName})`;
  if (actor.role === "admin") return `An admin (${actor.displayName})`;
  return actor.displayName || fallback;
}

function buildDecisionSummary(kind: GraphEvent["kind"], payload: DecisionEventPayload): string {
  switch (kind) {
    case "run.approval_requested":
      return "This run is waiting for approval before continuing.";
    case "run.approved":
      return `${describeActorWithRole(payload.actor, "A human")} approved this run to continue.`;
    case "run.rejected":
      return `${describeActorWithRole(payload.actor, "A reviewer")} rejected continuation and the run is paused for human input.`;
    case "run.continue_requested":
      return `${describeActor(payload.actor, "A human")} asked this run to continue after review.`;
    default:
      return "A human decision changed the run's supervision state.";
  }
}

function buildHumanEventSummary(event: GraphEvent): string | undefined {
  switch (event.kind) {
    case "run.annotated":
    case "node.annotated":
      return buildAnnotationSummary(event.payload as AnnotationRecord);
    case "run.review_requested": {
      const payload = event.payload as RunReviewRequestedPayload;
      return `${describeActor(payload.actor, "A user")} requested review. This run was marked for human review.`;
    }
    case "run.pause_requested": {
      const payload = event.payload as RunPauseRequestedPayload;
      return `${describeActorWithRole(payload.actor, "An operator")} paused the run after the current step.`;
    }
    case "run.resume_requested": {
      const payload = event.payload as RunResumeRequestedPayload;
      return `${describeActorWithRole(payload.actor, "An operator")} resumed the run.`;
    }
    case "run.stop_requested": {
      const payload = event.payload as RunStopRequestedPayload;
      return `${describeActorWithRole(payload.actor, "An operator")} asked the run to stop after the current step.`;
    }
    case "run.approval_requested":
      return `${describeActor((event.payload as DecisionEventPayload).actor, "A user")} requested approval. This run is waiting for approval before continuing.`;
    case "run.approved":
    case "run.rejected":
    case "run.continue_requested":
      return buildDecisionSummary(event.kind, event.payload as DecisionEventPayload);
    case "agent.registered": {
      const payload = event.payload as AgentRegisteredPayload;
      return `${payload.agent.displayName} registered as an external agent.`;
    }
    case "agent.progress_reported": {
      const payload = event.payload as AgentProgressReportedPayload;
      return `${payload.agent.displayName} reported ${payload.status}: ${toPlainEnglishSummary(payload.summary, "External agent progress was reported.")}`;
    }
    case "agent.evidence_submitted": {
      const payload = event.payload as AgentEvidenceSubmittedPayload;
      return `${payload.agent.displayName} submitted evidence: ${toPlainEnglishSummary(payload.summary, "External agent evidence was submitted.")}`;
    }
    case "agent.plan_proposed": {
      const payload = event.payload as AgentPlanProposedPayload;
      return `${payload.agent.displayName} proposed '${payload.title}'.`;
    }
    case "agent.plan_accepted": {
      const payload = event.payload as AgentPlanAcceptedPayload;
      return `${describeActorWithRole(payload.acceptedBy, "An operator")} accepted proposal ${payload.proposalId}.`;
    }
    case "agent.plan_dismissed": {
      const payload = event.payload as AgentPlanDismissedPayload;
      return `${describeActorWithRole(payload.dismissedBy, "An operator")} dismissed proposal ${payload.proposalId}.`;
    }
    default:
      return undefined;
  }
}

async function getNextSeq(graphId: string): Promise<number> {
  const row = await db
    .select({ seq: graphEvents.seq })
    .from(graphEvents)
    .where(eq(graphEvents.graphId, graphId))
    .orderBy(desc(graphEvents.seq))
    .limit(1)
    .get();

  return (row?.seq ?? 0) + 1;
}

function buildGoalPacket(input: CreateGraphRequest): GoalPacket {
  return {
    id: nanoid(),
    version: 1,
    originalText: input.goal,
    successCriteria: input.successCriteria ?? [],
    forbiddenScope: input.forbiddenScope ?? [],
    embedding: [],
    criteriaEmbeddings: [],
    createdAt: now(),
  };
}

type AppendGraphEventInput<K extends GraphEventKind = GraphEventKind> = {
  graphId: string;
  kind: K;
  nodeId?: string;
  goalVersionId?: string;
  payload: GraphEvent["payload"];
};

export async function appendGraphEvent<K extends GraphEventKind>(input: {
  graphId: string;
  kind: K;
  nodeId?: string;
  goalVersionId?: string;
  payload: GraphEvent["payload"];
}): Promise<GraphEvent<K>> {
  const seq = await getNextSeq(input.graphId);
  const config = getAppConfig();
  const sampledPayload = applyTailSamplingToGraphEventPayload(
    input.kind,
    input.payload as GraphEvent<K>["payload"],
    config.sampling
  );
  const event: GraphEvent<K> = {
    id: nanoid(),
    graphId: input.graphId,
    kind: input.kind,
    nodeId: input.nodeId,
    goalVersionId: input.goalVersionId,
    payload: sampledPayload,
    ts: now(),
    seq,
  };

  await db.insert(graphEvents).values({
    id: event.id,
    graphId: event.graphId,
    kind: event.kind,
    nodeId: event.nodeId,
    goalVersionId: event.goalVersionId,
    payloadJson: JSON.stringify(event.payload),
    ts: event.ts,
    seq,
  });

  void exportGraphEventToOpenTelemetry(event);

  return event;
}

export async function appendGraphEvents(inputs: AppendGraphEventInput[]): Promise<GraphEvent[]> {
  if (inputs.length === 0) return [];

  const config = getAppConfig();
  const events = db.transaction((tx): GraphEvent[] => {
    const nextSeqByGraphId = new Map<string, number>();
    const appendedEvents: GraphEvent[] = [];

    for (const input of inputs) {
      let seq = nextSeqByGraphId.get(input.graphId);
      if (seq === undefined) {
        const row = tx
          .select({ seq: graphEvents.seq })
          .from(graphEvents)
          .where(eq(graphEvents.graphId, input.graphId))
          .orderBy(desc(graphEvents.seq))
          .limit(1)
          .get();
        seq = (row?.seq ?? 0) + 1;
      }

      const sampledPayload = applyTailSamplingToGraphEventPayload(
        input.kind,
        input.payload as GraphEventPayloadMap[typeof input.kind],
        config.sampling
      );
      const event: GraphEvent = {
        id: nanoid(),
        graphId: input.graphId,
        kind: input.kind,
        nodeId: input.nodeId,
        goalVersionId: input.goalVersionId,
        payload: sampledPayload,
        ts: now(),
        seq,
      };

      tx.insert(graphEvents).values({
        id: event.id,
        graphId: event.graphId,
        kind: event.kind,
        nodeId: event.nodeId,
        goalVersionId: event.goalVersionId,
        payloadJson: JSON.stringify(event.payload),
        ts: event.ts,
        seq,
      }).run();

      appendedEvents.push(event);
      nextSeqByGraphId.set(input.graphId, seq + 1);
    }

    return appendedEvents;
  });

  for (const event of events) {
    void exportGraphEventToOpenTelemetry(event);
  }

  return events;
}

export async function createGraph(input: CreateGraphRequest): Promise<Graph> {
  return createGraphWithGoalPacket(input, buildGoalPacket(input));
}

export async function createGraphWithGoalPacket(
  input: CreateGraphRequest,
  goalPacket: GoalPacket
): Promise<Graph> {
  const graphId = nanoid();

  await appendGraphEvent({
    graphId,
    kind: "goal.version_created",
    goalVersionId: goalPacket.id,
    payload: {
      graphTitle: input.title,
      goal: input.goal,
      constraints: input.constraints,
      goalPacket,
      activate: true,
    },
  });

  const projection = await getGraphProjection(graphId);
  return projection.graph;
}

export async function getGraphEvents(graphId: string): Promise<GraphEvent[]> {
  const rows = await db
    .select()
    .from(graphEvents)
    .where(eq(graphEvents.graphId, graphId))
    .orderBy(asc(graphEvents.seq))
    .all();

  return rows.map((row) => ({
    id: row.id,
    graphId: row.graphId,
    kind: row.kind as GraphEventKind,
    nodeId: row.nodeId ?? undefined,
    goalVersionId: row.goalVersionId ?? undefined,
    payload: JSON.parse(row.payloadJson),
    ts: row.ts,
    seq: row.seq,
  }));
}

function defaultCoordinates(): GraphCoordinates {
  return {
    depth: 0,
    branch: 0,
    abstractionLevel: 0,
    driftDistance: 0,
    baselineDriftDistance: 0,
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function emptyProjection(graphId: string, events: GraphEvent[] = []): GraphProjection {
  return {
    graph: {
      id: graphId,
      title: "",
      goal: "",
      status: "idle",
      originalGoalVersionId: "",
      activeGoalVersionId: "",
      createdAt: events[0]?.ts ?? now(),
      updatedAt: events[0]?.ts ?? now(),
    },
    goalPackets: [],
    nodes: [],
    edges: [],
    events,
    driftState: "on_track",
    driftSummary: "The graph has not started yet.",
    currentDriftSummary: null,
    frontierStatus: "on_track",
    runControlState: "idle",
    canResume: false,
    canPause: false,
    canStop: false,
    approvalState: "not_requested",
    approvalRequestedAt: undefined,
    waitingForApproval: false,
    latestDecisionSummary: undefined,
    needsHumanReview: false,
    humanReviewReason: undefined,
    reviewRequestedAt: undefined,
    graphAnnotations: [],
    annotationCount: 0,
    latestAnnotationSummary: undefined,
    lineageDescriptors: [],
    lineageCount: 0,
    latestPlannerLineageSummary: undefined,
    latestExecutorLineageSummary: undefined,
    latestEvaluatorLineageSummary: undefined,
    latestRetrieverLineageSummary: undefined,
    latestPolicyLineageSummary: undefined,
    lineageSummary: undefined,
    plannedNodeCount: 0,
    completedNodeCount: 0,
    failedNodeCount: 0,
    supersededNodeCount: 0,
    revisedNodeCount: 0,
    passRate: 0,
    revisionRate: 0,
    driftTrend: "steady",
    evidenceCoverageRate: 0,
    runHealthSummary: "No steps have finished yet.",
    alerts: [],
    latestNotificationSummary: undefined,
    agentActivity: [],
    agentPlanProposals: [],
  };
}

function summarizeEvidence(node: Node): string | undefined {
  const evidence = node.evidence;
  if (!evidence) return undefined;

  const fileCount = evidence.fileDiffs.length;
  const commandCount = evidence.commandResults.length;
  const changed = evidence.workspaceChecksumBefore !== evidence.workspaceChecksumAfter;
  const failedCommand = evidence.commandResults.find((result) => result.timedOut || result.exitCode !== 0);

  if (node.evaluation && !node.evaluation.deterministicPassed) {
    if (failedCommand) {
      return "A command ran but did not complete successfully. The system is deciding whether to retry or take a different path.";
    }
    return "The step produced evidence, but the checks did not confirm the expected result yet. The system is deciding what to do next.";
  }

  const fileSummary =
    fileCount === 0
      ? "No files changed"
      : fileCount === 1
        ? "Updated 1 workspace file"
        : `Updated ${fileCount} workspace files`;
  const commandSummary =
    commandCount === 0
      ? "No commands ran"
      : commandCount === 1
        ? "Ran 1 tool command"
        : `Ran ${commandCount} tool commands`;
  const workspaceSummary = changed ? "The workspace state changed." : "The workspace state stayed the same.";

  if (node.evaluation?.passed) {
    return `${fileSummary}. ${commandSummary}. All recorded checks passed. ${workspaceSummary}`;
  }

  return `${fileSummary}. ${commandSummary}. ${workspaceSummary}`;
}

function deriveEvidenceCoverage(node: Node): EvidenceCoverage {
  const evidence = node.evidence;
  if (!evidence) return "none";

  const hasGroundedArtifacts =
    evidence.toolCallLog.length > 0 &&
    Boolean(evidence.workspaceChecksumBefore) &&
    Boolean(evidence.workspaceChecksumAfter);

  if (hasGroundedArtifacts) return "grounded";

  const hasAnyEvidence =
    evidence.toolCallLog.length > 0 ||
    evidence.commandResults.length > 0 ||
    evidence.fileDiffs.length > 0 ||
    Boolean(evidence.workspaceChecksum) ||
    Boolean(evidence.workspaceChecksumBefore) ||
    Boolean(evidence.workspaceChecksumAfter);

  return hasAnyEvidence ? "partial" : "none";
}

function deriveConfidenceBadge(node: Node, evidenceCoverage: EvidenceCoverage): ConfidenceBadge {
  if (
    evidenceCoverage === "grounded" &&
    node.evaluation?.passed &&
    node.evaluation?.llmPassed &&
    node.evaluation?.deterministicPassed
  ) {
    return "high";
  }

  if (
    evidenceCoverage === "none" ||
    node.status === "failed" ||
    node.evaluation?.passed === false
  ) {
    return "low";
  }

  return "medium";
}

function getLastRunWorkspaceRoot(events: GraphEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind === "run.started" || event.kind === "run.resumed") {
      return (event.payload as RunStartedPayload | RunResumedPayload).workspaceRoot;
    }
  }
  return undefined;
}

function deriveRunControl(events: GraphEvent[]): {
  runControlState: RunControlState;
  canResume: boolean;
  canPause: boolean;
  canStop: boolean;
  approvalState: ApprovalState;
  approvalRequestedAt?: string;
  waitingForApproval: boolean;
  latestDecisionSummary?: string;
  reviewRequestedAt?: string;
} {
  let runControlState: RunControlState = "idle";
  let pauseRequested = false;
  let stopRequested = false;
  let approvalState: ApprovalState = "not_requested";
  let approvalRequestedAt: string | undefined;
  let waitingForApproval = false;
  let latestDecisionSummary: string | undefined;
  let reviewRequestedAt: string | undefined;

  for (const event of events) {
    switch (event.kind) {
      case "run.started":
      case "run.resumed":
        runControlState = "running";
        pauseRequested = false;
        stopRequested = false;
        break;
      case "run.pause_requested":
        pauseRequested = runControlState === "running";
        break;
      case "run.paused":
        runControlState = "paused";
        pauseRequested = false;
        break;
      case "run.resume_requested":
        break;
      case "run.stop_requested":
        stopRequested = runControlState === "running" || runControlState === "paused";
        break;
      case "run.stopped":
        runControlState = "stopped";
        pauseRequested = false;
        stopRequested = false;
        break;
      case "run.completed":
      case "run.failed":
        runControlState = "idle";
        pauseRequested = false;
        stopRequested = false;
        break;
      case "run.review_requested":
        reviewRequestedAt = event.ts;
        break;
      case "run.approval_requested": {
        const payload = event.payload as DecisionEventPayload;
        approvalState = "requested";
        approvalRequestedAt = payload.createdAt || event.ts;
        waitingForApproval = true;
        latestDecisionSummary = buildDecisionSummary(event.kind, payload);
        break;
      }
      case "run.approved": {
        const payload = event.payload as DecisionEventPayload;
        approvalState = "approved";
        waitingForApproval = false;
        latestDecisionSummary = buildDecisionSummary(event.kind, payload);
        break;
      }
      case "run.rejected": {
        const payload = event.payload as DecisionEventPayload;
        approvalState = "rejected";
        waitingForApproval = false;
        latestDecisionSummary = buildDecisionSummary(event.kind, payload);
        break;
      }
      case "run.continue_requested": {
        const payload = event.payload as DecisionEventPayload;
        approvalState = "approved";
        waitingForApproval = false;
        latestDecisionSummary = buildDecisionSummary(event.kind, payload);
        break;
      }
    }
  }

  return {
    runControlState,
    canResume: runControlState === "paused",
    canPause: runControlState === "running" && !pauseRequested && !stopRequested && !waitingForApproval,
    canStop: (runControlState === "running" || runControlState === "paused") && !stopRequested,
    approvalState,
    approvalRequestedAt,
    waitingForApproval,
    latestDecisionSummary,
    reviewRequestedAt,
  };
}

function buildAnnotationSummary(annotation: AnnotationRecord): string {
  const actorPrefix = describeActor(annotation.actor, annotation.authorLabel || "A user");
  const prefix =
    annotation.kind === "warning"
      ? `${actorPrefix} left a warning.`
      : annotation.kind === "decision_context"
        ? `${actorPrefix} added decision context.`
        : `${actorPrefix} left a note.`;
  return `${prefix} ${toPlainEnglishSummary(annotation.text, "A note was added to this run.")}`.trim();
}

function deriveAnnotations(events: GraphEvent[], nodes: Map<string, Node>): {
  graphAnnotations: AnnotationRecord[];
  annotationCount: number;
  latestAnnotationSummary?: string;
} {
  const graphAnnotations: AnnotationRecord[] = [];

  for (const event of events) {
    if (event.kind !== "run.annotated" && event.kind !== "node.annotated") continue;
    const annotation = event.payload as AnnotationEventPayload;
    if (event.kind === "node.annotated" && event.nodeId) {
      const node = nodes.get(event.nodeId);
      if (!node) continue;
      const nextAnnotations = [...(node.annotations ?? []), annotation].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt)
      );
      nodes.set(event.nodeId, {
        ...node,
        annotations: nextAnnotations,
        annotationCount: nextAnnotations.length,
        updatedAt: event.ts,
      });
      continue;
    }

    graphAnnotations.push(annotation);
  }

  const orderedGraphAnnotations = [...graphAnnotations].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
  const latestAnnotation = [...orderedGraphAnnotations, ...[...nodes.values()].flatMap((node) => node.annotations ?? [])]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .at(0);

  return {
    graphAnnotations: orderedGraphAnnotations,
    annotationCount:
      orderedGraphAnnotations.length +
      [...nodes.values()].reduce((sum, node) => sum + (node.annotationCount ?? 0), 0),
    latestAnnotationSummary: latestAnnotation ? buildAnnotationSummary(latestAnnotation) : undefined,
  };
}

function derivePeopleSummary(events: GraphEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const summary = buildHumanEventSummary(events[index]);
    if (summary) return summary;
  }

  return undefined;
}

function deriveAgentCollaboration(events: GraphEvent[]): {
  agentActivity: AgentActivityRecord[];
  agentPlanProposals: AgentPlanProposalRecord[];
} {
  const activities: AgentActivityRecord[] = [];
  const proposals = new Map<string, AgentPlanProposalRecord>();

  for (const event of events) {
    switch (event.kind) {
      case "agent.registered": {
        const payload = event.payload as AgentRegisteredPayload;
        activities.push({
          id: event.id,
          graphId: event.graphId,
          kind: "registered",
          agent: payload.agent,
          summary: `${payload.agent.displayName} registered as ${payload.agent.kind}.`,
          createdAt: payload.createdAt || event.ts,
          actor: payload.actor,
        });
        break;
      }
      case "agent.progress_reported": {
        const payload = event.payload as AgentProgressReportedPayload;
        activities.push({
          id: payload.progressId,
          graphId: event.graphId,
          kind: "progress",
          agent: payload.agent,
          nodeId: payload.nodeId ?? event.nodeId,
          summary: payload.summary,
          createdAt: payload.createdAt || event.ts,
          actor: payload.actor,
        });
        break;
      }
      case "agent.evidence_submitted": {
        const payload = event.payload as AgentEvidenceSubmittedPayload;
        activities.push({
          id: payload.evidenceId,
          graphId: event.graphId,
          kind: "evidence",
          agent: payload.agent,
          nodeId: payload.nodeId ?? event.nodeId,
          summary: payload.summary,
          createdAt: payload.createdAt || event.ts,
          actor: payload.actor,
        });
        break;
      }
      case "agent.plan_proposed": {
        const payload = event.payload as AgentPlanProposedPayload;
        const record: AgentPlanProposalRecord = {
          proposalId: payload.proposalId,
          graphId: event.graphId,
          createdAt: payload.createdAt || event.ts,
          actor: payload.actor,
          agent: payload.agent,
          title: payload.title,
          summary: payload.summary,
          reason: payload.reason,
          nodes: payload.nodes,
          metadata: payload.metadata,
        };
        proposals.set(record.proposalId, record);
        activities.push({
          id: event.id,
          graphId: event.graphId,
          kind: "plan_proposed",
          agent: payload.agent,
          proposalId: payload.proposalId,
          summary: payload.summary,
          createdAt: payload.createdAt || event.ts,
          actor: payload.actor,
        });
        break;
      }
      case "agent.plan_accepted": {
        const payload = event.payload as AgentPlanAcceptedPayload;
        const existing = proposals.get(payload.proposalId);
        if (existing) {
          proposals.set(payload.proposalId, {
            ...existing,
            acceptedAt: payload.acceptedAt || event.ts,
            acceptedBy: payload.acceptedBy,
            acceptedNodeIds: payload.acceptedNodeIds,
          });
        }
        activities.push({
          id: event.id,
          graphId: event.graphId,
          kind: "plan_accepted",
          proposalId: payload.proposalId,
          summary: `Accepted proposal ${payload.proposalId}.`,
          createdAt: payload.acceptedAt || event.ts,
          actor: payload.acceptedBy,
        });
        break;
      }
      case "agent.plan_dismissed": {
        const payload = event.payload as AgentPlanDismissedPayload;
        const existing = proposals.get(payload.proposalId);
        if (existing) {
          proposals.set(payload.proposalId, {
            ...existing,
            dismissedAt: payload.dismissedAt || event.ts,
            dismissedBy: payload.dismissedBy,
            dismissalReason: payload.reason,
          });
        }
        activities.push({
          id: event.id,
          graphId: event.graphId,
          kind: "plan_dismissed",
          proposalId: payload.proposalId,
          summary: payload.reason?.trim() || `Dismissed proposal ${payload.proposalId}.`,
          createdAt: payload.dismissedAt || event.ts,
          actor: payload.dismissedBy,
        });
        break;
      }
    }
  }

  return {
    agentActivity: activities.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    agentPlanProposals: [...proposals.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  };
}

function describeLineageDescriptor(descriptor: LineageDescriptor): string {
  const version = descriptor.version ? `${descriptor.label} ${descriptor.version}` : descriptor.label;
  const fallback = descriptor.fallbackUsed ? " with fallback behavior" : "";
  return `${version}${fallback}`;
}

function summarizeNodeLineage(node: Node, descriptors: Map<string, LineageDescriptor>): string | undefined {
  if (!node.lineageBindings?.length) return undefined;
  const parts = node.lineageBindings
    .map((binding) => descriptors.get(binding.lineageId))
    .filter((descriptor): descriptor is LineageDescriptor => Boolean(descriptor))
    .map((descriptor) => {
      if (descriptor.kind === "retriever" && descriptor.fallbackUsed) {
        return "Fallback retrieval logic was used for this step.";
      }
      if (descriptor.kind === "policy") {
        return `This step followed ${descriptor.label} ${descriptor.version}.`;
      }
      return `This step used ${descriptor.label} ${descriptor.version}.`;
    });

  return parts[0];
}

function deriveLineageState(
  descriptors: Map<string, LineageDescriptor>
): Pick<
  GraphProjection,
  | "lineageDescriptors"
  | "lineageCount"
  | "latestPlannerLineageSummary"
  | "latestExecutorLineageSummary"
  | "latestEvaluatorLineageSummary"
  | "latestRetrieverLineageSummary"
  | "latestPolicyLineageSummary"
  | "lineageSummary"
> {
  const ordered = [...descriptors.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latestByKind = new Map<string, LineageDescriptor>();
  for (const descriptor of ordered) {
    latestByKind.set(descriptor.kind, descriptor);
  }

  const planner = latestByKind.get("planner");
  const executor = latestByKind.get("executor");
  const evaluator = latestByKind.get("evaluator");
  const retriever = latestByKind.get("retriever");
  const policy = latestByKind.get("policy");
  const summaryParts = [planner, executor, evaluator, policy]
    .filter((descriptor): descriptor is LineageDescriptor => Boolean(descriptor))
    .map((descriptor) => `${descriptor.kind} ${descriptor.version}`);
  const lineageSummary =
    summaryParts.length > 0
      ? `This run used ${summaryParts.join(", ")}${retriever?.fallbackUsed ? ", and fallback retrieval logic for some steps" : ""}.`
      : undefined;

  return {
    lineageDescriptors: ordered,
    lineageCount: ordered.length,
    latestPlannerLineageSummary: planner ? describeLineageDescriptor(planner) : undefined,
    latestExecutorLineageSummary: executor ? describeLineageDescriptor(executor) : undefined,
    latestEvaluatorLineageSummary: evaluator ? describeLineageDescriptor(evaluator) : undefined,
    latestRetrieverLineageSummary: retriever ? describeLineageDescriptor(retriever) : undefined,
    latestPolicyLineageSummary: policy ? describeLineageDescriptor(policy) : undefined,
    lineageSummary,
  };
}

function severityForAlertType(type: AlertType): AlertSeverity {
  switch (type) {
    case "run_completed":
    case "run_paused":
      return "info";
    case "run_blocked":
      return "critical";
    case "review_needed":
    case "drift_worsening":
    case "deterministic_failure":
    case "run_stopped":
      return "warning";
  }
}

function deriveDriftTrend(nodes: Node[]): DriftTrend {
  const recentScores = [...nodes]
    .filter((node) => node.status === "completed" && node.evaluation)
    .sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt))
    .slice(-3)
    .map((node) => node.evaluation!.driftScore);

  if (recentScores.length < 2) return "steady";
  const delta = recentScores[recentScores.length - 1] - recentScores[0];
  if (delta > 0.08) return "improving";
  if (delta < -0.08) return "worsening";
  return "steady";
}

function deriveRunHealth(nodes: Node[]): {
  plannedNodeCount: number;
  completedNodeCount: number;
  failedNodeCount: number;
  supersededNodeCount: number;
  revisedNodeCount: number;
  passRate: number;
  revisionRate: number;
  driftTrend: DriftTrend;
  evidenceCoverageRate: number;
  runHealthSummary: string;
} {
  const plannedNodes = nodes.filter((node) => node.kind !== "revision" && node.kind !== "replan");
  const completedNodes = nodes.filter((node) => node.status === "completed");
  const failedNodes = nodes.filter((node) => node.status === "failed" || node.status === "blocked");
  const supersededNodes = nodes.filter((node) => node.status === "superseded");
  const revisedNodes = nodes.filter((node) => node.kind === "revision" || node.kind === "replan");
  const passedNodes = completedNodes.filter((node) => node.evaluation?.passed);
  const groundedNodes = completedNodes.filter((node) => node.evidenceCoverage === "grounded");
  const passRate = completedNodes.length > 0 ? passedNodes.length / completedNodes.length : 0;
  const revisionRate = plannedNodes.length > 0 ? revisedNodes.length / plannedNodes.length : 0;
  const evidenceCoverageRate = completedNodes.length > 0 ? groundedNodes.length / completedNodes.length : 0;
  const driftTrend = deriveDriftTrend(nodes);
  const latestCompleted = [...completedNodes]
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
    .at(0);
  const driftSentence =
    latestCompleted?.evaluation?.direction === "drifting"
      ? "Most recent work is drifting."
      : latestCompleted?.evaluation?.direction === "holding"
        ? "Most recent work is exploring nearby ground."
        : "Most recent work is on track.";
  const evidenceSentence =
    evidenceCoverageRate >= 0.75
      ? "Evidence is strong for most completed steps."
      : evidenceCoverageRate >= 0.35
        ? "Evidence is mixed across completed steps."
        : "Evidence is still light for completed steps.";

  return {
    plannedNodeCount: plannedNodes.length,
    completedNodeCount: completedNodes.length,
    failedNodeCount: failedNodes.length,
    supersededNodeCount: supersededNodes.length,
    revisedNodeCount: revisedNodes.length,
    passRate,
    revisionRate,
    driftTrend,
    evidenceCoverageRate,
    runHealthSummary: `${completedNodes.length} of ${plannedNodes.length} steps completed. ${driftSentence} ${evidenceSentence}`,
  };
}

function deriveHumanReview(
  nodes: Node[],
  graphStatus: Graph["status"]
): { needsHumanReview: boolean; humanReviewReason?: string } {
  const revisionsByOriginal = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind !== "revision") continue;
    const originalId = node.parentNodeId ?? node.id;
    revisionsByOriginal.set(originalId, (revisionsByOriginal.get(originalId) ?? 0) + 1);
  }
  if ([...revisionsByOriginal.values()].some((count) => count >= 3)) {
    return {
      needsHumanReview: true,
      humanReviewReason: "The system has revised the same step several times and may need guidance.",
    };
  }

  const recentEvaluations = [...nodes]
    .filter((node) => node.status === "completed" && node.evaluation)
    .sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt));

  const latestTwoDeterministic = recentEvaluations.slice(-2);
  if (
    latestTwoDeterministic.length === 2 &&
    latestTwoDeterministic.every((node) => node.evaluation && !node.evaluation.deterministicPassed)
  ) {
    return {
      needsHumanReview: true,
      humanReviewReason: "Recent steps did not pass their checks and may need review.",
    };
  }

  const latestThreeDrift = recentEvaluations.slice(-3);
  if (
    latestThreeDrift.length === 3 &&
    latestThreeDrift.every((node) => node.evaluation?.direction === "drifting")
  ) {
    return {
      needsHumanReview: true,
      humanReviewReason: "Recent steps are drifting away from the goal and may need review.",
    };
  }

  const hasRunnableNode = nodes.some((node) => node.status === "pending" || node.status === "ready");
  if (graphStatus === "blocked" && !hasRunnableNode) {
    return {
      needsHumanReview: true,
      humanReviewReason: "Work is blocked because no runnable step is available.",
    };
  }

  return { needsHumanReview: false };
}

function createAlert(input: {
  graphId: string;
  type: AlertType;
  createdAt: string;
  title: string;
  message: string;
  relatedNodeId?: string;
  relatedEventSequence?: number;
}): GraphAlert {
  return {
    id: `${input.type}:${input.relatedNodeId ?? "graph"}:${input.relatedEventSequence ?? input.createdAt}`,
    type: input.type,
    graphId: input.graphId,
    createdAt: input.createdAt,
    severity: severityForAlertType(input.type),
    title: input.title,
    message: input.message,
    relatedNodeId: input.relatedNodeId,
    relatedEventSequence: input.relatedEventSequence,
  };
}

function eventSeq(event: GraphEvent): number | undefined {
  return typeof event.seq === "number" ? event.seq : undefined;
}

function deriveAlerts(
  graph: Graph,
  nodes: Node[],
  events: GraphEvent[],
  runControlState: RunControlState,
  needsHumanReview: boolean,
  humanReviewReason: string | undefined,
  driftTrend: DriftTrend
): { alerts: GraphAlert[]; latestNotificationSummary?: string } {
  const alerts: GraphAlert[] = [];
  const latestCompletedNode = [...nodes]
    .filter((node) => node.status === "completed")
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
    .at(0);
  const latestCompletedEvent = [...events].reverse().find((event) => event.kind === "run.completed");
  const latestPausedEvent = [...events].reverse().find((event) => event.kind === "run.paused");
  const latestStoppedEvent = [...events].reverse().find((event) => event.kind === "run.stopped");
  const latestFailedEvent = [...events].reverse().find((event) => event.kind === "run.failed");
  const latestReviewEvent = [...events].reverse().find((event) => event.kind === "run.review_requested");
  const latestDeterministicFailure = [...nodes]
    .filter((node) => node.evaluation && !node.evaluation.deterministicPassed)
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
    .at(0);

  if (needsHumanReview) {
    alerts.push(
      createAlert({
        graphId: graph.id,
        type: "review_needed",
        createdAt: latestReviewEvent?.ts ?? graph.updatedAt,
        title: "Review may be needed",
        message: humanReviewReason ?? "The system may need guidance before it continues.",
        relatedNodeId: latestDeterministicFailure?.id,
        relatedEventSequence: latestReviewEvent ? eventSeq(latestReviewEvent) : undefined,
      })
    );
  }

  if (graph.status === "blocked" && latestFailedEvent) {
    alerts.push(
      createAlert({
        graphId: graph.id,
        type: "run_blocked",
        createdAt: latestFailedEvent.ts,
        title: "Work is blocked",
        message: "The run cannot continue because no runnable step is available.",
        relatedEventSequence: eventSeq(latestFailedEvent),
      })
    );
  }

  if (runControlState === "paused" && latestPausedEvent) {
    alerts.push(
      createAlert({
        graphId: graph.id,
        type: "run_paused",
        createdAt: latestPausedEvent.ts,
        title: "Run is paused",
        message: "The system is waiting to resume from the current graph state.",
        relatedNodeId: (latestPausedEvent.payload as RunPausedPayload).afterNodeId,
        relatedEventSequence: eventSeq(latestPausedEvent),
      })
    );
  }

  if (graph.status === "stopped" && latestStoppedEvent) {
    alerts.push(
      createAlert({
        graphId: graph.id,
        type: "run_stopped",
        createdAt: latestStoppedEvent.ts,
        title: "Run stopped",
        message: "The system stopped after finishing its current step.",
        relatedNodeId: (latestStoppedEvent.payload as RunStoppedPayload).afterNodeId,
        relatedEventSequence: eventSeq(latestStoppedEvent),
      })
    );
  }

  if (driftTrend === "worsening") {
    alerts.push(
      createAlert({
        graphId: graph.id,
        type: "drift_worsening",
        createdAt: latestCompletedNode?.completedAt ?? graph.updatedAt,
        title: "Drift is worsening",
        message: toPlainEnglishFailureSummary(
          latestCompletedNode?.evaluation?.humanSummary,
          "Recent work is moving farther away from the original goal."
        ),
        relatedNodeId: latestCompletedNode?.id,
      })
    );
  }

  if (latestDeterministicFailure) {
    alerts.push(
      createAlert({
        graphId: graph.id,
        type: "deterministic_failure",
        createdAt: latestDeterministicFailure.completedAt ?? latestDeterministicFailure.updatedAt,
        title: "A checked step did not pass",
        message: toPlainEnglishFailureSummary(
          latestDeterministicFailure.evaluation?.humanSummary ??
            latestDeterministicFailure.evidenceSummary,
          "A recent step did not pass its checks and may need attention."
        ),
        relatedNodeId: latestDeterministicFailure.id,
      })
    );
  }

  if (graph.status === "completed" && latestCompletedEvent) {
    alerts.push(
      createAlert({
        graphId: graph.id,
        type: "run_completed",
        createdAt: latestCompletedEvent.ts,
        title: "Run completed",
        message: "The run finished all active work on the current path.",
        relatedEventSequence: eventSeq(latestCompletedEvent),
      })
    );
  }

  const orderedAlerts = alerts.sort((a, b) => {
    const severityRank = { critical: 0, warning: 1, info: 2 };
    const severityDiff = severityRank[a.severity] - severityRank[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return {
    alerts: orderedAlerts,
    latestNotificationSummary: orderedAlerts[0]?.message,
  };
}

function deriveEdges(nodes: Node[], events: GraphEvent[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  function pushEdge(sourceNodeId: string, targetNodeId: string, kind: Edge["kind"], graphId: string, createdAt: string) {
    const id = `${sourceNodeId}:${targetNodeId}:${kind}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({
      id,
      graphId,
      sourceNodeId,
      targetNodeId,
      kind,
      createdAt,
    });
  }

  for (const node of nodes) {
    for (const dep of node.dependsOnNodeIds) {
      pushEdge(dep, node.id, "depends_on", node.graphId, node.createdAt);
    }
    if (node.parentNodeId && node.kind === "revision") {
      pushEdge(node.id, node.parentNodeId, "revises", node.graphId, node.createdAt);
    }
  }

  for (const event of events) {
    if (event.kind === "node.superseded" && event.nodeId) {
      const payload = event.payload as NodeSupersededPayload;
      if (payload.supersededByNodeId) {
        pushEdge(payload.supersededByNodeId, event.nodeId, "supersedes", event.graphId, event.ts);
      }
    }
  }

  return edges;
}

function mapFrontierStatus(nodes: Node[], graphStatus: Graph["status"]): FrontierStatus {
  if (graphStatus === "blocked") return "blocked";

  const latestEvaluated = [...nodes]
    .filter((node) => node.status === "completed" && node.evaluation)
    .sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt))
    .at(-1);

  if (!latestEvaluated?.evaluation) {
    return graphStatus === "failed" ? "drifting" : "on_track";
  }

  if (latestEvaluated.evaluation.direction === "drifting") return "drifting";
  if (latestEvaluated.evaluation.direction === "holding") return "exploring";
  return "on_track";
}

function formatDriftFallback(nodes: Node[]): string {
  const completedNodes = nodes.filter((node) => node.status === "completed");
  const evaluatedNodes = completedNodes.filter((node) => node.evaluation);
  const latestNode = [...completedNodes]
    .sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt))
    .at(-1);
  const score = latestNode?.evaluation?.driftScore ?? 0;
  const direction = latestNode?.evaluation?.direction ?? "holding";
  return `${evaluatedNodes.length} of ${nodes.length} nodes completed. Most recent node was '${latestNode?.title ?? "Unknown"}' — drift score ${score.toFixed(2)}, direction ${direction}.`;
}

function deriveGraphHumanLayer(
  nodes: Node[],
  graphStatus: Graph["status"]
): { state: HumanDriftState; summary: string; currentDriftSummary: string | null; frontierStatus: FrontierStatus } {
  const frontierStatus = mapFrontierStatus(nodes, graphStatus);
  const completedEvaluatedNodes = [...nodes]
    .filter((node) => node.status === "completed" && node.evaluation)
    .sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt));
  const latestEvaluated = completedEvaluatedNodes.at(-1);

  if (!latestEvaluated?.evaluation) {
    const fallback = "The run has not produced enough evaluated work to assess drift yet.";
    return {
      state: frontierStatus === "blocked" ? "drifting" : "on_track",
      summary: fallback,
      currentDriftSummary: fallback,
      frontierStatus,
    };
  }

  const recentNodes = completedEvaluatedNodes.slice(-3);
  const recentSemantic = recentNodes
    .map((node) => node.semanticSummary || node.humanSummary)
    .filter(Boolean)
    .join(" ");

  const state: HumanDriftState =
    latestEvaluated.evaluation.direction === "drifting"
      ? "drifting"
      : latestEvaluated.evaluation.direction === "holding"
        ? "exploring"
        : "on_track";

  let summary: string | null = null;

  if (latestEvaluated.evaluation.humanSummary?.trim()) {
    if (state === "on_track") {
      summary = `The AI is still moving toward the goal. ${latestEvaluated.evaluation.humanSummary}`;
    } else if (state === "exploring") {
      summary = `The AI is exploring adjacent work while staying near the goal. ${recentSemantic || latestEvaluated.evaluation.humanSummary}`;
    } else {
      summary = `The AI is drifting away from the requested path. ${recentSemantic || latestEvaluated.evaluation.humanSummary}`;
    }
  }

  if (!summary) {
    summary = formatDriftFallback(nodes);
  }

  return {
    state,
    summary,
    currentDriftSummary: summary,
    frontierStatus,
  };
}

export function replayProjection(graphId: string, events: GraphEvent[]): GraphProjection | undefined {
  if (events.length === 0) return undefined;

  const goalPackets = new Map<string, GoalPacket>();
  const nodes = new Map<string, Node>();
  const lineageDescriptors = new Map<string, LineageDescriptor>();

  let title = "Untitled Graph";
  let goal = "";
  let constraints: string | undefined;
  let createdAt = events[0].ts;
  let updatedAt = events[events.length - 1].ts;
  let originalGoalVersionId = "";
  let activeGoalVersionId = "";
  let status: Graph["status"] = "idle";

  for (const event of events) {
    updatedAt = event.ts;

    switch (event.kind) {
      case "system.lineage_declared": {
        const payload = event.payload as SystemLineageDeclaredPayload;
        lineageDescriptors.set(payload.lineageId, payload);
        break;
      }

      case "goal.version_created": {
        const payload = event.payload as import("@openagentgraph/shared").GoalVersionCreatedPayload;
        title = payload.graphTitle;
        goal = payload.goal;
        constraints = payload.constraints;
        goalPackets.set(payload.goalPacket.id, payload.goalPacket);
        if (!originalGoalVersionId) originalGoalVersionId = payload.goalPacket.id;
        if (payload.activate || !activeGoalVersionId) activeGoalVersionId = payload.goalPacket.id;
        break;
      }

      case "node.planned": {
        const payload = event.payload as NodePlannedPayload;
        if (!event.nodeId) break;
        nodes.set(event.nodeId, {
          id: event.nodeId,
          graphId,
          kind: payload.kind,
          title: payload.title,
          intent: payload.intent,
          inputContext: payload.inputContext,
          prompt: undefined,
          output: undefined,
          humanSummary: payload.humanSummary,
          status: "pending",
          contract: payload.contract,
          evidence: undefined,
          evaluation: undefined,
          semanticSummary: undefined,
          semanticEmbedding: undefined,
          evidenceSummary: undefined,
          workspaceStateChanged: undefined,
          confidence: undefined,
          annotations: [],
          annotationCount: 0,
          lineageBindings: [],
          lineageSummary: undefined,
          parentNodeId: payload.parentNodeId,
          branchId: payload.branchId,
          baselineGoalVersionId: payload.baselineGoalVersionId,
          activeGoalVersionId: payload.activeGoalVersionId,
          dependsOnNodeIds: payload.dependsOnNodeIds,
          coordinates: payload.coordinates ?? defaultCoordinates(),
          startedAt: undefined,
          completedAt: undefined,
          createdAt: event.ts,
          updatedAt: event.ts,
        });
        break;
      }

      case "node.ready": {
        const payload = event.payload as NodeReadyPayload;
        void payload;
        if (!event.nodeId) break;
        const node = nodes.get(event.nodeId);
        if (!node) break;
        nodes.set(event.nodeId, { ...node, status: "ready", updatedAt: event.ts });
        break;
      }

      case "node.executing": {
        const payload = event.payload as import("@openagentgraph/shared").NodeExecutingPayload;
        if (!event.nodeId) break;
        const node = nodes.get(event.nodeId);
        if (!node) break;
        nodes.set(event.nodeId, {
          ...node,
          status: "running",
          prompt: payload.prompt,
          startedAt: event.ts,
          updatedAt: event.ts,
        });
        break;
      }

      case "node.output": {
        const payload = event.payload as NodeOutputPayload;
        if (!event.nodeId) break;
        const node = nodes.get(event.nodeId);
        if (!node) break;
        nodes.set(event.nodeId, {
          ...node,
          output: payload.output,
          updatedAt: event.ts,
        });
        break;
      }

      case "node.tool_call": {
        const payload = event.payload as NodeToolCallPayload;
        if (!event.nodeId) break;
        const node = nodes.get(event.nodeId);
        if (!node) break;
        const evidence = node.evidence ?? {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [],
          workspaceChecksum: "",
          workspaceChecksumBefore: "",
          workspaceChecksumAfter: "",
        };
        nodes.set(event.nodeId, {
          ...node,
          evidence: {
            ...evidence,
            toolCallLog: [...evidence.toolCallLog, payload.toolCall],
          },
          updatedAt: event.ts,
        });
        break;
      }

      case "node.completed": {
        const payload = event.payload as NodeCompletedPayload;
        if (!event.nodeId) break;
        const node = nodes.get(event.nodeId);
        if (!node) break;
        const completedNode = {
          ...node,
          status: "completed" as const,
          output: payload.output,
          evidence: payload.evidence,
          completedAt: event.ts,
          updatedAt: event.ts,
        };
        const evidenceCoverage = deriveEvidenceCoverage(completedNode);
        nodes.set(event.nodeId, {
          ...completedNode,
          evidenceSummary: summarizeEvidence(completedNode),
          workspaceStateChanged:
            payload.evidence.workspaceChecksumBefore !== payload.evidence.workspaceChecksumAfter,
          evidenceCoverage,
          confidenceBadge: deriveConfidenceBadge(completedNode, evidenceCoverage),
          confidence: payload.confidence,
        });
        break;
      }

      case "node.summarized": {
        const payload = event.payload as NodeSummarizedPayload;
        if (!event.nodeId) break;
        const node = nodes.get(event.nodeId);
        if (!node || node.status !== "completed" || !node.completedAt) break;
        nodes.set(event.nodeId, {
          ...node,
          semanticSummary: payload.summary,
          semanticEmbedding: payload.embedding,
          updatedAt: event.ts,
        });
        break;
      }

      case "node.lineage_bound": {
        const payload = event.payload as NodeLineageBoundPayload;
        if (!event.nodeId) break;
        const node = nodes.get(event.nodeId);
        if (!node) break;
        const nextNode = {
          ...node,
          lineageBindings: payload.bindings,
          updatedAt: event.ts,
        };
        nodes.set(event.nodeId, {
          ...nextNode,
          lineageSummary: summarizeNodeLineage(nextNode, lineageDescriptors),
        });
        break;
      }

      case "node.failed": {
        const payload = event.payload as NodeFailedPayload;
        if (!event.nodeId) break;
        const node = nodes.get(event.nodeId);
        if (!node) break;
        nodes.set(event.nodeId, {
          ...node,
          status: payload.reason === "blocked" ? "blocked" : "failed",
          evidenceCoverage: node.evidenceCoverage ?? deriveEvidenceCoverage(node),
          confidenceBadge: "low",
          completedAt: event.ts,
          updatedAt: event.ts,
        });
        break;
      }

      case "node.evaluated": {
        const payload = event.payload as NodeEvaluatedPayload;
        if (!event.nodeId) break;
        const node = nodes.get(event.nodeId);
        if (!node) break;
        const evaluatedNode = {
          ...node,
          evaluation: payload.evaluation,
        };
        nodes.set(event.nodeId, {
          ...evaluatedNode,
          evaluation: payload.evaluation,
          humanSummary: payload.evaluation.humanSummary || evaluatedNode.humanSummary,
          evidenceSummary: summarizeEvidence({
            ...evaluatedNode,
            evaluation: payload.evaluation,
          }),
          confidenceBadge: deriveConfidenceBadge(
            evaluatedNode,
            evaluatedNode.evidenceCoverage ?? deriveEvidenceCoverage(evaluatedNode)
          ),
          coordinates: node.coordinates
            ? {
                ...node.coordinates,
                driftDistance: payload.evaluation.driftScore,
                baselineDriftDistance: payload.evaluation.baselineDriftScore,
              }
            : node.coordinates,
          updatedAt: event.ts,
        });
        break;
      }

      case "node.superseded": {
        const payload = event.payload as NodeSupersededPayload;
        if (!event.nodeId) break;
        const node = nodes.get(event.nodeId);
        if (!node) break;
        nodes.set(event.nodeId, {
          ...node,
          status: "superseded",
          branchId: payload.branchId || node.branchId,
          updatedAt: event.ts,
        });
        break;
      }

      case "replan.branched": {
        const payload = event.payload as ReplanBranchedPayload;
        activeGoalVersionId = payload.newGoalVersionId;
        break;
      }

      case "run.started": {
        const payload = event.payload as RunStartedPayload;
        activeGoalVersionId = payload.goalVersionId;
        status = "running";
        break;
      }

      case "run.completed": {
        const payload = event.payload as RunCompletedPayload;
        void payload;
        status = "completed";
        break;
      }

      case "run.pause_requested": {
        const payload = event.payload as RunPauseRequestedPayload;
        void payload;
        break;
      }

      case "run.paused": {
        const payload = event.payload as RunPausedPayload;
        void payload;
        break;
      }

      case "run.resume_requested": {
        const payload = event.payload as RunResumeRequestedPayload;
        void payload;
        break;
      }

      case "run.resumed": {
        const payload = event.payload as RunResumedPayload;
        activeGoalVersionId = payload.goalVersionId;
        status = "running";
        break;
      }

      case "run.stop_requested": {
        const payload = event.payload as RunStopRequestedPayload;
        void payload;
        break;
      }

      case "run.stopped": {
        const payload = event.payload as RunStoppedPayload;
        void payload;
        status = "stopped";
        break;
      }

      case "run.review_requested": {
        const payload = event.payload as RunReviewRequestedPayload;
        void payload;
        break;
      }

      case "run.annotated":
      case "node.annotated": {
        break;
      }

      case "run.approval_requested":
      case "run.approved":
      case "run.rejected":
      case "run.continue_requested": {
        const payload = event.payload as DecisionEventPayload;
        void payload;
        break;
      }

      case "run.failed": {
        const payload = event.payload as RunFailedPayload;
        status = payload.blocked ? "blocked" : "failed";
        break;
      }
    }
  }

  const graph: Graph = {
    id: graphId,
    title,
    goal,
    constraints,
    status,
    originalGoalVersionId,
    activeGoalVersionId: activeGoalVersionId || originalGoalVersionId,
    createdAt,
    updatedAt,
  };

  const nodeList = [...nodes.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const edgeList = deriveEdges(nodeList, events);
  const annotationState = deriveAnnotations(events, nodes);
  const nodeListWithAnnotations = [...nodes.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lineageState = deriveLineageState(lineageDescriptors);
  const drift = deriveGraphHumanLayer(nodeList, graph.status);
  const runControl = deriveRunControl(events);
  const health = deriveRunHealth(nodeListWithAnnotations);
  const humanReview = deriveHumanReview(nodeListWithAnnotations, graph.status);
  const alertState = deriveAlerts(
    graph,
    nodeListWithAnnotations,
    events,
    runControl.runControlState,
    humanReview.needsHumanReview,
    humanReview.humanReviewReason,
    health.driftTrend
  );
  const agentState = deriveAgentCollaboration(events);

  return {
    graph,
    goalPackets: [...goalPackets.values()].sort((a, b) => a.version - b.version),
    nodes: nodeListWithAnnotations,
    edges: edgeList,
    events,
    driftState: drift.state,
    driftSummary: drift.summary,
    currentDriftSummary: drift.currentDriftSummary,
    frontierStatus: drift.frontierStatus,
    runControlState: runControl.runControlState,
    canResume: runControl.canResume,
    canPause: runControl.canPause,
    canStop: runControl.canStop,
    approvalState: runControl.approvalState,
    approvalRequestedAt: runControl.approvalRequestedAt,
    waitingForApproval: runControl.waitingForApproval,
    latestDecisionSummary: runControl.latestDecisionSummary,
    needsHumanReview: humanReview.needsHumanReview,
    humanReviewReason: humanReview.humanReviewReason,
    reviewRequestedAt: runControl.reviewRequestedAt,
    graphAnnotations: annotationState.graphAnnotations,
    annotationCount: annotationState.annotationCount,
    latestAnnotationSummary: annotationState.latestAnnotationSummary,
    peopleSummary: derivePeopleSummary(events),
    lineageDescriptors: lineageState.lineageDescriptors,
    lineageCount: lineageState.lineageCount,
    latestPlannerLineageSummary: lineageState.latestPlannerLineageSummary,
    latestExecutorLineageSummary: lineageState.latestExecutorLineageSummary,
    latestEvaluatorLineageSummary: lineageState.latestEvaluatorLineageSummary,
    latestRetrieverLineageSummary: lineageState.latestRetrieverLineageSummary,
    latestPolicyLineageSummary: lineageState.latestPolicyLineageSummary,
    lineageSummary: lineageState.lineageSummary,
    plannedNodeCount: health.plannedNodeCount,
    completedNodeCount: health.completedNodeCount,
    failedNodeCount: health.failedNodeCount,
    supersededNodeCount: health.supersededNodeCount,
    revisedNodeCount: health.revisedNodeCount,
    passRate: health.passRate,
    revisionRate: health.revisionRate,
    driftTrend: health.driftTrend,
    evidenceCoverageRate: health.evidenceCoverageRate,
    runHealthSummary: health.runHealthSummary,
    alerts: alertState.alerts,
    latestNotificationSummary: alertState.latestNotificationSummary,
    agentActivity: agentState.agentActivity,
    agentPlanProposals: agentState.agentPlanProposals,
  };
}

function summarizeReplayEvent(frame: GraphProjection, event: GraphEvent | null): string {
  if (!event) {
    return "The replay is at the starting point. No work has happened yet.";
  }

  const node = event.nodeId ? frame.nodes.find((candidate) => candidate.id === event.nodeId) : null;
  if (!node) {
    switch (event.kind) {
      case "system.lineage_declared":
        return frame.lineageSummary ?? "The run recorded which planner, executor, evaluator, or policy version shaped its behavior.";
      case "run.pause_requested":
        return buildHumanEventSummary(event) ?? "A pause was requested. The system will stop after the current step finishes.";
      case "run.paused":
        return "The run is paused. The graph is holding its current state.";
      case "run.resume_requested":
        return buildHumanEventSummary(event) ?? "A resume was requested for the paused run.";
      case "run.resumed":
        return "The paused run resumed from its existing graph state.";
      case "run.stop_requested":
        return buildHumanEventSummary(event) ?? "A stop was requested. The system will stop after the current step finishes.";
      case "run.stopped":
        return "The run stopped after finishing its current work.";
      case "run.review_requested":
        return buildHumanEventSummary(event) ?? "This run was marked for human review.";
      case "run.annotated":
        return buildHumanEventSummary(event) ?? frame.latestAnnotationSummary ?? "A human annotation was added to this run.";
      case "run.approval_requested":
      case "run.approved":
      case "run.rejected":
      case "run.continue_requested":
        return buildHumanEventSummary(event) ?? frame.latestDecisionSummary ?? "A human decision changed the run's supervision state.";
      case "agent.registered":
      case "agent.progress_reported":
      case "agent.evidence_submitted":
      case "agent.plan_proposed":
      case "agent.plan_accepted":
      case "agent.plan_dismissed":
        return buildHumanEventSummary(event) ?? "An external agent updated the collaboration layer.";
      default:
        return `The graph recorded ${event.kind.replace(".", " ")}.`;
    }
  }

  switch (event.kind) {
    case "node.lineage_bound":
      return node.lineageSummary
        ? `Lineage update: ${node.lineageSummary}`
        : `The system recorded which lineage shaped '${node.title}'.`;
    case "node.planned":
      return `The system planned '${node.title}' and added it to the graph.`;
    case "node.ready":
      return `'${node.title}' became ready to run.`;
    case "node.executing":
      return `The system started working on '${node.title}'.`;
    case "node.completed":
      return `'${node.title}' finished and captured evidence.`;
    case "node.summarized":
      return `The system summarized what '${node.title}' changed and why it mattered.`;
    case "node.evaluated":
      return node.evaluation?.humanSummary || `The system evaluated '${node.title}'.`;
    case "node.failed":
      return node.evidenceSummary || `The system could not complete '${node.title}' as expected.`;
    case "node.superseded":
      return `'${node.title}' is still visible, but it is no longer on the active path.`;
    case "node.annotated":
      return buildHumanEventSummary(event) ?? frame.latestAnnotationSummary ?? `A human annotation was added to '${node.title}'.`;
    case "run.review_requested":
      return buildHumanEventSummary(event) ?? `The run was marked for human review while '${node.title}' remained in focus.`;
    default:
      return `The graph recorded ${event.kind.replace(".", " ")} for '${node.title}'.`;
  }
}

export function buildReplayFrame(
  graphId: string,
  events: GraphEvent[],
  stepIndex: number
): ReplayFrame {
  const normalizedStep = Math.min(Math.max(stepIndex, 0), events.length);
  const appliedEvents = events.slice(0, normalizedStep);
  const projection = replayProjection(graphId, appliedEvents) ?? emptyProjection(graphId, appliedEvents);
  const event = normalizedStep === 0 ? null : appliedEvents[appliedEvents.length - 1] ?? null;

  return {
    stepIndex: normalizedStep,
    totalSteps: events.length,
    event,
    projection,
    plainEnglishSummary: summarizeReplayEvent(projection, event),
  };
}

export function buildReplayFrames(graphId: string, events: GraphEvent[]): ReplayFrame[] {
  return Array.from({ length: events.length + 1 }, (_, index) => buildReplayFrame(graphId, events, index));
}

export function withActorContext(
  projection: GraphProjection,
  actor?: ActorIdentity
): GraphProjection & { currentActor?: ActorIdentity; capabilities: GraphCapabilities } {
  return {
    ...projection,
    currentActor: actor,
    capabilities: deriveCapabilities(actor, projection),
  };
}

export async function getGraphProjection(graphId: string): Promise<GraphProjection> {
  const events = await getGraphEvents(graphId);
  const projection = replayProjection(graphId, events);
  if (!projection) throw new Error(`Graph ${graphId} not found`);
  return projection;
}

export async function getGraph(graphId: string): Promise<Graph | undefined> {
  try {
    return (await getGraphProjection(graphId)).graph;
  } catch {
    return undefined;
  }
}

export async function getNode(nodeId: string): Promise<Node | undefined> {
  const row = await db
    .select({ graphId: graphEvents.graphId })
    .from(graphEvents)
    .where(eq(graphEvents.nodeId, nodeId))
    .limit(1)
    .get();

  if (!row) return undefined;
  const projection = await getGraphProjection(row.graphId);
  return projection.nodes.find((node) => node.id === nodeId);
}

export async function getNodesForGraph(graphId: string): Promise<Node[]> {
  return (await getGraphProjection(graphId)).nodes;
}

export async function getEdgesForGraph(graphId: string): Promise<Edge[]> {
  return (await getGraphProjection(graphId)).edges;
}

export async function getGoalPackets(graphId: string): Promise<GoalPacket[]> {
  return (await getGraphProjection(graphId)).goalPackets;
}

export async function getLatestRunWorkspaceRoot(graphId: string): Promise<string | undefined> {
  const events = await getGraphEvents(graphId);
  return getLastRunWorkspaceRoot(events);
}

export async function getGraphRunReport(graphId: string): Promise<GraphRunReport> {
  const projection = await getGraphProjection(graphId);
  const events = await getGraphEvents(graphId);
  return buildGraphRunReport({ projection, events });
}

function goalSummary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled goal";
  const sentence = compact.split(/(?<=[.!?])\s+/)[0] ?? compact;
  return sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence;
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

function highestAlertSeverity(alerts: GraphAlert[]): AlertSeverity | undefined {
  return alerts[0]?.severity;
}

function normalizeNow(nowInput?: string): string {
  return nowInput && !Number.isNaN(Date.parse(nowInput)) ? new Date(nowInput).toISOString() : now();
}

function isTerminalStatus(status: Graph["status"]): boolean {
  return status === "completed" || status === "stopped" || status === "failed" || status === "blocked";
}

function classifyLifecycleBucket(input: {
  projection: GraphProjection;
  changesSinceLastViewed: ChangesSinceLastViewed;
  nowIso: string;
  archiveThresholdDays?: number;
}): DashboardLifecycleBucket {
  const archiveThresholdDays = input.archiveThresholdDays ?? 7;
  const highestSeverity = highestAlertSeverity(input.projection.alerts);
  const lastEventAt = input.projection.events.at(-1)?.ts ?? input.projection.graph.updatedAt;
  const ageMs = Math.max(0, Date.parse(input.nowIso) - Date.parse(lastEventAt));
  const archiveThresholdMs = archiveThresholdDays * 24 * 60 * 60 * 1000;

  if (
    input.projection.needsHumanReview ||
    highestSeverity === "critical" ||
    highestSeverity === "warning" ||
    input.projection.runControlState === "paused" ||
    input.projection.frontierStatus === "blocked"
  ) {
    return "needs_attention";
  }

  if (
    isTerminalStatus(input.projection.graph.status) &&
    input.changesSinceLastViewed.newEventCount === 0 &&
    ageMs >= archiveThresholdMs
  ) {
    return "archived";
  }

  if (isTerminalStatus(input.projection.graph.status)) {
    return "completed_recent";
  }

  return "active";
}

function safeDashboardTexts(item: DashboardRunSummary): string[] {
  return [
    item.goalTitle,
    item.latestNotificationSummary ?? "",
    item.humanReviewReason ?? "",
    item.latestDecisionSummary ?? "",
    item.latestCompletedNodeSummary ?? "",
    item.frontierStatus.replace("_", " "),
    item.runControlState.replace("_", " "),
  ].filter(Boolean);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function computeSearchMatch(item: DashboardRunSummary, query: string): { score: number; snippet?: string } {
  const terms = tokenize(query);
  if (terms.length === 0) return { score: 0 };

  const fields = safeDashboardTexts(item);
  let score = 0;
  let snippet: string | undefined;

  for (const field of fields) {
    const lower = field.toLowerCase();
    const fieldScore = terms.reduce((sum, term) => {
      if (lower === term) return sum + 6;
      if (lower.startsWith(term)) return sum + 4;
      if (lower.includes(term)) return sum + 2;
      return sum;
    }, 0);

    if (fieldScore > score) {
      score = fieldScore;
      snippet = field;
    }
  }

  return { score, snippet };
}

function compareSearchResults(left: DashboardRunSummary, right: DashboardRunSummary): number {
  if ((right.matchScore ?? 0) !== (left.matchScore ?? 0)) {
    return (right.matchScore ?? 0) - (left.matchScore ?? 0);
  }
  if (right.attentionScore !== left.attentionScore) {
    return right.attentionScore - left.attentionScore;
  }
  const recentDiff = (right.lastEventAt ?? "").localeCompare(left.lastEventAt ?? "");
  if (recentDiff !== 0) return recentDiff;
  return left.graphId.localeCompare(right.graphId);
}

function textOverlapScore(...parts: string[]): number {
  const tokens = parts.flatMap((part) => tokenize(part));
  return new Set(tokens).size;
}

function computeAttentionScore(input: {
  highestAlertSeverity?: AlertSeverity;
  needsHumanReview: boolean;
  frontierStatus: FrontierStatus;
  runControlState: RunControlState;
  waitingForApproval: boolean;
  driftTrend: DriftTrend;
  evidenceCoverageRate: number;
  changesSinceLastViewed?: ChangesSinceLastViewed;
}): { attentionScore: number; attentionLabel: AttentionLabel } {
  let attentionScore = 0;

  if (input.highestAlertSeverity === "critical") attentionScore += 100;
  if (input.needsHumanReview) attentionScore += 60;
  if (input.frontierStatus === "blocked") attentionScore += 40;
  if (input.waitingForApproval) attentionScore += 55;
  if (
    input.runControlState === "paused" &&
    (input.changesSinceLastViewed?.newEventCount ?? 0) > 0
  ) {
    attentionScore += 25;
  }
  if (input.driftTrend === "worsening") attentionScore += 20;
  if ((input.changesSinceLastViewed?.newEventCount ?? 0) > 0) attentionScore += 10;
  if (input.evidenceCoverageRate < 0.35) attentionScore += 5;

  const clamped = Math.max(0, Math.min(attentionScore, 200));
  const attentionLabel: AttentionLabel =
    clamped >= 100 ? "urgent" : clamped >= 60 ? "high" : clamped >= 25 ? "medium" : "low";

  return { attentionScore: clamped, attentionLabel };
}

function compareDashboardItems(
  left: DashboardRunSummary,
  right: DashboardRunSummary
): number {
  const severityRank = (severity?: AlertSeverity) =>
    severity === "critical" ? 3 : severity === "warning" ? 2 : severity === "info" ? 1 : 0;

  const severityDiff = severityRank(right.highestAlertSeverity) - severityRank(left.highestAlertSeverity);
  if (severityDiff !== 0) return severityDiff;

  const reviewDiff = Number(right.needsHumanReview) - Number(left.needsHumanReview);
  if (reviewDiff !== 0) return reviewDiff;

  const lastEventDiff = (right.lastEventAt ?? "").localeCompare(left.lastEventAt ?? "");
  if (lastEventDiff !== 0) return lastEventDiff;

  return left.graphId.localeCompare(right.graphId);
}

function buildDashboardOverview(items: DashboardRunSummary[]): DashboardOverview {
  return {
    schemaVersion: "1",
    items,
    summary: {
      urgentRunCount: items.filter((item) => item.attentionLabel === "urgent").length,
      needsReviewCount: items.filter((item) => item.needsHumanReview).length,
      blockedRunCount: items.filter((item) => item.frontierStatus === "blocked").length,
      activeRunCount: items.filter((item) => item.runControlState === "running").length,
      archivedRunCount: items.filter((item) => item.lifecycleBucket === "archived").length,
    },
  };
}

async function getAllGraphIds(): Promise<string[]> {
  const rows = await db
    .select({ graphId: graphEvents.graphId })
    .from(graphEvents)
    .orderBy(asc(graphEvents.graphId), desc(graphEvents.seq))
    .all();

  return [...new Set(rows.map((row) => row.graphId))];
}

export function buildDashboardRunSummary(
  projection: GraphProjection,
  lastSeenSequence = 0,
  nowIso = normalizeNow()
): DashboardRunSummary {
  const changesSinceLastViewed = buildChangesSinceLastViewed(projection, lastSeenSequence);
  const latestCompletedNode = [...projection.nodes]
    .filter((node) => node.status === "completed")
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
    .at(0);
  const score = computeAttentionScore({
    highestAlertSeverity: highestAlertSeverity(projection.alerts),
    needsHumanReview: projection.needsHumanReview,
    frontierStatus: projection.frontierStatus,
    runControlState: projection.runControlState,
    waitingForApproval: projection.waitingForApproval,
    driftTrend: projection.driftTrend,
    evidenceCoverageRate: projection.evidenceCoverageRate,
    changesSinceLastViewed,
  });

  return {
    graphId: projection.graph.id,
    goalTitle: goalSummary(
      projection.goalPackets.find((packet) => packet.id === projection.graph.originalGoalVersionId)?.originalText ??
        projection.graph.goal
    ),
    lifecycleBucket: classifyLifecycleBucket({
      projection,
      changesSinceLastViewed,
      nowIso,
    }),
    graphStatus: projection.graph.status,
    runControlState: projection.runControlState,
    frontierStatus: projection.frontierStatus,
    needsHumanReview: projection.needsHumanReview,
    humanReviewReason: projection.humanReviewReason,
    approvalState: projection.approvalState,
    waitingForApproval: projection.waitingForApproval,
    latestDecisionSummary: projection.latestDecisionSummary,
    lineageSummary: projection.lineageSummary,
    latestNotificationSummary: projection.latestNotificationSummary,
    alertCount: projection.alerts.length,
    highestAlertSeverity: highestAlertSeverity(projection.alerts),
    completedNodeCount: projection.completedNodeCount,
    plannedNodeCount: projection.plannedNodeCount,
    passRate: projection.passRate,
    revisionRate: projection.revisionRate,
    evidenceCoverageRate: projection.evidenceCoverageRate,
    lastEventAt: projection.events.at(-1)?.ts ?? null,
    lastEventSequence: projection.events.at(-1)?.seq ?? 0,
    latestCompletedNodeSummary: latestCompletedNode ? safeNodeSummary(latestCompletedNode) : undefined,
    changesSinceLastViewed,
    attentionScore: score.attentionScore,
    attentionLabel: score.attentionLabel,
  };
}

export function buildDashboardOverviewFromProjections(
  projections: GraphProjection[],
  lastSeenSequenceByGraph: Record<string, number> = {},
  options?: {
    q?: string;
    lifecycle?: DashboardLifecycleBucket | "all";
    attention?: AttentionLabel | "all";
    status?: Graph["status"] | "all";
    now?: string;
  }
): DashboardOverview {
  const nowIso = normalizeNow(options?.now);
  const items = projections
    .map((projection) =>
      buildDashboardRunSummary(projection, lastSeenSequenceByGraph[projection.graph.id] ?? 0, nowIso)
    )
    .filter((item) => (options?.lifecycle && options.lifecycle !== "all" ? item.lifecycleBucket === options.lifecycle : true))
    .filter((item) => (options?.attention && options.attention !== "all" ? item.attentionLabel === options.attention : true))
    .filter((item) => (options?.status && options.status !== "all" ? item.graphStatus === options.status : true))
    .map((item) => {
      if (!options?.q?.trim()) return item;
      const match = computeSearchMatch(item, options.q);
      return {
        ...item,
        matchScore: match.score,
        searchSnippet: match.snippet,
      };
    })
    .filter((item) => (!options?.q?.trim() ? true : (item.matchScore ?? 0) > 0))
    .sort(options?.q?.trim() ? compareSearchResults : compareDashboardItems);

  return buildDashboardOverview(items);
}

export async function getDashboardOverview(
  lastSeenSequenceByGraph: Record<string, number> = {},
  options?: {
    q?: string;
    lifecycle?: DashboardLifecycleBucket | "all";
    attention?: AttentionLabel | "all";
    status?: Graph["status"] | "all";
    now?: string;
  }
): Promise<DashboardOverview> {
  const graphIds = await getAllGraphIds();
  const projections = await Promise.all(graphIds.map((graphId) => getGraphProjection(graphId)));
  return buildDashboardOverviewFromProjections(projections, lastSeenSequenceByGraph, options);
}

function projectionTextForSimilarity(projection: GraphProjection): string {
  const latestCompleted = [...projection.nodes]
    .filter((node) => node.status === "completed")
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
    .at(0);

  return [
    projection.goalPackets.find((packet) => packet.id === projection.graph.originalGoalVersionId)?.originalText ??
      projection.graph.goal,
    projection.currentDriftSummary ?? "",
    latestCompleted?.semanticSummary ?? latestCompleted?.humanSummary ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function textSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function buildSimilarRuns(
  target: GraphProjection,
  others: GraphProjection[],
  lastSeenSequenceByGraph: Record<string, number> = {},
  nowIso = normalizeNow()
): SimilarRunSummary[] {
  const targetGoal =
    target.goalPackets.find((packet) => packet.id === target.graph.originalGoalVersionId) ??
    target.goalPackets[0];
  const targetText = projectionTextForSimilarity(target);

  return others
    .filter((projection) => projection.graph.id !== target.graph.id)
    .map((projection) => {
      const dashboardItem = buildDashboardRunSummary(
        projection,
        lastSeenSequenceByGraph[projection.graph.id] ?? 0,
        nowIso
      );
      const candidateGoal =
        projection.goalPackets.find((packet) => packet.id === projection.graph.originalGoalVersionId) ??
        projection.goalPackets[0];
      const embeddingScore =
        targetGoal?.embedding?.length && candidateGoal?.embedding?.length
          ? cosineSimilarity(targetGoal.embedding, candidateGoal.embedding)
          : 0;
      const fallbackScore = textSimilarity(targetText, projectionTextForSimilarity(projection));
      const similarityScore = embeddingScore > 0 ? embeddingScore : fallbackScore;

      return {
        graphId: projection.graph.id,
        goalTitle: dashboardItem.goalTitle,
        similarityScore,
        lifecycleBucket: dashboardItem.lifecycleBucket,
        frontierStatus: projection.frontierStatus,
        lineageSummary: projection.lineageSummary,
        latestNotificationSummary: projection.latestNotificationSummary,
        latestCompletedNodeSummary: dashboardItem.latestCompletedNodeSummary,
        lastEventAt: projection.events.at(-1)?.ts ?? null,
      };
    })
    .sort((left, right) => {
      if (right.similarityScore !== left.similarityScore) {
        return right.similarityScore - left.similarityScore;
      }
      const recentDiff = (right.lastEventAt ?? "").localeCompare(left.lastEventAt ?? "");
      if (recentDiff !== 0) return recentDiff;
      return left.graphId.localeCompare(right.graphId);
    })
    .map(({ lastEventAt, ...item }) => item);
}

export async function getSimilarRuns(
  graphId: string,
  lastSeenSequenceByGraph: Record<string, number> = {},
  options?: { now?: string }
): Promise<SimilarRunSummary[]> {
  const graphIds = await getAllGraphIds();
  const projections = await Promise.all(graphIds.map((id) => getGraphProjection(id)));
  const target = projections.find((projection) => projection.graph.id === graphId);
  if (!target) throw new Error(`Graph ${graphId} not found`);
  return buildSimilarRuns(target, projections, lastSeenSequenceByGraph, normalizeNow(options?.now));
}

export function buildComparisonSide(report: GraphRunReport): RunComparison["left"] {
  return {
    graphId: report.graphId,
    goalTitle:
      report.goalPackets.find((packet) => packet.id === report.goalPackets[0]?.id)?.originalText ??
      report.plainEnglishReport.split("\n")[0]?.replace(/^Goal:\s*/, "") ??
      report.graphId,
    graphStatus: report.graphStatus,
    frontierStatus: report.frontierStatus,
    runControlState: report.runControlState,
    approvalState: report.approvalState,
    waitingForApproval: report.waitingForApproval,
    plannedNodeCount: report.health.plannedNodeCount,
    completedNodeCount: report.health.completedNodeCount,
    passRate: report.health.passRate,
    revisionRate: report.health.revisionRate,
    evidenceCoverageRate: report.health.evidenceCoverageRate,
    driftTrend: report.health.driftTrend,
    needsHumanReview: report.needsHumanReview,
    highestAlertSeverity: report.alerts[0]?.severity,
    latestDecisionSummary: report.latestDecisionSummary,
    latestNotificationSummary: report.latestNotificationSummary,
    lineageSummary: report.lineageSummary,
    plannerVersion: report.lineage.latestPlannerLineageSummary,
    executorVersion: report.lineage.latestExecutorLineageSummary,
    evaluatorVersion: report.lineage.latestEvaluatorLineageSummary,
    policyVersion: report.lineage.latestPolicyLineageSummary,
    fallbackUsed: report.lineage.lineageDescriptors.some((descriptor) => Boolean(descriptor.fallbackUsed)),
  };
}

export async function getRunComparison(leftGraphId: string, rightGraphId: string): Promise<RunComparison> {
  const [leftReport, rightReport] = await Promise.all([
    getGraphRunReport(leftGraphId),
    getGraphRunReport(rightGraphId),
  ]);

  return buildRunComparison(buildComparisonSide(leftReport), buildComparisonSide(rightReport));
}

export function buildChangesSinceLastViewed(
  projection: GraphProjection,
  lastSeenSequence = 0
): ChangesSinceLastViewed {
  const { graph } = projection;
  const events = projection.events;
  const currentSequence = events.at(-1)?.seq ?? 0;
  const normalizedLastSeen = Math.max(0, Math.min(lastSeenSequence, currentSequence));
  const previousProjection =
    normalizedLastSeen > 0
      ? replayProjection(
          graph.id,
          events.filter((event) => (event.seq ?? 0) <= normalizedLastSeen)
        ) ?? emptyProjection(graph.id)
      : emptyProjection(graph.id);
  const newEvents = events.filter((event) => (event.seq ?? 0) > normalizedLastSeen);
  const mostRecentCompletedNode = [...projection.nodes]
    .filter((node) => node.status === "completed")
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
    .at(0);
  const importantMessage =
    projection.latestDecisionSummary ??
    projection.humanReviewReason ??
    projection.currentDriftSummary ??
    projection.latestNotificationSummary;
  let changesSinceLastViewedSummary = "No important updates right now.";

  if (newEvents.length > 0) {
    const clauses = [`${newEvents.length} new event${newEvents.length === 1 ? "" : "s"} occurred.`];
    if (mostRecentCompletedNode && (previousProjection.completedNodeCount ?? 0) < projection.completedNodeCount) {
      clauses.push(`One step completed: ${mostRecentCompletedNode.humanSummary}`);
    }
    if (previousProjection.runControlState !== projection.runControlState) {
      clauses.push(
        projection.runControlState === "paused"
          ? "The run is now paused."
          : projection.runControlState === "stopped"
            ? "The run is now stopped."
            : projection.runControlState === "running"
              ? "The run is still active."
              : "The run is idle."
      );
    } else {
      clauses.push(
        projection.frontierStatus === "blocked"
          ? "The run is blocked."
          : projection.frontierStatus === "drifting"
            ? "The run is drifting."
            : projection.frontierStatus === "exploring"
              ? "The run is exploring adjacent work."
              : "The run is still on track."
      );
    }
    if (previousProjection.approvalState !== projection.approvalState || projection.waitingForApproval) {
      clauses.push(projection.latestDecisionSummary ?? "A human decision changed the run's supervision state.");
    }
    if (importantMessage && previousProjection.latestNotificationSummary !== projection.latestNotificationSummary) {
      clauses.push(importantMessage);
    }
    changesSinceLastViewedSummary = clauses.join(" ");
  }

  return {
    lastSeenSequence: normalizedLastSeen,
    currentSequence,
    newEventCount: newEvents.length,
    runControlStateChanged: previousProjection.runControlState !== projection.runControlState,
    frontierStatusChanged: previousProjection.frontierStatus !== projection.frontierStatus,
    newAlertsAppeared: projection.alerts.some(
      (alert) => !previousProjection.alerts.some((previousAlert) => previousAlert.id === alert.id)
    ),
    mostRecentCompletedNodeSummary: mostRecentCompletedNode?.humanSummary,
    mostRecentAttentionMessage: importantMessage,
    changesSinceLastViewedSummary,
  };
}

export async function getChangesSinceLastViewed(
  graphId: string,
  lastSeenSequence = 0
): Promise<ChangesSinceLastViewed> {
  const projection = await getGraphProjection(graphId);
  return buildChangesSinceLastViewed(projection, lastSeenSequence);
}

function defaultRelevantNodeFilter(node: Node): boolean {
  return node.status === "completed";
}

export async function findRelevantNodeOutputs(
  graphId: string,
  queryEmbedding: number[],
  limit: number,
  options?: {
    includeSuperseded?: boolean;
  }
): Promise<RelevantNodeOutput[]> {
  if (queryEmbedding.length === 0 || limit <= 0) return [];

  const projection = await getGraphProjection(graphId);
  return findRelevantNodeOutputsInProjection(projection, queryEmbedding, limit, options);
}

export function findRelevantNodeOutputsInProjection(
  projection: GraphProjection,
  queryEmbedding: number[],
  limit: number,
  options?: {
    includeSuperseded?: boolean;
  }
): RelevantNodeOutput[] {
  if (queryEmbedding.length === 0 || limit <= 0) return [];

  const candidates = projection.nodes
    .filter((node) =>
      options?.includeSuperseded
        ? node.status === "completed" || node.status === "superseded"
        : defaultRelevantNodeFilter(node)
    )
    .filter((node) => Boolean(node.semanticSummary) && Boolean(node.semanticEmbedding?.length))
    .map((node) => ({
      nodeId: node.id,
      title: node.title,
      summary: node.semanticSummary!,
      output: node.output,
      completedAt: node.completedAt,
      score: cosineSimilarity(queryEmbedding, node.semanticEmbedding ?? []),
    }))
    .sort((a, b) => {
      if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
      return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
    });

  return candidates.slice(0, limit);
}
