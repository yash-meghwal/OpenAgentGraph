import { describe, expect, it } from "vitest";
import {
  augmentScriptWorkspaceGraph,
  indexScriptFile,
  parsePowerShellFile,
  parseScriptFile,
  parseShellFile,
  scriptMetadataContainsSecretValues,
} from "./scriptScanner.js";

const stableId = (prefix: string, raw: string) => `${prefix}:${raw}`;
const compactMetadata = (values: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<string, string>;
const sourceRef = (projectPath: string, line?: number) => ({ kind: "code_scan" as const, label: projectPath, path: projectPath, line });

describe("scriptScanner", () => {
  it("parses PowerShell functions, params, dot-sourcing, modules, and commands", () => {
    const body = [
      "param([string]$Configuration = \"Debug\")",
      "",
      "Import-Module BuildTools",
      "",
      "function Build-App {",
      "    dotnet build ../src/App.csproj -c $Configuration",
      "}",
      "",
      ". .\\Common.ps1",
      "Invoke-Build",
      "Write-Host \"done\"",
    ].join("\n");
    const parsed = parsePowerShellFile(body, "Scripts/Build.ps1");
    expect(parsed.symbols.map((symbol) => symbol.name)).toEqual(["Build-App"]);
    expect(parsed.paramNames).toEqual(["Configuration"]);
    expect(parsed.edges.some((edge) => edge.relation === "imports_module" && edge.target === "BuildTools")).toBe(true);
    expect(parsed.edges.some((edge) => edge.relation === "dot_sources")).toBe(true);
    expect(parsed.edges.some((edge) => edge.relation === "runs_command" && edge.target.startsWith("dotnet"))).toBe(true);
  });

  it("parses shell functions, sourced helpers, env vars, and commands", () => {
    const body = [
      "#!/bin/bash",
      "source ./helper.sh",
      "export DEPLOY_TOKEN=super-secret-token-value",
      "API_KEY=TEST_SECRET_PLACEHOLDER",
      "",
      "build_app() {",
      "  npm run build",
      "}",
      "",
      "docker compose up",
    ].join("\n");
    const parsed = parseShellFile(body, "scripts/build.sh");
    expect(parsed.symbols.map((symbol) => symbol.name)).toEqual(["build_app"]);
    expect(parsed.envVars.map((entry) => entry.name)).toEqual(["DEPLOY_TOKEN", "API_KEY"]);
    expect(parsed.edges.some((edge) => edge.relation === "dot_sources" && edge.target === "./helper.sh")).toBe(true);
    expect(parsed.edges.some((edge) => edge.relation === "runs_command" && edge.target === "npm run")).toBe(true);
    expect(parsed.edges.some((edge) => edge.relation === "runs_command" && edge.target === "docker compose")).toBe(true);
  });

  it("emits script function symbols and resolves cross-file dot-source/call edges", () => {
    const indexed = indexScriptFile({
      filePath: "Scripts/Build.ps1",
      body: "function Build-App { dotnet build }\n",
      fileNodeId: "file:Scripts/Build.ps1",
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      stableId,
      compactMetadata,
      sourceRef,
      maxTitleLength: 180,
      maxEdgeLabelLength: 180,
    });
    expect(indexed.symbolNodes).toHaveLength(1);
    expect(indexed.symbolNodes[0]?.metadata?.scannerSymbolKind).toBe("function");
    expect(indexed.fileMetadata.scannerScriptFunctionCount).toBe(1);

    const fileNodeIdsByPath = new Map<string, string>([
      ["Scripts/Build.ps1", "file:Scripts/Build.ps1"],
      ["Scripts/Test-App.ps1", "file:Scripts/Test-App.ps1"],
    ]);
    const augmented = augmentScriptWorkspaceGraph({
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      files: [
        {
          relativePath: "Scripts/Build.ps1",
          body: "function Build-App { dotnet build }\n",
        },
        {
          relativePath: "Scripts/Test-App.ps1",
          body: '& "$PSScriptRoot\\Build.ps1" -Configuration Debug\n',
        },
      ],
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 180,
      maxTitleLength: 180,
    });
    expect(augmented.edges.some((edge) => edge.metadata?.scannerRelation === "calls")).toBe(true);
    expect(augmented.edges.some((edge) => edge.metadata?.scannerRelation === "runs_command")).toBe(true);
    expect(augmented.externalNodes.some((node) => String(node.title).includes("dotnet"))).toBe(true);
  });

  it("records unresolved script references as diagnostics", () => {
    const augmented = augmentScriptWorkspaceGraph({
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      files: [
        {
          relativePath: "scripts/deploy.ps1",
          body: '. "$PSScriptRoot\\Missing.ps1"\n',
        },
      ],
      fileNodeIdsByPath: new Map([["scripts/deploy.ps1", "file:scripts/deploy.ps1"]]),
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 180,
      maxTitleLength: 180,
    });
    expect(augmented.diagnostics).toContain(
      "Unresolved script dot_sources in scripts/deploy.ps1: Missing.ps1"
    );
  });

  it("closes one-line PowerShell and shell functions before following top-level commands", () => {
    const powershell = parsePowerShellFile(
      "function Build-App { dotnet build }\nnode tools/run.js\n",
      "build.ps1"
    );
    const powershellDotnet = powershell.edges.find((edge) =>
      edge.relation === "runs_command" && edge.target.startsWith("dotnet"));
    const powershellNode = powershell.edges.find((edge) =>
      edge.relation === "runs_command" && edge.target.startsWith("node"));
    expect(powershellDotnet?.sourceSymbol).toBe("Build-App");
    expect(powershellNode?.sourceSymbol).toBeUndefined();

    const shell = parseShellFile("helper() { echo ok; }\nnpm run build\n", "build.sh");
    const shellNpm = shell.edges.find((edge) =>
      edge.relation === "runs_command" && edge.target === "npm run");
    expect(shellNpm?.sourceSymbol).toBeUndefined();
  });

  it("never stores secret env values in metadata", () => {
    const parsed = parseScriptFile(
      'export API_KEY=TEST_SECRET_PLACEHOLDER\n',
      "scripts/deploy.sh"
    );
    expect(parsed?.envVars.map((entry) => entry.name)).toEqual(["API_KEY"]);
    const indexed = indexScriptFile({
      filePath: "scripts/deploy.sh",
      body: 'export API_KEY=TEST_SECRET_PLACEHOLDER\n',
      fileNodeId: "file:scripts/deploy.sh",
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      stableId,
      compactMetadata,
      sourceRef,
      maxTitleLength: 180,
      maxEdgeLabelLength: 180,
    });
    expect(indexed.fileMetadata.scannerScriptEnvVars).toBe("API_KEY");
    expect(scriptMetadataContainsSecretValues(indexed.fileMetadata)).toBe(false);
    expect(JSON.stringify(indexed.fileMetadata)).not.toContain("TEST_SECRET_PLACEHOLDER");
  });
});
