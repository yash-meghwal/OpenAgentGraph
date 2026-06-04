import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider, assertCommandWithinWorkspace, resolveWorkspacePath, runDeterministicChecks } from "./openai.js";
import { renderMetricsText, resetMetricsForTests } from "../observability/metrics.js";

afterEach(() => {
  resetMetricsForTests();
});

describe("workspace jail", () => {
  it("rejects paths that escape the workspace root", () => {
    expect(() => resolveWorkspacePath("C:\\repo", "..\\outside.txt")).toThrow(/escapes workspace root/i);
  });

  it("rejects command args that reference paths outside the workspace", () => {
    expect(() =>
      assertCommandWithinWorkspace("C:\\repo", "node", ["..\\outside.js"])
    ).toThrow(/escapes workspace root/i);
  });
});

describe("embedding fallback", () => {
  it("can omit authorization headers for no-key OpenAI-compatible endpoints", () => {
    const provider = new OpenAIProvider("", {
      providerMode: "openai-compatible",
      providerComponent: "providers.openai_compatible",
      providerLabel: "OpenAI-compatible",
      model: "local-model",
      baseURL: "https://gateway.example.com/v1",
      embeddingModel: false,
      omitAuthorization: true,
    });

    expect((provider as any).client.authHeaders({})).toEqual({});
  });

  it("keeps authorization headers when a compatible endpoint has a configured key", () => {
    const provider = new OpenAIProvider("custom-key-123", {
      providerMode: "openai-compatible",
      providerComponent: "providers.openai_compatible",
      providerLabel: "OpenAI-compatible",
      model: "custom-model",
      baseURL: "https://gateway.example.com/v1",
      embeddingModel: false,
    });

    expect((provider as any).client.authHeaders({})).toEqual({
      Authorization: "Bearer custom-key-123",
    });
  });

  it("uses deterministic embedding fallback without calling provider embeddings when disabled", async () => {
    const provider = new OpenAIProvider("test-key", {
      providerMode: "gemini",
      providerComponent: "providers.gemini",
      embeddingModel: false,
    });
    const embeddingsCreate = vi.fn();
    (provider as any).client = {
      embeddings: {
        create: embeddingsCreate,
      },
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    };

    const embedding = await provider.embedRetrievalQuery("Build a dashboard");

    expect(embedding).toEqual([]);
    expect(embeddingsCreate).not.toHaveBeenCalled();
    const metrics = renderMetricsText();
    expect(metrics).toContain('openagentgraph_provider_fallback_total{fallback_type="embedding_disabled"} 1');
    expect(metrics).toContain(
      'openagentgraph_provider_call_duration_ms_count{operation="embedding",provider_mode="gemini"} 1'
    );
  });

  it("returns empty embeddings instead of throwing when the API is unavailable", async () => {
    const provider = new OpenAIProvider("test-key");
    (provider as any).client = {
      embeddings: {
        create: vi.fn().mockRejectedValue(new Error("unavailable")),
      },
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    };

    const goalPacket = await provider.buildGoalPacket({
      goal: "Build a dashboard",
      successCriteria: ["Render the dashboard"],
      forbiddenScope: [],
      version: 1,
    });

    expect(goalPacket.embedding).toEqual([]);
    expect(goalPacket.criteriaEmbeddings).toEqual([[]]);
    const metrics = renderMetricsText();
    expect(metrics).toContain('openagentgraph_provider_fallback_total{fallback_type="embedding"} 2');
    expect(metrics).toContain(
      'openagentgraph_provider_call_duration_ms_count{operation="embedding",provider_mode="openai"} 2'
    );
    expect(metrics).toContain(
      'openagentgraph_failure_events_total{category="provider_fallback",component="providers.openai",outcome="recovered"} 2'
    );
  });
});

describe("summary fallback", () => {
  it("increments fallback metrics without leaking the underlying prompt or output", async () => {
    const provider = new OpenAIProvider("test-key");
    (provider as any).client = {
      embeddings: {
        create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] }),
      },
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("summary unavailable")),
        },
      },
    };

    const summary = await provider.summarizeCompletedNode({
      projection: {
        graph: {
          id: "graph-1",
        },
      },
      currentNode: {
        id: "node-1",
        output: "very sensitive output that should not become a metric label",
      },
    } as any);

    expect(summary.summary).toContain("very sensitive output");
    const metrics = renderMetricsText();
    expect(metrics).toContain('openagentgraph_provider_fallback_total{fallback_type="summary"} 1');
    expect(metrics).toContain(
      'openagentgraph_provider_call_duration_ms_count{operation="summarize_output",provider_mode="openai"} 1'
    );
    expect(metrics).toContain(
      'openagentgraph_failure_events_total{category="provider_fallback",component="providers.openai",outcome="recovered"} 1'
    );
    expect(metrics).not.toContain("very sensitive output");
    expect(metrics).not.toContain("summary unavailable");
  });

  it("records a hard provider failure shape when planning fails", async () => {
    const provider = new OpenAIProvider("test-key");
    (provider as any).client = {
      embeddings: {
        create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] }),
      },
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("planning unavailable")),
        },
      },
    };

    await expect(
      provider.planGraph(
        {
          id: "goal-1",
          version: 1,
          originalText: "Build a dashboard",
          successCriteria: [],
          forbiddenScope: [],
          embedding: [],
          criteriaEmbeddings: [],
          createdAt: "2026-04-17T00:00:00.000Z",
        },
        undefined
      )
    ).rejects.toThrow("planning unavailable");

    const metrics = renderMetricsText();
    expect(metrics).toContain(
      'openagentgraph_failure_events_total{category="provider_error",component="providers.openai",outcome="hard"} 1'
    );
    expect(metrics).toContain(
      'openagentgraph_provider_call_duration_ms_count{operation="plan_graph",provider_mode="openai"} 1'
    );
  });

  it("records bounded tool failure metrics without leaking file paths", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-openai-"));
    const provider = new OpenAIProvider("test-key");
    (provider as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    toolCalls: [{ tool: "readFile", path: "missing.txt" }],
                    finalOutput: "done",
                  }),
                },
              },
            ],
          }),
        },
      },
      embeddings: {
        create: vi.fn(),
      },
    };

    const result = await provider.executeNode(
      {
        projection: { graph: { id: "graph-1" } },
        activeGoalPacket: {
          id: "goal-1",
          version: 1,
          originalText: "Build a dashboard",
          successCriteria: [],
          forbiddenScope: [],
          embedding: [],
          criteriaEmbeddings: [],
          createdAt: "2026-04-17T00:00:00.000Z",
        },
        currentNode: {
          id: "node-1",
          title: "Read config",
          intent: "Read the config file",
          contract: {
            expectedArtifact: "config summary",
            allowedTools: ["readFile"],
            acceptanceCriteria: ["Read the file"],
            humanSummary: "Read the file",
          },
        },
        relevantOutputs: [],
      } as any,
      workspaceRoot
    );

    expect(result.output).toContain("done");
    const metrics = renderMetricsText();
    expect(metrics).toContain(
      'openagentgraph_failure_events_total{category="tool_failure",component="providers.openai",outcome="hard"} 1'
    );
    expect(metrics).toContain('openagentgraph_tool_execution_failures_total{tool="readFile"} 1');
    expect(metrics).toContain('openagentgraph_tool_execution_duration_ms_count{tool_kind="readFile"} 1');
    expect(metrics).not.toContain(workspaceRoot);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
});

describe("deterministic checks", () => {
  it("uses default placeholder detection when no specialized criterion matches", async () => {
    const result = await runDeterministicChecks(
      ["Provide a final summary"],
      {
        fileDiffs: [],
        commandResults: [],
        toolCallLog: [],
        workspaceChecksum: "checksum",
        workspaceChecksumBefore: "before",
        workspaceChecksumAfter: "after",
      },
      undefined,
      "TODO: fill this in"
    );

    expect(result.passed).toBe(false);
    expect(result.findings[0]).toMatch(/default validation/i);
  });
});
