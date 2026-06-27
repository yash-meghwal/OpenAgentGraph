import type { UnifiedCodeGraph, UnifiedCodeGraphNode } from "./codeGraph.js";
import {
  getStartGuidanceReadFirstNodes,
  scoreStartGuidanceNode,
  type StartGuidanceRankOptions,
} from "./graphStartGuidance.js";

export function scoreReadFirstNode(node: UnifiedCodeGraphNode, options: StartGuidanceRankOptions = {}) {
  return scoreStartGuidanceNode(node, options);
}

export function getReadTheseFirstNodes(
  graph: UnifiedCodeGraph,
  limit = 8,
  options: StartGuidanceRankOptions = {}
): UnifiedCodeGraphNode[] {
  return getStartGuidanceReadFirstNodes(graph, limit, options);
}