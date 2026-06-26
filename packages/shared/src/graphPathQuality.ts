import type { UnifiedCodeGraph, UnifiedCodeGraphEdge, UnifiedCodeGraphNode } from "./codeGraph.js";
import { findGraphPath, type GraphPathResult } from "./graphQueryEngine.js";
import type { GraphPathBenchmarkCase } from "./graphReleaseGates.js";

export const GRAPH_PATH_QUALITY_MODEL_VERSION = "1.1";

export const SEMANTIC_PATH_RELATIONS = new Set([
  "calls",
  "references",
  "depends_on",
  "uses",
  "route_to_handler",
  "tests",
  "asset_references",
]);

export const STRUCTURAL_PATH_RELATIONS = new Set([
  "belongs_to",
  "declares",
  "inherits",
  "implements",
  "contains",
  "constructor",
  "source_file",
  "project_reference",
  "using_directive",
]);

const SEMANTIC_EDGE_KINDS = new Set([
  "calls",
  "references",
  "depends_on",
  "uses",
  "tests",
  "documents",
]);

const STRUCTURAL_EDGE_KINDS = new Set([
  "belongs_to",
  "declares",
  "inherits",
  "implements",
  "contains",
]);

const HUB_NODE_KINDS = new Set<UnifiedCodeGraphNode["kind"]>([
  "community",
  "project",
  "workspace",
]);

export interface GraphPathQualityBenchmarkCase extends GraphPathBenchmarkCase {
  forbiddenEdgeKinds?: Array<UnifiedCodeGraphEdge["kind"]>;
  forbiddenEdgeRelations?: string[];
  preferredRelationSequence?: string[];
  maxStructuralHops?: number;
  maxHubHops?: number;
  maxInheritanceHops?: number;
  fromEndpointKind?: UnifiedCodeGraphNode["kind"];
  toEndpointKind?: UnifiedCodeGraphNode["kind"];
  minDirectnessScore?: number;
}

export interface GraphPathQualityMetrics {
  semanticEdgeCount: number;
  structuralEdgeCount: number;
  hubNodeCount: number;
  externalNodeCount: number;
  inheritanceHopCount: number;
  communityCrossings: number;
  endpointFidelityOk: boolean;
  totalWeightedCost: number;
  directnessScore: number;
  relationSequence: string[];
}

export interface GraphPathQualityBenchmarkResult {
  fixture: string;
  from: string;
  to: string;
  passed: boolean;
  metrics: GraphPathQualityMetrics;
  pathLabels: string[];
  detail: string;
}

export function normalizeGraphPathEdgeRelation(
  edge: UnifiedCodeGraphEdge
): string {
  const relation = typeof edge.metadata?.scannerRelation === "string"
    ? edge.metadata.scannerRelation
    : edge.kind;
  if (relation === "semantic_calls") return "calls";
  if (relation === "semantic_constructor") return "constructor";
  if (relation === "semantic_inherits") return "inherits";
  if (relation === "semantic_implements") return "implements";
  if (relation === "source_file") return "belongs_to";
  if (relation === "view_viewmodel" || relation === "xaml_code_behind") return "uses";
  return relation;
}

export function isTestContextGraphNode(node: UnifiedCodeGraphNode) {
  if (node.kind === "test") return true;
  const nodePath = (node.path ?? node.label).replace(/\\/g, "/").toLowerCase();
  return /(?:^|\/)(tests?|__tests__|spec)(?:\/|$)/i.test(nodePath)
    || /\.tests\./i.test(nodePath)
    || /tests\//i.test(nodePath);
}

function edgeRelation(edge: UnifiedCodeGraphEdge) {
  return normalizeGraphPathEdgeRelation(edge);
}

export function isTestConstructorGraphEdge(
  edge: UnifiedCodeGraphEdge,
  sourceNode: UnifiedCodeGraphNode | undefined,
  targetNode: UnifiedCodeGraphNode | undefined,
  lens?: string
) {
  if (normalizeGraphPathEdgeRelation(edge) !== "constructor") return false;
  if (lens === "tests") return false;
  return Boolean(
    (sourceNode && isTestContextGraphNode(sourceNode))
    || (targetNode && isTestContextGraphNode(targetNode))
  );
}

export type GraphPathEdgeQualityClass = "semantic" | "structural";

export function classifyGraphPathEdgeForQuality(edge: UnifiedCodeGraphEdge): GraphPathEdgeQualityClass {
  const relation = normalizeGraphPathEdgeRelation(edge);
  if (STRUCTURAL_PATH_RELATIONS.has(relation)) {
    return "structural";
  }
  if (SEMANTIC_PATH_RELATIONS.has(relation)) {
    return "semantic";
  }
  if (STRUCTURAL_EDGE_KINDS.has(edge.kind)) {
    return "structural";
  }
  if (SEMANTIC_EDGE_KINDS.has(edge.kind)) {
    return "semantic";
  }
  return "structural";
}

export interface GraphPathQualityFailureCounts {
  pathDirectnessFailures: number;
  pathEndpointFidelityFailures: number;
  pathHubDetourFailures: number;
}

export function countGraphPathQualityFailures(
  results: GraphPathQualityBenchmarkResult[]
): GraphPathQualityFailureCounts {
  let pathDirectnessFailures = 0;
  let pathEndpointFidelityFailures = 0;
  let pathHubDetourFailures = 0;
  for (const result of results) {
    if (result.passed) continue;
    if (!result.metrics.endpointFidelityOk) {
      pathEndpointFidelityFailures += 1;
      continue;
    }
    if (/Hub hops|forbidden node kind '(community|project|workspace)'/i.test(result.detail)
      || result.metrics.hubNodeCount > 0 && /Hub hops/i.test(result.detail)) {
      pathHubDetourFailures += 1;
      continue;
    }
    pathDirectnessFailures += 1;
  }
  return { pathDirectnessFailures, pathEndpointFidelityFailures, pathHubDetourFailures };
}

export function hasOrderedRelationSubsequence(sequence: string[], expected: string[]) {
  if (expected.length === 0) return true;
  let index = 0;
  for (const relation of sequence) {
    if (relation === expected[index]) {
      index += 1;
      if (index === expected.length) return true;
    }
  }
  return false;
}

export function evaluateGraphPathQuality(
  graph: UnifiedCodeGraph,
  path: GraphPathResult
): GraphPathQualityMetrics {
  const pathNodes = path.nodes;
  const pathEdges = path.edges;

  let semanticEdgeCount = 0;
  let structuralEdgeCount = 0;
  let inheritanceHopCount = 0;
  const relationSequence: string[] = [];

  for (const edge of pathEdges) {
    const relation = edgeRelation(edge);
    relationSequence.push(relation);
    const qualityClass = classifyGraphPathEdgeForQuality(edge);
    if (qualityClass === "semantic") {
      semanticEdgeCount += 1;
    } else {
      structuralEdgeCount += 1;
    }
    if (edge.kind === "inherits" || relation === "inherits" || relation === "implements") {
      inheritanceHopCount += 1;
    }
  }

  const hubNodeCount = pathNodes.filter((node) => HUB_NODE_KINDS.has(node.kind)).length;
  const externalNodeCount = pathNodes.filter((node) => /\(external\)/i.test(node.label)).length;
  const communityCrossings = new Set(
    pathNodes.filter((node) => node.kind === "community").map((node) => node.id)
  ).size;

  const hopCount = Math.max(pathEdges.length, 1);
  const directnessScore = Math.max(
    0,
    Math.min(1, (semanticEdgeCount + 1) / (semanticEdgeCount + structuralEdgeCount + hubNodeCount + inheritanceHopCount + hopCount))
  );

  return {
    semanticEdgeCount,
    structuralEdgeCount,
    hubNodeCount,
    externalNodeCount,
    inheritanceHopCount,
    communityCrossings,
    endpointFidelityOk: Boolean(path.fromNode && path.toNode),
    totalWeightedCost: path.explanation?.totalCost ?? pathEdges.length,
    directnessScore,
    relationSequence,
  };
}

export function evaluateGraphPathQualityBenchmark(
  graph: UnifiedCodeGraph,
  benchmark: GraphPathQualityBenchmarkCase
): GraphPathQualityBenchmarkResult {
  const path = findGraphPath(graph, benchmark.from, benchmark.to, {
    mode: benchmark.mode ?? "balanced",
    explainRanking: true,
  });
  const pathLabels = path.nodes.map((node) => node.label);
  const fromLabel = path.fromNode?.label;
  const toLabel = path.toNode?.label;
  const fromMatch = fromLabel ? benchmark.fromPattern.test(fromLabel) : false;
  const toMatch = toLabel ? benchmark.toPattern.test(toLabel) : false;
  const metrics = {
    ...evaluateGraphPathQuality(graph, path),
    endpointFidelityOk: Boolean(path.fromNode && path.toNode && fromMatch && toMatch),
  };
  const errors: string[] = [];

  if (!path.found) {
    errors.push("Path was not found.");
  }
  if (!fromMatch) {
    errors.push(`From endpoint '${fromLabel ?? "none"}' does not match ${benchmark.fromPattern}.`);
  }
  if (!toMatch) {
    errors.push(`To endpoint '${toLabel ?? "none"}' does not match ${benchmark.toPattern}.`);
  }
  if (benchmark.forbiddenNodeKinds?.some((kind) => path.nodes.some((node) => node.kind === kind))) {
    errors.push("Path includes forbidden node kind.");
  }
  if (benchmark.forbiddenEdgeKinds?.some((kind) => path.edges.some((edge) => edge.kind === kind))) {
    errors.push("Path includes forbidden edge kind.");
  }
  if (benchmark.forbiddenEdgeRelations?.some((relation) =>
    path.edges.some((edge) => edgeRelation(edge) === relation)
  )) {
    errors.push("Path includes forbidden edge relation.");
  }
  if (typeof benchmark.maxStructuralHops === "number" && metrics.structuralEdgeCount > benchmark.maxStructuralHops) {
    errors.push(`Structural hops ${metrics.structuralEdgeCount} exceed max ${benchmark.maxStructuralHops}.`);
  }
  if (typeof benchmark.maxHubHops === "number" && metrics.hubNodeCount > benchmark.maxHubHops) {
    errors.push(`Hub hops ${metrics.hubNodeCount} exceed max ${benchmark.maxHubHops}.`);
  }
  if (typeof benchmark.maxInheritanceHops === "number" && metrics.inheritanceHopCount > benchmark.maxInheritanceHops) {
    errors.push(`Inheritance hops ${metrics.inheritanceHopCount} exceed max ${benchmark.maxInheritanceHops}.`);
  }
  if (typeof benchmark.minDirectnessScore === "number" && metrics.directnessScore < benchmark.minDirectnessScore) {
    errors.push(`Directness ${metrics.directnessScore.toFixed(2)} below min ${benchmark.minDirectnessScore}.`);
  }
  if (benchmark.preferredRelationSequence?.length) {
    const expected = benchmark.preferredRelationSequence.join(">");
    if (!hasOrderedRelationSubsequence(metrics.relationSequence, benchmark.preferredRelationSequence)) {
      errors.push(`Preferred relation sequence '${expected}' not present.`);
    }
  }
  if (benchmark.fromEndpointKind && path.fromNode?.kind !== benchmark.fromEndpointKind) {
    errors.push(`From endpoint kind '${path.fromNode?.kind ?? "none"}' != '${benchmark.fromEndpointKind}'.`);
  }
  if (benchmark.toEndpointKind && path.toNode?.kind !== benchmark.toEndpointKind) {
    errors.push(`To endpoint kind '${path.toNode?.kind ?? "none"}' != '${benchmark.toEndpointKind}'.`);
  }

  return {
    fixture: benchmark.fixture,
    from: benchmark.from,
    to: benchmark.to,
    passed: errors.length === 0,
    metrics,
    pathLabels,
    detail: errors.length === 0
      ? `Path quality ok (directness=${metrics.directnessScore.toFixed(2)}).`
      : errors.join(" "),
  };
}

export const GRAPH_PATH_QUALITY_BENCHMARKS: GraphPathQualityBenchmarkCase[] = [
  {
    fixture: "fixture-csharp-media-player",
    from: "MainViewModel",
    to: "MpvPlayerAdapter",
    fromPattern: /MainViewModel/i,
    toPattern: /MpvPlayerAdapter/i,
    mode: "balanced",
    forbiddenNodeKinds: ["doc_section", "doc_file"],
    forbiddenEdgeRelations: ["doc_link", "doc_wikilink", "doc_code_ref"],
    maxHubHops: 0,
    maxInheritanceHops: 1,
    minDirectnessScore: 0.2,
    preferredRelationSequence: ["depends_on", "references"],
  },
  {
    fixture: "fixture-csharp-media-player",
    from: "MainViewModel",
    to: "PlaybackService",
    fromPattern: /MainViewModel/i,
    toPattern: /PlaybackService/i,
    mode: "balanced",
    forbiddenNodeKinds: ["doc_section", "doc_file", "community"],
    maxHubHops: 0,
    minDirectnessScore: 0.15,
  },
  {
    fixture: "fixture-java-maven",
    from: "CheckoutService",
    to: "Order",
    fromPattern: /CheckoutService/i,
    toPattern: /Order/i,
    maxHubHops: 1,
    minDirectnessScore: 0.1,
  },
  {
    fixture: "fixture-docs-mixed-code",
    from: "CheckoutController",
    to: "CheckoutService",
    fromPattern: /CheckoutController/i,
    toPattern: /CheckoutService/i,
    forbiddenNodeKinds: ["doc_section", "doc_file"],
    maxHubHops: 0,
    minDirectnessScore: 0.1,
  },
];