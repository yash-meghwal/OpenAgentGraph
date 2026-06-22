import type {
  GraphAnalyzerAvailability,
  UnifiedCodeGraph,
  WorkspaceKernelProfile,
} from "./codeGraph.js";
import { formatGraphAnalyzerDiagnostic } from "./graphAnalyzers.js";

export interface EcosystemScannerHealthSection {
  scannerId: string;
  label: string;
  tier: string;
  lines: string[];
}

export interface ScanMetadataHealthInput {
  scannerSemanticAnalysisEnabled?: boolean;
  scannerSemanticAnalysisSucceeded?: boolean;
  scannerSemanticFallbackReason?: string;
  scannerSemanticEdgeCount?: number;
  scannerSemanticResolutionCount?: number;
  scannerSemanticConfigCount?: number;
  scannerSemanticConfiguredFileCount?: number;
  scannerSemanticSyntheticFileCount?: number;
  scannerSemanticUnconfiguredFileCount?: number;
  scannerSemanticConfigPaths?: string;
  scannerPartial?: boolean;
  scannerSkippedFileCount?: number;
  scannerSkippedDirectoryCount?: number;
  scannerBreakerState?: string;
  scannerBreakerHits?: string;
  scannerSemanticBreakerState?: string;
  scannerSemanticBreakerHits?: string;
  scannerDetectedProjectTypes?: string;
  scannerActiveScannerIds?: string;
  scannerMarkerPaths?: string;
  scannerSourceExtensionCounts?: string;
}

const DOCUMENTATION_PRIMARY_TYPES = new Set([
  "documentation-corpus",
  "fixture-docs-only",
  "docs-only",
]);

export interface EcosystemScannerCatalogEntry {
  label: string;
  tier: string;
  semanticSupported: boolean;
  limitation: string;
}

export const ECOSYSTEM_TIER_LEGEND = [
  "T0: compiler-backed semantic indexing where project config or helpers are available.",
  "T1.5: semantic-lite project-aware edges; optional analyzer enrichment when runtime is available.",
  "T1: structural symbols, imports, config, and asset edges only; no full semantic graph.",
  "T3: honest file-level coverage for unrecognized or mixed layouts.",
] as const;

const SCANNER_NODE_LANGUAGE_ALIASES: Record<string, readonly string[]> = {
  dotnet: ["csharp"],
  typescript: ["typescript", "javascript"],
  python: ["python"],
  go: ["go"],
  rust: ["rust"],
  terraform: ["terraform"],
  java: ["java", "kotlin"],
  ruby: ["ruby"],
  php: ["php"],
  swift: ["swift"],
  cpp: ["cpp", "c"],
  flutter: ["dart"],
  unity: ["csharp", "unity"],
  unreal: ["cpp", "unreal"],
  godot: ["gdscript", "godot"],
  generic: ["generic", "documentation", "powershell", "shell"],
};

function normalizeScannerLanguage(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function scannerNodeLanguages(scannerId: string) {
  const aliases = SCANNER_NODE_LANGUAGE_ALIASES[scannerId] ?? [scannerId];
  return new Set(aliases.map(normalizeScannerLanguage));
}

function nodeMatchesScannerLanguage(
  node: UnifiedCodeGraph["nodes"][number],
  languages: Set<string>
) {
  const scannerLanguage = normalizeScannerLanguage(
    typeof node.metadata?.scannerLanguage === "string"
      ? node.metadata.scannerLanguage
      : node.scannerId
  );
  return languages.has(scannerLanguage);
}

const SCANNER_CATALOG: Record<string, EcosystemScannerCatalogEntry> = {
  typescript: {
    label: "TypeScript/JavaScript",
    tier: "T0",
    semanticSupported: true,
    limitation: "Compiler-backed semantic edges when project config is available.",
  },
  dotnet: {
    label: "C#/.NET",
    tier: "T0",
    semanticSupported: true,
    limitation: "Structural T0 indexing; optional Roslyn semantic edges when helper is available.",
  },
  python: {
    label: "Python",
    tier: "T1",
    semanticSupported: false,
    limitation: "Structural symbols and imports only; AST semantic edges are not enabled.",
  },
  go: {
    label: "Go",
    tier: "T1",
    semanticSupported: false,
    limitation: "Structural packages, functions, and imports only; go/types semantic edges are not enabled.",
  },
  rust: {
    label: "Rust",
    tier: "T1",
    semanticSupported: false,
    limitation: "Structural modules and types only; rust-analyzer semantic edges are not enabled.",
  },
  terraform: {
    label: "Terraform/IaC",
    tier: "T1",
    semanticSupported: false,
    limitation: "Config-level resources and modules only; full IaC graph resolution is not enabled.",
  },
  java: {
    label: "Java/Kotlin",
    tier: "T1.5",
    semanticSupported: true,
    limitation: "Semantic-lite project-aware imports, inheritance, tests, and module edges; optional JDK enrichment only.",
  },
  ruby: {
    label: "Ruby/Rails",
    tier: "T1.5",
    semanticSupported: true,
    limitation: "Semantic-lite Gemfile/gemspec, require/require_relative, inheritance, Rails routes, and specs; optional Ruby parser enrichment only.",
  },
  php: {
    label: "PHP/Composer",
    tier: "T1.5",
    semanticSupported: true,
    limitation: "Semantic-lite Composer PSR-4, use/extends/implements, Laravel routes, and WordPress hooks; optional PHP tokenizer enrichment only.",
  },
  swift: {
    label: "Swift/Apple",
    tier: "T1",
    semanticSupported: false,
    limitation: "Structural imports, types, extensions, and tests only; SourceKit semantic edges are not enabled.",
  },
  cpp: {
    label: "C/C++",
    tier: "T1",
    semanticSupported: false,
    limitation: "Structural includes, types, CMake/Make targets, and tests only; clang semantic edges are not enabled.",
  },
  flutter: {
    label: "Flutter/Dart",
    tier: "T1",
    semanticSupported: false,
    limitation: "Structural imports, types, widgets, pubspec dependencies, and tests only; Dart analyzer semantic edges are not enabled.",
  },
  unity: {
    label: "Unity",
    tier: "T1",
    semanticSupported: false,
    limitation: "Structural asmdef references, scenes/prefabs as assets, and C# via .NET scanner only; GUID script refs are not resolved.",
  },
  unreal: {
    label: "Unreal Engine",
    tier: "T1",
    semanticSupported: false,
    limitation: "Structural modules, Build.cs dependencies, and C++ via C/C++ scanner only; UObject runtime graph is not modeled.",
  },
  godot: {
    label: "Godot",
    tier: "T1",
    semanticSupported: false,
    limitation: "Structural GDScript, scenes, autoloads, and static script-to-scene refs only; engine runtime behavior is not modeled.",
  },
  generic: {
    label: "Generic polyglot",
    tier: "T3",
    semanticSupported: false,
    limitation: "Honest file-level coverage for unrecognized or mixed layouts.",
  },
};

const GENERATED_SKIP_REASONS = new Set(["global", "gitignore", "dockerignore", "oagignore", "breaker"]);

function countScannerGraphStats(graph: UnifiedCodeGraph, scannerId: string) {
  const languages = scannerNodeLanguages(scannerId);
  const trackedNodes = graph.nodes.filter((node) =>
    ["code_file", "config_file", "doc_file", "symbol"].includes(node.kind)
    && nodeMatchesScannerLanguage(node, languages)
  );
  const indexedFileCount = trackedNodes.filter((node) =>
    ["code_file", "config_file", "doc_file"].includes(node.kind)
  ).length;
  const symbolCount = trackedNodes.filter((node) => node.kind === "symbol").length;
  const nodeIds = new Set(trackedNodes.map((node) => node.id));
  const relationshipCount = graph.edges.filter((edge) =>
    nodeIds.has(edge.sourceNodeId)
    || nodeIds.has(edge.targetNodeId)
    || (edge.scannerId && languages.has(normalizeScannerLanguage(edge.scannerId)))
  ).length;
  return { indexedFileCount, symbolCount, relationshipCount };
}

function countWorkspaceGraphTotals(
  graph: UnifiedCodeGraph,
  kernelProfile?: WorkspaceKernelProfile
) {
  const indexedFileCount = graph.nodes.filter((node) =>
    ["code_file", "config_file", "doc_file"].includes(node.kind)
  ).length;
  const symbolCount = graph.nodes.filter((node) => node.kind === "symbol").length;
  const relationshipCount = graph.edges.length;
  const skippedGeneratedCount = Object.entries(kernelProfile?.skippedCountsByReason ?? {})
    .filter(([reason]) => GENERATED_SKIP_REASONS.has(reason))
    .reduce((sum, [, count]) => sum + (typeof count === "number" ? count : 0), 0);
  return { indexedFileCount, symbolCount, relationshipCount, skippedGeneratedCount };
}

function markerMatches(markers: string[], patterns: RegExp[]) {
  return markers.some((marker) => patterns.some((pattern) => pattern.test(marker)));
}

export function parseExtensionCounts(summary?: string) {
  const counts = new Map<string, number>();
  if (!summary) return counts;
  for (const part of summary.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)[:=](\d+)$/);
    if (!match) continue;
    const extension = match[1].trim();
    const count = Number.parseInt(match[2], 10);
    if (extension && Number.isFinite(count)) counts.set(extension, count);
  }
  return counts;
}

function withSingleTrailingPeriod(text: string) {
  const normalized = text.trim();
  if (!normalized) return ".";
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
}

function countTypeScriptSources(extensionCounts: Map<string, number>) {
  return (extensionCounts.get(".ts") ?? 0)
    + (extensionCounts.get(".tsx") ?? 0)
    + (extensionCounts.get(".js") ?? 0)
    + (extensionCounts.get(".jsx") ?? 0)
    + (extensionCounts.get(".mjs") ?? 0)
    + (extensionCounts.get(".cjs") ?? 0);
}

export function shouldReportTypeScriptSemanticHealth(input: {
  activeScannerIds?: string[];
  sourceExtensionCounts?: Record<string, number> | Map<string, number>;
  sourceExtensionSummary?: string;
}) {
  const extensionCounts = input.sourceExtensionCounts instanceof Map
    ? input.sourceExtensionCounts
    : parseExtensionCounts(input.sourceExtensionSummary);
  if (!(input.sourceExtensionCounts instanceof Map) && input.sourceExtensionCounts) {
    for (const [extension, count] of Object.entries(input.sourceExtensionCounts)) {
      extensionCounts.set(extension, count);
    }
  }
  return countTypeScriptSources(extensionCounts) > 0;
}

export function isTypeScriptSemanticFallbackMessage(message: string | undefined) {
  if (!message) return false;
  return /typescript project config|tsconfig|typeScript semantic/i.test(message);
}

function buildTypeScriptSection(
  profile: WorkspaceKernelProfile,
  graph?: UnifiedCodeGraph
): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("typescript") && countTypeScriptSources(new Map(Object.entries(profile.sourceExtensionCounts))) === 0) {
    return undefined;
  }

  const lines: string[] = [];
  const hasTsConfig = markerMatches(profile.markerPaths, [/tsconfig.*\.json$/i, /jsconfig\.json$/i]);
  const hasPackageJson = markerMatches(profile.markerPaths, [/package\.json$/i]);
  if (hasTsConfig) {
    lines.push("TypeScript/JavaScript project config detected.");
  } else if (hasPackageJson) {
    lines.push("JavaScript/TypeScript package markers detected; no tsconfig/jsconfig marker found.");
  } else if (countTypeScriptSources(new Map(Object.entries(profile.sourceExtensionCounts))) > 0) {
    lines.push("TypeScript/JavaScript source files indexed.");
  } else {
    lines.push("TypeScript/JavaScript scanner registered; no TS/JS source files indexed in this scan.");
  }

  const tsDiagnostics = (graph?.diagnostics ?? []).filter((line) => /typescript|tsconfig|jsconfig/i.test(line));
  for (const line of tsDiagnostics.slice(0, 2)) {
    lines.push(line.replace(/\.$/, ""));
  }

  return {
    scannerId: "typescript",
    label: SCANNER_CATALOG.typescript.label,
    tier: SCANNER_CATALOG.typescript.tier,
    lines,
  };
}

function buildDotNetSection(
  profile: WorkspaceKernelProfile,
  analyzers?: GraphAnalyzerAvailability[]
): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("dotnet")) return undefined;

  const lines: string[] = [];
  const hasSolution = markerMatches(profile.markerPaths, [/\.sln$/i]);
  const hasProject = markerMatches(profile.markerPaths, [/\.csproj$/i, /\.fsproj$/i]);
  if (hasSolution || hasProject) {
    lines.push(".NET solution/project detected.");
  } else {
    lines.push("C#/.NET scanner active; no solution or project markers found.");
  }
  lines.push("C# structural indexing: available (T0).");

  const roslyn = analyzers?.find((analyzer) => analyzer.id === "dotnet-roslyn");
  if (roslyn) {
    lines.push(formatGraphAnalyzerDiagnostic(roslyn).replace(/\.$/, ""));
  } else {
    lines.push("C# Roslyn semantic analyzer: not recorded for this export.");
  }

  return {
    scannerId: "dotnet",
    label: SCANNER_CATALOG.dotnet.label,
    tier: SCANNER_CATALOG.dotnet.tier,
    lines,
  };
}

function buildPythonSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("python")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/pyproject\.toml$/i, /requirements\.txt$/i, /setup\.py$/i, /Pipfile$/i])
      ? "Python project markers detected."
      : "Python scanner active; project markers not detected.",
    "Python indexing: T1 structural (imports, modules, and symbols); AST semantic edges are not enabled in base yet.",
  ];
  return { scannerId: "python", label: SCANNER_CATALOG.python.label, tier: SCANNER_CATALOG.python.tier, lines };
}

function buildJavaSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("java")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/pom\.xml$/i, /build\.gradle(?:\.kts)?$/i, /settings\.gradle(?:\.kts)?$/i])
      ? "Java/Kotlin Maven or Gradle project detected."
      : "Java/Kotlin scanner active; build markers not detected.",
    "Java/Kotlin indexing: T1.5 semantic-lite; optional JDK enrichment when available.",
  ];
  return { scannerId: "java", label: SCANNER_CATALOG.java.label, tier: SCANNER_CATALOG.java.tier, lines };
}

function buildGoSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("go")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/go\.mod$/i])
      ? "Go module detected."
      : "Go scanner active; go.mod marker not detected.",
    "Go indexing: T1 structural; go/types semantic edges are not enabled in base yet.",
  ];
  return { scannerId: "go", label: SCANNER_CATALOG.go.label, tier: SCANNER_CATALOG.go.tier, lines };
}

function buildRustSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("rust")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/Cargo\.toml$/i])
      ? "Rust cargo workspace detected."
      : "Rust scanner active; Cargo.toml marker not detected.",
    "Rust indexing: T1 structural; rust-analyzer semantic edges are not enabled in base yet.",
  ];
  return { scannerId: "rust", label: SCANNER_CATALOG.rust.label, tier: SCANNER_CATALOG.rust.tier, lines };
}

function buildRubySection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("ruby")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/Gemfile$/i, /\.gemspec$/i, /Rakefile$/i, /config\/routes\.rb$/i])
      ? "Ruby/Rails project markers detected."
      : "Ruby scanner active; project markers not detected.",
    "Ruby indexing: T1.5 semantic-lite; optional Ruby parser enrichment when available.",
  ];
  return { scannerId: "ruby", label: SCANNER_CATALOG.ruby.label, tier: SCANNER_CATALOG.ruby.tier, lines };
}

function buildPhpSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("php")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/composer\.json$/i, /artisan$/i, /wp-config\.php$/i, /symfony\.lock$/i])
      ? "PHP/Composer project markers detected."
      : "PHP scanner active; project markers not detected.",
    "PHP indexing: T1.5 semantic-lite; optional PHP tokenizer enrichment when available.",
  ];
  return { scannerId: "php", label: SCANNER_CATALOG.php.label, tier: SCANNER_CATALOG.php.tier, lines };
}

function buildSwiftSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("swift")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/Package\.swift$/i, /project\.pbxproj$/i])
      ? "Swift/Apple project markers detected."
      : "Swift scanner active; project markers not detected.",
    "Swift indexing: T1 structural; SourceKit semantic edges are not enabled in base yet.",
  ];
  return { scannerId: "swift", label: SCANNER_CATALOG.swift.label, tier: SCANNER_CATALOG.swift.tier, lines };
}

function buildCppSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("cpp")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/CMakeLists\.txt$/i, /Makefile$/i, /compile_commands\.json$/i, /\.vcxproj$/i])
      ? "C/C++ build markers detected."
      : "C/C++ scanner active; build markers not detected.",
    "C/C++ indexing: T1 structural; clang semantic edges are not enabled in base yet.",
  ];
  return { scannerId: "cpp", label: SCANNER_CATALOG.cpp.label, tier: SCANNER_CATALOG.cpp.tier, lines };
}

function buildFlutterSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("flutter")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/pubspec\.yaml$/i])
      ? "Dart/Flutter pubspec marker detected."
      : "Dart/Flutter scanner active; pubspec marker not detected.",
    "Dart/Flutter indexing: T1 structural; Dart analyzer semantic edges are not enabled in base yet.",
  ];
  return { scannerId: "flutter", label: SCANNER_CATALOG.flutter.label, tier: SCANNER_CATALOG.flutter.tier, lines };
}

function buildUnitySection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("unity")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/ProjectSettings\/ProjectVersion\.txt$/i, /\.asmdef$/i])
      ? "Unity project markers detected."
      : "Unity scanner active; project markers not detected.",
    "Unity indexing: T1 structural (asmdef, scenes/prefabs); C# uses .NET scanner; GUID script refs are not resolved.",
  ];
  return { scannerId: "unity", label: SCANNER_CATALOG.unity.label, tier: SCANNER_CATALOG.unity.tier, lines };
}

function buildUnrealSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("unreal")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/\.uproject$/i, /\.uplugin$/i, /\.Build\.cs$/i])
      ? "Unreal project markers detected."
      : "Unreal scanner active; project markers not detected.",
    "Unreal indexing: T1 structural (modules, Build.cs); C++ uses C/C++ scanner; UObject runtime graph is not modeled.",
  ];
  return { scannerId: "unreal", label: SCANNER_CATALOG.unreal.label, tier: SCANNER_CATALOG.unreal.tier, lines };
}

function buildGodotSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("godot")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/project\.godot$/i])
      ? "Godot project.godot marker detected."
      : "Godot scanner active; project.godot marker not detected.",
    "Godot indexing: T1 structural (GDScript, scenes, autoloads); engine runtime behavior is not modeled.",
  ];
  return { scannerId: "godot", label: SCANNER_CATALOG.godot.label, tier: SCANNER_CATALOG.godot.tier, lines };
}

function buildTerraformSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  if (!profile.activeScannerIds.includes("terraform")) return undefined;
  const lines = [
    markerMatches(profile.markerPaths, [/\.tf$/i, /\.tfvars$/i, /terraform\.lock\.hcl$/i])
      ? "Terraform/IaC module markers detected."
      : "Terraform/IaC scanner active; module markers not detected.",
    "Terraform indexing: T1 config structural; full IaC graph resolution is not enabled in base yet.",
  ];
  return { scannerId: "terraform", label: SCANNER_CATALOG.terraform.label, tier: SCANNER_CATALOG.terraform.tier, lines };
}

function buildGenericSection(profile: WorkspaceKernelProfile): EcosystemScannerHealthSection | undefined {
  const isDocs = DOCUMENTATION_PRIMARY_TYPES.has(profile.primaryType)
    || profile.primaryType.includes("docs");
  if (!profile.activeScannerIds.includes("generic") && !isDocs) return undefined;

  const lines = isDocs
    ? [
        "Documentation corpus mode: indexing docs and reference files without language-symbol extraction.",
        "No application runtime or package manifest is required for this workspace shape.",
      ]
    : [
        "Generic polyglot mode: honest file-level coverage for unrecognized or mixed layouts.",
        "Use explicit project markers to unlock richer ecosystem scanners.",
      ];
  return { scannerId: "generic", label: SCANNER_CATALOG.generic.label, tier: SCANNER_CATALOG.generic.tier, lines };
}

export function buildEcosystemScannerHealthSections(input: {
  kernelProfile?: WorkspaceKernelProfile;
  graph?: UnifiedCodeGraph;
  analyzers?: GraphAnalyzerAvailability[];
}): EcosystemScannerHealthSection[] {
  const profile = input.kernelProfile;
  if (!profile) return [];

  const builders = [
    buildDotNetSection(profile, input.analyzers ?? input.graph?.analyzers),
    buildTypeScriptSection(profile, input.graph),
    buildJavaSection(profile),
    buildPythonSection(profile),
    buildGoSection(profile),
    buildRustSection(profile),
    buildRubySection(profile),
    buildPhpSection(profile),
    buildSwiftSection(profile),
    buildCppSection(profile),
    buildFlutterSection(profile),
    buildUnitySection(profile),
    buildUnrealSection(profile),
    buildGodotSection(profile),
    buildTerraformSection(profile),
    buildGenericSection(profile),
  ];

  const sections = builders.filter((section): section is EcosystemScannerHealthSection => Boolean(section));
  const seen = new Set<string>();
  return sections.filter((section) => {
    if (seen.has(section.scannerId)) return false;
    seen.add(section.scannerId);
    return true;
  });
}

export function getEcosystemScannerCatalogEntry(scannerId: string): EcosystemScannerCatalogEntry {
  return SCANNER_CATALOG[scannerId] ?? SCANNER_CATALOG.generic;
}

export function renderEcosystemTierLegendMarkdown() {
  return [
    "## Ecosystem tier legend",
    "",
    ...ECOSYSTEM_TIER_LEGEND.map((line) => `- ${line}`),
    "",
  ];
}

export function summarizeEcosystemSupportForAgents(input: {
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
}) {
  return buildEcosystemSupportMatrix(input).map((row) => ({
    scannerId: row.scannerId,
    label: getEcosystemScannerCatalogEntry(row.scannerId).label,
    tier: row.tier,
    semanticSupported: row.semanticSupported,
    limitation: row.limitation,
  }));
}

export function buildEcosystemSupportMatrix(input: {
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
}) {
  const profile = input.kernelProfile ?? {
    schemaVersion: "1.0",
    root: input.graph.workspaceRoot,
    effectiveRoots: [input.graph.workspaceRoot],
    primaryType: "generic",
    secondaryTypes: [],
    typeSignals: [],
    sourceRoots: ["."],
    markerPaths: [],
    activeScannerIds: input.graph.activeScannerIds.length > 0 ? input.graph.activeScannerIds : ["generic"],
    ignoreRules: [],
    sourceExtensionCounts: {},
    skippedCountsByReason: {},
    warnings: [],
  };

  const activeScannerIds = profile.activeScannerIds.length > 0 ? profile.activeScannerIds : ["generic"];
  const workspaceTotals = countWorkspaceGraphTotals(input.graph, profile);

  return activeScannerIds.map((scannerId) => {
    const catalog = SCANNER_CATALOG[scannerId] ?? SCANNER_CATALOG.generic;
    const projectType = profile.primaryType;
    const scannerStats = countScannerGraphStats(input.graph, scannerId);
    return {
      ecosystemId: scannerId,
      projectType,
      scannerId,
      tier: catalog.tier,
      semanticSupported: catalog.semanticSupported,
      indexedFileCount: scannerStats.indexedFileCount,
      symbolCount: scannerStats.symbolCount,
      relationshipCount: scannerStats.relationshipCount,
      skippedGeneratedCount: workspaceTotals.skippedGeneratedCount,
      limitation: catalog.limitation,
    };
  });
}

export function renderEcosystemSupportMatrixMarkdown(input: {
  graph: UnifiedCodeGraph;
  kernelProfile?: WorkspaceKernelProfile;
}) {
  const rows = buildEcosystemSupportMatrix(input);
  if (rows.length === 0) return ["- No ecosystem support matrix recorded."];
  const workspaceTotals = countWorkspaceGraphTotals(input.graph, input.kernelProfile);
  const lines: string[] = [];
  if (rows.length > 1) {
    lines.push(
      `- Workspace totals (all scanners): files=${workspaceTotals.indexedFileCount} · symbols=${workspaceTotals.symbolCount} · edges=${workspaceTotals.relationshipCount} · skipped=${workspaceTotals.skippedGeneratedCount}`
    );
  }
  for (const row of rows) {
    lines.push(
      `- **${row.scannerId} (${row.tier})** · project=${row.projectType} · files=${row.indexedFileCount} · symbols=${row.symbolCount} · edges=${row.relationshipCount} · semantic=${row.semanticSupported ? "yes" : "no"} · ${row.limitation}`
    );
  }
  return lines;
}

export function flattenEcosystemScannerHealthDiagnostics(input: {
  kernelProfile?: WorkspaceKernelProfile;
  graph?: UnifiedCodeGraph;
  analyzers?: GraphAnalyzerAvailability[];
}) {
  const sections = buildEcosystemScannerHealthSections(input);
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(`${section.label} (${section.tier}): ${withSingleTrailingPeriod(section.lines[0] ?? "active")}`);
    for (const detail of section.lines.slice(1)) {
      lines.push(`${section.label}: ${withSingleTrailingPeriod(detail)}`);
    }
  }
  return lines;
}

export function renderEcosystemScannerHealthMarkdown(input: {
  kernelProfile?: WorkspaceKernelProfile;
  graph?: UnifiedCodeGraph;
  analyzers?: GraphAnalyzerAvailability[];
}) {
  const sections = buildEcosystemScannerHealthSections(input);
  if (sections.length === 0) {
    return ["- No ecosystem scanner health recorded."];
  }

  const lines: string[] = [];
  for (const section of sections) {
    lines.push(`- **${section.label} (${section.tier})**`);
    for (const detail of section.lines) {
      lines.push(`  - ${detail}`);
    }
  }

  const skipped = input.kernelProfile?.skippedCountsByReason ?? {};
  const skipParts = Object.entries(skipped)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([reason, count]) => `${reason}=${count}`);
  if (skipParts.length > 0) {
    lines.push(`- **Skipped files by reason**: ${skipParts.join(", ")}.`);
  }

  const partialDiagnostics = (input.graph?.diagnostics ?? []).filter((line) =>
    /partial scan|breaker|safety cap/i.test(line)
  );
  for (const diagnostic of partialDiagnostics.slice(0, 3)) {
    lines.push(`- ${diagnostic}`);
  }

  return lines;
}

export function buildTypeScriptSemanticHealthLine(metadata: ScanMetadataHealthInput) {
  if (!shouldReportTypeScriptSemanticHealth({
    activeScannerIds: metadata.scannerActiveScannerIds?.split(",").map((value) => value.trim()).filter(Boolean),
    sourceExtensionSummary: metadata.scannerSourceExtensionCounts,
  })) {
    return undefined;
  }

  const succeeded = metadata.scannerSemanticAnalysisSucceeded;
  const enabled = metadata.scannerSemanticAnalysisEnabled;
  const fallbackReason = metadata.scannerSemanticFallbackReason;
  const resolutions = metadata.scannerSemanticResolutionCount ?? 0;
  const edges = metadata.scannerSemanticEdgeCount ?? 0;
  const status = succeeded ? "succeeded" : enabled ? "fallback" : "not run";
  const reasonSuffix = fallbackReason ? `; reason: ${fallbackReason}` : "";
  return `TypeScript semantic analysis: ${status}; ${resolutions} resolutions, ${edges} semantic edges${reasonSuffix}.`;
}

export function buildTypeScriptSemanticConfigLine(metadata: ScanMetadataHealthInput) {
  if (!shouldReportTypeScriptSemanticHealth({
    activeScannerIds: metadata.scannerActiveScannerIds?.split(",").map((value) => value.trim()).filter(Boolean),
    sourceExtensionSummary: metadata.scannerSourceExtensionCounts,
  })) {
    return undefined;
  }

  const configCount = metadata.scannerSemanticConfigCount ?? 0;
  const configured = metadata.scannerSemanticConfiguredFileCount ?? 0;
  const synthetic = metadata.scannerSemanticSyntheticFileCount ?? 0;
  const unconfigured = metadata.scannerSemanticUnconfiguredFileCount ?? 0;
  const configPaths = metadata.scannerSemanticConfigPaths;
  return `TypeScript semantic configs: ${configCount} used; ${configured} TS-configured file(s), ${synthetic} synthetic fallback file(s), ${unconfigured} unconfigured file(s)${configPaths ? `; ${configPaths}` : ""}.`;
}

export function buildProductGraphSemanticRiskLines(metadata: ScanMetadataHealthInput) {
  const risks: string[] = [];
  if (!shouldReportTypeScriptSemanticHealth({
    activeScannerIds: metadata.scannerActiveScannerIds?.split(",").map((value) => value.trim()).filter(Boolean),
    sourceExtensionSummary: metadata.scannerSourceExtensionCounts,
  })) {
    return risks;
  }

  const fallbackReason = metadata.scannerSemanticFallbackReason;
  const succeeded = metadata.scannerSemanticAnalysisSucceeded;
  if (fallbackReason && succeeded === false && isTypeScriptSemanticFallbackMessage(fallbackReason)) {
    risks.push(`TypeScript semantic analysis fell back: ${fallbackReason}.`);
  }
  const unconfigured = metadata.scannerSemanticUnconfiguredFileCount ?? 0;
  if (succeeded && unconfigured > 0) {
    risks.push(`${unconfigured} scanned TypeScript/JavaScript file(s) lacked semantic config coverage.`);
  }
  return risks;
}

export function kernelProfileFromScanMetadata(metadata: ScanMetadataHealthInput): WorkspaceKernelProfile | undefined {
  if (!metadata.scannerDetectedProjectTypes && !metadata.scannerActiveScannerIds && !metadata.scannerMarkerPaths) {
    return undefined;
  }

  const extensionCounts: Record<string, number> = {};
  for (const [extension, count] of parseExtensionCounts(metadata.scannerSourceExtensionCounts)) {
    extensionCounts[extension] = count;
  }
  const detected = (metadata.scannerDetectedProjectTypes ?? "generic")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const activeScannerIds = (metadata.scannerActiveScannerIds ?? detected.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    schemaVersion: "1.0",
    root: "",
    effectiveRoots: ["."],
    primaryType: detected[0] ?? "generic",
    secondaryTypes: detected.slice(1),
    typeSignals: [],
    sourceRoots: ["."],
    markerPaths: (metadata.scannerMarkerPaths ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    activeScannerIds: activeScannerIds.length > 0 ? activeScannerIds : ["generic"],
    ignoreRules: [],
    sourceExtensionCounts: extensionCounts,
    skippedCountsByReason: {},
    warnings: [],
  };
}

export function scanMetadataToHealthInput(metadata: Record<string, unknown> | undefined): ScanMetadataHealthInput {
  if (!metadata) return {};
  const readText = (key: string) => {
    const value = metadata[key];
    return typeof value === "string" ? value : undefined;
  };
  const readNumber = (key: string) => {
    const value = metadata[key];
    return typeof value === "number" ? value : undefined;
  };
  const readBoolean = (key: string) => {
    const value = metadata[key];
    return typeof value === "boolean" ? value : undefined;
  };
  return {
    scannerSemanticAnalysisEnabled: readBoolean("scannerSemanticAnalysisEnabled"),
    scannerSemanticAnalysisSucceeded: readBoolean("scannerSemanticAnalysisSucceeded"),
    scannerSemanticFallbackReason: readText("scannerSemanticFallbackReason"),
    scannerSemanticEdgeCount: readNumber("scannerSemanticEdgeCount"),
    scannerSemanticResolutionCount: readNumber("scannerSemanticResolutionCount"),
    scannerSemanticConfigCount: readNumber("scannerSemanticConfigCount"),
    scannerSemanticConfiguredFileCount: readNumber("scannerSemanticConfiguredFileCount"),
    scannerSemanticSyntheticFileCount: readNumber("scannerSemanticSyntheticFileCount"),
    scannerSemanticUnconfiguredFileCount: readNumber("scannerSemanticUnconfiguredFileCount"),
    scannerSemanticConfigPaths: readText("scannerSemanticConfigPaths"),
    scannerPartial: readBoolean("scannerPartial"),
    scannerSkippedFileCount: readNumber("scannerSkippedFileCount"),
    scannerSkippedDirectoryCount: readNumber("scannerSkippedDirectoryCount"),
    scannerBreakerState: readText("scannerBreakerState"),
    scannerBreakerHits: readText("scannerBreakerHits"),
    scannerSemanticBreakerState: readText("scannerSemanticBreakerState"),
    scannerSemanticBreakerHits: readText("scannerSemanticBreakerHits"),
    scannerDetectedProjectTypes: readText("scannerDetectedProjectTypes"),
    scannerActiveScannerIds: readText("scannerActiveScannerIds"),
    scannerMarkerPaths: readText("scannerMarkerPaths"),
    scannerSourceExtensionCounts: readText("scannerSourceExtensionCounts"),
  };
}

export function buildProductGraphSemanticTrustLine(metadata: ScanMetadataHealthInput) {
  if (!shouldReportTypeScriptSemanticHealth({
    activeScannerIds: metadata.scannerActiveScannerIds?.split(",").map((value) => value.trim()).filter(Boolean),
    sourceExtensionSummary: metadata.scannerSourceExtensionCounts,
  })) {
    return "TypeScript semantic status: not applicable (no TypeScript/JavaScript source files in latest scan).";
  }

  const succeeded = metadata.scannerSemanticAnalysisSucceeded;
  const enabled = metadata.scannerSemanticAnalysisEnabled;
  const status = succeeded ? "succeeded" : succeeded === false ? "fallback" : enabled ? "not run" : "not run";
  const resolutions = metadata.scannerSemanticResolutionCount ?? 0;
  const edges = metadata.scannerSemanticEdgeCount ?? 0;
  return `TypeScript semantic status: ${status}; ${resolutions} resolutions, ${edges} semantic edges.`;
}