import { isGraphPathFileExtension } from "./sourceExtensions.js";

export interface GraphPathSeedNode {
  id: string;
  kind: string;
  label: string;
  path?: string;
  scannerId?: string;
  projectType?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface GraphPathSeedScore {
  score: number;
  matchReason: string;
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function tokenizeGraphPathSeedQuery(query: string) {
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

export function scoreGraphPathSeedNodeForQuery(node: GraphPathSeedNode, tokens: string[]) {
  if (tokens.length === 0) return 0;
  const haystack = normalizeSearchText(
    [
      node.id,
      node.kind,
      node.label,
      node.path ?? "",
      node.scannerId ?? "",
      node.projectType ?? "",
      ...Object.values(node.metadata ?? {}).map((value) => String(value)),
    ].join(" ")
  );
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length;
  }
  return score;
}

function pathBasename(value: string) {
  return value.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
}

function normalizePathQuery(query: string) {
  return query.trim().replace(/\\/g, "/").toLowerCase();
}

function isSimpleIdentifierQuery(query: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(query.trim());
}

function symbolClassName(label: string) {
  const head = label.split("(")[0]?.trim() ?? label;
  const simple = head.split(".").pop() ?? head;
  return normalizeSearchText(simple);
}

function symbolNamespaceTail(label: string) {
  if (!/\(namespace\)/i.test(label)) return undefined;
  return normalizeSearchText(label.split("(")[0]?.trim() ?? label);
}

function looksLikeFileQuery(normalizedPathQuery: string) {
  const extension = pathBasename(normalizedPathQuery).split(".").pop()?.toLowerCase() ?? "";
  return extension.length >= 2 && isGraphPathFileExtension(extension);
}

function fileQueryStemTokens(normalizedPathQuery: string) {
  const queryBasename = pathBasename(normalizedPathQuery);
  const stem = queryBasename.replace(/\.[^.]+$/, "");
  return tokenizeGraphPathSeedQuery(stem);
}

function hasFileQueryPathAlignment(
  normalizedPath: string,
  basename: string,
  normalizedPathQuery: string
) {
  if (normalizedPath === normalizedPathQuery) return true;
  if (basename && basename === normalizedPathQuery) return true;
  if (normalizedPath.endsWith(`/${normalizedPathQuery}`)) return true;
  const stemTokens = fileQueryStemTokens(normalizedPathQuery);
  return stemTokens.length > 0 && stemTokens.every((token) =>
    basename.includes(token) || normalizedPath.includes(token)
  );
}

export function scoreGraphNodeForPathResolution(
  node: GraphPathSeedNode,
  query: string,
  tokens: string[]
): GraphPathSeedScore {
  const normalizedPathQuery = normalizePathQuery(query);
  const fileQuery = looksLikeFileQuery(normalizedPathQuery);
  const resolutionTokens = fileQuery ? fileQueryStemTokens(normalizedPathQuery) : tokens;
  const normalizedQuery = normalizeSearchText(query);
  const normalizedPath = (node.path ?? "").replace(/\\/g, "/").toLowerCase();
  const normalizedLabel = normalizeSearchText(node.label);
  const basename = pathBasename(node.path ?? node.label);
  let score = scoreGraphPathSeedNodeForQuery(node, resolutionTokens);
  let matchReason = score > 0 ? "token overlap" : "no match";
  let hasPathMatch = false;

  if (node.id.toLowerCase() === query.trim().toLowerCase()) {
    return { score: 10_000, matchReason: "exact node id" };
  }
  if (normalizedPath === normalizedPathQuery) {
    return { score: 9_000, matchReason: "exact path" };
  }
  if (basename && basename === normalizedPathQuery) {
    score += 2_000;
    matchReason = "path basename";
    hasPathMatch = true;
  } else if (normalizedPath.endsWith(`/${normalizedPathQuery}`)) {
    score += 1_500;
    matchReason = "path suffix";
    hasPathMatch = true;
  }
  if (node.label.toLowerCase() === normalizedPathQuery) {
    score += 1_200;
    matchReason = "exact label";
    hasPathMatch = true;
  } else if (node.label.toLowerCase().startsWith(`${normalizedPathQuery} `)) {
    score += 1_000;
    matchReason = "label prefix";
    hasPathMatch = true;
  }

  if (fileQuery) {
    const pathAligned = hasPathMatch || hasFileQueryPathAlignment(normalizedPath, basename, normalizedPathQuery);
    if (node.kind === "code_file") {
      if (!pathAligned) {
        score = 0;
        matchReason = "no match";
      } else if (!hasPathMatch && score > 0) {
        matchReason = "filename token";
      }
    } else if (!pathAligned) {
      score = 0;
      matchReason = "no match";
    }
  }
  if (node.kind === "symbol") {
    if (/\(namespace\)/i.test(node.label)) {
      score -= 2_500;
      if (isSimpleIdentifierQuery(query)) {
        const namespaceTail = symbolNamespaceTail(node.label);
        if (namespaceTail !== normalizedQuery) {
          score = Math.min(score, 0);
          matchReason = "namespace penalty";
        }
      }
    }
    if (node.label.includes("(class)")) {
      const className = symbolClassName(node.label);
      if (className === normalizedQuery) {
        score += 3_200;
        matchReason = "class name exact";
      } else if (normalizedLabel.startsWith(`${normalizedQuery} `)) {
        score += 900;
        matchReason = "class symbol";
      }
    }
    if (/\(function\)|\(method\)/i.test(node.label) && fileQuery) {
      score -= 1_800;
      if (score > 0) matchReason = "inner callable";
    }
    if (/\(field\)|\(method\)|\(property\)|\.|_/i.test(node.label) && !/[._]/.test(query)) {
      score -= 250;
    }
  }
  if (node.kind === "code_file" && fileQuery) {
    const pathAligned = hasPathMatch || hasFileQueryPathAlignment(normalizedPath, basename, normalizedPathQuery);
    if (pathAligned) {
      score += 4_500;
      matchReason = "code file path";
    }
  }
  if (isSimpleIdentifierQuery(query) && node.kind === "code_file") {
    const stem = pathBasename(node.path ?? node.label).replace(/\.[^.]+$/, "");
    if (normalizeSearchText(stem) !== normalizedQuery) {
      score -= 400;
    }
  }
  if (node.kind === "doc_section") {
    const sectionLabel = normalizeSearchText(node.label.replace(/\s*\(doc_section\)\s*$/i, ""));
    for (const token of tokens) {
      if (sectionLabel.includes(token)) {
        score += token.length * 4;
        matchReason = "doc section";
      }
    }
    if (node.path && normalizePathQuery(node.path).includes(normalizedPathQuery)) {
      score += 300;
    }
  }
  if (node.kind === "doc_file" && !fileQuery) {
    const stem = pathBasename(node.path ?? node.label).replace(/\.[^.]+$/, "");
    if (tokens.some((token) => normalizeSearchText(stem).includes(token))) {
      score += 250;
      matchReason = "doc file";
    }
  }
  if (node.kind === "workspace" || (node.kind === "project" && (node.label === "workspace-root" || node.path === "."))) {
    score -= 500;
  }

  return { score, matchReason };
}

export function rankGraphPathSeedCandidates<T extends GraphPathSeedNode>(nodes: T[], target: string, limit = 5) {
  const tokens = tokenizeGraphPathSeedQuery(target);
  return [...nodes]
    .map((node) => {
      const scored = scoreGraphNodeForPathResolution(node, target, tokens);
      return { node, ...scored };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.node.label.localeCompare(right.node.label))
    .slice(0, limit);
}

export function resolveGraphPathSeedNode<T extends GraphPathSeedNode>(nodes: T[], target: string) {
  return rankGraphPathSeedCandidates(nodes, target, 1)[0]?.node;
}

/**
 * Browser-side path seed resolver embedded in graph-explorer.html.
 * Keep in sync with scoreGraphNodeForPathResolution above.
 */
export function buildGraphPathSeedResolverBrowserScript(fileQueryExtensions: readonly string[]): string {
  const extensionsJson = JSON.stringify([...fileQueryExtensions]);
  return `
  // Path seed resolver mirrors graphPathSeedResolution.ts (same rules as graph:path CLI).
  const PATH_FILE_EXTENSIONS = new Set(${extensionsJson});

  function pathBasename(value) {
    return String(value || "").replace(/\\\\/g, "/").split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
  }

  function normalizePathQuery(query) {
    return String(query || "").trim().replace(/\\\\/g, "/").toLowerCase();
  }

  function isSimpleIdentifierQuery(query) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(query || "").trim());
  }

  function symbolClassName(label) {
    const head = String(label || "").split("(")[0]?.trim() ?? label;
    const simple = head.split(".").pop() ?? head;
    return normalize(simple);
  }

  function symbolNamespaceTail(label) {
    if (!/\\(namespace\\)/i.test(label)) return undefined;
    return normalize(String(label || "").split("(")[0]?.trim() ?? label);
  }

  function looksLikeFileQuery(normalizedPathQuery) {
    const extension = pathBasename(normalizedPathQuery).split(".").pop()?.toLowerCase() ?? "";
    return extension.length >= 2 && PATH_FILE_EXTENSIONS.has(extension);
  }

  function tokenizePathSeedQuery(query) {
    return normalize(query).split(/\\s+/).filter((token) => token.length > 1);
  }

  function fileQueryStemTokens(normalizedPathQuery) {
    const queryBasename = pathBasename(normalizedPathQuery);
    const stem = queryBasename.replace(/\\.[^.]+$/, "");
    return tokenizePathSeedQuery(stem);
  }

  function hasFileQueryPathAlignment(normalizedPath, basename, normalizedPathQuery) {
    if (normalizedPath === normalizedPathQuery) return true;
    if (basename && basename === normalizedPathQuery) return true;
    if (normalizedPath.endsWith("/" + normalizedPathQuery)) return true;
    const stemTokens = fileQueryStemTokens(normalizedPathQuery);
    return stemTokens.length > 0 && stemTokens.every((token) =>
      basename.includes(token) || normalizedPath.includes(token)
    );
  }

  function scorePathSeedNodeForQuery(node, tokens) {
    if (tokens.length === 0) return 0;
    const haystack = normalize([node.id, node.kind, node.label, node.path || ""].join(" "));
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score += token.length;
    }
    return score;
  }

  function scorePathSeedNode(node, query, tokens) {
    const normalizedPathQuery = normalizePathQuery(query);
    const fileQuery = looksLikeFileQuery(normalizedPathQuery);
    const resolutionTokens = fileQuery ? fileQueryStemTokens(normalizedPathQuery) : tokens;
    const normalizedQuery = normalize(query);
    const normalizedPath = String(node.path || "").replace(/\\\\/g, "/").toLowerCase();
    const normalizedLabel = normalize(node.label);
    const basename = pathBasename(node.path || node.label);
    let score = scorePathSeedNodeForQuery(node, resolutionTokens);
    let hasPathMatch = false;

    if (String(node.id || "").toLowerCase() === String(query || "").trim().toLowerCase()) {
      return 10000;
    }
    if (normalizedPath === normalizedPathQuery) {
      return 9000;
    }
    if (basename && basename === normalizedPathQuery) {
      score += 2000;
      hasPathMatch = true;
    } else if (normalizedPath.endsWith("/" + normalizedPathQuery)) {
      score += 1500;
      hasPathMatch = true;
    }
    if (String(node.label || "").toLowerCase() === normalizedPathQuery) {
      score += 1200;
      hasPathMatch = true;
    } else if (String(node.label || "").toLowerCase().startsWith(normalizedPathQuery + " ")) {
      score += 1000;
      hasPathMatch = true;
    }

    if (fileQuery) {
      const pathAligned = hasPathMatch || hasFileQueryPathAlignment(normalizedPath, basename, normalizedPathQuery);
      if (node.kind === "code_file") {
        if (!pathAligned) score = 0;
      } else if (!pathAligned) {
        score = 0;
      }
    }
    if (node.kind === "symbol") {
      if (/\\(namespace\\)/i.test(node.label)) {
        score -= 2500;
        if (isSimpleIdentifierQuery(query)) {
          const namespaceTail = symbolNamespaceTail(node.label);
          if (namespaceTail !== normalizedQuery) {
            score = Math.min(score, 0);
          }
        }
      }
      if (String(node.label || "").includes("(class)")) {
        const className = symbolClassName(node.label);
        if (className === normalizedQuery) {
          score += 3200;
        } else if (normalizedLabel.startsWith(normalizedQuery + " ")) {
          score += 900;
        }
      }
      if (/\\(function\\)|\\(method\\)/i.test(node.label) && fileQuery) {
        score -= 1800;
      }
      if (/\\(field\\)|\\(method\\)|\\(property\\)|\\.|_/i.test(node.label) && !/[._]/.test(query)) {
        score -= 250;
      }
    }
    if (node.kind === "code_file" && fileQuery) {
      const pathAligned = hasPathMatch || hasFileQueryPathAlignment(normalizedPath, basename, normalizedPathQuery);
      if (pathAligned) score += 4500;
    }
    if (isSimpleIdentifierQuery(query) && node.kind === "code_file") {
      const stem = pathBasename(node.path || node.label).replace(/\\.[^.]+$/, "");
      if (normalize(stem) !== normalizedQuery) {
        score -= 400;
      }
    }
    if (node.kind === "doc_section") {
      const sectionLabel = normalize(String(node.label || "").replace(/\\s*\\(doc_section\\)\\s*$/i, ""));
      for (const token of tokens) {
        if (sectionLabel.includes(token)) score += token.length * 4;
      }
      if (node.path && normalizePathQuery(node.path).includes(normalizedPathQuery)) {
        score += 300;
      }
    }
    if (node.kind === "doc_file" && !fileQuery) {
      const stem = pathBasename(node.path || node.label).replace(/\\.[^.]+$/, "");
      if (tokens.some((token) => normalize(stem).includes(token))) {
        score += 250;
      }
    }
    if (node.kind === "workspace" || (node.kind === "project" && (node.label === "workspace-root" || node.path === "."))) {
      score -= 500;
    }
    return score;
  }

  function resolveNode(query) {
    const tokens = tokenizePathSeedQuery(query);
    const ranked = data.nodes
      .map((node) => ({ node, score: scorePathSeedNode(node, query, tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.node.label.localeCompare(right.node.label));
    return ranked[0]?.node;
  }
`;
}