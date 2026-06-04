import path from "path";
import { describe, expect, it } from "vitest";
import { resolveElectronShellRuntime } from "./runtime.js";

describe("electron shell runtime", () => {
  const electronDistDir = path.join(
    "C:",
    "repo",
    "openagentgraph",
    "packages",
    "electron",
    "dist"
  );

  it("uses the frontend dev server and external backend in development mode", () => {
    const runtime = resolveElectronShellRuntime({
      electronDistDir,
      env: {
        OPENAGENTGRAPH_ELECTRON_RENDERER_URL: "http://127.0.0.1:5173",
        OPENAGENTGRAPH_ELECTRON_BACKEND_URL: "http://127.0.0.1:3001",
      },
    });

    expect(runtime.rendererUrl).toBe("http://127.0.0.1:5173");
    expect(runtime.backendUrl).toBe("http://127.0.0.1:3001");
    expect(runtime.shouldSpawnBackend).toBe(false);
    expect(runtime.additionalArguments).toEqual([
      "--openagentgraph-backend-url=http://127.0.0.1:3001",
    ]);
  });

  it("defaults to a local backend and built frontend assets in production mode", () => {
    const runtime = resolveElectronShellRuntime({
      electronDistDir,
      env: {
        PORT: "4123",
        npm_node_execpath: "C:\\Program Files\\nodejs\\node.exe",
      },
    });

    expect(runtime.rendererUrl).toBeUndefined();
    expect(runtime.backendUrl).toBe("http://127.0.0.1:4123");
    expect(runtime.shouldSpawnBackend).toBe(true);
    expect(runtime.nodeBinary).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(runtime.frontendIndexPath).toContain(
      path.join("packages", "frontend", "dist", "index.html")
    );
    expect(runtime.backendEntryPath).toContain(
      path.join("packages", "backend", "dist", "index.js")
    );
  });
});
