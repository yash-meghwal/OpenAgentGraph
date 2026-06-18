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
  parseComposerProject,
  resolveComposerClassPath,
  type ComposerAutoloadMapping,
  type ComposerProjectMetadata,
} from "./composerProjectParsing.js";
import { parseEcosystemFile, type EcosystemFileIndex } from "./ecosystemScanner.js";

export const PHP_SEMANTIC_LITE_VERSION = "1.0";
export const PHP_TOKENIZER_ANALYZER_ID = "php-tokenizer";
const PHP_PROBE_TIMEOUT_MS = 5_000;

const PHP_TYPE_SYMBOL_KINDS = new Set(["class", "interface", "trait"]);

export interface PhpWorkspaceType {
  filePath: string;
  kind: string;
  simpleName: string;
  namespace?: string;
}

export interface PhpWorkspaceIndex {
  typeByQualifiedName: Map<string, PhpWorkspaceType>;
  autoloadMappings: ComposerAutoloadMapping[];
}

export interface PhpSemanticLiteResult {
  active: boolean;
  edgeCount: number;
  analyzer?: GraphAnalyzerAvailability;
  diagnostics: string[];
}

function buildPhpParsedFileIndex(files: Array<{ relativePath: string; body: string }>) {
  const parsedByPath = new Map<string, EcosystemFileIndex>();
  for (const file of files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".php" && extension !== ".phtml") continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    if (parsed) parsedByPath.set(file.relativePath, parsed);
  }
  return parsedByPath;
}

export function buildPhpComposerProjects(
  files: Array<{ relativePath: string; body: string }>
) {
  const projects = new Map<string, ComposerProjectMetadata>();
  for (const file of files) {
    if (path.basename(file.relativePath) !== "composer.json") continue;
    const project = parseComposerProject(file.body);
    if (project) projects.set(file.relativePath.replace(/\\/g, "/"), project);
  }
  return projects;
}

export function buildPhpWorkspaceIndex(input: {
  files: Array<{ relativePath: string; body: string }>;
  autoloadMappings: ComposerAutoloadMapping[];
}): PhpWorkspaceIndex {
  const typeByQualifiedName = new Map<string, PhpWorkspaceType>();
  for (const file of input.files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".php" && extension !== ".phtml") continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    if (!parsed) continue;
    const namespace = parsed.symbols.find((symbol) => symbol.kind === "namespace")?.name;
    for (const symbol of parsed.symbols) {
      if (!PHP_TYPE_SYMBOL_KINDS.has(symbol.kind)) continue;
      const qualifiedName = namespace ? `${namespace}\\${symbol.name}` : symbol.name;
      typeByQualifiedName.set(qualifiedName, {
        filePath: file.relativePath.replace(/\\/g, "/"),
        kind: symbol.kind,
        simpleName: symbol.name,
        namespace,
      });
    }
  }
  return { typeByQualifiedName, autoloadMappings: input.autoloadMappings };
}

export function buildPhpImportAliasMap(imports: string[]) {
  const aliasMap = new Map<string, string>();
  for (const importPath of imports) {
    if (importPath.startsWith("inherit:") || importPath.startsWith("implements:")) continue;
    const asMatch = importPath.match(/^(.+?)\s+as\s+(\w+)$/i);
    if (asMatch) {
      aliasMap.set(asMatch[2]!, asMatch[1]!.trim());
      continue;
    }
    const fqcn = importPath.trim();
    const simpleName = fqcn.split("\\").pop();
    if (simpleName) aliasMap.set(simpleName, fqcn);
  }
  return aliasMap;
}

export function resolvePhpQualifiedType(input: {
  simpleOrQualified: string;
  namespaceName?: string;
  imports: string[];
  index: PhpWorkspaceIndex;
  aliasMap?: Map<string, string>;
}) {
  const name = input.simpleOrQualified.trim().replace(/^\\+/, "");
  if (!name) return undefined;
  if (name.includes("\\")) {
    return input.index.typeByQualifiedName.has(name) ? name : name;
  }

  const aliasMap = input.aliasMap ?? buildPhpImportAliasMap(input.imports);
  const aliased = aliasMap.get(name);
  if (aliased) return aliased;

  for (const importPath of input.imports) {
    if (importPath.startsWith("inherit:") || importPath.startsWith("implements:")) continue;
    const usePath = importPath.replace(/\s+as\s+\w+$/i, "").trim();
    if (usePath === name || usePath.endsWith(`\\${name}`)) {
      return usePath;
    }
  }

  if (input.namespaceName) {
    const localCandidate = `${input.namespaceName}\\${name}`;
    if (input.index.typeByQualifiedName.has(localCandidate)) {
      return localCandidate;
    }
  }

  if (input.namespaceName) return `${input.namespaceName}\\${name}`;
  return name;
}

function symbolNodeIdForQualifiedType(
  qualifiedType: string,
  index: PhpWorkspaceIndex,
  stableId: (prefix: string, raw: string) => string
) {
  const type = index.typeByQualifiedName.get(qualifiedType);
  if (!type) return undefined;
  return stableId(
    "code-scan:symbol",
    `${type.filePath}|${type.namespace ?? "file"}|${type.kind}|${type.simpleName}`
  );
}

function symbolNodeIdForMethod(input: {
  qualifiedType: string;
  methodName: string;
  index: PhpWorkspaceIndex;
  parsedByPath: Map<string, EcosystemFileIndex>;
  stableId: (prefix: string, raw: string) => string;
}) {
  const type = input.index.typeByQualifiedName.get(input.qualifiedType);
  if (!type) return undefined;
  const parsed = input.parsedByPath.get(type.filePath);
  const method = parsed?.symbols.find(
    (symbol) => symbol.kind === "method" && symbol.name === input.methodName
  );
  if (!method) return undefined;
  return input.stableId(
    "code-scan:symbol",
    `${type.filePath}|${method.parentType ?? type.simpleName}|method|${method.name}`
  );
}

function resolveRelationshipTarget(input: {
  qualifiedType: string;
  index: PhpWorkspaceIndex;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
}) {
  const symbolNodeId = symbolNodeIdForQualifiedType(input.qualifiedType, input.index, input.stableId);
  if (symbolNodeId) {
    return { targetNodeId: symbolNodeId, resolution: "symbol" as const };
  }
  const existingPaths = new Set(
    [...input.fileNodeIdsByPath.keys()].map((filePath) => filePath.replace(/\\/g, "/"))
  );
  const composerPath = resolveComposerClassPath(
    input.qualifiedType,
    input.index.autoloadMappings,
    existingPaths
  );
  if (composerPath) {
    const nodeId = input.fileNodeIdsByPath.get(composerPath);
    if (nodeId) return { targetNodeId: nodeId, resolution: "file" as const };
  }
  const suffix = `${input.qualifiedType.replace(/\\/g, "/")}.php`;
  for (const [filePath, nodeId] of input.fileNodeIdsByPath) {
    if (filePath.replace(/\\/g, "/").endsWith(suffix)) {
      return { targetNodeId: nodeId, resolution: "file" as const };
    }
  }
  return {
    targetNodeId: input.stableId("code-scan:external", `php|${input.qualifiedType}`),
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
  relation?: string;
}): ProductGraphNode {
  return {
    id: input.stableId("code-scan:external", `php|${input.qualifiedType}`),
    kind: "code_symbol",
    title: `${input.qualifiedType} (external)`.slice(0, input.maxTitleLength),
    status: "planned",
    tags: ["code", "code-scan", "php", "ecosystem-t1.5", "external-dependency"],
    metadata: input.compactMetadata({
      scannerEcosystemVersion: PHP_SEMANTIC_LITE_VERSION,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerRelation: input.relation ?? "external_import",
      scannerImportPath: input.qualifiedType,
      scannerLanguage: "php",
      scannerIndexingMode: "t1.5",
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

export function buildPhpAnalyzerAvailability(
  input: Partial<GraphAnalyzerAvailability> & Pick<GraphAnalyzerAvailability, "status">
) {
  return buildGraphAnalyzerAvailability({
    ...input,
    id: input.id ?? PHP_TOKENIZER_ANALYZER_ID,
    label: input.label ?? "PHP tokenizer helper",
    ecosystemId: input.ecosystemId ?? "php",
    tierContribution: input.tierContribution ?? "T1.5",
    mode: input.mode ?? "semantic-lite",
    requiredRuntime: input.requiredRuntime ?? "PHP CLI (php, optional tokenizer enrichment)",
    setupCommandHints: input.setupCommandHints ?? ["php -v"],
    autoBuildCapable: input.autoBuildCapable ?? false,
    timeoutMs: input.timeoutMs ?? 30_000,
    maxOutputBytes: input.maxOutputBytes ?? 2_000_000,
  });
}

export async function probePhpToolchainAvailability(workspaceRoot: string) {
  const result = await runAnalyzerHelper({
    run: {
      command: ["php", "-v"],
      workspaceRoot,
      limits: { timeoutMs: PHP_PROBE_TIMEOUT_MS, maxStdoutBytes: 4_096, maxStderrBytes: 4_096 },
    },
  });
  if (result.timedOut) {
    return { available: false as const, reason: "PHP probe timed out." };
  }
  const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
  if (result.exitCode !== 0) {
    return {
      available: false as const,
      reason: result.error ?? (combinedOutput || `PHP probe exited with code ${result.exitCode ?? "unknown"}.`),
    };
  }
  if (!/php/i.test(combinedOutput) || !/version/i.test(combinedOutput)) {
    return { available: false as const, reason: "PHP probe returned unexpected output." };
  }
  return { available: true as const };
}

export function mapPhpSemanticLiteRelationToProductEdgeKind(
  relation:
    | "extends"
    | "implements"
    | "import"
    | "tests"
    | "laravel_route"
    | "wordpress_hook"
    | "composer_dependency"
): ProductEdgeKind {
  switch (relation) {
    case "extends":
      return "extends";
    case "implements":
      return "implements";
    case "laravel_route":
    case "wordpress_hook":
      return "uses";
    case "import":
    case "tests":
    case "composer_dependency":
    default:
      return "depends_on";
  }
}

export function buildPhpSemanticDiagnostics(result: PhpSemanticLiteResult) {
  const lines = ["PHP structural-lite: available (T1.5)."];
  if (!result.active) {
    lines.push("PHP semantic-lite: inactive (no resolvable project relationships found).");
    return lines;
  }
  lines.push(`PHP semantic-lite: enabled (${result.edgeCount} relationship edge(s)).`);
  if (result.analyzer?.status === "unavailable") {
    lines.push(`PHP optional tokenizer enrichment: unavailable (${result.analyzer.fallbackReason ?? "unknown"}).`);
  } else if (result.analyzer?.status === "enabled") {
    lines.push("PHP optional tokenizer enrichment: available.");
  }
  return lines;
}

export interface LaravelRouteTarget {
  controllerRef: string;
  methodName: string;
}

export function parseLaravelRouteTargets(body: string): LaravelRouteTarget[] {
  const targets: LaravelRouteTarget[] = [];
  const seen = new Set<string>();
  const record = (controllerRef: string, methodName: string) => {
    const key = `${controllerRef}|${methodName}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ controllerRef, methodName });
  };

  for (const match of body.matchAll(
    /Route::(?:get|post|put|patch|delete)\([^,]+,\s*\[\s*([^,\]]+::class)\s*,\s*['"](\w+)['"]\s*\]/g
  )) {
    record(match[1]!.trim(), match[2]!);
  }

  for (const match of body.matchAll(
    /Route::(?:get|post|put|patch|delete)\([^,]+,\s*\[\s*([^,\]]+::class)\s*\]/g
  )) {
    record(match[1]!.trim(), "__invoke");
  }

  for (const match of body.matchAll(
    /Route::(?:get|post|put|patch|delete)\([^,]+,\s*([\w\\]+::class)\s*\)/g
  )) {
    record(match[1]!.trim(), "__invoke");
  }

  for (const match of body.matchAll(
    /Route::(?:get|post|put|patch|delete)\([^,]+,\s*['"]([^'"]+)['"]\s*\)/g
  )) {
    const action = match[1]!;
    const atIndex = action.lastIndexOf("@");
    if (atIndex <= 0) continue;
    const controllerPart = action.slice(0, atIndex).trim();
    const methodName = action.slice(atIndex + 1).trim();
    if (!controllerPart || !/^\w+$/.test(methodName)) continue;
    record(controllerPart, methodName);
  }

  return targets;
}

const LARAVEL_DEFAULT_CONTROLLER_NAMESPACE = "App\\Http\\Controllers\\";

function resolveLaravelControllerType(input: {
  controllerLookupName: string;
  namespaceName?: string;
  imports: string[];
  index: PhpWorkspaceIndex;
  aliasMap: Map<string, string>;
}) {
  const initial = resolvePhpQualifiedType({
    simpleOrQualified: input.controllerLookupName.includes("\\")
      ? input.controllerLookupName
      : input.controllerLookupName.split("\\").pop() ?? input.controllerLookupName,
    namespaceName: input.namespaceName,
    imports: input.imports,
    index: input.index,
    aliasMap: input.aliasMap,
  });
  if (!initial) return undefined;
  if (input.index.typeByQualifiedName.has(initial)) return initial;
  if (!initial.includes("\\")) {
    const laravelCandidate = `${LARAVEL_DEFAULT_CONTROLLER_NAMESPACE}${initial}`;
    if (input.index.typeByQualifiedName.has(laravelCandidate)) return laravelCandidate;
  }
  return initial;
}

export async function preparePhpSemanticLite(input: {
  workspaceRoot: string;
  disabled?: boolean;
}): Promise<Pick<PhpSemanticLiteResult, "analyzer">> {
  if (input.disabled) {
    return {
      analyzer: buildPhpAnalyzerAvailability({
        status: "disabled",
        fallbackReason: "disabled for test",
      }),
    };
  }
  const probe = await probePhpToolchainAvailability(input.workspaceRoot);
  if (!probe.available) {
    return {
      analyzer: buildPhpAnalyzerAvailability({
        status: "unavailable",
        fallbackReason: probe.reason ?? "PHP CLI not found on PATH.",
      }),
    };
  }
  return { analyzer: buildPhpAnalyzerAvailability({ status: "enabled" }) };
}

function resolvePhpFunctionTarget(input: {
  functionName: string;
  parsedByPath: Map<string, EcosystemFileIndex>;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
}) {
  for (const [filePath, parsed] of input.parsedByPath) {
    const fn = parsed.symbols.find(
      (symbol) => symbol.kind === "function" && symbol.name === input.functionName && !symbol.parentType
    );
    if (!fn) continue;
    return {
      targetNodeId: input.stableId("code-scan:symbol", `${filePath}|${fn.parentType ?? "file"}|function|${fn.name}`),
      resolution: "symbol" as const,
    };
  }
  for (const [filePath, nodeId] of input.fileNodeIdsByPath) {
    if (path.basename(filePath, ".php") === input.functionName) {
      return { targetNodeId: nodeId, resolution: "file" as const };
    }
  }
  return undefined;
}

export function augmentPhpSemanticLite(input: {
  scanId: string;
  scannedAt: string;
  files: Array<{ relativePath: string; body: string }>;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxEdgeLabelLength: number;
  maxTitleLength: number;
  analyzer?: GraphAnalyzerAvailability;
}): {
  edges: ProductGraphEdge[];
  externalNodes: ProductGraphNode[];
  result: PhpSemanticLiteResult;
} {
  const edges: ProductGraphEdge[] = [];
  const externalNodes = new Map<string, ProductGraphNode>();
  const parsedByPath = buildPhpParsedFileIndex(input.files);
  const composerProjects = buildPhpComposerProjects(input.files);
  const autoloadMappings = [...composerProjects.values()].flatMap((project) => project.autoloadMappings);
  const index = buildPhpWorkspaceIndex({ files: input.files, autoloadMappings });
  let semanticLiteEdgeCount = 0;

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
    relation:
      | "extends"
      | "implements"
      | "import"
      | "tests"
      | "laravel_route"
      | "wordpress_hook"
      | "composer_dependency";
    label: string;
    resolution: "symbol" | "file" | "external";
    metadata?: Record<string, ProductMetadataValue | undefined>;
  }) => {
    edges.push({
      id: input.stableId("code-scan:edge", `${edge.sourceNodeId}|${edge.relation}|${edge.targetNodeId}|${edge.label}`),
      kind: mapPhpSemanticLiteRelationToProductEdgeKind(edge.relation),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      label: edge.label.slice(0, input.maxEdgeLabelLength),
      trust: edge.resolution === "external" ? "inferred" : "extracted",
      metadata: input.compactMetadata({
        edgeDerivationSource: "php-semantic-lite",
        scannerRelation: edge.relation === "import" ? "import" : edge.relation,
        scannerLanguage: "php",
        scannerResolution: "semantic-lite",
        scannerImportResolution: edge.resolution,
        ...edge.metadata,
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
    semanticLiteEdgeCount += 1;
  };

  for (const [composerPath, project] of composerProjects) {
    const sourceNodeId = input.fileNodeIdsByPath.get(composerPath);
    if (!sourceNodeId) continue;
    for (const dependency of [...project.dependencies, ...project.devDependencies]) {
      const targetNodeId = ensureExternal(dependency, "composer_dependency");
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId,
        relation: "composer_dependency",
        label: `requires ${dependency}`,
        resolution: "external",
        metadata: { scannerComposerPackage: dependency },
      });
    }
  }

  for (const file of input.files) {
    const parsed = parsedByPath.get(file.relativePath);
    const sourceNodeId = input.fileNodeIdsByPath.get(file.relativePath);
    if (!parsed || !sourceNodeId) continue;
    const namespaceName = parsed.symbols.find((symbol) => symbol.kind === "namespace")?.name;
    const plainImports = parsed.imports.filter((value) => !value.includes(":"));
    const aliasMap = buildPhpImportAliasMap(plainImports);

    for (const importPath of plainImports.slice(0, 24)) {
      const usePath = importPath.replace(/\s+as\s+\w+$/i, "").trim();
      const qualifiedType = resolvePhpQualifiedType({
        simpleOrQualified: usePath,
        namespaceName,
        imports: plainImports,
        index,
        aliasMap,
      });
      if (!qualifiedType) continue;
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
        sourceNodeId,
        targetNodeId: resolved.targetNodeId,
        relation: "import",
        label: usePath,
        resolution: resolved.resolution,
        metadata: { scannerImportPath: usePath },
      });
    }

    for (const importPath of parsed.imports) {
      if (!importPath.startsWith("inherit:") && !importPath.startsWith("implements:")) continue;
      const [relation, rawType] = importPath.split(":", 2) as ["inherit" | "implements", string];
      const semanticRelation = relation === "inherit" ? "extends" : "implements";
      const qualifiedType = resolvePhpQualifiedType({
        simpleOrQualified: rawType,
        namespaceName,
        imports: plainImports,
        index,
        aliasMap,
      });
      if (!qualifiedType) continue;
      const sourceSymbol = parsed.symbols.find(
        (symbol) => PHP_TYPE_SYMBOL_KINDS.has(symbol.kind) && symbol.parentType === namespaceName
      ) ?? parsed.symbols.find((symbol) => PHP_TYPE_SYMBOL_KINDS.has(symbol.kind));
      const sourceSymbolNodeId = sourceSymbol
        ? input.stableId(
          "code-scan:symbol",
          `${file.relativePath}|${sourceSymbol.parentType ?? "file"}|${sourceSymbol.kind}|${sourceSymbol.name}`
        )
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
        relation: semanticRelation,
        label: `${semanticRelation} ${qualifiedType}`,
        resolution: resolved.resolution,
        metadata: { scannerRelatedType: qualifiedType },
      });
    }

    if (parsed.isTestFile) {
      const baseName = path.basename(file.relativePath, ".php").replace(/Test$/, "");
      const candidates = [
        `app/Http/Controllers/${baseName}.php`,
        `app/Models/${baseName}.php`,
        `src/${baseName}.php`,
      ];
      const targetNodeId = candidates
        .map((candidate) => input.fileNodeIdsByPath.get(candidate))
        .find((nodeId): nodeId is string => Boolean(nodeId));
      if (targetNodeId) {
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId,
          relation: "tests",
          label: `tests ${baseName}`,
          resolution: "file",
          metadata: { scannerTestFile: file.relativePath },
        });
      }
    }

    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    if (normalizedPath.includes("routes/")) {
      for (const routeTarget of parseLaravelRouteTargets(file.body)) {
        const controllerRef = routeTarget.controllerRef;
        const methodName = routeTarget.methodName;
        const controllerLookupName = controllerRef.replace(/::class$/, "");
        const controllerName = controllerLookupName.split("\\").pop() ?? controllerLookupName;
        const qualifiedController = resolveLaravelControllerType({
          controllerLookupName,
          namespaceName,
          imports: plainImports,
          index,
          aliasMap,
        });
        if (!qualifiedController) continue;
        const controllerTarget = resolveRelationshipTarget({
          qualifiedType: qualifiedController,
          index,
          fileNodeIdsByPath: input.fileNodeIdsByPath,
          stableId: input.stableId,
        });
        const methodNodeId = symbolNodeIdForMethod({
          qualifiedType: qualifiedController,
          methodName,
          index,
          parsedByPath,
          stableId: input.stableId,
        });
        const targetNodeId = methodNodeId ?? controllerTarget.targetNodeId;
        if (controllerTarget.resolution === "external" && !methodNodeId) {
          continue;
        }
        const actionLabel = methodName === "__invoke"
          ? `${controllerName}::__invoke`
          : `${controllerName}::${methodName}`;
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId,
          relation: "laravel_route",
          label: `route ${actionLabel}`,
          resolution: methodNodeId ? "symbol" : controllerTarget.resolution,
          metadata: {
            scannerRouteController: qualifiedController,
            scannerRouteAction: methodName,
            scannerRouteSyntax: controllerRef.endsWith("::class")
              ? (methodName === "__invoke" ? "invokable" : "array")
              : "string",
          },
        });
      }
    }

    for (const hookMatch of file.body.matchAll(
      /add_(?:action|filter)\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\[[^\]]+\]|['"][^'"]+['"])\s*\)/g
    )) {
      const hookName = hookMatch[1]!;
      const callback = hookMatch[2]!.trim();
      let target:
        | { targetNodeId: string; resolution: "symbol" | "file" }
        | undefined;

      const stringCallback = callback.match(/^['"](\w+)['"]$/);
      if (stringCallback) {
        target = resolvePhpFunctionTarget({
          functionName: stringCallback[1]!,
          parsedByPath,
          fileNodeIdsByPath: input.fileNodeIdsByPath,
          stableId: input.stableId,
        });
      }

      const arrayCallback = callback.match(/^\[\s*\$this\s*,\s*['"](\w+)['"]\s*\]$/);
      if (arrayCallback) {
        const classSymbol = parsed.symbols.find((symbol) => symbol.kind === "class");
        if (classSymbol) {
          const qualifiedType = namespaceName
            ? `${namespaceName}\\${classSymbol.name}`
            : classSymbol.name;
          const methodNodeId = symbolNodeIdForMethod({
            qualifiedType,
            methodName: arrayCallback[1]!,
            index,
            parsedByPath,
            stableId: input.stableId,
          });
          if (methodNodeId) {
            target = { targetNodeId: methodNodeId, resolution: "symbol" };
          }
        }
      }

      const staticArrayCallback = callback.match(/^\[\s*([\w\\]+)::class\s*,\s*['"](\w+)['"]\s*\]$/);
      if (staticArrayCallback) {
        const qualifiedType = resolvePhpQualifiedType({
          simpleOrQualified: staticArrayCallback[1]!.replace(/::class$/, ""),
          namespaceName,
          imports: plainImports,
          index,
          aliasMap,
        });
        if (qualifiedType) {
          const methodNodeId = symbolNodeIdForMethod({
            qualifiedType,
            methodName: staticArrayCallback[2]!,
            index,
            parsedByPath,
            stableId: input.stableId,
          });
          if (methodNodeId) {
            target = { targetNodeId: methodNodeId, resolution: "symbol" };
          }
        }
      }

      if (!target) continue;
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: target.targetNodeId,
        relation: "wordpress_hook",
        label: `hook ${hookName}`,
        resolution: target.resolution,
        metadata: {
          scannerHookName: hookName,
        },
      });
    }
  }

  const result: PhpSemanticLiteResult = {
    active: semanticLiteEdgeCount > 0,
    edgeCount: semanticLiteEdgeCount,
    analyzer: input.analyzer,
    diagnostics: [],
  };
  result.diagnostics = buildPhpSemanticDiagnostics(result);
  return { edges, externalNodes: [...externalNodes.values()], result };
}