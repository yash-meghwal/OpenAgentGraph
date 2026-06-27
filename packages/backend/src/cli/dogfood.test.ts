import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductGraphEdge, ProductGraphNode } from "@openagentgraph/shared";
import { setAppConfigOverride } from "../config.js";

const tempPaths: string[] = [];

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function workspaceDataDirHash(workspacePath: string) {
  return createHash("sha256").update(path.resolve(workspacePath).toLowerCase()).digest("hex").slice(0, 16);
}

function makeCodeScanNode(input: {
  id: string;
  title: string;
  kind?: ProductGraphNode["kind"];
}): ProductGraphNode {
  const now = "2026-06-26T00:00:00.000Z";
  return {
    id: input.id,
    kind: input.kind ?? "code_file",
    title: input.title,
    status: "planned",
    source: { kind: "code_scan", label: "Codebase scan", path: input.title },
    metadata: { scannerSourceFile: input.title },
    createdAt: now,
    updatedAt: now,
  };
}

function makeCodeScanEdge(input: {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  path: string;
}): ProductGraphEdge {
  const now = "2026-06-26T00:00:00.000Z";
  return {
    id: input.id,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    kind: "belongs_to",
    trust: "extracted",
    source: { kind: "code_scan", label: "Codebase scan", path: input.path },
    metadata: { scannerRelation: "belongs_to" },
    createdAt: now,
    updatedAt: now,
  };
}

describe("dogfood cli", () => {
  afterEach(() => {
    setAppConfigOverride(undefined);
    vi.resetModules();
    for (const dir of tempPaths.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        // Windows may keep SQLite handles open briefly after closeDb().
      }
    }
  });

  it("fails clearly when workspace path is missing", async () => {
    const { runDogfoodCli } = await import("./dogfood.js");
    await expect(runDogfoodCli([])).rejects.toThrow('Dogfood requires --workspace "<absolute path>".');
  });

  it("fails clearly when workspace path is invalid", async () => {
    const { runDogfoodCli } = await import("./dogfood.js");
    const missing = path.join(makeTempDir("openagentgraph-dogfood-missing-"), "does-not-exist");
    await expect(runDogfoodCli(["--workspace", missing])).rejects.toThrow("Workspace path does not exist");
  });

  it("archives stale code-scan output from one reused scan with the current projection", async () => {
    const repoRoot = makeTempDir("openagentgraph-dogfood-repo-");
    const workspaceRoot = path.join(makeTempDir("openagentgraph-dogfood-target-"), "StaleArchive");
    writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    writeFile(path.join(workspaceRoot, "App.sln"), "Microsoft Visual Studio Solution File\n");
    writeFile(path.join(workspaceRoot, "src", "Player.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>\n");
    writeFile(path.join(workspaceRoot, "src", "Player.cs"), "public class Player { }\n");

    const staleFilePath = "src/Removed.cs";
    const staleFileNodeId = "code-scan:file:removed-player";
    const staleSymbolNodeId = "code-scan:symbol:removed-player";
    const staleEdgeId = "code-scan:edge:removed-player";

    const dataDir = path.join(repoRoot, ".tmp-dogfood-data", workspaceDataDirHash(workspaceRoot));
    process.env.DATA_DIR = dataDir;
    process.env.OPENAGENTGRAPH_WORKSPACE_ROOT = workspaceRoot;

    const { initDb, closeDb } = await import("../db/client.js");
    const { appendProductEvents, getProductEvents, DEFAULT_PRODUCT_GRAPH_ID } = await import("../db/productGraphRepo.js");
    initDb();
    await appendProductEvents([
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted",
        nodeId: staleFileNodeId,
        payload: { node: makeCodeScanNode({ id: staleFileNodeId, title: staleFilePath }) },
      },
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.node.upserted",
        nodeId: staleSymbolNodeId,
        payload: { node: makeCodeScanNode({ id: staleSymbolNodeId, title: "Removed (class)", kind: "code_symbol" }) },
      },
      {
        productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
        kind: "product.edge.upserted",
        edgeId: staleEdgeId,
        payload: {
          edge: makeCodeScanEdge({
            id: staleEdgeId,
            sourceNodeId: staleSymbolNodeId,
            targetNodeId: staleFileNodeId,
            path: staleFilePath,
          }),
        },
      },
    ]);

    const exportCalls: Array<[string, { projection?: { nodes: Array<{ id: string }> } } | undefined]> = [];
    vi.resetModules();
    vi.doMock("./offlineGraphExport.js", async () => {
      const actual = await vi.importActual<typeof import("./offlineGraphExport.js")>("./offlineGraphExport.js");
      return {
        ...actual,
        runOfflineKernelGraphExport: async (
          ...args: Parameters<typeof actual.runOfflineKernelGraphExport>
        ) => {
          exportCalls.push(args);
          return actual.runOfflineKernelGraphExport(...args);
        },
      };
    });

    const originalCwd = process.cwd();
    let jsonOutput = "";
    const originalLog = console.log;
    console.log = (value: unknown) => {
      if (typeof value === "string") jsonOutput = value;
    };
    process.chdir(repoRoot);
    try {
      const { runDogfoodCli } = await import("./dogfood.js");
      await runDogfoodCli(["--workspace", workspaceRoot, "--json"]);
    } finally {
      console.log = originalLog;
      process.chdir(originalCwd);
      vi.doUnmock("./offlineGraphExport.js");
    }

    expect(exportCalls).toHaveLength(1);
    const exportOptions = exportCalls[0]?.[1];
    expect(exportOptions?.projection?.nodes.some((node) => node.id === staleFileNodeId)).toBe(true);

    const payload = JSON.parse(jsonOutput) as {
      scan?: { archivedNodeCount?: number; archivedEdgeCount?: number };
      stageTimings?: { duplicateKernelScanCount?: number };
    };
    expect(payload.stageTimings?.duplicateKernelScanCount ?? 0).toBe(0);
    expect(payload.scan?.archivedNodeCount).toBeGreaterThanOrEqual(1);
    expect(payload.scan?.archivedEdgeCount).toBeGreaterThanOrEqual(1);

    const events = await getProductEvents(DEFAULT_PRODUCT_GRAPH_ID);
    expect(events.some((event) =>
      event.kind === "product.node.archived" && event.nodeId === staleFileNodeId
    )).toBe(true);
    expect(events.some((event) =>
      event.kind === "product.edge.archived" && event.edgeId === staleEdgeId
    )).toBe(true);

    closeDb();
    delete process.env.DATA_DIR;
    delete process.env.OPENAGENTGRAPH_WORKSPACE_ROOT;
  });

  it("writes GRAPH_REPORT.md using isolated dogfood data for workspaces with spaces", async () => {
    const repoRoot = makeTempDir("openagentgraph-dogfood-repo-");
    const workspaceRoot = path.join(makeTempDir("openagentgraph-dogfood-target-"), "Video Player", "SampleMediaPlayer");
    writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    writeFile(path.join(workspaceRoot, "App.sln"), "Microsoft Visual Studio Solution File\n");
    writeFile(path.join(workspaceRoot, "src", "Player.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>\n");
    writeFile(path.join(workspaceRoot, "src", "Player.cs"), "public class Player { }\n");
    writeFile(path.join(workspaceRoot, "bin", "Release", "lib.js"), "export const generated = true;\n");

    const originalCwd = process.cwd();
    let jsonOutput = "";
    const originalLog = console.log;
    console.log = (value: unknown) => {
      if (typeof value === "string") jsonOutput = value;
    };
    process.chdir(repoRoot);
    try {
      const { runDogfoodCli } = await import("./dogfood.js");
      await runDogfoodCli(["--workspace", workspaceRoot, "--json"]);
    } finally {
      console.log = originalLog;
      process.chdir(originalCwd);
    }

    const payload = JSON.parse(jsonOutput) as {
      stageTimings?: { duplicateKernelScanCount?: number; stages: Array<{ stage: string }> };
    };
    expect(payload.stageTimings?.duplicateKernelScanCount ?? 0).toBe(0);
    expect(payload.stageTimings?.stages.some((entry) => entry.stage === "product_graph_handoff")).toBe(true);

    const reportPath = path.join(workspaceRoot, "GRAPH_REPORT.md");
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = fs.readFileSync(reportPath, "utf8");
    expect(report).toContain("# OpenAgentGraph Handoff");
    expect(report).toContain("## Static OAG artifacts");
    expect(report).toContain("## How an agent should use these files");
    expect(report).toMatch(/dotnet|Detected project types/i);
    expect(report).not.toContain("public class Player");
    expect(report).not.toContain("export const generated");

    expect(fs.existsSync(path.join(workspaceRoot, ".oag", "graph.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, ".oag", "graph.html"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, ".oag", "wiki", "index.md"))).toBe(true);

    expect(fs.existsSync(path.join(repoRoot, ".tmp-dogfood-data"))).toBe(true);
  });

  it("honors --output on the static export path", async () => {
    const repoRoot = makeTempDir("openagentgraph-dogfood-repo-");
    const workspaceRoot = path.join(makeTempDir("openagentgraph-dogfood-target-"), "CustomOutput");
    writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    writeFile(path.join(workspaceRoot, "App.sln"), "Microsoft Visual Studio Solution File\n");
    writeFile(path.join(workspaceRoot, "src", "Player.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>\n");
    writeFile(path.join(workspaceRoot, "src", "Player.cs"), "public class Player { }\n");

    const originalCwd = process.cwd();
    process.chdir(repoRoot);
    try {
      const { runDogfoodCli } = await import("./dogfood.js");
      await runDogfoodCli([
        "--workspace",
        workspaceRoot,
        "--output",
        "reports/custom-handoff.md",
        "--json",
      ]);
    } finally {
      process.chdir(originalCwd);
    }

    const reportPath = path.join(workspaceRoot, "reports", "custom-handoff.md");
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = fs.readFileSync(reportPath, "utf8");
    expect(report).toContain("reports/custom-handoff.md");
    expect(fs.existsSync(path.join(workspaceRoot, "GRAPH_REPORT.md"))).toBe(false);
  });
});