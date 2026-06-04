import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App, GraphUnavailableState, buildProductGraphPreviewStatePatch, shouldRunAppBootRequests } from "./App.js";
import {
  GoalRunReadinessNotice,
  AI_PROVIDER_SETUP_GUIDE_PATH,
  TOOLBAR_LAYOUT_CSS,
  copyAiProviderSetupGuidePath,
  getGoalRunReadinessState,
  getProviderRefreshReadinessNotice,
  getProductGraphRefreshActionState,
  normalizeRunWorkspaceRoot,
  readStoredWorkspaceRoot,
  shouldRequestProductGraphOnIntentNav,
  writeStoredWorkspaceRoot,
} from "./components/Toolbar.js";
import { getProductGraphPreviewProjection, PRODUCT_GRAPH_PREVIEW_MESSAGE } from "./lib/productGraphPreview.js";
import { useStore } from "./lib/store.js";

describe("App lazy graph boundary", () => {
  beforeEach(() => {
    useStore.setState((state) => ({
      ...state,
      currentView: "dashboard",
      runtimeLoading: false,
      sessionLoading: false,
      activeGraphId: null,
      dashboard: [],
      dashboardSummary: {
        urgentRunCount: 0,
        needsReviewCount: 0,
        blockedRunCount: 0,
        activeRunCount: 0,
        archivedRunCount: 0,
      },
      graphs: [],
    }));
  });

  it("does not render the lazy graph loading boundary while the dashboard view is active", () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).not.toContain("Loading graph view");
  });

  it("shows a calm startup state while runtime and session checks are still loading", () => {
    useStore.setState((state) => ({
      ...state,
      runtimeLoading: true,
      sessionLoading: true,
    }));

    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain("Preparing OpenAgentGraph");
  });

  it("builds a read-only Product Graph preview state without boot request loading", () => {
    const projection = getProductGraphPreviewProjection("?productGraphPreview=work-next", "127.0.0.1");

    expect(projection).not.toBeNull();
    expect(shouldRunAppBootRequests(null)).toBe(true);
    expect(shouldRunAppBootRequests(projection)).toBe(false);

    const patch = buildProductGraphPreviewStatePatch(projection!);

    expect(patch).toMatchObject({
      currentView: "intent",
      dashboardLoading: false,
      productGraph: projection,
      productGraphLoading: false,
      productGraphError: "",
      productGraphTrace: null,
      productGraphTracesByNodeId: {},
      productGraphTraceNodeId: null,
      productGraphTraceLoading: false,
      productGraphTraceError: "",
      productGraphTraceNotice: "",
      runtimeLoading: false,
      sessionLoading: false,
      runtimeStatus: "read_only",
      runtimeMessage: PRODUCT_GRAPH_PREVIEW_MESSAGE,
      backendReadyStatus: "unknown",
      runtimeHealthSummary: PRODUCT_GRAPH_PREVIEW_MESSAGE,
      runtimeFallbackLikely: false,
      authStatus: "anonymous",
      sessionLifecycle: "read_only",
      authMessage: PRODUCT_GRAPH_PREVIEW_MESSAGE,
    });
  });

  it("disables the toolbar intent refresh action for the seeded preview graph", () => {
    const projection = getProductGraphPreviewProjection("?productGraphPreview=work-next", "127.0.0.1");

    expect(getProductGraphRefreshActionState(projection, false)).toEqual({
      disabled: true,
      label: "Preview mode",
      title: "Preview mode uses seeded local data.",
    });
    expect(getProductGraphRefreshActionState(projection, true)).toEqual({
      disabled: true,
      label: "Preview mode",
      title: "Preview mode uses seeded local data.",
    });
    expect(getProductGraphRefreshActionState(null, false)).toEqual({
      disabled: false,
      label: "Refresh intent graph",
      title: undefined,
    });
    expect(shouldRequestProductGraphOnIntentNav(projection)).toBe(false);
    expect(shouldRequestProductGraphOnIntentNav(null)).toBe(true);
  });

  it("renders a safe graph-only fallback state without affecting the rest of the run copy", () => {
    const markup = renderToStaticMarkup(
      <GraphUnavailableState onRetry={() => undefined} uiMode="default" />
    );

    expect(markup).toContain("The 3D graph could not be shown right now, but the rest of the run is still available.");
    expect(markup).toContain("Retry graph");
  });

  it("includes responsive toolbar rules for narrow app viewports", () => {
    expect(TOOLBAR_LAYOUT_CSS).toContain("@media (max-width: 900px)");
    expect(TOOLBAR_LAYOUT_CSS).toContain(".app-toolbar");
    expect(TOOLBAR_LAYOUT_CSS).toContain("grid-template-columns: 1fr");
  });

  it("explains when a goal run needs workspace and provider setup before execution", () => {
    expect(
      getGoalRunReadinessState({
        activeGraphId: "graph-1",
        workspaceRoot: "",
        isRunning: false,
        runControlState: "idle",
        providerExecutionBlocked: true,
      })
    ).toEqual({
      disabled: true,
      message: "Add a workspace path and configure the AI provider before running this goal.",
      providerBlocked: true,
      workspaceMissing: true,
    });
    expect(
      getGoalRunReadinessState({
        activeGraphId: "graph-1",
        workspaceRoot: "C:\\Users\\yashm\\Desktop\\openagentgraph",
        isRunning: false,
        runControlState: "idle",
        providerExecutionBlocked: false,
      })
    ).toMatchObject({
      disabled: false,
      message: "",
    });
  });

  it("keeps goal run readiness copy specific to the active blocker", () => {
    expect(
      getGoalRunReadinessState({
        activeGraphId: "graph-1",
        workspaceRoot: "",
        isRunning: false,
        runControlState: "idle",
        providerExecutionBlocked: false,
      })
    ).toMatchObject({
      disabled: true,
      message: "Add a workspace path before running this goal.",
    });
    expect(
      getGoalRunReadinessState({
        activeGraphId: "graph-1",
        workspaceRoot: "C:\\Users\\yashm\\Desktop\\openagentgraph",
        isRunning: false,
        runControlState: "idle",
        providerExecutionBlocked: true,
      })
    ).toMatchObject({
      disabled: true,
      message: "Configure the AI provider before running this goal.",
    });
    expect(
      getGoalRunReadinessState({
        activeGraphId: "graph-1",
        workspaceRoot: "C:\\Users\\yashm\\Desktop\\openagentgraph",
        isRunning: false,
        runControlState: "paused",
        providerExecutionBlocked: false,
      })
    ).toMatchObject({
      disabled: true,
      message: "Resume this paused run instead of starting a new one.",
    });
  });

  it("renders goal run readiness copy through the toolbar notice component", () => {
    const markup = renderToStaticMarkup(
      <GoalRunReadinessNotice
        message="Add a workspace path before running this goal."
        isRunning={false}
      />
    );

    expect(markup).toContain("Add a workspace path before running this goal.");
    expect(renderToStaticMarkup(
      <GoalRunReadinessNotice
        message="Goal execution is already running."
        isRunning={true}
      />
    )).toBe("");
  });

  it("renders setup actions for active goal run blockers", () => {
    const markup = renderToStaticMarkup(
      <GoalRunReadinessNotice
        message="Add a workspace path and configure the AI provider before running this goal."
        isRunning={false}
        workspaceMissing={true}
        providerBlocked={true}
        providerRefreshNotice={{
          tone: "success",
          message: "AI provider is configured. Add a workspace path to run this goal.",
        }}
        onFocusWorkspace={() => undefined}
        onCopyProviderSetupGuidePath={() => undefined}
        onRefreshProviderReadiness={() => undefined}
      />
    );

    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("Focus workspace path");
    expect(markup).toContain("role=\"group\"");
    expect(markup).toContain("aria-label=\"Provider setup steps\"");
    expect(markup).toContain("Provider setup:");
    expect(markup).toContain("1. Choose Ollama local with a model, or choose OpenAI and paste an API key.");
    expect(markup).toContain("2. Environment provider changes require a backend restart; Dashboard changes apply to this running backend process.");
    expect(markup).toContain("3. Refresh provider status.");
    expect(markup).toContain(`Guide: ${AI_PROVIDER_SETUP_GUIDE_PATH}`);
    expect(markup).toContain("Copy guide path</button>");
    expect(markup).toContain("Refresh provider status</button>");
    expect(markup).toContain("aria-label=\"Provider refresh result\"");
    expect(markup).toContain("AI provider is configured. Add a workspace path to run this goal.");

    const loadingMarkup = renderToStaticMarkup(
      <GoalRunReadinessNotice
        message="Configure the AI provider before running this goal."
        isRunning={false}
        providerBlocked={true}
        providerRefreshLoading={true}
        onRefreshProviderReadiness={() => undefined}
      />
    );

    expect(loadingMarkup).toContain("Checking provider...");
    expect(loadingMarkup).toContain("disabled=\"\"");
  });

  it("summarizes provider refresh results for the run readiness notice", () => {
    expect(
      getProviderRefreshReadinessNotice({
        runtimeFallbackLikely: false,
        backendReadyStatus: "ok",
        runtimeStatus: "connected",
        workspaceRoot: "C:\\Users\\yashm\\Desktop\\openagentgraph",
      })
    ).toEqual({
      tone: "success",
      message: "AI provider is configured. Run is ready.",
    });
    expect(
      getProviderRefreshReadinessNotice({
        runtimeFallbackLikely: false,
        backendReadyStatus: "ok",
        runtimeStatus: "connected",
        workspaceRoot: "",
      })
    ).toEqual({
      tone: "success",
      message: "AI provider is configured. Add a workspace path to run this goal.",
    });
    expect(
      getProviderRefreshReadinessNotice({
        runtimeFallbackLikely: false,
        backendReadyStatus: "ok",
        runtimeStatus: "read_only",
        workspaceRoot: "C:\\Users\\yashm\\Desktop\\openagentgraph",
      })
    ).toEqual({
      tone: "warning",
      message: "AI provider is configured. Sign in before running this goal.",
    });
    expect(
      getProviderRefreshReadinessNotice({
        runtimeFallbackLikely: false,
        backendReadyStatus: "ok",
        runtimeStatus: "auth_required",
        workspaceRoot: "",
      })
    ).toEqual({
      tone: "warning",
      message: "AI provider is configured. Sign in and add a workspace path before running this goal.",
    });
    expect(
      getProviderRefreshReadinessNotice({
        runtimeFallbackLikely: true,
        backendReadyStatus: "degraded",
        runtimeStatus: "degraded",
        workspaceRoot: "C:\\Users\\yashm\\Desktop\\openagentgraph",
      })
    ).toEqual({
      tone: "warning",
      message: "AI provider is still not configured. Follow the setup steps and refresh again.",
    });
    expect(
      getProviderRefreshReadinessNotice({
        runtimeFallbackLikely: false,
        backendReadyStatus: "error",
        runtimeStatus: "unreachable",
        workspaceRoot: "C:\\Users\\yashm\\Desktop\\openagentgraph",
      })
    ).toEqual({
      tone: "warning",
      message: "Provider status could not be refreshed. Check the backend and try again.",
    });
  });

  it("renders provider refresh confirmation without an active blocker message", () => {
    const markup = renderToStaticMarkup(
      <GoalRunReadinessNotice
        message=""
        isRunning={false}
        providerRefreshNotice={{
          tone: "success",
          message: "AI provider is configured. Run is ready.",
        }}
      />
    );

    expect(markup).toContain("aria-label=\"Provider refresh result\"");
    expect(markup).toContain("AI provider is configured. Run is ready.");
    expect(markup).not.toContain("Provider setup:");
  });

  it("copies the AI provider setup guide path through an injected clipboard writer", async () => {
    const clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };

    await expect(copyAiProviderSetupGuidePath(clipboard)).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith(AI_PROVIDER_SETUP_GUIDE_PATH);

    await expect(
      copyAiProviderSetupGuidePath({
        writeText: vi.fn().mockRejectedValue(new Error("clipboard unavailable")),
      })
    ).resolves.toBe(false);
  });

  it("persists a trimmed workspace path for future run attempts", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    };

    writeStoredWorkspaceRoot("  C:\\Users\\yashm\\Desktop\\openagentgraph  ", storage);

    expect(readStoredWorkspaceRoot(storage)).toBe("C:\\Users\\yashm\\Desktop\\openagentgraph");
    expect(storage.setItem).toHaveBeenCalledWith(
      expect.stringContaining("run-workspace-root"),
      "C:\\Users\\yashm\\Desktop\\openagentgraph"
    );

    writeStoredWorkspaceRoot("   ", storage);

    expect(readStoredWorkspaceRoot(storage)).toBe("");
    expect(storage.removeItem).toHaveBeenCalledWith(expect.stringContaining("run-workspace-root"));
  });

  it("keeps run controls usable when workspace path storage is unavailable", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      removeItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    };

    expect(readStoredWorkspaceRoot(storage)).toBe("");
    expect(() => writeStoredWorkspaceRoot("C:\\workspace", storage)).not.toThrow();
  });

  it("preserves full trimmed workspace paths for run execution", () => {
    const longWorkspaceRoot = `C:\\workspace\\${"a".repeat(1100)}`;
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    };

    expect(normalizeRunWorkspaceRoot(`  ${longWorkspaceRoot}  `)).toBe(longWorkspaceRoot);

    writeStoredWorkspaceRoot(`  ${longWorkspaceRoot}  `, storage);

    const storedWorkspaceRoot = readStoredWorkspaceRoot(storage);
    expect(storedWorkspaceRoot).toHaveLength(1024);
    expect(storedWorkspaceRoot).toBe(longWorkspaceRoot.slice(0, 1024));
  });
});
