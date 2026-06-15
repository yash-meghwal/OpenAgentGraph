import { describe, expect, it } from "vitest";
import { parseEcosystemFile, indexEcosystemFile } from "./ecosystemScanner.js";

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