import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type { DiagnosticsCheck, DiagnosticsResponse } from "@openagentgraph/shared";
import { buildAuthSession, canActorPerform, permissionMessage, resolveAuth } from "./auth/actors.js";
import { graphRoutes } from "./routes/graphs.js";
import { productGraphRoutes } from "./routes/productGraph.js";
import { projectGraphRoutes } from "./routes/projectGraph.js";
import { registerScanPostBodyTolerance } from "./routes/scanPostBody.js";
import { getDatabaseDiagnostics, initDb } from "./db/client.js";
import {
  AI_PROVIDER_SETUP_DETAILS,
  AI_PROVIDER_UNCONFIGURED_MESSAGE,
  CONFIGURED_PROVIDER_MODES,
  DEFAULT_PROVIDER_BASE_URLS,
  DEFAULT_PROVIDER_MODELS,
  PROVIDER_DISPLAY_NAMES,
  buildStartupSummary,
  getAppConfig,
  loadAppConfig,
  normalizeProviderBaseUrl,
  setAppConfigOverride,
  type AppConfig,
  type ConfiguredProviderMode,
  type ProviderMode,
  validateStartupConfig,
} from "./config.js";
import { logDiagnostic } from "./observability/logger.js";
import { incrementFailureMetric, incrementMetric, observeDuration, renderMetricsText, routeGroup, statusClass, syncDiagnosticsMetrics } from "./observability/metrics.js";
import { initOpenTelemetryExporter } from "./observability/otel.js";

const providerConfigSchema = z.object({
  provider: z.enum(CONFIGURED_PROVIDER_MODES),
  apiKey: z.string().trim().max(4096, "API key is too long.").optional(),
  model: z.string().trim().min(1, "Model is required.").max(120, "Model name is too long.").optional(),
  baseUrl: z.string().trim().max(300, "Base URL is too long.").optional(),
}).superRefine((value, context) => {
  const hostedProvider = value.provider === "openai" || value.provider === "gemini" || value.provider === "anthropic";
  if (hostedProvider) {
    if (!value.apiKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKey"],
        message: `${PROVIDER_DISPLAY_NAMES[value.provider]} API key is required for this provider.`,
      });
      return;
    }
    if (value.apiKey.length < 8 || /[\s\x00-\x1F\x7F]/.test(value.apiKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKey"],
        message: `${PROVIDER_DISPLAY_NAMES[value.provider]} API key contains unsupported characters.`,
      });
    }
  }

  if (value.apiKey && /[\s\x00-\x1F\x7F]/.test(value.apiKey)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiKey"],
      message: "API key contains unsupported characters.",
    });
  }

  if (value.provider === "ollama" || value.provider === "openai-compatible") {
    if (!value.model) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model"],
        message: `${PROVIDER_DISPLAY_NAMES[value.provider]} model is required.`,
      });
    }
  }

  if (value.provider === "openai-compatible" && !value.baseUrl) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["baseUrl"],
      message: "OpenAI-compatible base URL is required.",
    });
  }

  if (value.baseUrl || value.provider === "ollama" || value.provider === "gemini" || value.provider === "anthropic") {
    if (!normalizeRuntimeProviderBaseUrl(value.provider, value.baseUrl)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseUrl"],
        message: "Base URL must be a valid http/https URL without credentials; http is allowed only for localhost or loopback addresses.",
      });
    }
  }
});

function normalizeRuntimeProviderBaseUrl(provider: ConfiguredProviderMode, raw: string | undefined): string | undefined {
  if (provider === "openai") return raw ? normalizeRuntimeBaseUrl(raw) : undefined;
  return normalizeRuntimeBaseUrl(raw, DEFAULT_PROVIDER_BASE_URLS[provider], { localOnly: provider === "ollama" });
}

function normalizeRuntimeBaseUrl(
  raw: string | undefined,
  defaultValue?: string,
  options: { localOnly?: boolean } = {}
): string | undefined {
  const input = raw?.trim() || defaultValue;
  if (!input) return undefined;
  try {
    return normalizeProviderBaseUrl(input, "OPENAGENTGRAPH_AI_BASE_URL", undefined, options);
  } catch {
    return undefined;
  }
}

function buildCorsOriginPolicy(config: AppConfig): string[] {
  const allowedOrigins = new Set<string>(config.frontend.allowedOrigins);

  if (config.frontend.publicBaseUrl) {
    allowedOrigins.add(new URL(config.frontend.publicBaseUrl).origin);
  }

  if (!config.env.isProduction && allowedOrigins.size === 0) {
    allowedOrigins.add("http://localhost:5173");
    allowedOrigins.add("http://127.0.0.1:5173");
  }

  return [...allowedOrigins];
}

function buildCorsOriginResolver(config: AppConfig) {
  const allowedOrigins = buildCorsOriginPolicy(config);
  return (origin: string | undefined, callback: (error: Error | null, allow: boolean) => void) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  };
}

function buildHealthResponse(): DiagnosticsResponse {
  return {
    status: "ok",
    checks: {
      service: {
        status: "ok",
        message: "Backend process is running.",
      },
    },
    timestamp: new Date().toISOString(),
  };
}

function providerDisplayName(mode: ProviderMode): string {
  if (mode !== "unset") return PROVIDER_DISPLAY_NAMES[mode];
  return "AI";
}

function buildProviderReadinessCheck(config: AppConfig): DiagnosticsCheck {
  if (config.provider.configured) {
    const providerName = providerDisplayName(config.provider.mode);
    const modelSuffix = config.provider.model ? ` (${config.provider.model})` : "";
    return {
      status: "ok",
      message:
        config.provider.source === "runtime"
          ? `${providerName} provider is configured for this backend process${modelSuffix}.`
          : `${providerName} provider is configured${modelSuffix}.`,
    };
  }

  return {
    status: "degraded",
    message: AI_PROVIDER_UNCONFIGURED_MESSAGE,
    details: [...AI_PROVIDER_SETUP_DETAILS],
  };
}

function requireProviderSetupActor(
  request: Parameters<typeof resolveAuth>[0],
  reply: { status: (code: number) => { send: (body: unknown) => unknown } }
) {
  const resolution = resolveAuth(request);
  if (!resolution.actor) {
    reply.status(401).send({ error: resolution.message });
    return undefined;
  }

  if (!canActorPerform(resolution.actor, "manage_product_graph")) {
    reply.status(403).send({ error: permissionMessage("manage_product_graph") });
    return undefined;
  }

  return resolution.actor;
}

function safeProviderStatus(config = getAppConfig()) {
  return {
    configured: config.provider.configured,
    provider: config.provider.mode,
    source: config.provider.source,
    model: config.provider.configured ? config.provider.model : undefined,
    baseUrl: config.provider.baseUrl,
    message: buildProviderReadinessCheck(config).message,
  };
}

function formatLimitBytes(value: number) {
  if (value >= 1024 * 1024) return `${Math.round(value / (1024 * 1024))}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

function scannerLimitDetails(config: AppConfig) {
  const lightweight = config.scanner.scanLimits;
  const semantic = config.scanner.semanticScanLimits;
  return [
    `Lightweight: ${lightweight.maxFiles} files, ${formatLimitBytes(lightweight.maxTotalBytes)} total, ${formatLimitBytes(lightweight.maxFileBytes)} per file, depth ${lightweight.maxDepth}, ${lightweight.maxDurationMs}ms.`,
    `Semantic: ${semantic.maxFiles} files, ${formatLimitBytes(semantic.maxTotalBytes)} total, ${formatLimitBytes(semantic.maxFileBytes)} per file, depth ${semantic.maxDepth}, ${semantic.maxDurationMs}ms.`,
  ];
}

export function buildReadyResponse(config: AppConfig): DiagnosticsResponse {
  const startup = validateStartupConfig(config);
  const database = getDatabaseDiagnostics();
  const workspaceConfigured = Boolean(config.workspace.root);
  const workspaceMessage = workspaceConfigured
    ? startup.warnings.includes("Workspace root is invalid; execution features are unavailable.")
      ? "Workspace root is invalid; execution features are unavailable."
      : "Workspace root is configured."
    : "Workspace root is optional and not configured.";
  const frontendMessage =
    config.frontend.allowedOrigins.length > 0
      ? config.frontend.allowedOrigins.includes("*")
        ? "Frontend origin policy allows every configured browser origin."
        : "Frontend origin policy is configured for cross-origin browser access."
      : config.frontend.publicBaseUrl
        ? "Frontend runtime is expected to connect through the backend public base URL."
        : config.env.isProduction
          ? "Frontend origin policy is not configured for production deployments."
          : "Frontend origin policy uses local development defaults.";

  const checks: DiagnosticsResponse["checks"] = {
    database: {
      status: database.initialized ? "ok" : "error",
      message: database.initialized
        ? "Database schema is initialized."
        : "Database schema is not initialized.",
    },
    provider: buildProviderReadinessCheck(config),
    workspace: {
      status: startup.warnings.includes("Workspace root is invalid; execution features are unavailable.")
        ? "degraded"
        : "ok",
      message: workspaceMessage,
    },
    frontend: {
      status:
        startup.warnings.includes("Frontend origin policy is not configured for production deployments.") ||
        startup.warnings.includes("CORS is configured to allow every origin in production.")
          ? "degraded"
          : "ok",
      message: frontendMessage,
    },
    auth: {
      status:
        config.auth.mode === "jwt"
          ? config.auth.jwtSecret
            ? "ok"
            : "error"
          : config.env.isProduction && config.auth.allowActorHeaders
            ? config.auth.unsafeDevAuthOptIn
              ? "degraded"
              : "error"
            : "ok",
      message:
        config.auth.mode === "jwt"
          ? config.auth.jwtSecret
            ? "JWT auth mode is configured safely."
            : "JWT auth mode is missing its verification secret."
          : config.env.isProduction && config.auth.allowActorHeaders
            ? config.auth.unsafeDevAuthOptIn
              ? "Development actor-header auth is explicitly enabled in production."
              : "Development actor-header auth is enabled in production without explicit opt-in."
            : "Actor auth mode is configured safely.",
    },
    scanner: {
      status: "ok",
      message: "Scanner emergency breakers are configured.",
      details: scannerLimitDetails(config),
    },
  };

  const status = Object.values(checks).some((check) => check.status === "error")
    ? "error"
    : Object.values(checks).some((check) => check.status === "degraded")
      ? "degraded"
      : "ok";

  return {
    status,
    checks,
    timestamp: new Date().toISOString(),
  };
}

export async function buildApp(config = getAppConfig()) {
  setAppConfigOverride(config);
  initDb();
  initOpenTelemetryExporter(config);

  const app = Fastify();
  registerScanPostBodyTolerance(app);
  await app.register(cors, {
    origin: buildCorsOriginResolver(config),
  });

  app.addHook("onRequest", async (request, reply) => {
    (request as typeof request & { openagentgraphStartedAt?: bigint }).openagentgraphStartedAt = process.hrtime.bigint();
    reply.header("x-request-id", request.id);
    logDiagnostic({
      level: "info",
      component: "http.request",
      message: `${request.method} ${request.url}`,
      requestId: request.id,
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = (request as typeof request & { openagentgraphStartedAt?: bigint }).openagentgraphStartedAt;
    const durationMs = startedAt ? Number(process.hrtime.bigint() - startedAt) / 1_000_000 : 0;
    const durationLabels = {
      method: request.method,
      route_group: routeGroup(request.routeOptions?.url, request.url),
      status_class: statusClass(reply.statusCode),
    };
    incrementMetric(
      "openagentgraph_http_requests_total",
      "Total completed HTTP requests.",
      undefined,
      1
    );
    incrementMetric(
      "openagentgraph_http_requests_by_route_total",
      "Completed HTTP requests by method, route group, and status class.",
      {
        method: request.method,
        route_group: routeGroup(request.routeOptions?.url, request.url),
        status_class: statusClass(reply.statusCode),
      },
      1
    );
    observeDuration(
      "openagentgraph_http_request_duration_ms",
      "HTTP request handling duration.",
      durationMs,
      durationLabels
    );
  });

  app.get("/health", async () => buildHealthResponse());
  app.get("/ready", async () => buildReadyResponse(getAppConfig()));
  app.get("/auth/session", async (request, reply) => {
    const session = buildAuthSession(request);
    if (session.status === "invalid" || session.status === "expired") {
      return reply.status(401).send(session);
    }
    return session;
  });
  app.get("/provider/config", async (request, reply) => {
    const actor = requireProviderSetupActor(request, reply);
    if (!actor) return;
    return safeProviderStatus();
  });
  app.post("/provider/config", async (request, reply) => {
    const actor = requireProviderSetupActor(request, reply);
    if (!actor) return;

    const parsed = providerConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message ?? "Provider configuration is invalid.",
      });
    }

    const current = getAppConfig();
    const provider = parsed.data.provider;
    const model = parsed.data.model?.trim() || DEFAULT_PROVIDER_MODELS[provider];
    const baseUrl = normalizeRuntimeProviderBaseUrl(provider, parsed.data.baseUrl);
    const apiKey = provider === "ollama" ? undefined : parsed.data.apiKey?.trim() || undefined;
    setAppConfigOverride({
      ...current,
      provider: {
        mode: provider,
        configured: true,
        model,
        baseUrl,
        apiKey,
        embeddingModel: undefined,
        source: "runtime",
      },
    });
    logDiagnostic({
      level: "info",
      component: "provider.setup",
      message: `${providerDisplayName(provider)} provider was configured for this backend process.`,
      actorId: actor.actorId,
      safeMetadata: {
        provider,
        model,
        source: "runtime",
      },
    });

    return reply.status(200).send(safeProviderStatus());
  });
  app.delete("/provider/config", async (request, reply) => {
    const actor = requireProviderSetupActor(request, reply);
    if (!actor) return;

    const envConfig = loadAppConfig(process.env);
    const current = getAppConfig();
    setAppConfigOverride({
      ...current,
      provider: envConfig.provider,
    });
    logDiagnostic({
      level: "info",
      component: "provider.setup",
      message: "Runtime provider configuration was cleared.",
      actorId: actor.actorId,
    });

    return reply.status(200).send(safeProviderStatus());
  });
  app.get("/metrics", async (_request, reply) => {
    const ready = buildReadyResponse(getAppConfig());
    syncDiagnosticsMetrics(ready);
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return renderMetricsText();
  });

  await app.register(graphRoutes);
  await app.register(productGraphRoutes);
  await app.register(projectGraphRoutes);

  return app;
}

export function logStartupDiagnostics(config = getAppConfig()) {
  const startup = validateStartupConfig(config);
  const summary = buildStartupSummary(config);
  logDiagnostic({
    level: "info",
    component: "startup",
    message: summary.summaryLine,
    safeMetadata: {
      degraded: summary.degraded,
      environmentMode: summary.environmentMode,
      authMode: summary.authMode,
      workspaceStatus: summary.workspaceStatus,
      providerStatus: summary.providerStatus,
      frontendStatus: summary.frontendStatus,
    },
  });
  if (summary.degraded) {
    incrementFailureMetric("startup_degraded", "startup", startup.errors.length > 0 ? "hard" : "recovered");
    logDiagnostic({
      level: startup.errors.length > 0 ? "error" : "warn",
      component: "startup",
      message: "Startup is running with degraded or invalid configuration.",
      errorCode: startup.errors.length > 0 ? "STARTUP_DEGRADED_ERROR" : "STARTUP_DEGRADED_WARNING",
    });
  }
  for (const warning of startup.warnings) {
    if (warning === "Workspace root is invalid; execution features are unavailable.") {
      incrementFailureMetric("workspace_invalid", "startup", "recovered");
    }
    logDiagnostic({
      level: "warn",
      component: "startup",
      message: warning,
      errorCode: "STARTUP_WARNING",
    });
  }
  for (const error of startup.errors) {
    logDiagnostic({
      level: "error",
      component: "startup",
      message: error,
      errorCode: "STARTUP_CONFIG_INVALID",
    });
  }
  return startup;
}
