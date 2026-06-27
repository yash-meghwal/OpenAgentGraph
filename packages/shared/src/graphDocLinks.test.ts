import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  collectDocLinkDiagnostics,
  evaluateDocLinkHygieneGate,
  parseDocLinkDiagnostic,
  renderBrokenDocLinksMarkdown,
  resolveRelativeDocTarget,
} from "./graphDocLinks.js";

function makeGraph(diagnostics: string[]): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-22T00:00:00.000Z",
    activeScannerIds: ["generic"],
    diagnostics,
    nodes: [],
    edges: [],
  };
}

describe("graphDocLinks", () => {
  it("parses broken doc diagnostics with source path and line", () => {
    const parsed = parseDocLinkDiagnostic("Broken doc link in README.md:9: [missing](./missing.md)");
    expect(parsed).toEqual({
      sourcePath: "README.md",
      line: 9,
      rawTarget: "./missing.md",
      reason: "missing_file",
      severity: "warn",
    });
    const anchor = parseDocLinkDiagnostic("Broken doc anchor in docs/guide.md:14: #ghost-section");
    expect(anchor?.reason).toBe("missing_anchor");
    expect(anchor?.line).toBe(14);
  });

  it("normalizes wikilink diagnostics to their target page", () => {
    const parsed = parseDocLinkDiagnostic("Broken doc link in docs/playback.md:9: [[MainViewModel]]");
    expect(parsed?.rawTarget).toBe("MainViewModel");
    expect(parsed?.reason).toBe("missing_file");
  });

  it("parses legacy diagnostics without line numbers", () => {
    const parsed = parseDocLinkDiagnostic("Broken doc link in README.md: ./missing.md");
    expect(parsed?.sourcePath).toBe("README.md");
    expect(parsed?.line).toBeUndefined();
  });

  it("classifies escaping relative traversal as outside_workspace", () => {
    const parsed = parseDocLinkDiagnostic("Broken doc link in docs/guide.md:3: [escape](../../README.md)");
    expect(parsed?.reason).toBe("outside_workspace");
    expect(resolveRelativeDocTarget("docs/guide.md", "../../README.md").outsideWorkspace).toBe(true);
  });

  it("keeps one-level parent traversal inside the workspace", () => {
    const parsed = parseDocLinkDiagnostic("Broken doc link in docs/guide.md:4: [root](../README.md)");
    expect(parsed?.reason).toBe("missing_file");
    expect(resolveRelativeDocTarget("docs/guide.md", "../README.md").resolvedPath).toBe("README.md");
  });

  it("classifies Windows-rooted and UNC targets as outside_workspace", () => {
    expect(
      parseDocLinkDiagnostic("Broken doc link in docs/guide.md:3: [unc](\\\\server\\share\\README.md)")?.reason
    ).toBe("outside_workspace");
    expect(
      parseDocLinkDiagnostic("Broken doc link in docs/guide.md:3: [rooted](\\README.md)")?.reason
    ).toBe("outside_workspace");
    expect(resolveRelativeDocTarget("docs/guide.md", "\\\\server\\share\\README.md").outsideWorkspace).toBe(true);
    expect(resolveRelativeDocTarget("docs/guide.md", "\\README.md").outsideWorkspace).toBe(true);
    expect(resolveRelativeDocTarget("docs/guide.md", "//server/share/README.md").outsideWorkspace).toBe(true);
    expect(resolveRelativeDocTarget("docs/guide.md", "/README.md").outsideWorkspace).toBe(true);
    expect(resolveRelativeDocTarget("docs/guide.md", "C:\\README.md").outsideWorkspace).toBe(true);
    expect(resolveRelativeDocTarget("docs/guide.md", "C:/README.md").outsideWorkspace).toBe(true);
  });

  it("preserves wikilink anchors in diagnostics", () => {
    const plain = parseDocLinkDiagnostic("Broken doc anchor in README.md:2: [[docs/api.md#old-section]]");
    expect(plain?.rawTarget).toBe("docs/api.md#old-section");
    expect(plain?.reason).toBe("missing_anchor");

    const aliased = parseDocLinkDiagnostic("Broken doc anchor in README.md:2: [[docs/api.md#old-section|API]]");
    expect(aliased?.rawTarget).toBe("docs/api.md#old-section");

    const symbol = parseDocLinkDiagnostic("Broken doc link in docs/playback.md:9: [[MainViewModel]]");
    expect(symbol?.rawTarget).toBe("MainViewModel");

    const pageAnchor = parseDocLinkDiagnostic("Broken doc anchor in README.md:5: [[architecture#Components]]");
    expect(pageAnchor?.rawTarget).toBe("architecture#Components");
  });

  it("renders markdown and evaluates hygiene gates", () => {
    const graph = makeGraph([
      "Broken doc link in README.md:9: [missing](./missing.md)",
      "Broken doc anchor in README.md:13: #missing-anchor-section",
    ]);
    const diagnostics = collectDocLinkDiagnostics(graph);
    expect(diagnostics).toHaveLength(2);
    const markdown = renderBrokenDocLinksMarkdown(diagnostics).join("\n");
    expect(markdown).toContain("## Broken documentation links");
    expect(markdown).toContain("README.md:9");
    const gate = evaluateDocLinkHygieneGate({
      graph,
      fixture: "fixture-docs-broken-links",
      expectBrokenLinks: true,
    });
    expect(gate.ok).toBe(true);
    expect(gate.brokenCount).toBe(2);
  });
});
