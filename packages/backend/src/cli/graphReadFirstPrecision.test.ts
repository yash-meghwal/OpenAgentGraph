import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateHubStartQualityGate,
  evaluateReadFirstQualityGate,
  getReadTheseFirstNodes,
} from "@openagentgraph/shared";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";

vi.setConfig({ testTimeout: 60_000 });

function fixtureRoot(...segments: string[]) {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..", "tests", "fixtures", "graph", ...segments);
}

describe("graph read-first precision fixtures", () => {
  it("prefers MainViewModel and role-aware hub starts in media-player fixture", async () => {
    const scan = await runKernelWorkspaceScan(fixtureRoot("fixture-csharp-media-player"));
    const readFirst = getReadTheseFirstNodes(scan.unifiedGraph, 8);
    expect(readFirst[0]?.label).toMatch(/MainViewModel/i);
    expect(evaluateReadFirstQualityGate(scan.unifiedGraph, "fixture-csharp-media-player").ok).toBe(true);
    expect(evaluateHubStartQualityGate(scan.unifiedGraph, "fixture-csharp-media-player").ok).toBe(true);
    const testIndex = readFirst.findIndex((node) => /tests?[/\\]/i.test(node.path ?? node.label));
    const vmIndex = readFirst.findIndex((node) => /MainViewModel/i.test(node.label));
    if (testIndex >= 0 && vmIndex >= 0) {
      expect(testIndex).toBeGreaterThan(vmIndex);
    }
  });
});