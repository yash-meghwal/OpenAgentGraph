import path from "path";

interface DartSymbol {
  name: string;
  kind: string;
  line: number;
  parentType?: string;
}

const MAX_SYMBOLS_PER_FILE = 120;
const DART_CLASS_MODIFIERS = "(?:abstract|final|base|interface|sealed)";
const DART_TYPE_PARAMETERS = "(?:<[^>]*>)?";
const DART_HEADER_SUFFIX = "(?:\\s+(.*))?$";

function pushSymbol(
  symbols: DartSymbol[],
  input: { name: string; kind: string; line: number; parentType?: string }
) {
  if (symbols.length >= MAX_SYMBOLS_PER_FILE) return;
  symbols.push(input);
}

export function normalizeDartImportSpecifier(specifier: string) {
  if (specifier.startsWith("package:")) return specifier;
  if (specifier.startsWith("dart:")) return `system:${specifier}`;
  return `local:${specifier}`;
}

export function isDartTestFile(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const baseName = path.basename(normalized);
  return /(?:^|\/)(?:test|integration_test)\//i.test(normalized)
    || /_test\.dart$/i.test(baseName);
}

function stripTrailingClassBody(text: string) {
  const braceIndex = text.indexOf("{");
  return braceIndex >= 0 ? text.slice(0, braceIndex).trim() : text.trim();
}

function splitTopLevelCommas(text: string) {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of text) {
    if (char === "<") depth += 1;
    else if (char === ">") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function simpleTypeReference(typeReference: string) {
  return typeReference.split(/</)[0]?.trim() ?? typeReference.trim();
}

function splitBeforeClauseKeyword(text: string) {
  const normalized = stripTrailingClassBody(text);
  const keywords = [" with ", " implements "];
  let cutIndex = normalized.length;
  for (const keyword of keywords) {
    const index = normalized.indexOf(keyword);
    if (index >= 0) cutIndex = Math.min(cutIndex, index);
  }
  const segment = normalized.slice(0, cutIndex).trim();
  const remainder = normalized.slice(cutIndex).trimStart();
  return { segment, remainder };
}

function parseDartClassClauses(input: {
  name: string;
  remainder: string;
  modifiers?: string[];
  isMixinClass?: boolean;
}) {
  let remainder = stripTrailingClassBody(input.remainder);
  let extendsClause: string | undefined;
  let withClause: string | undefined;
  let implementsClause: string | undefined;

  if (remainder.startsWith("extends ")) {
    remainder = remainder.slice("extends ".length);
    const split = splitBeforeClauseKeyword(remainder);
    extendsClause = split.segment || undefined;
    remainder = split.remainder;
  }

  if (remainder.startsWith("with ")) {
    remainder = remainder.slice("with ".length);
    const split = splitBeforeClauseKeyword(remainder);
    withClause = split.segment || undefined;
    remainder = split.remainder;
  }

  if (remainder.startsWith("implements ")) {
    remainder = remainder.slice("implements ".length);
    implementsClause = stripTrailingClassBody(remainder) || undefined;
  }

  return {
    name: input.name,
    extendsClause,
    withClause,
    implementsClause,
    modifiers: input.modifiers,
    isMixinClass: input.isMixinClass,
  };
}

export function parseDartClassHeader(line: string): {
  name: string;
  extendsClause?: string;
  withClause?: string;
  implementsClause?: string;
  modifiers?: string[];
  isMixinClass?: boolean;
} | undefined {
  const mixinClassMatch = line.match(
    new RegExp(
      `^(?:(?:${DART_CLASS_MODIFIERS})\\s+)*mixin\\s+class\\s+(\\w+)${DART_TYPE_PARAMETERS}${DART_HEADER_SUFFIX}`
    )
  );
  if (mixinClassMatch) {
    return parseDartClassClauses({
      name: mixinClassMatch[1]!,
      remainder: mixinClassMatch[2] ?? "",
      modifiers: extractDartClassModifiers(line),
      isMixinClass: true,
    });
  }

  const classMatch = line.match(
    new RegExp(
      `^(?:(?:${DART_CLASS_MODIFIERS})\\s+)*class\\s+(\\w+)${DART_TYPE_PARAMETERS}${DART_HEADER_SUFFIX}`
    )
  );
  if (!classMatch) return undefined;

  return parseDartClassClauses({
    name: classMatch[1]!,
    remainder: classMatch[2] ?? "",
    modifiers: extractDartClassModifiers(line),
  });
}

export function parseDartStateClassHeader(line: string): {
  name: string;
  widgetType: string;
  modifiers?: string[];
} | undefined {
  const stateMatch = line.match(
    new RegExp(
      `^(?:(?:${DART_CLASS_MODIFIERS})\\s+)*class\\s+(\\w+)${DART_TYPE_PARAMETERS}\\s+extends\\s+State<(\\w+)>`
    )
  );
  if (!stateMatch) return undefined;
  return {
    name: stateMatch[1]!,
    widgetType: stateMatch[2]!,
    modifiers: extractDartClassModifiers(line),
  };
}

export function extractDartClassModifiers(line: string) {
  const modifiers: string[] = [];
  const prefix = line.match(
    new RegExp(`^((?:(?:${DART_CLASS_MODIFIERS})\\s+)*(?:mixin\\s+class|class))`)
  )?.[1];
  if (!prefix) return modifiers;
  for (const modifier of ["abstract", "final", "base", "interface", "sealed"] as const) {
    if (new RegExp(`\\b${modifier}\\b`).test(prefix)) modifiers.push(modifier);
  }
  return modifiers;
}

function isDartTypeDeclarationLine(line: string) {
  return new RegExp(
    `^(?:(?:${DART_CLASS_MODIFIERS})\\s+)*(?:mixin\\s+class|class|mixin|enum)\\s`
  ).test(line);
}

function dartSymbolKindForClass(input: {
  extendsClause?: string;
  isMixinClass?: boolean;
  modifiers?: string[];
}) {
  if (input.isMixinClass) return "mixin_class";
  const normalized = (input.extendsClause ?? "").replace(/\s+/g, " ").trim();
  if (/\bStatelessWidget\b/.test(normalized)) return "stateless_widget";
  if (/\bStatefulWidget\b/.test(normalized)) return "stateful_widget";
  return "class";
}

function appendDartTypeImports(
  imports: string[],
  input: { extendsClause?: string; withClause?: string; implementsClause?: string }
) {
  const extendsClause = (input.extendsClause ?? "").replace(/\s+/g, " ").trim();
  if (extendsClause) {
    const baseType = simpleTypeReference(extendsClause);
    if (baseType && !["StatelessWidget", "StatefulWidget", "Object"].includes(baseType)) {
      imports.push(`extends:${baseType}`);
    }
    if (/\bStatelessWidget\b/.test(extendsClause)) imports.push("extends:StatelessWidget");
    if (/\bStatefulWidget\b/.test(extendsClause)) imports.push("extends:StatefulWidget");
  }
  if (input.withClause) {
    for (const mixinName of splitTopLevelCommas(input.withClause)) {
      const trimmed = simpleTypeReference(mixinName);
      if (trimmed) imports.push(`with:${trimmed}`);
    }
  }
  if (input.implementsClause) {
    for (const interfaceName of splitTopLevelCommas(input.implementsClause)) {
      const trimmed = simpleTypeReference(interfaceName);
      if (trimmed) imports.push(`implements:${trimmed}`);
    }
  }
}

export function parseDartFile(body: string, filePath: string) {
  const symbols: DartSymbol[] = [];
  const imports: string[] = [];
  let currentType: string | undefined;
  let braceDepth = 0;
  let typeBraceDepth = -1;
  const isTestFile = isDartTestFile(filePath);

  const applyBraceDelta = (openBraces: number, closeBraces: number) => {
    braceDepth += openBraces - closeBraces;
    if (currentType !== undefined && braceDepth < typeBraceDepth) {
      currentType = undefined;
      typeBraceDepth = -1;
    }
  };

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;

    const openBraces = (line.match(/\{/g) ?? []).length;
    const closeBraces = (line.match(/\}/g) ?? []).length;

    const importMatch = line.match(/^import\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      imports.push(normalizeDartImportSpecifier(importMatch[1]!));
      continue;
    }
    const exportMatch = line.match(/^export\s+['"]([^'"]+)['"]/);
    if (exportMatch) {
      imports.push(normalizeDartImportSpecifier(exportMatch[1]!));
      continue;
    }

    const stateHeader = parseDartStateClassHeader(line);
    if (stateHeader) {
      currentType = stateHeader.name;
      typeBraceDepth = braceDepth + openBraces;
      pushSymbol(symbols, {
        name: currentType,
        kind: "state",
        line: index + 1,
        parentType: stateHeader.widgetType,
      });
      imports.push(`widget_state:${stateHeader.widgetType}`);
      applyBraceDelta(openBraces, closeBraces);
      continue;
    }

    const classHeader = parseDartClassHeader(line);
    if (classHeader) {
      currentType = classHeader.name;
      typeBraceDepth = braceDepth + openBraces;
      pushSymbol(symbols, {
        name: currentType,
        kind: dartSymbolKindForClass(classHeader),
        line: index + 1,
      });
      appendDartTypeImports(imports, classHeader);
      applyBraceDelta(openBraces, closeBraces);
      continue;
    }

    const mixinMatch = line.match(
      new RegExp(`^(?:(?:${DART_CLASS_MODIFIERS})\\s+)*mixin\\s+(?!class\\b)(\\w+)${DART_TYPE_PARAMETERS}(?:\\s|\\{|$)`)
    );
    if (mixinMatch) {
      currentType = mixinMatch[1]!;
      typeBraceDepth = braceDepth + openBraces;
      pushSymbol(symbols, {
        name: currentType,
        kind: "mixin",
        line: index + 1,
      });
      applyBraceDelta(openBraces, closeBraces);
      continue;
    }

    const enumMatch = line.match(/^enum\s+(\w+)/);
    if (enumMatch) {
      pushSymbol(symbols, {
        name: enumMatch[1]!,
        kind: "enum",
        line: index + 1,
      });
      applyBraceDelta(openBraces, closeBraces);
      continue;
    }

    const funcMatch = line.match(
      /^(?:(?:static|final|const|async|external|void|Future(?:<[^>]+>)?|Stream(?:<[^>]+>)?|[\w<>,\s?]+)\s+)+(\w+)\s*\([^;]*\)\s*(?:async\s*)?(?:=>|\{)?/
    );
    if (
      funcMatch
      && !isDartTypeDeclarationLine(line)
      && !line.startsWith("import ")
      && !line.startsWith("export ")
      && !line.startsWith("typedef ")
      && !line.startsWith("extension ")
    ) {
      pushSymbol(symbols, {
        name: funcMatch[1]!,
        kind: currentType ? "method" : "function",
        line: index + 1,
        parentType: currentType,
      });
      applyBraceDelta(openBraces, closeBraces);
      continue;
    }

    applyBraceDelta(openBraces, closeBraces);
  }

  return {
    language: "dart" as const,
    filePath,
    symbols,
    imports,
    isTestFile,
    headings: [],
  };
}