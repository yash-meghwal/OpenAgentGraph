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
    expect(payload.fixtureCount).toBeGreaterThanOrEqual(15);
    expect(payload.results.map((result) => result.fixture)).toEqual(expect.arrayContaining([
      "mixed-dotnet-node",
      "wrapper-layout",
      "gitignore-dist",
      "empty-greenfield",
      "nested-gitignore",
      "fixture-python-app",
      "unsupported-ruby",
      "dockerignore-artifacts",
      "fixture-csharp-wpf",
      "fixture-next-app",
      "fixture-python-django",
      "fixture-go-module",
      "fixture-rust-workspace",
      "fixture-terraform",
      "fixture-docs-only",
    ]));
  });
});