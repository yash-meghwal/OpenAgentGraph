import { describe, expect, it } from "vitest";
import { augmentGameEngineStructuralLite } from "./gameEngineStructuralLite.js";

const stableId = (prefix: string, raw: string) => `${prefix}:${raw}`;
const compactMetadata = (values: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));

describe("game engine structural-lite", () => {
  it("emits Unity asmdef assembly_reference edges", () => {
    const files = [
      {
        relativePath: "Assets/Game.asmdef",
        body: JSON.stringify({ name: "Game", references: ["Shared.Runtime"] }),
      },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentGameEngineStructuralLite({
      activeScannerIds: ["unity"],
      scanId: "scan-unity",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "assembly_reference")).toBe(true);
  });

  it("resolves workspace asmdef references to indexed assembly files", () => {
    const files = [
      {
        relativePath: "Assets/Shared.Runtime.asmdef",
        body: JSON.stringify({ name: "Shared.Runtime", references: [] }),
      },
      {
        relativePath: "Assets/Game.asmdef",
        body: JSON.stringify({ name: "Game", references: ["Shared.Runtime"] }),
      },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentGameEngineStructuralLite({
      activeScannerIds: ["unity"],
      scanId: "scan-unity",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    const edge = semantic.edges.find((candidate) => candidate.metadata?.scannerAssemblyReference === "Shared.Runtime");
    expect(edge?.metadata?.scannerImportResolution).toBe("file");
    expect(edge?.targetNodeId).toBe(stableId("file", "Assets/Shared.Runtime.asmdef"));
  });

  it("emits extends edges for res:// script inheritance instead of scene_script", () => {
    const files = [
      { relativePath: "scripts/base.gd", body: "extends Node\n" },
      { relativePath: "scripts/player.gd", body: 'extends "res://scripts/base.gd"\n' },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentGameEngineStructuralLite({
      activeScannerIds: ["godot"],
      scanId: "scan-godot",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    const extendsEdge = semantic.edges.find((edge) =>
      edge.sourceNodeId === stableId("file", "scripts/player.gd")
      && edge.metadata?.scannerRelation === "extends"
    );
    expect(extendsEdge?.kind).toBe("extends");
    expect(extendsEdge?.metadata?.scannerImportResolution).toBe("file");
    expect(extendsEdge?.metadata?.scannerExtendsKind).toBe("resource_script");
    expect(extendsEdge?.targetNodeId).toBe(stableId("file", "scripts/base.gd"));
    expect(semantic.edges.some((edge) =>
      edge.sourceNodeId === stableId("file", "scripts/player.gd")
      && edge.metadata?.scannerRelation === "scene_script"
    )).toBe(false);
  });

  it("emits Godot autoload, main_scene, and scene_script edges", () => {
    const files = [
      {
        relativePath: "project.godot",
        body: [
          'run/main_scene="res://scenes/main.tscn"',
          "[autoload]",
          'GameManager="*res://scripts/game_manager.gd"',
        ].join("\n"),
      },
      {
        relativePath: "scripts/game_manager.gd",
        body: "extends Node\n",
      },
      {
        relativePath: "scenes/main.tscn",
        body: [
          '[ext_resource type="Script" path="res://scripts/player.gd" id="1"]',
          '[node name="Main" type="Node2D"]',
        ].join("\n"),
      },
      {
        relativePath: "scripts/player.gd",
        body: "extends CharacterBody2D\n",
      },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentGameEngineStructuralLite({
      activeScannerIds: ["godot"],
      scanId: "scan-godot",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "autoload")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "main_scene")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "scene_script")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "extends")).toBe(true);
  });

  it("emits Unreal module_dependency edges from uproject and Build.cs", () => {
    const files = [
      {
        relativePath: "Demo.uproject",
        body: JSON.stringify({ Modules: [{ Name: "Demo" }] }),
      },
      {
        relativePath: "Source/Demo/Demo.Build.cs",
        body: 'PublicDependencyModuleNames.AddRange(new string[] { "Core", "Engine" });',
      },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentGameEngineStructuralLite({
      activeScannerIds: ["unreal"],
      scanId: "scan-unreal",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    expect(semantic.edges.filter((edge) => edge.metadata?.scannerRelation === "module_dependency").length).toBeGreaterThanOrEqual(2);
  });

  it("resolves workspace unreal modules to indexed Build.cs files", () => {
    const files = [
      {
        relativePath: "Demo.uproject",
        body: JSON.stringify({ Modules: [{ Name: "Demo" }, { Name: "Shared" }] }),
      },
      {
        relativePath: "Source/Demo/Demo.Build.cs",
        body: [
          "public class Demo : ModuleRules",
          '{ PublicDependencyModuleNames.Add("Shared"); }',
        ].join("\n"),
      },
      {
        relativePath: "Source/Shared/Shared.Build.cs",
        body: "public class Shared : ModuleRules { }",
      },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentGameEngineStructuralLite({
      activeScannerIds: ["unreal"],
      scanId: "scan-unreal",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    const projectModuleEdge = semantic.edges.find((edge) => edge.metadata?.scannerUnrealModule === "Demo");
    expect(projectModuleEdge?.metadata?.scannerImportResolution).toBe("file");
    expect(projectModuleEdge?.targetNodeId).toBe(stableId("file", "Source/Demo/Demo.Build.cs"));

    const buildDependencyEdge = semantic.edges.find((edge) => edge.metadata?.scannerUnrealDependency === "Shared");
    expect(buildDependencyEdge?.metadata?.scannerImportResolution).toBe("file");
    expect(buildDependencyEdge?.targetNodeId).toBe(stableId("file", "Source/Shared/Shared.Build.cs"));
  });
});