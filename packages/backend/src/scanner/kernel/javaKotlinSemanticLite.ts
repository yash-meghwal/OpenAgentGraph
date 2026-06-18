import path from "path";
import type {
  GraphAnalyzerAvailability,
  ProductEdgeKind,
  ProductGraphEdge,
  ProductGraphNode,
  ProductMetadataValue,
} from "@openagentgraph/shared";
import { buildGraphAnalyzerAvailability } from "@openagentgraph/shared";
import { runAnalyzerHelper } from "./analyzerHelperRunner.js";
import {
  buildJavaKotlinWorkspaceIndex,
  normalizeImportPath,
  type JavaKotlinWorkspaceIndex,
} from "./ecosystemScanner.js";
import type { EcosystemFileIndex } from "./ecosystemScanner.js";
import {
  gradleModuleNameToDirectory,
  parseGradleSettingsIncludes,
} from "./gradleProjectParsing.js";

export const JAVA_KOTLIN_SEMANTIC_LITE_VERSION = "1.0";
export const JAVA_JAVAC_ANALYZER_ID = "java-javac";
const JAVA_PROBE_TIMEOUT_MS = 5_000;

export interface JavaKotlinProjectModule {
  name: string;
  directory: string;
  sourceRoots: string[];
}

export interface JavaKotlinProjectTopology {
  modules: JavaKotlinProjectModule[];
  mavenParentChild: Array<{ parentPath: string; childPath: string; childModule: string }>;
}

export interface JavaKotlinSemanticLiteResult {
  active: boolean;
  edgeCount: number;
  analyzer?: GraphAnalyzerAvailability;
  diagnostics: string[];
}

function defaultSourceRoots(moduleDir: string) {
  return [
    path.posix.join(moduleDir, "src/main/java"),
    path.posix.join(moduleDir, "src/main/kotlin"),
    path.posix.join(moduleDir, "src/test/java"),
    path.posix.join(moduleDir, "src/test/kotlin"),
  ];
}

export function buildJavaKotlinProjectTopology(
  files: Array<{ relativePath: string; body: string }>
): JavaKotlinProjectTopology {
  const modules = new Map<string, JavaKotlinProjectModule>();
  const mavenParentChild: JavaKotlinProjectTopology["mavenParentChild"] = [];

  const ensureModule = (name: string, directory: string) => {
    const normalizedDir = directory.replace(/\\/g, "/").replace(/^\.\//, "") || ".";
    const existing = modules.get(name);
    if (existing) return existing;
    const module: JavaKotlinProjectModule = {
      name,
      directory: normalizedDir,
      sourceRoots: defaultSourceRoots(normalizedDir === "." ? "" : normalizedDir),
    };
    modules.set(name, module);
    return module;
  };

  ensureModule("root", ".");

  for (const file of files) {
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    const fileName = path.basename(normalizedPath);

    if (fileName === "settings.gradle" || fileName === "settings.gradle.kts") {
      for (const moduleName of parseGradleSettingsIncludes(file.body)) {
        ensureModule(moduleName, gradleModuleNameToDirectory(moduleName));
      }
      continue;
    }

    if (fileName === "pom.xml") {
      const moduleMatches = [...file.body.matchAll(/<module>\s*([^<]+)\s*<\/module>/gi)];
      for (const match of moduleMatches) {
        const childModule = match[1]!.trim();
        const childPath = path.posix.join(path.posix.dirname(normalizedPath), childModule);
        mavenParentChild.push({
          parentPath: normalizedPath,
          childPath: path.posix.join(childPath, "pom.xml"),
          childModule,
        });
        ensureModule(childModule, childPath);
      }
      if (/<parent>/i.test(file.body) && normalizedPath.includes("/")) {
        const moduleDir = path.posix.dirname(normalizedPath);
        const moduleName = path.posix.basename(moduleDir);
        const parentPath = path.posix.join(path.posix.dirname(moduleDir), "pom.xml");
        mavenParentChild.push({
          parentPath,
          childPath: normalizedPath,
          childModule: moduleName,
        });
        ensureModule(moduleName, moduleDir);
      }
    }
  }

  for (const file of files) {
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    if (!/\/src\/(?:main|test)\/(?:java|kotlin)\//.test(normalizedPath)) continue;
    const segments = normalizedPath.split("/");
    const srcIndex = segments.findIndex((segment) => segment === "src");
    if (srcIndex <= 0) continue;
    const moduleDir = segments.slice(0, srcIndex).join("/") || ".";
    const moduleName = moduleDir === "." ? "root" : path.posix.basename(moduleDir);
    const module = ensureModule(moduleName, moduleDir);
    const sourceRoot = segments.slice(0, srcIndex + 3).join("/");
    if (!module.sourceRoots.includes(sourceRoot)) {
      module.sourceRoots.push(sourceRoot);
    }
  }

  return { modules: [...modules.values()], mavenParentChild };
}

export function resolveJavaKotlinQualifiedType(input: {
  simpleOrQualified: string;
  packageName?: string;
  imports: string[];
  index: JavaKotlinWorkspaceIndex;
}) {
  const name = input.simpleOrQualified.trim();
  if (!name) return undefined;
  if (name.includes(".")) {
    return input.index.typeByQualifiedName.has(name) ? name : name;
  }
  if (input.packageName) {
    const localCandidate = `${input.packageName}.${name}`;
    if (input.index.typeByQualifiedName.has(localCandidate)) {
      return localCandidate;
    }
  }
  for (const importPath of input.imports) {
    const normalized = normalizeImportPath(importPath);
    if (!normalized) continue;
    if (normalized === name || normalized.endsWith(`.${name}`)) {
      return normalized;
    }
  }
  if (input.packageName) return `${input.packageName}.${name}`;
  return name;
}

function symbolNodeIdForQualifiedType(
  qualifiedType: string,
  index: JavaKotlinWorkspaceIndex,
  stableId: (prefix: string, raw: string) => string
) {
  const type = index.typeByQualifiedName.get(qualifiedType);
  if (!type) return undefined;
  return stableId("code-scan:symbol", `${type.filePath}|file|${type.kind}|${type.simpleName}`);
}

function resolveRelationshipTarget(input: {
  qualifiedType: string;
  index: JavaKotlinWorkspaceIndex;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
}) {
  const symbolNodeId = symbolNodeIdForQualifiedType(input.qualifiedType, input.index, input.stableId);
  if (symbolNodeId) {
    return { targetNodeId: symbolNodeId, resolution: "symbol" as const };
  }
  for (const extension of [".java", ".kt"] as const) {
    const suffix = `${input.qualifiedType.replace(/\./g, "/")}${extension}`;
    for (const [filePath, nodeId] of input.fileNodeIdsByPath) {
      if (filePath.replace(/\\/g, "/").endsWith(suffix)) {
        return { targetNodeId: nodeId, resolution: "file" as const };
      }
    }
  }
  return {
    targetNodeId: input.stableId("code-scan:external", `java-kotlin|${input.qualifiedType}`),
    resolution: "external" as const,
  };
}

function createExternalTypeNode(input: {
  qualifiedType: string;
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxTitleLength: number;
}): ProductGraphNode {
  return {
    id: input.stableId("code-scan:external", `java-kotlin|${input.qualifiedType}`),
    kind: "code_symbol",
    title: `${input.qualifiedType} (external)`.slice(0, input.maxTitleLength),
    status: "planned",
    tags: ["code", "code-scan", "java", "ecosystem-t1.5", "external-dependency"],
    metadata: input.compactMetadata({
      scannerEcosystemVersion: JAVA_KOTLIN_SEMANTIC_LITE_VERSION,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerRelation: "external_import",
      scannerImportPath: input.qualifiedType,
      scannerLanguage: "java",
      scannerIndexingMode: "t1.5",
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

function inferSubjectTypeName(testFilePath: string, testClassName: string) {
  const baseName = path.basename(testFilePath).replace(/Test\.(?:java|kt)$/i, "");
  if (baseName && baseName !== testClassName) return baseName;
  return testClassName.replace(/Test$/, "");
}

export function buildJavaKotlinAnalyzerAvailability(
  input: Partial<GraphAnalyzerAvailability> & Pick<GraphAnalyzerAvailability, "status">
) {
  return buildGraphAnalyzerAvailability({
    ...input,
    id: input.id ?? JAVA_JAVAC_ANALYZER_ID,
    label: input.label ?? "Java/Kotlin semantic-lite analyzer",
    ecosystemId: input.ecosystemId ?? "java",
    tierContribution: input.tierContribution ?? "T1.5",
    mode: input.mode ?? "semantic-lite",
    requiredRuntime: input.requiredRuntime ?? "JDK (java CLI, optional enrichment)",
    setupCommandHints: input.setupCommandHints ?? ["java -version"],
    autoBuildCapable: input.autoBuildCapable ?? false,
    timeoutMs: input.timeoutMs ?? 30_000,
    maxOutputBytes: input.maxOutputBytes ?? 2_000_000,
  });
}

export async function probeJavaToolchainAvailability(workspaceRoot: string) {
  const result = await runAnalyzerHelper({
    run: {
      command: ["java", "-version"],
      workspaceRoot,
      limits: { timeoutMs: JAVA_PROBE_TIMEOUT_MS, maxStdoutBytes: 4_096, maxStderrBytes: 4_096 },
    },
  });
  if (result.timedOut) {
    return { available: false as const, reason: "JDK probe timed out." };
  }
  const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
  if (result.exitCode !== 0) {
    return {
      available: false as const,
      reason: result.error ?? (combinedOutput || `JDK probe exited with code ${result.exitCode ?? "unknown"}.`),
    };
  }
  if (!/version/i.test(combinedOutput)) {
    return { available: false as const, reason: "JDK probe returned unexpected output." };
  }
  return { available: true as const };
}

export function mapSemanticLiteRelationToProductEdgeKind(
  relation: "extends" | "implements" | "tests" | "entrypoint" | "module_dependency"
): ProductEdgeKind {
  switch (relation) {
    case "extends":
      return "extends";
    case "implements":
      return "implements";
    case "entrypoint":
      return "uses";
    case "tests":
    case "module_dependency":
    default:
      return "depends_on";
  }
}

export function buildJavaKotlinSemanticDiagnostics(result: JavaKotlinSemanticLiteResult) {
  const lines = ["Java/Kotlin structural-lite: available (T1.5)."];
  if (!result.active) {
    lines.push("Java/Kotlin semantic-lite: inactive (no resolvable project relationships found).");
    return lines;
  }
  lines.push(`Java/Kotlin semantic-lite: enabled (${result.edgeCount} relationship edge(s)).`);
  if (result.analyzer?.status === "unavailable") {
    lines.push(`Java/Kotlin optional JDK enrichment: unavailable (${result.analyzer.fallbackReason ?? "unknown"}).`);
  } else if (result.analyzer?.status === "enabled") {
    lines.push("Java/Kotlin optional JDK enrichment: available.");
  }
  return lines;
}

export async function prepareJavaKotlinSemanticLite(input: {
  workspaceRoot: string;
  disabled?: boolean;
}): Promise<Pick<JavaKotlinSemanticLiteResult, "analyzer">> {
  if (input.disabled) {
    return {
      analyzer: buildJavaKotlinAnalyzerAvailability({
        status: "disabled",
        fallbackReason: "disabled for test",
      }),
    };
  }
  const probe = await probeJavaToolchainAvailability(input.workspaceRoot);
  if (!probe.available) {
    return {
      analyzer: buildJavaKotlinAnalyzerAvailability({
        status: "unavailable",
        fallbackReason: probe.reason ?? "JDK not found on PATH.",
      }),
    };
  }
  return { analyzer: buildJavaKotlinAnalyzerAvailability({ status: "enabled" }) };
}

export function augmentJavaKotlinSemanticLite(input: {
  scanId: string;
  scannedAt: string;
  files: Array<{ relativePath: string; body: string }>;
  parsedByPath: Map<string, EcosystemFileIndex>;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxEdgeLabelLength: number;
  maxTitleLength: number;
  analyzer?: GraphAnalyzerAvailability;
}): {
  edges: ProductGraphEdge[];
  externalNodes: ProductGraphNode[];
  result: JavaKotlinSemanticLiteResult;
} {
  const edges: ProductGraphEdge[] = [];
  const externalNodes = new Map<string, ProductGraphNode>();
  const index = buildJavaKotlinWorkspaceIndex(input.files);
  const topology = buildJavaKotlinProjectTopology(input.files);
  let semanticLiteEdgeCount = 0;

  const ensureExternal = (qualifiedType: string) => {
    const node = createExternalTypeNode({
      qualifiedType,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      stableId: input.stableId,
      compactMetadata: input.compactMetadata,
      maxTitleLength: input.maxTitleLength,
    });
    externalNodes.set(node.id, node);
    return node.id;
  };

  const appendRelationshipEdge = (edge: {
    sourceNodeId: string;
    targetNodeId: string;
    relation: "extends" | "implements" | "tests" | "entrypoint" | "module_dependency";
    label: string;
    resolution: "symbol" | "file" | "external";
    language: "java" | "kotlin";
    metadata?: Record<string, ProductMetadataValue | undefined>;
  }) => {
    edges.push({
      id: input.stableId("code-scan:edge", `${edge.sourceNodeId}|${edge.relation}|${edge.targetNodeId}`),
      kind: mapSemanticLiteRelationToProductEdgeKind(edge.relation),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      label: edge.label.slice(0, input.maxEdgeLabelLength),
      trust: edge.resolution === "external" ? "inferred" : "extracted",
      metadata: input.compactMetadata({
        edgeDerivationSource: "javakotlin-semantic-lite",
        scannerRelation: edge.relation,
        scannerLanguage: edge.language,
        scannerResolution: "semantic-lite",
        scannerImportResolution: edge.resolution,
        ...edge.metadata,
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
    semanticLiteEdgeCount += 1;
  };

  for (const mapping of topology.mavenParentChild) {
    const parentNodeId = input.fileNodeIdsByPath.get(mapping.parentPath);
    const childNodeId = input.fileNodeIdsByPath.get(mapping.childPath)
      ?? input.fileNodeIdsByPath.get(path.posix.join(path.posix.dirname(mapping.childPath), "src/main/java"))
      ?? input.fileNodeIdsByPath.get(path.posix.join(path.posix.dirname(mapping.childPath), "src/main/kotlin"));
    if (!parentNodeId || !childNodeId) continue;
    appendRelationshipEdge({
      sourceNodeId: parentNodeId,
      targetNodeId: childNodeId,
      relation: "module_dependency",
      label: `maven module ${mapping.childModule}`,
      resolution: "file",
      language: "java",
      metadata: { scannerModuleName: mapping.childModule },
    });
  }

  for (const file of input.files) {
    const parsed = input.parsedByPath.get(file.relativePath);
    const sourceNodeId = input.fileNodeIdsByPath.get(file.relativePath);
    if (!parsed || !sourceNodeId) continue;
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".java" && extension !== ".kt" && extension !== ".kts") continue;

    const packageName = parsed.symbols.find((symbol) => symbol.kind === "package")?.name;

    for (const importPath of parsed.imports) {
      if (!importPath.startsWith("extends:") && !importPath.startsWith("implements:")) continue;
      const [relation, rawType] = importPath.split(":", 2) as ["extends" | "implements", string];
      const qualifiedType = resolveJavaKotlinQualifiedType({
        simpleOrQualified: rawType,
        packageName,
        imports: parsed.imports.filter((value) => !value.includes(":")),
        index,
      });
      if (!qualifiedType) continue;
      const sourceSymbol = parsed.symbols.find(
        (symbol) => JAVA_TYPE_SYMBOL_KINDS.has(symbol.kind) && !symbol.parentType
      );
      const sourceSymbolNodeId = sourceSymbol
        ? input.stableId("code-scan:symbol", `${file.relativePath}|file|${sourceSymbol.kind}|${sourceSymbol.name}`)
        : sourceNodeId;
      const resolved = resolveRelationshipTarget({
        qualifiedType,
        index,
        fileNodeIdsByPath: input.fileNodeIdsByPath,
        stableId: input.stableId,
      });
      if (resolved.resolution === "external") {
        resolved.targetNodeId = ensureExternal(qualifiedType);
      }
      appendRelationshipEdge({
        sourceNodeId: sourceSymbolNodeId,
        targetNodeId: resolved.targetNodeId,
        relation,
        label: `${relation} ${qualifiedType}`,
        resolution: resolved.resolution,
        language: parsed.language === "kotlin" ? "kotlin" : "java",
        metadata: { scannerRelatedType: qualifiedType },
      });
    }

    if (parsed.isTestFile) {
      const testClass = parsed.symbols.find(
        (symbol) => (symbol.kind === "class" || symbol.kind === "object") && !symbol.parentType
      );
      if (testClass) {
        const subjectName = inferSubjectTypeName(file.relativePath, testClass.name);
        const subjectQualified = packageName ? `${packageName}.${subjectName}` : subjectName;
        const resolved = resolveRelationshipTarget({
          qualifiedType: subjectQualified,
          index,
          fileNodeIdsByPath: input.fileNodeIdsByPath,
          stableId: input.stableId,
        });
        if (resolved.resolution !== "external") {
          appendRelationshipEdge({
            sourceNodeId: sourceNodeId,
            targetNodeId: resolved.targetNodeId,
            relation: "tests",
            label: `tests ${subjectName}`,
            resolution: resolved.resolution,
            language: parsed.language === "kotlin" ? "kotlin" : "java",
            metadata: { scannerTestClass: testClass.name, scannerSubjectType: subjectQualified },
          });
        }
      }
    }

    const mainMethod = parsed.symbols.find((symbol) =>
      (symbol.kind === "method" || symbol.kind === "function")
      && symbol.name === "main"
      && (symbol.parentType === undefined || symbol.name === "main")
    );
    if (mainMethod) {
      const mainSymbolNodeId = input.stableId(
        "code-scan:symbol",
        `${file.relativePath}|${mainMethod.parentType ?? "file"}|${mainMethod.kind}|${mainMethod.name}`
      );
      appendRelationshipEdge({
        sourceNodeId: sourceNodeId,
        targetNodeId: mainSymbolNodeId,
        relation: "entrypoint",
        label: "entrypoint main",
        resolution: "symbol",
        language: parsed.language === "kotlin" ? "kotlin" : "java",
      });
    }
  }

  const result: JavaKotlinSemanticLiteResult = {
    active: semanticLiteEdgeCount > 0,
    edgeCount: semanticLiteEdgeCount,
    analyzer: input.analyzer,
    diagnostics: [],
  };
  result.diagnostics = buildJavaKotlinSemanticDiagnostics(result);

  return { edges, externalNodes: [...externalNodes.values()], result };
}

const JAVA_TYPE_SYMBOL_KINDS = new Set(["class", "interface", "enum", "record", "object"]);