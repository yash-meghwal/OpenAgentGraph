import path from "path";
import fs from "fs";
import os from "os";
import { describe, expect, it } from "vitest";
import { resolveProductGraphCliDataDir } from "./productGraphDataDir";
import { runHandoffCli } from "./handoff";
import {
  checkProductGraphWorkspacePaths,
  sampleProductGraphScannedPaths,
} from "../productGraphHandoffTrust";
import type { ProductGraphProjection } from "@openagentgraph/shared";

function makeProjection(filePath: string): ProductGraphProjection {
  return {
    schemaVersion: "1",
    productGraphId: "default",
    nodes: [
      {
        id: "file:app",
        kind: "code_file",
        title: filePath,
        status: "planned",
        source: { kind: "code_scan", label: "Code scan", path: filePath },
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
      nodesByKind: { code_file: 1 },
      edgesByKind: {},
      unresolvedOpenQuestionCount: 0,
      blockedTaskCount: 0,
    },
  };
}

describe("handoff CLI data directory resolution", () => {
  it("prefers the backend package data directory when root scripts run without DATA_DIR", async () => {
    const workspaceRoot = path.resolve("C:/workspace/openagentgraph");
    const backendDataDir = path.join(workspaceRoot, "packages", "backend", "data");
    const backendDbPath = path.join(backendDataDir, "openagentgraph.db");

    const resolved = await resolveProductGraphCliDataDir({
      applicationRoot: workspaceRoot,
      cwd: workspaceRoot,
      fileExists: async (filePath) => filePath === backendDbPath,
    });

    expect(resolved).toBe(backendDataDir);
  });

  it("does not override an existing DATA_DIR value", async () => {
    const workspaceRoot = path.resolve("C:/workspace/openagentgraph");

    const resolved = await resolveProductGraphCliDataDir({
      applicationRoot: workspaceRoot,
      cwd: workspaceRoot,
      envDataDir: path.join(workspaceRoot, "data"),
      fileExists: async () => true,
    });

    expect(resolved).toBeUndefined();
  });

  it("resolves explicit --data-dir values from the current working directory", async () => {
    const workspaceRoot = path.resolve("C:/workspace/openagentgraph");

    const resolved = await resolveProductGraphCliDataDir({
      applicationRoot: workspaceRoot,
      cwd: workspaceRoot,
      explicitDataDir: "packages/backend/data",
      fileExists: async () => false,
    });

    expect(resolved).toBe(path.join(workspaceRoot, "packages", "backend", "data"));
  });

  it("fails fast when --data-dir is missing a value", async () => {
    await expect(runHandoffCli(["--data-dir"])).rejects.toThrow("--data-dir requires a value.");
    await expect(runHandoffCli(["--data-dir", "--json"])).rejects.toThrow("--data-dir requires a value.");
  });

  it("detects when CLI handoff code paths do not belong to the workspace", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-handoff-cli-"));
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src/app.ts"), "export const app = true;", "utf8");

    await expect(checkProductGraphWorkspacePaths(makeProjection("src/app.ts"), workspaceRoot)).resolves.toMatchObject({
      checkedFileCount: 1,
      missingFileCount: 0,
      status: "aligned",
    });
    await expect(checkProductGraphWorkspacePaths(makeProjection("other/src/app.ts"), workspaceRoot)).resolves.toMatchObject({
      checkedFileCount: 1,
      missingFileCount: 1,
      status: "mismatch",
    });

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("samples large path sets across the sorted range instead of taking only a lexical prefix", () => {
    const paths = Array.from({ length: 10 }, (_, index) => `src/file-${String(index).padStart(2, "0")}.ts`);

    expect(sampleProductGraphScannedPaths(paths, 4)).toEqual([
      "src/file-00.ts",
      "src/file-03.ts",
      "src/file-06.ts",
      "src/file-09.ts",
    ]);
  });
});
