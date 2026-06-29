import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { evaluateContextNoise } from "./graphContextNoise.js";

function makeGraph(paths: Array<{ path: string; fileSizeBytes?: number }>, diagnostics: string[] = []): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-26T00:00:00.000Z",
    activeScannerIds: ["generic"],
    diagnostics,
    nodes: paths.map((entry, index) => ({
      id: `file:${index}`,
      kind: entry.path.endsWith(".md") ? "doc_file" : "code_file",
      label: entry.path,
      path: entry.path,
      metadata: entry.fileSizeBytes ? { fileSizeBytes: entry.fileSizeBytes } : undefined,
    })),
    edges: [],
  };
}

describe("graph context noise", () => {
  it("scores clean repos higher than noisy repos", () => {
    const clean = evaluateContextNoise(makeGraph([
      { path: "README.md" },
      { path: "src/index.ts" },
      { path: "docs/architecture.md" },
    ]));

    const noisy = evaluateContextNoise(
      makeGraph([
        { path: "README.md" },
        { path: "build/output.js" },
        { path: "coverage/lcov.info" },
        { path: "PLAN-STALE-1.5.md" },
        { path: "large-noise.txt", fileSizeBytes: 64_000 },
      ], ["Broken doc link in README.md:12: missing.md"]),
      {
        trackedGeneratedPaths: ["build/output.js", "coverage/lcov.info"],
        rootPlanFiles: ["PLAN-STALE-1.5.md"],
        gitignoreMissingPatterns: ["dist/"],
      }
    );

    expect(clean.score).toBeGreaterThan(noisy.score);
    expect(noisy.noiseItems.some((item) => item.kind === "generated_artifact")).toBe(true);
    expect(noisy.noiseItems.some((item) => item.kind === "stale_plan")).toBe(true);
    expect(noisy.recommendations.length).toBeGreaterThan(0);
  });

  it("applies high-severity penalty to .oag generated artifacts", () => {
    const summary = evaluateContextNoise(makeGraph([{ path: ".oag/graph.json" }]));
    const item = summary.noiseItems.find((entry) => entry.path === ".oag/graph.json");
    expect(item?.severity).toBe("high");
    expect(summary.score).toBe(82);
  });

  it("counts broken documentation diagnostics as noise", () => {
    const summary = evaluateContextNoise(makeGraph([{ path: "README.md" }], [
      "Broken doc link in README.md:4: docs/missing.md",
      "Broken doc anchor in docs/guide.md:8: #ghost-section",
    ]));

    expect(summary.noiseItems.some((item) => item.kind === "broken_doc_link")).toBe(true);
    expect(summary.score).toBeLessThan(100);
  });

  it("flags contradictory instructions and generated source-like artifacts", () => {
    const paths = Array.from({ length: 14 }, (_, index) => ({ path: `src/file-${index}.ts` }));
    const summary = evaluateContextNoise(makeGraph([
      ...paths,
      { path: "generated/cache/app.js" },
      { path: "README.md" },
    ]), {
      instructionConflicts: ["AGENTS.md says vitest; CLAUDE.md says jest."],
      ecosystemLimitations: ["generic (T3): Honest file-level coverage for unrecognized layouts."],
    });

    expect(summary.noiseItems.some((item) => item.kind === "contradictory_instruction")).toBe(true);
    expect(summary.noiseItems.some((item) => item.kind === "generated_source_like")).toBe(true);
    expect(summary.noiseItems.some((item) => item.kind === "unsupported_ecosystem")).toBe(true);
    expect(summary.recommendations.length).toBeGreaterThan(0);
  });
});