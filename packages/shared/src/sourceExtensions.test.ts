import { describe, expect, it } from "vitest";
import {
  isGraphPathFileExtension,
  isProductGraphScannableExtension,
  PRODUCT_GRAPH_SCANNABLE_EXTENSIONS,
} from "./sourceExtensions.js";

describe("sourceExtensions", () => {
  it("recognizes scanner and graph-path query extensions from one canonical list", () => {
    expect(isProductGraphScannableExtension(".cs")).toBe(true);
    expect(isProductGraphScannableExtension("ts")).toBe(true);
    expect(isGraphPathFileExtension(".cs")).toBe(true);
    expect(isGraphPathFileExtension("json")).toBe(true);
    expect(isGraphPathFileExtension(".DefinitelyMissing")).toBe(false);
  });

  it("keeps product graph scannable extensions derived from ecosystem groups", () => {
    expect(PRODUCT_GRAPH_SCANNABLE_EXTENSIONS).toEqual(
      expect.arrayContaining([".cs", ".ts", ".py", ".tf", ".ps1"])
    );
  });
});