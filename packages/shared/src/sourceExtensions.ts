/**
 * Canonical source-extension lists shared by the scanner kernel and graph path
 * query resolution. Add new ecosystem extensions here once.
 */

export const TYPESCRIPT_SCANNABLE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
] as const;

export const DOTNET_SOURCE_EXTENSIONS = [".cs", ".xaml"] as const;
export const DOTNET_CONFIG_EXTENSIONS = [".csproj", ".sln", ".props", ".targets"] as const;

export const ECOSYSTEM_SCANNABLE_EXTENSIONS = [
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".rb",
  ".rake",
  ".php",
  ".phtml",
  ".swift",
  ".dart",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".tf",
  ".tfvars",
  ".md",
  ".rst",
  ".gd",
  ".tscn",
  ".tres",
  ".unity",
  ".prefab",
] as const;

export const SCRIPT_SCANNABLE_EXTENSIONS = [".ps1", ".sh", ".bash"] as const;

export const UNSUPPORTED_SOURCE_EXTENSIONS = [
  ".scala",
  ".fs",
  ".vb",
] as const;

/** Filename suffixes users may query in graph:path beyond kernel scanner lists. */
export const GRAPH_PATH_EXTRA_FILE_EXTENSIONS = [
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".sql",
  ".vue",
  ".svelte",
] as const;

export const PRODUCT_GRAPH_SCANNABLE_EXTENSIONS = [
  ...TYPESCRIPT_SCANNABLE_EXTENSIONS,
  ...DOTNET_SOURCE_EXTENSIONS,
  ...DOTNET_CONFIG_EXTENSIONS,
  ...ECOSYSTEM_SCANNABLE_EXTENSIONS,
  ...SCRIPT_SCANNABLE_EXTENSIONS,
] as const;

const GRAPH_PATH_FILE_QUERY_DOTTED_EXTENSIONS = [
  ...PRODUCT_GRAPH_SCANNABLE_EXTENSIONS,
  ...GRAPH_PATH_EXTRA_FILE_EXTENSIONS,
  ...UNSUPPORTED_SOURCE_EXTENSIONS,
] as const;

export const GRAPH_PATH_FILE_QUERY_EXTENSION_SET = new Set(
  GRAPH_PATH_FILE_QUERY_DOTTED_EXTENSIONS.map((extension) => extension.slice(1).toLowerCase())
);

export const PRODUCT_GRAPH_SCANNABLE_EXTENSION_SET = new Set<string>(PRODUCT_GRAPH_SCANNABLE_EXTENSIONS);
export const UNSUPPORTED_SOURCE_EXTENSION_SET = new Set<string>(UNSUPPORTED_SOURCE_EXTENSIONS);

export function normalizeDottedSourceExtension(extension: string) {
  const trimmed = extension.trim().toLowerCase();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function isGraphPathFileExtension(extension: string) {
  const dotted = normalizeDottedSourceExtension(extension);
  return GRAPH_PATH_FILE_QUERY_EXTENSION_SET.has(dotted.slice(1));
}

export function isProductGraphScannableExtension(extension: string) {
  return PRODUCT_GRAPH_SCANNABLE_EXTENSION_SET.has(normalizeDottedSourceExtension(extension));
}

export function isUnsupportedSourceExtension(extension: string) {
  return UNSUPPORTED_SOURCE_EXTENSION_SET.has(normalizeDottedSourceExtension(extension));
}