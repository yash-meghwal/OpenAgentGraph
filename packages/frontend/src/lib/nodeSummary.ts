import type { Node } from "@openagentgraph/shared";
import { toPlainEnglishFailureSummary, toPlainEnglishSummary } from "@openagentgraph/shared";

const DEFAULT_FAILURE_TEXT =
  "This step didn't complete as expected. The system is deciding what to do next.";

export function getNodeDisplaySummary(node: Node): string {
  if (node.status === "failed" || node.evaluation?.passed === false) {
    return toPlainEnglishFailureSummary(
      node.evaluation?.humanSummary?.trim() ||
        node.evidenceSummary?.trim() ||
        node.humanSummary?.trim(),
      DEFAULT_FAILURE_TEXT
    );
  }

  return toPlainEnglishSummary(
    node.semanticSummary?.trim() ||
      node.humanSummary?.trim() ||
      node.intent?.trim(),
    node.title
  );
}

export function getNodeStatusCopy(node: Node): string {
  switch (node.status) {
    case "running":
      return "Exploring";
    case "ready":
      return "Ready";
    case "completed":
      return node.evaluation?.direction === "drifting"
        ? "Drifting"
        : "On track";
    case "failed":
      return "Blocked";
    case "superseded":
      return "No longer active";
    case "blocked":
      return "Blocked";
    default:
      return "Waiting";
  }
}

export function getActiveNode(nodes: Node[]): Node | null {
  return nodes.find((node) => node.status === "running") ?? null;
}

export function getJustFinishedNode(nodes: Node[]): Node | null {
  return [...nodes]
    .filter((node) => node.status === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .at(0) ?? null;
}

export function getNextNode(nodes: Node[]): Node | null {
  return nodes.find((node) => node.status === "ready") ?? nodes.find((node) => node.status === "pending") ?? null;
}
