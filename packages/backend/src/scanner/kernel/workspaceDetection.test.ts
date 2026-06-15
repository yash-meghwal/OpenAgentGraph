import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { detectWorkspaceKernelProfile } from "./workspaceDetection.js";

const tempPaths: string[] = [];

function makeTempWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-kernel-detect-"));
  tempPaths.push(workspaceRoot);
  return workspaceRoot;
}

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function fixtureRoot(...segments: string[]) {
  return path.resolve(process.cwd(), "..", "..", "tests", "fixtures", "graph", ...segments);
}

describe("workspace kernel detection", () => {
  afterEach(() => {
    for (const workspaceRoot of tempPaths.splice(0)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("detects wrapper layouts with nested project markers", async () => {
    const workspaceRoot = fixtureRoot("wrapper-layout", "outer");
    const profile = await detectWorkspaceKernelProfile(workspaceRoot);
    expect(profile.markerPaths).toEqual(expect.arrayContaining([
      "repo/App.sln",
      "repo/src/App.csproj",
    ]));
    expect(profile.warnings.join("\n")).toContain("Wrapper layout detected");
    expect(profile.sourceRoots).toEqual(expect.arrayContaining(["repo", "repo/src"]));
  });

  it("activates dotnet and typescript scanners for mixed repos", async () => {
    const workspaceRoot = fixtureRoot("mixed-dotnet-node");
    const profile = await detectWorkspaceKernelProfile(workspaceRoot, {
      sourceExtensionCounts: new Map([
        [".cs", 1],
        [".ts", 1],
      ]),
    });
    expect(profile.activeScannerIds).toEqual(expect.arrayContaining(["dotnet", "typescript"]));
    expect(profile.secondaryTypes).toEqual(expect.arrayContaining(["mixed-polyglot"]));
  });

  it("classifies empty greenfield workspaces honestly", async () => {
    const workspaceRoot = fixtureRoot("empty-greenfield");
    const profile = await detectWorkspaceKernelProfile(workspaceRoot);
    expect(profile.primaryType).toBe("empty-greenfield");
    expect(profile.activeScannerIds).toEqual(["generic"]);
  });

  it("ignores bin directories while discovering markers", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "App.sln"), "Microsoft Visual Studio Solution File\n");
    writeFile(path.join(workspaceRoot, "bin", "Release", "App.dll"), "binary\n");
    const profile = await detectWorkspaceKernelProfile(workspaceRoot);
    expect(profile.markerPaths).toEqual(["App.sln"]);
    expect(profile.markerPaths).not.toContain("bin/Release/App.dll");
  });
});