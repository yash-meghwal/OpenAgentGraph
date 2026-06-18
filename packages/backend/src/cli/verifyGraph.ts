import fs from "fs/promises";
import path from "path";
import {
  evaluateGraphExternalBenchmarkSuite,
  evaluateGraphUpdateBenchmarkSuite,
  evaluateReleaseBenchmarkSuite,
  formatGraphExternalBenchmarkSummaryLine,
  formatGraphUpdateBenchmarkSummaryLine,
  GRAPH_RELEASE_FIXTURE_IDS,
  GRAPH_RELEASE_MIN_PATH_SUCCESS_RATE,
  GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE,
} from "@openagentgraph/shared";
import { runGraphExternalBenchmarkCatalog } from "../scanner/kernel/graphExternalBenchmarkRunner.js";
import { runGraphUpdateBenchmarkSuite } from "../scanner/kernel/graphUpdateBenchmarkRunner.js";
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

function assertNoDanglingEdges(
  nodes: Array<{ id: string }>,
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; metadata?: Record<string, unknown> }>,
  errors: string[]
) {
  const knownNodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    const missingSource = !knownNodeIds.has(edge.sourceNodeId);
    const missingTarget = !knownNodeIds.has(edge.targetNodeId);
    if (!missingSource && !missingTarget) continue;
    const relation = typeof edge.metadata?.scannerRelation === "string"
      ? edge.metadata.scannerRelation
      : "unknown";
    errors.push(
      `Dangling edge (${relation}): ${edge.id} missing ${missingSource ? "source" : ""}${missingSource && missingTarget ? " and " : ""}${missingTarget ? "target" : ""}.`
    );
  }
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
    case "fixture-unsupported-scala":
      if ((result.scanPlan.summary.skippedCountsByReason?.unsupported ?? 0) <= 0) {
        errors.push("Expected unsupported skip counts for .scala source files.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.endsWith(".scala"))) {
        errors.push(".scala source must remain unsupported in base.");
      }
      if (result.scanPlan.summary.diagnostics.join("\n").includes("No skipped paths recorded.")) {
        errors.push("Unsupported-language repos must not report 'No skipped paths recorded.'");
      }
      break;
    case "fixture-cpp-cmake":
      if (!result.kernelProfile.activeScannerIds.includes("cpp")) {
        errors.push("Expected cpp scanner to be active.");
      }
      if (!indexedPaths.includes("src/main.cpp")) {
        errors.push("Expected src/main.cpp to be indexed.");
      }
      if (!indexedPaths.includes("include/service.h")) {
        errors.push("Expected include/service.h to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerImportPath === "local:service.h")) {
        errors.push("Expected local include edge from main.cpp to service.h.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "cmake_link")) {
        errors.push("Expected CMake target_link_libraries edges.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "tests")) {
        errors.push("Expected C++ test-to-subject edges.");
      }
      if (!result.scanPlan.summary.diagnostics.some((line: string) => /C\/C\+\+.*T1|structural/i.test(line))) {
        errors.push("Expected C/C++ T1 structural diagnostics.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes("build/"))) {
        errors.push("build/ output must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-c-embedded-make":
      if (!result.kernelProfile.activeScannerIds.includes("cpp")) {
        errors.push("Expected cpp scanner to be active.");
      }
      if (!result.kernelProfile.markerPaths.some((marker) => marker.endsWith("Makefile"))) {
        errors.push("Expected Makefile workspace marker.");
      }
      if (!indexedPaths.includes("src/main.c")) {
        errors.push("Expected src/main.c to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerImportPath === "local:driver.h")) {
        errors.push("Expected local include edge to driver.h.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-cpp-compile-commands":
      if (!result.kernelProfile.activeScannerIds.includes("cpp")) {
        errors.push("Expected cpp scanner to be active.");
      }
      if (!indexedPaths.includes("compile_commands.json")) {
        errors.push("Expected compile_commands.json to be indexed.");
      }
      if (!indexedPaths.includes("src/app.cpp")) {
        errors.push("Expected src/app.cpp to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerCompileDirectory)) {
        errors.push("Expected compile_commands.json compile-unit edges.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-swift-package":
      if (!result.kernelProfile.activeScannerIds.includes("swift")) {
        errors.push("Expected swift scanner to be active.");
      }
      if (!indexedPaths.includes("Sources/MyLib/Service.swift")) {
        errors.push("Expected Sources/MyLib/Service.swift to be indexed.");
      }
      if (!indexedPaths.includes("Tests/MyLibTests/ServiceTests.swift")) {
        errors.push("Expected ServiceTests.swift to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("Service"))) {
        errors.push("Expected Swift Service symbols to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "tests")) {
        errors.push("Expected Swift test-to-subject edges.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "package_dependency")) {
        errors.push("Expected Package.swift dependency edges.");
      }
      if (!result.scanPlan.summary.diagnostics.some((line: string) => /Swift.*T1|structural/i.test(line))) {
        errors.push("Expected Swift T1 structural diagnostics.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes(".build/"))) {
        errors.push(".build/ SwiftPM output must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-swiftui-app-lite":
      if (!result.kernelProfile.activeScannerIds.includes("swift")) {
        errors.push("Expected swift scanner to be active.");
      }
      if (!indexedPaths.includes("Sources/SwiftUIAppLite/ContentView.swift")) {
        errors.push("Expected ContentView.swift to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("ContentView"))) {
        errors.push("Expected SwiftUI ContentView symbol to be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-ios-xcode-lite":
      if (!result.kernelProfile.activeScannerIds.includes("swift")) {
        errors.push("Expected swift scanner to be active.");
      }
      if (!result.kernelProfile.markerPaths.some((marker) => marker.includes("project.pbxproj"))) {
        errors.push("Expected Xcode project.pbxproj workspace marker.");
      }
      if (!indexedPaths.includes("Sources/AppDelegate.swift")) {
        errors.push("Expected Sources/AppDelegate.swift to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.kind === "extends" && edge.metadata?.scannerRelatedType === "UIResponder")) {
        errors.push("Expected AppDelegate class inheritance edge to UIResponder.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "conforms_to" && edge.metadata?.scannerRelatedType === "UIApplicationDelegate")) {
        errors.push("Expected AppDelegate protocol conformance edge to UIApplicationDelegate.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes("DerivedData/"))) {
        errors.push("DerivedData/ must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-dart-package":
      if (!result.kernelProfile.activeScannerIds.includes("flutter")) {
        errors.push("Expected flutter scanner to be active.");
      }
      if (!indexedPaths.includes("pubspec.yaml")) {
        errors.push("Expected pubspec.yaml to be indexed.");
      }
      if (!indexedPaths.includes("lib/calculator.dart")) {
        errors.push("Expected lib/calculator.dart to be indexed.");
      }
      if (!indexedPaths.includes("lib/repository.dart")) {
        errors.push("Expected lib/repository.dart to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("Repository"))) {
        errors.push("Expected generic Repository class symbol to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "extends" && edge.metadata?.scannerRelatedType === "Base")) {
        errors.push("Expected generic Repository extends Base edge.");
      }
      if (!indexedPaths.includes("test/calculator_test.dart")) {
        errors.push("Expected calculator_test.dart to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "package_dependency")) {
        errors.push("Expected pubspec package dependency edges.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "tests")) {
        errors.push("Expected Dart test-to-subject edges.");
      }
      if (!result.scanPlan.summary.diagnostics.some((line: string) => /Dart\/Flutter.*T1|structural/i.test(line))) {
        errors.push("Expected Dart/Flutter T1 structural diagnostics.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes(".dart_tool/"))) {
        errors.push(".dart_tool/ output must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-flutter-app":
      if (!result.kernelProfile.activeScannerIds.includes("flutter")) {
        errors.push("Expected flutter scanner to be active.");
      }
      if (!result.kernelProfile.markerPaths.some((marker) => marker.endsWith("pubspec.yaml"))) {
        errors.push("Expected pubspec.yaml workspace marker.");
      }
      if (!indexedPaths.includes("lib/main.dart")) {
        errors.push("Expected lib/main.dart to be indexed.");
      }
      if (!indexedPaths.includes("lib/widgets/home_screen.dart")) {
        errors.push("Expected HomeScreen widget file to be indexed.");
      }
      if (!indexedPaths.includes("lib/services/api_service.dart")) {
        errors.push("Expected ApiService file to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("HomeScreen"))) {
        errors.push("Expected HomeScreen widget symbol to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "widget_state")) {
        errors.push("Expected widget-to-state edges.");
      }
      if (!result.scanPlan.edges.some((edge) => {
        const importPath = edge.metadata?.scannerImportPath;
        return typeof importPath === "string" && importPath.includes("api_service.dart");
      })) {
        errors.push("Expected workspace import edges.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes(".dart_tool/") || indexedPath.includes("android/build/"))) {
        errors.push("Generated Flutter outputs must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-flutter-plugin-lite":
      if (!result.kernelProfile.activeScannerIds.includes("flutter")) {
        errors.push("Expected flutter scanner to be active.");
      }
      if (!indexedPaths.includes("lib/my_plugin.dart")) {
        errors.push("Expected plugin library to be indexed.");
      }
      if (!indexedPaths.includes("example/lib/main.dart")) {
        errors.push("Expected example app main.dart to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "tests")) {
        errors.push("Expected plugin test edges.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-unity-lite":
      if (!result.kernelProfile.activeScannerIds.includes("unity")) {
        errors.push("Expected unity scanner to be active.");
      }
      if (!result.kernelProfile.activeScannerIds.includes("dotnet")) {
        errors.push("Expected dotnet scanner to be active for Unity C# scripts.");
      }
      if (!result.kernelProfile.markerPaths.some((marker) => marker.endsWith("ProjectSettings/ProjectVersion.txt"))) {
        errors.push("Expected ProjectSettings/ProjectVersion.txt workspace marker.");
      }
      if (!indexedPaths.includes("Assets/Scripts/PlayerController.cs")) {
        errors.push("Expected PlayerController.cs to be indexed.");
      }
      if (!indexedPaths.includes("Assets/Game.asmdef")) {
        errors.push("Expected Game.asmdef to be indexed.");
      }
      if (!indexedPaths.includes("Assets/Scenes/Main.unity")) {
        errors.push("Expected Main.unity scene to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("PlayerController"))) {
        errors.push("Expected PlayerController C# symbol to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "assembly_reference")) {
        errors.push("Expected Unity asmdef assembly_reference edges.");
      }
      if (!result.scanPlan.summary.diagnostics.some((line: string) => /Game engine|Unity.*T1|structural/i.test(line))) {
        errors.push("Expected game engine structural diagnostics.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes("Library/"))) {
        errors.push("Library/ Unity cache must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-unreal-lite":
      if (!result.kernelProfile.activeScannerIds.includes("unreal")) {
        errors.push("Expected unreal scanner to be active.");
      }
      if (!result.kernelProfile.activeScannerIds.includes("cpp")) {
        errors.push("Expected cpp scanner to be active for Unreal C++ sources.");
      }
      if (!result.kernelProfile.markerPaths.some((marker) => marker.endsWith("Demo.uproject"))) {
        errors.push("Expected Demo.uproject workspace marker.");
      }
      if (!indexedPaths.includes("Source/Demo/DemoGameMode.cpp")) {
        errors.push("Expected DemoGameMode.cpp to be indexed.");
      }
      if (!indexedPaths.includes("Source/Demo/Demo.Build.cs")) {
        errors.push("Expected Demo.Build.cs to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "module_dependency")) {
        errors.push("Expected Unreal module_dependency edges.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes("Intermediate/"))) {
        errors.push("Intermediate/ Unreal output must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-godot-lite":
      if (!result.kernelProfile.activeScannerIds.includes("godot")) {
        errors.push("Expected godot scanner to be active.");
      }
      if (!result.kernelProfile.markerPaths.some((marker) => marker.endsWith("project.godot"))) {
        errors.push("Expected project.godot workspace marker.");
      }
      if (!indexedPaths.includes("scripts/player.gd")) {
        errors.push("Expected scripts/player.gd to be indexed.");
      }
      if (!indexedPaths.includes("scenes/main.tscn")) {
        errors.push("Expected scenes/main.tscn to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("Player"))) {
        errors.push("Expected Player GDScript symbol to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "autoload")) {
        errors.push("Expected Godot autoload edges.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "main_scene")) {
        errors.push("Expected Godot main_scene edge.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "scene_script")) {
        errors.push("Expected Godot scene_script edges.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes(".godot/"))) {
        errors.push(".godot/ import cache must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
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
    case "fixture-ruby-rails":
      if (!result.kernelProfile.activeScannerIds.includes("ruby")) {
        errors.push("Expected ruby scanner to be active.");
      }
      if (!indexedPaths.includes("app/models/user.rb")) {
        errors.push("Expected app/models/user.rb to be indexed.");
      }
      if (!indexedPaths.includes("app/controllers/users_controller.rb")) {
        errors.push("Expected users_controller.rb to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("UsersController"))) {
        errors.push("Expected Rails controller symbols to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "tests")) {
        errors.push("Expected Ruby spec-to-source tests edges.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "rails_route")) {
        errors.push("Expected Rails route edges.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRouteAction === "show")) {
        errors.push("Expected Rails route-to-action metadata for users#show.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "gem_dependency")) {
        errors.push("Expected Gemfile gem dependency edges.");
      }
      if (!result.scanPlan.summary.diagnostics.some((line: string) => /Ruby.*semantic-lite|T1\.5/i.test(line))) {
        errors.push("Expected Ruby semantic-lite diagnostics.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes("tmp/"))) {
        errors.push("tmp/ generated output must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-ruby-gem":
      if (!result.kernelProfile.activeScannerIds.includes("ruby")) {
        errors.push("Expected ruby scanner to be active.");
      }
      if (!indexedPaths.includes("lib/mygem.rb")) {
        errors.push("Expected lib/mygem.rb to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("Mygem"))) {
        errors.push("Expected Ruby module symbols to be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-ruby-gem-autoload":
      if (!result.kernelProfile.activeScannerIds.includes("ruby")) {
        errors.push("Expected ruby scanner to be active.");
      }
      if (!indexedPaths.includes("lib/mygem/runner.rb")) {
        errors.push("Expected lib/mygem/runner.rb to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerImportPath === "relative:mygem/version")) {
        errors.push("Expected require_relative edge for mygem/version.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-ruby-sinatra-lite":
      if (!result.kernelProfile.activeScannerIds.includes("ruby")) {
        errors.push("Expected ruby scanner to be active.");
      }
      if (!indexedPaths.includes("app.rb")) {
        errors.push("Expected app.rb to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "gem_dependency")) {
        errors.push("Expected Sinatra Gemfile gem dependency edges.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-php-laravel":
      if (!result.kernelProfile.activeScannerIds.includes("php")) {
        errors.push("Expected php scanner to be active.");
      }
      if (!indexedPaths.includes("app/Http/Controllers/UserController.php")) {
        errors.push("Expected UserController.php to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("UserController"))) {
        errors.push("Expected Laravel controller symbols to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "laravel_route")) {
        errors.push("Expected Laravel route-to-controller edges.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRouteAction === "index")) {
        errors.push("Expected Laravel route-to-action metadata.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "composer_dependency")) {
        errors.push("Expected Composer dependency edges.");
      }
      if (!result.scanPlan.summary.diagnostics.some((line: string) => /PHP.*semantic-lite|T1\.5/i.test(line))) {
        errors.push("Expected PHP semantic-lite diagnostics.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-php-wordpress-plugin":
      if (!result.kernelProfile.activeScannerIds.includes("php")) {
        errors.push("Expected php scanner to be active.");
      }
      if (!indexedPaths.includes("includes/class-handler.php")) {
        errors.push("Expected class-handler.php to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && /Handler|init/i.test(node.title))) {
        errors.push("Expected WordPress plugin class or hook symbols to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "wordpress_hook")) {
        errors.push("Expected WordPress hook callback edges.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-php-composer-psr4":
      if (!result.kernelProfile.activeScannerIds.includes("php")) {
        errors.push("Expected php scanner to be active.");
      }
      if (!indexedPaths.includes("src/Application/UserService.php")) {
        errors.push("Expected UserService.php to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerImportPath === "App\\Domain\\User")) {
        errors.push("Expected PSR-4 use import edge for App\\Domain\\User.");
      }
      const userSymbol = result.scanPlan.nodes.find(
        (node) => node.kind === "code_symbol" && node.title.includes("User (class)")
      );
      const userImportEdge = result.scanPlan.edges.find(
        (edge) => edge.metadata?.scannerImportPath === "App\\Domain\\User"
      );
      if (userSymbol && userImportEdge && userImportEdge.targetNodeId !== userSymbol.id) {
        errors.push("Expected aliased PSR-4 import to resolve to workspace User class symbol.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "composer_dependency")) {
        errors.push("Expected Composer dependency edges.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-php-symfony-lite":
      if (!result.kernelProfile.activeScannerIds.includes("php")) {
        errors.push("Expected php scanner to be active.");
      }
      if (!indexedPaths.includes("src/Controller/HomeController.php")) {
        errors.push("Expected HomeController.php to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerImportPath === "App\\Service\\GreetingService")) {
        errors.push("Expected PSR-4 import edge for GreetingService.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-java-gradle-multimodule":
      if (!result.kernelProfile.activeScannerIds.includes("java")) {
        errors.push("Expected java scanner to be active.");
      }
      if (!indexedPaths.includes("settings.gradle")) {
        errors.push("Expected settings.gradle to be indexed.");
      }
      if (!indexedPaths.includes("api/src/main/java/com/example/api/ApiService.java")) {
        errors.push("Expected ApiService.java to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "gradle_module")) {
        errors.push("Expected Gradle module dependency edges.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "tests")) {
        errors.push("Expected ApiServiceTest test_to_subject edge.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes("/build/"))) {
        errors.push("build/ output must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-kotlin-gradle":
      if (!result.kernelProfile.activeScannerIds.includes("java")) {
        errors.push("Expected java scanner to be active for Kotlin Gradle fixture.");
      }
      if (!indexedPaths.includes("src/main/kotlin/com/example/Greeter.kt")) {
        errors.push("Expected Greeter.kt to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("formatGreeting"))) {
        errors.push("Expected top-level Kotlin function symbols to be indexed.");
      }
      const formatGreeting = result.scanPlan.nodes.find(
        (node) => node.kind === "code_symbol" && node.title.includes("formatGreeting")
      );
      if (formatGreeting?.metadata?.scannerSymbolParentType) {
        errors.push("Top-level Kotlin functions must not inherit the previous class parent.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-java-maven":
      if (!result.kernelProfile.activeScannerIds.includes("java")) {
        errors.push("Expected java scanner to be active.");
      }
      if (!indexedPaths.includes("pom.xml")) {
        errors.push("Expected pom.xml to be indexed.");
      }
      if (!indexedPaths.includes("src/main/java/com/example/checkout/CheckoutService.java")) {
        errors.push("Expected CheckoutService.java to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("CheckoutService"))) {
        errors.push("Expected Java class symbols to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("process"))) {
        errors.push("Expected Java method symbols to be indexed.");
      }
      const orderImportEdge = result.scanPlan.edges.find(
        (edge) =>
          edge.metadata?.scannerRelation === "import"
          && edge.metadata?.scannerImportPath === "com.example.checkout.model.Order"
      );
      if (!orderImportEdge) {
        errors.push("Expected CheckoutService import edge for com.example.checkout.model.Order.");
      } else {
        const orderSymbol = result.scanPlan.nodes.find(
          (node) => node.kind === "code_symbol" && node.title.includes("Order (class)")
        );
        if (!orderSymbol || orderImportEdge.targetNodeId !== orderSymbol.id) {
          errors.push("Expected Order import to resolve to the workspace Order class symbol.");
        }
      }
      const knownNodeIds = new Set(result.scanPlan.nodes.map((node) => node.id));
      const danglingImportEdges = result.scanPlan.edges.filter(
        (edge) =>
          edge.metadata?.scannerRelation === "import"
          && (!knownNodeIds.has(edge.sourceNodeId) || !knownNodeIds.has(edge.targetNodeId))
      );
      if (danglingImportEdges.length > 0) {
        errors.push(`Expected no dangling Java/Kotlin import edges (${danglingImportEdges.length} found).`);
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes("/target/"))) {
        errors.push("target/ build output must not be indexed.");
      }
      if (!result.scanPlan.summary.diagnostics.some((line: string) => /semantic-lite|T1\.5/i.test(line))) {
        errors.push("Expected Java/Kotlin semantic-lite diagnostics.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-java-maven-parent-child":
      if (!result.kernelProfile.activeScannerIds.includes("java")) {
        errors.push("Expected java scanner to be active.");
      }
      if (!indexedPaths.includes("checkout-module/src/main/java/com/example/checkout/CheckoutController.java")) {
        errors.push("Expected CheckoutController.java to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "module_dependency")) {
        errors.push("Expected Maven parent/child module dependency edges.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "tests")) {
        errors.push("Expected CheckoutServiceTest test_to_subject edge.");
      }
      if (indexedPaths.some((pathValue) => pathValue.includes("/target/"))) {
        errors.push("target/ build output must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-java-gradle-multimodule-deep":
      if (!indexedPaths.includes("web/src/main/java/com/example/web/WebController.java")) {
        errors.push("Expected WebController.java to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "gradle_module")) {
        errors.push("Expected Gradle module dependency edges.");
      }
      const coreImport = result.scanPlan.edges.find(
        (edge) =>
          edge.metadata?.scannerRelation === "import"
          && edge.metadata?.scannerImportPath === "com.example.core.CoreRepository"
      );
      if (!coreImport) {
        errors.push("Expected ApiService import edge for CoreRepository.");
      }
      if (indexedPaths.some((pathValue) => pathValue.includes("/.gradle/"))) {
        errors.push(".gradle/ cache output must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-kotlin-spring":
      if (!indexedPaths.includes("src/main/kotlin/com/example/demo/web/OrderController.kt")) {
        errors.push("Expected OrderController.kt to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "entrypoint")) {
        errors.push("Expected Kotlin main entrypoint edge.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "tests")) {
        errors.push("Expected OrderServiceTest test_to_subject edge.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-android-lite":
      if (!indexedPaths.includes("src/main/kotlin/com/example/app/MainActivity.kt")) {
        errors.push("Expected MainActivity.kt to be indexed.");
      }
      if (!result.kernelProfile.activeScannerIds.includes("java")) {
        errors.push("Expected java scanner to be active for Android Kotlin fixture.");
      }
      if (indexedPaths.some((pathValue) => pathValue.includes("/build/"))) {
        errors.push("build/ output must not be indexed.");
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
      if (result.scanPlan.nodes.some((node) =>
        node.kind === "code_symbol" && node.metadata?.scannerSymbolKind !== "doc_section")) {
        errors.push("Docs-only fixture should not emit code symbols.");
      }
      if (result.scanPlan.nodes.filter((node) => node.metadata?.scannerSymbolKind === "doc_section").length < 4) {
        errors.push("Expected doc_section nodes from markdown headings.");
      }
      if (!result.scanPlan.edges.some((edge) =>
        edge.metadata?.scannerRelation === "doc_link" || edge.metadata?.scannerRelation === "doc_wikilink")) {
        errors.push("Expected markdown or wikilink documentation edges.");
      }
      break;
    case "fixture-docs-mixed-code":
      if (!indexedPaths.includes("docs/feature.md")) {
        errors.push("Expected docs/feature.md to be indexed.");
      }
      if (!indexedPaths.includes("src/checkout/service.ts")) {
        errors.push("Expected src/checkout/service.ts to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.metadata?.scannerSymbolKind === "doc_section")) {
        errors.push("Expected doc_section nodes in mixed docs/code fixture.");
      }
      if (!result.scanPlan.nodes.some((node) =>
        node.kind === "code_symbol"
        && node.metadata?.scannerSymbolKind !== "doc_section"
        && String(node.title).includes("CheckoutService"))) {
        errors.push("Expected CheckoutService symbol in mixed docs/code fixture.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "doc_code_ref")) {
        errors.push("Expected doc_code_ref edges linking docs to source.");
      }
      break;
    case "fixture-docs-broken-links":
      if (!indexedPaths.includes("README.md")) {
        errors.push("Expected README.md to be indexed.");
      }
      if (!result.unifiedGraph.diagnostics.some((line) => /Broken doc link/i.test(line))) {
        errors.push("Expected broken-link diagnostics in scan output.");
      }
      if (result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "doc_link")) {
        errors.push("Broken-link fixture should not create edges for missing targets.");
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
      const communityNodes = result.scanPlan.nodes.filter((node) => node.kind === "code_community");
      const communityTitles = communityNodes.map((node) => String(node.metadata?.scannerCommunityLabel ?? node.title));
      if (communityNodes.length < 3) {
        errors.push(`Expected multiple meaningful communities, got ${communityNodes.length}.`);
      }
      if (!communityTitles.some((title) => /SampleMediaPlayer\.App/i.test(title))) {
        errors.push("Expected SampleMediaPlayer.App community label.");
      }
      if (!communityTitles.some((title) => /SampleMediaPlayer\.Core/i.test(title))) {
        errors.push("Expected SampleMediaPlayer.Core community label.");
      }
      if (communityNodes.every((node) => ["src", "root", "."].includes(String(node.metadata?.scannerCommunityLabel ?? node.title)))) {
        errors.push("Community labels are too generic for the C# fixture.");
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
      if (!indexedPaths.includes("Scripts/Common.ps1")) {
        errors.push("Expected Scripts/Common.ps1 to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) => node.kind === "code_symbol" && node.title.includes("AppService"))) {
        errors.push("Expected AppService C# symbol to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) =>
        node.kind === "code_symbol"
        && node.metadata?.scannerSymbolKind === "function"
        && String(node.metadata?.scannerSymbolName ?? "").includes("Build-App"))) {
        errors.push("Expected Build-App PowerShell function symbol to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "dot_sources")) {
        errors.push("Expected PowerShell dot-source edges in mixed polyglot fixture.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "runs_command")) {
        errors.push("Expected script runs_command edges in mixed polyglot fixture.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-scripts-shell":
      if (!indexedPaths.includes("scripts/build.sh")) {
        errors.push("Expected scripts/build.sh to be indexed.");
      }
      if (!indexedPaths.includes("scripts/helper.sh")) {
        errors.push("Expected scripts/helper.sh to be indexed.");
      }
      if (!result.scanPlan.nodes.some((node) =>
        node.kind === "code_symbol"
        && node.metadata?.scannerSymbolKind === "function"
        && String(node.metadata?.scannerSymbolName ?? "") === "build_app")) {
        errors.push("Expected build_app shell function symbol to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "dot_sources")) {
        errors.push("Expected shell dot-source edges in scripts fixture.");
      }
      if (result.scanPlan.nodes.some((node) =>
        JSON.stringify(node.metadata ?? {}).includes("TEST_SECRET_PLACEHOLDER"))) {
        errors.push("Shell fixture must not expose secret env values in graph metadata.");
      }
      if (result.scanPlan.nodes.some((node) =>
        typeof node.metadata?.scannerScriptEnvVars === "string"
        && node.metadata.scannerScriptEnvVars.includes("="))) {
        errors.push("Shell fixture must store env var names only, not assignments.");
      }
      break;
    case "fixture-empty":
      if (result.kernelProfile.primaryType !== "empty-greenfield") {
        errors.push(`Expected empty-greenfield primary type, got ${result.kernelProfile.primaryType}.`);
      }
      if (indexedPaths.some((indexedPath) => /\.(cs|ts|py|go|rs)$/i.test(indexedPath))) {
        errors.push("Empty fixture must not index source code files.");
      }
      break;
    case "fixture-asset-heavy":
      if (!result.kernelProfile.activeScannerIds.includes("generic")) {
        errors.push("Expected generic scanner for asset-heavy fixture.");
      }
      if (!indexedPaths.includes("README.md")) {
        errors.push("Expected README.md to be indexed.");
      }
      if (result.scanPlan.nodes.some((node) =>
        node.kind === "code_symbol" && node.metadata?.scannerSymbolKind !== "doc_section")) {
        errors.push("Asset-heavy fixture should not emit code symbols.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes("dist/"))) {
        errors.push("dist/ generated output must not be indexed.");
      }
      {
        const skippedGlobal = result.scanPlan.summary.skippedCountsByReason?.global ?? 0;
        const skippedGitignore = result.scanPlan.summary.skippedCountsByReason?.gitignore ?? 0;
        if (skippedGlobal + skippedGitignore <= 0) {
          errors.push("Expected skip counts proving dist/ generated output is excluded.");
        }
      }
      break;
    case "fixture-mixed-mobile-backend":
      if (!result.kernelProfile.activeScannerIds.includes("typescript")) {
        errors.push("Expected typescript scanner to be active.");
      }
      if (!result.kernelProfile.activeScannerIds.includes("java")) {
        errors.push("Expected java scanner to be active for Android Kotlin sources.");
      }
      if (!result.kernelProfile.secondaryTypes.includes("mixed-polyglot")) {
        errors.push("Expected mixed-polyglot secondary project type.");
      }
      if (!indexedPaths.includes("backend/src/ApiService.ts")) {
        errors.push("Expected backend ApiService.ts to be indexed.");
      }
      if (!indexedPaths.includes("mobile/android/src/main/kotlin/com/example/mobile/MainActivity.kt")) {
        errors.push("Expected MainActivity.kt to be indexed.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes("mobile/android/build/"))) {
        errors.push("mobile/android/build/ output must not be indexed.");
      }
      assertNoGeneratedPaths(indexedPaths, errors);
      break;
    case "fixture-mixed-game-native":
      if (!result.kernelProfile.activeScannerIds.includes("godot")) {
        errors.push("Expected godot scanner to be active.");
      }
      if (!result.kernelProfile.activeScannerIds.includes("cpp")) {
        errors.push("Expected cpp scanner to be active for native engine sources.");
      }
      if (!result.kernelProfile.secondaryTypes.includes("mixed-polyglot")) {
        errors.push("Expected mixed-polyglot secondary project type.");
      }
      if (!indexedPaths.includes("game/scripts/player.gd")) {
        errors.push("Expected game/scripts/player.gd to be indexed.");
      }
      if (!indexedPaths.includes("native/src/engine.cpp")) {
        errors.push("Expected native/src/engine.cpp to be indexed.");
      }
      if (!result.scanPlan.edges.some((edge) => edge.metadata?.scannerRelation === "autoload")) {
        errors.push("Expected Godot autoload edges.");
      }
      if (indexedPaths.some((indexedPath) => indexedPath.includes("game/.godot/"))) {
        errors.push("game/.godot/ cache must not be indexed.");
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

  assertNoDanglingEdges(result.scanPlan.nodes, result.scanPlan.edges, errors);

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

  const updateBenchmarkResults = await runGraphUpdateBenchmarkSuite({ fixturesRoot });
  const updateBenchmarkSuite = evaluateGraphUpdateBenchmarkSuite(updateBenchmarkResults);

  const externalBenchmarkResults = await runGraphExternalBenchmarkCatalog({ fixturesRoot });
  const externalBenchmarkSuite = evaluateGraphExternalBenchmarkSuite(externalBenchmarkResults);

  const payload = {
    fixturesRoot,
    fixtureCount: results.length,
    passed: failed.length === 0 && releaseSuite.ok && updateBenchmarkSuite.ok && externalBenchmarkSuite.ok,
    results,
    releaseGates: {
      fixtures: [...GRAPH_RELEASE_FIXTURE_IDS],
      querySuccessRate: releaseSuite.querySuccessRate,
      pathSuccessRate: releaseSuite.pathSuccessRate,
      agentBenchmarkSuccessRate: releaseSuite.agentBenchmarkSuccessRate,
      minQuerySuccessRate: GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE,
      minPathSuccessRate: GRAPH_RELEASE_MIN_PATH_SUCCESS_RATE,
      misleadingHandoffRate: releaseSuite.misleadingHandoffRate,
      totalScanMs: bundles
        .filter((bundle) => (GRAPH_RELEASE_FIXTURE_IDS as readonly string[]).includes(bundle.fixture))
        .reduce((sum, bundle) => sum + bundle.scanMs, 0),
      passed: releaseSuite.ok,
      errors: releaseSuite.errors,
      results: releaseSuite.releaseResults,
    },
    updateBenchmarks: {
      passed: updateBenchmarkSuite.ok,
      maxWarmMs: updateBenchmarkSuite.maxWarmMs,
      errors: updateBenchmarkSuite.errors,
      results: updateBenchmarkSuite.results,
    },
    externalBenchmarks: {
      passed: externalBenchmarkSuite.ok,
      errors: externalBenchmarkSuite.errors,
      results: externalBenchmarkSuite.results,
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
      `Release gates: ${releaseSuite.ok ? "PASS" : "FAIL"} agentBenchmark=${Math.round(releaseSuite.agentBenchmarkSuccessRate * 100)}% query=${Math.round(releaseSuite.querySuccessRate * 100)}% path=${Math.round(releaseSuite.pathSuccessRate * 100)}% misleadingHandoff=${Math.round(releaseSuite.misleadingHandoffRate * 100)}% totalScanMs=${payload.releaseGates.totalScanMs}`
    );
    for (const error of releaseSuite.errors) {
      console.log(`  - ${error}`);
    }
    console.log(formatGraphUpdateBenchmarkSummaryLine(updateBenchmarkSuite));
    for (const error of updateBenchmarkSuite.errors) {
      console.log(`  - ${error}`);
    }
    console.log(formatGraphExternalBenchmarkSummaryLine(externalBenchmarkSuite));
    for (const error of externalBenchmarkSuite.errors) {
      console.log(`  - ${error}`);
    }
    console.log(`Graph fixture verification: ${payload.passed ? "PASS" : "FAIL"} (${results.length} fixtures)`);
  }

  if (!payload.passed) {
    const failedNames = [
      ...failed.map((result) => result.fixture),
      ...(releaseSuite.ok ? [] : ["release-gates"]),
      ...(updateBenchmarkSuite.ok ? [] : ["update-benchmarks"]),
      ...(externalBenchmarkSuite.ok ? [] : ["external-benchmarks"]),
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
