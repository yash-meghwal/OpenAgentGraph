import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  evaluateHarnessReadiness,
  HARNESS_ARCHITECTURE_DOC_PATHS,
  type HarnessWorkspaceMetadata,
} from "./graphHarnessReadiness.js";

export const GRAPH_SPEC_QUALITY_GOOD_THRESHOLD = 70;

const CONTRIBUTION_DOC_PATHS = [
  "CONTRIBUTING.md",
  "docs/CONTRIBUTING.md",
  "docs/contributing.md",
] as const;

const SETUP_DOC_PATH_PATTERNS = [
  /README\.md/i,
  /architecture\.md/i,
  /contributing\.md/i,
];

const OAG_ARTIFACT_PATH_PATTERNS = [
  /(?:^|\/)GRAPH_REPORT\.md$/i,
  /(?:^|\/)\.oag(?:\/|$)/i,
];

export interface GraphSpecConflict {
  kind: string;
  detail: string;
  sources: string[];
}

export interface GraphSpecQualitySummary {
  ok: boolean;
  score: number;
  present: string[];
  missing: string[];
  conflicts: GraphSpecConflict[];
  risks: string[];
  recommendations: string[];
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

function collectIndexedPaths(graph: UnifiedCodeGraph) {
  const paths = new Set<string>();
  for (const node of graph.nodes) {
    const candidate = node.path ?? node.label;
    if (!candidate) continue;
    if (!["code_file", "config_file", "doc_file", "test", "command"].includes(node.kind)) continue;
    paths.add(normalizePath(candidate));
  }
  return paths;
}

function hasPath(paths: Set<string>, target: string) {
  const normalized = normalizePath(target);
  return paths.has(normalized) || [...paths].some((path) => path.endsWith(`/${normalized}`) || path === normalized);
}

export function extractHarnessReadmeCommands(readmeText: string) {
  const commands: string[] = [];
  for (const match of readmeText.matchAll(/`([^`]+)`/g)) {
    commands.push(match[1].trim());
  }
  for (const match of readmeText.matchAll(/```(?:bash|sh|shell|console|text)?\s*\r?\n([\s\S]*?)```/gi)) {
    for (const line of match[1].split(/\r?\n/)) {
      const command = line.trim().replace(/^-\s+/, "");
      if (command) commands.push(command);
    }
  }
  return commands.filter((command) => /^(npm|pnpm|yarn|npx|cargo|go|dotnet|make)\b/.test(command));
}

function brokenDocLinksInSetupDocs(graph: UnifiedCodeGraph) {
  return graph.diagnostics.filter((line) => {
    if (!/Broken doc (?:link|anchor)/i.test(line)) return false;
    return SETUP_DOC_PATH_PATTERNS.some((pattern) => pattern.test(line));
  });
}

function detectUnsupportedReadmeCommands(metadata?: HarnessWorkspaceMetadata) {
  const readme = metadata?.readmeText ?? "";
  if (!readme) return [] as string[];

  const known = new Set<string>(["npm test", "npm ci", "npm install", "pnpm install", "yarn install"]);
  for (const scriptName of Object.keys(metadata?.packageScripts ?? {})) {
    known.add(`npm run ${scriptName}`);
  }

  const unsupported: string[] = [];
  for (const command of extractHarnessReadmeCommands(readme)) {
    const scriptMatch = command.match(/^npm run ([a-z0-9:_-]+)$/i);
    if (!scriptMatch) continue;
    if (!known.has(command.toLowerCase().replace(/\s+/g, " "))) {
      unsupported.push(command);
    }
  }
  return [...new Set(unsupported)];
}

function agentInstructionCorpus(metadata?: HarnessWorkspaceMetadata) {
  return [
    metadata?.readmeText ?? "",
    ...Object.values(metadata?.agentInstructionTexts ?? {}),
  ].join("\n");
}

function mentionsNoProviderKey(text: string) {
  return /no provider key|provider key.*not required|without.*provider key/i.test(text);
}

export function formatGraphSpecQualityMarkdown(summary: GraphSpecQualitySummary): string[] {
  const lines = [
    "## Agentic SDLC spec quality",
    "",
    `- Score: ${summary.score}/100 (min ${GRAPH_SPEC_QUALITY_GOOD_THRESHOLD})`,
    `- Status: ${summary.ok ? "PASS" : "NEEDS WORK"}`,
    "",
  ];

  if (summary.present.length > 0) {
    lines.push("### Present", "");
    for (const item of summary.present.slice(0, 12)) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (summary.missing.length > 0) {
    lines.push("### Missing", "");
    for (const item of summary.missing.slice(0, 10)) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (summary.conflicts.length > 0) {
    lines.push("### Conflicts", "");
    for (const conflict of summary.conflicts.slice(0, 6)) {
      lines.push(`- ${conflict.detail}`);
      for (const source of conflict.sources.slice(0, 4)) {
        lines.push(`  - ${source}`);
      }
    }
    lines.push("");
  }

  if (summary.risks.length > 0) {
    lines.push("### Risks", "");
    for (const risk of summary.risks.slice(0, 8)) {
      lines.push(`- ${risk}`);
    }
    lines.push("");
  }

  if (summary.recommendations.length > 0) {
    lines.push("### Recommended additions", "");
    for (const recommendation of summary.recommendations.slice(0, 8)) {
      lines.push(`- ${recommendation}`);
    }
    lines.push("");
  }

  return lines;
}

export function evaluateGraphSpecQuality(
  graph: UnifiedCodeGraph,
  options: {
    metadata?: HarnessWorkspaceMetadata;
    goodThreshold?: number;
  } = {}
): GraphSpecQualitySummary {
  const harness = evaluateHarnessReadiness(graph, options);
  const paths = collectIndexedPaths(graph);
  const metadata = options.metadata;
  const present = [...new Set(harness.present)];
  const missing = [...new Set(harness.missing)];
  const conflicts: GraphSpecConflict[] = harness.conflicts.map((conflict) => ({
    kind: conflict.kind,
    detail: conflict.detail,
    sources: [...conflict.sources],
  }));
  const risks: string[] = [];
  const recommendations = [...harness.recommendations];
  let score = harness.score;

  const contributionDoc = CONTRIBUTION_DOC_PATHS.find((docPath) => hasPath(paths, docPath));
  if (contributionDoc) {
    present.push(contributionDoc);
    score += 5;
  } else {
    missing.push("contribution_docs");
    recommendations.push("Add CONTRIBUTING.md or docs/contributing.md for agent-safe change guidance.");
  }

  if (hasPath(paths, "GRAPH_REPORT.md")) {
    risks.push("Tracked GRAPH_REPORT.md can go stale; refresh with graph:export after meaningful changes.");
    score = Math.max(0, score - 5);
  }

  const brokenSetupDocLinks = brokenDocLinksInSetupDocs(graph);
  if (brokenSetupDocLinks.length > 0) {
    risks.push(`${brokenSetupDocLinks.length} broken doc link(s) affect setup or architecture docs.`);
    score = Math.max(0, score - Math.min(12, brokenSetupDocLinks.length * 4));
    recommendations.push("Repair broken links in README.md and architecture docs before agent onboarding.");
  }

  const unsupportedCommands = detectUnsupportedReadmeCommands(metadata);
  if (unsupportedCommands.length > 0) {
    risks.push(`README documents unsupported script commands: ${unsupportedCommands.join(", ")}.`);
    score = Math.max(0, score - unsupportedCommands.length * 3);
    recommendations.push("Align README command examples with package.json scripts or CI workflows.");
  }

  const oagArtifactsPresent = [...paths].some((path) =>
    OAG_ARTIFACT_PATH_PATTERNS.some((pattern) => pattern.test(path))
  );
  const instructionCorpus = agentInstructionCorpus(metadata);
  if (oagArtifactsPresent && !mentionsNoProviderKey(instructionCorpus)) {
    missing.push("no_provider_key_explanation");
    risks.push("OAG-oriented docs exist but agent instructions do not explain the no-provider-key guarantee.");
    recommendations.push("Document that OAG scans, exports, and graph:check do not require provider keys.");
    score = Math.max(0, score - 4);
  } else if (mentionsNoProviderKey(instructionCorpus)) {
    present.push("no_provider_key_explanation");
  }

  const architectureDoc = HARNESS_ARCHITECTURE_DOC_PATHS.find((docPath) => hasPath(paths, docPath));
  if (!architectureDoc && brokenSetupDocLinks.some((line) => /architecture/i.test(line))) {
    risks.push("Broken architecture doc links remain even though architecture guidance is expected.");
  }

  score = Math.min(100, score);
  const threshold = options.goodThreshold ?? GRAPH_SPEC_QUALITY_GOOD_THRESHOLD;

  return {
    ok: score >= threshold && conflicts.length === 0,
    score,
    present,
    missing,
    conflicts,
    risks,
    recommendations: [...new Set(recommendations)].slice(0, 10),
  };
}