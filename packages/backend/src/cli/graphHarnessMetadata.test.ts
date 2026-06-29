import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listHarnessGitignoreMissingPatterns,
  listHarnessTrackedGeneratedPaths,
} from "./graphHarnessMetadata.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const dir of tempPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runGit(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function createTempGitWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oag-harness-git-"));
  tempPaths.push(root);
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "harness-test@example.com"]);
  runGit(root, ["config", "user.name", "Harness Test"]);
  return root;
}

describe("graphHarnessMetadata tracked generated paths", () => {
  it("ignores gitignored untracked generated artifacts on disk", () => {
    const root = createTempGitWorkspace();
    fs.writeFileSync(path.join(root, ".gitignore"), [
      "dist/",
      ".oag/",
      "OpenAgentGraphPro/",
    ].join("\n"));
    fs.writeFileSync(path.join(root, "README.md"), "# harness test\n");
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.mkdirSync(path.join(root, ".oag"), { recursive: true });
    fs.mkdirSync(path.join(root, "OpenAgentGraphPro"), { recursive: true });
    fs.writeFileSync(path.join(root, "dist", "bundle.js"), "console.log('ignored');\n");
    fs.writeFileSync(path.join(root, ".oag", "graph.json"), "{}\n");
    fs.writeFileSync(path.join(root, "OpenAgentGraphPro", "scratch.txt"), "ignored\n");

    runGit(root, ["add", ".gitignore", "README.md"]);
    runGit(root, ["commit", "-m", "initial"]);

    const tracked = listHarnessTrackedGeneratedPaths(root);
    expect(tracked).not.toContain("dist/bundle.js");
    expect(tracked).not.toContain(".oag/graph.json");
    expect(tracked).not.toContain("OpenAgentGraphPro/scratch.txt");
    expect(listHarnessGitignoreMissingPatterns(root)).not.toContain("dist/");
    expect(listHarnessGitignoreMissingPatterns(root)).not.toContain(".oag/");
  });

  it("reports force-tracked generated artifacts from git ls-files", () => {
    const root = createTempGitWorkspace();
    fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
    fs.writeFileSync(path.join(root, "README.md"), "# harness test\n");
    fs.writeFileSync(path.join(root, "GRAPH_REPORT.md"), "# tracked report\n");

    runGit(root, ["add", ".gitignore", "README.md"]);
    runGit(root, ["commit", "-m", "initial"]);
    runGit(root, ["add", "-f", "GRAPH_REPORT.md"]);
    runGit(root, ["commit", "-m", "track report"]);

    const tracked = listHarnessTrackedGeneratedPaths(root);
    expect(tracked).toContain("GRAPH_REPORT.md");
  });

  it("does not treat unrelated gitignore lines as covering dist/", () => {
    const root = createTempGitWorkspace();
    fs.writeFileSync(path.join(root, ".gitignore"), "webview-dist/\n");
    fs.writeFileSync(path.join(root, "README.md"), "# harness test\n");
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "dist", "bundle.js"), "console.log('tracked');\n");

    runGit(root, ["add", ".gitignore", "README.md"]);
    runGit(root, ["commit", "-m", "initial"]);
    runGit(root, ["add", "-f", "dist/bundle.js"]);
    runGit(root, ["commit", "-m", "track dist output"]);

    expect(listHarnessGitignoreMissingPatterns(root)).toContain("dist/");
  });

  it("scopes git ls-files to package workspace roots inside a parent repo", () => {
    const root = createTempGitWorkspace();
    const packageRoot = path.join(root, "packages", "backend");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
    fs.writeFileSync(path.join(root, "README.md"), "# mono\n");
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "backend" }, null, 2));
    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "dist", "app.js"), "console.log('ignored');\n");

    runGit(root, ["add", ".gitignore", "README.md", "packages/backend/package.json"]);
    runGit(root, ["commit", "-m", "initial"]);

    const tracked = listHarnessTrackedGeneratedPaths(packageRoot);
    expect(tracked).not.toContain("dist/app.js");
    expect(listHarnessGitignoreMissingPatterns(packageRoot)).not.toContain("dist/");
  });

  it("reports force-tracked generated artifacts relative to package workspace roots", () => {
    const root = createTempGitWorkspace();
    const packageRoot = path.join(root, "packages", "backend");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
    fs.writeFileSync(path.join(root, "README.md"), "# mono\n");
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "backend" }, null, 2));
    fs.writeFileSync(path.join(packageRoot, "GRAPH_REPORT.md"), "# pkg report\n");

    runGit(root, ["add", ".gitignore", "README.md", "packages/backend/package.json"]);
    runGit(root, ["commit", "-m", "initial"]);
    runGit(root, ["add", "-f", "packages/backend/GRAPH_REPORT.md"]);
    runGit(root, ["commit", "-m", "track pkg report"]);

    expect(listHarnessTrackedGeneratedPaths(packageRoot)).toContain("GRAPH_REPORT.md");

    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "dist", "tracked.js"), "module.exports = {};\n");
    runGit(root, ["add", "-f", "packages/backend/dist/tracked.js"]);
    runGit(root, ["commit", "-m", "track dist"]);

    expect(listHarnessTrackedGeneratedPaths(packageRoot)).toContain("dist/tracked.js");
    expect(listHarnessTrackedGeneratedPaths(packageRoot)).not.toContain("packages/backend/dist/tracked.js");
  });

  it("detects git worktrees where .git is a pointer file", () => {
    const root = createTempGitWorkspace();
    fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
    fs.writeFileSync(path.join(root, "README.md"), "# main\n");
    runGit(root, ["add", ".gitignore", "README.md"]);
    runGit(root, ["commit", "-m", "initial"]);

    const worktreePath = path.join(path.dirname(root), `oag-worktree-${Date.now()}`);
    tempPaths.push(worktreePath);
    runGit(root, ["worktree", "add", worktreePath, "HEAD"]);

    expect(fs.lstatSync(path.join(worktreePath, ".git")).isFile()).toBe(true);

    fs.mkdirSync(path.join(worktreePath, "dist"), { recursive: true });
    fs.writeFileSync(path.join(worktreePath, "dist", "bundle.js"), "console.log('ignored');\n");

    const tracked = listHarnessTrackedGeneratedPaths(worktreePath);
    expect(tracked).not.toContain("dist/bundle.js");
  });
});