import { describe, expect, it, vi } from "vitest";
import { createOpenAgentGraphClient, wrapOpenAI } from "./index";
import type {
  OpenAgentGraphAgentContextPack,
  OpenAgentGraphFrontierResponse,
} from "./index";

function makeOpenAI(response: unknown) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => response),
      },
    },
  };
}

describe("OpenAgentGraph SDK OpenAI instrumentation", () => {
  it("returns the original OpenAI response and sends a bounded success payload", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202 })) as unknown as typeof fetch;
    const client = createOpenAgentGraphClient({
      baseUrl: "http://localhost:3001/",
      graphId: "graph-1",
      authToken: "secret-token",
      actorHeaders: {
        "x-openagentgraph-actor-id": "operator",
        authorization: "Bearer stale-token",
        "content-type": "text/plain",
      },
      captureContent: true,
      redact: (value) => value.replace("secret", "[redacted]"),
      fetch: fetchMock,
    });
    const response = {
      choices: [{ message: { content: "safe answer" } }],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7,
      },
    };
    const openai = makeOpenAI(response);
    const wrapped = wrapOpenAI(openai, {
      openAgentGraph: client,
      label: "checkout prompt",
      metadata: { feature: "checkout" },
    });

    await expect(wrapped.chat.completions.create({
      model: "gpt-test",
      messages: [{ role: "user", content: "secret prompt" }],
    })).resolves.toBe(response);

    expect(openai.chat.completions.create).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/graphs/graph-1/instrumentation/llm-call",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          authorization: "Bearer secret-token",
          "x-openagentgraph-actor-id": "operator",
        }),
      })
    );
    const body = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body);
    expect(body).toMatchObject({
      provider: "openai",
      operation: "chat.completions.create",
      model: "gpt-test",
      status: "success",
      usage: {
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
      },
      label: "checkout prompt",
      metadata: { feature: "checkout" },
    });
    expect(body.promptPreview).toContain("[redacted] prompt");
    expect(body.outputPreview).toBe("safe answer");
  });

  it("reports failures and rethrows the original OpenAI error", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202 })) as unknown as typeof fetch;
    const client = createOpenAgentGraphClient({
      baseUrl: "http://localhost:3001",
      graphId: "graph-1",
      captureContent: true,
      fetch: fetchMock,
    });
    const error = new Error("OpenAI unavailable");
    const openai = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw error;
          }),
        },
      },
    };
    const wrapped = wrapOpenAI(openai, { openAgentGraph: client });

    await expect(wrapped.chat.completions.create({ model: "gpt-test", messages: [] })).rejects.toThrow(error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body);
    expect(body).toMatchObject({
      status: "error",
      errorPreview: "OpenAI unavailable",
      model: "gpt-test",
    });
  });

  it("does not throw telemetry failures into wrapped OpenAI calls", async () => {
    const onError = vi.fn();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    const client = createOpenAgentGraphClient({
      baseUrl: "http://localhost:3001",
      graphId: "graph-1",
      captureContent: false,
      fetch: fetchMock,
      onError,
    });
    const response = { choices: [{ message: { content: "ok" } }] };
    const wrapped = wrapOpenAI(makeOpenAI(response), { openAgentGraph: client });

    await expect(wrapped.chat.completions.create({ model: "gpt-test", messages: [] })).resolves.toBe(response);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledOnce();

    const body = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body);
    expect(body.promptPreview).toBeUndefined();
    expect(body.outputPreview).toBeUndefined();
  });

  it("does not throw redaction or custom telemetry client failures into wrapped OpenAI calls", async () => {
    const onError = vi.fn(() => {
      throw new Error("handler failed");
    });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202 })) as unknown as typeof fetch;
    const client = createOpenAgentGraphClient({
      baseUrl: "http://localhost:3001",
      graphId: "graph-1",
      captureContent: true,
      redact: () => {
        throw new Error("redaction failed");
      },
      fetch: fetchMock,
      onError,
    });
    const response = { choices: [{ message: { content: "ok" } }] };

    await expect(wrapOpenAI(makeOpenAI(response), { openAgentGraph: client }).chat.completions.create({
      model: "gpt-test",
      messages: [{ role: "user", content: "secret" }],
    })).resolves.toBe(response);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(onError).toHaveBeenCalled();
    const body = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body);
    expect(body.promptPreview).toBeUndefined();
    expect(body.outputPreview).toBeUndefined();

    const throwingOpenAgentGraph = {
      graphId: "graph-1",
      captureContent: true,
      preview: vi.fn(() => {
        throw new Error("preview failed");
      }),
      recordLlmCall: vi.fn(async () => {
        throw new Error("record failed");
      }),
    };

    await expect(wrapOpenAI(makeOpenAI(response), { openAgentGraph: throwingOpenAgentGraph }).chat.completions.create({
      model: "gpt-test",
      messages: [],
    })).resolves.toBe(response);
  });

  it("keeps failed-call error previews metadata-only unless content capture is enabled", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202 })) as unknown as typeof fetch;
    const client = createOpenAgentGraphClient({
      baseUrl: "http://localhost:3001",
      graphId: "graph-1",
      captureContent: false,
      fetch: fetchMock,
    });
    const error = new Error("secret prompt leaked by provider");
    const openai = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw error;
          }),
        },
      },
    };

    await expect(wrapOpenAI(openai, { openAgentGraph: client }).chat.completions.create({
      model: "gpt-test",
      messages: [{ role: "user", content: "secret prompt" }],
    })).rejects.toThrow(error);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body);
    expect(body.promptPreview).toBeUndefined();
    expect(body.errorPreview).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret prompt");
  });

  it("does not wait for slow telemetry before returning OpenAI results", async () => {
    const fetchMock = vi.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;
    const client = createOpenAgentGraphClient({
      baseUrl: "http://localhost:3001",
      graphId: "graph-1",
      fetch: fetchMock,
      telemetryTimeoutMs: 5,
    });
    const response = { choices: [{ message: { content: "ok" } }] };
    const wrapped = wrapOpenAI(makeOpenAI(response), { openAgentGraph: client });

    const result = await Promise.race([
      wrapped.chat.completions.create({ model: "gpt-test", messages: [] }).then((value) => ({ value })),
      new Promise<{ timeout: true }>((resolve) => setTimeout(() => resolve({ timeout: true }), 50)),
    ]);

    expect(result).toEqual({ value: response });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("bounds previews and metadata before sending telemetry", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202 })) as unknown as typeof fetch;
    const metadata = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`key-${index}`, "x".repeat(800)])
    );
    const client = createOpenAgentGraphClient({
      baseUrl: "http://localhost:3001",
      graphId: "graph-1",
      captureContent: true,
      fetch: fetchMock,
    });
    const response = { choices: [{ message: { content: "y".repeat(5000) } }] };
    const wrapped = wrapOpenAI(makeOpenAI(response), {
      openAgentGraph: client,
      label: "z".repeat(200),
      metadata,
    });

    await expect(wrapped.chat.completions.create({
      model: "gpt-test",
      messages: [{ role: "user", content: "x".repeat(5000) }],
    })).resolves.toBe(response);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body);
    expect(body.promptPreview.length).toBeLessThanOrEqual(4000);
    expect(body.outputPreview.length).toBeLessThanOrEqual(4000);
    expect(body.label.length).toBe(120);
    expect(Object.keys(body.metadata)).toHaveLength(20);
    expect(body.metadata["key-0"].length).toBeLessThanOrEqual(500);
  });
});

describe("OpenAgentGraph SDK agent collaboration", () => {
  it("fetches frontier and agent context with auth headers", async () => {
    const frontierPayload: OpenAgentGraphFrontierResponse = {
      graphId: "graph 1",
      generatedAt: "2026-06-04T00:00:00.000Z",
      summary: {
        runControlState: "idle",
        frontierStatus: "on_track",
        readyCount: 1,
        runningCount: 0,
        blockedCount: 0,
        openProposalCount: 0,
      },
      frontier: [
        {
          nodeId: "node-1",
          title: "Review frontier",
          kind: "work",
          status: "ready",
          humanSummary: "Review the current frontier.",
          dependsOnNodeIds: [],
          evidenceCoverage: "partial",
          confidenceBadge: "medium",
          updatedAt: "2026-06-04T00:00:00.000Z",
        },
      ],
      recentAgentActivity: [],
      planProposals: [],
    };
    const contextPayload: OpenAgentGraphAgentContextPack = {
      graphId: "graph 1",
      generatedAt: "2026-06-04T00:00:01.000Z",
      graph: {
        id: "graph 1",
        title: "Agent SDK test",
        goal: "Type SDK coordination responses.",
        status: "idle",
        activeGoalVersionId: "goal-1",
      },
      run: {
        runControlState: "idle",
        frontierStatus: "on_track",
        plannedNodeCount: 1,
        completedNodeCount: 0,
        failedNodeCount: 0,
        runHealthSummary: "The run is ready.",
      },
      selectedNode: frontierPayload.frontier[0],
      frontier: frontierPayload.frontier,
      recentAgentActivity: [],
      planProposals: [],
      instructions: ["Verify source files before editing."],
    };
    const responses = [frontierPayload, contextPayload];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => responses.shift() ?? {},
    })) as unknown as typeof fetch;
    const client = createOpenAgentGraphClient({
      baseUrl: "http://localhost:3001/",
      graphId: "graph 1",
      actorHeaders: { "x-openagentgraph-actor-id": "operator" },
      fetch: fetchMock,
    });

    const frontierResult: OpenAgentGraphFrontierResponse = await client.getFrontier({ limit: 3 });
    const contextResult: OpenAgentGraphAgentContextPack = await client.getAgentContext({ nodeId: "node-1", frontierLimit: 2 });

    expect(frontierResult.frontier[0].status).toBe("ready");
    expect(contextResult.selectedNode?.nodeId).toBe("node-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3001/graphs/graph%201/frontier?limit=3",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-openagentgraph-actor-id": "operator",
        }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3001/graphs/graph%201/agent-context?nodeId=node-1&frontierLimit=2",
      expect.any(Object)
    );
  });

  it("sends bounded explicit agent payloads", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ accepted: true }),
    })) as unknown as typeof fetch;
    const client = createOpenAgentGraphClient({
      baseUrl: "http://localhost:3001",
      graphId: "graph-1",
      fetch: fetchMock,
    });
    const agent = {
      agentId: "codex",
      displayName: "Codex",
      kind: "codex" as const,
      capabilities: Array.from({ length: 25 }, (_, index) => `capability-${index}`),
    };

    await client.registerAgent(agent);
    await client.reportProgress({
      agent,
      status: "progress",
      summary: "x".repeat(5000),
      metadata: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`key-${index}`, "y".repeat(800)])),
    });
    await client.submitEvidence({
      agent,
      summary: "Evidence collected.",
      files: Array.from({ length: 25 }, (_, index) => `src/file-${index}.ts`),
      confidence: 2,
    });
    await client.proposePlan({
      agent,
      title: "Add tests",
      summary: "Propose tests.",
      nodes: Array.from({ length: 10 }, (_, index) => ({
        title: `Node ${index}`,
        intent: "Implement safely.",
      })),
    });
    await client.acceptPlanProposal("proposal 1");
    await client.dismissPlanProposal("proposal 2", "z".repeat(700));

    const progressBody = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[1][1].body);
    const evidenceBody = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[2][1].body);
    const proposalBody = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[3][1].body);
    const dismissBody = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[5][1].body);

    expect(progressBody.summary.length).toBeLessThanOrEqual(4000);
    expect(Object.keys(progressBody.metadata)).toHaveLength(20);
    expect(progressBody.agent.capabilities).toHaveLength(20);
    expect(evidenceBody.files).toHaveLength(20);
    expect(evidenceBody.confidence).toBe(1);
    expect(proposalBody.nodes).toHaveLength(8);
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "http://localhost:3001/graphs/graph-1/agent/plan-proposals/proposal%201/accept",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "http://localhost:3001/graphs/graph-1/agent/plan-proposals/proposal%202/dismiss",
      expect.objectContaining({ method: "POST" })
    );
    expect(dismissBody.reason.length).toBe(500);
  });

  it("throws clear errors for explicit agent method failures", async () => {
    const agent = { agentId: "codex", displayName: "Codex", kind: "codex" as const };
    const failures = [
      {
        name: "getFrontier",
        invoke: (client: ReturnType<typeof createOpenAgentGraphClient>) => client.getFrontier(),
      },
      {
        name: "getAgentContext",
        invoke: (client: ReturnType<typeof createOpenAgentGraphClient>) => client.getAgentContext(),
      },
      {
        name: "registerAgent",
        invoke: (client: ReturnType<typeof createOpenAgentGraphClient>) => client.registerAgent(agent),
      },
      {
        name: "reportProgress",
        invoke: (client: ReturnType<typeof createOpenAgentGraphClient>) =>
          client.reportProgress({ agent, status: "progress", summary: "Checked work." }),
      },
      {
        name: "submitEvidence",
        invoke: (client: ReturnType<typeof createOpenAgentGraphClient>) =>
          client.submitEvidence({ agent, summary: "Checked work." }),
      },
      {
        name: "proposePlan",
        invoke: (client: ReturnType<typeof createOpenAgentGraphClient>) =>
          client.proposePlan({
            agent,
            title: "Add tests",
            summary: "Propose tests.",
            nodes: [{ title: "Write tests", intent: "Cover errors." }],
          }),
      },
      {
        name: "acceptPlanProposal",
        invoke: (client: ReturnType<typeof createOpenAgentGraphClient>) =>
          client.acceptPlanProposal("proposal-1"),
      },
      {
        name: "dismissPlanProposal",
        invoke: (client: ReturnType<typeof createOpenAgentGraphClient>) =>
          client.dismissPlanProposal("proposal-1", "Not needed."),
      },
    ];

    for (const failure of failures) {
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 403,
        headers: new Headers(),
      })) as unknown as typeof fetch;
      const client = createOpenAgentGraphClient({
        baseUrl: "http://localhost:3001",
        graphId: "graph-1",
        fetch: fetchMock,
      });

      await expect(failure.invoke(client), failure.name).rejects.toThrow(
        "OpenAgentGraph request failed with status 403"
      );
      expect(fetchMock, failure.name).toHaveBeenCalledOnce();
    }
  });
});
