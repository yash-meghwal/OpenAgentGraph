import fs from "fs/promises";
import path from "path";
import {
  evaluateGraphExternalBenchmarkSuite,
  formatGraphExternalBenchmarkReport,
  formatGraphExternalBenchmarkSummaryLine,
  parseGraphExternalBenchmarkCategoryId,
} from "@openagentgraph/shared";
import {
  cleanupExternalBenchmarkWorkspace,
  resolveExternalBenchmarkWorkspace,
  runGraphExternalBenchmarkCatalog,
  runGraphExternalBenchmarkForWorkspace,
} from "../scanner/kernel/graphExternalBenchmarkRunner.js";
import { resolvePackageWorkspaceRoot } from "./productGraphDataDir.js";

const DEFAULT_FIXTURES_DIR = "tests/fixtures/graph";

interface GraphBenchmarkExternalCliOptions {
  workspace?: string;
  clone?: string;
  category?: string;
  catalog: boolean;
  fixtures?: string;
  json: boolean;
  report: boolean;
  output?: string;
  includeUpdateBenchmark: boolean;
  changedFiles: number;
}

function readRequiredCliValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv: string[]): GraphBenchmarkExternalCliOptions {
  const options: GraphBenchmarkExternalCliOptions = {
    catalog: false,
    json: false,
    report: false,
    includeUpdateBenchmark: false,
    changedFiles: 1,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      options.workspace = readRequiredCliValue(argv, index, "--workspace");
      index += 1;
    } else if (arg === "--clone") {
      options.clone = readRequiredCliValue(argv, index, "--clone");
      index += 1;
    } else if (arg === "--category") {
      options.category = readRequiredCliValue(argv, index, "--category");
      index += 1;
    } else if (arg === "--fixtures") {
      options.fixtures = readRequiredCliValue(argv, index, "--fixtures");
      index += 1;
    } else if (arg === "--output") {
      options.output = readRequiredCliValue(argv, index, "--output");
      index += 1;
    } else if (arg === "--changed-files") {
      options.changedFiles = Number(readRequiredCliValue(argv, index, "--changed-files"));
      index += 1;
    } else if (arg === "--catalog") {
      options.catalog = true;
    } else if (arg === "--include-update-benchmark") {
      options.includeUpdateBenchmark = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--report") {
      options.report = true;
    } else {
      throw new Error(`Unknown graph:benchmark:external option: ${arg}`);
    }
  }

  if (!options.catalog && !options.workspace && !options.clone) {
    throw new Error("graph:benchmark:external requires --workspace, --clone, or --catalog.");
  }
  if (options.catalog && (options.workspace || options.clone)) {
    throw new Error("--catalog cannot be combined with --workspace or --clone.");
  }
  if (options.workspace && options.clone) {
    throw new Error("--workspace cannot be combined with --clone.");
  }
  if (!Number.isFinite(options.changedFiles) || options.changedFiles < 1) {
    throw new Error("--changed-files must be a positive number.");
  }

  return options;
}

export async function runGraphBenchmarkExternalCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const repoRoot = await resolvePackageWorkspaceRoot();
  const fixturesRoot = path.resolve(repoRoot, options.fixtures ?? DEFAULT_FIXTURES_DIR);

  let results: Awaited<ReturnType<typeof runGraphExternalBenchmarkCatalog>> = [];
  let tempRoot: string | undefined;
  try {
    if (options.catalog) {
      results = await runGraphExternalBenchmarkCatalog({
        fixturesRoot,
        includeUpdateBenchmark: options.includeUpdateBenchmark,
        changedFiles: options.changedFiles,
      });
    } else {
      const resolved = resolveExternalBenchmarkWorkspace({
        workspaceRoot: options.workspace,
        cloneUrl: options.clone,
        fixturesRoot,
      });
      tempRoot = "tempRoot" in resolved ? resolved.tempRoot : undefined;
      const categoryId = options.category
        ? parseGraphExternalBenchmarkCategoryId(options.category)
        : "mixed-monorepo";
      results = [
        await runGraphExternalBenchmarkForWorkspace({
          categoryId,
          workspaceRoot: resolved.workspaceRoot,
          includeUpdateBenchmark: options.includeUpdateBenchmark,
          changedFiles: options.changedFiles,
        }),
      ];
    }
  } finally {
    cleanupExternalBenchmarkWorkspace(tempRoot);
  }

  const suite = evaluateGraphExternalBenchmarkSuite(results, {
    requireAllCategories: options.catalog,
  });
  const report = formatGraphExternalBenchmarkReport(results);
  const payload = {
    ok: suite.ok,
    summary: formatGraphExternalBenchmarkSummaryLine(suite),
    results,
    errors: suite.errors,
    report,
  };

  if (options.output) {
    await fs.writeFile(path.resolve(options.output), report, "utf8");
  }

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(payload.summary);
    for (const error of suite.errors) {
      console.log(`  - ${error}`);
    }
    if (options.report) {
      console.log("");
      console.log(report);
    }
  }

  if (!suite.ok) {
    throw new Error("External benchmark suite failed.");
  }

  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphBenchmarkExternal\.(?:ts|js)$/.test(invokedPath)) {
  runGraphBenchmarkExternalCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}