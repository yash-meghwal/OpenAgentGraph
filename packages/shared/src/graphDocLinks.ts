import type { UnifiedCodeGraph } from "./codeGraph.js";

export type DocLinkFailureReason =
  | "missing_file"
  | "missing_anchor"
  | "unsupported_scheme"
  | "outside_workspace";

export interface DocLinkDiagnostic {
  sourcePath: string;
  line?: number;
  rawTarget: string;
  reason: DocLinkFailureReason;
  severity: "warn" | "fail";
}

export interface ResolvedDocLinkTarget {
  fileTarget: string;
  anchor?: string;
  resolvedPath?: string;
  outsideWorkspace: boolean;
}

const BROKEN_DOC_DIAGNOSTIC_RE = /^Broken doc (link|anchor) in ([^:]+?)(?::(\d+))?:\s*(.+)$/;

export function extractBrokenDocTarget(raw: string) {
  const trimmed = raw.trim();
  const markdown = trimmed.match(/^\[[^\]]+\]\(([^)]+)\)$/);
  if (markdown) return markdown[1]!.trim();
  const wikilink = trimmed.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  if (wikilink) return wikilink[1]!.trim();
  return trimmed;
}

function isRootedDocTarget(fileTarget: string) {
  const trimmed = fileTarget.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true;
  if (trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("\\")) return true;
  if (trimmed.startsWith("/")) return true;
  return false;
}

export function splitDocLinkTarget(rawTarget: string) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("#")) {
    return { fileTarget: "", anchor: trimmed.slice(1) };
  }
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex >= 0) {
    return {
      fileTarget: trimmed.slice(0, hashIndex),
      anchor: trimmed.slice(hashIndex + 1),
    };
  }
  return { fileTarget: trimmed, anchor: undefined };
}

function normalizeWorkspacePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

function posixDirname(filePath: string) {
  const normalized = normalizeWorkspacePath(filePath);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function posixNormalize(value: string) {
  const segments = value.replace(/\\/g, "/").split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (stack.length > 0) stack.pop();
      else stack.push("..");
      continue;
    }
    stack.push(segment);
  }
  return stack.join("/");
}

function joinsWorkspaceRelativePath(sourceDir: string, fileTarget: string) {
  const cleaned = fileTarget.replace(/\\/g, "/").trim();
  if (!cleaned) return "";
  const joined = cleaned.startsWith("./")
    ? `${sourceDir ? `${sourceDir}/` : ""}${cleaned.slice(2)}`
    : sourceDir
      ? `${sourceDir}/${cleaned}`
      : cleaned;
  return posixNormalize(joined);
}

function pathEscapesWorkspace(normalizedPath: string) {
  return normalizedPath === ".." || normalizedPath.startsWith("../");
}

export function resolveRelativeDocTarget(sourceFilePath: string, rawTarget: string): ResolvedDocLinkTarget {
  const extracted = extractBrokenDocTarget(rawTarget);
  const { fileTarget, anchor } = splitDocLinkTarget(extracted);

  if (!fileTarget) {
    return { fileTarget: "", anchor, outsideWorkspace: false };
  }

  const trimmed = fileTarget.trim();
  if (/^(?:https?:|mailto:)/i.test(trimmed)) {
    return { fileTarget: trimmed, anchor, outsideWorkspace: false };
  }
  if (isRootedDocTarget(trimmed)) {
    return { fileTarget: trimmed, anchor, outsideWorkspace: true };
  }

  const sourceDir = posixDirname(sourceFilePath);
  const resolvedPath = joinsWorkspaceRelativePath(sourceDir, trimmed);
  const outsideWorkspace = pathEscapesWorkspace(resolvedPath);

  return {
    fileTarget: trimmed,
    anchor,
    resolvedPath: outsideWorkspace ? undefined : normalizeWorkspacePath(resolvedPath),
    outsideWorkspace,
  };
}

function classifyBrokenDocTarget(
  rawTarget: string,
  kind: "link" | "anchor",
  sourcePath: string
): DocLinkFailureReason {
  const target = extractBrokenDocTarget(rawTarget);
  if (kind === "anchor") {
    const resolution = resolveRelativeDocTarget(sourcePath, target);
    if (resolution.outsideWorkspace) return "outside_workspace";
    return "missing_anchor";
  }
  if (/^(?:https?:|mailto:)/i.test(target)) return "unsupported_scheme";
  const { fileTarget } = splitDocLinkTarget(target);
  if (isRootedDocTarget(fileTarget)) return "outside_workspace";
  if (resolveRelativeDocTarget(sourcePath, target).outsideWorkspace) return "outside_workspace";
  return "missing_file";
}

export function parseDocLinkDiagnostic(line: string): DocLinkDiagnostic | undefined {
  const match = line.match(BROKEN_DOC_DIAGNOSTIC_RE);
  if (!match) return undefined;
  const [, kind, sourcePath, lineText, rawTarget] = match;
  const target = extractBrokenDocTarget(rawTarget);
  const parsedLine = lineText ? Number.parseInt(lineText, 10) : undefined;
  const normalizedSourcePath = sourcePath.trim();
  return {
    sourcePath: normalizedSourcePath,
    line: Number.isFinite(parsedLine) ? parsedLine : undefined,
    rawTarget: target,
    reason: classifyBrokenDocTarget(rawTarget, kind as "link" | "anchor", normalizedSourcePath),
    severity: "warn",
  };
}

export function collectDocLinkDiagnostics(graph: UnifiedCodeGraph): DocLinkDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: DocLinkDiagnostic[] = [];
  for (const line of graph.diagnostics) {
    const parsed = parseDocLinkDiagnostic(line);
    if (!parsed) continue;
    const key = `${parsed.sourcePath}|${parsed.line ?? ""}|${parsed.rawTarget}|${parsed.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(parsed);
  }
  return diagnostics.sort((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath)
    || (left.line ?? 0) - (right.line ?? 0)
    || left.rawTarget.localeCompare(right.rawTarget)
  );
}

export function renderBrokenDocLinksMarkdown(diagnostics: DocLinkDiagnostic[]) {
  if (diagnostics.length === 0) {
    return ["## Broken documentation links", "", "- No broken doc links detected.", ""];
  }
  return [
    "## Broken documentation links",
    "",
    ...diagnostics.map((entry) => {
      const location = entry.line ? `\`${entry.sourcePath}:${entry.line}\`` : `\`${entry.sourcePath}\``;
      return `- ${location} — ${entry.reason.replace(/_/g, " ")}: \`${entry.rawTarget}\``;
    }),
    "",
  ];
}

export function summarizeDocLinkHygiene(graph: UnifiedCodeGraph) {
  const broken = collectDocLinkDiagnostics(graph);
  const byReason = broken.reduce<Record<DocLinkFailureReason, number>>((counts, entry) => {
    counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
    return counts;
  }, {
    missing_file: 0,
    missing_anchor: 0,
    unsupported_scheme: 0,
    outside_workspace: 0,
  });
  return {
    brokenCount: broken.length,
    byReason,
    diagnostics: broken,
    ok: broken.length === 0,
  };
}

export function evaluateDocLinkHygieneGate(input: {
  graph: UnifiedCodeGraph;
  fixture?: string;
  expectBrokenLinks?: boolean;
}) {
  const summary = summarizeDocLinkHygiene(input.graph);
  const errors: string[] = [];
  if (input.expectBrokenLinks && summary.brokenCount === 0) {
    errors.push("Expected broken doc-link diagnostics but none were emitted.");
  }
  if (input.fixture === "fixture-docs-broken-links" && summary.brokenCount < 2) {
    errors.push(`Expected at least 2 broken doc links in fixture-docs-broken-links, got ${summary.brokenCount}.`);
  }
  if (!input.expectBrokenLinks && summary.brokenCount > 0) {
    errors.push(`Unexpected broken doc links: ${summary.brokenCount}.`);
  }
  for (const entry of summary.diagnostics) {
    if (!entry.sourcePath) {
      errors.push("Broken doc-link diagnostic is missing source path.");
    }
  }
  return {
    ...summary,
    ok: errors.length === 0,
    errors,
  };
}
