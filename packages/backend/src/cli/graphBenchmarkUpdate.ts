import path from "path";
import {
  evaluateGraphUpdateBenchmarkSuite,
  formatGraphUpdateBenchmarkReport,
  formatGraphUpdateBenchmarkSummaryLine,
  GRAPH_UPDATE_BENCHMARK_DOGFOOD_MAX_WARM_MS,
  GRAPH_UPDATE_BENCHMARK_FIXTURE_MAX_WARM_MS,
  parseGraphUpdateBenchmarkScenarioId,
} from "@openagentgraph/shared";
import {
  runGraphUpdateBenchmarkForWorkspace,
  runGraphUpdateBenchmarkSuite,
} from "../scanner/kernel/graphUpdateBenchmarkRunner.js";
import { resolvePackageWorkspaceRoot } from "./productGraphDataDir.js";

const DEFAULT_FIXTURES_DIR = "tests/fixtures/graph";

interface GraphBenchmarkUpdateCliOptions {
  workspace?: string;
  changedFiles: number;
  fixtures?: string;
  scenario?: string;
  json: boolean;
  report: boolean;
  maxWarmMs?: number;
  inPlace: boolean;
}

function readRequiredCliValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv: string[]): GraphBenchmarkUpdateCliOptions {
  const options: GraphBenchmarkUpdateCliOptions = {
    changedFiles: 10,
    json: false,
    report: false,
    inPlace: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      options.workspace = readRequiredCliValue(argv, index, "--workspace");
      index += 1;
    } else if (arg === "--changed-files") {
      options.changedFiles = Number(readRequiredCliValue(argv, index, "--changed-files"));
      index += 1;
    } else if (arg === "--fixtures") {
      options.fixtures = readRequiredCliValue(argv, index, "--fixtures");
      index += 1;
    } else if (arg === "--scenario") {
      options.scenario = readRequiredCliValue(argv, index, "--scenario");
      index += 1;
    } else if (arg === "--in-place") {
      options.inPlace = true;
    } else if (arg === "--max-warm-ms") {
      options.maxWarmMs = Number(readRequiredCliValue(argv, index, "--max-warm-ms"));
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--report") {
      options.report = true;
    } else {
      throw new Error(`Unknown graph:benchmark:update option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.changedFiles) || options.changedFiles < 1) {
    throw new Error("--changed-files must be a positive number.");
  }
  if (options.maxWarmMs !== undefined && (!Number.isFinite(options.maxWarmMs) || options.maxWarmMs < 1)) {
    throw new Error("--max-warm-ms must be a positive number.");
  }
  if (options.workspace && options.scenario) {
    throw new Error("--scenario cannot be used with --workspace; workspace mode runs a custom benchmark only.");
  }

  return options;
}

export async function runGraphBenchmarkUpdateCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const repoRoot = await resolvePackageWorkspaceRoot();
  const fixturesRoot = path.resolve(repoRoot, options.fixtures ?? DEFAULT_FIXTURES_DIR);
  const maxWarmMs = options.maxWarmMs
    ?? (options.workspace ? GRAPH_UPDATE_BENCHMARK_DOGFOOD_MAX_WARM_MS : GRAPH_UPDATE_BENCHMARK_FIXTURE_MAX_WARM_MS);
  const scenarioId = options.scenario ? parseGraphUpdateBenchmarkScenarioId(options.scenario) : undefined;

  let results;
  if (options.workspace) {
    results = [
      await runGraphUpdateBenchmarkForWorkspace({
        workspaceRoot: path.resolve(options.workspace),
        changedFiles: options.changedFiles,
        maxWarmMs,
        inPlace: options.inPlace,
      }),
    ];
  } else {
    results = await runGraphUpdateBenchmarkSuite({
      fixturesRoot,
      scenarioIds: scenarioId ? [scenarioId] : undefined,
      maxWarmMs,
    });
    if (scenarioId && results.length === 0) {
      throw new Error(`Benchmark scenario '${scenarioId}' did not produce a result.`);
    }
  }

  const suite = evaluateGraphUpdateBenchmarkSuite(results, {
    maxWarmMs,
    requireAllScenarios: !scenarioId && !options.workspace,
  });
  const payload = {
    ok: suite.ok,
    maxWarmMs: suite.maxWarmMs,
    results: suite.results,
    errors: suite.errors,
    reportMarkdown: options.report ? formatGraphUpdateBenchmarkReport(suite.results) : undefined,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const result of suite.results) {
      const status = result.passed ? "PASS" : "FAIL";
      console.log(
        `${status} ${result.scenarioId} mode=${result.updateMode} cold=${result.coldScanMs}ms warm=${result.warmUpdateMs}ms changed=${result.changedFileCount} rescanned=${result.rescannedFileCount} neighbors=${result.neighborExpansionCount}`
      );
      if (result.fallbackReasons.length > 0) {
        console.log(`  fallback: ${result.fallbackReasons.join("; ")}`);
      }
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
    }
    console.log(formatGraphUpdateBenchmarkSummaryLine(suite));
    for (const error of suite.errors) {
      console.log(`  - ${error}`);
    }
    if (options.report) {
      console.log("");
      console.log(payload.reportMarkdown);
    }
  }

  if (!suite.ok) {
    throw new Error(`Graph update benchmark failed (${suite.errors.length} issue(s)).`);
  }

  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphBenchmarkUpdate\.(?:ts|js)$/.test(invokedPath)) {
  runGraphBenchmarkUpdateCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}