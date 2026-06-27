import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, accessMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  accessMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("fs/promises", () => ({
  default: {
    access: accessMock,
  },
}));

function mockSpawnSequence(sequence: Array<{ closeCode: number; stdout?: string; stderr?: string; error?: Error }>) {
  for (const step of sequence) {
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        stdin: { end: ReturnType<typeof vi.fn> };
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin = { end: vi.fn() };
      queueMicrotask(() => {
        if (step.error) {
          child.emit("error", step.error);
          return;
        }
        if (step.stdout) child.stdout.emit("data", step.stdout);
        if (step.stderr) child.stderr.emit("data", step.stderr);
        child.emit("close", step.closeCode);
      });
      return child;
    });
  }
}

beforeEach(() => {
  spawnMock.mockReset();
  accessMock.mockReset();
});

afterEach(async () => {
  vi.clearAllMocks();
  const { resetRoslynHelperPreparedCache } = await import("./roslynHelperPreparation.js");
  resetRoslynHelperPreparedCache();
});

describe("roslyn helper preparation", () => {
  it("reports unavailable when dotnet SDK is missing and helper is not built", async () => {
    accessMock.mockRejectedValue(new Error("missing"));
    mockSpawnSequence([{ closeCode: 1, stderr: "dotnet not found" }]);

    const { ensureRoslynHelperPrepared } = await import("./roslynHelperPreparation.js");
    const result = await ensureRoslynHelperPrepared({ autoBuild: true });

    expect(result.availability.status).toBe("unavailable");
    expect(result.availability.fallbackReason).toMatch(/dotnet/i);
    expect(result.dllPath).toBeUndefined();
  });

  it("auto-builds the helper with argv-based dotnet build when DLL is missing", async () => {
    let helperBuilt = false;
    accessMock.mockImplementation(async (target) => {
      const value = String(target);
      if (value.endsWith("RoslynHelper.csproj")) return;
      if (value.endsWith("RoslynHelper.dll")) {
        if (!helperBuilt) throw new Error("missing");
        return;
      }
      throw new Error("missing");
    });

    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        stdin: { end: ReturnType<typeof vi.fn> };
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin = { end: vi.fn() };
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        stdin: { end: ReturnType<typeof vi.fn> };
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin = { end: vi.fn() };
      queueMicrotask(() => {
        helperBuilt = true;
        child.emit("close", 0);
      });
      return child;
    });

    const { ensureRoslynHelperPrepared } = await import("./roslynHelperPreparation.js");
    const result = await ensureRoslynHelperPrepared({ autoBuild: true });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[1]?.[0]).toBe("dotnet");
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["build", expect.stringMatching(/RoslynHelper\.csproj$/), "-c", "Release"]));
    expect(result.availability.status).toBe("enabled");
    expect(result.availability.preparedAt).toBeTruthy();
    expect(result.dllPath).toMatch(/RoslynHelper\.dll$/);
  });

  it("does not cache unavailable autoBuild:false results for a later autoBuild:true call", async () => {
    let helperBuilt = false;
    accessMock.mockImplementation(async (target) => {
      const value = String(target);
      if (value.endsWith("RoslynHelper.csproj")) return;
      if (value.endsWith("RoslynHelper.dll")) {
        if (!helperBuilt) throw new Error("missing");
        return;
      }
      throw new Error("missing");
    });

    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        stdin: { end: ReturnType<typeof vi.fn> };
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin = { end: vi.fn() };
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        stdin: { end: ReturnType<typeof vi.fn> };
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin = { end: vi.fn() };
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        stdin: { end: ReturnType<typeof vi.fn> };
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin = { end: vi.fn() };
      queueMicrotask(() => {
        helperBuilt = true;
        child.emit("close", 0);
      });
      return child;
    });

    const { ensureRoslynHelperPrepared } = await import("./roslynHelperPreparation.js");
    const unavailable = await ensureRoslynHelperPrepared({ autoBuild: false });
    const built = await ensureRoslynHelperPrepared({ autoBuild: true });

    expect(unavailable.availability.status).toBe("unavailable");
    expect(built.availability.status).toBe("enabled");
    expect(spawnMock.mock.calls.some((call) => call[1]?.includes("build"))).toBe(true);
  });

  it("reuses the prepared helper within the same process", async () => {
    accessMock.mockImplementation(async (target) => {
      const value = String(target);
      if (value.endsWith("RoslynHelper.dll")) return;
      throw new Error("missing");
    });
    mockSpawnSequence([{ closeCode: 0 }]);

    const { ensureRoslynHelperPrepared } = await import("./roslynHelperPreparation.js");
    const first = await ensureRoslynHelperPrepared({ autoBuild: false });
    const second = await ensureRoslynHelperPrepared({ autoBuild: false });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(first.dllPath).toBe(second.dllPath);
    expect(first.availability.status).toBe("enabled");
  });

  it("continues structurally when auto-build fails", async () => {
    accessMock.mockImplementation(async (target) => {
      if (String(target).endsWith("RoslynHelper.csproj")) return;
      throw new Error("missing");
    });

    mockSpawnSequence([
      { closeCode: 0 },
      { closeCode: 1, stderr: "Build FAILED." },
    ]);

    const { ensureRoslynHelperPrepared } = await import("./roslynHelperPreparation.js");
    const result = await ensureRoslynHelperPrepared({ autoBuild: true });

    expect(result.availability.status).toBe("unavailable");
    expect(result.availability.fallbackReason).toMatch(/Build FAILED|build/i);
  });
});