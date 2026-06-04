import { spawn } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import OpenAI from "openai";
import type { FinalRequestOptions, Headers } from "openai/core";
import type {
  CommandResult,
  DriftDirection,
  EvaluateNodeResult,
  ExecuteNodeResult,
  FileDiff,
  GoalPacket,
  GraphContext,
  GraphCoordinates,
  GraphProjection,
  LineageDescriptor,
  LineageKind,
  NodeContract,
  NodeEvaluation,
  NodeEvidence,
  PlanGraphResult,
  PlanGraphNodeInput,
  ProviderLineageSnapshot,
  RelevantNodeOutput,
  SemanticNodeSummary,
  ToolCallRecord,
  ToolName,
} from "@openagentgraph/shared";
import type { AIProvider } from "./interface.js";
import { logDiagnostic, safeErrorMessage } from "../observability/logger.js";
import { incrementFailureMetric, incrementMetric, observeDuration } from "../observability/metrics.js";

const ALLOWED_TOOLS: ToolName[] = ["readFile", "writeFile", "listDirectory", "runCommand"];
const EMBEDDING_MODEL = "text-embedding-3-large";
const TOOL_TIMEOUT_MS = 30_000;
const MAX_EVIDENCE_PREVIEW_CHARS = 4_000;
const POLICY_VERSION = "deterministic-evaluator-v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

type PlannedToolCall =
  | { tool: "listDirectory"; path?: string }
  | { tool: "readFile"; path: string }
  | { tool: "writeFile"; path: string; content: string }
  | { tool: "runCommand"; command: string; args?: string[] };

type ToolExecutionResult = {
  toolCall: Omit<ToolCallRecord, "id" | "nodeId">;
  fileDiff?: FileDiff;
  commandResult?: CommandResult;
};

function checksumText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeEvidencePreview(value: string): {
  preview: string;
  truncated: boolean;
  checksum: string;
} {
  if (value.length <= MAX_EVIDENCE_PREVIEW_CHARS) {
    return { preview: value, truncated: false, checksum: checksumText(value) };
  }

  return {
    preview: `${value.slice(0, MAX_EVIDENCE_PREVIEW_CHARS)}\n…[truncated ${value.length - MAX_EVIDENCE_PREVIEW_CHARS} chars]`,
    truncated: true,
    checksum: checksumText(value),
  };
}

function fallbackContract(title: string, intent: string): NodeContract {
  return {
    expectedArtifact: `${title} deliverable`,
    allowedTools: ["listDirectory", "readFile"],
    acceptanceCriteria: [
      `Produce an output that satisfies the intent: ${intent}`,
      "Provide a concrete next-state artifact, not a placeholder",
    ],
    humanSummary: intent,
  };
}

function fallbackCoordinates(index: number): GraphCoordinates {
  return {
    depth: index,
    branch: 0,
    abstractionLevel: Math.max(0, 10 - index),
    driftDistance: 0,
    baselineDriftDistance: 0,
  };
}

export function containsPlaceholder(value: string): boolean {
  return /TODO|placeholder|\.\.\./i.test(value);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function clampDirection(score: number): DriftDirection {
  if (score >= 0.82) return "closer";
  if (score >= 0.65) return "holding";
  return "drifting";
}

export function resolveWorkspacePath(workspaceRoot: string, requestedPath = "."): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, requestedPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace root: ${requestedPath}`);
  }
  return resolved;
}

function looksLikePath(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    value.startsWith(".") ||
    /^[A-Za-z]:/.test(value)
  );
}

export function assertCommandWithinWorkspace(workspaceRoot: string, command: string, args: string[] = []) {
  if (looksLikePath(command)) {
    resolveWorkspacePath(workspaceRoot, command);
  }

  for (const arg of args) {
    if (looksLikePath(arg)) {
      resolveWorkspacePath(workspaceRoot, arg);
    }
  }
}

async function computeWorkspaceChecksum(workspaceRoot: string): Promise<string> {
  const root = path.resolve(workspaceRoot);
  const entries = await fsPromises.readdir(root, { withFileTypes: true });
  const fingerprint = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .slice(0, 200)
      .map(async (entry) => {
        const fullPath = path.join(root, entry.name);
        const stat = await fsPromises.stat(fullPath);
        return `${entry.name}:${stat.size}:${stat.mtimeMs}:${entry.isDirectory() ? "dir" : "file"}`;
      })
  );

  return createHash("sha256").update(fingerprint.sort().join("|")).digest("hex");
}

async function runToolCall(
  workspaceRoot: string,
  call: PlannedToolCall
): Promise<ToolExecutionResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date().toISOString();
  try {
    if (call.tool === "listDirectory") {
      const targetPath = resolveWorkspacePath(workspaceRoot, call.path ?? ".");
      const entries = (await fsPromises.readdir(targetPath, { withFileTypes: true }))
        .map((entry) => `${entry.isDirectory() ? "dir" : "file"}:${entry.name}`)
        .join("\n");

      return {
        toolCall: {
          tool: "listDirectory",
          input: { path: targetPath },
          output: entries,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      };
    }

    if (call.tool === "readFile") {
      const targetPath = resolveWorkspacePath(workspaceRoot, call.path);
      const content = await fsPromises.readFile(targetPath, "utf8");
      return {
        toolCall: {
          tool: "readFile",
          input: { path: targetPath },
          output: content,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      };
    }

    if (call.tool === "writeFile") {
      const targetPath = resolveWorkspacePath(workspaceRoot, call.path);
      const before = await fsPromises.readFile(targetPath, "utf8").catch(() => "");
      await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
      await fsPromises.writeFile(targetPath, call.content, "utf8");
      const after = await fsPromises.readFile(targetPath, "utf8");
      const beforePreview = makeEvidencePreview(before);
      const afterPreview = makeEvidencePreview(after);

      return {
        toolCall: {
          tool: "writeFile",
          input: { path: targetPath, content: call.content },
          output: `Wrote ${targetPath}`,
          startedAt,
          completedAt: new Date().toISOString(),
        },
        fileDiff: {
          path: targetPath,
          changeType: before ? "updated" : "created",
          summary: before ? `Updated ${path.basename(targetPath)}` : `Created ${path.basename(targetPath)}`,
          before: before ? beforePreview.preview : undefined,
          after: afterPreview.preview,
          beforeChecksum: before ? beforePreview.checksum : undefined,
          afterChecksum: afterPreview.checksum,
          beforeTruncated: before ? beforePreview.truncated : undefined,
          afterTruncated: afterPreview.truncated,
        },
      };
    }

    assertCommandWithinWorkspace(workspaceRoot, call.command, call.args ?? []);
    const commandResult = await new Promise<CommandResult>((resolve) => {
      const commandStartedAt = new Date().toISOString();
      const child = spawn(call.command, call.args ?? [], {
        cwd: workspaceRoot,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        resolve({
          command: call.command,
          args: call.args ?? [],
          cwd: workspaceRoot,
          exitCode: -1,
          stdout,
          stderr: stderr || `Command timed out after ${TOOL_TIMEOUT_MS}ms`,
          timedOut: true,
          startedAt: commandStartedAt,
          finishedAt: new Date().toISOString(),
        });
      }, TOOL_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        resolve({
          command: call.command,
          args: call.args ?? [],
          cwd: workspaceRoot,
          exitCode: -1,
          stdout,
          stderr: error.message,
          timedOut: false,
          startedAt: commandStartedAt,
          finishedAt: new Date().toISOString(),
        });
      });

      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        if (timedOut) return;
        resolve({
          command: call.command,
          args: call.args ?? [],
          cwd: workspaceRoot,
          exitCode: exitCode ?? -1,
          stdout,
          stderr,
          timedOut: false,
          startedAt: commandStartedAt,
          finishedAt: new Date().toISOString(),
        });
      });
    });

    return {
      toolCall: {
        tool: "runCommand",
        input: { command: call.command, args: call.args ?? [], cwd: workspaceRoot },
        output: `exit=${commandResult.exitCode}${commandResult.timedOut ? " timed_out=true" : ""}`,
        error:
          commandResult.exitCode === 0 && !commandResult.timedOut
            ? undefined
            : commandResult.stderr || "Command failed",
        startedAt,
        completedAt: commandResult.finishedAt,
      },
      commandResult,
    };
  } finally {
    observeDuration(
      "openagentgraph_tool_execution_duration_ms",
      "Tool execution duration.",
      Date.now() - startedAtMs,
      { tool_kind: call.tool }
    );
  }
}

export async function runDeterministicChecks(
  acceptanceCriteria: string[],
  evidence: NodeEvidence,
  workspaceRoot?: string,
  output?: string
): Promise<{ passed: boolean; findings: string[] }> {
  const findings: string[] = [];
  let passed = true;

  for (const criterion of acceptanceCriteria) {
    const lower = criterion.toLowerCase();

    if (lower.includes("exists")) {
      const match = criterion.match(/([A-Za-z0-9_\-./\\]+\.[A-Za-z0-9]+)/);
      if (!match || !workspaceRoot) {
        passed = false;
        findings.push(`Could not verify file existence for criterion: ${criterion}`);
        continue;
      }

      const exists = fs.existsSync(resolveWorkspacePath(workspaceRoot, match[1]));
      if (!exists) {
        passed = false;
        findings.push(`Missing expected file: ${match[1]}`);
      }
      continue;
    }

    if (lower.includes("exit code")) {
      const match = criterion.match(/exit code\s+(\d+)/i);
      const expectedCode = Number(match?.[1] ?? 0);
      const hasExitCode = evidence.commandResults.some((result) => result.exitCode === expectedCode);
      if (!hasExitCode) {
        passed = false;
        findings.push(`No command result matched exit code ${expectedCode}`);
      }
      continue;
    }

    if (lower.includes("test")) {
      const testPassed = evidence.commandResults.some(
        (result) => /test/i.test(result.command) && result.exitCode === 0
      );
      if (!testPassed) {
        passed = false;
        findings.push("No successful test command was captured");
      }
      continue;
    }

    const validText = Boolean(output?.trim()) && !containsPlaceholder(output ?? "");
    if (!validText) {
      passed = false;
      findings.push(`Output failed default validation for criterion: ${criterion}`);
    }
  }

  return { passed, findings };
}

async function summarizeOutput(
  client: OpenAI,
  model: string,
  output: string,
  telemetry: { providerMode: string; component: string }
): Promise<string> {
  if (!output.trim()) return "No output was produced.";
  const startedAtMs = Date.now();

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "Summarize the output in two concise sentences covering what changed, why it changed, and what outcome it produced. Do not quote code or raw command output.",
        },
        { role: "user", content: output.slice(0, 4000) },
      ],
    });
    return response.choices[0].message.content?.trim() || output.slice(0, 240);
  } catch (error) {
    incrementFailureMetric("provider_fallback", telemetry.component, "recovered");
    incrementMetric(
      "openagentgraph_provider_fallback_total",
      "Provider and retrieval fallback occurrences by fallback type.",
      { fallback_type: "summary" }
    );
    logDiagnostic({
      level: "warn",
      component: telemetry.component,
      message: "Falling back to a local output summary.",
      errorCode: "SUMMARY_FALLBACK",
      safeMetadata: {
        model,
        outputLength: output.length,
        error: safeErrorMessage(error),
      },
    });
    return output.slice(0, 240);
  } finally {
    observeDuration(
      "openagentgraph_provider_call_duration_ms",
      "Provider call duration.",
      Date.now() - startedAtMs,
      { provider_mode: telemetry.providerMode, operation: "summarize_output" }
    );
  }
}

function formatRelevantOutputs(outputs: RelevantNodeOutput[]): string {
  if (outputs.length === 0) return "(none)";
  return outputs
    .map((item) => {
      const scoreText = typeof item.score === "number" ? ` score=${item.score.toFixed(2)}` : "";
      return `[${item.title}]${scoreText} ${item.summary}`;
    })
    .join("\n");
}

function summarizePrompt(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

type OpenAIProviderOptions = {
  model?: string;
  baseURL?: string;
  providerMode?: string;
  providerLabel?: string;
  providerComponent?: string;
  embeddingModel?: string | false;
  omitAuthorization?: boolean;
};

class NoAuthOpenAI extends OpenAI {
  protected override authHeaders(_opts: FinalRequestOptions): Headers {
    return {};
  }
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;
  private providerMode: string;
  private providerLabel: string;
  private providerComponent: string;
  private embeddingModel: string | undefined;

  constructor(apiKey: string, modelOrOptions: string | OpenAIProviderOptions = DEFAULT_OPENAI_MODEL) {
    const options = typeof modelOrOptions === "string" ? { model: modelOrOptions } : modelOrOptions;
    const Client = options.omitAuthorization ? NoAuthOpenAI : OpenAI;
    this.client = new Client({
      apiKey: apiKey || "openagentgraph-no-auth",
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.providerMode = options.providerMode ?? "openai";
    this.providerLabel = options.providerLabel ?? "OpenAI";
    this.providerComponent = options.providerComponent ?? "providers.openai";
    this.embeddingModel = options.embeddingModel === false
      ? undefined
      : options.embeddingModel ?? EMBEDDING_MODEL;
  }

  private buildLineageDescriptor(input: {
    kind: LineageKind;
    graphId: string;
    label: string;
    version: string;
    source?: LineageDescriptor["source"];
    summary: string;
    promptBody?: string;
    promptSummary?: string;
    modelName?: string;
    fallbackUsed?: boolean;
    notes?: string;
  }): LineageDescriptor {
    const hashSource = [
      input.kind,
      input.label,
      input.version,
      input.modelName ?? "",
      input.promptBody ?? "",
      input.summary,
      input.notes ?? "",
      input.fallbackUsed ? "fallback" : "primary",
    ].join("|");
    const contentHash = checksumText(hashSource);

    return {
      lineageId: `${input.kind}-${contentHash.slice(0, 16)}`,
      graphId: input.graphId,
      createdAt: new Date().toISOString(),
      kind: input.kind,
      label: input.label,
      version: input.version,
      contentHash,
      summary: input.summary,
      source: input.source ?? "built_in",
      notes: input.notes,
      modelName: input.modelName,
      fallbackUsed: input.fallbackUsed,
      promptSummary: input.promptSummary ?? (input.promptBody ? summarizePrompt(input.promptBody) : undefined),
    };
  }

  describeGraphLineage(input: {
    goalPacket: GoalPacket;
    constraints?: string;
    projection?: GraphProjection;
    fallbackUsed?: boolean;
  }): ProviderLineageSnapshot {
    const promptBody = [
      "OpenAgentGraph planner",
      input.goalPacket.originalText,
      input.goalPacket.successCriteria.join("; "),
      input.goalPacket.forbiddenScope.join("; "),
      input.constraints ?? "",
      input.projection ? `${input.projection.nodes.length}:${input.projection.driftState}` : "fresh-graph",
    ].join("\n");

    return {
      planner: this.buildLineageDescriptor({
        kind: "planner",
        graphId: input.projection?.graph.id ?? "unknown-graph",
        label: `${this.providerLabel} planner`,
        version: this.model,
        modelName: this.model,
        promptBody,
        summary: `This run used ${this.providerLabel} planner ${this.model} to turn the goal into typed graph steps.`,
        fallbackUsed: input.fallbackUsed,
        notes: input.fallbackUsed ? "Planner fallback behavior was used." : undefined,
      }),
      policy: this.buildLineageDescriptor({
        kind: "policy",
        graphId: input.projection?.graph.id ?? "unknown-graph",
        label: "OpenAgentGraph execution policy",
        version: POLICY_VERSION,
        summary: "This run used the built-in OpenAgentGraph execution policy for contracts, allowed tools, and acceptance checks.",
        notes: input.fallbackUsed ? "One or more fallback paths were visible during planning." : undefined,
      }),
    };
  }

  describeNodeLineage(input: {
    context: GraphContext;
    rubric?: string;
    fallbackUsed?: boolean;
  }): ProviderLineageSnapshot {
    const graphId = input.context.projection.graph.id;
    const executorPrompt = [
      input.context.activeGoalPacket.originalText,
      input.context.currentNode.title,
      input.context.currentNode.intent,
      input.context.currentNode.contract.expectedArtifact,
      input.context.relevantOutputs.map((item) => item.summary).join(" | "),
    ].join("\n");
    const retrieverSummary =
      input.context.retrievalMode === "fallback"
        ? "Fallback retrieval logic was used for this step."
        : "Semantic retrieval was used to find earlier relevant node summaries.";

    return {
      executor: this.buildLineageDescriptor({
        kind: "executor",
        graphId,
        label: `${this.providerLabel} executor`,
        version: this.model,
        modelName: this.model,
        promptBody: executorPrompt,
        summary: `This step used ${this.providerLabel} executor ${this.model} to plan tool calls and produce a grounded output.`,
        fallbackUsed: input.fallbackUsed,
        notes: input.fallbackUsed ? "Execution fell back to a minimal tool plan." : undefined,
      }),
      evaluator: this.buildLineageDescriptor({
        kind: "evaluator",
        graphId,
        label: `${this.providerLabel} evaluator`,
        version: this.model,
        modelName: this.model,
        promptBody: `${input.context.currentNode.title}\n${input.rubric ?? ""}`,
        summary: `This step used ${this.providerLabel} evaluator ${this.model} plus deterministic policy checks to judge completion.`,
        fallbackUsed: input.fallbackUsed,
      }),
      retriever: this.buildLineageDescriptor({
        kind: "retriever",
        graphId,
        label: "OpenAgentGraph retriever",
        version: this.embeddingModel ?? "deterministic-fallback",
        modelName: this.embeddingModel ?? "deterministic-fallback",
        promptBody: input.context.currentNode.intent,
        summary: retrieverSummary,
        fallbackUsed: input.context.retrievalMode === "fallback",
        notes: input.context.retrievalMode === "fallback" ? "Semantic embeddings were unavailable or produced no relevant match." : undefined,
      }),
      policy: this.buildLineageDescriptor({
        kind: "policy",
        graphId,
        label: "OpenAgentGraph evaluation policy",
        version: POLICY_VERSION,
        summary: "This step used the built-in policy for deterministic checks, drift scoring, and acceptance gating.",
        fallbackUsed: input.fallbackUsed,
      }),
    };
  }

  async buildGoalPacket(input: {
    goal: string;
    successCriteria: string[];
    forbiddenScope: string[];
    version: number;
  }): Promise<GoalPacket> {
    const embedding = await this.getEmbedding(input.goal);
    const criteriaEmbeddings = await Promise.all(
      input.successCriteria.map((criterion) => this.getEmbedding(criterion))
    );

    return {
      id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      version: input.version,
      originalText: input.goal,
      successCriteria: input.successCriteria,
      forbiddenScope: input.forbiddenScope,
      embedding,
      criteriaEmbeddings,
      createdAt: new Date().toISOString(),
    };
  }

  async summarizeCompletedNode(context: GraphContext): Promise<SemanticNodeSummary> {
    const summary = await summarizeOutput(this.client, this.model, context.currentNode.output ?? "", {
      providerMode: this.providerMode,
      component: this.providerComponent,
    });
    const embedding = await this.getEmbedding(summary);
    return {
      summary,
      embedding,
      summaryGeneratedAt: new Date().toISOString(),
    };
  }

  async embedRetrievalQuery(input: string): Promise<number[]> {
    return this.getEmbedding(input);
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const startedAtMs = Date.now();
    try {
      if (!text.trim()) return [];
      if (!this.embeddingModel) {
        incrementFailureMetric("provider_fallback", this.providerComponent, "recovered");
        incrementMetric(
          "openagentgraph_provider_fallback_total",
          "Provider and retrieval fallback occurrences by fallback type.",
          { fallback_type: "embedding_disabled" }
        );
        return [];
      }
      const response = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: text,
      });
      return response.data[0]?.embedding ?? [];
    } catch (error) {
      incrementFailureMetric("provider_fallback", this.providerComponent, "recovered");
      incrementMetric(
        "openagentgraph_provider_fallback_total",
        "Provider and retrieval fallback occurrences by fallback type.",
        { fallback_type: "embedding" }
      );
      logDiagnostic({
        level: "warn",
        component: this.providerComponent,
        message: "Embedding lookup failed; retrieval will use fallback ordering.",
        errorCode: "EMBEDDING_FALLBACK",
        safeMetadata: {
          model: this.embeddingModel,
          inputLength: text.length,
          error: safeErrorMessage(error),
        },
      });
      return [];
    } finally {
      observeDuration(
        "openagentgraph_provider_call_duration_ms",
        "Provider call duration.",
        Date.now() - startedAtMs,
        { provider_mode: this.providerMode, operation: "embedding" }
      );
    }
  }

  async planGraph(
    goalPacket: GoalPacket,
    constraints: string | undefined,
    projection?: GraphProjection
  ): Promise<PlanGraphResult> {
    const startedAtMs = Date.now();
    const contextHint = projection
      ? `Current graph state: ${projection.nodes.length} nodes, drift state ${projection.driftState}.`
      : "No prior graph state exists yet.";

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `You are a planning engine for OpenAgentGraph.
Return valid JSON only with this schema:
{
  "nodes": [{
    "kind": "plan" | "work" | "evaluate" | "revision" | "replan",
    "title": "short title",
    "intent": "specific intent",
    "inputContext": "optional",
    "humanSummary": "plain English sentence for non-coders",
    "dependsOnNodeIds": ["title of dependency"],
    "contract": {
      "expectedArtifact": "what this step will produce",
      "allowedTools": ["readFile" | "writeFile" | "listDirectory" | "runCommand"],
      "acceptanceCriteria": ["deterministic checks"],
      "humanSummary": "plain English sentence"
    },
    "coordinates": {
      "depth": 0,
      "branch": 0,
      "abstractionLevel": 0,
      "driftDistance": 0,
      "baselineDriftDistance": 0
    }
  }]
}

Rules:
- Each node must have a concrete artifact and at least 2 acceptance criteria.
- Use only the allowed tool names.
- dependsOnNodeIds must reference node titles declared elsewhere.
- Avoid vague intents.`,
          },
          {
            role: "user",
            content: `Goal: ${goalPacket.originalText}
Success criteria: ${goalPacket.successCriteria.join("; ") || "(none provided)"}
Forbidden scope: ${goalPacket.forbiddenScope.join("; ") || "(none provided)"}
Constraints: ${constraints ?? "(none)"}
${contextHint}`,
          },
        ],
      });

      const raw = JSON.parse(response.choices[0].message.content ?? "{}");
      const titleToIndex = new Map<string, number>();
      const nodes = (raw.nodes ?? []).map((node: Record<string, unknown>, index: number): PlanGraphNodeInput => {
        const title = String(node.title ?? `Step ${index + 1}`);
        titleToIndex.set(title, index);

        const rawContract = node.contract as Record<string, unknown> | undefined;
        const contract: NodeContract = rawContract
          ? {
              expectedArtifact: String(rawContract.expectedArtifact ?? `${title} artifact`),
              allowedTools: Array.isArray(rawContract.allowedTools)
                ? rawContract.allowedTools.filter((tool): tool is ToolName => ALLOWED_TOOLS.includes(tool as ToolName))
                : ["listDirectory", "readFile"],
              acceptanceCriteria: Array.isArray(rawContract.acceptanceCriteria)
                ? rawContract.acceptanceCriteria.map(String)
                : [`Produce ${title} successfully`, "Avoid placeholders"],
              humanSummary: String(rawContract.humanSummary ?? node.humanSummary ?? node.intent ?? title),
            }
          : fallbackContract(title, String(node.intent ?? title));

        return {
          kind: (node.kind as PlanGraphNodeInput["kind"]) ?? "work",
          title,
          intent: String(node.intent ?? title),
          inputContext: node.inputContext ? String(node.inputContext) : undefined,
          humanSummary: String(node.humanSummary ?? contract.humanSummary),
          contract,
          parentNodeId: node.parentNodeId ? String(node.parentNodeId) : undefined,
          branchId: node.branchId ? String(node.branchId) : undefined,
          dependsOnNodeIds: Array.isArray(node.dependsOnNodeIds) ? node.dependsOnNodeIds.map(String) : [],
          coordinates: node.coordinates
            ? {
                depth: Number((node.coordinates as Record<string, unknown>).depth ?? index),
                branch: Number((node.coordinates as Record<string, unknown>).branch ?? 0),
                abstractionLevel: Number((node.coordinates as Record<string, unknown>).abstractionLevel ?? 0),
                driftDistance: Number((node.coordinates as Record<string, unknown>).driftDistance ?? 0),
                baselineDriftDistance: Number((node.coordinates as Record<string, unknown>).baselineDriftDistance ?? 0),
              }
            : fallbackCoordinates(index),
        };
      });

      return {
        nodes: nodes.map((node: PlanGraphNodeInput) => ({
          ...node,
          dependsOnNodeIds: node.dependsOnNodeIds.map((dep: string) => {
            const depIndex = titleToIndex.get(dep);
            return depIndex === undefined ? dep : nodes[depIndex].title;
          }),
        })),
      };
    } catch (error) {
      incrementFailureMetric("provider_error", this.providerComponent, "hard");
      throw error;
    } finally {
      observeDuration(
        "openagentgraph_provider_call_duration_ms",
        "Provider call duration.",
        Date.now() - startedAtMs,
        { provider_mode: this.providerMode, operation: "plan_graph" }
      );
    }
  }

  async executeNode(
    context: GraphContext,
    workspaceRoot: string,
    onToolCall?: (toolCall: Omit<ToolCallRecord, "id" | "nodeId">) => Promise<void>
  ): Promise<ExecuteNodeResult> {
    const startedAtMs = Date.now();
    const node = context.currentNode;
    const previousOutput = context.previousNodeOutput ?? "(none)";
    const relevantOutputs = formatRelevantOutputs(context.relevantOutputs);
    const workspaceChecksumBefore = await computeWorkspaceChecksum(workspaceRoot);

    const planningPrompt = `Goal: ${context.activeGoalPacket.originalText}
Current node: ${node.title}
Intent: ${node.intent}
Expected artifact: ${node.contract.expectedArtifact}
Allowed tools: ${node.contract.allowedTools.join(", ")}
Acceptance criteria:
- ${node.contract.acceptanceCriteria.join("\n- ")}
Previous node output:
${previousOutput}

Semantically relevant prior summaries:
${relevantOutputs}

Return valid JSON with:
{
  "toolCalls": [
    { "tool": "listDirectory", "path": "." },
    { "tool": "readFile", "path": "src/app.ts" }
  ],
  "finalOutput": "plain text output"
}

Use only the allowed tools. Keep toolCalls minimal and concrete.`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "You are executing a single OpenAgentGraph node. Plan the real tool calls first, then produce a final output grounded in those tool results.",
          },
          { role: "user", content: planningPrompt },
        ],
      });

      const raw = JSON.parse(response.choices[0].message.content ?? "{}") as Record<string, unknown>;
      const requestedCalls = Array.isArray(raw.toolCalls) ? raw.toolCalls as PlannedToolCall[] : [];
      const filteredCalls = requestedCalls.filter((call) => ALLOWED_TOOLS.includes(call.tool) && node.contract.allowedTools.includes(call.tool));
      const toolPlan = filteredCalls.length > 0 ? filteredCalls : [{ tool: "listDirectory", path: "." } satisfies PlannedToolCall];

      const executedToolCalls: Omit<ToolCallRecord, "id" | "nodeId">[] = [];
      const fileDiffs: FileDiff[] = [];
      const commandResults: CommandResult[] = [];

      for (const call of toolPlan) {
        try {
          const result = await runToolCall(workspaceRoot, call);
          executedToolCalls.push(result.toolCall);
          if (result.fileDiff) fileDiffs.push(result.fileDiff);
          if (result.commandResult) commandResults.push(result.commandResult);
          if (result.commandResult && (result.commandResult.exitCode !== 0 || result.commandResult.timedOut)) {
            incrementFailureMetric("tool_failure", this.providerComponent, "hard");
            incrementMetric(
              "openagentgraph_tool_execution_failures_total",
              "Tool execution failures captured during execution.",
              { tool: "runCommand" }
            );
            logDiagnostic({
              level: "warn",
              component: this.providerComponent,
              message: "A tool command finished with a non-passing result.",
              graphId: context.projection.graph.id,
              nodeId: node.id,
              errorCode: "TOOL_COMMAND_NON_PASSING",
              safeMetadata: {
                command: result.commandResult.command,
                exitCode: result.commandResult.exitCode,
                timedOut: result.commandResult.timedOut,
              },
            });
          }
          if (onToolCall) await onToolCall(result.toolCall);
        } catch (error) {
          incrementFailureMetric("tool_failure", this.providerComponent, "hard");
          incrementMetric(
            "openagentgraph_tool_execution_failures_total",
            "Tool execution failures captured during execution.",
            { tool: call.tool }
          );
          logDiagnostic({
            level: "warn",
            component: this.providerComponent,
            message: "Tool execution failed and was captured as node evidence.",
            graphId: context.projection.graph.id,
            nodeId: node.id,
            errorCode: "TOOL_EXECUTION_FAILED",
            safeMetadata: {
              tool: call.tool,
              error: safeErrorMessage(error),
            },
          });
          const toolCall: Omit<ToolCallRecord, "id" | "nodeId"> = {
            tool: call.tool,
            input: call as unknown as Record<string, unknown>,
            error: error instanceof Error ? error.message : String(error),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          };
          executedToolCalls.push(toolCall);
          if (onToolCall) await onToolCall(toolCall);
        }
      }

      const toolSummary = executedToolCalls
        .map((toolCall) => `[${toolCall.tool}] ${toolCall.output ?? toolCall.error ?? "(no output)"}`)
        .join("\n");

      const finalOutput = typeof raw.finalOutput === "string" && raw.finalOutput.trim()
        ? raw.finalOutput
        : `Executed ${executedToolCalls.length} tool call(s) for ${node.title}.\n${toolSummary}`;

      const workspaceChecksumAfter = await computeWorkspaceChecksum(workspaceRoot);
      const evidence: NodeEvidence = {
        fileDiffs,
        commandResults,
        toolCallLog: executedToolCalls.map((toolCall) => ({
          ...toolCall,
          id: "",
          nodeId: "",
        })),
        workspaceChecksum: workspaceChecksumAfter,
        workspaceChecksumBefore,
        workspaceChecksumAfter,
      };

      return {
        prompt: planningPrompt,
        output: finalOutput,
        confidence: 0.75,
        toolCalls: executedToolCalls,
        evidence,
      };
    } catch (error) {
      incrementFailureMetric("provider_error", this.providerComponent, "hard");
      throw error;
    } finally {
      observeDuration(
        "openagentgraph_provider_call_duration_ms",
        "Provider call duration.",
        Date.now() - startedAtMs,
        { provider_mode: this.providerMode, operation: "execute_node" }
      );
    }
  }

  async evaluateNode(context: GraphContext, rubric: string): Promise<EvaluateNodeResult> {
    const startedAtMs = Date.now();
    const node = context.currentNode;
    const outputSummary = node.semanticSummary ?? (await summarizeOutput(this.client, this.model, node.output ?? "", {
      providerMode: this.providerMode,
      component: this.providerComponent,
    }));
    const summaryEmbedding =
      node.semanticEmbedding && node.semanticEmbedding.length > 0
        ? node.semanticEmbedding
        : await this.getEmbedding(outputSummary);
    const activeGoalPacket = context.activeGoalPacket;
    const baselineGoalPacket =
      context.projection.goalPackets.find(
        (packet) => packet.id === context.projection.graph.originalGoalVersionId
      ) ?? activeGoalPacket;

    const criteriaScores = activeGoalPacket.criteriaEmbeddings.length > 0
      ? activeGoalPacket.criteriaEmbeddings.map((embedding) => cosineSimilarity(summaryEmbedding, embedding))
      : [];
    const driftScore = criteriaScores.length > 0
      ? criteriaScores.reduce((total, score) => total + score, 0) / criteriaScores.length
      : summaryEmbedding.length > 0 && activeGoalPacket.embedding.length > 0
        ? cosineSimilarity(summaryEmbedding, activeGoalPacket.embedding)
        : 0.7;
    const baselineDriftScore =
      summaryEmbedding.length > 0 && baselineGoalPacket.embedding.length > 0
        ? cosineSimilarity(summaryEmbedding, baselineGoalPacket.embedding)
        : driftScore;

    try {
      const llmResponse = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: `You are a strict evaluator for OpenAgentGraph nodes.
Return valid JSON only with:
{
  "llmPassed": true,
  "findings": ["..."],
  "ruleViolations": ["..."],
  "humanSummary": "plain English summary",
  "suggestedAction": "complete" | "revise" | "replan"
}`,
          },
          {
            role: "user",
            content: `Node title: ${node.title}
Intent: ${node.intent}
Expected artifact: ${node.contract.expectedArtifact}
Acceptance criteria:
- ${node.contract.acceptanceCriteria.join("\n- ")}
Output summary:
${outputSummary}

Rubric: ${rubric}
Original goal: ${baselineGoalPacket.originalText}
Active goal: ${activeGoalPacket.originalText}`,
          },
        ],
      });

      const raw = JSON.parse(llmResponse.choices[0].message.content ?? "{}") as Record<string, unknown>;
      const deterministic = await runDeterministicChecks(
        node.contract.acceptanceCriteria,
        node.evidence ?? {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [],
          workspaceChecksum: "",
          workspaceChecksumBefore: "",
          workspaceChecksumAfter: "",
        },
        context.workspaceRoot,
        node.output
      );

      const evaluation: NodeEvaluation = {
        llmPassed: Boolean(raw.llmPassed),
        deterministicPassed: deterministic.passed,
        passed: Boolean(raw.llmPassed) && deterministic.passed,
        driftScore,
        baselineDriftScore,
        direction: clampDirection(driftScore),
        humanSummary: String(raw.humanSummary ?? `${node.title} was evaluated.`),
        suggestedAction: (raw.suggestedAction as NodeEvaluation["suggestedAction"]) ?? "revise",
        findings: [
          ...(Array.isArray(raw.findings) ? raw.findings.map(String) : []),
          ...deterministic.findings,
        ],
        ruleViolations: Array.isArray(raw.ruleViolations) ? raw.ruleViolations.map(String) : [],
      };

      return { evaluation };
    } catch (error) {
      incrementFailureMetric("provider_error", this.providerComponent, "hard");
      throw error;
    } finally {
      observeDuration(
        "openagentgraph_provider_call_duration_ms",
        "Provider call duration.",
        Date.now() - startedAtMs,
        { provider_mode: this.providerMode, operation: "evaluate_node" }
      );
    }
  }
}
