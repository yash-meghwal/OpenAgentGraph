import path from "path";
import type {
  ProductGraphEdge,
  ProductGraphNode,
  ProductMetadataValue,
} from "@openagentgraph/shared";

export const SCRIPT_SCANNER_VERSION = "1.0";

export type ScriptRelation =
  | "calls"
  | "dot_sources"
  | "imports_module"
  | "exports_function"
  | "runs_command";

export interface ScriptSymbolDraft {
  kind: "function" | "script_entrypoint";
  name: string;
  line: number;
  exported?: boolean;
}

export interface ScriptEdgeDraft {
  relation: ScriptRelation;
  target: string;
  line: number;
  sourceSymbol?: string;
}

export interface ScriptEnvVarDraft {
  name: string;
  line: number;
}

export interface ScriptFileIndex {
  language: "powershell" | "shell";
  filePath: string;
  symbols: ScriptSymbolDraft[];
  edges: ScriptEdgeDraft[];
  envVars: ScriptEnvVarDraft[];
  paramNames: string[];
}

const SHELL_COMMAND_PREFIXES = [
  "dotnet",
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "docker",
  "make",
  "cmake",
  "msbuild",
  "pwsh",
  "powershell",
  "node",
  "python",
  "go",
  "cargo",
] as const;

function normalizeScriptPath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function stripScriptComment(line: string) {
  const hashIndex = line.indexOf("#");
  if (hashIndex < 0) return line;
  return line.slice(0, hashIndex);
}

function parsePowerShellParamNames(block: string) {
  const names: string[] = [];
  for (const match of block.matchAll(/\[?[A-Za-z]+\]?\$(\w+)/g)) {
    names.push(match[1]!);
  }
  return [...new Set(names)];
}

function extractPowerShellDotSourceTarget(line: string) {
  const patterns = [
    /^\s*\.\s+"\$PSScriptRoot\\([^"]+)"/,
    /^\s*\.\s+'\$PSScriptRoot\\([^']+)'/,
    /^\s*\.\s+\$PSScriptRoot\\(\S+)/,
    /^\s*\.\s+"([^"]+\.ps1)"/,
    /^\s*\.\s+'([^']+\.ps1)'/,
    /^\s*\.\s+(\.?\.?[\\/][^\s#;]+\.ps1)/,
    /^\s*\.\s+([A-Za-z][\w-]*\.ps1)/,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].replace(/\\/g, "/");
  }
  return undefined;
}

function extractPowerShellAmpCallTarget(line: string) {
  const patterns = [
    /^\s*&\s+"\$PSScriptRoot\\([^"]+)"/,
    /^\s*&\s+'\$PSScriptRoot\\([^']+)'/,
    /^\s*&\s+\$PSScriptRoot\\(\S+)/,
    /^\s*&\s+"([^"]+\.ps1)"/,
    /^\s*&\s+'([^']+\.ps1)'/,
    /^\s*&\s+(\.?\.?[\\/][^\s#;]+\.ps1)/,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].replace(/\\/g, "/");
  }
  return undefined;
}

function extractShellSourceTarget(line: string) {
  const match = line.match(/^\s*(?:source|\.)\s+["']?([^"'\s#;]+)["']?/);
  return match?.[1]?.replace(/\\/g, "/");
}

function extractShellCommand(line: string) {
  const trimmed = line.trim();
  for (const prefix of SHELL_COMMAND_PREFIXES) {
    if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) {
      return trimmed.split(/\s+/).slice(0, 2).join(" ");
    }
  }
  return undefined;
}

function extractPowerShellCommand(line: string) {
  const trimmed = line.trim();
  const invokeMatch = trimmed.match(/\b(Invoke-[A-Za-z][\w-]*)\b/);
  if (invokeMatch) return invokeMatch[1]!;
  return extractShellCommand(trimmed);
}

function resolveScriptRelativePath(sourceFilePath: string, target: string) {
  const normalizedSource = normalizeScriptPath(sourceFilePath);
  const normalizedTarget = target.replace(/\\/g, "/");
  if (normalizedTarget.startsWith("$PSScriptRoot/")) {
    const relative = normalizedTarget.slice("$PSScriptRoot/".length);
    return normalizeScriptPath(path.posix.join(path.posix.dirname(normalizedSource), relative));
  }
  if (normalizedTarget.startsWith("./") || normalizedTarget.startsWith("../")) {
    return normalizeScriptPath(path.posix.join(path.posix.dirname(normalizedSource), normalizedTarget));
  }
  if (normalizedTarget.includes("/")) {
    return normalizeScriptPath(normalizedTarget);
  }
  return normalizeScriptPath(path.posix.join(path.posix.dirname(normalizedSource), normalizedTarget));
}

function resolveScriptFileCandidates(sourceFilePath: string, target: string) {
  const resolved = resolveScriptRelativePath(sourceFilePath, target);
  const baseName = path.posix.basename(resolved);
  const dirName = path.posix.dirname(sourceFilePath);
  const candidates = new Set<string>([
    resolved,
    resolved.endsWith(".ps1") || resolved.endsWith(".sh") || resolved.endsWith(".bash")
      ? resolved
      : `${resolved}.ps1`,
    resolved.endsWith(".ps1") || resolved.endsWith(".sh") || resolved.endsWith(".bash")
      ? resolved
      : `${resolved}.sh`,
  ]);
  if (!target.includes("/") && !target.includes("\\")) {
    candidates.add(normalizeScriptPath(path.posix.join(dirName, baseName)));
    candidates.add(normalizeScriptPath(path.posix.join(dirName, `${baseName}.ps1`)));
    candidates.add(normalizeScriptPath(path.posix.join(dirName, `${baseName}.sh`)));
  }
  return [...candidates];
}

export function parsePowerShellFile(body: string, filePath: string): ScriptFileIndex {
  const symbols: ScriptSymbolDraft[] = [];
  const edges: ScriptEdgeDraft[] = [];
  const envVars: ScriptEnvVarDraft[] = [];
  const paramNames: string[] = [];
  let currentFunction: string | undefined;
  let sawTopLevelActivity = false;

  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!;
    const line = stripScriptComment(rawLine).trimEnd();
    if (!line.trim()) continue;

    if (/^param\s*\(/i.test(line.trim())) {
      const paramBlock = [line];
      while (index + 1 < lines.length && !paramBlock.join("\n").includes(")")) {
        index += 1;
        paramBlock.push(lines[index]!);
      }
      paramNames.push(...parsePowerShellParamNames(paramBlock.join("\n")));
      continue;
    }

    const functionMatch = line.match(/^\s*function\s+([A-Za-z][\w-]*)\s*(?:\([^)]*\))?\s*\{/);
    if (functionMatch) {
      currentFunction = functionMatch[1]!;
      symbols.push({ kind: "function", name: currentFunction, line: index + 1 });
      const openBraceIndex = line.indexOf("{");
      const closeBraceIndex = line.lastIndexOf("}");
      if (closeBraceIndex > openBraceIndex) {
        const inlineBody = line.slice(openBraceIndex + 1, closeBraceIndex).trim();
        if (inlineBody) {
          const command = extractPowerShellCommand(inlineBody);
          if (command) {
            sawTopLevelActivity = true;
            edges.push({
              relation: "runs_command",
              target: command,
              line: index + 1,
              sourceSymbol: currentFunction,
            });
          }
        }
        currentFunction = undefined;
      }
      continue;
    }

    if (/^\s*\}\s*$/.test(line)) {
      currentFunction = undefined;
      continue;
    }

    const exportMatch = line.match(/Export-ModuleMember\s+-Function\s+([A-Za-z][\w-]*)/i);
    if (exportMatch) {
      const exportedName = exportMatch[1]!;
      const symbol = symbols.find((entry) => entry.name === exportedName);
      if (symbol) symbol.exported = true;
      edges.push({
        relation: "exports_function",
        target: exportedName,
        line: index + 1,
        sourceSymbol: exportedName,
      });
    }

    const dotSourceTarget = extractPowerShellDotSourceTarget(line);
    if (dotSourceTarget) {
      sawTopLevelActivity = true;
      edges.push({
        relation: "dot_sources",
        target: dotSourceTarget,
        line: index + 1,
        sourceSymbol: currentFunction,
      });
      continue;
    }

    const ampCallTarget = extractPowerShellAmpCallTarget(line);
    if (ampCallTarget) {
      sawTopLevelActivity = true;
      edges.push({
        relation: "calls",
        target: ampCallTarget,
        line: index + 1,
        sourceSymbol: currentFunction,
      });
      continue;
    }

    const importModuleMatch = line.match(/^\s*Import-Module\s+(?:-Name\s+)?([A-Za-z][\w.-]*)/i);
    if (importModuleMatch) {
      sawTopLevelActivity = true;
      edges.push({
        relation: "imports_module",
        target: importModuleMatch[1]!,
        line: index + 1,
        sourceSymbol: currentFunction,
      });
    }

    const command = extractPowerShellCommand(line);
    if (command) {
      sawTopLevelActivity = true;
      edges.push({
        relation: "runs_command",
        target: command,
        line: index + 1,
        sourceSymbol: currentFunction,
      });
    }

    const envMatch = line.match(/^\s*\$env:([A-Z_][A-Z0-9_]*)\s*=/i);
    if (envMatch) {
      envVars.push({ name: envMatch[1]!.toUpperCase(), line: index + 1 });
    }
  }

  if (symbols.length === 0 && sawTopLevelActivity) {
    const entryName = path.posix.basename(filePath, path.extname(filePath));
    symbols.push({ kind: "script_entrypoint", name: entryName, line: 1 });
  }

  return {
    language: "powershell",
    filePath,
    symbols,
    edges,
    envVars,
    paramNames,
  };
}

export function parseShellFile(body: string, filePath: string): ScriptFileIndex {
  const symbols: ScriptSymbolDraft[] = [];
  const edges: ScriptEdgeDraft[] = [];
  const envVars: ScriptEnvVarDraft[] = [];
  let currentFunction: string | undefined;
  let sawTopLevelActivity = false;

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = stripScriptComment(rawLine).trimEnd();
    if (!line.trim()) continue;

    const functionMatch = line.match(/^(?:function\s+)?([a-zA-Z_][\w]*)\s*\(\)\s*\{/);
    if (functionMatch) {
      currentFunction = functionMatch[1]!;
      symbols.push({ kind: "function", name: currentFunction, line: index + 1 });
      const openBraceIndex = line.indexOf("{");
      const closeBraceIndex = line.lastIndexOf("}");
      if (closeBraceIndex > openBraceIndex) {
        const inlineBody = line.slice(openBraceIndex + 1, closeBraceIndex).trim();
        if (inlineBody) {
          const command = extractShellCommand(inlineBody);
          if (command) {
            sawTopLevelActivity = true;
            edges.push({
              relation: "runs_command",
              target: command,
              line: index + 1,
              sourceSymbol: currentFunction,
            });
          }
        }
        currentFunction = undefined;
      }
      continue;
    }

    if (/^\s*\}\s*$/.test(line)) {
      currentFunction = undefined;
      continue;
    }

    const sourceTarget = extractShellSourceTarget(line);
    if (sourceTarget) {
      sawTopLevelActivity = true;
      edges.push({
        relation: "dot_sources",
        target: sourceTarget,
        line: index + 1,
        sourceSymbol: currentFunction,
      });
      continue;
    }

    const envMatch = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
    if (envMatch) {
      envVars.push({ name: envMatch[1]!, line: index + 1 });
      sawTopLevelActivity = true;
      continue;
    }

    const command = extractShellCommand(line);
    if (command) {
      sawTopLevelActivity = true;
      edges.push({
        relation: "runs_command",
        target: command,
        line: index + 1,
        sourceSymbol: currentFunction,
      });
    }
  }

  if (symbols.length === 0 && sawTopLevelActivity) {
    const entryName = path.posix.basename(filePath, path.extname(filePath));
    symbols.push({ kind: "script_entrypoint", name: entryName, line: 1 });
  }

  return {
    language: "shell",
    filePath,
    symbols,
    edges,
    envVars,
    paramNames: [],
  };
}

export function parseScriptFile(body: string, filePath: string): ScriptFileIndex | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".ps1") return parsePowerShellFile(body, filePath);
  if (extension === ".sh" || extension === ".bash") return parseShellFile(body, filePath);
  return undefined;
}

function scriptSymbolNodeId(
  filePath: string,
  symbol: ScriptSymbolDraft,
  stableId: (prefix: string, raw: string) => string
) {
  return stableId("code-scan:symbol", `${filePath}|script|${symbol.kind}|${symbol.name}`);
}

function scriptSourceNodeId(input: {
  filePath: string;
  parsed: ScriptFileIndex;
  sourceSymbol?: string;
  fileNodeId: string;
  stableId: (prefix: string, raw: string) => string;
}) {
  if (!input.sourceSymbol) return input.fileNodeId;
  const symbol = input.parsed.symbols.find((entry) => entry.name === input.sourceSymbol);
  if (!symbol) return input.fileNodeId;
  return scriptSymbolNodeId(input.filePath, symbol, input.stableId);
}

function createScriptCommandNode(input: {
  command: string;
  language: ScriptFileIndex["language"];
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxTitleLength: number;
}): ProductGraphNode {
  const nodeId = input.stableId("code-scan:external", `${input.language}|command|${input.command}`);
  return {
    id: nodeId,
    kind: "code_symbol",
    title: `${input.command} (command)`.slice(0, input.maxTitleLength),
    status: "planned",
    tags: ["code", "code-scan", "script-t1", "external-command"],
    metadata: input.compactMetadata({
      scannerScriptVersion: SCRIPT_SCANNER_VERSION,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerRelation: "runs_command",
      scannerLanguage: input.language,
      scannerIndexingMode: "t1",
      scannerCommandName: input.command,
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

function createScriptModuleNode(input: {
  moduleName: string;
  language: ScriptFileIndex["language"];
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxTitleLength: number;
}): ProductGraphNode {
  const nodeId = input.stableId("code-scan:external", `${input.language}|module|${input.moduleName}`);
  return {
    id: nodeId,
    kind: "code_symbol",
    title: `${input.moduleName} (module)`.slice(0, input.maxTitleLength),
    status: "planned",
    tags: ["code", "code-scan", "script-t1", "external-module"],
    metadata: input.compactMetadata({
      scannerScriptVersion: SCRIPT_SCANNER_VERSION,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerRelation: "imports_module",
      scannerLanguage: input.language,
      scannerIndexingMode: "t1",
      scannerModuleName: input.moduleName,
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

function findScriptFileNodeId(
  sourceFilePath: string,
  target: string,
  fileNodeIdsByPath: Map<string, string>
) {
  for (const candidate of resolveScriptFileCandidates(sourceFilePath, target)) {
    const nodeId = fileNodeIdsByPath.get(candidate);
    if (nodeId) return { nodeId, resolvedPath: candidate };
  }
  return undefined;
}

export function indexScriptFile(input: {
  filePath: string;
  body: string;
  fileNodeId: string;
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  sourceRef: (projectPath: string, line?: number) => ProductGraphNode["source"];
  maxTitleLength: number;
  maxEdgeLabelLength: number;
}): {
  symbolNodes: ProductGraphNode[];
  edges: ProductGraphEdge[];
  fileMetadata: Record<string, ProductMetadataValue>;
} {
  const parsed = parseScriptFile(input.body, input.filePath);
  if (!parsed) {
    return { symbolNodes: [], edges: [], fileMetadata: {} };
  }

  const symbolNodes: ProductGraphNode[] = [];
  const edges: ProductGraphEdge[] = [];

  for (const symbol of parsed.symbols) {
    const symbolNodeId = scriptSymbolNodeId(input.filePath, symbol, input.stableId);
    const title = symbol.kind === "script_entrypoint"
      ? `${symbol.name} (script_entrypoint)`
      : `${symbol.name} (function)`;
    symbolNodes.push({
      id: symbolNodeId,
      kind: "code_symbol",
      title: title.slice(0, input.maxTitleLength),
      status: "planned",
      tags: ["code", "code-scan", "script-t1", parsed.language],
      source: input.sourceRef(input.filePath, symbol.line),
      metadata: input.compactMetadata({
        scannerScriptVersion: SCRIPT_SCANNER_VERSION,
        scanId: input.scanId,
        scannedAt: input.scannedAt,
        scannerSourceFile: input.filePath,
        scannerSymbolKind: symbol.kind,
        scannerSymbolName: symbol.name,
        scannerLanguage: parsed.language,
        scannerIndexingMode: "t1",
        ...(symbol.exported ? { scannerScriptExported: true } : {}),
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
    edges.push({
      id: input.stableId("code-scan:edge", `${symbolNodeId}->${input.fileNodeId}|declares`),
      kind: "belongs_to",
      sourceNodeId: symbolNodeId,
      targetNodeId: input.fileNodeId,
      label: "declares".slice(0, input.maxEdgeLabelLength),
      trust: "extracted",
      metadata: input.compactMetadata({
        scannerRelation: symbol.kind === "script_entrypoint" ? "script_entrypoint" : "declares",
        scannerLanguage: parsed.language,
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
  }

  for (const edgeDraft of parsed.edges) {
    if (edgeDraft.relation !== "exports_function") continue;
    const sourceNodeId = scriptSourceNodeId({
      filePath: input.filePath,
      parsed,
      sourceSymbol: edgeDraft.sourceSymbol,
      fileNodeId: input.fileNodeId,
      stableId: input.stableId,
    });
    const targetSymbol = parsed.symbols.find((symbol) => symbol.name === edgeDraft.target);
    if (!targetSymbol) continue;
    const targetNodeId = scriptSymbolNodeId(input.filePath, targetSymbol, input.stableId);
    edges.push({
      id: input.stableId("code-scan:edge", `${sourceNodeId}|exports_function|${targetNodeId}`),
      kind: "uses",
      sourceNodeId,
      targetNodeId,
      label: edgeDraft.target.slice(0, input.maxEdgeLabelLength),
      trust: "extracted",
      metadata: input.compactMetadata({
        scannerRelation: "exports_function",
        scannerLanguage: parsed.language,
        scannerScriptTarget: edgeDraft.target,
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
  }

  const fileMetadata: Record<string, ProductMetadataValue> = {
    scannerScriptVersion: SCRIPT_SCANNER_VERSION,
    scannerLanguage: parsed.language,
    scannerIndexingMode: "t1",
    scannerSemanticSupported: false,
    scannerScriptFunctionCount: parsed.symbols.filter((symbol) => symbol.kind === "function").length,
    scannerScriptEdgeCount: parsed.edges.length,
  };
  if (parsed.paramNames.length > 0) {
    fileMetadata.scannerScriptParams = parsed.paramNames.join(", ");
  }
  if (parsed.envVars.length > 0) {
    fileMetadata.scannerScriptEnvVars = parsed.envVars.map((entry) => entry.name).join(", ");
  }
  if (parsed.symbols.some((symbol) => symbol.kind === "script_entrypoint")) {
    fileMetadata.scannerScriptEntrypoint = true;
  }

  return { symbolNodes, edges, fileMetadata };
}

export function augmentScriptWorkspaceGraph(input: {
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
  diagnostics: string[];
} {
  const edges: ProductGraphEdge[] = [];
  const externalNodes = new Map<string, ProductGraphNode>();
  const diagnostics: string[] = [];
  const parsedByPath = new Map<string, ScriptFileIndex>();
  const functionNodeIdsByKey = new Map<string, string>();

  for (const file of input.files) {
    const parsed = parseScriptFile(file.body, file.relativePath);
    if (!parsed) continue;
    parsedByPath.set(normalizeScriptPath(file.relativePath), parsed);
    for (const symbol of parsed.symbols) {
      functionNodeIdsByKey.set(
        `${normalizeScriptPath(file.relativePath)}|${symbol.name}`,
        scriptSymbolNodeId(file.relativePath, symbol, input.stableId)
      );
    }
  }

  for (const file of input.files) {
    const normalizedPath = normalizeScriptPath(file.relativePath);
    const parsed = parsedByPath.get(normalizedPath);
    const fileNodeId = input.fileNodeIdsByPath.get(normalizedPath)
      ?? input.fileNodeIdsByPath.get(file.relativePath);
    if (!parsed || !fileNodeId) continue;

    for (const edgeDraft of parsed.edges) {
      const sourceNodeId = scriptSourceNodeId({
        filePath: file.relativePath,
        parsed,
        sourceSymbol: edgeDraft.sourceSymbol,
        fileNodeId,
        stableId: input.stableId,
      });

      if (edgeDraft.relation === "exports_function") continue;

      if (edgeDraft.relation === "dot_sources" || edgeDraft.relation === "calls") {
        const resolved = findScriptFileNodeId(file.relativePath, edgeDraft.target, input.fileNodeIdsByPath);
        if (!resolved) {
          diagnostics.push(`Unresolved script ${edgeDraft.relation} in ${file.relativePath}: ${edgeDraft.target}`);
          continue;
        }
        const targetParsed = parsedByPath.get(resolved.resolvedPath);
        const targetNodeId = targetParsed?.symbols.find((symbol) =>
          symbol.kind === "script_entrypoint" || symbol.kind === "function"
        )
          ? functionNodeIdsByKey.get(`${resolved.resolvedPath}|${targetParsed!.symbols[0]!.name}`)
            ?? resolved.nodeId
          : resolved.nodeId;
        edges.push({
          id: input.stableId(
            "code-scan:edge",
            `${sourceNodeId}|${edgeDraft.relation}|${resolved.resolvedPath}|${edgeDraft.line}`
          ),
          kind: "uses",
          sourceNodeId,
          targetNodeId,
          label: edgeDraft.target.slice(0, input.maxEdgeLabelLength),
          trust: "extracted",
          metadata: input.compactMetadata({
            scannerRelation: edgeDraft.relation,
            scannerLanguage: parsed.language,
            scannerScriptTarget: edgeDraft.target,
            scannerScriptTargetPath: resolved.resolvedPath,
            scannerResolution: "file",
          }),
          createdAt: input.scannedAt,
          updatedAt: input.scannedAt,
        });
        continue;
      }

      if (edgeDraft.relation === "imports_module") {
        const moduleNode = createScriptModuleNode({
          moduleName: edgeDraft.target,
          language: parsed.language,
          scanId: input.scanId,
          scannedAt: input.scannedAt,
          stableId: input.stableId,
          compactMetadata: input.compactMetadata,
          maxTitleLength: input.maxTitleLength,
        });
        externalNodes.set(moduleNode.id, moduleNode);
        edges.push({
          id: input.stableId("code-scan:edge", `${sourceNodeId}|imports_module|${edgeDraft.target}`),
          kind: "depends_on",
          sourceNodeId,
          targetNodeId: moduleNode.id,
          label: edgeDraft.target.slice(0, input.maxEdgeLabelLength),
          trust: "extracted",
          metadata: input.compactMetadata({
            scannerRelation: "imports_module",
            scannerLanguage: parsed.language,
            scannerModuleName: edgeDraft.target,
            scannerResolution: "external",
          }),
          createdAt: input.scannedAt,
          updatedAt: input.scannedAt,
        });
        continue;
      }

      if (edgeDraft.relation === "runs_command") {
        const commandNode = createScriptCommandNode({
          command: edgeDraft.target,
          language: parsed.language,
          scanId: input.scanId,
          scannedAt: input.scannedAt,
          stableId: input.stableId,
          compactMetadata: input.compactMetadata,
          maxTitleLength: input.maxTitleLength,
        });
        externalNodes.set(commandNode.id, commandNode);
        edges.push({
          id: input.stableId("code-scan:edge", `${sourceNodeId}|runs_command|${edgeDraft.target}|${edgeDraft.line}`),
          kind: "uses",
          sourceNodeId,
          targetNodeId: commandNode.id,
          label: edgeDraft.target.slice(0, input.maxEdgeLabelLength),
          trust: "extracted",
          metadata: input.compactMetadata({
            scannerRelation: "runs_command",
            scannerLanguage: parsed.language,
            scannerCommandName: edgeDraft.target,
            scannerResolution: "external",
          }),
          createdAt: input.scannedAt,
          updatedAt: input.scannedAt,
        });
      }
    }
  }

  return {
    edges,
    externalNodes: [...externalNodes.values()],
    diagnostics,
  };
}

export function scriptMetadataContainsSecretValues(metadata: Record<string, ProductMetadataValue | undefined>) {
  const serialized = JSON.stringify(metadata);
  return /(?:API_KEY|SECRET|PASSWORD|TOKEN)\s*[:=]\s*[^\s,;]+/i.test(serialized)
    || /\b(?:sk|pk|rk)_[A-Za-z0-9]{10,}\b/.test(serialized);
}