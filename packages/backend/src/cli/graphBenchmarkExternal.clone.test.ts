import path from "path";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClone = vi.hoisted(() => vi.fn());
const mockCleanup = vi.hoisted(() => vi.fn());

vi.mock("../scanner/kernel/graphExternalBenchmarkRunner.js", async () => {
  const actual = await vi.importActual<typeof import("../scanner/kernel/graphExternalBenchmarkRunner.js")>(
    "../scanner/kernel/graphExternalBenchmarkRunner.js"
  );
  return {
    ...actual,
    cloneExternalBenchmarkRepository: mockClone,
    cleanupExternalBenchmarkWorkspace: mockCleanup,
    resolveExternalBenchmarkWorkspace: (input: {
      workspaceRoot?: string;
      cloneUrl?: string;
      fixturesRoot: string;
    }) => {
      if (input.cloneUrl) {
        return mockClone(input.cloneUrl, {});
      }
      if (input.workspaceRoot) {
        return {
          workspaceRoot: path.resolve(input.workspaceRoot),
          sourceLabel: path.resolve(input.workspaceRoot),
        };
      }
      throw new Error("External benchmark requires --workspace, --clone, or --catalog.");
    },
  };
});

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

describe("graph:benchmark:external clone mode", () => {
  beforeEach(() => {
    mockClone.mockReset();
    mockCleanup.mockReset();
  });

  it("cleans up cloned workspaces after benchmark completion", async () => {
    const fakeTempRoot = path.join(repoRoot(), "tests", "fixtures", "graph", "fixture-next-app");
    const fakeCloneRoot = "/tmp/oag-external-benchmark-fake";
    mockClone.mockReturnValue({
      workspaceRoot: fakeTempRoot,
      tempRoot: fakeCloneRoot,
      sourceLabel: "https://github.com/example/repo.git",
    });

    const { runGraphBenchmarkExternalCli } = await import("./graphBenchmarkExternal.js");
    const payload = await runGraphBenchmarkExternalCli([
      "--clone",
      "https://github.com/example/repo.git",
      "--category",
      "typescript-web",
      "--json",
    ]);

    expect(payload.ok).toBe(true);
    expect(mockClone).toHaveBeenCalledWith("https://github.com/example/repo.git", expect.any(Object));
    expect(mockCleanup).toHaveBeenCalledWith(fakeCloneRoot);
  });
});