import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  buildScannerCommunityAssignments,
  evaluateCommunityReleaseGates,
  findGraphCommunityForNode,
  formatCommunityHubMarkdown,
  GRAPH_COMMUNITY_MAX_FILES,
  isGenericCommunityLabel,
} from "./graphCommunities.js";

describe("graph communities", () => {
  it("segments monorepo packages and splits oversized src blobs", () => {
    const files = [
      ...Array.from({ length: 40 }, (_, index) => ({
        filePath: `src/module-${index}.ts`,
        fileNodeId: `file:${index}`,
      })),
      { filePath: "packages/api/src/index.ts", fileNodeId: "file:api" },
      { filePath: "packages/shared/src/util.ts", fileNodeId: "file:shared" },
    ];

    const assignments = buildScannerCommunityAssignments({ files });
    expect(assignments.find((community) => community.key === "packages/api")).toBeTruthy();
    expect(assignments.find((community) => community.key === "packages/shared")).toBeTruthy();
    expect(assignments.filter((community) => community.key.startsWith("src/")).length).toBeGreaterThan(1);
    expect(assignments.every((community) => community.filePaths.length <= GRAPH_COMMUNITY_MAX_FILES)).toBe(true);
    expect(assignments.every((community) => community.summary.includes("Lens:"))).toBe(true);
  });

  it("groups files under root package.json into one project community", () => {
    const assignments = buildScannerCommunityAssignments({
      files: [
        { filePath: "package.json", fileNodeId: "file:pkg" },
        { filePath: "src/index.ts", fileNodeId: "file:index" },
        { filePath: "src/components/Button.tsx", fileNodeId: "file:button" },
      ],
    });

    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.key).toBe(".");
    expect(assignments[0]?.communityKind).toBe("project");
    expect(assignments[0]?.filePaths).toEqual(expect.arrayContaining([
      "package.json",
      "src/index.ts",
      "src/components/Button.tsx",
    ]));
  });

  it("groups go module files under root go.mod", () => {
    const assignments = buildScannerCommunityAssignments({
      files: [
        { filePath: "go.mod", fileNodeId: "file:mod" },
        { filePath: "cmd/server/main.go", fileNodeId: "file:main" },
        { filePath: "internal/service/service.go", fileNodeId: "file:svc" },
      ],
    });

    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.key).toBe(".");
    expect(assignments[0]?.title).toBe("go-module");
    expect(assignments[0]?.filePaths).toEqual(expect.arrayContaining([
      "go.mod",
      "cmd/server/main.go",
      "internal/service/service.go",
    ]));
  });

  it("groups python files under root pyproject.toml", () => {
    const assignments = buildScannerCommunityAssignments({
      files: [
        { filePath: "pyproject.toml", fileNodeId: "file:pyproject" },
        { filePath: "src/app/main.py", fileNodeId: "file:main" },
      ],
    });

    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.key).toBe(".");
    expect(assignments[0]?.title).toBe("python-project");
  });

  it("prefers nested project markers over root markers", () => {
    const assignments = buildScannerCommunityAssignments({
      files: [
        { filePath: "package.json", fileNodeId: "file:root-pkg" },
        { filePath: "src/index.ts", fileNodeId: "file:root-src" },
        { filePath: "packages/api/package.json", fileNodeId: "file:api-pkg" },
        { filePath: "packages/api/src/index.ts", fileNodeId: "file:api-src" },
      ],
    });

    expect(assignments.map((community) => community.key).sort()).toEqual([".", "packages/api"]);
    expect(assignments.find((community) => community.key === ".")?.filePaths).toEqual(["package.json", "src/index.ts"]);
    expect(assignments.find((community) => community.key === "packages/api")?.filePaths).toEqual([
      "packages/api/package.json",
      "packages/api/src/index.ts",
    ]);
  });

  it("resolves symbol communities through parent file membership", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["dotnet"],
      diagnostics: [],
      nodes: [
        { id: "file:vm", kind: "code_file", label: "ViewModels/MainViewModel.cs", path: "ViewModels/MainViewModel.cs" },
        { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
        {
          id: "comm:app",
          kind: "community",
          label: "SampleMediaPlayer.App",
          path: "SampleMediaPlayer.App",
          metadata: {
            scannerCommunityLabel: "SampleMediaPlayer.App",
            scannerCommunityFileCount: 2,
            scannerCommunitySummary: "App UI project.",
          },
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "sym:vm", targetNodeId: "file:vm", kind: "belongs_to", provenance: "extracted" },
        { id: "e2", sourceNodeId: "file:vm", targetNodeId: "comm:app", kind: "belongs_to", provenance: "extracted" },
      ],
    };

    expect(findGraphCommunityForNode(graph, "sym:vm")?.label).toBe("SampleMediaPlayer.App");
    expect(findGraphCommunityForNode(graph, "file:vm")?.label).toBe("SampleMediaPlayer.App");
  });

  it("groups dotnet fixture files by project directories", () => {
    const files = [
      { filePath: "SampleMediaPlayer.sln", fileNodeId: "file:sln", projectName: "SampleMediaPlayer" },
      { filePath: "SampleMediaPlayer.App/SampleMediaPlayer.App.csproj", fileNodeId: "file:app-csproj", projectName: "SampleMediaPlayer.App" },
      { filePath: "SampleMediaPlayer.App/ViewModels/MainViewModel.cs", fileNodeId: "file:vm", namespace: "SampleMediaPlayer.App.ViewModels", projectName: "SampleMediaPlayer.App" },
      { filePath: "SampleMediaPlayer.Core/SampleMediaPlayer.Core.csproj", fileNodeId: "file:core-csproj", projectName: "SampleMediaPlayer.Core" },
      { filePath: "SampleMediaPlayer.Core/Services/PlaybackService.cs", fileNodeId: "file:svc", namespace: "SampleMediaPlayer.Core.Services", projectName: "SampleMediaPlayer.Core" },
      { filePath: "SampleMediaPlayer.Tests/SampleMediaPlayer.Tests.csproj", fileNodeId: "file:test-csproj", projectName: "SampleMediaPlayer.Tests" },
      { filePath: "SampleMediaPlayer.Tests/MainViewModelTests.cs", fileNodeId: "file:test", namespace: "SampleMediaPlayer.Tests", projectName: "SampleMediaPlayer.Tests" },
    ];

    const assignments = buildScannerCommunityAssignments({ files });
    expect(assignments.map((community) => community.title).sort()).toEqual([
      "SampleMediaPlayer",
      "SampleMediaPlayer.App",
      "SampleMediaPlayer.Core",
      "SampleMediaPlayer.Tests tests",
    ]);
    expect(assignments.find((community) => community.title === "SampleMediaPlayer.App")?.taskLens).toBe("frontend");
    expect(assignments.find((community) => community.title === "SampleMediaPlayer.Core")?.taskLens).toBe("backend-runtime");
  });

  it("flags generic-only communities in release gates", () => {
    const graph: UnifiedCodeGraph = {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["typescript"],
      diagnostics: [],
      nodes: [
        ...Array.from({ length: 22 }, (_, index) => ({
          id: `file:${index}`,
          kind: "code_file" as const,
          label: `src/file-${index}.ts`,
          path: `src/file-${index}.ts`,
        })),
        {
          id: "comm:src",
          kind: "community" as const,
          label: "src",
          path: "src",
          metadata: {
            scannerCommunityLabel: "src",
            scannerCommunityKind: "directory",
            scannerCommunityFileCount: 22,
            scannerCommunitySummary: "src (directory, 22 files). Lens: backend-runtime.",
            scannerCommunityLens: "backend-runtime",
          },
        },
        {
          id: "comm:lib",
          kind: "community" as const,
          label: "lib",
          path: "lib",
          metadata: {
            scannerCommunityLabel: "lib",
            scannerCommunityKind: "directory",
            scannerCommunityFileCount: 1,
            scannerCommunitySummary: "lib (directory, 1 file). Lens: backend-runtime.",
            scannerCommunityLens: "backend-runtime",
          },
        },
      ],
      edges: [],
    };

    const result = evaluateCommunityReleaseGates(graph);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("meaningful communit"))).toBe(true);
    expect(result.errors.some((error) => error.includes("generic"))).toBe(true);
  });

  it("renders community hub markdown with summaries", () => {
    const lines = formatCommunityHubMarkdown([
      {
        id: "comm:app",
        label: "SampleMediaPlayer.App",
        path: "SampleMediaPlayer.App",
        fileCount: 8,
        summary: "UI project with view models.",
        topFiles: ["SampleMediaPlayer.App/ViewModels/MainViewModel.cs"],
        taskLens: "frontend",
      },
    ]);

    expect(lines[0]).toContain("**SampleMediaPlayer.App**");
    expect(lines[0]).toContain("UI project with view models.");
    expect(isGenericCommunityLabel("src")).toBe(true);
    expect(isGenericCommunityLabel("SampleMediaPlayer.App")).toBe(false);
  });
});