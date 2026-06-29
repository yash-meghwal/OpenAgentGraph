import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000 });

const tempPaths: string[] = [];

afterEach(() => {
  for (const dir of tempPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function fixtureRoot(fixtureName: string) {
  return path.join(repoRoot(), "tests", "fixtures", "graph", fixtureName);
}

function learnLogPath(name: string) {
  return path.join(repoRoot(), "tests", "fixtures", "learn", name);
}

function copyFixtureToTemp(fixtureName: string) {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), `oag-learn-${fixtureName}-`));
  tempPaths.push(destination);
  fs.cpSync(fixtureRoot(fixtureName), destination, { recursive: true });
  return destination;
}

describe("graph learn cli", () => {
  it("requires workspace or from-log", async () => {
    const { runGraphLearnCli } = await import("./graphLearn.js");
    await expect(runGraphLearnCli([])).rejects.toThrow(/requires --workspace|requires --from-log/);
  });

  it("analyzes log fixtures without auto-editing user files", async () => {
    const { runGraphLearnCli } = await import("./graphLearn.js");
    const outputPath = path.join(os.tmpdir(), `oag-learn-log-only-${Date.now()}.md`);
    tempPaths.push(outputPath);

    const result = await runGraphLearnCli([
      "--from-log",
      learnLogPath("agent-path-miss.log"),
      "--output",
      outputPath,
      "--json",
    ]);

    expect(result.findingCount).toBeGreaterThan(0);
    expect(result.reviewOnlyDisclaimer).toContain("does not auto-edit");
    const written = fs.readFileSync(outputPath, "utf8");
    expect(written).toContain("does not auto-edit");
    expect(written).not.toMatch(/<<<<|>>>>|AUTO-APPLY/i);
  });

  it("exposes logFindings and findingCount in workspace plus log JSON mode", async () => {
    const workspaceRoot = copyFixtureToTemp("fixture-agentic-harness-noisy");
    const { runGraphLearnCli } = await import("./graphLearn.js");
    const outputPath = path.join(os.tmpdir(), `oag-learn-combined-${Date.now()}.md`);
    tempPaths.push(outputPath);

    const result = await runGraphLearnCli([
      "--workspace",
      workspaceRoot,
      "--from-log",
      learnLogPath("agent-path-miss.log"),
      "--output",
      outputPath,
      "--json",
    ]);

    expect(result.combinedMode).toBe(true);
    expect(result.findingCount).toBeGreaterThan(0);
    expect(result.logFindings?.findingCount).toBeGreaterThan(0);
    expect(result.harnessProposals?.modelFailureCount).toBeGreaterThan(0);
    expect(result.harnessProposals?.proposals.every((proposal) => proposal.safeForAgentAutoApply === false)).toBe(true);

    const written = fs.readFileSync(outputPath, "utf8");
    expect(written).toContain("Workspace harness proposals");
    expect(written).toContain("Log analysis (merged into harness proposals above)");
    expect(written).not.toContain("## Path or query returned no useful results\n\nCode:");
    expect(JSON.stringify(result)).not.toContain("sk_test");
    expect(written).not.toMatch(/<<<<|>>>>/);
    expect(written).not.toMatch(/safeForAgentAutoApply:\s*true/i);
  });

  it("redacts secrets from combined workspace and log proposals", async () => {
    const workspaceRoot = copyFixtureToTemp("fixture-agentic-harness-noisy");
    const { runGraphLearnCli } = await import("./graphLearn.js");
    const outputPath = path.join(os.tmpdir(), `oag-learn-secret-${Date.now()}.md`);
    tempPaths.push(outputPath);

    const result = await runGraphLearnCli([
      "--workspace",
      workspaceRoot,
      "--from-log",
      learnLogPath("agent-with-secrets.log"),
      "--output",
      outputPath,
      "--json",
    ]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk_test");
    expect(serialized).not.toContain("eyJhbGci");
    expect(result.harnessProposals?.proposalCount).toBeGreaterThan(0);
    expect(result.harnessProposals?.proposals.every((proposal) => proposal.safeForAgentAutoApply === false)).toBe(true);
  });

  it("produces harness proposals for conflicting fixture matching graph:check inputs", async () => {
    const workspaceRoot = copyFixtureToTemp("fixture-agentic-harness-conflicting");
    const { runGraphLearnCli } = await import("./graphLearn.js");
    const { runGraphCheckCli } = await import("./graphCheck.js");

    const check = await runGraphCheckCli(["--workspace", workspaceRoot, "--json", "--mode", "warn"]);
    const learn = await runGraphLearnCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--output",
      path.join(os.tmpdir(), `oag-learn-conflicting-${Date.now()}.md`),
    ]);

    expect(learn.harnessProposals?.proposalCount).toBeGreaterThan(0);
    expect(learn.harnessProposals?.proposals.some((proposal) =>
      proposal.category === "conflicting_agent_instructions"
    )).toBe(true);
    expect(check.harnessImprovementProposals?.proposalCount).toBe(learn.harnessProposals?.proposalCount);
  });

  it("produces missing-harness proposals for missing fixture", async () => {
    const workspaceRoot = copyFixtureToTemp("fixture-agentic-harness-missing");
    const { runGraphLearnCli } = await import("./graphLearn.js");

    const learn = await runGraphLearnCli([
      "--workspace",
      workspaceRoot,
      "--json",
      "--output",
      path.join(os.tmpdir(), `oag-learn-missing-${Date.now()}.md`),
    ]);

    const categories = learn.harnessProposals?.proposals.map((proposal) => proposal.category) ?? [];
    expect(categories).toContain("missing_setup_command");
    expect(categories).toContain("missing_test_command");
    expect(categories).toContain("missing_agent_instructions");
  });
});