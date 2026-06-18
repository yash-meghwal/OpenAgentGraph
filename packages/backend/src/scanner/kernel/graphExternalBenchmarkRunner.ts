import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

export const EXTERNAL_BENCHMARK_CLONE_TIMEOUT_MS = 120_000;
import type {
  GraphExternalBenchmarkCategoryId,
  GraphExternalBenchmarkScorecard,
} from "@openagentgraph/shared";
import {
  evaluateGraphExternalBenchmark,
  findExternalBenchmarkCatalogEntry,
  GRAPH_EXTERNAL_BENCHMARK_CATALOG,
} from "@openagentgraph/shared";
import { runGraphUpdateBenchmarkForWorkspace } from "./graphUpdateBenchmarkRunner.js";
import { runKernelWorkspaceScan } from "./scanKernel.js";

function normalizeRelativePath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function validateExternalBenchmarkCloneUrl(cloneUrl: string) {
  const trimmed = cloneUrl.trim();
  if (!trimmed) {
    throw new Error("Clone URL must not be empty.");
  }
  if (/^(?:git@|ssh:|file:)/i.test(trimmed)) {
    throw new Error(`Clone URL must use http or https scheme: '${cloneUrl}'.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid clone URL '${cloneUrl}'.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Clone URL must use http or https scheme: '${cloneUrl}'.`);
  }
  if (!parsed.hostname) {
    throw new Error(`Clone URL is missing a hostname: '${cloneUrl}'.`);
  }
  return trimmed;
}

export function cloneExternalBenchmarkRepository(
  cloneUrl: string,
  options: { timeoutMs?: number } = {}
) {
  const validatedUrl = validateExternalBenchmarkCloneUrl(cloneUrl);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oag-external-benchmark-"));
  try {
    execFileSync(
      "git",
      ["clone", "--depth", "1", "--", validatedUrl, tempRoot],
      {
        stdio: "pipe",
        timeout: options.timeoutMs ?? EXTERNAL_BENCHMARK_CLONE_TIMEOUT_MS,
      }
    );
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    workspaceRoot: tempRoot,
    tempRoot,
    sourceLabel: validatedUrl,
  };
}

export function cleanupExternalBenchmarkWorkspace(tempRoot: string | undefined) {
  if (!tempRoot) return;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

export function resolveExternalBenchmarkWorkspace(input: {
  workspaceRoot?: string;
  cloneUrl?: string;
  localFixture?: string;
  fixturesRoot: string;
  cloneTimeoutMs?: number;
}) {
  if (input.cloneUrl) {
    return cloneExternalBenchmarkRepository(input.cloneUrl, {
      timeoutMs: input.cloneTimeoutMs,
    });
  }

  if (input.workspaceRoot) {
    return {
      workspaceRoot: path.resolve(input.workspaceRoot),
      sourceLabel: path.resolve(input.workspaceRoot),
    };
  }

  if (input.localFixture) {
    return {
      workspaceRoot: path.resolve(input.fixturesRoot, input.localFixture),
      sourceLabel: input.localFixture,
    };
  }

  throw new Error("External benchmark requires --workspace, --clone, or --catalog.");
}

export async function runGraphExternalBenchmarkForWorkspace(input: {
  categoryId: GraphExternalBenchmarkCategoryId;
  workspaceRoot: string;
  localFixture?: string;
  includeUpdateBenchmark?: boolean;
  changedFiles?: number;
}): Promise<GraphExternalBenchmarkScorecard> {
  const startedAt = Date.now();
  let scanSuccess = true;
  let graph;
  let kernelProfile;
  try {
    const scan = await runKernelWorkspaceScan(input.workspaceRoot);
    graph = scan.unifiedGraph;
    kernelProfile = scan.kernelProfile;
  } catch (error) {
    scanSuccess = false;
    const catalogEntry = findExternalBenchmarkCatalogEntry(input.categoryId);
    return {
      categoryId: input.categoryId,
      label: catalogEntry?.label ?? input.categoryId,
      workspaceRoot: input.workspaceRoot,
      referenceRepo: catalogEntry?.referenceRepo ?? "",
      localFixture: input.localFixture,
      scanSuccess: false,
      scanMs: Date.now() - startedAt,
      indexedFileCount: 0,
      usefulSymbolCount: 0,
      queryBenchmarkPassRate: null,
      pathBenchmarkPassRate: null,
      misleadingHandoffRate: 0,
      exportCompleteness: false,
      provenanceCoverage: 0,
      updateTimeMs: null,
      passed: false,
      errors: [error instanceof Error ? error.message : String(error)],
      scannerTasks: [
        `[${input.categoryId}] Fix scan failure before public benchmark comparison.`,
      ],
    };
  }

  let updateTimeMs: number | null = null;
  if (input.includeUpdateBenchmark) {
    const updateResult = await runGraphUpdateBenchmarkForWorkspace({
      workspaceRoot: input.workspaceRoot,
      changedFiles: input.changedFiles ?? 1,
      inPlace: false,
    });
    updateTimeMs = updateResult.warmUpdateMs;
  }

  return evaluateGraphExternalBenchmark({
    categoryId: input.categoryId,
    workspaceRoot: normalizeRelativePath(input.workspaceRoot),
    graph: graph!,
    kernelProfile,
    scanMs: Date.now() - startedAt,
    scanSuccess,
    updateTimeMs,
    localFixture: input.localFixture,
  });
}

export async function runGraphExternalBenchmarkCatalog(input: {
  fixturesRoot: string;
  includeUpdateBenchmark?: boolean;
  changedFiles?: number;
}) {
  const results: GraphExternalBenchmarkScorecard[] = [];
  for (const entry of GRAPH_EXTERNAL_BENCHMARK_CATALOG) {
    const workspaceRoot = path.resolve(input.fixturesRoot, entry.localFixture);
    results.push(await runGraphExternalBenchmarkForWorkspace({
      categoryId: entry.id,
      workspaceRoot,
      localFixture: entry.localFixture,
      includeUpdateBenchmark: input.includeUpdateBenchmark,
      changedFiles: input.changedFiles,
    }));
  }
  return results;
}