export type GraphStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "stopped";

export type NodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "superseded"
  | "blocked";

export type NodeKind =
  | "plan"
  | "work"
  | "evaluate"
  | "revision"
  | "replan";

export type EdgeKind =
  | "depends_on"
  | "feeds_into"
  | "revises"
  | "evaluates"
  | "supersedes";

export type LayerFilter = "intent" | "action" | "state" | "evaluation";

export type ToolName =
  | "readFile"
  | "writeFile"
  | "listDirectory"
  | "runCommand";

export type DriftDirection = "closer" | "holding" | "drifting";

export type HumanDriftState = "on_track" | "exploring" | "drifting";

export type FrontierStatus = HumanDriftState | "blocked";

export type RunControlState = "running" | "paused" | "stopped" | "idle";

export type EvidenceCoverage = "none" | "partial" | "grounded";

export type ConfidenceBadge = "low" | "medium" | "high";

export type DriftTrend = "improving" | "steady" | "worsening";
export type ActorRole = "viewer" | "operator" | "reviewer" | "admin";
export type AuthMode = "dev_header" | "jwt";
export type AuthSessionStatus =
  | "authenticated"
  | "anonymous"
  | "invalid"
  | "expired";

export type AnnotationKind = "note" | "warning" | "decision_context";
export type LineageKind =
  | "planner"
  | "executor"
  | "evaluator"
  | "retriever"
  | "policy";
export type LineageSource = "built_in" | "local_config" | "runtime_override";

export type ApprovalState =
  | "not_requested"
  | "requested"
  | "approved"
  | "rejected";

export type AlertType =
  | "review_needed"
  | "run_blocked"
  | "run_paused"
  | "run_stopped"
  | "drift_worsening"
  | "deterministic_failure"
  | "run_completed";

export type AlertSeverity = "info" | "warning" | "critical";
export type AttentionLabel = "low" | "medium" | "high" | "urgent";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticsStatus = "ok" | "degraded" | "error";
export type DashboardFilter =
  | "all"
  | "needs_review"
  | "blocked"
  | "active"
  | "completed"
  | "attention_first";
export type DashboardSort = "most_recent" | "highest_attention" | "progress";
export type DashboardLifecycleBucket =
  | "active"
  | "needs_attention"
  | "completed_recent"
  | "archived";

export type ProjectGraphNodeKind =
  | "directory"
  | "source"
  | "test"
  | "doc"
  | "config"
  | "asset";

export type ProjectGraphEdgeKind =
  | "contains"
  | "imports"
  | "tests"
  | "references";

export interface ProjectGraphNode {
  id: string;
  label: string;
  path: string;
  kind: ProjectGraphNodeKind;
  group: string;
  sizeBytes?: number;
  lineCount?: number;
  importCount?: number;
}

export interface ProjectGraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: ProjectGraphEdgeKind;
}

export interface ProjectGraphResponse {
  root: string;
  generatedAt: string;
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
  breakers?: {
    project: ScanBreakerStatus;
  };
  progress?: ScanProgressSnapshot;
  diagnostics?: string[];
  summary: {
    fileCount: number;
    directoryCount: number;
    importEdgeCount: number;
    testEdgeCount: number;
    referenceEdgeCount: number;
    scannedFileCount: number;
    skippedFileCount: number;
    skippedDirectoryCount: number;
    partial?: boolean;
  };
}

export type ScanBreakerLimitKey =
  | "maxFiles"
  | "maxTotalBytes"
  | "maxFileBytes"
  | "maxDepth"
  | "maxDurationMs";

export type ScanBreakerState = "ok" | "near" | "hit";

export interface ScanBreakerLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxDepth: number;
  maxDurationMs: number;
}

export interface ScanBreakerAlert {
  key: ScanBreakerLimitKey;
  limit: number;
  observed: number;
  message: string;
}

export interface ScanBreakerStatus {
  state: ScanBreakerState;
  limits: ScanBreakerLimits;
  hits: ScanBreakerAlert[];
  near: ScanBreakerAlert[];
}

export type ScanProgressPhase =
  | "queued"
  | "collecting_files"
  | "analyzing_files"
  | "semantic_analysis"
  | "writing_graph"
  | "completed"
  | "failed";

export type ScanProgressScope = "product_codebase" | "project_graph";

export interface ScanProgressSnapshot {
  scanId: string;
  scope: ScanProgressScope;
  phase: ScanProgressPhase;
  startedAt: string;
  updatedAt: string;
  filesScanned: number;
  bytesScanned: number;
  skippedFileCount: number;
  skippedDirectoryCount: number;
  filesPerSecond: number;
  megabytesPerSecond: number;
  etaMs?: number;
  message?: string;
  breakers: ScanBreakerStatus;
}

export type ScanJobLifecycleStatus = "queued" | "running" | "completed" | "failed";

export interface ScanJobStatus<TResult = unknown> {
  jobId: string;
  scope: ScanProgressScope;
  status: ScanJobLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  progress: ScanProgressSnapshot;
  result?: TResult;
  error?: string;
}

export interface ActorIdentity {
  actorId: string;
  displayName: string;
  role: ActorRole;
}

export type OpenAgentGraphAgentKind =
  | "human"
  | "codex"
  | "gemini"
  | "grok"
  | "script"
  | "runner"
  | "unknown";

export type AgentProgressStatus = "started" | "progress" | "blocked" | "completed" | "failed";

export interface OpenAgentGraphAgentIdentity {
  agentId: string;
  displayName: string;
  kind: OpenAgentGraphAgentKind;
  model?: string;
  version?: string;
  capabilities?: string[];
  sessionId?: string;
}

export interface GraphFrontierNodeSummary {
  nodeId: string;
  title: string;
  kind: NodeKind;
  status: NodeStatus;
  schedulingState?: "claimable" | "in_progress" | "blocked" | "waiting" | "not_actionable";
  agentAction?: "start" | "observe" | "unblock" | "wait" | "none";
  humanSummary: string;
  dependsOnNodeIds: string[];
  evidenceCoverage?: EvidenceCoverage;
  confidenceBadge?: ConfidenceBadge;
  updatedAt: string;
}

export interface AgentProgressSubmission {
  agent: OpenAgentGraphAgentIdentity;
  nodeId?: string;
  status: AgentProgressStatus;
  summary: string;
  details?: string;
  metadata?: Record<string, NodeEvidenceMetadataValue>;
}

export interface AgentEvidenceSubmission {
  agent: OpenAgentGraphAgentIdentity;
  nodeId?: string;
  productNodeId?: string;
  summary: string;
  files?: string[];
  commands?: string[];
  confidence?: number;
  metadata?: Record<string, NodeEvidenceMetadataValue>;
}

export interface AgentPlanProposalNode {
  title: string;
  intent: string;
  kind?: NodeKind;
  humanSummary?: string;
  acceptanceCriteria?: string[];
  dependsOnNodeIds?: string[];
}

export interface AgentPlanProposal {
  agent: OpenAgentGraphAgentIdentity;
  title: string;
  summary: string;
  reason?: string;
  nodes: AgentPlanProposalNode[];
  metadata?: Record<string, NodeEvidenceMetadataValue>;
}

export interface AgentActivityRecord {
  id: string;
  graphId: string;
  kind: "registered" | "progress" | "evidence" | "plan_proposed" | "plan_accepted" | "plan_dismissed";
  agent?: OpenAgentGraphAgentIdentity;
  nodeId?: string;
  proposalId?: string;
  summary: string;
  createdAt: string;
  actor?: ActorIdentity;
}

export interface AgentPlanProposalRecord extends AgentPlanProposal {
  proposalId: string;
  graphId: string;
  createdAt: string;
  actor?: ActorIdentity;
  acceptedAt?: string;
  acceptedBy?: ActorIdentity;
  acceptedNodeIds?: string[];
  dismissedAt?: string;
  dismissedBy?: ActorIdentity;
  dismissalReason?: string;
}

export interface AgentCodeContextNodeSummary {
  id: string;
  kind: string;
  label: string;
  path?: string;
}

export interface AgentCodeContextSlice {
  source: "unified_code_graph";
  workspaceRoot: string;
  generatedAt: string;
  primaryLens: string;
  readTheseFirst: AgentCodeContextNodeSummary[];
  godNodes: Array<{
    label: string;
    summary: string;
    topFiles: string[];
    topSymbols: string[];
  }>;
  focusNodes: AgentCodeContextNodeSummary[];
  focusEdges: Array<{
    kind: string;
    sourceNodeId: string;
    targetNodeId: string;
    provenance: string;
  }>;
  linkedRunPaths: string[];
  truncated: boolean;
}

export interface AgentContextPack {
  graphId: string;
  generatedAt: string;
  graph: Pick<Graph, "id" | "title" | "goal" | "status" | "activeGoalVersionId">;
  run: {
    runControlState: RunControlState;
    frontierStatus: FrontierStatus;
    plannedNodeCount: number;
    completedNodeCount: number;
    failedNodeCount: number;
    claimableReadyCount?: number;
    inProgressCount?: number;
    blockedActionCount?: number;
    deferredReadyCount?: number;
    runHealthSummary: string;
  };
  selectedNode?: GraphFrontierNodeSummary;
  frontier: GraphFrontierNodeSummary[];
  recentAgentActivity: AgentActivityRecord[];
  planProposals: AgentPlanProposalRecord[];
  codeContext?: AgentCodeContextSlice;
  fusionChecks?: Array<{
    code: string;
    title: string;
    severity: "fail" | "warn" | "info";
    detail: string;
    count?: number;
  }>;
  instructions: string[];
}

export interface AgentRegisteredPayload {
  agent: OpenAgentGraphAgentIdentity;
  createdAt: string;
  actor?: ActorIdentity;
}

export interface AgentProgressReportedPayload extends AgentProgressSubmission {
  progressId: string;
  graphId: string;
  createdAt: string;
  actor?: ActorIdentity;
}

export interface AgentEvidenceSubmittedPayload extends AgentEvidenceSubmission {
  evidenceId: string;
  graphId: string;
  createdAt: string;
  actor?: ActorIdentity;
}

export interface AgentPlanProposedPayload extends AgentPlanProposal {
  proposalId: string;
  graphId: string;
  createdAt: string;
  actor?: ActorIdentity;
}

export interface AgentPlanAcceptedPayload {
  proposalId: string;
  graphId: string;
  acceptedAt: string;
  acceptedBy: ActorIdentity;
  acceptedNodeIds: string[];
}

export interface AgentPlanDismissedPayload {
  proposalId: string;
  graphId: string;
  dismissedAt: string;
  dismissedBy: ActorIdentity;
  reason?: string;
}

export interface AuthSessionResponse {
  authMode: AuthMode;
  authRequiredForProtectedActions: boolean;
  status: AuthSessionStatus;
  actor?: ActorIdentity;
  message: string;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  graphId?: string;
  nodeId?: string;
  eventSequence?: number;
  actorId?: string;
  requestId?: string;
  errorCode?: string;
  runLoopId?: string;
  safeMetadata?: Record<string, string | number | boolean | null>;
}

export interface DiagnosticsCheck {
  status: DiagnosticsStatus;
  message: string;
  details?: string[];
}

export interface DiagnosticsResponse {
  status: DiagnosticsStatus;
  checks: Record<string, DiagnosticsCheck>;
  timestamp: string;
}

export type MetricsValueType = "counter" | "gauge";

export interface MetricsSample {
  name: string;
  help: string;
  type: MetricsValueType;
  labels?: Record<string, string>;
  value: number;
}

export interface GraphCapabilities {
  canAnnotate: boolean;
  canRequestReview: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  canRequestApproval: boolean;
  canApprove: boolean;
  canReject: boolean;
  canContinue: boolean;
}

export interface AnnotationRecord {
  annotationId: string;
  graphId: string;
  nodeId?: string;
  createdAt: string;
  authorLabel: string;
  actor?: ActorIdentity;
  text: string;
  kind: AnnotationKind;
}

export interface LineageDescriptor {
  lineageId: string;
  graphId: string;
  createdAt: string;
  kind: LineageKind;
  label: string;
  version: string;
  contentHash: string;
  summary: string;
  source: LineageSource;
  notes?: string;
  modelName?: string;
  fallbackUsed?: boolean;
  promptSummary?: string;
}

export interface NodeLineageBinding {
  graphId: string;
  nodeId: string;
  createdAt: string;
  bindings: Array<{
    kind: LineageKind;
    lineageId: string;
  }>;
}

export interface Graph {
  id: string;
  title: string;
  goal: string;
  constraints?: string;
  status: GraphStatus;
  originalGoalVersionId: string;
  activeGoalVersionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphCoordinates {
  depth: number;
  branch: number;
  abstractionLevel: number;
  driftDistance: number;
  baselineDriftDistance: number;
}

export interface NodeContract {
  expectedArtifact: string;
  allowedTools: ToolName[];
  acceptanceCriteria: string[];
  humanSummary: string;
}

export interface FileDiff {
  path: string;
  changeType: "created" | "updated" | "deleted";
  summary: string;
  before?: string;
  after?: string;
  beforeChecksum?: string;
  afterChecksum?: string;
  beforeTruncated?: boolean;
  afterTruncated?: boolean;
}

export interface CommandResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  startedAt: string;
  finishedAt: string;
}

export interface ToolCallRecord {
  id: string;
  nodeId: string;
  tool: ToolName;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export type NodeEvidenceMetadataValue = string | number | boolean | null;

export interface NodeEvidenceSampling {
  compacted: boolean;
  policy: string;
  reason?: string;
  pinned?: boolean;
  originalFileDiffCount?: number;
  originalCommandResultCount?: number;
  originalToolCallCount?: number;
}

export interface NodeEvidence {
  fileDiffs: FileDiff[];
  commandResults: CommandResult[];
  toolCallLog: ToolCallRecord[];
  workspaceChecksum: string;
  workspaceChecksumBefore: string;
  workspaceChecksumAfter: string;
  metadata?: Record<string, NodeEvidenceMetadataValue>;
  sampling?: NodeEvidenceSampling;
}

export interface GoalPacket {
  id: string;
  version: number;
  originalText: string;
  successCriteria: string[];
  forbiddenScope: string[];
  embedding: number[];
  criteriaEmbeddings: number[][];
  createdAt: string;
}

export interface NodeEvaluation {
  llmPassed: boolean;
  deterministicPassed: boolean;
  passed: boolean;
  driftScore: number;
  baselineDriftScore: number;
  direction: DriftDirection;
  humanSummary: string;
  suggestedAction: "complete" | "revise" | "replan";
  findings: string[];
  ruleViolations: string[];
}

export interface Node {
  id: string;
  graphId: string;
  kind: NodeKind;
  title: string;
  intent: string;
  inputContext?: string;
  prompt?: string;
  output?: string;
  humanSummary: string;
  status: NodeStatus;
  contract: NodeContract;
  evidence?: NodeEvidence;
  evaluation?: NodeEvaluation;
  semanticSummary?: string;
  semanticEmbedding?: number[];
  evidenceSummary?: string;
  workspaceStateChanged?: boolean;
  evidenceCoverage?: EvidenceCoverage;
  confidenceBadge?: ConfidenceBadge;
  confidence?: number;
  annotations?: AnnotationRecord[];
  annotationCount?: number;
  lineageBindings?: Array<{
    kind: LineageKind;
    lineageId: string;
  }>;
  lineageSummary?: string;
  parentNodeId?: string;
  branchId?: string;
  baselineGoalVersionId: string;
  activeGoalVersionId: string;
  dependsOnNodeIds: string[];
  coordinates?: GraphCoordinates;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Edge {
  id: string;
  graphId: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: EdgeKind;
  createdAt: string;
}

export interface GraphProjection {
  graph: Graph;
  currentActor?: ActorIdentity;
  capabilities?: GraphCapabilities;
  goalPackets: GoalPacket[];
  nodes: Node[];
  edges: Edge[];
  events: GraphEvent[];
  driftState: HumanDriftState;
  driftSummary: string;
  currentDriftSummary: string | null;
  frontierStatus: FrontierStatus;
  runControlState: RunControlState;
  canResume: boolean;
  canPause: boolean;
  canStop: boolean;
  approvalState: ApprovalState;
  approvalRequestedAt?: string;
  waitingForApproval: boolean;
  latestDecisionSummary?: string;
  needsHumanReview: boolean;
  humanReviewReason?: string;
  reviewRequestedAt?: string;
  graphAnnotations: AnnotationRecord[];
  annotationCount: number;
  latestAnnotationSummary?: string;
  peopleSummary?: string;
  lineageDescriptors: LineageDescriptor[];
  lineageCount: number;
  latestPlannerLineageSummary?: string;
  latestExecutorLineageSummary?: string;
  latestEvaluatorLineageSummary?: string;
  latestRetrieverLineageSummary?: string;
  latestPolicyLineageSummary?: string;
  lineageSummary?: string;
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
  alerts: GraphAlert[];
  latestNotificationSummary?: string;
  changesSinceLastViewed?: ChangesSinceLastViewed;
  agentActivity?: AgentActivityRecord[];
  agentPlanProposals?: AgentPlanProposalRecord[];
}

export interface ReplayFrame {
  stepIndex: number;
  totalSteps: number;
  event: GraphEvent | null;
  projection: GraphProjection;
  plainEnglishSummary: string;
}

export interface GraphAlert {
  id: string;
  type: AlertType;
  graphId: string;
  createdAt: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  relatedNodeId?: string;
  relatedEventSequence?: number;
}

export interface ChangesSinceLastViewed {
  lastSeenSequence: number;
  currentSequence: number;
  newEventCount: number;
  runControlStateChanged: boolean;
  frontierStatusChanged: boolean;
  newAlertsAppeared: boolean;
  mostRecentCompletedNodeSummary?: string;
  mostRecentAttentionMessage?: string;
  changesSinceLastViewedSummary: string;
}

export interface DashboardRunSummary {
  graphId: string;
  goalTitle: string;
  lifecycleBucket: DashboardLifecycleBucket;
  graphStatus: GraphStatus;
  runControlState: RunControlState;
  frontierStatus: FrontierStatus;
  needsHumanReview: boolean;
  humanReviewReason?: string;
  approvalState: ApprovalState;
  waitingForApproval: boolean;
  latestDecisionSummary?: string;
  lineageSummary?: string;
  latestNotificationSummary?: string;
  alertCount: number;
  highestAlertSeverity?: AlertSeverity;
  completedNodeCount: number;
  plannedNodeCount: number;
  passRate: number;
  revisionRate: number;
  evidenceCoverageRate: number;
  lastEventAt: string | null;
  lastEventSequence: number;
  latestCompletedNodeSummary?: string;
  changesSinceLastViewed?: ChangesSinceLastViewed;
  attentionScore: number;
  attentionLabel: AttentionLabel;
  searchSnippet?: string;
  matchScore?: number;
}

export interface DashboardOverview {
  schemaVersion: "1";
  items: DashboardRunSummary[];
  summary: {
    urgentRunCount: number;
    needsReviewCount: number;
    blockedRunCount: number;
    activeRunCount: number;
    archivedRunCount: number;
  };
}

export interface SimilarRunSummary {
  graphId: string;
  goalTitle: string;
  similarityScore: number;
  lifecycleBucket: DashboardLifecycleBucket;
  frontierStatus: FrontierStatus;
  lineageSummary?: string;
  latestNotificationSummary?: string;
  latestCompletedNodeSummary?: string;
}

export interface RunComparisonSide {
  graphId: string;
  goalTitle: string;
  graphStatus: GraphStatus;
  frontierStatus: FrontierStatus;
  runControlState: RunControlState;
  approvalState: ApprovalState;
  waitingForApproval: boolean;
  plannedNodeCount: number;
  completedNodeCount: number;
  passRate: number;
  revisionRate: number;
  evidenceCoverageRate: number;
  driftTrend: DriftTrend;
  needsHumanReview: boolean;
  highestAlertSeverity?: AlertSeverity;
  latestDecisionSummary?: string;
  latestNotificationSummary?: string;
  lineageSummary?: string;
  plannerVersion?: string;
  executorVersion?: string;
  evaluatorVersion?: string;
  policyVersion?: string;
  fallbackUsed?: boolean;
}

export interface RunComparison {
  left: RunComparisonSide;
  right: RunComparisonSide;
  summary: string;
}

export type GraphEventKind =
  | "system.lineage_declared"
  | "node.lineage_bound"
  | "node.planned"
  | "node.ready"
  | "node.executing"
  | "node.output"
  | "node.tool_call"
  | "node.completed"
  | "node.summarized"
  | "node.failed"
  | "node.evaluated"
  | "node.superseded"
  | "goal.version_created"
  | "replan.branched"
  | "run.started"
  | "run.pause_requested"
  | "run.paused"
  | "run.resume_requested"
  | "run.resumed"
  | "run.stop_requested"
  | "run.stopped"
  | "run.annotated"
  | "node.annotated"
  | "run.approval_requested"
  | "run.approved"
  | "run.rejected"
  | "run.continue_requested"
  | "run.review_requested"
  | "run.completed"
  | "run.failed"
  | "agent.registered"
  | "agent.progress_reported"
  | "agent.evidence_submitted"
  | "agent.plan_proposed"
  | "agent.plan_accepted"
  | "agent.plan_dismissed";

export interface GoalVersionCreatedPayload {
  graphTitle: string;
  goal: string;
  constraints?: string;
  goalPacket: GoalPacket;
  activate: boolean;
}

export interface NodePlannedPayload {
  kind: NodeKind;
  title: string;
  intent: string;
  inputContext?: string;
  humanSummary: string;
  contract: NodeContract;
  parentNodeId?: string;
  branchId?: string;
  baselineGoalVersionId: string;
  activeGoalVersionId: string;
  dependsOnNodeIds: string[];
  coordinates?: GraphCoordinates;
}

export interface NodeReadyPayload {
  readyReason: string;
}

export interface NodeExecutingPayload {
  prompt: string;
  workspaceRoot: string;
}

export interface NodeOutputPayload {
  output: string;
  mode: "partial" | "final";
}

export interface NodeToolCallPayload {
  toolCall: ToolCallRecord;
}

export interface NodeCompletedPayload {
  output: string;
  confidence?: number;
  evidence: NodeEvidence;
}

export interface NodeSummarizedPayload {
  summary: string;
  embedding: number[];
  summaryGeneratedAt: string;
}

export interface NodeFailedPayload {
  reason: string;
  details?: string;
  metadata?: Record<string, NodeEvidenceMetadataValue>;
}

export interface NodeEvaluatedPayload {
  evaluation: NodeEvaluation;
}

export interface NodeSupersededPayload {
  branchId: string;
  supersededByNodeId?: string;
  reason: string;
}

export interface ReplanBranchedPayload {
  branchId: string;
  sourceNodeId: string;
  newGoalVersionId: string;
  reason: string;
}

export interface RunStartedPayload {
  workspaceRoot: string;
  goalVersionId: string;
}

export interface RunPauseRequestedPayload {
  reason?: string;
  actor?: ActorIdentity;
}

export interface RunPausedPayload {
  afterNodeId?: string;
}

export interface RunResumeRequestedPayload {
  reason?: string;
  actor?: ActorIdentity;
}

export interface RunResumedPayload {
  workspaceRoot: string;
  goalVersionId: string;
}

export interface RunStopRequestedPayload {
  reason?: string;
  actor?: ActorIdentity;
}

export interface RunStoppedPayload {
  afterNodeId?: string;
}

export interface RunReviewRequestedPayload {
  reason?: string;
  actor?: ActorIdentity;
}

export interface AnnotationEventPayload extends AnnotationRecord {}

export interface DecisionEventPayload {
  decisionId: string;
  graphId: string;
  nodeId?: string;
  createdAt: string;
  authorLabel: string;
  actor?: ActorIdentity;
  reason?: string;
}

export interface SystemLineageDeclaredPayload extends LineageDescriptor {}

export interface NodeLineageBoundPayload extends NodeLineageBinding {}

export interface RunCompletedPayload {
  completedNodeIds: string[];
}

export interface RunFailedPayload {
  reason: string;
  blocked: boolean;
}

export interface GraphEventPayloadMap {
  "system.lineage_declared": SystemLineageDeclaredPayload;
  "node.lineage_bound": NodeLineageBoundPayload;
  "goal.version_created": GoalVersionCreatedPayload;
  "node.planned": NodePlannedPayload;
  "node.ready": NodeReadyPayload;
  "node.executing": NodeExecutingPayload;
  "node.output": NodeOutputPayload;
  "node.tool_call": NodeToolCallPayload;
  "node.completed": NodeCompletedPayload;
  "node.summarized": NodeSummarizedPayload;
  "node.failed": NodeFailedPayload;
  "node.evaluated": NodeEvaluatedPayload;
  "node.superseded": NodeSupersededPayload;
  "replan.branched": ReplanBranchedPayload;
  "run.started": RunStartedPayload;
  "run.pause_requested": RunPauseRequestedPayload;
  "run.paused": RunPausedPayload;
  "run.resume_requested": RunResumeRequestedPayload;
  "run.resumed": RunResumedPayload;
  "run.stop_requested": RunStopRequestedPayload;
  "run.stopped": RunStoppedPayload;
  "run.annotated": AnnotationEventPayload;
  "node.annotated": AnnotationEventPayload;
  "run.approval_requested": DecisionEventPayload;
  "run.approved": DecisionEventPayload;
  "run.rejected": DecisionEventPayload;
  "run.continue_requested": DecisionEventPayload;
  "run.review_requested": RunReviewRequestedPayload;
  "run.completed": RunCompletedPayload;
  "run.failed": RunFailedPayload;
  "agent.registered": AgentRegisteredPayload;
  "agent.progress_reported": AgentProgressReportedPayload;
  "agent.evidence_submitted": AgentEvidenceSubmittedPayload;
  "agent.plan_proposed": AgentPlanProposedPayload;
  "agent.plan_accepted": AgentPlanAcceptedPayload;
  "agent.plan_dismissed": AgentPlanDismissedPayload;
}

export interface GraphEvent<K extends GraphEventKind = GraphEventKind> {
  id: string;
  graphId: string;
  kind: K;
  nodeId?: string;
  goalVersionId?: string;
  payload: GraphEventPayloadMap[K];
  ts: string;
  seq?: number;
}

export interface CreateGraphRequest {
  title: string;
  goal: string;
  constraints?: string;
  successCriteria?: string[];
  forbiddenScope?: string[];
}

export interface StartRunRequest {
  workspaceRoot: string;
}

export interface RunControlRequest {
  reason?: string;
}

export interface AnnotationRequest {
  text: string;
  kind: AnnotationKind;
}

export interface DecisionRequest {
  reason?: string;
}

export interface RetryNodeRequest {
  reason?: string;
}

export interface ReplanRequest {
  newGoal: string;
  reason: string;
  successCriteria?: string[];
  forbiddenScope?: string[];
}

export interface GraphContext {
  currentNode: Node;
  projection: GraphProjection;
  activeGoalPacket: GoalPacket;
  workspaceRoot?: string;
  previousNodeOutput?: string;
  retrievalMode?: "semantic" | "fallback";
  relevantOutputs: Array<{
    nodeId: string;
    title: string;
    summary: string;
    output?: string;
    score?: number;
  }>;
}

export interface SemanticNodeSummary {
  summary: string;
  embedding: number[];
  summaryGeneratedAt: string;
}

export interface RelevantNodeOutput {
  nodeId: string;
  title: string;
  summary: string;
  output?: string;
  score?: number;
  completedAt?: string;
}

export interface PlanGraphNodeInput {
  kind: NodeKind;
  title: string;
  intent: string;
  inputContext?: string;
  contract: NodeContract;
  humanSummary: string;
  parentNodeId?: string;
  branchId?: string;
  dependsOnNodeIds: string[];
  coordinates?: GraphCoordinates;
}

export interface PlanGraphResult {
  nodes: PlanGraphNodeInput[];
}

export interface ExecuteNodeResult {
  output: string;
  prompt: string;
  toolCalls: Omit<ToolCallRecord, "id" | "nodeId">[];
  evidence: NodeEvidence;
  confidence?: number;
}

export interface EvaluateNodeResult {
  evaluation: NodeEvaluation;
}

export interface ProviderLineageSnapshot {
  planner?: LineageDescriptor;
  executor?: LineageDescriptor;
  evaluator?: LineageDescriptor;
  retriever?: LineageDescriptor;
  policy?: LineageDescriptor;
}
