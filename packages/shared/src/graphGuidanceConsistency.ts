import type { UnifiedCodeGraph } from "./codeGraph.js";
import { buildGraphCommunityHubSummaries } from "./graphCommunityHubs.js";
import { buildGraphGodNodeSummaries } from "./graphLenses.js";
import { getReadTheseFirstNodes } from "./graphReadFirst.js";

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

export function evaluateGraphGuidanceConsistency(graph: UnifiedCodeGraph): GraphGuidanceConsistencyResult {
  const readFirst = getReadTheseFirstNodes(graph, 5);
  const hubs = buildGraphCommunityHubSummaries(graph, { mergeThinForPresentation: true });
  const godNodes = buildGraphGodNodeSummaries(graph, 5);

  const globalTopLabels = readFirst.map((node) => node.path ?? node.label);
  const godNodeTopLabels = godNodes.flatMap((godNode) => [
    ...godNode.topSymbols.slice(0, 2),
    ...godNode.topFiles.slice(0, 2),
  ]);
  const hubStartLabels = hubs.flatMap((hub) => hub.startWithNodes ?? hub.readFirstNodes ?? []).slice(0, 8);

  const disagreements: string[] = [];
  const globalPrimary = globalTopLabels[0];
  if (globalPrimary) {
    const normalizedGlobal = normalizeLabel(globalPrimary);
    const godAgrees = godNodeTopLabels.some((label) => normalizeLabel(label).includes(normalizedGlobal)
      || normalizedGlobal.includes(normalizeLabel(label)));
    if (godNodeTopLabels.length > 0 && !godAgrees) {
      disagreements.push(`God-node guidance does not include global read-first primary '${globalPrimary}'.`);
    }
    const hubAgrees = hubStartLabels.some((label) => normalizeLabel(label).includes(normalizedGlobal)
      || normalizedGlobal.includes(normalizeLabel(label)));
    if (hubStartLabels.length > 0 && !hubAgrees) {
      disagreements.push(`Community hub starts do not include global read-first primary '${globalPrimary}'.`);
    }
  }

  const testFirst = readFirst.findIndex((node) => /tests?[/\\]/i.test(node.path ?? node.label));
  const entryIndex = readFirst.findIndex((node) => /viewmodel|controller|main|service/i.test(node.label));
  if (testFirst >= 0 && entryIndex >= 0 && testFirst < entryIndex) {
    disagreements.push("General read-first ranks a test before an application entrypoint.");
  }

  return {
    ok: disagreements.length === 0,
    globalTopLabels,
    godNodeTopLabels,
    hubStartLabels,
    disagreements,
  };
}