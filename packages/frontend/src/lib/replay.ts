import type {
  Edge,
  FrontierStatus,
  GraphEvent,
  GraphStatus,
  HumanDriftState,
  Node,
  NodeEvaluation,
  NodePlannedPayload,
  RunControlState,
} from "@openagentgraph/shared";

export interface FrontendReplayFrame {
  stepIndex: number;
  totalSteps: number;
  event: GraphEvent | null;
  graphStatus: GraphStatus;
  runControlState: RunControlState;
  nodes: Node[];
  edges: Edge[];
  driftState: HumanDriftState;
  frontierStatus: FrontierStatus;
  driftSummary: string;
  plainEnglishSummary: string;
}

function emptyNode(nodeId: string, payload: NodePlannedPayload, ts: string): Node {
  return {
    id: nodeId,
    graphId: "",
    kind: payload.kind,
    title: payload.title,
    intent: payload.intent,
    inputContext: payload.inputContext,
    humanSummary: payload.humanSummary,
    status: "pending",
    contract: payload.contract,
    baselineGoalVersionId: payload.baselineGoalVersionId,
    activeGoalVersionId: payload.activeGoalVersionId,
    dependsOnNodeIds: payload.dependsOnNodeIds,
    parentNodeId: payload.parentNodeId,
    branchId: payload.branchId,
    coordinates: payload.coordinates,
    createdAt: ts,
    updatedAt: ts,
  };
}

function deriveFrontier(nodes: Node[], graphStatus: GraphStatus): {
  driftState: HumanDriftState;
  frontierStatus: FrontierStatus;
  driftSummary: string;
} {
  if (graphStatus === "blocked") {
    return {
      driftState: "drifting",
      frontierStatus: "blocked",
      driftSummary: "The run is blocked and needs help before it can continue.",
    };
  }

  const latestEvaluated = [...nodes]
    .filter((node) => node.evaluation)
    .sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt))
    .at(-1);

  if (!latestEvaluated?.evaluation) {
    return {
      driftState: "on_track",
      frontierStatus: "on_track",
      driftSummary: "The run has not produced enough evaluated work to assess drift yet.",
    };
  }

  if (latestEvaluated.evaluation.direction === "drifting") {
    return {
      driftState: "drifting",
      frontierStatus: "drifting",
      driftSummary: latestEvaluated.evaluation.humanSummary || "The system is drifting away from the requested path.",
    };
  }

  if (latestEvaluated.evaluation.direction === "holding") {
    return {
      driftState: "exploring",
      frontierStatus: "exploring",
      driftSummary: latestEvaluated.evaluation.humanSummary || "The system is exploring adjacent work.",
    };
  }

  return {
    driftState: "on_track",
    frontierStatus: "on_track",
    driftSummary: latestEvaluated.evaluation.humanSummary || "The system is still moving toward the goal.",
  };
}

function deriveRunControlState(events: GraphEvent[]): RunControlState {
  let runControlState: RunControlState = "idle";
  for (const event of events) {
    switch (event.kind) {
      case "run.started":
      case "run.resumed":
        runControlState = "running";
        break;
      case "run.paused":
        runControlState = "paused";
        break;
      case "run.stopped":
        runControlState = "stopped";
        break;
      case "run.completed":
      case "run.failed":
        runControlState = "idle";
        break;
    }
  }
  return runControlState;
}

function summarizeEvent(event: GraphEvent | null, nodes: Node[]): string {
  if (!event) {
    return "The replay is at the starting point. No work has happened yet.";
  }

  const node = event.nodeId ? nodes.find((candidate) => candidate.id === event.nodeId) : null;
  if (!node) {
    switch (event.kind) {
      case "run.pause_requested":
        return "A pause was requested. The system will stop after the current step finishes.";
      case "run.paused":
        return "The run is paused and waiting to resume.";
      case "run.resume_requested":
        return "A resume was requested for the paused run.";
      case "run.resumed":
        return "The run resumed from the same graph state.";
      case "run.stop_requested":
        return "A stop was requested. The system will stop after the current step finishes.";
      case "run.stopped":
        return "The run stopped cleanly after its current step.";
      case "run.review_requested":
        return "The run was marked for human review.";
      default:
        return `The graph recorded ${event.kind.replace(".", " ")}.`;
    }
  }

  switch (event.kind) {
    case "node.planned":
      return `The system added '${node.title}' to the plan.`;
    case "node.ready":
      return `'${node.title}' became ready to run.`;
    case "node.executing":
      return `The system started working on '${node.title}'.`;
    case "node.completed":
      return `'${node.title}' finished and captured evidence.`;
    case "node.summarized":
      return `The system wrote a plain-English summary for '${node.title}'.`;
    case "node.evaluated":
      return node.evaluation?.humanSummary || `The system evaluated '${node.title}'.`;
    case "node.failed":
      return node.evidenceSummary || "This step did not complete as expected.";
    case "node.superseded":
      return `'${node.title}' stayed in history, but it left the active path.`;
    case "run.review_requested":
      return `The run was marked for human review while '${node.title}' stayed visible.`;
    default:
      return `The graph recorded ${event.kind.replace(".", " ")} for '${node.title}'.`;
  }
}

function deriveEdges(nodes: Node[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  function pushEdge(sourceNodeId: string, targetNodeId: string, kind: Edge["kind"], createdAt: string) {
    const id = `${sourceNodeId}:${targetNodeId}:${kind}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({
      id,
      graphId: "",
      sourceNodeId,
      targetNodeId,
      kind,
      createdAt,
    });
  }

  for (const node of nodes) {
    for (const dep of node.dependsOnNodeIds) {
      pushEdge(dep, node.id, "depends_on", node.createdAt);
    }
    if (node.parentNodeId && node.kind === "revision") {
      pushEdge(node.id, node.parentNodeId, "revises", node.createdAt);
    }
  }

  return edges;
}

export function buildFrontendReplayFrame(
  events: GraphEvent[],
  liveNodes: Node[],
  liveEdges: Edge[],
  liveGraphStatus: GraphStatus | null,
  liveRunControlState: RunControlState,
  liveFrontierStatus: FrontierStatus | null,
  liveDriftSummary: string,
  stepIndex: number
): FrontendReplayFrame {
  const normalizedStep = Math.min(Math.max(stepIndex, 0), events.length);

  if (normalizedStep === events.length) {
    return {
      stepIndex: normalizedStep,
      totalSteps: events.length,
      event: events.at(-1) ?? null,
      graphStatus: liveGraphStatus ?? "idle",
      runControlState: liveRunControlState,
      nodes: liveNodes,
      edges: liveEdges,
      driftState: liveFrontierStatus === "drifting" || liveFrontierStatus === "blocked"
        ? "drifting"
        : liveFrontierStatus === "exploring"
          ? "exploring"
          : "on_track",
      frontierStatus: liveFrontierStatus ?? "on_track",
      driftSummary: liveDriftSummary,
      plainEnglishSummary: summarizeEvent(events.at(-1) ?? null, liveNodes),
    };
  }

  const nodes = new Map<string, Node>();
  let graphStatus: GraphStatus = "idle";
  let runControlState: RunControlState = "idle";

  for (const event of events.slice(0, normalizedStep)) {
    switch (event.kind) {
      case "goal.version_created":
        break;
      case "node.planned": {
        if (!event.nodeId) break;
        nodes.set(event.nodeId, emptyNode(event.nodeId, event.payload as NodePlannedPayload, event.ts));
        break;
      }
      case "node.ready":
        if (event.nodeId && nodes.has(event.nodeId)) {
          nodes.set(event.nodeId, { ...nodes.get(event.nodeId)!, status: "ready", updatedAt: event.ts });
        }
        break;
      case "node.executing":
        if (event.nodeId && nodes.has(event.nodeId)) {
          nodes.set(event.nodeId, {
            ...nodes.get(event.nodeId)!,
            status: "running",
            startedAt: event.ts,
            updatedAt: event.ts,
          });
          graphStatus = "running";
        }
        break;
      case "node.output":
        if (event.nodeId && nodes.has(event.nodeId)) {
          nodes.set(event.nodeId, {
            ...nodes.get(event.nodeId)!,
            output: (event.payload as { output: string }).output,
            updatedAt: event.ts,
          });
        }
        break;
      case "node.completed":
        if (event.nodeId && nodes.has(event.nodeId)) {
          const payload = event.payload as { output: string; evidence: Node["evidence"]; confidence?: number };
          nodes.set(event.nodeId, {
            ...nodes.get(event.nodeId)!,
            status: "completed",
            output: payload.output,
            evidence: payload.evidence,
            confidence: payload.confidence,
            workspaceStateChanged:
              payload.evidence?.workspaceChecksumBefore !== payload.evidence?.workspaceChecksumAfter,
            completedAt: event.ts,
            updatedAt: event.ts,
          });
        }
        break;
      case "node.summarized":
        if (event.nodeId && nodes.has(event.nodeId)) {
          const payload = event.payload as { summary: string; embedding: number[] };
          nodes.set(event.nodeId, {
            ...nodes.get(event.nodeId)!,
            semanticSummary: payload.summary,
            semanticEmbedding: payload.embedding,
            updatedAt: event.ts,
          });
        }
        break;
      case "node.evaluated":
        if (event.nodeId && nodes.has(event.nodeId)) {
          const evaluation = (event.payload as { evaluation: NodeEvaluation }).evaluation;
          nodes.set(event.nodeId, {
            ...nodes.get(event.nodeId)!,
            evaluation,
            humanSummary: evaluation.humanSummary || nodes.get(event.nodeId)!.humanSummary,
            evidenceSummary: nodes.get(event.nodeId)!.evidenceSummary,
            updatedAt: event.ts,
          });
        }
        break;
      case "node.failed":
        if (event.nodeId && nodes.has(event.nodeId)) {
          nodes.set(event.nodeId, {
            ...nodes.get(event.nodeId)!,
            status: "failed",
            updatedAt: event.ts,
          });
        }
        break;
      case "node.superseded":
        if (event.nodeId && nodes.has(event.nodeId)) {
          nodes.set(event.nodeId, {
            ...nodes.get(event.nodeId)!,
            status: "superseded",
            updatedAt: event.ts,
          });
        }
        break;
      case "run.completed":
        graphStatus = "completed";
        runControlState = "idle";
        break;
      case "run.pause_requested":
        break;
      case "run.paused":
        runControlState = "paused";
        break;
      case "run.resume_requested":
        break;
      case "run.resumed":
        graphStatus = "running";
        runControlState = "running";
        break;
      case "run.stop_requested":
        break;
      case "run.stopped":
        graphStatus = "stopped";
        runControlState = "stopped";
        break;
      case "run.review_requested":
        break;
      case "run.failed":
        graphStatus = (event.payload as { blocked: boolean }).blocked ? "blocked" : "failed";
        runControlState = "idle";
        break;
      case "run.started":
        graphStatus = "running";
        runControlState = "running";
        break;
      default:
        break;
    }
  }

  const nodeList = [...nodes.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const frontier = deriveFrontier(nodeList, graphStatus);
  const currentEvent = normalizedStep === 0 ? null : events[normalizedStep - 1] ?? null;

  return {
    stepIndex: normalizedStep,
    totalSteps: events.length,
    event: currentEvent,
    graphStatus,
    runControlState,
    nodes: nodeList,
    edges: deriveEdges(nodeList),
    driftState: frontier.driftState,
    frontierStatus: frontier.frontierStatus,
    driftSummary: frontier.driftSummary,
    plainEnglishSummary: summarizeEvent(currentEvent, nodeList),
  };
}
