import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { GraphAnalyzerAvailability } from "@openagentgraph/shared";

export function resolveRoslynHelperDllCandidates() {
  return [
    path.resolve(__dirname, "../../../scanner-tools/roslyn-helper/bin/Release/net8.0/RoslynHelper.dll"),
    path.resolve(__dirname, "../../../scanner-tools/roslyn-helper/bin/Debug/net8.0/RoslynHelper.dll"),
    path.resolve(process.cwd(), "packages/backend/scanner-tools/roslyn-helper/bin/Release/net8.0/RoslynHelper.dll"),
    path.resolve(process.cwd(), "scanner-tools/roslyn-helper/bin/Release/net8.0/RoslynHelper.dll"),
  ];
}

export async function findRoslynHelperDllPath() {
  for (const candidate of resolveRoslynHelperDllCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

export const DOTNET_ROSLYN_ANALYZER_ID = "dotnet-roslyn";
export const DEFAULT_ROSLYN_HELPER_BUILD_TIMEOUT_MS = 120_000;
const DOTNET_PROBE_TIMEOUT_MS = 5_000;

export function resolveRoslynHelperProjectPath() {
  return path.resolve(__dirname, "../../../scanner-tools/roslyn-helper/RoslynHelper.csproj");
}

export function buildRoslynAnalyzerAvailability(
  input: Partial<GraphAnalyzerAvailability> & Pick<GraphAnalyzerAvailability, "status">
): GraphAnalyzerAvailability {
  return {
    id: DOTNET_ROSLYN_ANALYZER_ID,
    label: "C# Roslyn semantic analyzer",
    requiredRuntime: ".NET SDK (dotnet CLI)",
    buildProbeCommand: "dotnet build scanner-tools/roslyn-helper/RoslynHelper.csproj -c Release",
    autoBuildCapable: true,
    ...input,
  };
}

export async function probeDotNetSdkAvailability() {
  return new Promise<{ available: boolean; reason?: string }>((resolve) => {
    const child = spawn("dotnet", ["--version"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (result: { available: boolean; reason?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ available: false, reason: "dotnet CLI probe timed out." });
    }, DOTNET_PROBE_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", () => finish({ available: false, reason: "dotnet CLI unavailable." }));
    child.on("close", (code) => {
      if (code === 0) finish({ available: true });
      else finish({ available: false, reason: stderr.trim() || "dotnet CLI unavailable." });
    });
  });
}

export async function buildRoslynHelper(input: { timeoutMs?: number } = {}) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_ROSLYN_HELPER_BUILD_TIMEOUT_MS;
  const projectPath = resolveRoslynHelperProjectPath();
  const startedAt = Date.now();

  try {
    await fs.access(projectPath);
  } catch {
    return {
      succeeded: false as const,
      durationMs: Date.now() - startedAt,
      reason: "Roslyn helper project file not found.",
    };
  }

  return new Promise<{
    succeeded: boolean;
    durationMs: number;
    reason?: string;
  }>((resolve) => {
    const child = spawn(
      "dotnet",
      ["build", projectPath, "-c", "Release", "--nologo", "-v", "q"],
      {
        cwd: path.dirname(projectPath),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: { succeeded: boolean; durationMs: number; reason?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        succeeded: false,
        durationMs: Date.now() - startedAt,
        reason: `Roslyn helper build timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish({
        succeeded: false,
        durationMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : "Roslyn helper build failed to start.",
      });
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish({ succeeded: true, durationMs: Date.now() - startedAt });
        return;
      }
      const detail = (stderr || stdout).trim().split("\n").filter(Boolean).slice(-3).join(" ");
      finish({
        succeeded: false,
        durationMs: Date.now() - startedAt,
        reason: detail || `Roslyn helper build exited with code ${code ?? "unknown"}.`,
      });
    });
  });
}

export async function ensureRoslynHelperPrepared(input: {
  autoBuild?: boolean;
  buildTimeoutMs?: number;
} = {}) {
  const autoBuild = input.autoBuild ?? true;
  const existingDll = await findRoslynHelperDllPath();
  if (existingDll) {
    const dotnet = await probeDotNetSdkAvailability();
    if (!dotnet.available) {
      return {
        availability: buildRoslynAnalyzerAvailability({
          status: "unavailable",
          fallbackReason: dotnet.reason ?? "dotnet CLI unavailable.",
        }),
      };
    }
    return {
      availability: buildRoslynAnalyzerAvailability({ status: "enabled" }),
      dllPath: existingDll,
    };
  }

  const dotnet = await probeDotNetSdkAvailability();
  if (!dotnet.available) {
    return {
      availability: buildRoslynAnalyzerAvailability({
        status: "unavailable",
        fallbackReason: dotnet.reason ?? "dotnet CLI unavailable.",
      }),
    };
  }

  if (!autoBuild) {
    return {
      availability: buildRoslynAnalyzerAvailability({
        status: "unavailable",
        fallbackReason: "Roslyn helper binary not built.",
      }),
    };
  }

  const build = await buildRoslynHelper({ timeoutMs: input.buildTimeoutMs });
  if (!build.succeeded) {
    return {
      availability: buildRoslynAnalyzerAvailability({
        status: "unavailable",
        fallbackReason: build.reason ?? "Roslyn helper build failed.",
        durationMs: build.durationMs,
      }),
    };
  }

  const dllPath = await findRoslynHelperDllPath();
  if (!dllPath) {
    return {
      availability: buildRoslynAnalyzerAvailability({
        status: "unavailable",
        fallbackReason: "Roslyn helper build completed but DLL was not found.",
        durationMs: build.durationMs,
      }),
    };
  }

  return {
    availability: buildRoslynAnalyzerAvailability({
      status: "enabled",
      preparedAt: new Date().toISOString(),
      durationMs: build.durationMs,
    }),
    dllPath,
  };
}