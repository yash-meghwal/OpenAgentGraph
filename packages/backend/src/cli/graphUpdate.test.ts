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

function shouldCopyFixtureEntry(sourceRoot: string, sourcePath: string) {
  const relative = path.relative(sourceRoot, sourcePath).replace(/\\/g, "/");
  if (!relative || relative === ".") {
    return true;
  }
  if (relative === ".oag" || relative.startsWith(".oag/")) {
    return false;
  }
  if (relative === "GRAPH_REPORT.md") {
    return false;
  }
  return true;
}

function copyFixtureWorkspace(fixtureName: string) {
  const sourceRoot = fixtureRoot(fixtureName);
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `openagentgraph-graph-update-${fixtureName}-`));
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

function readGraph(workspaceRoot: string) {
  return JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".oag", "graph.json"), "utf8"));
}

function hasLinkedNodes(
  graph: {
    nodes: Array<{ id: string; label: string; path?: string }>;
    edges: Array<{ sourceNodeId: string; targetNodeId: string }>;
  },
  labelA: RegExp,
  labelB: RegExp
) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges.some((edge) => {
    const source = nodesById.get(edge.sourceNodeId);
    const target = nodesById.get(edge.targetNodeId);
    const forward = labelA.test(source?.label ?? "") && labelB.test(target?.label ?? "");
    const reverse = labelB.test(source?.label ?? "") && labelA.test(target?.label ?? "");
    return forward || reverse;
  });
}

describe.sequential("graph:update", () => {
  it("requires --workspace", async () => {
    const { runGraphUpdateCli } = await import("./graphUpdate.js");
    await expect(runGraphUpdateCli([])).rejects.toThrow("Graph commands require --workspace");
  });

  it("incrementally updates graph after a source edit", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const viewModelPath = path.join(workspaceRoot, "SampleMediaPlayer.App", "ViewModels", "MainViewModel.cs");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    const before = readGraph(workspaceRoot);

    fs.appendFileSync(viewModelPath, "\n// graph-update-test-marker\n", "utf8");
    const result = await runGraphUpdateCli(["--workspace", workspaceRoot, "--json"]);

    expect(result.mode).toBe("incremental");
    expect(result.changed).toContain("SampleMediaPlayer.App/ViewModels/MainViewModel.cs");
    expect(result.writtenPaths.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(workspaceRoot, ".oag", "graph-manifest.json"))).toBe(true);

    const after = readGraph(workspaceRoot);
    expect(after.generatedAt).not.toBe(before.generatedAt);
    expect(after.diagnostics.join(" ")).toMatch(/Incremental update touched/i);
  });

  it("removes deleted files from the graph", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const tempServicePath = path.join(workspaceRoot, "SampleMediaPlayer.Core", "Services", "TempService.cs");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    fs.writeFileSync(
      tempServicePath,
      "namespace SampleMediaPlayer.Core.Services;\npublic class TempService {}\n",
      "utf8"
    );
    await seedGraphWorkspaceForUpdate(workspaceRoot);
    const before = readGraph(workspaceRoot);
    expect(before.nodes.some((node: { label: string }) => node.label.includes("TempService"))).toBe(true);

    fs.rmSync(tempServicePath, { force: true });
    const result = await runGraphUpdateCli(["--workspace", workspaceRoot, "--json"]);

    expect(result.mode).toBe("incremental");
    expect(result.deleted).toContain("SampleMediaPlayer.Core/Services/TempService.cs");
    const after = readGraph(workspaceRoot);
    expect(after.nodes.some((node: { label: string }) => node.label.includes("TempService"))).toBe(false);
  });

  it("noops when fingerprints are unchanged", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    const before = readGraph(workspaceRoot);
    const result = await runGraphUpdateCli(["--workspace", workspaceRoot, "--json"]);

    expect(result.status).toBe("graph_update_noop");
    expect(result.mode).toBe("noop");
    expect(result.writtenPaths).toEqual([]);
    expect(readGraph(workspaceRoot).generatedAt).toBe(before.generatedAt);
  });

  it("forces a full scan with --refresh", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    const result = await runGraphUpdateCli(["--workspace", workspaceRoot, "--refresh", "--json"]);

    expect(result.mode).toBe("full");
    expect(result.reasons.join(" ")).toMatch(/Forced full scan/i);
    expect(result.writtenPaths.length).toBeGreaterThan(0);
  });

  it("falls back to full scan when graph-manifest.json is missing", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    fs.rmSync(path.join(workspaceRoot, ".oag", "graph-manifest.json"), { force: true });

    const result = await runGraphUpdateCli(["--workspace", workspaceRoot, "--json"]);
    expect(result.mode).toBe("full");
    expect(result.reasons.join(" ")).toMatch(/graph-manifest\.json/i);
  });

  it("falls back to full scan when manifest schema is stale", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const manifestPath = path.join(workspaceRoot, ".oag", "graph-manifest.json");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.schemaVersion = "99";
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = await runGraphUpdateCli(["--workspace", workspaceRoot, "--json"]);
    expect(result.mode).toBe("full");
    expect(result.reasons.join(" ")).toMatch(/manifest schema version/i);
  });

  it("ignores generated bin/ changes during incremental update", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const generatedPath = path.join(workspaceRoot, "SampleMediaPlayer.App", "bin", "Debug", "Generated.cs");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    fs.mkdirSync(path.dirname(generatedPath), { recursive: true });
    fs.writeFileSync(generatedPath, "namespace Generated;\npublic class BuildOutput {}\n", "utf8");

    const result = await runGraphUpdateCli(["--workspace", workspaceRoot, "--json"]);
    expect(result.mode).toBe("noop");
    expect(result.writtenPaths).toEqual([]);

    const graph = readGraph(workspaceRoot);
    expect(graph.nodes.some((node: { path?: string; label: string }) =>
      (node.path ?? node.label).includes("bin/Debug")
    )).toBe(false);
  });

  it("supports --dry-run without writing artifacts", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const viewModelPath = path.join(workspaceRoot, "SampleMediaPlayer.App", "ViewModels", "MainViewModel.cs");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    const beforeGeneratedAt = readGraph(workspaceRoot).generatedAt;

    fs.appendFileSync(viewModelPath, "\n// dry-run-marker\n", "utf8");
    const result = await runGraphUpdateCli(["--workspace", workspaceRoot, "--dry-run", "--json"]);

    expect(result.dryRun).toBe(true);
    expect(result.mode).toBe("incremental");
    expect(result.writtenPaths).toEqual([]);
    expect(readGraph(workspaceRoot).generatedAt).toBe(beforeGeneratedAt);
  });

  it("expands incremental scope to dependency neighbors for edge refresh", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const viewModelPath = path.join(workspaceRoot, "SampleMediaPlayer.App", "ViewModels", "MainViewModel.cs");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    fs.appendFileSync(viewModelPath, "\n// speed-marker\n", "utf8");

    const incremental = await runGraphUpdateCli(["--workspace", workspaceRoot, "--json"]);

    expect(incremental.mode).toBe("incremental");
    expect(incremental.scanPaths).toContain("SampleMediaPlayer.App/ViewModels/MainViewModel.cs");
    expect(incremental.neighborPaths.length).toBeGreaterThan(0);
    expect(incremental.scanPaths).toEqual(expect.arrayContaining(incremental.neighborPaths));
    expect(incremental.reasons.join(" ")).toMatch(/dependency neighbor/i);
  });

  it("refreshes dependency edges when a dependency-bearing file changes", async () => {
    const workspaceRoot = copyFixtureWorkspace("fixture-csharp-wpf");
    const viewModelPath = path.join(workspaceRoot, "SampleMediaPlayer.App", "ViewModels", "MainViewModel.cs");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    await seedGraphWorkspaceForUpdate(workspaceRoot);
    const before = readGraph(workspaceRoot);
    expect(hasLinkedNodes(before, /MainView\.xaml/i, /MainViewModel/i)).toBe(true);

    fs.appendFileSync(viewModelPath, "\n// dependency-edge-refresh\n", "utf8");
    const result = await runGraphUpdateCli(["--workspace", workspaceRoot, "--json"]);

    expect(result.mode).toBe("incremental");
    expect(result.neighborPaths).toContain("SampleMediaPlayer.App/Views/MainView.xaml");

    const after = readGraph(workspaceRoot);
    expect(hasLinkedNodes(after, /MainView\.xaml/i, /MainViewModel/i)).toBe(true);
  });

  it("respects nested ignore files during fingerprinting", async () => {
    const workspaceRoot = copyFixtureWorkspace("nested-gitignore");
    const packageRoot = path.join(workspaceRoot, "package");
    const generatedPath = path.join(packageRoot, "generated", "out.ts");
    const { seedGraphWorkspaceForUpdate, runGraphUpdateCli } = await import("./graphUpdate.js");

    await seedGraphWorkspaceForUpdate(packageRoot);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, ".oag", "graph-manifest.json"), "utf8")
    );
    expect(manifest.files.some((file: { path: string }) => file.path.includes("generated/out.ts"))).toBe(false);

    const touchedAt = new Date(Date.now() + 60_000);
    fs.utimesSync(generatedPath, touchedAt, touchedAt);
    const result = await runGraphUpdateCli(["--workspace", packageRoot, "--json"]);
    expect(result.mode).toBe("noop");
  });
});
