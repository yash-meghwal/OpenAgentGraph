import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyWorkspaceForBenchmark,
  shouldCopyWorkspaceEntry,
} from "./graphUpdateBenchmarkRunner.js";

const tempPaths: string[] = [];

function makeWorkspaceRoot() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oag-benchmark-copy-filter-"));
  tempPaths.push(workspaceRoot);
  return workspaceRoot;
}

afterEach(() => {
  for (const dir of tempPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("graph update benchmark workspace copy", () => {
  it("excludes OAG skipped dirs and secret/local artifacts from temp copies", () => {
    const sourceRoot = makeWorkspaceRoot();
    fs.mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "dist"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, ".venv", "lib"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "src", "App.cs"), "namespace App;\npublic class App {}\n", "utf8");
    fs.writeFileSync(path.join(sourceRoot, ".env"), "API_KEY=super-secret\n", "utf8");
    fs.writeFileSync(path.join(sourceRoot, "local.db.sqlite"), "sqlite-bytes", "utf8");
    fs.writeFileSync(path.join(sourceRoot, "dist", "bundle.js"), "console.log('build');\n", "utf8");
    fs.writeFileSync(path.join(sourceRoot, ".venv", "lib", "python"), "venv", "utf8");

    expect(shouldCopyWorkspaceEntry(sourceRoot, path.join(sourceRoot, "src", "App.cs"))).toBe(true);
    expect(shouldCopyWorkspaceEntry(sourceRoot, path.join(sourceRoot, ".env"))).toBe(false);
    expect(shouldCopyWorkspaceEntry(sourceRoot, path.join(sourceRoot, "local.db.sqlite"))).toBe(false);
    expect(shouldCopyWorkspaceEntry(sourceRoot, path.join(sourceRoot, "dist"))).toBe(false);
    expect(shouldCopyWorkspaceEntry(sourceRoot, path.join(sourceRoot, ".venv"))).toBe(false);

    const copiedRoot = copyWorkspaceForBenchmark(sourceRoot);
    tempPaths.push(copiedRoot);

    expect(fs.existsSync(path.join(copiedRoot, "src", "App.cs"))).toBe(true);
    expect(fs.existsSync(path.join(copiedRoot, ".env"))).toBe(false);
    expect(fs.existsSync(path.join(copiedRoot, "local.db.sqlite"))).toBe(false);
    expect(fs.existsSync(path.join(copiedRoot, "dist"))).toBe(false);
    expect(fs.existsSync(path.join(copiedRoot, ".venv"))).toBe(false);
  });
});