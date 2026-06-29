import { describe, expect, it } from "vitest";
import { analyzeGraphLearnLog } from "./graphLearnProposal.js";

describe("graphLearnProposal", () => {
  it("detects stale graph and setup failures", () => {
    const result = analyzeGraphLearnLog(
      [
        "ENOENT: no such file src/missing.ts",
        "graph freshness stale .oag/graph.json missing",
        "npm ERR! command failed",
        "sk_test_1234567890abcdef",
      ].join("\n"),
      { workspaceRoot: "C:\\Users\\demo\\project" }
    );
    expect(result.findingCount).toBeGreaterThan(0);
    expect(result.markdown).not.toContain("sk_test");
    expect(result.markdown).not.toContain("C:\\\\Users");
    expect(result.markdown).toContain("does not auto-edit");
  });

  it("detects path and query misses as model-oriented findings", () => {
    const result = analyzeGraphLearnLog(
      [
        "graph_query_complete seeds: []",
        "No matching seed for graph:path",
      ].join("\n")
    );
    expect(result.findings.some((finding) => finding.code === "bad_path_query")).toBe(true);
  });
});