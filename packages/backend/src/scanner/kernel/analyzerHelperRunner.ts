import { spawn } from "child_process";
import path from "path";

const DISALLOWED_SHELL_WRAPPERS = new Set(["sh", "bash", "zsh", "fish", "cmd", "powershell", "pwsh"]);
const SHELL_COMMAND_STRING_FLAGS = new Set(["-c", "/c", "-Command", "-command"]);

export interface AnalyzerHelperLimits {
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export const DEFAULT_ANALYZER_HELPER_LIMITS: AnalyzerHelperLimits = {
  timeoutMs: 30_000,
  maxStdoutBytes: 2_000_000,
  maxStderrBytes: 256_000,
};

export interface AnalyzerHelperRunInput {
  command: string[];
  cwd?: string;
  workspaceRoot: string;
  stdinPayload?: unknown;
  limits?: Partial<AnalyzerHelperLimits>;
}

export interface AnalyzerHelperRunResult<T = unknown> {
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  parsed?: T;
  parseError?: string;
  durationMs: number;
  error?: string;
}

function normalizeExecutableName(executablePath: string) {
  return path.basename(executablePath).toLowerCase().replace(/\.(exe|cmd|bat)$/i, "");
}

export function validateAnalyzerArgv(command: string[]) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error("Analyzer helper command must be a non-empty argv array.");
  }
  const executable = normalizeExecutableName(command[0] ?? "");
  if (DISALLOWED_SHELL_WRAPPERS.has(executable)) {
    if (command.some((arg) => SHELL_COMMAND_STRING_FLAGS.has(arg))) {
      throw new Error("Shell command strings are not allowed; pass argv arrays only.");
    }
  }
  for (const arg of command) {
    if (typeof arg !== "string" || arg.length === 0) {
      throw new Error("Analyzer helper argv entries must be non-empty strings.");
    }
    if (arg.includes("\0")) {
      throw new Error("Analyzer helper argv entries must not contain NUL bytes.");
    }
  }
}

export function assertPathWithinWorkspace(workspaceRoot: string, candidatePath: string) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedCandidate = path.resolve(resolvedRoot, candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace boundary: ${candidatePath}`);
  }
}

export function validateAnalyzerHelperJson<T>(
  value: unknown,
  predicate: (value: unknown) => value is T
): { ok: true; value: T } | { ok: false; error: string } {
  if (value === null || typeof value !== "object") {
    return { ok: false, error: "Helper output must be a JSON object." };
  }
  if (!predicate(value)) {
    return { ok: false, error: "Helper output failed schema validation." };
  }
  return { ok: true, value };
}

function appendBounded(current: string, chunk: string, maxBytes: number) {
  if (current.length >= maxBytes) return current;
  const next = current + chunk;
  return next.length <= maxBytes ? next : next.slice(0, maxBytes);
}

export async function runAnalyzerHelper<T = unknown>(input: {
  run: AnalyzerHelperRunInput;
  parse?: (stdout: string) => { ok: true; value: T } | { ok: false; error: string };
}): Promise<AnalyzerHelperRunResult<T>> {
  const startedAt = Date.now();
  const limits = { ...DEFAULT_ANALYZER_HELPER_LIMITS, ...input.run.limits };
  validateAnalyzerArgv(input.run.command);
  if (input.run.cwd) {
    assertPathWithinWorkspace(input.run.workspaceRoot, input.run.cwd);
  }

  return new Promise<AnalyzerHelperRunResult<T>>((resolve) => {
    const child = spawn(input.run.command[0]!, input.run.command.slice(1), {
      cwd: input.run.cwd ? path.resolve(input.run.workspaceRoot, input.run.cwd) : input.run.workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: AnalyzerHelperRunResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        timedOut: true,
        exitCode: null,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        error: `Analyzer helper timed out after ${limits.timeoutMs}ms.`,
      });
    }, limits.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, String(chunk), limits.maxStdoutBytes);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, String(chunk), limits.maxStderrBytes);
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        timedOut: false,
        exitCode: null,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Analyzer helper failed to start.",
      });
    });
    child.on("close", (code) => {
      const durationMs = Date.now() - startedAt;
      if (code !== 0) {
        finish({
          ok: false,
          timedOut: false,
          exitCode: code,
          stdout,
          stderr,
          durationMs,
          error: stderr.trim() || `Analyzer helper exited with code ${code ?? "unknown"}.`,
        });
        return;
      }

      if (!input.parse) {
        finish({
          ok: true,
          timedOut: false,
          exitCode: code,
          stdout,
          stderr,
          durationMs,
        });
        return;
      }

      const parsed = input.parse(stdout);
      if (!parsed.ok) {
        finish({
          ok: false,
          timedOut: false,
          exitCode: code,
          stdout,
          stderr,
          durationMs,
          parseError: parsed.error,
          error: parsed.error,
        });
        return;
      }

      finish({
        ok: true,
        timedOut: false,
        exitCode: code,
        stdout,
        stderr,
        parsed: parsed.value,
        durationMs,
      });
    });

    if (input.run.stdinPayload !== undefined) {
      child.stdin.write(`${JSON.stringify(input.run.stdinPayload)}\n`);
    }
    child.stdin.end();
  });
}