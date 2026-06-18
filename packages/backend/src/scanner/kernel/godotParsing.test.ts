import { describe, expect, it } from "vitest";
import { parseGdScript, parseGodotSceneAsset, parseUnityAsset, resolveGodotResourcePath } from "./godotParsing.js";

describe("godot parsing", () => {
  it("preserves res:// extends as extends_res imports", () => {
    const parsed = parseGdScript('extends "res://scripts/base.gd"', "scripts/player.gd");
    expect(parsed.imports).toContain("extends_res:res://scripts/base.gd");
    expect(parsed.imports).not.toContain("res:res://scripts/base.gd");
  });

  it("parses GDScript symbols, class_name, and extends imports", () => {
    const parsed = parseGdScript(
      [
        "extends CharacterBody2D",
        "class_name Player",
        "signal moved",
        "func move():",
        "    pass",
      ].join("\n"),
      "scripts/player.gd"
    );
    expect(parsed.symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining(["Player", "moved", "move"]));
    expect(parsed.imports).toContain("extends:CharacterBody2D");
  });

  it("parses Godot scene resources and nodes", () => {
    const parsed = parseGodotSceneAsset(
      [
        '[ext_resource type="Script" path="res://scripts/player.gd" id="1"]',
        '[node name="Main" type="Node2D"]',
        'script = ExtResource("1")',
      ].join("\n"),
      "scenes/main.tscn"
    );
    expect(parsed.imports).toContain("res:res://scripts/player.gd");
    expect(parsed.symbols.some((symbol) => symbol.name === "Main")).toBe(true);
    expect(parsed.configMetadata?.assetKind).toBe("scene");
  });

  it("parses Unity scene game objects", () => {
    const parsed = parseUnityAsset(
      [
        "GameObject:",
        "  m_Name: Main",
        "  m_Script: {fileID: 1}",
      ].join("\n"),
      "Assets/Scenes/Main.unity"
    );
    expect(parsed.symbols.some((symbol) => symbol.name === "Main")).toBe(true);
    expect(parsed.imports).toContain("unity_script_ref:unresolved");
  });

  it("resolves Godot resource paths to workspace files", () => {
    const fileNodeIdsByPath = new Map([
      ["scripts/player.gd", "file:player"],
    ]);
    const resolved = resolveGodotResourcePath("res://scripts/player.gd", fileNodeIdsByPath);
    expect(resolved?.targetNodeId).toBe("file:player");
  });
});