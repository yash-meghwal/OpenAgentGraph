import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectIgnoredGraphCliOptions,
  joinGraphCliPositionals,
  normalizeGraphCliText,
  normalizeWorkspaceCliPath,
  parseGraphWorkspaceArgv,
  requireWorkspaceOption,
} from "./graphWorkspace.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const dir of tempPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("graph workspace cli text normalization", () => {
  it("strips cmd.exe caret markers from quoted Windows argv fragments", () => {
    expect(normalizeGraphCliText("^MainViewModel^ playback^")).toBe("MainViewModel playback");
    expect(joinGraphCliPositionals(["^MainViewModel^", "playback^"])).toBe("MainViewModel playback");
  });

  it("leaves clean argv unchanged", () => {
    expect(normalizeGraphCliText("MainViewModel playback")).toBe("MainViewModel playback");
    expect(joinGraphCliPositionals(["MainViewModel", "playback"])).toBe("MainViewModel playback");
    expect(joinGraphCliPositionals(["MainViewModel playback"])).toBe("MainViewModel playback");
  });
});

describe("normalizeWorkspaceCliPath", () => {
  it("preserves interior spaces and drive-letter roots", () => {
    const windowsPath = "C:\\Users\\yashm\\Desktop\\Video Player\\repo";
    expect(normalizeWorkspaceCliPath(windowsPath)).toBe(windowsPath);
    expect(normalizeWorkspaceCliPath(`"${windowsPath}"`)).toBe(windowsPath);
  });

  it("preserves repeated interior whitespace in folder names", () => {
    const doubleSpacedPath = "C:\\Users\\yashm\\Video  Player\\repo";
    expect(normalizeWorkspaceCliPath(doubleSpacedPath)).toBe(doubleSpacedPath);
    expect(normalizeWorkspaceCliPath(`"${doubleSpacedPath}"`)).toBe(doubleSpacedPath);
    expect(normalizeWorkspaceCliPath(`  ${doubleSpacedPath}  `)).toBe(doubleSpacedPath);
  });

  it("strips surrounding quotes without altering UNC-style roots", () => {
    const uncPath = "\\\\server\\share\\repo with spaces";
    expect(normalizeWorkspaceCliPath(`'${uncPath}'`)).toBe(uncPath);
  });

  it("rejects empty workspace values", () => {
    expect(() => normalizeWorkspaceCliPath("   ")).toThrow("Workspace path is empty.");
    expect(() => normalizeWorkspaceCliPath('""')).toThrow("Workspace path is empty.");
  });
});

describe("parseGraphWorkspaceArgv", () => {
  it("parses quoted workspace paths with spaces", () => {
    const workspace = "C:\\Users\\yashm\\Desktop\\Video Player\\repo";
    const parsed = parseGraphWorkspaceArgv(["--workspace", `"${workspace}"`, "--json", "auth flow"]);
    expect(parsed.options.workspace).toBe(workspace);
    expect(parsed.options.json).toBe(true);
    expect(parsed.positionals).toEqual(["auth flow"]);
  });

  it("parses workspace paths with repeated interior spaces", () => {
    const workspace = "C:\\Users\\yashm\\Video  Player\\repo";
    const parsed = parseGraphWorkspaceArgv(["--workspace", workspace, "--json"]);
    expect(parsed.options.workspace).toBe(workspace);
  });

  it("parses relative workspace paths", () => {
    const relative = path.join("tests", "fixtures", "graph", "fixture-empty");
    const parsed = parseGraphWorkspaceArgv(["--workspace", relative, "--json"]);
    expect(parsed.options.workspace).toBe(relative);
  });

  it("requires a workspace value after --workspace", () => {
    expect(() => parseGraphWorkspaceArgv(["--workspace"])).toThrow("--workspace requires a value.");
    expect(() => parseGraphWorkspaceArgv(["--workspace", "--json"])).toThrow("--workspace requires a value.");
  });

  it("parses graph:path options alongside shared workspace flags", () => {
    const parsed = parseGraphWorkspaceArgv([
      "--workspace",
      "C:\\repo",
      "--json",
      "--lens",
      "frontend",
      "--max-hops",
      "3",
      "--explain-ranking",
      "from",
      "to target",
    ]);

    expect(parsed.options.lens).toBe("frontend");
    expect(parsed.options.maxHops).toBe(3);
    expect(parsed.options.explainRanking).toBe(true);
    expect(parsed.positionals).toEqual(["from", "to target"]);
  });
});

describe("collectIgnoredGraphCliOptions", () => {
  it("flags path-only options on non-path commands", () => {
    const parsed = parseGraphWorkspaceArgv([
      "--workspace",
      "C:\\repo",
      "--max-hops",
      "2",
      "--explain-ranking",
      "target",
    ]);
    const warnings = collectIgnoredGraphCliOptions("explain", parsed.options);
    expect(warnings).toContain("--max-hops is only used by graph:path; ignoring.");
    expect(warnings).toContain("--explain-ranking is only used by graph:path; ignoring.");
  });

  it("flags query-only options on graph:path", () => {
    const parsed = parseGraphWorkspaceArgv([
      "--workspace",
      "C:\\repo",
      "--dfs",
      "--budget",
      "12",
      "from",
      "to",
    ]);
    const warnings = collectIgnoredGraphCliOptions("path", parsed.options);
    expect(warnings).toContain("--dfs is only used by graph:query; ignoring.");
    expect(warnings).toContain("--budget is only used by graph:query; ignoring.");
  });
});

describe("requireWorkspaceOption", () => {
  it("resolves quoted Windows paths with spaces to absolute directories", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-cli-space-"));
    const spacedRoot = path.join(path.dirname(workspaceRoot), `${path.basename(workspaceRoot)} with spaces`);
    fs.renameSync(workspaceRoot, spacedRoot);
    tempPaths.push(spacedRoot);

    const quoted = `"${spacedRoot}"`;
    expect(requireWorkspaceOption(quoted)).toBe(path.resolve(spacedRoot));
  });

  it("resolves paths whose folder names contain repeated spaces", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-cli-double-space-"));
    const doubleSpacedRoot = path.join(path.dirname(workspaceRoot), "Video  Player");
    fs.renameSync(workspaceRoot, doubleSpacedRoot);
    tempPaths.push(doubleSpacedRoot);

    expect(requireWorkspaceOption(doubleSpacedRoot)).toBe(path.resolve(doubleSpacedRoot));
    expect(requireWorkspaceOption(`"${doubleSpacedRoot}"`)).toBe(path.resolve(doubleSpacedRoot));
  });

  it("fails clearly when workspace is missing", () => {
    expect(() => requireWorkspaceOption()).toThrow('Graph commands require --workspace "<absolute path>".');
  });
});