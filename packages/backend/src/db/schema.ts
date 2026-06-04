import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const graphEvents = sqliteTable("graph_events", {
  id: text("id").primaryKey(),
  graphId: text("graph_id").notNull(),
  kind: text("kind").notNull(),
  nodeId: text("node_id"),
  goalVersionId: text("goal_version_id"),
  payloadJson: text("payload_json").notNull(),
  ts: text("ts").notNull(),
  seq: integer("seq", { mode: "number" }).notNull(),
});

export const productEvents = sqliteTable(
  "product_events",
  {
    id: text("id").primaryKey(),
    productGraphId: text("product_graph_id").notNull(),
    kind: text("kind").notNull(),
    nodeId: text("node_id"),
    edgeId: text("edge_id"),
    payloadJson: text("payload_json").notNull(),
    ts: text("ts").notNull(),
    seq: integer("seq", { mode: "number" }).notNull(),
  },
  (table) => ({
    productGraphSeqUnique: uniqueIndex("idx_product_events_product_graph_seq_unique").on(
      table.productGraphId,
      table.seq
    ),
  })
);
