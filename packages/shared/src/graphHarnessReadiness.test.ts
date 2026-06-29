import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { evaluateHarnessReadiness, HARNESS_READINESS_GOOD_THRESHOLD } from "./graphHarnessReadiness.js";

function makeGraph(paths: string[]): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-26T00:00:00.000Z",
    activeScannerIds: ["generic"],
    diagnostics: [],
    nodes: paths.map((filePath, index) => ({
      id: `file:${index}`,
      kind: filePath.endsWith(".md") && filePath.startsWith("docs/")
        ? "doc_file"
        : filePath.endsWith(".json") || filePath.includes("workflows/")
          ? "config_file"
          : "code_file",
      label: filePath,
      path: filePath,
    })),
    edges: [],
  };
}

const goodMetadata = {
  readmeText: [
    "# Demo App",
    "",
    "## Setup",
    "Run `npm ci` before working.",
    "",
    "## Test",
    "Run `npm test` for unit tests.",
    "",
    "## Build",
    "Run `npm run build` for production build.",
  ].join("\n"),
  packageScripts: {
    build: "tsc",
    test: "vitest run",
    lint: "eslint .",
  },
  workflowTexts: {
    ".github/workflows/ci.yml": "jobs:\n  test:\n    steps:\n      - run: npm test\n",
  },
};

const conflictingMetadata = {
  readmeText: "Run `npm run test:unit` before claiming done.",
  packageScripts: {
    test: "npm run test:integration",
  },
  workflowTexts: {
    ".github/workflows/ci.yml": "run: npm test",
  },
  agentInstructionTexts: {
    "AGENTS.md": "Use vitest for tests.",
    "CLAUDE.md": "Use jest for tests.",
  },
};

describe("graph harness readiness", () => {
  it("scores the good harness fixture pattern highly", () => {
    const summary = evaluateHarnessReadiness(
      makeGraph([
        "README.md",
        "AGENTS.md",
        "llms.txt",
        "package.json",
        ".github/workflows/ci.yml",
        "docs/architecture.md",
        "src/index.ts",
      ]),
      { metadata: goodMetadata }
    );

    expect(summary.score).toBeGreaterThanOrEqual(HARNESS_READINESS_GOOD_THRESHOLD);
    expect(summary.ok).toBe(true);
    expect(summary.present).toContain("README.md");
    expect(summary.present).toContain("AGENTS.md");
    expect(summary.present).toContain("docs/architecture.md");
    expect(summary.missing).not.toContain("test_instructions");
  });

  it("scores the missing harness fixture pattern low with actionable gaps", () => {
    const summary = evaluateHarnessReadiness(
      makeGraph(["README.md", "package.json", "src/index.ts"]),
      { metadata: { readmeText: "# App\n\nSome code lives in src/." } }
    );

    expect(summary.score).toBeLessThan(HARNESS_READINESS_GOOD_THRESHOLD);
    expect(summary.ok).toBe(false);
    expect(summary.missing).toContain("test_instructions");
    expect(summary.missing).toContain("agent_instructions");
    expect(summary.recommendations.length).toBeGreaterThan(0);
  });

  it("reports conflicting test and agent instructions", () => {
    const summary = evaluateHarnessReadiness(
      makeGraph([
        "README.md",
        "AGENTS.md",
        "CLAUDE.md",
        "package.json",
        ".github/workflows/ci.yml",
        "src/index.ts",
      ]),
      { metadata: conflictingMetadata }
    );

    expect(summary.conflicts.some((conflict) => conflict.kind === "test_command")).toBe(true);
    expect(summary.conflicts.some((conflict) => conflict.kind === "agent_instructions")).toBe(true);
    expect(summary.ok).toBe(false);
  });
});