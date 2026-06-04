import fs from "fs/promises";
import path from "path";
import type {
  ProductGraphHandoffOptions,
  ProductGraphProjection,
} from "@openagentgraph/shared";
import { buildProductGraphHandoffReport } from "@openagentgraph/shared";
import { getAppConfig } from "../config.js";
import {
  checkProductGraphWorkspacePaths,
  formatHandoffDataSourceForReport,
  formatHandoffWorkspaceRootForReport,
  isPathInsideRoot,
} from "../productGraphHandoffTrust.js";
import {
  applyProductGraphCliDataDir,
  readRequiredCliValue,
  resolvePackageWorkspaceRoot,
} from "./productGraphDataDir.js";

const DEFAULT_PRODUCT_GRAPH_ID = "default";
const DEFAULT_HANDOFF_OUTPUT = "GRAPH_REPORT.md";

interface HandoffCliOptions {
  productGraphId: string;
  output?: string;
  dataDir?: string;
  json: boolean;
}

function parseArgs(argv: string[]): HandoffCliOptions {
  const options: HandoffCliOptions = {
    productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--product-graph-id") {
      options.productGraphId = argv[index + 1] ?? options.productGraphId;
      index += 1;
    } else if (arg === "--output") {
      options.output = argv[index + 1] ?? DEFAULT_HANDOFF_OUTPUT;
      index += 1;
    } else if (arg === "--data-dir") {
      options.dataDir = readRequiredCliValue(argv, index, "--data-dir");
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown handoff option: ${arg}`);
    }
  }

  return options;
}

async function resolveWorkspaceContext() {
  const configuredRoot = getAppConfig().workspace.root;
  if (configuredRoot) {
    return {
      root: path.resolve(configuredRoot),
      source: "configured" as const,
    };
  }
  return {
    root: await resolvePackageWorkspaceRoot(),
    source: "inferred" as const,
  };
}

function resolveOutputPath(workspaceRoot: string, output: string) {
  const root = path.resolve(workspaceRoot);
  const candidate = path.resolve(root, output);
  if (!isPathInsideRoot(root, candidate)) {
    throw new Error("--output must resolve inside the configured workspace root.");
  }
  return candidate;
}

async function handoffFileStatus(workspaceRoot: string, output = DEFAULT_HANDOFF_OUTPUT) {
  const outputPath = resolveOutputPath(workspaceRoot, output);
  const relativePath = path.relative(workspaceRoot, outputPath) || output;
  try {
    const stat = await fs.stat(outputPath);
    return {
      path: relativePath,
      exists: stat.isFile(),
      ...(stat.isFile() ? { updatedAt: stat.mtime.toISOString() } : {}),
    };
  } catch {
    return {
      path: relativePath,
      exists: false,
    };
  }
}

async function buildCliHandoffOptions(input: {
  projection: ProductGraphProjection;
  workspaceRoot: string;
  workspaceRootSource: ProductGraphHandoffOptions["workspaceRootSource"];
  output?: string;
  handoffFileExists?: boolean;
}): Promise<ProductGraphHandoffOptions> {
  const config = getAppConfig();
  const currentHandoffFile = await handoffFileStatus(input.workspaceRoot, input.output ?? DEFAULT_HANDOFF_OUTPUT);
  return {
    workspaceRoot: formatHandoffWorkspaceRootForReport(input.workspaceRoot, config.env.isProduction),
    workspaceRootSource: input.workspaceRootSource,
    dataSource: formatHandoffDataSourceForReport(config.database.filePath, config.env.isProduction),
    workspacePathCheck: await checkProductGraphWorkspacePaths(input.projection, input.workspaceRoot),
    handoffFile: typeof input.handoffFileExists === "boolean"
      ? {
          path: currentHandoffFile.path,
          exists: input.handoffFileExists,
        }
      : currentHandoffFile,
  };
}

export async function runHandoffCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const workspace = await resolveWorkspaceContext();
  await applyProductGraphCliDataDir({ explicitDataDir: parsed.dataDir });

  const [{ closeDb, initDb }, { getProductGraphProjection }] = await Promise.all([
    import("../db/client.js"),
    import("../db/productGraphRepo.js"),
  ]);

  initDb();
  try {
    const projection = await getProductGraphProjection(parsed.productGraphId);
    const handoffOptions = await buildCliHandoffOptions({
      projection,
      workspaceRoot: workspace.root,
      workspaceRootSource: workspace.source,
      output: parsed.output,
      handoffFileExists: parsed.output ? true : undefined,
    });
    if (parsed.output && handoffOptions.workspacePathCheck?.status === "mismatch") {
      const targetName = path.relative(workspace.root, resolveOutputPath(workspace.root, parsed.output)) || parsed.output;
      throw new Error(
        `Product Graph code paths do not match the configured workspace root. Refresh the codebase scan or point OpenAgentGraph at the matching workspace before writing ${targetName}.`
      );
    }
    const report = buildProductGraphHandoffReport(projection, handoffOptions);

    if (parsed.output) {
      const outputPath = resolveOutputPath(workspace.root, parsed.output);
      await fs.writeFile(outputPath, report.markdown, "utf8");
      if (parsed.json) {
        console.log(JSON.stringify({ status: "written", path: outputPath, ...report }, null, 2));
      } else {
        console.log(`Wrote ${outputPath}`);
      }
      return;
    }

    if (parsed.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(report.markdown);
  } finally {
    closeDb();
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/handoff\.(?:ts|js)$/.test(invokedPath)) {
  runHandoffCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
