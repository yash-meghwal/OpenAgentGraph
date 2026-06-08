const WINDOWS_ABSOLUTE_PATH =
  /\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+\b/g;
const WINDOWS_TEMP_PATH =
  /\b[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+\b/gi;
const POSIX_ABSOLUTE_PATH =
  /\/(?:Users|home|tmp|private\/tmp|var\/folders|opt|srv|workspace|app|data)(?:\/[^\s"'<>]+)+/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g;
const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|KEY))\s*[:=]\s*([^\s,;]+)/gi;
const SECRET_VALUE_PATTERN = /\b(?:sk|pk|rk)_[A-Za-z0-9]{10,}\b/g;

function normalizeForComparison(value: string | undefined): string {
  return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function lastPathSegments(value: string, count = 2): string[] {
  return value
    .split(/[\\/]+/)
    .filter(Boolean)
    .slice(-count);
}

function sanitizePathMatch(match: string, workspaceRoot?: string): string {
  const normalizedMatch = normalizeForComparison(match);
  const normalizedWorkspace = normalizeForComparison(workspaceRoot);

  if (normalizedWorkspace && normalizedMatch.startsWith(normalizedWorkspace)) {
    const suffix = match.slice(workspaceRoot!.length).replace(/^[/\\]+/, "");
    return suffix ? `<workspace>/${suffix.replace(/\\/g, "/")}` : "<workspace>";
  }

  if (
    /appdata\\local\\temp/i.test(match) ||
    /\\temp\\/i.test(match.replace(/\//g, "\\")) ||
    /^\/(?:tmp|private\/tmp|var\/folders)\//i.test(match)
  ) {
    return `<temp>/${lastPathSegments(match).join("/")}`;
  }

  if (
    /^[A-Za-z]:\\Users\\[^\\]+/i.test(match) ||
    /^\/Users\/[^/]+/i.test(match) ||
    /^\/home\/[^/]+/i.test(match)
  ) {
    return `<home>/${lastPathSegments(match).join("/")}`;
  }

  return `<path>/${lastPathSegments(match, 1).join("/")}`;
}

export function sanitizeOperationalText(
  value: string,
  options?: {
    workspaceRoot?: string;
    maxLength?: number;
  }
): string {
  let sanitized = value;
  sanitized = sanitized.replace(BEARER_TOKEN_PATTERN, "Bearer <redacted-token>");
  sanitized = sanitized.replace(JWT_PATTERN, "<redacted-token>");
  sanitized = sanitized.replace(SECRET_ASSIGNMENT_PATTERN, "$1=<redacted-secret>");
  sanitized = sanitized.replace(SECRET_VALUE_PATTERN, "<redacted-secret>");
  sanitized = sanitized.replace(WINDOWS_TEMP_PATH, (match) =>
    sanitizePathMatch(match, options?.workspaceRoot)
  );
  sanitized = sanitized.replace(WINDOWS_ABSOLUTE_PATH, (match) =>
    sanitizePathMatch(match, options?.workspaceRoot)
  );
  sanitized = sanitized.replace(POSIX_ABSOLUTE_PATH, (match) =>
    sanitizePathMatch(match, options?.workspaceRoot)
  );
  sanitized = compactWhitespace(sanitized);

  if (options?.maxLength && sanitized.length > options.maxLength) {
    return `${sanitized.slice(0, options.maxLength - 1)}…`;
  }

  return sanitized;
}

export function toPlainEnglishFailureSummary(
  value: string | undefined,
  fallback = "This step didn't complete as expected. The system is deciding what to do next."
): string {
  const sanitized = value ? sanitizeOperationalText(value, { maxLength: 220 }) : "";
  const lower = sanitized.toLowerCase();

  if (!sanitized) return fallback;
  if (
    (lower.includes("session") || lower.includes("token") || lower.includes("jwt")) &&
    lower.includes("expired")
  ) {
    return "Your session has expired. Add a new token to continue.";
  }
  if (
    lower.includes("session") ||
    lower.includes("token") ||
    lower.includes("jwt") ||
    lower.includes("bearer")
  ) {
    return "Your session is not valid for this action.";
  }
  if (
    lower.includes("enoent") ||
    lower.includes("no such file") ||
    lower.includes("cannot find") ||
    lower.includes("missing file")
  ) {
    return "A required file could not be found in the workspace.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "A tool took too long and did not finish in time.";
  }
  if (
    lower.includes("permission denied") ||
    lower.includes("eacces") ||
    lower.includes("eperm")
  ) {
    return "A required file or command could not be accessed.";
  }
  if (
    lower.includes("command failed") ||
    lower.includes("tool execution failed") ||
    lower.includes("non-passing") ||
    lower.includes("exit code") ||
    lower.includes("stderr") ||
    lower.includes("spawn ")
  ) {
    return "A tool ran but did not complete successfully.";
  }
  if (lower.includes("escapes workspace root")) {
    return "A tool tried to work outside the allowed workspace.";
  }
  if (
    lower.includes("backend could not be reached") ||
    lower.includes("econnrefused") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror")
  ) {
    return "The OpenAgentGraph backend could not be reached.";
  }

  return sanitized || fallback;
}

export function toPlainEnglishSummary(
  value: string | undefined,
  fallback: string
): string {
  const sanitized = value ? sanitizeOperationalText(value, { maxLength: 220 }) : "";
  return sanitized || fallback;
}
