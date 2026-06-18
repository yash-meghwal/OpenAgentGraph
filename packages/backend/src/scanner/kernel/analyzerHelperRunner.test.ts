import { EventEmitter } from "events";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

function mockSpawnOnce(input: {
  closeCode: number;
  stdout?: string;
  stderr?: string;
  error?: Error;
  delayMs?: number;
}) {
  spawnMock.mockImplementationOnce(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.kill = vi.fn();

    const emitClose = () => {
      if (input.error) {
        child.emit("error", input.error);
        return;
      }
      if (input.stdout) child.stdout.emit("data", input.stdout);
      if (input.stderr) child.stderr.emit("data", input.stderr);
      child.emit("close", input.closeCode);
    };

    if (input.delayMs && input.delayMs > 0) {
      setTimeout(emitClose, input.delayMs);
    } else {
      queueMicrotask(emitClose);
    }
    return child;
  });
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("analyzer helper runner", () => {
  it("allows path characters in argv because spawn uses shell: false", async () => {
    const { validateAnalyzerArgv } = await import("./analyzerHelperRunner.js");

    expect(() => validateAnalyzerArgv([
      "dotnet",
      "exec",
      String.raw`C:\Work\R&D\OpenAgentGraph\RoslynHelper.dll`,
    ])).not.toThrow();
    expect(() => validateAnalyzerArgv([
      "java",
      "-jar",
      "/opt/tools/$WORKSPACE/analyzer.jar",
    ])).not.toThrow();
    expect(() => validateAnalyzerArgv(["ruby", "/path/with|pipes/helper.rb"])).not.toThrow();
  });

  it("rejects shell command-string modes and invalid argv", async () => {
    const { validateAnalyzerArgv } = await import("./analyzerHelperRunner.js");

    expect(() => validateAnalyzerArgv(["bash", "-c", "echo hi"]))
      .toThrow(/argv arrays only/i);
    expect(() => validateAnalyzerArgv(["cmd.exe", "/c", "echo hi"]))
      .toThrow(/argv arrays only/i);
    expect(() => validateAnalyzerArgv(["powershell", "-Command", "Write-Host hi"]))
      .toThrow(/argv arrays only/i);
    expect(() => validateAnalyzerArgv([]))
      .toThrow(/non-empty argv array/i);
    expect(() => validateAnalyzerArgv(["dotnet", "exec", "helper\0.dll"]))
      .toThrow(/NUL bytes/i);
  });

  it("rejects cwd paths that escape the workspace boundary", async () => {
    const { assertPathWithinWorkspace } = await import("./analyzerHelperRunner.js");
    const workspaceRoot = path.resolve("/repo");

    expect(() => assertPathWithinWorkspace(workspaceRoot, "../outside"))
      .toThrow(/escapes workspace boundary/i);
    expect(() => assertPathWithinWorkspace(workspaceRoot, "src")).not.toThrow();
  });

  it("kills timed-out helpers and reports timeout", async () => {
    vi.useFakeTimers();
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write: vi.fn(), end: vi.fn() };
      child.kill = vi.fn();
      return child;
    });

    const { runAnalyzerHelper } = await import("./analyzerHelperRunner.js");
    const promise = runAnalyzerHelper({
      run: {
        command: ["dotnet", "exec", "helper.dll"],
        workspaceRoot: path.resolve("/repo"),
        limits: { timeoutMs: 50 },
      },
    });

    await vi.advanceTimersByTimeAsync(60);
    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    vi.useRealTimers();
  });

  it("falls back cleanly when helper JSON fails schema validation", async () => {
    mockSpawnOnce({ closeCode: 0, stdout: JSON.stringify({ status: "unexpected" }) });

    const { runAnalyzerHelper, validateAnalyzerHelperJson } = await import("./analyzerHelperRunner.js");
    const result = await runAnalyzerHelper({
      run: {
        command: ["dotnet", "exec", "helper.dll"],
        workspaceRoot: path.resolve("/repo"),
      },
      parse: (stdout) => validateAnalyzerHelperJson(
        JSON.parse(stdout),
        (value): value is { status: "ok" } => Boolean(value && typeof value === "object" && (value as { status?: string }).status === "ok")
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.parseError).toMatch(/schema validation/i);
  });

  it("bounds stdout and stderr capture", async () => {
    mockSpawnOnce({
      closeCode: 0,
      stdout: "x".repeat(10),
      stderr: "y".repeat(10),
    });

    const { runAnalyzerHelper } = await import("./analyzerHelperRunner.js");
    const result = await runAnalyzerHelper({
      run: {
        command: ["dotnet", "exec", "helper.dll"],
        workspaceRoot: path.resolve("/repo"),
        limits: { maxStdoutBytes: 4, maxStderrBytes: 3 },
      },
    });

    expect(result.stdout).toHaveLength(4);
    expect(result.stderr).toHaveLength(3);
    expect(result.ok).toBe(true);
  });
});