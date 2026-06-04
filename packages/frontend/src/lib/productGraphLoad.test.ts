import { describe, expect, it, vi } from "vitest";
import { requestProductGraphLoad } from "./productGraphLoad.js";

describe("product graph load request helper", () => {
  it("calls the store loader for UI-triggered product graph loads", () => {
    const loadProductGraph = vi.fn().mockResolvedValue(undefined);

    requestProductGraphLoad(loadProductGraph);

    expect(loadProductGraph).toHaveBeenCalledTimes(1);
  });

  it("absorbs rejected product graph load promises after the store records UI error state", async () => {
    const loadProductGraph = vi.fn().mockRejectedValue(new Error("product graph unavailable"));

    requestProductGraphLoad(loadProductGraph);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loadProductGraph).toHaveBeenCalledTimes(1);
  });
});
