import path from "path";
import {
  GraphWorkflowTimingCollector,
  summarizeGraphWorkflowTiming,
} from "@openagentgraph/shared";
import { buildGraphIncrementalManifest } from "@openagentgraph/shared/graphIncremental";
import { collectWorkspaceFileFingerprints } from "../scanner/kernel/graphFingerprints.js";
import { GRAPH_INCREMENTAL_TOOL_VERSION, runGraphWorkspaceUpdate } from "../scanner/kernel/graphIncrementalScan.js";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";
import { writeGraphArtifacts } from "./graphArtifactsWrite.js";
import {
  parseGraphWorkspaceArgv,
  requireWorkspaceOption,
  tryLoadCachedGraphManifest,
  tryLoadCachedWorkspaceGraph,
  warnIgnoredGraphCliOptions,
} from "./graphWorkspace.js";

interface GraphUpdateCliOptions {
  dryRun: boolean;
  writeReport: boolean;
}

function stripGraphUpdateOnlyFlags(argv: string[]) {
  const stripped: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run" || arg === "--report") {
      continue;
    }
    stripped.push(arg);
  }
  return stripped;
}

function parseGraphUpdateArgv(argv: string[]) {
  const updateOptions: GraphUpdateCliOptions = {
    dryRun: false,
    writeReport: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      updateOptions.dryRun = true;
    } else if (arg === "--report") {
      updateOptions.writeReport = true;
    }
  }

  const parsed = parseGraphWorkspaceArgv(stripGraphUpdateOnlyFlags(argv));

  if (parsed.positionals.length > 0) {
    throw new Error(`Unknown graph:update arguments: ${parsed.positionals.join(" ")}`);
  }

  return { graphOptions: parsed.options, updateOptions };
}

export async function runGraphUpdateCli(argv = process.argv.slice(2)) {
  const { graphOptions, updateOptions } = parseGraphUpdateArgv(argv);
  if (!graphOptions.json) warnIgnoredGraphCliOptions("update", graphOptions);
  const workspaceRoot = requireWorkspaceOption(graphOptions.workspace);
  const cachedGraph = graphOptions.refresh ? undefined : await tryLoadCachedWorkspaceGraph(workspaceRoot);
  const cachedManifest = graphOptions.refresh ? undefined : await tryLoadCachedGraphManifest(workspaceRoot);

  const workflowTiming = new GraphWorkflowTimingCollector();
  const result = await runGraphWorkspaceUpdate(workspaceRoot, {
    cachedGraph,
    manifest: cachedManifest,
    refresh: graphOptions.refresh,
    dryRun: updateOptions.dryRun,
    workflowTiming,
  });

  let writtenPaths: string[] = [];
  if (!updateOptions.dryRun && result.plan.mode !== "noop") {
    writtenPaths = await writeGraphArtifacts(workspaceRoot, result.graph, {
      writeJson: true,
      writeWiki: true,
      writeHtml: false,
      writeReport: updateOptions.writeReport,
      manifest: result.manifest,
      kernelProfile: result.kernelProfile,
    });
  }

  if (result.plan.mode === "full" && result.plan.reasons.length === 0 && !graphOptions.refresh) {
    result.plan.reasons.push("Full scan fallback reason was not recorded.");
  }

  const stageTimings = workflowTiming.buildReport();
  const payload = {
    status: result.plan.mode === "noop" ? "graph_update_noop" : "graph_update_complete",
    workspaceRoot,
    mode: result.plan.mode,
    dryRun: updateOptions.dryRun,
    reasons: result.plan.reasons,
    added: result.plan.added,
    changed: result.plan.changed,
    deleted: result.plan.deleted,
    scanPaths: result.plan.scanPaths,
    stripPaths: result.plan.stripPaths,
    neighborPaths: result.plan.neighborPaths,
    durationMs: result.durationMs,
    nodeCount: result.graph.nodes.length,
    edgeCount: result.graph.edges.length,
    writtenPaths,
    diagnostics: result.graph.diagnostics.slice(-8),
    stageTimings,
  };

  if (graphOptions.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Workspace: ${workspaceRoot}`);
    console.log(`Mode: ${result.plan.mode}`);
    console.log(`Duration: ${result.durationMs}ms`);
    for (const reason of result.plan.reasons) {
      console.log(`- ${reason}`);
    }
    if (result.plan.added.length > 0) console.log(`Added: ${result.plan.added.join(", ")}`);
    if (result.plan.changed.length > 0) console.log(`Changed: ${result.plan.changed.join(", ")}`);
    if (result.plan.deleted.length > 0) console.log(`Deleted: ${result.plan.deleted.join(", ")}`);
    if (updateOptions.dryRun) {
      console.log("Dry run: no artifacts written.");
    } else {
      for (const outputPath of writtenPaths) {
        console.log(`Wrote ${outputPath}`);
      }
    }
    console.log(summarizeGraphWorkflowTiming(stageTimings).join("\n"));
  }

  return payload;
}

export async function seedGraphWorkspaceForUpdate(
  workspaceRoot: string,
  input: { workflowTiming?: GraphWorkflowTimingCollector } = {}
) {
  const timing = input.workflowTiming;
  const scanResult = await runKernelWorkspaceScan(workspaceRoot, { workflowTiming: timing });
  const fingerprintResult = timing
    ? await timing.measure("fingerprint_cache_load", () => collectWorkspaceFileFingerprints(workspaceRoot))
    : await collectWorkspaceFileFingerprints(workspaceRoot);
  const manifest = buildGraphIncrementalManifest({
    graph: scanResult.unifiedGraph,
    kernelProfile: scanResult.kernelProfile,
    incrementalToolVersion: GRAPH_INCREMENTAL_TOOL_VERSION,
    ignoreRuleFingerprint: fingerprintResult.ignoreRuleFingerprint,
    files: fingerprintResult.files,
  });
  if (timing) {
    await timing.measure("static_artifact_rendering", () => writeGraphArtifacts(workspaceRoot, scanResult.unifiedGraph, {
      writeJson: true,
      writeWiki: true,
      manifest,
      kernelProfile: scanResult.kernelProfile,
    }));
  } else {
    await writeGraphArtifacts(workspaceRoot, scanResult.unifiedGraph, {
      writeJson: true,
      writeWiki: true,
      manifest,
      kernelProfile: scanResult.kernelProfile,
    });
  }
  return { graph: scanResult.unifiedGraph, manifest };
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphUpdate\.(?:ts|js)$/.test(invokedPath)) {
  runGraphUpdateCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}