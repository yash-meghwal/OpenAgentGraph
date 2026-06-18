export const CODE_GRAPH_SCHEMA_VERSION = "1";

export type UnifiedCodeGraphNodeKind =
  | "workspace"
  | "project"
  | "package"
  | "directory"
  | "code_file"
  | "config_file"
  | "doc_file"
  | "doc_section"
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
  /** Derivation trust source, e.g. roslyn, typescript, php-semantic-lite. */
  source?: import("./graphEdgeProvenance.js").GraphEdgeDerivationSource;
  /** Confidence from 0 to 1; required for inferred/ambiguous edges. */
  confidence?: number;
  label?: string;
  scannerId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export type ScannerSupportTier = "T0" | "T1.5" | "T1" | "T2" | "T3";

export type GraphAnalyzerMode =
  | "disabled"
  | "unavailable"
  | "structural"
  | "semantic-lite"
  | "semantic";

export interface GraphAnalyzerAvailability {
  id: string;
  label: string;
  /** Ecosystem scanner id this analyzer enriches, e.g. dotnet, java, php. */
  ecosystemId?: string;
  /** Highest tier this analyzer can contribute when enabled. */
  tierContribution?: ScannerSupportTier;
  /** Analyzer operating mode; complements legacy status for handoff clarity. */
  mode?: GraphAnalyzerMode;
  requiredRuntime: string;
  /** Human-readable setup hints (argv-safe commands only). */
  setupCommandHints?: string[];
  buildProbeCommand?: string;
  status: "enabled" | "disabled" | "unavailable";
  fallbackReason?: string;
  autoBuildCapable: boolean;
  preparedAt?: string;
  durationMs?: number;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface GraphProvenanceSummary {
  extractedEdgeCount: number;
  inferredEdgeCount: number;
  ambiguousEdgeCount: number;
  manualEdgeCount: number;
  extractedPercent: number;
}

export interface EcosystemSupportMatrixRow {
  ecosystemId: string;
  projectType: string;
  scannerId: string;
  tier: string;
  semanticSupported: boolean;
  indexedFileCount: number;
  symbolCount: number;
  relationshipCount: number;
  skippedGeneratedCount: number;
  limitation: string;
}

export interface GraphExportMetadata {
  graphVersion: string;
  exportedAt: string;
  scannerProfile?: WorkspaceKernelProfile;
  ecosystemSupportMatrix?: EcosystemSupportMatrixRow[];
  communities: Array<{
    id: string;
    label: string;
    path?: string;
    kind?: string;
    fileCount: number;
    summary: string;
    topFiles: string[];
    taskLens?: string;
  }>;
  provenance: GraphProvenanceSummary;
  analyzers?: GraphAnalyzerAvailability[];
  primaryLens: string;
  refreshCommands: string[];
  risks: string[];
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
  export?: GraphExportMetadata;
}

export type ScannerCapability =
  | "project_detection"
  | "file_discovery"
  | "symbols"
  | "dependencies"
  | "tests"
  | "semantic"
  | "handoff_sections";

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