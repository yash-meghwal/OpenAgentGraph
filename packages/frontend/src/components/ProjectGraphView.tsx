import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import type {
  ProjectGraphEdge,
  ProjectGraphEdgeKind,
  ProjectGraphNode,
  ProjectGraphNodeKind,
  ScanProgressSnapshot,
} from "@openagentgraph/shared";
import { useStore } from "../lib/store.js";
import {
  GRAPH_THEMES,
  GRAPH_THEME_OPTIONS,
  readStoredGraphThemeId,
  writeStoredGraphThemeId,
  type GraphThemeId,
} from "../lib/graphTheme.js";

type KindFilter = ProjectGraphNodeKind | "all";

type ProjectGraphVisualNode = ProjectGraphNode & {
  val: number;
};

type ProjectGraphVisualLink = ProjectGraphEdge & {
  source: string;
  target: string;
};

const PROJECT_GRAPH_FALLBACK_WIDTH = 720;
const PROJECT_GRAPH_FALLBACK_HEIGHT = 520;
const PROJECT_GRAPH_MIN_WIDTH = 320;
const PROJECT_GRAPH_MIN_HEIGHT = 420;

export const PROJECT_GRAPH_LAYOUT_CSS = `
.project-graph-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  overflow: hidden;
}

.project-graph-canvas-panel {
  min-width: 0;
  min-height: 0;
  position: relative;
}

.project-graph-sidebar {
  min-width: 0;
}

@media (max-width: 760px) {
  .project-graph-shell {
    grid-template-columns: minmax(0, 1fr);
    overflow: auto;
  }

  .project-graph-canvas-panel {
    min-height: 520px;
  }

  .project-graph-sidebar {
    border-left: 0 !important;
    border-top: 1px solid #1f2937;
    max-height: none;
  }
}
`;

const KIND_FILTERS: Array<{ value: KindFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "directory", label: "Folders" },
  { value: "source", label: "Source" },
  { value: "test", label: "Tests" },
  { value: "doc", label: "Docs" },
  { value: "config", label: "Config" },
  { value: "asset", label: "Assets" },
];

const EDGE_LEGEND_ITEMS: Array<{ kind: ProjectGraphEdgeKind; label: string; detail: string }> = [
  { kind: "contains", label: "Contains", detail: "folder to child file/folder" },
  { kind: "imports", label: "Imports", detail: "source dependency, animated" },
  { kind: "tests", label: "Tests", detail: "test coverage link, animated" },
  { kind: "references", label: "References", detail: "docs/config reference" },
];

function formatBytes(sizeBytes?: number) {
  if (sizeBytes === undefined) return "unknown size";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatProgressBytes(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 MB";
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatScanProgress(progress: ScanProgressSnapshot | null | undefined) {
  if (!progress) return "";
  const phase = progress.phase.replace(/_/g, " ");
  const breaker =
    progress.breakers.state === "hit"
      ? "breaker hit"
      : progress.breakers.state === "near"
        ? "near breaker"
        : "breakers ok";
  return `${phase}: ${progress.filesScanned} files, ${formatProgressBytes(progress.bytesScanned)}, ${progress.filesPerSecond.toFixed(1)} files/s, ${progress.megabytesPerSecond.toFixed(1)} MB/s, ${breaker}`;
}

function progressPercent(progress: ScanProgressSnapshot | null | undefined) {
  if (!progress) return 0;
  return Math.max(3, Math.min(100, (progress.filesScanned / Math.max(1, progress.breakers.limits.maxFiles)) * 100));
}

function progressWarning(progress: ScanProgressSnapshot | null | undefined) {
  if (!progress || progress.breakers.state === "ok") return "";
  return progress.breakers.hits[0]?.message ?? progress.breakers.near[0]?.message ?? "";
}

function getViewportSize() {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return {
    width: Math.floor(window.innerWidth),
    height: Math.floor(window.innerHeight),
  };
}

function useViewportSize() {
  const [size, setSize] = useState(getViewportSize);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateSize = () => setSize(getViewportSize());
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  return size;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.floor(rect.width),
        height: Math.floor(rect.height),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

function scoreNode(node: ProjectGraphNode) {
  if (node.kind === "directory") return 6;
  const lineWeight = Math.min((node.lineCount ?? 0) / 160, 5);
  const importWeight = Math.min((node.importCount ?? 0) / 2, 4);
  return 3 + lineWeight + importWeight;
}

function nodeMatchesSearch(node: ProjectGraphNode, query: string) {
  if (!query) return true;
  return (
    node.label.toLowerCase().includes(query) ||
    node.path.toLowerCase().includes(query) ||
    node.group.toLowerCase().includes(query)
  );
}

function buildNodeLabel(node: ProjectGraphVisualNode) {
  return [
    node.label,
    node.path,
    `${node.kind} in ${node.group}`,
    node.lineCount ? `${node.lineCount} lines` : null,
    node.importCount ? `${node.importCount} imports` : null,
  ].filter(Boolean).join("\n");
}

export function formatProjectGraphScanStatus(projectGraph: ReturnType<typeof useStore.getState>["projectGraph"]) {
  const scannedFileCount = projectGraph?.summary.scannedFileCount ?? 0;
  const skippedFileCount = projectGraph?.summary.skippedFileCount ?? 0;
  const skippedDirectoryCount = projectGraph?.summary.skippedDirectoryCount ?? 0;
  const skippedParts = [
    skippedFileCount > 0 ? `${skippedFileCount} skipped files` : "",
    skippedDirectoryCount > 0 ? `${skippedDirectoryCount} skipped generated folders` : "",
  ].filter(Boolean);
  return [
    `Scan summary: ${scannedFileCount} scanned files`,
    skippedParts.length > 0 ? skippedParts.join(", ") : "",
  ].filter(Boolean).join(", ");
}

export function ProjectGraphView() {
  const {
    projectGraph,
    projectGraphLoading,
    projectGraphError,
    projectGraphScanProgress,
    loadProjectGraph,
  } = useStore();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphThemeId, setGraphThemeId] = useState<GraphThemeId>(() => readStoredGraphThemeId());
  const [graphPanelRef, graphPanelSize] = useElementSize<HTMLDivElement>();
  const viewportSize = useViewportSize();
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    if (!projectGraph && !projectGraphLoading) {
      void loadProjectGraph();
    }
  }, [loadProjectGraph, projectGraph, projectGraphLoading]);

  useEffect(() => {
    writeStoredGraphThemeId(graphThemeId);
  }, [graphThemeId]);

  const graphData = useMemo(() => {
    if (!projectGraph) return { nodes: [] as ProjectGraphVisualNode[], links: [] as ProjectGraphVisualLink[] };

    const nodes = projectGraph.nodes
      .filter((node) => kindFilter === "all" || node.kind === kindFilter)
      .filter((node) => nodeMatchesSearch(node, deferredQuery))
      .map((node) => ({ ...node, val: scoreNode(node) }));
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const links = projectGraph.edges
      .filter((edge) => visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId))
      .map((edge) => ({
        ...edge,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
      }));

    return { nodes, links };
  }, [deferredQuery, kindFilter, projectGraph]);

  const selectedNode = useMemo(
    () => graphData.nodes.find((node) => node.id === selectedNodeId) ?? graphData.nodes[0] ?? null,
    [graphData.nodes, selectedNodeId]
  );
  const scanProgressLine = formatScanProgress(projectGraphScanProgress ?? projectGraph?.progress);
  const scanProgressPercent = progressPercent(projectGraphScanProgress ?? projectGraph?.progress);
  const scanProgressWarning = progressWarning(projectGraphScanProgress ?? projectGraph?.progress);
  const activeKindFilterLabel = KIND_FILTERS.find((filter) => filter.value === kindFilter)?.label ?? "All";
  const graphTheme = GRAPH_THEMES[graphThemeId];
  const hasProjectGraphResults = graphData.nodes.length > 0;
  const fallbackGraphWidth = viewportSize.width
    ? Math.min(PROJECT_GRAPH_FALLBACK_WIDTH, Math.max(PROJECT_GRAPH_MIN_WIDTH, viewportSize.width))
    : PROJECT_GRAPH_FALLBACK_WIDTH;
  const fallbackGraphHeight = viewportSize.height
    ? Math.min(PROJECT_GRAPH_FALLBACK_HEIGHT, Math.max(PROJECT_GRAPH_MIN_HEIGHT, viewportSize.height - 324))
    : PROJECT_GRAPH_FALLBACK_HEIGHT;
  const graphWidth = Math.max(PROJECT_GRAPH_MIN_WIDTH, graphPanelSize.width || fallbackGraphWidth);
  const graphHeight = Math.max(PROJECT_GRAPH_MIN_HEIGHT, graphPanelSize.height || fallbackGraphHeight);
  const emptyGraphReason = deferredQuery
    ? `No files, folders, or packages match "${query.trim()}".`
    : kindFilter === "all"
      ? "No project graph nodes are visible yet."
      : `No ${activeKindFilterLabel.toLowerCase()} nodes are visible in this scan.`;

  const selectedLinks = useMemo(() => {
    if (!selectedNode || !projectGraph) return [];
    return projectGraph.edges
      .filter((edge) => edge.sourceNodeId === selectedNode.id || edge.targetNodeId === selectedNode.id)
      .slice(0, 8);
  }, [projectGraph, selectedNode]);

  if (!projectGraph && projectGraphLoading) {
    return (
      <div style={{ flex: 1, background: "#0f1117", color: "#94a3b8", display: "grid", placeItems: "center" }}>
        Building project graph from local files...
      </div>
    );
  }

  if (!projectGraph && projectGraphError) {
    return (
      <div style={{ flex: 1, background: "#0f1117", color: "#e2e8f0", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: "min(520px, 100%)", border: "1px solid #334155", borderRadius: 16, padding: 20, background: "#111827" }}>
          <div style={{ color: "#f59e0b", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Project graph unavailable
          </div>
          <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800 }}>The codebase graph could not be generated.</div>
          <div style={{ marginTop: 8, color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>{projectGraphError}</div>
          <button
            onClick={() => void loadProjectGraph()}
            style={{
              marginTop: 14,
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Retry scan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="project-graph-shell"
      style={{
        flex: 1,
        minHeight: 0,
        background: `radial-gradient(circle at 20% 10%, ${graphTheme.halo}, transparent 32%), ${graphTheme.background}`,
        color: "#e2e8f0",
      }}
    >
      <style>{PROJECT_GRAPH_LAYOUT_CSS}</style>
      <div ref={graphPanelRef} className="project-graph-canvas-panel">
        <ForceGraph3D<ProjectGraphVisualNode, ProjectGraphVisualLink>
          graphData={graphData}
          width={graphWidth}
          height={graphHeight}
          backgroundColor="rgba(15,17,23,0)"
          cooldownTicks={70}
          nodeRelSize={4}
          nodeVal={(node) => node.val}
          nodeColor={(node) => graphTheme.projectKind[node.kind]}
          nodeLabel={buildNodeLabel}
          onNodeClick={(node) => setSelectedNodeId(node.id)}
          linkColor={(link) => graphTheme.projectEdge[link.kind]}
          linkOpacity={0.64}
          linkWidth={(link) => (link.kind === "imports" || link.kind === "tests" ? 1.8 : 0.9)}
          linkDirectionalParticles={(link) => (link.kind === "imports" || link.kind === "tests" ? 2 : 0)}
          linkDirectionalParticleWidth={1.6}
        />

        {projectGraph && !hasProjectGraphResults ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "absolute",
              inset: "96px 24px 96px 24px",
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "min(460px, 100%)",
                background: "rgba(17, 24, 39, 0.94)",
                border: "1px solid #334155",
                borderRadius: 14,
                boxShadow: "0 18px 44px rgba(0,0,0,0.24)",
                padding: 18,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 900 }}>No project graph matches</div>
              <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
                {emptyGraphReason} Clear the search or switch the type filter back to All.
              </div>
            </div>
          </div>
        ) : null}

        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            right: 16,
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              background: "rgba(17, 24, 39, 0.94)",
              border: "1px solid #334155",
              borderRadius: 12,
              padding: 10,
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              boxShadow: "0 16px 36px rgba(0,0,0,0.22)",
            }}
          >
            <input
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                startTransition(() => setQuery(nextQuery));
              }}
              aria-label="Project graph search"
              placeholder="Find file, folder, package..."
              style={{
                width: 240,
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                color: "#e2e8f0",
                padding: "7px 9px",
                fontSize: 12,
              }}
            />
            <select
              aria-label="Project graph type filter"
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as KindFilter)}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                color: "#e2e8f0",
                padding: "7px 9px",
                fontSize: 12,
              }}
            >
              {KIND_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
            <div
              role="group"
              aria-label="Project graph theme"
              style={{
                display: "inline-flex",
                gap: 4,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>
                Theme
              </span>
              {GRAPH_THEME_OPTIONS.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  aria-pressed={graphThemeId === theme.id}
                  title={theme.description}
                  onClick={() => setGraphThemeId(theme.id)}
                  style={{
                    background: graphThemeId === theme.id ? "#1e3a5f" : "#0f172a",
                    border: `1px solid ${graphThemeId === theme.id ? graphTheme.active : "#334155"}`,
                    borderRadius: 8,
                    color: graphThemeId === theme.id ? "#dbeafe" : "#cbd5e1",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 900,
                    padding: "6px 8px",
                  }}
                >
                  {theme.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => void loadProjectGraph()}
              disabled={projectGraphLoading}
              style={{
                background: projectGraphLoading ? "#334155" : "#0e7490",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "7px 10px",
                fontSize: 12,
                fontWeight: 800,
                cursor: projectGraphLoading ? "not-allowed" : "pointer",
              }}
            >
              {projectGraphLoading ? "Scanning..." : "Refresh"}
            </button>
            {scanProgressLine ? (
              <div style={{ minWidth: 220, display: "grid", gap: 5 }}>
                <div
                  role="progressbar"
                  aria-label="Project graph scan progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(scanProgressPercent)}
                  style={{ height: 6, borderRadius: 999, background: "#1f2937", overflow: "hidden" }}
                >
                  <div
                    style={{
                      width: `${scanProgressPercent}%`,
                      height: "100%",
                      background:
                        (projectGraphScanProgress ?? projectGraph?.progress)?.breakers.state === "hit"
                          ? "#f97316"
                          : (projectGraphScanProgress ?? projectGraph?.progress)?.breakers.state === "near"
                            ? "#f59e0b"
                            : "#38bdf8",
                    }}
                  />
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 11, fontWeight: 800 }}>{scanProgressLine}</div>
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: 16,
            background: "rgba(17, 24, 39, 0.94)",
            border: "1px solid #334155",
            borderRadius: 12,
            padding: "10px 12px",
            color: "#94a3b8",
            fontSize: 11,
            lineHeight: 1.45,
            display: "grid",
            gap: 8,
            maxWidth: 360,
          }}
        >
          <div style={{ color: "#e2e8f0", fontWeight: 800 }}>
            {graphData.nodes.length} visible nodes / {graphData.links.length} links
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {KIND_FILTERS.filter((filter) => filter.value !== "all").map((filter) => (
              <span key={filter.value} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: graphTheme.projectKind[filter.value as ProjectGraphNodeKind],
                    display: "inline-block",
                  }}
                />
                {filter.label}
              </span>
            ))}
          </div>
          <div
            role="group"
            aria-label="Project graph edge legend"
            style={{ borderTop: "1px solid #263244", paddingTop: 8, display: "grid", gap: 5 }}
          >
            <div style={{ color: "#cbd5e1", fontWeight: 800 }}>Edges</div>
            <div style={{ display: "grid", gap: 5 }}>
              {EDGE_LEGEND_ITEMS.map((item) => (
                <span key={item.kind} style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#cbd5e1", fontWeight: 800 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 18,
                        height: 2,
                        borderRadius: 999,
                        background: graphTheme.projectEdge[item.kind],
                        boxShadow: item.kind === "imports" || item.kind === "tests" ? `0 0 0 1px ${graphTheme.projectEdge[item.kind]}55` : "none",
                        display: "inline-block",
                      }}
                    />
                    {item.label}
                  </span>
                  <span style={{ color: "#94a3b8" }}>{item.detail}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside
        className="project-graph-sidebar"
        style={{
          minHeight: 0,
          overflow: "auto",
          background: "rgba(15, 23, 42, 0.92)",
          borderLeft: "1px solid #1f2937",
          padding: 18,
          display: "grid",
          alignContent: "start",
          gap: 16,
        }}
      >
        <div>
          <div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Codebase map
          </div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900, letterSpacing: "-0.03em" }}>
            Native project graph
          </div>
          <div style={{ marginTop: 8, color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
            This maps files, folders, imports, and test relationships from the local workspace. It gives OpenAgentGraph a visible graph before an execution run exists.
          </div>
        </div>

        {projectGraph ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              ["Files", projectGraph.summary.fileCount],
              ["Folders", projectGraph.summary.directoryCount],
              ["Imports", projectGraph.summary.importEdgeCount],
              ["Tests", projectGraph.summary.testEdgeCount],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "#111827", border: "1px solid #263244", borderRadius: 12, padding: 10 }}>
                <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                <div style={{ marginTop: 4, fontSize: 18, fontWeight: 900 }}>{value}</div>
              </div>
            ))}
          </div>
        ) : null}

        {selectedNode ? (
          <div style={{ background: "#111827", border: "1px solid #263244", borderRadius: 14, padding: 14, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div style={{ color: graphTheme.projectKind[selectedNode.kind], fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {selectedNode.kind}
              </div>
              <div style={{ color: "#64748b", fontSize: 11 }}>{selectedNode.group}</div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, wordBreak: "break-word" }}>{selectedNode.label}</div>
            <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45, wordBreak: "break-word" }}>{selectedNode.path}</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", color: "#cbd5e1", fontSize: 11 }}>
              <span>{formatBytes(selectedNode.sizeBytes)}</span>
              {selectedNode.lineCount ? <span>{selectedNode.lineCount} lines</span> : null}
              {selectedNode.importCount ? <span>{selectedNode.importCount} imports</span> : null}
            </div>
            {selectedLinks.length > 0 ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
                  Nearby links
                </div>
                {selectedLinks.map((link) => (
                  <div key={link.id} style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.35 }}>
                    <span style={{ color: graphTheme.projectEdge[link.kind], fontWeight: 800 }}>{link.kind}</span>
                    {" "}
                    {link.sourceNodeId === selectedNode.id ? "to" : "from"}
                    {" "}
                    {(link.sourceNodeId === selectedNode.id ? link.targetNodeId : link.sourceNodeId).replace(/^file:|^dir:/, "")}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "#64748b", fontSize: 11 }}>No nearby links are visible for this filter.</div>
            )}
          </div>
        ) : null}

        <div style={{ color: "#64748b", fontSize: 11, lineHeight: 1.5 }}>
          {formatProjectGraphScanStatus(projectGraph)}.
          Hidden folders include generated, cache, dependency, build, database, and dev log output.
          {scanProgressWarning ? ` ${scanProgressWarning}` : ""}
        </div>
      </aside>
    </div>
  );
}
