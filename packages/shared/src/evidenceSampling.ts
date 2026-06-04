import type {
  CommandResult,
  FileDiff,
  GraphEventKind,
  GraphEventPayloadMap,
  NodeCompletedPayload,
  NodeEvidence,
  ToolCallRecord,
} from "./types";

export const DEFAULT_HEALTHY_COMPLETION_DURATION_MS = 800;
export const TAIL_SAMPLING_POLICY = "tail-healthy-v1";

export interface TailSamplingOptions {
  enabled?: boolean;
  healthyDurationMs?: number;
}

function metadataNumber(evidence: NodeEvidence, key: string): number | undefined {
  const value = evidence.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metadataBoolean(evidence: NodeEvidence, key: string): boolean {
  return evidence.metadata?.[key] === true;
}

function hasToolError(toolCall: ToolCallRecord): boolean {
  return Boolean(toolCall.error);
}

function hasCommandError(command: CommandResult): boolean {
  return command.timedOut || command.exitCode !== 0;
}

function compactFileDiff(fileDiff: FileDiff): FileDiff {
  return {
    ...fileDiff,
    before: undefined,
    after: undefined,
    beforeTruncated: fileDiff.before !== undefined ? true : fileDiff.beforeTruncated,
    afterTruncated: fileDiff.after !== undefined ? true : fileDiff.afterTruncated,
  };
}

function compactCommandResult(command: CommandResult): CommandResult {
  return {
    ...command,
    stdout: command.stdout ? "[compacted by OpenAgentGraph tail sampling]" : "",
    stderr: command.stderr ? "[compacted by OpenAgentGraph tail sampling]" : "",
  };
}

function compactToolCall(toolCall: ToolCallRecord): ToolCallRecord {
  return {
    ...toolCall,
    output: toolCall.output ? "[compacted by OpenAgentGraph tail sampling]" : toolCall.output,
  };
}

function shouldCompactNodeCompleted(
  payload: NodeCompletedPayload,
  options: Required<TailSamplingOptions>
): { compact: boolean; reason?: string } {
  if (!options.enabled) return { compact: false, reason: "disabled" };
  if (payload.evidence.sampling?.pinned || metadataBoolean(payload.evidence, "samplingPinned")) {
    return { compact: false, reason: "pinned" };
  }
  if (typeof payload.confidence === "number" && Number.isFinite(payload.confidence) && payload.confidence < 0.75) {
    return { compact: false, reason: "low_confidence" };
  }
  if (payload.evidence.toolCallLog.some(hasToolError)) {
    return { compact: false, reason: "tool_error" };
  }
  if (payload.evidence.commandResults.some(hasCommandError)) {
    return { compact: false, reason: "command_error" };
  }

  const durationMs = metadataNumber(payload.evidence, "durationMs");
  if (durationMs === undefined) {
    return { compact: false, reason: "duration_unknown" };
  }
  if (durationMs >= options.healthyDurationMs) {
    return { compact: false, reason: "slow_completion" };
  }

  return { compact: true, reason: "healthy_fast_completion" };
}

function compactNodeCompletedPayload(
  payload: NodeCompletedPayload,
  options: Required<TailSamplingOptions>
): NodeCompletedPayload {
  const decision = shouldCompactNodeCompleted(payload, options);
  if (!decision.compact) return payload;

  return {
    ...payload,
    evidence: {
      ...payload.evidence,
      fileDiffs: payload.evidence.fileDiffs.map(compactFileDiff),
      commandResults: payload.evidence.commandResults.map(compactCommandResult),
      toolCallLog: payload.evidence.toolCallLog.map(compactToolCall),
      sampling: {
        compacted: true,
        policy: TAIL_SAMPLING_POLICY,
        reason: decision.reason,
        originalFileDiffCount: payload.evidence.fileDiffs.length,
        originalCommandResultCount: payload.evidence.commandResults.length,
        originalToolCallCount: payload.evidence.toolCallLog.length,
      },
    },
  };
}

export function applyTailSamplingToGraphEventPayload<K extends GraphEventKind>(
  kind: K,
  payload: GraphEventPayloadMap[K],
  options: TailSamplingOptions = {}
): GraphEventPayloadMap[K] {
  const resolvedOptions: Required<TailSamplingOptions> = {
    enabled: options.enabled ?? true,
    healthyDurationMs: options.healthyDurationMs ?? DEFAULT_HEALTHY_COMPLETION_DURATION_MS,
  };

  if (kind !== "node.completed") return payload;
  return compactNodeCompletedPayload(payload as NodeCompletedPayload, resolvedOptions) as GraphEventPayloadMap[K];
}
