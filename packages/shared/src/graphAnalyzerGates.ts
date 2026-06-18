import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  edgeRequiresExplicitEndpoints,
  isSemanticResolutionEdge,
  normalizeScannerRelation,
} from "./semanticEdgeNormalization.js";

const FORBIDDEN_BODY_KEYS = new Set([
  "body",
  "sourceBody",
  "fileBody",
  "content",
  "sourceContent",
  "rawContent",
  "text",
  "sourceText",
]);

export interface AnalyzerReleaseGateResult {
  ok: boolean;
  danglingSemanticEdges: string[];
  missingFallbackAnalyzers: string[];
  importEdgesWithoutExternalNodes: string[];
  analyzerDiagnosticsWithBodies: string[];
  errors: string[];
}

function nodeLooksExternal(node: { id: string; label: string; metadata?: Record<string, string | number | boolean | null> }) {
  const productNodeId = node.metadata?.productNodeId;
  if (typeof productNodeId === "string" && productNodeId.includes("code-scan:external")) return true;
  if (node.metadata?.scannerRelation === "external_import" || node.metadata?.scannerRelation === "external_using") {
    return true;
  }
  return /\(external\)/i.test(node.label);
}

export function evaluateSemanticLiteEdgeKindPreservation(graph: UnifiedCodeGraph) {
  const errors: string[] = [];
  for (const edge of graph.edges) {
    const relation = edge.metadata?.scannerRelation;
    if (relation === "extends" && edge.kind !== "inherits") {
      errors.push(`Semantic-lite extends edge '${edge.id}' exported as '${edge.kind}', expected 'inherits'.`);
    }
    if (relation === "implements" && edge.kind !== "implements") {
      errors.push(`Semantic-lite implements edge '${edge.id}' exported as '${edge.kind}', expected 'implements'.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function evaluateAnalyzerReleaseGates(input: {
  graph: UnifiedCodeGraph;
  handoffMarkdown?: string;
}): AnalyzerReleaseGateResult {
  const errors: string[] = [];
  const nodeById = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const danglingSemanticEdges: string[] = [];
  const importEdgesWithoutExternalNodes: string[] = [];

  for (const edge of input.graph.edges) {
    const metadata = edge.metadata as Record<string, unknown> | undefined;
    const sourceExists = nodeById.has(edge.sourceNodeId);
    const targetExists = nodeById.has(edge.targetNodeId);
    if (!sourceExists || !targetExists) {
      if (isSemanticResolutionEdge(metadata) || edgeRequiresExplicitEndpoints(metadata)) {
        danglingSemanticEdges.push(edge.id);
      }
      continue;
    }

    const relation = normalizeScannerRelation(
      typeof metadata?.scannerRelation === "string" ? metadata.scannerRelation : undefined
    );
    if (relation !== "imports") continue;
    const target = nodeById.get(edge.targetNodeId);
    if (!target) continue;
    const resolution = metadata?.scannerImportResolution ?? metadata?.scannerResolution;
    if (resolution === "symbol" || resolution === "file") continue;
    if (!nodeLooksExternal(target)) {
      importEdgesWithoutExternalNodes.push(edge.id);
    }
  }

  const handoff = input.handoffMarkdown ?? "";
  const missingFallbackAnalyzers: string[] = [];
  for (const analyzer of input.graph.analyzers ?? []) {
    if (analyzer.status !== "unavailable") continue;
    const mentionsAnalyzer = handoff.includes(analyzer.label)
      || input.graph.diagnostics.some((line) => line.includes(analyzer.label));
    const mentionsFallback = Boolean(analyzer.fallbackReason)
      && (
        handoff.includes(analyzer.fallbackReason!)
        || input.graph.diagnostics.some((line) => line.includes(analyzer.fallbackReason!))
      );
    if (!mentionsAnalyzer && !mentionsFallback) {
      missingFallbackAnalyzers.push(analyzer.id);
    }
  }

  const analyzerDiagnosticsWithBodies: string[] = [];
  for (const analyzer of input.graph.analyzers ?? []) {
    const serialized = JSON.stringify(analyzer);
    for (const key of FORBIDDEN_BODY_KEYS) {
      if (serialized.includes(`"${key}"`)) {
        analyzerDiagnosticsWithBodies.push(analyzer.id);
        break;
      }
    }
  }

  if (danglingSemanticEdges.length > 0) {
    errors.push(`Dangling semantic/import edges: ${danglingSemanticEdges.join(", ")}`);
  }
  if (importEdgesWithoutExternalNodes.length > 0) {
    errors.push(`Import edges without explicit external nodes: ${importEdgesWithoutExternalNodes.join(", ")}`);
  }
  for (const analyzerId of missingFallbackAnalyzers) {
    errors.push(`Unavailable analyzer '${analyzerId}' fallback is not visible in handoff/diagnostics.`);
  }
  for (const analyzerId of analyzerDiagnosticsWithBodies) {
    errors.push(`Analyzer '${analyzerId}' diagnostics may include forbidden source body fields.`);
  }

  return {
    ok: errors.length === 0,
    danglingSemanticEdges,
    missingFallbackAnalyzers,
    importEdgesWithoutExternalNodes,
    analyzerDiagnosticsWithBodies,
    errors,
  };
}