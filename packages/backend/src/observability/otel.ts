import crypto from "crypto";
import type { GraphEvent, NodeCompletedPayload, NodeExecutingPayload, NodeFailedPayload } from "@openagentgraph/shared";
import { getAppConfig, type AppConfig } from "../config.js";
import { logDiagnostic, safeErrorMessage } from "./logger.js";
import { incrementFailureMetric, incrementMetric } from "./metrics.js";

type SpanStatusCode = "OK" | "ERROR";

type ActiveSpan = {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
};

type FetchLike = typeof fetch;

const DEFAULT_OTEL_EXPORT_TIMEOUT_MS = 2000;
const activeSpans = new Map<string, ActiveSpan>();
let fetchOverride: FetchLike | undefined;
let initializedConfig: AppConfig | undefined;
let exportTimeoutMsOverride: number | undefined;

function spanKey(event: GraphEvent) {
  return `${event.graphId}:${event.nodeId ?? "graph"}`;
}

function toUnixNano(value: string) {
  const millis = Date.parse(value);
  const safeMillis = Number.isFinite(millis) ? millis : Date.now();
  return String(BigInt(safeMillis) * 1_000_000n);
}

function randomHex(bytes: number) {
  return crypto.randomBytes(bytes).toString("hex");
}

function truncateAttribute(value: string, maxLength = 4096) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...[truncated]`;
}

function normalizeOtlpEndpoint(endpoint: string) {
  const trimmed = endpoint.replace(/\/$/, "");
  return trimmed.endsWith("/v1/traces") ? trimmed : `${trimmed}/v1/traces`;
}

function valueToOtlp(value: string | number | boolean) {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: value };
}

function attributesToOtlp(attributes: Record<string, string | number | boolean>) {
  return Object.entries(attributes)
    .filter(([, value]) => typeof value !== "number" || Number.isFinite(value))
    .map(([key, value]) => ({
      key,
      value: valueToOtlp(value),
    }));
}

function metadataAttribute(
  payload: NodeCompletedPayload,
  key: string
): string | number | boolean | undefined {
  const value = payload.evidence.metadata?.[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function failedMetadataAttribute(
  payload: NodeFailedPayload,
  key: string
): string | number | boolean | undefined {
  const value = payload.metadata?.[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function exportTimeoutMs() {
  return exportTimeoutMsOverride ?? DEFAULT_OTEL_EXPORT_TIMEOUT_MS;
}

async function postSpan(
  config: AppConfig,
  span: ActiveSpan,
  endTimeUnixNano: string,
  statusCode: SpanStatusCode,
  extraAttributes: Record<string, string | number | boolean> = {},
  statusMessage?: string
) {
  if (!config.telemetry.otlpEndpoint) return;

  const requestFetch = fetchOverride ?? fetch;
  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: attributesToOtlp({
            "service.name": "openagentgraph",
            "telemetry.sdk.language": "nodejs",
          }),
        },
        scopeSpans: [
          {
            scope: {
              name: "openagentgraph-otel-bridge",
              version: "1.0.0",
            },
            spans: [
              {
                traceId: span.traceId,
                spanId: span.spanId,
                name: span.name,
                kind: 1,
                startTimeUnixNano: span.startTimeUnixNano,
                endTimeUnixNano,
                attributes: attributesToOtlp({ ...span.attributes, ...extraAttributes }),
                status: {
                  code: statusCode === "OK" ? 1 : 2,
                  ...(statusMessage ? { message: truncateAttribute(statusMessage, 1024) } : {}),
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timeout = controller
    ? setTimeout(() => controller.abort(), exportTimeoutMs())
    : undefined;
  try {
    const response = await requestFetch(normalizeOtlpEndpoint(config.telemetry.otlpEndpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...config.telemetry.otlpHeaders,
      },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (!response.ok) {
      throw new Error(`OTLP export failed with status ${response.status}`);
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function recordExportFailure(error: unknown) {
  incrementFailureMetric("provider_error", "observability.otel", "recovered");
  incrementMetric(
    "openagentgraph_otel_export_failures_total",
    "Recovered OpenTelemetry export failures.",
    undefined,
    1
  );
  logDiagnostic({
    level: "warn",
    component: "observability.otel",
    message: "OpenTelemetry export failed after event commit.",
    errorCode: "OTEL_EXPORT_FAILED",
    safeMetadata: { error: safeErrorMessage(error) },
  });
}

function startNodeSpan(event: GraphEvent<"node.executing">) {
  const payload = event.payload as NodeExecutingPayload;
  const span: ActiveSpan = {
    traceId: randomHex(16),
    spanId: randomHex(8),
    name: `node:${event.nodeId ?? "unknown"}`,
    startTimeUnixNano: toUnixNano(event.ts),
    attributes: {
      "openinference.span.kind": "LLM",
      "openagentgraph.graph_id": event.graphId,
      "openagentgraph.node_id": event.nodeId ?? "",
      "input.value": truncateAttribute(payload.prompt),
    },
  };
  activeSpans.set(spanKey(event), span);
}

async function completeNodeSpan(config: AppConfig, event: GraphEvent<"node.completed">) {
  const payload = event.payload as NodeCompletedPayload;
  const key = spanKey(event);
  const span = activeSpans.get(key) ?? {
    traceId: randomHex(16),
    spanId: randomHex(8),
    name: `node:${event.nodeId ?? "unknown"}`,
    startTimeUnixNano: toUnixNano(event.ts),
    attributes: {
      "openinference.span.kind": "LLM",
      "openagentgraph.graph_id": event.graphId,
      "openagentgraph.node_id": event.nodeId ?? "",
    },
  };

  try {
    await postSpan(
      config,
      span,
      toUnixNano(event.ts),
      "OK",
      {
        "output.value": truncateAttribute(payload.output),
        "llm.model_name": String(metadataAttribute(payload, "model") ?? ""),
        "llm.provider": String(metadataAttribute(payload, "provider") ?? ""),
        "llm.invocation_type": String(metadataAttribute(payload, "operation") ?? ""),
        "llm.token_count.prompt": Number(metadataAttribute(payload, "promptTokens") ?? 0),
        "llm.token_count.completion": Number(metadataAttribute(payload, "completionTokens") ?? 0),
        "openagentgraph.duration_ms": Number(metadataAttribute(payload, "durationMs") ?? 0),
        "openagentgraph.sampling.compacted": payload.evidence.sampling?.compacted ?? false,
      }
    );
  } finally {
    activeSpans.delete(key);
  }
}

async function failNodeSpan(config: AppConfig, event: GraphEvent<"node.failed">) {
  const payload = event.payload as NodeFailedPayload;
  const key = spanKey(event);
  const span = activeSpans.get(key) ?? {
    traceId: randomHex(16),
    spanId: randomHex(8),
    name: `node:${event.nodeId ?? "unknown"}`,
    startTimeUnixNano: toUnixNano(event.ts),
    attributes: {
      "openinference.span.kind": "LLM",
      "openagentgraph.graph_id": event.graphId,
      "openagentgraph.node_id": event.nodeId ?? "",
    },
  };

  try {
    await postSpan(
      config,
      span,
      toUnixNano(event.ts),
      "ERROR",
      {
        "exception.message": truncateAttribute(payload.reason),
        "exception.details": truncateAttribute(payload.details ?? ""),
        "llm.model_name": String(failedMetadataAttribute(payload, "model") ?? ""),
        "llm.provider": String(failedMetadataAttribute(payload, "provider") ?? ""),
        "llm.invocation_type": String(failedMetadataAttribute(payload, "operation") ?? ""),
        "llm.token_count.prompt": Number(failedMetadataAttribute(payload, "promptTokens") ?? 0),
        "llm.token_count.completion": Number(failedMetadataAttribute(payload, "completionTokens") ?? 0),
        "openagentgraph.duration_ms": Number(failedMetadataAttribute(payload, "durationMs") ?? 0),
      },
      payload.reason
    );
  } finally {
    activeSpans.delete(key);
  }
}

export function initOpenTelemetryExporter(config = getAppConfig()) {
  initializedConfig = config;
  if (config.telemetry.openTelemetryEnabled) {
    incrementMetric(
      "openagentgraph_otel_exporter_enabled_total",
      "Number of times the OpenTelemetry exporter was initialized enabled.",
      undefined,
      1
    );
  }
}

export async function exportGraphEventToOpenTelemetry(event: GraphEvent): Promise<void> {
  const config = initializedConfig ?? getAppConfig();
  if (!config.telemetry.openTelemetryEnabled || !config.telemetry.otlpEndpoint) return;

  try {
    if (event.kind === "node.executing") {
      startNodeSpan(event as GraphEvent<"node.executing">);
      return;
    }
    if (event.kind === "node.completed") {
      await completeNodeSpan(config, event as GraphEvent<"node.completed">);
      return;
    }
    if (event.kind === "node.failed") {
      await failNodeSpan(config, event as GraphEvent<"node.failed">);
    }
  } catch (error) {
    recordExportFailure(error);
  }
}

export function setOpenTelemetryFetchForTests(fetchLike: FetchLike | undefined) {
  fetchOverride = fetchLike;
}

export function setOpenTelemetryExportTimeoutForTests(timeoutMs: number | undefined) {
  exportTimeoutMsOverride = timeoutMs;
}

export function resetOpenTelemetryForTests() {
  activeSpans.clear();
  fetchOverride = undefined;
  initializedConfig = undefined;
  exportTimeoutMsOverride = undefined;
}
