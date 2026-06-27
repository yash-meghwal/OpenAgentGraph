import { describe, expect, it } from "vitest";
import { GraphWorkflowTimingCollector } from "./graphWorkflowTiming.js";

describe("graphWorkflowTiming", () => {
  it("reports zero duplicate kernel scans after one scan start", () => {
    const timing = new GraphWorkflowTimingCollector();
    timing.recordKernelScanStart();
    expect(timing.buildReport().duplicateKernelScanCount).toBe(0);
  });

  it("reports duplicate kernel scans after repeated scan starts", () => {
    const timing = new GraphWorkflowTimingCollector();
    timing.recordKernelScanStart();
    timing.recordKernelScanStart();
    expect(timing.buildReport().duplicateKernelScanCount).toBe(1);
  });
});