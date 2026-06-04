import { describe, expect, it } from "vitest";
import type {
  ActorIdentity,
  ProductGraphEdge,
  ProductGraphCodexPlanningPrompt,
  ProductGraphNode,
  ProductGraphProjection,
  ProductGraphTrace,
} from "@openagentgraph/shared";
import {
  acceptProductGraphCodexPlan,
  createProductGraphEdge,
  createProductGraphIntentBundle,
  createProductGraphNode,
  fetchProductGraphCodexPlan,
  fetchProductGraphHandoff,
  fetchProductGraph,
  fetchProductGraphTrace,
  fetchProductGraphCodebaseScanJob,
  writeProductGraphHandoff,
  scanProductGraphCodebase,
  startProductGraphCodebaseScanJob,
  importProductGraphSpecKit,
  linkProductGraphRun,
  type ProductGraphFetch,
} from "./productGraphApi.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function makeProjection(): ProductGraphProjection {
  return {
    schemaVersion: "1",
    productGraphId: "default",
    nodes: [],
    edges: [],
    events: [],
    summary: {
      nodeCount: 0,
      edgeCount: 0,
      nodesByKind: {},
      edgesByKind: {},
      unresolvedOpenQuestionCount: 0,
      blockedTaskCount: 0,
    },
  };
}

function makeNode(): ProductGraphNode {
  return {
    id: "feature:intent-graph",
    kind: "feature",
    title: "Intent Graph",
    status: "planned",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

function makeProductGraphTrace(): ProductGraphTrace {
  const node = {
    ...makeNode(),
    incomingEdgeIds: [],
    outgoingEdgeIds: [],
    blockedByNodeIds: [],
  };
  return {
    schemaVersion: "1",
    productGraphId: "default",
    rootNode: node,
    nodes: [node],
    edges: [],
    hopsByNodeId: {
      [node.id]: 0,
    },
    summary: {
      nodeCount: 1,
      edgeCount: 0,
      maxDepth: 2,
      codeNodeCount: 0,
      testResultNodeCount: 0,
      evidenceNodeCount: 0,
    },
  };
}

function makeProductGraphCodexPlan(): ProductGraphCodexPlanningPrompt {
  const taskNode = {
    ...makeNode(),
    id: "task:checkout-status-panel",
    kind: "task" as const,
    title: "Wire checkout status panel",
    incomingEdgeIds: [],
    outgoingEdgeIds: [],
    blockedByNodeIds: [],
  };
  return {
    taskNode,
    intentNodes: [],
    acceptanceCriteria: [],
    likelyCodeAreas: [],
    openQuestions: [],
    risks: ["No linked acceptance criteria; confirm expected behavior before coding."],
    verificationCommands: ["npm run build", "npm run test"],
    prompt: "You are Codex working from OpenAgentGraph product graph context.",
  };
}

function makeEdge(): ProductGraphEdge {
  return {
    id: "edge-story-feature",
    sourceNodeId: "story-1",
    targetNodeId: "feature-1",
    kind: "belongs_to",
    trust: "manual",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

function makeRunLink(): {
  node: ProductGraphNode;
  edge: ProductGraphEdge;
  evidenceNode: ProductGraphNode;
  evidenceEdge: ProductGraphEdge;
  planEdges: ProductGraphEdge[];
  fileNodes: ProductGraphNode[];
  fileEdges: ProductGraphEdge[];
} {
  return {
    node: {
      id: "run:checkout-proof",
      kind: "agent_run",
      title: "Checkout proof run",
      status: "completed",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    edge: {
      id: "edge-task-run",
      sourceNodeId: "task:checkout-status-panel",
      targetNodeId: "run:checkout-proof",
      kind: "produced_by",
      trust: "manual",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    evidenceNode: {
      id: "evidence:checkout-proof",
      kind: "evidence",
      title: "Checkout proof run evidence",
      status: "completed",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    evidenceEdge: {
      id: "edge-run-evidence",
      sourceNodeId: "evidence:checkout-proof",
      targetNodeId: "run:checkout-proof",
      kind: "produced_by",
      trust: "manual",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    planEdges: [],
    fileNodes: [],
    fileEdges: [],
  };
}

function makeAcceptedCodexPlan(): {
  node: ProductGraphNode;
  edge: ProductGraphEdge;
} {
  return {
    node: {
      id: "plan:codex:checkout-status-panel",
      kind: "plan",
      title: "Codex plan for Wire checkout status panel",
      status: "planned",
      tags: ["codex", "planning"],
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    edge: {
      id: "edge-codex-plan-checkout-status-panel",
      sourceNodeId: "plan:codex:checkout-status-panel",
      targetNodeId: "task:checkout-status-panel",
      kind: "derived_from",
      trust: "manual",
      label: "Plan derived from task",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
  };
}

function makeSpecKitImportResult() {
  return {
    status: "imported",
    message: "Spec Kit artifacts imported into the Product Graph.",
    imported: {
      nodeCount: 4,
      edgeCount: 3,
      constitutionCount: 1,
      specFileCount: 1,
      featureCount: 1,
      userStoryCount: 1,
      requirementCount: 1,
      acceptanceCriterionCount: 0,
      openQuestionCount: 0,
      contractFileCount: 0,
      contractCount: 0,
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
  } as const;
}

function makeCodebaseScanResult() {
  return {
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
      durationMs: 12,
      partial: false,
    },
  } as const;
}

function makeHandoffReport() {
  return {
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
  };
}

function makeActor(): ActorIdentity {
  return {
    actorId: "operator",
    displayName: "Operator",
    role: "operator",
  };
}

describe("product graph api client", () => {
  it("fetches the product graph projection from the runtime API base", async () => {
    const projection = makeProjection();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(projection);
    };

    await expect(fetchProductGraph({ fetchImpl })).resolves.toEqual(projection);
    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toBe("/api/product-graph");
  });

  it("fetches the deterministic Product Graph handoff report", async () => {
    const handoff = makeHandoffReport();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(handoff);
    };

    await expect(fetchProductGraphHandoff({ fetchImpl })).resolves.toEqual(handoff);
    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toBe("/api/product-graph/handoff");
    expect(calls[0].init?.method).toBeUndefined();
  });

  it("writes the Product Graph handoff with development actor headers", async () => {
    const handoff = {
      status: "written",
      path: "GRAPH_REPORT.md",
      ...makeHandoffReport(),
    } as const;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(handoff, 201);
    };

    await expect(
      writeProductGraphHandoff({
        auth: {
          mode: "dev_header",
          actor: makeActor(),
        },
        fetchImpl,
      })
    ).resolves.toEqual(handoff);

    const request = calls[0];
    const headers = new Headers(request.init?.headers);
    expect(String(request.input)).toBe("/api/product-graph/handoff/write");
    expect(request.init?.method).toBe("POST");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(headers.has("Content-Type")).toBe(false);
    expect(request.init?.body).toBeUndefined();
  });

  it("fetches a product graph trace with an encoded node id", async () => {
    const trace = makeProductGraphTrace();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(trace);
    };

    await expect(fetchProductGraphTrace("feature:intent-graph", { fetchImpl })).resolves.toEqual(trace);
    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toBe("/api/product-graph/trace/feature%3Aintent-graph");
  });

  it("fetches a Codex planning prompt with an encoded task id", async () => {
    const codexPlan = makeProductGraphCodexPlan();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(codexPlan);
    };

    await expect(fetchProductGraphCodexPlan("task:checkout status", { fetchImpl })).resolves.toEqual(codexPlan);
    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toBe("/api/product-graph/codex-plan/task%3Acheckout%20status");
  });

  it("accepts Codex planning prompts with development actor headers", async () => {
    const acceptedPlan = makeAcceptedCodexPlan();
    const promptHash = "a".repeat(64);
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(acceptedPlan, 201);
    };

    await expect(
      acceptProductGraphCodexPlan(
        {
          taskNodeId: "task:checkout status",
          promptHash,
          title: "Accepted checkout plan",
          summary: "Persist the loaded Codex planning prompt.",
        },
        {
          auth: {
            mode: "dev_header",
            actor: makeActor(),
          },
          fetchImpl,
        }
      )
    ).resolves.toEqual(acceptedPlan);

    const request = calls[0];
    const headers = new Headers(request.init?.headers);
    expect(String(request.input)).toBe("/api/product-graph/codex-plan/task%3Acheckout%20status/accept");
    expect(request.init?.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(JSON.parse(String(request.init?.body))).toEqual({
      promptHash,
      title: "Accepted checkout plan",
      summary: "Persist the loaded Codex planning prompt.",
    });
  });

  it("creates product graph nodes with development actor headers", async () => {
    const node = makeNode();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(node, 201);
    };

    await expect(
      createProductGraphNode(
        {
          id: node.id,
          kind: "feature",
          title: "Intent Graph",
          tags: ["phase-1"],
        },
        {
          auth: {
            mode: "dev_header",
            actor: makeActor(),
          },
          fetchImpl,
        }
      )
    ).resolves.toEqual(node);

    const request = calls[0];
    const headers = new Headers(request.init?.headers);
    expect(String(request.input)).toBe("/api/product-graph/nodes");
    expect(request.init?.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(JSON.parse(String(request.init?.body))).toEqual({
      id: "feature:intent-graph",
      kind: "feature",
      title: "Intent Graph",
      tags: ["phase-1"],
    });
  });

  it("creates product graph edges with bearer auth", async () => {
    const edge = makeEdge();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(edge, 201);
    };

    await expect(
      createProductGraphEdge(
        {
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          kind: edge.kind,
          label: "Story belongs to feature",
        },
        {
          auth: {
            mode: "jwt",
            token: "token-123",
          },
          fetchImpl,
        }
      )
    ).resolves.toEqual(edge);

    const request = calls[0];
    const headers = new Headers(request.init?.headers);
    expect(String(request.input)).toBe("/api/product-graph/edges");
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(JSON.parse(String(request.init?.body))).toEqual({
      id: "edge-story-feature",
      sourceNodeId: "story-1",
      targetNodeId: "feature-1",
      kind: "belongs_to",
      label: "Story belongs to feature",
    });
  });

  it("creates product graph intent bundles with development actor headers", async () => {
    const bundle = {
      nodes: [makeNode()],
      edges: [makeEdge()],
    };
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(bundle, 201);
    };

    await expect(
      createProductGraphIntentBundle(
        {
          feature: {
            id: "feature:intent-graph",
            title: "Intent Graph",
            tags: ["phase-1"],
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
              title: "Build intent view",
            },
          ],
        },
        {
          auth: {
            mode: "dev_header",
            actor: makeActor(),
          },
          fetchImpl,
        }
      )
    ).resolves.toEqual(bundle);

    const request = calls[0];
    const headers = new Headers(request.init?.headers);
    expect(String(request.input)).toBe("/api/product-graph/intent-bundles");
    expect(request.init?.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(JSON.parse(String(request.init?.body))).toEqual({
      feature: {
        id: "feature:intent-graph",
        title: "Intent Graph",
        tags: ["phase-1"],
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
          title: "Build intent view",
        },
      ],
    });
  });

  it("links completed OpenAgentGraph runs to product graph tasks", async () => {
    const link = makeRunLink();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(link, 201);
    };

    await expect(
      linkProductGraphRun(
        {
          graphId: "graph:checkout proof",
          taskNodeId: "task:checkout-status-panel",
        },
        {
          auth: {
            mode: "dev_header",
            actor: makeActor(),
          },
          fetchImpl,
        }
      )
    ).resolves.toEqual(link);

    const request = calls[0];
    const headers = new Headers(request.init?.headers);
    expect(String(request.input)).toBe("/api/product-graph/runs/graph%3Acheckout%20proof/link");
    expect(request.init?.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(JSON.parse(String(request.init?.body))).toEqual({
      taskNodeId: "task:checkout-status-panel",
    });
  });

  it("imports Spec Kit artifacts with development actor headers", async () => {
    const importResult = makeSpecKitImportResult();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(importResult, 201);
    };

    await expect(
      importProductGraphSpecKit({
        auth: {
          mode: "dev_header",
          actor: makeActor(),
        },
        fetchImpl,
      })
    ).resolves.toEqual(importResult);

    const request = calls[0];
    const headers = new Headers(request.init?.headers);
    expect(String(request.input)).toBe("/api/product-graph/spec-kit/import");
    expect(request.init?.method).toBe("POST");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(headers.has("Content-Type")).toBe(false);
    expect(request.init?.body).toBeUndefined();
  });

  it("scans the codebase with development actor headers", async () => {
    const scanResult = makeCodebaseScanResult();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(scanResult, 201);
    };

    await expect(
      scanProductGraphCodebase({
        auth: {
          mode: "dev_header",
          actor: makeActor(),
        },
        fetchImpl,
      })
    ).resolves.toEqual(scanResult);

    const request = calls[0];
    const headers = new Headers(request.init?.headers);
    expect(String(request.input)).toBe("/api/product-graph/codebase/scan");
    expect(request.init?.method).toBe("POST");
    expect(headers.get("x-openagentgraph-actor-id")).toBe("operator");
    expect(headers.has("Content-Type")).toBe(false);
    expect(request.init?.body).toBeUndefined();
  });

  it("starts and reads codebase scan jobs with development actor headers", async () => {
    const scanResult = makeCodebaseScanResult();
    const startedJob = {
      jobId: "product-job-1",
      scope: "product_codebase",
      status: "running",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      progress: {
        scanId: "product-job-1",
        scope: "product_codebase",
        phase: "collecting_files",
        startedAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
        filesScanned: 1,
        bytesScanned: 128,
        skippedFileCount: 0,
        skippedDirectoryCount: 0,
        filesPerSecond: 10,
        megabytesPerSecond: 0.01,
        breakers: {
          state: "ok",
          limits: {
            maxFiles: 20_000,
            maxTotalBytes: 200_000_000,
            maxFileBytes: 5_000_000,
            maxDepth: 40,
            maxDurationMs: 180_000,
          },
          hits: [],
          near: [],
        },
      },
    } as const;
    const completedJob = {
      ...startedJob,
      status: "completed",
      result: scanResult,
    };
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: ProductGraphFetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(calls.length === 1 ? startedJob : completedJob, calls.length === 1 ? 202 : 200);
    };
    const auth = {
      mode: "dev_header" as const,
      actor: makeActor(),
    };

    await expect(startProductGraphCodebaseScanJob({ auth, fetchImpl })).resolves.toEqual(startedJob);
    await expect(fetchProductGraphCodebaseScanJob("product-job-1", { auth, fetchImpl })).resolves.toEqual(completedJob);

    expect(String(calls[0].input)).toBe("/api/product-graph/codebase/scan-jobs");
    expect(calls[0].init?.method).toBe("POST");
    expect(String(calls[1].input)).toBe("/api/product-graph/codebase/scan-jobs/product-job-1");
    expect(new Headers(calls[1].init?.headers).get("x-openagentgraph-actor-id")).toBe("operator");
  });

  it("surfaces backend product graph errors with status codes", async () => {
    const fetchImpl: ProductGraphFetch = async () =>
      jsonResponse({ error: "targetNodeId must reference an existing product graph node." }, 400);

    await expect(
      createProductGraphEdge(
        {
          sourceNodeId: "story-1",
          targetNodeId: "missing-feature",
          kind: "belongs_to",
        },
        { fetchImpl }
      )
    ).rejects.toMatchObject({
      message: "targetNodeId must reference an existing product graph node.",
      status: 400,
    });
  });

  it("surfaces backend product graph messages with status codes", async () => {
    const fetchImpl: ProductGraphFetch = async () =>
      jsonResponse({ message: "Spec Kit artifacts are missing." }, 404);

    await expect(importProductGraphSpecKit({ fetchImpl })).rejects.toMatchObject({
      message: "Spec Kit artifacts are missing.",
      status: 404,
    });
  });
});
