import fs from "fs/promises";
import path from "path";
import {
  GRAPH_RELEASE_FIXTURE_IDS,
  buildGraphPublicScorecard,
  evaluateGraphExternalBenchmarkSuite,
  evaluateGraphUpdateBenchmarkSuite,
  formatGraphPublicScorecardMarkdown,
  formatGraphPublicScorecardReadmeTable,
} from "@openagentgraph/shared";
import { runGraphExternalBenchmarkCatalog } from "../scanner/kernel/graphExternalBenchmarkRunner.js";
import { runGraphUpdateBenchmarkSuite } from "../scanner/kernel/graphUpdateBenchmarkRunner.js";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";
import { readRequiredCliValue } from "./productGraphDataDir.js";
import { resolvePackageWorkspaceRoot } from "./productGraphDataDir.js";

const DEFAULT_FIXTURES_DIR = "tests/fixtures/graph";

interface GraphScorecardCliOptions {
  fixtures?: string;
  json: boolean;
  markdown: boolean;
  readmeTable: boolean;
  output?: string;
  includeExternal: boolean;
  includeUpdate: boolean;
}

function parseGraphScorecardArgv(argv: string[]) {
  const options: GraphScorecardCliOptions = {
    json: false,
    markdown: true,
    readmeTable: false,
    includeExternal: true,
    includeUpdate: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") {
      options.fixtures = readRequiredCliValue(argv, index, "--fixtures");
      index += 1;
    } else if (arg === "--output") {
      options.output = readRequiredCliValue(argv, index, "--output");
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--markdown") {
      options.markdown = true;
    } else if (arg === "--readme-table") {
      options.readmeTable = true;
    } else if (arg === "--no-external") {
      options.includeExternal = false;
    } else if (arg === "--no-update") {
      options.includeUpdate = false;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown graph:scorecard option: ${arg}`);
    } else {
      throw new Error(`Unknown graph:scorecard argument: ${arg}`);
    }
  }

  return options;
}

export async function runGraphScorecardCli(argv = process.argv.slice(2)) {
  const options = parseGraphScorecardArgv(argv);
  const repoRoot = await resolvePackageWorkspaceRoot();
  const fixturesRoot = path.resolve(repoRoot, options.fixtures ?? DEFAULT_FIXTURES_DIR);

  const releaseResults = [];
  for (const fixtureId of GRAPH_RELEASE_FIXTURE_IDS) {
    const fixturePath = path.join(fixturesRoot, fixtureId);
    const startedAt = Date.now();
    const scan = await runKernelWorkspaceScan(fixturePath);
    releaseResults.push({
      fixture: fixtureId,
      graph: scan.unifiedGraph,
      kernelProfile: scan.kernelProfile,
      scanMs: Date.now() - startedAt,
    });
  }

  let externalResults;
  if (options.includeExternal) {
    externalResults = await runGraphExternalBenchmarkCatalog({ fixturesRoot });
  }

  let updateBenchmarkSummary: string | undefined;
  let updateBenchmarkOk: boolean | undefined;
  if (options.includeUpdate) {
    const updateResults = await runGraphUpdateBenchmarkSuite({ fixturesRoot });
    const updateSuite = evaluateGraphUpdateBenchmarkSuite(updateResults);
    updateBenchmarkOk = updateSuite.ok;
    updateBenchmarkSummary = updateSuite.ok ? "PASS" : "FAIL";
  }

  const scorecard = buildGraphPublicScorecard({
    releaseResults,
    externalResults,
    updateBenchmarkOk,
    updateBenchmarkSummary,
  });

  if (options.includeExternal && externalResults) {
    const externalSuite = evaluateGraphExternalBenchmarkSuite(externalResults);
    scorecard.externalPassCount = externalSuite.results.filter((result) => result.passed).length;
  }

  const markdown = formatGraphPublicScorecardMarkdown(scorecard);
  const readmeTable = formatGraphPublicScorecardReadmeTable(scorecard);

  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.writeFile(outputPath, options.readmeTable ? `${readmeTable}\n` : markdown, "utf8");
    console.log(`Wrote scorecard to ${outputPath}`);
  }

  if (options.json) {
    console.log(JSON.stringify(scorecard, null, 2));
  } else if (options.readmeTable) {
    console.log(readmeTable);
  } else if (options.markdown) {
    console.log(markdown);
  }

  return scorecard;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphScorecard\.(?:ts|js)$/.test(invokedPath)) {
  runGraphScorecardCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}