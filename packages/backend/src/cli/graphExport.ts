import fs from "fs/promises";
import path from "path";
import {
  renderUnifiedGraphHandoffReport,
  renderUnifiedGraphHtml,
  renderUnifiedGraphWiki,
} from "@openagentgraph/shared";
import { runKernelWorkspaceScan } from "../scanner/kernel/scanKernel.js";
import {
  GRAPH_EXPORT_DIR_NAME,
  GRAPH_HANDOFF_FILE_NAME,
  GRAPH_HTML_FILE_NAME,
  GRAPH_JSON_FILE_NAME,
  GRAPH_WIKI_INDEX_FILE_NAME,
  readPreviousSymbolCount,
  requireWorkspaceOption,
  resolveGraphArtifactPath,
} from "./graphWorkspace.js";
import { readRequiredCliValue } from "./productGraphDataDir.js";

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
      options.workspace = readRequiredCliValue(argv, index, "--workspace");
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
  const previousSymbolCount = await readPreviousSymbolCount(workspaceRoot);
  const scanResult = await runKernelWorkspaceScan(workspaceRoot);
  const graph = scanResult.unifiedGraph;
  const reportWrittenAt = new Date().toISOString();

  const writtenPaths: string[] = [];
  if (formats.writeJson) {
    const outputPath = resolveGraphArtifactPath(workspaceRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_JSON_FILE_NAME));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
    writtenPaths.push(outputPath);
  }
  if (formats.writeHtml) {
    const outputPath = resolveGraphArtifactPath(workspaceRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_HTML_FILE_NAME));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, renderUnifiedGraphHtml(graph, { kernelProfile: scanResult.kernelProfile }), "utf8");
    writtenPaths.push(outputPath);
  }
  if (formats.writeWiki) {
    const outputPath = resolveGraphArtifactPath(workspaceRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_WIKI_INDEX_FILE_NAME));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, renderUnifiedGraphWiki(graph), "utf8");
    writtenPaths.push(outputPath);
  }
  if (formats.writeReport) {
    const outputPath = resolveGraphArtifactPath(workspaceRoot, GRAPH_HANDOFF_FILE_NAME);
    await fs.writeFile(
      outputPath,
      renderUnifiedGraphHandoffReport(graph, {
        kernelProfile: scanResult.kernelProfile,
        handoffPath: GRAPH_HANDOFF_FILE_NAME,
        handoffFreshness: {
          isStale: false,
          handoffPath: GRAPH_HANDOFF_FILE_NAME,
          graphGeneratedAt: graph.generatedAt,
          handoffUpdatedAt: reportWrittenAt,
          detail: "Handoff written during graph export.",
        },
        previousSymbolCount,
      }),
      "utf8"
    );
    writtenPaths.push(outputPath);
  }

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