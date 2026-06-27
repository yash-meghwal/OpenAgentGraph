import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GRAPH_UPDATE_BENCHMARK_SCENARIO_IDS,
  GRAPH_UPDATE_BENCHMARK_SCENARIOS,
} from "@openagentgraph/shared";

vi.setConfig({ testTimeout: 120_000 });

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

const tempPaths: string[] = [];

function shouldCopyFixtureEntry(sourceRoot: string, sourcePath: string) {
  const relative = path.relative(sourceRoot, sourcePath).replace(/\\/g, "/");
  if (!relative || relative === ".") return true;
  if (relative === ".oag" || relative.startsWith(".oag/")) return false;
  if (relative === "GRAPH_REPORT.md") return false;
  return true;
}

function copyFixtureWorkspace(fixtureName: string) {
  const sourceRoot = path.join(repoRoot(), "tests", "fixtures", "graph", fixtureName);
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `oag-benchmark-test-${fixtureName}-`));
  tempPaths.push(workspaceRoot);
  fs.cpSync(sourceRoot, workspaceRoot, {
    recursive: true,
    filter: (sourcePath) => shouldCopyFixtureEntry(sourceRoot, sourcePath),
  });
  return workspaceRoot;
}

afterEach(() => {
  for (const dir of tempPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe.sequential("graph:benchmark:update", () => {
  it("rejects --scenario when --workspace is also supplied", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const { runGraphBenchmarkUpdateCli } = await import("./graphBenchmarkUpdate.js");
    await expect(runGraphBenchmarkUpdateCli([
      "--workspace",
      workspaceRoot,
      "--scenario",
      "csharp-10",
      "--json",
    ])).rejects.toThrow(/--scenario cannot be used with --workspace/);
  });

  it("rejects invalid scenario names", async () => {
    const { runGraphBenchmarkUpdateCli } = await import("./graphBenchmarkUpdate.js");
    await expect(runGraphBenchmarkUpdateCli([
      "--scenario",
      "not-a-real-scenario",
      "--fixtures",
      path.join(repoRoot(), "tests", "fixtures", "graph"),
      "--json",
    ])).rejects.toThrow(/Unknown graph update benchmark scenario 'not-a-real-scenario'/);
  });

  it("does not modify the source workspace in custom --workspace mode", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const viewModelPath = path.join(workspaceRoot, "SampleMediaPlayer.App", "ViewModels", "MainViewModel.cs");
    const { seedGraphWorkspaceForUpdate } = await import("./graphUpdate.js");
    const { runGraphBenchmarkUpdateCli } = await import("./graphBenchmarkUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    const before = fs.readFileSync(viewModelPath, "utf8");

    const payload = await runGraphBenchmarkUpdateCli([
      "--workspace",
      workspaceRoot,
      "--changed-files",
      "1",
      "--json",
    ]);

    expect(payload.ok).toBe(true);
    expect(payload.results[0]?.sourceWorkspaceRoot).toBe(workspaceRoot);
    expect(fs.readFileSync(viewModelPath, "utf8")).toBe(before);
    expect(fs.readFileSync(viewModelPath, "utf8")).not.toContain("// oag-benchmark-workspace");
  });

  it("normalizes quoted custom workspaces with repeated spaces", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "oag-benchmark-spaced-"));
    tempPaths.push(base);
    const workspaceRoot = path.join(base, "Video  Player", "fixture-csharp-wpf");
    fs.mkdirSync(path.dirname(workspaceRoot), { recursive: true });
    fs.cpSync(path.join(repoRoot(), "tests", "fixtures", "graph", "fixture-csharp-wpf"), workspaceRoot, { recursive: true });

    const { seedGraphWorkspaceForUpdate } = await import("./graphUpdate.js");
    const { runGraphBenchmarkUpdateCli } = await import("./graphBenchmarkUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    const payload = await runGraphBenchmarkUpdateCli([
      "--workspace",
      `"${workspaceRoot}"`,
      "--changed-files",
      "1",
      "--json",
    ]);

    expect(payload.ok).toBe(true);
    expect(payload.results[0]?.sourceWorkspaceRoot).toBe(workspaceRoot);
  });

  it("touches generated output only after cold seed and still noops", async () => {
    const { runGraphUpdateBenchmarkScenario } = await import("../scanner/kernel/graphUpdateBenchmarkRunner.js");
    const scenario = GRAPH_UPDATE_BENCHMARK_SCENARIOS.find((entry) => entry.id === "generated-noop");
    expect(scenario).toBeTruthy();

    const result = await runGraphUpdateBenchmarkScenario({
      scenario: scenario!,
      fixturesRoot: path.join(repoRoot(), "tests", "fixtures", "graph"),
      cleanup: false,
    });
    tempPaths.push(result.workspaceRoot);

    const generatedPath = path.join(result.workspaceRoot, "SampleMediaPlayer.App", "bin", "Debug", "Generated.cs");
    const manifestPath = path.join(result.workspaceRoot, ".oag", "graph-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { files: Array<{ path: string }> };

    expect(result.updateMode).toBe("noop");
    expect(result.rescannedFileCount).toBe(0);
    expect(fs.existsSync(generatedPath)).toBe(true);
    expect(manifest.files.some((file) => file.path.includes("bin/Debug"))).toBe(false);
    expect(fs.statSync(generatedPath).mtimeMs).toBeGreaterThanOrEqual(fs.statSync(manifestPath).mtimeMs);
  });

  it("runs the generated-only noop benchmark scenario", async () => {
    const { runGraphBenchmarkUpdateCli } = await import("./graphBenchmarkUpdate.js");
    const payload = await runGraphBenchmarkUpdateCli([
      "--scenario",
      "generated-noop",
      "--fixtures",
      path.join(repoRoot(), "tests", "fixtures", "graph"),
      "--json",
    ]);

    expect(payload.ok).toBe(true);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]?.updateMode).toBe("noop");
    expect(payload.results[0]?.rescannedFileCount).toBe(0);
  });

  it("runs all fixture benchmark scenarios", async () => {
    const { runGraphBenchmarkUpdateCli } = await import("./graphBenchmarkUpdate.js");
    const payload = await runGraphBenchmarkUpdateCli([
      "--fixtures",
      path.join(repoRoot(), "tests", "fixtures", "graph"),
      "--json",
    ]);

    expect(payload.ok).toBe(true);

    const resultScenarioIds = payload.results.map((result) => result.scenarioId).sort();
    const configuredScenarioIds = [...GRAPH_UPDATE_BENCHMARK_SCENARIO_IDS].sort();
    expect(resultScenarioIds).toEqual(configuredScenarioIds);
    expect(new Set(resultScenarioIds).size).toBe(resultScenarioIds.length);
    expect(payload.results.every((result) => result.passed)).toBe(true);
  });
});
