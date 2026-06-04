import fs from "fs/promises";
import path from "path";
import type {
  ProductGraphHandoffWorkspacePathCheck,
  ProductGraphProjection,
  ProductGraphProjectionNode,
} from "@openagentgraph/shared";

export const PRODUCT_GRAPH_HANDOFF_PATH_CHECK_LIMIT = 2_000;

export function isPathInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function codeScanPathForTrustCheck(node: ProductGraphProjectionNode) {
  if (node.kind !== "code_file") return undefined;
  const metadataPath = typeof node.metadata?.scannerSourceFile === "string"
    ? node.metadata.scannerSourceFile
    : undefined;
  const sourcePath = node.source?.kind === "code_scan" ? node.source.path : undefined;
  return sourcePath ?? metadataPath;
}

function candidateCodePath(workspaceRoot: string, scannedPath: string) {
  const trimmed = scannedPath.replace(/\0/g, "").trim();
  if (!trimmed) return undefined;
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
  return path.resolve(workspaceRoot, trimmed.replace(/[\\/]+/g, path.sep));
}

export function sampleProductGraphScannedPaths(scannedPaths: string[], limit = PRODUCT_GRAPH_HANDOFF_PATH_CHECK_LIMIT) {
  const uniqueScannedPaths = [...new Set(
    scannedPaths
      .filter((value): value is string => Boolean(value?.trim()))
      .sort((left, right) => left.localeCompare(right))
  )];

  if (limit <= 0 || uniqueScannedPaths.length <= limit) return uniqueScannedPaths;
  if (limit === 1) return [uniqueScannedPaths[0]!];

  const selectedIndexes = new Set<number>();
  const maxIndex = uniqueScannedPaths.length - 1;
  for (let index = 0; index < limit; index += 1) {
    selectedIndexes.add(Math.round((index * maxIndex) / (limit - 1)));
  }

  for (let index = 0; selectedIndexes.size < limit && index < uniqueScannedPaths.length; index += 1) {
    selectedIndexes.add(index);
  }

  return [...selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => uniqueScannedPaths[index]!);
}

export async function checkProductGraphWorkspacePaths(
  projection: ProductGraphProjection,
  workspaceRoot: string,
  options: { limit?: number } = {}
): Promise<ProductGraphHandoffWorkspacePathCheck> {
  const scannedPaths = sampleProductGraphScannedPaths(
    projection.nodes.map(codeScanPathForTrustCheck).filter((value): value is string => Boolean(value)),
    options.limit ?? PRODUCT_GRAPH_HANDOFF_PATH_CHECK_LIMIT
  );

  if (scannedPaths.length === 0) {
    return {
      checkedFileCount: 0,
      missingFileCount: 0,
      status: "not_checked",
    };
  }

  let missingFileCount = 0;
  const resolvedRoot = path.resolve(workspaceRoot);
  for (const scannedPath of scannedPaths) {
    const candidate = candidateCodePath(resolvedRoot, scannedPath);
    if (!candidate || !isPathInsideRoot(resolvedRoot, candidate)) {
      missingFileCount += 1;
      continue;
    }
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) missingFileCount += 1;
    } catch {
      missingFileCount += 1;
    }
  }

  const checkedFileCount = scannedPaths.length;
  const status = missingFileCount === 0
    ? "aligned"
    : missingFileCount === checkedFileCount
      ? "mismatch"
      : "partial_mismatch";
  const warning = status === "mismatch"
    ? `${missingFileCount}/${checkedFileCount} checked Product Graph code files are missing under the current workspace root. The Product Graph database may describe a different workspace.`
    : status === "partial_mismatch"
      ? `${missingFileCount}/${checkedFileCount} checked Product Graph code files are missing under the current workspace root. Refresh the code scan before relying on file recommendations.`
      : undefined;

  return {
    checkedFileCount,
    missingFileCount,
    status,
    ...(warning ? { warning } : {}),
  };
}

export function formatHandoffWorkspaceRootForReport(workspaceRoot: string, isProduction: boolean) {
  return isProduction ? "configured workspace root" : workspaceRoot;
}

export function formatHandoffDataSourceForReport(databaseFilePath: string, isProduction: boolean) {
  return isProduction ? "SQLite database" : `SQLite ${databaseFilePath}`;
}
