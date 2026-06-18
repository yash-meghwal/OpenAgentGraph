import fs from "fs";
import os from "os";
import path from "path";
import type {
  GraphUpdateBenchmarkResult,
  GraphUpdateBenchmarkScenario,
  GraphUpdateBenchmarkScenarioId,
} from "@openagentgraph/shared";
import {
  evaluateGraphUpdateBenchmarkResult,
  GRAPH_UPDATE_BENCHMARK_DOGFOOD_MAX_WARM_MS,
  GRAPH_UPDATE_BENCHMARK_FIXTURE_MAX_WARM_MS,
  GRAPH_UPDATE_BENCHMARK_SCENARIOS,
} from "@openagentgraph/shared";
import {
  GRAPH_INCREMENTAL_MAX_RATIO,
  isStructuralWorkspacePath,
} from "@openagentgraph/shared/graphIncremental";
import { BASE_SKIPPED_DIRECTORIES } from "../../scanner/scannerHygiene.js";
import { seedGraphWorkspaceForUpdate } from "../../cli/graphUpdate.js";
import { runGraphWorkspaceUpdate } from "./graphIncrementalScan.js";

const SKIPPED_WORKSPACE_DIRECTORY_SET = new Set<string>(BASE_SKIPPED_DIRECTORIES);

const SECRET_OR_LOCAL_BASENAMES = new Set([
  ".env",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_dsa",
]);

const SECRET_OR_LOCAL_EXTENSIONS = new Set([
  ".sqlite",
  ".sqlite3",
  ".db",
  ".pem",
  ".key",
  ".pfx",
  ".p12",
]);

const GENERATED_PATH_SEGMENTS = ["/bin/", "/obj/", "/.next/", "/dist/", "/node_modules/"];

function normalizeRelativePath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isGeneratedRelativePath(filePath: string) {
  const normalized = `/${normalizeRelativePath(filePath)}`;
  return GENERATED_PATH_SEGMENTS.some((segment) => normalized.includes(segment));
}

function shouldCopyFixtureEntry(sourceRoot: string, sourcePath: string) {
  const relative = path.relative(sourceRoot, sourcePath).replace(/\\/g, "/");
  if (!relative || relative === ".") return true;
  if (relative === ".oag" || relative.startsWith(".oag/")) return false;
  if (relative === "GRAPH_REPORT.md") return false;
  return true;
}

function isSecretOrLocalArtifact(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const basename = path.posix.basename(normalized);
  if (SECRET_OR_LOCAL_BASENAMES.has(basename)) return true;
  if (basename.startsWith(".env.")) return true;
  const extension = path.posix.extname(basename).toLowerCase();
  return SECRET_OR_LOCAL_EXTENSIONS.has(extension);
}

export function shouldCopyWorkspaceEntry(sourceRoot: string, sourcePath: string) {
  const relative = path.relative(sourceRoot, sourcePath).replace(/\\/g, "/");
  if (!relative || relative === ".") return true;

  const segments = relative.split("/").filter(Boolean);
  for (const segment of segments) {
    if (SKIPPED_WORKSPACE_DIRECTORY_SET.has(segment)) return false;
  }

  const looksLikeDirectory = fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory();
  if (!looksLikeDirectory && isSecretOrLocalArtifact(relative)) return false;

  return true;
}

export function copyFixtureWorkspace(fixturesRoot: string, fixtureName: string) {
  const sourceRoot = path.join(fixturesRoot, fixtureName);
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `oag-update-benchmark-${fixtureName}-`));
  fs.cpSync(sourceRoot, workspaceRoot, {
    recursive: true,
    filter: (sourcePath) => shouldCopyFixtureEntry(sourceRoot, sourcePath),
  });
  return workspaceRoot;
}

export function copyWorkspaceForBenchmark(sourceRoot: string) {
  const resolvedRoot = path.resolve(sourceRoot);
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oag-update-benchmark-workspace-"));
  fs.cpSync(resolvedRoot, workspaceRoot, {
    recursive: true,
    filter: (sourcePath) => shouldCopyWorkspaceEntry(resolvedRoot, sourcePath),
  });
  return workspaceRoot;
}

function listWorkspaceSourceFiles(workspaceRoot: string, extensions: string[]) {
  const matches: string[] = [];
  const extensionSet = new Set(extensions.map((ext) => ext.toLowerCase()));

  function walk(currentDir: string) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".oag" || entry.name === "node_modules" || entry.name === "bin" || entry.name === "obj") {
          continue;
        }
        walk(absolutePath);
        continue;
      }
      const relativePath = normalizeRelativePath(path.relative(workspaceRoot, absolutePath));
      if (isGeneratedRelativePath(relativePath)) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!extensionSet.has(extension)) continue;
      matches.push(relativePath);
    }
  }

  walk(workspaceRoot);
  return matches.sort();
}

function writeSyntheticTypeScriptFile(workspaceRoot: string, index: number, subdir = "src/benchmark") {
  const relativePath = `${subdir}/module-${index}.ts`;
  const absolutePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    `export function benchmarkModule${index}() {\n  return ${index};\n}\n`,
    "utf8"
  );
  return relativePath;
}

function writeSyntheticCSharpFile(workspaceRoot: string, index: number) {
  const relativePath = `Benchmark/Module${index}.cs`;
  const absolutePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    `namespace Benchmark;\npublic static class Module${index}\n{\n    public static int Value => ${index};\n}\n`,
    "utf8"
  );
  return relativePath;
}

function minimumIndexedFilesForChangedCount(changedFiles: number) {
  return Math.ceil(changedFiles / GRAPH_INCREMENTAL_MAX_RATIO) + changedFiles;
}

function ensureBenchmarkCorpusPadding(
  workspaceRoot: string,
  scenario: GraphUpdateBenchmarkScenario
) {
  if (scenario.generatedOnly) return;

  const targetCount = minimumIndexedFilesForChangedCount(scenario.changedFiles);
  if (scenario.id === "mixed-10") {
    const typescriptPaths = listWorkspaceSourceFiles(workspaceRoot, [".ts", ".tsx"]);
    while (typescriptPaths.length < Math.ceil(targetCount / 2)) {
      typescriptPaths.push(writeSyntheticTypeScriptFile(workspaceRoot, typescriptPaths.length, "web/benchmark"));
    }
    const csharpPaths = listWorkspaceSourceFiles(workspaceRoot, [".cs"]);
    while (csharpPaths.length < Math.ceil(targetCount / 2)) {
      csharpPaths.push(writeSyntheticCSharpFile(workspaceRoot, csharpPaths.length));
    }
    return;
  }

  const extensions = scenario.id === "typescript-10" ? [".ts", ".tsx"] : [".cs"];
  const paths = listWorkspaceSourceFiles(workspaceRoot, extensions);
  const writer = scenario.id === "typescript-10"
    ? (index: number) => writeSyntheticTypeScriptFile(workspaceRoot, index)
    : (index: number) => writeSyntheticCSharpFile(workspaceRoot, index);

  while (paths.length < targetCount) {
    paths.push(writer(paths.length));
  }
}

function ensureChangedFilePaths(
  workspaceRoot: string,
  scenario: GraphUpdateBenchmarkScenario
): string[] {
  if (scenario.generatedOnly) return [];

  if (scenario.id === "mixed-10") {
    const typescriptPaths = listWorkspaceSourceFiles(workspaceRoot, [".ts", ".tsx"]);
    while (typescriptPaths.length < 5) {
      typescriptPaths.push(writeSyntheticTypeScriptFile(workspaceRoot, typescriptPaths.length, "web/benchmark"));
    }
    const csharpPaths = listWorkspaceSourceFiles(workspaceRoot, [".cs"]);
    while (csharpPaths.length < 5) {
      csharpPaths.push(writeSyntheticCSharpFile(workspaceRoot, csharpPaths.length));
    }
    return [
      ...typescriptPaths.filter((filePath) => !isStructuralWorkspacePath(filePath)).slice(0, 5),
      ...csharpPaths.filter((filePath) => !isStructuralWorkspacePath(filePath)).slice(0, 5),
    ];
  }

  const extensions = scenario.id === "typescript-10" ? [".ts", ".tsx"] : [".cs"];
  const paths = listWorkspaceSourceFiles(workspaceRoot, extensions);
  const writer = scenario.id === "typescript-10"
    ? writeSyntheticTypeScriptFile
    : writeSyntheticCSharpFile;

  while (paths.length < scenario.changedFiles) {
    paths.push(writer(workspaceRoot, paths.length));
  }

  return paths
    .filter((filePath) => !isStructuralWorkspacePath(filePath))
    .slice(0, scenario.changedFiles);
}

function touchPaths(workspaceRoot: string, relativePaths: string[], marker: string) {
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    fs.appendFileSync(absolutePath, `\n${marker}\n`, "utf8");
  }
}

function touchGeneratedOnlyPath(workspaceRoot: string) {
  const relativePath = "SampleMediaPlayer.App/bin/Debug/Generated.cs";
  const absolutePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, "namespace Generated;\npublic class BuildOutput {}\n", "utf8");
  const touchedAt = new Date(Date.now() + 60_000);
  fs.utimesSync(absolutePath, touchedAt, touchedAt);
  return relativePath;
}

async function loadCachedGraph(workspaceRoot: string) {
  const graphPath = path.join(workspaceRoot, ".oag", "graph.json");
  if (!fs.existsSync(graphPath)) return undefined;
  return JSON.parse(fs.readFileSync(graphPath, "utf8"));
}

async function loadCachedManifest(workspaceRoot: string) {
  const manifestPath = path.join(workspaceRoot, ".oag", "graph-manifest.json");
  if (!fs.existsSync(manifestPath)) return undefined;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export async function runGraphUpdateBenchmarkScenario(input: {
  scenario: GraphUpdateBenchmarkScenario;
  fixturesRoot: string;
  maxWarmMs?: number;
  cleanup?: boolean;
}): Promise<GraphUpdateBenchmarkResult> {
  const workspaceRoot = copyFixtureWorkspace(input.fixturesRoot, input.scenario.baseFixture);
  if (!input.scenario.generatedOnly) {
    ensureBenchmarkCorpusPadding(workspaceRoot, input.scenario);
  }
  const touchedPaths = input.scenario.generatedOnly
    ? []
    : ensureChangedFilePaths(workspaceRoot, input.scenario);

  try {
    const coldStartedAt = Date.now();
    await seedGraphWorkspaceForUpdate(workspaceRoot);
    const coldScanMs = Date.now() - coldStartedAt;

    if (input.scenario.generatedOnly) {
      touchGeneratedOnlyPath(workspaceRoot);
    } else {
      touchPaths(workspaceRoot, touchedPaths, `// oag-benchmark-${input.scenario.id}`);
    }

    const cachedGraph = await loadCachedGraph(workspaceRoot);
    const cachedManifest = await loadCachedManifest(workspaceRoot);
    const warmStartedAt = Date.now();
    const update = await runGraphWorkspaceUpdate(workspaceRoot, {
      cachedGraph,
      manifest: cachedManifest,
    });
    const warmUpdateMs = Date.now() - warmStartedAt;

    const result: GraphUpdateBenchmarkResult = {
      scenarioId: input.scenario.id,
      label: input.scenario.label,
      workspaceRoot,
      passed: false,
      errors: [],
      coldScanMs,
      warmUpdateMs,
      changedFileCount: update.plan.changed.length + update.plan.added.length,
      rescannedFileCount: update.plan.scanPaths.length,
      neighborExpansionCount: update.plan.neighborPaths.length,
      updateMode: update.plan.mode,
      fallbackReasons: update.plan.mode === "full" ? [...update.plan.reasons] : [],
      touchedPaths: input.scenario.generatedOnly ? [] : touchedPaths,
    };
    result.errors = evaluateGraphUpdateBenchmarkResult(result, {
      maxWarmMs: input.maxWarmMs ?? GRAPH_UPDATE_BENCHMARK_FIXTURE_MAX_WARM_MS,
      expectMode: input.scenario.expectMode,
    });
    result.passed = result.errors.length === 0;
    return result;
  } finally {
    if (input.cleanup !== false) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }
}

export async function runGraphUpdateBenchmarkForWorkspace(input: {
  workspaceRoot: string;
  changedFiles: number;
  maxWarmMs?: number;
  inPlace?: boolean;
}): Promise<GraphUpdateBenchmarkResult> {
  const sourceWorkspaceRoot = path.resolve(input.workspaceRoot);
  const workspaceRoot = input.inPlace
    ? sourceWorkspaceRoot
    : copyWorkspaceForBenchmark(sourceWorkspaceRoot);
  const cleanup = !input.inPlace;

  try {
    const sourcePaths = [
      ...listWorkspaceSourceFiles(workspaceRoot, [".ts", ".tsx", ".cs", ".py", ".go", ".java", ".kt", ".rb", ".php", ".rs"]),
    ];
    if (sourcePaths.length === 0) {
      throw new Error("Workspace has no benchmarkable source files.");
    }

    const touchedPaths = sourcePaths.slice(0, Math.max(1, input.changedFiles));
    let coldScanMs = 0;
    const graphPath = path.join(workspaceRoot, ".oag", "graph.json");
    if (!fs.existsSync(graphPath)) {
      const coldStartedAt = Date.now();
      await seedGraphWorkspaceForUpdate(workspaceRoot);
      coldScanMs = Date.now() - coldStartedAt;
    }

    touchPaths(workspaceRoot, touchedPaths, "// oag-benchmark-workspace");
    const warmStartedAt = Date.now();
    const update = await runGraphWorkspaceUpdate(workspaceRoot, {
      cachedGraph: await loadCachedGraph(workspaceRoot),
      manifest: await loadCachedManifest(workspaceRoot),
    });
    const warmUpdateMs = Date.now() - warmStartedAt;

    const result: GraphUpdateBenchmarkResult = {
      scenarioId: "workspace-custom",
      label: `Custom workspace update (${touchedPaths.length} changed files)`,
      workspaceRoot,
      sourceWorkspaceRoot: input.inPlace ? undefined : sourceWorkspaceRoot,
      passed: false,
      errors: [],
      coldScanMs,
      warmUpdateMs,
      changedFileCount: update.plan.changed.length + update.plan.added.length,
      rescannedFileCount: update.plan.scanPaths.length,
      neighborExpansionCount: update.plan.neighborPaths.length,
      updateMode: update.plan.mode,
      fallbackReasons: update.plan.mode === "full" ? [...update.plan.reasons] : [],
      touchedPaths,
    };
    result.errors = evaluateGraphUpdateBenchmarkResult(result, {
      maxWarmMs: input.maxWarmMs ?? GRAPH_UPDATE_BENCHMARK_DOGFOOD_MAX_WARM_MS,
    });
    result.passed = result.errors.length === 0;
    return result;
  } finally {
    if (cleanup) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }
}

export async function runGraphUpdateBenchmarkSuite(input: {
  fixturesRoot: string;
  scenarioIds?: GraphUpdateBenchmarkScenarioId[];
  maxWarmMs?: number;
}) {
  const scenarios = GRAPH_UPDATE_BENCHMARK_SCENARIOS.filter((scenario) =>
    !input.scenarioIds || input.scenarioIds.includes(scenario.id)
  );
  const results: GraphUpdateBenchmarkResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runGraphUpdateBenchmarkScenario({
      scenario,
      fixturesRoot: input.fixturesRoot,
      maxWarmMs: input.maxWarmMs,
    }));
  }
  return results;
}