// Pure model layer extracted from ProductGraphView.tsx: types, constants, and
// framework-free helpers (no React). Re-exported by ProductGraphView.tsx.

import type {
  ProductEdgeKind,
  ProductGraphAcceptanceEvidenceHealthSummary,
  ProductGraphCodeIntentDriftSummary,
  ProductGraphCodeScanFreshnessSummary,
  ProductGraphExecutionDriftSummary,
  ProductGraphExecutionTestEvidenceSummary,
  ProductGraphEdge,
  ProductGraphProjection,
  ProductGraphProjectionNode,
  ProductGraphReadyTaskCandidateSummary,
  ProductGraphTaskScopeId,
  ProductGraphTrace,
  ProductNodeKind,
  ProductNodeStatus,
  ProductTrustLabel,
  ScanProgressSnapshot,
} from "@openagentgraph/shared";
import {
  DEFAULT_GRAPH_THEME,
  type GraphThemeId,
} from "../lib/graphTheme.js";
import type {
  ScanProductGraphCodebaseResult,
  ImportProductGraphSpecKitResult,
} from "../lib/productGraphApi.js";


export type ProductKindFilter = ProductNodeKind | "all";
export type ProductStatusFilter = ProductNodeStatus | "all";
export type ProductGraphReadinessTone = "success" | "warning" | "danger" | "neutral";
export type CodeMapQuickFilter =
  | "all"
  | "dependencies"
  | "semantic"
  | "cycles"
  | "unresolved"
  | "external"
  | "orphans"
  | "freshness";

export interface CodexExecutionReadinessNotice {
  message: string;
  tone: ProductGraphReadinessTone;
}

export interface CodeMapCommunitySummary {
  node: ProductGraphProjectionNode;
  fileCount: number;
  dependencyCount: number;
  semanticLinkCount: number;
  externalDependencyCount: number;
  unresolvedDependencyCount: number;
}

export interface CodeMapCommunityGroup {
  summary: CodeMapCommunitySummary;
  files: ProductGraphProjectionNode[];
  hiddenFileCount: number;
}

export interface CodeMapDependencyHotspot {
  node: ProductGraphProjectionNode;
  importsCount: number;
  importedByCount: number;
  semanticRelationshipCount: number;
  externalDependencyCount: number;
  unresolvedDependencyCount: number;
  score: number;
}

export interface CodeMapImpactItem {
  node: ProductGraphProjectionNode;
  edge: ProductGraphEdge;
  relation: string;
}

export interface CodeMapImpactSection {
  items: CodeMapImpactItem[];
  totalCount: number;
}

export interface CodeMapImpactSummary {
  imports: CodeMapImpactSection;
  importedBy: CodeMapImpactSection;
  semanticRelationships: CodeMapImpactSection;
  linkedEvidence: CodeMapImpactSection;
}

export interface CodeMapDependencyCycle {
  nodeIds: string[];
  nodes: ProductGraphProjectionNode[];
  edgeIds: string[];
}

export interface CodeMapArchitectureHealth {
  dependencyCycles: CodeMapDependencyCycle[];
  dependencyCycleCount: number;
  hasMoreDependencyCycles: boolean;
  dependencyCycleSearchLimited: boolean;
  unresolvedFiles: ProductGraphProjectionNode[];
  unresolvedFileCount: number;
  externalFiles: ProductGraphProjectionNode[];
  externalFileCount: number;
  orphanFiles: ProductGraphProjectionNode[];
  orphanFileCount: number;
  staleCodeNodes: ProductGraphProjectionNode[];
  staleCodeNodeCount: number;
}

export type CodeMapExplorerSelection =
  | { mode: "community"; communityNodeId: string }
  | { mode: "cycle"; cycleIndex: number }
  | { mode: "orphans" | "external" | "unresolved" };

export interface CodeMapExplorerView {
  selection: CodeMapExplorerSelection;
  title: string;
  detail: string;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  highlightedNodeIds: Set<string>;
  itemNodes: ProductGraphProjectionNode[];
  hiddenItemCount: number;
  hiddenNodeCount: number;
  focusNodeId?: string;
}

export interface CodeMapImpactPathPreview {
  upstreamFiles: CodeMapImpactSection;
  downstreamFiles: CodeMapImpactSection;
  linkedEvidence: CodeMapImpactSection;
}

export function codeMapExplorerSelectionMatches(
  current: CodeMapExplorerSelection | null,
  candidate: CodeMapExplorerSelection | undefined
) {
  if (!current || !candidate || current.mode !== candidate.mode) return false;
  if (current.mode === "community" && candidate.mode === "community") {
    return current.communityNodeId === candidate.communityNodeId;
  }
  if (current.mode === "cycle" && candidate.mode === "cycle") {
    return current.cycleIndex === candidate.cycleIndex;
  }
  return true;
}

export const KIND_FILTERS: Array<{ value: ProductKindFilter; label: string }> = [
  { value: "all", label: "All intent" },
  { value: "feature", label: "Features" },
  { value: "user_story", label: "Stories" },
  { value: "requirement", label: "Requirements" },
  { value: "acceptance_criterion", label: "Criteria" },
  { value: "open_question", label: "Questions" },
  { value: "plan", label: "Plans" },
  { value: "task", label: "Tasks" },
  { value: "code_file", label: "Code files" },
  { value: "code_symbol", label: "Symbols" },
  { value: "code_community", label: "Communities" },
];

export const CODE_KIND_FILTERS: Array<{ value: Extract<ProductNodeKind, "code_file" | "code_symbol" | "code_community">; label: string }> = [
  { value: "code_file", label: "Files" },
  { value: "code_symbol", label: "Symbols" },
  { value: "code_community", label: "Communities" },
];

export interface CodeMapFilterState {
  files: boolean;
  symbols: boolean;
  communities: boolean;
  dependencyEdges: boolean;
  semanticEdges: boolean;
}

export const DEFAULT_CODE_MAP_FILTERS: CodeMapFilterState = {
  files: true,
  symbols: true,
  communities: true,
  dependencyEdges: true,
  semanticEdges: true,
};

export const TASK_CODE_EDGE_KINDS = new Set<ProductEdgeKind>(["touches", "implements", "depends_on"]);
export const SEMANTIC_CODE_EDGE_KINDS = new Set<ProductEdgeKind>(["uses", "exports", "extends", "implements"]);
export const LINKED_RUN_FILE_LIMIT = 5;
export const LINKED_PLAN_RUN_LIMIT = 5;
export const ACCEPTANCE_EVIDENCE_LIMIT = 5;
export const CODE_MAP_COMMUNITY_SUMMARY_LIMIT = 5;
export const CODE_MAP_COMMUNITY_GROUP_FILE_LIMIT = 4;
export const CODE_MAP_HOTSPOT_LIMIT = 5;
export const CODE_MAP_IMPACT_SECTION_LIMIT = 5;
export const CODE_MAP_IMPACT_PATH_LIMIT = 3;
export const CODE_MAP_EXPLORER_RENDER_NODE_LIMIT = 80;
export const CODE_MAP_HEALTH_ITEM_LIMIT = 5;
export const CODE_MAP_CYCLE_LIMIT = 5;
export const CODE_MAP_CYCLE_MAX_DEPTH = 8;
export const CODE_MAP_CYCLE_VISIT_LIMIT = 10_000;
export const PRODUCT_GRAPH_NODE_CARD_RENDER_LIMIT = 180;
export const PRODUCT_GRAPH_NODE_CARD_RENDER_INCREMENT = 180;
export const ACCEPTANCE_EVIDENCE_GAP_LIMIT = 4;
export const BLOCKED_TASK_GAP_LIMIT = 4;
export const READY_TASK_CANDIDATE_LIMIT = 4;
export const EXECUTION_DRIFT_TASK_LIMIT = 4;
export const TEST_EVIDENCE_TASK_LIMIT = 4;
export const CODE_INTENT_DRIFT_CODE_LIMIT = 4;
export const CODE_MAP_FRESHNESS_CODE_LIMIT = 4;
export const CODEBASE_SCAN_SETUP_GUIDANCE =
  "Run Scan Codebase from the manager tools in this sidebar to refresh the native Product Graph code map.";
export const CODEBASE_SCAN_SCOPE_COPY =
  "Scans bounded local TypeScript and JavaScript files, top-level exports, semantic imports, and symbol relationships.";
export type CodeMapThemeKey = keyof typeof DEFAULT_GRAPH_THEME.codeMap;
export const CODE_MAP_VISUAL_KEY: Array<{ key: CodeMapThemeKey; label: string; detail: string }> = [
  { key: "communities", label: "Communities", detail: "module clusters that group scanned files" },
  { key: "files", label: "Files", detail: "source files and dependency endpoints" },
  { key: "symbols", label: "Symbols", detail: "exported declarations and semantic targets" },
  { key: "dependencies", label: "Dependencies", detail: "import/module edges between files" },
  { key: "semantic", label: "Semantic", detail: "TypeScript-resolved symbol relationships" },
  { key: "uncertain", label: "Uncertain", detail: "inferred or ambiguous graph evidence" },
];
export const EMPTY_PRODUCT_GRAPH_TRACE_CACHE: Record<string, ProductGraphTrace> = {};
export const EMPTY_EXECUTION_DRIFT_HEALTH: ProductGraphExecutionDriftSummary = {
  completedTaskCount: 0,
  tasksWithDriftCount: 0,
  tasksMissingRunCount: 0,
  tasksMissingEvidenceCount: 0,
  taskGaps: [],
};
export const EMPTY_EXECUTION_TEST_EVIDENCE_HEALTH: ProductGraphExecutionTestEvidenceSummary = {
  completedTaskCount: 0,
  completedTasksWithLinkedEvidenceCount: 0,
  tasksMissingTestEvidenceCount: 0,
  taskGaps: [],
};
export const EMPTY_READY_TASK_CANDIDATE_HEALTH: ProductGraphReadyTaskCandidateSummary = {
  plannedTaskCount: 0,
  blockedPlannedTaskCount: 0,
  readyTaskCount: 0,
  taskCandidates: [],
};
export const EMPTY_CODE_INTENT_DRIFT_HEALTH: ProductGraphCodeIntentDriftSummary = {
  changedCodeNodeCount: 0,
  changedCodeNodesWithIntentCount: 0,
  codeNodesMissingIntentCount: 0,
  codeGaps: [],
};
export const EMPTY_CODE_MAP_FRESHNESS_HEALTH: ProductGraphCodeScanFreshnessSummary = {
  codeScanNodeCount: 0,
  runTouchedCodeNodeCount: 0,
  codeNodesChangedAfterCodeScanCount: 0,
  hasCodeScanMap: false,
  hasRunTouchedCode: false,
  isCodeMapMissing: false,
  isCodeMapStale: false,
  codeGaps: [],
};
export const EMPTY_CODE_MAP_ARCHITECTURE_HEALTH: CodeMapArchitectureHealth = {
  dependencyCycles: [],
  dependencyCycleCount: 0,
  hasMoreDependencyCycles: false,
  dependencyCycleSearchLimited: false,
  unresolvedFiles: [],
  unresolvedFileCount: 0,
  externalFiles: [],
  externalFileCount: 0,
  orphanFiles: [],
  orphanFileCount: 0,
  staleCodeNodes: [],
  staleCodeNodeCount: 0,
};
export const EMPTY_ACCEPTANCE_EVIDENCE_HEALTH: ProductGraphAcceptanceEvidenceHealthSummary = {
  featureCount: 0,
  featuresWithCriteriaCount: 0,
  featuresNeedingEvidenceCount: 0,
  acceptanceCriteriaCount: 0,
  verifiedAcceptanceCriteriaCount: 0,
  criteriaNeedingEvidenceCount: 0,
  coveragePercent: 0,
};

export const STATUS_FILTERS: Array<{ value: ProductStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "proposed", label: "Proposed" },
  { value: "planned", label: "Planned" },
  { value: "blocked", label: "Blocked" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "resolved", label: "Resolved" },
];

export const CREATE_NODE_KIND_OPTIONS: Array<{ value: ProductNodeKind; label: string }> = [
  { value: "idea", label: "Idea" },
  { value: "feature", label: "Feature" },
  { value: "user_story", label: "User story" },
  { value: "requirement", label: "Requirement" },
  { value: "acceptance_criterion", label: "Acceptance criterion" },
  { value: "open_question", label: "Open question" },
  { value: "decision", label: "Decision" },
  { value: "plan", label: "Plan" },
  { value: "task", label: "Task" },
];

export const CREATE_NODE_STATUS_OPTIONS: Array<{ value: ProductNodeStatus; label: string }> = [
  { value: "proposed", label: "Proposed" },
  { value: "planned", label: "Planned" },
  { value: "blocked", label: "Blocked" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "resolved", label: "Resolved" },
];

export const CREATE_EDGE_KIND_OPTIONS: Array<{ value: ProductEdgeKind; label: string }> = [
  { value: "belongs_to", label: "Belongs to" },
  { value: "satisfies", label: "Satisfies" },
  { value: "implements", label: "Implements" },
  { value: "verifies", label: "Verifies" },
  { value: "touches", label: "Touches" },
  { value: "uses", label: "Uses" },
  { value: "exports", label: "Exports" },
  { value: "depends_on", label: "Depends on" },
  { value: "extends", label: "Extends" },
  { value: "blocked_by", label: "Blocked by" },
  { value: "derived_from", label: "Derived from" },
  { value: "consulted", label: "Consulted" },
  { value: "produced_by", label: "Produced by" },
  { value: "supersedes", label: "Supersedes" },
];

export const MAX_BUNDLE_ITEM_FIELDS = 10;

export const TRUST_TONES: Record<ProductTrustLabel, { color: string; border: string; background: string }> =
  DEFAULT_GRAPH_THEME.trust;

export const READINESS_TONES: Record<ProductGraphReadinessTone, { color: string; border: string; background: string }> = {
  success: {
    color: "#86efac",
    border: "#22c55e",
    background: "#0f2f23",
  },
  warning: {
    color: "#fde68a",
    border: "#f59e0b",
    background: "#3b2a14",
  },
  danger: {
    color: "#fca5a5",
    border: "#ef4444",
    background: "#3b1717",
  },
  neutral: {
    color: "#cbd5e1",
    border: "#334155",
    background: "#0f172a",
  },
};

export const PRODUCT_GRAPH_LAYOUT_CSS = `
.product-graph-shell {
  grid-template-columns: minmax(280px, 400px) minmax(0, 1fr);
  overflow: hidden;
}

.product-graph-sidebar {
  min-width: 0;
  overflow-x: hidden;
}

.product-graph-sidebar > * {
  min-width: 0;
  max-width: 100%;
}

.product-graph-sidebar input,
.product-graph-sidebar select,
.product-graph-sidebar textarea,
.product-graph-filter-grid > * {
  min-width: 0;
  max-width: 100%;
  width: 100%;
}

.product-graph-stat-grid,
.product-graph-filter-grid {
  grid-template-columns: 1fr 1fr;
}

.product-graph-detail-grid {
  grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
}

@media (max-width: 900px) {
  .product-graph-shell {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .product-graph-sidebar {
    border-right: none !important;
    border-bottom: 1px solid #1f2937;
  }
}

@media (max-width: 760px) {
  .product-graph-detail-grid,
  .product-graph-filter-grid {
    grid-template-columns: 1fr;
  }
}
`;

export function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

export function formatTitleLabel(value: string) {
  const label = formatLabel(value);
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : label;
}

export function nodeMatchesQuery(node: ProductGraphProjectionNode, query: string) {
  if (!query) return true;
  return [
    node.id,
    node.title,
    node.summary ?? "",
    node.body ?? "",
    node.kind,
    node.status,
    ...(node.tags ?? []),
  ].some((value) => value.toLowerCase().includes(query));
}

export function edgeLabel(edge: ProductGraphEdge) {
  return edge.label || formatLabel(edge.kind);
}

export function traceRelationshipLabelsForNode(trace: ProductGraphTrace, nodeId: string) {
  const rootNodeId = trace.rootNode.id;
  const nodeHop = trace.hopsByNodeId[nodeId] ?? Number.MAX_SAFE_INTEGER;

  return trace.edges
    .flatMap((edge, index) => {
      const isSource = edge.sourceNodeId === nodeId;
      const isTarget = edge.targetNodeId === nodeId;
      if (!isSource && !isTarget) {
        return [];
      }

      const neighborId = isSource ? edge.targetNodeId : edge.sourceNodeId;
      const neighborHop = trace.hopsByNodeId[neighborId] ?? Number.MAX_SAFE_INTEGER;
      const priority =
        neighborId === rootNodeId ? 0 : neighborHop < nodeHop ? 1 : neighborHop === nodeHop ? 2 : 3;

      return [{ edge, index, priority }];
    })
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ edge }) => edgeLabel(edge))
    .slice(0, 3);
}

export function buildNeighborLabel(
  edge: ProductGraphEdge,
  selectedNodeId: string,
  nodesById: Map<string, ProductGraphProjectionNode>
) {
  const neighborId = edge.sourceNodeId === selectedNodeId ? edge.targetNodeId : edge.sourceNodeId;
  return nodesById.get(neighborId)?.title ?? neighborId;
}

export function isTaskBlockedByOpenQuestions(node: ProductGraphProjectionNode) {
  return node.kind === "task" && node.blockedByNodeIds.length > 0;
}

export function isCodeMapNode(node: ProductGraphProjectionNode) {
  return node.kind === "code_file" || node.kind === "code_symbol" || node.kind === "code_community";
}

export function metadataValueText(metadata: ProductGraphProjectionNode["metadata"] | ProductGraphEdge["metadata"], key: string) {
  const value = metadata?.[key];
  if (value === undefined || value === null) return undefined;
  return String(value);
}

export function edgeMetadataText(edge: ProductGraphEdge, key: string) {
  return metadataValueText(edge.metadata, key);
}

export function isSemanticCodeEdge(
  edge: ProductGraphEdge,
  nodesById: Map<string, ProductGraphProjectionNode> = new Map()
) {
  if (!SEMANTIC_CODE_EDGE_KINDS.has(edge.kind)) return false;
  const relation = edgeMetadataText(edge, "scannerRelation");
  const resolution = edgeMetadataText(edge, "scannerResolution");
  if (relation?.startsWith("symbol_") || resolution === "semantic") return true;
  return nodesById.get(edge.sourceNodeId)?.kind === "code_symbol" && nodesById.get(edge.targetNodeId)?.kind === "code_symbol";
}

export function isDependencyCodeEdge(
  edge: ProductGraphEdge,
  nodesById: Map<string, ProductGraphProjectionNode> = new Map()
) {
  if (edge.kind !== "depends_on") return false;
  const relation = edgeMetadataText(edge, "scannerRelation");
  if (relation === "module_dependency" || relation === "module_dependency_cluster") return true;
  const sourceNode = nodesById.get(edge.sourceNodeId);
  const targetNode = nodesById.get(edge.targetNodeId);
  return Boolean(sourceNode && targetNode && isCodeMapNode(sourceNode) && isCodeMapNode(targetNode));
}

export function codeMapFilterAllowsNode(node: ProductGraphProjectionNode, filters: CodeMapFilterState) {
  if (node.kind === "code_file") return filters.files;
  if (node.kind === "code_symbol") return filters.symbols;
  if (node.kind === "code_community") return filters.communities;
  return true;
}

export function codeMapFiltersForFocusedNode(
  node: ProductGraphProjectionNode,
  filters: CodeMapFilterState
): CodeMapFilterState {
  if (node.kind === "code_file" && !filters.files) return { ...filters, files: true };
  if (node.kind === "code_symbol" && !filters.symbols) return { ...filters, symbols: true };
  if (node.kind === "code_community" && !filters.communities) return { ...filters, communities: true };
  return filters;
}

export function codeMapFilterAllowsEdge(
  edge: ProductGraphEdge,
  filters: CodeMapFilterState,
  nodesById: Map<string, ProductGraphProjectionNode> = new Map()
) {
  if (isDependencyCodeEdge(edge, nodesById)) return filters.dependencyEdges;
  if (isSemanticCodeEdge(edge, nodesById)) return filters.semanticEdges;
  return true;
}

export function findLikelyCodeAreasForTask(
  taskNode: ProductGraphProjectionNode | null,
  edges: ProductGraphEdge[],
  nodesById: Map<string, ProductGraphProjectionNode>
) {
  if (!taskNode || taskNode.kind !== "task") return [];

  const codeAreasById = new Map<string, { node: ProductGraphProjectionNode; edge: ProductGraphEdge }>();
  for (const edge of edges) {
    if (!TASK_CODE_EDGE_KINDS.has(edge.kind)) continue;
    if (edge.sourceNodeId !== taskNode.id && edge.targetNodeId !== taskNode.id) continue;

    const neighborId = edge.sourceNodeId === taskNode.id ? edge.targetNodeId : edge.sourceNodeId;
    const neighbor = nodesById.get(neighborId);
    if (!neighbor || !isCodeMapNode(neighbor) || codeAreasById.has(neighbor.id)) continue;

    codeAreasById.set(neighbor.id, { node: neighbor, edge });
  }

  return Array.from(codeAreasById.values()).slice(0, 5);
}

export function findLinkedRunFilesForTask(
  taskNode: ProductGraphProjectionNode | null,
  edges: ProductGraphEdge[],
  nodesById: Map<string, ProductGraphProjectionNode>
) {
  if (!taskNode || taskNode.kind !== "task") return [];

  const runNodesById = new Map<string, ProductGraphProjectionNode>();
  for (const edge of edges) {
    if (edge.kind !== "produced_by" || edge.sourceNodeId !== taskNode.id) continue;

    const runNode = nodesById.get(edge.targetNodeId);
    if (runNode?.kind === "agent_run") {
      runNodesById.set(runNode.id, runNode);
    }
  }

  if (runNodesById.size === 0) return [];

  const filesById = new Map<string, {
    node: ProductGraphProjectionNode;
    edge: ProductGraphEdge;
    runNode: ProductGraphProjectionNode;
  }>();
  for (const edge of edges) {
    if (edge.kind !== "touches") continue;

    const runNode = runNodesById.get(edge.sourceNodeId);
    if (!runNode) continue;

    const fileNode = nodesById.get(edge.targetNodeId);
    if (!fileNode || fileNode.kind !== "code_file" || filesById.has(fileNode.id)) continue;

    filesById.set(fileNode.id, { node: fileNode, edge, runNode });
  }

  return Array.from(filesById.values()).slice(0, LINKED_RUN_FILE_LIMIT);
}

export function findRunsDerivedFromPlan(
  planNode: ProductGraphProjectionNode | null,
  edges: ProductGraphEdge[],
  nodesById: Map<string, ProductGraphProjectionNode>
) {
  if (!planNode || planNode.kind !== "plan") return [];

  const runsById = new Map<string, {
    node: ProductGraphProjectionNode;
    edge: ProductGraphEdge;
  }>();
  for (const edge of edges) {
    if (edge.kind !== "derived_from" || edge.targetNodeId !== planNode.id) continue;

    const runNode = nodesById.get(edge.sourceNodeId);
    if (!runNode || runNode.kind !== "agent_run" || runsById.has(runNode.id)) continue;

    runsById.set(runNode.id, { node: runNode, edge });
  }

  return Array.from(runsById.values()).slice(0, LINKED_PLAN_RUN_LIMIT);
}

export function metadataText(node: ProductGraphProjectionNode, key: string) {
  return metadataValueText(node.metadata, key);
}

export function metadataPercentText(node: ProductGraphProjectionNode, key: string) {
  const value = node.metadata?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return `${Math.round(value * 100)}%`;
}

export function sourcePathLabel(node: ProductGraphProjectionNode) {
  if (!node.source?.path) return undefined;
  return node.source.line ? `${node.source.path}:${node.source.line}` : node.source.path;
}

export function selectedNodeLabel(node: ProductGraphProjectionNode) {
  if (isCodeMapNode(node)) return "Selected code";
  if (node.kind === "agent_run") return "Selected run";
  if (node.kind === "evidence") return "Selected evidence";
  if (node.kind === "plan") return "Selected plan";
  return "Selected intent";
}

export function visibleMetadataItems(items: Array<[string, string | undefined]>): Array<[string, string]> {
  return items.filter((item): item is [string, string] => Boolean(item[1]));
}

export function codeMapNodeDetails(node: ProductGraphProjectionNode): Array<[string, string]> {
  if (node.kind === "code_community") {
    return visibleMetadataItems([
      ["Community", metadataText(node, "scannerCommunityPath")],
      ["Kind", metadataText(node, "scannerCommunityKind")],
      ["Files", metadataText(node, "scannerCommunityFileCount")],
      ["Member files", metadataText(node, "scannerCommunityFiles")],
    ]);
  }
  if (node.kind === "code_file") {
    return visibleMetadataItems([
      ["Source file", metadataText(node, "scannerSourceFile") ?? sourcePathLabel(node)],
      ["Imports", metadataText(node, "scannerImportCount")],
      ["Resolved", metadataText(node, "scannerResolvedDependencyCount")],
      ["External", metadataText(node, "scannerExternalDependencyCount")],
      ["Unresolved", metadataText(node, "scannerUnresolvedDependencyCount")],
      ["Targets", metadataText(node, "scannerDependencyTargets")],
      ["External packages", metadataText(node, "scannerExternalDependencies")],
      ["Unresolved specifiers", metadataText(node, "scannerUnresolvedDependencies")],
    ]);
  }
  if (node.kind === "code_symbol") {
    return visibleMetadataItems([
      ["Source file", metadataText(node, "scannerSourceFile") ?? sourcePathLabel(node)],
      ["Symbol", metadataText(node, "scannerSymbolName")],
      ["Kind", metadataText(node, "scannerSymbolKind")],
      ["Line", metadataText(node, "scannerSymbolLine")],
      ["Methods", metadataText(node, "methodCount")],
      ["Method names", metadataText(node, "methodNames")],
      ["Method details", metadataText(node, "methodDetails")],
      ["Static methods", metadataText(node, "methodStaticNames")],
      ["Async methods", metadataText(node, "methodAsyncNames")],
      ["Method lines", metadataText(node, "methodLines")],
    ]);
  }
  return [];
}

export function codeMapEdgeEndpointLabel(edge: ProductGraphEdge) {
  const sourceSymbol = edgeMetadataText(edge, "scannerSourceSymbol");
  const targetSymbol = edgeMetadataText(edge, "scannerTargetSymbol");
  if (sourceSymbol && targetSymbol) return `${sourceSymbol} -> ${targetSymbol}`;

  const sourceFile = edgeMetadataText(edge, "scannerSourceFile");
  const targetFile = edgeMetadataText(edge, "scannerTargetFile");
  if (sourceFile && targetFile) return `${sourceFile} -> ${targetFile}`;

  return undefined;
}

export function metadataNumberValue(
  metadata: ProductGraphProjectionNode["metadata"] | ProductGraphEdge["metadata"],
  key: string
) {
  const value = metadata?.[key];
  if (typeof value === "number") return positiveFiniteCount(value);
  if (typeof value === "string") return positiveFiniteCount(Number(value));
  return 0;
}

export function codeMapNodeSourceFile(node: ProductGraphProjectionNode | undefined) {
  if (!node) return undefined;
  return metadataValueText(node.metadata, "scannerSourceFile") ?? node.source?.path;
}

export function codeMapFileDependencyCounts(node: ProductGraphProjectionNode | undefined) {
  if (!node) return { external: 0, unresolved: 0 };
  return {
    external: metadataNumberValue(node.metadata, "scannerExternalDependencyCount"),
    unresolved: metadataNumberValue(node.metadata, "scannerUnresolvedDependencyCount"),
  };
}

export function buildCodeMapCommunityFileIds(
  edges: ProductGraphEdge[],
  nodesById: Map<string, ProductGraphProjectionNode>
) {
  const communityFileIds = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.kind !== "belongs_to") continue;
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    if (sourceNode?.kind !== "code_file" || targetNode?.kind !== "code_community") continue;

    const fileIds = communityFileIds.get(targetNode.id) ?? new Set<string>();
    fileIds.add(sourceNode.id);
    communityFileIds.set(targetNode.id, fileIds);
  }
  return communityFileIds;
}

export function buildCodeMapFileCommunityIds(communityFileIds: Map<string, Set<string>>) {
  const fileCommunityIds = new Map<string, Set<string>>();
  for (const [communityId, fileIds] of communityFileIds) {
    for (const fileId of fileIds) {
      const communityIds = fileCommunityIds.get(fileId) ?? new Set<string>();
      communityIds.add(communityId);
      fileCommunityIds.set(fileId, communityIds);
    }
  }
  return fileCommunityIds;
}

export function codeMapCommunityIdsForNode(
  node: ProductGraphProjectionNode | undefined,
  symbolFileIds: Map<string, string>,
  fileCommunityIds: Map<string, Set<string>>
) {
  const communityIds = new Set<string>();
  if (!node) return communityIds;
  if (node.kind === "code_community") communityIds.add(node.id);

  const fileId = codeMapFileIdForNode(node, symbolFileIds);
  if (fileId) {
    for (const communityId of fileCommunityIds.get(fileId) ?? []) {
      communityIds.add(communityId);
    }
  }
  return communityIds;
}

export function incrementCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

export function buildCodeMapSymbolFileIds(
  edges: ProductGraphEdge[],
  nodesById: Map<string, ProductGraphProjectionNode>
) {
  const fileNodesByPath = new Map<string, ProductGraphProjectionNode>();
  const symbolFileIds = new Map<string, string>();
  for (const node of nodesById.values()) {
    if (node.kind !== "code_file") continue;
    const sourceFile = codeMapNodeSourceFile(node);
    if (sourceFile) fileNodesByPath.set(sourceFile, node);
  }

  for (const edge of edges) {
    if (edge.kind !== "belongs_to") continue;
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    if (sourceNode?.kind === "code_symbol" && targetNode?.kind === "code_file") {
      symbolFileIds.set(sourceNode.id, targetNode.id);
    }
  }

  for (const node of nodesById.values()) {
    if (node.kind !== "code_symbol" || symbolFileIds.has(node.id)) continue;
    const sourceFile = codeMapNodeSourceFile(node);
    const fileNode = sourceFile ? fileNodesByPath.get(sourceFile) : undefined;
    if (fileNode) symbolFileIds.set(node.id, fileNode.id);
  }

  return symbolFileIds;
}

export function codeMapFileIdForNode(
  node: ProductGraphProjectionNode | undefined,
  symbolFileIds: Map<string, string>
) {
  if (node?.kind === "code_file") return node.id;
  if (node?.kind === "code_symbol") return symbolFileIds.get(node.id);
  return undefined;
}

export function sortCodeMapNodesByTitle(items: ProductGraphProjectionNode[]) {
  return [...items].sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

export function buildCodeMapFileSymbolIds(symbolFileIds: Map<string, string>) {
  const fileSymbolIds = new Map<string, Set<string>>();
  for (const [symbolId, fileId] of symbolFileIds) {
    const symbolIds = fileSymbolIds.get(fileId) ?? new Set<string>();
    symbolIds.add(symbolId);
    fileSymbolIds.set(fileId, symbolIds);
  }
  return fileSymbolIds;
}

export function addUniqueImpactItem(
  itemsByKey: Map<string, CodeMapImpactItem>,
  node: ProductGraphProjectionNode | undefined,
  edge: ProductGraphEdge,
  relation: string
) {
  if (!node) return;
  const key = `${node.id}:${edge.id}:${relation}`;
  if (itemsByKey.has(key)) return;
  itemsByKey.set(key, { node, edge, relation });
}

export function boundedImpactSection(itemsByKey: Map<string, CodeMapImpactItem>, limit: number): CodeMapImpactSection {
  const items = [...itemsByKey.values()].sort((left, right) =>
    left.node.title.localeCompare(right.node.title) ||
    left.relation.localeCompare(right.relation) ||
    left.edge.id.localeCompare(right.edge.id)
  );
  return {
    items: items.slice(0, limit),
    totalCount: items.length,
  };
}

export function codeMapSelectionScope(
  selectedNode: ProductGraphProjectionNode,
  productGraph: ProductGraphProjection,
  nodesById: Map<string, ProductGraphProjectionNode>,
  symbolFileIds: Map<string, string>
) {
  const communityFileIds = buildCodeMapCommunityFileIds(productGraph.edges, nodesById);
  const fileSymbolIds = buildCodeMapFileSymbolIds(symbolFileIds);
  const fileIds = new Set<string>();
  const symbolIds = new Set<string>();
  const selectedCodeNodeIds = new Set<string>([selectedNode.id]);

  if (selectedNode.kind === "code_file") {
    fileIds.add(selectedNode.id);
  } else if (selectedNode.kind === "code_symbol") {
    symbolIds.add(selectedNode.id);
    const fileId = symbolFileIds.get(selectedNode.id);
    if (fileId) fileIds.add(fileId);
  } else if (selectedNode.kind === "code_community") {
    for (const fileId of communityFileIds.get(selectedNode.id) ?? []) {
      fileIds.add(fileId);
    }
  }

  for (const fileId of fileIds) {
    selectedCodeNodeIds.add(fileId);
    for (const symbolId of fileSymbolIds.get(fileId) ?? []) {
      symbolIds.add(symbolId);
    }
  }
  for (const symbolId of symbolIds) {
    selectedCodeNodeIds.add(symbolId);
  }

  return { fileIds, symbolIds, selectedCodeNodeIds };
}

export function buildCodeMapImpactSummary(
  productGraph: ProductGraphProjection,
  selectedNode: ProductGraphProjectionNode,
  limit = CODE_MAP_IMPACT_SECTION_LIMIT
): CodeMapImpactSummary {
  const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
  const symbolFileIds = buildCodeMapSymbolFileIds(productGraph.edges, nodesById);
  const { fileIds, selectedCodeNodeIds } = codeMapSelectionScope(selectedNode, productGraph, nodesById, symbolFileIds);
  const importsByKey = new Map<string, CodeMapImpactItem>();
  const importedByKey = new Map<string, CodeMapImpactItem>();
  const semanticByKey = new Map<string, CodeMapImpactItem>();
  const evidenceByKey = new Map<string, CodeMapImpactItem>();

  for (const edge of productGraph.edges) {
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);

    if (isDependencyCodeEdge(edge, nodesById)) {
      if (sourceNode?.kind === "code_file" && targetNode?.kind === "code_file") {
        if (fileIds.has(sourceNode.id)) {
          addUniqueImpactItem(importsByKey, targetNode, edge, edgeLabel(edge));
        }
        if (fileIds.has(targetNode.id)) {
          addUniqueImpactItem(importedByKey, sourceNode, edge, edgeLabel(edge));
        }
      }
      continue;
    }

    if (isSemanticCodeEdge(edge, nodesById)) {
      const sourceSelected = selectedCodeNodeIds.has(edge.sourceNodeId);
      const targetSelected = selectedCodeNodeIds.has(edge.targetNodeId);
      const sourceFileId = codeMapFileIdForNode(sourceNode, symbolFileIds);
      const targetFileId = codeMapFileIdForNode(targetNode, symbolFileIds);
      const sourceFileSelected = Boolean(sourceFileId && fileIds.has(sourceFileId));
      const targetFileSelected = Boolean(targetFileId && fileIds.has(targetFileId));

      if (sourceSelected || sourceFileSelected) {
        addUniqueImpactItem(semanticByKey, targetNode, edge, edgeMetadataText(edge, "scannerRelation") ?? edgeLabel(edge));
      }
      if (targetSelected || targetFileSelected) {
        addUniqueImpactItem(semanticByKey, sourceNode, edge, edgeMetadataText(edge, "scannerRelation") ?? edgeLabel(edge));
      }
      continue;
    }

    if (edge.kind !== "touches" && edge.kind !== "implements") continue;

    const sourceSelected = selectedCodeNodeIds.has(edge.sourceNodeId);
    const targetSelected = selectedCodeNodeIds.has(edge.targetNodeId);
    if (sourceSelected && targetNode && !isCodeMapNode(targetNode)) {
      addUniqueImpactItem(evidenceByKey, targetNode, edge, edgeLabel(edge));
    }
    if (targetSelected && sourceNode && !isCodeMapNode(sourceNode)) {
      addUniqueImpactItem(evidenceByKey, sourceNode, edge, edgeLabel(edge));
    }
  }

  return {
    imports: boundedImpactSection(importsByKey, limit),
    importedBy: boundedImpactSection(importedByKey, limit),
    semanticRelationships: boundedImpactSection(semanticByKey, limit),
    linkedEvidence: boundedImpactSection(evidenceByKey, limit),
  };
}

export function buildCodeMapImpactPathPreview(
  productGraph: ProductGraphProjection,
  selectedNode: ProductGraphProjectionNode,
  limit = CODE_MAP_IMPACT_PATH_LIMIT
): CodeMapImpactPathPreview {
  const impact = buildCodeMapImpactSummary(productGraph, selectedNode, limit);
  return {
    upstreamFiles: impact.importedBy,
    downstreamFiles: impact.imports,
    linkedEvidence: impact.linkedEvidence,
  };
}

export function canonicalCycleKey(nodeIds: string[]) {
  let bestRotation = nodeIds;
  for (let index = 1; index < nodeIds.length; index += 1) {
    const rotation = [...nodeIds.slice(index), ...nodeIds.slice(0, index)];
    if (rotation.join("\u0000") < bestRotation.join("\u0000")) {
      bestRotation = rotation;
    }
  }
  return bestRotation.join(">");
}

export function buildCodeMapDependencyCycleSummary(
  productGraph: ProductGraphProjection,
  limit = CODE_MAP_CYCLE_LIMIT
): { cycles: CodeMapDependencyCycle[]; hasMore: boolean; searchLimited: boolean } {
  const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Array<{ targetNodeId: string; edgeId: string }>>();
  for (const edge of productGraph.edges) {
    if (!isDependencyCodeEdge(edge, nodesById)) continue;
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    if (sourceNode?.kind !== "code_file" || targetNode?.kind !== "code_file") continue;

    const targets = adjacency.get(sourceNode.id) ?? [];
    targets.push({ targetNodeId: targetNode.id, edgeId: edge.id });
    adjacency.set(sourceNode.id, targets);
  }

  for (const targets of adjacency.values()) {
    targets.sort((left, right) =>
      (nodesById.get(left.targetNodeId)?.title ?? left.targetNodeId).localeCompare(
        nodesById.get(right.targetNodeId)?.title ?? right.targetNodeId
      ) || left.edgeId.localeCompare(right.edgeId)
    );
  }

  const cyclesByKey = new Map<string, CodeMapDependencyCycle>();
  let visitCount = 0;
  let visitLimitReached = false;
  const fileIds = productGraph.nodes
    .filter((node) => node.kind === "code_file")
    .map((node) => node.id)
    .sort((left, right) =>
      (nodesById.get(left)?.title ?? left).localeCompare(nodesById.get(right)?.title ?? right) || left.localeCompare(right)
    );

  function visit(startNodeId: string, currentNodeId: string, pathNodeIds: string[], pathEdgeIds: string[]) {
    if (visitLimitReached || pathNodeIds.length > CODE_MAP_CYCLE_MAX_DEPTH || cyclesByKey.size > limit) return;
    visitCount += 1;
    if (visitCount > CODE_MAP_CYCLE_VISIT_LIMIT) {
      visitLimitReached = true;
      return;
    }

    for (const next of adjacency.get(currentNodeId) ?? []) {
      if (visitLimitReached) return;
      if (next.targetNodeId === startNodeId) {
        const cycleNodeIds = [...pathNodeIds];
        const key = canonicalCycleKey(cycleNodeIds);
        if (!cyclesByKey.has(key)) {
          const nodes = cycleNodeIds
            .map((nodeId) => nodesById.get(nodeId))
            .filter((node): node is ProductGraphProjectionNode => Boolean(node));
          cyclesByKey.set(key, {
            nodeIds: cycleNodeIds,
            nodes,
            edgeIds: [...pathEdgeIds, next.edgeId],
          });
        }
        if (cyclesByKey.size > limit) return;
        continue;
      }

      if (pathNodeIds.includes(next.targetNodeId)) continue;
      visit(startNodeId, next.targetNodeId, [...pathNodeIds, next.targetNodeId], [...pathEdgeIds, next.edgeId]);
    }
  }

  for (const fileId of fileIds) {
    if (visitLimitReached || cyclesByKey.size > limit) break;
    visit(fileId, fileId, [fileId], []);
  }

  const sortedCycles = [...cyclesByKey.values()].sort((left, right) =>
    left.nodeIds.length - right.nodeIds.length ||
    left.nodes.map((node) => node.title).join(">").localeCompare(right.nodes.map((node) => node.title).join(">"))
  );

  return {
    cycles: sortedCycles.slice(0, limit),
    hasMore: sortedCycles.length > limit,
    searchLimited: visitLimitReached,
  };
}

export function detectCodeMapDependencyCycles(
  productGraph: ProductGraphProjection,
  limit = CODE_MAP_CYCLE_LIMIT
): CodeMapDependencyCycle[] {
  return buildCodeMapDependencyCycleSummary(productGraph, limit).cycles;
}

export function buildCodeMapLinkedCodeIds(
  productGraph: ProductGraphProjection,
  nodesById: Map<string, ProductGraphProjectionNode>,
  symbolFileIds: Map<string, string>
) {
  const linkedCodeIds = new Set<string>();

  for (const edge of productGraph.edges) {
    if (edge.kind === "belongs_to") continue;
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    if (!sourceNode || !targetNode) continue;

    if (isDependencyCodeEdge(edge, nodesById) || isSemanticCodeEdge(edge, nodesById)) {
      if (isCodeMapNode(sourceNode)) linkedCodeIds.add(sourceNode.id);
      if (isCodeMapNode(targetNode)) linkedCodeIds.add(targetNode.id);
      const sourceFileId = codeMapFileIdForNode(sourceNode, symbolFileIds);
      const targetFileId = codeMapFileIdForNode(targetNode, symbolFileIds);
      if (sourceFileId) linkedCodeIds.add(sourceFileId);
      if (targetFileId) linkedCodeIds.add(targetFileId);
      continue;
    }

    if (isCodeMapNode(sourceNode) && !isCodeMapNode(targetNode)) linkedCodeIds.add(sourceNode.id);
    if (isCodeMapNode(targetNode) && !isCodeMapNode(sourceNode)) linkedCodeIds.add(targetNode.id);
    const sourceFileId = codeMapFileIdForNode(sourceNode, symbolFileIds);
    const targetFileId = codeMapFileIdForNode(targetNode, symbolFileIds);
    if (sourceFileId && !isCodeMapNode(targetNode)) linkedCodeIds.add(sourceFileId);
    if (targetFileId && !isCodeMapNode(sourceNode)) linkedCodeIds.add(targetFileId);
  }

  return linkedCodeIds;
}

export function findCodeMapOrphanFiles(
  productGraph: ProductGraphProjection,
  limit = CODE_MAP_HEALTH_ITEM_LIMIT
) {
  const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
  const symbolFileIds = buildCodeMapSymbolFileIds(productGraph.edges, nodesById);
  const fileSymbolIds = buildCodeMapFileSymbolIds(symbolFileIds);
  const linkedCodeIds = buildCodeMapLinkedCodeIds(productGraph, nodesById, symbolFileIds);
  const orphanFiles: ProductGraphProjectionNode[] = [];

  for (const node of productGraph.nodes) {
    if (node.kind !== "code_file") continue;
    const symbolIds = fileSymbolIds.get(node.id) ?? new Set<string>();
    const hasLinkedSymbol = [...symbolIds].some((symbolId) => linkedCodeIds.has(symbolId));
    if (!linkedCodeIds.has(node.id) && !hasLinkedSymbol) {
      orphanFiles.push(node);
    }
  }

  const sortedOrphanFiles = orphanFiles.sort((left, right) =>
    left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
  );
  return {
    orphanFiles: sortedOrphanFiles.slice(0, limit),
    orphanFileCount: sortedOrphanFiles.length,
  };
}

export function buildCodeMapArchitectureHealth(
  productGraph: ProductGraphProjection,
  freshnessHealth: ProductGraphCodeScanFreshnessSummary,
  limit = CODE_MAP_HEALTH_ITEM_LIMIT
): CodeMapArchitectureHealth {
  const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
  const dependencyCycleSummary = buildCodeMapDependencyCycleSummary(productGraph, limit);
  const externalFiles: ProductGraphProjectionNode[] = [];
  const unresolvedFiles: ProductGraphProjectionNode[] = [];
  const orphanSummary = findCodeMapOrphanFiles(productGraph, limit);

  for (const node of productGraph.nodes) {
    if (node.kind !== "code_file") continue;
    const counts = codeMapFileDependencyCounts(node);
    if (counts.external > 0) externalFiles.push(node);
    if (counts.unresolved > 0) unresolvedFiles.push(node);
  }

  const sortByTitle = (items: ProductGraphProjectionNode[]) =>
    [...items].sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));

  const staleCodeNodes = freshnessHealth.codeGaps.map((gap) => gap.codeNode);
  return {
    dependencyCycles: dependencyCycleSummary.cycles,
    dependencyCycleCount: dependencyCycleSummary.cycles.length,
    hasMoreDependencyCycles: dependencyCycleSummary.hasMore,
    dependencyCycleSearchLimited: dependencyCycleSummary.searchLimited,
    unresolvedFiles: sortByTitle(unresolvedFiles).slice(0, limit),
    unresolvedFileCount: unresolvedFiles.length,
    externalFiles: sortByTitle(externalFiles).slice(0, limit),
    externalFileCount: externalFiles.length,
    orphanFiles: orphanSummary.orphanFiles,
    orphanFileCount: orphanSummary.orphanFileCount,
    staleCodeNodes: sortByTitle(staleCodeNodes).slice(0, limit),
    staleCodeNodeCount: freshnessHealth.codeNodesChangedAfterCodeScanCount,
  };
}

export function buildCodeMapCommunitySummaries(
  productGraph: ProductGraphProjection,
  limit = CODE_MAP_COMMUNITY_SUMMARY_LIMIT
): CodeMapCommunitySummary[] {
  const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
  const communityFileIds = buildCodeMapCommunityFileIds(productGraph.edges, nodesById);
  const fileCommunityIds = buildCodeMapFileCommunityIds(communityFileIds);
  const symbolFileIds = buildCodeMapSymbolFileIds(productGraph.edges, nodesById);
  const dependencyEdges = productGraph.edges.filter((edge) => isDependencyCodeEdge(edge, nodesById));
  const semanticEdges = productGraph.edges.filter((edge) => isSemanticCodeEdge(edge, nodesById));
  const dependencyCountsByCommunityId = new Map<string, number>();
  const semanticCountsByCommunityId = new Map<string, number>();

  for (const edge of dependencyEdges) {
    const affectedCommunityIds = new Set([
      ...codeMapCommunityIdsForNode(nodesById.get(edge.sourceNodeId), symbolFileIds, fileCommunityIds),
      ...codeMapCommunityIdsForNode(nodesById.get(edge.targetNodeId), symbolFileIds, fileCommunityIds),
    ]);
    for (const communityId of affectedCommunityIds) {
      incrementCount(dependencyCountsByCommunityId, communityId);
    }
  }

  for (const edge of semanticEdges) {
    const affectedCommunityIds = new Set([
      ...codeMapCommunityIdsForNode(nodesById.get(edge.sourceNodeId), symbolFileIds, fileCommunityIds),
      ...codeMapCommunityIdsForNode(nodesById.get(edge.targetNodeId), symbolFileIds, fileCommunityIds),
    ]);
    for (const communityId of affectedCommunityIds) {
      incrementCount(semanticCountsByCommunityId, communityId);
    }
  }

  return productGraph.nodes
    .filter((node): node is ProductGraphProjectionNode => node.kind === "code_community")
    .map((node) => {
      const memberFileIds = communityFileIds.get(node.id) ?? new Set<string>();
      const metadataFileCount = metadataNumberValue(node.metadata, "scannerCommunityFileCount");
      let externalDependencyCount = metadataNumberValue(node.metadata, "scannerExternalDependencyCount");
      let unresolvedDependencyCount = metadataNumberValue(node.metadata, "scannerUnresolvedDependencyCount");

      for (const fileId of memberFileIds) {
        const counts = codeMapFileDependencyCounts(nodesById.get(fileId));
        externalDependencyCount += counts.external;
        unresolvedDependencyCount += counts.unresolved;
      }

      return {
        node,
        fileCount: metadataFileCount || memberFileIds.size,
        dependencyCount: dependencyCountsByCommunityId.get(node.id) ?? 0,
        semanticLinkCount: semanticCountsByCommunityId.get(node.id) ?? 0,
        externalDependencyCount,
        unresolvedDependencyCount,
      };
    })
    .sort((left, right) =>
      right.fileCount - left.fileCount ||
      right.dependencyCount - left.dependencyCount ||
      right.semanticLinkCount - left.semanticLinkCount ||
      left.node.title.localeCompare(right.node.title)
    )
    .slice(0, limit);
}

export function buildCodeMapCommunityGroups(
  productGraph: ProductGraphProjection,
  limit = CODE_MAP_COMMUNITY_SUMMARY_LIMIT,
  fileLimit = CODE_MAP_COMMUNITY_GROUP_FILE_LIMIT
): CodeMapCommunityGroup[] {
  const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
  const communityFileIds = buildCodeMapCommunityFileIds(productGraph.edges, nodesById);
  return buildCodeMapCommunitySummaries(productGraph, limit).map((summary) => {
    const files = sortCodeMapNodesByTitle(
      [...(communityFileIds.get(summary.node.id) ?? [])]
        .map((fileId) => nodesById.get(fileId))
        .filter((node): node is ProductGraphProjectionNode => Boolean(node && node.kind === "code_file"))
    );

    return {
      summary,
      files: files.slice(0, fileLimit),
      hiddenFileCount: Math.max(0, files.length - fileLimit),
    };
  });
}

export function findCodeMapDependencyIssueFiles(
  productGraph: ProductGraphProjection,
  issue: "external" | "unresolved",
  limit = CODE_MAP_HEALTH_ITEM_LIMIT
) {
  const files = sortCodeMapNodesByTitle(productGraph.nodes.filter((node): node is ProductGraphProjectionNode => {
    if (node.kind !== "code_file") return false;
    const counts = codeMapFileDependencyCounts(node);
    return issue === "external" ? counts.external > 0 : counts.unresolved > 0;
  }));

  return {
    files: files.slice(0, limit),
    totalCount: files.length,
  };
}

export function addCodeMapExplorerEdgeScope(
  edge: ProductGraphEdge,
  nodesById: Map<string, ProductGraphProjectionNode>,
  symbolFileIds: Map<string, string>,
  scopeNodeIds: Set<string>,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
  addNodeId: (nodeId: string) => boolean
) {
  const sourceNode = nodesById.get(edge.sourceNodeId);
  const targetNode = nodesById.get(edge.targetNodeId);
  if (!sourceNode || !targetNode) return;

  const sourceFileId = codeMapFileIdForNode(sourceNode, symbolFileIds);
  const targetFileId = codeMapFileIdForNode(targetNode, symbolFileIds);
  const sourceInScope = scopeNodeIds.has(edge.sourceNodeId) || Boolean(sourceFileId && scopeNodeIds.has(sourceFileId));
  const targetInScope = scopeNodeIds.has(edge.targetNodeId) || Boolean(targetFileId && scopeNodeIds.has(targetFileId));

  if (!sourceInScope && !targetInScope) return;
  if (edge.kind === "belongs_to" && (!sourceInScope || !targetInScope)) return;

  if (isCodeMapNode(sourceNode)) addNodeId(sourceNode.id);
  if (isCodeMapNode(targetNode)) addNodeId(targetNode.id);
  if (sourceFileId) addNodeId(sourceFileId);
  if (targetFileId) addNodeId(targetFileId);
  if (nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)) edgeIds.add(edge.id);
}

export function buildCodeMapExplorerView(
  productGraph: ProductGraphProjection,
  selection: CodeMapExplorerSelection,
  limit = CODE_MAP_HEALTH_ITEM_LIMIT
): CodeMapExplorerView | null {
  const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
  const symbolFileIds = buildCodeMapSymbolFileIds(productGraph.edges, nodesById);
  const fileSymbolIds = buildCodeMapFileSymbolIds(symbolFileIds);
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const highlightedNodeIds = new Set<string>();
  const hiddenNodeIds = new Set<string>();
  let itemNodes: ProductGraphProjectionNode[] = [];
  let hiddenItemCount = 0;
  let title = "";
  let detail = "";
  let focusNodeId: string | undefined;
  const addNodeId = (nodeId: string) => {
    if (nodeIds.has(nodeId)) return true;
    if (nodeIds.size < CODE_MAP_EXPLORER_RENDER_NODE_LIMIT) {
      nodeIds.add(nodeId);
      return true;
    }
    hiddenNodeIds.add(nodeId);
    return false;
  };

  if (selection.mode === "community") {
    const group = buildCodeMapCommunityGroups(productGraph, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
      .find((candidate) => candidate.summary.node.id === selection.communityNodeId);
    if (!group) return null;

    title = `Community: ${group.summary.node.title}`;
    detail = `${pluralizeCount(group.summary.fileCount, "file")} · ${pluralizeCount(
      group.summary.dependencyCount,
      "dependency"
    )} · ${pluralizeCount(group.summary.semanticLinkCount, "semantic link")}`;
    focusNodeId = group.summary.node.id;
    addNodeId(group.summary.node.id);
    for (const file of group.files) {
      addNodeId(file.id);
      for (const symbolId of fileSymbolIds.get(file.id) ?? []) {
        addNodeId(symbolId);
      }
    }
    itemNodes = group.files.slice(0, limit);
    hiddenItemCount = Math.max(0, group.files.length - limit);
  } else if (selection.mode === "cycle") {
    const cycle = detectCodeMapDependencyCycles(productGraph, CODE_MAP_CYCLE_LIMIT)[selection.cycleIndex];
    if (!cycle) return null;

    title = "Dependency cycle";
    detail = cycle.nodes.map((node) => node.title).join(" -> ");
    focusNodeId = cycle.nodeIds[0];
    for (const nodeId of cycle.nodeIds) {
      if (addNodeId(nodeId)) highlightedNodeIds.add(nodeId);
    }
    for (const edgeId of cycle.edgeIds) {
      edgeIds.add(edgeId);
    }
    itemNodes = cycle.nodes.slice(0, limit);
    hiddenItemCount = Math.max(0, cycle.nodes.length - limit);
  } else {
    const group = selection.mode === "orphans"
      ? (() => {
          const orphanSummary = findCodeMapOrphanFiles(productGraph, Number.POSITIVE_INFINITY);
          return { files: orphanSummary.orphanFiles, totalCount: orphanSummary.orphanFileCount };
        })()
      : findCodeMapDependencyIssueFiles(productGraph, selection.mode, Number.POSITIVE_INFINITY);

    title = selection.mode === "orphans"
      ? "Orphan files"
      : selection.mode === "external"
        ? "External package usage"
        : "Unresolved dependencies";
    detail = `${pluralizeCount(group.totalCount, "file")} in this drilldown`;
    itemNodes = group.files.slice(0, limit);
    hiddenItemCount = Math.max(0, group.files.length - limit);
    focusNodeId = group.files[0]?.id;
    for (const file of group.files) {
      if (addNodeId(file.id)) highlightedNodeIds.add(file.id);
    }
  }

  if (selection.mode !== "cycle") {
    const scopeNodeIds = new Set(nodeIds);
    for (const edge of productGraph.edges) {
      if (isDependencyCodeEdge(edge, nodesById) || isSemanticCodeEdge(edge, nodesById) || edge.kind === "belongs_to") {
        addCodeMapExplorerEdgeScope(edge, nodesById, symbolFileIds, scopeNodeIds, nodeIds, edgeIds, addNodeId);
      }
    }
  }

  return {
    selection,
    title,
    detail,
    nodeIds,
    edgeIds,
    highlightedNodeIds,
    itemNodes,
    hiddenItemCount,
    hiddenNodeCount: hiddenNodeIds.size,
    focusNodeId,
  };
}

export function buildCodeMapDependencyHotspots(
  productGraph: ProductGraphProjection,
  limit = CODE_MAP_HOTSPOT_LIMIT
): CodeMapDependencyHotspot[] {
  const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
  const symbolFileIds = buildCodeMapSymbolFileIds(productGraph.edges, nodesById);
  const hotspotsByFileId = new Map<string, CodeMapDependencyHotspot>();

  for (const node of productGraph.nodes) {
    if (node.kind !== "code_file") continue;
    const counts = codeMapFileDependencyCounts(node);
    hotspotsByFileId.set(node.id, {
      node,
      importsCount: 0,
      importedByCount: 0,
      semanticRelationshipCount: 0,
      externalDependencyCount: counts.external,
      unresolvedDependencyCount: counts.unresolved,
      score: 0,
    });
  }

  for (const edge of productGraph.edges) {
    if (isDependencyCodeEdge(edge, nodesById)) {
      const sourceNode = nodesById.get(edge.sourceNodeId);
      const targetNode = nodesById.get(edge.targetNodeId);
      if (sourceNode?.kind === "code_file") {
        const hotspot = hotspotsByFileId.get(sourceNode.id);
        if (hotspot) hotspot.importsCount += 1;
      }
      if (targetNode?.kind === "code_file") {
        const hotspot = hotspotsByFileId.get(targetNode.id);
        if (hotspot) hotspot.importedByCount += 1;
      }
    }

    if (isSemanticCodeEdge(edge, nodesById)) {
      const sourceFileId = codeMapFileIdForNode(nodesById.get(edge.sourceNodeId), symbolFileIds);
      const targetFileId = codeMapFileIdForNode(nodesById.get(edge.targetNodeId), symbolFileIds);
      for (const fileId of new Set([sourceFileId, targetFileId].filter((value): value is string => Boolean(value)))) {
        const hotspot = hotspotsByFileId.get(fileId);
        if (hotspot) hotspot.semanticRelationshipCount += 1;
      }
    }
  }

  return [...hotspotsByFileId.values()]
    .map((hotspot) => ({
      ...hotspot,
      score: hotspot.importsCount + hotspot.importedByCount + hotspot.semanticRelationshipCount,
    }))
    .filter((hotspot) => hotspot.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      right.importsCount + right.importedByCount - (left.importsCount + left.importedByCount) ||
      right.semanticRelationshipCount - left.semanticRelationshipCount ||
      left.node.title.localeCompare(right.node.title)
    )
    .slice(0, limit);
}

export function buildCodeMapQuickFilterNodeIds(
  productGraph: ProductGraphProjection,
  quickFilter: CodeMapQuickFilter,
  freshnessHealth: ProductGraphCodeScanFreshnessSummary
) {
  const nodeIds = new Set<string>();
  if (quickFilter === "all") return nodeIds;

  const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
  if (quickFilter === "dependencies") {
    for (const edge of productGraph.edges) {
      if (!isDependencyCodeEdge(edge, nodesById)) continue;
      const sourceNode = nodesById.get(edge.sourceNodeId);
      const targetNode = nodesById.get(edge.targetNodeId);
      if (sourceNode?.kind === "code_file" || sourceNode?.kind === "code_symbol") nodeIds.add(sourceNode.id);
      if (targetNode?.kind === "code_file" || targetNode?.kind === "code_symbol") nodeIds.add(targetNode.id);
    }
    for (const summary of buildCodeMapCommunitySummaries(productGraph, Number.POSITIVE_INFINITY)) {
      if (summary.dependencyCount > 0) nodeIds.add(summary.node.id);
    }
    return nodeIds;
  }

  if (quickFilter === "semantic") {
    for (const edge of productGraph.edges) {
      if (!isSemanticCodeEdge(edge, nodesById)) continue;
      const sourceNode = nodesById.get(edge.sourceNodeId);
      const targetNode = nodesById.get(edge.targetNodeId);
      if (sourceNode?.kind === "code_symbol") nodeIds.add(sourceNode.id);
      if (targetNode?.kind === "code_symbol") nodeIds.add(targetNode.id);
    }
    return nodeIds;
  }

  if (quickFilter === "cycles") {
    for (const cycle of detectCodeMapDependencyCycles(productGraph)) {
      for (const nodeId of cycle.nodeIds) {
        nodeIds.add(nodeId);
      }
    }
    return nodeIds;
  }

  if (quickFilter === "external" || quickFilter === "unresolved") {
    for (const node of productGraph.nodes) {
      if (node.kind === "code_file") {
        const counts = codeMapFileDependencyCounts(node);
        if (quickFilter === "external" && counts.external > 0) nodeIds.add(node.id);
        if (quickFilter === "unresolved" && counts.unresolved > 0) nodeIds.add(node.id);
      }
    }
    for (const summary of buildCodeMapCommunitySummaries(productGraph, Number.POSITIVE_INFINITY)) {
      if (quickFilter === "external" && summary.externalDependencyCount > 0) nodeIds.add(summary.node.id);
      if (quickFilter === "unresolved" && summary.unresolvedDependencyCount > 0) nodeIds.add(summary.node.id);
    }
    return nodeIds;
  }

  if (quickFilter === "orphans") {
    const orphanSummary = findCodeMapOrphanFiles(productGraph, Number.POSITIVE_INFINITY);
    for (const node of orphanSummary.orphanFiles) {
      nodeIds.add(node.id);
    }
    return nodeIds;
  }

  for (const gap of freshnessHealth.codeGaps) {
    nodeIds.add(gap.codeNode.id);
  }
  return nodeIds;
}

export function codeMapQuickFilterAllowsNode(
  node: ProductGraphProjectionNode,
  quickFilter: CodeMapQuickFilter,
  nodeIds: Set<string>
) {
  return quickFilter === "all" || nodeIds.has(node.id);
}

export function codeMapTaskScopeAllowsNode(
  node: ProductGraphProjectionNode,
  taskScope: ProductGraphTaskScopeId,
  nodeIds: Set<string>
) {
  return taskScope === "all" || !isCodeMapNode(node) || nodeIds.has(node.id);
}

export function codeMapTaskScopeAllowsEdge(
  edge: ProductGraphEdge,
  nodesById: Map<string, ProductGraphProjectionNode>,
  taskScope: ProductGraphTaskScopeId,
  nodeIds: Set<string>
) {
  if (taskScope === "all") return true;
  const sourceNode = nodesById.get(edge.sourceNodeId);
  const targetNode = nodesById.get(edge.targetNodeId);
  const codeEndpoints = [sourceNode, targetNode].filter((node): node is ProductGraphProjectionNode =>
    Boolean(node && isCodeMapNode(node))
  );
  return codeEndpoints.length === 0 || codeEndpoints.some((node) => nodeIds.has(node.id));
}

export function codeMapEdgeDetails(edge: ProductGraphEdge): Array<[string, string]> {
  return visibleMetadataItems([
    ["Relation", edgeMetadataText(edge, "scannerRelation")],
    ["Resolution", edgeMetadataText(edge, "scannerResolution")],
    ["Source file", edgeMetadataText(edge, "scannerSourceFile")],
    ["Target file", edgeMetadataText(edge, "scannerTargetFile")],
    ["Source symbol", edgeMetadataText(edge, "scannerSourceSymbol")],
    ["Target symbol", edgeMetadataText(edge, "scannerTargetSymbol")],
    ["Line", edge.source?.line ? String(edge.source.line) : edgeMetadataText(edge, "scannerDependencyLine")],
    ["Specifier", edgeMetadataText(edge, "scannerDependencySpecifiers")],
    ["Dependency count", edgeMetadataText(edge, "scannerDependencyCount")],
    ["Dependency kinds", edgeMetadataText(edge, "scannerDependencyKinds")],
  ]);
}

export function pluralizeCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatScanBytes(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 MB";
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatScanEta(etaMs: number | undefined) {
  if (!etaMs || !Number.isFinite(etaMs) || etaMs <= 0) return "ETA unknown";
  if (etaMs < 1_000) return "ETA <1s";
  const seconds = Math.round(etaMs / 1_000);
  if (seconds < 60) return `ETA ${seconds}s`;
  return `ETA ${Math.round(seconds / 60)}m`;
}

export function formatScanProgressLine(progress: ScanProgressSnapshot | null | undefined) {
  if (!progress) return "";
  const phase = progress.phase.replace(/_/g, " ");
  const breakerCopy =
    progress.breakers.state === "hit"
      ? "breaker hit"
      : progress.breakers.state === "near"
        ? "near breaker"
        : "breakers ok";
  return [
    phase,
    `${progress.filesScanned} files`,
    formatScanBytes(progress.bytesScanned),
    `${progress.filesPerSecond.toFixed(1)} files/s`,
    `${progress.megabytesPerSecond.toFixed(1)} MB/s`,
    formatScanEta(progress.etaMs),
    breakerCopy,
  ].join(" · ");
}

export function scanBreakerWarning(progress: ScanProgressSnapshot | null | undefined) {
  if (!progress || progress.breakers.state === "ok") return "";
  const alert = progress.breakers.hits[0] ?? progress.breakers.near[0];
  return alert?.message ?? "The scan is near a configured emergency breaker.";
}

export function positiveFiniteCount(count: number) {
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function selectProductGraphNode(
  visibleNodes: ProductGraphProjectionNode[],
  selectedNodeId: string | null
) {
  return visibleNodes.find((node) => node.id === selectedNodeId) ?? visibleNodes[0] ?? null;
}

export function productKindFilterForNode(node: ProductGraphProjectionNode): ProductKindFilter {
  return KIND_FILTERS.some((filter) => filter.value === node.kind) ? node.kind : "all";
}

export function productGraphFocusStateForNode(node: ProductGraphProjectionNode) {
  return {
    query: "",
    kindFilter: productKindFilterForNode(node),
    statusFilter: "all" as ProductStatusFilter,
    selectedNodeId: node.id,
    codeMapQuickFilter: "all" as CodeMapQuickFilter,
  };
}

export function formatSpecKitImportResult(result: ImportProductGraphSpecKitResult) {
  const imported = result.imported;
  return [
    pluralizeCount(imported.nodeCount, "node"),
    pluralizeCount(imported.edgeCount, "link"),
    pluralizeCount(imported.specFileCount, "spec"),
    pluralizeCount(imported.taskFileCount, "task file"),
    pluralizeCount(imported.contractFileCount, "contract file"),
  ].join(", ");
}

export function formatCodebaseScanResult(result: ScanProductGraphCodebaseResult) {
  const scanned = result.scanned;
  const skippedFileCount = positiveFiniteCount(scanned.skippedFileCount);
  const skippedDirectoryCount = positiveFiniteCount(scanned.skippedDirectoryCount);
  const communityCount = positiveFiniteCount(scanned.communityCount ?? 0);
  const dependencyEdgeCount = positiveFiniteCount(scanned.dependencyEdgeCount ?? 0);
  const externalDependencyCount = positiveFiniteCount(scanned.externalDependencyCount ?? 0);
  const unresolvedDependencyCount = positiveFiniteCount(scanned.unresolvedDependencyCount ?? 0);
  const semanticEdgeCount = positiveFiniteCount(scanned.semanticEdgeCount ?? 0);
  const semanticResolutionCount = positiveFiniteCount(scanned.semanticResolutionCount ?? 0);
  const semanticConfigCount = positiveFiniteCount(scanned.semanticConfigCount ?? 0);
  const semanticConfiguredFileCount = positiveFiniteCount(scanned.semanticConfiguredFileCount ?? 0);
  const semanticSyntheticFileCount = positiveFiniteCount(scanned.semanticSyntheticFileCount ?? 0);
  const semanticUnconfiguredFileCount = positiveFiniteCount(scanned.semanticUnconfiguredFileCount ?? 0);
  const archivedCount = positiveFiniteCount(scanned.archivedNodeCount) + positiveFiniteCount(scanned.archivedEdgeCount);
  const summary = [
    pluralizeCount(scanned.fileCount, "file"),
    pluralizeCount(scanned.symbolCount, "symbol"),
    pluralizeCount(scanned.edgeCount, "link"),
  ];
  if (communityCount > 0) {
    summary.push(pluralizeCount(communityCount, "community"));
  }
  if (dependencyEdgeCount > 0) {
    summary.push(pluralizeCount(dependencyEdgeCount, "dependency link"));
  }
  if (externalDependencyCount > 0) {
    summary.push(pluralizeCount(externalDependencyCount, "external dependency"));
  }
  if (semanticEdgeCount > 0) {
    summary.push(pluralizeCount(semanticEdgeCount, "semantic link"));
  }
  if (semanticResolutionCount > 0) {
    summary.push(pluralizeCount(semanticResolutionCount, "semantic resolution"));
  }
  if (semanticConfigCount > 0) {
    summary.push(pluralizeCount(semanticConfigCount, "semantic config"));
  }
  if (semanticConfiguredFileCount > 0) {
    summary.push(pluralizeCount(semanticConfiguredFileCount, "file covered by TS config", "files covered by TS config"));
  }
  if (semanticSyntheticFileCount > 0) {
    summary.push(pluralizeCount(semanticSyntheticFileCount, "file covered by synthetic semantic fallback", "files covered by synthetic semantic fallback"));
  }
  if (semanticUnconfiguredFileCount > 0) {
    summary.push(pluralizeCount(semanticUnconfiguredFileCount, "file without semantic coverage", "files without semantic coverage"));
  }
  if (unresolvedDependencyCount > 0) {
    summary.push(pluralizeCount(unresolvedDependencyCount, "unresolved dependency"));
  }
  if (scanned.semanticAnalysisSucceeded === false) {
    summary.push(scanned.semanticAnalysisEnabled === false ? "semantic not run" : "semantic fallback");
  }
  if (skippedFileCount > 0) {
    summary.push(pluralizeCount(skippedFileCount, "skipped file"));
  }
  if (skippedDirectoryCount > 0) {
    summary.push(pluralizeCount(skippedDirectoryCount, "skipped folder"));
  }
  if (archivedCount > 0) {
    summary.push(pluralizeCount(archivedCount, "archived stale item"));
  }
  if (scanned.partial) {
    summary.push("partial scan");
  }
  return summary.join(", ");
}

export function formatCodebaseScanSkippedRelationshipGuidance(result: ScanProductGraphCodebaseResult) {
  if (!result.scanned.partial) return "";
  const breakerHit = result.scanned.breakers?.lightweight.hits[0]?.message ?? result.scanned.diagnostics?.[0];
  return breakerHit
    ? `The scan reached an emergency breaker: ${breakerHit}`
    : "The scan reached a configured safety cap, so some files were skipped. Review skipped counts and scan again after narrowing generated output.";
}

export function formatCodebaseScanSemanticFallbackGuidance(result: ScanProductGraphCodebaseResult) {
  const scanned = result.scanned;
  const hasSemanticSignal = typeof scanned.semanticAnalysisEnabled === "boolean" ||
    typeof scanned.semanticAnalysisSucceeded === "boolean" ||
    Boolean(scanned.semanticFallbackReason?.trim());
  if (!hasSemanticSignal || scanned.semanticAnalysisSucceeded) return "";
  const fallbackReason = scanned.semanticFallbackReason?.trim().replace(/[.!?]+$/, "");
  if (scanned.semanticAnalysisEnabled === false) {
    return fallbackReason
      ? `Semantic analysis did not run: ${fallbackReason}.`
      : "Semantic analysis did not run.";
  }
  return fallbackReason
    ? `Semantic analysis fell back: ${fallbackReason}.`
    : "Semantic analysis fell back to lightweight scanning.";
}

export function formatCodebaseScanFeedback(result: ScanProductGraphCodebaseResult) {
  const skippedRelationshipGuidance = formatCodebaseScanSkippedRelationshipGuidance(result);
  const semanticFallbackGuidance = formatCodebaseScanSemanticFallbackGuidance(result);
  return [
    `${result.message} ${formatCodebaseScanResult(result)}.`,
    skippedRelationshipGuidance,
    semanticFallbackGuidance,
  ].filter(Boolean).join(" ");
}
