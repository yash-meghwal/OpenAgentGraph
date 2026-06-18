import type { UnifiedCodeGraph, UnifiedCodeGraphEdge, UnifiedCodeGraphNode } from "./codeGraph.js";

export interface DocsHubSummary {
  path: string;
  label: string;
  sectionCount: number;
  linkCount: number;
  codeLinkCount: number;
}

export interface DocsLinkedToCodeSummary {
  docLabel: string;
  docPath?: string;
  targetLabel: string;
  targetPath?: string;
  provenance: string;
}

export function isDocsOrientedQuery(query: string) {
  return /\b(how does|how do|architecture|guide|docs?|documentation|readme|overview|handoff|wiki)\b/i.test(query);
}

export function countIndexedSymbols(graph: UnifiedCodeGraph) {
  return graph.nodes.filter((node) => node.kind === "symbol").length;
}

export function scoreDocSectionForQuery(node: UnifiedCodeGraphNode, tokens: string[]) {
  if (node.kind !== "doc_section") return 0;
  const haystack = [
    node.label,
    node.path ?? "",
    node.metadata?.scannerDocSectionSlug,
    node.metadata?.scannerDocSectionParent,
    node.metadata?.scannerDocTags,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length * 3;
  }
  return score;
}

export function buildDocsHubSummaries(graph: UnifiedCodeGraph, limit = 8): DocsHubSummary[] {
  const docFiles = graph.nodes.filter((node) => node.kind === "doc_file");
  const sectionsByFile = new Map<string, number>();
  for (const section of graph.nodes.filter((node) => node.kind === "doc_section")) {
    const filePath = section.path ?? section.metadata?.scannerSourceFile;
    if (typeof filePath !== "string") continue;
    sectionsByFile.set(filePath, (sectionsByFile.get(filePath) ?? 0) + 1);
  }

  const linkCounts = new Map<string, number>();
  const codeLinkCounts = new Map<string, number>();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.sourceNodeId);
    if (!source || (source.kind !== "doc_file" && source.kind !== "doc_section")) continue;
    const filePath = source.kind === "doc_file"
      ? (source.path ?? source.label)
      : String(source.metadata?.scannerSourceFile ?? source.path ?? "");
    if (!filePath) continue;
    if (edge.kind === "references" || edge.metadata?.scannerRelation === "doc_link" || edge.metadata?.scannerRelation === "doc_wikilink") {
      linkCounts.set(filePath, (linkCounts.get(filePath) ?? 0) + 1);
    }
    if (edge.kind === "documents" || edge.metadata?.scannerRelation === "doc_code_ref") {
      codeLinkCounts.set(filePath, (codeLinkCounts.get(filePath) ?? 0) + 1);
    }
  }

  return docFiles
    .map((file) => ({
      path: file.path ?? file.label,
      label: file.label,
      sectionCount: sectionsByFile.get(file.path ?? file.label) ?? 0,
      linkCount: linkCounts.get(file.path ?? file.label) ?? 0,
      codeLinkCount: codeLinkCounts.get(file.path ?? file.label) ?? 0,
    }))
    .sort((left, right) =>
      (right.sectionCount + right.linkCount + right.codeLinkCount)
      - (left.sectionCount + left.linkCount + left.codeLinkCount)
      || left.path.localeCompare(right.path))
    .slice(0, limit);
}

export function buildDocsLinkedToCodeSummaries(graph: UnifiedCodeGraph, limit = 12): DocsLinkedToCodeSummary[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const summaries: DocsLinkedToCodeSummary[] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== "documents" && edge.metadata?.scannerRelation !== "doc_code_ref") continue;
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source || !target) continue;
    summaries.push({
      docLabel: source.label,
      docPath: source.path,
      targetLabel: target.label,
      targetPath: target.path,
      provenance: `${edge.provenance}/${edge.source ?? "docs"}`,
    });
  }
  return summaries
    .sort((left, right) => left.docLabel.localeCompare(right.docLabel) || left.targetLabel.localeCompare(right.targetLabel))
    .slice(0, limit);
}

export function buildUnlinkedDocsSummaries(graph: UnifiedCodeGraph, limit = 8): string[] {
  const linkedDocPaths = new Set<string>();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.sourceNodeId);
    if (!source || (source.kind !== "doc_file" && source.kind !== "doc_section")) continue;
    if (edge.kind === "references" || edge.kind === "documents") {
      const filePath = source.kind === "doc_file"
        ? (source.path ?? source.label)
        : String(source.metadata?.scannerSourceFile ?? source.path ?? "");
      if (filePath) linkedDocPaths.add(filePath);
    }
  }
  return graph.nodes
    .filter((node) => node.kind === "doc_file")
    .map((node) => node.path ?? node.label)
    .filter((filePath) => !linkedDocPaths.has(filePath))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
}

export function renderDocsGraphMarkdown(graph: UnifiedCodeGraph) {
  const hubs = buildDocsHubSummaries(graph);
  const linked = buildDocsLinkedToCodeSummaries(graph);
  const unlinked = buildUnlinkedDocsSummaries(graph);
  const lines = [
    "## Docs hubs",
    ...(hubs.length > 0
      ? hubs.map((hub) =>
        `- \`${hub.path}\` — ${hub.sectionCount} section(s), ${hub.linkCount} doc link(s), ${hub.codeLinkCount} code link(s).`)
      : ["- No documentation hubs indexed."]),
    "",
    "## Docs linked to code",
    ...(linked.length > 0
      ? linked.map((entry) =>
        `- \`${entry.docPath ?? entry.docLabel}\` → \`${entry.targetPath ?? entry.targetLabel}\` (${entry.provenance}).`)
      : ["- No doc-to-code links recorded."]),
    "",
    "## Unlinked docs",
    ...(unlinked.length > 0
      ? unlinked.map((filePath) => `- \`${filePath}\` — no outgoing doc/code links yet.`)
      : ["- All indexed docs have at least one outgoing link."]),
    "",
  ];
  return lines;
}

export function summarizeDocSectionNeighbors(
  node: UnifiedCodeGraphNode,
  neighbors: UnifiedCodeGraphNode[],
  edges: UnifiedCodeGraphEdge[]
) {
  if (node.kind !== "doc_section") return undefined;
  const nearbySections = neighbors
    .filter((neighbor) => neighbor.kind === "doc_section")
    .map((neighbor) => neighbor.label)
    .slice(0, 4);
  const linkedCode = neighbors
    .filter((neighbor) => neighbor.kind === "symbol" || neighbor.kind === "code_file")
    .map((neighbor) => neighbor.path ?? neighbor.label)
    .slice(0, 4);
  const linkKinds = [...new Set(edges.map((edge) => edge.metadata?.scannerRelation ?? edge.kind))].slice(0, 4);
  return [
    nearbySections.length > 0 ? `nearby sections: ${nearbySections.join(", ")}` : undefined,
    linkedCode.length > 0 ? `linked code: ${linkedCode.join(", ")}` : undefined,
    linkKinds.length > 0 ? `relations: ${linkKinds.join(", ")}` : undefined,
  ].filter(Boolean).join("; ");
}