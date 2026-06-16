import { describe, expect, it } from "vitest";
import {
  buildWorkspaceGraphQueryEntryPoints,
  describeWorkspaceGraphEmptyState,
} from "./graphOperational.js";

describe("graphOperational", () => {
  it("describes missing export vs missing scan distinctly", () => {
    expect(
      describeWorkspaceGraphEmptyState({
        available: false,
        unavailableReason: "no_graph_export",
      })
    ).toContain(".oag/graph.json");

    expect(
      describeWorkspaceGraphEmptyState({
        available: false,
        unavailableReason: "no_code_scan",
      })
    ).toContain("Scan Codebase");
  });

  it("buildWorkspaceGraphQueryEntryPoints matches graph:path positional syntax", () => {
    const hints = buildWorkspaceGraphQueryEntryPoints({
      workspaceRoot: "/repo",
      lens: "backend-runtime",
    });

    expect(hints.pathHint).toBe('npm run graph:path -- --workspace "/repo" "<from>" "<to>"');
    expect(hints.pathHint).not.toMatch(/--from|--to/);
    expect(hints.queryHint).toContain('--lens backend-runtime');
    expect(hints.explainHint).toContain('"<node-or-file>"');
  });

  it("describes lens empty states without implying data deletion", () => {
    expect(
      describeWorkspaceGraphEmptyState({
        available: true,
        lens: "frontend",
        lensLabel: "Frontend",
        scopedNodeCount: 0,
      })
    ).toContain("Frontend");
    expect(
      describeWorkspaceGraphEmptyState({
        available: true,
        lens: "frontend",
        lensLabel: "Frontend",
        scopedNodeCount: 0,
      })
    ).toContain("still present");
  });
});