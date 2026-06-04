import type {
  ProductEdgeKind,
  ProductGraphEdge,
  ProductGraphProjection,
  ProductGraphProjectionNode,
  ProductNodeKind,
} from "@openagentgraph/shared";

export type ProductGraphPreviewMode = "work-next";

export const PRODUCT_GRAPH_PREVIEW_MESSAGE = "Product graph preview is using seeded local data.";

const PRODUCT_GRAPH_PREVIEW_PARAM = "productGraphPreview";
const PREVIEW_TS = "2026-05-21T00:00:00.000Z";
const PRODUCT_GRAPH_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeProductGraphPreviewHost(hostname: string): string {
  const normalizedHostname = hostname.trim().toLowerCase();
  return normalizedHostname.startsWith("[") && normalizedHostname.endsWith("]")
    ? normalizedHostname.slice(1, -1)
    : normalizedHostname;
}

function previewNode(input: {
  id: string;
  kind: ProductNodeKind;
  title: string;
  summary?: string;
  status?: ProductGraphProjectionNode["status"];
  incomingEdgeIds?: string[];
  outgoingEdgeIds?: string[];
  blockedByNodeIds?: string[];
  tags?: string[];
}): ProductGraphProjectionNode {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    status: input.status ?? "planned",
    tags: input.tags,
    createdAt: PREVIEW_TS,
    updatedAt: PREVIEW_TS,
    incomingEdgeIds: input.incomingEdgeIds ?? [],
    outgoingEdgeIds: input.outgoingEdgeIds ?? [],
    blockedByNodeIds: input.blockedByNodeIds ?? [],
  };
}

function previewEdge(input: {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: ProductEdgeKind;
  label?: string;
}): ProductGraphEdge {
  return {
    id: input.id,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    kind: input.kind,
    label: input.label,
    trust: "manual",
    createdAt: PREVIEW_TS,
    updatedAt: PREVIEW_TS,
  };
}

function makeWorkNextPreviewProjection(): ProductGraphProjection {
  const nodes: ProductGraphProjectionNode[] = [
    previewNode({
      id: "feature:checkout-visibility",
      kind: "feature",
      title: "Checkout visibility",
      summary: "Show operators the implementation-ready checkout work and remaining blockers.",
      outgoingEdgeIds: ["edge-story-feature", "edge-criterion-feature"],
      tags: ["preview", "checkout"],
    }),
    previewNode({
      id: "story:operator-sees-checkout-status",
      kind: "user_story",
      title: "Operator sees checkout status",
      incomingEdgeIds: ["edge-story-feature"],
      outgoingEdgeIds: ["edge-task-story"],
      tags: ["preview"],
    }),
    previewNode({
      id: "criterion:checkout-status-reviewable",
      kind: "acceptance_criterion",
      title: "Checkout status is reviewable before implementation starts",
      incomingEdgeIds: ["edge-criterion-feature"],
      tags: ["preview"],
    }),
    previewNode({
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
      summary: "Ready task surfaced by the Work next quick action.",
      incomingEdgeIds: ["edge-task-story"],
      tags: ["preview", "ready"],
    }),
    previewNode({
      id: "task:payment-copy-owner",
      kind: "task",
      title: "Confirm payment copy owner",
      summary: "Blocked task kept in the preview so blocker health remains visible.",
      outgoingEdgeIds: ["edge-task-question"],
      blockedByNodeIds: ["question:payment-owner"],
      tags: ["preview", "blocked"],
    }),
    previewNode({
      id: "question:payment-owner",
      kind: "open_question",
      title: "Who owns payment copy?",
      status: "proposed",
      incomingEdgeIds: ["edge-task-question"],
      tags: ["preview"],
    }),
  ];
  const edges: ProductGraphEdge[] = [
    previewEdge({
      id: "edge-story-feature",
      sourceNodeId: "story:operator-sees-checkout-status",
      targetNodeId: "feature:checkout-visibility",
      kind: "belongs_to",
    }),
    previewEdge({
      id: "edge-criterion-feature",
      sourceNodeId: "criterion:checkout-status-reviewable",
      targetNodeId: "feature:checkout-visibility",
      kind: "satisfies",
    }),
    previewEdge({
      id: "edge-task-story",
      sourceNodeId: "task:checkout-status-panel",
      targetNodeId: "story:operator-sees-checkout-status",
      kind: "implements",
    }),
    previewEdge({
      id: "edge-task-question",
      sourceNodeId: "task:payment-copy-owner",
      targetNodeId: "question:payment-owner",
      kind: "blocked_by",
    }),
  ];

  return {
    schemaVersion: "1",
    productGraphId: "preview:work-next",
    nodes,
    edges,
    events: [],
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesByKind: {
        feature: 1,
        user_story: 1,
        acceptance_criterion: 1,
        task: 2,
        open_question: 1,
      },
      edgesByKind: {
        belongs_to: 1,
        satisfies: 1,
        implements: 1,
        blocked_by: 1,
      },
      unresolvedOpenQuestionCount: 1,
      blockedTaskCount: 1,
    },
  };
}

export function canUseProductGraphPreview(hostname?: string): boolean {
  const host = hostname ?? (typeof window !== "undefined" ? window.location.hostname : "");
  return PRODUCT_GRAPH_PREVIEW_HOSTS.has(normalizeProductGraphPreviewHost(host));
}

export function getProductGraphPreviewMode(search?: string, hostname?: string): ProductGraphPreviewMode | null {
  if (!canUseProductGraphPreview(hostname)) return null;
  const searchText = search ?? (typeof window !== "undefined" ? window.location.search : "");
  const previewMode = new URLSearchParams(searchText).get(PRODUCT_GRAPH_PREVIEW_PARAM);
  return previewMode === "work-next" ? previewMode : null;
}

export function getProductGraphPreviewProjection(search?: string, hostname?: string): ProductGraphProjection | null {
  const previewMode = getProductGraphPreviewMode(search, hostname);
  return previewMode === "work-next" ? makeWorkNextPreviewProjection() : null;
}
