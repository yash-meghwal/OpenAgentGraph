import path from "path";
import type {
  ProductEdgeKind,
  ProductGraphEdge,
  ProductGraphNode,
  ProductMetadataValue,
} from "@openagentgraph/shared";
import { parseEcosystemFile } from "./ecosystemScanner.js";
import {
  inferCppTestTargetBaseName,
  parseCMakeLists,
  parseCompileCommands,
  resolveCompileCommandFilePath,
  type CmakeTarget,
} from "./cppProjectParsing.js";

export const CPP_STRUCTURAL_LITE_VERSION = "1.0";

const CPP_TYPE_SYMBOL_KINDS = new Set(["class", "struct", "enum", "namespace"]);

export interface CppWorkspaceType {
  filePath: string;
  kind: string;
  simpleName: string;
}

export interface CppWorkspaceIndex {
  typeBySimpleName: Map<string, CppWorkspaceType>;
  targetByName: Map<string, CmakeTarget>;
}

export interface CppStructuralLiteResult {
  active: boolean;
  edgeCount: number;
  diagnostics: string[];
}

export function mapCppStructuralRelationToProductEdgeKind(
  relation: "include" | "extends" | "tests" | "cmake_link" | "compile_unit" | "system_include"
): ProductEdgeKind {
  switch (relation) {
    case "extends":
      return "extends";
    case "tests":
    case "cmake_link":
    case "compile_unit":
    case "include":
    case "system_include":
    default:
      return "depends_on";
  }
}

export function resolveCppLocalInclude(
  importPath: string,
  sourceRelativePath: string,
  fileNodeIdsByPath: Map<string, string>
) {
  if (!importPath.startsWith("local:")) return undefined;
  const header = importPath.slice("local:".length);
  const sourceDir = path.posix.dirname(sourceRelativePath.replace(/\\/g, "/"));
  const candidates = [
    path.posix.normalize(`${sourceDir}/${header}`),
    path.posix.normalize(`include/${header}`),
    header,
    path.posix.normalize(`src/${header}`),
  ];
  for (const candidate of candidates) {
    const nodeId = fileNodeIdsByPath.get(candidate);
    if (nodeId) return { targetNodeId: nodeId, resolution: "file" as const };
  }
  for (const [filePath, nodeId] of fileNodeIdsByPath) {
    if (path.posix.basename(filePath) === path.posix.basename(header)) {
      return { targetNodeId: nodeId, resolution: "file" as const };
    }
  }
  return undefined;
}

export function buildCppWorkspaceIndex(
  files: Array<{ relativePath: string; body: string }>
): CppWorkspaceIndex {
  const typeBySimpleName = new Map<string, CppWorkspaceType>();
  const targetByName = new Map<string, CmakeTarget>();

  for (const file of files) {
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    if (normalizedPath.endsWith("CMakeLists.txt")) {
      for (const target of parseCMakeLists(file.body).targets) {
        targetByName.set(target.name, target);
      }
      continue;
    }
    const extension = path.extname(file.relativePath).toLowerCase();
    if (![".c", ".cc", ".cpp", ".h", ".hpp"].includes(extension)) continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    if (!parsed) continue;
    for (const symbol of parsed.symbols) {
      if (!CPP_TYPE_SYMBOL_KINDS.has(symbol.kind)) continue;
      typeBySimpleName.set(symbol.name, {
        filePath: normalizedPath,
        kind: symbol.kind,
        simpleName: symbol.name,
      });
    }
  }

  return { typeBySimpleName, targetByName };
}

function createExternalTypeNode(input: {
  qualifiedType: string;
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxTitleLength: number;
  relation?: string;
}): ProductGraphNode {
  const nodeId = input.stableId("code-scan:external", `cpp|${input.qualifiedType}`);
  return {
    id: nodeId,
    kind: "code_symbol",
    title: `${input.qualifiedType} (external)`.slice(0, input.maxTitleLength),
    status: "planned",
    tags: ["code", "code-scan", "cpp", "ecosystem-t1", "external-dependency"],
    metadata: input.compactMetadata({
      scannerRelation: input.relation ?? "external_import",
      scannerLanguage: "cpp",
      scannerIndexingMode: "t1",
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerImportPath: input.qualifiedType,
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

function resolveCppSymbolNodeId(input: {
  simpleName: string;
  index: CppWorkspaceIndex;
  stableId: (prefix: string, raw: string) => string;
}) {
  const type = input.index.typeBySimpleName.get(input.simpleName);
  if (!type) return undefined;
  return input.stableId(
    "code-scan:symbol",
    `${type.filePath}|file|${type.kind}|${type.simpleName}`
  );
}

export function augmentCppStructuralLite(input: {
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
  result: CppStructuralLiteResult;
} {
  const edges: ProductGraphEdge[] = [];
  const externalNodes = new Map<string, ProductGraphNode>();
  const index = buildCppWorkspaceIndex(input.files);
  let edgeCount = 0;

  const ensureExternal = (qualifiedType: string, relation = "external_import") => {
    const node = createExternalTypeNode({
      qualifiedType,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      stableId: input.stableId,
      compactMetadata: input.compactMetadata,
      maxTitleLength: input.maxTitleLength,
      relation,
    });
    externalNodes.set(node.id, node);
    return node.id;
  };

  const appendRelationshipEdge = (edge: {
    sourceNodeId: string;
    targetNodeId: string;
    relation: "include" | "extends" | "tests" | "cmake_link" | "compile_unit" | "system_include";
    label: string;
    resolution: "symbol" | "file" | "external";
    metadata?: Record<string, ProductMetadataValue | undefined>;
  }) => {
    edges.push({
      id: input.stableId("code-scan:edge", `${edge.sourceNodeId}|${edge.relation}|${edge.targetNodeId}|${edge.label}`),
      kind: mapCppStructuralRelationToProductEdgeKind(edge.relation),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      label: edge.label.slice(0, input.maxEdgeLabelLength),
      trust: edge.resolution === "external" ? "inferred" : "extracted",
      metadata: input.compactMetadata({
        scannerRelation: edge.relation === "system_include" ? "import" : edge.relation,
        scannerLanguage: "cpp",
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

    if (normalizedPath.endsWith("CMakeLists.txt")) {
      const sourceNodeId = input.fileNodeIdsByPath.get(normalizedPath);
      if (!sourceNodeId) continue;
      const cmake = parseCMakeLists(file.body);
      for (const link of cmake.links) {
        const dependencyTarget = index.targetByName.get(link.target);
        const dependencySource = dependencyTarget?.sources[0];
        const targetNodeId = dependencySource
          ? input.fileNodeIdsByPath.get(dependencySource.replace(/\\/g, "/"))
          : undefined;
        if (!targetNodeId) continue;
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId,
          relation: "cmake_link",
          label: `${link.source} -> ${link.target}`,
          resolution: "file",
          metadata: { scannerCmakeSource: link.source, scannerCmakeTarget: link.target },
        });
      }
      continue;
    }

    if (normalizedPath.endsWith("compile_commands.json")) {
      const sourceNodeId = input.fileNodeIdsByPath.get(normalizedPath);
      if (!sourceNodeId) continue;
      for (const entry of parseCompileCommands(file.body)) {
        const resolvedPath = resolveCompileCommandFilePath(entry, input.fileNodeIdsByPath.keys());
        const compileUnitNodeId = resolvedPath
          ? input.fileNodeIdsByPath.get(resolvedPath)
          : undefined;
        if (!compileUnitNodeId) continue;
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId: compileUnitNodeId,
          relation: "compile_unit",
          label: `compile unit ${resolvedPath ?? entry.file}`,
          resolution: "file",
          metadata: {
            scannerCompileDirectory: entry.directory,
            scannerCompileFile: entry.file,
            scannerCompileResolvedPath: resolvedPath,
          },
        });
      }
      continue;
    }

    const extension = path.extname(file.relativePath).toLowerCase();
    if (![".c", ".cc", ".cpp", ".h", ".hpp"].includes(extension)) continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    const sourceNodeId = input.fileNodeIdsByPath.get(normalizedPath);
    if (!parsed || !sourceNodeId) continue;

    for (const importPath of parsed.imports.filter((value) => value.startsWith("local:"))) {
      const resolved = resolveCppLocalInclude(importPath, normalizedPath, input.fileNodeIdsByPath);
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: resolved?.targetNodeId ?? ensureExternal(importPath.slice("local:".length)),
        relation: "include",
        label: importPath.slice("local:".length),
        resolution: resolved?.resolution ?? "external",
        metadata: { scannerImportPath: importPath },
      });
    }

    for (const importPath of parsed.imports.filter((value) => value.startsWith("system:"))) {
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: ensureExternal(importPath.slice("system:".length), "system_include"),
        relation: "system_include",
        label: importPath.slice("system:".length),
        resolution: "external",
        metadata: { scannerImportPath: importPath },
      });
    }

    for (const importPath of parsed.imports.filter((value) => value.startsWith("extends:"))) {
      const baseType = importPath.slice("extends:".length);
      const resolvedType = resolveCppSymbolNodeId({
        simpleName: baseType.split("::").pop() ?? baseType,
        index,
        stableId: input.stableId,
      });
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: resolvedType ?? ensureExternal(baseType),
        relation: "extends",
        label: `extends ${baseType}`,
        resolution: resolvedType ? "symbol" : "external",
        metadata: { scannerRelatedType: baseType },
      });
    }

    if (parsed.isTestFile) {
      const targetBaseName = inferCppTestTargetBaseName(normalizedPath);
      const fileCandidates = [
        `src/${targetBaseName}.cpp`,
        `src/${targetBaseName}.c`,
        `include/${targetBaseName}.h`,
        `${targetBaseName}.cpp`,
        `${targetBaseName}.c`,
      ];
      const symbolTargetNodeId = resolveCppSymbolNodeId({
        simpleName: targetBaseName,
        index,
        stableId: input.stableId,
      });
      let targetNodeId = symbolTargetNodeId;
      let testResolution: "symbol" | "file" = "symbol";
      if (!targetNodeId) {
        for (const candidate of fileCandidates) {
          const nodeId = input.fileNodeIdsByPath.get(candidate);
          if (nodeId) {
            targetNodeId = nodeId;
            testResolution = "file";
            break;
          }
        }
      }
      if (targetNodeId) {
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId,
          relation: "tests",
          label: `tests ${targetBaseName}`,
          resolution: testResolution,
        });
      }
    }
  }

  return {
    edges,
    externalNodes: [...externalNodes.values()],
    result: {
      active: edgeCount > 0,
      edgeCount,
      diagnostics: edgeCount > 0
        ? [`C/C++ structural-lite emitted ${edgeCount} edge(s).`]
        : ["C/C++ structural-lite found no additional edges."],
    },
  };
}