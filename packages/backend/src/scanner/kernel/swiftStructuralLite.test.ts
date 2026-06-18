import { describe, expect, it } from "vitest";
import {
  augmentSwiftStructuralLite,
  buildSwiftWorkspaceIndex,
  mapSwiftStructuralRelationToProductEdgeKind,
} from "./swiftStructuralLite.js";

const stableId = (prefix: string, raw: string) => `${prefix}:${raw}`;
const compactMetadata = (values: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));

describe("swift structural-lite", () => {
  it("maps structural relations to product edge kinds", () => {
    expect(mapSwiftStructuralRelationToProductEdgeKind("conforms_to")).toBe("implements");
    expect(mapSwiftStructuralRelationToProductEdgeKind("extends")).toBe("extends");
    expect(mapSwiftStructuralRelationToProductEdgeKind("tests")).toBe("depends_on");
    expect(mapSwiftStructuralRelationToProductEdgeKind("package_dependency")).toBe("depends_on");
  });

  it("emits import, conformance, extension, package, and test edges", () => {
    const files = [
      {
        relativePath: "Package.swift",
        body: [
          'let package = Package(name: "MyLib", targets: [',
          '    .target(name: "MyLib", dependencies: [.product(name: "ArgumentParser", package: "swift-argument-parser")])',
          "])",
        ].join("\n"),
      },
      {
        relativePath: "Sources/MyLib/Service.swift",
        body: [
          "import Foundation",
          "public protocol Greeter { func greet() -> String }",
          "public struct Service: Greeter {",
          "    public func greet() -> String { \"hello\" }",
          "}",
          "extension Service {",
          "    func label() -> String { greet() }",
          "}",
        ].join("\n"),
      },
      {
        relativePath: "Tests/MyLibTests/ServiceTests.swift",
        body: "import XCTest\nfinal class ServiceTests: XCTestCase {}\n",
      },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const index = buildSwiftWorkspaceIndex(files);
    expect(index.typeBySimpleName.get("Service")?.kind).toBe("struct");
    const semantic = augmentSwiftStructuralLite({
      scanId: "scan-swift",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    expect(semantic.result.active).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "import")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "conforms_to")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "extends")).toBe(true);
    expect(semantic.edges.some((edge) => edge.kind === "extends")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "package_dependency")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "tests")).toBe(true);
  });

  it("emits class inheritance as extends, not implements", () => {
    const files = [
      {
        relativePath: "Sources/AppDelegate.swift",
        body: "class AppDelegate: UIResponder, UIApplicationDelegate {\n}\n",
      },
    ];
    const semantic = augmentSwiftStructuralLite({
      scanId: "scan-inheritance",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath: new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)])),
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    const inheritance = semantic.edges.find((edge) => edge.metadata?.scannerRelatedType === "UIResponder");
    const conformance = semantic.edges.find((edge) => edge.metadata?.scannerRelatedType === "UIApplicationDelegate");
    expect(inheritance?.kind).toBe("extends");
    expect(inheritance?.metadata?.scannerRelation).toBe("extends");
    expect(conformance?.kind).toBe("implements");
    expect(conformance?.metadata?.scannerRelation).toBe("conforms_to");
  });
});