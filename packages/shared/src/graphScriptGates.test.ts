import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { evaluateScriptReleaseGates } from "./graphScriptGates.js";

function makeGraph(overrides: Partial<UnifiedCodeGraph> = {}): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: ".",
    generatedAt: "2026-06-18T00:00:00.000Z",
    nodes: [],
    edges: [],
    activeScannerIds: ["generic"],
    diagnostics: [],
    ...overrides,
  };
}

describe("graphScriptGates", () => {
  it("passes when script symbols and edges have endpoints", () => {
    const graph = makeGraph({
      nodes: [
        { id: "file:Scripts/Build.ps1", kind: "code_file", label: "Scripts/Build.ps1", path: "Scripts/Build.ps1" },
        {
          id: "symbol:Build-App",
          kind: "symbol",
          label: "Build-App (function)",
          path: "Scripts/Build.ps1",
          metadata: { scannerLanguage: "powershell", scannerSymbolKind: "function" },
        },
        {
          id: "external:dotnet",
          kind: "symbol",
          label: "dotnet build (command)",
          metadata: { scannerLanguage: "powershell", scannerRelation: "runs_command" },
        },
      ],
      edges: [
        {
          id: "edge:call",
          sourceNodeId: "symbol:Build-App",
          targetNodeId: "external:dotnet",
          kind: "references",
          provenance: "extracted",
          metadata: { scannerRelation: "runs_command" },
        },
      ],
    });
    const result = evaluateScriptReleaseGates(graph);
    expect(result.ok).toBe(true);
    expect(result.scriptSymbolCount).toBe(1);
  });

  it("fails when script files exist without function symbols", () => {
    const graph = makeGraph({
      nodes: [
        { id: "file:Scripts/Build.ps1", kind: "code_file", label: "Scripts/Build.ps1", path: "Scripts/Build.ps1" },
      ],
    });
    const result = evaluateScriptReleaseGates(graph);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("no script function"))).toBe(true);
  });

  it("fails when script edge endpoints are missing", () => {
    const graph = makeGraph({
      nodes: [
        { id: "file:Scripts/Build.ps1", kind: "code_file", label: "Scripts/Build.ps1", path: "Scripts/Build.ps1" },
        {
          id: "symbol:Build-App",
          kind: "symbol",
          label: "Build-App (function)",
          path: "Scripts/Build.ps1",
          metadata: { scannerLanguage: "powershell", scannerSymbolKind: "function" },
        },
      ],
      edges: [
        {
          id: "edge:broken",
          sourceNodeId: "symbol:Build-App",
          targetNodeId: "missing:target",
          kind: "references",
          provenance: "extracted",
          metadata: { scannerRelation: "calls" },
        },
      ],
    });
    const result = evaluateScriptReleaseGates(graph);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("missing an endpoint"))).toBe(true);
  });
});