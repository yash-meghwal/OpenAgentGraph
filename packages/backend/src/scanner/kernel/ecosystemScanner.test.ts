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

  it("does not emit per-file import edges before workspace augmentation", () => {
    for (const sample of [
      {
        filePath: "spec/models/user_spec.rb",
        fileName: "user_spec.rb",
        extension: ".rb",
        body: "require 'rails_helper'\nclass UserSpec\nend\n",
      },
      {
        filePath: "app/Http/Controllers/UserController.php",
        fileName: "UserController.php",
        extension: ".php",
        body: "<?php\nuse App\\Models\\User;\nclass UserController {}\n",
      },
      {
        filePath: "myapp/models.py",
        fileName: "models.py",
        extension: ".py",
        body: "from django.db import models\nclass User:\n    pass\n",
      },
    ]) {
      const contribution = indexEcosystemFile({
        filePath: sample.filePath,
        fileName: sample.fileName,
        extension: sample.extension,
        body: sample.body,
        sizeBytes: sample.body.length,
        scanId: "scan-1",
        scannedAt: "2026-06-15T00:00:00.000Z",
        stableId,
        compactMetadata: (values) => values as Record<string, string>,
        sourceRef: (projectPath) => ({ kind: "code_scan", path: projectPath }),
        maxTitleLength: 180,
        maxEdgeLabelLength: 180,
      });
      expect(contribution.edges.some((edge) => edge.metadata?.scannerRelation === "import")).toBe(false);
    }
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

  it("parses ruby modules, classes, methods, and requires", () => {
    const index = parseEcosystemFile({
      filePath: "app/models/user.rb",
      fileName: "user.rb",
      extension: ".rb",
      body: [
        "require_relative '../services/user_exporter'",
        "",
        "class User < ApplicationRecord",
        "  def full_name",
        "  end",
        "end",
      ].join("\n"),
    });
    expect(index?.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual(
      expect.arrayContaining(["User:rails_model", "full_name:method"])
    );
    expect(index?.imports).toContain("relative:../services/user_exporter");
  });

  it("keeps multiple ruby methods parented to the same class", () => {
    const index = parseEcosystemFile({
      filePath: "app/models/user.rb",
      fileName: "user.rb",
      extension: ".rb",
      body: [
        "class User",
        "  def one",
        "  end",
        "  def two",
        "  end",
        "end",
      ].join("\n"),
    });
    const methods = index?.symbols.filter((symbol) => symbol.kind === "method") ?? [];
    expect(methods).toHaveLength(2);
    expect(methods.every((symbol) => symbol.parentType === "User")).toBe(true);
  });

  it("parses nested ruby module and class constant paths", () => {
    const index = parseEcosystemFile({
      filePath: "lib/mygem/runner.rb",
      fileName: "runner.rb",
      extension: ".rb",
      body: [
        "module A::B",
        "  class A::Runner",
        "    def run",
        "    end",
        "  end",
        "end",
      ].join("\n"),
    });
    const moduleSymbol = index?.symbols.find((symbol) => symbol.kind === "module");
    const classSymbol = index?.symbols.find((symbol) => symbol.kind === "class");
    const methodSymbol = index?.symbols.find((symbol) => symbol.kind === "method");
    expect(moduleSymbol).toMatchObject({ name: "B", parentType: "A" });
    expect(classSymbol).toMatchObject({ name: "Runner", parentType: "A" });
    expect(methodSymbol).toMatchObject({ name: "run", parentType: "A::Runner" });
  });

  it("restores ruby module namespace after module A::B closes", () => {
    const index = parseEcosystemFile({
      filePath: "lib/outside.rb",
      fileName: "outside.rb",
      extension: ".rb",
      body: [
        "module A::B",
        "  class Inner",
        "  end",
        "end",
        "",
        "class Outside",
        "end",
      ].join("\n"),
    });
    const outside = index?.symbols.find((symbol) => symbol.name === "Outside" && symbol.kind === "class");
    expect(outside?.parentType).toBeUndefined();
  });

  it("keeps ruby methods parented after single-line def declarations", () => {
    const index = parseEcosystemFile({
      filePath: "app/models/user.rb",
      fileName: "user.rb",
      extension: ".rb",
      body: [
        "class User",
        "  def one; end",
        "  def two",
        "  end",
        "end",
      ].join("\n"),
    });
    const methods = index?.symbols.filter((symbol) => symbol.kind === "method") ?? [];
    expect(methods).toHaveLength(2);
    expect(methods.every((symbol) => symbol.parentType === "User")).toBe(true);
  });

  it("tags ruby and php ecosystem files as semantic-lite t1.5", () => {
    for (const [filePath, body] of [
      ["app/models/user.rb", "class User\nend\n"],
      ["app/Models/User.php", "<?php\nclass User {}\n"],
    ] as const) {
      const contribution = indexEcosystemFile({
        filePath,
        fileName: filePath.split("/").pop()!,
        extension: filePath.endsWith(".rb") ? ".rb" : ".php",
        body,
        sizeBytes: body.length,
        scanId: "scan-t15",
        scannedAt: "2026-06-15T00:00:00.000Z",
        stableId,
        compactMetadata: (values) => values as Record<string, string>,
        sourceRef: (projectPath) => ({ kind: "code_scan", path: projectPath }),
        maxTitleLength: 180,
        maxEdgeLabelLength: 180,
      });
      expect(contribution.fileMetadata?.scannerIndexingMode).toBe("t1.5");
      expect(contribution.fileMetadata?.scannerSemanticSupported).toBe(true);
      expect(contribution.symbolNodes[0]?.tags).toContain("ecosystem-t1.5");
    }
  });

  it("parses swift imports, types, extensions, and protocol conformance", () => {
    const index = parseEcosystemFile({
      filePath: "Sources/MyLib/Service.swift",
      fileName: "Service.swift",
      extension: ".swift",
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
    });
    expect(index?.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual(
      expect.arrayContaining([
        "Greeter:protocol",
        "Service:struct",
        "greet:function",
        "Service:extension",
      ])
    );
    expect(index?.imports).toContain("Foundation");
    expect(index?.imports).toContain("conforms:Greeter");
    expect(index?.imports).toContain("extends:Service");
  });

  it("restores cpp namespace scope after namespace A::B closes", () => {
    const index = parseEcosystemFile({
      filePath: "src/outside.cpp",
      fileName: "outside.cpp",
      extension: ".cpp",
      body: [
        "namespace A::B {",
        "  class Inner {",
        "  };",
        "}",
        "class Outside {",
        "};",
      ].join("\n"),
    });
    const outside = index?.symbols.find((symbol) => symbol.name === "Outside" && symbol.kind === "class");
    expect(outside?.parentType).toBeUndefined();
  });

  it("parses dart imports, widgets, and pubspec metadata", () => {
    const index = parseEcosystemFile({
      filePath: "lib/main.dart",
      fileName: "main.dart",
      extension: ".dart",
      body: [
        "import 'package:flutter/material.dart';",
        "class DemoApp extends StatelessWidget {",
        "  Widget build(BuildContext context) => Container();",
        "}",
      ].join("\n"),
    });
    expect(index?.imports).toContain("package:flutter/material.dart");
    expect(index?.symbols.find((symbol) => symbol.name === "DemoApp")).toMatchObject({
      kind: "stateless_widget",
    });
    const pubspec = parseEcosystemFile({
      filePath: "pubspec.yaml",
      fileName: "pubspec.yaml",
      extension: ".yaml",
      body: [
        "name: demo_app",
        "dependencies:",
        "  http: ^1.2.0",
      ].join("\n"),
    });
    expect(pubspec?.configMetadata?.package).toBe("demo_app");
    expect(pubspec?.imports).toContain("package:http");
  });

  it("parses cpp includes, functions, and macros", () => {
    const index = parseEcosystemFile({
      filePath: "src/main.cpp",
      fileName: "main.cpp",
      extension: ".cpp",
      body: [
        '#include "service.h"',
        "#include <vector>",
        "#define MAX_RETRY 3",
        "int main() {",
        "  return run_service();",
        "}",
      ].join("\n"),
    });
    expect(index?.imports).toEqual(expect.arrayContaining([
      "local:service.h",
      "system:vector",
    ]));
    expect(index?.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual(
      expect.arrayContaining(["MAX_RETRY:macro", "main:function"])
    );
  });

  it("parses @testable import before the module name", () => {
    const index = parseEcosystemFile({
      filePath: "Tests/MyLibTests/ServiceTests.swift",
      fileName: "ServiceTests.swift",
      extension: ".swift",
      body: "@testable import MyLib\n",
    });
    expect(index?.imports).toContain("MyLib");
  });

  it("parses class inheritance separately from protocol conformance", () => {
    const index = parseEcosystemFile({
      filePath: "Sources/AppDelegate.swift",
      fileName: "AppDelegate.swift",
      extension: ".swift",
      body: "class AppDelegate: UIResponder, UIApplicationDelegate {\n}\n",
    });
    expect(index?.imports).toContain("extends:UIResponder");
    expect(index?.imports).toContain("conforms:UIApplicationDelegate");
    expect(index?.imports).not.toContain("conforms:UIResponder");
  });

  it("parses php namespaces, classes, methods, and use imports", () => {
    const index = parseEcosystemFile({
      filePath: "app/Http/Controllers/UserController.php",
      fileName: "UserController.php",
      extension: ".php",
      body: [
        "<?php",
        "namespace App\\Http\\Controllers;",
        "",
        "use App\\Models\\User;",
        "",
        "class UserController extends Controller",
        "{",
        "    public function index() {}",
        "}",
      ].join("\n"),
    });
    expect(index?.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual(
      expect.arrayContaining([
        "App\\Http\\Controllers:namespace",
        "UserController:class",
        "index:method",
      ])
    );
    expect(index?.imports).toContain("App\\Models\\User");
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

  it("treats llms.txt as a documentation file without making all .txt scannable", () => {
    const llms = parseEcosystemFile({
      filePath: "llms.txt",
      fileName: "llms.txt",
      extension: ".txt",
      body: "# Agent guide\n\nSee [README](README.md).\n",
    });
    expect(llms?.language).toBe("documentation");
    expect(llms?.headings).toContain("Agent guide");

    const notes = parseEcosystemFile({
      filePath: "notes.txt",
      fileName: "notes.txt",
      extension: ".txt",
      body: "# Notes\n",
    });
    expect(notes).toBeUndefined();
  });
});
