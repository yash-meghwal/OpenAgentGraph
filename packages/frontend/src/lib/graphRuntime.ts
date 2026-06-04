export const LARGE_GRAPH_NODE_THRESHOLD = 180;

export type GraphDetailMode = "auto" | "full";

export interface GraphRuntimeInput {
  totalNodeCount: number;
  selectedNodeId: string | null;
  activeNodeId: string | null;
  graphQuality: "standard" | "performance";
  graphDetailMode: GraphDetailMode;
  showSupersededNodes: boolean;
  showRevisionBranches: boolean;
  showReplanBranches: boolean;
}

export interface DerivedGraphRuntime {
  largeGraphModeActive: boolean;
  effectiveGraphQuality: "standard" | "performance";
  effectiveShowSupersededNodes: boolean;
  effectiveShowRevisionBranches: boolean;
  effectiveShowReplanBranches: boolean;
  suppressHoverDetails: boolean;
  statusMessage: string | null;
}

export function deriveGraphRuntime(input: GraphRuntimeInput): DerivedGraphRuntime {
  const largeGraphModeActive =
    input.graphDetailMode === "auto" && input.totalNodeCount >= LARGE_GRAPH_NODE_THRESHOLD;

  if (!largeGraphModeActive) {
    return {
      largeGraphModeActive: false,
      effectiveGraphQuality: input.graphQuality,
      effectiveShowSupersededNodes: input.showSupersededNodes,
      effectiveShowRevisionBranches: input.showRevisionBranches,
      effectiveShowReplanBranches: input.showReplanBranches,
      suppressHoverDetails: false,
      statusMessage: null,
    };
  }

  return {
    largeGraphModeActive: true,
    effectiveGraphQuality: "performance",
    effectiveShowSupersededNodes: false,
    effectiveShowRevisionBranches: false,
    effectiveShowReplanBranches: false,
    suppressHoverDetails: true,
    statusMessage: "Large graph mode is active to keep this run responsive.",
  };
}
