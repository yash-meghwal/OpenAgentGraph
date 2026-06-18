import {
  DOTNET_CONFIG_EXTENSIONS,
  DOTNET_SOURCE_EXTENSIONS,
  ECOSYSTEM_SCANNABLE_EXTENSIONS,
  isProductGraphScannableExtension as sharedIsProductGraphScannableExtension,
  isUnsupportedSourceExtension as sharedIsUnsupportedSourceExtension,
  PRODUCT_GRAPH_SCANNABLE_EXTENSIONS,
  PRODUCT_GRAPH_SCANNABLE_EXTENSION_SET,
  SCRIPT_SCANNABLE_EXTENSIONS,
  TYPESCRIPT_SCANNABLE_EXTENSIONS,
  UNSUPPORTED_SOURCE_EXTENSIONS,
  UNSUPPORTED_SOURCE_EXTENSION_SET,
} from "@openagentgraph/shared";
import fs from "fs/promises";
import path from "path";
import { ECOSYSTEM_CONFIG_FILE_NAMES } from "./kernel/ecosystemScanner.js";

export {
  DOTNET_CONFIG_EXTENSIONS,
  DOTNET_SOURCE_EXTENSIONS,
  ECOSYSTEM_SCANNABLE_EXTENSIONS,
  PRODUCT_GRAPH_SCANNABLE_EXTENSIONS,
  PRODUCT_GRAPH_SCANNABLE_EXTENSION_SET,
  SCRIPT_SCANNABLE_EXTENSIONS,
  TYPESCRIPT_SCANNABLE_EXTENSIONS,
  UNSUPPORTED_SOURCE_EXTENSIONS,
  UNSUPPORTED_SOURCE_EXTENSION_SET,
};

export const SCANNER_HYGIENE_VERSION = "1.3";

export const BASE_SKIPPED_DIRECTORIES = [
  ".build",
  ".dart_tool",
  ".cache",
  ".oag",
  ".git",
  ".gradle",
  ".idea",
  ".mypy_cache",
  ".next",
  ".nuxt",
  ".output",
  ".playwright-mcp",
  ".pytest_cache",
  ".ruff_cache",
  ".svelte-kit",
  ".tmp-dev-logs",
  ".tmp-dogfood-data",
  ".turbo",
  ".tox",
  ".venv",
  ".terraform",
  ".vercel",
  ".vs",
  ".vscode-test",
  "CMakeFiles",
  "DerivedData",
  "Pods",
  "__pycache__",
  "bin",
  "build",
  "coverage",
  "data",
  "dist",
  "dist-electron",
  "dist-main",
  "dist-renderer",
  "graphify-out",
  "htmlcov",
  "node_modules",
  "obj",
  "out",
  "playwright-report",
  "release",
  "storybook-static",
  "target",
  "test-results",
  "tmp",
  "log",
  ".bundle",
  "vendor",
  "venv",
  "webview-dist",
  "Library",
  "Temp",
  "Logs",
  "Binaries",
  "Intermediate",
  "DerivedDataCache",
  "Saved",
  ".godot",
] as const;

export const SKIPPED_DIRECTORY_SET = new Set<string>(BASE_SKIPPED_DIRECTORIES);

export function isUnsupportedSourceExtension(extension: string) {
  return sharedIsUnsupportedSourceExtension(extension);
}

export const PROJECT_GRAPH_INCLUDED_EXTENSIONS = new Set([
  ".css",
  ".cjs",
  ".cs",
  ".csproj",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".props",
  ".sln",
  ".targets",
  ".ts",
  ".tsx",
  ".xaml",
  ".yaml",
  ".yml",
]);

export const WORKSPACE_MARKER_FILES = [
  { marker: "package.json", projectType: "node" },
  { marker: "tsconfig.json", projectType: "typescript" },
  { marker: "tsconfig.base.json", projectType: "typescript" },
  { marker: "pnpm-workspace.yaml", projectType: "node" },
  { marker: "Cargo.toml", projectType: "rust" },
  { marker: "go.mod", projectType: "go" },
  { marker: "pom.xml", projectType: "java" },
  { marker: "build.gradle", projectType: "java" },
  { marker: "build.gradle.kts", projectType: "java" },
  { marker: "requirements.txt", projectType: "python" },
  { marker: "pyproject.toml", projectType: "python" },
  { marker: "manage.py", projectType: "django-app" },
  { marker: ".terraform.lock.hcl", projectType: "terraform-iac" },
  { marker: "Gemfile", projectType: "rails-app" },
  { marker: "Rakefile", projectType: "ruby-app" },
  { marker: "Package.swift", projectType: "swift-package" },
  { marker: "pubspec.yaml", projectType: "dart-package" },
  { marker: "CMakeLists.txt", projectType: "cpp-cmake" },
  { marker: "Makefile", projectType: "c-embedded" },
  { marker: "meson.build", projectType: "cpp-meson" },
  { marker: "compile_commands.json", projectType: "cpp" },
  { marker: "composer.json", projectType: "php-app" },
  { marker: "artisan", projectType: "laravel-app" },
  { marker: "symfony.lock", projectType: "symfony-app" },
  { marker: "settings.gradle", projectType: "java-gradle" },
  { marker: "settings.gradle.kts", projectType: "kotlin-gradle" },
  { marker: "project.godot", projectType: "godot-project" },
] as const;

export const WORKSPACE_MARKER_GLOBS = [
  { pattern: /^tsconfig(?:[.-].*)?\.json$/i, projectType: "typescript" },
  { pattern: /^next\.config\.(?:js|mjs|cjs|ts)$/i, projectType: "next-app" },
  { pattern: /\.csproj$/i, projectType: "dotnet" },
  { pattern: /\.sln$/i, projectType: "dotnet" },
  { pattern: /\.tf$/i, projectType: "terraform-iac" },
  { pattern: /\.gemspec$/i, projectType: "ruby-gem" },
  { pattern: /project\.pbxproj$/i, projectType: "ios-xcode" },
  { pattern: /\.vcxproj$/i, projectType: "cpp-msvc" },
  { pattern: /wp-config\.php$/i, projectType: "wordpress-plugin" },
  { pattern: /\.asmdef$/i, projectType: "unity-app" },
  { pattern: /\.uproject$/i, projectType: "unreal-project" },
  { pattern: /\.uplugin$/i, projectType: "unreal-plugin" },
] as const;

export const FILE_LEVEL_ONLY_LANGUAGE_WARNING =
  "C#/.NET: T0 structural indexing; optional Roslyn semantic edges when helper is available.";

export const DOTNET_T0_SCANNER_NOTICE =
  "C#/.NET: T0 structural indexing (types, members, project topology, XAML links); optional Roslyn semantic edges when helper is available.";

export const PYTHON_T1_SCANNER_NOTICE =
  "Python: T1 structural indexing (classes, functions, imports); AST-level semantic edges not yet enabled.";

export const GO_T1_SCANNER_NOTICE =
  "Go: T1 structural indexing (packages, functions, structs, imports); go/types semantic edges not yet enabled.";

export const RUST_T1_SCANNER_NOTICE =
  "Rust: T1 structural indexing (modules, functions, structs, traits, use); rust-analyzer semantic edges not yet enabled.";

export const TERRAFORM_T1_SCANNER_NOTICE =
  "Terraform: T1 config indexing (resources, modules, variables); full IaC graph resolution not yet enabled.";

export const JAVA_KOTLIN_T15_SCANNER_NOTICE =
  "Java/Kotlin: T1.5 semantic-lite indexing (project-aware imports, inheritance, tests, modules); optional JDK enrichment when available.";

export const RUBY_T15_SCANNER_NOTICE =
  "Ruby: T1.5 semantic-lite indexing (Gemfile/gemspec, require/require_relative, inheritance, Rails routes, specs); optional Ruby parser enrichment when available.";

export const PHP_T15_SCANNER_NOTICE =
  "PHP: T1.5 semantic-lite indexing (Composer PSR-4, use/extends/implements, routes, hooks); optional PHP tokenizer enrichment when available.";

export const SWIFT_T1_SCANNER_NOTICE =
  "Swift: T1 structural indexing (imports, types, extensions, tests); optional SourceKit enrichment when available.";

export const CPP_T1_SCANNER_NOTICE =
  "C/C++: T1 structural indexing (includes, types, CMake/Make targets, tests); optional clang enrichment when available.";

export const DART_T1_SCANNER_NOTICE =
  "Dart/Flutter: T1 structural indexing (imports, types, widgets, pubspec dependencies, tests); optional Dart analyzer enrichment when available.";

export const GAME_ENGINE_T1_SCANNER_NOTICE =
  "Game engines: T1 structural indexing (Unity asmdef/scenes, Unreal modules/Build.cs, Godot scripts/scenes/autoloads); runtime behavior is not modeled.";

export type DetectedProjectType =
  | "dotnet"
  | "typescript"
  | "javascript"
  | "node"
  | "rust"
  | "go"
  | "java"
  | "python"
  | "django-app"
  | "next-app"
  | "terraform"
  | "terraform-iac"
  | "ruby"
  | "ruby-app"
  | "rails-app"
  | "ruby-gem"
  | "php"
  | "php-app"
  | "laravel-app"
  | "symfony-app"
  | "wordpress-plugin"
  | "java-gradle"
  | "kotlin-gradle"
  | "swift"
  | "swift-package"
  | "swiftui-app"
  | "ios-xcode"
  | "cpp"
  | "cpp-cmake"
  | "c-embedded"
  | "cpp-msvc"
  | "cpp-meson"
  | "dart"
  | "dart-package"
  | "flutter-app"
  | "flutter-plugin"
  | "unity-app"
  | "unreal-project"
  | "unreal-plugin"
  | "godot-project"
  | "documentation-corpus"
  | "generic";

export interface WorkspaceScanProfile {
  scannerVersion: string;
  detectedProjectTypes: DetectedProjectType[];
  markerPaths: string[];
  sourceExtensionCounts: Record<string, number>;
  skippedDirectoryCounts: Record<string, number>;
  warnings: string[];
}

export interface CSharpSymbolCandidate {
  name: string;
  symbolKind: "class" | "interface" | "enum" | "struct" | "record";
  line: number;
}

const CSHARP_SYMBOL_PATTERNS: Array<{ symbolKind: CSharpSymbolCandidate["symbolKind"]; regex: RegExp }> = [
  { symbolKind: "class", regex: /^\s*(?:(?:public|private|protected|internal|static|abstract|sealed|partial|unsafe|new)\s+)*class\s+(\w+)/ },
  { symbolKind: "interface", regex: /^\s*(?:(?:public|private|protected|internal)\s+)*interface\s+(\w+)/ },
  { symbolKind: "enum", regex: /^\s*(?:(?:public|private|protected|internal)\s+)*enum\s+(\w+)/ },
  { symbolKind: "struct", regex: /^\s*(?:(?:public|private|protected|internal|readonly|ref|partial|unsafe)\s+)*struct\s+(\w+)/ },
  { symbolKind: "record", regex: /^\s*(?:(?:public|private|protected|internal|partial|sealed|abstract)\s+)*record\s+(?:class|struct)?\s*(\w+)/ },
];

const MAX_CSHARP_SYMBOLS_PER_FILE = 50;

export function normalizeScannerProjectPath(projectPath: string) {
  return projectPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isSkippedDirectoryName(name: string) {
  return SKIPPED_DIRECTORY_SET.has(name);
}

export function pathContainsSkippedDirectory(projectPath: string) {
  return normalizeScannerProjectPath(projectPath)
    .split("/")
    .some((segment) => isSkippedDirectoryName(segment));
}

export function isTypeScriptScannableExtension(extension: string) {
  return (TYPESCRIPT_SCANNABLE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

export function isDotNetSourceExtension(extension: string) {
  return (DOTNET_SOURCE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

export function isDotNetConfigExtension(extension: string) {
  return (DOTNET_CONFIG_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

export function isEcosystemScannableExtension(extension: string) {
  return (ECOSYSTEM_SCANNABLE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

export function isScriptScannableExtension(extension: string) {
  return (SCRIPT_SCANNABLE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

export function isEcosystemConfigFileName(fileName: string) {
  return ECOSYSTEM_CONFIG_FILE_NAMES.has(fileName)
    || fileName === "config/routes.rb"
    || /\.gemspec$/i.test(fileName)
    || /\.asmdef$/i.test(fileName)
    || /\.uproject$/i.test(fileName)
    || /\.uplugin$/i.test(fileName);
}

export function isProductGraphScannableExtension(extension: string) {
  return sharedIsProductGraphScannableExtension(extension);
}

export function classifyDotNetFileRole(extension: string): "source" | "config" | undefined {
  const normalized = extension.toLowerCase();
  if (isDotNetSourceExtension(normalized)) return "source";
  if (isDotNetConfigExtension(normalized)) return "config";
  return undefined;
}

export function extractCSharpTopLevelSymbols(content: string): CSharpSymbolCandidate[] {
  const lines = content.split(/\r?\n/);
  const symbols: CSharpSymbolCandidate[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const pattern of CSHARP_SYMBOL_PATTERNS) {
      const match = pattern.regex.exec(line);
      const name = match?.[1];
      if (!name) continue;
      const key = `${pattern.symbolKind}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({
        name,
        symbolKind: pattern.symbolKind,
        line: index + 1,
      });
      break;
    }
    if (symbols.length >= MAX_CSHARP_SYMBOLS_PER_FILE) break;
  }

  return symbols;
}

export function recordSkippedDirectory(
  counts: Map<string, number>,
  directoryName: string
) {
  counts.set(directoryName, (counts.get(directoryName) ?? 0) + 1);
}

export function recordSourceExtension(
  counts: Map<string, number>,
  extension: string
) {
  const normalized = extension.toLowerCase() || "(none)";
  counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
}

function sortedCountRecord(counts: Map<string, number>) {
  return Object.fromEntries(
    [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  );
}

export function markerProjectTypeForPath(projectPath: string, fileName: string): DetectedProjectType | undefined {
  const normalized = normalizeScannerProjectPath(projectPath);
  if (normalized.endsWith("ProjectSettings/ProjectVersion.txt")) {
    return "unity-app";
  }
  for (const marker of WORKSPACE_MARKER_FILES) {
    if (marker.marker.toLowerCase() === fileName.toLowerCase()) {
      return marker.projectType;
    }
  }
  for (const marker of WORKSPACE_MARKER_GLOBS) {
    if (marker.pattern.test(fileName)) {
      return marker.projectType;
    }
  }
  return undefined;
}

async function discoverWorkspaceMarkers(
  root: string,
  input: {
    maxDepth?: number;
    maxEntries?: number;
  } = {}
): Promise<{ markerPaths: string[]; detectedTypes: Set<DetectedProjectType> }> {
  const maxDepth = input.maxDepth ?? 8;
  const maxEntries = input.maxEntries ?? 2_000;
  const markerPaths: string[] = [];
  const detectedTypes = new Set<DetectedProjectType>();
  const pending = [{ absolutePath: path.resolve(root), depth: 0 }];
  let visitedEntries = 0;

  while (pending.length > 0) {
    const current = pending.shift()!;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > maxEntries) {
        return { markerPaths, detectedTypes };
      }

      const absoluteEntryPath = path.join(current.absolutePath, entry.name);
      const projectPath = normalizeScannerProjectPath(path.relative(root, absoluteEntryPath));

      if (entry.isDirectory()) {
        if (isSkippedDirectoryName(entry.name)) continue;
        if (current.depth >= maxDepth) continue;
        pending.push({ absolutePath: absoluteEntryPath, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) continue;
      const projectType = markerProjectTypeForPath(projectPath, entry.name);
      if (!projectType) continue;
      markerPaths.push(projectPath);
      detectedTypes.add(projectType);
    }
  }

  return {
    markerPaths: markerPaths.sort((left, right) => left.localeCompare(right)),
    detectedTypes,
  };
}

export function buildWorkspaceScanProfile(input: {
  markerPaths: string[];
  detectedProjectTypes: Iterable<DetectedProjectType>;
  sourceExtensionCounts: Map<string, number>;
  skippedDirectoryCounts: Map<string, number>;
  warnings?: string[];
}): WorkspaceScanProfile {
  const detected = [...new Set(input.detectedProjectTypes)];
  if (detected.length === 0) detected.push("generic");

  const warnings = [...(input.warnings ?? [])];
  const extensionCounts = sortedCountRecord(input.sourceExtensionCounts);
  const hasDotNet = detected.includes("dotnet") || (extensionCounts[".cs"] ?? 0) > 0;
  const hasTypeScript =
    detected.includes("typescript") ||
    detected.includes("javascript") ||
    detected.includes("node") ||
    (extensionCounts[".ts"] ?? 0) > 0 ||
    (extensionCounts[".tsx"] ?? 0) > 0;

  if (hasDotNet) {
    warnings.push(DOTNET_T0_SCANNER_NOTICE);
  }
  if (detected.includes("python") || (extensionCounts[".py"] ?? 0) > 0) {
    warnings.push(PYTHON_T1_SCANNER_NOTICE);
  }
  if (detected.includes("go") || (extensionCounts[".go"] ?? 0) > 0) {
    warnings.push(GO_T1_SCANNER_NOTICE);
  }
  if (detected.includes("rust") || (extensionCounts[".rs"] ?? 0) > 0) {
    warnings.push(RUST_T1_SCANNER_NOTICE);
  }
  if ((extensionCounts[".tf"] ?? 0) > 0) {
    warnings.push(TERRAFORM_T1_SCANNER_NOTICE);
  }
  if (
    detected.includes("java")
    || (extensionCounts[".java"] ?? 0) > 0
    || (extensionCounts[".kt"] ?? 0) > 0
    || (extensionCounts[".kts"] ?? 0) > 0
  ) {
    warnings.push(JAVA_KOTLIN_T15_SCANNER_NOTICE);
  }
  if (
    detected.includes("php")
    || detected.includes("php-app")
    || (extensionCounts[".php"] ?? 0) > 0
  ) {
    warnings.push(PHP_T15_SCANNER_NOTICE);
  }
  if (
    detected.includes("ruby")
    || detected.includes("rails-app")
    || (extensionCounts[".rb"] ?? 0) > 0
  ) {
    warnings.push(RUBY_T15_SCANNER_NOTICE);
  }
  if (
    detected.includes("swift")
    || detected.includes("swift-package")
    || detected.includes("ios-xcode")
    || (extensionCounts[".swift"] ?? 0) > 0
  ) {
    warnings.push(SWIFT_T1_SCANNER_NOTICE);
  }
  if (
    detected.includes("cpp")
    || detected.includes("cpp-cmake")
    || detected.includes("c-embedded")
    || (extensionCounts[".cpp"] ?? 0) > 0
    || (extensionCounts[".c"] ?? 0) > 0
    || (extensionCounts[".h"] ?? 0) > 0
  ) {
    warnings.push(CPP_T1_SCANNER_NOTICE);
  }
  if (
    detected.includes("dart")
    || detected.includes("dart-package")
    || detected.includes("flutter-app")
    || detected.includes("flutter-plugin")
    || (extensionCounts[".dart"] ?? 0) > 0
  ) {
    warnings.push(DART_T1_SCANNER_NOTICE);
  }
  if (
    detected.includes("unity-app")
    || detected.includes("unreal-project")
    || detected.includes("unreal-plugin")
    || detected.includes("godot-project")
    || (extensionCounts[".gd"] ?? 0) > 0
    || (extensionCounts[".unity"] ?? 0) > 0
    || (extensionCounts[".prefab"] ?? 0) > 0
  ) {
    warnings.push(GAME_ENGINE_T1_SCANNER_NOTICE);
  }
  if (hasDotNet && !hasTypeScript && (extensionCounts[".cs"] ?? 0) === 0) {
    warnings.push("Detected .NET project markers but no .cs source files were indexed. Confirm workspace root and build output skips.");
  }
  if ((input.skippedDirectoryCounts.get("bin") ?? 0) > 0 || (input.skippedDirectoryCounts.get("obj") ?? 0) > 0) {
    warnings.push("Skipped common generated folders (bin/obj). Source counts exclude build output.");
  }

  return {
    scannerVersion: SCANNER_HYGIENE_VERSION,
    detectedProjectTypes: detected.sort((left, right) => left.localeCompare(right)),
    markerPaths: [...input.markerPaths].sort((left, right) => left.localeCompare(right)),
    sourceExtensionCounts: extensionCounts,
    skippedDirectoryCounts: sortedCountRecord(input.skippedDirectoryCounts),
    warnings: [...new Set(warnings)],
  };
}

export async function detectWorkspaceScanProfile(
  root: string,
  input: {
    sourceExtensionCounts?: Map<string, number>;
    skippedDirectoryCounts?: Map<string, number>;
    warnings?: string[];
  } = {}
): Promise<WorkspaceScanProfile> {
  const discovered = await discoverWorkspaceMarkers(root);
  const sourceExtensionCounts = input.sourceExtensionCounts ?? new Map<string, number>();
  const skippedDirectoryCounts = input.skippedDirectoryCounts ?? new Map<string, number>();
  const detectedProjectTypes = new Set<DetectedProjectType>(discovered.detectedTypes);

  for (const [extension, count] of sourceExtensionCounts) {
    if (count <= 0) continue;
    if (extension === ".cs" || extension === ".csproj" || extension === ".sln") {
      detectedProjectTypes.add("dotnet");
    }
    if (extension === ".ts" || extension === ".tsx") {
      detectedProjectTypes.add("typescript");
    }
    if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") {
      detectedProjectTypes.add("javascript");
    }
    if (extension === ".py") {
      detectedProjectTypes.add("python");
    }
    if (extension === ".go") {
      detectedProjectTypes.add("go");
    }
    if (extension === ".rs") {
      detectedProjectTypes.add("rust");
    }
    if (extension === ".tf" || extension === ".tfvars") {
      detectedProjectTypes.add("terraform");
    }
    if (extension === ".java" || extension === ".kt" || extension === ".kts") {
      detectedProjectTypes.add("java");
    }
    if (extension === ".gd" || extension === ".tscn" || extension === ".tres") {
      detectedProjectTypes.add("godot-project");
    }
    if (extension === ".unity" || extension === ".prefab") {
      detectedProjectTypes.add("unity-app");
    }
  }

  return buildWorkspaceScanProfile({
    markerPaths: discovered.markerPaths,
    detectedProjectTypes,
    sourceExtensionCounts,
    skippedDirectoryCounts,
    warnings: input.warnings,
  });
}

export function workspaceProfileToMetadata(profile: WorkspaceScanProfile): Record<string, string | number | boolean> {
  return {
    scannerHygieneVersion: profile.scannerVersion,
    scannerDetectedProjectTypes: profile.detectedProjectTypes.join(", "),
    scannerMarkerPaths: profile.markerPaths.join(", "),
    scannerSourceExtensionCounts: Object.entries(profile.sourceExtensionCounts)
      .map(([extension, count]) => `${extension}:${count}`)
      .join(", "),
    scannerSkippedDirectoryCounts: Object.entries(profile.skippedDirectoryCounts)
      .map(([directory, count]) => `${directory}:${count}`)
      .join(", "),
    scannerCoverageWarnings: profile.warnings.join(" | "),
    scannerDotNetIndexingMode: profile.warnings.includes(DOTNET_T0_SCANNER_NOTICE) ? "t0" : "",
  };
}

export function workspaceProfileDiagnostics(profile: WorkspaceScanProfile): string[] {
  const lines = [
    `Detected project types: ${profile.detectedProjectTypes.join(", ") || "generic"}.`,
    profile.markerPaths.length > 0
      ? `Workspace markers: ${profile.markerPaths.join(", ")}.`
      : "Workspace markers: none detected.",
  ];
  const extensionSummary = Object.entries(profile.sourceExtensionCounts)
    .map(([extension, count]) => `${extension}=${count}`)
    .join(", ");
  if (extensionSummary) {
    lines.push(`Indexed source extensions: ${extensionSummary}.`);
  }
  const skippedSummary = Object.entries(profile.skippedDirectoryCounts)
    .map(([directory, count]) => `${directory}=${count}`)
    .join(", ");
  if (skippedSummary) {
    lines.push(`Skipped generated folders: ${skippedSummary}.`);
  }
  for (const warning of profile.warnings) {
    lines.push(warning);
  }
  return lines;
}