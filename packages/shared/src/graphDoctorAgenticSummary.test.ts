import { describe, expect, it } from "vitest";
import {
  buildDoctorAgenticReadinessSummary,
  formatDoctorAgenticReadinessHuman,
  summarizeVerificationMapForDoctor,
} from "./graphDoctorAgenticSummary.js";
import type { GraphVerificationMap } from "./graphVerificationMap.js";

describe("graphDoctorAgenticSummary", () => {
  it("summarizes verification map categories for doctor output", () => {
    const map: GraphVerificationMap = {
      commands: [
        { command: "npm run build", category: "build", confidence: "script_defined", source: "package.json" },
        { command: "npm test", category: "unit_test", confidence: "script_defined", source: "package.json" },
        { command: "npm run lint", category: "lint", confidence: "script_defined", source: "package.json" },
      ],
      recommendedDefault: ["npm run build", "npm test"],
      taskHints: [],
      conflicts: [],
      gaps: [],
    };
    expect(summarizeVerificationMapForDoctor(map).summary).toBe("build/test/lint found");
  });

  it("formats compact human readiness lines", () => {
    const lines = formatDoctorAgenticReadinessHuman({
      overallScore: 82,
      ok: true,
      specQuality: { score: 88, label: "good", present: ["README.md"], missing: [] },
      verificationMap: {
        summary: "build/test/lint found",
        categoriesFound: ["build", "test", "lint"],
        recommendedDefaults: ["npm test"],
        gapCount: 0,
      },
      contextNoise: { score: 92, label: "low" },
      docsHealth: { brokenCount: 2, repairActionableCount: 1 },
      supportTiers: { summary: "semantic support available", structuralOnlyCount: 0, ecosystems: [] },
    });
    expect(lines[0]).toBe("Agentic readiness: 82/100");
    expect(lines[1]).toBe("Spec quality: good");
    expect(lines[2]).toBe("Verification map: build/test/lint found");
    expect(lines[3]).toBe("Context noise: low");
    expect(lines[4]).toBe("Docs health: 2 broken links");
  });

  it("builds readiness summary from a minimal graph", () => {
    const summary = buildDoctorAgenticReadinessSummary({
      workspaceRoot: "/workspace/demo",
      graph: {
        schemaVersion: "1",
        workspaceRoot: "/workspace/demo",
        generatedAt: "2026-06-29T00:00:00.000Z",
        activeScannerIds: ["generic"],
        diagnostics: [],
        nodes: [{ id: "file:0", kind: "doc_file", label: "README.md", path: "README.md" }],
        edges: [],
      },
    });
    expect(summary.overallScore).toBeGreaterThanOrEqual(0);
    expect(summary.overallScore).toBeLessThanOrEqual(100);
    expect(["good", "needs_attention"]).toContain(summary.specQuality.label);
    expect(summary.contextNoise.label).toBeDefined();
  });
});