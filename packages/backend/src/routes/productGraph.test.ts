import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphProjection, ProductGraphEdge, ProductGraphNode, ProductGraphProjection } from "@openagentgraph/shared";
import { loadAppConfig, setAppConfigForTests } from "../config.js";
import { renderMetricsText, resetMetricsForTests } from "../observability/metrics.js";

const repoMocks = vi.hoisted(() => ({
  appendProductEvent: vi.fn(),
  appendProductEvents: vi.fn(),
  getProductGraphProjection: vi.fn(),
}));
const graphRepoMocks = vi.hoisted(() => ({
  getGraphProjection: vi.fn(),
}));

vi.mock("../db/productGraphRepo.js", () => ({
  DEFAULT_PRODUCT_GRAPH_ID: "default",
  appendProductEvent: repoMocks.appendProductEvent,
  appendProductEvents: repoMocks.appendProductEvents,
  getProductGraphProjection: repoMocks.getProductGraphProjection,
}));
vi.mock("../db/graphRepo.js", () => ({
  getGraphProjection: graphRepoMocks.getGraphProjection,
}));

import { productGraphRoutes } from "./productGraph.js";

function makeProjection(input?: {
  nodes?: ProductGraphProjection["nodes"];
  edges?: ProductGraphEdge[];
}): ProductGraphProjection {
  const nodes = input?.nodes ?? [];
  const edges = input?.edges ?? [];
  return {
    schemaVersion: "1",
    productGraphId: "default",
    nodes,
    edges,
    events: [],
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesByKind: {},
      edgesByKind: {},
      unresolvedOpenQuestionCount: 0,
      blockedTaskCount: 0,
    },
  };
}

function makeExecutionProjection(input: {
  graphId?: string;
  status?: GraphProjection["graph"]["status"];
} = {}): GraphProjection {
  const graphId = input.graphId ?? "graph-1";
  const status = input.status ?? "completed";
  const completedAt = "2026-05-12T00:09:00.000Z";
  return {
    graph: {
      id: graphId,
      title: "Checkout implementation run",
      goal: "Wire the checkout status panel.",
      status,
      originalGoalVersionId: "goal-1",
      activeGoalVersionId: "goal-1",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:10:00.000Z",
    },
    goalPackets: [],
    nodes: [
      {
        id: "node-1",
        graphId,
        kind: "work",
        title: "Wire checkout status panel",
        intent: "Implement and verify the checkout status panel.",
        humanSummary: "The checkout status panel was wired and verified.",
        status: "completed",
        contract: {
          expectedArtifact: "Checkout status panel",
          allowedTools: ["readFile", "writeFile", "runCommand"],
          acceptanceCriteria: ["Checkout status tests pass."],
          humanSummary: "Build the checkout status panel with tests.",
        },
        evidence: {
          fileDiffs: [
            {
              path: "packages/frontend/src/CheckoutStatus.tsx",
              changeType: "created",
              summary: "Added the checkout status panel.",
            },
          ],
          commandResults: [
            {
              command: "npm",
              args: ["test", "--", "CheckoutStatus.test.tsx", "--token=super-secret"],
              cwd: "<workspace>",
              exitCode: 0,
              stdout: "passed",
              stderr: "",
              timedOut: false,
              startedAt: "2026-05-12T00:08:00.000Z",
              finishedAt: completedAt,
            },
          ],
          toolCallLog: [
            {
              id: "tool-1",
              nodeId: "node-1",
              tool: "runCommand",
              input: { command: "npm", args: ["test", "--", "CheckoutStatus.test.tsx", "--token=super-secret"] },
              output: "exit=0",
              startedAt: "2026-05-12T00:08:00.000Z",
              completedAt,
            },
          ],
          workspaceChecksum: "after",
          workspaceChecksumBefore: "before",
          workspaceChecksumAfter: "after",
        },
        evidenceSummary: "Updated 1 workspace file. Ran 1 tool command. All recorded checks passed. The workspace state changed.",
        evidenceCoverage: "grounded",
        confidenceBadge: "high",
        baselineGoalVersionId: "goal-1",
        activeGoalVersionId: "goal-1",
        dependsOnNodeIds: [],
        createdAt: "2026-05-12T00:01:00.000Z",
        updatedAt: completedAt,
        completedAt,
      },
    ],
    edges: [],
    events: [
      {
        id: "evt-1",
        graphId,
        kind: "run.completed",
        payload: { completedNodeIds: ["node-1", "node-2"] },
        ts: "2026-05-12T00:10:00.000Z",
        seq: 7,
      },
    ],
    driftState: "on_track",
    driftSummary: "Run stayed on track.",
    currentDriftSummary: null,
    frontierStatus: "on_track",
    runControlState: "idle",
    canResume: false,
    canPause: false,
    canStop: false,
    approvalState: "not_requested",
    waitingForApproval: false,
    needsHumanReview: false,
    graphAnnotations: [],
    annotationCount: 0,
    lineageDescriptors: [],
    lineageCount: 0,
    plannedNodeCount: 2,
    completedNodeCount: 2,
    failedNodeCount: 0,
    supersededNodeCount: 0,
    revisedNodeCount: 0,
    passRate: 1,
    revisionRate: 0,
    driftTrend: "steady",
    evidenceCoverageRate: 0.75,
    runHealthSummary: "Two steps completed with grounded evidence.",
    alerts: [],
    latestNotificationSummary: "Run completed successfully.",
  };
}

function projectionNode(input: {
  id: string;
  kind: ProductGraphNode["kind"];
  title: string;
  summary?: string;
  source?: ProductGraphNode["source"];
}): ProductGraphProjection["nodes"][number] {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.source ? { source: input.source } : {}),
    status: "planned",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    incomingEdgeIds: [],
    outgoingEdgeIds: [],
    blockedByNodeIds: [],
  };
}

function projectionEdge(input: {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: ProductGraphEdge["kind"];
  label?: string;
  source?: ProductGraphEdge["source"];
  trust?: ProductGraphEdge["trust"];
  metadata?: ProductGraphEdge["metadata"];
}): ProductGraphEdge {
  return {
    id: input.id,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    kind: input.kind,
    label: input.label,
    ...(input.source ? { source: input.source } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    trust: input.trust ?? "manual",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

type RunFileDiff = NonNullable<GraphProjection["nodes"][number]["evidence"]>["fileDiffs"][number];

function withExecutionFileDiffs(projection: GraphProjection, fileDiffs: RunFileDiff[]) {
  const evidence = projection.nodes[0]?.evidence;
  if (!evidence) {
    throw new Error("Expected execution projection fixture to include evidence.");
  }
  evidence.fileDiffs = fileDiffs;
  return projection;
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const tempWorkspacePaths: string[] = [];

function makeTempWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-code-scan-"));
  tempWorkspacePaths.push(workspaceRoot);
  return workspaceRoot;
}

function setProductGraphRouteTestConfig(input: {
  workspaceRoot?: string;
  nodeEnv?: "development" | "test" | "production";
  semanticAnalysisMaxFiles?: string;
  semanticAnalysisMaxTotalBytes?: string;
  semanticAnalysisMaxDurationMs?: string;
} = {}) {
  setAppConfigForTests(
    loadAppConfig({
      NODE_ENV: input.nodeEnv ?? "test",
      OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "true",
      ...(input.workspaceRoot ? { OPENAGENTGRAPH_WORKSPACE_ROOT: input.workspaceRoot } : {}),
      ...(input.semanticAnalysisMaxFiles
        ? { OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_FILES: input.semanticAnalysisMaxFiles }
        : {}),
      ...(input.semanticAnalysisMaxTotalBytes
        ? { OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_TOTAL_BYTES: input.semanticAnalysisMaxTotalBytes }
        : {}),
      ...(input.semanticAnalysisMaxDurationMs
        ? { OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_DURATION_MS: input.semanticAnalysisMaxDurationMs }
        : {}),
    })
  );
}

describe("product graph routes", () => {
  beforeEach(() => {
    repoMocks.appendProductEvent.mockReset();
    repoMocks.appendProductEvents.mockReset();
    repoMocks.getProductGraphProjection.mockReset();
    graphRepoMocks.getGraphProjection.mockReset();
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection());
    graphRepoMocks.getGraphProjection.mockResolvedValue(makeExecutionProjection());
    repoMocks.appendProductEvent.mockImplementation(async (input: any) => ({
      id: "evt-1",
      ts: "2026-04-16T10:00:00.000Z",
      seq: 1,
      ...input,
    }));
    repoMocks.appendProductEvents.mockImplementation(async (inputs: any[]) =>
      inputs.map((input, index) => ({
        id: `evt-${index + 1}`,
        ts: "2026-04-16T10:00:00.000Z",
        seq: index + 1,
        ...input,
      }))
    );
    setProductGraphRouteTestConfig();
    resetMetricsForTests();
  });

  afterEach(() => {
    for (const workspaceRoot of tempWorkspacePaths.splice(0)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
    setAppConfigForTests(undefined);
    resetMetricsForTests();
  });

  it("returns the default product graph projection", async () => {
    const projection = makeProjection();
    repoMocks.getProductGraphProjection.mockResolvedValue(projection);
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(projection);
    expect(repoMocks.getProductGraphProjection).toHaveBeenCalledWith("default");
    await app.close();
  });

  it("returns a deterministic Product Graph handoff without requiring a model provider", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "packages/frontend/src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "packages/frontend/src/CheckoutStatus.tsx"), "export function CheckoutStatus() {}", "utf8");
    setProductGraphRouteTestConfig({ workspaceRoot });
    const codeFile = projectionNode({
      id: "file:checkout",
      kind: "code_file",
      title: "packages/frontend/src/CheckoutStatus.tsx",
      summary: "Scanned code file.",
      source: { kind: "code_scan", label: "Code scan", path: "packages/frontend/src/CheckoutStatus.tsx" },
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(
      makeProjection({
        nodes: [codeFile],
      })
    );
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/handoff",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.summary).toMatchObject({
      nodeCount: 1,
      edgeCount: 0,
      codeFileCount: 1,
      codeSymbolCount: 0,
      workspaceRoot,
      workspaceRootSource: "configured",
      productGraphId: "default",
      workspacePathCheck: {
        checkedFileCount: 1,
        missingFileCount: 0,
        status: "aligned",
      },
    });
    expect(body.summary.generatedAt).toEqual(expect.any(String));
    expect(body.markdown).toContain("# OpenAgentGraph Handoff");
    expect(body.markdown).toContain(`Workspace root: \`${workspaceRoot}\` (configured).`);
    expect(body.markdown).toContain("Workspace path check: aligned; 0/1 checked code files missing under the workspace root.");
    expect(body.markdown).toContain("Graph data source:");
    expect(body.markdown).toContain("packages/frontend/src/CheckoutStatus.tsx");
    expect(repoMocks.getProductGraphProjection).toHaveBeenCalledWith("default");
    await app.close();
  });

  it("redacts absolute handoff source paths from production report metadata", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src/app.ts"), "export const app = true;", "utf8");
    setProductGraphRouteTestConfig({ workspaceRoot, nodeEnv: "production" });
    const codeFile = projectionNode({
      id: "file:app",
      kind: "code_file",
      title: "src/app.ts",
      summary: "Scanned code file.",
      source: { kind: "code_scan", label: "Code scan", path: "src/app.ts" },
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [codeFile] }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/handoff",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.summary).toMatchObject({
      workspaceRoot: "configured workspace root",
      dataSource: "SQLite database",
      workspacePathCheck: {
        checkedFileCount: 1,
        missingFileCount: 0,
        status: "aligned",
      },
    });
    expect(body.markdown).toContain("Workspace root: `configured workspace root` (configured).");
    expect(body.markdown).toContain("Graph data source: `SQLite database`.");
    expect(body.markdown).not.toContain(workspaceRoot);
    await app.close();
  });

  it("returns useful bootstrap handoff content for an empty Product Graph", async () => {
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection());
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/handoff",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.summary.nodeCount).toBe(0);
    expect(body.summary.riskCount).toBeGreaterThan(0);
    expect(body.markdown).toContain("Product Graph is empty.");
    expect(body.markdown).toContain("`LLMS.md`");
    await app.close();
  });

  it("returns a product graph trace for an existing node", async () => {
    const requirement = projectionNode({
      id: "requirement:checkout-status",
      kind: "requirement",
      title: "Checkout status is visible",
    });
    const task = projectionNode({
      id: "task:checkout-panel",
      kind: "task",
      title: "Wire checkout panel",
    });
    const codeFile = projectionNode({
      id: "file:src-checkout",
      kind: "code_file",
      title: "src/checkout.ts",
    });
    const testResult = projectionNode({
      id: "test:checkout-panel",
      kind: "test_result",
      title: "Checkout panel test",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(
      makeProjection({
        nodes: [requirement, task, codeFile, testResult],
        edges: [
          projectionEdge({
            id: "edge-task-requirement",
            sourceNodeId: task.id,
            targetNodeId: requirement.id,
            kind: "implements",
          }),
          projectionEdge({
            id: "edge-task-code",
            sourceNodeId: task.id,
            targetNodeId: codeFile.id,
            kind: "touches",
          }),
          projectionEdge({
            id: "edge-test-requirement",
            sourceNodeId: testResult.id,
            targetNodeId: requirement.id,
            kind: "verifies",
          }),
        ],
      })
    );
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/trace/requirement:checkout-status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: "1",
      productGraphId: "default",
      rootNode: { id: requirement.id },
      hopsByNodeId: {
        [requirement.id]: 0,
        [task.id]: 1,
        [testResult.id]: 1,
        [codeFile.id]: 2,
      },
      summary: {
        nodeCount: 4,
        edgeCount: 3,
        maxDepth: 2,
        codeNodeCount: 1,
        testResultNodeCount: 1,
        evidenceNodeCount: 0,
      },
    });
    expect(response.json().nodes.map((node: ProductGraphProjection["nodes"][number]) => node.id)).toEqual([
      requirement.id,
      task.id,
      testResult.id,
      codeFile.id,
    ]);
    expect(response.json().edges.map((edge: ProductGraphEdge) => edge.id)).toEqual([
      "edge-task-requirement",
      "edge-task-code",
      "edge-test-requirement",
    ]);
    expect(repoMocks.getProductGraphProjection).toHaveBeenCalledWith("default");
    await app.close();
  });

  it("returns linked run evidence and changed files in product graph traces", async () => {
    const task = projectionNode({
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
    });
    const run = projectionNode({
      id: "run:checkout-proof",
      kind: "agent_run",
      title: "Checkout proof run",
    });
    const evidence = projectionNode({
      id: "evidence:checkout-proof",
      kind: "evidence",
      title: "Checkout proof run evidence",
    });
    const codeFile = projectionNode({
      id: "file:checkout-status",
      kind: "code_file",
      title: "packages/frontend/src/CheckoutStatus.tsx",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(
      makeProjection({
        nodes: [task, run, evidence, codeFile],
        edges: [
          projectionEdge({
            id: "edge-task-run",
            sourceNodeId: task.id,
            targetNodeId: run.id,
            kind: "produced_by",
            label: "Task produced by run",
          }),
          projectionEdge({
            id: "edge-evidence-run",
            sourceNodeId: evidence.id,
            targetNodeId: run.id,
            kind: "produced_by",
            label: "Evidence produced by run",
          }),
          projectionEdge({
            id: "edge-run-file",
            sourceNodeId: run.id,
            targetNodeId: codeFile.id,
            kind: "touches",
            label: "Run changed file",
          }),
        ],
      })
    );
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/trace/task:checkout-status-panel",
    });

    expect(response.statusCode).toBe(200);
    const trace = response.json();
    expect(trace).toMatchObject({
      rootNode: { id: task.id },
      hopsByNodeId: {
        [task.id]: 0,
        [run.id]: 1,
        [evidence.id]: 2,
        [codeFile.id]: 2,
      },
      summary: {
        nodeCount: 4,
        edgeCount: 3,
        maxDepth: 2,
        codeNodeCount: 1,
        testResultNodeCount: 0,
        evidenceNodeCount: 1,
      },
    });
    expect(trace.nodes.map((node: ProductGraphProjection["nodes"][number]) => node.id)).toEqual([
      task.id,
      run.id,
      evidence.id,
      codeFile.id,
    ]);
    expect(trace.edges.map((edge: ProductGraphEdge) => edge.id)).toEqual([
      "edge-task-run",
      "edge-evidence-run",
      "edge-run-file",
    ]);
    await app.close();
  });

  it("returns multiple accepted plan paths in task traces", async () => {
    const task = projectionNode({
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
    });
    const firstPlan: ProductGraphProjection["nodes"][number] = {
      ...projectionNode({
        id: "plan:codex:checkout-status-panel",
        kind: "plan",
        title: "Accepted checkout status panel plan",
      }),
      tags: ["codex", "planning"],
      metadata: {
        taskNodeId: task.id,
        promptHash: "0".repeat(64),
      },
    };
    const secondPlan: ProductGraphProjection["nodes"][number] = {
      ...projectionNode({
        id: "plan:codex:checkout-status-panel-retry",
        kind: "plan",
        title: "Accepted checkout status panel retry plan",
      }),
      tags: ["codex", "planning"],
      metadata: {
        taskNodeId: task.id,
        promptHash: "2".repeat(64),
      },
    };
    const run = projectionNode({
      id: "run:checkout-proof",
      kind: "agent_run",
      title: "Checkout proof run",
    });
    const firstPlanTaskEdge = projectionEdge({
      id: "edge-plan-task",
      sourceNodeId: firstPlan.id,
      targetNodeId: task.id,
      kind: "derived_from",
      label: "Plan derived from task",
    });
    const secondPlanTaskEdge = projectionEdge({
      id: "edge-plan-retry-task",
      sourceNodeId: secondPlan.id,
      targetNodeId: task.id,
      kind: "derived_from",
      label: "Retry plan derived from task",
    });
    const taskRunEdge = projectionEdge({
      id: "edge-task-run",
      sourceNodeId: task.id,
      targetNodeId: run.id,
      kind: "produced_by",
      label: "Task produced by run",
    });
    const runFirstPlanEdge = projectionEdge({
      id: "edge-run-plan",
      sourceNodeId: run.id,
      targetNodeId: firstPlan.id,
      kind: "derived_from",
      label: "Run derived from plan",
    });
    const runSecondPlanEdge = projectionEdge({
      id: "edge-run-retry-plan",
      sourceNodeId: run.id,
      targetNodeId: secondPlan.id,
      kind: "derived_from",
      label: "Run derived from retry plan",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(
      makeProjection({
        nodes: [task, firstPlan, secondPlan, run],
        edges: [
          firstPlanTaskEdge,
          secondPlanTaskEdge,
          taskRunEdge,
          runFirstPlanEdge,
          runSecondPlanEdge,
        ],
      })
    );
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/trace/task:checkout-status-panel",
    });

    expect(response.statusCode).toBe(200);
    const trace = response.json();
    expect(trace).toMatchObject({
      rootNode: { id: task.id },
      hopsByNodeId: {
        [task.id]: 0,
        [firstPlan.id]: 1,
        [secondPlan.id]: 1,
        [run.id]: 1,
      },
      summary: {
        nodeCount: 4,
        edgeCount: 5,
        maxDepth: 2,
        codeNodeCount: 0,
        testResultNodeCount: 0,
        evidenceNodeCount: 0,
      },
    });
    expect(trace.nodes.map((node: ProductGraphProjection["nodes"][number]) => node.id)).toEqual([
      task.id,
      firstPlan.id,
      secondPlan.id,
      run.id,
    ]);
    expect(trace.edges.map((edge: ProductGraphEdge) => edge.id).sort()).toEqual(
      [
        firstPlanTaskEdge.id,
        runFirstPlanEdge.id,
        runSecondPlanEdge.id,
        secondPlanTaskEdge.id,
        taskRunEdge.id,
      ].sort()
    );
    const traceFirstPlan = trace.nodes.find(
      (node: ProductGraphProjection["nodes"][number]) => node.id === firstPlan.id
    );
    const traceSecondPlan = trace.nodes.find(
      (node: ProductGraphProjection["nodes"][number]) => node.id === secondPlan.id
    );
    const traceRun = trace.nodes.find((node: ProductGraphProjection["nodes"][number]) => node.id === run.id);
    expect(traceFirstPlan).toMatchObject({
      tags: ["codex", "planning"],
      metadata: {
        taskNodeId: task.id,
        promptHash: "0".repeat(64),
      },
    });
    expect(traceFirstPlan?.incomingEdgeIds).toEqual([runFirstPlanEdge.id]);
    expect(traceFirstPlan?.outgoingEdgeIds).toEqual([firstPlanTaskEdge.id]);
    expect(traceSecondPlan).toMatchObject({
      tags: ["codex", "planning"],
      metadata: {
        taskNodeId: task.id,
        promptHash: "2".repeat(64),
      },
    });
    expect(traceSecondPlan?.incomingEdgeIds).toEqual([runSecondPlanEdge.id]);
    expect(traceSecondPlan?.outgoingEdgeIds).toEqual([secondPlanTaskEdge.id]);
    expect(traceRun?.incomingEdgeIds).toEqual([taskRunEdge.id]);
    expect(traceRun?.outgoingEdgeIds).toEqual([runFirstPlanEdge.id, runSecondPlanEdge.id]);
    await app.close();
  });

  it("returns 400 for invalid trace node ids", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/trace/bad%20node",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "nodeId may only contain letters, numbers, dots, underscores, colons, and dashes.",
    });
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 404 for missing trace roots", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/trace/missing-node",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Product graph node was not found." });
    expect(repoMocks.getProductGraphProjection).toHaveBeenCalledWith("default");
    await app.close();
  });

  it("returns a Codex planning prompt for product graph tasks", async () => {
    const workspaceRoot = makeTempWorkspace();
    setProductGraphRouteTestConfig({ workspaceRoot });
    const task = projectionNode({
      id: "task:checkout-panel",
      kind: "task",
      title: "Wire checkout panel",
      summary: "Implement the checkout status panel.",
    });
    const criterion = projectionNode({
      id: "criterion:checkout-visible",
      kind: "acceptance_criterion",
      title: "Checkout status is visible",
    });
    const codeFile = projectionNode({
      id: "file:checkout-status",
      kind: "code_file",
      title: "packages/frontend/src/CheckoutStatus.tsx",
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/frontend/src/CheckoutStatus.tsx",
        line: 12,
      },
    });
    codeFile.tags = ["code-scan", "code"];
    codeFile.metadata = { scannerSourceFile: "packages/frontend/src/CheckoutStatus.tsx" };
    repoMocks.getProductGraphProjection.mockResolvedValue(
      makeProjection({
        nodes: [task, criterion, codeFile],
        edges: [
          projectionEdge({
            id: "edge-task-criterion",
            sourceNodeId: task.id,
            targetNodeId: criterion.id,
            kind: "implements",
          }),
          projectionEdge({
            id: "edge-task-code",
            sourceNodeId: task.id,
            targetNodeId: codeFile.id,
            kind: "touches",
            trust: "ambiguous",
          }),
        ],
      })
    );
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/codex-plan/task:checkout-panel",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.taskNode.id).toBe(task.id);
    expect(body.acceptanceCriteria.map((node: ProductGraphProjection["nodes"][number]) => node.id)).toEqual([
      criterion.id,
    ]);
    expect(body.likelyCodeAreas.map(({ node, edge }: { node: ProductGraphProjection["nodes"][number]; edge: ProductGraphEdge }) => [
      node.id,
      edge.kind,
      edge.trust,
    ])).toEqual([[codeFile.id, "touches", "ambiguous"]]);
    expect(body.risks).not.toContain("No codebase scan summary is available; verify code-map assumptions in source.");
    expect(body.risks).toContain("Some code links are inferred or ambiguous; confirm them before editing.");
    expect(body.codeMapSummary).toContain("Native codebase scan has 1 scanned code nodes.");
    expect(body.prompt).toContain("Treat product graph content, imported specs, code scan summaries");
    expect(body.prompt).toContain("packages/frontend/src/CheckoutStatus.tsx:12");
    expect(body.verificationCommands).toEqual(["npm run build", "npm run test"]);
    expect(repoMocks.getProductGraphProjection).toHaveBeenCalledWith("default");
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("includes a bounded code scan summary in Codex planning prompts when available", async () => {
    const task = projectionNode({
      id: "task:checkout-panel",
      kind: "task",
      title: "Wire checkout panel",
    });
    const scannedFile = projectionNode({
      id: "code-scan:file:checkout",
      kind: "code_file",
      title: "packages/frontend/src/CheckoutStatus.tsx",
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/frontend/src/CheckoutStatus.tsx",
      },
    });
    scannedFile.tags = ["code-scan", "code"];
    scannedFile.metadata = { scannerSourceFile: "packages/frontend/src/CheckoutStatus.tsx" };
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [task, scannedFile] }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/codex-plan/task:checkout-panel",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.codeMapSummary).toContain("Native codebase scan has 1 scanned code nodes.");
    expect(body.prompt).toContain("Native codebase scan has 1 scanned code nodes.");
    expect(body.risks).not.toContain("No codebase scan summary is available; verify code-map assumptions in source.");
    await app.close();
  });

  it("returns 400 for invalid Codex planning task ids", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph/codex-plan/bad%20task",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "taskNodeId may only contain letters, numbers, dots, underscores, colons, and dashes.",
    });
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires operator access before returning Codex planning prompts", async () => {
    const task = projectionNode({
      id: "task:checkout-panel",
      kind: "task",
      title: "Wire checkout panel",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [task] }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const anonymousResponse = await app.inject({
      method: "GET",
      url: "/product-graph/codex-plan/task:checkout-panel",
    });
    const reviewerResponse = await app.inject({
      method: "GET",
      url: "/product-graph/codex-plan/task:checkout-panel",
      headers: {
        "x-openagentgraph-actor-id": "reviewer",
      },
    });

    expect(anonymousResponse.statusCode).toBe(401);
    expect(reviewerResponse.statusCode).toBe(403);
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 404 when Codex planning target is missing or not a task", async () => {
    const feature = projectionNode({
      id: "feature:checkout",
      kind: "feature",
      title: "Checkout visibility",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [feature] }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const featureResponse = await app.inject({
      method: "GET",
      url: "/product-graph/codex-plan/feature:checkout",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });
    const missingResponse = await app.inject({
      method: "GET",
      url: "/product-graph/codex-plan/task:missing",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(featureResponse.statusCode).toBe(404);
    expect(featureResponse.json()).toEqual({ error: "Product graph task was not found." });
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toEqual({ error: "Product graph task was not found." });
    expect(repoMocks.getProductGraphProjection).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("persists accepted Codex planning prompts as plan nodes", async () => {
    const workspaceRoot = makeTempWorkspace();
    setProductGraphRouteTestConfig({ workspaceRoot });
    const task = projectionNode({
      id: "task:checkout-panel",
      kind: "task",
      title: "Wire checkout panel",
      summary: "Implement the checkout status panel.",
    });
    const criterion = projectionNode({
      id: "criterion:checkout-visible",
      kind: "acceptance_criterion",
      title: "Checkout status is visible",
    });
    const codeFile = projectionNode({
      id: "file:checkout-status",
      kind: "code_file",
      title: "packages/frontend/src/CheckoutStatus.tsx",
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/frontend/src/CheckoutStatus.tsx",
        line: 12,
      },
    });
    codeFile.tags = ["code-scan", "code"];
    codeFile.metadata = { scannerSourceFile: "packages/frontend/src/CheckoutStatus.tsx" };
    repoMocks.getProductGraphProjection.mockResolvedValue(
      makeProjection({
        nodes: [task, criterion, codeFile],
        edges: [
          projectionEdge({
            id: "edge-task-criterion",
            sourceNodeId: task.id,
            targetNodeId: criterion.id,
            kind: "implements",
          }),
          projectionEdge({
            id: "edge-task-code",
            sourceNodeId: task.id,
            targetNodeId: codeFile.id,
            kind: "touches",
            trust: "ambiguous",
          }),
        ],
      })
    );
    const app = Fastify();
    await app.register(productGraphRoutes);

    const planningResponse = await app.inject({
      method: "GET",
      url: "/product-graph/codex-plan/task:checkout-panel",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });
    expect(planningResponse.statusCode).toBe(200);
    const promptHash = sha256Hex(planningResponse.json<{ prompt: string }>().prompt);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/codex-plan/task:checkout-panel/accept",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        title: "Accepted checkout implementation plan",
        summary: "Ready for implementation.",
        promptHash,
      },
    });

    expect(response.statusCode).toBe(201);
    const acceptedPlan = response.json<{
      node: ProductGraphNode;
      edge: ProductGraphEdge;
    }>();
    expect(acceptedPlan.node.id).toMatch(/^plan:codex:/);
    expect(acceptedPlan.node).toMatchObject({
      kind: "plan",
      title: "Accepted checkout implementation plan",
      summary: "Ready for implementation.",
      status: "planned",
      tags: ["codex", "planning"],
      source: {
        kind: "manual",
        label: "Accepted Codex planning prompt",
      },
      metadata: {
        taskNodeId: task.id,
        promptHash,
        acceptanceCriterionCount: 1,
        likelyCodeAreaCount: 1,
        openQuestionCount: 0,
        riskCount: 1,
        verificationCommandCount: 2,
        hasCodeMapSummary: true,
      },
    });
    expect(acceptedPlan.node.body).toContain("## Current task");
    expect(acceptedPlan.node.body).toContain("Wire checkout panel (task:checkout-panel)");
    expect(acceptedPlan.node.body).toContain("packages/frontend/src/CheckoutStatus.tsx:12");
    expect(acceptedPlan.edge).toMatchObject({
      sourceNodeId: acceptedPlan.node.id,
      targetNodeId: task.id,
      kind: "derived_from",
      trust: "manual",
      label: "Plan derived from task",
      source: {
        kind: "manual",
        label: "Accepted Codex planning prompt",
      },
      metadata: {
        taskNodeId: task.id,
        planNodeId: acceptedPlan.node.id,
      },
    });

    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);
    const batch = repoMocks.appendProductEvents.mock.calls[0][0] as any[];
    expect(batch).toHaveLength(2);
    expect(batch[0]).toMatchObject({
      productGraphId: "default",
      kind: "product.node.upserted",
      nodeId: acceptedPlan.node.id,
      payload: {
        node: acceptedPlan.node,
        actor: expect.objectContaining({ actorId: "operator" }),
      },
    });
    expect(batch[1]).toMatchObject({
      productGraphId: "default",
      kind: "product.edge.upserted",
      edgeId: acceptedPlan.edge.id,
      payload: {
        edge: acceptedPlan.edge,
        actor: expect.objectContaining({ actorId: "operator" }),
      },
    });
    await app.close();
  });

  it("rejects Codex planning prompt persistence when actor context is missing", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/codex-plan/task:checkout-panel/accept",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "This action requires a signed-in operator." });
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks reviewers from accepting Codex planning prompts", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/codex-plan/task:checkout-panel/accept",
      headers: {
        "x-openagentgraph-actor-id": "reviewer",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "This action requires operator access." });
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    expect(renderMetricsText()).toContain('openagentgraph_permission_denials_total{action="manage_product_graph"} 1');
    await app.close();
  });

  it("rejects accepted Codex planning prompts when the loaded prompt hash is stale", async () => {
    const workspaceRoot = makeTempWorkspace();
    setProductGraphRouteTestConfig({ workspaceRoot });
    const task = projectionNode({
      id: "task:checkout-panel",
      kind: "task",
      title: "Wire checkout panel",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [task] }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/codex-plan/task:checkout-panel/accept",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        promptHash: "0".repeat(64),
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Codex planning prompt changed. Reload the plan before accepting it.",
    });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects malformed Codex planning prompt hashes", async () => {
    const workspaceRoot = makeTempWorkspace();
    setProductGraphRouteTestConfig({ workspaceRoot });
    const task = projectionNode({
      id: "task:checkout-panel",
      kind: "task",
      title: "Wire checkout panel",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [task] }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/codex-plan/task:checkout-panel/accept",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        promptHash: "not-a-sha256-hash",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "promptHash must be a SHA-256 hex digest." });
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not persist accepted Codex planning prompts for missing tasks", async () => {
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection());
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/codex-plan/task:missing/accept",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Product graph task was not found." });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects node writes when actor context is missing", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/nodes",
      payload: {
        kind: "feature",
        title: "Intent Graph",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "This action requires a signed-in operator." });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(renderMetricsText()).toContain('openagentgraph_permission_denials_total{action="auth_required"} 1');
    await app.close();
  });

  it("blocks reviewers from managing the product graph", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/nodes",
      headers: {
        "x-openagentgraph-actor-id": "reviewer",
      },
      payload: {
        kind: "feature",
        title: "Intent Graph",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "This action requires operator access." });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(renderMetricsText()).toContain('openagentgraph_permission_denials_total{action="manage_product_graph"} 1');
    await app.close();
  });

  it("rejects codebase scans when actor context is missing", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/codebase/scan",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "This action requires a signed-in operator." });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    expect(renderMetricsText()).toContain('openagentgraph_permission_denials_total{action="auth_required"} 1');
    await app.close();
  });

  it("rejects handoff writes when actor context is missing or read-only", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const missingActorResponse = await app.inject({
      method: "POST",
      url: "/product-graph/handoff/write",
    });
    const reviewerResponse = await app.inject({
      method: "POST",
      url: "/product-graph/handoff/write",
      headers: {
        "x-openagentgraph-actor-id": "reviewer",
      },
    });
    const viewerResponse = await app.inject({
      method: "POST",
      url: "/product-graph/handoff/write",
      headers: {
        "x-openagentgraph-actor-id": "viewer",
      },
    });

    expect(missingActorResponse.statusCode).toBe(401);
    expect(missingActorResponse.json()).toEqual({ error: "This action requires a signed-in operator." });
    expect(reviewerResponse.statusCode).toBe(403);
    expect(reviewerResponse.json()).toEqual({ error: "This action requires operator access." });
    expect(viewerResponse.statusCode).toBe(403);
    expect(viewerResponse.json()).toEqual({ error: "This action requires operator access." });
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    await app.close();
  });

  it("writes the fixed GRAPH_REPORT.md handoff under the configured workspace root", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src/checkout.ts"), "export const checkout = true;", "utf8");
    setProductGraphRouteTestConfig({ workspaceRoot });
    const codeFile = projectionNode({
      id: "file:checkout",
      kind: "code_file",
      title: "src/checkout.ts",
      source: { kind: "code_scan", label: "Code scan", path: "src/checkout.ts" },
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [codeFile] }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/handoff/write",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });
    const outputPath = path.join(workspaceRoot, "GRAPH_REPORT.md");

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "written",
      path: "GRAPH_REPORT.md",
      summary: {
        nodeCount: 1,
        codeFileCount: 1,
        workspaceRoot,
        workspacePathCheck: {
          checkedFileCount: 1,
          missingFileCount: 0,
          status: "aligned",
        },
      },
    });
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, "utf8")).toContain("# OpenAgentGraph Handoff");
    expect(fs.readFileSync(outputPath, "utf8")).toContain(`Workspace root: \`${workspaceRoot}\` (configured).`);
    expect(repoMocks.getProductGraphProjection).toHaveBeenCalledWith("default");
    await app.close();
  });

  it("blocks GRAPH_REPORT.md writes when scanned code paths do not match the workspace", async () => {
    const workspaceRoot = makeTempWorkspace();
    setProductGraphRouteTestConfig({ workspaceRoot });
    const codeFile = projectionNode({
      id: "file:other-workspace",
      kind: "code_file",
      title: "desktop/src/renderer/App.tsx",
      source: { kind: "code_scan", label: "Code scan", path: "desktop/src/renderer/App.tsx" },
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [codeFile] }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/handoff/write",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining("Product Graph code paths do not match"),
      workspacePathCheck: {
        checkedFileCount: 1,
        missingFileCount: 1,
        status: "mismatch",
      },
    });
    expect(fs.existsSync(path.join(workspaceRoot, "GRAPH_REPORT.md"))).toBe(false);
    await app.close();
  });

  it("rejects Spec Kit imports when actor context is missing", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "This action requires a signed-in operator." });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    expect(renderMetricsText()).toContain('openagentgraph_permission_denials_total{action="auth_required"} 1');
    await app.close();
  });

  it("blocks reviewers from importing Spec Kit artifacts", async () => {
    const workspaceRoot = makeTempWorkspace();
    const specifyMemory = path.join(workspaceRoot, ".specify", "memory");
    fs.mkdirSync(specifyMemory, { recursive: true });
    fs.writeFileSync(path.join(specifyMemory, "constitution.md"), "# Constitution\n");
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "reviewer",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "This action requires operator access." });
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    expect(renderMetricsText()).toContain('openagentgraph_permission_denials_total{action="manage_product_graph"} 1');
    await app.close();
  });

  it("reports missing Spec Kit artifacts from the configured workspace", async () => {
    const workspaceRoot = makeTempWorkspace();
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      status: "missing_artifacts",
      message:
        "Spec Kit artifacts are missing. Add .specify/memory/constitution.md or Spec Kit files under specs/ before importing.",
      artifactRoot: ".",
      artifacts: [
        { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: false },
        { key: "specs", relativePath: "specs", kind: "specs", present: false },
      ],
      presentArtifacts: [],
      missingArtifacts: [".specify/memory/constitution.md", "specs"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not treat an unrelated specs folder as Spec Kit artifacts", async () => {
    const workspaceRoot = makeTempWorkspace();
    const unrelatedSpecs = path.join(workspaceRoot, "specs", "notes");
    fs.mkdirSync(unrelatedSpecs, { recursive: true });
    fs.writeFileSync(path.join(unrelatedSpecs, "README.md"), "# Notes\n");
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      status: "missing_artifacts",
      artifacts: [
        { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: false },
        { key: "specs", relativePath: "specs", kind: "specs", present: false },
      ],
      presentArtifacts: [],
      missingArtifacts: [".specify/memory/constitution.md", "specs"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("imports Spec Kit constitution and spec.md intent nodes", async () => {
    const workspaceRoot = makeTempWorkspace();
    const specifyMemory = path.join(workspaceRoot, ".specify", "memory");
    const checkoutSpec = path.join(workspaceRoot, "specs", "checkout");
    fs.mkdirSync(specifyMemory, { recursive: true });
    fs.mkdirSync(checkoutSpec, { recursive: true });
    fs.writeFileSync(path.join(specifyMemory, "constitution.md"), "# Constitution\n\nKeep decisions traceable.\n");
    fs.writeFileSync(
      path.join(checkoutSpec, "spec.md"),
      [
        "# Checkout status",
        "",
        "**Status**: Draft",
        "",
        "Checkout should show the latest payment state.",
        "",
        "## User Scenarios & Testing",
        "",
        "### User Story 1 - Buyer sees status (Priority: P1)",
        "",
        "Buyer sees the current payment status.",
        "",
        "#### Acceptance Scenarios",
        "",
        "1. **Given** an order exists, **When** checkout completes, **Then** the status is visible.",
        "",
        "## Requirements",
        "",
        "### Functional Requirements",
        "",
        "- **FR-001**: System MUST show checkout status.",
        "- **FR-002**: System MUST [NEEDS CLARIFICATION: decide refund copy].",
        "[NEEDS CLARIFICATION: choose notification owner]",
        "",
      ].join("\n")
    );
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      status: "imported",
      message: "Spec Kit artifacts imported into the Product Graph.",
      imported: {
        nodeCount: 8,
        edgeCount: 7,
        constitutionCount: 1,
        specFileCount: 1,
        featureCount: 1,
        userStoryCount: 1,
        requirementCount: 2,
        acceptanceCriterionCount: 1,
        openQuestionCount: 2,
        contractFileCount: 0,
        contractCount: 0,
        planFileCount: 0,
        planCount: 0,
        quickstartFileCount: 0,
        quickstartScenarioCount: 0,
        taskFileCount: 0,
        taskCount: 0,
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
      presentArtifacts: [".specify/memory/constitution.md", "specs"],
      missingArtifacts: [],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);

    const batch = repoMocks.appendProductEvents.mock.calls[0][0];
    expect(batch).toHaveLength(15);
    const nodes = batch
      .filter((event: any) => event.kind === "product.node.upserted")
      .map((event: any) => event.payload.node as ProductGraphNode);
    const edges = batch
      .filter((event: any) => event.kind === "product.edge.upserted")
      .map((event: any) => event.payload.edge as ProductGraphEdge);
    const nodeByTitle = new Map(nodes.map((node) => [node.title, node]));
    const featureNode = nodeByTitle.get("Checkout status");
    const storyNode = nodeByTitle.get("Buyer sees status");

    expect(nodeByTitle.get("Constitution")).toMatchObject({
      kind: "requirement",
      source: {
        kind: "spec_kit",
        label: "Spec Kit import",
        path: ".specify/memory/constitution.md",
      },
      metadata: {
        specKitArtifactType: "constitution",
        specKitPath: ".specify/memory/constitution.md",
      },
    });
    expect(featureNode).toMatchObject({
      kind: "feature",
      summary: "Checkout should show the latest payment state.",
      source: {
        kind: "spec_kit",
        label: "Spec Kit import",
        path: "specs/checkout/spec.md",
      },
      metadata: {
        specKitArtifactType: "spec",
        specKitSlug: "checkout",
      },
    });
    expect(storyNode).toMatchObject({
      kind: "user_story",
      metadata: {
        specKitArtifactType: "user_story",
        specKitStoryNumber: "1",
      },
    });
    expect(nodeByTitle.get("FR-001: System MUST show checkout status.")).toMatchObject({
      kind: "requirement",
      body: "System MUST show checkout status.",
      source: {
        line: 21,
      },
      metadata: {
        specKitArtifactType: "requirement",
        specKitRequirementId: "FR-001",
      },
    });
    const refundRequirement = nodeByTitle.get("FR-002: System MUST.");
    const refundQuestion = nodeByTitle.get("decide refund copy");
    const ownerQuestion = nodeByTitle.get("choose notification owner");
    expect(refundRequirement).toMatchObject({
      kind: "requirement",
      body: "System MUST.",
      source: {
        line: 22,
      },
    });
    expect(nodes.some((node) => node.title.includes("NEEDS CLARIFICATION"))).toBe(false);
    expect(refundQuestion).toMatchObject({
      kind: "open_question",
      status: "blocked",
      source: {
        line: 22,
      },
      metadata: {
        specKitArtifactType: "clarification",
      },
    });
    expect(ownerQuestion).toMatchObject({
      kind: "open_question",
      status: "blocked",
      source: {
        line: 23,
      },
    });
    expect(edges.filter((edge) => edge.kind === "belongs_to")).toHaveLength(2);
    expect(edges.filter((edge) => edge.kind === "satisfies")).toHaveLength(3);
    expect(edges.filter((edge) => edge.kind === "blocked_by")).toHaveLength(2);
    expect(edges).toContainEqual(expect.objectContaining({
      sourceNodeId: refundRequirement?.id,
      targetNodeId: refundQuestion?.id,
      kind: "blocked_by",
    }));
    expect(edges).toContainEqual(expect.objectContaining({
      sourceNodeId: featureNode?.id,
      targetNodeId: ownerQuestion?.id,
      kind: "blocked_by",
    }));
    expect(edges).not.toContainEqual(expect.objectContaining({
      sourceNodeId: storyNode?.id,
      targetNodeId: ownerQuestion?.id,
      kind: "blocked_by",
    }));
    expect(batch[0]).toMatchObject({
      productGraphId: "default",
      payload: {
        actor: {
          actorId: "operator",
          displayName: "Operator",
          role: "operator",
        },
      },
    });
    await app.close();
  });

  it("imports multiple Spec Kit spec.md files and reports files skipped by the import cap", async () => {
    const workspaceRoot = makeTempWorkspace();
    for (let index = 0; index < 27; index += 1) {
      const specDirectory = path.join(workspaceRoot, "specs", `feature-${String(index).padStart(2, "0")}`);
      fs.mkdirSync(specDirectory, { recursive: true });
      fs.writeFileSync(path.join(specDirectory, "spec.md"), `# Feature ${index}\n\nImported feature ${index}.\n`);
    }
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "imported",
      imported: {
        nodeCount: 25,
        edgeCount: 0,
        constitutionCount: 0,
        specFileCount: 25,
        featureCount: 25,
        contractFileCount: 0,
        contractCount: 0,
        planFileCount: 0,
        planCount: 0,
        quickstartFileCount: 0,
        quickstartScenarioCount: 0,
        taskFileCount: 0,
        taskCount: 0,
        skippedSpecFileCount: 2,
        skippedContractFileCount: 0,
        skippedPlanFileCount: 0,
        skippedQuickstartFileCount: 0,
        skippedTaskFileCount: 0,
      },
      presentArtifacts: ["specs"],
      missingArtifacts: [".specify/memory/constitution.md"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);
    const batch = repoMocks.appendProductEvents.mock.calls[0][0];
    const nodes = batch
      .filter((event: any) => event.kind === "product.node.upserted")
      .map((event: any) => event.payload.node as ProductGraphNode);
    expect(nodes).toHaveLength(25);
    expect(nodes.every((node) => node.kind === "feature")).toBe(true);
    expect(nodes.every((node) => node.source?.kind === "spec_kit")).toBe(true);
    expect(nodes.every((node) => node.source?.path?.startsWith("specs/feature-"))).toBe(true);
    await app.close();
  });

  it("imports Spec Kit tasks.md task nodes linked to the matching spec feature", async () => {
    const workspaceRoot = makeTempWorkspace();
    const checkoutSpec = path.join(workspaceRoot, "specs", "checkout");
    fs.mkdirSync(checkoutSpec, { recursive: true });
    fs.writeFileSync(path.join(checkoutSpec, "spec.md"), "# Checkout status\n\nShow checkout status.\n");
    fs.writeFileSync(
      path.join(checkoutSpec, "tasks.md"),
      [
        "# Tasks: Checkout status",
        "",
        "## Implementation",
        "",
        "- [ ] T001 [P] [US1] Wire checkout API",
        "- [x] T002 Add status panel tests",
        "- [ ] Add docs without explicit task id",
        "",
      ].join("\n")
    );
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "imported",
      imported: {
        nodeCount: 4,
        edgeCount: 3,
        specFileCount: 1,
        featureCount: 1,
        contractFileCount: 0,
        contractCount: 0,
        planFileCount: 0,
        planCount: 0,
        quickstartFileCount: 0,
        quickstartScenarioCount: 0,
        taskFileCount: 1,
        taskCount: 3,
        skippedContractFileCount: 0,
        skippedPlanFileCount: 0,
        skippedQuickstartFileCount: 0,
        skippedTaskFileCount: 0,
      },
      presentArtifacts: ["specs"],
      missingArtifacts: [".specify/memory/constitution.md"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);

    const batch = repoMocks.appendProductEvents.mock.calls[0][0];
    const nodes = batch
      .filter((event: any) => event.kind === "product.node.upserted")
      .map((event: any) => event.payload.node as ProductGraphNode);
    const edges = batch
      .filter((event: any) => event.kind === "product.edge.upserted")
      .map((event: any) => event.payload.edge as ProductGraphEdge);
    const nodeByTitle = new Map(nodes.map((node) => [node.title, node]));
    const featureNode = nodeByTitle.get("Checkout status");

    expect(featureNode).toMatchObject({
      kind: "feature",
      source: {
        kind: "spec_kit",
        path: "specs/checkout/spec.md",
      },
    });
    expect(nodeByTitle.get("Wire checkout API")).toMatchObject({
      kind: "task",
      status: "planned",
      source: {
        kind: "spec_kit",
        path: "specs/checkout/tasks.md",
        line: 5,
      },
      metadata: {
        specKitArtifactType: "task",
        specKitTaskId: "T001",
        specKitTaskSection: "Implementation",
        specKitTaskCompleted: false,
        specKitTaskParallel: true,
        specKitTaskStoryRefs: "US1",
      },
    });
    expect(nodeByTitle.get("Add status panel tests")).toMatchObject({
      kind: "task",
      status: "completed",
      metadata: {
        specKitTaskId: "T002",
        specKitTaskCompleted: true,
      },
    });
    expect(nodeByTitle.get("Add docs without explicit task id")).toMatchObject({
      kind: "task",
      status: "planned",
      metadata: {
        specKitTaskSection: "Implementation",
      },
    });
    expect(edges.filter((edge) => edge.kind === "implements")).toHaveLength(3);
    for (const taskTitle of ["Wire checkout API", "Add status panel tests", "Add docs without explicit task id"]) {
      expect(edges).toContainEqual(expect.objectContaining({
        sourceNodeId: nodeByTitle.get(taskTitle)?.id,
        targetNodeId: featureNode?.id,
        kind: "implements",
        trust: "extracted",
        source: expect.objectContaining({
          kind: "spec_kit",
          path: "specs/checkout/tasks.md",
        }),
      }));
    }
    await app.close();
  });

  it("imports Spec Kit plan.md plan nodes linked to the matching spec feature", async () => {
    const workspaceRoot = makeTempWorkspace();
    const checkoutSpec = path.join(workspaceRoot, "specs", "checkout");
    fs.mkdirSync(checkoutSpec, { recursive: true });
    fs.writeFileSync(path.join(checkoutSpec, "spec.md"), "# Checkout status\n\nShow checkout status.\n");
    fs.writeFileSync(
      path.join(checkoutSpec, "plan.md"),
      [
        "# Implementation Plan: Checkout status",
        "",
        "Ship the checkout status implementation.",
        "",
        "## Technical Context",
        "",
        "- Runtime: Node.js",
        "",
      ].join("\n")
    );
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "imported",
      imported: {
        nodeCount: 2,
        edgeCount: 1,
        specFileCount: 1,
        featureCount: 1,
        contractFileCount: 0,
        contractCount: 0,
        planFileCount: 1,
        planCount: 1,
        quickstartFileCount: 0,
        quickstartScenarioCount: 0,
        taskFileCount: 0,
        taskCount: 0,
        skippedContractFileCount: 0,
        skippedPlanFileCount: 0,
        skippedQuickstartFileCount: 0,
      },
      presentArtifacts: ["specs"],
      missingArtifacts: [".specify/memory/constitution.md"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);

    const batch = repoMocks.appendProductEvents.mock.calls[0][0];
    expect(batch).toHaveLength(3);
    const nodes = batch
      .filter((event: any) => event.kind === "product.node.upserted")
      .map((event: any) => event.payload.node as ProductGraphNode);
    const edges = batch
      .filter((event: any) => event.kind === "product.edge.upserted")
      .map((event: any) => event.payload.edge as ProductGraphEdge);
    const nodeByTitle = new Map(nodes.map((node) => [node.title, node]));
    const featureNode = nodeByTitle.get("Checkout status");
    const planNode = nodeByTitle.get("Implementation Plan: Checkout status");

    expect(featureNode).toMatchObject({
      kind: "feature",
      source: {
        kind: "spec_kit",
        path: "specs/checkout/spec.md",
      },
    });
    expect(planNode).toMatchObject({
      kind: "plan",
      summary: "Ship the checkout status implementation.",
      body: expect.stringContaining("## Technical Context"),
      source: {
        kind: "spec_kit",
        path: "specs/checkout/plan.md",
      },
      metadata: {
        specKitArtifactType: "plan",
        specKitSlug: "checkout",
      },
    });
    expect(edges).toContainEqual(expect.objectContaining({
      sourceNodeId: planNode?.id,
      targetNodeId: featureNode?.id,
      kind: "derived_from",
      trust: "extracted",
      label: "Plan derives from feature",
      source: expect.objectContaining({
        kind: "spec_kit",
        path: "specs/checkout/plan.md",
      }),
    }));
    await app.close();
  });

  it("imports Spec Kit quickstart.md scenario nodes linked to the matching spec feature", async () => {
    const workspaceRoot = makeTempWorkspace();
    const checkoutSpec = path.join(workspaceRoot, "specs", "checkout");
    fs.mkdirSync(checkoutSpec, { recursive: true });
    fs.writeFileSync(path.join(checkoutSpec, "spec.md"), "# Checkout status\n\nShow checkout status.\n");
    fs.writeFileSync(
      path.join(checkoutSpec, "quickstart.md"),
      [
        "# Quickstart: Checkout status",
        "",
        "Verify checkout status locally.",
        "",
        "## Run",
        "",
        "1. Start the backend.",
        "2. Open checkout.",
        "",
      ].join("\n")
    );
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "imported",
      imported: {
        nodeCount: 2,
        edgeCount: 1,
        specFileCount: 1,
        featureCount: 1,
        contractFileCount: 0,
        contractCount: 0,
        planFileCount: 0,
        planCount: 0,
        quickstartFileCount: 1,
        quickstartScenarioCount: 1,
        taskFileCount: 0,
        taskCount: 0,
        skippedContractFileCount: 0,
        skippedQuickstartFileCount: 0,
      },
      presentArtifacts: ["specs"],
      missingArtifacts: [".specify/memory/constitution.md"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);

    const batch = repoMocks.appendProductEvents.mock.calls[0][0];
    expect(batch).toHaveLength(3);
    const nodes = batch
      .filter((event: any) => event.kind === "product.node.upserted")
      .map((event: any) => event.payload.node as ProductGraphNode);
    const edges = batch
      .filter((event: any) => event.kind === "product.edge.upserted")
      .map((event: any) => event.payload.edge as ProductGraphEdge);
    const nodeByTitle = new Map(nodes.map((node) => [node.title, node]));
    const featureNode = nodeByTitle.get("Checkout status");
    const quickstartNode = nodeByTitle.get("Quickstart: Checkout status");

    expect(featureNode).toMatchObject({
      kind: "feature",
      source: {
        kind: "spec_kit",
        path: "specs/checkout/spec.md",
      },
    });
    expect(quickstartNode).toMatchObject({
      kind: "quickstart_scenario",
      summary: "Verify checkout status locally.",
      body: expect.stringContaining("## Run"),
      source: {
        kind: "spec_kit",
        path: "specs/checkout/quickstart.md",
      },
      metadata: {
        specKitArtifactType: "quickstart",
        specKitSlug: "checkout",
      },
    });
    expect(edges).toContainEqual(expect.objectContaining({
      sourceNodeId: quickstartNode?.id,
      targetNodeId: featureNode?.id,
      kind: "verifies",
      trust: "extracted",
      label: "Quickstart verifies feature",
      source: expect.objectContaining({
        kind: "spec_kit",
        path: "specs/checkout/quickstart.md",
      }),
    }));
    await app.close();
  });

  it("imports Spec Kit contracts linked to the matching spec feature", async () => {
    const workspaceRoot = makeTempWorkspace();
    const checkoutSpec = path.join(workspaceRoot, "specs", "checkout");
    const checkoutContracts = path.join(checkoutSpec, "contracts");
    const nestedContracts = path.join(checkoutContracts, "openapi");
    fs.mkdirSync(checkoutContracts, { recursive: true });
    fs.mkdirSync(nestedContracts, { recursive: true });
    fs.writeFileSync(path.join(checkoutSpec, "spec.md"), "# Checkout status\n\nShow checkout status.\n");
    fs.writeFileSync(
      path.join(checkoutContracts, "checkout-api.yaml"),
      [
        "openapi: 3.0.0",
        "info:",
        "  title: Checkout API",
        "paths:",
        "  /checkout/status:",
        "    get:",
        "      summary: Read checkout status",
        "",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(nestedContracts, "checkout-events.yaml"),
      [
        "openapi: 3.0.0",
        "info:",
        "  title: Checkout Events API",
        "paths:",
        "  /checkout/events:",
        "    get:",
        "      summary: Read checkout events",
        "",
      ].join("\n")
    );
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "imported",
      imported: {
        nodeCount: 3,
        edgeCount: 2,
        specFileCount: 1,
        featureCount: 1,
        contractFileCount: 2,
        contractCount: 2,
        planFileCount: 0,
        planCount: 0,
        quickstartFileCount: 0,
        quickstartScenarioCount: 0,
        taskFileCount: 0,
        taskCount: 0,
        skippedContractFileCount: 0,
      },
      presentArtifacts: ["specs"],
      missingArtifacts: [".specify/memory/constitution.md"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);

    const batch = repoMocks.appendProductEvents.mock.calls[0][0];
    expect(batch).toHaveLength(5);
    const nodes = batch
      .filter((event: any) => event.kind === "product.node.upserted")
      .map((event: any) => event.payload.node as ProductGraphNode);
    const edges = batch
      .filter((event: any) => event.kind === "product.edge.upserted")
      .map((event: any) => event.payload.edge as ProductGraphEdge);
    const nodeByTitle = new Map(nodes.map((node) => [node.title, node]));
    const featureNode = nodeByTitle.get("Checkout status");
    const contractNode = nodeByTitle.get("checkout-api.yaml");
    const nestedContractNode = nodeByTitle.get("openapi/checkout-events.yaml");

    expect(featureNode).toMatchObject({
      kind: "feature",
      source: {
        kind: "spec_kit",
        path: "specs/checkout/spec.md",
      },
    });
    expect(contractNode).toMatchObject({
      kind: "contract",
      summary: "openapi: 3.0.0 info: title: Checkout API paths: /checkout/status: get: summary: Read checkout status",
      body: expect.stringContaining("/checkout/status"),
      source: {
        kind: "spec_kit",
        path: "specs/checkout/contracts/checkout-api.yaml",
      },
      metadata: {
        specKitArtifactType: "contract",
        specKitSlug: "checkout",
        specKitContractName: "checkout-api.yaml",
      },
    });
    expect(nestedContractNode).toMatchObject({
      kind: "contract",
      summary:
        "openapi: 3.0.0 info: title: Checkout Events API paths: /checkout/events: get: summary: Read checkout events",
      body: expect.stringContaining("/checkout/events"),
      source: {
        kind: "spec_kit",
        path: "specs/checkout/contracts/openapi/checkout-events.yaml",
      },
      metadata: {
        specKitArtifactType: "contract",
        specKitSlug: "checkout",
        specKitContractName: "openapi/checkout-events.yaml",
      },
    });
    expect(edges).toContainEqual(expect.objectContaining({
      sourceNodeId: contractNode?.id,
      targetNodeId: featureNode?.id,
      kind: "satisfies",
      trust: "extracted",
      label: "Contract satisfies feature",
      source: expect.objectContaining({
        kind: "spec_kit",
        path: "specs/checkout/contracts/checkout-api.yaml",
      }),
    }));
    expect(edges).toContainEqual(expect.objectContaining({
      sourceNodeId: nestedContractNode?.id,
      targetNodeId: featureNode?.id,
      kind: "satisfies",
      trust: "extracted",
      label: "Contract satisfies feature",
      source: expect.objectContaining({
        kind: "spec_kit",
        path: "specs/checkout/contracts/openapi/checkout-events.yaml",
      }),
    }));
    await app.close();
  });

  it("skips Spec Kit contract, plan.md, quickstart.md, and tasks.md files without a matching imported spec feature", async () => {
    const workspaceRoot = makeTempWorkspace();
    const specifyMemory = path.join(workspaceRoot, ".specify", "memory");
    const orphanTasks = path.join(workspaceRoot, "specs", "orphan");
    const orphanContracts = path.join(orphanTasks, "contracts");
    fs.mkdirSync(specifyMemory, { recursive: true });
    fs.mkdirSync(orphanContracts, { recursive: true });
    fs.writeFileSync(path.join(specifyMemory, "constitution.md"), "# Constitution\n");
    fs.writeFileSync(path.join(orphanContracts, "orphan.yaml"), "openapi: 3.0.0\n");
    fs.writeFileSync(path.join(orphanTasks, "plan.md"), "# Orphan plan\n");
    fs.writeFileSync(path.join(orphanTasks, "quickstart.md"), "# Orphan quickstart\n");
    fs.writeFileSync(path.join(orphanTasks, "tasks.md"), "- [ ] T001 Orphan task\n");
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      status: "imported",
      message: "Spec Kit artifacts imported into the Product Graph.",
      imported: {
        nodeCount: 1,
        edgeCount: 0,
        constitutionCount: 1,
        specFileCount: 0,
        featureCount: 0,
        userStoryCount: 0,
        requirementCount: 0,
        acceptanceCriterionCount: 0,
        openQuestionCount: 0,
        contractFileCount: 0,
        contractCount: 0,
        planFileCount: 0,
        planCount: 0,
        quickstartFileCount: 0,
        quickstartScenarioCount: 0,
        taskFileCount: 0,
        taskCount: 0,
        skippedSpecFileCount: 0,
        skippedContractFileCount: 1,
        skippedPlanFileCount: 1,
        skippedQuickstartFileCount: 1,
        skippedTaskFileCount: 1,
      },
      artifactRoot: ".",
      artifacts: [
        { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: true },
        { key: "specs", relativePath: "specs", kind: "specs", present: true },
      ],
      presentArtifacts: [".specify/memory/constitution.md", "specs"],
      missingArtifacts: [],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);
    const batch = repoMocks.appendProductEvents.mock.calls[0][0];
    const nodes = batch
      .filter((event: any) => event.kind === "product.node.upserted")
      .map((event: any) => event.payload.node as ProductGraphNode);
    const edges = batch.filter((event: any) => event.kind === "product.edge.upserted");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: "requirement",
      title: "Constitution",
      source: {
        kind: "spec_kit",
        path: ".specify/memory/constitution.md",
      },
    });
    expect(edges).toHaveLength(0);
    await app.close();
  });

  it("rejects detected Spec Kit artifacts when no importable files are present", async () => {
    const workspaceRoot = makeTempWorkspace();
    const checkoutSpec = path.join(workspaceRoot, "specs", "checkout");
    fs.mkdirSync(checkoutSpec, { recursive: true });
    fs.writeFileSync(path.join(checkoutSpec, "plan.md"), "# Checkout plan\n");
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      status: "invalid_spec_kit_artifacts",
      error: "Spec Kit artifacts did not contain an importable constitution.md or spec.md file.",
      artifactRoot: ".",
      artifacts: [
        { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: false },
        { key: "specs", relativePath: "specs", kind: "specs", present: true },
      ],
      presentArtifacts: ["specs"],
      missingArtifacts: [".specify/memory/constitution.md"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects oversized Spec Kit constitution files without appending events", async () => {
    const workspaceRoot = makeTempWorkspace();
    const specifyMemory = path.join(workspaceRoot, ".specify", "memory");
    fs.mkdirSync(specifyMemory, { recursive: true });
    fs.writeFileSync(path.join(specifyMemory, "constitution.md"), "x".repeat(100_001));
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      status: "invalid_spec_kit_artifacts",
      error: ".specify/memory/constitution.md is too large for this importer. Limit is 100000 bytes.",
      artifactRoot: ".",
      artifacts: [
        { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: true },
        { key: "specs", relativePath: "specs", kind: "specs", present: false },
      ],
      presentArtifacts: [".specify/memory/constitution.md"],
      missingArtifacts: ["specs"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects oversized Spec Kit plan.md files without appending events", async () => {
    const workspaceRoot = makeTempWorkspace();
    const checkoutSpec = path.join(workspaceRoot, "specs", "checkout");
    fs.mkdirSync(checkoutSpec, { recursive: true });
    fs.writeFileSync(path.join(checkoutSpec, "spec.md"), "# Checkout status\n\nShow checkout status.\n");
    fs.writeFileSync(path.join(checkoutSpec, "plan.md"), "x".repeat(100_001));
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      status: "invalid_spec_kit_artifacts",
      error: "specs/checkout/plan.md is too large for this importer. Limit is 100000 bytes.",
      artifactRoot: ".",
      artifacts: [
        { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: false },
        { key: "specs", relativePath: "specs", kind: "specs", present: true },
      ],
      presentArtifacts: ["specs"],
      missingArtifacts: [".specify/memory/constitution.md"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects oversized Spec Kit quickstart.md files without appending events", async () => {
    const workspaceRoot = makeTempWorkspace();
    const checkoutSpec = path.join(workspaceRoot, "specs", "checkout");
    fs.mkdirSync(checkoutSpec, { recursive: true });
    fs.writeFileSync(path.join(checkoutSpec, "spec.md"), "# Checkout status\n\nShow checkout status.\n");
    fs.writeFileSync(path.join(checkoutSpec, "quickstart.md"), "x".repeat(100_001));
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      status: "invalid_spec_kit_artifacts",
      error: "specs/checkout/quickstart.md is too large for this importer. Limit is 100000 bytes.",
      artifactRoot: ".",
      artifacts: [
        { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: false },
        { key: "specs", relativePath: "specs", kind: "specs", present: true },
      ],
      presentArtifacts: ["specs"],
      missingArtifacts: [".specify/memory/constitution.md"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects oversized Spec Kit contract files without appending events", async () => {
    const workspaceRoot = makeTempWorkspace();
    const checkoutSpec = path.join(workspaceRoot, "specs", "checkout");
    const checkoutContracts = path.join(checkoutSpec, "contracts", "openapi");
    fs.mkdirSync(checkoutContracts, { recursive: true });
    fs.writeFileSync(path.join(checkoutSpec, "spec.md"), "# Checkout status\n\nShow checkout status.\n");
    fs.writeFileSync(path.join(checkoutContracts, "checkout.yaml"), "x".repeat(100_001));
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/spec-kit/import",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      status: "invalid_spec_kit_artifacts",
      error: "specs/checkout/contracts/openapi/checkout.yaml is too large for this importer. Limit is 100000 bytes.",
      artifactRoot: ".",
      artifacts: [
        { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: false },
        { key: "specs", relativePath: "specs", kind: "specs", present: true },
      ],
      presentArtifacts: ["specs"],
      missingArtifacts: [".specify/memory/constitution.md"],
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("scans the configured codebase and archives stale scan output", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "app.ts"),
      [
        "export function buildApp() {",
        "  return 'ready';",
        "}",
        "",
        "function internalHelper() {",
        "  return 'private';",
        "}",
        "",
        "export class CheckoutController {",
        "  refresh() {",
        "    return buildApp();",
        "  }",
        "}",
      ].join("\n")
    );
    setProductGraphRouteTestConfig({ workspaceRoot });
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({
      nodes: [
        projectionNode({
          id: "code-scan:file:removed:123",
          kind: "code_file",
          title: "src/removed.ts",
          source: { kind: "code_scan", label: "Codebase scan", path: "src/removed.ts" },
        }),
      ],
      edges: [
        projectionEdge({
          id: "code-scan:edge:removed:123",
          sourceNodeId: "code-scan:symbol:removed:123",
          targetNodeId: "code-scan:file:removed:123",
          kind: "belongs_to",
          source: { kind: "code_scan", label: "Codebase scan", path: "src/removed.ts" },
        }),
      ],
    }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/codebase/scan",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "scanned",
      message: "Codebase scan completed.",
      scanned: {
        fileCount: 1,
        symbolCount: 2,
        communityCount: 1,
        edgeCount: 4,
        dependencyEdgeCount: 0,
        externalDependencyCount: 0,
        unresolvedDependencyCount: 0,
        semanticAnalysisEnabled: true,
        semanticAnalysisSucceeded: true,
        semanticEdgeCount: 1,
        semanticResolutionCount: 0,
        semanticConfigCount: 0,
        semanticConfiguredFileCount: 0,
        semanticSyntheticFileCount: 1,
        semanticUnconfiguredFileCount: 0,
        archivedNodeCount: 1,
        archivedEdgeCount: 1,
        partial: false,
      },
    });
    expect(response.body).not.toContain(workspaceRoot);
    expect(response.body).not.toContain("internalHelper");
    expect(repoMocks.getProductGraphProjection).toHaveBeenCalledWith("default");
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);

    const batch = repoMocks.appendProductEvents.mock.calls[0][0];
    expect(batch).toHaveLength(10);

    const nodes = batch
      .filter((event: any) => event.kind === "product.node.upserted")
      .map((event: any) => event.payload.node as ProductGraphNode);
    const edges = batch
      .filter((event: any) => event.kind === "product.edge.upserted")
      .map((event: any) => event.payload.edge as ProductGraphEdge);
    const nodeByTitle = new Map(nodes.map((node) => [node.title, node]));

    expect(nodeByTitle.get("src/app.ts")).toMatchObject({
      kind: "code_file",
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "src/app.ts",
      },
      metadata: {
        scannerSourceFile: "src/app.ts",
        fileSizeBytes: expect.any(Number),
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(nodeByTitle.get("src/app.ts")).not.toHaveProperty("body");
    expect(nodeByTitle.get("buildApp (function)")).toMatchObject({
      kind: "code_symbol",
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "src/app.ts",
        line: 1,
      },
      metadata: {
        scannerSymbolKind: "function",
        scannerSymbolName: "buildApp",
        scannerSourceFile: "src/app.ts",
      },
    });
    expect(nodeByTitle.get("CheckoutController (class)")).toMatchObject({
      kind: "code_symbol",
      metadata: {
        scannerSymbolKind: "class",
        scannerSymbolName: "CheckoutController",
        methodCount: 1,
        methodNames: "refresh",
      },
    });
    expect(nodeByTitle.has("internalHelper (function)")).toBe(false);
    expect(nodeByTitle.get("src")).toMatchObject({
      kind: "code_community",
      metadata: {
        scannerCommunityPath: "src",
        scannerCommunityFileCount: 1,
      },
    });
    expect(edges.filter((edge) => edge.kind === "belongs_to")).toHaveLength(3);
    expect(batch.some((event: any) => event.kind === "product.edge.archived" && event.edgeId === "code-scan:edge:removed:123")).toBe(true);
    expect(batch.some((event: any) => event.kind === "product.node.archived" && event.nodeId === "code-scan:file:removed:123")).toBe(true);
    expect(batch[0]).toMatchObject({
      productGraphId: "default",
      kind: "product.node.upserted",
      payload: {
        actor: {
          actorId: "operator",
          displayName: "Operator",
          role: "operator",
        },
      },
    });
    await app.close();
  });

  it("uses configured semantic analysis budgets during codebase scans", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "one.ts"), "export const one = 1;\n");
    fs.writeFileSync(path.join(workspaceRoot, "src", "two.ts"), "export const two = 2;\n");
    setProductGraphRouteTestConfig({
      workspaceRoot,
      semanticAnalysisMaxFiles: "1",
    });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/codebase/scan",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "scanned",
      scanned: {
        fileCount: 2,
        semanticAnalysisEnabled: true,
        semanticAnalysisSucceeded: false,
        semanticEdgeCount: 0,
        semanticResolutionCount: 0,
      },
    });
    expect(response.json().scanned.semanticFallbackReason).toContain("2 files exceeds budget of 1");
    await app.close();
  });

  it("runs codebase scans through job status endpoints", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "job.ts"), "export const job = true;\n");
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const startResponse = await app.inject({
      method: "POST",
      url: "/product-graph/codebase/scan-jobs",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(startResponse.statusCode).toBe(202);
    const started = startResponse.json();
    expect(started).toMatchObject({
      scope: "product_codebase",
      status: expect.stringMatching(/queued|running|completed/),
      progress: {
        phase: expect.any(String),
        breakers: {
          limits: {
            maxFiles: 20_000,
          },
        },
      },
    });

    let completed: any;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await app.inject({
        method: "GET",
        url: `/product-graph/codebase/scan-jobs/${started.jobId}`,
        headers: {
          "x-openagentgraph-actor-id": "operator",
        },
      });
      expect(statusResponse.statusCode).toBe(200);
      const status = statusResponse.json();
      if (status.status === "completed") {
        completed = status;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(completed).toMatchObject({
      status: "completed",
      result: {
        status: "scanned",
        scanned: {
          fileCount: 1,
          partial: false,
          progress: {
            phase: "completed",
          },
        },
      },
    });
    const eventsResponse = await app.inject({
      method: "GET",
      url: `/product-graph/codebase/scan-jobs/${started.jobId}/events`,
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });
    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.headers["content-type"]).toContain("text/event-stream");
    expect(eventsResponse.payload).toContain("event: status");
    expect(eventsResponse.payload).toContain('"status":"completed"');
    expect(eventsResponse.payload).toContain('"phase":"completed"');
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("returns an empty successful codebase scan without requiring generated artifacts", async () => {
    const workspaceRoot = makeTempWorkspace();
    setProductGraphRouteTestConfig({ workspaceRoot });
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/codebase/scan",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "scanned",
      scanned: {
        fileCount: 0,
        symbolCount: 0,
        edgeCount: 0,
        archivedNodeCount: 0,
        archivedEdgeCount: 0,
        partial: false,
      },
    });
    expect(repoMocks.appendProductEvents).toHaveBeenCalledWith([]);
    await app.close();
  });

  it("rejects invalid node payloads before appending events", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/nodes",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        kind: "feature",
        title: "Intent Graph",
        tags: "phase-1",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "tags must be an array of strings." });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("allows operators to create manual product graph nodes", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/nodes",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        id: "feature:intent-graph",
        kind: "feature",
        title: " Intent Graph ",
        summary: " Plan before edits ",
        tags: [" phase-1 ", "intent", "phase-1", " "],
      },
    });

    const node = response.json<ProductGraphNode>();
    expect(response.statusCode).toBe(201);
    expect(node).toEqual({
      id: "feature:intent-graph",
      kind: "feature",
      title: "Intent Graph",
      summary: "Plan before edits",
      status: "planned",
      tags: ["phase-1", "intent"],
      source: {
        kind: "manual",
        label: "Manual entry",
      },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(repoMocks.appendProductEvent).toHaveBeenCalledWith({
      productGraphId: "default",
      kind: "product.node.upserted",
      nodeId: "feature:intent-graph",
      payload: {
        node,
        actor: {
          actorId: "operator",
          displayName: "Operator",
          role: "operator",
        },
      },
    });
    await app.close();
  });

  it("rejects edge writes that reference missing product graph nodes", async () => {
    repoMocks.getProductGraphProjection.mockResolvedValue(
      makeProjection({
        nodes: [
          projectionNode({
            id: "story-1",
            kind: "user_story",
            title: "Plan before edits",
          }),
        ],
      })
    );
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/edges",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        id: "edge-story-feature",
        sourceNodeId: "story-1",
        targetNodeId: "feature-1",
        kind: "belongs_to",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "targetNodeId must reference an existing product graph node." });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("allows operators to create manual product graph edges", async () => {
    repoMocks.getProductGraphProjection.mockResolvedValue(
      makeProjection({
        nodes: [
          projectionNode({
            id: "story-1",
            kind: "user_story",
            title: "Plan before edits",
          }),
          projectionNode({
            id: "feature-1",
            kind: "feature",
            title: "Intent Graph",
          }),
        ],
      })
    );
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/edges",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        id: "edge-story-feature",
        sourceNodeId: "story-1",
        targetNodeId: "feature-1",
        kind: "belongs_to",
        label: " Story belongs to feature ",
      },
    });

    const edge = response.json<ProductGraphEdge>();
    expect(response.statusCode).toBe(201);
    expect(edge).toEqual({
      id: "edge-story-feature",
      sourceNodeId: "story-1",
      targetNodeId: "feature-1",
      kind: "belongs_to",
      trust: "manual",
      label: "Story belongs to feature",
      source: {
        kind: "manual",
        label: "Manual entry",
      },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(repoMocks.appendProductEvent).toHaveBeenCalledWith({
      productGraphId: "default",
      kind: "product.edge.upserted",
      edgeId: "edge-story-feature",
      payload: {
        edge,
        actor: {
          actorId: "operator",
          displayName: "Operator",
          role: "operator",
        },
      },
    });
    await app.close();
  });

  it("rejects invalid intent bundles before appending events", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/intent-bundles",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        feature: {
          id: "feature:intent-graph",
          title: "Intent Graph",
        },
        userStories: [],
        acceptanceCriteria: [
          {
            id: "criterion:intent-visible",
            title: "Intent is visible",
          },
        ],
        tasks: [
          {
            id: "task:intent-view",
            title: "Build intent view",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "userStories must contain at least 1 item." });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects duplicate node ids in intent bundles", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/intent-bundles",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        feature: {
          id: "feature:intent-graph",
          title: "Intent Graph",
        },
        userStories: [
          {
            id: "feature:intent-graph",
            title: "Operator sees intent",
          },
        ],
        acceptanceCriteria: [
          {
            id: "criterion:intent-visible",
            title: "Intent is visible",
          },
        ],
        tasks: [
          {
            id: "task:intent-view",
            title: "Build intent view",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "node ids must be unique within an intent bundle. Duplicate id: feature:intent-graph",
    });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("allows operators to create manual intent bundles", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/intent-bundles",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        feature: {
          id: "feature:intent-graph",
          title: " Intent Graph ",
          summary: " Plan before edits ",
          tags: [" phase-1 ", "intent"],
        },
        userStories: [
          {
            id: "story:operator-sees-intent",
            title: "Operator sees intent",
          },
        ],
        acceptanceCriteria: [
          {
            id: "criterion:intent-visible",
            title: "Intent is visible before execution",
          },
        ],
        tasks: [
          {
            id: "task:intent-view",
            title: "Build the intent view",
          },
        ],
      },
    });

    const bundle = response.json<{ nodes: ProductGraphNode[]; edges: ProductGraphEdge[] }>();
    expect(response.statusCode).toBe(201);
    expect(bundle.nodes.map((node) => ({ id: node.id, kind: node.kind, title: node.title, source: node.source }))).toEqual([
      {
        id: "feature:intent-graph",
        kind: "feature",
        title: "Intent Graph",
        source: { kind: "manual", label: "Manual intent bundle" },
      },
      {
        id: "story:operator-sees-intent",
        kind: "user_story",
        title: "Operator sees intent",
        source: { kind: "manual", label: "Manual intent bundle" },
      },
      {
        id: "criterion:intent-visible",
        kind: "acceptance_criterion",
        title: "Intent is visible before execution",
        source: { kind: "manual", label: "Manual intent bundle" },
      },
      {
        id: "task:intent-view",
        kind: "task",
        title: "Build the intent view",
        source: { kind: "manual", label: "Manual intent bundle" },
      },
    ]);
    expect(bundle.edges.map((edge) => ({
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      kind: edge.kind,
      label: edge.label,
      trust: edge.trust,
      source: edge.source,
    }))).toEqual([
      {
        sourceNodeId: "story:operator-sees-intent",
        targetNodeId: "feature:intent-graph",
        kind: "belongs_to",
        label: "Story belongs to feature",
        trust: "manual",
        source: { kind: "manual", label: "Manual intent bundle" },
      },
      {
        sourceNodeId: "criterion:intent-visible",
        targetNodeId: "feature:intent-graph",
        kind: "satisfies",
        label: "Criterion satisfies feature",
        trust: "manual",
        source: { kind: "manual", label: "Manual intent bundle" },
      },
      {
        sourceNodeId: "task:intent-view",
        targetNodeId: "feature:intent-graph",
        kind: "implements",
        label: "Task implements feature",
        trust: "manual",
        source: { kind: "manual", label: "Manual intent bundle" },
      },
    ]);
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);
    const batch = repoMocks.appendProductEvents.mock.calls[0][0];
    expect(batch).toHaveLength(7);
    expect(batch[0]).toEqual({
      productGraphId: "default",
      kind: "product.node.upserted",
      nodeId: "feature:intent-graph",
      payload: {
        node: bundle.nodes[0],
        actor: {
          actorId: "operator",
          displayName: "Operator",
          role: "operator",
        },
      },
    });
    expect(batch[6]).toEqual({
      productGraphId: "default",
      kind: "product.edge.upserted",
      edgeId: bundle.edges[2].id,
      payload: {
        edge: bundle.edges[2],
        actor: {
          actorId: "operator",
          displayName: "Operator",
          role: "operator",
        },
      },
    });
    await app.close();
  });

  it("rejects run links when actor context is missing", async () => {
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/runs/graph-1/link",
      payload: {
        taskNodeId: "task:checkout-status-panel",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "This action requires a signed-in operator." });
    expect(graphRepoMocks.getGraphProjection).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects run links for non-completed execution graphs", async () => {
    graphRepoMocks.getGraphProjection.mockResolvedValue(makeExecutionProjection({ status: "running" }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/runs/graph-1/link",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        taskNodeId: "task:checkout-status-panel",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Only completed OpenAgentGraph runs can be linked to product graph tasks.",
    });
    expect(repoMocks.getProductGraphProjection).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects run links when the target product task is missing", async () => {
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection());
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/runs/graph-1/link",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        taskNodeId: "task:checkout-status-panel",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Product graph task was not found." });
    expect(repoMocks.appendProductEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("links completed execution runs to product graph tasks", async () => {
    const task = projectionNode({
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [task] }));
    graphRepoMocks.getGraphProjection.mockResolvedValue(makeExecutionProjection({ graphId: "graph-1" }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/runs/graph-1/link",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        taskNodeId: task.id,
      },
    });

    expect(response.statusCode).toBe(201);
    const link = response.json<{
      node: ProductGraphNode;
      edge: ProductGraphEdge;
      evidenceNode: ProductGraphNode;
      evidenceEdge: ProductGraphEdge;
      fileNodes: ProductGraphNode[];
      fileEdges: ProductGraphEdge[];
    }>();
    expect(link.node).toMatchObject({
      kind: "agent_run",
      title: "Checkout implementation run",
      summary: "Run completed successfully.",
      body: "Wire the checkout status panel.",
      status: "completed",
      tags: ["openagentgraph", "run"],
      source: {
        kind: "openagentgraph_run",
        label: "OpenAgentGraph run",
        url: "/graphs/graph-1",
      },
      metadata: {
        graphId: "graph-1",
        graphStatus: "completed",
        runControlState: "idle",
        completedNodeCount: 2,
        plannedNodeCount: 2,
        passRate: 1,
        evidenceCoverageRate: 0.75,
        lastEventSequence: 7,
      },
    });
    expect(link.edge).toMatchObject({
      sourceNodeId: task.id,
      targetNodeId: link.node.id,
      kind: "produced_by",
      trust: "manual",
      label: "Task produced by run",
      source: {
        kind: "openagentgraph_run",
        label: "OpenAgentGraph run",
        url: "/graphs/graph-1",
      },
      metadata: {
        graphId: "graph-1",
      },
    });
    expect(link.evidenceNode).toMatchObject({
      kind: "evidence",
      title: "Checkout implementation run evidence",
      summary: "1 changed file, 1 command, 1 test command.",
      body: expect.stringContaining("packages/frontend/src/CheckoutStatus.tsx"),
      status: "completed",
      tags: ["openagentgraph", "evidence"],
      source: {
        kind: "openagentgraph_run",
        label: "OpenAgentGraph run",
        url: "/graphs/graph-1",
      },
      metadata: {
        graphId: "graph-1",
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
    });
    expect(link.evidenceNode.body).toContain("npm test -- CheckoutStatus.test.tsx --token=[redacted]");
    expect(link.evidenceNode.body).not.toContain("passed");
    expect(link.evidenceNode.body).not.toContain("super-secret");
    expect(link.evidenceEdge).toMatchObject({
      sourceNodeId: link.evidenceNode.id,
      targetNodeId: link.node.id,
      kind: "produced_by",
      trust: "manual",
      label: "Evidence produced by run",
      source: {
        kind: "openagentgraph_run",
        label: "OpenAgentGraph run",
        url: "/graphs/graph-1",
      },
      metadata: {
        graphId: "graph-1",
      },
    });
    expect(link.fileNodes).toHaveLength(1);
    expect(link.fileNodes[0]).toMatchObject({
      kind: "code_file",
      title: "packages/frontend/src/CheckoutStatus.tsx",
      summary: "Touched by linked OpenAgentGraph run evidence.",
      status: "planned",
      tags: ["openagentgraph", "code"],
      source: {
        kind: "openagentgraph_run",
        label: "OpenAgentGraph run",
        url: "/graphs/graph-1",
        path: "packages/frontend/src/CheckoutStatus.tsx",
      },
      metadata: {
        openAgentGraphRunFilePath: "packages/frontend/src/CheckoutStatus.tsx",
      },
    });
    expect(link.fileEdges).toHaveLength(1);
    expect(link.fileEdges[0]).toMatchObject({
      sourceNodeId: link.node.id,
      targetNodeId: link.fileNodes[0].id,
      kind: "touches",
      trust: "manual",
      label: "Run changed file",
      source: {
        kind: "openagentgraph_run",
        label: "OpenAgentGraph run",
        url: "/graphs/graph-1",
      },
      metadata: {
        graphId: "graph-1",
        filePath: "packages/frontend/src/CheckoutStatus.tsx",
        fileDiffCount: 1,
        changeTypes: "created",
      },
    });
    expect(repoMocks.appendProductEvent).not.toHaveBeenCalled();
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);
    expect(repoMocks.appendProductEvents.mock.calls[0][0]).toEqual([
      {
        productGraphId: "default",
        kind: "product.node.upserted",
        nodeId: link.node.id,
        payload: {
          node: link.node,
          actor: {
            actorId: "operator",
            displayName: "Operator",
            role: "operator",
          },
        },
      },
      {
        productGraphId: "default",
        kind: "product.node.upserted",
        nodeId: link.evidenceNode.id,
        payload: {
          node: link.evidenceNode,
          actor: {
            actorId: "operator",
            displayName: "Operator",
            role: "operator",
          },
        },
      },
      {
        productGraphId: "default",
        kind: "product.node.upserted",
        nodeId: link.fileNodes[0].id,
        payload: {
          node: link.fileNodes[0],
          actor: {
            actorId: "operator",
            displayName: "Operator",
            role: "operator",
          },
        },
      },
      {
        productGraphId: "default",
        kind: "product.edge.upserted",
        edgeId: link.edge.id,
        payload: {
          edge: link.edge,
          actor: {
            actorId: "operator",
            displayName: "Operator",
            role: "operator",
          },
        },
      },
      {
        productGraphId: "default",
        kind: "product.edge.upserted",
        edgeId: link.evidenceEdge.id,
        payload: {
          edge: link.evidenceEdge,
          actor: {
            actorId: "operator",
            displayName: "Operator",
            role: "operator",
          },
        },
      },
      {
        productGraphId: "default",
        kind: "product.edge.upserted",
        edgeId: link.fileEdges[0].id,
        payload: {
          edge: link.fileEdges[0],
          actor: {
            actorId: "operator",
            displayName: "Operator",
            role: "operator",
          },
        },
      },
    ]);
    await app.close();
  });

  it("links accepted Codex plans to completed execution run results", async () => {
    const task = projectionNode({
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
    });
    const plan: ProductGraphProjection["nodes"][number] = {
      ...projectionNode({
        id: "plan:codex:checkout-status-panel",
        kind: "plan",
        title: "Codex plan for checkout status panel",
      }),
      tags: ["codex", "planning"],
      metadata: {
        taskNodeId: task.id,
        promptHash: "0".repeat(64),
      },
    };
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [task, plan] }));
    graphRepoMocks.getGraphProjection.mockResolvedValue(makeExecutionProjection({ graphId: "graph-1" }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/runs/graph-1/link",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        taskNodeId: task.id,
      },
    });

    expect(response.statusCode).toBe(201);
    const link = response.json<{
      node: ProductGraphNode;
      planEdges: ProductGraphEdge[];
    }>();
    expect(link.planEdges).toEqual([
      expect.objectContaining({
        sourceNodeId: link.node.id,
        targetNodeId: plan.id,
        kind: "derived_from",
        trust: "manual",
        label: "Run derived from plan",
        source: {
          kind: "openagentgraph_run",
          label: "OpenAgentGraph run",
          url: "/graphs/graph-1",
        },
        metadata: {
          graphId: "graph-1",
          taskNodeId: task.id,
          planNodeId: plan.id,
        },
      }),
    ]);
    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);
    expect(repoMocks.appendProductEvents.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "product.edge.upserted",
          edgeId: link.planEdges[0].id,
          payload: {
            edge: link.planEdges[0],
            actor: {
              actorId: "operator",
              displayName: "Operator",
              role: "operator",
            },
          },
        }),
      ])
    );
    await app.close();
  });

  it("links multiple accepted Codex plans to the same completed execution run result", async () => {
    const task = projectionNode({
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
    });
    const metadataPlan: ProductGraphProjection["nodes"][number] = {
      ...projectionNode({
        id: "plan:codex:checkout-status-panel",
        kind: "plan",
        title: "Codex plan for checkout status panel",
      }),
      tags: ["codex", "planning"],
      metadata: {
        taskNodeId: task.id,
        promptHash: "0".repeat(64),
      },
    };
    const edgeLinkedPlan: ProductGraphProjection["nodes"][number] = {
      ...projectionNode({
        id: "plan:codex:checkout-status-panel-retry",
        kind: "plan",
        title: "Second Codex plan for checkout status panel",
      }),
      tags: ["codex", "planning"],
      metadata: {
        promptHash: "2".repeat(64),
      },
    };
    const edgeLinkedPlanEdge = projectionEdge({
      id: "edge-codex-plan-checkout-status-panel-retry",
      sourceNodeId: edgeLinkedPlan.id,
      targetNodeId: task.id,
      kind: "derived_from",
      label: "Plan derived from task",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(
      makeProjection({
        nodes: [task, metadataPlan, edgeLinkedPlan],
        edges: [edgeLinkedPlanEdge],
      })
    );
    graphRepoMocks.getGraphProjection.mockResolvedValue(makeExecutionProjection({ graphId: "graph-1" }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/runs/graph-1/link",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        taskNodeId: task.id,
      },
    });

    expect(response.statusCode).toBe(201);
    const link = response.json<{
      node: ProductGraphNode;
      planEdges: ProductGraphEdge[];
    }>();
    expect(link.planEdges).toHaveLength(2);
    expect(link.planEdges.map((edge) => edge.targetNodeId)).toEqual([metadataPlan.id, edgeLinkedPlan.id]);
    expect(new Set(link.planEdges.map((edge) => edge.id)).size).toBe(2);
    expect(link.planEdges).toEqual([
      expect.objectContaining({
        sourceNodeId: link.node.id,
        targetNodeId: metadataPlan.id,
        kind: "derived_from",
        trust: "manual",
        label: "Run derived from plan",
        metadata: {
          graphId: "graph-1",
          taskNodeId: task.id,
          planNodeId: metadataPlan.id,
        },
      }),
      expect.objectContaining({
        sourceNodeId: link.node.id,
        targetNodeId: edgeLinkedPlan.id,
        kind: "derived_from",
        trust: "manual",
        label: "Run derived from plan",
        metadata: {
          graphId: "graph-1",
          taskNodeId: task.id,
          planNodeId: edgeLinkedPlan.id,
        },
      }),
    ]);

    expect(repoMocks.appendProductEvents).toHaveBeenCalledTimes(1);
    const appendedPlanEdges = repoMocks.appendProductEvents.mock.calls[0][0].filter(
      (event) => event.kind === "product.edge.upserted" && link.planEdges.some((edge) => edge.id === event.edgeId)
    );
    expect(appendedPlanEdges).toEqual(
      link.planEdges.map((edge) => ({
        productGraphId: "default",
        kind: "product.edge.upserted",
        edgeId: edge.id,
        payload: {
          edge,
          actor: {
            actorId: "operator",
            displayName: "Operator",
            role: "operator",
          },
        },
      }))
    );
    await app.close();
  });

  it("does not link non-Codex or unrelated plans to completed execution run results", async () => {
    const task = projectionNode({
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
    });
    const otherTask = projectionNode({
      id: "task:other-status-panel",
      kind: "task",
      title: "Wire other status panel",
    });
    const nonCodexPlan: ProductGraphProjection["nodes"][number] = {
      ...projectionNode({
        id: "plan:manual:checkout-status-panel",
        kind: "plan",
        title: "Manual plan for checkout status panel",
      }),
      tags: ["planning"],
      metadata: {
        taskNodeId: task.id,
      },
    };
    const unrelatedCodexPlan: ProductGraphProjection["nodes"][number] = {
      ...projectionNode({
        id: "plan:codex:other-status-panel",
        kind: "plan",
        title: "Codex plan for other status panel",
      }),
      tags: ["codex", "planning"],
      metadata: {
        taskNodeId: otherTask.id,
        promptHash: "1".repeat(64),
      },
    };
    const nonCodexPlanEdge = projectionEdge({
      id: "edge-manual-plan-checkout-status-panel",
      sourceNodeId: nonCodexPlan.id,
      targetNodeId: task.id,
      kind: "derived_from",
      label: "Plan derived from task",
    });
    const unrelatedCodexPlanEdge = projectionEdge({
      id: "edge-codex-plan-other-status-panel",
      sourceNodeId: unrelatedCodexPlan.id,
      targetNodeId: otherTask.id,
      kind: "derived_from",
      label: "Plan derived from task",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(
      makeProjection({
        nodes: [task, otherTask, nonCodexPlan, unrelatedCodexPlan],
        edges: [nonCodexPlanEdge, unrelatedCodexPlanEdge],
      })
    );
    graphRepoMocks.getGraphProjection.mockResolvedValue(makeExecutionProjection({ graphId: "graph-1" }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/runs/graph-1/link",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        taskNodeId: task.id,
      },
    });

    expect(response.statusCode).toBe(201);
    const link = response.json<{
      planEdges: ProductGraphEdge[];
    }>();
    expect(link.planEdges).toEqual([]);

    const events = repoMocks.appendProductEvents.mock.calls[0][0];
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "product.edge.upserted",
          edgeId: expect.stringMatching(/^run-plan-edge:/),
        }),
      ])
    );
    await app.close();
  });

  it("skips unsafe and non-code run file diffs when linking completed execution runs", async () => {
    const task = projectionNode({
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
    });
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [task] }));
    graphRepoMocks.getGraphProjection.mockResolvedValue(
      withExecutionFileDiffs(makeExecutionProjection({ graphId: "graph-1" }), [
        {
          path: "packages/frontend/src/CheckoutStatus.tsx",
          changeType: "created",
          summary: "Added a safe code file.",
        },
        {
          path: "../outside.ts",
          changeType: "modified",
          summary: "Traversal path should not become a code file link.",
        },
        {
          path: "C:\\workspace\\openagentgraph\\packages\\frontend\\src\\Secret.tsx",
          changeType: "modified",
          summary: "Absolute path should not become a code file link.",
        },
        {
          path: "/tmp/openagentgraph/packages/frontend/src/Secret.tsx",
          changeType: "modified",
          summary: "Absolute POSIX path should not become a code file link.",
        },
        {
          path: "docs/checkout-status.md",
          changeType: "modified",
          summary: "Non-code file should not become a code file link.",
        },
      ])
    );
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/runs/graph-1/link",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        taskNodeId: task.id,
      },
    });

    expect(response.statusCode).toBe(201);
    const link = response.json<{
      node: ProductGraphNode;
      fileNodes: ProductGraphNode[];
      fileEdges: ProductGraphEdge[];
    }>();
    expect(link.fileNodes).toEqual([
      expect.objectContaining({
        kind: "code_file",
        title: "packages/frontend/src/CheckoutStatus.tsx",
      }),
    ]);
    expect(link.fileEdges).toEqual([
      expect.objectContaining({
        sourceNodeId: link.node.id,
        targetNodeId: link.fileNodes[0].id,
        metadata: expect.objectContaining({
          filePath: "packages/frontend/src/CheckoutStatus.tsx",
          fileDiffCount: 1,
          changeTypes: "created",
        }),
      }),
    ]);

    const fileLinkEvents = repoMocks.appendProductEvents.mock.calls[0][0].filter((event) => {
      if (event.kind === "product.node.upserted") {
        return event.payload.node.kind === "code_file";
      }
      return event.payload.edge.kind === "touches";
    });
    const serializedFileLinks = JSON.stringify(fileLinkEvents);
    expect(serializedFileLinks).not.toContain("../outside.ts");
    expect(serializedFileLinks).not.toContain("Secret.tsx");
    expect(serializedFileLinks).not.toContain("docs/checkout-status.md");
    await app.close();
  });

  it("caps run file links when completed execution runs touch many code files", async () => {
    const task = projectionNode({
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
    });
    const fileDiffs = Array.from({ length: 30 }, (_, index): RunFileDiff => ({
      path: `packages/frontend/src/generated/File${String(index + 1).padStart(2, "0")}.ts`,
      changeType: "modified",
      summary: "Generated test fixture file.",
    }));
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [task] }));
    graphRepoMocks.getGraphProjection.mockResolvedValue(
      withExecutionFileDiffs(makeExecutionProjection({ graphId: "graph-1" }), fileDiffs)
    );
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/runs/graph-1/link",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        taskNodeId: task.id,
      },
    });

    expect(response.statusCode).toBe(201);
    const link = response.json<{
      fileNodes: ProductGraphNode[];
      fileEdges: ProductGraphEdge[];
      evidenceNode: ProductGraphNode;
    }>();
    expect(link.fileNodes).toHaveLength(25);
    expect(link.fileEdges).toHaveLength(25);
    expect(link.fileNodes.map((node) => node.title)).toEqual(
      fileDiffs.slice(0, 25).map((fileDiff) => fileDiff.path)
    );
    expect(link.fileNodes.map((node) => node.title)).not.toContain("packages/frontend/src/generated/File26.ts");
    expect(link.evidenceNode.metadata).toMatchObject({
      changedFileCount: 30,
    });

    const events = repoMocks.appendProductEvents.mock.calls[0][0];
    const fileNodeEvents = events.filter(
      (event) => event.kind === "product.node.upserted" && event.nodeId?.startsWith("openagentgraph-run:file:")
    );
    const fileEdgeEvents = events.filter(
      (event) => event.kind === "product.edge.upserted" && event.edgeId?.startsWith("run-file-edge:")
    );
    expect(fileNodeEvents).toHaveLength(25);
    expect(fileEdgeEvents).toHaveLength(25);
    await app.close();
  });

  it("reuses existing code file nodes when linking completed execution runs", async () => {
    const task = projectionNode({
      id: "task:checkout-status-panel",
      kind: "task",
      title: "Wire checkout status panel",
    });
    const codeFile: ProductGraphProjection["nodes"][number] = {
      ...projectionNode({
        id: "file:checkout-status-panel",
        kind: "code_file",
        title: "packages/frontend/src/CheckoutStatus.tsx",
      }),
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/frontend/src/CheckoutStatus.tsx",
      },
      metadata: {
        scannerSourceFile: "packages/frontend/src/CheckoutStatus.tsx",
      },
    };
    repoMocks.getProductGraphProjection.mockResolvedValue(makeProjection({ nodes: [task, codeFile] }));
    graphRepoMocks.getGraphProjection.mockResolvedValue(makeExecutionProjection({ graphId: "graph-1" }));
    const app = Fastify();
    await app.register(productGraphRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/product-graph/runs/graph-1/link",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
      payload: {
        taskNodeId: task.id,
      },
    });

    expect(response.statusCode).toBe(201);
    const link = response.json<{
      node: ProductGraphNode;
      edge: ProductGraphEdge;
      evidenceNode: ProductGraphNode;
      evidenceEdge: ProductGraphEdge;
      fileNodes: ProductGraphNode[];
      fileEdges: ProductGraphEdge[];
    }>();
    expect(link.fileNodes).toEqual([
      expect.objectContaining({
        id: codeFile.id,
        kind: "code_file",
        source: codeFile.source,
        metadata: codeFile.metadata,
      }),
    ]);
    expect((link.fileNodes[0] as ProductGraphNode & { incomingEdgeIds?: string[] }).incomingEdgeIds).toBeUndefined();
    expect(link.fileEdges).toEqual([
      expect.objectContaining({
        sourceNodeId: link.node.id,
        targetNodeId: codeFile.id,
        kind: "touches",
        label: "Run changed file",
      }),
    ]);

    const events = repoMocks.appendProductEvents.mock.calls[0][0];
    expect(events).toHaveLength(5);
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "product.node.upserted",
          nodeId: codeFile.id,
        }),
      ])
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "product.edge.upserted",
          edgeId: link.fileEdges[0].id,
          payload: {
            edge: link.fileEdges[0],
            actor: {
              actorId: "operator",
              displayName: "Operator",
              role: "operator",
            },
          },
        }),
      ])
    );
    await app.close();
  });
});
