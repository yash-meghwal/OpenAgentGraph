import { describe, expect, it } from "vitest";
import {
  buildProductGraphHandoffReport,
  buildProductGraphCodexPlanningPrompt,
  buildProductGraphTaskScopeGuide,
  buildProductGraphTaskScopeNodeIds,
  buildProductGraphTrace,
  findProductGraphAcceptanceCriterionEvidenceForNode,
  findProductGraphAcceptanceEvidenceGaps,
  projectProductGraph,
  summarizeProductGraphAcceptanceEvidenceHealth,
  summarizeProductGraphChangedCodeIntent,
  summarizeProductGraphCodeIntentDrift,
  summarizeProductGraphCodeScanFreshness,
  summarizeProductGraphExecutionDrift,
  summarizeProductGraphExecutionTestEvidence,
  summarizeProductGraphFeatureAcceptanceEvidence,
  summarizeProductGraphFeatureAcceptanceEvidenceByNodeId,
  summarizeProductGraphReadyTaskCandidates,
  summarizeProductGraphTaskExecutionEvidence,
  summarizeProductGraphTaskTestEvidence,
  productGraphTaskScopeIdsForPath,
  type ProductEvent,
  type ProductGraphEdge,
  type ProductGraphNode,
  type ProductNodeStatus,
} from "./productGraph";

const productGraphId = "product-graph-1";

function node(input: {
  id: string;
  kind: ProductGraphNode["kind"];
  title: string;
  status?: ProductNodeStatus;
  summary?: string;
  body?: string;
  createdAt?: string;
  updatedAt?: string;
  source?: ProductGraphNode["source"];
  tags?: ProductGraphNode["tags"];
  metadata?: ProductGraphNode["metadata"];
}): ProductGraphNode {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.body ? { body: input.body } : {}),
    status: input.status ?? "planned",
    ...(input.source ? { source: input.source } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: input.createdAt ?? "2026-05-12T00:00:00.000Z",
    updatedAt: input.updatedAt ?? input.createdAt ?? "2026-05-12T00:00:00.000Z",
  };
}

function edge(input: {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: ProductGraphEdge["kind"];
  trust?: ProductGraphEdge["trust"];
  createdAt?: string;
  source?: ProductGraphEdge["source"];
  label?: string;
  metadata?: ProductGraphEdge["metadata"];
}): ProductGraphEdge {
  return {
    id: input.id,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    kind: input.kind,
    trust: input.trust ?? "manual",
    ...(input.source ? { source: input.source } : {}),
    ...(input.label ? { label: input.label } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: input.createdAt ?? "2026-05-12T00:00:00.000Z",
    updatedAt: input.createdAt ?? "2026-05-12T00:00:00.000Z",
  };
}

function nodeUpsert(seq: number, value: ProductGraphNode): ProductEvent<"product.node.upserted"> {
  return {
    id: `event-${seq}`,
    productGraphId,
    kind: "product.node.upserted",
    nodeId: value.id,
    payload: { node: value },
    ts: `2026-05-12T00:00:${String(seq).padStart(2, "0")}.000Z`,
    seq,
  };
}

function edgeUpsert(seq: number, value: ProductGraphEdge): ProductEvent<"product.edge.upserted"> {
  return {
    id: `event-${seq}`,
    productGraphId,
    kind: "product.edge.upserted",
    edgeId: value.id,
    payload: { edge: value },
    ts: `2026-05-12T00:00:${String(seq).padStart(2, "0")}.000Z`,
    seq,
  };
}

describe("projectProductGraph", () => {
  it("projects feature intent relationships from append-only events", () => {
    const events: ProductEvent[] = [
      nodeUpsert(1, node({ id: "feature-1", kind: "feature", title: "Intent Graph" })),
      nodeUpsert(2, node({ id: "story-1", kind: "user_story", title: "Plan before editing" })),
      nodeUpsert(3, node({ id: "criterion-1", kind: "acceptance_criterion", title: "Shows planned work" })),
      nodeUpsert(4, node({ id: "task-1", kind: "task", title: "Create shared contract" })),
      edgeUpsert(5, edge({ id: "edge-story", sourceNodeId: "story-1", targetNodeId: "feature-1", kind: "belongs_to" })),
      edgeUpsert(6, edge({ id: "edge-criterion", sourceNodeId: "criterion-1", targetNodeId: "story-1", kind: "satisfies" })),
      edgeUpsert(7, edge({ id: "edge-task", sourceNodeId: "task-1", targetNodeId: "criterion-1", kind: "implements" })),
    ];

    const projection = projectProductGraph({ productGraphId, events });
    const task = projection.nodes.find((item) => item.id === "task-1");

    expect(projection.summary.nodeCount).toBe(4);
    expect(projection.summary.edgeCount).toBe(3);
    expect(projection.summary.nodesByKind.feature).toBe(1);
    expect(projection.summary.nodesByKind.task).toBe(1);
    expect(projection.summary.edgesByKind.implements).toBe(1);
    expect(task?.outgoingEdgeIds).toEqual(["edge-task"]);
  });

  it("derives task blocking from unresolved open questions", () => {
    const taskNode = node({ id: "task-1", kind: "task", title: "Implement importer" });
    const question = node({
      id: "question-1",
      kind: "open_question",
      title: "Which Spec Kit files are required?",
      status: "proposed",
    });
    const blockedBy = edge({
      id: "edge-blocked",
      sourceNodeId: taskNode.id,
      targetNodeId: question.id,
      kind: "blocked_by",
    });

    const blockedProjection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, taskNode),
        nodeUpsert(2, question),
        edgeUpsert(3, blockedBy),
      ],
    });

    expect(blockedProjection.summary.unresolvedOpenQuestionCount).toBe(1);
    expect(blockedProjection.summary.blockedTaskCount).toBe(1);
    expect(blockedProjection.nodes.find((item) => item.id === taskNode.id)?.blockedByNodeIds).toEqual([
      question.id,
    ]);

    const resolvedProjection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, taskNode),
        nodeUpsert(2, question),
        edgeUpsert(3, blockedBy),
        nodeUpsert(4, { ...question, status: "resolved", updatedAt: "2026-05-12T00:00:04.000Z" }),
      ],
    });

    expect(resolvedProjection.summary.unresolvedOpenQuestionCount).toBe(0);
    expect(resolvedProjection.summary.blockedTaskCount).toBe(0);
    expect(resolvedProjection.nodes.find((item) => item.id === taskNode.id)?.blockedByNodeIds).toEqual([]);
  });

  it("filters archived nodes and their dangling edges from the projection", () => {
    const feature = node({ id: "feature-1", kind: "feature", title: "Traceability" });
    const taskNode = node({ id: "task-1", kind: "task", title: "Link runs" });
    const taskEdge = edge({
      id: "edge-task",
      sourceNodeId: taskNode.id,
      targetNodeId: feature.id,
      kind: "belongs_to",
    });

    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, feature),
        nodeUpsert(2, taskNode),
        edgeUpsert(3, taskEdge),
        {
          id: "event-4",
          productGraphId,
          kind: "product.node.archived",
          nodeId: feature.id,
          payload: { nodeId: feature.id, reason: "Merged into a newer feature" },
          ts: "2026-05-12T00:00:04.000Z",
          seq: 4,
        },
      ],
    });

    expect(projection.nodes.map((item) => item.id)).toEqual([taskNode.id]);
    expect(projection.edges).toEqual([]);
    expect(projection.summary.nodeCount).toBe(1);
    expect(projection.summary.edgeCount).toBe(0);
  });
});

describe("summarizeProductGraphReadyTaskCandidates", () => {
  it("summarizes planned unblocked task candidates", () => {
    const readyTask = node({
      id: "task-ready",
      kind: "task",
      title: "Ready task",
      status: "planned",
      createdAt: "2026-05-12T00:01:00.000Z",
    });
    const secondReadyTask = node({
      id: "task-ready-second",
      kind: "task",
      title: "Second ready task",
      status: "planned",
      createdAt: "2026-05-12T00:02:00.000Z",
    });
    const blockedTask = node({
      id: "task-blocked",
      kind: "task",
      title: "Blocked task",
      status: "planned",
      createdAt: "2026-05-12T00:03:00.000Z",
    });
    const resolvedQuestionTask = node({
      id: "task-resolved-question",
      kind: "task",
      title: "Resolved-question task",
      status: "planned",
      createdAt: "2026-05-12T00:04:00.000Z",
    });
    const inProgressTask = node({
      id: "task-in-progress",
      kind: "task",
      title: "In-progress task",
      status: "in_progress",
      createdAt: "2026-05-12T00:05:00.000Z",
    });
    const unresolvedQuestion = node({
      id: "question-unresolved",
      kind: "open_question",
      title: "Unresolved blocker",
      status: "proposed",
      createdAt: "2026-05-12T00:06:00.000Z",
    });
    const resolvedQuestion = node({
      id: "question-resolved",
      kind: "open_question",
      title: "Resolved blocker",
      status: "resolved",
      createdAt: "2026-05-12T00:07:00.000Z",
    });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, readyTask),
        nodeUpsert(2, secondReadyTask),
        nodeUpsert(3, blockedTask),
        nodeUpsert(4, resolvedQuestionTask),
        nodeUpsert(5, inProgressTask),
        nodeUpsert(6, unresolvedQuestion),
        nodeUpsert(7, resolvedQuestion),
        edgeUpsert(8, edge({
          id: "edge-blocked-task-question",
          sourceNodeId: blockedTask.id,
          targetNodeId: unresolvedQuestion.id,
          kind: "blocked_by",
        })),
        edgeUpsert(9, edge({
          id: "edge-resolved-task-question",
          sourceNodeId: resolvedQuestionTask.id,
          targetNodeId: resolvedQuestion.id,
          kind: "blocked_by",
        })),
      ],
    });

    expect(projection.summary.blockedTaskCount).toBe(1);
    expect(summarizeProductGraphReadyTaskCandidates(projection)).toMatchObject({
      plannedTaskCount: 4,
      blockedPlannedTaskCount: 1,
      readyTaskCount: 3,
    });
    expect(summarizeProductGraphReadyTaskCandidates(projection).taskCandidates.map((task) => task.id)).toEqual([
      readyTask.id,
      secondReadyTask.id,
      resolvedQuestionTask.id,
    ]);
    expect(
      summarizeProductGraphReadyTaskCandidates(projection, { taskCandidateLimit: 1 }).taskCandidates.map((task) => task.id)
    ).toEqual([readyTask.id]);
    expect(summarizeProductGraphReadyTaskCandidates(projection, { taskCandidateLimit: 0 }).taskCandidates).toEqual([]);
  });
});

describe("summarizeProductGraphExecutionDrift", () => {
  it("summarizes completed task run and evidence drift", () => {
    const unlinkedTask = node({
      id: "task-unlinked",
      kind: "task",
      title: "Complete task without run",
      status: "completed",
      createdAt: "2026-05-12T00:01:00.000Z",
    });
    const runWithoutEvidenceTask = node({
      id: "task-run-without-evidence",
      kind: "task",
      title: "Complete task without evidence",
      status: "completed",
      createdAt: "2026-05-12T00:02:00.000Z",
    });
    const verifiedTask = node({
      id: "task-verified",
      kind: "task",
      title: "Complete task with evidence",
      status: "completed",
      createdAt: "2026-05-12T00:03:00.000Z",
    });
    const plannedTask = node({
      id: "task-planned",
      kind: "task",
      title: "Planned task",
      status: "planned",
      createdAt: "2026-05-12T00:04:00.000Z",
    });
    const runWithoutEvidence = node({
      id: "run-without-evidence",
      kind: "agent_run",
      title: "Run without evidence",
      status: "completed",
      createdAt: "2026-05-12T00:05:00.000Z",
    });
    const verifiedRun = node({
      id: "run-verified",
      kind: "agent_run",
      title: "Verified run",
      status: "completed",
      createdAt: "2026-05-12T00:06:00.000Z",
    });
    const evidenceNode = node({
      id: "evidence-verified",
      kind: "evidence",
      title: "Verified run evidence",
      status: "completed",
      createdAt: "2026-05-12T00:07:00.000Z",
    });
    const codeFile = node({
      id: "file-verified",
      kind: "code_file",
      title: "src/verified.ts",
      createdAt: "2026-05-12T00:08:00.000Z",
    });
    const productionDirectionCodeFile = node({
      id: "file-production-direction",
      kind: "code_file",
      title: "src/production-direction.ts",
      createdAt: "2026-05-12T00:08:30.000Z",
    });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, unlinkedTask),
        nodeUpsert(2, runWithoutEvidenceTask),
        nodeUpsert(3, verifiedTask),
        nodeUpsert(4, plannedTask),
        nodeUpsert(5, runWithoutEvidence),
        nodeUpsert(6, verifiedRun),
        nodeUpsert(7, evidenceNode),
        nodeUpsert(8, codeFile),
        nodeUpsert(9, productionDirectionCodeFile),
        edgeUpsert(10, edge({ id: "edge-task-run-missing-evidence", sourceNodeId: runWithoutEvidenceTask.id, targetNodeId: runWithoutEvidence.id, kind: "produced_by" })),
        edgeUpsert(11, edge({ id: "edge-task-run-verified", sourceNodeId: verifiedTask.id, targetNodeId: verifiedRun.id, kind: "produced_by" })),
        edgeUpsert(12, edge({ id: "edge-evidence-run", sourceNodeId: evidenceNode.id, targetNodeId: verifiedRun.id, kind: "produced_by" })),
        edgeUpsert(13, edge({ id: "edge-file-run", sourceNodeId: codeFile.id, targetNodeId: verifiedRun.id, kind: "touches" })),
        edgeUpsert(14, edge({ id: "edge-run-file", sourceNodeId: verifiedRun.id, targetNodeId: productionDirectionCodeFile.id, kind: "touches" })),
      ],
    });

    expect(summarizeProductGraphTaskExecutionEvidence({ projection, taskNodeId: unlinkedTask.id })).toEqual({
      linkedRunCount: 0,
      linkedEvidenceCount: 0,
      linkedFileCount: 0,
      hasLinkedRunDrift: true,
      hasLinkedEvidenceDrift: true,
      hasDrift: true,
    });
    expect(summarizeProductGraphTaskExecutionEvidence({ projection, taskNodeId: runWithoutEvidenceTask.id })).toEqual({
      linkedRunCount: 1,
      linkedEvidenceCount: 0,
      linkedFileCount: 0,
      hasLinkedRunDrift: false,
      hasLinkedEvidenceDrift: true,
      hasDrift: true,
    });
    expect(summarizeProductGraphTaskExecutionEvidence({ projection, taskNodeId: verifiedTask.id })).toEqual({
      linkedRunCount: 1,
      linkedEvidenceCount: 1,
      linkedFileCount: 2,
      hasLinkedRunDrift: false,
      hasLinkedEvidenceDrift: false,
      hasDrift: false,
    });
    expect(summarizeProductGraphTaskExecutionEvidence({ projection, taskNodeId: plannedTask.id })).toBeUndefined();

    expect(summarizeProductGraphExecutionDrift(projection)).toMatchObject({
      completedTaskCount: 3,
      tasksWithDriftCount: 2,
      tasksMissingRunCount: 1,
      tasksMissingEvidenceCount: 2,
    });
    expect(summarizeProductGraphExecutionDrift(projection).taskGaps.map(({ task }) => task.id)).toEqual([
      unlinkedTask.id,
      runWithoutEvidenceTask.id,
    ]);
    expect(summarizeProductGraphExecutionDrift(projection, { taskGapLimit: 1 }).taskGaps.map(({ task }) => task.id)).toEqual([
      unlinkedTask.id,
    ]);
  });
});

describe("summarizeProductGraphExecutionTestEvidence", () => {
  it("flags completed tasks with linked run evidence but no test evidence", () => {
    const noRunTask = node({ id: "task-no-run", kind: "task", title: "No linked run", status: "completed" });
    const noEvidenceTask = node({
      id: "task-no-evidence",
      kind: "task",
      title: "Run without evidence",
      status: "completed",
    });
    const noTestEvidenceTask = node({
      id: "task-no-test-evidence",
      kind: "task",
      title: "Evidence without tests",
      status: "completed",
    });
    const metadataTestTask = node({
      id: "task-metadata-tests",
      kind: "task",
      title: "Evidence with test metadata",
      status: "completed",
    });
    const testResultTask = node({
      id: "task-test-result",
      kind: "task",
      title: "Evidence with test result",
      status: "completed",
    });
    const plannedTask = node({ id: "task-planned", kind: "task", title: "Planned task", status: "planned" });
    const noEvidenceRun = node({ id: "run-no-evidence", kind: "agent_run", title: "Run without evidence" });
    const noTestRun = node({ id: "run-no-test-evidence", kind: "agent_run", title: "Run without test evidence" });
    const metadataRun = node({ id: "run-metadata-tests", kind: "agent_run", title: "Run with test metadata" });
    const testResultRun = node({ id: "run-test-result", kind: "agent_run", title: "Run with test result" });
    const noTestEvidence = node({
      id: "evidence-no-tests",
      kind: "evidence",
      title: "Evidence with no tests",
      metadata: { commandCount: 1, testCommandCount: 0, passingTestCommandCount: 0 },
    });
    const metadataEvidence = node({
      id: "evidence-metadata-tests",
      kind: "evidence",
      title: "Evidence with test commands",
      metadata: { commandCount: 3, testCommandCount: 2, passingTestCommandCount: 1 },
    });
    const testResultEvidence = node({
      id: "evidence-test-result",
      kind: "evidence",
      title: "Evidence with test result node",
      metadata: { commandCount: 1 },
    });
    const testResult = node({ id: "test-result-node", kind: "test_result", title: "Browser regression test" });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, noRunTask),
        nodeUpsert(2, noEvidenceTask),
        nodeUpsert(3, noTestEvidenceTask),
        nodeUpsert(4, metadataTestTask),
        nodeUpsert(5, testResultTask),
        nodeUpsert(6, plannedTask),
        nodeUpsert(7, noEvidenceRun),
        nodeUpsert(8, noTestRun),
        nodeUpsert(9, metadataRun),
        nodeUpsert(10, testResultRun),
        nodeUpsert(11, noTestEvidence),
        nodeUpsert(12, metadataEvidence),
        nodeUpsert(13, testResultEvidence),
        nodeUpsert(14, testResult),
        edgeUpsert(
          15,
          edge({
            id: "edge-task-run-no-evidence",
            sourceNodeId: noEvidenceTask.id,
            targetNodeId: noEvidenceRun.id,
            kind: "produced_by",
          })
        ),
        edgeUpsert(
          16,
          edge({
            id: "edge-task-run-no-test",
            sourceNodeId: noTestEvidenceTask.id,
            targetNodeId: noTestRun.id,
            kind: "produced_by",
          })
        ),
        edgeUpsert(
          17,
          edge({
            id: "edge-evidence-run-no-test",
            sourceNodeId: noTestEvidence.id,
            targetNodeId: noTestRun.id,
            kind: "produced_by",
          })
        ),
        edgeUpsert(
          18,
          edge({
            id: "edge-task-run-metadata",
            sourceNodeId: metadataTestTask.id,
            targetNodeId: metadataRun.id,
            kind: "produced_by",
          })
        ),
        edgeUpsert(
          19,
          edge({
            id: "edge-evidence-run-metadata",
            sourceNodeId: metadataEvidence.id,
            targetNodeId: metadataRun.id,
            kind: "produced_by",
          })
        ),
        edgeUpsert(
          20,
          edge({
            id: "edge-task-run-test-result",
            sourceNodeId: testResultTask.id,
            targetNodeId: testResultRun.id,
            kind: "produced_by",
          })
        ),
        edgeUpsert(
          21,
          edge({
            id: "edge-evidence-run-test-result",
            sourceNodeId: testResultEvidence.id,
            targetNodeId: testResultRun.id,
            kind: "produced_by",
          })
        ),
        edgeUpsert(
          22,
          edge({
            id: "edge-test-run",
            sourceNodeId: testResult.id,
            targetNodeId: testResultRun.id,
            kind: "verifies",
          })
        ),
      ],
    });

    expect(summarizeProductGraphTaskTestEvidence({ projection, taskNodeId: noRunTask.id })).toMatchObject({
      linkedRunCount: 0,
      linkedEvidenceCount: 0,
      hasLinkedRunAndEvidence: false,
      hasTestEvidenceGap: false,
    });
    expect(summarizeProductGraphTaskTestEvidence({ projection, taskNodeId: noEvidenceTask.id })).toMatchObject({
      linkedRunCount: 1,
      linkedEvidenceCount: 0,
      hasLinkedRunAndEvidence: false,
      hasTestEvidence: false,
      hasTestEvidenceGap: false,
    });
    expect(summarizeProductGraphTaskTestEvidence({ projection, taskNodeId: noTestEvidenceTask.id })).toEqual({
      linkedRunCount: 1,
      linkedEvidenceCount: 1,
      linkedTestResultCount: 0,
      linkedTestCommandCount: 0,
      hasLinkedRunAndEvidence: true,
      hasTestEvidence: false,
      hasTestEvidenceGap: true,
    });
    expect(summarizeProductGraphTaskTestEvidence({ projection, taskNodeId: metadataTestTask.id })).toMatchObject({
      linkedTestResultCount: 0,
      linkedTestCommandCount: 2,
      hasTestEvidence: true,
      hasTestEvidenceGap: false,
    });
    expect(summarizeProductGraphTaskTestEvidence({ projection, taskNodeId: testResultTask.id })).toMatchObject({
      linkedTestResultCount: 1,
      linkedTestCommandCount: 0,
      hasTestEvidence: true,
      hasTestEvidenceGap: false,
    });
    expect(summarizeProductGraphTaskTestEvidence({ projection, taskNodeId: plannedTask.id })).toBeUndefined();
    expect(summarizeProductGraphExecutionTestEvidence(projection)).toMatchObject({
      completedTaskCount: 5,
      completedTasksWithLinkedEvidenceCount: 3,
      tasksMissingTestEvidenceCount: 1,
    });
    expect(summarizeProductGraphExecutionTestEvidence(projection).taskGaps.map(({ task }) => task.id)).toEqual([
      noTestEvidenceTask.id,
    ]);
    expect(summarizeProductGraphExecutionTestEvidence(projection, { taskGapLimit: 0 }).taskGaps).toEqual([]);
  });
});

describe("summarizeProductGraphCodeIntentDrift", () => {
  it("flags changed code nodes without linked product intent", () => {
    const orphanCode = node({ id: "file-orphan", kind: "code_file", title: "src/orphan.ts" });
    const taskOnlyCode = node({ id: "file-task-only", kind: "code_file", title: "src/task-only.ts" });
    const requirementBackedCode = node({ id: "file-requirement-backed", kind: "code_file", title: "src/requirement.ts" });
    const directIntentCode = node({ id: "symbol-direct-intent", kind: "code_symbol", title: "CheckoutController" });
    const consultedIntentCode = node({
      id: "file-consulted-intent",
      kind: "code_file",
      title: "src/consulted.ts",
      createdAt: "2026-05-12T00:00:01.000Z",
    });
    const untouchedCode = node({ id: "file-untouched", kind: "code_file", title: "src/untouched.ts" });
    const orphanRun = node({ id: "run-orphan", kind: "agent_run", title: "Run without intent", status: "completed" });
    const taskOnlyRun = node({ id: "run-task-only", kind: "agent_run", title: "Run with task only", status: "completed" });
    const requirementRun = node({
      id: "run-requirement-backed",
      kind: "agent_run",
      title: "Run with requirement",
      status: "completed",
    });
    const directIntentRun = node({
      id: "run-direct-intent",
      kind: "agent_run",
      title: "Run with direct intent",
      status: "completed",
    });
    const consultedIntentRun = node({
      id: "run-consulted-intent",
      kind: "agent_run",
      title: "Run with non-qualifying intent edge",
      status: "completed",
    });
    const taskOnlyTask = node({ id: "task-only", kind: "task", title: "Task without requirement", status: "completed" });
    const requirementTask = node({ id: "task-requirement", kind: "task", title: "Task with requirement", status: "completed" });
    const requirement = node({ id: "requirement-checkout", kind: "requirement", title: "Checkout status is visible" });
    const feature = node({ id: "feature-checkout", kind: "feature", title: "Checkout visibility" });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, orphanCode),
        nodeUpsert(2, taskOnlyCode),
        nodeUpsert(3, requirementBackedCode),
        nodeUpsert(4, directIntentCode),
        nodeUpsert(5, consultedIntentCode),
        nodeUpsert(6, untouchedCode),
        nodeUpsert(7, orphanRun),
        nodeUpsert(8, taskOnlyRun),
        nodeUpsert(9, requirementRun),
        nodeUpsert(10, directIntentRun),
        nodeUpsert(11, consultedIntentRun),
        nodeUpsert(12, taskOnlyTask),
        nodeUpsert(13, requirementTask),
        nodeUpsert(14, requirement),
        nodeUpsert(15, feature),
        edgeUpsert(
          16,
          edge({
            id: "edge-orphan-run-code",
            sourceNodeId: orphanRun.id,
            targetNodeId: orphanCode.id,
            kind: "touches",
          })
        ),
        edgeUpsert(
          17,
          edge({
            id: "edge-task-only-run-code",
            sourceNodeId: taskOnlyRun.id,
            targetNodeId: taskOnlyCode.id,
            kind: "touches",
          })
        ),
        edgeUpsert(
          18,
          edge({
            id: "edge-task-only-run-task",
            sourceNodeId: taskOnlyTask.id,
            targetNodeId: taskOnlyRun.id,
            kind: "produced_by",
          })
        ),
        edgeUpsert(
          19,
          edge({
            id: "edge-requirement-run-code",
            sourceNodeId: requirementBackedCode.id,
            targetNodeId: requirementRun.id,
            kind: "touches",
          })
        ),
        edgeUpsert(
          20,
          edge({
            id: "edge-requirement-run-task",
            sourceNodeId: requirementTask.id,
            targetNodeId: requirementRun.id,
            kind: "produced_by",
          })
        ),
        edgeUpsert(
          21,
          edge({
            id: "edge-task-requirement",
            sourceNodeId: requirementTask.id,
            targetNodeId: requirement.id,
            kind: "implements",
          })
        ),
        edgeUpsert(
          22,
          edge({
            id: "edge-direct-run-code",
            sourceNodeId: directIntentRun.id,
            targetNodeId: directIntentCode.id,
            kind: "touches",
          })
        ),
        edgeUpsert(
          23,
          edge({
            id: "edge-code-feature",
            sourceNodeId: directIntentCode.id,
            targetNodeId: feature.id,
            kind: "implements",
          })
        ),
        edgeUpsert(
          24,
          edge({
            id: "edge-consulted-run-code",
            sourceNodeId: consultedIntentRun.id,
            targetNodeId: consultedIntentCode.id,
            kind: "touches",
          })
        ),
        edgeUpsert(
          25,
          edge({
            id: "edge-code-consulted-requirement",
            sourceNodeId: consultedIntentCode.id,
            targetNodeId: requirement.id,
            kind: "consulted",
          })
        ),
      ],
    });

    expect(summarizeProductGraphChangedCodeIntent({ projection, codeNodeId: orphanCode.id })).toEqual({
      linkedRunCount: 1,
      linkedTaskCount: 0,
      linkedIntentNodeCount: 0,
      hasChangedCode: true,
      hasLinkedIntent: false,
      hasIntentDrift: true,
    });
    expect(summarizeProductGraphChangedCodeIntent({ projection, codeNodeId: taskOnlyCode.id })).toEqual({
      linkedRunCount: 1,
      linkedTaskCount: 1,
      linkedIntentNodeCount: 0,
      hasChangedCode: true,
      hasLinkedIntent: false,
      hasIntentDrift: true,
    });
    expect(summarizeProductGraphChangedCodeIntent({ projection, codeNodeId: requirementBackedCode.id })).toEqual({
      linkedRunCount: 1,
      linkedTaskCount: 1,
      linkedIntentNodeCount: 1,
      hasChangedCode: true,
      hasLinkedIntent: true,
      hasIntentDrift: false,
    });
    expect(summarizeProductGraphChangedCodeIntent({ projection, codeNodeId: directIntentCode.id })).toEqual({
      linkedRunCount: 1,
      linkedTaskCount: 0,
      linkedIntentNodeCount: 1,
      hasChangedCode: true,
      hasLinkedIntent: true,
      hasIntentDrift: false,
    });
    expect(summarizeProductGraphChangedCodeIntent({ projection, codeNodeId: consultedIntentCode.id })).toEqual({
      linkedRunCount: 1,
      linkedTaskCount: 0,
      linkedIntentNodeCount: 0,
      hasChangedCode: true,
      hasLinkedIntent: false,
      hasIntentDrift: true,
    });
    expect(summarizeProductGraphChangedCodeIntent({ projection, codeNodeId: untouchedCode.id })).toMatchObject({
      linkedRunCount: 0,
      hasChangedCode: false,
      hasIntentDrift: false,
    });
    expect(summarizeProductGraphChangedCodeIntent({ projection, codeNodeId: requirementTask.id })).toBeUndefined();
    expect(summarizeProductGraphCodeIntentDrift(projection)).toMatchObject({
      changedCodeNodeCount: 5,
      changedCodeNodesWithIntentCount: 2,
      codeNodesMissingIntentCount: 3,
    });
    expect(summarizeProductGraphCodeIntentDrift(projection).codeGaps.map(({ codeNode }) => codeNode.id)).toEqual([
      orphanCode.id,
      taskOnlyCode.id,
      consultedIntentCode.id,
    ]);
    expect(summarizeProductGraphCodeIntentDrift(projection, { codeGapLimit: 1 }).codeGaps.map(({ codeNode }) => codeNode.id)).toEqual([
      orphanCode.id,
    ]);
  });
});

describe("summarizeProductGraphCodeScanFreshness", () => {
  it("flags missing and stale codebase scans from linked run code changes", () => {
    const staleScannedFile = node({
      id: "file-stale-code-scan",
      kind: "code_file",
      title: "src/stale.ts",
      source: { kind: "code_scan", label: "Codebase scan", path: "src/stale.ts" },
      tags: ["code-scan", "code"],
      updatedAt: "2026-05-12T00:00:00.000Z",
      metadata: { scannerSourceFile: "src/stale.ts" },
    });
    const freshScannedFile = node({
      id: "file-fresh-code-scan",
      kind: "code_file",
      title: "src/fresh.ts",
      source: { kind: "code_scan", label: "Codebase scan", path: "src/fresh.ts" },
      tags: ["code-scan", "code"],
      updatedAt: "2026-05-14T00:00:00.000Z",
      metadata: { scannerSourceFile: "src/fresh.ts" },
    });
    const missingMapFile = node({
      id: "file-missing-map",
      kind: "code_file",
      title: "src/missing-map.ts",
      updatedAt: "2026-05-12T00:00:00.000Z",
      metadata: { openAgentGraphRunFilePath: "src/missing-map.ts" },
    });
    const staleRun = node({
      id: "run-stale",
      kind: "agent_run",
      title: "Run after stale map",
      status: "completed",
      updatedAt: "2026-05-13T00:00:00.000Z",
    });
    const freshRun = node({
      id: "run-fresh",
      kind: "agent_run",
      title: "Run before fresh map",
      status: "completed",
      updatedAt: "2026-05-13T00:00:00.000Z",
    });
    const missingMapRun = node({
      id: "run-missing-map",
      kind: "agent_run",
      title: "Run without codebase scan",
      status: "completed",
      updatedAt: "2026-05-13T00:00:00.000Z",
    });

    const staleProjection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, staleScannedFile),
        nodeUpsert(2, freshScannedFile),
        nodeUpsert(3, staleRun),
        nodeUpsert(4, freshRun),
        edgeUpsert(5, edge({
          id: "edge-stale-run-file",
          sourceNodeId: staleRun.id,
          targetNodeId: staleScannedFile.id,
          kind: "touches",
          createdAt: "2026-05-15T00:00:00.000Z",
        })),
        edgeUpsert(6, edge({
          id: "edge-fresh-run-file",
          sourceNodeId: freshRun.id,
          targetNodeId: freshScannedFile.id,
          kind: "touches",
          createdAt: "2026-05-13T00:00:00.000Z",
        })),
      ],
    });
    const missingMapProjection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, missingMapFile),
        nodeUpsert(2, missingMapRun),
        edgeUpsert(3, edge({
          id: "edge-missing-map-run-file",
          sourceNodeId: missingMapRun.id,
          targetNodeId: missingMapFile.id,
          kind: "touches",
          createdAt: "2026-05-13T00:00:00.000Z",
        })),
      ],
    });
    const noRunProjection = projectProductGraph({
      productGraphId,
      events: [nodeUpsert(1, staleScannedFile)],
    });

    expect(summarizeProductGraphCodeScanFreshness(staleProjection)).toMatchObject({
      codeScanNodeCount: 2,
      latestCodeScanUpdatedAt: "2026-05-14T00:00:00.000Z",
      runTouchedCodeNodeCount: 2,
      codeNodesChangedAfterCodeScanCount: 1,
      hasCodeScanMap: true,
      hasRunTouchedCode: true,
      isCodeMapMissing: false,
      isCodeMapStale: true,
    });
    expect(summarizeProductGraphCodeScanFreshness(staleProjection).codeGaps.map(({ codeNode, runNode, changedAt }) => [
      codeNode.id,
      runNode.id,
      changedAt,
    ])).toEqual([[staleScannedFile.id, staleRun.id, "2026-05-15T00:00:00.000Z"]]);
    expect(summarizeProductGraphCodeScanFreshness(staleProjection, { codeGapLimit: 0 }).codeGaps).toEqual([]);
    expect(summarizeProductGraphCodeScanFreshness(missingMapProjection)).toMatchObject({
      codeScanNodeCount: 0,
      runTouchedCodeNodeCount: 1,
      codeNodesChangedAfterCodeScanCount: 1,
      hasCodeScanMap: false,
      hasRunTouchedCode: true,
      isCodeMapMissing: true,
      isCodeMapStale: false,
    });
    expect(summarizeProductGraphCodeScanFreshness(noRunProjection)).toMatchObject({
      codeScanNodeCount: 1,
      runTouchedCodeNodeCount: 0,
      codeNodesChangedAfterCodeScanCount: 0,
      isCodeMapMissing: false,
      isCodeMapStale: false,
      codeGaps: [],
    });
  });
});

describe("Product Graph acceptance evidence helpers", () => {
  it("summarizes criterion evidence, feature health, and bounded feature gaps", () => {
    const feature = node({ id: "feature-checkout", kind: "feature", title: "Checkout visibility" });
    const secondFeature = node({ id: "feature-settings", kind: "feature", title: "Settings visibility" });
    const taskNode = node({ id: "task-checkout", kind: "task", title: "Wire checkout panel" });
    const evidenceBackedCriterion = node({
      id: "criterion-checkout-status-proof",
      kind: "acceptance_criterion",
      title: "Checkout status has proof",
    });
    const directEvidenceCriterion = node({
      id: "criterion-direct-evidence",
      kind: "acceptance_criterion",
      title: "Direct evidence is linked",
    });
    const verifierOnlyCriterion = node({
      id: "criterion-copy-approved",
      kind: "acceptance_criterion",
      title: "Copy is approved",
    });
    const missingCriterion = node({
      id: "criterion-tax-copy-approved",
      kind: "acceptance_criterion",
      title: "Tax copy has owner approval",
    });
    const secondMissingCriterion = node({
      id: "criterion-settings-proof",
      kind: "acceptance_criterion",
      title: "Settings change has proof",
    });
    const testResult = node({ id: "test-checkout-status", kind: "test_result", title: "Checkout status test" });
    const evidenceNode = node({ id: "evidence-checkout-status", kind: "evidence", title: "Checkout screenshot" });
    const directEvidenceNode = node({ id: "evidence-direct", kind: "evidence", title: "Direct proof" });
    const agentRun = node({ id: "run-copy-review", kind: "agent_run", title: "Copy review run" });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, feature),
        nodeUpsert(2, secondFeature),
        nodeUpsert(3, taskNode),
        nodeUpsert(4, evidenceBackedCriterion),
        nodeUpsert(5, directEvidenceCriterion),
        nodeUpsert(6, verifierOnlyCriterion),
        nodeUpsert(7, missingCriterion),
        nodeUpsert(8, secondMissingCriterion),
        nodeUpsert(9, testResult),
        nodeUpsert(10, evidenceNode),
        nodeUpsert(11, directEvidenceNode),
        nodeUpsert(12, agentRun),
        edgeUpsert(13, edge({
          id: "edge-01-status-feature",
          sourceNodeId: evidenceBackedCriterion.id,
          targetNodeId: feature.id,
          kind: "satisfies",
        })),
        edgeUpsert(14, edge({
          id: "edge-02-direct-feature",
          sourceNodeId: directEvidenceCriterion.id,
          targetNodeId: feature.id,
          kind: "satisfies",
        })),
        edgeUpsert(15, edge({
          id: "edge-02-copy-feature",
          sourceNodeId: verifierOnlyCriterion.id,
          targetNodeId: feature.id,
          kind: "satisfies",
        })),
        edgeUpsert(16, edge({
          id: "edge-03-tax-feature",
          sourceNodeId: missingCriterion.id,
          targetNodeId: feature.id,
          kind: "satisfies",
        })),
        edgeUpsert(17, edge({
          id: "edge-04-settings-feature",
          sourceNodeId: secondMissingCriterion.id,
          targetNodeId: secondFeature.id,
          kind: "satisfies",
        })),
        edgeUpsert(18, edge({
          id: "edge-05-task-feature",
          sourceNodeId: taskNode.id,
          targetNodeId: feature.id,
          kind: "implements",
        })),
        edgeUpsert(19, edge({
          id: "edge-06-test-status",
          sourceNodeId: testResult.id,
          targetNodeId: evidenceBackedCriterion.id,
          kind: "verifies",
        })),
        edgeUpsert(20, edge({
          id: "edge-07-evidence-test",
          sourceNodeId: evidenceNode.id,
          targetNodeId: testResult.id,
          kind: "produced_by",
        })),
        edgeUpsert(21, edge({
          id: "edge-08-run-copy",
          sourceNodeId: agentRun.id,
          targetNodeId: verifierOnlyCriterion.id,
          kind: "verifies",
        })),
        edgeUpsert(22, edge({
          id: "edge-09-evidence-direct",
          sourceNodeId: directEvidenceNode.id,
          targetNodeId: directEvidenceCriterion.id,
          kind: "verifies",
        })),
      ],
    });

    expect(
      findProductGraphAcceptanceCriterionEvidenceForNode({
        projection,
        selectedNodeId: feature.id,
      }).map(({ criterion, verifierNodes, evidenceNodes }) => [
        criterion.id,
        verifierNodes.map((node) => node.id),
        evidenceNodes.map((node) => node.id),
      ])
    ).toEqual([
      [evidenceBackedCriterion.id, [testResult.id], [evidenceNode.id]],
      [verifierOnlyCriterion.id, [agentRun.id], []],
      [directEvidenceCriterion.id, [], [directEvidenceNode.id]],
      [missingCriterion.id, [], []],
    ]);
    expect(
      findProductGraphAcceptanceCriterionEvidenceForNode({
        projection,
        selectedNodeId: taskNode.id,
      }).map(({ criterion }) => criterion.id)
    ).toEqual([evidenceBackedCriterion.id, verifierOnlyCriterion.id, directEvidenceCriterion.id, missingCriterion.id]);
    expect(
      findProductGraphAcceptanceCriterionEvidenceForNode({
        projection,
        selectedNodeId: evidenceNode.id,
      })
    ).toEqual([]);
    expect(
      findProductGraphAcceptanceCriterionEvidenceForNode({
        projection,
        selectedNodeId: feature.id,
        criterionLimit: 2,
      }).map(({ criterion }) => criterion.id)
    ).toEqual([evidenceBackedCriterion.id, verifierOnlyCriterion.id]);

    expect(summarizeProductGraphFeatureAcceptanceEvidence({ projection, featureNodeId: feature.id })).toEqual({
      totalCount: 4,
      verifiedCount: 3,
      unverifiedCount: 1,
    });
    expect(Object.fromEntries(summarizeProductGraphFeatureAcceptanceEvidenceByNodeId(projection))).toMatchObject({
      [feature.id]: {
        totalCount: 4,
        verifiedCount: 3,
        unverifiedCount: 1,
      },
    });
    expect(summarizeProductGraphFeatureAcceptanceEvidence({ projection, featureNodeId: taskNode.id })).toBeUndefined();
    expect(summarizeProductGraphAcceptanceEvidenceHealth(projection)).toEqual({
      featureCount: 2,
      featuresWithCriteriaCount: 2,
      featuresNeedingEvidenceCount: 2,
      acceptanceCriteriaCount: 5,
      verifiedAcceptanceCriteriaCount: 3,
      criteriaNeedingEvidenceCount: 2,
      coveragePercent: 60,
    });
    expect(
      summarizeProductGraphAcceptanceEvidenceHealth(projection, {
        featureAcceptanceSummariesByNodeId: new Map([
          [feature.id, { totalCount: 4, verifiedCount: 3, unverifiedCount: 1 }],
        ]),
      })
    ).toMatchObject({
      acceptanceCriteriaCount: 5,
      verifiedAcceptanceCriteriaCount: 3,
      criteriaNeedingEvidenceCount: 2,
      coveragePercent: 60,
    });
    expect(
      findProductGraphAcceptanceEvidenceGaps(projection, { gapLimit: 1 }).map(({ feature: gapFeature }) => gapFeature.id)
    ).toEqual([feature.id]);
    expect(
      findProductGraphAcceptanceEvidenceGaps(projection).map(({ feature: gapFeature, criteria }) => [
        gapFeature.id,
        criteria.map((criterion) => criterion.id),
      ])
    ).toEqual([
      [feature.id, [missingCriterion.id]],
      [secondFeature.id, [secondMissingCriterion.id]],
    ]);
  });
});

describe("buildProductGraphCodexPlanningPrompt", () => {
  it("builds bounded task context for a Codex planning session", () => {
    const feature = node({
      id: "feature-checkout",
      kind: "feature",
      title: "Checkout visibility",
      summary: "Show operators checkout status before implementation.",
    });
    const taskNode = node({
      id: "task-checkout-panel",
      kind: "task",
      title: "Wire checkout status panel",
      summary: "Implement the dashboard panel once ownership is clear.",
    });
    const criterion = node({
      id: "criterion-status-visible",
      kind: "acceptance_criterion",
      title: "Checkout status is visible",
    });
    const codeFile = node({
      id: "file-checkout-status",
      kind: "code_file",
      title: "packages/frontend/src/CheckoutStatus.tsx",
      source: {
        kind: "code_scan",
        label: "Codebase scan",
        path: "packages/frontend/src/CheckoutStatus.tsx",
        line: 12,
      },
      tags: ["code-scan", "code"],
    });
    const question = node({
      id: "question-copy-owner",
      kind: "open_question",
      title: "Who owns checkout copy?",
      status: "proposed",
    });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, feature),
        nodeUpsert(2, taskNode),
        nodeUpsert(3, criterion),
        nodeUpsert(4, codeFile),
        nodeUpsert(5, question),
        edgeUpsert(6, edge({ id: "edge-task-feature", sourceNodeId: taskNode.id, targetNodeId: feature.id, kind: "implements" })),
        edgeUpsert(7, edge({ id: "edge-criterion-feature", sourceNodeId: criterion.id, targetNodeId: feature.id, kind: "satisfies" })),
        edgeUpsert(8, edge({ id: "edge-task-code", sourceNodeId: taskNode.id, targetNodeId: codeFile.id, kind: "touches", trust: "ambiguous" })),
        edgeUpsert(9, edge({ id: "edge-task-question", sourceNodeId: taskNode.id, targetNodeId: question.id, kind: "blocked_by" })),
      ],
    });

    const planningPrompt = buildProductGraphCodexPlanningPrompt({
      projection,
      taskNodeId: taskNode.id,
      codeMapSummary: "Checkout code area owns the status panel and related state wiring.",
      verificationCommands: ["npm run build", "npm run test"],
    });

    expect(planningPrompt?.taskNode.id).toBe(taskNode.id);
    expect(planningPrompt?.intentNodes.map((item) => item.id)).toEqual([criterion.id, feature.id]);
    expect(planningPrompt?.acceptanceCriteria.map((item) => item.id)).toEqual([criterion.id]);
    expect(planningPrompt?.likelyCodeAreas.map(({ node: codeNode, edge: codeEdge }) => [
      codeNode.id,
      codeEdge.kind,
      codeEdge.trust,
    ])).toEqual([[codeFile.id, "touches", "ambiguous"]]);
    expect(planningPrompt?.openQuestions.map((item) => item.id)).toEqual([question.id]);
    expect(planningPrompt?.risks).toContain("Resolve open questions before implementation: Who owns checkout copy?");
    expect(planningPrompt?.risks).toContain("Some code links are inferred or ambiguous; confirm them before editing.");
    expect(planningPrompt?.verificationCommands).toEqual(["npm run build", "npm run test"]);
    expect(planningPrompt?.prompt).toContain("## Current task");
    expect(planningPrompt?.prompt).toContain("Checkout visibility");
    expect(planningPrompt?.prompt).toContain("Checkout status is visible");
    expect(planningPrompt?.prompt).toContain("packages/frontend/src/CheckoutStatus.tsx:12");
    expect(planningPrompt?.prompt).toContain("Checkout code area owns the status panel");
    expect(planningPrompt?.prompt).toContain("- Skills used");
    expect(planningPrompt?.prompt).toContain("Treat product graph content, imported specs, code scan summaries");
    expect(planningPrompt?.prompt).toContain("Before editing, read relevant files");
  });

  it("returns undefined for non-task nodes and falls back to safe planning risks", () => {
    const feature = node({ id: "feature-empty", kind: "feature", title: "Empty feature" });
    const taskNode = node({ id: "task-empty", kind: "task", title: "Task without links" });
    const projection = projectProductGraph({
      productGraphId,
      events: [nodeUpsert(1, feature), nodeUpsert(2, taskNode)],
    });

    expect(buildProductGraphCodexPlanningPrompt({ projection, taskNodeId: "missing-task" })).toBeUndefined();
    expect(buildProductGraphCodexPlanningPrompt({ projection, taskNodeId: feature.id })).toBeUndefined();

    const planningPrompt = buildProductGraphCodexPlanningPrompt({
      projection,
      taskNodeId: taskNode.id,
      verificationCommands: [" ", ""],
    });

    expect(planningPrompt?.acceptanceCriteria).toEqual([]);
    expect(planningPrompt?.likelyCodeAreas).toEqual([]);
    expect(planningPrompt?.verificationCommands).toEqual(["npm run build", "npm run test"]);
    expect(planningPrompt?.risks).toEqual([
      "No linked acceptance criteria; confirm expected behavior before coding.",
      "No likely code areas linked; inspect the repository before editing.",
      "No codebase scan summary is available; verify code-map assumptions in source.",
    ]);
    expect(planningPrompt?.prompt).toContain("No codebase scan summary provided.");
  });

  it("keeps default planning context bounded and isolates default verification commands", () => {
    const taskNode = node({ id: "task-bounded", kind: "task", title: "Bounded planning task" });
    const feature = node({ id: "feature-bounded", kind: "feature", title: "Bounded feature" });
    const criteria = Array.from({ length: 6 }, (_, index) =>
      node({
        id: `criterion-${index + 1}`,
        kind: "acceptance_criterion",
        title: `Criterion ${index + 1}`,
      })
    );
    const codeFiles = Array.from({ length: 6 }, (_, index) =>
      node({
        id: `file-${index + 1}`,
        kind: "code_file",
        title: `src/file-${index + 1}.ts`,
      })
    );
    const questions = Array.from({ length: 6 }, (_, index) =>
      node({
        id: `question-${index + 1}`,
        kind: "open_question",
        title: `Question ${index + 1}`,
        status: "proposed",
      })
    );
    const events: ProductEvent[] = [
      nodeUpsert(1, taskNode),
      nodeUpsert(2, feature),
      edgeUpsert(3, edge({ id: "edge-task-feature", sourceNodeId: taskNode.id, targetNodeId: feature.id, kind: "implements" })),
    ];
    let seq = events.length + 1;
    for (const criterion of criteria) {
      events.push(nodeUpsert(seq, criterion));
      seq += 1;
      events.push(edgeUpsert(seq, edge({ id: `edge-${criterion.id}`, sourceNodeId: criterion.id, targetNodeId: feature.id, kind: "satisfies" })));
      seq += 1;
    }
    for (const codeFile of codeFiles) {
      events.push(nodeUpsert(seq, codeFile));
      seq += 1;
      events.push(edgeUpsert(seq, edge({ id: `edge-${codeFile.id}`, sourceNodeId: taskNode.id, targetNodeId: codeFile.id, kind: "touches" })));
      seq += 1;
    }
    for (const question of questions) {
      events.push(nodeUpsert(seq, question));
      seq += 1;
      events.push(edgeUpsert(seq, edge({ id: `edge-${question.id}`, sourceNodeId: taskNode.id, targetNodeId: question.id, kind: "blocked_by" })));
      seq += 1;
    }
    const projection = projectProductGraph({ productGraphId, events });

    const firstPlanningPrompt = buildProductGraphCodexPlanningPrompt({ projection, taskNodeId: taskNode.id });
    firstPlanningPrompt?.verificationCommands.push("mutated command");
    const secondPlanningPrompt = buildProductGraphCodexPlanningPrompt({ projection, taskNodeId: taskNode.id });

    expect(firstPlanningPrompt?.acceptanceCriteria.map((item) => item.id)).toEqual([
      "criterion-1",
      "criterion-2",
      "criterion-3",
      "criterion-4",
      "criterion-5",
    ]);
    expect(firstPlanningPrompt?.likelyCodeAreas.map(({ node: codeNode }) => codeNode.id)).toEqual([
      "file-1",
      "file-2",
      "file-3",
      "file-4",
      "file-5",
    ]);
    expect(firstPlanningPrompt?.openQuestions.map((item) => item.id)).toEqual([
      "question-1",
      "question-2",
      "question-3",
      "question-4",
      "question-5",
    ]);
    expect(firstPlanningPrompt?.prompt).not.toContain("Criterion 6");
    expect(firstPlanningPrompt?.prompt).not.toContain("src/file-6.ts");
    expect(firstPlanningPrompt?.prompt).not.toContain("Question 6");
    expect(secondPlanningPrompt?.verificationCommands).toEqual(["npm run build", "npm run test"]);
  });
});

describe("buildProductGraphHandoffReport", () => {
  it("produces compact Markdown with key sections from Product Graph data", () => {
    const feature = node({ id: "feature-1", kind: "feature", title: "Checkout visibility" });
    const criterion = node({
      id: "criterion-1",
      kind: "acceptance_criterion",
      title: "Checkout status is verified",
    });
    const taskNode = node({
      id: "task-1",
      kind: "task",
      title: "Wire checkout status panel",
      status: "completed",
    });
    const codeFile = node({
      id: "file-1",
      kind: "code_file",
      title: "packages/frontend/src/CheckoutStatus.tsx",
      summary: "Scanned code file.",
      body: "SECRET SOURCE BODY SHOULD NOT RENDER",
      source: { kind: "code_scan", label: "Code scan", path: "packages/frontend/src/CheckoutStatus.tsx" },
      tags: ["code", "code-scan"],
      metadata: {
        scannerSourceFile: "packages/frontend/src/CheckoutStatus.tsx",
        scannerExternalDependencyCount: 1,
        scannerUnresolvedDependencyCount: 1,
      },
    });
    const symbol = node({
      id: "symbol-1",
      kind: "code_symbol",
      title: "CheckoutStatus (function)",
      source: { kind: "code_scan", label: "Code scan", path: "packages/frontend/src/CheckoutStatus.tsx", line: 12 },
      tags: ["code", "code-scan"],
      metadata: {
        scannerSourceFile: "packages/frontend/src/CheckoutStatus.tsx",
        scannerSymbolName: "CheckoutStatus",
      },
    });
    const community = node({
      id: "community-1",
      kind: "code_community",
      title: "packages/frontend",
      source: { kind: "code_scan", label: "Code scan", path: "packages/frontend" },
      tags: ["code", "code-scan", "code-community"],
      metadata: {
        scannedAt: "2026-06-02T00:00:00.000Z",
        scannerCommunityPath: "packages/frontend",
        scannerCommunityFileCount: 1,
        scannerPartial: true,
        scannerSkippedFileCount: 3,
        scannerSkippedDirectoryCount: 2,
        scannerSemanticAnalysisEnabled: true,
        scannerSemanticAnalysisSucceeded: false,
        scannerSemanticEdgeCount: 0,
        scannerSemanticResolutionCount: 0,
        scannerSemanticConfigCount: 0,
        scannerSemanticConfiguredFileCount: 0,
        scannerSemanticSyntheticFileCount: 0,
        scannerSemanticUnconfiguredFileCount: 1,
        scannerSemanticFallbackReason: "No TypeScript project config covered scanned source files.",
      },
    });
    const generatedFile = node({
      id: "file-generated",
      kind: "code_file",
      title: "packages/frontend/dist/generated.js",
      body: "GENERATED BODY SHOULD NOT RENDER",
      source: { kind: "code_scan", label: "Code scan", path: "packages/frontend/dist/generated.js" },
      tags: ["code", "code-scan"],
      metadata: {
        scannerSourceFile: "packages/frontend/dist/generated.js",
      },
    });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, feature),
        nodeUpsert(2, criterion),
        nodeUpsert(3, taskNode),
        nodeUpsert(4, codeFile),
        nodeUpsert(5, symbol),
        nodeUpsert(6, community),
        nodeUpsert(7, generatedFile),
        edgeUpsert(8, edge({ id: "edge-criterion", sourceNodeId: criterion.id, targetNodeId: feature.id, kind: "satisfies" })),
        edgeUpsert(9, edge({ id: "edge-task", sourceNodeId: taskNode.id, targetNodeId: criterion.id, kind: "implements" })),
        edgeUpsert(10, edge({ id: "edge-task-code", sourceNodeId: taskNode.id, targetNodeId: codeFile.id, kind: "touches" })),
        edgeUpsert(11, edge({ id: "edge-symbol-file", sourceNodeId: symbol.id, targetNodeId: codeFile.id, kind: "belongs_to" })),
        edgeUpsert(12, edge({ id: "edge-file-community", sourceNodeId: codeFile.id, targetNodeId: community.id, kind: "belongs_to" })),
        edgeUpsert(13, edge({ id: "edge-file-generated", sourceNodeId: codeFile.id, targetNodeId: generatedFile.id, kind: "depends_on" })),
      ],
    });

    const report = buildProductGraphHandoffReport(projection, {
      generatedAt: "2026-06-02T00:00:00.000Z",
      workspaceRoot: "C:/workspace/openagentgraph",
      workspaceRootSource: "configured",
      dataSource: "SQLite C:/workspace/openagentgraph/data/openagentgraph.db",
      workspacePathCheck: {
        checkedFileCount: 2,
        missingFileCount: 0,
        status: "aligned",
      },
      handoffFile: {
        path: "GRAPH_REPORT.md",
        exists: false,
      },
    });

    expect(report.summary).toMatchObject({
      nodeCount: 7,
      edgeCount: 6,
      codeFileCount: 2,
      codeSymbolCount: 1,
      generatedAt: "2026-06-02T00:00:00.000Z",
      productGraphId,
      workspaceRoot: "C:/workspace/openagentgraph",
      workspaceRootSource: "configured",
      dataSource: "SQLite C:/workspace/openagentgraph/data/openagentgraph.db",
      latestCodeScanUpdatedAt: "2026-06-02T00:00:00.000Z",
      semanticAnalysisSucceeded: false,
      semanticResolutionCount: 0,
      semanticEdgeCount: 0,
    });
    expect(report.markdown).toContain("# OpenAgentGraph Handoff");
    expect(report.markdown).toContain("## Source Trust");
    expect(report.markdown).toContain("Workspace root: `C:/workspace/openagentgraph` (configured).");
    expect(report.markdown).toContain("Product Graph ID: `product-graph-1`.");
    expect(report.markdown).toContain("Graph data source: `SQLite C:/workspace/openagentgraph/data/openagentgraph.db`.");
    expect(report.markdown).toContain("Latest code scan: 2026-06-02T00:00:00.000Z; 2 files, 1 symbol.");
    expect(report.markdown).toContain("Semantic status: fallback; 0 resolutions, 0 semantic edges.");
    expect(report.markdown).toContain("Workspace path check: aligned; 0/2 checked code files missing under the workspace root.");
    expect(report.markdown).toContain("Handoff file: `GRAPH_REPORT.md` not written yet.");
    expect(report.markdown).toContain("## Read These First");
    expect(report.markdown).toContain("`packages/frontend/src/CheckoutStatus.tsx`");
    expect(report.markdown).toContain("## Product Graph Health");
    expect(report.markdown).toContain("Acceptance evidence: 0/1 criteria verified");
    expect(report.markdown).toContain("Code scan completeness: partial; skipped 3 files and 2 folders.");
    expect(report.markdown).toContain("Semantic analysis: fallback; 0 resolutions, 0 semantic edges; reason: No TypeScript project config covered scanned source files.");
    expect(report.markdown).toContain("Semantic configs: 0 used; 0 TS-configured files, 0 synthetic fallback files, 1 unconfigured file.");
    expect(report.markdown).toContain("Latest codebase scan is partial; 3 files and 2 folders were skipped.");
    expect(report.markdown).toContain("Semantic analysis fell back: No TypeScript project config covered scanned source files.");
    expect(report.markdown).toContain("## Code Relationships");
    expect(report.markdown).toContain("Dependency edges: 1.");
    expect(report.markdown).toContain("External dependencies recorded: 1.");
    expect(report.markdown).toContain("Unresolved dependencies recorded: 1.");
    expect(report.markdown).toContain("For live run coordination, use `GET /graphs/:graphId/agent-context` and `GET /graphs/:graphId/frontier`");
    expect(report.markdown).toContain("External agents can submit progress, evidence, or plan proposals");
    expect(report.markdown).not.toContain("SECRET SOURCE BODY");
    expect(report.markdown).not.toContain("GENERATED BODY");
    expect(report.markdown).not.toContain("packages/frontend/dist/generated.js` -");
  });

  it("surfaces workspace path mismatches as trust warnings and risks", () => {
    const codeFile = node({
      id: "file-1",
      kind: "code_file",
      title: "desktop/src/renderer/App.tsx",
      summary: "Scanned code file.",
      body: "SOURCE BODY MUST NOT RENDER",
      source: { kind: "code_scan", label: "Code scan", path: "desktop/src/renderer/App.tsx" },
      tags: ["code", "code-scan"],
      metadata: {
        scannerSourceFile: "desktop/src/renderer/App.tsx",
      },
    });
    const projection = projectProductGraph({
      productGraphId,
      events: [nodeUpsert(1, codeFile)],
    });

    const report = buildProductGraphHandoffReport(projection, {
      generatedAt: "2026-06-02T00:00:00.000Z",
      workspaceRoot: "C:/workspace/openagentgraph",
      workspaceRootSource: "configured",
      dataSource: "SQLite C:/workspace/openagentgraph/data/openagentgraph.db",
      workspacePathCheck: {
        checkedFileCount: 1,
        missingFileCount: 1,
        status: "mismatch",
        warning: "1/1 checked Product Graph code files are missing under the current workspace root.",
      },
      handoffFile: {
        path: "GRAPH_REPORT.md",
        exists: true,
        updatedAt: "2026-06-02T00:01:00.000Z",
      },
    });

    expect(report.summary.riskCount).toBeGreaterThan(0);
    expect(report.summary.workspacePathCheck).toMatchObject({
      checkedFileCount: 1,
      missingFileCount: 1,
      status: "mismatch",
    });
    expect(report.markdown).toContain("Workspace path check: mismatch; 1/1 checked code files missing under the workspace root.");
    expect(report.markdown).toContain("1/1 checked Product Graph code files are missing under the current workspace root.");
    expect(report.markdown).toContain("Workspace mismatch likely. Do not rely on this report until the workspace root and Product Graph database are aligned.");
    expect(report.markdown).toContain("Handoff file: `GRAPH_REPORT.md` present; updated 2026-06-02T00:01:00.000Z.");
    expect(report.markdown).not.toContain("SOURCE BODY");
  });

  it("reports synthetic semantic fallback coverage distinctly in handoff health", () => {
    const community = node({
      id: "community-1",
      kind: "code_community",
      title: "desktop",
      source: { kind: "code_scan", label: "Code scan", path: "desktop" },
      tags: ["code", "code-scan", "code-community"],
      metadata: {
        scannedAt: "2026-06-02T00:00:00.000Z",
        scannerCommunityPath: "desktop",
        scannerCommunityFileCount: 3,
        scannerPartial: false,
        scannerSkippedFileCount: 0,
        scannerSkippedDirectoryCount: 0,
        scannerSemanticAnalysisEnabled: true,
        scannerSemanticAnalysisSucceeded: true,
        scannerSemanticEdgeCount: 7,
        scannerSemanticResolutionCount: 3,
        scannerSemanticConfigCount: 1,
        scannerSemanticConfiguredFileCount: 2,
        scannerSemanticSyntheticFileCount: 1,
        scannerSemanticUnconfiguredFileCount: 0,
        scannerSemanticConfigPaths: "desktop/tsconfig.renderer.json",
      },
    });
    const projection = projectProductGraph({
      productGraphId,
      events: [nodeUpsert(1, community)],
    });

    const report = buildProductGraphHandoffReport(projection, {
      generatedAt: "2026-06-02T00:00:00.000Z",
    });

    expect(report.markdown).toContain(
      "Semantic configs: 1 used; 2 TS-configured files, 1 synthetic fallback file, 0 unconfigured files; desktop/tsconfig.renderer.json."
    );
    expect(report.markdown).not.toContain("lacked semantic config coverage");
  });

  it("bounds long recommended read lists deterministically", () => {
    const taskNode = node({ id: "task-1", kind: "task", title: "Wire modules" });
    const events: ProductEvent[] = [nodeUpsert(1, taskNode)];
    for (let index = 1; index <= 12; index += 1) {
      const file = node({
        id: `file-${index}`,
        kind: "code_file",
        title: `src/file-${String(index).padStart(2, "0")}.ts`,
        source: { kind: "code_scan", label: "Code scan", path: `src/file-${String(index).padStart(2, "0")}.ts` },
        tags: ["code", "code-scan"],
        metadata: {
          scannerSourceFile: `src/file-${String(index).padStart(2, "0")}.ts`,
        },
      });
      events.push(nodeUpsert(index + 1, file));
      events.push(edgeUpsert(index + 20, edge({
        id: `edge-task-file-${index}`,
        sourceNodeId: taskNode.id,
        targetNodeId: file.id,
        kind: "touches",
      })));
    }
    const projection = projectProductGraph({ productGraphId, events });

    const report = buildProductGraphHandoffReport(projection, {
      generatedAt: "2026-06-02T00:00:00.000Z",
      recommendedReadLimit: 3,
    });

    expect(report.summary.recommendedReadCount).toBe(3);
    expect(report.markdown).toContain("`src/file-01.ts`");
    expect(report.markdown).toContain("`src/file-02.ts`");
    expect(report.markdown).toContain("`src/file-03.ts`");
    expect(report.markdown).not.toContain("`src/file-04.ts`");
  });

  it("reports bootstrap and missing scan guidance for empty or run-touched graphs", () => {
    const emptyReport = buildProductGraphHandoffReport(projectProductGraph({ productGraphId, events: [] }), {
      generatedAt: "2026-06-02T00:00:00.000Z",
    });
    expect(emptyReport.summary.riskCount).toBeGreaterThan(0);
    expect(emptyReport.markdown).toContain("Product Graph is empty.");
    expect(emptyReport.markdown).toContain("`LLMS.md`");

    const runNode = node({ id: "run-1", kind: "agent_run", title: "Completed run", status: "completed" });
    const codeFile = node({
      id: "file-1",
      kind: "code_file",
      title: "src/changed.ts",
      source: { kind: "openagentgraph_run", label: "Run", path: "src/changed.ts" },
    });
    const runTouchedProjection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, runNode),
        nodeUpsert(2, codeFile),
        edgeUpsert(3, edge({ id: "edge-run-code", sourceNodeId: runNode.id, targetNodeId: codeFile.id, kind: "touches" })),
      ],
    });

    const runTouchedReport = buildProductGraphHandoffReport(runTouchedProjection, {
      generatedAt: "2026-06-02T00:00:00.000Z",
    });
    expect(runTouchedReport.markdown).toContain("Code scan freshness: missing.");
    expect(runTouchedReport.markdown).toContain("No native codebase scan map is loaded.");
  });
});

describe("buildProductGraphTaskScopeGuide", () => {
  it("classifies runtime as backend source while separating frontend, extension, tests, provider, and handoff scopes", () => {
    expect(productGraphTaskScopeIdsForPath("packages/backend/src/runtime.ts")).toContain("backend-runtime");
    expect(productGraphTaskScopeIdsForPath("packages/backend/src/runner/runner.ts")).toContain("backend-runtime");
    expect(productGraphTaskScopeIdsForPath("packages/frontend/src/components/ProductGraphView.tsx")).toContain("frontend");
    expect(productGraphTaskScopeIdsForPath("packages/vscode-extension/src/extension.ts")).toContain("vscode-extension");
    expect(productGraphTaskScopeIdsForPath("packages/backend/src/runtime.test.ts")).toContain("tests");
    expect(productGraphTaskScopeIdsForPath("packages/backend/src/providers/openai.ts")).toContain("provider-ai");
    expect(productGraphTaskScopeIdsForPath("packages/backend/src/cli/handoff.ts")).toContain("handoff-docs");
  });

  it("keeps ambiguous route, index, and model paths out of unrelated scopes", () => {
    const backendRouteScopes = productGraphTaskScopeIdsForPath("packages/backend/src/routes/productGraph.ts");
    expect(backendRouteScopes).toContain("backend-runtime");
    expect(backendRouteScopes).not.toContain("frontend");

    const frontendIndexScopes = productGraphTaskScopeIdsForPath("packages/frontend/src/index.ts");
    expect(frontendIndexScopes).toContain("frontend");
    expect(frontendIndexScopes).not.toContain("backend-runtime");

    const rendererModelScopes = productGraphTaskScopeIdsForPath("desktop/src/renderer/lib/historyModels.ts");
    expect(rendererModelScopes).toContain("frontend");
    expect(rendererModelScopes).not.toContain("provider-ai");

    expect(productGraphTaskScopeIdsForPath("packages/backend/src/providers/ollama.ts")).toContain("provider-ai");
    expect(productGraphTaskScopeIdsForPath("packages/backend/src/ai/embeddings.ts")).toContain("provider-ai");
  });

  it("builds bounded scope guides without treating runtime as noise", () => {
    const runtimeFile = node({
      id: "file-runtime",
      kind: "code_file",
      title: "packages/backend/src/runtime.ts",
      body: "RUNTIME SOURCE BODY SHOULD NOT RENDER",
      source: { kind: "code_scan", label: "Code scan", path: "packages/backend/src/runtime.ts" },
      metadata: { scannerSourceFile: "packages/backend/src/runtime.ts" },
    });
    const providerFile = node({
      id: "file-provider",
      kind: "code_file",
      title: "packages/backend/src/providers/openai.ts",
      source: { kind: "code_scan", label: "Code scan", path: "packages/backend/src/providers/openai.ts" },
      metadata: { scannerSourceFile: "packages/backend/src/providers/openai.ts" },
    });
    const frontendFile = node({
      id: "file-frontend",
      kind: "code_file",
      title: "packages/frontend/src/components/ProductGraphView.tsx",
      source: { kind: "code_scan", label: "Code scan", path: "packages/frontend/src/components/ProductGraphView.tsx" },
      metadata: { scannerSourceFile: "packages/frontend/src/components/ProductGraphView.tsx" },
    });
    const extensionFile = node({
      id: "file-extension",
      kind: "code_file",
      title: "packages/vscode-extension/src/extension.ts",
      source: { kind: "code_scan", label: "Code scan", path: "packages/vscode-extension/src/extension.ts" },
      metadata: { scannerSourceFile: "packages/vscode-extension/src/extension.ts" },
    });
    const testFile = node({
      id: "file-test",
      kind: "code_file",
      title: "packages/backend/src/runtime.test.ts",
      source: { kind: "code_scan", label: "Code scan", path: "packages/backend/src/runtime.test.ts" },
      metadata: { scannerSourceFile: "packages/backend/src/runtime.test.ts" },
    });
    const handoffFile = node({
      id: "file-handoff",
      kind: "code_file",
      title: "packages/backend/src/cli/handoff.ts",
      source: { kind: "code_scan", label: "Code scan", path: "packages/backend/src/cli/handoff.ts" },
      metadata: { scannerSourceFile: "packages/backend/src/cli/handoff.ts" },
    });
    const runtimeCommunity = node({
      id: "community-runtime",
      kind: "code_community",
      title: "packages/backend",
      source: { kind: "code_scan", label: "Code scan", path: "packages/backend" },
      metadata: {
        scannerCommunityPath: "packages/backend",
        scannerCommunityFileCount: 4,
      },
    });
    const frontendCommunity = node({
      id: "community-frontend",
      kind: "code_community",
      title: "packages/frontend",
      source: { kind: "code_scan", label: "Code scan", path: "packages/frontend" },
      metadata: {
        scannerCommunityPath: "packages/frontend",
        scannerCommunityFileCount: 1,
      },
    });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, runtimeFile),
        nodeUpsert(2, providerFile),
        nodeUpsert(3, frontendFile),
        nodeUpsert(4, extensionFile),
        nodeUpsert(5, testFile),
        nodeUpsert(6, handoffFile),
        nodeUpsert(7, runtimeCommunity),
        nodeUpsert(8, frontendCommunity),
        edgeUpsert(9, edge({ id: "edge-runtime-community", sourceNodeId: runtimeFile.id, targetNodeId: runtimeCommunity.id, kind: "belongs_to" })),
        edgeUpsert(10, edge({ id: "edge-provider-community", sourceNodeId: providerFile.id, targetNodeId: runtimeCommunity.id, kind: "belongs_to" })),
        edgeUpsert(11, edge({ id: "edge-test-community", sourceNodeId: testFile.id, targetNodeId: runtimeCommunity.id, kind: "belongs_to" })),
        edgeUpsert(12, edge({ id: "edge-handoff-community", sourceNodeId: handoffFile.id, targetNodeId: runtimeCommunity.id, kind: "belongs_to" })),
        edgeUpsert(13, edge({ id: "edge-frontend-community", sourceNodeId: frontendFile.id, targetNodeId: frontendCommunity.id, kind: "belongs_to" })),
      ],
    });

    const guide = buildProductGraphTaskScopeGuide(projection, { fileLimit: 4, moduleLimit: 2 });
    const backendRuntime = guide.scopes.find((scope) => scope.id === "backend-runtime");
    const frontend = guide.scopes.find((scope) => scope.id === "frontend");
    const provider = guide.scopes.find((scope) => scope.id === "provider-ai");
    const extension = guide.scopes.find((scope) => scope.id === "vscode-extension");
    const tests = guide.scopes.find((scope) => scope.id === "tests");
    const handoffDocs = guide.scopes.find((scope) => scope.id === "handoff-docs");

    expect(backendRuntime?.recommendedFiles).toContain("packages/backend/src/runtime.ts");
    expect(backendRuntime?.topModules).toContain("packages/backend");
    expect(frontend?.recommendedFiles).toEqual(["packages/frontend/src/components/ProductGraphView.tsx"]);
    expect(provider?.recommendedFiles).toContain("packages/backend/src/providers/openai.ts");
    expect(extension?.recommendedFiles).toEqual(["packages/vscode-extension/src/extension.ts"]);
    expect(tests?.recommendedFiles).toContain("packages/backend/src/runtime.test.ts");
    expect(handoffDocs?.recommendedFiles).toContain("packages/backend/src/cli/handoff.ts");
    expect(buildProductGraphTaskScopeNodeIds(projection, "backend-runtime").has(runtimeFile.id)).toBe(true);
  });

  it("adds task scope guidance to handoff without source bodies or runtime risk language", () => {
    const runtimeFile = node({
      id: "file-runtime",
      kind: "code_file",
      title: "packages/backend/src/runtime.ts",
      body: "SECRET RUNTIME BODY",
      source: { kind: "code_scan", label: "Code scan", path: "packages/backend/src/runtime.ts" },
      metadata: { scannerSourceFile: "packages/backend/src/runtime.ts" },
    });
    const projection = projectProductGraph({
      productGraphId,
      events: [nodeUpsert(1, runtimeFile)],
    });

    const report = buildProductGraphHandoffReport(projection, {
      generatedAt: "2026-06-02T00:00:00.000Z",
    });

    expect(report.summary.taskScopeCount).toBeGreaterThan(0);
    expect(report.markdown).toContain("## Task Scope Guide");
    expect(report.markdown).toContain("Backend/runtime:");
    expect(report.markdown).toContain("runtime, runner, provider, database, and app lifecycle modules as backend/runtime source");
    expect(report.markdown).not.toContain("SECRET RUNTIME BODY");
    expect(report.markdown).not.toContain("runtime group is a caveat");
    expect(report.markdown).not.toContain("runtime group is a defect");
  });

  it("bounds long task scope file lists", () => {
    const events: ProductEvent[] = [];
    for (let index = 1; index <= 8; index += 1) {
      const file = node({
        id: `frontend-file-${index}`,
        kind: "code_file",
        title: `packages/frontend/src/file-${String(index).padStart(2, "0")}.tsx`,
        source: { kind: "code_scan", label: "Code scan", path: `packages/frontend/src/file-${String(index).padStart(2, "0")}.tsx` },
        metadata: { scannerSourceFile: `packages/frontend/src/file-${String(index).padStart(2, "0")}.tsx` },
      });
      events.push(nodeUpsert(index, file));
    }
    const projection = projectProductGraph({ productGraphId, events });

    const guide = buildProductGraphTaskScopeGuide(projection, { fileLimit: 3 });
    const frontend = guide.scopes.find((scope) => scope.id === "frontend");

    expect(frontend?.fileCount).toBe(8);
    expect(frontend?.recommendedFiles).toEqual([
      "packages/frontend/src/file-01.tsx",
      "packages/frontend/src/file-02.tsx",
      "packages/frontend/src/file-03.tsx",
    ]);
  });
});

describe("buildProductGraphTrace", () => {
  it("builds a bounded trace around a root node", () => {
    const requirement = node({ id: "requirement-1", kind: "requirement", title: "Show checkout status" });
    const taskNode = node({ id: "task-1", kind: "task", title: "Wire checkout panel" });
    const codeFile = node({ id: "file-1", kind: "code_file", title: "src/checkout.ts" });
    const testResult = node({ id: "test-1", kind: "test_result", title: "Checkout panel test" });
    const evidence = node({ id: "evidence-1", kind: "evidence", title: "Screenshot proof" });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, requirement),
        nodeUpsert(2, taskNode),
        nodeUpsert(3, codeFile),
        nodeUpsert(4, testResult),
        nodeUpsert(5, evidence),
        edgeUpsert(6, edge({ id: "edge-task", sourceNodeId: taskNode.id, targetNodeId: requirement.id, kind: "implements" })),
        edgeUpsert(7, edge({ id: "edge-code", sourceNodeId: taskNode.id, targetNodeId: codeFile.id, kind: "touches" })),
        edgeUpsert(8, edge({ id: "edge-test", sourceNodeId: testResult.id, targetNodeId: requirement.id, kind: "verifies" })),
        edgeUpsert(9, edge({ id: "edge-evidence", sourceNodeId: evidence.id, targetNodeId: testResult.id, kind: "produced_by" })),
      ],
    });

    const trace = buildProductGraphTrace({
      projection,
      rootNodeId: requirement.id,
      maxDepth: 2,
    });

    expect(trace?.rootNode.id).toBe(requirement.id);
    expect(trace?.nodes.map((item) => item.id)).toEqual([
      requirement.id,
      taskNode.id,
      testResult.id,
      evidence.id,
      codeFile.id,
    ]);
    expect(trace?.edges.map((item) => item.id)).toEqual([
      "edge-code",
      "edge-evidence",
      "edge-task",
      "edge-test",
    ]);
    expect(trace?.hopsByNodeId).toEqual({
      [requirement.id]: 0,
      [taskNode.id]: 1,
      [testResult.id]: 1,
      [codeFile.id]: 2,
      [evidence.id]: 2,
    });
    expect(trace?.summary).toMatchObject({
      nodeCount: 5,
      edgeCount: 4,
      maxDepth: 2,
      codeNodeCount: 1,
      testResultNodeCount: 1,
      evidenceNodeCount: 1,
    });
  });

  it("scopes returned node relationships to included trace edges and nodes", () => {
    const requirement = node({ id: "requirement-1", kind: "requirement", title: "Show checkout status" });
    const taskNode = node({ id: "task-1", kind: "task", title: "Wire checkout panel" });
    const codeFile = node({ id: "file-1", kind: "code_file", title: "src/checkout.ts" });
    const question = node({
      id: "question-1",
      kind: "open_question",
      title: "Who owns checkout copy?",
      status: "proposed",
    });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, requirement),
        nodeUpsert(2, taskNode),
        nodeUpsert(3, codeFile),
        nodeUpsert(4, question),
        edgeUpsert(5, edge({ id: "edge-task", sourceNodeId: taskNode.id, targetNodeId: requirement.id, kind: "implements" })),
        edgeUpsert(6, edge({ id: "edge-code", sourceNodeId: taskNode.id, targetNodeId: codeFile.id, kind: "touches" })),
        edgeUpsert(7, edge({ id: "edge-blocked", sourceNodeId: taskNode.id, targetNodeId: question.id, kind: "blocked_by" })),
      ],
    });

    const trace = buildProductGraphTrace({
      projection,
      rootNodeId: requirement.id,
      maxDepth: 1,
    });
    const traceTask = trace?.nodes.find((item) => item.id === taskNode.id);

    expect(trace?.nodes.map((item) => item.id)).toEqual([requirement.id, taskNode.id]);
    expect(trace?.edges.map((item) => item.id)).toEqual(["edge-task"]);
    expect(trace?.rootNode.incomingEdgeIds).toEqual(["edge-task"]);
    expect(traceTask?.outgoingEdgeIds).toEqual(["edge-task"]);
    expect(traceTask?.incomingEdgeIds).toEqual([]);
    expect(traceTask?.blockedByNodeIds).toEqual([]);
  });

  it("includes linked run evidence and changed files for task roots", () => {
    const taskNode = node({ id: "task-1", kind: "task", title: "Wire checkout panel" });
    const runNode = node({ id: "run-1", kind: "agent_run", title: "Checkout proof run", status: "completed" });
    const evidenceNode = node({ id: "evidence-1", kind: "evidence", title: "Checkout proof evidence" });
    const codeFile = node({ id: "file-1", kind: "code_file", title: "src/checkout.ts" });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, taskNode),
        nodeUpsert(2, runNode),
        nodeUpsert(3, evidenceNode),
        nodeUpsert(4, codeFile),
        edgeUpsert(5, edge({ id: "edge-task-run", sourceNodeId: taskNode.id, targetNodeId: runNode.id, kind: "produced_by" })),
        edgeUpsert(6, edge({ id: "edge-evidence-run", sourceNodeId: evidenceNode.id, targetNodeId: runNode.id, kind: "produced_by" })),
        edgeUpsert(7, edge({ id: "edge-run-file", sourceNodeId: runNode.id, targetNodeId: codeFile.id, kind: "touches" })),
      ],
    });

    const trace = buildProductGraphTrace({
      projection,
      rootNodeId: taskNode.id,
    });

    expect(trace?.nodes.map((item) => item.id)).toEqual([
      taskNode.id,
      runNode.id,
      evidenceNode.id,
      codeFile.id,
    ]);
    expect(trace?.edges.map((item) => item.id).sort()).toEqual([
      "edge-evidence-run",
      "edge-run-file",
      "edge-task-run",
    ]);
    expect(trace?.hopsByNodeId).toEqual({
      [taskNode.id]: 0,
      [runNode.id]: 1,
      [evidenceNode.id]: 2,
      [codeFile.id]: 2,
    });
    expect(trace?.summary).toMatchObject({
      nodeCount: 4,
      edgeCount: 3,
      maxDepth: 2,
      codeNodeCount: 1,
      testResultNodeCount: 0,
      evidenceNodeCount: 1,
    });
  });

  it("includes accepted plans and runs derived from those plans for task roots", () => {
    const taskNode = node({ id: "task-1", kind: "task", title: "Wire checkout panel" });
    const planNode = node({ id: "plan-1", kind: "plan", title: "Accepted checkout plan" });
    const runNode = node({ id: "run-1", kind: "agent_run", title: "Checkout proof run", status: "completed" });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, taskNode),
        nodeUpsert(2, planNode),
        nodeUpsert(3, runNode),
        edgeUpsert(4, edge({ id: "edge-plan-task", sourceNodeId: planNode.id, targetNodeId: taskNode.id, kind: "derived_from" })),
        edgeUpsert(5, edge({ id: "edge-task-run", sourceNodeId: taskNode.id, targetNodeId: runNode.id, kind: "produced_by" })),
        edgeUpsert(6, edge({ id: "edge-run-plan", sourceNodeId: runNode.id, targetNodeId: planNode.id, kind: "derived_from" })),
      ],
    });

    const trace = buildProductGraphTrace({
      projection,
      rootNodeId: taskNode.id,
    });
    const tracePlan = trace?.nodes.find((item) => item.id === planNode.id);
    const traceRun = trace?.nodes.find((item) => item.id === runNode.id);

    expect(trace?.nodes.map((item) => item.id)).toEqual([taskNode.id, planNode.id, runNode.id]);
    expect(trace?.edges.map((item) => item.id).sort()).toEqual([
      "edge-plan-task",
      "edge-run-plan",
      "edge-task-run",
    ]);
    expect(trace?.hopsByNodeId).toEqual({
      [taskNode.id]: 0,
      [planNode.id]: 1,
      [runNode.id]: 1,
    });
    expect(tracePlan?.incomingEdgeIds).toEqual(["edge-run-plan"]);
    expect(tracePlan?.outgoingEdgeIds).toEqual(["edge-plan-task"]);
    expect(traceRun?.incomingEdgeIds).toEqual(["edge-task-run"]);
    expect(traceRun?.outgoingEdgeIds).toEqual(["edge-run-plan"]);
  });

  it("keeps multiple accepted plan paths visible for the same linked run", () => {
    const taskNode = node({ id: "task-1", kind: "task", title: "Wire checkout panel" });
    const firstPlan = node({ id: "plan-1", kind: "plan", title: "Accepted checkout plan" });
    const secondPlan = node({ id: "plan-2", kind: "plan", title: "Accepted retry plan" });
    const runNode = node({ id: "run-1", kind: "agent_run", title: "Checkout proof run", status: "completed" });
    const projection = projectProductGraph({
      productGraphId,
      events: [
        nodeUpsert(1, taskNode),
        nodeUpsert(2, firstPlan),
        nodeUpsert(3, secondPlan),
        nodeUpsert(4, runNode),
        edgeUpsert(5, edge({ id: "edge-plan-1-task", sourceNodeId: firstPlan.id, targetNodeId: taskNode.id, kind: "derived_from" })),
        edgeUpsert(6, edge({ id: "edge-plan-2-task", sourceNodeId: secondPlan.id, targetNodeId: taskNode.id, kind: "derived_from" })),
        edgeUpsert(7, edge({ id: "edge-task-run", sourceNodeId: taskNode.id, targetNodeId: runNode.id, kind: "produced_by" })),
        edgeUpsert(8, edge({ id: "edge-run-plan-1", sourceNodeId: runNode.id, targetNodeId: firstPlan.id, kind: "derived_from" })),
        edgeUpsert(9, edge({ id: "edge-run-plan-2", sourceNodeId: runNode.id, targetNodeId: secondPlan.id, kind: "derived_from" })),
      ],
    });

    const trace = buildProductGraphTrace({
      projection,
      rootNodeId: taskNode.id,
    });
    const traceFirstPlan = trace?.nodes.find((item) => item.id === firstPlan.id);
    const traceSecondPlan = trace?.nodes.find((item) => item.id === secondPlan.id);
    const traceRun = trace?.nodes.find((item) => item.id === runNode.id);

    expect(trace?.nodes.map((item) => item.id)).toEqual([taskNode.id, firstPlan.id, secondPlan.id, runNode.id]);
    expect(trace?.edges.map((item) => item.id).sort()).toEqual([
      "edge-plan-1-task",
      "edge-plan-2-task",
      "edge-run-plan-1",
      "edge-run-plan-2",
      "edge-task-run",
    ]);
    expect(trace?.hopsByNodeId).toEqual({
      [taskNode.id]: 0,
      [firstPlan.id]: 1,
      [secondPlan.id]: 1,
      [runNode.id]: 1,
    });
    expect(traceFirstPlan?.incomingEdgeIds).toEqual(["edge-run-plan-1"]);
    expect(traceFirstPlan?.outgoingEdgeIds).toEqual(["edge-plan-1-task"]);
    expect(traceSecondPlan?.incomingEdgeIds).toEqual(["edge-run-plan-2"]);
    expect(traceSecondPlan?.outgoingEdgeIds).toEqual(["edge-plan-2-task"]);
    expect(traceRun?.incomingEdgeIds).toEqual(["edge-task-run"]);
    expect(traceRun?.outgoingEdgeIds).toEqual(["edge-run-plan-1", "edge-run-plan-2"]);
    expect(trace?.summary).toMatchObject({
      nodeCount: 4,
      edgeCount: 5,
      maxDepth: 2,
    });
  });

  it("returns undefined for a missing trace root", () => {
    const projection = projectProductGraph({
      productGraphId,
      events: [nodeUpsert(1, node({ id: "task-1", kind: "task", title: "Wire checkout panel" }))],
    });

    expect(buildProductGraphTrace({ projection, rootNodeId: "missing-node" })).toBeUndefined();
  });
});
