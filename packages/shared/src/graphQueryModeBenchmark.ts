import type { UnifiedCodeGraph, UnifiedCodeGraphNode } from "./codeGraph.js";
import { queryUnifiedCodeGraph } from "./graphQueryEngine.js";
import {
  isGraphCodeSurfaceKind,
  isGraphDocSurfaceKind,
  type GraphQueryIntentMode,
} from "./graphQueryIntent.js";
import type { GraphReleaseFixtureId } from "./graphReleaseGates.js";

export type GraphQueryMode = GraphQueryIntentMode;

export interface GraphQueryModeBenchmarkCase {
  fixture: GraphReleaseFixtureId;
  query: string;
  mode: GraphQueryMode;
  expectedTopKind: UnifiedCodeGraphNode["kind"] | "code_surface" | "doc_surface";
  expectedTopPattern: RegExp;
  allowFallback?: boolean;
}

export interface GraphQueryModeBenchmarkResult {
  fixture: string;
  query: string;
  mode: GraphQueryMode;
  passed: boolean;
  effectiveMode: GraphQueryMode;
  topLabels: string[];
  topKinds: string[];
  fallbackUsed: boolean;
  detail: string;
}

function matchesExpectedKind(
  kind: UnifiedCodeGraphNode["kind"],
  expected: GraphQueryModeBenchmarkCase["expectedTopKind"]
) {
  if (expected === "code_surface") return isGraphCodeSurfaceKind(kind);
  if (expected === "doc_surface") return isGraphDocSurfaceKind(kind);
  return kind === expected;
}

function topRankedNodes(graph: UnifiedCodeGraph, query: string, mode: GraphQueryMode) {
  const result = queryUnifiedCodeGraph(graph, query, { budget: 24, intentMode: mode });
  const ordered = [...result.seeds, ...result.nodes].filter((node, index, array) =>
    array.findIndex((entry) => entry.id === node.id) === index
  );
  return {
    result,
    ordered,
    top: ordered[0],
    topLabels: ordered.slice(0, 5).map((node) => node.label),
    topKinds: ordered.slice(0, 5).map((node) => node.kind),
  };
}

export function evaluateGraphQueryModeBenchmark(
  graph: UnifiedCodeGraph,
  benchmark: GraphQueryModeBenchmarkCase
): GraphQueryModeBenchmarkResult {
  const ranked = topRankedNodes(graph, benchmark.query, benchmark.mode);
  const top = ranked.top;
  const effectiveMode = ranked.result.intent?.effectiveMode ?? benchmark.mode;
  const patternMatch = top ? benchmark.expectedTopPattern.test(top.label) : false;
  const kindMatch = top ? matchesExpectedKind(top.kind, benchmark.expectedTopKind) : false;
  const fallbackUsed = ranked.result.intent?.fallbackUsed ?? false;
  const passed = patternMatch && kindMatch && (!fallbackUsed || benchmark.allowFallback === true);

  return {
    fixture: benchmark.fixture,
    query: benchmark.query,
    mode: benchmark.mode,
    passed,
    effectiveMode,
    topLabels: ranked.topLabels,
    topKinds: ranked.topKinds,
    fallbackUsed,
    detail: passed
      ? `Top result '${top?.label ?? "none"}' matches ${benchmark.mode} expectations.`
      : `Expected ${benchmark.mode} top matching ${benchmark.expectedTopPattern} as ${benchmark.expectedTopKind}, got '${top?.label ?? "none"}' (${top?.kind ?? "none"}).`,
  };
}

export const GRAPH_QUERY_MODE_BENCHMARKS: GraphQueryModeBenchmarkCase[] = [
  {
    fixture: "fixture-csharp-media-player",
    query: "MainViewModel playback adapter",
    mode: "code",
    expectedTopKind: "code_surface",
    expectedTopPattern: /MainViewModel|MpvPlayerAdapter|PlaybackService/i,
  },
  {
    fixture: "fixture-csharp-media-player",
    query: "architecture playback guide",
    mode: "docs",
    expectedTopKind: "doc_surface",
    expectedTopPattern: /playback|architecture|guide|doc/i,
    allowFallback: true,
  },
  {
    fixture: "fixture-docs-mixed-code",
    query: "how does checkout work",
    mode: "docs",
    expectedTopKind: "doc_surface",
    expectedTopPattern: /checkout|feature|architecture|runbook/i,
    allowFallback: true,
  },
  {
    fixture: "fixture-docs-mixed-code",
    query: "CheckoutController service",
    mode: "code",
    expectedTopKind: "code_surface",
    expectedTopPattern: /CheckoutController|CheckoutService|CheckoutRepository/i,
  },
  {
    fixture: "fixture-next-app",
    query: "OrdersController list orders",
    mode: "code",
    expectedTopKind: "code_surface",
    expectedTopPattern: /OrdersController|OrdersService|OrdersRepository|page/i,
  },
  {
    fixture: "fixture-docs-only",
    query: "architecture guide overview",
    mode: "docs",
    expectedTopKind: "doc_surface",
    expectedTopPattern: /architecture|guide|readme/i,
  },
  {
    fixture: "fixture-java-maven",
    query: "CheckoutService order repository",
    mode: "code",
    expectedTopKind: "code_surface",
    expectedTopPattern: /CheckoutService|Order/i,
  },
  {
    fixture: "fixture-csharp-media-player",
    query: "MainViewModel playback",
    mode: "balanced",
    expectedTopKind: "code_surface",
    expectedTopPattern: /MainViewModel|PlaybackService|MpvPlayerAdapter/i,
  },
];