import type { UnifiedCodeGraph } from "./codeGraph.js";
import { buildGraphExportDocument, findForbiddenExportContent } from "./graphExportBundle.js";

const SCRIPT_RELATIONS = new Set([
  "calls",
  "dot_sources",
  "imports_module",
  "exports_function",
  "runs_command",
]);

const SCRIPT_LANGUAGES = new Set(["powershell", "shell"]);

function nodeIds(graph: UnifiedCodeGraph) {
  return new Set(graph.nodes.map((node) => node.id));
}

function isScriptFileNode(node: UnifiedCodeGraph["nodes"][number]) {
  const path = node.path ?? node.label ?? "";
  return /\.(?:ps1|sh|bash)$/i.test(path);
}

function isScriptSymbolNode(node: UnifiedCodeGraph["nodes"][number]) {
  const language = typeof node.metadata?.scannerLanguage === "string"
    ? node.metadata.scannerLanguage
    : node.scannerId;
  const symbolKind = node.metadata?.scannerSymbolKind;
  const labelMatch = /\(function\)|\(script_entrypoint\)/.test(node.label);
  return typeof language === "string"
    && SCRIPT_LANGUAGES.has(language)
    && node.kind === "symbol"
    && (symbolKind === "function" || symbolKind === "script_entrypoint" || labelMatch);
}

export function evaluateScriptReleaseGates(graph: UnifiedCodeGraph) {
  const errors: string[] = [];
  const ids = nodeIds(graph);
  const scriptFileNodes = graph.nodes.filter((node) =>
    (node.kind === "code_file" || node.kind === "config_file") && isScriptFileNode(node)
  );
  const scriptSymbols = graph.nodes.filter((node) => node.kind === "symbol" && isScriptSymbolNode(node));

  if (scriptFileNodes.length === 0) {
    return { ok: true, scriptFileCount: 0, scriptSymbolCount: 0, errors };
  }

  if (scriptSymbols.length === 0) {
    errors.push("Script files are indexed but no script function/entrypoint symbols were emitted.");
  }

  const scriptEdges = graph.edges.filter((edge) => {
    const relation = edge.metadata?.scannerRelation;
    return typeof relation === "string" && SCRIPT_RELATIONS.has(relation);
  });

  for (const edge of scriptEdges) {
    if (!ids.has(edge.sourceNodeId) || !ids.has(edge.targetNodeId)) {
      errors.push(`Script edge '${edge.metadata?.scannerRelation}' is missing an endpoint.`);
    }
  }

  const serializedNodes = JSON.stringify(graph.nodes.map((node) => node.metadata ?? {}));
  if (/(?:API_KEY|SECRET|PASSWORD|TOKEN)\s*[:=]\s*[^\s,;}{"]+/i.test(serializedNodes)) {
    errors.push("Script graph metadata appears to include secret env assignment values.");
  }
  if (/\b(?:sk|pk|rk)_[A-Za-z0-9]{10,}\b/.test(serializedNodes)) {
    errors.push("Script graph metadata appears to include API key values.");
  }

  const exported = buildGraphExportDocument(graph);
  const exportText = JSON.stringify(exported);
  for (const violation of findForbiddenExportContent(exportText)) {
    if (violation.includes("secret") || violation.includes("token")) {
      errors.push(`Script export contains ${violation}.`);
    }
  }

  return {
    ok: errors.length === 0,
    scriptFileCount: scriptFileNodes.length,
    scriptSymbolCount: scriptSymbols.length,
    scriptEdgeCount: scriptEdges.length,
    errors,
  };
}