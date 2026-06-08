import crypto from "crypto";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphEvent, GraphProjection } from "@openagentgraph/shared";
import { loadAppConfig, setAppConfigForTests } from "../config.js";
import { setStructuredLogSink } from "../observability/logger.js";
import { renderMetricsText, resetMetricsForTests } from "../observability/metrics.js";

const repoMocks = vi.hoisted(() => ({
  appendGraphEvent: vi.fn(),
  appendGraphEvents: vi.fn(),
  createGraphWithGoalPacket: vi.fn(),
  createGraph: vi.fn(),
  getGraphProjection: vi.fn(),
  getLatestRunWorkspaceRoot: vi.fn(),
  getNode: vi.fn(),
}));

vi.mock("../db/graphRepo.js", () => ({
  appendGraphEvent: repoMocks.appendGraphEvent,
  appendGraphEvents: repoMocks.appendGraphEvents,
  getDashboardOverview: vi.fn(),
  getRunComparison: vi.fn(),
  createGraphWithGoalPacket: repoMocks.createGraphWithGoalPacket,
  createGraph: repoMocks.createGraph,
  getGraphProjection: repoMocks.getGraphProjection,
  getChangesSinceLastViewed: vi.fn(async () => ({
    lastSeenSequence: 0,
    currentSequence: 0,
    newEventCount: 0,
    runControlStateChanged: false,
    frontierStatusChanged: false,
    newAlertsAppeared: false,
    changesSinceLastViewedSummary: "No important updates right now.",
  })),
  getGraphRunReport: vi.fn(),
  getSimilarRuns: vi.fn(),
  getLatestRunWorkspaceRoot: repoMocks.getLatestRunWorkspaceRoot,
  getNode: repoMocks.getNode,
  withActorContext: vi.fn((projection) => projection),
}));

vi.mock("../runner/runner.js", () => ({
  runGraph: vi.fn(async () => undefined),
}));

import { graphRoutes } from "./graphs.js";
import { runGraph } from "../runner/runner.js";

function createJwt(payload: Record<string, unknown>, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function makeProjection(): GraphProjection {
  return {
    graph: {
      id: "graph-1",
      title: "Graph 1",
      goal: "Build the dashboard",
      status: "running",
      originalGoalVersionId: "goal-1",
      activeGoalVersionId: "goal-1",
      createdAt: "2026-04-16T10:00:00.000Z",
      updatedAt: "2026-04-16T10:00:00.000Z",
    },
    goalPackets: [],
    nodes: [],
    edges: [],
    events: [],
    driftState: "on_track",
    driftSummary: "",
    currentDriftSummary: null,
    frontierStatus: "on_track",
    runControlState: "running",
    canResume: false,
    canPause: true,
    canStop: true,
    approvalState: "not_requested",
    waitingForApproval: false,
    needsHumanReview: false,
    graphAnnotations: [],
    annotationCount: 0,
    lineageDescriptors: [],
    lineageCount: 0,
    plannedNodeCount: 1,
    completedNodeCount: 0,
    failedNodeCount: 0,
    supersededNodeCount: 0,
    revisedNodeCount: 0,
    passRate: 0,
    revisionRate: 0,
    driftTrend: "steady",
    evidenceCoverageRate: 0,
    runHealthSummary: "0 of 1 steps completed. Most recent work is on track.",
    alerts: [],
  };
}

describe("graph routes auth gating", () => {
  const entries: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    repoMocks.appendGraphEvent.mockReset();
    repoMocks.appendGraphEvents.mockReset();
    repoMocks.createGraphWithGoalPacket.mockReset();
    repoMocks.createGraph.mockReset();
    repoMocks.getGraphProjection.mockReset();
    repoMocks.getLatestRunWorkspaceRoot.mockReset();
    repoMocks.getNode.mockReset();
    vi.mocked(runGraph).mockClear();

    repoMocks.getGraphProjection.mockResolvedValue(makeProjection());
    repoMocks.getLatestRunWorkspaceRoot.mockResolvedValue(undefined);
    repoMocks.getNode.mockResolvedValue({
      id: "node-1",
      graphId: "graph-1",
    });
    repoMocks.appendGraphEvent.mockImplementation(async (input: Omit<GraphEvent, "id" | "ts"> & { kind: GraphEvent["kind"] }) => ({
      id: "evt-1",
      ts: "2026-04-16T10:00:00.000Z",
      seq: 1,
      ...input,
    }));
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "test",
        OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "true",
      })
    );
    entries.length = 0;
    setStructuredLogSink((entry) => {
      entries.push(entry as unknown as Record<string, unknown>);
    });
  });

  afterEach(() => {
    setStructuredLogSink(undefined);
    setAppConfigForTests(undefined);
    resetMetricsForTests();
    vi.restoreAllMocks();
  });

  it("rejects protected actions when actor context is missing", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/pause",
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "This action requires a signed-in operator." });
    expect(repoMocks.appendGraphEvent).not.toHaveBeenCalled();
    expect(renderMetricsText()).toContain('openagentgraph_permission_denials_total{action="auth_required"} 1');
    await app.close();
  });

  it("blocks viewers from protected write actions with a plain-English error", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/annotations",
      headers: {
        "x-openagentgraph-actor-id": "viewer",
      },
      payload: {
        text: "Please review this step.",
        kind: "note",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "This action requires operator access." });
    expect(repoMocks.appendGraphEvent).not.toHaveBeenCalled();
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "routes.graphs",
          message: "This action requires operator access.",
          errorCode: "PERMISSION_DENIED",
          actorId: "viewer",
          requestId: expect.any(String),
        }),
      ])
    );
    expect(renderMetricsText()).toContain('openagentgraph_permission_denials_total{action="annotate"} 1');
    await app.close();
  });

  it("allows operators to request review but not approve runs", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const reviewResponse = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/review",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        reason: "Need guidance",
      },
    });

    expect(reviewResponse.statusCode).toBe(202);
    expect(repoMocks.appendGraphEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "run.review_requested",
        payload: expect.objectContaining({
          actor: expect.objectContaining({
            actorId: "operator",
            displayName: "Operator",
            role: "operator",
          }),
        }),
      })
    );

    const approveResponse = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/approve",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {},
    });

    expect(approveResponse.statusCode).toBe(403);
    expect(approveResponse.json()).toEqual({ error: "You do not have permission to approve this run." });
    await app.close();
  });

  it("allows reviewers to approve runs and records actor attribution", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/approve",
      headers: {
        "x-openagentgraph-actor-id": "reviewer",
      },
      payload: {
        reason: "Looks good",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(repoMocks.appendGraphEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "run.approved",
        payload: expect.objectContaining({
          authorLabel: "Reviewer",
          actor: expect.objectContaining({
            actorId: "reviewer",
            displayName: "Reviewer",
            role: "reviewer",
          }),
          reason: "Looks good",
        }),
      })
    );
    await app.close();
  });

  it("rejects actor headers when development auth shortcuts are disabled", async () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "production",
        OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "false",
      })
    );
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/approve",
      headers: {
        "x-openagentgraph-actor-id": "reviewer",
      },
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "This action requires a signed-in operator." });
    await app.close();
  });

  it("requires operator access before graph creation or provider-backed run mutations", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const createMissing = await app.inject({
      method: "POST",
      url: "/graphs",
      payload: {
        title: "Untrusted graph",
        goal: "Spend hosted provider tokens",
      },
    });
    const createViewer = await app.inject({
      method: "POST",
      url: "/graphs",
      headers: { "x-openagentgraph-actor-id": "viewer" },
      payload: {
        title: "Viewer graph",
        goal: "Mutate graph state",
      },
    });
    const runViewer = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/runs",
      headers: { "x-openagentgraph-actor-id": "viewer" },
      payload: {
        workspaceRoot: "C:/workspace",
      },
    });
    const retryMissing = await app.inject({
      method: "POST",
      url: "/nodes/node-1/retry",
      payload: {},
    });
    const replanReviewer = await app.inject({
      method: "POST",
      url: "/nodes/node-1/replan",
      headers: { "x-openagentgraph-actor-id": "reviewer" },
      payload: {
        newGoal: "Change the goal",
        reason: "Reviewer should not replan",
      },
    });

    expect(createMissing.statusCode).toBe(401);
    expect(createViewer.statusCode).toBe(403);
    expect(runViewer.statusCode).toBe(403);
    expect(retryMissing.statusCode).toBe(401);
    expect(replanReviewer.statusCode).toBe(403);
    expect(repoMocks.createGraph).not.toHaveBeenCalled();
    expect(repoMocks.createGraphWithGoalPacket).not.toHaveBeenCalled();
    expect(repoMocks.getGraphProjection).not.toHaveBeenCalled();
    expect(repoMocks.getNode).not.toHaveBeenCalled();
    expect(repoMocks.appendGraphEvent).not.toHaveBeenCalled();
    expect(runGraph).not.toHaveBeenCalled();
    await app.close();
  });

  it("logs provider degradation with safe metadata when execution is requested without configuration", async () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "test",
        OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "true",
      })
    );
    repoMocks.getGraphProjection.mockResolvedValue({
      ...makeProjection(),
      runControlState: "idle",
      graph: {
        ...makeProjection().graph,
        status: "idle",
      },
    });
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/runs",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        workspaceRoot: "C:/workspace",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "AI provider is not configured; execution is unavailable.",
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "routes.graphs",
          errorCode: "PROVIDER_NOT_CONFIGURED",
          graphId: "graph-1",
          message: "AI provider is not configured; execution is unavailable.",
        }),
      ])
    );
    await app.close();
  });

  it("creates provider-neutral OpenAI-compatible adapters for run execution", async () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "test",
        OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "true",
        OPENAGENTGRAPH_AI_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-test-runtime-key-123456789",
      })
    );
    repoMocks.getGraphProjection.mockResolvedValue({
      ...makeProjection(),
      runControlState: "idle",
      graph: {
        ...makeProjection().graph,
        status: "idle",
      },
    });
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/runs",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        workspaceRoot: "C:/workspace",
      },
    });

    expect(response.statusCode).toBe(202);
    const provider = vi.mocked(runGraph).mock.calls[0]?.[2] as any;
    expect(provider.providerMode).toBe("gemini");
    expect(provider.providerLabel).toBe("Gemini");
    expect(provider.providerComponent).toBe("providers.gemini");
    expect(provider.embeddingModel).toBeUndefined();
    await app.close();
  });

  it("creates no-auth adapters for no-key custom OpenAI-compatible run execution", async () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "test",
        OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "true",
        OPENAGENTGRAPH_AI_PROVIDER: "openai-compatible",
        OPENAGENTGRAPH_AI_MODEL: "local-compatible-model",
        OPENAGENTGRAPH_AI_BASE_URL: "https://gateway.example.com/v1",
      })
    );
    repoMocks.getGraphProjection.mockResolvedValue({
      ...makeProjection(),
      runControlState: "idle",
      graph: {
        ...makeProjection().graph,
        status: "idle",
      },
    });
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/runs",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        workspaceRoot: "C:/workspace",
      },
    });

    expect(response.statusCode).toBe(202);
    const provider = vi.mocked(runGraph).mock.calls[0]?.[2] as any;
    expect(provider.providerMode).toBe("openai-compatible");
    expect(provider.providerComponent).toBe("providers.openai_compatible");
    expect(provider.client.authHeaders({})).toEqual({});
    await app.close();
  });

  it("rejects invalid jwt auth safely without leaking the raw token", async () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "production",
        OPENAGENTGRAPH_AUTH_MODE: "jwt",
        OPENAGENTGRAPH_JWT_SECRET: "super-secret",
      })
    );
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/pause",
      headers: {
        authorization: "Bearer definitely-not-valid",
      },
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Your session is not valid for this action." });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "routes.graphs",
          message: "Your session is not valid for this action.",
          errorCode: "AUTH_INVALID",
        }),
      ])
    );
    expect(JSON.stringify(entries)).not.toContain("definitely-not-valid");
    expect(renderMetricsText()).toContain('openagentgraph_permission_denials_total{action="auth_invalid"} 1');
    await app.close();
  });

  it("uses verified jwt identity for actor-attributed approval events", async () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "production",
        OPENAGENTGRAPH_AUTH_MODE: "jwt",
        OPENAGENTGRAPH_JWT_SECRET: "super-secret",
      })
    );
    const token = createJwt(
      {
        sub: "reviewer-1",
        name: "Priya Reviewer",
        email: "priya@example.com",
        role: "reviewer",
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      "super-secret"
    );
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/approve",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        reason: "Approved from verified auth",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(repoMocks.appendGraphEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "run.approved",
        payload: expect.objectContaining({
          authorLabel: "Priya Reviewer",
          actor: {
            actorId: "reviewer-1",
            displayName: "Priya Reviewer",
            role: "reviewer",
          },
          reason: "Approved from verified auth",
        }),
      })
    );
    await app.close();
  });
});

describe("graph instrumentation route", () => {
  beforeEach(() => {
    repoMocks.appendGraphEvent.mockReset();
    repoMocks.appendGraphEvents.mockReset();
    repoMocks.getGraphProjection.mockReset();
    repoMocks.getLatestRunWorkspaceRoot.mockReset();
    repoMocks.getNode.mockReset();

    repoMocks.getGraphProjection.mockResolvedValue(makeProjection());
    repoMocks.appendGraphEvent.mockImplementation(async (input: Omit<GraphEvent, "id" | "ts"> & { kind: GraphEvent["kind"] }) => ({
      id: `evt-${repoMocks.appendGraphEvent.mock.calls.length}`,
      ts: "2026-06-01T00:00:00.000Z",
      seq: repoMocks.appendGraphEvent.mock.calls.length,
      ...input,
    }));
    repoMocks.appendGraphEvents.mockImplementation(async (inputs: Array<Omit<GraphEvent, "id" | "ts"> & { kind: GraphEvent["kind"] }>) =>
      inputs.map((input, index) => ({
        id: `evt-batch-${index}`,
        ts: "2026-06-01T00:00:00.000Z",
        seq: index + 1,
        ...input,
      }))
    );
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "test",
        OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "true",
      })
    );
  });

  afterEach(() => {
    setAppConfigForTests(undefined);
    resetMetricsForTests();
    vi.restoreAllMocks();
  });

  it("rejects instrumentation ingest without operator/admin access", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const missing = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/instrumentation/llm-call",
      payload: { status: "success", durationMs: 10 },
    });
    const viewer = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/instrumentation/llm-call",
      headers: { "x-openagentgraph-actor-id": "viewer" },
      payload: { status: "success", durationMs: 10 },
    });
    const reviewer = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/instrumentation/llm-call",
      headers: { "x-openagentgraph-actor-id": "reviewer" },
      payload: { status: "success", durationMs: 10 },
    });

    expect(missing.statusCode).toBe(401);
    expect(viewer.statusCode).toBe(403);
    expect(reviewer.statusCode).toBe(403);
    expect(repoMocks.appendGraphEvent).not.toHaveBeenCalled();
  });

  it("translates successful SDK instrumentation into canonical GraphEvents", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/instrumentation/llm-call",
      headers: { "x-openagentgraph-actor-id": "operator" },
      payload: {
        provider: "openai",
        operation: "chat.completions.create",
        model: "gpt-test",
        status: "success",
        durationMs: 123,
        usage: { promptTokens: 10, completionTokens: 20 },
        promptPreview: "redacted prompt",
        outputPreview: "redacted output",
        metadata: { feature: "checkout" },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(repoMocks.appendGraphEvent).toHaveBeenCalledTimes(4);
    expect(repoMocks.appendGraphEvent.mock.calls.map(([event]) => event.kind)).toEqual([
      "node.planned",
      "node.executing",
      "node.output",
      "node.completed",
    ]);
    const completed = repoMocks.appendGraphEvent.mock.calls[3][0];
    expect(completed.payload).toMatchObject({
      output: "redacted output",
      evidence: {
        metadata: {
          provider: "openai",
          operation: "chat.completions.create",
          model: "gpt-test",
          durationMs: 123,
          promptTokens: 10,
          completionTokens: 20,
          feature: "checkout",
        },
      },
    });
  });

  it("translates failed SDK instrumentation into a failed node event", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/instrumentation/llm-call",
      headers: { "x-openagentgraph-actor-id": "admin" },
      payload: {
        status: "error",
        durationMs: 50,
        errorPreview: "provider unavailable",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(repoMocks.appendGraphEvent).toHaveBeenCalledTimes(3);
    expect(repoMocks.appendGraphEvent.mock.calls.map(([event]) => event.kind)).toEqual([
      "node.planned",
      "node.executing",
      "node.failed",
    ]);
    expect(repoMocks.appendGraphEvent.mock.calls[2][0].payload).toEqual({
      reason: "provider unavailable",
      metadata: expect.objectContaining({
        durationMs: 50,
        provider: "openai",
        operation: "chat.completions.create",
        status: "error",
      }),
    });
  });

  it("rejects oversized instrumentation metadata before appending events", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/instrumentation/llm-call",
      headers: { "x-openagentgraph-actor-id": "operator" },
      payload: {
        status: "success",
        durationMs: 10,
        metadata: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key-${index}`, "value"])),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(repoMocks.appendGraphEvent).not.toHaveBeenCalled();
  });
});

describe("graph agent collaboration routes", () => {
  beforeEach(() => {
    repoMocks.appendGraphEvent.mockReset();
    repoMocks.appendGraphEvents.mockReset();
    repoMocks.getGraphProjection.mockReset();
    repoMocks.getLatestRunWorkspaceRoot.mockReset();
    repoMocks.getNode.mockReset();
    vi.mocked(runGraph).mockClear();

    repoMocks.getGraphProjection.mockResolvedValue({
      ...makeProjection(),
      nodes: [
        {
          id: "node-ready",
          graphId: "graph-1",
          kind: "work",
          title: "Implement agent coordination",
          intent: "Add external agent collaboration.",
          humanSummary: "Agent coordination work is ready.",
          status: "ready",
          contract: {
            expectedArtifact: "External agent coordination layer",
            allowedTools: [],
            acceptanceCriteria: ["External agents can submit context-safe updates."],
            humanSummary: "Build external agent coordination.",
          },
          baselineGoalVersionId: "goal-1",
          activeGoalVersionId: "goal-1",
          dependsOnNodeIds: [],
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      agentActivity: [
        {
          id: "activity-1",
          graphId: "graph-1",
          kind: "progress",
          summary: "Codex started reviewing the graph.",
          createdAt: "2026-06-01T00:02:00.000Z",
          agent: {
            agentId: "codex",
            displayName: "Codex",
            kind: "codex",
          },
        },
      ],
      agentPlanProposals: [
        {
          proposalId: "proposal-1",
          graphId: "graph-1",
          createdAt: "2026-06-01T00:03:00.000Z",
          agent: {
            agentId: "gemini",
            displayName: "Gemini",
            kind: "gemini",
          },
          title: "Add agent tests",
          summary: "Add focused external agent coordination tests.",
          nodes: [
            {
              title: "Write agent tests",
              intent: "Add backend route coverage for external agent coordination endpoints.",
              dependsOnNodeIds: ["node-ready"],
              acceptanceCriteria: ["Agent route tests pass."],
            },
          ],
        },
      ],
    } satisfies GraphProjection);
    repoMocks.appendGraphEvent.mockImplementation(async (input: Omit<GraphEvent, "id" | "ts"> & { kind: GraphEvent["kind"] }) => ({
      id: `evt-${repoMocks.appendGraphEvent.mock.calls.length}`,
      ts: "2026-06-01T00:00:00.000Z",
      seq: repoMocks.appendGraphEvent.mock.calls.length,
      ...input,
    }));
    repoMocks.appendGraphEvents.mockImplementation(async (inputs: Array<Omit<GraphEvent, "id" | "ts"> & { kind: GraphEvent["kind"] }>) =>
      inputs.map((input, index) => ({
        id: `evt-batch-${index}`,
        ts: "2026-06-01T00:00:00.000Z",
        seq: index + 1,
        ...input,
      }))
    );
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "test",
        OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "true",
      })
    );
  });

  afterEach(() => {
    setAppConfigForTests(undefined);
    resetMetricsForTests();
    vi.restoreAllMocks();
  });

  it("returns frontier and agent context without provider configuration", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const frontierResponse = await app.inject({
      method: "GET",
      url: "/graphs/graph-1/frontier",
    });
    const contextResponse = await app.inject({
      method: "GET",
      url: "/graphs/graph-1/agent-context?nodeId=node-ready",
    });

    expect(frontierResponse.statusCode).toBe(200);
    expect(frontierResponse.json()).toMatchObject({
      graphId: "graph-1",
      summary: {
        readyCount: 1,
        openProposalCount: 1,
        claimableReadyCount: 1,
        inProgressCount: 0,
        blockedActionCount: 0,
        deferredReadyCount: 0,
      },
      frontier: [
        {
          nodeId: "node-ready",
          title: "Implement agent coordination",
          schedulingState: "claimable",
          agentAction: "start",
        },
      ],
    });
    expect(contextResponse.statusCode).toBe(200);
    expect(contextResponse.json()).toMatchObject({
      graphId: "graph-1",
      run: {
        claimableReadyCount: 1,
      },
      selectedNode: {
        nodeId: "node-ready",
        schedulingState: "claimable",
      },
      recentAgentActivity: [
        {
          summary: "Codex started reviewing the graph.",
        },
      ],
    });
    expect(JSON.stringify(contextResponse.json())).not.toContain("apiKey");
    await app.close();
  });

  it("requires viewer-or-better auth for agent read endpoints in jwt mode", async () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "test",
        OPENAGENTGRAPH_AUTH_MODE: "jwt",
        OPENAGENTGRAPH_JWT_SECRET: "super-secret",
      })
    );
    const viewerToken = createJwt(
      {
        sub: "viewer-1",
        name: "Vera Viewer",
        role: "viewer",
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      "super-secret"
    );
    const expiredToken = createJwt(
      {
        sub: "viewer-2",
        name: "Expired Viewer",
        role: "viewer",
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      "super-secret"
    );
    const app = Fastify();
    await app.register(graphRoutes);

    for (const url of ["/graphs/graph-1/frontier", "/graphs/graph-1/agent-context?nodeId=node-ready"]) {
      const missing = await app.inject({ method: "GET", url });
      const invalid = await app.inject({
        method: "GET",
        url,
        headers: { authorization: "Bearer not-a-real-token" },
      });
      const expired = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      const viewer = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(missing.statusCode).toBe(401);
      expect(invalid.statusCode).toBe(401);
      expect(expired.statusCode).toBe(401);
      expect(viewer.statusCode).toBe(200);
    }
    await app.close();
  });

  it("requires a configured actor header for agent read endpoints in production dev-header opt-in mode", async () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "production",
        OPENAGENTGRAPH_AUTH_MODE: "dev_header",
        OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "true",
        OPENAGENTGRAPH_ALLOW_UNSAFE_DEV_AUTH_IN_PRODUCTION: "true",
      })
    );
    const app = Fastify();
    await app.register(graphRoutes);

    for (const url of ["/graphs/graph-1/frontier", "/graphs/graph-1/agent-context?nodeId=node-ready"]) {
      const missing = await app.inject({ method: "GET", url });
      const invalid = await app.inject({
        method: "GET",
        url,
        headers: { "x-openagentgraph-actor-id": "not-configured" },
      });
      const viewer = await app.inject({
        method: "GET",
        url,
        headers: { "x-openagentgraph-actor-id": "viewer" },
      });

      expect(missing.statusCode).toBe(401);
      expect(invalid.statusCode).toBe(401);
      expect(viewer.statusCode).toBe(200);
    }
    await app.close();
  });

  it("sanitizes agent read payloads before returning them", async () => {
    const workspaceRoot = "C:\\Users\\yashm\\Desktop\\OpenAgentGraphV1Publish";
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "test",
        OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "true",
        OPENAGENTGRAPH_WORKSPACE_ROOT: workspaceRoot,
      })
    );
    repoMocks.getGraphProjection.mockResolvedValue({
      ...makeProjection(),
      graph: {
        ...makeProjection().graph,
        title: "Graph Bearer abc.def.ghi",
        goal: `Read ${workspaceRoot}\\packages\\backend\\src\\secret.ts with OPENAI_API_KEY=sk_123456789012`,
      },
      nodes: [
        {
          id: "node-ready",
          graphId: "graph-1",
          kind: "work",
          title: `${workspaceRoot}\\packages\\backend\\src\\secret.ts`,
          intent: "Do not return source bodies.",
          humanSummary: "Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature near C:\\Users\\yashm\\Desktop\\outside.txt",
          status: "ready",
          contract: {
            expectedArtifact: "Safe context",
            allowedTools: [],
            acceptanceCriteria: ["Secrets are redacted."],
            humanSummary: "Build safe context.",
          },
          baselineGoalVersionId: "goal-1",
          activeGoalVersionId: "goal-1",
          dependsOnNodeIds: [],
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      agentActivity: [
        {
          id: "activity-1",
          graphId: "graph-1",
          kind: "progress",
          summary: `Checked ${workspaceRoot}\\packages\\backend\\src\\secret.ts with Bearer abc.def.ghi`,
          createdAt: "2026-06-01T00:02:00.000Z",
          agent: {
            agentId: "codex",
            displayName: "Codex sk_123456789012",
            kind: "codex",
          },
        },
      ],
      agentPlanProposals: [],
    } satisfies GraphProjection);
    const app = Fastify();
    await app.register(graphRoutes);

    const contextResponse = await app.inject({
      method: "GET",
      url: "/graphs/graph-1/agent-context?nodeId=node-ready",
    });
    const frontierResponse = await app.inject({
      method: "GET",
      url: "/graphs/graph-1/frontier",
    });
    const body = JSON.stringify({
      context: contextResponse.json(),
      frontier: frontierResponse.json(),
    });

    expect(contextResponse.statusCode).toBe(200);
    expect(frontierResponse.statusCode).toBe(200);
    expect(body).not.toContain("sk_123456789012");
    expect(body).not.toContain("Bearer abc.def.ghi");
    expect(body).not.toContain("eyJhbGci");
    expect(body).not.toContain("C:\\Users\\yashm");
    expect(body).toContain("<workspace>/packages/backend/src/secret.ts");
    await app.close();
  });

  it("rejects external agent mutations without operator/admin access", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const missing = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/progress",
      payload: {
        agent: { agentId: "codex", displayName: "Codex", kind: "codex" },
        status: "progress",
        summary: "Working.",
      },
    });
    const viewer = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/evidence",
      headers: { "x-openagentgraph-actor-id": "viewer" },
      payload: {
        agent: { agentId: "codex", displayName: "Codex", kind: "codex" },
        summary: "Checked files.",
      },
    });
    const reviewer = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/plan-proposals",
      headers: { "x-openagentgraph-actor-id": "reviewer" },
      payload: {
        agent: { agentId: "admin", displayName: "Fake Admin", kind: "script" },
        title: "Try to propose as reviewer",
        summary: "agentId must not grant permission.",
        nodes: [{ title: "Do work", intent: "Should not be accepted." }],
      },
    });

    expect(missing.statusCode).toBe(401);
    expect(viewer.statusCode).toBe(403);
    expect(reviewer.statusCode).toBe(403);
    expect(repoMocks.appendGraphEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("allows operators to report, propose, register, and administer agent proposals", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const register = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/register",
      headers: { "x-openagentgraph-actor-id": "operator" },
      payload: {
        agent: { agentId: "codex", displayName: "Codex", kind: "codex" },
      },
    });
    const progress = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/progress",
      headers: { "x-openagentgraph-actor-id": "operator" },
      payload: {
        agent: { agentId: "codex", displayName: "Codex", kind: "codex" },
        nodeId: "node-ready",
        status: "progress",
        summary: "Working.",
      },
    });
    const proposal = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/plan-proposals",
      headers: { "x-openagentgraph-actor-id": "operator" },
      payload: {
        agent: { agentId: "codex", displayName: "Codex", kind: "codex" },
        title: "Add follow-up",
        summary: "Add safe follow-up work.",
        nodes: [{ title: "Follow-up", intent: "Do bounded follow-up." }],
      },
    });
    const dismiss = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/plan-proposals/proposal-1/dismiss",
      headers: { "x-openagentgraph-actor-id": "operator" },
      payload: { reason: "Handled." },
    });

    expect(register.statusCode).toBe(201);
    expect(progress.statusCode).toBe(201);
    expect(proposal.statusCode).toBe(201);
    expect(dismiss.statusCode).toBe(201);
    await app.close();
  });

  it("rejects oversized agent evidence metadata before appending events", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/evidence",
      headers: { "x-openagentgraph-actor-id": "operator" },
      payload: {
        agent: { agentId: "codex", displayName: "Codex", kind: "codex" },
        summary: "Checked files.",
        metadata: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key-${index}`, "value"])),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(repoMocks.appendGraphEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts proposals by appending planned nodes and an inert accepted event", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/plan-proposals/proposal-1/accept",
      headers: { "x-openagentgraph-actor-id": "admin" },
    });

    expect(response.statusCode).toBe(201);
    expect(repoMocks.appendGraphEvents).toHaveBeenCalledTimes(1);
    const batch = repoMocks.appendGraphEvents.mock.calls[0][0];
    expect(batch.map((event: GraphEvent) => event.kind)).toEqual([
      "node.planned",
      "agent.plan_accepted",
    ]);
    expect(batch[0].payload).toMatchObject({
      title: "Write agent tests",
      intent: "Add backend route coverage for external agent coordination endpoints.",
      dependsOnNodeIds: ["node-ready"],
    });
    expect(repoMocks.appendGraphEvent).not.toHaveBeenCalled();
    expect(vi.mocked(runGraph)).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not partially accept proposals when the batch append fails", async () => {
    const app = Fastify();
    repoMocks.appendGraphEvents.mockRejectedValueOnce(new Error("batch failed"));
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/plan-proposals/proposal-1/accept",
      headers: { "x-openagentgraph-actor-id": "admin" },
    });

    expect(response.statusCode).toBe(500);
    expect(repoMocks.appendGraphEvents).toHaveBeenCalledTimes(1);
    expect(repoMocks.appendGraphEvent).not.toHaveBeenCalled();
    expect(vi.mocked(runGraph)).not.toHaveBeenCalled();
    await app.close();
  });

  it("dismisses proposals without creating runner work", async () => {
    const app = Fastify();
    await app.register(graphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/graphs/graph-1/agent/plan-proposals/proposal-1/dismiss",
      headers: { "x-openagentgraph-actor-id": "operator" },
      payload: {
        reason: "Out of scope for this run.",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(repoMocks.appendGraphEvent).toHaveBeenCalledTimes(1);
    expect(repoMocks.appendGraphEvent.mock.calls[0][0]).toMatchObject({
      kind: "agent.plan_dismissed",
      payload: {
        proposalId: "proposal-1",
        reason: "Out of scope for this run.",
      },
    });
    expect(vi.mocked(runGraph)).not.toHaveBeenCalled();
    await app.close();
  });
});
