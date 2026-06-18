import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import { evaluateStaticExportReleaseGates } from "./graphExportBundle.js";
import { renderUnifiedGraphHandoffReport } from "./graphArtifacts.js";
import {
  evaluateGraphPathBenchmark,
  evaluateGraphQueryBenchmark,
  evaluateHandoffReadFirstHygiene,
  GRAPH_PATH_BENCHMARKS,
  GRAPH_QUERY_BENCHMARKS,
} from "./graphReleaseGates.js";
import { sanitizeOperationalText } from "./safeText.js";

export type GraphExternalBenchmarkCategoryId =
  | "typescript-web"
  | "csharp-desktop"
  | "java-kotlin-service"
  | "php-framework"
  | "ruby-app"
  | "flutter-app"
  | "cpp-cmake"
  | "game-repo"
  | "docs-only"
  | "mixed-monorepo";

export const GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS = [
  "typescript-web",
  "csharp-desktop",
  "java-kotlin-service",
  "php-framework",
  "ruby-app",
  "flutter-app",
  "cpp-cmake",
  "game-repo",
  "docs-only",
  "mixed-monorepo",
] as const satisfies readonly GraphExternalBenchmarkCategoryId[];

export interface GraphExternalBenchmarkCatalogEntry {
  id: GraphExternalBenchmarkCategoryId;
  label: string;
  description: string;
  referenceRepo: string;
  localFixture: string;
}

export const GRAPH_EXTERNAL_BENCHMARK_CATALOG: GraphExternalBenchmarkCatalogEntry[] = [
  {
    id: "typescript-web",
    label: "TypeScript web app",
    description: "SPA or full-stack web repo with TypeScript entrypoints.",
    referenceRepo: "https://github.com/vercel/next.js/tree/canary/examples/hello-world",
    localFixture: "fixture-next-app",
  },
  {
    id: "csharp-desktop",
    label: "C# desktop/backend",
    description: "Desktop or backend solution with .NET projects and symbols.",
    referenceRepo: "https://github.com/dotnet/wpf",
    localFixture: "fixture-csharp-wpf",
  },
  {
    id: "java-kotlin-service",
    label: "Java/Kotlin service",
    description: "Gradle or Maven service with layered modules.",
    referenceRepo: "https://github.com/spring-projects/spring-petclinic",
    localFixture: "fixture-kotlin-spring",
  },
  {
    id: "php-framework",
    label: "PHP framework app",
    description: "Composer-backed framework app with controllers and services.",
    referenceRepo: "https://github.com/laravel/laravel",
    localFixture: "fixture-php-laravel",
  },
  {
    id: "ruby-app",
    label: "Ruby app/gem",
    description: "Rails or gem repo with Ruby constants and routes.",
    referenceRepo: "https://github.com/rails/rails",
    localFixture: "fixture-ruby-rails",
  },
  {
    id: "flutter-app",
    label: "Flutter app",
    description: "Flutter app with widgets, services, and pubspec.",
    referenceRepo: "https://github.com/flutter/samples/tree/main/animations",
    localFixture: "fixture-flutter-app",
  },
  {
    id: "cpp-cmake",
    label: "C++/CMake project",
    description: "Native project with CMake targets and compile units.",
    referenceRepo: "https://github.com/nlohmann/json",
    localFixture: "fixture-cpp-cmake",
  },
  {
    id: "game-repo",
    label: "Game repo",
    description: "Game engine repo with scenes, scripts, and native glue.",
    referenceRepo: "https://github.com/godotengine/godot-demo-projects",
    localFixture: "fixture-godot-lite",
  },
  {
    id: "docs-only",
    label: "Docs-only repo",
    description: "Documentation-first repo with linked guides and architecture notes.",
    referenceRepo: "https://github.com/github/docs",
    localFixture: "fixture-docs-only",
  },
  {
    id: "mixed-monorepo",
    label: "Mixed monorepo",
    description: "Polyglot monorepo spanning multiple scanners and config roots.",
    referenceRepo: "https://github.com/nrwl/nx-examples-monorepo",
    localFixture: "mixed-dotnet-node",
  },
];

export interface GraphExternalBenchmarkScorecard {
  categoryId: GraphExternalBenchmarkCategoryId;
  label: string;
  workspaceRoot: string;
  referenceRepo: string;
  localFixture?: string;
  scanSuccess: boolean;
  scanMs: number;
  indexedFileCount: number;
  usefulSymbolCount: number;
  queryBenchmarkPassRate: number | null;
  pathBenchmarkPassRate: number | null;
  misleadingHandoffRate: number;
  exportCompleteness: boolean;
  provenanceCoverage: number;
  updateTimeMs: number | null;
  passed: boolean;
  errors: string[];
  scannerTasks: string[];
}

export interface GraphExternalBenchmarkSuiteResult {
  ok: boolean;
  results: GraphExternalBenchmarkScorecard[];
  errors: string[];
}

const SOURCE_BODY_LEAK_PATTERNS = [
  /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{[\s\S]{24,}/,
  /\bpublic\s+(?:sealed\s+)?class\s+\w+[\s\S]{24,}\{[\s\S]{24,}/,
  /```[\s\S]{24,}```/,
];

export function isGraphExternalBenchmarkCategoryId(
  value: string
): value is GraphExternalBenchmarkCategoryId {
  return (GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS as readonly string[]).includes(value);
}

export function parseGraphExternalBenchmarkCategoryId(
  value: string
): GraphExternalBenchmarkCategoryId {
  if (!isGraphExternalBenchmarkCategoryId(value)) {
    throw new Error(
      `Unknown external benchmark category '${value}'. Valid categories: ${GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS.join(", ")}.`
    );
  }
  return value;
}

export function findExternalBenchmarkCatalogEntry(
  categoryId: GraphExternalBenchmarkCategoryId
) {
  return GRAPH_EXTERNAL_BENCHMARK_CATALOG.find((entry) => entry.id === categoryId);
}

function isUsefulSymbolNode(node: UnifiedCodeGraph["nodes"][number]) {
  if (node.kind !== "symbol" && node.kind !== "doc_section") return false;
  if (/\(external\)/i.test(node.label)) return false;
  return true;
}

function countIndexedFiles(graph: UnifiedCodeGraph) {
  return graph.nodes.filter((node) =>
    node.kind === "code_file" || node.kind === "config_file" || node.kind === "doc_file"
  ).length;
}

function computeProvenanceCoverage(graph: UnifiedCodeGraph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const scopedEdges = graph.edges.filter((edge) => {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    return source?.kind !== "community" && target?.kind !== "community";
  });
  if (scopedEdges.length === 0) return 1;
  let covered = 0;
  for (const edge of scopedEdges) {
    const hasProvenance = Boolean(edge.provenance);
    const hasSource = Boolean(edge.source);
    const needsConfidence = edge.provenance === "inferred" || edge.provenance === "ambiguous";
    const hasConfidence = !needsConfidence || typeof edge.confidence === "number";
    if (hasProvenance && hasSource && hasConfidence) covered += 1;
  }
  return covered / scopedEdges.length;
}

function benchmarkPassRate(values: boolean[]) {
  if (values.length === 0) return null;
  return values.filter(Boolean).length / values.length;
}

export function buildExternalBenchmarkScannerTasks(input: {
  categoryId: GraphExternalBenchmarkCategoryId;
  errors: string[];
  queryBenchmarkPassRate: number | null;
  pathBenchmarkPassRate: number | null;
  provenanceCoverage: number;
  misleadingHandoffRate: number;
  exportCompleteness: boolean;
  usefulSymbolCount: number;
}) {
  const tasks: string[] = [];
  if (input.usefulSymbolCount < 1) {
    tasks.push(`[${input.categoryId}] Emit useful symbol nodes for the primary language in this category.`);
  }
  if (input.queryBenchmarkPassRate !== null && input.queryBenchmarkPassRate < 1) {
    tasks.push(`[${input.categoryId}] Improve query neighborhood quality for the category sample query.`);
  }
  if (input.pathBenchmarkPassRate !== null && input.pathBenchmarkPassRate < 1) {
    tasks.push(`[${input.categoryId}] Strengthen path resolution between the category sample endpoints.`);
  }
  if (input.misleadingHandoffRate > 0) {
    tasks.push(`[${input.categoryId}] Remove generated or junk paths from read-first handoff guidance.`);
  }
  if (!input.exportCompleteness) {
    tasks.push(`[${input.categoryId}] Complete static export envelope and offline handoff sections.`);
  }
  if (input.provenanceCoverage < 1) {
    tasks.push(`[${input.categoryId}] Add provenance, derivation source, and confidence to non-community edges.`);
  }
  for (const error of input.errors) {
    const sanitized = sanitizeOperationalText(error, { maxLength: 220 });
    if (!tasks.some((task) => task.includes(sanitized))) {
      tasks.push(`[${input.categoryId}] ${sanitized}`);
    }
  }
  return tasks;
}

export function evaluateGraphExternalBenchmark(input: {
  categoryId: GraphExternalBenchmarkCategoryId;
  workspaceRoot: string;
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
  scanMs: number;
  scanSuccess?: boolean;
  updateTimeMs?: number | null;
  localFixture?: string;
}): GraphExternalBenchmarkScorecard {
  const catalogEntry = findExternalBenchmarkCatalogEntry(input.categoryId);
  const fixtureKey = input.localFixture ?? catalogEntry?.localFixture;
  const handoff = renderUnifiedGraphHandoffReport(input.graph, {
    kernelProfile: input.kernelProfile,
    handoffFreshness: {
      isStale: false,
      handoffPath: "GRAPH_REPORT.md",
      graphGeneratedAt: input.graph.generatedAt,
      handoffUpdatedAt: input.graph.generatedAt,
      detail: "Synthetic freshness for external benchmark evaluation.",
    },
  });
  const handoffHygiene = evaluateHandoffReadFirstHygiene(input.graph);
  const exportGates = evaluateStaticExportReleaseGates({
    graph: input.graph,
    kernelProfile: input.kernelProfile,
    handoffMarkdown: handoff,
  });
  const provenanceCoverage = computeProvenanceCoverage(input.graph);

  const queryBenchmarks = fixtureKey
    ? GRAPH_QUERY_BENCHMARKS
      .filter((benchmark) => benchmark.fixture === fixtureKey)
      .map((benchmark) => evaluateGraphQueryBenchmark(input.graph, benchmark))
    : [];
  const pathBenchmarks = fixtureKey
    ? GRAPH_PATH_BENCHMARKS
      .filter((benchmark) => benchmark.fixture === fixtureKey)
      .map((benchmark) => evaluateGraphPathBenchmark(input.graph, benchmark))
    : [];

  const queryBenchmarkPassRate = benchmarkPassRate(queryBenchmarks.map((benchmark) => benchmark.passed));
  const pathBenchmarkPassRate = benchmarkPassRate(pathBenchmarks.map((benchmark) => benchmark.passed));
  const usefulSymbolCount = input.graph.nodes.filter(isUsefulSymbolNode).length;
  const scanSuccess = input.scanSuccess ?? input.graph.nodes.length > 0;

  const errors: string[] = [];
  if (!scanSuccess) errors.push("Scan did not produce a usable graph.");
  if (usefulSymbolCount < 1) errors.push("No useful symbol nodes were indexed.");
  if (handoffHygiene.misleadingHandoffRate > 0) {
    errors.push(`Misleading handoff rate ${Math.round(handoffHygiene.misleadingHandoffRate * 100)}% must be 0%.`);
  }
  if (!exportGates.ok) errors.push(...exportGates.errors);
  if (provenanceCoverage < 1) {
    errors.push(`Provenance coverage ${Math.round(provenanceCoverage * 100)}% is below 100%.`);
  }

  const scannerTasks = buildExternalBenchmarkScannerTasks({
    categoryId: input.categoryId,
    errors,
    queryBenchmarkPassRate,
    pathBenchmarkPassRate,
    provenanceCoverage,
    misleadingHandoffRate: handoffHygiene.misleadingHandoffRate,
    exportCompleteness: exportGates.ok,
    usefulSymbolCount,
  });

  return {
    categoryId: input.categoryId,
    label: catalogEntry?.label ?? input.categoryId,
    workspaceRoot: input.workspaceRoot,
    referenceRepo: catalogEntry?.referenceRepo ?? "",
    localFixture: fixtureKey,
    scanSuccess,
    scanMs: input.scanMs,
    indexedFileCount: countIndexedFiles(input.graph),
    usefulSymbolCount,
    queryBenchmarkPassRate,
    pathBenchmarkPassRate,
    misleadingHandoffRate: handoffHygiene.misleadingHandoffRate,
    exportCompleteness: exportGates.ok,
    provenanceCoverage,
    updateTimeMs: input.updateTimeMs ?? null,
    passed: errors.length === 0,
    errors,
    scannerTasks,
  };
}

export function evaluateGraphExternalBenchmarkSuite(
  results: GraphExternalBenchmarkScorecard[],
  options: { requireAllCategories?: boolean } = {}
): GraphExternalBenchmarkSuiteResult {
  const errors: string[] = [];
  if (options.requireAllCategories !== false) {
    for (const categoryId of GRAPH_EXTERNAL_BENCHMARK_CATEGORY_IDS) {
      if (!results.some((result) => result.categoryId === categoryId)) {
        errors.push(`External benchmark category '${categoryId}' is missing.`);
      }
    }
  }
  for (const result of results) {
    if (!result.passed) {
      errors.push(`${result.label}: ${result.errors.join(" ")}`);
    }
  }
  return {
    ok: errors.length === 0,
    results,
    errors,
  };
}

export function reportContainsSourceBodyLeak(report: string) {
  return SOURCE_BODY_LEAK_PATTERNS.some((pattern) => pattern.test(report));
}

export function formatGraphExternalBenchmarkReport(results: GraphExternalBenchmarkScorecard[]) {
  const lines = [
    "# OAG External Benchmark Report",
    "",
    "This report contains scorecard metrics only. Source file bodies are intentionally omitted.",
    "",
  ];
  for (const result of results) {
    lines.push(`## ${result.label}`);
    lines.push(`- Category: \`${result.categoryId}\``);
    lines.push(`- Workspace: \`${sanitizeOperationalText(result.workspaceRoot)}\``);
    lines.push(`- Reference repo: ${result.referenceRepo}`);
    if (result.localFixture) lines.push(`- Local fixture: \`${result.localFixture}\``);
    lines.push(`- Passed: ${result.passed ? "yes" : "no"}`);
    lines.push(`- Scan success: ${result.scanSuccess ? "yes" : "no"}`);
    lines.push(`- Scan time: ${result.scanMs}ms`);
    lines.push(`- Indexed files: ${result.indexedFileCount}`);
    lines.push(`- Useful symbols: ${result.usefulSymbolCount}`);
    lines.push(`- Query pass rate: ${result.queryBenchmarkPassRate === null ? "n/a" : `${Math.round(result.queryBenchmarkPassRate * 100)}%`}`);
    lines.push(`- Path pass rate: ${result.pathBenchmarkPassRate === null ? "n/a" : `${Math.round(result.pathBenchmarkPassRate * 100)}%`}`);
    lines.push(`- Misleading handoff rate: ${Math.round(result.misleadingHandoffRate * 100)}%`);
    lines.push(`- Export completeness: ${result.exportCompleteness ? "yes" : "no"}`);
    lines.push(`- Provenance coverage: ${Math.round(result.provenanceCoverage * 100)}%`);
    lines.push(`- Update time: ${result.updateTimeMs === null ? "n/a" : `${result.updateTimeMs}ms`}`);
    if (result.errors.length > 0) {
      lines.push("- Errors:");
      for (const error of result.errors) {
        lines.push(`  - ${sanitizeOperationalText(error, { maxLength: 220 })}`);
      }
    }
    if (result.scannerTasks.length > 0) {
      lines.push("- Scanner tasks:");
      for (const task of result.scannerTasks) {
        lines.push(`  - ${sanitizeOperationalText(task, { maxLength: 220 })}`);
      }
    }
    lines.push("");
  }
  const report = `${lines.join("\n")}\n`;
  if (reportContainsSourceBodyLeak(report)) {
    throw new Error("External benchmark report appears to include source body content.");
  }
  return report;
}

export function formatGraphExternalBenchmarkSummaryLine(suite: GraphExternalBenchmarkSuiteResult) {
  const passed = suite.results.filter((result) => result.passed).length;
  const avgProvenance = suite.results.length > 0
    ? Math.round(
      suite.results.reduce((sum, result) => sum + result.provenanceCoverage, 0) / suite.results.length * 100
    )
    : 0;
  return `External benchmarks: ${suite.ok ? "PASS" : "FAIL"} categories=${suite.results.length} passed=${passed}/${suite.results.length} avgProvenance=${avgProvenance}%`;
}