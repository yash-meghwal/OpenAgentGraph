import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import * as schema from "./schema.js";
import { getAppConfig } from "../config.js";

const DATA_DIR = getAppConfig().database.dataDir;
fs.mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new Database(getAppConfig().database.filePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
let initialized = false;

export function initDb() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS graph_events (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      node_id TEXT,
      goal_version_id TEXT,
      payload_json TEXT NOT NULL,
      ts TEXT NOT NULL,
      seq INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_graph_events_graph_id ON graph_events(graph_id);
    CREATE INDEX IF NOT EXISTS idx_graph_events_graph_seq ON graph_events(graph_id, seq);
    CREATE INDEX IF NOT EXISTS idx_graph_events_node_id ON graph_events(node_id);

    CREATE TABLE IF NOT EXISTS product_events (
      id TEXT PRIMARY KEY,
      product_graph_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      node_id TEXT,
      edge_id TEXT,
      payload_json TEXT NOT NULL,
      ts TEXT NOT NULL,
      seq INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_product_events_product_graph_id ON product_events(product_graph_id);
    CREATE INDEX IF NOT EXISTS idx_product_events_product_graph_seq ON product_events(product_graph_id, seq);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_events_product_graph_seq_unique ON product_events(product_graph_id, seq);
    CREATE INDEX IF NOT EXISTS idx_product_events_node_id ON product_events(node_id);
    CREATE INDEX IF NOT EXISTS idx_product_events_edge_id ON product_events(edge_id);
  `);
  initialized = true;
}

export function closeDb() {
  sqlite.close();
}

export function getDatabaseDiagnostics() {
  return {
    initialized,
    filePath: getAppConfig().database.filePath,
  };
}
