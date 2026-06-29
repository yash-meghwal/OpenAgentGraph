import {
  buildAgentHarnessReport,
  buildHarnessImprovementProposals,
  buildVerificationMap,
  evaluateContextNoise,
  evaluateGraphSpecQuality,
  evaluateOagFusionChecks,
  summarizeDocLinkHygiene,
  summarizeDocLinkRepair,
  summarizeEcosystemSupportForAgents,
  type HarnessImprovementProposalResult,
} from "@openagentgraph/shared";
import {
  buildHarnessContextNoiseDiagnostics,
  loadHarnessWorkspaceMetadata,
} from "./graphHarnessMetadata.js";
import { readHandoffFreshness } from "./graphWorkspace.js";
import { detectWorkspaceKernelProfile } from "../scanner/kernel/workspaceDetection.js";
import type { LoadedWorkspaceGraph } from "./graphWorkspace.js";

export async function buildWorkspaceHarnessImprovementProposals(
  workspaceRoot: string,
  loaded: LoadedWorkspaceGraph,
  options: {
    updateBenchmarkFailures?: string[];
    pathQueryMisses?: Array<{ kind: "path" | "query"; detail: string }>;
    learnLogText?: string;
  } = {}
): Promise<HarnessImprovementProposalResult> {
  const kernelProfile = loaded.kernelProfile ?? await detectWorkspaceKernelProfile(workspaceRoot);
  const handoffFreshness = await readHandoffFreshness(workspaceRoot, loaded.graph.generatedAt);
  const metadata = loadHarnessWorkspaceMetadata(workspaceRoot);
  const specQuality = evaluateGraphSpecQuality(loaded.graph, { metadata });
  const verificationMap = buildVerificationMap(loaded.graph, metadata);
  const contextNoiseDiagnostics = buildHarnessContextNoiseDiagnostics(workspaceRoot, loaded.graph, {
    metadata,
    kernelProfile,
  });
  const contextNoise = evaluateContextNoise(loaded.graph, contextNoiseDiagnostics);
  const docLinkHygiene = summarizeDocLinkHygiene(loaded.graph);
  const docsRepair = summarizeDocLinkRepair(loaded.graph);
  const fusion = evaluateOagFusionChecks({
    graph: loaded.graph,
    kernelProfile,
    handoffFreshness,
  });
  const ecosystemSupport = summarizeEcosystemSupportForAgents({
    graph: loaded.graph,
    kernelProfile,
  });
  const agentHarnessReport = buildAgentHarnessReport({
    graph: loaded.graph,
    kernelProfile,
    metadata,
    handoffFreshness,
    contextNoise,
    contextNoiseDiagnostics,
    specQuality,
    verificationMap,
  });

  let learnLogFindings;
  if (options.learnLogText?.trim()) {
    const { analyzeGraphLearnLog } = await import("@openagentgraph/shared");
    learnLogFindings = analyzeGraphLearnLog(options.learnLogText, { workspaceRoot }).findings;
  }

  return buildHarnessImprovementProposals({
    workspaceRoot,
    specQuality,
    contextNoise,
    verificationMap,
    handoffFreshness,
    docLinkDiagnostics: docLinkHygiene.diagnostics,
    docsRepair,
    agentHarnessReport,
    fusionChecks: fusion.checks,
    ecosystemSupport,
    updateBenchmarkFailures: options.updateBenchmarkFailures,
    pathQueryMisses: options.pathQueryMisses,
    learnLogFindings,
  });
}