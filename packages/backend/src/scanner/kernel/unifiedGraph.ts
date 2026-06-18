import type {
  GraphAnalyzerAvailability,
  ProductGraphEdge,
  ProductGraphNode,
  ProductGraphProjection,
  UnifiedCodeGraph,
  UnifiedCodeGraphEdge,
  UnifiedCodeGraphNode,
  WorkspaceKernelProfile,
} from "@openagentgraph/shared";
import { CODE_GRAPH_SCHEMA_VERSION } from "@openagentgraph/shared";

function stableId(prefix: string, raw: string) {
  return `${prefix}:${raw.replace(/[^A-Za-z0-9._:-]+/g, "-")}`;
}

function mapProductNodeKind(node: ProductGraphNode): UnifiedCodeGraphNode["kind"] {
  if (node.kind === "code_file") {
    const extension = node.title.split(".").pop()?.toLowerCase() ?? "";
    if (["md", "rst", "txt"].includes(extension)) return "doc_file";
    if (["json", "yaml", "yml", "toml", "csproj", "sln", "props", "targets"].includes(extension)) {
      return "config_file";
    }
    return "code_file";
  }
  if (node.kind === "code_symbol") return "symbol";
  if (node.kind === "code_community") return "community";
  return "directory";
}

function mapProductEdgeKind(kind: ProductGraphEdge["kind"]): UnifiedCodeGraphEdge["kind"] | undefined {
  switch (kind) {
    case "belongs_to":
      return "belongs_to";
    case "depends_on":
      return "depends_on";
    case "implements":
      return "implements";
    case "extends":
      return "inherits";
    case "uses":
      return "references";
    default:
      return undefined;
  }
}

export function buildUnifiedCodeGraph(input: {
  workspaceRoot: string;
  generatedAt: string;
  projection: ProductGraphProjection;
  kernelProfile: WorkspaceKernelProfile;
  diagnostics?: string[];
  analyzers?: GraphAnalyzerAvailability[];
}): UnifiedCodeGraph {
  const nodes: UnifiedCodeGraphNode[] = [
    {
      id: stableId("workspace", input.workspaceRoot),
      kind: "workspace",
      label: "workspace",
      path: ".",
      metadata: {
        primaryType: input.kernelProfile.primaryType,
        activeScanners: input.kernelProfile.activeScannerIds.join(", "),
      },
    },
  ];
  const edges: UnifiedCodeGraphEdge[] = [];

  for (const sourceRoot of input.kernelProfile.sourceRoots) {
    const projectNodeId = stableId("project", sourceRoot);
    nodes.push({
      id: projectNodeId,
      kind: sourceRoot === "." ? "project" : "package",
      label: sourceRoot === "." ? "workspace-root" : sourceRoot,
      path: sourceRoot,
      projectType: input.kernelProfile.primaryType,
      scannerId: input.kernelProfile.activeScannerIds[0],
    });
    edges.push({
      id: stableId("edge", `${projectNodeId}->workspace|declares`),
      sourceNodeId: stableId("workspace", input.workspaceRoot),
      targetNodeId: projectNodeId,
      kind: "declares",
      provenance: "extracted",
      scannerId: "kernel",
    });
  }

  for (const node of input.projection.nodes) {
    if (!["code_file", "code_symbol", "code_community"].includes(node.kind)) continue;
    const unifiedKind = mapProductNodeKind(node);
    const communityMetadata = unifiedKind === "community"
      ? {
        scannerCommunityPath: node.metadata?.scannerCommunityPath,
        scannerCommunityKind: node.metadata?.scannerCommunityKind,
        scannerCommunityLabel: node.metadata?.scannerCommunityLabel,
        scannerCommunitySummary: node.metadata?.scannerCommunitySummary,
        scannerCommunitySignal: node.metadata?.scannerCommunitySignal,
        scannerCommunityLens: node.metadata?.scannerCommunityLens,
        scannerCommunityFileCount: node.metadata?.scannerCommunityFileCount,
        scannerCommunityTopFiles: node.metadata?.scannerCommunityTopFiles,
        scannerCommunityNamespaces: node.metadata?.scannerCommunityNamespaces,
        scannerCommunityProjects: node.metadata?.scannerCommunityProjects,
      }
      : {};
    const unifiedNode: UnifiedCodeGraphNode = {
      id: stableId("node", node.id),
      kind: unifiedKind,
      label: typeof node.metadata?.scannerCommunityLabel === "string"
        ? String(node.metadata.scannerCommunityLabel)
        : node.title,
      path: node.kind === "code_community" && typeof node.metadata?.scannerCommunityPath === "string"
        ? String(node.metadata.scannerCommunityPath)
        : node.source?.path ?? node.title,
      scannerId: typeof node.metadata?.scannerLanguage === "string"
        ? String(node.metadata.scannerLanguage)
        : input.kernelProfile.activeScannerIds[0],
      metadata: {
        productNodeId: node.id,
        productNodeKind: node.kind,
        ...(typeof node.metadata?.scannerRelation === "string"
          ? { scannerRelation: node.metadata.scannerRelation }
          : {}),
        ...Object.fromEntries(
          Object.entries(communityMetadata).filter(([, value]) => value !== undefined && value !== null)
        ),
      },
    };
    nodes.push(unifiedNode);

    const parentProject = input.kernelProfile.sourceRoots.find((root) => {
      const nodePath = unifiedNode.path ?? "";
      return root === "." || nodePath === root || nodePath.startsWith(`${root}/`);
    }) ?? ".";
    edges.push({
      id: stableId("edge", `${unifiedNode.id}->${parentProject}|belongs_to`),
      sourceNodeId: unifiedNode.id,
      targetNodeId: stableId("project", parentProject),
      kind: "belongs_to",
      provenance: "extracted",
      scannerId: unifiedNode.scannerId,
    });
  }

  for (const edge of input.projection.edges) {
    const mappedKind = mapProductEdgeKind(edge.kind);
    if (!mappedKind) continue;
    const edgeMetadata: Record<string, string | number | boolean | null> = {};
    if (typeof edge.metadata?.scannerRelation === "string") {
      edgeMetadata.scannerRelation = edge.metadata.scannerRelation;
    }
    if (typeof edge.metadata?.scannerResolution === "string") {
      edgeMetadata.scannerResolution = edge.metadata.scannerResolution;
    }
    if (typeof edge.metadata?.scannerImportResolution === "string") {
      edgeMetadata.scannerImportResolution = edge.metadata.scannerImportResolution;
    }
    edges.push({
      id: stableId("edge", edge.id),
      sourceNodeId: stableId("node", edge.sourceNodeId),
      targetNodeId: stableId("node", edge.targetNodeId),
      kind: mappedKind,
      provenance: edge.trust === "manual" ? "manual" : edge.trust === "inferred" ? "inferred" : "extracted",
      label: edge.label,
      scannerId: typeof edge.metadata?.scannerLanguage === "string"
        ? String(edge.metadata.scannerLanguage)
        : undefined,
      ...(Object.keys(edgeMetadata).length > 0 ? { metadata: edgeMetadata } : {}),
    });
  }

  return {
    schemaVersion: CODE_GRAPH_SCHEMA_VERSION,
    workspaceRoot: input.workspaceRoot,
    generatedAt: input.generatedAt,
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
    activeScannerIds: input.kernelProfile.activeScannerIds,
    diagnostics: input.diagnostics ?? [],
    ...(input.analyzers?.length ? { analyzers: input.analyzers } : {}),
  };
}