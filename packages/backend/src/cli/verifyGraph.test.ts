import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { runVerifyGraphCli } from "./verifyGraph.js";

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

describe("verifyGraph cli", () => {
  it("passes all bundled graph fixtures", async () => {
    const payload = await runVerifyGraphCli([
      "--fixtures",
      path.join(repoRoot(), "tests", "fixtures", "graph"),
      "--json",
    ]);
    expect(payload.passed).toBe(true);
    expect(payload.fixtureCount).toBeGreaterThanOrEqual(48);
    expect(payload.results.map((result) => result.fixture)).toEqual(expect.arrayContaining([
      "mixed-dotnet-node",
      "wrapper-layout",
      "gitignore-dist",
      "empty-greenfield",
      "nested-gitignore",
      "fixture-python-app",
      "fixture-cpp-cmake",
      "fixture-swift-package",
      "fixture-unsupported-scala",
      "dockerignore-artifacts",
      "fixture-csharp-wpf",
      "fixture-csharp-media-player",
      "fixture-mixed-polyglot",
      "fixture-empty",
      "fixture-next-app",
      "fixture-python-django",
      "fixture-java-maven",
      "fixture-go-module",
      "fixture-rust-workspace",
      "fixture-terraform",
      "fixture-docs-only",
      "fixture-asset-heavy",
      "fixture-mixed-mobile-backend",
      "fixture-mixed-game-native",
      "fixture-php-symfony-lite",
      "fixture-ruby-sinatra-lite",
    ]));
    expect(payload.releaseGates.passed).toBe(true);
    expect(payload.releaseGates.agentBenchmarkSuccessRate).toBeGreaterThanOrEqual(0.8);
    expect(payload.releaseGates.querySuccessRate).toBeGreaterThanOrEqual(0.8);
    expect(payload.releaseGates.pathSuccessRate).toBeGreaterThanOrEqual(0.8);
    expect(payload.releaseGates.misleadingHandoffRate).toBe(0);
  }, 120_000);
});