import { describe, expect, it } from "vitest";
import { parseEcosystemFile } from "./ecosystemScanner.js";
import {
  augmentJavaKotlinSemanticLite,
  buildJavaKotlinProjectTopology,
  mapSemanticLiteRelationToProductEdgeKind,
  resolveJavaKotlinQualifiedType,
} from "./javaKotlinSemanticLite.js";
import { buildJavaKotlinWorkspaceIndex } from "./ecosystemScanner.js";

function stableId(prefix: string, raw: string) {
  return `${prefix}:${raw}`;
}

describe("java/kotlin semantic-lite", () => {
  it("parses java extends and implements relationships", () => {
    const index = parseEcosystemFile({
      filePath: "src/main/java/com/example/api/ApiService.java",
      fileName: "ApiService.java",
      extension: ".java",
      body: [
        "package com.example.api;",
        "import com.example.core.CoreService;",
        "public class ApiService extends CoreService implements Runnable {",
        "}",
      ].join("\n"),
    });
    expect(index?.imports).toEqual(
      expect.arrayContaining(["com.example.core.CoreService", "extends:CoreService", "implements:Runnable"])
    );
  });

  it("maps semantic-lite relations to product edge kinds", () => {
    expect(mapSemanticLiteRelationToProductEdgeKind("extends")).toBe("extends");
    expect(mapSemanticLiteRelationToProductEdgeKind("implements")).toBe("implements");
    expect(mapSemanticLiteRelationToProductEdgeKind("tests")).toBe("depends_on");
    expect(mapSemanticLiteRelationToProductEdgeKind("entrypoint")).toBe("uses");
    expect(mapSemanticLiteRelationToProductEdgeKind("module_dependency")).toBe("depends_on");
  });

  it("builds gradle and maven module topology", () => {
    const topology = buildJavaKotlinProjectTopology([
      { relativePath: "settings.gradle", body: "include 'api', 'core'" },
      {
        relativePath: "pom.xml",
        body: "<project><modules><module>checkout-module</module></modules></project>",
      },
      {
        relativePath: "checkout-module/pom.xml",
        body: "<project><parent><artifactId>parent</artifactId></parent></project>",
      },
    ]);
    expect(topology.modules.map((module) => module.name)).toEqual(
      expect.arrayContaining(["root", "api", "core", "checkout-module"])
    );
    expect(topology.mavenParentChild.length).toBeGreaterThan(0);
  });

  it("builds topology for colon-prefixed and nested Gradle module names", () => {
    const topology = buildJavaKotlinProjectTopology([
      {
        relativePath: "settings.gradle",
        body: "include ':app', ':feature-checkout'\ninclude(\"feature:payments\")",
      },
    ]);
    expect(topology.modules.map((module) => module.name)).toEqual(
      expect.arrayContaining(["root", "app", "feature-checkout", "feature:payments"])
    );
    const payments = topology.modules.find((module) => module.name === "feature:payments");
    expect(payments?.directory).toBe("feature/payments");
  });

  it("emits semantic-lite edges with product edge kinds for inheritance", () => {
    const files = [
      {
        relativePath: "core/src/main/java/com/example/core/BaseService.java",
        body: "package com.example.core; public class BaseService {}",
      },
      {
        relativePath: "api/src/main/java/com/example/api/ApiService.java",
        body: [
          "package com.example.api;",
          "import com.example.core.BaseService;",
          "public class ApiService extends BaseService implements Runnable {",
          "}",
        ].join("\n"),
      },
    ];
    const parsedByPath = new Map(
      files.map((file) => [
        file.relativePath,
        parseEcosystemFile({
          filePath: file.relativePath,
          fileName: file.relativePath.split("/").pop()!,
          extension: ".java",
          body: file.body,
        })!,
      ])
    );
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, `file:${file.relativePath}`]));

    const semantic = augmentJavaKotlinSemanticLite({
      scanId: "scan-1",
      scannedAt: "2026-06-17T00:00:00.000Z",
      files,
      parsedByPath,
      fileNodeIdsByPath,
      stableId,
      compactMetadata: (values) => values as Record<string, string>,
      maxEdgeLabelLength: 180,
      maxTitleLength: 180,
    });

    expect(semantic.edges.some((edge) => edge.kind === "extends" && edge.metadata?.scannerRelation === "extends")).toBe(true);
    expect(semantic.edges.some((edge) => edge.kind === "implements" && edge.metadata?.scannerRelation === "implements")).toBe(true);
  });

  it("emits semantic-lite test and import relationship edges", () => {
    const files = [
      {
        relativePath: "api/src/main/java/com/example/api/ApiService.java",
        body: [
          "package com.example.api;",
          "import com.example.core.CoreService;",
          "public class ApiService {",
          "    public String run() { return \"ok\"; }",
          "}",
        ].join("\n"),
      },
      {
        relativePath: "core/src/main/java/com/example/core/CoreService.java",
        body: "package com.example.core; public class CoreService { public String execute() { return \"ok\"; } }",
      },
      {
        relativePath: "api/src/test/java/com/example/api/ApiServiceTest.java",
        body: [
          "package com.example.api;",
          "import org.junit.jupiter.api.Test;",
          "public class ApiServiceTest {",
          "    @Test public void runs() { new ApiService().run(); }",
          "}",
        ].join("\n"),
      },
    ];
    const parsedByPath = new Map(
      files.map((file) => [
        file.relativePath,
        parseEcosystemFile({
          filePath: file.relativePath,
          fileName: file.relativePath.split("/").pop()!,
          extension: ".java",
          body: file.body,
        })!,
      ])
    );
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, `file:${file.relativePath}`]));
    const index = buildJavaKotlinWorkspaceIndex(files);
    const qualified = resolveJavaKotlinQualifiedType({
      simpleOrQualified: "CoreService",
      packageName: "com.example.api",
      imports: ["com.example.core.CoreService"],
      index,
    });
    expect(qualified).toBe("com.example.core.CoreService");

    const semantic = augmentJavaKotlinSemanticLite({
      scanId: "scan-1",
      scannedAt: "2026-06-17T00:00:00.000Z",
      files,
      parsedByPath,
      fileNodeIdsByPath,
      stableId,
      compactMetadata: (values) => values as Record<string, string>,
      maxEdgeLabelLength: 180,
      maxTitleLength: 180,
    });

    expect(semantic.result.active).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "tests")).toBe(true);
    expect(semantic.edges.every((edge) => edge.metadata?.scannerResolution === "semantic-lite")).toBe(true);
  });
});