import { buildGraphIncrementalManifest } from "@openagentgraph/shared/graphIncremental";
import { collectWorkspaceFileFingerprints } from "../scanner/kernel/graphFingerprints.js";
import { GRAPH_INCREMENTAL_TOOL_VERSION } from "../scanner/kernel/graphIncrementalScan.js";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";
import { writeGraphArtifacts } from "./graphArtifactsWrite.js";
import { readGraphWorkspaceCliValue, requireWorkspaceOption } from "./graphWorkspace.js";

interface GraphExportCliOptions {
  workspace?: string;
  refresh: boolean;
}

interface GraphExportFormatOptions {
  writeJson: boolean;
  writeHtml: boolean;
  writeWiki: boolean;
  writeReport: boolean;
}

function parseGraphExportArgv(argv: string[]) {
  const options: GraphExportCliOptions = { refresh: false };
  const formats: GraphExportFormatOptions = {
    writeJson: false,
    writeHtml: false,
    writeWiki: false,
    writeReport: false,
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      options.workspace = readGraphWorkspaceCliValue(argv, index);
      index += 1;
    } else if (arg === "--refresh") {
      options.refresh = true;
    } else if (arg === "--json") {
      formats.writeJson = true;
    } else if (arg === "--html") {
      formats.writeHtml = true;
    } else if (arg === "--wiki") {
      formats.writeWiki = true;
    } else if (arg === "--report") {
      formats.writeReport = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown graph:export option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  const anyExplicit = formats.writeJson || formats.writeHtml || formats.writeWiki || formats.writeReport;
  const resolvedFormats = anyExplicit
    ? formats
    : {
        writeJson: true,
        writeHtml: true,
        writeWiki: true,
        writeReport: true,
      };

  if (positionals.length > 0) {
    throw new Error(`Unknown graph:export arguments: ${positionals.join(" ")}`);
  }

  return { options, formats: resolvedFormats };
}

export async function runGraphExportCli(argv = process.argv.slice(2)) {
  const { options, formats } = parseGraphExportArgv(argv);
  const workspaceRoot = requireWorkspaceOption(options.workspace);
  const scanResult = await runKernelWorkspaceScan(workspaceRoot);
  const graph = scanResult.unifiedGraph;
  const fingerprintResult = await collectWorkspaceFileFingerprints(workspaceRoot);
  const manifest = buildGraphIncrementalManifest({
    graph,
    kernelProfile: scanResult.kernelProfile,
    incrementalToolVersion: GRAPH_INCREMENTAL_TOOL_VERSION,
    ignoreRuleFingerprint: fingerprintResult.ignoreRuleFingerprint,
    files: fingerprintResult.files,
  });

  const writtenPaths = await writeGraphArtifacts(workspaceRoot, graph, {
    writeJson: formats.writeJson,
    writeHtml: formats.writeHtml,
    writeWiki: formats.writeWiki,
    writeReport: formats.writeReport,
    manifest,
    kernelProfile: scanResult.kernelProfile,
  });

  const payload = {
    status: "graph_export_complete",
    workspaceRoot,
    formats,
    writtenPaths,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    activeScannerIds: graph.activeScannerIds,
    primaryType: scanResult.kernelProfile.primaryType,
  };

  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length}`);
  console.log(`Scanners: ${graph.activeScannerIds.join(", ") || "generic"}`);
  for (const outputPath of writtenPaths) {
    console.log(`Wrote ${outputPath}`);
  }
  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphExport\.(?:ts|js)$/.test(invokedPath)) {
  runGraphExportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}