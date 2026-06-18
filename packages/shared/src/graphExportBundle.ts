import type {
  EcosystemSupportMatrixRow,
  GraphExportMetadata,
  GraphProvenanceSummary,
  UnifiedCodeGraph,
  UnifiedCodeGraphEdge,
  UnifiedCodeGraphNode,
  WorkspaceKernelProfile,
} from "./codeGraph.js";
import { CODE_GRAPH_SCHEMA_VERSION } from "./codeGraph.js";
import { formatGraphAnalyzerDiagnostics } from "./graphAnalyzers.js";
import { findGraphCommunityForNode } from "./graphCommunities.js";
import {
  buildGraphCommunityHubSummaries,
  type GraphCommunityHubSummary,
} from "./graphCommunityHubs.js";
import { buildEcosystemSupportMatrix } from "./graphEcosystemHealth.js";
import {
  buildGraphHealthSummary,
  filterUnifiedGraphByLens,
  GRAPH_TASK_LENS_DEFINITIONS,
  graphLensIdsForNode,
  recommendPrimaryGraphLens,
  type GraphTaskLensDefinition,
  type GraphTaskLensId,
} from "./graphLenses.js";
import { buildGraphPathSeedResolverBrowserScript } from "./graphPathSeedResolution.js";
import { computeGraphPathEdgeCost } from "./graphQueryEngine.js";
import { GRAPH_PATH_FILE_QUERY_EXTENSION_LIST } from "./sourceExtensions.js";

const FORBIDDEN_EXPORT_METADATA_KEYS = new Set([
  "body",
  "sourceBody",
  "fileBody",
  "content",
  "sourceContent",
  "rawContent",
  "text",
  "sourceText",
]);

export interface GraphExplorerEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: string;
  provenance: string;
  source?: string;
  confidence?: number;
  label?: string;
  pathCosts?: {
    balanced: number;
    semantic: number;
    structural: number;
  };
}

export interface GraphExplorerNode {
  id: string;
  kind: string;
  label: string;
  path?: string;
  lensIds: GraphTaskLensId[];
  communityId?: string;
  communityLabel?: string;
  scannerId?: string;
}

export interface GraphExplorerPayload {
  workspaceRoot: string;
  generatedAt: string;
  schemaVersion: string;
  primaryLens: GraphTaskLensId;
  activeScannerIds: string[];
  lenses: GraphTaskLensDefinition[];
  communities: GraphCommunityHubSummary[];
  nodes: GraphExplorerNode[];
  edges: GraphExplorerEdge[];
  risks: string[];
  ecosystemSupportMatrix: EcosystemSupportMatrixRow[];
  refreshCommands: string[];
  diagnostics: string[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function serializeJsonForScriptTag(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function sanitizeRecordMetadata<T extends Record<string, string | number | boolean | null>>(
  metadata: T | undefined
): T | undefined {
  if (!metadata) return undefined;
  const sanitized = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !FORBIDDEN_EXPORT_METADATA_KEYS.has(key))
  ) as T;
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeNodeMetadata(
  metadata: UnifiedCodeGraphNode["metadata"]
): UnifiedCodeGraphNode["metadata"] | undefined {
  return sanitizeRecordMetadata(metadata);
}

function sanitizeEdgeMetadata(
  metadata: UnifiedCodeGraphEdge["metadata"]
): UnifiedCodeGraphEdge["metadata"] | undefined {
  return sanitizeRecordMetadata(metadata);
}

export function sanitizeGraphForExport(graph: UnifiedCodeGraph): UnifiedCodeGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      metadata: sanitizeNodeMetadata(node.metadata),
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      metadata: sanitizeEdgeMetadata(edge.metadata),
    })),
  };
}

export function buildGraphProvenanceSummary(graph: UnifiedCodeGraph): GraphProvenanceSummary {
  const extractedEdgeCount = graph.edges.filter((edge) => edge.provenance === "extracted").length;
  const inferredEdgeCount = graph.edges.filter((edge) => edge.provenance === "inferred").length;
  const ambiguousEdgeCount = graph.edges.filter((edge) => edge.provenance === "ambiguous").length;
  const manualEdgeCount = graph.edges.filter((edge) => edge.provenance === "manual").length;
  const extractedPercent = graph.edges.length > 0
    ? Math.round((extractedEdgeCount / graph.edges.length) * 100)
    : 0;
  return {
    extractedEdgeCount,
    inferredEdgeCount,
    ambiguousEdgeCount,
    manualEdgeCount,
    extractedPercent,
  };
}

export function buildGraphRefreshCommands(workspaceRoot: string, primaryLens: GraphTaskLensId) {
  const quotedWorkspace = `"${workspaceRoot}"`;
  return [
    `npm run graph:export -- --workspace ${quotedWorkspace} --offline-only`,
    `npm run graph:update -- --workspace ${quotedWorkspace}`,
    `npm run graph:query -- --workspace ${quotedWorkspace} --lens ${primaryLens} "<question>"`,
    `npm run graph:check -- --workspace ${quotedWorkspace}`,
  ];
}

const SECRET_VALUE_PATTERN = /\b(?:sk|pk|rk)_[A-Za-z0-9]{10,}\b/;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i;

function hasForbiddenMetadataKey(serialized: string, key: string) {
  return new RegExp(`"${key}"\\s*:`).test(serialized);
}

export function findForbiddenExportContent(serialized: string): string[] {
  const violations: string[] = [];
  for (const key of FORBIDDEN_EXPORT_METADATA_KEYS) {
    if (hasForbiddenMetadataKey(serialized, key)) {
      violations.push(`forbidden metadata key '${key}'`);
    }
  }
  if (SECRET_VALUE_PATTERN.test(serialized)) {
    violations.push("secret-looking API key value");
  }
  if (BEARER_TOKEN_PATTERN.test(serialized)) {
    violations.push("bearer token value");
  }
  return violations;
}

export function extractExplorerPayloadFromHtml(html: string) {
  const match = html.match(/<script type="application\/json" id="oag-explorer-data">([\s\S]*?)<\/script>/);
  if (!match?.[1]) {
    throw new Error("Explorer payload script tag not found.");
  }
  return JSON.parse(match[1]) as GraphExplorerPayload;
}

export interface StaticExportReleaseGateResult {
  ok: boolean;
  errors: string[];
}

export function evaluateStaticExportReleaseGates(input: {
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  handoffMarkdown?: string;
}): StaticExportReleaseGateResult {
  const errors: string[] = [];
  const exported = buildGraphExportDocument(input.graph, input.kernelProfile);

  if (!exported.export) {
    errors.push("Static export envelope is missing.");
  } else {
    const envelope = exported.export;
    if (!exported.generatedAt) errors.push("Static export is missing graph.generatedAt.");
    if (!envelope.exportedAt) errors.push("Static export is missing export.exportedAt.");
    if (!envelope.graphVersion) errors.push("Static export is missing export.graphVersion.");
    if (!envelope.primaryLens) errors.push("Static export is missing export.primaryLens.");
    if (!Array.isArray(envelope.communities)) errors.push("Static export is missing export.communities.");
    if (!envelope.provenance) errors.push("Static export is missing export.provenance.");
    if (!Array.isArray(envelope.ecosystemSupportMatrix)) {
      errors.push("Static export is missing export.ecosystemSupportMatrix.");
    }
    if (!Array.isArray(envelope.refreshCommands) || envelope.refreshCommands.length === 0) {
      errors.push("Static export is missing export.refreshCommands.");
    }
  }

  if (!Array.isArray(exported.nodes)) {
    errors.push("Static export is missing nodes.");
  }
  if (!Array.isArray(exported.edges)) {
    errors.push("Static export is missing edges.");
  }

  const jsonText = JSON.stringify(exported);
  for (const violation of findForbiddenExportContent(jsonText)) {
    errors.push(`graph.json contains ${violation}.`);
  }

  let html = "";
  try {
    html = renderGraphExplorerHtml(exported, { kernelProfile: input.kernelProfile });
    const payload = extractExplorerPayloadFromHtml(html);
    if (!payload.workspaceRoot) errors.push("graph.html explorer payload is missing workspaceRoot.");
    if (!Array.isArray(payload.nodes)) errors.push("graph.html explorer payload is missing nodes.");
    if (!Array.isArray(payload.edges)) errors.push("graph.html explorer payload is missing edges.");
    if (!Array.isArray(payload.ecosystemSupportMatrix)) {
      errors.push("graph.html explorer payload is missing ecosystemSupportMatrix.");
    }
  } catch (error) {
    errors.push(`graph.html payload parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const violation of findForbiddenExportContent(html)) {
    errors.push(`graph.html contains ${violation}.`);
  }

  if (input.handoffMarkdown) {
    if (!input.handoffMarkdown.includes("## Static OAG artifacts")) {
      errors.push("Handoff report is missing Static OAG artifacts section.");
    }
    if (!input.handoffMarkdown.includes("## How an agent should use these files")) {
      errors.push("Handoff report is missing agent usage guidance.");
    }
    if (!/no provider key required/i.test(input.handoffMarkdown)) {
      errors.push("Handoff report does not state that no provider key is required.");
    }
    if (!input.handoffMarkdown.includes("## Ecosystem support matrix")) {
      errors.push("Handoff report is missing ecosystem support matrix.");
    }
    if (!input.handoffMarkdown.includes("## Edge provenance")) {
      errors.push("Handoff report is missing edge provenance summary.");
    }
    if (!input.handoffMarkdown.includes("## Community hubs")) {
      errors.push("Handoff report is missing community hubs section.");
    }
    if (!input.handoffMarkdown.includes("## Read first by community")) {
      errors.push("Handoff report is missing read-first-by-community guidance.");
    }
    for (const violation of findForbiddenExportContent(input.handoffMarkdown)) {
      errors.push(`GRAPH_REPORT.md contains ${violation}.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function buildGraphExportRisks(
  graph: UnifiedCodeGraph,
  kernelProfile?: WorkspaceKernelProfile
): string[] {
  const risks = [
    ...graph.diagnostics,
    ...(kernelProfile?.warnings ?? []),
  ];
  const health = buildGraphHealthSummary(graph, kernelProfile);
  for (const badge of health.badges) {
    if (badge.tone === "warn" || badge.tone === "bad") {
      risks.push(`${badge.label}: ${badge.detail}`);
    }
  }
  if (graph.analyzers?.length) {
    for (const line of formatGraphAnalyzerDiagnostics(graph.analyzers)) {
      if (/unavailable|disabled|fallback/i.test(line)) risks.push(line);
    }
  }
  return [...new Set(risks.map((risk) => risk.trim()).filter(Boolean))];
}

export function buildGraphExportDocument(
  graph: UnifiedCodeGraph,
  kernelProfile?: WorkspaceKernelProfile,
  options: { exportedAt?: string } = {}
): UnifiedCodeGraph {
  const sanitized = sanitizeGraphForExport(graph);
  const primaryLens = recommendPrimaryGraphLens(sanitized, kernelProfile);
  const exportMetadata: GraphExportMetadata = {
    graphVersion: CODE_GRAPH_SCHEMA_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    scannerProfile: kernelProfile,
    ecosystemSupportMatrix: buildEcosystemSupportMatrix({ graph: sanitized, kernelProfile }),
    communities: buildGraphCommunityHubSummaries(sanitized),
    provenance: buildGraphProvenanceSummary(sanitized),
    analyzers: sanitized.analyzers,
    primaryLens,
    refreshCommands: buildGraphRefreshCommands(sanitized.workspaceRoot, primaryLens),
    risks: buildGraphExportRisks(sanitized, kernelProfile),
  };
  return {
    ...sanitized,
    export: exportMetadata,
  };
}

function toExplorerEdge(edge: UnifiedCodeGraphEdge): GraphExplorerEdge {
  const balanced = computeGraphPathEdgeCost(edge, { mode: "balanced" });
  const semantic = computeGraphPathEdgeCost(edge, { mode: "semantic" });
  const structural = computeGraphPathEdgeCost(edge, { mode: "structural" });
  return {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    kind: edge.kind,
    provenance: edge.provenance,
    source: edge.source,
    confidence: edge.confidence,
    label: edge.label,
    pathCosts: {
      balanced: Number.isFinite(balanced) ? balanced : 9999,
      semantic: Number.isFinite(semantic) ? semantic : 9999,
      structural: Number.isFinite(structural) ? structural : 9999,
    },
  };
}

export function buildGraphExplorerPayload(
  graph: UnifiedCodeGraph,
  kernelProfile?: WorkspaceKernelProfile
): GraphExplorerPayload {
  const sanitized = sanitizeGraphForExport(graph);
  const primaryLens = recommendPrimaryGraphLens(sanitized, kernelProfile);
  const communities = buildGraphCommunityHubSummaries(sanitized);
  const navigableKinds = new Set([
    "code_file",
    "config_file",
    "doc_file",
    "doc_section",
    "symbol",
    "community",
    "project",
    "package",
    "test",
  ]);

  const nodes: GraphExplorerNode[] = sanitized.nodes
    .filter((node) => navigableKinds.has(node.kind))
    .map((node) => {
      const community = findGraphCommunityForNode(sanitized, node.id);
      return {
        id: node.id,
        kind: node.kind,
        label: node.label,
        path: node.path,
        lensIds: graphLensIdsForNode(node),
        communityId: community?.id,
        communityLabel: community?.label,
        scannerId: node.scannerId,
      };
    });

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = sanitized.edges
    .map(toExplorerEdge)
    .filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));

  return {
    workspaceRoot: sanitized.workspaceRoot,
    generatedAt: sanitized.generatedAt,
    schemaVersion: sanitized.schemaVersion,
    primaryLens,
    activeScannerIds: sanitized.activeScannerIds,
    lenses: GRAPH_TASK_LENS_DEFINITIONS,
    communities,
    nodes,
    edges,
    risks: buildGraphExportRisks(sanitized, kernelProfile),
    ecosystemSupportMatrix: buildEcosystemSupportMatrix({ graph: sanitized, kernelProfile }),
    refreshCommands: buildGraphRefreshCommands(sanitized.workspaceRoot, primaryLens),
    diagnostics: sanitized.diagnostics,
  };
}

function prioritizeReadFirstNodes(graph: UnifiedCodeGraph, limit: number) {
  const priority = (node: UnifiedCodeGraphNode) => {
    if (node.kind === "symbol" && /viewmodel|service|controller|main/i.test(node.label)) return 0;
    if (node.kind === "code_file" && /\.(cs|ts|tsx)$/i.test(node.path ?? node.label)) return 1;
    if (node.kind === "community") return 2;
    if (node.kind === "config_file") return 3;
    return 4;
  };
  return [...graph.nodes]
    .filter((node) => ["symbol", "code_file", "community", "config_file"].includes(node.kind))
    .filter((node) => !(node.path ?? node.label).includes("/bin/"))
    .filter((node) => !(node.path ?? node.label).includes("/obj/"))
    .sort((left, right) => priority(left) - priority(right) || left.label.localeCompare(right.label))
    .slice(0, limit);
}

export function getReadTheseFirstNodesByLens(
  graph: UnifiedCodeGraph,
  lensId: GraphTaskLensId,
  limit = 5
) {
  return prioritizeReadFirstNodes(filterUnifiedGraphByLens(graph, lensId), limit);
}

export function renderLensReadFirstMarkdown(graph: UnifiedCodeGraph, kernelProfile?: WorkspaceKernelProfile) {
  const primaryLens = recommendPrimaryGraphLens(graph, kernelProfile);
  const lensIds = GRAPH_TASK_LENS_DEFINITIONS
    .map((definition) => definition.id)
    .filter((lensId) => lensId !== "all")
    .filter((lensId) => {
      const scoped = filterUnifiedGraphByLens(graph, lensId);
      return scoped.nodes.some((node) => ["symbol", "code_file", "community", "config_file"].includes(node.kind));
    })
    .sort((left, right) => {
      if (left === primaryLens) return -1;
      if (right === primaryLens) return 1;
      return left.localeCompare(right);
    });

  const lines: string[] = ["## Read first by lens", ""];
  if (lensIds.length === 0) {
    lines.push("- No lens-specific read-first guidance available.");
    lines.push("");
    return lines;
  }

  for (const lensId of lensIds) {
    const definition = GRAPH_TASK_LENS_DEFINITIONS.find((entry) => entry.id === lensId);
    const readFirst = prioritizeReadFirstNodes(filterUnifiedGraphByLens(graph, lensId), 5);
    lines.push(`### ${definition?.label ?? lensId}`);
    if (readFirst.length === 0) {
      lines.push("- No prioritized nodes for this lens.");
    } else {
      lines.push(...readFirst.map((node) => `- \`${node.path ?? node.label}\` (${node.kind}) — ${node.label}`));
    }
    lines.push("");
  }
  return lines;
}

function buildExplorerClientScript() {
  const pathSeedResolver = buildGraphPathSeedResolverBrowserScript(GRAPH_PATH_FILE_QUERY_EXTENSION_LIST);
  return `
(function () {
  const data = JSON.parse(document.getElementById("oag-explorer-data").textContent || "{}");
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]));

  const searchInput = document.getElementById("oag-search");
  const hubSearchInput = document.getElementById("oag-hub-search");
  const lensSelect = document.getElementById("oag-lens");
  const communitySelect = document.getElementById("oag-community");
  const nodeTableBody = document.getElementById("oag-node-rows");
  const explainPanel = document.getElementById("oag-explain-panel");
  const pathPanel = document.getElementById("oag-path-panel");
  const pathFromInput = document.getElementById("oag-path-from");
  const pathToInput = document.getElementById("oag-path-to");
  const pathRunButton = document.getElementById("oag-path-run");
  const pathModeSelect = document.getElementById("oag-path-mode");
  const communityCards = document.querySelectorAll("[data-community-id]");
  const NODE_PENALTY = {
    workspace: 5000,
    project: 2500,
    package: 450,
    directory: 400,
    community: 350,
    code_file: 18,
    symbol: 2,
    external_dep: 500,
  };

  let activeCommunityId = "";

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function nodeMatchesSearch(node, query) {
    if (!query) return true;
    const haystack = normalize([node.label, node.path, node.kind, node.communityLabel].join(" "));
    const tokens = normalize(query).split(/\\s+/).filter(Boolean);
    return tokens.every((token) => haystack.includes(token));
  }

  function hubMatchesSearch(hub, query) {
    if (!query) return true;
    const haystack = normalize([
      hub.label,
      hub.path,
      hub.summary,
      hub.hubSummary,
      hub.taskLens,
      ...(hub.topFiles || []),
      ...(hub.topSymbols || []),
      ...(hub.docLinks || []),
    ].join(" "));
    const tokens = normalize(query).split(/\\s+/).filter(Boolean);
    return tokens.every((token) => haystack.includes(token));
  }

  function renderCommunityCards() {
    const query = hubSearchInput ? hubSearchInput.value.trim() : "";
    for (const card of communityCards) {
      const hubId = card.getAttribute("data-community-id") || "";
      const hub = (data.communities || []).find((entry) => entry.id === hubId);
      const visible = hub ? hubMatchesSearch(hub, query) : true;
      card.style.display = visible ? "" : "none";
    }
  }

  function filteredNodes() {
    const search = searchInput ? searchInput.value.trim() : "";
    const lens = lensSelect ? lensSelect.value : "all";
    return data.nodes.filter((node) => {
      if (activeCommunityId && node.communityId !== activeCommunityId) return false;
      if (lens !== "all" && !node.lensIds.includes(lens)) return false;
      return nodeMatchesSearch(node, search);
    });
  }

  function renderRows() {
    if (!nodeTableBody) return;
    const rows = filteredNodes().slice(0, 500);
    nodeTableBody.innerHTML = rows.map((node) => {
      const path = node.path ? \`<span class="path">\${escapeHtml(node.path)}</span>\` : "";
      const community = node.communityLabel ? \`<span class="pill">\${escapeHtml(node.communityLabel)}</span>\` : "";
      return \`<tr data-node-id="\${escapeHtml(node.id)}"><td>\${escapeHtml(node.kind)}</td><td>\${escapeHtml(node.label)}</td><td>\${path}</td><td>\${community}</td></tr>\`;
    }).join("");
    for (const row of nodeTableBody.querySelectorAll("tr[data-node-id]")) {
      row.addEventListener("click", () => showExplain(row.getAttribute("data-node-id")));
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function connectedEdges(nodeId) {
    return data.edges.filter((edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId);
  }

  function showExplain(nodeId) {
    if (!explainPanel || !nodeId) return;
    const node = nodesById.get(nodeId);
    if (!node) {
      explainPanel.innerHTML = "<p>Node not found.</p>";
      return;
    }
    const edges = connectedEdges(nodeId);
    const neighborIds = new Set();
    for (const edge of edges) {
      neighborIds.add(edge.sourceNodeId === nodeId ? edge.targetNodeId : edge.sourceNodeId);
    }
    const neighbors = [...neighborIds].map((id) => nodesById.get(id)).filter(Boolean);
    const communityLine = node.communityLabel
      ? \`<p><strong>Community:</strong> \${escapeHtml(node.communityLabel)}</p>\`
      : "";
    const neighborList = neighbors.length > 0
      ? \`<ul>\${neighbors.map((neighbor) => \`<li>[\${escapeHtml(neighbor.kind)}] \${escapeHtml(neighbor.label)}\${neighbor.path ? \` — \${escapeHtml(neighbor.path)}\` : ""}</li>\`).join("")}</ul>\`
      : "<p>No direct neighbors in export.</p>";
    const edgeList = edges.length > 0
      ? \`<ul>\${edges.slice(0, 12).map((edge) => \`<li>\${escapeHtml(edge.kind)} (\${escapeHtml(edge.provenance)}\${edge.source ? \`, \${escapeHtml(edge.source)}\` : ""}\${typeof edge.confidence === "number" ? \`, \${Math.round(edge.confidence * 100)}%\` : ""})\${edge.label ? \` — \${escapeHtml(edge.label)}\` : ""}</li>\`).join("")}</ul>\`
      : "<p>No connected edges.</p>";
    explainPanel.innerHTML = \`
      <h3>\${escapeHtml(node.label)}</h3>
      <p class="meta">[\${escapeHtml(node.kind)}]\${node.path ? \` · \${escapeHtml(node.path)}\` : ""}</p>
      \${communityLine}
      <p><strong>Neighbors</strong></p>
      \${neighborList}
      <p><strong>Edges</strong></p>
      \${edgeList}
    \`;
  }

${pathSeedResolver}

  function nodePenalty(node, mode) {
    if (mode === "semantic" && ["workspace", "project", "community", "package", "directory"].includes(node.kind)) {
      return 50000;
    }
    let penalty = NODE_PENALTY[node.kind] ?? 40;
    if (node.kind === "symbol" && /\\(namespace\\)/i.test(node.label)) penalty = 900;
    if (node.kind === "symbol" && /\\(external\\)/i.test(node.label)) penalty = 700;
    if (mode === "structural") penalty *= 0.35;
    return penalty;
  }

  function edgeCost(edge, mode) {
    return edge.pathCosts?.[mode] ?? 9999;
  }

  function buildWeightedAdjacency(mode) {
    const adjacency = new Map();
    const add = (sourceId, targetId, edge, cost) => {
      const current = adjacency.get(sourceId) || [];
      current.push({ neighborId: targetId, edge, cost });
      adjacency.set(sourceId, current);
    };
    for (const edge of data.edges) {
      const cost = edgeCost(edge, mode);
      if (cost >= 9000) continue;
      add(edge.sourceNodeId, edge.targetNodeId, edge, cost);
      add(edge.targetNodeId, edge.sourceNodeId, edge, cost);
    }
    return adjacency;
  }

  function findWeightedPath(fromNode, toNode, mode) {
    const adjacency = buildWeightedAdjacency(mode);
    const dist = new Map([[fromNode.id, 0]]);
    const previous = new Map([[fromNode.id, null]]);
    const visited = new Set();
    const queue = [fromNode.id];
    while (queue.length > 0) {
      queue.sort((left, right) => (dist.get(left) ?? Infinity) - (dist.get(right) ?? Infinity));
      const currentId = queue.shift();
      if (!currentId || visited.has(currentId)) continue;
      visited.add(currentId);
      if (currentId === toNode.id) break;
      const currentDist = dist.get(currentId) ?? Infinity;
      for (const entry of adjacency.get(currentId) || []) {
        const neighbor = nodesById.get(entry.neighborId);
        if (!neighbor) continue;
        const nextDist = currentDist + entry.cost + nodePenalty(neighbor, mode);
        if (nextDist >= (dist.get(entry.neighborId) ?? Infinity)) continue;
        dist.set(entry.neighborId, nextDist);
        previous.set(entry.neighborId, { nodeId: currentId, edge: entry.edge, edgeCost: entry.cost, nodePenalty: nodePenalty(neighbor, mode) });
        if (!visited.has(entry.neighborId)) queue.push(entry.neighborId);
      }
    }
    if (!dist.has(toNode.id)) return { nodes: [], steps: [], totalCost: null };
    const pathIds = [];
    const steps = [];
    let cursor = toNode.id;
    while (cursor) {
      pathIds.unshift(cursor);
      const step = previous.get(cursor);
      if (step) {
        steps.unshift(step);
        cursor = step.nodeId;
      } else {
        cursor = null;
      }
    }
    return {
      nodes: pathIds.map((id) => nodesById.get(id)).filter(Boolean),
      steps,
      totalCost: dist.get(toNode.id) ?? null,
    };
  }

  function renderPath() {
    if (!pathPanel || !pathFromInput || !pathToInput) return;
    const mode = pathModeSelect ? pathModeSelect.value : "balanced";
    const fromNode = resolveNode(pathFromInput.value);
    const toNode = resolveNode(pathToInput.value);
    if (!fromNode || !toNode) {
      pathPanel.innerHTML = "<p>Could not resolve both path endpoints in this export.</p>";
      return;
    }
    const result = findWeightedPath(fromNode, toNode, mode);
    if (result.nodes.length === 0) {
      pathPanel.innerHTML = \`<p>No path found between <strong>\${escapeHtml(fromNode.label)}</strong> and <strong>\${escapeHtml(toNode.label)}</strong> in <strong>\${escapeHtml(mode)}</strong> mode.</p>\`;
      return;
    }
    const stepLines = result.steps.map((step, index) => {
      const targetNode = result.nodes[index + 1];
      if (!targetNode || !step.edge) return "";
      return \`<li>via \${escapeHtml(step.edge.kind)} (\${escapeHtml(step.edge.provenance)}) cost=\${Math.round(step.edgeCost)} penalty=\${Math.round(step.nodePenalty)} -> [\${escapeHtml(targetNode.kind)}] \${escapeHtml(targetNode.label)}</li>\`;
    }).filter(Boolean).join("");
    const hopCount = Math.max(0, result.nodes.length - 1);
    pathPanel.innerHTML = \`
      <p><strong>Mode:</strong> \${escapeHtml(mode)}\${result.totalCost !== null ? \` · total cost \${Math.round(result.totalCost)}\` : ""}</p>
      <p>Path (\${hopCount} hop\${hopCount === 1 ? "" : "s"}):</p>
      <ol>\${result.nodes.map((node) => \`<li>[\${escapeHtml(node.kind)}] \${escapeHtml(node.label)}\${node.path ? \` — \${escapeHtml(node.path)}\` : ""}</li>\`).join("")}</ol>
      \${stepLines ? \`<p><strong>Hop details</strong></p><ul>\${stepLines}</ul>\` : ""}
    \`;
  }

  function setCommunity(communityId) {
    activeCommunityId = communityId || "";
    if (communitySelect) communitySelect.value = activeCommunityId;
    for (const card of communityCards) {
      card.classList.toggle("active", card.getAttribute("data-community-id") === activeCommunityId);
    }
    renderRows();
  }

  if (lensSelect) {
    lensSelect.value = data.primaryLens || "all";
    lensSelect.addEventListener("change", renderRows);
  }
  if (searchInput) searchInput.addEventListener("input", renderRows);
  if (hubSearchInput) hubSearchInput.addEventListener("input", renderCommunityCards);
  if (communitySelect) {
    communitySelect.addEventListener("change", () => setCommunity(communitySelect.value));
  }
  function activateCommunityCard(card, event) {
    if (event.target instanceof HTMLElement && event.target.closest(".lens-chip")) return;
    setCommunity(card.getAttribute("data-community-id") || "");
  }

  for (const card of communityCards) {
    card.addEventListener("click", (event) => activateCommunityCard(card, event));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateCommunityCard(card, event);
    });
    for (const chip of card.querySelectorAll(".lens-chip")) {
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        const lensId = chip.getAttribute("data-lens-id") || "";
        if (lensSelect && lensId) {
          lensSelect.value = lensId;
          renderRows();
        }
      });
    }
  }
  if (pathRunButton) pathRunButton.addEventListener("click", renderPath);
  renderCommunityCards();
  renderRows();
})();
`;
}

export function renderGraphExplorerHtml(
  graph: UnifiedCodeGraph,
  options: { kernelProfile?: WorkspaceKernelProfile } = {}
) {
  const payload = buildGraphExplorerPayload(graph, options.kernelProfile);
  const health = buildGraphHealthSummary(graph, options.kernelProfile);
  const primaryLensLabel = GRAPH_TASK_LENS_DEFINITIONS.find((definition) => definition.id === payload.primaryLens)?.label
    ?? payload.primaryLens;

  const badgeRows = health.badges.map((badge) => {
    const tone = badge.tone === "good" ? "badge-good" : badge.tone === "bad" ? "badge-bad" : "badge-warn";
    return `<span class="badge ${tone}" title="${escapeHtml(badge.detail)}">${escapeHtml(badge.label)}</span>`;
  }).join("");

  const lensOptions = payload.lenses.map((lens) =>
    `<option value="${escapeHtml(lens.id)}">${escapeHtml(lens.label)}</option>`
  ).join("");

  const communityOptions = [
    `<option value="">All communities</option>`,
    ...payload.communities.map((community) =>
      `<option value="${escapeHtml(community.id)}">${escapeHtml(community.label)}</option>`
    ),
  ].join("");

  const communityCards = payload.communities.map((community) => {
    const symbolsLine = community.topSymbols?.length
      ? `<p><strong>Top symbols:</strong> ${community.topSymbols.slice(0, 3).map((symbol) => `<code>${escapeHtml(symbol)}</code>`).join(", ")}</p>`
      : "";
    const incomingLine = community.incomingRelationships?.length
      ? `<p class="meta"><strong>Incoming:</strong> ${community.incomingRelationships.map((rel) => `${escapeHtml(rel.edgeKind)}←${escapeHtml(rel.targetLabel)} (${rel.count})`).join(", ")}</p>`
      : "";
    const outgoingLine = community.outgoingRelationships?.length
      ? `<p class="meta"><strong>Outgoing:</strong> ${community.outgoingRelationships.map((rel) => `${escapeHtml(rel.edgeKind)}→${escapeHtml(rel.targetLabel)} (${rel.count})`).join(", ")}</p>`
      : "";
    const provenanceLine = community.provenanceMix?.total
      ? `<p class="meta"><strong>Provenance:</strong> ${community.provenanceMix.extracted} extracted, ${community.provenanceMix.inferred} inferred</p>`
      : "";
    const docsLine = community.docLinks?.length
      ? `<p><strong>Docs:</strong> ${community.docLinks.slice(0, 2).map((doc) => `<code>${escapeHtml(doc)}</code>`).join(", ")}</p>`
      : "";
    const lensButton = community.taskLens
      ? `<button type="button" class="lens-chip" data-lens-id="${escapeHtml(community.taskLens)}">Lens: ${escapeHtml(community.taskLens)}</button>`
      : "";
    return `
    <article class="card community-card" data-community-id="${escapeHtml(community.id)}" role="button" tabindex="0">
      <h3>${escapeHtml(community.label)}</h3>
      <p>${escapeHtml(community.hubSummary || community.summary)}</p>
      ${lensButton}
      ${community.topFiles.length > 0
    ? `<p><strong>Entry files:</strong> ${community.topFiles.slice(0, 3).map((file) => `<code>${escapeHtml(file)}</code>`).join(", ")}</p>`
    : ""}
      ${symbolsLine}
      ${incomingLine}
      ${outgoingLine}
      ${provenanceLine}
      ${docsLine}
    </article>`;
  }).join("");

  const riskList = payload.risks.length > 0
    ? `<ul>${payload.risks.map((risk) => `<li>${escapeHtml(risk)}</li>`).join("")}</ul>`
    : "<p>None recorded.</p>";

  const supportMatrixList = payload.ecosystemSupportMatrix.length > 0
    ? `<ul>${payload.ecosystemSupportMatrix.map((row) =>
      `<li><strong>${escapeHtml(row.scannerId)} (${escapeHtml(row.tier)})</strong> · ${escapeHtml(row.projectType)} · files=${row.indexedFileCount} · symbols=${row.symbolCount} · semantic=${row.semanticSupported ? "yes" : "no"}<br /><span class="meta">${escapeHtml(row.limitation)}</span></li>`
    ).join("")}</ul>`
    : "<p>None recorded.</p>";

  const refreshList = `<ul>${payload.refreshCommands.map((command) => `<li><code>${escapeHtml(command)}</code></li>`).join("")}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenAgentGraph Explorer</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: Segoe UI, sans-serif; margin: 0; color: #111; background: #f7f7f8; }
    header { background: #fff; border-bottom: 1px solid #e5e5e5; padding: 20px 24px; }
    main { display: grid; grid-template-columns: 320px 1fr; gap: 16px; padding: 16px 24px 32px; }
    aside, section { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 16px; }
    h1, h2, h3 { margin: 0 0 8px; }
    .meta { color: #555; font-size: 14px; }
    .badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .badge { border-radius: 999px; padding: 4px 10px; font-size: 12px; border: 1px solid #ccc; }
    .badge-good { background: #e8f7ee; border-color: #8fd19e; }
    .badge-warn { background: #fff5df; border-color: #e8c468; }
    .badge-bad { background: #fdebec; border-color: #e57373; }
    label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 6px; }
    input, select, button { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; border: 1px solid #ccc; font: inherit; }
    button { cursor: pointer; background: #111; color: #fff; border-color: #111; margin-top: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 12px; background: #fafafa; }
    .community-card.active { border-color: #111; box-shadow: 0 0 0 1px #111; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border-bottom: 1px solid #eee; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #fafafa; position: sticky; top: 0; }
    tbody tr { cursor: pointer; }
    tbody tr:hover { background: #f3f6ff; }
    .path, .pill { font-size: 12px; color: #444; }
    .pill { display: inline-block; background: #eef2ff; border-radius: 999px; padding: 2px 8px; }
    .lens-chip { width: auto; display: inline-block; margin: 4px 0 8px; padding: 4px 10px; font-size: 12px; background: #eef2ff; color: #111; border: 1px solid #c7d2fe; }
    .lens-chip:hover { background: #dbe4ff; }
    .table-wrap { max-height: 520px; overflow: auto; border: 1px solid #eee; border-radius: 10px; }
    .stack > * + * { margin-top: 16px; }
    code { font-size: 12px; }
    @media (max-width: 960px) { main { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>OpenAgentGraph Explorer</h1>
    <p class="meta">Workspace: ${escapeHtml(payload.workspaceRoot)} · Generated: ${escapeHtml(payload.generatedAt)} · Nodes: ${payload.nodes.length} · Edges: ${payload.edges.length} · Primary lens: ${escapeHtml(primaryLensLabel)} · Scanners: ${escapeHtml(payload.activeScannerIds.join(", ") || "generic")}</p>
    <div class="badges">${badgeRows}</div>
  </header>
  <main>
    <aside class="stack">
      <section>
        <h2>Search &amp; filters</h2>
        <label for="oag-search">Search nodes</label>
        <input id="oag-search" type="search" placeholder="MainViewModel, PlaybackService, src/..." />
        <label for="oag-lens">Task lens</label>
        <select id="oag-lens">${lensOptions}</select>
        <label for="oag-community">Community</label>
        <select id="oag-community">${communityOptions}</select>
      </section>
      <section>
        <h2>Path preview</h2>
        <label for="oag-path-from">From</label>
        <input id="oag-path-from" type="text" placeholder="MainView.xaml" />
        <label for="oag-path-to">To</label>
        <input id="oag-path-to" type="text" placeholder="PlaybackService" />
        <label for="oag-path-mode">Path mode</label>
        <select id="oag-path-mode">
          <option value="balanced">Balanced</option>
          <option value="semantic">Semantic</option>
          <option value="structural">Structural</option>
        </select>
        <button id="oag-path-run" type="button">Preview path</button>
        <div id="oag-path-panel" class="meta" style="margin-top:12px"></div>
      </section>
      <section>
        <h2>Ecosystem support</h2>
        ${supportMatrixList}
      </section>
      <section>
        <h2>Risks &amp; refresh</h2>
        ${riskList}
        ${refreshList}
      </section>
    </aside>
    <div class="stack">
      <section>
        <h2>Community navigation</h2>
        <label for="oag-hub-search">Search hubs</label>
        <input id="oag-hub-search" type="search" placeholder="backend, MainViewModel, docs..." />
        <div class="grid" id="oag-community-grid">${communityCards || "<p>No communities detected.</p>"}</div>
      </section>
      <section>
        <h2>Node explorer</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Kind</th><th>Label</th><th>Path</th><th>Community</th></tr></thead>
            <tbody id="oag-node-rows"></tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Explain panel</h2>
        <div id="oag-explain-panel" class="meta">Select a node to inspect neighbors, edges, and community context.</div>
      </section>
    </div>
  </main>
  <script type="application/json" id="oag-explorer-data">${serializeJsonForScriptTag(payload)}</script>
  <script>${buildExplorerClientScript()}</script>
</body>
</html>`;
}