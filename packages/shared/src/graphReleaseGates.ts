import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import { getReadTheseFirstNodes, renderUnifiedGraphHandoffReport } from "./graphArtifacts.js";
import { evaluateCommunityReleaseGates } from "./graphCommunities.js";
import { evaluateOagFusionChecks } from "./graphFusion.js";
import { queryUnifiedCodeGraph } from "./graphQueryEngine.js";

export const GRAPH_RELEASE_FIXTURE_IDS = [
  "fixture-csharp-wpf",
  "fixture-csharp-media-player",
  "fixture-next-app",
  "fixture-python-django",
  "fixture-java-maven",
  "fixture-java-gradle-multimodule",
  "fixture-kotlin-gradle",
  "fixture-go-module",
  "fixture-rust-workspace",
  "fixture-terraform",
  "fixture-ruby-rails",
  "fixture-ruby-gem",
  "fixture-php-laravel",
  "fixture-php-wordpress-plugin",
  "fixture-mixed-polyglot",
  "fixture-docs-only",
  "fixture-empty",
] as const;

export type GraphReleaseFixtureId = (typeof GRAPH_RELEASE_FIXTURE_IDS)[number];

export const GRAPH_RELEASE_MAX_SCAN_MS = 5 * 60 * 1000;
export const GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE = 0.8;

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
    fixture: "fixture-go-module",
    query: "Runner service",
    seedPattern: /Runner/i,
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

export interface GraphCommunityGateResult {
  ok: boolean;
  communityCount: number;
  meaningfulCommunityCount: number;
  genericCommunityCount: number;
  generatedDominanceRatio: number;
  errors: string[];
}

export interface GraphReleaseGateResult {
  ok: boolean;
  handoffHygiene: GraphHandoffHygieneResult;
  communityGates: GraphCommunityGateResult;
  queryBenchmarks: GraphQueryBenchmarkResult[];
  querySuccessRate: number;
  fusionOk: boolean;
  fusionHardFailCount: number;
  totalScanMs: number;
  errors: string[];
}

function pathLooksLikeJunk(value: string) {
  const normalized = value.replace(/\\/g, "/");
  return READ_FIRST_JUNK_PATTERNS.some((pattern) => normalized.includes(pattern));
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

export function evaluateGraphReleaseGates(input: {
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  fixture: string;
  scanMs: number;
  totalScanMs: number;
}): GraphReleaseGateResult {
  const errors: string[] = [];
  const handoffHygiene = evaluateHandoffReadFirstHygiene(input.graph);
  const communityGates = evaluateCommunityReleaseGates(input.graph);
  if (!handoffHygiene.ok) {
    errors.push(`Read-first contains generated junk: ${handoffHygiene.junkPaths.join(", ")}`);
  }
  if (!communityGates.ok) {
    errors.push(...communityGates.errors);
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
  if (handoffHygiene.junkPaths.some((junkPath) => handoff.includes(junkPath))) {
    errors.push("Handoff markdown includes generated junk paths.");
  }

  const queryBenchmarks = GRAPH_QUERY_BENCHMARKS
    .filter((benchmark) => benchmark.fixture === input.fixture)
    .map((benchmark) => evaluateGraphQueryBenchmark(input.graph, benchmark));
  const querySuccessRate = queryBenchmarks.length > 0
    ? queryBenchmarks.filter((benchmark) => benchmark.passed).length / queryBenchmarks.length
    : 1;

  if (input.totalScanMs > GRAPH_RELEASE_MAX_SCAN_MS) {
    errors.push(`Release fixture scan budget exceeded (${input.totalScanMs}ms > ${GRAPH_RELEASE_MAX_SCAN_MS}ms).`);
  }

  const activeScannerIds = input.kernelProfile?.activeScannerIds ?? input.graph.activeScannerIds;
  const t1Scanners = new Set(["python", "go", "rust", "terraform", "java", "ruby", "php"]);
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

  return {
    ok: errors.length === 0,
    handoffHygiene,
    communityGates,
    queryBenchmarks,
    querySuccessRate,
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

  const benchmarked = releaseResults.flatMap((result) => result.queryBenchmarks);
  const querySuccessRate = benchmarked.length > 0
    ? benchmarked.filter((benchmark) => benchmark.passed).length / benchmarked.length
    : 1;
  const misleadingHandoffRate = releaseResults.length > 0
    ? releaseResults.reduce((sum, result) => sum + result.handoffHygiene.misleadingHandoffRate, 0)
      / releaseResults.length
    : 0;

  const errors: string[] = [];
  for (const result of releaseResults) {
    errors.push(...result.errors.map((error) => `${result.fixture}: ${error}`));
  }
  if (querySuccessRate < GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE) {
    errors.push(
      `Agent query success rate ${Math.round(querySuccessRate * 100)}% is below ${Math.round(GRAPH_RELEASE_MIN_QUERY_SUCCESS_RATE * 100)}%.`
    );
  }
  if (misleadingHandoffRate > 0) {
    errors.push(`Misleading handoff rate ${Math.round(misleadingHandoffRate * 100)}% must be 0%.`);
  }

  return {
    ok: errors.length === 0,
    querySuccessRate,
    misleadingHandoffRate,
    releaseResults,
    errors,
  };
}
