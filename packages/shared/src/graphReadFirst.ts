import type { UnifiedCodeGraph, UnifiedCodeGraphNode } from "./codeGraph.js";

const READ_FIRST_NODE_KINDS = new Set(["symbol", "code_file", "community", "config_file"]);

function nodeText(node: UnifiedCodeGraphNode) {
  return `${node.label} ${node.path ?? ""}`.toLowerCase();
}

function nodeLabelText(node: UnifiedCodeGraphNode) {
  return node.label.toLowerCase();
}

function scannerSymbolKind(node: UnifiedCodeGraphNode) {
  return typeof node.metadata?.scannerSymbolKind === "string"
    ? node.metadata.scannerSymbolKind.toLowerCase()
    : undefined;
}

function isClassLikeSymbol(node: UnifiedCodeGraphNode) {
  const kind = scannerSymbolKind(node);
  return kind
    ? ["class", "record", "struct", "interface", "actor", "enum", "trait"].includes(kind)
    : /\((class|record|struct|interface|actor|enum|trait)\)/i.test(node.label);
}

export function scoreReadFirstNode(node: UnifiedCodeGraphNode) {
  const text = nodeText(node);
  if (node.kind === "symbol") {
    const label = nodeLabelText(node);
    if (isClassLikeSymbol(node) && /mainviewmodel|main-view-model/.test(label)) return 0;
    if (isClassLikeSymbol(node) && /viewmodel|view-model/.test(label)) return 1;
    if (isClassLikeSymbol(node) && /controller|entrypoint|\bmain\b|program|startup|appdelegate/.test(label)) return 2;
    if (isClassLikeSymbol(node) && /service|adapter|manager|provider|repository/.test(label)) return 3;
    if (isClassLikeSymbol(node)) return 4;
    if (/viewmodel|controller|entrypoint|\bmain\b|service|adapter/.test(label)) return 5;
    return 8;
  }
  if (node.kind === "code_file") {
    if (/mainviewmodel|main-view-model/.test(text)) return 6;
    if (/viewmodel|view-model|controller|\bmain\b|program|startup|appdelegate/.test(text)) return 7;
    if (/service|adapter|manager|provider|repository/.test(text)) return 8;
    if (/\.(cs|ts|tsx|js|jsx|kt|java|rb|php|py|go|rs|swift|cpp|c|h|hpp|dart|gd|ps1|sh|bash)$/i.test(node.path ?? node.label)) {
      return 9;
    }
  }
  if (node.kind === "community") return 10;
  if (node.kind === "config_file") return 11;
  return 12;
}

export function getReadTheseFirstNodes(graph: UnifiedCodeGraph, limit = 8): UnifiedCodeGraphNode[] {
  return [...graph.nodes]
    .filter((node) => READ_FIRST_NODE_KINDS.has(node.kind))
    .filter((node) => !(node.path ?? node.label).includes("/bin/"))
    .filter((node) => !(node.path ?? node.label).includes("/obj/"))
    .sort((left, right) => scoreReadFirstNode(left) - scoreReadFirstNode(right) || left.label.localeCompare(right.label))
    .slice(0, limit);
}
