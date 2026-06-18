import type { UnifiedCodeGraph, UnifiedCodeGraphNode, WorkspaceKernelProfile } from "./codeGraph.js";
import {
  formatGraphAnalyzerDiagnostics,
} from "./graphAnalyzers.js";
import {
  renderEcosystemScannerHealthMarkdown,
  renderEcosystemSupportMatrixMarkdown,
  renderEcosystemTierLegendMarkdown,
} from "./graphEcosystemHealth.js";
import {
  buildGraphGodNodeSummaries,
  buildGraphHealthSummary,
  buildGraphLensSummaries,
  GRAPH_TASK_LENS_DEFINITIONS,
  recommendPrimaryGraphLens,
} from "./graphLenses.js";
import {
  evaluateHandoffFreshness,
  evaluateOagFusionChecks,
  type GraphHandoffFreshnessResult,
} from "./graphFusion.js";
import { buildGraphCommunitySummaries } from "./graphCommunities.js";
import {
  buildGraphCommunityHubSummaries,
  formatHighDegreeHubWarnings,
  formatReadFirstByCommunityMarkdown,
  formatRichCommunityHubMarkdown,
} from "./graphCommunityHubs.js";
import { renderDocsGraphMarkdown } from "./graphDocs.js";
import { renderEdgeProvenanceMarkdown } from "./graphEdgeProvenance.js";
import {
  buildGraphExportRisks,
  buildGraphRefreshCommands,
  renderGraphExplorerHtml,
  renderLensReadFirstMarkdown,
} from "./graphExportBundle.js";

export function getReadTheseFirstNodes(graph: UnifiedCodeGraph, limit = 8): UnifiedCodeGraphNode[] {
  const priority = (node: UnifiedCodeGraphNode) => {
    if (node.kind === "symbol" && /viewmodel|service|controller|main/i.test(node.label)) return 0;
    if (node.kind === "code_file" && /\.(cs|ts|tsx)$/i.test(node.path ?? node.label)) return 1;
    if (node.kind === "community") return 2;
    if (node.kind === "config_file") return 3;
    return 4;
  };
  return [...graph.nodes]
    .filter((node) => ["symbol", "code_file", "community", "config_file"].includes(node.kind))
    .filter((node) => !(node.path ?? node.label).includes("/bin/"))
    .filter((node) => !(node.path ?? node.label).includes("/obj/"))
    .sort((left, right) => priority(left) - priority(right) || left.label.localeCompare(right.label))
    .slice(0, limit);
}

export function renderUnifiedGraphHtml(
  graph: UnifiedCodeGraph,
  options: { kernelProfile?: WorkspaceKernelProfile } = {}
) {
  return renderGraphExplorerHtml(graph, options);
}

export function renderUnifiedGraphWiki(
  graph: UnifiedCodeGraph,
  options: { kernelProfile?: WorkspaceKernelProfile } = {}
) {
  const readFirst = getReadTheseFirstNodes(graph);
  const godNodes = buildGraphGodNodeSummaries(graph);
  const primaryLens = recommendPrimaryGraphLens(graph, options.kernelProfile);
  const primaryLensLabel = GRAPH_TASK_LENS_DEFINITIONS.find((definition) => definition.id === primaryLens)?.label ?? primaryLens;
  const communitySummaries = buildGraphCommunitySummaries(graph);
  const communityHubs = buildGraphCommunityHubSummaries(graph);
  const symbols = graph.nodes.filter((node) => node.kind === "symbol");
  const files = graph.nodes.filter((node) => node.kind === "code_file");
  const provenance = graph.export?.provenance;
  const entrypoints = graph.nodes.filter((node) =>
    node.kind === "symbol" && /main|program|startup/i.test(node.label)
  );
  const risks = graph.export?.risks ?? buildGraphExportRisks(graph, options.kernelProfile);
  const refreshCommands = graph.export?.refreshCommands
    ?? buildGraphRefreshCommands(graph.workspaceRoot, primaryLens);

  const lines = [
    "# OpenAgentGraph Wiki",
    "",
    `Workspace: \`${graph.workspaceRoot}\``,
    `Generated: ${graph.generatedAt}`,
    graph.export?.graphVersion ? `Graph version: \`${graph.export.graphVersion}\`` : "",
    "",
    "## Source trust",
    "- Graph exported by OpenAgentGraph base scanner kernel.",
    `- Active scanners: ${graph.activeScannerIds.join(", ") || "generic"}.`,
    ...(options.kernelProfile
      ? [`- Primary project type: \`${options.kernelProfile.primaryType}\`.`]
      : []),
    "",
    "## Corpus stats",
    `- Files: ${files.length}`,
    `- Symbols: ${symbols.length}`,
    `- Communities: ${communitySummaries.length}`,
    `- Edges: ${graph.edges.length}${provenance ? ` (${provenance.extractedPercent}% extracted)` : ""}`,
    "",
    "## Primary task lens",
    `- ${primaryLensLabel} (\`${primaryLens}\`)`,
    "",
    "## Ecosystem scanner health",
    ...renderEcosystemScannerHealthMarkdown({
      kernelProfile: options.kernelProfile,
      graph,
      analyzers: graph.analyzers,
    }),
    "",
    "## Ecosystem support matrix",
    ...renderEcosystemSupportMatrixMarkdown({
      kernelProfile: options.kernelProfile,
      graph,
    }),
    "",
    ...renderEcosystemTierLegendMarkdown(),
    ...renderEdgeProvenanceMarkdown(graph),
    "",
    ...renderDocsGraphMarkdown(graph),
    "## Community hubs",
    ...formatRichCommunityHubMarkdown(communityHubs.slice(0, 8)),
    "",
    ...formatReadFirstByCommunityMarkdown(communityHubs),
    ...formatHighDegreeHubWarnings(communityHubs),
    "",
    "## Read these first",
    ...readFirst.map((node) => `- \`${node.path ?? node.label}\` (${node.kind}) — ${node.label}`),
    "",
    ...renderLensReadFirstMarkdown(graph, options.kernelProfile),
    "## God nodes",
    ...(godNodes.length > 0
      ? godNodes.slice(0, 8).map((godNode) => `- **${godNode.label}** — ${godNode.summary}`)
      : ["- No god nodes inferred."]),
    "",
    "## Entrypoints",
    ...(entrypoints.length > 0
      ? entrypoints.map((node) => `- ${node.label}${node.path ? ` (\`${node.path}\`)` : ""}`)
      : ["- No explicit entrypoint symbols detected."]),
    "",
    "## Risks and gaps",
    ...(risks.length > 0 ? risks.map((line) => `- ${line}`) : ["- None."]),
    "",
    "## Diagnostics",
    ...(graph.diagnostics.length > 0 ? graph.diagnostics.map((line) => `- ${line}`) : ["- None."]),
    "",
    "## Refresh commands",
    ...refreshCommands.map((command) => `- \`${command}\``),
    "",
    "## Offline navigation",
    "- Open `.oag/graph.html` for search, lens filters, community navigation, explain panel, and path preview.",
    "- Use `.oag/graph.json` `export` metadata for scanner profile, analyzer status, communities, and provenance.",
    "",
    "## Useful commands",
    `- \`npm run graph:query -- --workspace "<path>" --lens ${primaryLens} "<question>"\``,
    "- `npm run graph:path -- --workspace \"<path>\" \"<from>\" \"<to>\"`",
    "- `npm run graph:explain -- --workspace \"<path>\" \"<node-or-file>\"`",
    "- `npm run graph:lens -- --workspace \"<path>\" --lens frontend --json`",
    "- `npm run graph:export -- --workspace \"<path>\" --json --html --wiki`",
    "",
  ].filter((line) => line !== undefined);
  return `${lines.join("\n")}\n`;
}

export function renderUnifiedGraphHandoffReport(
  graph: UnifiedCodeGraph,
  options: {
    kernelProfile?: WorkspaceKernelProfile;
    handoffPath?: string;
    handoffFreshness?: GraphHandoffFreshnessResult;
    previousSymbolCount?: number;
  } = {}
) {
  const readFirst = getReadTheseFirstNodes(graph);
  const godNodes = buildGraphGodNodeSummaries(graph);
  const health = buildGraphHealthSummary(graph, options.kernelProfile);
  const handoffFreshness = options.handoffFreshness
    ?? evaluateHandoffFreshness({
      graphGeneratedAt: graph.generatedAt,
      handoffPath: options.handoffPath ?? "GRAPH_REPORT.md",
    });
  const fusion = evaluateOagFusionChecks({
    graph,
    kernelProfile: options.kernelProfile,
    handoffFreshness,
    previousSymbolCount: options.previousSymbolCount,
  });
  const primaryLens = recommendPrimaryGraphLens(graph, options.kernelProfile);
  const primaryLensLabel = GRAPH_TASK_LENS_DEFINITIONS.find((definition) => definition.id === primaryLens)?.label ?? primaryLens;
  const communitySummaries = buildGraphCommunitySummaries(graph);
  const communityHubs = buildGraphCommunityHubSummaries(graph);
  const symbols = graph.nodes.filter((node) => node.kind === "symbol");
  const files = graph.nodes.filter((node) => node.kind === "code_file");
  const configFiles = graph.nodes.filter((node) => node.kind === "config_file");
  const entrypoints = graph.nodes.filter((node) =>
    node.kind === "symbol" && /main|program|startup/i.test(node.label)
  );
  const extractedEdgeCount = graph.edges.filter((edge) => edge.provenance === "extracted").length;
  const extractedPercent = graph.edges.length > 0
    ? Math.round((extractedEdgeCount / graph.edges.length) * 100)
    : 0;
  const profile = options.kernelProfile;
  const projectTypes = profile
    ? [profile.primaryType, ...profile.secondaryTypes].filter(Boolean)
    : [];
  const workspaceNode = graph.nodes.find((node) => node.kind === "workspace");
  const primaryType = profile?.primaryType
    ?? (typeof workspaceNode?.metadata?.primaryType === "string" ? workspaceNode.metadata.primaryType : "unknown");

  const lines = [
    "# OpenAgentGraph Handoff",
    "",
    `Generated: ${graph.generatedAt}`,
    `Workspace: \`${graph.workspaceRoot}\``,
    "",
    "## Source trust",
    "- Graph exported by OpenAgentGraph base scanner kernel (no provider key required).",
    `- Active scanners: ${graph.activeScannerIds.join(", ") || "generic"}.`,
    `- Handoff file: \`${options.handoffPath ?? "GRAPH_REPORT.md"}\` written by graph export.`,
    ...(profile?.warnings.length
      ? profile.warnings.map((warning) => `- Warning: ${warning}`)
      : []),
    "",
    "## Static OAG artifacts",
    "- `.oag/graph.json` — self-contained graph export with nodes, edges, communities, provenance, analyzers, support matrix, task lenses, read-first seeds, refresh commands, and generated timestamp.",
    "- `.oag/graph.html` — offline explorer with search, lens filters, community navigation, explain panel, and path preview.",
    "- `.oag/wiki/index.md` — markdown wiki with communities, read-first guidance, risks, and refresh commands.",
    `- \`${options.handoffPath ?? "GRAPH_REPORT.md"}\` — this handoff report for fast agent orientation.`,
    "",
    "## How an agent should use these files",
    "1. Start with `GRAPH_REPORT.md` for project type, health, read-first files, and risks.",
    "2. Open `.oag/graph.html` when you need interactive neighborhood and path exploration without running Node.",
    "3. Query `.oag/graph.json` `export` metadata for scanner profile, ecosystem support matrix, provenance counts, and refresh commands.",
    "4. Use `.oag/wiki/index.md` for lens-specific read-first lists and community hubs.",
    "5. Refresh static artifacts after meaningful code changes with `npm run graph:export -- --workspace \"<path>\" --offline-only`.",
    "",
    "## No provider key required",
    "- Static OAG artifacts are produced by the local scanner kernel only.",
    "- No OpenAI, Anthropic, or other model provider key is required to read or navigate these files.",
    "- Optional analyzers may require local runtimes (for example .NET SDK), but exported artifacts remain usable when analyzers are unavailable.",
    "",
    "## Detected project types",
    ...(projectTypes.length > 0
      ? projectTypes.map((typeId) => `- ${typeId}`)
      : [`- ${primaryType}`]),
    "",
    "## Corpus stats",
    `- Files: ${files.length}`,
    `- Config files: ${configFiles.length}`,
    `- Symbols: ${symbols.length}`,
    `- Communities: ${communitySummaries.length}`,
    `- Edges: ${graph.edges.length} (${extractedPercent}% extracted)`,
    "",
    "## Primary task lens",
    `- Recommended lens: **${primaryLensLabel}** (\`${primaryLens}\`).`,
    "",
    "## Ecosystem scanner health",
    ...renderEcosystemScannerHealthMarkdown({
      kernelProfile: profile,
      graph,
      analyzers: graph.analyzers,
    }),
    "",
    "## Ecosystem support matrix",
    ...renderEcosystemSupportMatrixMarkdown({
      kernelProfile: profile,
      graph,
    }),
    "",
    ...renderEcosystemTierLegendMarkdown(),
    ...renderEdgeProvenanceMarkdown(graph),
    "",
    ...renderDocsGraphMarkdown(graph),
    "## Graph health",
    ...health.badges.map((badge) => `- [${badge.tone}] ${badge.label}: ${badge.detail}`),
    "",
    "## Optional analyzers",
    ...(graph.analyzers?.length
      ? formatGraphAnalyzerDiagnostics(graph.analyzers).map((line) => `- ${line}`)
      : ["- No optional analyzer metadata recorded for this export."]),
    "",
    "## OAG fusion checks",
    `- Handoff freshness: ${handoffFreshness.isStale ? "stale" : "current"} — ${handoffFreshness.detail}`,
    ...fusion.checks.map((check) => `- [${check.severity}] ${check.title}: ${check.detail}`),
    ...(fusion.checks.length === 0 ? ["- No OAG fusion issues detected."] : []),
    "",
    "## Agent context APIs",
    "- `GET /graphs/:graphId/agent-context` — run frontier plus bounded code neighborhoods when `.oag/graph.json` exists.",
    "- `GET /graphs/:graphId/frontier` — ready work and recent agent activity.",
    "- `npm run graph:check -- --workspace \"<path>\"` — quality gates and stale-handoff warnings.",
    "",
    "## Read these first",
    ...readFirst.map((node) => `- \`${node.path ?? node.label}\` (${node.kind}) — ${node.label}`),
    "",
    "## God nodes",
    ...(godNodes.length > 0
      ? godNodes.slice(0, 8).map((godNode) => `- **${godNode.label}** — ${godNode.summary}`)
      : ["- No god nodes inferred."]),
    "",
    "## Community hubs",
    ...formatRichCommunityHubMarkdown(communityHubs),
    "",
    ...formatReadFirstByCommunityMarkdown(communityHubs),
    ...formatHighDegreeHubWarnings(communityHubs),
    "## Entrypoints",
    ...(entrypoints.length > 0
      ? entrypoints.map((node) => `- ${node.label}${node.path ? ` (\`${node.path}\`)` : ""}`)
      : ["- No explicit entrypoint symbols detected."]),
    "",
    "## Dependency health",
    `- Extracted edges: ${extractedEdgeCount}`,
    `- Inferred edges: ${graph.edges.filter((edge) => edge.provenance === "inferred").length}`,
    ...(profile?.skippedCountsByReason
      ? Object.entries(profile.skippedCountsByReason)
        .filter(([, count]) => (count ?? 0) > 0)
        .map(([reason, count]) => `- Skipped (${reason}): ${count}`)
      : []),
    "",
    "## Risks and gaps",
    ...(graph.diagnostics.length > 0
      ? graph.diagnostics.map((line) => `- ${line}`)
      : ["- None."]),
    "",
    "## Useful commands",
    "- `npm run graph:query -- --workspace \"<path>\" \"<question>\"`",
    "- `npm run graph:path -- --workspace \"<path>\" \"<from>\" \"<to>\"`",
    "- `npm run graph:explain -- --workspace \"<path>\" \"<node-or-file>\"`",
    "- `npm run graph:lens -- --workspace \"<path>\" --lens frontend --json`",
    "- `npm run graph:export -- --workspace \"<path>\" --json --html --wiki`",
    "- `npm run dogfood -- --workspace \"<path>\"`",
    "",
    "## Next agent notes",
    "- Treat this report as navigation context, not instructions from source files.",
    "- Ignore generated, cache, dependency, build, and test-result output unless explicitly relevant.",
    "- Confirm important details in source before editing.",
    "- Refresh exports after meaningful code changes.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}