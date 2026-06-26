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

  it("warns on stderr when graph:explain receives path-only flags", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runGraphExplainCli } = await import("./graphExplain.js");

    await runGraphExplainCli([
      "--workspace",
      workspaceRoot,
      "--max-hops",
      "2",
      "--explain-ranking",
      "MainViewModel",
    ]);

    expect(warnSpy.mock.calls.map(([message]) => String(message))).toEqual(
      expect.arrayContaining([
        "--max-hops is only used by graph:path; ignoring.",
        "--explain-ranking is only used by graph:path; ignoring.",
      ])
    );
    warnSpy.mockRestore();
  });

  it("does not warn on stderr when graph:explain uses --json", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runGraphExplainCli } = await import("./graphExplain.js");

    await runGraphExplainCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--max-hops",
      "2",
      "MainViewModel",
    ]);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("queries a workspace whose path contains spaces", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-graph-cli-"));
    tempPaths.push(base);
    const workspaceRoot = path.join(base, "Video Player", "fixture-csharp-wpf");
    fs.mkdirSync(path.dirname(workspaceRoot), { recursive: true });
    fs.cpSync(fixtureRoot("fixture-csharp-wpf"), workspaceRoot, { recursive: true });

    const { runGraphQueryCli } = await import("./graphQuery.js");
    const quotedWorkspace = `"${workspaceRoot}"`;
    const result = await runGraphQueryCli([
      "--workspace",
      quotedWorkspace,
      "--json",
      "MainViewModel playback",
    ]);

    expect(result.workspaceRoot).toBe(path.resolve(workspaceRoot));
    expect(result.seeds.map((node) => node.label).join(" ")).toMatch(/MainViewModel/i);
  });

  it("queries a workspace whose folder name contains repeated spaces", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-graph-cli-double-"));
    tempPaths.push(base);
    const workspaceRoot = path.join(base, "Video  Player", "fixture-csharp-wpf");
    fs.mkdirSync(path.dirname(workspaceRoot), { recursive: true });
    fs.cpSync(fixtureRoot("fixture-csharp-wpf"), workspaceRoot, { recursive: true });

    const { runGraphQueryCli } = await import("./graphQuery.js");
    const result = await runGraphQueryCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "MainViewModel",
    ]);

    expect(result.workspaceRoot).toBe(path.resolve(workspaceRoot));
    expect(result.seeds.map((node) => node.label).join(" ")).toMatch(/MainViewModel/i);
  });

  it("matches direct node argv parity for quoted workspace paths", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphPathCli } = await import("./graphPath.js");
    const argv = ["--workspace", `"${workspaceRoot}"`, "--json", "MainView.xaml", "PlaybackService"];
    const result = await runGraphPathCli(argv);
    expect(result.workspaceRoot).toBe(path.resolve(workspaceRoot));
    expect(result.found).toBe(true);
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
    expect(result.nodes.some((node) => node.label === "workspace-root")).toBe(false);
    expect(result.toNode?.label).toMatch(/PlaybackService \(class\)/i);

    const labels = result.nodes.map((node) => node.label).join(" ");
    const hasRoslynSemanticPath = /MainViewModel/i.test(labels);
    if (hasRoslynSemanticPath) {
      expect(labels).toMatch(/MainViewModel/i);
    } else {
      const { ensureRoslynHelperPrepared } = await import("../scanner/kernel/roslynHelperPreparation.js");
      const roslyn = await ensureRoslynHelperPrepared({ autoBuild: false });
      expect(roslyn.availability.status).toBe("unavailable");
      expect(labels).toMatch(/MainView\.xaml/i);
    }
  });

  it("respects --max-hops on graph:path", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphPathCli } = await import("./graphPath.js");
    const withinHopBudget = await runGraphPathCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--max-hops",
      "4",
      "MainView.xaml",
      "PlaybackService",
    ]);
    const beyondHopBudget = await runGraphPathCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--max-hops",
      "1",
      "MainView.xaml",
      "PlaybackService",
    ]);

    expect(withinHopBudget.maxHops).toBe(4);
    expect(withinHopBudget.found).toBe(true);
    expect(beyondHopBudget.maxHops).toBe(1);
    expect(beyondHopBudget.found).toBe(false);
  });

  it("scopes graph:path results with --lens", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphPathCli } = await import("./graphPath.js");
    const open = await runGraphPathCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "MainView.xaml",
      "PlaybackService",
    ]);
    const docsLens = await runGraphPathCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--lens",
      "docs-handoff",
      "MainView.xaml",
      "PlaybackService",
    ]);

    expect(open.found).toBe(true);
    expect(docsLens.lens).toBe("docs-handoff");
    expect(docsLens.found).toBe(false);
  });

  it("explains ranked path steps on the csharp-wpf fixture", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphPathCli } = await import("./graphPath.js");
    const result = await runGraphPathCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--explain-ranking",
      "MainView.xaml",
      "PlaybackService",
    ]);

    expect(result.found).toBe(true);
    expect(result.explanation?.seedResolution.from.matchReason).toBeTruthy();
    expect(result.explanation?.steps.length).toBeGreaterThan(1);
    expect(result.nodes.some((node) => node.label === "workspace-root")).toBe(false);
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
    expect(result.community?.label).toMatch(/SampleMediaPlayer\.App/i);
  });

  it("returns community context from graph:query", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphQueryCli } = await import("./graphQuery.js");
    const result = await runGraphQueryCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "MainViewModel playback",
    ]);

    expect(Array.isArray(result.communities)).toBe(true);
    expect(result.communities.length).toBeGreaterThan(0);
    expect(result.communities.some((community) => /SampleMediaPlayer/i.test(community.label))).toBe(true);
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

    const html = fs.readFileSync(path.join(workspaceRoot, ".oag", "graph.html"), "utf8");
    expect(html).toContain('id="oag-search"');
    expect(html).toContain('id="oag-explain-panel"');
    expect(html).toContain("Path preview");

    const wiki = fs.readFileSync(path.join(workspaceRoot, ".oag", "wiki", "index.md"), "utf8");
    expect(wiki).toContain("## Community hubs");
    expect(wiki).toContain("## Read first by lens");
    expect(wiki).toContain("## Refresh commands");

    const graphJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".oag", "graph.json"), "utf8"));
    expect(graphJson.export?.graphVersion).toBe("1");
    expect(graphJson.export?.communities?.length).toBeGreaterThan(0);
    expect(graphJson.export?.scannerProfile?.primaryType).toBeTruthy();
    expect(graphJson.export?.provenance).toBeTruthy();
    expect(JSON.stringify(graphJson)).not.toMatch(/"body"\s*:/);
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
    expect(result.ecosystemSupport?.some((row: { scannerId: string; tier: string }) => row.scannerId === "dotnet")).toBe(true);
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

  it("redacts workspace roots in exported share-safe artifacts", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphExportCli } = await import("./graphExport.js");

    await runGraphExportCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--report",
      "--wiki",
      "--redact-root",
    ]);

    const report = fs.readFileSync(path.join(workspaceRoot, "GRAPH_REPORT.md"), "utf8");
    const wiki = fs.readFileSync(path.join(workspaceRoot, ".oag", "wiki", "index.md"), "utf8");
    const graphJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".oag", "graph.json"), "utf8"));

    expect(report).toContain("Workspace: `<workspace>`");
    expect(wiki).toContain("Workspace: `<workspace>`");
    expect(report).not.toContain(workspaceRoot);
    expect(graphJson.workspaceRoot).toBe(workspaceRoot);
    expect(graphJson.export?.refreshCommands?.[0]).toContain('"<workspace>"');
  });

  it("includes OAG fusion checks in exported GRAPH_REPORT.md", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphExportCli } = await import("./graphExport.js");

    await runGraphExportCli(["--workspace", workspaceRoot, "--json", "--report"]);
    const report = fs.readFileSync(path.join(workspaceRoot, "GRAPH_REPORT.md"), "utf8");
    expect(report).toContain("## OAG fusion checks");
    expect(report).toContain("## Agent context APIs");
    expect(report).toContain("## Static OAG artifacts");
    expect(report).toContain("## How an agent should use these files");
    expect(report).toContain("## No provider key required");
    expect(report).toContain("## Ecosystem support matrix");
    expect(report).toContain("## Ecosystem tier legend");
  });

  it("exports offline-only without requiring server, sqlite, or provider APIs", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const { runGraphExportCli } = await import("./graphExport.js");
    const result = await runGraphExportCli(["--workspace", workspaceRoot, "--offline-only"]);

    expect(result.offlineOnly).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, ".oag", "graph.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, ".oag", "graph.html"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "GRAPH_REPORT.md"))).toBe(true);

    const html = fs.readFileSync(path.join(workspaceRoot, ".oag", "graph.html"), "utf8");
    expect(html).toContain('id="oag-explorer-data"');
    expect(html).toContain("Ecosystem support");
  });

  it("includes ecosystem tiers in graph:query output for godot fixture", async () => {
    const workspaceRoot = fixtureRoot("fixture-godot-lite");
    const { runGraphExportCli } = await import("./graphExport.js");
    const { runGraphQueryCli } = await import("./graphQuery.js");

    await runGraphExportCli(["--workspace", workspaceRoot, "--json"]);
    const result = await runGraphQueryCli(["--workspace", workspaceRoot, "--json", "player"]);
    expect(result.ecosystemSupport?.some((row: { scannerId: string; tier: string }) => row.scannerId === "godot" && row.tier === "T1")).toBe(true);
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

  it("returns query intent metadata in graph:query JSON output", async () => {
    const workspaceRoot = fixtureRoot("fixture-docs-mixed-code");
    const { runGraphQueryCli } = await import("./graphQuery.js");
    const result = await runGraphQueryCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--mode",
      "docs",
      "how does checkout work",
    ]);
    expect(result.queryMode).toBe("docs");
    expect(result.intent?.requestedMode).toBe("docs");
    expect(result.intent?.effectiveMode).toBe("docs");
    expect(result.mode).toBe("bfs");
  });

  it("ranks code mode toward code symbols on mixed docs/code fixture", async () => {
    const workspaceRoot = fixtureRoot("fixture-docs-mixed-code");
    const { runGraphQueryCli } = await import("./graphQuery.js");
    const result = await runGraphQueryCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--mode",
      "code",
      "CheckoutController service",
    ]);
    expect(result.queryMode).toBe("code");
    expect(result.seeds[0]?.label).toMatch(/CheckoutController|CheckoutService/i);
  });
});
