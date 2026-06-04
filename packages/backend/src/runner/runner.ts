import { nanoid } from "nanoid";
import type {
  GoalPacket,
  GraphContext,
  GraphEvent,
  GraphEventKind,
  GraphProjection,
  LineageDescriptor,
  Node,
  NodeContract,
  NodeEvidence,
  NodeEvaluation,
  NodePlannedPayload,
  PlanGraphNodeInput,
  ProviderLineageSnapshot,
  RelevantNodeOutput,
  ReplanRequest,
  RunPausedPayload,
  RunResumedPayload,
  RunStartedPayload,
  RunStoppedPayload,
} from "@openagentgraph/shared";
import type { AIProvider } from "../providers/interface.js";
import * as repo from "../db/graphRepo.js";
import { logDiagnostic, safeErrorMessage } from "../observability/logger.js";
import { incrementMetric, observeDuration } from "../observability/metrics.js";

const DEFAULT_RUBRIC =
  "The output must satisfy the node intent, match the declared artifact, and provide evidence for deterministic verification.";

const MAX_REVISIONS = 3;
const NODE_BUDGET = 25;

type EventRecorder = <K extends GraphEventKind>(event: {
  graphId: string;
  kind: K;
  nodeId?: string;
  goalVersionId?: string;
  payload: GraphEvent<K>["payload"];
}) => Promise<GraphEvent<K>>;

type RunGraphOptions = {
  resume?: boolean;
};

function normalizeContract(contract: NodeContract, title: string, intent: string): NodeContract {
  return {
    expectedArtifact: contract.expectedArtifact || `${title} artifact`,
    allowedTools: contract.allowedTools.length > 0 ? contract.allowedTools : ["listDirectory", "readFile"],
    acceptanceCriteria:
      contract.acceptanceCriteria.length > 0
        ? contract.acceptanceCriteria
        : [`Produce ${title}`, `Satisfy intent: ${intent}`],
    humanSummary: contract.humanSummary || intent,
  };
}

function topologicalSort(nodes: Array<{ id: string; dependsOnNodeIds: string[] }>): string[] | null {
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, node.dependsOnNodeIds.length);
    for (const dep of node.dependsOnNodeIds) {
      const list = outgoing.get(dep) ?? [];
      list.push(node.id);
      outgoing.set(dep, list);
    }
  }

  const queue = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of outgoing.get(current) ?? []) {
      const nextDegree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }

  return order.length === nodes.length ? order : null;
}

function validatePlanShape(nodes: PlanGraphNodeInput[]) {
  if (nodes.length === 0) throw new Error("Planner returned no nodes");
  if (nodes.length > NODE_BUDGET) throw new Error(`Planner returned ${nodes.length} nodes, above the node budget`);

  const titles = new Set<string>();
  for (const node of nodes) {
    if (titles.has(node.title)) throw new Error(`Planner produced duplicate node title: ${node.title}`);
    titles.add(node.title);
    if (!node.intent || node.intent.trim().length < 8) {
      throw new Error(`Planner produced a vague intent for node: ${node.title}`);
    }
    if (!node.contract.expectedArtifact || node.contract.acceptanceCriteria.length === 0) {
      throw new Error(`Planner produced an invalid contract for node: ${node.title}`);
    }
  }

  const resolved = nodes.map((node) => ({ id: node.title, dependsOnNodeIds: node.dependsOnNodeIds }));
  if (!topologicalSort(resolved)) throw new Error("Planner produced a cyclic dependency graph");

  const roots = resolved.filter((node) => node.dependsOnNodeIds.length === 0);
  if (roots.length === 0) throw new Error("Planner produced no root nodes");

  const reachable = new Set<string>();
  const queue = roots.map((node) => node.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const node of resolved.filter((candidate) => candidate.dependsOnNodeIds.includes(current))) {
      queue.push(node.id);
    }
  }

  if (reachable.size !== nodes.length) throw new Error("Planner produced disconnected or orphaned nodes");
}

async function planPhase(
  projection: GraphProjection,
  goalPacket: GoalPacket,
  provider: AIProvider,
  record: EventRecorder,
  branchId?: string,
  parentNodeId?: string,
  extraDependsOnNodeIdsForRoots: string[] = []
) {
  const planningLineage = provider.describeGraphLineage({
    goalPacket,
    constraints: projection.graph.constraints,
    projection,
  });
  await declareLineageDescriptors(projection.graph.id, planningLineage, record);
  const plan = await provider.planGraph(goalPacket, projection.graph.constraints, projection);
  validatePlanShape(plan.nodes);

  const titleToRuntimeId = new Map<string, string>();
  for (const plannedNode of plan.nodes) {
    titleToRuntimeId.set(plannedNode.title, nanoid());
  }

  for (const plannedNode of plan.nodes) {
    const nodeId = titleToRuntimeId.get(plannedNode.title)!;
    const payload: NodePlannedPayload = {
      kind: plannedNode.kind,
      title: plannedNode.title,
      intent: plannedNode.intent,
      inputContext: plannedNode.inputContext,
      humanSummary: plannedNode.humanSummary,
      contract: normalizeContract(plannedNode.contract, plannedNode.title, plannedNode.intent),
      parentNodeId: plannedNode.parentNodeId ?? parentNodeId,
      branchId: plannedNode.branchId ?? branchId,
      baselineGoalVersionId: projection.graph.originalGoalVersionId,
      activeGoalVersionId: goalPacket.id,
      dependsOnNodeIds: [
        ...plannedNode.dependsOnNodeIds.map((dep) => titleToRuntimeId.get(dep) ?? dep),
        ...(plannedNode.dependsOnNodeIds.length === 0 ? extraDependsOnNodeIdsForRoots : []),
      ],
      coordinates: plannedNode.coordinates,
    };

    await record({
      graphId: projection.graph.id,
      kind: "node.planned",
      nodeId,
      payload,
    });

    await bindNodeLineage(projection.graph.id, nodeId, planningLineage, record);
  }
}

async function declareLineageDescriptors(
  graphId: string,
  snapshot: ProviderLineageSnapshot,
  record: EventRecorder
) {
  const projection = await repo.getGraphProjection(graphId);
  const known = new Set(projection.lineageDescriptors.map((descriptor) => descriptor.lineageId));
  for (const descriptor of Object.values(snapshot)) {
    if (!descriptor || known.has(descriptor.lineageId)) continue;
    await record({
      graphId,
      kind: "system.lineage_declared",
      payload: descriptor,
    });
    known.add(descriptor.lineageId);
  }
}

async function bindNodeLineage(
  graphId: string,
  nodeId: string,
  snapshot: ProviderLineageSnapshot,
  record: EventRecorder
) {
  const bindings = Object.values(snapshot)
    .filter((descriptor): descriptor is LineageDescriptor => Boolean(descriptor))
    .map((descriptor) => ({
      kind: descriptor.kind,
      lineageId: descriptor.lineageId,
    }));

  if (bindings.length === 0) return;

  await declareLineageDescriptors(graphId, snapshot, record);
  await record({
    graphId,
    kind: "node.lineage_bound",
    nodeId,
    payload: {
      graphId,
      nodeId,
      createdAt: new Date().toISOString(),
      bindings,
    },
  });
}

function pickNextNode(projection: GraphProjection): Node | null {
  const completedIds = new Set(
    projection.nodes
      .filter((node) => node.status === "completed" || node.status === "superseded")
      .map((node) => node.id)
  );

  for (const node of projection.nodes) {
    if (!["pending", "ready"].includes(node.status)) continue;
    const blocked = node.dependsOnNodeIds.some((dep) => !completedIds.has(dep));
    if (!blocked) return node;
  }

  return null;
}

function getPendingRunControlAction(events: GraphEvent[]): "pause" | "stop" | null {
  let pending: "pause" | "stop" | null = null;
  for (const event of events) {
    switch (event.kind) {
      case "run.pause_requested":
        pending = "pause";
        break;
      case "run.stop_requested":
        pending = "stop";
        break;
      case "run.paused":
      case "run.stopped":
      case "run.completed":
      case "run.failed":
      case "run.resumed":
      case "run.started":
        pending = null;
        break;
    }
  }
  return pending;
}

function isExecutionGatedByApproval(projection: GraphProjection): boolean {
  return projection.waitingForApproval || projection.approvalState === "rejected";
}

function findActiveGoalPacket(projection: GraphProjection): GoalPacket {
  return (
    projection.goalPackets.find((packet) => packet.id === projection.graph.activeGoalVersionId) ??
    projection.goalPackets[projection.goalPackets.length - 1]
  );
}

function buildRetrievalQuery(projection: GraphProjection, node: Node): string {
  const goalPacket = findActiveGoalPacket(projection);
  return [
    goalPacket.originalText,
    `Current node: ${node.title}`,
    `Intent: ${node.intent}`,
    `Expected artifact: ${node.contract.expectedArtifact}`,
    node.inputContext ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFallbackRelevantOutputs(projection: GraphProjection, node: Node, limit: number): RelevantNodeOutput[] {
  const currentDepth = node.coordinates?.depth ?? Number.MAX_SAFE_INTEGER;
  return projection.nodes
    .filter((candidate) => candidate.id !== node.id && candidate.status === "completed")
    .filter((candidate) => Boolean(candidate.semanticSummary || candidate.humanSummary))
    .sort((a, b) => {
      const depthA = Math.abs((a.coordinates?.depth ?? currentDepth) - currentDepth);
      const depthB = Math.abs((b.coordinates?.depth ?? currentDepth) - currentDepth);
      if (depthA !== depthB) return depthA - depthB;
      return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
    })
    .slice(0, limit)
    .map((candidate) => ({
      nodeId: candidate.id,
      title: candidate.title,
      summary: candidate.semanticSummary || candidate.humanSummary,
      output: candidate.output,
      completedAt: candidate.completedAt,
    }));
}

export async function buildNodeContext(
  projection: GraphProjection,
  node: Node,
  provider: AIProvider
): Promise<GraphContext> {
  const previousNode = projection.nodes
    .filter((candidate) => candidate.id !== node.id && candidate.status === "completed")
    .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!))
    .at(-1);

  const queryEmbedding = await provider.embedRetrievalQuery(buildRetrievalQuery(projection, node));
  const retrievedOutputs =
    queryEmbedding.length > 0
      ? await repo.findRelevantNodeOutputs(projection.graph.id, queryEmbedding, 3)
      : [];
  const relevantOutputs =
    retrievedOutputs.length > 0 ? retrievedOutputs : buildFallbackRelevantOutputs(projection, node, 3);

  return {
    currentNode: node,
    projection,
    activeGoalPacket: findActiveGoalPacket(projection),
    workspaceRoot: undefined,
    previousNodeOutput: previousNode?.output,
    retrievalMode: retrievedOutputs.length > 0 ? "semantic" : "fallback",
    relevantOutputs,
  };
}

function hasEvidence(evidence: NodeEvidence, evaluation?: NodeEvaluation): boolean {
  return (
    Boolean(evidence.workspaceChecksum) &&
    (evidence.toolCallLog.length > 0 ||
      evidence.commandResults.length > 0 ||
      evidence.fileDiffs.length > 0 ||
      Boolean(evaluation))
  );
}

async function runNode(
  projection: GraphProjection,
  node: Node,
  workspaceRoot: string,
  provider: AIProvider,
  record: EventRecorder,
  runLoopId: string
) {
  logDiagnostic({
    level: "info",
    component: "runner",
    message: `Executing node ${node.title}.`,
    graphId: projection.graph.id,
    nodeId: node.id,
    runLoopId,
  });
  const context = await buildNodeContext(projection, node, provider);
  if (context.retrievalMode === "fallback") {
    incrementMetric(
      "openagentgraph_provider_fallback_total",
      "Provider and retrieval fallback occurrences by fallback type.",
      { fallback_type: "retrieval" }
    );
    logDiagnostic({
      level: "warn",
      component: "runner",
      message: "Fallback retrieval logic was used for this step.",
      graphId: projection.graph.id,
      nodeId: node.id,
      runLoopId,
      errorCode: "RETRIEVAL_FALLBACK",
    });
  }
  context.workspaceRoot = workspaceRoot;
  await bindNodeLineage(
    projection.graph.id,
    node.id,
    provider.describeNodeLineage({ context }),
    record
  );
  const execution = await provider.executeNode(context, workspaceRoot, async (toolCall) => {
    await record({
      graphId: projection.graph.id,
      kind: "node.tool_call",
      nodeId: node.id,
      payload: {
        toolCall: {
          ...toolCall,
          id: nanoid(),
          nodeId: node.id,
        },
      },
    });
  });

  await record({
    graphId: projection.graph.id,
    kind: "node.executing",
    nodeId: node.id,
    payload: {
      prompt: execution.prompt,
      workspaceRoot,
    },
  });

  await record({
    graphId: projection.graph.id,
    kind: "node.output",
    nodeId: node.id,
    payload: {
      output: execution.output,
      mode: "final",
    },
  });

  if (!hasEvidence(execution.evidence)) {
    logDiagnostic({
      level: "warn",
      component: "runner",
      message: "Node execution finished without usable evidence.",
      graphId: projection.graph.id,
      nodeId: node.id,
      runLoopId,
      errorCode: "NODE_EVIDENCE_MISSING",
    });
    await record({
      graphId: projection.graph.id,
      kind: "node.failed",
      nodeId: node.id,
      payload: {
        reason: "No evidence was captured for this node.",
      },
    });
    return;
  }

  await record({
    graphId: projection.graph.id,
    kind: "node.completed",
    nodeId: node.id,
    payload: {
      output: execution.output,
      confidence: execution.confidence,
      evidence: {
        ...execution.evidence,
        toolCallLog: execution.toolCalls.map((toolCall) => ({
          ...toolCall,
          id: nanoid(),
          nodeId: node.id,
        })),
      },
    },
  });

  const nextProjection = await repo.getGraphProjection(projection.graph.id);
  const completedNode =
    nextProjection.nodes.find((candidate) => candidate.id === node.id) ?? node;
  const summarizedContext = await buildNodeContext(nextProjection, completedNode, provider);
  summarizedContext.workspaceRoot = workspaceRoot;
  const semanticSummary = await provider.summarizeCompletedNode(summarizedContext);

  await record({
    graphId: projection.graph.id,
    kind: "node.summarized",
    nodeId: node.id,
    payload: semanticSummary,
  });

  const summarizedProjection = await repo.getGraphProjection(projection.graph.id);
  const evaluatedContext = await buildNodeContext(
    summarizedProjection,
    summarizedProjection.nodes.find((candidate) => candidate.id === node.id) ?? node,
    provider
  );
  evaluatedContext.workspaceRoot = workspaceRoot;
  await bindNodeLineage(
    projection.graph.id,
    node.id,
    provider.describeNodeLineage({ context: evaluatedContext, rubric: DEFAULT_RUBRIC }),
    record
  );
  const evaluation = await provider.evaluateNode(evaluatedContext, DEFAULT_RUBRIC);

  await record({
    graphId: projection.graph.id,
    kind: "node.evaluated",
    nodeId: node.id,
    payload: {
      evaluation: evaluation.evaluation,
    },
  });
}

async function createRevisionNode(node: Node, record: EventRecorder) {
  await record({
    graphId: node.graphId,
    kind: "node.planned",
    nodeId: nanoid(),
    payload: {
      kind: "revision",
      title: `${node.title} (revision)`,
      intent: `Revise ${node.title}: ${node.intent}`,
      inputContext: node.output,
      humanSummary: `Revision of ${node.title}`,
      contract: node.contract,
      parentNodeId: node.id,
      branchId: node.branchId,
      baselineGoalVersionId: node.baselineGoalVersionId,
      activeGoalVersionId: node.activeGoalVersionId,
      dependsOnNodeIds: [...node.dependsOnNodeIds],
      coordinates: node.coordinates,
    },
  });
}

async function createGoalVersion(
  projection: GraphProjection,
  request: ReplanRequest,
  provider: AIProvider,
  record: EventRecorder
): Promise<GoalPacket> {
  const active = findActiveGoalPacket(projection);
  const packet = await provider.buildGoalPacket({
    goal: request.newGoal,
    successCriteria: request.successCriteria ?? active.successCriteria,
    forbiddenScope: request.forbiddenScope ?? active.forbiddenScope,
    version: active.version + 1,
  });

  await record({
    graphId: projection.graph.id,
    kind: "goal.version_created",
    goalVersionId: packet.id,
    payload: {
      graphTitle: projection.graph.title,
      goal: request.newGoal,
      constraints: projection.graph.constraints,
      goalPacket: packet,
      activate: true,
    },
  });

  return packet;
}

async function createReplanBranch(
  projection: GraphProjection,
  node: Node,
  evaluation: NodeEvaluation | undefined,
  provider: AIProvider,
  record: EventRecorder
) {
  const branchId = `replan-${nanoid(6)}`;
  const findings = evaluation?.findings.join("; ") || "Execution diverged from plan";
  const newGoalPacket = await createGoalVersion(
    projection,
    {
      newGoal: `${projection.graph.goal}\nReplan focus: ${findings}`,
      reason: findings,
      successCriteria: findActiveGoalPacket(projection).successCriteria,
      forbiddenScope: findActiveGoalPacket(projection).forbiddenScope,
    },
    provider,
    record
  );

  await record({
    graphId: projection.graph.id,
    kind: "replan.branched",
    nodeId: node.id,
    goalVersionId: newGoalPacket.id,
    payload: {
      branchId,
      sourceNodeId: node.id,
      newGoalVersionId: newGoalPacket.id,
      reason: findings,
    },
  });

  const pendingStatuses = new Set(["pending", "ready", "running", "blocked", "failed"]);
  const downstreamIds = new Set<string>();
  const queue = [node.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const candidate of projection.nodes) {
      if (!candidate.dependsOnNodeIds.includes(current)) continue;
      if (!downstreamIds.has(candidate.id)) {
        downstreamIds.add(candidate.id);
        queue.push(candidate.id);
      }
    }
  }

  const downstream = projection.nodes.filter(
    (candidate) => downstreamIds.has(candidate.id) && pendingStatuses.has(candidate.status)
  );

  for (const target of downstream) {
    await record({
      graphId: projection.graph.id,
      kind: "node.superseded",
      nodeId: target.id,
      payload: {
        branchId,
        supersededByNodeId: node.id,
        reason: findings,
      },
    });
  }

  await planPhase(
    await repo.getGraphProjection(projection.graph.id),
    newGoalPacket,
    provider,
    record,
    branchId,
    node.id,
    [node.id]
  );
}

function countRevisions(projection: GraphProjection, node: Node): number {
  const originalId = node.parentNodeId ?? node.id;
  return projection.nodes.filter(
    (candidate) => candidate.kind === "revision" && (candidate.parentNodeId ?? candidate.id) === originalId
  ).length;
}

export async function runGraph(
  graphId: string,
  workspaceRoot: string,
  provider: AIProvider,
  record: EventRecorder,
  options?: RunGraphOptions
): Promise<void> {
  const runLoopId = `runloop-${nanoid(8)}`;
  const recordIterationDuration = (startedAtMs: number, outcome: string) => {
    observeDuration(
      "openagentgraph_run_loop_iteration_duration_ms",
      "Run loop iteration duration.",
      Date.now() - startedAtMs,
      { outcome }
    );
  };
  incrementMetric(
    "openagentgraph_run_loops_started_total",
    "Run loop starts.",
    undefined,
    1
  );
  let projection = await repo.getGraphProjection(graphId);
  const activeGoalPacket = findActiveGoalPacket(projection);
  logDiagnostic({
    level: "info",
    component: "runner",
    message: options?.resume ? "Resuming run loop." : "Starting run loop.",
    graphId,
    runLoopId,
    safeMetadata: {
      workspaceRoot,
      goalVersionId: activeGoalPacket.id,
    },
  });

  if (options?.resume) {
    const payload: RunResumedPayload = {
      workspaceRoot,
      goalVersionId: activeGoalPacket.id,
    };
    await record({
      graphId,
      kind: "run.resumed",
      goalVersionId: activeGoalPacket.id,
      payload,
    });
  } else {
    const payload: RunStartedPayload = {
      workspaceRoot,
      goalVersionId: activeGoalPacket.id,
    };
    await record({
      graphId,
      kind: "run.started",
      goalVersionId: activeGoalPacket.id,
      payload,
    });
  }

  projection = await repo.getGraphProjection(graphId);
  if (projection.nodes.length === 0) {
    logDiagnostic({
      level: "info",
      component: "runner",
      message: "No nodes exist yet; entering planning phase.",
      graphId,
      runLoopId,
    });
    await planPhase(projection, findActiveGoalPacket(projection), provider, record);
    projection = await repo.getGraphProjection(graphId);
  }

  try {
    while (true) {
      const iterationStartedAtMs = Date.now();
      projection = await repo.getGraphProjection(graphId);

      const controlAction = getPendingRunControlAction(projection.events);
      if (controlAction === "stop") {
        incrementMetric(
          "openagentgraph_run_loops_stopped_total",
          "Run loops stopped after a stop request.",
          undefined,
          1
        );
        logDiagnostic({
          level: "info",
          component: "runner",
          message: "Stop requested; halting after the current step.",
          graphId,
          runLoopId,
        });
        const payload: RunStoppedPayload = {};
        await record({
          graphId,
          kind: "run.stopped",
          payload,
        });
        recordIterationDuration(iterationStartedAtMs, "stopped");
        return;
      }
      if (controlAction === "pause") {
        incrementMetric(
          "openagentgraph_run_loops_paused_total",
          "Run loops paused after a pause request.",
          undefined,
          1
        );
        logDiagnostic({
          level: "info",
          component: "runner",
          message: "Pause requested; pausing before the next step.",
          graphId,
          runLoopId,
        });
        const payload: RunPausedPayload = {};
        await record({
          graphId,
          kind: "run.paused",
          payload,
        });
        recordIterationDuration(iterationStartedAtMs, "paused");
        return;
      }
      if (isExecutionGatedByApproval(projection)) {
        logDiagnostic({
          level: "info",
          component: "runner",
          message:
            projection.approvalState === "rejected"
              ? "Run is halted because continuation was rejected."
              : "Run is waiting for approval before continuing.",
          graphId,
          runLoopId,
          errorCode: "APPROVAL_GATED",
        });
        recordIterationDuration(iterationStartedAtMs, "approval_gated");
        return;
      }

      const next = pickNextNode(projection);
      if (!next) {
        recordIterationDuration(iterationStartedAtMs, "idle");
        break;
      }

      await record({
        graphId,
        kind: "node.ready",
        nodeId: next.id,
        payload: {
          readyReason: "All dependencies are completed or superseded.",
        },
      });

      projection = await repo.getGraphProjection(graphId);
      const currentNode = projection.nodes.find((node) => node.id === next.id);
      if (!currentNode) break;

      await runNode(projection, currentNode, workspaceRoot, provider, record, runLoopId);
      projection = await repo.getGraphProjection(graphId);

      const updatedNode = projection.nodes.find((node) => node.id === currentNode.id);
      if (!updatedNode) continue;

      if (updatedNode.status === "failed") {
        continue;
      }

      if (!updatedNode.evaluation) continue;

      if (updatedNode.evaluation.passed || updatedNode.evaluation.suggestedAction === "complete") {
        continue;
      }

      if (
        updatedNode.evaluation.suggestedAction === "replan" ||
        countRevisions(projection, updatedNode) >= MAX_REVISIONS
      ) {
        logDiagnostic({
          level: "warn",
          component: "runner",
          message: "Node evaluation triggered a replan branch.",
          graphId,
          nodeId: updatedNode.id,
          runLoopId,
          errorCode: "NODE_REPLAN",
        });
        await createReplanBranch(projection, updatedNode, updatedNode.evaluation, provider, record);
      } else {
        logDiagnostic({
          level: "info",
          component: "runner",
          message: "Node evaluation triggered a revision step.",
          graphId,
          nodeId: updatedNode.id,
          runLoopId,
          errorCode: "NODE_REVISION",
        });
        await createRevisionNode(updatedNode, record);
      }

      projection = await repo.getGraphProjection(graphId);
      if (isExecutionGatedByApproval(projection)) {
        return;
      }

      const postNodeControl = getPendingRunControlAction(projection.events);
      if (postNodeControl === "stop") {
        incrementMetric(
          "openagentgraph_run_loops_stopped_total",
          "Run loops stopped after a stop request.",
          undefined,
          1
        );
        logDiagnostic({
          level: "info",
          component: "runner",
          message: "Stop requested; run stopped after the current step.",
          graphId,
          nodeId: currentNode.id,
          runLoopId,
        });
        const payload: RunStoppedPayload = { afterNodeId: currentNode.id };
        await record({
          graphId,
          kind: "run.stopped",
          payload,
        });
        recordIterationDuration(iterationStartedAtMs, "stopped");
        return;
      }
      if (postNodeControl === "pause") {
        incrementMetric(
          "openagentgraph_run_loops_paused_total",
          "Run loops paused after a pause request.",
          undefined,
          1
        );
        logDiagnostic({
          level: "info",
          component: "runner",
          message: "Pause requested; run paused after the current step.",
          graphId,
          nodeId: currentNode.id,
          runLoopId,
        });
        const payload: RunPausedPayload = { afterNodeId: currentNode.id };
        await record({
          graphId,
          kind: "run.paused",
          payload,
        });
        recordIterationDuration(iterationStartedAtMs, "paused");
        return;
      }
      recordIterationDuration(iterationStartedAtMs, "scheduled");
    }

    projection = await repo.getGraphProjection(graphId);
    const incomplete = projection.nodes.filter(
      (node) => !["completed", "superseded"].includes(node.status)
    );

    if (incomplete.length > 0) {
      logDiagnostic({
        level: "warn",
        component: "runner",
        message: `Run blocked with ${incomplete.length} incomplete nodes remaining.`,
        graphId,
        runLoopId,
        errorCode: "RUN_BLOCKED",
      });
      await record({
        graphId,
        kind: "run.failed",
        payload: {
          reason: `Run blocked with ${incomplete.length} incomplete nodes remaining.`,
          blocked: true,
        },
      });
      observeDuration(
        "openagentgraph_run_loop_iteration_duration_ms",
        "Run loop iteration duration.",
        0,
        { outcome: "blocked" }
      );
      return;
    }

    await record({
      graphId,
      kind: "run.completed",
      payload: {
        completedNodeIds: projection.nodes
          .filter((node) => node.status === "completed")
          .map((node) => node.id),
      },
    });
    logDiagnostic({
      level: "info",
      component: "runner",
      message: "Run completed successfully.",
      graphId,
      runLoopId,
    });
    incrementMetric(
      "openagentgraph_run_loops_completed_total",
      "Run loops completed successfully.",
      undefined,
      1
    );
  } catch (error) {
    observeDuration(
      "openagentgraph_run_loop_iteration_duration_ms",
      "Run loop iteration duration.",
      0,
      { outcome: "failed" }
    );
    const message = error instanceof Error ? error.message : String(error);
    logDiagnostic({
      level: "error",
      component: "runner",
      message: safeErrorMessage(error),
      graphId,
      runLoopId,
      errorCode: "RUN_FAILED",
    });
    await record({
      graphId,
      kind: "run.failed",
      payload: {
        reason: message,
        blocked: false,
      },
    });
    throw error;
  }
}
