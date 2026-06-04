import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { useStore } from "../lib/store.js";
import { DashboardView, getDashboardEmptyState } from "./DashboardView.js";

describe("DashboardView empty states", () => {
  it("shows a clear first-run read-only message", () => {
    expect(
      getDashboardEmptyState({
        runtimeStatus: "connected",
        runtimeFallbackLikely: false,
        sessionLifecycle: "read_only",
      })
    ).toEqual({
      title: "Read-only mode",
      body: "You can view this workspace, but protected actions require sign-in.",
      nextSteps: [
        "Runs will still appear here when the backend creates them.",
        "Sign in when you want to manage runs, approvals, or annotations.",
      ],
    });
  });

  it("shows a degraded first-run fallback message when the backend is limited", () => {
    expect(
      getDashboardEmptyState({
        runtimeStatus: "degraded",
        runtimeFallbackLikely: true,
        sessionLifecycle: "signed_in",
      })
    ).toEqual({
      title: "Backend connected with limits",
      body: "Backend connected, but some AI features are currently using fallback behavior.",
      nextSteps: [
        "You can still inspect runs and replay progress from the current projection state.",
        "Operator controls will become more useful once the backend is fully ready.",
      ],
    });
  });

  it("shows a calm first-run message when the backend is healthy but no runs exist", () => {
    expect(
      getDashboardEmptyState({
        runtimeStatus: "connected",
        runtimeFallbackLikely: false,
        sessionLifecycle: "signed_in",
      })
    ).toEqual({
      title: "No runs yet",
      body: "No runs yet. OpenAgentGraph is ready to observe or manage runs once the backend has created them.",
      nextSteps: [
        "Runs appear here after the backend creates them for a workspace.",
        "Open a run to inspect the graph, evidence, replay, and human decisions.",
      ],
    });
  });

  it("renders provider setup on the empty dashboard without persisting the key in state", () => {
    useStore.setState({
      dashboard: [],
      dashboardLoading: false,
      onboardingDismissed: true,
      runtimeStatus: "degraded",
      runtimeFallbackLikely: true,
      runtimeEnvironmentMode: "development",
      apiBaseDisplay: "/api",
      runtimeHealthSummary: "AI provider is not configured.",
      runtimeMessage: "AI provider is not configured.",
      sessionLifecycle: "signed_in",
      authMode: "dev_header",
      authMessage: "Signed in as Operator.",
      currentActor: { actorId: "operator", displayName: "Operator", role: "operator" },
      providerStatus: {
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      },
      providerConfigSaving: false,
      providerConfigMessage: "",
      fetchGraphs: async () => undefined,
      loadProviderStatus: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
      clearRuntimeProviderConfig: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
    });

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<DashboardView />);
    });
    const markup = JSON.stringify(renderer!.toJSON());

    expect(markup).toContain("Provider setup");
    expect(markup).toContain("Choose an AI provider");
    expect(markup).toContain("Ollama local - no API key");
    expect(markup).toContain("Gemini API key");
    expect(markup).toContain("Anthropic API key");
    expect(markup).toContain("Custom OpenAI-compatible");
    expect(markup).toContain("Ollama model");
    expect(markup).toContain("http://localhost:11434/v1");
    expect(markup).toContain("Ollama must use localhost or a loopback address; http is allowed only for localhost, 127.x.x.x, or loopback addresses.");
    expect(markup).toContain("Graph scans, Code Map, Project Graph, and GRAPH_REPORT.md do not need a provider key.");
    expect(markup).not.toContain("sk-test");
  });

  it("renders the first-run setup strip from handoff trust status", () => {
    useStore.setState({
      dashboard: [],
      dashboardLoading: false,
      onboardingDismissed: true,
      runtimeStatus: "connected",
      runtimeFallbackLikely: false,
      runtimeEnvironmentMode: "development",
      apiBaseDisplay: "/api",
      runtimeHealthSummary: "Backend connected.",
      runtimeMessage: "",
      sessionLifecycle: "signed_in",
      authMode: "dev_header",
      authMessage: "Signed in as Operator.",
      currentActor: { actorId: "operator", displayName: "Operator", role: "operator" },
      providerStatus: {
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      },
      providerConfigSaving: false,
      providerConfigMessage: "",
      productGraphHandoffLoading: false,
      productGraphHandoffError: "",
      productGraphHandoff: {
        markdown: "# OpenAgentGraph Handoff",
        summary: {
          nodeCount: 10,
          edgeCount: 8,
          codeFileCount: 6,
          codeSymbolCount: 12,
          taskScopeCount: 3,
          riskCount: 0,
          recommendedReadCount: 4,
          generatedAt: "2026-06-02T00:00:00.000Z",
          productGraphId: "default",
          workspaceRoot: "C:/workspace/openagentgraph",
          workspaceRootSource: "configured",
          dataSource: "SQLite C:/workspace/openagentgraph/data/openagentgraph.db",
          latestCodeScanUpdatedAt: "2026-06-02T00:00:00.000Z",
          semanticAnalysisSucceeded: true,
          semanticResolutionCount: 8,
          semanticEdgeCount: 14,
          workspacePathCheck: {
            checkedFileCount: 6,
            missingFileCount: 0,
            status: "aligned",
          },
          handoffFile: {
            path: "GRAPH_REPORT.md",
            exists: true,
            updatedAt: "2026-06-02T00:01:00.000Z",
          },
        },
      },
      fetchGraphs: async () => undefined,
      loadProductGraphHandoff: async () => useStore.getState().productGraphHandoff!,
      loadProviderStatus: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
      clearRuntimeProviderConfig: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
    });

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<DashboardView />);
    });
    const markup = JSON.stringify(renderer!.toJSON());

    expect(markup).toContain("Start here");
    expect(markup).toContain("Workspace configured");
    expect(markup).toContain("C:/workspace/openagentgraph (configured)");
    expect(markup).toContain("Product Graph scan");
    expect(markup).toContain("2026-06-02T00:00:00.000Z; 6 files, 12 symbols.");
    expect(markup).toContain("Handoff written");
    expect(markup).toContain("GRAPH_REPORT.md updated 2026-06-02T00:01:00.000Z");
    expect(markup).toContain("Provider optional");
    expect(markup).toContain("Graph scans, Code Map, Project Graph, and GRAPH_REPORT.md work with no provider key.");
  });

  it("switches custom provider setup away from the Ollama base URL default", () => {
    useStore.setState({
      dashboard: [],
      dashboardLoading: false,
      onboardingDismissed: true,
      runtimeStatus: "degraded",
      runtimeFallbackLikely: true,
      runtimeEnvironmentMode: "development",
      apiBaseDisplay: "/api",
      runtimeHealthSummary: "AI provider is not configured.",
      runtimeMessage: "AI provider is not configured.",
      sessionLifecycle: "signed_in",
      authMode: "dev_header",
      authMessage: "Signed in as Operator.",
      currentActor: { actorId: "operator", displayName: "Operator", role: "operator" },
      providerStatus: {
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      },
      providerConfigSaving: false,
      providerConfigMessage: "",
      fetchGraphs: async () => undefined,
      loadProviderStatus: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
      clearRuntimeProviderConfig: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
    });

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<DashboardView />);
    });

    const providerSelect = renderer!.root
      .findAllByType("select")
      .find((node) => node.props.value === "ollama");
    expect(providerSelect).toBeTruthy();

    act(() => {
      providerSelect!.props.onChange({ target: { value: "openai-compatible" } });
    });

    const baseUrlInput = renderer!.root.findByProps({ "aria-label": "OpenAI-compatible base URL" });
    const markup = JSON.stringify(renderer!.toJSON());
    expect(baseUrlInput.props.value).toBe("");
    expect(baseUrlInput.props.placeholder).toBe("https://api.example.com/v1");
    expect(markup).toContain("Custom endpoints may omit an API key, but require a model and base URL.");
    expect(markup).toContain("Remote endpoints must use https; http is only for localhost, 127.x.x.x, or loopback addresses.");
    expect(markup).not.toContain("\"value\":\"http://localhost:11434/v1\"");
  });

  it("shows disabled provider save actions as visually disabled", () => {
    useStore.setState({
      dashboard: [],
      dashboardLoading: false,
      onboardingDismissed: true,
      runtimeStatus: "connected",
      runtimeFallbackLikely: false,
      runtimeEnvironmentMode: "development",
      apiBaseDisplay: "/api",
      runtimeHealthSummary: "Gemini provider is configured (gemini-3.5-flash).",
      runtimeMessage: "Gemini provider is configured (gemini-3.5-flash).",
      sessionLifecycle: "signed_in",
      authMode: "dev_header",
      authMessage: "Signed in as Operator.",
      currentActor: { actorId: "operator", displayName: "Operator", role: "operator" },
      providerStatus: {
        configured: true,
        provider: "gemini",
        source: "environment",
        model: "gemini-3.5-flash",
        message: "Gemini provider is configured (gemini-3.5-flash).",
      },
      providerConfigSaving: false,
      providerConfigMessage: "",
      fetchGraphs: async () => undefined,
      loadProviderStatus: async () => ({
        configured: true,
        provider: "gemini",
        source: "environment",
        model: "gemini-3.5-flash",
        message: "Gemini provider is configured (gemini-3.5-flash).",
      }),
      clearRuntimeProviderConfig: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
    });

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<DashboardView />);
    });

    const saveButton = renderer!.root
      .findAllByType("button")
      .find((node) => node.children.join("") === "Save Gemini");

    expect(saveButton).toBeTruthy();
    expect(saveButton!.props.disabled).toBe(true);
    expect(saveButton!.props.style.background).toBe("#1f2937");
    expect(saveButton!.props.style.color).toBe("#64748b");
  });

  it("shows a clear action only for runtime provider keys", () => {
    useStore.setState({
      dashboard: [],
      dashboardLoading: false,
      onboardingDismissed: true,
      runtimeStatus: "connected",
      runtimeFallbackLikely: false,
      runtimeEnvironmentMode: "development",
      apiBaseDisplay: "/api",
      runtimeHealthSummary: "OpenAI provider is configured for this backend process (gpt-4o).",
      runtimeMessage: "OpenAI provider is configured for this backend process (gpt-4o).",
      sessionLifecycle: "signed_in",
      authMode: "dev_header",
      authMessage: "Signed in as Operator.",
      currentActor: { actorId: "operator", displayName: "Operator", role: "operator" },
      providerStatus: {
        configured: true,
        provider: "openai",
        source: "runtime",
        model: "gpt-4o",
        message: "OpenAI provider is configured for this backend process (gpt-4o).",
      },
      providerConfigSaving: false,
      providerConfigMessage: "",
      fetchGraphs: async () => undefined,
      loadProviderStatus: async () => ({
        configured: true,
        provider: "openai",
        source: "runtime",
        model: "gpt-4o",
        message: "OpenAI provider is configured for this backend process (gpt-4o).",
      }),
      clearRuntimeProviderConfig: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
    });

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<DashboardView />);
    });
    const markup = JSON.stringify(renderer!.toJSON());

    expect(markup).toContain("Runtime config");
    expect(markup).toContain("Clear runtime provider");
    expect(markup).not.toContain("sk-test");
  });

  it("does not submit hidden Ollama model or base URL when saving OpenAI setup", async () => {
    const configureProvider = vi.fn(async () => ({
      configured: true,
      provider: "openai" as const,
      source: "runtime" as const,
      model: "gpt-4o",
      message: "OpenAI provider is configured for this backend process (gpt-4o).",
    }));
    useStore.setState({
      dashboard: [],
      dashboardLoading: false,
      onboardingDismissed: true,
      runtimeStatus: "degraded",
      runtimeFallbackLikely: true,
      runtimeEnvironmentMode: "development",
      apiBaseDisplay: "/api",
      runtimeHealthSummary: "AI provider is not configured.",
      runtimeMessage: "AI provider is not configured.",
      sessionLifecycle: "signed_in",
      authMode: "dev_header",
      authMessage: "Signed in as Operator.",
      currentActor: { actorId: "operator", displayName: "Operator", role: "operator" },
      providerStatus: {
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      },
      providerConfigSaving: false,
      providerConfigMessage: "",
      fetchGraphs: async () => undefined,
      loadProviderStatus: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
      configureProvider,
      clearRuntimeProviderConfig: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
    });

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<DashboardView />);
    });

    const root = renderer!.root;
    const providerSelect = root.findByType("select");
    const modelInput = root.findByProps({ "aria-label": "Ollama model" });
    await act(async () => {
      modelInput.props.onChange({ target: { value: "codellama:latest" } });
    });
    await act(async () => {
      providerSelect.props.onChange({ target: { value: "openai" } });
    });
    const apiKeyInput = root.findByProps({ "aria-label": "OpenAI API key" });
    await act(async () => {
      apiKeyInput.props.onChange({ target: { value: "sk-test_runtime_provider_key_123456789" } });
    });
    const form = root.findByType("form");
    await act(async () => {
      form.props.onSubmit({ preventDefault: () => undefined });
    });

    expect(configureProvider).toHaveBeenCalledWith({
      provider: "openai",
      apiKey: "sk-test_runtime_provider_key_123456789",
      model: "gpt-4o",
    });
  });

  it("renders the agent coordination card with role-gated proposals", () => {
    useStore.setState({
      dashboard: [
        {
          graphId: "graph-1",
          goalTitle: "Build Agent coordination",
          lifecycleBucket: "active",
          graphStatus: "running",
          runControlState: "running",
          frontierStatus: "on_track",
          needsHumanReview: false,
          approvalState: "not_requested",
          waitingForApproval: false,
          alertCount: 0,
          completedNodeCount: 0,
          plannedNodeCount: 1,
          passRate: 0,
          revisionRate: 0,
          evidenceCoverageRate: 0,
          lastEventAt: "2026-06-04T00:00:00.000Z",
          lastEventSequence: 1,
          attentionScore: 40,
          attentionLabel: "medium",
        },
      ],
      dashboardSummary: {
        urgentRunCount: 0,
        needsReviewCount: 0,
        blockedRunCount: 0,
        activeRunCount: 1,
        archivedRunCount: 0,
      },
      dashboardLoading: false,
      dashboardQuery: "",
      dashboardLifecycle: "all",
      dashboardAttention: "all",
      dashboardStatus: "all",
      dashboardFilter: "all",
      dashboardSort: "highest_attention",
      onboardingDismissed: true,
      runtimeStatus: "connected",
      runtimeFallbackLikely: false,
      runtimeEnvironmentMode: "development",
      apiBaseDisplay: "/api",
      runtimeHealthSummary: "Backend connected.",
      runtimeMessage: "",
      sessionLifecycle: "signed_in",
      authMode: "dev_header",
      authMessage: "Signed in as Operator.",
      currentActor: { actorId: "operator", displayName: "Operator", role: "operator" },
      providerStatus: {
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      },
      providerConfigSaving: false,
      providerConfigMessage: "",
      productGraphHandoff: null,
      productGraphHandoffLoading: false,
      productGraphHandoffError: "",
      agentFrontierGraphId: "graph-1",
      agentFrontierSummary: {
        runControlState: "running",
        frontierStatus: "on_track",
        readyCount: 1,
        runningCount: 0,
        blockedCount: 0,
        openProposalCount: 1,
      },
      agentFrontier: [
        {
          nodeId: "node-1",
          title: "Ship agent coordination OPENAI_API_KEY=sk_1234567890abcdef",
          kind: "work",
          status: "ready",
          humanSummary: "External agents can start from C:\\Users\\yashm\\secret.txt.",
          dependsOnNodeIds: [],
          updatedAt: "2026-06-04T00:00:00.000Z",
        },
      ],
      agentActivity: [
        {
          id: "activity-1",
          graphId: "graph-1",
          kind: "progress",
          summary: "Codex reported progress with Bearer abc.def.ghi from C:\\Users\\yashm\\.env.",
          createdAt: "2026-06-04T00:01:00.000Z",
        },
      ],
      agentPlanProposals: [
        {
          proposalId: "proposal-1",
          graphId: "graph-1",
          createdAt: "2026-06-04T00:02:00.000Z",
          agent: { agentId: "gemini", displayName: "Gemini", kind: "gemini" },
          title: "Add agent tests OPENAI_API_KEY=sk_1234567890abcdef",
          summary: "Add focused coordination tests from C:\\Users\\yashm\\secret.txt with Bearer abc.def.ghi.",
          nodes: [{ title: "Write tests", intent: "Cover agent coordination endpoints." }],
        },
      ],
      agentContext: null,
      agentCollaborationLoading: false,
      agentCollaborationError: "",
      agentCollaborationMessage: "",
      fetchGraphs: async () => undefined,
      loadProductGraphHandoff: async () => useStore.getState().productGraphHandoff!,
      loadProviderStatus: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
      loadAgentFrontier: async () => ({
        graphId: "graph-1",
        generatedAt: "2026-06-04T00:00:00.000Z",
        summary: useStore.getState().agentFrontierSummary!,
        frontier: useStore.getState().agentFrontier,
        recentAgentActivity: useStore.getState().agentActivity,
        planProposals: useStore.getState().agentPlanProposals,
      }),
      dismissAgentPlanProposal: async () => undefined,
    });

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<DashboardView />);
    });

    const markup = JSON.stringify(renderer!.toJSON());
    expect(markup).toContain("Agent coordination");
    expect(markup).toContain("Agent-ready work");
    expect(markup).toContain("Ship agent coordination");
    expect(markup).toContain("Codex reported progress");
    expect(markup).toContain("Add agent tests");
    expect(markup).toContain("<redacted-secret>");
    expect(markup).toContain("Bearer <redacted-token>");
    expect(markup).not.toContain("sk_1234567890abcdef");
    expect(markup).not.toContain("abc.def.ghi");
    expect(markup).not.toContain("C:");
    expect(markup).not.toContain("yashm");
    expect(markup).toContain("Dismiss reason");
    expect(markup).toContain("Accept proposal");
    expect(markup).toContain("Dismiss");

    const operatorAcceptButton = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.children === "Accept proposal");
    expect(operatorAcceptButton?.props.disabled).toBe(false);

    act(() => {
      useStore.setState({
        currentActor: { actorId: "viewer", displayName: "Viewer", role: "viewer" },
      });
    });

    const viewerAcceptButton = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.children === "Accept proposal");
    const viewerDismissButton = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.children === "Dismiss");
    const viewerDismissReason = renderer!.root
      .findAllByType("input")
      .find((input) => String(input.props["aria-label"] ?? "").startsWith("Dismiss reason"));
    expect(viewerAcceptButton?.props.disabled).toBe(true);
    expect(viewerDismissButton?.props.disabled).toBe(true);
    expect(viewerDismissReason?.props.disabled).toBe(true);
  });

  it("renders agent coordination empty and error states", () => {
    useStore.setState({
      dashboard: [
        {
          graphId: "graph-1",
          goalTitle: "Build Agent coordination",
          lifecycleBucket: "active",
          graphStatus: "running",
          runControlState: "running",
          frontierStatus: "on_track",
          needsHumanReview: false,
          approvalState: "not_requested",
          waitingForApproval: false,
          alertCount: 0,
          completedNodeCount: 0,
          plannedNodeCount: 0,
          passRate: 0,
          revisionRate: 0,
          evidenceCoverageRate: 0,
          lastEventAt: "2026-06-04T00:00:00.000Z",
          lastEventSequence: 1,
          attentionScore: 10,
          attentionLabel: "low",
        },
      ],
      dashboardSummary: {
        urgentRunCount: 0,
        needsReviewCount: 0,
        blockedRunCount: 0,
        activeRunCount: 1,
        archivedRunCount: 0,
      },
      dashboardLoading: false,
      dashboardQuery: "",
      dashboardLifecycle: "all",
      dashboardAttention: "all",
      dashboardStatus: "all",
      dashboardFilter: "all",
      dashboardSort: "highest_attention",
      onboardingDismissed: true,
      runtimeStatus: "connected",
      runtimeFallbackLikely: false,
      runtimeEnvironmentMode: "development",
      apiBaseDisplay: "/api",
      runtimeHealthSummary: "Backend connected.",
      runtimeMessage: "",
      sessionLifecycle: "signed_in",
      authMode: "dev_header",
      authMessage: "Signed in as Operator.",
      currentActor: { actorId: "operator", displayName: "Operator", role: "operator" },
      providerStatus: {
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      },
      providerConfigSaving: false,
      providerConfigMessage: "",
      productGraphHandoff: null,
      productGraphHandoffLoading: false,
      productGraphHandoffError: "",
      agentFrontierGraphId: "graph-1",
      agentFrontierSummary: null,
      agentFrontier: [],
      agentActivity: [],
      agentPlanProposals: [],
      agentContext: null,
      agentCollaborationLoading: false,
      agentCollaborationError: "Agent frontier could not be loaded.",
      agentCollaborationMessage: "",
      fetchGraphs: async () => undefined,
      loadProductGraphHandoff: async () => useStore.getState().productGraphHandoff!,
      loadProviderStatus: async () => ({
        configured: false,
        provider: "unset",
        source: "unset",
        message: "AI provider is not configured.",
      }),
      loadAgentFrontier: async () => {
        throw new Error("Agent frontier could not be loaded.");
      },
    });

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<DashboardView />);
    });

    const markup = JSON.stringify(renderer!.toJSON());
    expect(markup).toContain("Agent coordination");
    expect(markup).toContain("No run frontier is loaded yet.");
    expect(markup).toContain("Agent frontier could not be loaded.");
    expect(markup).not.toContain("Open proposals");
    expect(markup).not.toContain("Recent agent activity");
  });
});
