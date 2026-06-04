import fs from "fs";
import os from "os";
import path from "path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { loadAppConfig, setAppConfigForTests } from "../config.js";
import { buildProjectGraph } from "./projectGraph.js";

const tempWorkspacePaths: string[] = [];

function makeTempWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-project-graph-"));
  tempWorkspacePaths.push(workspaceRoot);
  return workspaceRoot;
}

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

const operatorHeaders = { "x-openagentgraph-actor-id": "operator" };

describe("project graph scanner", () => {
  afterEach(() => {
    for (const workspaceRoot of tempWorkspacePaths.splice(0)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
    setAppConfigForTests(undefined);
  });

  it("excludes generated folders while preserving source, import, and test links", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "src", "app.ts"), "import { util } from './util';\nexport function app() { return util(); }\n");
    writeFile(path.join(workspaceRoot, "src", "util.ts"), "export function util() { return 'ok'; }\n");
    writeFile(path.join(workspaceRoot, "src", "app.test.ts"), "import { app } from './app';\napp();\n");
    writeFile(path.join(workspaceRoot, "build", "generated.ts"), "export const generated = true;\n");
    writeFile(path.join(workspaceRoot, "out", "bundle.js"), "export const bundled = true;\n");
    writeFile(path.join(workspaceRoot, ".cache", "cache.ts"), "export const cached = true;\n");
    writeFile(path.join(workspaceRoot, ".pytest_cache", "v", "cache", "nodeids"), "[]\n");
    writeFile(path.join(workspaceRoot, ".ruff_cache", "0.15.12", "CACHEDIR.TAG"), "Signature: 8a477f597d28d172789f06886806bc55\n");
    writeFile(path.join(workspaceRoot, "desktop", "dist-electron", "main.js"), "export const generatedMain = true;\n");
    writeFile(path.join(workspaceRoot, "desktop", "dist-renderer", "assets", "view.js"), "export const generatedView = true;\n");
    writeFile(path.join(workspaceRoot, "webview-dist", "assets", "view.js"), "export const view = true;\n");

    const graph = await buildProjectGraph(workspaceRoot);
    const paths = new Set(graph.nodes.map((node) => node.path));

    expect(paths).toContain("src");
    expect(paths).toContain("src/app.ts");
    expect(paths).toContain("src/util.ts");
    expect(paths).toContain("src/app.test.ts");
    expect(paths).not.toContain("build");
    expect(paths).not.toContain("build/generated.ts");
    expect(paths).not.toContain("out/bundle.js");
    expect(paths).not.toContain(".cache/cache.ts");
    expect(paths).not.toContain(".pytest_cache");
    expect(paths).not.toContain(".ruff_cache");
    expect(paths).not.toContain("desktop/dist-electron");
    expect(paths).not.toContain("desktop/dist-renderer");
    expect(paths).not.toContain("webview-dist/assets/view.js");
    expect(graph.summary).toMatchObject({
      fileCount: 3,
      importEdgeCount: 2,
      testEdgeCount: 1,
      scannedFileCount: 3,
      skippedDirectoryCount: 8,
      partial: false,
    });
    expect(graph.breakers?.project.limits.maxFiles).toBeGreaterThanOrEqual(20_000);
    expect(graph.progress?.phase).toBe("completed");
    expect(graph.diagnostics).toEqual([]);
  });

  it("stops traversal when a global project graph breaker is hit", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "src", "one.ts"), "export const one = 1;\n");
    writeFile(path.join(workspaceRoot, "src", "two.ts"), "export const two = 2;\n");
    writeFile(path.join(workspaceRoot, "src", "three.ts"), "export const three = 3;\n");

    const graph = await buildProjectGraph(workspaceRoot, {
      limits: {
        maxFiles: 1,
      },
    });

    expect(graph.summary).toMatchObject({
      fileCount: 1,
      scannedFileCount: 1,
      skippedFileCount: 1,
      partial: true,
    });
    expect(graph.breakers?.project.state).toBe("hit");
    expect(graph.breakers?.project.hits[0]).toMatchObject({
      key: "maxFiles",
      limit: 1,
    });
    expect(graph.diagnostics?.join("\n")).toContain("file count exceeded 1");
  });

  it("requires operator access to start project graph scan jobs", async () => {
    const workspaceRoot = makeTempWorkspace();
    const dataDir = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "src", "app.ts"), "export const app = true;\n");
    setAppConfigForTests(loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      OPENAGENTGRAPH_WORKSPACE_ROOT: workspaceRoot,
    }));
    const app = Fastify();
    const { projectGraphRoutes } = await import("./projectGraph.js");
    await app.register(projectGraphRoutes);

    const missingActorResponse = await app.inject({
      method: "POST",
      url: "/project-graph/scan-jobs",
    });
    const reviewerResponse = await app.inject({
      method: "POST",
      url: "/project-graph/scan-jobs",
      headers: {
        "x-openagentgraph-actor-id": "reviewer",
      },
    });
    const viewerResponse = await app.inject({
      method: "POST",
      url: "/project-graph/scan-jobs",
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
    await app.close();
  });

  it("publishes project graph scan jobs with progress and result", async () => {
    const workspaceRoot = makeTempWorkspace();
    const dataDir = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "src", "app.ts"), "export const app = true;\n");
    setAppConfigForTests(loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      OPENAGENTGRAPH_WORKSPACE_ROOT: workspaceRoot,
    }));
    const app = Fastify();
    const { projectGraphRoutes } = await import("./projectGraph.js");
    await app.register(projectGraphRoutes);

    const startResponse = await app.inject({
      method: "POST",
      url: "/project-graph/scan-jobs",
      headers: operatorHeaders,
    });

    expect(startResponse.statusCode).toBe(202);
    const started = startResponse.json();
    expect(started.scope).toBe("project_graph");

    const secondStartResponse = await app.inject({
      method: "POST",
      url: "/project-graph/scan-jobs",
      headers: operatorHeaders,
    });
    expect(secondStartResponse.statusCode).toBe(409);
    expect(secondStartResponse.json()).toMatchObject({
      status: "scan_in_progress",
      error: "A project graph scan is already running.",
    });

    let completed: any;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await app.inject({
        method: "GET",
        url: `/project-graph/scan-jobs/${started.jobId}`,
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
      scope: "project_graph",
      status: "completed",
      progress: {
        breakers: {
          limits: {
            maxFiles: expect.any(Number),
          },
        },
      },
    });
    const eventsResponse = await app.inject({
      method: "GET",
      url: `/project-graph/scan-jobs/${started.jobId}/events`,
    });
    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.headers["content-type"]).toContain("text/event-stream");
    expect(eventsResponse.payload).toContain("event: status");
    expect(eventsResponse.payload).toContain('"status":"completed"');
    expect(eventsResponse.payload).toContain('"phase":"completed"');
    await app.close();
  });
});
