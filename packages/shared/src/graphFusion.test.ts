import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph, WorkspaceKernelProfile } from "./codeGraph.js";
import {
  buildAgentCodeContextSlice,
  evaluateHandoffFreshness,
  evaluateOagFusionChecks,
  evaluateUnifiedGraphQualityGates,
  linkRunPathsToCodeNodes,
} from "./graphFusion.js";

function makeGraph(overrides: Partial<UnifiedCodeGraph> = {}): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-15T12:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      { id: "workspace", kind: "workspace", label: "workspace", metadata: { primaryType: "csharp-solution" } },
      { id: "file:vm", kind: "code_file", label: "ViewModels/MainViewModel.cs", path: "ViewModels/MainViewModel.cs" },
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
      { id: "file:svc", kind: "code_file", label: "Services/PlaybackService.cs", path: "Services/PlaybackService.cs" },
      { id: "sym:svc", kind: "symbol", label: "PlaybackService (class)", path: "Services/PlaybackService.cs" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "file:vm", targetNodeId: "sym:vm", kind: "declares", provenance: "extracted" },
      { id: "e2", sourceNodeId: "sym:vm", targetNodeId: "sym:svc", kind: "references", provenance: "inferred" },
    ],
    ...overrides,
  };
}

function makeProfile(overrides: Partial<WorkspaceKernelProfile> = {}): WorkspaceKernelProfile {
  return {
    schemaVersion: "1",
    root: "/workspace",
    effectiveRoots: ["/workspace"],
    primaryType: "csharp-solution",
    secondaryTypes: [],
    typeSignals: [],
    sourceRoots: ["."],
    markerPaths: ["App.sln"],
    activeScannerIds: ["dotnet"],
    ignoreRules: [],
    sourceExtensionCounts: { cs: 2 },
    skippedCountsByReason: {},
    warnings: [],
    ...overrides,
  };
}

describe("graph fusion", () => {
  it("flags stale handoff reports older than the graph scan", () => {
    const freshness = evaluateHandoffFreshness({
      graphGeneratedAt: "2026-06-15T12:00:00.000Z",
      handoffUpdatedAt: "2026-06-14T12:00:00.000Z",
      handoffPath: "GRAPH_REPORT.md",
    });

    expect(freshness.isStale).toBe(true);
    expect(freshness.detail).toContain("older than");
  });

  it("fails when a solution marker exists without indexed C# files", () => {
    const checks = evaluateUnifiedGraphQualityGates(
      makeGraph({ nodes: [{ id: "workspace", kind: "workspace", label: "workspace" }], edges: [] }),
      makeProfile()
    );

    expect(checks.some((check) => check.code === "marker_sln_without_csharp" && check.severity === "fail")).toBe(true);
  });

  it("warns on unsupported-language skip counts", () => {
    const checks = evaluateUnifiedGraphQualityGates(
      makeGraph(),
      makeProfile({ skippedCountsByReason: { unsupported: 3 } })
    );

    expect(checks.some((check) => check.code === "unsupported_language_risk")).toBe(true);
  });

  it("links run-touched paths to graph nodes", () => {
    const linked = linkRunPathsToCodeNodes(makeGraph(), ["ViewModels/MainViewModel.cs"]);
    expect(linked.map((node) => node.label)).toEqual(
      expect.arrayContaining(["ViewModels/MainViewModel.cs", "MainViewModel (class)"])
    );
  });

  it("builds a bounded agent code context slice with god nodes and focus nodes", () => {
    const slice = buildAgentCodeContextSlice(makeGraph(), {
      focusQuery: "MainViewModel playback",
      linkedRunPaths: ["Services/PlaybackService.cs"],
      nodeBudget: 6,
    });

    expect(slice.readTheseFirst.length).toBeGreaterThan(0);
    expect(slice.ecosystemSupport?.some((row) => row.scannerId === "dotnet" && row.tier === "T0")).toBe(true);
    expect(slice.godNodes.length).toBeGreaterThan(0);
    expect(slice.focusNodes.some((node) => /MainViewModel|PlaybackService/i.test(node.label))).toBe(true);
    expect(slice.linkedRunPaths).toEqual(["Services/PlaybackService.cs"]);
  });

  it("aggregates OAG fusion checks and fails on hard gate violations", () => {
    const result = evaluateOagFusionChecks({
      graph: makeGraph({ nodes: [{ id: "workspace", kind: "workspace", label: "workspace" }], edges: [] }),
      kernelProfile: makeProfile(),
      handoffFreshness: evaluateHandoffFreshness({
        graphGeneratedAt: "2026-06-15T12:00:00.000Z",
      }),
      previousSymbolCount: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.some((check) => check.code === "stale_handoff")).toBe(true);
    expect(result.checks.some((check) => check.code === "marker_sln_without_csharp")).toBe(true);
  });
});