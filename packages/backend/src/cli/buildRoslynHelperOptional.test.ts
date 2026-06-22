import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import {
  buildRoslynHelperProject,
  probeDotNetSdkForBuild,
  runOptionalRoslynHelperBuild,
} from "./buildRoslynHelperOptional.js";

describe("buildRoslynHelperOptional", () => {
  it("reports dotnet unavailable without throwing", () => {
    const spawn = vi.fn().mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "dotnet not found",
      error: undefined,
    });
    expect(probeDotNetSdkForBuild(spawn)).toEqual({
      available: false,
      reason: "dotnet not found",
    });
  });

  it("skips the Roslyn build when dotnet is unavailable", () => {
    const warnings: string[] = [];
    const spawn = vi.fn().mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "",
      error: undefined,
    });
    const result = runOptionalRoslynHelperBuild({
      warn: (message) => warnings.push(message),
      spawn,
    });
    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "dotnet CLI unavailable.",
    });
    expect(warnings.join(" ")).toMatch(/Skipping Roslyn helper build/i);
    expect(spawn).toHaveBeenCalledWith(
      "dotnet",
      ["--version"],
      expect.objectContaining({ timeout: 5_000 })
    );
  });

  it("builds Roslyn helper when dotnet is available", () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "8.0.100\n",
        stderr: "",
        error: undefined,
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
        stderr: "",
        error: undefined,
      });
    const result = runOptionalRoslynHelperBuild({ spawn });
    expect(result).toEqual({ ok: true, skipped: false });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1]?.[0]).toBe("dotnet");
    expect(spawn.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["build", expect.stringMatching(/RoslynHelper\.csproj$/), "-c", "Release"])
    );
  });

  it("returns build failure when dotnet exists but build fails", () => {
    const spawn = vi.fn().mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "Build FAILED.",
      error: undefined,
    });
    const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const result = buildRoslynHelperProject({ backendRoot }, spawn);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Build FAILED/i);
  });
});