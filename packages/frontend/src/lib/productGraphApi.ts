import type {
  ActorIdentity,
  AuthMode,
  ProductEdgeKind,
  ProductGraphEdge,
  ProductGraphCodexPlanningPrompt,
  ProductGraphHandoffReport,
  ProductGraphNode,
  ProductGraphProjection,
  ProductGraphTrace,
  ProductNodeKind,
  ProductNodeStatus,
  ScanBreakerStatus,
  ScanJobStatus,
  ScanProgressSnapshot,
} from "@openagentgraph/shared";
import { apiUrl, frontendRuntimeConfig } from "./runtime.js";

export type ProductGraphFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface ProductGraphRequestAuth {
  mode: AuthMode;
  actor?: ActorIdentity;
  token?: string;
}

export interface ProductGraphApiOptions {
  auth?: ProductGraphRequestAuth;
  fetchImpl?: ProductGraphFetch;
}

export interface CreateProductGraphNodeInput {
  id?: string;
  kind: ProductNodeKind;
  title: string;
  summary?: string;
  body?: string;
  status?: ProductNodeStatus;
  tags?: string[];
}

export interface CreateProductGraphEdgeInput {
  id?: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: ProductEdgeKind;
  label?: string;
}

export interface CreateProductGraphIntentBundleNodeInput {
  id?: string;
  title: string;
  summary?: string;
  body?: string;
  status?: ProductNodeStatus;
  tags?: string[];
}

export interface CreateProductGraphIntentBundleInput {
  feature: CreateProductGraphIntentBundleNodeInput;
  userStories: CreateProductGraphIntentBundleNodeInput[];
  acceptanceCriteria: CreateProductGraphIntentBundleNodeInput[];
  tasks: CreateProductGraphIntentBundleNodeInput[];
}

export interface CreateProductGraphIntentBundleResult {
  nodes: ProductGraphNode[];
  edges: ProductGraphEdge[];
}

export interface LinkProductGraphRunInput {
  graphId: string;
  taskNodeId: string;
}

export interface LinkProductGraphRunResult {
  node: ProductGraphNode;
  edge: ProductGraphEdge;
  evidenceNode: ProductGraphNode;
  evidenceEdge: ProductGraphEdge;
  planEdges: ProductGraphEdge[];
  fileNodes: ProductGraphNode[];
  fileEdges: ProductGraphEdge[];
}

export interface AcceptProductGraphCodexPlanInput {
  taskNodeId: string;
  promptHash?: string;
  title?: string;
  summary?: string;
}

export interface AcceptProductGraphCodexPlanResult {
  node: ProductGraphNode;
  edge: ProductGraphEdge;
}

export interface ScanProductGraphCodebaseSummary {
  fileCount: number;
  symbolCount: number;
  communityCount?: number;
  edgeCount: number;
  dependencyEdgeCount?: number;
  externalDependencyCount?: number;
  unresolvedDependencyCount?: number;
  semanticAnalysisEnabled?: boolean;
  semanticAnalysisSucceeded?: boolean;
  semanticEdgeCount?: number;
  semanticResolutionCount?: number;
  semanticConfigCount?: number;
  semanticConfiguredFileCount?: number;
  semanticSyntheticFileCount?: number;
  semanticUnconfiguredFileCount?: number;
  semanticConfigPaths?: string[];
  semanticFallbackReason?: string;
  skippedFileCount: number;
  skippedDirectoryCount: number;
  archivedNodeCount: number;
  archivedEdgeCount: number;
  durationMs: number;
  partial: boolean;
  breakers?: {
    lightweight: ScanBreakerStatus;
    semantic: ScanBreakerStatus;
  };
  progress?: ScanProgressSnapshot;
  diagnostics?: string[];
}

export interface ScanProductGraphCodebaseResult {
  status: "scanned";
  message: string;
  scanId: string;
  scannedAt: string;
  scanned: ScanProductGraphCodebaseSummary;
}

export type ProductGraphCodebaseScanJobStatus = ScanJobStatus<ScanProductGraphCodebaseResult>;

export type ProductGraphHandoffResult = ProductGraphHandoffReport;

export interface WriteProductGraphHandoffResult extends ProductGraphHandoffReport {
  status: "written";
  path: string;
}

export interface ImportProductGraphSpecKitSummary {
  nodeCount: number;
  edgeCount: number;
  constitutionCount: number;
  specFileCount: number;
  featureCount: number;
  userStoryCount: number;
  requirementCount: number;
  acceptanceCriterionCount: number;
  openQuestionCount: number;
  contractFileCount: number;
  contractCount: number;
  planFileCount: number;
  planCount: number;
  quickstartFileCount: number;
  quickstartScenarioCount: number;
  taskFileCount: number;
  taskCount: number;
  skippedSpecFileCount: number;
  skippedContractFileCount: number;
  skippedPlanFileCount: number;
  skippedQuickstartFileCount: number;
  skippedTaskFileCount: number;
}

export interface ImportProductGraphSpecKitArtifact {
  key: "constitution" | "specs";
  relativePath: string;
  kind: "file" | "specs";
  present: boolean;
}

export interface ImportProductGraphSpecKitResult {
  status: "imported";
  message: string;
  imported: ImportProductGraphSpecKitSummary;
  artifactRoot: ".";
  artifacts: ImportProductGraphSpecKitArtifact[];
  presentArtifacts: string[];
  missingArtifacts: string[];
}

function buildHeaders(init: RequestInit | undefined, auth: ProductGraphRequestAuth | undefined): Headers {
  const headers = new Headers(init?.headers);
  if (auth?.mode === "dev_header" && auth.actor) {
    headers.set("x-openagentgraph-actor-id", auth.actor.actorId);
  } else if (auth?.mode === "jwt" && auth.token) {
    headers.set("Authorization", `Bearer ${auth.token}`);
  }
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function productGraphFetch(
  path: string,
  init?: RequestInit,
  options: ProductGraphApiOptions = {}
) {
  if (!frontendRuntimeConfig.valid) {
    throw new Error(frontendRuntimeConfig.message ?? "The OpenAgentGraph API base URL is invalid.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(apiUrl(path), {
    ...init,
    headers: buildHeaders(init, options.auth),
  });
  if (response.ok) return response;

  let message = `Request failed: ${response.status}`;
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof payload.error === "string" && payload.error) {
      message = payload.error;
    } else if (typeof payload.message === "string" && payload.message) {
      message = payload.message;
    }
  } catch {
    // Keep the status-based fallback.
  }

  const error = new Error(message) as Error & { status?: number };
  error.status = response.status;
  throw error;
}

export async function fetchProductGraph(
  options?: ProductGraphApiOptions
): Promise<ProductGraphProjection> {
  const response = await productGraphFetch("/product-graph", undefined, options);
  return response.json() as Promise<ProductGraphProjection>;
}

export async function fetchProductGraphTrace(
  nodeId: string,
  options?: ProductGraphApiOptions
): Promise<ProductGraphTrace> {
  const response = await productGraphFetch(`/product-graph/trace/${encodeURIComponent(nodeId)}`, undefined, options);
  return response.json() as Promise<ProductGraphTrace>;
}

export async function fetchProductGraphCodexPlan(
  taskNodeId: string,
  options?: ProductGraphApiOptions
): Promise<ProductGraphCodexPlanningPrompt> {
  const response = await productGraphFetch(
    `/product-graph/codex-plan/${encodeURIComponent(taskNodeId)}`,
    undefined,
    options
  );
  return response.json() as Promise<ProductGraphCodexPlanningPrompt>;
}

export async function fetchProductGraphHandoff(
  options?: ProductGraphApiOptions
): Promise<ProductGraphHandoffResult> {
  const response = await productGraphFetch("/product-graph/handoff", undefined, options);
  return response.json() as Promise<ProductGraphHandoffResult>;
}

export async function writeProductGraphHandoff(
  options?: ProductGraphApiOptions
): Promise<WriteProductGraphHandoffResult> {
  const response = await productGraphFetch(
    "/product-graph/handoff/write",
    {
      method: "POST",
    },
    options
  );
  return response.json() as Promise<WriteProductGraphHandoffResult>;
}

export async function acceptProductGraphCodexPlan(
  input: AcceptProductGraphCodexPlanInput,
  options?: ProductGraphApiOptions
): Promise<AcceptProductGraphCodexPlanResult> {
  const { taskNodeId, ...body } = input;
  const response = await productGraphFetch(
    `/product-graph/codex-plan/${encodeURIComponent(taskNodeId)}/accept`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    options
  );
  return response.json() as Promise<AcceptProductGraphCodexPlanResult>;
}

export async function createProductGraphNode(
  input: CreateProductGraphNodeInput,
  options?: ProductGraphApiOptions
): Promise<ProductGraphNode> {
  const response = await productGraphFetch(
    "/product-graph/nodes",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    options
  );
  return response.json() as Promise<ProductGraphNode>;
}

export async function createProductGraphEdge(
  input: CreateProductGraphEdgeInput,
  options?: ProductGraphApiOptions
): Promise<ProductGraphEdge> {
  const response = await productGraphFetch(
    "/product-graph/edges",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    options
  );
  return response.json() as Promise<ProductGraphEdge>;
}

export async function createProductGraphIntentBundle(
  input: CreateProductGraphIntentBundleInput,
  options?: ProductGraphApiOptions
): Promise<CreateProductGraphIntentBundleResult> {
  const response = await productGraphFetch(
    "/product-graph/intent-bundles",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    options
  );
  return response.json() as Promise<CreateProductGraphIntentBundleResult>;
}

export async function linkProductGraphRun(
  input: LinkProductGraphRunInput,
  options?: ProductGraphApiOptions
): Promise<LinkProductGraphRunResult> {
  const response = await productGraphFetch(
    `/product-graph/runs/${encodeURIComponent(input.graphId)}/link`,
    {
      method: "POST",
      body: JSON.stringify({ taskNodeId: input.taskNodeId }),
    },
    options
  );
  return response.json() as Promise<LinkProductGraphRunResult>;
}

export async function importProductGraphSpecKit(
  options?: ProductGraphApiOptions
): Promise<ImportProductGraphSpecKitResult> {
  const response = await productGraphFetch(
    "/product-graph/spec-kit/import",
    {
      method: "POST",
    },
    options
  );
  return response.json() as Promise<ImportProductGraphSpecKitResult>;
}

export async function scanProductGraphCodebase(
  options?: ProductGraphApiOptions
): Promise<ScanProductGraphCodebaseResult> {
  const response = await productGraphFetch(
    "/product-graph/codebase/scan",
    {
      method: "POST",
    },
    options
  );
  return response.json() as Promise<ScanProductGraphCodebaseResult>;
}

export async function startProductGraphCodebaseScanJob(
  options?: ProductGraphApiOptions
): Promise<ProductGraphCodebaseScanJobStatus> {
  const response = await productGraphFetch(
    "/product-graph/codebase/scan-jobs",
    {
      method: "POST",
    },
    options
  );
  return response.json() as Promise<ProductGraphCodebaseScanJobStatus>;
}

export async function fetchProductGraphCodebaseScanJob(
  jobId: string,
  options?: ProductGraphApiOptions
): Promise<ProductGraphCodebaseScanJobStatus> {
  const response = await productGraphFetch(`/product-graph/codebase/scan-jobs/${encodeURIComponent(jobId)}`, undefined, options);
  return response.json() as Promise<ProductGraphCodebaseScanJobStatus>;
}
