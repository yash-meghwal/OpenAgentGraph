import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  buildDocLinkRepairProposals,
  evaluateDocRepairReleaseGate,
  isGeneratedArtifactSelfLink,
  suggestDocLinkRepair,
  summarizeDocLinkRepair,
} from "./graphDocRepair.js";
import type { DocLinkDiagnostic } from "./graphDocLinks.js";

function makeGraph(input: {
  diagnostics: string[];
  nodes?: UnifiedCodeGraph["nodes"];
}): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-22T00:00:00.000Z",
    activeScannerIds: ["generic"],
    diagnostics: input.diagnostics,
    nodes: input.nodes ?? [],
    edges: [],
  };
}

function diagnostic(overrides: Partial<DocLinkDiagnostic> & Pick<DocLinkDiagnostic, "rawTarget" | "reason">): DocLinkDiagnostic {
  return {
    sourcePath: "README.md",
    severity: "warn",
    ...overrides,
  };
}

describe("graphDocRepair", () => {
  it("suggests a moved file when one unique stem match exists", () => {
    const graph = makeGraph({
      diagnostics: ["Broken doc link in README.md:4: [setup](./guides/setup.md)"],
      nodes: [
        { id: "doc:setup", kind: "doc_file", label: "docs/setup.md", path: "docs/setup.md" },
      ],
    });
    const proposal = buildDocLinkRepairProposals(graph)[0]!;
    expect(proposal.recommended?.targetPath).toBe("docs/setup.md");
    expect(proposal.recommended?.kind).toBe("moved_file");
  });

  it("suggests a case-only path correction", () => {
    const graph = makeGraph({
      diagnostics: ["Broken doc link in README.md:3: [arch](./Docs/Architecture.md)"],
      nodes: [
        { id: "doc:arch", kind: "doc_file", label: "docs/architecture.md", path: "docs/architecture.md" },
      ],
    });
    const proposal = buildDocLinkRepairProposals(graph)[0]!;
    expect(proposal.recommended?.targetPath).toBe("docs/architecture.md");
    expect(proposal.recommended?.kind).toBe("case_only");
  });

  it("handles duplicate heading slugs with ambiguity warnings", () => {
    const graph = makeGraph({
      diagnostics: ["Broken doc anchor in docs/guide.md:8: #overview"],
      nodes: [
        { id: "doc:guide", kind: "doc_file", label: "docs/guide.md", path: "docs/guide.md" },
        { id: "sec:1", kind: "doc_section", label: "Overview", path: "docs/guide.md", metadata: { scannerDocSectionSlug: "overview-0" } },
        { id: "sec:2", kind: "doc_section", label: "Overview", path: "docs/guide.md", metadata: { scannerDocSectionSlug: "overview-1" } },
      ],
    });
    const proposal = buildDocLinkRepairProposals(graph)[0]!;
    expect(proposal.candidateAnchors).toEqual(expect.arrayContaining(["overview-0", "overview-1"]));
    expect(proposal.ambiguous).toBe(true);
    expect(proposal.recommended).toBeUndefined();
  });

  it("suggests a close heading anchor candidate", () => {
    const graph = makeGraph({
      diagnostics: ["Broken doc anchor in README.md:13: #missing-anchor-section"],
      nodes: [
        { id: "doc:readme", kind: "doc_file", label: "README.md", path: "README.md" },
        { id: "sec:diag", kind: "doc_section", label: "Diagnostics", path: "README.md", metadata: { scannerDocSectionSlug: "diagnostics" } },
        { id: "sec:missing", kind: "doc_section", label: "Missing anchor", path: "README.md", metadata: { scannerDocSectionSlug: "missing-anchor" } },
      ],
    });
    const proposal = buildDocLinkRepairProposals(graph)[0]!;
    expect(proposal.candidateAnchors).toContain("missing-anchor");
    expect(proposal.recommended?.anchor).toBe("missing-anchor");
  });

  it("stays unresolved for ambiguous basename matches", () => {
    const graph = makeGraph({
      diagnostics: ["Broken doc link in docs/index.md:2: [readme](../missing/README.md)"],
      nodes: [
        { id: "doc:index", kind: "doc_file", label: "docs/index.md", path: "docs/index.md" },
        { id: "doc:root", kind: "doc_file", label: "README.md", path: "README.md" },
        { id: "doc:nested", kind: "doc_file", label: "docs/README.md", path: "docs/README.md" },
      ],
    });
    const proposal = buildDocLinkRepairProposals(graph)[0]!;
    expect(proposal.candidateTargetPaths.length).toBeGreaterThan(1);
    expect(proposal.ambiguous).toBe(true);
    expect(proposal.recommended).toBeUndefined();
  });

  it("does not suggest replacements for outside-workspace paths", () => {
    const proposal = suggestDocLinkRepair(
      diagnostic({ rawTarget: "/etc/passwd", reason: "outside_workspace", sourcePath: "README.md" }),
      makeGraph({ diagnostics: [] })
    );
    expect(proposal.candidates).toHaveLength(0);
    expect(proposal.recommended).toBeUndefined();
    expect(proposal.explanation).toMatch(/outside the workspace/i);
  });

  it("does not suggest replacements for UNC or Windows-rooted targets", () => {
    const graph = makeGraph({
      diagnostics: [
        "Broken doc link in docs/guide.md:3: [unc](\\\\server\\share\\README.md)",
        "Broken doc link in docs/guide.md:4: [rooted](\\README.md)",
      ],
      nodes: [
        { id: "doc:guide", kind: "doc_file", label: "docs/guide.md", path: "docs/guide.md" },
        { id: "doc:readme", kind: "doc_file", label: "README.md", path: "README.md" },
      ],
    });
    for (const proposal of buildDocLinkRepairProposals(graph)) {
      expect(proposal.reason).toBe("outside_workspace");
      expect(proposal.candidates).toHaveLength(0);
      expect(proposal.recommended).toBeUndefined();
      expect(proposal.explanation).toMatch(/outside the workspace/i);
    }
    expect(evaluateDocRepairReleaseGate({ graph }).ok).toBe(true);
  });

  it("suggests wikilink anchor repairs from the target doc sections", () => {
    const graph = makeGraph({
      diagnostics: ["Broken doc anchor in README.md:2: [[docs/api.md#old-section]]"],
      nodes: [
        { id: "doc:readme", kind: "doc_file", label: "README.md", path: "README.md" },
        { id: "doc:api", kind: "doc_file", label: "docs/api.md", path: "docs/api.md" },
        { id: "sec:old", kind: "doc_section", label: "Old Section Name", path: "docs/api.md", metadata: { scannerDocSectionSlug: "old-section-name" } },
      ],
    });
    const proposal = buildDocLinkRepairProposals(graph)[0]!;
    expect(proposal.reason).toBe("missing_anchor");
    expect(proposal.rawTarget).toBe("docs/api.md#old-section");
    expect(proposal.candidateAnchors).toContain("old-section-name");
    expect(proposal.recommended?.targetPath).toBe("docs/api.md");
    expect(proposal.recommended?.anchor).toBe("old-section-name");
  });

  it("rejects traversal that escapes the workspace even when README.md exists", () => {
    const graph = makeGraph({
      diagnostics: ["Broken doc link in docs/guide.md:3: [escape](../../README.md)"],
      nodes: [
        { id: "doc:guide", kind: "doc_file", label: "docs/guide.md", path: "docs/guide.md" },
        { id: "doc:readme", kind: "doc_file", label: "README.md", path: "README.md" },
      ],
    });
    const proposal = buildDocLinkRepairProposals(graph)[0]!;
    expect(proposal.reason).toBe("outside_workspace");
    expect(proposal.candidates).toHaveLength(0);
    expect(proposal.recommended).toBeUndefined();
    expect(proposal.explanation).toMatch(/outside the workspace/i);
    expect(evaluateDocRepairReleaseGate({ graph }).ok).toBe(true);
  });

  it("still treats one-level parent traversal as inside the workspace", () => {
    const graph = makeGraph({
      diagnostics: ["Broken doc link in docs/guide.md:4: [root](../README.md)"],
      nodes: [
        { id: "doc:guide", kind: "doc_file", label: "docs/guide.md", path: "docs/guide.md" },
        { id: "doc:readme", kind: "doc_file", label: "README.md", path: "README.md" },
      ],
    });
    const proposal = buildDocLinkRepairProposals(graph)[0]!;
    expect(proposal.reason).toBe("missing_file");
    expect(proposal.recommended?.targetPath).toBe("README.md");
  });

  it("suggests cross-file anchor repairs from the target doc sections", () => {
    const graph = makeGraph({
      diagnostics: ["Broken doc anchor in README.md:2: [API](docs/api.md#old-section)"],
      nodes: [
        { id: "doc:readme", kind: "doc_file", label: "README.md", path: "README.md" },
        { id: "doc:api", kind: "doc_file", label: "docs/api.md", path: "docs/api.md" },
        { id: "sec:old", kind: "doc_section", label: "Old Section Name", path: "docs/api.md", metadata: { scannerDocSectionSlug: "old-section-name" } },
      ],
    });
    const proposal = buildDocLinkRepairProposals(graph)[0]!;
    expect(proposal.reason).toBe("missing_anchor");
    expect(proposal.candidateAnchors).toContain("old-section-name");
    expect(proposal.recommended?.targetPath).toBe("docs/api.md");
    expect(proposal.recommended?.anchor).toBe("old-section-name");
  });

  it("flags generated artifact self-links", () => {
    expect(isGeneratedArtifactSelfLink("GRAPH_REPORT.md", "./GRAPH_REPORT.md")).toBe(true);
    expect(isGeneratedArtifactSelfLink(".oag/wiki/index.md", ".oag/graph.html")).toBe(true);
    expect(isGeneratedArtifactSelfLink("README.md", "./docs/guide.md")).toBe(false);
  });

  it("summarizes repair coverage for actionable diagnostics", () => {
    const graph = makeGraph({
      diagnostics: [
        "Broken doc link in README.md:3: [arch](./Docs/Architecture.md)",
        "Broken doc link in README.md:9: [missing](./missing.md)",
      ],
      nodes: [
        { id: "doc:arch", kind: "doc_file", label: "docs/architecture.md", path: "docs/architecture.md" },
      ],
    });
    const summary = summarizeDocLinkRepair(graph);
    expect(summary.actionableCount).toBe(2);
    expect(summary.withRecommendationCount).toBe(1);
    expect(summary.ok).toBe(true);
    expect(summary.reproduceCommand).toContain("graph:docs:check");
  });

  it("marks summary ok when every actionable link is recommended, ambiguous, or safely empty", () => {
    const graph = makeGraph({
      diagnostics: [
        "Broken doc link in docs/index.md:2: [readme](../missing/README.md)",
        "Broken doc link in README.md:9: [missing](./missing.md)",
      ],
      nodes: [
        { id: "doc:index", kind: "doc_file", label: "docs/index.md", path: "docs/index.md" },
        { id: "doc:root", kind: "doc_file", label: "README.md", path: "README.md" },
        { id: "doc:nested", kind: "doc_file", label: "docs/README.md", path: "docs/README.md" },
      ],
    });
    const summary = summarizeDocLinkRepair(graph);
    expect(summary.ambiguousCount).toBeGreaterThan(0);
    expect(summary.ok).toBe(true);
  });

  it("evaluates release gate for fixture-docs-broken-links style diagnostics", () => {
    const graph = makeGraph({
      diagnostics: [
        "Broken doc link in README.md:9: [missing](./missing.md)",
        "Broken doc anchor in README.md:13: #missing-anchor-section",
      ],
      nodes: [
        { id: "doc:readme", kind: "doc_file", label: "README.md", path: "README.md" },
        { id: "sec:missing", kind: "doc_section", label: "Missing anchor", path: "README.md", metadata: { scannerDocSectionSlug: "missing-anchor" } },
      ],
    });
    const gate = evaluateDocRepairReleaseGate({
      graph,
      fixture: "fixture-docs-broken-links",
      expectBrokenLinks: true,
    });
    expect(gate.ok).toBe(true);
    expect(gate.proposals.some((entry) => entry.reason === "missing_anchor" && entry.candidateAnchors.length > 0)).toBe(true);
  });
});