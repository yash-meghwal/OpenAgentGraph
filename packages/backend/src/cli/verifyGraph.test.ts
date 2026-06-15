import path from "path";
import { describe, expect, it } from "vitest";
import { runVerifyGraphCli } from "./verifyGraph.js";

function repoRoot() {
  return path.resolve(process.cwd(), "..", "..");
}

describe("verifyGraph cli", () => {
  it("passes all bundled graph fixtures", async () => {
    const payload = await runVerifyGraphCli([
      "--fixtures",
      path.join(repoRoot(), "tests", "fixtures", "graph"),
      "--json",
    ]);
    expect(payload.passed).toBe(true);
    expect(payload.fixtureCount).toBeGreaterThanOrEqual(8);
    expect(payload.results.map((result) => result.fixture)).toEqual(expect.arrayContaining([
      "mixed-dotnet-node",
      "wrapper-layout",
      "gitignore-dist",
      "empty-greenfield",
      "nested-gitignore",
      "unsupported-python",
      "dockerignore-artifacts",
      "fixture-csharp-wpf",
    ]));
  });
});