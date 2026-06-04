import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { Dirent } from "fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphNodeKind,
  ProjectGraphResponse,
  ScanBreakerStatus,
  ScanJobStatus,
  ScanProgressSnapshot,
} from "@openagentgraph/shared";
import { getAppConfig } from "../config.js";
import {
  DEFAULT_LIGHTWEIGHT_SCAN_LIMITS,
  buildScanProgressSnapshot,
  createScanBreakerStatus,
  markScanBreakerHit,
  normalizeScanBreakerLimits,
  scanBreakerDiagnostics,
  updateScanBreakerNear,
} from "../scanner/scanProgress.js";
import { canActorPerform, permissionMessage, resolveAuth } from "../auth/actors.js";

const IGNORED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".mypy_cache",
  ".output",
  ".playwright-mcp",
  ".pytest_cache",
  ".ruff_cache",
  ".svelte-kit",
  ".tmp-dev-logs",
  ".turbo",
  ".tox",
  ".venv",
  ".vercel",
  ".vscode-test",
  "__pycache__",
  "build",
  "coverage",
  "data",
  "dist",
  "dist-electron",
  "dist-main",
  "dist-renderer",
  "htmlcov",
  "node_modules",
  "out",
  "playwright-report",
  "release",
  "storybook-static",
  "test-results",
  "venv",
  "webview-dist",
]);

const INCLUDED_EXTENSIONS = new Set([
  ".css",
  ".cjs",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cjs"]);
const RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cjs", ".json"];

type ScannedFile = {
  absolutePath: string;
  projectPath: string;
  dirPath: string;
  sizeBytes: number;
  text?: string;
};

type ScanResult = {
  directories: Set<string>;
  files: ScannedFile[];
  skippedFileCount: number;
  skippedDirectoryCount: number;
  partial: boolean;
  totalBytes: number;
  breakers: ScanBreakerStatus;
  progress: ScanProgressSnapshot;
  diagnostics: string[];
};

function toProjectPath(root: string, absolutePath: string) {
  const relativePath = path.relative(root, absolutePath);
  return relativePath ? relativePath.split(path.sep).join("/") : ".";
}

function nodeIdForDirectory(projectPath: string) {
  return `dir:${projectPath}`;
}

function nodeIdForFile(projectPath: string) {
  return `file:${projectPath}`;
}

function edgeId(sourceNodeId: string, targetNodeId: string, kind: ProjectGraphEdge["kind"]) {
  return `${kind}:${sourceNodeId}->${targetNodeId}`;
}

function classifyFile(projectPath: string): ProjectGraphNodeKind {
  const extension = path.extname(projectPath).toLowerCase();
  const basename = path.basename(projectPath).toLowerCase();
  if (/\.(test|spec)\.[^.]+$/.test(basename)) return "test";
  if (extension === ".md") return "doc";
  if ([".json", ".yaml", ".yml"].includes(extension) || basename.startsWith(".")) return "config";
  if (CODE_EXTENSIONS.has(extension) || extension === ".css" || extension === ".html") return "source";
  return "asset";
}

function groupForProjectPath(projectPath: string) {
  if (projectPath === ".") return "workspace";
  const [first, second] = projectPath.split("/");
  if (first === "packages" && second) return `packages/${second}`;
  return first || "workspace";
}

function parentDirectory(projectPath: string) {
  const parent = path.posix.dirname(projectPath);
  return parent === "." ? "." : parent;
}

async function safeReadDirectory(absolutePath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(absolutePath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function scanWorkspace(
  root: string,
  input: {
    scanId: string;
    startedAt: number;
    limits?: Partial<ScanBreakerStatus["limits"]>;
    onProgress?: (snapshot: ScanProgressSnapshot) => void;
    now?: () => number;
  }
): Promise<ScanResult> {
  const directories = new Set<string>(["."]);
  const files: ScannedFile[] = [];
  let skippedFileCount = 0;
  let skippedDirectoryCount = 0;
  let totalBytes = 0;
  let partial = false;
  const limits = normalizeScanBreakerLimits(input.limits, DEFAULT_LIGHTWEIGHT_SCAN_LIMITS);
  const breakers = createScanBreakerStatus(limits);
  const now = input.now ?? Date.now;
  let stopTraversal = false;

  const publishProgress = (message?: string) => {
    updateScanBreakerNear(breakers, {
      maxFiles: files.length,
      maxTotalBytes: totalBytes,
      maxDurationMs: now() - input.startedAt,
    });
    const progress = buildScanProgressSnapshot({
      scanId: input.scanId,
      scope: "project_graph",
      phase: "collecting_files",
      startedAtMs: input.startedAt,
      filesScanned: files.length,
      bytesScanned: totalBytes,
      skippedFileCount,
      skippedDirectoryCount,
      breakers,
      ...(message ? { message } : {}),
    });
    input.onProgress?.(progress);
    return progress;
  };

  let progress = publishProgress("Collecting project graph files.");

  async function visitDirectory(absoluteDirectory: string, depth: number) {
    if (stopTraversal) return;
    const elapsedMs = now() - input.startedAt;
    if (elapsedMs > limits.maxDurationMs) {
      partial = true;
      stopTraversal = true;
      markScanBreakerHit(
        breakers,
        "maxDurationMs",
        elapsedMs,
        `Project graph scan stopped after ${Math.round(elapsedMs)}ms because OPENAGENTGRAPH_SCAN_MAX_DURATION_MS is ${limits.maxDurationMs}.`
      );
      progress = publishProgress("Scan duration breaker hit.");
      return;
    }
    const entries = await safeReadDirectory(absoluteDirectory);
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryElapsedMs = now() - input.startedAt;
      if (entryElapsedMs > limits.maxDurationMs) {
        partial = true;
        stopTraversal = true;
        markScanBreakerHit(
          breakers,
          "maxDurationMs",
          entryElapsedMs,
          `Project graph scan stopped after ${Math.round(entryElapsedMs)}ms because OPENAGENTGRAPH_SCAN_MAX_DURATION_MS is ${limits.maxDurationMs}.`
        );
        progress = publishProgress("Scan duration breaker hit.");
        break;
      }

      const absoluteEntryPath = path.join(absoluteDirectory, entry.name);
      const projectPath = toProjectPath(root, absoluteEntryPath);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          skippedDirectoryCount += 1;
          continue;
        }
        if (depth >= limits.maxDepth) {
          skippedDirectoryCount += 1;
          partial = true;
          markScanBreakerHit(
            breakers,
            "maxDepth",
            depth + 1,
            `Project graph scan skipped ${projectPath} because directory depth exceeded ${limits.maxDepth}.`
          );
          progress = publishProgress("Directory depth breaker hit.");
          continue;
        }
        directories.add(projectPath);
        await visitDirectory(absoluteEntryPath, depth + 1);
        if (stopTraversal) break;
        continue;
      }

      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (!INCLUDED_EXTENSIONS.has(extension)) {
        skippedFileCount += 1;
        continue;
      }

      if (files.length >= limits.maxFiles) {
        skippedFileCount += 1;
        partial = true;
        stopTraversal = true;
        markScanBreakerHit(
          breakers,
          "maxFiles",
          files.length + 1,
          `Project graph scan skipped remaining source once file count exceeded ${limits.maxFiles}.`
        );
        progress = publishProgress("File count breaker hit.");
        break;
      }

      let sizeBytes = 0;
      let text: string | undefined;
      try {
        const stat = await fs.stat(absoluteEntryPath);
        sizeBytes = stat.size;
        if (stat.size > limits.maxFileBytes) {
          skippedFileCount += 1;
          partial = true;
          markScanBreakerHit(
            breakers,
            "maxFileBytes",
            stat.size,
            `Project graph scan skipped ${projectPath} because it exceeds ${limits.maxFileBytes} bytes.`
          );
          progress = publishProgress("Single-file size breaker hit.");
          continue;
        }
        if (totalBytes + stat.size > limits.maxTotalBytes) {
          skippedFileCount += 1;
          partial = true;
          stopTraversal = true;
          markScanBreakerHit(
            breakers,
            "maxTotalBytes",
            totalBytes + stat.size,
            `Project graph scan skipped remaining source once total bytes exceeded ${limits.maxTotalBytes}.`
          );
          progress = publishProgress("Total source bytes breaker hit.");
          break;
        }
        if (stat.size <= limits.maxFileBytes) {
          text = await fs.readFile(absoluteEntryPath, "utf8");
        }
      } catch {
        skippedFileCount += 1;
        continue;
      }

      totalBytes += sizeBytes;
      directories.add(parentDirectory(projectPath));
      files.push({
        absolutePath: path.resolve(absoluteEntryPath),
        projectPath,
        dirPath: parentDirectory(projectPath),
        sizeBytes,
        text,
      });
      if (files.length % 100 === 0) {
        progress = publishProgress("Collecting project graph files.");
      }
    }
  }

  await visitDirectory(root, 0);
  progress = publishProgress("Project graph file collection complete.");
  return {
    directories,
    files,
    skippedFileCount,
    skippedDirectoryCount,
    partial,
    totalBytes,
    breakers,
    progress,
    diagnostics: scanBreakerDiagnostics(breakers),
  };
}

function buildDirectoryNodes(directories: Set<string>): ProjectGraphNode[] {
  return [...directories].sort().map((projectPath) => ({
    id: nodeIdForDirectory(projectPath),
    label: projectPath === "." ? "workspace" : path.posix.basename(projectPath),
    path: projectPath,
    kind: "directory",
    group: groupForProjectPath(projectPath),
  }));
}

function buildFileNode(file: ScannedFile): ProjectGraphNode {
  const lineCount = file.text ? file.text.split(/\r?\n/).length : undefined;
  const importCount = file.text && CODE_EXTENSIONS.has(path.extname(file.projectPath).toLowerCase())
    ? extractImportSpecifiers(file.text).length
    : 0;

  return {
    id: nodeIdForFile(file.projectPath),
    label: path.posix.basename(file.projectPath),
    path: file.projectPath,
    kind: classifyFile(file.projectPath),
    group: groupForProjectPath(file.projectPath),
    sizeBytes: file.sizeBytes,
    lineCount,
    importCount,
  };
}

function buildContainmentEdges(directories: Set<string>, files: ScannedFile[]): ProjectGraphEdge[] {
  const edges: ProjectGraphEdge[] = [];

  for (const projectPath of directories) {
    if (projectPath === ".") continue;
    const parent = parentDirectory(projectPath);
    edges.push({
      id: edgeId(nodeIdForDirectory(parent), nodeIdForDirectory(projectPath), "contains"),
      sourceNodeId: nodeIdForDirectory(parent),
      targetNodeId: nodeIdForDirectory(projectPath),
      kind: "contains",
    });
  }

  for (const file of files) {
    edges.push({
      id: edgeId(nodeIdForDirectory(file.dirPath), nodeIdForFile(file.projectPath), "contains"),
      sourceNodeId: nodeIdForDirectory(file.dirPath),
      targetNodeId: nodeIdForFile(file.projectPath),
      kind: "contains",
    });
  }

  return edges;
}

function extractImportSpecifiers(text: string) {
  const specifiers = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match[1]) specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function candidateImportPaths(basePath: string) {
  const candidates = [basePath];
  const extension = path.extname(basePath);
  if (extension) {
    const withoutExtension = basePath.slice(0, -extension.length);
    for (const candidateExtension of RESOLUTION_EXTENSIONS) {
      candidates.push(`${withoutExtension}${candidateExtension}`);
    }
  }
  for (const extension of RESOLUTION_EXTENSIONS) {
    candidates.push(`${basePath}${extension}`);
  }
  for (const extension of RESOLUTION_EXTENSIONS) {
    candidates.push(path.join(basePath, `index${extension}`));
  }
  return candidates.map((candidate) => path.resolve(candidate));
}

function resolveRelativeImport(
  specifier: string,
  fromFile: ScannedFile,
  fileByAbsolutePath: Map<string, ScannedFile>
) {
  if (!specifier.startsWith(".")) return null;
  const basePath = path.resolve(path.dirname(fromFile.absolutePath), specifier);
  for (const candidate of candidateImportPaths(basePath)) {
    const match = fileByAbsolutePath.get(candidate);
    if (match) return match;
  }
  return null;
}

function buildImportEdges(files: ScannedFile[]): ProjectGraphEdge[] {
  const fileByAbsolutePath = new Map(files.map((file) => [path.resolve(file.absolutePath), file]));
  const edgesById = new Map<string, ProjectGraphEdge>();

  for (const file of files) {
    if (!file.text || !CODE_EXTENSIONS.has(path.extname(file.projectPath).toLowerCase())) continue;

    for (const specifier of extractImportSpecifiers(file.text)) {
      const target = resolveRelativeImport(specifier, file, fileByAbsolutePath);
      if (!target) continue;

      const sourceNodeId = nodeIdForFile(file.projectPath);
      const targetNodeId = nodeIdForFile(target.projectPath);
      if (sourceNodeId === targetNodeId) continue;
      edgesById.set(edgeId(sourceNodeId, targetNodeId, "imports"), {
        id: edgeId(sourceNodeId, targetNodeId, "imports"),
        sourceNodeId,
        targetNodeId,
        kind: "imports",
      });
    }
  }

  return [...edgesById.values()];
}

function sourceCandidatesForTestFile(testFile: ScannedFile) {
  const extension = path.extname(testFile.projectPath);
  const withoutExtension = testFile.projectPath.slice(0, -extension.length);
  const sourceBase = withoutExtension.replace(/\.(test|spec)$/i, "");
  return RESOLUTION_EXTENSIONS.map((candidateExtension) => `${sourceBase}${candidateExtension}`);
}

function buildTestEdges(files: ScannedFile[]) {
  const fileByProjectPath = new Map(files.map((file) => [file.projectPath, file]));
  const edges: ProjectGraphEdge[] = [];

  for (const file of files) {
    if (classifyFile(file.projectPath) !== "test") continue;
    const target = sourceCandidatesForTestFile(file)
      .map((candidate) => fileByProjectPath.get(candidate))
      .find(Boolean);
    if (!target) continue;

    const sourceNodeId = nodeIdForFile(file.projectPath);
    const targetNodeId = nodeIdForFile(target.projectPath);
    edges.push({
      id: edgeId(sourceNodeId, targetNodeId, "tests"),
      sourceNodeId,
      targetNodeId,
      kind: "tests",
    });
  }

  return edges;
}

async function resolveProjectRoot(configuredRoot?: string) {
  if (configuredRoot) return path.resolve(configuredRoot);

  let current = path.resolve(process.cwd());
  while (true) {
    try {
      const packageJson = JSON.parse(await fs.readFile(path.join(current, "package.json"), "utf8")) as {
        workspaces?: unknown;
      };
      if (packageJson.workspaces) return current;
    } catch {
      // Keep walking upward until we find the workspace package.json.
    }

    const parent = path.dirname(current);
    if (parent === current) return path.resolve(process.cwd());
    current = parent;
  }
}

export async function buildProjectGraph(
  root = getAppConfig().workspace.root,
  options: {
    scanId?: string;
    startedAt?: number;
    limits?: Partial<ScanBreakerStatus["limits"]>;
    onProgress?: (snapshot: ScanProgressSnapshot) => void;
  } = {}
): Promise<ProjectGraphResponse> {
  const startedAt = options.startedAt ?? Date.now();
  const scanId = options.scanId ?? `project-${startedAt.toString(36)}`;
  const resolvedRoot = await resolveProjectRoot(root);
  const scan = await scanWorkspace(resolvedRoot, {
    scanId,
    startedAt,
    limits: options.limits ?? getAppConfig().scanner.scanLimits,
    onProgress: options.onProgress,
  });
  const directoryNodes = buildDirectoryNodes(scan.directories);
  const fileNodes = scan.files.map(buildFileNode);
  const containmentEdges = buildContainmentEdges(scan.directories, scan.files);
  const importEdges = buildImportEdges(scan.files);
  const testEdges = buildTestEdges(scan.files);

  return {
    root: resolvedRoot,
    generatedAt: new Date().toISOString(),
    nodes: [...directoryNodes, ...fileNodes],
    edges: [...containmentEdges, ...importEdges, ...testEdges],
    breakers: {
      project: scan.breakers,
    },
    progress: buildScanProgressSnapshot({
      scanId,
      scope: "project_graph",
      phase: "completed",
      startedAtMs: startedAt,
      filesScanned: scan.files.length,
      bytesScanned: scan.totalBytes,
      skippedFileCount: scan.skippedFileCount,
      skippedDirectoryCount: scan.skippedDirectoryCount,
      breakers: scan.breakers,
      message: "Project graph scan completed.",
    }),
    diagnostics: scan.diagnostics,
    summary: {
      fileCount: fileNodes.length,
      directoryCount: directoryNodes.length,
      importEdgeCount: importEdges.length,
      testEdgeCount: testEdges.length,
      referenceEdgeCount: 0,
      scannedFileCount: scan.files.length,
      skippedFileCount: scan.skippedFileCount,
      skippedDirectoryCount: scan.skippedDirectoryCount,
      partial: scan.partial,
    },
  };
}

type ProjectGraphScanJob = ScanJobStatus<ProjectGraphResponse> & {
  events: ScanProgressSnapshot[];
  listeners: Set<(job: ScanJobStatus<ProjectGraphResponse>) => void>;
};

const PROJECT_SCAN_JOB_TTL_MS = 10 * 60 * 1_000;
const projectGraphScanJobs = new Map<string, ProjectGraphScanJob>();
let projectGraphScanInProgress = false;

function publicProjectScanJob(job: ProjectGraphScanJob): ScanJobStatus<ProjectGraphResponse> {
  return {
    jobId: job.jobId,
    scope: job.scope,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function cleanupProjectScanJobs() {
  const cutoff = Date.now() - PROJECT_SCAN_JOB_TTL_MS;
  for (const [jobId, job] of projectGraphScanJobs) {
    if (new Date(job.updatedAt).getTime() < cutoff) {
      projectGraphScanJobs.delete(jobId);
    }
  }
}

function scheduleProjectScanJobCleanup(jobId: string) {
  setTimeout(() => {
    const job = projectGraphScanJobs.get(jobId);
    if (!job || job.status === "queued" || job.status === "running") return;
    projectGraphScanJobs.delete(jobId);
  }, PROJECT_SCAN_JOB_TTL_MS).unref?.();
}

function publishProjectScanJob(job: ProjectGraphScanJob, progress: ScanProgressSnapshot) {
  job.progress = progress;
  job.updatedAt = progress.updatedAt;
  job.events.push(progress);
  const publicJob = publicProjectScanJob(job);
  for (const listener of job.listeners) {
    listener(publicJob);
  }
}

function writeSseJob(reply: FastifyReply, job: ScanJobStatus<ProjectGraphResponse>) {
  reply.raw.write(`event: status\ndata: ${JSON.stringify(job)}\n\n`);
}

function createProjectScanJob(root: string | undefined): ProjectGraphScanJob {
  cleanupProjectScanJobs();
  const startedAt = Date.now();
  const jobId = `project-${randomUUID()}`;
  const breakers = createScanBreakerStatus(getAppConfig().scanner.scanLimits);
  const progress = buildScanProgressSnapshot({
    scanId: jobId,
    scope: "project_graph",
    phase: "queued",
    startedAtMs: startedAt,
    filesScanned: 0,
    bytesScanned: 0,
    skippedFileCount: 0,
    skippedDirectoryCount: 0,
    breakers,
    message: "Project graph scan queued.",
  });
  const job: ProjectGraphScanJob = {
    jobId,
    scope: "project_graph",
    status: "queued",
    createdAt: progress.startedAt,
    updatedAt: progress.updatedAt,
    progress,
    events: [progress],
    listeners: new Set(),
  };
  projectGraphScanJobs.set(jobId, job);
  projectGraphScanInProgress = true;

  void (async () => {
    job.status = "running";
    publishProjectScanJob(job, { ...progress, phase: "collecting_files", message: "Project graph scan started." });
    try {
      const result = await buildProjectGraph(root, {
        scanId: jobId,
        startedAt,
        onProgress: (snapshot) => publishProjectScanJob(job, snapshot),
      });
      job.status = "completed";
      job.result = result;
      publishProjectScanJob(job, result.progress ?? job.progress);
    } catch (error) {
      const failedProgress = buildScanProgressSnapshot({
        scanId: jobId,
        scope: "project_graph",
        phase: "failed",
        startedAtMs: startedAt,
        filesScanned: job.progress.filesScanned,
        bytesScanned: job.progress.bytesScanned,
        skippedFileCount: job.progress.skippedFileCount,
        skippedDirectoryCount: job.progress.skippedDirectoryCount,
        breakers: job.progress.breakers,
        message: error instanceof Error ? error.message : "Project graph scan failed.",
      });
      job.status = "failed";
      job.error = failedProgress.message;
      publishProjectScanJob(job, failedProgress);
    } finally {
      projectGraphScanInProgress = false;
      scheduleProjectScanJobCleanup(jobId);
    }
  })();

  return job;
}

function requireProjectGraphScanActor(req: FastifyRequest, reply: FastifyReply) {
  const resolution = resolveAuth(req);
  if (!resolution.actor) {
    reply.status(401).send({ error: resolution.message });
    return undefined;
  }

  if (!canActorPerform(resolution.actor, "manage_product_graph")) {
    reply.status(403).send({ error: permissionMessage("manage_product_graph") });
    return undefined;
  }

  return resolution.actor;
}

export async function projectGraphRoutes(app: FastifyInstance) {
  app.get("/project-graph", async () => buildProjectGraph());
  app.post("/project-graph/scan-jobs", async (req, reply) => {
    if (!requireProjectGraphScanActor(req, reply)) {
      return;
    }

    if (projectGraphScanInProgress) {
      return reply.status(409).send({
        status: "scan_in_progress",
        error: "A project graph scan is already running.",
      });
    }
    return reply.status(202).send(publicProjectScanJob(createProjectScanJob(getAppConfig().workspace.root)));
  });
  app.get("/project-graph/scan-jobs/:jobId", async (req, reply) => {
    const jobId = (req.params as { jobId?: string }).jobId;
    const job = jobId ? projectGraphScanJobs.get(jobId) : undefined;
    if (!job) return reply.status(404).send({ error: "Project graph scan job was not found." });
    return publicProjectScanJob(job);
  });
  app.get("/project-graph/scan-jobs/:jobId/events", async (req, reply) => {
    const jobId = (req.params as { jobId?: string }).jobId;
    const job = jobId ? projectGraphScanJobs.get(jobId) : undefined;
    if (!job) return reply.status(404).send({ error: "Project graph scan job was not found." });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    for (const event of job.events) {
      writeSseJob(reply, { ...publicProjectScanJob(job), progress: event });
    }
    if (job.status === "completed" || job.status === "failed") {
      reply.raw.end();
      return;
    }
    const listener = (nextJob: ScanJobStatus<ProjectGraphResponse>) => {
      writeSseJob(reply, nextJob);
      if (nextJob.status === "completed" || nextJob.status === "failed") {
        job.listeners.delete(listener);
        reply.raw.end();
      }
    };
    job.listeners.add(listener);
    req.raw.on("close", () => {
      job.listeners.delete(listener);
    });
  });
}
