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