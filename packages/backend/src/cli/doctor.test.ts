import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

const tempPaths: string[] = [];

afterEach(() => {
  for (const dir of tempPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("doctor cli", () => {
  it("requires --workspace", async () => {
    const { runDoctorCli } = await import("./doctor.js");
    await expect(runDoctorCli([])).rejects.toThrow('doctor requires --workspace');
  });

  it("reports failure for missing workspaces", async () => {
    const missing = path.join(os.tmpdir(), `oag-doctor-missing-${Date.now()}`);
    const { runDoctorCli } = await import("./doctor.js");
    const payload = await runDoctorCli(["--workspace", missing, "--json"]);
    expect(payload.ok).toBe(false);
    expect(payload.errors.join(" ")).toMatch(/does not exist/i);
  });

  it("includes agent harness report when a cached graph export exists", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "oag-doctor-harness-"));
    tempPaths.push(base);
    const workspaceRoot = path.join(base, "fixture-csharp-wpf");
    fs.cpSync(path.join(repoRoot(), "tests", "fixtures", "graph", "fixture-csharp-wpf"), workspaceRoot, { recursive: true });

    const { runGraphExportCli } = await import("./graphExport.js");
    const { runDoctorCli } = await import("./doctor.js");

    await runGraphExportCli(["--workspace", workspaceRoot, "--json", "--report"]);
    const payload = await runDoctorCli(["--workspace", workspaceRoot, "--json"]);

    expect(payload.agentHarnessReport).toBeDefined();
    expect(Array.isArray(payload.agentHarnessReport?.readBeforeCoding)).toBe(true);
    expect(typeof payload.agentHarnessReport?.specQualityScore).toBe("number");
    expect(payload.agentHarnessReport?.verifyBeforeDone.length).toBeGreaterThanOrEqual(0);
    expect(payload.agentHarnessReport?.graphFreshness.isStale).toBe(false);
    expect(payload.contextNoise).toBeDefined();
    expect(typeof payload.contextNoise?.score).toBe("number");
    expect(payload.contextNoise?.score).toBe(payload.agentHarnessReport?.contextNoiseScore);
    expect(payload.agenticReadiness).toBeDefined();
    expect(typeof payload.agenticReadiness?.overallScore).toBe("number");
    expect(payload.agenticReadiness?.specQuality.label).toBeDefined();
    expect(payload.agenticReadiness?.verificationMap.summary.length).toBeGreaterThan(0);
    expect(payload.agenticReadiness?.contextNoise.label).toBeDefined();
    expect(payload.nextCommands.some((command) => command.includes("graph:context"))).toBe(true);
    expect(payload.nextCommands.some((command) => command.includes("--include-verification"))).toBe(true);

    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((message) => {
      logLines.push(String(message));
    });
    await runDoctorCli(["--workspace", workspaceRoot]);
    logSpy.mockRestore();

    const humanOutput = logLines.join("\n");
    expect(humanOutput).toMatch(/Agentic readiness: \d+\/100/);
    expect(humanOutput).toMatch(/Spec quality:/);
    expect(humanOutput).toMatch(/Verification map:/);
    expect(humanOutput).toMatch(/Context noise:/);
    expect(humanOutput).toMatch(/Docs health:/);
    expect(humanOutput).toMatch(/Next: oag graph:export/);
    expect(humanOutput).not.toMatch(/Graph handoff: stale/);
    expect(payload.agentHarnessReport?.graphFreshness.isStale).toBe(false);
  });

  it("returns json with versions and provider-key guarantee", async () => {
    const workspaceRoot = path.join(repoRoot(), "tests", "fixtures", "graph", "fixture-empty");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-secret-should-not-appear");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { runDoctorCli } = await import("./doctor.js");
    const payload = await runDoctorCli(["--workspace", workspaceRoot, "--json"]);

    expect(payload.ok).toBe(true);
    expect(payload.versions.backend).not.toBe("unknown");
    expect(payload.versions.shared).not.toBe("unknown");
    expect(payload.providerKey.requiredForGraphCommands).toBe(false);
    expect(payload.providerKey.configuredProviderKeys).toContain("OPENAI_API_KEY");
    expect(JSON.stringify(payload)).not.toContain("sk-test-secret-should-not-appear");
    expect(payload.nextCommands.some((command) => command.startsWith("oag graph:export"))).toBe(true);

    logSpy.mockRestore();
  });

  it("normalizes quoted workspaces with repeated spaces", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "oag-doctor-spaced-"));
    tempPaths.push(base);
    const workspaceRoot = path.join(base, "Video  Player", "fixture-empty");
    fs.mkdirSync(path.dirname(workspaceRoot), { recursive: true });
    fs.cpSync(path.join(repoRoot(), "tests", "fixtures", "graph", "fixture-empty"), workspaceRoot, { recursive: true });

    const { runDoctorCli } = await import("./doctor.js");
    const payload = await runDoctorCli(["--workspace", `"${workspaceRoot}"`, "--json"]);
    expect(payload.workspace.path).toBe(workspaceRoot);
    expect(payload.ok).toBe(true);
  });
});