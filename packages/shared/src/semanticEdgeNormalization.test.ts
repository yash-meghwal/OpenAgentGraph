import { describe, expect, it } from "vitest";
import {
  edgeRequiresExplicitEndpoints,
  isSemanticResolutionEdge,
  mapSemanticRelationToEdgeKind,
  normalizeScannerRelation,
} from "./semanticEdgeNormalization.js";

describe("semantic edge normalization", () => {
  it("normalizes scanner relation aliases to canonical relations", () => {
    expect(normalizeScannerRelation("import")).toBe("imports");
    expect(normalizeScannerRelation("rails_route")).toBe("route_to_handler");
    expect(normalizeScannerRelation("external_using")).toBe("imports");
    expect(normalizeScannerRelation("unknown_relation")).toBeUndefined();
  });

  it("maps canonical relations to unified edge kinds", () => {
    expect(mapSemanticRelationToEdgeKind("extends")).toBe("inherits");
    expect(mapSemanticRelationToEdgeKind("implements")).toBe("implements");
    expect(mapSemanticRelationToEdgeKind("tests")).toBe("tests");
    expect(mapSemanticRelationToEdgeKind("imports")).toBe("depends_on");
    expect(mapSemanticRelationToEdgeKind("route_to_handler")).toBe("depends_on");
  });

  it("detects semantic resolution metadata", () => {
    expect(isSemanticResolutionEdge({ scannerResolution: "semantic" })).toBe(true);
    expect(isSemanticResolutionEdge({ scannerImportResolution: "semantic-lite" })).toBe(true);
    expect(isSemanticResolutionEdge({ scannerResolution: "file" })).toBe(false);
  });

  it("flags relations that require explicit endpoints", () => {
    expect(edgeRequiresExplicitEndpoints({ scannerRelation: "imports" })).toBe(true);
    expect(edgeRequiresExplicitEndpoints({ scannerRelation: "route_to_handler" })).toBe(true);
    expect(edgeRequiresExplicitEndpoints({ scannerRelation: "asset_references" })).toBe(false);
  });
});