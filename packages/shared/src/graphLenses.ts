import type { UnifiedCodeGraph, UnifiedCodeGraphNode, WorkspaceKernelProfile } from "./codeGraph.js";
import { summarizeUnifiedCommunityNode } from "./graphCommunities.js";
import { getEcosystemScannerCatalogEntry } from "./graphEcosystemHealth.js";
import { scoreReadFirstNode } from "./graphReadFirst.js";

function isTestLikeNode(node: UnifiedCodeGraphNode) {
  return node.kind === "test"
    || /tests?[/\\]/i.test(node.path ?? "")
    || /tests?\./i.test(node.path ?? node.label);
}

function buildGraphAdjacency(graph: UnifiedCodeGraph) {
  const adjacency = new Map<string, Set<string>>();
  const add = (sourceId: string, targetId: string) => {
    const current = adjacency.get(sourceId) ?? new Set<string>();
    current.add(targetId);
    adjacency.set(sourceId, current);
  };
  for (const edge of graph.edges) {
    add(edge.sourceNodeId, edge.targetNodeId);
    add(edge.targetNodeId, edge.sourceNodeId);
  }
  return adjacency;
}

export type GraphTaskLensId =
  | "all"
  | "frontend"
  | "backend-runtime"
  | "tests"
  | "provider-ai"
  | "docs-handoff"
  | "infra"
  | "database"
  | "desktop-mobile"
  | "game-assets"
  | "security";

export interface GraphTaskLensDefinition {
  id: GraphTaskLensId;
  label: string;
  description: string;
}

export const GRAPH_TASK_LENS_DEFINITIONS: GraphTaskLensDefinition[] = [
  { id: "all", label: "All", description: "Full workspace code graph." },
  { id: "frontend", label: "Frontend", description: "UI, components, views, pages, and client routes." },
  { id: "backend-runtime", label: "Backend/runtime", description: "APIs, services, scanners, CLI, and server runtime." },
  { id: "tests", label: "Tests", description: "Test files, specs, and verification harnesses." },
  { id: "provider-ai", label: "Provider/AI", description: "LLM providers, embeddings, MCP, and agent integrations." },
  { id: "docs-handoff", label: "Docs/handoff", description: "Documentation, plans, and GRAPH_REPORT navigation." },
  { id: "infra", label: "Infra", description: "Terraform, Kubernetes, Docker, and deployment config." },
  { id: "database", label: "Database", description: "Models, migrations, repositories, and schema assets." },
  { id: "desktop-mobile", label: "Desktop/mobile", description: "WPF/XAML, Electron, mobile, and native UI shells." },
  { id: "game-assets", label: "Game/assets", description: "Game scripts, scenes, and asset pipelines." },
  { id: "security", label: "Security", description: "Auth, crypto, and hardening-sensitive modules." },
];

export interface GraphLensSummary {
  id: GraphTaskLensId;
  label: string;
  description: string;
  nodeCount: number;
  fileCount: number;
  symbolCount: number;
  communityCount: number;
  topPaths: string[];
}

export interface GraphGodNodeSummary {
  id: string;
  label: string;
  path?: string;
  memberCount: number;
  topSymbols: string[];
  topFiles: string[];
  summary: string;
}

export interface GraphHealthBadge {
  label: string;
  tone: "good" | "warn" | "bad";
  detail: string;
}

export interface GraphHealthSummary {
  extractedEdgePercent: number;
  symbolCount: number;
  fileCount: number;
  communityCount: number;
  orphanFileCount: number;
  activeScannerIds: string[];
  partialSupportWarnings: string[];
  badges: GraphHealthBadge[];
}

function pathParts(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments[segments.length - 1] ?? normalized;
  return { normalized, segments, basename, padded: `/${normalized}/` };
}

function pathContains(paddedPath: string, candidates: readonly string[]) {
  return candidates.some((candidate) => paddedPath.includes(`/${candidate}/`));
}

function hasSegment(segments: string[], candidates: readonly string[]) {
  return candidates.some((candidate) => segments.includes(candidate));
}

export function graphLensIdsForPath(value: string): GraphTaskLensId[] {
  const { normalized, segments, basename, padded } = pathParts(value);
  if (!normalized) return [];
  const scopes = new Set<GraphTaskLensId>();

  const isFrontend =
    /\.(tsx|jsx|vue|svelte|css|scss|xaml)$/i.test(basename)
    || pathContains(padded, ["components", "pages", "views", "app", "renderer", "webview", "styles", "ui"]);
  const isBackend =
    pathContains(padded, ["backend", "server", "api", "routes", "controllers", "services", "scanner", "cli", "runtime", "middleware"])
    || hasSegment(segments, ["cmd", "internal", "pkg"]);
  const isTests =
    pathContains(padded, ["tests", "test", "e2e", "playwright", "__tests__"])
    || /\.(test|spec)\./i.test(basename)
    || /_test\.(go|py|rs)$/i.test(basename)
    || /Tests?\//i.test(normalized);
  const isProvider =
    pathContains(padded, ["providers", "provider", "sdk", "ai", "llm", "mcp", "embeddings"])
    || ["openai", "ollama", "anthropic", "gemini"].some((token) => normalized.includes(token));
  const isDocs =
    /\.(md|rst|txt)$/i.test(basename)
    || pathContains(padded, ["docs", "documentation", "wiki", "handoff"])
    || ["graph_report", "llms", "readme", "plan"].some((token) => normalized.includes(token));
  const isInfra =
    /\.(tf|tfvars|yaml|yml)$/i.test(basename)
    && pathContains(padded, ["terraform", "k8s", "kubernetes", "docker", "ansible", "pulumi", "infra", "charts", "modules"]);
  const isDatabase =
    pathContains(padded, ["migrations", "schema", "repositories", "repository", "models", "database", "db", "sql"]);
  const isDesktop =
    /\.(xaml|cs)$/i.test(basename) && pathContains(padded, ["viewmodels", "views", "app"])
    || pathContains(padded, ["electron", "tauri", "android", "ios", "flutter", "desktop", "mobile", "pubspec"]);
  const isGame =
    pathContains(padded, ["assets", "unity", "unreal", "godot", "scenes", "scripts"]);
  const isSecurity =
    pathContains(padded, ["auth", "security", "crypto", "owasp", "permissions"]);

  if (isFrontend) scopes.add("frontend");
  if (isBackend) scopes.add("backend-runtime");
  if (isTests) scopes.add("tests");
  if (isProvider) scopes.add("provider-ai");
  if (isDocs) scopes.add("docs-handoff");
  if (isInfra || /\.tf$/i.test(basename)) scopes.add("infra");
  if (isDatabase || basename === "models.py") scopes.add("database");
  if (isDesktop || /\.xaml$/i.test(basename)) scopes.add("desktop-mobile");
  if (isGame) scopes.add("game-assets");
  if (isSecurity) scopes.add("security");

  return [...scopes];
}

export function graphLensIdsForNode(node: UnifiedCodeGraphNode): GraphTaskLensId[] {
  const scopes = new Set<GraphTaskLensId>();
  const pathValue = node.path ?? node.label;
  for (const lensId of graphLensIdsForPath(pathValue)) {
    scopes.add(lensId);
  }
  if (node.kind === "community") scopes.add("backend-runtime");
  if (node.kind === "doc_file" || node.kind === "doc_section") scopes.add("docs-handoff");
  if (node.kind === "config_file" && /\.(tf|tfvars)$/i.test(pathValue)) scopes.add("infra");
  if (node.kind === "symbol" && /viewmodel|view|page|component/i.test(node.label)) scopes.add("frontend");
  if (node.kind === "symbol" && /test/i.test(node.label)) scopes.add("tests");
  return [...scopes];
}

export function graphLensAllowsNode(node: UnifiedCodeGraphNode, lensId: GraphTaskLensId) {
  if (lensId === "all") return true;
  return graphLensIdsForNode(node).includes(lensId);
}

export function filterUnifiedGraphByLens(graph: UnifiedCodeGraph, lensId: GraphTaskLensId): UnifiedCodeGraph {
  if (lensId === "all") return graph;
  const nodeSet = new Set(
    graph.nodes.filter((node) => graphLensAllowsNode(node, lensId)).map((node) => node.id)
  );
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => nodeSet.has(node.id)),
    edges: graph.edges.filter((edge) => nodeSet.has(edge.sourceNodeId) && nodeSet.has(edge.targetNodeId)),
  };
}

function topPathsForLens(graph: UnifiedCodeGraph, lensId: GraphTaskLensId, limit = 5) {
  return graph.nodes
    .filter((node) => ["code_file", "config_file", "symbol"].includes(node.kind))
    .filter((node) => graphLensAllowsNode(node, lensId))
    .map((node) => node.path ?? node.label)
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
}

export function buildGraphLensSummaries(graph: UnifiedCodeGraph): GraphLensSummary[] {
  return GRAPH_TASK_LENS_DEFINITIONS.map((definition) => {
    const scopedNodes = graph.nodes.filter((node) => graphLensAllowsNode(node, definition.id));
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      nodeCount: scopedNodes.length,
      fileCount: scopedNodes.filter((node) => node.kind === "code_file" || node.kind === "config_file").length,
      symbolCount: scopedNodes.filter((node) => node.kind === "symbol").length,
      communityCount: scopedNodes.filter((node) => node.kind === "community").length,
      topPaths: topPathsForLens(graph, definition.id),
    };
  });
}

export function recommendPrimaryGraphLens(
  graph: UnifiedCodeGraph,
  kernelProfile?: WorkspaceKernelProfile
): GraphTaskLensId {
  const primaryType = kernelProfile?.primaryType ?? "";
  const typeLensMap: Record<string, GraphTaskLensId> = {
    "next-app": "frontend",
    "django-app": "database",
    "python-app": "backend-runtime",
    python: "backend-runtime",
    "go-module": "backend-runtime",
    go: "backend-runtime",
    "terraform-iac": "infra",
    terraform: "infra",
    "documentation-corpus": "docs-handoff",
    dotnet: "desktop-mobile",
    "csharp-desktop": "desktop-mobile",
    "rust-workspace": "backend-runtime",
    rust: "backend-runtime",
  };
  if (typeLensMap[primaryType]) return typeLensMap[primaryType]!;

  const summaries = buildGraphLensSummaries(graph).filter((summary) => summary.id !== "all");
  const ranked = summaries
    .filter((summary) => summary.fileCount > 0 || summary.symbolCount > 0)
    .sort((left, right) =>
      right.fileCount + right.symbolCount - (left.fileCount + left.symbolCount)
      || left.label.localeCompare(right.label)
    );
  return ranked[0]?.id ?? "all";
}

export function buildGraphGodNodeSummaries(graph: UnifiedCodeGraph, limit = 8): GraphGodNodeSummary[] {
  const communities = graph.nodes.filter((node) => node.kind === "community");
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildGraphAdjacency(graph);

  const summaries = communities.map((community) => {
    const enriched = summarizeUnifiedCommunityNode(community);
    const neighborIds = [...(adjacency.get(community.id) ?? [])];
    const members = neighborIds
      .map((id) => nodesById.get(id))
      .filter((node): node is UnifiedCodeGraphNode => Boolean(node));
    const files = members.filter((node) =>
      (node.kind === "code_file" || node.kind === "config_file") && !isTestLikeNode(node)
    );
    const symbols = members.filter((node) => node.kind === "symbol" && !isTestLikeNode(node));
    const topFiles = enriched.topFiles.length > 0
      ? enriched.topFiles
      : files
        .sort((left, right) => scoreReadFirstNode(left) - scoreReadFirstNode(right) || left.label.localeCompare(right.label))
        .map((node) => node.path ?? node.label)
        .slice(0, 4);
    const topSymbols = symbols
      .sort((left, right) => scoreReadFirstNode(left) - scoreReadFirstNode(right) || left.label.localeCompare(right.label))
      .map((node) => node.label)
      .slice(0, 4);
    const startHints = topSymbols.length > 0 ? topSymbols : topFiles;
    const summary = enriched.summary || [
      `${community.label} community with ${members.length} connected node(s).`,
      startHints.length > 0 ? `Start with ${startHints.slice(0, 2).join(", ")}.` : "Inspect community members in the graph export.",
    ].join(" ");
    return {
      id: community.id,
      label: enriched.label,
      path: community.path,
      memberCount: Math.max(members.length, enriched.fileCount),
      topSymbols,
      topFiles,
      summary,
    };
  });

  if (summaries.length > 0) {
    return summaries.sort((left, right) => right.memberCount - left.memberCount).slice(0, limit);
  }

  const prefixCounts = new Map<string, { files: string[]; symbols: string[] }>();
  for (const node of graph.nodes) {
    if (!["code_file", "symbol"].includes(node.kind)) continue;
    const nodePath = node.path ?? node.label;
    const prefix = nodePath.includes("/") ? nodePath.split("/")[0]! : ".";
    const bucket = prefixCounts.get(prefix) ?? { files: [], symbols: [] };
    if (node.kind === "code_file") bucket.files.push(nodePath);
    else bucket.symbols.push(node.label);
    prefixCounts.set(prefix, bucket);
  }

  return [...prefixCounts.entries()]
    .map(([prefix, bucket]) => ({
      id: `god:${prefix}`,
      label: prefix,
      path: prefix === "." ? undefined : prefix,
      memberCount: bucket.files.length + bucket.symbols.length,
      topSymbols: bucket.symbols.slice(0, 4),
      topFiles: bucket.files.slice(0, 4),
      summary: `${prefix} hub with ${bucket.files.length} file(s) and ${bucket.symbols.length} symbol(s).`,
    }))
    .sort((left, right) => right.memberCount - left.memberCount)
    .slice(0, limit);
}

export function buildGraphHealthSummary(
  graph: UnifiedCodeGraph,
  kernelProfile?: WorkspaceKernelProfile
): GraphHealthSummary {
  const files = graph.nodes.filter((node) => node.kind === "code_file" || node.kind === "config_file");
  const symbols = graph.nodes.filter((node) => node.kind === "symbol");
  const communities = graph.nodes.filter((node) => node.kind === "community");
  const extractedEdgeCount = graph.edges.filter((edge) => edge.provenance === "extracted").length;
  const extractedEdgePercent = graph.edges.length > 0
    ? Math.round((extractedEdgeCount / graph.edges.length) * 100)
    : 0;
  const connectedFileIds = new Set<string>();
  for (const edge of graph.edges) {
    if (files.some((file) => file.id === edge.sourceNodeId)) connectedFileIds.add(edge.sourceNodeId);
    if (files.some((file) => file.id === edge.targetNodeId)) connectedFileIds.add(edge.targetNodeId);
  }
  const orphanFileCount = files.filter((file) => !connectedFileIds.has(file.id)).length;
  const partialSupportWarnings = graph.diagnostics.filter((line) =>
    /T1|T2|T3|file-level|not enabled|not yet/i.test(line)
  );
  const badges: GraphHealthBadge[] = [];

  if (symbols.length > 0) {
    badges.push({ label: "Symbols", tone: "good", detail: `${symbols.length} indexed` });
  } else {
    badges.push({ label: "Symbols", tone: "warn", detail: "No symbols indexed" });
  }
  if (orphanFileCount === 0 || files.length === 0) {
    badges.push({ label: "Orphans", tone: "good", detail: "No isolated files" });
  } else {
    badges.push({ label: "Orphans", tone: "warn", detail: `${orphanFileCount} file(s) without edges` });
  }
  if (extractedEdgePercent >= 50) {
    badges.push({ label: "Provenance", tone: "good", detail: `${extractedEdgePercent}% extracted edges` });
  } else {
    badges.push({ label: "Provenance", tone: "warn", detail: `${extractedEdgePercent}% extracted edges` });
  }
  if (partialSupportWarnings.length === 0) {
    badges.push({ label: "Coverage", tone: "good", detail: "No partial-support warnings" });
  } else {
    badges.push({ label: "Coverage", tone: "warn", detail: `${partialSupportWarnings.length} partial-support warning(s)` });
  }
  if ((kernelProfile?.skippedCountsByReason?.unsupported ?? 0) > 0) {
    badges.push({
      label: "Unsupported",
      tone: "warn",
      detail: `${kernelProfile?.skippedCountsByReason?.unsupported} unsupported file(s)`,
    });
  }

  for (const scannerId of graph.activeScannerIds) {
    const catalog = getEcosystemScannerCatalogEntry(scannerId);
    const tone = catalog.tier === "T0" || catalog.tier === "T1.5"
      ? "good"
      : catalog.tier === "T1"
        ? "warn"
        : "bad";
    badges.push({
      label: catalog.label,
      tone,
      detail: `${catalog.tier} · ${catalog.semanticSupported ? "semantic-lite" : "structural"}`,
    });
  }

  if (graph.analyzers?.some((analyzer) => analyzer.status === "unavailable")) {
    const unavailable = graph.analyzers.filter((analyzer) => analyzer.status === "unavailable").length;
    badges.push({
      label: "Analyzers",
      tone: "warn",
      detail: `${unavailable} optional analyzer(s) unavailable; structural fallback active`,
    });
  }

  return {
    extractedEdgePercent,
    symbolCount: symbols.length,
    fileCount: files.length,
    communityCount: communities.length,
    orphanFileCount,
    activeScannerIds: graph.activeScannerIds,
    partialSupportWarnings,
    badges,
  };
}