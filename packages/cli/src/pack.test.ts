import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { OAG_CLI_COMMANDS, renderOagCliHelp } from "./backendCli.js";

vi.setConfig({ testTimeout: 240_000 });

function spawnNode(args: string[], cwd: string) {
  const childEnv = { ...process.env };
  delete childEnv.VITEST;
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: childEnv,
    maxBuffer: 16 * 1024 * 1024,
  });
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

function resolveNpmSpawnArgs(args: string[], cwd: string) {
  if (process.platform === "win32") {
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    return { command: process.execPath, args: [npmCli, ...args], cwd };
  }
  return { command: "npm", args, cwd };
}

function runNpm(args: string[], cwd: string) {
  const target = resolveNpmSpawnArgs(args, cwd);
  return spawnSync(target.command, target.args, { cwd: target.cwd, encoding: "utf8" });
}

describe("@openagentgraph/cli packaging", () => {
  it("keeps backend Roslyn helper build artifacts out of the backend package", () => {
    const result = runNpm(["pack", "--dry-run", "--json"], path.join(repoRoot, "packages", "backend"));
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>;
    const packedPaths = payload[0]?.files.map((file) => file.path.replace(/\\/g, "/")) ?? [];
    expect(packedPaths).toContain("scanner-tools/roslyn-helper/Program.cs");
    expect(packedPaths).toContain("scanner-tools/roslyn-helper/RoslynHelper.csproj");
    expect(packedPaths.some((filePath) => /scanner-tools\/.*\/(?:bin|obj)\//.test(filePath))).toBe(false);
  });

  it("lists only intended publish files in npm pack dry-run", () => {
    const result = runNpm(["pack", "--dry-run", "--json"], packageRoot);
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>;
    const packedPaths = payload[0]?.files.map((file) => file.path) ?? [];
    expect(packedPaths.some((filePath) => filePath.startsWith("dist/"))).toBe(true);
    expect(packedPaths.some((filePath) => filePath === "README.md")).toBe(true);
    expect(packedPaths.some((filePath) => filePath.includes("src/"))).toBe(false);
  });

  it("renders help for supported commands", () => {
    const help = renderOagCliHelp();
    for (const command of OAG_CLI_COMMANDS) {
      expect(help).toContain(command);
    }
  });

  it("smoke-tests oag --help after build", () => {
    const binEntry = path.join(packageRoot, "dist", "bin.js");
    expect(fs.existsSync(binEntry)).toBe(true);
    const result = spawnSync(process.execPath, [binEntry, "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("graph:export");
  });

  it("smoke-tests packed install against a small fixture", { timeout: 240_000 }, () => {
    const packResult = runNpm(["pack", "--pack-destination", os.tmpdir(), "--json"], packageRoot);
    expect(packResult.status).toBe(0);
    const packed = JSON.parse(packResult.stdout) as Array<{ filename: string }>;
    const tarball = path.join(os.tmpdir(), packed[0]!.filename);
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "oag-cli-smoke-"));
    const sharedPack = runNpm(["pack", "--pack-destination", os.tmpdir(), "--json"], path.join(repoRoot, "packages", "shared"));
    const backendPack = runNpm(["pack", "--pack-destination", os.tmpdir(), "--json"], path.join(repoRoot, "packages", "backend"));
    expect(sharedPack.status).toBe(0);
    expect(backendPack.status).toBe(0);
    const sharedTarball = path.join(os.tmpdir(), (JSON.parse(sharedPack.stdout) as Array<{ filename: string }>)[0]!.filename);
    const backendTarball = path.join(os.tmpdir(), (JSON.parse(backendPack.stdout) as Array<{ filename: string }>)[0]!.filename);

    const installResult = runNpm(["install", "--no-save", tarball, sharedTarball, backendTarball], installDir);
    expect(installResult.status).toBe(0);

    const oagBin = path.join(installDir, "node_modules", "@openagentgraph", "cli", "dist", "bin.js");
    const helpResult = spawnNode([oagBin, "--help"], installDir);
    expect(helpResult.status).toBe(0);
    expect(helpResult.stdout).toContain("graph:path");

    const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "graph", "fixture-empty");
    const exportEntry = path.join(installDir, "node_modules", "@openagentgraph", "backend", "dist", "cli", "graphExport.js");
    expect(fs.existsSync(exportEntry)).toBe(true);
    const exportResult = spawnNode([exportEntry, "--workspace", fixtureRoot, "--offline-only"], installDir);
    expect(exportResult.status).toBe(0);
    expect(`${exportResult.stdout ?? ""}${exportResult.stderr ?? ""}`).toMatch(/Workspace:|Nodes:/);

    const routeResult = spawnNode([oagBin, "graph:export", "--workspace", fixtureRoot, "--offline-only"], installDir);
    expect(routeResult.status).toBe(0);

    const doctorResult = spawnNode([oagBin, "doctor", "--workspace", fixtureRoot, "--json"], installDir);
    expect(doctorResult.status).toBe(0);
    const doctorPayload = JSON.parse(doctorResult.stdout) as { ok: boolean; providerKey: { requiredForGraphCommands: boolean } };
    expect(doctorPayload.ok).toBe(true);
    expect(doctorPayload.providerKey.requiredForGraphCommands).toBe(false);
    expect(`${doctorResult.stdout}${doctorResult.stderr}`).not.toMatch(/sk-[A-Za-z0-9]/);

    const queryResult = spawnNode([
      oagBin,
      "graph:query",
      "--workspace",
      fixtureRoot,
      "--mode",
      "code",
      "--json",
      "entry",
    ], installDir);
    expect(queryResult.status).toBe(0);
    const queryPayload = JSON.parse(queryResult.stdout) as { status: string; queryMode: string };
    expect(queryPayload.status).toBe("graph_query_complete");
    expect(queryPayload.queryMode).toBe("code");

    const dogfoodResult = spawnNode([
      oagBin,
      "dogfood",
      "--workspace",
      fixtureRoot,
      "--no-export",
      "--json",
    ], installDir);
    expect(dogfoodResult.status).toBe(0);
    const dogfoodPayload = JSON.parse(dogfoodResult.stdout) as { status: string };
    expect(dogfoodPayload.status).toBe("dogfood_complete");

    const scorecardResult = spawnNode([
      oagBin,
      "graph:scorecard",
      "--workspace",
      fixtureRoot,
      "--agentic-sdlc",
      "--json",
    ], installDir);
    expect(scorecardResult.status).toBe(0);
    const scorecardPayload = JSON.parse(scorecardResult.stdout) as { overallScore: number };
    expect(typeof scorecardPayload.overallScore).toBe("number");

    const learnResult = spawnNode([
      oagBin,
      "graph:learn",
      "--workspace",
      fixtureRoot,
      "--json",
    ], installDir);
    expect(learnResult.status).toBe(0);
    const learnPayload = JSON.parse(learnResult.stdout) as { status: string };
    expect(learnPayload.status).toBe("graph_learn_complete");
  });
});
