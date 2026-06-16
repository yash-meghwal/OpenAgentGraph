import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function fixtureRoot(...segments: string[]) {
  return path.resolve(repoRoot(), "tests", "fixtures", "graph", ...segments);
}

const tempPaths: string[] = [];

function cleanupFixtureExports(workspaceRoot: string) {
  fs.rmSync(path.join(workspaceRoot, ".oag"), { recursive: true, force: true });
  fs.rmSync(path.join(workspaceRoot, "GRAPH_REPORT.md"), { force: true });
}

afterEach(() => {
  cleanupFixtureExports(fixtureRoot("fixture-csharp-wpf"));
  for (const dir of tempPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("graph cli", () => {
  it("requires --workspace for graph:query", async () => {
    const { runGraphQueryCli } = await import("./graphQuery.js");
    await expect(runGraphQueryCli([])).rejects.toThrow('Graph commands require --workspace');
  });

  it("queries MainViewModel on the csharp-wpf fixture", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphQueryCli } = await import("./graphQuery.js");
    const result = await runGraphQueryCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "MainViewModel playback",
    ]);

    expect(result.query).toBe("MainViewModel playback");
    expect(result.seeds.map((node) => node.label).join(" ")).toMatch(/MainViewModel/i);
    expect(result.nodes.some((node) => node.label.includes("PlaybackService"))).toBe(true);
  });

  it("normalizes Windows cmd caret markers in quoted multi-word queries", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphQueryCli } = await import("./graphQuery.js");
    const result = await runGraphQueryCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "^MainViewModel^",
      "playback^",
    ]);

    expect(result.query).toBe("MainViewModel playback");
  });

  it("finds a path between view and service on the csharp-wpf fixture", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphPathCli } = await import("./graphPath.js");
    const result = await runGraphPathCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "MainView.xaml",
      "PlaybackService",
    ]);

    expect(result.found).toBe(true);
    expect(result.nodes.map((node) => node.label).join(" ")).toMatch(/MainViewModel/i);
  });

  it("explains MainViewModel with neighbors", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphExplainCli } = await import("./graphExplain.js");
    const result = await runGraphExplainCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "MainViewModel",
    ]);

    expect(result.resolved).toBe(true);
    expect(result.neighbors.length).toBeGreaterThan(0);
  });

  it("exports graph artifacts under .oag and writes GRAPH_REPORT.md", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphExportCli } = await import("./graphExport.js");
    const result = await runGraphExportCli(["--workspace", workspaceRoot, "--json", "--html", "--wiki", "--report"]);

    expect(result.writtenPaths.length).toBe(5);
    expect(fs.existsSync(path.join(workspaceRoot, ".oag", "graph.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, ".oag", "graph-manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, ".oag", "graph.html"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, ".oag", "wiki", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "GRAPH_REPORT.md"))).toBe(true);

    const report = fs.readFileSync(path.join(workspaceRoot, "GRAPH_REPORT.md"), "utf8");
    expect(report).toContain("# OpenAgentGraph Handoff");
    expect(report).toMatch(/MainViewModel/i);
    expect(report).not.toContain("/bin/");
  });

  it("reports task lenses and god nodes for the csharp-wpf fixture", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphLensCli } = await import("./graphLens.js");
    const result = await runGraphLensCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--lens",
      "desktop-mobile",
    ]);

    expect(result.primaryLens).toBe("desktop-mobile");
    expect(result.godNodes.length).toBeGreaterThan(0);
    expect(result.health.badges.length).toBeGreaterThan(0);
    expect(result.scopedNodeCount).toBeGreaterThan(0);
  });

  it("passes graph:check on the csharp-wpf fixture", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphExportCli } = await import("./graphExport.js");
    const { runGraphCheckCli } = await import("./graphCheck.js");

    await runGraphExportCli(["--workspace", workspaceRoot, "--json", "--report"]);
    const result = await runGraphCheckCli(["--workspace", workspaceRoot, "--json", "--mode", "hard"]);

    expect(result.ok).toBe(true);
    expect(result.checks.some((check) => check.code === "marker_sln_without_csharp")).toBe(false);
    expect(result.handoffFreshness.isStale).toBe(false);
  });

  it("recovers kernel profile gates when graph:check loads a cached graph", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-cached-check-"));
    tempPaths.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, "Broken.sln"), "Microsoft Visual Studio Solution File\n");

    const { runGraphExportCli } = await import("./graphExport.js");
    const { runGraphCheckCli } = await import("./graphCheck.js");

    await runGraphExportCli(["--workspace", workspaceRoot, "--json"]);
    const result = await runGraphCheckCli(["--workspace", workspaceRoot, "--json", "--mode", "warn"]);

    expect(result.fromCache).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.checks.some((check) => check.code === "marker_sln_without_csharp" && check.severity === "fail")).toBe(true);
  });

  it("includes OAG fusion checks in exported GRAPH_REPORT.md", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphExportCli } = await import("./graphExport.js");

    await runGraphExportCli(["--workspace", workspaceRoot, "--json", "--report"]);
    const report = fs.readFileSync(path.join(workspaceRoot, "GRAPH_REPORT.md"), "utf8");
    expect(report).toContain("## OAG fusion checks");
    expect(report).toContain("## Agent context APIs");
  });

  it("loads cached graph.json when present", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphExportCli } = await import("./graphExport.js");
    const { runGraphQueryCli } = await import("./graphQuery.js");

    await runGraphExportCli(["--workspace", workspaceRoot, "--json"]);
    const cached = await runGraphQueryCli(["--workspace", workspaceRoot, "--json", "MainViewModel"]);
    expect(cached.fromCache).toBe(true);

    const refreshed = await runGraphQueryCli([
      "--workspace",
      workspaceRoot,
      "--refresh",
      "--json",
      "MainViewModel",
    ]);
    expect(refreshed.fromCache).toBe(false);
  });
});
