import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProductGraphCodexPlanningPrompt,
  ProductGraphEdge,
  ProductGraphNode,
  ProductGraphProjection,
  ProductGraphTrace,
  ScanJobLifecycleStatus,
} from "@openagentgraph/shared";
import { useStore } from "./store.js";

const AUTH_TOKEN_STORAGE_KEY = "openagentgraph:auth-token";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function makeProductGraphProjection(): ProductGraphProjection {
  return {
    schemaVersion: "1",
    productGraphId: "default",
    nodes: [],
    edges: [],
    events: [],
    summary: {
      nodeCount: 0,
      edgeCount: 0,
      nodesByKind: {},
      edgesByKind: {},
      unresolvedOpenQuestionCount: 0,
      blockedTaskCount: 0,
    },
  };
}

function makeProductGraphNode(): ProductGraphNode {
  return {
    id: "feature:intent-graph",
    kind: "feature",
    title: "Intent Graph",
    status: "planned",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

function makeProductGraphTrace(nodeId = "feature:intent-graph", title = "Intent Graph"): ProductGraphTrace {
  const node = {
    ...makeProductGraphNode(),
    id: nodeId,
    title,
    incomingEdgeIds: [],
    outgoingEdgeIds: [],
    blockedByNodeIds: [],
  };
  return {
    schemaVersion: "1",
    productGraphId: "default",
    rootNode: node,
    nodes: [node],
    edges: [],
    hopsByNodeId: {
      [node.id]: 0,
    },
    summary: {
      nodeCount: 1,
      edgeCount: 0,
      maxDepth: 2,
      codeNodeCount: 0,
      testResultNodeCount: 0,
      evidenceNodeCount: 0,
    },
  };
}

function makeProductGraphCodexPlan(taskNodeId = "task:checkout-status-panel"): ProductGraphCodexPlanningPrompt {
  const taskNode = {
    ...makeProductGraphNode(),
    id: taskNodeId,
    kind: "task" as const,
    title: "Wire checkout status panel",
    incomingEdgeIds: [],
    outgoingEdgeIds: [],
    blockedByNodeIds: [],
  };
  return {
    taskNode,
    intentNodes: [],
    acceptanceCriteria: [],
    likelyCodeAreas: [],
    openQuestions: [],
    risks: ["No linked acceptance criteria; confirm expected behavior before coding."],
    verificationCommands: ["npm run build", "npm run test"],
    prompt: "You are Codex working from OpenAgentGraph product graph context.",
  };
}

function makeProductGraphHandoffReport() {
  return {
    markdown: "# OpenAgentGraph Handoff\n\n## Read These First\n- `src/App.tsx`",
    summary: {
      nodeCount: 4,
      edgeCount: 2,
      codeFileCount: 1,
      codeSymbolCount: 1,
      riskCount: 1,
      recommendedReadCount: 1,
      generatedAt: "2026-06-02T00:00:00.000Z",
    },
  };
}

function makeProductGraphEdge(): ProductGraphEdge {
  return {
    id: "edge-story-feature",
    sourceNodeId: "story-1",
    targetNodeId: "feature-1",
    kind: "belongs_to",
    trust: "manual",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

function makeProductGraphRunLink(): {
  node: ProductGraphNode;
  edge: ProductGraphEdge;
  evidenceNode: ProductGraphNode;
  evidenceEdge: ProductGraphEdge;
  planEdges: ProductGraphEdge[];
  fileNodes: ProductGraphNode[];
  fileEdges: ProductGraphEdge[];
} {
  return {
    node: {
      id: "run:checkout-proof",
      kind: "agent_run",
      title: "Checkout proof run",
      status: "completed",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    edge: {
      id: "edge-task-run",
      sourceNodeId: "task:checkout-status-panel",
      targetNodeId: "run:checkout-proof",
      kind: "produced_by",
      trust: "manual",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    evidenceNode: {
      id: "evidence:checkout-proof",
      kind: "evidence",
      title: "Checkout proof run evidence",
      status: "completed",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    evidenceEdge: {
      id: "edge-run-evidence",
      sourceNodeId: "evidence:checkout-proof",
      targetNodeId: "run:checkout-proof",
      kind: "produced_by",
      trust: "manual",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    planEdges: [],
    fileNodes: [],
    fileEdges: [],
  };
}

function makeAcceptedCodexPlan(): {
  node: ProductGraphNode;
  edge: ProductGraphEdge;
} {
  return {
    node: {
      id: "plan:codex:checkout-status-panel",
      kind: "plan",
      title: "Codex plan for Wire checkout status panel",
      status: "planned",
      tags: ["codex", "planning"],
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    edge: {
      id: "edge-codex-plan-checkout-status-panel",
      sourceNodeId: "plan:codex:checkout-status-panel",
      targetNodeId: "task:checkout-status-panel",
      kind: "derived_from",
      trust: "manual",
      label: "Plan derived from task",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
  };
}

function makeProductGraphIntentBundle(): { nodes: ProductGraphNode[]; edges: ProductGraphEdge[] } {
  return {
    nodes: [
      makeProductGraphNode(),
      {
        id: "story:operator-sees-intent",
        kind: "user_story",
        title: "Operator sees intent",
        status: "planned",
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
      {
        id: "criterion:intent-visible",
        kind: "acceptance_criterion",
        title: "Intent is visible before execution",
        status: "planned",
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
      {
        id: "task:intent-view",
        kind: "task",
        title: "Build intent view",
        status: "planned",
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
    edges: [
      {
        id: "edge-story-feature",
        sourceNodeId: "story:operator-sees-intent",
        targetNodeId: "feature:intent-graph",
        kind: "belongs_to",
        trust: "manual",
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  };
}

function makeProductGraphSpecKitImportResult() {
  return {
    status: "imported",
    message: "Spec Kit artifacts imported into the Product Graph.",
    imported: {
      nodeCount: 4,
      edgeCount: 3,
      constitutionCount: 1,
      specFileCount: 1,
      featureCount: 1,
      userStoryCount: 1,
      requirementCount: 1,
      acceptanceCriterionCount: 0,
      openQuestionCount: 0,
      contractFileCount: 0,
      contractCount: 0,
      planFileCount: 0,
      planCount: 0,
      quickstartFileCount: 0,
      quickstartScenarioCount: 0,
      taskFileCount: 1,
      taskCount: 1,
      skippedSpecFileCount: 0,
      skippedContractFileCount: 0,
      skippedPlanFileCount: 0,
      skippedQuickstartFileCount: 0,
      skippedTaskFileCount: 0,
    },
    artifactRoot: ".",
    artifacts: [
      { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: true },
      { key: "specs", relativePath: "specs", kind: "specs", present: true },
    ],
    presentArtifacts: ["constitution", "specs"],
    missingArtifacts: [],
  } as const;
}

function makeProductGraphCodebaseScanResult() {
  return {
    status: "scanned",
    message: "Codebase scan completed.",
    scanId: "scan-1",
    scannedAt: "2026-06-01T00:00:00.000Z",
    scanned: {
      fileCount: 1,
      symbolCount: 2,
      edgeCount: 2,
      skippedFileCount: 0,
      skippedDirectoryCount: 0,
      archivedNodeCount: 0,
      archivedEdgeCount: 0,
      durationMs: 11,
      partial: false,
    },
  } as const;
}

function makeProductGraphCodebaseScanJob(
  result = makeProductGraphCodebaseScanResult(),
  status: ScanJobLifecycleStatus = "completed"
) {
  return {
    jobId: "product-job-1",
    scope: "product_codebase",
    status,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:01.000Z",
    progress: {
      scanId: "scan-1",
      scope: "product_codebase",
      phase: status === "completed" ? "completed" : "collecting_files",
      startedAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:01.000Z",
      filesScanned: 1,
      bytesScanned: 128,
      skippedFileCount: 0,
      skippedDirectoryCount: 0,
      filesPerSecond: 1,
      megabytesPerSecond: 0,
      breakers: {
        state: "ok",
        limits: {
          maxFiles: 20_000,
          maxTotalBytes: 200_000_000,
          maxFileBytes: 5_000_000,
          maxDepth: 40,
          maxDurationMs: 180_000,
        },
        hits: [],
        near: [],
      },
    },
    ...(status === "completed" ? { result } : {}),
  } as const;
}

function makeScanJobSseResponse(job: unknown) {
  return new Response(`event: status\ndata: ${JSON.stringify(job)}\n\n`, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

function seedProductGraphTrace(nodeId = "feature:intent-graph", title = "Intent Graph") {
  const trace = makeProductGraphTrace(nodeId, title);
  useStore.setState({
    productGraphTrace: trace,
    productGraphTracesByNodeId: {
      [nodeId]: trace,
    },
    productGraphTraceNodeId: nodeId,
    productGraphTraceLoading: true,
    productGraphTraceError: "Previous trace refresh failed.",
    productGraphTraceNotice: "",
  });
  return trace;
}

function expectProductGraphTraceInvalidatedWithNotice() {
  const state = useStore.getState();
  expect(state.productGraphTrace).toBeNull();
  expect(state.productGraphTracesByNodeId).toEqual({});
  expect(state.productGraphTraceNodeId).toBeNull();
  expect(state.productGraphTraceLoading).toBe(false);
  expect(state.productGraphTraceError).toBe("");
  expect(state.productGraphTraceNotice).toBe("Graph trace cache cleared after graph refresh.");
}

function expectProductGraphCodexPlanInvalidated() {
  const state = useStore.getState();
  expect(state.productGraphCodexPlan).toBeNull();
  expect(state.productGraphCodexPlanTaskNodeId).toBeNull();
  expect(state.productGraphCodexPlanLoading).toBe(false);
  expect(state.productGraphCodexPlanError).toBe("");
}

describe("store viewed state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useStore.setState({
      authMode: "dev_header",
      authStatus: "anonymous",
      sessionLifecycle: "read_only",
      authRequiredForProtectedActions: true,
      authMessage: "",
      runtimeStatus: "connected",
      runtimeMessage: "",
      backendReadyStatus: "unknown",
      runtimeHealthSummary: "",
      runtimeFallbackLikely: false,
      providerStatus: {
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider status has not been checked yet.",
      },
      providerConfigSaving: false,
      providerConfigMessage: "",
      runtimeLoading: false,
      sessionLoading: false,
      dashboardLoading: false,
      productGraph: null,
      productGraphLoading: false,
      productGraphError: "",
      productGraphTrace: null,
      productGraphTracesByNodeId: {},
      productGraphTraceNodeId: null,
      productGraphTraceLoading: false,
      productGraphTraceError: "",
      productGraphTraceNotice: "",
      productGraphCodexPlan: null,
      productGraphCodexPlanTaskNodeId: null,
      productGraphCodexPlanLoading: false,
      productGraphCodexPlanError: "",
      agentFrontierGraphId: null,
      agentFrontier: [],
      agentFrontierSummary: null,
      agentActivity: [],
      agentPlanProposals: [],
      agentContext: null,
      agentCollaborationLoading: false,
      agentCollaborationError: "",
      agentCollaborationMessage: "",
      onboardingDismissed: false,
      authToken: "",
      currentActor: {
        actorId: "operator",
        displayName: "Operator",
        role: "operator",
      },
      activeGraphId: "graph-1",
      events: [
        {
          id: "evt-1",
          graphId: "graph-1",
          kind: "goal.version_created",
          payload: {
            graphTitle: "Graph",
            goal: "Build the dashboard",
            goalPacket: {
              id: "goal-1",
              version: 1,
              originalText: "Build the dashboard",
              successCriteria: [],
              forbiddenScope: [],
              embedding: [],
              criteriaEmbeddings: [],
              createdAt: "2026-04-16T10:00:00.000Z",
            },
            activate: true,
          },
          ts: "2026-04-16T10:00:00.000Z",
          seq: 3,
        },
      ] as any,
      alerts: [
        {
          id: "alert-1",
          type: "run_paused",
          graphId: "graph-1",
          createdAt: "2026-04-16T10:01:00.000Z",
          severity: "info",
          title: "Run is paused",
          message: "The system is waiting to resume.",
        },
      ],
      changesSinceLastViewed: {
        lastSeenSequence: 1,
        currentSequence: 3,
        newEventCount: 2,
        runControlStateChanged: true,
        frontierStatusChanged: false,
        newAlertsAppeared: true,
        changesSinceLastViewedSummary: "2 new events occurred. The run is now paused.",
      },
      lastSeenSequenceByGraph: {},
    });
  });

  it("marking a graph as viewed only changes client unseen state", () => {
    const beforeAlerts = useStore.getState().alerts;
    useStore.getState().markGraphViewed("graph-1");
    const after = useStore.getState();

    expect(after.lastSeenSequenceByGraph["graph-1"]).toBe(3);
    expect(after.changesSinceLastViewed?.newEventCount).toBe(0);
    expect(after.alerts).toEqual(beforeAlerts);
  });

  it("dismissing onboarding only changes client-side onboarding state", () => {
    const beforeAlerts = useStore.getState().alerts;
    useStore.getState().dismissOnboarding();
    const afterDismiss = useStore.getState();

    expect(afterDismiss.onboardingDismissed).toBe(true);
    expect(afterDismiss.alerts).toEqual(beforeAlerts);
    expect(afterDismiss.runtimeStatus).toBe("connected");

    useStore.getState().resetOnboarding();
    expect(useStore.getState().onboardingDismissed).toBe(false);
  });

  it("loads jwt session state from the backend without using local role selection as permission truth", async () => {
    useStore.setState({ activeGraphId: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authMode: "jwt",
          authRequiredForProtectedActions: true,
          status: "authenticated",
          actor: {
            actorId: "reviewer-1",
            displayName: "Priya Reviewer",
            role: "reviewer",
          },
          message: "Signed in as Priya Reviewer.",
        }),
      })
    );

    useStore.setState({ authToken: "header.payload.signature" });
    await useStore.getState().loadAuthSession();

    const state = useStore.getState();
    expect(state.authMode).toBe("jwt");
    expect(state.authStatus).toBe("authenticated");
    expect(state.sessionLifecycle).toBe("signed_in");
    expect(state.currentActor).toEqual({
      actorId: "reviewer-1",
      displayName: "Priya Reviewer",
      role: "reviewer",
    });
  });

  it("migrates legacy persistent auth tokens into session storage", async () => {
    const localStorage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "legacy.header.payload");
    vi.stubGlobal("window", { localStorage, sessionStorage });
    vi.resetModules();

    const { useStore: isolatedStore } = await import("./store.js");

    expect(isolatedStore.getState().authToken).toBe("legacy.header.payload");
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe("legacy.header.payload");
  });

  it("keeps anonymous non-required auth flows out of auth-required session copy", async () => {
    useStore.setState({ activeGraphId: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authMode: "disabled",
          authRequiredForProtectedActions: false,
          status: "anonymous",
          actor: null,
          message: "Viewing is available without sign-in in this environment.",
        }),
      })
    );

    await useStore.getState().loadAuthSession();

    const state = useStore.getState();
    expect(state.authStatus).toBe("anonymous");
    expect(state.sessionLifecycle).toBe("read_only");
    expect(state.runtimeStatus).toBe("degraded");
  });

  it("surfaces a safe runtime message when the backend is unreachable", async () => {
    useStore.setState({ activeGraphId: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:3001"))
    );

    await useStore.getState().loadAuthSession();

    const state = useStore.getState();
    expect(state.runtimeStatus).toBe("unreachable");
    expect(state.runtimeMessage).toBe("The OpenAgentGraph backend could not be reached.");
    expect(state.authMessage).toBe("The OpenAgentGraph backend could not be reached.");
  });

  it("surfaces a safe auth-required message when the backend rejects the current session", async () => {
    useStore.setState({ activeGraphId: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          authMode: "jwt",
          authRequiredForProtectedActions: true,
          status: "invalid",
          message: "Your session is invalid or expired. Please sign in again.",
        }),
      })
    );

    await useStore.getState().loadAuthSession();

    const state = useStore.getState();
    expect(state.runtimeStatus).toBe("auth_required");
    expect(state.authStatus).toBe("invalid");
    expect(state.sessionLifecycle).toBe("invalid_session");
    expect(state.runtimeMessage).toBe("Your session is invalid or expired. Please sign in again.");
  });

  it("surfaces a safe expired-session recovery state", async () => {
    useStore.setState({ activeGraphId: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          authMode: "jwt",
          authRequiredForProtectedActions: true,
          status: "expired",
          message: "Your session has expired. Add a new token to continue.",
        }),
      })
    );

    await useStore.getState().loadAuthSession();

    const state = useStore.getState();
    expect(state.authStatus).toBe("expired");
    expect(state.sessionLifecycle).toBe("expired_session");
    expect(state.authMessage).toBe("Your session has expired. Add a new token to continue.");
  });

  it("refreshes session and capability state after a token update without a full reload", async () => {
    const localStorage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "old.header.payload");
    vi.stubGlobal("window", { localStorage, sessionStorage });
    useStore.setState({ activeGraphId: null, authMode: "jwt", authToken: "" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/ready")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "ok",
              checks: {
                provider: { status: "ok", message: "AI provider is configured." },
              },
              timestamp: "2026-04-17T00:00:00.000Z",
            }),
          } as Response;
        }
        if (url.endsWith("/auth/session")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              authMode: "jwt",
              authRequiredForProtectedActions: true,
              status: "authenticated",
              actor: {
                actorId: "admin-1",
                displayName: "Admin One",
                role: "admin",
              },
              message: "Signed in as Admin One.",
            }),
          } as Response;
        }
        if (url.includes("/graphs")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              schemaVersion: "1",
              items: [],
              summary: {
                urgentRunCount: 0,
                needsReviewCount: 0,
                blockedRunCount: 0,
                activeRunCount: 0,
                archivedRunCount: 0,
              },
            }),
          } as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    await useStore.getState().setAuthToken("header.payload.signature");

    const state = useStore.getState();
    expect(state.authToken).toBe("header.payload.signature");
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe("header.payload.signature");
    expect(state.authStatus).toBe("authenticated");
    expect(state.sessionLifecycle).toBe("signed_in");
    expect(state.currentActor.displayName).toBe("Admin One");
    expect(state.runtimeStatus).toBe("connected");
  });

  it("derives a lightweight runtime health summary from safe readiness diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: "degraded",
          checks: {
            database: { status: "ok", message: "Database schema is initialized." },
            provider: {
              status: "degraded",
              message: "AI provider is not configured; goal execution is unavailable.",
              details: [
                "Use Dashboard Provider setup to choose Ollama local, OpenAI, Gemini, Anthropic, or a custom OpenAI-compatible endpoint.",
                "Provider keys are kept only in backend process memory when pasted through the Dashboard.",
                "Graph scans, Project Graph, Code Map, and GRAPH_REPORT.md do not require any provider key.",
                "Ollama can run locally without an API key at http://localhost:11434/v1.",
                "Refresh provider status in OpenAgentGraph before starting the goal run.",
              ],
            },
            workspace: { status: "ok", message: "Workspace root is optional and not configured." },
            frontend: { status: "ok", message: "Frontend origin policy uses local development defaults." },
            auth: { status: "ok", message: "Actor auth mode is configured safely." },
          },
          timestamp: "2026-04-17T00:00:00.000Z",
        }),
      })
    );

    await useStore.getState().loadRuntimeHealth();

    const state = useStore.getState();
    expect(state.backendReadyStatus).toBe("degraded");
    expect(state.runtimeStatus).toBe("degraded");
    expect(state.runtimeFallbackLikely).toBe(true);
    expect(state.runtimeHealthSummary).toBe(
      "AI provider is not configured; goal execution is unavailable. Use Dashboard Provider setup to choose Ollama local, OpenAI, Gemini, Anthropic, or a custom OpenAI-compatible endpoint. Provider keys are kept only in backend process memory when pasted through the Dashboard. Graph scans, Project Graph, Code Map, and GRAPH_REPORT.md do not require any provider key."
    );
  });

  it("configures an Ollama provider without an API key and refreshes runtime health", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/provider/config")) {
        const headers = new Headers(init?.headers);
        expect(init?.method).toBe("POST");
        expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
        expect(headers.get("Content-Type")).toBe("application/json");
        expect(String(init?.body)).toContain("\"provider\":\"ollama\"");
        expect(String(init?.body)).not.toContain("apiKey");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            configured: true,
            provider: "ollama",
            source: "runtime",
            model: "llama3.2",
            baseUrl: "http://localhost:11434/v1",
            message: "Ollama provider is configured for this backend process (llama3.2).",
          }),
        };
      }

      if (url.endsWith("/ready")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "ok",
            checks: {
              provider: {
                status: "ok",
                message: "Ollama provider is configured for this backend process (llama3.2).",
              },
            },
            timestamp: "2026-04-17T00:00:00.000Z",
          }),
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await useStore.getState().configureProvider({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1",
    });

    expect(status).toEqual({
      configured: true,
      provider: "ollama",
      source: "runtime",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1",
      message: "Ollama provider is configured for this backend process (llama3.2).",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useStore.getState().providerConfigSaving).toBe(false);
    expect(useStore.getState().providerStatus).toEqual({
      configured: true,
      provider: "ollama",
      source: "runtime",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1",
      message: "Ollama provider is configured for this backend process (llama3.2).",
    });
    expect(useStore.getState().providerConfigMessage).toBe("Ollama provider is configured for this backend process (llama3.2).");
    expect(useStore.getState().runtimeFallbackLikely).toBe(false);
  });

  it("configures an OpenAI provider key with actor auth", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/provider/config")) {
        const headers = new Headers(init?.headers);
        expect(init?.method).toBe("POST");
        expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
        expect(String(init?.body)).toContain("sk-test_runtime_provider_key_123456789");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            configured: true,
            provider: "openai",
            source: "runtime",
            model: "gpt-4o",
            message: "OpenAI provider is configured for this backend process (gpt-4o).",
          }),
        };
      }
      if (url.endsWith("/ready")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "ok",
            checks: {
              provider: {
                status: "ok",
                message: "OpenAI provider is configured for this backend process (gpt-4o).",
              },
            },
            timestamp: "2026-04-17T00:00:00.000Z",
          }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await useStore.getState().configureProvider({
      provider: "openai",
      apiKey: "sk-test_runtime_provider_key_123456789",
    });

    expect(status).toEqual({
      configured: true,
      provider: "openai",
      source: "runtime",
      model: "gpt-4o",
      message: "OpenAI provider is configured for this backend process (gpt-4o).",
    });
  });

  it("strips provider-inappropriate OpenAI base URLs before posting provider config", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/provider/config")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          provider: "openai",
          apiKey: "sk-test_runtime_provider_key_123456789",
          model: "codellama:latest",
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            configured: true,
            provider: "openai",
            source: "runtime",
            model: "gpt-4o",
            message: "OpenAI provider is configured for this backend process (gpt-4o).",
          }),
        };
      }
      if (url.endsWith("/ready")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "ok",
            checks: {
              provider: {
                status: "ok",
                message: "OpenAI provider is configured for this backend process (gpt-4o).",
              },
            },
            timestamp: "2026-04-17T00:00:00.000Z",
          }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await useStore.getState().configureProvider({
      provider: "openai",
      apiKey: "sk-test_runtime_provider_key_123456789",
      model: "codellama:latest",
      baseUrl: "http://localhost:11434/v1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("configures Gemini and custom OpenAI-compatible providers with provider-specific payloads", async () => {
    const requests: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/provider/config")) {
        requests.push(JSON.parse(String(init?.body)));
        const body = requests[requests.length - 1] as { provider: string };
        if (body.provider === "gemini") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              configured: true,
              provider: "gemini",
              source: "runtime",
              model: "gemini-3.5-flash",
              baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
              message: "Gemini provider is configured for this backend process (gemini-3.5-flash).",
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            configured: true,
            provider: "openai-compatible",
            source: "runtime",
            model: "custom-model",
            baseUrl: "https://gateway.example.com/v1",
            message: "OpenAI-compatible provider is configured for this backend process (custom-model).",
          }),
        };
      }
      if (url.endsWith("/ready")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "ok",
            checks: {
              provider: {
                status: "ok",
                message: "AI provider is configured.",
              },
            },
            timestamp: "2026-04-17T00:00:00.000Z",
          }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await useStore.getState().configureProvider({
      provider: "gemini",
      apiKey: "gemini-test-runtime-key-123456789",
      model: "gemini-3.5-flash",
    });
    await useStore.getState().configureProvider({
      provider: "openai-compatible",
      apiKey: "custom-test-runtime-key-123456789",
      model: "custom-model",
      baseUrl: "https://gateway.example.com/v1",
    });

    expect(requests).toEqual([
      {
        provider: "gemini",
        apiKey: "gemini-test-runtime-key-123456789",
        model: "gemini-3.5-flash",
      },
      {
        provider: "openai-compatible",
        apiKey: "custom-test-runtime-key-123456789",
        model: "custom-model",
        baseUrl: "https://gateway.example.com/v1",
      },
    ]);
  });

  it("loads protected provider status with actor auth", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url.endsWith("/provider/config")).toBe(true);
      const headers = new Headers(init?.headers);
      expect(init?.method).toBeUndefined();
      expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          configured: true,
          provider: "ollama",
          source: "environment",
          model: "llama3.2",
          baseUrl: "http://localhost:11434/v1",
          message: "Ollama provider is configured (llama3.2).",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await useStore.getState().loadProviderStatus();

    expect(status).toEqual({
      configured: true,
      provider: "ollama",
      source: "environment",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1",
      message: "Ollama provider is configured (llama3.2).",
    });
    expect(useStore.getState().providerStatus).toEqual(status);
    expect(useStore.getState().providerConfigMessage).toBe("Ollama provider is configured (llama3.2).");
  });

  it("clears a runtime provider config and refreshes provider readiness", async () => {
    useStore.setState({
      providerStatus: {
        configured: true,
        provider: "openai",
        source: "runtime",
        model: "gpt-4o",
        message: "OpenAI provider is configured for this backend process (gpt-4o).",
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/provider/config")) {
        const headers = new Headers(init?.headers);
        expect(init?.method).toBe("DELETE");
        expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            configured: false,
            provider: "unset",
            source: "unset",
            message: "AI provider is not configured; goal execution is unavailable.",
          }),
        };
      }

      if (url.endsWith("/ready")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "degraded",
            checks: {
              provider: {
                status: "degraded",
                message: "AI provider is not configured; goal execution is unavailable.",
                details: ["Use Dashboard Provider setup to choose Ollama local, OpenAI, Gemini, Anthropic, or a custom OpenAI-compatible endpoint."],
              },
            },
            timestamp: "2026-04-17T00:00:00.000Z",
          }),
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await useStore.getState().clearRuntimeProviderConfig();

    expect(status).toEqual({
      configured: false,
      provider: "unset",
      source: "unset",
      message: "AI provider is not configured; goal execution is unavailable.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useStore.getState().providerConfigSaving).toBe(false);
    expect(useStore.getState().providerStatus).toEqual(status);
    expect(useStore.getState().runtimeFallbackLikely).toBe(true);
  });

  it("bounds provider diagnostic detail from readiness payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: "degraded",
          checks: {
            provider: {
              status: "degraded",
              message: "  Provider blocked.  ",
              details: [
                " First step. ",
                42,
                "x".repeat(220),
                "Fourth visible step.",
                "Fifth hidden step.",
              ],
            },
          },
          timestamp: "2026-04-17T00:00:00.000Z",
        }),
      })
    );

    await useStore.getState().loadRuntimeHealth();

    const summary = useStore.getState().runtimeHealthSummary;
    expect(summary).toBe(`Provider blocked. First step. ${"x".repeat(180)} Fourth visible step.`);
    expect(summary).not.toContain("Fifth hidden step.");
    expect(summary).not.toContain("42");
  });

  it("loads the product graph into frontend state with actor auth", async () => {
    const projection = makeProductGraphProjection();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => projection,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await useStore.getState().loadProductGraph();

    const state = useStore.getState();
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(state.productGraph).toEqual(projection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe("");
    expect(state.productGraphTraceNotice).toBe("");
  });

  it("loads Product Graph handoff reports into frontend state", async () => {
    const handoff = makeProductGraphHandoffReport();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => handoff,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useStore.getState().loadProductGraphHandoff()).resolves.toEqual(handoff);

    const state = useStore.getState();
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/handoff");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(state.productGraphHandoff).toEqual(handoff);
    expect(state.productGraphHandoffLoading).toBe(false);
    expect(state.productGraphHandoffError).toBe("");
    expect(state.productGraphHandoffMessage).toBe("Generated handoff with 1 recommended reads.");
  });

  it("writes Product Graph handoff reports with actor auth", async () => {
    const handoff = {
      status: "written",
      path: "GRAPH_REPORT.md",
      ...makeProductGraphHandoffReport(),
    } as const;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 201,
      json: async () => handoff,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useStore.getState().writeProductGraphHandoff()).resolves.toEqual(handoff);

    const state = useStore.getState();
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/handoff/write");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(state.productGraphHandoff).toEqual(handoff);
    expect(state.productGraphHandoffWriting).toBe(false);
    expect(state.productGraphHandoffError).toBe("");
    expect(state.productGraphHandoffMessage).toBe(`Wrote GRAPH_REPORT.md to ${handoff.path}.`);
  });

  it("loads agent frontier and context packs with actor auth", async () => {
    const frontier = {
      graphId: "graph-1",
      generatedAt: "2026-06-04T00:00:00.000Z",
      summary: {
        runControlState: "running",
        frontierStatus: "on_track",
        readyCount: 1,
        runningCount: 0,
        blockedCount: 0,
        openProposalCount: 1,
      },
      frontier: [
        {
          nodeId: "node-1",
          title: "Ship agent coordination",
          kind: "work",
          status: "ready",
          humanSummary: "Ready for external agents.",
          dependsOnNodeIds: [],
          updatedAt: "2026-06-04T00:00:00.000Z",
        },
      ],
      recentAgentActivity: [
        {
          id: "activity-1",
          graphId: "graph-1",
          kind: "progress",
          summary: "Codex reported progress.",
          createdAt: "2026-06-04T00:01:00.000Z",
        },
      ],
      planProposals: [],
    };
    const context = {
      ...frontier,
      graph: {
        id: "graph-1",
        title: "Graph",
        goal: "Ship agent coordination",
        status: "running",
        activeGoalVersionId: "goal-1",
      },
      run: {
        runControlState: "running",
        frontierStatus: "on_track",
        plannedNodeCount: 1,
        completedNodeCount: 0,
        failedNodeCount: 0,
        runHealthSummary: "0 of 1 steps completed.",
      },
      selectedNode: frontier.frontier[0],
      instructions: ["Read GRAPH_REPORT.md first."],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => String(input).includes("agent-context") ? context : frontier,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useStore.getState().loadAgentFrontier("graph-1")).resolves.toEqual(frontier);
    await expect(useStore.getState().loadAgentContext("graph-1", "node-1")).resolves.toEqual(context);

    const state = useStore.getState();
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/graphs/graph-1/frontier");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/graphs/graph-1/agent-context?nodeId=node-1");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(state.agentFrontierGraphId).toBe("graph-1");
    expect(state.agentFrontier).toEqual(frontier.frontier);
    expect(state.agentContext).toEqual(context);
    expect(JSON.stringify(state.agentContext)).not.toContain("apiKey");
  });

  it("accepts agent plan proposals and refreshes the frontier", async () => {
    useStore.setState({ activeGraphId: null });
    const frontier = {
      graphId: "graph-1",
      generatedAt: "2026-06-04T00:00:00.000Z",
      summary: {
        runControlState: "idle",
        frontierStatus: "on_track",
        readyCount: 0,
        runningCount: 0,
        blockedCount: 0,
        openProposalCount: 0,
      },
      frontier: [],
      recentAgentActivity: [],
      planProposals: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: String(input).includes("/accept") ? 201 : 200,
      json: async () => String(input).includes("/frontier") ? frontier : ({ accepted: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useStore.getState().acceptAgentPlanProposal("graph-1", "proposal-1")).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/graphs/graph-1/agent/plan-proposals/proposal-1/accept");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/graphs/graph-1/frontier");
    expect(useStore.getState().agentCollaborationMessage).toBe("Agent proposal accepted.");
  });

  it("dismisses agent plan proposals and refreshes the frontier", async () => {
    useStore.setState({ activeGraphId: null });
    const frontier = {
      graphId: "graph-1",
      generatedAt: "2026-06-04T00:00:00.000Z",
      summary: {
        runControlState: "idle",
        frontierStatus: "on_track",
        readyCount: 0,
        runningCount: 0,
        blockedCount: 0,
        openProposalCount: 0,
      },
      frontier: [],
      recentAgentActivity: [],
      planProposals: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: String(input).includes("/dismiss") ? 201 : 200,
      json: async () => String(input).includes("/frontier") ? frontier : ({ dismissed: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useStore.getState().dismissAgentPlanProposal("graph-1", "proposal-1", "x".repeat(700))).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/graphs/graph-1/agent/plan-proposals/proposal-1/dismiss");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    const dismissBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(dismissBody.reason.length).toBe(500);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/graphs/graph-1/frontier");
    expect(useStore.getState().agentCollaborationMessage).toBe("Agent proposal dismissed.");
  });

  it("clears cached product graph traces after refreshing the product graph", async () => {
    const projection = makeProductGraphProjection();
    const trace = makeProductGraphTrace("feature:intent-graph", "Intent Graph");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => projection,
    }));
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({
      productGraphTrace: trace,
      productGraphTracesByNodeId: {
        "feature:intent-graph": trace,
      },
      productGraphTraceNodeId: "feature:intent-graph",
      productGraphTraceLoading: true,
      productGraphTraceError: "Previous trace refresh failed.",
    });

    await useStore.getState().loadProductGraph();

    const state = useStore.getState();
    expect(state.productGraph).toEqual(projection);
    expect(state.productGraphTrace).toBeNull();
    expect(state.productGraphTracesByNodeId).toEqual({});
    expect(state.productGraphTraceNodeId).toBeNull();
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("Graph trace cache cleared after graph refresh.");
  });

  it("loads product graph traces into frontend state with actor auth", async () => {
    const trace = makeProductGraphTrace();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => trace,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useStore.getState().loadProductGraphTrace("feature:intent-graph")).resolves.toEqual(trace);

    const state = useStore.getState();
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/trace/feature%3Aintent-graph");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(state.productGraphTrace).toEqual(trace);
    expect(state.productGraphTracesByNodeId["feature:intent-graph"]).toEqual(trace);
    expect(state.productGraphTraceNodeId).toBe("feature:intent-graph");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("");
  });

  it("loads Codex planning prompts into frontend state with actor auth", async () => {
    const codexPlan = makeProductGraphCodexPlan();
    let resolveCodexPlanResponse: (response: {
      ok: boolean;
      status: number;
      json: () => Promise<ProductGraphCodexPlanningPrompt>;
    }) => void = () => {};
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      new Promise((resolve) => {
        resolveCodexPlanResponse = resolve;
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const codexPlanLoad = useStore.getState().loadProductGraphCodexPlan("task:checkout-status-panel");
    const loadingState = useStore.getState();
    expect(loadingState.productGraphCodexPlanTaskNodeId).toBe("task:checkout-status-panel");
    expect(loadingState.productGraphCodexPlanLoading).toBe(true);
    expect(loadingState.productGraphCodexPlanError).toBe("");

    resolveCodexPlanResponse({
      ok: true,
      status: 200,
      json: async () => codexPlan,
    });
    await expect(codexPlanLoad).resolves.toEqual(codexPlan);

    const state = useStore.getState();
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/codex-plan/task%3Acheckout-status-panel");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(state.productGraphCodexPlan).toEqual(codexPlan);
    expect(state.productGraphCodexPlanTaskNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphCodexPlanLoading).toBe(false);
    expect(state.productGraphCodexPlanError).toBe("");
  });

  it("keeps existing Codex planning prompts visible when refresh fails", async () => {
    const existingPlan = makeProductGraphCodexPlan();
    useStore.setState({
      productGraphCodexPlan: existingPlan,
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "Product graph task was not found." }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useStore.getState().loadProductGraphCodexPlan("task:checkout-status-panel")).rejects.toMatchObject({
      message: "Product graph task was not found.",
      status: 404,
    });

    const state = useStore.getState();
    expect(state.productGraphCodexPlan).toEqual(existingPlan);
    expect(state.productGraphCodexPlanTaskNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphCodexPlanLoading).toBe(false);
    expect(state.productGraphCodexPlanError).toBe("Product graph task was not found.");
  });

  it("accepts Codex planning prompts and refreshes the product graph projection", async () => {
    const acceptedPlan = makeAcceptedCodexPlan();
    const projection = {
      ...makeProductGraphProjection(),
      nodes: [
        {
          ...acceptedPlan.node,
          incomingEdgeIds: [],
          outgoingEdgeIds: [acceptedPlan.edge.id],
          blockedByNodeIds: [],
        },
      ],
      edges: [acceptedPlan.edge],
      summary: {
        ...makeProductGraphProjection().summary,
        nodeCount: 1,
        edgeCount: 1,
        nodesByKind: { plan: 1 },
        edgesByKind: { derived_from: 1 },
      },
    } satisfies ProductGraphProjection;
    useStore.setState({
      productGraphCodexPlan: makeProductGraphCodexPlan(),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });
    seedProductGraphTrace("task:checkout-status-panel", "Checkout task trace");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/codex-plan/task%3Acheckout-status-panel/accept")) {
        return {
          ok: true,
          status: 201,
          json: async () => acceptedPlan,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: true,
          status: 200,
          json: async () => projection,
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      useStore.getState().acceptProductGraphCodexPlan({
        taskNodeId: "task:checkout-status-panel",
        promptHash: "a".repeat(64),
        title: "Accepted checkout plan",
      })
    ).resolves.toEqual(acceptedPlan);

    const acceptCall = fetchMock.mock.calls[0];
    const headers = new Headers(acceptCall[1]?.headers);
    expect(acceptCall[0]).toBe("/api/product-graph/codex-plan/task%3Acheckout-status-panel/accept");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(JSON.parse(String(acceptCall[1]?.body))).toEqual({
      promptHash: "a".repeat(64),
      title: "Accepted checkout plan",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(useStore.getState().productGraph).toEqual(projection);
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("returns accepted Codex plans when projection refresh fails", async () => {
    const existingProjection = makeProductGraphProjection();
    const acceptedPlan = makeAcceptedCodexPlan();
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: makeProductGraphCodexPlan(),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/codex-plan/task%3Acheckout-status-panel/accept")) {
        return {
          ok: true,
          status: 201,
          json: async () => acceptedPlan,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "refresh unavailable" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace("task:checkout-status-panel", "Checkout task trace");

    await expect(
      useStore.getState().acceptProductGraphCodexPlan({
        taskNodeId: "task:checkout-status-panel",
        promptHash: "a".repeat(64),
      })
    ).resolves.toEqual(acceptedPlan);

    const state = useStore.getState();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/codex-plan/task%3Acheckout-status-panel/accept");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe(
      "Product graph Codex plan was created, but the graph could not be refreshed. refresh unavailable"
    );
    expectProductGraphCodexPlanInvalidated();
    expectProductGraphTraceInvalidatedWithNotice();
  });

  it("surfaces Codex plan acceptance errors without changing projection state", async () => {
    const existingProjection = makeProductGraphProjection();
    const existingPlan = makeProductGraphCodexPlan();
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: existingPlan,
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });
    const trace = seedProductGraphTrace("task:checkout-status-panel", "Checkout task trace");
    useStore.setState({
      productGraphTraceLoading: false,
      productGraphTraceError: "",
    });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "Codex planning prompt changed. Reload the plan before accepting it." }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      useStore.getState().acceptProductGraphCodexPlan({
        taskNodeId: "task:checkout-status-panel",
        promptHash: "0".repeat(64),
      })
    ).rejects.toMatchObject({
      message: "Codex planning prompt changed. Reload the plan before accepting it.",
      status: 409,
    });

    const state = useStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const acceptCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    expect(acceptCall[0]).toBe("/api/product-graph/codex-plan/task%3Acheckout-status-panel/accept");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe("Codex planning prompt changed. Reload the plan before accepting it.");
    expect(state.productGraphCodexPlan).toBe(existingPlan);
    expect(state.productGraphCodexPlanTaskNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphTrace).toBe(trace);
    expect(state.productGraphTracesByNodeId).toEqual({
      "task:checkout-status-panel": trace,
    });
    expect(state.productGraphTraceNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("");
  });

  it("keeps late trace responses from restoring cache after a product graph refresh", async () => {
    const projection = makeProductGraphProjection();
    const trace = makeProductGraphTrace("feature:intent-graph", "Intent Graph");
    let resolveTraceResponse: (response: {
      ok: boolean;
      status: number;
      json: () => Promise<ProductGraphTrace>;
    }) => void = () => {};
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/product-graph/trace/")) {
        return new Promise((resolve) => {
          resolveTraceResponse = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => projection,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const traceLoad = useStore.getState().loadProductGraphTrace("feature:intent-graph");
    await useStore.getState().loadProductGraph();
    resolveTraceResponse({
      ok: true,
      status: 200,
      json: async () => trace,
    });
    await expect(traceLoad).resolves.toEqual(trace);

    const state = useStore.getState();
    expect(state.productGraph).toEqual(projection);
    expect(state.productGraphTrace).toBeNull();
    expect(state.productGraphTracesByNodeId).toEqual({});
    expect(state.productGraphTraceNodeId).toBeNull();
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("");
  });

  it("keeps an existing same-node trace visible while refreshing it", async () => {
    const existingTrace = makeProductGraphTrace("feature:intent-graph", "Existing intent graph");
    const freshTrace = makeProductGraphTrace("feature:intent-graph", "Fresh intent graph");
    let resolveTraceResponse: (response: {
      ok: boolean;
      status: number;
      json: () => Promise<ProductGraphTrace>;
    }) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveTraceResponse = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({
      productGraphTrace: existingTrace,
      productGraphTraceNodeId: "feature:intent-graph",
      productGraphTraceError: "Previous refresh failed.",
    });

    const refresh = useStore.getState().loadProductGraphTrace("feature:intent-graph");
    const refreshingState = useStore.getState();
    expect(refreshingState.productGraphTrace).toEqual(existingTrace);
    expect(refreshingState.productGraphTraceNodeId).toBe("feature:intent-graph");
    expect(refreshingState.productGraphTraceLoading).toBe(true);
    expect(refreshingState.productGraphTraceError).toBe("");
    expect(refreshingState.productGraphTraceNotice).toBe("");

    resolveTraceResponse({
      ok: true,
      status: 200,
      json: async () => freshTrace,
    });
    await expect(refresh).resolves.toEqual(freshTrace);

    const finalState = useStore.getState();
    expect(finalState.productGraphTrace).toEqual(freshTrace);
    expect(finalState.productGraphTraceNodeId).toBe("feature:intent-graph");
    expect(finalState.productGraphTraceLoading).toBe(false);
    expect(finalState.productGraphTraceError).toBe("");
    expect(finalState.productGraphTraceNotice).toBe("");
  });

  it("keeps an existing same-node trace visible when refresh fails", async () => {
    const existingTrace = makeProductGraphTrace("feature:intent-graph", "Existing intent graph");
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "Trace refresh unavailable." }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({
      productGraphTrace: existingTrace,
      productGraphTraceNodeId: "feature:intent-graph",
    });

    await expect(useStore.getState().loadProductGraphTrace("feature:intent-graph")).rejects.toMatchObject({
      message: "Trace refresh unavailable.",
    });

    const state = useStore.getState();
    expect(state.productGraphTrace).toEqual(existingTrace);
    expect(state.productGraphTraceNodeId).toBe("feature:intent-graph");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("Trace refresh unavailable.");
  });

  it("reuses cached traces while refreshing previously loaded nodes", async () => {
    const cachedTrace = makeProductGraphTrace("feature:first", "Cached first feature");
    const activeTrace = makeProductGraphTrace("feature:second", "Second feature");
    const freshTrace = makeProductGraphTrace("feature:first", "Fresh first feature");
    let resolveTraceResponse: (response: {
      ok: boolean;
      status: number;
      json: () => Promise<ProductGraphTrace>;
    }) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveTraceResponse = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({
      productGraphTrace: activeTrace,
      productGraphTracesByNodeId: {
        "feature:first": cachedTrace,
        "feature:second": activeTrace,
      },
      productGraphTraceNodeId: "feature:second",
    });

    const refresh = useStore.getState().loadProductGraphTrace("feature:first");
    const refreshingState = useStore.getState();
    expect(refreshingState.productGraphTrace).toEqual(cachedTrace);
    expect(refreshingState.productGraphTraceNodeId).toBe("feature:first");
    expect(refreshingState.productGraphTraceLoading).toBe(true);
    expect(refreshingState.productGraphTraceError).toBe("");

    resolveTraceResponse({
      ok: true,
      status: 200,
      json: async () => freshTrace,
    });
    await expect(refresh).resolves.toEqual(freshTrace);

    const finalState = useStore.getState();
    expect(finalState.productGraphTrace).toEqual(freshTrace);
    expect(finalState.productGraphTracesByNodeId["feature:first"]).toEqual(freshTrace);
    expect(finalState.productGraphTracesByNodeId["feature:second"]).toEqual(activeTrace);
    expect(finalState.productGraphTraceNodeId).toBe("feature:first");
    expect(finalState.productGraphTraceLoading).toBe(false);
    expect(finalState.productGraphTraceError).toBe("");
  });

  it("bounds cached traces to the eight most recent successful loads", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const pathParts = String(input).split("/");
      const nodeId = decodeURIComponent(pathParts[pathParts.length - 1] ?? "");
      return {
        ok: true,
        status: 200,
        json: async () => makeProductGraphTrace(nodeId, nodeId),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    for (let index = 0; index < 10; index += 1) {
      await useStore.getState().loadProductGraphTrace(`feature:${index}`);
    }

    const traceCache = useStore.getState().productGraphTracesByNodeId;
    expect(Object.keys(traceCache)).toHaveLength(8);
    expect(traceCache["feature:0"]).toBeUndefined();
    expect(traceCache["feature:1"]).toBeUndefined();
    expect(traceCache["feature:2"]?.rootNode.id).toBe("feature:2");
    expect(traceCache["feature:9"]?.rootNode.id).toBe("feature:9");
  });

  it("keeps late successful trace responses from replacing the latest requested trace", async () => {
    const firstTrace = makeProductGraphTrace("feature:first", "First feature");
    const secondTrace = makeProductGraphTrace("feature:second", "Second feature");
    let resolveFirstResponse: (response: {
      ok: boolean;
      status: number;
      json: () => Promise<ProductGraphTrace>;
    }) => void = () => {};
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("feature%3Afirst")) {
        return new Promise((resolve) => {
          resolveFirstResponse = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => secondTrace,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstLoad = useStore.getState().loadProductGraphTrace("feature:first");
    const secondLoad = useStore.getState().loadProductGraphTrace("feature:second");

    await expect(secondLoad).resolves.toEqual(secondTrace);
    expect(useStore.getState().productGraphTrace).toEqual(secondTrace);
    expect(useStore.getState().productGraphTraceNodeId).toBe("feature:second");

    resolveFirstResponse({
      ok: true,
      status: 200,
      json: async () => firstTrace,
    });
    await expect(firstLoad).resolves.toEqual(firstTrace);

    const state = useStore.getState();
    expect(state.productGraphTrace).toEqual(secondTrace);
    expect(state.productGraphTracesByNodeId["feature:first"]).toBeUndefined();
    expect(state.productGraphTracesByNodeId["feature:second"]).toEqual(secondTrace);
    expect(state.productGraphTraceNodeId).toBe("feature:second");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
  });

  it("keeps late failed trace responses from clearing the latest requested trace", async () => {
    const secondTrace = makeProductGraphTrace("feature:second", "Second feature");
    let resolveFirstResponse: (response: {
      ok: boolean;
      status: number;
      json: () => Promise<{ error: string }>;
    }) => void = () => {};
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("feature%3Afirst")) {
        return new Promise((resolve) => {
          resolveFirstResponse = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => secondTrace,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstLoad = useStore.getState().loadProductGraphTrace("feature:first");
    const secondLoad = useStore.getState().loadProductGraphTrace("feature:second");

    await expect(secondLoad).resolves.toEqual(secondTrace);
    resolveFirstResponse({
      ok: false,
      status: 404,
      json: async () => ({ error: "First trace is stale." }),
    });
    await expect(firstLoad).rejects.toMatchObject({ message: "First trace is stale." });

    const state = useStore.getState();
    expect(state.productGraphTrace).toEqual(secondTrace);
    expect(state.productGraphTracesByNodeId["feature:first"]).toBeUndefined();
    expect(state.productGraphTracesByNodeId["feature:second"]).toEqual(secondTrace);
    expect(state.productGraphTraceNodeId).toBe("feature:second");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
  });

  it("records product graph trace load failures without replacing the product graph", async () => {
    const projection = makeProductGraphProjection();
    useStore.setState({ productGraph: projection });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "Product graph node was not found." }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useStore.getState().loadProductGraphTrace("missing-node")).rejects.toMatchObject({
      message: "Product graph node was not found.",
    });

    const state = useStore.getState();
    expect(state.productGraph).toBe(projection);
    expect(state.productGraphTrace).toBeNull();
    expect(state.productGraphTraceNodeId).toBe("missing-node");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("Product graph node was not found.");
  });

  it("keeps the intent graph view active when the dashboard has one run", async () => {
    useStore.setState({
      activeGraphId: null,
      currentView: "intent",
      dashboardQuery: "",
      dashboardLifecycle: "all",
      dashboardAttention: "all",
      dashboardStatus: "all",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/graphs?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            schemaVersion: "1",
            items: [{ graphId: "graph-1" }],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 1,
              archivedRunCount: 0,
            },
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await useStore.getState().fetchGraphs();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/graphs?");
    expect(useStore.getState().currentView).toBe("intent");
    expect(useStore.getState().activeGraphId).toBeNull();
  });

  it("creates product graph nodes and refreshes the product graph projection", async () => {
    const node = makeProductGraphNode();
    const projection = {
      ...makeProductGraphProjection(),
      nodes: [
        {
          ...node,
          incomingEdgeIds: [],
          outgoingEdgeIds: [],
          blockedByNodeIds: [],
        },
      ],
      summary: {
        ...makeProductGraphProjection().summary,
        nodeCount: 1,
        nodesByKind: { feature: 1 },
      },
    } satisfies ProductGraphProjection;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/nodes")) {
        return {
          ok: true,
          status: 201,
          json: async () => node,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: true,
          status: 200,
          json: async () => projection,
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace();
    useStore.setState({
      productGraphCodexPlan: makeProductGraphCodexPlan(),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });

    await expect(
      useStore.getState().createProductGraphNode({
        id: node.id,
        kind: "feature",
        title: "Intent Graph",
      })
    ).resolves.toEqual(node);

    const createCall = fetchMock.mock.calls[0];
    expect(createCall[0]).toBe("/api/product-graph/nodes");
    expect(JSON.parse(String(createCall[1]?.body))).toEqual({
      id: "feature:intent-graph",
      kind: "feature",
      title: "Intent Graph",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(useStore.getState().productGraph).toEqual(projection);
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("returns created product graph nodes when projection refresh fails", async () => {
    const existingProjection = makeProductGraphProjection();
    const node = makeProductGraphNode();
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: makeProductGraphCodexPlan(),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/nodes")) {
        return {
          ok: true,
          status: 201,
          json: async () => node,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "refresh unavailable" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace("feature:intent-graph", "Intent Graph trace");

    await expect(
      useStore.getState().createProductGraphNode({
        id: node.id,
        kind: "feature",
        title: "Intent Graph",
      })
    ).resolves.toEqual(node);

    const state = useStore.getState();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/nodes");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe(
      "Product graph node was created, but the graph could not be refreshed. refresh unavailable"
    );
    expectProductGraphCodexPlanInvalidated();
    expectProductGraphTraceInvalidatedWithNotice();
  });

  it("surfaces product graph node creation errors without changing projection state", async () => {
    const existingProjection = makeProductGraphProjection();
    const existingCodexPlan = makeProductGraphCodexPlan("task:checkout-status-panel");
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: existingCodexPlan,
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
      productGraphCodexPlanLoading: false,
      productGraphCodexPlanError: "",
    });
    const trace = seedProductGraphTrace("feature:intent-graph", "Intent Graph trace");
    useStore.setState({
      productGraphTraceLoading: false,
      productGraphTraceError: "",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Product graph node id is invalid.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      useStore.getState().createProductGraphNode({
        id: "bad node id",
        kind: "feature",
        title: "Intent Graph",
      })
    ).rejects.toMatchObject({
      message: "Product graph node id is invalid.",
      status: 400,
    });

    const state = useStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/product-graph/nodes");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe("Product graph node id is invalid.");
    expect(state.productGraphTrace).toBe(trace);
    expect(state.productGraphTracesByNodeId).toEqual({
      "feature:intent-graph": trace,
    });
    expect(state.productGraphTraceNodeId).toBe("feature:intent-graph");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("");
    expect(state.productGraphCodexPlan).toBe(existingCodexPlan);
    expect(state.productGraphCodexPlanTaskNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphCodexPlanLoading).toBe(false);
    expect(state.productGraphCodexPlanError).toBe("");
  });

  it("creates product graph edges and refreshes the product graph projection", async () => {
    const edge = makeProductGraphEdge();
    const projection = {
      ...makeProductGraphProjection(),
      edges: [edge],
      summary: {
        ...makeProductGraphProjection().summary,
        edgeCount: 1,
        edgesByKind: { belongs_to: 1 },
      },
    } satisfies ProductGraphProjection;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/edges")) {
        return {
          ok: true,
          status: 201,
          json: async () => edge,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: true,
          status: 200,
          json: async () => projection,
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace();
    useStore.setState({
      productGraphCodexPlan: makeProductGraphCodexPlan(),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });

    await expect(
      useStore.getState().createProductGraphEdge({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        kind: edge.kind,
      })
    ).resolves.toEqual(edge);

    const createCall = fetchMock.mock.calls[0];
    expect(createCall[0]).toBe("/api/product-graph/edges");
    expect(JSON.parse(String(createCall[1]?.body))).toEqual({
      id: "edge-story-feature",
      sourceNodeId: "story-1",
      targetNodeId: "feature-1",
      kind: "belongs_to",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(useStore.getState().productGraph).toEqual(projection);
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("returns created product graph edges when projection refresh fails", async () => {
    const existingProjection = makeProductGraphProjection();
    const edge = makeProductGraphEdge();
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: makeProductGraphCodexPlan(),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/edges")) {
        return {
          ok: true,
          status: 201,
          json: async () => edge,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "refresh unavailable" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace("feature:intent-graph", "Intent Graph trace");

    await expect(
      useStore.getState().createProductGraphEdge({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        kind: edge.kind,
      })
    ).resolves.toEqual(edge);

    const state = useStore.getState();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/edges");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe(
      "Product graph edge was created, but the graph could not be refreshed. refresh unavailable"
    );
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("creates product graph intent bundles and refreshes the product graph projection", async () => {
    const bundle = makeProductGraphIntentBundle();
    const projection = {
      ...makeProductGraphProjection(),
      nodes: bundle.nodes.map((node) => ({
        ...node,
        incomingEdgeIds: [],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      })),
      edges: bundle.edges,
      summary: {
        ...makeProductGraphProjection().summary,
        nodeCount: bundle.nodes.length,
        edgeCount: bundle.edges.length,
        nodesByKind: {
          feature: 1,
          user_story: 1,
          acceptance_criterion: 1,
          task: 1,
        },
        edgesByKind: { belongs_to: 1 },
      },
    } satisfies ProductGraphProjection;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/intent-bundles")) {
        return {
          ok: true,
          status: 201,
          json: async () => bundle,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: true,
          status: 200,
          json: async () => projection,
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace();
    useStore.setState({
      productGraphCodexPlan: makeProductGraphCodexPlan("task:intent-view"),
      productGraphCodexPlanTaskNodeId: "task:intent-view",
    });

    await expect(
      useStore.getState().createProductGraphIntentBundle({
        feature: {
          id: "feature:intent-graph",
          title: "Intent Graph",
        },
        userStories: [
          {
            id: "story:operator-sees-intent",
            title: "Operator sees intent",
          },
        ],
        acceptanceCriteria: [
          {
            id: "criterion:intent-visible",
            title: "Intent is visible before execution",
          },
        ],
        tasks: [
          {
            id: "task:intent-view",
            title: "Build intent view",
          },
        ],
      })
    ).resolves.toEqual(bundle);

    const createCall = fetchMock.mock.calls[0];
    expect(createCall[0]).toBe("/api/product-graph/intent-bundles");
    expect(JSON.parse(String(createCall[1]?.body))).toEqual({
      feature: {
        id: "feature:intent-graph",
        title: "Intent Graph",
      },
      userStories: [
        {
          id: "story:operator-sees-intent",
          title: "Operator sees intent",
        },
      ],
      acceptanceCriteria: [
        {
          id: "criterion:intent-visible",
          title: "Intent is visible before execution",
        },
      ],
      tasks: [
        {
          id: "task:intent-view",
          title: "Build intent view",
        },
      ],
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(useStore.getState().productGraph).toEqual(projection);
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("returns created product graph intent bundles when projection refresh fails", async () => {
    const existingProjection = makeProductGraphProjection();
    const bundle = makeProductGraphIntentBundle();
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: makeProductGraphCodexPlan("task:intent-view"),
      productGraphCodexPlanTaskNodeId: "task:intent-view",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/intent-bundles")) {
        return {
          ok: true,
          status: 201,
          json: async () => bundle,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "refresh unavailable" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace("feature:intent-graph", "Intent Graph trace");

    await expect(
      useStore.getState().createProductGraphIntentBundle({
        feature: {
          id: "feature:intent-graph",
          title: "Intent Graph",
        },
        userStories: [
          {
            id: "story:operator-sees-intent",
            title: "Operator sees intent",
          },
        ],
        acceptanceCriteria: [
          {
            id: "criterion:intent-visible",
            title: "Intent is visible before execution",
          },
        ],
        tasks: [
          {
            id: "task:intent-view",
            title: "Build intent view",
          },
        ],
      })
    ).resolves.toEqual(bundle);

    const state = useStore.getState();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/intent-bundles");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe(
      "Product graph intent bundle was created, but the graph could not be refreshed. refresh unavailable"
    );
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("surfaces product graph intent bundle creation errors without changing projection state", async () => {
    const existingProjection = makeProductGraphProjection();
    const existingCodexPlan = makeProductGraphCodexPlan("task:intent-view");
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: existingCodexPlan,
      productGraphCodexPlanTaskNodeId: "task:intent-view",
      productGraphCodexPlanLoading: false,
      productGraphCodexPlanError: "",
    });
    const trace = seedProductGraphTrace("feature:intent-graph", "Intent Graph trace");
    useStore.setState({
      productGraphTraceLoading: false,
      productGraphTraceError: "",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Intent bundle feature title is required.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      useStore.getState().createProductGraphIntentBundle({
        feature: {
          id: "feature:intent-graph",
          title: "",
        },
        userStories: [
          {
            id: "story:operator-sees-intent",
            title: "Operator sees intent",
          },
        ],
        acceptanceCriteria: [
          {
            id: "criterion:intent-visible",
            title: "Intent is visible before execution",
          },
        ],
        tasks: [
          {
            id: "task:intent-view",
            title: "Build intent view",
          },
        ],
      })
    ).rejects.toMatchObject({
      message: "Intent bundle feature title is required.",
      status: 400,
    });

    const state = useStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/product-graph/intent-bundles");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe("Intent bundle feature title is required.");
    expect(state.productGraphTrace).toBe(trace);
    expect(state.productGraphTracesByNodeId).toEqual({
      "feature:intent-graph": trace,
    });
    expect(state.productGraphTraceNodeId).toBe("feature:intent-graph");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("");
    expect(state.productGraphCodexPlan).toBe(existingCodexPlan);
    expect(state.productGraphCodexPlanTaskNodeId).toBe("task:intent-view");
    expect(state.productGraphCodexPlanLoading).toBe(false);
    expect(state.productGraphCodexPlanError).toBe("");
  });

  it("imports Spec Kit artifacts and refreshes the product graph projection", async () => {
    const importResult = makeProductGraphSpecKitImportResult();
    const projection = {
      ...makeProductGraphProjection(),
      nodes: [
        {
          ...makeProductGraphNode(),
          incomingEdgeIds: [],
          outgoingEdgeIds: [],
          blockedByNodeIds: [],
        },
      ],
      summary: {
        ...makeProductGraphProjection().summary,
        nodeCount: 1,
        nodesByKind: { feature: 1 },
      },
    } satisfies ProductGraphProjection;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/spec-kit/import")) {
        return {
          ok: true,
          status: 201,
          json: async () => importResult,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: true,
          status: 200,
          json: async () => projection,
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace();
    useStore.setState({
      productGraphCodexPlan: makeProductGraphCodexPlan(),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });

    await expect(useStore.getState().importProductGraphSpecKit()).resolves.toEqual(importResult);

    const importCall = fetchMock.mock.calls[0];
    const headers = new Headers(importCall[1]?.headers);
    expect(importCall[0]).toBe("/api/product-graph/spec-kit/import");
    expect(importCall[1]?.method).toBe("POST");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(headers.has("Content-Type")).toBe(false);
    expect(importCall[1]?.body).toBeUndefined();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(useStore.getState().productGraph).toEqual(projection);
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("returns Spec Kit import results when projection refresh fails", async () => {
    const existingProjection = makeProductGraphProjection();
    const importResult = makeProductGraphSpecKitImportResult();
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: makeProductGraphCodexPlan(),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/spec-kit/import")) {
        return {
          ok: true,
          status: 201,
          json: async () => importResult,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "refresh unavailable" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace("task:checkout-status-panel", "Checkout task trace");

    await expect(useStore.getState().importProductGraphSpecKit()).resolves.toEqual(importResult);

    const state = useStore.getState();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/spec-kit/import");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe(
      "Product graph Spec Kit import completed, but the graph could not be refreshed. refresh unavailable"
    );
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("surfaces Spec Kit import errors without changing projection state", async () => {
    const existingProjection = makeProductGraphProjection();
    const existingCodexPlan = makeProductGraphCodexPlan("task:checkout-status-panel");
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: existingCodexPlan,
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
      productGraphCodexPlanLoading: false,
      productGraphCodexPlanError: "",
    });
    const trace = seedProductGraphTrace("task:checkout-status-panel", "Checkout task trace");
    useStore.setState({
      productGraphTraceLoading: false,
      productGraphTraceError: "",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        message: "Spec Kit artifacts are missing.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(useStore.getState().importProductGraphSpecKit()).rejects.toMatchObject({
      message: "Spec Kit artifacts are missing.",
      status: 404,
    });

    const state = useStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe("Spec Kit artifacts are missing.");
    expect(state.productGraphTrace).toBe(trace);
    expect(state.productGraphTracesByNodeId).toEqual({
      "task:checkout-status-panel": trace,
    });
    expect(state.productGraphTraceNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("");
    expect(state.productGraphCodexPlan).toBe(existingCodexPlan);
    expect(state.productGraphCodexPlanTaskNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphCodexPlanLoading).toBe(false);
    expect(state.productGraphCodexPlanError).toBe("");
  });

  it("scans the codebase and refreshes the product graph projection", async () => {
    const scanResult = makeProductGraphCodebaseScanResult();
    const projection = {
      ...makeProductGraphProjection(),
      nodes: [
        {
          ...makeProductGraphNode(),
          incomingEdgeIds: [],
          outgoingEdgeIds: [],
          blockedByNodeIds: [],
        },
      ],
      summary: {
        ...makeProductGraphProjection().summary,
        nodeCount: 1,
        nodesByKind: { feature: 1 },
      },
    } satisfies ProductGraphProjection;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/codebase/scan-jobs")) {
        return {
          ok: true,
          status: 202,
          json: async () => makeProductGraphCodebaseScanJob(scanResult, "running"),
        } as Response;
      }
      if (url.endsWith("/product-graph/codebase/scan-jobs/product-job-1/events")) {
        return makeScanJobSseResponse(makeProductGraphCodebaseScanJob(scanResult));
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: true,
          status: 200,
          json: async () => projection,
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace();
    useStore.setState({
      productGraphCodexPlan: makeProductGraphCodexPlan(),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });

    await expect(useStore.getState().scanProductGraphCodebase()).resolves.toEqual(scanResult);

    const importCall = fetchMock.mock.calls[0];
    const headers = new Headers(importCall[1]?.headers);
    expect(importCall[0]).toBe("/api/product-graph/codebase/scan-jobs");
    expect(importCall[1]?.method).toBe("POST");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(headers.has("Content-Type")).toBe(false);
    expect(importCall[1]?.body).toBeUndefined();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph/codebase/scan-jobs/product-job-1/events");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/product-graph");
    expect(useStore.getState().productGraph).toEqual(projection);
    expect(useStore.getState().productGraphCodebaseScanProgress?.phase).toBe("completed");
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("returns Codebase scan results when projection refresh fails", async () => {
    const existingProjection = makeProductGraphProjection();
    const scanResult = makeProductGraphCodebaseScanResult();
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: makeProductGraphCodexPlan(),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/codebase/scan-jobs")) {
        return {
          ok: true,
          status: 202,
          json: async () => makeProductGraphCodebaseScanJob(scanResult, "running"),
        } as Response;
      }
      if (url.endsWith("/product-graph/codebase/scan-jobs/product-job-1/events")) {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/product-graph/codebase/scan-jobs/product-job-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => makeProductGraphCodebaseScanJob(scanResult),
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "refresh unavailable" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace("task:checkout-status-panel", "Checkout task trace");

    await expect(useStore.getState().scanProductGraphCodebase()).resolves.toEqual(scanResult);

    const state = useStore.getState();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/codebase/scan-jobs");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph/codebase/scan-jobs/product-job-1/events");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/product-graph/codebase/scan-jobs/product-job-1");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/product-graph");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe(
      "Product graph Codebase scan completed, but the graph could not be refreshed. refresh unavailable"
    );
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("surfaces Codebase scan errors without changing projection state", async () => {
    const existingProjection = makeProductGraphProjection();
    const existingCodexPlan = makeProductGraphCodexPlan("task:checkout-status-panel");
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: existingCodexPlan,
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
      productGraphCodexPlanLoading: false,
      productGraphCodexPlanError: "",
    });
    const trace = seedProductGraphTrace("task:checkout-status-panel", "Checkout task trace");
    useStore.setState({
      productGraphTraceLoading: false,
      productGraphTraceError: "",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: "Codebase scan could not be completed.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(useStore.getState().scanProductGraphCodebase()).rejects.toMatchObject({
      message: "Codebase scan could not be completed.",
      status: 404,
    });

    const state = useStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const jobStartCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    const fallbackScanCall = fetchMock.mock.calls[1] as unknown as [RequestInfo | URL, RequestInit?];
    expect(jobStartCall[0]).toBe("/api/product-graph/codebase/scan-jobs");
    expect(fallbackScanCall[0]).toBe("/api/product-graph/codebase/scan");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe(
      "Codebase scan could not be completed."
    );
    expect(state.productGraphTrace).toBe(trace);
    expect(state.productGraphTracesByNodeId).toEqual({
      "task:checkout-status-panel": trace,
    });
    expect(state.productGraphTraceNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("");
    expect(state.productGraphCodexPlan).toBe(existingCodexPlan);
    expect(state.productGraphCodexPlanTaskNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphCodexPlanLoading).toBe(false);
    expect(state.productGraphCodexPlanError).toBe("");
  });

  it("links completed runs to product graph tasks and refreshes the product graph projection", async () => {
    const link = makeProductGraphRunLink();
    const projection = {
      ...makeProductGraphProjection(),
      nodes: [
        {
          ...link.node,
          incomingEdgeIds: [link.edge.id],
          outgoingEdgeIds: [],
          blockedByNodeIds: [],
        },
      ],
      edges: [link.edge],
      summary: {
        ...makeProductGraphProjection().summary,
        nodeCount: 1,
        edgeCount: 1,
        nodesByKind: { agent_run: 1 },
        edgesByKind: { produced_by: 1 },
      },
    } satisfies ProductGraphProjection;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/runs/graph%3Acheckout-proof/link")) {
        return {
          ok: true,
          status: 201,
          json: async () => link,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: true,
          status: 200,
          json: async () => projection,
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    seedProductGraphTrace("task:checkout-status-panel", "Checkout task trace");
    useStore.setState({
      productGraphCodexPlan: makeProductGraphCodexPlan("task:checkout-status-panel"),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });

    await expect(
      useStore.getState().linkProductGraphRun({
        graphId: "graph:checkout-proof",
        taskNodeId: "task:checkout-status-panel",
      })
    ).resolves.toEqual(link);

    const createCall = fetchMock.mock.calls[0];
    const headers = new Headers(createCall[1]?.headers);
    expect(createCall[0]).toBe("/api/product-graph/runs/graph%3Acheckout-proof/link");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(JSON.parse(String(createCall[1]?.body))).toEqual({
      taskNodeId: "task:checkout-status-panel",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(useStore.getState().productGraph).toEqual(projection);
    expectProductGraphTraceInvalidatedWithNotice();
    expectProductGraphCodexPlanInvalidated();
  });

  it("returns created run links when projection refresh fails", async () => {
    const existingProjection = makeProductGraphProjection();
    const link = makeProductGraphRunLink();
    const trace = makeProductGraphTrace("task:checkout-status-panel", "Checkout task trace");
    useStore.setState({
      productGraph: existingProjection,
      productGraphTrace: trace,
      productGraphTracesByNodeId: {
        "task:checkout-status-panel": trace,
      },
      productGraphTraceNodeId: "task:checkout-status-panel",
      productGraphTraceError: "Previous trace refresh failed.",
      productGraphCodexPlan: makeProductGraphCodexPlan("task:checkout-status-panel"),
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/product-graph/runs/graph%3Acheckout-proof/link")) {
        return {
          ok: true,
          status: 201,
          json: async () => link,
        } as Response;
      }
      if (url.endsWith("/product-graph")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "refresh unavailable" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      useStore.getState().linkProductGraphRun({
        graphId: "graph:checkout-proof",
        taskNodeId: "task:checkout-status-panel",
      })
    ).resolves.toEqual(link);

    const state = useStore.getState();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/product-graph/runs/graph%3Acheckout-proof/link");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/product-graph");
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe(
      "Product graph run link was created, but the graph could not be refreshed. refresh unavailable"
    );
    expect(state.productGraphTrace).toBeNull();
    expect(state.productGraphTracesByNodeId).toEqual({});
    expect(state.productGraphTraceNodeId).toBeNull();
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("Graph trace cache cleared after graph refresh.");
    expectProductGraphCodexPlanInvalidated();
  });

  it("surfaces run link creation errors without changing projection state", async () => {
    const existingProjection = makeProductGraphProjection();
    const existingCodexPlan = makeProductGraphCodexPlan("task:checkout-status-panel");
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: existingCodexPlan,
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
      productGraphCodexPlanLoading: false,
      productGraphCodexPlanError: "",
    });
    const trace = seedProductGraphTrace("task:checkout-status-panel", "Checkout task trace");
    useStore.setState({
      productGraphTraceLoading: false,
      productGraphTraceError: "",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "Only completed OpenAgentGraph runs can be linked to product graph tasks.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      useStore.getState().linkProductGraphRun({
        graphId: "graph:running-proof",
        taskNodeId: "task:checkout-status-panel",
      })
    ).rejects.toMatchObject({
      message: "Only completed OpenAgentGraph runs can be linked to product graph tasks.",
      status: 409,
    });

    const state = useStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe("Only completed OpenAgentGraph runs can be linked to product graph tasks.");
    expect(state.productGraphTrace).toBe(trace);
    expect(state.productGraphTracesByNodeId).toEqual({
      "task:checkout-status-panel": trace,
    });
    expect(state.productGraphTraceNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("");
    expect(state.productGraphCodexPlan).toBe(existingCodexPlan);
    expect(state.productGraphCodexPlanTaskNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphCodexPlanLoading).toBe(false);
    expect(state.productGraphCodexPlanError).toBe("");
  });

  it("surfaces product graph edge creation errors without changing projection state", async () => {
    const existingProjection = makeProductGraphProjection();
    const existingCodexPlan = makeProductGraphCodexPlan("task:checkout-status-panel");
    useStore.setState({
      productGraph: existingProjection,
      productGraphCodexPlan: existingCodexPlan,
      productGraphCodexPlanTaskNodeId: "task:checkout-status-panel",
      productGraphCodexPlanLoading: false,
      productGraphCodexPlanError: "",
    });
    const trace = seedProductGraphTrace("feature:intent-graph", "Intent Graph trace");
    useStore.setState({
      productGraphTraceLoading: false,
      productGraphTraceError: "",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "targetNodeId must reference an existing product graph node.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      useStore.getState().createProductGraphEdge({
        sourceNodeId: "story-1",
        targetNodeId: "missing-feature",
        kind: "belongs_to",
      })
    ).rejects.toMatchObject({
      message: "targetNodeId must reference an existing product graph node.",
      status: 400,
    });

    const state = useStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.productGraph).toBe(existingProjection);
    expect(state.productGraphLoading).toBe(false);
    expect(state.productGraphError).toBe("targetNodeId must reference an existing product graph node.");
    expect(state.productGraphTrace).toBe(trace);
    expect(state.productGraphTracesByNodeId).toEqual({
      "feature:intent-graph": trace,
    });
    expect(state.productGraphTraceNodeId).toBe("feature:intent-graph");
    expect(state.productGraphTraceLoading).toBe(false);
    expect(state.productGraphTraceError).toBe("");
    expect(state.productGraphTraceNotice).toBe("");
    expect(state.productGraphCodexPlan).toBe(existingCodexPlan);
    expect(state.productGraphCodexPlanTaskNodeId).toBe("task:checkout-status-panel");
    expect(state.productGraphCodexPlanLoading).toBe(false);
    expect(state.productGraphCodexPlanError).toBe("");
  });
});
