import type { ScannerCapability, ScannerPluginDefinition, ScannerSupportTier } from "@openagentgraph/shared";

export const SCANNER_REGISTRY_VERSION = "1.1";

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
      "handoff_sections",
    ],
    semanticSupported: false,
    handoffSections: [...DEFAULT_HANDOFF_SECTIONS],
    warnings: ["C#/.NET: T0 structural indexing; Roslyn semantic resolution is not enabled in base yet."],
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
    projectTypes: ["java", "java-maven", "java-gradle", "kotlin-android"],
    tier: "T2",
    capabilities: ["project_detection", "file_discovery", "handoff_sections"],
    semanticSupported: false,
    handoffSections: ["source_trust", "project_type", "risks_and_gaps", "commands"],
    warnings: ["Java/Kotlin scanner is marker/file-level only in Phase 4."],
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
  const order: ScannerSupportTier[] = ["T0", "T1", "T2", "T3"];
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