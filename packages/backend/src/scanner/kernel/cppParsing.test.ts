import { describe, expect, it } from "vitest";
import { parseCppFile } from "./cppParsing.js";

describe("cpp parsing", () => {
  it("restores namespace scope after closing braces", () => {
    const parsed = parseCppFile([
      "namespace A {",
      "  class Inner {",
      "  };",
      "}",
      "class Outside {",
      "};",
    ].join("\n"), "src/scope.cpp");

    const outside = parsed.symbols.find((symbol) => symbol.name === "Outside" && symbol.kind === "class");
    expect(outside?.parentType).toBeUndefined();
    const inner = parsed.symbols.find((symbol) => symbol.name === "Inner" && symbol.kind === "class");
    expect(inner?.parentType).toBe("A");
  });

  it("restores namespace scope after namespace A::B closes", () => {
    const parsed = parseCppFile([
      "namespace A::B {",
      "  class Inner {",
      "  };",
      "}",
      "class Outside {",
      "};",
    ].join("\n"), "src/nested_scope.cpp");

    const outside = parsed.symbols.find((symbol) => symbol.name === "Outside" && symbol.kind === "class");
    expect(outside?.parentType).toBeUndefined();
    const inner = parsed.symbols.find((symbol) => symbol.name === "Inner" && symbol.kind === "class");
    expect(inner?.parentType).toBe("A::B");
  });
});