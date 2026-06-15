import fs from "fs/promises";
import path from "path";
import {
  evaluateReleaseBenchmarkSuite,
  GRAPH_RELEASE_FIXTURE_IDS,
  GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE,
} from "@openagentgraph/shared";
import { runKernelWorkspaceScan, type KernelScanResult } from "../scanner/kernel/scanKernel.js";
import { resolvePackageWorkspaceRoot } from "./productGraphDataDir.js";

const DEFAULT_FIXTURES_DIR = "tests/fixtures/graph";

interface VerifyGraphCliOptions {
  fixtures?: string;
  json: boolean;
}

interface FixtureCheckResult {
  fixture: string;
  passed: boolean;
  errors: string[];
  activeScanners: string[];
  indexedFileCount: number;
  skippedCountsByReason: Record<string, number>;
  scanMs: number;
}

interface FixtureScanBundle {
  fixture: string;
  scan: KernelScanResult;
  scanMs: number;
}

function readRequiredCliValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv: string[]): VerifyGraphCliOptions {
  const options: VerifyGraphCliOptions = { json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") {
      options.fixtures = readRequiredCliValue(argv, index, "--fixtures");
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown verify:graph option: ${arg}`);
    }
  }

  return options;
}

async function listFixtureDirectories(fixturesRoot: string) {
  const entries = await fs.readdir(fixturesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function assertNoGeneratedPaths(indexedPaths: string[], errors: string[]) {
  const noisyPatterns = ["/bin/", "/obj/", "graphify-out/", "/dist/"];
  for (const indexedPath of indexedPaths) {
    for (const pattern of noisyPatterns) {
      if (indexedPath.includes(pattern) || indexedPath.startsWith(pattern.replace(/^\//, ""))) {
        errors.push(`Generated or ignored path indexed: ${indexedPath}`);
      }
    }
  }
}

function verifyFixture(bundle: FixtureScanBundle): FixtureCheckResult {
  const { fixture: fixtureName, scan: result } = bundle;
  const errors: string[] = [];
  const indexedPaths = result.scanPlan.nodes
    .filter((node) => node.kind === "code_file")
    .map((node) => node.title);

  switch (fixtureName) {
    case "mixed-dotnet-node":
      if (!result.kernelProfile.activeScannerIds.includes("dotnet")) {
        errors.push("Expected dotnet scanner to be active.");
      }
      if (!result.kernelProfile.activeScannerIds.includes("typescript")) {
        errors.push("Expected typescript scanner to be active.");
      }
      if (!indexedPaths.includes("src/App.cs")) {
        errors.push("Expected src/App.cs to be indexed.");
      }
      if (!indexedPaths.includes("web/index.ts")) {
        errors.push("Expected web/index.ts to be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "wrapper-layout":
      if (!result.kernelProfile.warnings.some((warning) => warning.includes("Wrapper layout detected"))) {
        errors.push("Expected wrapper layout warning.");
      }
      if (!result.kernelProfile.markerPaths.some((marker) => marker.includes("repo/App.sln"))) {
        errors.push("Expected nested App.sln marker under repo/.");
      }
      break;
    case "gitignore-dist":
      if ((result.scanPlan.summary.skippedCountsByReason?.gitignore ?? 0) <= 0) {
        errors.push("Expected gitignore skip counts for generated/ output.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.startsWith("generated/"))) {
        errors.push("generated/ output must not be indexed when gitignored.");
      }
      break;
    case "empty-greenfield":
      if (result.kernelProfile.primaryType !== "empty-greenfield") {
        errors.push(`Expected empty-greenfield primary type, got ${result.kernelProfile.primaryType}.`);
      }
      if (!result.kernelProfile.activeScannerIds.includes("generic")) {
        errors.push("Expected generic scanner for empty-greenfield fixture.");
      }
      break;
    case "nested-gitignore":
      if (indexedPaths.some((indexedPath) => indexedPath.includes("package/generated/"))) {
        errors.push("Nested package/.gitignore must exclude package/generated/ output.");
      }
      if (!indexedPaths.includes("package/src/index.ts")) {
        errors.push("Expected package/src/index.ts to remain indexed.");
      }
      if ((result.scanPlan.summary.skippedCountsByReason?.gitignore ?? 0) <= 0) {
        errors.push("Expected gitignore skip counts for nested generated/ output.");
      }
      break;
    case "fixture-python-app":
      if (!result.kernelProfile.activeScannerIds.includes("python")) {
        errors.push("Expected python scanner to be active.");
      }
      if (!indexedPaths.includes("src/app.py")) {
        errors.push("Expected src/app.py to be indexed with T1 python scanner.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("main"))) {
        errors.push("Expected python symbols to be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "unsupported-ruby":
      if ((result.scanPlan.summary.skippedCountsByReason?.unsupported ?? 0) <= 0) {
        errors.push("Expected unsupported skip counts for .rb source files.");
      }
      if (result.scanPlan.summary.diagnostics.join("\n").includes("No skipped paths recorded.")) {
        errors.push("Unsupported-language repos must not report 'No skipped paths recorded.'");
      }
      break;
    case "fixture-next-app":
      if (!result.kernelProfile.activeScannerIds.includes("typescript")) {
        errors.push("Expected typescript scanner to be active.");
      }
      if (!result.kernelProfile.markerPaths.some((marker) => marker.includes("next.config.ts"))) {
        errors.push("Expected next.config.ts workspace marker.");
      }
      if (!indexedPaths.includes("app/page.tsx")) {
        errors.push("Expected app/page.tsx to be indexed.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes(".next/"))) {
        errors.push(".next/ build output must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-python-django":
      if (!result.kernelProfile.activeScannerIds.includes("python")) {
        errors.push("Expected python scanner to be active.");
      }
      if (!indexedPaths.includes("myapp/models.py")) {
        errors.push("Expected myapp/models.py to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("User"))) {
        errors.push("Expected Django model symbols to be indexed.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes(".venv/"))) {
        errors.push(".venv/ must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-go-module":
      if (!result.kernelProfile.activeScannerIds.includes("go")) {
        errors.push("Expected go scanner to be active.");
      }
      if (!indexedPaths.includes("go.mod")) {
        errors.push("Expected go.mod to be indexed.");
      }
      if (!indexedPaths.includes("internal/service/service.go")) {
        errors.push("Expected service.go to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("Runner"))) {
        errors.push("Expected Go struct symbols to be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-rust-workspace":
      if (!result.kernelProfile.activeScannerIds.includes("rust")) {
        errors.push("Expected rust scanner to be active.");
      }
      if (!indexedPaths.includes("Cargo.toml")) {
        errors.push("Expected workspace Cargo.toml to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("CoreService"))) {
        errors.push("Expected Rust struct symbols to be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-terraform":
      if (!result.kernelProfile.activeScannerIds.includes("terraform")) {
        errors.push("Expected terraform scanner to be active.");
      }
      if (!indexedPaths.includes("main.tf")) {
        errors.push("Expected main.tf to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("aws_s3_bucket"))) {
        errors.push("Expected Terraform resource symbols to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "terraform_module")) {
        errors.push("Expected Terraform module edges.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes(".terraform/"))) {
        errors.push(".terraform/ cache must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-docs-only":
      if (!result.kernelProfile.secondaryTypes.includes("documentation-corpus")
        && result.kernelProfile.primaryType !== "documentation-corpus") {
        errors.push("Expected documentation-corpus project type.");
      }
      if (!indexedPaths.includes("docs/architecture.md")) {
        errors.push("Expected docs/architecture.md to be indexed.");
      }
      if (result.scanPlan.nodes.some((node) => node.kind === "code_symbol")) {
        errors.push("Docs-only fixture should not emit code symbols.");
      }
      break;
    case "fixture-csharp-wpf":
    case "fixture-csharp-media-player":
      if (!result.kernelProfile.activeScannerIds.includes("dotnet")) {
        errors.push("Expected dotnet scanner to be active.");
      }
      if (!indexedPaths.includes("SampleMediaPlayer.App/ViewModels/MainViewModel.cs")) {
        errors.push("Expected MainViewModel.cs to be indexed.");
      }
      if (!indexedPaths.includes("SampleMediaPlayer.Core/SampleMediaPlayer.Core.csproj")) {
        errors.push("Expected SampleMediaPlayer.Core project to be indexed.");
      }
      const symbolTitles = result.scanPlan.nodes
        .filter((node) => node.kind === "code_symbol")
        .map((node) => node.title);
      if (!symbolTitles.some((title) => title.includes("MainViewModel"))) {
        errors.push("Expected MainViewModel symbol to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.kind === "depends_on" && edge.metadata?.scannerRelation === "project_reference")) {
        errors.push("Expected project reference edges between csproj files.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "xaml_code_behind")) {
        errors.push("Expected XAML code-behind edges.");
      }
      if (fixtureName === "fixture-csharp-media-player" && symbolTitles.length < 4) {
        errors.push("Expected SampleMediaPlayer stand-in fixture to index multiple C# symbols.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-mixed-polyglot":
      if (!result.kernelProfile.activeScannerIds.includes("dotnet")) {
        errors.push("Expected dotnet scanner to be active.");
      }
      const hasPolyglotType = result.kernelProfile.secondaryTypes.includes("mixed-polyglot")
        || result.kernelProfile.primaryType === "mixed-polyglot"
        || (
          result.kernelProfile.activeScannerIds.includes("dotnet")
          && indexedPaths.some((indexedPath) => indexedPath.endsWith(".ps1"))
        );
      if (!hasPolyglotType) {
        errors.push("Expected mixed C# and PowerShell polyglot layout.");
      }
      if (!indexedPaths.includes("src/AppService.cs")) {
        errors.push("Expected src/AppService.cs to be indexed.");
      }
      if (!indexedPaths.includes("Scripts/Build.ps1")) {
        errors.push("Expected Scripts/Build.ps1 to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("AppService"))) {
        errors.push("Expected AppService C# symbol to be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-empty":
      if (result.kernelProfile.primaryType !== "empty-greenfield") {
        errors.push(`Expected empty-greenfield primary type, got ${result.kernelProfile.primaryType}.`);
      }
      if (indexedPaths.some((indexedPath) => /\.(cs|ts|py|go|rs)$/i.test(indexedPath))) {
        errors.push("Empty fixture must not index source code files.");
      }
      break;
    case "dockerignore-artifacts":
      if ((result.scanPlan.summary.skippedCountsByReason?.dockerignore ?? 0) <= 0) {
        errors.push("Expected dockerignore skip counts for artifacts/ output.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.startsWith("artifacts/"))) {
        errors.push("artifacts/ output must not be indexed when listed in .dockerignore.");
      }
      if (!indexedPaths.includes("src/index.ts")) {
        errors.push("Expected src/index.ts to remain indexed.");
      }
      break;
    default:
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
  }

  if (result.scanPlan.summary.kernelProfile?.activeScannerIds.length === 0) {
    errors.push("Kernel profile must declare at least one active scanner.");
  }

  return {
    fixture: fixtureName,
    passed: errors.length === 0,
    errors,
    activeScanners: result.kernelProfile.activeScannerIds,
    indexedFileCount: indexedPaths.length,
    skippedCountsByReason: Object.fromEntries(
      Object.entries(result.scanPlan.summary.skippedCountsByReason ?? {}).map(([reason, count]) => [
        reason,
        count ?? 0,
      ])
    ),
    scanMs: bundle.scanMs,
  };
}

async function scanFixture(fixturesRoot: string, fixtureName: string): Promise<FixtureScanBundle> {
  const fixturePath = path.join(fixturesRoot, fixtureName);
  const startedAt = Date.now();
  const scan = await runKernelWorkspaceScan(fixturePath);
  return {
    fixture: fixtureName,
    scan,
    scanMs: Date.now() - startedAt,
  };
}

export async function runVerifyGraphCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const repoRoot = await resolvePackageWorkspaceRoot();
  const fixturesRoot = path.resolve(repoRoot, parsed.fixtures ?? DEFAULT_FIXTURES_DIR);
  const fixtureNames = await listFixtureDirectories(fixturesRoot);
  if (fixtureNames.length === 0) {
    throw new Error(`No graph fixtures found under ${fixturesRoot}.`);
  }

  const bundles: FixtureScanBundle[] = [];
  for (const fixtureName of fixtureNames) {
    bundles.push(await scanFixture(fixturesRoot, fixtureName));
  }

  const results = bundles.map(verifyFixture);
  const failed = results.filter((result) => !result.passed);
  const releaseSuite = evaluateReleaseBenchmarkSuite({
    results: bundles
      .filter((bundle) => (GRAPH_RELEASE_FIXTURE_IDS as readonly string[]).includes(bundle.fixture))
      .map((bundle) => ({
        fixture: bundle.fixture,
        graph: bundle.scan.unifiedGraph,
        kernelProfile: bundle.scan.kernelProfile,
        scanMs: bundle.scanMs,
      })),
  });

  const payload = {
    fixturesRoot,
    fixtureCount: results.length,
    passed: failed.length === 0 && releaseSuite.ok,
    results,
    releaseGates: {
      fixtures: [...GRAPH_RELEASE_FIXTURE_IDS],
      querySuccessRate: releaseSuite.querySuccessRate,
      minQuerySuccessRate: GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE,
      misleadingHandoffRate: releaseSuite.misleadingHandoffRate,
      totalScanMs: bundles
        .filter((bundle) => (GRAPH_RELEASE_FIXTURE_IDS as readonly string[]).includes(bundle.fixture))
        .reduce((sum, bundle) => sum + bundle.scanMs, 0),
      passed: releaseSuite.ok,
      errors: releaseSuite.errors,
      results: releaseSuite.releaseResults,
    },
  };

  if (parsed.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const result of results) {
      const status = result.passed ? "PASS" : "FAIL";
      console.log(`${status} ${result.fixture} scanners=[${result.activeScanners.join(", ")}] files=${result.indexedFileCount} scanMs=${result.scanMs}`);
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
    }
    console.log(
      `Release gates: ${releaseSuite.ok ? "PASS" : "FAIL"} querySuccess=${Math.round(releaseSuite.querySuccessRate * 100)}% misleadingHandoff=${Math.round(releaseSuite.misleadingHandoffRate * 100)}% totalScanMs=${payload.releaseGates.totalScanMs}`
    );
    for (const error of releaseSuite.errors) {
      console.log(`  - ${error}`);
    }
    console.log(`Graph fixture verification: ${payload.passed ? "PASS" : "FAIL"} (${results.length} fixtures)`);
  }

  if (!payload.passed) {
    const failedNames = [
      ...failed.map((result) => result.fixture),
      ...(releaseSuite.ok ? [] : ["release-gates"]),
    ];
    throw new Error(`Graph fixture verification failed for: ${failedNames.join(", ")}`);
  }

  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/verifyGraph\.(?:ts|js)$/.test(invokedPath)) {
  runVerifyGraphCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}