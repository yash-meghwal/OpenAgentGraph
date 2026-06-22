import {
  buildGraphAgentContextPack,
  queryUnifiedCodeGraph,
  findGraphPath,
  explainGraphNode,
  evaluateOagFusionChecks,
  retrieveOagById,
  summarizeEcosystemSupportForAgents,
} from "@openagentgraph/shared";
import type { GraphPathMode, GraphTaskLensId } from "@openagentgraph/shared";
import { detectWorkspaceKernelProfile } from "../scanner/kernel/workspaceDetection.js";
import { runOfflineKernelGraphExport } from "../cli/offlineGraphExport.js";
import {
  loadWorkspaceUnifiedGraph,
  readHandoffFreshness,
  requireWorkspaceOption,
  tryLoadCachedWorkspaceGraph,
} from "../cli/graphWorkspace.js";

const MAX_RESPONSE_NODES = 24;
const MAX_RESPONSE_EDGES = 24;

function boundArray<T>(items: T[], max: number) {
  return items.slice(0, max);
}

export async function mcpOagExport(input: {
  workspace: string;
  offlineOnly?: boolean;
  redactRoot?: boolean;
  refresh?: boolean;
}) {
  const workspaceRoot = requireWorkspaceOption(input.workspace);
  if (input.refresh || !(await tryLoadCachedWorkspaceGraph(workspaceRoot))) {
    const result = await runOfflineKernelGraphExport(workspaceRoot, {
      redactRoot: input.redactRoot ?? true,
    });
    return {
      status: "oag_export_complete",
      workspaceRoot,
      artifactPaths: result.writtenPaths,
      summary: {
        nodeCount: result.graph.nodes.length,
        edgeCount: result.graph.edges.length,
        generatedAt: result.graph.generatedAt,
      },
      hint: input.refresh ? "Graph refreshed." : "Graph exported from scan.",
    };
  }

  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: false });
  return {
    status: "oag_export_cached",
    workspaceRoot,
    artifactPaths: [".oag/graph.json", ".oag/graph.html", ".oag/wiki/index.md", "GRAPH_REPORT.md"],
    summary: {
      nodeCount: loaded.graph.nodes.length,
      edgeCount: loaded.graph.edges.length,
      generatedAt: loaded.graph.generatedAt,
    },
    hint: "Using cached .oag/graph.json. Pass refresh=true to rescan.",
  };
}

export async function mcpOagQuery(input: {
  workspace: string;
  query: string;
  lens?: GraphTaskLensId;
  budget?: number;
  refresh?: boolean;
}) {
  const workspaceRoot = requireWorkspaceOption(input.workspace);
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: input.refresh ?? false });
  const result = queryUnifiedCodeGraph(loaded.graph, input.query, {
    budget: Math.min(input.budget ?? 20, MAX_RESPONSE_NODES),
    lens: input.lens,
  });
  const ecosystemSupport = summarizeEcosystemSupportForAgents({
    graph: loaded.graph,
    kernelProfile: loaded.kernelProfile,
  });

  return {
    status: "oag_query_complete",
    workspaceRoot,
    fromCache: loaded.fromCache,
    query: result.query,
    lens: input.lens ?? "all",
    truncated: result.truncated,
    ecosystemSupport,
    activeScannerIds: loaded.graph.activeScannerIds,
    seeds: boundArray(result.seeds, 8),
    nodes: boundArray(result.nodes, MAX_RESPONSE_NODES),
    edges: boundArray(result.edges, MAX_RESPONSE_EDGES),
    communities: boundArray(result.communities ?? [], 8),
    provenanceNote: "Edge provenance and support tiers are included; source bodies are never returned.",
  };
}

export async function mcpOagPath(input: {
  workspace: string;
  from: string;
  to: string;
  mode?: GraphPathMode;
  maxHops?: number;
  lens?: GraphTaskLensId;
  refresh?: boolean;
}) {
  const workspaceRoot = requireWorkspaceOption(input.workspace);
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: input.refresh ?? false });
  const result = findGraphPath(loaded.graph, input.from, input.to, {
    mode: input.mode ?? "balanced",
    maxHops: input.maxHops ?? 8,
    lens: input.lens,
  });

  return {
    status: result.found ? "oag_path_complete" : "oag_path_not_found",
    workspaceRoot,
    from: input.from,
    to: input.to,
    mode: input.mode ?? "balanced",
    found: result.found,
    nodes: boundArray(result.nodes, MAX_RESPONSE_NODES),
    edges: boundArray(result.edges, MAX_RESPONSE_EDGES),
    explanation: result.explanation,
    provenanceNote: "Path edges include provenance metadata only.",
  };
}

export async function mcpOagExplain(input: {
  workspace: string;
  target: string;
  refresh?: boolean;
}) {
  const workspaceRoot = requireWorkspaceOption(input.workspace);
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: input.refresh ?? false });
  const result = explainGraphNode(loaded.graph, input.target);

  return {
    status: result.resolved ? "oag_explain_complete" : "oag_explain_not_found",
    workspaceRoot,
    target: input.target,
    resolved: result.resolved,
    summary: result.summary,
    node: result.node,
    neighbors: boundArray(result.neighbors, MAX_RESPONSE_NODES),
    edges: boundArray(result.edges, MAX_RESPONSE_EDGES),
    community: result.community,
    ecosystemSupport: summarizeEcosystemSupportForAgents({
      graph: loaded.graph,
      kernelProfile: loaded.kernelProfile,
    }),
  };
}

export async function mcpOagCheck(input: {
  workspace: string;
  mode?: "hard" | "warn";
  refresh?: boolean;
}) {
  const workspaceRoot = requireWorkspaceOption(input.workspace);
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: input.refresh ?? false });
  const kernelProfile = loaded.kernelProfile ?? await detectWorkspaceKernelProfile(workspaceRoot);
  const handoffFreshness = await readHandoffFreshness(workspaceRoot, loaded.graph.generatedAt);
  const fusion = evaluateOagFusionChecks({
    graph: loaded.graph,
    kernelProfile,
    handoffFreshness,
  });
  const ecosystemSupport = summarizeEcosystemSupportForAgents({ graph: loaded.graph, kernelProfile });

  return {
    status: fusion.ok ? "oag_check_passed" : "oag_check_failed",
    workspaceRoot,
    mode: input.mode ?? "hard",
    ok: fusion.ok,
    hardFailCount: fusion.hardFailCount,
    warnCount: fusion.warnCount,
    checks: boundArray(fusion.checks, 24),
    handoffFreshness,
    ecosystemSupport,
    analyzers: loaded.graph.analyzers ?? [],
  };
}

export async function mcpOagContext(input: {
  workspace: string;
  goal?: string;
  lens?: GraphTaskLensId;
  budget?: number;
  refresh?: boolean;
  redactRoot?: boolean;
}) {
  const workspaceRoot = requireWorkspaceOption(input.workspace);
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: input.refresh ?? false });
  const kernelProfile = loaded.kernelProfile ?? await detectWorkspaceKernelProfile(workspaceRoot);
  const handoffFreshness = await readHandoffFreshness(workspaceRoot, loaded.graph.generatedAt);

  const pack = buildGraphAgentContextPack(loaded.graph, {
    goal: input.goal,
    lens: input.lens,
    budget: input.budget ?? 12_000,
    workspaceRoot,
    redactRoot: input.redactRoot ?? true,
    kernelProfile,
    handoffFreshness,
  });

  return {
    ...pack,
    fromCache: loaded.fromCache,
    provenanceNote: "Context pack is bounded and source-body-free.",
  };
}

export async function mcpOagRetrieve(input: {
  workspace: string;
  id: string;
  refresh?: boolean;
}) {
  const workspaceRoot = requireWorkspaceOption(input.workspace);
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: input.refresh ?? false });
  const result = retrieveOagById(loaded.graph, input.id, { workspaceRoot, neighborBudget: 12 });
  if (!result) {
    return {
      status: "oag_retrieve_not_found",
      workspaceRoot,
      id: input.id,
      hint: "Run oag_export if .oag/graph.json is missing.",
    };
  }
  return {
    status: "oag_retrieve_complete",
    workspaceRoot,
    retrieval: result,
  };
}