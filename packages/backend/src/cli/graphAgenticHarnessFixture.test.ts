import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENTIC_SDLC_GOOD_THRESHOLD,
  buildAgenticSdlcScorecard,
  buildVerificationMap,
  evaluateContextNoise,
  evaluateGraphSpecQuality,
  evaluateHarnessReadiness,
  GRAPH_SPEC_QUALITY_GOOD_THRESHOLD,
  HARNESS_READINESS_GOOD_THRESHOLD,
} from "@openagentgraph/shared";
import {
  listHarnessRootPlanFiles,
  listHarnessTrackedGeneratedPaths,
  loadHarnessWorkspaceMetadata,
} from "./graphHarnessMetadata.js";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";

vi.setConfig({ testTimeout: 120_000 });

function fixtureRoot(fixtureName: string) {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
    "tests",
    "fixtures",
    "graph",
    fixtureName
  );
}

const HARNESS_FIXTURES = [
  "fixture-agentic-harness-good",
  "fixture-agentic-harness-missing",
  "fixture-agentic-harness-conflicting",
  "fixture-agentic-harness-noisy",
] as const;

const tempFixtureRoots: string[] = [];

afterEach(() => {
  for (const dir of tempFixtureRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function copyFixtureToTemp(fixtureName: string) {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), `oag-harness-${fixtureName}-`));
  tempFixtureRoots.push(destination);
  fs.cpSync(fixtureRoot(fixtureName), destination, { recursive: true });
  return destination;
}

describe("agentic harness fixtures", () => {
  it("scores the good harness fixture with verification commands and low noise", async () => {
    const root = fixtureRoot("fixture-agentic-harness-good");
    const scan = await runKernelWorkspaceScan(root);
    const metadata = loadHarnessWorkspaceMetadata(root);

    const readiness = evaluateHarnessReadiness(scan.unifiedGraph, { metadata });
    const verification = buildVerificationMap(scan.unifiedGraph, metadata);
    const noise = evaluateContextNoise(scan.unifiedGraph, {
      trackedGeneratedPaths: listHarnessTrackedGeneratedPaths(root, { graph: scan.unifiedGraph }),
      rootPlanFiles: listHarnessRootPlanFiles(root),
    });

    expect(readiness.score).toBeGreaterThanOrEqual(HARNESS_READINESS_GOOD_THRESHOLD);
    expect(readiness.ok).toBe(true);
    expect(verification.commands.some((entry) => entry.category === "install")).toBe(true);
    expect(verification.commands.some((entry) => entry.category === "build" && !entry.risky)).toBe(true);
    expect(verification.commands.some((entry) => entry.category === "unit_test" && !entry.risky)).toBe(true);
    expect(verification.commands.some((entry) => entry.category === "lint" && !entry.risky)).toBe(true);
    expect(verification.recommendedDefault.length).toBeGreaterThan(0);
    expect(verification.taskHints.some((hint) => hint.task === "run_unit_tests")).toBe(true);
    expect(verification.commands.every((entry) => entry.command.length > 0)).toBe(true);
    expect(noise.score).toBeGreaterThanOrEqual(80);

    const specQuality = evaluateGraphSpecQuality(scan.unifiedGraph, { metadata });
    expect(specQuality.score).toBeGreaterThanOrEqual(GRAPH_SPEC_QUALITY_GOOD_THRESHOLD);
    expect(specQuality.ok).toBe(true);
    expect(specQuality.present).toContain("README.md");
    expect(specQuality.present).toContain("AGENTS.md");
  });

  it("flags missing harness gaps in the sparse fixture", async () => {
    const root = fixtureRoot("fixture-agentic-harness-missing");
    const scan = await runKernelWorkspaceScan(root);
    const metadata = loadHarnessWorkspaceMetadata(root);
    const readiness = evaluateHarnessReadiness(scan.unifiedGraph, { metadata });

    expect(readiness.ok).toBe(false);
    expect(readiness.missing).toEqual(expect.arrayContaining([
      "setup_instructions",
      "test_instructions",
      "agent_instructions",
    ]));

    const specQuality = evaluateGraphSpecQuality(scan.unifiedGraph, { metadata });
    expect(specQuality.ok).toBe(false);
    expect(specQuality.missing).toEqual(expect.arrayContaining([
      "setup_instructions",
      "test_instructions",
      "agent_instructions",
      "contribution_docs",
    ]));
  });

  it("detects conflicting instructions in the conflicting fixture", async () => {
    const root = fixtureRoot("fixture-agentic-harness-conflicting");
    const scan = await runKernelWorkspaceScan(root);
    const metadata = loadHarnessWorkspaceMetadata(root);
    const readiness = evaluateHarnessReadiness(scan.unifiedGraph, { metadata });
    const verification = buildVerificationMap(scan.unifiedGraph, metadata);

    expect(readiness.conflicts.some((conflict) => conflict.kind === "test_command")).toBe(true);
    expect(readiness.conflicts.some((conflict) => conflict.kind === "agent_instructions")).toBe(true);
    expect(verification.conflicts.some((conflict) => conflict.category === "unit_test")).toBe(true);
    expect(readiness.ok).toBe(false);

    const specQuality = evaluateGraphSpecQuality(scan.unifiedGraph, { metadata });
    expect(specQuality.conflicts.some((conflict) => conflict.kind === "test_command")).toBe(true);
    expect(specQuality.conflicts.some((conflict) => conflict.kind === "agent_instructions")).toBe(true);
    expect(specQuality.ok).toBe(false);
  });

  it("detects generated, stale, and broken-doc noise with a lower score than good", async () => {
    const goodRoot = copyFixtureToTemp("fixture-agentic-harness-good");
    const noisyRoot = copyFixtureToTemp("fixture-agentic-harness-noisy");
    const goodScan = await runKernelWorkspaceScan(goodRoot);
    const noisyScan = await runKernelWorkspaceScan(noisyRoot);

    const goodNoise = evaluateContextNoise(goodScan.unifiedGraph, {
      trackedGeneratedPaths: listHarnessTrackedGeneratedPaths(goodRoot, { graph: goodScan.unifiedGraph }),
      rootPlanFiles: listHarnessRootPlanFiles(goodRoot),
    });
    const noisyNoise = evaluateContextNoise(noisyScan.unifiedGraph, {
      trackedGeneratedPaths: listHarnessTrackedGeneratedPaths(noisyRoot, { graph: noisyScan.unifiedGraph }),
      rootPlanFiles: listHarnessRootPlanFiles(noisyRoot),
    });

    expect(noisyNoise.score).toBeLessThan(goodNoise.score);
    expect(noisyNoise.noiseItems.some((item) => item.kind === "generated_artifact")).toBe(true);
    expect(noisyNoise.noiseItems.some((item) => item.kind === "stale_plan")).toBe(true);
    expect(noisyNoise.noiseItems.some((item) => item.kind === "broken_doc_link")).toBe(true);

    const noisySpec = evaluateGraphSpecQuality(noisyScan.unifiedGraph, {
      metadata: loadHarnessWorkspaceMetadata(noisyRoot),
    });
    const goodSpec = evaluateGraphSpecQuality(goodScan.unifiedGraph, {
      metadata: loadHarnessWorkspaceMetadata(goodRoot),
    });
    expect(noisySpec.score).toBeLessThan(goodSpec.score);
    expect(noisySpec.risks.some((risk) => /broken doc link/i.test(risk))).toBe(true);
  });

  it("builds verification maps for npm, python, and dotnet fixtures", async () => {
    const cases = [
      {
        fixture: "fixture-agentic-harness-good",
        assert: (verification: ReturnType<typeof buildVerificationMap>) => {
          expect(verification.commands.some((entry) => entry.category === "unit_test" && !entry.risky)).toBe(true);
          expect(verification.recommendedDefault.length).toBeGreaterThan(0);
        },
      },
      {
        fixture: "fixture-python-app",
        assert: (verification: ReturnType<typeof buildVerificationMap>) => {
          expect(verification.commands.some((entry) => entry.command === "pytest" && entry.confidence === "inferred")).toBe(true);
        },
      },
      {
        fixture: "fixture-csharp-wpf",
        assert: (verification: ReturnType<typeof buildVerificationMap>) => {
          expect(verification.commands.some((entry) => /dotnet (build|test)/i.test(entry.command) && entry.confidence === "inferred")).toBe(true);
        },
      },
    ] as const;

    for (const testCase of cases) {
      const root = fixtureRoot(testCase.fixture);
      const scan = await runKernelWorkspaceScan(root);
      const metadata = loadHarnessWorkspaceMetadata(root);
      const verification = buildVerificationMap(scan.unifiedGraph, metadata);
      testCase.assert(verification);
    }
  });

  it("scores agentic SDLC readiness with clear separation across harness fixtures", async () => {
    const cases = [
      { fixture: "fixture-agentic-harness-good", expectHigh: true },
      { fixture: "fixture-agentic-harness-missing", expectHigh: false },
      { fixture: "fixture-agentic-harness-conflicting", expectHigh: false },
      { fixture: "fixture-agentic-harness-noisy", expectHigh: false },
    ] as const;

    const scores: Array<{ fixture: string; overallScore: number }> = [];
    for (const testCase of cases) {
      const root = copyFixtureToTemp(testCase.fixture);
      const scan = await runKernelWorkspaceScan(root);
      const metadata = loadHarnessWorkspaceMetadata(root);
      const scorecard = buildAgenticSdlcScorecard({
        workspaceRoot: root,
        graph: scan.unifiedGraph,
        kernelProfile: scan.kernelProfile,
        metadata,
      });
      scores.push({ fixture: testCase.fixture, overallScore: scorecard.overallScore });
      if (testCase.expectHigh) {
        expect(scorecard.overallScore).toBeGreaterThanOrEqual(AGENTIC_SDLC_GOOD_THRESHOLD);
        expect(scorecard.ok).toBe(true);
      } else {
        expect(scorecard.overallScore).toBeLessThan(AGENTIC_SDLC_GOOD_THRESHOLD);
      }
      expect(scorecard.categories).toHaveLength(9);
    }

    const good = scores.find((entry) => entry.fixture === "fixture-agentic-harness-good")?.overallScore ?? 0;
    for (const entry of scores.filter((item) => item.fixture !== "fixture-agentic-harness-good")) {
      expect(entry.overallScore).toBeLessThan(good);
    }
  });

  it("loads real fixture files for every harness fixture", async () => {
    for (const fixture of HARNESS_FIXTURES) {
      const root = fixtureRoot(fixture);
      const metadata = loadHarnessWorkspaceMetadata(root);
      const scan = await runKernelWorkspaceScan(root);

      expect(metadata.readmeText?.length).toBeGreaterThan(0);
      expect(scan.unifiedGraph.nodes.length).toBeGreaterThan(0);
      expect(evaluateHarnessReadiness(scan.unifiedGraph, { metadata }).score).toBeGreaterThanOrEqual(0);
    }
  });
});