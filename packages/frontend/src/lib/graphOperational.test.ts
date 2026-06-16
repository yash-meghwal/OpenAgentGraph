import { describe, expect, it } from "vitest";
import { hardFusionChecks, workspaceGraphEmptyMessage } from "./graphOperational.js";

describe("graphOperational helpers", () => {
  it("surfaces hard fusion checks separately from warnings", () => {
    const hard = hardFusionChecks({
      available: true,
      lens: "all",
      fusion: {
        ok: false,
        hardFailCount: 1,
        warnCount: 1,
        checks: [
          { code: "stale_handoff", title: "Stale handoff", severity: "fail", detail: "Refresh report." },
          { code: "orphan_files", title: "Orphans", severity: "warn", detail: "2 orphan files." },
        ],
      },
    });
    expect(hard).toHaveLength(1);
    expect(hard[0]?.severity).toBe("fail");
  });

  it("does not include source bodies in empty-state guidance", () => {
    const message = workspaceGraphEmptyMessage({
      available: false,
      unavailableReason: "no_graph_export",
      lens: "all",
      unavailableDetail: "Export graph after scanning.",
    });
    expect(message).not.toMatch(/function |class |import /);
    expect(message).toContain("graph.json");
  });
});