import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { buildGraphAnalyzerAvailability, type GraphAnalyzerAvailability } from "@openagentgraph/shared";
import { runAnalyzerHelper } from "./analyzerHelperRunner.js";

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
) {
  return buildGraphAnalyzerAvailability({
    ...input,
    id: input.id ?? DOTNET_ROSLYN_ANALYZER_ID,
    label: input.label ?? "C# Roslyn semantic analyzer",
    ecosystemId: input.ecosystemId ?? "dotnet",
    tierContribution: input.tierContribution ?? "T0",
    mode: input.mode ?? "semantic",
    requiredRuntime: input.requiredRuntime ?? ".NET SDK (dotnet CLI)",
    setupCommandHints: input.setupCommandHints ?? [
      "dotnet build packages/backend/scanner-tools/roslyn-helper/RoslynHelper.csproj -c Release",
    ],
    buildProbeCommand: input.buildProbeCommand ?? "dotnet build scanner-tools/roslyn-helper/RoslynHelper.csproj -c Release",
    autoBuildCapable: input.autoBuildCapable ?? true,
    timeoutMs: input.timeoutMs ?? 30_000,
    maxOutputBytes: input.maxOutputBytes ?? 2_000_000,
  });
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

  const projectDir = path.dirname(projectPath);
  const result = await runAnalyzerHelper({
    run: {
      command: ["dotnet", "build", projectPath, "-c", "Release", "--nologo", "-v", "q"],
      workspaceRoot: projectDir,
      limits: { timeoutMs },
    },
  });

  if (result.timedOut) {
    return {
      succeeded: false as const,
      durationMs: result.durationMs,
      reason: result.error ?? `Roslyn helper build timed out after ${timeoutMs}ms.`,
    };
  }
  if (result.ok) {
    return { succeeded: true as const, durationMs: result.durationMs };
  }

  const detail = (result.stderr || result.stdout).trim().split("\n").filter(Boolean).slice(-3).join(" ");
  return {
    succeeded: false as const,
    durationMs: result.durationMs,
    reason: detail || result.error || "Roslyn helper build failed.",
  };
}

let roslynHelperPreparedCache:
  | Awaited<ReturnType<typeof ensureRoslynHelperPreparedUncached>>
  | undefined;

export function resetRoslynHelperPreparedCache() {
  roslynHelperPreparedCache = undefined;
}

async function ensureRoslynHelperPreparedUncached(input: {
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

export async function ensureRoslynHelperPrepared(input: {
  autoBuild?: boolean;
  buildTimeoutMs?: number;
  forceRefresh?: boolean;
} = {}) {
  if (!input.forceRefresh && roslynHelperPreparedCache) {
    return roslynHelperPreparedCache;
  }
  const prepared = await ensureRoslynHelperPreparedUncached(input);
  if (prepared.availability.status === "enabled") {
    roslynHelperPreparedCache = prepared;
  }
  return prepared;
}