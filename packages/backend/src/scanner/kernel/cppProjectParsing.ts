export interface CmakeTarget {
  name: string;
  kind: "executable" | "library";
  sources: string[];
}

export interface CmakeProjectMetadata {
  projectName?: string;
  targets: CmakeTarget[];
  links: Array<{ source: string; target: string }>;
}

export interface CompileCommandEntry {
  file: string;
  directory: string;
}

const CMAKE_TARGET_NAME_PATTERN = "[\\w-]+";
const CMAKE_LINK_SCOPE_KEYWORDS = new Set(["PUBLIC", "PRIVATE", "INTERFACE"]);

function splitCmakeSources(rawSources: string) {
  return rawSources
    .split(/\s+/)
    .filter((value) => /\.(?:c|cc|cpp)$/i.test(value));
}

function parseCmakeLinkDependencies(rawDependencies: string) {
  const dependencies: string[] = [];
  for (const token of rawDependencies.split(/\s+/)) {
    if (!token) continue;
    const normalized = token.replace(/[,;]+$/g, "");
    if (!normalized) continue;
    if (CMAKE_LINK_SCOPE_KEYWORDS.has(normalized.toUpperCase())) continue;
    if (normalized.startsWith("$<")) continue;
    dependencies.push(normalized);
  }
  return dependencies;
}

export function parseCMakeLists(body: string): CmakeProjectMetadata {
  const projectName = body.match(new RegExp(`project\\s*\\(\\s*(${CMAKE_TARGET_NAME_PATTERN})`, "i"))?.[1];
  const targets: CmakeTarget[] = [];
  const links: Array<{ source: string; target: string }> = [];

  for (const match of body.matchAll(
    new RegExp(`add_executable\\s*\\(\\s*(${CMAKE_TARGET_NAME_PATTERN})\\s+([^)]+)\\)`, "gi")
  )) {
    targets.push({
      name: match[1]!,
      kind: "executable",
      sources: splitCmakeSources(match[2]!),
    });
  }
  for (const match of body.matchAll(
    new RegExp(`add_library\\s*\\(\\s*(${CMAKE_TARGET_NAME_PATTERN})\\s+([^)]+)\\)`, "gi")
  )) {
    targets.push({
      name: match[1]!,
      kind: "library",
      sources: splitCmakeSources(match[2]!),
    });
  }
  for (const match of body.matchAll(
    new RegExp(`target_link_libraries\\s*\\(\\s*(${CMAKE_TARGET_NAME_PATTERN})\\s+([^)]+)\\)`, "gi")
  )) {
    for (const dependency of parseCmakeLinkDependencies(match[2]!)) {
      links.push({ source: match[1]!, target: dependency });
    }
  }

  return { projectName, targets, links };
}

export function normalizeCompileCommandFilePath(file: string, directory = ".") {
  const normalizedFile = file.replace(/\\/g, "/");
  if (normalizedFile.startsWith("./")) {
    return normalizedFile.slice(2);
  }
  if (!normalizedFile.startsWith("/") && !/^[A-Za-z]:\//.test(normalizedFile)) {
    const normalizedDirectory = directory.replace(/\\/g, "/");
    if (normalizedDirectory && normalizedDirectory !== ".") {
      return `${normalizedDirectory.replace(/\/$/, "")}/${normalizedFile}`.replace(/^\.\//, "");
    }
    return normalizedFile;
  }
  return normalizedFile;
}

export function resolveCompileCommandFilePath(
  entry: CompileCommandEntry,
  workspacePaths: Iterable<string>
) {
  const candidates = new Set<string>();
  const normalizedFile = entry.file.replace(/\\/g, "/");
  const normalizedDirectory = entry.directory.replace(/\\/g, "/");

  candidates.add(normalizedFile);
  if (normalizedFile.startsWith("./")) {
    candidates.add(normalizedFile.slice(2));
  }
  if (!normalizedFile.startsWith("/") && !/^[A-Za-z]:\//.test(normalizedFile)) {
    candidates.add(pathJoinPosix(normalizedDirectory, normalizedFile));
    candidates.add(pathJoinPosix(".", normalizedFile));
  }

  const workspacePathList = [...workspacePaths].map((value) => value.replace(/\\/g, "/"));
  for (const candidate of candidates) {
    const normalizedCandidate = candidate.replace(/\\/g, "/").replace(/^\.\//, "");
    const exact = workspacePathList.find((workspacePath) => workspacePath === normalizedCandidate);
    if (exact) return exact;
  }

  const basename = posixBasename(normalizedFile);
  const basenameMatches = workspacePathList.filter((workspacePath) => posixBasename(workspacePath) === basename);
  if (basenameMatches.length === 1) {
    return basenameMatches[0];
  }

  for (const workspacePath of workspacePathList) {
    for (const candidate of candidates) {
      const normalizedCandidate = candidate.replace(/\\/g, "/");
      if (
        normalizedCandidate.endsWith(`/${workspacePath}`)
        || normalizedCandidate === workspacePath
        || workspacePath.endsWith(`/${posixBasename(normalizedCandidate)}`)
      ) {
        return workspacePath;
      }
    }
    if (normalizedFile.endsWith(`/${workspacePath}`)) {
      return workspacePath;
    }
  }

  return undefined;
}

function pathJoinPosix(left: string, right: string) {
  const normalizedLeft = left.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedRight = right.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalizedLeft || normalizedLeft === ".") return normalizedRight;
  return `${normalizedLeft}/${normalizedRight}`;
}

function posixBasename(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function parseCompileCommands(body: string): CompileCommandEntry[] {
  try {
    const parsed = JSON.parse(body) as Array<{ file?: string; directory?: string }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => typeof entry.file === "string")
      .map((entry) => ({
        file: entry.file!.replace(/\\/g, "/"),
        directory: (entry.directory ?? ".").replace(/\\/g, "/"),
      }));
  } catch {
    return [];
  }
}

export function inferCppTestTargetBaseName(filePath: string) {
  const baseName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  return baseName
    .replace(/_test\.(?:c|cc|cpp)$/i, "")
    .replace(/Test\.(?:c|cc|cpp)$/i, "")
    .replace(/\.(?:c|cc|cpp|h|hpp)$/i, "");
}