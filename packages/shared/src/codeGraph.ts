export const CODE_GRAPH_SCHEMA_VERSION = "1";

export type UnifiedCodeGraphNodeKind =
  | "workspace"
  | "project"
  | "package"
  | "directory"
  | "code_file"
  | "config_file"
  | "doc_file"
  | "asset_file"
  | "symbol"
  | "test"
  | "route"
  | "command"
  | "community"
  | "god_node"
  | "external_dep";

export type UnifiedCodeGraphEdgeKind =
  | "belongs_to"
  | "depends_on"
  | "references"
  | "inherits"
  | "implements"
  | "tests"
  | "declares"
  | "documents"
  | "related_to"
  | "build_produces";

export type UnifiedCodeGraphProvenance = "extracted" | "inferred" | "ambiguous" | "manual";

export interface UnifiedCodeGraphNode {
  id: string;
  kind: UnifiedCodeGraphNodeKind;
  label: string;
  path?: string;
  scannerId?: string;
  projectType?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface UnifiedCodeGraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: UnifiedCodeGraphEdgeKind;
  provenance: UnifiedCodeGraphProvenance;
  label?: string;
  scannerId?: string;
}

export interface GraphAnalyzerAvailability {
  id: string;
  label: string;
  requiredRuntime: string;
  buildProbeCommand?: string;
  status: "enabled" | "disabled" | "unavailable";
  fallbackReason?: string;
  autoBuildCapable: boolean;
  preparedAt?: string;
  durationMs?: number;
}

export interface UnifiedCodeGraph {
  schemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION;
  workspaceRoot: string;
  generatedAt: string;
  nodes: UnifiedCodeGraphNode[];
  edges: UnifiedCodeGraphEdge[];
  activeScannerIds: string[];
  diagnostics: string[];
  analyzers?: GraphAnalyzerAvailability[];
}

export type ScannerCapability =
  | "project_detection"
  | "file_discovery"
  | "symbols"
  | "dependencies"
  | "tests"
  | "semantic"
  | "handoff_sections";

export type ScannerSupportTier = "T0" | "T1" | "T2" | "T3";

export interface ScannerPluginDefinition {
  id: string;
  label: string;
  projectTypes: string[];
  tier: ScannerSupportTier;
  capabilities: ScannerCapability[];
  semanticSupported: boolean;
  handoffSections: string[];
  fileLevelOnly?: boolean;
  warnings?: string[];
}

export type SkipReason =
  | "global"
  | "gitignore"
  | "dockerignore"
  | "oagignore"
  | "breaker"
  | "unsupported"
  | "too_large"
  | "unreadable";

export interface IgnoreRule {
  source: "global" | "gitignore" | "dockerignore" | "oagignore";
  pattern: string;
  rootRelativePath: string;
}

export interface SkipDiagnostic {
  path: string;
  reason: SkipReason;
  detail: string;
}

export interface ProjectTypeSignal {
  typeId: string;
  confidence: number;
  markers: string[];
}

export interface WorkspaceKernelProfile {
  schemaVersion: string;
  root: string;
  effectiveRoots: string[];
  primaryType: string;
  secondaryTypes: string[];
  typeSignals: ProjectTypeSignal[];
  sourceRoots: string[];
  markerPaths: string[];
  activeScannerIds: string[];
  ignoreRules: IgnoreRule[];
  sourceExtensionCounts: Record<string, number>;
  skippedCountsByReason: Partial<Record<SkipReason, number>>;
  warnings: string[];
}