import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { buildAgentHarnessReport } from "./graphAgentHarnessReport.js";
import { renderUnifiedGraphHandoffReport, renderUnifiedGraphWiki } from "./graphArtifacts.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: ["dotnet scanner is file-level only for some constructs."],
    nodes: [
      { id: "workspace", kind: "workspace", label: "workspace", metadata: { primaryType: "dotnet" } },
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
      { id: "file:cs", kind: "code_file", label: "ViewModels/MainViewModel.cs", path: "ViewModels/MainViewModel.cs" },
      { id: "comm:ui", kind: "community", label: "ui", path: "SampleMediaPlayer.App" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "file:cs", targetNodeId: "sym:vm", kind: "declares", provenance: "extracted" },
    ],
  };
}

const HARNESS_HEADINGS = [
  "## Agentic SDLC harness",
  "### Read before coding",
  "### Verify before claiming done",
  "### Guardrails and risky commands",
  "### Missing or conflicting instructions",
  "### Context noise",
  "### Agent setup checklist",
] as const;

describe("graph artifacts", () => {
  it("renders wiki and handoff reports with read-these-first guidance", () => {
    const graph = makeGraph();
    const wiki = renderUnifiedGraphWiki(graph);
    const handoff = renderUnifiedGraphHandoffReport(graph, { handoffPath: "GRAPH_REPORT.md" });

    expect(wiki).toContain("# OpenAgentGraph Wiki");
    expect(wiki).toContain("## Community hubs");
    expect(wiki).toContain("## Read first by community");
    expect(wiki).toContain("## Read first by lens");
    expect(wiki).toContain("## Risks and gaps");
    expect(wiki).toContain("## Refresh commands");
    expect(wiki).toContain("## Offline navigation");
    expect(wiki).not.toContain("${primaryLens}");
    expect(wiki).toMatch(/MainViewModel/i);
    expect(handoff).toContain("# OpenAgentGraph Handoff");
    expect(handoff).toContain("## Read these first");
    expect(handoff).toContain("## Community hubs");
    expect(handoff).toContain("## Read first by community");
    expect(handoff).toContain("## High-degree hub warnings");
    expect(handoff).toContain("## Ecosystem scanner health");
    expect(handoff).toContain("## OAG fusion checks");
    expect(handoff).toContain("## Agent context APIs");
    expect(handoff).toContain("## Static OAG artifacts");
    expect(handoff).toContain("## How an agent should use these files");
    expect(handoff).toContain("## No provider key required");
    expect(handoff).toMatch(/no provider key required/i);
    expect(handoff).toMatch(/MainViewModel/i);
    expect(handoff).not.toContain("/bin/");
  });

  it("renders agentic SDLC harness sections in handoff and wiki output", () => {
    const graph = makeGraph();
    const agentHarnessReport = buildAgentHarnessReport({
      graph,
      metadata: {
        readmeText: "# App\n\nRun `npm test`.",
        packageScripts: { test: "vitest run", build: "tsc", clean: "rm -rf dist" },
      },
    });
    const handoff = renderUnifiedGraphHandoffReport(graph, {
      handoffPath: "GRAPH_REPORT.md",
      agentHarnessReport,
    });
    const wiki = renderUnifiedGraphWiki(graph, { agentHarnessReport });

    for (const heading of HARNESS_HEADINGS) {
      expect(handoff).toContain(heading);
      expect(wiki).toContain(heading);
    }
    expect(handoff).not.toContain("## Agentic SDLC spec quality");
    expect(handoff).not.toContain("## Verification map");
  });

  it("renders optional analyzer status in handoff output", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      analyzers: [{
        id: "dotnet-roslyn",
        label: "C# Roslyn semantic analyzer",
        requiredRuntime: ".NET SDK (dotnet CLI)",
        status: "unavailable",
        fallbackReason: "dotnet CLI unavailable.",
        autoBuildCapable: true,
      }],
    };

    const handoff = renderUnifiedGraphHandoffReport(graph, {
      handoffPath: "GRAPH_REPORT.md",
      agentHarnessReport: buildAgentHarnessReport({ graph }),
    });
    expect(handoff).toContain("## Optional analyzers");
    expect(handoff).toContain("C# Roslyn semantic analyzer: unavailable (dotnet CLI unavailable.)");
  });
});