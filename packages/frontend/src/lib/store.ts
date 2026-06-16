import { create } from "zustand";
import type {
  ActorIdentity,
  ActorRole,
  AgentActivityRecord,
  AgentContextPack,
  AgentPlanProposalRecord,
  AnnotationKind,
  AnnotationRecord,
  ApprovalState,
  AttentionLabel,
  AuthMode,
  AuthSessionResponse,
  AuthSessionStatus,
  ChangesSinceLastViewed,
  ConfidenceBadge,
  DashboardFilter,
  DashboardLifecycleBucket,
  DashboardOverview,
  DashboardRunSummary,
  DashboardSort,
  DiagnosticsResponse,
  DiagnosticsStatus,
  Edge,
  GraphAlert,
  Graph,
  GraphEvent,
  GraphFrontierNodeSummary,
  GraphProjection,
  GraphStatus,
  GraphTaskLensId,
  GoalPacket,
  Node,
  NodeOutputPayload,
  ProjectGraphResponse,
  ProductGraphCodexPlanningPrompt,
  ProductGraphEdge,
  ProductGraphNode,
  ProductGraphProjection,
  ProductGraphTrace,
  RunComparison,
  RunControlState,
  ScanJobStatus,
  ScanProgressSnapshot,
  SimilarRunSummary,
  WorkspaceGraphOperationalContext,
} from "@openagentgraph/shared";
import { apiUrl, frontendRuntimeConfig } from "./runtime.js";
import { LARGE_GRAPH_NODE_THRESHOLD, type GraphDetailMode } from "./graphRuntime.js";
import {
  acceptProductGraphCodexPlan as acceptProductGraphCodexPlanRequest,
  createProductGraphEdge as createProductGraphEdgeRequest,
  createProductGraphIntentBundle as createProductGraphIntentBundleRequest,
  createProductGraphNode as createProductGraphNodeRequest,
  fetchProductGraphCodexPlan as fetchProductGraphCodexPlanRequest,
  fetchProductGraphCodebaseScanJob as fetchProductGraphCodebaseScanJobRequest,
  fetchProductGraphHandoff as fetchProductGraphHandoffRequest,
  fetchWorkspaceGraphOperational as fetchWorkspaceGraphOperationalRequest,
  fetchProductGraph as fetchProductGraphRequest,
  fetchProductGraphTrace as fetchProductGraphTraceRequest,
  importProductGraphSpecKit as importProductGraphSpecKitRequest,
  linkProductGraphRun as linkProductGraphRunRequest,
  scanProductGraphCodebase as scanProductGraphCodebaseRequest,
  startProductGraphCodebaseScanJob as startProductGraphCodebaseScanJobRequest,
  writeProductGraphHandoff as writeProductGraphHandoffRequest,
  type AcceptProductGraphCodexPlanInput,
  type AcceptProductGraphCodexPlanResult,
  type CreateProductGraphEdgeInput,
  type CreateProductGraphIntentBundleInput,
  type CreateProductGraphIntentBundleResult,
  type CreateProductGraphNodeInput,
  type ImportProductGraphSpecKitResult,
  type LinkProductGraphRunInput,
  type LinkProductGraphRunResult,
  type ProductGraphHandoffResult,
  type ProductGraphRequestAuth,
  type ScanProductGraphCodebaseResult,
  type WriteProductGraphHandoffResult,
} from "./productGraphApi.js";

type SessionLifecycle =
  | "signed_in"
  | "read_only"
  | "auth_required"
  | "invalid_session"
  | "expired_session";

type ProductGraphTraceCache = Record<string, ProductGraphTrace>;

type ProductGraphRefreshOptions = {
  preserveTraceNotice?: boolean;
};
type ProviderStatus = {
  configured: boolean;
  provider: "openai" | "ollama" | "gemini" | "anthropic" | "openai-compatible" | "unset";
  source: "environment" | "runtime" | "unset";
  model?: string;
  baseUrl?: string;
  message: string;
};
type ConfigureProviderInput = {
  provider: "openai" | "ollama" | "gemini" | "anthropic" | "openai-compatible";
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};
type AgentFrontierResponse = {
  graphId: string;
  generatedAt: string;
  summary: {
    runControlState: RunControlState;
    frontierStatus: GraphProjection["frontierStatus"];
    readyCount: number;
    runningCount: number;
    blockedCount: number;
    openProposalCount: number;
    claimableReadyCount?: number;
    inProgressCount?: number;
    blockedActionCount?: number;
    deferredReadyCount?: number;
  };
  frontier: GraphFrontierNodeSummary[];
  recentAgentActivity: AgentActivityRecord[];
  planProposals: AgentPlanProposalRecord[];
};

const HOSTED_KEY_PROVIDER_LABELS = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
} as const;

const DEFAULT_PROVIDER_STATUS: ProviderStatus = {
  configured: false,
  provider: "unset",
  source: "unset",
  message: "AI provider status has not been checked yet.",
};

let currentSubscription: (() => void) | null = null;
let productGraphTraceRequestSequence = 0;
let productGraphCodexPlanRequestSequence = 0;
const PRODUCT_GRAPH_TRACE_CACHE_LIMIT = 8;
const PRODUCT_GRAPH_TRACE_CLEARED_NOTICE = "Graph trace cache cleared after graph refresh.";
const MAX_DIAGNOSTIC_TEXT_LENGTH = 180;
const MAX_PROVIDER_DIAGNOSTIC_DETAIL_COUNT = 3;
const LAST_SEEN_STORAGE_KEY = "openagentgraph:last-seen";
const ACTOR_STORAGE_KEY = "openagentgraph:actor-id";
const AUTH_TOKEN_STORAGE_KEY = "openagentgraph:auth-token";
const ONBOARDING_STORAGE_KEY = "openagentgraph:onboarding-dismissed";
const UI_MODE_STORAGE_KEY = "openagentgraph:ui-mode";
const AVAILABLE_ACTORS: ActorIdentity[] = [
  { actorId: "viewer", displayName: "Viewer", role: "viewer" },
  { actorId: "operator", displayName: "Operator", role: "operator" },
  { actorId: "reviewer", displayName: "Reviewer", role: "reviewer" },
  { actorId: "admin", displayName: "Admin", role: "admin" },
];

function readLastSeenMap(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(LAST_SEEN_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeLastSeenMap(value: Record<string, number>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, JSON.stringify(value));
}

function readActorId(): string {
  if (typeof window === "undefined") return "operator";
  return window.localStorage.getItem(ACTOR_STORAGE_KEY) ?? "operator";
}

function writeActorId(actorId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTOR_STORAGE_KEY, actorId);
}

function readAuthToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const sessionToken = window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (sessionToken) return sessionToken;
  } catch {
    // Fall through to the legacy localStorage cleanup path.
  }

  try {
    const legacyToken = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? "";
    if (legacyToken) {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      try {
        window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, legacyToken);
      } catch {
        // Keep the token in memory only if sessionStorage is unavailable.
      }
    }
    return legacyToken;
  } catch {
    return "";
  }
}

function writeAuthToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // Best-effort cleanup of the older persistent token location.
  }
  if (token) {
    try {
      window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } catch {
      // The store state still keeps the token for this in-memory session.
    }
    return;
  }
  try {
    window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // Nothing else to clear.
  }
}

function readOnboardingDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
}

function writeOnboardingDismissed(value: boolean) {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    return;
  }
  window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
}

function readUiMode(): "default" | "developer" {
  if (typeof window === "undefined") return "default";
  return window.localStorage.getItem(UI_MODE_STORAGE_KEY) === "developer" ? "developer" : "default";
}

function writeUiMode(mode: "default" | "developer") {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
}

function cacheProductGraphTrace(cache: ProductGraphTraceCache, trace: ProductGraphTrace): ProductGraphTraceCache {
  const next = { ...cache };
  delete next[trace.rootNode.id];
  next[trace.rootNode.id] = trace;

  const keys = Object.keys(next);
  if (keys.length <= PRODUCT_GRAPH_TRACE_CACHE_LIMIT) return next;

  const trimmed = { ...next };
  for (const key of keys.slice(0, keys.length - PRODUCT_GRAPH_TRACE_CACHE_LIMIT)) {
    delete trimmed[key];
  }
  return trimmed;
}

function hasProductGraphTraceData(
  state: Pick<AppState, "productGraphTrace" | "productGraphTracesByNodeId">
) {
  return Boolean(state.productGraphTrace || Object.keys(state.productGraphTracesByNodeId).length > 0);
}

function invalidateProductGraphTraceState(showNotice: boolean) {
  productGraphTraceRequestSequence += 1;
  return {
    productGraphTrace: null,
    productGraphTracesByNodeId: {},
    productGraphTraceNodeId: null,
    productGraphTraceLoading: false,
    productGraphTraceError: "",
    productGraphTraceNotice: showNotice ? PRODUCT_GRAPH_TRACE_CLEARED_NOTICE : "",
  };
}

function invalidateProductGraphCodexPlanState() {
  productGraphCodexPlanRequestSequence += 1;
  return {
    productGraphCodexPlan: null,
    productGraphCodexPlanTaskNodeId: null,
    productGraphCodexPlanLoading: false,
    productGraphCodexPlanError: "",
  };
}

function getSelectedActor(actorId: string): ActorIdentity {
  return AVAILABLE_ACTORS.find((actor) => actor.actorId === actorId) ?? AVAILABLE_ACTORS[1];
}

function normalizeDiagnosticText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH);
}

function summarizeRuntimeHealth(
  readyStatus: DiagnosticsStatus,
  checks?: DiagnosticsResponse["checks"]
): { summary: string; fallbackLikely: boolean } {
  const providerCheck = checks?.provider;
  const providerDegraded = providerCheck?.status === "degraded";
  if (providerDegraded) {
    const message = normalizeDiagnosticText(providerCheck.message) || "AI provider is not configured.";
    const rawDetails = Array.isArray(providerCheck.details) ? providerCheck.details : [];
    const details = rawDetails
      .map((detail) => normalizeDiagnosticText(detail))
      .filter(Boolean)
      .slice(0, MAX_PROVIDER_DIAGNOSTIC_DETAIL_COUNT);
    return {
      summary: [message, ...details].join(" "),
      fallbackLikely: true,
    };
  }
  if (readyStatus === "degraded") {
    return {
      summary: "Backend is running in degraded mode.",
      fallbackLikely: false,
    };
  }
  if (readyStatus === "error") {
    return {
      summary: "Backend diagnostics report a blocking issue.",
      fallbackLikely: false,
    };
  }
  return {
    summary: "Backend connected.",
    fallbackLikely: false,
  };
}

function providerStatusFromReadiness(checks?: DiagnosticsResponse["checks"]): ProviderStatus {
  const providerCheck = checks?.provider;
  if (providerCheck?.status === "ok") {
    return {
      configured: true,
      provider: "unset",
      source: "unset",
      message: normalizeDiagnosticText(providerCheck.message) || "AI provider is configured.",
    };
  }
  return {
    configured: false,
    provider: "unset",
    source: "unset",
    message: normalizeDiagnosticText(providerCheck?.message) || "AI provider is not configured.",
  };
}

function sessionLifecycleFromAuth(
  authStatus: AuthSessionStatus,
  authRequiredForProtectedActions: boolean
): SessionLifecycle {
  if (authStatus === "authenticated") return "signed_in";
  if (authStatus === "expired") return "expired_session";
  if (authStatus === "invalid") return "invalid_session";
  return "read_only";
}

function applyRequestError(
  set: (partial: Partial<AppState>) => void,
  error: unknown
) {
  if (!frontendRuntimeConfig.valid) {
    set({
      runtimeStatus: "unreachable",
      runtimeMessage: frontendRuntimeConfig.message ?? "The OpenAgentGraph API base URL is invalid.",
      authMessage: frontendRuntimeConfig.message ?? "The OpenAgentGraph API base URL is invalid.",
    });
    return;
  }
  const requestError = error as Error & { status?: number };
  if (requestError.status === undefined) {
    set({
      runtimeStatus: "unreachable",
      runtimeMessage: "The OpenAgentGraph backend could not be reached.",
      authMessage: "The OpenAgentGraph backend could not be reached.",
    });
    return;
  }
  if (requestError.status === 401) {
    const expired = /expired/i.test(requestError.message);
    set({
      runtimeStatus: "auth_required",
      runtimeMessage: requestError.message,
      authStatus: expired ? "expired" : "invalid",
      sessionLifecycle: expired ? "expired_session" : "invalid_session",
      authMessage: requestError.message,
      currentActor: getSelectedActor("viewer"),
    });
    return;
  }
  if (requestError.status === 403) {
    set({ runtimeStatus: "read_only", runtimeMessage: requestError.message, authMessage: requestError.message });
    return;
  }
  set({ runtimeStatus: "degraded", runtimeMessage: requestError.message });
}

async function apiFetch(
  input: string,
  init: RequestInit | undefined,
  auth: {
    mode: AuthMode;
    actor: ActorIdentity;
    token: string;
  }
) {
  if (!frontendRuntimeConfig.valid) {
    throw new Error(frontendRuntimeConfig.message ?? "The OpenAgentGraph API base URL is invalid.");
  }
  const headers = new Headers(init?.headers);
  if (auth.mode === "dev_header") {
    headers.set("x-openagentgraph-actor-id", auth.actor.actorId);
  } else if (auth.token) {
    headers.set("Authorization", `Bearer ${auth.token}`);
  }
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.ok) return response;

  let error = `Request failed: ${response.status}`;
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) error = payload.error;
  } catch {
    // Keep the plain-English fallback above.
  }

  const requestError = new Error(error) as Error & { status?: number };
  requestError.status = response.status;
  throw requestError;
}

function productGraphAuth(state: Pick<AppState, "authMode" | "currentActor" | "authToken">): ProductGraphRequestAuth {
  return {
    mode: state.authMode,
    actor: state.currentActor,
    token: state.authToken,
  };
}

const SCAN_JOB_POLL_INTERVAL_MS = 250;
const SCAN_JOB_WAIT_CUSHION_MS = 60_000;
const SCAN_JOB_MIN_WAIT_MS = 60_000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUnavailableScanJobEndpoint(error: unknown) {
  const status = (error as Error & { status?: number })?.status;
  return status === 404 || status === 405 || status === 501;
}

function scanJobWaitLimitMs(progress: ScanProgressSnapshot) {
  return Math.max(
    SCAN_JOB_MIN_WAIT_MS,
    progress.breakers.limits.maxDurationMs + SCAN_JOB_WAIT_CUSHION_MS
  );
}

function assertScanJobWithinDeadline(deadlineMs: number, label: string) {
  if (Date.now() <= deadlineMs) return;
  throw new Error(`${label} did not finish before the configured scan-job wait limit.`);
}

function parseScanJobEventFrame<TResult>(frame: string): ScanJobStatus<TResult> | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return null;
  return JSON.parse(data) as ScanJobStatus<TResult>;
}

async function readScanJobEventStream<TResult>(
  input: {
    url: string;
    initialJob: ScanJobStatus<TResult>;
    label: string;
    get: () => AppState;
    setProgress: (progress: ScanProgressSnapshot) => void;
  }
): Promise<ScanJobStatus<TResult>> {
  if (input.initialJob.status === "completed" || input.initialJob.status === "failed") {
    return input.initialJob;
  }

  const state = input.get();
  const response = await apiFetch(input.url, undefined, {
    mode: state.authMode,
    actor: state.currentActor,
    token: state.authToken,
  });
  if (!response.body) {
    throw new Error("Scan job event stream is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadlineMs = Date.now() + scanJobWaitLimitMs(input.initialJob.progress);
  let latestJob = input.initialJob;
  let buffer = "";

  try {
    while (true) {
      assertScanJobWithinDeadline(deadlineMs, input.label);
      const remainingMs = Math.max(1, deadlineMs - Date.now());
      const read = await Promise.race([
        reader.read(),
        delay(Math.min(1_000, remainingMs)).then(() => "timeout" as const),
      ]);
      if (read === "timeout") continue;
      if (read.done) break;

      buffer += decoder.decode(read.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const job = parseScanJobEventFrame<TResult>(frame);
        if (!job) continue;
        latestJob = job;
        input.setProgress(job.progress);
        if (job.status === "completed" || job.status === "failed") {
          return job;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const remainingFrame = buffer.trim();
  if (remainingFrame) {
    const job = parseScanJobEventFrame<TResult>(remainingFrame);
    if (job) {
      latestJob = job;
      input.setProgress(job.progress);
    }
  }
  return latestJob;
}

async function waitForProjectGraphScanJob(
  initialJob: ScanJobStatus<ProjectGraphResponse>,
  get: () => AppState,
  set: (partial: Partial<AppState>) => void
): Promise<ProjectGraphResponse> {
  const jobId = initialJob.jobId;
  let latestJob = initialJob;
  const deadlineMs = Date.now() + scanJobWaitLimitMs(initialJob.progress);
  while (true) {
    set({ projectGraphScanProgress: latestJob.progress });
    if (latestJob.status === "completed" && latestJob.result) return latestJob.result;
    if (latestJob.status === "failed") throw new Error(latestJob.error ?? "Project graph scan failed.");
    assertScanJobWithinDeadline(deadlineMs, "Project graph scan");
    await delay(Math.min(SCAN_JOB_POLL_INTERVAL_MS, Math.max(1, deadlineMs - Date.now())));

    const response = await apiFetch(apiUrl(`/project-graph/scan-jobs/${encodeURIComponent(jobId)}`), undefined, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    });
    latestJob = (await response.json()) as ScanJobStatus<ProjectGraphResponse>;
  }
}

async function waitForProductCodebaseScanJob(
  initialJob: ScanJobStatus<ScanProductGraphCodebaseResult>,
  get: () => AppState,
  set: (partial: Partial<AppState>) => void
): Promise<ScanProductGraphCodebaseResult> {
  const jobId = initialJob.jobId;
  let latestJob = initialJob;
  const deadlineMs = Date.now() + scanJobWaitLimitMs(initialJob.progress);
  while (true) {
    set({ productGraphCodebaseScanProgress: latestJob.progress });
    if (latestJob.status === "completed" && latestJob.result) return latestJob.result;
    if (latestJob.status === "failed") throw new Error(latestJob.error ?? "Codebase scan failed.");
    assertScanJobWithinDeadline(deadlineMs, "Codebase scan");
    await delay(Math.min(SCAN_JOB_POLL_INTERVAL_MS, Math.max(1, deadlineMs - Date.now())));

    const state = get();
    latestJob = await fetchProductGraphCodebaseScanJobRequest(jobId, {
      auth: productGraphAuth(state),
    });
  }
}

function productGraphRefreshWarning(
  createdResource: "node" | "edge" | "intent bundle" | "run link" | "Codex plan",
  error: unknown
): string {
  const baseMessage = `Product graph ${createdResource} was created, but the graph could not be refreshed.`;
  return error instanceof Error && error.message ? `${baseMessage} ${error.message}` : baseMessage;
}

function productGraphImportRefreshWarning(importName: "Codebase scan" | "Spec Kit import", error: unknown): string {
  const baseMessage = `Product graph ${importName} completed, but the graph could not be refreshed.`;
  return error instanceof Error && error.message ? `${baseMessage} ${error.message}` : baseMessage;
}


interface AppState {
  runtimeEnvironmentMode: string;
  apiBaseDisplay: string;
  runtimeLoading: boolean;
  sessionLoading: boolean;
  dashboardLoading: boolean;
  onboardingDismissed: boolean;
  runtimeStatus: "connected" | "degraded" | "read_only" | "auth_required" | "unreachable";
  runtimeMessage: string;
  backendReadyStatus: DiagnosticsStatus | "unknown";
  runtimeHealthSummary: string;
  runtimeFallbackLikely: boolean;
  providerStatus: ProviderStatus;
  providerConfigSaving: boolean;
  providerConfigMessage: string;
  authMode: AuthMode;
  authStatus: AuthSessionStatus;
  sessionLifecycle: SessionLifecycle;
  authRequiredForProtectedActions: boolean;
  authMessage: string;
  authToken: string;
  currentActor: ActorIdentity;
  availableActors: ActorIdentity[];
  graphs: Graph[];
  dashboard: DashboardRunSummary[];
  dashboardSummary: DashboardOverview["summary"];
  dashboardQuery: string;
  dashboardLifecycle: DashboardLifecycleBucket | "all";
  dashboardAttention: AttentionLabel | "all";
  dashboardStatus: GraphStatus | "all";
  goalPackets: GoalPacket[];
  lineageDescriptors: GraphProjection["lineageDescriptors"];
  lineageCount: number;
  lineageSummary: string;
  latestPlannerLineageSummary: string;
  latestExecutorLineageSummary: string;
  latestEvaluatorLineageSummary: string;
  latestRetrieverLineageSummary: string;
  latestPolicyLineageSummary: string;
  activeGraphId: string | null;
  currentView: "dashboard" | "intent" | "project" | "graph";
  projectGraph: ProjectGraphResponse | null;
  projectGraphLoading: boolean;
  projectGraphError: string;
  projectGraphScanProgress: ScanProgressSnapshot | null;
  productGraph: ProductGraphProjection | null;
  productGraphLoading: boolean;
  productGraphError: string;
  productGraphCodebaseScanProgress: ScanProgressSnapshot | null;
  productGraphTrace: ProductGraphTrace | null;
  productGraphTracesByNodeId: ProductGraphTraceCache;
  productGraphTraceNodeId: string | null;
  productGraphTraceLoading: boolean;
  productGraphTraceError: string;
  productGraphTraceNotice: string;
  productGraphCodexPlan: ProductGraphCodexPlanningPrompt | null;
  productGraphCodexPlanTaskNodeId: string | null;
  productGraphCodexPlanLoading: boolean;
  productGraphCodexPlanError: string;
  productGraphHandoff: ProductGraphHandoffResult | null;
  productGraphHandoffLoading: boolean;
  productGraphHandoffWriting: boolean;
  productGraphHandoffError: string;
  productGraphHandoffMessage: string;
  workspaceGraphOperational: WorkspaceGraphOperationalContext | null;
  workspaceGraphLens: GraphTaskLensId;
  workspaceGraphOperationalLoading: boolean;
  workspaceGraphOperationalError: string;
  nodes: Node[];
  edges: Edge[];
  events: GraphEvent[];
  selectedNodeId: string | null;
  filterStatus: string | null;
  filterBranch: string | null;
  isRunning: boolean;
  driftState: GraphProjection["driftState"] | null;
  driftSummary: string;
  frontierStatus: GraphProjection["frontierStatus"] | null;
  runControlState: RunControlState;
  canResume: boolean;
  canPause: boolean;
  canStop: boolean;
  capabilities: GraphProjection["capabilities"] | null;
  approvalState: ApprovalState;
  approvalRequestedAt: string | null;
  waitingForApproval: boolean;
  latestDecisionSummary: string;
  needsHumanReview: boolean;
  humanReviewReason: string;
  reviewRequestedAt: string | null;
  graphAnnotations: AnnotationRecord[];
  annotationCount: number;
  latestAnnotationSummary: string;
  peopleSummary: string;
  plannedNodeCount: number;
  completedNodeCount: number;
  failedNodeCount: number;
  supersededNodeCount: number;
  revisedNodeCount: number;
  passRate: number;
  revisionRate: number;
  driftTrend: GraphProjection["driftTrend"];
  evidenceCoverageRate: number;
  runHealthSummary: string;
  alerts: GraphAlert[];
  latestNotificationSummary: string;
  changesSinceLastViewed: ChangesSinceLastViewed | null;
  lastSeenSequenceByGraph: Record<string, number>;
  activityOpen: boolean;
  uiMode: "default" | "developer";
  graphQuality: "standard" | "performance";
  graphDetailMode: GraphDetailMode;
  largeGraphThreshold: number;
  showSupersededNodes: boolean;
  showRevisionBranches: boolean;
  showReplanBranches: boolean;
  focusActivePath: boolean;
  collapseSupersededBranches: boolean;
  collapseRevisionClusters: boolean;
  showActiveNeighborhoodOnly: boolean;
  dashboardFilter: DashboardFilter;
  dashboardSort: DashboardSort;
  similarRuns: SimilarRunSummary[];
  similarRunsForGraphId: string | null;
  comparison: RunComparison | null;
  agentFrontierGraphId: string | null;
  agentFrontier: GraphFrontierNodeSummary[];
  agentFrontierSummary: AgentFrontierResponse["summary"] | null;
  agentActivity: AgentActivityRecord[];
  agentPlanProposals: AgentPlanProposalRecord[];
  agentContext: AgentContextPack | null;
  agentCollaborationLoading: boolean;
  agentCollaborationError: string;
  agentCollaborationMessage: string;

  loadAuthSession: () => Promise<void>;
  loadRuntimeHealth: () => Promise<void>;
  loadProviderStatus: () => Promise<ProviderStatus>;
  setAuthToken: (token: string) => Promise<void>;
  clearAuthToken: () => Promise<void>;
  configureProvider: (input: ConfigureProviderInput) => Promise<ProviderStatus>;
  clearRuntimeProviderConfig: () => Promise<ProviderStatus>;
  fetchGraphs: () => Promise<void>;
  loadProjectGraph: () => Promise<void>;
  loadProductGraph: (options?: ProductGraphRefreshOptions) => Promise<void>;
  loadProductGraphTrace: (nodeId: string) => Promise<ProductGraphTrace>;
  loadProductGraphCodexPlan: (taskNodeId: string) => Promise<ProductGraphCodexPlanningPrompt>;
  loadProductGraphHandoff: () => Promise<ProductGraphHandoffResult>;
  loadWorkspaceGraphOperational: (lens?: GraphTaskLensId) => Promise<WorkspaceGraphOperationalContext>;
  setWorkspaceGraphLens: (lens: GraphTaskLensId) => void;
  writeProductGraphHandoff: () => Promise<WriteProductGraphHandoffResult>;
  acceptProductGraphCodexPlan: (
    input: AcceptProductGraphCodexPlanInput
  ) => Promise<AcceptProductGraphCodexPlanResult>;
  createProductGraphNode: (input: CreateProductGraphNodeInput) => Promise<ProductGraphNode>;
  createProductGraphEdge: (input: CreateProductGraphEdgeInput) => Promise<ProductGraphEdge>;
  createProductGraphIntentBundle: (
    input: CreateProductGraphIntentBundleInput
  ) => Promise<CreateProductGraphIntentBundleResult>;
  scanProductGraphCodebase: () => Promise<ScanProductGraphCodebaseResult>;
  importProductGraphSpecKit: () => Promise<ImportProductGraphSpecKitResult>;
  linkProductGraphRun: (input: LinkProductGraphRunInput) => Promise<LinkProductGraphRunResult>;
  openGraph: (graphId: string) => Promise<void>;
  createGraph: (
    title: string,
    goal: string,
    constraints?: string,
    successCriteria?: string[],
    forbiddenScope?: string[]
  ) => Promise<Graph>;
  loadGraph: (graphId: string) => Promise<void>;
  startRun: (graphId: string, workspaceRoot: string) => Promise<void>;
  pauseRun: (graphId: string) => Promise<void>;
  resumeRun: (graphId: string) => Promise<void>;
  stopRun: (graphId: string) => Promise<void>;
  markRunForReview: (graphId: string, reason?: string) => Promise<void>;
  annotateGraph: (graphId: string, input: { text: string; kind: AnnotationKind }) => Promise<void>;
  annotateNode: (nodeId: string, input: { text: string; kind: AnnotationKind }) => Promise<void>;
  requestApproval: (graphId: string, input: { reason?: string }) => Promise<void>;
  approveRun: (graphId: string, input: { reason?: string }) => Promise<void>;
  rejectRun: (graphId: string, input: { reason?: string }) => Promise<void>;
  continueRun: (graphId: string, input: { reason?: string }) => Promise<void>;
  retryNode: (nodeId: string) => Promise<void>;
  replanNode: (nodeId: string, newGoal: string, reason: string) => Promise<void>;
  selectNode: (nodeId: string | null) => void;
  setFilterStatus: (status: string | null) => void;
  setFilterBranch: (branch: string | null) => void;
  setUiMode: (mode: "default" | "developer") => void;
  setGraphQuality: (mode: "standard" | "performance") => void;
  setGraphDetailMode: (mode: GraphDetailMode) => void;
  setShowSupersededNodes: (value: boolean) => void;
  setShowRevisionBranches: (value: boolean) => void;
  setShowReplanBranches: (value: boolean) => void;
  setFocusActivePath: (value: boolean) => void;
  setCollapseSupersededBranches: (value: boolean) => void;
  setCollapseRevisionClusters: (value: boolean) => void;
  setShowActiveNeighborhoodOnly: (value: boolean) => void;
  resetGraphVisibility: () => void;
  markGraphViewed: (graphId: string) => void;
  setActivityOpen: (value: boolean) => void;
  setCurrentView: (view: AppState["currentView"]) => void;
  dismissOnboarding: () => void;
  resetOnboarding: () => void;
  setDashboardFilter: (value: DashboardFilter) => void;
  setDashboardSort: (value: DashboardSort) => void;
  setDashboardQuery: (value: string) => void;
  setDashboardLifecycle: (value: DashboardLifecycleBucket | "all") => void;
  setDashboardAttention: (value: AttentionLabel | "all") => void;
  setDashboardStatus: (value: GraphStatus | "all") => void;
  loadSimilarRuns: (graphId: string) => Promise<void>;
  loadComparison: (leftGraphId: string, rightGraphId: string) => Promise<void>;
  clearComparison: () => void;
  loadAgentFrontier: (graphId: string) => Promise<AgentFrontierResponse>;
  loadAgentContext: (graphId: string, nodeId?: string) => Promise<AgentContextPack>;
  acceptAgentPlanProposal: (graphId: string, proposalId: string) => Promise<void>;
  dismissAgentPlanProposal: (graphId: string, proposalId: string, reason?: string) => Promise<void>;
  setCurrentActorRole: (role: ActorRole) => void;
  subscribeToEvents: (graphId: string) => () => void;
}

function mergeGraph(graphs: Graph[], graph: Graph): Graph[] {
  const others = graphs.filter((candidate) => candidate.id !== graph.id);
  return [...others, graph];
}

export const useStore = create<AppState>((set, get) => ({
  runtimeEnvironmentMode: frontendRuntimeConfig.environmentMode,
  apiBaseDisplay: frontendRuntimeConfig.apiBaseDisplay,
  runtimeLoading: true,
  sessionLoading: true,
  dashboardLoading: false,
  onboardingDismissed: readOnboardingDismissed(),
  runtimeStatus: frontendRuntimeConfig.valid ? "read_only" : "unreachable",
  runtimeMessage: frontendRuntimeConfig.message ?? "",
  backendReadyStatus: "unknown",
  runtimeHealthSummary: frontendRuntimeConfig.valid
    ? "Backend status has not been checked yet."
    : frontendRuntimeConfig.message ?? "The OpenAgentGraph API base URL is invalid.",
  runtimeFallbackLikely: false,
  providerStatus: DEFAULT_PROVIDER_STATUS,
  providerConfigSaving: false,
  providerConfigMessage: "",
  authMode: "dev_header",
  authStatus: "anonymous",
  sessionLifecycle: "read_only",
  authRequiredForProtectedActions: true,
  authMessage: "",
  authToken: readAuthToken(),
  currentActor: getSelectedActor(readActorId()),
  availableActors: AVAILABLE_ACTORS,
  graphs: [],
  dashboard: [],
  dashboardSummary: {
    urgentRunCount: 0,
    needsReviewCount: 0,
    blockedRunCount: 0,
    activeRunCount: 0,
    archivedRunCount: 0,
  },
  dashboardQuery: "",
  dashboardLifecycle: "all",
  dashboardAttention: "all",
  dashboardStatus: "all",
  goalPackets: [],
  lineageDescriptors: [],
  lineageCount: 0,
  lineageSummary: "",
  latestPlannerLineageSummary: "",
  latestExecutorLineageSummary: "",
  latestEvaluatorLineageSummary: "",
  latestRetrieverLineageSummary: "",
  latestPolicyLineageSummary: "",
  activeGraphId: null,
  currentView: "dashboard",
  projectGraph: null,
  projectGraphLoading: false,
  projectGraphError: "",
  projectGraphScanProgress: null,
  productGraph: null,
  productGraphLoading: false,
  productGraphError: "",
  productGraphCodebaseScanProgress: null,
  productGraphTrace: null,
  productGraphTracesByNodeId: {},
  productGraphTraceNodeId: null,
  productGraphTraceLoading: false,
  productGraphTraceError: "",
  productGraphTraceNotice: "",
  productGraphCodexPlan: null,
  productGraphCodexPlanTaskNodeId: null,
  productGraphCodexPlanLoading: false,
  productGraphCodexPlanError: "",
  productGraphHandoff: null,
  productGraphHandoffLoading: false,
  productGraphHandoffWriting: false,
  productGraphHandoffError: "",
  productGraphHandoffMessage: "",
  workspaceGraphOperational: null,
  workspaceGraphLens: "all",
  workspaceGraphOperationalLoading: false,
  workspaceGraphOperationalError: "",
  nodes: [],
  edges: [],
  events: [],
  selectedNodeId: null,
  filterStatus: null,
  filterBranch: null,
  isRunning: false,
  driftState: null,
  driftSummary: "",
  frontierStatus: null,
  runControlState: "idle",
  canResume: false,
  canPause: false,
  canStop: false,
  capabilities: null,
  approvalState: "not_requested",
  approvalRequestedAt: null,
  waitingForApproval: false,
  latestDecisionSummary: "",
  needsHumanReview: false,
  humanReviewReason: "",
  reviewRequestedAt: null,
  graphAnnotations: [],
  annotationCount: 0,
  latestAnnotationSummary: "",
  peopleSummary: "",
  plannedNodeCount: 0,
  completedNodeCount: 0,
  failedNodeCount: 0,
  supersededNodeCount: 0,
  revisedNodeCount: 0,
  passRate: 0,
  revisionRate: 0,
  driftTrend: "steady",
  evidenceCoverageRate: 0,
  runHealthSummary: "",
  alerts: [],
  latestNotificationSummary: "",
  changesSinceLastViewed: null,
  lastSeenSequenceByGraph: readLastSeenMap(),
  activityOpen: false,
  uiMode: readUiMode(),
  graphQuality: "standard",
  graphDetailMode: "auto",
  largeGraphThreshold: LARGE_GRAPH_NODE_THRESHOLD,
  showSupersededNodes: true,
  showRevisionBranches: true,
  showReplanBranches: true,
  focusActivePath: false,
  collapseSupersededBranches: false,
  collapseRevisionClusters: false,
  showActiveNeighborhoodOnly: false,
  dashboardFilter: "all",
  dashboardSort: "highest_attention",
  similarRuns: [],
  similarRunsForGraphId: null,
  comparison: null,
  agentFrontierGraphId: null,
  agentFrontier: [],
  agentFrontierSummary: null,
  agentActivity: [],
  agentPlanProposals: [],
  agentContext: null,
  agentCollaborationLoading: false,
  agentCollaborationError: "",
  agentCollaborationMessage: "",

  loadRuntimeHealth: async () => {
    if (!frontendRuntimeConfig.valid) {
      set({
        runtimeLoading: false,
        backendReadyStatus: "error",
        runtimeStatus: "unreachable",
        runtimeMessage: frontendRuntimeConfig.message ?? "The OpenAgentGraph API base URL is invalid.",
        runtimeHealthSummary: frontendRuntimeConfig.message ?? "The OpenAgentGraph API base URL is invalid.",
        runtimeFallbackLikely: false,
        providerStatus: DEFAULT_PROVIDER_STATUS,
      });
      return;
    }

    try {
      const response = await fetch(apiUrl("/ready"));
      const ready = (await response.json()) as DiagnosticsResponse;
      const runtimeHealth = summarizeRuntimeHealth(ready.status, ready.checks);
      set((state) => ({
        runtimeLoading: false,
        backendReadyStatus: ready.status,
        runtimeHealthSummary: runtimeHealth.summary,
        runtimeFallbackLikely: runtimeHealth.fallbackLikely,
        providerStatus:
          state.providerStatus.source === "runtime" || state.providerStatus.source === "environment"
            ? state.providerStatus
            : providerStatusFromReadiness(ready.checks),
        runtimeStatus:
          state.runtimeStatus === "auth_required" || state.runtimeStatus === "read_only"
            ? state.runtimeStatus
            : ready.status === "ok"
              ? "connected"
              : "degraded",
        runtimeMessage:
          state.runtimeStatus === "auth_required" && state.runtimeMessage
            ? state.runtimeMessage
            : runtimeHealth.summary,
      }));
    } catch {
      set({
        runtimeLoading: false,
        backendReadyStatus: "error",
        runtimeStatus: "unreachable",
        runtimeMessage: "The OpenAgentGraph backend could not be reached.",
        runtimeHealthSummary: "The OpenAgentGraph backend could not be reached.",
        runtimeFallbackLikely: false,
        providerStatus: DEFAULT_PROVIDER_STATUS,
      });
    }
  },

  loadProviderStatus: async () => {
    const state = get();
    const response = await apiFetch(apiUrl("/provider/config"), undefined, {
      mode: state.authMode,
      actor: state.currentActor,
      token: state.authToken,
    });
    const status = (await response.json()) as ProviderStatus;
    set({
      providerStatus: status,
      providerConfigMessage: status.message,
    });
    return status;
  },

  loadAuthSession: async () => {
    if (!frontendRuntimeConfig.valid) {
      set({
        sessionLoading: false,
        runtimeStatus: "unreachable",
        runtimeMessage: frontendRuntimeConfig.message ?? "The OpenAgentGraph backend could not be reached.",
        backendReadyStatus: "error",
        runtimeHealthSummary: frontendRuntimeConfig.message ?? "The OpenAgentGraph API base URL is invalid.",
        authStatus: "invalid",
        sessionLifecycle: "invalid_session",
        authMessage: frontendRuntimeConfig.message ?? "The OpenAgentGraph backend could not be reached.",
      });
      return;
    }
    const state = get();
    const headers = new Headers();
    if (state.authToken) {
      headers.set("Authorization", `Bearer ${state.authToken}`);
    } else if (state.authMode === "dev_header") {
      headers.set("x-openagentgraph-actor-id", state.currentActor.actorId);
    }

    let response: Response;
    try {
      response = await fetch(apiUrl("/auth/session"), { headers });
    } catch {
      set({
        sessionLoading: false,
        runtimeStatus: "unreachable",
        runtimeMessage: "The OpenAgentGraph backend could not be reached.",
        backendReadyStatus: "error",
        runtimeHealthSummary: "The OpenAgentGraph backend could not be reached.",
        authStatus: "invalid",
        sessionLifecycle: "invalid_session",
        authMessage: "The OpenAgentGraph backend could not be reached.",
      });
      return;
    }
    if (response.status === 401) {
      const payload = (await response.json()) as AuthSessionResponse;
      set({
        sessionLoading: false,
        runtimeStatus: "auth_required",
        runtimeHealthSummary: get().runtimeHealthSummary || "Backend connected.",
        authMode: payload.authMode,
        authStatus: payload.status,
        sessionLifecycle: sessionLifecycleFromAuth(
          payload.status,
          payload.authRequiredForProtectedActions
        ),
        authRequiredForProtectedActions: payload.authRequiredForProtectedActions,
        authMessage: payload.message,
        runtimeMessage: payload.message,
        currentActor: payload.actor ?? getSelectedActor("viewer"),
      });
      return;
    }

    const session: AuthSessionResponse = await response.json();
    set((current) => ({
      sessionLoading: false,
      runtimeStatus:
        session.status === "authenticated"
          ? "connected"
          : session.authRequiredForProtectedActions
            ? "read_only"
            : "degraded",
      authMode: session.authMode,
      authStatus: session.status,
      sessionLifecycle: sessionLifecycleFromAuth(
        session.status,
        session.authRequiredForProtectedActions
      ),
      authRequiredForProtectedActions: session.authRequiredForProtectedActions,
      authMessage: session.message,
      runtimeMessage:
        current.backendReadyStatus === "degraded" && current.runtimeHealthSummary
          ? current.runtimeHealthSummary
          : session.message,
      currentActor:
        session.actor ??
        (session.authMode === "dev_header" ? current.currentActor : getSelectedActor("viewer")),
    }));
  },

  setAuthToken: async (token) => {
    writeAuthToken(token);
    set({ authToken: token });
    await get().loadRuntimeHealth();
    await get().loadAuthSession();
    const activeGraphId = get().activeGraphId;
    if (activeGraphId) {
      await get().loadGraph(activeGraphId);
    }
    await get().fetchGraphs();
  },

  clearAuthToken: async () => {
    writeAuthToken("");
    set({
      authToken: "",
      authStatus: "anonymous",
      sessionLifecycle: "read_only",
      authMessage: "This environment allows viewing, but protected actions require sign-in.",
      currentActor: getSelectedActor("viewer"),
    });
    await get().loadRuntimeHealth();
    await get().loadAuthSession();
    const activeGraphId = get().activeGraphId;
    if (activeGraphId) {
      await get().loadGraph(activeGraphId);
    }
    await get().fetchGraphs();
  },

  configureProvider: async (input) => {
    const provider = input.provider;
    const trimmedKey = input.apiKey?.trim() ?? "";
    const model = input.model?.trim();
    const baseUrl = input.baseUrl?.trim();
    const hostedLabel = provider in HOSTED_KEY_PROVIDER_LABELS
      ? HOSTED_KEY_PROVIDER_LABELS[provider as keyof typeof HOSTED_KEY_PROVIDER_LABELS]
      : undefined;
    if (hostedLabel && !trimmedKey) {
      const message = `Paste a ${hostedLabel} API key before saving ${hostedLabel} provider setup.`;
      set({ providerConfigMessage: message });
      throw new Error(message);
    }
    if ((provider === "ollama" || provider === "openai-compatible") && !model) {
      const message = `Enter ${provider === "ollama" ? "an Ollama" : "a custom provider"} model before saving provider setup.`;
      set({ providerConfigMessage: message });
      throw new Error(message);
    }
    if (provider === "openai-compatible" && !baseUrl) {
      const message = "Enter an OpenAI-compatible base URL before saving provider setup.";
      set({ providerConfigMessage: message });
      throw new Error(message);
    }

    set({ providerConfigSaving: true, providerConfigMessage: "" });
    try {
      const state = get();
      const body = {
        provider,
        ...(trimmedKey && provider !== "ollama" ? { apiKey: trimmedKey } : {}),
        ...(model ? { model } : {}),
        ...(baseUrl && provider !== "openai" ? { baseUrl } : {}),
      };
      const response = await apiFetch(
        apiUrl("/provider/config"),
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        {
          mode: state.authMode,
          actor: state.currentActor,
          token: state.authToken,
        }
      );
      const status = (await response.json()) as ProviderStatus;
      set({
        providerStatus: status,
        providerConfigSaving: false,
        providerConfigMessage: status.message || "AI provider is configured for this backend process.",
      });
      await get().loadRuntimeHealth();
      return status;
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "AI provider configuration could not be saved.";
      set({
        providerConfigSaving: false,
        providerConfigMessage: message,
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  clearRuntimeProviderConfig: async () => {
    set({ providerConfigSaving: true, providerConfigMessage: "" });
    try {
      const state = get();
      const response = await apiFetch(
        apiUrl("/provider/config"),
        { method: "DELETE" },
        {
          mode: state.authMode,
          actor: state.currentActor,
          token: state.authToken,
        }
      );
      const status = (await response.json()) as ProviderStatus;
      set({
        providerStatus: status,
        providerConfigSaving: false,
        providerConfigMessage: status.message || "Runtime provider configuration was cleared.",
      });
      await get().loadRuntimeHealth();
      return status;
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Runtime provider configuration could not be cleared.";
      set({
        providerConfigSaving: false,
        providerConfigMessage: message,
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  fetchGraphs: async () => {
    set({ dashboardLoading: true });
    const lastSeenMap = get().lastSeenSequenceByGraph;
    const params = new URLSearchParams({
      lastSeenMap: JSON.stringify(lastSeenMap),
    });
    const state = get();
    if (state.dashboardQuery.trim()) params.set("q", state.dashboardQuery.trim());
    if (state.dashboardLifecycle !== "all") params.set("lifecycle", state.dashboardLifecycle);
    if (state.dashboardAttention !== "all") params.set("attention", state.dashboardAttention);
    if (state.dashboardStatus !== "all") params.set("status", state.dashboardStatus);

    const res = await apiFetch(apiUrl(`/graphs?${params.toString()}`), undefined, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      set({ dashboardLoading: false });
      applyRequestError(set, error);
      throw error;
    });

    const overview: DashboardOverview = await res.json();
    set((state) => {
      const nextView =
        state.currentView === "project"
          ? "project"
          : state.currentView === "intent"
            ? "intent"
          : state.currentView === "graph" && state.activeGraphId
          ? "graph"
          : state.currentView === "dashboard"
            ? "dashboard"
            : overview.items.length <= 1 && overview.items[0] && !state.dashboardQuery.trim()
            ? "graph"
            : "dashboard";

      return {
        dashboardLoading: false,
        dashboard: overview.items,
        dashboardSummary: overview.summary,
        currentView: nextView,
      };
    });

    const activeGraphId = get().activeGraphId;
    const currentView = get().currentView;
    if (
      currentView !== "project" &&
      currentView !== "intent" &&
      !activeGraphId &&
      overview.items.length === 1 &&
      !get().dashboardQuery.trim()
    ) {
      await get().openGraph(overview.items[0].graphId);
    }
  },

  loadProjectGraph: async () => {
    set({ projectGraphLoading: true, projectGraphError: "", projectGraphScanProgress: null });
    try {
      let projectGraph: ProjectGraphResponse;
      try {
        const jobResponse = await apiFetch(apiUrl("/project-graph/scan-jobs"), { method: "POST" }, {
          mode: get().authMode,
          actor: get().currentActor,
          token: get().authToken,
        });
        const job = (await jobResponse.json()) as ScanJobStatus<ProjectGraphResponse>;
        set({ projectGraphScanProgress: job.progress });
        try {
          const streamedJob = await readScanJobEventStream<ProjectGraphResponse>({
            url: apiUrl(`/project-graph/scan-jobs/${encodeURIComponent(job.jobId)}/events`),
            initialJob: job,
            label: "Project graph scan",
            get,
            setProgress: (progress) => set({ projectGraphScanProgress: progress }),
          });
          if (streamedJob.status === "completed" && streamedJob.result) {
            projectGraph = streamedJob.result;
          } else if (streamedJob.status === "failed") {
            throw new Error(streamedJob.error ?? "Project graph scan failed.");
          } else {
            projectGraph = await waitForProjectGraphScanJob(streamedJob, get, set);
          }
        } catch {
          projectGraph = await waitForProjectGraphScanJob(job, get, set);
        }
      } catch (jobError) {
        if (!isUnavailableScanJobEndpoint(jobError)) throw jobError;
        const res = await apiFetch(apiUrl("/project-graph"), undefined, {
          mode: get().authMode,
          actor: get().currentActor,
          token: get().authToken,
        });
        projectGraph = await res.json() as ProjectGraphResponse;
        set({ projectGraphScanProgress: projectGraph.progress ?? null });
      }

      set({
        projectGraph,
        projectGraphLoading: false,
        projectGraphError: "",
        projectGraphScanProgress: projectGraph.progress ?? get().projectGraphScanProgress,
        currentView: "project",
      });
    } catch (error) {
      const requestError = error as Error;
      set({
        projectGraphLoading: false,
        projectGraphError: requestError.message || "Project graph could not be loaded.",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  loadProductGraph: async (options = {}) => {
    set({ productGraphLoading: true, productGraphError: "" });
    try {
      const state = get();
      const productGraph = await fetchProductGraphRequest({
        auth: productGraphAuth(state),
      });
      const traceState = get();
      const showTraceNotice =
        hasProductGraphTraceData(traceState) ||
        Boolean(options.preserveTraceNotice && traceState.productGraphTraceNotice);
      set({
        productGraph,
        productGraphLoading: false,
        productGraphError: "",
        ...invalidateProductGraphTraceState(showTraceNotice),
        ...invalidateProductGraphCodexPlanState(),
      });
    } catch (error) {
      const requestError = error as Error;
      set({
        productGraphLoading: false,
        productGraphError: requestError.message || "Product graph could not be loaded.",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  loadProductGraphTrace: async (nodeId) => {
    const traceRequestId = ++productGraphTraceRequestSequence;
    set((state) => {
      const cachedTrace = state.productGraphTracesByNodeId[nodeId] ?? null;
      const visibleTrace = state.productGraphTrace?.rootNode.id === nodeId ? state.productGraphTrace : cachedTrace;
      return {
        productGraphTrace: visibleTrace,
        productGraphTraceNodeId: nodeId,
        productGraphTraceLoading: true,
        productGraphTraceError: "",
        productGraphTraceNotice: "",
      };
    });
    try {
      const state = get();
      const productGraphTrace = await fetchProductGraphTraceRequest(nodeId, {
        auth: productGraphAuth(state),
      });
      if (traceRequestId === productGraphTraceRequestSequence) {
        set((state) => ({
          productGraphTrace,
          productGraphTracesByNodeId: cacheProductGraphTrace(state.productGraphTracesByNodeId, productGraphTrace),
          productGraphTraceNodeId: nodeId,
          productGraphTraceLoading: false,
          productGraphTraceError: "",
          productGraphTraceNotice: "",
        }));
      }
      return productGraphTrace;
    } catch (error) {
      const requestError = error as Error;
      if (traceRequestId === productGraphTraceRequestSequence) {
        set((state) => {
          const cachedTrace = state.productGraphTracesByNodeId[nodeId] ?? null;
          const visibleTrace = state.productGraphTrace?.rootNode.id === nodeId ? state.productGraphTrace : cachedTrace;
          return {
            productGraphTrace: visibleTrace,
            productGraphTraceNodeId: nodeId,
            productGraphTraceLoading: false,
            productGraphTraceError: requestError.message || "Product graph trace could not be loaded.",
            productGraphTraceNotice: "",
          };
        });
        applyRequestError(set, error);
      }
      throw error;
    }
  },

  loadProductGraphCodexPlan: async (taskNodeId) => {
    const codexPlanRequestId = ++productGraphCodexPlanRequestSequence;
    set((state) => ({
      productGraphCodexPlan:
        state.productGraphCodexPlanTaskNodeId === taskNodeId ? state.productGraphCodexPlan : null,
      productGraphCodexPlanTaskNodeId: taskNodeId,
      productGraphCodexPlanLoading: true,
      productGraphCodexPlanError: "",
    }));
    try {
      const state = get();
      const productGraphCodexPlan = await fetchProductGraphCodexPlanRequest(taskNodeId, {
        auth: productGraphAuth(state),
      });
      if (codexPlanRequestId === productGraphCodexPlanRequestSequence) {
        set({
          productGraphCodexPlan,
          productGraphCodexPlanTaskNodeId: taskNodeId,
          productGraphCodexPlanLoading: false,
          productGraphCodexPlanError: "",
        });
      }
      return productGraphCodexPlan;
    } catch (error) {
      const requestError = error as Error;
      if (codexPlanRequestId === productGraphCodexPlanRequestSequence) {
        set((state) => ({
          productGraphCodexPlan:
            state.productGraphCodexPlanTaskNodeId === taskNodeId ? state.productGraphCodexPlan : null,
          productGraphCodexPlanTaskNodeId: taskNodeId,
          productGraphCodexPlanLoading: false,
          productGraphCodexPlanError: requestError.message || "Product graph Codex plan could not be loaded.",
        }));
        applyRequestError(set, error);
      }
      throw error;
    }
  },

  loadProductGraphHandoff: async () => {
    set({
      productGraphHandoffLoading: true,
      productGraphHandoffError: "",
      productGraphHandoffMessage: "",
    });
    try {
      const state = get();
      const handoff = await fetchProductGraphHandoffRequest({
        auth: productGraphAuth(state),
      });
      set({
        productGraphHandoff: handoff,
        productGraphHandoffLoading: false,
        productGraphHandoffError: "",
        productGraphHandoffMessage: `Generated handoff with ${handoff.summary.recommendedReadCount} recommended reads.`,
      });
      return handoff;
    } catch (error) {
      const requestError = error as Error;
      set({
        productGraphHandoffLoading: false,
        productGraphHandoffError: requestError.message || "Product graph handoff could not be generated.",
        productGraphHandoffMessage: "",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  loadWorkspaceGraphOperational: async (lens) => {
    const selectedLens = lens ?? get().workspaceGraphLens;
    set({
      workspaceGraphOperationalLoading: true,
      workspaceGraphOperationalError: "",
      workspaceGraphLens: selectedLens,
    });
    try {
      const state = get();
      const context = await fetchWorkspaceGraphOperationalRequest(selectedLens, {
        auth: productGraphAuth(state),
      });
      set({
        workspaceGraphOperational: context,
        workspaceGraphOperationalLoading: false,
        workspaceGraphOperationalError: "",
        workspaceGraphLens: context.lens,
      });
      return context;
    } catch (error) {
      const requestError = error as Error;
      set({
        workspaceGraphOperationalLoading: false,
        workspaceGraphOperationalError:
          requestError.message || "Workspace graph operational context could not be loaded.",
      });
      throw error;
    }
  },

  setWorkspaceGraphLens: (lens) => {
    set({ workspaceGraphLens: lens });
  },

  writeProductGraphHandoff: async () => {
    set({
      productGraphHandoffWriting: true,
      productGraphHandoffError: "",
      productGraphHandoffMessage: "",
    });
    try {
      const state = get();
      const handoff = await writeProductGraphHandoffRequest({
        auth: productGraphAuth(state),
      });
      set({
        productGraphHandoff: handoff,
        productGraphHandoffWriting: false,
        productGraphHandoffError: "",
        productGraphHandoffMessage: `Wrote GRAPH_REPORT.md to ${handoff.path}.`,
      });
      return handoff;
    } catch (error) {
      const requestError = error as Error;
      set({
        productGraphHandoffWriting: false,
        productGraphHandoffError: requestError.message || "GRAPH_REPORT.md could not be written.",
        productGraphHandoffMessage: "",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  acceptProductGraphCodexPlan: async (input) => {
    set({ productGraphLoading: true, productGraphError: "" });
    try {
      const state = get();
      const acceptedPlan = await acceptProductGraphCodexPlanRequest(input, {
        auth: productGraphAuth(state),
      });
      set((state) => ({
        ...invalidateProductGraphTraceState(hasProductGraphTraceData(state)),
        ...invalidateProductGraphCodexPlanState(),
      }));
      try {
        await get().loadProductGraph({ preserveTraceNotice: true });
      } catch (refreshError) {
        set({
          productGraphLoading: false,
          productGraphError: productGraphRefreshWarning("Codex plan", refreshError),
        });
      }
      return acceptedPlan;
    } catch (error) {
      const requestError = error as Error;
      set({
        productGraphLoading: false,
        productGraphError: requestError.message || "Product graph Codex plan could not be accepted.",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  createProductGraphNode: async (input) => {
    set({ productGraphLoading: true, productGraphError: "" });
    try {
      const state = get();
      const node = await createProductGraphNodeRequest(input, {
        auth: productGraphAuth(state),
      });
      set((state) => ({
        ...invalidateProductGraphTraceState(hasProductGraphTraceData(state)),
        ...invalidateProductGraphCodexPlanState(),
      }));
      try {
        await get().loadProductGraph({ preserveTraceNotice: true });
      } catch (refreshError) {
        set({
          productGraphLoading: false,
          productGraphError: productGraphRefreshWarning("node", refreshError),
        });
      }
      return node;
    } catch (error) {
      const requestError = error as Error;
      set({
        productGraphLoading: false,
        productGraphError: requestError.message || "Product graph node could not be created.",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  createProductGraphEdge: async (input) => {
    set({ productGraphLoading: true, productGraphError: "" });
    try {
      const state = get();
      const edge = await createProductGraphEdgeRequest(input, {
        auth: productGraphAuth(state),
      });
      set((state) => ({
        ...invalidateProductGraphTraceState(hasProductGraphTraceData(state)),
        ...invalidateProductGraphCodexPlanState(),
      }));
      try {
        await get().loadProductGraph({ preserveTraceNotice: true });
      } catch (refreshError) {
        set({
          productGraphLoading: false,
          productGraphError: productGraphRefreshWarning("edge", refreshError),
        });
      }
      return edge;
    } catch (error) {
      const requestError = error as Error;
      set({
        productGraphLoading: false,
        productGraphError: requestError.message || "Product graph edge could not be created.",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  createProductGraphIntentBundle: async (input) => {
    set({ productGraphLoading: true, productGraphError: "" });
    try {
      const state = get();
      const bundle = await createProductGraphIntentBundleRequest(input, {
        auth: productGraphAuth(state),
      });
      set((state) => ({
        ...invalidateProductGraphTraceState(hasProductGraphTraceData(state)),
        ...invalidateProductGraphCodexPlanState(),
      }));
      try {
        await get().loadProductGraph({ preserveTraceNotice: true });
      } catch (refreshError) {
        set({
          productGraphLoading: false,
          productGraphError: productGraphRefreshWarning("intent bundle", refreshError),
        });
      }
      return bundle;
    } catch (error) {
      const requestError = error as Error;
      set({
        productGraphLoading: false,
        productGraphError: requestError.message || "Product graph intent bundle could not be created.",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  importProductGraphSpecKit: async () => {
    set({ productGraphLoading: true, productGraphError: "" });
    try {
      const state = get();
      const result = await importProductGraphSpecKitRequest({
        auth: productGraphAuth(state),
      });
      set((state) => ({
        ...invalidateProductGraphTraceState(hasProductGraphTraceData(state)),
        ...invalidateProductGraphCodexPlanState(),
      }));
      try {
        await get().loadProductGraph({ preserveTraceNotice: true });
      } catch (refreshError) {
        set({
          productGraphLoading: false,
          productGraphError: productGraphImportRefreshWarning("Spec Kit import", refreshError),
        });
      }
      return result;
    } catch (error) {
      const requestError = error as Error;
      set({
        productGraphLoading: false,
        productGraphError: requestError.message || "Spec Kit import could not be completed.",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  scanProductGraphCodebase: async () => {
    set({ productGraphLoading: true, productGraphError: "", productGraphCodebaseScanProgress: null });
    try {
      const state = get();
      let result: ScanProductGraphCodebaseResult;
      try {
        const job = await startProductGraphCodebaseScanJobRequest({
          auth: productGraphAuth(state),
        });
        set({ productGraphCodebaseScanProgress: job.progress });
        try {
          const streamedJob = await readScanJobEventStream<ScanProductGraphCodebaseResult>({
            url: apiUrl(`/product-graph/codebase/scan-jobs/${encodeURIComponent(job.jobId)}/events`),
            initialJob: job,
            label: "Codebase scan",
            get,
            setProgress: (progress) => set({ productGraphCodebaseScanProgress: progress }),
          });
          if (streamedJob.status === "completed" && streamedJob.result) {
            result = streamedJob.result;
          } else if (streamedJob.status === "failed") {
            throw new Error(streamedJob.error ?? "Codebase scan failed.");
          } else {
            result = await waitForProductCodebaseScanJob(streamedJob, get, set);
          }
        } catch {
          result = await waitForProductCodebaseScanJob(job, get, set);
        }
      } catch (jobError) {
        if (!isUnavailableScanJobEndpoint(jobError)) throw jobError;
        result = await scanProductGraphCodebaseRequest({
          auth: productGraphAuth(get()),
        });
        set({ productGraphCodebaseScanProgress: result.scanned.progress ?? null });
      }
      set((state) => ({
        ...invalidateProductGraphTraceState(hasProductGraphTraceData(state)),
        ...invalidateProductGraphCodexPlanState(),
      }));
      try {
        await get().loadProductGraph({ preserveTraceNotice: true });
      } catch (refreshError) {
        set({
          productGraphLoading: false,
          productGraphError: productGraphImportRefreshWarning("Codebase scan", refreshError),
        });
      }
      return result;
    } catch (error) {
      const requestError = error as Error;
      set({
        productGraphLoading: false,
        productGraphError: requestError.message || "Codebase scan could not be completed.",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  linkProductGraphRun: async (input) => {
    set({ productGraphLoading: true, productGraphError: "" });
    try {
      const state = get();
      const link = await linkProductGraphRunRequest(input, {
        auth: productGraphAuth(state),
      });
      set((state) => ({
        ...invalidateProductGraphTraceState(hasProductGraphTraceData(state)),
        ...invalidateProductGraphCodexPlanState(),
      }));
      try {
        await get().loadProductGraph({ preserveTraceNotice: true });
      } catch (refreshError) {
        set({
          productGraphLoading: false,
          productGraphError: productGraphRefreshWarning("run link", refreshError),
        });
      }
      return link;
    } catch (error) {
      const requestError = error as Error;
      set({
        productGraphLoading: false,
        productGraphError: requestError.message || "Product graph run link could not be created.",
      });
      applyRequestError(set, error);
      throw error;
    }
  },

  createGraph: async (title, goal, constraints, successCriteria, forbiddenScope) => {
    const res = await apiFetch(apiUrl("/graphs"), {
      method: "POST",
      body: JSON.stringify({ title, goal, constraints, successCriteria, forbiddenScope }),
    }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    });
    const graph: Graph = await res.json();
    set((state) => ({ graphs: mergeGraph(state.graphs, graph), currentView: "graph" }));
    return graph;
  },

  openGraph: async (graphId) => {
    await get().loadGraph(graphId);
    set({ currentView: "graph" });
    get().subscribeToEvents(graphId);
  },

  loadGraph: async (graphId) => {
    const lastSeenSequence = get().lastSeenSequenceByGraph[graphId] ?? 0;
    const res = await apiFetch(apiUrl(`/graphs/${graphId}?lastSeenSequence=${lastSeenSequence}`), undefined, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    });

    const projection: GraphProjection = await res.json();
    set((state) => ({
      graphs: mergeGraph(state.graphs, projection.graph),
      goalPackets: projection.goalPackets,
      lineageDescriptors: projection.lineageDescriptors,
      lineageCount: projection.lineageCount,
      lineageSummary: projection.lineageSummary ?? "",
      latestPlannerLineageSummary: projection.latestPlannerLineageSummary ?? "",
      latestExecutorLineageSummary: projection.latestExecutorLineageSummary ?? "",
      latestEvaluatorLineageSummary: projection.latestEvaluatorLineageSummary ?? "",
      latestRetrieverLineageSummary: projection.latestRetrieverLineageSummary ?? "",
      latestPolicyLineageSummary: projection.latestPolicyLineageSummary ?? "",
      activeGraphId: graphId,
      nodes: projection.nodes,
      edges: projection.edges,
      events: projection.events,
      driftState: projection.driftState,
      driftSummary: projection.currentDriftSummary ?? projection.driftSummary,
      frontierStatus: projection.frontierStatus,
      runControlState: projection.runControlState,
      canResume: projection.canResume,
      canPause: projection.canPause,
      canStop: projection.canStop,
      capabilities: projection.capabilities ?? null,
      approvalState: projection.approvalState,
      approvalRequestedAt: projection.approvalRequestedAt ?? null,
      waitingForApproval: projection.waitingForApproval,
      latestDecisionSummary: projection.latestDecisionSummary ?? "",
      needsHumanReview: projection.needsHumanReview,
      humanReviewReason: projection.humanReviewReason ?? "",
      reviewRequestedAt: projection.reviewRequestedAt ?? null,
      graphAnnotations: projection.graphAnnotations,
      annotationCount: projection.annotationCount,
      latestAnnotationSummary: projection.latestAnnotationSummary ?? "",
      peopleSummary: projection.peopleSummary ?? "",
      plannedNodeCount: projection.plannedNodeCount,
      completedNodeCount: projection.completedNodeCount,
      failedNodeCount: projection.failedNodeCount,
      supersededNodeCount: projection.supersededNodeCount,
      revisedNodeCount: projection.revisedNodeCount,
      passRate: projection.passRate,
      revisionRate: projection.revisionRate,
      driftTrend: projection.driftTrend,
      evidenceCoverageRate: projection.evidenceCoverageRate,
      runHealthSummary: projection.runHealthSummary,
      alerts: projection.alerts,
      latestNotificationSummary: projection.latestNotificationSummary ?? "",
      changesSinceLastViewed: projection.changesSinceLastViewed ?? null,
      agentFrontierGraphId: graphId,
      agentActivity: projection.agentActivity ?? [],
      agentPlanProposals: projection.agentPlanProposals ?? [],
      isRunning: projection.runControlState === "running",
      currentView: "graph",
    }));
  },

  startRun: async (graphId, workspaceRoot) => {
    const res = await apiFetch(apiUrl(`/graphs/${graphId}/runs`), {
      method: "POST",
      body: JSON.stringify({ workspaceRoot }),
    }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      set({ isRunning: false });
      applyRequestError(set, error);
      throw error;
    });

    set({ isRunning: true });
  },

  pauseRun: async (graphId) => {
    await apiFetch(apiUrl(`/graphs/${graphId}/pause`), { method: "POST" }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
  },

  resumeRun: async (graphId) => {
    await apiFetch(apiUrl(`/graphs/${graphId}/resume`), { method: "POST" }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
    set({ isRunning: true });
  },

  stopRun: async (graphId) => {
    await apiFetch(apiUrl(`/graphs/${graphId}/stop`), { method: "POST" }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
  },

  markRunForReview: async (graphId, reason) => {
    await apiFetch(apiUrl(`/graphs/${graphId}/review`), {
      method: "POST",
      body: JSON.stringify({ reason }),
    }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
  },

  annotateGraph: async (graphId, input) => {
    await apiFetch(apiUrl(`/graphs/${graphId}/annotations`), {
      method: "POST",
      body: JSON.stringify(input),
    }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
  },

  annotateNode: async (nodeId, input) => {
    await apiFetch(apiUrl(`/nodes/${nodeId}/annotations`), {
      method: "POST",
      body: JSON.stringify(input),
    }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
  },

  requestApproval: async (graphId, input) => {
    await apiFetch(apiUrl(`/graphs/${graphId}/approval-request`), {
      method: "POST",
      body: JSON.stringify(input),
    }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
  },

  approveRun: async (graphId, input) => {
    await apiFetch(apiUrl(`/graphs/${graphId}/approve`), {
      method: "POST",
      body: JSON.stringify(input),
    }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
  },

  rejectRun: async (graphId, input) => {
    await apiFetch(apiUrl(`/graphs/${graphId}/reject`), {
      method: "POST",
      body: JSON.stringify(input),
    }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
  },

  continueRun: async (graphId, input) => {
    await apiFetch(apiUrl(`/graphs/${graphId}/continue`), {
      method: "POST",
      body: JSON.stringify(input),
    }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
    set({ isRunning: true });
  },

  retryNode: async (nodeId) => {
    await apiFetch(apiUrl(`/nodes/${nodeId}/retry`), { method: "POST" }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
    const activeGraphId = get().activeGraphId;
    if (activeGraphId) await get().loadGraph(activeGraphId);
  },

  replanNode: async (nodeId, newGoal, reason) => {
    await apiFetch(apiUrl(`/nodes/${nodeId}/replan`), {
      method: "POST",
      body: JSON.stringify({ newGoal, reason }),
    }, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    }).catch((error) => {
      applyRequestError(set, error);
      throw error;
    });
    const activeGraphId = get().activeGraphId;
    if (activeGraphId) await get().loadGraph(activeGraphId);
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setFilterStatus: (status) => set({ filterStatus: status }),
  setFilterBranch: (branch) => set({ filterBranch: branch }),
  setUiMode: (mode) => {
    writeUiMode(mode);
    set({ uiMode: mode });
  },
  setGraphQuality: (mode) => set({ graphQuality: mode }),
  setGraphDetailMode: (mode) => set({ graphDetailMode: mode }),
  setShowSupersededNodes: (value) => set({ showSupersededNodes: value }),
  setShowRevisionBranches: (value) => set({ showRevisionBranches: value }),
  setShowReplanBranches: (value) => set({ showReplanBranches: value }),
  setFocusActivePath: (value) => set({ focusActivePath: value }),
  setCollapseSupersededBranches: (value) => set({ collapseSupersededBranches: value }),
  setCollapseRevisionClusters: (value) => set({ collapseRevisionClusters: value }),
  setShowActiveNeighborhoodOnly: (value) => set({ showActiveNeighborhoodOnly: value }),
  resetGraphVisibility: () =>
    set({
      showSupersededNodes: true,
      showRevisionBranches: true,
      showReplanBranches: true,
      focusActivePath: false,
      collapseSupersededBranches: false,
      collapseRevisionClusters: false,
      showActiveNeighborhoodOnly: false,
    }),
  markGraphViewed: (graphId) => {
    set((state) => {
      const latestSequence =
        state.events
          .filter((event) => event.graphId === graphId)
          .at(-1)?.seq ?? 0;
      const next = {
        ...state.lastSeenSequenceByGraph,
        [graphId]: latestSequence,
      };
      writeLastSeenMap(next);
      return {
        lastSeenSequenceByGraph: next,
        changesSinceLastViewed: state.activeGraphId === graphId
          ? {
              lastSeenSequence: latestSequence,
              currentSequence: latestSequence,
              newEventCount: 0,
              runControlStateChanged: false,
              frontierStatusChanged: false,
              newAlertsAppeared: false,
              changesSinceLastViewedSummary: "No important updates right now.",
            }
          : state.changesSinceLastViewed,
      };
    });
  },
  setActivityOpen: (value) => set({ activityOpen: value }),
  setCurrentView: (view) => set({ currentView: view }),
  dismissOnboarding: () => {
    writeOnboardingDismissed(true);
    set({ onboardingDismissed: true });
  },
  resetOnboarding: () => {
    writeOnboardingDismissed(false);
    set({ onboardingDismissed: false });
  },
  setDashboardFilter: (value) => set({ dashboardFilter: value }),
  setDashboardSort: (value) => set({ dashboardSort: value }),
  setDashboardQuery: (value) => set({ dashboardQuery: value }),
  setDashboardLifecycle: (value) => set({ dashboardLifecycle: value }),
  setDashboardAttention: (value) => set({ dashboardAttention: value }),
  setDashboardStatus: (value) => set({ dashboardStatus: value }),
  setCurrentActorRole: (role) => {
    if (get().authMode !== "dev_header") return;
    const actor = getSelectedActor(role);
    writeActorId(actor.actorId);
    set({ currentActor: actor, authMessage: `Signed in as ${actor.displayName}.` });
    void get().loadAuthSession();
    const activeGraphId = get().activeGraphId;
    if (activeGraphId) {
      void get().loadGraph(activeGraphId);
    }
    void get().fetchGraphs();
  },
  loadSimilarRuns: async (graphId) => {
    const params = new URLSearchParams({
      lastSeenMap: JSON.stringify(get().lastSeenSequenceByGraph),
    });
    const res = await apiFetch(apiUrl(`/graphs/${graphId}/similar?${params.toString()}`), undefined, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    });
    const similarRuns: SimilarRunSummary[] = await res.json();
    set({
      similarRuns,
      similarRunsForGraphId: graphId,
    });
  },
  loadComparison: async (leftGraphId, rightGraphId) => {
    const params = new URLSearchParams({
      leftGraphId,
      rightGraphId,
    });
    const res = await apiFetch(apiUrl(`/graphs/compare?${params.toString()}`), undefined, {
      mode: get().authMode,
      actor: get().currentActor,
      token: get().authToken,
    });
    const comparison: RunComparison = await res.json();
    set({ comparison });
  },
  clearComparison: () => set({ comparison: null }),
  loadAgentFrontier: async (graphId) => {
    set({ agentCollaborationLoading: true, agentCollaborationError: "", agentCollaborationMessage: "" });
    try {
      const response = await apiFetch(apiUrl(`/graphs/${graphId}/frontier`), undefined, {
        mode: get().authMode,
        actor: get().currentActor,
        token: get().authToken,
      });
      const frontier = (await response.json()) as AgentFrontierResponse;
      set({
        agentFrontierGraphId: graphId,
        agentFrontier: frontier.frontier,
        agentFrontierSummary: frontier.summary,
        agentActivity: frontier.recentAgentActivity,
        agentPlanProposals: frontier.planProposals,
        agentCollaborationLoading: false,
        agentCollaborationError: "",
      });
      return frontier;
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Agent frontier could not be loaded.";
      set({ agentCollaborationLoading: false, agentCollaborationError: message });
      applyRequestError(set, error);
      throw error;
    }
  },
  loadAgentContext: async (graphId, nodeId) => {
    set({ agentCollaborationLoading: true, agentCollaborationError: "", agentCollaborationMessage: "" });
    try {
      const params = new URLSearchParams();
      if (nodeId) params.set("nodeId", nodeId);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const response = await apiFetch(apiUrl(`/graphs/${graphId}/agent-context${suffix}`), undefined, {
        mode: get().authMode,
        actor: get().currentActor,
        token: get().authToken,
      });
      const context = (await response.json()) as AgentContextPack;
      set({
        agentFrontierGraphId: graphId,
        agentContext: context,
        agentFrontier: context.frontier,
        agentActivity: context.recentAgentActivity,
        agentPlanProposals: context.planProposals,
        agentCollaborationLoading: false,
        agentCollaborationError: "",
      });
      return context;
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Agent context could not be loaded.";
      set({ agentCollaborationLoading: false, agentCollaborationError: message });
      applyRequestError(set, error);
      throw error;
    }
  },
  acceptAgentPlanProposal: async (graphId, proposalId) => {
    set({ agentCollaborationLoading: true, agentCollaborationError: "", agentCollaborationMessage: "" });
    try {
      await apiFetch(apiUrl(`/graphs/${graphId}/agent/plan-proposals/${proposalId}/accept`), {
        method: "POST",
      }, {
        mode: get().authMode,
        actor: get().currentActor,
        token: get().authToken,
      });
      await get().loadAgentFrontier(graphId);
      if (get().activeGraphId === graphId) {
        await get().loadGraph(graphId);
      }
      set({ agentCollaborationLoading: false, agentCollaborationMessage: "Agent proposal accepted." });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Agent proposal could not be accepted.";
      set({ agentCollaborationLoading: false, agentCollaborationError: message });
      applyRequestError(set, error);
      throw error;
    }
  },
  dismissAgentPlanProposal: async (graphId, proposalId, reason) => {
    set({ agentCollaborationLoading: true, agentCollaborationError: "", agentCollaborationMessage: "" });
    try {
      const trimmedReason = reason?.trim().slice(0, 500);
      await apiFetch(apiUrl(`/graphs/${graphId}/agent/plan-proposals/${proposalId}/dismiss`), {
        method: "POST",
        body: JSON.stringify(trimmedReason ? { reason: trimmedReason } : {}),
      }, {
        mode: get().authMode,
        actor: get().currentActor,
        token: get().authToken,
      });
      await get().loadAgentFrontier(graphId);
      if (get().activeGraphId === graphId) {
        await get().loadGraph(graphId);
      }
      set({ agentCollaborationLoading: false, agentCollaborationMessage: "Agent proposal dismissed." });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Agent proposal could not be dismissed.";
      set({ agentCollaborationLoading: false, agentCollaborationError: message });
      applyRequestError(set, error);
      throw error;
    }
  },

  subscribeToEvents: (graphId) => {
    currentSubscription?.();
    const source = new EventSource(apiUrl(`/graphs/${graphId}/events`));

    source.onmessage = (message) => {
      const event: GraphEvent = JSON.parse(message.data);
      set((state) => ({ events: [...state.events, event] }));
      if (event.kind.startsWith("agent.")) {
        void get().loadAgentFrontier(graphId).catch(() => undefined);
      }

      if (event.kind === "node.output" && event.nodeId) {
        const payload = event.payload as NodeOutputPayload;
        set((state) => ({
          nodes: state.nodes.map((node) =>
            node.id === event.nodeId
              ? { ...node, output: payload.output }
              : node
          ),
        }));
        return;
      }

      if (
        event.kind === "run.completed" ||
        event.kind === "run.failed" ||
        event.kind === "run.paused" ||
        event.kind === "run.stopped"
      ) {
        set({ isRunning: false });
      }
      if (event.kind === "run.started" || event.kind === "run.resumed") {
        set({ isRunning: true });
      }

      void get().loadGraph(graphId);
      void get().fetchGraphs();
    };

    const unsubscribe = () => {
      source.close();
      if (currentSubscription === unsubscribe) {
        currentSubscription = null;
      }
    };

    currentSubscription = unsubscribe;
    return unsubscribe;
  },
}));
