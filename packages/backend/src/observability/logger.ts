import { sanitizeOperationalText } from "@openagentgraph/shared";
import type { StructuredLogEntry } from "@openagentgraph/shared";
import { getAppConfig } from "../config.js";

type LogSink = (entry: StructuredLogEntry) => void;

const levelWeight: Record<StructuredLogEntry["level"], number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let sink: LogSink = (entry) => {
  const line = JSON.stringify(entry);
  if (entry.level === "error" || entry.level === "warn") {
    console.error(line);
    return;
  }
  console.log(line);
};
const defaultSink = sink;

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined
): StructuredLogEntry["safeMetadata"] | undefined {
  if (!metadata) return undefined;

  const safeEntries = Object.entries(metadata)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (/token|secret|password|authorization|api.?key|jwt/i.test(key)) {
        return [key, "[redacted]"] as const;
      }
      if (typeof value === "string") {
        return [key, sanitizeOperationalText(value, { maxLength: 240 })] as const;
      }
      if (typeof value === "number" || typeof value === "boolean" || value === null) {
        return [key, value] as const;
      }
      return [
        key,
        sanitizeOperationalText(JSON.stringify(value), { maxLength: 240 }),
      ] as const;
    });

  return safeEntries.length > 0 ? Object.fromEntries(safeEntries) : undefined;
}

export function setStructuredLogSink(nextSink: LogSink | undefined) {
  sink = nextSink ?? defaultSink;
}

export function logDiagnostic(
  entry: Omit<StructuredLogEntry, "timestamp" | "safeMetadata"> & {
    timestamp?: string;
    safeMetadata?: Record<string, unknown>;
  }
) {
  const config = getAppConfig();
  if (levelWeight[entry.level] < levelWeight[config.logging.level]) return;

  sink({
    ...entry,
    message: sanitizeOperationalText(entry.message, { maxLength: 240 }),
    timestamp: entry.timestamp ?? new Date().toISOString(),
    safeMetadata: sanitizeMetadata(entry.safeMetadata),
  });
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return sanitizeOperationalText(error.message, { maxLength: 240 });
  }
  return "Unknown error";
}
