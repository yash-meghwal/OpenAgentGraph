import { describe, expect, it } from "vitest";
import {
  getScannerPlugin,
  listScannerPlugins,
  resolveActiveScanners,
  scannerHasCapability,
  highestTierForScanners,
} from "./scannerRegistry.js";

describe("scanner registry", () => {
  it("lists declared scanner plugins with tiers and capabilities", () => {
    const plugins = listScannerPlugins();
    expect(plugins.map((plugin) => plugin.id)).toEqual(expect.arrayContaining([
      "typescript",
      "dotnet",
      "generic",
    ]));
    expect(getScannerPlugin("typescript")?.tier).toBe("T0");
    expect(scannerHasCapability(getScannerPlugin("typescript")!, "semantic")).toBe(true);
    expect(getScannerPlugin("dotnet")?.tier).toBe("T0");
  });

  it("activates multiple scanners for mixed polyglot workspaces", () => {
    const active = resolveActiveScanners(["dotnet", "typescript", "mixed-polyglot"]);
    expect(active.map((scanner) => scanner.id)).toEqual(expect.arrayContaining(["dotnet", "typescript"]));
    expect(highestTierForScanners(active)).toBe("T0");
  });

  it("falls back to generic scanner when no types match", () => {
    const active = resolveActiveScanners(["unknown-type"]);
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe("generic");
    expect(active[0]?.tier).toBe("T3");
  });
});