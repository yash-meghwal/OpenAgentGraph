import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import type {
  AgenticSdlcScorecard,
  ContextNoiseDiagnostics,
  GraphFusionResult,
  GraphHandoffFreshnessResult,
  HarnessWorkspaceMetadata,
  UnifiedCodeGraph,
  WorkspaceKernelProfile,
} from "@openagentgraph/shared";
import {
  buildAgenticSdlcScorecard,
  evaluateContextNoise,
  evaluateGraphSpecQuality,
  summarizeEcosystemSupportForAgents,
} from "@openagentgraph/shared";

const AGENT_INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "llms.txt",
  "LLMS.md",
  ".github/copilot-instructions.md",
] as const;

const DOC_COMMAND_SNIPPET_FILES = [
  "CONTRIBUTING.md",
  "docs/CONTRIBUTING.md",
  "docs/contributing.md",
] as const;

const TRACKED_GENERATED_PATH_PATTERNS = [
  /(?:^|\/)(?:dist|build|coverage|node_modules|\.oag)(?:\/|$)/i,
  /generated-output\.js$/i,
  /GRAPH_REPORT\.md$/i,
] as const;

const HARNESS_ALWAYS_SKIP_DIR_NAMES = new Set([
  ".git",
  ".oag",
  ".venv",
  "bin",
  "node_modules",
  "obj",
  "OAGimprovement",
  "OpenAgentGraphPro",
  "target",
]);

export type HarnessTrackedGeneratedPathsOptions = {
  graph?: UnifiedCodeGraph;
};

const WORKSPACE_PACKAGE_JSON_DIRS = [
  "packages",
  "apps",
  "libs",
  "services",
] as const;

function readTextIfExists(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function readPackageScriptsFromFile(packageJsonPath: string) {
  const raw = readTextIfExists(packageJsonPath);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts;
  } catch {
    return undefined;
  }
}

function readPackageScripts(workspaceRoot: string) {
  return readPackageScriptsFromFile(path.join(workspaceRoot, "package.json"));
}

function readWorkspacePackageScripts(workspaceRoot: string) {
  const scriptsByPath: Record<string, Record<string, string>> = {};
  for (const dirName of WORKSPACE_PACKAGE_JSON_DIRS) {
    const absoluteDir = path.join(workspaceRoot, dirName);
    if (!fs.existsSync(absoluteDir)) continue;
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relativePath = `${dirName}/${entry.name}/package.json`;
      const scripts = readPackageScriptsFromFile(path.join(workspaceRoot, relativePath));
      if (scripts && Object.keys(scripts).length > 0) {
        scriptsByPath[relativePath.replace(/\\/g, "/")] = scripts;
      }
    }
  }
  return scriptsByPath;
}

function readWorkflowTexts(workspaceRoot: string) {
  const workflowsDir = path.join(workspaceRoot, ".github", "workflows");
  const workflowTexts: Record<string, string> = {};
  if (!fs.existsSync(workflowsDir)) return workflowTexts;

  for (const entry of fs.readdirSync(workflowsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const relativePath = `.github/workflows/${entry.name}`;
    const text = readTextIfExists(path.join(workflowsDir, entry.name));
    if (text) workflowTexts[relativePath] = text;
  }

  return workflowTexts;
}

function readAgentInstructionTexts(workspaceRoot: string) {
  const agentInstructionTexts: Record<string, string> = {};
  for (const fileName of AGENT_INSTRUCTION_FILES) {
    const text = readTextIfExists(path.join(workspaceRoot, fileName));
    if (text) agentInstructionTexts[fileName] = text;
  }
  return agentInstructionTexts;
}

function readDocTexts(workspaceRoot: string) {
  const docTexts: Record<string, string> = {};
  for (const fileName of DOC_COMMAND_SNIPPET_FILES) {
    const text = readTextIfExists(path.join(workspaceRoot, fileName));
    if (text) docTexts[fileName] = text;
  }
  return docTexts;
}

function walkFilesMatching(
  workspaceRoot: string,
  relativeDir: string,
  matcher: (relativePath: string) => boolean,
  matches: Record<string, string> = {}
) {
  const absoluteDir = path.join(workspaceRoot, relativeDir);
  if (!fs.existsSync(absoluteDir)) return matches;

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const normalized = relativePath.replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (/(?:^|\/)(?:node_modules|\.git|dist|build|bin|obj|target|\.venv)(?:\/|$)/i.test(normalized)) {
        continue;
      }
      walkFilesMatching(workspaceRoot, relativePath, matcher, matches);
      continue;
    }
    if (!matcher(normalized)) continue;
    const text = readTextIfExists(path.join(workspaceRoot, relativePath));
    if (text) matches[normalized] = text;
  }

  return matches;
}

function readNamedTexts(workspaceRoot: string, fileName: string) {
  return walkFilesMatching(workspaceRoot, "", (relativePath) => relativePath.endsWith(fileName));
}

function normalizeHarnessPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

function isTrackedGeneratedPath(relativePath: string) {
  const normalized = normalizeHarnessPath(relativePath);
  return TRACKED_GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function pathMatchesProtectedSegment(filePath: string, segment: string) {
  const normalized = normalizeHarnessPath(filePath);
  return normalized === segment
    || normalized.startsWith(`${segment}/`)
    || normalized.includes(`/${segment}/`);
}

type GitWorkspaceScope = {
  workspaceRoot: string;
  repoRoot: string;
  scopePrefix: string;
};

function runGitCommand(workspaceRoot: string, args: string[]) {
  return execFileSync("git", ["-C", workspaceRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runGitCommandRaw(workspaceRoot: string, args: string[]) {
  return execFileSync("git", ["-C", workspaceRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveGitWorkspaceScope(workspaceRoot: string): GitWorkspaceScope | null {
  try {
    const inWorkTree = runGitCommand(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
    if (inWorkTree !== "true") return null;

    const repoRoot = path.resolve(runGitCommand(workspaceRoot, ["rev-parse", "--show-toplevel"]));
    const resolvedWorkspace = path.resolve(workspaceRoot);
    let scopePrefix = "";
    if (resolvedWorkspace !== repoRoot) {
      scopePrefix = normalizeHarnessPath(path.relative(repoRoot, resolvedWorkspace));
      if (scopePrefix) scopePrefix = `${scopePrefix}/`;
    }

    return {
      workspaceRoot: resolvedWorkspace,
      repoRoot,
      scopePrefix,
    };
  } catch {
    return null;
  }
}

function toWorkspaceRelativeGitPath(repoRelativePath: string, scope: GitWorkspaceScope) {
  const normalized = normalizeHarnessPath(repoRelativePath);
  if (!scope.scopePrefix) return normalized;
  if (!normalized.startsWith(scope.scopePrefix)) return null;
  return normalizeHarnessPath(normalized.slice(scope.scopePrefix.length));
}

function listGitTrackedPaths(workspaceRoot: string): string[] | null {
  const scope = resolveGitWorkspaceScope(workspaceRoot);
  if (!scope) return null;

  try {
    const args = ["ls-files", "-z"];
    if (scope.scopePrefix) {
      args.push("--", scope.scopePrefix.replace(/\/$/, ""));
    }
    const output = runGitCommandRaw(scope.repoRoot, args);
    return output
      .split("\0")
      .filter(Boolean)
      .map((entry) => toWorkspaceRelativeGitPath(entry, scope))
      .filter((entry): entry is string => entry !== null);
  } catch {
    return null;
  }
}

function collectGeneratedPathsFromGraph(graph: UnifiedCodeGraph) {
  const paths: string[] = [];
  for (const node of graph.nodes) {
    const candidate = node.path ?? node.label;
    if (!candidate) continue;
    if (!["code_file", "config_file", "doc_file", "test", "asset_file"].includes(node.kind)) continue;
    const normalized = normalizeHarnessPath(candidate);
    if (isTrackedGeneratedPath(normalized)) {
      paths.push(normalized);
    }
  }
  return paths;
}

function parseGitignoreLines(gitignore: string) {
  return gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
}

function gitignoreLineCoversPath(line: string, relativePath: string, isDirectory: boolean) {
  const normalizedPath = normalizeHarnessPath(relativePath);
  let raw = line.trim();
  const directoriesOnly = raw.endsWith("/");
  if (directoriesOnly) raw = raw.slice(0, -1);
  const anchored = raw.startsWith("/");
  if (anchored) raw = raw.slice(1);
  const normalizedPattern = raw.replace(/\/$/, "");
  if (!normalizedPattern) return false;

  if (directoriesOnly && !isDirectory) {
    return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
  }

  if (anchored) {
    return normalizedPath === normalizedPattern
      || normalizedPath.startsWith(`${normalizedPattern}/`);
  }

  if (raw.startsWith("**/")) {
    const suffix = raw.slice(3).replace(/\/$/, "");
    return normalizedPath === suffix
      || normalizedPath.endsWith(`/${suffix}`)
      || normalizedPath.includes(`/${suffix}/`)
      || normalizedPath.startsWith(`${suffix}/`);
  }

  const segmentBoundary = new RegExp(`(^|/)${normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")}(/|$)`);
  return segmentBoundary.test(normalizedPath);
}

function isHarnessPathIgnored(relativePath: string, isDirectory: boolean, gitignoreLines: string[]) {
  const normalized = normalizeHarnessPath(relativePath);
  const segments = normalized.split("/");
  if (segments.some((segment) => HARNESS_ALWAYS_SKIP_DIR_NAMES.has(segment))) {
    return true;
  }
  return gitignoreLines.some((line) => gitignoreLineCoversPath(line, normalized, isDirectory));
}

function walkIgnoreAwareGeneratedPaths(
  workspaceRoot: string,
  relativeDir = "",
  gitignoreLines: string[] = parseGitignoreLines(readTextIfExists(path.join(workspaceRoot, ".gitignore")) ?? "")
): string[] {
  const absoluteDir = path.join(workspaceRoot, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];

  const matches: string[] = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const normalized = normalizeHarnessPath(relativePath);
    if (isHarnessPathIgnored(normalized, entry.isDirectory(), gitignoreLines)) {
      continue;
    }
    if (entry.isDirectory()) {
      matches.push(...walkIgnoreAwareGeneratedPaths(workspaceRoot, relativePath, gitignoreLines));
      continue;
    }
    if (isTrackedGeneratedPath(normalized)) {
      matches.push(normalized);
    }
  }
  return matches;
}

export function loadHarnessWorkspaceMetadata(workspaceRoot: string): HarnessWorkspaceMetadata {
  const workspacePackageScripts = readWorkspacePackageScripts(workspaceRoot);
  return {
    readmeText: readTextIfExists(path.join(workspaceRoot, "README.md")),
    packageScripts: readPackageScripts(workspaceRoot),
    workspacePackageScripts: Object.keys(workspacePackageScripts).length > 0 ? workspacePackageScripts : undefined,
    workflowTexts: readWorkflowTexts(workspaceRoot),
    agentInstructionTexts: readAgentInstructionTexts(workspaceRoot),
    pyprojectTexts: readNamedTexts(workspaceRoot, "pyproject.toml"),
    pytestIniTexts: readNamedTexts(workspaceRoot, "pytest.ini"),
    toxIniTexts: readNamedTexts(workspaceRoot, "tox.ini"),
    cargoTomlTexts: readNamedTexts(workspaceRoot, "Cargo.toml"),
    goModTexts: readNamedTexts(workspaceRoot, "go.mod"),
    csprojTexts: readNamedTexts(workspaceRoot, ".csproj"),
    slnTexts: readNamedTexts(workspaceRoot, ".sln"),
    makefileTexts: readNamedTexts(workspaceRoot, "Makefile"),
    cmakeListsTexts: readNamedTexts(workspaceRoot, "CMakeLists.txt"),
    pubspecTexts: readNamedTexts(workspaceRoot, "pubspec.yaml"),
    gradleTexts: {
      ...readNamedTexts(workspaceRoot, "build.gradle"),
      ...readNamedTexts(workspaceRoot, "build.gradle.kts"),
    },
    mavenTexts: readNamedTexts(workspaceRoot, "pom.xml"),
    docTexts: readDocTexts(workspaceRoot),
  };
}

export function listHarnessTrackedGeneratedPaths(
  workspaceRoot: string,
  options: HarnessTrackedGeneratedPathsOptions = {}
) {
  const fromGraph = options.graph ? collectGeneratedPathsFromGraph(options.graph) : [];
  const gitTracked = listGitTrackedPaths(workspaceRoot);
  if (gitTracked !== null) {
    return [...new Set([...gitTracked, ...fromGraph].filter((entry) => isTrackedGeneratedPath(entry)))];
  }

  const fromWalk = walkIgnoreAwareGeneratedPaths(workspaceRoot);
  return [...new Set([...fromGraph, ...fromWalk].filter((entry) => isTrackedGeneratedPath(entry)))];
}

export function listHarnessRootPlanFiles(workspaceRoot: string) {
  return fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^PLAN-[A-Z0-9.-]+\.md$/i.test(entry.name))
    .map((entry) => entry.name);
}

const GITIGNORE_PROTECTED_PATTERNS = [
  "dist/",
  "build/",
  "coverage/",
  ".oag/",
  "node_modules/",
] as const;

function gitignoreCoversPattern(gitignore: string, pattern: string) {
  const target = pattern.replace(/\/$/, "");
  const lines = parseGitignoreLines(gitignore);
  return lines.some((line) => {
    const raw = line.trim();
    const directoriesOnly = raw.endsWith("/");
    let normalized = raw.replace(/^\//, "");
    if (directoriesOnly) normalized = normalized.slice(0, -1);
    if (normalized === target) return true;

    if (raw.startsWith("**/")) {
      const suffix = raw.slice(3).replace(/\/$/, "");
      return suffix === target;
    }

    if (normalized === `${target}/**` || normalized === `${target}/*`) {
      return true;
    }

    return directoriesOnly && normalized === target;
  });
}

export function listHarnessGitignoreMissingPatterns(
  workspaceRoot: string,
  options: HarnessTrackedGeneratedPathsOptions = {}
): string[] {
  const gitignore = readTextIfExists(path.join(workspaceRoot, ".gitignore")) ?? "";
  const tracked = listHarnessTrackedGeneratedPaths(workspaceRoot, options);
  return GITIGNORE_PROTECTED_PATTERNS.filter((pattern) => {
    const normalized = pattern.replace(/\/$/, "");
    const trackedMatch = tracked.some((entry) => pathMatchesProtectedSegment(entry, normalized));
    return trackedMatch && !gitignoreCoversPattern(gitignore, pattern);
  });
}

export function buildHarnessContextNoiseDiagnostics(
  workspaceRoot: string,
  graph: UnifiedCodeGraph,
  options: {
    metadata?: HarnessWorkspaceMetadata;
    kernelProfile?: WorkspaceKernelProfile;
  } = {}
): ContextNoiseDiagnostics {
  const metadata = options.metadata ?? loadHarnessWorkspaceMetadata(workspaceRoot);
  const specQuality = evaluateGraphSpecQuality(graph, { metadata });
  const ecosystemLimitations = summarizeEcosystemSupportForAgents({
    graph,
    kernelProfile: options.kernelProfile,
  })
    .filter((row) => row.tier === "T2" || row.tier === "T3")
    .map((row) => `${row.scannerId} (${row.tier}): ${row.limitation}`);

  return {
    trackedGeneratedPaths: listHarnessTrackedGeneratedPaths(workspaceRoot, { graph }),
    rootPlanFiles: listHarnessRootPlanFiles(workspaceRoot),
    gitignoreMissingPatterns: listHarnessGitignoreMissingPatterns(workspaceRoot, { graph }),
    instructionConflicts: specQuality.conflicts.map((conflict) => conflict.detail),
    ecosystemLimitations,
  };
}

export function evaluateHarnessContextNoise(
  workspaceRoot: string,
  graph: UnifiedCodeGraph,
  options: {
    metadata?: HarnessWorkspaceMetadata;
    kernelProfile?: WorkspaceKernelProfile;
  } = {}
) {
  const contextNoiseDiagnostics = buildHarnessContextNoiseDiagnostics(workspaceRoot, graph, options);
  const contextNoise = evaluateContextNoise(graph, contextNoiseDiagnostics);
  return { contextNoise, contextNoiseDiagnostics };
}

export function buildWorkspaceAgenticSdlcScorecard(
  workspaceRoot: string,
  graph: UnifiedCodeGraph,
  options: {
    metadata?: HarnessWorkspaceMetadata;
    kernelProfile?: WorkspaceKernelProfile;
    handoffFreshness?: GraphHandoffFreshnessResult;
    fusion?: GraphFusionResult;
    updateBenchmarkOk?: boolean;
  } = {}
): AgenticSdlcScorecard {
  const metadata = options.metadata ?? loadHarnessWorkspaceMetadata(workspaceRoot);
  const { contextNoise } = evaluateHarnessContextNoise(workspaceRoot, graph, {
    metadata,
    kernelProfile: options.kernelProfile,
  });
  return buildAgenticSdlcScorecard({
    workspaceRoot,
    graph,
    kernelProfile: options.kernelProfile,
    metadata,
    handoffFreshness: options.handoffFreshness,
    fusion: options.fusion,
    contextNoise,
    updateBenchmarkOk: options.updateBenchmarkOk,
  });
}