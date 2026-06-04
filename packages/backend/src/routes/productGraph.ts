import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { nanoid } from "nanoid";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  ActorIdentity,
  GraphProjection,
  ProductEdgeKind,
  ProductGraphCodexPlanningPrompt,
  ProductGraphEdge,
  ProductGraphHandoffOptions,
  ProductGraphNode,
  ProductGraphProjection,
  ProductMetadataValue,
  ProductNodeKind,
  ProductNodeStatus,
  ProductSourceRef,
  ScanJobStatus,
  ScanProgressSnapshot,
} from "@openagentgraph/shared";
import {
  buildProductGraphCodexPlanningPrompt,
  buildProductGraphHandoffReport,
  buildProductGraphTrace,
} from "@openagentgraph/shared";
import { canActorPerform, permissionMessage, resolveAuth } from "../auth/actors.js";
import { getAppConfig } from "../config.js";
import {
  DEFAULT_PRODUCT_GRAPH_ID,
  appendProductEvent,
  appendProductEvents,
  getProductGraphProjection,
} from "../db/productGraphRepo.js";
import { getGraphProjection as getExecutionGraphProjection } from "../db/graphRepo.js";
import { incrementFailureMetric, incrementMetric } from "../observability/metrics.js";
import { scanWorkspaceCodebase } from "../scanner/codeScanner.js";
import {
  buildScanProgressSnapshot,
  createScanBreakerStatus,
} from "../scanner/scanProgress.js";
import {
  checkProductGraphWorkspacePaths,
  formatHandoffDataSourceForReport,
  formatHandoffWorkspaceRootForReport,
  isPathInsideRoot,
} from "../productGraphHandoffTrust.js";

const PRODUCT_NODE_KINDS = new Set<ProductNodeKind>([
  "idea",
  "feature",
  "user_story",
  "requirement",
  "acceptance_criterion",
  "open_question",
  "decision",
  "plan",
  "task",
  "contract",
  "quickstart_scenario",
  "code_file",
  "code_symbol",
  "code_community",
  "agent_run",
  "test_result",
  "evidence",
]);

const PRODUCT_NODE_STATUSES = new Set<ProductNodeStatus>([
  "proposed",
  "planned",
  "blocked",
  "in_progress",
  "completed",
  "resolved",
  "superseded",
  "archived",
]);

const PRODUCT_EDGE_KINDS = new Set<ProductEdgeKind>([
  "belongs_to",
  "satisfies",
  "implements",
  "verifies",
  "touches",
  "uses",
  "exports",
  "depends_on",
  "extends",
  "blocked_by",
  "derived_from",
  "consulted",
  "produced_by",
  "supersedes",
]);

const MAX_PRODUCT_NODE_ID_LENGTH = 128;
const MAX_PRODUCT_EDGE_ID_LENGTH = 128;
const MAX_PRODUCT_NODE_TITLE_LENGTH = 180;
const MAX_PRODUCT_NODE_SUMMARY_LENGTH = 1_000;
const MAX_PRODUCT_NODE_BODY_LENGTH = 10_000;
const MAX_PRODUCT_NODE_TAGS = 20;
const MAX_PRODUCT_NODE_TAG_LENGTH = 48;
const MAX_PRODUCT_EDGE_LABEL_LENGTH = 180;
const MAX_INTENT_BUNDLE_ITEMS = 10;
const PRODUCT_GRAPH_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const CODEX_PLAN_PROMPT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const SPEC_KIT_ARTIFACT_ROOT = ".";
const SPEC_KIT_ARTIFACTS = [
  { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file" },
  { key: "specs", relativePath: "specs", kind: "specs" },
] as const;
const SPEC_KIT_SPEC_FILE_NAMES = new Set(["spec.md", "plan.md", "tasks.md", "quickstart.md"]);
const SPEC_KIT_CONTRACTS_DIRECTORY_NAME = "contracts";
const SPEC_KIT_CONSTITUTION_PATH = ".specify/memory/constitution.md";
const SPEC_KIT_SPECS_DIRECTORY = "specs";
const SPEC_KIT_IMPORT_SPEC_FILE_NAME = "spec.md";
const SPEC_KIT_IMPORT_PLAN_FILE_NAME = "plan.md";
const SPEC_KIT_IMPORT_QUICKSTART_FILE_NAME = "quickstart.md";
const SPEC_KIT_IMPORT_TASKS_FILE_NAME = "tasks.md";
const MAX_SPEC_KIT_DETECTION_DEPTH = 8;
const MAX_SPEC_KIT_DETECTION_ENTRIES = 2_000;
const MAX_SPEC_KIT_IMPORT_DEPTH = 8;
const MAX_SPEC_KIT_IMPORT_ENTRIES = 2_000;
const MAX_SPEC_KIT_IMPORT_FILES = 25;
const MAX_SPEC_KIT_IMPORT_FILE_BYTES = 100_000;
const MAX_RUN_LINK_FILE_DIFFS = 25;
const SENSITIVE_COMMAND_ARG_PATTERN = /(api[_-]?key|authorization|bearer|password|secret|token)/i;
const PRODUCT_GRAPH_HANDOFF_FILE_NAME = "GRAPH_REPORT.md";
const CODE_FILE_EXTENSIONS = new Set([
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
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scala",
  ".swift",
  ".ts",
  ".tsx",
]);

interface CreateProductNodeRequest {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  summary?: unknown;
  body?: unknown;
  status?: unknown;
  tags?: unknown;
}

interface CreateProductEdgeRequest {
  id?: unknown;
  sourceNodeId?: unknown;
  targetNodeId?: unknown;
  kind?: unknown;
  label?: unknown;
}

interface CreateIntentBundleNodeRequest {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  body?: unknown;
  status?: unknown;
  tags?: unknown;
}

interface CreateIntentBundleRequest {
  feature?: unknown;
  userStories?: unknown;
  acceptanceCriteria?: unknown;
  tasks?: unknown;
}

interface LinkProductRunRequest {
  taskNodeId?: unknown;
}

interface AcceptCodexPlanRequest {
  title?: unknown;
  summary?: unknown;
  promptHash?: unknown;
}

interface ProductIntentBundle {
  nodes: ProductGraphNode[];
  edges: ProductGraphEdge[];
}

interface AcceptedCodexPlan {
  node: ProductGraphNode;
  edge: ProductGraphEdge;
}

interface ProductRunLink {
  node: ProductGraphNode;
  edge: ProductGraphEdge;
  evidenceNode: ProductGraphNode;
  evidenceEdge: ProductGraphEdge;
  planEdges: ProductGraphEdge[];
  fileNodes: ProductGraphNode[];
  fileEdges: ProductGraphEdge[];
}

interface ProductRunLinkPlan extends ProductRunLink {
  fileNodesToUpsert: ProductGraphNode[];
}

interface RunChangedCodeFileStat {
  path: string;
  fileDiffCount: number;
  changeTypes?: string;
}

interface SpecKitImportSummary {
  nodeCount: number;
  edgeCount: number;
  constitutionCount: number;
  specFileCount: number;
  featureCount: number;
  userStoryCount: number;
  requirementCount: number;
  acceptanceCriterionCount: number;
  openQuestionCount: number;
  contractFileCount: number;
  contractCount: number;
  planFileCount: number;
  planCount: number;
  quickstartFileCount: number;
  quickstartScenarioCount: number;
  taskFileCount: number;
  taskCount: number;
  skippedSpecFileCount: number;
  skippedContractFileCount: number;
  skippedPlanFileCount: number;
  skippedQuickstartFileCount: number;
  skippedTaskFileCount: number;
}

interface SpecKitImportPlan {
  nodes: ProductGraphNode[];
  edges: ProductGraphEdge[];
  summary: SpecKitImportSummary;
}

type SpecKitArtifactStatus = {
  key: (typeof SPEC_KIT_ARTIFACTS)[number]["key"];
  relativePath: string;
  kind: (typeof SPEC_KIT_ARTIFACTS)[number]["kind"];
  present: boolean;
};

interface SpecKitArtifactDetection {
  artifactRoot: typeof SPEC_KIT_ARTIFACT_ROOT;
  artifacts: SpecKitArtifactStatus[];
  presentArtifacts: string[];
  missingArtifacts: string[];
}

async function isReadableFile(absolutePath: string) {
  try {
    const stat = await fs.stat(absolutePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function containsSpecKitSpecArtifact(absolutePath: string): Promise<boolean> {
  const root = path.resolve(absolutePath);
  const pendingDirectories = [{ absolutePath: root, depth: 0 }];
  let visitedEntryCount = 0;

  while (pendingDirectories.length > 0) {
    const current = pendingDirectories.shift()!;
    let entries: Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visitedEntryCount += 1;
      if (visitedEntryCount > MAX_SPEC_KIT_DETECTION_ENTRIES) return false;

      const entryPath = path.join(current.absolutePath, entry.name);
      if (entry.isFile()) {
        const fileName = entry.name.toLowerCase();
        const relativeParent = normalizeProjectPath(path.relative(root, current.absolutePath));
        const parentSegments = relativeParent.split("/").filter(Boolean);
        if (SPEC_KIT_SPEC_FILE_NAMES.has(fileName) || parentSegments.includes("contracts")) {
          return true;
        }
      } else if (entry.isDirectory() && current.depth < MAX_SPEC_KIT_DETECTION_DEPTH) {
        pendingDirectories.push({ absolutePath: entryPath, depth: current.depth + 1 });
      }
    }
  }

  return false;
}

async function detectSpecKitArtifacts(workspaceRoot: string): Promise<SpecKitArtifactDetection> {
  const artifacts = await Promise.all(
    SPEC_KIT_ARTIFACTS.map(async (artifact) => ({
      ...artifact,
      present: artifact.kind === "specs"
        ? await containsSpecKitSpecArtifact(path.join(workspaceRoot, artifact.relativePath))
        : await isReadableFile(path.join(workspaceRoot, artifact.relativePath)),
    }))
  );

  return {
    artifactRoot: SPEC_KIT_ARTIFACT_ROOT,
    artifacts,
    presentArtifacts: artifacts
      .filter((artifact) => artifact.present)
      .map((artifact) => artifact.relativePath),
    missingArtifacts: artifacts
      .filter((artifact) => !artifact.present)
      .map((artifact) => artifact.relativePath),
  };
}

async function resolveProductGraphWorkspaceContext() {
  const configuredRoot = getAppConfig().workspace.root;
  if (configuredRoot) {
    return {
      root: path.resolve(configuredRoot),
      source: "configured" as const,
    };
  }

  let current = path.resolve(process.cwd());
  while (true) {
    try {
      const packageJson = JSON.parse(await fs.readFile(path.join(current, "package.json"), "utf8")) as {
        workspaces?: unknown;
      };
      if (packageJson.workspaces) {
        return {
          root: current,
          source: "inferred" as const,
        };
      }
    } catch {
      // Keep walking upward until we find the workspace package.json.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return {
        root: path.resolve(process.cwd()),
        source: "inferred" as const,
      };
    }
    current = parent;
  }
}

async function resolveProductGraphWorkspaceRoot() {
  return (await resolveProductGraphWorkspaceContext()).root;
}

async function writeProductGraphHandoffFile(workspaceRoot: string, markdown: string) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const outputPath = path.resolve(resolvedRoot, PRODUCT_GRAPH_HANDOFF_FILE_NAME);
  if (!isPathInsideRoot(resolvedRoot, outputPath)) {
    throw new Error("GRAPH_REPORT.md output path must stay inside the configured workspace root.");
  }
  await fs.writeFile(outputPath, markdown, "utf8");
  return outputPath;
}

async function productGraphHandoffFileStatus(workspaceRoot: string) {
  const outputPath = path.resolve(workspaceRoot, PRODUCT_GRAPH_HANDOFF_FILE_NAME);
  try {
    const stat = await fs.stat(outputPath);
    return {
      path: PRODUCT_GRAPH_HANDOFF_FILE_NAME,
      exists: stat.isFile(),
      ...(stat.isFile() ? { updatedAt: stat.mtime.toISOString() } : {}),
    };
  } catch {
    return {
      path: PRODUCT_GRAPH_HANDOFF_FILE_NAME,
      exists: false,
    };
  }
}

async function buildProductGraphHandoffOptions(input: {
  projection: ProductGraphProjection;
  handoffFileExists?: boolean;
}): Promise<ProductGraphHandoffOptions> {
  const workspace = await resolveProductGraphWorkspaceContext();
  const appConfig = getAppConfig();
  const currentHandoffFile = await productGraphHandoffFileStatus(workspace.root);
  return {
    workspaceRoot: formatHandoffWorkspaceRootForReport(workspace.root, appConfig.env.isProduction),
    workspaceRootSource: workspace.source,
    dataSource: formatHandoffDataSourceForReport(appConfig.database.filePath, appConfig.env.isProduction),
    workspacePathCheck: await checkProductGraphWorkspacePaths(input.projection, workspace.root),
    handoffFile: typeof input.handoffFileExists === "boolean"
      ? {
          path: currentHandoffFile.path,
          exists: input.handoffFileExists,
        }
      : currentHandoffFile,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromUnknown(value: unknown, maxLength = MAX_PRODUCT_NODE_BODY_LENGTH): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!["string", "number", "boolean"].includes(typeof value)) return undefined;

  const text = String(value).trim();
  if (!text) return undefined;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function compactMetadata(
  input: Record<string, ProductMetadataValue | undefined>
): Record<string, ProductMetadataValue> | undefined {
  const entries = Object.entries(input).filter((entry): entry is [string, ProductMetadataValue] =>
    entry[1] !== undefined
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function metadataString(
  metadata: Record<string, ProductMetadataValue> | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function stableProductId(prefix: string, rawValue: string) {
  const hash = createHash("sha1").update(rawValue).digest("hex").slice(0, 12);
  const slug = rawValue
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "item";
  return `${prefix}:${slug}:${hash}`.slice(0, MAX_PRODUCT_NODE_ID_LENGTH);
}

function normalizeProjectPath(projectPath: string) {
  return projectPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isLikelyCodePath(sourcePath: string | undefined) {
  if (!sourcePath) return false;
  return CODE_FILE_EXTENSIONS.has(path.posix.extname(normalizeProjectPath(sourcePath)).toLowerCase());
}

function specKitSourceRef(projectPath: string, line?: number): ProductSourceRef {
  return {
    kind: "spec_kit",
    label: "Spec Kit import",
    path: projectPath,
    line,
  };
}

function markdownLines(markdown: string) {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function cleanMarkdownInline(value: string, maxLength: number): string | undefined {
  const cleaned = value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return textFromUnknown(cleaned, maxLength);
}

function firstMarkdownHeading(markdown: string, fallback: string) {
  for (const line of markdownLines(markdown)) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match?.[1]) {
      return cleanMarkdownInline(match[1], MAX_PRODUCT_NODE_TITLE_LENGTH) ?? fallback;
    }
  }
  return fallback;
}

function firstMarkdownParagraph(markdown: string): string | undefined {
  const paragraph: string[] = [];
  for (const line of markdownLines(markdown)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (trimmed.startsWith("#") || /^\*\*[^*]+\*\*:/.test(trimmed)) {
      continue;
    }
    paragraph.push(trimmed);
  }
  return paragraph.length > 0
    ? cleanMarkdownInline(paragraph.join(" "), MAX_PRODUCT_NODE_SUMMARY_LENGTH)
    : undefined;
}

function specKitNode(input: {
  id: string;
  kind: ProductNodeKind;
  title: string;
  body?: string;
  summary?: string;
  status?: ProductNodeStatus;
  sourcePath: string;
  line?: number;
  metadata?: Record<string, ProductMetadataValue | undefined>;
  now: string;
}): ProductGraphNode {
  return {
    id: input.id,
    kind: input.kind,
    title: (cleanMarkdownInline(input.title, MAX_PRODUCT_NODE_TITLE_LENGTH) ?? "Spec Kit item"),
    summary: input.summary,
    body: textFromUnknown(input.body, MAX_PRODUCT_NODE_BODY_LENGTH),
    status: input.status ?? "planned",
    tags: ["spec-kit"],
    source: specKitSourceRef(input.sourcePath, input.line),
    metadata: compactMetadata({
      specKitPath: input.sourcePath,
      specKitLine: input.line,
      ...input.metadata,
    }),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function specKitEdge(input: {
  sourceNodeId: string;
  targetNodeId: string;
  kind: ProductEdgeKind;
  label: string;
  sourcePath: string;
  line?: number;
  metadata?: Record<string, ProductMetadataValue>;
  now: string;
}): ProductGraphEdge | undefined {
  if (input.sourceNodeId === input.targetNodeId) return undefined;
  return {
    id: stableProductId(
      "spec-kit:edge",
      [input.sourceNodeId, input.targetNodeId, input.kind, input.label].join("|")
    ),
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    kind: input.kind,
    trust: "extracted",
    label: input.label.slice(0, MAX_PRODUCT_EDGE_LABEL_LENGTH),
    source: specKitSourceRef(input.sourcePath, input.line),
    metadata: input.metadata,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

async function findSpecKitMarkdownFiles(workspaceRoot: string, fileName: string) {
  const specsRoot = path.join(workspaceRoot, SPEC_KIT_SPECS_DIRECTORY);
  const pendingDirectories = [{ absolutePath: specsRoot, depth: 0 }];
  const relativePaths: string[] = [];
  let visitedEntryCount = 0;
  let skippedFileCount = 0;

  while (pendingDirectories.length > 0) {
    const current = pendingDirectories.shift()!;
    let entries: Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visitedEntryCount += 1;
      if (visitedEntryCount > MAX_SPEC_KIT_IMPORT_ENTRIES) {
        return { relativePaths: relativePaths.sort(), skippedFileCount: skippedFileCount + 1 };
      }

      const entryPath = path.join(current.absolutePath, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === fileName) {
        if (relativePaths.length >= MAX_SPEC_KIT_IMPORT_FILES) {
          skippedFileCount += 1;
          continue;
        }
        relativePaths.push(normalizeProjectPath(path.relative(workspaceRoot, entryPath)));
      } else if (entry.isDirectory() && current.depth < MAX_SPEC_KIT_IMPORT_DEPTH) {
        pendingDirectories.push({ absolutePath: entryPath, depth: current.depth + 1 });
      }
    }
  }

  return { relativePaths: relativePaths.sort(), skippedFileCount };
}

async function findSpecKitContractFiles(workspaceRoot: string) {
  const specsRoot = path.join(workspaceRoot, SPEC_KIT_SPECS_DIRECTORY);
  const pendingDirectories = [{ absolutePath: specsRoot, depth: 0 }];
  const relativePaths: string[] = [];
  let visitedEntryCount = 0;
  let skippedFileCount = 0;

  while (pendingDirectories.length > 0) {
    const current = pendingDirectories.shift()!;
    let entries: Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visitedEntryCount += 1;
      if (visitedEntryCount > MAX_SPEC_KIT_IMPORT_ENTRIES) {
        return { relativePaths: relativePaths.sort(), skippedFileCount: skippedFileCount + 1 };
      }

      const entryPath = path.join(current.absolutePath, entry.name);
      if (entry.isFile()) {
        const relativeParent = normalizeProjectPath(path.relative(specsRoot, current.absolutePath));
        const parentSegments = relativeParent.split("/").filter(Boolean);
        if (!parentSegments.includes(SPEC_KIT_CONTRACTS_DIRECTORY_NAME)) continue;
        if (relativePaths.length >= MAX_SPEC_KIT_IMPORT_FILES) {
          skippedFileCount += 1;
          continue;
        }
        relativePaths.push(normalizeProjectPath(path.relative(workspaceRoot, entryPath)));
      } else if (entry.isDirectory() && current.depth < MAX_SPEC_KIT_IMPORT_DEPTH) {
        pendingDirectories.push({ absolutePath: entryPath, depth: current.depth + 1 });
      }
    }
  }

  return { relativePaths: relativePaths.sort(), skippedFileCount };
}

async function readBoundedWorkspaceMarkdown(
  workspaceRoot: string,
  relativePath: string
): Promise<{ body: string } | { error: string }> {
  const root = path.resolve(workspaceRoot);
  const absolutePath = path.resolve(root, relativePath);
  const resolvedRelativePath = path.relative(root, absolutePath);
  if (
    !resolvedRelativePath ||
    resolvedRelativePath === ".." ||
    resolvedRelativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(resolvedRelativePath)
  ) {
    return { error: `${relativePath} is outside the workspace.` };
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return { error: `${relativePath} is not a file.` };
    if (stat.size > MAX_SPEC_KIT_IMPORT_FILE_BYTES) {
      return {
        error: `${relativePath} is too large for this importer. Limit is ${MAX_SPEC_KIT_IMPORT_FILE_BYTES} bytes.`,
      };
    }
    return { body: await fs.readFile(absolutePath, "utf8") };
  } catch {
    return { error: `${relativePath} could not be read.` };
  }
}

function parseSpecKitClarifications(line: string): string[] {
  const questions: string[] = [];
  const pattern = /\[NEEDS CLARIFICATION(?::\s*([^\]]+))?\]/gi;
  for (const match of line.matchAll(pattern)) {
    questions.push(
      cleanMarkdownInline(match[1] ?? "Clarification needed", MAX_PRODUCT_NODE_TITLE_LENGTH) ?? "Clarification needed"
    );
  }
  return questions;
}

function stripSpecKitClarificationMarkers(value: string) {
  return value
    .replace(/\s*\[NEEDS CLARIFICATION(?::\s*[^\]]+)?\]\s*/gi, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSpecKitSpecNodes(input: {
  relativePath: string;
  body: string;
  now: string;
}): { nodes: ProductGraphNode[]; edges: ProductGraphEdge[] } {
  const nodesById = new Map<string, ProductGraphNode>();
  const edgesById = new Map<string, ProductGraphEdge>();
  const specSlug = normalizeProjectPath(path.posix.dirname(input.relativePath)).replace(/^specs\//, "") || "spec";
  const featureId = stableProductId("spec-kit:feature", input.relativePath);
  const featureNode = specKitNode({
    id: featureId,
    kind: "feature",
    title: firstMarkdownHeading(input.body, specSlug),
    summary: firstMarkdownParagraph(input.body),
    body: input.body,
    sourcePath: input.relativePath,
    metadata: {
      specKitArtifactType: "spec",
      specKitSlug: specSlug,
    },
    now: input.now,
  });
  nodesById.set(featureNode.id, featureNode);

  const addNode = (node: ProductGraphNode) => {
    nodesById.set(node.id, node);
    return node.id;
  };
  const addEdge = (edge: ProductGraphEdge | undefined) => {
    if (edge) edgesById.set(edge.id, edge);
  };
  const addClarifications = (line: string, lineNumber: number, blockedNodeId: string) => {
    parseSpecKitClarifications(line).forEach((question, index) => {
      const questionId = stableProductId("spec-kit:question", `${input.relativePath}:${lineNumber}:${index}`);
      addNode(specKitNode({
        id: questionId,
        kind: "open_question",
        title: question,
        body: line.trim(),
        status: "blocked",
        sourcePath: input.relativePath,
        line: lineNumber,
        metadata: {
          specKitArtifactType: "clarification",
          specKitSlug: specSlug,
        },
        now: input.now,
      }));
      addEdge(specKitEdge({
        sourceNodeId: blockedNodeId,
        targetNodeId: questionId,
        kind: "blocked_by",
        label: "Spec item needs clarification",
        sourcePath: input.relativePath,
        line: lineNumber,
        now: input.now,
      }));
    });
  };

  let currentStoryId: string | undefined;
  let currentStoryHeadingDepth = 0;
  let inAcceptanceScenarios = false;
  let storyCount = 0;
  let criterionCount = 0;

  markdownLines(input.body).forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch?.[2]) {
      const headingDepth = headingMatch[1].length;
      const headingText = headingMatch[2];
      const userStoryMatch = /^User Story\s*([A-Za-z0-9._-]+)?\s*(?:[-:]\s*)?(.+)?$/i.exec(headingText);
      if (userStoryMatch) {
        storyCount += 1;
        const rawStoryTitle = (userStoryMatch[2] ?? "").replace(/\(Priority:\s*[^)]+\)/i, "").trim();
        const storyTitle = rawStoryTitle || `User Story ${userStoryMatch[1] ?? storyCount}`;
        currentStoryId = stableProductId("spec-kit:story", `${input.relativePath}:story:${storyCount}`);
        currentStoryHeadingDepth = headingDepth;
        addNode(specKitNode({
          id: currentStoryId,
          kind: "user_story",
          title: storyTitle,
          sourcePath: input.relativePath,
          line: lineNumber,
          metadata: {
            specKitArtifactType: "user_story",
            specKitSlug: specSlug,
            specKitStoryNumber: userStoryMatch[1] ?? String(storyCount),
          },
          now: input.now,
        }));
        addEdge(specKitEdge({
          sourceNodeId: currentStoryId,
          targetNodeId: featureId,
          kind: "belongs_to",
          label: "Story belongs to feature",
          sourcePath: input.relativePath,
          line: lineNumber,
          now: input.now,
        }));
        inAcceptanceScenarios = false;
      } else {
        const isAcceptanceScenarioHeading = /acceptance scenarios?/i.test(headingText);
        if (currentStoryId && !isAcceptanceScenarioHeading && headingDepth <= currentStoryHeadingDepth) {
          currentStoryId = undefined;
          currentStoryHeadingDepth = 0;
        }
        inAcceptanceScenarios = Boolean(currentStoryId && isAcceptanceScenarioHeading);
      }
      addClarifications(line, lineNumber, currentStoryId ?? featureId);
      return;
    }

    const requirementMatch =
      /^\s*-\s+\*\*(FR-[A-Za-z0-9._-]+)\*\*:?\s*(.+)$/i.exec(line) ??
      /^\s*-\s+(FR-[A-Za-z0-9._-]+):\s*(.+)$/i.exec(line);
    if (requirementMatch?.[1] && requirementMatch[2]) {
      const requirementId = stableProductId("spec-kit:requirement", `${input.relativePath}:${requirementMatch[1]}`);
      const requirementText = cleanMarkdownInline(
        stripSpecKitClarificationMarkers(requirementMatch[2]),
        MAX_PRODUCT_NODE_BODY_LENGTH
      ) ?? "Clarification needed";
      addNode(specKitNode({
        id: requirementId,
        kind: "requirement",
        title: `${requirementMatch[1]}: ${requirementText}`,
        body: requirementText,
        sourcePath: input.relativePath,
        line: lineNumber,
        metadata: {
          specKitArtifactType: "requirement",
          specKitSlug: specSlug,
          specKitRequirementId: requirementMatch[1],
        },
        now: input.now,
      }));
      addEdge(specKitEdge({
        sourceNodeId: requirementId,
        targetNodeId: featureId,
        kind: "satisfies",
        label: "Requirement satisfies feature",
        sourcePath: input.relativePath,
        line: lineNumber,
        now: input.now,
      }));
      addClarifications(line, lineNumber, requirementId);
      return;
    }

    if (inAcceptanceScenarios && currentStoryId) {
      const criterionMatch = /^\s*(?:\d+\.|-)\s+(.+)$/.exec(line);
      if (criterionMatch?.[1]) {
        criterionCount += 1;
        const criterionId = stableProductId(
          "spec-kit:criterion",
          `${input.relativePath}:criterion:${criterionCount}`
        );
        const criterionText = cleanMarkdownInline(criterionMatch[1], MAX_PRODUCT_NODE_BODY_LENGTH) ?? criterionMatch[1];
        addNode(specKitNode({
          id: criterionId,
          kind: "acceptance_criterion",
          title: criterionText,
          body: criterionText,
          sourcePath: input.relativePath,
          line: lineNumber,
          metadata: {
            specKitArtifactType: "acceptance_criterion",
            specKitSlug: specSlug,
          },
          now: input.now,
        }));
        addEdge(specKitEdge({
          sourceNodeId: criterionId,
          targetNodeId: featureId,
          kind: "satisfies",
          label: "Criterion satisfies feature",
          sourcePath: input.relativePath,
          line: lineNumber,
          now: input.now,
        }));
        addEdge(specKitEdge({
          sourceNodeId: criterionId,
          targetNodeId: currentStoryId,
          kind: "belongs_to",
          label: "Criterion belongs to story",
          sourcePath: input.relativePath,
          line: lineNumber,
          now: input.now,
        }));
        addClarifications(line, lineNumber, criterionId);
        return;
      }
    }

    addClarifications(line, lineNumber, currentStoryId ?? featureId);
  });

  return {
    nodes: Array.from(nodesById.values()).sort((left, right) => left.id.localeCompare(right.id)),
    edges: Array.from(edgesById.values()).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function buildSpecKitPlanNode(input: {
  relativePath: string;
  body: string;
  featureNodeId: string;
  now: string;
}): { node: ProductGraphNode; edge?: ProductGraphEdge } {
  const specSlug = normalizeProjectPath(path.posix.dirname(input.relativePath)).replace(/^specs\//, "") || "spec";
  const planNodeId = stableProductId("spec-kit:plan", input.relativePath);
  return {
    node: specKitNode({
      id: planNodeId,
      kind: "plan",
      title: firstMarkdownHeading(input.body, `${specSlug} plan`),
      summary: firstMarkdownParagraph(input.body),
      body: input.body,
      sourcePath: input.relativePath,
      metadata: {
        specKitArtifactType: "plan",
        specKitSlug: specSlug,
      },
      now: input.now,
    }),
    edge: specKitEdge({
      sourceNodeId: planNodeId,
      targetNodeId: input.featureNodeId,
      kind: "derived_from",
      label: "Plan derives from feature",
      sourcePath: input.relativePath,
      now: input.now,
    }),
  };
}

function buildSpecKitQuickstartNode(input: {
  relativePath: string;
  body: string;
  featureNodeId: string;
  now: string;
}): { node: ProductGraphNode; edge?: ProductGraphEdge } {
  const specSlug = normalizeProjectPath(path.posix.dirname(input.relativePath)).replace(/^specs\//, "") || "spec";
  const quickstartNodeId = stableProductId("spec-kit:quickstart", input.relativePath);
  return {
    node: specKitNode({
      id: quickstartNodeId,
      kind: "quickstart_scenario",
      title: firstMarkdownHeading(input.body, `${specSlug} quickstart`),
      summary: firstMarkdownParagraph(input.body),
      body: input.body,
      sourcePath: input.relativePath,
      metadata: {
        specKitArtifactType: "quickstart",
        specKitSlug: specSlug,
      },
      now: input.now,
    }),
    edge: specKitEdge({
      sourceNodeId: quickstartNodeId,
      targetNodeId: input.featureNodeId,
      kind: "verifies",
      label: "Quickstart verifies feature",
      sourcePath: input.relativePath,
      now: input.now,
    }),
  };
}

function specKitContractSpecDirectory(relativePath: string) {
  const normalizedPath = normalizeProjectPath(relativePath);
  const contractDirectoryMarker = `/${SPEC_KIT_CONTRACTS_DIRECTORY_NAME}/`;
  const markerIndex = normalizedPath.indexOf(contractDirectoryMarker);
  if (markerIndex < 0) return normalizeProjectPath(path.posix.dirname(normalizedPath));
  return normalizedPath.slice(0, markerIndex);
}

function specKitContractName(relativePath: string) {
  const normalizedPath = normalizeProjectPath(relativePath);
  const contractDirectoryMarker = `/${SPEC_KIT_CONTRACTS_DIRECTORY_NAME}/`;
  const markerIndex = normalizedPath.indexOf(contractDirectoryMarker);
  return markerIndex >= 0
    ? normalizedPath.slice(markerIndex + contractDirectoryMarker.length)
    : path.posix.basename(normalizedPath);
}

function buildSpecKitContractNode(input: {
  relativePath: string;
  body: string;
  featureNodeId: string;
  now: string;
}): { node: ProductGraphNode; edge?: ProductGraphEdge } {
  const specDirectory = specKitContractSpecDirectory(input.relativePath);
  const specSlug = specDirectory.replace(/^specs\//, "") || "spec";
  const contractName = specKitContractName(input.relativePath);
  const contractNodeId = stableProductId("spec-kit:contract", input.relativePath);
  return {
    node: specKitNode({
      id: contractNodeId,
      kind: "contract",
      title: firstMarkdownHeading(input.body, contractName),
      summary: firstMarkdownParagraph(input.body),
      body: input.body,
      sourcePath: input.relativePath,
      metadata: {
        specKitArtifactType: "contract",
        specKitSlug: specSlug,
        specKitContractName: contractName,
      },
      now: input.now,
    }),
    edge: specKitEdge({
      sourceNodeId: contractNodeId,
      targetNodeId: input.featureNodeId,
      kind: "satisfies",
      label: "Contract satisfies feature",
      sourcePath: input.relativePath,
      now: input.now,
    }),
  };
}

function parseSpecKitTaskLine(line: string): {
  taskId?: string;
  title: string;
  completed: boolean;
  parallel: boolean;
  storyRefs?: string;
} | undefined {
  const match = /^\s*-\s+\[(?<state>[ xX])\]\s+(?<body>.+)$/.exec(line);
  if (!match?.groups?.body) return undefined;

  let body = match.groups.body.trim();
  const taskIdMatch = /^(?<taskId>T\d+[A-Za-z0-9._-]*)\s+(?<title>.+)$/.exec(body);
  const taskId = taskIdMatch?.groups?.taskId;
  if (taskIdMatch?.groups?.title) {
    body = taskIdMatch.groups.title.trim();
  }
  const storyRefs: string[] = [];
  let parallel = false;
  while (body.startsWith("[")) {
    const markerMatch = /^\[(?<marker>[^\]]+)\]\s*(?<rest>.*)$/.exec(body);
    if (!markerMatch?.groups?.marker) break;
    const marker = markerMatch.groups.marker.trim();
    if (/^P$/i.test(marker)) {
      parallel = true;
    } else if (/^US[A-Za-z0-9._-]+$/i.test(marker) && !storyRefs.includes(marker)) {
      storyRefs.push(marker);
    } else {
      break;
    }
    body = markerMatch.groups.rest.trim();
  }
  const title = cleanMarkdownInline(body, MAX_PRODUCT_NODE_TITLE_LENGTH);
  if (!title) return undefined;

  return {
    taskId,
    title,
    completed: match.groups.state.toLowerCase() === "x",
    parallel,
    storyRefs: storyRefs.length > 0 ? storyRefs.join(",") : undefined,
  };
}

function buildSpecKitTaskNodes(input: {
  relativePath: string;
  body: string;
  featureNodeId: string;
  now: string;
}): { nodes: ProductGraphNode[]; edges: ProductGraphEdge[] } {
  const nodesById = new Map<string, ProductGraphNode>();
  const edgesById = new Map<string, ProductGraphEdge>();
  const specSlug = normalizeProjectPath(path.posix.dirname(input.relativePath)).replace(/^specs\//, "") || "spec";
  let currentSection: string | undefined;

  for (const [index, line] of markdownLines(input.body).entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch?.[2]) {
      currentSection = cleanMarkdownInline(headingMatch[2], MAX_PRODUCT_NODE_TITLE_LENGTH);
      continue;
    }

    const task = parseSpecKitTaskLine(line);
    if (!task) continue;

    const taskNodeId = stableProductId(
      "spec-kit:task",
      `${input.relativePath}:${task.taskId ?? `line-${lineNumber}`}`
    );
    nodesById.set(taskNodeId, specKitNode({
      id: taskNodeId,
      kind: "task",
      title: task.title,
      body: trimmed,
      status: task.completed ? "completed" : "planned",
      sourcePath: input.relativePath,
      line: lineNumber,
      metadata: {
        specKitArtifactType: "task",
        specKitSlug: specSlug,
        specKitTaskId: task.taskId,
        specKitTaskSection: currentSection,
        specKitTaskCompleted: task.completed,
        specKitTaskParallel: task.parallel,
        specKitTaskStoryRefs: task.storyRefs,
      },
      now: input.now,
    }));
    const edge = specKitEdge({
      sourceNodeId: taskNodeId,
      targetNodeId: input.featureNodeId,
      kind: "implements",
      label: "Task implements feature",
      sourcePath: input.relativePath,
      line: lineNumber,
      now: input.now,
    });
    if (edge) edgesById.set(edge.id, edge);
  }

  return {
    nodes: Array.from(nodesById.values()).sort((left, right) => left.id.localeCompare(right.id)),
    edges: Array.from(edgesById.values()).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

async function buildSpecKitImportPlan(workspaceRoot: string): Promise<SpecKitImportPlan | { error: string }> {
  const now = new Date().toISOString();
  const nodesById = new Map<string, ProductGraphNode>();
  const edgesById = new Map<string, ProductGraphEdge>();
  let skippedSpecFileCount = 0;
  let skippedContractFileCount = 0;
  let skippedPlanFileCount = 0;
  let skippedQuickstartFileCount = 0;
  let skippedTaskFileCount = 0;
  let importedContractFileCount = 0;
  let importedPlanFileCount = 0;
  let importedQuickstartFileCount = 0;
  let importedTaskFileCount = 0;

  const addNode = (node: ProductGraphNode) => {
    nodesById.set(node.id, node);
  };

  const constitutionPath = path.join(workspaceRoot, SPEC_KIT_CONSTITUTION_PATH);
  if (await isReadableFile(constitutionPath)) {
    const constitutionRead = await readBoundedWorkspaceMarkdown(workspaceRoot, SPEC_KIT_CONSTITUTION_PATH);
    if ("error" in constitutionRead) {
      return { error: constitutionRead.error };
    }
    addNode(specKitNode({
      id: stableProductId("spec-kit:constitution", SPEC_KIT_CONSTITUTION_PATH),
      kind: "requirement",
      title: firstMarkdownHeading(constitutionRead.body, "Spec Kit constitution"),
      summary: firstMarkdownParagraph(constitutionRead.body),
      body: constitutionRead.body,
      sourcePath: SPEC_KIT_CONSTITUTION_PATH,
      metadata: {
        specKitArtifactType: "constitution",
      },
      now,
    }));
  }

  const specFiles = await findSpecKitMarkdownFiles(workspaceRoot, SPEC_KIT_IMPORT_SPEC_FILE_NAME);
  skippedSpecFileCount += specFiles.skippedFileCount;
  const featureNodeIdsBySpecDirectory = new Map<string, string>();
  for (const relativePath of specFiles.relativePaths) {
    const specRead = await readBoundedWorkspaceMarkdown(workspaceRoot, relativePath);
    if ("error" in specRead) {
      return { error: specRead.error };
    }
    const specPlan = buildSpecKitSpecNodes({ relativePath, body: specRead.body, now });
    for (const node of specPlan.nodes) addNode(node);
    for (const edge of specPlan.edges) edgesById.set(edge.id, edge);
    featureNodeIdsBySpecDirectory.set(
      normalizeProjectPath(path.posix.dirname(relativePath)),
      stableProductId("spec-kit:feature", relativePath)
    );
  }

  const contractFiles = await findSpecKitContractFiles(workspaceRoot);
  for (const relativePath of contractFiles.relativePaths) {
    const featureNodeId = featureNodeIdsBySpecDirectory.get(specKitContractSpecDirectory(relativePath));
    if (!featureNodeId) {
      skippedContractFileCount += 1;
      continue;
    }
    const contractRead = await readBoundedWorkspaceMarkdown(workspaceRoot, relativePath);
    if ("error" in contractRead) {
      return { error: contractRead.error };
    }
    importedContractFileCount += 1;
    const contractImport = buildSpecKitContractNode({ relativePath, body: contractRead.body, featureNodeId, now });
    addNode(contractImport.node);
    if (contractImport.edge) edgesById.set(contractImport.edge.id, contractImport.edge);
  }
  skippedContractFileCount += contractFiles.skippedFileCount;

  const planFiles = await findSpecKitMarkdownFiles(workspaceRoot, SPEC_KIT_IMPORT_PLAN_FILE_NAME);
  for (const relativePath of planFiles.relativePaths) {
    const featureNodeId = featureNodeIdsBySpecDirectory.get(normalizeProjectPath(path.posix.dirname(relativePath)));
    if (!featureNodeId) {
      skippedPlanFileCount += 1;
      continue;
    }
    const planRead = await readBoundedWorkspaceMarkdown(workspaceRoot, relativePath);
    if ("error" in planRead) {
      return { error: planRead.error };
    }
    importedPlanFileCount += 1;
    const planImport = buildSpecKitPlanNode({ relativePath, body: planRead.body, featureNodeId, now });
    addNode(planImport.node);
    if (planImport.edge) edgesById.set(planImport.edge.id, planImport.edge);
  }
  skippedPlanFileCount += planFiles.skippedFileCount;

  const quickstartFiles = await findSpecKitMarkdownFiles(workspaceRoot, SPEC_KIT_IMPORT_QUICKSTART_FILE_NAME);
  for (const relativePath of quickstartFiles.relativePaths) {
    const featureNodeId = featureNodeIdsBySpecDirectory.get(normalizeProjectPath(path.posix.dirname(relativePath)));
    if (!featureNodeId) {
      skippedQuickstartFileCount += 1;
      continue;
    }
    const quickstartRead = await readBoundedWorkspaceMarkdown(workspaceRoot, relativePath);
    if ("error" in quickstartRead) {
      return { error: quickstartRead.error };
    }
    importedQuickstartFileCount += 1;
    const quickstartImport = buildSpecKitQuickstartNode({
      relativePath,
      body: quickstartRead.body,
      featureNodeId,
      now,
    });
    addNode(quickstartImport.node);
    if (quickstartImport.edge) edgesById.set(quickstartImport.edge.id, quickstartImport.edge);
  }
  skippedQuickstartFileCount += quickstartFiles.skippedFileCount;

  const taskFiles = await findSpecKitMarkdownFiles(workspaceRoot, SPEC_KIT_IMPORT_TASKS_FILE_NAME);
  for (const relativePath of taskFiles.relativePaths) {
    const featureNodeId = featureNodeIdsBySpecDirectory.get(normalizeProjectPath(path.posix.dirname(relativePath)));
    if (!featureNodeId) {
      skippedTaskFileCount += 1;
      continue;
    }
    const taskRead = await readBoundedWorkspaceMarkdown(workspaceRoot, relativePath);
    if ("error" in taskRead) {
      return { error: taskRead.error };
    }
    importedTaskFileCount += 1;
    const taskPlan = buildSpecKitTaskNodes({ relativePath, body: taskRead.body, featureNodeId, now });
    for (const node of taskPlan.nodes) addNode(node);
    for (const edge of taskPlan.edges) edgesById.set(edge.id, edge);
  }
  skippedTaskFileCount += taskFiles.skippedFileCount;

  const nodes = Array.from(nodesById.values()).sort((left, right) => left.id.localeCompare(right.id));
  const edges = Array.from(edgesById.values()).sort((left, right) => left.id.localeCompare(right.id));
  if (nodes.length === 0) {
    return { error: "Spec Kit artifacts did not contain an importable constitution.md or spec.md file." };
  }

  const countNodes = (kind: ProductNodeKind) => nodes.filter((node) => node.kind === kind).length;
  const countSpecKitArtifacts = (artifactType: string) =>
    nodes.filter((node) => node.metadata?.specKitArtifactType === artifactType).length;
  return {
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      constitutionCount: countSpecKitArtifacts("constitution"),
      specFileCount: specFiles.relativePaths.length,
      featureCount: countNodes("feature"),
      userStoryCount: countNodes("user_story"),
      requirementCount: countSpecKitArtifacts("requirement"),
      acceptanceCriterionCount: countNodes("acceptance_criterion"),
      openQuestionCount: countNodes("open_question"),
      contractFileCount: importedContractFileCount,
      contractCount: countNodes("contract"),
      planFileCount: importedPlanFileCount,
      planCount: countNodes("plan"),
      quickstartFileCount: importedQuickstartFileCount,
      quickstartScenarioCount: countNodes("quickstart_scenario"),
      taskFileCount: importedTaskFileCount,
      taskCount: countNodes("task"),
      skippedSpecFileCount,
      skippedContractFileCount,
      skippedPlanFileCount,
      skippedQuickstartFileCount,
      skippedTaskFileCount,
    },
  };
}

function trimOptionalText(
  value: unknown,
  fieldName: string,
  maxLength: number
): { value?: string; error?: string } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "string") {
    return { error: `${fieldName} must be a string.` };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.length > maxLength) {
    return { error: `${fieldName} must be ${maxLength} characters or fewer.` };
  }
  return { value: trimmed };
}

function trimRequiredText(
  value: unknown,
  fieldName: string,
  maxLength: number
): { value?: string; error?: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { error: `${fieldName} is required.` };
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    return { error: `${fieldName} must be ${maxLength} characters or fewer.` };
  }
  return { value: trimmed };
}

function trimOptionalId(
  value: unknown,
  fieldName: string,
  maxLength: number
): { value?: string; error?: string } {
  const parsed = trimOptionalText(value, fieldName, maxLength);
  if (parsed.error || !parsed.value) {
    return parsed;
  }
  if (!PRODUCT_GRAPH_ID_PATTERN.test(parsed.value)) {
    return { error: `${fieldName} may only contain letters, numbers, dots, underscores, colons, and dashes.` };
  }
  return parsed;
}

function trimRequiredId(
  value: unknown,
  fieldName: string,
  maxLength: number
): { value?: string; error?: string } {
  const parsed = trimRequiredText(value, fieldName, maxLength);
  if (parsed.error || !parsed.value) {
    return parsed;
  }
  if (!PRODUCT_GRAPH_ID_PATTERN.test(parsed.value)) {
    return { error: `${fieldName} may only contain letters, numbers, dots, underscores, colons, and dashes.` };
  }
  return parsed;
}

function parseProductNodeTags(value: unknown): { tags?: string[]; error?: string } {
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value)) {
    return { error: "tags must be an array of strings." };
  }
  if (value.length > MAX_PRODUCT_NODE_TAGS) {
    return { error: `tags must contain ${MAX_PRODUCT_NODE_TAGS} items or fewer.` };
  }

  const tags: string[] = [];
  for (const tag of value) {
    if (typeof tag !== "string") {
      return { error: "tags must be strings." };
    }
    const trimmed = tag.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_PRODUCT_NODE_TAG_LENGTH) {
      return { error: `tags must be ${MAX_PRODUCT_NODE_TAG_LENGTH} characters or fewer.` };
    }
    if (!tags.includes(trimmed)) {
      tags.push(trimmed);
    }
  }

  return { tags: tags.length > 0 ? tags : undefined };
}

function authErrorAction(status: ReturnType<typeof resolveAuth>["status"]) {
  return status === "invalid" || status === "expired" ? "auth_invalid" : "auth_required";
}

function requireProductGraphWriteActor(
  req: FastifyRequest,
  reply: FastifyReply
) {
  const resolution = resolveAuth(req);
  if (!resolution.actor) {
    incrementFailureMetric(
      resolution.status === "invalid" || resolution.status === "expired" ? "auth_invalid" : "auth_missing",
      "routes.productGraph",
      "hard"
    );
    incrementMetric(
      "openagentgraph_permission_denials_total",
      "Permission denials for protected actions.",
      { action: authErrorAction(resolution.status) }
    );
    reply.status(401).send({ error: resolution.message });
    return undefined;
  }

  if (!canActorPerform(resolution.actor, "manage_product_graph")) {
    incrementFailureMetric("permission_denied", "routes.productGraph", "hard");
    incrementMetric(
      "openagentgraph_permission_denials_total",
      "Permission denials for protected actions.",
      { action: "manage_product_graph" }
    );
    reply.status(403).send({ error: permissionMessage("manage_product_graph") });
    return undefined;
  }

  return resolution.actor;
}

function buildProductNode(input: CreateProductNodeRequest): ProductGraphNode | { error: string } {
  const kind = typeof input.kind === "string" ? input.kind : undefined;
  const status = input.status === undefined
    ? "planned"
    : typeof input.status === "string"
      ? input.status
      : undefined;

  if (!kind || !PRODUCT_NODE_KINDS.has(kind as ProductNodeKind)) {
    return { error: "kind is required and must be a supported product node kind." };
  }
  const title = trimRequiredText(input.title, "title", MAX_PRODUCT_NODE_TITLE_LENGTH);
  if (title.error || !title.value) {
    return { error: title.error ?? "title is required." };
  }
  if (!status || !PRODUCT_NODE_STATUSES.has(status as ProductNodeStatus)) {
    return { error: "status must be a supported product node status." };
  }

  const id = trimOptionalId(input.id, "id", MAX_PRODUCT_NODE_ID_LENGTH);
  if (id.error) {
    return { error: id.error };
  }

  const summary = trimOptionalText(input.summary, "summary", MAX_PRODUCT_NODE_SUMMARY_LENGTH);
  if (summary.error) {
    return { error: summary.error };
  }

  const body = trimOptionalText(input.body, "body", MAX_PRODUCT_NODE_BODY_LENGTH);
  if (body.error) {
    return { error: body.error };
  }

  const tags = parseProductNodeTags(input.tags);
  if (tags.error) {
    return { error: tags.error };
  }

  const now = new Date().toISOString();
  return {
    id: id.value ?? nanoid(),
    kind: kind as ProductNodeKind,
    title: title.value,
    summary: summary.value,
    body: body.value,
    status: status as ProductNodeStatus,
    tags: tags.tags,
    source: {
      kind: "manual",
      label: "Manual entry",
    },
    createdAt: now,
    updatedAt: now,
  };
}

function buildProductEdge(input: CreateProductEdgeRequest): ProductGraphEdge | { error: string } {
  const kind = typeof input.kind === "string" ? input.kind : undefined;

  if (!kind || !PRODUCT_EDGE_KINDS.has(kind as ProductEdgeKind)) {
    return { error: "kind is required and must be a supported product edge kind." };
  }

  const sourceNodeId = trimRequiredId(input.sourceNodeId, "sourceNodeId", MAX_PRODUCT_NODE_ID_LENGTH);
  if (sourceNodeId.error || !sourceNodeId.value) {
    return { error: sourceNodeId.error ?? "sourceNodeId is required." };
  }

  const targetNodeId = trimRequiredId(input.targetNodeId, "targetNodeId", MAX_PRODUCT_NODE_ID_LENGTH);
  if (targetNodeId.error || !targetNodeId.value) {
    return { error: targetNodeId.error ?? "targetNodeId is required." };
  }

  if (sourceNodeId.value === targetNodeId.value) {
    return { error: "sourceNodeId and targetNodeId must be different." };
  }

  const id = trimOptionalId(input.id, "id", MAX_PRODUCT_EDGE_ID_LENGTH);
  if (id.error) {
    return { error: id.error };
  }

  const label = trimOptionalText(input.label, "label", MAX_PRODUCT_EDGE_LABEL_LENGTH);
  if (label.error) {
    return { error: label.error };
  }

  const now = new Date().toISOString();
  return {
    id: id.value ?? nanoid(),
    sourceNodeId: sourceNodeId.value,
    targetNodeId: targetNodeId.value,
    kind: kind as ProductEdgeKind,
    trust: "manual",
    label: label.value,
    source: {
      kind: "manual",
      label: "Manual entry",
    },
    createdAt: now,
    updatedAt: now,
  };
}

function readBundleNodeInput(
  value: unknown,
  fieldName: string
): CreateIntentBundleNodeRequest | { error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: `${fieldName} is required.` };
  }
  return value as CreateIntentBundleNodeRequest;
}

function buildIntentBundleNode(
  value: unknown,
  fieldName: string,
  kind: ProductNodeKind
): ProductGraphNode | { error: string } {
  const input = readBundleNodeInput(value, fieldName);
  if ("error" in input) return input;

  const node = buildProductNode({
    ...input,
    kind,
  });
  if ("error" in node) {
    return { error: `${fieldName}: ${node.error}` };
  }

  return {
    ...node,
    source: {
      kind: "manual",
      label: "Manual intent bundle",
    },
  };
}

function buildIntentBundleNodes(
  value: unknown,
  fieldName: string,
  kind: ProductNodeKind
): ProductGraphNode[] | { error: string } {
  if (!Array.isArray(value)) {
    return { error: `${fieldName} must be an array.` };
  }
  if (value.length < 1) {
    return { error: `${fieldName} must contain at least 1 item.` };
  }
  if (value.length > MAX_INTENT_BUNDLE_ITEMS) {
    return { error: `${fieldName} must contain ${MAX_INTENT_BUNDLE_ITEMS} items or fewer.` };
  }

  const nodes: ProductGraphNode[] = [];
  for (const [index, item] of value.entries()) {
    const node = buildIntentBundleNode(item, `${fieldName}[${index}]`, kind);
    if ("error" in node) return node;
    nodes.push(node);
  }
  return nodes;
}

function buildIntentBundleEdge(
  sourceNodeId: string,
  targetNodeId: string,
  kind: ProductEdgeKind,
  label: string
): ProductGraphEdge | { error: string } {
  const edge = buildProductEdge({
    sourceNodeId,
    targetNodeId,
    kind,
    label,
  });
  if ("error" in edge) return edge;

  return {
    ...edge,
    source: {
      kind: "manual",
      label: "Manual intent bundle",
    },
  };
}

function findDuplicateNodeId(nodes: ProductGraphNode[]): string | undefined {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) return node.id;
    seen.add(node.id);
  }
  return undefined;
}

function buildProductIntentBundle(input: CreateIntentBundleRequest): ProductIntentBundle | { error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { error: "payload must be an object." };
  }

  const feature = buildIntentBundleNode(input.feature, "feature", "feature");
  if ("error" in feature) return feature;

  const userStories = buildIntentBundleNodes(input.userStories, "userStories", "user_story");
  if ("error" in userStories) return userStories;

  const acceptanceCriteria = buildIntentBundleNodes(
    input.acceptanceCriteria,
    "acceptanceCriteria",
    "acceptance_criterion"
  );
  if ("error" in acceptanceCriteria) return acceptanceCriteria;

  const tasks = buildIntentBundleNodes(input.tasks, "tasks", "task");
  if ("error" in tasks) return tasks;

  const nodes = [feature, ...userStories, ...acceptanceCriteria, ...tasks];
  const duplicateNodeId = findDuplicateNodeId(nodes);
  if (duplicateNodeId) {
    return { error: `node ids must be unique within an intent bundle. Duplicate id: ${duplicateNodeId}` };
  }

  const edges: ProductGraphEdge[] = [];
  for (const story of userStories) {
    const edge = buildIntentBundleEdge(story.id, feature.id, "belongs_to", "Story belongs to feature");
    if ("error" in edge) return edge;
    edges.push(edge);
  }
  for (const criterion of acceptanceCriteria) {
    const edge = buildIntentBundleEdge(criterion.id, feature.id, "satisfies", "Criterion satisfies feature");
    if ("error" in edge) return edge;
    edges.push(edge);
  }
  for (const task of tasks) {
    const edge = buildIntentBundleEdge(task.id, feature.id, "implements", "Task implements feature");
    if ("error" in edge) return edge;
    edges.push(edge);
  }

  return { nodes, edges };
}

function productStatusForRunStatus(status: GraphProjection["graph"]["status"]): ProductNodeStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "running":
      return "in_progress";
    case "failed":
    case "blocked":
    case "stopped":
      return "blocked";
    case "idle":
    default:
      return "planned";
  }
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function safeEvidencePath(filePath: string) {
  const normalizedPath = textFromUnknown(normalizeProjectPath(filePath), MAX_PRODUCT_EDGE_LABEL_LENGTH);
  if (!normalizedPath) return undefined;
  if (path.isAbsolute(filePath) || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return path.posix.basename(normalizedPath);
  }
  return normalizedPath;
}

function safeRunCodeFilePath(filePath: string) {
  if (path.isAbsolute(filePath) || /^[A-Za-z]:[\\/]/.test(filePath)) return undefined;

  const normalizedPath = textFromUnknown(normalizeProjectPath(filePath), MAX_PRODUCT_NODE_BODY_LENGTH);
  if (!normalizedPath) return undefined;
  if (normalizedPath.split("/").some((part) => part === "..")) return undefined;
  if (!isLikelyCodePath(normalizedPath)) return undefined;

  return normalizedPath;
}

function commandLabel(command: string, args: string[]) {
  let redactNextArg = false;
  const safeArgs = args
    .map((arg) => {
      const value = arg.trim();
      if (!value) return "";
      if (redactNextArg) {
        redactNextArg = false;
        return "[redacted]";
      }
      if (!SENSITIVE_COMMAND_ARG_PATTERN.test(value)) return value;
      if (/^--?[^=]+$/.test(value)) {
        redactNextArg = true;
        return value;
      }
      return value.replace(/=.*/, "=[redacted]");
    })
    .filter(Boolean);
  return [command, ...safeArgs].join(" ").trim();
}

function isTestCommand(label: string) {
  return /\b(test|vitest|jest|playwright|pytest|phpunit)\b/i.test(label);
}

function productNodeFromProjectionNode(node: ProductGraphProjection["nodes"][number]): ProductGraphNode {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    summary: node.summary,
    body: node.body,
    status: node.status,
    tags: node.tags,
    source: node.source,
    metadata: node.metadata,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function codeFilePathForNode(node: ProductGraphNode) {
  if (node.kind !== "code_file") return undefined;

  const titlePath = node.title.includes("/") || node.title.includes("\\") ? node.title : undefined;
  const candidates = [
    node.source?.path,
    node.metadata?.scannerSourceFile,
    node.metadata?.openAgentGraphRunFilePath,
    titlePath,
  ];

  for (const candidate of candidates) {
    const text = textFromUnknown(candidate, MAX_PRODUCT_NODE_BODY_LENGTH);
    if (!text) continue;

    const normalizedPath = safeRunCodeFilePath(text);
    if (normalizedPath) return normalizedPath;
  }

  return undefined;
}

function findExistingCodeFileNode(productProjection: ProductGraphProjection, filePath: string) {
  const normalizedPath = safeRunCodeFilePath(filePath);
  if (!normalizedPath) return undefined;

  return productProjection.nodes.find((node) => codeFilePathForNode(node) === normalizedPath);
}

function createRunCodeFileNode(input: {
  filePath: string;
  now: string;
  runSource: ProductSourceRef;
}): ProductGraphNode {
  return {
    id: stableProductId("openagentgraph-run:file", input.filePath),
    kind: "code_file",
    title: input.filePath.slice(0, MAX_PRODUCT_NODE_TITLE_LENGTH),
    summary: "Touched by linked OpenAgentGraph run evidence.",
    status: "planned",
    tags: ["openagentgraph", "code"],
    source: {
      ...input.runSource,
      path: input.filePath,
    },
    metadata: compactMetadata({
      openAgentGraphRunFilePath: input.filePath,
    }),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function collectRunEvidenceStats(graphProjection: GraphProjection) {
  const changedFiles = new Set<string>();
  const changedCodeFiles = new Map<string, { fileDiffCount: number; changeTypes: Set<string> }>();
  const commandLabels = new Set<string>();
  let commandCount = 0;
  let failingCommandCount = 0;
  let testCommandCount = 0;
  let passingTestCommandCount = 0;
  let toolCallCount = 0;

  for (const node of graphProjection.nodes) {
    const evidence = node.evidence;
    if (!evidence) continue;

    toolCallCount += evidence.toolCallLog.length;
    for (const fileDiff of evidence.fileDiffs) {
      const normalizedPath = safeEvidencePath(fileDiff.path);
      if (normalizedPath) changedFiles.add(normalizedPath);

      const codeFilePath = safeRunCodeFilePath(fileDiff.path);
      if (codeFilePath) {
        const existing = changedCodeFiles.get(codeFilePath);
        const stat = existing ?? { fileDiffCount: 0, changeTypes: new Set<string>() };
        stat.fileDiffCount += 1;
        const changeType = textFromUnknown(fileDiff.changeType, 80);
        if (changeType) stat.changeTypes.add(changeType);
        changedCodeFiles.set(codeFilePath, stat);
      }
    }

    for (const commandResult of evidence.commandResults) {
      commandCount += 1;
      const passed = commandResult.exitCode === 0 && !commandResult.timedOut;
      if (!passed) failingCommandCount += 1;

      const label = textFromUnknown(commandLabel(commandResult.command, commandResult.args), MAX_PRODUCT_EDGE_LABEL_LENGTH);
      if (label) {
        commandLabels.add(label);
        if (isTestCommand(label)) {
          testCommandCount += 1;
          if (passed) passingTestCommandCount += 1;
        }
      }
    }
  }

  return {
    changedFiles: [...changedFiles].sort(),
    changedCodeFiles: [...changedCodeFiles.entries()]
      .map(([filePath, stat]): RunChangedCodeFileStat => ({
        path: filePath,
        fileDiffCount: stat.fileDiffCount,
        changeTypes: [...stat.changeTypes].sort().join(", ") || undefined,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    commandLabels: [...commandLabels].sort(),
    commandCount,
    failingCommandCount,
    testCommandCount,
    passingTestCommandCount,
    toolCallCount,
  };
}

function buildRunCodeFileLinks(input: {
  productProjection: ProductGraphProjection;
  graphId: string;
  runNodeId: string;
  runSource: ProductSourceRef;
  now: string;
  changedCodeFiles: RunChangedCodeFileStat[];
}) {
  const fileNodes: ProductGraphNode[] = [];
  const fileNodesToUpsert: ProductGraphNode[] = [];
  const fileEdges: ProductGraphEdge[] = [];

  for (const fileStat of input.changedCodeFiles.slice(0, MAX_RUN_LINK_FILE_DIFFS)) {
    const existingNode = findExistingCodeFileNode(input.productProjection, fileStat.path);
    const fileNode = existingNode
      ? productNodeFromProjectionNode(existingNode)
      : createRunCodeFileNode({
        filePath: fileStat.path,
        now: input.now,
        runSource: input.runSource,
      });

    if (!existingNode) fileNodesToUpsert.push(fileNode);
    fileNodes.push(fileNode);
    fileEdges.push({
      id: stableProductId("run-file-edge", `${input.runNodeId}|${fileNode.id}|touches`),
      sourceNodeId: input.runNodeId,
      targetNodeId: fileNode.id,
      kind: "touches",
      trust: "manual",
      label: "Run changed file",
      source: input.runSource,
      metadata: compactMetadata({
        graphId: input.graphId,
        filePath: fileStat.path,
        fileDiffCount: fileStat.fileDiffCount,
        changeTypes: fileStat.changeTypes,
      }),
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  return { fileNodes, fileNodesToUpsert, fileEdges };
}

function findAcceptedCodexPlanNodes(input: {
  productProjection: ProductGraphProjection;
  taskNodeId: string;
}): ProductGraphNode[] {
  const planNodeIdsLinkedToTask = new Set(
    input.productProjection.edges
      .filter((edge) => edge.kind === "derived_from" && edge.targetNodeId === input.taskNodeId)
      .map((edge) => edge.sourceNodeId)
  );

  return input.productProjection.nodes.filter((node) => {
    if (node.kind !== "plan" || !node.tags?.includes("codex")) return false;

    return metadataString(node.metadata, "taskNodeId") === input.taskNodeId
      || planNodeIdsLinkedToTask.has(node.id);
  });
}

function buildRunEvidenceBody(graphProjection: GraphProjection, stats: ReturnType<typeof collectRunEvidenceStats>) {
  const coverage = Math.round(graphProjection.evidenceCoverageRate * 100);
  const passRate = Math.round(graphProjection.passRate * 100);
  const changedFileLines = stats.changedFiles.slice(0, 10).map((filePath) => `- ${filePath}`);
  const commandLines = stats.commandLabels.slice(0, 10).map((label) => `- ${label}`);
  const sections = [
    graphProjection.runHealthSummary,
    graphProjection.latestNotificationSummary,
    `Evidence coverage: ${coverage}%. Pass rate: ${passRate}%.`,
    changedFileLines.length
      ? `Changed files:\n${changedFileLines.join("\n")}`
      : "Changed files: none recorded.",
    commandLines.length
      ? `Commands:\n${commandLines.join("\n")}`
      : "Commands: none recorded.",
  ];

  return textFromUnknown(sections.filter(Boolean).join("\n\n"), MAX_PRODUCT_NODE_BODY_LENGTH);
}

function buildOpenAgentGraphRunLink(input: {
  graphProjection: GraphProjection;
  productProjection: ProductGraphProjection;
  taskNodeId: string;
}): ProductRunLinkPlan {
  const now = new Date().toISOString();
  const graph = input.graphProjection.graph;
  const runNodeId = stableProductId("run", graph.id);
  const evidenceNodeId = stableProductId("run-evidence", graph.id);
  const runSource: ProductSourceRef = {
    kind: "openagentgraph_run",
    label: "OpenAgentGraph run",
    url: `/graphs/${encodeURIComponent(graph.id)}`,
  };
  const lastEventSequence = input.graphProjection.events.at(-1)?.seq ?? 0;
  const evidenceStats = collectRunEvidenceStats(input.graphProjection);
  const node: ProductGraphNode = {
    id: runNodeId,
    kind: "agent_run",
    title: (graph.title || `Run ${graph.id}`).slice(0, MAX_PRODUCT_NODE_TITLE_LENGTH),
    summary: textFromUnknown(
      input.graphProjection.latestNotificationSummary ?? input.graphProjection.runHealthSummary,
      MAX_PRODUCT_NODE_SUMMARY_LENGTH
    ),
    body: textFromUnknown(graph.goal, MAX_PRODUCT_NODE_BODY_LENGTH),
    status: productStatusForRunStatus(graph.status),
    tags: ["openagentgraph", "run"],
    source: runSource,
    metadata: compactMetadata({
      graphId: graph.id,
      graphStatus: graph.status,
      runControlState: input.graphProjection.runControlState,
      completedNodeCount: input.graphProjection.completedNodeCount,
      plannedNodeCount: input.graphProjection.plannedNodeCount,
      passRate: input.graphProjection.passRate,
      evidenceCoverageRate: input.graphProjection.evidenceCoverageRate,
      lastEventSequence,
    }),
    createdAt: now,
    updatedAt: now,
  };
  const evidenceNode: ProductGraphNode = {
    id: evidenceNodeId,
    kind: "evidence",
    title: `${graph.title || `Run ${graph.id}`} evidence`.slice(0, MAX_PRODUCT_NODE_TITLE_LENGTH),
    summary: `${pluralize(evidenceStats.changedFiles.length, "changed file")}, ${pluralize(evidenceStats.commandCount, "command")}, ${pluralize(evidenceStats.testCommandCount, "test command")}.`,
    body: buildRunEvidenceBody(input.graphProjection, evidenceStats),
    status: productStatusForRunStatus(graph.status),
    tags: ["openagentgraph", "evidence"],
    source: runSource,
    metadata: compactMetadata({
      graphId: graph.id,
      graphStatus: graph.status,
      changedFileCount: evidenceStats.changedFiles.length,
      commandCount: evidenceStats.commandCount,
      failingCommandCount: evidenceStats.failingCommandCount,
      testCommandCount: evidenceStats.testCommandCount,
      passingTestCommandCount: evidenceStats.passingTestCommandCount,
      toolCallCount: evidenceStats.toolCallCount,
      passRate: input.graphProjection.passRate,
      evidenceCoverageRate: input.graphProjection.evidenceCoverageRate,
      lastEventSequence,
    }),
    createdAt: now,
    updatedAt: now,
  };
  const edge: ProductGraphEdge = {
    id: stableProductId("run-edge", `${input.taskNodeId}|${runNodeId}|produced_by`),
    sourceNodeId: input.taskNodeId,
    targetNodeId: runNodeId,
    kind: "produced_by",
    trust: "manual",
    label: "Task produced by run",
    source: runSource,
    metadata: compactMetadata({
      graphId: graph.id,
    }),
    createdAt: now,
    updatedAt: now,
  };
  const acceptedPlanNodes = findAcceptedCodexPlanNodes({
    productProjection: input.productProjection,
    taskNodeId: input.taskNodeId,
  });
  const planEdges: ProductGraphEdge[] = acceptedPlanNodes.map((planNode) => ({
    id: stableProductId("run-plan-edge", `${runNodeId}|${planNode.id}|derived_from`),
    sourceNodeId: runNodeId,
    targetNodeId: planNode.id,
    kind: "derived_from",
    trust: "manual",
    label: "Run derived from plan",
    source: runSource,
    metadata: compactMetadata({
      graphId: graph.id,
      taskNodeId: input.taskNodeId,
      planNodeId: planNode.id,
    }),
    createdAt: now,
    updatedAt: now,
  }));
  const evidenceEdge: ProductGraphEdge = {
    id: stableProductId("run-evidence-edge", `${evidenceNodeId}|${runNodeId}|produced_by`),
    sourceNodeId: evidenceNodeId,
    targetNodeId: runNodeId,
    kind: "produced_by",
    trust: "manual",
    label: "Evidence produced by run",
    source: runSource,
    metadata: compactMetadata({
      graphId: graph.id,
    }),
    createdAt: now,
    updatedAt: now,
  };
  const fileLinks = buildRunCodeFileLinks({
    productProjection: input.productProjection,
    graphId: graph.id,
    runNodeId,
    runSource,
    now,
    changedCodeFiles: evidenceStats.changedCodeFiles,
  });

  return { node, edge, evidenceNode, evidenceEdge, planEdges, ...fileLinks };
}

function buildAcceptedCodexPlan(input: {
  taskNodeId: string;
  planningPrompt: ProductGraphCodexPlanningPrompt;
  request?: AcceptCodexPlanRequest;
  now: string;
}): AcceptedCodexPlan {
  const source: ProductSourceRef = {
    kind: "manual",
    label: "Accepted Codex planning prompt",
  };
  const title = textFromUnknown(input.request?.title, MAX_PRODUCT_NODE_TITLE_LENGTH)
    ?? textFromUnknown(`Codex plan for ${input.planningPrompt.taskNode.title}`, MAX_PRODUCT_NODE_TITLE_LENGTH)
    ?? "Codex plan";
  const summary = textFromUnknown(input.request?.summary, MAX_PRODUCT_NODE_SUMMARY_LENGTH)
    ?? textFromUnknown(
      `Generated Codex planning prompt for ${input.planningPrompt.taskNode.title}.`,
      MAX_PRODUCT_NODE_SUMMARY_LENGTH
    );
  const promptHash = hashCodexPlanningPrompt(input.planningPrompt.prompt);
  const nodeId = stableProductId("plan:codex", `${input.taskNodeId}:${input.planningPrompt.prompt}`);
  const node: ProductGraphNode = {
    id: nodeId,
    kind: "plan",
    title,
    summary,
    body: textFromUnknown(input.planningPrompt.prompt, MAX_PRODUCT_NODE_BODY_LENGTH),
    status: "planned",
    tags: ["codex", "planning"],
    source,
    metadata: compactMetadata({
      taskNodeId: input.taskNodeId,
      promptHash,
      acceptanceCriterionCount: input.planningPrompt.acceptanceCriteria.length,
      likelyCodeAreaCount: input.planningPrompt.likelyCodeAreas.length,
      openQuestionCount: input.planningPrompt.openQuestions.length,
      riskCount: input.planningPrompt.risks.length,
      verificationCommandCount: input.planningPrompt.verificationCommands.length,
      hasCodeMapSummary: Boolean(input.planningPrompt.codeMapSummary),
    }),
    createdAt: input.now,
    updatedAt: input.now,
  };
  const edge: ProductGraphEdge = {
    id: stableProductId("edge:codex-plan", `${input.taskNodeId}:${nodeId}`),
    sourceNodeId: node.id,
    targetNodeId: input.taskNodeId,
    kind: "derived_from",
    trust: "manual",
    label: "Plan derived from task",
    source,
    metadata: compactMetadata({
      taskNodeId: input.taskNodeId,
      planNodeId: node.id,
    }),
    createdAt: input.now,
    updatedAt: input.now,
  };

  return { node, edge };
}

function hashCodexPlanningPrompt(prompt: string) {
  return createHash("sha256").update(prompt).digest("hex");
}

function parseOptionalCodexPlanPromptHash(value: unknown): { value?: string; error?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") {
    return { error: "promptHash must be a SHA-256 hex digest." };
  }

  const promptHash = value.trim().toLowerCase();
  if (!promptHash) return {};
  if (!CODEX_PLAN_PROMPT_HASH_PATTERN.test(promptHash)) {
    return { error: "promptHash must be a SHA-256 hex digest." };
  }
  return { value: promptHash };
}

type ProductGraphCodebaseScanResult = {
  status: "scanned";
  message: string;
  scanId: string;
  scannedAt: string;
  scanned: Awaited<ReturnType<typeof scanWorkspaceCodebase>>["summary"];
};

type ProductGraphScanJob = ScanJobStatus<ProductGraphCodebaseScanResult> & {
  events: ScanProgressSnapshot[];
  listeners: Set<(job: ScanJobStatus<ProductGraphCodebaseScanResult>) => void>;
};

const PRODUCT_SCAN_JOB_TTL_MS = 10 * 60 * 1_000;
const productGraphScanJobs = new Map<string, ProductGraphScanJob>();
let codebaseScanInProgress = false;

async function runProductGraphCodebaseScan(
  actor: ActorIdentity,
  onProgress?: (snapshot: ScanProgressSnapshot) => void
): Promise<ProductGraphCodebaseScanResult> {
  const workspaceRoot = await resolveProductGraphWorkspaceRoot();
  const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
  const config = getAppConfig();
  const scanPlan = await scanWorkspaceCodebase({
    workspaceRoot,
    projection,
    scanLimits: config.scanner.scanLimits,
    semanticScanLimits: config.scanner.semanticScanLimits,
    semanticAnalysisBudget: config.scanner.semanticAnalysisBudget,
    onProgress,
  });
  const events: Parameters<typeof appendProductEvents>[0] = [
    ...scanPlan.nodes.map((node) => ({
      productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
      kind: "product.node.upserted" as const,
      nodeId: node.id,
      payload: { node, actor },
    })),
    ...scanPlan.edges.map((edge) => ({
      productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
      kind: "product.edge.upserted" as const,
      edgeId: edge.id,
      payload: { edge, actor },
    })),
    ...scanPlan.staleEdgeIds.map((edgeId) => ({
      productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
      kind: "product.edge.archived" as const,
      edgeId,
      payload: {
        edgeId,
        reason: "Codebase scan no longer sees this relationship.",
      },
    })),
    ...scanPlan.staleNodeIds.map((nodeId) => ({
      productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
      kind: "product.node.archived" as const,
      nodeId,
      payload: {
        nodeId,
        reason: "Codebase scan no longer sees this node.",
      },
    })),
  ];

  onProgress?.(buildScanProgressSnapshot({
    scanId: scanPlan.scanId,
    scope: "product_codebase",
    phase: "writing_graph",
    startedAtMs: new Date(scanPlan.scannedAt).getTime(),
    filesScanned: scanPlan.summary.progress.filesScanned,
    bytesScanned: scanPlan.summary.progress.bytesScanned,
    skippedFileCount: scanPlan.summary.skippedFileCount,
    skippedDirectoryCount: scanPlan.summary.skippedDirectoryCount,
    breakers: scanPlan.summary.breakers.lightweight,
    message: "Writing Product Graph scan events.",
  }));
  await appendProductEvents(events);

  return {
    status: "scanned",
    message: "Codebase scan completed.",
    scanId: scanPlan.scanId,
    scannedAt: scanPlan.scannedAt,
    scanned: scanPlan.summary,
  };
}

function publicProductScanJob(job: ProductGraphScanJob): ScanJobStatus<ProductGraphCodebaseScanResult> {
  return {
    jobId: job.jobId,
    scope: job.scope,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function cleanupProductScanJobs() {
  const cutoff = Date.now() - PRODUCT_SCAN_JOB_TTL_MS;
  for (const [jobId, job] of productGraphScanJobs) {
    if (new Date(job.updatedAt).getTime() < cutoff) {
      productGraphScanJobs.delete(jobId);
    }
  }
}

function scheduleProductScanJobCleanup(jobId: string) {
  setTimeout(() => {
    const job = productGraphScanJobs.get(jobId);
    if (!job || job.status === "queued" || job.status === "running") return;
    productGraphScanJobs.delete(jobId);
  }, PRODUCT_SCAN_JOB_TTL_MS).unref?.();
}

function publishProductScanJob(job: ProductGraphScanJob, progress: ScanProgressSnapshot) {
  job.progress = progress;
  job.updatedAt = progress.updatedAt;
  job.events.push(progress);
  const publicJob = publicProductScanJob(job);
  for (const listener of job.listeners) {
    listener(publicJob);
  }
}

function writeProductScanSse(reply: FastifyReply, job: ScanJobStatus<ProductGraphCodebaseScanResult>) {
  reply.raw.write(`event: status\ndata: ${JSON.stringify(job)}\n\n`);
}

function createProductScanJob(actor: ActorIdentity): ProductGraphScanJob {
  cleanupProductScanJobs();
  const startedAt = Date.now();
  const jobId = `product-${nanoid(12)}`;
  const breakers = createScanBreakerStatus(getAppConfig().scanner.scanLimits);
  const progress = buildScanProgressSnapshot({
    scanId: jobId,
    scope: "product_codebase",
    phase: "queued",
    startedAtMs: startedAt,
    filesScanned: 0,
    bytesScanned: 0,
    skippedFileCount: 0,
    skippedDirectoryCount: 0,
    breakers,
    message: "Product Graph codebase scan queued.",
  });
  const job: ProductGraphScanJob = {
    jobId,
    scope: "product_codebase",
    status: "queued",
    createdAt: progress.startedAt,
    updatedAt: progress.updatedAt,
    progress,
    events: [progress],
    listeners: new Set(),
  };
  productGraphScanJobs.set(jobId, job);
  codebaseScanInProgress = true;

  void (async () => {
    job.status = "running";
    publishProductScanJob(job, { ...progress, phase: "collecting_files", message: "Product Graph codebase scan started." });
    try {
      const result = await runProductGraphCodebaseScan(actor, (snapshot) => publishProductScanJob(job, snapshot));
      job.status = "completed";
      job.result = result;
      publishProductScanJob(job, result.scanned.progress);
    } catch (error) {
      const failedProgress = buildScanProgressSnapshot({
        scanId: jobId,
        scope: "product_codebase",
        phase: "failed",
        startedAtMs: startedAt,
        filesScanned: job.progress.filesScanned,
        bytesScanned: job.progress.bytesScanned,
        skippedFileCount: job.progress.skippedFileCount,
        skippedDirectoryCount: job.progress.skippedDirectoryCount,
        breakers: job.progress.breakers,
        message: error instanceof Error ? error.message : "Product Graph codebase scan failed.",
      });
      job.status = "failed";
      job.error = failedProgress.message;
      publishProductScanJob(job, failedProgress);
    } finally {
      codebaseScanInProgress = false;
      scheduleProductScanJobCleanup(jobId);
    }
  })();

  return job;
}

export async function productGraphRoutes(app: FastifyInstance) {
  app.get("/product-graph", async () =>
    getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID)
  );

  app.get("/product-graph/handoff", async () => {
    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    return buildProductGraphHandoffReport(projection, await buildProductGraphHandoffOptions({ projection }));
  });

  app.post("/product-graph/handoff/write", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const options = await buildProductGraphHandoffOptions({ projection, handoffFileExists: true });
    if (options.workspacePathCheck?.status === "mismatch") {
      return reply.status(409).send({
        error: "Product Graph code paths do not match the configured workspace root. Refresh the codebase scan or point OpenAgentGraph at the matching workspace before writing GRAPH_REPORT.md.",
        workspacePathCheck: options.workspacePathCheck,
      });
    }

    const report = buildProductGraphHandoffReport(projection, options);
    const workspaceRoot = await resolveProductGraphWorkspaceRoot();
    const outputPath = await writeProductGraphHandoffFile(workspaceRoot, report.markdown);

    return reply.status(201).send({
      status: "written",
      path: path.relative(workspaceRoot, outputPath) || PRODUCT_GRAPH_HANDOFF_FILE_NAME,
      ...report,
    });
  });

  app.get<{ Params: { nodeId: string } }>("/product-graph/trace/:nodeId", async (req, reply) => {
    const nodeId = trimRequiredId(req.params.nodeId, "nodeId", MAX_PRODUCT_NODE_ID_LENGTH);
    if (nodeId.error || !nodeId.value) {
      return reply.status(400).send({ error: nodeId.error ?? "nodeId is required." });
    }

    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const trace = buildProductGraphTrace({
      projection,
      rootNodeId: nodeId.value,
    });
    if (!trace) {
      return reply.status(404).send({ error: "Product graph node was not found." });
    }

    return trace;
  });

  app.get<{ Params: { taskNodeId: string } }>("/product-graph/codex-plan/:taskNodeId", async (req, reply) => {
    const taskNodeId = trimRequiredId(req.params.taskNodeId, "taskNodeId", MAX_PRODUCT_NODE_ID_LENGTH);
    if (taskNodeId.error || !taskNodeId.value) {
      return reply.status(400).send({ error: taskNodeId.error ?? "taskNodeId is required." });
    }
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const basePlanningPrompt = buildProductGraphCodexPlanningPrompt({
      projection,
      taskNodeId: taskNodeId.value,
    });
    if (!basePlanningPrompt) {
      return reply.status(404).send({ error: "Product graph task was not found." });
    }

    return basePlanningPrompt;
  });

  app.post<{ Params: { taskNodeId: string }; Body: AcceptCodexPlanRequest }>(
    "/product-graph/codex-plan/:taskNodeId/accept",
    async (req, reply) => {
      const actor = requireProductGraphWriteActor(req, reply);
      if (!actor) return;

      const request = isRecord(req.body) ? req.body : {};
      const taskNodeId = trimRequiredId(req.params.taskNodeId, "taskNodeId", MAX_PRODUCT_NODE_ID_LENGTH);
      if (taskNodeId.error || !taskNodeId.value) {
        return reply.status(400).send({ error: taskNodeId.error ?? "taskNodeId is required." });
      }

      const requestedPromptHash = parseOptionalCodexPlanPromptHash(request.promptHash);
      if (requestedPromptHash.error) {
        return reply.status(400).send({ error: requestedPromptHash.error });
      }

      const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
      const basePlanningPrompt = buildProductGraphCodexPlanningPrompt({
        projection,
        taskNodeId: taskNodeId.value,
      });
      if (!basePlanningPrompt) {
        return reply.status(404).send({ error: "Product graph task was not found." });
      }

      const planningPrompt = basePlanningPrompt;
      const currentPromptHash = hashCodexPlanningPrompt(planningPrompt.prompt);
      if (requestedPromptHash.value && requestedPromptHash.value !== currentPromptHash) {
        return reply.status(409).send({
          error: "Codex planning prompt changed. Reload the plan before accepting it.",
        });
      }
      const acceptedPlan = buildAcceptedCodexPlan({
        taskNodeId: taskNodeId.value,
        planningPrompt,
        request,
        now: new Date().toISOString(),
      });

      await appendProductEvents([
        {
          productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
          kind: "product.node.upserted",
          nodeId: acceptedPlan.node.id,
          payload: { node: acceptedPlan.node, actor },
        },
        {
          productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
          kind: "product.edge.upserted",
          edgeId: acceptedPlan.edge.id,
          payload: { edge: acceptedPlan.edge, actor },
        },
      ]);

      return reply.status(201).send(acceptedPlan);
    }
  );

  app.post<{ Body: CreateProductNodeRequest }>("/product-graph/nodes", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const node = buildProductNode(req.body ?? {});
    if ("error" in node) {
      return reply.status(400).send({ error: node.error });
    }

    await appendProductEvent({
      productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
      kind: "product.node.upserted",
      nodeId: node.id,
      payload: { node, actor },
    });

    return reply.status(201).send(node);
  });

  app.post<{ Body: CreateProductEdgeRequest }>("/product-graph/edges", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const edge = buildProductEdge(req.body ?? {});
    if ("error" in edge) {
      return reply.status(400).send({ error: edge.error });
    }

    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const nodeIds = new Set(projection.nodes.map((node) => node.id));
    if (!nodeIds.has(edge.sourceNodeId)) {
      return reply.status(400).send({ error: "sourceNodeId must reference an existing product graph node." });
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      return reply.status(400).send({ error: "targetNodeId must reference an existing product graph node." });
    }

    await appendProductEvent({
      productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
      kind: "product.edge.upserted",
      edgeId: edge.id,
      payload: { edge, actor },
    });

    return reply.status(201).send(edge);
  });

  app.post<{ Body: CreateIntentBundleRequest }>("/product-graph/intent-bundles", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const bundle = buildProductIntentBundle(req.body ?? {});
    if ("error" in bundle) {
      return reply.status(400).send({ error: bundle.error });
    }

    await appendProductEvents([
      ...bundle.nodes.map((node) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted",
        nodeId: node.id,
        payload: { node, actor },
      } as const)),
      ...bundle.edges.map((edge) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted",
        edgeId: edge.id,
        payload: { edge, actor },
      } as const)),
    ]);

    return reply.status(201).send(bundle);
  });

  app.post<{ Params: { graphId: string }; Body: LinkProductRunRequest }>("/product-graph/runs/:graphId/link", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const graphId = trimRequiredId(req.params.graphId, "graphId", MAX_PRODUCT_NODE_ID_LENGTH);
    if (graphId.error || !graphId.value) {
      return reply.status(400).send({ error: graphId.error ?? "graphId is required." });
    }

    const taskNodeId = trimRequiredId(req.body?.taskNodeId, "taskNodeId", MAX_PRODUCT_NODE_ID_LENGTH);
    if (taskNodeId.error || !taskNodeId.value) {
      return reply.status(400).send({ error: taskNodeId.error ?? "taskNodeId is required." });
    }

    const graphProjection = await getExecutionGraphProjection(graphId.value).catch(() => undefined);
    if (!graphProjection) {
      return reply.status(404).send({ error: "OpenAgentGraph run graph was not found." });
    }
    if (graphProjection.graph.status !== "completed") {
      return reply.status(409).send({ error: "Only completed OpenAgentGraph runs can be linked to product graph tasks." });
    }

    const productProjection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const taskNode = productProjection.nodes.find((node) => node.id === taskNodeId.value);
    if (!taskNode) {
      return reply.status(404).send({ error: "Product graph task was not found." });
    }
    if (taskNode.kind !== "task") {
      return reply.status(400).send({ error: "taskNodeId must reference a Product Graph task node." });
    }

    const linkPlan = buildOpenAgentGraphRunLink({
      graphProjection,
      productProjection,
      taskNodeId: taskNode.id,
    });
    const { fileNodesToUpsert, ...link } = linkPlan;
    await appendProductEvents([
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted",
        nodeId: link.node.id,
        payload: { node: link.node, actor },
      },
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted",
        nodeId: link.evidenceNode.id,
        payload: { node: link.evidenceNode, actor },
      },
      ...fileNodesToUpsert.map((fileNode) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted" as const,
        nodeId: fileNode.id,
        payload: { node: fileNode, actor },
      })),
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted",
        edgeId: link.edge.id,
        payload: { edge: link.edge, actor },
      },
      ...link.planEdges.map((planEdge) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted" as const,
        edgeId: planEdge.id,
        payload: { edge: planEdge, actor },
      })),
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted",
        edgeId: link.evidenceEdge.id,
        payload: { edge: link.evidenceEdge, actor },
      },
      ...link.fileEdges.map((fileEdge) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted" as const,
        edgeId: fileEdge.id,
        payload: { edge: fileEdge, actor },
      })),
    ]);

    return reply.status(201).send(link);
  });

  app.post("/product-graph/codebase/scan", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    if (codebaseScanInProgress) {
      return reply.status(409).send({
        status: "scan_in_progress",
        error: "A codebase scan is already running.",
      });
    }

    codebaseScanInProgress = true;
    try {
      return reply.status(201).send(await runProductGraphCodebaseScan(actor));
    } finally {
      codebaseScanInProgress = false;
    }
  });

  app.post("/product-graph/codebase/scan-jobs", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    if (codebaseScanInProgress) {
      return reply.status(409).send({
        status: "scan_in_progress",
        error: "A codebase scan is already running.",
      });
    }

    return reply.status(202).send(publicProductScanJob(createProductScanJob(actor)));
  });

  app.get("/product-graph/codebase/scan-jobs/:jobId", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const jobId = (req.params as { jobId?: string }).jobId;
    const job = jobId ? productGraphScanJobs.get(jobId) : undefined;
    if (!job) return reply.status(404).send({ error: "Product Graph codebase scan job was not found." });
    return publicProductScanJob(job);
  });

  app.get("/product-graph/codebase/scan-jobs/:jobId/events", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const jobId = (req.params as { jobId?: string }).jobId;
    const job = jobId ? productGraphScanJobs.get(jobId) : undefined;
    if (!job) return reply.status(404).send({ error: "Product Graph codebase scan job was not found." });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    for (const event of job.events) {
      writeProductScanSse(reply, { ...publicProductScanJob(job), progress: event });
    }
    if (job.status === "completed" || job.status === "failed") {
      reply.raw.end();
      return;
    }
    const listener = (nextJob: ScanJobStatus<ProductGraphCodebaseScanResult>) => {
      writeProductScanSse(reply, nextJob);
      if (nextJob.status === "completed" || nextJob.status === "failed") {
        job.listeners.delete(listener);
        reply.raw.end();
      }
    };
    job.listeners.add(listener);
    req.raw.on("close", () => {
      job.listeners.delete(listener);
    });
  });

  app.post("/product-graph/spec-kit/import", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const workspaceRoot = await resolveProductGraphWorkspaceRoot();
    const detection = await detectSpecKitArtifacts(workspaceRoot);
    if (detection.presentArtifacts.length === 0) {
      return reply.status(404).send({
        status: "missing_artifacts",
        message:
          "Spec Kit artifacts are missing. Add .specify/memory/constitution.md or Spec Kit files under specs/ before importing.",
        ...detection,
      });
    }

    const importPlan = await buildSpecKitImportPlan(workspaceRoot);
    if ("error" in importPlan) {
      return reply.status(400).send({
        status: "invalid_spec_kit_artifacts",
        error: importPlan.error,
        ...detection,
      });
    }

    await appendProductEvents([
      ...importPlan.nodes.map((node) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted",
        nodeId: node.id,
        payload: { node, actor },
      } as const)),
      ...importPlan.edges.map((edge) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted",
        edgeId: edge.id,
        payload: { edge, actor },
      } as const)),
    ]);

    return reply.status(201).send({
      status: "imported",
      message: "Spec Kit artifacts imported into the Product Graph.",
      imported: importPlan.summary,
      ...detection,
    });
  });
}
