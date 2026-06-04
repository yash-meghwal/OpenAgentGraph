import { useEffect, useMemo, useRef, useState } from "react";
import { buildPlainEnglishRunReport, type RunControlState } from "@openagentgraph/shared";
import { useStore } from "../lib/store.js";
import { ActivityPanel } from "./ActivityPanel.js";
import { getPermissionNotice } from "../lib/permissions.js";
import { requestProductGraphLoad } from "../lib/productGraphLoad.js";
import { apiUrl } from "../lib/runtime.js";
import { runtimeShell } from "../lib/shell.js";
import {
  formatFrontierStatusLabel,
  formatRuntimeStatusLabel,
  formatSessionLifecycleLabel,
  getRuntimeBannerTone,
} from "../lib/productCopy.js";
import { deriveGraphRuntime } from "../lib/graphRuntime.js";
import {
  getActiveNode,
  getJustFinishedNode,
  getNextNode,
  getNodeDisplaySummary,
  getNodeStatusCopy,
} from "../lib/viewMode.js";

const CONTROL_STYLE: React.CSSProperties = {
  background: "#2d3748",
  color: "#e2e8f0",
  border: "1px solid #4a5568",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 11,
};

const NOTICE_ACTION_STYLE: React.CSSProperties = {
  ...CONTROL_STYLE,
  background: "#3d2f12",
  borderColor: "#9c6b1b",
  color: "#fbd38d",
  cursor: "pointer",
};

const RUN_WORKSPACE_ROOT_STORAGE_KEY = "openagentgraph:run-workspace-root";
const MAX_STORED_WORKSPACE_ROOT_LENGTH = 1024;
export const AI_PROVIDER_SETUP_GUIDE_PATH = "docs/AI-PROVIDER-SETUP.md";

export const TOOLBAR_LAYOUT_CSS = `
.app-toolbar {
  grid-template-columns: auto auto minmax(0, 1fr) auto;
}

.toolbar-primary,
.toolbar-actions,
.toolbar-trailing,
.toolbar-segment {
  min-width: 0;
}

.toolbar-primary,
.toolbar-actions,
.toolbar-trailing {
  flex-wrap: wrap;
}

.toolbar-status {
  min-width: 0;
}

.toolbar-status span {
  white-space: nowrap;
}

@media (max-width: 900px) {
  .app-toolbar {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .toolbar-primary,
  .toolbar-actions,
  .toolbar-trailing {
    width: 100%;
  }

  .toolbar-trailing {
    justify-content: flex-start;
  }
}

@media (max-width: 520px) {
  .app-toolbar {
    padding: 10px 12px;
  }

  .toolbar-segment {
    width: 100%;
    flex-wrap: wrap;
  }

  .toolbar-segment button {
    flex: 1 1 120px;
  }

  .toolbar-actions select,
  .toolbar-primary select {
    max-width: 100%;
  }

  .toolbar-trailing button {
    flex: 1 1 150px;
  }
}
`;

type ToolbarProductGraph = ReturnType<typeof useStore.getState>["productGraph"];
type WorkspaceRootStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ClipboardWriter = { writeText: (value: string) => Promise<void> };
type RuntimeStatus = ReturnType<typeof useStore.getState>["runtimeStatus"];
type BackendReadyStatus = ReturnType<typeof useStore.getState>["backendReadyStatus"];
type ProviderRefreshNoticeTone = "success" | "warning";
export interface ProviderRefreshNotice {
  message: string;
  tone: ProviderRefreshNoticeTone;
}

function getWorkspaceRootStorage(storage?: WorkspaceRootStorage): WorkspaceRootStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function normalizeRunWorkspaceRoot(value: string): string {
  return value.trim();
}

function normalizeStoredWorkspaceRoot(value: string): string {
  return normalizeRunWorkspaceRoot(value).slice(0, MAX_STORED_WORKSPACE_ROOT_LENGTH);
}

export function readStoredWorkspaceRoot(storage?: WorkspaceRootStorage): string {
  const target = getWorkspaceRootStorage(storage);
  if (!target) return "";
  try {
    return normalizeStoredWorkspaceRoot(target.getItem(RUN_WORKSPACE_ROOT_STORAGE_KEY) ?? "");
  } catch {
    return "";
  }
}

export function writeStoredWorkspaceRoot(workspaceRoot: string, storage?: WorkspaceRootStorage) {
  const target = getWorkspaceRootStorage(storage);
  if (!target) return;
  try {
    const normalized = normalizeStoredWorkspaceRoot(workspaceRoot);
    if (normalized) {
      target.setItem(RUN_WORKSPACE_ROOT_STORAGE_KEY, normalized);
      return;
    }
    target.removeItem(RUN_WORKSPACE_ROOT_STORAGE_KEY);
  } catch {
    // Storage can be unavailable or quota-limited; run controls should still work.
  }
}

export async function copyAiProviderSetupGuidePath(clipboard?: ClipboardWriter): Promise<boolean> {
  const target = clipboard ?? (typeof navigator === "undefined" ? undefined : navigator.clipboard);
  if (!target) return false;
  try {
    await target.writeText(AI_PROVIDER_SETUP_GUIDE_PATH);
    return true;
  } catch {
    return false;
  }
}

export function isProductGraphPreviewProjection(productGraph: ToolbarProductGraph): boolean {
  return productGraph?.productGraphId.startsWith("preview:") ?? false;
}

export function getProductGraphRefreshActionState(
  productGraph: ToolbarProductGraph,
  productGraphLoading: boolean
) {
  const isProductGraphPreview = isProductGraphPreviewProjection(productGraph);

  return {
    disabled: productGraphLoading || isProductGraphPreview,
    label: isProductGraphPreview ? "Preview mode" : productGraphLoading ? "Loading..." : "Refresh intent graph",
    title: isProductGraphPreview ? "Preview mode uses seeded local data." : undefined,
  };
}

export function shouldRequestProductGraphOnIntentNav(productGraph: ToolbarProductGraph): boolean {
  return !isProductGraphPreviewProjection(productGraph);
}

interface GoalRunReadinessInput {
  activeGraphId: string | null;
  workspaceRoot: string;
  isRunning: boolean;
  runControlState: RunControlState;
  providerExecutionBlocked: boolean;
}

export function getGoalRunReadinessState(input: GoalRunReadinessInput) {
  const workspaceMissing = !input.workspaceRoot.trim();
  const providerBlocked = input.providerExecutionBlocked;
  const alreadyRunning = input.isRunning || input.runControlState === "running";
  const paused = input.runControlState === "paused";
  let message = "";

  if (!input.activeGraphId) {
    message = "";
  } else if (alreadyRunning) {
    message = "Goal execution is already running.";
  } else if (paused) {
    message = "Resume this paused run instead of starting a new one.";
  } else if (workspaceMissing && providerBlocked) {
    message = "Add a workspace path and configure the AI provider before running this goal.";
  } else if (workspaceMissing) {
    message = "Add a workspace path before running this goal.";
  } else if (providerBlocked) {
    message = "Configure the AI provider before running this goal.";
  }

  return {
    disabled: Boolean(alreadyRunning || paused || workspaceMissing || providerBlocked),
    message,
    providerBlocked,
    workspaceMissing,
  };
}

export function getProviderRefreshReadinessNotice({
  runtimeFallbackLikely,
  backendReadyStatus,
  runtimeStatus,
  workspaceRoot,
}: {
  runtimeFallbackLikely: boolean;
  backendReadyStatus: BackendReadyStatus;
  runtimeStatus: RuntimeStatus;
  workspaceRoot: string;
}): ProviderRefreshNotice {
  if (backendReadyStatus === "error" || runtimeStatus === "unreachable") {
    return {
      tone: "warning",
      message: "Provider status could not be refreshed. Check the backend and try again.",
    };
  }

  if (runtimeFallbackLikely) {
    return {
      tone: "warning",
      message: "AI provider is still not configured. Follow the setup steps and refresh again.",
    };
  }

  if (runtimeStatus === "auth_required" || runtimeStatus === "read_only") {
    return {
      tone: "warning",
      message: workspaceRoot.trim()
        ? "AI provider is configured. Sign in before running this goal."
        : "AI provider is configured. Sign in and add a workspace path before running this goal.",
    };
  }

  return {
    tone: "success",
    message: workspaceRoot.trim()
      ? "AI provider is configured. Run is ready."
      : "AI provider is configured. Add a workspace path to run this goal.",
  };
}

export function GoalRunReadinessNotice({
  message,
  isRunning,
  workspaceMissing = false,
  providerBlocked = false,
  providerRefreshLoading = false,
  providerRefreshNotice,
  onFocusWorkspace,
  onCopyProviderSetupGuidePath,
  onRefreshProviderReadiness,
}: {
  message: string;
  isRunning: boolean;
  workspaceMissing?: boolean;
  providerBlocked?: boolean;
  providerRefreshLoading?: boolean;
  providerRefreshNotice?: ProviderRefreshNotice | null;
  onFocusWorkspace?: () => void;
  onCopyProviderSetupGuidePath?: () => void;
  onRefreshProviderReadiness?: () => void;
}) {
  if ((!message && !providerRefreshNotice?.message) || isRunning) return null;
  return (
    <div
      style={{
        color: "#fbd38d",
        fontSize: 11,
        lineHeight: 1.35,
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      {message ? <span role="status">{message}</span> : null}
      {workspaceMissing && onFocusWorkspace ? (
        <button type="button" onClick={onFocusWorkspace} style={NOTICE_ACTION_STYLE}>
          Focus workspace path
        </button>
      ) : null}
      {providerBlocked ? (
        <span
          aria-label="Provider setup steps"
          role="group"
          style={{ color: "#f6ad55", display: "inline-flex", gap: 6, flexWrap: "wrap" }}
        >
          <span>Provider setup:</span>
          <span>1. Choose Ollama local with a model, or choose OpenAI and paste an API key.</span>
          <span>2. Environment provider changes require a backend restart; Dashboard changes apply to this running backend process.</span>
          <span>3. Refresh provider status.</span>
          <span>Guide: {AI_PROVIDER_SETUP_GUIDE_PATH}</span>
          {onCopyProviderSetupGuidePath ? (
            <button type="button" onClick={onCopyProviderSetupGuidePath} style={NOTICE_ACTION_STYLE}>
              Copy guide path
            </button>
          ) : null}
        </span>
      ) : null}
      {providerBlocked && onRefreshProviderReadiness ? (
        <button
          type="button"
          onClick={onRefreshProviderReadiness}
          disabled={providerRefreshLoading}
          style={{
            ...NOTICE_ACTION_STYLE,
            cursor: providerRefreshLoading ? "not-allowed" : "pointer",
            opacity: providerRefreshLoading ? 0.7 : 1,
          }}
        >
          {providerRefreshLoading ? "Checking provider..." : "Refresh provider status"}
        </button>
      ) : null}
      {providerRefreshNotice?.message ? (
        <span
          aria-label="Provider refresh result"
          role="status"
          style={{ color: providerRefreshNotice.tone === "success" ? "#9ae6b4" : "#fbd38d" }}
        >
          {providerRefreshNotice.message}
        </span>
      ) : null}
    </div>
  );
}

export function Toolbar() {
  const {
    runtimeEnvironmentMode,
    apiBaseDisplay,
    runtimeStatus,
    runtimeMessage,
    runtimeHealthSummary,
    runtimeFallbackLikely,
    runtimeLoading,
    authMode,
    sessionLifecycle,
    authRequiredForProtectedActions,
    authMessage,
    authToken,
    currentActor,
    availableActors,
    graphs,
    dashboard,
    dashboardSummary,
    goalPackets,
    activeGraphId,
    currentView,
    projectGraph,
    projectGraphLoading,
    projectGraphError,
    productGraph,
    productGraphLoading,
    productGraphError,
    nodes,
    isRunning,
    runControlState,
    canResume,
    canPause,
    canStop,
    capabilities,
    approvalState,
    waitingForApproval,
    latestDecisionSummary,
    needsHumanReview,
    humanReviewReason,
    graphAnnotations,
    latestAnnotationSummary,
    peopleSummary,
    plannedNodeCount,
    completedNodeCount,
    failedNodeCount,
    supersededNodeCount,
    revisedNodeCount,
    passRate,
    revisionRate,
    driftTrend,
    evidenceCoverageRate,
    runHealthSummary,
    alerts,
    latestNotificationSummary,
    changesSinceLastViewed,
    activityOpen,
    setActivityOpen,
    fetchGraphs,
    loadRuntimeHealth,
    loadProjectGraph,
    loadProductGraph,
    createGraph,
    openGraph,
    startRun,
    pauseRun,
    resumeRun,
    stopRun,
    markRunForReview,
    annotateGraph,
    requestApproval,
    approveRun,
    rejectRun,
    continueRun,
    filterStatus,
    filterBranch,
    setFilterStatus,
    setFilterBranch,
    driftSummary,
    frontierStatus,
    uiMode,
    setUiMode,
    graphQuality,
    graphDetailMode,
    largeGraphThreshold,
    setGraphQuality,
    setGraphDetailMode,
    showSupersededNodes,
    setShowSupersededNodes,
    showRevisionBranches,
    setShowRevisionBranches,
    showReplanBranches,
    setShowReplanBranches,
    focusActivePath,
    setFocusActivePath,
    collapseSupersededBranches,
    setCollapseSupersededBranches,
    collapseRevisionClusters,
    setCollapseRevisionClusters,
    showActiveNeighborhoodOnly,
    setShowActiveNeighborhoodOnly,
    resetGraphVisibility,
    setCurrentView,
    setCurrentActorRole,
    setAuthToken,
    clearAuthToken,
  } = useStore();

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [constraints, setConstraints] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState(() => readStoredWorkspaceRoot());
  const [annotationText, setAnnotationText] = useState("");
  const [authTokenInput, setAuthTokenInput] = useState(authToken);
  const [providerRefreshPending, setProviderRefreshPending] = useState(false);
  const [providerRefreshNotice, setProviderRefreshNotice] = useState<ProviderRefreshNotice | null>(null);
  const workspaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAuthTokenInput(authToken);
  }, [authToken]);

  const allBranches = [...new Set(nodes.filter((n) => n.branchId).map((n) => n.branchId!))];
  const allStatuses = ["pending", "ready", "running", "completed", "failed", "superseded", "blocked"];

  const activeNode = useMemo(() => getActiveNode(nodes), [nodes]);
  const justFinishedNode = useMemo(() => getJustFinishedNode(nodes), [nodes]);
  const nextNode = useMemo(() => getNextNode(nodes), [nodes]);
  const activeGraph = useMemo(
    () => graphs.find((graph) => graph.id === activeGraphId) ?? null,
    [graphs, activeGraphId]
  );
  const graphChoices = useMemo(
    () => dashboard.map((item) => ({ id: item.graphId, title: item.goalTitle })),
    [dashboard]
  );

  const plainEnglishReport = useMemo(
    () =>
      activeGraph
        ? buildPlainEnglishRunReport({
            graph: activeGraph,
            nodes,
            frontierStatus: frontierStatus ?? "on_track",
            currentDriftSummary: driftSummary || null,
            runHealthSummary: runHealthSummary || undefined,
            attentionSummary: latestNotificationSummary || "No important updates right now.",
            decisionSummary: latestDecisionSummary || undefined,
            peopleSummary: peopleSummary || "No recent human actions.",
            originalGoalText:
              goalPackets.find((packet) => packet.id === activeGraph.originalGoalVersionId)?.originalText ??
              activeGraph.goal,
          })
        : "",
    [activeGraph, nodes, frontierStatus, driftSummary, goalPackets, runHealthSummary, latestNotificationSummary, latestDecisionSummary, peopleSummary]
  );
  const goalRunReadiness = getGoalRunReadinessState({
    activeGraphId,
    workspaceRoot,
    isRunning,
    runControlState,
    providerExecutionBlocked: runtimeFallbackLikely,
  });

  const handleCreate = async () => {
    if (!title || !goal) return;
    const graph = await createGraph(title, goal, constraints || undefined);
    await fetchGraphs();
    await openGraph(graph.id);
    setShowCreate(false);
    setTitle("");
    setGoal("");
    setConstraints("");
  };

  const handleRun = async () => {
    const normalizedWorkspaceRoot = normalizeRunWorkspaceRoot(workspaceRoot);
    if (!activeGraphId || goalRunReadiness.disabled || !normalizedWorkspaceRoot) return;
    await startRun(activeGraphId, normalizedWorkspaceRoot);
  };

  const handleWorkspaceRootChange = (value: string) => {
    setWorkspaceRoot(value);
    writeStoredWorkspaceRoot(value);
    const current = useStore.getState();
    if (
      providerRefreshNotice &&
      !current.runtimeFallbackLikely &&
      current.backendReadyStatus !== "error" &&
      current.runtimeStatus !== "unreachable"
    ) {
      setProviderRefreshNotice(
        getProviderRefreshReadinessNotice({
          runtimeFallbackLikely: current.runtimeFallbackLikely,
          backendReadyStatus: current.backendReadyStatus,
          runtimeStatus: current.runtimeStatus,
          workspaceRoot: value,
        })
      );
    }
  };

  const handleCopyReport = async () => {
    if (!plainEnglishReport) return;
    await navigator.clipboard.writeText(plainEnglishReport);
  };

  const handleRefreshProviderReadiness = async () => {
    setProviderRefreshPending(true);
    setProviderRefreshNotice(null);
    try {
      await loadRuntimeHealth();
      const refreshed = useStore.getState();
      setProviderRefreshNotice(
        getProviderRefreshReadinessNotice({
          runtimeFallbackLikely: refreshed.runtimeFallbackLikely,
          backendReadyStatus: refreshed.backendReadyStatus,
          runtimeStatus: refreshed.runtimeStatus,
          workspaceRoot,
        })
      );
    } finally {
      setProviderRefreshPending(false);
    }
  };

  const handleCopyProviderSetupGuidePath = async () => {
    await copyAiProviderSetupGuidePath();
  };

  const handlePause = async () => {
    if (!activeGraphId) return;
    await pauseRun(activeGraphId);
  };

  const handleResume = async () => {
    if (!activeGraphId) return;
    await resumeRun(activeGraphId);
  };

  const handleStop = async () => {
    if (!activeGraphId) return;
    await stopRun(activeGraphId);
  };

  const handleReview = async () => {
    if (!activeGraphId) return;
    await markRunForReview(activeGraphId);
  };

  const handleGraphAnnotation = async () => {
    if (!activeGraphId || !annotationText.trim()) return;
    await annotateGraph(activeGraphId, {
      text: annotationText.trim(),
      kind: "note",
    });
    setAnnotationText("");
  };

  const handleDownloadJson = async () => {
    if (!activeGraphId) return;
    const headers = new Headers();
    if (authMode === "dev_header") {
      headers.set("x-openagentgraph-actor-id", currentActor.actorId);
    } else if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }
    const res = await fetch(apiUrl(`/graphs/${activeGraphId}/report`), { headers });
    if (!res.ok) throw new Error(`Failed to fetch report: ${res.status}`);
    const report = await res.json();
    await runtimeShell.saveTextFile({
      suggestedName: `${activeGraph?.title ?? activeGraphId}-report.json`,
      content: JSON.stringify(report, null, 2),
      mimeType: "application/json",
    });
  };

  const frontierColor =
    frontierStatus === "drifting"
      ? "#feb2b2"
      : frontierStatus === "exploring"
        ? "#f6e05e"
        : frontierStatus === "blocked"
          ? "#d6bcfa"
          : "#9ae6b4";
  const runtimeTone = getRuntimeBannerTone(runtimeStatus);
  const productGraphRefreshAction = getProductGraphRefreshActionState(productGraph, productGraphLoading);
  const derivedGraphRuntime = useMemo(
    () =>
      deriveGraphRuntime({
        totalNodeCount: nodes.length,
        selectedNodeId: null,
        activeNodeId: activeNode?.id ?? null,
        graphQuality,
        graphDetailMode,
        showSupersededNodes,
        showRevisionBranches,
        showReplanBranches,
      }),
    [
      nodes.length,
      activeNode?.id,
      graphQuality,
      graphDetailMode,
      showSupersededNodes,
      showRevisionBranches,
      showReplanBranches,
    ]
  );
  const toolbarStatusSummary =
    currentView === "dashboard"
      ? runtimeFallbackLikely
        ? "Backend connected. Some AI features are using fallback behavior."
        : runtimeHealthSummary
      : currentView === "intent"
        ? productGraph
          ? `${productGraph.summary.nodeCount} intent nodes, ${productGraph.summary.edgeCount} relationships, ${productGraph.summary.unresolvedOpenQuestionCount} open questions.`
          : productGraphLoading
            ? "Loading intent graph..."
            : productGraphError || "Intent graph is ready to load."
      : currentView === "project"
        ? projectGraph
          ? `${projectGraph.summary.fileCount} files, ${projectGraph.summary.importEdgeCount} imports, ${projectGraph.summary.testEdgeCount} test links.`
          : projectGraphLoading
            ? "Building project graph..."
            : projectGraphError || "Project graph is ready to load."
      : runtimeStatus === "connected"
        ? runHealthSummary || "Run details are ready."
        : runtimeMessage || runtimeHealthSummary;

  return (
    <>
    <style>{TOOLBAR_LAYOUT_CSS}</style>
    <div
      className="app-toolbar"
      style={{
        background: "#1a202c",
        borderBottom: "1px solid #2d3748",
        padding: "12px 16px",
        display: "grid",
        gap: 12,
        alignItems: "center",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <div className="toolbar-primary" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 800, fontSize: 16, color: "#90cdf4", letterSpacing: "-0.02em" }}>
          OpenAgentGraph
        </span>
        {authMode === "dev_header" ? (
          <select
            value={currentActor.role}
            onChange={(event) => setCurrentActorRole(event.target.value as typeof currentActor.role)}
            style={{ ...CONTROL_STYLE, background: "#0f1117" }}
            title="Current role"
          >
            {availableActors.map((actor) => (
              <option key={actor.actorId} value={actor.role}>
                {actor.displayName}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ ...CONTROL_STYLE, background: "#0f1117", borderColor: runtimeTone.border }}>
            {sessionLifecycle === "signed_in"
              ? `${currentActor.displayName} (${currentActor.role})`
              : formatSessionLifecycleLabel(sessionLifecycle)}
          </span>
        )}
        <div
          className="toolbar-segment"
          style={{
            border: "1px solid #2d3748",
            background: "#0f1117",
            borderRadius: 8,
            padding: 3,
            display: "flex",
            gap: 4,
          }}
        >
          {([
            { id: "dashboard", label: "Dashboard" },
            { id: "intent", label: "Intent graph" },
            { id: "project", label: "Project graph" },
            { id: "graph", label: "Current run" },
          ] as const).map((view) => (
            <button
              key={view.id}
              onClick={() => {
                if (view.id === "graph" && !activeGraphId) return;
                if (view.id === "dashboard") {
                  void fetchGraphs();
                }
                if (view.id === "intent" && shouldRequestProductGraphOnIntentNav(productGraph)) {
                  requestProductGraphLoad(loadProductGraph);
                }
                if (view.id === "project") {
                  void loadProjectGraph();
                }
                setCurrentView(view.id);
              }}
              disabled={view.id === "graph" && !activeGraphId}
              style={{
                background: currentView === view.id ? "#2b6cb0" : "transparent",
                color: currentView === view.id ? "#fff" : "#a0aec0",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: view.id === "graph" && !activeGraphId ? "not-allowed" : "pointer",
                opacity: view.id === "graph" && !activeGraphId ? 0.5 : 1,
              }}
            >
              {view.label}
            </button>
          ))}
        </div>
        <div
          className="toolbar-segment"
          style={{
            border: "1px solid #2d3748",
            background: "#0f1117",
            borderRadius: 8,
            padding: 3,
            display: "flex",
            gap: 4,
          }}
        >
          {(["default", "developer"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setUiMode(mode)}
              style={{
                background: uiMode === mode ? "#2b6cb0" : "transparent",
                color: uiMode === mode ? "#fff" : "#a0aec0",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {mode === "default" ? "Default mode" : "Developer mode"}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {graphChoices.length > 0 && (
          <select
            value={activeGraphId ?? ""}
            onChange={async (event) => {
              if (!event.target.value) return;
              await openGraph(event.target.value);
            }}
            style={CONTROL_STYLE}
          >
            {!activeGraphId ? <option value="">Select a run…</option> : null}
            {graphChoices.map((graph) => (
              <option key={graph.id} value={graph.id}>
                {graph.title}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{
            background: "#2b6cb0",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          + New Graph
        </button>
      </div>

      <div className="toolbar-status" style={{ display: "grid", gap: 4 }}>
        {currentView === "dashboard" ? (
          <div style={{ display: "flex", gap: 16, color: "#a0aec0", fontSize: 12, flexWrap: "wrap" }}>
            <span>{dashboardSummary.urgentRunCount} urgent runs</span>
            <span>{dashboardSummary.needsReviewCount} need review</span>
            <span>{dashboardSummary.blockedRunCount} blocked</span>
            <span>{dashboardSummary.activeRunCount} active</span>
          </div>
        ) : currentView === "intent" ? (
          <div style={{ display: "flex", gap: 16, color: "#a0aec0", fontSize: 12, flexWrap: "wrap" }}>
            <span>{productGraph?.summary.nodeCount ?? 0} intent nodes</span>
            <span>{productGraph?.summary.edgeCount ?? 0} relationships</span>
            <span>{productGraph?.summary.unresolvedOpenQuestionCount ?? 0} open questions</span>
            <span>{productGraph?.summary.blockedTaskCount ?? 0} blocked tasks</span>
          </div>
        ) : currentView === "project" ? (
          <div style={{ display: "flex", gap: 16, color: "#a0aec0", fontSize: 12, flexWrap: "wrap" }}>
            <span>{projectGraph?.summary.fileCount ?? 0} files</span>
            <span>{projectGraph?.summary.directoryCount ?? 0} directories</span>
            <span>{projectGraph?.summary.importEdgeCount ?? 0} import links</span>
            <span>{projectGraph?.summary.testEdgeCount ?? 0} test links</span>
          </div>
        ) : driftSummary && (
          <div style={{ color: frontierColor, fontSize: 12, lineHeight: 1.35, fontWeight: 600 }}>
            {driftSummary}
          </div>
        )}
        <div style={{ display: "flex", gap: 16, color: "#a0aec0", fontSize: 11, flexWrap: "wrap" }}>
          {currentView === "dashboard" ? (
            <>
              <span>Overview: multi-run supervision from replayed projections</span>
              <span>Open a run to inspect the graph, evidence, and replay.</span>
              <span>Environment: {runtimeEnvironmentMode}</span>
              <span>API: {apiBaseDisplay}</span>
              <span>Runtime: {formatRuntimeStatusLabel(runtimeStatus)}</span>
              <span>{toolbarStatusSummary}</span>
              <span>
                {authMode === "jwt"
                  ? sessionLifecycle === "signed_in"
                    ? `Signed in as ${currentActor.displayName}`
                    : formatSessionLifecycleLabel(sessionLifecycle)
                  : `Local actor mode: ${currentActor.displayName}`}
              </span>
            </>
          ) : currentView === "intent" ? (
            <>
              <span>Product graph: {productGraph?.productGraphId ?? "default"}</span>
              <span>Environment: {runtimeEnvironmentMode}</span>
              <span>API: {apiBaseDisplay}</span>
              <span>Runtime: {formatRuntimeStatusLabel(runtimeStatus)}</span>
              <span>{toolbarStatusSummary}</span>
              <span>
                {productGraphLoading
                  ? "Loading product intent..."
                  : productGraphError
                    ? productGraphError
                    : `${productGraph?.summary.unresolvedOpenQuestionCount ?? 0} open questions, ${productGraph?.summary.blockedTaskCount ?? 0} blocked tasks.`}
              </span>
            </>
          ) : currentView === "project" ? (
            <>
              <span>Workspace: {projectGraph?.root ?? "local OpenAgentGraph project"}</span>
              <span>Environment: {runtimeEnvironmentMode}</span>
              <span>API: {apiBaseDisplay}</span>
              <span>Runtime: {formatRuntimeStatusLabel(runtimeStatus)}</span>
              <span>{toolbarStatusSummary}</span>
              <span>
                {projectGraphLoading
                  ? "Scanning files and imports..."
                  : projectGraphError
                    ? projectGraphError
                    : "Click any node to inspect where it lives in the codebase."}
              </span>
            </>
          ) : (
            <>
              <span>Run: {uiMode === "developer" ? runControlState : runControlState === "paused" ? "Paused" : runControlState === "stopped" ? "Stopped" : runControlState === "running" ? "Running" : "Idle"}</span>
              <span>Frontier: {formatFrontierStatusLabel(frontierStatus)}</span>
              <span>Environment: {runtimeEnvironmentMode}</span>
              <span>API: {apiBaseDisplay}</span>
              <span>Runtime: {formatRuntimeStatusLabel(runtimeStatus)}</span>
              <span>{toolbarStatusSummary}</span>
              <span>
                Now:
                {" "}
                {activeNode ? getNodeDisplaySummary(activeNode) : "No active step"}
              </span>
              <span>
                Just finished:
                {" "}
                {justFinishedNode ? getNodeDisplaySummary(justFinishedNode) : "Nothing completed yet"}
              </span>
              <span>
                Next:
                {" "}
                {nextNode ? `${nextNode.title} (${getNodeStatusCopy(nextNode)})` : "No pending step"}
              </span>
              <span>{runHealthSummary || `${completedNodeCount} of ${plannedNodeCount} steps completed.`}</span>
            </>
          )}
        </div>
        {currentView === "graph" && uiMode === "default" && plainEnglishReport ? (
          <div style={{ color: "#718096", fontSize: 11, lineHeight: 1.35 }}>
            {plainEnglishReport.split("\n").slice(0, 4).join(" ")}
          </div>
        ) : null}
        {currentView === "graph" && uiMode === "developer" ? (
          <div style={{ color: "#718096", fontSize: 11, lineHeight: 1.35, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>Completed: {completedNodeCount}/{plannedNodeCount}</span>
            <span>Failed: {failedNodeCount}</span>
            <span>Superseded: {supersededNodeCount}</span>
            <span>Revisions: {revisedNodeCount}</span>
            <span>Pass rate: {(passRate * 100).toFixed(0)}%</span>
            <span>Revision rate: {(revisionRate * 100).toFixed(0)}%</span>
            <span>Evidence: {(evidenceCoverageRate * 100).toFixed(0)}%</span>
            <span>Drift trend: {driftTrend}</span>
          </div>
        ) : null}
        {currentView === "graph" && needsHumanReview ? (
          <div
            style={{
              color: "#fbd38d",
              background: "rgba(116, 66, 16, 0.24)",
              border: "1px solid rgba(221, 107, 32, 0.45)",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
              lineHeight: 1.35,
            }}
          >
            {humanReviewReason || "This run may need a human decision before it continues."}
          </div>
        ) : null}
        {currentView === "graph" && (waitingForApproval || latestDecisionSummary) ? (
          <div
            style={{
              color: "#f6e05e",
              background: "rgba(116, 89, 12, 0.24)",
              border: "1px solid rgba(214, 158, 46, 0.45)",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
              lineHeight: 1.35,
            }}
          >
            {latestDecisionSummary || "This run is waiting for approval before continuing."}
          </div>
        ) : null}
        {currentView === "graph" && latestAnnotationSummary ? (
          <div style={{ color: "#81e6d9", fontSize: 11, lineHeight: 1.35 }}>
            {latestAnnotationSummary}
          </div>
        ) : null}
        {authMessage ? (
          <div
            style={{
              color:
                sessionLifecycle === "invalid_session" || sessionLifecycle === "expired_session"
                  ? "#f6ad55"
                  : "#718096",
              fontSize: 11,
              lineHeight: 1.35,
            }}
          >
            {authMessage}
          </div>
        ) : null}
        {runtimeMessage && runtimeStatus !== "connected" ? (
          <div style={{ color: runtimeTone.accent, fontSize: 11, lineHeight: 1.35 }}>
            {runtimeMessage}
          </div>
        ) : null}
      </div>

      <div className="toolbar-trailing" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {currentView === "intent" ? (
          <>
            <button
              onClick={() => requestProductGraphLoad(loadProductGraph)}
              disabled={productGraphRefreshAction.disabled}
              title={productGraphRefreshAction.title}
              style={{
                ...CONTROL_STYLE,
                cursor: productGraphRefreshAction.disabled ? "not-allowed" : "pointer",
                opacity: productGraphRefreshAction.disabled ? 0.7 : 1,
              }}
            >
              {productGraphRefreshAction.label}
            </button>
            {productGraph ? (
              <span style={{ color: "#90cdf4", fontSize: 11 }}>
                {productGraph.nodes.length} nodes / {productGraph.edges.length} links
              </span>
            ) : null}
          </>
        ) : null}

        {currentView === "project" ? (
          <>
            <button
              onClick={() => void loadProjectGraph()}
              disabled={projectGraphLoading}
              style={CONTROL_STYLE}
            >
              {projectGraphLoading ? "Scanning..." : "Refresh project graph"}
            </button>
            {projectGraph ? (
              <span style={{ color: "#90cdf4", fontSize: 11 }}>
                {projectGraph.nodes.length} nodes / {projectGraph.edges.length} links
              </span>
            ) : null}
          </>
        ) : null}

        {currentView === "graph" ? (
          <>
            <select
              value={filterStatus ?? ""}
              onChange={(event) => setFilterStatus(event.target.value || null)}
              style={CONTROL_STYLE}
            >
              <option value="">All statuses</option>
              {allStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            {allBranches.length > 0 && (
              <select
                value={filterBranch ?? ""}
                onChange={(event) => setFilterBranch(event.target.value || null)}
                style={CONTROL_STYLE}
              >
                <option value="">All branches</option>
                {allBranches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            )}

            <label style={{ color: "#a0aec0", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={focusActivePath}
                onChange={(event) => setFocusActivePath(event.target.checked)}
              />
              Focus active path
            </label>

            <label style={{ color: "#a0aec0", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={collapseSupersededBranches}
                onChange={(event) => setCollapseSupersededBranches(event.target.checked)}
              />
              Collapse old branches
            </label>

            <label style={{ color: "#a0aec0", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={collapseRevisionClusters}
                onChange={(event) => setCollapseRevisionClusters(event.target.checked)}
              />
              Collapse revision clusters
            </label>

            <label style={{ color: "#a0aec0", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={showActiveNeighborhoodOnly}
                onChange={(event) => setShowActiveNeighborhoodOnly(event.target.checked)}
              />
              Active path + neighbors
            </label>

            {nodes.length >= largeGraphThreshold ? (
              <button
                onClick={() => setGraphDetailMode(graphDetailMode === "auto" ? "full" : "auto")}
                style={CONTROL_STYLE}
              >
                {graphDetailMode === "auto" ? "Show full detail" : "Return to large-graph mode"}
              </button>
            ) : null}

            {uiMode === "developer" ? (
              <>
                <label style={{ color: "#a0aec0", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={showSupersededNodes}
                    onChange={(event) => setShowSupersededNodes(event.target.checked)}
                    disabled={derivedGraphRuntime.largeGraphModeActive}
                  />
                  Superseded
                </label>
                <label style={{ color: "#a0aec0", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={showRevisionBranches}
                    onChange={(event) => setShowRevisionBranches(event.target.checked)}
                    disabled={derivedGraphRuntime.largeGraphModeActive}
                  />
                  Revisions
                </label>
                <label style={{ color: "#a0aec0", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={showReplanBranches}
                    onChange={(event) => setShowReplanBranches(event.target.checked)}
                    disabled={derivedGraphRuntime.largeGraphModeActive}
                  />
                  Replans
                </label>
                <select
                  value={graphQuality}
                  onChange={(event) => setGraphQuality(event.target.value as "standard" | "performance")}
                  style={CONTROL_STYLE}
                >
                  <option value="standard">standard</option>
                  <option value="performance">performance</option>
                </select>
                <button onClick={resetGraphVisibility} style={CONTROL_STYLE}>
                  Reset graph visibility
                </button>
                {derivedGraphRuntime.largeGraphModeActive ? (
                  <span style={{ color: "#90cdf4", fontSize: 11 }}>
                    Large graph mode is hiding older branches until you switch to full detail.
                  </span>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        {currentView === "graph" && activeGraphId ? (
          <>
            <button
              onClick={() => setActivityOpen(!activityOpen)}
              style={{
                background:
                  alerts[0]?.severity === "critical"
                    ? "#742a2a"
                    : changesSinceLastViewed?.newEventCount
                      ? "#2c5282"
                      : "#2d3748",
                color: "#e2e8f0",
                border: "1px solid #4a5568",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {changesSinceLastViewed?.newEventCount
                ? `Updates (${changesSinceLastViewed.newEventCount})`
                : alerts.length > 0
                  ? "Activity"
                  : "Inbox"}
            </button>
            <button
              onClick={handleCopyReport}
              style={{
                background: "#2d3748",
                color: "#e2e8f0",
                border: "1px solid #4a5568",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              Copy report
            </button>
            <button
              onClick={handleDownloadJson}
              style={{
                background: "#2d3748",
                color: "#e2e8f0",
                border: "1px solid #4a5568",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              Download JSON
            </button>
          </>
        ) : null}

        {currentView === "graph" && activeGraphId && (
          <>
            <input
              ref={workspaceInputRef}
              aria-label="Workspace path"
              value={workspaceRoot}
              onChange={(event) => handleWorkspaceRootChange(event.target.value)}
              placeholder="Workspace path..."
              style={{
                ...CONTROL_STYLE,
                background: "#0f1117",
                width: 200,
              }}
            />
            <button
              onClick={handleRun}
              disabled={goalRunReadiness.disabled}
              title={goalRunReadiness.message || undefined}
              style={{
                background: "#276749",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                cursor: goalRunReadiness.disabled ? "not-allowed" : "pointer",
                fontSize: 12,
                fontWeight: 700,
                opacity: goalRunReadiness.disabled ? 0.7 : 1,
              }}
            >
              {isRunning ? "Running…" : "Run"}
            </button>
            <button onClick={handlePause} disabled={!canPause} style={CONTROL_STYLE}>
              {uiMode === "default" ? "Pause run" : "Pause"}
            </button>
            <button onClick={handleResume} disabled={!canResume} style={CONTROL_STYLE}>
              {uiMode === "default" ? "Resume run" : "Resume"}
            </button>
            <button onClick={handleStop} disabled={!canStop} style={CONTROL_STYLE}>
              {uiMode === "default" ? "Stop after this step" : "Stop"}
            </button>
            <button onClick={handleReview} disabled={!capabilities?.canRequestReview} style={CONTROL_STYLE}>
              Mark for review
            </button>
            <button
              onClick={async () => {
                if (!activeGraphId) return;
                await requestApproval(activeGraphId, {
                  reason: latestDecisionSummary || "Human approval requested before the next step.",
                });
              }}
              disabled={!capabilities?.canRequestApproval}
              style={CONTROL_STYLE}
            >
              Request approval
            </button>
            <button
              onClick={async () => {
                if (!activeGraphId) return;
                await approveRun(activeGraphId, {});
              }}
              disabled={!capabilities?.canApprove}
              style={CONTROL_STYLE}
            >
              Approve
            </button>
            <button
              onClick={async () => {
                if (!activeGraphId) return;
                await rejectRun(activeGraphId, {});
              }}
              disabled={!capabilities?.canReject}
              style={CONTROL_STYLE}
            >
              Reject
            </button>
            <button
              onClick={async () => {
                if (!activeGraphId) return;
                await continueRun(activeGraphId, {});
              }}
              disabled={!capabilities?.canContinue}
              style={CONTROL_STYLE}
            >
              Continue
            </button>
            <GoalRunReadinessNotice
              message={goalRunReadiness.message}
              isRunning={isRunning}
              workspaceMissing={goalRunReadiness.workspaceMissing}
              providerBlocked={goalRunReadiness.providerBlocked}
              providerRefreshLoading={runtimeLoading || providerRefreshPending}
              providerRefreshNotice={providerRefreshNotice}
              onFocusWorkspace={() => workspaceInputRef.current?.focus()}
              onCopyProviderSetupGuidePath={() => void handleCopyProviderSetupGuidePath()}
              onRefreshProviderReadiness={() => void handleRefreshProviderReadiness()}
            />
          </>
        )}
      </div>
      {currentView === "graph" && activeGraphId ? (
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            color: "#a0aec0",
            fontSize: 11,
          }}
        >
          <span style={{ ...CONTROL_STYLE, background: "#0f1117" }}>
            {authMode === "jwt"
              ? sessionLifecycle === "signed_in"
                ? `${currentActor.displayName} (${currentActor.role})`
                : formatSessionLifecycleLabel(sessionLifecycle)
              : `${currentActor.displayName} (${currentActor.role})`}
          </span>
          <input
            value={annotationText}
            onChange={(event) => setAnnotationText(event.target.value)}
            placeholder="Add a run note..."
            style={{ ...CONTROL_STYLE, background: "#0f1117", width: 280 }}
          />
          <button onClick={handleGraphAnnotation} disabled={!capabilities?.canAnnotate} style={CONTROL_STYLE}>
            Add note
          </button>
          <span>{graphAnnotations.length} run annotations</span>
          <span>Approval: {approvalState}</span>
          {derivedGraphRuntime.statusMessage ? (
            <span>{derivedGraphRuntime.statusMessage}</span>
          ) : null}
          {nodes.length >= largeGraphThreshold ? (
            <span>
              Threshold: {largeGraphThreshold}+ nodes {graphDetailMode === "auto" ? "(auto)" : "(full detail override)"}
            </span>
          ) : null}
          {getPermissionNotice(currentActor, capabilities) ? (
            <span>{getPermissionNotice(currentActor, capabilities)}</span>
          ) : null}
          {authRequiredForProtectedActions && authMode === "jwt" ? (
            sessionLifecycle === "signed_in" ? (
              <span>Protected actions use your signed-in session.</span>
            ) : sessionLifecycle === "expired_session" ? (
              <span>Your session has expired. Add a new token to continue.</span>
            ) : sessionLifecycle === "invalid_session" ? (
              <span>Your session is not valid for this action. Add a new token to continue.</span>
            ) : (
              <span>This environment allows viewing, but protected actions require sign-in.</span>
            )
          ) : null}
        </div>
      ) : null}
      {authMode === "jwt" ? (
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            color: "#a0aec0",
            fontSize: 11,
          }}
        >
          <input
            value={authTokenInput}
            onChange={(event) => setAuthTokenInput(event.target.value)}
            placeholder="Paste bearer token..."
            style={{ ...CONTROL_STYLE, background: "#0f1117", width: 320 }}
          />
          <button
            onClick={() => void setAuthToken(authTokenInput.trim())}
            style={CONTROL_STYLE}
          >
            {sessionLifecycle === "signed_in" ? "Update token" : "Add token"}
          </button>
          <button
            onClick={() => void clearAuthToken()}
            style={CONTROL_STYLE}
          >
            Sign out
          </button>
          <span>
            {sessionLifecycle === "signed_in"
              ? `Signed in as ${currentActor.displayName}.`
              : sessionLifecycle === "expired_session"
                ? "Your session has expired. Add a new token to continue."
                : sessionLifecycle === "invalid_session"
                  ? "Your session is not valid for this action. Add a new token to continue."
                  : "This environment allows viewing, but protected actions require sign-in."}
          </span>
        </div>
      ) : null}
      <ActivityPanel />

      {showCreate && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#1a202c",
              border: "1px solid #2d3748",
              borderRadius: 12,
              padding: 24,
              width: 480,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <h2 style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700 }}>New Execution Graph</h2>
            {[
              { label: "Title", value: title, onChange: setTitle, placeholder: "e.g. Build auth module" },
              { label: "Goal", value: goal, onChange: setGoal, placeholder: "Describe the task in full..." },
              {
                label: "Constraints (optional)",
                value: constraints,
                onChange: setConstraints,
                placeholder: "e.g. TypeScript only, no external APIs",
              },
            ].map(({ label, value, onChange, placeholder }) => (
              <div key={label}>
                <label
                  style={{
                    color: "#718096",
                    fontSize: 11,
                    fontWeight: 600,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  {label.toUpperCase()}
                </label>
                <textarea
                  value={value}
                  onChange={(event) => onChange(event.target.value)}
                  placeholder={placeholder}
                  rows={label === "Goal" ? 4 : 2}
                  style={{
                    width: "100%",
                    background: "#0f1117",
                    border: "1px solid #2d3748",
                    borderRadius: 6,
                    padding: "8px 10px",
                    color: "#e2e8f0",
                    fontSize: 12,
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowCreate(false)}
                style={{
                  background: "#2d3748",
                  color: "#e2e8f0",
                  border: "none",
                  borderRadius: 6,
                  padding: "7px 16px",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                style={{
                  background: "#2b6cb0",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "7px 16px",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Create Graph
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
