import { sanitizeOperationalText } from "./safeText.js";

export interface GraphLearnFinding {
  code: string;
  title: string;
  evidence: string[];
  proposals: Array<{
    target: "AGENTS.md" | "LLMS.md" | "README.md" | "benchmark-fixture" | "scanner-task";
    suggestion: string;
  }>;
}

export interface GraphLearnProposalResult {
  generatedAt: string;
  findingCount: number;
  findings: GraphLearnFinding[];
  markdown: string;
}

const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)_[A-Za-z0-9]{10,}\b/,
  /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i,
];

const FINDING_RULES: Array<{
  code: string;
  title: string;
  pattern: RegExp;
  proposals: GraphLearnFinding["proposals"];
}> = [
  {
    code: "wrong_file_first",
    title: "Agent opened the wrong file first",
    pattern: /(?:ENOENT|cannot find|file not found|no such file)/i,
    proposals: [
      { target: "AGENTS.md", suggestion: "Read GRAPH_REPORT.md and run graph:context before opening source files." },
      { target: "LLMS.md", suggestion: "Prefer .oag/graph.json read-first nodes over broad repo search." },
    ],
  },
  {
    code: "missing_setup",
    title: "Missing setup or install command",
    pattern: /(?:npm ERR!|command not found|MODULE_NOT_FOUND|Cannot find module)/i,
    proposals: [
      { target: "README.md", suggestion: "Add npm ci and graph:export to the 60-second demo section." },
      { target: "AGENTS.md", suggestion: "Run npm ci before graph commands on a fresh clone." },
    ],
  },
  {
    code: "ignored_support_tier",
    title: "Support tier warning ignored",
    pattern: /(?:T2|T3|file-level only|structural only|semantic-lite)/i,
    proposals: [
      { target: "AGENTS.md", suggestion: "Inspect source directly when ecosystem support is T2/T3." },
      { target: "LLMS.md", suggestion: "Document support tier meaning and when to distrust semantic edges." },
    ],
  },
  {
    code: "stale_graph",
    title: "Stale .oag/graph.json or handoff",
    pattern: /(?:stale|outdated|graph\.json.*missing|no_graph_export)/i,
    proposals: [
      { target: "AGENTS.md", suggestion: "Run graph:export or graph:update when graph freshness warnings appear." },
      { target: "README.md", suggestion: "Mention graph:update in the quick-start workflow." },
    ],
  },
  {
    code: "missing_analyzer",
    title: "Optional analyzer unavailable",
    pattern: /(?:roslyn|analyzer.*unavailable|dotnet.*not found|fallback)/i,
    proposals: [
      { target: "README.md", suggestion: "Clarify optional .NET SDK requirement for Roslyn semantic edges." },
      { target: "scanner-task", suggestion: "Improve analyzer fallback messaging in graph:check output." },
    ],
  },
  {
    code: "bad_path_query",
    title: "Path or query returned no useful results",
    pattern: /(?:No matching seed|graph_query_complete.*seeds.: \[\]|path.*not found)/i,
    proposals: [
      { target: "benchmark-fixture", suggestion: "Add a fixture query/path case for this workspace shape." },
      { target: "AGENTS.md", suggestion: "Try graph:explain on a known symbol before graph:path." },
    ],
  },
];

function sanitizeLogLine(line: string, workspaceRoot?: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (SECRET_PATTERNS.some((pattern) => pattern.test(trimmed))) return null;
  return sanitizeOperationalText(trimmed, { workspaceRoot, maxLength: 240 });
}

export function analyzeGraphLearnLog(
  logText: string,
  options: { workspaceRoot?: string; maxEvidenceLines?: number } = {}
): GraphLearnProposalResult {
  const lines = logText.split(/\r?\n/);
  const sanitizedLines = lines
    .map((line) => sanitizeLogLine(line, options.workspaceRoot))
    .filter((line): line is string => Boolean(line));

  const findings: GraphLearnFinding[] = [];
  const maxEvidence = options.maxEvidenceLines ?? 4;

  for (const rule of FINDING_RULES) {
    const evidence = sanitizedLines.filter((line) => rule.pattern.test(line)).slice(0, maxEvidence);
    if (evidence.length === 0) continue;
    findings.push({
      code: rule.code,
      title: rule.title,
      evidence,
      proposals: rule.proposals,
    });
  }

  const markdown = renderGraphLearnProposalMarkdown(findings);
  return {
    generatedAt: new Date().toISOString(),
    findingCount: findings.length,
    findings,
    markdown,
  };
}

export function renderGraphLearnProposalMarkdown(findings: GraphLearnFinding[]): string {
  const lines = [
    "# OAG Learn Proposal",
    "",
    "Review-only proposals. OAG does not auto-edit AGENTS.md, README, LLMS.md, or source files.",
    "",
  ];

  if (findings.length === 0) {
    lines.push("No recurring failure patterns detected in the supplied log.", "");
    return `${lines.join("\n")}\n`;
  }

  for (const finding of findings) {
    lines.push(`## ${finding.title}`, "");
    lines.push(`Code: \`${finding.code}\``, "");
    lines.push("### Evidence", "");
    for (const line of finding.evidence) {
      lines.push(`- ${line}`);
    }
    lines.push("", "### Proposals", "");
    for (const proposal of finding.proposals) {
      lines.push(`- **${proposal.target}**: ${proposal.suggestion}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}