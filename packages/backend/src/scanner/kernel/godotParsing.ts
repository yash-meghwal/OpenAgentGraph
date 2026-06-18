const MAX_SYMBOLS_PER_FILE = 120;

interface GodotSymbol {
  name: string;
  kind: string;
  line: number;
  parentType?: string;
}

function pushSymbol(
  symbols: GodotSymbol[],
  input: { name: string; kind: string; line: number; parentType?: string }
) {
  if (symbols.length >= MAX_SYMBOLS_PER_FILE) return;
  symbols.push(input);
}

function normalizeGodotResourcePath(resourcePath: string) {
  const normalized = resourcePath.replace(/\\/g, "/");
  if (normalized.startsWith("res://")) return normalized;
  return `res://${normalized.replace(/^\.\//, "")}`;
}

export function parseGdScript(body: string, filePath: string) {
  const symbols: GodotSymbol[] = [];
  const imports: string[] = [];
  let currentType: string | undefined;
  let indentDepth = 0;
  let typeIndentDepth = -1;

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const leadingSpaces = rawLine.match(/^(\s*)/)?.[1]?.length ?? 0;
    const lineDepth = Math.floor(leadingSpaces / 4);

    if (currentType !== undefined && lineDepth <= typeIndentDepth && !line.endsWith(":")) {
      currentType = undefined;
      typeIndentDepth = -1;
    }

    const extendsMatch = line.match(/^extends\s+(?:"([^"]+)"|([\w.]+))/);
    if (extendsMatch) {
      const target = extendsMatch[1] ?? extendsMatch[2]!;
      imports.push(target.startsWith("res://") ? `extends_res:${target}` : `extends:${target}`);
      continue;
    }

    const classNameMatch = line.match(/^class_name\s+(\w+)/);
    if (classNameMatch) {
      currentType = classNameMatch[1]!;
      typeIndentDepth = lineDepth;
      pushSymbol(symbols, { name: currentType, kind: "class", line: index + 1 });
      continue;
    }

    const signalMatch = line.match(/^signal\s+(\w+)/);
    if (signalMatch) {
      pushSymbol(symbols, {
        name: signalMatch[1]!,
        kind: "signal",
        line: index + 1,
        parentType: currentType,
      });
      continue;
    }

    const funcMatch = line.match(/^func\s+(\w+)\s*\(/);
    if (funcMatch) {
      pushSymbol(symbols, {
        name: funcMatch[1]!,
        kind: currentType ? "method" : "function",
        line: index + 1,
        parentType: currentType,
      });
      if (line.endsWith(":")) {
        currentType = currentType ?? funcMatch[1]!;
        typeIndentDepth = lineDepth;
      }
      indentDepth = lineDepth;
      continue;
    }

    if (line.endsWith(":")) {
      indentDepth = lineDepth;
    }
  }

  return {
    language: "godot" as const,
    filePath,
    symbols,
    imports,
    isTestFile: /(?:^|\/)(?:test|tests)\//i.test(filePath.replace(/\\/g, "/")),
    headings: [],
  };
}

export function parseGodotSceneAsset(body: string, filePath: string) {
  const symbols: GodotSymbol[] = [];
  const imports: string[] = [];

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    const extResourceMatch = line.match(/path="(res:\/\/[^"]+)"/);
    if (extResourceMatch) {
      imports.push(`res:${normalizeGodotResourcePath(extResourceMatch[1]!)}`);
      continue;
    }
    const nodeMatch = line.match(/^\[node name="([^"]+)"/);
    if (nodeMatch) {
      pushSymbol(symbols, { name: nodeMatch[1]!, kind: "scene_node", line: index + 1 });
      continue;
    }
    const scriptMatch = line.match(/^script\s*=\s*ExtResource\("([^"]+)"\)/);
    if (scriptMatch) {
      imports.push(`scene_script:${scriptMatch[1]!}`);
    }
  }

  return {
    language: "godot" as const,
    filePath,
    symbols,
    imports,
    isTestFile: false,
    headings: [],
    configMetadata: { assetKind: filePath.endsWith(".tscn") ? "scene" : "resource" },
  };
}

export function parseUnityAsset(body: string, filePath: string) {
  const symbols: GodotSymbol[] = [];
  const imports: string[] = [];

  for (const [index, rawLine] of body.split("\n").entries()) {
    const line = rawLine.trim();
    const nameMatch = line.match(/^m_Name:\s*(.+)$/);
    if (nameMatch) {
      const objectName = nameMatch[1]!.trim();
      if (objectName && objectName !== "0") {
        pushSymbol(symbols, { name: objectName, kind: "game_object", line: index + 1 });
      }
      continue;
    }
    if (/^m_Script:/.test(line)) {
      imports.push("unity_script_ref:unresolved");
    }
  }

  return {
    language: "unity" as const,
    filePath,
    symbols,
    imports,
    isTestFile: false,
    headings: [],
    configMetadata: {
      assetKind: filePath.endsWith(".unity") ? "scene" : "prefab",
    },
  };
}

export function resolveGodotResourcePath(
  resourcePath: string,
  fileNodeIdsByPath: Map<string, string>
) {
  const normalized = normalizeGodotResourcePath(resourcePath);
  const relative = normalized.slice("res://".length);
  const candidates = [
    relative,
    relative.endsWith(".gd") ? relative : `${relative}.gd`,
  ];
  for (const candidate of candidates) {
    const nodeId = fileNodeIdsByPath.get(candidate);
    if (nodeId) return { targetNodeId: nodeId, resolution: "file" as const };
  }
  return undefined;
}