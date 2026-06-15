import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { buildProductGraphHandoffReport } from "@openagentgraph/shared";
import { loadAppConfig, setAppConfigOverride } from "../config.js";
import {
  checkProductGraphWorkspacePaths,
  formatHandoffDataSourceForReport,
  formatHandoffWorkspaceRootForReport,
  isPathInsideRoot,
} from "../productGraphHandoffTrust.js";
import { resolvePackageWorkspaceRoot } from "./productGraphDataDir.js";

const DEFAULT_PRODUCT_GRAPH_ID = "default";
const DEFAULT_HANDOFF_OUTPUT = "GRAPH_REPORT.md";
const DOGFOOD_DATA_DIR_NAME = ".tmp-dogfood-data";

interface DogfoodCliOptions {
  workspace?: string;
  output?: string;
  json: boolean;
}

function readRequiredCliValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv: string[]): DogfoodCliOptions {
  const options: DogfoodCliOptions = { json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      options.workspace = readRequiredCliValue(argv, index, "--workspace");
      index += 1;
    } else if (arg === "--output") {
      options.output = readRequiredCliValue(argv, index, "--output");
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
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
  setAppConfigOverride(loadAppConfig(process.env));

  const [{ closeDb, initDb }, { getProductGraphProjection }, { runProductGraphCodebaseScan }] = await Promise.all([
    import("../db/client.js"),
    import("../db/productGraphRepo.js"),
    import("../routes/productGraphRouteHelpers.js"),
  ]);

  initDb();
  try {
    const scanResult = await runProductGraphCodebaseScan({
      actorId: "dogfood",
      displayName: "Dogfood CLI",
      role: "operator",
    });

    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const config = loadAppConfig(process.env);
    const handoffOptions = {
      workspaceRoot: formatHandoffWorkspaceRootForReport(workspaceRoot, config.env.isProduction),
      workspaceRootSource: "configured" as const,
      dataSource: formatHandoffDataSourceForReport(config.database.filePath, config.env.isProduction),
      workspacePathCheck: await checkProductGraphWorkspacePaths(projection, workspaceRoot),
      handoffFile: {
        path: parsed.output ?? DEFAULT_HANDOFF_OUTPUT,
        exists: true,
      },
    };
    const report = buildProductGraphHandoffReport(projection, handoffOptions);
    const outputPath = resolveOutputPath(workspaceRoot, parsed.output ?? DEFAULT_HANDOFF_OUTPUT);
    await fs.writeFile(outputPath, report.markdown, "utf8");

    const payload = {
      status: "dogfood_complete",
      workspaceRoot,
      dataDir,
      outputPath,
      scan: scanResult.scanned,
      summary: report.summary,
    };

    if (parsed.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Workspace: ${workspaceRoot}`);
    console.log(`Data dir: ${dataDir}`);
    console.log(`Files indexed: ${scanResult.scanned.fileCount}`);
    console.log(`Symbols indexed: ${scanResult.scanned.symbolCount}`);
    console.log(`Skipped directories: ${scanResult.scanned.skippedDirectoryCount}`);
    if (scanResult.scanned.workspaceProfile) {
      console.log(`Detected types: ${scanResult.scanned.workspaceProfile.detectedProjectTypes.join(", ")}`);
      for (const warning of scanResult.scanned.workspaceProfile.warnings) {
        console.log(`Warning: ${warning}`);
      }
    }
    for (const diagnostic of scanResult.scanned.diagnostics ?? []) {
      console.log(diagnostic);
    }
    console.log(`Wrote ${outputPath}`);
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