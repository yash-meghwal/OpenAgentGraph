import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { IgnoreEngine, parseIgnoreFileContent, patternMatchesScopedPath } from "./ignoreEngine.js";

const tempPaths: string[] = [];

function makeTempWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-ignore-"));
  tempPaths.push(workspaceRoot);
  return workspaceRoot;
}

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

describe("ignore engine", () => {
  afterEach(() => {
    for (const workspaceRoot of tempPaths.splice(0)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("parses gitignore negation and directory-only patterns", () => {
    const parsed = parseIgnoreFileContent({
      source: "gitignore",
      content: ["dist/", "!dist/keep.js", "/build", "*.log"].join("\n"),
      rootRelativePath: ".gitignore",
    });
    expect(parsed.rules).toHaveLength(4);
    expect(parsed.patterns.some((pattern) => pattern.negated)).toBe(true);
    expect(parsed.patterns.some((pattern) => pattern.directoriesOnly)).toBe(true);
  });

  it("skips global generated directories and oagignore paths", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, ".oagignore"), "artifacts/\n");
    writeFile(path.join(workspaceRoot, "src", "index.ts"), "export const ok = true;\n");
    writeFile(path.join(workspaceRoot, "artifacts", "bundle.js"), "export const built = true;\n");
    writeFile(path.join(workspaceRoot, "bin", "Release", "out.js"), "export const generated = true;\n");

    const engine = await IgnoreEngine.load(workspaceRoot);
    expect(engine.shouldSkip("bin", true)?.reason).toBe("global");
    expect(engine.shouldSkip("artifacts", true)?.reason).toBe("oagignore");
    expect(engine.shouldSkip("artifacts/bundle.js", false)?.reason).toBe("oagignore");
    expect(engine.shouldSkip("src/index.ts", false)).toBeNull();
  });

  it("honors nested gitignore files during directory traversal", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "package", ".gitignore"), "generated/\n");
    writeFile(path.join(workspaceRoot, "package", "src", "index.ts"), "export const ok = true;\n");
    writeFile(path.join(workspaceRoot, "package", "generated", "out.ts"), "export const built = true;\n");

    const engine = await IgnoreEngine.load(workspaceRoot);
    await engine.enterDirectory("package", path.join(workspaceRoot, "package"));

    expect(engine.shouldSkip("package/generated", true)?.reason).toBe("gitignore");
    expect(engine.shouldSkip("package/generated/out.ts", false)?.reason).toBe("gitignore");
    expect(engine.shouldSkip("package/src/index.ts", false)).toBeNull();
  });

  it("keeps OAG global skips ahead of gitignore negation", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, ".gitignore"), ["dist/", "!dist/keep.ts"].join("\n"));
    writeFile(path.join(workspaceRoot, "dist", "keep.ts"), "export const keep = true;\n");

    const engine = await IgnoreEngine.load(workspaceRoot);
    expect(engine.shouldSkip("dist/keep.ts", false)?.reason).toBe("global");
  });

  it("records skip diagnostics with bounded samples", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "obj", "cache.txt"), "generated\n");
    const engine = await IgnoreEngine.load(workspaceRoot);
    const counts = new Map();
    const diagnostics: Array<{ path: string }> = [];

    const decision = engine.shouldSkip("obj/cache.txt", false);
    expect(decision).not.toBeNull();
    engine.recordSkip(counts, diagnostics, { path: "obj/cache.txt", decision: decision! });

    expect(counts.get("global")).toBe(1);
    expect(diagnostics).toHaveLength(1);
    expect(engine.skippedCountsRecord(counts)).toEqual({ global: 1 });
  });

  it("matches scoped patterns relative to nested ignore directories", () => {
    const parsed = parseIgnoreFileContent({
      source: "gitignore",
      content: "generated/\n",
      rootRelativePath: "package/.gitignore",
      scopeDirectory: "package",
    });
    const pattern = parsed.patterns[0]!;
    expect(patternMatchesScopedPath(pattern, "package/generated/out.ts", false)).toBe(true);
    expect(patternMatchesScopedPath(pattern, "other/generated/out.ts", false)).toBe(false);
  });
});