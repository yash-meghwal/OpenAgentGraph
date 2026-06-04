import { describe, expect, it } from "vitest";
import type { ScanBreakerLimits } from "@openagentgraph/shared";
import {
  buildScanProgressSnapshot,
  createScanBreakerStatus,
  markScanBreakerHit,
  normalizeScanBreakerLimits,
  scanBreakerDiagnostics,
  updateScanBreakerNear,
} from "./scanProgress.js";

const limits: ScanBreakerLimits = {
  maxFiles: 100,
  maxTotalBytes: 1_000,
  maxFileBytes: 100,
  maxDepth: 10,
  maxDurationMs: 1_000,
};

describe("scan progress helpers", () => {
  it("normalizes partial breaker limits with fallback defaults", () => {
    expect(normalizeScanBreakerLimits({ maxFiles: 5, maxDurationMs: 250 }, limits)).toEqual({
      ...limits,
      maxFiles: 5,
      maxDurationMs: 250,
    });
  });

  it("deduplicates near and hit diagnostics for the same breaker key", () => {
    const status = createScanBreakerStatus(limits);

    updateScanBreakerNear(status, {
      maxFiles: 90,
      maxTotalBytes: 900,
    });
    expect(status.state).toBe("near");
    expect(status.near.map((alert) => alert.key)).toEqual(["maxFiles", "maxTotalBytes"]);

    markScanBreakerHit(status, "maxFiles", 101, "file count exceeded 100.");
    updateScanBreakerNear(status, {
      maxFiles: 99,
      maxTotalBytes: 900,
    });

    expect(status.state).toBe("hit");
    expect(status.hits.map((alert) => alert.key)).toEqual(["maxFiles"]);
    expect(status.near.map((alert) => alert.key)).toEqual(["maxTotalBytes"]);
    expect(scanBreakerDiagnostics(status)).toEqual([
      "file count exceeded 100.",
      "total source bytes is near the configured breaker.",
    ]);
  });

  it("builds bounded progress rates and omits ETA for completed scans", () => {
    const status = createScanBreakerStatus(limits);
    const progress = buildScanProgressSnapshot({
      scanId: "scan-1",
      scope: "product_codebase",
      phase: "completed",
      startedAtMs: 1_000,
      nowMs: 1_000,
      filesScanned: 0,
      bytesScanned: 0,
      skippedFileCount: 0,
      skippedDirectoryCount: 0,
      breakers: status,
    });

    expect(progress.filesPerSecond).toBe(0);
    expect(progress.megabytesPerSecond).toBe(0);
    expect(progress.etaMs).toBeUndefined();
  });
});
