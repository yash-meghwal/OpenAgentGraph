import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { mcpOagContext, mcpOagQuery } from "./oagTools.js";

vi.setConfig({ testTimeout: 60_000 });

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function fixtureRoot(...segments: string[]) {
  return path.resolve(repoRoot(), "tests", "fixtures", "graph", ...segments);
}

describe("oag mcp tools", () => {
  it("returns bounded query output without source bodies", async () => {
    const workspaceRoot = fixtureRoot("fixture-csharp-wpf");
    const result = await mcpOagQuery({
      workspace: workspaceRoot,
      query: "MainViewModel",
      budget: 12,
    });
    expect(result.status).toBe("oag_query_complete");
    expect(result.nodes.length).toBeLessThanOrEqual(24);
    expect(JSON.stringify(result)).not.toMatch(/public\s+class[\s\S]{40,}/);
  });

  it("returns context pack with retrieval hints", async () => {
    const workspaceRoot = fixtureRoot("fixture-docs-only");
    const result = await mcpOagContext({
      workspace: workspaceRoot,
      goal: "understand architecture",
      redactRoot: true,
    });
    expect(result.status).toBe("graph_context_ready");
    expect(result.retrievalHints.length).toBeGreaterThan(0);
  });
});