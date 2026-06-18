export interface PubspecMetadata {
  packageName?: string;
  dependencies: string[];
  devDependencies: string[];
  isFlutter: boolean;
  isPlugin: boolean;
}

function extractYamlSection(body: string, sectionName: string) {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trimStart() === `${sectionName}:` || line.trimStart().startsWith(`${sectionName}:`));
  if (start < 0) return "";
  const sectionLines: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^[A-Za-z_][\w-]*:/.test(line)) break;
    sectionLines.push(line);
  }
  return sectionLines.join("\n");
}

function parsePubspecDependencyNames(sectionBody: string) {
  const names: string[] = [];
  for (const line of sectionBody.split("\n")) {
    const dependencyMatch = line.match(/^  ([A-Za-z_][\w-]*):/);
    if (!dependencyMatch) continue;
    const dependencyName = dependencyMatch[1]!;
    if (dependencyName === "sdk") continue;
    names.push(dependencyName);
  }
  return names;
}

export function parsePubspecYaml(body: string): PubspecMetadata {
  const packageName = body.match(/^name:\s*(\S+)/m)?.[1];
  const dependencies = parsePubspecDependencyNames(extractYamlSection(body, "dependencies"));
  const devDependencies = parsePubspecDependencyNames(extractYamlSection(body, "dev_dependencies"));
  const isFlutter = /^\s*flutter:\s*$/m.test(body)
    || /sdk:\s*flutter/m.test(body)
    || dependencies.includes("flutter");
  const isPlugin = /^\s*plugin:\s*$/m.test(body)
    || /flutter:\s*\n\s*plugin:/m.test(body);

  return {
    packageName,
    dependencies,
    devDependencies,
    isFlutter,
    isPlugin,
  };
}

export function inferDartTestTargetBaseName(filePath: string) {
  const baseName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  return baseName
    .replace(/_test\.dart$/i, "")
    .replace(/\.dart$/i, "");
}

function packageImportCandidates(packageRoot: string, importedFile: string) {
  const prefix = packageRoot ? `${packageRoot.replace(/\/$/, "")}/` : "";
  const normalizedFile = importedFile.replace(/\\/g, "/");
  const withDart = normalizedFile.endsWith(".dart") ? normalizedFile : `${normalizedFile}.dart`;
  return [...new Set([
    `${prefix}lib/${normalizedFile}`,
    `${prefix}lib/${withDart}`,
    `${prefix}${normalizedFile}`,
    `${prefix}${withDart}`,
  ])];
}

export function resolveDartWorkspaceImport(
  importPath: string,
  sourceRelativePath: string,
  packageRoots: Map<string, string>,
  fileNodeIdsByPath: Map<string, string>
) {
  if (importPath.startsWith("package:")) {
    const remainder = importPath.slice("package:".length);
    const slashIndex = remainder.indexOf("/");
    if (slashIndex < 0) return undefined;
    const importedPackage = remainder.slice(0, slashIndex);
    const importedFile = remainder.slice(slashIndex + 1);
    const packageRoot = packageRoots.get(importedPackage);
    if (packageRoot === undefined) return undefined;
    for (const candidate of packageImportCandidates(packageRoot, importedFile)) {
      const nodeId = fileNodeIdsByPath.get(candidate);
      if (nodeId) return { targetNodeId: nodeId, resolution: "file" as const };
    }
    return undefined;
  }

  if (!importPath.startsWith("local:")) return undefined;
  const relativeImport = importPath.slice("local:".length);
  const sourceDir = sourceRelativePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  const candidates = [
    relativeImport,
    sourceDir ? `${sourceDir}/${relativeImport}` : relativeImport,
    `lib/${relativeImport}`,
    relativeImport.startsWith("lib/") ? relativeImport : `lib/${relativeImport}`,
  ];
  for (const candidate of candidates) {
    const normalized = candidate
      .replace(/\\/g, "/")
      .replace(/\/\.\//g, "/")
      .replace(/[^/]+\/\.\.\//g, "");
    const withDart = normalized.endsWith(".dart") ? normalized : `${normalized}.dart`;
    const nodeId = fileNodeIdsByPath.get(withDart) ?? fileNodeIdsByPath.get(normalized);
    if (nodeId) return { targetNodeId: nodeId, resolution: "file" as const };
  }
  return undefined;
}