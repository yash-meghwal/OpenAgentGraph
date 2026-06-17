import fs from "fs/promises";
import path from "path";
import type { IgnoreRule, ProjectTypeSignal, SkipReason, WorkspaceKernelProfile } from "@openagentgraph/shared";
import {
  WORKSPACE_MARKER_FILES,
  WORKSPACE_MARKER_GLOBS,
  normalizeScannerProjectPath,
  type DetectedProjectType,
} from "../scannerHygiene.js";
import { IgnoreEngine } from "./ignoreEngine.js";
import { resolveActiveScanners, scannerRegistryDiagnostics } from "./scannerRegistry.js";

export const WORKSPACE_DETECTION_VERSION = "1.0";

const WRAPPER_MARKER_WEIGHT = 12;
const EXTENSION_WEIGHT = 4;
const ROOT_PROXIMITY_WEIGHT = 6;

type MarkerHit = {
  projectPath: string;
  typeId: string;
  marker: string;
  depth: number;
};

function markerTypeForFileName(fileName: string): string | undefined {
  for (const marker of WORKSPACE_MARKER_FILES) {
    if (marker.marker.toLowerCase() === fileName.toLowerCase()) {
      return marker.projectType;
    }
  }
  for (const marker of WORKSPACE_MARKER_GLOBS) {
    if (marker.pattern.test(fileName)) {
      return marker.projectType;
    }
  }
  return undefined;
}

function extensionType(extension: string): string | undefined {
  switch (extension) {
    case ".cs":
    case ".csproj":
    case ".sln":
      return "dotnet";
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".rs":
      return "rust";
    case ".go":
      return "go";
    case ".java":
    case ".kt":
      return "java";
    case ".rb":
    case ".rake":
      return "ruby";
    case ".php":
    case ".phtml":
      return "php";
    case ".py":
      return "python";
    case ".tf":
    case ".tfvars":
      return "terraform-iac";
    case ".ps1":
    case ".sh":
    case ".bash":
      return "shell-automation";
    default:
      return undefined;
  }
}

function scoreTypeSignals(markerHits: MarkerHit[], extensionCounts: Map<string, number>) {
  const scores = new Map<string, { confidence: number; markers: Set<string> }>();

  const addScore = (typeId: string, amount: number, marker: string) => {
    const current = scores.get(typeId) ?? { confidence: 0, markers: new Set<string>() };
    current.confidence += amount;
    current.markers.add(marker);
    scores.set(typeId, current);
  };

  for (const hit of markerHits) {
    addScore(hit.typeId, WRAPPER_MARKER_WEIGHT + Math.max(0, ROOT_PROXIMITY_WEIGHT - hit.depth), hit.marker);
  }

  for (const [extension, count] of extensionCounts) {
    const typeId = extensionType(extension);
    if (!typeId || count <= 0) continue;
    addScore(typeId, EXTENSION_WEIGHT * count, extension);
  }

  const signals: ProjectTypeSignal[] = [...scores.entries()]
    .map(([typeId, value]) => ({
      typeId,
      confidence: value.confidence,
      markers: [...value.markers].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => right.confidence - left.confidence || left.typeId.localeCompare(right.typeId));

  return signals;
}

function deriveSourceRoots(markerHits: MarkerHit[], root: string) {
  const roots = new Set<string>(["."]);
  for (const hit of markerHits) {
    const parent = path.posix.dirname(hit.projectPath);
    roots.add(parent === "." ? "." : parent);
    if (hit.projectPath.includes("/")) {
      roots.add(hit.projectPath.split("/")[0] ?? ".");
    }
  }

  const sorted = [...roots].sort((left, right) => left.localeCompare(right));
  if (markerHits.length <= 1) return sorted;

  const shallowestDepth = Math.min(...markerHits.map((hit) => hit.depth));
  const concentrated = markerHits.filter((hit) => hit.depth === shallowestDepth);
  if (concentrated.length > 0 && shallowestDepth > 0) {
    const wrapperRoot = path.posix.dirname(concentrated[0]!.projectPath);
    if (wrapperRoot !== ".") {
      return [wrapperRoot, ...sorted.filter((value) => value !== wrapperRoot)];
    }
  }
  return sorted;
}

async function discoverMarkerHits(
  root: string,
  ignoreEngine: IgnoreEngine,
  input: { maxDepth?: number; maxEntries?: number } = {}
) {
  const maxDepth = input.maxDepth ?? 10;
  const maxEntries = input.maxEntries ?? 3_000;
  const markerHits: MarkerHit[] = [];
  const pending = [{ absolutePath: path.resolve(root), depth: 0 }];
  let visitedEntries = 0;

  while (pending.length > 0) {
    const current = pending.shift()!;
    const projectDirectory = normalizeScannerProjectPath(path.relative(root, current.absolutePath)) || ".";
    await ignoreEngine.enterDirectory(projectDirectory, current.absolutePath);
    const directoryDecision = ignoreEngine.shouldSkip(projectDirectory, true);
    if (directoryDecision) continue;

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > maxEntries) return markerHits;

      const absoluteEntryPath = path.join(current.absolutePath, entry.name);
      const projectPath = normalizeScannerProjectPath(path.relative(root, absoluteEntryPath));

      if (entry.isDirectory()) {
        if (current.depth >= maxDepth) continue;
        pending.push({ absolutePath: absoluteEntryPath, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) continue;
      const fileDecision = ignoreEngine.shouldSkip(projectPath, false);
      if (fileDecision) continue;

      const typeId = markerTypeForFileName(entry.name);
      if (!typeId) continue;
      markerHits.push({
        projectPath,
        typeId,
        marker: entry.name,
        depth: current.depth,
      });
    }
  }

  return markerHits;
}

export async function detectWorkspaceKernelProfile(
  root: string,
  input: {
    sourceExtensionCounts?: Map<string, number>;
    skippedCountsByReason?: Map<SkipReason, number>;
    ignoreEngine?: IgnoreEngine;
    ignoreRules?: IgnoreRule[];
    warnings?: string[];
  } = {}
): Promise<WorkspaceKernelProfile> {
  const resolvedRoot = path.resolve(root);
  const ignoreEngine = input.ignoreEngine ?? await IgnoreEngine.load(resolvedRoot);
  const markerHits = await discoverMarkerHits(resolvedRoot, ignoreEngine);
  const sourceExtensionCounts = input.sourceExtensionCounts ?? new Map<string, number>();
  const skippedCountsByReason = input.skippedCountsByReason ?? new Map<SkipReason, number>();
  const typeSignals = scoreTypeSignals(markerHits, sourceExtensionCounts);

  const detectedTypes = new Set<string>(typeSignals.map((signal) => signal.typeId));
  for (const [extension, count] of sourceExtensionCounts) {
    if (count <= 0) continue;
    const typeId = extensionType(extension);
    if (typeId) detectedTypes.add(typeId);
  }

  const codeExtensionKeys = new Set([
    ".cs", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".tf", ".java", ".kt",
    ".rb", ".rake", ".php", ".phtml", ".ps1", ".sh",
  ]);
  const docExtensionKeys = new Set([".md", ".rst", ".txt"]);
  const codeCount = [...sourceExtensionCounts.entries()]
    .filter(([extension]) => codeExtensionKeys.has(extension))
    .reduce((sum, [, count]) => sum + count, 0);
  const docCount = [...sourceExtensionCounts.entries()]
    .filter(([extension]) => docExtensionKeys.has(extension))
    .reduce((sum, [, count]) => sum + count, 0);
  if (codeCount === 0 && docCount >= 3) {
    detectedTypes.add("documentation-corpus");
  }

  if (detectedTypes.size === 0) {
    const totalIndexed = [...sourceExtensionCounts.values()].reduce((sum, count) => sum + count, 0);
    if (totalIndexed === 0 || (codeCount === 0 && totalIndexed < 3)) {
      detectedTypes.add("empty-greenfield");
    } else {
      detectedTypes.add("generic");
    }
  }

  if (detectedTypes.size > 1 && !detectedTypes.has("mixed-polyglot")) {
    const hasCode = [...sourceExtensionCounts.values()].some((count) => count > 0);
    if (hasCode) detectedTypes.add("mixed-polyglot");
  }

  const activeScanners = resolveActiveScanners([...detectedTypes]);
  const activeScannerIds = activeScanners.map((scanner) => scanner.id);
  const primaryType = typeSignals[0]?.typeId ?? [...detectedTypes][0] ?? "generic";
  const secondaryTypes = [...detectedTypes]
    .filter((typeId) => typeId !== primaryType)
    .sort((left, right) => left.localeCompare(right));

  const warnings = [
    ...(input.warnings ?? []),
    ...scannerRegistryDiagnostics(activeScannerIds),
  ];
  if (markerHits.length > 0) {
    const shallowest = Math.min(...markerHits.map((hit) => hit.depth));
    if (shallowest > 0) {
      const nestedRoot = path.posix.dirname(markerHits.find((hit) => hit.depth === shallowest)!.projectPath);
      warnings.push(`Wrapper layout detected; nested project markers concentrated under '${nestedRoot}/'.`);
    }
  }

  const markerPaths = markerHits.map((hit) => hit.projectPath).sort((left, right) => left.localeCompare(right));
  const sourceRoots = deriveSourceRoots(markerHits, resolvedRoot);

  return {
    schemaVersion: WORKSPACE_DETECTION_VERSION,
    root: resolvedRoot,
    effectiveRoots: [resolvedRoot],
    primaryType,
    secondaryTypes,
    typeSignals,
    sourceRoots,
    markerPaths,
    activeScannerIds,
    ignoreRules: input.ignoreRules ?? ignoreEngine.rules,
    sourceExtensionCounts: Object.fromEntries(
      [...sourceExtensionCounts.entries()].sort((left, right) => left[0].localeCompare(right[0]))
    ),
    skippedCountsByReason: ignoreEngine.skippedCountsRecord(skippedCountsByReason),
    warnings: [...new Set(warnings)],
  };
}

export function kernelProfileToLegacyTypes(profile: WorkspaceKernelProfile): DetectedProjectType[] {
  const map: Record<string, DetectedProjectType> = {
    dotnet: "dotnet",
    typescript: "typescript",
    javascript: "javascript",
    node: "node",
    rust: "rust",
    go: "go",
    java: "java",
    "java-gradle": "java",
    "kotlin-gradle": "java",
    ruby: "ruby",
    "rails-app": "ruby",
    "ruby-gem": "ruby",
    php: "php",
    "laravel-app": "php",
    "wordpress-plugin": "php",
    python: "python",
    "django-app": "python",
    "terraform-iac": "terraform",
    "next-app": "typescript",
    "documentation-corpus": "generic",
  };
  const legacy = new Set<DetectedProjectType>();
  for (const typeId of [profile.primaryType, ...profile.secondaryTypes]) {
    const mapped = map[typeId];
    if (mapped) legacy.add(mapped);
  }
  if (legacy.size === 0) legacy.add("generic");
  return [...legacy].sort((left, right) => left.localeCompare(right));
}

export function kernelProfileDiagnostics(profile: WorkspaceKernelProfile) {
  return [
    `Primary project type: ${profile.primaryType}.`,
    profile.secondaryTypes.length > 0
      ? `Secondary project types: ${profile.secondaryTypes.join(", ")}.`
      : "Secondary project types: none.",
    profile.sourceRoots.length > 0
      ? `Source roots: ${profile.sourceRoots.join(", ")}.`
      : "Source roots: workspace root only.",
    profile.markerPaths.length > 0
      ? `Workspace markers: ${profile.markerPaths.join(", ")}.`
      : "Workspace markers: none detected.",
    `Active scanners: ${profile.activeScannerIds.join(", ") || "generic"}.`,
    ...profile.warnings,
  ];
}