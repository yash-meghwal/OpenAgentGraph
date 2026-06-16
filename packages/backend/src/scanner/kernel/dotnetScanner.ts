import path from "path";
import type { ProductGraphEdge, ProductGraphNode, ProductMetadataValue } from "@openagentgraph/shared";

export const DOTNET_SCANNER_VERSION = "2.0";
const MAX_SYMBOLS_PER_FILE = 200;
const MAX_USINGS_PER_FILE = 80;

export type DotNetSymbolKind =
  | "namespace"
  | "class"
  | "interface"
  | "enum"
  | "struct"
  | "record"
  | "method"
  | "property"
  | "event"
  | "constructor"
  | "field";

export interface DotNetSymbol {
  name: string;
  kind: DotNetSymbolKind;
  line: number;
  namespace?: string;
  parentType?: string;
  modifiers: string[];
}

export interface DotNetSolutionProject {
  name: string;
  path: string;
  projectGuid: string;
}

export interface DotNetProjectIndex {
  projectPath: string;
  projectName: string;
  targetFrameworks: string[];
  rootNamespace?: string;
  projectReferences: string[];
  packageReferences: string[];
  useWpf: boolean;
  isTestProject: boolean;
  isExecutable: boolean;
}

export interface DotNetFileIndex {
  filePath: string;
  extension: string;
  namespace?: string;
  usings: string[];
  symbols: DotNetSymbol[];
  inherits: Array<{ typeName: string; line: number }>;
  implementedTypes: Array<{ typeName: string; line: number }>;
  xamlClass?: string;
  inferredViewModel?: string;
  isTestFile: boolean;
  isEntryPoint: boolean;
}

export interface DotNetScanContribution {
  symbolNodes: ProductGraphNode[];
  edges: ProductGraphEdge[];
  fileMetadata?: Record<string, ProductMetadataValue>;
}

export type DotNetSymbolLookup = {
  byKey: Map<string, string>;
  classByName: Map<string, string>;
  classByFileAndName: Map<string, string>;
};

export function createDotNetSymbolLookup(): DotNetSymbolLookup {
  return {
    byKey: new Map<string, string>(),
    classByName: new Map<string, string>(),
    classByFileAndName: new Map<string, string>(),
  };
}

export function buildDotNetSymbolKey(input: {
  filePath: string;
  kind: string;
  name: string;
  parentType?: string;
}) {
  return `${input.filePath}|${input.parentType ?? "file"}|${input.kind}|${input.name}`;
}

function isDotNetTestFilePath(filePath: string) {
  return /\.Tests?\./i.test(filePath) || /\/Tests?\//i.test(filePath);
}

export function registerDotNetSymbolNode(
  lookup: DotNetSymbolLookup,
  input: {
    filePath: string;
    symbolId: string;
    kind?: string;
    name?: string;
    parentType?: string;
  }
) {
  const kind = input.kind;
  const name = input.name;
  if (!kind || !name) return;

  const key = buildDotNetSymbolKey({
    filePath: input.filePath,
    kind,
    name,
    parentType: input.parentType,
  });
  lookup.byKey.set(key, input.symbolId);

  if (kind !== "class" || input.parentType) return;

  lookup.classByFileAndName.set(`${input.filePath}|${name}`, input.symbolId);
  const existing = lookup.classByName.get(name);
  const existingFilePath = existing
    ? [...lookup.classByFileAndName.entries()].find(([, id]) => id === existing)?.[0]?.split("|")[0]
    : undefined;
  const shouldReplace =
    !existing
    || (existingFilePath && isDotNetTestFilePath(existingFilePath) && !isDotNetTestFilePath(input.filePath));
  if (shouldReplace) {
    lookup.classByName.set(name, input.symbolId);
  }
}

export function resolveDotNetClassSymbol(lookup: DotNetSymbolLookup, className: string) {
  return lookup.classByName.get(className);
}

export function resolveDotNetSymbolId(
  lookup: DotNetSymbolLookup,
  input: { filePath: string; kind: string; name: string; parentType?: string }
) {
  return lookup.byKey.get(buildDotNetSymbolKey(input));
}

function simpleTypeName(typeName: string) {
  return typeName.split(".").pop() ?? typeName;
}

function findDeclaringTypeSymbol(fileIndex: DotNetFileIndex, line: number) {
  const typeKinds = new Set<DotNetSymbolKind>(["class", "interface", "enum", "struct", "record"]);
  let candidate: DotNetSymbol | undefined;
  for (const symbol of fileIndex.symbols) {
    if (!typeKinds.has(symbol.kind)) continue;
    if (symbol.line <= line && (!candidate || symbol.line >= candidate.line)) {
      candidate = symbol;
    }
  }
  return candidate;
}

export function isResolvedDotNetRelationshipEdge(
  edge: ProductGraphEdge,
  knownNodeIds: Set<string>
) {
  const relation = edge.metadata?.scannerRelation;
  if (typeof relation !== "string") return true;
  if (![
    "project_reference",
    "xaml_code_behind",
    "view_viewmodel",
    "test_target",
    "inherits",
    "implements",
    "semantic_calls",
    "semantic_inherits",
    "semantic_implements",
    "semantic_constructor",
    "semantic_tests",
  ].includes(relation)) {
    return true;
  }
  return knownNodeIds.has(edge.sourceNodeId) && knownNodeIds.has(edge.targetNodeId);
}

function stripCSharpComments(content: string) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const TYPE_LINE_PATTERNS: Array<{ kind: DotNetSymbolKind; regex: RegExp }> = [
  { kind: "class", regex: /^\s*(?:(?:public|private|protected|internal|static|abstract|sealed|partial|unsafe|new)\s+)*class\s+(\w+)/ },
  { kind: "interface", regex: /^\s*(?:(?:public|private|protected|internal)\s+)*interface\s+(\w+)/ },
  { kind: "enum", regex: /^\s*(?:(?:public|private|protected|internal)\s+)*enum\s+(\w+)/ },
  { kind: "struct", regex: /^\s*(?:(?:public|private|protected|internal|readonly|ref|partial|unsafe)\s+)*struct\s+(\w+)/ },
  { kind: "record", regex: /^\s*(?:(?:public|private|protected|internal|partial|sealed|abstract)\s+)*record\s+(?:class|struct)?\s*(\w+)/ },
];

const MEMBER_LINE_PATTERNS: Array<{ kind: DotNetSymbolKind; regex: RegExp }> = [
  { kind: "method", regex: /^\s*(?:(?:public|private|protected|internal|static|virtual|override|async|partial|extern|unsafe|new)\s+)*(?:[\w<>,\[\]?]+\s+)+(\w+)\s*\(/ },
  { kind: "constructor", regex: /^\s*(?:(?:public|private|protected|internal|static|unsafe)\s+)*(\w+)\s*\(/ },
  { kind: "property", regex: /^\s*(?:(?:public|private|protected|internal|static|virtual|override|required|unsafe)\s+)*(?:[\w<>,\[\]?]+\s+)+(\w+)\s*\{\s*(?:get|set)/ },
  { kind: "event", regex: /^\s*(?:(?:public|private|protected|internal|static|virtual|override|unsafe)\s+)*event\s+(?:[\w<>,\[\]?]+\s+)+(\w+)/ },
  { kind: "field", regex: /^\s*(?:(?:public|private|protected|internal|static|readonly|volatile|unsafe|const)\s+)*(?:[\w<>,\[\]?]+\s+)+(\w+)\s*(?:=|;)/ },
];

export function parseSolutionFile(content: string): DotNetSolutionProject[] {
  const projects: DotNetSolutionProject[] = [];
  const regex = /Project\("\{[A-Fa-f0-9-]+\}"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"\{([A-Fa-f0-9-]+)\}"/g;
  for (const match of content.matchAll(regex)) {
    const name = match[1];
    const projectPath = match[2]?.replace(/\\/g, "/");
    const projectGuid = match[3];
    if (!name || !projectPath || !projectGuid) continue;
    projects.push({ name, path: projectPath, projectGuid });
  }
  return projects;
}

export function parseCsprojFile(content: string, projectPath: string): DotNetProjectIndex {
  const normalizedPath = projectPath.replace(/\\/g, "/");
  const projectName = path.posix.basename(normalizedPath, ".csproj");
  const targetFrameworks = [
    ...content.matchAll(/<TargetFramework>([^<]+)<\/TargetFramework>/g),
    ...content.matchAll(/<TargetFrameworks>([^<]+)<\/TargetFrameworks>/g),
  ].flatMap((match) => (match[1] ?? "").split(";").map((value) => value.trim()).filter(Boolean));

  const projectReferences = [...content.matchAll(/<ProjectReference\s+Include="([^"]+)"/gi)]
    .map((match) => match[1]?.replace(/\\/g, "/"))
    .filter((value): value is string => Boolean(value));

  const packageReferences = [...content.matchAll(/<PackageReference\s+Include="([^"]+)"/gi)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));

  const rootNamespaceMatch = content.match(/<RootNamespace>([^<]+)<\/RootNamespace>/i);
  const useWpf = /<UseWPF>\s*true\s*<\/UseWPF>/i.test(content) || /<Project Sdk="Microsoft\.NET\.Sdk\.WindowsDesktop"/i.test(content);
  const outputTypeMatch = content.match(/<OutputType>([^<]+)<\/OutputType>/i);
  const isExecutable = (outputTypeMatch?.[1] ?? "").toLowerCase() === "exe" || /<OutputType>WinExe<\/OutputType>/i.test(content);
  const isTestProject =
    /\.Tests$/i.test(projectName)
    || packageReferences.some((pkg) => /xunit|nunit|mstest/i.test(pkg));

  return {
    projectPath: normalizedPath,
    projectName,
    targetFrameworks,
    rootNamespace: rootNamespaceMatch?.[1]?.trim(),
    projectReferences,
    packageReferences,
    useWpf,
    isTestProject,
    isExecutable,
  };
}

function extractNamespace(content: string) {
  const fileScoped = content.match(/^\s*namespace\s+([\w.]+)\s*;/m);
  if (fileScoped?.[1]) return fileScoped[1];
  const blockScoped = content.match(/^\s*namespace\s+([\w.]+)\s*\{/m);
  return blockScoped?.[1];
}

function extractUsings(content: string) {
  const usings: string[] = [];
  for (const match of content.matchAll(/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm)) {
    const value = match[1];
    if (!value || usings.includes(value)) continue;
    usings.push(value);
    if (usings.length >= MAX_USINGS_PER_FILE) break;
  }
  return usings;
}

function extractInheritance(content: string) {
  const inherits: Array<{ typeName: string; line: number }> = [];
  const implementedTypes: Array<{ typeName: string; line: number }> = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const inheritMatch = line.match(/:\s*([A-Za-z_][\w.]*)/);
    if (!inheritMatch?.[1]) continue;
    const baseType = inheritMatch[1];
    if (baseType === "where") continue;
    inherits.push({ typeName: baseType, line: index + 1 });
    const implPart = line.split(":")[1];
    if (!implPart) continue;
    for (const token of implPart.split(",").slice(1).map((value) => value.trim()).filter(Boolean)) {
      const cleaned = token.replace(/\{.*/, "").trim();
      if (cleaned) implementedTypes.push({ typeName: cleaned, line: index + 1 });
    }
  }
  return { inherits, implementedTypes };
}

function extractTypeSymbols(content: string, namespace?: string): DotNetSymbol[] {
  const symbols: DotNetSymbol[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const pattern of TYPE_LINE_PATTERNS) {
      const match = pattern.regex.exec(line);
      const name = match?.[1];
      if (!name) continue;
      const key = `${pattern.kind}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const modifiers = line.trim().split(/\s+/).filter((token) =>
        ["public", "private", "protected", "internal", "static", "abstract", "sealed", "partial", "record"].includes(token)
      );
      symbols.push({
        name,
        kind: pattern.kind,
        line: index + 1,
        namespace,
        modifiers,
      });
      break;
    }
  }

  return symbols;
}

function extractMemberSymbols(content: string, parentTypes: DotNetSymbol[], namespace?: string): DotNetSymbol[] {
  const symbols: DotNetSymbol[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);
  let currentType = parentTypes[0]?.name;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const pattern of TYPE_LINE_PATTERNS) {
      const match = pattern.regex.exec(line);
      if (match?.[1]) {
        currentType = match[1];
        break;
      }
    }
    if (!currentType) continue;

    for (const pattern of MEMBER_LINE_PATTERNS) {
      const match = pattern.regex.exec(line);
      const name = match?.[1];
      if (!name) continue;
      if (pattern.kind === "constructor" && name !== currentType) continue;
      if (["class", "interface", "enum", "struct", "record"].includes(name)) continue;
      const key = `${currentType}:${pattern.kind}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({
        name,
        kind: pattern.kind,
        line: index + 1,
        namespace,
        parentType: currentType,
        modifiers: line.trim().split(/\s+/).filter((token) =>
          ["public", "private", "protected", "internal", "static", "virtual", "override", "async"].includes(token)
        ),
      });
      break;
    }
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) break;
  }

  return symbols;
}

export function parseCSharpFile(content: string, filePath: string): DotNetFileIndex {
  const sanitized = stripCSharpComments(content);
  const namespace = extractNamespace(sanitized);
  const usings = extractUsings(sanitized);
  const typeSymbols = extractTypeSymbols(sanitized, namespace);
  const memberSymbols = extractMemberSymbols(sanitized, typeSymbols, namespace);
  const { inherits, implementedTypes } = extractInheritance(sanitized);
  const normalizedPath = filePath.replace(/\\/g, "/");
  const isTestFile = /\.Tests?\./i.test(normalizedPath) || typeSymbols.some((symbol) => /Tests?$/.test(symbol.name));
  const isEntryPoint = /\b(?:static\s+)?(?:async\s+)?void\s+Main\s*\(/.test(sanitized)
    || /\bclass\s+Program\b/.test(sanitized)
    || /Top-level\s+statements/i.test(sanitized);

  return {
    filePath: normalizedPath,
    extension: ".cs",
    namespace,
    usings,
    symbols: [...typeSymbols, ...memberSymbols].slice(0, MAX_SYMBOLS_PER_FILE),
    inherits,
    implementedTypes,
    isTestFile,
    isEntryPoint,
  };
}

export function parseXamlFile(content: string, filePath: string): DotNetFileIndex {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const classMatch = content.match(/x:Class="([^"]+)"/i);
  const xamlClass = classMatch?.[1];
  const baseName = path.posix.basename(normalizedPath, ".xaml");
  const inferredViewModel = baseName.endsWith("View")
    ? `${baseName.slice(0, -4)}ViewModel`
    : baseName.endsWith("Page")
      ? `${baseName.slice(0, -4)}ViewModel`
      : undefined;

  return {
    filePath: normalizedPath,
    extension: ".xaml",
    usings: [],
    symbols: [],
    inherits: [],
    implementedTypes: [],
    xamlClass,
    inferredViewModel,
    isTestFile: false,
    isEntryPoint: false,
  };
}

export function indexDotNetFile(input: {
  filePath: string;
  extension: string;
  body: string;
  sizeBytes: number;
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  sourceRef: (projectPath: string, line?: number) => ProductGraphNode["source"];
  maxTitleLength: number;
  maxEdgeLabelLength: number;
}): DotNetScanContribution {
  const extension = input.extension.toLowerCase();
  const fileIndex = extension === ".xaml"
    ? parseXamlFile(input.body, input.filePath)
    : extension === ".cs"
      ? parseCSharpFile(input.body, input.filePath)
      : undefined;

  const dotnetRole = extension === ".csproj" || extension === ".sln" || extension === ".props" || extension === ".targets"
    ? "config"
    : "source";
  const projectIndex = extension === ".csproj" ? parseCsprojFile(input.body, input.filePath) : undefined;
  const solutionProjects = extension === ".sln" ? parseSolutionFile(input.body) : undefined;

  const fileNodeId = input.stableId("code-scan:file", input.filePath);
  const symbolNodes: ProductGraphNode[] = [];
  const edges: ProductGraphEdge[] = [];

  const fileMetadata: Record<string, ProductMetadataValue> = {
    scannerDotNetVersion: DOTNET_SCANNER_VERSION,
    scannerIndexingMode: "t0",
    scannerSemanticSupported: false,
    scannerDotNetRole: dotnetRole,
  };

  if (fileIndex?.namespace) fileMetadata.scannerNamespace = fileIndex.namespace;
  if (fileIndex?.usings.length) fileMetadata.scannerUsings = fileIndex.usings.join(", ");
  if (fileIndex?.isTestFile) fileMetadata.scannerIsTestFile = true;
  if (fileIndex?.isEntryPoint) fileMetadata.scannerIsEntryPoint = true;
  if (fileIndex?.xamlClass) fileMetadata.scannerXamlClass = fileIndex.xamlClass;
  if (fileIndex?.inferredViewModel) fileMetadata.scannerInferredViewModel = fileIndex.inferredViewModel;

  if (projectIndex) {
    fileMetadata.scannerProjectName = projectIndex.projectName;
    if (projectIndex.targetFrameworks.length > 0) {
      fileMetadata.scannerTargetFrameworks = projectIndex.targetFrameworks.join(", ");
    }
    if (projectIndex.rootNamespace) fileMetadata.scannerRootNamespace = projectIndex.rootNamespace;
    fileMetadata.scannerUseWpf = projectIndex.useWpf;
    fileMetadata.scannerIsTestProject = projectIndex.isTestProject;
    fileMetadata.scannerIsExecutable = projectIndex.isExecutable;
    if (projectIndex.projectReferences.length > 0) {
      fileMetadata.scannerProjectReferences = projectIndex.projectReferences.join(", ");
    }
  }

  if (solutionProjects?.length) {
    fileMetadata.scannerSolutionProjects = solutionProjects.map((project) => project.name).join(", ");
  }

  for (const symbol of fileIndex?.symbols ?? []) {
    const rawId = `${input.filePath}|${symbol.parentType ?? "file"}|${symbol.kind}|${symbol.name}`;
    const symbolNodeId = input.stableId("code-scan:symbol", rawId);
    const title = symbol.parentType
      ? `${symbol.parentType}.${symbol.name} (${symbol.kind})`
      : `${symbol.name} (${symbol.kind})`;
    symbolNodes.push({
      id: symbolNodeId,
      kind: "code_symbol",
      title: title.slice(0, input.maxTitleLength),
      status: "planned",
      tags: ["code", "code-scan", "csharp", "dotnet-t0"],
      source: input.sourceRef(input.filePath, symbol.line),
      metadata: input.compactMetadata({
        scannerDotNetVersion: DOTNET_SCANNER_VERSION,
        scanId: input.scanId,
        scannedAt: input.scannedAt,
        scannerSourceFile: input.filePath,
        scannerSymbolKind: symbol.kind,
        scannerSymbolName: symbol.name,
        scannerSymbolParentType: symbol.parentType,
        scannerSymbolNamespace: symbol.namespace,
        scannerLanguage: "csharp",
        scannerIndexingMode: "t0",
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
    edges.push({
      id: input.stableId("code-scan:edge", `${symbolNodeId}|${fileNodeId}|belongs_to`),
      sourceNodeId: symbolNodeId,
      targetNodeId: fileNodeId,
      kind: "belongs_to",
      trust: "extracted",
      label: "Symbol belongs to file".slice(0, input.maxEdgeLabelLength),
      source: input.sourceRef(input.filePath, symbol.line),
      metadata: input.compactMetadata({
        scannerDotNetVersion: DOTNET_SCANNER_VERSION,
        scanId: input.scanId,
        scannedAt: input.scannedAt,
        scannerRelation: "source_file",
        scannerLanguage: "csharp",
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
  }

  return { symbolNodes, edges, fileMetadata };
}

export function augmentDotNetWorkspaceGraph(input: {
  workspaceRoot: string;
  scanId: string;
  scannedAt: string;
  files: Array<{ relativePath: string; body?: string }>;
  fileNodeIdsByPath: Map<string, string>;
  symbolLookup: DotNetSymbolLookup;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  sourceRef: (projectPath: string, line?: number) => ProductGraphEdge["source"];
  maxEdgeLabelLength: number;
}) {
  const edges: ProductGraphEdge[] = [];
  const csprojByPath = new Map<string, DotNetProjectIndex>();
  const csprojByName = new Map<string, string>();
  const xamlByClass = new Map<string, string>();

  for (const file of input.files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension === ".csproj" && file.body) {
      const project = parseCsprojFile(file.body, file.relativePath);
      csprojByPath.set(project.projectPath, project);
      csprojByName.set(project.projectName, project.projectPath);
    }
    if (extension === ".xaml" && file.body) {
      const xaml = parseXamlFile(file.body, file.relativePath);
      if (xaml.xamlClass) xamlByClass.set(xaml.xamlClass, file.relativePath);
    }
  }

  for (const [projectPath, project] of csprojByPath.entries()) {
    const sourceNodeId = input.fileNodeIdsByPath.get(projectPath);
    if (!sourceNodeId) continue;
    for (const reference of project.projectReferences) {
      const resolvedReference = path.posix.normalize(path.posix.join(path.posix.dirname(projectPath), reference));
      const targetNodeId = input.fileNodeIdsByPath.get(resolvedReference);
      if (!targetNodeId) continue;
      edges.push({
        id: input.stableId("code-scan:edge", `${sourceNodeId}|project_ref|${targetNodeId}`),
        sourceNodeId,
        targetNodeId,
        kind: "depends_on",
        trust: "extracted",
        label: "Project reference".slice(0, input.maxEdgeLabelLength),
        source: input.sourceRef(projectPath),
        metadata: input.compactMetadata({
          scannerRelation: "project_reference",
          scannerDotNetVersion: DOTNET_SCANNER_VERSION,
        }),
        createdAt: input.scannedAt,
        updatedAt: input.scannedAt,
      });
    }
  }

  for (const file of input.files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".xaml" || !file.body) continue;
    const xaml = parseXamlFile(file.body, file.relativePath);
    const xamlNodeId = input.fileNodeIdsByPath.get(file.relativePath);
    if (!xamlNodeId || !xaml.xamlClass) continue;

    const codeBehindPath = `${file.relativePath}.cs`;
    const codeBehindNodeId = input.fileNodeIdsByPath.get(codeBehindPath);
    if (codeBehindNodeId) {
      edges.push({
        id: input.stableId("code-scan:edge", `${xamlNodeId}|xaml_codebehind|${codeBehindNodeId}`),
        sourceNodeId: xamlNodeId,
        targetNodeId: codeBehindNodeId,
        kind: "uses",
        trust: "extracted",
        label: "XAML code-behind".slice(0, input.maxEdgeLabelLength),
        source: input.sourceRef(file.relativePath),
        metadata: input.compactMetadata({
          scannerRelation: "xaml_code_behind",
          scannerXamlClass: xaml.xamlClass,
        }),
        createdAt: input.scannedAt,
        updatedAt: input.scannedAt,
      });
    }

    if (xaml.inferredViewModel) {
      const viewModelSymbolId = resolveDotNetClassSymbol(input.symbolLookup, xaml.inferredViewModel);
      if (viewModelSymbolId) {
        edges.push({
          id: input.stableId("code-scan:edge", `${xamlNodeId}|view_viewmodel|${viewModelSymbolId}`),
          sourceNodeId: xamlNodeId,
          targetNodeId: viewModelSymbolId,
          kind: "uses",
          trust: "inferred",
          label: `View -> ${xaml.inferredViewModel}`.slice(0, input.maxEdgeLabelLength),
          source: input.sourceRef(file.relativePath),
          metadata: input.compactMetadata({
            scannerRelation: "view_viewmodel",
            scannerInferredViewModel: xaml.inferredViewModel,
          }),
          createdAt: input.scannedAt,
          updatedAt: input.scannedAt,
        });
      }
    }
  }

  for (const file of input.files) {
    if (!file.body || !file.relativePath.endsWith(".cs")) continue;
    const csharp = parseCSharpFile(file.body, file.relativePath);
    const sourceNodeId = input.fileNodeIdsByPath.get(file.relativePath);
    if (!sourceNodeId) continue;

    for (const inherited of csharp.inherits) {
      const declaringType = findDeclaringTypeSymbol(csharp, inherited.line);
      const sourceSymbolId = declaringType
        ? resolveDotNetSymbolId(input.symbolLookup, {
          filePath: file.relativePath,
          kind: declaringType.kind,
          name: declaringType.name,
          parentType: declaringType.parentType,
        })
        : undefined;
      const targetSymbolId = resolveDotNetClassSymbol(input.symbolLookup, simpleTypeName(inherited.typeName));
      if (!sourceSymbolId || !targetSymbolId) continue;
      edges.push({
        id: input.stableId("code-scan:edge", `${sourceSymbolId}|extends|${targetSymbolId}|${inherited.line}`),
        sourceNodeId: sourceSymbolId,
        targetNodeId: targetSymbolId,
        kind: "extends",
        trust: "extracted",
        label: `inherits ${inherited.typeName}`.slice(0, input.maxEdgeLabelLength),
        source: input.sourceRef(file.relativePath, inherited.line),
        metadata: input.compactMetadata({
          scannerRelation: "inherits",
          scannerInheritedType: inherited.typeName,
          scannerDotNetVersion: DOTNET_SCANNER_VERSION,
        }),
        createdAt: input.scannedAt,
        updatedAt: input.scannedAt,
      });
    }

    for (const implemented of csharp.implementedTypes) {
      const declaringType = findDeclaringTypeSymbol(csharp, implemented.line);
      const sourceSymbolId = declaringType
        ? resolveDotNetSymbolId(input.symbolLookup, {
          filePath: file.relativePath,
          kind: declaringType.kind,
          name: declaringType.name,
          parentType: declaringType.parentType,
        })
        : undefined;
      const targetSymbolId = resolveDotNetClassSymbol(input.symbolLookup, simpleTypeName(implemented.typeName));
      if (!sourceSymbolId || !targetSymbolId) continue;
      edges.push({
        id: input.stableId("code-scan:edge", `${sourceSymbolId}|implements|${targetSymbolId}|${implemented.line}`),
        sourceNodeId: sourceSymbolId,
        targetNodeId: targetSymbolId,
        kind: "implements",
        trust: "extracted",
        label: `implements ${implemented.typeName}`.slice(0, input.maxEdgeLabelLength),
        source: input.sourceRef(file.relativePath, implemented.line),
        metadata: input.compactMetadata({
          scannerRelation: "implements",
          scannerImplementedType: implemented.typeName,
          scannerDotNetVersion: DOTNET_SCANNER_VERSION,
        }),
        createdAt: input.scannedAt,
        updatedAt: input.scannedAt,
      });
    }

    for (const usingNamespace of csharp.usings) {
      edges.push({
        id: input.stableId("code-scan:edge", `${sourceNodeId}|using|${usingNamespace}`),
        sourceNodeId,
        targetNodeId: input.stableId("code-scan:external", usingNamespace),
        kind: "depends_on",
        trust: "extracted",
        label: `using ${usingNamespace}`.slice(0, input.maxEdgeLabelLength),
        source: input.sourceRef(file.relativePath),
        metadata: input.compactMetadata({
          scannerRelation: "using_directive",
          scannerUsingNamespace: usingNamespace,
        }),
        createdAt: input.scannedAt,
        updatedAt: input.scannedAt,
      });
    }

    if (!csharp.isTestFile) continue;
    for (const symbol of csharp.symbols) {
      if (symbol.kind !== "class" || !symbol.name.endsWith("Tests")) continue;
      const candidate = symbol.name.replace(/Tests$/, "");
      const testSymbolId = resolveDotNetSymbolId(input.symbolLookup, {
        filePath: file.relativePath,
        kind: symbol.kind,
        name: symbol.name,
        parentType: symbol.parentType,
      });
      const targetSymbolId = resolveDotNetClassSymbol(input.symbolLookup, candidate);
      if (!testSymbolId || !targetSymbolId) continue;
      edges.push({
        id: input.stableId("code-scan:edge", `${testSymbolId}|tests|${targetSymbolId}`),
        sourceNodeId: testSymbolId,
        targetNodeId: targetSymbolId,
        kind: "uses",
        trust: "inferred",
        label: `tests ${candidate}`.slice(0, input.maxEdgeLabelLength),
        source: input.sourceRef(file.relativePath, symbol.line),
        metadata: input.compactMetadata({
          scannerRelation: "test_target",
        }),
        createdAt: input.scannedAt,
        updatedAt: input.scannedAt,
      });
    }
  }

  return { edges, csprojByName, csprojByPath };
}