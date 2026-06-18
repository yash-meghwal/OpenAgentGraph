import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTypeScriptSemanticHealthLine,
  scanMetadataToHealthInput,
  shouldReportTypeScriptSemanticHealth,
} from "@openagentgraph/shared";
import {
  BASE_SKIPPED_DIRECTORIES,
  DOTNET_T0_SCANNER_NOTICE,
  JAVA_KOTLIN_T15_SCANNER_NOTICE,
  PHP_T15_SCANNER_NOTICE,
  RUBY_T15_SCANNER_NOTICE,
  buildWorkspaceScanProfile,
  detectWorkspaceScanProfile,
  extractCSharpTopLevelSymbols,
  isSkippedDirectoryName,
  pathContainsSkippedDirectory,
  workspaceProfileToMetadata,
} from "./scannerHygiene.js";

const tempWorkspacePaths: string[] = [];

function makeTempWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-hygiene-"));
  tempWorkspacePaths.push(workspaceRoot);
  return workspaceRoot;
}

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

describe("scanner hygiene", () => {
  afterEach(() => {
    for (const workspaceRoot of tempWorkspacePaths.splice(0)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("skips common generated and cache directories", () => {
    expect(isSkippedDirectoryName("bin")).toBe(true);
    expect(isSkippedDirectoryName("obj")).toBe(true);
    expect(isSkippedDirectoryName("graphify-out")).toBe(true);
    expect(isSkippedDirectoryName("src")).toBe(false);
    expect(BASE_SKIPPED_DIRECTORIES).toEqual(expect.arrayContaining([
      "bin",
      "obj",
      "vendor",
      "target",
      "graphify-out",
      ".tmp-dogfood-data",
    ]));
    expect(isSkippedDirectoryName(".tmp-dogfood-data")).toBe(true);
    expect(pathContainsSkippedDirectory("src/app/bin/generated.js")).toBe(true);
  });

  it("extracts bounded C# top-level symbols without persisting bodies", () => {
    const symbols = extractCSharpTopLevelSymbols([
      "namespace Demo;",
      "public interface IPlayer { }",
      "public sealed record PlayerState(string Name);",
      "public class PlayerService { }",
      "internal struct FrameBuffer { }",
      "public enum PlaybackMode { Play, Pause }",
    ].join("\n"));

    expect(symbols).toEqual([
      { name: "IPlayer", symbolKind: "interface", line: 2 },
      { name: "PlayerState", symbolKind: "record", line: 3 },
      { name: "PlayerService", symbolKind: "class", line: 4 },
      { name: "FrameBuffer", symbolKind: "struct", line: 5 },
      { name: "PlaybackMode", symbolKind: "enum", line: 6 },
    ]);
  });

  it("detects dotnet and typescript workspace markers with extension census", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "SampleMediaPlayer.sln"), "Microsoft Visual Studio Solution File\n");
    writeFile(path.join(workspaceRoot, "src", "App.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>\n");
    writeFile(path.join(workspaceRoot, "src", "App.cs"), "public class App { }\n");
    writeFile(path.join(workspaceRoot, "web", "package.json"), "{ \"name\": \"web\" }\n");
    writeFile(path.join(workspaceRoot, "web", "tsconfig.json"), "{ \"compilerOptions\": {} }\n");
    writeFile(path.join(workspaceRoot, "bin", "Release", "lib.js"), "export const generated = true;\n");

    const profile = await detectWorkspaceScanProfile(workspaceRoot, {
      sourceExtensionCounts: new Map([
        [".cs", 1],
        [".ts", 4],
      ]),
      skippedDirectoryCounts: new Map([
        ["bin", 1],
        ["obj", 2],
      ]),
    });

    expect(profile.detectedProjectTypes).toEqual(expect.arrayContaining(["dotnet", "node", "typescript"]));
    expect(profile.markerPaths).toEqual(expect.arrayContaining([
      "SampleMediaPlayer.sln",
      "src/App.csproj",
      "web/package.json",
      "web/tsconfig.json",
    ]));
    expect(profile.sourceExtensionCounts).toMatchObject({ ".cs": 1, ".ts": 4 });
    expect(profile.skippedDirectoryCounts).toMatchObject({ bin: 1, obj: 2 });
    expect(profile.warnings).toContain(DOTNET_T0_SCANNER_NOTICE);
  });

  it("reports T1.5 semantic-lite wording for Java/Kotlin workspaces", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "pom.xml"), "<project></project>\n");
    writeFile(path.join(workspaceRoot, "src", "main", "java", "Main.java"), "public class Main {}\n");

    const profile = await detectWorkspaceScanProfile(workspaceRoot, {
      sourceExtensionCounts: new Map([[".java", 1]]),
      skippedDirectoryCounts: new Map(),
    });

    expect(profile.warnings).toContain(JAVA_KOTLIN_T15_SCANNER_NOTICE);
    expect(profile.warnings.join("\n")).not.toMatch(/T1 structural indexing.*javac\/kotlinc/i);
  });

  it("reports T1.5 semantic-lite wording for Ruby workspaces", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "Gemfile"), 'gem "rails"\n');
    writeFile(path.join(workspaceRoot, "app.rb"), "class App\nend\n");

    const profile = await detectWorkspaceScanProfile(workspaceRoot, {
      sourceExtensionCounts: new Map([[".rb", 1]]),
      skippedDirectoryCounts: new Map(),
    });

    expect(profile.warnings).toContain(RUBY_T15_SCANNER_NOTICE);
    expect(profile.warnings.join("\n")).not.toMatch(/T1 structural indexing.*runtime\/metaprogramming/i);
  });

  it("reports T1.5 semantic-lite wording for PHP workspaces", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeFile(path.join(workspaceRoot, "composer.json"), JSON.stringify({ name: "fixture/demo" }));
    writeFile(path.join(workspaceRoot, "src", "Main.php"), "<?php\nclass Main {}\n");

    const profile = await detectWorkspaceScanProfile(workspaceRoot, {
      sourceExtensionCounts: new Map([[".php", 1]]),
      skippedDirectoryCounts: new Map(),
    });

    expect(profile.warnings).toContain(PHP_T15_SCANNER_NOTICE);
    expect(profile.warnings.join("\n")).not.toMatch(/T1 structural indexing.*composer\/runtime/i);
  });

  it("serializes extension counts for handoff parsers that accept colon-form metadata", () => {
    const profile = buildWorkspaceScanProfile({
      markerPaths: ["web/package.json", "web/tsconfig.json"],
      detectedProjectTypes: new Set(["typescript"]),
      sourceExtensionCounts: new Map([
        [".tsx", 1],
        [".js", 1],
      ]),
      skippedDirectoryCounts: new Map(),
    });
    const metadata = workspaceProfileToMetadata(profile);

    expect(metadata.scannerSourceExtensionCounts).toBe(".js:1, .tsx:1");

    const healthInput = scanMetadataToHealthInput(metadata);
    expect(shouldReportTypeScriptSemanticHealth({
      sourceExtensionSummary: healthInput.scannerSourceExtensionCounts,
    })).toBe(true);
    expect(buildTypeScriptSemanticHealthLine({
      ...healthInput,
      scannerSemanticAnalysisEnabled: true,
      scannerSemanticAnalysisSucceeded: false,
      scannerSemanticFallbackReason: "No TypeScript project config covered scanned source files.",
    })).toContain("TypeScript semantic analysis: fallback");
  });
});