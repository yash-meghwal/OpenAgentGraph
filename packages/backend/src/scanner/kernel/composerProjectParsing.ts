import path from "path";

export interface ComposerAutoloadMapping {
  prefix: string;
  directory: string;
  isDev: boolean;
  standard: "psr-4" | "psr-0";
}

export interface ComposerProjectMetadata {
  packageName?: string;
  dependencies: string[];
  devDependencies: string[];
  autoloadMappings: ComposerAutoloadMapping[];
}

function normalizeComposerPrefix(prefix: string) {
  const trimmed = prefix.trim().replace(/\\/g, "\\");
  if (!trimmed) return "";
  return trimmed.endsWith("\\") ? trimmed : `${trimmed}\\`;
}

function normalizeComposerDirectory(directory: string) {
  return directory.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function normalizeComposerDirectories(directory: unknown) {
  if (typeof directory === "string") {
    const normalized = normalizeComposerDirectory(directory);
    return normalized ? [normalized] : [];
  }
  if (!Array.isArray(directory)) return [] as string[];
  return directory
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => normalizeComposerDirectory(entry))
    .filter((entry) => entry.length > 0);
}

function collectAutoloadMappings(
  autoloadSection: unknown,
  isDev: boolean
): ComposerAutoloadMapping[] {
  if (!autoloadSection || typeof autoloadSection !== "object") return [];
  const mappings: ComposerAutoloadMapping[] = [];
  const record = autoloadSection as Record<string, unknown>;

  const psr4 = record["psr-4"];
  if (psr4 && typeof psr4 === "object") {
    for (const [prefix, directory] of Object.entries(psr4 as Record<string, unknown>)) {
      for (const normalizedDirectory of normalizeComposerDirectories(directory)) {
        mappings.push({
          prefix: normalizeComposerPrefix(prefix),
          directory: normalizedDirectory,
          isDev,
          standard: "psr-4",
        });
      }
    }
  }

  const psr0 = record["psr-0"];
  if (psr0 && typeof psr0 === "object") {
    for (const [prefix, directory] of Object.entries(psr0 as Record<string, unknown>)) {
      for (const normalizedDirectory of normalizeComposerDirectories(directory)) {
        mappings.push({
          prefix: normalizeComposerPrefix(prefix),
          directory: normalizedDirectory,
          isDev,
          standard: "psr-0",
        });
      }
    }
  }

  return mappings;
}

function collectDependencyNames(section: unknown) {
  if (!section || typeof section !== "object") return [] as string[];
  return Object.keys(section as Record<string, unknown>).sort((left, right) => left.localeCompare(right));
}

export function parseComposerProject(body: string): ComposerProjectMetadata | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const autoload = collectAutoloadMappings(parsed.autoload, false);
    const autoloadDev = collectAutoloadMappings(parsed["autoload-dev"], true);
    return {
      packageName: typeof parsed.name === "string" ? parsed.name : undefined,
      dependencies: collectDependencyNames(parsed.require),
      devDependencies: collectDependencyNames(parsed["require-dev"]),
      autoloadMappings: [...autoload, ...autoloadDev],
    };
  } catch {
    return undefined;
  }
}

export function psr4ClassToRelativePath(qualifiedName: string, mapping: ComposerAutoloadMapping) {
  const normalizedPrefix = normalizeComposerPrefix(mapping.prefix);
  if (!qualifiedName.startsWith(normalizedPrefix)) return undefined;
  const remainder = qualifiedName.slice(normalizedPrefix.length).replace(/\\/g, "/");
  if (!remainder) return undefined;
  const directory = mapping.directory;
  return directory ? path.posix.join(directory, `${remainder}.php`) : `${remainder}.php`;
}

export function psr0ClassToRelativePath(qualifiedName: string, mapping: ComposerAutoloadMapping) {
  const normalizedPrefix = normalizeComposerPrefix(mapping.prefix);
  if (!qualifiedName.startsWith(normalizedPrefix)) return undefined;
  const remainder = qualifiedName.slice(normalizedPrefix.length);
  if (!remainder) return undefined;
  const classPath = remainder.replace(/\\/g, "/").replace(/_/g, "/");
  const directory = mapping.directory;
  return directory ? path.posix.join(directory, `${classPath}.php`) : `${classPath}.php`;
}

export function resolveComposerClassPathCandidates(
  qualifiedName: string,
  mappings: ComposerAutoloadMapping[]
) {
  const sorted = [...mappings].sort((left, right) => right.prefix.length - left.prefix.length);
  const candidates: string[] = [];
  for (const mapping of sorted) {
    const resolver = mapping.standard === "psr-0" ? psr0ClassToRelativePath : psr4ClassToRelativePath;
    const candidate = resolver(qualifiedName, mapping);
    if (candidate) candidates.push(candidate.replace(/\\/g, "/"));
  }
  return candidates;
}

export function resolveComposerClassPath(
  qualifiedName: string,
  mappings: ComposerAutoloadMapping[],
  existingPaths?: ReadonlySet<string>
) {
  const candidates = resolveComposerClassPathCandidates(qualifiedName, mappings);
  if (existingPaths) {
    for (const candidate of candidates) {
      if (existingPaths.has(candidate)) return candidate;
    }
  }
  return candidates[0];
}