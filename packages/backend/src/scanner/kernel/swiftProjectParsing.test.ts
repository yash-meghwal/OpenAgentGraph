import { describe, expect, it } from "vitest";
import { inferSwiftSpecTargetBaseName, parseSwiftPackageManifest } from "./swiftProjectParsing.js";

describe("swift project parsing", () => {
  it("parses Package.swift metadata", () => {
    const manifest = parseSwiftPackageManifest([
      "// swift-tools-version: 5.9",
      "import PackageDescription",
      "let package = Package(",
      '    name: "MyLib",',
      "    dependencies: [",
      '        .package(url: "https://example.com", from: "1.0.0"),',
      "    ],",
      "    targets: [",
      '        .target(name: "MyLib", dependencies: [.product(name: "ArgumentParser", package: "swift-argument-parser")]),',
      "    ]",
      ")",
    ].join("\n"));
    expect(manifest.packageName).toBe("MyLib");
    expect(manifest.products).toEqual(["ArgumentParser"]);
  });

  it("infers spec target base names from test file paths", () => {
    expect(inferSwiftSpecTargetBaseName("Tests/MyLibTests/ServiceTests.swift")).toBe("Service");
    expect(inferSwiftSpecTargetBaseName("ServiceTest.swift")).toBe("Service");
  });
});