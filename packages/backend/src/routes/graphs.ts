import { nanoid } from "nanoid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type {
  ActorIdentity,
  AgentEvidenceSubmission,
  AgentPlanProposal,
  AgentPlanProposalNode,
  AgentProgressSubmission,
  AnnotationRequest,
  AttentionLabel,
  DashboardLifecycleBucket,
  DecisionRequest,
  Graph,
  GraphEvent,
  GraphEventKind,
  NodeEvidenceMetadataValue,
  OpenAgentGraphAgentIdentity,
} from "@openagentgraph/shared";
import { buildAgentContextPack, buildGraphFrontier, sanitizeOperationalText } from "@openagentgraph/shared";
import * as repo from "../db/graphRepo.js";
import { canActorPerform, permissionMessage, resolveActor, resolveAuth, type ProtectedAction } from "../auth/actors.js";
import { DEFAULT_PROVIDER_BASE_URLS, PROVIDER_DISPLAY_NAMES, getAppConfig } from "../config.js";
import { logDiagnostic, safeErrorMessage } from "../observability/logger.js";
import { incrementFailureMetric, incrementMetric, setGauge } from "../observability/metrics.js";
import { runGraph } from "../runner/runner.js";
import { OpenAIProvider } from "../providers/openai.js";
import type { AIProvider } from "../providers/interface.js";

const subscribers = new Map<string, Set<(event: GraphEvent) => void>>();
const activeRuns = new Set<string>();
const MAX_INSTRUMENTATION_PREVIEW_CHARS = 4000;
const MAX_INSTRUMENTATION_METADATA_KEYS = 20;
const MAX_AGENT_TEXT_CHARS = 4000;
const MAX_AGENT_METADATA_KEYS = 20;
const MAX_AGENT_FILES = 20;
const MAX_AGENT_COMMANDS = 20;
const MAX_AGENT_PROPOSAL_NODES = 8;
const LOCAL_DEV_EVENT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

const instrumentationMetadataValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const instrumentationSchema = z.object({
  provider: z.string().trim().min(1).max(60).default("openai"),
  operation: z.string().trim().min(1).max(100).default("chat.completions.create"),
  model: z.string().trim().max(120).optional(),
  status: z.enum(["success", "error"]),
  durationMs: z.number().finite().nonnegative().max(3_600_000),
  usage: z.object({
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  }).optional(),
  promptPreview: z.string().max(MAX_INSTRUMENTATION_PREVIEW_CHARS).optional(),
  outputPreview: z.string().max(MAX_INSTRUMENTATION_PREVIEW_CHARS).optional(),
  errorPreview: z.string().max(MAX_INSTRUMENTATION_PREVIEW_CHARS).optional(),
  label: z.string().trim().max(120).optional(),
  metadata: z.record(instrumentationMetadataValueSchema).optional(),
}).superRefine((value, context) => {
  if (value.metadata && Object.keys(value.metadata).length > MAX_INSTRUMENTATION_METADATA_KEYS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["metadata"],
      message: `metadata can contain at most ${MAX_INSTRUMENTATION_METADATA_KEYS} keys`,
    });
  }
});

const agentMetadataSchema = z.record(instrumentationMetadataValueSchema).optional().superRefine((value, context) => {
  if (value && Object.keys(value).length > MAX_AGENT_METADATA_KEYS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `metadata can contain at most ${MAX_AGENT_METADATA_KEYS} keys`,
    });
  }
});

const agentIdentitySchema = z.object({
  agentId: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(120),
  kind: z.enum(["human", "codex", "gemini", "grok", "script", "runner", "unknown"]).default("unknown"),
  model: z.string().trim().max(120).optional(),
  version: z.string().trim().max(120).optional(),
  capabilities: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  sessionId: z.string().trim().max(120).optional(),
});

const agentRegisterSchema = z.object({
  agent: agentIdentitySchema,
});

const agentProgressSchema = z.object({
  agent: agentIdentitySchema,
  nodeId: z.string().trim().min(1).max(160).optional(),
  status: z.enum(["started", "progress", "blocked", "completed", "failed"]),
  summary: z.string().trim().min(1).max(MAX_AGENT_TEXT_CHARS),
  details: z.string().trim().max(MAX_AGENT_TEXT_CHARS).optional(),
  metadata: agentMetadataSchema,
});

const agentEvidenceSchema = z.object({
  agent: agentIdentitySchema,
  nodeId: z.string().trim().min(1).max(160).optional(),
  productNodeId: z.string().trim().min(1).max(160).optional(),
  summary: z.string().trim().min(1).max(MAX_AGENT_TEXT_CHARS),
  files: z.array(z.string().trim().min(1).max(300)).max(MAX_AGENT_FILES).optional(),
  commands: z.array(z.string().trim().min(1).max(500)).max(MAX_AGENT_COMMANDS).optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
  metadata: agentMetadataSchema,
});

const agentProposalNodeSchema = z.object({
  title: z.string().trim().min(1).max(160),
  intent: z.string().trim().min(1).max(MAX_AGENT_TEXT_CHARS),
  kind: z.enum(["plan", "work", "evaluate", "revision", "replan"]).optional(),
  humanSummary: z.string().trim().max(500).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  dependsOnNodeIds: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
});

const agentPlanProposalSchema = z.object({
  agent: agentIdentitySchema,
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(MAX_AGENT_TEXT_CHARS),
  reason: z.string().trim().max(MAX_AGENT_TEXT_CHARS).optional(),
  nodes: z.array(agentProposalNodeSchema).min(1).max(MAX_AGENT_PROPOSAL_NODES),
  metadata: agentMetadataSchema,
});

const agentPlanDismissSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

function validationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function broadcastEvent(event: GraphEvent) {
  subscribers.get(event.graphId)?.forEach((fn) => fn(event));
}

function eventStreamCorsOrigin(originHeader: string | string[] | undefined) {
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!origin) return undefined;

  const config = getAppConfig();
  const allowedOrigins = new Set(config.frontend.allowedOrigins);
  if (config.frontend.publicBaseUrl) {
    allowedOrigins.add(new URL(config.frontend.publicBaseUrl).origin);
  }
  if (!config.env.isProduction && allowedOrigins.size === 0) {
    LOCAL_DEV_EVENT_ORIGINS.forEach((localOrigin) => allowedOrigins.add(localOrigin));
  }

  return allowedOrigins.has("*") || allowedOrigins.has(origin) ? origin : undefined;
}

function boundedPreview(value: string | undefined, fallback: string) {
  if (!value?.trim()) return fallback;
  return value.length <= MAX_INSTRUMENTATION_PREVIEW_CHARS
    ? value
    : `${value.slice(0, MAX_INSTRUMENTATION_PREVIEW_CHARS)}...[truncated]`;
}

function instrumentationMetadata(
  input: z.infer<typeof instrumentationSchema>
): Record<string, NodeEvidenceMetadataValue> {
  return {
    ...(input.metadata ?? {}),
    provider: input.provider,
    operation: input.operation,
    instrumentationSource: "openagentgraph-sdk",
    status: input.status,
    durationMs: input.durationMs,
    ...(input.model ? { model: input.model } : {}),
    ...(input.label ? { label: input.label } : {}),
    ...(input.usage?.promptTokens !== undefined ? { promptTokens: input.usage.promptTokens } : {}),
    ...(input.usage?.completionTokens !== undefined ? { completionTokens: input.usage.completionTokens } : {}),
    ...(input.usage?.totalTokens !== undefined ? { totalTokens: input.usage.totalTokens } : {}),
  };
}

function requestParams(params: unknown): Record<string, string | undefined> | undefined {
  if (!params || typeof params !== "object") return undefined;
  return params as Record<string, string | undefined>;
}

function logRoute(
  req: { id: string; params?: unknown },
  input: {
    level: "debug" | "info" | "warn" | "error";
    message: string;
    graphId?: string;
    nodeId?: string;
    actor?: ActorIdentity;
    errorCode?: string;
    safeMetadata?: Record<string, unknown>;
  }
) {
  logDiagnostic({
    level: input.level,
    component: "routes.graphs",
    message: input.message,
    requestId: req.id,
    graphId: input.graphId ?? requestParams(req.params)?.graphId,
    nodeId: input.nodeId ?? requestParams(req.params)?.nodeId,
    actorId: input.actor?.actorId,
    errorCode: input.errorCode,
    safeMetadata: input.safeMetadata,
  });
}

async function recordAndBroadcast<K extends GraphEventKind>(event: {
  graphId: string;
  kind: K;
  nodeId?: string;
  goalVersionId?: string;
  payload: GraphEvent<K>["payload"];
}) {
  const persisted = await repo.appendGraphEvent(event);
  broadcastEvent(persisted);
  return persisted;
}

async function recordAndBroadcastBatch(events: Array<{
  graphId: string;
  kind: GraphEventKind;
  nodeId?: string;
  goalVersionId?: string;
  payload: GraphEvent["payload"];
}>) {
  const persisted = await repo.appendGraphEvents(events);
  persisted.forEach(broadcastEvent);
  return persisted;
}

function createProvider(req: { id: string }, graphId?: string): AIProvider | undefined {
  const config = getAppConfig();
  if (!config.provider.configured) {
    logRoute(req, {
      level: "warn",
      message: "AI provider is not configured; execution is unavailable.",
      graphId,
      errorCode: "PROVIDER_NOT_CONFIGURED",
    });
    return undefined;
  }

  if (config.provider.mode !== "unset") {
    const providerMode = config.provider.mode;
    const apiKey = providerMode === "ollama"
      ? "ollama"
      : config.provider.apiKey ?? "openagentgraph-no-auth";
    const omitAuthorization = providerMode === "openai-compatible" && !config.provider.apiKey;
    const baseURL = config.provider.baseUrl ?? DEFAULT_PROVIDER_BASE_URLS[providerMode];
    const embeddingModel =
      providerMode === "openai"
        ? config.provider.embeddingModel
        : providerMode === "ollama"
          ? config.provider.embeddingModel ?? config.provider.model
          : config.provider.embeddingModel ?? false;
    return new OpenAIProvider(apiKey, {
      model: config.provider.model,
      ...(baseURL ? { baseURL } : {}),
      providerMode,
      providerLabel: PROVIDER_DISPLAY_NAMES[providerMode],
      providerComponent: `providers.${providerMode.replace(/-/g, "_")}`,
      embeddingModel,
      omitAuthorization,
    });
  }

  logRoute(req, {
    level: "warn",
    message: "AI provider is not configured; execution is unavailable.",
    graphId,
    errorCode: "PROVIDER_NOT_CONFIGURED",
  });
  return undefined;
}

function startBackgroundRun(graphId: string, workspaceRoot: string, provider: AIProvider, resume = false) {
  activeRuns.add(graphId);
  setGauge(
    "openagentgraph_active_run_loops",
    "Currently active run loops.",
    activeRuns.size
  );
  void runGraph(graphId, workspaceRoot, provider, recordAndBroadcast, { resume }).finally(() => {
    activeRuns.delete(graphId);
    setGauge(
      "openagentgraph_active_run_loops",
      "Currently active run loops.",
      activeRuns.size
    );
  });
}

function requireActor(
  req: { id: string; headers: Record<string, unknown>; params?: unknown },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } }
) {
  const resolution = resolveAuth(req as Parameters<typeof resolveAuth>[0]);
  if (!resolution.actor) {
    incrementFailureMetric(
      resolution.status === "invalid" || resolution.status === "expired" ? "auth_invalid" : "auth_missing",
      "routes.graphs",
      "hard"
    );
    incrementMetric(
      "openagentgraph_permission_denials_total",
      "Permission denials for protected actions.",
      {
        action:
          resolution.status === "invalid" || resolution.status === "expired"
            ? "auth_invalid"
            : "auth_required",
      }
    );
    logRoute(req, {
      level: "warn",
      message: resolution.message,
      errorCode:
        resolution.status === "expired"
          ? "AUTH_EXPIRED"
          : resolution.status === "invalid"
            ? "AUTH_INVALID"
            : "AUTH_REQUIRED",
    });
    reply.status(401).send({ error: resolution.message });
    return undefined;
  }

  return resolution.actor;
}

function ensurePermission(
  req: { id: string; params?: unknown },
  actor: ActorIdentity | undefined,
  action: ProtectedAction,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } }
) {
  if (!canActorPerform(actor, action)) {
    incrementFailureMetric("permission_denied", "routes.graphs", "hard");
    incrementMetric(
      "openagentgraph_permission_denials_total",
      "Permission denials for protected actions.",
      { action }
    );
    logRoute(req, {
      level: "warn",
      message: permissionMessage(action),
      actor,
      errorCode: "PERMISSION_DENIED",
    });
    reply.status(403).send({ error: permissionMessage(action) });
    return false;
  }

  return true;
}

async function projectionOr404(
  graphId: string,
  req: { id: string; params?: unknown },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } }
) {
  const projection = await repo.getGraphProjection(graphId).catch((error) => {
    logRoute(req, {
      level: "warn",
      message: "Graph projection could not be loaded.",
      graphId,
      errorCode: "GRAPH_NOT_FOUND",
      safeMetadata: { error: safeErrorMessage(error) },
    });
    return undefined;
  });
  if (!projection) {
    reply.status(404).send({ error: "Not found" });
    return undefined;
  }
  return projection;
}

function boundedLimit(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(parsed)));
}

function nodeExists(projection: Awaited<ReturnType<typeof repo.getGraphProjection>>, nodeId: string | undefined) {
  if (!nodeId) return true;
  return projection.nodes.some((node) => node.id === nodeId);
}

function sanitizeAgentText(value: string, maxLength = MAX_AGENT_TEXT_CHARS) {
  return sanitizeOperationalText(value, { maxLength });
}

function sanitizeMetadata(
  metadata: Record<string, NodeEvidenceMetadataValue> | undefined
): Record<string, NodeEvidenceMetadataValue> | undefined {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      sanitizeAgentText(key, 120),
      typeof value === "string" ? sanitizeAgentText(value, 500) : value,
    ])
  );
}

function sanitizeAgent(agent: OpenAgentGraphAgentIdentity): OpenAgentGraphAgentIdentity {
  return {
    ...agent,
    agentId: sanitizeAgentText(agent.agentId, 120),
    displayName: sanitizeAgentText(agent.displayName, 120),
    ...(agent.model ? { model: sanitizeAgentText(agent.model, 120) } : {}),
    ...(agent.version ? { version: sanitizeAgentText(agent.version, 120) } : {}),
    ...(agent.capabilities ? { capabilities: agent.capabilities.map((item) => sanitizeAgentText(item, 80)) } : {}),
    ...(agent.sessionId ? { sessionId: sanitizeAgentText(agent.sessionId, 120) } : {}),
  };
}

function sanitizeAgentProgress(input: AgentProgressSubmission): AgentProgressSubmission {
  return {
    ...input,
    agent: sanitizeAgent(input.agent),
    ...(input.nodeId ? { nodeId: sanitizeAgentText(input.nodeId, 160) } : {}),
    summary: sanitizeAgentText(input.summary),
    ...(input.details ? { details: sanitizeAgentText(input.details) } : {}),
    ...(input.metadata ? { metadata: sanitizeMetadata(input.metadata) } : {}),
  };
}

function sanitizeAgentEvidence(input: AgentEvidenceSubmission): AgentEvidenceSubmission {
  return {
    ...input,
    agent: sanitizeAgent(input.agent),
    ...(input.nodeId ? { nodeId: sanitizeAgentText(input.nodeId, 160) } : {}),
    ...(input.productNodeId ? { productNodeId: sanitizeAgentText(input.productNodeId, 160) } : {}),
    summary: sanitizeAgentText(input.summary),
    ...(input.files ? { files: input.files.map((item) => sanitizeAgentText(item, 300)) } : {}),
    ...(input.commands ? { commands: input.commands.map((item) => sanitizeAgentText(item, 500)) } : {}),
    ...(input.metadata ? { metadata: sanitizeMetadata(input.metadata) } : {}),
  };
}

function sanitizeProposalNode(node: AgentPlanProposalNode): AgentPlanProposalNode {
  return {
    ...node,
    title: sanitizeAgentText(node.title, 160),
    intent: sanitizeAgentText(node.intent),
    ...(node.humanSummary ? { humanSummary: sanitizeAgentText(node.humanSummary, 500) } : {}),
    ...(node.acceptanceCriteria
      ? { acceptanceCriteria: node.acceptanceCriteria.map((item) => sanitizeAgentText(item, 500)) }
      : {}),
    ...(node.dependsOnNodeIds ? { dependsOnNodeIds: node.dependsOnNodeIds.map((item) => sanitizeAgentText(item, 160)) } : {}),
  };
}

function sanitizeAgentPlanProposal(input: AgentPlanProposal): AgentPlanProposal {
  return {
    ...input,
    agent: sanitizeAgent(input.agent),
    title: sanitizeAgentText(input.title, 160),
    summary: sanitizeAgentText(input.summary),
    ...(input.reason ? { reason: sanitizeAgentText(input.reason) } : {}),
    nodes: input.nodes.map(sanitizeProposalNode),
    ...(input.metadata ? { metadata: sanitizeMetadata(input.metadata) } : {}),
  };
}

function proposalDependenciesAreKnown(
  nodes: AgentPlanProposalNode[],
  existingNodeIds: Set<string>
): { ok: true } | { ok: false; nodeTitle: string; dependencyId: string } {
  for (const node of nodes) {
    for (const dependencyId of node.dependsOnNodeIds ?? []) {
      if (!existingNodeIds.has(dependencyId)) {
        return { ok: false, nodeTitle: node.title, dependencyId };
      }
    }
  }
  return { ok: true };
}

export async function graphRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      lastSeenMap?: string;
      q?: string;
      lifecycle?: DashboardLifecycleBucket | "all";
      attention?: AttentionLabel | "all";
      status?: Graph["status"] | "all";
      now?: string;
    };
  }>("/graphs", async (req, reply) => {
    try {
      const parsed =
        typeof req.query.lastSeenMap === "string" && req.query.lastSeenMap.length > 0
          ? JSON.parse(req.query.lastSeenMap)
          : {};
      const lastSeenSequenceByGraph =
        parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};

      return repo.getDashboardOverview(lastSeenSequenceByGraph, {
        q: req.query.q,
        lifecycle: req.query.lifecycle,
        attention: req.query.attention,
        status: req.query.status,
        now: req.query.now,
      });
    } catch (error) {
      logRoute(req, {
        level: "warn",
        message: "Invalid dashboard query parameters.",
        errorCode: "DASHBOARD_QUERY_INVALID",
        safeMetadata: { error: safeErrorMessage(error) },
      });
      return reply.status(400).send({ error: "Invalid lastSeenMap" });
    }
  });

  app.get<{
    Querystring: {
      leftGraphId: string;
      rightGraphId: string;
    };
  }>("/graphs/compare", async (req, reply) => {
    try {
      if (!req.query.leftGraphId || !req.query.rightGraphId) {
        return reply.status(400).send({ error: "leftGraphId and rightGraphId are required" });
      }
      return repo.getRunComparison(req.query.leftGraphId, req.query.rightGraphId);
    } catch (error) {
      logRoute(req, {
        level: "warn",
        message: "Comparison could not be loaded.",
        errorCode: "COMPARISON_NOT_FOUND",
        safeMetadata: { error: safeErrorMessage(error) },
      });
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.post<{
    Body: {
      title: string;
      goal: string;
      constraints?: string;
      successCriteria?: string[];
      forbiddenScope?: string[];
    };
  }>("/graphs", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "manage_product_graph", reply)) return;

    const { title, goal, constraints, successCriteria, forbiddenScope } = req.body;
    if (!title || !goal) {
      return reply.status(400).send({ error: "title and goal are required" });
    }

    const provider = createProvider(req);
    if (provider) {
      const goalPacket = await provider.buildGoalPacket({
        goal,
        successCriteria: successCriteria ?? [],
        forbiddenScope: forbiddenScope ?? [],
        version: 1,
      });

      const graph = await repo.createGraphWithGoalPacket(
        {
          title,
          goal,
          constraints,
          successCriteria,
          forbiddenScope,
        },
        goalPacket
      );

      return reply.status(201).send(graph);
    }

    const graph = await repo.createGraph({
      title,
      goal,
      constraints,
      successCriteria,
      forbiddenScope,
    });

    return reply.status(201).send(graph);
  });

  app.post<{ Params: { graphId: string }; Body: unknown }>(
    "/graphs/:graphId/instrumentation/llm-call",
    async (req, reply) => {
      const actor = requireActor(req, reply);
      if (!actor || !ensurePermission(req, actor, "manage_product_graph", reply)) return;

      const parsed = instrumentationSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid instrumentation payload.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      let projection: Awaited<ReturnType<typeof repo.getGraphProjection>>;
      try {
        projection = await repo.getGraphProjection(req.params.graphId);
      } catch (error) {
        logRoute(req, {
          level: "warn",
          message: "Instrumentation target graph could not be loaded.",
          errorCode: "GRAPH_NOT_FOUND",
          safeMetadata: { error: safeErrorMessage(error) },
        });
        return reply.status(404).send({ error: "Not found" });
      }

      const input = parsed.data;
      const nodeId = nanoid();
      const title = boundedPreview(input.label, `${input.provider} ${input.operation}`).slice(0, 120);
      const prompt = boundedPreview(input.promptPreview, "[prompt redacted]");
      const output = boundedPreview(input.outputPreview, "[output redacted]");
      const metadata = instrumentationMetadata(input);
      const createdEvents: GraphEvent[] = [];

      createdEvents.push(await recordAndBroadcast({
        graphId: req.params.graphId,
        kind: "node.planned",
        nodeId,
        payload: {
          kind: "work",
          title,
          intent: `Observe ${input.provider} ${input.operation} call through OpenAgentGraph SDK instrumentation.`,
          humanSummary: `Observed ${input.provider} ${input.operation}.`,
          contract: {
            expectedArtifact: "LLM call telemetry event",
            allowedTools: [],
            acceptanceCriteria: ["Capture bounded latency, token, provider, and result metadata."],
            humanSummary: "Capture LLM call telemetry.",
          },
          baselineGoalVersionId: projection.graph.originalGoalVersionId,
          activeGoalVersionId: projection.graph.activeGoalVersionId,
          dependsOnNodeIds: [],
        },
      }));

      createdEvents.push(await recordAndBroadcast({
        graphId: req.params.graphId,
        kind: "node.executing",
        nodeId,
        payload: {
          prompt,
          workspaceRoot: "",
        },
      }));

      if (input.status === "success") {
        createdEvents.push(await recordAndBroadcast({
          graphId: req.params.graphId,
          kind: "node.output",
          nodeId,
          payload: {
            output,
            mode: "final",
          },
        }));
        createdEvents.push(await recordAndBroadcast({
          graphId: req.params.graphId,
          kind: "node.completed",
          nodeId,
          payload: {
            output,
            confidence: 1,
            evidence: {
              fileDiffs: [],
              commandResults: [],
              toolCallLog: [],
              workspaceChecksum: "",
              workspaceChecksumBefore: "",
              workspaceChecksumAfter: "",
              metadata,
            },
          },
        }));
      } else {
        const reason = boundedPreview(input.errorPreview, "Instrumented LLM call failed.");
        createdEvents.push(await recordAndBroadcast({
          graphId: req.params.graphId,
          kind: "node.failed",
          nodeId,
          payload: {
            reason,
            metadata,
          },
        }));
      }

      return reply.status(202).send({
        nodeId,
        eventIds: createdEvents.map((event) => event.id),
      });
    }
  );

  app.get<{
    Params: { graphId: string };
    Querystring: { limit?: string };
  }>("/graphs/:graphId/frontier", async (req, reply) => {
    const projection = await projectionOr404(req.params.graphId, req, reply);
    if (!projection) return;
    const frontier = buildGraphFrontier(projection, {
      limit: boundedLimit(req.query.limit, 8, 50),
    });

    return {
      graphId: req.params.graphId,
      generatedAt: new Date().toISOString(),
      summary: {
        runControlState: projection.runControlState,
        frontierStatus: projection.frontierStatus,
        readyCount: projection.nodes.filter((node) => node.status === "ready").length,
        runningCount: projection.nodes.filter((node) => node.status === "running").length,
        blockedCount: projection.nodes.filter((node) => node.status === "blocked" || node.status === "failed").length,
        openProposalCount: (projection.agentPlanProposals ?? []).filter(
          (proposal) => !proposal.acceptedAt && !proposal.dismissedAt
        ).length,
      },
      frontier,
      recentAgentActivity: [...(projection.agentActivity ?? [])]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 8),
      planProposals: [...(projection.agentPlanProposals ?? [])]
        .filter((proposal) => !proposal.acceptedAt && !proposal.dismissedAt)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 8),
    };
  });

  app.get<{
    Params: { graphId: string };
    Querystring: {
      nodeId?: string;
      frontierLimit?: string;
      activityLimit?: string;
      proposalLimit?: string;
    };
  }>("/graphs/:graphId/agent-context", async (req, reply) => {
    const projection = await projectionOr404(req.params.graphId, req, reply);
    if (!projection) return;
    if (req.query.nodeId && !nodeExists(projection, req.query.nodeId)) {
      return reply.status(404).send({ error: "Node not found" });
    }

    return buildAgentContextPack(projection, {
      nodeId: req.query.nodeId,
      frontierLimit: boundedLimit(req.query.frontierLimit, 8, 50),
      activityLimit: boundedLimit(req.query.activityLimit, 8, 50),
      proposalLimit: boundedLimit(req.query.proposalLimit, 8, 50),
    });
  });

  app.post<{ Params: { graphId: string }; Body: unknown }>(
    "/graphs/:graphId/agent/register",
    async (req, reply) => {
      const actor = requireActor(req, reply);
      if (!actor || !ensurePermission(req, actor, "manage_product_graph", reply)) return;
      const projection = await projectionOr404(req.params.graphId, req, reply);
      if (!projection) return;

      const parsed = agentRegisterSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid agent registration payload.", issues: validationIssues(parsed.error) });
      }

      const agent = sanitizeAgent(parsed.data.agent);
      const event = await recordAndBroadcast({
        graphId: req.params.graphId,
        kind: "agent.registered",
        payload: {
          agent,
          createdAt: new Date().toISOString(),
          actor,
        },
      });

      return reply.status(201).send({ eventId: event.id, agent });
    }
  );

  app.post<{ Params: { graphId: string }; Body: unknown }>(
    "/graphs/:graphId/agent/progress",
    async (req, reply) => {
      const actor = requireActor(req, reply);
      if (!actor || !ensurePermission(req, actor, "manage_product_graph", reply)) return;
      const projection = await projectionOr404(req.params.graphId, req, reply);
      if (!projection) return;

      const parsed = agentProgressSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid agent progress payload.", issues: validationIssues(parsed.error) });
      }
      if (!nodeExists(projection, parsed.data.nodeId)) {
        return reply.status(400).send({ error: "nodeId does not exist in this graph." });
      }

      const progressId = nanoid();
      const sanitized = sanitizeAgentProgress(parsed.data);
      const event = await recordAndBroadcast({
        graphId: req.params.graphId,
        kind: "agent.progress_reported",
        nodeId: sanitized.nodeId,
        payload: {
          ...sanitized,
          progressId,
          graphId: req.params.graphId,
          createdAt: new Date().toISOString(),
          actor,
        },
      });

      return reply.status(201).send({ progressId, eventId: event.id });
    }
  );

  app.post<{ Params: { graphId: string }; Body: unknown }>(
    "/graphs/:graphId/agent/evidence",
    async (req, reply) => {
      const actor = requireActor(req, reply);
      if (!actor || !ensurePermission(req, actor, "manage_product_graph", reply)) return;
      const projection = await projectionOr404(req.params.graphId, req, reply);
      if (!projection) return;

      const parsed = agentEvidenceSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid agent evidence payload.", issues: validationIssues(parsed.error) });
      }
      if (!nodeExists(projection, parsed.data.nodeId)) {
        return reply.status(400).send({ error: "nodeId does not exist in this graph." });
      }

      const evidenceId = nanoid();
      const sanitized = sanitizeAgentEvidence(parsed.data);
      const event = await recordAndBroadcast({
        graphId: req.params.graphId,
        kind: "agent.evidence_submitted",
        nodeId: sanitized.nodeId,
        payload: {
          ...sanitized,
          evidenceId,
          graphId: req.params.graphId,
          createdAt: new Date().toISOString(),
          actor,
        },
      });

      return reply.status(201).send({ evidenceId, eventId: event.id });
    }
  );

  app.post<{ Params: { graphId: string }; Body: unknown }>(
    "/graphs/:graphId/agent/plan-proposals",
    async (req, reply) => {
      const actor = requireActor(req, reply);
      if (!actor || !ensurePermission(req, actor, "manage_product_graph", reply)) return;
      const projection = await projectionOr404(req.params.graphId, req, reply);
      if (!projection) return;

      const parsed = agentPlanProposalSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid agent plan proposal payload.", issues: validationIssues(parsed.error) });
      }
      const dependencyCheck = proposalDependenciesAreKnown(
        parsed.data.nodes,
        new Set(projection.nodes.map((node) => node.id))
      );
      if (!dependencyCheck.ok) {
        return reply.status(400).send({
          error: `Proposal node '${dependencyCheck.nodeTitle}' depends on unknown node '${dependencyCheck.dependencyId}'.`,
        });
      }

      const proposalId = nanoid();
      const sanitized = sanitizeAgentPlanProposal(parsed.data);
      const event = await recordAndBroadcast({
        graphId: req.params.graphId,
        kind: "agent.plan_proposed",
        payload: {
          ...sanitized,
          proposalId,
          graphId: req.params.graphId,
          createdAt: new Date().toISOString(),
          actor,
        },
      });

      return reply.status(201).send({ proposalId, eventId: event.id });
    }
  );

  app.post<{
    Params: { graphId: string; proposalId: string };
  }>("/graphs/:graphId/agent/plan-proposals/:proposalId/accept", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor || !ensurePermission(req, actor, "manage_product_graph", reply)) return;
    const projection = await projectionOr404(req.params.graphId, req, reply);
    if (!projection) return;

    const proposal = (projection.agentPlanProposals ?? []).find((candidate) => candidate.proposalId === req.params.proposalId);
    if (!proposal) return reply.status(404).send({ error: "Proposal not found" });
    if (proposal.acceptedAt) return reply.status(409).send({ error: "Proposal has already been accepted." });
    if (proposal.dismissedAt) return reply.status(409).send({ error: "Proposal has already been dismissed." });

    const dependencyCheck = proposalDependenciesAreKnown(proposal.nodes, new Set(projection.nodes.map((node) => node.id)));
    if (!dependencyCheck.ok) {
      return reply.status(400).send({
        error: `Proposal node '${dependencyCheck.nodeTitle}' depends on unknown node '${dependencyCheck.dependencyId}'.`,
      });
    }

    const acceptedNodeIds: string[] = [];
    const eventInputs: Array<{
      graphId: string;
      kind: GraphEventKind;
      nodeId?: string;
      payload: GraphEvent["payload"];
    }> = [];
    for (const proposedNode of proposal.nodes) {
      const nodeId = nanoid();
      acceptedNodeIds.push(nodeId);
      eventInputs.push({
        graphId: req.params.graphId,
        kind: "node.planned",
        nodeId,
        payload: {
          kind: proposedNode.kind ?? "work",
          title: proposedNode.title,
          intent: proposedNode.intent,
          humanSummary: proposedNode.humanSummary?.trim() || proposedNode.title,
          contract: {
            expectedArtifact: "Accepted external agent proposal",
            allowedTools: [],
            acceptanceCriteria: proposedNode.acceptanceCriteria?.length
              ? proposedNode.acceptanceCriteria
              : ["Complete the accepted proposal and capture evidence."],
            humanSummary: proposedNode.humanSummary?.trim() || "Complete the accepted external agent proposal.",
          },
          baselineGoalVersionId: projection.graph.originalGoalVersionId,
          activeGoalVersionId: projection.graph.activeGoalVersionId,
          dependsOnNodeIds: proposedNode.dependsOnNodeIds ?? [],
        },
      });
    }

    const acceptedAt = new Date().toISOString();
    eventInputs.push({
      graphId: req.params.graphId,
      kind: "agent.plan_accepted",
      payload: {
        proposalId: req.params.proposalId,
        graphId: req.params.graphId,
        acceptedAt,
        acceptedBy: actor,
        acceptedNodeIds,
      },
    });
    const events = await recordAndBroadcastBatch(eventInputs);
    const acceptedEvent = events[events.length - 1];

    return reply.status(201).send({ proposalId: req.params.proposalId, acceptedNodeIds, eventId: acceptedEvent?.id });
  });

  app.post<{
    Params: { graphId: string; proposalId: string };
    Body: unknown;
  }>("/graphs/:graphId/agent/plan-proposals/:proposalId/dismiss", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor || !ensurePermission(req, actor, "manage_product_graph", reply)) return;
    const projection = await projectionOr404(req.params.graphId, req, reply);
    if (!projection) return;

    const proposal = (projection.agentPlanProposals ?? []).find((candidate) => candidate.proposalId === req.params.proposalId);
    if (!proposal) return reply.status(404).send({ error: "Proposal not found" });
    if (proposal.acceptedAt) return reply.status(409).send({ error: "Proposal has already been accepted." });
    if (proposal.dismissedAt) return reply.status(409).send({ error: "Proposal has already been dismissed." });

    const parsed = agentPlanDismissSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid agent proposal dismissal payload.", issues: validationIssues(parsed.error) });
    }

    const dismissedAt = new Date().toISOString();
    const event = await recordAndBroadcast({
      graphId: req.params.graphId,
      kind: "agent.plan_dismissed",
      payload: {
        proposalId: req.params.proposalId,
        graphId: req.params.graphId,
        dismissedAt,
        dismissedBy: actor,
        ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
      },
    });

    return reply.status(201).send({ proposalId: req.params.proposalId, eventId: event.id, dismissedAt });
  });

  app.get<{ Params: { graphId: string }; Querystring: { lastSeenSequence?: string } }>("/graphs/:graphId", async (req, reply) => {
    try {
      const projection = await repo.getGraphProjection(req.params.graphId);
      const actor = resolveActor(req);
      const lastSeenSequence = Number(req.query.lastSeenSequence ?? 0);
      const changesSinceLastViewed = await repo.getChangesSinceLastViewed(
        req.params.graphId,
        Number.isFinite(lastSeenSequence) ? lastSeenSequence : 0
      );
      return {
        ...repo.withActorContext(projection, actor),
        changesSinceLastViewed,
      };
    } catch (error) {
      logRoute(req, {
        level: "warn",
        message: "Graph projection could not be loaded.",
        errorCode: "GRAPH_NOT_FOUND",
        safeMetadata: { error: safeErrorMessage(error) },
      });
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.get<{ Params: { graphId: string }; Querystring: { lastSeenSequence?: string } }>("/graphs/:graphId/report", async (req, reply) => {
    try {
      const report = await repo.getGraphRunReport(req.params.graphId);
      const lastSeenSequence = Number(req.query.lastSeenSequence ?? 0);
      return {
        ...report,
        changesSinceLastViewed: await repo.getChangesSinceLastViewed(
          req.params.graphId,
          Number.isFinite(lastSeenSequence) ? lastSeenSequence : 0
        ),
      };
    } catch (error) {
      logRoute(req, {
        level: "warn",
        message: "Run report could not be loaded.",
        errorCode: "REPORT_NOT_FOUND",
        safeMetadata: { error: safeErrorMessage(error) },
      });
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.get<{ Params: { graphId: string }; Querystring: { lastSeenMap?: string; now?: string } }>("/graphs/:graphId/similar", async (req, reply) => {
    try {
      const parsed =
        typeof req.query.lastSeenMap === "string" && req.query.lastSeenMap.length > 0
          ? JSON.parse(req.query.lastSeenMap)
          : {};
      const lastSeenSequenceByGraph =
        parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
      return repo.getSimilarRuns(req.params.graphId, lastSeenSequenceByGraph, { now: req.query.now });
    } catch (error) {
      logRoute(req, {
        level: "warn",
        message: "Similar runs could not be loaded.",
        errorCode: "SIMILAR_RUNS_UNAVAILABLE",
        safeMetadata: { error: safeErrorMessage(error) },
      });
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.post<{
    Params: { graphId: string };
    Body: { workspaceRoot: string };
  }>("/graphs/:graphId/runs", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "manage_product_graph", reply)) return;

    const projection = await repo.getGraphProjection(req.params.graphId).catch(() => null);
    if (!projection) {
      logRoute(req, {
        level: "warn",
        message: "Run start requested for an unknown graph.",
        errorCode: "GRAPH_NOT_FOUND",
      });
      return reply.status(404).send({ error: "Not found" });
    }
    if (activeRuns.has(req.params.graphId) || projection.runControlState === "running") {
      logRoute(req, {
        level: "warn",
        message: "Run already in progress.",
        graphId: req.params.graphId,
        errorCode: "RUN_ALREADY_ACTIVE",
      });
      return reply.status(409).send({ error: "Run already in progress" });
    }
    if (projection.runControlState === "paused") {
      return reply.status(409).send({ error: "Run is paused. Resume it instead of starting a new run." });
    }

    const provider = createProvider(req, req.params.graphId);
    if (!provider) {
      return reply.status(503).send({ error: "AI provider is not configured; execution is unavailable." });
    }
    startBackgroundRun(req.params.graphId, req.body.workspaceRoot, provider, false);

    return reply.status(202).send({ message: "Run started", graphId: req.params.graphId });
  });

  app.post<{
    Params: { graphId: string };
    Body: { reason?: string };
  }>("/graphs/:graphId/pause", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "pause", reply)) return;
    const projection = await repo.getGraphProjection(req.params.graphId).catch(() => null);
    if (!projection) return reply.status(404).send({ error: "Not found" });
    if (!repo.withActorContext(projection, actor).capabilities?.canPause) {
      return reply.status(409).send({ error: "Pause is only available while a run is actively working." });
    }

    await recordAndBroadcast({
      graphId: req.params.graphId,
      kind: "run.pause_requested",
      payload: {
        reason: req.body.reason,
        actor,
      },
    });

    return reply.status(202).send({ message: "Pause requested" });
  });

  app.post<{
    Params: { graphId: string };
    Body: { reason?: string };
  }>("/graphs/:graphId/resume", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "resume", reply)) return;
    const projection = await repo.getGraphProjection(req.params.graphId).catch(() => null);
    if (!projection) return reply.status(404).send({ error: "Not found" });
    if (!repo.withActorContext(projection, actor).capabilities?.canResume) {
      return reply.status(409).send({ error: "Resume is only available for paused runs." });
    }
    if (activeRuns.has(req.params.graphId)) {
      return reply.status(409).send({ error: "Run already in progress" });
    }

    const workspaceRoot = await repo.getLatestRunWorkspaceRoot(req.params.graphId);
    if (!workspaceRoot) {
      return reply.status(409).send({ error: "Cannot resume because the original workspace root is unknown." });
    }

    await recordAndBroadcast({
      graphId: req.params.graphId,
      kind: "run.resume_requested",
      payload: {
        reason: req.body.reason,
        actor,
      },
    });

    const provider = createProvider(req, req.params.graphId);
    if (!provider) {
      return reply.status(503).send({ error: "AI provider is not configured; execution is unavailable." });
    }
    startBackgroundRun(req.params.graphId, workspaceRoot, provider, true);
    return reply.status(202).send({ message: "Run resumed" });
  });

  app.post<{
    Params: { graphId: string };
    Body: { reason?: string };
  }>("/graphs/:graphId/stop", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "stop", reply)) return;
    const projection = await repo.getGraphProjection(req.params.graphId).catch(() => null);
    if (!projection) return reply.status(404).send({ error: "Not found" });
    if (!repo.withActorContext(projection, actor).capabilities?.canStop) {
      return reply.status(409).send({ error: "Stop is only available for running or paused runs." });
    }

    await recordAndBroadcast({
      graphId: req.params.graphId,
      kind: "run.stop_requested",
      payload: {
        reason: req.body.reason,
        actor,
      },
    });

    if (projection.runControlState === "paused" && !activeRuns.has(req.params.graphId)) {
      await recordAndBroadcast({
        graphId: req.params.graphId,
        kind: "run.stopped",
        payload: {},
      });
    }

    return reply.status(202).send({ message: "Stop requested" });
  });

  app.post<{
    Params: { graphId: string };
    Body: { reason?: string };
  }>("/graphs/:graphId/review", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "request_review", reply)) return;
    const projection = await repo.getGraphProjection(req.params.graphId).catch(() => null);
    if (!projection) return reply.status(404).send({ error: "Not found" });

    await recordAndBroadcast({
      graphId: req.params.graphId,
      kind: "run.review_requested",
      payload: {
        reason: req.body.reason,
        actor,
      },
    });

    return reply.status(202).send({ message: "Run marked for review" });
  });

  app.post<{
    Params: { graphId: string };
    Body: AnnotationRequest;
  }>("/graphs/:graphId/annotations", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "annotate", reply)) return;
    const projection = await repo.getGraphProjection(req.params.graphId).catch(() => null);
    if (!projection) return reply.status(404).send({ error: "Not found" });
    if (!req.body.text?.trim()) {
      return reply.status(400).send({ error: "text is required" });
    }

    await recordAndBroadcast({
      graphId: req.params.graphId,
      kind: "run.annotated",
      payload: {
        annotationId: nanoid(),
        graphId: req.params.graphId,
        createdAt: new Date().toISOString(),
        authorLabel: actor.displayName,
        actor,
        text: req.body.text.trim(),
        kind: req.body.kind,
      },
    });

    return reply.status(201).send({ message: "Annotation added" });
  });

  app.post<{
    Params: { nodeId: string };
    Body: AnnotationRequest;
  }>("/nodes/:nodeId/annotations", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "annotate", reply)) return;
    const node = await repo.getNode(req.params.nodeId);
    if (!node) return reply.status(404).send({ error: "Not found" });
    if (!req.body.text?.trim()) {
      return reply.status(400).send({ error: "text is required" });
    }

    await recordAndBroadcast({
      graphId: node.graphId,
      kind: "node.annotated",
      nodeId: node.id,
      payload: {
        annotationId: nanoid(),
        graphId: node.graphId,
        nodeId: node.id,
        createdAt: new Date().toISOString(),
        authorLabel: actor.displayName,
        actor,
        text: req.body.text.trim(),
        kind: req.body.kind,
      },
    });

    return reply.status(201).send({ message: "Annotation added" });
  });

  app.post<{
    Params: { graphId: string };
    Body: DecisionRequest;
  }>("/graphs/:graphId/approval-request", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "request_approval", reply)) return;
    const projection = await repo.getGraphProjection(req.params.graphId).catch(() => null);
    if (!projection) return reply.status(404).send({ error: "Not found" });

    await recordAndBroadcast({
      graphId: req.params.graphId,
      kind: "run.approval_requested",
      payload: {
        decisionId: nanoid(),
        graphId: req.params.graphId,
        createdAt: new Date().toISOString(),
        authorLabel: actor.displayName,
        actor,
        reason: req.body.reason?.trim(),
      },
    });

    return reply.status(202).send({ message: "Approval requested" });
  });

  app.post<{
    Params: { graphId: string };
    Body: DecisionRequest;
  }>("/graphs/:graphId/approve", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "approve", reply)) return;
    const projection = await repo.getGraphProjection(req.params.graphId).catch(() => null);
    if (!projection) return reply.status(404).send({ error: "Not found" });

    await recordAndBroadcast({
      graphId: req.params.graphId,
      kind: "run.approved",
      payload: {
        decisionId: nanoid(),
        graphId: req.params.graphId,
        createdAt: new Date().toISOString(),
        authorLabel: actor.displayName,
        actor,
        reason: req.body.reason?.trim(),
      },
    });

    if (!activeRuns.has(req.params.graphId)) {
      const workspaceRoot = await repo.getLatestRunWorkspaceRoot(req.params.graphId);
      const provider = createProvider(req, req.params.graphId);
      if (workspaceRoot && provider) {
        startBackgroundRun(req.params.graphId, workspaceRoot, provider, true);
      }
    }

    return reply.status(202).send({ message: "Run approved" });
  });

  app.post<{
    Params: { graphId: string };
    Body: DecisionRequest;
  }>("/graphs/:graphId/reject", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "reject", reply)) return;
    const projection = await repo.getGraphProjection(req.params.graphId).catch(() => null);
    if (!projection) return reply.status(404).send({ error: "Not found" });

    await recordAndBroadcast({
      graphId: req.params.graphId,
      kind: "run.rejected",
      payload: {
        decisionId: nanoid(),
        graphId: req.params.graphId,
        createdAt: new Date().toISOString(),
        authorLabel: actor.displayName,
        actor,
        reason: req.body.reason?.trim(),
      },
    });

    return reply.status(202).send({ message: "Run rejected" });
  });

  app.post<{
    Params: { graphId: string };
    Body: DecisionRequest;
  }>("/graphs/:graphId/continue", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "continue", reply)) return;
    const projection = await repo.getGraphProjection(req.params.graphId).catch(() => null);
    if (!projection) return reply.status(404).send({ error: "Not found" });

    await recordAndBroadcast({
      graphId: req.params.graphId,
      kind: "run.continue_requested",
      payload: {
        decisionId: nanoid(),
        graphId: req.params.graphId,
        createdAt: new Date().toISOString(),
        authorLabel: actor.displayName,
        actor,
        reason: req.body.reason?.trim(),
      },
    });

    if (!activeRuns.has(req.params.graphId)) {
      const workspaceRoot = await repo.getLatestRunWorkspaceRoot(req.params.graphId);
      const provider = createProvider(req, req.params.graphId);
      if (workspaceRoot && provider) {
        startBackgroundRun(req.params.graphId, workspaceRoot, provider, true);
      }
    }

    return reply.status(202).send({ message: "Run continue requested" });
  });

  app.get<{ Params: { graphId: string } }>("/graphs/:graphId/events", async (req, reply) => {
    const graphId = req.params.graphId;
    const corsOrigin = eventStreamCorsOrigin(req.headers.origin);

    const streamHeaders: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    };
    if (corsOrigin) {
      streamHeaders["Access-Control-Allow-Origin"] = corsOrigin;
      streamHeaders.Vary = "Origin";
    }

    reply.raw.writeHead(200, streamHeaders);
    reply.raw.write(": connected\n\n");

    const pastEvents = await repo.getGraphEvents(graphId);
    for (const event of pastEvents) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const handler = (event: GraphEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    if (!subscribers.has(graphId)) subscribers.set(graphId, new Set());
    subscribers.get(graphId)!.add(handler);

    const ping = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15000);

    req.raw.on("close", () => {
      clearInterval(ping);
      subscribers.get(graphId)?.delete(handler);
    });
  });

  app.post<{
    Params: { nodeId: string };
    Body: { reason?: string };
  }>("/nodes/:nodeId/retry", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "manage_product_graph", reply)) return;

    const node = await repo.getNode(req.params.nodeId);
    if (!node) return reply.status(404).send({ error: "Not found" });

    await recordAndBroadcast({
      graphId: node.graphId,
      kind: "node.planned",
      nodeId: `${node.id}-retry-${Date.now()}`,
      payload: {
        kind: "revision",
        title: `${node.title} (manual retry)`,
        intent: `Retry ${node.title}. Reason: ${req.body.reason ?? "manual retry"}`,
        inputContext: node.output,
        humanSummary: `Manual retry of ${node.title}`,
        contract: node.contract,
        parentNodeId: node.id,
        branchId: node.branchId,
        baselineGoalVersionId: node.baselineGoalVersionId,
        activeGoalVersionId: node.activeGoalVersionId,
        dependsOnNodeIds: [...node.dependsOnNodeIds],
        coordinates: node.coordinates,
      },
    });

    return { message: "Revision node planned", nodeId: req.params.nodeId };
  });

  app.post<{
    Params: { nodeId: string };
    Body: {
      newGoal: string;
      reason: string;
      successCriteria?: string[];
      forbiddenScope?: string[];
    };
  }>("/nodes/:nodeId/replan", async (req, reply) => {
    const actor = requireActor(req, reply);
    if (!actor) return;
    if (!ensurePermission(req, actor, "manage_product_graph", reply)) return;

    const node = await repo.getNode(req.params.nodeId);
    if (!node) return reply.status(404).send({ error: "Not found" });

    const projection = await repo.getGraphProjection(node.graphId);
    const provider = createProvider(req, node.graphId);
    const goalPacket = provider
      ? await provider.buildGoalPacket({
          goal: req.body.newGoal,
          successCriteria: req.body.successCriteria ?? [],
          forbiddenScope: req.body.forbiddenScope ?? [],
          version: projection.goalPackets.length + 1,
        })
      : {
          id: `${node.graphId}-goal-${Date.now()}`,
          version: projection.goalPackets.length + 1,
          originalText: req.body.newGoal,
          successCriteria: req.body.successCriteria ?? [],
          forbiddenScope: req.body.forbiddenScope ?? [],
          embedding: [],
          criteriaEmbeddings: [],
          createdAt: new Date().toISOString(),
        };

    await recordAndBroadcast({
      graphId: node.graphId,
      kind: "goal.version_created",
      goalVersionId: goalPacket.id,
      payload: {
        graphTitle: projection.graph.title,
        goal: req.body.newGoal,
        constraints: projection.graph.constraints,
        goalPacket,
        activate: true,
      },
    });

    await recordAndBroadcast({
      graphId: node.graphId,
      kind: "replan.branched",
      nodeId: node.id,
      goalVersionId: goalPacket.id,
      payload: {
        branchId: `manual-replan-${Date.now()}`,
        sourceNodeId: node.id,
        newGoalVersionId: goalPacket.id,
        reason: req.body.reason,
      },
    });

    return reply.status(201).send({ goalVersionId: goalPacket.id });
  });
}
