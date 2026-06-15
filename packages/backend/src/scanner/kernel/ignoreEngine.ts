import fs from "fs/promises";
import path from "path";
import type { IgnoreRule, SkipDiagnostic, SkipReason } from "@openagentgraph/shared";
import { BASE_SKIPPED_DIRECTORIES, normalizeScannerProjectPath } from "../scannerHygiene.js";

export const IGNORE_ENGINE_VERSION = "1.1";

const IGNORE_FILE_SPECS = [
  { fileName: ".gitignore", source: "gitignore" as const },
  { fileName: ".dockerignore", source: "dockerignore" as const },
  { fileName: ".oagignore", source: "oagignore" as const },
] as const;

export type CompiledIgnorePattern = {
  source: IgnoreRule["source"];
  raw: string;
  rootRelativePath: string;
  scopeDirectory: string;
  regex: RegExp;
  relativeRegex: RegExp;
  directoriesOnly: boolean;
  negated: boolean;
  anchored: boolean;
};

export type SkipDecision = {
  reason: SkipReason;
  detail: string;
  pattern?: string;
};

function escapeRegex(value: string) {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function wildcardToRegex(pattern: string) {
  return pattern
    .split("**")
    .map((segment) => escapeRegex(segment).replace(/\\\*/g, "[^/]*").replace(/\\\?/g, "[^/]"))
    .join(".*");
}

function compileIgnorePattern(input: {
  source: IgnoreRule["source"];
  rawLine: string;
  rootRelativePath: string;
  scopeDirectory?: string;
}): CompiledIgnorePattern | undefined {
  let line = input.rawLine.trim();
  if (!line || line.startsWith("#")) return undefined;

  let negated = false;
  if (line.startsWith("!")) {
    negated = true;
    line = line.slice(1).trim();
    if (!line) return undefined;
  }

  let directoriesOnly = false;
  if (line.endsWith("/")) {
    directoriesOnly = true;
    line = line.slice(0, -1);
  }

  const anchored = line.startsWith("/");
  if (anchored) line = line.slice(1);

  const regexBody = wildcardToRegex(line);
  const regex = anchored
    ? new RegExp(`^${regexBody}(?:$|/)`)
    : new RegExp(`(?:^|/)${regexBody}(?:$|/)`);
  const relativeRegex = anchored
    ? new RegExp(`^${regexBody}(?:$|/)`)
    : new RegExp(`(?:^|/)${regexBody}(?:$|/)`);

  return {
    source: input.source,
    raw: input.rawLine.trim(),
    rootRelativePath: input.rootRelativePath,
    scopeDirectory: input.scopeDirectory ?? ".",
    regex,
    relativeRegex,
    directoriesOnly,
    negated,
    anchored,
  };
}

export function parseIgnoreFileContent(input: {
  source: IgnoreRule["source"];
  content: string;
  rootRelativePath: string;
  scopeDirectory?: string;
}): { rules: IgnoreRule[]; patterns: CompiledIgnorePattern[] } {
  const rules: IgnoreRule[] = [];
  const patterns: CompiledIgnorePattern[] = [];
  for (const rawLine of input.content.split(/\r?\n/)) {
    const compiled = compileIgnorePattern({
      source: input.source,
      rawLine,
      rootRelativePath: input.rootRelativePath,
      scopeDirectory: input.scopeDirectory,
    });
    if (!compiled) continue;
    rules.push({
      source: input.source,
      pattern: compiled.raw,
      rootRelativePath: input.rootRelativePath,
    });
    patterns.push(compiled);
  }
  return { rules, patterns };
}

function globalRules(): IgnoreRule[] {
  return BASE_SKIPPED_DIRECTORIES.map((directory) => ({
    source: "global",
    pattern: `${directory}/`,
    rootRelativePath: ".",
  }));
}

function matchesGlobalDirectory(segment: string) {
  return BASE_SKIPPED_DIRECTORIES.includes(segment as (typeof BASE_SKIPPED_DIRECTORIES)[number]);
}

function pathRelativeToScope(normalizedPath: string, scopeDirectory: string) {
  if (scopeDirectory === ".") return normalizedPath;
  if (normalizedPath === scopeDirectory) return "";
  if (normalizedPath.startsWith(`${scopeDirectory}/`)) {
    return normalizedPath.slice(scopeDirectory.length + 1);
  }
  return null;
}

export function patternMatchesScopedPath(
  pattern: CompiledIgnorePattern,
  normalizedPath: string,
  isDirectory: boolean
) {
  const relativePath = pathRelativeToScope(normalizedPath, pattern.scopeDirectory);
  if (relativePath === null) return false;

  if (pattern.directoriesOnly) {
    const directoryPattern = pattern.raw
      .replace(/^!/, "")
      .trim()
      .replace(/\/$/, "")
      .replace(/^\//, "");
    if (pattern.anchored) {
      return relativePath === directoryPattern || relativePath.startsWith(`${directoryPattern}/`);
    }
    return (
      relativePath === directoryPattern
      || relativePath.startsWith(`${directoryPattern}/`)
      || relativePath.includes(`/${directoryPattern}/`)
      || relativePath.endsWith(`/${directoryPattern}`)
    );
  }

  if (!relativePath) return isDirectory && pattern.relativeRegex.test("");
  return pattern.relativeRegex.test(relativePath);
}

function globalSegmentDecision(normalizedPath: string): SkipDecision | null {
  const segments = normalizedPath.split("/").filter(Boolean);
  for (const segment of segments) {
    if (matchesGlobalDirectory(segment)) {
      return {
        reason: "global",
        detail: `Skipped because '${segment}' is an OAG global generated/cache directory. Gitignore negation cannot override global skips.`,
        pattern: segment,
      };
    }
  }
  return null;
}

export class IgnoreEngine {
  readonly version = IGNORE_ENGINE_VERSION;
  readonly rules: IgnoreRule[];
  private readonly patterns: CompiledIgnorePattern[];
  private readonly loadedIgnoreDirectories = new Set<string>();

  constructor(input: { rules: IgnoreRule[]; patterns: CompiledIgnorePattern[] }) {
    this.rules = input.rules;
    this.patterns = input.patterns;
  }

  static async load(workspaceRoot: string): Promise<IgnoreEngine> {
    const engine = new IgnoreEngine({ rules: [...globalRules()], patterns: [] });
    await engine.enterDirectory(".", path.resolve(workspaceRoot));
    return engine;
  }

  async enterDirectory(projectDirectory: string, absoluteDirectory: string): Promise<void> {
    const normalizedDir = projectDirectory === "." ? "." : normalizeScannerProjectPath(projectDirectory);
    if (this.loadedIgnoreDirectories.has(normalizedDir)) return;
    this.loadedIgnoreDirectories.add(normalizedDir);

    for (const spec of IGNORE_FILE_SPECS) {
      const absolutePath = path.join(absoluteDirectory, spec.fileName);
      try {
        const content = await fs.readFile(absolutePath, "utf8");
        const rootRelativePath = normalizedDir === "."
          ? spec.fileName
          : `${normalizedDir}/${spec.fileName}`;
        const parsed = parseIgnoreFileContent({
          source: spec.source,
          content,
          rootRelativePath,
          scopeDirectory: normalizedDir,
        });
        this.rules.push(...parsed.rules);
        this.patterns.push(...parsed.patterns);
      } catch {
        // Optional ignore files are allowed to be missing.
      }
    }
  }

  shouldSkip(projectPath: string, isDirectory: boolean): SkipDecision | null {
    const normalized = normalizeScannerProjectPath(projectPath);
    if (!normalized || normalized === ".") return null;

    const globalDecision = globalSegmentDecision(normalized);
    if (globalDecision) return globalDecision;

    let ignored = false;
    let lastMatch: SkipDecision | null = null;
    for (const pattern of this.patterns) {
      if (!patternMatchesScopedPath(pattern, normalized, isDirectory)) continue;
      if (pattern.negated) {
        ignored = false;
        lastMatch = null;
        continue;
      }
      ignored = true;
      lastMatch = {
        reason: pattern.source,
        detail: `Skipped by ${pattern.source} rule '${pattern.raw}' from ${pattern.rootRelativePath}.`,
        pattern: pattern.raw,
      };
    }

    return ignored ? lastMatch : null;
  }

  recordSkip(
    counts: Map<SkipReason, number>,
    diagnostics: SkipDiagnostic[],
    input: { path: string; decision: SkipDecision; maxDiagnostics?: number }
  ) {
    counts.set(input.decision.reason, (counts.get(input.decision.reason) ?? 0) + 1);
    const limit = input.maxDiagnostics ?? 20;
    if (diagnostics.length < limit) {
      diagnostics.push({
        path: input.path,
        reason: input.decision.reason,
        detail: input.decision.detail,
      });
    }
  }

  skippedCountsRecord(counts: Map<SkipReason, number>) {
    return Object.fromEntries(
      [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]))
    ) as Partial<Record<SkipReason, number>>;
  }

  diagnosticsSummary(counts: Map<SkipReason, number>) {
    const parts = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([reason, count]) => `${reason}=${count}`);
    return parts.length > 0 ? `Skipped paths by reason: ${parts.join(", ")}.` : "No skipped paths recorded.";
  }
}

export async function createIgnoreEngine(workspaceRoot: string) {
  return IgnoreEngine.load(workspaceRoot);
}