import path from "path";

interface CppSymbol {
  name: string;
  kind: string;
  line: number;
  parentType?: string;
}

const MAX_SYMBOLS_PER_FILE = 120;

function pushSymbol(
  symbols: CppSymbol[],
  input: { name: string; kind: string; line: number; parentType?: string }
) {
  if (symbols.length >= MAX_SYMBOLS_PER_FILE) return;
  symbols.push(input);
}

export function isCppTestFile(filePath: string) {
  const baseName = path.basename(filePath);
  return /(?:^|\/)(?:tests?|spec)\//i.test(filePath)
    || /_test\.(?:c|cc|cpp|h|hpp)$/i.test(baseName)
    || /Test\.(?:c|cc|cpp)$/i.test(baseName);
}

export function parseCppFile(body: string, filePath: string) {
  const symbols: CppSymbol[] = [];
  const imports: string[] = [];
  const namespaceStack: string[] = [];
  const namespaceFrameStack: Array<{ entryDepth: number; segmentCount: number }> = [];
  let currentType: string | undefined;
  let braceDepth = 0;
  let typeBraceDepth = -1;
  const macroNames: string[] = [];
  const isTestFile = isCppTestFile(filePath);

  const namespaceName = () => namespaceStack.join("::") || undefined;

  const applyBraceDelta = (openBraces: number, closeBraces: number) => {
    braceDepth += openBraces - closeBraces;
    while (
      namespaceFrameStack.length > 0
      && braceDepth < namespaceFrameStack[namespaceFrameStack.length - 1]!.entryDepth
    ) {
      const frame = namespaceFrameStack.pop()!;
      for (let index = 0; index < frame.segmentCount; index += 1) {
        namespaceStack.pop();
      }
    }
    if (currentType !== undefined && braceDepth <= typeBraceDepth) {
      currentType = undefined;
      typeBraceDepth = -1;
    }
  };

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("/*") || line.startsWith("*")) continue;

    const openBraces = (line.match(/\{/g) ?? []).length;
    const closeBraces = (line.match(/\}/g) ?? []).length;

    const includeLocal = line.match(/^#\s*include\s+"([^"]+)"/);
    if (includeLocal) {
      imports.push(`local:${includeLocal[1]!}`);
      continue;
    }
    const includeSystem = line.match(/^#\s*include\s+<([^>]+)>/);
    if (includeSystem) {
      imports.push(`system:${includeSystem[1]!}`);
      continue;
    }

    const defineMatch = line.match(/^#\s*define\s+(\w+)/);
    if (defineMatch) {
      macroNames.push(defineMatch[1]!);
      pushSymbol(symbols, { name: defineMatch[1]!, kind: "macro", line: index + 1 });
      continue;
    }

    const namespaceMatch = line.match(/^namespace\s+([\w:]+)\s*\{/);
    if (namespaceMatch) {
      const segments = namespaceMatch[1]!.split("::");
      namespaceFrameStack.push({
        entryDepth: braceDepth + openBraces,
        segmentCount: segments.length,
      });
      for (const segment of segments) {
        namespaceStack.push(segment);
      }
      pushSymbol(symbols, {
        name: namespaceStack[namespaceStack.length - 1]!,
        kind: "namespace",
        line: index + 1,
        parentType: namespaceStack.length > 1 ? namespaceStack.slice(0, -1).join("::") : undefined,
      });
      applyBraceDelta(openBraces, closeBraces);
      continue;
    }

    const classMatch = line.match(
      /^(?:template\s*<[^>]+>\s*)?(?:class|struct)\s+(\w+)(?:\s*:\s*(?:public|protected|private)\s+([\w:]+))?/
    );
    if (classMatch) {
      currentType = classMatch[1];
      typeBraceDepth = braceDepth;
      pushSymbol(symbols, {
        name: currentType,
        kind: line.includes("struct ") ? "struct" : "class",
        line: index + 1,
        parentType: namespaceName(),
      });
      if (classMatch[2]) imports.push(`extends:${classMatch[2]}`);
      applyBraceDelta(openBraces, closeBraces);
      continue;
    }

    const enumMatch = line.match(/^enum(?:\s+class)?\s+(\w+)/);
    if (enumMatch) {
      pushSymbol(symbols, {
        name: enumMatch[1]!,
        kind: "enum",
        line: index + 1,
        parentType: namespaceName(),
      });
      applyBraceDelta(openBraces, closeBraces);
      continue;
    }

    const funcMatch = line.match(
      /^(?:(?:inline|static|virtual|explicit|constexpr|extern)\s+)*[\w:*&<>,\s]+\s+(\w+)\s*\([^;]*\)\s*(?:const)?\s*(?:override)?\s*\{?/
    );
    if (
      funcMatch
      && !line.startsWith("class ")
      && !line.startsWith("struct ")
      && !line.startsWith("enum ")
      && !line.includes(" namespace ")
    ) {
      pushSymbol(symbols, {
        name: funcMatch[1]!,
        kind: currentType ? "method" : "function",
        line: index + 1,
        parentType: currentType ?? namespaceName(),
      });
      applyBraceDelta(openBraces, closeBraces);
      continue;
    }

    applyBraceDelta(openBraces, closeBraces);
  }

  const configMetadata = macroNames.length > 0
    ? { macros: macroNames.slice(0, 20).join(", ") }
    : undefined;

  return {
    language: "cpp" as const,
    filePath,
    symbols,
    imports,
    isTestFile,
    headings: [],
    configMetadata,
  };
}