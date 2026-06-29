import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.restoreAllMocks();
  });
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
    expect(result.contextNoise).toBeDefined();
    expect(typeof result.contextNoise.score).toBe("number");
  });

  it("does not warn that --mode docs is ignored", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runGraphContextCli } = await import("./graphContext.js");
    const workspaceRoot = fixtureRoot("mixed-dotnet-node");
    await runGraphContextCli([
      "--workspace",
      workspaceRoot,
      "--mode",
      "docs",
      "--goal",
      "architecture guide",
    ]);
    const warnings = warnSpy.mock.calls.flat().map((value) => String(value));
    expect(warnings.some((warning) => warning.includes("--mode code|docs|balanced is only used by graph:query"))).toBe(false);
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

  it("includes verification plan with --include-verification", async () => {
    const { runGraphContextCli } = await import("./graphContext.js");
    const workspaceRoot = fixtureRoot("fixture-agentic-harness-good");
    const result = await runGraphContextCli([
      "--workspace",
      workspaceRoot,
      "--goal",
      "fix auth service",
      "--include-verification",
      "--json",
      "--budget",
      "20000",
    ]);

    expect(result.taskVerification).toBeDefined();
    expect(result.taskVerification?.verificationPlan.beforeEditing.length).toBeGreaterThanOrEqual(0);
    expect(result.taskVerification?.suggestedCommands.length).toBeGreaterThan(0);
    expect(result.taskVerification?.suggestedCommands.every((command) =>
      result.taskVerification?.verificationPlan.beforeEditing.includes(command)
      || result.taskVerification?.verificationPlan.afterEditing.includes(command)
      || result.taskVerification?.verificationPlan.fallback.includes(command)
    )).toBe(true);
  });

  it("recommends docs checks for documentation goals with --include-verification", async () => {
    const { runGraphContextCli } = await import("./graphContext.js");
    const workspaceRoot = fixtureRoot("fixture-agentic-harness-good");
    const result = await runGraphContextCli([
      "--workspace",
      workspaceRoot,
      "--mode",
      "docs",
      "--goal",
      "update architecture documentation",
      "--include-verification",
      "--json",
      "--budget",
      "20000",
    ]);

    expect(result.taskVerification?.goalIntent).toBe("docs");
    expect(result.taskVerification?.docsToCheck.length).toBeGreaterThan(0);
  });
});
