import path from "path";
import { describe, expect, it } from "vitest";
import { runKernelWorkspaceScan } from "./scanKernel.js";

function fixtureRoot(...segments: string[]) {
  return path.resolve(process.cwd(), "..", "..", "tests", "fixtures", "graph", ...segments);
}

describe("scan kernel", () => {
  it("never indexes bin output in mixed dotnet/node fixtures", async () => {
    const result = await runKernelWorkspaceScan(fixtureRoot("mixed-dotnet-node"));
    const indexedPaths = result.scanPlan.nodes
      .filter((node) => node.kind === "code_file")
      .map((node) => node.title);
    expect(indexedPaths).toEqual(expect.arrayContaining([
      "App.sln",
      "src/App.cs",
      "web/index.ts",
    ]));
    expect(indexedPaths.some((title) => title.includes("bin/"))).toBe(false);
    expect(result.kernelProfile.activeScannerIds).toEqual(expect.arrayContaining(["dotnet", "typescript"]));
    expect(result.unifiedGraph.nodes.length).toBeGreaterThan(0);
  });

  it("honors nested package/.gitignore during workspace scans", async () => {
    const result = await runKernelWorkspaceScan(fixtureRoot("nested-gitignore"));
    const indexedPaths = result.scanPlan.nodes
      .filter((node) => node.kind === "code_file")
      .map((node) => node.title);
    expect(indexedPaths).toContain("package/src/index.ts");
    expect(indexedPaths.some((title) => title.includes("package/generated/"))).toBe(false);
    expect(result.scanPlan.summary.skippedCountsByReason?.gitignore ?? 0).toBeGreaterThan(0);
  });

  it("indexes python source files with the T1 ecosystem scanner", async () => {
    const result = await runKernelWorkspaceScan(fixtureRoot("fixture-python-app"));
    expect(result.kernelProfile.activeScannerIds).toEqual(expect.arrayContaining(["python"]));
    const indexedPaths = result.scanPlan.nodes
      .filter((node) => node.kind === "code_file")
      .map((node) => node.title);
    expect(indexedPaths).toContain("src/app.py");
  });

  it("records unsupported diagnostics for ruby source files", async () => {
    const result = await runKernelWorkspaceScan(fixtureRoot("unsupported-ruby"));
    expect(result.scanPlan.summary.skippedCountsByReason?.unsupported ?? 0).toBeGreaterThan(0);
    expect(result.scanPlan.summary.diagnostics.join("\n")).toContain("unsupported=");
  });

  it("respects gitignore dist output and records skip diagnostics", async () => {
    const result = await runKernelWorkspaceScan(fixtureRoot("gitignore-dist"));
    const indexedPaths = result.scanPlan.nodes
      .filter((node) => node.kind === "code_file")
      .map((node) => node.title);
    expect(indexedPaths).toContain("src/index.ts");
    expect(indexedPaths.some((title) => title.startsWith("generated/"))).toBe(false);
    expect(result.scanPlan.summary.skippedCountsByReason?.gitignore ?? 0).toBeGreaterThan(0);
  });
});