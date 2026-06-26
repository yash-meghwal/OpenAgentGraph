import fs from "fs/promises";
import path from "path";
import type {
  GraphIncrementalManifest,
  GraphPathMode,
  GraphQueryIntentMode,
  GraphTaskLensId,
  UnifiedCodeGraph,
  WorkspaceKernelProfile,
} from "@openagentgraph/shared";
import {
  CODE_GRAPH_SCHEMA_VERSION,
  evaluateHandoffFreshness,
  GRAPH_TASK_LENS_DEFINITIONS,
  parseGraphQueryIntentMode,
  type GraphHandoffFreshnessResult,
} from "@openagentgraph/shared";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";
import { isPathInsideRoot } from "../productGraphHandoffTrust.js";
import { readRequiredCliValue } from "./productGraphDataDir.js";

export const GRAPH_EXPORT_DIR_NAME = ".oag";
export const GRAPH_JSON_FILE_NAME = "graph.json";
export const GRAPH_MANIFEST_FILE_NAME = "graph-manifest.json";
export const GRAPH_HTML_FILE_NAME = "graph.html";
export const GRAPH_WIKI_INDEX_FILE_NAME = "wiki/index.md";
export const GRAPH_HANDOFF_FILE_NAME = "GRAPH_REPORT.md";

export type GraphWorkspaceCliCommand = "query" | "path" | "explain" | "export" | "lens" | "check" | "docs-check" | "update" | "context" | "generic";

export interface GraphWorkspaceCliOptions {
  workspace?: string;
  json: boolean;
  refresh: boolean;
  dfs: boolean;
  budget: number;
  lens?: GraphTaskLensId;
  maxHops?: number;
  explainRanking: boolean;
  pathMode?: GraphPathMode;
  queryMode?: GraphQueryIntentMode;
  unscopedMode?: string;
}

const GRAPH_PATH_MODES = new Set<GraphPathMode>(["semantic", "balanced", "structural"]);

const DEFAULT_GRAPH_CLI_BUDGET = 40;

const GRAPH_TASK_LENS_IDS = new Set(GRAPH_TASK_LENS_DEFINITIONS.map((definition) => definition.id));

export interface LoadedWorkspaceGraph {
  workspaceRoot: string;
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  fromCache: boolean;
}

/**
 * npm run on Windows routes through cmd.exe, which can leave caret escape
 * markers in argv when PowerShell passes quoted strings (e.g. "^MainViewModel^ playback^").
 */
function stripGraphCliCaretMarkers(value: string) {
  return value
    .replace(/\^([^\s^]+)\^/g, "$1")
    .replace(/(^|\s)\^+/g, "$1")
    .replace(/\^+(?=\s|$)/g, "");
}

export function normalizeGraphCliText(value: string) {
  return stripGraphCliCaretMarkers(value).replace(/\s+/g, " ").trim();
}

export function joinGraphCliPositionals(positionals: string[]) {
  return normalizeGraphCliText(positionals.join(" "));
}

export function normalizeGraphCliArg(value: string) {
  return normalizeGraphCliText(value);
}

/**
 * Normalizes user-supplied workspace paths from npm/cmd/PowerShell argv without
 * mangling drive letters, UNC roots, or interior spaces (including repeated spaces).
 */
export function normalizeWorkspaceCliPath(value: string) {
  let normalized = stripGraphCliCaretMarkers(value).trim();
  while (
    (normalized.startsWith('"') && normalized.endsWith('"'))
    || (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (!normalized) {
    throw new Error("Workspace path is empty.");
  }
  return normalized;
}

export function readGraphWorkspaceCliValue(argv: string[], index: number) {
  return normalizeWorkspaceCliPath(readRequiredCliValue(argv, index, "--workspace"));
}

export function parseGraphWorkspaceArgv(argv: string[], command?: GraphWorkspaceCliCommand) {
  const options: GraphWorkspaceCliOptions = {
    json: false,
    refresh: false,
    dfs: false,
    budget: DEFAULT_GRAPH_CLI_BUDGET,
    explainRanking: false,
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      options.workspace = readGraphWorkspaceCliValue(argv, index);
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--refresh") {
      options.refresh = true;
    } else if (arg === "--dfs") {
      options.dfs = true;
    } else if (arg === "--budget") {
      const value = readRequiredCliValue(argv, index, "--budget");
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--budget requires a positive integer.");
      }
      options.budget = parsed;
      index += 1;
    } else if (arg === "--lens") {
      const value = readRequiredCliValue(argv, index, "--lens");
      if (!GRAPH_TASK_LENS_IDS.has(value as GraphTaskLensId)) {
        throw new Error(`Unknown graph lens '${value}'.`);
      }
      options.lens = value as GraphTaskLensId;
      index += 1;
    } else if (arg === "--max-hops") {
      const value = readRequiredCliValue(argv, index, "--max-hops");
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--max-hops requires a positive integer.");
      }
      options.maxHops = parsed;
      index += 1;
    } else if (arg === "--explain-ranking") {
      options.explainRanking = true;
    } else if (arg === "--mode") {
      const value = readRequiredCliValue(argv, index, "--mode");
      if (command === "query" || command === "context") {
        options.queryMode = parseGraphQueryIntentMode(value);
      } else if (command === "path") {
        if (!GRAPH_PATH_MODES.has(value as GraphPathMode)) {
          throw new Error(`Unknown graph path mode '${value}'. Expected semantic, balanced, or structural.`);
        }
        options.pathMode = value as GraphPathMode;
      } else {
        try {
          options.queryMode = parseGraphQueryIntentMode(value);
        } catch {
          options.unscopedMode = value;
        }
      }
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown graph option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  return { options, positionals };
}

export function collectIgnoredGraphCliOptions(
  command: GraphWorkspaceCliCommand,
  options: GraphWorkspaceCliOptions
) {
  const warnings: string[] = [];
  if (command !== "path") {
    if (options.maxHops !== undefined) {
      warnings.push("--max-hops is only used by graph:path; ignoring.");
    }
    if (options.explainRanking) {
      warnings.push("--explain-ranking is only used by graph:path; ignoring.");
    }
    if (options.pathMode) {
      warnings.push("--mode semantic|balanced|structural is only used by graph:path; ignoring.");
    }
  }
  if (command !== "query" && command !== "context") {
    if (options.queryMode) {
      warnings.push("--mode code|docs|balanced is only used by graph:query; ignoring.");
    }
  }
  if (command !== "query" && command !== "context" && command !== "path" && options.unscopedMode) {
    warnings.push("--mode is only used by graph:query and graph:path; ignoring.");
  }
  if (command !== "query" && command !== "context") {
    if (options.dfs) {
      warnings.push("--dfs is only used by graph:query; ignoring.");
    }
    if (options.budget !== DEFAULT_GRAPH_CLI_BUDGET) {
      warnings.push("--budget is only used by graph:query; ignoring.");
    }
  }
  if (command !== "query" && command !== "context" && command !== "path" && command !== "lens" && options.lens) {
    warnings.push("--lens is only used by graph:query, graph:path, and graph:lens; ignoring.");
  }
  return warnings;
}

export function warnIgnoredGraphCliOptions(
  command: GraphWorkspaceCliCommand,
  options: GraphWorkspaceCliOptions
) {
  for (const warning of collectIgnoredGraphCliOptions(command, options)) {
    console.warn(warning);
  }
}

async function pathExists(directoryPath: string) {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function assertValidUnifiedGraph(graph: UnifiedCodeGraph, workspaceRoot: string) {
  if (graph.schemaVersion !== CODE_GRAPH_SCHEMA_VERSION) {
    throw new Error(`Unsupported graph schema version: ${graph.schemaVersion}`);
  }
  if (path.resolve(graph.workspaceRoot) !== path.resolve(workspaceRoot)) {
    throw new Error("Cached graph.json workspace root does not match --workspace.");
  }
}

export function resolveGraphArtifactPath(workspaceRoot: string, relativePath: string) {
  const root = path.resolve(workspaceRoot);
  const candidate = path.resolve(root, relativePath);
  if (!isPathInsideRoot(root, candidate)) {
    throw new Error(`Graph artifact path must stay inside workspace root: ${relativePath}`);
  }
  return candidate;
}

export async function loadWorkspaceUnifiedGraph(
  workspaceRoot: string,
  options: { refresh?: boolean } = {}
): Promise<LoadedWorkspaceGraph> {
  const resolvedRoot = path.resolve(workspaceRoot);
  if (!(await pathExists(resolvedRoot))) {
    throw new Error(`Workspace path does not exist or is not a directory: ${resolvedRoot}`);
  }

  const cachedGraphPath = resolveGraphArtifactPath(resolvedRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_JSON_FILE_NAME));
  if (!options.refresh && (await fileExists(cachedGraphPath))) {
    const cached = JSON.parse(await fs.readFile(cachedGraphPath, "utf8")) as UnifiedCodeGraph;
    assertValidUnifiedGraph(cached, resolvedRoot);
    return {
      workspaceRoot: resolvedRoot,
      graph: cached,
      fromCache: true,
    };
  }

  const scanResult = await runKernelWorkspaceScan(resolvedRoot);
  return {
    workspaceRoot: resolvedRoot,
    graph: scanResult.unifiedGraph,
    kernelProfile: scanResult.kernelProfile,
    fromCache: false,
  };
}

export function requireWorkspaceOption(workspace?: string) {
  if (!workspace?.trim()) {
    throw new Error('Graph commands require --workspace "<absolute path>".');
  }
  const normalized = normalizeWorkspaceCliPath(workspace);
  return path.resolve(normalized);
}

export async function readHandoffFreshness(
  workspaceRoot: string,
  graphGeneratedAt: string,
  handoffRelativePath = GRAPH_HANDOFF_FILE_NAME
): Promise<GraphHandoffFreshnessResult> {
  const handoffPath = resolveGraphArtifactPath(workspaceRoot, handoffRelativePath);
  try {
    const stat = await fs.stat(handoffPath);
    if (!stat.isFile()) {
      return evaluateHandoffFreshness({
        graphGeneratedAt,
        handoffPath: handoffRelativePath,
      });
    }
    return evaluateHandoffFreshness({
      graphGeneratedAt,
      handoffUpdatedAt: stat.mtime.toISOString(),
      handoffPath: handoffRelativePath,
    });
  } catch {
    return evaluateHandoffFreshness({
      graphGeneratedAt,
      handoffPath: handoffRelativePath,
    });
  }
}

export async function readPreviousSymbolCount(workspaceRoot: string): Promise<number | undefined> {
  const cachedGraphPath = resolveGraphArtifactPath(workspaceRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_JSON_FILE_NAME));
  try {
    const cached = JSON.parse(await fs.readFile(cachedGraphPath, "utf8")) as UnifiedCodeGraph;
    return cached.nodes.filter((node) => node.kind === "symbol").length;
  } catch {
    return undefined;
  }
}

export async function tryLoadCachedGraphManifest(workspaceRoot: string): Promise<GraphIncrementalManifest | undefined> {
  const manifestPath = resolveGraphArtifactPath(workspaceRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_MANIFEST_FILE_NAME));
  if (!(await fileExists(manifestPath))) return undefined;
  try {
    return JSON.parse(await fs.readFile(manifestPath, "utf8")) as GraphIncrementalManifest;
  } catch {
    return undefined;
  }
}

export async function tryLoadCachedWorkspaceGraph(workspaceRoot: string): Promise<UnifiedCodeGraph | undefined> {
  const cachedGraphPath = resolveGraphArtifactPath(workspaceRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_JSON_FILE_NAME));
  if (!(await fileExists(cachedGraphPath))) return undefined;
  try {
    const cached = JSON.parse(await fs.readFile(cachedGraphPath, "utf8")) as UnifiedCodeGraph;
    assertValidUnifiedGraph(cached, workspaceRoot);
    return cached;
  } catch {
    return undefined;
  }
}

export async function resolveWorkspaceCodeContext(workspaceRoot: string) {
  const codeGraph = await tryLoadCachedWorkspaceGraph(workspaceRoot);
  if (!codeGraph) return undefined;
  const handoffFreshness = await readHandoffFreshness(workspaceRoot, codeGraph.generatedAt);
  return { codeGraph, handoffFreshness };
}