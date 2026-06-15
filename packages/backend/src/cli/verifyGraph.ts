import fs from "fs/promises";
import path from "path";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";
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

async function verifyFixture(fixturesRoot: string, fixtureName: string): Promise<FixtureCheckResult> {
  const fixturePath = path.join(fixturesRoot, fixtureName);
  const errors: string[] = [];
  const result = await runKernelWorkspaceScan(fixturePath);
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
    case "unsupported-python":
      if (!result.kernelProfile.activeScannerIds.includes("python")) {
        errors.push("Expected python scanner to be active.");
      }
      if ((result.scanPlan.summary.skippedCountsByReason?.unsupported ?? 0) <= 0) {
        errors.push("Expected unsupported skip counts for .py source files.");
      }
      if (result.scanPlan.summary.diagnostics.join("\n").includes("No skipped paths recorded.")) {
        errors.push("Unsupported-language repos must not report 'No skipped paths recorded.'");
      }
      break;
    case "fixture-csharp-wpf":
      if (!result.kernelProfile.activeScannerIds.includes("dotnet")) {
        errors.push("Expected dotnet scanner to be active.");
      }
      if (!indexedPaths.includes("OpenViewPlayer.App/ViewModels/MainViewModel.cs")) {
        errors.push("Expected MainViewModel.cs to be indexed.");
      }
      if (!indexedPaths.includes("OpenViewPlayer.Core/OpenViewPlayer.Core.csproj")) {
        errors.push("Expected OpenViewPlayer.Core project to be indexed.");
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
      assertNoGeneratedPaths(indexedPaths, errors);
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

  const results: FixtureCheckResult[] = [];
  for (const fixtureName of fixtureNames) {
    results.push(await verifyFixture(fixturesRoot, fixtureName));
  }

  const failed = results.filter((result) => !result.passed);
  const payload = {
    fixturesRoot,
    fixtureCount: results.length,
    passed: failed.length === 0,
    results,
  };

  if (parsed.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const result of results) {
      const status = result.passed ? "PASS" : "FAIL";
      console.log(`${status} ${result.fixture} scanners=[${result.activeScanners.join(", ")}] files=${result.indexedFileCount}`);
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
    }
    console.log(`Graph fixture verification: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length} fixtures)`);
  }

  if (failed.length > 0) {
    throw new Error(`Graph fixture verification failed for: ${failed.map((result) => result.fixture).join(", ")}`);
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