import path from "path";
import { describe, expect, it } from "vitest";
import {
  isResolvedDotNetRelationshipEdge,
  parseCSharpFile,
  parseCsprojFile,
  parseSolutionFile,
  parseXamlFile,
} from "./dotnetScanner.js";
import { probeRoslynHelperAvailability } from "./dotnetRoslynSemantic.js";
import { runKernelWorkspaceScan } from "./scanKernel.js";
import { scanWorkspaceCodebase } from "../codeScanner.js";

function fixtureRoot(...segments: string[]) {
  return path.resolve(process.cwd(), "..", "..", "tests", "fixtures", "graph", ...segments);
}

describe("dotnet scanner", () => {
  it("parses solution and csproj topology", () => {
    const solution = parseSolutionFile([
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "SampleMediaPlayer.App", "SampleMediaPlayer.App\\SampleMediaPlayer.App.csproj", "{11111111-1111-1111-1111-111111111111}"',
      "EndProject",
    ].join("\n"));
    expect(solution).toEqual([
      {
        name: "SampleMediaPlayer.App",
        path: "SampleMediaPlayer.App/SampleMediaPlayer.App.csproj",
        projectGuid: "11111111-1111-1111-1111-111111111111",
      },
    ]);

    const csproj = parseCsprojFile(
      `<Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup><TargetFramework>net8.0-windows</TargetFramework><UseWPF>true</UseWPF></PropertyGroup>
        <ItemGroup><ProjectReference Include="..\\SampleMediaPlayer.Core\\SampleMediaPlayer.Core.csproj" /></ItemGroup>
      </Project>`,
      "SampleMediaPlayer.App/SampleMediaPlayer.App.csproj"
    );
    expect(csproj.projectName).toBe("SampleMediaPlayer.App");
    expect(csproj.useWpf).toBe(true);
    expect(csproj.projectReferences).toContain("../SampleMediaPlayer.Core/SampleMediaPlayer.Core.csproj");
  });

  it("extracts namespaces, types, and members from csharp files", () => {
    const indexed = parseCSharpFile(
      [
        "using SampleMediaPlayer.Core.Services;",
        "namespace SampleMediaPlayer.App.ViewModels;",
        "public class MainViewModel",
        "{",
        "    public string Title { get; set; }",
        "    public void Play() { }",
        "}",
      ].join("\n"),
      "SampleMediaPlayer.App/ViewModels/MainViewModel.cs"
    );
    expect(indexed.namespace).toBe("SampleMediaPlayer.App.ViewModels");
    expect(indexed.usings).toContain("SampleMediaPlayer.Core.Services");
    expect(indexed.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual(
      expect.arrayContaining(["class:MainViewModel", "property:Title", "method:Play"])
    );
  });

  it("links xaml views to code-behind and inferred view models", () => {
    const xaml = parseXamlFile(
      '<Window x:Class="SampleMediaPlayer.App.Views.MainView" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" />',
      "SampleMediaPlayer.App/Views/MainView.xaml"
    );
    expect(xaml.xamlClass).toBe("SampleMediaPlayer.App.Views.MainView");
    expect(xaml.inferredViewModel).toBe("MainViewModel");
  });

  it("indexes SampleMediaPlayer-style fixture with project and symbol coverage", async () => {
    const result = await runKernelWorkspaceScan(fixtureRoot("fixture-csharp-wpf"));
    const nodesById = new Map(result.scanPlan.nodes.map((node) => [node.id, node]));
    const knownNodeIds = new Set(result.scanPlan.nodes.map((node) => node.id));
    const indexedPaths = result.scanPlan.nodes
      .filter((node) => node.kind === "code_file")
      .map((node) => node.title);
    const symbolTitles = result.scanPlan.nodes
      .filter((node) => node.kind === "code_symbol")
      .map((node) => node.title);

    expect(indexedPaths).toEqual(expect.arrayContaining([
      "SampleMediaPlayer.sln",
      "SampleMediaPlayer.App/SampleMediaPlayer.App.csproj",
      "SampleMediaPlayer.Core/SampleMediaPlayer.Core.csproj",
      "SampleMediaPlayer.Tests/SampleMediaPlayer.Tests.csproj",
      "SampleMediaPlayer.App/ViewModels/MainViewModel.cs",
      "SampleMediaPlayer.App/Views/MainView.xaml",
    ]));
    expect(indexedPaths.some((title) => title.includes("bin/"))).toBe(false);
    expect(symbolTitles).toEqual(expect.arrayContaining([
      "MainViewModel (class)",
      "MainViewModel.Play (method)",
      "PlaybackService (class)",
    ]));

    const edgeKinds = result.scanPlan.edges.map((edge) => edge.kind);
    expect(edgeKinds).toEqual(expect.arrayContaining(["depends_on", "uses"]));
    expect(result.scanPlan.summary.diagnostics.join("\n")).toContain("T0 structural indexing");

    const viewModelEdge = result.scanPlan.edges.find((edge) => edge.metadata?.scannerRelation === "view_viewmodel");
    expect(viewModelEdge).toBeDefined();
    const viewModelTarget = nodesById.get(viewModelEdge!.targetNodeId);
    expect(viewModelTarget?.kind).toBe("code_symbol");
    expect(viewModelTarget?.metadata?.scannerSymbolKind).toBe("class");
    expect(viewModelTarget?.metadata?.scannerSymbolName).toBe("MainViewModel");

    const testEdge = result.scanPlan.edges.find((edge) => edge.metadata?.scannerRelation === "test_target");
    expect(testEdge).toBeDefined();
    const testTarget = nodesById.get(testEdge!.targetNodeId);
    expect(testTarget?.metadata?.scannerSymbolKind).toBe("class");
    expect(testTarget?.metadata?.scannerSymbolName).toBe("MainViewModel");
    const testSource = nodesById.get(testEdge!.sourceNodeId);
    expect(testSource?.metadata?.scannerSymbolKind).toBe("class");
    expect(testSource?.metadata?.scannerSymbolName).toBe("MainViewModelTests");

    const danglingInternalEdges = result.scanPlan.edges.filter(
      (edge) => !isResolvedDotNetRelationshipEdge(edge, knownNodeIds)
    );
    expect(danglingInternalEdges).toEqual([]);

    const inheritsWindow = result.scanPlan.edges.find(
      (edge) => edge.metadata?.scannerRelation === "inherits" && edge.label?.includes("Window")
    );
    expect(inheritsWindow).toBeUndefined();
  });

  it("emits Roslyn semantic call edges when helper is available", async () => {
    const probe = await probeRoslynHelperAvailability();
    if (!probe.available) return;

    const result = await runKernelWorkspaceScan(fixtureRoot("fixture-csharp-wpf"));
    const semanticCalls = result.scanPlan.edges.filter(
      (edge) => edge.metadata?.scannerRelation === "semantic_calls"
    );
    expect(result.scanPlan.summary.diagnostics.join("\n")).toMatch(/C# semantic: enabled/i);
    expect(semanticCalls.length).toBeGreaterThan(0);

    const playCall = semanticCalls.find((edge) => edge.label?.includes("Play"));
    expect(playCall).toBeDefined();
    expect(playCall?.kind).toBe("uses");
  });

  it("keeps T0 scan successful when Roslyn helper is disabled", async () => {
    const result = await scanWorkspaceCodebase({
      workspaceRoot: fixtureRoot("fixture-csharp-wpf"),
      projection: {
        schemaVersion: "1",
        productGraphId: "test",
        nodes: [],
        edges: [],
        events: [],
        summary: {
          nodeCount: 0,
          edgeCount: 0,
          nodesByKind: {},
          edgesByKind: {},
          unresolvedOpenQuestionCount: 0,
          blockedTaskCount: 0,
        },
      },
      disableDotNetRoslynSemantic: true,
    });

    expect(result.summary.diagnostics.join("\n")).toMatch(/C# semantic: unavailable/i);
    expect(result.nodes.some((node) => node.title.includes("MainViewModel"))).toBe(true);
  });

  it("falls back to T0 when solution path is invalid", async () => {
    const probe = await probeRoslynHelperAvailability();
    if (!probe.available) return;

    const { runDotNetRoslynSemanticAnalysis } = await import("./dotnetRoslynSemantic.js");
    const { createDotNetSymbolLookup } = await import("./dotnetScanner.js");
    const result = await runDotNetRoslynSemanticAnalysis({
      workspaceRoot: fixtureRoot("fixture-csharp-wpf"),
      solutionPath: "Missing.sln",
      symbolLookup: createDotNetSymbolLookup(),
      knownNodeIds: new Set(),
      scanId: "invalid-sln",
      scannedAt: new Date().toISOString(),
      stableId: (prefix, raw) => `${prefix}:${raw}`,
      compactMetadata: (values) => values as Record<string, string>,
      sourceRef: (projectPath) => ({ kind: "code_scan", label: "Codebase scan", path: projectPath }),
      maxEdgeLabelLength: 180,
    });

    expect(result.succeeded).toBe(false);
    expect(result.fallbackReason).toMatch(/Solution not found/i);
  });

  it("rejects solution paths that escape the workspace", async () => {
    const probe = await probeRoslynHelperAvailability();
    if (!probe.available) return;

    const { runDotNetRoslynSemanticAnalysis } = await import("./dotnetRoslynSemantic.js");
    const { createDotNetSymbolLookup } = await import("./dotnetScanner.js");
    const result = await runDotNetRoslynSemanticAnalysis({
      workspaceRoot: fixtureRoot("fixture-csharp-wpf"),
      solutionPath: "../../../outside.sln",
      symbolLookup: createDotNetSymbolLookup(),
      knownNodeIds: new Set(),
      scanId: "escape-sln",
      scannedAt: new Date().toISOString(),
      stableId: (prefix, raw) => `${prefix}:${raw}`,
      compactMetadata: (values) => values as Record<string, string>,
      sourceRef: (projectPath) => ({ kind: "code_scan", label: "Codebase scan", path: projectPath }),
      maxEdgeLabelLength: 180,
    });

    expect(result.succeeded).toBe(false);
    expect(result.fallbackReason).toMatch(/Path escapes workspace/i);
  });

  it("does not emit dangling Roslyn semantic edges", async () => {
    const probe = await probeRoslynHelperAvailability();
    if (!probe.available) return;

    const result = await runKernelWorkspaceScan(fixtureRoot("fixture-csharp-wpf"));
    const knownNodeIds = new Set(result.scanPlan.nodes.map((node) => node.id));
    const danglingSemantic = result.scanPlan.edges.filter(
      (edge) =>
        typeof edge.metadata?.scannerRelation === "string"
        && edge.metadata.scannerRelation.startsWith("semantic_")
        && !isResolvedDotNetRelationshipEdge(edge, knownNodeIds)
    );
    expect(danglingSemantic).toEqual([]);
  });

  it("bounds Roslyn semantic output via helper limits", async () => {
    const probe = await probeRoslynHelperAvailability();
    if (!probe.available) return;

    const { runDotNetRoslynSemanticAnalysis } = await import("./dotnetRoslynSemantic.js");
    const { createDotNetSymbolLookup } = await import("./dotnetScanner.js");
    const result = await runDotNetRoslynSemanticAnalysis({
      workspaceRoot: fixtureRoot("fixture-csharp-wpf"),
      solutionPath: "SampleMediaPlayer.sln",
      symbolLookup: createDotNetSymbolLookup(),
      knownNodeIds: new Set(),
      scanId: "bound-test",
      scannedAt: new Date().toISOString(),
      stableId: (prefix, raw) => `${prefix}:${raw}`,
      compactMetadata: (values) => values as Record<string, string>,
      sourceRef: (projectPath) => ({ kind: "code_scan", label: "Codebase scan", path: projectPath }),
      maxEdgeLabelLength: 180,
      limits: { maxEdges: 0, maxDurationMs: 5_000, maxFiles: 50, maxOutputBytes: 2_000_000 },
    });

    expect(result.enabled).toBe(true);
    expect(result.edges).toEqual([]);
  });
});