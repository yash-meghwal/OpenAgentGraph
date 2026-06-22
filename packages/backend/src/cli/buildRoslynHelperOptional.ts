import { spawnSync, type SpawnSyncReturns } from "child_process";
import path from "path";

export const DOTNET_PROBE_TIMEOUT_MS = 5_000;
export const ROSLYN_HELPER_BUILD_TIMEOUT_MS = 120_000;
export const ROSLYN_HELPER_PROJECT_RELATIVE = "scanner-tools/roslyn-helper/RoslynHelper.csproj";

export interface DotNetProbeResult {
  available: boolean;
  reason?: string;
  version?: string;
}

export interface RoslynHelperBuildResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  stdout?: string;
  stderr?: string;
  status?: number | null;
}

function resolveBackendPackageRoot() {
  return path.resolve(__dirname, "../..");
}

export function probeDotNetSdkForBuild(
  spawn: typeof spawnSync = spawnSync
): DotNetProbeResult {
  let result: SpawnSyncReturns<string>;
  try {
    result = spawn("dotnet", ["--version"], {
      encoding: "utf8",
      timeout: DOTNET_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      reason: message.includes("ENOENT") ? "dotnet CLI unavailable." : message,
    };
  }

  if (result.error) {
    const message = result.error.message;
    return {
      available: false,
      reason: message.includes("ENOENT") ? "dotnet CLI unavailable." : message,
    };
  }
  if (result.status !== 0) {
    return {
      available: false,
      reason: (result.stderr || "").trim() || "dotnet CLI unavailable.",
    };
  }

  return {
    available: true,
    version: (result.stdout || "").trim() || undefined,
  };
}

export function buildRoslynHelperProject(
  input: {
    backendRoot?: string;
    timeoutMs?: number;
  } = {},
  spawn: typeof spawnSync = spawnSync
): RoslynHelperBuildResult {
  const backendRoot = input.backendRoot ?? resolveBackendPackageRoot();
  const projectPath = path.join(backendRoot, ROSLYN_HELPER_PROJECT_RELATIVE);
  let result: SpawnSyncReturns<string>;
  try {
    result = spawn(
      "dotnet",
      ["build", projectPath, "-c", "Release", "--nologo", "-v", "q"],
      {
        cwd: backendRoot,
        encoding: "utf8",
        timeout: input.timeoutMs ?? ROSLYN_HELPER_BUILD_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  }

  if (result.error) {
    return { ok: false, reason: result.error.message, stderr: result.stderr, stdout: result.stdout };
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      reason: detail || "Roslyn helper build failed.",
      stderr: result.stderr,
      stdout: result.stdout,
      status: result.status,
    };
  }

  return { ok: true, stdout: result.stdout, stderr: result.stderr, status: result.status };
}

export function runOptionalRoslynHelperBuild(
  input: {
    backendRoot?: string;
    warn?: (message: string) => void;
    spawn?: typeof spawnSync;
  } = {}
): RoslynHelperBuildResult {
  const warn = input.warn ?? ((message: string) => console.warn(message));
  const spawn = input.spawn ?? spawnSync;
  const probe = probeDotNetSdkForBuild(spawn);
  if (!probe.available) {
    warn(
      `Skipping Roslyn helper build: ${probe.reason ?? "dotnet CLI unavailable."} `
        + "C# semantic edges will use structural fallback during verify:graph."
    );
    return { ok: true, skipped: true, reason: probe.reason };
  }

  const build = buildRoslynHelperProject({ backendRoot: input.backendRoot }, spawn);
  if (!build.ok) {
    return build;
  }
  return { ok: true, skipped: false };
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (
  !process.env.VITEST
  && /\/(?:src|dist)\/cli\/buildRoslynHelperOptional\.(?:ts|js)$/.test(invokedPath)
) {
  const result = runOptionalRoslynHelperBuild();
  if (!result.ok) {
    console.error(result.reason ?? "Roslyn helper build failed.");
    process.exit(1);
  }
  process.exit(0);
}