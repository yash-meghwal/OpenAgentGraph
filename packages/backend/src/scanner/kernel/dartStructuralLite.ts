import path from "path";
import type {
  ProductEdgeKind,
  ProductGraphEdge,
  ProductGraphNode,
  ProductMetadataValue,
} from "@openagentgraph/shared";
import { parseEcosystemFile } from "./ecosystemScanner.js";
import {
  inferDartTestTargetBaseName,
  parsePubspecYaml,
  resolveDartWorkspaceImport,
} from "./dartProjectParsing.js";

export const DART_STRUCTURAL_LITE_VERSION = "1.0";

const DART_TYPE_SYMBOL_KINDS = new Set([
  "class",
  "mixin",
  "mixin_class",
  "enum",
  "stateless_widget",
  "stateful_widget",
  "state",
]);

export interface DartWorkspaceType {
  filePath: string;
  kind: string;
  simpleName: string;
}

export interface DartWorkspaceIndex {
  typeBySimpleName: Map<string, DartWorkspaceType>;
  packageName?: string;
  packageRoots: Map<string, string>;
}

export interface DartStructuralLiteResult {
  active: boolean;
  edgeCount: number;
  diagnostics: string[];
}

export function mapDartStructuralRelationToProductEdgeKind(
  relation: "import" | "extends" | "with" | "implements" | "widget_state" | "tests" | "package_dependency" | "system_import"
): ProductEdgeKind {
  switch (relation) {
    case "extends":
      return "extends";
    case "with":
    case "implements":
      return "implements";
    case "widget_state":
    case "tests":
    case "package_dependency":
    case "import":
    case "system_import":
    default:
      return "depends_on";
  }
}

export function buildDartWorkspaceIndex(
  files: Array<{ relativePath: string; body: string }>
): DartWorkspaceIndex {
  const typeBySimpleName = new Map<string, DartWorkspaceType>();
  const packageRoots = new Map<string, string>();
  let packageName: string | undefined;

  for (const file of files) {
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    if (normalizedPath.endsWith("pubspec.yaml")) {
      const pubspec = parsePubspecYaml(file.body);
      if (pubspec.packageName) {
        const packageRoot = path.posix.dirname(normalizedPath);
        const normalizedRoot = packageRoot === "." ? "" : packageRoot;
        packageRoots.set(pubspec.packageName, normalizedRoot);
        if (!packageName && normalizedRoot === "") {
          packageName = pubspec.packageName;
        }
      }
      continue;
    }
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".dart") continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    if (!parsed) continue;
    for (const symbol of parsed.symbols) {
      if (!DART_TYPE_SYMBOL_KINDS.has(symbol.kind)) continue;
      typeBySimpleName.set(symbol.name, {
        filePath: normalizedPath,
        kind: symbol.kind,
        simpleName: symbol.name,
      });
    }
  }

  return { typeBySimpleName, packageName, packageRoots };
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
  const nodeId = input.stableId("code-scan:external", `dart|${input.qualifiedType}`);
  return {
    id: nodeId,
    kind: "code_symbol",
    title: `${input.qualifiedType} (external)`.slice(0, input.maxTitleLength),
    status: "planned",
    tags: ["code", "code-scan", "dart", "ecosystem-t1", "external-dependency"],
    metadata: input.compactMetadata({
      scannerRelation: input.relation ?? "external_import",
      scannerLanguage: "dart",
      scannerIndexingMode: "t1",
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerImportPath: input.qualifiedType,
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

function resolveDartSymbolNodeId(input: {
  simpleName: string;
  index: DartWorkspaceIndex;
  stableId: (prefix: string, raw: string) => string;
}) {
  const type = input.index.typeBySimpleName.get(input.simpleName);
  if (!type) return undefined;
  return input.stableId(
    "code-scan:symbol",
    `${type.filePath}|file|${type.kind}|${type.simpleName}`
  );
}

export function augmentDartStructuralLite(input: {
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
  result: DartStructuralLiteResult;
} {
  const edges: ProductGraphEdge[] = [];
  const externalNodes = new Map<string, ProductGraphNode>();
  const index = buildDartWorkspaceIndex(input.files);
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
    relation: "import" | "extends" | "with" | "implements" | "widget_state" | "tests" | "package_dependency" | "system_import";
    label: string;
    resolution: "symbol" | "file" | "external";
    metadata?: Record<string, ProductMetadataValue | undefined>;
  }) => {
    edges.push({
      id: input.stableId("code-scan:edge", `${edge.sourceNodeId}|${edge.relation}|${edge.targetNodeId}|${edge.label}`),
      kind: mapDartStructuralRelationToProductEdgeKind(edge.relation),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      label: edge.label.slice(0, input.maxEdgeLabelLength),
      trust: edge.resolution === "external" ? "inferred" : "extracted",
      metadata: input.compactMetadata({
        scannerRelation: edge.relation === "import" ? "import" : edge.relation,
        scannerLanguage: "dart",
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

    if (normalizedPath.endsWith("pubspec.yaml")) {
      const sourceNodeId = input.fileNodeIdsByPath.get(normalizedPath);
      if (!sourceNodeId) continue;
      const pubspec = parsePubspecYaml(file.body);
      for (const dependency of [...pubspec.dependencies, ...pubspec.devDependencies]) {
        if (dependency === "flutter" || dependency === "flutter_test") continue;
        const targetNodeId = ensureExternal(dependency, "package_dependency");
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId,
          relation: "package_dependency",
          label: `package ${dependency}`,
          resolution: "external",
          metadata: { scannerPackageDependency: dependency },
        });
      }
      continue;
    }

    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".dart") continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    const sourceNodeId = input.fileNodeIdsByPath.get(normalizedPath);
    if (!parsed || !sourceNodeId) continue;

    for (const importPath of parsed.imports.filter((value) => value.startsWith("package:") || value.startsWith("local:"))) {
      const resolved = resolveDartWorkspaceImport(
        importPath,
        normalizedPath,
        index.packageRoots,
        input.fileNodeIdsByPath
      );
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: resolved?.targetNodeId ?? ensureExternal(importPath),
        relation: "import",
        label: importPath,
        resolution: resolved?.resolution ?? "external",
        metadata: { scannerImportPath: importPath },
      });
    }

    for (const importPath of parsed.imports.filter((value) => value.startsWith("system:"))) {
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: ensureExternal(importPath.slice("system:".length), "system_import"),
        relation: "system_import",
        label: importPath.slice("system:".length),
        resolution: "external",
        metadata: { scannerImportPath: importPath },
      });
    }

    for (const importPath of parsed.imports.filter((value) => value.startsWith("extends:"))) {
      const baseType = importPath.slice("extends:".length);
      const resolvedType = resolveDartSymbolNodeId({
        simpleName: baseType,
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

    for (const importPath of parsed.imports.filter((value) => value.startsWith("with:"))) {
      const mixinName = importPath.slice("with:".length);
      const resolvedMixin = resolveDartSymbolNodeId({
        simpleName: mixinName,
        index,
        stableId: input.stableId,
      });
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: resolvedMixin ?? ensureExternal(mixinName),
        relation: "with",
        label: `with ${mixinName}`,
        resolution: resolvedMixin ? "symbol" : "external",
        metadata: { scannerRelatedType: mixinName },
      });
    }

    for (const importPath of parsed.imports.filter((value) => value.startsWith("implements:"))) {
      const interfaceName = importPath.slice("implements:".length);
      const resolvedInterface = resolveDartSymbolNodeId({
        simpleName: interfaceName,
        index,
        stableId: input.stableId,
      });
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: resolvedInterface ?? ensureExternal(interfaceName),
        relation: "implements",
        label: `implements ${interfaceName}`,
        resolution: resolvedInterface ? "symbol" : "external",
        metadata: { scannerRelatedType: interfaceName },
      });
    }

    for (const importPath of parsed.imports.filter((value) => value.startsWith("widget_state:"))) {
      const widgetName = importPath.slice("widget_state:".length);
      const resolvedWidget = resolveDartSymbolNodeId({
        simpleName: widgetName,
        index,
        stableId: input.stableId,
      });
      if (!resolvedWidget) continue;
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: resolvedWidget,
        relation: "widget_state",
        label: `state for ${widgetName}`,
        resolution: "symbol",
        metadata: { scannerRelatedType: widgetName },
      });
    }

    if (parsed.isTestFile) {
      const targetBaseName = inferDartTestTargetBaseName(normalizedPath);
      const fileCandidates = [
        `lib/${targetBaseName}.dart`,
        `lib/src/${targetBaseName}.dart`,
        `lib/widgets/${targetBaseName}.dart`,
        `lib/services/${targetBaseName}.dart`,
        `${targetBaseName}.dart`,
      ];
      const symbolTargetNodeId = resolveDartSymbolNodeId({
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
      if (!targetNodeId) {
        for (const importPath of parsed.imports.filter((value) => value.startsWith("package:") || value.startsWith("local:"))) {
          const resolved = resolveDartWorkspaceImport(
            importPath,
            normalizedPath,
            index.packageRoots,
            input.fileNodeIdsByPath
          );
          if (!resolved?.targetNodeId) continue;
          targetNodeId = resolved.targetNodeId;
          testResolution = "file";
          break;
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
        ? [`Dart/Flutter structural-lite emitted ${edgeCount} edge(s).`]
        : ["Dart/Flutter structural-lite found no additional edges."],
    },
  };
}