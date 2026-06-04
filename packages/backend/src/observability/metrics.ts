import type { DiagnosticsResponse, MetricsSample, MetricsValueType } from "@openagentgraph/shared";
import { buildStartupSummary, getAppConfig } from "../config.js";

type MetricKey = string;

type MetricDefinition = {
  help: string;
  type: MetricsValueType;
};

const definitions = new Map<string, MetricDefinition>();
const values = new Map<MetricKey, number>();
let lastReadyStatus: DiagnosticsResponse["status"] | undefined;

export const DEFAULT_DURATION_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
export type FailureCategory =
  | "auth_invalid"
  | "auth_missing"
  | "permission_denied"
  | "provider_fallback"
  | "provider_error"
  | "tool_failure"
  | "readiness_degraded"
  | "startup_degraded"
  | "workspace_invalid";

function normalizeLabels(labels?: Record<string, string>) {
  if (!labels) return undefined;
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function metricKey(name: string, labels?: Record<string, string>) {
  const normalized = normalizeLabels(labels);
  return `${name}|${normalized ? JSON.stringify(normalized) : ""}`;
}

function register(name: string, help: string, type: MetricsValueType) {
  if (!definitions.has(name)) {
    definitions.set(name, { help, type });
  }
}

function setMetric(name: string, help: string, type: MetricsValueType, value: number, labels?: Record<string, string>) {
  register(name, help, type);
  values.set(metricKey(name, labels), value);
}

export function incrementMetric(
  name: string,
  help: string,
  labels?: Record<string, string>,
  amount = 1
) {
  register(name, help, "counter");
  const key = metricKey(name, labels);
  values.set(key, (values.get(key) ?? 0) + amount);
}

export function incrementFailureMetric(
  category: FailureCategory,
  component: string,
  outcome: "recovered" | "hard" = "hard"
) {
  incrementMetric(
    "openagentgraph_failure_events_total",
    "Bounded runtime failure-shape counters by category, component, and outcome.",
    {
      category,
      component,
      outcome,
    },
    1
  );
}

export function setGauge(
  name: string,
  help: string,
  value: number,
  labels?: Record<string, string>
) {
  setMetric(name, help, "gauge", value, labels);
}

export function observeDuration(
  name: string,
  help: string,
  milliseconds: number,
  labels?: Record<string, string>,
  buckets: readonly number[] = DEFAULT_DURATION_BUCKETS_MS
) {
  const boundedMilliseconds = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const bucketName = `${name}_bucket`;
  const sumName = `${name}_sum`;
  const countName = `${name}_count`;

  for (const bucket of buckets) {
    if (boundedMilliseconds <= bucket) {
      incrementMetric(
        bucketName,
        `${help} Bucketed duration counters in milliseconds.`,
        { ...labels, le: String(bucket) },
        1
      );
    }
  }

  incrementMetric(
    bucketName,
    `${help} Bucketed duration counters in milliseconds.`,
    { ...labels, le: "+Inf" },
    1
  );
  incrementMetric(
    sumName,
    `${help} Total observed duration in milliseconds.`,
    labels,
    boundedMilliseconds
  );
  incrementMetric(
    countName,
    `${help} Total observed calls.`,
    labels,
    1
  );
}

export function statusClass(statusCode: number): string {
  return `${Math.floor(statusCode / 100)}xx`;
}

export function routeGroup(routeUrl: string | undefined, rawUrl: string): string {
  const normalized = routeUrl && routeUrl.length > 0 ? routeUrl : rawUrl.split("?")[0] || "/";
  const segments = normalized.split("/").filter(Boolean);
  if (segments[0] === "graphs") {
    const suffix = segments.length > 2 ? `/${segments.slice(2).join("/")}` : "";
    return segments.length > 1 ? `/graphs/:graphId${suffix}` : "/graphs";
  }
  if (segments[0] === "nodes") {
    const suffix = segments.length > 2 ? `/${segments.slice(2).join("/")}` : "";
    return segments.length > 1 ? `/nodes/:nodeId${suffix}` : "/nodes";
  }
  if (normalized === "/health" || normalized === "/ready" || normalized === "/metrics") return normalized;
  return normalized;
}

export function syncDiagnosticsMetrics(ready: DiagnosticsResponse) {
  const startupSummary = buildStartupSummary(getAppConfig());
  if (lastReadyStatus && lastReadyStatus !== ready.status && ready.status !== "ok") {
    incrementFailureMetric("readiness_degraded", "diagnostics", "hard");
  }
  lastReadyStatus = ready.status;
  setGauge(
    "openagentgraph_readiness_status",
    "Readiness status as a one-hot gauge by state.",
    1,
    { status: ready.status }
  );
  for (const status of ["ok", "degraded", "error"] as const) {
    if (status !== ready.status) {
      setGauge(
        "openagentgraph_readiness_status",
        "Readiness status as a one-hot gauge by state.",
        0,
        { status }
      );
    }
  }
  setGauge(
    "openagentgraph_startup_degraded",
    "Whether startup/config validation is currently degraded or invalid.",
    startupSummary.degraded ? 1 : 0
  );
}

export function renderMetricsText(): string {
  const grouped = new Map<string, MetricsSample[]>();

  for (const [key, value] of values.entries()) {
    const [name, rawLabels] = key.split("|");
    const definition = definitions.get(name);
    if (!definition) continue;
    const labels = rawLabels ? (JSON.parse(rawLabels) as Record<string, string>) : undefined;
    const sample: MetricsSample = {
      name,
      help: definition.help,
      type: definition.type,
      labels,
      value,
    };
    const samples = grouped.get(name) ?? [];
    samples.push(sample);
    grouped.set(name, samples);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, samples]) => {
      const definition = definitions.get(name)!;
      const sortedSamples = samples.sort((left, right) =>
        JSON.stringify(left.labels ?? {}).localeCompare(JSON.stringify(right.labels ?? {}))
      );
      return [
        `# HELP ${name} ${definition.help}`,
        `# TYPE ${name} ${definition.type}`,
        ...sortedSamples.map((sample) => {
          const labels = sample.labels
            ? `{${Object.entries(sample.labels)
                .map(([key, value]) => `${key}="${value}"`)
                .join(",")}}`
            : "";
          return `${sample.name}${labels} ${sample.value}`;
        }),
      ];
    })
    .join("\n");
}

export function resetMetricsForTests() {
  values.clear();
  definitions.clear();
  lastReadyStatus = undefined;
}
