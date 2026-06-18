import path from "path";
import type {
  ProductEdgeKind,
  ProductGraphEdge,
  ProductGraphNode,
  ProductMetadataValue,
} from "@openagentgraph/shared";
import { parseEcosystemFile } from "./ecosystemScanner.js";
import { inferSwiftSpecTargetBaseName, parseSwiftPackageManifest } from "./swiftProjectParsing.js";

export const SWIFT_STRUCTURAL_LITE_VERSION = "1.0";

const SWIFT_TYPE_SYMBOL_KINDS = new Set([
  "class",
  "struct",
  "enum",
  "protocol",
  "actor",
  "extension",
  "swiftui_view",
]);

export interface SwiftWorkspaceType {
  filePath: string;
  kind: string;
  simpleName: string;
}

export interface SwiftWorkspaceIndex {
  typeBySimpleName: Map<string, SwiftWorkspaceType>;
}

export interface SwiftStructuralLiteResult {
  active: boolean;
  edgeCount: number;
  diagnostics: string[];
}

export function mapSwiftStructuralRelationToProductEdgeKind(
  relation: "import" | "conforms_to" | "extends" | "tests" | "package_dependency"
): ProductEdgeKind {
  switch (relation) {
    case "conforms_to":
      return "implements";
    case "extends":
      return "extends";
    case "tests":
    case "package_dependency":
    case "import":
    default:
      return "depends_on";
  }
}

export function buildSwiftWorkspaceIndex(
  files: Array<{ relativePath: string; body: string }>
): SwiftWorkspaceIndex {
  const typeBySimpleName = new Map<string, SwiftWorkspaceType>();
  for (const file of files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".swift") continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    if (!parsed) continue;
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    for (const symbol of parsed.symbols) {
      if (!SWIFT_TYPE_SYMBOL_KINDS.has(symbol.kind)) continue;
      const existing = typeBySimpleName.get(symbol.name);
      if (existing && existing.kind !== "extension" && symbol.kind === "extension") continue;
      typeBySimpleName.set(symbol.name, {
        filePath: normalizedPath,
        kind: symbol.kind,
        simpleName: symbol.name,
      });
    }
  }
  return { typeBySimpleName };
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
  const nodeId = input.stableId("code-scan:external", `swift|${input.qualifiedType}`);
  return {
    id: nodeId,
    kind: "code_symbol",
    title: `${input.qualifiedType} (external)`.slice(0, input.maxTitleLength),
    status: "planned",
    tags: ["code", "code-scan", "swift", "ecosystem-t1", "external-dependency"],
    metadata: input.compactMetadata({
      scannerRelation: input.relation ?? "external_import",
      scannerLanguage: "swift",
      scannerIndexingMode: "t1",
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerImportPath: input.qualifiedType,
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

function resolveSwiftSymbolNodeId(input: {
  simpleName: string;
  index: SwiftWorkspaceIndex;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
}) {
  const type = input.index.typeBySimpleName.get(input.simpleName);
  if (!type) return undefined;
  const fileNodeId = input.fileNodeIdsByPath.get(type.filePath);
  if (!fileNodeId) return undefined;
  return input.stableId(
    "code-scan:symbol",
    `${type.filePath}|file|${type.kind}|${type.simpleName}`
  );
}

export function augmentSwiftStructuralLite(input: {
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
  result: SwiftStructuralLiteResult;
} {
  const edges: ProductGraphEdge[] = [];
  const externalNodes = new Map<string, ProductGraphNode>();
  const index = buildSwiftWorkspaceIndex(input.files);
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
    relation: "import" | "conforms_to" | "extends" | "tests" | "package_dependency";
    label: string;
    resolution: "symbol" | "file" | "external";
    metadata?: Record<string, ProductMetadataValue | undefined>;
  }) => {
    edges.push({
      id: input.stableId("code-scan:edge", `${edge.sourceNodeId}|${edge.relation}|${edge.targetNodeId}|${edge.label}`),
      kind: mapSwiftStructuralRelationToProductEdgeKind(edge.relation),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      label: edge.label.slice(0, input.maxEdgeLabelLength),
      trust: edge.resolution === "external" ? "inferred" : "extracted",
      metadata: input.compactMetadata({
        scannerRelation: edge.relation === "import" ? "import" : edge.relation,
        scannerLanguage: "swift",
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
    if (normalizedPath.endsWith("Package.swift")) {
      const sourceNodeId = input.fileNodeIdsByPath.get(normalizedPath);
      if (!sourceNodeId) continue;
      for (const product of parseSwiftPackageManifest(file.body).products) {
        const targetNodeId = ensureExternal(product, "package_dependency");
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId,
          relation: "package_dependency",
          label: `package ${product}`,
          resolution: "external",
          metadata: { scannerPackageProduct: product },
        });
      }
      continue;
    }

    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".swift") continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    const sourceNodeId = input.fileNodeIdsByPath.get(normalizedPath);
    if (!parsed || !sourceNodeId) continue;

    for (const importPath of parsed.imports.filter((value) => !value.includes(":"))) {
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: ensureExternal(importPath),
        relation: "import",
        label: importPath,
        resolution: "external",
        metadata: { scannerImportPath: importPath },
      });
    }

    for (const importPath of parsed.imports.filter((value) => value.startsWith("conforms:"))) {
      const protocolName = importPath.slice("conforms:".length);
      const resolvedProtocol = resolveSwiftSymbolNodeId({
        simpleName: protocolName,
        index,
        fileNodeIdsByPath: input.fileNodeIdsByPath,
        stableId: input.stableId,
      });
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: resolvedProtocol ?? ensureExternal(protocolName),
        relation: "conforms_to",
        label: `conforms to ${protocolName}`,
        resolution: resolvedProtocol ? "symbol" : "external",
        metadata: { scannerRelatedType: protocolName },
      });
    }

    for (const importPath of parsed.imports.filter((value) => value.startsWith("extends:"))) {
      const extendedType = importPath.slice("extends:".length);
      const resolvedType = resolveSwiftSymbolNodeId({
        simpleName: extendedType,
        index,
        fileNodeIdsByPath: input.fileNodeIdsByPath,
        stableId: input.stableId,
      });
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: resolvedType ?? ensureExternal(extendedType),
        relation: "extends",
        label: `extends ${extendedType}`,
        resolution: resolvedType ? "symbol" : "external",
        metadata: { scannerRelatedType: extendedType },
      });
    }

    if (parsed.isTestFile) {
      const targetBaseName = inferSwiftSpecTargetBaseName(normalizedPath);
      const targetNodeId = resolveSwiftSymbolNodeId({
        simpleName: targetBaseName,
        index,
        fileNodeIdsByPath: input.fileNodeIdsByPath,
        stableId: input.stableId,
      });
      if (targetNodeId) {
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId,
          relation: "tests",
          label: `tests ${targetBaseName}`,
          resolution: "symbol",
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
        ? [`Swift structural-lite emitted ${edgeCount} edge(s).`]
        : ["Swift structural-lite found no additional edges."],
    },
  };
}