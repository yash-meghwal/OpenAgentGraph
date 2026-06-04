import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Toolbar } from "./components/Toolbar.js";
import { NodeDetailPanel } from "./components/NodeDetailPanel.js";
import { RunTimeline } from "./components/RunTimeline.js";
import { DashboardView } from "./components/DashboardView.js";
import { useStore } from "./lib/store.js";
import { getRuntimeBannerTone } from "./lib/productCopy.js";
import { getProductGraphPreviewProjection, PRODUCT_GRAPH_PREVIEW_MESSAGE } from "./lib/productGraphPreview.js";

const GraphCanvas = lazy(async () => {
  const mod = await import("./components/GraphCanvas.js");
  return { default: mod.GraphCanvas };
});

const ProjectGraphView = lazy(async () => {
  const mod = await import("./components/ProjectGraphView.js");
  return { default: mod.ProjectGraphView };
});

const ProductGraphView = lazy(async () => {
  const mod = await import("./components/ProductGraphView.js");
  return { default: mod.ProductGraphView };
});

function GraphLoadingState() {
  return (
    <div
      style={{
        flex: 1,
        background: "#0f1117",
        color: "#718096",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
      }}
    >
      Loading graph view…
    </div>
  );
}

export function GraphUnavailableState(props: {
  onRetry: () => void;
  uiMode: "default" | "developer";
  message?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        background: "#0f1117",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          background: "#111827",
          border: "1px solid #374151",
          borderRadius: 18,
          padding: 24,
          display: "grid",
          gap: 10,
          boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
        }}
      >
        <div style={{ color: "#90cdf4", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Graph unavailable
        </div>
        <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 800 }}>
          The 3D graph could not be shown right now, but the rest of the run is still available.
        </div>
        <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
          You can still inspect the timeline, run details, activity, and plain-English report while the graph view recovers.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={props.onRetry}
            style={{
              background: "#2b6cb0",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Retry graph
          </button>
          {props.uiMode === "developer" && props.message ? (
            <span style={{ color: "#718096", fontSize: 11, lineHeight: 1.45 }}>{props.message}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

class GraphErrorBoundary extends Component<
  {
    children: ReactNode;
    onError: (error: Error) => void;
  },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onError: (error: Error) => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

function AppBootState() {
  return (
    <div
      style={{
        flex: 1,
        background: "#0f1117",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 18,
          padding: 24,
          display: "grid",
          gap: 10,
          boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
        }}
      >
        <div style={{ color: "#90cdf4", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Starting up
        </div>
        <div style={{ color: "#e2e8f0", fontSize: 20, fontWeight: 800 }}>Preparing OpenAgentGraph</div>
        <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
          Checking backend health, session state, and available runs.
        </div>
      </div>
    </div>
  );
}

type ProductGraphPreviewProjection = NonNullable<ReturnType<typeof getProductGraphPreviewProjection>>;

export function shouldRunAppBootRequests(
  productGraphPreview: ProductGraphPreviewProjection | null
): productGraphPreview is null {
  return !productGraphPreview;
}

export function buildProductGraphPreviewStatePatch(productGraphPreview: ProductGraphPreviewProjection) {
  return {
    currentView: "intent" as const,
    dashboardLoading: false,
    productGraph: productGraphPreview,
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
    runtimeStatus: "read_only" as const,
    runtimeMessage: PRODUCT_GRAPH_PREVIEW_MESSAGE,
    backendReadyStatus: "unknown" as const,
    runtimeHealthSummary: PRODUCT_GRAPH_PREVIEW_MESSAGE,
    runtimeFallbackLikely: false,
    authStatus: "anonymous" as const,
    sessionLifecycle: "read_only" as const,
    authMessage: PRODUCT_GRAPH_PREVIEW_MESSAGE,
  };
}

export function App() {
  const {
    currentView,
    fetchGraphs,
    loadAuthSession,
    loadRuntimeHealth,
    activeGraphId,
    runtimeLoading,
    sessionLoading,
    uiMode,
    runtimeStatus,
    runtimeMessage,
    runtimeHealthSummary,
  } = useStore();

  const runtimeTone = getRuntimeBannerTone(runtimeStatus);
  const isBooting = runtimeLoading || sessionLoading;
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphRetryKey, setGraphRetryKey] = useState(0);
  const productGraphPreview = useMemo(() => getProductGraphPreviewProjection(), []);

  useEffect(() => {
    if (!shouldRunAppBootRequests(productGraphPreview)) {
      useStore.setState((state) => ({
        ...state,
        ...buildProductGraphPreviewStatePatch(productGraphPreview),
      }));
      return;
    }

    void (async () => {
      await loadRuntimeHealth();
      await loadAuthSession();
      try {
        await fetchGraphs();
      } catch {
        // The store converts runtime failures into safe UI state.
      }
    })();
  }, [fetchGraphs, loadAuthSession, loadRuntimeHealth, productGraphPreview]);

  useEffect(() => {
    setGraphError(null);
  }, [currentView, activeGraphId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Toolbar />
      {runtimeMessage ? (
        <div
          style={{
            background: runtimeTone.background,
            color: "#e2e8f0",
            borderBottom: `1px solid ${runtimeTone.border}`,
            padding: "10px 16px",
            fontSize: 12,
            lineHeight: 1.45,
            pointerEvents: "none",
            transition: "background 160ms ease, border-color 160ms ease",
          }}
        >
          {runtimeStatus === "connected" ? runtimeHealthSummary || runtimeMessage : runtimeMessage}
        </div>
      ) : null}
      {isBooting ? (
        <AppBootState />
      ) : currentView === "dashboard" ? (
        <DashboardView />
      ) : currentView === "intent" ? (
        <Suspense fallback={<GraphLoadingState />}>
          <ProductGraphView />
        </Suspense>
      ) : currentView === "project" ? (
        <Suspense fallback={<GraphLoadingState />}>
          <ProjectGraphView />
        </Suspense>
      ) : (
        <>
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {graphError ? (
              <GraphUnavailableState
                uiMode={uiMode}
                message={graphError}
                onRetry={() => {
                  setGraphError(null);
                  setGraphRetryKey((value) => value + 1);
                }}
              />
            ) : (
              <GraphErrorBoundary onError={(error) => setGraphError(error.message)}>
                <Suspense fallback={<GraphLoadingState />}>
                  <GraphCanvas key={graphRetryKey} />
                </Suspense>
              </GraphErrorBoundary>
            )}
            <NodeDetailPanel />
          </div>
          {activeGraphId ? <RunTimeline /> : null}
        </>
      )}
    </div>
  );
}
