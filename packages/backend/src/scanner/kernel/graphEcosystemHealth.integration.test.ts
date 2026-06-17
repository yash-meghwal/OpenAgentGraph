import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { runKernelWorkspaceScan } from "./scanKernel.js";

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
}

function fixtureRoot(name: string) {
  return path.join(repoRoot(), "tests", "fixtures", "graph", name);
}

const TS_CONFIG_FAILURE = /No TypeScript project config/i;

describe("ecosystem-neutral scan diagnostics", () => {
  it.each([
    ["fixture-csharp-wpf", /\.NET solution\/project detected/i],
    ["fixture-docs-only", /Documentation corpus mode/i],
    ["fixture-java-maven", /Java\/Kotlin Maven or Gradle project detected/i],
    ["fixture-python-app", /Python project markers detected/i],
    ["fixture-empty", /Generic polyglot mode|generic/i],
  ])("scans %s without irrelevant TypeScript config failures", async (fixtureName, expectedPattern) => {
    const result = await runKernelWorkspaceScan(fixtureRoot(fixtureName));
    const diagnostics = result.unifiedGraph.diagnostics.join("\n");

    expect(diagnostics).not.toMatch(TS_CONFIG_FAILURE);
    expect(diagnostics).toMatch(expectedPattern);
    expect(result.unifiedGraph.analyzers?.length ?? 0).toBeGreaterThanOrEqual(0);
  }, 120_000);
});