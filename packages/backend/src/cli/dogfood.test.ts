import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("dogfood cli", () => {
  afterEach(() => {
    setAppConfigOverride(undefined);
    vi.resetModules();
    for (const dir of tempPaths.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
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

  it("writes GRAPH_REPORT.md using isolated dogfood data for workspaces with spaces", async () => {
    const repoRoot = makeTempDir("openagentgraph-dogfood-repo-");
    const workspaceRoot = path.join(makeTempDir("openagentgraph-dogfood-target-"), "Video Player", "SampleMediaPlayer");
    writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    writeFile(path.join(workspaceRoot, "App.sln"), "Microsoft Visual Studio Solution File\n");
    writeFile(path.join(workspaceRoot, "src", "Player.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>\n");
    writeFile(path.join(workspaceRoot, "src", "Player.cs"), "public class Player { }\n");
    writeFile(path.join(workspaceRoot, "bin", "Release", "lib.js"), "export const generated = true;\n");

    const originalCwd = process.cwd();
    process.chdir(repoRoot);
    try {
      const { runDogfoodCli } = await import("./dogfood.js");
      await runDogfoodCli(["--workspace", workspaceRoot, "--json"]);
    } finally {
      process.chdir(originalCwd);
    }

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