import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import type { GraphFileFingerprint } from "@openagentgraph/shared";
import { isEcosystemConfigFileName, isProductGraphScannableExtension, normalizeScannerProjectPath } from "../scannerHygiene.js";
import { IgnoreEngine } from "./ignoreEngine.js";

const GRAPH_ARTIFACT_FILE_PATHS = new Set(["GRAPH_REPORT.md"]);

async function safeRealpath(value: string) {
  try {
    return await fs.realpath(value);
  } catch {
    return path.resolve(value);
  }
}

async function hashFile(absolutePath: string, sizeBytes: number, mtimeMs: number): Promise<GraphFileFingerprint | undefined> {
  try {
    const body = await fs.readFile(absolutePath);
    return {
      path: "",
      sizeBytes,
      mtimeMs,
      contentHash: createHash("sha256").update(body).digest("hex"),
    };
  } catch {
    return undefined;
  }
}

export async function collectWorkspaceFileFingerprints(workspaceRoot: string): Promise<{
  files: GraphFileFingerprint[];
  ignoreRuleFingerprint: string;
}> {
  const realRoot = await safeRealpath(workspaceRoot);
  const ignoreEngine = await IgnoreEngine.load(realRoot);
  const pending = [{ absolutePath: realRoot, depth: 0 }];
  const files: GraphFileFingerprint[] = [];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) break;

    const currentProjectPath = normalizeScannerProjectPath(path.relative(realRoot, current.absolutePath)) || ".";
    await ignoreEngine.enterDirectory(currentProjectPath, current.absolutePath);

    let entries;
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(current.absolutePath, entry.name);
      const projectPath = normalizeScannerProjectPath(path.relative(realRoot, absolutePath));
      if (GRAPH_ARTIFACT_FILE_PATHS.has(projectPath)) continue;
      const decision = ignoreEngine.shouldSkip(projectPath, entry.isDirectory());
      if (decision) continue;

      if (entry.isDirectory()) {
        pending.push({ absolutePath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (!isProductGraphScannableExtension(extension) && !isEcosystemConfigFileName(entry.name)) {
        continue;
      }

      let stat;
      try {
        stat = await fs.stat(absolutePath);
      } catch {
        continue;
      }

      const fingerprint = await hashFile(absolutePath, stat.size, stat.mtimeMs.valueOf());
      if (!fingerprint) continue;
      files.push({ ...fingerprint, path: projectPath });
    }
  }

  return {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    ignoreRuleFingerprint: createHash("sha256")
      .update(
        ignoreEngine.rules
          .map((rule) => `${rule.source}|${rule.rootRelativePath}|${rule.pattern}`)
          .sort()
          .join("\n")
      )
      .digest("hex"),
  };
}