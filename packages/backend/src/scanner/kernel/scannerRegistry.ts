import type { ScannerCapability, ScannerPluginDefinition, ScannerSupportTier } from "@openagentgraph/shared";

export const SCANNER_REGISTRY_VERSION = "1.3";

const DEFAULT_HANDOFF_SECTIONS = [
  "source_trust",
  "project_type",
  "read_these_first",
  "communities",
  "architecture_health",
  "risks_and_gaps",
  "task_scope",
  "commands",
] as const;

const T1_HANDOFF_SECTIONS = [
  "source_trust",
  "project_type",
  "read_these_first",
  "communities",
  "risks_and_gaps",
  "commands",
] as const;

function plugin(input: ScannerPluginDefinition): ScannerPluginDefinition {
  return input;
}

export const SCANNER_REGISTRY: ScannerPluginDefinition[] = [
  plugin({
    id: "typescript",
    label: "TypeScript/JavaScript",
    projectTypes: [
      "typescript",
      "javascript",
      "node",
      "ts-js-monorepo",
      "ts-js-app",
      "next-app",
      "react-spa",
      "vue-app",
      "angular-app",
      "svelte-app",
      "node-backend",
    ],
    tier: "T0",
    capabilities: [
      "project_detection",
      "file_discovery",
      "symbols",
      "dependencies",
      "tests",
      "semantic",
      "handoff_sections",
    ],
    semanticSupported: true,
    handoffSections: [...DEFAULT_HANDOFF_SECTIONS],
  }),
  plugin({
    id: "dotnet",
    label: "C#/.NET",
    projectTypes: ["dotnet", "csharp-solution", "csharp-desktop", "aspnet-web"],
    tier: "T0",
    capabilities: [
      "project_detection",
      "file_discovery",
      "symbols",
      "dependencies",
      "tests",
      "semantic",
      "handoff_sections",
    ],
    semanticSupported: true,
    handoffSections: [...DEFAULT_HANDOFF_SECTIONS],
    warnings: [
      "C# structural: available (T0 regex indexing).",
      "C# semantic: optional Roslyn helper; unavailable when dotnet or helper binary is missing.",
    ],
  }),
  plugin({
    id: "python",
    label: "Python",
    projectTypes: ["python", "python-app", "django-app", "fastapi-app", "python-ml"],
    tier: "T1",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "tests", "handoff_sections"],
    semanticSupported: false,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: ["Python: T1 structural indexing; AST-level semantic edges are not enabled in base yet."],
  }),
  plugin({
    id: "go",
    label: "Go",
    projectTypes: ["go", "go-module"],
    tier: "T1",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "tests", "handoff_sections"],
    semanticSupported: false,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: ["Go: T1 structural indexing; go/types semantic edges are not enabled in base yet."],
  }),
  plugin({
    id: "rust",
    label: "Rust",
    projectTypes: ["rust", "rust-crate", "rust-workspace"],
    tier: "T1",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "handoff_sections"],
    semanticSupported: false,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: ["Rust: T1 structural indexing; rust-analyzer semantic edges are not enabled in base yet."],
  }),
  plugin({
    id: "terraform",
    label: "Terraform/IaC",
    projectTypes: ["terraform", "terraform-iac", "pulumi-iac", "k8s-manifests", "docker-compose"],
    tier: "T1",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "handoff_sections"],
    semanticSupported: false,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: ["Terraform/IaC: T1 config indexing; full IaC graph resolution is not enabled in base yet."],
  }),
  plugin({
    id: "java",
    label: "Java/Kotlin",
    projectTypes: ["java", "java-maven", "java-gradle", "kotlin-android", "kotlin-gradle"],
    tier: "T1.5",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "tests", "handoff_sections"],
    semanticSupported: true,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: [
      "Java/Kotlin: T1.5 semantic-lite indexing (project-aware imports, inheritance, tests, modules).",
      "Java/Kotlin optional JDK enrichment is best-effort; structural-lite fallback remains when JDK is unavailable.",
    ],
  }),
  plugin({
    id: "ruby",
    label: "Ruby/Rails",
    projectTypes: ["ruby", "ruby-app", "rails-app", "ruby-gem", "sinatra-app"],
    tier: "T1.5",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "tests", "handoff_sections"],
    semanticSupported: true,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: [
      "Ruby: T1.5 semantic-lite indexing (Gemfile/gemspec, require/require_relative, inheritance, Rails routes, specs); optional Ruby parser enrichment when available.",
      "Ruby optional parser enrichment is best-effort; structural-lite fallback remains when Ruby CLI is unavailable.",
    ],
  }),
  plugin({
    id: "php",
    label: "PHP/Composer",
    projectTypes: ["php", "php-app", "laravel-app", "symfony-app", "wordpress-plugin"],
    tier: "T1.5",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "tests", "handoff_sections"],
    semanticSupported: true,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: [
      "PHP: T1.5 semantic-lite indexing (Composer PSR-4, use/extends/implements, routes, hooks); optional PHP tokenizer enrichment when available.",
      "PHP optional tokenizer enrichment is best-effort; structural-lite fallback remains when PHP CLI is unavailable.",
    ],
  }),
  plugin({
    id: "swift",
    label: "Swift/Apple",
    projectTypes: ["swift", "swift-package", "swiftui-app", "ios-xcode"],
    tier: "T1",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "tests", "handoff_sections"],
    semanticSupported: false,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: [
      "Swift: T1 structural indexing (imports, types, extensions, tests); optional SourceKit enrichment when available.",
      "Swift optional SourceKit enrichment is not enabled in base yet; structural fallback remains when Xcode tooling is unavailable.",
    ],
  }),
  plugin({
    id: "cpp",
    label: "C/C++",
    projectTypes: ["cpp", "cpp-cmake", "c-embedded", "cpp-msvc", "cpp-meson"],
    tier: "T1",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "tests", "handoff_sections"],
    semanticSupported: false,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: [
      "C/C++: T1 structural indexing (includes, types, CMake/Make targets, tests); optional clang enrichment when available.",
      "C/C++ optional clang/compile_commands enrichment is not enabled in base yet; structural fallback remains when toolchain is unavailable.",
    ],
  }),
  plugin({
    id: "flutter",
    label: "Flutter/Dart",
    projectTypes: ["dart", "dart-package", "flutter-app", "flutter-plugin"],
    tier: "T1",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "tests", "handoff_sections"],
    semanticSupported: false,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: [
      "Dart/Flutter: T1 structural indexing (imports, types, widgets, pubspec dependencies, tests); optional Dart analyzer enrichment when available.",
      "Dart optional analyzer enrichment is not enabled in base yet; structural fallback remains when Dart SDK is unavailable.",
    ],
  }),
  plugin({
    id: "unity",
    label: "Unity",
    projectTypes: ["unity-app"],
    tier: "T1",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "handoff_sections"],
    semanticSupported: false,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: [
      "Unity: T1 structural indexing (asmdef references, scenes/prefabs as assets); C# scripts use .NET scanner; GUID script refs are not resolved.",
    ],
  }),
  plugin({
    id: "unreal",
    label: "Unreal Engine",
    projectTypes: ["unreal-project", "unreal-plugin"],
    tier: "T1",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "handoff_sections"],
    semanticSupported: false,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: [
      "Unreal: T1 structural indexing (modules, Build.cs dependencies, content assets); C++ uses C/C++ scanner; runtime UObject graph is not modeled.",
    ],
  }),
  plugin({
    id: "godot",
    label: "Godot",
    projectTypes: ["godot-project"],
    tier: "T1",
    capabilities: ["project_detection", "file_discovery", "symbols", "dependencies", "handoff_sections"],
    semanticSupported: false,
    handoffSections: [...T1_HANDOFF_SECTIONS],
    warnings: [
      "Godot: T1 structural indexing (GDScript, scenes, autoloads, static script-to-scene refs); engine runtime behavior is not modeled.",
    ],
  }),
  plugin({
    id: "generic",
    label: "Generic polyglot",
    projectTypes: [
      "generic",
      "generic-polyglot",
      "mixed-polyglot",
      "documentation-corpus",
      "empty-greenfield",
      "design-assets",
    ],
    tier: "T3",
    capabilities: ["project_detection", "file_discovery", "handoff_sections"],
    semanticSupported: false,
    handoffSections: ["source_trust", "project_type", "risks_and_gaps", "commands"],
    warnings: ["Generic scanner provides honest file-level coverage only."],
  }),
];

const registryById = new Map(SCANNER_REGISTRY.map((scanner) => [scanner.id, scanner]));

export function getScannerPlugin(scannerId: string) {
  return registryById.get(scannerId);
}

export function listScannerPlugins() {
  return [...SCANNER_REGISTRY];
}

export function resolveActiveScanners(typeIds: string[]) {
  const normalized = new Set(typeIds);
  const active = SCANNER_REGISTRY.filter((scanner) =>
    scanner.projectTypes.some((projectType) => normalized.has(projectType))
  );
  if (active.length > 0) return active;
  return [registryById.get("generic")!];
}

export function scannerHasCapability(scanner: ScannerPluginDefinition, capability: ScannerCapability) {
  return scanner.capabilities.includes(capability);
}

export function highestTierForScanners(scanners: ScannerPluginDefinition[]): ScannerSupportTier {
  const order: ScannerSupportTier[] = ["T0", "T1.5", "T1", "T2", "T3"];
  let best: ScannerSupportTier = "T3";
  for (const scanner of scanners) {
    if (order.indexOf(scanner.tier) < order.indexOf(best)) {
      best = scanner.tier;
    }
  }
  return best;
}

export function scannerRegistryDiagnostics(activeScannerIds: string[]) {
  const plugins = activeScannerIds
    .map((scannerId) => getScannerPlugin(scannerId))
    .filter((scanner): scanner is ScannerPluginDefinition => Boolean(scanner));
  return [
    `Active scanners: ${activeScannerIds.join(", ") || "generic"}.`,
    ...plugins.flatMap((scanner) => scanner.warnings ?? []),
  ];
}