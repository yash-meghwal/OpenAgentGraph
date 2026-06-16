import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { ProductEdgeKind, ProductGraphEdge, ProductMetadataValue } from "@openagentgraph/shared";
import {
  isResolvedDotNetRelationshipEdge,
  resolveDotNetSymbolId,
  type DotNetSymbolLookup,
} from "./dotnetScanner.js";

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
  const candidates = [
    path.resolve(__dirname, "../../../scanner-tools/roslyn-helper/bin/Release/net8.0/RoslynHelper.dll"),
    path.resolve(__dirname, "../../../scanner-tools/roslyn-helper/bin/Debug/net8.0/RoslynHelper.dll"),
    path.resolve(process.cwd(), "packages/backend/scanner-tools/roslyn-helper/bin/Release/net8.0/RoslynHelper.dll"),
    path.resolve(process.cwd(), "scanner-tools/roslyn-helper/bin/Release/net8.0/RoslynHelper.dll"),
  ];
  return candidates[0]!;
}

export async function findRoslynHelperDllPath() {
  const candidates = [
    path.resolve(__dirname, "../../../scanner-tools/roslyn-helper/bin/Release/net8.0/RoslynHelper.dll"),
    path.resolve(__dirname, "../../../scanner-tools/roslyn-helper/bin/Debug/net8.0/RoslynHelper.dll"),
    path.resolve(process.cwd(), "packages/backend/scanner-tools/roslyn-helper/bin/Release/net8.0/RoslynHelper.dll"),
    path.resolve(process.cwd(), "scanner-tools/roslyn-helper/bin/Release/net8.0/RoslynHelper.dll"),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

const DOTNET_PROBE_TIMEOUT_MS = 5_000;

export async function probeRoslynHelperAvailability() {
  const dllPath = await findRoslynHelperDllPath();
  if (!dllPath) {
    return { available: false as const, reason: "Roslyn helper binary not built." };
  }

  return new Promise<{ available: boolean; reason?: string }>((resolve) => {
    const child = spawn("dotnet", ["--version"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (result: { available: boolean; reason?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ available: false, reason: "dotnet CLI probe timed out." });
    }, DOTNET_PROBE_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", () => finish({ available: false, reason: "dotnet CLI unavailable." }));
    child.on("close", (code) => {
      if (code === 0) finish({ available: true });
      else finish({ available: false, reason: stderr.trim() || "dotnet CLI unavailable." });
    });
  });
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

async function invokeRoslynHelper(request: RoslynHelperRequest, timeoutMs: number) {
  const dllPath = await findRoslynHelperDllPath();
  if (!dllPath) {
    throw new Error("Roslyn helper binary not built.");
  }

  return new Promise<RoslynHelperResponse>((resolve, reject) => {
    const child = spawn("dotnet", ["exec", dllPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Roslyn helper timed out after ${timeoutMs}ms.`));
    }, timeoutMs + 2_000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!stdout.trim()) {
        reject(new Error(stderr.trim() || `Roslyn helper exited with code ${code ?? "unknown"}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as RoslynHelperResponse);
      } catch (error) {
        reject(new Error(error instanceof Error ? error.message : "Failed to parse Roslyn helper JSON."));
      }
    });

    child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
  });
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
    return {
      ...empty,
      unavailableReason: "disabled for test",
      diagnostics: buildDotNetSemanticDiagnostics({
        ...empty,
        unavailableReason: "disabled for test",
      }),
    };
  }

  const probe = await probeRoslynHelperAvailability();
  if (!probe.available) {
    return {
      ...empty,
      enabled: true,
      unavailableReason: probe.reason,
      diagnostics: buildDotNetSemanticDiagnostics({
        ...empty,
        enabled: true,
        unavailableReason: probe.reason,
      }),
    };
  }

  const limits = { ...DEFAULT_ROSLYN_LIMITS, ...input.limits };
  if (!input.solutionPath && (!input.projectPaths || input.projectPaths.length === 0)) {
    return {
      ...empty,
      enabled: true,
      unavailableReason: "No solution or project path available for Roslyn analysis.",
      diagnostics: buildDotNetSemanticDiagnostics({
        ...empty,
        enabled: true,
        unavailableReason: "No solution or project path available for Roslyn analysis.",
      }),
    };
  }

  try {
    const response = await invokeRoslynHelper(
      {
        workspaceRoot: input.workspaceRoot,
        solutionPath: input.solutionPath,
        projectPaths: input.projectPaths,
        limits,
      },
      limits.maxDurationMs
    );

    if (response.status !== "ok") {
      const fallbackReason = response.reason ?? "Roslyn helper failed.";
      const result: DotNetRoslynSemanticResult = {
        enabled: true,
        succeeded: false,
        fallbackReason,
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