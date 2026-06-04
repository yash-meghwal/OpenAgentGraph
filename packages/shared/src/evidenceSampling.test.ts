import { describe, expect, it } from "vitest";
import { applyTailSamplingToGraphEventPayload, TAIL_SAMPLING_POLICY } from "./evidenceSampling";
import type { NodeCompletedPayload } from "./types";

function completedPayload(overrides: Partial<NodeCompletedPayload> = {}): NodeCompletedPayload {
  return {
    output: "Done",
    confidence: 0.9,
    evidence: {
      fileDiffs: [
        {
          path: "src/app.ts",
          changeType: "updated",
          summary: "Updated app",
          before: "old content",
          after: "new content",
          beforeChecksum: "before-hash",
          afterChecksum: "after-hash",
        },
      ],
      commandResults: [
        {
          command: "npm",
          args: ["test"],
          cwd: "/workspace",
          stdout: "tests passed",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          startedAt: "2026-06-01T00:00:00.000Z",
          finishedAt: "2026-06-01T00:00:01.000Z",
        },
      ],
      toolCallLog: [
        {
          id: "tool-1",
          nodeId: "node-1",
          tool: "runCommand",
          input: { command: "npm", args: ["test"] },
          output: "tests passed",
          startedAt: "2026-06-01T00:00:00.000Z",
          completedAt: "2026-06-01T00:00:01.000Z",
        },
      ],
      workspaceChecksum: "after",
      workspaceChecksumBefore: "before",
      workspaceChecksumAfter: "after",
      metadata: {
        durationMs: 200,
        promptTokens: 10,
        completionTokens: 20,
      },
    },
    ...overrides,
  };
}

describe("applyTailSamplingToGraphEventPayload", () => {
  it("compacts heavy healthy completion details while preserving metadata", () => {
    const payload = applyTailSamplingToGraphEventPayload("node.completed", completedPayload());

    expect(payload.evidence.fileDiffs[0]).toMatchObject({
      path: "src/app.ts",
      beforeChecksum: "before-hash",
      afterChecksum: "after-hash",
      beforeTruncated: true,
      afterTruncated: true,
    });
    expect(payload.evidence.fileDiffs[0].before).toBeUndefined();
    expect(payload.evidence.fileDiffs[0].after).toBeUndefined();
    expect(payload.evidence.commandResults[0].stdout).toContain("compacted");
    expect(payload.evidence.toolCallLog[0].output).toContain("compacted");
    expect(payload.evidence.metadata?.promptTokens).toBe(10);
    expect(payload.evidence.sampling).toMatchObject({
      compacted: true,
      policy: TAIL_SAMPLING_POLICY,
      reason: "healthy_fast_completion",
      originalFileDiffCount: 1,
      originalCommandResultCount: 1,
      originalToolCallCount: 1,
    });
  });

  it("preserves slow, errored, low-confidence, and pinned completion evidence", () => {
    const slow = completedPayload({
      evidence: {
        ...completedPayload().evidence,
        metadata: { durationMs: 900 },
      },
    });
    const commandFailure = completedPayload({
      evidence: {
        ...completedPayload().evidence,
        commandResults: [{ ...completedPayload().evidence.commandResults[0], exitCode: 1 }],
      },
    });
    const toolFailure = completedPayload({
      evidence: {
        ...completedPayload().evidence,
        toolCallLog: [{ ...completedPayload().evidence.toolCallLog[0], error: "failed" }],
      },
    });
    const lowConfidence = completedPayload({ confidence: 0.5 });
    const pinned = completedPayload({
      evidence: {
        ...completedPayload().evidence,
        metadata: { durationMs: 100, samplingPinned: true },
      },
    });
    const unknownDuration = completedPayload({
      evidence: {
        ...completedPayload().evidence,
        metadata: { promptTokens: 10 },
      },
    });

    for (const payload of [slow, commandFailure, toolFailure, lowConfidence, pinned, unknownDuration]) {
      const result = applyTailSamplingToGraphEventPayload("node.completed", payload);
      expect(result.evidence.fileDiffs[0].before).toBe("old content");
      expect(result.evidence.commandResults[0].stdout).toBe("tests passed");
      expect(result.evidence.toolCallLog[0].output).toBe("tests passed");
      expect(result.evidence.sampling).toBeUndefined();
    }
  });

  it("leaves non-completion payloads unchanged", () => {
    const payload = { reason: "Failed" };
    expect(applyTailSamplingToGraphEventPayload("node.failed", payload)).toBe(payload);
  });
});
