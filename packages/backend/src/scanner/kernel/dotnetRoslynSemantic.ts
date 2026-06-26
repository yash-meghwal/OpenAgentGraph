import type { GraphAnalyzerAvailability, GraphWorkflowTimingCollector, ProductEdgeKind, ProductGraphEdge, ProductMetadataValue } from "@openagentgraph/shared";
import { runAnalyzerHelper, validateAnalyzerHelperJson } from "./analyzerHelperRunner.js";
import {
  isResolvedDotNetRelationshipEdge,
  resolveDotNetSymbolId,
  type DotNetSymbolLookup,
} from "./dotnetScanner.js";
import {
  buildRoslynAnalyzerAvailability,
  ensureRoslynHelperPrepared,
  findRoslynHelperDllPath,
  probeDotNetSdkAvailability,
  resolveRoslynHelperDllCandidates,
} from "./roslynHelperPreparation.js";

export const DOTNET_ROSLYN_SEMANTIC_VERSION = "1.0";

const DEFAULT_ROSLYN_LIMITS = {
  maxFiles: 200,
  maxDurationMs: 30_000,
  maxEdges: 2_000,
  maxOutputBytes: 2_000_000,
};

export interface DotNetRoslynSemanticResult {
  enabled: boolean;
  succeeded: boolean;
  unavailableReason?: string;
  fallbackReason?: string;
  analyzer?: GraphAnalyzerAvailability;
  edges: ProductGraphEdge[];
  edgeCount: number;
  diagnostics: string[];
  durationMs: number;
  filesAnalyzed: number;
}

interface RoslynHelperRequest {
  workspaceRoot: string;
  solutionPath?: string;
  projectPaths?: string[];
  limits?: typeof DEFAULT_ROSLYN_LIMITS;
}

interface RoslynSemanticEdgePayload {
  sourceFile: string;
  sourceKind: string;
  sourceName: string;
  sourceParentType?: string;
  targetFile: string;
  targetKind: string;
  targetName: string;
  targetParentType?: string;
  edgeKind: string;
  line: number;
  relation: string;
}

interface RoslynHelperResponse {
  status: "ok" | "failed" | "unavailable";
  reason?: string;
  diagnostics?: string[];
  edges?: RoslynSemanticEdgePayload[];
  stats?: {
    filesAnalyzed?: number;
    edgeCount?: number;
    durationMs?: number;
    outputBytes?: number;
  };
}

export function resolveRoslynHelperDllPath() {
  return resolveRoslynHelperDllCandidates()[0]!;
}

export { findRoslynHelperDllPath } from "./roslynHelperPreparation.js";

export async function probeRoslynHelperAvailability() {
  const dllPath = await findRoslynHelperDllPath();
  if (!dllPath) {
    return { available: false as const, reason: "Roslyn helper binary not built." };
  }

  const dotnet = await probeDotNetSdkAvailability();
  if (!dotnet.available) {
    return { available: false as const, reason: dotnet.reason ?? "dotnet CLI unavailable." };
  }
  return { available: true as const };
}

export function buildDotNetSemanticDiagnostics(result: DotNetRoslynSemanticResult) {
  const lines = ["C# structural: available (T0)."];
  if (!result.enabled) {
    lines.push(`C# semantic: unavailable (${result.unavailableReason ?? "disabled"}).`);
    return lines;
  }
  if (result.succeeded) {
    lines.push(`C# semantic: enabled (${result.edgeCount} Roslyn edge(s), ${result.durationMs}ms).`);
    return lines;
  }
  lines.push(`C# semantic: failed (${result.fallbackReason ?? "unknown"}).`);
  return lines;
}

function mapRoslynKindToProductKind(edgeKind: string): ProductEdgeKind {
  switch (edgeKind) {
    case "extends":
      return "extends";
    case "implements":
      return "implements";
    case "calls":
    case "tests":
    default:
      return "uses";
  }
}

export function mapRoslynSemanticEdges(input: {
  payload: RoslynSemanticEdgePayload[];
  symbolLookup: DotNetSymbolLookup;
  knownNodeIds: Set<string>;
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  sourceRef: (projectPath: string, line?: number) => ProductGraphEdge["source"];
  maxEdgeLabelLength: number;
}) {
  const edges: ProductGraphEdge[] = [];

  for (const edge of input.payload) {
    const sourceSymbolId = resolveDotNetSymbolId(input.symbolLookup, {
      filePath: edge.sourceFile,
      kind: edge.sourceKind,
      name: edge.sourceName,
      parentType: edge.sourceParentType,
    });
    const targetSymbolId = resolveDotNetSymbolId(input.symbolLookup, {
      filePath: edge.targetFile,
      kind: edge.targetKind,
      name: edge.targetName,
      parentType: edge.targetParentType,
    });
    if (!sourceSymbolId || !targetSymbolId) continue;
    if (!input.knownNodeIds.has(sourceSymbolId) || !input.knownNodeIds.has(targetSymbolId)) continue;

    const productEdge: ProductGraphEdge = {
      id: input.stableId("code-scan:edge", `${sourceSymbolId}|${edge.relation}|${targetSymbolId}|${edge.line}`),
      sourceNodeId: sourceSymbolId,
      targetNodeId: targetSymbolId,
      kind: mapRoslynKindToProductKind(edge.edgeKind),
      trust: "extracted",
      label: `${edge.edgeKind} ${edge.sourceParentType ? `${edge.sourceParentType}.` : ""}${edge.sourceName} -> ${edge.targetParentType ? `${edge.targetParentType}.` : ""}${edge.targetName}`.slice(0, input.maxEdgeLabelLength),
      source: input.sourceRef(edge.sourceFile, edge.line),
      metadata: input.compactMetadata({
        edgeDerivationSource: "roslyn",
        scannerRelation: edge.relation,
        scannerResolution: "semantic",
        scannerDotNetRoslynVersion: DOTNET_ROSLYN_SEMANTIC_VERSION,
        scannerLanguage: "csharp",
        scanId: input.scanId,
        scannedAt: input.scannedAt,
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    };

    if (!isResolvedDotNetRelationshipEdge(productEdge, input.knownNodeIds)) continue;
    edges.push(productEdge);
  }

  return edges;
}

function isRoslynHelperResponse(value: unknown): value is RoslynHelperResponse {
  if (!value || typeof value !== "object") return false;
  const status = (value as RoslynHelperResponse).status;
  return status === "ok" || status === "failed" || status === "unavailable";
}

async function invokeRoslynHelper(request: RoslynHelperRequest, timeoutMs: number) {
  const dllPath = await findRoslynHelperDllPath();
  if (!dllPath) {
    throw new Error("Roslyn helper binary not built.");
  }

  const result = await runAnalyzerHelper<RoslynHelperResponse>({
    run: {
      command: ["dotnet", "exec", dllPath],
      workspaceRoot: request.workspaceRoot,
      stdinPayload: request,
      limits: { timeoutMs },
    },
  });

  if (result.timedOut) {
    throw new Error(result.error ?? `Roslyn helper timed out after ${timeoutMs}ms.`);
  }

  if (result.stdout.trim()) {
    try {
      const validated = validateAnalyzerHelperJson(JSON.parse(result.stdout), isRoslynHelperResponse);
      if (validated.ok) {
        return validated.value;
      }
    } catch {
      // fall through to invocation error handling
    }
  }

  if (!result.ok || !result.stdout.trim()) {
    throw new Error(
      result.error
      ?? result.parseError
      ?? result.stderr.trim()
      ?? "Roslyn helper invocation failed."
    );
  }

  throw new Error(result.parseError ?? "Roslyn helper returned invalid JSON.");
}

export async function runDotNetRoslynSemanticAnalysis(input: {
  workspaceRoot: string;
  solutionPath?: string;
  projectPaths?: string[];
  symbolLookup: DotNetSymbolLookup;
  knownNodeIds: Set<string>;
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  sourceRef: (projectPath: string, line?: number) => ProductGraphEdge["source"];
  maxEdgeLabelLength: number;
  limits?: Partial<typeof DEFAULT_ROSLYN_LIMITS>;
  disabled?: boolean;
  workflowTiming?: GraphWorkflowTimingCollector;
}): Promise<DotNetRoslynSemanticResult> {
  const startedAt = Date.now();
  const empty: DotNetRoslynSemanticResult = {
    enabled: false,
    succeeded: false,
    edges: [],
    edgeCount: 0,
    diagnostics: [],
    durationMs: 0,
    filesAnalyzed: 0,
  };

  if (input.disabled) {
    const analyzer = buildRoslynAnalyzerAvailability({
      status: "disabled",
      fallbackReason: "disabled for test",
    });
    return {
      ...empty,
      unavailableReason: "disabled for test",
      analyzer,
      diagnostics: buildDotNetSemanticDiagnostics({
        ...empty,
        unavailableReason: "disabled for test",
      }),
    };
  }

  const preparation = input.workflowTiming
    ? await input.workflowTiming.measure("roslyn_preparation", () => ensureRoslynHelperPrepared({ autoBuild: true }))
    : await ensureRoslynHelperPrepared({ autoBuild: true });
  if (preparation.availability.status !== "enabled" || !preparation.dllPath) {
    return {
      ...empty,
      enabled: true,
      unavailableReason: preparation.availability.fallbackReason,
      analyzer: preparation.availability,
      diagnostics: buildDotNetSemanticDiagnostics({
        ...empty,
        enabled: true,
        unavailableReason: preparation.availability.fallbackReason,
      }),
    };
  }

  const limits = { ...DEFAULT_ROSLYN_LIMITS, ...input.limits };
  if (!input.solutionPath && (!input.projectPaths || input.projectPaths.length === 0)) {
    return {
      ...empty,
      enabled: true,
      unavailableReason: "No solution or project path available for Roslyn analysis.",
      analyzer: preparation.availability,
      diagnostics: buildDotNetSemanticDiagnostics({
        ...empty,
        enabled: true,
        unavailableReason: "No solution or project path available for Roslyn analysis.",
      }),
    };
  }

  try {
    const invokeAnalysis = () => invokeRoslynHelper(
      {
        workspaceRoot: input.workspaceRoot,
        solutionPath: input.solutionPath,
        projectPaths: input.projectPaths,
        limits,
      },
      limits.maxDurationMs
    );
    const response = input.workflowTiming
      ? await input.workflowTiming.measure("roslyn_analysis", invokeAnalysis)
      : await invokeAnalysis();

    if (response.status !== "ok") {
      const fallbackReason = response.reason ?? "Roslyn helper failed.";
      const result: DotNetRoslynSemanticResult = {
        enabled: true,
        succeeded: false,
        fallbackReason,
        analyzer: preparation.availability,
        edges: [],
        edgeCount: 0,
        diagnostics: buildDotNetSemanticDiagnostics({
          enabled: true,
          succeeded: false,
          fallbackReason,
          edges: [],
          edgeCount: 0,
          diagnostics: [],
          durationMs: Date.now() - startedAt,
          filesAnalyzed: 0,
        }),
        durationMs: Date.now() - startedAt,
        filesAnalyzed: response.stats?.filesAnalyzed ?? 0,
      };
      return result;
    }

    const mappedEdges = mapRoslynSemanticEdges({
      payload: response.edges ?? [],
      symbolLookup: input.symbolLookup,
      knownNodeIds: input.knownNodeIds,
      scanId: input.scanId,
      scannedAt: input.scannedAt,
      stableId: input.stableId,
      compactMetadata: input.compactMetadata,
      sourceRef: input.sourceRef,
      maxEdgeLabelLength: input.maxEdgeLabelLength,
    });

    const result: DotNetRoslynSemanticResult = {
      enabled: true,
      succeeded: true,
      analyzer: preparation.availability,
      edges: mappedEdges,
      edgeCount: mappedEdges.length,
      durationMs: response.stats?.durationMs ?? Date.now() - startedAt,
      filesAnalyzed: response.stats?.filesAnalyzed ?? 0,
      diagnostics: buildDotNetSemanticDiagnostics({
        enabled: true,
        succeeded: true,
        edges: mappedEdges,
        edgeCount: mappedEdges.length,
        diagnostics: [],
        durationMs: response.stats?.durationMs ?? Date.now() - startedAt,
        filesAnalyzed: response.stats?.filesAnalyzed ?? 0,
      }),
    };
    return result;
  } catch (error) {
    const fallbackReason = error instanceof Error ? error.message : "Roslyn helper invocation failed.";
    return {
      enabled: true,
      succeeded: false,
      fallbackReason,
      analyzer: preparation.availability,
      edges: [],
      edgeCount: 0,
      diagnostics: buildDotNetSemanticDiagnostics({
        enabled: true,
        succeeded: false,
        fallbackReason,
        edges: [],
        edgeCount: 0,
        diagnostics: [],
        durationMs: Date.now() - startedAt,
        filesAnalyzed: 0,
      }),
      durationMs: Date.now() - startedAt,
      filesAnalyzed: 0,
    };
  }
}