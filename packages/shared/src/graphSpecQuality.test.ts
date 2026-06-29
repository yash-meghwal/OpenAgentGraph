import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  evaluateGraphSpecQuality,
  extractHarnessReadmeCommands,
  formatGraphSpecQualityMarkdown,
  GRAPH_SPEC_QUALITY_GOOD_THRESHOLD,
} from "./graphSpecQuality.js";

function makeGraph(paths: string[], diagnostics: string[] = []): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-28T00:00:00.000Z",
    activeScannerIds: ["generic"],
    diagnostics,
    nodes: paths.map((filePath, index) => ({
      id: `file:${index}`,
      kind: filePath.endsWith(".md") ? "doc_file" : "code_file",
      label: filePath,
      path: filePath,
    })),
    edges: [],
  };
}

const goodMetadata = {
  readmeText: [
    "# Demo App",
    "## Setup",
    "Run `npm ci` before working.",
    "## Test",
    "Run `npm test` for unit tests.",
    "## Build",
    "```bash",
    "npm run build",
    "```",
  ].join("\n"),
  packageScripts: {
    build: "tsc",
    test: "vitest run",
    lint: "eslint .",
  },
  workflowTexts: {
    ".github/workflows/ci.yml": "steps:\n  - run: npm test\n",
  },
  agentInstructionTexts: {
    "AGENTS.md": "Run npm test and graph:check. No provider key required for OAG scans.",
  },
};

describe("graph spec quality", () => {
  it("scores complete harness docs highly", () => {
    const summary = evaluateGraphSpecQuality(
      makeGraph([
        "README.md",
        "AGENTS.md",
        "docs/architecture.md",
        "CONTRIBUTING.md",
      ]),
      { metadata: goodMetadata }
    );

    expect(summary.score).toBeGreaterThanOrEqual(GRAPH_SPEC_QUALITY_GOOD_THRESHOLD);
    expect(summary.ok).toBe(true);
    expect(summary.present).toContain("README.md");
    expect(summary.present).toContain("CONTRIBUTING.md");
    expect(summary.missing).not.toContain("no_provider_key_explanation");
    expect(summary.risks.some((risk) => /no-provider-key/i.test(risk))).toBe(false);
  });

  it("does not require no_provider_key_explanation when only agent instruction files are indexed", () => {
    const summary = evaluateGraphSpecQuality(
      makeGraph(["README.md", "AGENTS.md", "llms.txt", "CLAUDE.md"]),
      {
        metadata: {
          readmeText: "# App\n\n## Setup\nRun `npm ci`.\n## Test\nRun `npm test`.",
          packageScripts: { test: "vitest run" },
          agentInstructionTexts: {
            "AGENTS.md": "Run npm test before merging.",
            "llms.txt": "Project overview for agents.",
            "CLAUDE.md": "Use vitest for tests.",
          },
        },
      }
    );

    expect(summary.missing).not.toContain("no_provider_key_explanation");
    expect(summary.risks.some((risk) => /no-provider-key|provider key/i.test(risk))).toBe(false);
    expect(summary.present).not.toContain("no_provider_key_explanation");
  });

  it("requires no_provider_key_explanation when OAG artifacts are indexed without provider-key guidance", () => {
    const graphReportSummary = evaluateGraphSpecQuality(
      makeGraph(["README.md", "GRAPH_REPORT.md"]),
      {
        metadata: {
          readmeText: "# App\n\n## Setup\nRun `npm ci`.\n## Test\nRun `npm test`.",
          packageScripts: { test: "vitest run" },
        },
      }
    );

    expect(graphReportSummary.missing).toContain("no_provider_key_explanation");
    expect(graphReportSummary.risks.some((risk) => /no-provider-key|provider key/i.test(risk))).toBe(true);

    const oagDirSummary = evaluateGraphSpecQuality(
      makeGraph(["README.md", ".oag/graph.json"]),
      {
        metadata: {
          readmeText: "# App\n\n## Setup\nRun `npm ci`.\n## Test\nRun `npm test`.",
          packageScripts: { test: "vitest run" },
        },
      }
    );

    expect(oagDirSummary.missing).toContain("no_provider_key_explanation");
    expect(oagDirSummary.risks.some((risk) => /no-provider-key|provider key/i.test(risk))).toBe(true);
  });

  it("marks no_provider_key_explanation present when OAG artifacts are indexed with explicit guidance", () => {
    const summary = evaluateGraphSpecQuality(
      makeGraph(["README.md", "GRAPH_REPORT.md", "AGENTS.md"]),
      {
        metadata: {
          readmeText: "# App\n\n## Setup\nRun `npm ci`.\n## Test\nRun `npm test`.",
          packageScripts: { test: "vitest run" },
          agentInstructionTexts: {
            "AGENTS.md": "No provider key required for OAG scans, exports, or graph:check.",
          },
        },
      }
    );

    expect(summary.present).toContain("no_provider_key_explanation");
    expect(summary.missing).not.toContain("no_provider_key_explanation");
    expect(summary.risks.some((risk) => /no-provider-key|provider key/i.test(risk))).toBe(false);
  });

  it("flags sparse repos with actionable missing items", () => {
    const summary = evaluateGraphSpecQuality(
      makeGraph(["README.md", "src/index.ts"]),
      { metadata: { readmeText: "# App\n\nCode only." } }
    );

    expect(summary.ok).toBe(false);
    expect(summary.missing).toEqual(expect.arrayContaining([
      "setup_instructions",
      "test_instructions",
      "agent_instructions",
      "contribution_docs",
    ]));
    expect(summary.recommendations.length).toBeGreaterThan(0);
  });

  it("reports conflicting agent instructions and unsupported README commands", () => {
    const summary = evaluateGraphSpecQuality(
      makeGraph(["README.md", "AGENTS.md", "CLAUDE.md"]),
      {
        metadata: {
          readmeText: "Run `npm run test:unit` and `npm run deploy:prod` before merging.",
          packageScripts: { test: "npm run test:integration" },
          agentInstructionTexts: {
            "AGENTS.md": "Use vitest for tests.",
            "CLAUDE.md": "Use jest for tests.",
          },
        },
      }
    );

    expect(summary.conflicts.some((conflict) => conflict.kind === "agent_instructions")).toBe(true);
    expect(summary.risks.some((risk) => /unsupported script commands/i.test(risk))).toBe(true);
    expect(summary.ok).toBe(false);
  });

  it("detects broken setup docs and stale handoff risks", () => {
    const summary = evaluateGraphSpecQuality(
      makeGraph(["README.md", "GRAPH_REPORT.md"], [
        "Broken doc link in README.md:4: docs/missing-architecture.md",
      ]),
      { metadata: { readmeText: "# App\n\nSee docs/architecture.md." } }
    );

    expect(summary.risks.some((risk) => /broken doc link/i.test(risk))).toBe(true);
    expect(summary.risks.some((risk) => /GRAPH_REPORT\.md can go stale/i.test(risk))).toBe(true);
  });

  it("formats markdown without source bodies", () => {
    const markdown = formatGraphSpecQualityMarkdown({
      ok: true,
      score: 88,
      present: ["README.md"],
      missing: [],
      conflicts: [],
      risks: [],
      recommendations: ["Add CONTRIBUTING.md"],
    }).join("\n");

    expect(markdown).toContain("## Agentic SDLC spec quality");
    expect(markdown).toContain("### Recommended additions");
    expect(markdown).not.toMatch(/sk-|BEGIN .*KEY/);
  });

  it("extracts fenced README commands", () => {
    const commands = extractHarnessReadmeCommands([
      "Run `npm ci`",
      "```bash",
      "npm run lint",
      "npm test",
      "```",
    ].join("\n"));

    expect(commands).toEqual(expect.arrayContaining(["npm ci", "npm run lint", "npm test"]));
  });
});