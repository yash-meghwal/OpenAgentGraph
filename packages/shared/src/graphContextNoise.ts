import type { UnifiedCodeGraph } from "./codeGraph.js";

export const CONTEXT_NOISE_LARGE_FILE_BYTES = 32_768;

export const CONTEXT_NOISE_GENERATED_PATH_PATTERNS = [
  /(?:^|\/)\.oag(?:\/|$)/i,
  /(?:^|\/)GRAPH_REPORT\.md$/i,
  /(?:^|\/)(?:dist|build|coverage|node_modules|bin|obj)(?:\/|$)/i,
  /(?:^|\/)graphify-out(?:\/|$)/i,
] as const;

export const CONTEXT_NOISE_STALE_PLAN_PATTERN = /^PLAN-[A-Z0-9.-]+\.md$/i;

const CONTEXT_NOISE_SEVERITY_PENALTY = {
  low: 4,
  medium: 10,
  high: 18,
} as const;

export interface GraphContextNoiseItem {
  kind:
    | "generated_artifact"
    | "large_file"
    | "stale_plan"
    | "broken_doc_link"
    | "root_clutter"
    | "missing_gitignore_protection"
    | "contradictory_instruction"
    | "generated_source_like"
    | "unsupported_ecosystem";
  path?: string;
  detail: string;
  severity: "low" | "medium" | "high";
}

export interface GraphContextNoiseSummary {
  score: number;
  noiseItems: GraphContextNoiseItem[];
  recommendations: string[];
}

export interface ContextNoiseDiagnostics {
  brokenDocLinkCount?: number;
  largeFilePaths?: string[];
  trackedGeneratedPaths?: string[];
  rootPlanFiles?: string[];
  gitignoreMissingPatterns?: string[];
  instructionConflicts?: string[];
  ecosystemLimitations?: string[];
}

const GENERATED_SOURCE_LIKE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|cs|py|go|rs)$/i;
const GENERATED_SOURCE_LIKE_DIRS = /(?:^|\/)(?:dist|build|coverage|generated|\.oag|bin|obj)(?:\/|$)/i;
const CONTEXT_NOISE_UNSUPPORTED_ECOSYSTEM_FILE_THRESHOLD = 12;

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

function collectIndexedPaths(graph: UnifiedCodeGraph) {
  const paths: string[] = [];
  for (const node of graph.nodes) {
    const candidate = node.path ?? node.label;
    if (!candidate) continue;
    if (!["code_file", "config_file", "doc_file", "test", "asset_file"].includes(node.kind)) continue;
    paths.push(normalizePath(candidate));
  }
  return paths;
}

function isGeneratedNoisePath(path: string) {
  return CONTEXT_NOISE_GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function countBrokenDocDiagnostics(diagnostics: string[]) {
  return diagnostics.filter((line) => /Broken doc (?:link|anchor)/i.test(line)).length;
}

export function evaluateContextNoise(
  graph: UnifiedCodeGraph,
  diagnostics: ContextNoiseDiagnostics = {}
): GraphContextNoiseSummary {
  const indexedPaths = collectIndexedPaths(graph);
  const noiseItems: GraphContextNoiseItem[] = [];
  const recommendations: string[] = [];
  let penalty = 0;

  const generatedPaths = [
    ...indexedPaths.filter((path) => isGeneratedNoisePath(path)),
    ...(diagnostics.trackedGeneratedPaths ?? []).map(normalizePath),
  ];
  for (const path of [...new Set(generatedPaths)]) {
    const severity: GraphContextNoiseItem["severity"] =
      path.includes("node_modules") || path.includes(".oag") ? "high" : "medium";
    noiseItems.push({
      kind: "generated_artifact",
      path,
      detail: "Tracked or indexed generated artifact likely to pollute agent context.",
      severity,
    });
    penalty += CONTEXT_NOISE_SEVERITY_PENALTY[severity];
  }
  if (generatedPaths.length > 0) {
    recommendations.push("Stop tracking generated artifacts; add dist/build/coverage/.oag to .gitignore.");
  }

  const largeFiles = diagnostics.largeFilePaths ?? indexedPaths.filter((path) => {
    const bytes = graph.nodes.find((node) => normalizePath(node.path ?? node.label) === path)
      ?.metadata?.fileSizeBytes;
    return typeof bytes === "number" && bytes >= CONTEXT_NOISE_LARGE_FILE_BYTES;
  });
  for (const path of largeFiles) {
    const severity: GraphContextNoiseItem["severity"] = "medium";
    noiseItems.push({
      kind: "large_file",
      path,
      detail: `Large file may dominate retrieval context (>= ${CONTEXT_NOISE_LARGE_FILE_BYTES} bytes).`,
      severity,
    });
    penalty += CONTEXT_NOISE_SEVERITY_PENALTY[severity];
  }

  const stalePlans = diagnostics.rootPlanFiles
    ?? indexedPaths.filter((path) => !path.includes("/") && CONTEXT_NOISE_STALE_PLAN_PATTERN.test(path));
  for (const path of stalePlans) {
    const severity: GraphContextNoiseItem["severity"] = "low";
    noiseItems.push({
      kind: "stale_plan",
      path,
      detail: "Stale plan/report file at repo root can mislead agents.",
      severity,
    });
    penalty += CONTEXT_NOISE_SEVERITY_PENALTY[severity];
  }
  if (stalePlans.length > 0) {
    recommendations.push("Archive or remove stale root-level plan files after work completes.");
  }

  const brokenDocLinkCount = diagnostics.brokenDocLinkCount ?? countBrokenDocDiagnostics(graph.diagnostics);
  if (brokenDocLinkCount > 0) {
    const severity: GraphContextNoiseItem["severity"] = brokenDocLinkCount >= 3 ? "high" : "medium";
    noiseItems.push({
      kind: "broken_doc_link",
      detail: `${brokenDocLinkCount} broken documentation link(s) detected.`,
      severity,
    });
    penalty += Math.min(CONTEXT_NOISE_SEVERITY_PENALTY.high * 2, brokenDocLinkCount * CONTEXT_NOISE_SEVERITY_PENALTY[severity]);
    recommendations.push("Repair broken setup/architecture doc links before agent onboarding.");
  }

  const rootClutter = indexedPaths.filter((path) => {
    const base = path.split("/").pop() ?? path;
    return !path.includes("/") && /^(?:REPORT|NOTES|TODO|SCRATCH|OLD)-/i.test(base);
  });
  for (const path of rootClutter) {
    const severity: GraphContextNoiseItem["severity"] = "low";
    noiseItems.push({
      kind: "root_clutter",
      path,
      detail: "Root-level scratch/report file adds avoidable context noise.",
      severity,
    });
    penalty += CONTEXT_NOISE_SEVERITY_PENALTY[severity];
  }

  for (const pattern of diagnostics.gitignoreMissingPatterns ?? []) {
    const severity: GraphContextNoiseItem["severity"] = "medium";
    noiseItems.push({
      kind: "missing_gitignore_protection",
      detail: `Common generated path '${pattern}' is not protected by .gitignore.`,
      severity,
    });
    penalty += CONTEXT_NOISE_SEVERITY_PENALTY[severity];
    recommendations.push(`Add ${pattern} to .gitignore to keep exports and agents focused.`);
  }

  for (const detail of diagnostics.instructionConflicts ?? []) {
    const severity: GraphContextNoiseItem["severity"] = "medium";
    noiseItems.push({
      kind: "contradictory_instruction",
      detail,
      severity,
    });
    penalty += CONTEXT_NOISE_SEVERITY_PENALTY[severity];
  }
  if ((diagnostics.instructionConflicts?.length ?? 0) > 0) {
    recommendations.push("Resolve conflicting setup, test, or agent instruction guidance.");
  }

  const generatedPathSet = new Set(generatedPaths.map(normalizePath));
  for (const path of indexedPaths) {
    if (generatedPathSet.has(path)) continue;
    if (!GENERATED_SOURCE_LIKE_DIRS.test(path) || !GENERATED_SOURCE_LIKE_EXTENSIONS.test(path)) continue;
    const severity: GraphContextNoiseItem["severity"] = "medium";
    noiseItems.push({
      kind: "generated_source_like",
      path,
      detail: "Generated output with source-like extension may be mistaken for editable code.",
      severity,
    });
    penalty += CONTEXT_NOISE_SEVERITY_PENALTY[severity];
  }
  if (noiseItems.some((item) => item.kind === "generated_source_like")) {
    recommendations.push("Keep generated source-like artifacts out of tracked paths and agent read-first lists.");
  }

  if (
    indexedPaths.length >= CONTEXT_NOISE_UNSUPPORTED_ECOSYSTEM_FILE_THRESHOLD
    && (diagnostics.ecosystemLimitations?.length ?? 0) > 0
  ) {
    for (const limitation of diagnostics.ecosystemLimitations ?? []) {
      const severity: GraphContextNoiseItem["severity"] = indexedPaths.length >= 24 ? "medium" : "low";
      noiseItems.push({
        kind: "unsupported_ecosystem",
        detail: limitation,
        severity,
      });
      penalty += CONTEXT_NOISE_SEVERITY_PENALTY[severity];
    }
    recommendations.push("Treat structural-only ecosystems as lower-trust context until semantic support is available.");
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  return {
    score,
    noiseItems,
    recommendations: [...new Set(recommendations)],
  };
}

export function formatGraphContextNoiseMarkdown(summary: GraphContextNoiseSummary): string[] {
  const lines = [
    "## Context noise",
    "",
    `- Score: ${summary.score}/100 (higher is cleaner)`,
    `- Noise items: ${summary.noiseItems.length}`,
    "",
  ];

  if (summary.noiseItems.length > 0) {
    lines.push("### Highlights", "");
    for (const item of summary.noiseItems.slice(0, 8)) {
      const location = item.path ? `${item.path} — ` : "";
      lines.push(`- ${item.kind}: ${location}${item.detail}`);
    }
    lines.push("");
  }

  if (summary.recommendations.length > 0) {
    lines.push("### Recommendations", "");
    for (const recommendation of summary.recommendations.slice(0, 6)) {
      lines.push(`- ${recommendation}`);
    }
    lines.push("");
  }

  return lines;
}

export function summarizeGraphContextNoiseHuman(summary: GraphContextNoiseSummary): string[] {
  const label = summary.score >= 80 ? "low" : summary.score >= 60 ? "moderate" : "high";
  const lines = [`Context noise: ${summary.score}/100 (${label})`];
  for (const item of summary.noiseItems.slice(0, 4)) {
    const location = item.path ? `${item.path}: ` : "";
    lines.push(`Noise: ${location}${item.detail}`);
  }
  for (const recommendation of summary.recommendations.slice(0, 3)) {
    lines.push(`Noise fix: ${recommendation}`);
  }
  return lines;
}