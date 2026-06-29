import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgenticSdlcScorecard, evaluateContextNoise } from "@openagentgraph/shared";
import {
  buildWorkspaceAgenticSdlcScorecard,
  evaluateHarnessContextNoise,
} from "./graphHarnessMetadata.js";
import { parseGraphScorecardArgv } from "./graphScorecard.js";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";

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

function copyFixtureToTemp(fixtureName: string) {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), `oag-scorecard-${fixtureName}-`));
  tempPaths.push(destination);
  fs.cpSync(fixtureRoot(fixtureName), destination, { recursive: true });
  return destination;
}

describe("graph scorecard cli", () => {
  it("defaults CLI clean-install smoke status to not_run", () => {
    const options = parseGraphScorecardArgv(["--no-external", "--no-update", "--json"]);
    expect(options.cliSmokeStatus).toBe("not_run");
  });

  it("accepts explicit CLI clean-install smoke status values", () => {
    expect(parseGraphScorecardArgv(["--cli-smoke-status", "pass"]).cliSmokeStatus).toBe("pass");
    expect(parseGraphScorecardArgv(["--cli-smoke-status", "fail"]).cliSmokeStatus).toBe("fail");
    expect(parseGraphScorecardArgv(["--cli-smoke-status", "not_run"]).cliSmokeStatus).toBe("not_run");
  });

  it("rejects invalid CLI clean-install smoke status values", () => {
    expect(() => parseGraphScorecardArgv(["--cli-smoke-status", "maybe"])).toThrow(/Invalid --cli-smoke-status/);
  });

  it("builds workspace agentic scorecards with harness context-noise diagnostics", async () => {
    const workspaceRoot = copyFixtureToTemp("fixture-agentic-harness-noisy");
    const scan = await runKernelWorkspaceScan(workspaceRoot);
    const scorecard = buildWorkspaceAgenticSdlcScorecard(workspaceRoot, scan.unifiedGraph, {
      kernelProfile: scan.kernelProfile,
    });
    const { contextNoise } = evaluateHarnessContextNoise(workspaceRoot, scan.unifiedGraph, {
      kernelProfile: scan.kernelProfile,
    });
    const bareScorecard = buildAgenticSdlcScorecard({
      workspaceRoot,
      graph: scan.unifiedGraph,
      kernelProfile: scan.kernelProfile,
      contextNoise: evaluateContextNoise(scan.unifiedGraph),
    });

    expect(contextNoise.score).toBeLessThanOrEqual(76);
    expect(contextNoise.noiseItems.some((item) => item.path === "generated-output.js")).toBe(true);
    const contextCategory = scorecard.categories.find((category) => category.id === "context_readiness");
    const bareContextCategory = bareScorecard.categories.find((category) => category.id === "context_readiness");
    expect(contextCategory?.score).toBeLessThan(bareContextCategory?.score ?? 100);
    expect(contextCategory?.gaps.some((gap) => /generated-output\.js|generated artifact/i.test(gap))).toBe(true);
  });

  const agenticSdlcFixtures = [
    "fixture-agentic-harness-good",
    "fixture-agentic-harness-missing",
    "fixture-agentic-harness-conflicting",
    "fixture-agentic-harness-noisy",
  ] as const;

  it("matches standalone --agentic-sdlc scores for each public fixture sample", async () => {
    const { runGraphScorecardCli } = await import("./graphScorecard.js");
    const { loadHarnessWorkspaceMetadata } = await import("./graphHarnessMetadata.js");

    for (const fixtureId of agenticSdlcFixtures) {
      const workspaceRoot = copyFixtureToTemp(fixtureId);
      const scan = await runKernelWorkspaceScan(workspaceRoot);
      const metadata = loadHarnessWorkspaceMetadata(workspaceRoot);
      const fixtureSampleScorecard = buildWorkspaceAgenticSdlcScorecard(workspaceRoot, scan.unifiedGraph, {
        metadata,
        kernelProfile: scan.kernelProfile,
      });
      const standaloneScorecard = await runGraphScorecardCli([
        "--workspace",
        workspaceRoot,
        "--agentic-sdlc",
        "--json",
        "--no-external",
        "--no-update",
      ]);

      expect(fixtureSampleScorecard.overallScore).toBe(standaloneScorecard.overallScore);
      expect(fixtureSampleScorecard.ok).toBe(standaloneScorecard.ok);
    }
  });

  it("matches standalone --agentic-sdlc for conflicting fixture (update benchmark must not skew sample)", async () => {
    const workspaceRoot = copyFixtureToTemp("fixture-agentic-harness-conflicting");
    const { runGraphScorecardCli } = await import("./graphScorecard.js");
    const { loadHarnessWorkspaceMetadata } = await import("./graphHarnessMetadata.js");

    const scan = await runKernelWorkspaceScan(workspaceRoot);
    const metadata = loadHarnessWorkspaceMetadata(workspaceRoot);
    const withUpdateBenchmark = buildWorkspaceAgenticSdlcScorecard(workspaceRoot, scan.unifiedGraph, {
      metadata,
      kernelProfile: scan.kernelProfile,
      updateBenchmarkOk: true,
    });
    const fixtureSampleScorecard = buildWorkspaceAgenticSdlcScorecard(workspaceRoot, scan.unifiedGraph, {
      metadata,
      kernelProfile: scan.kernelProfile,
    });
    const standaloneScorecard = await runGraphScorecardCli([
      "--workspace",
      workspaceRoot,
      "--agentic-sdlc",
      "--json",
      "--no-external",
      "--no-update",
    ]);

    expect(withUpdateBenchmark.overallScore).not.toBe(standaloneScorecard.overallScore);
    expect(fixtureSampleScorecard.overallScore).toBe(standaloneScorecard.overallScore);
    expect(fixtureSampleScorecard.overallScore).toBe(67);
  });

  it("matches graph:check context readiness for the noisy harness fixture", async () => {
    const workspaceRoot = copyFixtureToTemp("fixture-agentic-harness-noisy");
    const { runGraphCheckCli } = await import("./graphCheck.js");
    const { runGraphScorecardCli } = await import("./graphScorecard.js");

    const check = await runGraphCheckCli(["--workspace", workspaceRoot, "--json", "--mode", "warn"]);
    const scorecard = await runGraphScorecardCli([
      "--workspace",
      workspaceRoot,
      "--agentic-sdlc",
      "--json",
      "--no-external",
      "--no-update",
    ]);

    const checkContext = check.agenticSdlcScorecard?.categories.find((category) => category.id === "context_readiness");
    const scorecardContext = scorecard.categories.find((category) => category.id === "context_readiness");
    expect(checkContext?.score).toBe(scorecardContext?.score);
    expect(check.contextNoise?.score).toBeLessThanOrEqual(76);
    expect(check.contextNoise?.noiseItems.some((item) => item.path === "generated-output.js")).toBe(true);
    expect(scorecardContext?.gaps.some((gap) => /generated-output\.js|generated artifact/i.test(gap))).toBe(true);
  });
});