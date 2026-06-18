import type {
  UnifiedCodeGraph,
  UnifiedCodeGraphEdge,
  UnifiedCodeGraphNode,
  UnifiedCodeGraphProvenance,
} from "./codeGraph.js";
import { buildGraphProvenanceSummary } from "./graphExportBundle.js";
import type { ProductGraphEdge } from "./productGraph.js";

export const GRAPH_EDGE_DERIVATION_SOURCES = [
  "typescript",
  "roslyn",
  "dotnet-structural",
  "javakotlin-semantic-lite",
  "java-structural",
  "php-semantic-lite",
  "php-structural",
  "ruby-semantic-lite",
  "ruby-structural",
  "swift-structural",
  "cpp-structural",
  "dart-structural",
  "godot-structural",
  "unity-structural",
  "unreal-structural",
  "python-structural",
  "go-structural",
  "rust-structural",
  "terraform-structural",
  "xaml",
  "docs",
  "generic",
  "kernel",
] as const;

export type GraphEdgeDerivationSource = (typeof GRAPH_EDGE_DERIVATION_SOURCES)[number];

export const EDGE_PROVENANCE_CONFIDENCE_DEFAULTS: Record<UnifiedCodeGraphProvenance, number> = {
  extracted: 0.92,
  inferred: 0.65,
  ambiguous: 0.45,
  manual: 0.85,
};

export interface GraphEdgeSourceSummary {
  source: GraphEdgeDerivationSource;
  edgeCount: number;
}

export interface EdgeProvenanceGateResult {
  ok: boolean;
  missingProvenance: string[];
  missingSource: string[];
  missingConfidence: string[];
  errors: string[];
}

export function isGraphEdgeDerivationSource(value: string): value is GraphEdgeDerivationSource {
  return (GRAPH_EDGE_DERIVATION_SOURCES as readonly string[]).includes(value);
}

export function resolveEdgeConfidence(
  provenance: UnifiedCodeGraphProvenance,
  explicit?: number | null
): number {
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return Math.min(1, Math.max(0, explicit));
  }
  return EDGE_PROVENANCE_CONFIDENCE_DEFAULTS[provenance];
}

export function mapProductTrustToProvenance(trust: ProductGraphEdge["trust"]): UnifiedCodeGraphProvenance {
  switch (trust) {
    case "manual":
      return "manual";
    case "inferred":
      return "inferred";
    case "ambiguous":
      return "ambiguous";
    default:
      return "extracted";
  }
}

export function inferProductEdgeDerivationSource(edge: ProductGraphEdge): GraphEdgeDerivationSource {
  const explicit = edge.metadata?.edgeDerivationSource;
  if (typeof explicit === "string" && isGraphEdgeDerivationSource(explicit)) {
    return explicit;
  }

  if (edge.metadata?.scannerDotNetRoslynVersion) return "roslyn";

  const relation = typeof edge.metadata?.scannerRelation === "string"
    ? edge.metadata.scannerRelation
    : undefined;
  if (relation === "xaml_code_behind") return "xaml";

  const resolution = typeof edge.metadata?.scannerResolution === "string"
    ? edge.metadata.scannerResolution
    : undefined;
  const language = typeof edge.metadata?.scannerLanguage === "string"
    ? edge.metadata.scannerLanguage
    : undefined;

  switch (language) {
    case "typescript":
    case "javascript":
      return "typescript";
    case "csharp":
      return resolution === "semantic" ? "roslyn" : "dotnet-structural";
    case "java":
    case "kotlin":
      return resolution === "semantic-lite" || resolution === "semantic"
        ? "javakotlin-semantic-lite"
        : "java-structural";
    case "php":
      return resolution === "semantic-lite" ? "php-semantic-lite" : "php-structural";
    case "ruby":
      return resolution === "semantic-lite" ? "ruby-semantic-lite" : "ruby-structural";
    case "swift":
      return "swift-structural";
    case "dart":
      return "dart-structural";
    case "cpp":
    case "c":
      return "cpp-structural";
    case "gdscript":
    case "godot":
      return "godot-structural";
    case "unity":
      return "unity-structural";
    case "unreal":
      return "unreal-structural";
    case "python":
      return "python-structural";
    case "go":
      return "go-structural";
    case "rust":
      return "rust-structural";
    case "terraform":
      return "terraform-structural";
    case "documentation":
      return "docs";
    default:
      break;
  }

  if (
    relation === "doc_link"
    || relation === "doc_wikilink"
    || relation === "doc_code_ref"
    || relation === "doc_section"
    || relation === "doc_section_parent"
  ) {
    return "docs";
  }

  if (edge.trust === "inferred" || edge.trust === "ambiguous") return "generic";
  return "generic";
}

export function inferScannerEdgeDerivationSource(scannerId?: string): GraphEdgeDerivationSource {
  switch (scannerId) {
    case "typescript":
      return "typescript";
    case "dotnet":
      return "dotnet-structural";
    case "java":
      return "java-structural";
    case "php":
      return "php-structural";
    case "ruby":
      return "ruby-structural";
    case "swift":
      return "swift-structural";
    case "flutter":
      return "dart-structural";
    case "cpp":
      return "cpp-structural";
    case "godot":
      return "godot-structural";
    case "unity":
      return "unity-structural";
    case "unreal":
      return "unreal-structural";
    case "python":
      return "python-structural";
    case "go":
      return "go-structural";
    case "rust":
      return "rust-structural";
    case "terraform":
      return "terraform-structural";
    case "kernel":
      return "kernel";
    default:
      return "generic";
  }
}

export function finalizeUnifiedGraphEdge(
  edge: UnifiedCodeGraphEdge,
  input?: { scannerId?: string; productEdge?: ProductGraphEdge }
): UnifiedCodeGraphEdge {
  const provenance = edge.provenance;
  const source = edge.source
    ?? (input?.productEdge
      ? inferProductEdgeDerivationSource(input.productEdge)
      : inferScannerEdgeDerivationSource(input?.scannerId ?? edge.scannerId));
  const confidence = resolveEdgeConfidence(provenance, edge.confidence);
  return {
    ...edge,
    source,
    confidence,
  };
}

function isCommunityScopedEdge(
  edge: UnifiedCodeGraphEdge,
  nodeById: Map<string, UnifiedCodeGraphNode>
) {
  const source = nodeById.get(edge.sourceNodeId);
  const target = nodeById.get(edge.targetNodeId);
  return source?.kind === "community" || target?.kind === "community";
}

export function evaluateEdgeProvenanceReleaseGates(graph: UnifiedCodeGraph): EdgeProvenanceGateResult {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const missingProvenance: string[] = [];
  const missingSource: string[] = [];
  const missingConfidence: string[] = [];

  for (const edge of graph.edges) {
    if (isCommunityScopedEdge(edge, nodeById)) continue;
    if (!edge.provenance) missingProvenance.push(edge.id);
    if (!edge.source || !isGraphEdgeDerivationSource(edge.source)) missingSource.push(edge.id);
    if (
      (edge.provenance === "inferred" || edge.provenance === "ambiguous")
      && typeof edge.confidence !== "number"
    ) {
      missingConfidence.push(edge.id);
    }
  }

  const errors: string[] = [];
  if (missingProvenance.length > 0) {
    errors.push(`Edges missing provenance: ${missingProvenance.slice(0, 8).join(", ")}${missingProvenance.length > 8 ? "…" : ""}`);
  }
  if (missingSource.length > 0) {
    errors.push(`Edges missing derivation source: ${missingSource.slice(0, 8).join(", ")}${missingSource.length > 8 ? "…" : ""}`);
  }
  if (missingConfidence.length > 0) {
    errors.push(`Inferred/ambiguous edges missing confidence: ${missingConfidence.slice(0, 8).join(", ")}${missingConfidence.length > 8 ? "…" : ""}`);
  }

  return {
    ok: errors.length === 0,
    missingProvenance,
    missingSource,
    missingConfidence,
    errors,
  };
}

export function buildGraphEdgeSourceSummary(graph: UnifiedCodeGraph): GraphEdgeSourceSummary[] {
  const counts = new Map<GraphEdgeDerivationSource, number>();
  for (const edge of graph.edges) {
    if (!edge.source || !isGraphEdgeDerivationSource(edge.source)) continue;
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, edgeCount]) => ({ source, edgeCount }))
    .sort((left, right) => right.edgeCount - left.edgeCount || left.source.localeCompare(right.source));
}

export function renderEdgeProvenanceMarkdown(graph: UnifiedCodeGraph): string[] {
  const summary = graph.export?.provenance ?? buildGraphProvenanceSummary(graph);
  const sourceRows = buildGraphEdgeSourceSummary(graph);
  const lines = [
    "## Edge provenance",
    ...(summary
      ? [
        `- Extracted: ${summary.extractedEdgeCount}`,
        `- Inferred: ${summary.inferredEdgeCount}`,
        `- Ambiguous: ${summary.ambiguousEdgeCount}`,
        `- Manual: ${summary.manualEdgeCount}`,
        `- Extracted share: ${summary.extractedPercent}%`,
      ]
      : ["- No provenance summary recorded."]),
    ...(sourceRows.length > 0
      ? ["- Derivation sources:", ...sourceRows.slice(0, 12).map((row) => `  - ${row.source}: ${row.edgeCount}`)]
      : []),
  ];
  return lines;
}

export function formatEdgeProvenanceLabel(edge: UnifiedCodeGraphEdge): string {
  const confidence = typeof edge.confidence === "number"
    ? `${Math.round(edge.confidence * 100)}%`
    : "n/a";
  return `${edge.provenance} · ${edge.source ?? "unknown"} · ${confidence}`;
}