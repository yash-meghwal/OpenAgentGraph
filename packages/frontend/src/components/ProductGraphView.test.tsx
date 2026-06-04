import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import type {
  DashboardRunSummary,
  ProductGraphCodexPlanningPrompt,
  ProductGraphProjection,
  ProductGraphTrace,
} from "@openagentgraph/shared";
import {
  buildProductGraphTaskScopeNodeIds,
  buildProductGraphTrace,
  findProductGraphAcceptanceCriterionEvidenceForNode,
  findProductGraphAcceptanceEvidenceGaps,
  summarizeProductGraphCodeIntentDrift,
  summarizeProductGraphCodeScanFreshness,
  summarizeProductGraphExecutionDrift,
  summarizeProductGraphExecutionTestEvidence,
  summarizeProductGraphAcceptanceEvidenceHealth,
  summarizeProductGraphFeatureAcceptanceEvidence,
  summarizeProductGraphReadyTaskCandidates,
  summarizeProductGraphTaskExecutionEvidence,
} from "@openagentgraph/shared";
import {
  PRODUCT_GRAPH_LAYOUT_CSS,
  ProductGraphContent,
  TRUST_TONES,
  CODE_MAP_EXPLORER_RENDER_NODE_LIMIT,
  PRODUCT_GRAPH_NODE_CARD_RENDER_LIMIT,
  buildCodeMapArchitectureHealth,
  buildCodeMapCommunityGroups,
  buildCodeMapCommunitySummaries,
  buildCodeMapDependencyHotspots,
  buildCodeMapExplorerView,
  buildCodeMapImpactPathPreview,
  buildCodeMapImpactSummary,
  buildCodeMapQuickFilterNodeIds,
  canManageProductGraph,
  codeMapEdgeEndpointLabel,
  codeMapFilterAllowsEdge,
  codeMapFilterAllowsNode,
  codeMapFiltersForFocusedNode,
  codeMapQuickFilterAllowsNode,
  codeMapTaskScopeAllowsEdge,
  codeMapTaskScopeAllowsNode,
  detectCodeMapDependencyCycles,
  findCodeMapOrphanFiles,
  findLinkedRunFilesForTask,
  findLikelyCodeAreasForTask,
  findRunsDerivedFromPlan,
  formatCodebaseScanFeedback,
  formatCodebaseScanResult,
  isDependencyCodeEdge,
  isSemanticCodeEdge,
  formatSpecKitImportResult,
  getCodexExecutionReadinessNotice,
  hashCodexPlanPrompt,
  isProductGraphCodexPlanRefreshWarning,
  isProductGraphEdgeRefreshWarning,
  isProductGraphCodebaseScanRefreshWarning,
  isProductGraphIntentBundleRefreshWarning,
  isProductGraphNodeRefreshWarning,
  isProductGraphRunLinkRefreshWarning,
  isProductGraphSpecKitImportRefreshWarning,
  productGraphFocusStateForNode,
  productKindFilterForNode,
  selectProductGraphNode,
  shouldAutoLoadProductGraph,
  traceRelationshipLabelsForNode,
} from "./ProductGraphView.js";
import { PRODUCT_GRAPH_PREVIEW_MESSAGE } from "../lib/productGraphPreview.js";
import { GRAPH_THEMES } from "../lib/graphTheme.js";

function makeProductGraph(): ProductGraphProjection {
  return {
    schemaVersion: "1",
    productGraphId: "default",
    nodes: [
      {
        id: "feature:checkout-visibility",
        kind: "feature",
        title: "Checkout visibility",
        summary: "Show where checkout work stands before implementation.",
        status: "planned",
        tags: ["checkout"],
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
        incomingEdgeIds: ["edge-story-feature"],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      },
      {
        id: "story:operator-sees-checkout",
        kind: "user_story",
        title: "Operator sees checkout status",
        status: "planned",
        tags: ["operator"],
        createdAt: "2026-05-12T00:01:00.000Z",
        updatedAt: "2026-05-12T00:01:00.000Z",
        incomingEdgeIds: [],
        outgoingEdgeIds: ["edge-story-feature"],
        blockedByNodeIds: [],
      },
      {
        id: "task:checkout-status-panel",
        kind: "task",
        title: "Wire checkout status panel",
        status: "planned",
        createdAt: "2026-05-12T00:01:30.000Z",
        updatedAt: "2026-05-12T00:01:30.000Z",
        incomingEdgeIds: [],
        outgoingEdgeIds: ["edge-task-question"],
        blockedByNodeIds: ["question:payment-owner"],
      },
      {
        id: "question:payment-owner",
        kind: "open_question",
        title: "Who owns payment copy?",
        status: "proposed",
        createdAt: "2026-05-12T00:02:00.000Z",
        updatedAt: "2026-05-12T00:02:00.000Z",
        incomingEdgeIds: ["edge-task-question"],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      },
    ],
    edges: [
      {
        id: "edge-story-feature",
        sourceNodeId: "story:operator-sees-checkout",
        targetNodeId: "feature:checkout-visibility",
        kind: "belongs_to",
        trust: "manual",
        createdAt: "2026-05-12T00:03:00.000Z",
        updatedAt: "2026-05-12T00:03:00.000Z",
      },
      {
        id: "edge-task-question",
        sourceNodeId: "task:checkout-status-panel",
        targetNodeId: "question:payment-owner",
        kind: "blocked_by",
        trust: "manual",
        createdAt: "2026-05-12T00:03:30.000Z",
        updatedAt: "2026-05-12T00:03:30.000Z",
      },
    ],
    events: [],
    summary: {
      nodeCount: 4,
      edgeCount: 2,
      nodesByKind: {
        feature: 1,
        user_story: 1,
        open_question: 1,
        task: 1,
      },
      edgesByKind: {
        belongs_to: 1,
        blocked_by: 1,
      },
      unresolvedOpenQuestionCount: 1,
      blockedTaskCount: 1,
    },
  };
}

function makeUnblockedProductGraph(): ProductGraphProjection {
  const productGraph = makeProductGraph();
  const edges = productGraph.edges.filter((edge) => edge.id !== "edge-task-question");

  return {
    ...productGraph,
    nodes: productGraph.nodes.map((node) => {
      if (node.id === "task:checkout-status-panel") {
        return { ...node, outgoingEdgeIds: [], blockedByNodeIds: [] };
      }
      if (node.id === "question:payment-owner") {
        return { ...node, incomingEdgeIds: [] };
      }
      return node;
    }),
    edges,
    summary: {
      ...productGraph.summary,
      edgeCount: edges.length,
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        blocked_by: 0,
      },
      blockedTaskCount: 0,
    },
  };
}

function makeOverflowReadyTaskProductGraph(): ProductGraphProjection {
  const productGraph = makeUnblockedProductGraph();
  const extraTasks: ProductGraphProjection["nodes"] = Array.from({ length: 5 }, (_, index) => ({
    id: `task:ready-follow-up-${index + 1}`,
    kind: "task",
    title: `Ready follow-up task ${index + 1}`,
    status: "planned",
    createdAt: `2026-05-12T00:2${index}:00.000Z`,
    updatedAt: `2026-05-12T00:2${index}:00.000Z`,
    incomingEdgeIds: [],
    outgoingEdgeIds: [],
    blockedByNodeIds: [],
  }));

  return {
    ...productGraph,
    nodes: [...productGraph.nodes, ...extraTasks],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + extraTasks.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        task: (productGraph.summary.nodesByKind.task ?? 0) + extraTasks.length,
      },
    },
  };
}

function makeOverflowBlockedTaskProductGraph(): ProductGraphProjection {
  const productGraph = makeProductGraph();
  const extraTasks: ProductGraphProjection["nodes"] = Array.from({ length: 5 }, (_, index) => ({
    id: `task:blocked-follow-up-${index + 1}`,
    kind: "task",
    title: `Blocked follow-up task ${index + 1}`,
    status: "planned",
    createdAt: `2026-05-12T00:1${index}:00.000Z`,
    updatedAt: `2026-05-12T00:1${index}:00.000Z`,
    incomingEdgeIds: [],
    outgoingEdgeIds: [],
    blockedByNodeIds: ["question:payment-owner"],
  }));

  return {
    ...productGraph,
    nodes: [...productGraph.nodes, ...extraTasks],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + extraTasks.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        task: (productGraph.summary.nodesByKind.task ?? 0) + extraTasks.length,
      },
      blockedTaskCount: productGraph.summary.blockedTaskCount + extraTasks.length,
    },
  };
}

function makeAcceptanceEvidenceProductGraph(): ProductGraphProjection {
  const productGraph = makeProductGraph();
  const criteria: ProductGraphProjection["nodes"] = [
    {
      id: "criterion:checkout-status-proof",
      kind: "acceptance_criterion",
      title: "Checkout status has proof",
      status: "planned",
      createdAt: "2026-05-12T00:04:00.000Z",
      updatedAt: "2026-05-12T00:04:00.000Z",
      incomingEdgeIds: ["edge-test-criterion"],
      outgoingEdgeIds: ["edge-criterion-feature"],
      blockedByNodeIds: [],
    },
    {
      id: "criterion:copy-approved",
      kind: "acceptance_criterion",
      title: "Payment copy is approved",
      status: "planned",
      createdAt: "2026-05-12T00:04:30.000Z",
      updatedAt: "2026-05-12T00:04:30.000Z",
      incomingEdgeIds: ["edge-run-criterion-copy"],
      outgoingEdgeIds: ["edge-criterion-copy-feature"],
      blockedByNodeIds: [],
    },
    {
      id: "criterion:tax-copy-approved",
      kind: "acceptance_criterion",
      title: "Tax copy has owner approval",
      status: "planned",
      createdAt: "2026-05-12T00:04:45.000Z",
      updatedAt: "2026-05-12T00:04:45.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: ["edge-criterion-tax-feature"],
      blockedByNodeIds: [],
    },
  ];
  const testResult: ProductGraphProjection["nodes"][number] = {
    id: "test:checkout-status-proof",
    kind: "test_result",
    title: "CheckoutStatus test passed",
    status: "completed",
    createdAt: "2026-05-12T00:05:00.000Z",
    updatedAt: "2026-05-12T00:05:00.000Z",
    incomingEdgeIds: ["edge-evidence-test"],
    outgoingEdgeIds: ["edge-test-criterion"],
    blockedByNodeIds: [],
  };
  const evidence: ProductGraphProjection["nodes"][number] = {
    id: "evidence:checkout-status-proof",
    kind: "evidence",
    title: "Checkout status proof evidence",
    status: "completed",
    createdAt: "2026-05-12T00:05:30.000Z",
    updatedAt: "2026-05-12T00:05:30.000Z",
    incomingEdgeIds: [],
    outgoingEdgeIds: ["edge-evidence-test"],
    blockedByNodeIds: [],
  };
  const acceptanceEdges: ProductGraphProjection["edges"] = [
    {
      id: "edge-criterion-feature",
      sourceNodeId: "criterion:checkout-status-proof",
      targetNodeId: "feature:checkout-visibility",
      kind: "satisfies",
      label: "Criterion satisfies feature",
      trust: "manual",
      createdAt: "2026-05-12T00:06:00.000Z",
      updatedAt: "2026-05-12T00:06:00.000Z",
    },
    {
      id: "edge-criterion-copy-feature",
      sourceNodeId: "criterion:copy-approved",
      targetNodeId: "feature:checkout-visibility",
      kind: "satisfies",
      label: "Criterion satisfies feature",
      trust: "manual",
      createdAt: "2026-05-12T00:06:30.000Z",
      updatedAt: "2026-05-12T00:06:30.000Z",
    },
    {
      id: "edge-criterion-tax-feature",
      sourceNodeId: "criterion:tax-copy-approved",
      targetNodeId: "feature:checkout-visibility",
      kind: "satisfies",
      label: "Criterion satisfies feature",
      trust: "manual",
      createdAt: "2026-05-12T00:06:45.000Z",
      updatedAt: "2026-05-12T00:06:45.000Z",
    },
    {
      id: "edge-task-feature",
      sourceNodeId: "task:checkout-status-panel",
      targetNodeId: "feature:checkout-visibility",
      kind: "implements",
      label: "Task implements feature",
      trust: "manual",
      createdAt: "2026-05-12T00:07:00.000Z",
      updatedAt: "2026-05-12T00:07:00.000Z",
    },
    {
      id: "edge-test-criterion",
      sourceNodeId: "test:checkout-status-proof",
      targetNodeId: "criterion:checkout-status-proof",
      kind: "verifies",
      label: "Test verifies criterion",
      trust: "manual",
      createdAt: "2026-05-12T00:07:30.000Z",
      updatedAt: "2026-05-12T00:07:30.000Z",
    },
    {
      id: "edge-evidence-test",
      sourceNodeId: "evidence:checkout-status-proof",
      targetNodeId: "test:checkout-status-proof",
      kind: "produced_by",
      label: "Evidence produced by test",
      trust: "manual",
      createdAt: "2026-05-12T00:08:00.000Z",
      updatedAt: "2026-05-12T00:08:00.000Z",
    },
    {
      id: "edge-run-criterion-copy",
      sourceNodeId: "run:copy-review",
      targetNodeId: "criterion:copy-approved",
      kind: "verifies",
      label: "Run verifies criterion",
      trust: "manual",
      createdAt: "2026-05-12T00:08:30.000Z",
      updatedAt: "2026-05-12T00:08:30.000Z",
    },
  ];
  const runVerifier: ProductGraphProjection["nodes"][number] = {
    id: "run:copy-review",
    kind: "agent_run",
    title: "Copy review run",
    status: "completed",
    createdAt: "2026-05-12T00:08:15.000Z",
    updatedAt: "2026-05-12T00:08:30.000Z",
    incomingEdgeIds: [],
    outgoingEdgeIds: ["edge-run-criterion-copy"],
    blockedByNodeIds: [],
  };
  const intentNodes = productGraph.nodes.map((node) => {
    if (node.id === "feature:checkout-visibility") {
      return {
        ...node,
        incomingEdgeIds: [
          ...node.incomingEdgeIds,
          "edge-criterion-feature",
          "edge-criterion-copy-feature",
          "edge-criterion-tax-feature",
          "edge-task-feature",
        ],
      };
    }
    if (node.id === "task:checkout-status-panel") {
      return {
        ...node,
        outgoingEdgeIds: [...node.outgoingEdgeIds, "edge-task-feature"],
      };
    }
    return node;
  });

  return {
    ...productGraph,
    nodes: [...intentNodes, ...criteria, testResult, evidence, runVerifier],
    edges: [...productGraph.edges, ...acceptanceEdges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + 6,
      edgeCount: productGraph.summary.edgeCount + acceptanceEdges.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        acceptance_criterion: 3,
        agent_run: 1,
        test_result: 1,
        evidence: 1,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        satisfies: 3,
        implements: 1,
        verifies: 2,
        produced_by: 1,
      },
    },
  };
}

function makeAllVerifiedAcceptanceEvidenceProductGraph(): ProductGraphProjection {
  const productGraph = makeAcceptanceEvidenceProductGraph();
  const taxEvidence: ProductGraphProjection["nodes"][number] = {
    id: "evidence:tax-copy-approval",
    kind: "evidence",
    title: "Tax copy approval evidence",
    status: "completed",
    createdAt: "2026-05-12T00:09:00.000Z",
    updatedAt: "2026-05-12T00:09:00.000Z",
    incomingEdgeIds: [],
    outgoingEdgeIds: ["edge-tax-evidence-criterion"],
    blockedByNodeIds: [],
  };
  const taxEvidenceEdge: ProductGraphProjection["edges"][number] = {
    id: "edge-tax-evidence-criterion",
    sourceNodeId: "evidence:tax-copy-approval",
    targetNodeId: "criterion:tax-copy-approved",
    kind: "verifies",
    label: "Evidence verifies criterion",
    trust: "manual",
    createdAt: "2026-05-12T00:09:30.000Z",
    updatedAt: "2026-05-12T00:09:30.000Z",
  };

  return {
    ...productGraph,
    nodes: [
      ...productGraph.nodes.map((node) =>
        node.id === "criterion:tax-copy-approved"
          ? { ...node, incomingEdgeIds: [...node.incomingEdgeIds, taxEvidenceEdge.id] }
          : node
      ),
      taxEvidence,
    ],
    edges: [...productGraph.edges, taxEvidenceEdge],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + 1,
      edgeCount: productGraph.summary.edgeCount + 1,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        evidence: (productGraph.summary.nodesByKind.evidence ?? 0) + 1,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        verifies: (productGraph.summary.edgesByKind.verifies ?? 0) + 1,
      },
    },
  };
}

function makeOverflowAcceptanceEvidenceProductGraph(): ProductGraphProjection {
  const productGraph = makeAcceptanceEvidenceProductGraph();
  const extraCriteria: ProductGraphProjection["nodes"] = Array.from({ length: 5 }, (_, offset) => {
    const criterionNumber = offset + 1;
    return {
      id: `criterion:extra-gap-${criterionNumber}`,
      kind: "acceptance_criterion",
      title: `Additional evidence gap ${criterionNumber}`,
      status: "planned",
      createdAt: "2026-05-12T00:09:00.000Z",
      updatedAt: "2026-05-12T00:09:00.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [`edge-extra-gap-feature-${criterionNumber}`],
      blockedByNodeIds: [],
    };
  });
  const extraEdges: ProductGraphProjection["edges"] = extraCriteria.map((criterion, offset) => {
    const criterionNumber = offset + 1;
    return {
      id: `edge-extra-gap-feature-${criterionNumber}`,
      sourceNodeId: criterion.id,
      targetNodeId: "feature:checkout-visibility",
      kind: "satisfies",
      label: "Criterion satisfies feature",
      trust: "manual",
      createdAt: "2026-05-12T00:09:30.000Z",
      updatedAt: "2026-05-12T00:09:30.000Z",
    };
  });

  return {
    ...productGraph,
    nodes: [
      ...productGraph.nodes.map((node) =>
        node.id === "feature:checkout-visibility"
          ? { ...node, incomingEdgeIds: [...node.incomingEdgeIds, ...extraEdges.map((edge) => edge.id)] }
          : node
      ),
      ...extraCriteria,
    ],
    edges: [...productGraph.edges, ...extraEdges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + extraCriteria.length,
      edgeCount: productGraph.summary.edgeCount + extraEdges.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        acceptance_criterion: (productGraph.summary.nodesByKind.acceptance_criterion ?? 0) + extraCriteria.length,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        satisfies: (productGraph.summary.edgesByKind.satisfies ?? 0) + extraEdges.length,
      },
    },
  };
}

function makeCodeMapProductGraph(): ProductGraphProjection {
  const productGraph = makeProductGraph();
  const codeNodes: ProductGraphProjection["nodes"] = [
    {
      id: "symbol:checkout-controller",
      kind: "code_symbol",
      title: "CheckoutController",
      body: "SOURCE BODY SHOULD NOT RENDER",
      status: "planned",
      tags: ["code-scan", "checkout"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "src/checkout.ts",
        line: 42,
      },
      metadata: {
        scannerSourceFile: "src/checkout.ts",
        scannerSymbolName: "CheckoutController",
        scannerSymbolKind: "class",
        scannerSymbolLine: 42,
        methodCount: 1,
        methodNames: "render",
        methodDetails: "public render@44",
      },
      createdAt: "2026-05-12T00:04:00.000Z",
      updatedAt: "2026-05-12T00:04:00.000Z",
      incomingEdgeIds: ["edge-task-symbol"],
      outgoingEdgeIds: ["edge-symbol-file", "edge-symbol-uses-helper"],
      blockedByNodeIds: [],
    },
    {
      id: "symbol:format-checkout",
      kind: "code_symbol",
      title: "formatCheckout",
      status: "planned",
      tags: ["code-scan", "checkout"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "src/format.ts",
        line: 8,
      },
      metadata: {
        scannerSourceFile: "src/format.ts",
        scannerSymbolName: "formatCheckout",
        scannerSymbolKind: "function",
        scannerSymbolLine: 8,
      },
      createdAt: "2026-05-12T00:04:10.000Z",
      updatedAt: "2026-05-12T00:04:10.000Z",
      incomingEdgeIds: ["edge-symbol-uses-helper"],
      outgoingEdgeIds: ["edge-helper-file"],
      blockedByNodeIds: [],
    },
    {
      id: "file:src-checkout",
      kind: "code_file",
      title: "src/checkout.ts",
      body: "SOURCE BODY SHOULD NOT RENDER",
      summary: "Scanned code file.",
      status: "planned",
      tags: ["code-scan"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "src/checkout.ts",
      },
      metadata: {
        scannerSourceFile: "src/checkout.ts",
        scannerImportCount: 2,
        scannerResolvedDependencyCount: 1,
        scannerExternalDependencyCount: 1,
        scannerUnresolvedDependencyCount: 0,
        scannerDependencyTargets: "src/format.ts",
        scannerExternalDependencies: "react",
      },
      createdAt: "2026-05-12T00:04:30.000Z",
      updatedAt: "2026-05-12T00:04:30.000Z",
      incomingEdgeIds: ["edge-symbol-file"],
      outgoingEdgeIds: ["edge-file-format", "edge-file-community"],
      blockedByNodeIds: [],
    },
    {
      id: "file:src-format",
      kind: "code_file",
      title: "src/format.ts",
      status: "planned",
      tags: ["code-scan"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "src/format.ts",
      },
      metadata: {
        scannerSourceFile: "src/format.ts",
      },
      createdAt: "2026-05-12T00:04:40.000Z",
      updatedAt: "2026-05-12T00:04:40.000Z",
      incomingEdgeIds: ["edge-helper-file", "edge-file-format"],
      outgoingEdgeIds: ["edge-format-community"],
      blockedByNodeIds: [],
    },
    {
      id: "community:src",
      kind: "code_community",
      title: "src",
      status: "planned",
      tags: ["code-scan", "code-community"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "src",
      },
      metadata: {
        scannerCommunityPath: "src",
        scannerCommunityKind: "directory",
        scannerCommunityFileCount: 2,
        scannerCommunityFiles: "src/checkout.ts, src/format.ts",
      },
      createdAt: "2026-05-12T00:04:50.000Z",
      updatedAt: "2026-05-12T00:04:50.000Z",
      incomingEdgeIds: ["edge-file-community", "edge-format-community"],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
  ];
  const codeEdges: ProductGraphProjection["edges"] = [
    {
      id: "edge-symbol-file",
      sourceNodeId: "symbol:checkout-controller",
      targetNodeId: "file:src-checkout",
      kind: "belongs_to",
      label: "Symbol belongs to file",
      trust: "extracted",
      createdAt: "2026-05-12T00:05:30.000Z",
      updatedAt: "2026-05-12T00:05:30.000Z",
    },
    {
      id: "edge-helper-file",
      sourceNodeId: "symbol:format-checkout",
      targetNodeId: "file:src-format",
      kind: "belongs_to",
      label: "Symbol belongs to file",
      trust: "extracted",
      createdAt: "2026-05-12T00:05:40.000Z",
      updatedAt: "2026-05-12T00:05:40.000Z",
    },
    {
      id: "edge-file-community",
      sourceNodeId: "file:src-checkout",
      targetNodeId: "community:src",
      kind: "belongs_to",
      label: "File belongs to module",
      trust: "extracted",
      metadata: {
        scannerRelation: "module_membership",
      },
      createdAt: "2026-05-12T00:05:50.000Z",
      updatedAt: "2026-05-12T00:05:50.000Z",
    },
    {
      id: "edge-format-community",
      sourceNodeId: "file:src-format",
      targetNodeId: "community:src",
      kind: "belongs_to",
      label: "File belongs to module",
      trust: "extracted",
      metadata: {
        scannerRelation: "module_membership",
      },
      createdAt: "2026-05-12T00:05:55.000Z",
      updatedAt: "2026-05-12T00:05:55.000Z",
    },
    {
      id: "edge-file-format",
      sourceNodeId: "file:src-checkout",
      targetNodeId: "file:src-format",
      kind: "depends_on",
      label: "File imports file",
      trust: "extracted",
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "src/checkout.ts",
        line: 3,
      },
      metadata: {
        scannerRelation: "module_dependency",
        scannerResolution: "semantic",
        scannerSourceFile: "src/checkout.ts",
        scannerTargetFile: "src/format.ts",
        scannerDependencyLine: 3,
        scannerDependencySpecifiers: "./format",
        scannerDependencyCount: 1,
        scannerDependencyKinds: "import",
      },
      createdAt: "2026-05-12T00:06:00.000Z",
      updatedAt: "2026-05-12T00:06:00.000Z",
    },
    {
      id: "edge-symbol-uses-helper",
      sourceNodeId: "symbol:checkout-controller",
      targetNodeId: "symbol:format-checkout",
      kind: "uses",
      label: "Symbol uses symbol",
      trust: "extracted",
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "src/checkout.ts",
        line: 46,
      },
      metadata: {
        scannerRelation: "symbol_uses",
        scannerResolution: "semantic",
        scannerSourceFile: "src/checkout.ts",
        scannerTargetFile: "src/format.ts",
        scannerSourceSymbol: "CheckoutController",
        scannerTargetSymbol: "formatCheckout",
      },
      createdAt: "2026-05-12T00:06:10.000Z",
      updatedAt: "2026-05-12T00:06:10.000Z",
    },
    {
      id: "edge-task-symbol",
      sourceNodeId: "task:checkout-status-panel",
      targetNodeId: "symbol:checkout-controller",
      kind: "touches",
      label: "Likely code area",
      trust: "ambiguous",
      createdAt: "2026-05-12T00:06:30.000Z",
      updatedAt: "2026-05-12T00:06:30.000Z",
    },
  ];
  const intentNodes = productGraph.nodes.map((node) =>
    node.id === "task:checkout-status-panel"
      ? { ...node, outgoingEdgeIds: [...node.outgoingEdgeIds, "edge-task-symbol"] }
      : node
  );

  return {
    ...productGraph,
    nodes: [...codeNodes, ...intentNodes],
    edges: [...codeEdges, ...productGraph.edges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + codeNodes.length,
      edgeCount: productGraph.summary.edgeCount + codeEdges.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        code_file: 2,
        code_symbol: 2,
        code_community: 1,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        belongs_to: (productGraph.summary.edgesByKind.belongs_to ?? 0) + 4,
        depends_on: 1,
        uses: 1,
        touches: 1,
      },
    },
  };
}

function makeTaskScopeCodeMapProductGraph(kind: "mixed" | "backend-only" = "mixed"): ProductGraphProjection {
  const frontendFile: ProductGraphProjection["nodes"][number] = {
    id: "file:frontend-app",
    kind: "code_file",
    title: "packages/frontend/src/App.tsx",
    status: "planned",
    tags: ["code-scan"],
    source: { kind: "code_scan", label: "Codebase scan", path: "packages/frontend/src/App.tsx" },
    metadata: { scannerSourceFile: "packages/frontend/src/App.tsx" },
    createdAt: "2026-05-12T00:08:00.000Z",
    updatedAt: "2026-05-12T00:08:00.000Z",
    incomingEdgeIds: [],
    outgoingEdgeIds: ["edge-frontend-runtime", "edge-frontend-community"],
    blockedByNodeIds: [],
  };
  const backendFile: ProductGraphProjection["nodes"][number] = {
    id: "file:backend-runtime",
    kind: "code_file",
    title: "packages/backend/src/runtime.ts",
    status: "planned",
    tags: ["code-scan"],
    source: { kind: "code_scan", label: "Codebase scan", path: "packages/backend/src/runtime.ts" },
    metadata: { scannerSourceFile: "packages/backend/src/runtime.ts" },
    createdAt: "2026-05-12T00:08:10.000Z",
    updatedAt: "2026-05-12T00:08:10.000Z",
    incomingEdgeIds: ["edge-frontend-runtime"],
    outgoingEdgeIds: ["edge-backend-community"],
    blockedByNodeIds: [],
  };
  const frontendCommunity: ProductGraphProjection["nodes"][number] = {
    id: "community:frontend",
    kind: "code_community",
    title: "packages/frontend",
    status: "planned",
    tags: ["code-scan", "code-community"],
    source: { kind: "code_scan", label: "Codebase scan", path: "packages/frontend" },
    metadata: {
      scannerCommunityPath: "packages/frontend",
      scannerCommunityFileCount: 1,
      scannerCommunityFiles: "packages/frontend/src/App.tsx",
    },
    createdAt: "2026-05-12T00:08:20.000Z",
    updatedAt: "2026-05-12T00:08:20.000Z",
    incomingEdgeIds: ["edge-frontend-community"],
    outgoingEdgeIds: [],
    blockedByNodeIds: [],
  };
  const backendCommunity: ProductGraphProjection["nodes"][number] = {
    id: "community:backend",
    kind: "code_community",
    title: "packages/backend",
    status: "planned",
    tags: ["code-scan", "code-community"],
    source: { kind: "code_scan", label: "Codebase scan", path: "packages/backend" },
    metadata: {
      scannerCommunityPath: "packages/backend",
      scannerCommunityFileCount: 1,
      scannerCommunityFiles: "packages/backend/src/runtime.ts",
    },
    createdAt: "2026-05-12T00:08:30.000Z",
    updatedAt: "2026-05-12T00:08:30.000Z",
    incomingEdgeIds: ["edge-backend-community"],
    outgoingEdgeIds: [],
    blockedByNodeIds: [],
  };
  const allNodes = kind === "backend-only"
    ? [backendFile, backendCommunity]
    : [frontendFile, backendFile, frontendCommunity, backendCommunity];
  const allEdges: ProductGraphProjection["edges"] = [
    ...(kind === "backend-only"
      ? []
      : [{
          id: "edge-frontend-runtime",
          sourceNodeId: frontendFile.id,
          targetNodeId: backendFile.id,
          kind: "depends_on" as const,
          label: "File imports runtime",
          trust: "extracted" as const,
          metadata: {
            scannerRelation: "module_dependency",
            scannerResolution: "semantic",
            scannerSourceFile: "packages/frontend/src/App.tsx",
            scannerTargetFile: "packages/backend/src/runtime.ts",
          },
          createdAt: "2026-05-12T00:08:40.000Z",
          updatedAt: "2026-05-12T00:08:40.000Z",
        }]),
    ...(kind === "backend-only"
      ? []
      : [{
          id: "edge-frontend-community",
          sourceNodeId: frontendFile.id,
          targetNodeId: frontendCommunity.id,
          kind: "belongs_to" as const,
          trust: "extracted" as const,
          createdAt: "2026-05-12T00:08:50.000Z",
          updatedAt: "2026-05-12T00:08:50.000Z",
        }]),
    {
      id: "edge-backend-community",
      sourceNodeId: backendFile.id,
      targetNodeId: backendCommunity.id,
      kind: "belongs_to",
      trust: "extracted",
      createdAt: "2026-05-12T00:09:00.000Z",
      updatedAt: "2026-05-12T00:09:00.000Z",
    },
  ];

  return {
    schemaVersion: "1",
    productGraphId: "default",
    nodes: allNodes,
    edges: allEdges,
    events: [],
    summary: {
      nodeCount: allNodes.length,
      edgeCount: allEdges.length,
      nodesByKind: {
        code_file: kind === "backend-only" ? 1 : 2,
        code_community: kind === "backend-only" ? 1 : 2,
      },
      edgesByKind: {
        belongs_to: kind === "backend-only" ? 1 : 2,
        ...(kind === "backend-only" ? {} : { depends_on: 1 }),
      },
      unresolvedOpenQuestionCount: 0,
      blockedTaskCount: 0,
    },
  };
}

function makeClusteredCodeMapProductGraph(): ProductGraphProjection {
  const productGraph = makeCodeMapProductGraph();
  const extraNodes: ProductGraphProjection["nodes"] = [
    {
      id: "file:packages-app",
      kind: "code_file",
      title: "packages/app.ts",
      status: "planned",
      tags: ["code-scan"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/app.ts",
      },
      metadata: {
        scannerSourceFile: "packages/app.ts",
        scannerImportCount: 4,
        scannerExternalDependencyCount: 2,
        scannerUnresolvedDependencyCount: 1,
      },
      createdAt: "2026-05-12T00:07:00.000Z",
      updatedAt: "2026-05-12T00:07:00.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
    {
      id: "file:packages-utils",
      kind: "code_file",
      title: "packages/utils.ts",
      status: "planned",
      tags: ["code-scan"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/utils.ts",
      },
      metadata: {
        scannerSourceFile: "packages/utils.ts",
        scannerImportCount: 2,
      },
      createdAt: "2026-05-12T00:07:10.000Z",
      updatedAt: "2026-05-12T00:07:10.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
    {
      id: "file:packages-format",
      kind: "code_file",
      title: "packages/format.ts",
      status: "planned",
      tags: ["code-scan"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/format.ts",
      },
      metadata: {
        scannerSourceFile: "packages/format.ts",
      },
      createdAt: "2026-05-12T00:07:20.000Z",
      updatedAt: "2026-05-12T00:07:20.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
    {
      id: "symbol:packages-app",
      kind: "code_symbol",
      title: "createApp",
      status: "planned",
      tags: ["code-scan"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/app.ts",
        line: 12,
      },
      metadata: {
        scannerSourceFile: "packages/app.ts",
        scannerSymbolName: "createApp",
        scannerSymbolKind: "function",
      },
      createdAt: "2026-05-12T00:07:30.000Z",
      updatedAt: "2026-05-12T00:07:30.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
    {
      id: "symbol:packages-utils",
      kind: "code_symbol",
      title: "normalizeApp",
      status: "planned",
      tags: ["code-scan"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/utils.ts",
        line: 5,
      },
      metadata: {
        scannerSourceFile: "packages/utils.ts",
        scannerSymbolName: "normalizeApp",
        scannerSymbolKind: "function",
      },
      createdAt: "2026-05-12T00:07:40.000Z",
      updatedAt: "2026-05-12T00:07:40.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
    {
      id: "community:packages",
      kind: "code_community",
      title: "packages",
      status: "planned",
      tags: ["code-scan", "code-community"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages",
      },
      metadata: {
        scannerCommunityPath: "packages",
        scannerCommunityKind: "directory",
        scannerCommunityFileCount: 3,
        scannerCommunityFiles: "packages/app.ts, packages/utils.ts, packages/format.ts",
      },
      createdAt: "2026-05-12T00:07:50.000Z",
      updatedAt: "2026-05-12T00:07:50.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
  ];
  const extraEdges: ProductGraphProjection["edges"] = [
    ["file:packages-app", "community:packages"],
    ["file:packages-utils", "community:packages"],
    ["file:packages-format", "community:packages"],
  ].map(([sourceNodeId, targetNodeId], index) => ({
    id: `edge-packages-community-${index + 1}`,
    sourceNodeId,
    targetNodeId,
    kind: "belongs_to",
    label: "File belongs to module",
    trust: "extracted",
    metadata: {
      scannerRelation: "module_membership",
    },
    createdAt: "2026-05-12T00:08:00.000Z",
    updatedAt: "2026-05-12T00:08:00.000Z",
  }));
  const packageDependencyEdges: ProductGraphProjection["edges"] = [
    ["edge-packages-app-utils", "file:packages-app", "file:packages-utils"],
    ["edge-packages-app-format", "file:packages-app", "file:packages-format"],
    ["edge-packages-utils-format", "file:packages-utils", "file:packages-format"],
    ["edge-packages-checkout-app", "file:src-checkout", "file:packages-app"],
    ["edge-packages-format-app", "file:packages-format", "file:packages-app"],
    ["edge-packages-format-checkout", "file:packages-format", "file:src-checkout"],
  ].map(([id, sourceNodeId, targetNodeId], index) => ({
    id,
    sourceNodeId,
    targetNodeId,
    kind: "depends_on",
    label: "File imports file",
    trust: "extracted",
    source: {
      kind: "code_scan",
      label: "Codebase scan",
      path: `${sourceNodeId.replace("file:", "")}.ts`,
      line: index + 1,
    },
    metadata: {
      scannerRelation: "module_dependency",
      scannerResolution: "semantic",
      scannerSourceFile: sourceNodeId.replace("file:", ""),
      scannerTargetFile: targetNodeId.replace("file:", ""),
      scannerDependencyCount: 1,
      scannerDependencyKinds: "import",
    },
    createdAt: "2026-05-12T00:08:30.000Z",
    updatedAt: "2026-05-12T00:08:30.000Z",
  }));

  extraEdges.push(
    {
      id: "edge-packages-symbol-app-file",
      sourceNodeId: "symbol:packages-app",
      targetNodeId: "file:packages-app",
      kind: "belongs_to",
      label: "Symbol belongs to file",
      trust: "extracted",
      createdAt: "2026-05-12T00:08:10.000Z",
      updatedAt: "2026-05-12T00:08:10.000Z",
    },
    {
      id: "edge-packages-symbol-utils-file",
      sourceNodeId: "symbol:packages-utils",
      targetNodeId: "file:packages-utils",
      kind: "belongs_to",
      label: "Symbol belongs to file",
      trust: "extracted",
      createdAt: "2026-05-12T00:08:20.000Z",
      updatedAt: "2026-05-12T00:08:20.000Z",
    },
    ...packageDependencyEdges,
    {
      id: "edge-packages-symbol-uses",
      sourceNodeId: "symbol:packages-app",
      targetNodeId: "symbol:packages-utils",
      kind: "uses",
      label: "Symbol uses symbol",
      trust: "extracted",
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/app.ts",
        line: 18,
      },
      metadata: {
        scannerRelation: "symbol_uses",
        scannerResolution: "semantic",
        scannerSourceSymbol: "createApp",
        scannerTargetSymbol: "normalizeApp",
      },
      createdAt: "2026-05-12T00:08:40.000Z",
      updatedAt: "2026-05-12T00:08:40.000Z",
    }
  );

  return {
    ...productGraph,
    nodes: [...extraNodes, ...productGraph.nodes],
    edges: [...extraEdges, ...productGraph.edges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + extraNodes.length,
      edgeCount: productGraph.summary.edgeCount + extraEdges.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        code_file: (productGraph.summary.nodesByKind.code_file ?? 0) + 3,
        code_symbol: (productGraph.summary.nodesByKind.code_symbol ?? 0) + 2,
        code_community: (productGraph.summary.nodesByKind.code_community ?? 0) + 1,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        belongs_to: (productGraph.summary.edgesByKind.belongs_to ?? 0) + 5,
        depends_on: (productGraph.summary.edgesByKind.depends_on ?? 0) + 6,
        uses: (productGraph.summary.edgesByKind.uses ?? 0) + 1,
      },
    },
  };
}

function makeArchitectureHealthCodeMapProductGraph(): ProductGraphProjection {
  const productGraph = makeCodeMapProductGraph();
  const healthNodes: ProductGraphProjection["nodes"] = [
    {
      id: "file:cycle-a",
      kind: "code_file",
      title: "src/cycle-a.ts",
      status: "planned",
      tags: ["code-scan"],
      source: { kind: "code_scan", label: "Codebase scan", path: "src/cycle-a.ts" },
      metadata: { scannerSourceFile: "src/cycle-a.ts" },
      createdAt: "2026-05-12T00:09:00.000Z",
      updatedAt: "2026-05-12T00:09:00.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
    {
      id: "file:cycle-b",
      kind: "code_file",
      title: "src/cycle-b.ts",
      status: "planned",
      tags: ["code-scan"],
      source: { kind: "code_scan", label: "Codebase scan", path: "src/cycle-b.ts" },
      metadata: { scannerSourceFile: "src/cycle-b.ts" },
      createdAt: "2026-05-12T00:09:10.000Z",
      updatedAt: "2026-05-12T00:09:10.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
    {
      id: "file:cycle-c",
      kind: "code_file",
      title: "src/cycle-c.ts",
      status: "planned",
      tags: ["code-scan"],
      source: { kind: "code_scan", label: "Codebase scan", path: "src/cycle-c.ts" },
      metadata: { scannerSourceFile: "src/cycle-c.ts" },
      createdAt: "2026-05-12T00:09:20.000Z",
      updatedAt: "2026-05-12T00:09:20.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
    {
      id: "file:orphan",
      kind: "code_file",
      title: "src/orphan.ts",
      body: "SOURCE BODY SHOULD NOT RENDER",
      status: "planned",
      tags: ["code-scan"],
      source: { kind: "code_scan", label: "Codebase scan", path: "src/orphan.ts" },
      metadata: { scannerSourceFile: "src/orphan.ts" },
      createdAt: "2026-05-12T00:09:30.000Z",
      updatedAt: "2026-05-12T00:09:30.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
    {
      id: "file:unresolved",
      kind: "code_file",
      title: "src/unresolved.ts",
      status: "planned",
      tags: ["code-scan"],
      source: { kind: "code_scan", label: "Codebase scan", path: "src/unresolved.ts" },
      metadata: {
        scannerSourceFile: "src/unresolved.ts",
        scannerUnresolvedDependencyCount: 1,
        scannerUnresolvedDependencies: "@/missing",
      },
      createdAt: "2026-05-12T00:09:40.000Z",
      updatedAt: "2026-05-12T00:09:40.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
    {
      id: "file:external",
      kind: "code_file",
      title: "src/external.ts",
      status: "planned",
      tags: ["code-scan"],
      source: { kind: "code_scan", label: "Codebase scan", path: "src/external.ts" },
      metadata: {
        scannerSourceFile: "src/external.ts",
        scannerExternalDependencyCount: 1,
        scannerExternalDependencies: "react",
      },
      createdAt: "2026-05-12T00:09:50.000Z",
      updatedAt: "2026-05-12T00:09:50.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    },
  ];
  const healthEdges: ProductGraphProjection["edges"] = [
    ["edge-cycle-a-b", "file:cycle-a", "file:cycle-b"],
    ["edge-cycle-b-c", "file:cycle-b", "file:cycle-c"],
    ["edge-cycle-c-a", "file:cycle-c", "file:cycle-a"],
    ["edge-unresolved-format", "file:unresolved", "file:src-format"],
    ["edge-external-format", "file:external", "file:src-format"],
  ].map(([id, sourceNodeId, targetNodeId], index) => ({
    id,
    sourceNodeId,
    targetNodeId,
    kind: "depends_on",
    label: "File imports file",
    trust: "extracted",
    source: {
      kind: "code_scan",
      label: "Codebase scan",
      path: `${sourceNodeId.replace("file:", "")}.ts`,
      line: index + 1,
    },
    metadata: {
      scannerRelation: "module_dependency",
      scannerResolution: "semantic",
      scannerSourceFile: sourceNodeId.replace("file:", ""),
      scannerTargetFile: targetNodeId.replace("file:", ""),
      scannerDependencyCount: 1,
      scannerDependencyKinds: "import",
    },
    createdAt: "2026-05-12T00:10:00.000Z",
    updatedAt: "2026-05-12T00:10:00.000Z",
  }));

  return {
    ...productGraph,
    nodes: [...healthNodes, ...productGraph.nodes],
    edges: [...healthEdges, ...productGraph.edges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + healthNodes.length,
      edgeCount: productGraph.summary.edgeCount + healthEdges.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        code_file: (productGraph.summary.nodesByKind.code_file ?? 0) + healthNodes.length,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        depends_on: (productGraph.summary.edgesByKind.depends_on ?? 0) + healthEdges.length,
      },
    },
  };
}

function makeImpactOverflowCodeMapProductGraph(): ProductGraphProjection {
  const productGraph = makeClusteredCodeMapProductGraph();
  const overflowFiles: ProductGraphProjection["nodes"] = Array.from({ length: 4 }, (_, index) => ({
    id: `file:overflow-${index + 1}`,
    kind: "code_file",
    title: `packages/overflow-${index + 1}.ts`,
    status: "planned",
    tags: ["code-scan"],
    source: {
      kind: "code_scan",
      label: "Codebase scan",
      path: `packages/overflow-${index + 1}.ts`,
    },
    metadata: {
      scannerSourceFile: `packages/overflow-${index + 1}.ts`,
    },
    createdAt: `2026-05-12T00:11:0${index}.000Z`,
    updatedAt: `2026-05-12T00:11:0${index}.000Z`,
    incomingEdgeIds: [],
    outgoingEdgeIds: [],
    blockedByNodeIds: [],
  }));
  const overflowEdges: ProductGraphProjection["edges"] = overflowFiles.map((node, index) => ({
    id: `edge-packages-app-overflow-${index + 1}`,
    sourceNodeId: "file:packages-app",
    targetNodeId: node.id,
    kind: "depends_on",
    label: "File imports file",
    trust: "extracted",
    source: {
      kind: "code_scan",
      label: "Codebase scan",
      path: "packages/app.ts",
      line: index + 20,
    },
    metadata: {
      scannerRelation: "module_dependency",
      scannerResolution: "semantic",
      scannerSourceFile: "packages/app.ts",
      scannerTargetFile: node.title,
      scannerDependencyCount: 1,
      scannerDependencyKinds: "import",
    },
    createdAt: `2026-05-12T00:11:1${index}.000Z`,
    updatedAt: `2026-05-12T00:11:1${index}.000Z`,
  }));

  return {
    ...productGraph,
    nodes: [...overflowFiles, ...productGraph.nodes],
    edges: [...overflowEdges, ...productGraph.edges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + overflowFiles.length,
      edgeCount: productGraph.summary.edgeCount + overflowEdges.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        code_file: (productGraph.summary.nodesByKind.code_file ?? 0) + overflowFiles.length,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        depends_on: (productGraph.summary.edgesByKind.depends_on ?? 0) + overflowEdges.length,
      },
    },
  };
}

function makeRunTouchedCodeMapProductGraph(changeTiming: "fresh" | "stale"): ProductGraphProjection {
  const productGraph = makeCodeMapProductGraph();
  const changedAt = changeTiming === "stale" ? "2026-05-13T00:00:00.000Z" : "2026-05-12T00:04:15.000Z";
  const runNode: ProductGraphProjection["nodes"][number] = {
    id: `run:code-scan-${changeTiming}`,
    kind: "agent_run",
    title: `Codebase scan ${changeTiming} run`,
    status: "completed",
    createdAt: changedAt,
    updatedAt: changedAt,
    incomingEdgeIds: [],
    outgoingEdgeIds: ["edge-run-file-freshness"],
    blockedByNodeIds: [],
  };
  const runFileEdge: ProductGraphProjection["edges"][number] = {
    id: "edge-run-file-freshness",
    sourceNodeId: runNode.id,
    targetNodeId: "file:src-checkout",
    kind: "touches",
    label: "Run changed file",
    trust: "manual",
    createdAt: changedAt,
    updatedAt: changedAt,
  };
  const fileFeatureEdge: ProductGraphProjection["edges"][number] = {
    id: "edge-file-feature-freshness",
    sourceNodeId: "file:src-checkout",
    targetNodeId: "feature:checkout-visibility",
    kind: "implements",
    label: "Code implements feature",
    trust: "manual",
    createdAt: changedAt,
    updatedAt: changedAt,
  };

  return {
    ...productGraph,
    nodes: [
      ...productGraph.nodes.map((node) => {
        if (node.id === "file:src-checkout") {
          return {
            ...node,
            incomingEdgeIds: [...node.incomingEdgeIds, runFileEdge.id],
            outgoingEdgeIds: [...node.outgoingEdgeIds, fileFeatureEdge.id],
          };
        }
        if (node.id === "feature:checkout-visibility") {
          return { ...node, incomingEdgeIds: [...node.incomingEdgeIds, fileFeatureEdge.id] };
        }
        return node;
      }),
      runNode,
    ],
    edges: [...productGraph.edges, runFileEdge, fileFeatureEdge],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + 1,
      edgeCount: productGraph.summary.edgeCount + 2,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        agent_run: (productGraph.summary.nodesByKind.agent_run ?? 0) + 1,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        touches: (productGraph.summary.edgesByKind.touches ?? 0) + 1,
        implements: (productGraph.summary.edgesByKind.implements ?? 0) + 1,
      },
    },
  };
}

function makeLinkedRunFilesProductGraph(): ProductGraphProjection {
  const productGraph = makeProductGraph();
  const runNode: ProductGraphProjection["nodes"][number] = {
    id: "run:checkout-proof",
    kind: "agent_run",
    title: "Checkout proof run",
    status: "completed",
    tags: ["openagentgraph", "run"],
    source: {
      kind: "openagentgraph_run",
      label: "OpenAgentGraph run",
      url: "/graphs/graph:checkout-proof",
    },
    metadata: {
      graphId: "graph:checkout-proof",
      graphStatus: "completed",
      runControlState: "idle",
      completedNodeCount: 2,
      plannedNodeCount: 2,
      passRate: 1,
      evidenceCoverageRate: 0.75,
      lastEventSequence: 7,
    },
    createdAt: "2026-05-12T00:08:00.000Z",
    updatedAt: "2026-05-12T00:10:00.000Z",
    incomingEdgeIds: ["edge-task-run", "edge-run-evidence"],
    outgoingEdgeIds: ["edge-run-file"],
    blockedByNodeIds: [],
  };
  const evidenceNode: ProductGraphProjection["nodes"][number] = {
    id: "evidence:checkout-proof",
    kind: "evidence",
    title: "Checkout proof run evidence",
    summary: "1 changed file, 1 command, 1 test command.",
    status: "completed",
    tags: ["openagentgraph", "evidence"],
    source: {
      kind: "openagentgraph_run",
      label: "OpenAgentGraph run",
      url: "/graphs/graph:checkout-proof",
    },
    metadata: {
      graphId: "graph:checkout-proof",
      graphStatus: "completed",
      changedFileCount: 1,
      commandCount: 1,
      failingCommandCount: 0,
      testCommandCount: 1,
      passingTestCommandCount: 1,
      toolCallCount: 1,
      passRate: 1,
      evidenceCoverageRate: 0.75,
      lastEventSequence: 7,
    },
    createdAt: "2026-05-12T00:08:30.000Z",
    updatedAt: "2026-05-12T00:10:00.000Z",
    incomingEdgeIds: [],
    outgoingEdgeIds: ["edge-run-evidence"],
    blockedByNodeIds: [],
  };
  const fileNode: ProductGraphProjection["nodes"][number] = {
    id: "file:checkout-status",
    kind: "code_file",
    title: "packages/frontend/src/CheckoutStatus.tsx",
    status: "planned",
    tags: ["openagentgraph", "code"],
    source: {
      kind: "openagentgraph_run",
      label: "OpenAgentGraph run",
      path: "packages/frontend/src/CheckoutStatus.tsx",
      url: "/graphs/graph:checkout-proof",
    },
    metadata: {
      openAgentGraphRunFilePath: "packages/frontend/src/CheckoutStatus.tsx",
    },
    createdAt: "2026-05-12T00:09:00.000Z",
    updatedAt: "2026-05-12T00:10:00.000Z",
    incomingEdgeIds: ["edge-run-file"],
    outgoingEdgeIds: [],
    blockedByNodeIds: [],
  };
  const runEdges: ProductGraphProjection["edges"] = [
    {
      id: "edge-task-run",
      sourceNodeId: "task:checkout-status-panel",
      targetNodeId: "run:checkout-proof",
      kind: "produced_by",
      label: "Task produced by run",
      trust: "manual",
      createdAt: "2026-05-12T00:10:00.000Z",
      updatedAt: "2026-05-12T00:10:00.000Z",
    },
    {
      id: "edge-run-evidence",
      sourceNodeId: "evidence:checkout-proof",
      targetNodeId: "run:checkout-proof",
      kind: "produced_by",
      label: "Evidence produced by run",
      trust: "manual",
      createdAt: "2026-05-12T00:10:00.000Z",
      updatedAt: "2026-05-12T00:10:00.000Z",
    },
    {
      id: "edge-run-file",
      sourceNodeId: "run:checkout-proof",
      targetNodeId: "file:checkout-status",
      kind: "touches",
      label: "Run changed file",
      trust: "manual",
      metadata: {
        filePath: "packages/frontend/src/CheckoutStatus.tsx",
        fileDiffCount: 1,
        changeTypes: "created",
      },
      createdAt: "2026-05-12T00:10:00.000Z",
      updatedAt: "2026-05-12T00:10:00.000Z",
    },
  ];
  const intentNodes = productGraph.nodes.map((node) =>
    node.id === "task:checkout-status-panel"
      ? { ...node, outgoingEdgeIds: [...node.outgoingEdgeIds, "edge-task-run"] }
      : node
  );

  return {
    ...productGraph,
    nodes: [...intentNodes, runNode, evidenceNode, fileNode],
    edges: [...productGraph.edges, ...runEdges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + 3,
      edgeCount: productGraph.summary.edgeCount + runEdges.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        agent_run: 1,
        evidence: 1,
        code_file: 1,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        produced_by: 2,
        touches: 1,
      },
    },
  };
}

function makeLinkedRunWithoutEvidenceProductGraph(): ProductGraphProjection {
  const productGraph = makeLinkedRunFilesProductGraph();

  return {
    ...productGraph,
    nodes: productGraph.nodes
      .filter((node) => node.id !== "evidence:checkout-proof")
      .map((node) =>
        node.id === "run:checkout-proof"
          ? { ...node, incomingEdgeIds: node.incomingEdgeIds.filter((edgeId) => edgeId !== "edge-run-evidence") }
          : node
      ),
    edges: productGraph.edges.filter((edge) => edge.id !== "edge-run-evidence"),
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount - 1,
      edgeCount: productGraph.summary.edgeCount - 1,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        evidence: 0,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        produced_by: (productGraph.summary.edgesByKind.produced_by ?? 1) - 1,
      },
    },
  };
}

function makeLinkedRunWithProductIntentGraph(): ProductGraphProjection {
  const productGraph = makeLinkedRunFilesProductGraph();
  const intentEdge: ProductGraphProjection["edges"][number] = {
    id: "edge-task-feature-intent",
    sourceNodeId: "task:checkout-status-panel",
    targetNodeId: "feature:checkout-visibility",
    kind: "implements",
    label: "Task implements feature",
    trust: "manual",
    createdAt: "2026-05-12T00:10:30.000Z",
    updatedAt: "2026-05-12T00:10:30.000Z",
  };

  return {
    ...productGraph,
    nodes: productGraph.nodes.map((node) => {
      if (node.id === "task:checkout-status-panel") {
        return { ...node, outgoingEdgeIds: [...node.outgoingEdgeIds, intentEdge.id] };
      }
      if (node.id === "feature:checkout-visibility") {
        return { ...node, incomingEdgeIds: [...node.incomingEdgeIds, intentEdge.id] };
      }
      return node;
    }),
    edges: [...productGraph.edges, intentEdge],
    summary: {
      ...productGraph.summary,
      edgeCount: productGraph.summary.edgeCount + 1,
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        implements: (productGraph.summary.edgesByKind.implements ?? 0) + 1,
      },
    },
  };
}

function makeLinkedRunWithoutTestEvidenceProductGraph(): ProductGraphProjection {
  const productGraph = makeLinkedRunFilesProductGraph();

  return {
    ...productGraph,
    nodes: productGraph.nodes.map((node) =>
      node.id === "evidence:checkout-proof"
        ? {
            ...node,
            summary: "1 changed file, 1 command, no test commands.",
            metadata: {
              ...(node.metadata ?? {}),
              testCommandCount: 0,
              passingTestCommandCount: 0,
            },
          }
        : node
    ),
  };
}

function makeOverflowTestEvidenceProductGraph(): ProductGraphProjection {
  const productGraph = withCheckoutTaskStatus(makeLinkedRunWithoutTestEvidenceProductGraph(), "completed");
  const extraTasks = Array.from({ length: 5 }, (_, index) => {
    const taskNumber = index + 1;
    return {
      id: `task:overflow-test-evidence-${taskNumber}`,
      kind: "task" as const,
      title: `Overflow test evidence task ${taskNumber}`,
      status: "completed" as const,
      createdAt: "2026-05-12T00:20:00.000Z",
      updatedAt: "2026-05-12T00:20:00.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [`edge-overflow-test-task-run-${taskNumber}`],
      blockedByNodeIds: [],
    } satisfies ProductGraphProjection["nodes"][number];
  });
  const extraRuns = extraTasks.map((_, index) => {
    const taskNumber = index + 1;
    return {
      id: `run:overflow-test-evidence-${taskNumber}`,
      kind: "agent_run" as const,
      title: `Overflow test evidence run ${taskNumber}`,
      status: "completed" as const,
      createdAt: "2026-05-12T00:21:00.000Z",
      updatedAt: "2026-05-12T00:21:00.000Z",
      incomingEdgeIds: [`edge-overflow-test-task-run-${taskNumber}`, `edge-overflow-test-evidence-run-${taskNumber}`],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    } satisfies ProductGraphProjection["nodes"][number];
  });
  const extraEvidence = extraTasks.map((_, index) => {
    const taskNumber = index + 1;
    return {
      id: `evidence:overflow-test-evidence-${taskNumber}`,
      kind: "evidence" as const,
      title: `Overflow test evidence proof ${taskNumber}`,
      status: "completed" as const,
      metadata: { commandCount: 1, testCommandCount: 0, passingTestCommandCount: 0 },
      createdAt: "2026-05-12T00:22:00.000Z",
      updatedAt: "2026-05-12T00:22:00.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [`edge-overflow-test-evidence-run-${taskNumber}`],
      blockedByNodeIds: [],
    } satisfies ProductGraphProjection["nodes"][number];
  });
  const extraEdges = extraTasks.flatMap((task, index) => {
    const taskNumber = index + 1;
    const run = extraRuns[index]!;
    const evidence = extraEvidence[index]!;
    return [
      {
        id: `edge-overflow-test-task-run-${taskNumber}`,
        sourceNodeId: task.id,
        targetNodeId: run.id,
        kind: "produced_by" as const,
        trust: "manual" as const,
        createdAt: "2026-05-12T00:23:00.000Z",
        updatedAt: "2026-05-12T00:23:00.000Z",
      },
      {
        id: `edge-overflow-test-evidence-run-${taskNumber}`,
        sourceNodeId: evidence.id,
        targetNodeId: run.id,
        kind: "produced_by" as const,
        trust: "manual" as const,
        createdAt: "2026-05-12T00:24:00.000Z",
        updatedAt: "2026-05-12T00:24:00.000Z",
      },
    ] satisfies ProductGraphProjection["edges"];
  });

  return {
    ...productGraph,
    nodes: [...productGraph.nodes, ...extraTasks, ...extraRuns, ...extraEvidence],
    edges: [...productGraph.edges, ...extraEdges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + extraTasks.length + extraRuns.length + extraEvidence.length,
      edgeCount: productGraph.summary.edgeCount + extraEdges.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        task: (productGraph.summary.nodesByKind.task ?? 0) + extraTasks.length,
        agent_run: (productGraph.summary.nodesByKind.agent_run ?? 0) + extraRuns.length,
        evidence: (productGraph.summary.nodesByKind.evidence ?? 0) + extraEvidence.length,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        produced_by: (productGraph.summary.edgesByKind.produced_by ?? 0) + extraEdges.length,
      },
    },
  };
}

function makeOverflowCodeIntentDriftProductGraph(): ProductGraphProjection {
  const productGraph = withCheckoutTaskStatus(makeLinkedRunFilesProductGraph(), "completed");
  const extraCodeNodes = Array.from({ length: 5 }, (_, index) => {
    const codeNumber = index + 1;
    return {
      id: `file:overflow-code-intent-${codeNumber}`,
      kind: "code_file" as const,
      title: `packages/frontend/src/CheckoutStatusExtra${codeNumber}.tsx`,
      status: "planned" as const,
      tags: ["openagentgraph", "code"],
      source: {
        kind: "openagentgraph_run" as const,
        label: "OpenAgentGraph run",
        path: `packages/frontend/src/CheckoutStatusExtra${codeNumber}.tsx`,
        url: "/graphs/graph:checkout-proof",
      },
      metadata: {
        openAgentGraphRunFilePath: `packages/frontend/src/CheckoutStatusExtra${codeNumber}.tsx`,
      },
      createdAt: "2026-05-12T00:25:00.000Z",
      updatedAt: "2026-05-12T00:25:00.000Z",
      incomingEdgeIds: [`edge-overflow-code-run-file-${codeNumber}`],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    } satisfies ProductGraphProjection["nodes"][number];
  });
  const extraEdges = extraCodeNodes.map((codeNode, index) => {
    const codeNumber = index + 1;
    return {
      id: `edge-overflow-code-run-file-${codeNumber}`,
      sourceNodeId: "run:checkout-proof",
      targetNodeId: codeNode.id,
      kind: "touches" as const,
      label: "Run changed file",
      trust: "manual" as const,
      createdAt: "2026-05-12T00:26:00.000Z",
      updatedAt: "2026-05-12T00:26:00.000Z",
    } satisfies ProductGraphProjection["edges"][number];
  });

  return {
    ...productGraph,
    nodes: [
      ...productGraph.nodes.map((node) =>
        node.id === "run:checkout-proof"
          ? { ...node, outgoingEdgeIds: [...node.outgoingEdgeIds, ...extraEdges.map((edge) => edge.id)] }
          : node
      ),
      ...extraCodeNodes,
    ],
    edges: [...productGraph.edges, ...extraEdges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + extraCodeNodes.length,
      edgeCount: productGraph.summary.edgeCount + extraEdges.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        code_file: (productGraph.summary.nodesByKind.code_file ?? 0) + extraCodeNodes.length,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        touches: (productGraph.summary.edgesByKind.touches ?? 0) + extraEdges.length,
      },
    },
  };
}

function withCheckoutTaskStatus(
  productGraph: ProductGraphProjection,
  status: ProductGraphProjection["nodes"][number]["status"]
): ProductGraphProjection {
  return {
    ...productGraph,
    nodes: productGraph.nodes.map((node) =>
      node.id === "task:checkout-status-panel"
        ? { ...node, status, blockedByNodeIds: status === "completed" ? [] : node.blockedByNodeIds }
        : node
    ),
    summary: {
      ...productGraph.summary,
      blockedTaskCount: status === "completed" ? 0 : productGraph.summary.blockedTaskCount,
    },
  };
}

function makeOverflowExecutionDriftProductGraph(): ProductGraphProjection {
  const productGraph = withCheckoutTaskStatus(makeProductGraph(), "completed");
  const extraTasks = Array.from({ length: 5 }, (_, index) => {
    const taskNumber = index + 1;
    return {
      id: `task:overflow-drift-${taskNumber}`,
      kind: "task" as const,
      title: `Overflow drift task ${taskNumber}`,
      status: "completed" as const,
      createdAt: `2026-05-12T00:1${taskNumber}:00.000Z`,
      updatedAt: `2026-05-12T00:1${taskNumber}:00.000Z`,
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    } satisfies ProductGraphProjection["nodes"][number];
  });

  return {
    ...productGraph,
    nodes: [...productGraph.nodes, ...extraTasks],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + extraTasks.length,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        task: (productGraph.summary.nodesByKind.task ?? 0) + extraTasks.length,
      },
    },
  };
}

function makeLinkedRunProductGraphTrace(productGraph: ProductGraphProjection, rootNodeId: string): ProductGraphTrace {
  const rootNode = productGraph.nodes.find((node) => node.id === rootNodeId)!;
  const runNode = productGraph.nodes.find((node) => node.id === "run:checkout-proof")!;
  const evidenceNode = productGraph.nodes.find((node) => node.id === "evidence:checkout-proof")!;
  const fileNode = productGraph.nodes.find((node) => node.id === "file:checkout-status")!;
  const taskRunEdge = productGraph.edges.find((edge) => edge.id === "edge-task-run")!;
  const runEvidenceEdge = productGraph.edges.find((edge) => edge.id === "edge-run-evidence")!;
  const runFileEdge = productGraph.edges.find((edge) => edge.id === "edge-run-file")!;

  return {
    schemaVersion: "1",
    productGraphId: productGraph.productGraphId,
    rootNode: {
      ...rootNode,
      incomingEdgeIds: [],
      outgoingEdgeIds: [taskRunEdge.id],
      blockedByNodeIds: [],
    },
    nodes: [
      {
        ...rootNode,
        incomingEdgeIds: [],
        outgoingEdgeIds: [taskRunEdge.id],
        blockedByNodeIds: [],
      },
      {
        ...runNode,
        incomingEdgeIds: [taskRunEdge.id, runEvidenceEdge.id],
        outgoingEdgeIds: [runFileEdge.id],
        blockedByNodeIds: [],
      },
      {
        ...evidenceNode,
        incomingEdgeIds: [],
        outgoingEdgeIds: [runEvidenceEdge.id],
        blockedByNodeIds: [],
      },
      {
        ...fileNode,
        incomingEdgeIds: [runFileEdge.id],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      },
    ],
    edges: [taskRunEdge, runEvidenceEdge, runFileEdge],
    hopsByNodeId: {
      [rootNode.id]: 0,
      [runNode.id]: 1,
      [evidenceNode.id]: 2,
      [fileNode.id]: 2,
    },
    summary: {
      nodeCount: 4,
      edgeCount: 3,
      maxDepth: 2,
      codeNodeCount: 1,
      testResultNodeCount: 0,
      evidenceNodeCount: 1,
    },
  };
}

function makeProductGraphTrace(productGraph: ProductGraphProjection, rootNodeId: string): ProductGraphTrace {
  const rootNode = productGraph.nodes.find((node) => node.id === rootNodeId)!;
  const relatedNode = productGraph.nodes.find((node) => node.id === "symbol:checkout-controller") ?? productGraph.nodes[1]!;
  const edge = productGraph.edges.find((item) => item.id === "edge-task-symbol") ?? productGraph.edges[0]!;
  return {
    schemaVersion: "1",
    productGraphId: productGraph.productGraphId,
    rootNode: {
      ...rootNode,
      incomingEdgeIds: [],
      outgoingEdgeIds: [edge.id],
      blockedByNodeIds: [],
    },
    nodes: [
      {
        ...rootNode,
        incomingEdgeIds: [],
        outgoingEdgeIds: [edge.id],
        blockedByNodeIds: [],
      },
      {
        ...relatedNode,
        incomingEdgeIds: [edge.id],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      },
    ],
    edges: [edge],
    hopsByNodeId: {
      [rootNode.id]: 0,
      [relatedNode.id]: 1,
    },
    summary: {
      nodeCount: 2,
      edgeCount: 1,
      maxDepth: 2,
      codeNodeCount: relatedNode.kind === "code_symbol" ? 1 : 0,
      testResultNodeCount: 0,
      evidenceNodeCount: 0,
    },
  };
}

function makeProductGraphCodexPlan(productGraph: ProductGraphProjection): ProductGraphCodexPlanningPrompt {
  const taskNode = productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!;
  const codeAreaNode = productGraph.nodes.find((node) => node.id === "file:checkout-status") ?? productGraph.nodes[0]!;
  const codeAreaEdge = productGraph.edges.find((edge) => edge.targetNodeId === codeAreaNode.id) ?? productGraph.edges[0]!;
  return {
    taskNode,
    intentNodes: productGraph.nodes.filter((node) => node.kind === "feature").slice(0, 1),
    acceptanceCriteria: productGraph.nodes.filter((node) => node.kind === "acceptance_criterion").slice(0, 1),
    likelyCodeAreas: [{ node: codeAreaNode, edge: codeAreaEdge }],
    openQuestions: productGraph.nodes.filter((node) => node.kind === "open_question").slice(0, 1),
    risks: ["Some code links are inferred or ambiguous; confirm them before editing."],
    verificationCommands: ["npm run build", "npm run test"],
    codeMapSummary: "God Nodes: CheckoutStatus component.",
    prompt: [
      "You are Codex working from OpenAgentGraph product graph context.",
      "## Current task",
      "- [task] Wire checkout status panel (task:checkout-status-panel)",
    ].join("\n"),
  };
}

function makeAcceptedCodexPlanProductGraph(): ProductGraphProjection {
  const productGraph = makeCodeMapProductGraph();
  const planEdge: ProductGraphProjection["edges"][number] = {
    id: "edge-codex-plan-checkout-status-panel",
    sourceNodeId: "plan:codex:checkout-status-panel",
    targetNodeId: "task:checkout-status-panel",
    kind: "derived_from",
    trust: "manual",
    label: "Plan derived from task",
    createdAt: "2026-05-12T00:12:00.000Z",
    updatedAt: "2026-05-12T00:12:00.000Z",
  };
  const planNode: ProductGraphProjection["nodes"][number] = {
    id: "plan:codex:checkout-status-panel",
    kind: "plan",
    title: "Codex plan for Wire checkout status panel",
    summary: "Accepted Codex planning prompt for Wire checkout status panel.",
    body: [
      "You are Codex working from OpenAgentGraph product graph context.",
      "## Current task",
      "- [task] Wire checkout status panel (task:checkout-status-panel)",
    ].join("\n"),
    status: "planned",
    tags: ["codex", "planning"],
    metadata: {
      taskNodeId: "task:checkout-status-panel",
      promptHash: "a".repeat(64),
    },
    createdAt: "2026-05-12T00:12:00.000Z",
    updatedAt: "2026-05-12T00:12:00.000Z",
    incomingEdgeIds: [],
    outgoingEdgeIds: [planEdge.id],
    blockedByNodeIds: [],
  };

  return {
    ...productGraph,
    nodes: [
      planNode,
      ...productGraph.nodes.map((node) =>
        node.id === "task:checkout-status-panel"
          ? { ...node, incomingEdgeIds: [...node.incomingEdgeIds, planEdge.id] }
          : node
      ),
    ],
    edges: [planEdge, ...productGraph.edges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + 1,
      edgeCount: productGraph.summary.edgeCount + 1,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        plan: (productGraph.summary.nodesByKind.plan ?? 0) + 1,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        derived_from: (productGraph.summary.edgesByKind.derived_from ?? 0) + 1,
      },
    },
  };
}

function makeAcceptedCodexPlanRunLinkedProductGraph(): ProductGraphProjection {
  const productGraph = makeAcceptedCodexPlanProductGraph();
  const runPlanEdge: ProductGraphProjection["edges"][number] = {
    id: "edge-run-codex-plan-checkout-status-panel",
    sourceNodeId: "run:checkout-proof",
    targetNodeId: "plan:codex:checkout-status-panel",
    kind: "derived_from",
    trust: "manual",
    label: "Run derived from plan",
    metadata: {
      graphId: "graph:checkout-proof",
      taskNodeId: "task:checkout-status-panel",
      planNodeId: "plan:codex:checkout-status-panel",
    },
    createdAt: "2026-05-12T00:13:00.000Z",
    updatedAt: "2026-05-12T00:13:00.000Z",
  };
  const runNode: ProductGraphProjection["nodes"][number] = {
    id: "run:checkout-proof",
    kind: "agent_run",
    title: "Checkout proof run",
    summary: "Run completed successfully.",
    status: "completed",
    tags: ["openagentgraph", "run"],
    metadata: {
      graphId: "graph:checkout-proof",
      passRate: 1,
      evidenceCoverageRate: 0.75,
    },
    createdAt: "2026-05-12T00:13:00.000Z",
    updatedAt: "2026-05-12T00:13:00.000Z",
    incomingEdgeIds: [],
    outgoingEdgeIds: [runPlanEdge.id],
    blockedByNodeIds: [],
  };

  return {
    ...productGraph,
    nodes: [
      ...productGraph.nodes.map((node) =>
        node.id === "plan:codex:checkout-status-panel"
          ? { ...node, incomingEdgeIds: [...node.incomingEdgeIds, runPlanEdge.id] }
          : node
      ),
      runNode,
    ],
    edges: [runPlanEdge, ...productGraph.edges],
    summary: {
      ...productGraph.summary,
      nodeCount: productGraph.summary.nodeCount + 1,
      edgeCount: productGraph.summary.edgeCount + 1,
      nodesByKind: {
        ...productGraph.summary.nodesByKind,
        agent_run: (productGraph.summary.nodesByKind.agent_run ?? 0) + 1,
      },
      edgesByKind: {
        ...productGraph.summary.edgesByKind,
        derived_from: (productGraph.summary.edgesByKind.derived_from ?? 0) + 1,
      },
    },
  };
}

function makeCompletedRun(overrides: Partial<DashboardRunSummary> = {}): DashboardRunSummary {
  return {
    graphId: "graph:checkout-proof",
    goalTitle: "Checkout proof run",
    lifecycleBucket: "completed_recent",
    graphStatus: "completed",
    runControlState: "idle",
    frontierStatus: "on_track",
    needsHumanReview: false,
    approvalState: "not_requested",
    waitingForApproval: false,
    alertCount: 0,
    completedNodeCount: 2,
    plannedNodeCount: 2,
    passRate: 1,
    revisionRate: 0,
    evidenceCoverageRate: 0.75,
    lastEventAt: "2026-05-12T00:10:00.000Z",
    lastEventSequence: 7,
    attentionScore: 20,
    attentionLabel: "low",
    ...overrides,
  };
}

describe("ProductGraphView", () => {
  const onRefresh = vi.fn();
  const onCreateNode = vi.fn();
  const onCreateEdge = vi.fn();
  const onCreateIntentBundle = vi.fn();
  const onGenerateHandoff = vi.fn();
  const onWriteHandoff = vi.fn();
  const onScanCodebase = vi.fn();
  const onImportSpecKit = vi.fn();
  const onLinkRun = vi.fn();
  const onLoadTrace = vi.fn();
  const onLoadCodexPlan = vi.fn();
  const onAcceptCodexPlan = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    onCreateNode.mockResolvedValue({
      id: "feature:new-intent",
      kind: "feature",
      title: "New intent",
      status: "planned",
      createdAt: "2026-05-12T00:04:00.000Z",
      updatedAt: "2026-05-12T00:04:00.000Z",
    });
    onCreateEdge.mockResolvedValue({
      id: "edge-new-intent",
      sourceNodeId: "story:operator-sees-checkout",
      targetNodeId: "feature:checkout-visibility",
      kind: "implements",
      trust: "manual",
      createdAt: "2026-05-12T00:05:00.000Z",
      updatedAt: "2026-05-12T00:05:00.000Z",
    });
    onCreateIntentBundle.mockResolvedValue({
      nodes: [
        {
          id: "feature:created-bundle",
          kind: "feature",
          title: "Created bundle",
          status: "planned",
          createdAt: "2026-05-12T00:06:00.000Z",
          updatedAt: "2026-05-12T00:06:00.000Z",
        },
      ],
      edges: [],
    });
    onGenerateHandoff.mockResolvedValue({
      markdown: "# OpenAgentGraph Handoff\n\n## Read These First\n- `src/App.tsx`",
      summary: {
        nodeCount: 4,
        edgeCount: 2,
        codeFileCount: 1,
        codeSymbolCount: 1,
        riskCount: 1,
        recommendedReadCount: 1,
        generatedAt: "2026-06-02T00:00:00.000Z",
      },
    });
    onWriteHandoff.mockResolvedValue({
      status: "written",
      path: "GRAPH_REPORT.md",
      markdown: "# OpenAgentGraph Handoff\n\n## Read These First\n- `src/App.tsx`",
      summary: {
        nodeCount: 4,
        edgeCount: 2,
        codeFileCount: 1,
        codeSymbolCount: 1,
        riskCount: 1,
        recommendedReadCount: 1,
        generatedAt: "2026-06-02T00:00:00.000Z",
      },
    });
    onImportSpecKit.mockResolvedValue({
      status: "imported",
      message: "Spec Kit artifacts imported into the Product Graph.",
      imported: {
        nodeCount: 7,
        edgeCount: 6,
        constitutionCount: 1,
        specFileCount: 1,
        featureCount: 1,
        userStoryCount: 1,
        requirementCount: 1,
        acceptanceCriterionCount: 1,
        openQuestionCount: 0,
        contractFileCount: 1,
        contractCount: 1,
        planFileCount: 0,
        planCount: 0,
        quickstartFileCount: 0,
        quickstartScenarioCount: 0,
        taskFileCount: 1,
        taskCount: 1,
        skippedSpecFileCount: 0,
        skippedContractFileCount: 0,
        skippedPlanFileCount: 0,
        skippedQuickstartFileCount: 0,
        skippedTaskFileCount: 0,
      },
      artifactRoot: ".",
      artifacts: [
        { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: true },
        { key: "specs", relativePath: "specs", kind: "specs", present: true },
      ],
      presentArtifacts: ["constitution", "specs"],
      missingArtifacts: [],
    });
    onScanCodebase.mockResolvedValue({
      status: "scanned",
      message: "Codebase scan completed.",
      scanId: "scan-1",
      scannedAt: "2026-06-01T00:00:00.000Z",
      scanned: {
        fileCount: 1,
        symbolCount: 2,
        edgeCount: 2,
        skippedFileCount: 0,
        skippedDirectoryCount: 0,
        archivedNodeCount: 0,
        archivedEdgeCount: 0,
        durationMs: 10,
        partial: false,
      },
    });
    onLinkRun.mockResolvedValue({
      node: {
        id: "run:checkout-proof",
        kind: "agent_run",
        title: "Checkout proof run",
        status: "completed",
        createdAt: "2026-05-12T00:10:00.000Z",
        updatedAt: "2026-05-12T00:10:00.000Z",
      },
      edge: {
        id: "edge-task-run",
        sourceNodeId: "task:checkout-status-panel",
        targetNodeId: "run:checkout-proof",
        kind: "produced_by",
        trust: "manual",
        createdAt: "2026-05-12T00:10:00.000Z",
        updatedAt: "2026-05-12T00:10:00.000Z",
      },
      evidenceNode: {
        id: "evidence:checkout-proof",
        kind: "evidence",
        title: "Checkout proof run evidence",
        status: "completed",
        createdAt: "2026-05-12T00:10:00.000Z",
        updatedAt: "2026-05-12T00:10:00.000Z",
      },
      evidenceEdge: {
        id: "edge-run-evidence",
        sourceNodeId: "evidence:checkout-proof",
        targetNodeId: "run:checkout-proof",
        kind: "produced_by",
        trust: "manual",
        createdAt: "2026-05-12T00:10:00.000Z",
        updatedAt: "2026-05-12T00:10:00.000Z",
      },
      fileNodes: [],
      fileEdges: [],
    });
    onLoadTrace.mockResolvedValue(makeProductGraphTrace(makeCodeMapProductGraph(), "task:checkout-status-panel"));
    onLoadCodexPlan.mockResolvedValue(makeProductGraphCodexPlan(makeCodeMapProductGraph()));
    onAcceptCodexPlan.mockResolvedValue({
      node: {
        id: "plan:codex:checkout-status-panel",
        kind: "plan",
        title: "Codex plan for Wire checkout status panel",
        status: "planned",
        createdAt: "2026-05-12T00:12:00.000Z",
        updatedAt: "2026-05-12T00:12:00.000Z",
      },
      edge: {
        id: "edge-codex-plan-checkout-status-panel",
        sourceNodeId: "plan:codex:checkout-status-panel",
        targetNodeId: "task:checkout-status-panel",
        kind: "derived_from",
        trust: "manual",
        createdAt: "2026-05-12T00:12:00.000Z",
        updatedAt: "2026-05-12T00:12:00.000Z",
      },
    });
  });

  function renderInteractiveProductGraph(productGraph: ProductGraphProjection) {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <ProductGraphContent
          productGraph={productGraph}
          productGraphLoading={false}
          productGraphError=""
          onRefresh={onRefresh}
          canManageProductGraph={false}
          onCreateNode={onCreateNode}
          onCreateEdge={onCreateEdge}
          onCreateIntentBundle={onCreateIntentBundle}
        />
      );
    });
    return renderer!;
  }

  function clickByAriaLabel(renderer: TestRenderer.ReactTestRenderer, ariaLabel: string) {
    const target = renderer.root.findByProps({ "aria-label": ariaLabel });
    act(() => {
      target.props.onClick();
    });
  }

  it("renders product intent summary and visible nodes", () => {
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(markup).toContain("Intent graph");
    expect(markup).toContain("Product intent");
    expect(markup).toContain("Checkout visibility");
    expect(markup).toContain("Operator sees checkout status");
    expect(markup).toContain("Wire checkout status panel");
    expect(markup).toContain("Blocked by unresolved open question");
    expect(markup).toContain("Who owns payment copy?");
    expect(markup).toContain("Questions");
  });

  it("labels preview mode and hides backend-writing controls", () => {
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={{ ...makeProductGraph(), productGraphId: "preview:work-next" }}
        productGraphLoading={false}
        productGraphError=""
        productGraphPreviewMessage={PRODUCT_GRAPH_PREVIEW_MESSAGE}
        onRefresh={onRefresh}
        canManageProductGraph={true}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onGenerateHandoff={onGenerateHandoff}
        onWriteHandoff={onWriteHandoff}
        onScanCodebase={onScanCodebase}
        onImportSpecKit={onImportSpecKit}
        completedRuns={[makeCompletedRun()]}
        onLinkRun={onLinkRun}
        onLoadTrace={onLoadTrace}
      />
    );

    expect(markup).toContain('aria-label="Product graph preview mode"');
    expect(markup).toContain(PRODUCT_GRAPH_PREVIEW_MESSAGE);
    expect(markup).toContain("Editing and backend refresh controls are disabled in this view.");
    expect(markup).not.toContain("Create feature bundle");
    expect(markup).not.toContain("Add intent node");
    expect(markup).not.toContain("Add relationship");
    expect(markup).not.toContain("Scan Codebase");
    expect(markup).not.toContain("Import Spec Kit");
    expect(markup).not.toContain("Link completed run");
    expect(markup).not.toContain('aria-label="Traceability"');
  });

  it("keeps preview projections read-only even without the preview note prop", () => {
    const productGraph = makeProductGraph();
    const taskFirstProductGraph = {
      ...productGraph,
      productGraphId: "preview:work-next",
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={true}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onGenerateHandoff={onGenerateHandoff}
        onWriteHandoff={onWriteHandoff}
        onScanCodebase={onScanCodebase}
        onImportSpecKit={onImportSpecKit}
        completedRuns={[makeCompletedRun()]}
        onLinkRun={onLinkRun}
        onLoadTrace={onLoadTrace}
        onLoadCodexPlan={onLoadCodexPlan}
        onAcceptCodexPlan={onAcceptCodexPlan}
      />
    );

    expect(markup).not.toContain("Create feature bundle");
    expect(markup).not.toContain("Add intent node");
    expect(markup).not.toContain("Add relationship");
    expect(markup).not.toContain("Scan Codebase");
    expect(markup).not.toContain("Import Spec Kit");
    expect(markup).not.toContain("Link completed run");
    expect(markup).not.toContain('aria-label="Traceability"');
    expect(markup).not.toContain('aria-label="Codex planning prompt"');
  });

  it("renders selected task open-question blockers by name", () => {
    const productGraph = makeProductGraph();
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const blockerGroupStart = markup.indexOf('aria-label="Open question blockers"');
    expect(blockerGroupStart).toBeGreaterThanOrEqual(0);
    const relationshipsStart = markup.indexOf("Relationships", blockerGroupStart);
    expect(relationshipsStart).toBeGreaterThan(blockerGroupStart);
    const blockerGroupMarkup = markup.slice(blockerGroupStart, relationshipsStart);

    expect(blockerGroupMarkup).toContain("Blocked by open questions");
    expect(blockerGroupMarkup).toContain("Who owns payment copy?");
    expect(blockerGroupMarkup).toContain("proposed");
  });

  it("renders blocked task safety in product health", () => {
    expect(summarizeProductGraphReadyTaskCandidates(makeProductGraph())).toMatchObject({
      plannedTaskCount: 1,
      blockedPlannedTaskCount: 1,
      readyTaskCount: 0,
      taskCandidates: [],
    });

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const quickActionStart = markup.indexOf('aria-label="Work next quick action"');
    expect(quickActionStart).toBeGreaterThanOrEqual(0);
    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThan(quickActionStart);
    const quickActionMarkup = markup.slice(quickActionStart, healthGroupStart);

    expect(quickActionMarkup).toContain("Work next");
    expect(quickActionMarkup).toContain("No unblocked planned task is ready. Clear a blocker before implementation.");
    expect(quickActionMarkup).toContain("Clear blocker first");
    expect(quickActionMarkup).toContain('aria-label="Focus Wire checkout status panel blocker quick action"');

    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("Blocked tasks");
    expect(healthGroupMarkup).toContain("Ready tasks");
    expect(healthGroupMarkup).toContain(
      "1 task is blocked by open questions. Resolve blockers before assigning implementation work."
    );
    expect(healthGroupMarkup).toContain("No unblocked planned tasks are ready for implementation yet.");
    expect(healthGroupMarkup).toContain('aria-label="Work next recommendation"');
    expect(healthGroupMarkup).toContain("Work next");
    expect(healthGroupMarkup).toContain("No unblocked planned task is ready. Clear a blocker before implementation.");
    expect(healthGroupMarkup).toContain("Clear blocker first");
    expect(healthGroupMarkup).toContain('aria-label="Focus Wire checkout status panel blocker to clear next"');
    expect(healthGroupMarkup).toContain('aria-label="Blocked task gaps"');
    expect(healthGroupMarkup).toContain("Wire checkout status panel");
    expect(healthGroupMarkup).toContain("1 open question blocker");
    expect(healthGroupMarkup).toContain('aria-label="Focus Wire checkout status panel blocked task"');
    expect(healthGroupMarkup).not.toContain('aria-label="Ready task candidates"');
  });

  it("renders healthy blocked-task product health when no tasks are blocked", () => {
    expect(summarizeProductGraphReadyTaskCandidates(makeUnblockedProductGraph())).toMatchObject({
      plannedTaskCount: 1,
      blockedPlannedTaskCount: 0,
      readyTaskCount: 1,
    });
    expect(summarizeProductGraphReadyTaskCandidates(makeUnblockedProductGraph()).taskCandidates.map((task) => task.id)).toEqual([
      "task:checkout-status-panel",
    ]);

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeUnblockedProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const quickActionStart = markup.indexOf('aria-label="Work next quick action"');
    expect(quickActionStart).toBeGreaterThanOrEqual(0);
    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThan(quickActionStart);
    const quickActionMarkup = markup.slice(quickActionStart, healthGroupStart);

    expect(quickActionMarkup).toContain("Work next");
    expect(quickActionMarkup).toContain("Start with the top unblocked planned task.");
    expect(quickActionMarkup).toContain("Primary ready candidate");
    expect(quickActionMarkup).toContain('aria-label="Focus Wire checkout status panel work next quick action"');

    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("Blocked tasks");
    expect(healthGroupMarkup).toContain("No tasks are blocked by open questions.");
    expect(healthGroupMarkup).toContain("Ready tasks");
    expect(healthGroupMarkup).toContain("1 planned task is unblocked for implementation review.");
    expect(healthGroupMarkup).toContain('aria-label="Work next recommendation"');
    expect(healthGroupMarkup).toContain("Start with the top unblocked planned task.");
    expect(healthGroupMarkup).toContain("Primary ready candidate");
    expect(healthGroupMarkup).toContain('aria-label="Focus Wire checkout status panel work next task"');
    expect(healthGroupMarkup).toContain('aria-label="Ready task candidates"');
    expect(healthGroupMarkup).toContain("Wire checkout status panel");
    expect(healthGroupMarkup).toContain("Planned and unblocked");
    expect(healthGroupMarkup).toContain('aria-label="Focus Wire checkout status panel ready task"');
    expect(healthGroupMarkup).not.toContain('aria-label="Blocked task gaps"');
    expect(healthGroupMarkup).not.toContain('aria-label="Focus Wire checkout status panel blocked task"');
  });

  it("derives the focus state used by work-next quick actions", () => {
    const blockedTask = makeProductGraph().nodes.find((node) => node.id === "task:checkout-status-panel")!;
    const readyTask = summarizeProductGraphReadyTaskCandidates(makeUnblockedProductGraph()).taskCandidates[0]!;

    expect(productGraphFocusStateForNode(blockedTask)).toEqual({
      query: "",
      kindFilter: "task",
      statusFilter: "all",
      selectedNodeId: "task:checkout-status-panel",
      codeMapQuickFilter: "all",
    });
    expect(productGraphFocusStateForNode(readyTask)).toEqual({
      query: "",
      kindFilter: "task",
      statusFilter: "all",
      selectedNodeId: "task:checkout-status-panel",
      codeMapQuickFilter: "all",
    });
  });

  it("renders hidden-count copy when ready task candidates exceed the visible limit", () => {
    expect(summarizeProductGraphReadyTaskCandidates(makeOverflowReadyTaskProductGraph(), { taskCandidateLimit: 4 })).toMatchObject({
      plannedTaskCount: 6,
      blockedPlannedTaskCount: 0,
      readyTaskCount: 6,
      taskCandidates: expect.any(Array),
    });
    expect(
      summarizeProductGraphReadyTaskCandidates(makeOverflowReadyTaskProductGraph(), { taskCandidateLimit: 4 }).taskCandidates
    ).toHaveLength(4);

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeOverflowReadyTaskProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("6 planned tasks are unblocked for implementation review.");
    expect(healthGroupMarkup).toContain("Primary ready candidate");
    expect(healthGroupMarkup).toContain('aria-label="Focus Wire checkout status panel work next task"');
    expect(healthGroupMarkup).toContain("Ready follow-up task 3");
    expect(healthGroupMarkup).not.toContain("Ready follow-up task 4");
    expect(healthGroupMarkup).toContain("+2 more planned tasks are ready.");
  });

  it("renders hidden-count copy when blocked task gaps exceed the visible limit", () => {
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeOverflowBlockedTaskProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("6 tasks are blocked by open questions.");
    expect(healthGroupMarkup).toContain("Blocked follow-up task 3");
    expect(healthGroupMarkup).not.toContain("Blocked follow-up task 4");
    expect(healthGroupMarkup).toContain("+2 more tasks are blocked.");
  });

  it("renders native codebase scan map nodes and distinct trust labels", () => {
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeCodeMapProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(markup).toContain("Code map");
    expect(markup).toContain("Files");
    expect(markup).toContain("Symbols");
    expect(markup).toContain("Communities");
    expect(markup).toContain("Dependencies");
    expect(markup).toContain("Semantic");
    expect(markup).toContain('aria-label="Code map visual key"');
    expect(markup).toContain('aria-label="Code map theme"');
    expect(markup).toContain("High contrast");
    expect(markup).toContain("Color-safe");
    expect(markup).toContain("Visual key");
    expect(markup).toContain("module clusters that group scanned files");
    expect(markup).toContain("source files and dependency endpoints");
    expect(markup).toContain("TypeScript-resolved symbol relationships");
    expect(markup).toContain("inferred or ambiguous graph evidence");
    expect(markup).toContain('aria-label="Code map filters"');
    expect(markup).toContain('aria-label="Show code files"');
    expect(markup).toContain('aria-label="Show code symbols"');
    expect(markup).toContain('aria-label="Show code communities"');
    expect(markup).toContain('aria-label="Show dependency edges"');
    expect(markup).toContain('aria-label="Show semantic edges"');
    expect(markup).toContain('aria-label="Code map task lenses"');
    expect(markup).toContain('aria-label="Show Frontend task lens"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('title="React, renderer, UI, browser, and dashboard source."');
    expect(markup).toContain('aria-label="Show Backend/runtime task lens"');
    expect(markup).toContain('aria-label="Show Extension task lens"');
    expect(markup).toContain('aria-label="Show Tests task lens"');
    expect(markup).toContain('aria-label="Show Provider/AI task lens"');
    expect(markup).toContain('aria-label="Show Handoff/docs task lens"');
    expect(markup).toContain('aria-label="Code map quick filters"');
    expect(markup).toContain('aria-label="Clear Code Map quick filter"');
    expect(markup).toContain("Normal filters");
    expect(markup).toContain('aria-label="Show Module dependencies Code Map focus"');
    expect(markup).toContain('aria-label="Show Semantic symbol links Code Map focus"');
    expect(markup).toContain('aria-label="Show Dependency cycles Code Map focus"');
    expect(markup).toContain('aria-label="Show Unresolved dependencies Code Map focus"');
    expect(markup).toContain('aria-label="Show External packages Code Map focus"');
    expect(markup).toContain('aria-label="Show Orphan files Code Map focus"');
    expect(markup).toContain('aria-label="Show Stale/missing map Code Map focus"');
    expect(markup).toContain('aria-label="Code map architecture health"');
    expect(markup).toContain("Architecture health");
    expect(markup).toContain('aria-label="Drill into Dependency cycles Code Map health"');
    expect(markup).toContain('aria-label="Code map community groups"');
    expect(markup).toContain("Community groups");
    expect(markup).toContain('aria-label="Explore src community group"');
    expect(markup).toContain('aria-label="Dependency hotspots"');
    expect(markup).toContain("Dependency hotspots");
    expect(markup).toContain("CheckoutController");
    expect(markup).toContain("formatCheckout");
    expect(markup).toContain("src/checkout.ts:42");
    expect(markup).toContain("Code map details");
    expect(markup).toContain('aria-label="Impact path preview"');
    expect(markup).toContain("Impact path");
    expect(markup).toContain('aria-label="Code impact panel"');
    expect(markup).toContain("Code impact");
    expect(markup).toContain("Linked product evidence");
    expect(markup).toContain("Class CheckoutController");
    expect(markup).toContain("Method details");
    expect(markup).toContain("public render@44");
    expect(markup).toContain('aria-label="Code symbol semantics"');
    expect(markup).toContain("Semantic relationships");
    expect(markup).toContain("symbol_uses");
    expect(markup).toContain("CheckoutController -&gt; formatCheckout");
    expect(markup).toContain("Source file:");
    expect(markup).toContain("Target file:");
    expect(markup).toContain("Line:");
    expect(markup).toContain("Symbol belongs to file");
    expect(markup).toContain("Symbol uses symbol");
    expect(markup).toContain("Likely code area");
    expect(markup).toContain('aria-label="Codebase scan status"');
    expect(markup).toContain("Codebase scan map is loaded; no linked run code changes yet.");
    expect(markup).toContain("Codex planning can use native codebase scan context.");
    expect(markup).toContain("extracted");
    expect(markup).toContain("ambiguous");
    expect(markup).not.toContain("SOURCE BODY SHOULD NOT RENDER");
    expect(new Set([TRUST_TONES.extracted.border, TRUST_TONES.ambiguous.border]).size)
      .toBe(2);
  });

  it("lets users switch Code Map visual themes", () => {
    const renderer = renderInteractiveProductGraph(makeCodeMapProductGraph());
    const buttonText = (children: unknown): string =>
      Array.isArray(children) ? children.map(buttonText).join("") : String(children ?? "");
    const colorSafeButton = renderer.root
      .findAllByType("button")
      .find((button) => buttonText(button.props.children) === "Color-safe");

    expect(colorSafeButton).toBeTruthy();

    act(() => {
      colorSafeButton!.props.onClick();
    });

    const markup = JSON.stringify(renderer.toJSON());
    expect(markup).toContain('"aria-label":"Code map theme"');
    expect(markup).toContain(GRAPH_THEMES.colorSafe.codeMap.dependencies);
    expect(markup).toContain(GRAPH_THEMES.colorSafe.codeMap.semantic);
    expect(markup).toContain(GRAPH_THEMES.colorSafe.productStatus.planned);
    expect(markup).toContain(GRAPH_THEMES.colorSafe.productEdge.uses);
    expect(markup).toContain(GRAPH_THEMES.colorSafe.trust.extracted.border);
    expect(markup).toContain(GRAPH_THEMES.colorSafe.trust.ambiguous.border);
  });

  it("classifies code map filters for nodes and semantic/dependency edges", () => {
    const productGraph = makeCodeMapProductGraph();
    const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
    const fileNode = nodesById.get("file:src-checkout")!;
    const symbolNode = nodesById.get("symbol:checkout-controller")!;
    const communityNode = nodesById.get("community:src")!;
    const dependencyEdge = productGraph.edges.find((edge) => edge.id === "edge-file-format")!;
    const semanticEdge = productGraph.edges.find((edge) => edge.id === "edge-symbol-uses-helper")!;
    const productEdge = productGraph.edges.find((edge) => edge.id === "edge-story-feature")!;
    const { scannerSourceSymbol, scannerTargetSymbol, ...metadataWithoutSymbols } = semanticEdge.metadata ?? {};

    expect(isDependencyCodeEdge(dependencyEdge, nodesById)).toBe(true);
    expect(isSemanticCodeEdge(semanticEdge, nodesById)).toBe(true);
    expect(isSemanticCodeEdge(productEdge, nodesById)).toBe(false);
    expect(codeMapFilterAllowsNode(fileNode, {
      files: false,
      symbols: true,
      communities: true,
      dependencyEdges: true,
      semanticEdges: true,
    })).toBe(false);
    expect(codeMapFilterAllowsNode(symbolNode, {
      files: true,
      symbols: false,
      communities: true,
      dependencyEdges: true,
      semanticEdges: true,
    })).toBe(false);
    expect(codeMapFilterAllowsNode(communityNode, {
      files: true,
      symbols: true,
      communities: false,
      dependencyEdges: true,
      semanticEdges: true,
    })).toBe(false);
    expect(codeMapFilterAllowsEdge(dependencyEdge, {
      files: true,
      symbols: true,
      communities: true,
      dependencyEdges: false,
      semanticEdges: true,
    }, nodesById)).toBe(false);
    expect(codeMapFilterAllowsEdge(semanticEdge, {
      files: true,
      symbols: true,
      communities: true,
      dependencyEdges: true,
      semanticEdges: false,
    }, nodesById)).toBe(false);
    expect(codeMapFilterAllowsEdge(productEdge, {
      files: false,
      symbols: false,
      communities: false,
      dependencyEdges: false,
      semanticEdges: false,
    }, nodesById)).toBe(true);
    expect(codeMapFiltersForFocusedNode(fileNode, {
      files: false,
      symbols: false,
      communities: false,
      dependencyEdges: true,
      semanticEdges: true,
    })).toMatchObject({
      files: true,
      symbols: false,
      communities: false,
    });
    expect(codeMapFiltersForFocusedNode(symbolNode, {
      files: false,
      symbols: false,
      communities: false,
      dependencyEdges: true,
      semanticEdges: true,
    })).toMatchObject({
      files: false,
      symbols: true,
      communities: false,
    });
    expect(codeMapFiltersForFocusedNode(communityNode, {
      files: false,
      symbols: false,
      communities: false,
      dependencyEdges: true,
      semanticEdges: true,
    })).toMatchObject({
      files: false,
      symbols: false,
      communities: true,
    });
    expect(codeMapEdgeEndpointLabel(semanticEdge)).toBe("CheckoutController -> formatCheckout");
    expect(codeMapEdgeEndpointLabel({
      ...semanticEdge,
      metadata: metadataWithoutSymbols,
    })).toBe("src/checkout.ts -> src/format.ts");
    expect(codeMapEdgeEndpointLabel({
      ...semanticEdge,
      metadata: {
        scannerRelation: "symbol_uses",
      },
    })).toBeUndefined();
  });

  it("applies Code Map task scope lenses without hiding relevant dependency edges", () => {
    const productGraph = makeTaskScopeCodeMapProductGraph();
    const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
    const frontendFile = nodesById.get("file:frontend-app")!;
    const backendRuntimeFile = nodesById.get("file:backend-runtime")!;
    const productNode = makeProductGraph().nodes[0]!;
    const dependencyEdge = productGraph.edges.find((edge) => edge.id === "edge-frontend-runtime")!;
    const frontendNodeIds = buildProductGraphTaskScopeNodeIds(productGraph, "frontend");
    const backendRuntimeNodeIds = buildProductGraphTaskScopeNodeIds(productGraph, "backend-runtime");

    expect(codeMapTaskScopeAllowsNode(frontendFile, "frontend", frontendNodeIds)).toBe(true);
    expect(codeMapTaskScopeAllowsNode(backendRuntimeFile, "frontend", frontendNodeIds)).toBe(false);
    expect(codeMapTaskScopeAllowsNode(productNode, "frontend", frontendNodeIds)).toBe(true);
    expect(codeMapTaskScopeAllowsEdge(dependencyEdge, nodesById, "frontend", frontendNodeIds)).toBe(true);
    expect(codeMapTaskScopeAllowsNode(backendRuntimeFile, "backend-runtime", backendRuntimeNodeIds)).toBe(true);
    expect(frontendNodeIds.has("community:frontend")).toBe(true);
    expect(frontendNodeIds.has("community:backend")).toBe(false);
  });

  it("ranks Code Map community summaries, groups files, and dependency hotspots", () => {
    const productGraph = makeClusteredCodeMapProductGraph();
    const communities = buildCodeMapCommunitySummaries(productGraph);
    const groups = buildCodeMapCommunityGroups(productGraph, 5, 2);
    const hotspots = buildCodeMapDependencyHotspots(productGraph);

    expect(communities.map((summary) => summary.node.id)).toEqual(["community:packages", "community:src"]);
    expect(communities[0]).toMatchObject({
      fileCount: 3,
      dependencyCount: 6,
      semanticLinkCount: 1,
      externalDependencyCount: 2,
      unresolvedDependencyCount: 1,
    });
    expect(groups[0]).toMatchObject({
      summary: expect.objectContaining({ node: expect.objectContaining({ id: "community:packages" }) }),
      hiddenFileCount: 1,
    });
    expect(groups[0]?.files.map((node) => node.id)).toEqual(["file:packages-app", "file:packages-format"]);
    expect(hotspots.length).toBeLessThanOrEqual(5);
    expect(hotspots[0]).toMatchObject({
      node: expect.objectContaining({ id: "file:packages-app" }),
      importsCount: 2,
      importedByCount: 2,
      semanticRelationshipCount: 1,
    });
  });

  it("builds selected Code Map impact sections with bounded overflow", () => {
    const productGraph = makeClusteredCodeMapProductGraph();
    const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
    const packageAppFile = nodesById.get("file:packages-app")!;
    const checkoutFile = nodesById.get("file:src-checkout")!;
    const packageImpact = buildCodeMapImpactSummary(productGraph, packageAppFile, 1);
    const checkoutImpact = buildCodeMapImpactSummary(productGraph, checkoutFile);

    expect(packageImpact.imports.totalCount).toBe(2);
    expect(packageImpact.imports.items).toHaveLength(1);
    expect(packageImpact.importedBy.totalCount).toBe(2);
    expect(packageImpact.importedBy.items).toHaveLength(1);
    expect(packageImpact.semanticRelationships.totalCount).toBe(1);
    expect(packageImpact.semanticRelationships.items[0]?.node.id).toBe("symbol:packages-utils");
    expect(checkoutImpact.linkedEvidence.items.map((item) => item.node.id)).toContain("task:checkout-status-panel");
  });

  it("builds bounded Code Map impact path previews", () => {
    const productGraph = makeClusteredCodeMapProductGraph();
    const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
    const packageAppFile = nodesById.get("file:packages-app")!;
    const checkoutFile = nodesById.get("file:src-checkout")!;
    const packagePreview = buildCodeMapImpactPathPreview(productGraph, packageAppFile, 1);
    const checkoutPreview = buildCodeMapImpactPathPreview(productGraph, checkoutFile);

    expect(packagePreview.downstreamFiles.totalCount).toBe(2);
    expect(packagePreview.downstreamFiles.items).toHaveLength(1);
    expect(packagePreview.upstreamFiles.totalCount).toBe(2);
    expect(packagePreview.upstreamFiles.items).toHaveLength(1);
    expect(checkoutPreview.linkedEvidence.items.map((item) => item.node.id)).toContain("task:checkout-status-panel");
  });

  it("builds community architecture explorer slices without graph bloat", () => {
    const productGraph = makeClusteredCodeMapProductGraph();
    const explorer = buildCodeMapExplorerView(
      productGraph,
      { mode: "community", communityNodeId: "community:packages" },
      2
    );

    expect(explorer).not.toBeNull();
    expect(explorer?.title).toBe("Community: packages");
    expect(explorer?.focusNodeId).toBe("community:packages");
    expect(explorer?.nodeIds.has("community:packages")).toBe(true);
    expect(explorer?.nodeIds.has("file:packages-app")).toBe(true);
    expect(explorer?.nodeIds.has("symbol:packages-app")).toBe(true);
    expect(explorer?.edgeIds.has("edge-packages-community-1")).toBe(true);
    expect(explorer?.edgeIds.has("edge-packages-app-utils")).toBe(true);
    expect(explorer?.itemNodes.map((node) => node.id)).toEqual(["file:packages-app", "file:packages-format"]);
    expect(explorer?.hiddenItemCount).toBe(1);
  });

  it("caps large architecture explorer node sets while reporting hidden nodes", () => {
    const productGraph = makeClusteredCodeMapProductGraph();
    const extraFiles: ProductGraphProjection["nodes"] = Array.from(
      { length: CODE_MAP_EXPLORER_RENDER_NODE_LIMIT + 20 },
      (_, index) => ({
        id: `file:large-community-${index + 1}`,
        kind: "code_file",
        title: `packages/large-${index + 1}.ts`,
        status: "planned",
        tags: ["code-scan"],
        source: {
          kind: "code_scan",
          label: "Codebase scan",
          path: `packages/large-${index + 1}.ts`,
        },
        metadata: {
          scannerSourceFile: `packages/large-${index + 1}.ts`,
        },
        createdAt: "2026-05-12T00:13:00.000Z",
        updatedAt: "2026-05-12T00:13:00.000Z",
        incomingEdgeIds: [],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      })
    );
    const extraMembershipEdges: ProductGraphProjection["edges"] = extraFiles.map((file, index) => ({
      id: `edge-large-community-${index + 1}`,
      sourceNodeId: file.id,
      targetNodeId: "community:packages",
      kind: "belongs_to",
      label: "File belongs to module",
      trust: "extracted",
      metadata: {
        scannerRelation: "module_membership",
      },
      createdAt: "2026-05-12T00:13:30.000Z",
      updatedAt: "2026-05-12T00:13:30.000Z",
    }));
    const largeGraph = {
      ...productGraph,
      nodes: [...extraFiles, ...productGraph.nodes],
      edges: [...extraMembershipEdges, ...productGraph.edges],
      summary: {
        ...productGraph.summary,
        nodeCount: productGraph.summary.nodeCount + extraFiles.length,
        edgeCount: productGraph.summary.edgeCount + extraMembershipEdges.length,
        nodesByKind: {
          ...productGraph.summary.nodesByKind,
          code_file: (productGraph.summary.nodesByKind.code_file ?? 0) + extraFiles.length,
        },
        edgesByKind: {
          ...productGraph.summary.edgesByKind,
          belongs_to: (productGraph.summary.edgesByKind.belongs_to ?? 0) + extraMembershipEdges.length,
        },
      },
    } satisfies ProductGraphProjection;

    const explorer = buildCodeMapExplorerView(largeGraph, { mode: "community", communityNodeId: "community:packages" });

    expect(explorer?.nodeIds.size).toBeLessThanOrEqual(CODE_MAP_EXPLORER_RENDER_NODE_LIMIT);
    expect(explorer?.hiddenNodeCount).toBeGreaterThan(0);
    expect(explorer?.hiddenItemCount).toBeGreaterThan(0);
  });

  it("opens and exits community architecture explorer through button interactions", () => {
    const renderer = renderInteractiveProductGraph(makeClusteredCodeMapProductGraph());

    expect(renderer.root.findAllByProps({ "aria-label": "Architecture explorer" })).toHaveLength(0);

    clickByAriaLabel(renderer, "Explore packages community group");

    expect(renderer.root.findAllByProps({ "aria-label": "Architecture explorer" })).toHaveLength(1);
    expect(renderer.root.findByProps({ "aria-label": "Architecture explorer nodes" })).toBeTruthy();
    expect(renderer.root.findByProps({ "aria-label": "Focus packages/app.ts architecture explorer node" })).toBeTruthy();

    clickByAriaLabel(renderer, "Exit architecture explorer");

    expect(renderer.root.findAllByProps({ "aria-label": "Architecture explorer" })).toHaveLength(0);
  });

  it("detects Code Map dependency cycles without duplicate rotations", () => {
    const productGraph = makeArchitectureHealthCodeMapProductGraph();
    const cycles = detectCodeMapDependencyCycles(productGraph);

    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0]?.nodeIds)).toEqual(new Set(["file:cycle-a", "file:cycle-b", "file:cycle-c"]));
    expect(cycles[0]?.edgeIds).toHaveLength(3);
  });

  it("caps dense acyclic dependency cycle searches before path explosion", () => {
    const denseFiles: ProductGraphProjection["nodes"] = Array.from({ length: 32 }, (_, index) => ({
      id: `file:dense-${index + 1}`,
      kind: "code_file",
      title: `src/dense-${index + 1}.ts`,
      status: "planned",
      tags: ["code-scan"],
      source: { kind: "code_scan", label: "Codebase scan", path: `src/dense-${index + 1}.ts` },
      metadata: { scannerSourceFile: `src/dense-${index + 1}.ts` },
      createdAt: "2026-05-12T00:14:00.000Z",
      updatedAt: "2026-05-12T00:14:00.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    }));
    const denseEdges: ProductGraphProjection["edges"] = denseFiles.flatMap((sourceFile, sourceIndex) =>
      denseFiles.slice(sourceIndex + 1).map((targetFile, targetOffset) => ({
        id: `edge-dense-${sourceIndex + 1}-${sourceIndex + targetOffset + 2}`,
        sourceNodeId: sourceFile.id,
        targetNodeId: targetFile.id,
        kind: "depends_on",
        label: "File imports file",
        trust: "extracted",
        metadata: {
          scannerRelation: "module_dependency",
          scannerResolution: "semantic",
          scannerSourceFile: sourceFile.title,
          scannerTargetFile: targetFile.title,
        },
        createdAt: "2026-05-12T00:14:30.000Z",
        updatedAt: "2026-05-12T00:14:30.000Z",
      }))
    );
    const denseGraph = {
      schemaVersion: "1",
      productGraphId: "default",
      nodes: denseFiles,
      edges: denseEdges,
      events: [],
      summary: {
        nodeCount: denseFiles.length,
        edgeCount: denseEdges.length,
        nodesByKind: { code_file: denseFiles.length },
        edgesByKind: { depends_on: denseEdges.length },
        unresolvedOpenQuestionCount: 0,
        blockedTaskCount: 0,
      },
    } satisfies ProductGraphProjection;
    const health = buildCodeMapArchitectureHealth(denseGraph, summarizeProductGraphCodeScanFreshness(denseGraph));
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={denseGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(detectCodeMapDependencyCycles(denseGraph)).toEqual([]);
    expect(health.dependencyCycleCount).toBe(0);
    expect(health.hasMoreDependencyCycles).toBe(false);
    expect(health.dependencyCycleSearchLimited).toBe(true);
    expect(markup).toContain("Limited");
    expect(markup).toContain("Cycle search reached the safety limit before finding a cycle.");
    expect(markup).not.toContain("0+");
  });

  it("builds cycle architecture explorer node and edge sets", () => {
    const productGraph = makeArchitectureHealthCodeMapProductGraph();
    const explorer = buildCodeMapExplorerView(productGraph, { mode: "cycle", cycleIndex: 0 });

    expect(explorer).not.toBeNull();
    expect(explorer?.title).toBe("Dependency cycle");
    expect(new Set(explorer?.nodeIds)).toEqual(new Set(["file:cycle-a", "file:cycle-b", "file:cycle-c"]));
    expect(new Set(explorer?.edgeIds)).toEqual(new Set(["edge-cycle-a-b", "edge-cycle-b-c", "edge-cycle-c-a"]));
    expect(new Set(explorer?.highlightedNodeIds)).toEqual(new Set(["file:cycle-a", "file:cycle-b", "file:cycle-c"]));
    expect(explorer?.hiddenItemCount).toBe(0);
  });

  it("builds orphan, external, and unresolved architecture explorer drilldowns", () => {
    const productGraph = makeArchitectureHealthCodeMapProductGraph();
    const orphanExplorer = buildCodeMapExplorerView(productGraph, { mode: "orphans" });
    const externalExplorer = buildCodeMapExplorerView(productGraph, { mode: "external" });
    const unresolvedExplorer = buildCodeMapExplorerView(productGraph, { mode: "unresolved" });

    expect(orphanExplorer?.itemNodes.map((node) => node.id)).toEqual(["file:orphan"]);
    expect(orphanExplorer?.highlightedNodeIds.has("file:orphan")).toBe(true);
    expect(externalExplorer?.itemNodes.map((node) => node.id)).toContain("file:external");
    expect(externalExplorer?.itemNodes.map((node) => node.id)).toContain("file:src-checkout");
    expect(externalExplorer?.highlightedNodeIds.has("file:external")).toBe(true);
    expect(unresolvedExplorer?.itemNodes.map((node) => node.id)).toEqual(["file:unresolved"]);
    expect(unresolvedExplorer?.highlightedNodeIds.has("file:unresolved")).toBe(true);
  });

  it("builds architecture explorer slices without mutating normal filter targets", () => {
    const productGraph = makeArchitectureHealthCodeMapProductGraph();
    const freshness = summarizeProductGraphCodeScanFreshness(productGraph);
    const normalCycleIds = buildCodeMapQuickFilterNodeIds(productGraph, "cycles", freshness);

    buildCodeMapExplorerView(productGraph, { mode: "cycle", cycleIndex: 0 });

    expect([...buildCodeMapQuickFilterNodeIds(productGraph, "cycles", freshness)]).toEqual([...normalCycleIds]);
  });

  it("preserves active quick filters when entering and exiting architecture explorer", () => {
    const renderer = renderInteractiveProductGraph(makeArchitectureHealthCodeMapProductGraph());
    const semanticFilterButton = () =>
      renderer.root.findByProps({ "aria-label": "Show Semantic symbol links Code Map focus" });

    clickByAriaLabel(renderer, "Show Semantic symbol links Code Map focus");
    expect(semanticFilterButton().props.style.background).toBe("#1e3a5f");

    clickByAriaLabel(renderer, "Drill into Dependency cycles Code Map health");

    expect(renderer.root.findAllByProps({ "aria-label": "Architecture explorer" })).toHaveLength(1);
    expect(semanticFilterButton().props.style.background).toBe("#1e3a5f");

    clickByAriaLabel(renderer, "Exit architecture explorer");

    expect(renderer.root.findAllByProps({ "aria-label": "Architecture explorer" })).toHaveLength(0);
    expect(semanticFilterButton().props.style.background).toBe("#1e3a5f");
  });

  it("shows a clear empty state for task lenses with no scanned files", () => {
    const baseGraph = makeTaskScopeCodeMapProductGraph("backend-only");
    const productNode = makeProductGraph().nodes[0]!;
    const productGraph: ProductGraphProjection = {
      ...baseGraph,
      nodes: [productNode, ...baseGraph.nodes],
      summary: {
        ...baseGraph.summary,
        nodeCount: baseGraph.summary.nodeCount + 1,
        nodesByKind: {
          ...baseGraph.summary.nodesByKind,
          [productNode.kind]: (baseGraph.summary.nodesByKind[productNode.kind] ?? 0) + 1,
        },
      },
    };
    const renderer = renderInteractiveProductGraph(productGraph);

    clickByAriaLabel(renderer, "Show Frontend task lens");

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain("No scanned files matched the Frontend task lens.");
    expect(rendered).toContain(productNode.title);
  });

  it("keeps runtime source visible in the Backend/runtime task lens", () => {
    const renderer = renderInteractiveProductGraph(makeTaskScopeCodeMapProductGraph());

    clickByAriaLabel(renderer, "Show Backend/runtime task lens");

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain("packages/backend/src/runtime.ts");
    expect(rendered).not.toContain("No scanned files matched the Backend/runtime task lens.");
  });

  it("detects self-dependency cycles and reports bounded cycle overflow", () => {
    const productGraph = makeArchitectureHealthCodeMapProductGraph();
    const extraFiles: ProductGraphProjection["nodes"] = Array.from({ length: 6 }, (_, index) => ({
      id: `file:self-cycle-${index + 1}`,
      kind: "code_file",
      title: `src/self-cycle-${index + 1}.ts`,
      status: "planned",
      tags: ["code-scan"],
      source: { kind: "code_scan", label: "Codebase scan", path: `src/self-cycle-${index + 1}.ts` },
      metadata: { scannerSourceFile: `src/self-cycle-${index + 1}.ts` },
      createdAt: `2026-05-12T00:12:0${index}.000Z`,
      updatedAt: `2026-05-12T00:12:0${index}.000Z`,
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    }));
    const selfEdges: ProductGraphProjection["edges"] = extraFiles.map((node, index) => ({
      id: `edge-self-cycle-${index + 1}`,
      sourceNodeId: node.id,
      targetNodeId: node.id,
      kind: "depends_on",
      label: "File imports file",
      trust: "extracted",
      metadata: {
        scannerRelation: "module_dependency",
        scannerResolution: "semantic",
        scannerSourceFile: node.title,
        scannerTargetFile: node.title,
      },
      createdAt: `2026-05-12T00:12:1${index}.000Z`,
      updatedAt: `2026-05-12T00:12:1${index}.000Z`,
    }));
    const overflowGraph = {
      ...productGraph,
      nodes: [...extraFiles, ...productGraph.nodes],
      edges: [...selfEdges, ...productGraph.edges],
      summary: {
        ...productGraph.summary,
        nodeCount: productGraph.summary.nodeCount + extraFiles.length,
        edgeCount: productGraph.summary.edgeCount + selfEdges.length,
        nodesByKind: {
          ...productGraph.summary.nodesByKind,
          code_file: (productGraph.summary.nodesByKind.code_file ?? 0) + extraFiles.length,
        },
        edgesByKind: {
          ...productGraph.summary.edgesByKind,
          depends_on: (productGraph.summary.edgesByKind.depends_on ?? 0) + selfEdges.length,
        },
      },
    } satisfies ProductGraphProjection;
    const cycles = detectCodeMapDependencyCycles(overflowGraph);
    const health = buildCodeMapArchitectureHealth(overflowGraph, summarizeProductGraphCodeScanFreshness(overflowGraph));
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={overflowGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(cycles.length).toBeLessThanOrEqual(5);
    expect(cycles.some((cycle) => cycle.nodeIds.length === 1 && cycle.nodeIds[0] === "file:self-cycle-1")).toBe(true);
    expect(health.dependencyCycleCount).toBe(5);
    expect(health.hasMoreDependencyCycles).toBe(true);
    expect(health.dependencyCycleSearchLimited).toBe(false);
    expect(markup).toContain("5+");
  });

  it("builds conservative Code Map architecture health counts", () => {
    const productGraph = makeArchitectureHealthCodeMapProductGraph();
    const health = buildCodeMapArchitectureHealth(productGraph, summarizeProductGraphCodeScanFreshness(productGraph));

    expect(health.dependencyCycleCount).toBe(1);
    expect(health.unresolvedFileCount).toBe(1);
    expect(health.unresolvedFiles.map((node) => node.id)).toEqual(["file:unresolved"]);
    expect(health.externalFileCount).toBe(2);
    expect(health.externalFiles.map((node) => node.id)).toContain("file:external");
    expect(health.orphanFileCount).toBe(1);
    expect(health.orphanFiles.map((node) => node.id)).toEqual(["file:orphan"]);
  });

  it("builds orphan drilldown ids without depending on cycle analysis", () => {
    const productGraph = makeArchitectureHealthCodeMapProductGraph();
    const freshness = summarizeProductGraphCodeScanFreshness(productGraph);
    const orphanSummary = findCodeMapOrphanFiles(productGraph, Number.POSITIVE_INFINITY);
    const orphanIds = buildCodeMapQuickFilterNodeIds(productGraph, "orphans", freshness);

    expect(orphanSummary).toMatchObject({
      orphanFileCount: 1,
      orphanFiles: [expect.objectContaining({ id: "file:orphan" })],
    });
    expect([...orphanIds]).toEqual(["file:orphan"]);
  });

  it("builds relation quick filter target sets without mutating normal filters", () => {
    const productGraph = makeClusteredCodeMapProductGraph();
    const freshness = summarizeProductGraphCodeScanFreshness(productGraph);
    const staleGraph = makeRunTouchedCodeMapProductGraph("stale");
    const staleFreshness = summarizeProductGraphCodeScanFreshness(staleGraph);
    const healthGraph = makeArchitectureHealthCodeMapProductGraph();
    const healthFreshness = summarizeProductGraphCodeScanFreshness(healthGraph);
    const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
    const semanticOnlyFile: ProductGraphProjection["nodes"][number] = {
      id: "file:semantic-only",
      kind: "code_file",
      title: "packages/semantic-only.ts",
      status: "planned",
      tags: ["code-scan"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/semantic-only.ts",
      },
      metadata: {
        scannerSourceFile: "packages/semantic-only.ts",
      },
      createdAt: "2026-05-12T00:09:00.000Z",
      updatedAt: "2026-05-12T00:09:00.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    };
    const semanticOnlySymbol: ProductGraphProjection["nodes"][number] = {
      id: "symbol:semantic-only",
      kind: "code_symbol",
      title: "semanticOnly",
      status: "planned",
      tags: ["code-scan"],
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/semantic-only.ts",
        line: 3,
      },
      metadata: {
        scannerSourceFile: "packages/semantic-only.ts",
        scannerSymbolName: "semanticOnly",
        scannerSymbolKind: "function",
      },
      createdAt: "2026-05-12T00:09:10.000Z",
      updatedAt: "2026-05-12T00:09:10.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    };
    const semanticOnlyGraph: ProductGraphProjection = {
      ...productGraph,
      nodes: [...productGraph.nodes, semanticOnlyFile, semanticOnlySymbol],
      edges: [
        ...productGraph.edges,
        {
          id: "edge-semantic-only-symbol-file",
          sourceNodeId: "symbol:semantic-only",
          targetNodeId: "file:semantic-only",
          kind: "belongs_to",
          label: "Symbol belongs to file",
          trust: "extracted",
          createdAt: "2026-05-12T00:09:20.000Z",
          updatedAt: "2026-05-12T00:09:20.000Z",
        },
        {
          id: "edge-semantic-only-uses",
          sourceNodeId: "symbol:packages-app",
          targetNodeId: "symbol:semantic-only",
          kind: "uses",
          label: "Symbol uses symbol",
          trust: "extracted",
          metadata: {
            scannerRelation: "symbol_uses",
            scannerResolution: "semantic",
            scannerSourceFile: "packages/app.ts",
            scannerTargetFile: "packages/semantic-only.ts",
            scannerSourceSymbol: "createApp",
            scannerTargetSymbol: "semanticOnly",
          },
          createdAt: "2026-05-12T00:09:30.000Z",
          updatedAt: "2026-05-12T00:09:30.000Z",
        },
      ],
    };
    const dependencyIds = buildCodeMapQuickFilterNodeIds(productGraph, "dependencies", freshness);
    const semanticIds = buildCodeMapQuickFilterNodeIds(productGraph, "semantic", freshness);
    const externalIds = buildCodeMapQuickFilterNodeIds(productGraph, "external", freshness);
    const cycleIds = buildCodeMapQuickFilterNodeIds(healthGraph, "cycles", healthFreshness);
    const unresolvedIds = buildCodeMapQuickFilterNodeIds(healthGraph, "unresolved", healthFreshness);
    const orphanIds = buildCodeMapQuickFilterNodeIds(healthGraph, "orphans", healthFreshness);
    const staleIds = buildCodeMapQuickFilterNodeIds(staleGraph, "freshness", staleFreshness);
    const semanticOnlyDependencyIds = buildCodeMapQuickFilterNodeIds(
      semanticOnlyGraph,
      "dependencies",
      summarizeProductGraphCodeScanFreshness(semanticOnlyGraph)
    );
    const semanticOnlySemanticIds = buildCodeMapQuickFilterNodeIds(
      semanticOnlyGraph,
      "semantic",
      summarizeProductGraphCodeScanFreshness(semanticOnlyGraph)
    );

    expect(dependencyIds.has("file:packages-app")).toBe(true);
    expect(dependencyIds.has("community:packages")).toBe(true);
    expect(semanticIds.has("symbol:packages-app")).toBe(true);
    expect(semanticIds.has("symbol:packages-utils")).toBe(true);
    expect(semanticOnlyDependencyIds.has("file:semantic-only")).toBe(false);
    expect(semanticOnlyDependencyIds.has("symbol:semantic-only")).toBe(false);
    expect(semanticOnlySemanticIds.has("symbol:semantic-only")).toBe(true);
    expect(externalIds.has("file:packages-app")).toBe(true);
    expect(externalIds.has("community:packages")).toBe(true);
    expect(cycleIds.has("file:cycle-a")).toBe(true);
    expect(cycleIds.has("file:cycle-b")).toBe(true);
    expect(cycleIds.has("file:cycle-c")).toBe(true);
    expect(unresolvedIds.has("file:unresolved")).toBe(true);
    expect(unresolvedIds.has("file:external")).toBe(false);
    expect(orphanIds.has("file:orphan")).toBe(true);
    expect(orphanIds.has("file:unresolved")).toBe(false);
    expect([...staleIds]).toContain("file:src-checkout");
    expect(codeMapQuickFilterAllowsNode(nodesById.get("file:packages-app")!, "dependencies", dependencyIds)).toBe(true);
    expect(codeMapQuickFilterAllowsNode(nodesById.get("task:checkout-status-panel")!, "dependencies", dependencyIds)).toBe(false);
  });

  it("clears quick-filter mode when focusing a Code Map hotspot", () => {
    const productGraph = makeClusteredCodeMapProductGraph();
    const hotspot = buildCodeMapDependencyHotspots(productGraph)[0]!;
    const semanticIds = buildCodeMapQuickFilterNodeIds(
      productGraph,
      "semantic",
      summarizeProductGraphCodeScanFreshness(productGraph)
    );
    const visibleWithSemanticQuickFilter = productGraph.nodes.filter((node) =>
      codeMapQuickFilterAllowsNode(node, "semantic", semanticIds)
    );
    const focusState = productGraphFocusStateForNode(hotspot.node);
    const visibleWithNormalFilters = productGraph.nodes.filter((node) =>
      codeMapFilterAllowsNode(node, {
        files: true,
        symbols: true,
        communities: true,
        dependencyEdges: true,
        semanticEdges: true,
      })
    );

    expect(selectProductGraphNode(visibleWithSemanticQuickFilter, hotspot.node.id)?.id).not.toBe(hotspot.node.id);
    expect(focusState).toMatchObject({
      selectedNodeId: hotspot.node.id,
      codeMapQuickFilter: "all",
    });
    expect(selectProductGraphNode(visibleWithNormalFilters, focusState.selectedNodeId)?.id).toBe(hotspot.node.id);
  });

  it("renders empty Code Map and no-hotspot fallback states", () => {
    const emptyMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );
    const productGraph = makeCodeMapProductGraph();
    const noHotspotGraph = {
      ...productGraph,
      edges: productGraph.edges.filter((edge) => !isDependencyCodeEdge(edge) && !isSemanticCodeEdge(edge)),
    } satisfies ProductGraphProjection;
    const noHotspotMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={noHotspotGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(emptyMarkup).toContain('aria-label="Code map empty state"');
    expect(emptyMarkup).toContain("No Code Map data yet.");
    expect(emptyMarkup).toContain("Ask an operator/admin to refresh the native Product Graph code map.");
    expect(noHotspotMarkup).toContain("No hotspots yet.");
    expect(noHotspotMarkup).not.toContain("SOURCE BODY SHOULD NOT RENDER");
  });

  it("renders selected community details with member files", () => {
    const productGraph = makeCodeMapProductGraph();
    const communityNode = productGraph.nodes.find((node) => node.id === "community:src")!;
    const communityFirstGraph = {
      ...productGraph,
      nodes: [communityNode, ...productGraph.nodes.filter((node) => node.id !== communityNode.id)],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={communityFirstGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(markup).toContain("Code map details");
    expect(markup).toContain("Community files");
    expect(markup).toContain("src/checkout.ts, src/format.ts");
    expect(markup).toContain('aria-label="Focus src/checkout.ts community file"');
    expect(markup).toContain('aria-label="Focus src/format.ts community file"');
  });

  it("renders selected file dependency metadata and relationship details", () => {
    const productGraph = makeCodeMapProductGraph();
    const fileNode = productGraph.nodes.find((node) => node.id === "file:src-checkout")!;
    const fileFirstGraph = {
      ...productGraph,
      nodes: [fileNode, ...productGraph.nodes.filter((node) => node.id !== fileNode.id)],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={fileFirstGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(markup).toContain("Imports");
    expect(markup).toContain("Resolved");
    expect(markup).toContain("External packages");
    expect(markup).toContain("react");
    expect(markup).toContain('aria-label="Code file dependencies"');
    expect(markup).toContain("File dependencies");
    expect(markup).toContain("File imports file");
    expect(markup).toContain("./format");
    expect(markup).not.toContain("SOURCE BODY SHOULD NOT RENDER");
  });

  it("renders selected code impact panel with overflow copy", () => {
    const productGraph = makeImpactOverflowCodeMapProductGraph();
    const fileNode = productGraph.nodes.find((node) => node.id === "file:packages-app")!;
    const fileFirstGraph = {
      ...productGraph,
      nodes: [fileNode, ...productGraph.nodes.filter((node) => node.id !== fileNode.id)],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={fileFirstGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(markup).toContain('aria-label="Impact path preview"');
    expect(markup).toContain('aria-label="Downstream files path preview"');
    expect(markup).toContain('aria-label="Focus packages/overflow-1.ts Downstream files path item"');
    expect(markup).toContain('aria-label="Code impact panel"');
    expect(markup).toContain('aria-label="Direct imports impact"');
    expect(markup).toContain('aria-label="Direct imported by impact"');
    expect(markup).toContain('aria-label="Semantic relationships impact"');
    expect(markup).toContain('aria-label="Linked product evidence impact"');
    expect(markup).toContain('aria-label="Focus packages/overflow-1.ts Direct imports impact"');
    expect(markup).toContain("+1 more");
    expect(markup).not.toContain("SOURCE BODY SHOULD NOT RENDER");
  });

  it("renders architecture health cards with conservative drilldowns", () => {
    const productGraph = makeArchitectureHealthCodeMapProductGraph();
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(markup).toContain('aria-label="Code map architecture health"');
    expect(markup).toContain('aria-label="Drill into Dependency cycles Code Map health"');
    expect(markup).toContain('aria-label="Drill into Unresolved dependencies Code Map health"');
    expect(markup).toContain('aria-label="Drill into External packages Code Map health"');
    expect(markup).toContain('aria-label="Drill into Orphan files Code Map health"');
    expect(markup).toContain('aria-label="Drill into Stale/missing map Code Map health"');
    expect(markup).toContain("src/cycle-a.ts -&gt; src/cycle-b.ts -&gt; src/cycle-c.ts");
    expect(markup).toContain("src/unresolved.ts");
    expect(markup).toContain("src/external.ts");
    expect(markup).toContain("src/orphan.ts");
    expect(markup).not.toContain("SOURCE BODY SHOULD NOT RENDER");
  });

  it("maps selected tasks to likely Codebase scan code areas", () => {
    const productGraph = makeCodeMapProductGraph();
    const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
    const taskNode = nodesById.get("task:checkout-status-panel")!;

    const codeAreas = findLikelyCodeAreasForTask(taskNode, productGraph.edges, nodesById);

    expect(codeAreas.map(({ node, edge }) => [node.id, edge.kind, edge.trust])).toEqual([
      ["symbol:checkout-controller", "touches", "ambiguous"],
    ]);
    expect(findLikelyCodeAreasForTask(nodesById.get("symbol:checkout-controller")!, productGraph.edges, nodesById)).toEqual([]);
  });

  it("maps selected tasks to linked run file evidence", () => {
    const productGraph = makeLinkedRunFilesProductGraph();
    const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
    const taskNode = nodesById.get("task:checkout-status-panel")!;

    const linkedFiles = findLinkedRunFilesForTask(taskNode, productGraph.edges, nodesById);

    expect(linkedFiles.map(({ node, edge, runNode }) => [node.id, edge.kind, runNode.id])).toEqual([
      ["file:checkout-status", "touches", "run:checkout-proof"],
    ]);
    expect(findLinkedRunFilesForTask(nodesById.get("run:checkout-proof")!, productGraph.edges, nodesById)).toEqual([]);
  });

  it("prioritizes trace relationship labels that lead back to the trace root", () => {
    const taskNode: ProductGraphProjection["nodes"][number] = {
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
      status: "planned",
      createdAt: "2026-05-12T00:01:30.000Z",
      updatedAt: "2026-05-12T00:01:30.000Z",
      incomingEdgeIds: ["edge-codex-plan-task"],
      outgoingEdgeIds: ["edge-task-run"],
      blockedByNodeIds: [],
    };
    const planNode: ProductGraphProjection["nodes"][number] = {
      id: "plan:codex:checkout-status-panel",
      kind: "plan",
      title: "Codex plan for Wire checkout status panel",
      status: "planned",
      createdAt: "2026-05-12T00:12:00.000Z",
      updatedAt: "2026-05-12T00:12:00.000Z",
      incomingEdgeIds: ["edge-run-codex-plan"],
      outgoingEdgeIds: ["edge-codex-plan-task"],
      blockedByNodeIds: [],
    };
    const runNode: ProductGraphProjection["nodes"][number] = {
      id: "run:checkout-proof",
      kind: "agent_run",
      title: "Checkout proof run",
      status: "completed",
      createdAt: "2026-05-12T00:13:00.000Z",
      updatedAt: "2026-05-12T00:13:00.000Z",
      incomingEdgeIds: ["edge-task-run"],
      outgoingEdgeIds: ["edge-run-codex-plan", "edge-run-file"],
      blockedByNodeIds: [],
    };
    const fileNode: ProductGraphProjection["nodes"][number] = {
      id: "file:checkout-status",
      kind: "code_file",
      title: "packages/frontend/src/CheckoutStatus.tsx",
      status: "completed",
      createdAt: "2026-05-12T00:14:00.000Z",
      updatedAt: "2026-05-12T00:14:00.000Z",
      incomingEdgeIds: ["edge-run-file"],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    };
    const trace: ProductGraphTrace = {
      schemaVersion: "1",
      productGraphId: "default",
      rootNode: taskNode,
      nodes: [taskNode, runNode, planNode, fileNode],
      edges: [
        {
          id: "edge-run-file",
          sourceNodeId: runNode.id,
          targetNodeId: fileNode.id,
          kind: "touches",
          trust: "manual",
          label: "Run changed file",
          createdAt: "2026-05-12T00:14:00.000Z",
          updatedAt: "2026-05-12T00:14:00.000Z",
        },
        {
          id: "edge-run-codex-plan",
          sourceNodeId: runNode.id,
          targetNodeId: planNode.id,
          kind: "derived_from",
          trust: "manual",
          label: "Run derived from plan",
          createdAt: "2026-05-12T00:13:00.000Z",
          updatedAt: "2026-05-12T00:13:00.000Z",
        },
        {
          id: "edge-codex-plan-task",
          sourceNodeId: planNode.id,
          targetNodeId: taskNode.id,
          kind: "derived_from",
          trust: "manual",
          label: "Plan derived from task",
          createdAt: "2026-05-12T00:12:00.000Z",
          updatedAt: "2026-05-12T00:12:00.000Z",
        },
        {
          id: "edge-task-run",
          sourceNodeId: taskNode.id,
          targetNodeId: runNode.id,
          kind: "produced_by",
          trust: "manual",
          label: "Task produced by run",
          createdAt: "2026-05-12T00:13:00.000Z",
          updatedAt: "2026-05-12T00:13:00.000Z",
        },
      ],
      hopsByNodeId: {
        [taskNode.id]: 0,
        [runNode.id]: 1,
        [planNode.id]: 1,
        [fileNode.id]: 2,
      },
      summary: {
        nodeCount: 4,
        edgeCount: 4,
        maxDepth: 2,
        codeNodeCount: 1,
        testResultNodeCount: 0,
        evidenceNodeCount: 0,
      },
    };

    expect(traceRelationshipLabelsForNode(trace, runNode.id)).toEqual([
      "Task produced by run",
      "Run derived from plan",
      "Run changed file",
    ]);
  });

  it("maps selected plans to unique linked run results only", () => {
    const productGraph = makeAcceptedCodexPlanRunLinkedProductGraph();
    const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
    const planNode = nodesById.get("plan:codex:checkout-status-panel")!;
    const taskNode = nodesById.get("task:checkout-status-panel")!;
    const duplicateRunPlanEdge = {
      ...productGraph.edges.find((edge) => edge.id === "edge-run-codex-plan-checkout-status-panel")!,
      id: "edge-run-codex-plan-checkout-status-panel-duplicate",
    };
    const nonRunPlanEdge: ProductGraphProjection["edges"][number] = {
      id: "edge-task-codex-plan-checkout-status-panel",
      sourceNodeId: taskNode.id,
      targetNodeId: planNode.id,
      kind: "derived_from",
      trust: "manual",
      label: "Task derived from plan",
      createdAt: "2026-05-12T00:14:00.000Z",
      updatedAt: "2026-05-12T00:14:00.000Z",
    };
    const unrelatedPlanEdge: ProductGraphProjection["edges"][number] = {
      id: "edge-run-unrelated-plan",
      sourceNodeId: "run:checkout-proof",
      targetNodeId: "plan:unrelated",
      kind: "derived_from",
      trust: "manual",
      label: "Run derived from unrelated plan",
      createdAt: "2026-05-12T00:14:00.000Z",
      updatedAt: "2026-05-12T00:14:00.000Z",
    };

    const linkedRuns = findRunsDerivedFromPlan(
      planNode,
      [...productGraph.edges, duplicateRunPlanEdge, nonRunPlanEdge, unrelatedPlanEdge],
      nodesById
    );

    expect(linkedRuns.map(({ node, edge }) => [node.id, edge.id])).toEqual([
      ["run:checkout-proof", "edge-run-codex-plan-checkout-status-panel"],
    ]);
    expect(findRunsDerivedFromPlan(taskNode, productGraph.edges, nodesById)).toEqual([]);
  });

  it("keeps frontend drift fixtures aligned with shared Product Graph helpers", () => {
    const unlinkedProductGraph = withCheckoutTaskStatus(makeProductGraph(), "completed");
    const unlinkedNodesById = new Map(unlinkedProductGraph.nodes.map((node) => [node.id, node]));
    const unlinkedTaskNode = unlinkedNodesById.get("task:checkout-status-panel")!;
    const linkedProductGraph = withCheckoutTaskStatus(makeLinkedRunFilesProductGraph(), "completed");
    const linkedNodesById = new Map(linkedProductGraph.nodes.map((node) => [node.id, node]));
    const linkedTaskNode = linkedNodesById.get("task:checkout-status-panel")!;
    const runWithoutEvidenceProductGraph = withCheckoutTaskStatus(makeLinkedRunWithoutEvidenceProductGraph(), "completed");
    const runWithoutEvidenceNodesById = new Map(runWithoutEvidenceProductGraph.nodes.map((node) => [node.id, node]));
    const runWithoutEvidenceTaskNode = runWithoutEvidenceNodesById.get("task:checkout-status-panel")!;
    const runWithoutTestEvidenceProductGraph = withCheckoutTaskStatus(makeLinkedRunWithoutTestEvidenceProductGraph(), "completed");
    const codeIntentDriftProductGraph = withCheckoutTaskStatus(makeLinkedRunFilesProductGraph(), "completed");
    const codeIntentBackedProductGraph = withCheckoutTaskStatus(makeLinkedRunWithProductIntentGraph(), "completed");
    const plannedProductGraph = makeProductGraph();
    const plannedNodesById = new Map(plannedProductGraph.nodes.map((node) => [node.id, node]));
    const overflowProductGraph = makeOverflowExecutionDriftProductGraph();
    const overflowTestEvidenceProductGraph = makeOverflowTestEvidenceProductGraph();
    const overflowCodeIntentProductGraph = makeOverflowCodeIntentDriftProductGraph();
    const missingCodeMapProductGraph = withCheckoutTaskStatus(makeLinkedRunFilesProductGraph(), "completed");
    const freshCodeMapProductGraph = makeRunTouchedCodeMapProductGraph("fresh");
    const staleCodeMapProductGraph = makeRunTouchedCodeMapProductGraph("stale");

    expect(summarizeProductGraphTaskExecutionEvidence({ projection: unlinkedProductGraph, taskNodeId: unlinkedTaskNode.id })).toEqual({
      linkedRunCount: 0,
      linkedEvidenceCount: 0,
      linkedFileCount: 0,
      hasLinkedRunDrift: true,
      hasLinkedEvidenceDrift: true,
      hasDrift: true,
    });
    expect(
      summarizeProductGraphTaskExecutionEvidence({
        projection: runWithoutEvidenceProductGraph,
        taskNodeId: runWithoutEvidenceTaskNode.id,
      })
    ).toEqual({
      linkedRunCount: 1,
      linkedEvidenceCount: 0,
      linkedFileCount: 1,
      hasLinkedRunDrift: false,
      hasLinkedEvidenceDrift: true,
      hasDrift: true,
    });
    expect(summarizeProductGraphTaskExecutionEvidence({ projection: linkedProductGraph, taskNodeId: linkedTaskNode.id })).toEqual({
      linkedRunCount: 1,
      linkedEvidenceCount: 1,
      linkedFileCount: 1,
      hasLinkedRunDrift: false,
      hasLinkedEvidenceDrift: false,
      hasDrift: false,
    });
    expect(
      summarizeProductGraphTaskExecutionEvidence({
        projection: plannedProductGraph,
        taskNodeId: plannedNodesById.get("task:checkout-status-panel")!.id,
      })
    ).toBeUndefined();
    expect(summarizeProductGraphExecutionDrift(unlinkedProductGraph)).toMatchObject({
      completedTaskCount: 1,
      tasksWithDriftCount: 1,
      tasksMissingRunCount: 1,
      tasksMissingEvidenceCount: 1,
    });
    expect(summarizeProductGraphExecutionDrift(unlinkedProductGraph).taskGaps.map(({ task }) => task.id)).toEqual([
      "task:checkout-status-panel",
    ]);
    expect(summarizeProductGraphExecutionDrift(linkedProductGraph)).toMatchObject({
      completedTaskCount: 1,
      tasksWithDriftCount: 0,
      tasksMissingRunCount: 0,
      tasksMissingEvidenceCount: 0,
      taskGaps: [],
    });
    expect(summarizeProductGraphExecutionDrift(plannedProductGraph)).toMatchObject({
      completedTaskCount: 0,
      tasksWithDriftCount: 0,
      taskGaps: [],
    });
    expect(summarizeProductGraphExecutionDrift(overflowProductGraph, { taskGapLimit: 4 })).toMatchObject({
      completedTaskCount: 6,
      tasksWithDriftCount: 6,
      tasksMissingRunCount: 6,
      tasksMissingEvidenceCount: 6,
    });
    expect(summarizeProductGraphExecutionDrift(overflowProductGraph, { taskGapLimit: 4 }).taskGaps).toHaveLength(4);
    expect(summarizeProductGraphExecutionTestEvidence(runWithoutTestEvidenceProductGraph)).toMatchObject({
      completedTaskCount: 1,
      completedTasksWithLinkedEvidenceCount: 1,
      tasksMissingTestEvidenceCount: 1,
    });
    expect(
      summarizeProductGraphExecutionTestEvidence(runWithoutTestEvidenceProductGraph).taskGaps.map(({ task }) => task.id)
    ).toEqual(["task:checkout-status-panel"]);
    expect(summarizeProductGraphExecutionTestEvidence(linkedProductGraph)).toMatchObject({
      completedTaskCount: 1,
      completedTasksWithLinkedEvidenceCount: 1,
      tasksMissingTestEvidenceCount: 0,
      taskGaps: [],
    });
    expect(
      summarizeProductGraphExecutionTestEvidence(overflowTestEvidenceProductGraph, { taskGapLimit: 4 })
    ).toMatchObject({
      completedTaskCount: 6,
      completedTasksWithLinkedEvidenceCount: 6,
      tasksMissingTestEvidenceCount: 6,
    });
    expect(
      summarizeProductGraphExecutionTestEvidence(overflowTestEvidenceProductGraph, { taskGapLimit: 4 }).taskGaps
    ).toHaveLength(4);
    expect(summarizeProductGraphCodeIntentDrift(codeIntentDriftProductGraph)).toMatchObject({
      changedCodeNodeCount: 1,
      changedCodeNodesWithIntentCount: 0,
      codeNodesMissingIntentCount: 1,
    });
    expect(
      summarizeProductGraphCodeIntentDrift(codeIntentDriftProductGraph).codeGaps.map(({ codeNode, summary }) => [
        codeNode.id,
        summary.linkedRunCount,
        summary.linkedTaskCount,
        summary.linkedIntentNodeCount,
      ])
    ).toEqual([["file:checkout-status", 1, 1, 0]]);
    expect(summarizeProductGraphCodeIntentDrift(codeIntentBackedProductGraph)).toMatchObject({
      changedCodeNodeCount: 1,
      changedCodeNodesWithIntentCount: 1,
      codeNodesMissingIntentCount: 0,
      codeGaps: [],
    });
    expect(summarizeProductGraphCodeIntentDrift(plannedProductGraph)).toMatchObject({
      changedCodeNodeCount: 0,
      codeNodesMissingIntentCount: 0,
      codeGaps: [],
    });
    expect(summarizeProductGraphCodeIntentDrift(overflowCodeIntentProductGraph, { codeGapLimit: 4 })).toMatchObject({
      changedCodeNodeCount: 6,
      changedCodeNodesWithIntentCount: 0,
      codeNodesMissingIntentCount: 6,
    });
    expect(summarizeProductGraphCodeIntentDrift(overflowCodeIntentProductGraph, { codeGapLimit: 4 }).codeGaps).toHaveLength(4);
    expect(summarizeProductGraphCodeScanFreshness(missingCodeMapProductGraph)).toMatchObject({
      codeScanNodeCount: 0,
      runTouchedCodeNodeCount: 1,
      codeNodesChangedAfterCodeScanCount: 1,
      isCodeMapMissing: true,
      isCodeMapStale: false,
    });
    expect(summarizeProductGraphCodeScanFreshness(freshCodeMapProductGraph)).toMatchObject({
      codeScanNodeCount: 5,
      runTouchedCodeNodeCount: 1,
      codeNodesChangedAfterCodeScanCount: 0,
      isCodeMapMissing: false,
      isCodeMapStale: false,
      codeGaps: [],
    });
    expect(summarizeProductGraphCodeScanFreshness(staleCodeMapProductGraph)).toMatchObject({
      codeScanNodeCount: 5,
      runTouchedCodeNodeCount: 1,
      codeNodesChangedAfterCodeScanCount: 1,
      isCodeMapMissing: false,
      isCodeMapStale: true,
    });
    expect(summarizeProductGraphCodeScanFreshness(staleCodeMapProductGraph).codeGaps.map(({ codeNode, runNode }) => [
      codeNode.id,
      runNode.id,
    ])).toEqual([["file:src-checkout", "run:code-scan-stale"]]);
  });

  it("keeps frontend acceptance evidence fixtures aligned with shared Product Graph helpers", () => {
    const productGraph = makeAcceptanceEvidenceProductGraph();
    const nodesById = new Map(productGraph.nodes.map((node) => [node.id, node]));
    const featureNode = nodesById.get("feature:checkout-visibility")!;
    const taskNode = nodesById.get("task:checkout-status-panel")!;

    const featureEvidence = findProductGraphAcceptanceCriterionEvidenceForNode({
      projection: productGraph,
      selectedNodeId: featureNode.id,
    });
    const taskEvidence = findProductGraphAcceptanceCriterionEvidenceForNode({
      projection: productGraph,
      selectedNodeId: taskNode.id,
    });
    const featureEvidenceSummary = summarizeProductGraphFeatureAcceptanceEvidence({
      projection: productGraph,
      featureNodeId: featureNode.id,
    });
    const compactGapLimit = 4;
    const acceptanceEvidenceGaps = findProductGraphAcceptanceEvidenceGaps(productGraph, {
      gapLimit: compactGapLimit,
    });
    const acceptanceEvidenceHealth = summarizeProductGraphAcceptanceEvidenceHealth(productGraph);
    const overflowProductGraph = makeOverflowAcceptanceEvidenceProductGraph();
    const overflowEvidenceGaps = findProductGraphAcceptanceEvidenceGaps(overflowProductGraph, {
      gapLimit: compactGapLimit,
    });
    const allVerifiedProductGraph = makeAllVerifiedAcceptanceEvidenceProductGraph();
    const noCriteriaProductGraph = makeProductGraph();
    const cachedSummaryProductGraph = makeProductGraph();
    const cachedFeatureSummaries = new Map([
      ["feature:checkout-visibility", { totalCount: 4, verifiedCount: 3, unverifiedCount: 1 }],
    ]);

    expect(featureEvidence.map(({ criterion, verifierNodes, evidenceNodes }) => [
      criterion.id,
      verifierNodes.map((node) => node.id),
      evidenceNodes.map((node) => node.id),
    ])).toEqual([
      ["criterion:checkout-status-proof", ["test:checkout-status-proof"], ["evidence:checkout-status-proof"]],
      ["criterion:copy-approved", ["run:copy-review"], []],
      ["criterion:tax-copy-approved", [], []],
    ]);
    expect(taskEvidence.map(({ criterion }) => criterion.id)).toEqual([
      "criterion:checkout-status-proof",
      "criterion:copy-approved",
      "criterion:tax-copy-approved",
    ]);
    expect(featureEvidenceSummary).toEqual({
      totalCount: 3,
      verifiedCount: 2,
      unverifiedCount: 1,
    });
    expect(acceptanceEvidenceGaps.map(({ feature, criteria }) => [
      feature.id,
      criteria.map((criterion) => criterion.id),
    ])).toEqual([
      ["feature:checkout-visibility", ["criterion:tax-copy-approved"]],
    ]);
    expect(overflowEvidenceGaps.map(({ feature, criteria }) => [
      feature.id,
      criteria.map((criterion) => criterion.id),
    ])).toEqual([
      [
        "feature:checkout-visibility",
        [
          "criterion:tax-copy-approved",
          "criterion:extra-gap-1",
          "criterion:extra-gap-2",
          "criterion:extra-gap-3",
          "criterion:extra-gap-4",
          "criterion:extra-gap-5",
        ],
      ],
    ]);
    expect(acceptanceEvidenceHealth).toEqual({
      featureCount: 1,
      featuresWithCriteriaCount: 1,
      featuresNeedingEvidenceCount: 1,
      acceptanceCriteriaCount: 3,
      verifiedAcceptanceCriteriaCount: 2,
      criteriaNeedingEvidenceCount: 1,
      coveragePercent: 67,
    });
    expect(summarizeProductGraphAcceptanceEvidenceHealth(allVerifiedProductGraph)).toMatchObject({
      featuresNeedingEvidenceCount: 0,
      criteriaNeedingEvidenceCount: 0,
      coveragePercent: 100,
    });
    expect(findProductGraphAcceptanceEvidenceGaps(allVerifiedProductGraph)).toEqual([]);
    expect(summarizeProductGraphAcceptanceEvidenceHealth(noCriteriaProductGraph)).toMatchObject({
      featureCount: 1,
      featuresWithCriteriaCount: 0,
      acceptanceCriteriaCount: 0,
      coveragePercent: 0,
    });
    expect(
      summarizeProductGraphAcceptanceEvidenceHealth(cachedSummaryProductGraph, {
        featureAcceptanceSummariesByNodeId: cachedFeatureSummaries,
      })
    ).toMatchObject({
      featuresWithCriteriaCount: 1,
      acceptanceCriteriaCount: 4,
      verifiedAcceptanceCriteriaCount: 3,
      criteriaNeedingEvidenceCount: 1,
      coveragePercent: 75,
    });
    expect(
      summarizeProductGraphFeatureAcceptanceEvidence({ projection: productGraph, featureNodeId: taskNode.id })
    ).toBeUndefined();
    expect(
      findProductGraphAcceptanceCriterionEvidenceForNode({
        projection: productGraph,
        selectedNodeId: nodesById.get("evidence:checkout-status-proof")!.id,
      })
    ).toEqual([]);
  });

  it("renders likely code area focus buttons for selected tasks", () => {
    const productGraph = makeCodeMapProductGraph();
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const codeAreaGroupStart = markup.indexOf('aria-label="Likely code areas"');
    expect(codeAreaGroupStart).toBeGreaterThanOrEqual(0);
    const blockerGroupStart = markup.indexOf('aria-label="Open question blockers"', codeAreaGroupStart);
    expect(blockerGroupStart).toBeGreaterThan(codeAreaGroupStart);
    const codeAreaGroupMarkup = markup.slice(codeAreaGroupStart, blockerGroupStart);

    expect(codeAreaGroupMarkup).toContain("Likely code areas");
    expect(codeAreaGroupMarkup).toContain("CheckoutController");
    expect(codeAreaGroupMarkup).toContain("code symbol - Likely code area");
    expect(codeAreaGroupMarkup).toContain("ambiguous");
  });

  it("renders acceptance criterion evidence for selected features", () => {
    const productGraph = makeAcceptanceEvidenceProductGraph();

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const featureRowStart = markup.indexOf("Checkout visibility");
    expect(featureRowStart).toBeGreaterThanOrEqual(0);
    const storyRowStart = markup.indexOf("Operator sees checkout status", featureRowStart);
    expect(storyRowStart).toBeGreaterThan(featureRowStart);
    const featureRowMarkup = markup.slice(featureRowStart, storyRowStart);
    expect(featureRowMarkup).toContain('aria-label="Checkout visibility acceptance verification"');
    expect(featureRowMarkup).toContain("2/3 criteria verified");
    expect(featureRowMarkup).toContain("1 criterion needs evidence");

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);
    expect(healthGroupMarkup).toContain("Product health");
    expect(healthGroupMarkup).toContain("Evidence coverage");
    expect(healthGroupMarkup).toContain("67%");
    expect(healthGroupMarkup).toContain("Features at risk");
    expect(healthGroupMarkup).toContain("Criteria needing evidence");
    expect(healthGroupMarkup).toContain("67% acceptance evidence coverage. 1 feature needs evidence across 1 criterion.");
    expect(healthGroupMarkup).toContain('aria-label="Acceptance evidence gaps"');
    expect(healthGroupMarkup).toContain("Evidence gaps");
    expect(healthGroupMarkup).toContain('aria-label="Focus Checkout visibility feature"');
    expect(healthGroupMarkup).toContain("Tax copy has owner approval");
    expect(healthGroupMarkup).toContain('aria-label="Focus Tax copy has owner approval acceptance criterion"');

    const evidenceGroupStart = markup.indexOf('aria-label="Acceptance evidence"');
    expect(evidenceGroupStart).toBeGreaterThanOrEqual(0);
    const relationshipsStart = markup.indexOf("Relationships", evidenceGroupStart);
    expect(relationshipsStart).toBeGreaterThan(evidenceGroupStart);
    const evidenceGroupMarkup = markup.slice(evidenceGroupStart, relationshipsStart);

    expect(evidenceGroupMarkup).toContain("Acceptance evidence");
    expect(evidenceGroupMarkup).toContain("2/3 verified");
    expect(evidenceGroupMarkup).toContain("Checkout status has proof");
    expect(evidenceGroupMarkup).toContain("Evidence linked");
    expect(evidenceGroupMarkup).toContain("CheckoutStatus test passed");
    expect(evidenceGroupMarkup).toContain("Checkout status proof evidence");
    expect(evidenceGroupMarkup).toContain("Payment copy is approved");
    expect(evidenceGroupMarkup).toContain("Verifier linked");
    expect(evidenceGroupMarkup).toContain("Copy review run");
    expect(evidenceGroupMarkup).toContain("Tax copy has owner approval");
    expect(evidenceGroupMarkup).toContain("Needs evidence");
    expect(evidenceGroupMarkup).toContain('aria-label="Focus Checkout status has proof acceptance criterion"');
  });

  it("renders hidden acceptance evidence gap counts when compact health details overflow", () => {
    const productGraph = makeOverflowAcceptanceEvidenceProductGraph();

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain('aria-label="Acceptance evidence gaps"');
    expect(healthGroupMarkup).toContain("Tax copy has owner approval");
    expect(healthGroupMarkup).toContain("Additional evidence gap 4");
    expect(healthGroupMarkup).not.toContain("Additional evidence gap 5");
    expect(healthGroupMarkup).toContain("+1 more criterion needs evidence.");
  });

  it("renders all-verified acceptance summary for feature rows", () => {
    const productGraph = makeAllVerifiedAcceptanceEvidenceProductGraph();

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const featureRowStart = markup.indexOf("Checkout visibility");
    expect(featureRowStart).toBeGreaterThanOrEqual(0);
    const storyRowStart = markup.indexOf("Operator sees checkout status", featureRowStart);
    expect(storyRowStart).toBeGreaterThan(featureRowStart);
    const featureRowMarkup = markup.slice(featureRowStart, storyRowStart);
    expect(featureRowMarkup).toContain('role="group"');
    expect(featureRowMarkup).toContain('aria-label="Checkout visibility acceptance verification"');
    expect(featureRowMarkup).toContain("3/3 criteria verified");
    expect(featureRowMarkup).toContain("All criteria verified");
    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);
    expect(healthGroupMarkup).toContain("100% acceptance evidence coverage. All tracked acceptance criteria have evidence.");
    expect(healthGroupMarkup).not.toContain('aria-label="Acceptance evidence gaps"');
  });

  it("renders neutral product health when no acceptance criteria are linked", () => {
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("Product health");
    expect(healthGroupMarkup).toContain("Evidence coverage");
    expect(healthGroupMarkup).toContain("No criteria");
    expect(healthGroupMarkup).toContain("Features at risk");
    expect(healthGroupMarkup).toContain("Criteria needing evidence");
    expect(healthGroupMarkup).toContain("No acceptance criteria linked yet.");
    expect(healthGroupMarkup).toContain("No run-touched code nodes to inspect yet.");
    expect(healthGroupMarkup).toContain("Code map gaps");
    expect(healthGroupMarkup).toContain('aria-label="Codebase scan status"');
    expect(healthGroupMarkup).toContain("No codebase scan map is available yet.");
    expect(healthGroupMarkup).toContain("Ask an operator/admin to refresh the native Product Graph code map.");
    expect(healthGroupMarkup).toContain("Scans bounded local TypeScript and JavaScript files");
    expect(healthGroupMarkup).toContain("Operators/admins can refresh this map from manager tools in this sidebar.");
    expect(healthGroupMarkup).toContain("Codex planning has no codebase scan context yet.");
  });

  it("renders graph-level execution drift health for completed tasks", () => {
    const productGraph = withCheckoutTaskStatus(makeLinkedRunWithoutEvidenceProductGraph(), "completed");

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("Completed drift");
    expect(healthGroupMarkup).toContain("Missing run links");
    expect(healthGroupMarkup).toContain("Missing evidence nodes");
    expect(healthGroupMarkup).toContain("1 of 1 completed task needs run evidence.");
    expect(healthGroupMarkup).toContain('aria-label="Execution drift gaps"');
    expect(healthGroupMarkup).toContain("Wire checkout status panel");
    expect(healthGroupMarkup).toContain("Missing evidence node");
    expect(healthGroupMarkup).toContain('aria-label="Focus Wire checkout status panel task with execution drift"');
  });

  it("renders graph-level test evidence health for completed tasks with run evidence", () => {
    const productGraph = withCheckoutTaskStatus(makeLinkedRunWithoutTestEvidenceProductGraph(), "completed");

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("Missing test evidence");
    expect(healthGroupMarkup).toContain("1 of 1 completed task with run evidence needs test evidence.");
    expect(healthGroupMarkup).toContain('aria-label="Test evidence gaps"');
    expect(healthGroupMarkup).toContain("Wire checkout status panel");
    expect(healthGroupMarkup).toContain("No test command or result");
    expect(healthGroupMarkup).toContain('aria-label="Focus Wire checkout status panel task without test evidence"');
    expect(healthGroupMarkup).not.toContain('aria-label="Execution drift gaps"');
  });

  it("renders graph-level code intent drift for run-touched code", () => {
    const productGraph = withCheckoutTaskStatus(makeLinkedRunFilesProductGraph(), "completed");

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("Code missing intent");
    expect(healthGroupMarkup).toContain("1 of 1 run-touched code node needs product intent.");
    expect(healthGroupMarkup).toContain('aria-label="Code intent drift gaps"');
    expect(healthGroupMarkup).toContain("Code intent");
    expect(healthGroupMarkup).toContain("packages/frontend/src/CheckoutStatus.tsx");
    expect(healthGroupMarkup).toContain("No linked product intent");
    expect(healthGroupMarkup).toContain("1 run-touched code node needs a native codebase scan.");
    expect(healthGroupMarkup).toContain("Ask an operator/admin to refresh the native Product Graph code map.");
    expect(healthGroupMarkup).toContain("Codex planning may miss code relationship context until a codebase scan runs.");
    expect(healthGroupMarkup).toContain('aria-label="Code map freshness gaps"');
    expect(healthGroupMarkup).toContain("No codebase scan imported");
    expect(healthGroupMarkup).toContain(
      'aria-label="Focus packages/frontend/src/CheckoutStatus.tsx changed code without product intent"'
    );
    expect(healthGroupMarkup).not.toContain('aria-label="Execution drift gaps"');
    expect(healthGroupMarkup).not.toContain('aria-label="Test evidence gaps"');
  });

  it("renders healthy code intent health when run-touched code is linked to intent", () => {
    const productGraph = withCheckoutTaskStatus(makeLinkedRunWithProductIntentGraph(), "completed");

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("Code missing intent");
    expect(healthGroupMarkup).toContain("Run-touched code is linked to product intent.");
    expect(healthGroupMarkup).not.toContain('aria-label="Code intent drift gaps"');
    expect(healthGroupMarkup).not.toContain("No linked product intent");
  });

  it("renders stale codebase scan map health for run-touched code after scan", () => {
    const productGraph = makeRunTouchedCodeMapProductGraph("stale");

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("Code map gaps");
    expect(healthGroupMarkup).toContain("1 run-touched code node changed after the latest codebase scan.");
    expect(healthGroupMarkup).toContain("Ask an operator/admin to refresh the native Product Graph code map.");
    expect(healthGroupMarkup).toContain("Codex planning may use stale code relationship context until the codebase scan is refreshed.");
    expect(healthGroupMarkup).toContain('aria-label="Code map freshness gaps"');
    expect(healthGroupMarkup).toContain("Code map freshness");
    expect(healthGroupMarkup).toContain("src/checkout.ts");
    expect(healthGroupMarkup).toContain("Changed after Codebase scan");
    expect(healthGroupMarkup).toContain('aria-label="Focus src/checkout.ts code needing fresh codebase scan"');
  });

  it("renders hidden-count copy when code intent drift gaps exceed the visible limit", () => {
    const productGraph = makeOverflowCodeIntentDriftProductGraph();

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("6 of 6 run-touched code nodes need product intent.");
    expect(healthGroupMarkup).toContain("+2 more code nodes need product intent.");
    expect(healthGroupMarkup).toContain("packages/frontend/src/CheckoutStatusExtra3.tsx");
    expect(healthGroupMarkup).not.toContain("packages/frontend/src/CheckoutStatusExtra4.tsx");
  });

  it("renders hidden-count copy when test evidence gaps exceed the visible limit", () => {
    const productGraph = makeOverflowTestEvidenceProductGraph();

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("6 of 6 completed tasks with run evidence need test evidence.");
    expect(healthGroupMarkup).toContain("+2 more completed tasks need test evidence.");
    expect(healthGroupMarkup).toContain("Overflow test evidence task 3");
    expect(healthGroupMarkup).not.toContain("Overflow test evidence task 4");
  });

  it("renders hidden-count copy when execution drift gaps exceed the visible limit", () => {
    const productGraph = makeOverflowExecutionDriftProductGraph();

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThanOrEqual(0);
    const searchStart = markup.indexOf('placeholder="Search intent, tasks, questions..."', healthGroupStart);
    expect(searchStart).toBeGreaterThan(healthGroupStart);
    const healthGroupMarkup = markup.slice(healthGroupStart, searchStart);

    expect(healthGroupMarkup).toContain("6 of 6 completed tasks need run evidence.");
    expect(healthGroupMarkup).toContain("+2 more completed tasks need run evidence.");
    expect(healthGroupMarkup).toContain("Overflow drift task 3");
    expect(healthGroupMarkup).not.toContain("Overflow drift task 4");
  });

  it("renders acceptance criterion evidence for selected tasks", () => {
    const productGraph = makeAcceptanceEvidenceProductGraph();
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const evidenceGroupStart = markup.indexOf('aria-label="Acceptance evidence"');
    expect(evidenceGroupStart).toBeGreaterThanOrEqual(0);
    const runLinkStart = markup.indexOf('aria-label="Run linking"', evidenceGroupStart);
    const linkedFilesStart = markup.indexOf('aria-label="Linked run files"', evidenceGroupStart);
    const blockerGroupStart = markup.indexOf('aria-label="Open question blockers"', evidenceGroupStart);
    const nextGroupStart = [runLinkStart, linkedFilesStart, blockerGroupStart]
      .filter((index) => index > evidenceGroupStart)
      .sort((left, right) => left - right)[0];
    expect(nextGroupStart).toBeGreaterThan(evidenceGroupStart);
    const evidenceGroupMarkup = markup.slice(evidenceGroupStart, nextGroupStart);

    expect(evidenceGroupMarkup).toContain("Acceptance evidence");
    expect(evidenceGroupMarkup).toContain("2/3 verified");
    expect(evidenceGroupMarkup).toContain("Checkout status has proof");
    expect(evidenceGroupMarkup).toContain("Evidence linked");
    expect(evidenceGroupMarkup).toContain("Checkout status proof evidence");
    expect(evidenceGroupMarkup).toContain("Payment copy is approved");
    expect(evidenceGroupMarkup).toContain("Verifier linked");
    expect(evidenceGroupMarkup).toContain("Copy review run");
    expect(evidenceGroupMarkup).toContain("Tax copy has owner approval");
    expect(evidenceGroupMarkup).toContain("Needs evidence");
  });

  it("renders linked run file focus buttons for selected tasks", () => {
    const productGraph = makeLinkedRunFilesProductGraph();
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const linkedFilesGroupStart = markup.indexOf('aria-label="Linked run files"');
    expect(linkedFilesGroupStart).toBeGreaterThanOrEqual(0);
    const blockerGroupStart = markup.indexOf('aria-label="Open question blockers"', linkedFilesGroupStart);
    expect(blockerGroupStart).toBeGreaterThan(linkedFilesGroupStart);
    const linkedFilesGroupMarkup = markup.slice(linkedFilesGroupStart, blockerGroupStart);

    expect(linkedFilesGroupMarkup).toContain("Linked run files");
    expect(linkedFilesGroupMarkup).toContain("packages/frontend/src/CheckoutStatus.tsx");
    expect(linkedFilesGroupMarkup).toContain("Checkout proof run - Run changed file");
    expect(linkedFilesGroupMarkup).toContain('aria-label="Focus packages/frontend/src/CheckoutStatus.tsx linked run file"');
  });

  it("renders execution drift for completed tasks without linked run evidence", () => {
    const productGraph = withCheckoutTaskStatus(makeProductGraph(), "completed");
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const driftGroupStart = markup.indexOf('aria-label="Execution drift"');
    expect(driftGroupStart).toBeGreaterThanOrEqual(0);
    const relationshipsStart = markup.indexOf("Relationships", driftGroupStart);
    expect(relationshipsStart).toBeGreaterThan(driftGroupStart);
    const driftGroupMarkup = markup.slice(driftGroupStart, relationshipsStart);

    expect(driftGroupMarkup).toContain("Execution drift");
    expect(driftGroupMarkup).toContain("Runs");
    expect(driftGroupMarkup).toContain("Evidence");
    expect(driftGroupMarkup).toContain("Files");
    expect(driftGroupMarkup).toContain("Completed task has no linked OpenAgentGraph run.");
    expect(driftGroupMarkup).toContain("Link a completed OpenAgentGraph run with evidence before treating this task as verified.");
  });

  it("renders execution drift for completed tasks with a linked run but no evidence node", () => {
    const productGraph = withCheckoutTaskStatus(makeLinkedRunWithoutEvidenceProductGraph(), "completed");
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const driftGroupStart = markup.indexOf('aria-label="Execution drift"');
    expect(driftGroupStart).toBeGreaterThanOrEqual(0);
    const linkedFilesStart = markup.indexOf('aria-label="Linked run files"', driftGroupStart);
    expect(linkedFilesStart).toBeGreaterThan(driftGroupStart);
    const driftGroupMarkup = markup.slice(driftGroupStart, linkedFilesStart);

    expect(driftGroupMarkup).toContain("Execution drift");
    expect(driftGroupMarkup).toContain("Completed task has a linked run but no evidence node.");
    expect(driftGroupMarkup).toContain("Link a completed OpenAgentGraph run with evidence before treating this task as verified.");
  });

  it("does not render execution drift when a completed task has linked run evidence", () => {
    const productGraph = withCheckoutTaskStatus(makeLinkedRunFilesProductGraph(), "completed");
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(markup).not.toContain('aria-label="Execution drift"');
    expect(markup).toContain('aria-label="Linked run files"');
  });

  it("renders selected-task Codex planning prompt output", () => {
    const productGraph = makeCodeMapProductGraph();
    const codexPlan = makeProductGraphCodexPlan(productGraph);
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphCodexPlan={codexPlan}
        productGraphCodexPlanTaskNodeId="task:checkout-status-panel"
        productGraphCodexPlanLoading={false}
        productGraphCodexPlanError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadCodexPlan={onLoadCodexPlan}
      />
    );

    const codexPlanGroupStart = markup.indexOf('aria-label="Codex planning prompt"');
    expect(codexPlanGroupStart).toBeGreaterThanOrEqual(0);
    const traceGroupStart = markup.indexOf('aria-label="Traceability"', codexPlanGroupStart);
    const codeAreaGroupStart = markup.indexOf('aria-label="Likely code areas"', codexPlanGroupStart);
    const nextGroupStart = [traceGroupStart, codeAreaGroupStart]
      .filter((index) => index > codexPlanGroupStart)
      .sort((left, right) => left - right)[0];
    expect(nextGroupStart).toBeGreaterThan(codexPlanGroupStart);
    const codexPlanGroupMarkup = markup.slice(codexPlanGroupStart, nextGroupStart);

    expect(codexPlanGroupMarkup).toContain("Codex plan");
    expect(codexPlanGroupMarkup).toContain('aria-label="Codex planning readiness"');
    expect(codexPlanGroupMarkup).toContain("1 open-question blocker; load the plan for context, then resolve blockers before execution.");
    expect(codexPlanGroupMarkup).toContain("Codex planning can use native codebase scan context.");
    expect(codexPlanGroupMarkup).toContain("Read-only access: prompt review is available, but operator/admin access is required to accept plans or start execution.");
    expect(codexPlanGroupMarkup).toContain("Review the prompt; an operator/admin can accept it before execution.");
    expect(codexPlanGroupMarkup).toContain("Refresh plan");
    expect(codexPlanGroupMarkup).not.toContain("Accept plan");
    expect(codexPlanGroupMarkup).toContain("1 code areas");
    expect(codexPlanGroupMarkup).toContain("2 checks");
    expect(codexPlanGroupMarkup).toContain("God Nodes: CheckoutStatus component.");
    expect(codexPlanGroupMarkup).toContain("Some code links are inferred or ambiguous");
    expect(codexPlanGroupMarkup).toContain("npm run build / npm run test");
    expect(codexPlanGroupMarkup).toContain("You are Codex working from OpenAgentGraph product graph context.");
  });

  it("renders selected-task Codex plan acceptance for graph managers", () => {
    const productGraph = makeCodeMapProductGraph();
    const codexPlan = makeProductGraphCodexPlan(productGraph);
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphCodexPlan={codexPlan}
        productGraphCodexPlanTaskNodeId="task:checkout-status-panel"
        productGraphCodexPlanLoading={false}
        productGraphCodexPlanError=""
        onRefresh={onRefresh}
        canManageProductGraph={true}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadCodexPlan={onLoadCodexPlan}
        onAcceptCodexPlan={onAcceptCodexPlan}
      />
    );

    const codexPlanGroupStart = markup.indexOf('aria-label="Codex planning prompt"');
    expect(codexPlanGroupStart).toBeGreaterThanOrEqual(0);
    const traceGroupStart = markup.indexOf('aria-label="Traceability"', codexPlanGroupStart);
    const codeAreaGroupStart = markup.indexOf('aria-label="Likely code areas"', codexPlanGroupStart);
    const nextGroupStart = [traceGroupStart, codeAreaGroupStart]
      .filter((index) => index > codexPlanGroupStart)
      .sort((left, right) => left - right)[0];
    expect(nextGroupStart).toBeGreaterThan(codexPlanGroupStart);
    const codexPlanGroupMarkup = markup.slice(codexPlanGroupStart, nextGroupStart);

    expect(codexPlanGroupMarkup).toContain("Accept plan");
    expect(codexPlanGroupMarkup).toContain("Refresh plan");
    expect(codexPlanGroupMarkup).toContain("Provider and session checks are clear here; start real execution from Current run setup after the workspace path is set.");
    expect(codexPlanGroupMarkup).toContain("Review the prompt, then accept the plan if it matches current task context.");
  });

  it("renders selected-task Codex execution blockers in the planning panel", () => {
    const productGraph = makeCodeMapProductGraph();
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const providerBlockedMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        runtimeFallbackLikely={true}
        runtimeStatus="connected"
        sessionLifecycle="signed_in"
        onRefresh={onRefresh}
        canManageProductGraph={true}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadCodexPlan={onLoadCodexPlan}
      />
    );
    expect(providerBlockedMarkup).toContain('aria-label="Codex planning readiness"');
    expect(providerBlockedMarkup).toContain(
      "AI provider blocks execution: configure the provider, restart the backend, and refresh provider status before starting a run."
    );

    const expiredSessionMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        runtimeFallbackLikely={false}
        runtimeStatus="connected"
        sessionLifecycle="expired_session"
        onRefresh={onRefresh}
        canManageProductGraph={true}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadCodexPlan={onLoadCodexPlan}
      />
    );
    expect(expiredSessionMarkup).toContain(
      "Session blocks execution: update the token before accepting plans or starting a real run."
    );
  });

  it("renders selected Codex plan metadata details", () => {
    const productGraph = makeAcceptedCodexPlanProductGraph();
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const planDetailsStart = markup.indexOf('aria-label="Codex plan details"');
    const relationshipsStart = markup.indexOf("Relationships", planDetailsStart);
    const planDetailsMarkup = markup.slice(planDetailsStart, relationshipsStart);

    expect(markup).toContain("Selected plan");
    expect(planDetailsStart).toBeGreaterThanOrEqual(0);
    expect(relationshipsStart).toBeGreaterThan(planDetailsStart);
    expect(planDetailsMarkup).toContain("Task node");
    expect(planDetailsMarkup).toContain("task:checkout-status-panel");
    expect(planDetailsMarkup).toContain("Prompt hash");
    expect(planDetailsMarkup).toContain("a".repeat(64));
    expect(markup).toContain("You are Codex working from OpenAgentGraph product graph context.");
  });

  it("renders linked run results for selected accepted plans", () => {
    const productGraph = makeAcceptedCodexPlanRunLinkedProductGraph();
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    const linkedRunsStart = markup.indexOf('aria-label="Runs derived from plan"');
    const relationshipsStart = markup.indexOf("Relationships", linkedRunsStart);
    const linkedRunsMarkup = markup.slice(linkedRunsStart, relationshipsStart);

    expect(markup).toContain("Selected plan");
    expect(linkedRunsStart).toBeGreaterThanOrEqual(0);
    expect(relationshipsStart).toBeGreaterThan(linkedRunsStart);
    expect(linkedRunsMarkup).toContain("Runs from this plan");
    expect(linkedRunsMarkup).toContain("Checkout proof run");
    expect(linkedRunsMarkup).toContain("Run derived from plan");
    expect(linkedRunsMarkup).toContain('aria-label="Focus Checkout proof run linked plan run"');
  });

  it("renders selected-task Codex planning loading and error states", () => {
    const productGraph = makeProductGraph();
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const loadingMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphCodexPlanTaskNodeId="task:checkout-status-panel"
        productGraphCodexPlanLoading={true}
        productGraphCodexPlanError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadCodexPlan={onLoadCodexPlan}
      />
    );
    expect(loadingMarkup).toContain('aria-label="Codex planning prompt"');
    expect(loadingMarkup).toContain("Loading plan...");

    const errorMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphCodexPlanTaskNodeId="task:checkout-status-panel"
        productGraphCodexPlanLoading={false}
        productGraphCodexPlanError="Product graph task was not found."
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadCodexPlan={onLoadCodexPlan}
      />
    );
    expect(errorMarkup).toContain("Product graph task was not found.");
    expect(errorMarkup).not.toContain("Load a bounded task prompt");
  });

  it("renders selected-node traceability summaries when a trace is loaded", () => {
    const productGraph = makeCodeMapProductGraph();
    const trace = makeProductGraphTrace(productGraph, "task:checkout-status-panel");
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphTrace={trace}
        productGraphTraceNodeId="task:checkout-status-panel"
        productGraphTraceLoading={false}
        productGraphTraceError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadTrace={onLoadTrace}
      />
    );

    const traceGroupStart = markup.indexOf('aria-label="Traceability"');
    expect(traceGroupStart).toBeGreaterThanOrEqual(0);
    const codeScanGroupStart = markup.indexOf('aria-label="Likely code areas"', traceGroupStart);
    expect(codeScanGroupStart).toBeGreaterThan(traceGroupStart);
    const traceGroupMarkup = markup.slice(traceGroupStart, codeScanGroupStart);

    expect(traceGroupMarkup).toContain("Traceability");
    expect(traceGroupMarkup).toContain("Refresh trace");
    expect(traceGroupMarkup).toContain("2 nodes");
    expect(traceGroupMarkup).toContain("1 links");
    expect(traceGroupMarkup).toContain("1 code");
    expect(traceGroupMarkup).toContain("CheckoutController");
    expect(traceGroupMarkup).toContain('aria-label="Focus CheckoutController trace node"');
    expect(traceGroupMarkup).toContain("code symbol - 1 hops");
  });

  it("renders a cached trace for the selected node when another node was loaded last", () => {
    const productGraph = makeCodeMapProductGraph();
    const cachedTrace = makeProductGraphTrace(productGraph, "task:checkout-status-panel");
    const activeTrace = makeProductGraphTrace(productGraph, "feature:checkout-visibility");
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphTrace={activeTrace}
        productGraphTracesByNodeId={{
          "feature:checkout-visibility": activeTrace,
          "task:checkout-status-panel": cachedTrace,
        }}
        productGraphTraceNodeId="feature:checkout-visibility"
        productGraphTraceLoading={false}
        productGraphTraceError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadTrace={onLoadTrace}
      />
    );

    const traceGroupStart = markup.indexOf('aria-label="Traceability"');
    expect(traceGroupStart).toBeGreaterThanOrEqual(0);
    const codeScanGroupStart = markup.indexOf('aria-label="Likely code areas"', traceGroupStart);
    expect(codeScanGroupStart).toBeGreaterThan(traceGroupStart);
    const traceGroupMarkup = markup.slice(traceGroupStart, codeScanGroupStart);

    expect(traceGroupMarkup).toContain("Refresh trace");
    expect(traceGroupMarkup).toContain("2 nodes");
    expect(traceGroupMarkup).toContain("CheckoutController");
  });

  it("renders a trace-cleared notice when cached trace state was invalidated", () => {
    const productGraph = makeCodeMapProductGraph();
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphTrace={null}
        productGraphTracesByNodeId={{}}
        productGraphTraceNodeId={null}
        productGraphTraceLoading={false}
        productGraphTraceError=""
        productGraphTraceNotice="Graph trace cache cleared after graph refresh."
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadTrace={onLoadTrace}
      />
    );

    const traceGroupStart = markup.indexOf('aria-label="Traceability"');
    expect(traceGroupStart).toBeGreaterThanOrEqual(0);
    const codeScanGroupStart = markup.indexOf('aria-label="Likely code areas"', traceGroupStart);
    expect(codeScanGroupStart).toBeGreaterThan(traceGroupStart);
    const traceGroupMarkup = markup.slice(traceGroupStart, codeScanGroupStart);

    expect(traceGroupMarkup).toContain("Load trace");
    expect(traceGroupMarkup).toContain("Graph trace cache cleared after graph refresh.");
    expect(traceGroupMarkup).not.toContain("CheckoutController");
  });

  it("keeps selected-node traceability visible while refreshing the same trace", () => {
    const productGraph = makeCodeMapProductGraph();
    const trace = makeProductGraphTrace(productGraph, "task:checkout-status-panel");
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphTrace={trace}
        productGraphTraceNodeId="task:checkout-status-panel"
        productGraphTraceLoading={true}
        productGraphTraceError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadTrace={onLoadTrace}
      />
    );

    const traceGroupStart = markup.indexOf('aria-label="Traceability"');
    expect(traceGroupStart).toBeGreaterThanOrEqual(0);
    const codeScanGroupStart = markup.indexOf('aria-label="Likely code areas"', traceGroupStart);
    expect(codeScanGroupStart).toBeGreaterThan(traceGroupStart);
    const traceGroupMarkup = markup.slice(traceGroupStart, codeScanGroupStart);

    expect(traceGroupMarkup).toContain("Loading trace...");
    expect(traceGroupMarkup).toContain("Showing previous trace while refresh runs.");
    expect(traceGroupMarkup).toContain("2 nodes");
    expect(traceGroupMarkup).toContain("CheckoutController");
  });

  it("renders linked run evidence and changed files in selected-node traceability", () => {
    const productGraph = makeLinkedRunFilesProductGraph();
    const trace = makeLinkedRunProductGraphTrace(productGraph, "task:checkout-status-panel");
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphTrace={trace}
        productGraphTraceNodeId="task:checkout-status-panel"
        productGraphTraceLoading={false}
        productGraphTraceError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadTrace={onLoadTrace}
      />
    );

    const traceGroupStart = markup.indexOf('aria-label="Traceability"');
    expect(traceGroupStart).toBeGreaterThanOrEqual(0);
    const linkedFilesGroupStart = markup.indexOf('aria-label="Linked run files"', traceGroupStart);
    expect(linkedFilesGroupStart).toBeGreaterThan(traceGroupStart);
    const traceGroupMarkup = markup.slice(traceGroupStart, linkedFilesGroupStart);

    expect(traceGroupMarkup).toContain("Refresh trace");
    expect(traceGroupMarkup).toContain("4 nodes");
    expect(traceGroupMarkup).toContain("3 links");
    expect(traceGroupMarkup).toContain("1 code");
    expect(traceGroupMarkup).toContain("1 evidence");
    expect(traceGroupMarkup).toContain("Checkout proof run");
    expect(traceGroupMarkup).toContain("agent run - 1 hops");
    expect(traceGroupMarkup).toContain("Checkout proof run evidence");
    expect(traceGroupMarkup).toContain("evidence - 2 hops");
    expect(traceGroupMarkup).toContain("packages/frontend/src/CheckoutStatus.tsx");
    expect(traceGroupMarkup).toContain("code file - 2 hops");
  });

  it("renders accepted plans and derived runs in selected-task traceability", () => {
    const taskNode: ProductGraphProjection["nodes"][number] = {
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
      status: "planned",
      createdAt: "2026-05-12T00:01:30.000Z",
      updatedAt: "2026-05-12T00:01:30.000Z",
      incomingEdgeIds: ["edge-codex-plan-task"],
      outgoingEdgeIds: ["edge-task-run"],
      blockedByNodeIds: [],
    };
    const planNode: ProductGraphProjection["nodes"][number] = {
      id: "plan:codex:checkout-status-panel",
      kind: "plan",
      title: "Codex plan for Wire checkout status panel",
      status: "planned",
      tags: ["codex", "planning"],
      createdAt: "2026-05-12T00:12:00.000Z",
      updatedAt: "2026-05-12T00:12:00.000Z",
      incomingEdgeIds: ["edge-run-codex-plan"],
      outgoingEdgeIds: ["edge-codex-plan-task"],
      blockedByNodeIds: [],
    };
    const runNode: ProductGraphProjection["nodes"][number] = {
      id: "run:checkout-proof",
      kind: "agent_run",
      title: "Checkout proof run",
      status: "completed",
      createdAt: "2026-05-12T00:13:00.000Z",
      updatedAt: "2026-05-12T00:13:00.000Z",
      incomingEdgeIds: ["edge-task-run"],
      outgoingEdgeIds: ["edge-run-codex-plan"],
      blockedByNodeIds: [],
    };
    const productGraph: ProductGraphProjection = {
      schemaVersion: "1",
      productGraphId: "default",
      nodes: [taskNode, planNode, runNode],
      edges: [
        {
          id: "edge-codex-plan-task",
          sourceNodeId: planNode.id,
          targetNodeId: taskNode.id,
          kind: "derived_from",
          trust: "manual",
          label: "Plan derived from task",
          createdAt: "2026-05-12T00:12:00.000Z",
          updatedAt: "2026-05-12T00:12:00.000Z",
        },
        {
          id: "edge-task-run",
          sourceNodeId: taskNode.id,
          targetNodeId: runNode.id,
          kind: "produced_by",
          trust: "manual",
          label: "Task produced by run",
          createdAt: "2026-05-12T00:13:00.000Z",
          updatedAt: "2026-05-12T00:13:00.000Z",
        },
        {
          id: "edge-run-codex-plan",
          sourceNodeId: runNode.id,
          targetNodeId: planNode.id,
          kind: "derived_from",
          trust: "manual",
          label: "Run derived from plan",
          createdAt: "2026-05-12T00:13:00.000Z",
          updatedAt: "2026-05-12T00:13:00.000Z",
        },
      ],
      events: [],
      summary: {
        nodeCount: 3,
        edgeCount: 3,
        nodesByKind: {
          task: 1,
          plan: 1,
          agent_run: 1,
        },
        edgesByKind: {
          derived_from: 2,
          produced_by: 1,
        },
        unresolvedOpenQuestionCount: 0,
        blockedTaskCount: 0,
      },
    };
    const trace = buildProductGraphTrace({
      projection: productGraph,
      rootNodeId: taskNode.id,
    });

    expect(trace).toBeDefined();
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphTrace={trace}
        productGraphTraceNodeId={taskNode.id}
        productGraphTraceLoading={false}
        productGraphTraceError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadTrace={onLoadTrace}
      />
    );

    const traceGroupStart = markup.indexOf('aria-label="Traceability"');
    expect(traceGroupStart).toBeGreaterThanOrEqual(0);
    const relationshipsStart = markup.indexOf("Relationships", traceGroupStart);
    expect(relationshipsStart).toBeGreaterThan(traceGroupStart);
    const traceGroupMarkup = markup.slice(traceGroupStart, relationshipsStart);

    expect(traceGroupMarkup).toContain("3 nodes");
    expect(traceGroupMarkup).toContain("3 links");
    expect(traceGroupMarkup).toContain("Codex plan for Wire checkout status panel");
    expect(traceGroupMarkup).toContain("plan - 1 hops");
    expect(traceGroupMarkup).toContain("Plan derived from task");
    expect(traceGroupMarkup).toContain("Checkout proof run");
    expect(traceGroupMarkup).toContain("agent run - 1 hops");
    expect(traceGroupMarkup).toContain("Task produced by run");
    expect(traceGroupMarkup).toContain("Run derived from plan");
  });

  it("renders multiple accepted plans derived from the same completed run in selected-task traceability", () => {
    const taskNode: ProductGraphProjection["nodes"][number] = {
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
      status: "planned",
      createdAt: "2026-05-12T00:01:30.000Z",
      updatedAt: "2026-05-12T00:01:30.000Z",
      incomingEdgeIds: ["edge-codex-plan-task", "edge-codex-plan-retry-task"],
      outgoingEdgeIds: ["edge-task-run"],
      blockedByNodeIds: [],
    };
    const firstPlanNode: ProductGraphProjection["nodes"][number] = {
      id: "plan:codex:checkout-status-panel",
      kind: "plan",
      title: "Codex plan for Wire checkout status panel",
      status: "planned",
      tags: ["codex", "planning"],
      createdAt: "2026-05-12T00:12:00.000Z",
      updatedAt: "2026-05-12T00:12:00.000Z",
      incomingEdgeIds: ["edge-run-codex-plan"],
      outgoingEdgeIds: ["edge-codex-plan-task"],
      blockedByNodeIds: [],
    };
    const retryPlanNode: ProductGraphProjection["nodes"][number] = {
      id: "plan:codex:checkout-status-panel-retry",
      kind: "plan",
      title: "Retry Codex plan for Wire checkout status panel",
      status: "planned",
      tags: ["codex", "planning"],
      createdAt: "2026-05-12T00:12:30.000Z",
      updatedAt: "2026-05-12T00:12:30.000Z",
      incomingEdgeIds: ["edge-run-codex-plan-retry"],
      outgoingEdgeIds: ["edge-codex-plan-retry-task"],
      blockedByNodeIds: [],
    };
    const runNode: ProductGraphProjection["nodes"][number] = {
      id: "run:checkout-proof",
      kind: "agent_run",
      title: "Checkout proof run",
      status: "completed",
      createdAt: "2026-05-12T00:13:00.000Z",
      updatedAt: "2026-05-12T00:13:00.000Z",
      incomingEdgeIds: ["edge-task-run"],
      outgoingEdgeIds: ["edge-run-codex-plan", "edge-run-codex-plan-retry"],
      blockedByNodeIds: [],
    };
    const productGraph: ProductGraphProjection = {
      schemaVersion: "1",
      productGraphId: "default",
      nodes: [taskNode, firstPlanNode, retryPlanNode, runNode],
      edges: [
        {
          id: "edge-codex-plan-task",
          sourceNodeId: firstPlanNode.id,
          targetNodeId: taskNode.id,
          kind: "derived_from",
          trust: "manual",
          label: "Plan derived from task",
          createdAt: "2026-05-12T00:12:00.000Z",
          updatedAt: "2026-05-12T00:12:00.000Z",
        },
        {
          id: "edge-codex-plan-retry-task",
          sourceNodeId: retryPlanNode.id,
          targetNodeId: taskNode.id,
          kind: "derived_from",
          trust: "manual",
          label: "Retry plan derived from task",
          createdAt: "2026-05-12T00:12:30.000Z",
          updatedAt: "2026-05-12T00:12:30.000Z",
        },
        {
          id: "edge-task-run",
          sourceNodeId: taskNode.id,
          targetNodeId: runNode.id,
          kind: "produced_by",
          trust: "manual",
          label: "Task produced by run",
          createdAt: "2026-05-12T00:13:00.000Z",
          updatedAt: "2026-05-12T00:13:00.000Z",
        },
        {
          id: "edge-run-codex-plan",
          sourceNodeId: runNode.id,
          targetNodeId: firstPlanNode.id,
          kind: "derived_from",
          trust: "manual",
          label: "Run derived from plan",
          createdAt: "2026-05-12T00:13:00.000Z",
          updatedAt: "2026-05-12T00:13:00.000Z",
        },
        {
          id: "edge-run-codex-plan-retry",
          sourceNodeId: runNode.id,
          targetNodeId: retryPlanNode.id,
          kind: "derived_from",
          trust: "manual",
          label: "Run derived from retry plan",
          createdAt: "2026-05-12T00:13:00.000Z",
          updatedAt: "2026-05-12T00:13:00.000Z",
        },
      ],
      events: [],
      summary: {
        nodeCount: 4,
        edgeCount: 5,
        nodesByKind: {
          task: 1,
          plan: 2,
          agent_run: 1,
        },
        edgesByKind: {
          derived_from: 4,
          produced_by: 1,
        },
        unresolvedOpenQuestionCount: 0,
        blockedTaskCount: 0,
      },
    };
    const trace = buildProductGraphTrace({
      projection: productGraph,
      rootNodeId: taskNode.id,
    });

    expect(trace).toBeDefined();
    expect(trace?.nodes.map((node) => node.id)).toEqual([
      taskNode.id,
      firstPlanNode.id,
      retryPlanNode.id,
      runNode.id,
    ]);
    expect(trace?.edges.map((edge) => edge.id)).toEqual([
      "edge-codex-plan-task",
      "edge-codex-plan-retry-task",
      "edge-task-run",
      "edge-run-codex-plan",
      "edge-run-codex-plan-retry",
    ]);
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        productGraphTrace={trace}
        productGraphTraceNodeId={taskNode.id}
        productGraphTraceLoading={false}
        productGraphTraceError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onLoadTrace={onLoadTrace}
      />
    );

    const traceGroupStart = markup.indexOf('aria-label="Traceability"');
    expect(traceGroupStart).toBeGreaterThanOrEqual(0);
    const relationshipsStart = markup.indexOf("Relationships", traceGroupStart);
    expect(relationshipsStart).toBeGreaterThan(traceGroupStart);
    const traceGroupMarkup = markup.slice(traceGroupStart, relationshipsStart);

    expect(traceGroupMarkup).toContain("4 nodes");
    expect(traceGroupMarkup).toContain("5 links");
    expect(traceGroupMarkup.match(/plan - 1 hops/g) ?? []).toHaveLength(2);
    expect(traceGroupMarkup).toContain("Codex plan for Wire checkout status panel");
    expect(traceGroupMarkup).toContain("Retry Codex plan for Wire checkout status panel");
    expect(traceGroupMarkup).toContain("Plan derived from task");
    expect(traceGroupMarkup).toContain("Retry plan derived from task");
    expect(traceGroupMarkup).toContain("Checkout proof run");
    expect(traceGroupMarkup).toContain("agent run - 1 hops");
    expect(traceGroupMarkup).toContain("Task produced by run / Run derived from plan / Run derived from retry plan");
  });

  it("renders selected linked run and evidence details", () => {
    const productGraph = makeLinkedRunFilesProductGraph();
    const runFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "run:checkout-proof")!,
        ...productGraph.nodes.filter((node) => node.id !== "run:checkout-proof"),
      ],
    } satisfies ProductGraphProjection;
    const evidenceFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "evidence:checkout-proof")!,
        ...productGraph.nodes.filter((node) => node.id !== "evidence:checkout-proof"),
      ],
    } satisfies ProductGraphProjection;

    const runMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={runFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );
    const evidenceMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={evidenceFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(runMarkup).toContain("Selected run");
    expect(runMarkup).toContain('aria-label="OpenAgentGraph run details"');
    expect(runMarkup).toContain("graph:checkout-proof");
    expect(runMarkup).toContain("Completed nodes");
    expect(runMarkup).toContain("2");
    expect(runMarkup).toContain("Pass rate");
    expect(runMarkup).toContain("100%");
    expect(runMarkup).toContain("Evidence coverage");
    expect(runMarkup).toContain("75%");

    expect(evidenceMarkup).toContain("Selected evidence");
    expect(evidenceMarkup).toContain('aria-label="Run evidence details"');
    expect(evidenceMarkup).toContain("Changed files");
    expect(evidenceMarkup).toContain("Commands");
    expect(evidenceMarkup).toContain("Test commands");
    expect(evidenceMarkup).toContain("Tool calls");
    expect(evidenceMarkup).toContain("100%");
    expect(evidenceMarkup).toContain("75%");
  });

  it("renders completed-run linking controls only for managers on selected tasks", () => {
    const productGraph = makeProductGraph();
    const taskFirstProductGraph = {
      ...productGraph,
      nodes: [
        productGraph.nodes.find((node) => node.id === "task:checkout-status-panel")!,
        ...productGraph.nodes.filter((node) => node.id !== "task:checkout-status-panel"),
      ],
    } satisfies ProductGraphProjection;

    const managerMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={true}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        completedRuns={[
          makeCompletedRun(),
          makeCompletedRun({ graphId: "graph:running-proof", goalTitle: "Running proof run", graphStatus: "running" }),
        ]}
        onLinkRun={onLinkRun}
      />
    );
    const readOnlyMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={taskFirstProductGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        completedRuns={[makeCompletedRun()]}
        onLinkRun={onLinkRun}
      />
    );

    const runLinkGroupStart = managerMarkup.indexOf('aria-label="Run linking"');
    expect(runLinkGroupStart).toBeGreaterThanOrEqual(0);
    const blockerGroupStart = managerMarkup.indexOf('aria-label="Open question blockers"', runLinkGroupStart);
    expect(blockerGroupStart).toBeGreaterThan(runLinkGroupStart);
    const runLinkMarkup = managerMarkup.slice(runLinkGroupStart, blockerGroupStart);

    expect(runLinkMarkup).toContain("Link completed run");
    expect(runLinkMarkup).toContain("Checkout proof run");
    expect(runLinkMarkup).not.toContain("Running proof run");
    expect(runLinkMarkup).toContain("Link run");
    expect(readOnlyMarkup).not.toContain("Link completed run");
  });

  it("chooses a safe kind filter when focusing product graph nodes", () => {
    const productGraph = makeCodeMapProductGraph();
    const codeNode = productGraph.nodes.find((node) => node.id === "symbol:checkout-controller")!;
    const agentRunNode = {
      ...productGraph.nodes[0],
      id: "run:checkout-proof",
      kind: "agent_run",
      title: "Checkout proof run",
    } satisfies ProductGraphProjection["nodes"][number];

    expect(productKindFilterForNode(codeNode)).toBe("code_symbol");
    expect(productKindFilterForNode(agentRunNode)).toBe("all");
  });

  it("does not select an unrelated node when filters hide every visible node", () => {
    const productGraph = makeProductGraph();

    expect(selectProductGraphNode([], productGraph.nodes[0].id)).toBeNull();
    expect(selectProductGraphNode([productGraph.nodes[1]], productGraph.nodes[0].id)).toEqual(productGraph.nodes[1]);
    expect(selectProductGraphNode([productGraph.nodes[1]], productGraph.nodes[1].id)).toEqual(productGraph.nodes[1]);
  });

  it("renders an empty product intent state", () => {
    const productGraph = {
      ...makeProductGraph(),
      nodes: [],
      edges: [],
      summary: {
        nodeCount: 0,
        edgeCount: 0,
        nodesByKind: {},
        edgesByKind: {},
        unresolvedOpenQuestionCount: 0,
        blockedTaskCount: 0,
      },
    } satisfies ProductGraphProjection;

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={productGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
      />
    );

    expect(markup).toContain("No product intent yet");
    expect(markup).toContain("Feature, story, criterion, question, and task nodes will appear here");
    const quickActionStart = markup.indexOf('aria-label="Work next quick action"');
    expect(quickActionStart).toBeGreaterThanOrEqual(0);
    const healthGroupStart = markup.indexOf('aria-label="Product health"');
    expect(healthGroupStart).toBeGreaterThan(quickActionStart);
    const quickActionMarkup = markup.slice(quickActionStart, healthGroupStart);

    expect(quickActionMarkup).toContain("No planned tasks are ready to queue yet.");
    expect(quickActionMarkup).not.toContain("<button");
    expect(markup).toContain('aria-label="Work next recommendation"');
    expect(markup).toContain("No planned tasks are ready to queue yet.");
  });

  it("bounds and expands rendered product graph node cards for large graph results", () => {
    const nodeCount = PRODUCT_GRAPH_NODE_CARD_RENDER_LIMIT + 12;
    const nodes: ProductGraphProjection["nodes"] = Array.from({ length: nodeCount }, (_, index) => ({
      id: `file:large-${index}`,
      kind: "code_file",
      title: `packages/frontend/src/LargeFile${index}.ts`,
      summary: "Scanned source file.",
      status: "planned",
      source: { kind: "code_scan", label: "Code scan", path: `packages/frontend/src/LargeFile${index}.ts` },
      tags: ["code", "code-scan"],
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    }));
    const productGraph: ProductGraphProjection = {
      ...makeProductGraph(),
      nodes,
      edges: [],
      summary: {
        nodeCount,
        edgeCount: 0,
        nodesByKind: { code_file: nodeCount },
        edgesByKind: {},
        unresolvedOpenQuestionCount: 0,
        blockedTaskCount: 0,
      },
    };

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ProductGraphContent
          productGraph={productGraph}
          productGraphLoading={false}
          productGraphError=""
          onRefresh={onRefresh}
          canManageProductGraph={false}
          onCreateNode={onCreateNode}
          onCreateEdge={onCreateEdge}
          onCreateIntentBundle={onCreateIntentBundle}
        />
      );
    });

    const buttonLabel = (children: unknown): string => (Array.isArray(children) ? children.join("") : String(children ?? ""));

    const initialMarkup = JSON.stringify(renderer!.toJSON());
    expect(initialMarkup).toContain('"Showing "');
    expect(initialMarkup).toContain(`"${PRODUCT_GRAPH_NODE_CARD_RENDER_LIMIT}"`);
    expect(initialMarkup).toContain('" of "');
    expect(initialMarkup).toContain(`"${nodeCount}"`);
    expect(initialMarkup).toContain('" matching nodes"');
    expect(initialMarkup).toContain("Use search, filters, quick filters, or task lenses to narrow large graphs");
    expect(initialMarkup).toContain("packages/frontend/src/LargeFile0.ts");
    expect(initialMarkup).not.toContain(`packages/frontend/src/LargeFile${PRODUCT_GRAPH_NODE_CARD_RENDER_LIMIT + 1}.ts`);

    const showMoreButton = renderer!.root
      .findAllByType("button")
      .find((button) => buttonLabel(button.props.children) === "Show 12 more");
    expect(showMoreButton).toBeTruthy();

    act(() => {
      showMoreButton!.props.onClick();
    });

    const expandedMarkup = JSON.stringify(renderer!.toJSON());
    expect(
      renderer!.root.findAllByType("button").some((button) => buttonLabel(button.props.children).startsWith("Show "))
    ).toBe(false);
    expect(expandedMarkup).toContain(`packages/frontend/src/LargeFile${PRODUCT_GRAPH_NODE_CARD_RENDER_LIMIT + 1}.ts`);
  });

  it("does not auto-load again after a failed initial product graph request", () => {
    expect(shouldAutoLoadProductGraph(null, false, "")).toBe(true);
    expect(shouldAutoLoadProductGraph(null, true, "")).toBe(false);
    expect(shouldAutoLoadProductGraph(null, false, "Product graph could not be loaded.")).toBe(false);
    expect(shouldAutoLoadProductGraph(makeProductGraph(), false, "")).toBe(false);
  });

  it("shows manual graph editing only for product graph managers", () => {
    const managerMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={true}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onGenerateHandoff={onGenerateHandoff}
        onWriteHandoff={onWriteHandoff}
        onScanCodebase={onScanCodebase}
        onImportSpecKit={onImportSpecKit}
      />
    );
    const readOnlyMarkup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={false}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onGenerateHandoff={onGenerateHandoff}
        onWriteHandoff={onWriteHandoff}
        onScanCodebase={onScanCodebase}
        onImportSpecKit={onImportSpecKit}
      />
    );

    expect(managerMarkup).toContain('aria-label="Codebase scan"');
    expect(managerMarkup).toContain('aria-label="Codex handoff"');
    expect(managerMarkup).toContain("Generate Handoff");
    expect(managerMarkup).toContain("Write GRAPH_REPORT.md");
    expect(managerMarkup).toContain("Scan Codebase");
    expect(managerMarkup).toContain("Run Scan Codebase from the manager tools in this sidebar");
    expect(managerMarkup).toContain('aria-label="Spec Kit import"');
    expect(managerMarkup).toContain("Import Spec Kit");
    expect(managerMarkup).toContain("Create feature bundle");
    expect(managerMarkup).toContain("Create bundle");
    expect(managerMarkup).toContain("Add story");
    expect(managerMarkup).toContain("Add criterion");
    expect(managerMarkup).toContain("Add task");
    expect(managerMarkup).toContain("Add intent node");
    expect(managerMarkup).toContain("Create node");
    expect(managerMarkup).toContain("Add relationship");
    expect(managerMarkup).toContain("Create relationship");
    expect(readOnlyMarkup).not.toContain("Scan Codebase");
    expect(readOnlyMarkup).not.toContain("Generate Handoff");
    expect(readOnlyMarkup).not.toContain("Write GRAPH_REPORT.md");
    expect(readOnlyMarkup).not.toContain("Import Spec Kit");
    expect(readOnlyMarkup).not.toContain("Create feature bundle");
    expect(readOnlyMarkup).not.toContain("Add story");
    expect(readOnlyMarkup).not.toContain("Add intent node");
    expect(readOnlyMarkup).not.toContain("Add relationship");
  });

  it("matches backend Product Graph manager roles", () => {
    expect(canManageProductGraph("operator")).toBe(true);
    expect(canManageProductGraph("admin")).toBe(true);
    expect(canManageProductGraph("reviewer")).toBe(false);
    expect(canManageProductGraph("viewer")).toBe(false);
    expect(canManageProductGraph(undefined)).toBe(false);
  });

  it("renders Codex handoff preview, success, and failure status", () => {
    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={makeProductGraph()}
        productGraphLoading={false}
        productGraphError=""
        productGraphHandoff={{
          markdown: "# OpenAgentGraph Handoff\n\n## Read These First\n- `src/App.tsx`\n\n## Risks And Gaps\n- No native codebase scan map is loaded.",
          summary: {
            nodeCount: 4,
            edgeCount: 2,
            codeFileCount: 1,
            codeSymbolCount: 1,
            taskScopeCount: 1,
            riskCount: 1,
            recommendedReadCount: 1,
            generatedAt: "2026-06-02T00:00:00.000Z",
            productGraphId: "default",
            workspaceRoot: "C:/workspace/openagentgraph",
            workspaceRootSource: "configured",
            latestCodeScanUpdatedAt: "2026-06-02T00:00:00.000Z",
            semanticAnalysisSucceeded: false,
            semanticResolutionCount: 0,
            semanticEdgeCount: 0,
            workspacePathCheck: {
              checkedFileCount: 1,
              missingFileCount: 1,
              status: "mismatch",
              warning: "1/1 checked Product Graph code files are missing under the current workspace root.",
            },
          },
        }}
        productGraphHandoffMessage="Generated handoff with 1 recommended reads."
        productGraphHandoffError="GRAPH_REPORT.md could not be written."
        onRefresh={onRefresh}
        canManageProductGraph={true}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onGenerateHandoff={onGenerateHandoff}
        onWriteHandoff={onWriteHandoff}
      />
    );

    expect(markup).toContain('aria-label="Codex handoff preview"');
    expect(markup).toContain('aria-label="Codex handoff trust summary"');
    expect(markup).toContain("Last generated 2026-06-02T00:00:00.000Z");
    expect(markup).toContain("Workspace: C:/workspace/openagentgraph");
    expect(markup).toContain("Product Graph: default");
    expect(markup).toContain("Scan: 2026-06-02T00:00:00.000Z; 1 files, 1 symbols");
    expect(markup).toContain("Semantic: fallback; 0 resolutions, 0 edges");
    expect(markup).toContain("1/1 checked Product Graph code files are missing under the current workspace root.");
    expect(markup).toContain("Generated handoff with 1 recommended reads.");
    expect(markup).toContain("GRAPH_REPORT.md could not be written.");
    expect(markup).toContain("src/App.tsx");
  });

  it("guides users when a code scan exists but product intent is empty", () => {
    const codeOnlyGraph: ProductGraphProjection = {
      schemaVersion: "1",
      productGraphId: "default",
      nodes: [
        {
          id: "file:app",
          kind: "code_file",
          title: "packages/frontend/src/App.tsx",
          summary: "Scanned app shell.",
          status: "planned",
          source: { kind: "code_scan", label: "Code scan", path: "packages/frontend/src/App.tsx" },
          tags: ["code", "code-scan"],
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z",
          incomingEdgeIds: [],
          outgoingEdgeIds: [],
          blockedByNodeIds: [],
        },
      ],
      edges: [],
      events: [],
      summary: {
        nodeCount: 1,
        edgeCount: 0,
        nodesByKind: {
          code_file: 1,
        },
        edgesByKind: {},
        unresolvedOpenQuestionCount: 0,
        blockedTaskCount: 0,
      },
    };

    const markup = renderToStaticMarkup(
      <ProductGraphContent
        productGraph={codeOnlyGraph}
        productGraphLoading={false}
        productGraphError=""
        onRefresh={onRefresh}
        canManageProductGraph={true}
        onCreateNode={onCreateNode}
        onCreateEdge={onCreateEdge}
        onCreateIntentBundle={onCreateIntentBundle}
        onImportSpecKit={onImportSpecKit}
      />
    );

    expect(markup).toContain('aria-label="Product intent empty guidance"');
    expect(markup).toContain("Code Map is ready; product intent is empty.");
    expect(markup).toContain("Import Spec Kit artifacts or create the first feature bundle");
    expect(markup).toContain("The code scan still helps navigation; it is not a replacement for tasks, features, or acceptance criteria.");
  });

  it("summarizes Codex execution readiness for provider and session blockers", () => {
    expect(
      getCodexExecutionReadinessNotice({
        canEditProductGraph: true,
        runtimeStatus: "connected",
        runtimeFallbackLikely: true,
        sessionLifecycle: "signed_in",
      })
    ).toEqual({
      tone: "warning",
      message:
        "AI provider blocks execution: configure the provider, restart the backend, and refresh provider status before starting a run.",
    });

    expect(
      getCodexExecutionReadinessNotice({
        canEditProductGraph: true,
        runtimeStatus: "connected",
        runtimeFallbackLikely: false,
        sessionLifecycle: "expired_session",
      })
    ).toEqual({
      tone: "danger",
      message: "Session blocks execution: update the token before accepting plans or starting a real run.",
    });

    expect(
      getCodexExecutionReadinessNotice({
        canEditProductGraph: false,
        runtimeStatus: "connected",
        runtimeFallbackLikely: false,
        sessionLifecycle: "read_only",
      })
    ).toEqual({
      tone: "warning",
      message:
        "Read-only access: prompt review is available, but operator/admin access is required to accept plans or start execution.",
    });
  });

  it("recognizes node creation refresh warnings separately from hard create failures", () => {
    expect(
      isProductGraphNodeRefreshWarning(
        "Product graph node was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(true);
    expect(isProductGraphNodeRefreshWarning("Product graph node could not be created.")).toBe(false);
    expect(
      isProductGraphNodeRefreshWarning(
        "Product graph edge was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(false);
  });

  it("recognizes edge creation refresh warnings separately from hard create failures", () => {
    expect(
      isProductGraphEdgeRefreshWarning(
        "Product graph edge was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(true);
    expect(isProductGraphEdgeRefreshWarning("Product graph edge could not be created.")).toBe(false);
    expect(
      isProductGraphEdgeRefreshWarning(
        "Product graph node was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(false);
  });

  it("recognizes intent bundle refresh warnings separately from hard create failures", () => {
    expect(
      isProductGraphIntentBundleRefreshWarning(
        "Product graph intent bundle was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(true);
    expect(isProductGraphIntentBundleRefreshWarning("Product graph intent bundle could not be created.")).toBe(false);
    expect(
      isProductGraphIntentBundleRefreshWarning(
        "Product graph edge was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(false);
  });

  it("recognizes Spec Kit import refresh warnings separately from hard import failures", () => {
    expect(
      isProductGraphSpecKitImportRefreshWarning(
        "Product graph Spec Kit import completed, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(true);
    expect(isProductGraphSpecKitImportRefreshWarning("Spec Kit artifacts are missing.")).toBe(false);
    expect(
      isProductGraphSpecKitImportRefreshWarning(
        "Product graph intent bundle was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(false);
  });

  it("recognizes Codebase scan refresh warnings separately from hard import failures", () => {
    expect(
      isProductGraphCodebaseScanRefreshWarning(
        "Product graph Codebase scan completed, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(true);
    expect(isProductGraphCodebaseScanRefreshWarning("Codebase scan output is missing.")).toBe(false);
    expect(
      isProductGraphCodebaseScanRefreshWarning(
        "Product graph Spec Kit import completed, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(false);
  });

  it("formats codebase scan summaries for operator feedback", () => {
    expect(formatCodebaseScanResult({
      status: "scanned",
      message: "Codebase scan completed.",
      scanId: "scan-1",
      scannedAt: "2026-06-01T00:00:00.000Z",
      scanned: {
        fileCount: 1,
        symbolCount: 2,
        edgeCount: 2,
        skippedFileCount: 0,
        skippedDirectoryCount: 0,
        archivedNodeCount: 0,
        archivedEdgeCount: 0,
        durationMs: 10,
        partial: false,
      },
    })).toBe("1 file, 2 symbols, 2 links");
    expect(formatCodebaseScanFeedback({
      status: "scanned",
      message: "Codebase scan completed.",
      scanId: "scan-2",
      scannedAt: "2026-06-01T00:00:00.000Z",
      scanned: {
        fileCount: 1,
        symbolCount: 2,
        edgeCount: 2,
        skippedFileCount: 3,
        skippedDirectoryCount: 1,
        archivedNodeCount: 1,
        archivedEdgeCount: 2,
        durationMs: 20,
        partial: true,
      },
    })).toBe(
      "Codebase scan completed. 1 file, 2 symbols, 2 links, 3 skipped files, 1 skipped folder, 3 archived stale items, partial scan. The scan reached a configured safety cap, so some files were skipped. Review skipped counts and scan again after narrowing generated output."
    );
    expect(formatCodebaseScanFeedback({
      status: "scanned",
      message: "Codebase scan completed.",
      scanId: "scan-breaker",
      scannedAt: "2026-06-01T00:00:00.000Z",
      scanned: {
        fileCount: 1,
        symbolCount: 2,
        edgeCount: 2,
        skippedFileCount: 1,
        skippedDirectoryCount: 0,
        archivedNodeCount: 0,
        archivedEdgeCount: 0,
        durationMs: 20,
        partial: true,
        breakers: {
          lightweight: {
            state: "hit",
            limits: {
              maxFiles: 1,
              maxTotalBytes: 200_000_000,
              maxFileBytes: 5_000_000,
              maxDepth: 40,
              maxDurationMs: 180_000,
            },
            hits: [
              {
                key: "maxFiles",
                limit: 1,
                observed: 2,
                message: "Codebase scan skipped remaining source once file count exceeded 1.",
              },
            ],
            near: [],
          },
          semantic: {
            state: "ok",
            limits: {
              maxFiles: 5_000,
              maxTotalBytes: 50_000_000,
              maxFileBytes: 5_000_000,
              maxDepth: 40,
              maxDurationMs: 30_000,
            },
            hits: [],
            near: [],
          },
        },
      },
    })).toContain("The scan reached an emergency breaker: Codebase scan skipped remaining source once file count exceeded 1.");
    expect(formatCodebaseScanResult({
      status: "scanned",
      message: "Codebase scan completed.",
      scanId: "scan-3",
      scannedAt: "2026-06-01T00:00:00.000Z",
      scanned: {
        fileCount: 3,
        symbolCount: 2,
        communityCount: 1,
        edgeCount: 5,
        dependencyEdgeCount: 2,
        externalDependencyCount: 1,
        semanticAnalysisEnabled: true,
        semanticAnalysisSucceeded: true,
        semanticEdgeCount: 3,
        semanticResolutionCount: 2,
        semanticConfigCount: 2,
        semanticConfiguredFileCount: 4,
        semanticSyntheticFileCount: 2,
        semanticUnconfiguredFileCount: 1,
        semanticConfigPaths: ["desktop/tsconfig.electron.json", "desktop/tsconfig.renderer.json"],
        unresolvedDependencyCount: 1,
        skippedFileCount: 0,
        skippedDirectoryCount: 0,
        archivedNodeCount: 0,
        archivedEdgeCount: 0,
        durationMs: 16,
        partial: false,
      },
    })).toBe("3 files, 2 symbols, 5 links, 1 community, 2 dependency links, 1 external dependency, 3 semantic links, 2 semantic resolutions, 2 semantic configs, 4 files covered by TS config, 2 files covered by synthetic semantic fallback, 1 file without semantic coverage, 1 unresolved dependency");
    expect(formatCodebaseScanResult({
      status: "scanned",
      message: "Codebase scan completed.",
      scanId: "scan-4",
      scannedAt: "2026-06-01T00:00:00.000Z",
      scanned: {
        fileCount: 1,
        symbolCount: 1,
        edgeCount: 2,
        semanticAnalysisEnabled: true,
        semanticAnalysisSucceeded: false,
        semanticEdgeCount: 0,
        semanticResolutionCount: 0,
        semanticFallbackReason: "invalid tsconfig",
        skippedFileCount: 0,
        skippedDirectoryCount: 0,
        archivedNodeCount: 0,
        archivedEdgeCount: 0,
        durationMs: 12,
        partial: false,
      },
    })).toBe("1 file, 1 symbol, 2 links, semantic fallback");
    expect(formatCodebaseScanFeedback({
      status: "scanned",
      message: "Codebase scan completed.",
      scanId: "scan-no-tsconfig",
      scannedAt: "2026-06-01T00:00:00.000Z",
      scanned: {
        fileCount: 1,
        symbolCount: 1,
        edgeCount: 2,
        semanticAnalysisEnabled: false,
        semanticAnalysisSucceeded: false,
        semanticEdgeCount: 0,
        semanticResolutionCount: 0,
        semanticConfigCount: 0,
        semanticConfiguredFileCount: 0,
        semanticUnconfiguredFileCount: 1,
        semanticConfigPaths: [],
        semanticFallbackReason: "No TypeScript project config covered scanned source files.",
        skippedFileCount: 0,
        skippedDirectoryCount: 0,
        archivedNodeCount: 0,
        archivedEdgeCount: 0,
        durationMs: 12,
        partial: false,
      },
    })).toBe(
      "Codebase scan completed. 1 file, 1 symbol, 2 links, 1 file without semantic coverage, semantic not run. Semantic analysis did not run: No TypeScript project config covered scanned source files."
    );
  });

  it("formats Spec Kit import summaries for operator feedback", () => {
    expect(formatSpecKitImportResult({
      status: "imported",
      message: "Spec Kit artifacts imported into the Product Graph.",
      imported: {
        nodeCount: 7,
        edgeCount: 6,
        constitutionCount: 1,
        specFileCount: 1,
        featureCount: 1,
        userStoryCount: 1,
        requirementCount: 1,
        acceptanceCriterionCount: 1,
        openQuestionCount: 0,
        contractFileCount: 1,
        contractCount: 1,
        planFileCount: 0,
        planCount: 0,
        quickstartFileCount: 0,
        quickstartScenarioCount: 0,
        taskFileCount: 1,
        taskCount: 1,
        skippedSpecFileCount: 0,
        skippedContractFileCount: 0,
        skippedPlanFileCount: 0,
        skippedQuickstartFileCount: 0,
        skippedTaskFileCount: 0,
      },
      artifactRoot: ".",
      artifacts: [
        { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: true },
        { key: "specs", relativePath: "specs", kind: "specs", present: true },
      ],
      presentArtifacts: ["constitution", "specs"],
      missingArtifacts: [],
    })).toBe("7 nodes, 6 links, 1 spec, 1 task file, 1 contract file");
  });

  it("recognizes run link refresh warnings separately from hard link failures", () => {
    expect(
      isProductGraphRunLinkRefreshWarning(
        "Product graph run link was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(true);
    expect(isProductGraphRunLinkRefreshWarning("Product graph run link could not be created.")).toBe(false);
    expect(
      isProductGraphRunLinkRefreshWarning(
        "Product graph intent bundle was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(false);
  });

  it("recognizes Codex plan refresh warnings separately from hard accept failures", () => {
    expect(
      isProductGraphCodexPlanRefreshWarning(
        "Product graph Codex plan was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(true);
    expect(isProductGraphCodexPlanRefreshWarning("Product graph Codex plan could not be accepted.")).toBe(false);
    expect(
      isProductGraphCodexPlanRefreshWarning(
        "Product graph run link was created, but the graph could not be refreshed. refresh unavailable"
      )
    ).toBe(false);
  });

  it("hashes Codex plan prompts as SHA-256 hex digests", async () => {
    await expect(hashCodexPlanPrompt("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("includes responsive layout rules for narrow screens", () => {
    expect(PRODUCT_GRAPH_LAYOUT_CSS).toContain("@media (max-width: 900px)");
    expect(PRODUCT_GRAPH_LAYOUT_CSS).toContain(".product-graph-shell");
    expect(PRODUCT_GRAPH_LAYOUT_CSS).toContain("grid-template-columns: 1fr");
    expect(PRODUCT_GRAPH_LAYOUT_CSS).toContain(".product-graph-detail-grid");
  });
});
