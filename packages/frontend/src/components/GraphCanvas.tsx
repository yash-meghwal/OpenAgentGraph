import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  type Object3D,
} from "three";
import type { Edge, Node } from "@openagentgraph/shared";
import { useStore } from "../lib/store.js";
import { getActiveNode, getNodeDisplaySummary } from "../lib/viewMode.js";
import { buildPresentedGraph } from "../lib/graphPresentation.js";
import { deriveGraphRuntime } from "../lib/graphRuntime.js";
import {
  GRAPH_THEMES,
  GRAPH_THEME_OPTIONS,
  readStoredGraphThemeId,
  writeStoredGraphThemeId,
  type GraphTheme,
  type GraphThemeId,
} from "../lib/graphTheme.js";

type GraphNodeObject = Node & {
  synthetic?: boolean;
  hiddenCount?: number;
  x: number;
  y: number;
  z: number;
  fx?: number;
  fy?: number;
  fz?: number;
  renderOpacity: number;
  renderScale: number;
  isHighlighted: boolean;
};

type GraphLinkObject = Edge;

type CachedNodeVisual = {
  signature: string;
  object: Group;
  sphere: Mesh<SphereGeometry, MeshStandardMaterial>;
  glow: Mesh<SphereGeometry, MeshBasicMaterial>;
  outline: Mesh<SphereGeometry, MeshBasicMaterial>;
};

type TransformCacheEntry = {
  signature: string;
  node: GraphNodeObject;
};

type GeometryCache = {
  sphere: Map<string, SphereGeometry>;
};

type MaterialCache = {
  standard: Map<string, MeshStandardMaterial>;
  basic: Map<string, MeshBasicMaterial>;
};

function toGraphPosition(node: Node) {
  const depth = node.coordinates?.depth ?? 0;
  const abstraction = node.coordinates?.abstractionLevel ?? 0;
  const drift = node.coordinates?.driftDistance ?? 0;
  const x = depth * 200;
  const y = abstraction * 150;
  const z = drift * 300;
  return { x, y, z };
}

function nodeColor(node: Node, theme: GraphTheme): string {
  if (node.kind === "revision") return theme.executionRelation.revision;
  if (node.branchId) return theme.executionRelation.branch;
  return theme.executionStatus[node.status] ?? theme.executionStatus.pending;
}

function isMainlineNode(node: Node, activeGoalVersionId: string | null) {
  return node.activeGoalVersionId === activeGoalVersionId && node.kind !== "revision" && node.status !== "superseded";
}

function toGraphNode(
  node: Node,
  activeNodeId: string | null,
  activeGoalVersionId: string | null,
  focusActivePath: boolean
): GraphNodeObject {
  const { x, y, z } = toGraphPosition(node);
  const isActive = node.id === activeNodeId;
  let renderOpacity = node.status === "superseded" ? 0.3 : 1;
  let renderScale = isActive ? 1.2 : node.status === "running" ? 1.1 : 1;

  if (focusActivePath) {
    if (isActive) {
      renderOpacity = 1;
      renderScale = 1.25;
    } else if (node.status === "superseded") {
      renderOpacity = 0.15;
      renderScale = 0.9;
    } else if (node.kind === "revision") {
      renderOpacity = 0.5;
      renderScale = 0.95;
    } else if (isMainlineNode(node, activeGoalVersionId)) {
      renderOpacity = 1;
      renderScale = 1;
    } else {
      renderOpacity = 0.35;
      renderScale = 0.95;
    }
  }

  const base = { ...node, x, y, z, renderOpacity, renderScale, isHighlighted: isActive };
  if (node.status === "completed" || node.status === "superseded") {
    return { ...base, fx: x, fy: y, fz: z };
  }
  return base;
}

function buildNodeSignature(
  node: GraphNodeObject,
  selectedNodeId: string | null,
  quality: "standard" | "performance",
  themeId: GraphThemeId
) {
  return [
    themeId,
    node.status,
    node.kind,
    node.branchId ?? "",
    selectedNodeId === node.id ? "selected" : "plain",
    node.isHighlighted ? "active" : "idle",
    quality,
    node.renderOpacity.toFixed(2),
    node.renderScale.toFixed(2),
  ].join("|");
}

function buildTransformSignature(
  node: Node,
  activeNodeId: string | null,
  activeGoalVersionId: string | null,
  focusActivePath: boolean
) {
  return [
    node.status,
    node.kind,
    node.branchId ?? "",
    node.activeGoalVersionId,
    activeNodeId === node.id ? "active" : "idle",
    activeGoalVersionId ?? "",
    focusActivePath ? "focus" : "normal",
    node.coordinates?.depth ?? 0,
    node.coordinates?.abstractionLevel ?? 0,
    node.coordinates?.driftDistance ?? 0,
  ].join("|");
}

function getSphereGeometry(cache: GeometryCache, radius: number, segments: number) {
  const key = `${radius.toFixed(2)}|${segments}`;
  const existing = cache.sphere.get(key);
  if (existing) return existing;
  const geometry = new SphereGeometry(radius, segments, segments);
  cache.sphere.set(key, geometry);
  return geometry;
}

function getStandardMaterial(
  cache: MaterialCache,
  input: {
    color: string;
    opacity: number;
    emissive: string;
    emissiveIntensity: number;
  }
) {
  const key = `${input.color}|${input.opacity.toFixed(2)}|${input.emissive}|${input.emissiveIntensity.toFixed(2)}`;
  const existing = cache.standard.get(key);
  if (existing) return existing;
  const material = new MeshStandardMaterial({
    color: input.color,
    transparent: true,
    opacity: input.opacity,
    emissive: input.emissive,
    emissiveIntensity: input.emissiveIntensity,
  });
  cache.standard.set(key, material);
  return material;
}

function getBasicMaterial(cache: MaterialCache, color: string, opacity: number) {
  const key = `${color}|${opacity.toFixed(2)}`;
  const existing = cache.basic.get(key);
  if (existing) return existing;
  const material = new MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
  });
  cache.basic.set(key, material);
  return material;
}

function createCachedVisual(): CachedNodeVisual {
  const object = new Group();
  const sphere = new Mesh(new SphereGeometry(1, 12, 12), new MeshStandardMaterial());
  const glow = new Mesh(new SphereGeometry(1.2, 12, 12), new MeshBasicMaterial());
  const outline = new Mesh(new SphereGeometry(1.35, 12, 12), new MeshBasicMaterial());
  object.add(sphere);
  object.add(glow);
  object.add(outline);
  return {
    signature: "",
    object,
    sphere,
    glow,
    outline,
  };
}

export function GraphCanvas() {
  const {
    nodes,
    edges,
    graphs,
    activeGraphId,
    selectedNodeId,
    filterStatus,
    filterBranch,
    selectNode,
    driftSummary,
    uiMode,
    graphQuality,
    graphDetailMode,
    showSupersededNodes,
    showRevisionBranches,
    showReplanBranches,
    focusActivePath,
    collapseSupersededBranches,
    collapseRevisionClusters,
    showActiveNeighborhoodOnly,
  } = useStore();

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [graphThemeId, setGraphThemeId] = useState<GraphThemeId>(() => readStoredGraphThemeId());
  const deferredNodes = useDeferredValue(nodes);
  const nodeObjectCache = useRef(new Map<string, CachedNodeVisual>());
  const transformedNodeCache = useRef(new Map<string, TransformCacheEntry>());
  const geometryCache = useRef<GeometryCache>({
    sphere: new Map(),
  });
  const materialCache = useRef<MaterialCache>({
    standard: new Map(),
    basic: new Map(),
  });
  const activeNode = useMemo(() => getActiveNode(nodes), [nodes]);
  const graphTheme = GRAPH_THEMES[graphThemeId];

  useEffect(() => {
    writeStoredGraphThemeId(graphThemeId);
  }, [graphThemeId]);

  const activeGraph = useMemo(
    () => graphs.find((graph) => graph.id === activeGraphId) ?? null,
    [graphs, activeGraphId]
  );
  const derivedGraphRuntime = useMemo(
    () =>
      deriveGraphRuntime({
        totalNodeCount: deferredNodes.length,
        selectedNodeId,
        activeNodeId: activeNode?.id ?? null,
        graphQuality,
        graphDetailMode,
        showSupersededNodes,
        showRevisionBranches,
        showReplanBranches,
      }),
    [
      deferredNodes.length,
      selectedNodeId,
      activeNode?.id,
      graphQuality,
      graphDetailMode,
      showSupersededNodes,
      showRevisionBranches,
      showReplanBranches,
    ]
  );

  const presentedGraph = useMemo(
    () =>
      buildPresentedGraph(deferredNodes, edges, {
        selectedNodeId,
        activeNodeId: activeNode?.id ?? null,
        showSupersededNodes: derivedGraphRuntime.effectiveShowSupersededNodes,
        showRevisionBranches: derivedGraphRuntime.effectiveShowRevisionBranches,
        showReplanBranches: derivedGraphRuntime.effectiveShowReplanBranches,
        collapseSupersededBranches,
        collapseRevisionClusters,
        showActiveNeighborhoodOnly,
      }),
    [
      deferredNodes,
      edges,
      selectedNodeId,
      activeNode?.id,
      derivedGraphRuntime.effectiveShowSupersededNodes,
      derivedGraphRuntime.effectiveShowRevisionBranches,
      derivedGraphRuntime.effectiveShowReplanBranches,
      collapseSupersededBranches,
      collapseRevisionClusters,
      showActiveNeighborhoodOnly,
    ]
  );

  const visibleNodes = useMemo(
    () =>
      presentedGraph.nodes.filter((node) => {
        if (filterStatus && node.status !== filterStatus) return false;
        if (filterBranch && node.branchId !== filterBranch) return false;
        return true;
      }),
    [presentedGraph.nodes, filterStatus, filterBranch]
  );

  const graphData = useMemo(() => {
    const transformedNodes = visibleNodes.map((node) => {
      const signature = buildTransformSignature(
        node,
        activeNode?.id ?? null,
        activeGraph?.activeGoalVersionId ?? null,
        focusActivePath
      );
      const cached = transformedNodeCache.current.get(node.id);
      if (cached && cached.signature === signature) {
        return cached.node;
      }

      const transformed = toGraphNode(
        node,
        activeNode?.id ?? null,
        activeGraph?.activeGoalVersionId ?? null,
        focusActivePath
      );
      transformedNodeCache.current.set(node.id, {
        signature,
        node: transformed,
      });
      return transformed;
    });

    const transformedNodeIdSet = new Set(transformedNodes.map((node) => node.id));
    const links = presentedGraph.edges.filter(
      (edge) => transformedNodeIdSet.has(edge.sourceNodeId) && transformedNodeIdSet.has(edge.targetNodeId)
    ) as GraphLinkObject[];

    return {
      nodes: transformedNodes,
      links,
    };
  }, [visibleNodes, activeNode?.id, activeGraph?.activeGoalVersionId, focusActivePath, presentedGraph.edges]);

  const labeledNode = useMemo(() => {
    if (derivedGraphRuntime.suppressHoverDetails) {
      return (
        graphData.nodes.find((node) => node.id === selectedNodeId) ??
        graphData.nodes.find((node) => node.id === activeNode?.id) ??
        null
      );
    }
    return (
      graphData.nodes.find((node) => node.id === selectedNodeId) ??
      graphData.nodes.find((node) => node.id === hoveredNodeId) ??
      graphData.nodes.find((node) => node.id === activeNode?.id) ??
      null
    );
  }, [graphData.nodes, derivedGraphRuntime.suppressHoverDetails, selectedNodeId, hoveredNodeId, activeNode?.id]);

  const labelBudgetReached = graphData.nodes.length > 35;
  const effectiveGraphQuality = derivedGraphRuntime.effectiveGraphQuality;

  return (
    <div style={{ flex: 1, background: graphTheme.background, position: "relative" }}>
      <ForceGraph3D<GraphNodeObject, GraphLinkObject>
        graphData={graphData}
        cooldownTicks={effectiveGraphQuality === "performance" ? 20 : 50}
        backgroundColor={graphTheme.background}
        nodeRelSize={effectiveGraphQuality === "performance" ? 3 : 4}
        enableNodeDrag={false}
        nodeThreeObjectExtend
        nodeLabel={() => ""}
        onNodeHover={(node) => setHoveredNodeId(derivedGraphRuntime.suppressHoverDetails ? null : node?.id ?? null)}
        onNodeClick={(node) => selectNode(node.id)}
        linkColor={(link) => {
          if (link.kind === "revises") return graphTheme.executionRelation.revises;
          if (link.kind === "supersedes") return graphTheme.executionRelation.supersedes;
          return graphTheme.executionRelation.default;
        }}
        linkWidth={(link) => {
          if (effectiveGraphQuality === "performance") return link.kind === "supersedes" ? 1.8 : 1;
          if (link.kind === "supersedes") return 2.6;
          if (link.kind === "revises") return 2.1;
          return 1.2;
        }}
        linkOpacity={effectiveGraphQuality === "performance" ? 0.55 : 0.72}
        nodeThreeObject={(node) => {
          const signature = buildNodeSignature(node, selectedNodeId, effectiveGraphQuality, graphThemeId);
          const segments = effectiveGraphQuality === "performance" ? 12 : 24;
          const radius = (effectiveGraphQuality === "performance" ? 6 : 7) * node.renderScale;
          const cached = nodeObjectCache.current.get(node.id) ?? createCachedVisual();
          if (cached.signature !== signature) {
            const baseColor = node.synthetic ? graphTheme.synthetic : nodeColor(node, graphTheme);
            const emissive = node.id === activeNode?.id ? (node.synthetic ? graphTheme.active : baseColor) : "#000000";
            cached.sphere.geometry = getSphereGeometry(geometryCache.current, radius, segments);
            cached.sphere.material = getStandardMaterial(materialCache.current, {
              color: baseColor,
              opacity: node.renderOpacity,
              emissive,
              emissiveIntensity: node.id === activeNode?.id ? (effectiveGraphQuality === "performance" ? 0.35 : 0.55) : 0,
            });

            cached.glow.visible = node.id === activeNode?.id && effectiveGraphQuality === "standard";
            if (cached.glow.visible) {
              cached.glow.geometry = getSphereGeometry(geometryCache.current, radius + 3, segments);
              cached.glow.material = getBasicMaterial(materialCache.current, graphTheme.active, 0.18);
            }

            cached.outline.visible = uiMode === "developer" && node.id === selectedNodeId;
            if (cached.outline.visible) {
              cached.outline.geometry = getSphereGeometry(geometryCache.current, radius + 1.2, segments);
              cached.outline.material = getBasicMaterial(materialCache.current, graphTheme.selected, 0.92);
            }

            cached.signature = signature;
            nodeObjectCache.current.set(node.id, cached);
          }

          return cached.object as Object3D;
        }}
      />

      {labeledNode ? (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            background: "rgba(17, 24, 39, 0.94)",
            border: "1px solid #2d3748",
            borderRadius: 12,
            padding: "12px 14px",
            color: "#cbd5e0",
            maxWidth: 360,
            fontSize: 12,
            lineHeight: 1.45,
            boxShadow: "0 14px 30px rgba(0,0,0,0.22)",
          }}
        >
          <div style={{ color: "#90cdf4", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
            {labeledNode.id === activeNode?.id ? "Active frontier" : labeledNode.id === selectedNodeId ? "Selected node" : "Hovered node"}
          </div>
          <div style={{ color: "#e2e8f0", marginBottom: 4, fontWeight: 700 }}>{labeledNode.title}</div>
          <div>{getNodeDisplaySummary(labeledNode)}</div>
          {derivedGraphRuntime.statusMessage ? (
            <div style={{ marginTop: 6, color: "#90cdf4", fontSize: 11 }}>{derivedGraphRuntime.statusMessage}</div>
          ) : null}
          {labelBudgetReached ? (
            <div style={{ marginTop: 6, color: "#718096", fontSize: 10 }}>
              Dense graph detected. Labels are limited to the active, selected, or hovered node.
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          inset: "auto auto 20px 16px",
          background: "rgba(17, 24, 39, 0.94)",
          border: "1px solid #2d3748",
          borderRadius: 12,
          padding: "12px 14px",
          fontSize: 11,
          display: "grid",
          gap: 4,
          color: "#a0aec0",
          maxWidth: 310,
          boxShadow: "0 14px 30px rgba(0,0,0,0.22)",
        }}
      >
        <div style={{ color: "#718096", fontWeight: 700 }}>3D graph</div>
        <div>Visible now: {graphData.nodes.length} nodes</div>
        <div>Quality: {effectiveGraphQuality}</div>
        <div
          role="group"
          aria-label="Execution graph theme"
          style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}
        >
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
                fontSize: 10,
                fontWeight: 900,
                padding: "5px 7px",
              }}
            >
              {theme.label}
            </button>
          ))}
        </div>
        {derivedGraphRuntime.statusMessage ? <div>{derivedGraphRuntime.statusMessage}</div> : null}
        <div>Focus active path: {String(focusActivePath)}</div>
        <div>{driftSummary || "The graph will summarize drift once evaluated work appears."}</div>
      </div>
    </div>
  );
}
