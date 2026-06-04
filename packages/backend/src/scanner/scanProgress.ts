import type {
  ScanBreakerAlert,
  ScanBreakerLimitKey,
  ScanBreakerLimits,
  ScanBreakerStatus,
  ScanProgressPhase,
  ScanProgressScope,
  ScanProgressSnapshot,
} from "@openagentgraph/shared";

export const DEFAULT_LIGHTWEIGHT_SCAN_LIMITS: ScanBreakerLimits = {
  maxFiles: 20_000,
  maxTotalBytes: 200_000_000,
  maxFileBytes: 5_000_000,
  maxDepth: 40,
  maxDurationMs: 180_000,
};

export const DEFAULT_SEMANTIC_SCAN_LIMITS: ScanBreakerLimits = {
  maxFiles: 5_000,
  maxTotalBytes: 50_000_000,
  maxFileBytes: 5_000_000,
  maxDepth: 40,
  maxDurationMs: 30_000,
};

const BREAKER_NEAR_RATIO = 0.85;
const MAX_BREAKER_ALERTS = 8;

export function normalizeScanBreakerLimits(
  input: Partial<ScanBreakerLimits> | undefined,
  fallback: ScanBreakerLimits
): ScanBreakerLimits {
  return {
    maxFiles: input?.maxFiles ?? fallback.maxFiles,
    maxTotalBytes: input?.maxTotalBytes ?? fallback.maxTotalBytes,
    maxFileBytes: input?.maxFileBytes ?? fallback.maxFileBytes,
    maxDepth: input?.maxDepth ?? fallback.maxDepth,
    maxDurationMs: input?.maxDurationMs ?? fallback.maxDurationMs,
  };
}

export function createScanBreakerStatus(limits: ScanBreakerLimits): ScanBreakerStatus {
  return {
    state: "ok",
    limits,
    hits: [],
    near: [],
  };
}

function breakerAlertKey(alert: ScanBreakerAlert) {
  return `${alert.key}:${alert.message}`;
}

function pushUniqueAlert(alerts: ScanBreakerAlert[], alert: ScanBreakerAlert) {
  if (alerts.some((existing) => breakerAlertKey(existing) === breakerAlertKey(alert))) return;
  if (alerts.length < MAX_BREAKER_ALERTS) {
    alerts.push(alert);
  }
}

function hitKeys(status: ScanBreakerStatus) {
  return new Set(status.hits.map((alert) => alert.key));
}

function limitLabel(key: ScanBreakerLimitKey) {
  switch (key) {
    case "maxFiles":
      return "file count";
    case "maxTotalBytes":
      return "total source bytes";
    case "maxFileBytes":
      return "single file size";
    case "maxDepth":
      return "directory depth";
    case "maxDurationMs":
      return "scan duration";
  }
}

export function markScanBreakerHit(
  status: ScanBreakerStatus,
  key: ScanBreakerLimitKey,
  observed: number,
  message?: string
) {
  const limit = status.limits[key];
  pushUniqueAlert(status.hits, {
    key,
    limit,
    observed,
    message: message ?? `${limitLabel(key)} exceeded ${limit}.`,
  });
  status.near = status.near.filter((alert) => alert.key !== key);
  status.state = "hit";
}

export function updateScanBreakerNear(
  status: ScanBreakerStatus,
  observed: Partial<Record<ScanBreakerLimitKey, number>>
) {
  const keysWithHits = hitKeys(status);
  status.near = [];
  for (const [rawKey, rawObserved] of Object.entries(observed)) {
    const key = rawKey as ScanBreakerLimitKey;
    if (keysWithHits.has(key)) continue;
    const limit = status.limits[key];
    const value = rawObserved ?? 0;
    if (limit > 0 && value / limit >= BREAKER_NEAR_RATIO) {
      pushUniqueAlert(status.near, {
        key,
        limit,
        observed: value,
        message: `${limitLabel(key)} is near the configured breaker.`,
      });
    }
  }
  status.state = status.hits.length > 0 ? "hit" : status.near.length > 0 ? "near" : "ok";
}

export function cloneScanBreakerStatus(status: ScanBreakerStatus): ScanBreakerStatus {
  return {
    state: status.state,
    limits: { ...status.limits },
    hits: status.hits.map((alert) => ({ ...alert })),
    near: status.near.map((alert) => ({ ...alert })),
  };
}

export function scanBreakerDiagnostics(status: ScanBreakerStatus): string[] {
  return [...new Set([...status.hits, ...status.near].map((alert) => alert.message))];
}

export function buildScanProgressSnapshot(input: {
  scanId: string;
  scope: ScanProgressScope;
  phase: ScanProgressPhase;
  startedAtMs: number;
  nowMs?: number;
  filesScanned: number;
  bytesScanned: number;
  skippedFileCount: number;
  skippedDirectoryCount: number;
  breakers: ScanBreakerStatus;
  message?: string;
}): ScanProgressSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const elapsedSeconds = Math.max(0.001, (nowMs - input.startedAtMs) / 1_000);
  const filesPerSecond = input.filesScanned / elapsedSeconds;
  const megabytesPerSecond = input.bytesScanned / (1024 * 1024) / elapsedSeconds;
  const remainingFiles = Math.max(0, input.breakers.limits.maxFiles - input.filesScanned);
  const etaMs =
    filesPerSecond > 0 && input.phase !== "completed" && input.phase !== "failed"
      ? Math.round((remainingFiles / filesPerSecond) * 1_000)
      : undefined;

  return {
    scanId: input.scanId,
    scope: input.scope,
    phase: input.phase,
    startedAt: new Date(input.startedAtMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    filesScanned: input.filesScanned,
    bytesScanned: input.bytesScanned,
    skippedFileCount: input.skippedFileCount,
    skippedDirectoryCount: input.skippedDirectoryCount,
    filesPerSecond: Number(filesPerSecond.toFixed(2)),
    megabytesPerSecond: Number(megabytesPerSecond.toFixed(2)),
    ...(etaMs !== undefined ? { etaMs } : {}),
    ...(input.message ? { message: input.message } : {}),
    breakers: cloneScanBreakerStatus(input.breakers),
  };
}
