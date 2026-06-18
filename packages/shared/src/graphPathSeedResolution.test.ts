import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { rankGraphNodeCandidates } from "./graphQueryEngine.js";
import {
  buildGraphPathSeedResolverBrowserScript,
  rankGraphPathSeedCandidates,
  resolveGraphPathSeedNode,
} from "./graphPathSeedResolution.js";
import { GRAPH_PATH_FILE_QUERY_EXTENSION_LIST } from "./sourceExtensions.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      { id: "file:vm", kind: "code_file", label: "ViewModels/MainViewModel.cs", path: "ViewModels/MainViewModel.cs" },
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
      { id: "sym:field", kind: "symbol", label: "MainViewModel._playbackService (field)", path: "ViewModels/MainViewModel.cs" },
      { id: "sym:ns", kind: "symbol", label: "SampleMediaPlayer.ViewModels (namespace)", path: "ViewModels/MainViewModel.cs" },
      { id: "file:php-user", kind: "code_file", label: "User.php", path: "src/User.php" },
      { id: "sym:php-user", kind: "symbol", label: "User (class)", path: "src/User.php" },
    ],
    edges: [],
  };
}

function resolveWithBrowserScript(nodes: UnifiedCodeGraph["nodes"], query: string) {
  const script = `
    const data = { nodes: ${JSON.stringify(nodes)} };
    function normalize(value) {
      return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    }
    ${buildGraphPathSeedResolverBrowserScript(GRAPH_PATH_FILE_QUERY_EXTENSION_LIST)}
    resolveNode(${JSON.stringify(query)});
  `;
  return runInNewContext(script) as UnifiedCodeGraph["nodes"][number] | undefined;
}

describe("graphPathSeedResolution", () => {
  it("prefers class symbols over fields for simple identifier queries", () => {
    const graph = makeGraph();
    expect(resolveGraphPathSeedNode(graph.nodes, "MainViewModel")?.id).toBe("sym:vm");
    expect(rankGraphNodeCandidates(graph, "MainViewModel")[0]?.node.id).toBe("sym:vm");
  });

  it("prefers code files for file queries", () => {
    const graph = makeGraph();
    expect(rankGraphPathSeedCandidates(graph.nodes, "User.php")[0]?.node.id).toBe("file:php-user");
    expect(rankGraphNodeCandidates(graph, "User.php")[0]?.node.id).toBe("file:php-user");
  });

  it("keeps browser resolver aligned with CLI seed ranking", () => {
    const graph = makeGraph();
    const queries = ["MainViewModel", "User", "User.php", "MainViewModel.cs", "DefinitelyMissing"];
    for (const query of queries) {
      const cli = rankGraphNodeCandidates(graph, query)[0]?.node.id;
      const browser = resolveWithBrowserScript(graph.nodes, query)?.id;
      expect(browser).toBe(cli);
    }
  });

  it("keeps browser resolver aligned for doc section and doc file seeds", () => {
    const nodes = [
      { id: "doc:guide", kind: "doc_file", label: "docs/guide.md", path: "docs/guide.md" },
      { id: "section:architecture", kind: "doc_section", label: "Architecture (doc_section)", path: "docs/guide.md" },
      { id: "sym:other", kind: "symbol", label: "OtherService (class)", path: "src/other.ts" },
    ];
    for (const query of ["architecture", "guide"]) {
      const cli = rankGraphPathSeedCandidates(nodes, query)[0]?.node.id;
      const browser = resolveWithBrowserScript(nodes, query)?.id;
      expect(browser).toBe(cli);
    }
  });
});