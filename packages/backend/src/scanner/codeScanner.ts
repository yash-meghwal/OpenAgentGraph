import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import ts from "typescript";
import type {
  ProductEdgeKind,
  ProductGraphEdge,
  ProductGraphNode,
  ProductGraphProjection,
  ProductMetadataValue,
  ProductSourceRef,
  ScanBreakerStatus,
  ScanProgressSnapshot,
  SkipDiagnostic,
  SkipReason,
  WorkspaceKernelProfile,
} from "@openagentgraph/shared";
import {
  DEFAULT_LIGHTWEIGHT_SCAN_LIMITS,
  DEFAULT_SEMANTIC_SCAN_LIMITS,
  buildScanProgressSnapshot,
  createScanBreakerStatus,
  markScanBreakerHit,
  normalizeScanBreakerLimits,
  scanBreakerDiagnostics,
  updateScanBreakerNear,
} from "./scanProgress.js";
import {
  BASE_SKIPPED_DIRECTORIES,
  detectWorkspaceScanProfile,
  isDotNetConfigExtension,
  isDotNetSourceExtension,
  isTypeScriptScannableExtension,
  isUnsupportedSourceExtension,
  normalizeScannerProjectPath,
  pathContainsSkippedDirectory,
  recordSkippedDirectory,
  recordSourceExtension,
  workspaceProfileDiagnostics,
  workspaceProfileToMetadata,
  type WorkspaceScanProfile,
} from "./scannerHygiene.js";
import {
  augmentDotNetWorkspaceGraph,
  createDotNetSymbolLookup,
  DOTNET_SCANNER_VERSION,
  indexDotNetFile,
  registerDotNetSymbolNode,
} from "./kernel/dotnetScanner.js";
import { IgnoreEngine } from "./kernel/ignoreEngine.js";
import { detectWorkspaceKernelProfile, kernelProfileDiagnostics } from "./kernel/workspaceDetection.js";

const SCANNER_VERSION = "1";
const MAX_PRODUCT_NODE_ID_LENGTH = 128;
const MAX_PRODUCT_NODE_TITLE_LENGTH = 180;
const MAX_PRODUCT_NODE_SUMMARY_LENGTH = 1_000;
const MAX_PRODUCT_EDGE_LABEL_LENGTH = 180;
const SCANNABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"] as const;
const SCANNABLE_EXTENSION_SET = new Set<string>(SCANNABLE_EXTENSIONS);
const PRODUCT_GRAPH_EXTENSION_SET = new Set(
  [...SCANNABLE_EXTENSIONS, ".cs", ".xaml", ".csproj", ".sln", ".props", ".targets"]
);
const MAX_DEPENDENCY_METADATA_LENGTH = 480;
const MAX_METHOD_METADATA_LENGTH = 480;
const TSCONFIG_CANDIDATE_PATTERN = /^tsconfig(?:[.-].*)?\.json$/i;
const MAX_SEMANTIC_CONFIG_PATHS = 8;
const SYNTHETIC_SEMANTIC_CONFIG_FILENAME = "openagentgraph.synthetic.tsconfig.json";


export interface CodebaseScanSummary {
  fileCount: number;
  symbolCount: number;
  communityCount: number;
  edgeCount: number;
  dependencyEdgeCount: number;
  externalDependencyCount: number;
  unresolvedDependencyCount: number;
  semanticAnalysisEnabled: boolean;
  semanticAnalysisSucceeded: boolean;
  semanticEdgeCount: number;
  semanticResolutionCount: number;
  semanticConfigCount: number;
  semanticConfiguredFileCount: number;
  semanticSyntheticFileCount: number;
  semanticUnconfiguredFileCount: number;
  semanticConfigPaths: string[];
  semanticFallbackReason?: string;
  skippedFileCount: number;
  skippedDirectoryCount: number;
  archivedNodeCount: number;
  archivedEdgeCount: number;
  durationMs: number;
  partial: boolean;
  breakers: {
    lightweight: ScanBreakerStatus;
    semantic: ScanBreakerStatus;
  };
  progress: ScanProgressSnapshot;
  diagnostics: string[];
  workspaceProfile?: WorkspaceScanProfile;
  kernelProfile?: WorkspaceKernelProfile;
  skippedCountsByReason?: Partial<Record<SkipReason, number>>;
  skipDiagnostics?: SkipDiagnostic[];
}

export interface CodebaseScanPlan {
  scanId: string;
  scannedAt: string;
  nodes: ProductGraphNode[];
  edges: ProductGraphEdge[];
  staleNodeIds: string[];
  staleEdgeIds: string[];
  summary: CodebaseScanSummary;
}

interface ScanFile {
  absolutePath: string;
  relativePath: string;
  size: number;
}

interface ScanStats {
  skippedFileCount: number;
  skippedDirectoryCount: number;
  skippedDirectoryCounts: Map<string, number>;
  skippedCountsByReason: Map<SkipReason, number>;
  skipDiagnostics: SkipDiagnostic[];
  sourceExtensionCounts: Map<string, number>;
  totalBytes: number;
  filesScanned: number;
  partial: boolean;
  breakers: ScanBreakerStatus;
  progress: ScanProgressSnapshot;
  ignoreEngine: IgnoreEngine;
}

type DependencyKind = "import" | "export" | "dynamic_import" | "require";

interface DependencySpec {
  sourceFilePath: string;
  sourceFileNodeId: string;
  moduleSpecifier: string;
  dependencyKind: DependencyKind;
  line: number;
  typeOnly: boolean;
}

interface MethodMetadata {
  names: string[];
  details: string[];
  staticNames: string[];
  asyncNames: string[];
  lineEntries: string[];
  records: Array<{
    name: string;
    line: number;
    visibility: string;
    isStatic: boolean;
    isAsync: boolean;
    node: ts.MethodDeclaration;
  }>;
}

interface DependencySourceStats {
  totalCount: number;
  resolvedCount: number;
  externalCount: number;
  unresolvedCount: number;
  targets: Set<string>;
  externalSpecifiers: Set<string>;
  unresolvedSpecifiers: Set<string>;
}

interface ScannedFileResult {
  file: ScanFile;
  fileNode: ProductGraphNode | undefined;
  symbolNodes: ProductGraphNode[];
  edges: ProductGraphEdge[];
  dependencySpecs: DependencySpec[];
  skippedFileCount: number;
}

interface SemanticProgramContext {
  configPath: string;
  program: ts.Program;
  checker: ts.TypeChecker;
  host: ts.CompilerHost;
  options: ts.CompilerOptions;
  resolutionCache: ts.ModuleResolutionCache;
}

interface SemanticAnalysisContext {
  enabled: boolean;
  succeeded: boolean;
  fallbackReason?: string;
  workspaceRoot: string;
  contextsBySourcePath: Map<string, SemanticProgramContext>;
  configCount: number;
  configuredFileCount: number;
  syntheticFileCount: number;
  unconfiguredFileCount: number;
  configPaths: string[];
}

interface SemanticAnalysisBudgetOptions {
  maxFiles?: number;
  maxTotalBytes?: number;
  maxDurationMs?: number;
  now?: () => number;
}

interface SemanticAnalysisBudget {
  maxFiles: number;
  maxTotalBytes: number;
  maxDurationMs: number;
  fileCount: number;
  totalBytes: number;
  startedAt: number;
  now: () => number;
}

interface SemanticConfigCandidate {
  configPath: string;
  relativePath: string;
  directory: string;
  depth: number;
}

interface ParsedSemanticConfig {
  candidate: SemanticConfigCandidate;
  parsed: ts.ParsedCommandLine;
  fileNameSet: Set<string>;
}

interface SyntheticSemanticProgramResult {
  context?: SemanticProgramContext;
  fallbackReason?: string;
}

function stableProductId(prefix: string, rawValue: string) {
  const hash = createHash("sha1").update(rawValue).digest("hex").slice(0, 12);
  const slug = rawValue
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "item";
  return `${prefix}:${slug}:${hash}`.slice(0, MAX_PRODUCT_NODE_ID_LENGTH);
}

function contentHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeProjectPath(projectPath: string) {
  return projectPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function compactMetadata(
  input: Record<string, ProductMetadataValue | undefined>
): Record<string, ProductMetadataValue> | undefined {
  const entries = Object.entries(input).filter((entry): entry is [string, ProductMetadataValue] =>
    entry[1] !== undefined
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function codeScanSourceRef(projectPath: string, line?: number): ProductSourceRef {
  return {
    kind: "code_scan",
    label: "Codebase scan",
    path: projectPath,
    line,
  };
}

function isInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isInsideOrSameRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function safeRealpath(value: string) {
  try {
    return await fs.realpath(value);
  } catch {
    return path.resolve(value);
  }
}

function scanProgressFromStats(input: {
  scanId: string;
  startedAt: number;
  phase: ScanProgressSnapshot["phase"];
  stats: Omit<ScanStats, "progress">;
  message?: string;
}) {
  return buildScanProgressSnapshot({
    scanId: input.scanId,
    scope: "product_codebase",
    phase: input.phase,
    startedAtMs: input.startedAt,
    filesScanned: input.stats.filesScanned,
    bytesScanned: input.stats.totalBytes,
    skippedFileCount: input.stats.skippedFileCount,
    skippedDirectoryCount: input.stats.skippedDirectoryCount,
    breakers: input.stats.breakers,
    ...(input.message ? { message: input.message } : {}),
  });
}

async function collectFiles(
  root: string,
  input: {
    scanId: string;
    startedAt: number;
    limits?: Partial<ScanBreakerStatus["limits"]>;
    onProgress?: (snapshot: ScanProgressSnapshot) => void;
    now?: () => number;
  }
): Promise<{ files: ScanFile[]; stats: ScanStats }> {
  const realRoot = await safeRealpath(root);
  const ignoreEngine = await IgnoreEngine.load(realRoot);
  const pending = [{ absolutePath: realRoot, depth: 0 }];
  const files: ScanFile[] = [];
  const limits = normalizeScanBreakerLimits(input.limits, DEFAULT_LIGHTWEIGHT_SCAN_LIMITS);
  const breakers = createScanBreakerStatus(limits);
  const now = input.now ?? Date.now;
  const stats: ScanStats = {
    skippedFileCount: 0,
    skippedDirectoryCount: 0,
    skippedDirectoryCounts: new Map<string, number>(),
    skippedCountsByReason: new Map<SkipReason, number>(),
    skipDiagnostics: [],
    sourceExtensionCounts: new Map<string, number>(),
    totalBytes: 0,
    partial: false,
    filesScanned: 0,
    breakers,
    ignoreEngine,
    progress: buildScanProgressSnapshot({
      scanId: input.scanId,
      scope: "product_codebase",
      phase: "collecting_files",
      startedAtMs: input.startedAt,
      filesScanned: 0,
      bytesScanned: 0,
      skippedFileCount: 0,
      skippedDirectoryCount: 0,
      breakers,
      message: "Collecting source files.",
    }),
  };
  input.onProgress?.(stats.progress);
  let stopTraversal = false;

  const publishProgress = (message?: string) => {
    updateScanBreakerNear(stats.breakers, {
      maxFiles: stats.filesScanned,
      maxTotalBytes: stats.totalBytes,
      maxDurationMs: now() - input.startedAt,
    });
    stats.progress = scanProgressFromStats({
      scanId: input.scanId,
      startedAt: input.startedAt,
      phase: "collecting_files",
      stats,
      message,
    });
    input.onProgress?.(stats.progress);
  };

  while (pending.length > 0 && !stopTraversal) {
    const elapsedMs = now() - input.startedAt;
    if (elapsedMs > limits.maxDurationMs) {
      stats.partial = true;
      markScanBreakerHit(
        stats.breakers,
        "maxDurationMs",
        elapsedMs,
        `Codebase scan stopped after ${Math.round(elapsedMs)}ms because OPENAGENTGRAPH_SCAN_MAX_DURATION_MS is ${limits.maxDurationMs}.`
      );
      publishProgress("Scan duration breaker hit.");
      break;
    }

    const current = pending.shift()!;
    const currentProjectPath = normalizeScannerProjectPath(path.relative(realRoot, current.absolutePath)) || ".";
    await ignoreEngine.enterDirectory(currentProjectPath, current.absolutePath);
    let entries: Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }>;
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      stats.skippedDirectoryCount += 1;
      stats.partial = true;
      const unreadableDirectoryPath = normalizeScannerProjectPath(path.relative(realRoot, current.absolutePath)) || ".";
      ignoreEngine.recordSkip(stats.skippedCountsByReason, stats.skipDiagnostics, {
        path: unreadableDirectoryPath,
        decision: {
          reason: "unreadable",
          detail: "Directory could not be read during codebase scan.",
        },
      });
      publishProgress("A directory could not be read.");
      continue;
    }

    for (const entry of entries) {
      const entryElapsedMs = now() - input.startedAt;
      if (entryElapsedMs > limits.maxDurationMs) {
        stats.partial = true;
        stopTraversal = true;
        markScanBreakerHit(
          stats.breakers,
          "maxDurationMs",
          entryElapsedMs,
          `Codebase scan stopped after ${Math.round(entryElapsedMs)}ms because OPENAGENTGRAPH_SCAN_MAX_DURATION_MS is ${limits.maxDurationMs}.`
        );
        publishProgress("Scan duration breaker hit.");
        break;
      }

      const absolutePath = path.join(current.absolutePath, entry.name);
      if (entry.isSymbolicLink()) {
        const realPath = await safeRealpath(absolutePath);
        if (!isInsideRoot(realRoot, realPath)) {
          stats.skippedFileCount += 1;
          continue;
        }
      }

      const projectPath = normalizeScannerProjectPath(path.relative(realRoot, absolutePath));

      if (entry.isDirectory()) {
        const directoryDecision = ignoreEngine.shouldSkip(projectPath, true);
        if (directoryDecision) {
          stats.skippedDirectoryCount += 1;
          recordSkippedDirectory(stats.skippedDirectoryCounts, entry.name);
          ignoreEngine.recordSkip(stats.skippedCountsByReason, stats.skipDiagnostics, {
            path: projectPath,
            decision: directoryDecision,
          });
          continue;
        }
        if (current.depth >= limits.maxDepth) {
          stats.skippedDirectoryCount += 1;
          stats.partial = true;
          markScanBreakerHit(
            stats.breakers,
            "maxDepth",
            current.depth + 1,
            `Codebase scan skipped ${projectPath} because directory depth exceeded ${limits.maxDepth}.`
          );
          ignoreEngine.recordSkip(stats.skippedCountsByReason, stats.skipDiagnostics, {
            path: projectPath,
            decision: {
              reason: "breaker",
              detail: `Directory depth exceeded ${limits.maxDepth}.`,
            },
          });
          publishProgress("Directory depth breaker hit.");
          continue;
        }
        pending.push({ absolutePath, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) {
        stats.skippedFileCount += 1;
        ignoreEngine.recordSkip(stats.skippedCountsByReason, stats.skipDiagnostics, {
          path: projectPath,
          decision: {
            reason: "unsupported",
            detail: "Entry is not a regular file.",
          },
        });
        continue;
      }

      const fileIgnoreDecision = ignoreEngine.shouldSkip(projectPath, false);
      if (fileIgnoreDecision) {
        stats.skippedFileCount += 1;
        ignoreEngine.recordSkip(stats.skippedCountsByReason, stats.skipDiagnostics, {
          path: projectPath,
          decision: fileIgnoreDecision,
        });
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!PRODUCT_GRAPH_EXTENSION_SET.has(extension)) {
        if (isUnsupportedSourceExtension(extension)) {
          stats.skippedFileCount += 1;
          ignoreEngine.recordSkip(stats.skippedCountsByReason, stats.skipDiagnostics, {
            path: projectPath,
            decision: {
              reason: "unsupported",
              detail: `Extension '${extension}' is detected source code but not indexed by the codebase scanner in base v1.`,
            },
          });
        }
        continue;
      }

      let fileStat;
      try {
        fileStat = await fs.stat(absolutePath);
      } catch {
        stats.skippedFileCount += 1;
        ignoreEngine.recordSkip(stats.skippedCountsByReason, stats.skipDiagnostics, {
          path: projectPath,
          decision: {
            reason: "unreadable",
            detail: "File could not be stat'd during codebase scan.",
          },
        });
        continue;
      }

      if (fileStat.size > limits.maxFileBytes) {
        stats.skippedFileCount += 1;
        stats.partial = true;
        markScanBreakerHit(
          stats.breakers,
          "maxFileBytes",
          fileStat.size,
          `Codebase scan skipped ${projectPath} because it exceeds ${limits.maxFileBytes} bytes.`
        );
        ignoreEngine.recordSkip(stats.skippedCountsByReason, stats.skipDiagnostics, {
          path: projectPath,
          decision: {
            reason: "too_large",
            detail: `File exceeds ${limits.maxFileBytes} bytes.`,
          },
        });
        publishProgress("Single-file size breaker hit.");
        continue;
      }
      if (stats.totalBytes + fileStat.size > limits.maxTotalBytes) {
        stats.skippedFileCount += 1;
        stats.partial = true;
        stopTraversal = true;
        markScanBreakerHit(
          stats.breakers,
          "maxTotalBytes",
          stats.totalBytes + fileStat.size,
          `Codebase scan skipped remaining source once total bytes exceeded ${limits.maxTotalBytes}.`
        );
        ignoreEngine.recordSkip(stats.skippedCountsByReason, stats.skipDiagnostics, {
          path: projectPath,
          decision: {
            reason: "breaker",
            detail: `Total scanned bytes would exceed ${limits.maxTotalBytes}.`,
          },
        });
        publishProgress("Total source bytes breaker hit.");
        break;
      }
      if (files.length >= limits.maxFiles) {
        stats.skippedFileCount += 1;
        stats.partial = true;
        stopTraversal = true;
        markScanBreakerHit(
          stats.breakers,
          "maxFiles",
          files.length + 1,
          `Codebase scan skipped remaining source once file count exceeded ${limits.maxFiles}.`
        );
        ignoreEngine.recordSkip(stats.skippedCountsByReason, stats.skipDiagnostics, {
          path: projectPath,
          decision: {
            reason: "breaker",
            detail: `File count would exceed ${limits.maxFiles}.`,
          },
        });
        publishProgress("File count breaker hit.");
        break;
      }

      stats.totalBytes += fileStat.size;
      files.push({
        absolutePath,
        relativePath: normalizeProjectPath(path.relative(realRoot, absolutePath)),
        size: fileStat.size,
      });
      recordSourceExtension(stats.sourceExtensionCounts, extension);
      stats.filesScanned = files.length;
      if (files.length % 100 === 0) {
        publishProgress("Collecting source files.");
      }
    }
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  publishProgress("Source file collection complete.");
  return { files, stats };
}

function scriptKindForPath(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function hasExportModifier(node: ts.Node) {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword
  ));
}

function hasDefaultModifier(node: ts.Node) {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.DefaultKeyword
  ));
}

function lineForNode(sourceFile: ts.SourceFile, node: ts.Node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function symbolKindForDeclaration(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  return undefined;
}

function declarationName(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node))
    && node.name
  ) {
    return node.name.text;
  }
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && hasDefaultModifier(node)) {
    return "default";
  }
  return undefined;
}

function emptyMethodMetadata(): MethodMetadata {
  return {
    names: [],
    details: [],
    staticNames: [],
    asyncNames: [],
    lineEntries: [],
    records: [],
  };
}

function methodVisibility(method: ts.MethodDeclaration) {
  if (ts.isPrivateIdentifier(method.name)) return "private";
  const modifiers = ts.canHaveModifiers(method) ? ts.getModifiers(method) ?? [] : [];
  if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)) return "private";
  if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ProtectedKeyword)) return "protected";
  return "public";
}

function hasMethodModifier(method: ts.MethodDeclaration, kind: ts.SyntaxKind) {
  return ts.canHaveModifiers(method) && Boolean(ts.getModifiers(method)?.some((modifier) => modifier.kind === kind));
}

function classMethodMetadata(node: ts.Node, sourceFile: ts.SourceFile): MethodMetadata {
  if (!ts.isClassDeclaration(node)) return emptyMethodMetadata();
  const metadata = emptyMethodMetadata();
  for (const method of node.members.filter(ts.isMethodDeclaration).slice(0, 20)) {
    const name = method.name.getText(sourceFile);
    if (!name) continue;
    const line = lineForNode(sourceFile, method);
    const visibility = methodVisibility(method);
    const isStatic = hasMethodModifier(method, ts.SyntaxKind.StaticKeyword);
    const isAsync = hasMethodModifier(method, ts.SyntaxKind.AsyncKeyword);
    metadata.names.push(name);
    metadata.lineEntries.push(`${name}:${line}`);
    if (isStatic) metadata.staticNames.push(name);
    if (isAsync) metadata.asyncNames.push(name);
    metadata.details.push(`${visibility}${isStatic ? " static" : ""}${isAsync ? " async" : ""} ${name}@${line}`);
    metadata.records.push({ name, line, visibility, isStatic, isAsync, node: method });
  }
  return metadata;
}

interface SymbolCandidate {
  name: string;
  symbolKind: string;
  node: ts.Node;
  methods?: MethodMetadata;
}

function variableSymbols(statement: ts.VariableStatement): SymbolCandidate[] {
  const symbols: SymbolCandidate[] = [];
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    const initializer = declaration.initializer;
    const symbolKind = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ? "function"
      : "variable";
    symbols.push({ name: declaration.name.text, symbolKind, node: declaration });
  }
  return symbols;
}

function symbolCandidatesForStatement(statement: ts.Statement, sourceFile: ts.SourceFile): SymbolCandidate[] {
  if (ts.isVariableStatement(statement)) return variableSymbols(statement);

  const symbolKind = symbolKindForDeclaration(statement);
  const name = symbolKind ? declarationName(statement) : undefined;
  if (!name || !symbolKind) return [];

  return [{
    name,
    symbolKind,
    node: statement,
    methods: classMethodMetadata(statement, sourceFile),
  }];
}

function exportedSymbolsForStatement(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  topLevelSymbolsByName: Map<string, SymbolCandidate>
): SymbolCandidate[] {
  if (hasExportModifier(statement)) return symbolCandidatesForStatement(statement, sourceFile);

  if (ts.isExportAssignment(statement)) {
    return [{ name: "default", symbolKind: "export", node: statement }];
  }

  if (!ts.isExportDeclaration(statement) || !statement.exportClause) return [];
  if (!ts.isNamedExports(statement.exportClause)) return [];

  return statement.exportClause.elements.map((specifier): SymbolCandidate => {
    if (statement.moduleSpecifier) {
      return { name: specifier.name.text, symbolKind: "export", node: specifier };
    }
    const localName = specifier.propertyName?.text ?? specifier.name.text;
    const exportedName = specifier.name.text;
    const existing = topLevelSymbolsByName.get(localName);
    if (existing) {
      return { ...existing, name: exportedName };
    }
    return { name: exportedName, symbolKind: "export", node: specifier };
  });
}

function stringLiteralText(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function isRequireCall(node: ts.CallExpression) {
  return ts.isIdentifier(node.expression) && node.expression.text === "require";
}

function collectDependencySpecs(
  sourceFile: ts.SourceFile,
  file: ScanFile,
  fileNodeId: string
): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const addSpec = (moduleSpecifier: string | undefined, dependencyKind: DependencyKind, node: ts.Node, typeOnly = false) => {
    if (!moduleSpecifier) return;
    specs.push({
      sourceFilePath: file.relativePath,
      sourceFileNodeId: fileNodeId,
      moduleSpecifier,
      dependencyKind,
      line: lineForNode(sourceFile, node),
      typeOnly,
    });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      addSpec(
        stringLiteralText(statement.moduleSpecifier),
        "import",
        statement.moduleSpecifier,
        statement.importClause?.isTypeOnly === true
      );
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      addSpec(
        stringLiteralText(statement.moduleSpecifier),
        "export",
        statement.moduleSpecifier ?? statement,
        statement.isTypeOnly === true
      );
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const firstArg = node.arguments[0];
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addSpec(stringLiteralText(firstArg), "dynamic_import", node, false);
      } else if (isRequireCall(node)) {
        addSpec(stringLiteralText(firstArg), "require", node, false);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return specs;
}

function stripModuleSpecifierQuery(moduleSpecifier: string) {
  return moduleSpecifier.split(/[?#]/, 1)[0] ?? moduleSpecifier;
}

function isRelativeModuleSpecifier(moduleSpecifier: string) {
  return moduleSpecifier === "." || moduleSpecifier === ".." || moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../");
}

function dependencyResolutionCandidates(normalizedBase: string) {
  const candidates = new Set<string>([normalizedBase]);
  const extension = path.posix.extname(normalizedBase);

  if (!extension) {
    for (const scannableExtension of SCANNABLE_EXTENSIONS) {
      candidates.add(`${normalizedBase}${scannableExtension}`);
    }
    for (const scannableExtension of SCANNABLE_EXTENSIONS) {
      candidates.add(`${normalizedBase}/index${scannableExtension}`);
    }
  } else if (SCANNABLE_EXTENSION_SET.has(extension)) {
    const baseWithoutExtension = normalizedBase.slice(0, -extension.length);
    for (const scannableExtension of SCANNABLE_EXTENSIONS) {
      candidates.add(`${baseWithoutExtension}${scannableExtension}`);
    }
  }

  return [...candidates];
}

function resolveDependencyTargetPath(
  sourceFilePath: string,
  moduleSpecifier: string,
  fileNodeIdsByPath: Map<string, string>
): string | undefined {
  const cleanedSpecifier = stripModuleSpecifierQuery(moduleSpecifier);
  if (!cleanedSpecifier || !isRelativeModuleSpecifier(cleanedSpecifier)) return undefined;

  const sourceDirectory = path.posix.dirname(sourceFilePath);
  const normalizedBase = normalizeProjectPath(path.posix.normalize(path.posix.join(sourceDirectory, cleanedSpecifier)));
  if (!normalizedBase || normalizedBase === "." || normalizedBase.startsWith("../") || normalizedBase.startsWith("..\\")) {
    return undefined;
  }

  for (const candidate of dependencyResolutionCandidates(normalizedBase)) {
    if (fileNodeIdsByPath.has(candidate)) return candidate;
  }
  return undefined;
}

function metadataList(values: Iterable<string>) {
  const text = [...values].sort().join(", ");
  return text ? text.slice(0, MAX_DEPENDENCY_METADATA_LENGTH) : undefined;
}

function boundedReason(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_DEPENDENCY_METADATA_LENGTH);
}

function formatDiagnosticMessage(message: ts.Diagnostic["messageText"]): string {
  return typeof message === "string"
    ? message
    : ts.flattenDiagnosticMessageText(message, " ");
}

function projectPathForAbsolute(workspaceRoot: string, absoluteFilePath: string) {
  const resolvedPath = path.resolve(absoluteFilePath);
  if (!isInsideOrSameRoot(workspaceRoot, resolvedPath)) return undefined;
  const relativePath = normalizeProjectPath(path.relative(workspaceRoot, resolvedPath));
  if (!relativePath || relativePath.startsWith("../") || relativePath.startsWith("..\\")) return undefined;
  return relativePath;
}

function semanticCanonicalPath(filePath: string) {
  const resolvedPath = path.resolve(filePath);
  return ts.sys.useCaseSensitiveFileNames ? resolvedPath : resolvedPath.toLowerCase();
}

function directoryDepth(workspaceRoot: string, directory: string) {
  const relativePath = normalizeProjectPath(path.relative(workspaceRoot, directory));
  if (!relativePath || relativePath === ".") return 0;
  return relativePath.split("/").filter(Boolean).length;
}

function semanticConfigExcludes(excludes: readonly string[] | undefined) {
  const merged = new Set(excludes ?? []);
  for (const directoryName of BASE_SKIPPED_DIRECTORIES) {
    merged.add(directoryName);
    merged.add(`${directoryName}/**`);
    merged.add(`**/${directoryName}`);
    merged.add(`**/${directoryName}/**`);
  }
  return [...merged];
}

function createSemanticParseConfigHost(workspaceRoot: string): ts.ParseConfigHost {
  return {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: (rootDir, extensions, excludes, includes, depth) => {
      const entries = ts.sys.readDirectory(
        rootDir,
        extensions,
        semanticConfigExcludes(excludes),
        includes,
        depth
      );
      return entries.filter((entryPath) => {
        const resolvedPath = path.resolve(entryPath);
        return isInsideOrSameRoot(workspaceRoot, resolvedPath)
          && !pathContainsSkippedDirectory(normalizeProjectPath(path.relative(workspaceRoot, resolvedPath)));
      });
    },
    realpath: ts.sys.realpath,
  };
}

async function discoverSemanticConfigCandidates(
  workspaceRoot: string,
  files: ScanFile[],
  budget: SemanticAnalysisBudget
) {
  const directories = new Set<string>();
  const configPaths = new Map<string, SemanticConfigCandidate>();
  for (const file of files) {
    const budgetReason = semanticBudgetFallbackReason(budget, "tsconfig discovery");
    if (budgetReason) return { candidates: [] as SemanticConfigCandidate[], fallbackReason: budgetReason };
    let currentDirectory = path.dirname(file.absolutePath);
    while (isInsideOrSameRoot(workspaceRoot, currentDirectory)) {
      if (!pathContainsSkippedDirectory(normalizeProjectPath(path.relative(workspaceRoot, currentDirectory)))) {
        directories.add(currentDirectory);
      }
      const nextDirectory = path.dirname(currentDirectory);
      if (nextDirectory === currentDirectory) break;
      currentDirectory = nextDirectory;
    }
  }

  for (const directory of [...directories].sort((left, right) => left.localeCompare(right))) {
    const budgetReason = semanticBudgetFallbackReason(budget, "tsconfig discovery");
    if (budgetReason) return { candidates: [...configPaths.values()], fallbackReason: budgetReason };
    let entries: Array<{ name: string; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !TSCONFIG_CANDIDATE_PATTERN.test(entry.name)) continue;
      const configPath = path.join(directory, entry.name);
      if (pathContainsSkippedDirectory(normalizeProjectPath(path.relative(workspaceRoot, configPath)))) continue;
      const canonicalPath = semanticCanonicalPath(configPath);
      if (configPaths.has(canonicalPath)) continue;
      configPaths.set(canonicalPath, {
        configPath,
        relativePath: normalizeProjectPath(path.relative(workspaceRoot, configPath)),
        directory,
        depth: directoryDepth(workspaceRoot, directory),
      });
    }
  }

  return {
    candidates: [...configPaths.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    fallbackReason: undefined,
  };
}

function semanticConfigRelevanceScore(filePath: string, configPath: string) {
  const normalizedFilePath = `/${normalizeProjectPath(filePath).toLowerCase()}`;
  const configName = path.basename(configPath).toLowerCase();
  let score = 0;
  const isTestFile = normalizedFilePath.includes("/tests/")
    || normalizedFilePath.includes("/test/")
    || normalizedFilePath.includes(".test.")
    || normalizedFilePath.includes(".spec.")
    || normalizedFilePath.includes(".component.");
  if ((configName.includes("test") || configName.includes("spec") || configName.includes("component")) && isTestFile) {
    score += 30;
  }
  if (configName.includes("renderer") && normalizedFilePath.includes("/renderer/")) score += 20;
  if (configName.includes("electron") && normalizedFilePath.includes("/electron/")) score += 20;
  if (configName.includes("node") && normalizedFilePath.includes("/node")) score += 10;
  if (configName.includes("app") && normalizedFilePath.includes("/app")) score += 10;
  return score;
}

function compareSemanticConfigsForFile(file: ScanFile, left: SemanticConfigCandidate, right: SemanticConfigCandidate) {
  if (left.depth !== right.depth) return right.depth - left.depth;
  const leftExact = path.basename(left.configPath).toLowerCase() === "tsconfig.json" ? 1 : 0;
  const rightExact = path.basename(right.configPath).toLowerCase() === "tsconfig.json" ? 1 : 0;
  if (leftExact !== rightExact) return rightExact - leftExact;
  const leftRelevance = semanticConfigRelevanceScore(file.relativePath, left.configPath);
  const rightRelevance = semanticConfigRelevanceScore(file.relativePath, right.configPath);
  if (leftRelevance !== rightRelevance) return rightRelevance - leftRelevance;
  return left.relativePath.localeCompare(right.relativePath);
}

function boundedSemanticConfigPaths(configPaths: Iterable<string>) {
  return [...configPaths].sort().slice(0, MAX_SEMANTIC_CONFIG_PATHS);
}

function firstConfigError(errors: readonly ts.Diagnostic[]) {
  const error = errors.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  return error ? boundedReason(formatDiagnosticMessage(error.messageText)) : undefined;
}

function normalizedSemanticBudgetLimit(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function createSemanticAnalysisBudget(
  files: ScanFile[],
  options: SemanticAnalysisBudgetOptions = {}
): SemanticAnalysisBudget {
  const now = options.now ?? Date.now;
  return {
    maxFiles: normalizedSemanticBudgetLimit(options.maxFiles, DEFAULT_SEMANTIC_SCAN_LIMITS.maxFiles),
    maxTotalBytes: normalizedSemanticBudgetLimit(options.maxTotalBytes, DEFAULT_SEMANTIC_SCAN_LIMITS.maxTotalBytes),
    maxDurationMs: normalizedSemanticBudgetLimit(options.maxDurationMs, DEFAULT_SEMANTIC_SCAN_LIMITS.maxDurationMs),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    startedAt: now(),
    now,
  };
}

function semanticBudgetFallbackReason(budget: SemanticAnalysisBudget, stage: string) {
  if (budget.fileCount > budget.maxFiles) {
    return `Semantic analysis skipped during ${stage}: ${budget.fileCount} files exceeds budget of ${budget.maxFiles}.`;
  }
  if (budget.totalBytes > budget.maxTotalBytes) {
    return `Semantic analysis skipped during ${stage}: ${budget.totalBytes} bytes exceeds budget of ${budget.maxTotalBytes}.`;
  }
  const elapsedMs = Math.max(0, budget.now() - budget.startedAt);
  if (elapsedMs >= budget.maxDurationMs) {
    return `Semantic analysis skipped during ${stage}: ${elapsedMs}ms reached budget of ${budget.maxDurationMs}ms.`;
  }
  return undefined;
}

function createSemanticProgramContext(
  configPath: string,
  rootNames: string[],
  options: ts.CompilerOptions,
  resolutionBasePath = path.dirname(configPath)
): SemanticProgramContext {
  const host = ts.createCompilerHost(options, true);
  const getCanonicalFileName = ts.sys.useCaseSensitiveFileNames
    ? (fileName: string) => fileName
    : (fileName: string) => fileName.toLowerCase();
  const resolutionCache = ts.createModuleResolutionCache(resolutionBasePath, getCanonicalFileName, options);
  const program = ts.createProgram({
    rootNames,
    options,
    host,
  });
  const checker = program.getTypeChecker();
  return {
    configPath,
    program,
    checker,
    host,
    options,
    resolutionCache,
  };
}

function createSyntheticSemanticCompilerOptions(workspaceRoot: string): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    baseUrl: workspaceRoot,
    types: [],
  };
}

function createSyntheticSemanticProgramContext(
  workspaceRoot: string,
  files: ScanFile[],
  budget: SemanticAnalysisBudget,
  stage: string
): SyntheticSemanticProgramResult {
  if (files.length === 0) return {};
  const budgetReason = semanticBudgetFallbackReason(budget, stage);
  if (budgetReason) return { fallbackReason: budgetReason };
  try {
    const configPath = path.join(workspaceRoot, SYNTHETIC_SEMANTIC_CONFIG_FILENAME);
    return {
      context: createSemanticProgramContext(
        configPath,
        files.map((file) => file.absolutePath),
        createSyntheticSemanticCompilerOptions(workspaceRoot),
        workspaceRoot
      ),
    };
  } catch (error) {
    return {
      fallbackReason: error instanceof Error
        ? boundedReason(error.message)
        : "Synthetic semantic analysis initialization failed.",
    };
  }
}

function semanticAnalysisFallback(
  workspaceRoot: string,
  fallbackReason: string,
  metrics: Partial<Pick<SemanticAnalysisContext, "configCount" | "configuredFileCount" | "syntheticFileCount" | "unconfiguredFileCount" | "configPaths">> = {}
): SemanticAnalysisContext {
  return {
    enabled: true,
    succeeded: false,
    fallbackReason: boundedReason(fallbackReason),
    workspaceRoot,
    contextsBySourcePath: new Map(),
    configCount: metrics.configCount ?? 0,
    configuredFileCount: metrics.configuredFileCount ?? 0,
    syntheticFileCount: metrics.syntheticFileCount ?? 0,
    unconfiguredFileCount: metrics.unconfiguredFileCount ?? 0,
    configPaths: metrics.configPaths ?? [],
  };
}

async function buildSemanticAnalysisContext(
  workspaceRoot: string,
  files: ScanFile[],
  budget: SemanticAnalysisBudget
): Promise<SemanticAnalysisContext> {
  const contextsBySourcePath = new Map<string, SemanticProgramContext>();
  const configGroups = new Map<string, ScanFile[]>();
  const scannedFileCanonicalPaths = new Set(files.map((file) => semanticCanonicalPath(file.absolutePath)));

  const initialBudgetReason = semanticBudgetFallbackReason(budget, "semantic setup");
  if (initialBudgetReason) {
    return semanticAnalysisFallback(workspaceRoot, initialBudgetReason, { unconfiguredFileCount: files.length });
  }

  const discovered = await discoverSemanticConfigCandidates(workspaceRoot, files, budget);
  if (discovered.fallbackReason) {
    return semanticAnalysisFallback(workspaceRoot, discovered.fallbackReason, { unconfiguredFileCount: files.length });
  }

  if (discovered.candidates.length === 0) {
    const synthetic = createSyntheticSemanticProgramContext(
      workspaceRoot,
      files,
      budget,
      "synthetic semantic program setup"
    );
    if (synthetic.context) {
      for (const file of files) {
        contextsBySourcePath.set(file.relativePath, synthetic.context);
      }
      return {
        enabled: true,
        succeeded: true,
        workspaceRoot,
        contextsBySourcePath,
        configCount: 0,
        configuredFileCount: 0,
        syntheticFileCount: contextsBySourcePath.size,
        unconfiguredFileCount: 0,
        configPaths: [],
      };
    }
    return {
      enabled: false,
      succeeded: false,
      fallbackReason: synthetic.fallbackReason ?? "No TypeScript project config found.",
      workspaceRoot,
      contextsBySourcePath,
      configCount: 0,
      configuredFileCount: 0,
      syntheticFileCount: 0,
      unconfiguredFileCount: files.length,
      configPaths: [],
    };
  }

  const failures: string[] = [];
  const parsedConfigs: ParsedSemanticConfig[] = [];
  const parseConfigHost = createSemanticParseConfigHost(workspaceRoot);
  for (const candidate of discovered.candidates) {
    const budgetReason = semanticBudgetFallbackReason(budget, "tsconfig discovery");
    if (budgetReason) {
      return semanticAnalysisFallback(workspaceRoot, budgetReason, { unconfiguredFileCount: files.length });
    }
    try {
      const readResult = ts.readConfigFile(candidate.configPath, ts.sys.readFile);
      if (readResult.error) {
        failures.push(firstConfigError([readResult.error]) ?? `Could not read ${path.basename(candidate.configPath)}.`);
        continue;
      }
      const parsed = ts.parseJsonConfigFileContent(
        readResult.config,
        parseConfigHost,
        path.dirname(candidate.configPath),
        {
          allowJs: true,
          checkJs: false,
          noEmit: true,
          skipLibCheck: true,
        },
        candidate.configPath
      );
      const configError = firstConfigError(parsed.errors);
      if (configError) {
        failures.push(`${candidate.relativePath}: ${configError}`);
        continue;
      }
      parsedConfigs.push({
        candidate,
        parsed,
        fileNameSet: new Set(
          parsed.fileNames
            .map(semanticCanonicalPath)
            .filter((fileName) => scannedFileCanonicalPaths.has(fileName))
        ),
      });
    } catch (error) {
      failures.push(error instanceof Error ? boundedReason(error.message) : `Could not parse ${candidate.relativePath}.`);
    }
  }

  const usedConfigCandidates = new Map<string, SemanticConfigCandidate>();
  for (const file of files) {
    const canonicalFilePath = semanticCanonicalPath(file.absolutePath);
    const matchingConfigs = parsedConfigs
      .filter((config) => config.fileNameSet.has(canonicalFilePath))
      .sort((left, right) => compareSemanticConfigsForFile(file, left.candidate, right.candidate));
    const configPath = matchingConfigs[0]?.candidate.configPath;
    if (!configPath) continue;
    const existing = configGroups.get(configPath) ?? [];
    existing.push(file);
    configGroups.set(configPath, existing);
    usedConfigCandidates.set(configPath, matchingConfigs[0]!.candidate);
  }

  const initializedConfigPaths = new Set<string>();
  for (const [configPath, configFiles] of configGroups.entries()) {
    const budgetReason = semanticBudgetFallbackReason(budget, `semantic program setup for ${path.basename(configPath)}`);
    if (budgetReason) {
      return semanticAnalysisFallback(workspaceRoot, budgetReason, { unconfiguredFileCount: files.length });
    }
    try {
      const parsedConfig = parsedConfigs.find((config) => config.candidate.configPath === configPath);
      if (!parsedConfig) {
        failures.push(`Could not initialize ${path.basename(configPath)}.`);
        continue;
      }
      const options: ts.CompilerOptions = {
        ...parsedConfig.parsed.options,
        allowJs: true,
        checkJs: false,
        noEmit: true,
        skipLibCheck: true,
      };
      const context = createSemanticProgramContext(
        configPath,
        configFiles.map((file) => file.absolutePath),
        options
      );
      const programBudgetReason = semanticBudgetFallbackReason(budget, `semantic program setup for ${path.basename(configPath)}`);
      if (programBudgetReason) {
        const configPaths = boundedSemanticConfigPaths([...initializedConfigPaths]
          .map((initializedConfigPath) => usedConfigCandidates.get(initializedConfigPath)?.relativePath)
          .filter((relativePath): relativePath is string => Boolean(relativePath)));
        return semanticAnalysisFallback(workspaceRoot, programBudgetReason, {
          configCount: initializedConfigPaths.size,
          configuredFileCount: contextsBySourcePath.size,
          syntheticFileCount: 0,
          unconfiguredFileCount: Math.max(0, files.length - contextsBySourcePath.size),
          configPaths,
        });
      }
      for (const file of configFiles) {
        contextsBySourcePath.set(file.relativePath, context);
      }
      initializedConfigPaths.add(configPath);
    } catch (error) {
      failures.push(error instanceof Error ? boundedReason(error.message) : "Semantic analysis initialization failed.");
    }
  }

  const unconfiguredFiles = files.filter((file) => !contextsBySourcePath.has(file.relativePath));
  const projectConfigFileCount = contextsBySourcePath.size;
  const synthetic = createSyntheticSemanticProgramContext(
    workspaceRoot,
    unconfiguredFiles,
    budget,
    "synthetic semantic program setup"
  );
  if (synthetic.fallbackReason && contextsBySourcePath.size === 0) {
    const configPaths = boundedSemanticConfigPaths([...initializedConfigPaths]
      .map((configPath) => usedConfigCandidates.get(configPath)?.relativePath)
      .filter((relativePath): relativePath is string => Boolean(relativePath)));
    return semanticAnalysisFallback(workspaceRoot, synthetic.fallbackReason, {
      configCount: initializedConfigPaths.size,
      configuredFileCount: contextsBySourcePath.size,
      syntheticFileCount: 0,
      unconfiguredFileCount: Math.max(0, files.length - contextsBySourcePath.size),
      configPaths,
    });
  }
  let syntheticFileCount = 0;
  if (synthetic.context) {
    for (const file of unconfiguredFiles) {
      contextsBySourcePath.set(file.relativePath, synthetic.context);
    }
    syntheticFileCount = unconfiguredFiles.length;
  }

  const configPaths = boundedSemanticConfigPaths([...initializedConfigPaths]
    .map((configPath) => usedConfigCandidates.get(configPath)?.relativePath)
    .filter((relativePath): relativePath is string => Boolean(relativePath)));
  const coveredFileCount = projectConfigFileCount + syntheticFileCount;
  const unconfiguredFileCount = Math.max(0, files.length - coveredFileCount);
  const partialSyntheticFallbackReason = synthetic.fallbackReason && unconfiguredFileCount > 0
    ? `Synthetic semantic coverage could not cover ${unconfiguredFileCount} ${unconfiguredFileCount === 1 ? "file" : "files"}: ${synthetic.fallbackReason}`
    : undefined;
  return {
    enabled: true,
    succeeded: coveredFileCount > 0,
    fallbackReason: partialSyntheticFallbackReason ??
      (contextsBySourcePath.size > 0 ? undefined : (failures[0] ?? "Semantic analysis initialization failed.")),
    workspaceRoot,
    contextsBySourcePath,
    configCount: initializedConfigPaths.size,
    configuredFileCount: projectConfigFileCount,
    syntheticFileCount,
    unconfiguredFileCount,
    configPaths,
  };
}

function semanticTargetPathForDependency(
  semanticAnalysis: SemanticAnalysisContext,
  dependencySpec: DependencySpec,
  fileNodeIdsByPath: Map<string, string>
) {
  const context = semanticAnalysis.contextsBySourcePath.get(dependencySpec.sourceFilePath);
  if (!context) return undefined;
  try {
    const cleanedSpecifier = stripModuleSpecifierQuery(dependencySpec.moduleSpecifier);
    if (!cleanedSpecifier) return undefined;
    const sourceFileName = path.resolve(semanticAnalysis.workspaceRoot, dependencySpec.sourceFilePath);
    const resolved = ts.resolveModuleName(
      cleanedSpecifier,
      sourceFileName,
      context.options,
      context.host,
      context.resolutionCache
    ).resolvedModule;
    if (!resolved?.resolvedFileName) return undefined;
    const projectPath = projectPathForAbsolute(semanticAnalysis.workspaceRoot, resolved.resolvedFileName);
    return projectPath && fileNodeIdsByPath.has(projectPath) ? projectPath : undefined;
  } catch {
    return undefined;
  }
}

function updateFileDependencyMetadata(
  fileNode: ProductGraphNode,
  stats: DependencySourceStats | undefined
) {
  if (!stats || stats.totalCount === 0) return;
  fileNode.metadata = compactMetadata({
    ...(fileNode.metadata ?? {}),
    scannerImportCount: stats.totalCount,
    scannerResolvedDependencyCount: stats.resolvedCount,
    scannerExternalDependencyCount: stats.externalCount,
    scannerUnresolvedDependencyCount: stats.unresolvedCount,
    scannerDependencyTargets: metadataList(stats.targets),
    scannerExternalDependencies: metadataList(stats.externalSpecifiers),
    scannerUnresolvedDependencies: metadataList(stats.unresolvedSpecifiers),
  });
}

function communityKeyForFilePath(filePath: string) {
  const segments = normalizeProjectPath(filePath).split("/").filter(Boolean);
  if (segments[0] === "packages" && segments[1]) {
    return { key: `packages/${segments[1]}`, title: `packages/${segments[1]}`, communityKind: "package" };
  }
  if (segments.length > 1) {
    return { key: segments[0], title: segments[0], communityKind: "directory" };
  }
  return { key: ".", title: "root", communityKind: "root" };
}

async function buildScannedDotNetFile(
  file: ScanFile,
  scanId: string,
  scannedAt: string
): Promise<ScannedFileResult> {
  let body: string;
  try {
    body = await fs.readFile(file.absolutePath, "utf8");
  } catch {
    return { file, fileNode: undefined, symbolNodes: [], edges: [], dependencySpecs: [], skippedFileCount: 1 };
  }

  const extension = path.extname(file.relativePath).toLowerCase();
  const hash = contentHash(body);
  const fileNodeId = stableProductId("code-scan:file", file.relativePath);
  const dotnetRole = isDotNetConfigExtension(extension) ? "config" : "source";
  const indexed = indexDotNetFile({
    filePath: file.relativePath,
    extension,
    body,
    sizeBytes: file.size,
    scanId,
    scannedAt,
    stableId: stableProductId,
    compactMetadata,
    sourceRef: codeScanSourceRef,
    maxTitleLength: MAX_PRODUCT_NODE_TITLE_LENGTH,
    maxEdgeLabelLength: MAX_PRODUCT_EDGE_LABEL_LENGTH,
  });
  const fileNode: ProductGraphNode = {
    id: fileNodeId,
    kind: "code_file",
    title: file.relativePath.slice(0, MAX_PRODUCT_NODE_TITLE_LENGTH),
    summary: `Scanned ${dotnetRole} file (${Math.round(file.size / 1024)} KB).`.slice(0, MAX_PRODUCT_NODE_SUMMARY_LENGTH),
    status: "planned",
    tags: ["code", "code-scan", dotnetRole === "config" ? "code-config" : "code-source", "dotnet-t0"],
    source: codeScanSourceRef(file.relativePath),
    metadata: compactMetadata({
      scannerVersion: SCANNER_VERSION,
      scanId,
      scannedAt,
      contentHash: hash,
      scannerSourceFile: file.relativePath,
      fileSizeBytes: file.size,
      scannerLanguage: "csharp",
      scannerIndexingMode: "t0",
      scannerDotNetVersion: DOTNET_SCANNER_VERSION,
      scannerDotNetRole: dotnetRole,
      scannerSemanticSupported: false,
      ...indexed.fileMetadata,
    }),
    createdAt: scannedAt,
    updatedAt: scannedAt,
  };

  return {
    file,
    fileNode,
    symbolNodes: indexed.symbolNodes,
    edges: indexed.edges,
    dependencySpecs: [],
    skippedFileCount: 0,
  };
}

async function buildScannedFile(
  file: ScanFile,
  scanId: string,
  scannedAt: string,
  options: { promoteMethodNodes?: boolean } = {}
): Promise<ScannedFileResult> {
  const extension = path.extname(file.relativePath).toLowerCase();
  if (isDotNetSourceExtension(extension) || isDotNetConfigExtension(extension)) {
    return buildScannedDotNetFile(file, scanId, scannedAt);
  }
  if (!isTypeScriptScannableExtension(extension)) {
    return { file, fileNode: undefined, symbolNodes: [], edges: [], dependencySpecs: [], skippedFileCount: 1 };
  }

  let body: string;
  try {
    body = await fs.readFile(file.absolutePath, "utf8");
  } catch {
    return { file, fileNode: undefined, symbolNodes: [], edges: [], dependencySpecs: [], skippedFileCount: 1 };
  }

  const hash = contentHash(body);
  const sourceFile = ts.createSourceFile(file.relativePath, body, ts.ScriptTarget.Latest, false, scriptKindForPath(file.relativePath));
  const fileNodeId = stableProductId("code-scan:file", file.relativePath);
  const fileNode: ProductGraphNode = {
    id: fileNodeId,
    kind: "code_file",
    title: file.relativePath.slice(0, MAX_PRODUCT_NODE_TITLE_LENGTH),
    summary: `Scanned code file (${Math.round(file.size / 1024)} KB).`.slice(0, MAX_PRODUCT_NODE_SUMMARY_LENGTH),
    status: "planned",
    tags: ["code", "code-scan"],
    source: codeScanSourceRef(file.relativePath),
    metadata: compactMetadata({
      scannerVersion: SCANNER_VERSION,
      scanId,
      scannedAt,
      contentHash: hash,
      scannerSourceFile: file.relativePath,
      fileSizeBytes: file.size,
    }),
    createdAt: scannedAt,
    updatedAt: scannedAt,
  };
  const symbolNodes: ProductGraphNode[] = [];
  const edges: ProductGraphEdge[] = [];
  const dependencySpecs = collectDependencySpecs(sourceFile, file, fileNodeId);
  const addedSymbolIds = new Set<string>();

  function addSymbol(name: string, symbolKind: string, node: ts.Node, methods: MethodMetadata = emptyMethodMetadata()) {
    const line = lineForNode(sourceFile, node);
    const rawId = `${file.relativePath}|${symbolKind}|${name}`;
    const symbolNodeId = stableProductId("code-scan:symbol", rawId);
    if (addedSymbolIds.has(symbolNodeId)) return;
    addedSymbolIds.add(symbolNodeId);

    const symbolNode: ProductGraphNode = {
      id: symbolNodeId,
      kind: "code_symbol",
      title: `${name} (${symbolKind})`.slice(0, MAX_PRODUCT_NODE_TITLE_LENGTH),
      status: "planned",
      tags: ["code", "code-scan"],
      source: codeScanSourceRef(file.relativePath, line),
      metadata: compactMetadata({
        scannerVersion: SCANNER_VERSION,
        scanId,
        scannedAt,
        scannerSourceFile: file.relativePath,
        scannerSymbolKind: symbolKind,
        scannerSymbolName: name,
        scannerSymbolLine: line,
        methodCount: methods.names.length || undefined,
        methodNames: methods.names.length > 0 ? methods.names.join(", ").slice(0, 240) : undefined,
        methodDetails: methods.details.length > 0 ? methods.details.join("; ").slice(0, MAX_METHOD_METADATA_LENGTH) : undefined,
        methodStaticNames: methods.staticNames.length > 0 ? methods.staticNames.join(", ").slice(0, 240) : undefined,
        methodAsyncNames: methods.asyncNames.length > 0 ? methods.asyncNames.join(", ").slice(0, 240) : undefined,
        methodLines: methods.lineEntries.length > 0 ? methods.lineEntries.join(", ").slice(0, 240) : undefined,
      }),
      createdAt: scannedAt,
      updatedAt: scannedAt,
    };
    symbolNodes.push(symbolNode);
    edges.push({
      id: stableProductId("code-scan:edge", `${symbolNodeId}|${fileNodeId}|belongs_to`),
      sourceNodeId: symbolNodeId,
      targetNodeId: fileNodeId,
      kind: "belongs_to",
      trust: "extracted",
      label: "Symbol belongs to file".slice(0, MAX_PRODUCT_EDGE_LABEL_LENGTH),
      source: codeScanSourceRef(file.relativePath, line),
      metadata: compactMetadata({
        scannerVersion: SCANNER_VERSION,
        scanId,
        scannedAt,
        scannerRelation: "source_file",
      }),
      createdAt: scannedAt,
      updatedAt: scannedAt,
    });

    if (options.promoteMethodNodes && symbolKind === "class") {
      for (const method of methods.records) {
        const methodName = `${name}.${method.name}`;
        const methodNodeId = stableProductId("code-scan:symbol", `${file.relativePath}|method|${methodName}`);
        if (addedSymbolIds.has(methodNodeId)) continue;
        addedSymbolIds.add(methodNodeId);
        const methodNode: ProductGraphNode = {
          id: methodNodeId,
          kind: "code_symbol",
          title: `${methodName} (method)`.slice(0, MAX_PRODUCT_NODE_TITLE_LENGTH),
          status: "planned",
          tags: ["code", "code-scan"],
          source: codeScanSourceRef(file.relativePath, method.line),
          metadata: compactMetadata({
            scannerVersion: SCANNER_VERSION,
            scanId,
            scannedAt,
            scannerSourceFile: file.relativePath,
            scannerSymbolKind: "method",
            scannerSymbolName: methodName,
            scannerMethodName: method.name,
            scannerParentSymbolName: name,
            scannerSymbolLine: method.line,
            scannerMethodVisibility: method.visibility,
            scannerMethodStatic: method.isStatic,
            scannerMethodAsync: method.isAsync,
          }),
          createdAt: scannedAt,
          updatedAt: scannedAt,
        };
        symbolNodes.push(methodNode);
        edges.push({
          id: stableProductId("code-scan:edge", `${methodNodeId}|${symbolNodeId}|belongs_to`),
          sourceNodeId: methodNodeId,
          targetNodeId: symbolNodeId,
          kind: "belongs_to",
          trust: "extracted",
          label: "Method belongs to class".slice(0, MAX_PRODUCT_EDGE_LABEL_LENGTH),
          source: codeScanSourceRef(file.relativePath, method.line),
          metadata: compactMetadata({
            scannerVersion: SCANNER_VERSION,
            scanId,
            scannedAt,
            scannerRelation: "class_member",
          }),
          createdAt: scannedAt,
          updatedAt: scannedAt,
        });
      }
    }
  }

  const topLevelSymbolsByName = new Map<string, SymbolCandidate>();
  for (const statement of sourceFile.statements) {
    for (const symbol of symbolCandidatesForStatement(statement, sourceFile)) {
      if (symbol.name !== "default") topLevelSymbolsByName.set(symbol.name, symbol);
    }
  }

  for (const statement of sourceFile.statements) {
    for (const symbol of exportedSymbolsForStatement(statement, sourceFile, topLevelSymbolsByName)) {
      addSymbol(symbol.name, symbol.symbolKind, symbol.node, symbol.methods);
    }
  }

  symbolNodes.sort((left, right) => left.id.localeCompare(right.id));
  edges.sort((left, right) => left.id.localeCompare(right.id));
  return { file, fileNode, symbolNodes, edges, dependencySpecs, skippedFileCount: 0 };
}

function isCodeScanNode(node: ProductGraphProjection["nodes"][number]) {
  return node.source?.kind === "code_scan"
    || node.tags?.includes("code-scan") === true
    || node.metadata?.scannerSourceFile !== undefined
    || node.metadata?.scannerSymbolName !== undefined;
}

function isCodeScanEdge(edge: ProductGraphProjection["edges"][number]) {
  return edge.source?.kind === "code_scan"
    || edge.metadata?.scannerRelation !== undefined
    || edge.metadata?.scannerVersion !== undefined;
}

function buildDependencyEdges(input: {
  dependencySpecs: DependencySpec[];
  fileNodeIdsByPath: Map<string, string>;
  semanticAnalysis?: SemanticAnalysisContext;
  scanId: string;
  scannedAt: string;
}) {
  const dependenciesByPair = new Map<string, {
    sourceFilePath: string;
    sourceFileNodeId: string;
    targetFilePath: string;
    targetFileNodeId: string;
    firstLine: number;
    specifiers: Set<string>;
    kinds: Set<string>;
    resolutions: Set<string>;
    dependencyCount: number;
    semanticDependencyCount: number;
    typeOnlyCount: number;
  }>();
  const dependencyStatsBySource = new Map<string, DependencySourceStats>();

  const statsForSource = (sourceFilePath: string) => {
    const existing = dependencyStatsBySource.get(sourceFilePath);
    if (existing) return existing;
    const stats: DependencySourceStats = {
      totalCount: 0,
      resolvedCount: 0,
      externalCount: 0,
      unresolvedCount: 0,
      targets: new Set(),
      externalSpecifiers: new Set(),
      unresolvedSpecifiers: new Set(),
    };
    dependencyStatsBySource.set(sourceFilePath, stats);
    return stats;
  };

  for (const dependencySpec of input.dependencySpecs) {
    const stats = statsForSource(dependencySpec.sourceFilePath);
    stats.totalCount += 1;

    const cleanedSpecifier = stripModuleSpecifierQuery(dependencySpec.moduleSpecifier);
    const relativeSpecifier = isRelativeModuleSpecifier(cleanedSpecifier);
    const semanticTargetFilePath = input.semanticAnalysis?.succeeded
      ? semanticTargetPathForDependency(input.semanticAnalysis, dependencySpec, input.fileNodeIdsByPath)
      : undefined;
    const targetFilePath = semanticTargetFilePath ?? resolveDependencyTargetPath(
      dependencySpec.sourceFilePath,
      dependencySpec.moduleSpecifier,
      input.fileNodeIdsByPath
    );
    const targetFileNodeId = targetFilePath ? input.fileNodeIdsByPath.get(targetFilePath) : undefined;
    if (!targetFilePath || !targetFileNodeId || targetFileNodeId === dependencySpec.sourceFileNodeId) {
      if (!relativeSpecifier) {
        stats.externalCount += 1;
        stats.externalSpecifiers.add(dependencySpec.moduleSpecifier);
        continue;
      }
      stats.unresolvedCount += 1;
      stats.unresolvedSpecifiers.add(dependencySpec.moduleSpecifier);
      continue;
    }

    stats.resolvedCount += 1;
    stats.targets.add(targetFilePath);
    const pairKey = `${dependencySpec.sourceFileNodeId}|${targetFileNodeId}`;
    const existing = dependenciesByPair.get(pairKey);
    const aggregate = existing ?? {
      sourceFilePath: dependencySpec.sourceFilePath,
      sourceFileNodeId: dependencySpec.sourceFileNodeId,
      targetFilePath,
      targetFileNodeId,
      firstLine: dependencySpec.line,
      specifiers: new Set<string>(),
      kinds: new Set<string>(),
      resolutions: new Set<string>(),
      dependencyCount: 0,
      semanticDependencyCount: 0,
      typeOnlyCount: 0,
    };
    aggregate.firstLine = Math.min(aggregate.firstLine, dependencySpec.line);
    aggregate.specifiers.add(dependencySpec.moduleSpecifier);
    aggregate.kinds.add(dependencySpec.dependencyKind);
    aggregate.resolutions.add(semanticTargetFilePath ? "semantic" : "conservative");
    aggregate.dependencyCount += 1;
    if (semanticTargetFilePath) aggregate.semanticDependencyCount += 1;
    if (dependencySpec.typeOnly) aggregate.typeOnlyCount += 1;
    dependenciesByPair.set(pairKey, aggregate);
  }

  const edges = [...dependenciesByPair.values()].map((dependency): ProductGraphEdge => ({
    id: stableProductId("code-scan:edge", `${dependency.sourceFileNodeId}|${dependency.targetFileNodeId}|depends_on`),
    sourceNodeId: dependency.sourceFileNodeId,
    targetNodeId: dependency.targetFileNodeId,
    kind: "depends_on",
    trust: "extracted",
    label: "File imports file".slice(0, MAX_PRODUCT_EDGE_LABEL_LENGTH),
    source: codeScanSourceRef(dependency.sourceFilePath, dependency.firstLine),
    metadata: compactMetadata({
      scannerVersion: SCANNER_VERSION,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerRelation: "module_dependency",
      scannerSourceFile: dependency.sourceFilePath,
      scannerTargetFile: dependency.targetFilePath,
      scannerDependencyLine: dependency.firstLine,
      scannerDependencyCount: dependency.dependencyCount,
      scannerDependencyKinds: metadataList(dependency.kinds),
      scannerDependencySpecifiers: metadataList(dependency.specifiers),
      scannerResolution: dependency.resolutions.has("semantic") ? "semantic" : "conservative",
      scannerResolutions: metadataList(dependency.resolutions),
      scannerTypeOnlyDependencyCount: dependency.typeOnlyCount || undefined,
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  })).sort((left, right) => left.id.localeCompare(right.id));

  const unresolvedDependencyCount = [...dependencyStatsBySource.values()]
    .reduce((total, stats) => total + stats.unresolvedCount, 0);
  const externalDependencyCount = [...dependencyStatsBySource.values()]
    .reduce((total, stats) => total + stats.externalCount, 0);
  const semanticResolutionCount = [...dependenciesByPair.values()]
    .reduce((total, dependency) => total + dependency.semanticDependencyCount, 0);
  return { edges, dependencyStatsBySource, externalDependencyCount, unresolvedDependencyCount, semanticResolutionCount };
}

function symbolLookupKey(filePath: string, symbolKind: string, name: string) {
  return `${filePath}|${symbolKind}|${name}`;
}

function buildSymbolLookup(nodes: Iterable<ProductGraphNode>) {
  const lookup = new Map<string, ProductGraphNode>();
  for (const node of nodes) {
    if (node.kind !== "code_symbol") continue;
    const filePath = typeof node.metadata?.scannerSourceFile === "string" ? node.metadata.scannerSourceFile : undefined;
    const symbolKind = typeof node.metadata?.scannerSymbolKind === "string" ? node.metadata.scannerSymbolKind : undefined;
    const symbolName = typeof node.metadata?.scannerSymbolName === "string" ? node.metadata.scannerSymbolName : undefined;
    if (!filePath || !symbolKind || !symbolName) continue;
    lookup.set(symbolLookupKey(filePath, symbolKind, symbolName), node);
  }
  return lookup;
}

function variableDeclarationSymbolKind(node: ts.VariableDeclaration) {
  const initializer = node.initializer;
  return initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ? "function"
    : "variable";
}

function symbolCandidateForDeclaration(node: ts.Declaration): { symbolKind: string; name: string } | undefined {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return { symbolKind: variableDeclarationSymbolKind(node), name: node.name.text };
  }
  const symbolKind = symbolKindForDeclaration(node);
  const name = symbolKind ? declarationName(node) : undefined;
  return symbolKind && name ? { symbolKind, name } : undefined;
}

function symbolNodeForDeclaration(
  declaration: ts.Declaration,
  workspaceRoot: string,
  lookup: Map<string, ProductGraphNode>
) {
  const sourceFile = declaration.getSourceFile();
  const filePath = projectPathForAbsolute(workspaceRoot, sourceFile.fileName);
  const candidate = symbolCandidateForDeclaration(declaration);
  if (!filePath || !candidate) return undefined;
  return lookup.get(symbolLookupKey(filePath, candidate.symbolKind, candidate.name));
}

function semanticTargetSymbolNode(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
  workspaceRoot: string,
  lookup: Map<string, ProductGraphNode>
) {
  if (!symbol) return undefined;
  let resolvedSymbol = symbol;
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      resolvedSymbol = checker.getAliasedSymbol(symbol);
    } catch {
      resolvedSymbol = symbol;
    }
  }
  for (const declaration of resolvedSymbol.declarations ?? []) {
    const node = symbolNodeForDeclaration(declaration, workspaceRoot, lookup);
    if (node) return node;
  }
  return undefined;
}

function buildSourceSymbolMapForFile(
  sourceFile: ts.SourceFile,
  filePath: string,
  lookup: Map<string, ProductGraphNode>
) {
  const topLevelSymbolsByName = new Map<string, SymbolCandidate>();
  for (const statement of sourceFile.statements) {
    for (const symbol of symbolCandidatesForStatement(statement, sourceFile)) {
      if (symbol.name !== "default") topLevelSymbolsByName.set(symbol.name, symbol);
    }
  }

  const sourceSymbolByStatement = new Map<ts.Statement, ProductGraphNode>();
  for (const statement of sourceFile.statements) {
    for (const symbol of exportedSymbolsForStatement(statement, sourceFile, topLevelSymbolsByName)) {
      const node = lookup.get(symbolLookupKey(filePath, symbol.symbolKind, symbol.name));
      if (node) {
        sourceSymbolByStatement.set(statement, node);
        break;
      }
    }
  }
  return sourceSymbolByStatement;
}

function topLevelStatementForNode(node: ts.Node, sourceFile: ts.SourceFile): ts.Statement | undefined {
  let current = node;
  while (current.parent && current.parent !== sourceFile) {
    current = current.parent;
  }
  return ts.isStatement(current) ? current : undefined;
}

function hasAncestor(node: ts.Node, predicate: (candidate: ts.Node) => boolean) {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (predicate(current)) return true;
    current = current.parent;
  }
  return false;
}

function isIdentifierDeclarationName(identifier: ts.Identifier) {
  const parent = identifier.parent;
  return Boolean(
    (ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent))
      && parent.name === identifier
  ) || Boolean(ts.isVariableDeclaration(parent) && parent.name === identifier);
}

function shouldSkipUsesIdentifier(identifier: ts.Identifier) {
  if (isIdentifierDeclarationName(identifier)) return true;
  if (ts.isPropertyAccessExpression(identifier.parent) && identifier.parent.name === identifier) return true;
  return hasAncestor(identifier, (candidate) =>
    ts.isImportDeclaration(candidate)
    || ts.isImportClause(candidate)
    || ts.isImportSpecifier(candidate)
    || ts.isImportEqualsDeclaration(candidate)
    || ts.isExportDeclaration(candidate)
    || ts.isHeritageClause(candidate)
  );
}

function semanticEdgeLabel(kind: ProductEdgeKind) {
  switch (kind) {
    case "uses":
      return "Symbol uses symbol";
    case "exports":
      return "Symbol exports symbol";
    case "implements":
      return "Symbol implements symbol";
    case "extends":
      return "Symbol extends symbol";
    default:
      return "Semantic symbol relationship";
  }
}

function addSemanticEdge(input: {
  edgesById: Map<string, ProductGraphEdge>;
  kind: Extract<ProductEdgeKind, "uses" | "exports" | "implements" | "extends">;
  relation: string;
  sourceNode: ProductGraphNode;
  targetNode: ProductGraphNode;
  sourceFilePath: string;
  line: number;
  scanId: string;
  scannedAt: string;
}) {
  if (input.sourceNode.id === input.targetNode.id) return;
  const edgeId = stableProductId("code-scan:edge", `${input.sourceNode.id}|${input.targetNode.id}|${input.kind}|${input.relation}`);
  if (input.edgesById.has(edgeId)) return;
  input.edgesById.set(edgeId, {
    id: edgeId,
    sourceNodeId: input.sourceNode.id,
    targetNodeId: input.targetNode.id,
    kind: input.kind,
    trust: "extracted",
    label: semanticEdgeLabel(input.kind).slice(0, MAX_PRODUCT_EDGE_LABEL_LENGTH),
    source: codeScanSourceRef(input.sourceFilePath, input.line),
    metadata: compactMetadata({
      scannerVersion: SCANNER_VERSION,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerRelation: input.relation,
      scannerResolution: "semantic",
      scannerSourceFile: input.sourceFilePath,
      scannerSourceSymbol: typeof input.sourceNode.metadata?.scannerSymbolName === "string"
        ? input.sourceNode.metadata.scannerSymbolName
        : undefined,
      scannerTargetFile: typeof input.targetNode.metadata?.scannerSourceFile === "string"
        ? input.targetNode.metadata.scannerSourceFile
        : undefined,
      scannerTargetSymbol: typeof input.targetNode.metadata?.scannerSymbolName === "string"
        ? input.targetNode.metadata.scannerSymbolName
        : undefined,
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  });
}

function addHeritageSemanticEdges(input: {
  edgesById: Map<string, ProductGraphEdge>;
  declaration: ts.ClassDeclaration | ts.InterfaceDeclaration;
  sourceNode: ProductGraphNode;
  sourceFile: ts.SourceFile;
  sourceFilePath: string;
  context: SemanticProgramContext;
  workspaceRoot: string;
  lookup: Map<string, ProductGraphNode>;
  scanId: string;
  scannedAt: string;
}) {
  for (const heritageClause of input.declaration.heritageClauses ?? []) {
    const kind = heritageClause.token === ts.SyntaxKind.ImplementsKeyword ? "implements" : "extends";
    const relation = kind === "implements" ? "symbol_implements" : "symbol_extends";
    for (const heritageType of heritageClause.types) {
      const targetNode = semanticTargetSymbolNode(
        input.context.checker.getSymbolAtLocation(heritageType.expression),
        input.context.checker,
        input.workspaceRoot,
        input.lookup
      );
      if (!targetNode) continue;
      addSemanticEdge({
        edgesById: input.edgesById,
        kind,
        relation,
        sourceNode: input.sourceNode,
        targetNode,
        sourceFilePath: input.sourceFilePath,
        line: lineForNode(input.sourceFile, heritageType),
        scanId: input.scanId,
        scannedAt: input.scannedAt,
      });
    }
  }
}

function buildSemanticSymbolEdges(input: {
  semanticAnalysis: SemanticAnalysisContext;
  nodes: Iterable<ProductGraphNode>;
  scanId: string;
  scannedAt: string;
}) {
  const lookup = buildSymbolLookup(input.nodes);
  const edgesById = new Map<string, ProductGraphEdge>();

  for (const [sourceFilePath, context] of input.semanticAnalysis.contextsBySourcePath.entries()) {
    const sourceFile = context.program.getSourceFile(path.resolve(input.semanticAnalysis.workspaceRoot, sourceFilePath));
    if (!sourceFile) continue;
    const sourceSymbolByStatement = buildSourceSymbolMapForFile(sourceFile, sourceFilePath, lookup);

    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          const sourceNode = lookup.get(symbolLookupKey(sourceFilePath, "export", specifier.name.text));
          if (!sourceNode) continue;
          const targetNode = semanticTargetSymbolNode(
            context.checker.getSymbolAtLocation(specifier.propertyName ?? specifier.name),
            context.checker,
            input.semanticAnalysis.workspaceRoot,
            lookup
          );
          if (!targetNode) continue;
          addSemanticEdge({
            edgesById,
            kind: "exports",
            relation: "symbol_exports",
            sourceNode,
            targetNode,
            sourceFilePath,
            line: lineForNode(sourceFile, specifier),
            scanId: input.scanId,
            scannedAt: input.scannedAt,
          });
        }
      }

      if ((ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement))) {
        const sourceNode = symbolNodeForDeclaration(statement, input.semanticAnalysis.workspaceRoot, lookup);
        if (sourceNode) {
          addHeritageSemanticEdges({
            edgesById,
            declaration: statement,
            sourceNode,
            sourceFile,
            sourceFilePath,
            context,
            workspaceRoot: input.semanticAnalysis.workspaceRoot,
            lookup,
            scanId: input.scanId,
            scannedAt: input.scannedAt,
          });
        }
      }
    }

    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && !shouldSkipUsesIdentifier(node)) {
        const statement = topLevelStatementForNode(node, sourceFile);
        const sourceNode = statement ? sourceSymbolByStatement.get(statement) : undefined;
        if (sourceNode) {
          const targetNode = semanticTargetSymbolNode(
            context.checker.getSymbolAtLocation(node),
            context.checker,
            input.semanticAnalysis.workspaceRoot,
            lookup
          );
          if (targetNode) {
            addSemanticEdge({
              edgesById,
              kind: "uses",
              relation: "symbol_uses",
              sourceNode,
              targetNode,
              sourceFilePath,
              line: lineForNode(sourceFile, node),
              scanId: input.scanId,
              scannedAt: input.scannedAt,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  return [...edgesById.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function buildCommunityGraph(input: {
  files: Array<{ filePath: string; fileNodeId: string }>;
  dependencyEdges: ProductGraphEdge[];
  scanId: string;
  scannedAt: string;
  scanSummaryMetadata?: Record<string, ProductMetadataValue | undefined>;
}) {
  const communitiesByKey = new Map<string, {
    key: string;
    title: string;
    communityKind: string;
    filePaths: string[];
    fileNodeIds: string[];
  }>();
  const communityKeyByFileNodeId = new Map<string, string>();

  for (const file of input.files) {
    const community = communityKeyForFilePath(file.filePath);
    const existing = communitiesByKey.get(community.key) ?? {
      key: community.key,
      title: community.title,
      communityKind: community.communityKind,
      filePaths: [],
      fileNodeIds: [],
    };
    existing.filePaths.push(file.filePath);
    existing.fileNodeIds.push(file.fileNodeId);
    communitiesByKey.set(community.key, existing);
    communityKeyByFileNodeId.set(file.fileNodeId, community.key);
  }

  const communityNodeIdByKey = new Map<string, string>();
  const communityNodes = [...communitiesByKey.values()].map((community): ProductGraphNode => {
    const nodeId = stableProductId("code-scan:community", community.key);
    communityNodeIdByKey.set(community.key, nodeId);
    const fileCount = community.filePaths.length;
    return {
      id: nodeId,
      kind: "code_community",
      title: community.title.slice(0, MAX_PRODUCT_NODE_TITLE_LENGTH),
      summary: `Scanned code module with ${fileCount} ${fileCount === 1 ? "file" : "files"}.`.slice(0, MAX_PRODUCT_NODE_SUMMARY_LENGTH),
      status: "planned",
      tags: ["code", "code-scan", "code-community"],
      source: codeScanSourceRef(community.key),
      metadata: compactMetadata({
        scannerVersion: SCANNER_VERSION,
        scanId: input.scanId,
        scannedAt: input.scannedAt,
        scannerCommunityPath: community.key,
        scannerCommunityKind: community.communityKind,
        scannerCommunityFileCount: fileCount,
        scannerCommunityFiles: metadataList(community.filePaths),
        ...(input.scanSummaryMetadata ?? {}),
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));

  const membershipEdges: ProductGraphEdge[] = [];
  for (const community of communitiesByKey.values()) {
    const communityNodeId = communityNodeIdByKey.get(community.key);
    if (!communityNodeId) continue;
    for (let index = 0; index < community.fileNodeIds.length; index += 1) {
      const fileNodeId = community.fileNodeIds[index]!;
      const filePath = community.filePaths[index]!;
      membershipEdges.push({
        id: stableProductId("code-scan:edge", `${fileNodeId}|${communityNodeId}|belongs_to`),
        sourceNodeId: fileNodeId,
        targetNodeId: communityNodeId,
        kind: "belongs_to",
        trust: "extracted",
        label: "File belongs to module".slice(0, MAX_PRODUCT_EDGE_LABEL_LENGTH),
        source: codeScanSourceRef(filePath),
        metadata: compactMetadata({
          scannerVersion: SCANNER_VERSION,
          scanId: input.scanId,
          scannedAt: input.scannedAt,
          scannerRelation: "module_membership",
          scannerSourceFile: filePath,
          scannerCommunityPath: community.key,
        }),
        createdAt: input.scannedAt,
        updatedAt: input.scannedAt,
      });
    }
  }

  const communityDependencyCounts = new Map<string, {
    sourceCommunityId: string;
    targetCommunityId: string;
    sourceCommunityPath: string;
    targetCommunityPath: string;
    dependencyCount: number;
  }>();
  for (const edge of input.dependencyEdges) {
    const sourceCommunityKey = communityKeyByFileNodeId.get(edge.sourceNodeId);
    const targetCommunityKey = communityKeyByFileNodeId.get(edge.targetNodeId);
    if (!sourceCommunityKey || !targetCommunityKey || sourceCommunityKey === targetCommunityKey) continue;
    const sourceCommunityId = communityNodeIdByKey.get(sourceCommunityKey);
    const targetCommunityId = communityNodeIdByKey.get(targetCommunityKey);
    if (!sourceCommunityId || !targetCommunityId) continue;
    const pairKey = `${sourceCommunityId}|${targetCommunityId}`;
    const existing = communityDependencyCounts.get(pairKey) ?? {
      sourceCommunityId,
      targetCommunityId,
      sourceCommunityPath: sourceCommunityKey,
      targetCommunityPath: targetCommunityKey,
      dependencyCount: 0,
    };
    const dependencyCount = typeof edge.metadata?.scannerDependencyCount === "number"
      ? edge.metadata.scannerDependencyCount
      : 1;
    existing.dependencyCount += dependencyCount;
    communityDependencyCounts.set(pairKey, existing);
  }

  const communityDependencyEdges = [...communityDependencyCounts.values()].map((dependency): ProductGraphEdge => ({
    id: stableProductId("code-scan:edge", `${dependency.sourceCommunityId}|${dependency.targetCommunityId}|depends_on`),
    sourceNodeId: dependency.sourceCommunityId,
    targetNodeId: dependency.targetCommunityId,
    kind: "depends_on",
    trust: "inferred",
    label: "Module depends on module".slice(0, MAX_PRODUCT_EDGE_LABEL_LENGTH),
    source: codeScanSourceRef(dependency.sourceCommunityPath),
    metadata: compactMetadata({
      scannerVersion: SCANNER_VERSION,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerRelation: "module_dependency_cluster",
      scannerSourceCommunity: dependency.sourceCommunityPath,
      scannerTargetCommunity: dependency.targetCommunityPath,
      scannerDependencyCount: dependency.dependencyCount,
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  }));

  const edges = [...membershipEdges, ...communityDependencyEdges].sort((left, right) => left.id.localeCompare(right.id));
  return { communityNodes, edges };
}

export async function scanWorkspaceCodebase(input: {
  workspaceRoot: string;
  projection: ProductGraphProjection;
  promoteMethodNodes?: boolean;
  scanLimits?: Partial<ScanBreakerStatus["limits"]>;
  semanticScanLimits?: Partial<ScanBreakerStatus["limits"]>;
  semanticAnalysisBudget?: SemanticAnalysisBudgetOptions;
  onProgress?: (snapshot: ScanProgressSnapshot) => void;
}): Promise<CodebaseScanPlan> {
  const start = Date.now();
  const scanId = createHash("sha1").update(`${input.workspaceRoot}:${start}`).digest("hex").slice(0, 12);
  const scannedAt = new Date(start).toISOString();
  const workspaceRoot = await safeRealpath(input.workspaceRoot);
  const { files, stats } = await collectFiles(workspaceRoot, {
    scanId,
    startedAt: start,
    limits: input.scanLimits,
    onProgress: input.onProgress,
  });
  const workspaceProfile = await detectWorkspaceScanProfile(workspaceRoot, {
    sourceExtensionCounts: stats.sourceExtensionCounts,
    skippedDirectoryCounts: stats.skippedDirectoryCounts,
  });
  const kernelProfile = await detectWorkspaceKernelProfile(workspaceRoot, {
    ignoreEngine: stats.ignoreEngine,
    ignoreRules: stats.ignoreEngine.rules,
    sourceExtensionCounts: stats.sourceExtensionCounts,
    skippedCountsByReason: stats.skippedCountsByReason,
    warnings: workspaceProfile.warnings,
  });
  const semanticEligibleFiles = files.filter((file) =>
    isTypeScriptScannableExtension(path.extname(file.relativePath).toLowerCase())
  );
  input.onProgress?.(buildScanProgressSnapshot({
    scanId,
    scope: "product_codebase",
    phase: "analyzing_files",
    startedAtMs: start,
    filesScanned: stats.filesScanned,
    bytesScanned: stats.totalBytes,
    skippedFileCount: stats.skippedFileCount,
    skippedDirectoryCount: stats.skippedDirectoryCount,
    breakers: stats.breakers,
    message: "Building file and symbol graph.",
  }));
  const nodesById = new Map<string, ProductGraphNode>();
  const edgesById = new Map<string, ProductGraphEdge>();
  const fileNodeIdsByPath = new Map<string, string>();
  const scannedFiles: ScannedFileResult[] = [];
  const dependencySpecs: DependencySpec[] = [];
  const scannedFileRecords: Array<{ filePath: string; fileNodeId: string }> = [];
  let skippedFileCount = stats.skippedFileCount;

  const dotnetFileBodies = new Map<string, string>();
  const dotnetSymbolLookup = createDotNetSymbolLookup();

  for (const file of files) {
    const scannedFile = await buildScannedFile(file, scanId, scannedAt, {
      promoteMethodNodes: input.promoteMethodNodes,
    });
    scannedFiles.push(scannedFile);
    skippedFileCount += scannedFile.skippedFileCount;
    if (!scannedFile.fileNode) continue;
    fileNodeIdsByPath.set(scannedFile.file.relativePath, scannedFile.fileNode.id);
    scannedFileRecords.push({ filePath: scannedFile.file.relativePath, fileNodeId: scannedFile.fileNode.id });
    dependencySpecs.push(...scannedFile.dependencySpecs);
    nodesById.set(scannedFile.fileNode.id, scannedFile.fileNode);
    for (const symbolNode of scannedFile.symbolNodes) {
      nodesById.set(symbolNode.id, symbolNode);
      registerDotNetSymbolNode(dotnetSymbolLookup, {
        filePath: scannedFile.file.relativePath,
        symbolId: symbolNode.id,
        kind: typeof symbolNode.metadata?.scannerSymbolKind === "string"
          ? symbolNode.metadata.scannerSymbolKind
          : undefined,
        name: typeof symbolNode.metadata?.scannerSymbolName === "string"
          ? symbolNode.metadata.scannerSymbolName
          : undefined,
        parentType: typeof symbolNode.metadata?.scannerSymbolParentType === "string"
          ? symbolNode.metadata.scannerSymbolParentType
          : undefined,
      });
    }
    for (const edge of scannedFile.edges) {
      edgesById.set(edge.id, edge);
    }
    const extension = path.extname(file.relativePath).toLowerCase();
    if (isDotNetSourceExtension(extension) || isDotNetConfigExtension(extension) || extension === ".xaml") {
      try {
        dotnetFileBodies.set(file.relativePath, await fs.readFile(file.absolutePath, "utf8"));
      } catch {
        // File bodies are optional for workspace-level .NET graph augmentation.
      }
    }
  }

  const dotnetWorkspace = augmentDotNetWorkspaceGraph({
    workspaceRoot,
    scanId,
    scannedAt,
    files: files
      .filter((file) => dotnetFileBodies.has(file.relativePath))
      .map((file) => ({ relativePath: file.relativePath, body: dotnetFileBodies.get(file.relativePath) })),
    fileNodeIdsByPath,
    symbolLookup: dotnetSymbolLookup,
    stableId: stableProductId,
    compactMetadata,
    sourceRef: codeScanSourceRef,
    maxEdgeLabelLength: MAX_PRODUCT_EDGE_LABEL_LENGTH,
  });
  for (const edge of dotnetWorkspace.edges) {
    edgesById.set(edge.id, edge);
  }

  let semanticAnalysis: SemanticAnalysisContext;
  const semanticLimits = normalizeScanBreakerLimits(input.semanticScanLimits, DEFAULT_SEMANTIC_SCAN_LIMITS);
  const semanticBreakers = createScanBreakerStatus(semanticLimits);
  const semanticBudget = createSemanticAnalysisBudget(semanticEligibleFiles, {
    maxFiles: input.semanticAnalysisBudget?.maxFiles ?? semanticLimits.maxFiles,
    maxTotalBytes: input.semanticAnalysisBudget?.maxTotalBytes ?? semanticLimits.maxTotalBytes,
    maxDurationMs: input.semanticAnalysisBudget?.maxDurationMs ?? semanticLimits.maxDurationMs,
    now: input.semanticAnalysisBudget?.now,
  });
  input.onProgress?.(buildScanProgressSnapshot({
    scanId,
    scope: "product_codebase",
    phase: "semantic_analysis",
    startedAtMs: start,
    filesScanned: stats.filesScanned,
    bytesScanned: stats.totalBytes,
    skippedFileCount,
    skippedDirectoryCount: stats.skippedDirectoryCount,
    breakers: semanticBreakers,
    message: "Running TypeScript semantic analysis when available.",
  }));
  try {
    semanticAnalysis = await buildSemanticAnalysisContext(workspaceRoot, semanticEligibleFiles, semanticBudget);
  } catch (error) {
    semanticAnalysis = {
      enabled: true,
      succeeded: false,
      fallbackReason: error instanceof Error ? boundedReason(error.message) : "Semantic analysis initialization failed.",
      workspaceRoot,
      contextsBySourcePath: new Map(),
      configCount: 0,
      configuredFileCount: 0,
      syntheticFileCount: 0,
      unconfiguredFileCount: semanticEligibleFiles.length,
      configPaths: [],
    };
  }
  if (!semanticAnalysis.succeeded && semanticAnalysis.fallbackReason) {
    if (semanticAnalysis.fallbackReason.includes("files exceeds budget")) {
      markScanBreakerHit(semanticBreakers, "maxFiles", files.length, semanticAnalysis.fallbackReason);
    } else if (semanticAnalysis.fallbackReason.includes("bytes exceeds budget")) {
      markScanBreakerHit(semanticBreakers, "maxTotalBytes", semanticBudget.totalBytes, semanticAnalysis.fallbackReason);
    } else if (semanticAnalysis.fallbackReason.includes("reached budget")) {
      markScanBreakerHit(semanticBreakers, "maxDurationMs", semanticBudget.now() - semanticBudget.startedAt, semanticAnalysis.fallbackReason);
    }
  } else {
    updateScanBreakerNear(semanticBreakers, {
      maxFiles: files.length,
      maxTotalBytes: semanticBudget.totalBytes,
      maxDurationMs: semanticBudget.now() - semanticBudget.startedAt,
    });
  }
  const dependencyGraph = buildDependencyEdges({
    dependencySpecs,
    fileNodeIdsByPath,
    semanticAnalysis,
    scanId,
    scannedAt,
  });
  for (const scannedFile of scannedFiles) {
    if (!scannedFile.fileNode) continue;
    updateFileDependencyMetadata(
      scannedFile.fileNode,
      dependencyGraph.dependencyStatsBySource.get(scannedFile.file.relativePath)
    );
    nodesById.set(scannedFile.fileNode.id, scannedFile.fileNode);
  }
  for (const edge of dependencyGraph.edges) {
    edgesById.set(edge.id, edge);
  }

  let semanticAnalysisSucceeded = semanticAnalysis.succeeded;
  let semanticFallbackReason = semanticAnalysis.fallbackReason;
  let semanticSymbolEdges: ProductGraphEdge[] = [];
  if (semanticAnalysis.succeeded) {
    try {
      semanticSymbolEdges = buildSemanticSymbolEdges({
        semanticAnalysis,
        nodes: nodesById.values(),
        scanId,
        scannedAt,
      });
      for (const edge of semanticSymbolEdges) {
        edgesById.set(edge.id, edge);
      }
    } catch (error) {
      semanticAnalysisSucceeded = false;
      semanticFallbackReason = error instanceof Error
        ? boundedReason(error.message)
        : "Semantic symbol analysis failed.";
    }
  }

  const semanticModuleEdgeCount = dependencyGraph.edges.filter((edge) => edge.metadata?.scannerResolution === "semantic").length;
  const communityGraph = buildCommunityGraph({
    files: scannedFileRecords,
    dependencyEdges: dependencyGraph.edges,
    scanId,
    scannedAt,
    scanSummaryMetadata: {
      scannerPartial: stats.partial,
      scannerSkippedFileCount: skippedFileCount,
      scannerSkippedDirectoryCount: stats.skippedDirectoryCount,
      scannerSemanticAnalysisEnabled: semanticAnalysis.enabled,
      scannerSemanticAnalysisSucceeded: semanticAnalysisSucceeded,
      scannerSemanticEdgeCount: semanticModuleEdgeCount + semanticSymbolEdges.length,
      scannerSemanticResolutionCount: dependencyGraph.semanticResolutionCount,
      scannerSemanticConfigCount: semanticAnalysis.configCount,
      scannerSemanticConfiguredFileCount: semanticAnalysis.configuredFileCount,
      scannerSemanticSyntheticFileCount: semanticAnalysis.syntheticFileCount,
      scannerSemanticUnconfiguredFileCount: semanticAnalysis.unconfiguredFileCount,
      scannerSemanticConfigPaths: metadataList(semanticAnalysis.configPaths),
      scannerSemanticFallbackReason: semanticFallbackReason,
      scannerBreakerState: stats.breakers.state,
      scannerBreakerHitCount: stats.breakers.hits.length,
      scannerBreakerHits: metadataList(stats.breakers.hits.map((hit) => hit.message)),
      scannerMaxFiles: stats.breakers.limits.maxFiles,
      scannerMaxTotalBytes: stats.breakers.limits.maxTotalBytes,
      scannerMaxFileBytes: stats.breakers.limits.maxFileBytes,
      scannerMaxDepth: stats.breakers.limits.maxDepth,
      scannerMaxDurationMs: stats.breakers.limits.maxDurationMs,
      scannerSemanticBreakerState: semanticBreakers.state,
      scannerSemanticBreakerHitCount: semanticBreakers.hits.length,
      scannerSemanticBreakerHits: metadataList(semanticBreakers.hits.map((hit) => hit.message)),
      scannerSemanticMaxFiles: semanticBreakers.limits.maxFiles,
      scannerSemanticMaxTotalBytes: semanticBreakers.limits.maxTotalBytes,
      scannerSemanticMaxFileBytes: semanticBreakers.limits.maxFileBytes,
      scannerSemanticMaxDepth: semanticBreakers.limits.maxDepth,
      scannerSemanticMaxDurationMs: semanticBreakers.limits.maxDurationMs,
      ...workspaceProfileToMetadata(workspaceProfile),
    },
  });
  for (const communityNode of communityGraph.communityNodes) {
    nodesById.set(communityNode.id, communityNode);
  }
  for (const edge of communityGraph.edges) {
    edgesById.set(edge.id, edge);
  }

  const scannedNodeIds = new Set(nodesById.keys());
  const scannedEdgeIds = new Set(edgesById.keys());
  const staleNodeIds = stats.partial
    ? []
    : input.projection.nodes
      .filter((node) => isCodeScanNode(node) && !scannedNodeIds.has(node.id) && node.status !== "archived")
      .map((node) => node.id)
      .sort();
  const staleEdgeIds = stats.partial
    ? []
    : input.projection.edges
      .filter((edge) => isCodeScanEdge(edge) && !scannedEdgeIds.has(edge.id))
      .map((edge) => edge.id)
      .sort();

  const nodes = [...nodesById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const edges = [...edgesById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const diagnostics = [
    ...workspaceProfileDiagnostics(workspaceProfile),
    ...kernelProfileDiagnostics(kernelProfile),
    stats.ignoreEngine.diagnosticsSummary(stats.skippedCountsByReason),
    ...scanBreakerDiagnostics(stats.breakers),
    ...scanBreakerDiagnostics(semanticBreakers),
    ...(semanticFallbackReason ? [`Semantic analysis: ${semanticFallbackReason}`] : []),
  ];
  const progress = buildScanProgressSnapshot({
    scanId,
    scope: "product_codebase",
    phase: "completed",
    startedAtMs: start,
    filesScanned: stats.filesScanned,
    bytesScanned: stats.totalBytes,
    skippedFileCount,
    skippedDirectoryCount: stats.skippedDirectoryCount,
    breakers: stats.breakers,
    message: "Codebase scan completed.",
  });
  input.onProgress?.(progress);
  return {
    scanId,
    scannedAt,
    nodes,
    edges,
    staleNodeIds,
    staleEdgeIds,
    summary: {
      fileCount: nodes.filter((node) => node.kind === "code_file").length,
      symbolCount: nodes.filter((node) => node.kind === "code_symbol").length,
      communityCount: nodes.filter((node) => node.kind === "code_community").length,
      edgeCount: edges.length,
      dependencyEdgeCount: dependencyGraph.edges.length,
      externalDependencyCount: dependencyGraph.externalDependencyCount,
      unresolvedDependencyCount: dependencyGraph.unresolvedDependencyCount,
      semanticAnalysisEnabled: semanticAnalysis.enabled,
      semanticAnalysisSucceeded,
      semanticEdgeCount: semanticModuleEdgeCount + semanticSymbolEdges.length,
      semanticResolutionCount: dependencyGraph.semanticResolutionCount,
      semanticConfigCount: semanticAnalysis.configCount,
      semanticConfiguredFileCount: semanticAnalysis.configuredFileCount,
      semanticSyntheticFileCount: semanticAnalysis.syntheticFileCount,
      semanticUnconfiguredFileCount: semanticAnalysis.unconfiguredFileCount,
      semanticConfigPaths: semanticAnalysis.configPaths,
      semanticFallbackReason,
      skippedFileCount,
      skippedDirectoryCount: stats.skippedDirectoryCount,
      archivedNodeCount: staleNodeIds.length,
      archivedEdgeCount: staleEdgeIds.length,
      durationMs: Date.now() - start,
      partial: stats.partial,
      breakers: {
        lightweight: stats.breakers,
        semantic: semanticBreakers,
      },
      progress,
      diagnostics,
      workspaceProfile,
      kernelProfile,
      skippedCountsByReason: stats.ignoreEngine.skippedCountsRecord(stats.skippedCountsByReason),
      skipDiagnostics: stats.skipDiagnostics,
    },
  };
}
