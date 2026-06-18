import { describe, expect, it } from "vitest";
import {
  parseAsmdef,
  parseGodotProject,
  parseUnrealBuildCs,
  parseUnrealProject,
} from "./gameEngineProjectParsing.js";

describe("game engine project parsing", () => {
  it("parses Unity asmdef references", () => {
    const parsed = parseAsmdef(JSON.stringify({
      name: "Game",
      references: ["UnityEngine", "Shared.Runtime"],
    }));
    expect(parsed.name).toBe("Game");
    expect(parsed.references).toEqual(["UnityEngine", "Shared.Runtime"]);
  });

  it("parses Godot project autoloads and main scene", () => {
    const parsed = parseGodotProject([
      'config/name="Demo Game"',
      'run/main_scene="res://scenes/main.tscn"',
      "",
      "[autoload]",
      'GameManager="*res://scripts/game_manager.gd"',
    ].join("\n"));
    expect(parsed.projectName).toBe("Demo Game");
    expect(parsed.mainScene).toBe("res://scenes/main.tscn");
    expect(parsed.autoloads).toEqual([
      { name: "GameManager", path: "res://scripts/game_manager.gd" },
    ]);
  });

  it("parses Unreal project modules and Build.cs dependencies", () => {
    const project = parseUnrealProject(JSON.stringify({
      Description: "Demo",
      Modules: [{ Name: "Demo" }],
    }));
    expect(project.modules).toEqual(["Demo"]);

    const build = parseUnrealBuildCs([
      "public class Demo : ModuleRules",
      "{",
      '  PublicDependencyModuleNames.AddRange(new string[] { "Core", "Engine" });',
      "}",
    ].join("\n"));
    expect(build.moduleName).toBe("Demo");
    expect(build.dependencies).toEqual(["Core", "Engine"]);
  });
});