import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProductGraphEdge, ProductGraphNode } from "@openagentgraph/shared";

let tempDir = "";
let closeDb: (() => void) | undefined;
let appendProductEvent: typeof import("./productGraphRepo.js").appendProductEvent;
let appendProductEvents: typeof import("./productGraphRepo.js").appendProductEvents;
let getProductEvents: typeof import("./productGraphRepo.js").getProductEvents;
let getProductGraphProjection: typeof import("./productGraphRepo.js").getProductGraphProjection;

function makeNode(input: {
  id: string;
  kind: ProductGraphNode["kind"];
  title: string;
  status?: ProductGraphNode["status"];
}): ProductGraphNode {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    status: input.status ?? "planned",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

function makeEdge(input: {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: ProductGraphEdge["kind"];
}): ProductGraphEdge {
  return {
    id: input.id,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    kind: input.kind,
    trust: "manual",
    createdAt: "2026-05-12T00:00:01.000Z",
    updatedAt: "2026-05-12T00:00:01.000Z",
  };
}

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openagentgraph-product-db-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const clientModule = await import("./client.js");
  clientModule.initDb();
  closeDb = clientModule.closeDb;

  const productGraphRepoModule = await import("./productGraphRepo.js");
  appendProductEvent = productGraphRepoModule.appendProductEvent;
  appendProductEvents = productGraphRepoModule.appendProductEvents;
  getProductEvents = productGraphRepoModule.getProductEvents;
  getProductGraphProjection = productGraphRepoModule.getProductGraphProjection;
});

afterAll(async () => {
  closeDb?.();
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  delete process.env.DATA_DIR;
});

describe("productGraphRepo integration", () => {
  it("persists product events and replays a product graph projection", async () => {
    const productGraphId = "product-graph-1";
    const otherProductGraphId = "product-graph-2";
    const feature = makeNode({
      id: "feature-1",
      kind: "feature",
      title: "Intent Graph Foundation",
    });
    const task = makeNode({
      id: "task-1",
      kind: "task",
      title: "Add product event persistence",
    });
    const question = makeNode({
      id: "question-1",
      kind: "open_question",
      title: "Which importer runs first?",
      status: "proposed",
    });
    const taskEdge = makeEdge({
      id: "edge-task-feature",
      sourceNodeId: task.id,
      targetNodeId: feature.id,
      kind: "belongs_to",
    });
    const blockingEdge = makeEdge({
      id: "edge-task-question",
      sourceNodeId: task.id,
      targetNodeId: question.id,
      kind: "blocked_by",
    });

    const firstEvent = await appendProductEvent({
      productGraphId,
      kind: "product.node.upserted",
      nodeId: feature.id,
      payload: { node: feature },
    });
    const secondEvent = await appendProductEvent({
      productGraphId,
      kind: "product.node.upserted",
      nodeId: task.id,
      payload: { node: task },
    });
    await appendProductEvent({
      productGraphId: otherProductGraphId,
      kind: "product.node.upserted",
      nodeId: "other-feature",
      payload: {
        node: makeNode({
          id: "other-feature",
          kind: "feature",
          title: "Different product graph",
        }),
      },
    });
    await appendProductEvent({
      productGraphId,
      kind: "product.node.upserted",
      nodeId: question.id,
      payload: { node: question },
    });
    await appendProductEvent({
      productGraphId,
      kind: "product.edge.upserted",
      edgeId: taskEdge.id,
      payload: { edge: taskEdge },
    });
    await appendProductEvent({
      productGraphId,
      kind: "product.edge.upserted",
      edgeId: blockingEdge.id,
      payload: { edge: blockingEdge },
    });

    const events = await getProductEvents(productGraphId);
    const projection = await getProductGraphProjection(productGraphId);
    const projectedTask = projection.nodes.find((node) => node.id === task.id);

    expect(firstEvent.seq).toBe(1);
    expect(secondEvent.seq).toBe(2);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(events.map((event) => event.productGraphId)).toEqual([
      productGraphId,
      productGraphId,
      productGraphId,
      productGraphId,
      productGraphId,
    ]);
    expect(projection.summary.nodeCount).toBe(3);
    expect(projection.summary.edgeCount).toBe(2);
    expect(projection.summary.nodesByKind.feature).toBe(1);
    expect(projection.summary.blockedTaskCount).toBe(1);
    expect(projectedTask?.blockedByNodeIds).toEqual([question.id]);
  });

  it("assigns unique sequence numbers for parallel product graph appends", async () => {
    const productGraphId = "parallel-product-graph";

    await Promise.all(
      Array.from({ length: 5 }, async (_item, index) =>
        appendProductEvent({
          productGraphId,
          kind: "product.node.upserted",
          nodeId: `feature-${index + 1}`,
          payload: {
            node: makeNode({
              id: `feature-${index + 1}`,
              kind: "feature",
              title: `Feature ${index + 1}`,
            }),
          },
        })
      )
    );

    const events = await getProductEvents(productGraphId);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("persists product event batches atomically", async () => {
    const productGraphId = "batch-product-graph";
    const feature = makeNode({
      id: "feature-batch",
      kind: "feature",
      title: "Batch feature",
    });
    const task = makeNode({
      id: "task-batch",
      kind: "task",
      title: "Batch task",
    });
    const edge = makeEdge({
      id: "edge-task-feature-batch",
      sourceNodeId: task.id,
      targetNodeId: feature.id,
      kind: "implements",
    });

    const events = await appendProductEvents([
      {
        productGraphId,
        kind: "product.node.upserted",
        nodeId: feature.id,
        payload: { node: feature },
      },
      {
        productGraphId,
        kind: "product.node.upserted",
        nodeId: task.id,
        payload: { node: task },
      },
      {
        productGraphId,
        kind: "product.edge.upserted",
        edgeId: edge.id,
        payload: { edge },
      },
    ]);

    const persistedEvents = await getProductEvents(productGraphId);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(persistedEvents.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(persistedEvents.map((event) => event.kind)).toEqual([
      "product.node.upserted",
      "product.node.upserted",
      "product.edge.upserted",
    ]);
  });

  it("rolls back a product event batch when a later insert fails", async () => {
    const productGraphId = "failing-batch-product-graph";
    const feature = makeNode({
      id: "feature-failing-batch",
      kind: "feature",
      title: "Failing batch feature",
    });
    const circularPayload: any = {};
    circularPayload.self = circularPayload;

    await expect(
      appendProductEvents([
        {
          productGraphId,
          kind: "product.node.upserted",
          nodeId: feature.id,
          payload: { node: feature },
        },
        {
          productGraphId,
          kind: "product.node.upserted",
          nodeId: "bad-node",
          payload: circularPayload,
        } as any,
      ])
    ).rejects.toThrow(/circular/i);

    await expect(getProductEvents(productGraphId)).resolves.toEqual([]);
  });
});
