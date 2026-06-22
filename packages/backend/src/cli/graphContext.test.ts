import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

function fixtureRoot(...segments: string[]) {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
    "tests",
    "fixtures",
    "graph",
    ...segments
  );
}

describe("graph:context cli", () => {
  it("requires --workspace", async () => {
    const { runGraphContextCli } = await import("./graphContext.js");
    await expect(runGraphContextCli([])).rejects.toThrow("--workspace");
  });

  it("returns bounded json context for mixed fixture", async () => {
    const { runGraphContextCli } = await import("./graphContext.js");
    const workspaceRoot = fixtureRoot("mixed-dotnet-node");
    const result = await runGraphContextCli([
      "--workspace",
      workspaceRoot,
      "--goal",
      "auth flow",
      "--json",
      "--budget",
      "10000",
    ]);
    expect(result.status).toBe("graph_context_ready");
    expect(result.estimatedSize).toBeLessThanOrEqual(10000);
    expect(result.readFirstNodes.length).toBeGreaterThan(0);
  });

  it("normalizes npm/cmd caret markers in goal text", async () => {
    const { runGraphContextCli } = await import("./graphContext.js");
    const workspaceRoot = fixtureRoot("mixed-dotnet-node");
    const result = await runGraphContextCli([
      "--workspace",
      workspaceRoot,
      "--goal",
      "^MainViewModel^ playback^",
      "--json",
      "--budget",
      "10000",
    ]);

    expect(result.goal).toBe("MainViewModel playback");
  });
});
