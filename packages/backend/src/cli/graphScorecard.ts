import fsPromises from "fs/promises";
import path from "path";
import fs from "fs";
import {
  GRAPH_RELEASE_FIXTURE_IDS,
  buildGraphPublicScorecard,
  evaluateContextNoise,
  evaluateGraphExternalBenchmarkSuite,
  evaluateGraphRelevanceBaselineSuite,
  evaluateGraphUpdateBenchmarkSuite,
  evaluateReleaseBenchmarkSuite,
  formatAgenticSdlcScorecardMarkdown,
  formatGraphPublicScorecardMarkdown,
  formatGraphPublicScorecardReadmeTable,
} from "@openagentgraph/shared";
import {
  buildHarnessContextNoiseDiagnostics,
  buildWorkspaceAgenticSdlcScorecard,
  loadHarnessWorkspaceMetadata,
} from "./graphHarnessMetadata.js";
import { readHandoffFreshness, requireWorkspaceOption } from "./graphWorkspace.js";
import { detectWorkspaceKernelProfile } from "../scanner/kernel/workspaceDetection.js";
import { runGraphExternalBenchmarkCatalog } from "../scanner/kernel/graphExternalBenchmarkRunner.js";
import { runGraphUpdateBenchmarkSuite } from "../scanner/kernel/graphUpdateBenchmarkRunner.js";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";
import { readRequiredCliValue } from "./productGraphDataDir.js";
import { resolvePackageWorkspaceRoot } from "./productGraphDataDir.js";

const DEFAULT_FIXTURES_DIR = "tests/fixtures/graph";
const HARNESS_CONTEXT_NOISE_FIXTURES = [
  "fixture-agentic-harness-good",
  "fixture-agentic-harness-noisy",
] as const;

const AGENTIC_SDLC_FIXTURES = [
  "fixture-agentic-harness-good",
  "fixture-agentic-harness-missing",
  "fixture-agentic-harness-conflicting",
  "fixture-agentic-harness-noisy",
] as const;

type CliCleanInstallSmokeStatus = "pass" | "fail" | "not_run";

interface GraphScorecardCliOptions {
  fixtures?: string;
  workspace?: string;
  json: boolean;
  markdown: boolean;
  readmeTable: boolean;
  output?: string;
  includeExternal: boolean;
  includeUpdate: boolean;
  agenticSdlc: boolean;
  cliSmokeStatus: CliCleanInstallSmokeStatus;
}

function parseCliSmokeStatus(value: string): CliCleanInstallSmokeStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pass" || normalized === "fail" || normalized === "not_run") {
    return normalized;
  }
  throw new Error(`Invalid --cli-smoke-status value '${value}'. Expected pass, fail, or not_run.`);
}

export function parseGraphScorecardArgv(argv: string[]) {
  const options: GraphScorecardCliOptions = {
    json: false,
    markdown: true,
    readmeTable: false,
    includeExternal: true,
    includeUpdate: true,
    agenticSdlc: false,
    cliSmokeStatus: "not_run",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") {
      options.fixtures = readRequiredCliValue(argv, index, "--fixtures");
      index += 1;
    } else if (arg === "--workspace") {
      options.workspace = readRequiredCliValue(argv, index, "--workspace");
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
    } else if (arg === "--agentic-sdlc") {
      options.agenticSdlc = true;
    } else if (arg === "--cli-smoke-status") {
      options.cliSmokeStatus = parseCliSmokeStatus(readRequiredCliValue(argv, index, "--cli-smoke-status"));
      index += 1;
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

  if (options.agenticSdlc) {
    const workspaceRoot = requireWorkspaceOption(options.workspace ?? repoRoot);
    const scan = await runKernelWorkspaceScan(workspaceRoot);
    const metadata = loadHarnessWorkspaceMetadata(workspaceRoot);
    const kernelProfile = scan.kernelProfile ?? await detectWorkspaceKernelProfile(workspaceRoot);
    const handoffFreshness = await readHandoffFreshness(workspaceRoot, scan.unifiedGraph.generatedAt);
    const scorecard = buildWorkspaceAgenticSdlcScorecard(workspaceRoot, scan.unifiedGraph, {
      metadata,
      kernelProfile,
      handoffFreshness,
    });
    const markdown = formatAgenticSdlcScorecardMarkdown(scorecard);
    if (options.output) {
      const outputPath = path.resolve(options.output);
      await fsPromises.writeFile(outputPath, markdown, "utf8");
      console.log(`Wrote agentic SDLC scorecard to ${outputPath}`);
    }
    if (options.json) {
      console.log(JSON.stringify(scorecard, null, 2));
    } else if (!options.readmeTable) {
      console.log(markdown);
    }
    return scorecard;
  }

  const harnessContextNoiseSamples: Array<{ fixture: string; score: number }> = [];
  const agenticSdlcFixtureSamples: Array<{ fixture: string; overallScore: number; ok: boolean }> = [];
  for (const fixtureId of HARNESS_CONTEXT_NOISE_FIXTURES) {
    const fixturePath = path.join(fixturesRoot, fixtureId);
    if (!fs.existsSync(fixturePath)) continue;
    const scan = await runKernelWorkspaceScan(fixturePath);
    const noise = evaluateContextNoise(
      scan.unifiedGraph,
      buildHarnessContextNoiseDiagnostics(fixturePath, scan.unifiedGraph, {
        kernelProfile: scan.kernelProfile,
      })
    );
    harnessContextNoiseSamples.push({ fixture: fixtureId, score: noise.score });
  }

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

  let updateBenchmarkResults;
  let updateBenchmarkSummary: string | undefined;
  let updateBenchmarkOk: boolean | undefined;
  if (options.includeUpdate) {
    updateBenchmarkResults = await runGraphUpdateBenchmarkSuite({ fixturesRoot });
    const updateSuite = evaluateGraphUpdateBenchmarkSuite(updateBenchmarkResults);
    updateBenchmarkOk = updateSuite.ok;
    updateBenchmarkSummary = updateSuite.ok ? "PASS" : "FAIL";
  }

  for (const fixtureId of AGENTIC_SDLC_FIXTURES) {
    const fixturePath = path.join(fixturesRoot, fixtureId);
    if (!fs.existsSync(fixturePath)) continue;
    const scan = await runKernelWorkspaceScan(fixturePath);
    const metadata = loadHarnessWorkspaceMetadata(fixturePath);
    const scorecard = buildWorkspaceAgenticSdlcScorecard(fixturePath, scan.unifiedGraph, {
      metadata,
      kernelProfile: scan.kernelProfile,
    });
    agenticSdlcFixtureSamples.push({
      fixture: fixtureId,
      overallScore: scorecard.overallScore,
      ok: scorecard.ok,
    });
  }

  const releaseSuite = evaluateReleaseBenchmarkSuite({ results: releaseResults });
  const pathDetourFailures = releaseSuite.releaseResults.flatMap((result) =>
    result.pathBenchmarks.filter((benchmark) => !benchmark.passed && /forbidden node kind/i.test(benchmark.detail))
  ).length;
  const generatedArtifactBrokenLinkCount = releaseSuite.releaseResults
    .filter((result) => result.fixture !== "fixture-docs-broken-links")
    .reduce((sum, result) => sum + result.docLinkHygiene.brokenCount, 0);
  const relevanceBaseline = evaluateGraphRelevanceBaselineSuite({
    results: releaseResults.map((result) => ({
      fixture: result.fixture,
      graph: result.graph,
    })),
    pathDetourFailures,
    generatedArtifactBrokenLinkCount,
  });

  const scorecard = buildGraphPublicScorecard({
    releaseResults,
    externalResults,
    updateBenchmarkResults,
    updateBenchmarkOk,
    updateBenchmarkSummary,
    relevanceBaseline,
    pathDetourFailures,
    cliCleanInstallSmokeStatus: options.cliSmokeStatus,
    harnessContextNoiseSamples,
    agenticSdlcFixtureSamples,
  });

  if (options.includeExternal && externalResults) {
    const externalSuite = evaluateGraphExternalBenchmarkSuite(externalResults);
    scorecard.externalPassCount = externalSuite.results.filter((result) => result.passed).length;
  }

  const markdown = formatGraphPublicScorecardMarkdown(scorecard);
  const readmeTable = formatGraphPublicScorecardReadmeTable(scorecard);

  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fsPromises.writeFile(outputPath, options.readmeTable ? `${readmeTable}\n` : markdown, "utf8");
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