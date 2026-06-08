export type OpenAgentGraphMetadataValue = string | number | boolean | null;

export interface OpenAgentGraphUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface OpenAgentGraphLlmCall {
  provider: string;
  operation: string;
  model?: string;
  status: "success" | "error";
  durationMs: number;
  usage?: OpenAgentGraphUsage;
  promptPreview?: string;
  outputPreview?: string;
  errorPreview?: string;
  label?: string;
  metadata?: Record<string, OpenAgentGraphMetadataValue>;
}

export type OpenAgentGraphAgentKind =
  | "human"
  | "codex"
  | "gemini"
  | "grok"
  | "script"
  | "runner"
  | "unknown";

export type OpenAgentGraphAgentProgressStatus = "started" | "progress" | "blocked" | "completed" | "failed";
export type OpenAgentGraphActorRole = "viewer" | "reviewer" | "operator" | "admin";
export type OpenAgentGraphGraphStatus = "idle" | "running" | "completed" | "failed" | "blocked" | "stopped";
export type OpenAgentGraphNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "superseded"
  | "blocked";
export type OpenAgentGraphNodeKind = "plan" | "work" | "evaluate" | "revision" | "replan";
export type OpenAgentGraphRunControlState = "idle" | "running" | "paused" | "stopping";
export type OpenAgentGraphFrontierStatus = "on_track" | "exploring" | "drifting" | "blocked";
export type OpenAgentGraphSchedulingState = "claimable" | "in_progress" | "blocked" | "waiting" | "not_actionable";
export type OpenAgentGraphAgentAction = "start" | "observe" | "unblock" | "wait" | "none";
export type OpenAgentGraphEvidenceCoverage = "none" | "partial" | "grounded";
export type OpenAgentGraphConfidenceBadge = "low" | "medium" | "high";

export interface OpenAgentGraphAgentIdentity {
  agentId: string;
  displayName: string;
  kind: OpenAgentGraphAgentKind;
  model?: string;
  version?: string;
  capabilities?: string[];
  sessionId?: string;
}

export interface OpenAgentGraphAgentProgress {
  agent: OpenAgentGraphAgentIdentity;
  nodeId?: string;
  status: OpenAgentGraphAgentProgressStatus;
  summary: string;
  details?: string;
  metadata?: Record<string, OpenAgentGraphMetadataValue>;
}

export interface OpenAgentGraphAgentEvidence {
  agent: OpenAgentGraphAgentIdentity;
  nodeId?: string;
  productNodeId?: string;
  summary: string;
  files?: string[];
  commands?: string[];
  confidence?: number;
  metadata?: Record<string, OpenAgentGraphMetadataValue>;
}

export interface OpenAgentGraphAgentPlanProposalNode {
  title: string;
  intent: string;
  kind?: "plan" | "work" | "evaluate" | "revision" | "replan";
  humanSummary?: string;
  acceptanceCriteria?: string[];
  dependsOnNodeIds?: string[];
}

export interface OpenAgentGraphAgentPlanProposal {
  agent: OpenAgentGraphAgentIdentity;
  title: string;
  summary: string;
  reason?: string;
  nodes: OpenAgentGraphAgentPlanProposalNode[];
  metadata?: Record<string, OpenAgentGraphMetadataValue>;
}

export interface OpenAgentGraphActorIdentity {
  actorId: string;
  displayName: string;
  role: OpenAgentGraphActorRole;
}

export interface OpenAgentGraphFrontierNodeSummary {
  nodeId: string;
  title: string;
  kind: OpenAgentGraphNodeKind;
  status: OpenAgentGraphNodeStatus;
  schedulingState?: OpenAgentGraphSchedulingState;
  agentAction?: OpenAgentGraphAgentAction;
  humanSummary: string;
  dependsOnNodeIds: string[];
  evidenceCoverage?: OpenAgentGraphEvidenceCoverage;
  confidenceBadge?: OpenAgentGraphConfidenceBadge;
  updatedAt: string;
}

export interface OpenAgentGraphAgentActivityRecord {
  id: string;
  graphId: string;
  kind: "registered" | "progress" | "evidence" | "plan_proposed" | "plan_accepted" | "plan_dismissed";
  agent?: OpenAgentGraphAgentIdentity;
  nodeId?: string;
  proposalId?: string;
  summary: string;
  createdAt: string;
  actor?: OpenAgentGraphActorIdentity;
}

export interface OpenAgentGraphAgentPlanProposalRecord extends OpenAgentGraphAgentPlanProposal {
  proposalId: string;
  graphId: string;
  createdAt: string;
  actor?: OpenAgentGraphActorIdentity;
  acceptedAt?: string;
  acceptedBy?: OpenAgentGraphActorIdentity;
  acceptedNodeIds?: string[];
  dismissedAt?: string;
  dismissedBy?: OpenAgentGraphActorIdentity;
  dismissalReason?: string;
}

export interface OpenAgentGraphAgentSchedulingSummary {
  claimableReadyCount?: number;
  inProgressCount?: number;
  blockedActionCount?: number;
  deferredReadyCount?: number;
}

export interface OpenAgentGraphFrontierResponse {
  graphId: string;
  generatedAt: string;
  summary: OpenAgentGraphAgentSchedulingSummary & {
    runControlState: OpenAgentGraphRunControlState;
    frontierStatus: OpenAgentGraphFrontierStatus;
    readyCount: number;
    runningCount: number;
    blockedCount: number;
    openProposalCount: number;
  };
  frontier: OpenAgentGraphFrontierNodeSummary[];
  recentAgentActivity: OpenAgentGraphAgentActivityRecord[];
  planProposals: OpenAgentGraphAgentPlanProposalRecord[];
}

export interface OpenAgentGraphAgentContextPack {
  graphId: string;
  generatedAt: string;
  graph: {
    id: string;
    title: string;
    goal: string;
    status: OpenAgentGraphGraphStatus;
    activeGoalVersionId: string;
  };
  run: OpenAgentGraphAgentSchedulingSummary & {
    runControlState: OpenAgentGraphRunControlState;
    frontierStatus: OpenAgentGraphFrontierStatus;
    plannedNodeCount: number;
    completedNodeCount: number;
    failedNodeCount: number;
    runHealthSummary: string;
  };
  selectedNode?: OpenAgentGraphFrontierNodeSummary;
  frontier: OpenAgentGraphFrontierNodeSummary[];
  recentAgentActivity: OpenAgentGraphAgentActivityRecord[];
  planProposals: OpenAgentGraphAgentPlanProposalRecord[];
  instructions: string[];
}

export interface OpenAgentGraphAgentContextOptions {
  nodeId?: string;
  frontierLimit?: number;
  activityLimit?: number;
  proposalLimit?: number;
}

export interface OpenAgentGraphFrontierOptions {
  limit?: number;
}

export interface OpenAgentGraphClientOptions {
  baseUrl: string;
  graphId: string;
  authToken?: string;
  actorHeaders?: Record<string, string>;
  captureContent?: boolean;
  redact?: (value: string) => string;
  onError?: (error: unknown) => void;
  fetch?: typeof fetch;
  telemetryTimeoutMs?: number;
}

export interface OpenAgentGraphClient {
  readonly graphId: string;
  readonly captureContent: boolean;
  preview(value: unknown): string | undefined;
  recordLlmCall(call: OpenAgentGraphLlmCall): Promise<void>;
  getFrontier(options?: OpenAgentGraphFrontierOptions): Promise<OpenAgentGraphFrontierResponse>;
  getAgentContext(options?: OpenAgentGraphAgentContextOptions): Promise<OpenAgentGraphAgentContextPack>;
  registerAgent(agent: OpenAgentGraphAgentIdentity): Promise<unknown>;
  reportProgress(progress: OpenAgentGraphAgentProgress): Promise<unknown>;
  submitEvidence(evidence: OpenAgentGraphAgentEvidence): Promise<unknown>;
  proposePlan(proposal: OpenAgentGraphAgentPlanProposal): Promise<unknown>;
  acceptPlanProposal(proposalId: string): Promise<unknown>;
  dismissPlanProposal(proposalId: string, reason?: string): Promise<unknown>;
}

export interface WrapOpenAIOptions {
  openAgentGraph: OpenAgentGraphClient;
  label?: string;
  metadata?: Record<string, OpenAgentGraphMetadataValue>;
}

const MAX_PREVIEW_CHARS = 4000;
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_KEY_CHARS = 120;
const MAX_METADATA_STRING_CHARS = 500;
const MAX_TELEMETRY_DURATION_MS = 3_600_000;
const DEFAULT_TELEMETRY_TIMEOUT_MS = 2000;
const TRUNCATION_SUFFIX = "...[truncated]";
const MAX_AGENT_TEXT_CHARS = 4000;
const MAX_AGENT_ITEMS = 20;
const MAX_AGENT_PROPOSAL_NODES = 8;

function trimBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

function truncateTo(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  if (maxLength <= TRUNCATION_SUFFIX.length) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`;
}

function truncatePreview(value: string) {
  return truncateTo(value, MAX_PREVIEW_CHARS);
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function numericUsage(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function responseContent(response: unknown): unknown {
  if (!response || typeof response !== "object") return undefined;
  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const firstChoice = choices[0] as { message?: { content?: unknown }; text?: unknown };
  return firstChoice.message?.content ?? firstChoice.text;
}

function modelFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const model = (payload as { model?: unknown }).model;
  return typeof model === "string" ? model : undefined;
}

function buildHeaders(options: OpenAgentGraphClientOptions): Record<string, string> {
  return {
    ...(options.actorHeaders ?? {}),
    ...(options.authToken ? { authorization: `Bearer ${options.authToken}` } : {}),
    "content-type": "application/json",
  };
}

function boundedDuration(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, MAX_TELEMETRY_DURATION_MS);
}

function boundedUsage(usage: OpenAgentGraphUsage | undefined): OpenAgentGraphUsage | undefined {
  if (!usage) return undefined;
  const bounded: OpenAgentGraphUsage = {};
  for (const [key, value] of Object.entries(usage) as Array<[keyof OpenAgentGraphUsage, number | undefined]>) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      bounded[key] = Math.floor(value);
    }
  }
  return Object.keys(bounded).length > 0 ? bounded : undefined;
}

function boundedMetadata(
  metadata: Record<string, OpenAgentGraphMetadataValue> | undefined
): Record<string, OpenAgentGraphMetadataValue> | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const bounded: Record<string, OpenAgentGraphMetadataValue> = {};
  for (const [rawKey, rawValue] of Object.entries(metadata).slice(0, MAX_METADATA_KEYS)) {
    const key = truncateTo(rawKey, MAX_METADATA_KEY_CHARS);
    if (!key) continue;
    if (typeof rawValue === "string") {
      bounded[key] = truncateTo(rawValue, MAX_METADATA_STRING_CHARS);
    } else if (typeof rawValue === "number") {
      if (Number.isFinite(rawValue)) bounded[key] = rawValue;
    } else if (typeof rawValue === "boolean" || rawValue === null) {
      bounded[key] = rawValue;
    }
  }
  return Object.keys(bounded).length > 0 ? bounded : undefined;
}

function boundedAgent(agent: OpenAgentGraphAgentIdentity): OpenAgentGraphAgentIdentity {
  return {
    agentId: truncateTo(agent.agentId, 120),
    displayName: truncateTo(agent.displayName, 120),
    kind: agent.kind,
    ...(agent.model ? { model: truncateTo(agent.model, 120) } : {}),
    ...(agent.version ? { version: truncateTo(agent.version, 120) } : {}),
    ...(agent.capabilities?.length
      ? { capabilities: agent.capabilities.slice(0, MAX_AGENT_ITEMS).map((item) => truncateTo(item, 80)) }
      : {}),
    ...(agent.sessionId ? { sessionId: truncateTo(agent.sessionId, 120) } : {}),
  };
}

function boundedAgentProgress(progress: OpenAgentGraphAgentProgress): OpenAgentGraphAgentProgress {
  const metadata = boundedMetadata(progress.metadata);
  return {
    agent: boundedAgent(progress.agent),
    ...(progress.nodeId ? { nodeId: truncateTo(progress.nodeId, 160) } : {}),
    status: progress.status,
    summary: truncateTo(progress.summary, MAX_AGENT_TEXT_CHARS),
    ...(progress.details ? { details: truncateTo(progress.details, MAX_AGENT_TEXT_CHARS) } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function boundedAgentEvidence(evidence: OpenAgentGraphAgentEvidence): OpenAgentGraphAgentEvidence {
  const metadata = boundedMetadata(evidence.metadata);
  return {
    agent: boundedAgent(evidence.agent),
    ...(evidence.nodeId ? { nodeId: truncateTo(evidence.nodeId, 160) } : {}),
    ...(evidence.productNodeId ? { productNodeId: truncateTo(evidence.productNodeId, 160) } : {}),
    summary: truncateTo(evidence.summary, MAX_AGENT_TEXT_CHARS),
    ...(evidence.files?.length ? { files: evidence.files.slice(0, MAX_AGENT_ITEMS).map((item) => truncateTo(item, 300)) } : {}),
    ...(evidence.commands?.length ? { commands: evidence.commands.slice(0, MAX_AGENT_ITEMS).map((item) => truncateTo(item, 500)) } : {}),
    ...(typeof evidence.confidence === "number" && Number.isFinite(evidence.confidence)
      ? { confidence: Math.min(1, Math.max(0, evidence.confidence)) }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function boundedProposalNode(node: OpenAgentGraphAgentPlanProposalNode): OpenAgentGraphAgentPlanProposalNode {
  return {
    title: truncateTo(node.title, 160),
    intent: truncateTo(node.intent, MAX_AGENT_TEXT_CHARS),
    ...(node.kind ? { kind: node.kind } : {}),
    ...(node.humanSummary ? { humanSummary: truncateTo(node.humanSummary, 500) } : {}),
    ...(node.acceptanceCriteria?.length
      ? { acceptanceCriteria: node.acceptanceCriteria.slice(0, 12).map((item) => truncateTo(item, 500)) }
      : {}),
    ...(node.dependsOnNodeIds?.length
      ? { dependsOnNodeIds: node.dependsOnNodeIds.slice(0, MAX_AGENT_ITEMS).map((item) => truncateTo(item, 160)) }
      : {}),
  };
}

function boundedAgentPlanProposal(proposal: OpenAgentGraphAgentPlanProposal): OpenAgentGraphAgentPlanProposal {
  const metadata = boundedMetadata(proposal.metadata);
  return {
    agent: boundedAgent(proposal.agent),
    title: truncateTo(proposal.title, 160),
    summary: truncateTo(proposal.summary, MAX_AGENT_TEXT_CHARS),
    ...(proposal.reason ? { reason: truncateTo(proposal.reason, MAX_AGENT_TEXT_CHARS) } : {}),
    nodes: proposal.nodes.slice(0, MAX_AGENT_PROPOSAL_NODES).map(boundedProposalNode),
    ...(metadata ? { metadata } : {}),
  };
}

function boundedCall(call: OpenAgentGraphLlmCall): OpenAgentGraphLlmCall {
  const usage = boundedUsage(call.usage);
  const metadata = boundedMetadata(call.metadata);
  return {
    provider: truncateTo(call.provider, 60),
    operation: truncateTo(call.operation, 100),
    ...(call.model ? { model: truncateTo(call.model, 120) } : {}),
    status: call.status,
    durationMs: boundedDuration(call.durationMs),
    ...(usage ? { usage } : {}),
    ...(call.promptPreview ? { promptPreview: truncatePreview(call.promptPreview) } : {}),
    ...(call.outputPreview ? { outputPreview: truncatePreview(call.outputPreview) } : {}),
    ...(call.errorPreview ? { errorPreview: truncatePreview(call.errorPreview) } : {}),
    ...(call.label ? { label: truncateTo(call.label, 120) } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function telemetryTimeoutMs(options: OpenAgentGraphClientOptions) {
  const timeout = options.telemetryTimeoutMs ?? DEFAULT_TELEMETRY_TIMEOUT_MS;
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TELEMETRY_TIMEOUT_MS;
}

function notifyTelemetryError(onError: ((error: unknown) => void) | undefined, error: unknown) {
  try {
    onError?.(error);
  } catch {
    // User-provided error handlers must not make instrumentation observable to the wrapped request.
  }
}

function previewSafely(openAgentGraph: OpenAgentGraphClient, value: unknown): string | undefined {
  try {
    return openAgentGraph.preview(value);
  } catch {
    return undefined;
  }
}

async function recordSafely(openAgentGraph: OpenAgentGraphClient, call: OpenAgentGraphLlmCall): Promise<void> {
  try {
    await openAgentGraph.recordLlmCall(boundedCall(call));
  } catch {
    // Custom OpenAgentGraphClient implementations should not break the wrapped OpenAI request.
  }
}

function scheduleRecord(openAgentGraph: OpenAgentGraphClient, call: OpenAgentGraphLlmCall): void {
  void recordSafely(openAgentGraph, call);
}

export function createOpenAgentGraphClient(options: OpenAgentGraphClientOptions): OpenAgentGraphClient {
  const requestFetch = options.fetch ?? fetch;
  const baseUrl = trimBaseUrl(options.baseUrl);
  const captureContent = options.captureContent ?? false;
  const redact = options.redact ?? ((value: string) => value);

  function preview(value: unknown): string | undefined {
    if (!captureContent) return undefined;
    try {
      return truncatePreview(redact(safeStringify(value)));
    } catch (error) {
      notifyTelemetryError(options.onError, error);
      return undefined;
    }
  }

  async function recordLlmCall(call: OpenAgentGraphLlmCall): Promise<void> {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(), telemetryTimeoutMs(options))
      : undefined;
    try {
      const response = await requestFetch(
        `${baseUrl}/graphs/${encodeURIComponent(options.graphId)}/instrumentation/llm-call`,
        {
          method: "POST",
          headers: buildHeaders(options),
          body: JSON.stringify(boundedCall(call)),
          ...(controller ? { signal: controller.signal } : {}),
        }
      );
      if (!response.ok) {
        throw new Error(`OpenAgentGraph instrumentation failed with status ${response.status}`);
      }
    } catch (error) {
      notifyTelemetryError(options.onError, error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function requestJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const response = await requestFetch(`${baseUrl}${path}`, {
      ...init,
      headers: buildHeaders(options),
    });
    if (response.ok) {
      const contentType = response.headers.get("content-type");
      return contentType?.includes("application/json") ? response.json() as Promise<T> : undefined as T;
    }
    throw new Error(`OpenAgentGraph request failed with status ${response.status}`);
  }

  function queryString(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const serialized = search.toString();
    return serialized ? `?${serialized}` : "";
  }

  return {
    graphId: options.graphId,
    captureContent,
    preview,
    recordLlmCall,
    getFrontier(frontierOptions: OpenAgentGraphFrontierOptions = {}) {
      return requestJson<OpenAgentGraphFrontierResponse>(
        `/graphs/${encodeURIComponent(options.graphId)}/frontier${queryString({ limit: frontierOptions.limit })}`
      );
    },
    getAgentContext(contextOptions: OpenAgentGraphAgentContextOptions = {}) {
      return requestJson<OpenAgentGraphAgentContextPack>(
        `/graphs/${encodeURIComponent(options.graphId)}/agent-context${queryString({
          nodeId: contextOptions.nodeId,
          frontierLimit: contextOptions.frontierLimit,
          activityLimit: contextOptions.activityLimit,
          proposalLimit: contextOptions.proposalLimit,
        })}`
      );
    },
    registerAgent(agent: OpenAgentGraphAgentIdentity) {
      return requestJson(`/graphs/${encodeURIComponent(options.graphId)}/agent/register`, {
        method: "POST",
        body: JSON.stringify({ agent: boundedAgent(agent) }),
      });
    },
    reportProgress(progress: OpenAgentGraphAgentProgress) {
      return requestJson(`/graphs/${encodeURIComponent(options.graphId)}/agent/progress`, {
        method: "POST",
        body: JSON.stringify(boundedAgentProgress(progress)),
      });
    },
    submitEvidence(evidence: OpenAgentGraphAgentEvidence) {
      return requestJson(`/graphs/${encodeURIComponent(options.graphId)}/agent/evidence`, {
        method: "POST",
        body: JSON.stringify(boundedAgentEvidence(evidence)),
      });
    },
    proposePlan(proposal: OpenAgentGraphAgentPlanProposal) {
      return requestJson(`/graphs/${encodeURIComponent(options.graphId)}/agent/plan-proposals`, {
        method: "POST",
        body: JSON.stringify(boundedAgentPlanProposal(proposal)),
      });
    },
    acceptPlanProposal(proposalId: string) {
      return requestJson(
        `/graphs/${encodeURIComponent(options.graphId)}/agent/plan-proposals/${encodeURIComponent(proposalId)}/accept`,
        { method: "POST" }
      );
    },
    dismissPlanProposal(proposalId: string, reason?: string) {
      const body = reason?.trim()
        ? { body: JSON.stringify({ reason: truncateTo(reason.trim(), 500) }) }
        : {};
      return requestJson(
        `/graphs/${encodeURIComponent(options.graphId)}/agent/plan-proposals/${encodeURIComponent(proposalId)}/dismiss`,
        {
          method: "POST",
          ...body,
        }
      );
    },
  };
}

export function wrapOpenAI<T extends object>(openaiClient: T, options: WrapOpenAIOptions): T {
  return new Proxy(openaiClient, {
    get(target, prop, receiver) {
      if (prop !== "chat") return Reflect.get(target, prop, receiver);
      const chat = Reflect.get(target, prop, receiver);
      if (!chat || typeof chat !== "object") return chat;

      return new Proxy(chat, {
        get(chatTarget, chatProp, chatReceiver) {
          if (chatProp !== "completions") return Reflect.get(chatTarget, chatProp, chatReceiver);
          const completions = Reflect.get(chatTarget, chatProp, chatReceiver);
          if (!completions || typeof completions !== "object") return completions;

          return new Proxy(completions, {
            get(completionsTarget, completionsProp, completionsReceiver) {
              if (completionsProp !== "create") {
                return Reflect.get(completionsTarget, completionsProp, completionsReceiver);
              }
              const create = Reflect.get(completionsTarget, completionsProp, completionsReceiver);
              if (typeof create !== "function") return create;

              return async function instrumentedCreate(this: unknown, ...args: unknown[]) {
                const startedAt = Date.now();
                const payload = args[0];
                const model = modelFromPayload(payload);
                let response: unknown;
                try {
                  response = await create.apply(this, args);
                } catch (error) {
                  scheduleRecord(options.openAgentGraph, {
                    provider: "openai",
                    operation: "chat.completions.create",
                    model,
                    status: "error",
                    durationMs: Date.now() - startedAt,
                    promptPreview: previewSafely(options.openAgentGraph, payload),
                    errorPreview: previewSafely(
                      options.openAgentGraph,
                      error instanceof Error ? error.message : safeStringify(error)
                    ),
                    label: options.label,
                    metadata: options.metadata,
                  });
                  throw error;
                }

                const usage = (response as { usage?: unknown }).usage;
                scheduleRecord(options.openAgentGraph, {
                  provider: "openai",
                  operation: "chat.completions.create",
                  model,
                  status: "success",
                  durationMs: Date.now() - startedAt,
                  usage: {
                    promptTokens: numericUsage(usage, "prompt_tokens"),
                    completionTokens: numericUsage(usage, "completion_tokens"),
                    totalTokens: numericUsage(usage, "total_tokens"),
                  },
                  promptPreview: previewSafely(options.openAgentGraph, payload),
                  outputPreview: previewSafely(options.openAgentGraph, responseContent(response)),
                  label: options.label,
                  metadata: options.metadata,
                });
                return response;
              };
            },
          });
        },
      });
    },
  });
}
