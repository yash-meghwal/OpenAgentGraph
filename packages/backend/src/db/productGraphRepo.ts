import { asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  projectProductGraph,
  type ProductEvent,
  type ProductEventKind,
  type ProductEventPayloadMap,
  type ProductGraphProjection,
} from "@openagentgraph/shared";
import { db } from "./client.js";
import { productEvents } from "./schema.js";

export const DEFAULT_PRODUCT_GRAPH_ID = "default";

function now() {
  return new Date().toISOString();
}

type AppendProductEventInput<K extends ProductEventKind = ProductEventKind> = {
  productGraphId: string;
  kind: K;
  nodeId?: string;
  edgeId?: string;
  payload: ProductEventPayloadMap[K];
};

export async function appendProductEvent<K extends ProductEventKind>(
  input: AppendProductEventInput<K>
): Promise<ProductEvent<K>> {
  const event = db.transaction((tx): ProductEvent<K> => {
    const row = tx
      .select({ seq: productEvents.seq })
      .from(productEvents)
      .where(eq(productEvents.productGraphId, input.productGraphId))
      .orderBy(desc(productEvents.seq))
      .limit(1)
      .get();
    const seq = (row?.seq ?? 0) + 1;
    const nextEvent: ProductEvent<K> = {
      id: nanoid(),
      productGraphId: input.productGraphId,
      kind: input.kind,
      nodeId: input.nodeId,
      edgeId: input.edgeId,
      payload: input.payload,
      ts: now(),
      seq,
    };

    tx.insert(productEvents).values({
      id: nextEvent.id,
      productGraphId: nextEvent.productGraphId,
      kind: nextEvent.kind,
      nodeId: nextEvent.nodeId,
      edgeId: nextEvent.edgeId,
      payloadJson: JSON.stringify(nextEvent.payload),
      ts: nextEvent.ts,
      seq,
    }).run();

    return nextEvent;
  });

  return event;
}

export async function appendProductEvents(
  inputs: AppendProductEventInput[]
): Promise<ProductEvent[]> {
  if (inputs.length === 0) return [];

  const events = db.transaction((tx): ProductEvent[] => {
    const nextSeqByGraphId = new Map<string, number>();
    const appendedEvents: ProductEvent[] = [];

    for (const input of inputs) {
      let seq = nextSeqByGraphId.get(input.productGraphId);
      if (seq === undefined) {
        const row = tx
          .select({ seq: productEvents.seq })
          .from(productEvents)
          .where(eq(productEvents.productGraphId, input.productGraphId))
          .orderBy(desc(productEvents.seq))
          .limit(1)
          .get();
        seq = (row?.seq ?? 0) + 1;
      }

      const nextEvent: ProductEvent = {
        id: nanoid(),
        productGraphId: input.productGraphId,
        kind: input.kind,
        nodeId: input.nodeId,
        edgeId: input.edgeId,
        payload: input.payload,
        ts: now(),
        seq,
      };

      tx.insert(productEvents).values({
        id: nextEvent.id,
        productGraphId: nextEvent.productGraphId,
        kind: nextEvent.kind,
        nodeId: nextEvent.nodeId,
        edgeId: nextEvent.edgeId,
        payloadJson: JSON.stringify(nextEvent.payload),
        ts: nextEvent.ts,
        seq,
      }).run();

      appendedEvents.push(nextEvent);
      nextSeqByGraphId.set(input.productGraphId, seq + 1);
    }

    return appendedEvents;
  });

  return events;
}

export async function getProductEvents(productGraphId: string): Promise<ProductEvent[]> {
  const rows = await db
    .select()
    .from(productEvents)
    .where(eq(productEvents.productGraphId, productGraphId))
    .orderBy(asc(productEvents.seq))
    .all();

  return rows.map((row) => ({
    id: row.id,
    productGraphId: row.productGraphId,
    kind: row.kind as ProductEventKind,
    nodeId: row.nodeId ?? undefined,
    edgeId: row.edgeId ?? undefined,
    payload: JSON.parse(row.payloadJson),
    ts: row.ts,
    seq: row.seq,
  }));
}

export async function getProductGraphProjection(
  productGraphId: string
): Promise<ProductGraphProjection> {
  const events = await getProductEvents(productGraphId);
  return projectProductGraph({ productGraphId, events });
}
