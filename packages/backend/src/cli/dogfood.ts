import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import {
  buildProductGraphHandoffReport,
  GraphWorkflowTimingCollector,
  summarizeGraphWorkflowTiming,
} from "@openagentgraph/shared";
import { loadAppConfig, setAppConfigOverride } from "../config.js";
import {
  checkProductGraphWorkspacePaths,
  formatHandoffDataSourceForReport,
  formatHandoffWorkspaceRootForReport,
  isPathInsideRoot,
} from "../productGraphHandoffTrust.js";
import { runOfflineKernelGraphExport } from "./offlineGraphExport.js";
import { readGraphWorkspaceCliValue } from "./graphWorkspace.js";
import { resolvePackageWorkspaceRoot } from "./productGraphDataDir.js";

const DEFAULT_PRODUCT_GRAPH_ID = "default";
const DEFAULT_HANDOFF_OUTPUT = "GRAPH_REPORT.md";
const DOGFOOD_DATA_DIR_NAME = ".tmp-dogfood-data";

interface DogfoodCliOptions {
  workspace?: string;
  output?: string;
  json: boolean;
  noExport: boolean;
}

function readRequiredCliValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv: string[]): DogfoodCliOptions {
  const options: DogfoodCliOptions = { json: false, noExport: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      options.workspace = readGraphWorkspaceCliValue(argv, index);
      index += 1;
    } else if (arg === "--output") {
      options.output = readRequiredCliValue(argv, index, "--output");
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--no-export") {
      options.noExport = true;
    } else {
      throw new Error(`Unknown dogfood option: ${arg}`);
    }
  }

  return options;
}

async function pathExists(directoryPath: string) {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function workspaceDataDirHash(workspacePath: string) {
  return createHash("sha256").update(path.resolve(workspacePath).toLowerCase()).digest("hex").slice(0, 16);
}

async function resolveOpenAgentGraphRepoRoot() {
  return resolvePackageWorkspaceRoot();
}

function resolveOutputPath(workspaceRoot: string, output: string) {
  const root = path.resolve(workspaceRoot);
  const candidate = path.resolve(root, output);
  if (!isPathInsideRoot(root, candidate)) {
    throw new Error("--output must resolve inside the target workspace root.");
  }
  return candidate;
}

export async function runDogfoodCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (!parsed.workspace) {
    throw new Error('Dogfood requires --workspace "<absolute path>".');
  }

  const workspaceRoot = path.resolve(parsed.workspace);
  if (!(await pathExists(workspaceRoot))) {
    throw new Error(`Workspace path does not exist or is not a directory: ${workspaceRoot}`);
  }

  const handoffOutput = parsed.output ?? DEFAULT_HANDOFF_OUTPUT;
  const workflowTiming = new GraphWorkflowTimingCollector();

  const repoRoot = await resolveOpenAgentGraphRepoRoot();
  const dataDir = path.join(repoRoot, DOGFOOD_DATA_DIR_NAME, workspaceDataDirHash(workspaceRoot));
  await fs.mkdir(dataDir, { recursive: true });

  const previousEnv = {
    DATA_DIR: process.env.DATA_DIR,
    OPENAGENTGRAPH_WORKSPACE_ROOT: process.env.OPENAGENTGRAPH_WORKSPACE_ROOT,
    NODE_ENV: process.env.NODE_ENV,
  };

  process.env.DATA_DIR = dataDir;
  process.env.OPENAGENTGRAPH_WORKSPACE_ROOT = workspaceRoot;
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = "development";
  }
  const config = loadAppConfig(process.env);
  setAppConfigOverride(config);

  const [{ closeDb, initDb }, { getProductGraphProjection }, { applyProductGraphCodebaseScanPlan }] = await Promise.all([
    import("../db/client.js"),
    import("../db/productGraphRepo.js"),
    import("../routes/productGraphRouteHelpers.js"),
  ]);

  initDb();
  try {
    const productGraphProjection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const scanOptions = {
      workflowTiming,
      projection: productGraphProjection,
      scanLimits: config.scanner.scanLimits,
      semanticScanLimits: config.scanner.semanticScanLimits,
      semanticAnalysisBudget: config.scanner.semanticAnalysisBudget,
    };

    let staticExportPaths: string[] = [];
    let staticNodeCount = 0;
    let staticEdgeCount = 0;
    let staticScannerIds: string[] = [];
    let scanResultSummary: Awaited<ReturnType<typeof applyProductGraphCodebaseScanPlan>> | undefined;
    let reportSummary: unknown;

    if (!parsed.noExport) {
      const staticExport = await runOfflineKernelGraphExport(workspaceRoot, {
        handoffPath: handoffOutput,
        ...scanOptions,
      });
      staticExportPaths = staticExport.writtenPaths;
      staticNodeCount = staticExport.graph.nodes.length;
      staticEdgeCount = staticExport.graph.edges.length;
      staticScannerIds = staticExport.graph.activeScannerIds;

      scanResultSummary = await workflowTiming.measure("product_graph_handoff", () =>
        applyProductGraphCodebaseScanPlan(staticExport.scanResult.scanPlan, {
          actorId: "dogfood",
          displayName: "Dogfood CLI",
          role: "operator",
        })
      );
    } else {
      const { runKernelWorkspaceScan } = await import("../scanner/kernel/scanKernel.js");
      const scanResult = await runKernelWorkspaceScan(workspaceRoot, scanOptions);
      scanResultSummary = await workflowTiming.measure("product_graph_handoff", () =>
        applyProductGraphCodebaseScanPlan(scanResult.scanPlan, {
          actorId: "dogfood",
          displayName: "Dogfood CLI",
          role: "operator",
        })
      );
    }

    const outputPath = resolveOutputPath(workspaceRoot, handoffOutput);

    if (parsed.noExport) {
      const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
      const handoffOptions = {
        workspaceRoot: formatHandoffWorkspaceRootForReport(workspaceRoot, config.env.isProduction),
        workspaceRootSource: "configured" as const,
        dataSource: formatHandoffDataSourceForReport(config.database.filePath, config.env.isProduction),
        workspacePathCheck: await checkProductGraphWorkspacePaths(projection, workspaceRoot),
        handoffFile: {
          path: handoffOutput,
          exists: true,
        },
      };
      const report = buildProductGraphHandoffReport(projection, handoffOptions);
      await fs.writeFile(outputPath, report.markdown, "utf8");
      reportSummary = report.summary;
    } else if (!staticExportPaths.includes(outputPath)) {
      throw new Error(`Static export did not write the requested handoff report: ${handoffOutput}`);
    }

    const stageTimings = workflowTiming.buildReport();
    const payload = {
      status: "dogfood_complete",
      workspaceRoot,
      dataDir,
      outputPath,
      staticExport: parsed.noExport
        ? undefined
        : {
            writtenPaths: staticExportPaths,
            nodeCount: staticNodeCount,
            edgeCount: staticEdgeCount,
            activeScannerIds: staticScannerIds,
          },
      scan: scanResultSummary?.scanned,
      summary: reportSummary,
      stageTimings,
    };

    if (parsed.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Workspace: ${workspaceRoot}`);
    console.log(`Data dir: ${dataDir}`);
    if (!parsed.noExport) {
      console.log(`Static export: ${staticNodeCount} nodes | ${staticEdgeCount} edges`);
      console.log(`Static scanners: ${staticScannerIds.join(", ") || "generic"}`);
      for (const writtenPath of staticExportPaths) {
        console.log(`Wrote ${writtenPath}`);
      }
    }
    if (scanResultSummary) {
      console.log(`Files indexed: ${scanResultSummary.scanned.fileCount}`);
      console.log(`Symbols indexed: ${scanResultSummary.scanned.symbolCount}`);
      console.log(`Skipped directories: ${scanResultSummary.scanned.skippedDirectoryCount}`);
      if (scanResultSummary.scanned.workspaceProfile) {
        console.log(`Detected types: ${scanResultSummary.scanned.workspaceProfile.detectedProjectTypes.join(", ")}`);
        for (const warning of scanResultSummary.scanned.workspaceProfile.warnings) {
          console.log(`Warning: ${warning}`);
        }
      }
      for (const diagnostic of scanResultSummary.scanned.diagnostics ?? []) {
        console.log(diagnostic);
      }
    }
    console.log(`Wrote ${outputPath}`);
    console.log(summarizeGraphWorkflowTiming(stageTimings).join("\n"));
  } finally {
    closeDb();
    setAppConfigOverride(undefined);
    if (previousEnv.DATA_DIR === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousEnv.DATA_DIR;
    }
    if (previousEnv.OPENAGENTGRAPH_WORKSPACE_ROOT === undefined) {
      delete process.env.OPENAGENTGRAPH_WORKSPACE_ROOT;
    } else {
      process.env.OPENAGENTGRAPH_WORKSPACE_ROOT = previousEnv.OPENAGENTGRAPH_WORKSPACE_ROOT;
    }
    if (previousEnv.NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousEnv.NODE_ENV;
    }
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/dogfood\.(?:ts|js)$/.test(invokedPath)) {
  runDogfoodCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}