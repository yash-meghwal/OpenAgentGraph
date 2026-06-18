import path from "path";
import type { ProductGraphEdge, ProductGraphNode, ProductMetadataValue } from "@openagentgraph/shared";
import { parseCppFile } from "./cppParsing.js";
import { parseCMakeLists, parseCompileCommands } from "./cppProjectParsing.js";
import { parseDartFile } from "./dartParsing.js";
import { parsePubspecYaml } from "./dartProjectParsing.js";
import { parseGradleSettingsIncludes } from "./gradleProjectParsing.js";
import { parseGdScript, parseGodotSceneAsset, parseUnityAsset } from "./godotParsing.js";
import {
  parseAsmdef,
  parseGodotProject,
  parseUnrealProject,
} from "./gameEngineProjectParsing.js";

export const ECOSYSTEM_SCANNER_VERSION = "1.1";

export const PYTHON_SCANNABLE_EXTENSIONS = [".py"] as const;
export const GO_SCANNABLE_EXTENSIONS = [".go"] as const;
export const RUST_SCANNABLE_EXTENSIONS = [".rs"] as const;
export const JAVA_SCANNABLE_EXTENSIONS = [".java"] as const;
export const KOTLIN_SCANNABLE_EXTENSIONS = [".kt", ".kts"] as const;
export const RUBY_SCANNABLE_EXTENSIONS = [".rb", ".rake"] as const;
export const PHP_SCANNABLE_EXTENSIONS = [".php", ".phtml"] as const;
export const SWIFT_SCANNABLE_EXTENSIONS = [".swift"] as const;
export const DART_SCANNABLE_EXTENSIONS = [".dart"] as const;
export const CPP_SCANNABLE_EXTENSIONS = [".c", ".cc", ".cpp", ".h", ".hpp"] as const;
export const GODOT_SCANNABLE_EXTENSIONS = [".gd", ".tscn", ".tres"] as const;
export const UNITY_ASSET_EXTENSIONS = [".unity", ".prefab"] as const;
export const TERRAFORM_SCANNABLE_EXTENSIONS = [".tf", ".tfvars"] as const;
export const DOC_SCANNABLE_EXTENSIONS = [".md", ".rst"] as const;

export const ECOSYSTEM_CONFIG_FILE_NAMES = new Set([
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
  "manage.py",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "Gemfile",
  "Rakefile",
  "composer.json",
  "Package.swift",
  "pubspec.yaml",
  "CMakeLists.txt",
  "Makefile",
  "meson.build",
  "compile_commands.json",
  "project.godot",
]);

const MAX_SYMBOLS_PER_FILE = 120;

export type EcosystemLanguage =
  | "python"
  | "go"
  | "rust"
  | "java"
  | "kotlin"
  | "ruby"
  | "php"
  | "swift"
  | "dart"
  | "cpp"
  | "godot"
  | "unity"
  | "terraform"
  | "documentation";

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
  if ((JAVA_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "java";
  if ((KOTLIN_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "kotlin";
  if ((RUBY_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "ruby";
  if ((PHP_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "php";
  if ((SWIFT_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "swift";
  if ((DART_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "dart";
  if ((CPP_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "cpp";
  if ((GODOT_SCANNABLE_EXTENSIONS as readonly string[]).includes(normalized)) return "godot";
  if ((UNITY_ASSET_EXTENSIONS as readonly string[]).includes(normalized)) return "unity";
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

function isJavaTestFile(filePath: string) {
  const baseName = path.basename(filePath);
  return /(?:^|\/)tests?\//i.test(filePath) || /Test\.java$/i.test(baseName);
}

function isKotlinTestFile(filePath: string) {
  const baseName = path.basename(filePath);
  return /(?:^|\/)tests?\//i.test(filePath) || /Test\.kt$/i.test(baseName);
}

function parseJavaFile(body: string, filePath: string): EcosystemFileIndex {
  const symbols: EcosystemSymbol[] = [];
  const imports: string[] = [];
  let currentType: string | undefined;
  let typeBraceDepth = -1;
  let braceDepth = 0;

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;

    const openBraces = (line.match(/\{/g) ?? []).length;
    const closeBraces = (line.match(/\}/g) ?? []).length;
    if (currentType !== undefined && braceDepth <= typeBraceDepth && !line.includes("{")) {
      currentType = undefined;
      typeBraceDepth = -1;
    }
    braceDepth += openBraces - closeBraces;

    const packageMatch = line.match(/^package\s+([\w.]+)\s*;/);
    if (packageMatch) {
      pushSymbol(symbols, { name: packageMatch[1]!, kind: "package", line: index + 1 });
      continue;
    }
    const importMatch = line.match(/^import\s+(?:static\s+)?([\w.*]+)\s*;/);
    if (importMatch) {
      imports.push(importMatch[1]!);
      continue;
    }
    const classMatch = line.match(
      /^(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+|sealed\s+)*class\s+(\w+)(?:\s+extends\s+([\w.]+))?(?:\s+implements\s+([\w.,\s]+))?/
    );
    if (classMatch) {
      currentType = classMatch[1];
      typeBraceDepth = braceDepth;
      pushSymbol(symbols, { name: currentType, kind: "class", line: index + 1 });
      if (classMatch[2]) imports.push(`extends:${classMatch[2]}`);
      if (classMatch[3]) {
        for (const iface of classMatch[3].split(",")) {
          const trimmed = iface.trim();
          if (trimmed) imports.push(`implements:${trimmed}`);
        }
      }
      continue;
    }
    const interfaceMatch = line.match(/^(?:public\s+)?interface\s+(\w+)/);
    if (interfaceMatch) {
      currentType = interfaceMatch[1];
      typeBraceDepth = braceDepth;
      pushSymbol(symbols, { name: currentType, kind: "interface", line: index + 1 });
      continue;
    }
    const enumMatch = line.match(/^(?:public\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      currentType = enumMatch[1];
      typeBraceDepth = braceDepth;
      pushSymbol(symbols, { name: currentType, kind: "enum", line: index + 1 });
      continue;
    }
    const recordMatch = line.match(/^(?:public\s+)?record\s+(\w+)/);
    if (recordMatch) {
      currentType = recordMatch[1];
      typeBraceDepth = braceDepth;
      pushSymbol(symbols, { name: currentType, kind: "record", line: index + 1 });
      continue;
    }
    const methodMatch = line.match(
      /^(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:<[^>]+>\s+)?[\w.<>,\[\]]+\s+(\w+)\s*\([^;]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{?\s*$/
    );
    if (methodMatch) {
      pushSymbol(symbols, {
        name: methodMatch[1]!,
        kind: "method",
        line: index + 1,
        parentType: currentType,
      });
    }
  }

  return {
    language: "java",
    filePath,
    symbols,
    imports,
    isTestFile: isJavaTestFile(filePath),
    headings: [],
  };
}

function parseKotlinFile(body: string, filePath: string): EcosystemFileIndex {
  const symbols: EcosystemSymbol[] = [];
  const imports: string[] = [];
  let currentType: string | undefined;

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;

    if (line === "}") {
      currentType = undefined;
      continue;
    }

    const packageMatch = line.match(/^package\s+([\w.]+)/);
    if (packageMatch) {
      pushSymbol(symbols, { name: packageMatch[1]!, kind: "package", line: index + 1 });
      continue;
    }
    const importMatch = line.match(/^import\s+([\w.*]+)/);
    if (importMatch) {
      imports.push(importMatch[1]!);
      continue;
    }
    const kotlinClassMatch = line.match(
      /^(?:public\s+|private\s+|internal\s+)?(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)(?:\s*\([^)]*\))?\s*(?::\s*([^{]+))?/
    );
    if (kotlinClassMatch) {
      currentType = kotlinClassMatch[1];
      pushSymbol(symbols, { name: currentType, kind: "class", line: index + 1 });
      const parents = kotlinClassMatch[2]?.split(",") ?? [];
      if (parents.length > 0) {
        const superType = parents[0]?.trim();
        if (superType) imports.push(`extends:${superType}`);
        for (const iface of parents.slice(1)) {
          const trimmed = iface.trim();
          if (trimmed) imports.push(`implements:${trimmed}`);
        }
      }
      continue;
    }

    const typePatterns: Array<{ regex: RegExp; kind: string }> = [
      { regex: /^(?:public\s+|private\s+|internal\s+)?(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)/, kind: "class" },
      { regex: /^(?:public\s+|private\s+|internal\s+)?interface\s+(\w+)/, kind: "interface" },
      { regex: /^(?:public\s+|private\s+|internal\s+)?enum\s+class\s+(\w+)/, kind: "enum" },
      { regex: /^(?:public\s+|private\s+|internal\s+)?object\s+(\w+)/, kind: "object" },
    ];
    let matchedType = false;
    for (const pattern of typePatterns) {
      const match = line.match(pattern.regex);
      if (!match) continue;
      currentType = match[1];
      pushSymbol(symbols, { name: currentType, kind: pattern.kind, line: index + 1 });
      matchedType = true;
      break;
    }
    if (matchedType) continue;

    const funMatch = line.match(/^(?:override\s+)?fun\s+(?:[\w.]+\.)?(\w+)\s*\(/);
    if (funMatch) {
      const leadingIndent = rawLine.match(/^(\s*)/)?.[1]?.length ?? 0;
      pushSymbol(symbols, {
        name: funMatch[1]!,
        kind: "function",
        line: index + 1,
        parentType: leadingIndent > 0 ? currentType : undefined,
      });
    }
  }

  return {
    language: "kotlin",
    filePath,
    symbols,
    imports,
    isTestFile: isKotlinTestFile(filePath),
    headings: [],
  };
}

function railsSymbolKind(filePath: string, symbolKind: string) {
  const normalized = filePath.replace(/\\/g, "/");
  if (symbolKind !== "class") return symbolKind;
  if (/(?:^|\/)app\/controllers\//i.test(normalized)) return "rails_controller";
  if (/(?:^|\/)app\/models\//i.test(normalized)) return "rails_model";
  if (/(?:^|\/)app\/jobs\//i.test(normalized)) return "rails_job";
  if (/(?:^|\/)app\/mailers\//i.test(normalized)) return "rails_mailer";
  if (/(?:^|\/)app\/services\//i.test(normalized)) return "rails_service";
  return symbolKind;
}

function isSwiftTestFile(filePath: string) {
  const baseName = path.basename(filePath);
  return /(?:^|\/)Tests?\//i.test(filePath)
    || /Tests\.swift$/i.test(baseName)
    || /Test\.swift$/i.test(baseName);
}

function swiftSymbolKind(baseKind: string, conformsClause?: string) {
  if (baseKind === "struct" && /\bView\b/.test(conformsClause ?? "")) return "swiftui_view";
  return baseKind;
}

function parseSwiftTypeClauseImports(keyword: string, typeClause: string | undefined) {
  if (!typeClause) return [];
  const types = typeClause
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (keyword === "class") {
    const imports: string[] = [];
    if (types[0]) imports.push(`extends:${types[0]}`);
    for (const protocol of types.slice(1)) {
      imports.push(`conforms:${protocol}`);
    }
    return imports;
  }
  return types.map((typeName) => `conforms:${typeName}`);
}

function parseSwiftFile(body: string, filePath: string): EcosystemFileIndex {
  const symbols: EcosystemSymbol[] = [];
  const imports: string[] = [];
  let currentType: string | undefined;
  let currentTypeBraceDepth = -1;
  let braceDepth = 0;
  const isTestFile = isSwiftTestFile(filePath);

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;

    const openBraces = (line.match(/\{/g) ?? []).length;
    const closeBraces = (line.match(/\}/g) ?? []).length;
    if (currentType !== undefined && braceDepth <= currentTypeBraceDepth && !line.includes("{")) {
      currentType = undefined;
      currentTypeBraceDepth = -1;
    }

    const importMatch = line.match(
      /^(?:@\w+\s+)*import\s+(?:(?:class|struct|enum|protocol|let|var|func)\s+)?([\w.]+)/
    );
    if (importMatch) {
      imports.push(importMatch[1]!);
      continue;
    }

    const extensionMatch = line.match(/^extension\s+(\w+)(?:\s*:\s*([^{]+))?/);
    if (extensionMatch) {
      currentType = extensionMatch[1];
      currentTypeBraceDepth = braceDepth;
      pushSymbol(symbols, {
        name: extensionMatch[1]!,
        kind: "extension",
        line: index + 1,
      });
      imports.push(`extends:${extensionMatch[1]!}`);
      for (const clauseImport of parseSwiftTypeClauseImports("extension", extensionMatch[2])) {
        imports.push(clauseImport);
      }
      braceDepth += openBraces - closeBraces;
      continue;
    }

    const typeMatch = line.match(
      /^(?:@\w+\s+)*(?:(?:public|open|internal|fileprivate|private|final)\s+)*(?:class|struct|enum|protocol|actor)\s+(\w+)(?:\s*:\s*([^{]+))?/
    );
    if (typeMatch) {
      const keyword = line.match(/\b(class|struct|enum|protocol|actor)\b/)?.[1] ?? "class";
      const conformsClause = typeMatch[2];
      currentType = typeMatch[1];
      currentTypeBraceDepth = braceDepth;
      pushSymbol(symbols, {
        name: currentType,
        kind: swiftSymbolKind(keyword, conformsClause),
        line: index + 1,
      });
      for (const clauseImport of parseSwiftTypeClauseImports(keyword, conformsClause)) {
        imports.push(clauseImport);
      }
      braceDepth += openBraces - closeBraces;
      continue;
    }

    const funcMatch = line.match(
      /^(?:@\w+\s+)*(?:(?:public|open|internal|fileprivate|private|static)\s+)*func\s+(\w+)/
    );
    if (funcMatch) {
      pushSymbol(symbols, {
        name: funcMatch[1]!,
        kind: "function",
        line: index + 1,
        parentType: currentType,
      });
      braceDepth += openBraces - closeBraces;
      continue;
    }

    const initMatch = line.match(
      /^(?:@\w+\s+)*(?:(?:public|open|internal|fileprivate|private)\s+)*init(?:\(|<)/
    );
    if (initMatch) {
      pushSymbol(symbols, {
        name: "init",
        kind: "initializer",
        line: index + 1,
        parentType: currentType,
      });
    }

    braceDepth += openBraces - closeBraces;
    if (currentType !== undefined && braceDepth <= currentTypeBraceDepth) {
      currentType = undefined;
      currentTypeBraceDepth = -1;
    }
  }

  return { language: "swift", filePath, symbols, imports, isTestFile, headings: [] };
}

function isRubyTestFile(filePath: string) {
  const baseName = path.basename(filePath);
  return /(?:^|\/)(?:spec|test)\//i.test(filePath) || /_spec\.rb$/i.test(baseName) || /_test\.rb$/i.test(baseName);
}

function parseRubyFile(body: string, filePath: string): EcosystemFileIndex {
  const symbols: EcosystemSymbol[] = [];
  const imports: string[] = [];
  const moduleStack: string[] = [];
  const moduleFrameStack: number[] = [];
  let currentClass: string | undefined;
  let currentClassQualified: string | undefined;
  let classDepth = 0;
  let methodDepth = 0;
  const isTestFile = isRubyTestFile(filePath);

  const moduleNamespace = () => moduleStack.join("::");
  const methodOwner = () => {
    if (currentClassQualified) return currentClassQualified;
    return moduleNamespace() || undefined;
  };
  const countInlineEnds = (line: string) => (line.match(/\bend\b/g) ?? []).length;
  const closeModuleFrame = () => {
    const segmentCount = moduleFrameStack.pop();
    if (!segmentCount) return;
    for (let index = 0; index < segmentCount; index += 1) {
      moduleStack.pop();
    }
  };

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const relativeRequire = line.match(/^require_relative\s+['"]([^'"]+)['"]/);
    if (relativeRequire) {
      imports.push(`relative:${relativeRequire[1]!}`);
      continue;
    }
    const requireMatch = line.match(/^require\s+['"]([^'"]+)['"]/);
    if (requireMatch) {
      imports.push(`require:${requireMatch[1]!}`);
      continue;
    }

    const moduleMatch = line.match(/^module\s+([\w:]+)/);
    if (moduleMatch) {
      const segments = moduleMatch[1]!.split("::");
      moduleFrameStack.push(segments.length);
      for (const segment of segments) {
        moduleStack.push(segment);
      }
      pushSymbol(symbols, {
        name: segments[segments.length - 1]!,
        kind: "module",
        line: index + 1,
        parentType: moduleStack.length > 1 ? moduleStack.slice(0, -1).join("::") : undefined,
      });
      continue;
    }

    const classMatch = line.match(/^class\s+([\w:]+)(?:\s*<\s*([\w:]+))?/);
    if (classMatch) {
      const classSegments = classMatch[1]!.split("::");
      currentClass = classSegments[classSegments.length - 1]!;
      classDepth += 1;
      const classParentFromName = classSegments.length > 1
        ? classSegments.slice(0, -1).join("::")
        : undefined;
      const enclosingModule = moduleNamespace();
      const parentType = classParentFromName ?? (enclosingModule || undefined);
      currentClassQualified = classParentFromName
        ? `${classParentFromName}::${currentClass}`
        : enclosingModule
          ? `${enclosingModule}::${currentClass}`
          : currentClass;
      const kind = railsSymbolKind(filePath, "class");
      pushSymbol(symbols, {
        name: currentClass,
        kind,
        line: index + 1,
        parentType,
      });
      const parent = classMatch[2];
      if (parent) imports.push(`inherit:${parent}`);
      for (const inlineMethod of line.matchAll(/def\s+(?:self\.)?(\w+)/g)) {
        methodDepth += 1;
        pushSymbol(symbols, {
          name: inlineMethod[1]!,
          kind: "method",
          line: index + 1,
          parentType: methodOwner(),
        });
      }
      if (methodDepth > 0) {
        methodDepth = Math.max(0, methodDepth - countInlineEnds(line));
      }
      continue;
    }

    const defMatch = line.match(/^def\s+(?:self\.)?(\w+)/);
    if (defMatch) {
      methodDepth += 1;
      pushSymbol(symbols, {
        name: defMatch[1]!,
        kind: "method",
        line: index + 1,
        parentType: methodOwner(),
      });
      if (methodDepth > 0) {
        methodDepth = Math.max(0, methodDepth - countInlineEnds(line));
      }
      continue;
    }

    if (line === "end") {
      if (methodDepth > 0) {
        methodDepth -= 1;
      } else if (classDepth > 0) {
        classDepth -= 1;
        if (classDepth === 0) {
          currentClass = undefined;
          currentClassQualified = undefined;
        }
      } else if (moduleFrameStack.length > 0) {
        closeModuleFrame();
      }
    }
  }

  return { language: "ruby", filePath, symbols, imports, isTestFile, headings: [] };
}

function isPhpTestFile(filePath: string) {
  const baseName = path.basename(filePath);
  return /(?:^|\/)(?:tests?|spec)\//i.test(filePath) || /Test\.php$/i.test(baseName);
}

function parsePhpFile(body: string, filePath: string): EcosystemFileIndex {
  const symbols: EcosystemSymbol[] = [];
  const imports: string[] = [];
  let currentNamespace: string | undefined;
  let currentClass: string | undefined;
  const isTestFile = isPhpTestFile(filePath);

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;

    const namespaceMatch = line.match(/^namespace\s+([^;{]+)/);
    if (namespaceMatch) {
      currentNamespace = namespaceMatch[1]!.trim();
      pushSymbol(symbols, { name: currentNamespace, kind: "namespace", line: index + 1 });
      continue;
    }

    const useMatch = line.match(/^use\s+([^;]+);/);
    if (useMatch) {
      imports.push(useMatch[1]!.trim());
      continue;
    }

    const requireMatch = line.match(/^(?:require|require_once|include|include_once)\s*\(?['"]([^'"]+)['"]/);
    if (requireMatch) {
      imports.push(requireMatch[1]!);
      continue;
    }

    const typePatterns: Array<{ regex: RegExp; kind: string }> = [
      { regex: /^(?:abstract\s+|final\s+)?class\s+(\w+)/, kind: "class" },
      { regex: /^interface\s+(\w+)/, kind: "interface" },
      { regex: /^trait\s+(\w+)/, kind: "trait" },
    ];
    let matchedType = false;
    for (const pattern of typePatterns) {
      const match = line.match(pattern.regex);
      if (!match) continue;
      currentClass = match[1];
      pushSymbol(symbols, { name: currentClass, kind: pattern.kind, line: index + 1, parentType: currentNamespace });
      const implementsMatch = line.match(/implements\s+([\w\\, ]+)/);
      if (implementsMatch) {
        for (const iface of implementsMatch[1]!.split(",")) {
          imports.push(`implements:${iface.trim()}`);
        }
      }
      const extendsMatch = line.match(/extends\s+([\w\\]+)/);
      if (extendsMatch) imports.push(`inherit:${extendsMatch[1]!.trim()}`);
      for (const inlineMethod of line.matchAll(
        /(?:(?:public|protected|private|static|final|abstract)\s+)*function\s+(\w+)\s*\(/g
      )) {
        pushSymbol(symbols, {
          name: inlineMethod[1]!,
          kind: "method",
          line: index + 1,
          parentType: currentClass ?? currentNamespace,
        });
      }
      matchedType = true;
      break;
    }
    if (matchedType) continue;

    const hookMatch = line.match(/add_(?:action|filter)\s*\(\s*['"]([^'"]+)['"]/);
    if (hookMatch) {
      pushSymbol(symbols, { name: hookMatch[1]!, kind: "wp_hook", line: index + 1, parentType: currentClass });
      continue;
    }

    const topLevelFnMatch = line.match(/^function\s+(\w+)\s*\(/);
    if (topLevelFnMatch && !currentClass) {
      pushSymbol(symbols, { name: topLevelFnMatch[1]!, kind: "function", line: index + 1, parentType: currentNamespace });
      continue;
    }

    const methodMatch = line.match(
      /^(?:(?:public|protected|private|static|final|abstract)\s+)*function\s+(\w+)\s*\(/
    );
    if (methodMatch) {
      pushSymbol(symbols, {
        name: methodMatch[1]!,
        kind: "method",
        line: index + 1,
        parentType: currentClass ?? currentNamespace,
      });
    }

    if (line === "}") {
      currentClass = undefined;
    }
  }

  return { language: "php", filePath, symbols, imports, isTestFile, headings: [] };
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
  if (fileName === "pom.xml") {
    const artifactMatch = body.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/);
    const groupMatch = body.match(/<groupId>\s*([^<]+)\s*<\/groupId>/);
    if (artifactMatch) configMetadata.artifactId = artifactMatch[1]!.trim();
    if (groupMatch) configMetadata.groupId = groupMatch[1]!.trim();
    return {
      language: "java",
      filePath,
      symbols: artifactMatch ? [{ name: artifactMatch[1]!.trim(), kind: "artifact", line: 1 }] : [],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata,
    };
  }
  if (fileName === "build.gradle") {
    const rootProjectMatch = body.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/);
    if (rootProjectMatch) configMetadata.rootProject = rootProjectMatch[1]!;
    const projectDeps = [...body.matchAll(/(?:api|implementation)\s+project\(['"]:(\w+)['"]\)/g)]
      .map((match) => match[1]!);
    if (projectDeps.length > 0) configMetadata.projectDependencies = projectDeps.join(", ");
    return {
      language: "java",
      filePath,
      symbols: rootProjectMatch ? [{ name: rootProjectMatch[1]!, kind: "project", line: 1 }] : [],
      imports: projectDeps.map((dep) => `module:${dep}`),
      isTestFile: false,
      headings: [],
      configMetadata: { ...configMetadata, buildScript: "gradle-groovy" },
    };
  }
  if (fileName === "build.gradle.kts") {
    const rootProjectMatch = body.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/);
    if (rootProjectMatch) configMetadata.rootProject = rootProjectMatch[1]!;
    return {
      language: "kotlin",
      filePath,
      symbols: rootProjectMatch ? [{ name: rootProjectMatch[1]!, kind: "project", line: 1 }] : [],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata: { ...configMetadata, buildScript: "gradle-kotlin" },
    };
  }
  if (fileName === "settings.gradle" || fileName === "settings.gradle.kts") {
    const includes = parseGradleSettingsIncludes(body);
    if (includes.length > 0) configMetadata.modules = includes.join(", ");
    const rootProjectMatch = body.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/);
    if (rootProjectMatch) configMetadata.rootProject = rootProjectMatch[1]!;
    return {
      language: fileName.endsWith(".kts") ? "kotlin" : "java",
      filePath,
      symbols: includes.map((moduleName, index) => ({ name: moduleName, kind: "module", line: index + 1 })),
      imports: includes.map((moduleName) => `module:${moduleName}`),
      isTestFile: false,
      headings: [],
      configMetadata: { ...configMetadata, buildScript: fileName },
    };
  }
  if (fileName === "Gemfile") {
    const railsMatch = body.match(/gem\s+['"]rails['"]/i);
    return {
      language: "ruby",
      filePath,
      symbols: [{ name: "Gemfile", kind: "project", line: 1 }],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata: { framework: railsMatch ? "rails" : "ruby" },
    };
  }
  if (/\.gemspec$/i.test(fileName)) {
    const nameMatch = body.match(/\.name\s*=\s*['"]([^'"]+)['"]/);
    if (nameMatch) configMetadata.gem = nameMatch[1]!;
    return {
      language: "ruby",
      filePath,
      symbols: nameMatch ? [{ name: nameMatch[1]!, kind: "gem", line: 1 }] : [],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata,
    };
  }
  if (fileName === "Rakefile") {
    return {
      language: "ruby",
      filePath,
      symbols: [{ name: "Rakefile", kind: "entrypoint", line: 1 }],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata: { framework: "rake" },
    };
  }
  if (fileName === "pubspec.yaml") {
    const pubspec = parsePubspecYaml(body);
    const configMetadata: Record<string, string> = {};
    if (pubspec.packageName) configMetadata.package = pubspec.packageName;
    if (pubspec.isFlutter) configMetadata.framework = "flutter";
    if (pubspec.isPlugin) configMetadata.projectKind = "flutter-plugin";
    if (pubspec.dependencies.length > 0) {
      configMetadata.dependencies = pubspec.dependencies.join(", ");
    }
    return {
      language: "dart",
      filePath,
      symbols: pubspec.packageName ? [{ name: pubspec.packageName, kind: "package", line: 1 }] : [],
      imports: [...pubspec.dependencies, ...pubspec.devDependencies]
        .filter((dependency) => dependency !== "flutter" && dependency !== "flutter_test")
        .map((dependency) => `package:${dependency}`),
      isTestFile: false,
      headings: [],
      configMetadata,
    };
  }
  if (fileName === "Package.swift") {
    const nameMatch = body.match(/name:\s*"([^"]+)"/);
    if (nameMatch) configMetadata.package = nameMatch[1]!;
    const packageProducts = [...body.matchAll(/\.product\(name:\s*"([^"]+)"/g)].map((match) => match[1]!);
    if (packageProducts.length > 0) configMetadata.dependencies = packageProducts.join(", ");
    return {
      language: "swift",
      filePath,
      symbols: nameMatch ? [{ name: nameMatch[1]!, kind: "package", line: 1 }] : [],
      imports: packageProducts.map((product) => `package:${product}`),
      isTestFile: false,
      headings: [],
      configMetadata,
    };
  }
  if (fileName === "CMakeLists.txt") {
    const cmake = parseCMakeLists(body);
    if (cmake.projectName) configMetadata.project = cmake.projectName;
    if (cmake.targets.length > 0) {
      configMetadata.targets = cmake.targets.map((target) => target.name).join(", ");
    }
    return {
      language: "cpp",
      filePath,
      symbols: cmake.projectName ? [{ name: cmake.projectName, kind: "project", line: 1 }] : [],
      imports: cmake.links.map((link) => `cmake:${link.source}->${link.target}`),
      isTestFile: false,
      headings: [],
      configMetadata: { ...configMetadata, buildSystem: "cmake" },
    };
  }
  if (fileName === "Makefile") {
    return {
      language: "cpp",
      filePath,
      symbols: [{ name: "Makefile", kind: "build", line: 1 }],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata: { buildSystem: "make" },
    };
  }
  if (fileName === "meson.build") {
    const projectName = body.match(/project\s*\(\s*'([^']+)'/)?.[1];
    if (projectName) configMetadata.project = projectName;
    return {
      language: "cpp",
      filePath,
      symbols: projectName ? [{ name: projectName, kind: "project", line: 1 }] : [],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata: { ...configMetadata, buildSystem: "meson" },
    };
  }
  if (fileName === "compile_commands.json") {
    const entries = parseCompileCommands(body);
    if (entries.length > 0) configMetadata.compileUnits = entries.map((entry) => entry.file).join(", ");
    return {
      language: "cpp",
      filePath,
      symbols: entries.map((entry, index) => ({ name: path.basename(entry.file), kind: "compile_unit", line: index + 1 })),
      imports: entries.map((entry) => `compile:${entry.file}`),
      isTestFile: false,
      headings: [],
      configMetadata: { ...configMetadata, buildSystem: "compile_commands" },
    };
  }
  if (fileName === "composer.json") {
    const nameMatch = body.match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) configMetadata.package = nameMatch[1]!;
    const laravelMatch = body.match(/"laravel\/framework"/);
    if (laravelMatch) configMetadata.framework = "laravel";
    return {
      language: "php",
      filePath,
      symbols: nameMatch ? [{ name: nameMatch[1]!, kind: "project", line: 1 }] : [],
      imports: [],
      isTestFile: false,
      headings: [],
      configMetadata,
    };
  }
  if (fileName === "project.godot") {
    const project = parseGodotProject(body);
    if (project.projectName) configMetadata.project = project.projectName;
    if (project.mainScene) configMetadata.mainScene = project.mainScene;
    return {
      language: "godot",
      filePath,
      symbols: project.projectName ? [{ name: project.projectName, kind: "project", line: 1 }] : [],
      imports: project.autoloads.map((autoload) => `autoload:${autoload.path}`),
      isTestFile: false,
      headings: [],
      configMetadata: { ...configMetadata, engine: "godot" },
    };
  }
  if (/\.asmdef$/i.test(fileName)) {
    const asmdef = parseAsmdef(body);
    if (asmdef.name) configMetadata.assembly = asmdef.name;
    return {
      language: "unity",
      filePath,
      symbols: asmdef.name ? [{ name: asmdef.name, kind: "assembly", line: 1 }] : [],
      imports: asmdef.references.map((reference) => `assembly:${reference}`),
      isTestFile: false,
      headings: [],
      configMetadata: { ...configMetadata, engine: "unity" },
    };
  }
  if (/\.uproject$/i.test(fileName) || /\.uplugin$/i.test(fileName)) {
    const project = parseUnrealProject(body);
    if (project.projectName) configMetadata.project = project.projectName;
    return {
      language: "cpp",
      filePath,
      symbols: project.projectName ? [{ name: project.projectName, kind: "unreal_project", line: 1 }] : [],
      imports: project.modules.map((module) => `module:${module}`),
      isTestFile: false,
      headings: [],
      configMetadata: { ...configMetadata, engine: "unreal" },
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
    case "java":
      return parseJavaFile(input.body, input.filePath);
    case "kotlin":
      return parseKotlinFile(input.body, input.filePath);
    case "ruby":
      return parseRubyFile(input.body, input.filePath);
    case "php":
      return parsePhpFile(input.body, input.filePath);
    case "swift":
      return parseSwiftFile(input.body, input.filePath);
    case "dart":
      return parseDartFile(input.body, input.filePath);
    case "cpp":
      return parseCppFile(input.body, input.filePath);
    case "godot":
      if (input.extension === ".gd") {
        return parseGdScript(input.body, input.filePath);
      }
      return parseGodotSceneAsset(input.body, input.filePath);
    case "unity":
      return parseUnityAsset(input.body, input.filePath);
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
  const isSemanticLite = fileIndex.language === "java"
    || fileIndex.language === "kotlin"
    || fileIndex.language === "ruby"
    || fileIndex.language === "php";
  const indexingMode = isSemanticLite ? "t1.5" : "t1";
  const fileMetadata: Record<string, ProductMetadataValue> = {
    scannerEcosystemVersion: ECOSYSTEM_SCANNER_VERSION,
    scannerIndexingMode: indexingMode,
    scannerSemanticSupported: isSemanticLite,
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
      tags: ["code", "code-scan", fileIndex.language, isSemanticLite ? "ecosystem-t1.5" : "ecosystem-t1"],
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
        scannerIndexingMode: indexingMode,
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

  return { symbolNodes, edges, fileMetadata };
}

const JAVA_KOTLIN_TYPE_SYMBOL_KINDS = new Set(["class", "interface", "enum", "record", "object"]);

export interface JavaKotlinWorkspaceIndex {
  typeByQualifiedName: Map<string, { filePath: string; kind: string; simpleName: string }>;
}

export function buildJavaKotlinWorkspaceIndex(
  files: Array<{ relativePath: string; body: string }>
): JavaKotlinWorkspaceIndex {
  const typeByQualifiedName = new Map<string, { filePath: string; kind: string; simpleName: string }>();

  for (const file of files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".java" && extension !== ".kt" && extension !== ".kts") continue;
    const parsed = parseEcosystemFile({
      filePath: file.relativePath,
      fileName: path.basename(file.relativePath),
      extension,
      body: file.body,
    });
    if (!parsed) continue;
    const packageName = parsed.symbols.find((symbol) => symbol.kind === "package")?.name;
    if (!packageName) continue;
    for (const symbol of parsed.symbols) {
      if (!JAVA_KOTLIN_TYPE_SYMBOL_KINDS.has(symbol.kind) || symbol.parentType) continue;
      typeByQualifiedName.set(`${packageName}.${symbol.name}`, {
        filePath: file.relativePath,
        kind: symbol.kind,
        simpleName: symbol.name,
      });
    }
  }

  return { typeByQualifiedName };
}

export function normalizeImportPath(importPath: string) {
  if (importPath.endsWith(".*")) return undefined;
  const staticImport = importPath.match(/^static\s+(.+)$/);
  const normalized = (staticImport?.[1] ?? importPath).trim();
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot <= 0) return normalized;
  const maybeMember = normalized.slice(lastDot + 1);
  if (/^[a-z]/.test(maybeMember)) {
    return normalized.slice(0, lastDot);
  }
  return normalized;
}

function filePathSuffixForQualifiedType(qualifiedType: string, extension: ".java" | ".kt") {
  return `${qualifiedType.replace(/\./g, "/")}${extension}`;
}

function findFileNodeIdForQualifiedType(
  qualifiedType: string,
  fileNodeIdsByPath: Map<string, string>
) {
  for (const extension of [".java", ".kt"] as const) {
    const suffix = filePathSuffixForQualifiedType(qualifiedType, extension);
    for (const [filePath, nodeId] of fileNodeIdsByPath) {
      if (filePath.replace(/\\/g, "/").endsWith(suffix)) {
        return nodeId;
      }
    }
  }
  return undefined;
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

export function resolveJavaKotlinImportTarget(input: {
  importPath: string;
  index: JavaKotlinWorkspaceIndex;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
}) {
  const qualifiedType = normalizeImportPath(input.importPath);
  if (!qualifiedType) return undefined;

  const symbolNodeId = symbolNodeIdForQualifiedType(qualifiedType, input.index, input.stableId);
  if (symbolNodeId) {
    return { targetNodeId: symbolNodeId, resolution: "symbol" as const };
  }

  const fileNodeId = findFileNodeIdForQualifiedType(qualifiedType, input.fileNodeIdsByPath);
  if (fileNodeId) {
    return { targetNodeId: fileNodeId, resolution: "file" as const };
  }

  return {
    targetNodeId: input.stableId("code-scan:external", `java-kotlin|${qualifiedType}`),
    resolution: "external" as const,
  };
}

export function isResolvedEcosystemRelationshipEdge(
  edge: ProductGraphEdge,
  knownNodeIds: Set<string>
) {
  if (edge.metadata?.scannerRelation !== "import") return true;
  return knownNodeIds.has(edge.sourceNodeId) && knownNodeIds.has(edge.targetNodeId);
}

function ecosystemExternalNodeKey(language: EcosystemLanguage | "java-kotlin", importPath: string) {
  return `${language}|${importPath}`;
}

function createExternalImportNode(input: {
  importPath: string;
  language: EcosystemLanguage | "java-kotlin";
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxTitleLength: number;
}): ProductGraphNode {
  const nodeId = input.stableId("code-scan:external", ecosystemExternalNodeKey(input.language, input.importPath));
  return {
    id: nodeId,
    kind: "code_symbol",
    title: `${input.importPath} (external)`.slice(0, input.maxTitleLength),
    status: "planned",
    tags: ["code", "code-scan", input.language, "ecosystem-t1", "external-dependency"],
    metadata: input.compactMetadata({
      scannerEcosystemVersion: ECOSYSTEM_SCANNER_VERSION,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      scannerRelation: "external_import",
      scannerImportPath: input.importPath,
      scannerLanguage: input.language === "java-kotlin" ? "java" : input.language,
      scannerIndexingMode: "t1",
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

function ensureEcosystemExternalImportNode(
  externalNodes: Map<string, ProductGraphNode>,
  input: {
    importPath: string;
    language: EcosystemLanguage;
    scanId: string;
    scannedAt: string;
    stableId: (prefix: string, raw: string) => string;
    compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
    maxTitleLength: number;
  }
) {
  const nodeId = input.stableId("code-scan:external", ecosystemExternalNodeKey(input.language, input.importPath));
  if (!externalNodes.has(nodeId)) {
    externalNodes.set(nodeId, createExternalImportNode({ ...input, language: input.language }));
  }
  return nodeId;
}

function appendEcosystemImportEdge(input: {
  edges: ProductGraphEdge[];
  sourceNodeId: string;
  importPath: string;
  language: EcosystemLanguage;
  targetNodeId: string;
  resolution: "file" | "symbol" | "external";
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxEdgeLabelLength: number;
  scannedAt: string;
}) {
  input.edges.push({
    id: input.stableId("code-scan:edge", `${input.sourceNodeId}|import|${input.importPath}`),
    kind: "depends_on",
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    label: input.importPath.slice(0, input.maxEdgeLabelLength),
    trust: input.resolution === "external" ? "inferred" : "extracted",
    metadata: input.compactMetadata({
      scannerRelation: "import",
      scannerLanguage: input.language,
      scannerImportPath: input.importPath,
      scannerImportResolution: input.resolution,
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  });
}

export function augmentEcosystemWorkspaceGraph(input: {
  scanId: string;
  scannedAt: string;
  files: Array<{ relativePath: string; body: string }>;
  fileNodeIdsByPath: Map<string, string>;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxEdgeLabelLength: number;
  maxTitleLength?: number;
}) {
  const edges: ProductGraphEdge[] = [];
  const externalNodes = new Map<string, ProductGraphNode>();
  const terraformModules = new Map<string, string>();
  const javaKotlinIndex = buildJavaKotlinWorkspaceIndex(input.files);

  for (const file of input.files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension === ".py" || extension === ".go" || extension === ".rs") {
      const parsed = parseEcosystemFile({
        filePath: file.relativePath,
        fileName: path.basename(file.relativePath),
        extension,
        body: file.body,
      });
      const sourceNodeId = input.fileNodeIdsByPath.get(file.relativePath);
      if (!parsed || !sourceNodeId) continue;
      for (const importPath of parsed.imports.slice(0, 12)) {
        if (/^(?:inherit|implements|module):/.test(importPath)) continue;
        const targetNodeId = ensureEcosystemExternalImportNode(externalNodes, {
          importPath,
          language: parsed.language,
          scanId: input.scanId,
          scannedAt: input.scannedAt,
          stableId: input.stableId,
          compactMetadata: input.compactMetadata,
          maxTitleLength: input.maxTitleLength ?? 180,
        });
        appendEcosystemImportEdge({
          edges,
          sourceNodeId,
          importPath,
          language: parsed.language,
          targetNodeId,
          resolution: "external",
          stableId: input.stableId,
          compactMetadata: input.compactMetadata,
          maxEdgeLabelLength: input.maxEdgeLabelLength,
          scannedAt: input.scannedAt,
        });
      }
      continue;
    }

    if (extension === ".java" || extension === ".kt" || extension === ".kts") {
      const parsed = parseEcosystemFile({
        filePath: file.relativePath,
        fileName: path.basename(file.relativePath),
        extension,
        body: file.body,
      });
      const sourceNodeId = input.fileNodeIdsByPath.get(file.relativePath);
      if (!parsed || !sourceNodeId) continue;

      for (const importPath of parsed.imports.filter((value) => !value.includes(":")).slice(0, 12)) {
        const resolved = resolveJavaKotlinImportTarget({
          importPath,
          index: javaKotlinIndex,
          fileNodeIdsByPath: input.fileNodeIdsByPath,
          stableId: input.stableId,
        });
        if (!resolved) continue;
        if (resolved.resolution === "external") {
          if (!externalNodes.has(resolved.targetNodeId)) {
            externalNodes.set(
              resolved.targetNodeId,
              createExternalImportNode({
                importPath: normalizeImportPath(importPath) ?? importPath,
                language: "java-kotlin",
                scanId: input.scanId,
                scannedAt: input.scannedAt,
                stableId: input.stableId,
                compactMetadata: input.compactMetadata,
                maxTitleLength: input.maxTitleLength ?? 180,
              })
            );
          }
        }
        edges.push({
          id: input.stableId("code-scan:edge", `${sourceNodeId}|import|${importPath}`),
          kind: "depends_on",
          sourceNodeId,
          targetNodeId: resolved.targetNodeId,
          label: importPath.slice(0, input.maxEdgeLabelLength),
          trust: resolved.resolution === "external" ? "inferred" : "extracted",
          metadata: input.compactMetadata({
            scannerRelation: "import",
            scannerLanguage: parsed.language,
            scannerImportPath: importPath,
            scannerImportResolution: resolved.resolution,
            scannerResolution: "semantic-lite",
          }),
          createdAt: input.scannedAt,
          updatedAt: input.scannedAt,
        });
      }
      continue;
    }

    const fileName = path.basename(file.relativePath);
    if (fileName === "build.gradle" || fileName === "build.gradle.kts") {
      const sourceNodeId = input.fileNodeIdsByPath.get(file.relativePath);
      if (!sourceNodeId) continue;
      const moduleDeps = [...file.body.matchAll(/(?:api|implementation)\s+project\(['"]:(\w+)['"]\)/g)];
      for (const match of moduleDeps) {
        const moduleName = match[1]!;
        const moduleCandidates = [
          `${moduleName}/build.gradle`,
          `${moduleName}/build.gradle.kts`,
          `${moduleName}/src/main/java`,
          `${moduleName}/src/main/kotlin`,
        ];
        const targetNodeId = moduleCandidates
          .map((candidate) => input.fileNodeIdsByPath.get(candidate))
          .find((nodeId): nodeId is string => Boolean(nodeId));
        if (!targetNodeId) continue;
        edges.push({
          id: input.stableId("code-scan:edge", `${sourceNodeId}|module|${moduleName}`),
          kind: "depends_on",
          sourceNodeId,
          targetNodeId,
          label: `module ${moduleName}`.slice(0, input.maxEdgeLabelLength),
          trust: "extracted",
          metadata: input.compactMetadata({
            scannerRelation: "gradle_module",
            scannerLanguage: fileName.endsWith(".kts") ? "kotlin" : "java",
            scannerModuleName: moduleName,
          }),
          createdAt: input.scannedAt,
          updatedAt: input.scannedAt,
        });
      }
      continue;
    }

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

  return { edges, externalNodes: [...externalNodes.values()], terraformModules };
}

export function buildEcosystemParsedFileIndex(files: Array<{ relativePath: string; body: string }>) {
  const parsedByPath = new Map<string, EcosystemFileIndex>();
  for (const file of files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (extension !== ".java" && extension !== ".kt" && extension !== ".kts") continue;
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