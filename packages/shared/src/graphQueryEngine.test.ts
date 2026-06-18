import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  explainGraphNode,
  findGraphPath,
  queryUnifiedCodeGraph,
  rankGraphNodeCandidates,
  resolveGraphNode,
} from "./graphQueryEngine.js";

function makeGraph(): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-01-01T00:00:00.000Z",
    activeScannerIds: ["dotnet"],
    diagnostics: [],
    nodes: [
      { id: "workspace", kind: "workspace", label: "workspace", path: "." },
      { id: "project:.", kind: "project", label: "workspace-root", path: "." },
      { id: "file:xaml", kind: "code_file", label: "Views/MainView.xaml", path: "Views/MainView.xaml" },
      { id: "file:vm", kind: "code_file", label: "ViewModels/MainViewModel.cs", path: "ViewModels/MainViewModel.cs" },
      { id: "file:playback", kind: "code_file", label: "Services/PlaybackService.cs", path: "Services/PlaybackService.cs" },
      { id: "sym:vm", kind: "symbol", label: "MainViewModel (class)", path: "ViewModels/MainViewModel.cs" },
      { id: "sym:svc", kind: "symbol", label: "PlaybackService (class)", path: "Services/PlaybackService.cs" },
      { id: "sym:field", kind: "symbol", label: "MainViewModel._playbackService (field)", path: "ViewModels/MainViewModel.cs" },
      {
        id: "comm:ui",
        kind: "community",
        label: "ui",
        path: "SampleMediaPlayer.App",
        metadata: {
          scannerCommunityLabel: "SampleMediaPlayer.App",
          scannerCommunityFileCount: 2,
          scannerCommunitySummary: "App UI project.",
        },
      },
    ],
    edges: [
      { id: "e0", sourceNodeId: "workspace", targetNodeId: "project:.", kind: "declares", provenance: "extracted" },
      { id: "e1", sourceNodeId: "file:xaml", targetNodeId: "sym:vm", kind: "references", provenance: "inferred", label: "View -> MainViewModel" },
      { id: "e2", sourceNodeId: "sym:vm", targetNodeId: "sym:svc", kind: "depends_on", provenance: "extracted", label: "using service" },
      { id: "e3", sourceNodeId: "file:xaml", targetNodeId: "comm:ui", kind: "belongs_to", provenance: "extracted" },
      { id: "e3b", sourceNodeId: "file:vm", targetNodeId: "comm:ui", kind: "belongs_to", provenance: "extracted" },
      { id: "e4", sourceNodeId: "file:xaml", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
      { id: "e4c", sourceNodeId: "file:vm", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
      { id: "e4d", sourceNodeId: "sym:vm", targetNodeId: "file:vm", kind: "belongs_to", provenance: "extracted" },
      { id: "e4b", sourceNodeId: "file:playback", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
      { id: "e5", sourceNodeId: "sym:vm", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
      { id: "e6", sourceNodeId: "sym:svc", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
      { id: "e7", sourceNodeId: "sym:vm", targetNodeId: "sym:field", kind: "declares", provenance: "extracted" },
    ],
  };
}

function makeLanguageGraph(
  language: "java" | "typescript" | "python" | "terraform",
): UnifiedCodeGraph {
  const graphs: Record<string, UnifiedCodeGraph> = {
    java: {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["java"],
      diagnostics: [],
      nodes: [
        { id: "project:.", kind: "project", label: "workspace-root", path: "." },
        { id: "sym:service", kind: "symbol", label: "CheckoutService (class)", path: "src/main/java/com/example/checkout/CheckoutService.java" },
        { id: "sym:model", kind: "symbol", label: "Order (class)", path: "src/main/java/com/example/checkout/model/Order.java" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "sym:service", targetNodeId: "sym:model", kind: "depends_on", provenance: "extracted" },
        { id: "e2", sourceNodeId: "sym:service", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
        { id: "e3", sourceNodeId: "sym:model", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
      ],
    },
    typescript: {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["typescript"],
      diagnostics: [],
      nodes: [
        { id: "project:.", kind: "project", label: "workspace-root", path: "." },
        { id: "file:page", kind: "code_file", label: "src/pages/Checkout.tsx", path: "src/pages/Checkout.tsx" },
        { id: "sym:client", kind: "symbol", label: "CheckoutApiClient (class)", path: "src/api/checkoutClient.ts" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "file:page", targetNodeId: "sym:client", kind: "references", provenance: "extracted" },
        { id: "e2", sourceNodeId: "file:page", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
        { id: "e3", sourceNodeId: "sym:client", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
      ],
    },
    python: {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["python"],
      diagnostics: [],
      nodes: [
        { id: "project:.", kind: "project", label: "workspace-root", path: "." },
        { id: "sym:route", kind: "symbol", label: "checkout_route (function)", path: "app/routes/checkout.py" },
        { id: "sym:service", kind: "symbol", label: "CheckoutService (class)", path: "app/services/checkout.py" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "sym:route", targetNodeId: "sym:service", kind: "depends_on", provenance: "extracted" },
        { id: "e2", sourceNodeId: "sym:route", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
        { id: "e3", sourceNodeId: "sym:service", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
      ],
    },
    terraform: {
      schemaVersion: "1",
      workspaceRoot: "/workspace",
      generatedAt: "2026-01-01T00:00:00.000Z",
      activeScannerIds: ["terraform"],
      diagnostics: [],
      nodes: [
        { id: "project:.", kind: "project", label: "workspace-root", path: "." },
        { id: "sym:module", kind: "symbol", label: "module.vpc (module)", path: "modules/vpc/main.tf" },
        { id: "sym:resource", kind: "symbol", label: "aws_vpc.main (resource)", path: "modules/vpc/main.tf" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "sym:module", targetNodeId: "sym:resource", kind: "declares", provenance: "extracted" },
        { id: "e2", sourceNodeId: "sym:module", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
        { id: "e3", sourceNodeId: "sym:resource", targetNodeId: "project:.", kind: "belongs_to", provenance: "extracted" },
      ],
    },
  };
  return graphs[language];
}

describe("graph query engine", () => {
  it("queries related nodes with BFS around matching seeds", () => {
    const result = queryUnifiedCodeGraph(makeGraph(), "MainViewModel playback", { budget: 10 });
    expect(result.seeds.map((node) => node.id)).toContain("sym:vm");
    expect(result.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["sym:vm", "sym:svc"]));
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it("finds a meaningful path between view and service symbols without workspace-root bridges", () => {
    const result = findGraphPath(makeGraph(), "MainView.xaml", "PlaybackService", { explainRanking: true });
    expect(result.found).toBe(true);
    expect(result.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["sym:vm", "sym:svc"])
    );
    expect(result.nodes.at(-1)?.id).toBe("sym:svc");
    expect(result.nodes.some((node) => node.label === "workspace-root")).toBe(false);
    expect(result.toNode?.label).toBe("PlaybackService (class)");
    expect(result.edges.some((edge) => edge.kind === "depends_on")).toBe(true);
    expect(result.explanation?.penalizedAlternatives.length).toBeGreaterThan(0);
  });

  it("prefers class symbols over fields for type-like queries", () => {
    const ranked = rankGraphNodeCandidates(makeGraph(), "PlaybackService");
    expect(ranked[0]?.node.id).toBe("sym:svc");
  });

  it("returns no candidates for missing file-like queries", () => {
    expect(rankGraphNodeCandidates(makeGraph(), "DefinitelyMissing.zzz")).toEqual([]);
    expect(findGraphPath(makeGraph(), "DefinitelyMissing.zzz", "PlaybackService").found).toBe(false);
  });

  it("does not match unrelated files that only share a common extension", () => {
    expect(rankGraphNodeCandidates(makeGraph(), "DefinitelyMissing.cs")).toEqual([]);
    expect(findGraphPath(makeGraph(), "DefinitelyMissing.cs", "PlaybackService").found).toBe(false);
    expect(rankGraphNodeCandidates(makeLanguageGraph("typescript"), "DefinitelyMissing.ts")).toEqual([]);
    expect(findGraphPath(makeLanguageGraph("typescript"), "DefinitelyMissing.ts", "CheckoutApiClient").found).toBe(false);
  });

  it("matches file queries with Windows-style path separators", () => {
    expect(resolveGraphNode(makeGraph(), "Views\\MainView.xaml")?.id).toBe("file:xaml");
  });

  it("prefers class symbols and code files over namespaces for simple identifier queries", () => {
    const graph: UnifiedCodeGraph = {
      ...makeGraph(),
      nodes: [
        ...makeGraph().nodes,
        { id: "sym:php-user", kind: "symbol", label: "App\\Models.User (class)", path: "app/Models/User.php" },
        { id: "sym:php-ns", kind: "symbol", label: "App\\Models (namespace)", path: "app/Models/User.php" },
        { id: "file:php-user", kind: "code_file", label: "app/Models/User.php", path: "app/Models/User.php" },
      ],
      edges: [
        ...makeGraph().edges,
        { id: "e-php", sourceNodeId: "sym:vm", targetNodeId: "sym:php-user", kind: "depends_on", provenance: "extracted" },
      ],
    };
    expect(rankGraphNodeCandidates(graph, "User")[0]?.node.id).toBe("sym:php-user");
    expect(rankGraphNodeCandidates(graph, "User.php")[0]?.node.id).toBe("file:php-user");
  });

  it("supports semantic path mode that avoids workspace-root detours", () => {
    const balanced = findGraphPath(makeGraph(), "MainViewModel", "PlaybackService", { mode: "balanced" });
    const semantic = findGraphPath(makeGraph(), "MainViewModel", "PlaybackService", { mode: "semantic" });
    expect(balanced.found).toBe(true);
    expect(semantic.found).toBe(true);
    expect(semantic.nodes.some((node) => node.label === "workspace-root")).toBe(false);
    expect(semantic.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["sym:vm", "sym:svc"]));
  });

  it("respects maxHops when searching paths", () => {
    expect(findGraphPath(makeGraph(), "MainView.xaml", "PlaybackService", { maxHops: 1 }).found).toBe(false);
    expect(findGraphPath(makeGraph(), "MainView.xaml", "PlaybackService", { maxHops: 2 }).found).toBe(true);
  });

  it("falls back to lower-ranked seed pairs only when the top pair is disconnected", () => {
    const graph = makeGraph();
    graph.nodes.push({
      id: "sym:isolated",
      kind: "symbol",
      label: "IsolatedService (class)",
      path: "Services/IsolatedService.cs",
    });
    graph.edges.push({
      id: "e8",
      sourceNodeId: "sym:isolated",
      targetNodeId: "sym:svc",
      kind: "depends_on",
      provenance: "extracted",
    });

    const topPairBlocked = findGraphPath(graph, "IsolatedService", "PlaybackService");
    expect(topPairBlocked.found).toBe(true);
    expect(topPairBlocked.fromNode?.id).toBe("sym:isolated");
    expect(topPairBlocked.nodes.map((node) => node.id)).toEqual(["sym:isolated", "sym:svc"]);
  });

  it("explains a node with neighbors and summary", () => {
    const node = resolveGraphNode(makeGraph(), "MainViewModel");
    expect(node?.id).toBe("sym:vm");
    const explained = explainGraphNode(makeGraph(), "MainViewModel");
    expect(explained.resolved).toBe(true);
    expect(explained.neighbors.map((neighbor) => neighbor.id)).toEqual(expect.arrayContaining(["sym:svc", "file:xaml"]));
    expect(explained.summary).toContain("MainViewModel");
    expect(explained.community?.label).toBe("SampleMediaPlayer.App");
    expect(explained.summary).toContain("community:");
  });

  it.each([
    ["java", "CheckoutService", "Order"],
    ["typescript", "Checkout.tsx", "CheckoutApiClient"],
    ["python", "checkout_route", "CheckoutService"],
    ["terraform", "module.vpc", "aws_vpc.main"],
  ] as const)("finds direct %s architecture paths without workspace-root bridges", (language, from, to) => {
    const result = findGraphPath(makeLanguageGraph(language), from, to);
    expect(result.found).toBe(true);
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    expect(result.nodes.some((node) => node.label === "workspace-root")).toBe(false);
  });
});