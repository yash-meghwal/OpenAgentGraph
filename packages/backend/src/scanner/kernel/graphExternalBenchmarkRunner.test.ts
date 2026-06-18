import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupExternalBenchmarkWorkspace,
  cloneExternalBenchmarkRepository,
  EXTERNAL_BENCHMARK_CLONE_TIMEOUT_MS,
  validateExternalBenchmarkCloneUrl,
} from "./graphExternalBenchmarkRunner.js";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

const tempPaths: string[] = [];

afterEach(() => {
  vi.mocked(execFileSync).mockReset();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("graphExternalBenchmarkRunner", () => {
  it("accepts only http and https clone URLs", () => {
    expect(validateExternalBenchmarkCloneUrl("https://github.com/org/repo.git")).toBe(
      "https://github.com/org/repo.git"
    );
    expect(() => validateExternalBenchmarkCloneUrl("file:///etc/passwd")).toThrow(/http or https/i);
    expect(() => validateExternalBenchmarkCloneUrl("git@github.com:org/repo.git")).toThrow(/http or https/i);
  });

  it("clones with git -- separator and timeout, and cleans up on failure", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("clone failed");
    });
    const cloneUrl = "https://github.com/example/repo.git";
    expect(() => cloneExternalBenchmarkRepository(cloneUrl, { timeoutMs: 2500 })).toThrow(/clone failed/);
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["clone", "--depth", "1", "--", cloneUrl, expect.any(String)],
      expect.objectContaining({ timeout: 2500, stdio: "pipe" })
    );
    const tempRoot = vi.mocked(execFileSync).mock.calls[0]?.[2] as { cwd?: string } | string | undefined;
    const targetPath = Array.isArray(vi.mocked(execFileSync).mock.calls[0]?.[1])
      ? String((vi.mocked(execFileSync).mock.calls[0]?.[1] as string[])[4])
      : "";
    if (targetPath) {
      expect(fs.existsSync(targetPath)).toBe(false);
    }
    expect(tempRoot).toBeDefined();
  });

  it("uses the default clone timeout budget", () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
    const result = cloneExternalBenchmarkRepository("https://github.com/example/repo.git");
    tempPaths.push(result.tempRoot);
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      expect.any(Array),
      expect.objectContaining({ timeout: EXTERNAL_BENCHMARK_CLONE_TIMEOUT_MS })
    );
    expect(fs.existsSync(result.tempRoot)).toBe(true);
  });

  it("removes temporary checkout directories", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oag-external-benchmark-cleanup-"));
    tempPaths.push(tempRoot);
    fs.writeFileSync(path.join(tempRoot, "marker.txt"), "x");
    cleanupExternalBenchmarkWorkspace(tempRoot);
    tempPaths.pop();
    expect(fs.existsSync(tempRoot)).toBe(false);
  });
});