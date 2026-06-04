import fs from "fs";
import path from "path";
import { z } from "zod";
import type { ScanBreakerLimits } from "@openagentgraph/shared";
import type { ActorIdentity, AuthMode, LogLevel } from "@openagentgraph/shared";
import {
  DEFAULT_LIGHTWEIGHT_SCAN_LIMITS,
  DEFAULT_SEMANTIC_SCAN_LIMITS,
} from "./scanner/scanProgress.js";

export const CONFIGURED_PROVIDER_MODES = [
  "openai",
  "ollama",
  "gemini",
  "anthropic",
  "openai-compatible",
] as const;
export type ConfiguredProviderMode = typeof CONFIGURED_PROVIDER_MODES[number];
export type ProviderMode = ConfiguredProviderMode | "unset";
export type ProviderSource = "environment" | "runtime" | "unset";

export const DEFAULT_PROVIDER_MODELS: Record<ConfiguredProviderMode, string> = {
  openai: "gpt-4o",
  ollama: "llama3.2",
  gemini: "gemini-3.5-flash",
  anthropic: "claude-sonnet-4-6",
  "openai-compatible": "",
};

export const DEFAULT_PROVIDER_BASE_URLS: Partial<Record<ConfiguredProviderMode, string>> = {
  ollama: "http://localhost:11434/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  anthropic: "https://api.anthropic.com/v1",
};

export const PROVIDER_DISPLAY_NAMES: Record<ConfiguredProviderMode, string> = {
  openai: "OpenAI",
  ollama: "Ollama",
  gemini: "Gemini",
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI-compatible",
};

export interface ConfigEnvSpec {
  key: string;
  category: "required" | "optional" | "dev_only";
  description: string;
  example: string;
}

const actorRoleSchema = z.enum(["viewer", "operator", "reviewer", "admin"]);
const actorSchema = z.object({
  actorId: z.string().min(1),
  displayName: z.string().min(1),
  role: actorRoleSchema,
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().optional(),
  DATA_DIR: z.string().optional(),
  OPENAGENTGRAPH_PUBLIC_BASE_URL: z.string().optional(),
  OPENAGENTGRAPH_ALLOWED_ORIGINS: z.string().optional(),
  OPENAGENTGRAPH_AI_PROVIDER: z.enum(CONFIGURED_PROVIDER_MODES).optional(),
  OPENAGENTGRAPH_AI_MODEL: z.string().optional(),
  OPENAGENTGRAPH_AI_BASE_URL: z.string().optional(),
  OPENAGENTGRAPH_AI_API_KEY: z.string().optional(),
  OPENAGENTGRAPH_AI_EMBEDDING_MODEL: z.string().optional(),
  OPENAGENTGRAPH_OLLAMA_BASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAGENTGRAPH_WORKSPACE_ROOT: z.string().optional(),
  OPENAGENTGRAPH_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  OPENAGENTGRAPH_AUTH_MODE: z.enum(["dev_header", "jwt"]).optional(),
  OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: z.enum(["true", "false"]).optional(),
  OPENAGENTGRAPH_ALLOW_UNSAFE_DEV_AUTH_IN_PRODUCTION: z.enum(["true", "false"]).optional(),
  OPENAGENTGRAPH_ACTORS: z.string().optional(),
  OPENAGENTGRAPH_JWT_SECRET: z.string().optional(),
  OPENAGENTGRAPH_AUTH_OPERATOR_EMAILS: z.string().optional(),
  OPENAGENTGRAPH_AUTH_REVIEWER_EMAILS: z.string().optional(),
  OPENAGENTGRAPH_AUTH_ADMIN_EMAILS: z.string().optional(),
  OPENAGENTGRAPH_AUTH_OPERATOR_DOMAINS: z.string().optional(),
  OPENAGENTGRAPH_AUTH_REVIEWER_DOMAINS: z.string().optional(),
  OPENAGENTGRAPH_AUTH_ADMIN_DOMAINS: z.string().optional(),
  OPENAGENTGRAPH_OTEL_ENABLED: z.enum(["true", "false"]).optional(),
  OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  OPENAGENTGRAPH_SAMPLING_ENABLED: z.enum(["true", "false"]).optional(),
  OPENAGENTGRAPH_SAMPLING_HEALTHY_DURATION_MS: z.string().optional(),
  OPENAGENTGRAPH_SCAN_MAX_FILES: z.string().optional(),
  OPENAGENTGRAPH_SCAN_MAX_TOTAL_BYTES: z.string().optional(),
  OPENAGENTGRAPH_SCAN_MAX_FILE_BYTES: z.string().optional(),
  OPENAGENTGRAPH_SCAN_MAX_DEPTH: z.string().optional(),
  OPENAGENTGRAPH_SCAN_MAX_DURATION_MS: z.string().optional(),
  OPENAGENTGRAPH_SEMANTIC_MAX_FILES: z.string().optional(),
  OPENAGENTGRAPH_SEMANTIC_MAX_TOTAL_BYTES: z.string().optional(),
  OPENAGENTGRAPH_SEMANTIC_MAX_FILE_BYTES: z.string().optional(),
  OPENAGENTGRAPH_SEMANTIC_MAX_DEPTH: z.string().optional(),
  OPENAGENTGRAPH_SEMANTIC_MAX_DURATION_MS: z.string().optional(),
  OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_FILES: z.string().optional(),
  OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_TOTAL_BYTES: z.string().optional(),
  OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_DURATION_MS: z.string().optional(),
});

export const CONFIG_ENV_SPECS: ConfigEnvSpec[] = [
  {
    key: "NODE_ENV",
    category: "optional",
    description: "Runtime mode for startup validation and auth safety rules.",
    example: "development",
  },
  {
    key: "PORT",
    category: "optional",
    description: "Backend HTTP port.",
    example: "3001",
  },
  {
    key: "DATA_DIR",
    category: "optional",
    description: "Directory used for the SQLite database file.",
    example: "./data",
  },
  {
    key: "OPENAGENTGRAPH_PUBLIC_BASE_URL",
    category: "optional",
    description: "Public backend base URL used for diagnostics and same-origin deployment checks.",
    example: "https://openagentgraph.example.com",
  },
  {
    key: "OPENAGENTGRAPH_ALLOWED_ORIGINS",
    category: "optional",
    description: "Comma-separated frontend origins allowed by CORS for browser clients.",
    example: "https://app.example.com,https://staging.example.com",
  },
  {
    key: "OPENAGENTGRAPH_AI_PROVIDER",
    category: "optional",
    description: "AI provider for goal execution: ollama, openai, gemini, anthropic, or openai-compatible.",
    example: "ollama",
  },
  {
    key: "OPENAGENTGRAPH_AI_MODEL",
    category: "optional",
    description: "Chat/generation model used by the configured AI provider.",
    example: "llama3.2",
  },
  {
    key: "OPENAGENTGRAPH_AI_BASE_URL",
    category: "optional",
    description: "OpenAI-compatible base URL for custom providers or hosted compatibility endpoints.",
    example: "https://api.example.com/v1",
  },
  {
    key: "OPENAGENTGRAPH_AI_API_KEY",
    category: "optional",
    description: "Generic provider key used before provider-specific key fallbacks.",
    example: "replace-with-provider-key",
  },
  {
    key: "OPENAGENTGRAPH_AI_EMBEDDING_MODEL",
    category: "optional",
    description: "Optional embedding model. Gemini, Anthropic, and custom providers use deterministic retrieval fallback unless this is set.",
    example: "text-embedding-3-large",
  },
  {
    key: "OPENAGENTGRAPH_OLLAMA_BASE_URL",
    category: "optional",
    description: "Ollama OpenAI-compatible base URL.",
    example: "http://localhost:11434/v1",
  },
  {
    key: "OPENAI_API_KEY",
    category: "optional",
    description: "OpenAI provider key used when OPENAGENTGRAPH_AI_PROVIDER=openai and OPENAGENTGRAPH_AI_API_KEY is unset.",
    example: "sk-your-openai-key",
  },
  {
    key: "GEMINI_API_KEY",
    category: "optional",
    description: "Gemini provider key used when OPENAGENTGRAPH_AI_PROVIDER=gemini and OPENAGENTGRAPH_AI_API_KEY is unset.",
    example: "replace-with-gemini-key",
  },
  {
    key: "ANTHROPIC_API_KEY",
    category: "optional",
    description: "Anthropic provider key used when OPENAGENTGRAPH_AI_PROVIDER=anthropic and OPENAGENTGRAPH_AI_API_KEY is unset.",
    example: "replace-with-anthropic-key",
  },
  {
    key: "OPENAGENTGRAPH_WORKSPACE_ROOT",
    category: "optional",
    description: "Optional workspace root used for execution features.",
    example: "./workspace",
  },
  {
    key: "OPENAGENTGRAPH_LOG_LEVEL",
    category: "optional",
    description: "Structured log level.",
    example: "info",
  },
  {
    key: "OPENAGENTGRAPH_AUTH_MODE",
    category: "optional",
    description: "Authentication mode: dev_header for local actor shims or jwt for verified bearer tokens.",
    example: "jwt",
  },
  {
    key: "OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS",
    category: "dev_only",
    description: "Development-only actor header shim. Disable in production.",
    example: "true",
  },
  {
    key: "OPENAGENTGRAPH_ALLOW_UNSAFE_DEV_AUTH_IN_PRODUCTION",
    category: "dev_only",
    description: "Explicit production opt-in for actor header auth. Unsafe outside local testing.",
    example: "false",
  },
  {
    key: "OPENAGENTGRAPH_ACTORS",
    category: "optional",
    description: "JSON array of actor definitions for viewer/operator/reviewer/admin identities.",
    example: "[{\"actorId\":\"operator\",\"displayName\":\"Operator\",\"role\":\"operator\"}]",
  },
  {
    key: "OPENAGENTGRAPH_JWT_SECRET",
    category: "required",
    description: "Shared secret for verifying HS256 bearer JWTs when OPENAGENTGRAPH_AUTH_MODE=jwt.",
    example: "replace-with-a-long-random-secret",
  },
  {
    key: "OPENAGENTGRAPH_AUTH_OPERATOR_EMAILS",
    category: "optional",
    description: "Comma-separated emails that should map to operator access when no valid role claim is present.",
    example: "operator@example.com",
  },
  {
    key: "OPENAGENTGRAPH_AUTH_REVIEWER_EMAILS",
    category: "optional",
    description: "Comma-separated emails that should map to reviewer access when no valid role claim is present.",
    example: "reviewer@example.com",
  },
  {
    key: "OPENAGENTGRAPH_AUTH_ADMIN_EMAILS",
    category: "optional",
    description: "Comma-separated emails that should map to admin access when no valid role claim is present.",
    example: "admin@example.com",
  },
  {
    key: "OPENAGENTGRAPH_AUTH_OPERATOR_DOMAINS",
    category: "optional",
    description: "Comma-separated email domains that should map to operator access when no valid role claim is present.",
    example: "ops.example.com",
  },
  {
    key: "OPENAGENTGRAPH_AUTH_REVIEWER_DOMAINS",
    category: "optional",
    description: "Comma-separated email domains that should map to reviewer access when no valid role claim is present.",
    example: "review.example.com",
  },
  {
    key: "OPENAGENTGRAPH_AUTH_ADMIN_DOMAINS",
    category: "optional",
    description: "Comma-separated email domains that should map to admin access when no valid role claim is present.",
    example: "admin.example.com",
  },
  {
    key: "OPENAGENTGRAPH_OTEL_ENABLED",
    category: "optional",
    description: "Enables optional OpenTelemetry/OpenInference trace export for committed OpenAgentGraph events.",
    example: "false",
  },
  {
    key: "OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT",
    category: "optional",
    description: "OTLP HTTP collector endpoint or base URL used when OpenTelemetry export is enabled.",
    example: "https://otel-collector.example.com/v1/traces",
  },
  {
    key: "OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_HEADERS",
    category: "optional",
    description: "Comma-separated OTLP HTTP headers as key=value pairs for collector authentication.",
    example: "x-api-key=replace-with-collector-key",
  },
  {
    key: "OPENAGENTGRAPH_SAMPLING_ENABLED",
    category: "optional",
    description: "Enables tail-based compaction of heavy evidence payload fields for healthy completions.",
    example: "true",
  },
  {
    key: "OPENAGENTGRAPH_SAMPLING_HEALTHY_DURATION_MS",
    category: "optional",
    description: "Latency threshold below which successful node completions are considered healthy for compaction.",
    example: "800",
  },
  {
    key: "OPENAGENTGRAPH_SCAN_MAX_FILES",
    category: "optional",
    description: "Emergency breaker for deterministic lightweight scanner file count.",
    example: "20000",
  },
  {
    key: "OPENAGENTGRAPH_SCAN_MAX_TOTAL_BYTES",
    category: "optional",
    description: "Emergency breaker for total source bytes considered by lightweight scans.",
    example: "200000000",
  },
  {
    key: "OPENAGENTGRAPH_SCAN_MAX_FILE_BYTES",
    category: "optional",
    description: "Emergency breaker for a single source file considered by lightweight scans.",
    example: "5000000",
  },
  {
    key: "OPENAGENTGRAPH_SCAN_MAX_DEPTH",
    category: "optional",
    description: "Emergency breaker for recursive scanner directory depth.",
    example: "40",
  },
  {
    key: "OPENAGENTGRAPH_SCAN_MAX_DURATION_MS",
    category: "optional",
    description: "Emergency breaker for deterministic lightweight scan duration.",
    example: "180000",
  },
  {
    key: "OPENAGENTGRAPH_SEMANTIC_MAX_FILES",
    category: "optional",
    description: "Maximum scanned source files eligible for TypeScript semantic code intelligence.",
    example: "5000",
  },
  {
    key: "OPENAGENTGRAPH_SEMANTIC_MAX_TOTAL_BYTES",
    category: "optional",
    description: "Maximum scanned source bytes eligible for TypeScript semantic code intelligence.",
    example: "50000000",
  },
  {
    key: "OPENAGENTGRAPH_SEMANTIC_MAX_FILE_BYTES",
    category: "optional",
    description: "Emergency breaker for a single source file considered by semantic analysis.",
    example: "5000000",
  },
  {
    key: "OPENAGENTGRAPH_SEMANTIC_MAX_DEPTH",
    category: "optional",
    description: "Emergency breaker for semantic scanner directory depth.",
    example: "40",
  },
  {
    key: "OPENAGENTGRAPH_SEMANTIC_MAX_DURATION_MS",
    category: "optional",
    description: "Time budget for TypeScript semantic program setup during a codebase scan.",
    example: "30000",
  },
  {
    key: "OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_FILES",
    category: "optional",
    description: "Legacy alias for OPENAGENTGRAPH_SEMANTIC_MAX_FILES.",
    example: "5000",
  },
  {
    key: "OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_TOTAL_BYTES",
    category: "optional",
    description: "Legacy alias for OPENAGENTGRAPH_SEMANTIC_MAX_TOTAL_BYTES.",
    example: "50000000",
  },
  {
    key: "OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_DURATION_MS",
    category: "optional",
    description: "Legacy alias for OPENAGENTGRAPH_SEMANTIC_MAX_DURATION_MS.",
    example: "30000",
  },
];

export interface AppConfig {
  env: {
    nodeEnv: "development" | "test" | "production";
    isProduction: boolean;
    isTest: boolean;
  };
  server: {
    host: string;
    port: number;
  };
  database: {
    dataDir: string;
    filePath: string;
  };
  provider: {
    mode: ProviderMode;
    configured: boolean;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    embeddingModel?: string;
    source: ProviderSource;
  };
  workspace: {
    root?: string;
  };
  frontend: {
    publicBaseUrl?: string;
    allowedOrigins: string[];
  };
  auth: {
    mode: AuthMode;
    allowActorHeaders: boolean;
    unsafeDevAuthOptIn: boolean;
    useDefaultDevActors: boolean;
    configuredActors: Record<string, ActorIdentity>;
    jwtSecret?: string;
    roleMapping: {
      operatorEmails: string[];
      reviewerEmails: string[];
      adminEmails: string[];
      operatorDomains: string[];
      reviewerDomains: string[];
      adminDomains: string[];
    };
  };
  logging: {
    level: LogLevel;
  };
  telemetry: {
    openTelemetryEnabled: boolean;
    otlpEndpoint?: string;
    otlpHeaders: Record<string, string>;
  };
  sampling: {
    enabled: boolean;
    healthyDurationMs: number;
  };
  scanner: {
    scanLimits: ScanBreakerLimits;
    semanticScanLimits: ScanBreakerLimits;
    semanticAnalysisBudget: {
      maxFiles: number;
      maxTotalBytes: number;
      maxDurationMs: number;
    };
  };
}

export interface StartupValidationResult {
  errors: string[];
  warnings: string[];
}

export interface StartupSummary {
  environmentMode: string;
  authMode: string;
  workspaceStatus: string;
  databaseStatus: string;
  providerStatus: string;
  frontendStatus: string;
  degraded: boolean;
  summaryLine: string;
}

let configOverride: AppConfig | undefined;

const DEFAULT_ACTORS: Record<string, ActorIdentity> = {
  viewer: { actorId: "viewer", displayName: "Viewer", role: "viewer" },
  operator: { actorId: "operator", displayName: "Operator", role: "operator" },
  reviewer: { actorId: "reviewer", displayName: "Reviewer", role: "reviewer" },
  admin: { actorId: "admin", displayName: "Admin", role: "admin" },
};

export const AI_PROVIDER_UNCONFIGURED_MESSAGE = "AI provider is not configured; goal execution is unavailable.";
export const AI_PROVIDER_SETUP_DETAILS = [
  "Use Dashboard Provider setup to choose Ollama local, OpenAI, Gemini, Anthropic, or a custom OpenAI-compatible endpoint.",
  "Provider keys are kept only in backend process memory when pasted through the Dashboard.",
  "Graph scans, Project Graph, Code Map, and GRAPH_REPORT.md do not require any provider key.",
  "Ollama can run locally without an API key at http://localhost:11434/v1.",
  "Refresh provider status in OpenAgentGraph before starting the goal run.",
] as const;

function parseCsvList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function parseOptionalUrl(raw: string | undefined, key: string): string | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${key} must be a valid absolute URL.`);
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  const ipv4Parts = normalized.split(".");
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  ) {
    return ipv4Parts[0] === "127";
  }

  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4Parts = normalized.slice("::ffff:".length).split(".");
    return (
      mappedIpv4Parts.length === 4 &&
      mappedIpv4Parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255) &&
      mappedIpv4Parts[0] === "127"
    );
  }

  return false;
}

export function normalizeProviderBaseUrl(
  raw: string | undefined,
  key: string,
  defaultValue?: string,
  options: { localOnly?: boolean } = {}
): string | undefined {
  const parsed = parseOptionalUrl(raw ?? defaultValue, key);
  if (!parsed) return undefined;
  const url = new URL(parsed);
  if (url.username || url.password) {
    throw new Error(`${key} must not include credentials.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${key} must use http or https.`);
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error(`${key} can use http only for localhost or loopback addresses.`);
  }
  if (options.localOnly && !isLoopbackHostname(url.hostname)) {
    throw new Error(`${key} must use localhost or a loopback address.`);
  }
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/v1";
  }
  return url.toString().replace(/\/$/, "");
}

function providerKey(parsed: z.infer<typeof envSchema>, providerMode: ProviderMode): string | undefined {
  const genericKey = parsed.OPENAGENTGRAPH_AI_API_KEY?.trim();
  if (genericKey) return genericKey;
  if (providerMode === "openai") return parsed.OPENAI_API_KEY?.trim();
  if (providerMode === "gemini") return parsed.GEMINI_API_KEY?.trim();
  if (providerMode === "anthropic") return parsed.ANTHROPIC_API_KEY?.trim();
  return undefined;
}

function inferProviderMode(parsed: z.infer<typeof envSchema>): ProviderMode {
  if (parsed.OPENAGENTGRAPH_AI_PROVIDER) return parsed.OPENAGENTGRAPH_AI_PROVIDER;
  if (parsed.OPENAI_API_KEY) return "openai";
  if (parsed.GEMINI_API_KEY) return "gemini";
  if (parsed.ANTHROPIC_API_KEY) return "anthropic";
  return "unset";
}

function providerBaseUrl(parsed: z.infer<typeof envSchema>, providerMode: ProviderMode): string | undefined {
  if (providerMode === "unset" || providerMode === "openai") return undefined;
  const defaultValue = providerMode === "ollama"
    ? DEFAULT_PROVIDER_BASE_URLS.ollama
    : DEFAULT_PROVIDER_BASE_URLS[providerMode];
  const raw = providerMode === "ollama"
    ? parsed.OPENAGENTGRAPH_AI_BASE_URL ?? parsed.OPENAGENTGRAPH_OLLAMA_BASE_URL
    : parsed.OPENAGENTGRAPH_AI_BASE_URL;
  const key =
    providerMode === "ollama" && parsed.OPENAGENTGRAPH_AI_BASE_URL === undefined
      ? "OPENAGENTGRAPH_OLLAMA_BASE_URL"
      : "OPENAGENTGRAPH_AI_BASE_URL";
  return normalizeProviderBaseUrl(raw, key, defaultValue, { localOnly: providerMode === "ollama" });
}

function providerIsConfigured(input: {
  providerMode: ProviderMode;
  apiKey?: string;
  baseUrl?: string;
  model: string;
}) {
  if (input.providerMode === "unset") return false;
  if (input.providerMode === "ollama") return Boolean(input.model);
  if (input.providerMode === "openai-compatible") return Boolean(input.model && input.baseUrl);
  return Boolean(input.apiKey && input.model);
}

function parseOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))].map((value) => {
    if (value === "*") return value;
    try {
      return new URL(value).origin;
    } catch {
      throw new Error("OPENAGENTGRAPH_ALLOWED_ORIGINS must contain valid absolute origins or '*'.");
    }
  });
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "3001");
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error("PORT must be a whole number between 1 and 65535.");
  }
  return parsed;
}

function parsePositiveNumber(value: string | undefined, fallback: number, key: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive number.`);
  }
  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number, key: string): number {
  const parsed = parsePositiveNumber(value, fallback, key);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${key} must be a positive whole number.`);
  }
  return parsed;
}

function parseScanBreakerLimits(
  parsed: z.infer<typeof envSchema>,
  prefix: "OPENAGENTGRAPH_SCAN" | "OPENAGENTGRAPH_SEMANTIC",
  defaults: ScanBreakerLimits
): ScanBreakerLimits {
  return {
    maxFiles: parsePositiveInteger(
      prefix === "OPENAGENTGRAPH_SCAN"
        ? parsed.OPENAGENTGRAPH_SCAN_MAX_FILES
        : parsed.OPENAGENTGRAPH_SEMANTIC_MAX_FILES ?? parsed.OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_FILES,
      defaults.maxFiles,
      `${prefix}_MAX_FILES`
    ),
    maxTotalBytes: parsePositiveInteger(
      prefix === "OPENAGENTGRAPH_SCAN"
        ? parsed.OPENAGENTGRAPH_SCAN_MAX_TOTAL_BYTES
        : parsed.OPENAGENTGRAPH_SEMANTIC_MAX_TOTAL_BYTES ?? parsed.OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_TOTAL_BYTES,
      defaults.maxTotalBytes,
      `${prefix}_MAX_TOTAL_BYTES`
    ),
    maxFileBytes: parsePositiveInteger(
      prefix === "OPENAGENTGRAPH_SCAN"
        ? parsed.OPENAGENTGRAPH_SCAN_MAX_FILE_BYTES
        : parsed.OPENAGENTGRAPH_SEMANTIC_MAX_FILE_BYTES,
      defaults.maxFileBytes,
      `${prefix}_MAX_FILE_BYTES`
    ),
    maxDepth: parsePositiveInteger(
      prefix === "OPENAGENTGRAPH_SCAN"
        ? parsed.OPENAGENTGRAPH_SCAN_MAX_DEPTH
        : parsed.OPENAGENTGRAPH_SEMANTIC_MAX_DEPTH,
      defaults.maxDepth,
      `${prefix}_MAX_DEPTH`
    ),
    maxDurationMs: parsePositiveInteger(
      prefix === "OPENAGENTGRAPH_SCAN"
        ? parsed.OPENAGENTGRAPH_SCAN_MAX_DURATION_MS
        : parsed.OPENAGENTGRAPH_SEMANTIC_MAX_DURATION_MS ?? parsed.OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_DURATION_MS,
      defaults.maxDurationMs,
      `${prefix}_MAX_DURATION_MS`
    ),
  };
}

function parseHeaderMap(raw: string | undefined, key: string): Record<string, string> {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const piece of raw.split(",")) {
    const normalized = piece.trim();
    if (!normalized) continue;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`${key} must contain comma-separated key=value pairs.`);
    }
    const headerKey = normalized.slice(0, separatorIndex).trim();
    const headerValue = normalized.slice(separatorIndex + 1).trim();
    if (!headerKey || !headerValue) {
      throw new Error(`${key} must contain non-empty header names and values.`);
    }
    headers[headerKey] = headerValue;
  }
  return headers;
}

function parseConfiguredActors(raw: string | undefined): Record<string, ActorIdentity> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    const actors = z.array(actorSchema).parse(parsed);
    return actors.reduce<Record<string, ActorIdentity>>((acc, actor) => {
      acc[actor.actorId] = actor;
      return acc;
    }, {});
  } catch {
    throw new Error("OPENAGENTGRAPH_ACTORS must be valid JSON describing actorId, displayName, and role.");
  }
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const nodeEnv = parsed.NODE_ENV;
  const authMode =
    parsed.OPENAGENTGRAPH_AUTH_MODE ??
    (nodeEnv === "production" ? "jwt" : "dev_header");
  const allowActorHeaders =
    authMode === "dev_header" &&
    (parsed.OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS === undefined
      ? nodeEnv !== "production"
      : parsed.OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS === "true");
  const unsafeDevAuthOptIn = parsed.OPENAGENTGRAPH_ALLOW_UNSAFE_DEV_AUTH_IN_PRODUCTION === "true";
  const configuredActors = parseConfiguredActors(parsed.OPENAGENTGRAPH_ACTORS);
  const useDefaultDevActors =
    allowActorHeaders && Object.keys(configuredActors).length === 0 && nodeEnv !== "production";
  const dataDir = path.resolve(parsed.DATA_DIR ?? path.join(process.cwd(), "data"));
  const publicBaseUrl = parseOptionalUrl(parsed.OPENAGENTGRAPH_PUBLIC_BASE_URL, "OPENAGENTGRAPH_PUBLIC_BASE_URL");
  const allowedOrigins = parseOriginList(parsed.OPENAGENTGRAPH_ALLOWED_ORIGINS);
  const providerMode = inferProviderMode(parsed);
  const providerModel =
    parsed.OPENAGENTGRAPH_AI_MODEL?.trim() ||
    (providerMode === "unset" ? "" : DEFAULT_PROVIDER_MODELS[providerMode]);
  const providerApiKey = providerKey(parsed, providerMode);
  const baseUrl = providerBaseUrl(parsed, providerMode);
  const providerConfigured = providerIsConfigured({
    providerMode,
    apiKey: providerApiKey,
    baseUrl,
    model: providerModel,
  });
  const otlpEndpoint = parseOptionalUrl(
    parsed.OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT,
    "OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT"
  );
  const scanLimits = parseScanBreakerLimits(parsed, "OPENAGENTGRAPH_SCAN", DEFAULT_LIGHTWEIGHT_SCAN_LIMITS);
  const semanticScanLimits = parseScanBreakerLimits(parsed, "OPENAGENTGRAPH_SEMANTIC", DEFAULT_SEMANTIC_SCAN_LIMITS);

  return {
    env: {
      nodeEnv,
      isProduction: nodeEnv === "production",
      isTest: nodeEnv === "test",
    },
    server: {
      host: "0.0.0.0",
      port: parsePort(parsed.PORT),
    },
    database: {
      dataDir,
      filePath: path.join(dataDir, "openagentgraph.db"),
    },
    provider: {
      mode: providerMode,
      configured: providerConfigured,
      model: providerModel,
      baseUrl,
      apiKey: providerApiKey,
      embeddingModel: parsed.OPENAGENTGRAPH_AI_EMBEDDING_MODEL?.trim() || undefined,
      source: providerConfigured ? "environment" : "unset",
    },
    workspace: {
      root: parsed.OPENAGENTGRAPH_WORKSPACE_ROOT
        ? path.resolve(parsed.OPENAGENTGRAPH_WORKSPACE_ROOT)
        : undefined,
    },
    frontend: {
      publicBaseUrl,
      allowedOrigins,
    },
    auth: {
      mode: authMode,
      allowActorHeaders,
      unsafeDevAuthOptIn,
      useDefaultDevActors,
      configuredActors: Object.keys(configuredActors).length > 0 ? configuredActors : DEFAULT_ACTORS,
      jwtSecret: parsed.OPENAGENTGRAPH_JWT_SECRET,
      roleMapping: {
        operatorEmails: parseCsvList(parsed.OPENAGENTGRAPH_AUTH_OPERATOR_EMAILS),
        reviewerEmails: parseCsvList(parsed.OPENAGENTGRAPH_AUTH_REVIEWER_EMAILS),
        adminEmails: parseCsvList(parsed.OPENAGENTGRAPH_AUTH_ADMIN_EMAILS),
        operatorDomains: parseCsvList(parsed.OPENAGENTGRAPH_AUTH_OPERATOR_DOMAINS),
        reviewerDomains: parseCsvList(parsed.OPENAGENTGRAPH_AUTH_REVIEWER_DOMAINS),
        adminDomains: parseCsvList(parsed.OPENAGENTGRAPH_AUTH_ADMIN_DOMAINS),
      },
    },
    logging: {
      level: parsed.OPENAGENTGRAPH_LOG_LEVEL ?? "info",
    },
    telemetry: {
      openTelemetryEnabled: parsed.OPENAGENTGRAPH_OTEL_ENABLED === "true",
      otlpEndpoint,
      otlpHeaders: parseHeaderMap(
        parsed.OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_HEADERS,
        "OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_HEADERS"
      ),
    },
    sampling: {
      enabled: parsed.OPENAGENTGRAPH_SAMPLING_ENABLED !== "false",
      healthyDurationMs: parsePositiveNumber(
        parsed.OPENAGENTGRAPH_SAMPLING_HEALTHY_DURATION_MS,
        800,
        "OPENAGENTGRAPH_SAMPLING_HEALTHY_DURATION_MS"
      ),
    },
    scanner: {
      scanLimits,
      semanticScanLimits,
      semanticAnalysisBudget: {
        maxFiles: semanticScanLimits.maxFiles,
        maxTotalBytes: semanticScanLimits.maxTotalBytes,
        maxDurationMs: semanticScanLimits.maxDurationMs,
      },
    },
  };
}

export function getAppConfig(): AppConfig {
  return configOverride ?? loadAppConfig();
}

export function setAppConfigOverride(config: AppConfig | undefined) {
  configOverride = config;
}

export const setAppConfigForTests = setAppConfigOverride;

export function validateStartupConfig(config: AppConfig): StartupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    fs.mkdirSync(config.database.dataDir, { recursive: true });
    fs.accessSync(config.database.dataDir, fs.constants.W_OK);
  } catch {
    errors.push("Database storage is unavailable; the configured data directory is not writable.");
  }

  if (config.workspace.root) {
    try {
      const stat = fs.statSync(config.workspace.root);
      if (!stat.isDirectory()) {
        warnings.push("Workspace root is invalid; execution features are unavailable.");
      } else {
        fs.accessSync(config.workspace.root, fs.constants.W_OK);
      }
    } catch {
      warnings.push("Workspace root is invalid; execution features are unavailable.");
    }
  }

  if (!config.provider.configured) {
    warnings.push(AI_PROVIDER_UNCONFIGURED_MESSAGE);
  }

  if (
    config.env.isProduction &&
    config.frontend.allowedOrigins.length === 0 &&
    !config.frontend.publicBaseUrl
  ) {
    warnings.push("Frontend origin policy is not configured for production deployments.");
  }

  if (config.env.isProduction && config.frontend.allowedOrigins.includes("*")) {
    warnings.push("CORS is configured to allow every origin in production.");
  }

  if (config.auth.mode === "jwt" && !config.auth.jwtSecret) {
    errors.push("JWT auth mode requires OPENAGENTGRAPH_JWT_SECRET.");
  }

  if (config.env.isProduction && config.auth.mode === "dev_header" && !config.auth.unsafeDevAuthOptIn) {
    errors.push("Development actor-header auth is enabled in production without explicit opt-in.");
  }

  if (config.env.isProduction && config.auth.mode === "dev_header" && config.auth.unsafeDevAuthOptIn) {
    warnings.push("Development actor-header auth is explicitly enabled in production.");
  }

  if (config.telemetry.openTelemetryEnabled && !config.telemetry.otlpEndpoint) {
    warnings.push("OpenTelemetry export is enabled but no OTLP endpoint is configured.");
  }

  return { errors, warnings };
}

export function buildStartupSummary(config: AppConfig): StartupSummary {
  const validation = validateStartupConfig(config);
  const environmentMode = config.env.nodeEnv;
  const authMode =
    config.auth.mode === "jwt"
      ? config.auth.jwtSecret
        ? "verified bearer JWT auth"
        : "JWT auth misconfigured"
      : config.env.isProduction
        ? config.auth.unsafeDevAuthOptIn
          ? "actor headers enabled by explicit production opt-in"
          : "unsafe actor-header auth configuration"
        : config.auth.useDefaultDevActors
          ? "development actor headers with default dev actors"
          : "actor headers with configured actors";
  const workspaceStatus = config.workspace.root
    ? validation.warnings.includes("Workspace root is invalid; execution features are unavailable.")
      ? "workspace root invalid"
      : "workspace root configured"
    : "workspace root not configured";
  const databaseStatus = `database path ${config.database.filePath}`;
  const providerStatus = config.provider.configured
    ? `${config.provider.mode} provider configured`
    : "AI provider unavailable for goal execution";
  const frontendStatus =
    config.frontend.allowedOrigins.length > 0
      ? config.frontend.allowedOrigins.includes("*")
        ? "frontend origins allow every host"
        : "explicit frontend origins configured"
      : config.frontend.publicBaseUrl
        ? "same-origin frontend deployment assumed"
        : "frontend origin policy not configured";
  const degraded = validation.errors.length > 0 || validation.warnings.length > 0;

  return {
    environmentMode,
    authMode,
    workspaceStatus,
    databaseStatus,
    providerStatus,
    frontendStatus,
    summaryLine: `Startup summary: ${environmentMode} mode, ${authMode}, ${workspaceStatus}, ${providerStatus}, ${frontendStatus}.`,
    degraded,
  };
}
