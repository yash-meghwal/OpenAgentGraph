import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraphNode } from "./codeGraph.js";
import { classifyGraphPathIntent } from "./graphPathIntent.js";

function node(kind: UnifiedCodeGraphNode["kind"], label: string): UnifiedCodeGraphNode {
  return { id: label, kind, label };
}

describe("graphPathIntent", () => {
  it("classifies symbol-to-symbol paths as code_to_code", () => {
    expect(classifyGraphPathIntent({
      fromNode: node("symbol", "MainViewModel (class)"),
      toNode: node("symbol", "MpvPlayerAdapter (class)"),
    })).toBe("code_to_code");
  });

  it("classifies doc endpoints as doc_to_code", () => {
    expect(classifyGraphPathIntent({
      fromNode: node("doc_section", "Architecture"),
      toNode: node("symbol", "MainViewModel (class)"),
    })).toBe("doc_to_code");
  });
});