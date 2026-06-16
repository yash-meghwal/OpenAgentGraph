import { describe, expect, it } from "vitest";
import {
  buildJavaKotlinWorkspaceIndex,
  isResolvedEcosystemRelationshipEdge,
  parseEcosystemFile,
  indexEcosystemFile,
  resolveJavaKotlinImportTarget,
} from "./ecosystemScanner.js";

function stableId(prefix: string, raw: string) {
  return `${prefix}:${raw}`;
}

describe("ecosystem scanner", () => {
  it("parses python classes and functions", () => {
    const index = parseEcosystemFile({
      filePath: "myapp/models.py",
      fileName: "models.py",
      extension: ".py",
      body: [
        "from django.db import models",
        "",
        "class User(models.Model):",
        "    email = models.EmailField()",
        "",
        "def normalize_email(value: str) -> str:",
        "    return value.lower()",
      ].join("\n"),
    });
    expect(index?.symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(["User", "normalize_email"])
    );
    const normalizeEmail = index?.symbols.find((symbol) => symbol.name === "normalize_email");
    expect(normalizeEmail?.parentType).toBeUndefined();
  });

  it("keeps indented Python methods under their class", () => {
    const index = parseEcosystemFile({
      filePath: "myapp/models.py",
      fileName: "models.py",
      extension: ".py",
      body: [
        "class User:",
        "    def save(self):",
        "        pass",
      ].join("\n"),
    });
    const save = index?.symbols.find((symbol) => symbol.name === "save");
    expect(save?.parentType).toBe("User");
  });

  it("parses grouped go import blocks", () => {
    const index = parseEcosystemFile({
      filePath: "cmd/app/main.go",
      fileName: "main.go",
      extension: ".go",
      body: [
        "package main",
        "",
        "import (",
        '    "fmt"',
        '    "example.com/fixture-go-module/internal/service"',
        ")",
        "",
        "func main() {}",
      ].join("\n"),
    });
    expect(index?.imports).toEqual(
      expect.arrayContaining(["fmt", "example.com/fixture-go-module/internal/service"])
    );
  });

  it("parses go packages, structs, and functions", () => {
    const index = parseEcosystemFile({
      filePath: "internal/service/service.go",
      fileName: "service.go",
      extension: ".go",
      body: [
        "package service",
        "",
        "type Runner struct{}",
        "",
        "func Run() {",
        "}",
      ].join("\n"),
    });
    expect(index?.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual(
      expect.arrayContaining(["service:package", "Runner:struct", "Run:function"])
    );
  });

  it("parses java packages, classes, methods, and imports", () => {
    const index = parseEcosystemFile({
      filePath: "src/main/java/com/example/checkout/CheckoutService.java",
      fileName: "CheckoutService.java",
      extension: ".java",
      body: [
        "package com.example.checkout;",
        "",
        "import com.example.checkout.model.Order;",
        "",
        "public class CheckoutService {",
        "    public String process(Order order) {",
        '        return "ok";',
        "    }",
        "}",
      ].join("\n"),
    });
    expect(index?.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual(
      expect.arrayContaining([
        "com.example.checkout:package",
        "CheckoutService:class",
        "process:method",
      ])
    );
    expect(index?.imports).toContain("com.example.checkout.model.Order");
    const process = index?.symbols.find((symbol) => symbol.name === "process");
    expect(process?.parentType).toBe("CheckoutService");
  });

  it("keeps kotlin top-level functions outside the previous class scope", () => {
    const index = parseEcosystemFile({
      filePath: "src/main/kotlin/com/example/Service.kt",
      fileName: "Service.kt",
      extension: ".kt",
      body: [
        "class Service {",
        "    fun member() {}",
        "}",
        "",
        "fun topLevel() {}",
      ].join("\n"),
    });
    const member = index?.symbols.find((symbol) => symbol.name === "member");
    const topLevel = index?.symbols.find((symbol) => symbol.name === "topLevel");
    expect(member?.parentType).toBe("Service");
    expect(topLevel?.parentType).toBeUndefined();
  });

  it("parses kotlin classes, functions, and imports", () => {
    const index = parseEcosystemFile({
      filePath: "src/main/kotlin/com/example/checkout/CheckoutService.kt",
      fileName: "CheckoutService.kt",
      extension: ".kt",
      body: [
        "package com.example.checkout",
        "",
        "import com.example.checkout.model.Order",
        "",
        "class CheckoutService {",
        "    fun process(order: Order): String {",
        '        return "ok"',
        "    }",
        "}",
      ].join("\n"),
    });
    expect(index?.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual(
      expect.arrayContaining([
        "com.example.checkout:package",
        "CheckoutService:class",
        "process:function",
      ])
    );
    expect(index?.imports).toContain("com.example.checkout.model.Order");
  });

  it("parses terraform resources and modules", () => {
    const index = parseEcosystemFile({
      filePath: "main.tf",
      fileName: "main.tf",
      extension: ".tf",
      body: [
        'module "vpc" {',
        '  source = "./modules/vpc"',
        "}",
        "",
        'resource "aws_s3_bucket" "logs" {',
        '  bucket = "fixture-logs"',
        "}",
      ].join("\n"),
    });
    expect(index?.symbols.map((symbol) => symbol.kind)).toEqual(
      expect.arrayContaining(["module", "resource"])
    );
    expect(index?.imports).toContain("./modules/vpc");
  });

  it("resolves workspace java imports to known class symbols", () => {
    const files = [
      {
        relativePath: "src/main/java/com/example/checkout/CheckoutService.java",
        body: [
          "package com.example.checkout;",
          "import com.example.checkout.model.Order;",
          "public class CheckoutService {}",
        ].join("\n"),
      },
      {
        relativePath: "src/main/java/com/example/checkout/model/Order.java",
        body: [
          "package com.example.checkout.model;",
          "public class Order {}",
        ].join("\n"),
      },
    ];
    const index = buildJavaKotlinWorkspaceIndex(files);
    const fileNodeIdsByPath = new Map(
      files.map((file) => [file.relativePath, `code-scan:file:${file.relativePath}`])
    );
    const resolved = resolveJavaKotlinImportTarget({
      importPath: "com.example.checkout.model.Order",
      index,
      fileNodeIdsByPath,
      stableId,
    });
    expect(resolved?.resolution).toBe("symbol");
    expect(resolved?.targetNodeId).toBe(
      "code-scan:symbol:src/main/java/com/example/checkout/model/Order.java|file|class|Order"
    );
  });

  it("creates explicit external targets for unresolved java imports", () => {
    const resolved = resolveJavaKotlinImportTarget({
      importPath: "org.junit.jupiter.api.Test",
      index: buildJavaKotlinWorkspaceIndex([]),
      fileNodeIdsByPath: new Map(),
      stableId,
    });
    expect(resolved?.resolution).toBe("external");
    expect(resolved?.targetNodeId).toBe("code-scan:external:java-kotlin|org.junit.jupiter.api.Test");
  });

  it("does not emit per-file java import edges before workspace augmentation", () => {
    const contribution = indexEcosystemFile({
      filePath: "src/main/java/com/example/checkout/CheckoutService.java",
      fileName: "CheckoutService.java",
      extension: ".java",
      body: "package com.example.checkout;\nimport com.example.checkout.model.Order;\npublic class CheckoutService {}",
      sizeBytes: 120,
      scanId: "scan-1",
      scannedAt: "2026-06-15T00:00:00.000Z",
      stableId,
      compactMetadata: (values) => values as Record<string, string>,
      sourceRef: (projectPath) => ({ kind: "code_scan", path: projectPath }),
      maxTitleLength: 180,
      maxEdgeLabelLength: 180,
    });
    expect(contribution.edges.some((edge) => edge.metadata?.scannerRelation === "import")).toBe(false);
  });

  it("flags dangling import edges when endpoints are missing", () => {
    const knownNodeIds = new Set(["source"]);
    expect(
      isResolvedEcosystemRelationshipEdge(
        {
          id: "edge-1",
          kind: "depends_on",
          sourceNodeId: "source",
          targetNodeId: "missing",
          metadata: { scannerRelation: "import" },
        } as never,
        knownNodeIds
      )
    ).toBe(false);
  });

  it("indexes ecosystem symbols into product graph nodes", () => {
    const contribution = indexEcosystemFile({
      filePath: "myapp/models.py",
      fileName: "models.py",
      extension: ".py",
      body: "class Post:\n    pass\n",
      sizeBytes: 24,
      scanId: "scan-1",
      scannedAt: "2026-06-15T00:00:00.000Z",
      stableId,
      compactMetadata: (values) => values as Record<string, string>,
      sourceRef: (projectPath) => ({ kind: "code_scan", path: projectPath }),
      maxTitleLength: 180,
      maxEdgeLabelLength: 180,
    });
    expect(contribution.symbolNodes.some((node) => node.title.includes("Post"))).toBe(true);
    expect(contribution.edges.some((edge) => edge.metadata?.scannerRelation === "declares")).toBe(true);
  });
});