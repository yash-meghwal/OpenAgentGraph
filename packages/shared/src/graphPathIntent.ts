import type { UnifiedCodeGraphNode } from "./codeGraph.js";
import { isDocsOrientedQuery } from "./graphDocs.js";

export type GraphPathIntent = "code_to_code" | "doc_to_code" | "doc_to_doc" | "mixed_or_unknown";

const CODE_NODE_KINDS = new Set<UnifiedCodeGraphNode["kind"]>([
  "symbol",
  "code_file",
  "test",
  "route",
  "command",
]);

const DOC_NODE_KINDS = new Set<UnifiedCodeGraphNode["kind"]>(["doc_file", "doc_section"]);

export function isCodePathNodeKind(kind: UnifiedCodeGraphNode["kind"]) {
  return CODE_NODE_KINDS.has(kind);
}

export function isDocPathNodeKind(kind: UnifiedCodeGraphNode["kind"]) {
  return DOC_NODE_KINDS.has(kind);
}

export function classifyGraphPathIntent(input: {
  fromNode?: UnifiedCodeGraphNode;
  toNode?: UnifiedCodeGraphNode;
  fromQuery?: string;
  toQuery?: string;
}): GraphPathIntent {
  const fromKind = input.fromNode?.kind;
  const toKind = input.toNode?.kind;
  const queryText = `${input.fromQuery ?? ""} ${input.toQuery ?? ""}`;
  const docsQuery = isDocsOrientedQuery(queryText);

  if (fromKind && toKind) {
    const fromDoc = isDocPathNodeKind(fromKind);
    const toDoc = isDocPathNodeKind(toKind);
    const fromCode = isCodePathNodeKind(fromKind);
    const toCode = isCodePathNodeKind(toKind);
    if (fromDoc && toDoc) return "doc_to_doc";
    if (fromDoc && toCode) return "doc_to_code";
    if (fromCode && toDoc) return "doc_to_code";
    if (fromCode && toCode) return "code_to_code";
  }

  if (docsQuery) return "mixed_or_unknown";
  if (fromKind && isCodePathNodeKind(fromKind) && toKind && isCodePathNodeKind(toKind)) {
    return "code_to_code";
  }
  if (fromKind && isDocPathNodeKind(fromKind) && toKind && isDocPathNodeKind(toKind)) {
    return "doc_to_doc";
  }
  return "mixed_or_unknown";
}

export function shouldPenalizeDocPathDetour(intent: GraphPathIntent, mode: string | undefined) {
  return intent === "code_to_code" && mode !== "structural";
}

export function isDocPathEdgeRelation(relation: string | undefined, edgeKind: string) {
  return edgeKind === "documents"
    || relation === "doc_link"
    || relation === "doc_wikilink"
    || relation === "doc_code_ref";
}