import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import type { ProductGraphEdge, ProductGraphProjection, ProductGraphProjectionNode } from "@openagentgraph/shared";
import { scanWorkspaceCodebase, scanWorkspaceRelativePaths } from "./codeScanner.js";

const tempWorkspacePaths: string[] = [];

function makeTempWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-scanner-"));
  tempWorkspacePaths.push(workspaceRoot);
  return workspaceRoot;
}

function projectionNode(input: Partial<ProductGraphProjectionNode> = {}): ProductGraphProjectionNode {
  const now = "2026-05-31T00:00:00.000Z";
  return {
    id: input.id ?? "node:1",
    kind: input.kind ?? "code_file",
    title: input.title ?? "src/app.ts",
    status: input.status ?? "planned",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    incomingEdgeIds: input.incomingEdgeIds ?? [],
    outgoingEdgeIds: input.outgoingEdgeIds ?? [],
    blockedByNodeIds: input.blockedByNodeIds ?? [],
    ...input,
  };
}

function projectionEdge(input: Partial<ProductGraphEdge> = {}): ProductGraphEdge {
  const now = "2026-05-31T00:00:00.000Z";
  return {
    id: input.id ?? "edge:1",
    sourceNodeId: input.sourceNodeId ?? "symbol:1",
    targetNodeId: input.targetNodeId ?? "file:1",
    kind: input.kind ?? "belongs_to",
    trust: input.trust ?? "extracted",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    ...input,
  };
}

function makeProjection(input: {
  nodes?: ProductGraphProjection["nodes"];
  edges?: ProductGraphEdge[];
} = {}): ProductGraphProjection {
  const nodes = input.nodes ?? [];
  const edges = input.edges ?? [];
  return {
    schemaVersion: "1",
    productGraphId: "default",
    nodes,
    edges,
    events: [],
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesByKind: {},
      edgesByKind: {},
      unresolvedOpenQuestionCount: 0,
      blockedTaskCount: 0,
    },
  };
}

function writeSemanticWorkspace(workspaceRoot: string) {
  fs.mkdirSync(path.join(workspaceRoot, "src", "barrel"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "src", "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: {
          "@barrel": ["src/barrel/index.ts"],
          "@lib/*": ["src/lib/*"],
        },
      },
    })
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "src", "contracts.ts"),
    [
      "export interface Runnable {",
      "  run(): string;",
      "}",
      "export class BaseService {",
      "  base() { return 'base'; }",
      "}",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "src", "barrel", "index.ts"),
    "export { BaseService, Runnable } from '../contracts';\n"
  );
  fs.writeFileSync(path.join(workspaceRoot, "src", "lib", "tools.ts"), "export function makeTool() { return 'tool'; }\n");
  fs.writeFileSync(
    path.join(workspaceRoot, "src", "consumer.ts"),
    [
      "import { makeTool } from '@lib/tools';",
      "import { BaseService, type Runnable } from '@barrel';",
      "export class Consumer extends BaseService implements Runnable {",
      "  private static build() { return makeTool(); }",
      "  public async run() { return makeTool(); }",
      "}",
    ].join("\n")
  );
}

function writeMonorepoSemanticWorkspace(workspaceRoot: string) {
  fs.mkdirSync(path.join(workspaceRoot, "packages", "app", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, "packages", "app", "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: {
          "@app/*": ["src/*"],
        },
      },
    })
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "packages", "app", "src", "util.ts"),
    "export function util() { return 'ok'; }\n"
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "packages", "app", "src", "consumer.ts"),
    "import { util } from '@app/util';\nexport function consumer() { return util(); }\n"
  );
  fs.mkdirSync(path.join(workspaceRoot, "packages", "app", "build"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, "packages", "app", "build", "generated.ts"),
    "export function generated() { return 'noise'; }\n"
  );
}

function writeNestedNamedSemanticWorkspace(workspaceRoot: string, options: { invalidSiblingConfig?: boolean; unconfiguredRootFile?: boolean } = {}) {
  fs.mkdirSync(path.join(workspaceRoot, "desktop", "src", "renderer"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "desktop", "electron"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, "desktop", "tsconfig.renderer.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: {
          "@renderer/*": ["src/renderer/*"],
        },
      },
      include: ["src/renderer/**/*"],
    })
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "desktop", "tsconfig.electron.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        baseUrl: ".",
        paths: {
          "@electron/*": ["electron/*"],
        },
      },
      include: ["electron/**/*.ts"],
    })
  );
  if (options.invalidSiblingConfig) {
    fs.writeFileSync(path.join(workspaceRoot, "desktop", "tsconfig.bad.json"), "{ invalid json");
  }
  fs.writeFileSync(
    path.join(workspaceRoot, "desktop", "src", "renderer", "util.ts"),
    "export function rendererUtil() { return 'renderer'; }\n"
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "desktop", "src", "renderer", "app.ts"),
    "import { rendererUtil } from '@renderer/util';\nexport function app() { return rendererUtil(); }\n"
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "desktop", "electron", "preload.ts"),
    "export function preload() { return 'preload'; }\n"
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "desktop", "electron", "main.ts"),
    "import { preload } from '@electron/preload';\nexport function main() { return preload(); }\n"
  );
  fs.mkdirSync(path.join(workspaceRoot, "desktop", "node_modules", "vendor"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "desktop", "node_modules", "vendor", "tsconfig.json"), "{}\n");
  fs.mkdirSync(path.join(workspaceRoot, "desktop", "dist"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "desktop", "dist", "tsconfig.json"), "{}\n");
  if (options.unconfiguredRootFile) {
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "server.ts"), "export function server() { return 'root'; }\n");
  }
}

function semanticRelationKeys(edges: ProductGraphEdge[]) {
  return new Set(
    edges
      .filter((edge) => ["uses", "exports", "extends", "implements"].includes(edge.kind))
      .map((edge) => `${edge.kind}:${edge.metadata?.scannerSourceSymbol}:${edge.metadata?.scannerTargetSymbol}`)
  );
}

describe("code scanner", () => {
  afterEach(() => {
    for (const workspaceRoot of tempWorkspacePaths.splice(0)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not archive stale scan output when the scan is partial", async () => {
    const workspaceRoot = path.join(makeTempWorkspace(), "missing");
    const existingNode = projectionNode({
      id: "code-scan:file:removed",
      source: { kind: "code_scan", label: "Codebase scan", path: "src/removed.ts" },
    });
    const existingEdge = projectionEdge({
      id: "code-scan:edge:removed",
      sourceNodeId: "code-scan:symbol:removed",
      targetNodeId: existingNode.id,
      source: { kind: "code_scan", label: "Codebase scan", path: "src/removed.ts" },
    });

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection({ nodes: [existingNode], edges: [existingEdge] }),
    });

    expect(plan.summary.partial).toBe(true);
    expect(plan.summary.skippedDirectoryCount).toBe(1);
    expect(plan.staleNodeIds).toEqual([]);
    expect(plan.staleEdgeIds).toEqual([]);
    expect(plan.summary.archivedNodeCount).toBe(0);
    expect(plan.summary.archivedEdgeCount).toBe(0);
  });

  it("does not treat run-linked code files as scanner-owned stale output", async () => {
    const workspaceRoot = makeTempWorkspace();
    const runLinkedNode = projectionNode({
      id: "code-scan:file:run-linked",
      title: "src/touched.ts",
      tags: ["openagentgraph", "code"],
      source: { kind: "openagentgraph_run", label: "Execution run", path: "src/touched.ts" },
      metadata: { openAgentGraphRunFilePath: "src/touched.ts" },
    });

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection({ nodes: [runLinkedNode] }),
    });

    expect(plan.summary.partial).toBe(false);
    expect(plan.staleNodeIds).toEqual([]);
  });

  it("skips generated output directories while scanning source files", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".pytest_cache", "v", "cache"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".ruff_cache", "0.15.12"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "desktop", "dist-electron"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "desktop", "dist-renderer", "assets"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "webview-dist", "assets"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".next", "server"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "app.ts"), "export function app() { return 'ok'; }\n");
    fs.writeFileSync(path.join(workspaceRoot, ".pytest_cache", "v", "cache", "nodeids"), "[]\n");
    fs.writeFileSync(path.join(workspaceRoot, ".ruff_cache", "0.15.12", "CACHEDIR.TAG"), "Signature: 8a477f597d28d172789f06886806bc55\n");
    fs.writeFileSync(path.join(workspaceRoot, "desktop", "dist-electron", "main.js"), "export const generatedMain = true;\n");
    fs.writeFileSync(path.join(workspaceRoot, "desktop", "dist-renderer", "assets", "index.js"), "x".repeat(600_000));
    fs.writeFileSync(path.join(workspaceRoot, "webview-dist", "assets", "bundle.js"), "export function bundled() {}\n");
    fs.writeFileSync(path.join(workspaceRoot, ".next", "server", "page.js"), "export function generated() {}\n");

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary.partial).toBe(false);
    expect(plan.summary.fileCount).toBe(1);
    expect(plan.summary.skippedDirectoryCount).toBe(6);
    expect(plan.nodes.map((node) => node.title)).toContain("src/app.ts");
    expect(plan.nodes.map((node) => node.title)).not.toContain("desktop/dist-electron/main.js");
    expect(plan.nodes.map((node) => node.title)).not.toContain("desktop/dist-renderer/assets/index.js");
    expect(plan.nodes.map((node) => node.title)).not.toContain("webview-dist/assets/bundle.js");
    expect(plan.nodes.map((node) => node.title)).not.toContain(".next/server/page.js");
  });

  it("indexes dotnet source and config files while skipping bin and obj output", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "bin", "Release"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "obj", "Debug"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "graphify-out"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "App.sln"), "Microsoft Visual Studio Solution File\n");
    fs.writeFileSync(path.join(workspaceRoot, "src", "App.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "Player.cs"),
      [
        "namespace Demo;",
        "public interface IPlayer { }",
        "public class PlayerService { }",
      ].join("\n")
    );
    fs.writeFileSync(path.join(workspaceRoot, "src", "MainWindow.xaml"), "<Window xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" />\n");
    fs.writeFileSync(path.join(workspaceRoot, "bin", "Release", "libvlc.js"), "export const generated = true;\n");
    fs.writeFileSync(path.join(workspaceRoot, "obj", "Debug", "App.g.cs"), "public class Generated { }\n");
    fs.writeFileSync(path.join(workspaceRoot, "graphify-out", "graph.json"), "{}\n");

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    const titles = plan.nodes.map((node) => node.title);
    expect(titles).toEqual(expect.arrayContaining([
      "App.sln",
      "src/App.csproj",
      "src/Player.cs",
      "src/MainWindow.xaml",
    ]));
    expect(titles).not.toContain("bin/Release/libvlc.js");
    expect(titles).not.toContain("obj/Debug/App.g.cs");
    expect(titles).not.toContain("graphify-out/graph.json");

    const symbols = plan.nodes.filter((node) => node.kind === "code_symbol");
    expect(symbols.map((node) => node.title)).toEqual(expect.arrayContaining([
      "IPlayer (interface)",
      "PlayerService (class)",
    ]));
    expect(symbols.every((node) => !node.body)).toBe(true);
    expect(plan.summary.workspaceProfile?.detectedProjectTypes).toEqual(expect.arrayContaining(["dotnet"]));
    expect(plan.summary.kernelProfile?.activeScannerIds).toEqual(expect.arrayContaining(["dotnet"]));
    expect(plan.summary.skippedCountsByReason?.global ?? 0).toBeGreaterThan(0);
    expect(plan.summary.diagnostics.join("\n")).toContain("T0 structural indexing");
    expect(plan.summary.diagnostics.join("\n")).toContain("Skipped paths by reason");
    expect(plan.summary.skippedDirectoryCount).toBeGreaterThanOrEqual(3);
  });

  it("marks emergency breaker hits with visible diagnostics", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "one.ts"), "export const one = 1;\n");
    fs.writeFileSync(path.join(workspaceRoot, "src", "two.ts"), "export const two = 2;\n");
    fs.writeFileSync(path.join(workspaceRoot, "src", "three.ts"), "export const three = 3;\n");

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
      scanLimits: {
        maxFiles: 1,
      },
    });

    expect(plan.summary.partial).toBe(true);
    expect(plan.summary.fileCount).toBe(1);
    expect(plan.summary.skippedFileCount).toBe(1);
    expect(plan.summary.breakers.lightweight.state).toBe("hit");
    expect(plan.summary.breakers.lightweight.hits[0]).toMatchObject({
      key: "maxFiles",
      limit: 1,
    });
    expect(plan.summary.diagnostics.join("\n")).toContain("file count exceeded 1");
    expect(plan.summary.progress.phase).toBe("completed");
  });

  it("indexes named export lists and anonymous default exports", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "exports.ts"),
      [
        "function localHelper() { return 1; }",
        "const localArrow = () => 2;",
        "export { localHelper as exportedHelper, localArrow };",
        "export default class {",
        "  run() { return localArrow(); }",
        "}",
      ].join("\n")
    );

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    const titles = plan.nodes.map((node) => node.title).sort();
    expect(titles).toContain("exportedHelper (function)");
    expect(titles).toContain("localArrow (function)");
    expect(titles).toContain("default (class)");
    expect(plan.nodes.find((node) => node.title === "default (class)")?.metadata).toMatchObject({
      methodCount: 1,
      methodNames: "run",
    });
  });

  it("creates conservative file dependency edges and module communities without method nodes", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "packages", "api", "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "packages", "shared", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "packages", "api", "src", "index.ts"),
      [
        "import express from 'express';",
        "import type { SharedType } from '../../shared/src/types';",
        "import { shared } from '../../shared/src/util';",
        "import { shared as sharedAgain } from '../../shared/src/util';",
        "import { nodeNextHelper } from './node-next-helper.js';",
        "import { missing } from './missing';",
        "export { helper } from './helper';",
        "export { indexed } from './indexed';",
        "const lazy = () => import('./lazy');",
        "const legacy = require('./legacy');",
        "export class ApiController {",
        "  handle() { return [shared(), sharedAgain(), nodeNextHelper(), missing]; }",
        "}",
      ].join("\n")
    );
    fs.mkdirSync(path.join(workspaceRoot, "packages", "api", "src", "indexed"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "packages", "api", "src", "helper.ts"), "export function helper() { return 'helper'; }\n");
    fs.writeFileSync(path.join(workspaceRoot, "packages", "api", "src", "indexed", "index.ts"), "export function indexed() { return 'indexed'; }\n");
    fs.writeFileSync(path.join(workspaceRoot, "packages", "api", "src", "lazy.ts"), "export function lazy() { return 'lazy'; }\n");
    fs.writeFileSync(path.join(workspaceRoot, "packages", "api", "src", "legacy.js"), "exports.legacy = true;\n");
    fs.writeFileSync(path.join(workspaceRoot, "packages", "api", "src", "node-next-helper.ts"), "export function nodeNextHelper() { return 'node-next'; }\n");
    fs.writeFileSync(path.join(workspaceRoot, "packages", "shared", "src", "types.ts"), "export interface SharedType { id: string }\n");
    fs.writeFileSync(path.join(workspaceRoot, "packages", "shared", "src", "util.ts"), "export function shared() { return 'shared'; }\n");

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    const fileNodeByPath = new Map(
      plan.nodes
        .filter((node) => node.kind === "code_file")
        .map((node) => [node.metadata?.scannerSourceFile, node])
    );
    const indexNode = fileNodeByPath.get("packages/api/src/index.ts");
    expect(indexNode?.metadata).toMatchObject({
      scannerImportCount: 10,
      scannerResolvedDependencyCount: 8,
      scannerExternalDependencyCount: 1,
      scannerUnresolvedDependencyCount: 1,
    });
    expect(indexNode?.metadata?.scannerExternalDependencies).toBe("express");
    expect(indexNode?.metadata?.scannerUnresolvedDependencies).toBe("./missing");

    const fileDependencyEdges = plan.edges.filter((edge) => edge.metadata?.scannerRelation === "module_dependency");
    expect(fileDependencyEdges).toHaveLength(7);
    expect(fileDependencyEdges.map((edge) => edge.metadata?.scannerTargetFile).sort()).toEqual([
      "packages/api/src/helper.ts",
      "packages/api/src/indexed/index.ts",
      "packages/api/src/lazy.ts",
      "packages/api/src/legacy.js",
      "packages/api/src/node-next-helper.ts",
      "packages/shared/src/types.ts",
      "packages/shared/src/util.ts",
    ]);
    expect(fileDependencyEdges.find((edge) => edge.metadata?.scannerTargetFile === "packages/shared/src/util.ts")?.metadata).toMatchObject({
      scannerDependencyCount: 2,
      scannerDependencySpecifiers: "../../shared/src/util",
    });
    expect(fileDependencyEdges.some((edge) => edge.metadata?.scannerTypeOnlyDependencyCount === 1)).toBe(true);

    const communityNodes = plan.nodes.filter((node) => node.kind === "code_community");
    expect(communityNodes.map((node) => node.metadata?.scannerCommunityPath).sort()).toEqual([
      "packages/api",
      "packages/shared",
    ]);
    const communityDependencyEdges = plan.edges.filter((edge) => edge.metadata?.scannerRelation === "module_dependency_cluster");
    expect(communityDependencyEdges).toHaveLength(1);
    expect(communityDependencyEdges[0]?.metadata).toMatchObject({
      scannerSourceCommunity: "packages/api",
      scannerTargetCommunity: "packages/shared",
      scannerDependencyCount: 3,
    });

    expect(plan.nodes.map((node) => node.title)).toContain("ApiController (class)");
    expect(plan.nodes.map((node) => node.title)).not.toContain("handle (method)");
    expect(plan.summary).toMatchObject({
      fileCount: 8,
      communityCount: 2,
      dependencyEdgeCount: 7,
      externalDependencyCount: 1,
      unresolvedDependencyCount: 1,
      partial: false,
    });
  });

  it("resolves semantic module dependencies through path aliases and barrels", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeSemanticWorkspace(workspaceRoot);

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary).toMatchObject({
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticResolutionCount: 3,
    });

    const semanticModuleEdges = plan.edges.filter((edge) =>
      edge.metadata?.scannerRelation === "module_dependency" && edge.metadata?.scannerResolution === "semantic"
    );
    expect(semanticModuleEdges.map((edge) => edge.metadata?.scannerTargetFile).sort()).toEqual([
      "src/barrel/index.ts",
      "src/contracts.ts",
      "src/lib/tools.ts",
    ]);
  });

  it("discovers package-level tsconfig files from a monorepo scan root", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeMonorepoSemanticWorkspace(workspaceRoot);

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary).toMatchObject({
      fileCount: 2,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticResolutionCount: 1,
      skippedDirectoryCount: 1,
      partial: false,
    });
    expect(plan.summary.semanticFallbackReason).toBeUndefined();
    const semanticModuleEdges = plan.edges.filter((edge) =>
      edge.metadata?.scannerRelation === "module_dependency" && edge.metadata?.scannerResolution === "semantic"
    );
    expect(semanticModuleEdges.map((edge) => edge.metadata?.scannerTargetFile)).toEqual([
      "packages/app/src/util.ts",
    ]);
    const communityNode = plan.nodes.find((node) => node.kind === "code_community" && node.title === "packages/app");
    expect(communityNode?.metadata).toMatchObject({
      scannerPartial: false,
      scannerSkippedDirectoryCount: 1,
      scannerSemanticAnalysisEnabled: true,
      scannerSemanticAnalysisSucceeded: true,
      scannerSemanticResolutionCount: 1,
    });
  });

  it("discovers nested named tsconfig files from an app directory", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeNestedNamedSemanticWorkspace(workspaceRoot);

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary).toMatchObject({
      fileCount: 4,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticConfigCount: 2,
      semanticConfiguredFileCount: 4,
      semanticSyntheticFileCount: 0,
      semanticUnconfiguredFileCount: 0,
      semanticResolutionCount: 2,
      skippedDirectoryCount: 2,
      partial: false,
    });
    expect(plan.summary.semanticConfigPaths).toEqual([
      "desktop/tsconfig.electron.json",
      "desktop/tsconfig.renderer.json",
    ]);
    expect(plan.summary.semanticFallbackReason).toBeUndefined();
    const semanticModuleEdges = plan.edges.filter((edge) =>
      edge.metadata?.scannerRelation === "module_dependency" && edge.metadata?.scannerResolution === "semantic"
    );
    expect(semanticModuleEdges.map((edge) => edge.metadata?.scannerTargetFile).sort()).toEqual([
      "desktop/electron/preload.ts",
      "desktop/src/renderer/util.ts",
    ]);
    const communityNode = plan.nodes.find((node) => node.kind === "code_community" && node.title === "desktop");
    expect(communityNode?.metadata).toMatchObject({
      scannerSemanticConfigCount: 2,
      scannerSemanticConfiguredFileCount: 4,
      scannerSemanticSyntheticFileCount: 0,
      scannerSemanticUnconfiguredFileCount: 0,
      scannerSemanticConfigPaths: "desktop/tsconfig.electron.json, desktop/tsconfig.renderer.json",
    });
  });

  it("keeps semantic analysis when one named config is invalid", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeNestedNamedSemanticWorkspace(workspaceRoot, { invalidSiblingConfig: true });

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary).toMatchObject({
      fileCount: 4,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticConfigCount: 2,
      semanticConfiguredFileCount: 4,
      semanticSyntheticFileCount: 0,
      semanticUnconfiguredFileCount: 0,
      semanticResolutionCount: 2,
    });
    expect(plan.summary.semanticFallbackReason).toBeUndefined();
  });

  it("covers scanned files outside semantic configs with a synthetic JS/TS program", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeNestedNamedSemanticWorkspace(workspaceRoot, { unconfiguredRootFile: true });

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary).toMatchObject({
      fileCount: 5,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticConfigCount: 2,
      semanticConfiguredFileCount: 4,
      semanticSyntheticFileCount: 1,
      semanticUnconfiguredFileCount: 0,
      semanticResolutionCount: 2,
      partial: false,
    });
  });

  it("reports synthetic semantic fallback failure when configured files still succeed", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeNestedNamedSemanticWorkspace(workspaceRoot, { unconfiguredRootFile: true });
    let nowCallCount = 0;

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
      semanticAnalysisBudget: {
        maxDurationMs: 1,
        now: () => {
          nowCallCount += 1;
          return nowCallCount < 20 ? 0 : 1;
        },
      },
    });

    expect(plan.summary).toMatchObject({
      fileCount: 5,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticConfigCount: 2,
      semanticConfiguredFileCount: 4,
      semanticSyntheticFileCount: 0,
      semanticUnconfiguredFileCount: 1,
      partial: false,
    });
    expect(plan.summary.semanticFallbackReason).toContain("Synthetic semantic coverage could not cover 1 file");
    expect(plan.summary.semanticFallbackReason).toContain("synthetic semantic program setup");
    expect(plan.summary.diagnostics).toContain(
      `TypeScript semantic analysis: ${plan.summary.semanticFallbackReason}`
    );
  });

  it("semantically covers cjs and mjs files not included by project configs", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "electron"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["src/**/*.ts"],
      })
    );
    fs.writeFileSync(path.join(workspaceRoot, "src", "util.ts"), "export function util() { return 'ok'; }\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "app.ts"),
      "import { util } from './util';\nexport function app() { return util(); }\n"
    );
    fs.writeFileSync(path.join(workspaceRoot, "scripts", "helper.mjs"), "export function helper() { return 'help'; }\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "electron", "preload.cjs"),
      "const { helper } = require('../scripts/helper.mjs');\nexports.preload = function preload() { return helper(); };\n"
    );

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary).toMatchObject({
      fileCount: 4,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticConfigCount: 1,
      semanticConfiguredFileCount: 2,
      semanticSyntheticFileCount: 2,
      semanticUnconfiguredFileCount: 0,
      semanticResolutionCount: 2,
      partial: false,
    });
    const semanticModuleEdges = plan.edges.filter((edge) =>
      edge.metadata?.scannerRelation === "module_dependency" && edge.metadata?.scannerResolution === "semantic"
    );
    expect(semanticModuleEdges.map((edge) => edge.metadata?.scannerTargetFile).sort()).toEqual([
      "scripts/helper.mjs",
      "src/util.ts",
    ]);
  });

  it("ignores project configs inside generated folders", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "node_modules", "vendor"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "dist"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "build"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "app.ts"), "export function app() { return 'ok'; }\n");
    fs.writeFileSync(path.join(workspaceRoot, "node_modules", "vendor", "tsconfig.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, "dist", "tsconfig.renderer.json"), "{}\n");
    fs.writeFileSync(path.join(workspaceRoot, "build", "tsconfig.electron.json"), "{}\n");

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary).toMatchObject({
      fileCount: 1,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticConfigCount: 0,
      semanticConfiguredFileCount: 0,
      semanticSyntheticFileCount: 1,
      semanticUnconfiguredFileCount: 0,
      skippedDirectoryCount: 3,
      partial: false,
    });
    expect(plan.summary.semanticFallbackReason).toBeUndefined();
  });

  it("uses synthetic semantic coverage when no project config exists", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "tools"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "tools", "rules.cjs"), "exports.rule = function rule() { return 'ok'; };\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "eslint.config.mjs"),
      "import { rule } from './tools/rules.cjs';\nexport default [rule()];\n"
    );

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary).toMatchObject({
      fileCount: 2,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticConfigCount: 0,
      semanticConfiguredFileCount: 0,
      semanticSyntheticFileCount: 2,
      semanticUnconfiguredFileCount: 0,
      semanticResolutionCount: 1,
      partial: false,
    });
    expect(plan.summary.semanticConfigPaths).toEqual([]);
    expect(plan.summary.semanticFallbackReason).toBeUndefined();
  });

  it("excludes generated folders while expanding broad semantic config includes", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "build", "nested"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["**/*.ts"],
      })
    );
    fs.writeFileSync(path.join(workspaceRoot, "src", "util.ts"), "export function util() { return 'ok'; }\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "app.ts"),
      "import { util } from './util';\nexport function app() { return util(); }\n"
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "build", "nested", "generated.ts"),
      "export function generated() { return 'noise'; }\n"
    );

    const originalReadDirectory = ts.sys.readDirectory;
    const directoryReads: string[][] = [];
    ts.sys.readDirectory = ((rootDir, extensions, excludes, includes, depth) => {
      directoryReads.push([...(excludes ?? [])]);
      return originalReadDirectory(rootDir, extensions, excludes, includes, depth);
    }) as typeof ts.sys.readDirectory;
    try {
      const plan = await scanWorkspaceCodebase({
        workspaceRoot,
        projection: makeProjection(),
      });

      expect(plan.summary).toMatchObject({
        fileCount: 2,
        semanticAnalysisEnabled: true,
        semanticAnalysisSucceeded: true,
        semanticConfigCount: 1,
        semanticConfiguredFileCount: 2,
        semanticSyntheticFileCount: 0,
        semanticUnconfiguredFileCount: 0,
        skippedDirectoryCount: 1,
        partial: false,
      });
      expect(plan.nodes.map((node) => node.title)).not.toContain("build/nested/generated.ts");
      expect(directoryReads.some((excludes) =>
        excludes.includes("**/build/**") && excludes.includes("**/dist/**") && excludes.includes("**/node_modules/**")
      )).toBe(true);
    } finally {
      ts.sys.readDirectory = originalReadDirectory;
    }
  });

  it("prefers relevant named semantic configs over base configs", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src", "app"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["src/app/**/*.ts"],
      })
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "tsconfig.app.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          baseUrl: ".",
          paths: {
            "@app/*": ["src/app/*"],
          },
        },
        include: ["src/app/**/*.ts"],
      })
    );
    fs.writeFileSync(path.join(workspaceRoot, "src", "app", "util.ts"), "export function util() { return 'ok'; }\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "app", "main.ts"),
      "import { util } from '@app/util';\nexport function main() { return util(); }\n"
    );

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary).toMatchObject({
      fileCount: 2,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticConfigCount: 1,
      semanticConfiguredFileCount: 2,
      semanticSyntheticFileCount: 0,
      semanticUnconfiguredFileCount: 0,
      semanticResolutionCount: 1,
    });
    expect(plan.summary.semanticConfigPaths).toEqual(["tsconfig.app.json"]);
    const semanticModuleEdges = plan.edges.filter((edge) =>
      edge.metadata?.scannerRelation === "module_dependency" && edge.metadata?.scannerResolution === "semantic"
    );
    expect(semanticModuleEdges.map((edge) => edge.metadata?.scannerTargetFile)).toEqual([
      "src/app/util.ts",
    ]);
  });

  it("keeps semantic analysis enabled past the old short startup budget by default", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeSemanticWorkspace(workspaceRoot);
    let nowCallCount = 0;

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
      semanticAnalysisBudget: {
        now: () => {
          nowCallCount += 1;
          return nowCallCount === 1 ? 0 : 2_600;
        },
      },
    });

    expect(plan.summary).toMatchObject({
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
    });
    expect(plan.summary.semanticFallbackReason).toBeUndefined();
  });

  it("preserves semantic coverage diagnostics when program setup times out", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeSemanticWorkspace(workspaceRoot);
    let nowCallCount = 0;

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
      semanticAnalysisBudget: {
        maxDurationMs: 1,
        now: () => {
          nowCallCount += 1;
          return nowCallCount < 12 ? 0 : 1;
        },
      },
    });

    expect(plan.summary).toMatchObject({
      fileCount: 4,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: false,
      semanticConfigCount: 0,
      semanticConfiguredFileCount: 0,
      semanticSyntheticFileCount: 0,
      semanticUnconfiguredFileCount: 4,
      semanticResolutionCount: 0,
    });
    expect(plan.summary.semanticFallbackReason).toContain("semantic program setup");
  });

  it("adds semantic uses edges between known code symbols", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeSemanticWorkspace(workspaceRoot);

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(semanticRelationKeys(plan.edges).has("uses:Consumer:makeTool")).toBe(true);
  });

  it("adds semantic export, extends, and implements relationships", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeSemanticWorkspace(workspaceRoot);

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    const relationTargets = semanticRelationKeys(plan.edges);
    expect(relationTargets.has("exports:BaseService:BaseService")).toBe(true);
    expect(relationTargets.has("exports:Runnable:Runnable")).toBe(true);
    expect(relationTargets.has("extends:Consumer:BaseService")).toBe(true);
    expect(relationTargets.has("implements:Consumer:Runnable")).toBe(true);
  });

  it("keeps class method intelligence as metadata without method nodes by default", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeSemanticWorkspace(workspaceRoot);

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    const consumerNode = plan.nodes.find((node) => node.title === "Consumer (class)");
    expect(consumerNode?.metadata).toMatchObject({
      methodCount: 2,
      methodStaticNames: "build",
      methodAsyncNames: "run",
    });
    expect(String(consumerNode?.metadata?.methodDetails)).toContain("private static build@");
    expect(String(consumerNode?.metadata?.methodDetails)).toContain("public async run@");
    expect(plan.nodes.map((node) => node.title)).not.toContain("Consumer.run (method)");
  });

  it("uses synthetic semantic coverage when project config parsing fails", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "tsconfig.json"), "{ invalid json");
    fs.writeFileSync(path.join(workspaceRoot, "src", "app.ts"), "export function app() { return 'ok'; }\n");

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });

    expect(plan.summary).toMatchObject({
      fileCount: 1,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: true,
      semanticEdgeCount: 0,
      semanticResolutionCount: 0,
      semanticConfigCount: 0,
      semanticConfiguredFileCount: 0,
      semanticSyntheticFileCount: 1,
      semanticUnconfiguredFileCount: 0,
    });
    expect(plan.summary.semanticFallbackReason).toBeUndefined();
    expect(plan.nodes.map((node) => node.title)).toContain("app (function)");
  });

  it("falls back to lightweight scanning when semantic analysis exceeds its budget", async () => {
    const workspaceRoot = makeTempWorkspace();
    writeSemanticWorkspace(workspaceRoot);

    const plan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
      semanticAnalysisBudget: { maxDurationMs: 0 },
    });

    expect(plan.summary).toMatchObject({
      fileCount: 4,
      semanticAnalysisEnabled: true,
      semanticAnalysisSucceeded: false,
      semanticEdgeCount: 0,
      semanticResolutionCount: 0,
    });
    expect(plan.summary.semanticFallbackReason).toContain("budget");
    expect(plan.nodes.map((node) => node.title)).toContain("Consumer (class)");
  });

  it("surfaces unresolved script references in full and partial scan diagnostics", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "scripts", "deploy.ps1"),
      '. "$PSScriptRoot\\Missing.ps1"\n'
    );

    const fullPlan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });
    expect(fullPlan.summary.diagnostics.some((diagnostic) =>
      diagnostic.includes("Unresolved script dot_sources in scripts/deploy.ps1: Missing.ps1"))).toBe(true);

    const partialPlan = await scanWorkspaceRelativePaths({
      workspaceRoot,
      relativePaths: ["scripts/deploy.ps1"],
    });
    expect(partialPlan.summary.diagnostics.some((diagnostic) =>
      diagnostic.includes("Unresolved script dot_sources in scripts/deploy.ps1: Missing.ps1"))).toBe(true);
  });

  it("promotes method nodes only when the internal flag is enabled", async () => {
    const workspaceRoot = makeTempWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "worker.ts"),
      [
        "export class Worker {",
        "  run() { return 'ok'; }",
        "}",
      ].join("\n")
    );

    const defaultPlan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
    });
    expect(defaultPlan.nodes.map((node) => node.title)).not.toContain("Worker.run (method)");

    const promotedPlan = await scanWorkspaceCodebase({
      workspaceRoot,
      projection: makeProjection(),
      promoteMethodNodes: true,
    });
    expect(promotedPlan.nodes.map((node) => node.title)).toContain("Worker.run (method)");
    expect(promotedPlan.edges.some((edge) => edge.metadata?.scannerRelation === "class_member")).toBe(true);
  });
});
