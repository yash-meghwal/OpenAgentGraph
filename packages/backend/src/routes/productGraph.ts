import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { nanoid } from "nanoid";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  ActorIdentity,
  GraphProjection,
  GraphTaskLensId,
  ProductEdgeKind,
  ProductGraphCodexPlanningPrompt,
  ProductGraphEdge,
  ProductGraphHandoffOptions,
  ProductGraphNode,
  ProductGraphProjection,
  ProductMetadataValue,
  ProductNodeKind,
  ProductNodeStatus,
  ProductSourceRef,
  ScanJobStatus,
  ScanProgressSnapshot,
} from "@openagentgraph/shared";
import { GRAPH_TASK_LENS_DEFINITIONS } from "@openagentgraph/shared";
import {
  buildProductGraphCodexPlanningPrompt,
  buildProductGraphHandoffReport,
  buildProductGraphTrace,
} from "@openagentgraph/shared";
import { canActorPerform, permissionMessage, resolveAuth } from "../auth/actors.js";
import { getAppConfig } from "../config.js";
import {
  DEFAULT_PRODUCT_GRAPH_ID,
  appendProductEvent,
  appendProductEvents,
  getProductGraphProjection,
} from "../db/productGraphRepo.js";
import { getGraphProjection as getExecutionGraphProjection } from "../db/graphRepo.js";
import { incrementFailureMetric, incrementMetric } from "../observability/metrics.js";
import { scanWorkspaceCodebase } from "../scanner/codeScanner.js";
import {
  buildScanProgressSnapshot,
  createScanBreakerStatus,
} from "../scanner/scanProgress.js";
import {
  checkProductGraphWorkspacePaths,
  formatHandoffDataSourceForReport,
  formatHandoffWorkspaceRootForReport,
  isPathInsideRoot,
} from "../productGraphHandoffTrust.js";
import { buildWorkspaceGraphOperationalContext } from "../cli/graphOperational.js";

import {
  AcceptCodexPlanRequest,
  CreateIntentBundleRequest,
  CreateProductEdgeRequest,
  CreateProductNodeRequest,
  LinkProductRunRequest,
  MAX_PRODUCT_NODE_ID_LENGTH,
  PRODUCT_GRAPH_HANDOFF_FILE_NAME,
  ProductGraphCodebaseScanResult,
  buildAcceptedCodexPlan,
  buildOpenAgentGraphRunLink,
  buildProductEdge,
  buildProductGraphHandoffOptions,
  buildProductIntentBundle,
  buildProductNode,
  buildSpecKitImportPlan,
  codebaseScanState,
  createProductScanJob,
  detectSpecKitArtifacts,
  hashCodexPlanningPrompt,
  isRecord,
  parseOptionalCodexPlanPromptHash,
  productGraphScanJobs,
  publicProductScanJob,
  requireProductGraphWriteActor,
  resolveProductGraphWorkspaceRoot,
  runProductGraphCodebaseScan,
  trimRequiredId,
  writeProductGraphHandoffFile,
  writeProductScanSse,
} from "./productGraphRouteHelpers.js";

export async function productGraphRoutes(app: FastifyInstance) {
  app.get("/product-graph", async () =>
    getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID)
  );

  app.get("/product-graph/handoff", async () => {
    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    return buildProductGraphHandoffReport(projection, await buildProductGraphHandoffOptions({ projection }));
  });

  app.get<{ Querystring: { lens?: string } }>("/product-graph/workspace-graph", async (req, reply) => {
    const workspaceRoot = await resolveProductGraphWorkspaceRoot();
    if (!workspaceRoot) {
      return {
        available: false,
        unavailableReason: "workspace_not_configured",
        unavailableDetail: "Configure workspace.root before loading graph operational context.",
        lens: "all" as const,
      };
    }

    const lensIds = new Set(GRAPH_TASK_LENS_DEFINITIONS.map((definition) => definition.id));
    const requestedLens = req.query.lens?.trim();
    const lens = requestedLens && lensIds.has(requestedLens as GraphTaskLensId)
      ? (requestedLens as GraphTaskLensId)
      : "all";

    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    return buildWorkspaceGraphOperationalContext({
      workspaceRoot,
      lens,
      productGraph: projection,
    });
  });

  app.post("/product-graph/handoff/write", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const options = await buildProductGraphHandoffOptions({ projection, handoffFileExists: true });
    if (options.workspacePathCheck?.status === "mismatch") {
      return reply.status(409).send({
        error: "Product Graph code paths do not match the configured workspace root. Refresh the codebase scan or point OpenAgentGraph at the matching workspace before writing GRAPH_REPORT.md.",
        workspacePathCheck: options.workspacePathCheck,
      });
    }

    const report = buildProductGraphHandoffReport(projection, options);
    const workspaceRoot = await resolveProductGraphWorkspaceRoot();
    const outputPath = await writeProductGraphHandoffFile(workspaceRoot, report.markdown);

    return reply.status(201).send({
      status: "written",
      path: path.relative(workspaceRoot, outputPath) || PRODUCT_GRAPH_HANDOFF_FILE_NAME,
      ...report,
    });
  });

  app.get<{ Params: { nodeId: string } }>("/product-graph/trace/:nodeId", async (req, reply) => {
    const nodeId = trimRequiredId(req.params.nodeId, "nodeId", MAX_PRODUCT_NODE_ID_LENGTH);
    if (nodeId.error || !nodeId.value) {
      return reply.status(400).send({ error: nodeId.error ?? "nodeId is required." });
    }

    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const trace = buildProductGraphTrace({
      projection,
      rootNodeId: nodeId.value,
    });
    if (!trace) {
      return reply.status(404).send({ error: "Product graph node was not found." });
    }

    return trace;
  });

  app.get<{ Params: { taskNodeId: string } }>("/product-graph/codex-plan/:taskNodeId", async (req, reply) => {
    const taskNodeId = trimRequiredId(req.params.taskNodeId, "taskNodeId", MAX_PRODUCT_NODE_ID_LENGTH);
    if (taskNodeId.error || !taskNodeId.value) {
      return reply.status(400).send({ error: taskNodeId.error ?? "taskNodeId is required." });
    }
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const basePlanningPrompt = buildProductGraphCodexPlanningPrompt({
      projection,
      taskNodeId: taskNodeId.value,
    });
    if (!basePlanningPrompt) {
      return reply.status(404).send({ error: "Product graph task was not found." });
    }

    return basePlanningPrompt;
  });

  app.post<{ Params: { taskNodeId: string }; Body: AcceptCodexPlanRequest }>(
    "/product-graph/codex-plan/:taskNodeId/accept",
    async (req, reply) => {
      const actor = requireProductGraphWriteActor(req, reply);
      if (!actor) return;

      const request = isRecord(req.body) ? req.body : {};
      const taskNodeId = trimRequiredId(req.params.taskNodeId, "taskNodeId", MAX_PRODUCT_NODE_ID_LENGTH);
      if (taskNodeId.error || !taskNodeId.value) {
        return reply.status(400).send({ error: taskNodeId.error ?? "taskNodeId is required." });
      }

      const requestedPromptHash = parseOptionalCodexPlanPromptHash(request.promptHash);
      if (requestedPromptHash.error) {
        return reply.status(400).send({ error: requestedPromptHash.error });
      }

      const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
      const basePlanningPrompt = buildProductGraphCodexPlanningPrompt({
        projection,
        taskNodeId: taskNodeId.value,
      });
      if (!basePlanningPrompt) {
        return reply.status(404).send({ error: "Product graph task was not found." });
      }

      const planningPrompt = basePlanningPrompt;
      const currentPromptHash = hashCodexPlanningPrompt(planningPrompt.prompt);
      if (requestedPromptHash.value && requestedPromptHash.value !== currentPromptHash) {
        return reply.status(409).send({
          error: "Codex planning prompt changed. Reload the plan before accepting it.",
        });
      }
      const acceptedPlan = buildAcceptedCodexPlan({
        taskNodeId: taskNodeId.value,
        planningPrompt,
        request,
        now: new Date().toISOString(),
      });

      await appendProductEvents([
        {
          productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
          kind: "product.node.upserted",
          nodeId: acceptedPlan.node.id,
          payload: { node: acceptedPlan.node, actor },
        },
        {
          productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
          kind: "product.edge.upserted",
          edgeId: acceptedPlan.edge.id,
          payload: { edge: acceptedPlan.edge, actor },
        },
      ]);

      return reply.status(201).send(acceptedPlan);
    }
  );

  app.post<{ Body: CreateProductNodeRequest }>("/product-graph/nodes", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const node = buildProductNode(req.body ?? {});
    if ("error" in node) {
      return reply.status(400).send({ error: node.error });
    }

    await appendProductEvent({
      productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
      kind: "product.node.upserted",
      nodeId: node.id,
      payload: { node, actor },
    });

    return reply.status(201).send(node);
  });

  app.post<{ Body: CreateProductEdgeRequest }>("/product-graph/edges", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const edge = buildProductEdge(req.body ?? {});
    if ("error" in edge) {
      return reply.status(400).send({ error: edge.error });
    }

    const projection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const nodeIds = new Set(projection.nodes.map((node) => node.id));
    if (!nodeIds.has(edge.sourceNodeId)) {
      return reply.status(400).send({ error: "sourceNodeId must reference an existing product graph node." });
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      return reply.status(400).send({ error: "targetNodeId must reference an existing product graph node." });
    }

    await appendProductEvent({
      productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
      kind: "product.edge.upserted",
      edgeId: edge.id,
      payload: { edge, actor },
    });

    return reply.status(201).send(edge);
  });

  app.post<{ Body: CreateIntentBundleRequest }>("/product-graph/intent-bundles", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const bundle = buildProductIntentBundle(req.body ?? {});
    if ("error" in bundle) {
      return reply.status(400).send({ error: bundle.error });
    }

    await appendProductEvents([
      ...bundle.nodes.map((node) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted",
        nodeId: node.id,
        payload: { node, actor },
      } as const)),
      ...bundle.edges.map((edge) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted",
        edgeId: edge.id,
        payload: { edge, actor },
      } as const)),
    ]);

    return reply.status(201).send(bundle);
  });

  app.post<{ Params: { graphId: string }; Body: LinkProductRunRequest }>("/product-graph/runs/:graphId/link", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const graphId = trimRequiredId(req.params.graphId, "graphId", MAX_PRODUCT_NODE_ID_LENGTH);
    if (graphId.error || !graphId.value) {
      return reply.status(400).send({ error: graphId.error ?? "graphId is required." });
    }

    const taskNodeId = trimRequiredId(req.body?.taskNodeId, "taskNodeId", MAX_PRODUCT_NODE_ID_LENGTH);
    if (taskNodeId.error || !taskNodeId.value) {
      return reply.status(400).send({ error: taskNodeId.error ?? "taskNodeId is required." });
    }

    const graphProjection = await getExecutionGraphProjection(graphId.value).catch(() => undefined);
    if (!graphProjection) {
      return reply.status(404).send({ error: "OpenAgentGraph run graph was not found." });
    }
    if (graphProjection.graph.status !== "completed") {
      return reply.status(409).send({ error: "Only completed OpenAgentGraph runs can be linked to product graph tasks." });
    }

    const productProjection = await getProductGraphProjection(DEFAULT_PRODUCT_GRAPH_ID);
    const taskNode = productProjection.nodes.find((node) => node.id === taskNodeId.value);
    if (!taskNode) {
      return reply.status(404).send({ error: "Product graph task was not found." });
    }
    if (taskNode.kind !== "task") {
      return reply.status(400).send({ error: "taskNodeId must reference a Product Graph task node." });
    }

    const linkPlan = buildOpenAgentGraphRunLink({
      graphProjection,
      productProjection,
      taskNodeId: taskNode.id,
    });
    const { fileNodesToUpsert, ...link } = linkPlan;
    await appendProductEvents([
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted",
        nodeId: link.node.id,
        payload: { node: link.node, actor },
      },
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted",
        nodeId: link.evidenceNode.id,
        payload: { node: link.evidenceNode, actor },
      },
      ...fileNodesToUpsert.map((fileNode) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted" as const,
        nodeId: fileNode.id,
        payload: { node: fileNode, actor },
      })),
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted",
        edgeId: link.edge.id,
        payload: { edge: link.edge, actor },
      },
      ...link.planEdges.map((planEdge) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted" as const,
        edgeId: planEdge.id,
        payload: { edge: planEdge, actor },
      })),
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted",
        edgeId: link.evidenceEdge.id,
        payload: { edge: link.evidenceEdge, actor },
      },
      ...link.fileEdges.map((fileEdge) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted" as const,
        edgeId: fileEdge.id,
        payload: { edge: fileEdge, actor },
      })),
    ]);

    return reply.status(201).send(link);
  });

  app.post("/product-graph/codebase/scan", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    if (codebaseScanState.inProgress) {
      return reply.status(409).send({
        status: "scan_in_progress",
        error: "A codebase scan is already running.",
      });
    }

    codebaseScanState.inProgress = true;
    try {
      return reply.status(201).send(await runProductGraphCodebaseScan(actor));
    } finally {
      codebaseScanState.inProgress = false;
    }
  });

  app.post("/product-graph/codebase/scan-jobs", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    if (codebaseScanState.inProgress) {
      return reply.status(409).send({
        status: "scan_in_progress",
        error: "A codebase scan is already running.",
      });
    }

    return reply.status(202).send(publicProductScanJob(createProductScanJob(actor)));
  });

  app.get("/product-graph/codebase/scan-jobs/:jobId", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const jobId = (req.params as { jobId?: string }).jobId;
    const job = jobId ? productGraphScanJobs.get(jobId) : undefined;
    if (!job) return reply.status(404).send({ error: "Product Graph codebase scan job was not found." });
    return publicProductScanJob(job);
  });

  app.get("/product-graph/codebase/scan-jobs/:jobId/events", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const jobId = (req.params as { jobId?: string }).jobId;
    const job = jobId ? productGraphScanJobs.get(jobId) : undefined;
    if (!job) return reply.status(404).send({ error: "Product Graph codebase scan job was not found." });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    for (const event of job.events) {
      writeProductScanSse(reply, { ...publicProductScanJob(job), progress: event });
    }
    if (job.status === "completed" || job.status === "failed") {
      reply.raw.end();
      return;
    }
    const listener = (nextJob: ScanJobStatus<ProductGraphCodebaseScanResult>) => {
      writeProductScanSse(reply, nextJob);
      if (nextJob.status === "completed" || nextJob.status === "failed") {
        job.listeners.delete(listener);
        reply.raw.end();
      }
    };
    job.listeners.add(listener);
    req.raw.on("close", () => {
      job.listeners.delete(listener);
    });
  });

  app.post("/product-graph/spec-kit/import", async (req, reply) => {
    const actor = requireProductGraphWriteActor(req, reply);
    if (!actor) return;

    const workspaceRoot = await resolveProductGraphWorkspaceRoot();
    const detection = await detectSpecKitArtifacts(workspaceRoot);
    if (detection.presentArtifacts.length === 0) {
      return reply.status(404).send({
        status: "missing_artifacts",
        message:
          "Spec Kit artifacts are missing. Add .specify/memory/constitution.md or Spec Kit files under specs/ before importing.",
        ...detection,
      });
    }

    const importPlan = await buildSpecKitImportPlan(workspaceRoot);
    if ("error" in importPlan) {
      return reply.status(400).send({
        status: "invalid_spec_kit_artifacts",
        error: importPlan.error,
        ...detection,
      });
    }

    await appendProductEvents([
      ...importPlan.nodes.map((node) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted",
        nodeId: node.id,
        payload: { node, actor },
      } as const)),
      ...importPlan.edges.map((edge) => ({
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted",
        edgeId: edge.id,
        payload: { edge, actor },
      } as const)),
    ]);

    return reply.status(201).send({
      status: "imported",
      message: "Spec Kit artifacts imported into the Product Graph.",
      imported: importPlan.summary,
      ...detection,
    });
  });
}
