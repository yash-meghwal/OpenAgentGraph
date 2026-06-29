import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  buildAgentHarnessReport,
  formatAgentHarnessReportMarkdown,
} from "./graphAgentHarnessReport.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-29T00:00:00.000Z",
    activeScannerIds: ["typescript"],
    diagnostics: [],
    nodes: [
      { id: "file:readme", kind: "doc_file", label: "README.md", path: "README.md" },
      { id: "file:agents", kind: "doc_file", label: "AGENTS.md", path: "AGENTS.md" },
      { id: "file:src", kind: "code_file", label: "src/index.ts", path: "src/index.ts" },
    ],
    edges: [],
  };
}

describe("graph agent harness report", () => {
  it("builds a harness summary with required sections and bounded output", () => {
    const summary = buildAgentHarnessReport({
      graph: makeGraph(),
      metadata: {
        readmeText: "# App\n\nRun `npm ci` and `npm test`.",
        packageScripts: { test: "vitest run", build: "tsc", publish: "npm publish" },
        agentInstructionTexts: {
          "AGENTS.md": "No provider key required for OAG scans.",
        },
      },
    });

    expect(summary.readBeforeCoding.length).toBeGreaterThan(0);
    expect(summary.verifyBeforeDone.length).toBeGreaterThan(0);
    expect(summary.guardrailCommands.some((entry) => entry.command === "npm run publish")).toBe(true);
    expect(summary.provenanceSummary.length).toBeGreaterThan(0);
    expect(summary.docsRepairSummary.length).toBeGreaterThan(0);
    expect(summary.analyzerLines.length).toBeGreaterThan(0);
  });

  it("formats all harness section headings without source bodies or secrets", () => {
    const summary = buildAgentHarnessReport({
      graph: makeGraph(),
      metadata: {
        readmeText: "# App\n\nRun `npm test`.",
        packageScripts: { test: "vitest run", build: "tsc" },
      },
    });
    const markdown = formatAgentHarnessReportMarkdown(summary).join("\n");

    expect(markdown).toContain("## Agentic SDLC harness");
    expect(markdown).toContain("### Read before coding");
    expect(markdown).toContain("### Verify before claiming done");
    expect(markdown).toContain("### Guardrails and risky commands");
    expect(markdown).toContain("### Missing or conflicting instructions");
    expect(markdown).toContain("### Context noise");
    expect(markdown).toContain("### Agent setup checklist");
    expect(markdown).not.toMatch(/sk-|BEGIN .*KEY/);
    expect(markdown).not.toContain("No provider key required for OAG scans.");
  });
});