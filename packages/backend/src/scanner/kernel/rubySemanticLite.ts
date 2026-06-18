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
import { parseEcosystemFile, type EcosystemFileIndex } from "./ecosystemScanner.js";
import {
  parseGemfile,
  parseGemspec,
  parseRailsRouteTargets,
  railsControllerPath,
  type RailsRouteTarget,
} from "./rubyProjectParsing.js";

export const RUBY_SEMANTIC_LITE_VERSION = "1.0";
export const RUBY_PARSER_ANALYZER_ID = "ruby-parser";
const RUBY_PROBE_TIMEOUT_MS = 5_000;

const RUBY_TYPE_SYMBOL_KINDS = new Set(["class", "rails_controller", "rails_model", "rails_job", "rails_mailer", "rails_service"]);

export interface RubyWorkspaceType {
  filePath: string;
  kind: string;
  simpleName: string;
  qualifiedName: string;
  parentType?: string;
}

export interface RubyWorkspaceIndex {
  typeByQualifiedName: Map<string, RubyWorkspaceType>;
}

export interface RubySemanticLiteResult {
  active: boolean;
  edgeCount: number;
  analyzer?: GraphAnalyzerAvailability;
  diagnostics: string[];
}

function buildRubyParsedFileIndex(files: Array<{ relativePath: string; body: string }>) {
  const parsedByPath = new Map<string, EcosystemFileIndex>();
  for (const file of files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".rb" && extension !== ".rake") continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    if (parsed) parsedByPath.set(file.relativePath.replace(/\\/g, "/"), parsed);
  }
  return parsedByPath;
}

export function qualifyRubyConstant(input: {
  simpleOrQualified: string;
  moduleNamespace?: string;
}) {
  const name = input.simpleOrQualified.trim();
  if (!name) return undefined;
  if (name.includes("::")) return name;
  if (input.moduleNamespace) return `${input.moduleNamespace}::${name}`;
  return name;
}

export function buildRubyWorkspaceIndex(
  files: Array<{ relativePath: string; body: string }>
): RubyWorkspaceIndex {
  const typeByQualifiedName = new Map<string, RubyWorkspaceType>();
  for (const file of files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".rb" && extension !== ".rake") continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    if (!parsed) continue;
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    for (const symbol of parsed.symbols) {
      if (!RUBY_TYPE_SYMBOL_KINDS.has(symbol.kind)) continue;
      const qualifiedName = symbol.parentType ? `${symbol.parentType}::${symbol.name}` : symbol.name;
      typeByQualifiedName.set(qualifiedName, {
        filePath: normalizedPath,
        kind: symbol.kind,
        simpleName: symbol.name,
        qualifiedName,
        parentType: symbol.parentType,
      });
      typeByQualifiedName.set(symbol.name, {
        filePath: normalizedPath,
        kind: symbol.kind,
        simpleName: symbol.name,
        qualifiedName,
        parentType: symbol.parentType,
      });
    }
  }
  return { typeByQualifiedName };
}

export function resolveRubyConstant(input: {
  simpleOrQualified: string;
  moduleNamespace?: string;
  index: RubyWorkspaceIndex;
}) {
  const qualified = qualifyRubyConstant(input);
  if (!qualified) return undefined;
  if (input.index.typeByQualifiedName.has(qualified)) return qualified;
  const simpleName = qualified.split("::").pop() ?? qualified;
  for (const [candidate, type] of input.index.typeByQualifiedName) {
    if (type.simpleName === simpleName && candidate.includes("::")) return candidate;
  }
  if (input.index.typeByQualifiedName.has(simpleName)) return simpleName;
  return qualified;
}

export function resolveRubyRequireTarget(
  importPath: string,
  filePath: string,
  fileNodeIdsByPath: Map<string, string>
) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedDir = path.posix.dirname(normalizedPath);
  const rawPath = importPath.startsWith("relative:")
    ? importPath.slice("relative:".length)
    : importPath.startsWith("require:")
      ? importPath.slice("require:".length)
      : importPath;

  const candidates = rawPath.startsWith(".")
    ? [
        path.posix.normalize(path.posix.join(normalizedDir, rawPath)),
        path.posix.normalize(path.posix.join(normalizedDir, `${rawPath}.rb`)),
      ]
    : [
        `${rawPath}.rb`,
        `lib/${rawPath}.rb`,
        `lib/${rawPath}/${rawPath}.rb`,
      ];

  for (const candidate of candidates) {
    const nodeId = fileNodeIdsByPath.get(candidate);
    if (nodeId) return { targetNodeId: nodeId, resolution: "file" as const };
  }
  return undefined;
}

function symbolNodeIdForQualifiedType(
  qualifiedType: string,
  index: RubyWorkspaceIndex,
  stableId: (prefix: string, raw: string) => string
) {
  const type = index.typeByQualifiedName.get(qualifiedType)
    ?? [...index.typeByQualifiedName.values()].find((entry) => entry.qualifiedName === qualifiedType);
  if (!type) return undefined;
  return stableId(
    "code-scan:symbol",
    `${type.filePath}|${type.parentType ?? "file"}|${type.kind}|${type.simpleName}`
  );
}

function symbolNodeIdForMethod(input: {
  qualifiedType: string;
  methodName: string;
  index: RubyWorkspaceIndex;
  parsedByPath: Map<string, EcosystemFileIndex>;
  stableId: (prefix: string, raw: string) => string;
}) {
  const type = input.index.typeByQualifiedName.get(input.qualifiedType);
  if (!type) return undefined;
  const parsed = input.parsedByPath.get(type.filePath);
  const owner = type.qualifiedName;
  const method = parsed?.symbols.find(
    (symbol) => symbol.kind === "method" && symbol.name === input.methodName
      && (symbol.parentType === owner || symbol.parentType === type.simpleName || symbol.parentType === type.parentType)
  );
  if (!method) return undefined;
  return input.stableId(
    "code-scan:symbol",
    `${type.filePath}|${method.parentType ?? type.simpleName}|method|${method.name}`
  );
}

function resolveRelationshipTarget(input: {
  qualifiedType: string;
  index: RubyWorkspaceIndex;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
}) {
  const symbolNodeId = symbolNodeIdForQualifiedType(input.qualifiedType, input.index, input.stableId);
  if (symbolNodeId) {
    return { targetNodeId: symbolNodeId, resolution: "symbol" as const };
  }
  const simpleName = input.qualifiedType.split("::").pop() ?? input.qualifiedType;
  const snakePath = simpleName
    .replace(/([A-Z])/g, "_$1")
    .replace(/^_/, "")
    .toLowerCase();
  const candidates = [
    `app/models/${snakePath}.rb`,
    `app/controllers/${snakePath}.rb`,
    `lib/${snakePath}.rb`,
    `lib/${snakePath}/${snakePath}.rb`,
  ];
  for (const candidate of candidates) {
    const nodeId = input.fileNodeIdsByPath.get(candidate);
    if (nodeId) return { targetNodeId: nodeId, resolution: "file" as const };
  }
  return {
    targetNodeId: input.stableId("code-scan:external", `ruby|${input.qualifiedType}`),
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
    id: input.stableId("code-scan:external", `ruby|${input.qualifiedType}`),
    kind: "code_symbol",
    title: `${input.qualifiedType} (external)`.slice(0, input.maxTitleLength),
    status: "planned",
    tags: ["code", "code-scan", "ruby", "ecosystem-t1.5", "external-dependency"],
    metadata: input.compactMetadata({
      scannerEcosystemVersion: RUBY_SEMANTIC_LITE_VERSION,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerRelation: input.relation ?? "external_import",
      scannerImportPath: input.qualifiedType,
      scannerLanguage: "ruby",
      scannerIndexingMode: "t1.5",
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

export function buildRubyAnalyzerAvailability(
  input: Partial<GraphAnalyzerAvailability> & Pick<GraphAnalyzerAvailability, "status">
) {
  return buildGraphAnalyzerAvailability({
    ...input,
    id: input.id ?? RUBY_PARSER_ANALYZER_ID,
    label: input.label ?? "Ruby parser helper",
    ecosystemId: input.ecosystemId ?? "ruby",
    tierContribution: input.tierContribution ?? "T1.5",
    mode: input.mode ?? "semantic-lite",
    requiredRuntime: input.requiredRuntime ?? "Ruby CLI (ruby, optional parser enrichment)",
    setupCommandHints: input.setupCommandHints ?? ["ruby -v"],
    autoBuildCapable: input.autoBuildCapable ?? false,
    timeoutMs: input.timeoutMs ?? 30_000,
    maxOutputBytes: input.maxOutputBytes ?? 2_000_000,
  });
}

export async function probeRubyToolchainAvailability(workspaceRoot: string) {
  const result = await runAnalyzerHelper({
    run: {
      command: ["ruby", "-v"],
      workspaceRoot,
      limits: { timeoutMs: RUBY_PROBE_TIMEOUT_MS, maxStdoutBytes: 4_096, maxStderrBytes: 4_096 },
    },
  });
  if (result.timedOut) {
    return { available: false as const, reason: "Ruby probe timed out." };
  }
  const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
  if (result.exitCode !== 0) {
    return {
      available: false as const,
      reason: result.error ?? (combinedOutput || `Ruby probe exited with code ${result.exitCode ?? "unknown"}.`),
    };
  }
  if (!/ruby/i.test(combinedOutput) || !/version/i.test(combinedOutput)) {
    return { available: false as const, reason: "Ruby probe returned unexpected output." };
  }
  return { available: true as const };
}

export function mapRubySemanticLiteRelationToProductEdgeKind(
  relation: "extends" | "require" | "require_relative" | "tests" | "rails_route" | "gem_dependency"
): ProductEdgeKind {
  switch (relation) {
    case "extends":
      return "extends";
    case "rails_route":
      return "uses";
    case "require":
    case "require_relative":
    case "tests":
    case "gem_dependency":
    default:
      return "depends_on";
  }
}

export function buildRubySemanticDiagnostics(result: RubySemanticLiteResult) {
  const lines = ["Ruby structural-lite: available (T1.5)."];
  if (!result.active) {
    lines.push("Ruby semantic-lite: inactive (no resolvable project relationships found).");
    return lines;
  }
  lines.push(`Ruby semantic-lite: enabled (${result.edgeCount} relationship edge(s)).`);
  if (result.analyzer?.status === "unavailable") {
    lines.push(`Ruby optional parser enrichment: unavailable (${result.analyzer.fallbackReason ?? "unknown"}).`);
  } else if (result.analyzer?.status === "enabled") {
    lines.push("Ruby optional parser enrichment: available.");
  }
  return lines;
}

export async function prepareRubySemanticLite(input: {
  workspaceRoot: string;
  disabled?: boolean;
}): Promise<Pick<RubySemanticLiteResult, "analyzer">> {
  if (input.disabled) {
    return {
      analyzer: buildRubyAnalyzerAvailability({
        status: "disabled",
        fallbackReason: "disabled for test",
      }),
    };
  }
  const probe = await probeRubyToolchainAvailability(input.workspaceRoot);
  if (!probe.available) {
    return {
      analyzer: buildRubyAnalyzerAvailability({
        status: "unavailable",
        fallbackReason: probe.reason ?? "Ruby CLI not found on PATH.",
      }),
    };
  }
  return { analyzer: buildRubyAnalyzerAvailability({ status: "enabled" }) };
}

function inferRubySpecTargetPath(specPath: string) {
  const normalized = specPath.replace(/\\/g, "/");
  const specMatch = normalized.match(/^(?:spec|test)\/(.+)_spec\.rb$/i);
  if (!specMatch) return undefined;
  if (normalized.includes("/models/")) {
    return `app/models/${path.basename(normalized).replace(/_spec\.rb$/i, ".rb")}`;
  }
  if (normalized.includes("/controllers/")) {
    return `app/controllers/${path.basename(normalized).replace(/_spec\.rb$/i, ".rb")}`;
  }
  const tail = specMatch[1]!;
  if (tail.includes("/")) {
    return `app/${tail.replace(/\/([^/]+)$/, (_match, name: string) => {
      if (name.endsWith("_controller")) return `/controllers/${name}.rb`;
      return `/${name}.rb`;
    })}`;
  }
  return `app/${tail}.rb`;
}

function resolveRailsControllerType(controllerName: string, index: RubyWorkspaceIndex) {
  const candidates = [
    controllerName,
    controllerName.replace(/_/g, ""),
    controllerName.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(""),
    `${controllerName.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}Controller`,
    controllerName.endsWith("Controller")
      ? controllerName
      : `${controllerName.charAt(0).toUpperCase()}${controllerName.slice(1)}Controller`,
  ];
  for (const candidate of candidates) {
    const resolved = resolveRubyConstant({ simpleOrQualified: candidate, index });
    if (resolved && index.typeByQualifiedName.has(resolved)) return resolved;
  }
  const pascal = controllerName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `${pascal}Controller`;
}

export function augmentRubySemanticLite(input: {
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
  result: RubySemanticLiteResult;
} {
  const edges: ProductGraphEdge[] = [];
  const externalNodes = new Map<string, ProductGraphNode>();
  const parsedByPath = buildRubyParsedFileIndex(input.files);
  const index = buildRubyWorkspaceIndex(input.files);
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
    relation: "extends" | "require" | "require_relative" | "tests" | "rails_route" | "gem_dependency";
    label: string;
    resolution: "symbol" | "file" | "external";
    metadata?: Record<string, ProductMetadataValue | undefined>;
  }) => {
    edges.push({
      id: input.stableId("code-scan:edge", `${edge.sourceNodeId}|${edge.relation}|${edge.targetNodeId}|${edge.label}`),
      kind: mapRubySemanticLiteRelationToProductEdgeKind(edge.relation),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      label: edge.label.slice(0, input.maxEdgeLabelLength),
      trust: edge.resolution === "external" ? "inferred" : "extracted",
      metadata: input.compactMetadata({
        scannerRelation: edge.relation === "require" || edge.relation === "require_relative"
          ? "import"
          : edge.relation,
        scannerLanguage: "ruby",
        scannerResolution: "semantic-lite",
        scannerImportResolution: edge.resolution,
        ...edge.metadata,
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
    semanticLiteEdgeCount += 1;
  };

  for (const file of input.files) {
    const normalizedPath = file.relativePath.replace(/\\/g, "/");
    if (normalizedPath.endsWith("Gemfile")) {
      const sourceNodeId = input.fileNodeIdsByPath.get(normalizedPath);
      if (!sourceNodeId) continue;
      for (const gem of parseGemfile(file.body).gems) {
        const targetNodeId = ensureExternal(gem, "gem_dependency");
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId,
          relation: "gem_dependency",
          label: `gem ${gem}`,
          resolution: "external",
          metadata: { scannerGemName: gem },
        });
      }
      continue;
    }
    if (normalizedPath.endsWith(".gemspec")) {
      const sourceNodeId = input.fileNodeIdsByPath.get(normalizedPath);
      if (!sourceNodeId) continue;
      for (const dependency of parseGemspec(file.body).dependencies) {
        const targetNodeId = ensureExternal(dependency, "gem_dependency");
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId,
          relation: "gem_dependency",
          label: `gem ${dependency}`,
          resolution: "external",
          metadata: { scannerGemName: dependency },
        });
      }
    }
  }

  for (const file of input.files) {
    const parsed = parsedByPath.get(file.relativePath.replace(/\\/g, "/"));
    const sourceNodeId = input.fileNodeIdsByPath.get(file.relativePath);
    if (!parsed || !sourceNodeId) continue;

    const moduleNamespace = parsed.symbols
      .filter((symbol) => symbol.kind === "module")
      .map((symbol) => symbol.name)
      .join("::") || undefined;

    for (const importPath of parsed.imports) {
      if (importPath.startsWith("inherit:")) {
        const parentName = importPath.slice("inherit:".length);
        const qualifiedParent = resolveRubyConstant({
          simpleOrQualified: parentName,
          moduleNamespace,
          index,
        });
        if (!qualifiedParent) continue;
        const sourceSymbol = parsed.symbols.find((symbol) => RUBY_TYPE_SYMBOL_KINDS.has(symbol.kind));
        const sourceSymbolNodeId = sourceSymbol
          ? input.stableId(
            "code-scan:symbol",
            `${file.relativePath.replace(/\\/g, "/")}|${sourceSymbol.parentType ?? "file"}|${sourceSymbol.kind}|${sourceSymbol.name}`
          )
          : sourceNodeId;
        const resolved = resolveRelationshipTarget({
          qualifiedType: qualifiedParent,
          index,
          fileNodeIdsByPath: input.fileNodeIdsByPath,
          stableId: input.stableId,
        });
        if (resolved.resolution === "external") {
          resolved.targetNodeId = ensureExternal(qualifiedParent);
        }
        appendRelationshipEdge({
          sourceNodeId: sourceSymbolNodeId,
          targetNodeId: resolved.targetNodeId,
          relation: "extends",
          label: `extends ${qualifiedParent}`,
          resolution: resolved.resolution,
          metadata: { scannerRelatedType: qualifiedParent },
        });
        continue;
      }

      const relation = importPath.startsWith("relative:") ? "require_relative" : "require";
      const resolvedFile = resolveRubyRequireTarget(importPath, file.relativePath, input.fileNodeIdsByPath);
      if (resolvedFile) {
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId: resolvedFile.targetNodeId,
          relation,
          label: importPath.slice(importPath.indexOf(":") + 1),
          resolution: resolvedFile.resolution,
          metadata: { scannerImportPath: importPath },
        });
        continue;
      }
      const rawImport = importPath.includes(":") ? importPath.slice(importPath.indexOf(":") + 1) : importPath;
      appendRelationshipEdge({
        sourceNodeId,
        targetNodeId: ensureExternal(rawImport),
        relation: importPath.startsWith("relative:") ? "require_relative" : "require",
        label: rawImport,
        resolution: "external",
        metadata: { scannerImportPath: importPath },
      });
    }

    if (parsed.isTestFile) {
      const targetPath = inferRubySpecTargetPath(file.relativePath);
      const targetNodeId = targetPath ? input.fileNodeIdsByPath.get(targetPath) : undefined;
      if (targetNodeId) {
        appendRelationshipEdge({
          sourceNodeId,
          targetNodeId,
          relation: "tests",
          label: `tests ${path.basename(targetPath!)}`,
          resolution: "file",
          metadata: { scannerTestFile: file.relativePath },
        });
      }
    }

    if (file.relativePath.replace(/\\/g, "/").endsWith("config/routes.rb")) {
      for (const routeTarget of parseRailsRouteTargets(file.body)) {
        appendRailsRouteEdge({
          routeTarget,
          sourceNodeId,
          index,
          parsedByPath,
          fileNodeIdsByPath: input.fileNodeIdsByPath,
          stableId: input.stableId,
          appendRelationshipEdge,
        });
      }
    }
  }

  const result: RubySemanticLiteResult = {
    active: semanticLiteEdgeCount > 0,
    edgeCount: semanticLiteEdgeCount,
    analyzer: input.analyzer,
    diagnostics: [],
  };
  result.diagnostics = buildRubySemanticDiagnostics(result);
  return { edges, externalNodes: [...externalNodes.values()], result };
}

function appendRailsRouteEdge(input: {
  routeTarget: RailsRouteTarget;
  sourceNodeId: string;
  index: RubyWorkspaceIndex;
  parsedByPath: Map<string, EcosystemFileIndex>;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
  appendRelationshipEdge: (edge: {
    sourceNodeId: string;
    targetNodeId: string;
    relation: "rails_route";
    label: string;
    resolution: "symbol" | "file" | "external";
    metadata?: Record<string, ProductMetadataValue | undefined>;
  }) => void;
}) {
  const qualifiedController = resolveRailsControllerType(input.routeTarget.controllerName, input.index);
  const controllerPath = railsControllerPath(input.routeTarget.controllerName);
  const controllerFileNodeId = input.fileNodeIdsByPath.get(controllerPath);
  const controllerSymbolNodeId = symbolNodeIdForQualifiedType(
    qualifiedController,
    input.index,
    input.stableId
  );
  const targetNodeId = controllerSymbolNodeId ?? controllerFileNodeId;
  if (!targetNodeId) return;
  const resolution: "symbol" | "file" = controllerSymbolNodeId ? "symbol" : "file";
  const actionLabel = input.routeTarget.actionName ?? "index";
  input.appendRelationshipEdge({
    sourceNodeId: input.sourceNodeId,
    targetNodeId,
    relation: "rails_route",
    label: `route ${input.routeTarget.controllerName}#${actionLabel}`,
    resolution,
    metadata: {
      scannerRouteController: qualifiedController,
      scannerRouteAction: actionLabel,
      scannerRouteResource: input.routeTarget.resource,
    },
  });
}