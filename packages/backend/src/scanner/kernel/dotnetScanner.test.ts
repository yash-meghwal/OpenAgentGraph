import path from "path";
import { describe, expect, it } from "vitest";
import {
  isResolvedDotNetRelationshipEdge,
  parseCSharpFile,
  parseCsprojFile,
  parseSolutionFile,
  parseXamlFile,
} from "./dotnetScanner.js";
import { runKernelWorkspaceScan } from "./scanKernel.js";

function fixtureRoot(...segments: string[]) {
  return path.resolve(process.cwd(), "..", "..", "tests", "fixtures", "graph", ...segments);
}

describe("dotnet scanner", () => {
  it("parses solution and csproj topology", () => {
    const solution = parseSolutionFile([
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "OpenViewPlayer.App", "OpenViewPlayer.App\\OpenViewPlayer.App.csproj", "{11111111-1111-1111-1111-111111111111}"',
      "EndProject",
    ].join("\n"));
    expect(solution).toEqual([
      {
        name: "OpenViewPlayer.App",
        path: "OpenViewPlayer.App/OpenViewPlayer.App.csproj",
        projectGuid: "11111111-1111-1111-1111-111111111111",
      },
    ]);

    const csproj = parseCsprojFile(
      `<Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup><TargetFramework>net8.0-windows</TargetFramework><UseWPF>true</UseWPF></PropertyGroup>
        <ItemGroup><ProjectReference Include="..\\OpenViewPlayer.Core\\OpenViewPlayer.Core.csproj" /></ItemGroup>
      </Project>`,
      "OpenViewPlayer.App/OpenViewPlayer.App.csproj"
    );
    expect(csproj.projectName).toBe("OpenViewPlayer.App");
    expect(csproj.useWpf).toBe(true);
    expect(csproj.projectReferences).toContain("../OpenViewPlayer.Core/OpenViewPlayer.Core.csproj");
  });

  it("extracts namespaces, types, and members from csharp files", () => {
    const indexed = parseCSharpFile(
      [
        "using OpenViewPlayer.Core.Services;",
        "namespace OpenViewPlayer.App.ViewModels;",
        "public class MainViewModel",
        "{",
        "    public string Title { get; set; }",
        "    public void Play() { }",
        "}",
      ].join("\n"),
      "OpenViewPlayer.App/ViewModels/MainViewModel.cs"
    );
    expect(indexed.namespace).toBe("OpenViewPlayer.App.ViewModels");
    expect(indexed.usings).toContain("OpenViewPlayer.Core.Services");
    expect(indexed.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual(
      expect.arrayContaining(["class:MainViewModel", "property:Title", "method:Play"])
    );
  });

  it("links xaml views to code-behind and inferred view models", () => {
    const xaml = parseXamlFile(
      '<Window x:Class="OpenViewPlayer.App.Views.MainView" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" />',
      "OpenViewPlayer.App/Views/MainView.xaml"
    );
    expect(xaml.xamlClass).toBe("OpenViewPlayer.App.Views.MainView");
    expect(xaml.inferredViewModel).toBe("MainViewModel");
  });

  it("indexes OpenViewPlayer-style fixture with project and symbol coverage", async () => {
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
      "OpenViewPlayer.sln",
      "OpenViewPlayer.App/OpenViewPlayer.App.csproj",
      "OpenViewPlayer.Core/OpenViewPlayer.Core.csproj",
      "OpenViewPlayer.Tests/OpenViewPlayer.Tests.csproj",
      "OpenViewPlayer.App/ViewModels/MainViewModel.cs",
      "OpenViewPlayer.App/Views/MainView.xaml",
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
});