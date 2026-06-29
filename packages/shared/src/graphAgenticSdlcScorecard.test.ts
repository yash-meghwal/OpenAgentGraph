import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { buildAgenticSdlcScorecard } from "./graphAgenticSdlcScorecard.js";
import type { HarnessWorkspaceMetadata } from "./graphHarnessReadiness.js";

function makeGraph(paths: string[], diagnostics: string[] = []): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-29T00:00:00.000Z",
    activeScannerIds: ["typescript"],
    diagnostics,
    nodes: paths.map((entry, index) => ({
      id: `file:${index}`,
      kind: entry.endsWith(".md") ? "doc_file" : "code_file",
      label: entry,
      path: entry,
    })),
    edges: [
      {
        id: "edge:1",
        sourceNodeId: "file:0",
        targetNodeId: "file:1",
        kind: "references",
        provenance: "extracted",
        source: "typescript",
        confidence: 0.92,
      },
    ],
  };
}

const goodMetadata: HarnessWorkspaceMetadata = {
  readmeText: "# Demo\n\nInstall: npm ci\nTest: npm test\nBuild: npm run build\n",
  packageScripts: {
    test: "vitest run",
    build: "tsc -p tsconfig.json",
    lint: "eslint .",
    "verify:ci": "npm test && npm run build",
  },
  workflowTexts: {
    ".github/workflows/ci.yml": "jobs:\n  test:\n    steps:\n      - run: npm test\n",
  },
  agentInstructionTexts: {
    "AGENTS.md": "Run npm test before claiming done. No provider key required for OAG scans.",
  },
};

describe("graphAgenticSdlcScorecard", () => {
  it("scores a well-instrumented workspace higher than a sparse workspace", () => {
    const good = buildAgenticSdlcScorecard({
      workspaceRoot: "/workspace/good",
      graph: makeGraph([
        "README.md",
        "AGENTS.md",
        "docs/architecture.md",
        "src/index.ts",
        "package.json",
      ]),
      metadata: goodMetadata,
      handoffFreshness: {
        isStale: false,
        handoffPath: "GRAPH_REPORT.md",
        graphGeneratedAt: "2026-06-29T00:00:00.000Z",
        handoffUpdatedAt: "2026-06-29T00:00:00.000Z",
        detail: "GRAPH_REPORT.md is current relative to the latest code graph scan.",
      },
    });

    const sparse = buildAgenticSdlcScorecard({
      workspaceRoot: "/workspace/sparse",
      graph: makeGraph(["src/index.ts"]),
    });

    expect(good.overallScore).toBeGreaterThan(sparse.overallScore);
    expect(good.categories.find((category) => category.id === "spec_readiness")?.score)
      .toBeGreaterThan(sparse.categories.find((category) => category.id === "spec_readiness")?.score ?? 0);
    expect(good.categories.find((category) => category.id === "verification_readiness")?.score)
      .toBeGreaterThan(sparse.categories.find((category) => category.id === "verification_readiness")?.score ?? 0);
    expect(good.disclaimer).toMatch(/does not mean the code is correct/i);
    expect(good.deterministic).toBe(true);
  });

  it("lowers context and docs categories for noisy and conflicting harness signals", () => {
    const noisy = buildAgenticSdlcScorecard({
      workspaceRoot: "/workspace/noisy",
      graph: makeGraph([
        "README.md",
        "build/output.js",
        "coverage/lcov.info",
        "PLAN-STALE-1.5.md",
      ], ["Broken doc link in README.md:4: docs/missing.md"]),
      metadata: goodMetadata,
      contextNoise: {
        score: 41,
        noiseItems: [
          { kind: "generated_artifact", path: "build/output.js", detail: "Tracked generated artifact.", severity: "medium" },
          { kind: "broken_doc_link", detail: "1 broken documentation link(s) detected.", severity: "medium" },
        ],
        recommendations: ["Repair broken setup/architecture doc links before agent onboarding."],
      },
    });

    const conflicting = buildAgenticSdlcScorecard({
      workspaceRoot: "/workspace/conflicting",
      graph: makeGraph(["README.md", "AGENTS.md", "CLAUDE.md", "package.json"]),
      metadata: {
        readmeText: "# Demo\n\nTest with npm test\n",
        packageScripts: { test: "vitest run" },
        workflowTexts: {
          ".github/workflows/ci.yml": "run: yarn test\n",
        },
        agentInstructionTexts: {
          "AGENTS.md": "Use vitest for unit tests.",
          "CLAUDE.md": "Use jest for unit tests.",
        },
      },
    });

    expect(noisy.categories.find((category) => category.id === "context_readiness")?.score).toBeLessThan(70);
    expect(noisy.categories.find((category) => category.id === "docs_health")?.score).toBeLessThan(90);
    expect(conflicting.categories.find((category) => category.id === "spec_readiness")?.score).toBeLessThan(80);
    expect(conflicting.knownGaps.length).toBeGreaterThan(0);
  });

  it("exposes all required readiness categories", () => {
    const scorecard = buildAgenticSdlcScorecard({
      workspaceRoot: "/workspace",
      graph: makeGraph(["README.md", "src/index.ts"]),
      metadata: goodMetadata,
    });

    expect(scorecard.categories.map((category) => category.id)).toEqual([
      "graph_quality",
      "context_readiness",
      "spec_readiness",
      "verification_readiness",
      "docs_health",
      "support_tier_honesty",
      "provenance_coverage",
      "update_readiness",
      "install_package_readiness",
    ]);
  });
});