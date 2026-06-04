import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GoalPacket,
  PlanGraphResult,
  GraphProjection,
  Node,
  NodeEvaluation,
  SemanticNodeSummary,
  ToolCallRecord,
} from "@openagentgraph/shared";
import type { AIProvider } from "../providers/interface.js";

let projection: GraphProjection;

vi.mock("../db/graphRepo.js", () => ({
  getGraphProjection: vi.fn(async () => projection),
  findRelevantNodeOutputs: vi.fn(async () => []),
}));

import { buildNodeContext, runGraph } from "./runner.js";

function makeGoalPacket(version: number, text: string): GoalPacket {
  return {
    id: `goal-${version}`,
    version,
    originalText: text,
    successCriteria: ["Ship a real artifact"],
    forbiddenScope: [],
    embedding: [],
    criteriaEmbeddings: [],
    createdAt: new Date().toISOString(),
  };
}

function baseNode(id: string, title: string): Node {
  return {
    id,
    graphId: "graph-1",
    kind: "work",
    title,
    intent: title,
    humanSummary: title,
    status: "pending",
    contract: {
      expectedArtifact: `${title} artifact`,
      allowedTools: ["listDirectory"],
      acceptanceCriteria: ["Artifact exists"],
      humanSummary: title,
    },
    baselineGoalVersionId: "goal-1",
    activeGoalVersionId: "goal-1",
    dependsOnNodeIds: [],
    coordinates: {
      depth: 0,
      branch: 0,
      abstractionLevel: 0,
      driftDistance: 0,
      baselineDriftDistance: 0,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function emptyLineage() {
  return {};
}

function applyEvent(kind: string, nodeId: string | undefined, payload: any) {
  switch (kind) {
    case "goal.version_created":
      projection.goalPackets = [...projection.goalPackets, payload.goalPacket];
      projection.graph.activeGoalVersionId = payload.goalPacket.id;
      break;
    case "node.planned":
      projection.nodes = [
        ...projection.nodes,
        {
          ...baseNode(nodeId!, payload.title),
          kind: payload.kind,
          intent: payload.intent,
          inputContext: payload.inputContext,
          humanSummary: payload.humanSummary,
          contract: payload.contract,
          parentNodeId: payload.parentNodeId,
          branchId: payload.branchId,
          baselineGoalVersionId: payload.baselineGoalVersionId,
          activeGoalVersionId: payload.activeGoalVersionId,
          dependsOnNodeIds: payload.dependsOnNodeIds,
          coordinates: payload.coordinates ?? {
            depth: 0,
            branch: 0,
            abstractionLevel: 0,
            driftDistance: 0,
            baselineDriftDistance: 0,
          },
        },
      ];
      break;
    case "node.ready":
      projection.nodes = projection.nodes.map((node) =>
        node.id === nodeId ? { ...node, status: "ready" } : node
      );
      break;
    case "node.executing":
      projection.nodes = projection.nodes.map((node) =>
        node.id === nodeId ? { ...node, status: "running", prompt: payload.prompt } : node
      );
      break;
    case "node.output":
      projection.nodes = projection.nodes.map((node) =>
        node.id === nodeId ? { ...node, output: payload.output } : node
      );
      break;
    case "node.completed":
      projection.nodes = projection.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              status: "completed",
              output: payload.output,
              evidence: payload.evidence,
              confidence: payload.confidence,
            }
          : node
      );
      break;
    case "node.summarized":
      projection.nodes = projection.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              semanticSummary: payload.summary,
              semanticEmbedding: payload.embedding,
            }
          : node
      );
      break;
    case "node.evaluated":
      projection.nodes = projection.nodes.map((node) =>
        node.id === nodeId ? { ...node, evaluation: payload.evaluation } : node
      );
      break;
    case "node.superseded":
      projection.nodes = projection.nodes.map((node) =>
        node.id === nodeId ? { ...node, status: "superseded", branchId: payload.branchId } : node
      );
      break;
    case "run.started":
      projection.graph.status = "running";
      projection.runControlState = "running";
      break;
    case "run.pause_requested":
      break;
    case "run.paused":
      projection.runControlState = "paused";
      break;
    case "run.resume_requested":
      break;
    case "run.resumed":
      projection.graph.status = "running";
      projection.runControlState = "running";
      break;
    case "run.stop_requested":
      break;
    case "run.stopped":
      projection.graph.status = "stopped";
      projection.runControlState = "stopped";
      break;
    case "run.completed":
      projection.graph.status = "completed";
      projection.runControlState = "idle";
      break;
    case "run.failed":
      projection.graph.status = payload.blocked ? "blocked" : "failed";
      projection.runControlState = "idle";
      break;
    case "run.approval_requested":
      projection.approvalState = "requested";
      projection.approvalRequestedAt = payload.createdAt ?? new Date().toISOString();
      projection.waitingForApproval = true;
      projection.latestDecisionSummary = "This run is waiting for approval before continuing.";
      break;
    case "run.approved":
      projection.approvalState = "approved";
      projection.waitingForApproval = false;
      projection.latestDecisionSummary = "A human approved this run to continue.";
      break;
    case "run.rejected":
      projection.approvalState = "rejected";
      projection.waitingForApproval = false;
      projection.latestDecisionSummary = "A reviewer rejected continuation and the run is paused for human input.";
      break;
    case "run.continue_requested":
      projection.approvalState = "approved";
      projection.waitingForApproval = false;
      projection.latestDecisionSummary = "A human asked this run to continue after review.";
      break;
    case "run.annotated":
      projection.graphAnnotations = [...projection.graphAnnotations, payload];
      projection.annotationCount += 1;
      projection.latestAnnotationSummary = payload.text;
      break;
    case "node.annotated":
      projection.nodes = projection.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              annotations: [...(node.annotations ?? []), payload],
              annotationCount: (node.annotationCount ?? 0) + 1,
            }
          : node
      );
      projection.annotationCount += 1;
      projection.latestAnnotationSummary = payload.text;
      break;
    case "system.lineage_declared":
      projection.lineageDescriptors = [...projection.lineageDescriptors, payload];
      projection.lineageCount = projection.lineageDescriptors.length;
      projection.lineageSummary = `This run used ${projection.lineageDescriptors
        .map((descriptor) => `${descriptor.kind} ${descriptor.version}`)
        .join(", ")}.`;
      break;
    case "node.lineage_bound":
      projection.nodes = projection.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, lineageBindings: payload.bindings, lineageSummary: `Lineage recorded for ${node.title}.` }
          : node
      );
      break;
  }
  projection.events.push({
    id: `${projection.events.length + 1}`,
    graphId: "graph-1",
    kind,
    nodeId,
    payload,
    ts: new Date().toISOString(),
  } as any);
}

beforeEach(() => {
  projection = {
    graph: {
      id: "graph-1",
      title: "Test graph",
      goal: "Build the dashboard",
      status: "idle",
      originalGoalVersionId: "goal-1",
      activeGoalVersionId: "goal-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    goalPackets: [makeGoalPacket(1, "Build the dashboard")],
    nodes: [],
    edges: [],
    events: [],
    driftState: "on_track",
    driftSummary: "",
    currentDriftSummary: null,
    frontierStatus: "on_track",
    runControlState: "idle",
    canResume: false,
    canPause: false,
    canStop: false,
    approvalState: "not_requested",
    approvalRequestedAt: undefined,
    waitingForApproval: false,
    latestDecisionSummary: undefined,
    needsHumanReview: false,
    humanReviewReason: undefined,
    reviewRequestedAt: undefined,
    graphAnnotations: [],
    annotationCount: 0,
    latestAnnotationSummary: undefined,
    lineageDescriptors: [],
    lineageCount: 0,
    latestPlannerLineageSummary: undefined,
    latestExecutorLineageSummary: undefined,
    latestEvaluatorLineageSummary: undefined,
    latestRetrieverLineageSummary: undefined,
    latestPolicyLineageSummary: undefined,
    lineageSummary: undefined,
    plannedNodeCount: 0,
    completedNodeCount: 0,
    failedNodeCount: 0,
    supersededNodeCount: 0,
    revisedNodeCount: 0,
    passRate: 0,
    revisionRate: 0,
    driftTrend: "steady",
    evidenceCoverageRate: 0,
    runHealthSummary: "",
    alerts: [],
    latestNotificationSummary: undefined,
    changesSinceLastViewed: undefined,
  };
});

describe("runGraph", () => {
  it("pauses only after the current node completes", async () => {
    let injectedPause = false;
    const provider: AIProvider = {
      buildGoalPacket: vi.fn(),
      planGraph: vi.fn(async (): Promise<PlanGraphResult> => ({
        nodes: [
          {
            kind: "work",
            title: "Step one",
            intent: "Finish the first step",
            humanSummary: "Step one",
            contract: {
              expectedArtifact: "Artifact one",
              allowedTools: ["listDirectory"],
              acceptanceCriteria: ["Artifact exists"],
              humanSummary: "Step one",
            },
            dependsOnNodeIds: [],
          },
          {
            kind: "work",
            title: "Step two",
            intent: "Finish the second step",
            humanSummary: "Step two",
            contract: {
              expectedArtifact: "Artifact two",
              allowedTools: ["listDirectory"],
              acceptanceCriteria: ["Artifact exists"],
              humanSummary: "Step two",
            },
            dependsOnNodeIds: ["Step one"],
          },
        ],
      })),
      executeNode: vi.fn(async (context) => ({
        prompt: `Execute ${context.currentNode.title}`,
        output: `Output for ${context.currentNode.title}`,
        toolCalls: [],
        evidence: {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [
            {
              id: "",
              nodeId: "",
              tool: "listDirectory",
              input: { path: "." },
              output: "src",
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            },
          ],
          workspaceChecksum: "checksum",
          workspaceChecksumBefore: "before",
          workspaceChecksumAfter: "after",
        },
      })),
      summarizeCompletedNode: vi.fn(async (context): Promise<SemanticNodeSummary> => ({
        summary: `Summary for ${context.currentNode.title}`,
        embedding: [1, 0],
        summaryGeneratedAt: new Date().toISOString(),
      })),
      embedRetrievalQuery: vi.fn(async () => []),
      evaluateNode: vi.fn(async (): Promise<{ evaluation: NodeEvaluation }> => ({
        evaluation: {
          llmPassed: true,
          deterministicPassed: true,
          passed: true,
          driftScore: 0.9,
          baselineDriftScore: 0.9,
          direction: "closer",
          humanSummary: "Still on track.",
          suggestedAction: "complete",
          findings: [],
          ruleViolations: [],
        },
      })),
      describeGraphLineage: vi.fn(() => emptyLineage()),
      describeNodeLineage: vi.fn(() => emptyLineage()),
    } as unknown as AIProvider;

    await runGraph("graph-1", "C:\\workspace", provider, async (event) => {
      applyEvent(event.kind, event.nodeId, event.payload);
      if (event.kind === "node.executing" && !injectedPause) {
        injectedPause = true;
        applyEvent("run.pause_requested", undefined, { reason: "Pause after this step" });
      }
      return {
        id: `${projection.events.length}`,
        graphId: event.graphId,
        kind: event.kind,
        nodeId: event.nodeId,
        goalVersionId: event.goalVersionId,
        payload: event.payload,
        ts: new Date().toISOString(),
      } as any;
    });

    expect(projection.runControlState).toBe("paused");
    expect(projection.nodes.find((node) => node.title === "Step one")?.status).toBe("completed");
    expect(projection.nodes.find((node) => node.title === "Step two")?.status).toBe("pending");
    expect(projection.events.some((event) => event.kind === "run.paused")).toBe(true);
  });

  it("stops after the current node finishes and prevents further scheduling", async () => {
    let injectedStop = false;
    const provider: AIProvider = {
      buildGoalPacket: vi.fn(),
      planGraph: vi.fn(async (): Promise<PlanGraphResult> => ({
        nodes: [
          {
            kind: "work",
            title: "Step one",
            intent: "Finish the first step",
            humanSummary: "Step one",
            contract: {
              expectedArtifact: "Artifact one",
              allowedTools: ["listDirectory"],
              acceptanceCriteria: ["Artifact exists"],
              humanSummary: "Step one",
            },
            dependsOnNodeIds: [],
          },
          {
            kind: "work",
            title: "Step two",
            intent: "Finish the second step",
            humanSummary: "Step two",
            contract: {
              expectedArtifact: "Artifact two",
              allowedTools: ["listDirectory"],
              acceptanceCriteria: ["Artifact exists"],
              humanSummary: "Step two",
            },
            dependsOnNodeIds: ["Step one"],
          },
        ],
      })),
      executeNode: vi.fn(async (context) => ({
        prompt: `Execute ${context.currentNode.title}`,
        output: `Output for ${context.currentNode.title}`,
        toolCalls: [],
        evidence: {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [
            {
              id: "",
              nodeId: "",
              tool: "listDirectory",
              input: { path: "." },
              output: "src",
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            },
          ],
          workspaceChecksum: "checksum",
          workspaceChecksumBefore: "before",
          workspaceChecksumAfter: "after",
        },
      })),
      summarizeCompletedNode: vi.fn(async (context): Promise<SemanticNodeSummary> => ({
        summary: `Summary for ${context.currentNode.title}`,
        embedding: [1, 0],
        summaryGeneratedAt: new Date().toISOString(),
      })),
      embedRetrievalQuery: vi.fn(async () => []),
      evaluateNode: vi.fn(async (): Promise<{ evaluation: NodeEvaluation }> => ({
        evaluation: {
          llmPassed: true,
          deterministicPassed: true,
          passed: true,
          driftScore: 0.9,
          baselineDriftScore: 0.9,
          direction: "closer",
          humanSummary: "Still on track.",
          suggestedAction: "complete",
          findings: [],
          ruleViolations: [],
        },
      })),
      describeGraphLineage: vi.fn(() => emptyLineage()),
      describeNodeLineage: vi.fn(() => emptyLineage()),
    } as unknown as AIProvider;

    await runGraph("graph-1", "C:\\workspace", provider, async (event) => {
      applyEvent(event.kind, event.nodeId, event.payload);
      if (event.kind === "node.executing" && !injectedStop) {
        injectedStop = true;
        applyEvent("run.stop_requested", undefined, { reason: "Stop after this step" });
      }
      return {
        id: `${projection.events.length}`,
        graphId: event.graphId,
        kind: event.kind,
        nodeId: event.nodeId,
        goalVersionId: event.goalVersionId,
        payload: event.payload,
        ts: new Date().toISOString(),
      } as any;
    });

    expect(projection.runControlState).toBe("stopped");
    expect(projection.graph.status).toBe("stopped");
    expect(projection.nodes.find((node) => node.title === "Step two")?.status).toBe("pending");
    expect(projection.events.some((event) => event.kind === "run.stopped")).toBe(true);
  });

  it("resumes from the paused projection state and keeps scheduling", async () => {
    let injectedPause = false;
    const provider: AIProvider = {
      buildGoalPacket: vi.fn(),
      planGraph: vi.fn(async (): Promise<PlanGraphResult> => ({
        nodes: [
          {
            kind: "work",
            title: "Step one",
            intent: "Finish the first step",
            humanSummary: "Step one",
            contract: {
              expectedArtifact: "Artifact one",
              allowedTools: ["listDirectory"],
              acceptanceCriteria: ["Artifact exists"],
              humanSummary: "Step one",
            },
            dependsOnNodeIds: [],
          },
          {
            kind: "work",
            title: "Step two",
            intent: "Finish the second step",
            humanSummary: "Step two",
            contract: {
              expectedArtifact: "Artifact two",
              allowedTools: ["listDirectory"],
              acceptanceCriteria: ["Artifact exists"],
              humanSummary: "Step two",
            },
            dependsOnNodeIds: ["Step one"],
          },
        ],
      })),
      executeNode: vi.fn(async (context) => ({
        prompt: `Execute ${context.currentNode.title}`,
        output: `Output for ${context.currentNode.title}`,
        toolCalls: [],
        evidence: {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [
            {
              id: "",
              nodeId: "",
              tool: "listDirectory",
              input: { path: "." },
              output: "src",
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            },
          ],
          workspaceChecksum: "checksum",
          workspaceChecksumBefore: "before",
          workspaceChecksumAfter: "after",
        },
      })),
      summarizeCompletedNode: vi.fn(async (context): Promise<SemanticNodeSummary> => ({
        summary: `Summary for ${context.currentNode.title}`,
        embedding: [1, 0],
        summaryGeneratedAt: new Date().toISOString(),
      })),
      embedRetrievalQuery: vi.fn(async () => []),
      evaluateNode: vi.fn(async (): Promise<{ evaluation: NodeEvaluation }> => ({
        evaluation: {
          llmPassed: true,
          deterministicPassed: true,
          passed: true,
          driftScore: 0.9,
          baselineDriftScore: 0.9,
          direction: "closer",
          humanSummary: "Still on track.",
          suggestedAction: "complete",
          findings: [],
          ruleViolations: [],
        },
      })),
      describeGraphLineage: vi.fn(() => emptyLineage()),
      describeNodeLineage: vi.fn(() => emptyLineage()),
    } as unknown as AIProvider;

    const record = async (event: any) => {
      applyEvent(event.kind, event.nodeId, event.payload);
      if (event.kind === "node.executing" && !injectedPause) {
        injectedPause = true;
        applyEvent("run.pause_requested", undefined, { reason: "Pause after this step" });
      }
      return {
        id: `${projection.events.length}`,
        graphId: event.graphId,
        kind: event.kind,
        nodeId: event.nodeId,
        goalVersionId: event.goalVersionId,
        payload: event.payload,
        ts: new Date().toISOString(),
      } as any;
    };

    await runGraph("graph-1", "C:\\workspace", provider, record);
    expect(projection.runControlState).toBe("paused");

    applyEvent("run.resume_requested", undefined, { reason: "Continue" });
    await runGraph("graph-1", "C:\\workspace", provider, async (event) => {
      applyEvent(event.kind, event.nodeId, event.payload);
      return {
        id: `${projection.events.length}`,
        graphId: event.graphId,
        kind: event.kind,
        nodeId: event.nodeId,
        goalVersionId: event.goalVersionId,
        payload: event.payload,
        ts: new Date().toISOString(),
      } as any;
    }, { resume: true });

    expect(projection.graph.status).toBe("completed");
    expect(projection.nodes.find((node) => node.title === "Step two")?.status).toBe("completed");
  });

  it("falls back to nearby completed summaries when retrieval embeddings are unavailable", async () => {
    projection.nodes = [
      {
        ...baseNode("node-1", "Inspect workspace"),
        status: "completed",
        output: "Inspected the repo and found the dashboard entrypoint.",
        semanticSummary: "Inspected the repo to locate the dashboard entrypoint and confirmed where work should continue.",
        completedAt: new Date("2026-04-16T10:00:00.000Z").toISOString(),
      },
      {
        ...baseNode("node-2", "Implement dashboard"),
        coordinates: {
          depth: 1,
          branch: 0,
          abstractionLevel: 1,
          driftDistance: 0,
          baselineDriftDistance: 0,
        },
      },
    ];

    const provider: AIProvider = {
      buildGoalPacket: vi.fn(),
      planGraph: vi.fn(),
      executeNode: vi.fn(),
      summarizeCompletedNode: vi.fn(),
      embedRetrievalQuery: vi.fn(async () => []),
      evaluateNode: vi.fn(),
      describeGraphLineage: vi.fn(() => emptyLineage()),
      describeNodeLineage: vi.fn(() => emptyLineage()),
    } as unknown as AIProvider;

    const context = await buildNodeContext(projection, projection.nodes[1], provider);

    expect(context.previousNodeOutput).toContain("dashboard entrypoint");
    expect(context.relevantOutputs).toHaveLength(1);
    expect(context.relevantOutputs[0]?.summary).toContain("locate the dashboard entrypoint");
  });

  it("does not schedule new nodes while the run is waiting for approval", async () => {
    projection.runControlState = "running";
    projection.approvalState = "requested";
    projection.waitingForApproval = true;
    projection.latestDecisionSummary = "This run is waiting for approval before continuing.";
    projection.nodes = [baseNode("node-1", "Blocked by approval")];

    const provider: AIProvider = {
      buildGoalPacket: vi.fn(),
      planGraph: vi.fn(),
      executeNode: vi.fn(),
      summarizeCompletedNode: vi.fn(),
      embedRetrievalQuery: vi.fn(async () => []),
      evaluateNode: vi.fn(),
      describeGraphLineage: vi.fn(() => emptyLineage()),
      describeNodeLineage: vi.fn(() => emptyLineage()),
    } as unknown as AIProvider;

    await runGraph("graph-1", "C:\\workspace", provider, async (event) => {
      applyEvent(event.kind, event.nodeId, event.payload);
      return {
        id: `${projection.events.length}`,
        graphId: event.graphId,
        kind: event.kind,
        nodeId: event.nodeId,
        goalVersionId: event.goalVersionId,
        payload: event.payload,
        ts: new Date().toISOString(),
      } as any;
    }, { resume: true });

    expect(provider.executeNode).not.toHaveBeenCalled();
    expect(projection.nodes[0]?.status).toBe("pending");
  });

  it("keeps the run halted after rejection until a later approval or continue event exists", async () => {
    projection.runControlState = "running";
    projection.approvalState = "rejected";
    projection.waitingForApproval = false;
    projection.latestDecisionSummary = "A reviewer rejected continuation and the run is paused for human input.";
    projection.nodes = [baseNode("node-1", "Rejected step")];

    const provider: AIProvider = {
      buildGoalPacket: vi.fn(),
      planGraph: vi.fn(),
      executeNode: vi.fn(),
      summarizeCompletedNode: vi.fn(),
      embedRetrievalQuery: vi.fn(async () => []),
      evaluateNode: vi.fn(),
      describeGraphLineage: vi.fn(() => emptyLineage()),
      describeNodeLineage: vi.fn(() => emptyLineage()),
    } as unknown as AIProvider;

    await runGraph("graph-1", "C:\\workspace", provider, async (event) => {
      applyEvent(event.kind, event.nodeId, event.payload);
      return {
        id: `${projection.events.length}`,
        graphId: event.graphId,
        kind: event.kind,
        nodeId: event.nodeId,
        goalVersionId: event.goalVersionId,
        payload: event.payload,
        ts: new Date().toISOString(),
      } as any;
    }, { resume: true });

    expect(provider.executeNode).not.toHaveBeenCalled();
    expect(projection.nodes[0]?.status).toBe("pending");
  });

  it("allows scheduling to resume after an approval has been recorded", async () => {
    projection.runControlState = "running";
    projection.approvalState = "approved";
    projection.waitingForApproval = false;
    projection.latestDecisionSummary = "A human approved this run to continue.";
    projection.nodes = [baseNode("node-1", "Approved step")];

    const provider: AIProvider = {
      buildGoalPacket: vi.fn(),
      planGraph: vi.fn(),
      executeNode: vi.fn(async (context) => ({
        prompt: `Execute ${context.currentNode.title}`,
        output: `Output for ${context.currentNode.title}`,
        toolCalls: [],
        evidence: {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [],
          workspaceChecksum: "checksum",
          workspaceChecksumBefore: "before",
          workspaceChecksumAfter: "after",
        },
      })),
      summarizeCompletedNode: vi.fn(async () => ({
        summary: "Approved step summary",
        embedding: [1, 0],
        summaryGeneratedAt: new Date().toISOString(),
      })),
      embedRetrievalQuery: vi.fn(async () => []),
      evaluateNode: vi.fn(async () => ({
        evaluation: {
          llmPassed: true,
          deterministicPassed: true,
          passed: true,
          driftScore: 0.9,
          baselineDriftScore: 0.9,
          direction: "closer",
          humanSummary: "Approved work is on track.",
          suggestedAction: "complete",
          findings: [],
          ruleViolations: [],
        },
      })),
      describeGraphLineage: vi.fn(() => emptyLineage()),
      describeNodeLineage: vi.fn(() => emptyLineage()),
    } as unknown as AIProvider;

    await runGraph("graph-1", "C:\\workspace", provider, async (event) => {
      applyEvent(event.kind, event.nodeId, event.payload);
      return {
        id: `${projection.events.length}`,
        graphId: event.graphId,
        kind: event.kind,
        nodeId: event.nodeId,
        goalVersionId: event.goalVersionId,
        payload: event.payload,
        ts: new Date().toISOString(),
      } as any;
    }, { resume: true });

    expect(provider.executeNode).toHaveBeenCalledOnce();
  });

  it("replans by creating a new goal version and replacement nodes", async () => {
    let planCount = 0;
    let evalCount = 0;

    const provider: AIProvider = {
      buildGoalPacket: vi.fn(async ({ goal, successCriteria, forbiddenScope, version }) =>
        makeGoalPacket(version, goal)
      ),
      planGraph: vi.fn(async (goalPacket): Promise<PlanGraphResult> => {
        planCount += 1;
        if (planCount === 1) {
          return {
            nodes: [
              {
                kind: "work" as const,
                title: "Initial Step",
                intent: "Do the first thing",
                humanSummary: "Initial step",
                contract: {
                  expectedArtifact: "First artifact",
                  allowedTools: ["listDirectory"],
                  acceptanceCriteria: ["Artifact exists"],
                  humanSummary: "Initial step",
                },
                dependsOnNodeIds: [],
                coordinates: {
                  depth: 0,
                  branch: 0,
                  abstractionLevel: 1,
                  driftDistance: 0,
                  baselineDriftDistance: 0,
                },
              },
            ],
          };
        }

        return {
          nodes: [
            {
              kind: "work" as const,
              title: "Replacement Step",
              intent: `Recover toward ${goalPacket.originalText}`,
              humanSummary: "Replacement step",
              contract: {
                expectedArtifact: "Replacement artifact",
                allowedTools: ["listDirectory"],
                acceptanceCriteria: ["Artifact exists"],
                humanSummary: "Replacement step",
              },
              dependsOnNodeIds: [],
              branchId: "replan-branch",
              coordinates: {
                depth: 1,
                branch: 1,
                abstractionLevel: 1,
                driftDistance: 0.5,
                baselineDriftDistance: 0.5,
              },
            },
          ],
        };
      }),
      executeNode: vi.fn(async (context) => ({
        prompt: `Execute ${context.currentNode.title}`,
        output: `Output for ${context.currentNode.title}`,
        toolCalls: [
          {
            tool: "listDirectory" as const,
            input: { path: "." },
            output: "src",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          } satisfies Omit<ToolCallRecord, "id" | "nodeId">,
        ],
        evidence: {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [
            {
              id: "",
              nodeId: "",
              tool: "listDirectory" as const,
              input: { path: "." },
              output: "src",
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            },
          ],
          workspaceChecksum: "checksum",
          workspaceChecksumBefore: "before-checksum",
          workspaceChecksumAfter: "after-checksum",
        },
        confidence: 0.8,
      })),
      summarizeCompletedNode: vi.fn(async (context): Promise<SemanticNodeSummary> => ({
        summary: `Summary for ${context.currentNode.title}`,
        embedding: [0.8, 0.2],
        summaryGeneratedAt: new Date().toISOString(),
      })),
      embedRetrievalQuery: vi.fn(async () => [0.8, 0.2]),
      evaluateNode: vi.fn(async (): Promise<{ evaluation: NodeEvaluation }> => {
        evalCount += 1;
        if (evalCount === 1) {
          return {
            evaluation: {
              llmPassed: false,
              deterministicPassed: true,
              passed: false,
              driftScore: 0.3,
              baselineDriftScore: 0.3,
              direction: "drifting",
              humanSummary: "The first attempt drifted.",
              suggestedAction: "replan",
              findings: ["Need a new plan"],
              ruleViolations: [],
            },
          };
        }

        return {
          evaluation: {
            llmPassed: true,
            deterministicPassed: true,
            passed: true,
            driftScore: 0.9,
            baselineDriftScore: 0.85,
            direction: "closer",
            humanSummary: "Replacement path is on track.",
            suggestedAction: "complete",
            findings: [],
            ruleViolations: [],
          },
        };
      }),
      describeGraphLineage: vi.fn(() => ({
        planner: {
          lineageId: "planner-1",
          graphId: "graph-1",
          createdAt: new Date().toISOString(),
          kind: "planner",
          label: "OpenAI planner",
          version: "gpt-4o",
          contentHash: "plannerhash",
          summary: "Planner lineage",
          source: "built_in",
        },
      })),
      describeNodeLineage: vi.fn(() => ({
        executor: {
          lineageId: "executor-1",
          graphId: "graph-1",
          createdAt: new Date().toISOString(),
          kind: "executor",
          label: "OpenAI executor",
          version: "gpt-4o",
          contentHash: "executorhash",
          summary: "Executor lineage",
          source: "built_in",
          fallbackUsed: true,
        },
      })),
    };

    await runGraph("graph-1", "C:\\workspace", provider, async (event) => {
      applyEvent(event.kind, event.nodeId, event.payload);
      return {
        id: `${projection.events.length}`,
        graphId: event.graphId,
        kind: event.kind,
        nodeId: event.nodeId,
        goalVersionId: event.goalVersionId,
        payload: event.payload,
        ts: new Date().toISOString(),
      } as any;
    });

    expect(provider.planGraph).toHaveBeenCalledTimes(2);
    expect(projection.goalPackets).toHaveLength(2);
    const replacementNode = projection.nodes.find((node) => node.title === "Replacement Step");
    expect(replacementNode).toBeDefined();
    expect(replacementNode?.dependsOnNodeIds.length).toBeGreaterThan(0);
    expect(projection.graph.status).toBe("completed");
  });
});
