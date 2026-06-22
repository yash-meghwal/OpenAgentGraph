import type { UnifiedCodeGraph, UnifiedCodeGraphEdge, UnifiedCodeGraphNode } from "./codeGraph.js";
import type { GraphTaskLensId } from "./graphLenses.js";
import { scoreReadFirstNode } from "./graphReadFirst.js";
import {
  buildGraphCommunitySummaries,
  GRAPH_COMMUNITY_MIN_MERGE_FILES,
  isGenericCommunityLabel,
  type GraphCommunitySummary,
} from "./graphCommunities.js";

export const GRAPH_COMMUNITY_HUB_PRESENTATION_MIN_FILES = GRAPH_COMMUNITY_MIN_MERGE_FILES;
export const GRAPH_COMMUNITY_HUB_HIGH_DEGREE_THRESHOLD = 12;
export const GRAPH_COMMUNITY_HUB_TOP_RELATIONSHIPS = 3;
export const GRAPH_COMMUNITY_HUB_DEFAULT_LIMIT = 12;

export interface GraphCommunityHubRelationship {
  direction: "incoming" | "outgoing";
  edgeKind: string;
  targetLabel: string;
  targetPath?: string;
  count: number;
}

export interface GraphCommunityHubProvenanceMix {
  extracted: number;
  inferred: number;
  ambiguous: number;
  manual: number;
  total: number;
}

export interface GraphCommunityHubSummary extends GraphCommunitySummary {
  hubSummary: string;
  topSymbols: string[];
  incomingRelationships: GraphCommunityHubRelationship[];
  outgoingRelationships: GraphCommunityHubRelationship[];
  provenanceMix: GraphCommunityHubProvenanceMix;
  docLinks: string[];
  readFirstNodes: string[];
  startWithNodes: string[];
  relatedTests: string[];
  supportingDocs: string[];
  interCommunityDegree: number;
  isThin: boolean;
  mergedFromLabels?: string[];
  presentationOnly?: boolean;
}

interface CommunityTopologyIndex {
  nodeById: Map<string, UnifiedCodeGraphNode>;
  communityIds: Set<string>;
  directCommunityByNodeId: Map<string, string>;
  parentFileByNodeId: Map<string, string>;
  filePathToId: Map<string, string>;
  membersByCommunityId: Map<string, Set<string>>;
  memberCommunityByNodeId: Map<string, string>;
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

function buildCommunityTopologyIndex(graph: UnifiedCodeGraph): CommunityTopologyIndex {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const communityIds = new Set(
    graph.nodes.filter((node) => node.kind === "community").map((node) => node.id)
  );
  const directCommunityByNodeId = new Map<string, string>();
  const parentFileByNodeId = new Map<string, string>();

  for (const edge of graph.edges) {
    if (edge.kind !== "belongs_to") continue;
    const target = nodeById.get(edge.targetNodeId);
    if (!target) continue;
    if (communityIds.has(edge.targetNodeId)) {
      directCommunityByNodeId.set(edge.sourceNodeId, edge.targetNodeId);
      continue;
    }
    if (target.kind === "code_file" || target.kind === "config_file" || target.kind === "doc_file") {
      parentFileByNodeId.set(edge.sourceNodeId, edge.targetNodeId);
    }
  }

  const filePathToId = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!["code_file", "config_file", "doc_file"].includes(node.kind)) continue;
    if (node.path) filePathToId.set(normalizePath(node.path), node.id);
  }

  const memberCommunityByNodeId = new Map<string, string>();
  const resolveCommunity = (nodeId: string): string | undefined => {
    const cached = memberCommunityByNodeId.get(nodeId);
    if (cached) return cached;

    const node = nodeById.get(nodeId);
    if (node?.kind === "community") {
      memberCommunityByNodeId.set(nodeId, nodeId);
      return nodeId;
    }

    let communityId = directCommunityByNodeId.get(nodeId);
    if (!communityId) {
      const parentFileId = parentFileByNodeId.get(nodeId);
      if (parentFileId) communityId = directCommunityByNodeId.get(parentFileId);
    }
    if (!communityId && node?.path && ["symbol", "test", "doc_section"].includes(node.kind)) {
      const fileId = filePathToId.get(normalizePath(node.path));
      if (fileId) communityId = directCommunityByNodeId.get(fileId);
    }
    if (communityId) memberCommunityByNodeId.set(nodeId, communityId);
    return communityId;
  };

  const membersByCommunityId = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    const communityId = resolveCommunity(node.id);
    if (!communityId) continue;
    const members = membersByCommunityId.get(communityId) ?? new Set<string>();
    members.add(node.id);
    membersByCommunityId.set(communityId, members);
  }

  return {
    nodeById,
    communityIds,
    directCommunityByNodeId,
    parentFileByNodeId,
    filePathToId,
    membersByCommunityId,
    memberCommunityByNodeId,
  };
}

function nodeDisplayLabel(node: UnifiedCodeGraphNode) {
  return node.path ?? node.label;
}

function readFirstPriority(node: UnifiedCodeGraphNode) {
  return scoreReadFirstNode(node);
}

function isTestNode(node: UnifiedCodeGraphNode) {
  return node.kind === "test"
    || /tests?[/\\]/i.test(node.path ?? "")
    || /tests?\./i.test(node.path ?? node.label);
}

function isDocEdge(edge: UnifiedCodeGraphEdge) {
  return edge.kind === "documents" || edge.metadata?.scannerRelation === "doc_code_ref";
}

function relationshipKey(direction: "incoming" | "outgoing", edgeKind: string, targetLabel: string) {
  return `${direction}|${edgeKind}|${targetLabel}`;
}

function summarizeRelationships(
  counts: Map<string, GraphCommunityHubRelationship>
): GraphCommunityHubRelationship[] {
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.targetLabel.localeCompare(right.targetLabel))
    .slice(0, GRAPH_COMMUNITY_HUB_TOP_RELATIONSHIPS);
}

function mergeRelationshipMaps(
  ...groups: GraphCommunityHubRelationship[][]
): Map<string, GraphCommunityHubRelationship> {
  const counts = new Map<string, GraphCommunityHubRelationship>();
  for (const group of groups) {
    for (const rel of group) {
      const key = relationshipKey(rel.direction, rel.edgeKind, rel.targetLabel);
      const existing = counts.get(key) ?? { ...rel, count: 0 };
      existing.count += rel.count;
      counts.set(key, existing);
    }
  }
  return counts;
}

function removeRelationshipsToLabel(
  counts: Map<string, GraphCommunityHubRelationship>,
  label: string
) {
  for (const [key, rel] of counts.entries()) {
    if (rel.targetLabel === label) counts.delete(key);
  }
}

function relationshipDegree(
  ...maps: Array<Map<string, GraphCommunityHubRelationship>>
) {
  return maps.reduce(
    (sum, map) => sum + [...map.values()].reduce((inner, rel) => inner + rel.count, 0),
    0
  );
}

function mergeProvenanceMix(
  left: GraphCommunityHubProvenanceMix,
  right: GraphCommunityHubProvenanceMix
): GraphCommunityHubProvenanceMix {
  return {
    extracted: left.extracted + right.extracted,
    inferred: left.inferred + right.inferred,
    ambiguous: left.ambiguous + right.ambiguous,
    manual: left.manual + right.manual,
    total: left.total + right.total,
  };
}

function buildHubSummary(input: {
  label: string;
  taskLens?: GraphTaskLensId;
  fileCount: number;
  topFiles: string[];
  topSymbols: string[];
  startWithNodes?: string[];
  incomingRelationships: GraphCommunityHubRelationship[];
  outgoingRelationships: GraphCommunityHubRelationship[];
  provenanceMix: GraphCommunityHubProvenanceMix;
  docLinks: string[];
}) {
  const startNodes = input.startWithNodes?.length ? input.startWithNodes : input.topFiles;
  const parts = [
    `${input.label} hub (${input.fileCount} ${input.fileCount === 1 ? "file" : "files"})`,
    input.taskLens ? `lens ${input.taskLens}` : undefined,
    startNodes.length > 0 ? `start ${startNodes.slice(0, 2).join(", ")}` : undefined,
    input.topSymbols.length > 0 ? `symbols ${input.topSymbols.slice(0, 3).join(", ")}` : undefined,
    input.incomingRelationships.length > 0
      ? `incoming ${input.incomingRelationships.slice(0, 2).map((rel) => `${rel.edgeKind}->${rel.targetLabel}`).join("; ")}`
      : undefined,
    input.outgoingRelationships.length > 0
      ? `outgoing ${input.outgoingRelationships.slice(0, 2).map((rel) => `${rel.edgeKind}->${rel.targetLabel}`).join("; ")}`
      : undefined,
    input.provenanceMix.total > 0
      ? `provenance ${Math.round((input.provenanceMix.extracted / input.provenanceMix.total) * 100)}% extracted`
      : undefined,
    input.docLinks.length > 0 ? `docs ${input.docLinks.slice(0, 2).join(", ")}` : undefined,
  ].filter(Boolean);
  return parts.join(" · ");
}

function enrichCommunityHub(
  graph: UnifiedCodeGraph,
  summary: GraphCommunitySummary,
  index: CommunityTopologyIndex
): GraphCommunityHubSummary {
  const members = index.membersByCommunityId.get(summary.id) ?? new Set<string>();
  const memberIds = new Set(members);

  const memberNodes = [...members]
    .map((id) => index.nodeById.get(id))
    .filter((node): node is UnifiedCodeGraphNode => Boolean(node))
    .filter((node) => !(node.path ?? node.label).includes("/bin/"))
    .filter((node) => !(node.path ?? node.label).includes("/obj/"));

  const topSymbols = memberNodes
    .filter((node) => node.kind === "symbol" || node.kind === "test")
    .filter((node) => !isTestNode(node) || node.kind === "symbol")
    .sort((left, right) => readFirstPriority(left) - readFirstPriority(right) || left.label.localeCompare(right.label))
    .map((node) => node.label)
    .filter((value, position, array) => array.indexOf(value) === position)
    .slice(0, 5);

  const startWithNodes = memberNodes
    .filter((node) => ["symbol", "code_file"].includes(node.kind))
    .filter((node) => !isTestNode(node))
    .sort((left, right) => readFirstPriority(left) - readFirstPriority(right) || left.label.localeCompare(right.label))
    .map(nodeDisplayLabel)
    .filter((value, position, array) => array.indexOf(value) === position)
    .slice(0, 3);

  const relatedTests = memberNodes
    .filter((node) => isTestNode(node))
    .sort((left, right) => left.label.localeCompare(right.label))
    .map(nodeDisplayLabel)
    .filter((value, position, array) => array.indexOf(value) === position)
    .slice(0, 3);

  const supportingDocs = memberNodes
    .filter((node) => node.kind === "doc_file" || node.kind === "doc_section")
    .sort((left, right) => left.label.localeCompare(right.label))
    .map(nodeDisplayLabel)
    .filter((value, position, array) => array.indexOf(value) === position)
    .slice(0, 3);

  const readFirstNodes = startWithNodes.length > 0
    ? startWithNodes
    : memberNodes
      .filter((node) => ["symbol", "code_file", "doc_file", "doc_section", "config_file"].includes(node.kind))
      .sort((left, right) => readFirstPriority(left) - readFirstPriority(right) || left.label.localeCompare(right.label))
      .map(nodeDisplayLabel)
      .filter((value, position, array) => array.indexOf(value) === position)
      .slice(0, 5);

  const provenanceMix: GraphCommunityHubProvenanceMix = {
    extracted: 0,
    inferred: 0,
    ambiguous: 0,
    manual: 0,
    total: 0,
  };
  const incomingCounts = new Map<string, GraphCommunityHubRelationship>();
  const outgoingCounts = new Map<string, GraphCommunityHubRelationship>();
  const docLinks = new Set<string>();

  for (const edge of graph.edges) {
    const sourceIn = memberIds.has(edge.sourceNodeId);
    const targetIn = memberIds.has(edge.targetNodeId);
    if (!sourceIn && !targetIn) continue;

    if (edge.kind !== "belongs_to") {
      provenanceMix.total += 1;
      if (edge.provenance === "extracted") provenanceMix.extracted += 1;
      else if (edge.provenance === "inferred") provenanceMix.inferred += 1;
      else if (edge.provenance === "ambiguous") provenanceMix.ambiguous += 1;
      else if (edge.provenance === "manual") provenanceMix.manual += 1;
    }

    if (isDocEdge(edge)) {
      const docNodeId = sourceIn && !targetIn
        ? edge.targetNodeId
        : targetIn && !sourceIn
          ? edge.sourceNodeId
          : undefined;
      const docNode = docNodeId ? index.nodeById.get(docNodeId) : undefined;
      if (docNode && (docNode.kind === "doc_file" || docNode.kind === "doc_section")) {
        docLinks.add(nodeDisplayLabel(docNode));
      }
    }

    if (edge.kind === "belongs_to") continue;

    const recordRelationship = (
      direction: "incoming" | "outgoing",
      counterpartId: string,
      edgeKind: string
    ) => {
      const counterpartCommunity = index.memberCommunityByNodeId.get(counterpartId)
        ?? (index.communityIds.has(counterpartId) ? counterpartId : undefined);
      if (!counterpartCommunity || counterpartCommunity === summary.id) return;
      const counterpart = index.nodeById.get(counterpartCommunity);
      if (!counterpart) return;
      const targetLabel = counterpart.kind === "community"
        ? (counterpart.metadata?.scannerCommunityLabel as string | undefined) ?? counterpart.label
        : counterpart.label;
      const key = relationshipKey(direction, edgeKind, targetLabel);
      const bucket = direction === "incoming" ? incomingCounts : outgoingCounts;
      const existing = bucket.get(key) ?? {
        direction,
        edgeKind,
        targetLabel,
        targetPath: counterpart.path,
        count: 0,
      };
      existing.count += 1;
      bucket.set(key, existing);
    };

    if (sourceIn && !targetIn) recordRelationship("outgoing", edge.targetNodeId, edge.kind);
    if (targetIn && !sourceIn) recordRelationship("incoming", edge.sourceNodeId, edge.kind);
    if (sourceIn && targetIn) {
      recordRelationship("outgoing", edge.targetNodeId, edge.kind);
      recordRelationship("incoming", edge.sourceNodeId, edge.kind);
    }
  }

  const incomingRelationships = summarizeRelationships(incomingCounts);
  const outgoingRelationships = summarizeRelationships(outgoingCounts);
  const interCommunityDegree = incomingRelationships.reduce((sum, rel) => sum + rel.count, 0)
    + outgoingRelationships.reduce((sum, rel) => sum + rel.count, 0);

  const hubSummary = buildHubSummary({
    label: summary.label,
    taskLens: summary.taskLens,
    fileCount: summary.fileCount,
    topFiles: summary.topFiles,
    topSymbols,
    startWithNodes,
    incomingRelationships,
    outgoingRelationships,
    provenanceMix,
    docLinks: [...docLinks],
  });

  return {
    ...summary,
    hubSummary,
    topSymbols,
    incomingRelationships,
    outgoingRelationships,
    provenanceMix,
    docLinks: [...docLinks].sort((left, right) => left.localeCompare(right)).slice(0, 5),
    readFirstNodes,
    startWithNodes,
    relatedTests,
    supportingDocs,
    interCommunityDegree,
    isThin: summary.fileCount < GRAPH_COMMUNITY_HUB_PRESENTATION_MIN_FILES
      && summary.kind !== "generated"
      && summary.kind !== "project"
      && summary.kind !== "package"
      && summary.kind !== "namespace"
      && summary.kind !== "tests"
      && summary.kind !== "docs"
      && (isGenericCommunityLabel(summary.label) || summary.kind === "directory" || summary.kind === "root"),
    presentationOnly: true,
  };
}

function parentCommunityPath(path?: string) {
  if (!path) return undefined;
  const segments = normalizePath(path).split("/").filter(Boolean);
  if (segments.length <= 1) return ".";
  return segments.slice(0, -1).join("/");
}

function findPresentationMergeTarget(
  hub: GraphCommunityHubSummary,
  hubsById: Map<string, GraphCommunityHubSummary>
) {
  const parentPath = parentCommunityPath(hub.path);
  if (parentPath) {
    const parentHub = [...hubsById.values()].find((candidate) =>
      candidate.id !== hub.id
      && !candidate.isThin
      && (candidate.path === parentPath || candidate.label === parentPath.split("/").at(-1))
    );
    if (parentHub) return parentHub.id;
  }

  let bestTargetId: string | undefined;
  let bestWeight = 0;
  for (const rel of [...hub.incomingRelationships, ...hub.outgoingRelationships]) {
    const counterpart = [...hubsById.values()].find((candidate) =>
      candidate.id !== hub.id
      && !candidate.isThin
      && candidate.label === rel.targetLabel
    );
    if (!counterpart) continue;
    if (rel.count > bestWeight) {
      bestWeight = rel.count;
      bestTargetId = counterpart.id;
    }
  }
  return bestTargetId;
}

function mergeHubInto(target: GraphCommunityHubSummary, source: GraphCommunityHubSummary) {
  target.mergedFromLabels = [...(target.mergedFromLabels ?? []), source.label];
  target.fileCount += source.fileCount;
  target.topFiles = [...new Set([...target.topFiles, ...source.topFiles])].slice(0, 6);
  target.topSymbols = [...new Set([...target.topSymbols, ...source.topSymbols])].slice(0, 6);
  target.docLinks = [...new Set([...target.docLinks, ...source.docLinks])].slice(0, 6);
  target.readFirstNodes = [...new Set([...target.readFirstNodes, ...source.readFirstNodes])].slice(0, 6);
  target.startWithNodes = [...new Set([...(target.startWithNodes ?? []), ...(source.startWithNodes ?? [])])].slice(0, 6);
  target.relatedTests = [...new Set([...(target.relatedTests ?? []), ...(source.relatedTests ?? [])])].slice(0, 4);
  target.supportingDocs = [...new Set([...(target.supportingDocs ?? []), ...(source.supportingDocs ?? [])])].slice(0, 4);
  target.provenanceMix = mergeProvenanceMix(target.provenanceMix, source.provenanceMix);

  const incomingMap = mergeRelationshipMaps(target.incomingRelationships, source.incomingRelationships);
  const outgoingMap = mergeRelationshipMaps(target.outgoingRelationships, source.outgoingRelationships);
  removeRelationshipsToLabel(incomingMap, source.label);
  removeRelationshipsToLabel(outgoingMap, source.label);
  target.incomingRelationships = summarizeRelationships(incomingMap);
  target.outgoingRelationships = summarizeRelationships(outgoingMap);
  target.interCommunityDegree = relationshipDegree(incomingMap, outgoingMap);

  target.hubSummary = buildHubSummary({
    label: target.label,
    taskLens: target.taskLens,
    fileCount: target.fileCount,
    topFiles: target.topFiles,
    topSymbols: target.topSymbols,
    incomingRelationships: target.incomingRelationships,
    outgoingRelationships: target.outgoingRelationships,
    provenanceMix: target.provenanceMix,
    docLinks: target.docLinks,
  });
  if (target.mergedFromLabels.length > 0) {
    target.hubSummary += ` · merged ${target.mergedFromLabels.join(", ")}`;
  }
}

export function buildGraphCommunityHubSummaries(
  graph: UnifiedCodeGraph,
  options: { limit?: number; mergeThinForPresentation?: boolean } = {}
): GraphCommunityHubSummary[] {
  const limit = options.limit ?? GRAPH_COMMUNITY_HUB_DEFAULT_LIMIT;
  const mergeThin = options.mergeThinForPresentation ?? true;
  const index = buildCommunityTopologyIndex(graph);
  const baseSummaries = buildGraphCommunitySummaries(graph, limit * 2);
  const hubs = baseSummaries.map((summary) => enrichCommunityHub(graph, summary, index));

  if (!mergeThin) return hubs.slice(0, limit);

  const hubsById = new Map(hubs.map((hub) => [hub.id, hub]));
  const hiddenIds = new Set<string>();
  for (const hub of hubs) {
    if (!hub.isThin) continue;
    const mergeTargetId = findPresentationMergeTarget(hub, hubsById);
    if (!mergeTargetId) continue;
    const target = hubsById.get(mergeTargetId);
    if (!target) continue;
    mergeHubInto(target, hub);
    hiddenIds.add(hub.id);
  }

  return hubs
    .filter((hub) => !hiddenIds.has(hub.id))
    .sort((left, right) => right.fileCount - left.fileCount || left.label.localeCompare(right.label))
    .slice(0, limit);
}

export function formatRichCommunityHubMarkdown(hubs: GraphCommunityHubSummary[]) {
  if (hubs.length === 0) return ["- No community hubs detected."];
  return hubs.map((hub) => {
    const pathSuffix = hub.path ? ` (\`${hub.path}\`)` : "";
    const lensSuffix = hub.taskLens ? ` · lens \`${hub.taskLens}\`` : "";
    const filesSuffix = hub.topFiles.length > 0
      ? ` · files: ${hub.topFiles.slice(0, 3).map((file) => `\`${file}\``).join(", ")}`
      : "";
    const symbolsSuffix = hub.topSymbols.length > 0
      ? ` · symbols: ${hub.topSymbols.slice(0, 3).map((symbol) => `\`${symbol}\``).join(", ")}`
      : "";
    const incomingSuffix = hub.incomingRelationships.length > 0
      ? ` · incoming: ${hub.incomingRelationships.map((rel) => `${rel.edgeKind}←${rel.targetLabel} (${rel.count})`).join(", ")}`
      : "";
    const outgoingSuffix = hub.outgoingRelationships.length > 0
      ? ` · outgoing: ${hub.outgoingRelationships.map((rel) => `${rel.edgeKind}→${rel.targetLabel} (${rel.count})`).join(", ")}`
      : "";
    const provenanceSuffix = hub.provenanceMix.total > 0
      ? ` · provenance: ${hub.provenanceMix.extracted} extracted / ${hub.provenanceMix.inferred} inferred`
      : "";
    const docsSuffix = hub.docLinks.length > 0
      ? ` · docs: ${hub.docLinks.slice(0, 2).map((doc) => `\`${doc}\``).join(", ")}`
      : "";
    const mergedSuffix = hub.mergedFromLabels?.length
      ? ` · merged thin: ${hub.mergedFromLabels.map((label) => `\`${label}\``).join(", ")}`
      : "";
    return `- **${hub.label}**${pathSuffix}${lensSuffix}: ${hub.hubSummary}${filesSuffix}${symbolsSuffix}${incomingSuffix}${outgoingSuffix}${provenanceSuffix}${docsSuffix}${mergedSuffix}`;
  });
}

export function formatReadFirstByCommunityMarkdown(hubs: GraphCommunityHubSummary[]) {
  const meaningful = hubs.filter((hub) => !isGenericCommunityLabel(hub.label) && hub.kind !== "generated");
  if (meaningful.length === 0) {
    return ["## Read first by community", "", "- No community-specific read-first guidance available.", ""];
  }

  const lines: string[] = ["## Read first by community", ""];
  for (const hub of meaningful.slice(0, 8)) {
    lines.push(`### ${hub.label}`);
    if (hub.startWithNodes?.length) {
      lines.push("**Start with**");
      lines.push(...hub.startWithNodes.map((node) => `- \`${node}\``));
    } else if (hub.readFirstNodes.length > 0) {
      lines.push("**Start with**");
      lines.push(...hub.readFirstNodes.map((node) => `- \`${node}\``));
    } else {
      lines.push("- No prioritized nodes for this community.");
    }
    if (hub.relatedTests?.length) {
      lines.push("**Related tests**");
      lines.push(...hub.relatedTests.map((node) => `- \`${node}\``));
    }
    if (hub.supportingDocs?.length) {
      lines.push("**Supporting docs**");
      lines.push(...hub.supportingDocs.map((node) => `- \`${node}\``));
    }
    lines.push("");
  }
  return lines;
}

export function formatHighDegreeHubWarnings(
  hubs: GraphCommunityHubSummary[],
  threshold = GRAPH_COMMUNITY_HUB_HIGH_DEGREE_THRESHOLD
) {
  const warnings = hubs
    .filter((hub) => hub.interCommunityDegree >= threshold)
    .sort((left, right) => right.interCommunityDegree - left.interCommunityDegree)
    .map((hub) =>
      `- **${hub.label}** has ${hub.interCommunityDegree} cross-community relationship(s); prefer lens filters or narrower hubs before exploring.`
    );

  if (warnings.length === 0) {
    return ["## High-degree hub warnings", "", "- No high-degree community hubs detected.", ""];
  }
  return ["## High-degree hub warnings", "", ...warnings, ""];
}

export function evaluateCommunityHubReleaseGates(graph: UnifiedCodeGraph) {
  const hubs = buildGraphCommunityHubSummaries(graph, { mergeThinForPresentation: true });
  const topHubs = hubs.slice(0, 3);
  const errors: string[] = [];

  for (const hub of topHubs) {
    if (!hub.hubSummary || hub.hubSummary.trim().length < 12) {
      errors.push(`Top community hub "${hub.label}" is missing a rich hub summary.`);
    }
    if (hub.topFiles.length === 0 && hub.fileCount > 0) {
      errors.push(`Top community hub "${hub.label}" is missing entry files.`);
    }
  }

  const handoffReady = topHubs.filter((hub) =>
    hub.hubSummary.includes("·")
    && (hub.topFiles.length > 0 || hub.topSymbols.length > 0)
  );
  if (hubs.length >= 2 && handoffReady.length < Math.min(2, topHubs.length)) {
    errors.push("Handoff report lacks rich hub summaries for top communities.");
  }

  return {
    ok: errors.length === 0,
    hubCount: hubs.length,
    topHubLabels: topHubs.map((hub) => hub.label),
    errors,
  };
}