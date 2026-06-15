import path from "path";
import type { ProductGraphEdge, ProductGraphNode, ProductMetadataValue } from "@openagentgraph/shared";

export const ECOSYSTEM_SCANNER_VERSION = "1.0";

export const PYTHON_SCANNABLE_EXTENSIONS = [".py"] as const;
export const GO_SCANNABLE_EXTENSIONS = [".go"] as const;
export const RUST_SCANNABLE_EXTENSIONS = [".rs"] as const;
export const TERRAFORM_SCANNABLE_EXTENSIONS = [".tf", ".tfvars"] as const;
export const DOC_SCANNABLE_EXTENSIONS = [".md", ".rst"] as const;

export const ECOSYSTEM_CONFIG_FILE_NAMES = new Set([
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
  "manage.py",
]);

const MAX_SYMBOLS_PER_FILE = 120;

export type EcosystemLanguage = "python" | "go" | "rust" | "terraform" | "documentation";

export interface EcosystemSymbol {
  name: string;
  kind: string;
  line: number;
  parentType?: string;
}

export interface EcosystemFileIndex {
  language: EcosystemLanguage;
  filePath: string;
  symbols: EcosystemSymbol[];
  imports: string[];
  isTestFile: boolean;
  headings: string[];
  configMetadata?: Record<string, string>;
}

export interface EcosystemScanContribution {
  symbolNodes: ProductGraphNode[];
  edges: ProductGraphEdge[];
  fileMetadata?: Record<string, ProductMetadataValue>;
}

function lineNumber(body: string, index: number) {
  return body.slice(0, index).split("\n").length;
}

function pushSymbol(
  symbols: EcosystemSymbol[],
  input: { name: string; kind: string; line: number; parentType?: string }
) {
  if (symbols.length >= MAX_SYMBOLS_PER_FILE) return;
  symbols.push(input);
}

export function ecosystemLanguageForExtension(extension: string): EcosystemLanguage | undefined {
  const normalized = extension.toLowerCase();
  if ((PYTHON_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "python";
  if ((GO_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "go";
  if ((RUST_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "rust";
  if ((TERRAFORM_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "terraform";
  if ((DOC_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "documentation";
  return undefined;
}

export function isEcosystemScannableExtension(extension: string) {
  return ecosystemLanguageForExtension(extension) !== undefined;
}

export function isEcosystemConfigFileName(fileName: string) {
  return ECOSYSTEM_CONFIG_FILE_NAMES.has(fileName);
}

function pythonLeadingIndent(line: string) {
  const match = line.match(/^(\s*)/);
  return match?.[1]?.length ?? 0;
}

function parsePythonFile(body: string, filePath: string): EcosystemFileIndex {
  const symbols: EcosystemSymbol[] = [];
  const imports: string[] = [];
  let currentClass: string | undefined;
  let classIndent = -1;
  const isTestFile = /(?:^|\/)tests?\//i.test(filePath) || /_test\.py$/i.test(filePath) || /^test_/i.test(path.basename(filePath));

  for (const [index, rawLine] of body.split("\n").entries()) {
    const indent = pythonLeadingIndent(rawLine);
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (currentClass !== undefined && indent <= classIndent && !/^(?:async\s+)?def\s+\w+/.test(line)) {
      currentClass = undefined;
      classIndent = -1;
    }

    const importMatch = line.match(/^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/);
    if (importMatch) {
      imports.push(importMatch[1] ?? importMatch[2] ?? "");
      continue;
    }
    const classMatch = line.match(/^class\s+(\w+)/);
    if (classMatch) {
      currentClass = classMatch[1];
      classIndent = indent;
      pushSymbol(symbols, { name: currentClass, kind: "class", line: index + 1 });
      continue;
    }
    const defMatch = line.match(/^(?:async\s+)?def\s+(\w+)/);
    if (defMatch) {
      const isClassMethod = currentClass !== undefined && indent > classIndent;
      if (!isClassMethod) {
        currentClass = undefined;
        classIndent = -1;
      }
      pushSymbol(symbols, {
        name: defMatch[1]!,
        kind: "function",
        line: index + 1,
        parentType: isClassMethod ? currentClass : undefined,
      });
    }
  }

  return { language: "python", filePath, symbols, imports, isTestFile, headings: [] };
}

function parseGoImports(body: string) {
  const imports: string[] = [];
  const importBlockPattern = /import\s*\(([\s\S]*?)\)/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = importBlockPattern.exec(body)) !== null) {
    for (const blockLine of blockMatch[1]!.split("\n")) {
      const pathMatch = blockLine.match(/["']([^"']+)["']/);
      if (pathMatch) imports.push(pathMatch[1]!);
    }
  }
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    const importMatch = line.match(/^import\s+(?:\w+\s+)?["']([^"']+)["']/);
    if (importMatch) imports.push(importMatch[1]!);
  }
  return [...new Set(imports)];
}

function parseGoFile(body: string, filePath: string): EcosystemFileIndex {
  const symbols: EcosystemSymbol[] = [];
  const imports = parseGoImports(body);
  const isTestFile = filePath.endsWith("_test.go");

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    const packageMatch = line.match(/^package\s+(\w+)/);
    if (packageMatch) {
      pushSymbol(symbols, { name: packageMatch[1]!, kind: "package", line: index + 1 });
      continue;
    }
    if (/^import\b/.test(line)) continue;
    const funcMatch = line.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)/);
    if (funcMatch) {
      pushSymbol(symbols, { name: funcMatch[1]!, kind: "function", line: index + 1 });
      continue;
    }
    const structMatch = line.match(/^type\s+(\w+)\s+struct\b/);
    if (structMatch) {
      pushSymbol(symbols, { name: structMatch[1]!, kind: "struct", line: index + 1 });
      continue;
    }
    const interfaceMatch = line.match(/^type\s+(\w+)\s+interface\b/);
    if (interfaceMatch) {
      pushSymbol(symbols, { name: interfaceMatch[1]!, kind: "interface", line: index + 1 });
    }
  }

  return { language: "go", filePath, symbols, imports, isTestFile, headings: [] };
}

function parseRustFile(body: string, filePath: string): EcosystemFileIndex {
  const symbols: EcosystemSymbol[] = [];
  const imports: string[] = [];
  const isTestFile = filePath.includes("/tests/") || path.basename(filePath) === "lib.rs" && body.includes("#[cfg(test)]");

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    const useMatch = line.match(/^use\s+([^;]+);/);
    if (useMatch) {
      imports.push(useMatch[1]!.trim());
      continue;
    }
    const modMatch = line.match(/^(?:pub\s+)?mod\s+(\w+)/);
    if (modMatch) {
      pushSymbol(symbols, { name: modMatch[1]!, kind: "module", line: index + 1 });
      continue;
    }
    const fnMatch = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (fnMatch) {
      pushSymbol(symbols, { name: fnMatch[1]!, kind: "function", line: index + 1 });
      continue;
    }
    const structMatch = line.match(/^(?:pub\s+)?struct\s+(\w+)/);
    if (structMatch) {
      pushSymbol(symbols, { name: structMatch[1]!, kind: "struct", line: index + 1 });
      continue;
    }
    const enumMatch = line.match(/^(?:pub\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      pushSymbol(symbols, { name: enumMatch[1]!, kind: "enum", line: index + 1 });
      continue;
    }
    const traitMatch = line.match(/^(?:pub\s+)?trait\s+(\w+)/);
    if (traitMatch) {
      pushSymbol(symbols, { name: traitMatch[1]!, kind: "trait", line: index + 1 });
      continue;
    }
    const implMatch = line.match(/^impl(?:<[^>]+>)?\s+(\w+)/);
    if (implMatch) {
      pushSymbol(symbols, { name: implMatch[1]!, kind: "impl", line: index + 1 });
    }
  }

  return { language: "rust", filePath, symbols, imports, isTestFile, headings: [] };
}

function parseTerraformFile(body: string, filePath: string): EcosystemFileIndex {
  const symbols: EcosystemSymbol[] = [];
  const imports: string[] = [];

  const patterns: Array<{ regex: RegExp; kind: string }> = [
    { regex: /\bresource\s+"([^"]+)"\s+"([^"]+)"/g, kind: "resource" },
    { regex: /\bdata\s+"([^"]+)"\s+"([^"]+)"/g, kind: "data" },
    { regex: /\bmodule\s+"([^"]+)"/g, kind: "module" },
    { regex: /\bvariable\s+"([^"]+)"/g, kind: "variable" },
    { regex: /\boutput\s+"([^"]+)"/g, kind: "output" },
  ];

  for (const { regex, kind } of patterns) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      const name = kind === "resource" || kind === "data"
        ? `${match[1]}.${match[2]}`
        : match[1]!;
      pushSymbol(symbols, { name, kind, line: lineNumber(body, match.index) });
      if (kind === "module" && body.slice(match.index).includes("source")) {
        const sourceMatch = body.slice(match.index, match.index + 240).match(/source\s*=\s*"([^"]+)"/);
        if (sourceMatch) imports.push(sourceMatch[1]!);
      }
    }
  }

  return { language: "terraform", filePath, symbols, imports, isTestFile: false, headings: [] };
}

function parseDocumentationFile(body: string, filePath: string): EcosystemFileIndex {
  const headings: string[] = [];
  for (const rawLine of body.split("\n")) {
    const headingMatch = rawLine.match(/^#{1,3}\s+(.+?)\s*$/);
    if (headingMatch) headings.push(headingMatch[1]!.trim());
  }
  return {
    language: "documentation",
    filePath,
    symbols: [],
    imports: [],
    isTestFile: false,
    headings: headings.slice(0, 12),
  };
}

function parseConfigFile(fileName: string, body: string, filePath: string): EcosystemFileIndex | undefined {
  const configMetadata: Record<string, string> = {};
  if (fileName === "go.mod") {
    const moduleMatch = body.match(/^module\s+(\S+)/m);
    if (moduleMatch) configMetadata.module = moduleMatch[1]!;
    const goMatch = body.match(/^go\s+(\S+)/m);
    if (goMatch) configMetadata.goVersion = goMatch[1]!;
    return {
      language: "go",
      filePath,
      symbols: moduleMatch ? [{ name: moduleMatch[1]!, kind: "module", line: 1 }] : [],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata,
    };
  }
  if (fileName === "Cargo.toml") {
    const nameMatch = body.match(/^name\s*=\s*"([^"]+)"/m);
    if (nameMatch) configMetadata.package = nameMatch[1]!;
    const workspaceMembers = [...body.matchAll(/^\s*"([^"]+)",?\s*$/gm)]
      .map((match) => match[1]!)
      .filter((member) => member.includes("/"));
    if (workspaceMembers.length > 0) configMetadata.workspaceMembers = workspaceMembers.join(", ");
    return {
      language: "rust",
      filePath,
      symbols: nameMatch ? [{ name: nameMatch[1]!, kind: "crate", line: 1 }] : [],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata,
    };
  }
  if (fileName === "pyproject.toml") {
    const nameMatch = body.match(/^name\s*=\s*"([^"]+)"/m);
    if (nameMatch) configMetadata.project = nameMatch[1]!;
    return {
      language: "python",
      filePath,
      symbols: nameMatch ? [{ name: nameMatch[1]!, kind: "project", line: 1 }] : [],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata,
    };
  }
  if (fileName === "manage.py") {
    return {
      language: "python",
      filePath,
      symbols: [{ name: "manage", kind: "entrypoint", line: 1 }],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata: { framework: "django" },
    };
  }
  return undefined;
}

export function parseEcosystemFile(input: {
  filePath: string;
  fileName: string;
  extension: string;
  body: string;
}): EcosystemFileIndex | undefined {
  const config = parseConfigFile(input.fileName, input.body, input.filePath);
  if (config) return config;

  const language = ecosystemLanguageForExtension(input.extension);
  if (!language) return undefined;

  switch (language) {
    case "python":
      return parsePythonFile(input.body, input.filePath);
    case "go":
      return parseGoFile(input.body, input.filePath);
    case "rust":
      return parseRustFile(input.body, input.filePath);
    case "terraform":
      return parseTerraformFile(input.body, input.filePath);
    case "documentation":
      return parseDocumentationFile(input.body, input.filePath);
    default:
      return undefined;
  }
}

export function indexEcosystemFile(input: {
  filePath: string;
  fileName: string;
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
}): EcosystemScanContribution {
  const fileIndex = parseEcosystemFile({
    filePath: input.filePath,
    fileName: input.fileName,
    extension: input.extension,
    body: input.body,
  });
  if (!fileIndex) {
    return { symbolNodes: [], edges: [] };
  }

  const symbolNodes: ProductGraphNode[] = [];
  const edges: ProductGraphEdge[] = [];
  const fileNodeId = input.stableId("code-scan:file", input.filePath);
  const fileMetadata: Record<string, ProductMetadataValue> = {
    scannerEcosystemVersion: ECOSYSTEM_SCANNER_VERSION,
    scannerIndexingMode: "t1",
    scannerSemanticSupported: false,
    scannerLanguage: fileIndex.language,
  };

  if (fileIndex.imports.length > 0) {
    fileMetadata.scannerImports = fileIndex.imports.slice(0, 20).join(", ");
  }
  if (fileIndex.isTestFile) fileMetadata.scannerIsTestFile = true;
  if (fileIndex.headings.length > 0) fileMetadata.scannerHeadings = fileIndex.headings.join(" | ");
  if (fileIndex.configMetadata) {
    for (const [key, value] of Object.entries(fileIndex.configMetadata)) {
      fileMetadata[`scannerConfig${key[0]!.toUpperCase()}${key.slice(1)}`] = value;
    }
  }

  for (const symbol of fileIndex.symbols) {
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
      tags: ["code", "code-scan", fileIndex.language, "ecosystem-t1"],
      source: input.sourceRef(input.filePath, symbol.line),
      metadata: input.compactMetadata({
        scannerEcosystemVersion: ECOSYSTEM_SCANNER_VERSION,
        scanId: input.scanId,
        scannedAt: input.scannedAt,
        scannerSourceFile: input.filePath,
        scannerSymbolKind: symbol.kind,
        scannerSymbolName: symbol.name,
        scannerSymbolParentType: symbol.parentType,
        scannerLanguage: fileIndex.language,
        scannerIndexingMode: "t1",
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
    edges.push({
      id: input.stableId("code-scan:edge", `${fileNodeId}->${symbolNodeId}|declares`),
      kind: "belongs_to",
      sourceNodeId: symbolNodeId,
      targetNodeId: fileNodeId,
      label: "declares".slice(0, input.maxEdgeLabelLength),
      trust: "extracted",
      metadata: input.compactMetadata({
        scannerRelation: "declares",
        scannerLanguage: fileIndex.language,
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
  }

  for (const importPath of fileIndex.imports.slice(0, 12)) {
    edges.push({
      id: input.stableId("code-scan:edge", `${fileNodeId}|import|${importPath}`),
      kind: "depends_on",
      sourceNodeId: fileNodeId,
      targetNodeId: input.stableId("code-scan:external", `${fileIndex.language}|${importPath}`),
      label: importPath.slice(0, input.maxEdgeLabelLength),
      trust: "extracted",
      metadata: input.compactMetadata({
        scannerRelation: "import",
        scannerLanguage: fileIndex.language,
        scannerImportPath: importPath,
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
  }

  return { symbolNodes, edges, fileMetadata };
}

export function augmentEcosystemWorkspaceGraph(input: {
  scanId: string;
  scannedAt: string;
  files: Array<{ relativePath: string; body: string }>;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxEdgeLabelLength: number;
}) {
  const edges: ProductGraphEdge[] = [];
  const terraformModules = new Map<string, string>();

  for (const file of input.files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".tf") continue;
    const index = parseTerraformFile(file.body, file.relativePath);
    const sourceNodeId = input.fileNodeIdsByPath.get(file.relativePath);
    if (!sourceNodeId) continue;

    for (const symbol of index.symbols) {
      if (symbol.kind !== "module") continue;
      const sourceMatch = file.body.match(new RegExp(`module\\s+"${symbol.name}"[\\s\\S]{0,240}?source\\s*=\\s*"([^"]+)"`));
      if (!sourceMatch) continue;
      const modulePath = sourceMatch[1]!.replace(/^\.\//, "");
      terraformModules.set(symbol.name, modulePath);
      const moduleCandidates = [
        modulePath,
        path.posix.join(path.posix.dirname(file.relativePath), modulePath),
        path.posix.join(modulePath, "main.tf"),
        path.posix.join(path.posix.dirname(file.relativePath), modulePath, "main.tf"),
      ];
      const targetNodeId = moduleCandidates
        .map((candidate) => input.fileNodeIdsByPath.get(candidate))
        .find((nodeId): nodeId is string => Boolean(nodeId));
      if (!targetNodeId) continue;
      edges.push({
        id: input.stableId("code-scan:edge", `${sourceNodeId}|module|${targetNodeId}`),
        kind: "depends_on",
        sourceNodeId,
        targetNodeId,
        label: `module ${symbol.name}`.slice(0, input.maxEdgeLabelLength),
        trust: "extracted",
        metadata: input.compactMetadata({
          scannerRelation: "terraform_module",
          scannerModuleName: symbol.name,
          scannerModuleSource: modulePath,
        }),
        createdAt: input.scannedAt,
        updatedAt: input.scannedAt,
      });
    }
  }

  return { edges, terraformModules };
}