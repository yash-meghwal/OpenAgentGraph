import type { UnifiedCodeGraph } from "./codeGraph.js";
import { buildCommunityTopologyIndex, buildGraphCommunityHubSummaries } from "./graphCommunityHubs.js";
import { buildGraphGodNodeSummaries } from "./graphLenses.js";
import { getStartGuidanceReadFirstNodes } from "./graphStartGuidance.js";

export interface GraphGuidanceConsistencyResult {
  ok: boolean;
  globalTopLabels: string[];
  godNodeTopLabels: string[];
  hubStartLabels: string[];
  disagreements: string[];
}

function normalizeLabel(value: string) {
  return value.replace(/\\/g, "/").toLowerCase();
}

function guidanceLabelTokens(value: string) {
  const normalized = normalizeLabel(value);
  const withoutKind = normalized.replace(/\s+\([^)]+\)\s*$/, "").trim();
  const basename = withoutKind.split("/").pop() ?? withoutKind;
  const stem = basename.replace(/\.[a-z0-9]+$/i, "");
  return { normalized, withoutKind, basename, stem };
}

function labelsAgree(candidate: string, reference: string) {
  const left = guidanceLabelTokens(candidate);
  const right = guidanceLabelTokens(reference);
  return left.normalized.includes(right.normalized)
    || right.normalized.includes(left.normalized)
    || left.basename.includes(right.basename)
    || right.basename.includes(left.basename)
    || left.stem === right.stem
    || left.stem.includes(right.stem)
    || right.stem.includes(left.stem);
}

function anyLabelAgrees(target: string, labels: string[]) {
  return labels.some((label) => labelsAgree(target, label));
}

export function evaluateGraphGuidanceConsistency(graph: UnifiedCodeGraph): GraphGuidanceConsistencyResult {
  const readFirst = getStartGuidanceReadFirstNodes(graph, 5);
  const hubs = buildGraphCommunityHubSummaries(graph, { mergeThinForPresentation: true });
  const godNodes = buildGraphGodNodeSummaries(graph, 5);

  const globalTopLabels = readFirst.map((node) => node.path ?? node.label);
  const godNodeTopLabels = godNodes.flatMap((godNode) => [
    ...godNode.topSymbols.slice(0, 3),
    ...godNode.topFiles.slice(0, 3),
  ]);
  const hubStartLabels = hubs.flatMap((hub) => hub.startWithNodes ?? hub.readFirstNodes ?? []).slice(0, 12);

  const disagreements: string[] = [];
  const globalPrimary = globalTopLabels[0];
  if (globalPrimary) {
    if (godNodeTopLabels.length > 0 && !anyLabelAgrees(globalPrimary, godNodeTopLabels)) {
      disagreements.push(`God-node guidance does not include global read-first primary '${globalPrimary}'.`);
    }
    if (hubStartLabels.length > 0 && !anyLabelAgrees(globalPrimary, hubStartLabels)) {
      disagreements.push(`Community hub starts do not include global read-first primary '${globalPrimary}'.`);
    }
  }

  const topology = buildCommunityTopologyIndex(graph);
  for (const node of readFirst.slice(0, 3)) {
    if (node.kind === "community" || node.kind === "config_file") continue;
    if (!topology.memberCommunityByNodeId.get(node.id)) continue;
    const globalLabel = node.path ?? node.label;
    const representedInGod = anyLabelAgrees(globalLabel, godNodeTopLabels);
    const representedInHubs = anyLabelAgrees(globalLabel, hubStartLabels);
    if (godNodeTopLabels.length > 0 && hubStartLabels.length > 0 && !representedInGod && !representedInHubs) {
      disagreements.push(`Global top entry '${globalLabel}' is absent from god-node and hub start guidance.`);
    }
  }

  const testFirst = readFirst.findIndex((node) => /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)/i.test(node.path ?? node.label));
  const entryIndex = readFirst.findIndex((node) => /viewmodel|controller|main|service/i.test(node.label));
  if (testFirst >= 0 && entryIndex >= 0 && testFirst < entryIndex) {
    disagreements.push("General read-first ranks a test before an application entrypoint.");
  }
  if (readFirst[0] && /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)/i.test(readFirst[0].path ?? readFirst[0].label)) {
    disagreements.push("General read-first leads with a test node.");
  }

  const directoryLead = readFirst.find((node) => node.kind === "directory");
  const meaningfulFileExists = graph.nodes.some((node) =>
    node.kind === "code_file" || node.kind === "symbol"
  );
  if (directoryLead && meaningfulFileExists) {
    disagreements.push("General read-first includes a directory while meaningful files or symbols exist.");
  }

  return {
    ok: disagreements.length === 0,
    globalTopLabels,
    godNodeTopLabels,
    hubStartLabels,
    disagreements,
  };
}