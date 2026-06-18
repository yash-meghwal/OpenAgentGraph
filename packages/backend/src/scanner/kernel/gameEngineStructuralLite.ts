import path from "path";
import type {
  ProductEdgeKind,
  ProductGraphEdge,
  ProductGraphNode,
  ProductMetadataValue,
} from "@openagentgraph/shared";
import { parseEcosystemFile } from "./ecosystemScanner.js";
import { resolveGodotResourcePath } from "./godotParsing.js";
import {
  parseAsmdef,
  parseGodotProject,
  parseUnrealBuildCs,
  parseUnrealProject,
} from "./gameEngineProjectParsing.js";

export const GAME_ENGINE_STRUCTURAL_LITE_VERSION = "1.0";

export interface GameEngineStructuralLiteResult {
  active: boolean;
  edgeCount: number;
  diagnostics: string[];
}

export function mapGameEngineRelationToProductEdgeKind(
  relation: "assembly_reference" | "autoload" | "scene_script" | "extends" | "module_dependency" | "main_scene"
): ProductEdgeKind {
  switch (relation) {
    case "extends":
      return "extends";
    default:
      return "depends_on";
  }
}

function buildUnityAsmdefIndex(files: Array<{ relativePath: string; body: string }>) {
  const byAssemblyName = new Map<string, string>();
  for (const file of files) {
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    if (!normalizedPath.endsWith(".asmdef")) continue;
    const asmdef = parseAsmdef(file.body);
    if (asmdef.name) byAssemblyName.set(asmdef.name, normalizedPath);
  }
  return byAssemblyName;
}

function buildUnrealModuleBuildIndex(files: Array<{ relativePath: string; body: string }>) {
  const byModuleName = new Map<string, string>();
  for (const file of files) {
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    if (!normalizedPath.endsWith(".Build.cs")) continue;
    const pathMatch = normalizedPath.match(/Source\/([^/]+)\/\1\.Build\.cs$/i);
    const build = parseUnrealBuildCs(file.body);
    const moduleName = build.moduleName ?? pathMatch?.[1];
    if (moduleName) byModuleName.set(moduleName, normalizedPath);
  }
  return byModuleName;
}

function createExternalNode(input: {
  qualifiedType: string;
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxTitleLength: number;
  language: string;
  relation?: string;
}): ProductGraphNode {
  const nodeId = input.stableId("code-scan:external", `${input.language}|${input.qualifiedType}`);
  return {
    id: nodeId,
    kind: "code_symbol",
    title: `${input.qualifiedType} (external)`.slice(0, input.maxTitleLength),
    status: "planned",
    tags: ["code", "code-scan", input.language, "ecosystem-t1", "external-dependency"],
    metadata: input.compactMetadata({
      scannerRelation: input.relation ?? "external_import",
      scannerLanguage: input.language,
      scannerIndexingMode: "t1",
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerImportPath: input.qualifiedType,
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

export function augmentGameEngineStructuralLite(input: {
  activeScannerIds: string[];
  scanId: string;
  scannedAt: string;
  files: Array<{ relativePath: string; body: string }>;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxEdgeLabelLength: number;
  maxTitleLength: number;
}): {
  edges: ProductGraphEdge[];
  externalNodes: ProductGraphNode[];
  result: GameEngineStructuralLiteResult;
} {
  const edges: ProductGraphEdge[] = [];
  const externalNodes = new Map<string, ProductGraphNode>();
  let edgeCount = 0;
  const active = new Set(input.activeScannerIds);
  const unityAsmdefByName = active.has("unity") ? buildUnityAsmdefIndex(input.files) : new Map<string, string>();
  const unrealModuleBuildByName = active.has("unreal") ? buildUnrealModuleBuildIndex(input.files) : new Map<string, string>();

  const ensureExternal = (qualifiedType: string, language: string, relation = "external_import") => {
    const node = createExternalNode({
      qualifiedType,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      stableId: input.stableId,
      compactMetadata: input.compactMetadata,
      maxTitleLength: input.maxTitleLength,
      language,
      relation,
    });
    externalNodes.set(node.id, node);
    return node.id;
  };

  const appendEdge = (edge: {
    sourceNodeId: string;
    targetNodeId: string;
    relation: "assembly_reference" | "autoload" | "scene_script" | "extends" | "module_dependency" | "main_scene";
    label: string;
    resolution: "file" | "external";
    language: string;
    metadata?: Record<string, ProductMetadataValue | undefined>;
  }) => {
    edges.push({
      id: input.stableId("code-scan:edge", `${edge.sourceNodeId}|${edge.relation}|${edge.targetNodeId}|${edge.label}`),
      kind: mapGameEngineRelationToProductEdgeKind(edge.relation),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      label: edge.label.slice(0, input.maxEdgeLabelLength),
      trust: edge.resolution === "external" ? "inferred" : "extracted",
      metadata: input.compactMetadata({
        scannerRelation: edge.relation,
        scannerLanguage: edge.language,
        scannerResolution: "structural-lite",
        scannerImportResolution: edge.resolution,
        ...edge.metadata,
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
    edgeCount += 1;
  };

  for (const file of input.files) {
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    const sourceNodeId = input.fileNodeIdsByPath.get(normalizedPath);
    if (!sourceNodeId) continue;

    if (active.has("unity") && normalizedPath.endsWith(".asmdef")) {
      const asmdef = parseAsmdef(file.body);
      for (const reference of asmdef.references) {
        const referencedAsmdefPath = unityAsmdefByName.get(reference);
        const referencedNodeId = referencedAsmdefPath
          ? input.fileNodeIdsByPath.get(referencedAsmdefPath)
          : undefined;
        appendEdge({
          sourceNodeId,
          targetNodeId: referencedNodeId ?? ensureExternal(reference, "unity", "assembly_reference"),
          relation: "assembly_reference",
          label: `assembly ${reference}`,
          resolution: referencedNodeId ? "file" : "external",
          language: "unity",
          metadata: { scannerAssemblyReference: reference },
        });
      }
      continue;
    }

    if (active.has("godot") && normalizedPath.endsWith("project.godot")) {
      const project = parseGodotProject(file.body);
      if (project.mainScene) {
        const resolved = resolveGodotResourcePath(project.mainScene, input.fileNodeIdsByPath);
        if (resolved?.targetNodeId) {
          appendEdge({
            sourceNodeId,
            targetNodeId: resolved.targetNodeId,
            relation: "main_scene",
            label: `main scene ${project.mainScene}`,
            resolution: "file",
            language: "godot",
            metadata: { scannerGodotMainScene: project.mainScene },
          });
        }
      }
      for (const autoload of project.autoloads) {
        const resolved = resolveGodotResourcePath(autoload.path, input.fileNodeIdsByPath);
        appendEdge({
          sourceNodeId,
          targetNodeId: resolved?.targetNodeId ?? ensureExternal(autoload.path, "godot", "autoload"),
          relation: "autoload",
          label: `autoload ${autoload.name}`,
          resolution: resolved ? "file" : "external",
          language: "godot",
          metadata: { scannerGodotAutoload: autoload.name, scannerImportPath: autoload.path },
        });
      }
      continue;
    }

    if (active.has("unreal") && normalizedPath.endsWith(".uproject")) {
      const project = parseUnrealProject(file.body);
      for (const moduleName of project.modules) {
        const moduleBuildPath = unrealModuleBuildByName.get(moduleName);
        const moduleNodeId = moduleBuildPath ? input.fileNodeIdsByPath.get(moduleBuildPath) : undefined;
        appendEdge({
          sourceNodeId,
          targetNodeId: moduleNodeId ?? ensureExternal(moduleName, "unreal", "module_dependency"),
          relation: "module_dependency",
          label: `module ${moduleName}`,
          resolution: moduleNodeId ? "file" : "external",
          language: "unreal",
          metadata: { scannerUnrealModule: moduleName },
        });
      }
      continue;
    }

    if (active.has("unreal") && normalizedPath.endsWith(".Build.cs")) {
      const build = parseUnrealBuildCs(file.body);
      for (const dependency of build.dependencies) {
        const dependencyBuildPath = unrealModuleBuildByName.get(dependency);
        const dependencyNodeId = dependencyBuildPath
          ? input.fileNodeIdsByPath.get(dependencyBuildPath)
          : undefined;
        appendEdge({
          sourceNodeId,
          targetNodeId: dependencyNodeId ?? ensureExternal(dependency, "unreal", "module_dependency"),
          relation: "module_dependency",
          label: `depends on ${dependency}`,
          resolution: dependencyNodeId ? "file" : "external",
          language: "unreal",
          metadata: { scannerUnrealDependency: dependency },
        });
      }
      continue;
    }

    const extension = path.extname(file.relativePath).toLowerCase();
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    if (!parsed) continue;

    if (active.has("godot") && extension === ".gd") {
      for (const importPath of parsed.imports.filter((value) => value.startsWith("extends:"))) {
        appendEdge({
          sourceNodeId,
          targetNodeId: ensureExternal(importPath.slice("extends:".length), "godot", "extends"),
          relation: "extends",
          label: importPath,
          resolution: "external",
          language: "godot",
        });
      }
      for (const importPath of parsed.imports.filter((value) => value.startsWith("extends_res:"))) {
        const resourcePath = importPath.slice("extends_res:".length);
        const resolved = resolveGodotResourcePath(resourcePath, input.fileNodeIdsByPath);
        appendEdge({
          sourceNodeId,
          targetNodeId: resolved?.targetNodeId ?? ensureExternal(resourcePath, "godot", "extends"),
          relation: "extends",
          label: importPath,
          resolution: resolved ? "file" : "external",
          language: "godot",
          metadata: {
            scannerImportPath: resourcePath,
            scannerExtendsKind: "resource_script",
          },
        });
      }
      for (const importPath of parsed.imports.filter((value) => value.startsWith("res:"))) {
        const resolved = resolveGodotResourcePath(importPath.slice("res:".length), input.fileNodeIdsByPath);
        if (!resolved?.targetNodeId) continue;
        appendEdge({
          sourceNodeId,
          targetNodeId: resolved.targetNodeId,
          relation: "scene_script",
          label: importPath,
          resolution: "file",
          language: "godot",
        });
      }
    }

    if (active.has("godot") && (extension === ".tscn" || extension === ".tres")) {
      for (const importPath of parsed.imports.filter((value) => value.startsWith("res:"))) {
        const resolved = resolveGodotResourcePath(importPath.slice("res:".length), input.fileNodeIdsByPath);
        if (!resolved?.targetNodeId) continue;
        appendEdge({
          sourceNodeId,
          targetNodeId: resolved.targetNodeId,
          relation: "scene_script",
          label: importPath,
          resolution: "file",
          language: "godot",
        });
      }
    }
  }

  const diagnostics: string[] = [];
  if (edgeCount > 0) {
    diagnostics.push(`Game engine structural-lite emitted ${edgeCount} edge(s).`);
  } else if (active.has("unity") || active.has("unreal") || active.has("godot")) {
    diagnostics.push("Game engine structural-lite found no additional edges.");
  }

  return {
    edges,
    externalNodes: [...externalNodes.values()],
    result: {
      active: edgeCount > 0,
      edgeCount,
      diagnostics,
    },
  };
}