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

const BROKEN_DOC_DIAGNOSTIC_RE = /^Broken doc (link|anchor) in ([^:]+?)(?::(\d+))?:\s*(.+)$/;

function extractBrokenDocTarget(raw: string) {
  const trimmed = raw.trim();
  const markdown = trimmed.match(/^\[[^\]]+\]\(([^)]+)\)$/);
  if (markdown) return markdown[1]!.trim();
  const wikilink = trimmed.match(/^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/);
  if (wikilink) return wikilink[1]!.trim();
  return trimmed;
}

function classifyBrokenDocTarget(rawTarget: string, kind: "link" | "anchor"): DocLinkFailureReason {
  if (kind === "anchor") return "missing_anchor";
  const trimmed = rawTarget.trim();
  if (/^(?:https?:|mailto:)/i.test(trimmed)) return "unsupported_scheme";
  if (trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed)) return "outside_workspace";
  return "missing_file";
}

export function parseDocLinkDiagnostic(line: string): DocLinkDiagnostic | undefined {
  const match = line.match(BROKEN_DOC_DIAGNOSTIC_RE);
  if (!match) return undefined;
  const [, kind, sourcePath, lineText, rawTarget] = match;
  const target = extractBrokenDocTarget(rawTarget);
  const parsedLine = lineText ? Number.parseInt(lineText, 10) : undefined;
  return {
    sourcePath: sourcePath.trim(),
    line: Number.isFinite(parsedLine) ? parsedLine : undefined,
    rawTarget: target,
    reason: classifyBrokenDocTarget(target, kind as "link" | "anchor"),
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
