import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import type {
  ActorRole,
  DashboardRunSummary,
  ProductEdgeKind,
  ProductGraphAcceptanceEvidenceHealthSummary,
  ProductGraphCodeIntentDriftSummary,
  ProductGraphCodeScanFreshnessSummary,
  ProductGraphCodexPlanningPrompt,
  ProductGraphExecutionDriftSummary,
  ProductGraphExecutionTestEvidenceSummary,
  ProductGraphEdge,
  ProductGraphNode,
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
  findProductGraphAcceptanceCriterionEvidenceForNode,
  findProductGraphAcceptanceEvidenceGaps,
  buildProductGraphTaskScopeNodeIds,
  PRODUCT_GRAPH_TASK_SCOPE_DEFINITIONS,
  hasProductGraphAcceptanceVerification,
  summarizeProductGraphAcceptanceEvidenceHealth,
  summarizeProductGraphCodeIntentDrift,
  summarizeProductGraphCodeScanFreshness,
  summarizeProductGraphExecutionDrift,
  summarizeProductGraphExecutionTestEvidence,
  summarizeProductGraphFeatureAcceptanceEvidenceByNodeId,
  summarizeProductGraphReadyTaskCandidates,
  summarizeProductGraphTaskExecutionEvidence,
} from "@openagentgraph/shared";
import { useStore } from "../lib/store.js";
import { requestProductGraphLoad } from "../lib/productGraphLoad.js";
import { PRODUCT_GRAPH_PREVIEW_MESSAGE } from "../lib/productGraphPreview.js";
import {
  DEFAULT_GRAPH_THEME,
  GRAPH_THEMES,
  GRAPH_THEME_OPTIONS,
  readStoredGraphThemeId,
  writeStoredGraphThemeId,
  type GraphThemeId,
} from "../lib/graphTheme.js";
import type {
  AcceptProductGraphCodexPlanInput,
  AcceptProductGraphCodexPlanResult,
  CreateProductGraphIntentBundleInput,
  CreateProductGraphIntentBundleResult,
  ScanProductGraphCodebaseResult,
  ImportProductGraphSpecKitResult,
  LinkProductGraphRunInput,
  LinkProductGraphRunResult,
  ProductGraphHandoffResult,
  WriteProductGraphHandoffResult,
} from "../lib/productGraphApi.js";

type ProductKindFilter = ProductNodeKind | "all";
type ProductStatusFilter = ProductNodeStatus | "all";
type ProductGraphRuntimeStatus = ReturnType<typeof useStore.getState>["runtimeStatus"];
type ProductGraphSessionLifecycle = ReturnType<typeof useStore.getState>["sessionLifecycle"];
type ProductGraphReadinessTone = "success" | "warning" | "danger" | "neutral";
export type CodeMapQuickFilter =
  | "all"
  | "dependencies"
  | "semantic"
  | "cycles"
  | "unresolved"
  | "external"
  | "orphans"
  | "freshness";

interface CodexExecutionReadinessNotice {
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

function codeMapExplorerSelectionMatches(
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

const KIND_FILTERS: Array<{ value: ProductKindFilter; label: string }> = [
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

const CODE_KIND_FILTERS: Array<{ value: Extract<ProductNodeKind, "code_file" | "code_symbol" | "code_community">; label: string }> = [
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

const DEFAULT_CODE_MAP_FILTERS: CodeMapFilterState = {
  files: true,
  symbols: true,
  communities: true,
  dependencyEdges: true,
  semanticEdges: true,
};

const TASK_CODE_EDGE_KINDS = new Set<ProductEdgeKind>(["touches", "implements", "depends_on"]);
const SEMANTIC_CODE_EDGE_KINDS = new Set<ProductEdgeKind>(["uses", "exports", "extends", "implements"]);
const LINKED_RUN_FILE_LIMIT = 5;
const LINKED_PLAN_RUN_LIMIT = 5;
const ACCEPTANCE_EVIDENCE_LIMIT = 5;
const CODE_MAP_COMMUNITY_SUMMARY_LIMIT = 5;
const CODE_MAP_COMMUNITY_GROUP_FILE_LIMIT = 4;
const CODE_MAP_HOTSPOT_LIMIT = 5;
const CODE_MAP_IMPACT_SECTION_LIMIT = 5;
const CODE_MAP_IMPACT_PATH_LIMIT = 3;
export const CODE_MAP_EXPLORER_RENDER_NODE_LIMIT = 80;
const CODE_MAP_HEALTH_ITEM_LIMIT = 5;
const CODE_MAP_CYCLE_LIMIT = 5;
const CODE_MAP_CYCLE_MAX_DEPTH = 8;
const CODE_MAP_CYCLE_VISIT_LIMIT = 10_000;
export const PRODUCT_GRAPH_NODE_CARD_RENDER_LIMIT = 180;
const PRODUCT_GRAPH_NODE_CARD_RENDER_INCREMENT = 180;
const ACCEPTANCE_EVIDENCE_GAP_LIMIT = 4;
const BLOCKED_TASK_GAP_LIMIT = 4;
const READY_TASK_CANDIDATE_LIMIT = 4;
const EXECUTION_DRIFT_TASK_LIMIT = 4;
const TEST_EVIDENCE_TASK_LIMIT = 4;
const CODE_INTENT_DRIFT_CODE_LIMIT = 4;
const CODE_MAP_FRESHNESS_CODE_LIMIT = 4;
const CODEBASE_SCAN_SETUP_GUIDANCE =
  "Run Scan Codebase from the manager tools in this sidebar to refresh the native Product Graph code map.";
const CODEBASE_SCAN_SCOPE_COPY =
  "Scans bounded local TypeScript and JavaScript files, top-level exports, semantic imports, and symbol relationships.";
type CodeMapThemeKey = keyof typeof DEFAULT_GRAPH_THEME.codeMap;
const CODE_MAP_VISUAL_KEY: Array<{ key: CodeMapThemeKey; label: string; detail: string }> = [
  { key: "communities", label: "Communities", detail: "module clusters that group scanned files" },
  { key: "files", label: "Files", detail: "source files and dependency endpoints" },
  { key: "symbols", label: "Symbols", detail: "exported declarations and semantic targets" },
  { key: "dependencies", label: "Dependencies", detail: "import/module edges between files" },
  { key: "semantic", label: "Semantic", detail: "TypeScript-resolved symbol relationships" },
  { key: "uncertain", label: "Uncertain", detail: "inferred or ambiguous graph evidence" },
];
const EMPTY_PRODUCT_GRAPH_TRACE_CACHE: Record<string, ProductGraphTrace> = {};
const EMPTY_EXECUTION_DRIFT_HEALTH: ProductGraphExecutionDriftSummary = {
  completedTaskCount: 0,
  tasksWithDriftCount: 0,
  tasksMissingRunCount: 0,
  tasksMissingEvidenceCount: 0,
  taskGaps: [],
};
const EMPTY_EXECUTION_TEST_EVIDENCE_HEALTH: ProductGraphExecutionTestEvidenceSummary = {
  completedTaskCount: 0,
  completedTasksWithLinkedEvidenceCount: 0,
  tasksMissingTestEvidenceCount: 0,
  taskGaps: [],
};
const EMPTY_READY_TASK_CANDIDATE_HEALTH: ProductGraphReadyTaskCandidateSummary = {
  plannedTaskCount: 0,
  blockedPlannedTaskCount: 0,
  readyTaskCount: 0,
  taskCandidates: [],
};
const EMPTY_CODE_INTENT_DRIFT_HEALTH: ProductGraphCodeIntentDriftSummary = {
  changedCodeNodeCount: 0,
  changedCodeNodesWithIntentCount: 0,
  codeNodesMissingIntentCount: 0,
  codeGaps: [],
};
const EMPTY_CODE_MAP_FRESHNESS_HEALTH: ProductGraphCodeScanFreshnessSummary = {
  codeScanNodeCount: 0,
  runTouchedCodeNodeCount: 0,
  codeNodesChangedAfterCodeScanCount: 0,
  hasCodeScanMap: false,
  hasRunTouchedCode: false,
  isCodeMapMissing: false,
  isCodeMapStale: false,
  codeGaps: [],
};
const EMPTY_CODE_MAP_ARCHITECTURE_HEALTH: CodeMapArchitectureHealth = {
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
const EMPTY_ACCEPTANCE_EVIDENCE_HEALTH: ProductGraphAcceptanceEvidenceHealthSummary = {
  featureCount: 0,
  featuresWithCriteriaCount: 0,
  featuresNeedingEvidenceCount: 0,
  acceptanceCriteriaCount: 0,
  verifiedAcceptanceCriteriaCount: 0,
  criteriaNeedingEvidenceCount: 0,
  coveragePercent: 0,
};

const STATUS_FILTERS: Array<{ value: ProductStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "proposed", label: "Proposed" },
  { value: "planned", label: "Planned" },
  { value: "blocked", label: "Blocked" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "resolved", label: "Resolved" },
];

const CREATE_NODE_KIND_OPTIONS: Array<{ value: ProductNodeKind; label: string }> = [
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

const CREATE_NODE_STATUS_OPTIONS: Array<{ value: ProductNodeStatus; label: string }> = [
  { value: "proposed", label: "Proposed" },
  { value: "planned", label: "Planned" },
  { value: "blocked", label: "Blocked" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "resolved", label: "Resolved" },
];

const CREATE_EDGE_KIND_OPTIONS: Array<{ value: ProductEdgeKind; label: string }> = [
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

const MAX_BUNDLE_ITEM_FIELDS = 10;

export const TRUST_TONES: Record<ProductTrustLabel, { color: string; border: string; background: string }> =
  DEFAULT_GRAPH_THEME.trust;

const READINESS_TONES: Record<ProductGraphReadinessTone, { color: string; border: string; background: string }> = {
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

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function formatTitleLabel(value: string) {
  const label = formatLabel(value);
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : label;
}

function nodeMatchesQuery(node: ProductGraphProjectionNode, query: string) {
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

function edgeLabel(edge: ProductGraphEdge) {
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

function buildNeighborLabel(
  edge: ProductGraphEdge,
  selectedNodeId: string,
  nodesById: Map<string, ProductGraphProjectionNode>
) {
  const neighborId = edge.sourceNodeId === selectedNodeId ? edge.targetNodeId : edge.sourceNodeId;
  return nodesById.get(neighborId)?.title ?? neighborId;
}

function isTaskBlockedByOpenQuestions(node: ProductGraphProjectionNode) {
  return node.kind === "task" && node.blockedByNodeIds.length > 0;
}

function isCodeMapNode(node: ProductGraphProjectionNode) {
  return node.kind === "code_file" || node.kind === "code_symbol" || node.kind === "code_community";
}

function metadataValueText(metadata: ProductGraphProjectionNode["metadata"] | ProductGraphEdge["metadata"], key: string) {
  const value = metadata?.[key];
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function edgeMetadataText(edge: ProductGraphEdge, key: string) {
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

function metadataText(node: ProductGraphProjectionNode, key: string) {
  return metadataValueText(node.metadata, key);
}

function metadataPercentText(node: ProductGraphProjectionNode, key: string) {
  const value = node.metadata?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return `${Math.round(value * 100)}%`;
}

function sourcePathLabel(node: ProductGraphProjectionNode) {
  if (!node.source?.path) return undefined;
  return node.source.line ? `${node.source.path}:${node.source.line}` : node.source.path;
}

function selectedNodeLabel(node: ProductGraphProjectionNode) {
  if (isCodeMapNode(node)) return "Selected code";
  if (node.kind === "agent_run") return "Selected run";
  if (node.kind === "evidence") return "Selected evidence";
  if (node.kind === "plan") return "Selected plan";
  return "Selected intent";
}

function visibleMetadataItems(items: Array<[string, string | undefined]>): Array<[string, string]> {
  return items.filter((item): item is [string, string] => Boolean(item[1]));
}

function codeMapNodeDetails(node: ProductGraphProjectionNode): Array<[string, string]> {
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

function metadataNumberValue(
  metadata: ProductGraphProjectionNode["metadata"] | ProductGraphEdge["metadata"],
  key: string
) {
  const value = metadata?.[key];
  if (typeof value === "number") return positiveFiniteCount(value);
  if (typeof value === "string") return positiveFiniteCount(Number(value));
  return 0;
}

function codeMapNodeSourceFile(node: ProductGraphProjectionNode | undefined) {
  if (!node) return undefined;
  return metadataValueText(node.metadata, "scannerSourceFile") ?? node.source?.path;
}

function codeMapFileDependencyCounts(node: ProductGraphProjectionNode | undefined) {
  if (!node) return { external: 0, unresolved: 0 };
  return {
    external: metadataNumberValue(node.metadata, "scannerExternalDependencyCount"),
    unresolved: metadataNumberValue(node.metadata, "scannerUnresolvedDependencyCount"),
  };
}

function buildCodeMapCommunityFileIds(
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

function buildCodeMapFileCommunityIds(communityFileIds: Map<string, Set<string>>) {
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

function codeMapCommunityIdsForNode(
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

function incrementCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function buildCodeMapSymbolFileIds(
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

function codeMapFileIdForNode(
  node: ProductGraphProjectionNode | undefined,
  symbolFileIds: Map<string, string>
) {
  if (node?.kind === "code_file") return node.id;
  if (node?.kind === "code_symbol") return symbolFileIds.get(node.id);
  return undefined;
}

function sortCodeMapNodesByTitle(items: ProductGraphProjectionNode[]) {
  return [...items].sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

function buildCodeMapFileSymbolIds(symbolFileIds: Map<string, string>) {
  const fileSymbolIds = new Map<string, Set<string>>();
  for (const [symbolId, fileId] of symbolFileIds) {
    const symbolIds = fileSymbolIds.get(fileId) ?? new Set<string>();
    symbolIds.add(symbolId);
    fileSymbolIds.set(fileId, symbolIds);
  }
  return fileSymbolIds;
}

function addUniqueImpactItem(
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

function boundedImpactSection(itemsByKey: Map<string, CodeMapImpactItem>, limit: number): CodeMapImpactSection {
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

function codeMapSelectionScope(
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

function canonicalCycleKey(nodeIds: string[]) {
  let bestRotation = nodeIds;
  for (let index = 1; index < nodeIds.length; index += 1) {
    const rotation = [...nodeIds.slice(index), ...nodeIds.slice(0, index)];
    if (rotation.join("\u0000") < bestRotation.join("\u0000")) {
      bestRotation = rotation;
    }
  }
  return bestRotation.join(">");
}

function buildCodeMapDependencyCycleSummary(
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

function buildCodeMapLinkedCodeIds(
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

function findCodeMapDependencyIssueFiles(
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

function addCodeMapExplorerEdgeScope(
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

function codeMapEdgeDetails(edge: ProductGraphEdge): Array<[string, string]> {
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

function pluralizeCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatScanBytes(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 MB";
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatScanEta(etaMs: number | undefined) {
  if (!etaMs || !Number.isFinite(etaMs) || etaMs <= 0) return "ETA unknown";
  if (etaMs < 1_000) return "ETA <1s";
  const seconds = Math.round(etaMs / 1_000);
  if (seconds < 60) return `ETA ${seconds}s`;
  return `ETA ${Math.round(seconds / 60)}m`;
}

function formatScanProgressLine(progress: ScanProgressSnapshot | null | undefined) {
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

function scanBreakerWarning(progress: ScanProgressSnapshot | null | undefined) {
  if (!progress || progress.breakers.state === "ok") return "";
  const alert = progress.breakers.hits[0] ?? progress.breakers.near[0];
  return alert?.message ?? "The scan is near a configured emergency breaker.";
}

function positiveFiniteCount(count: number) {
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

interface ProductGraphContentProps {
  productGraph: ReturnType<typeof useStore.getState>["productGraph"];
  productGraphLoading: boolean;
  productGraphError: string;
  productGraphPreviewMessage?: string;
  onRefresh: () => void;
  getProductGraphError?: () => string;
  productGraphTrace?: ProductGraphTrace | null;
  productGraphTracesByNodeId?: Record<string, ProductGraphTrace>;
  productGraphTraceNodeId?: string | null;
  productGraphTraceLoading?: boolean;
  productGraphTraceError?: string;
  productGraphTraceNotice?: string;
  productGraphCodexPlan?: ProductGraphCodexPlanningPrompt | null;
  productGraphCodexPlanTaskNodeId?: string | null;
  productGraphCodexPlanLoading?: boolean;
  productGraphCodexPlanError?: string;
  productGraphHandoff?: ProductGraphHandoffResult | null;
  productGraphHandoffLoading?: boolean;
  productGraphHandoffWriting?: boolean;
  productGraphHandoffError?: string;
  productGraphHandoffMessage?: string;
  codebaseScanProgress?: ScanProgressSnapshot | null;
  runtimeFallbackLikely?: boolean;
  runtimeStatus?: ProductGraphRuntimeStatus;
  sessionLifecycle?: ProductGraphSessionLifecycle;
  canManageProductGraph: boolean;
  onCreateNode: (input: {
    kind: ProductNodeKind;
    title: string;
    summary?: string;
    status: ProductNodeStatus;
  }) => Promise<ProductGraphNode>;
  onCreateEdge: (input: {
    sourceNodeId: string;
    targetNodeId: string;
    kind: ProductEdgeKind;
    label?: string;
  }) => Promise<ProductGraphEdge>;
  onCreateIntentBundle: (
    input: CreateProductGraphIntentBundleInput
  ) => Promise<CreateProductGraphIntentBundleResult>;
  onGenerateHandoff?: () => Promise<ProductGraphHandoffResult>;
  onWriteHandoff?: () => Promise<WriteProductGraphHandoffResult>;
  onScanCodebase?: () => Promise<ScanProductGraphCodebaseResult>;
  onImportSpecKit?: () => Promise<ImportProductGraphSpecKitResult>;
  completedRuns?: DashboardRunSummary[];
  onLinkRun?: (input: LinkProductGraphRunInput) => Promise<LinkProductGraphRunResult>;
  onLoadTrace?: (nodeId: string) => Promise<ProductGraphTrace>;
  onLoadCodexPlan?: (taskNodeId: string) => Promise<ProductGraphCodexPlanningPrompt>;
  onAcceptCodexPlan?: (input: AcceptProductGraphCodexPlanInput) => Promise<AcceptProductGraphCodexPlanResult>;
}

export function shouldAutoLoadProductGraph(
  productGraph: ProductGraphProjection | null,
  productGraphLoading: boolean,
  productGraphError: string
) {
  return !productGraph && !productGraphLoading && !productGraphError;
}

export function canManageProductGraph(role: ActorRole | undefined) {
  return role === "operator" || role === "admin";
}

export function getCodexExecutionReadinessNotice({
  canEditProductGraph,
  runtimeFallbackLikely = false,
  runtimeStatus = "connected",
  sessionLifecycle = "read_only",
}: {
  canEditProductGraph: boolean;
  runtimeFallbackLikely?: boolean;
  runtimeStatus?: ProductGraphRuntimeStatus;
  sessionLifecycle?: ProductGraphSessionLifecycle;
}): CodexExecutionReadinessNotice {
  if (runtimeStatus === "unreachable") {
    return {
      tone: "danger",
      message: "Backend is unreachable; planning prompts and real execution are blocked until it reconnects.",
    };
  }

  if (sessionLifecycle === "expired_session" || sessionLifecycle === "invalid_session") {
    return {
      tone: "danger",
      message: "Session blocks execution: update the token before accepting plans or starting a real run.",
    };
  }

  if (!canEditProductGraph) {
    return {
      tone: "warning",
      message: "Read-only access: prompt review is available, but operator/admin access is required to accept plans or start execution.",
    };
  }

  if (runtimeFallbackLikely) {
    return {
      tone: "warning",
      message: "AI provider blocks execution: configure the provider, restart the backend, and refresh provider status before starting a run.",
    };
  }

  if (runtimeStatus === "degraded" || runtimeStatus === "auth_required" || runtimeStatus === "read_only") {
    return {
      tone: "warning",
      message: "Execution readiness needs a final check in Current run setup before starting a real run.",
    };
  }

  return {
    tone: "success",
    message: "Provider and session checks are clear here; start real execution from Current run setup after the workspace path is set.",
  };
}

export function isProductGraphNodeRefreshWarning(message: string) {
  return message.startsWith("Product graph node was created, but the graph could not be refreshed.");
}

export function isProductGraphEdgeRefreshWarning(message: string) {
  return message.startsWith("Product graph edge was created, but the graph could not be refreshed.");
}

export function isProductGraphIntentBundleRefreshWarning(message: string) {
  return message.startsWith("Product graph intent bundle was created, but the graph could not be refreshed.");
}

export function isProductGraphRunLinkRefreshWarning(message: string) {
  return message.startsWith("Product graph run link was created, but the graph could not be refreshed.");
}

export function isProductGraphCodexPlanRefreshWarning(message: string) {
  return message.startsWith("Product graph Codex plan was created, but the graph could not be refreshed.");
}

export function isProductGraphSpecKitImportRefreshWarning(message: string) {
  return message.startsWith("Product graph Spec Kit import completed, but the graph could not be refreshed.");
}

export function isProductGraphCodebaseScanRefreshWarning(message: string) {
  return message.startsWith("Product graph Codebase scan completed, but the graph could not be refreshed.");
}

export async function hashCodexPlanPrompt(prompt: string) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Codex prompt hashing is unavailable in this browser.");
  }

  const hashBuffer = await subtle.digest("SHA-256", new TextEncoder().encode(prompt));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function ProductGraphContent({
  productGraph,
  productGraphLoading,
  productGraphError,
  productGraphPreviewMessage = "",
  onRefresh,
  getProductGraphError,
  productGraphTrace,
  productGraphTracesByNodeId = EMPTY_PRODUCT_GRAPH_TRACE_CACHE,
  productGraphTraceNodeId,
  productGraphTraceLoading = false,
  productGraphTraceError = "",
  productGraphTraceNotice = "",
  productGraphCodexPlan = null,
  productGraphCodexPlanTaskNodeId = null,
  productGraphCodexPlanLoading = false,
  productGraphCodexPlanError = "",
  productGraphHandoff = null,
  productGraphHandoffLoading = false,
  productGraphHandoffWriting = false,
  productGraphHandoffError = "",
  productGraphHandoffMessage = "",
  codebaseScanProgress = null,
  runtimeFallbackLikely = false,
  runtimeStatus,
  sessionLifecycle,
  canManageProductGraph,
  onCreateNode,
  onCreateEdge,
  onCreateIntentBundle,
  onGenerateHandoff,
  onWriteHandoff,
  onScanCodebase,
  onImportSpecKit,
  completedRuns = [],
  onLinkRun,
  onLoadTrace,
  onLoadCodexPlan,
  onAcceptCodexPlan,
}: ProductGraphContentProps) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ProductKindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ProductStatusFilter>("all");
  const [codeMapFilters, setCodeMapFilters] = useState<CodeMapFilterState>(DEFAULT_CODE_MAP_FILTERS);
  const [codeMapQuickFilter, setCodeMapQuickFilter] = useState<CodeMapQuickFilter>("all");
  const [codeMapTaskScope, setCodeMapTaskScope] = useState<ProductGraphTaskScopeId>("all");
  const [codeMapThemeId, setCodeMapThemeId] = useState<GraphThemeId>(() => readStoredGraphThemeId());
  const [codeMapExplorerSelection, setCodeMapExplorerSelection] = useState<CodeMapExplorerSelection | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [visibleNodeRenderLimit, setVisibleNodeRenderLimit] = useState(PRODUCT_GRAPH_NODE_CARD_RENDER_LIMIT);
  const [newNodeKind, setNewNodeKind] = useState<ProductNodeKind>("feature");
  const [newNodeStatus, setNewNodeStatus] = useState<ProductNodeStatus>("planned");
  const [newNodeTitle, setNewNodeTitle] = useState("");
  const [newNodeSummary, setNewNodeSummary] = useState("");
  const [createNodeError, setCreateNodeError] = useState("");
  const [createNodeMessage, setCreateNodeMessage] = useState("");
  const [createNodePending, setCreateNodePending] = useState(false);
  const [newEdgeSourceNodeId, setNewEdgeSourceNodeId] = useState("");
  const [newEdgeTargetNodeId, setNewEdgeTargetNodeId] = useState("");
  const [newEdgeKind, setNewEdgeKind] = useState<ProductEdgeKind>("belongs_to");
  const [newEdgeLabel, setNewEdgeLabel] = useState("");
  const [createEdgeError, setCreateEdgeError] = useState("");
  const [createEdgeMessage, setCreateEdgeMessage] = useState("");
  const [createEdgePending, setCreateEdgePending] = useState(false);
  const [bundleFeatureTitle, setBundleFeatureTitle] = useState("");
  const [bundleFeatureSummary, setBundleFeatureSummary] = useState("");
  const [bundleStoryTitles, setBundleStoryTitles] = useState([""]);
  const [bundleCriterionTitles, setBundleCriterionTitles] = useState([""]);
  const [bundleTaskTitles, setBundleTaskTitles] = useState([""]);
  const [createBundleError, setCreateBundleError] = useState("");
  const [createBundleMessage, setCreateBundleMessage] = useState("");
  const [createBundlePending, setCreateBundlePending] = useState(false);
  const [specKitImportError, setSpecKitImportError] = useState("");
  const [specKitImportMessage, setSpecKitImportMessage] = useState("");
  const [specKitImportPending, setSpecKitImportPending] = useState(false);
  const [codebaseScanError, setCodebaseScanError] = useState("");
  const [codebaseScanMessage, setCodebaseScanMessage] = useState("");
  const [codebaseScanPending, setCodebaseScanPending] = useState(false);
  const [runLinkGraphId, setRunLinkGraphId] = useState("");
  const [runLinkFeedbackNodeId, setRunLinkFeedbackNodeId] = useState("");
  const [runLinkError, setRunLinkError] = useState("");
  const [runLinkMessage, setRunLinkMessage] = useState("");
  const [runLinkPending, setRunLinkPending] = useState(false);
  const [acceptCodexPlanTaskNodeId, setAcceptCodexPlanTaskNodeId] = useState("");
  const [acceptCodexPlanError, setAcceptCodexPlanError] = useState("");
  const [acceptCodexPlanMessage, setAcceptCodexPlanMessage] = useState("");
  const [acceptCodexPlanPending, setAcceptCodexPlanPending] = useState(false);
  const selectedNodeIdRef = useRef<string | null>(null);
  const isProductGraphPreview = Boolean(productGraphPreviewMessage || productGraph?.productGraphId.startsWith("preview:"));
  const canEditProductGraph = canManageProductGraph && !isProductGraphPreview;
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const edgeNodeOptions = productGraph?.nodes ?? [];
  const codeMapTheme = GRAPH_THEMES[codeMapThemeId];
  const statusTones = codeMapTheme.productStatus;
  const edgeTones = codeMapTheme.productEdge;
  const trustTones = codeMapTheme.trust;

  useEffect(() => {
    writeStoredGraphThemeId(codeMapThemeId);
  }, [codeMapThemeId]);

  const nodesById = useMemo(() => {
    return new Map((productGraph?.nodes ?? []).map((node) => [node.id, node]));
  }, [productGraph]);

  const codeMapQuickFilterNodeIds = useMemo(() => {
    if (!productGraph || codeMapQuickFilter === "all") return new Set<string>();
    return buildCodeMapQuickFilterNodeIds(
      productGraph,
      codeMapQuickFilter,
      summarizeProductGraphCodeScanFreshness(productGraph)
    );
  }, [codeMapQuickFilter, productGraph]);
  const codeMapQuickFilterActive = codeMapQuickFilter !== "all";
  const codeMapTaskScopeNodeIds = useMemo(() => {
    if (!productGraph || codeMapTaskScope === "all") return new Set<string>();
    return buildProductGraphTaskScopeNodeIds(productGraph, codeMapTaskScope);
  }, [codeMapTaskScope, productGraph]);
  const codeMapTaskScopeActive = codeMapTaskScope !== "all";
  const codeMapExplorerView = useMemo(() => {
    if (!productGraph || !codeMapExplorerSelection) return null;
    return buildCodeMapExplorerView(productGraph, codeMapExplorerSelection);
  }, [codeMapExplorerSelection, productGraph]);

  const visibleNodes = useMemo(() => {
    if (!productGraph) return [];
    return productGraph.nodes
      .filter((node) =>
        codeMapExplorerView
          ? codeMapExplorerView.nodeIds.has(node.id)
          : codeMapQuickFilterActive
          ? codeMapQuickFilterAllowsNode(node, codeMapQuickFilter, codeMapQuickFilterNodeIds)
          : codeMapFilterAllowsNode(node, codeMapFilters)
      )
      .filter((node) => codeMapExplorerView || codeMapTaskScopeAllowsNode(node, codeMapTaskScope, codeMapTaskScopeNodeIds))
      .filter((node) => codeMapExplorerView || codeMapQuickFilterActive || kindFilter === "all" || node.kind === kindFilter)
      .filter((node) => codeMapExplorerView || codeMapQuickFilterActive || statusFilter === "all" || node.status === statusFilter)
      .filter((node) => codeMapExplorerView || codeMapQuickFilterActive || nodeMatchesQuery(node, deferredQuery));
  }, [
    codeMapExplorerView,
    codeMapFilters,
    codeMapQuickFilter,
    codeMapQuickFilterActive,
    codeMapQuickFilterNodeIds,
    codeMapTaskScope,
    codeMapTaskScopeNodeIds,
    deferredQuery,
    kindFilter,
    productGraph,
    statusFilter,
  ]);

  const selectedNode = useMemo(() => {
    return selectProductGraphNode(visibleNodes, selectedNodeId);
  }, [selectedNodeId, visibleNodes]);
  const renderedVisibleNodes = useMemo(() => {
    const renderedNodes = visibleNodes.slice(0, visibleNodeRenderLimit);
    if (selectedNode && visibleNodes.some((node) => node.id === selectedNode.id) && !renderedNodes.some((node) => node.id === selectedNode.id)) {
      return [...renderedNodes, selectedNode];
    }
    return renderedNodes;
  }, [selectedNode, visibleNodeRenderLimit, visibleNodes]);
  const renderedVisibleNodeCount = new Set(renderedVisibleNodes.map((node) => node.id)).size;
  const hiddenVisibleNodeCount = Math.max(0, visibleNodes.length - renderedVisibleNodeCount);

  useEffect(() => {
    setVisibleNodeRenderLimit(PRODUCT_GRAPH_NODE_CARD_RENDER_LIMIT);
  }, [codeMapExplorerSelection, codeMapFilters, codeMapQuickFilter, codeMapTaskScope, deferredQuery, kindFilter, statusFilter]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNode?.id ?? null;
  }, [selectedNode?.id]);

  function updateSelectedNodeId(nodeId: string | null) {
    selectedNodeIdRef.current = nodeId;
    setSelectedNodeId(nodeId);
  }

  const selectedEdges = useMemo(() => {
    if (!productGraph || !selectedNode) return [];
    return productGraph.edges
      .filter((edge) => {
        if (codeMapExplorerView) {
          return codeMapExplorerView.edgeIds.has(edge.id);
        }
        if (codeMapQuickFilter === "dependencies" || codeMapQuickFilter === "cycles") return isDependencyCodeEdge(edge, nodesById);
        if (codeMapQuickFilter === "semantic") return isSemanticCodeEdge(edge, nodesById);
        return codeMapFilterAllowsEdge(edge, codeMapFilters, nodesById);
      })
      .filter((edge) => codeMapExplorerView || codeMapTaskScopeAllowsEdge(edge, nodesById, codeMapTaskScope, codeMapTaskScopeNodeIds))
      .filter((edge) => edge.sourceNodeId === selectedNode.id || edge.targetNodeId === selectedNode.id)
      .slice(0, 10);
  }, [codeMapExplorerView, codeMapFilters, codeMapQuickFilter, codeMapTaskScope, codeMapTaskScopeNodeIds, nodesById, productGraph, selectedNode]);

  const selectedBlockingQuestions = useMemo(() => {
    if (!selectedNode?.blockedByNodeIds.length) return [];
    return selectedNode.blockedByNodeIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is ProductGraphProjectionNode => Boolean(node && node.kind === "open_question"));
  }, [nodesById, selectedNode]);

  const selectedTaskCodeAreas = useMemo(() => {
    if (!productGraph) return [];
    return findLikelyCodeAreasForTask(selectedNode, productGraph.edges, nodesById);
  }, [nodesById, productGraph, selectedNode]);
  const selectedTaskLinkedRunFiles = useMemo(() => {
    if (!productGraph) return [];
    return findLinkedRunFilesForTask(selectedNode, productGraph.edges, nodesById);
  }, [nodesById, productGraph, selectedNode]);
  const selectedPlanLinkedRuns = useMemo(() => {
    if (!productGraph) return [];
    return findRunsDerivedFromPlan(selectedNode, productGraph.edges, nodesById);
  }, [nodesById, productGraph, selectedNode]);
  const selectedTaskExecutionEvidence = useMemo(() => {
    if (!productGraph || !selectedNode) return undefined;
    return summarizeProductGraphTaskExecutionEvidence({ projection: productGraph, taskNodeId: selectedNode.id });
  }, [productGraph, selectedNode]);
  const selectedAcceptanceEvidence = useMemo(() => {
    if (!productGraph || !selectedNode) return [];
    return findProductGraphAcceptanceCriterionEvidenceForNode({
      projection: productGraph,
      selectedNodeId: selectedNode.id,
      criterionLimit: ACCEPTANCE_EVIDENCE_LIMIT,
    });
  }, [productGraph, selectedNode]);
  const selectedVerifiedCriterionCount = selectedAcceptanceEvidence.filter(hasProductGraphAcceptanceVerification).length;
  const featureAcceptanceSummariesByNodeId = useMemo(() => {
    if (!productGraph) return new Map();
    return summarizeProductGraphFeatureAcceptanceEvidenceByNodeId(productGraph);
  }, [productGraph]);
  const acceptanceEvidenceHealth = useMemo(() => {
    if (!productGraph) return EMPTY_ACCEPTANCE_EVIDENCE_HEALTH;
    return summarizeProductGraphAcceptanceEvidenceHealth(productGraph, { featureAcceptanceSummariesByNodeId });
  }, [featureAcceptanceSummariesByNodeId, productGraph]);
  const acceptanceEvidenceGaps = useMemo(() => {
    if (!productGraph) return [];
    return findProductGraphAcceptanceEvidenceGaps(productGraph, { gapLimit: ACCEPTANCE_EVIDENCE_GAP_LIMIT });
  }, [productGraph]);
  const executionDriftHealth = useMemo(() => {
    if (!productGraph) return EMPTY_EXECUTION_DRIFT_HEALTH;
    return summarizeProductGraphExecutionDrift(productGraph, { taskGapLimit: EXECUTION_DRIFT_TASK_LIMIT });
  }, [productGraph]);
  const executionTestEvidenceHealth = useMemo(() => {
    if (!productGraph) return EMPTY_EXECUTION_TEST_EVIDENCE_HEALTH;
    return summarizeProductGraphExecutionTestEvidence(productGraph, { taskGapLimit: TEST_EVIDENCE_TASK_LIMIT });
  }, [productGraph]);
  const codeIntentDriftHealth = useMemo(() => {
    if (!productGraph) return EMPTY_CODE_INTENT_DRIFT_HEALTH;
    return summarizeProductGraphCodeIntentDrift(productGraph, { codeGapLimit: CODE_INTENT_DRIFT_CODE_LIMIT });
  }, [productGraph]);
  const codeMapFreshnessHealth = useMemo(() => {
    if (!productGraph) return EMPTY_CODE_MAP_FRESHNESS_HEALTH;
    return summarizeProductGraphCodeScanFreshness(productGraph, { codeGapLimit: CODE_MAP_FRESHNESS_CODE_LIMIT });
  }, [productGraph]);
  const codeMapArchitectureHealth = useMemo(() => {
    if (!productGraph) return EMPTY_CODE_MAP_ARCHITECTURE_HEALTH;
    return buildCodeMapArchitectureHealth(productGraph, codeMapFreshnessHealth);
  }, [codeMapFreshnessHealth, productGraph]);
  const blockedTaskGaps = useMemo(() => {
    if (!productGraph) return [];
    return productGraph.nodes.filter(isTaskBlockedByOpenQuestions).slice(0, BLOCKED_TASK_GAP_LIMIT);
  }, [productGraph]);
  const blockedTaskCount = productGraph?.summary.blockedTaskCount ?? 0;
  const readyTaskCandidateHealth = useMemo(() => {
    if (!productGraph) return EMPTY_READY_TASK_CANDIDATE_HEALTH;
    return summarizeProductGraphReadyTaskCandidates(productGraph, { taskCandidateLimit: READY_TASK_CANDIDATE_LIMIT });
  }, [productGraph]);
  const readyTaskCandidates = readyTaskCandidateHealth.taskCandidates;
  const readyTaskCandidateCount = readyTaskCandidateHealth.readyTaskCount;
  const primaryReadyTaskCandidate = readyTaskCandidates[0] ?? null;
  const primaryBlockedTaskGap = blockedTaskGaps[0] ?? null;
  const acceptanceEvidenceHealthCopy =
    acceptanceEvidenceHealth.acceptanceCriteriaCount === 0
      ? "No acceptance criteria linked yet."
      : acceptanceEvidenceHealth.criteriaNeedingEvidenceCount === 0
        ? "All tracked acceptance criteria have evidence."
        : `${acceptanceEvidenceHealth.featuresNeedingEvidenceCount} ${
            acceptanceEvidenceHealth.featuresNeedingEvidenceCount === 1 ? "feature needs" : "features need"
          } evidence across ${acceptanceEvidenceHealth.criteriaNeedingEvidenceCount} ${
            acceptanceEvidenceHealth.criteriaNeedingEvidenceCount === 1 ? "criterion" : "criteria"
          }.`;
  const acceptanceEvidenceCoverageValue =
    acceptanceEvidenceHealth.acceptanceCriteriaCount > 0 ? `${acceptanceEvidenceHealth.coveragePercent}%` : "No criteria";
  const acceptanceEvidenceHealthTone =
    acceptanceEvidenceHealth.acceptanceCriteriaCount === 0
      ? "#94a3b8"
      : acceptanceEvidenceHealth.criteriaNeedingEvidenceCount > 0
        ? "#fbbf24"
        : "#86efac";
  const blockedTaskHealthCopy =
    blockedTaskCount === 0
      ? "No tasks are blocked by open questions."
      : `${blockedTaskCount} ${
          blockedTaskCount === 1 ? "task is" : "tasks are"
        } blocked by open questions. Resolve blockers before assigning implementation work.`;
  const blockedTaskHealthTone = blockedTaskCount > 0 ? "#fbbf24" : "#86efac";
  const readyTaskHealthCopy =
    readyTaskCandidateCount === 0
      ? "No unblocked planned tasks are ready for implementation yet."
      : `${readyTaskCandidateCount} planned ${
          readyTaskCandidateCount === 1 ? "task is" : "tasks are"
        } unblocked for implementation review.`;
  const readyTaskHealthTone = readyTaskCandidateCount > 0 ? "#86efac" : "#94a3b8";
  const workNextRecommendationTone = primaryReadyTaskCandidate ? "#86efac" : primaryBlockedTaskGap ? "#fbbf24" : "#94a3b8";
  const workNextRecommendationCopy = primaryReadyTaskCandidate
    ? "Start with the top unblocked planned task."
    : primaryBlockedTaskGap
      ? "No unblocked planned task is ready. Clear a blocker before implementation."
      : "No planned tasks are ready to queue yet.";
  const executionDriftHealthCopy =
    executionDriftHealth.completedTaskCount === 0
      ? "No completed tasks to verify yet."
      : executionDriftHealth.tasksWithDriftCount === 0
        ? "All completed tasks have linked run evidence."
        : `${executionDriftHealth.tasksWithDriftCount} of ${executionDriftHealth.completedTaskCount} completed ${
            executionDriftHealth.completedTaskCount === 1 ? "task needs" : "tasks need"
          } run evidence.`;
  const executionDriftHealthTone =
    executionDriftHealth.completedTaskCount === 0
      ? "#94a3b8"
      : executionDriftHealth.tasksWithDriftCount > 0
        ? "#fb7185"
        : "#86efac";
  const executionTestEvidenceHealthCopy =
    executionTestEvidenceHealth.completedTaskCount === 0
      ? "No completed tasks to inspect for test evidence yet."
      : executionTestEvidenceHealth.completedTasksWithLinkedEvidenceCount === 0
        ? "No completed tasks have linked run evidence yet."
        : executionTestEvidenceHealth.tasksMissingTestEvidenceCount === 0
          ? "Completed tasks with linked run evidence include test evidence."
          : `${executionTestEvidenceHealth.tasksMissingTestEvidenceCount} of ${
              executionTestEvidenceHealth.completedTasksWithLinkedEvidenceCount
            } completed ${
              executionTestEvidenceHealth.completedTasksWithLinkedEvidenceCount === 1 ? "task with" : "tasks with"
            } run evidence ${
              executionTestEvidenceHealth.tasksMissingTestEvidenceCount === 1 ? "needs" : "need"
            } test evidence.`;
  const executionTestEvidenceHealthTone =
    executionTestEvidenceHealth.completedTasksWithLinkedEvidenceCount === 0
      ? "#94a3b8"
      : executionTestEvidenceHealth.tasksMissingTestEvidenceCount > 0
        ? "#fbbf24"
        : "#86efac";
  const codeIntentDriftHealthCopy =
    codeIntentDriftHealth.changedCodeNodeCount === 0
      ? "No run-touched code nodes to inspect yet."
      : codeIntentDriftHealth.codeNodesMissingIntentCount === 0
        ? "Run-touched code is linked to product intent."
        : `${codeIntentDriftHealth.codeNodesMissingIntentCount} of ${
            codeIntentDriftHealth.changedCodeNodeCount
          } run-touched ${
            codeIntentDriftHealth.changedCodeNodeCount === 1 ? "code node needs" : "code nodes need"
          } product intent.`;
  const codeIntentDriftHealthTone =
    codeIntentDriftHealth.changedCodeNodeCount === 0
      ? "#94a3b8"
      : codeIntentDriftHealth.codeNodesMissingIntentCount > 0
        ? "#fbbf24"
        : "#86efac";
  const codebaseScanSetupCopy = canEditProductGraph
    ? CODEBASE_SCAN_SETUP_GUIDANCE
    : "Ask an operator/admin to refresh the native Product Graph code map.";
  const codebaseScanRefreshCopy = canEditProductGraph
    ? "Run Scan Codebase again from the manager tools."
    : "Ask an operator/admin to refresh the native Product Graph code map.";
  const codeMapFreshnessHealthCopy = !codeMapFreshnessHealth.hasCodeScanMap && !codeMapFreshnessHealth.hasRunTouchedCode
    ? `No codebase scan map is available yet. ${codebaseScanSetupCopy}`
    : codeMapFreshnessHealth.isCodeMapMissing
      ? `${codeMapFreshnessHealth.codeNodesChangedAfterCodeScanCount} run-touched ${
          codeMapFreshnessHealth.codeNodesChangedAfterCodeScanCount === 1 ? "code node needs" : "code nodes need"
        } a native codebase scan. ${codebaseScanSetupCopy}`
      : codeMapFreshnessHealth.isCodeMapStale
        ? `${codeMapFreshnessHealth.codeNodesChangedAfterCodeScanCount} run-touched ${
            codeMapFreshnessHealth.codeNodesChangedAfterCodeScanCount === 1 ? "code node changed" : "code nodes changed"
          } after the latest codebase scan. ${codebaseScanRefreshCopy}`
        : codeMapFreshnessHealth.runTouchedCodeNodeCount === 0
          ? "Codebase scan map is loaded; no linked run code changes yet."
          : "Codebase scan map is current for linked run evidence.";
  const codeMapFreshnessHealthTone =
    codeMapFreshnessHealth.isCodeMapMissing || codeMapFreshnessHealth.isCodeMapStale
      ? "#fbbf24"
      : codeMapFreshnessHealth.hasCodeScanMap
        ? "#86efac"
        : "#94a3b8";
  const codebaseScanLocationCopy = canEditProductGraph
    ? "Scan Codebase lives in the manager tools in this sidebar."
    : "Operators/admins can refresh this map from manager tools in this sidebar.";
  const codebasePlanningContextCopy = codeMapFreshnessHealth.isCodeMapMissing
    ? "Codex planning may miss code relationship context until a codebase scan runs."
    : codeMapFreshnessHealth.isCodeMapStale
      ? "Codex planning may use stale code relationship context until the codebase scan is refreshed."
      : codeMapFreshnessHealth.hasCodeScanMap
        ? "Codex planning can use native codebase scan context."
        : "Codex planning has no codebase scan context yet.";
  const codexExecutionReadinessNotice = getCodexExecutionReadinessNotice({
    canEditProductGraph,
    runtimeFallbackLikely,
    runtimeStatus,
    sessionLifecycle,
  });
  const codexExecutionReadinessTone = READINESS_TONES[codexExecutionReadinessNotice.tone];
  const selectedCachedTrace = selectedNode ? productGraphTracesByNodeId[selectedNode.id] ?? null : null;
  const selectedTrace =
    selectedNode && productGraphTrace?.rootNode.id === selectedNode.id ? productGraphTrace : selectedCachedTrace;
  const selectedTraceLoading = Boolean(
    selectedNode && productGraphTraceLoading && productGraphTraceNodeId === selectedNode.id
  );
  const selectedTraceRefreshing = Boolean(selectedTrace && selectedTraceLoading);
  const selectedTraceError =
    selectedNode && productGraphTraceNodeId === selectedNode.id ? productGraphTraceError : "";
  const selectedTraceNotice =
    selectedNode && !selectedTrace && !selectedTraceLoading && !selectedTraceError ? productGraphTraceNotice : "";
  const selectedTraceRelatedNodes = selectedTrace
    ? selectedTrace.nodes.filter((node) => node.id !== selectedTrace.rootNode.id).slice(0, 5)
    : [];
  const selectedCodexPlan =
    selectedNode && productGraphCodexPlanTaskNodeId === selectedNode.id ? productGraphCodexPlan : null;
  const selectedCodexPlanLoading = Boolean(
    selectedNode && productGraphCodexPlanLoading && productGraphCodexPlanTaskNodeId === selectedNode.id
  );
  const selectedCodexPlanRefreshing = Boolean(selectedCodexPlan && selectedCodexPlanLoading);
  const selectedCodexPlanError =
    selectedNode && productGraphCodexPlanTaskNodeId === selectedNode.id ? productGraphCodexPlanError : "";
  const selectedCodexPlanUnavailable = Boolean(!selectedCodexPlanLoading && selectedCodexPlanError);
  const selectedAcceptCodexPlanError =
    selectedNode && acceptCodexPlanTaskNodeId === selectedNode.id ? acceptCodexPlanError : "";
  const selectedAcceptCodexPlanMessage =
    selectedNode && acceptCodexPlanTaskNodeId === selectedNode.id ? acceptCodexPlanMessage : "";
  const selectedTaskPlanningReadinessCopy =
    selectedBlockingQuestions.length > 0
      ? `${selectedBlockingQuestions.length} open-question ${
          selectedBlockingQuestions.length === 1 ? "blocker" : "blockers"
        }; load the plan for context, then resolve blockers before execution.`
      : "Product Graph is loaded for this selected task.";
  const selectedTaskPlanningNextActionCopy = selectedCodexPlan
    ? canEditProductGraph
      ? "Review the prompt, then accept the plan if it matches current task context."
      : "Review the prompt; an operator/admin can accept it before execution."
    : selectedCodexPlanLoading
      ? "Plan load is in progress."
      : selectedCodexPlanUnavailable
        ? "Fix the load error, then retry Load plan."
        : "Load plan to generate the bounded Codex prompt for this task.";
  const completedRunOptions = useMemo(() => {
    return completedRuns.filter((run) => run.graphStatus === "completed");
  }, [completedRuns]);

  const codeMapSummary = useMemo(() => {
    if (!productGraph) {
      return {
        fileCount: 0,
        symbolCount: 0,
        communityCount: 0,
        dependencyEdgeCount: 0,
        semanticEdgeCount: 0,
        externalDependencyCount: 0,
        unresolvedDependencyCount: 0,
        inferredCount: 0,
        ambiguousCount: 0,
      };
    }

    let externalDependencyCount = 0;
    let unresolvedDependencyCount = 0;
    for (const node of productGraph.nodes) {
      if (node.kind !== "code_file") continue;
      const counts = codeMapFileDependencyCounts(node);
      externalDependencyCount += counts.external;
      unresolvedDependencyCount += counts.unresolved;
    }

    return {
      fileCount: productGraph.summary.nodesByKind.code_file ?? 0,
      symbolCount: productGraph.summary.nodesByKind.code_symbol ?? 0,
      communityCount: productGraph.summary.nodesByKind.code_community ?? 0,
      dependencyEdgeCount: productGraph.edges.filter((edge) => isDependencyCodeEdge(edge, nodesById)).length,
      semanticEdgeCount: productGraph.edges.filter((edge) => isSemanticCodeEdge(edge, nodesById)).length,
      externalDependencyCount,
      unresolvedDependencyCount,
      inferredCount: productGraph.edges.filter((edge) => edge.trust === "inferred").length,
      ambiguousCount: productGraph.edges.filter((edge) => edge.trust === "ambiguous").length,
    };
  }, [nodesById, productGraph]);

  const codeMapCommunityGroups = useMemo(() => {
    if (!productGraph) return [];
    const groups = buildCodeMapCommunityGroups(productGraph);
    if (codeMapTaskScope === "all") return groups;
    return groups
      .filter((group) => codeMapTaskScopeNodeIds.has(group.summary.node.id))
      .map((group) => {
        const scopedFiles = group.files.filter((file) => codeMapTaskScopeNodeIds.has(file.id));
        return {
          ...group,
          files: scopedFiles,
          hiddenFileCount: Math.max(0, group.hiddenFileCount + group.files.length - scopedFiles.length),
        };
      });
  }, [codeMapTaskScope, codeMapTaskScopeNodeIds, productGraph]);
  const codeMapDependencyHotspots = useMemo(() => {
    if (!productGraph) return [];
    const hotspots = buildCodeMapDependencyHotspots(productGraph);
    return codeMapTaskScope === "all"
      ? hotspots
      : hotspots.filter((hotspot) => codeMapTaskScopeNodeIds.has(hotspot.node.id));
  }, [codeMapTaskScope, codeMapTaskScopeNodeIds, productGraph]);
  const codeMapHasData = codeMapSummary.fileCount + codeMapSummary.symbolCount + codeMapSummary.communityCount > 0;
  const productIntentNodeCount = productGraph
    ? (
        (productGraph.summary.nodesByKind.feature ?? 0) +
        (productGraph.summary.nodesByKind.user_story ?? 0) +
        (productGraph.summary.nodesByKind.requirement ?? 0) +
        (productGraph.summary.nodesByKind.acceptance_criterion ?? 0) +
        (productGraph.summary.nodesByKind.task ?? 0)
      )
    : 0;
  const productGraphHasEmptyIntentGuidance =
    codeMapHasData &&
    productIntentNodeCount === 0 &&
    acceptanceEvidenceHealth.acceptanceCriteriaCount === 0 &&
    readyTaskCandidateHealth.plannedTaskCount === 0;
  const codeMapTaskScopeOptions = useMemo(() => {
    if (!productGraph) {
      return PRODUCT_GRAPH_TASK_SCOPE_DEFINITIONS.map((definition) => ({ ...definition, count: 0 }));
    }
    return PRODUCT_GRAPH_TASK_SCOPE_DEFINITIONS.map((definition) => {
      const scopedNodeIds = definition.id === "all"
        ? new Set(productGraph.nodes.filter(isCodeMapNode).map((node) => node.id))
        : buildProductGraphTaskScopeNodeIds(productGraph, definition.id);
      const count = productGraph.nodes.filter((node) => node.kind === "code_file" && scopedNodeIds.has(node.id)).length;
      return { ...definition, count };
    });
  }, [productGraph]);
  const activeTaskScopeOption = codeMapTaskScopeOptions.find((definition) => definition.id === codeMapTaskScope);
  const activeTaskScopeDefinition = activeTaskScopeOption ?? PRODUCT_GRAPH_TASK_SCOPE_DEFINITIONS[0]!;
  const codeMapTaskScopeHasNoFiles =
    codeMapTaskScopeActive && codeMapHasData && (activeTaskScopeOption?.count ?? 0) === 0;
  const firstDependencyCycle = codeMapArchitectureHealth.dependencyCycles[0];
  const dependencyCycleCountLabel = codeMapArchitectureHealth.dependencyCycleSearchLimited
    ? codeMapArchitectureHealth.dependencyCycleCount > 0
      ? `${codeMapArchitectureHealth.dependencyCycleCount}+`
      : "Limited"
    : codeMapArchitectureHealth.hasMoreDependencyCycles
      ? `${codeMapArchitectureHealth.dependencyCycleCount}+`
      : undefined;
  const dependencyCycleDetail = firstDependencyCycle
    ? firstDependencyCycle.nodes.map((node) => node.title).join(" -> ")
    : codeMapArchitectureHealth.dependencyCycleSearchLimited
      ? "Cycle search reached the safety limit before finding a cycle."
      : "No file dependency cycles detected.";
  const codeMapQuickFilterOptions: Array<{
    value: CodeMapQuickFilter;
    label: string;
    count: number;
    countLabel?: string;
  }> = [
    {
      value: "dependencies",
      label: "Module dependencies",
      count: codeMapSummary.dependencyEdgeCount,
    },
    {
      value: "semantic",
      label: "Semantic symbol links",
      count: codeMapSummary.semanticEdgeCount,
    },
    {
      value: "cycles",
      label: "Dependency cycles",
      count: codeMapArchitectureHealth.dependencyCycleCount,
      countLabel: dependencyCycleCountLabel,
    },
    {
      value: "unresolved",
      label: "Unresolved dependencies",
      count: codeMapArchitectureHealth.unresolvedFileCount,
    },
    {
      value: "external",
      label: "External packages",
      count: codeMapArchitectureHealth.externalFileCount,
    },
    {
      value: "orphans",
      label: "Orphan files",
      count: codeMapArchitectureHealth.orphanFileCount,
    },
    {
      value: "freshness",
      label: "Stale/missing map",
      count: codeMapArchitectureHealth.staleCodeNodeCount,
    },
  ];
  const codeMapHealthCards: Array<{
    value: CodeMapQuickFilter;
    label: string;
    count: number;
    countLabel?: string;
    detail: string;
    tone: string;
    explorerSelection?: CodeMapExplorerSelection;
  }> = [
    {
      value: "cycles",
      label: "Dependency cycles",
      count: codeMapArchitectureHealth.dependencyCycleCount,
      countLabel: dependencyCycleCountLabel,
      detail: dependencyCycleDetail,
      tone: codeMapArchitectureHealth.dependencyCycleCount > 0
        ? "#fb7185"
        : codeMapArchitectureHealth.dependencyCycleSearchLimited
          ? "#fbbf24"
          : "#86efac",
      explorerSelection: { mode: "cycle", cycleIndex: 0 },
    },
    {
      value: "unresolved",
      label: "Unresolved dependencies",
      count: codeMapArchitectureHealth.unresolvedFileCount,
      detail: codeMapArchitectureHealth.unresolvedFiles[0]?.title ?? "All tracked file imports resolve.",
      tone: codeMapArchitectureHealth.unresolvedFileCount > 0 ? "#fbbf24" : "#86efac",
      explorerSelection: { mode: "unresolved" },
    },
    {
      value: "external",
      label: "External packages",
      count: codeMapArchitectureHealth.externalFileCount,
      detail: codeMapArchitectureHealth.externalFiles[0]?.title ?? "No external package usage recorded.",
      tone: codeMapArchitectureHealth.externalFileCount > 0 ? "#7dd3fc" : "#86efac",
      explorerSelection: { mode: "external" },
    },
    {
      value: "orphans",
      label: "Orphan files",
      count: codeMapArchitectureHealth.orphanFileCount,
      detail: codeMapArchitectureHealth.orphanFiles[0]?.title ?? "All code files have an explicit code or product link.",
      tone: codeMapArchitectureHealth.orphanFileCount > 0 ? "#fbbf24" : "#86efac",
      explorerSelection: { mode: "orphans" },
    },
    {
      value: "freshness",
      label: "Stale/missing map",
      count: codeMapArchitectureHealth.staleCodeNodeCount,
      detail: codeMapFreshnessHealthCopy,
      tone: codeMapFreshnessHealthTone,
    },
  ];

  const resolvedEdgeSourceNodeId =
    edgeNodeOptions.find((node) => node.id === newEdgeSourceNodeId)?.id ?? edgeNodeOptions[0]?.id ?? "";
  const edgeTargetOptions = edgeNodeOptions.filter((node) => node.id !== resolvedEdgeSourceNodeId);
  const resolvedEdgeTargetNodeId =
    edgeTargetOptions.find((node) => node.id === newEdgeTargetNodeId)?.id ?? edgeTargetOptions[0]?.id ?? "";
  const createNodeDisabled = createNodePending || productGraphLoading || !newNodeTitle.trim();
  const createEdgeDisabled =
    createEdgePending ||
    productGraphLoading ||
    edgeNodeOptions.length < 2 ||
    !resolvedEdgeSourceNodeId ||
    !resolvedEdgeTargetNodeId ||
    resolvedEdgeSourceNodeId === resolvedEdgeTargetNodeId;
  const createBundleDisabled =
    createBundlePending ||
    productGraphLoading ||
    !bundleFeatureTitle.trim() ||
    bundleStoryTitles.some((title) => !title.trim()) ||
    bundleCriterionTitles.some((title) => !title.trim()) ||
    bundleTaskTitles.some((title) => !title.trim());
  const handoffGenerateDisabled = productGraphHandoffLoading || productGraphLoading || !onGenerateHandoff;
  const handoffWriteDisabled = productGraphHandoffWriting || productGraphLoading || !onWriteHandoff;
  const handoffPreview = productGraphHandoff?.markdown.split("\n").slice(0, 18).join("\n") ?? "";
  const handoffTrustLines = productGraphHandoff
    ? [
        productGraphHandoff.summary.workspaceRoot
          ? `Workspace: ${productGraphHandoff.summary.workspaceRoot}`
          : "Workspace: not reported yet",
        `Product Graph: ${productGraphHandoff.summary.productGraphId ?? productGraph?.productGraphId ?? "default"}`,
        productGraphHandoff.summary.latestCodeScanUpdatedAt
          ? `Scan: ${productGraphHandoff.summary.latestCodeScanUpdatedAt}; ${productGraphHandoff.summary.codeFileCount} files, ${productGraphHandoff.summary.codeSymbolCount} symbols`
          : `Scan: no timestamp; ${productGraphHandoff.summary.codeFileCount} files, ${productGraphHandoff.summary.codeSymbolCount} symbols`,
        `Semantic: ${productGraphHandoff.summary.semanticAnalysisSucceeded === true ? "succeeded" : productGraphHandoff.summary.semanticAnalysisSucceeded === false ? "fallback" : "not reported"}; ${productGraphHandoff.summary.semanticResolutionCount ?? 0} resolutions, ${productGraphHandoff.summary.semanticEdgeCount ?? 0} edges`,
        productGraphHandoff.summary.workspacePathCheck?.warning,
      ].filter((line): line is string => Boolean(line))
    : [];
  const codebaseScanDisabled = codebaseScanPending || productGraphLoading || !onScanCodebase;
  const visibleCodebaseScanProgress = codebaseScanPending || codebaseScanProgress?.phase === "completed"
    ? codebaseScanProgress
    : codebaseScanProgress;
  const codebaseScanProgressLine = formatScanProgressLine(visibleCodebaseScanProgress);
  const codebaseScanBreakerWarning = scanBreakerWarning(visibleCodebaseScanProgress);
  const codebaseScanProgressPercent = visibleCodebaseScanProgress
    ? Math.max(
        3,
        Math.min(
          100,
          (visibleCodebaseScanProgress.filesScanned / Math.max(1, visibleCodebaseScanProgress.breakers.limits.maxFiles)) * 100
        )
      )
    : 0;
  const specKitImportDisabled = specKitImportPending || productGraphLoading || !onImportSpecKit;
  const resolvedRunLinkGraphId =
    completedRunOptions.find((run) => run.graphId === runLinkGraphId)?.graphId ?? completedRunOptions[0]?.graphId ?? "";
  const runLinkDisabled =
    runLinkPending ||
    productGraphLoading ||
    !onLinkRun ||
    !selectedNode ||
    selectedNode.kind !== "task" ||
    !resolvedRunLinkGraphId;
  const acceptCodexPlanDisabled =
    acceptCodexPlanPending ||
    productGraphLoading ||
    selectedCodexPlanLoading ||
    !selectedCodexPlan ||
    !onAcceptCodexPlan;
  const selectedNodeFeedbackId = selectedNode?.id ?? "";
  const visibleRunLinkError = runLinkFeedbackNodeId === selectedNodeFeedbackId ? runLinkError : "";
  const visibleRunLinkMessage = runLinkFeedbackNodeId === selectedNodeFeedbackId ? runLinkMessage : "";
  const selectedTaskExecutionDriftCopy = selectedTaskExecutionEvidence?.hasLinkedRunDrift
    ? "Completed task has no linked OpenAgentGraph run."
    : selectedTaskExecutionEvidence?.hasLinkedEvidenceDrift
      ? "Completed task has a linked run but no evidence node."
      : "";
  const selectedRunDetails = selectedNode?.kind === "agent_run"
    ? visibleMetadataItems([
      ["Graph", metadataText(selectedNode, "graphId")],
      ["Run state", metadataText(selectedNode, "runControlState")],
      ["Graph status", metadataText(selectedNode, "graphStatus")],
      ["Completed nodes", metadataText(selectedNode, "completedNodeCount")],
      ["Planned nodes", metadataText(selectedNode, "plannedNodeCount")],
      ["Pass rate", metadataPercentText(selectedNode, "passRate")],
      ["Evidence coverage", metadataPercentText(selectedNode, "evidenceCoverageRate")],
      ["Last event", metadataText(selectedNode, "lastEventSequence")],
    ])
    : [];
  const selectedEvidenceDetails = selectedNode?.kind === "evidence"
    ? visibleMetadataItems([
      ["Graph", metadataText(selectedNode, "graphId")],
      ["Graph status", metadataText(selectedNode, "graphStatus")],
      ["Changed files", metadataText(selectedNode, "changedFileCount")],
      ["Commands", metadataText(selectedNode, "commandCount")],
      ["Failed commands", metadataText(selectedNode, "failingCommandCount")],
      ["Test commands", metadataText(selectedNode, "testCommandCount")],
      ["Passing tests", metadataText(selectedNode, "passingTestCommandCount")],
      ["Tool calls", metadataText(selectedNode, "toolCallCount")],
      ["Pass rate", metadataPercentText(selectedNode, "passRate")],
      ["Evidence coverage", metadataPercentText(selectedNode, "evidenceCoverageRate")],
      ["Last event", metadataText(selectedNode, "lastEventSequence")],
    ])
    : [];
  const selectedPlanDetails = selectedNode?.kind === "plan"
    ? visibleMetadataItems([
      ["Task node", metadataText(selectedNode, "taskNodeId")],
      ["Prompt hash", metadataText(selectedNode, "promptHash")],
    ])
    : [];
  const selectedCodeMapDetails = selectedNode && isCodeMapNode(selectedNode)
    ? codeMapNodeDetails(selectedNode)
    : [];
  const selectedCodeMapImpact = useMemo(() => {
    if (!productGraph || !selectedNode || !isCodeMapNode(selectedNode)) return null;
    return buildCodeMapImpactSummary(productGraph, selectedNode);
  }, [productGraph, selectedNode]);
  const selectedCodeMapImpactPathPreview = useMemo(() => {
    if (!productGraph || !selectedNode || !isCodeMapNode(selectedNode)) return null;
    return buildCodeMapImpactPathPreview(productGraph, selectedNode);
  }, [productGraph, selectedNode]);
  const selectedCodeMapImpactSections = selectedCodeMapImpact
    ? [
        { key: "imports", label: "Direct imports", section: selectedCodeMapImpact.imports, tone: "#fde68a" },
        { key: "imported-by", label: "Direct imported by", section: selectedCodeMapImpact.importedBy, tone: "#fcd34d" },
        { key: "semantic", label: "Semantic relationships", section: selectedCodeMapImpact.semanticRelationships, tone: "#67e8f9" },
        { key: "evidence", label: "Linked product evidence", section: selectedCodeMapImpact.linkedEvidence, tone: "#a7f3d0" },
      ]
    : [];
  const selectedCodeMapImpactPathSections = selectedCodeMapImpactPathPreview
    ? [
        { key: "upstream", label: "Upstream files", section: selectedCodeMapImpactPathPreview.upstreamFiles, tone: "#fcd34d" },
        { key: "downstream", label: "Downstream files", section: selectedCodeMapImpactPathPreview.downstreamFiles, tone: "#fde68a" },
        { key: "evidence", label: "Linked evidence", section: selectedCodeMapImpactPathPreview.linkedEvidence, tone: "#a7f3d0" },
      ]
    : [];
  const selectedCommunityMembers = useMemo(() => {
    if (!productGraph || selectedNode?.kind !== "code_community") return [];
    return productGraph.edges
      .filter((edge) => edge.kind === "belongs_to" && edge.targetNodeId === selectedNode.id)
      .map((edge) => nodesById.get(edge.sourceNodeId))
      .filter((node): node is ProductGraphProjectionNode => Boolean(node && node.kind === "code_file"))
      .slice(0, 8);
  }, [nodesById, productGraph, selectedNode]);
  const selectedFileDependencyEdges = useMemo(() => {
    if (!productGraph || selectedNode?.kind !== "code_file") return [];
    return productGraph.edges
      .filter((edge) => codeMapFilterAllowsEdge(edge, codeMapFilters, nodesById))
      .filter((edge) => codeMapTaskScopeAllowsEdge(edge, nodesById, codeMapTaskScope, codeMapTaskScopeNodeIds))
      .filter((edge) => isDependencyCodeEdge(edge, nodesById))
      .filter((edge) => edge.sourceNodeId === selectedNode.id || edge.targetNodeId === selectedNode.id)
      .slice(0, 8);
  }, [codeMapFilters, codeMapTaskScope, codeMapTaskScopeNodeIds, nodesById, productGraph, selectedNode]);
  const selectedSemanticCodeEdges = useMemo(() => {
    if (!productGraph || selectedNode?.kind !== "code_symbol") return [];
    return productGraph.edges
      .filter((edge) => codeMapFilterAllowsEdge(edge, codeMapFilters, nodesById))
      .filter((edge) => codeMapTaskScopeAllowsEdge(edge, nodesById, codeMapTaskScope, codeMapTaskScopeNodeIds))
      .filter((edge) => isSemanticCodeEdge(edge, nodesById))
      .filter((edge) => edge.sourceNodeId === selectedNode.id || edge.targetNodeId === selectedNode.id)
      .slice(0, 8);
  }, [codeMapFilters, codeMapTaskScope, codeMapTaskScopeNodeIds, nodesById, productGraph, selectedNode]);
  const selectedNodeDescription = selectedNode
    ? isCodeMapNode(selectedNode)
      ? selectedNode.summary
      : selectedNode.body || selectedNode.summary
    : undefined;

  function clearRunLinkFeedback() {
    setRunLinkFeedbackNodeId("");
    setRunLinkError("");
    setRunLinkMessage("");
  }

  function clearCreateBundleFeedback() {
    setCreateBundleError("");
    setCreateBundleMessage("");
  }

  function clearSpecKitImportFeedback() {
    setSpecKitImportError("");
    setSpecKitImportMessage("");
  }

  function clearCodebaseScanFeedback() {
    setCodebaseScanError("");
    setCodebaseScanMessage("");
  }

  function updateBundleTitle(
    setTitles: Dispatch<SetStateAction<string[]>>,
    index: number,
    value: string
  ) {
    setTitles((titles) => titles.map((title, titleIndex) => (titleIndex === index ? value : title)));
    clearCreateBundleFeedback();
  }

  function addBundleTitle(setTitles: Dispatch<SetStateAction<string[]>>) {
    setTitles((titles) => (titles.length >= MAX_BUNDLE_ITEM_FIELDS ? titles : [...titles, ""]));
    clearCreateBundleFeedback();
  }

  function removeBundleTitle(
    setTitles: Dispatch<SetStateAction<string[]>>,
    index: number
  ) {
    setTitles((titles) => (titles.length <= 1 ? titles : titles.filter((_, titleIndex) => titleIndex !== index)));
    clearCreateBundleFeedback();
  }

  async function handleCreateNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newNodeTitle.trim();
    const summary = newNodeSummary.trim();
    if (!title) {
      setCreateNodeMessage("");
      setCreateNodeError("Title is required.");
      return;
    }

    setCreateNodePending(true);
    setCreateNodeError("");
    setCreateNodeMessage("");
    try {
      const createdNode = await onCreateNode({
        kind: newNodeKind,
        status: newNodeStatus,
        title,
        summary: summary || undefined,
      });
      const latestProductGraphError = getProductGraphError?.() ?? productGraphError;
      setNewNodeTitle("");
      setNewNodeSummary("");
      if (isProductGraphNodeRefreshWarning(latestProductGraphError)) {
        setCreateNodeError(latestProductGraphError);
        return;
      }
      setQuery("");
      setKindFilter(newNodeKind);
      setStatusFilter("all");
      updateSelectedNodeId(createdNode.id);
      setCreateNodeMessage("Node created.");
    } catch (error) {
      setCreateNodeError(error instanceof Error && error.message ? error.message : "Product graph node could not be created.");
    } finally {
      setCreateNodePending(false);
    }
  }

  async function handleCreateEdge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceNodeId = resolvedEdgeSourceNodeId;
    const targetNodeId = resolvedEdgeTargetNodeId;
    const label = newEdgeLabel.trim();
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
      setCreateEdgeMessage("");
      setCreateEdgeError("Choose two different intent nodes.");
      return;
    }

    setCreateEdgePending(true);
    setCreateEdgeError("");
    setCreateEdgeMessage("");
    try {
      const createdEdge = await onCreateEdge({
        sourceNodeId,
        targetNodeId,
        kind: newEdgeKind,
        label: label || undefined,
      });
      const latestProductGraphError = getProductGraphError?.() ?? productGraphError;
      setNewEdgeLabel("");
      if (isProductGraphEdgeRefreshWarning(latestProductGraphError)) {
        setCreateEdgeError(latestProductGraphError);
        return;
      }
      const sourceNode = edgeNodeOptions.find((node) => node.id === createdEdge.sourceNodeId);
      const sourceKindFilter =
        sourceNode && KIND_FILTERS.some((filter) => filter.value === sourceNode.kind) ? sourceNode.kind : "all";
      setQuery("");
      setKindFilter(sourceKindFilter);
      setStatusFilter("all");
      updateSelectedNodeId(createdEdge.sourceNodeId);
      setCreateEdgeMessage("Relationship created.");
    } catch (error) {
      setCreateEdgeError(error instanceof Error && error.message ? error.message : "Product graph edge could not be created.");
    } finally {
      setCreateEdgePending(false);
    }
  }

  function focusProductGraphNode(node: ProductGraphProjectionNode) {
    const nextFocusState = productGraphFocusStateForNode(node);
    setCodeMapExplorerSelection(null);
    setCodeMapQuickFilter(nextFocusState.codeMapQuickFilter);
    setCodeMapFilters((filters) => codeMapFiltersForFocusedNode(node, filters));
    setQuery(nextFocusState.query);
    setKindFilter(nextFocusState.kindFilter);
    setStatusFilter(nextFocusState.statusFilter);
    updateSelectedNodeId(nextFocusState.selectedNodeId);
  }

  function updateCodeMapFilter(key: keyof CodeMapFilterState, value: boolean) {
    setCodeMapFilters((filters) => ({ ...filters, [key]: value }));
  }

  function updateCodeMapQuickFilter(nextFilter: CodeMapQuickFilter) {
    setCodeMapExplorerSelection(null);
    setCodeMapQuickFilter((currentFilter) => (currentFilter === nextFilter ? "all" : nextFilter));
  }

  function updateCodeMapTaskScope(nextScope: ProductGraphTaskScopeId) {
    setCodeMapExplorerSelection(null);
    setCodeMapTaskScope(nextScope);
  }

  function openCodeMapExplorer(selection: CodeMapExplorerSelection) {
    if (!productGraph) return;
    const explorerView = buildCodeMapExplorerView(productGraph, selection);
    if (!explorerView) return;
    setCodeMapExplorerSelection(selection);
    updateSelectedNodeId(explorerView.focusNodeId ?? explorerView.itemNodes[0]?.id ?? null);
  }

  function clearCodeMapExplorer() {
    setCodeMapExplorerSelection(null);
  }

  async function handleLoadTrace() {
    if (!selectedNode || !onLoadTrace) return;
    try {
      await onLoadTrace(selectedNode.id);
    } catch {
      // The store publishes productGraphTraceError for the visible UI state.
    }
  }

  async function handleLoadCodexPlan() {
    if (!selectedNode || selectedNode.kind !== "task" || !onLoadCodexPlan) return;
    try {
      await onLoadCodexPlan(selectedNode.id);
    } catch {
      // The store publishes productGraphCodexPlanError for the visible UI state.
    }
  }

  async function handleAcceptCodexPlan() {
    if (!selectedNode || selectedNode.kind !== "task" || !selectedCodexPlan || !onAcceptCodexPlan) return;

    const taskNodeId = selectedNode.id;
    setAcceptCodexPlanTaskNodeId(taskNodeId);
    setAcceptCodexPlanPending(true);
    setAcceptCodexPlanError("");
    setAcceptCodexPlanMessage("");
    try {
      const acceptedPlan = await onAcceptCodexPlan({
        taskNodeId,
        promptHash: await hashCodexPlanPrompt(selectedCodexPlan.prompt),
        title: `Codex plan for ${selectedNode.title}`,
        summary: `Accepted Codex planning prompt for ${selectedNode.title}.`,
      });
      const latestProductGraphError = getProductGraphError?.() ?? productGraphError;
      if (isProductGraphCodexPlanRefreshWarning(latestProductGraphError)) {
        if (selectedNodeIdRef.current === taskNodeId) {
          setAcceptCodexPlanError(latestProductGraphError);
        }
        return;
      }
      if (selectedNodeIdRef.current !== taskNodeId) return;
      setQuery("");
      setKindFilter("plan");
      setStatusFilter("all");
      updateSelectedNodeId(acceptedPlan.node.id);
      setAcceptCodexPlanMessage("Plan accepted.");
    } catch (error) {
      setAcceptCodexPlanError(
        error instanceof Error && error.message ? error.message : "Product graph Codex plan could not be accepted."
      );
    } finally {
      setAcceptCodexPlanPending(false);
    }
  }

  async function handleLinkRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedNode || selectedNode.kind !== "task") {
      setRunLinkFeedbackNodeId("");
      setRunLinkMessage("");
      setRunLinkError("Select a product task before linking a run.");
      return;
    }
    if (!resolvedRunLinkGraphId) {
      setRunLinkFeedbackNodeId(selectedNode.id);
      setRunLinkMessage("");
      setRunLinkError("No completed OpenAgentGraph runs are available to link.");
      return;
    }
    if (!onLinkRun) return;

    const linkedTaskNodeId = selectedNode.id;
    setRunLinkPending(true);
    setRunLinkFeedbackNodeId(linkedTaskNodeId);
    setRunLinkError("");
    setRunLinkMessage("");
    try {
      await onLinkRun({
        graphId: resolvedRunLinkGraphId,
        taskNodeId: linkedTaskNodeId,
      });
      const latestProductGraphError = getProductGraphError?.() ?? productGraphError;
      if (isProductGraphRunLinkRefreshWarning(latestProductGraphError)) {
        setRunLinkFeedbackNodeId(linkedTaskNodeId);
        setRunLinkError(latestProductGraphError);
        return;
      }
      if (onLoadTrace && selectedNodeIdRef.current === linkedTaskNodeId) {
        try {
          void onLoadTrace(linkedTaskNodeId).catch(() => {
            // The store publishes productGraphTraceError for the visible UI state.
          });
        } catch {
          // The store publishes productGraphTraceError for the visible UI state.
        }
      }
      setRunLinkFeedbackNodeId(linkedTaskNodeId);
      setRunLinkMessage("Run linked.");
    } catch (error) {
      setRunLinkFeedbackNodeId(linkedTaskNodeId);
      setRunLinkError(error instanceof Error && error.message ? error.message : "Product graph run link could not be created.");
    } finally {
      setRunLinkPending(false);
    }
  }

  async function handleCreateIntentBundle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const featureTitle = bundleFeatureTitle.trim();
    const featureSummary = bundleFeatureSummary.trim();
    const storyTitles = bundleStoryTitles.map((title) => title.trim());
    const criterionTitles = bundleCriterionTitles.map((title) => title.trim());
    const taskTitles = bundleTaskTitles.map((title) => title.trim());
    if (
      !featureTitle ||
      storyTitles.some((title) => !title) ||
      criterionTitles.some((title) => !title) ||
      taskTitles.some((title) => !title)
    ) {
      setCreateBundleMessage("");
      setCreateBundleError("Feature, story, criterion, and task titles are required.");
      return;
    }

    setCreateBundlePending(true);
    setCreateBundleError("");
    setCreateBundleMessage("");
    try {
      const bundle = await onCreateIntentBundle({
        feature: {
          title: featureTitle,
          summary: featureSummary || undefined,
        },
        userStories: storyTitles.map((title) => ({ title })),
        acceptanceCriteria: criterionTitles.map((title) => ({ title })),
        tasks: taskTitles.map((title) => ({ title })),
      });
      const latestProductGraphError = getProductGraphError?.() ?? productGraphError;
      setBundleFeatureTitle("");
      setBundleFeatureSummary("");
      setBundleStoryTitles([""]);
      setBundleCriterionTitles([""]);
      setBundleTaskTitles([""]);
      if (isProductGraphIntentBundleRefreshWarning(latestProductGraphError)) {
        setCreateBundleError(latestProductGraphError);
        return;
      }
      const createdFeature = bundle.nodes.find((node) => node.kind === "feature") ?? bundle.nodes[0];
      setQuery("");
      setKindFilter("feature");
      setStatusFilter("all");
      updateSelectedNodeId(createdFeature?.id ?? null);
      setCreateBundleMessage("Feature bundle created.");
    } catch (error) {
      setCreateBundleError(
        error instanceof Error && error.message ? error.message : "Product graph intent bundle could not be created."
      );
    } finally {
      setCreateBundlePending(false);
    }
  }

  async function handleImportSpecKit() {
    if (!onImportSpecKit) return;

    setSpecKitImportPending(true);
    clearSpecKitImportFeedback();
    try {
      const result = await onImportSpecKit();
      const latestProductGraphError = getProductGraphError?.() ?? productGraphError;
      if (isProductGraphSpecKitImportRefreshWarning(latestProductGraphError)) {
        setSpecKitImportError(latestProductGraphError);
        return;
      }
      setSpecKitImportMessage(`${result.message} ${formatSpecKitImportResult(result)}.`);
    } catch (error) {
      setSpecKitImportError(error instanceof Error && error.message ? error.message : "Spec Kit import could not be completed.");
    } finally {
      setSpecKitImportPending(false);
    }
  }

  async function handleGenerateHandoff() {
    if (!onGenerateHandoff) return;
    try {
      await onGenerateHandoff();
    } catch {
      // The store publishes productGraphHandoffError for the visible UI state.
    }
  }

  async function handleWriteHandoff() {
    if (!onWriteHandoff) return;
    try {
      await onWriteHandoff();
    } catch {
      // The store publishes productGraphHandoffError for the visible UI state.
    }
  }

  async function handleScanCodebase() {
    if (!onScanCodebase) return;

    setCodebaseScanPending(true);
    clearCodebaseScanFeedback();
    try {
      const result = await onScanCodebase();
      const latestProductGraphError = getProductGraphError?.() ?? productGraphError;
      if (isProductGraphCodebaseScanRefreshWarning(latestProductGraphError)) {
        setCodebaseScanError(latestProductGraphError);
        return;
      }
      setCodebaseScanMessage(formatCodebaseScanFeedback(result));
    } catch (error) {
      setCodebaseScanError(error instanceof Error && error.message ? error.message : "Codebase scan could not be completed.");
    } finally {
      setCodebaseScanPending(false);
    }
  }

  if (!productGraph && productGraphError) {
    return (
      <div style={{ flex: 1, background: "#0f1117", color: "#e2e8f0", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: "min(520px, 100%)", border: "1px solid #334155", borderRadius: 16, padding: 20, background: "#111827" }}>
          <div style={{ color: "#f59e0b", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Intent graph unavailable
          </div>
          <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800 }}>The product graph could not be loaded.</div>
          <div style={{ marginTop: 8, color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>{productGraphError}</div>
          <button
            onClick={onRefresh}
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
            Retry load
          </button>
        </div>
      </div>
    );
  }

  if (!productGraph) {
    return (
      <div style={{ flex: 1, background: "#0f1117", color: "#94a3b8", display: "grid", placeItems: "center" }}>
        {productGraphLoading ? "Loading intent graph..." : "Preparing intent graph..."}
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        background: "#0f1117",
        color: "#e2e8f0",
        display: "grid",
      }}
      className="product-graph-shell"
    >
      <style>{PRODUCT_GRAPH_LAYOUT_CSS}</style>
      <aside
        className="product-graph-sidebar"
        style={{
          borderRight: "1px solid #1f2937",
          background: "#111827",
          minHeight: 0,
          overflow: "auto",
          padding: 18,
          display: "grid",
          alignContent: "start",
          gap: 16,
        }}
      >
        <div>
          <div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Intent graph
          </div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900 }}>
            Product intent
          </div>
          <div style={{ marginTop: 8, color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
            Planned product work, questions, criteria, and implementation tasks.
          </div>
        </div>

        {productGraphPreviewMessage ? (
          <div
            role="note"
            aria-label="Product graph preview mode"
            style={{
              background: "#172554",
              border: "1px solid #2563eb",
              borderRadius: 10,
              color: "#bfdbfe",
              fontSize: 12,
              fontWeight: 800,
              lineHeight: 1.45,
              padding: 10,
            }}
          >
            {productGraphPreviewMessage} Editing and backend refresh controls are disabled in this view.
          </div>
        ) : null}

        <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
          {[
            ["Nodes", productGraph.summary.nodeCount],
            ["Links", productGraph.summary.edgeCount],
            ["Questions", productGraph.summary.unresolvedOpenQuestionCount],
            ["Blocked", productGraph.summary.blockedTaskCount],
          ].map(([label, value]) => (
            <div key={label} style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 10, padding: 10 }}>
              <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
              <div style={{ marginTop: 4, fontSize: 20, fontWeight: 900 }}>{value}</div>
            </div>
          ))}
        </div>

        <div
          role="group"
          aria-label="Work next quick action"
          style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}
        >
          <div style={{ color: workNextRecommendationTone, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>Work next</div>
          <div style={{ color: workNextRecommendationTone, fontSize: 12, fontWeight: 800, lineHeight: 1.45 }}>
            {workNextRecommendationCopy}
          </div>
          {primaryReadyTaskCandidate ? (
            <button
              type="button"
              aria-label={`Focus ${primaryReadyTaskCandidate.title} work next quick action`}
              onClick={() => focusProductGraphNode(primaryReadyTaskCandidate)}
              style={{
                background: "#111827",
                border: "1px solid #14532d",
                borderRadius: 8,
                color: "#86efac",
                cursor: "pointer",
                display: "grid",
                fontSize: 11,
                fontWeight: 800,
                gap: 4,
                lineHeight: 1.35,
                padding: "7px 9px",
                textAlign: "left",
                wordBreak: "break-word",
              }}
            >
              <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{primaryReadyTaskCandidate.title}</span>
              <span>Primary ready candidate</span>
            </button>
          ) : primaryBlockedTaskGap ? (
            <button
              type="button"
              aria-label={`Focus ${primaryBlockedTaskGap.title} blocker quick action`}
              onClick={() => focusProductGraphNode(primaryBlockedTaskGap)}
              style={{
                background: "#111827",
                border: "1px solid #92400e",
                borderRadius: 8,
                color: "#fbbf24",
                cursor: "pointer",
                display: "grid",
                fontSize: 11,
                fontWeight: 800,
                gap: 4,
                lineHeight: 1.35,
                padding: "7px 9px",
                textAlign: "left",
                wordBreak: "break-word",
              }}
            >
              <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{primaryBlockedTaskGap.title}</span>
              <span>Clear blocker first</span>
            </button>
          ) : null}
        </div>

        <div
          role="group"
          aria-label="Product health"
          style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 12, padding: 12, display: "grid", gap: 9 }}
        >
          <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Product health
          </div>
          <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
            {[
              ["Evidence coverage", acceptanceEvidenceCoverageValue],
              ["Features at risk", acceptanceEvidenceHealth.featuresNeedingEvidenceCount],
              ["Criteria needing evidence", acceptanceEvidenceHealth.criteriaNeedingEvidenceCount],
              ["Blocked tasks", productGraph.summary.blockedTaskCount],
              ["Ready tasks", readyTaskCandidateCount],
              ["Completed drift", executionDriftHealth.tasksWithDriftCount],
              ["Missing run links", executionDriftHealth.tasksMissingRunCount],
              ["Missing evidence nodes", executionDriftHealth.tasksMissingEvidenceCount],
              ["Missing test evidence", executionTestEvidenceHealth.tasksMissingTestEvidenceCount],
              ["Code missing intent", codeIntentDriftHealth.codeNodesMissingIntentCount],
              ["Code map gaps", codeMapFreshnessHealth.codeNodesChangedAfterCodeScanCount],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "#111827", border: "1px solid #263244", borderRadius: 8, padding: 8 }}>
                <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                <div style={{ marginTop: 3, color: "#e2e8f0", fontSize: 16, fontWeight: 900 }}>{value}</div>
              </div>
            ))}
          </div>
          <div
            style={{
              color: acceptanceEvidenceHealthTone,
              fontSize: 12,
              lineHeight: 1.45,
              fontWeight: 800,
            }}
          >
            {acceptanceEvidenceHealth.acceptanceCriteriaCount > 0
              ? `${acceptanceEvidenceHealth.coveragePercent}% acceptance evidence coverage. ${acceptanceEvidenceHealthCopy}`
              : acceptanceEvidenceHealthCopy}
          </div>
          {productGraphHasEmptyIntentGuidance ? (
            <div
              role="group"
              aria-label="Product intent empty guidance"
              style={{
                background: "rgba(14, 116, 144, 0.16)",
                border: "1px solid #155e75",
                borderRadius: 10,
                color: "#bae6fd",
                display: "grid",
                fontSize: 12,
                gap: 5,
                lineHeight: 1.45,
                padding: 10,
              }}
            >
              <div style={{ color: "#e0f2fe", fontSize: 12, fontWeight: 900 }}>
                Code Map is ready; product intent is empty.
              </div>
              <div>
                Import Spec Kit artifacts or create the first feature bundle so planning, acceptance evidence, and gate checks have a product story to follow.
              </div>
              <div style={{ color: "#93c5fd", fontWeight: 800 }}>
                The code scan still helps navigation; it is not a replacement for tasks, features, or acceptance criteria.
              </div>
            </div>
          ) : null}
          <div
            style={{
              color: blockedTaskHealthTone,
              fontSize: 12,
              lineHeight: 1.45,
              fontWeight: 800,
            }}
          >
            {blockedTaskHealthCopy}
          </div>
          <div
            style={{
              color: readyTaskHealthTone,
              fontSize: 12,
              lineHeight: 1.45,
              fontWeight: 800,
            }}
          >
            {readyTaskHealthCopy}
          </div>
          <div
            style={{
              color: executionDriftHealthTone,
              fontSize: 12,
              lineHeight: 1.45,
              fontWeight: 800,
            }}
          >
            {executionDriftHealthCopy}
          </div>
          <div
            style={{
              color: executionTestEvidenceHealthTone,
              fontSize: 12,
              lineHeight: 1.45,
              fontWeight: 800,
            }}
          >
            {executionTestEvidenceHealthCopy}
          </div>
          <div
            style={{
              color: codeIntentDriftHealthTone,
              fontSize: 12,
              lineHeight: 1.45,
              fontWeight: 800,
            }}
          >
            {codeIntentDriftHealthCopy}
          </div>
          <div
            role="group"
            aria-label="Codebase scan status"
            style={{ borderTop: "1px solid #263244", paddingTop: 9, display: "grid", gap: 5 }}
          >
            <div style={{ color: codeMapFreshnessHealthTone, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
              Codebase scan status
            </div>
            <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
              {[
                ["Files", codeMapSummary.fileCount],
                ["Symbols", codeMapSummary.symbolCount],
                ["Communities", codeMapSummary.communityCount],
                ["Dependencies", codeMapSummary.dependencyEdgeCount],
                ["Semantic links", codeMapSummary.semanticEdgeCount],
              ].map(([label, value]) => (
                <div key={label} style={{ background: "#111827", border: "1px solid #263244", borderRadius: 8, padding: 8 }}>
                  <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ marginTop: 3, color: "#e2e8f0", fontSize: 16, fontWeight: 900 }}>{value}</div>
                </div>
              ))}
            </div>
            <div
              style={{
                color: codeMapFreshnessHealthTone,
                fontSize: 12,
                lineHeight: 1.45,
                fontWeight: 800,
              }}
            >
              {codeMapFreshnessHealthCopy}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4, fontWeight: 800 }}>
              {CODEBASE_SCAN_SCOPE_COPY}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4, fontWeight: 800 }}>
              {codebaseScanLocationCopy}
            </div>
            <div style={{ color: "#bfdbfe", fontSize: 11, lineHeight: 1.4, fontWeight: 800 }}>
              {codebasePlanningContextCopy}
            </div>
          </div>
          <div
            role="group"
            aria-label="Work next recommendation"
            style={{ borderTop: "1px solid #263244", paddingTop: 9, display: "grid", gap: 8 }}
          >
            <div style={{ color: workNextRecommendationTone, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
              Work next
            </div>
            <div style={{ color: workNextRecommendationTone, fontSize: 12, fontWeight: 800, lineHeight: 1.45 }}>
              {workNextRecommendationCopy}
            </div>
            {primaryReadyTaskCandidate ? (
              <button
                type="button"
                aria-label={`Focus ${primaryReadyTaskCandidate.title} work next task`}
                onClick={() => focusProductGraphNode(primaryReadyTaskCandidate)}
                style={{
                  background: "#111827",
                  border: "1px solid #14532d",
                  borderRadius: 8,
                  color: "#86efac",
                  cursor: "pointer",
                  display: "grid",
                  fontSize: 11,
                  fontWeight: 800,
                  gap: 4,
                  lineHeight: 1.35,
                  padding: "6px 8px",
                  textAlign: "left",
                  wordBreak: "break-word",
                }}
              >
                <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{primaryReadyTaskCandidate.title}</span>
                <span>Primary ready candidate</span>
              </button>
            ) : primaryBlockedTaskGap ? (
              <button
                type="button"
                aria-label={`Focus ${primaryBlockedTaskGap.title} blocker to clear next`}
                onClick={() => focusProductGraphNode(primaryBlockedTaskGap)}
                style={{
                  background: "#111827",
                  border: "1px solid #92400e",
                  borderRadius: 8,
                  color: "#fbbf24",
                  cursor: "pointer",
                  display: "grid",
                  fontSize: 11,
                  fontWeight: 800,
                  gap: 4,
                  lineHeight: 1.35,
                  padding: "6px 8px",
                  textAlign: "left",
                  wordBreak: "break-word",
                }}
              >
                <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{primaryBlockedTaskGap.title}</span>
                <span>Clear blocker first</span>
              </button>
            ) : null}
          </div>
          {acceptanceEvidenceGaps.length > 0 ? (
            <div
              role="group"
              aria-label="Acceptance evidence gaps"
              style={{ borderTop: "1px solid #263244", paddingTop: 9, display: "grid", gap: 8 }}
            >
              <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                Evidence gaps
              </div>
              {acceptanceEvidenceGaps.map(({ feature, criteria }) => {
                const visibleCriteria = criteria.slice(0, ACCEPTANCE_EVIDENCE_LIMIT);
                const hiddenCriteriaCount = criteria.length - visibleCriteria.length;
                return (
                  <div key={feature.id} style={{ display: "grid", gap: 6 }}>
                    <button
                      type="button"
                      aria-label={`Focus ${feature.title} feature`}
                      onClick={() => focusProductGraphNode(feature)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#e2e8f0",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 900,
                        padding: 0,
                        textAlign: "left",
                        wordBreak: "break-word",
                      }}
                    >
                      {feature.title}
                    </button>
                    <div style={{ display: "grid", gap: 5 }}>
                      {visibleCriteria.map((criterion) => (
                        <button
                          key={criterion.id}
                          type="button"
                          aria-label={`Focus ${criterion.title} acceptance criterion`}
                          onClick={() => focusProductGraphNode(criterion)}
                          style={{
                            background: "#111827",
                            border: "1px solid #92400e",
                            borderRadius: 8,
                            color: "#fbbf24",
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 800,
                            lineHeight: 1.35,
                            padding: "6px 8px",
                            textAlign: "left",
                            wordBreak: "break-word",
                          }}
                        >
                          {criterion.title}
                        </button>
                      ))}
                      {hiddenCriteriaCount > 0 ? (
                        <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, lineHeight: 1.35 }}>
                          +{hiddenCriteriaCount} more{" "}
                          {hiddenCriteriaCount === 1 ? "criterion needs" : "criteria need"} evidence.
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {blockedTaskGaps.length > 0 ? (
            <div
              role="group"
              aria-label="Blocked task gaps"
              style={{ borderTop: "1px solid #263244", paddingTop: 9, display: "grid", gap: 8 }}
            >
              <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                Blocked tasks
              </div>
              {blockedTaskGaps.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  aria-label={`Focus ${task.title} blocked task`}
                  onClick={() => focusProductGraphNode(task)}
                  style={{
                    background: "#111827",
                    border: "1px solid #92400e",
                    borderRadius: 8,
                    color: "#fbbf24",
                    cursor: "pointer",
                    display: "grid",
                    fontSize: 11,
                    fontWeight: 800,
                    gap: 4,
                    lineHeight: 1.35,
                    padding: "6px 8px",
                    textAlign: "left",
                    wordBreak: "break-word",
                  }}
                >
                  <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{task.title}</span>
                  <span>
                    {task.blockedByNodeIds.length} open question{" "}
                    {task.blockedByNodeIds.length === 1 ? "blocker" : "blockers"}
                  </span>
                </button>
              ))}
              {blockedTaskCount > blockedTaskGaps.length ? (
                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, lineHeight: 1.35 }}>
                  +{blockedTaskCount - blockedTaskGaps.length} more{" "}
                  {blockedTaskCount - blockedTaskGaps.length === 1 ? "task is" : "tasks are"} blocked.
                </div>
              ) : null}
            </div>
          ) : null}
          {readyTaskCandidates.length > 0 ? (
            <div
              role="group"
              aria-label="Ready task candidates"
              style={{ borderTop: "1px solid #263244", paddingTop: 9, display: "grid", gap: 8 }}
            >
              <div style={{ color: "#86efac", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                Ready tasks
              </div>
              {readyTaskCandidates.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  aria-label={`Focus ${task.title} ready task`}
                  onClick={() => focusProductGraphNode(task)}
                  style={{
                    background: "#111827",
                    border: "1px solid #14532d",
                    borderRadius: 8,
                    color: "#86efac",
                    cursor: "pointer",
                    display: "grid",
                    fontSize: 11,
                    fontWeight: 800,
                    gap: 4,
                    lineHeight: 1.35,
                    padding: "6px 8px",
                    textAlign: "left",
                    wordBreak: "break-word",
                  }}
                >
                  <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{task.title}</span>
                  <span>Planned and unblocked</span>
                </button>
              ))}
              {readyTaskCandidateCount > readyTaskCandidates.length ? (
                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, lineHeight: 1.35 }}>
                  +{readyTaskCandidateCount - readyTaskCandidates.length} more planned{" "}
                  {readyTaskCandidateCount - readyTaskCandidates.length === 1 ? "task is" : "tasks are"} ready.
                </div>
              ) : null}
            </div>
          ) : null}
          {executionDriftHealth.taskGaps.length > 0 ? (
            <div
              role="group"
              aria-label="Execution drift gaps"
              style={{ borderTop: "1px solid #263244", paddingTop: 9, display: "grid", gap: 8 }}
            >
              <div style={{ color: "#fb7185", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                Execution drift
              </div>
              {executionDriftHealth.taskGaps.map(({ task, summary }) => (
                <button
                  key={task.id}
                  type="button"
                  aria-label={`Focus ${task.title} task with execution drift`}
                  onClick={() => focusProductGraphNode(task)}
                  style={{
                    background: "#111827",
                    border: "1px solid #4c1d2f",
                    borderRadius: 8,
                    color: "#fecdd3",
                    cursor: "pointer",
                    display: "grid",
                    fontSize: 11,
                    fontWeight: 800,
                    gap: 4,
                    lineHeight: 1.35,
                    padding: "6px 8px",
                    textAlign: "left",
                    wordBreak: "break-word",
                  }}
                >
                  <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{task.title}</span>
                  <span>
                    {summary.hasLinkedRunDrift ? "No linked run" : "Missing evidence node"}
                  </span>
                </button>
              ))}
              {executionDriftHealth.tasksWithDriftCount > executionDriftHealth.taskGaps.length ? (
                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, lineHeight: 1.35 }}>
                  +{executionDriftHealth.tasksWithDriftCount - executionDriftHealth.taskGaps.length} more completed{" "}
                  {executionDriftHealth.tasksWithDriftCount - executionDriftHealth.taskGaps.length === 1 ? "task needs" : "tasks need"} run evidence.
                </div>
              ) : null}
            </div>
          ) : null}
          {executionTestEvidenceHealth.taskGaps.length > 0 ? (
            <div
              role="group"
              aria-label="Test evidence gaps"
              style={{ borderTop: "1px solid #263244", paddingTop: 9, display: "grid", gap: 8 }}
            >
              <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                Test evidence
              </div>
              {executionTestEvidenceHealth.taskGaps.map(({ task }) => (
                <button
                  key={task.id}
                  type="button"
                  aria-label={`Focus ${task.title} task without test evidence`}
                  onClick={() => focusProductGraphNode(task)}
                  style={{
                    background: "#111827",
                    border: "1px solid #92400e",
                    borderRadius: 8,
                    color: "#fbbf24",
                    cursor: "pointer",
                    display: "grid",
                    fontSize: 11,
                    fontWeight: 800,
                    gap: 4,
                    lineHeight: 1.35,
                    padding: "6px 8px",
                    textAlign: "left",
                    wordBreak: "break-word",
                  }}
                >
                  <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{task.title}</span>
                  <span>No test command or result</span>
                </button>
              ))}
              {executionTestEvidenceHealth.tasksMissingTestEvidenceCount > executionTestEvidenceHealth.taskGaps.length ? (
                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, lineHeight: 1.35 }}>
                  +{executionTestEvidenceHealth.tasksMissingTestEvidenceCount - executionTestEvidenceHealth.taskGaps.length} more completed{" "}
                  {executionTestEvidenceHealth.tasksMissingTestEvidenceCount - executionTestEvidenceHealth.taskGaps.length === 1
                    ? "task needs"
                    : "tasks need"}{" "}
                  test evidence.
                </div>
              ) : null}
            </div>
          ) : null}
          {codeIntentDriftHealth.codeGaps.length > 0 ? (
            <div
              role="group"
              aria-label="Code intent drift gaps"
              style={{ borderTop: "1px solid #263244", paddingTop: 9, display: "grid", gap: 8 }}
            >
              <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                Code intent
              </div>
              {codeIntentDriftHealth.codeGaps.map(({ codeNode }) => (
                <button
                  key={codeNode.id}
                  type="button"
                  aria-label={`Focus ${codeNode.title} changed code without product intent`}
                  onClick={() => focusProductGraphNode(codeNode)}
                  style={{
                    background: "#111827",
                    border: "1px solid #92400e",
                    borderRadius: 8,
                    color: "#fbbf24",
                    cursor: "pointer",
                    display: "grid",
                    fontSize: 11,
                    fontWeight: 800,
                    gap: 4,
                    lineHeight: 1.35,
                    padding: "6px 8px",
                    textAlign: "left",
                    wordBreak: "break-word",
                  }}
                >
                  <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{codeNode.title}</span>
                  <span>No linked product intent</span>
                </button>
              ))}
              {codeIntentDriftHealth.codeNodesMissingIntentCount > codeIntentDriftHealth.codeGaps.length ? (
                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, lineHeight: 1.35 }}>
                  +{codeIntentDriftHealth.codeNodesMissingIntentCount - codeIntentDriftHealth.codeGaps.length} more{" "}
                  {codeIntentDriftHealth.codeNodesMissingIntentCount - codeIntentDriftHealth.codeGaps.length === 1
                    ? "code node needs"
                    : "code nodes need"}{" "}
                  product intent.
                </div>
              ) : null}
            </div>
          ) : null}
          {codeMapFreshnessHealth.codeGaps.length > 0 ? (
            <div
              role="group"
              aria-label="Code map freshness gaps"
              style={{ borderTop: "1px solid #263244", paddingTop: 9, display: "grid", gap: 8 }}
            >
              <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                Code map freshness
              </div>
              {codeMapFreshnessHealth.codeGaps.map(({ codeNode }) => (
                <button
                  key={codeNode.id}
                  type="button"
                  aria-label={`Focus ${codeNode.title} code needing fresh codebase scan`}
                  onClick={() => focusProductGraphNode(codeNode)}
                  style={{
                    background: "#111827",
                    border: "1px solid #92400e",
                    borderRadius: 8,
                    color: "#fbbf24",
                    cursor: "pointer",
                    display: "grid",
                    fontSize: 11,
                    fontWeight: 800,
                    gap: 4,
                    lineHeight: 1.35,
                    padding: "6px 8px",
                    textAlign: "left",
                    wordBreak: "break-word",
                  }}
                >
                  <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{codeNode.title}</span>
                  <span>{codeMapFreshnessHealth.isCodeMapMissing ? "No codebase scan imported" : "Changed after Codebase scan"}</span>
                </button>
              ))}
              {codeMapFreshnessHealth.codeNodesChangedAfterCodeScanCount > codeMapFreshnessHealth.codeGaps.length ? (
                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, lineHeight: 1.35 }}>
                  +{codeMapFreshnessHealth.codeNodesChangedAfterCodeScanCount - codeMapFreshnessHealth.codeGaps.length} more{" "}
                  {codeMapFreshnessHealth.codeNodesChangedAfterCodeScanCount - codeMapFreshnessHealth.codeGaps.length === 1
                    ? "code node needs"
                    : "code nodes need"}{" "}
                  a fresh codebase scan.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <input
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              startTransition(() => setQuery(nextQuery));
            }}
            placeholder="Search intent, tasks, questions..."
            style={{
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 8,
              color: "#e2e8f0",
              padding: "8px 10px",
              fontSize: 12,
            }}
          />
          <div className="product-graph-filter-grid" style={{ display: "grid", gap: 8 }}>
            <select
              aria-label="Intent kind filter"
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as ProductKindFilter)}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                color: "#e2e8f0",
                padding: "8px 10px",
                fontSize: 12,
              }}
            >
              {KIND_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Intent status filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ProductStatusFilter)}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                color: "#e2e8f0",
                padding: "8px 10px",
                fontSize: 12,
              }}
            >
              {STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canEditProductGraph ? (
          <>
            {onGenerateHandoff || onWriteHandoff ? (
              <div
                role="group"
                aria-label="Codex handoff"
                style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 12, padding: 12, display: "grid", gap: 9 }}
              >
                <div style={{ color: "#fcd34d", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Codex handoff
                </div>
                <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
                  {[
                    ["Reads", productGraphHandoff?.summary.recommendedReadCount ?? 0],
                    ["Risks", productGraphHandoff?.summary.riskCount ?? 0],
                    ["Files", productGraphHandoff?.summary.codeFileCount ?? codeMapSummary.fileCount],
                  ].map(([label, value]) => (
                    <div key={label} style={{ background: "#111827", border: "1px solid #263244", borderRadius: 8, padding: 8 }}>
                      <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                      <div style={{ marginTop: 3, color: "#e2e8f0", fontSize: 15, fontWeight: 900 }}>{value}</div>
                    </div>
                  ))}
                </div>
                {productGraphHandoff?.summary.generatedAt ? (
                  <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4, fontWeight: 800 }}>
                    Last generated {productGraphHandoff.summary.generatedAt}
                  </div>
                ) : null}
                {handoffTrustLines.length > 0 ? (
                  <div
                    aria-label="Codex handoff trust summary"
                    style={{
                      background: "#111827",
                      border: `1px solid ${productGraphHandoff?.summary.workspacePathCheck?.status === "mismatch" ? "#7f1d1d" : "#263244"}`,
                      borderRadius: 8,
                      color: "#cbd5e1",
                      display: "grid",
                      fontSize: 11,
                      gap: 4,
                      lineHeight: 1.4,
                      padding: 8,
                    }}
                  >
                    {handoffTrustLines.map((line) => (
                      <div key={line} style={{ overflowWrap: "anywhere" }}>
                        {line}
                      </div>
                    ))}
                  </div>
                ) : null}
                {handoffPreview ? (
                  <pre
                    aria-label="Codex handoff preview"
                    style={{
                      background: "#111827",
                      border: "1px solid #263244",
                      borderRadius: 8,
                      color: "#cbd5e1",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      fontSize: 10,
                      lineHeight: 1.45,
                      margin: 0,
                      maxHeight: 180,
                      overflow: "auto",
                      padding: 8,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {handoffPreview}
                  </pre>
                ) : null}
                {productGraphHandoffError ? (
                  <div style={{ color: "#f97316", fontSize: 12, lineHeight: 1.4 }}>{productGraphHandoffError}</div>
                ) : null}
                {productGraphHandoffMessage ? (
                  <div style={{ color: "#34d399", fontSize: 12, lineHeight: 1.4 }}>{productGraphHandoffMessage}</div>
                ) : null}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleGenerateHandoff}
                    disabled={handoffGenerateDisabled}
                    style={{
                      background: handoffGenerateDisabled ? "#1f2937" : "#b45309",
                      color: handoffGenerateDisabled ? "#64748b" : "#fffbeb",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: 900,
                      cursor: handoffGenerateDisabled ? "not-allowed" : "pointer",
                    }}
                  >
                    {productGraphHandoffLoading ? "Generating..." : "Generate Handoff"}
                  </button>
                  <button
                    type="button"
                    onClick={handleWriteHandoff}
                    disabled={handoffWriteDisabled}
                    style={{
                      background: handoffWriteDisabled ? "#1f2937" : "#92400e",
                      color: handoffWriteDisabled ? "#64748b" : "#fffbeb",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: 900,
                      cursor: handoffWriteDisabled ? "not-allowed" : "pointer",
                    }}
                  >
                    {productGraphHandoffWriting ? "Writing..." : "Write GRAPH_REPORT.md"}
                  </button>
                </div>
              </div>
            ) : null}

            {onScanCodebase ? (
              <div
                role="group"
                aria-label="Codebase scan"
                style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 12, padding: 12, display: "grid", gap: 9 }}
              >
                <div style={{ color: "#a7f3d0", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Codebase scan
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45, fontWeight: 700 }}>
                  {CODEBASE_SCAN_SETUP_GUIDANCE}
                </div>
                <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
                  {[
                    ["Files", codeMapSummary.fileCount],
                    ["Symbols", codeMapSummary.symbolCount],
                    ["Communities", codeMapSummary.communityCount],
                    ["Dependencies", codeMapSummary.dependencyEdgeCount],
                    ["Semantic", codeMapSummary.semanticEdgeCount],
                  ].map(([label, value]) => (
                    <div key={label} style={{ background: "#111827", border: "1px solid #263244", borderRadius: 8, padding: 8 }}>
                      <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                      <div style={{ marginTop: 3, color: "#e2e8f0", fontSize: 15, fontWeight: 900 }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ color: codeMapFreshnessHealthTone, fontSize: 11, lineHeight: 1.4, fontWeight: 800 }}>
                  {codeMapFreshnessHealthCopy}
                </div>
                {codebaseScanProgressLine ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div
                      role="progressbar"
                      aria-label="Codebase scan progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(codebaseScanProgressPercent)}
                      style={{
                        height: 6,
                        borderRadius: 999,
                        background: "#1f2937",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${codebaseScanProgressPercent}%`,
                          height: "100%",
                          background:
                            visibleCodebaseScanProgress?.breakers.state === "hit"
                              ? "#f97316"
                              : visibleCodebaseScanProgress?.breakers.state === "near"
                                ? "#f59e0b"
                                : "#10b981",
                        }}
                      />
                    </div>
                    <div style={{ color: "#a7f3d0", fontSize: 11, lineHeight: 1.35, fontWeight: 800 }}>
                      {codebaseScanProgressLine}
                    </div>
                    {codebaseScanBreakerWarning ? (
                      <div style={{ color: "#fbbf24", fontSize: 11, lineHeight: 1.35 }}>
                        {codebaseScanBreakerWarning}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {codebaseScanError ? (
                  <div style={{ color: "#f97316", fontSize: 12, lineHeight: 1.4 }}>{codebaseScanError}</div>
                ) : null}
                {codebaseScanMessage ? (
                  <div style={{ color: "#34d399", fontSize: 12, lineHeight: 1.4 }}>{codebaseScanMessage}</div>
                ) : null}
                <button
                  type="button"
                  onClick={handleScanCodebase}
                  disabled={codebaseScanDisabled}
                  style={{
                    background: codebaseScanDisabled ? "#1f2937" : "#047857",
                    color: codebaseScanDisabled ? "#64748b" : "#ecfdf5",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 900,
                    cursor: codebaseScanDisabled ? "not-allowed" : "pointer",
                  }}
                >
                  {codebaseScanPending ? "Scanning..." : "Scan Codebase"}
                </button>
              </div>
            ) : null}

            {onImportSpecKit ? (
              <div
                role="group"
                aria-label="Spec Kit import"
                style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 12, padding: 12, display: "grid", gap: 9 }}
              >
                <div style={{ color: "#67e8f9", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Spec Kit import
                </div>
                {specKitImportError ? (
                  <div style={{ color: "#f97316", fontSize: 12, lineHeight: 1.4 }}>{specKitImportError}</div>
                ) : null}
                {specKitImportMessage ? (
                  <div style={{ color: "#34d399", fontSize: 12, lineHeight: 1.4 }}>{specKitImportMessage}</div>
                ) : null}
                <button
                  type="button"
                  onClick={handleImportSpecKit}
                  disabled={specKitImportDisabled}
                  style={{
                    background: specKitImportDisabled ? "#1f2937" : "#0e7490",
                    color: specKitImportDisabled ? "#64748b" : "#ecfeff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 900,
                    cursor: specKitImportDisabled ? "not-allowed" : "pointer",
                  }}
                >
                  {specKitImportPending ? "Importing..." : "Import Spec Kit"}
                </button>
              </div>
            ) : null}

            <form
              onSubmit={handleCreateIntentBundle}
              style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 12, padding: 12, display: "grid", gap: 9 }}
            >
              <div style={{ color: "#34d399", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Create feature bundle
              </div>
              <input
                aria-label="Bundle feature title"
                value={bundleFeatureTitle}
                onChange={(event) => {
                  setBundleFeatureTitle(event.target.value);
                  clearCreateBundleFeedback();
                }}
                placeholder="Feature title"
                maxLength={180}
                style={{
                  background: "#111827",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              />
              <textarea
                aria-label="Bundle feature summary"
                value={bundleFeatureSummary}
                onChange={(event) => {
                  setBundleFeatureSummary(event.target.value);
                  clearCreateBundleFeedback();
                }}
                placeholder="Feature summary"
                rows={2}
                maxLength={1000}
                style={{
                  background: "#111827",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "8px 10px",
                  fontSize: 12,
                  resize: "vertical",
                }}
              />
              <div style={{ display: "grid", gap: 6 }}>
                {bundleStoryTitles.map((title, index) => (
                  <div key={`story-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6 }}>
                    <input
                      aria-label={`Bundle user story title ${index + 1}`}
                      value={title}
                      onChange={(event) => updateBundleTitle(setBundleStoryTitles, index, event.target.value)}
                      placeholder="User story title"
                      maxLength={180}
                      style={{
                        background: "#111827",
                        border: "1px solid #334155",
                        borderRadius: 8,
                        color: "#e2e8f0",
                        padding: "8px 10px",
                        fontSize: 12,
                        minWidth: 0,
                      }}
                    />
                    {bundleStoryTitles.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`Remove user story ${index + 1}`}
                        onClick={() => removeBundleTitle(setBundleStoryTitles, index)}
                        disabled={createBundlePending || productGraphLoading}
                        style={{
                          background: "transparent",
                          color: "#94a3b8",
                          border: "1px solid #334155",
                          borderRadius: 8,
                          padding: "0 9px",
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: createBundlePending || productGraphLoading ? "not-allowed" : "pointer",
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addBundleTitle(setBundleStoryTitles)}
                  disabled={bundleStoryTitles.length >= MAX_BUNDLE_ITEM_FIELDS || createBundlePending || productGraphLoading}
                  style={{
                    background: "transparent",
                    color: "#34d399",
                    border: "1px solid #1f5f46",
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontSize: 12,
                    fontWeight: 900,
                    cursor:
                      bundleStoryTitles.length >= MAX_BUNDLE_ITEM_FIELDS || createBundlePending || productGraphLoading
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  Add story
                </button>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {bundleCriterionTitles.map((title, index) => (
                  <div key={`criterion-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6 }}>
                    <input
                      aria-label={`Bundle acceptance criterion title ${index + 1}`}
                      value={title}
                      onChange={(event) => updateBundleTitle(setBundleCriterionTitles, index, event.target.value)}
                      placeholder="Acceptance criterion title"
                      maxLength={180}
                      style={{
                        background: "#111827",
                        border: "1px solid #334155",
                        borderRadius: 8,
                        color: "#e2e8f0",
                        padding: "8px 10px",
                        fontSize: 12,
                        minWidth: 0,
                      }}
                    />
                    {bundleCriterionTitles.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`Remove acceptance criterion ${index + 1}`}
                        onClick={() => removeBundleTitle(setBundleCriterionTitles, index)}
                        disabled={createBundlePending || productGraphLoading}
                        style={{
                          background: "transparent",
                          color: "#94a3b8",
                          border: "1px solid #334155",
                          borderRadius: 8,
                          padding: "0 9px",
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: createBundlePending || productGraphLoading ? "not-allowed" : "pointer",
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addBundleTitle(setBundleCriterionTitles)}
                  disabled={bundleCriterionTitles.length >= MAX_BUNDLE_ITEM_FIELDS || createBundlePending || productGraphLoading}
                  style={{
                    background: "transparent",
                    color: "#34d399",
                    border: "1px solid #1f5f46",
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontSize: 12,
                    fontWeight: 900,
                    cursor:
                      bundleCriterionTitles.length >= MAX_BUNDLE_ITEM_FIELDS || createBundlePending || productGraphLoading
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  Add criterion
                </button>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {bundleTaskTitles.map((title, index) => (
                  <div key={`task-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6 }}>
                    <input
                      aria-label={`Bundle task title ${index + 1}`}
                      value={title}
                      onChange={(event) => updateBundleTitle(setBundleTaskTitles, index, event.target.value)}
                      placeholder="Task title"
                      maxLength={180}
                      style={{
                        background: "#111827",
                        border: "1px solid #334155",
                        borderRadius: 8,
                        color: "#e2e8f0",
                        padding: "8px 10px",
                        fontSize: 12,
                        minWidth: 0,
                      }}
                    />
                    {bundleTaskTitles.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`Remove task ${index + 1}`}
                        onClick={() => removeBundleTitle(setBundleTaskTitles, index)}
                        disabled={createBundlePending || productGraphLoading}
                        style={{
                          background: "transparent",
                          color: "#94a3b8",
                          border: "1px solid #334155",
                          borderRadius: 8,
                          padding: "0 9px",
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: createBundlePending || productGraphLoading ? "not-allowed" : "pointer",
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addBundleTitle(setBundleTaskTitles)}
                  disabled={bundleTaskTitles.length >= MAX_BUNDLE_ITEM_FIELDS || createBundlePending || productGraphLoading}
                  style={{
                    background: "transparent",
                    color: "#34d399",
                    border: "1px solid #1f5f46",
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontSize: 12,
                    fontWeight: 900,
                    cursor:
                      bundleTaskTitles.length >= MAX_BUNDLE_ITEM_FIELDS || createBundlePending || productGraphLoading
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  Add task
                </button>
              </div>
              {createBundleError ? <div style={{ color: "#f97316", fontSize: 12, lineHeight: 1.4 }}>{createBundleError}</div> : null}
              {createBundleMessage ? <div style={{ color: "#34d399", fontSize: 12, lineHeight: 1.4 }}>{createBundleMessage}</div> : null}
              <button
                type="submit"
                disabled={createBundleDisabled}
                style={{
                  background: createBundleDisabled ? "#1f2937" : "#15803d",
                  color: createBundleDisabled ? "#64748b" : "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: createBundleDisabled ? "not-allowed" : "pointer",
                }}
              >
                {createBundlePending ? "Creating..." : "Create bundle"}
              </button>
            </form>

            <form
              onSubmit={handleCreateNode}
              style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 12, padding: 12, display: "grid", gap: 9 }}
            >
              <div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Add intent node
              </div>
              <div className="product-graph-filter-grid" style={{ display: "grid", gap: 8 }}>
                <select
                  aria-label="Node kind"
                  value={newNodeKind}
                  onChange={(event) => setNewNodeKind(event.target.value as ProductNodeKind)}
                  style={{
                    background: "#111827",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    color: "#e2e8f0",
                    padding: "8px 10px",
                    fontSize: 12,
                  }}
                >
                  {CREATE_NODE_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Node status"
                  value={newNodeStatus}
                  onChange={(event) => setNewNodeStatus(event.target.value as ProductNodeStatus)}
                  style={{
                    background: "#111827",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    color: "#e2e8f0",
                    padding: "8px 10px",
                    fontSize: 12,
                  }}
                >
                  {CREATE_NODE_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                aria-label="Node title"
                value={newNodeTitle}
                onChange={(event) => {
                  setNewNodeTitle(event.target.value);
                  setCreateNodeError("");
                  setCreateNodeMessage("");
                }}
                placeholder="Title"
                maxLength={180}
                style={{
                  background: "#111827",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              />
              <textarea
                aria-label="Node summary"
                value={newNodeSummary}
                onChange={(event) => {
                  setNewNodeSummary(event.target.value);
                  setCreateNodeError("");
                  setCreateNodeMessage("");
                }}
                placeholder="Summary"
                rows={3}
                maxLength={1000}
                style={{
                  background: "#111827",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "8px 10px",
                  fontSize: 12,
                  resize: "vertical",
                }}
              />
              {createNodeError ? <div style={{ color: "#f97316", fontSize: 12, lineHeight: 1.4 }}>{createNodeError}</div> : null}
              {createNodeMessage ? <div style={{ color: "#34d399", fontSize: 12, lineHeight: 1.4 }}>{createNodeMessage}</div> : null}
              <button
                type="submit"
                disabled={createNodeDisabled}
                style={{
                  background: createNodeDisabled ? "#1f2937" : "#2563eb",
                  color: createNodeDisabled ? "#64748b" : "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: createNodeDisabled ? "not-allowed" : "pointer",
                }}
              >
                {createNodePending ? "Creating..." : "Create node"}
              </button>
            </form>

            <form
              onSubmit={handleCreateEdge}
              style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 12, padding: 12, display: "grid", gap: 9 }}
            >
              <div style={{ color: "#2dd4bf", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Add relationship
              </div>
              <div className="product-graph-filter-grid" style={{ display: "grid", gap: 8 }}>
                <select
                  aria-label="Edge source"
                  value={resolvedEdgeSourceNodeId}
                  disabled={edgeNodeOptions.length < 2 || createEdgePending || productGraphLoading}
                  onChange={(event) => {
                    const nextSourceNodeId = event.target.value;
                    setNewEdgeSourceNodeId(nextSourceNodeId);
                    if (newEdgeTargetNodeId === nextSourceNodeId) {
                      setNewEdgeTargetNodeId(edgeNodeOptions.find((node) => node.id !== nextSourceNodeId)?.id ?? "");
                    }
                    setCreateEdgeError("");
                    setCreateEdgeMessage("");
                  }}
                  style={{
                    background: "#111827",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    color: "#e2e8f0",
                    padding: "8px 10px",
                    fontSize: 12,
                  }}
                >
                  {edgeNodeOptions.length > 0 ? (
                    edgeNodeOptions.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.title}
                      </option>
                    ))
                  ) : (
                    <option value="">No nodes</option>
                  )}
                </select>
                <select
                  aria-label="Edge target"
                  value={resolvedEdgeTargetNodeId}
                  disabled={edgeNodeOptions.length < 2 || createEdgePending || productGraphLoading}
                  onChange={(event) => {
                    setNewEdgeTargetNodeId(event.target.value);
                    setCreateEdgeError("");
                    setCreateEdgeMessage("");
                  }}
                  style={{
                    background: "#111827",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    color: "#e2e8f0",
                    padding: "8px 10px",
                    fontSize: 12,
                  }}
                >
                  {edgeTargetOptions.length > 0 ? (
                    edgeTargetOptions.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.title}
                      </option>
                    ))
                  ) : (
                    <option value="">No target</option>
                  )}
                </select>
              </div>
              <select
                aria-label="Edge kind"
                value={newEdgeKind}
                onChange={(event) => {
                  setNewEdgeKind(event.target.value as ProductEdgeKind);
                  setCreateEdgeError("");
                  setCreateEdgeMessage("");
                }}
                style={{
                  background: "#111827",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              >
                {CREATE_EDGE_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                aria-label="Edge label"
                value={newEdgeLabel}
                onChange={(event) => {
                  setNewEdgeLabel(event.target.value);
                  setCreateEdgeError("");
                  setCreateEdgeMessage("");
                }}
                placeholder="Label"
                maxLength={180}
                style={{
                  background: "#111827",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              />
              {edgeNodeOptions.length < 2 ? (
                <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.4 }}>Add two intent nodes before linking them.</div>
              ) : null}
              {createEdgeError ? <div style={{ color: "#f97316", fontSize: 12, lineHeight: 1.4 }}>{createEdgeError}</div> : null}
              {createEdgeMessage ? <div style={{ color: "#34d399", fontSize: 12, lineHeight: 1.4 }}>{createEdgeMessage}</div> : null}
              <button
                type="submit"
                disabled={createEdgeDisabled}
                style={{
                  background: createEdgeDisabled ? "#1f2937" : "#0891b2",
                  color: createEdgeDisabled ? "#64748b" : "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: createEdgeDisabled ? "not-allowed" : "pointer",
                }}
              >
                {createEdgePending ? "Creating..." : "Create relationship"}
              </button>
            </form>
          </>
        ) : null}

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
            Code map
          </div>
          <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
            {[
              ["Files", codeMapSummary.fileCount],
              ["Symbols", codeMapSummary.symbolCount],
              ["Communities", codeMapSummary.communityCount],
              ["Dependencies", codeMapSummary.dependencyEdgeCount],
              ["Semantic", codeMapSummary.semanticEdgeCount],
              ["Uncertain", codeMapSummary.inferredCount + codeMapSummary.ambiguousCount],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 10, padding: 9 }}>
                <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                <div style={{ marginTop: 4, fontSize: 18, fontWeight: 900 }}>{value}</div>
              </div>
            ))}
          </div>
          <div
            role="group"
            aria-label="Code map theme"
            style={{ display: "grid", gap: 6, border: "1px solid #263244", borderRadius: 10, padding: 9 }}
          >
            <div style={{ color: "#93c5fd", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
              Theme
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {GRAPH_THEME_OPTIONS.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  aria-pressed={codeMapThemeId === theme.id}
                  title={theme.description}
                  onClick={() => setCodeMapThemeId(theme.id)}
                  style={{
                    background: codeMapThemeId === theme.id ? "#1e3a5f" : "transparent",
                    border: `1px solid ${codeMapThemeId === theme.id ? codeMapTheme.active : "#263244"}`,
                    borderRadius: 8,
                    color: codeMapThemeId === theme.id ? "#dbeafe" : "#cbd5e1",
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
          </div>
          <div
            role="group"
            aria-label="Code map visual key"
            style={{ display: "grid", gap: 6, border: "1px solid #263244", borderRadius: 10, padding: 9 }}
          >
            <div style={{ color: "#93c5fd", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
              Visual key
            </div>
            {CODE_MAP_VISUAL_KEY.map((item) => (
              <div key={item.label} style={{ display: "grid", gap: 2 }}>
                <div style={{ color: codeMapTheme.codeMap[item.key], fontSize: 12, fontWeight: 900 }}>{item.label}</div>
                <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.35 }}>{item.detail}</div>
              </div>
            ))}
          </div>
          <div
            role="group"
            aria-label="Code map filters"
            style={{ display: "grid", gap: 6, border: "1px solid #263244", borderRadius: 10, padding: 9 }}
          >
            {[
              ["files", "Show code files"],
              ["symbols", "Show code symbols"],
              ["communities", "Show code communities"],
              ["dependencyEdges", "Show dependency edges"],
              ["semanticEdges", "Show semantic edges"],
            ].map(([key, label]) => (
              <label
                key={key}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, color: "#cbd5e1", fontSize: 12, fontWeight: 800 }}
              >
                <span>{label}</span>
                <input
                  aria-label={label}
                  type="checkbox"
                  checked={codeMapFilters[key as keyof CodeMapFilterState]}
                  onChange={(event) => updateCodeMapFilter(key as keyof CodeMapFilterState, event.target.checked)}
                />
              </label>
            ))}
          </div>
          {!codeMapHasData ? (
            <div
              role="group"
              aria-label="Code map empty state"
              style={{ border: "1px solid #263244", borderRadius: 10, padding: 10, display: "grid", gap: 5 }}
            >
              <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>No Code Map data yet.</div>
              <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4 }}>{codebaseScanSetupCopy}</div>
            </div>
          ) : (
            <>
              <div
                role="group"
                aria-label="Code map task lenses"
                style={{ display: "grid", gap: 6, border: "1px solid #263244", borderRadius: 10, padding: 9 }}
              >
                <div style={{ color: "#c4b5fd", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                  Task lenses
                </div>
                {codeMapTaskScopeOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={`Show ${option.label} task lens`}
                    aria-pressed={codeMapTaskScope === option.id}
                    title={option.description}
                    onClick={() => updateCodeMapTaskScope(option.id)}
                    style={{
                      background: codeMapTaskScope === option.id ? "#1e3a5f" : "transparent",
                      border: `1px solid ${codeMapTaskScope === option.id ? "#8b5cf6" : "#263244"}`,
                      borderRadius: 8,
                      color: option.count > 0 || option.id === "all" ? "#cbd5e1" : "#64748b",
                      cursor: "pointer",
                      display: "grid",
                      fontSize: 12,
                      fontWeight: 800,
                      gap: 3,
                      padding: "7px 9px",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{option.label}</span>
                      <span>{option.count}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div
                role="group"
                aria-label="Code map quick filters"
                style={{ display: "grid", gap: 6, border: "1px solid #263244", borderRadius: 10, padding: 9 }}
              >
                <button
                  type="button"
                  aria-label="Clear Code Map quick filter"
                  onClick={() => {
                    setCodeMapQuickFilter("all");
                    clearCodeMapExplorer();
                  }}
                  style={{
                    background: codeMapQuickFilter === "all" && !codeMapExplorerView ? "#1e3a5f" : "transparent",
                    border: "1px solid #263244",
                    borderRadius: 8,
                    color: "#cbd5e1",
                    cursor: "pointer",
                    display: "flex",
                    fontSize: 12,
                    fontWeight: 800,
                    justifyContent: "space-between",
                    padding: "7px 9px",
                    textAlign: "left",
                  }}
                >
                  <span>Normal filters</span>
                  <span>{codeMapSummary.fileCount + codeMapSummary.symbolCount + codeMapSummary.communityCount}</span>
                </button>
                {codeMapQuickFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={`Show ${option.label} Code Map focus`}
                    onClick={() => updateCodeMapQuickFilter(option.value)}
                    style={{
                      background: codeMapQuickFilter === option.value ? "#1e3a5f" : "transparent",
                      border: "1px solid #263244",
                      borderRadius: 8,
                      color: option.count > 0 ? "#cbd5e1" : "#64748b",
                      cursor: "pointer",
                      display: "flex",
                      fontSize: 12,
                      fontWeight: 800,
                      gap: 8,
                      justifyContent: "space-between",
                      padding: "7px 9px",
                      textAlign: "left",
                    }}
                  >
                    <span>{option.label}</span>
                    <span>{option.countLabel ?? option.count}</span>
                  </button>
                ))}
              </div>
              <div
                role="group"
                aria-label="Code map architecture health"
                style={{ display: "grid", gap: 7, border: "1px solid #263244", borderRadius: 10, padding: 9 }}
              >
                <div style={{ color: "#a7f3d0", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                  Architecture health
                </div>
                {codeMapHealthCards.map((card) => {
                  const explorerActive = codeMapExplorerSelectionMatches(codeMapExplorerSelection, card.explorerSelection);
                  const quickFilterActive = codeMapQuickFilter === card.value && !codeMapExplorerView;
                  const isActive = explorerActive || quickFilterActive;
                  return (
                    <button
                      key={card.value}
                      type="button"
                      aria-label={`Drill into ${card.label} Code Map health`}
                      onClick={() => {
                        if (card.explorerSelection && card.count > 0) {
                          openCodeMapExplorer(card.explorerSelection);
                          return;
                        }
                        updateCodeMapQuickFilter(card.value);
                      }}
                      style={{
                        background: isActive ? "#1e3a5f" : "#0f172a",
                        border: `1px solid ${isActive ? "#38bdf8" : "#263244"}`,
                        borderRadius: 8,
                        color: "#cbd5e1",
                        cursor: "pointer",
                        display: "grid",
                        fontSize: 11,
                        gap: 4,
                        padding: 8,
                        textAlign: "left",
                      }}
                    >
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>{card.label}</span>
                        <span style={{ color: card.tone, fontSize: 12, fontWeight: 900 }}>{card.countLabel ?? card.count}</span>
                      </span>
                      <span style={{ color: "#94a3b8", lineHeight: 1.35, wordBreak: "break-word" }}>{card.detail}</span>
                    </button>
                  );
                })}
              </div>
              <div
                role="group"
                aria-label="Code map community groups"
                style={{ display: "grid", gap: 7, border: "1px solid #263244", borderRadius: 10, padding: 9 }}
              >
                <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                  Community groups
                </div>
                {codeMapCommunityGroups.length > 0 ? (
                  codeMapCommunityGroups.map((group) => {
                    const { summary } = group;
                    const dependencyIssueCount = summary.externalDependencyCount + summary.unresolvedDependencyCount;
                    const explorerActive = codeMapExplorerSelectionMatches(codeMapExplorerSelection, {
                      mode: "community",
                      communityNodeId: summary.node.id,
                    });
                    return (
                      <button
                        key={summary.node.id}
                        type="button"
                        aria-label={`Explore ${summary.node.title} community group`}
                        onClick={() => openCodeMapExplorer({ mode: "community", communityNodeId: summary.node.id })}
                        style={{
                          background: explorerActive ? "#1e3a5f" : "#0f172a",
                          border: `1px solid ${explorerActive ? "#38bdf8" : "#164e63"}`,
                          borderRadius: 8,
                          color: "#cbd5e1",
                          cursor: "pointer",
                          display: "grid",
                          fontSize: 11,
                          gap: 4,
                          padding: 8,
                          textAlign: "left",
                        }}
                      >
                        <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900, wordBreak: "break-word" }}>{summary.node.title}</span>
                        <span>
                          {pluralizeCount(summary.fileCount, "file")} · {pluralizeCount(summary.dependencyCount, "dependency")} ·{" "}
                          {pluralizeCount(summary.semanticLinkCount, "semantic link")}
                        </span>
                        {dependencyIssueCount > 0 ? (
                          <span style={{ color: "#fbbf24" }}>
                            {pluralizeCount(summary.externalDependencyCount, "external")} ·{" "}
                            {pluralizeCount(summary.unresolvedDependencyCount, "unresolved")}
                          </span>
                        ) : null}
                        {group.files.length > 0 ? (
                          <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {group.files.map((file) => (
                              <span
                                key={file.id}
                                style={{
                                  background: "#111827",
                                  border: "1px solid #263244",
                                  borderRadius: 6,
                                  color: "#bfdbfe",
                                  maxWidth: "100%",
                                  overflowWrap: "anywhere",
                                  padding: "2px 5px",
                                }}
                              >
                                {file.title}
                              </span>
                            ))}
                            {group.hiddenFileCount > 0 ? (
                              <span style={{ color: "#94a3b8", padding: "2px 0" }}>+{group.hiddenFileCount} more files</span>
                            ) : null}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.4 }}>No communities yet.</div>
                )}
              </div>
              <div
                role="group"
                aria-label="Dependency hotspots"
                style={{ display: "grid", gap: 7, border: "1px solid #263244", borderRadius: 10, padding: 9 }}
              >
                <div style={{ color: "#fde68a", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                  Dependency hotspots
                </div>
                {codeMapDependencyHotspots.length > 0 ? (
                  codeMapDependencyHotspots.map((hotspot) => {
                    const dependencyIssueCount = hotspot.externalDependencyCount + hotspot.unresolvedDependencyCount;
                    return (
                      <button
                        key={hotspot.node.id}
                        type="button"
                        aria-label={`Focus ${hotspot.node.title} dependency hotspot`}
                        onClick={() => focusProductGraphNode(hotspot.node)}
                        style={{
                          background: "#0f172a",
                          border: "1px solid #713f12",
                          borderRadius: 8,
                          color: "#cbd5e1",
                          cursor: "pointer",
                          display: "grid",
                          fontSize: 11,
                          gap: 4,
                          padding: 8,
                          textAlign: "left",
                        }}
                      >
                        <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900, wordBreak: "break-word" }}>{hotspot.node.title}</span>
                        <span>
                          imports {hotspot.importsCount} · imported by {hotspot.importedByCount} · semantic relationships{" "}
                          {hotspot.semanticRelationshipCount}
                        </span>
                        {dependencyIssueCount > 0 ? (
                          <span style={{ color: "#fbbf24" }}>
                            external {hotspot.externalDependencyCount} · unresolved {hotspot.unresolvedDependencyCount}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.4 }}>No hotspots yet.</div>
                )}
              </div>
            </>
          )}
          {CODE_KIND_FILTERS.map((filter) => {
            const count = productGraph.summary.nodesByKind[filter.value] ?? 0;
            return (
              <button
                key={filter.value}
                onClick={() => setKindFilter(filter.value)}
                style={{
                  background: kindFilter === filter.value ? "#1e3a5f" : "transparent",
                  color: count > 0 ? "#cbd5e1" : "#64748b",
                  border: "1px solid #263244",
                  borderRadius: 8,
                  padding: "7px 9px",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: 12,
                  textAlign: "left",
                }}
              >
                <span>{filter.label}</span>
                <span>{count}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
            Node mix
          </div>
          {KIND_FILTERS.filter((filter) => filter.value !== "all").map((filter) => {
            const count = productGraph.summary.nodesByKind[filter.value as ProductNodeKind] ?? 0;
            return (
              <button
                key={filter.value}
                onClick={() => setKindFilter(filter.value)}
                style={{
                  background: kindFilter === filter.value ? "#1e3a5f" : "transparent",
                  color: count > 0 ? "#cbd5e1" : "#64748b",
                  border: "1px solid #263244",
                  borderRadius: 8,
                  padding: "7px 9px",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: 12,
                  textAlign: "left",
                }}
              >
                <span>{filter.label}</span>
                <span>{count}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <main
        style={{
          minWidth: 0,
          minHeight: 0,
          overflow: "auto",
          padding: 18,
          display: "grid",
          alignContent: "start",
          gap: 14,
        }}
      >
        {productGraph.nodes.length === 0 ? (
          <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 14, padding: 18 }}>
            <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 900 }}>No product intent yet</div>
            <div style={{ marginTop: 8, color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
              Feature, story, criterion, question, and task nodes will appear here as the product graph fills in.
            </div>
          </div>
        ) : null}

        {(visibleNodes.length === 0 && productGraph.nodes.length > 0) || codeMapTaskScopeHasNoFiles ? (
          <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 14, padding: 18, color: "#94a3b8", fontSize: 13 }}>
            {codeMapTaskScopeHasNoFiles
              ? `No scanned files matched the ${activeTaskScopeDefinition.label} task lens.`
              : "No product graph nodes match these filters."}
          </div>
        ) : null}

        {codeMapExplorerView ? (
          <section
            role="group"
            aria-label="Architecture explorer"
            style={{
              background: "#0f172a",
              border: "1px solid #164e63",
              borderRadius: 12,
              display: "grid",
              gap: 10,
              padding: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                  Architecture explorer
                </div>
                <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 900, overflowWrap: "anywhere" }}>
                  {codeMapExplorerView.title}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, fontWeight: 800, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                  {codeMapExplorerView.detail}
                </div>
              </div>
              <button
                type="button"
                aria-label="Exit architecture explorer"
                onClick={clearCodeMapExplorer}
                style={{
                  background: "#111827",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#bfdbfe",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 900,
                  padding: "7px 10px",
                }}
              >
                Exit explorer
              </button>
            </div>
            <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
              {[
                ["Nodes", codeMapExplorerView.nodeIds.size],
                ["Edges", codeMapExplorerView.edgeIds.size],
                ["Highlighted", codeMapExplorerView.highlightedNodeIds.size],
                ...(codeMapExplorerView.hiddenNodeCount > 0 ? [["Hidden", codeMapExplorerView.hiddenNodeCount]] : []),
              ].map(([label, value]) => (
                <div key={label} style={{ background: "#111827", border: "1px solid #263244", borderRadius: 8, padding: 8 }}>
                  <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ marginTop: 3, color: "#e2e8f0", fontSize: 15, fontWeight: 900 }}>{value}</div>
                </div>
              ))}
            </div>
            {codeMapExplorerView.selection.mode === "cycle" ? (
              <div
                role="group"
                aria-label="Dependency cycle path"
                style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}
              >
                {codeMapExplorerView.itemNodes.map((node, index) => (
                  <span key={`${node.id}:cycle-path`} style={{ display: "contents" }}>
                    {index > 0 ? <span style={{ color: "#64748b", fontSize: 11, fontWeight: 900 }}>-&gt;</span> : null}
                    <button
                      type="button"
                      aria-label={`Focus ${node.title} cycle file`}
                      onClick={() => updateSelectedNodeId(node.id)}
                      style={{
                        background: "#111827",
                        border: "1px solid #7f1d1d",
                        borderRadius: 6,
                        color: "#fecdd3",
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 900,
                        maxWidth: "100%",
                        overflowWrap: "anywhere",
                        padding: "4px 6px",
                      }}
                    >
                      {node.title}
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {codeMapExplorerView.itemNodes.length > 0 ? (
              <div
                role="group"
                aria-label="Architecture explorer nodes"
                style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
              >
                {codeMapExplorerView.itemNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    aria-label={`Focus ${node.title} architecture explorer node`}
                    onClick={() => updateSelectedNodeId(node.id)}
                    style={{
                      background: codeMapExplorerView.highlightedNodeIds.has(node.id) ? "#1f2937" : "#111827",
                      border: `1px solid ${codeMapExplorerView.highlightedNodeIds.has(node.id) ? "#f97316" : "#334155"}`,
                      borderRadius: 6,
                      color: "#cbd5e1",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 800,
                      maxWidth: "100%",
                      overflowWrap: "anywhere",
                      padding: "5px 7px",
                    }}
                  >
                    {node.title}
                  </button>
                ))}
                {codeMapExplorerView.hiddenItemCount > 0 ? (
                  <span style={{ alignSelf: "center", color: "#94a3b8", fontSize: 11, fontWeight: 800 }}>
                    +{codeMapExplorerView.hiddenItemCount} more
                  </span>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {hiddenVisibleNodeCount > 0 ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              background: "#111827",
              border: "1px solid #263244",
              borderRadius: 12,
              color: "#cbd5e1",
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
              justifyContent: "space-between",
              padding: 12,
            }}
          >
            <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
              <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>
                Showing {renderedVisibleNodeCount} of {visibleNodes.length} matching nodes
              </div>
              <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4 }}>
                Use search, filters, quick filters, or task lenses to narrow large graphs without changing scanned data.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setVisibleNodeRenderLimit((limit) => limit + PRODUCT_GRAPH_NODE_CARD_RENDER_INCREMENT)}
              style={{
                background: "#1e3a5f",
                border: "1px solid #2563eb",
                borderRadius: 8,
                color: "#bfdbfe",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 900,
                padding: "7px 10px",
              }}
            >
              Show {Math.min(PRODUCT_GRAPH_NODE_CARD_RENDER_INCREMENT, hiddenVisibleNodeCount)} more
            </button>
          </div>
        ) : null}

        <div className="product-graph-detail-grid" style={{ display: "grid", gap: 14 }}>
          <section style={{ display: "grid", gap: 10, alignContent: "start", minWidth: 0 }}>
            {renderedVisibleNodes.map((node) => {
              const isExplorerHighlighted = codeMapExplorerView?.highlightedNodeIds.has(node.id) ?? false;
              const acceptanceSummary = featureAcceptanceSummariesByNodeId.get(node.id);
              const unverifiedAcceptanceCopy = acceptanceSummary
                ? acceptanceSummary.unverifiedCount === 1
                  ? "1 criterion needs evidence"
                  : `${acceptanceSummary.unverifiedCount} criteria need evidence`
                : "";
              const scannerSymbolKind = metadataText(node, "scannerSymbolKind");
              const scannerSymbolName = metadataText(node, "scannerSymbolName");
              const scannerSymbolLabel = node.kind === "code_symbol" && scannerSymbolKind
                ? `${formatTitleLabel(scannerSymbolKind)}${scannerSymbolName ? ` ${scannerSymbolName}` : ""}`
                : "";
              return (
                <button
                  key={node.id}
                  onClick={() => updateSelectedNodeId(node.id)}
                  style={{
                    textAlign: "left",
                    background: selectedNode?.id === node.id ? "#132238" : isExplorerHighlighted ? "#1f2937" : "#111827",
                    border: `1px solid ${
                      selectedNode?.id === node.id
                        ? "#2563eb"
                        : isExplorerHighlighted
                          ? "#f97316"
                        : isTaskBlockedByOpenQuestions(node)
                          ? "#f97316"
                          : "#1f2937"
                    }`,
                    borderRadius: 12,
                    padding: 14,
                    display: "grid",
                    gap: 8,
                    cursor: "pointer",
                    color: "#e2e8f0",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start", flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 900, wordBreak: "break-word" }}>{node.title}</div>
                      <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", fontWeight: 800 }}>
                        {formatLabel(node.kind)}
                      </div>
                    </div>
                    <span
                      style={{
                        color: statusTones[node.status],
                        border: `1px solid ${statusTones[node.status]}`,
                        borderRadius: 999,
                        padding: "3px 8px",
                        fontSize: 10,
                        fontWeight: 900,
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatLabel(node.status)}
                    </span>
                  </div>
                  {node.summary ? (
                    <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>{node.summary}</div>
                  ) : null}
                  {acceptanceSummary ? (
                    <div
                      role="group"
                      aria-label={`${node.title} acceptance verification`}
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                        color: acceptanceSummary.unverifiedCount > 0 ? "#fbbf24" : "#86efac",
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    >
                      <span>
                        {acceptanceSummary.verifiedCount}/{acceptanceSummary.totalCount} criteria verified
                      </span>
                      <span>
                        {acceptanceSummary.unverifiedCount > 0 ? unverifiedAcceptanceCopy : "All criteria verified"}
                      </span>
                    </div>
                  ) : null}
                  {isCodeMapNode(node) && sourcePathLabel(node) ? (
                    <div style={{ color: "#7dd3fc", fontSize: 12, fontWeight: 800, wordBreak: "break-word" }}>
                      {sourcePathLabel(node)}
                    </div>
                  ) : null}
                  {isExplorerHighlighted ? (
                    <div style={{ color: "#fed7aa", fontSize: 11, fontWeight: 900 }}>
                      Explorer highlight
                    </div>
                  ) : null}
                  {scannerSymbolLabel ? (
                    <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.4 }}>
                      {scannerSymbolLabel}
                    </div>
                  ) : null}
                  {isTaskBlockedByOpenQuestions(node) ? (
                    <div style={{ color: "#f97316", fontSize: 12, fontWeight: 800 }}>
                      Blocked by unresolved open question
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", color: "#718096", fontSize: 11 }}>
                    <span>{node.incomingEdgeIds.length} incoming</span>
                    <span>{node.outgoingEdgeIds.length} outgoing</span>
                    {node.blockedByNodeIds.length > 0 ? <span>{node.blockedByNodeIds.length} blockers</span> : null}
                    {node.tags?.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
                  </div>
                </button>
              );
            })}
          </section>

          <aside style={{ minWidth: 0, display: "grid", gap: 12, alignContent: "start" }}>
            {selectedNode ? (
              <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 14, padding: 14, display: "grid", gap: 11 }}>
                <div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {selectedNodeLabel(selectedNode)}
                </div>
                <div style={{ fontSize: 17, fontWeight: 900, wordBreak: "break-word" }}>{selectedNode.title}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", color: "#94a3b8", fontSize: 11 }}>
                  <span>{formatLabel(selectedNode.kind)}</span>
                  <span style={{ color: statusTones[selectedNode.status] }}>{formatLabel(selectedNode.status)}</span>
                  <span>{selectedNode.updatedAt.slice(0, 10)}</span>
                </div>
                {selectedNodeDescription ? (
                  <div style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {selectedNodeDescription}
                  </div>
                ) : null}
                {selectedNode.tags?.length ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {selectedNode.tags.map((tag) => (
                      <span key={tag} style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 999, padding: "3px 8px", color: "#94a3b8", fontSize: 11 }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {selectedPlanDetails.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Codex plan details"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 7 }}
                  >
                    <div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Codex plan
                    </div>
                    <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
                      {selectedPlanDetails.map(([label, value]) => (
                        <div key={label} style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 8, padding: 8 }}>
                          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                          <div style={{ marginTop: 3, color: "#e2e8f0", fontSize: 12, fontWeight: 800, wordBreak: "break-word" }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {selectedPlanLinkedRuns.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Runs derived from plan"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ color: "#c084fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Runs from this plan
                    </div>
                    {selectedPlanLinkedRuns.map(({ node, edge }) => {
                      const trustTone = trustTones[edge.trust];
                      return (
                        <button
                          key={`${edge.id}:${node.id}`}
                          type="button"
                          aria-label={`Focus ${node.title} linked plan run`}
                          onClick={() => focusProductGraphNode(node)}
                          style={{
                            textAlign: "left",
                            background: "#0f172a",
                            border: `1px solid ${trustTone.border}`,
                            borderRadius: 10,
                            padding: 9,
                            color: "#cbd5e1",
                            cursor: "pointer",
                            display: "grid",
                            gap: 5,
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 900, wordBreak: "break-word" }}>{node.title}</span>
                          <span style={{ color: "#94a3b8", fontSize: 11 }}>
                            {formatLabel(node.status)} - {edgeLabel(edge)}
                          </span>
                          <span
                            style={{
                              alignSelf: "start",
                              justifySelf: "start",
                              color: trustTone.color,
                              background: trustTone.background,
                              border: `1px solid ${trustTone.border}`,
                              borderRadius: 999,
                              padding: "2px 7px",
                              fontSize: 10,
                              fontWeight: 900,
                              textTransform: "uppercase",
                            }}
                          >
                            {formatLabel(edge.trust)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {selectedRunDetails.length > 0 ? (
                  <div
                    role="group"
                    aria-label="OpenAgentGraph run details"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 7 }}
                  >
                    <div style={{ color: "#c084fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      OpenAgentGraph run
                    </div>
                    <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
                      {selectedRunDetails.map(([label, value]) => (
                        <div key={label} style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 8, padding: 8 }}>
                          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                          <div style={{ marginTop: 3, color: "#e2e8f0", fontSize: 12, fontWeight: 800, wordBreak: "break-word" }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    {selectedNode.source?.url ? (
                      <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4, wordBreak: "break-word" }}>
                        {selectedNode.source.url}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {selectedEvidenceDetails.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Run evidence details"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 7 }}
                  >
                    <div style={{ color: "#a7f3d0", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Run evidence
                    </div>
                    <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
                      {selectedEvidenceDetails.map(([label, value]) => (
                        <div key={label} style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 8, padding: 8 }}>
                          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                          <div style={{ marginTop: 3, color: "#e2e8f0", fontSize: 12, fontWeight: 800, wordBreak: "break-word" }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    {selectedNode.source?.url ? (
                      <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4, wordBreak: "break-word" }}>
                        {selectedNode.source.url}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {selectedAcceptanceEvidence.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Acceptance evidence"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                        Acceptance evidence
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800 }}>
                        {selectedVerifiedCriterionCount}/{selectedAcceptanceEvidence.length} verified
                      </div>
                    </div>
                    {selectedAcceptanceEvidence.map(({ criterion, verifierNodes, evidenceNodes }) => {
                      const hasVerifier = verifierNodes.length > 0;
                      const hasEvidence = evidenceNodes.length > 0;
                      const hasVerification = hasVerifier || hasEvidence;
                      const evidenceStatus = hasEvidence ? "Evidence linked" : hasVerifier ? "Verifier linked" : "Needs evidence";
                      const evidenceLabels = [...verifierNodes, ...evidenceNodes]
                        .map((node) => node.title)
                        .slice(0, 3);
                      return (
                        <button
                          key={criterion.id}
                          type="button"
                          aria-label={`Focus ${criterion.title} acceptance criterion`}
                          onClick={() => focusProductGraphNode(criterion)}
                          style={{
                            textAlign: "left",
                            background: "#0f172a",
                            border: `1px solid ${hasVerification ? "#16a34a" : "#92400e"}`,
                            borderRadius: 10,
                            padding: 9,
                            color: "#cbd5e1",
                            cursor: "pointer",
                            display: "grid",
                            gap: 5,
                          }}
                        >
                          <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900, wordBreak: "break-word" }}>
                            {criterion.title}
                          </span>
                          <span style={{ color: hasVerification ? "#86efac" : "#fbbf24", fontSize: 11, fontWeight: 800 }}>
                            {evidenceStatus}
                          </span>
                          {evidenceLabels.length > 0 ? (
                            <span style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4, wordBreak: "break-word" }}>
                              {evidenceLabels.join(", ")}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {selectedTaskExecutionEvidence?.hasDrift ? (
                  <div
                    role="group"
                    aria-label="Execution drift"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ color: "#fb7185", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Execution drift
                    </div>
                    <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
                      {[
                        ["Runs", selectedTaskExecutionEvidence.linkedRunCount],
                        ["Evidence", selectedTaskExecutionEvidence.linkedEvidenceCount],
                        ["Files", selectedTaskExecutionEvidence.linkedFileCount],
                      ].map(([label, value]) => (
                        <div key={label} style={{ background: "#0f172a", border: "1px solid #4c1d2f", borderRadius: 8, padding: 8 }}>
                          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                          <div style={{ marginTop: 3, color: "#fecdd3", fontSize: 14, fontWeight: 900 }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ color: "#fda4af", fontSize: 12, lineHeight: 1.45, fontWeight: 800 }}>
                      {selectedTaskExecutionDriftCopy}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>
                      Link a completed OpenAgentGraph run with evidence before treating this task as verified.
                    </div>
                  </div>
                ) : null}
                {!isProductGraphPreview && onLoadCodexPlan && selectedNode.kind === "task" ? (
                  <div
                    role="group"
                    aria-label="Codex planning prompt"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ color: "#93c5fd", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                        Codex plan
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {canEditProductGraph && selectedCodexPlan && onAcceptCodexPlan ? (
                          <button
                            type="button"
                            onClick={handleAcceptCodexPlan}
                            disabled={acceptCodexPlanDisabled}
                            style={{
                              background: acceptCodexPlanDisabled ? "#1f2937" : "#047857",
                              color: acceptCodexPlanDisabled ? "#94a3b8" : "#d1fae5",
                              border: "1px solid #059669",
                              borderRadius: 8,
                              padding: "6px 9px",
                              fontSize: 11,
                              fontWeight: 900,
                              cursor: acceptCodexPlanDisabled ? "not-allowed" : "pointer",
                            }}
                          >
                            {acceptCodexPlanPending ? "Accepting..." : "Accept plan"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={handleLoadCodexPlan}
                          disabled={selectedCodexPlanLoading}
                          style={{
                            background: selectedCodexPlanLoading ? "#1f2937" : "#1d4ed8",
                            color: selectedCodexPlanLoading ? "#94a3b8" : "#dbeafe",
                            border: "1px solid #2563eb",
                            borderRadius: 8,
                            padding: "6px 9px",
                            fontSize: 11,
                            fontWeight: 900,
                            cursor: selectedCodexPlanLoading ? "not-allowed" : "pointer",
                          }}
                        >
                          {selectedCodexPlanLoading ? "Loading plan..." : selectedCodexPlan ? "Refresh plan" : "Load plan"}
                        </button>
                      </div>
                    </div>
                    <div
                      role="group"
                      aria-label="Codex planning readiness"
                      style={{ display: "grid", gap: 6 }}
                    >
                      <div style={{ display: "grid", gap: 3 }}>
                        <div style={{ color: "#64748b", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                          Graph
                        </div>
                        <div style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.45 }}>
                          {selectedTaskPlanningReadinessCopy}
                        </div>
                      </div>
                      <div style={{ display: "grid", gap: 3 }}>
                        <div style={{ color: "#64748b", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                          Context
                        </div>
                        <div style={{ color: "#bfdbfe", fontSize: 12, lineHeight: 1.45 }}>
                          {codebasePlanningContextCopy}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gap: 3,
                          border: `1px solid ${codexExecutionReadinessTone.border}`,
                          background: codexExecutionReadinessTone.background,
                          borderRadius: 8,
                          padding: 8,
                        }}
                      >
                        <div style={{ color: codexExecutionReadinessTone.color, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                          Execution
                        </div>
                        <div style={{ color: codexExecutionReadinessTone.color, fontSize: 12, lineHeight: 1.45 }}>
                          {codexExecutionReadinessNotice.message}
                        </div>
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>
                        {selectedTaskPlanningNextActionCopy}
                      </div>
                    </div>
                    {selectedCodexPlanError ? (
                      <div style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.4 }}>{selectedCodexPlanError}</div>
                    ) : null}
                    {selectedAcceptCodexPlanError ? (
                      <div style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.4 }}>{selectedAcceptCodexPlanError}</div>
                    ) : null}
                    {selectedAcceptCodexPlanMessage ? (
                      <div style={{ color: "#86efac", fontSize: 12, lineHeight: 1.4 }}>{selectedAcceptCodexPlanMessage}</div>
                    ) : null}
                    {selectedCodexPlanRefreshing ? (
                      <div style={{ color: "#67e8f9", fontSize: 12, lineHeight: 1.4 }}>
                        Showing previous plan while refresh runs.
                      </div>
                    ) : null}
                    {selectedCodexPlan ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", color: "#94a3b8", fontSize: 11 }}>
                          <span>{selectedCodexPlan.acceptanceCriteria.length} criteria</span>
                          <span>{selectedCodexPlan.likelyCodeAreas.length} code areas</span>
                          <span>{selectedCodexPlan.openQuestions.length} questions</span>
                          <span>{selectedCodexPlan.verificationCommands.length} checks</span>
                        </div>
                        {selectedCodexPlan.codeMapSummary ? (
                          <div style={{ color: "#bfdbfe", fontSize: 12, lineHeight: 1.45 }}>
                            {selectedCodexPlan.codeMapSummary}
                          </div>
                        ) : null}
                        {selectedCodexPlan.risks.length > 0 ? (
                          <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                              Risks
                            </div>
                            {selectedCodexPlan.risks.map((risk) => (
                              <div key={risk} style={{ color: "#fde68a", fontSize: 12, lineHeight: 1.4 }}>
                                {risk}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ color: "#93c5fd", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                            Verification
                          </div>
                          <div style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.4 }}>
                            {selectedCodexPlan.verificationCommands.join(" / ")}
                          </div>
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            maxHeight: 220,
                            overflow: "auto",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            background: "#0f172a",
                            border: "1px solid #1d4ed8",
                            borderRadius: 8,
                            padding: 10,
                            color: "#dbeafe",
                            fontSize: 11,
                            lineHeight: 1.45,
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                          }}
                        >
                          {selectedCodexPlan.prompt}
                        </pre>
                      </div>
                    ) : selectedCodexPlanLoading || selectedCodexPlanUnavailable ? null : (
                      <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.4 }}>
                        Load a bounded task prompt before starting a Codex implementation session.
                      </div>
                    )}
                  </div>
                ) : null}
                {canEditProductGraph && onLinkRun && selectedNode.kind === "task" ? (
                  <form
                    aria-label="Run linking"
                    onSubmit={handleLinkRun}
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ color: "#c084fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                        Link completed run
                      </div>
                      <button
                        type="submit"
                        disabled={runLinkDisabled}
                        style={{
                          background: runLinkDisabled ? "#1f2937" : "#581c87",
                          color: runLinkDisabled ? "#94a3b8" : "#f3e8ff",
                          border: "1px solid #7e22ce",
                          borderRadius: 8,
                          padding: "6px 9px",
                          fontSize: 11,
                          fontWeight: 900,
                          cursor: runLinkDisabled ? "not-allowed" : "pointer",
                        }}
                      >
                        {runLinkPending ? "Linking run..." : "Link run"}
                      </button>
                    </div>
                    <select
                      aria-label="Completed run"
                      value={resolvedRunLinkGraphId}
                      onChange={(event) => {
                        setRunLinkGraphId(event.target.value);
                        clearRunLinkFeedback();
                      }}
                      disabled={runLinkPending || productGraphLoading || completedRunOptions.length === 0}
                      style={{
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: 8,
                        color: completedRunOptions.length > 0 ? "#e2e8f0" : "#64748b",
                        padding: "8px 10px",
                        fontSize: 12,
                        minWidth: 0,
                      }}
                    >
                      {completedRunOptions.length > 0 ? (
                        completedRunOptions.map((run) => (
                          <option key={run.graphId} value={run.graphId}>
                            {run.goalTitle}
                          </option>
                        ))
                      ) : (
                        <option value="">No completed runs available</option>
                      )}
                    </select>
                    {completedRunOptions.length === 0 ? (
                      <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.4 }}>
                        No completed OpenAgentGraph runs are available to link.
                      </div>
                    ) : null}
                    {visibleRunLinkError ? (
                      <div style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.4 }}>{visibleRunLinkError}</div>
                    ) : null}
                    {visibleRunLinkMessage ? (
                      <div style={{ color: "#86efac", fontSize: 12, lineHeight: 1.4 }}>{visibleRunLinkMessage}</div>
                    ) : null}
                  </form>
                ) : null}
                {!isProductGraphPreview && onLoadTrace ? (
                  <div
                    role="group"
                    aria-label="Traceability"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ color: "#a7f3d0", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                        Traceability
                      </div>
                      <button
                        type="button"
                        onClick={handleLoadTrace}
                        disabled={selectedTraceLoading}
                        style={{
                          background: selectedTraceLoading ? "#1f2937" : "#134e4a",
                          color: selectedTraceLoading ? "#94a3b8" : "#ccfbf1",
                          border: "1px solid #0f766e",
                          borderRadius: 8,
                          padding: "6px 9px",
                          fontSize: 11,
                          fontWeight: 900,
                          cursor: selectedTraceLoading ? "not-allowed" : "pointer",
                        }}
                      >
                        {selectedTraceLoading ? "Loading trace..." : selectedTrace ? "Refresh trace" : "Load trace"}
                      </button>
                    </div>
                    {selectedTraceError ? (
                      <div style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.4 }}>{selectedTraceError}</div>
                    ) : null}
                    {selectedTraceNotice ? (
                      <div style={{ color: "#67e8f9", fontSize: 12, lineHeight: 1.4 }}>{selectedTraceNotice}</div>
                    ) : null}
                    {selectedTraceRefreshing ? (
                      <div style={{ color: "#67e8f9", fontSize: 12, lineHeight: 1.4 }}>
                        Showing previous trace while refresh runs.
                      </div>
                    ) : null}
                    {selectedTrace ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", color: "#94a3b8", fontSize: 11 }}>
                          <span>{selectedTrace.summary.nodeCount} nodes</span>
                          <span>{selectedTrace.summary.edgeCount} links</span>
                          <span>{selectedTrace.summary.codeNodeCount} code</span>
                          <span>{selectedTrace.summary.testResultNodeCount} tests</span>
                          <span>{selectedTrace.summary.evidenceNodeCount} evidence</span>
                        </div>
                        {selectedTraceRelatedNodes.length > 0 ? (
                          <div style={{ display: "grid", gap: 6 }}>
                            {selectedTraceRelatedNodes.map((node) => {
                              const traceRelationshipLabels = traceRelationshipLabelsForNode(selectedTrace, node.id);
                              return (
                                <button
                                  key={node.id}
                                  type="button"
                                  aria-label={`Focus ${node.title} trace node`}
                                  onClick={() => focusProductGraphNode(node)}
                                  style={{
                                    background: "#0f172a",
                                    border: "1px solid #134e4a",
                                    borderRadius: 8,
                                    padding: 8,
                                    display: "grid",
                                    gap: 3,
                                    textAlign: "left",
                                    cursor: "pointer",
                                  }}
                                >
                                  <div style={{ color: "#d1fae5", fontSize: 12, fontWeight: 800, wordBreak: "break-word" }}>
                                    {node.title}
                                  </div>
                                  <div style={{ color: "#5eead4", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
                                    {formatLabel(node.kind)} - {selectedTrace.hopsByNodeId[node.id] ?? 0} hops
                                  </div>
                                  {traceRelationshipLabels.length > 0 ? (
                                    <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.35 }}>
                                      {traceRelationshipLabels.join(" / ")}
                                    </div>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ color: "#64748b", fontSize: 12 }}>No related nodes.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {selectedTaskLinkedRunFiles.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Linked run files"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ color: "#c084fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Linked run files
                    </div>
                    {selectedTaskLinkedRunFiles.map(({ node, edge, runNode }) => {
                      const trustTone = trustTones[edge.trust];
                      return (
                        <button
                          key={`${edge.id}:${node.id}`}
                          type="button"
                          aria-label={`Focus ${node.title} linked run file`}
                          onClick={() => focusProductGraphNode(node)}
                          style={{
                            textAlign: "left",
                            background: "#0f172a",
                            border: `1px solid ${trustTone.border}`,
                            borderRadius: 10,
                            padding: 9,
                            color: "#cbd5e1",
                            cursor: "pointer",
                            display: "grid",
                            gap: 5,
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 900, wordBreak: "break-word" }}>{node.title}</span>
                          <span style={{ color: "#94a3b8", fontSize: 11 }}>
                            {runNode.title} - {edgeLabel(edge)}
                          </span>
                          <span
                            style={{
                              alignSelf: "start",
                              justifySelf: "start",
                              color: trustTone.color,
                              background: trustTone.background,
                              border: `1px solid ${trustTone.border}`,
                              borderRadius: 999,
                              padding: "2px 7px",
                              fontSize: 10,
                              fontWeight: 900,
                              textTransform: "uppercase",
                            }}
                          >
                            {formatLabel(edge.trust)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {isCodeMapNode(selectedNode) ? (
                  <div
                    role="group"
                    aria-label="Code scan details"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 7 }}
                  >
                    <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Code map details
                    </div>
                    {selectedCodeMapDetails.length > 0 ? (
                      <div className="product-graph-stat-grid" style={{ display: "grid", gap: 8 }}>
                        {selectedCodeMapDetails.map(([label, value]) => (
                          <div key={label} style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 8, padding: 8 }}>
                            <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                            <div style={{ marginTop: 3, color: "#e2e8f0", fontSize: 12, fontWeight: 800, wordBreak: "break-word" }}>{value}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {sourcePathLabel(selectedNode) ? (
                      <div style={{ color: "#64748b", fontSize: 11, lineHeight: 1.4, wordBreak: "break-word" }}>
                        {sourcePathLabel(selectedNode)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {selectedCodeMapImpactPathSections.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Impact path preview"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Impact path
                    </div>
                    {selectedCodeMapImpactPathSections.map(({ key, label, section, tone }) => {
                      const hiddenCount = section.totalCount - section.items.length;
                      return (
                        <div
                          key={key}
                          role="group"
                          aria-label={`${label} path preview`}
                          style={{ display: "grid", gap: 5 }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                            <span style={{ color: tone, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>{label}</span>
                            <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800 }}>{section.totalCount}</span>
                          </div>
                          {section.items.length > 0 ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                              {section.items.map(({ node, edge, relation }) => (
                                <button
                                  key={`path:${key}:${edge.id}:${node.id}`}
                                  type="button"
                                  aria-label={`Focus ${node.title} ${label} path item`}
                                  onClick={() => focusProductGraphNode(node)}
                                  style={{
                                    background: "#0f172a",
                                    border: "1px solid #334155",
                                    borderRadius: 6,
                                    color: "#cbd5e1",
                                    cursor: "pointer",
                                    display: "grid",
                                    fontSize: 11,
                                    fontWeight: 800,
                                    gap: 2,
                                    maxWidth: "100%",
                                    overflowWrap: "anywhere",
                                    padding: "5px 7px",
                                    textAlign: "left",
                                  }}
                                >
                                  <span style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 900 }}>{node.title}</span>
                                  <span style={{ color: "#94a3b8", fontSize: 10 }}>
                                    {formatLabel(node.kind)} - {relation}
                                  </span>
                                </button>
                              ))}
                              {hiddenCount > 0 ? (
                                <span style={{ alignSelf: "center", color: "#94a3b8", fontSize: 11, fontWeight: 800 }}>
                                  +{hiddenCount} more
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <div style={{ color: "#64748b", fontSize: 11, lineHeight: 1.4 }}>No path links recorded.</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {selectedCodeMapImpact ? (
                  <div
                    role="group"
                    aria-label="Code impact panel"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ color: "#a7f3d0", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Code impact
                    </div>
                    {selectedCodeMapImpactSections.map(({ key, label, section, tone }) => {
                      const hiddenCount = section.totalCount - section.items.length;
                      return (
                        <div
                          key={key}
                          role="group"
                          aria-label={`${label} impact`}
                          style={{ background: "#0f172a", border: "1px solid #263244", borderRadius: 10, padding: 9, display: "grid", gap: 6 }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                            <span style={{ color: tone, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>{label}</span>
                            <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800 }}>{section.totalCount}</span>
                          </div>
                          {section.items.length > 0 ? (
                            section.items.map(({ node, edge, relation }) => (
                              <button
                                key={`${key}:${edge.id}:${node.id}`}
                                type="button"
                                aria-label={`Focus ${node.title} ${label} impact`}
                                onClick={() => focusProductGraphNode(node)}
                                style={{
                                  textAlign: "left",
                                  background: "#111827",
                                  border: "1px solid #334155",
                                  borderRadius: 8,
                                  padding: 8,
                                  color: "#cbd5e1",
                                  cursor: "pointer",
                                  display: "grid",
                                  gap: 3,
                                }}
                              >
                                <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900, wordBreak: "break-word" }}>
                                  {node.title}
                                </span>
                                <span style={{ color: "#94a3b8", fontSize: 11 }}>
                                  {formatLabel(node.kind)} - {relation}
                                </span>
                              </button>
                            ))
                          ) : (
                            <div style={{ color: "#64748b", fontSize: 11, lineHeight: 1.4 }}>No direct links recorded.</div>
                          )}
                          {hiddenCount > 0 ? (
                            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800 }}>
                              +{hiddenCount} more
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {selectedCommunityMembers.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Code community members"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Community files
                    </div>
                    {selectedCommunityMembers.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        aria-label={`Focus ${node.title} community file`}
                        onClick={() => focusProductGraphNode(node)}
                        style={{
                          textAlign: "left",
                          background: "#0f172a",
                          border: "1px solid #164e63",
                          borderRadius: 10,
                          padding: 9,
                          color: "#cbd5e1",
                          cursor: "pointer",
                          display: "grid",
                          gap: 4,
                        }}
                      >
                        <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900, wordBreak: "break-word" }}>{node.title}</span>
                        <span style={{ color: "#7dd3fc", fontSize: 11 }}>{sourcePathLabel(node) ?? metadataText(node, "scannerSourceFile")}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {selectedFileDependencyEdges.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Code file dependencies"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ color: "#facc15", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      File dependencies
                    </div>
                    {selectedFileDependencyEdges.map((edge) => {
                      const neighborId = edge.sourceNodeId === selectedNode.id ? edge.targetNodeId : edge.sourceNodeId;
                      const neighbor = nodesById.get(neighborId);
                      return (
                        <button
                          key={edge.id}
                          type="button"
                          aria-label={`Focus ${neighbor?.title ?? neighborId} dependency`}
                          onClick={() => {
                            if (neighbor) focusProductGraphNode(neighbor);
                          }}
                          style={{
                            textAlign: "left",
                            background: "#0f172a",
                            border: "1px solid #713f12",
                            borderRadius: 10,
                            padding: 9,
                            color: "#cbd5e1",
                            cursor: neighbor ? "pointer" : "default",
                            display: "grid",
                            gap: 4,
                          }}
                        >
                          <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900, wordBreak: "break-word" }}>
                            {neighbor?.title ?? neighborId}
                          </span>
                          <span style={{ color: "#fde68a", fontSize: 11 }}>
                            {edgeLabel(edge)} - {edgeMetadataText(edge, "scannerResolution") ?? edge.trust}
                          </span>
                          {edgeMetadataText(edge, "scannerDependencySpecifiers") ? (
                            <span style={{ color: "#94a3b8", fontSize: 11, wordBreak: "break-word" }}>
                              {edgeMetadataText(edge, "scannerDependencySpecifiers")}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {selectedSemanticCodeEdges.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Code symbol semantics"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ color: "#22d3ee", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Semantic relationships
                    </div>
                    {selectedSemanticCodeEdges.map((edge) => {
                      const neighborId = edge.sourceNodeId === selectedNode.id ? edge.targetNodeId : edge.sourceNodeId;
                      const neighbor = nodesById.get(neighborId);
                      const endpointLabel = codeMapEdgeEndpointLabel(edge);
                      return (
                        <button
                          key={edge.id}
                          type="button"
                          aria-label={`Focus ${neighbor?.title ?? neighborId} semantic relationship`}
                          onClick={() => {
                            if (neighbor) focusProductGraphNode(neighbor);
                          }}
                          style={{
                            textAlign: "left",
                            background: "#0f172a",
                            border: "1px solid #155e75",
                            borderRadius: 10,
                            padding: 9,
                            color: "#cbd5e1",
                            cursor: neighbor ? "pointer" : "default",
                            display: "grid",
                            gap: 4,
                          }}
                        >
                          <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900, wordBreak: "break-word" }}>
                            {neighbor?.title ?? neighborId}
                          </span>
                          <span style={{ color: "#67e8f9", fontSize: 11 }}>
                            {edgeLabel(edge)} - {edgeMetadataText(edge, "scannerRelation") ?? formatLabel(edge.kind)}
                          </span>
                          {endpointLabel ? (
                            <span style={{ color: "#94a3b8", fontSize: 11, wordBreak: "break-word" }}>
                              {endpointLabel}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {selectedTaskCodeAreas.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Likely code areas"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ color: "#7dd3fc", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Likely code areas
                    </div>
                    {selectedTaskCodeAreas.map(({ node, edge }) => {
                      const trustTone = trustTones[edge.trust];
                      return (
                        <button
                          key={`${edge.id}:${node.id}`}
                          type="button"
                          onClick={() => focusProductGraphNode(node)}
                          style={{
                            textAlign: "left",
                            background: "#0f172a",
                            border: `1px solid ${trustTone.border}`,
                            borderRadius: 10,
                            padding: 9,
                            color: "#cbd5e1",
                            cursor: "pointer",
                            display: "grid",
                            gap: 5,
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 900, wordBreak: "break-word" }}>{node.title}</span>
                          <span style={{ color: "#94a3b8", fontSize: 11 }}>
                            {formatLabel(node.kind)} - {edgeLabel(edge)}
                          </span>
                          <span
                            style={{
                              alignSelf: "start",
                              justifySelf: "start",
                              color: trustTone.color,
                              background: trustTone.background,
                              border: `1px solid ${trustTone.border}`,
                              borderRadius: 999,
                              padding: "2px 7px",
                              fontSize: 10,
                              fontWeight: 900,
                              textTransform: "uppercase",
                            }}
                          >
                            {formatLabel(edge.trust)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {selectedBlockingQuestions.length > 0 ? (
                  <div
                    role="group"
                    aria-label="Open question blockers"
                    style={{ borderTop: "1px solid #263244", paddingTop: 10, display: "grid", gap: 8 }}
                  >
                    <div style={{ color: "#f97316", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      Blocked by open questions
                    </div>
                    {selectedBlockingQuestions.map((question) => (
                      <div key={question.id} style={{ background: "#0f172a", border: "1px solid #7c2d12", borderRadius: 10, padding: 9, display: "grid", gap: 4 }}>
                        <div style={{ color: "#fed7aa", fontSize: 12, fontWeight: 800, wordBreak: "break-word" }}>
                          {question.title}
                        </div>
                        <div style={{ color: statusTones[question.status], fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
                          {formatLabel(question.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 14, padding: 14, display: "grid", gap: 10 }}>
              <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
                Relationships
              </div>
              {selectedEdges.length > 0 && selectedNode ? (
                selectedEdges.map((edge) => {
                  const trustTone = trustTones[edge.trust];
                  const codeEdgeDetails = isDependencyCodeEdge(edge, nodesById) || isSemanticCodeEdge(edge, nodesById)
                    ? codeMapEdgeDetails(edge)
                    : [];
                  return (
                    <div
                      key={edge.id}
                      style={{
                        display: "grid",
                        gap: 5,
                        color: "#94a3b8",
                        fontSize: 12,
                        lineHeight: 1.4,
                        borderLeft: `3px solid ${trustTone.border}`,
                        paddingLeft: 9,
                      }}
                    >
                      <span style={{ color: edgeTones[edge.kind], fontWeight: 900 }}>{edgeLabel(edge)}</span>
                      <span>{buildNeighborLabel(edge, selectedNode.id, nodesById)}</span>
                      {codeEdgeDetails.length > 0 ? (
                        <div
                          aria-label={`${edgeLabel(edge)} code relationship metadata`}
                          style={{ display: "grid", gap: 3 }}
                        >
                          {codeEdgeDetails.map(([label, value]) => (
                            <span key={label} style={{ color: "#cbd5e1", fontSize: 11, wordBreak: "break-word" }}>
                              <strong style={{ color: "#64748b", textTransform: "uppercase" }}>{label}:</strong> {value}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <span
                        style={{
                          alignSelf: "start",
                          justifySelf: "start",
                          color: trustTone.color,
                          background: trustTone.background,
                          border: `1px solid ${trustTone.border}`,
                          borderRadius: 999,
                          padding: "2px 7px",
                          fontSize: 10,
                          fontWeight: 900,
                          textTransform: "uppercase",
                        }}
                      >
                        {formatLabel(edge.trust)}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div style={{ color: "#64748b", fontSize: 12 }}>No relationships for the selected node.</div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

export function ProductGraphView() {
  const {
    productGraph,
    productGraphLoading,
    productGraphError,
    productGraphTrace,
    productGraphTracesByNodeId,
    productGraphTraceNodeId,
    productGraphTraceLoading,
    productGraphTraceError,
    productGraphTraceNotice,
    productGraphCodexPlan,
    productGraphCodexPlanTaskNodeId,
    productGraphCodexPlanLoading,
    productGraphCodexPlanError,
    productGraphHandoff,
    productGraphHandoffLoading,
    productGraphHandoffWriting,
    productGraphHandoffError,
    productGraphHandoffMessage,
    productGraphCodebaseScanProgress,
    loadProductGraph,
    loadProductGraphTrace,
    loadProductGraphCodexPlan,
    loadProductGraphHandoff,
    writeProductGraphHandoff,
    createProductGraphNode,
    createProductGraphEdge,
    createProductGraphIntentBundle,
    scanProductGraphCodebase,
    importProductGraphSpecKit,
    linkProductGraphRun,
    acceptProductGraphCodexPlan,
    dashboard,
    currentActor,
    runtimeFallbackLikely,
    runtimeStatus,
    sessionLifecycle,
  } = useStore();

  useEffect(() => {
    if (shouldAutoLoadProductGraph(productGraph, productGraphLoading, productGraphError)) {
      requestProductGraphLoad(loadProductGraph);
    }
  }, [loadProductGraph, productGraph, productGraphError, productGraphLoading]);

  const completedRuns = useMemo(() => dashboard.filter((run) => run.graphStatus === "completed"), [dashboard]);
  const productGraphPreviewMessage = productGraph?.productGraphId.startsWith("preview:")
    ? PRODUCT_GRAPH_PREVIEW_MESSAGE
    : "";

  return (
    <ProductGraphContent
      productGraph={productGraph}
      productGraphLoading={productGraphLoading}
      productGraphError={productGraphError}
      productGraphPreviewMessage={productGraphPreviewMessage}
      productGraphTrace={productGraphTrace}
      productGraphTracesByNodeId={productGraphTracesByNodeId}
      productGraphTraceNodeId={productGraphTraceNodeId}
      productGraphTraceLoading={productGraphTraceLoading}
      productGraphTraceError={productGraphTraceError}
      productGraphTraceNotice={productGraphTraceNotice}
      productGraphCodexPlan={productGraphCodexPlan}
      productGraphCodexPlanTaskNodeId={productGraphCodexPlanTaskNodeId}
      productGraphCodexPlanLoading={productGraphCodexPlanLoading}
      productGraphCodexPlanError={productGraphCodexPlanError}
      productGraphHandoff={productGraphHandoff}
      productGraphHandoffLoading={productGraphHandoffLoading}
      productGraphHandoffWriting={productGraphHandoffWriting}
      productGraphHandoffError={productGraphHandoffError}
      productGraphHandoffMessage={productGraphHandoffMessage}
      codebaseScanProgress={productGraphCodebaseScanProgress}
      runtimeFallbackLikely={runtimeFallbackLikely}
      runtimeStatus={runtimeStatus}
      sessionLifecycle={sessionLifecycle}
      onRefresh={() => requestProductGraphLoad(loadProductGraph)}
      getProductGraphError={() => useStore.getState().productGraphError}
      canManageProductGraph={canManageProductGraph(currentActor?.role) && !productGraphPreviewMessage}
      onCreateNode={createProductGraphNode}
      onCreateEdge={createProductGraphEdge}
      onCreateIntentBundle={createProductGraphIntentBundle}
      onGenerateHandoff={productGraphPreviewMessage ? undefined : loadProductGraphHandoff}
      onWriteHandoff={productGraphPreviewMessage ? undefined : writeProductGraphHandoff}
      onScanCodebase={scanProductGraphCodebase}
      onImportSpecKit={importProductGraphSpecKit}
      completedRuns={completedRuns}
      onLinkRun={linkProductGraphRun}
      onLoadTrace={productGraphPreviewMessage ? undefined : loadProductGraphTrace}
      onLoadCodexPlan={productGraphPreviewMessage ? undefined : loadProductGraphCodexPlan}
      onAcceptCodexPlan={productGraphPreviewMessage ? undefined : acceptProductGraphCodexPlan}
    />
  );
}
