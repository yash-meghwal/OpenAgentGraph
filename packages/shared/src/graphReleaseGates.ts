import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import { evaluateEdgeProvenanceReleaseGates } from "./graphEdgeProvenance.js";
import { buildEcosystemSupportMatrix } from "./graphEcosystemHealth.js";
import { evaluateAnalyzerReleaseGates, evaluateSemanticLiteEdgeKindPreservation } from "./graphAnalyzerGates.js";
import { getReadTheseFirstNodes, renderUnifiedGraphHandoffReport } from "./graphArtifacts.js";
import { evaluateStaticExportReleaseGates } from "./graphExportBundle.js";
import { evaluateCommunityReleaseGates, GRAPH_COMMUNITY_LARGE_REPO_FILE_THRESHOLD } from "./graphCommunities.js";
import { buildGraphCommunityHubSummaries, evaluateCommunityHubReleaseGates } from "./graphCommunityHubs.js";
import { evaluateDocLinkHygieneGate } from "./graphDocLinks.js";
import { evaluateScriptReleaseGates } from "./graphScriptGates.js";
import { evaluateOagFusionChecks } from "./graphFusion.js";
import { findGraphPath, queryUnifiedCodeGraph } from "./graphQueryEngine.js";

export const GRAPH_RELEASE_FIXTURE_IDS = [
  "fixture-csharp-wpf",
  "fixture-csharp-media-player",
  "fixture-next-app",
  "fixture-python-django",
  "fixture-java-maven",
  "fixture-java-gradle-multimodule",
  "fixture-java-gradle-multimodule-deep",
  "fixture-java-maven-parent-child",
  "fixture-kotlin-gradle",
  "fixture-kotlin-spring",
  "fixture-android-lite",
  "fixture-go-module",
  "fixture-rust-workspace",
  "fixture-terraform",
  "fixture-ruby-rails",
  "fixture-ruby-gem",
  "fixture-ruby-gem-autoload",
  "fixture-php-laravel",
  "fixture-php-wordpress-plugin",
  "fixture-php-composer-psr4",
  "fixture-php-symfony-lite",
  "fixture-ruby-sinatra-lite",
  "fixture-swift-package",
  "fixture-swiftui-app-lite",
  "fixture-ios-xcode-lite",
  "fixture-cpp-cmake",
  "fixture-c-embedded-make",
  "fixture-cpp-compile-commands",
  "fixture-flutter-app",
  "fixture-dart-package",
  "fixture-flutter-plugin-lite",
  "fixture-unity-lite",
  "fixture-unreal-lite",
  "fixture-godot-lite",
  "fixture-mixed-polyglot",
  "fixture-docs-only",
  "fixture-docs-mixed-code",
  "fixture-empty",
  "fixture-asset-heavy",
  "fixture-mixed-mobile-backend",
  "fixture-mixed-game-native",
] as const;

export type GraphReleaseFixtureId = (typeof GRAPH_RELEASE_FIXTURE_IDS)[number];

export const GRAPH_RELEASE_MAX_SCAN_MS = 5 * 60 * 1000;
export const GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE = 0.8;
export const GRAPH_RELEASE_MIN_PATH_SUCCESS_RATE = 0.95;

const READ_FIRST_JUNK_PATTERNS = [
  "/bin/",
  "/obj/",
  "/dist/",
  "/.next/",
  "graphify-out/",
  "/node_modules/",
  "/.terraform/",
  "/.venv/",
  "/target/debug/",
];

export interface GraphQueryBenchmarkCase {
  fixture: GraphReleaseFixtureId;
  query: string;
  seedPattern: RegExp;
  resultPattern?: RegExp;
}

export const GRAPH_QUERY_BENCHMARKS: GraphQueryBenchmarkCase[] = [
  {
    fixture: "fixture-csharp-wpf",
    query: "MainViewModel playback",
    seedPattern: /MainViewModel/i,
    resultPattern: /PlaybackService/i,
  },
  {
    fixture: "fixture-csharp-media-player",
    query: "MainViewModel playback",
    seedPattern: /MainViewModel/i,
    resultPattern: /PlaybackService/i,
  },
  {
    fixture: "fixture-next-app",
    query: "app page layout",
    seedPattern: /page/i,
  },
  {
    fixture: "fixture-python-django",
    query: "User model django",
    seedPattern: /User/i,
  },
  {
    fixture: "fixture-java-maven",
    query: "CheckoutService order",
    seedPattern: /CheckoutService/i,
    resultPattern: /Order/i,
  },
  {
    fixture: "fixture-java-gradle-multimodule",
    query: "ApiService CoreService module",
    seedPattern: /ApiService/i,
    resultPattern: /CoreService/i,
  },
  {
    fixture: "fixture-kotlin-gradle",
    query: "Greeter formatGreeting",
    seedPattern: /Greeter/i,
    resultPattern: /formatGreeting/i,
  },
  {
    fixture: "fixture-java-maven-parent-child",
    query: "CheckoutController CheckoutService repository",
    seedPattern: /CheckoutController/i,
    resultPattern: /CheckoutService|CheckoutRepository/i,
  },
  {
    fixture: "fixture-java-gradle-multimodule-deep",
    query: "WebController ApiService CoreRepository",
    seedPattern: /WebController/i,
    resultPattern: /ApiService|CoreRepository/i,
  },
  {
    fixture: "fixture-kotlin-spring",
    query: "OrderController OrderService repository",
    seedPattern: /OrderController/i,
    resultPattern: /OrderService|OrderRepository/i,
  },
  {
    fixture: "fixture-android-lite",
    query: "MainActivity renderHome",
    seedPattern: /MainActivity/i,
    resultPattern: /renderHome/i,
  },
  {
    fixture: "fixture-ruby-rails",
    query: "UsersController User model",
    seedPattern: /UsersController/i,
    resultPattern: /User/i,
  },
  {
    fixture: "fixture-ruby-gem",
    query: "Mygem Runner module",
    seedPattern: /Runner|Mygem/i,
  },
  {
    fixture: "fixture-php-laravel",
    query: "UserController User model",
    seedPattern: /UserController/i,
    resultPattern: /User/i,
  },
  {
    fixture: "fixture-php-wordpress-plugin",
    query: "Handler hook plugin",
    seedPattern: /Handler/i,
  },
  {
    fixture: "fixture-php-composer-psr4",
    query: "UserService User domain",
    seedPattern: /UserService/i,
    resultPattern: /User/i,
  },
  {
    fixture: "fixture-go-module",
    query: "Runner service",
    seedPattern: /Runner/i,
  },
  {
    fixture: "fixture-swift-package",
    query: "Service Greeter greet",
    seedPattern: /Service/i,
    resultPattern: /Greeter|greet/i,
  },
  {
    fixture: "fixture-swiftui-app-lite",
    query: "ContentView SwiftUI",
    seedPattern: /ContentView/i,
  },
  {
    fixture: "fixture-cpp-cmake",
    query: "main service run_service",
    seedPattern: /main/i,
    resultPattern: /service|run_service/i,
  },
  {
    fixture: "fixture-c-embedded-make",
    query: "main driver_init",
    seedPattern: /main/i,
    resultPattern: /driver/i,
  },
  {
    fixture: "fixture-flutter-app",
    query: "main HomeScreen ApiService",
    seedPattern: /main|HomeScreen/i,
    resultPattern: /ApiService|HomeScreen/i,
  },
  {
    fixture: "fixture-dart-package",
    query: "Calculator add",
    seedPattern: /Calculator/i,
    resultPattern: /add/i,
  },
  {
    fixture: "fixture-unity-lite",
    query: "PlayerController Main scene",
    seedPattern: /PlayerController/i,
    resultPattern: /Main|Game/i,
  },
  {
    fixture: "fixture-unreal-lite",
    query: "DemoGameMode module",
    seedPattern: /DemoGameMode/i,
    resultPattern: /Demo|Core/i,
  },
  {
    fixture: "fixture-godot-lite",
    query: "player main scene autoload",
    seedPattern: /player|Player/i,
    resultPattern: /main|GameManager/i,
  },
  {
    fixture: "fixture-rust-workspace",
    query: "CoreService api",
    seedPattern: /CoreService/i,
  },
  {
    fixture: "fixture-terraform",
    query: "aws s3 bucket",
    seedPattern: /aws_s3_bucket/i,
  },
  {
    fixture: "fixture-mixed-polyglot",
    query: "AppService build script",
    seedPattern: /AppService|Build/i,
  },
  {
    fixture: "fixture-docs-only",
    query: "architecture guide",
    seedPattern: /architecture|guide/i,
  },
  {
    fixture: "fixture-docs-mixed-code",
    query: "how does checkout work",
    seedPattern: /checkout|CheckoutService|feature/i,
  },
  {
    fixture: "fixture-ruby-gem-autoload",
    query: "Runner version mygem",
    seedPattern: /Runner|version|Mygem/i,
  },
  {
    fixture: "fixture-cpp-compile-commands",
    query: "app run_app compile",
    seedPattern: /app|run_app/i,
  },
  {
    fixture: "fixture-flutter-plugin-lite",
    query: "MyPlugin platform version",
    seedPattern: /MyPlugin|plugin/i,
  },
  {
    fixture: "fixture-ios-xcode-lite",
    query: "AppDelegate UIKit application",
    seedPattern: /AppDelegate|UIKit/i,
  },
  {
    fixture: "fixture-php-symfony-lite",
    query: "HomeController GreetingService",
    seedPattern: /HomeController|GreetingService/i,
  },
  {
    fixture: "fixture-ruby-sinatra-lite",
    query: "sinatra health app",
    seedPattern: /sinatra|app/i,
  },
  {
    fixture: "fixture-empty",
    query: "workspace greenfield",
    seedPattern: /workspace/i,
  },
  {
    fixture: "fixture-asset-heavy",
    query: "design asset readme",
    seedPattern: /README|workspace|asset/i,
  },
  {
    fixture: "fixture-mixed-mobile-backend",
    query: "ApiService MainActivity sync",
    seedPattern: /ApiService|MainActivity|sync/i,
  },
  {
    fixture: "fixture-mixed-game-native",
    query: "player engine native bridge",
    seedPattern: /player|engine|native|bridge/i,
  },
];

export interface GraphPathBenchmarkCase {
  fixture: GraphReleaseFixtureId;
  from: string;
  to: string;
  fromPattern: RegExp;
  toPattern: RegExp;
  pathNodePattern?: RegExp;
  mode?: "semantic" | "balanced" | "structural";
  forbiddenNodeKinds?: Array<import("./codeGraph.js").UnifiedCodeGraphNode["kind"]>;
  requiredEdgeKinds?: Array<import("./codeGraph.js").UnifiedCodeGraphEdge["kind"]>;
  preferredNodePatterns?: RegExp[];
}

export const GRAPH_PATH_BENCHMARKS: GraphPathBenchmarkCase[] = [
  {
    fixture: "fixture-csharp-wpf",
    from: "MainViewModel",
    to: "PlaybackService",
    fromPattern: /MainViewModel/i,
    toPattern: /PlaybackService/i,
    pathNodePattern: /MainViewModel|PlaybackService/i,
  },
  {
    fixture: "fixture-csharp-media-player",
    from: "MainViewModel",
    to: "PlaybackService",
    fromPattern: /MainViewModel/i,
    toPattern: /PlaybackService/i,
    pathNodePattern: /MainViewModel|PlaybackService/i,
  },
  {
    fixture: "fixture-csharp-media-player",
    from: "MainViewModel",
    to: "MpvPlayerAdapter",
    fromPattern: /MainViewModel/i,
    toPattern: /MpvPlayerAdapter/i,
    pathNodePattern: /MainViewModel|MpvPlayerAdapter|PlaybackService/i,
    mode: "balanced",
    forbiddenNodeKinds: ["doc_section", "doc_file"],
    preferredNodePatterns: [/MpvPlayerAdapter/i, /MainViewModel/i],
  },
  {
    fixture: "fixture-java-maven",
    from: "CheckoutService",
    to: "Order",
    fromPattern: /CheckoutService/i,
    toPattern: /Order/i,
  },
  {
    fixture: "fixture-java-gradle-multimodule",
    from: "ApiService",
    to: "CoreService",
    fromPattern: /ApiService/i,
    toPattern: /CoreService/i,
  },
  {
    fixture: "fixture-java-maven-parent-child",
    from: "CheckoutController",
    to: "CheckoutService",
    fromPattern: /CheckoutController/i,
    toPattern: /CheckoutService/i,
  },
  {
    fixture: "fixture-kotlin-spring",
    from: "OrderController",
    to: "OrderService",
    fromPattern: /OrderController/i,
    toPattern: /OrderService/i,
  },
  {
    fixture: "fixture-ruby-rails",
    from: "UsersController",
    to: "User",
    fromPattern: /UsersController/i,
    toPattern: /User/i,
  },
  {
    fixture: "fixture-ruby-gem-autoload",
    from: "Runner",
    to: "version",
    fromPattern: /Runner/i,
    toPattern: /version/i,
  },
  {
    fixture: "fixture-php-laravel",
    from: "UserController",
    to: "User",
    fromPattern: /UserController/i,
    toPattern: /User/i,
  },
  {
    fixture: "fixture-php-composer-psr4",
    from: "UserService",
    to: "User",
    fromPattern: /UserService/i,
    toPattern: /User/i,
  },
  {
    fixture: "fixture-php-symfony-lite",
    from: "HomeController",
    to: "GreetingService",
    fromPattern: /HomeController/i,
    toPattern: /GreetingService/i,
  },
  {
    fixture: "fixture-swift-package",
    from: "Service",
    to: "Greeter",
    fromPattern: /Service/i,
    toPattern: /Greeter|greet/i,
  },
  {
    fixture: "fixture-cpp-cmake",
    from: "main",
    to: "run_service",
    fromPattern: /main/i,
    toPattern: /run_service|service/i,
  },
  {
    fixture: "fixture-cpp-compile-commands",
    from: "app.cpp",
    to: "run_app",
    fromPattern: /app/i,
    toPattern: /run_app/i,
  },
  {
    fixture: "fixture-flutter-app",
    from: "HomeScreen",
    to: "ApiService",
    fromPattern: /HomeScreen/i,
    toPattern: /ApiService/i,
  },
  {
    fixture: "fixture-flutter-plugin-lite",
    from: "MyPlugin",
    to: "main",
    fromPattern: /MyPlugin/i,
    toPattern: /main/i,
  },
  {
    fixture: "fixture-ios-xcode-lite",
    from: "AppDelegate",
    to: "UIApplicationDelegate",
    fromPattern: /AppDelegate/i,
    toPattern: /UIApplicationDelegate/i,
  },
  {
    fixture: "fixture-unity-lite",
    from: "PlayerController",
    to: "Main",
    fromPattern: /PlayerController/i,
    toPattern: /Main/i,
  },
  {
    fixture: "fixture-godot-lite",
    from: "player.gd",
    to: "main.tscn",
    fromPattern: /player|Player/i,
    toPattern: /main|Main/i,
  },
  {
    fixture: "fixture-mixed-polyglot",
    from: "AppService",
    to: "Build.ps1",
    fromPattern: /AppService/i,
    toPattern: /Build|polyglot/i,
  },
  {
    fixture: "fixture-mixed-mobile-backend",
    from: "ApiService",
    to: "MainActivity",
    fromPattern: /ApiService/i,
    toPattern: /MainActivity/i,
  },
  {
    fixture: "fixture-mixed-game-native",
    from: "player.gd",
    to: "engine.cpp",
    fromPattern: /player|Player/i,
    toPattern: /engine/i,
    pathNodePattern: /player|engine/i,
  },
];

export interface GraphHandoffHygieneResult {
  ok: boolean;
  junkPaths: string[];
  misleadingHandoffRate: number;
}

export interface GraphQueryBenchmarkResult {
  fixture: string;
  query: string;
  passed: boolean;
  seedLabels: string[];
  nodeLabels: string[];
  detail: string;
}

export interface GraphPathBenchmarkResult {
  fixture: string;
  from: string;
  to: string;
  passed: boolean;
  fromLabel?: string;
  toLabel?: string;
  pathLabels: string[];
  detail: string;
}

export interface EcosystemSupportMatrixGateResult {
  ok: boolean;
  missingInMatrix: string[];
  missingInHandoff: string[];
  errors: string[];
}

export interface GraphCommunityGateResult {
  ok: boolean;
  communityCount: number;
  meaningfulCommunityCount: number;
  genericCommunityCount: number;
  generatedDominanceRatio: number;
  errors: string[];
}

export interface GraphReadFirstQualityGateResult {
  ok: boolean;
  topLabels: string[];
  errors: string[];
}

export interface GraphHubStartQualityGateResult {
  ok: boolean;
  hubLabels: string[];
  startWithByHub: Record<string, string[]>;
  errors: string[];
}

export interface GraphDocLinkHygieneGateResult {
  ok: boolean;
  brokenCount: number;
  errors: string[];
}

export interface GraphReleaseGateResult {
  ok: boolean;
  handoffHygiene: GraphHandoffHygieneResult;
  readFirstQuality: GraphReadFirstQualityGateResult;
  hubStartQuality: GraphHubStartQualityGateResult;
  docLinkHygiene: GraphDocLinkHygieneGateResult;
  communityGates: GraphCommunityGateResult;
  ecosystemMatrixGate: EcosystemSupportMatrixGateResult;
  queryBenchmarks: GraphQueryBenchmarkResult[];
  pathBenchmarks: GraphPathBenchmarkResult[];
  querySuccessRate: number;
  pathSuccessRate: number;
  agentBenchmarkSuccessRate: number;
  fusionOk: boolean;
  fusionHardFailCount: number;
  totalScanMs: number;
  errors: string[];
}

function pathLooksLikeJunk(value: string) {
  const normalized = value.replace(/\\/g, "/");
  return READ_FIRST_JUNK_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function evaluateReadFirstQualityGate(
  graph: UnifiedCodeGraph,
  fixture: string
): GraphReadFirstQualityGateResult {
  const readFirst = getReadTheseFirstNodes(graph, 8);
  const topLabels = readFirst.map((node) => node.label);
  const errors: string[] = [];

  if (fixture === "fixture-csharp-media-player") {
    const primary = readFirst[0];
    if (!primary || !/MainViewModel/i.test(primary.label)) {
      errors.push(`Read-first should start with MainViewModel, got ${primary?.label ?? "none"}.`);
    }
    const testIndex = readFirst.findIndex((node) => /tests?[/\\]/i.test(node.path ?? node.label));
    const viewModelIndex = readFirst.findIndex((node) => /MainViewModel/i.test(node.label));
    if (testIndex >= 0 && viewModelIndex >= 0 && testIndex < viewModelIndex) {
      errors.push("Test files should not outrank MainViewModel in general read-first output.");
    }
    const fieldIndex = readFirst.findIndex((node) => /\._/.test(node.label) || /\(field\)/i.test(node.label));
    if (fieldIndex >= 0 && viewModelIndex >= 0 && fieldIndex < viewModelIndex) {
      errors.push("Field symbols should not outrank MainViewModel class in read-first output.");
    }
  }

  return { ok: errors.length === 0, topLabels, errors };
}

export function evaluateHubStartQualityGate(
  graph: UnifiedCodeGraph,
  fixture: string
): GraphHubStartQualityGateResult {
  const hubs = buildGraphCommunityHubSummaries(graph, { mergeThinForPresentation: true });
  const startWithByHub: Record<string, string[]> = {};
  const errors: string[] = [];

  for (const hub of hubs) {
    if (hub.startWithNodes?.length) {
      startWithByHub[hub.label] = hub.startWithNodes;
    }
  }

  if (fixture === "fixture-csharp-media-player") {
    const appHub = hubs.find((hub) => /SampleMediaPlayer\.App/i.test(hub.label));
    const coreHub = hubs.find((hub) => /SampleMediaPlayer\.Core/i.test(hub.label));
    const appStart = appHub?.startWithNodes ?? appHub?.readFirstNodes ?? [];
    const coreStart = coreHub?.startWithNodes ?? coreHub?.readFirstNodes ?? [];

    if (appStart.length > 0 && !appStart.some((entry) => /MainViewModel|AppController/i.test(entry))) {
      errors.push(`App hub start-with should include MainViewModel or AppController, got ${appStart.join(", ")}.`);
    }
    if (coreStart.length > 0) {
      const zebraIndex = coreStart.findIndex((entry) => /ZebraTelemetry/i.test(entry));
      const adapterIndex = coreStart.findIndex((entry) => /MpvPlayerAdapter|PlaybackService/i.test(entry));
      if (zebraIndex >= 0 && adapterIndex >= 0 && zebraIndex < adapterIndex) {
        errors.push("Core hub start-with should prefer adapter/service entrypoints over alphabetical ZebraTelemetryService.");
      }
      if (coreStart.some((entry) => /Tests/i.test(entry))) {
        errors.push("Core hub start-with should not list test files in the default start bucket.");
      }
    }
  }

  return {
    ok: errors.length === 0,
    hubLabels: hubs.map((hub) => hub.label),
    startWithByHub,
    errors,
  };
}

export function evaluateHandoffReadFirstHygiene(graph: UnifiedCodeGraph): GraphHandoffHygieneResult {
  const readFirst = getReadTheseFirstNodes(graph);
  const junkPaths = readFirst
    .map((node) => node.path ?? node.label)
    .filter((nodePath) => pathLooksLikeJunk(nodePath));
  const misleadingHandoffRate = readFirst.length > 0
    ? junkPaths.length / readFirst.length
    : 0;
  return {
    ok: junkPaths.length === 0,
    junkPaths,
    misleadingHandoffRate,
  };
}

export function evaluateEcosystemSupportMatrixGate(input: {
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  handoffMarkdown: string;
}): EcosystemSupportMatrixGateResult {
  const activeScannerIds = input.kernelProfile?.activeScannerIds ?? input.graph.activeScannerIds;
  const matrixRows = buildEcosystemSupportMatrix({
    graph: input.graph,
    kernelProfile: input.kernelProfile,
  });
  const matrixScannerIds = new Set(matrixRows.map((row) => row.scannerId));
  const missingInMatrix = activeScannerIds.filter((scannerId) => !matrixScannerIds.has(scannerId));
  const missingInHandoff = activeScannerIds.filter(
    (scannerId) => !input.handoffMarkdown.includes(`**${scannerId} (`)
  );
  const errors: string[] = [];
  if (!input.handoffMarkdown.includes("## Ecosystem support matrix")) {
    errors.push("Handoff report is missing ecosystem support matrix section.");
  }
  if (missingInMatrix.length > 0) {
    errors.push(`Ecosystem support matrix missing active scanners: ${missingInMatrix.join(", ")}.`);
  }
  if (missingInHandoff.length > 0) {
    errors.push(`Handoff matrix section missing active scanners: ${missingInHandoff.join(", ")}.`);
  }
  return {
    ok: errors.length === 0,
    missingInMatrix,
    missingInHandoff,
    errors,
  };
}

export function evaluateGraphQueryBenchmark(
  graph: UnifiedCodeGraph,
  benchmark: GraphQueryBenchmarkCase
): GraphQueryBenchmarkResult {
  const result = queryUnifiedCodeGraph(graph, benchmark.query, { budget: 24 });
  const seedLabels = result.seeds.map((node) => node.label);
  const nodeLabels = result.nodes.map((node) => node.label);
  const seedMatch = seedLabels.some((label) => benchmark.seedPattern.test(label));
  const resultMatch = benchmark.resultPattern
    ? nodeLabels.some((label) => benchmark.resultPattern?.test(label))
    : result.nodes.length > 0;
  const passed = seedMatch && resultMatch;

  return {
    fixture: benchmark.fixture,
    query: benchmark.query,
    passed,
    seedLabels,
    nodeLabels,
    detail: passed
      ? "Query resolved to expected graph neighborhood."
      : `Expected seeds matching ${benchmark.seedPattern} and useful neighborhood nodes.`,
  };
}

export function evaluateGraphPathBenchmark(
  graph: UnifiedCodeGraph,
  benchmark: GraphPathBenchmarkCase
): GraphPathBenchmarkResult {
  const result = findGraphPath(graph, benchmark.from, benchmark.to, {
    mode: benchmark.mode ?? "balanced",
    explainRanking: Boolean(benchmark.forbiddenNodeKinds?.length),
  });
  const pathLabels = result.nodes.map((node) => node.label);
  const pathKinds = result.nodes.map((node) => node.kind);
  const fromLabel = result.fromNode?.label;
  const toLabel = result.toNode?.label;
  const fromMatch = fromLabel ? benchmark.fromPattern.test(fromLabel) : false;
  const toMatch = toLabel ? benchmark.toPattern.test(toLabel) : false;
  const pathMatch = benchmark.pathNodePattern
    ? pathLabels.some((label) => benchmark.pathNodePattern?.test(label))
    : result.found && pathLabels.length >= 2;
  const forbiddenKind = benchmark.forbiddenNodeKinds?.find((kind) => pathKinds.includes(kind));
  const requiredEdgeMissing = benchmark.requiredEdgeKinds?.some(
    (kind) => !result.edges.some((edge) => edge.kind === kind)
  ) ?? false;
  const preferredMatch = benchmark.preferredNodePatterns
    ? benchmark.preferredNodePatterns.every((pattern) => pathLabels.some((label) => pattern.test(label)))
    : true;
  const passed = result.found
    && fromMatch
    && toMatch
    && pathMatch
    && !forbiddenKind
    && !requiredEdgeMissing
    && preferredMatch;

  let detail = passed
    ? "Path resolved to expected graph endpoints."
    : `Expected path from ${benchmark.fromPattern} to ${benchmark.toPattern} with useful hops.`;
  if (forbiddenKind) {
    detail = `Path included forbidden node kind '${forbiddenKind}'.`;
  } else if (!preferredMatch) {
    detail = "Path did not include preferred node patterns.";
  }

  return {
    fixture: benchmark.fixture,
    from: benchmark.from,
    to: benchmark.to,
    passed,
    fromLabel,
    toLabel,
    pathLabels,
    detail,
  };
}

export function evaluateGraphReleaseGates(input: {
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  fixture: string;
  scanMs: number;
  totalScanMs: number;
}): GraphReleaseGateResult {
  const errors: string[] = [];
  const handoffHygiene = evaluateHandoffReadFirstHygiene(input.graph);
  const readFirstQuality = evaluateReadFirstQualityGate(input.graph, input.fixture);
  const hubStartQuality = evaluateHubStartQualityGate(input.graph, input.fixture);
  const docLinkHygiene = evaluateDocLinkHygieneGate({
    graph: input.graph,
    fixture: input.fixture,
    expectBrokenLinks: input.fixture === "fixture-docs-broken-links",
  });
  const communityGates = evaluateCommunityReleaseGates(input.graph);
  if (!handoffHygiene.ok) {
    errors.push(`Read-first contains generated junk: ${handoffHygiene.junkPaths.join(", ")}`);
  }
  if (!readFirstQuality.ok) {
    errors.push(...readFirstQuality.errors);
  }
  if (!hubStartQuality.ok) {
    errors.push(...hubStartQuality.errors);
  }
  if (!docLinkHygiene.ok) {
    errors.push(...docLinkHygiene.errors);
  }
  if (!communityGates.ok) {
    errors.push(...communityGates.errors);
  }

  const sourceFileCount = input.graph.nodes.filter((node) =>
    node.kind === "code_file" || node.kind === "config_file" || node.kind === "doc_file"
  ).length;
  if (sourceFileCount >= GRAPH_COMMUNITY_LARGE_REPO_FILE_THRESHOLD || communityGates.meaningfulCommunityCount >= 2) {
    const hubGates = evaluateCommunityHubReleaseGates(input.graph);
    if (!hubGates.ok) {
      errors.push(...hubGates.errors);
    }
  }

  const fusion = evaluateOagFusionChecks({
    graph: input.graph,
    kernelProfile: input.kernelProfile,
    handoffFreshness: {
      isStale: false,
      handoffPath: "GRAPH_REPORT.md",
      graphGeneratedAt: input.graph.generatedAt,
      handoffUpdatedAt: input.graph.generatedAt,
      detail: "Synthetic freshness for release-gate verification.",
    },
  });
  if (!fusion.ok) {
    errors.push(`Fusion hard gates failed (${fusion.hardFailCount}).`);
  }

  const handoff = renderUnifiedGraphHandoffReport(input.graph, {
    kernelProfile: input.kernelProfile,
    handoffFreshness: {
      isStale: false,
      handoffPath: "GRAPH_REPORT.md",
      graphGeneratedAt: input.graph.generatedAt,
      handoffUpdatedAt: input.graph.generatedAt,
      detail: "Synthetic freshness for release-gate verification.",
    },
  });
  if (!handoff.includes("## Read these first")) {
    errors.push("Handoff report is missing read-these-first guidance.");
  }
  if (!handoff.includes("## Community hubs")) {
    errors.push("Handoff report is missing community hubs section.");
  }
  if (!handoff.includes("## Read first by community")) {
    errors.push("Handoff report is missing read-first-by-community guidance.");
  }
  if (!handoff.includes("## High-degree hub warnings")) {
    errors.push("Handoff report is missing high-degree hub warnings.");
  }
  if (handoffHygiene.junkPaths.some((junkPath) => handoff.includes(junkPath))) {
    errors.push("Handoff markdown includes generated junk paths.");
  }

  const analyzerGates = evaluateAnalyzerReleaseGates({
    graph: input.graph,
    handoffMarkdown: handoff,
  });
  if (!analyzerGates.ok) {
    errors.push(...analyzerGates.errors);
  }

  const semanticLiteEdgeKinds = evaluateSemanticLiteEdgeKindPreservation(input.graph);
  if (!semanticLiteEdgeKinds.ok) {
    errors.push(...semanticLiteEdgeKinds.errors);
  }

  const edgeProvenanceGates = evaluateEdgeProvenanceReleaseGates(input.graph);
  if (!edgeProvenanceGates.ok) {
    errors.push(...edgeProvenanceGates.errors);
  }

  const staticExportGates = evaluateStaticExportReleaseGates({
    graph: input.graph,
    kernelProfile: input.kernelProfile,
    handoffMarkdown: handoff,
  });
  if (!staticExportGates.ok) {
    errors.push(...staticExportGates.errors);
  }

  const scriptGates = evaluateScriptReleaseGates(input.graph);
  if (!scriptGates.ok) {
    errors.push(...scriptGates.errors);
  }

  const ecosystemMatrixGate = evaluateEcosystemSupportMatrixGate({
    graph: input.graph,
    kernelProfile: input.kernelProfile,
    handoffMarkdown: handoff,
  });
  if (!ecosystemMatrixGate.ok) {
    errors.push(...ecosystemMatrixGate.errors);
  }

  const queryBenchmarks = GRAPH_QUERY_BENCHMARKS
    .filter((benchmark) => benchmark.fixture === input.fixture)
    .map((benchmark) => evaluateGraphQueryBenchmark(input.graph, benchmark));
  const pathBenchmarks = GRAPH_PATH_BENCHMARKS
    .filter((benchmark) => benchmark.fixture === input.fixture)
    .map((benchmark) => evaluateGraphPathBenchmark(input.graph, benchmark));
  const querySuccessRate = queryBenchmarks.length > 0
    ? queryBenchmarks.filter((benchmark) => benchmark.passed).length / queryBenchmarks.length
    : 1;
  const pathSuccessRate = pathBenchmarks.length > 0
    ? pathBenchmarks.filter((benchmark) => benchmark.passed).length / pathBenchmarks.length
    : 1;
  const agentBenchmarks = [...queryBenchmarks, ...pathBenchmarks];
  const agentBenchmarkSuccessRate = agentBenchmarks.length > 0
    ? agentBenchmarks.filter((benchmark) => benchmark.passed).length / agentBenchmarks.length
    : 1;

  if (input.totalScanMs > GRAPH_RELEASE_MAX_SCAN_MS) {
    errors.push(`Release fixture scan budget exceeded (${input.totalScanMs}ms > ${GRAPH_RELEASE_MAX_SCAN_MS}ms).`);
  }

  const activeScannerIds = input.kernelProfile?.activeScannerIds ?? input.graph.activeScannerIds;
  const t1Scanners = new Set([
    "python",
    "go",
    "rust",
    "terraform",
    "swift",
    "cpp",
    "flutter",
    "unity",
    "unreal",
    "godot",
  ]);
  for (const scannerId of activeScannerIds) {
    if (!t1Scanners.has(scannerId)) continue;
    const handoffWarnings = [
      ...(input.kernelProfile?.warnings ?? []),
      ...input.graph.diagnostics,
      handoff,
    ].join("\n");
    if (!/T1\s+(?:config\s+)?structural|structural indexing|structural symbols/i.test(handoffWarnings)) {
      errors.push(`T1 scanner '${scannerId}' is active but handoff/export lacks an honest structural tier warning.`);
    }
  }

  const t15Scanners = new Set(["java", "php", "ruby"]);
  for (const scannerId of activeScannerIds) {
    if (!t15Scanners.has(scannerId)) continue;
    const handoffWarnings = [
      ...(input.kernelProfile?.warnings ?? []),
      ...input.graph.diagnostics,
      handoff,
    ].join("\n");
    if (!/T1\.5|semantic-lite/i.test(handoffWarnings)) {
      errors.push(`T1.5 scanner '${scannerId}' is active but handoff/export lacks an honest semantic-lite tier warning.`);
    }
  }

  return {
    ok: errors.length === 0,
    handoffHygiene,
    readFirstQuality,
    hubStartQuality,
    docLinkHygiene,
    communityGates,
    ecosystemMatrixGate,
    queryBenchmarks,
    pathBenchmarks,
    querySuccessRate,
    pathSuccessRate,
    agentBenchmarkSuccessRate,
    fusionOk: fusion.ok,
    fusionHardFailCount: fusion.hardFailCount,
    totalScanMs: input.totalScanMs,
    errors,
  };
}

export function evaluateReleaseBenchmarkSuite(input: {
  results: Array<{
    fixture: string;
    graph: UnifiedCodeGraph;
    kernelProfile?: WorkspaceKernelProfile;
    scanMs: number;
  }>;
}): {
  ok: boolean;
  querySuccessRate: number;
  pathSuccessRate: number;
  agentBenchmarkSuccessRate: number;
  misleadingHandoffRate: number;
  releaseResults: Array<GraphReleaseGateResult & { fixture: string }>;
  errors: string[];
} {
  const releaseFixtures = input.results.filter((result) =>
    (GRAPH_RELEASE_FIXTURE_IDS as readonly string[]).includes(result.fixture)
  );
  const totalScanMs = releaseFixtures.reduce((sum, result) => sum + result.scanMs, 0);
  const releaseResults = releaseFixtures.map((result) => ({
    fixture: result.fixture,
    ...evaluateGraphReleaseGates({
      fixture: result.fixture,
      graph: result.graph,
      kernelProfile: result.kernelProfile,
      scanMs: result.scanMs,
      totalScanMs,
    }),
  }));

  const queryBenchmarked = releaseResults.flatMap((result) => result.queryBenchmarks);
  const pathBenchmarked = releaseResults.flatMap((result) => result.pathBenchmarks);
  const agentBenchmarked = releaseResults.flatMap((result) => [
    ...result.queryBenchmarks,
    ...result.pathBenchmarks,
  ]);
  const querySuccessRate = queryBenchmarked.length > 0
    ? queryBenchmarked.filter((benchmark) => benchmark.passed).length / queryBenchmarked.length
    : 1;
  const pathSuccessRate = pathBenchmarked.length > 0
    ? pathBenchmarked.filter((benchmark) => benchmark.passed).length / pathBenchmarked.length
    : 1;
  const agentBenchmarkSuccessRate = agentBenchmarked.length > 0
    ? agentBenchmarked.filter((benchmark) => benchmark.passed).length / agentBenchmarked.length
    : 1;
  const misleadingHandoffRate = releaseResults.length > 0
    ? releaseResults.reduce((sum, result) => sum + result.handoffHygiene.misleadingHandoffRate, 0)
      / releaseResults.length
    : 0;

  const errors: string[] = [];
  const resultFixtureIds = new Set(input.results.map((result) => result.fixture));
  for (const fixtureId of GRAPH_RELEASE_FIXTURE_IDS) {
    if (!resultFixtureIds.has(fixtureId)) {
      errors.push(`Release fixture '${fixtureId}' is missing from benchmark suite input.`);
    }
    const hasBenchmark =
      GRAPH_QUERY_BENCHMARKS.some((benchmark) => benchmark.fixture === fixtureId)
      || GRAPH_PATH_BENCHMARKS.some((benchmark) => benchmark.fixture === fixtureId);
    if (!hasBenchmark) {
      errors.push(`Release fixture '${fixtureId}' is missing query/path benchmarks.`);
    }
  }
  for (const result of releaseResults) {
    errors.push(...result.errors.map((error) => `${result.fixture}: ${error}`));
  }
  if (pathSuccessRate < GRAPH_RELEASE_MIN_PATH_SUCCESS_RATE) {
    errors.push(
      `Path benchmark success rate ${Math.round(pathSuccessRate * 100)}% is below ${Math.round(GRAPH_RELEASE_MIN_PATH_SUCCESS_RATE * 100)}%.`
    );
  }
  if (agentBenchmarkSuccessRate < GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE) {
    errors.push(
      `Agent benchmark success rate ${Math.round(agentBenchmarkSuccessRate * 100)}% is below ${Math.round(GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE * 100)}% (query=${Math.round(querySuccessRate * 100)}%, path=${Math.round(pathSuccessRate * 100)}%).`
    );
  }
  if (misleadingHandoffRate > 0) {
    errors.push(`Misleading handoff rate ${Math.round(misleadingHandoffRate * 100)}% must be 0%.`);
  }

  return {
    ok: errors.length === 0,
    querySuccessRate,
    pathSuccessRate,
    agentBenchmarkSuccessRate,
    misleadingHandoffRate,
    releaseResults,
    errors,
  };
}
