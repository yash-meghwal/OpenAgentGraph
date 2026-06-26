import type { UnifiedCodeGraphEdge, UnifiedCodeGraphNode } from "./codeGraph.js";
import { isDocPathEdgeRelation, shouldPenalizeDocPathDetour, type GraphPathIntent } from "./graphPathIntent.js";
import {
  isTestConstructorGraphEdge,
  normalizeGraphPathEdgeRelation,
  SEMANTIC_PATH_RELATIONS,
} from "./graphPathQuality.js";
import { GRAPH_PATH_QUALITY_MODEL_VERSION } from "./graphPathQuality.js";

/**
 * Browser path preview uses the same versioned cost model as graphQueryEngine.
 */
export const GRAPH_EXPLORER_PATH_MODEL_VERSION = GRAPH_PATH_QUALITY_MODEL_VERSION;

export type ExplorerPathMode = "balanced" | "semantic" | "structural";

export interface ExplorerPathEdgeInput {
  kind: string;
  provenance: string;
  scannerRelation?: string;
}

export interface ExplorerPathNodeInput {
  kind: string;
  label: string;
  path?: string;
}

const SEMANTIC_RELATION_COSTS = new Map<string, number>([
  ["calls", 3],
  ["references", 4],
  ["depends_on", 5],
  ["uses", 5],
  ["route_to_handler", 6],
  ["asset_references", 8],
]);

const SEMANTIC_PATH_EDGE_KINDS = new Set([
  "references",
  "depends_on",
  "implements",
  "inherits",
  "tests",
  "declares",
]);

function constructorRelationCost(mode: ExplorerPathMode) {
  if (mode === "structural") return 90;
  if (mode === "semantic") return 32;
  return 28;
}

function lookupSemanticRelationCost(relation: string, mode: ExplorerPathMode, lens?: string) {
  if (relation === "constructor") {
    return constructorRelationCost(mode);
  }
  if (relation === "tests") {
    return lens === "tests" ? 4 : 24;
  }
  return SEMANTIC_RELATION_COSTS.get(relation);
}

function asGraphEdge(edge: ExplorerPathEdgeInput): UnifiedCodeGraphEdge {
  return {
    id: "explorer-edge",
    sourceNodeId: "source",
    targetNodeId: "target",
    kind: edge.kind as UnifiedCodeGraphEdge["kind"],
    provenance: edge.provenance as UnifiedCodeGraphEdge["provenance"],
    metadata: edge.scannerRelation ? { scannerRelation: edge.scannerRelation } : undefined,
  };
}

function asGraphNode(node: ExplorerPathNodeInput | undefined): UnifiedCodeGraphNode | undefined {
  if (!node) return undefined;
  return {
    id: "explorer-node",
    kind: node.kind as UnifiedCodeGraphNode["kind"],
    label: node.label,
    path: node.path,
  };
}

function isSemanticPathEdge(edge: ExplorerPathEdgeInput, mode: ExplorerPathMode) {
  if (mode !== "semantic") return true;
  if (edge.provenance !== "extracted" && edge.provenance !== "manual") return false;
  if (SEMANTIC_PATH_EDGE_KINDS.has(edge.kind)) return true;
  const relation = normalizeGraphPathEdgeRelation(asGraphEdge(edge));
  return relation === "belongs_to" || relation === "declares";
}

/**
 * Mirrors computeGraphPathEdgeCost for offline explorer edges (no precomputed pathCosts bucket).
 */
export function computeExplorerPathEdgeCost(
  edge: ExplorerPathEdgeInput,
  options: {
    mode?: ExplorerPathMode;
    pathIntent?: GraphPathIntent;
    lens?: string;
  } = {},
  context: {
    sourceNode?: ExplorerPathNodeInput;
    targetNode?: ExplorerPathNodeInput;
  } = {}
): number {
  const mode = options.mode ?? "balanced";
  const graphEdge = asGraphEdge(edge);
  if (!isSemanticPathEdge(edge, mode)) {
    return Number.POSITIVE_INFINITY;
  }

  const rawRelation = edge.scannerRelation;
  const relation = normalizeGraphPathEdgeRelation(graphEdge);
  const pathIntent = options.pathIntent ?? "mixed_or_unknown";
  if (shouldPenalizeDocPathDetour(pathIntent, mode)
    && isDocPathEdgeRelation(rawRelation, edge.kind)) {
    return Number.POSITIVE_INFINITY;
  }
  if (isTestConstructorGraphEdge(
    graphEdge,
    asGraphNode(context.sourceNode),
    asGraphNode(context.targetNode),
    options.lens
  )) {
    return Number.POSITIVE_INFINITY;
  }

  const balancedKindBase: Record<string, number> = {
    references: 4,
    depends_on: 5,
    implements: pathIntent === "code_to_code" ? 14 : 8,
    inherits: pathIntent === "code_to_code" ? 16 : 9,
    tests: options.lens === "tests" ? 4 : 24,
    declares: 28,
    belongs_to: mode === "structural" ? 45 : relation === "belongs_to" ? 220 : 120,
    documents: 55,
    related_to: 50,
    build_produces: 75,
  };
  const provenanceMultiplier: Record<string, number> = {
    extracted: 1,
    manual: 1,
    inferred: mode === "structural" ? 1.1 : 1.25,
    ambiguous: mode === "structural" ? 1.25 : 1.6,
  };
  const relationCost = lookupSemanticRelationCost(relation, mode, options.lens);
  let cost = relationCost ?? (balancedKindBase[edge.kind] ?? 35);
  cost *= (provenanceMultiplier[edge.provenance] ?? 1.4);
  if (relation === "belongs_to" && pathIntent === "code_to_code" && mode !== "structural") {
    cost = Math.max(cost, mode === "semantic" ? 320 : 220);
  }
  if (relationCost !== undefined && SEMANTIC_PATH_RELATIONS.has(relation) && pathIntent === "code_to_code") {
    cost = Math.min(cost, relationCost);
  }
  if (!Number.isFinite(cost)) {
    return Number.POSITIVE_INFINITY;
  }
  return cost;
}

export function explorerEdgeCostBlocked(cost: number) {
  return !Number.isFinite(cost) || cost >= 9000;
}

export function buildGraphPathExplorerBrowserScript(): string {
  return `
  function normalizeRelation(edge) {
    const relation = edge.scannerRelation || edge.kind || "";
    if (relation === "semantic_calls") return "calls";
    if (relation === "semantic_constructor") return "constructor";
    if (relation === "semantic_inherits") return "inherits";
    if (relation === "semantic_implements") return "implements";
    if (relation === "source_file") return "belongs_to";
    if (relation === "view_viewmodel" || relation === "xaml_code_behind") return "uses";
    return relation;
  }

  function isTestContextNode(node) {
    if (!node) return false;
    if (node.kind === "test") return true;
    const nodePath = String(node.path || node.label || "").replace(/\\\\/g, "/").toLowerCase();
    return /(?:^|\\/)(tests?|__tests__|spec)(?:\\/|$)/i.test(nodePath)
      || /\\.tests\\./i.test(nodePath)
      || /tests\\//i.test(nodePath);
  }

  function isTestConstructorEdge(edge, sourceNode, targetNode, lensId) {
    if (lensId === "tests") return false;
    if (normalizeRelation(edge) !== "constructor") return false;
    return isTestContextNode(sourceNode) || isTestContextNode(targetNode);
  }

  function isDocPathEdge(edge) {
    const relation = edge.scannerRelation || "";
    return edge.kind === "documents"
      || relation === "doc_link"
      || relation === "doc_wikilink"
      || relation === "doc_code_ref";
  }

  function shouldPenalizeDocDetour(pathIntent, mode) {
    return pathIntent === "code_to_code" && mode !== "structural";
  }

  function lookupRelationCost(relation, mode, lensId) {
    if (relation === "constructor") {
      if (mode === "structural") return 90;
      if (mode === "semantic") return 32;
      return 28;
    }
    if (relation === "tests") return lensId === "tests" ? 4 : 24;
    const table = { calls: 3, references: 4, depends_on: 5, uses: 5, route_to_handler: 6, asset_references: 8 };
    return table[relation];
  }

  function isSemanticPathEdge(edge, mode) {
    if (mode !== "semantic") return true;
    if (edge.provenance !== "extracted" && edge.provenance !== "manual") return false;
    if (["references", "depends_on", "implements", "inherits", "tests", "declares"].includes(edge.kind)) return true;
    const relation = normalizeRelation(edge);
    return relation === "belongs_to" || relation === "declares";
  }

  function computeEdgeCost(edge, mode, pathIntent, lensId, sourceNode, targetNode) {
    if (!isSemanticPathEdge(edge, mode)) return 9999;
    const relation = normalizeRelation(edge);
    if (shouldPenalizeDocDetour(pathIntent, mode) && isDocPathEdge(edge)) return 9999;
    if (isTestConstructorEdge(edge, sourceNode, targetNode, lensId)) return 9999;
    const provenanceMultiplier = {
      extracted: 1,
      manual: 1,
      inferred: mode === "structural" ? 1.1 : 1.25,
      ambiguous: mode === "structural" ? 1.25 : 1.6,
    };
    const kindBase = {
      references: 4,
      depends_on: 5,
      implements: pathIntent === "code_to_code" ? 14 : 8,
      inherits: pathIntent === "code_to_code" ? 16 : 9,
      tests: lensId === "tests" ? 4 : 24,
      declares: 28,
      belongs_to: mode === "structural" ? 45 : relation === "belongs_to" ? 220 : 120,
      documents: 55,
      related_to: 50,
      build_produces: 75,
    };
    const relationCost = lookupRelationCost(relation, mode, lensId);
    let cost = relationCost ?? (kindBase[edge.kind] ?? 35);
    cost *= (provenanceMultiplier[edge.provenance] ?? 1.4);
    if (relation === "belongs_to" && pathIntent === "code_to_code" && mode !== "structural") {
      cost = Math.max(cost, mode === "semantic" ? 320 : 220);
    }
    if (relationCost !== undefined && ["calls", "references", "depends_on", "uses", "route_to_handler", "tests", "asset_references"].includes(relation) && pathIntent === "code_to_code") {
      cost = Math.min(cost, relationCost);
    }
    return Number.isFinite(cost) ? cost : 9999;
  }

  function isStructuralRelation(relation, edgeKind) {
    return relation === "belongs_to"
      || relation === "source_file"
      || relation === "declares"
      || relation === "constructor"
      || relation === "project_reference"
      || relation === "using_directive"
      || edgeKind === "belongs_to"
      || edgeKind === "declares";
  }

  function isInheritanceRelation(relation, edgeKind) {
    return relation === "inherits" || relation === "implements" || edgeKind === "inherits" || edgeKind === "implements";
  }

  let nodeDegreeMap = null;
  function ensureDegreeMap() {
    if (nodeDegreeMap) return nodeDegreeMap;
    nodeDegreeMap = new Map();
    for (const edge of data.edges) {
      nodeDegreeMap.set(edge.sourceNodeId, (nodeDegreeMap.get(edge.sourceNodeId) || 0) + 1);
      nodeDegreeMap.set(edge.targetNodeId, (nodeDegreeMap.get(edge.targetNodeId) || 0) + 1);
    }
    return nodeDegreeMap;
  }

  function isLowValueBridgeNode(node) {
    if (!node) return false;
    if (node.kind === "workspace") return true;
    if (node.kind === "project" && (node.label === "workspace-root" || node.path === ".")) return true;
    if (node.kind === "package" || node.kind === "directory") return true;
    if (node.kind === "community") return true;
    if (node.kind === "god_node") return true;
    if (node.kind === "symbol" && /\\(namespace\\)/i.test(node.label)) return true;
    if (node.kind === "symbol" && /\\(external\\)/i.test(node.label)) return true;
    return false;
  }

  function isHubNode(node) {
    if (!node) return false;
    if (isLowValueBridgeNode(node)) return true;
    const degreeMap = ensureDegreeMap();
    return (degreeMap.get(node.id) || 0) >= 12;
  }

  function lensAllowsNode(node, lensId) {
    if (!lensId || lensId === "all") return true;
    return (node.lensIds || []).includes(lensId);
  }

  function comparePathRanks(left, right) {
    if (left.cost !== right.cost) return left.cost - right.cost;
    if (left.testHops !== right.testHops) return left.testHops - right.testHops;
    if (left.structuralHops !== right.structuralHops) return left.structuralHops - right.structuralHops;
    if (left.hubHops !== right.hubHops) return left.hubHops - right.hubHops;
    if (left.inheritanceHops !== right.inheritanceHops) return left.inheritanceHops - right.inheritanceHops;
    return left.hopCount - right.hopCount;
  }

  function buildPathRank(previous, edge, edgeCost, nodePenalty, neighbor, mode) {
    const relation = normalizeRelation(edge);
    return {
      cost: previous.cost + edgeCost + nodePenalty,
      testHops: previous.testHops + (isTestContextNode(neighbor) ? 1 : 0),
      structuralHops: previous.structuralHops + (isStructuralRelation(relation, edge.kind) ? 1 : 0),
      hubHops: previous.hubHops + (isHubNode(neighbor) ? 1 : 0),
      inheritanceHops: previous.inheritanceHops + (isInheritanceRelation(relation, edge.kind) ? 1 : 0),
      hopCount: previous.hopCount + 1,
    };
  }

  function nodePenalty(node, mode, pathIntent, lensId) {
    if (mode === "semantic" && ["workspace", "project", "community", "package", "directory"].includes(node.kind)) {
      return 50000;
    }
    if (pathIntent === "code_to_code" && mode !== "structural" && (node.kind === "doc_section" || node.kind === "doc_file")) {
      return 50000;
    }
    if (pathIntent === "code_to_code" && lensId !== "tests" && isTestContextNode(node)) {
      return 12000;
    }
    let symbolPenalty = 2;
    if (node.kind === "symbol" && /\\(namespace\\)/i.test(node.label)) symbolPenalty = 900;
    else if (node.kind === "symbol" && /\\(external\\)/i.test(node.label)) symbolPenalty = 700;
    else if (node.kind === "symbol" && /\\(interface\\)/i.test(node.label)) symbolPenalty = pathIntent === "code_to_code" ? 180 : 80;
    else if (node.kind === "symbol" && /\\(field\\)|\\(property\\)/i.test(node.label)) symbolPenalty = 240;
    else if (node.kind === "symbol" && /\\(method\\)|\\(function\\)/i.test(node.label)) symbolPenalty = 12;
    const base = {
      workspace: 5000,
      project: 2500,
      package: 450,
      directory: 400,
      community: 350,
      god_node: 250,
      code_file: 18,
      test: lensId === "tests" ? 4 : 12000,
      symbol: symbolPenalty,
      external_dep: 500,
    };
    let penalty = base[node.kind] ?? 40;
    if (mode === "structural") penalty *= 0.35;
    return penalty;
  }

  function edgeCost(edge, mode, pathIntent, lensId, sourceNode, targetNode) {
    return computeEdgeCost(edge, mode, pathIntent, lensId, sourceNode, targetNode);
  }
`;
}