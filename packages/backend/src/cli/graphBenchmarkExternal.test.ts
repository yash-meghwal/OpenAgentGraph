import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 180_000 });

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

describe.sequential("graph:benchmark:external", () => {
  it("runs the local catalog without leaking source bodies into the report", async () => {
    const { runGraphBenchmarkExternalCli } = await import("./graphBenchmarkExternal.js");
    const { reportContainsSourceBodyLeak } = await import("@openagentgraph/shared");
    const payload = await runGraphBenchmarkExternalCli([
      "--catalog",
      "--fixtures",
      path.join(repoRoot(), "tests", "fixtures", "graph"),
      "--json",
    ]);
    expect(payload.ok).toBe(true);
    expect(payload.results).toHaveLength(10);
    expect(payload.report).toContain("scorecard metrics only");
    expect(reportContainsSourceBodyLeak(payload.report)).toBe(false);
    expect(payload.results.every((result) => result.scannerTasks.length >= 0)).toBe(true);
  });

  it("passes workspace mode with an explicit category", async () => {
    const { runGraphBenchmarkExternalCli } = await import("./graphBenchmarkExternal.js");
    const payload = await runGraphBenchmarkExternalCli([
      "--workspace",
      path.join(repoRoot(), "tests", "fixtures", "graph", "fixture-next-app"),
      "--category",
      "typescript-web",
      "--json",
    ]);
    expect(payload.ok).toBe(true);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]?.categoryId).toBe("typescript-web");
    expect(payload.errors).toEqual([]);
  });

  it("rejects unknown categories for workspace mode", async () => {
    const { runGraphBenchmarkExternalCli } = await import("./graphBenchmarkExternal.js");
    await expect(runGraphBenchmarkExternalCli([
      "--workspace",
      path.join(repoRoot(), "tests", "fixtures", "graph", "fixture-next-app"),
      "--category",
      "not-a-category",
      "--json",
    ])).rejects.toThrow(/Unknown external benchmark category/);
  });

  it("rejects combining --workspace and --clone", async () => {
    const { runGraphBenchmarkExternalCli } = await import("./graphBenchmarkExternal.js");
    await expect(runGraphBenchmarkExternalCli([
      "--workspace",
      path.join(repoRoot(), "tests", "fixtures", "graph", "fixture-next-app"),
      "--clone",
      "https://github.com/example/repo.git",
    ])).rejects.toThrow(/--workspace cannot be combined with --clone/);
  });
});