import { createHash } from "crypto";
import type { IgnoreRule, UnifiedCodeGraph, UnifiedCodeGraphEdge, UnifiedCodeGraphNode, WorkspaceKernelProfile } from "./codeGraph.js";
import { CODE_GRAPH_SCHEMA_VERSION } from "./codeGraph.js";

export const GRAPH_MANIFEST_SCHEMA_VERSION = "1";
export const GRAPH_INCREMENTAL_MAX_FILES = 20;
export const GRAPH_INCREMENTAL_MAX_RATIO = 0.15;
export const GRAPH_INCREMENTAL_MAX_STRIP_FILES = 40;

export interface GraphFileFingerprint {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  contentHash: string;
}

export interface GraphIncrementalManifest {
  schemaVersion: typeof GRAPH_MANIFEST_SCHEMA_VERSION;
  graphSchemaVersion: string;
  incrementalToolVersion: string;
  workspaceRoot: string;
  generatedAt: string;
  primaryType: string;
  activeScannerIds: string[];
  ignoreRuleFingerprint: string;
  files: GraphFileFingerprint[];
}

export type GraphUpdateMode = "noop" | "incremental" | "full";

export interface GraphUpdatePlan {
  mode: GraphUpdateMode;
  reasons: string[];
  added: string[];
  changed: string[];
  deleted: string[];
  unchanged: string[];
  /** Workspace-relative paths to partial-scan (changed/added plus dependency neighbors). */
  scanPaths: string[];
  /** Workspace-relative paths to strip from the cached graph before merge. */
  stripPaths: string[];
  /** Neighbor paths added for dependency edge refresh. */
  neighborPaths: string[];
}

const DEPENDENCY_BEARING_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".cxx",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".dart",
  ".gd",
  ".tscn",
  ".tres",
  ".unity",
  ".prefab",
  ".ts",
  ".tsx",
  ".vue",
  ".xaml",
  ".razor",
]);

const STRUCTURAL_PATH_PATTERNS = [
  /(^|\/)package\.json$/i,
  /(^|\/)tsconfig(?:\.|[^/]*\.json$)/i,
  /\.sln$/i,
  /\.csproj$/i,
  /(^|\/)go\.mod$/i,
  /(^|\/)Cargo\.toml$/i,
  /(^|\/)pyproject\.toml$/i,
  /(^|\/)manage\.py$/i,
  /(^|\/)Package\.swift$/i,
  /(^|\/)pubspec\.yaml$/i,
  /(^|\/)CMakeLists\.txt$/i,
  /(^|\/)compile_commands\.json$/i,
  /(^|\/)next\.config\.(?:ts|js|mjs|cjs)$/i,
  /(^|\/)project\.godot$/i,
  /\.asmdef$/i,
  /\.uproject$/i,
  /(^|\/)ProjectSettings\/ProjectVersion\.txt$/i,
];

function normalizeGraphPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function fingerprintIgnoreRules(rules: IgnoreRule[]) {
  const serialized = rules
    .map((rule) => `${rule.source}|${rule.rootRelativePath}|${rule.pattern}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(serialized).digest("hex");
}

export function buildGraphIncrementalManifest(input: {
  graph: UnifiedCodeGraph;
  kernelProfile: WorkspaceKernelProfile;
  incrementalToolVersion: string;
  ignoreRuleFingerprint: string;
  files: GraphFileFingerprint[];
}): GraphIncrementalManifest {
  return {
    schemaVersion: GRAPH_MANIFEST_SCHEMA_VERSION,
    graphSchemaVersion: input.graph.schemaVersion,
    incrementalToolVersion: input.incrementalToolVersion,
    workspaceRoot: input.graph.workspaceRoot,
    generatedAt: input.graph.generatedAt,
    primaryType: input.kernelProfile.primaryType,
    activeScannerIds: [...input.kernelProfile.activeScannerIds],
    ignoreRuleFingerprint: input.ignoreRuleFingerprint,
    files: [...input.files].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function diffFileFingerprints(
  previous: GraphFileFingerprint[],
  current: GraphFileFingerprint[]
): Pick<GraphUpdatePlan, "added" | "changed" | "deleted" | "unchanged"> {
  const previousByPath = new Map(previous.map((entry) => [normalizeGraphPath(entry.path), entry]));
  const currentByPath = new Map(current.map((entry) => [normalizeGraphPath(entry.path), entry]));
  const added: string[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  for (const [filePath, fingerprint] of currentByPath.entries()) {
    const prior = previousByPath.get(filePath);
    if (!prior) {
      added.push(filePath);
      continue;
    }
    if (prior.contentHash !== fingerprint.contentHash) {
      changed.push(filePath);
    } else {
      unchanged.push(filePath);
    }
  }

  for (const filePath of previousByPath.keys()) {
    if (!currentByPath.has(filePath)) {
      deleted.push(filePath);
    }
  }

  return {
    added: added.sort(),
    changed: changed.sort(),
    deleted: deleted.sort(),
    unchanged: unchanged.sort(),
  };
}

function isStructuralPath(filePath: string) {
  const normalized = normalizeGraphPath(filePath);
  return STRUCTURAL_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isDependencyBearingPath(filePath: string) {
  const normalized = normalizeGraphPath(filePath);
  const slashIndex = normalized.lastIndexOf("/");
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= slashIndex) return false;
  return DEPENDENCY_BEARING_EXTENSIONS.has(normalized.slice(dotIndex).toLowerCase());
}

function nodeBelongsToPath(node: UnifiedCodeGraphNode, filePath: string) {
  const normalized = normalizeGraphPath(filePath);
  const nodePath = normalizeGraphPath(node.path ?? node.label);
  if (["code_file", "config_file", "doc_file", "test"].includes(node.kind)) {
    return nodePath === normalized;
  }
  if (node.kind === "symbol") {
    return nodePath === normalized || nodePath.startsWith(`${normalized}:`);
  }
  return false;
}

function resolveNodeFilePath(node: UnifiedCodeGraphNode) {
  const nodePath = normalizeGraphPath(node.path ?? node.label);
  if (["code_file", "config_file", "doc_file", "test"].includes(node.kind)) {
    return nodePath || undefined;
  }
  if (node.kind === "symbol" && nodePath.includes("/")) {
    return nodePath;
  }
  return undefined;
}

export function collectDependencyNeighborhoodPaths(
  graph: UnifiedCodeGraph,
  touchedPaths: string[]
): string[] {
  const normalizedTouched = [...new Set(touchedPaths.map(normalizeGraphPath))];
  if (normalizedTouched.length === 0) return [];

  const touchedNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    for (const touchedPath of normalizedTouched) {
      if (nodeBelongsToPath(node, touchedPath)) {
        touchedNodeIds.add(node.id);
      }
    }
  }
  if (touchedNodeIds.size === 0) return [];

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighborPaths = new Set<string>();
  const touchedPathSet = new Set(normalizedTouched);

  for (const edge of graph.edges) {
    const sourceTouched = touchedNodeIds.has(edge.sourceNodeId);
    const targetTouched = touchedNodeIds.has(edge.targetNodeId);
    if (!sourceTouched && !targetTouched) continue;

    for (const nodeId of [edge.sourceNodeId, edge.targetNodeId]) {
      if (touchedNodeIds.has(nodeId)) continue;
      const node = nodesById.get(nodeId);
      if (!node) continue;
      const filePath = resolveNodeFilePath(node);
      if (!filePath || touchedPathSet.has(filePath) || !isDependencyBearingPath(filePath)) continue;
      neighborPaths.add(filePath);
    }
  }

  return [...neighborPaths].sort();
}

function finalizeIncrementalPlan(
  diff: Pick<GraphUpdatePlan, "added" | "changed" | "deleted" | "unchanged">,
  input: {
    cachedGraph: UnifiedCodeGraph;
    reasons?: string[];
  }
): Pick<GraphUpdatePlan, "scanPaths" | "stripPaths" | "neighborPaths" | "reasons"> {
  const touched = [...diff.added, ...diff.changed, ...diff.deleted];
  const neighborPaths = touched.some(isDependencyBearingPath)
    ? collectDependencyNeighborhoodPaths(input.cachedGraph, touched)
    : [];

  const scanPaths = [...new Set([...diff.added, ...diff.changed, ...neighborPaths])].sort();
  const stripPaths = [...new Set([...diff.added, ...diff.changed, ...diff.deleted, ...neighborPaths])].sort();
  const reasons = input.reasons ?? (
    neighborPaths.length > 0
      ? [`Safe incremental update with ${neighborPaths.length} dependency neighbor file(s).`]
      : ["Safe incremental update."]
  );

  return { scanPaths, stripPaths, neighborPaths, reasons };
}

function nodePathMatches(node: UnifiedCodeGraphNode, filePath: string) {
  const normalized = normalizeGraphPath(filePath);
  const nodePath = normalizeGraphPath(node.path ?? node.label);
  return nodePath === normalized
    || nodePath.endsWith(`/${normalized}`)
    || normalized.endsWith(`/${nodePath}`);
}

export function planGraphIncrementalUpdate(input: {
  cachedGraph?: UnifiedCodeGraph;
  manifest?: GraphIncrementalManifest;
  currentFingerprints: GraphFileFingerprint[];
  kernelProfile: WorkspaceKernelProfile;
  incrementalToolVersion: string;
  ignoreRuleFingerprint: string;
  forceFull?: boolean;
}): GraphUpdatePlan {
  const reasons: string[] = [];
  if (input.forceFull) {
    reasons.push("Forced full scan via --refresh.");
    return {
      mode: "full",
      reasons,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  if (!input.cachedGraph) {
    reasons.push("No cached graph.json found.");
    return {
      mode: "full",
      reasons,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  if (input.cachedGraph.schemaVersion !== CODE_GRAPH_SCHEMA_VERSION) {
    reasons.push(`Unsupported cached graph schema version: ${input.cachedGraph.schemaVersion}.`);
    return {
      mode: "full",
      reasons,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  if (!input.manifest) {
    reasons.push("No graph-manifest.json found.");
    return {
      mode: "full",
      reasons,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  if (input.manifest.schemaVersion !== GRAPH_MANIFEST_SCHEMA_VERSION) {
    reasons.push(`Unsupported manifest schema version: ${input.manifest.schemaVersion}.`);
    return {
      mode: "full",
      reasons,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  if (input.manifest.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION) {
    reasons.push("Cached graph schema version differs from current exporter.");
    return {
      mode: "full",
      reasons,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  if (input.manifest.incrementalToolVersion !== input.incrementalToolVersion) {
    reasons.push("Scanner/kernel incremental tool version changed.");
    return {
      mode: "full",
      reasons,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  if (input.manifest.ignoreRuleFingerprint !== input.ignoreRuleFingerprint) {
    reasons.push("Ignore rules changed since the last export.");
    return {
      mode: "full",
      reasons,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  if (input.manifest.primaryType !== input.kernelProfile.primaryType) {
    reasons.push("Workspace primary project type changed.");
    return {
      mode: "full",
      reasons,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  const previousScanners = [...input.manifest.activeScannerIds].sort().join(",");
  const currentScanners = [...input.kernelProfile.activeScannerIds].sort().join(",");
  if (previousScanners !== currentScanners) {
    reasons.push("Active scanner set changed.");
    return {
      mode: "full",
      reasons,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  const diff = diffFileFingerprints(input.manifest.files, input.currentFingerprints);
  if (diff.added.length === 0 && diff.changed.length === 0 && diff.deleted.length === 0) {
    return {
      mode: "noop",
      reasons: ["No file changes detected."],
      ...diff,
      scanPaths: [],
      stripPaths: [],
      neighborPaths: [],
    };
  }

  const touched = [...diff.added, ...diff.changed, ...diff.deleted];
  const incremental = finalizeIncrementalPlan(diff, { cachedGraph: input.cachedGraph });
  const indexedCount = Math.max(input.manifest.files.length, 1);
  const touchedRatio = touched.length / indexedCount;
  if (touched.length > GRAPH_INCREMENTAL_MAX_FILES) {
    reasons.push(`Changed file count ${touched.length} exceeds incremental limit ${GRAPH_INCREMENTAL_MAX_FILES}.`);
    return { mode: "full", reasons, ...diff, scanPaths: [], stripPaths: [], neighborPaths: [] };
  }
  if (touchedRatio > GRAPH_INCREMENTAL_MAX_RATIO) {
    reasons.push(`Changed file ratio ${Math.round(touchedRatio * 100)}% exceeds incremental limit ${Math.round(GRAPH_INCREMENTAL_MAX_RATIO * 100)}%.`);
    return { mode: "full", reasons, ...diff, scanPaths: [], stripPaths: [], neighborPaths: [] };
  }
  if (incremental.stripPaths.length > GRAPH_INCREMENTAL_MAX_STRIP_FILES) {
    reasons.push(`Dependency-expanded strip scope ${incremental.stripPaths.length} exceeds incremental limit ${GRAPH_INCREMENTAL_MAX_STRIP_FILES}.`);
    return { mode: "full", reasons, ...diff, scanPaths: [], stripPaths: [], neighborPaths: [] };
  }

  const structuralTouched = touched.filter(isStructuralPath);
  if (structuralTouched.length > 0) {
    reasons.push(`Structural workspace markers changed: ${structuralTouched.join(", ")}.`);
    return { mode: "full", reasons, ...diff, scanPaths: [], stripPaths: [], neighborPaths: [] };
  }

  return {
    mode: "incremental",
    reasons: incremental.reasons,
    ...diff,
    scanPaths: incremental.scanPaths,
    stripPaths: incremental.stripPaths,
    neighborPaths: incremental.neighborPaths,
  };
}

function shouldRemoveNodeForPaths(node: UnifiedCodeGraphNode, removedPaths: Set<string>) {
  if (!["code_file", "config_file", "doc_file", "symbol", "test"].includes(node.kind)) {
    return false;
  }
  const nodePath = normalizeGraphPath(node.path ?? node.label);
  for (const removedPath of removedPaths) {
    if (nodePath === removedPath || nodePath.startsWith(`${removedPath}/`)) {
      return true;
    }
    if (node.kind === "symbol" && removedPath && nodePath.includes(removedPath)) {
      return true;
    }
  }
  return false;
}

export function removeUnifiedGraphPaths(
  graph: UnifiedCodeGraph,
  removedPaths: string[]
): UnifiedCodeGraph {
  if (removedPaths.length === 0) return graph;
  const removed = new Set(removedPaths.map(normalizeGraphPath));
  const remainingNodes = graph.nodes.filter((node) => !shouldRemoveNodeForPaths(node, removed));
  const remainingNodeIds = new Set(remainingNodes.map((node) => node.id));
  const remainingEdges = graph.edges.filter((edge) =>
    remainingNodeIds.has(edge.sourceNodeId) && remainingNodeIds.has(edge.targetNodeId)
  );
  return {
    ...graph,
    nodes: remainingNodes,
    edges: remainingEdges,
  };
}

function mergeUniqueNodes(base: UnifiedCodeGraphNode[], incoming: UnifiedCodeGraphNode[]) {
  const byId = new Map(base.map((node) => [node.id, node]));
  for (const node of incoming) {
    byId.set(node.id, node);
  }
  return [...byId.values()];
}

function mergeUniqueEdges(base: UnifiedCodeGraphEdge[], incoming: UnifiedCodeGraphEdge[]) {
  const byId = new Map(base.map((edge) => [edge.id, edge]));
  for (const edge of incoming) {
    byId.set(edge.id, edge);
  }
  return [...byId.values()];
}

export function mergeUnifiedGraphUpdate(input: {
  base: UnifiedCodeGraph;
  partial: UnifiedCodeGraph;
  removedPaths: string[];
  generatedAt: string;
  diagnostics: string[];
}): UnifiedCodeGraph {
  const stripped = removeUnifiedGraphPaths(input.base, input.removedPaths);
  const partialNodes = partialGraphContentNodes(input.partial);
  const partialEdges = input.partial.edges.filter((edge) =>
    !edge.id.startsWith("edge:workspace:")
    && !edge.sourceNodeId.includes("workspace:")
  );

  return {
    ...stripped,
    generatedAt: input.generatedAt,
    activeScannerIds: input.partial.activeScannerIds.length > 0
      ? input.partial.activeScannerIds
      : stripped.activeScannerIds,
    diagnostics: [...new Set([...stripped.diagnostics, ...input.diagnostics])],
    nodes: mergeUniqueNodes(stripped.nodes, partialNodes),
    edges: mergeUniqueEdges(stripped.edges, partialEdges),
  };
}

function partialGraphContentNodes(graph: UnifiedCodeGraph) {
  return graph.nodes.filter((node) => !["workspace", "project", "package"].includes(node.kind));
}

export function graphFilePaths(graph: UnifiedCodeGraph) {
  return graph.nodes
    .filter((node) => ["code_file", "config_file", "doc_file"].includes(node.kind))
    .map((node) => normalizeGraphPath(node.path ?? node.label))
    .filter(Boolean)
    .sort();
}