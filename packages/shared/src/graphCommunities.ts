import type { UnifiedCodeGraph, UnifiedCodeGraphNode } from "./codeGraph.js";
import type { GraphTaskLensId } from "./graphLenses.js";

export const GRAPH_COMMUNITY_MAX_FILES = 36;
export const GRAPH_COMMUNITY_MIN_MERGE_FILES = 2;
export const GRAPH_COMMUNITY_LARGE_REPO_FILE_THRESHOLD = 20;

const GENERATED_PATH_SEGMENTS = new Set([
  "bin",
  "obj",
  "dist",
  "build",
  "out",
  "target",
  "node_modules",
  ".next",
  ".terraform",
  ".venv",
  "graphify-out",
]);

const GENERIC_COMMUNITY_TITLES = new Set([
  ".",
  "root",
  "src",
  "lib",
  "app",
  "main",
  "core",
  "common",
  "shared",
  "tests",
  "test",
  "docs",
  "scripts",
]);

const PROJECT_MARKER_EXTENSIONS = new Set([
  ".csproj",
  ".sln",
  ".props",
  ".targets",
  ".fsproj",
  ".vbproj",
]);

const PROJECT_MARKER_FILENAMES = new Set([
  "package.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "go.mod",
  "cargo.toml",
  "pyproject.toml",
  "project.clj",
  "mix.exs",
]);

const STRUCTURAL_DIRECTORY_SEGMENTS = new Set([
  "src",
  "lib",
  "app",
  "apps",
  "pkg",
  "internal",
  "cmd",
  "server",
  "client",
  "shared",
  "common",
  "core",
]);

export type ScannerCommunityKind =
  | "project"
  | "package"
  | "namespace"
  | "directory"
  | "tests"
  | "docs"
  | "generated"
  | "root";

export interface ScannerCommunityFileInput {
  filePath: string;
  fileNodeId: string;
  namespace?: string;
  projectName?: string;
  role?: string;
  extension?: string;
}

export interface ScannerCommunityDependencyEdge {
  sourceNodeId: string;
  targetNodeId: string;
  weight?: number;
}

interface ScannerCommunityDraftFile {
  filePath: string;
  fileNodeId: string;
  namespace?: string;
  projectName?: string;
}

export interface ScannerCommunityAssignment {
  key: string;
  title: string;
  communityKind: ScannerCommunityKind;
  segmentationSignal: string;
  filePaths: string[];
  fileNodeIds: string[];
  namespaces: string[];
  projectNames: string[];
  dominantFiles: string[];
  taskLens: GraphTaskLensId;
  summary: string;
  isGenerated: boolean;
}

interface ScannerCommunityDraft {
  key: string;
  title: string;
  communityKind: ScannerCommunityKind;
  segmentationSignal: string;
  files: ScannerCommunityDraftFile[];
  taskLens: GraphTaskLensId;
  isGenerated: boolean;
}

export interface GraphCommunitySummary {
  id: string;
  label: string;
  path?: string;
  kind?: string;
  fileCount: number;
  summary: string;
  topFiles: string[];
  taskLens?: GraphTaskLensId;
  segmentationSignal?: string;
}

export interface GraphCommunityContext {
  id: string;
  label: string;
  path?: string;
  summary: string;
  fileCount: number;
  taskLens?: GraphTaskLensId;
}

export interface GraphCommunityReleaseGateResult {
  ok: boolean;
  communityCount: number;
  meaningfulCommunityCount: number;
  genericCommunityCount: number;
  generatedDominanceRatio: number;
  errors: string[];
}

function normalizeCommunityPath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

function pathSegments(filePath: string) {
  return normalizeCommunityPath(filePath).split("/").filter(Boolean);
}

function pathExtension(filePath: string) {
  const basename = pathSegments(filePath).at(-1) ?? filePath;
  const dot = basename.lastIndexOf(".");
  return dot >= 0 ? basename.slice(dot).toLowerCase() : "";
}

function isProjectMarkerPath(filePath: string) {
  const segments = pathSegments(filePath);
  const basename = segments.at(-1)?.toLowerCase() ?? "";
  const extension = pathExtension(filePath);
  return PROJECT_MARKER_EXTENSIONS.has(extension) || PROJECT_MARKER_FILENAMES.has(basename);
}

function projectRootForMarker(filePath: string) {
  const segments = pathSegments(filePath);
  if (segments.length <= 1) return ".";
  return segments.slice(0, -1).join("/");
}

function projectTitleForRootMarker(filePath: string) {
  const basename = pathSegments(filePath).at(-1)?.toLowerCase() ?? "workspace";
  if (basename === "package.json") return "package";
  if (basename === "go.mod") return "go-module";
  if (basename === "pyproject.toml") return "python-project";
  if (basename === "cargo.toml") return "rust-workspace";
  if (basename.endsWith(".csproj")) return basename.replace(/\.csproj$/i, "");
  return basename.replace(/\.[^.]+$/, "") || "workspace";
}

function isGeneratedCommunityPath(filePath: string) {
  const segments = pathSegments(filePath).map((segment) => segment.toLowerCase());
  return segments.some((segment) => GENERATED_PATH_SEGMENTS.has(segment));
}

function isTestCommunityPath(filePath: string) {
  const normalized = `/${normalizeCommunityPath(filePath).toLowerCase()}/`;
  return /\/tests?\//.test(normalized)
    || /\.tests?\//i.test(normalized)
    || /\/__tests__\//.test(normalized)
    || /\/spec\//.test(normalized)
    || /\.spec\./i.test(normalized)
    || /\.test\./i.test(normalized);
}

function isDocCommunityPath(filePath: string, role?: string) {
  if (role === "doc") return true;
  const extension = pathExtension(filePath);
  return extension === ".md" || extension === ".rst" || extension === ".txt";
}

function namespaceCommunityKey(namespace: string) {
  const parts = namespace.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  return parts.slice(0, 2).join(".");
}

function dominantValue(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

function inferTaskLensForPaths(filePaths: string[], roleHints: string[]): GraphTaskLensId {
  const padded = filePaths.map((filePath) => `/${normalizeCommunityPath(filePath).toLowerCase()}/`).join(" ");
  const segments = filePaths.flatMap((filePath) => pathSegments(filePath).map((segment) => segment.toLowerCase()));
  if (roleHints.includes("doc") || segments.includes("docs") || /\.md$/.test(padded)) return "docs-handoff";
  if (isTestCommunityPath(filePaths[0] ?? "") || segments.some((segment) => ["test", "tests", "spec", "__tests__"].includes(segment))) {
    return "tests";
  }
  if (segments.some((segment) => ["terraform", "kubernetes", "k8s", "helm", "docker", "infra", "deploy"].includes(segment))) {
    return "infra";
  }
  if (segments.some((segment) => ["components", "pages", "views", "viewmodels", "ui", "frontend", "renderer", "xaml"].includes(segment))
    || /\.(tsx|jsx|vue|svelte|xaml)$/i.test(padded)) {
    return "frontend";
  }
  if (segments.some((segment) => ["migrations", "models", "repository", "repositories", "database", "db"].includes(segment))) {
    return "database";
  }
  if (segments.some((segment) => ["electron", "android", "ios", "mobile", "desktop", "wpf"].includes(segment))) {
    return "desktop-mobile";
  }
  if (segments.some((segment) => ["mcp", "provider", "llm", "openai", "anthropic", "agent"].includes(segment))) {
    return "provider-ai";
  }
  if (segments.some((segment) => ["auth", "security", "crypto"].includes(segment))) {
    return "security";
  }
  return "backend-runtime";
}

function buildProjectRoots(filePaths: string[]) {
  const projectRoots = new Map<string, string>();
  for (const filePath of filePaths) {
    if (!isProjectMarkerPath(filePath)) continue;
    const root = projectRootForMarker(filePath);
    const title = root === "."
      ? projectTitleForRootMarker(filePath)
      : root.split("/").at(-1) ?? root;
    projectRoots.set(root, title);
  }
  return projectRoots;
}

function nearestProjectRoot(filePath: string, projectRoots: Map<string, string>) {
  const normalized = normalizeCommunityPath(filePath);
  const candidates = [...projectRoots.entries()]
    .filter(([root]) => root === "." || normalized === root || normalized.startsWith(`${root}/`))
    .sort((left, right) => {
      if (left[0] === ".") return 1;
      if (right[0] === ".") return -1;
      return right[0].length - left[0].length;
    });
  const best = candidates[0];
  return best ? { root: best[0], title: best[1] } : undefined;
}

function initialCommunitySeed(
  file: ScannerCommunityFileInput,
  projectRoots: Map<string, string>
): Pick<ScannerCommunityAssignment, "key" | "title" | "communityKind" | "segmentationSignal"> {
  const segments = pathSegments(file.filePath);
  const generated = isGeneratedCommunityPath(file.filePath);

  if (generated) {
    const key = segments.slice(0, Math.min(2, segments.length)).join("/") || "generated";
    return {
      key: `generated/${key}`,
      title: key,
      communityKind: "generated",
      segmentationSignal: "generated-path",
    };
  }

  const nearestProject = nearestProjectRoot(file.filePath, projectRoots);
  if (nearestProject) {
    return {
      key: nearestProject.root,
      title: nearestProject.title,
      communityKind: "project",
      segmentationSignal: "project-marker",
    };
  }

  if (segments[0] === "packages" && segments[1]) {
    const key = `packages/${segments[1]}`;
    return {
      key,
      title: key,
      communityKind: "package",
      segmentationSignal: "package-boundary",
    };
  }

  if (file.namespace) {
    const namespaceKey = namespaceCommunityKey(file.namespace);
    return {
      key: `ns:${namespaceKey}`,
      title: namespaceKey,
      communityKind: "namespace",
      segmentationSignal: "namespace",
    };
  }

  if (file.projectName && segments.length > 0) {
    const projectSegment = segments.find((segment) => segment.toLowerCase().includes(file.projectName!.toLowerCase()));
    if (projectSegment) {
      const key = segments.slice(0, segments.indexOf(projectSegment) + 1).join("/");
      return {
        key,
        title: file.projectName,
        communityKind: "project",
        segmentationSignal: "project-name",
      };
    }
  }

  if (segments.length > 2 && STRUCTURAL_DIRECTORY_SEGMENTS.has(segments[0]!.toLowerCase())) {
    const key = `${segments[0]}/${segments[1]}`;
    return {
      key,
      title: segments[1]!,
      communityKind: "directory",
      segmentationSignal: "structural-directory",
    };
  }

  if (segments.length > 1) {
    return {
      key: segments[0]!,
      title: segments[0]!,
      communityKind: "directory",
      segmentationSignal: "top-level-directory",
    };
  }

  return {
    key: ".",
    title: "root",
    communityKind: "root",
    segmentationSignal: "workspace-root",
  };
}

function splitKeyForFile(filePath: string, parentKey: string) {
  const relative = normalizeCommunityPath(filePath);
  const parentPrefix = parentKey === "." ? "" : `${parentKey}/`;
  const remainder = parentPrefix && relative.startsWith(parentPrefix)
    ? relative.slice(parentPrefix.length)
    : relative;
  const subgroup = remainder.split("/").filter(Boolean)[0];
  if (!subgroup) return parentKey;
  return parentKey === "." ? subgroup : `${parentKey}/${subgroup}`;
}

function splitOversizedCommunities(drafts: Map<string, ScannerCommunityDraft>) {
  const oversized = [...drafts.values()].filter((draft) =>
    draft.files.length > GRAPH_COMMUNITY_MAX_FILES && draft.communityKind !== "generated"
  );
  for (const draft of oversized) {
    drafts.delete(draft.key);
    const splitBuckets = new Map<string, ScannerCommunityDraft>();
    for (const file of draft.files) {
      const splitKey = splitKeyForFile(file.filePath, draft.key);
      const existing = splitBuckets.get(splitKey) ?? {
        key: splitKey,
        title: splitKey.split("/").at(-1) ?? splitKey,
        communityKind: draft.communityKind === "namespace" ? "namespace" : "directory",
        segmentationSignal: `${draft.segmentationSignal}+split`,
        files: [],
        taskLens: draft.taskLens,
        isGenerated: draft.isGenerated,
      };
      existing.files.push(file);
      splitBuckets.set(splitKey, existing);
    }
    for (const splitDraft of splitBuckets.values()) {
      drafts.set(splitDraft.key, splitDraft);
    }
  }
}

function parentCommunityKey(key: string) {
  if (key.startsWith("generated/") || key.startsWith("ns:")) return undefined;
  const segments = key.split("/").filter(Boolean);
  if (segments.length <= 1) return undefined;
  return segments.slice(0, -1).join("/");
}

function mergeTinyCommunities(
  drafts: Map<string, ScannerCommunityDraft>,
  dependencyEdges: ScannerCommunityDependencyEdge[],
  fileCommunityByNodeId: Map<string, string>
) {
  const dependencyWeights = new Map<string, number>();
  for (const edge of dependencyEdges) {
    const sourceCommunity = fileCommunityByNodeId.get(edge.sourceNodeId);
    const targetCommunity = fileCommunityByNodeId.get(edge.targetNodeId);
    if (!sourceCommunity || !targetCommunity || sourceCommunity === targetCommunity) continue;
    const pairKey = `${sourceCommunity}|${targetCommunity}`;
    dependencyWeights.set(pairKey, (dependencyWeights.get(pairKey) ?? 0) + (edge.weight ?? 1));
  }

  const tiny = [...drafts.values()].filter((draft) =>
    draft.files.length < GRAPH_COMMUNITY_MIN_MERGE_FILES
    && draft.communityKind !== "generated"
  );
  for (const draft of tiny) {
    const parentKey = parentCommunityKey(draft.key);
    let mergeTargetKey = parentKey && drafts.has(parentKey) ? parentKey : undefined;

    if (!mergeTargetKey) {
      let bestWeight = 0;
      for (const [pairKey, weight] of dependencyWeights.entries()) {
        const [sourceKey, targetKey] = pairKey.split("|");
        const counterpart = sourceKey === draft.key ? targetKey : targetKey === draft.key ? sourceKey : undefined;
        if (!counterpart || !drafts.has(counterpart)) continue;
        if (weight > bestWeight) {
          bestWeight = weight;
          mergeTargetKey = counterpart;
        }
      }
    }

    if (!mergeTargetKey || mergeTargetKey === draft.key) continue;
    const target = drafts.get(mergeTargetKey);
    if (!target) continue;
    target.files.push(...draft.files);
    target.segmentationSignal = `${target.segmentationSignal}+merged`;
    drafts.delete(draft.key);
    for (const file of draft.files) {
      fileCommunityByNodeId.set(file.fileNodeId, mergeTargetKey);
    }
  }
}

function finalizeCommunityDraft(draft: ScannerCommunityDraft): ScannerCommunityAssignment {
  const filePaths = draft.files.map((file) => file.filePath);
  const fileNodeIds = draft.files.map((file) => file.fileNodeId);
  const namespaces = [...new Set(draft.files.map((file) => file.namespace).filter((value): value is string => Boolean(value)))];
  const projectNames = [...new Set(draft.files.map((file) => file.projectName).filter((value): value is string => Boolean(value)))];
  const dominantNamespace = dominantValue(namespaces);
  const dominantProject = dominantValue(projectNames);
  const dominantFiles = [...filePaths]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 4);
  const roleHints = filePaths.map((filePath) => (isDocCommunityPath(filePath) ? "doc" : ""));
  const taskLens = inferTaskLensForPaths(filePaths, roleHints);
  const isGenerated = filePaths.every((filePath) => isGeneratedCommunityPath(filePath));
  const isTests = filePaths.every((filePath) => isTestCommunityPath(filePath));
  const isDocs = filePaths.every((filePath) => isDocCommunityPath(filePath));

  let title = draft.title;
  let communityKind = draft.communityKind;
  if (isGenerated) {
    communityKind = "generated";
    title = "generated/build";
  } else if (isTests) {
    communityKind = "tests";
    title = dominantProject ? `${dominantProject} tests` : `${title} tests`;
  } else if (isDocs) {
    communityKind = "docs";
    title = dominantProject ? `${dominantProject} docs` : `${title} docs`;
  } else if (dominantProject && communityKind !== "package") {
    title = dominantProject;
    communityKind = communityKind === "directory" ? "project" : communityKind;
  } else if (dominantNamespace && communityKind === "namespace") {
    title = dominantNamespace;
  } else if (draft.key.startsWith("packages/")) {
    title = draft.key;
    communityKind = "package";
  } else if (draft.key !== "." && !title.includes("/")) {
    title = draft.key.split("/").at(-1) ?? title;
  }

  const summary = buildScannerCommunitySummary({
    title,
    communityKind,
    fileCount: filePaths.length,
    dominantFiles,
    dominantNamespace,
    taskLens,
    segmentationSignal: draft.segmentationSignal,
  });

  return {
    key: draft.key,
    title,
    communityKind,
    segmentationSignal: draft.segmentationSignal,
    filePaths,
    fileNodeIds,
    namespaces,
    projectNames,
    dominantFiles,
    taskLens,
    summary,
    isGenerated,
  };
}

export function buildScannerCommunitySummary(input: {
  title: string;
  communityKind: ScannerCommunityKind;
  fileCount: number;
  dominantFiles: string[];
  dominantNamespace?: string;
  taskLens: GraphTaskLensId;
  segmentationSignal: string;
}) {
  const fileLabel = `${input.fileCount} ${input.fileCount === 1 ? "file" : "files"}`;
  const entryFiles = input.dominantFiles.slice(0, 2).join(", ");
  const namespaceHint = input.dominantNamespace ? ` Namespace ${input.dominantNamespace}.` : "";
  const lensHint = ` Lens: ${input.taskLens}.`;
  const entryHint = entryFiles ? ` Start with ${entryFiles}.` : "";
  return `${input.title} (${input.communityKind}, ${fileLabel}).${namespaceHint}${entryHint}${lensHint}`;
}

export function buildScannerCommunityAssignments(input: {
  files: ScannerCommunityFileInput[];
  dependencyEdges?: ScannerCommunityDependencyEdge[];
}): ScannerCommunityAssignment[] {
  const projectRoots = buildProjectRoots(input.files.map((file) => file.filePath));
  const drafts = new Map<string, ScannerCommunityDraft>();
  const fileCommunityByNodeId = new Map<string, string>();

  for (const file of input.files) {
    const seed = initialCommunitySeed(file, projectRoots);
    const existing = drafts.get(seed.key) ?? {
      key: seed.key,
      title: seed.title,
      communityKind: seed.communityKind,
      segmentationSignal: seed.segmentationSignal,
      files: [],
      taskLens: "backend-runtime",
      isGenerated: seed.communityKind === "generated",
    };
    existing.files.push({
      filePath: file.filePath,
      fileNodeId: file.fileNodeId,
      namespace: file.namespace,
      projectName: file.projectName,
    });
    drafts.set(seed.key, existing);
    fileCommunityByNodeId.set(file.fileNodeId, seed.key);
  }

  splitOversizedCommunities(drafts);
  for (const draft of drafts.values()) {
    for (const file of draft.files) {
      fileCommunityByNodeId.set(file.fileNodeId, draft.key);
    }
  }
  mergeTinyCommunities(drafts, input.dependencyEdges ?? [], fileCommunityByNodeId);

  return [...drafts.values()]
    .map((draft) => finalizeCommunityDraft(draft))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function isGenericCommunityLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return true;
  if (GENERIC_COMMUNITY_TITLES.has(normalized)) return true;
  return normalized === "generated/build";
}

export function buildGraphCommunitySummaries(
  graph: UnifiedCodeGraph,
  limit = 12
): GraphCommunitySummary[] {
  return graph.nodes
    .filter((node) => node.kind === "community")
    .map((node) => summarizeUnifiedCommunityNode(node))
    .sort((left, right) => right.fileCount - left.fileCount || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function metadataString(node: UnifiedCodeGraphNode, key: string) {
  const value = node.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataNumber(node: UnifiedCodeGraphNode, key: string) {
  const value = node.metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

export function summarizeUnifiedCommunityNode(node: UnifiedCodeGraphNode): GraphCommunitySummary {
  const fileCount = metadataNumber(node, "scannerCommunityFileCount")
    ?? Number(metadataString(node, "scannerCommunityFileCount"))
    ?? 0;
  const topFiles = (metadataString(node, "scannerCommunityTopFiles") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const summary = metadataString(node, "scannerCommunitySummary")
    ?? `${node.label} community with ${fileCount || "unknown"} file(s).`;
  const taskLens = metadataString(node, "scannerCommunityLens") as GraphTaskLensId | undefined;
  return {
    id: node.id,
    label: metadataString(node, "scannerCommunityLabel") ?? node.label,
    path: node.path,
    kind: metadataString(node, "scannerCommunityKind"),
    fileCount,
    summary,
    topFiles,
    taskLens,
    segmentationSignal: metadataString(node, "scannerCommunitySignal"),
  };
}

interface GraphCommunityIndex {
  nodeById: Map<string, UnifiedCodeGraphNode>;
  directCommunityByNodeId: Map<string, string>;
  parentFileByNodeId: Map<string, string>;
  filePathToId: Map<string, string>;
}

function buildGraphCommunityIndex(graph: UnifiedCodeGraph): GraphCommunityIndex {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const communityNodeIds = new Set(
    graph.nodes.filter((node) => node.kind === "community").map((node) => node.id)
  );
  const directCommunityByNodeId = new Map<string, string>();
  const parentFileByNodeId = new Map<string, string>();

  for (const edge of graph.edges) {
    if (edge.kind !== "belongs_to") continue;
    const target = nodeById.get(edge.targetNodeId);
    if (!target) continue;
    if (communityNodeIds.has(edge.targetNodeId)) {
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
    if (node.path) filePathToId.set(normalizeCommunityPath(node.path), node.id);
  }

  return { nodeById, directCommunityByNodeId, parentFileByNodeId, filePathToId };
}

function resolveCommunityNodeId(index: GraphCommunityIndex, nodeId: string): string | undefined {
  const node = index.nodeById.get(nodeId);
  if (node?.kind === "community") return nodeId;

  let communityId = index.directCommunityByNodeId.get(nodeId);
  if (!communityId) {
    const parentFileId = index.parentFileByNodeId.get(nodeId);
    if (parentFileId) {
      communityId = index.directCommunityByNodeId.get(parentFileId);
    }
  }
  if (!communityId && node?.path && (node.kind === "symbol" || node.kind === "test")) {
    const fileId = index.filePathToId.get(normalizeCommunityPath(node.path));
    if (fileId) communityId = index.directCommunityByNodeId.get(fileId);
  }
  return communityId;
}

export function findGraphCommunityForNode(
  graph: UnifiedCodeGraph,
  nodeId: string
): GraphCommunityContext | undefined {
  const index = buildGraphCommunityIndex(graph);
  const communityId = resolveCommunityNodeId(index, nodeId);
  if (!communityId) return undefined;
  const communityNode = index.nodeById.get(communityId);
  if (!communityNode || communityNode.kind !== "community") return undefined;
  const summary = summarizeUnifiedCommunityNode(communityNode);
  return {
    id: communityNode.id,
    label: summary.label,
    path: summary.path,
    summary: summary.summary,
    fileCount: summary.fileCount,
    taskLens: summary.taskLens,
  };
}

export function formatCommunityHubMarkdown(summaries: GraphCommunitySummary[]) {
  if (summaries.length === 0) return ["- No community nodes detected."];
  return summaries.map((summary) => {
    const pathSuffix = summary.path ? ` (\`${summary.path}\`)` : "";
    const filesSuffix = summary.topFiles.length > 0
      ? ` — files: ${summary.topFiles.slice(0, 3).map((file) => `\`${file}\``).join(", ")}`
      : "";
    return `- **${summary.label}**${pathSuffix}: ${summary.summary}${filesSuffix}`;
  });
}

export function evaluateCommunityReleaseGates(graph: UnifiedCodeGraph): GraphCommunityReleaseGateResult {
  const communities = graph.nodes.filter((node) => node.kind === "community");
  const summaries = communities.map((node) => summarizeUnifiedCommunityNode(node));
  const meaningful = summaries.filter((summary) =>
    !isGenericCommunityLabel(summary.label)
    && summary.kind !== "generated"
    && (summary.fileCount ?? 0) > 0
  );
  const genericCount = summaries.filter((summary) => isGenericCommunityLabel(summary.label)).length;
  const sourceFileCount = graph.nodes.filter((node) =>
    node.kind === "code_file" || node.kind === "config_file" || node.kind === "doc_file"
  ).length;
  const generatedFileCount = summaries
    .filter((summary) => summary.kind === "generated")
    .reduce((sum, summary) => sum + summary.fileCount, 0);
  const generatedDominanceRatio = sourceFileCount > 0 ? generatedFileCount / sourceFileCount : 0;

  const errors: string[] = [];
  if (generatedDominanceRatio > 0.5) {
    errors.push(`Generated/build communities dominate ${Math.round(generatedDominanceRatio * 100)}% of indexed files.`);
  }
  if (sourceFileCount >= GRAPH_COMMUNITY_LARGE_REPO_FILE_THRESHOLD && meaningful.length < 2) {
    errors.push(`Large repo indexed ${sourceFileCount} files but only ${meaningful.length} meaningful communit${meaningful.length === 1 ? "y" : "ies"}.`);
  }
  if (
    sourceFileCount >= GRAPH_COMMUNITY_LARGE_REPO_FILE_THRESHOLD
    && summaries.length >= 2
    && genericCount === summaries.length
  ) {
    errors.push("All community labels are generic; expected project/package/module names.");
  }

  const readFirst = graph.nodes
    .filter((node) => node.kind === "community")
    .filter((node) => !isGenericCommunityLabel(summarizeUnifiedCommunityNode(node).label));
  const generatedReadFirst = readFirst.filter((node) =>
    summarizeUnifiedCommunityNode(node).kind === "generated"
  );
  if (readFirst.length > 0 && generatedReadFirst.length === readFirst.length) {
    errors.push("Read-first community guidance is dominated by generated/build communities.");
  }

  return {
    ok: errors.length === 0,
    communityCount: summaries.length,
    meaningfulCommunityCount: meaningful.length,
    genericCommunityCount: genericCount,
    generatedDominanceRatio,
    errors,
  };
}