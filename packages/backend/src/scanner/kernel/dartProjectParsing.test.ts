import { describe, expect, it } from "vitest";
import { parsePubspecYaml, resolveDartWorkspaceImport } from "./dartProjectParsing.js";

describe("dart project parsing", () => {
  it("parses pubspec package metadata and dependencies", () => {
    const pubspec = parsePubspecYaml([
      "name: demo_app",
      "dependencies:",
      "  flutter:",
      "    sdk: flutter",
      "  http: ^1.2.0",
      "dev_dependencies:",
      "  flutter_test:",
      "    sdk: flutter",
      "  mockito: ^5.4.0",
      "flutter:",
      "  uses-material-design: true",
    ].join("\n"));
    expect(pubspec.packageName).toBe("demo_app");
    expect(pubspec.isFlutter).toBe(true);
    expect(pubspec.dependencies).toEqual(expect.arrayContaining(["flutter", "http"]));
    expect(pubspec.devDependencies).toEqual(expect.arrayContaining(["flutter_test", "mockito"]));
  });

  it("resolves workspace package imports to lib paths", () => {
    const fileNodeIdsByPath = new Map([
      ["lib/services/api_service.dart", "file:api"],
    ]);
    const resolved = resolveDartWorkspaceImport(
      "package:demo_app/services/api_service.dart",
      "lib/main.dart",
      new Map([["demo_app", ""]]),
      fileNodeIdsByPath
    );
    expect(resolved?.targetNodeId).toBe("file:api");
  });

  it("resolves package imports relative to nested pubspec roots", () => {
    const fileNodeIdsByPath = new Map([
      ["lib/my_plugin.dart", "file:plugin"],
      ["example/lib/main.dart", "file:example-main"],
    ]);
    const resolved = resolveDartWorkspaceImport(
      "package:my_plugin/my_plugin.dart",
      "example/lib/main.dart",
      new Map([["my_plugin", ""]]),
      fileNodeIdsByPath
    );
    expect(resolved?.targetNodeId).toBe("file:plugin");
  });
});