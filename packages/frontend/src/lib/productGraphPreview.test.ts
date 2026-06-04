import { describe, expect, it } from "vitest";
import { summarizeProductGraphReadyTaskCandidates } from "@openagentgraph/shared";
import {
  canUseProductGraphPreview,
  getProductGraphPreviewMode,
  getProductGraphPreviewProjection,
  PRODUCT_GRAPH_PREVIEW_MESSAGE,
} from "./productGraphPreview.js";

describe("product graph preview seed", () => {
  it("enables only the explicit work-next preview mode", () => {
    expect(getProductGraphPreviewMode("?productGraphPreview=work-next", "127.0.0.1")).toBe("work-next");
    expect(getProductGraphPreviewMode("?productGraphPreview=unknown", "127.0.0.1")).toBeNull();
    expect(getProductGraphPreviewMode("", "127.0.0.1")).toBeNull();
  });

  it("keeps seeded preview mode limited to local browser hosts", () => {
    expect(canUseProductGraphPreview("localhost")).toBe(true);
    expect(canUseProductGraphPreview("LOCALHOST")).toBe(true);
    expect(canUseProductGraphPreview("127.0.0.1")).toBe(true);
    expect(canUseProductGraphPreview("[::1]")).toBe(true);
    expect(getProductGraphPreviewMode("?productGraphPreview=work-next", "[::1]")).toBe("work-next");
    expect(canUseProductGraphPreview("openagentgraph.example.com")).toBe(false);
    expect(getProductGraphPreviewMode("?productGraphPreview=work-next", "openagentgraph.example.com")).toBeNull();
  });

  it("builds a seeded graph with ready and blocked Work next coverage", () => {
    const projection = getProductGraphPreviewProjection("?productGraphPreview=work-next", "127.0.0.1");

    expect(projection).toMatchObject({
      productGraphId: "preview:work-next",
      summary: {
        nodeCount: 6,
        edgeCount: 4,
        unresolvedOpenQuestionCount: 1,
        blockedTaskCount: 1,
      },
    });
    expect(summarizeProductGraphReadyTaskCandidates(projection!)).toMatchObject({
      plannedTaskCount: 2,
      blockedPlannedTaskCount: 1,
      readyTaskCount: 1,
      taskCandidates: [
        expect.objectContaining({
          id: "task:checkout-status-panel",
          title: "Wire checkout status panel",
        }),
      ],
    });
    expect(PRODUCT_GRAPH_PREVIEW_MESSAGE).toContain("seeded local data");
  });

  it("does not provide a projection outside preview mode", () => {
    expect(getProductGraphPreviewProjection("?view=dashboard", "127.0.0.1")).toBeNull();
  });
});
