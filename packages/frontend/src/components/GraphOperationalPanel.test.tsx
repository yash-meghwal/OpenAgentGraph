import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { GraphOperationalPanel } from "./GraphOperationalPanel.js";

describe("GraphOperationalPanel", () => {
  it("renders lens selector, fusion warnings, and read-first nodes without source bodies", () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <GraphOperationalPanel
          context={{
            available: true,
            lens: "backend-runtime",
            primaryLens: "backend-runtime",
            scopedNodeCount: 12,
            scopedEdgeCount: 18,
            health: {
              extractedEdgePercent: 80,
              symbolCount: 10,
              fileCount: 8,
              communityCount: 2,
              orphanFileCount: 0,
              activeScannerIds: ["typescript"],
              partialSupportWarnings: [],
              badges: [{ label: "Symbols", tone: "good", detail: "10 indexed" }],
            },
            fusion: {
              ok: false,
              hardFailCount: 1,
              warnCount: 0,
              checks: [
                {
                  code: "stale_handoff",
                  title: "Handoff stale",
                  severity: "fail",
                  detail: "GRAPH_REPORT.md is older than graph.json.",
                },
              ],
            },
            readTheseFirst: [
              { id: "node:1", kind: "code_file", label: "src/app.ts", path: "src/app.ts" },
            ],
            godNodes: [
              {
                id: "god:src",
                label: "src",
                memberCount: 4,
                topFiles: ["src/app.ts"],
                topSymbols: ["main"],
                summary: "src hub with 4 connected nodes.",
              },
            ],
            queryEntryPoints: {
              queryHint: "npm run graph:query -- --workspace \"/repo\" --lens backend-runtime \"service\"",
              pathHint: 'npm run graph:path -- --workspace "/repo" "<from>" "<to>"',
              explainHint: "npm run graph:explain -- --workspace \"/repo\" \"node\"",
            },
          }}
          selectedLens="backend-runtime"
          loading={false}
          error=""
          onSelectLens={vi.fn()}
          onRefresh={vi.fn()}
        />
      );
    });

    const markup = JSON.stringify(renderer!.toJSON());
    expect(markup).toContain("Graph operational panel");
    expect(markup).toContain("Graph lens selector");
    expect(markup).toContain("Fusion checks");
    expect(markup).toContain("Read these first");
    expect(markup).toContain("Community hubs");
    expect(markup).toContain("src/app.ts");
    expect(markup).toContain("Handoff stale");
    expect(markup).toContain("fail");
    expect(markup).not.toContain("export function");
    expect(markup).not.toContain("const main =");
  });

  it("explains when no graph export exists", () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <GraphOperationalPanel
          context={{
            available: false,
            unavailableReason: "no_graph_export",
            unavailableDetail: "Run graph:export after scanning.",
            lens: "all",
          }}
          selectedLens="all"
          loading={false}
          error=""
          onSelectLens={vi.fn()}
          onRefresh={vi.fn()}
        />
      );
    });

    const markup = JSON.stringify(renderer!.toJSON());
    expect(markup).toContain("Graph operational empty state");
    expect(markup).toContain("No graph export");
    expect(markup).toContain("graph:export");
  });
});