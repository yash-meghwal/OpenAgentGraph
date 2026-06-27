import fs from "fs/promises";
import path from "path";
import type { GraphIncrementalManifest, UnifiedCodeGraph, WorkspaceKernelProfile } from "@openagentgraph/shared";
import {
  buildGraphExportDocument,
  renderUnifiedGraphHandoffReport,
  renderUnifiedGraphHtml,
  renderUnifiedGraphWiki,
  type GraphWorkflowTimingCollector,
} from "@openagentgraph/shared";
import {
  GRAPH_EXPORT_DIR_NAME,
  GRAPH_HANDOFF_FILE_NAME,
  GRAPH_HTML_FILE_NAME,
  GRAPH_JSON_FILE_NAME,
  GRAPH_MANIFEST_FILE_NAME,
  GRAPH_WIKI_INDEX_FILE_NAME,
  readPreviousSymbolCount,
  resolveGraphArtifactPath,
} from "./graphWorkspace.js";

export interface WriteGraphArtifactsOptions {
  writeJson?: boolean;
  writeWiki?: boolean;
  writeHtml?: boolean;
  writeReport?: boolean;
  manifest?: GraphIncrementalManifest;
  kernelProfile?: WorkspaceKernelProfile;
  handoffUpdatedAt?: string;
  /** Workspace-relative handoff report path; defaults to GRAPH_REPORT.md. */
  handoffPath?: string;
  redactRoot?: boolean;
  workflowTiming?: GraphWorkflowTimingCollector;
}

export async function writeGraphArtifacts(
  workspaceRoot: string,
  graph: UnifiedCodeGraph,
  options: WriteGraphArtifactsOptions = {}
) {
  const {
    writeJson = true,
    writeWiki = true,
    writeHtml = false,
    writeReport = false,
    manifest,
    kernelProfile,
    handoffUpdatedAt = new Date().toISOString(),
    handoffPath = GRAPH_HANDOFF_FILE_NAME,
    redactRoot = false,
  } = options;
  const writtenPaths: string[] = [];
  const previousSymbolCount = await readPreviousSymbolCount(workspaceRoot);

  const exportGraph = buildGraphExportDocument(graph, kernelProfile, {
    exportedAt: handoffUpdatedAt,
    redactRoot,
  });

  if (writeJson) {
    const outputPath = resolveGraphArtifactPath(workspaceRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_JSON_FILE_NAME));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(exportGraph, null, 2)}\n`, "utf8");
    writtenPaths.push(outputPath);
  }

  if (manifest && writeJson) {
    const outputPath = resolveGraphArtifactPath(workspaceRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_MANIFEST_FILE_NAME));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writtenPaths.push(outputPath);
  }

  if (writeHtml && kernelProfile) {
    const outputPath = resolveGraphArtifactPath(workspaceRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_HTML_FILE_NAME));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, renderUnifiedGraphHtml(exportGraph, { kernelProfile, redactRoot }), "utf8");
    writtenPaths.push(outputPath);
  }

  if (writeWiki) {
    const outputPath = resolveGraphArtifactPath(workspaceRoot, path.join(GRAPH_EXPORT_DIR_NAME, GRAPH_WIKI_INDEX_FILE_NAME));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, renderUnifiedGraphWiki(exportGraph, { kernelProfile, redactRoot }), "utf8");
    writtenPaths.push(outputPath);
  }

  if (writeReport && kernelProfile) {
    const outputPath = resolveGraphArtifactPath(workspaceRoot, handoffPath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      renderUnifiedGraphHandoffReport(exportGraph, {
        kernelProfile,
        handoffPath,
        redactRoot,
        handoffFreshness: {
          isStale: false,
          handoffPath,
          graphGeneratedAt: graph.generatedAt,
          handoffUpdatedAt,
          detail: "Handoff written during graph artifact update.",
        },
        previousSymbolCount,
      }),
      "utf8"
    );
    writtenPaths.push(outputPath);
  }

  return writtenPaths;
}