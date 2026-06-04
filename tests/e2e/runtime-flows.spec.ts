import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

type ApiHandler = (route: Route) => Promise<void> | void;

function now() {
  return "2026-04-17T12:00:00.000Z";
}

function makeDashboardItem(overrides: Record<string, unknown> = {}) {
  return {
    graphId: "graph-1",
    goalTitle: "Approve schema rollout",
    lifecycleBucket: "active",
    graphStatus: "running",
    runControlState: "running",
    frontierStatus: "on_track",
    needsHumanReview: false,
    approvalState: "not_requested",
    waitingForApproval: false,
    latestDecisionSummary: "",
    lineageSummary: "Planner v1, executor v1.",
    latestNotificationSummary: "Everything is on track.",
    alertCount: 0,
    highestAlertSeverity: "info",
    completedNodeCount: 2,
    plannedNodeCount: 5,
    passRate: 1,
    revisionRate: 0,
    evidenceCoverageRate: 0.8,
    lastEventAt: now(),
    lastEventSequence: 12,
    latestCompletedNodeSummary: "Checked the workspace and prepared the next step.",
    changesSinceLastViewed: {
      lastSeenSequence: 10,
      currentSequence: 12,
      newEventCount: 2,
      runControlStateChanged: false,
      frontierStatusChanged: false,
      newAlertsAppeared: false,
      changesSinceLastViewedSummary: "2 new events occurred since you last opened this run.",
    },
    attentionScore: 120,
    attentionLabel: "urgent",
    ...overrides,
  };
}

function makeProductGraphProjection() {
  return {
    schemaVersion: "1",
    productGraphId: "default",
    nodes: [
      {
        id: "feature:checkout-visibility",
        kind: "feature",
        title: "Checkout visibility",
        summary: "Show where checkout work stands before implementation.",
        status: "planned",
        tags: ["checkout"],
        createdAt: now(),
        updatedAt: now(),
        incomingEdgeIds: ["edge-story-feature"],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      },
      {
        id: "story:operator-sees-checkout",
        kind: "user_story",
        title: "Operator sees checkout status",
        summary: "As an operator, I can see the checkout plan before agents edit code.",
        status: "planned",
        tags: ["operator"],
        createdAt: now(),
        updatedAt: now(),
        incomingEdgeIds: [],
        outgoingEdgeIds: ["edge-story-feature"],
        blockedByNodeIds: [],
      },
      {
        id: "task:checkout-status-panel",
        kind: "task",
        title: "Wire checkout status panel",
        summary: "Implement the operator-facing checkout status panel once ownership is clear.",
        status: "planned",
        tags: ["operator"],
        createdAt: now(),
        updatedAt: now(),
        incomingEdgeIds: [],
        outgoingEdgeIds: ["edge-task-question", "edge-task-symbol"],
        blockedByNodeIds: ["question:payment-owner"],
      },
      {
        id: "symbol:checkout-controller",
        kind: "code_symbol",
        title: "CheckoutController",
        summary: "Native codebase scan symbol for the checkout status work.",
        status: "planned",
        tags: ["code-scan", "checkout"],
        source: {
          kind: "code_scan",
          label: "Codebase scan",
          path: "src/checkout.ts",
          line: 42,
        },
        metadata: {
          scannerSourceFile: "src/checkout.ts",
          scannerSymbolName: "CheckoutController",
          scannerSymbolKind: "class",
        },
        createdAt: now(),
        updatedAt: now(),
        incomingEdgeIds: ["edge-task-symbol"],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      },
      {
        id: "question:payment-owner",
        kind: "open_question",
        title: "Who owns payment copy?",
        status: "proposed",
        createdAt: now(),
        updatedAt: now(),
        incomingEdgeIds: ["edge-task-question"],
        outgoingEdgeIds: [],
        blockedByNodeIds: [],
      },
    ],
    edges: [
      {
        id: "edge-story-feature",
        sourceNodeId: "story:operator-sees-checkout",
        targetNodeId: "feature:checkout-visibility",
        kind: "belongs_to",
        trust: "manual",
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: "edge-task-question",
        sourceNodeId: "task:checkout-status-panel",
        targetNodeId: "question:payment-owner",
        kind: "blocked_by",
        trust: "manual",
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: "edge-task-symbol",
        sourceNodeId: "task:checkout-status-panel",
        targetNodeId: "symbol:checkout-controller",
        kind: "touches",
        label: "Likely code area",
        trust: "ambiguous",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    events: [],
    summary: {
      nodeCount: 5,
      edgeCount: 3,
      nodesByKind: {
        feature: 1,
        user_story: 1,
        task: 1,
        open_question: 1,
        code_symbol: 1,
      },
      edgesByKind: {
        belongs_to: 1,
        blocked_by: 1,
        touches: 1,
      },
      unresolvedOpenQuestionCount: 1,
      blockedTaskCount: 1,
    },
  };
}

function addAcceptanceEvidenceGap(productGraphProjection: ReturnType<typeof makeProductGraphProjection>) {
  const criterionNode = {
    id: "criterion:tax-copy-approved",
    kind: "acceptance_criterion",
    title: "Tax copy has owner approval",
    status: "planned",
    createdAt: now(),
    updatedAt: now(),
    incomingEdgeIds: [],
    outgoingEdgeIds: ["edge-criterion-tax-feature"],
    blockedByNodeIds: [],
  };
  const criterionEdge = {
    id: "edge-criterion-tax-feature",
    sourceNodeId: criterionNode.id,
    targetNodeId: "feature:checkout-visibility",
    kind: "satisfies",
    label: "Criterion satisfies feature",
    trust: "manual",
    createdAt: now(),
    updatedAt: now(),
  };

  productGraphProjection.nodes.push(criterionNode as (typeof productGraphProjection.nodes)[number]);
  productGraphProjection.edges.push(criterionEdge as (typeof productGraphProjection.edges)[number]);
  productGraphProjection.nodes
    .find((node) => node.id === "feature:checkout-visibility")
    ?.incomingEdgeIds.push(criterionEdge.id);
  productGraphProjection.summary.nodeCount = productGraphProjection.nodes.length;
  productGraphProjection.summary.edgeCount = productGraphProjection.edges.length;
  (productGraphProjection.summary.nodesByKind as Record<string, number>).acceptance_criterion = 1;
  (productGraphProjection.summary.edgesByKind as Record<string, number>).satisfies = 1;
}

function completeCheckoutTaskWithoutRun(productGraphProjection: ReturnType<typeof makeProductGraphProjection>) {
  const taskNode = productGraphProjection.nodes.find((node) => node.id === "task:checkout-status-panel");
  if (!taskNode) return;

  taskNode.status = "completed";
  taskNode.blockedByNodeIds = [];
  productGraphProjection.summary.blockedTaskCount = 0;
}

function makeNode(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `node-${index}`,
    graphId: "graph-launch",
    kind: "work",
    title: `Step ${index}`,
    intent: `Complete step ${index}`,
    humanSummary: `Step ${index} is helping the run move forward.`,
    status: index === 1 ? "running" : index < 20 ? "completed" : "ready",
    contract: {
      expectedArtifact: `Artifact ${index}`,
      allowedTools: ["readFile"],
      acceptanceCriteria: [`Finish step ${index}`],
      humanSummary: `Complete step ${index}`,
    },
    evidenceSummary: "The step recorded safe evidence for the current workspace.",
    evaluation: {
      llmPassed: true,
      deterministicPassed: true,
      passed: true,
      driftScore: 0.95,
      baselineDriftScore: 0.95,
      direction: "closer",
      humanSummary: "The run is still moving toward the goal.",
      suggestedAction: "complete",
      findings: [],
      ruleViolations: [],
    },
    baselineGoalVersionId: "goal-1",
    activeGoalVersionId: "goal-1",
    dependsOnNodeIds: index > 1 ? [`node-${index - 1}`] : [],
    coordinates: {
      depth: index,
      abstractionLevel: index % 4,
      driftDistance: 0,
    },
    createdAt: now(),
    updatedAt: now(),
    completedAt: index < 20 ? now() : undefined,
    ...overrides,
  };
}

function makeProjection(nodeCount = 181) {
  const nodes = Array.from({ length: nodeCount }, (_, offset) => makeNode(offset + 1));
  const edges = nodes.slice(1).map((node, offset) => ({
    id: `edge-${offset + 2}`,
    graphId: "graph-launch",
    sourceNodeId: `node-${offset + 1}`,
    targetNodeId: node.id,
    kind: "depends_on",
    createdAt: now(),
  }));

  return {
    graph: {
      id: "graph-launch",
      title: "Launch graph",
      goal: "Validate the launch graph.",
      status: "running",
      originalGoalVersionId: "goal-1",
      activeGoalVersionId: "goal-1",
      createdAt: now(),
      updatedAt: now(),
    },
    currentActor: {
      actorId: "operator-1",
      displayName: "Priya Operator",
      role: "operator",
    },
    capabilities: {
      canAnnotate: true,
      canRequestReview: true,
      canRequestApproval: true,
      canApprove: true,
      canReject: true,
      canContinue: true,
    },
    goalPackets: [
      {
        id: "goal-1",
        version: 1,
        originalText: "Validate the launch graph.",
        successCriteria: ["Keep the launch graph healthy."],
        forbiddenScope: [],
        embedding: [],
        criteriaEmbeddings: [],
        createdAt: now(),
      },
    ],
    nodes,
    edges,
    events: [
      {
        id: "goal-event-1",
        graphId: "graph-launch",
        kind: "goal.version_created",
        goalVersionId: "goal-1",
        payload: {
          graphTitle: "Launch graph",
          goal: "Validate the launch graph.",
          goalPacket: {
            id: "goal-1",
            version: 1,
            originalText: "Validate the launch graph.",
            successCriteria: ["Keep the launch graph healthy."],
            forbiddenScope: [],
            embedding: [],
            criteriaEmbeddings: [],
            createdAt: now(),
          },
          activate: true,
        },
        ts: now(),
        seq: 1,
      },
    ],
    driftState: "healthy",
    driftSummary: "The run is staying close to the launch goal.",
    currentDriftSummary: "The run is staying close to the launch goal.",
    frontierStatus: "on_track",
    runControlState: "running",
    canResume: false,
    canPause: true,
    canStop: true,
    approvalState: "not_requested",
    waitingForApproval: false,
    latestDecisionSummary: "",
    needsHumanReview: false,
    graphAnnotations: [],
    annotationCount: 0,
    latestAnnotationSummary: "",
    peopleSummary: "Priya Operator is supervising the run.",
    lineageDescriptors: [],
    lineageCount: 0,
    lineageSummary: "Planner v1, executor v1.",
    plannedNodeCount: nodeCount,
    completedNodeCount: 19,
    failedNodeCount: 0,
    supersededNodeCount: 0,
    revisedNodeCount: 0,
    passRate: 1,
    revisionRate: 0,
    driftTrend: "steady",
    evidenceCoverageRate: 0.82,
    runHealthSummary: "Run details are ready.",
    alerts: [],
    latestNotificationSummary: "The launch graph is moving normally.",
    changesSinceLastViewed: {
      lastSeenSequence: 0,
      currentSequence: 1,
      newEventCount: 1,
      runControlStateChanged: false,
      frontierStatusChanged: false,
      newAlertsAppeared: false,
      changesSinceLastViewedSummary: "1 new event occurred since you last opened this run.",
    },
  };
}

function makeControlProjection() {
  const nodes = [
    makeNode(1, {
      id: "node-control-1",
      graphId: "graph-control",
      title: "Inspect launch state",
      status: "completed",
      completedAt: now(),
    }),
    makeNode(2, {
      id: "node-control-2",
      graphId: "graph-control",
      title: "Pause-sensitive step",
      status: "running",
    }),
    makeNode(3, {
      id: "node-control-3",
      graphId: "graph-control",
      title: "Final decision step",
      status: "ready",
    }),
  ];

  const edges = [
    {
      id: "edge-control-2",
      graphId: "graph-control",
      sourceNodeId: "node-control-1",
      targetNodeId: "node-control-2",
      kind: "depends_on",
      createdAt: now(),
    },
    {
      id: "edge-control-3",
      graphId: "graph-control",
      sourceNodeId: "node-control-2",
      targetNodeId: "node-control-3",
      kind: "depends_on",
      createdAt: now(),
    },
  ];

  return {
    graph: {
      id: "graph-control",
      title: "Operator control graph",
      goal: "Validate operator controls.",
      status: "running",
      originalGoalVersionId: "goal-control",
      activeGoalVersionId: "goal-control",
      createdAt: now(),
      updatedAt: now(),
    },
    currentActor: {
      actorId: "operator-1",
      displayName: "Priya Operator",
      role: "operator",
    },
    capabilities: {
      canAnnotate: true,
      canRequestReview: true,
      canRequestApproval: true,
      canApprove: true,
      canReject: true,
      canContinue: true,
    },
    goalPackets: [
      {
        id: "goal-control",
        version: 1,
        originalText: "Validate operator controls.",
        successCriteria: ["Operator controls respond in the browser UI."],
        forbiddenScope: [],
        embedding: [],
        criteriaEmbeddings: [],
        createdAt: now(),
      },
    ],
    nodes,
    edges,
    events: [
      {
        id: "goal-control-1",
        graphId: "graph-control",
        kind: "goal.version_created",
        goalVersionId: "goal-control",
        payload: {
          graphTitle: "Operator control graph",
          goal: "Validate operator controls.",
          goalPacket: {
            id: "goal-control",
            version: 1,
            originalText: "Validate operator controls.",
            successCriteria: ["Operator controls respond in the browser UI."],
            forbiddenScope: [],
            embedding: [],
            criteriaEmbeddings: [],
            createdAt: now(),
          },
          activate: true,
        },
        ts: now(),
        seq: 1,
      },
      {
        id: "run-control-1",
        graphId: "graph-control",
        kind: "run.started",
        payload: {
          workspaceRoot: "<workspace>",
          goalVersionId: "goal-control",
        },
        ts: now(),
        seq: 2,
      },
      {
        id: "node-planned-1",
        graphId: "graph-control",
        kind: "node.planned",
        nodeId: "node-control-2",
        payload: {
          title: "Pause-sensitive step",
        },
        ts: now(),
        seq: 3,
      },
      {
        id: "node-executing-1",
        graphId: "graph-control",
        kind: "node.executing",
        nodeId: "node-control-2",
        payload: {
          title: "Pause-sensitive step",
        },
        ts: now(),
        seq: 4,
      },
    ],
    driftState: "healthy",
    driftSummary: "The run is staying close to the operator-control goal.",
    currentDriftSummary: "The run is staying close to the operator-control goal.",
    frontierStatus: "on_track",
    runControlState: "running",
    canResume: false,
    canPause: true,
    canStop: true,
    approvalState: "not_requested",
    waitingForApproval: false,
    latestDecisionSummary: "",
    needsHumanReview: false,
    graphAnnotations: [],
    annotationCount: 0,
    latestAnnotationSummary: "",
    peopleSummary: "Priya Operator is supervising the run.",
    lineageDescriptors: [],
    lineageCount: 0,
    lineageSummary: "Planner v1, executor v1.",
    plannedNodeCount: 3,
    completedNodeCount: 1,
    failedNodeCount: 0,
    supersededNodeCount: 0,
    revisedNodeCount: 0,
    passRate: 1,
    revisionRate: 0,
    driftTrend: "steady",
    evidenceCoverageRate: 0.8,
    runHealthSummary: "Run details are ready.",
    alerts: [],
    latestNotificationSummary: "The operator control graph is active.",
    changesSinceLastViewed: {
      lastSeenSequence: 0,
      currentSequence: 4,
      newEventCount: 4,
      runControlStateChanged: false,
      frontierStatusChanged: false,
      newAlertsAppeared: false,
      changesSinceLastViewedSummary: "4 new events occurred since you last opened this run.",
    },
  };
}

function makeDashboardItemFromProjection(projection: ReturnType<typeof makeControlProjection>) {
  return makeDashboardItem({
    graphId: projection.graph.id,
    goalTitle: projection.graph.title,
    graphStatus: projection.graph.status,
    runControlState: projection.runControlState,
    frontierStatus: projection.frontierStatus,
    approvalState: projection.approvalState,
    waitingForApproval: projection.waitingForApproval,
    latestDecisionSummary: projection.latestDecisionSummary,
    latestNotificationSummary: projection.latestNotificationSummary,
    completedNodeCount: projection.completedNodeCount,
    plannedNodeCount: projection.plannedNodeCount,
    passRate: projection.passRate,
    revisionRate: projection.revisionRate,
    evidenceCoverageRate: projection.evidenceCoverageRate,
    lastEventSequence: projection.events.at(-1)?.seq ?? 0,
    latestCompletedNodeSummary: projection.nodes[0]?.humanSummary,
    changesSinceLastViewed: projection.changesSinceLastViewed,
    attentionScore: 80,
    attentionLabel: "high",
  });
}

async function installEventSourceStub(page: Page) {
  await page.addInitScript(() => {
    const sources: MockEventSource[] = [];

    class MockEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        this.url = String(url);
        sources.push(this);
        queueMicrotask(() => {
          this.onopen?.(new Event("open"));
        });
      }

      addEventListener() {
        return undefined;
      }

      removeEventListener() {
        return undefined;
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as unknown as typeof window.EventSource;
    (window as Window & { __openagentgraphEmitEvent?: (event: unknown) => void }).__openagentgraphEmitEvent = (event) => {
      for (const source of sources) {
        source.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify(event),
          })
        );
      }
    };
  });
}

async function emitGraphEvent(page: Page, event: unknown) {
  await page.evaluate((input) => {
    (window as Window & { __openagentgraphEmitEvent?: (event: unknown) => void }).__openagentgraphEmitEvent?.(input);
  }, event);
}

async function routeApi(page: Page, handlers: Record<string, ApiHandler>) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname.startsWith("/api/")
      ? url.pathname === "/api"
        ? "/"
        : url.pathname.slice(4)
      : url.pathname;
    const handler =
      handlers[key] ??
      Object.entries(handlers).find(([pattern]) => pattern.endsWith("*") && key.startsWith(pattern.slice(0, -1)))?.[1];

    if (!handler) {
      await route.continue();
      return;
    }

    await handler(route);
  });
}

async function pressButton(page: Page, button: Locator) {
  await button.focus();
  await page.keyboard.press("Enter");
}

async function expectMultipleAcceptedPlanRunTrace(traceabilityGroup: Locator) {
  await expect(traceabilityGroup).toContainText("7 nodes");
  await expect(traceabilityGroup).toContainText("8 links");
  await expect(traceabilityGroup).toContainText("2 code");
  await expect(traceabilityGroup).toContainText("1 evidence");

  const firstPlanNode = traceabilityGroup.getByRole("button", {
    name: "Focus Codex plan for Wire checkout status panel trace node",
  });
  const retryPlanNode = traceabilityGroup.getByRole("button", {
    name: "Focus Retry Codex plan for Wire checkout status panel trace node",
  });
  const runNode = traceabilityGroup.getByRole("button", { name: "Focus Checkout proof run trace node" });

  await expect(firstPlanNode).toContainText("plan - 1 hops");
  await expect(firstPlanNode).toContainText("Plan derived from task / Run derived from plan");
  await expect(retryPlanNode).toContainText("plan - 1 hops");
  await expect(retryPlanNode).toContainText("Retry plan derived from task / Run derived from plan");
  await expect(runNode).toContainText("Task produced by run / Run derived from plan / Run derived from plan");
}

test.describe("OpenAgentGraph launch-critical browser flows", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:4173",
    });
    await installEventSourceStub(page);
  });

  test("loads a healthy signed-in dashboard and keeps similar/comparison flows usable", async ({ page }) => {
    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/provider/config": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            configured: true,
            provider: "openai",
            source: "environment",
            model: "gpt-4o",
            message: "OpenAI provider is configured.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [
              makeDashboardItem(),
              makeDashboardItem({
                graphId: "graph-2",
                goalTitle: "Review security hardening",
                latestNotificationSummary: "A reviewer decision is waiting.",
                attentionScore: 85,
                attentionLabel: "high",
                needsHumanReview: true,
                waitingForApproval: true,
                approvalState: "requested",
                frontierStatus: "blocked",
                runControlState: "paused",
              }),
            ],
            summary: {
              urgentRunCount: 1,
              needsReviewCount: 1,
              blockedRunCount: 1,
              activeRunCount: 2,
              archivedRunCount: 0,
            },
          }),
        }),
      "/graphs/graph-1/similar": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              graphId: "graph-9",
              goalTitle: "Past schema rollout",
              similarityScore: 0.9,
              lifecycleBucket: "completed_recent",
              frontierStatus: "on_track",
              latestNotificationSummary: "This earlier rollout completed cleanly.",
              latestCompletedNodeSummary: "Validated migration timing.",
            },
          ]),
        }),
      "/graphs/compare": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            summary: "The current rollout is slightly behind the earlier run.",
            left: {
              graphId: "graph-1",
              goalTitle: "Approve schema rollout",
              graphStatus: "running",
              frontierStatus: "on_track",
              runControlState: "running",
              approvalState: "not_requested",
              waitingForApproval: false,
              plannedNodeCount: 5,
              completedNodeCount: 2,
              passRate: 1,
              revisionRate: 0,
              evidenceCoverageRate: 0.8,
              driftTrend: "steady",
              needsHumanReview: false,
              latestNotificationSummary: "Everything is on track.",
              lineageSummary: "Planner v1, executor v1.",
            },
            right: {
              graphId: "graph-9",
              goalTitle: "Past schema rollout",
              graphStatus: "completed",
              frontierStatus: "on_track",
              runControlState: "idle",
              approvalState: "approved",
              waitingForApproval: false,
              plannedNodeCount: 5,
              completedNodeCount: 5,
              passRate: 1,
              revisionRate: 0,
              evidenceCoverageRate: 0.95,
              driftTrend: "steady",
              needsHumanReview: false,
              latestNotificationSummary: "The earlier rollout completed cleanly.",
              lineageSummary: "Planner v1, executor v1.",
            },
          }),
        }),
    });

    await page.goto("/");

    await expect(page.getByRole("button", { name: /Approve schema rollout/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Review security hardening/i })).toBeVisible();
    await expect(page.getByText("Signed in as Priya Operator with operator access.")).toBeVisible();

    await page.getByRole("button", { name: /^Similar runs$/ }).first().click();
    await expect(page.getByText("Similar past runs").first()).toBeVisible();
    await expect(page.getByText("90% similar")).toBeVisible();

    await page.getByRole("button", { name: "Compare with similar run" }).click();
    await expect(page.getByText("The current rollout is slightly behind the earlier run.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close comparison" })).toBeVisible();
  });

  test("shows a calm degraded read-only onboarding state when the backend is limited", async ({ page }) => {
    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "degraded",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: {
                status: "degraded",
                message: "OpenAI provider is not configured; goal execution is unavailable.",
                details: [
                  "Set OPENAI_API_KEY in the backend environment.",
                  "Restart the backend process so it can read the updated provider configuration.",
                  "Refresh provider status in OpenAgentGraph before starting the goal run.",
                ],
              },
              workspace: { status: "ok", message: "Workspace root is optional and not configured." },
              frontend: { status: "ok", message: "Frontend origin policy uses local development defaults." },
              auth: { status: "ok", message: "Actor auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "anonymous",
            message: "This environment allows viewing, but protected actions require sign-in.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
    });

    await page.goto("/");

    await expect(page.getByText("Read-only mode")).toBeVisible();
    await expect(page.getByText("You can view this workspace, but protected actions require sign-in.")).toBeVisible();
    await expect(
      page.locator("text=OpenAI provider is not configured; goal execution is unavailable.").first()
    ).toBeVisible();
    await expect(page.getByText("Set OPENAI_API_KEY in the backend environment.").first()).toBeVisible();
    await expect(page.getByText("What you are seeing")).toBeVisible();
  });

  test("opens the intent graph view and renders product graph nodes", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    addAcceptanceEvidenceGap(productGraphProjection);
    const createNodeRequests: unknown[] = [];
    const createEdgeRequests: unknown[] = [];
    const createBundleRequests: unknown[] = [];
    const linkRunRequests: unknown[] = [];
    const traceRequests: string[] = [];
    const codexPlanRequests: string[] = [];
    const acceptCodexPlanRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const initialCodexPlanPrompt =
      "You are Codex working from OpenAgentGraph product graph context.\n## Current task\n- [task] Wire checkout status panel (task:checkout-status-panel)";
    const retryCodexPlanPrompt = `${initialCodexPlanPrompt}\n\n## Retry context\n- Reconcile the accepted plan with the completed run trace.`;
    let latestLoadedCodexPlanPrompt = initialCodexPlanPrompt;

    function hasAcceptedInitialCodexPlan() {
      return productGraphProjection.nodes.some((node) => node.id === "plan:codex:checkout-status-panel");
    }

    function nextCodexPlanPrompt() {
      return hasAcceptedInitialCodexPlan() ? retryCodexPlanPrompt : initialCodexPlanPrompt;
    }

    function makeAcceptedCodexPlanFixture(promptHash: unknown) {
      const acceptedPlanPrompt = latestLoadedCodexPlanPrompt;
      const isRetryPlan = acceptedPlanPrompt === retryCodexPlanPrompt;
      const acceptedPlanNode = {
        id: isRetryPlan ? "plan:codex:checkout-status-panel-retry" : "plan:codex:checkout-status-panel",
        kind: "plan",
        title: isRetryPlan
          ? "Retry Codex plan for Wire checkout status panel"
          : "Codex plan for Wire checkout status panel",
        summary: isRetryPlan
          ? "Accepted retry Codex planning prompt for Wire checkout status panel."
          : "Accepted Codex planning prompt for Wire checkout status panel.",
        body: acceptedPlanPrompt,
        status: "planned",
        tags: ["codex", "planning"],
        metadata: {
          taskNodeId: "task:checkout-status-panel",
          promptHash,
        },
        createdAt: now(),
        updatedAt: now(),
      };
      const acceptedPlanEdge = {
        id: isRetryPlan ? "edge-codex-plan-retry-checkout-status-panel" : "edge-codex-plan-checkout-status-panel",
        sourceNodeId: acceptedPlanNode.id,
        targetNodeId: "task:checkout-status-panel",
        kind: "derived_from",
        trust: "manual",
        label: isRetryPlan ? "Retry plan derived from task" : "Plan derived from task",
        createdAt: now(),
        updatedAt: now(),
      };

      return { node: acceptedPlanNode, edge: acceptedPlanEdge };
    }

    function acceptedPlanTaskEdgeFor(planNodeId: string, taskNodeId: unknown) {
      return productGraphProjection.edges.find(
        (edge) =>
          edge.kind === "derived_from" && edge.sourceNodeId === planNodeId && edge.targetNodeId === taskNodeId
      );
    }

    function isAcceptedCodexPlanForTask(node: (typeof productGraphProjection.nodes)[number], taskNodeId: unknown) {
      return (
        node.kind === "plan" &&
        node.tags?.includes("codex") &&
        (node.metadata?.taskNodeId === taskNodeId || Boolean(acceptedPlanTaskEdgeFor(node.id, taskNodeId)))
      );
    }

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/provider/config": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            configured: true,
            provider: "openai",
            source: "environment",
            model: "gpt-4o",
            message: "OpenAI provider is configured.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [
              makeDashboardItem({
                graphId: "graph:checkout-proof",
                goalTitle: "Checkout proof run",
                lifecycleBucket: "completed_recent",
                graphStatus: "completed",
                runControlState: "idle",
                attentionLabel: "low",
                attentionScore: 15,
              }),
              makeDashboardItem({
                graphId: "graph:checkout-proof-2",
                goalTitle: "Second checkout proof",
                lifecycleBucket: "completed_recent",
                graphStatus: "completed",
                runControlState: "idle",
                attentionLabel: "low",
                attentionScore: 10,
              }),
            ],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 2,
            },
          }),
        }),
      "/graphs/*": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            graphId: "graph:checkout-proof",
            summary: {
              runControlState: "idle",
              frontierStatus: "on_track",
              readyCount: 0,
              runningCount: 0,
              blockedCount: 0,
              openProposalCount: 0,
            },
            frontier: [],
            recentAgentActivity: [],
            planProposals: [],
          }),
        }),
      "/product-graph": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        }),
      "/product-graph/handoff": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            markdown: "# OpenAgentGraph Handoff\n\nE2E fixture handoff.",
            summary: {
              nodeCount: productGraphProjection.summary.nodeCount,
              edgeCount: productGraphProjection.summary.edgeCount,
              codeFileCount: 1,
              codeSymbolCount: 1,
              taskScopeCount: 1,
              riskCount: 0,
              recommendedReadCount: 1,
              generatedAt: now(),
              productGraphId: productGraphProjection.productGraphId,
              workspaceRoot: "C:\\OpenAgentGraph\\e2e-workspace",
              workspaceRootSource: "configured",
              latestCodeScanUpdatedAt: now(),
              semanticAnalysisSucceeded: true,
              semanticResolutionCount: 1,
              semanticEdgeCount: 1,
              workspacePathCheck: {
                checkedFileCount: 1,
                missingFileCount: 0,
                status: "aligned",
              },
              handoffFile: {
                path: "GRAPH_REPORT.md",
                exists: true,
                updatedAt: now(),
              },
            },
          }),
        }),
      "/product-graph/codex-plan/*": (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === "POST" && url.pathname.endsWith("/accept")) {
          const body = route.request().postDataJSON() as Record<string, unknown>;
          acceptCodexPlanRequests.push({ path: url.pathname, body });
          const acceptedPlan = makeAcceptedCodexPlanFixture(body.promptHash);
          const acceptedPlanNode = acceptedPlan.node;
          const acceptedPlanEdge = acceptedPlan.edge;
          if (!productGraphProjection.nodes.some((node) => node.id === acceptedPlanNode.id)) {
            productGraphProjection.nodes.push({
              ...acceptedPlanNode,
              incomingEdgeIds: [],
              outgoingEdgeIds: [acceptedPlanEdge.id],
              blockedByNodeIds: [],
            });
          }
          if (!productGraphProjection.edges.some((edge) => edge.id === acceptedPlanEdge.id)) {
            productGraphProjection.edges.push(acceptedPlanEdge);
            productGraphProjection.nodes
              .find((node) => node.id === acceptedPlanEdge.targetNodeId)
              ?.incomingEdgeIds.push(acceptedPlanEdge.id);
          }
          productGraphProjection.summary = {
            ...productGraphProjection.summary,
            nodeCount: productGraphProjection.nodes.length,
            edgeCount: productGraphProjection.edges.length,
            nodesByKind: {
              ...productGraphProjection.summary.nodesByKind,
              plan: productGraphProjection.nodes.filter((node) => node.kind === "plan").length,
            },
            edgesByKind: {
              ...productGraphProjection.summary.edgesByKind,
              derived_from: productGraphProjection.edges.filter((edge) => edge.kind === "derived_from").length,
            },
          };
          return route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({ node: acceptedPlanNode, edge: acceptedPlanEdge }),
          });
        }
        codexPlanRequests.push(url.pathname);
        const taskNode = productGraphProjection.nodes.find((node) => node.id === "task:checkout-status-panel")!;
        const featureNode = productGraphProjection.nodes.find((node) => node.id === "feature:checkout-visibility")!;
        const criterionNode = productGraphProjection.nodes.find((node) => node.id === "criterion:tax-copy-approved")!;
        const questionNode = productGraphProjection.nodes.find((node) => node.id === "question:payment-owner")!;
        const codeNode = productGraphProjection.nodes.find((node) => node.id === "symbol:checkout-controller")!;
        const codeEdge = productGraphProjection.edges.find((item) => item.id === "edge-task-symbol")!;
        latestLoadedCodexPlanPrompt = nextCodexPlanPrompt();
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            taskNode,
            intentNodes: [featureNode],
            acceptanceCriteria: [criterionNode],
            likelyCodeAreas: [{ node: codeNode, edge: codeEdge }],
            openQuestions: [questionNode],
            risks: ["Some code links are inferred or ambiguous; confirm them before editing."],
            verificationCommands: ["npm run build", "npm run test"],
            codeMapSummary: "Native codebase scan has 1 scanned code nodes.",
            prompt: latestLoadedCodexPlanPrompt,
          }),
        });
      },
      "/product-graph/trace/*": (route) => {
        const url = new URL(route.request().url());
        traceRequests.push(url.pathname);
        const rootNode = productGraphProjection.nodes.find((node) => node.id === "task:checkout-status-panel")!;
        const codeNode = productGraphProjection.nodes.find((node) => node.id === "symbol:checkout-controller")!;
        const codeEdge = productGraphProjection.edges.find((item) => item.id === "edge-task-symbol")!;
        const acceptedPlanTraces = productGraphProjection.nodes.flatMap((node) => {
          const acceptedPlanEdge = acceptedPlanTaskEdgeFor(node.id, rootNode.id);
          if (!isAcceptedCodexPlanForTask(node, rootNode.id) || !acceptedPlanEdge) {
            return [];
          }

          const runPlanEdge = productGraphProjection.edges.find(
            (edge) => edge.sourceNodeId === "run:checkout-proof" && edge.targetNodeId === node.id
          );
          return runPlanEdge ? [{ node, edge: acceptedPlanEdge, runPlanEdge }] : [];
        });
        const runNode = {
          id: "run:checkout-proof",
          kind: "agent_run",
          title: "Checkout proof run",
          status: "completed",
          source: {
            kind: "openagentgraph_run",
            label: "OpenAgentGraph run",
            url: "/graphs/graph%3Acheckout-proof",
          },
          metadata: {
            graphId: "graph:checkout-proof",
            graphStatus: "completed",
            runControlState: "idle",
            completedNodeCount: 2,
            plannedNodeCount: 2,
            passRate: 1,
            evidenceCoverageRate: 0.75,
            lastEventSequence: 7,
          },
          createdAt: now(),
          updatedAt: now(),
          incomingEdgeIds: ["edge-task-run", "edge-run-evidence"],
          outgoingEdgeIds:
            acceptedPlanTraces.length > 0
              ? ["edge-run-file", ...acceptedPlanTraces.map((trace) => trace.runPlanEdge.id)]
              : ["edge-run-file"],
          blockedByNodeIds: [],
        };
        const evidenceNode = {
          id: "evidence:checkout-proof",
          kind: "evidence",
          title: "Checkout proof run evidence",
          summary: "1 changed file, 1 command, 1 test command.",
          status: "completed",
          source: {
            kind: "openagentgraph_run",
            label: "OpenAgentGraph run",
            url: "/graphs/graph%3Acheckout-proof",
          },
          metadata: {
            graphId: "graph:checkout-proof",
            graphStatus: "completed",
            changedFileCount: 1,
            commandCount: 1,
            failingCommandCount: 0,
            testCommandCount: 1,
            passingTestCommandCount: 1,
            toolCallCount: 1,
            passRate: 1,
            evidenceCoverageRate: 0.75,
            lastEventSequence: 7,
          },
          createdAt: now(),
          updatedAt: now(),
          incomingEdgeIds: [],
          outgoingEdgeIds: ["edge-run-evidence"],
          blockedByNodeIds: [],
        };
        const fileNode = {
          id: "file:checkout-status",
          kind: "code_file",
          title: "packages/frontend/src/CheckoutStatus.tsx",
          status: "planned",
          source: {
            kind: "openagentgraph_run",
            label: "OpenAgentGraph run",
            path: "packages/frontend/src/CheckoutStatus.tsx",
          },
          createdAt: now(),
          updatedAt: now(),
          incomingEdgeIds: ["edge-run-file"],
          outgoingEdgeIds: [],
          blockedByNodeIds: [],
        };
        const taskRunEdge = {
          id: "edge-task-run",
          sourceNodeId: rootNode.id,
          targetNodeId: runNode.id,
          kind: "produced_by",
          label: "Task produced by run",
          trust: "manual",
          createdAt: now(),
          updatedAt: now(),
        };
        const evidenceEdge = {
          id: "edge-run-evidence",
          sourceNodeId: evidenceNode.id,
          targetNodeId: runNode.id,
          kind: "produced_by",
          label: "Evidence produced by run",
          trust: "manual",
          createdAt: now(),
          updatedAt: now(),
        };
        const fileEdge = {
          id: "edge-run-file",
          sourceNodeId: runNode.id,
          targetNodeId: fileNode.id,
          kind: "touches",
          label: "Run changed file",
          trust: "manual",
          createdAt: now(),
          updatedAt: now(),
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            productGraphId: "default",
            rootNode: {
              ...rootNode,
              incomingEdgeIds: acceptedPlanTraces.map((trace) => trace.edge.id),
              outgoingEdgeIds: [codeEdge.id, taskRunEdge.id],
              blockedByNodeIds: [],
            },
            nodes: [
              {
                ...rootNode,
                incomingEdgeIds: acceptedPlanTraces.map((trace) => trace.edge.id),
                outgoingEdgeIds: [codeEdge.id, taskRunEdge.id],
                blockedByNodeIds: [],
              },
              ...acceptedPlanTraces.map((trace) => ({
                ...trace.node,
                incomingEdgeIds: [trace.runPlanEdge.id],
                outgoingEdgeIds: [trace.edge.id],
                blockedByNodeIds: [],
              })),
              runNode,
              {
                ...codeNode,
                incomingEdgeIds: [codeEdge.id],
                outgoingEdgeIds: [],
                blockedByNodeIds: [],
              },
              evidenceNode,
              fileNode,
            ],
            edges: acceptedPlanTraces.length > 0
              ? [
                  ...acceptedPlanTraces.map((trace) => trace.edge),
                  taskRunEdge,
                  ...acceptedPlanTraces.map((trace) => trace.runPlanEdge),
                  codeEdge,
                  evidenceEdge,
                  fileEdge,
                ]
              : [codeEdge, taskRunEdge, evidenceEdge, fileEdge],
            hopsByNodeId: {
              [rootNode.id]: 0,
              [codeNode.id]: 1,
              ...Object.fromEntries(acceptedPlanTraces.map((trace) => [trace.node.id, 1])),
              [runNode.id]: 1,
              [evidenceNode.id]: 2,
              [fileNode.id]: 2,
            },
            summary: {
              nodeCount: 5 + acceptedPlanTraces.length,
              edgeCount: 4 + acceptedPlanTraces.length * 2,
              maxDepth: 2,
              codeNodeCount: 2,
              testResultNodeCount: 0,
              evidenceNodeCount: 1,
            },
          }),
        });
      },
      "/product-graph/runs/*": async (route) => {
        const url = new URL(route.request().url());
        const payload = route.request().postDataJSON();
        const runLinkAfterCodeScanAt = "2026-04-18T12:00:00.000Z";
        linkRunRequests.push({ path: url.pathname, payload });
        const node = {
          id: "run:checkout-proof",
          kind: "agent_run",
          title: "Checkout proof run",
          summary: "Run completed successfully.",
          status: "completed",
          source: {
            kind: "openagentgraph_run",
            label: "OpenAgentGraph run",
            url: "/graphs/graph%3Acheckout-proof",
          },
          metadata: {
            graphId: "graph:checkout-proof",
            graphStatus: "completed",
            runControlState: "idle",
            completedNodeCount: 2,
            plannedNodeCount: 2,
            passRate: 1,
            evidenceCoverageRate: 0.75,
            lastEventSequence: 7,
          },
          createdAt: runLinkAfterCodeScanAt,
          updatedAt: runLinkAfterCodeScanAt,
        };
        const edge = {
          id: "edge-task-run",
          sourceNodeId: payload.taskNodeId,
          targetNodeId: node.id,
          kind: "produced_by",
          label: "Task produced by run",
          trust: "manual",
          createdAt: runLinkAfterCodeScanAt,
          updatedAt: runLinkAfterCodeScanAt,
        };
        const evidenceNode = {
          id: "evidence:checkout-proof",
          kind: "evidence",
          title: "Checkout proof run evidence",
          summary: "1 changed file, 1 command, 1 test command.",
          status: "completed",
          source: {
            kind: "openagentgraph_run",
            label: "OpenAgentGraph run",
            url: "/graphs/graph%3Acheckout-proof",
          },
          metadata: {
            graphId: "graph:checkout-proof",
            graphStatus: "completed",
            changedFileCount: 1,
            commandCount: 1,
            failingCommandCount: 0,
            testCommandCount: 1,
            passingTestCommandCount: 1,
            toolCallCount: 1,
            passRate: 1,
            evidenceCoverageRate: 0.75,
            lastEventSequence: 7,
          },
          createdAt: runLinkAfterCodeScanAt,
          updatedAt: runLinkAfterCodeScanAt,
        };
        const evidenceEdge = {
          id: "edge-run-evidence",
          sourceNodeId: evidenceNode.id,
          targetNodeId: node.id,
          kind: "produced_by",
          label: "Evidence produced by run",
          trust: "manual",
          createdAt: runLinkAfterCodeScanAt,
          updatedAt: runLinkAfterCodeScanAt,
        };
        const fileNode = {
          id: "file:checkout-status",
          kind: "code_file",
          title: "packages/frontend/src/CheckoutStatus.tsx",
          summary: "Touched by linked OpenAgentGraph run evidence.",
          status: "planned",
          tags: ["openagentgraph", "code"],
          source: {
            kind: "openagentgraph_run",
            label: "OpenAgentGraph run",
            path: "packages/frontend/src/CheckoutStatus.tsx",
            url: "/graphs/graph%3Acheckout-proof",
          },
          metadata: {
            openAgentGraphRunFilePath: "packages/frontend/src/CheckoutStatus.tsx",
          },
          createdAt: runLinkAfterCodeScanAt,
          updatedAt: runLinkAfterCodeScanAt,
        };
        const fileEdge = {
          id: "edge-run-file",
          sourceNodeId: node.id,
          targetNodeId: fileNode.id,
          kind: "touches",
          label: "Run changed file",
          trust: "manual",
          metadata: {
            filePath: "packages/frontend/src/CheckoutStatus.tsx",
            fileDiffCount: 1,
            changeTypes: "created",
          },
          createdAt: runLinkAfterCodeScanAt,
          updatedAt: runLinkAfterCodeScanAt,
        };
        const planEdges = productGraphProjection.nodes
          .filter((item) => isAcceptedCodexPlanForTask(item, payload.taskNodeId))
          .map((planNode) => ({
            id: planNode.id.endsWith("-retry")
              ? "edge-run-codex-plan-checkout-status-panel-retry"
              : "edge-run-codex-plan-checkout-status-panel",
            sourceNodeId: node.id,
            targetNodeId: planNode.id,
            kind: "derived_from",
            label: "Run derived from plan",
            trust: "manual",
            createdAt: runLinkAfterCodeScanAt,
            updatedAt: runLinkAfterCodeScanAt,
          }));
        productGraphProjection.nodes.push({
          ...node,
          incomingEdgeIds: [edge.id],
          outgoingEdgeIds: [fileEdge.id, ...planEdges.map((planEdge) => planEdge.id)],
          blockedByNodeIds: [],
        });
        productGraphProjection.nodes.push({
          ...evidenceNode,
          incomingEdgeIds: [],
          outgoingEdgeIds: [evidenceEdge.id],
          blockedByNodeIds: [],
        });
        productGraphProjection.nodes.push({
          ...fileNode,
          incomingEdgeIds: [fileEdge.id],
          outgoingEdgeIds: [],
          blockedByNodeIds: [],
        });
        productGraphProjection.nodes
          .find((item) => item.id === payload.taskNodeId)
          ?.outgoingEdgeIds.push(edge.id);
        for (const planEdge of planEdges) {
          productGraphProjection.nodes
            .find((item) => item.id === planEdge.targetNodeId)
            ?.incomingEdgeIds.push(planEdge.id);
        }
        productGraphProjection.edges.push(edge, ...planEdges, evidenceEdge, fileEdge);
        productGraphProjection.summary = {
          ...productGraphProjection.summary,
          nodeCount: productGraphProjection.nodes.length,
          edgeCount: productGraphProjection.edges.length,
          nodesByKind: {
            ...productGraphProjection.summary.nodesByKind,
            agent_run: (productGraphProjection.summary.nodesByKind.agent_run ?? 0) + 1,
            evidence: (productGraphProjection.summary.nodesByKind.evidence ?? 0) + 1,
            code_file: (productGraphProjection.summary.nodesByKind.code_file ?? 0) + 1,
          },
          edgesByKind: {
            ...productGraphProjection.summary.edgesByKind,
            produced_by: (productGraphProjection.summary.edgesByKind.produced_by ?? 0) + 2,
            derived_from: (productGraphProjection.summary.edgesByKind.derived_from ?? 0) + planEdges.length,
            touches: (productGraphProjection.summary.edgesByKind.touches ?? 0) + 1,
          },
        };
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            node,
            edge,
            evidenceNode,
            evidenceEdge,
            planEdges,
            fileNodes: [fileNode],
            fileEdges: [fileEdge],
          }),
        });
      },
      "/product-graph/nodes": async (route) => {
        const payload = route.request().postDataJSON();
        createNodeRequests.push(payload);
        const node = {
          id: "task:manual-follow-up",
          kind: payload.kind,
          title: payload.title,
          summary: payload.summary,
          status: payload.status,
          createdAt: now(),
          updatedAt: now(),
        };
        productGraphProjection.nodes.push({
          ...node,
          incomingEdgeIds: [],
          outgoingEdgeIds: [],
          blockedByNodeIds: [],
        });
        productGraphProjection.summary = {
          ...productGraphProjection.summary,
          nodeCount: productGraphProjection.nodes.length,
          nodesByKind: {
            ...productGraphProjection.summary.nodesByKind,
            task: (productGraphProjection.summary.nodesByKind.task ?? 0) + 1,
          },
        };
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(node),
        });
      },
      "/product-graph/edges": async (route) => {
        const payload = route.request().postDataJSON();
        createEdgeRequests.push(payload);
        const edge = {
          id: "edge-manual-implements",
          sourceNodeId: payload.sourceNodeId,
          targetNodeId: payload.targetNodeId,
          kind: payload.kind,
          label: payload.label,
          trust: "manual",
          createdAt: now(),
          updatedAt: now(),
        };
        productGraphProjection.edges.push(edge);
        productGraphProjection.nodes
          .find((node) => node.id === payload.sourceNodeId)
          ?.outgoingEdgeIds.push(edge.id);
        productGraphProjection.nodes
          .find((node) => node.id === payload.targetNodeId)
          ?.incomingEdgeIds.push(edge.id);
        productGraphProjection.summary = {
          ...productGraphProjection.summary,
          edgeCount: productGraphProjection.edges.length,
          edgesByKind: {
            ...productGraphProjection.summary.edgesByKind,
            [payload.kind]: (productGraphProjection.summary.edgesByKind[payload.kind] ?? 0) + 1,
          },
        };
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(edge),
        });
      },
      "/product-graph/intent-bundles": async (route) => {
        const payload = route.request().postDataJSON();
        createBundleRequests.push(payload);
        const featureNode = {
          id: "feature:bundle-roadmap",
          kind: "feature",
          title: payload.feature.title,
          summary: payload.feature.summary,
          status: "planned",
          createdAt: now(),
          updatedAt: now(),
        };
        const storyNodes = payload.userStories.map((story: { title: string }, index: number) => ({
          id: `story:bundle-roadmap-${index + 1}`,
          kind: "user_story",
          title: story.title,
          status: "planned",
          createdAt: now(),
          updatedAt: now(),
        }));
        const criterionNodes = payload.acceptanceCriteria.map((criterion: { title: string }, index: number) => ({
          id: `criterion:bundle-roadmap-${index + 1}`,
          kind: "acceptance_criterion",
          title: criterion.title,
          status: "planned",
          createdAt: now(),
          updatedAt: now(),
        }));
        const taskNodes = payload.tasks.map((task: { title: string }, index: number) => ({
          id: `task:bundle-roadmap-${index + 1}`,
          kind: "task",
          title: task.title,
          status: "planned",
          createdAt: now(),
          updatedAt: now(),
        }));
        const nodes = [featureNode, ...storyNodes, ...criterionNodes, ...taskNodes];
        const edges = [
          ...storyNodes.map((story: { id: string }, index: number) => ({
            id: `edge-bundle-story-feature-${index + 1}`,
            sourceNodeId: story.id,
            targetNodeId: featureNode.id,
            kind: "belongs_to",
            label: "Story belongs to feature",
            trust: "manual",
            createdAt: now(),
            updatedAt: now(),
          })),
          ...criterionNodes.map((criterion: { id: string }, index: number) => ({
            id: `edge-bundle-criterion-feature-${index + 1}`,
            sourceNodeId: criterion.id,
            targetNodeId: featureNode.id,
            kind: "satisfies",
            label: "Criterion satisfies feature",
            trust: "manual",
            createdAt: now(),
            updatedAt: now(),
          })),
          ...taskNodes.map((task: { id: string }, index: number) => ({
            id: `edge-bundle-task-feature-${index + 1}`,
            sourceNodeId: task.id,
            targetNodeId: featureNode.id,
            kind: "implements",
            label: "Task implements feature",
            trust: "manual",
            createdAt: now(),
            updatedAt: now(),
          })),
        ];
        productGraphProjection.nodes.push(
          ...nodes.map((node: { id: string }) => ({
            ...node,
            incomingEdgeIds: edges.filter((edge) => edge.targetNodeId === node.id).map((edge) => edge.id),
            outgoingEdgeIds: edges.filter((edge) => edge.sourceNodeId === node.id).map((edge) => edge.id),
            blockedByNodeIds: [],
          }))
        );
        productGraphProjection.edges.push(...edges);
        productGraphProjection.summary = {
          ...productGraphProjection.summary,
          nodeCount: productGraphProjection.nodes.length,
          edgeCount: productGraphProjection.edges.length,
          nodesByKind: {
            ...productGraphProjection.summary.nodesByKind,
            feature: (productGraphProjection.summary.nodesByKind.feature ?? 0) + 1,
            user_story: (productGraphProjection.summary.nodesByKind.user_story ?? 0) + storyNodes.length,
            acceptance_criterion:
              (productGraphProjection.summary.nodesByKind.acceptance_criterion ?? 0) + criterionNodes.length,
            task: (productGraphProjection.summary.nodesByKind.task ?? 0) + taskNodes.length,
          },
          edgesByKind: {
            ...productGraphProjection.summary.edgesByKind,
            belongs_to: (productGraphProjection.summary.edgesByKind.belongs_to ?? 0) + storyNodes.length,
            satisfies: (productGraphProjection.summary.edgesByKind.satisfies ?? 0) + criterionNodes.length,
            implements: (productGraphProjection.summary.edgesByKind.implements ?? 0) + taskNodes.length,
          },
        };
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ nodes, edges }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();

    await expect(page.getByText("Product intent").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Checkout visibility/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Operator sees checkout status/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Wire checkout status panel/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Who owns payment copy/ }).first()).toBeVisible();
    await expect(page.getByText("6 intent nodes").first()).toBeVisible();
    await expect(page.getByText("1 open questions").first()).toBeVisible();
    await expect(page.getByText("1 blocked tasks").first()).toBeVisible();
    await expect(page.getByText("Blocked by unresolved open question")).toBeVisible();
    const acceptanceEvidenceGapGroup = page.getByRole("group", { name: "Acceptance evidence gaps" });
    await expect(acceptanceEvidenceGapGroup).toBeVisible();
    await expect(acceptanceEvidenceGapGroup).toContainText("Tax copy has owner approval");
    await pressButton(
      page,
      acceptanceEvidenceGapGroup.getByRole("button", {
        name: "Focus Tax copy has owner approval acceptance criterion",
      })
    );
    await expect(page.getByLabel("Intent kind filter")).toHaveValue("acceptance_criterion");
    await expect(page.getByText("Selected intent")).toBeVisible();
    await expect(page.locator("aside").filter({ hasText: "Selected intent" })).toContainText(
      "Tax copy has owner approval"
    );
    await page.getByLabel("Intent kind filter").selectOption("task");
    const checkoutTaskCard = page.getByRole("button", { name: /Wire checkout status panel/ }).first();
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    const codexPlanGroup = page.getByRole("group", { name: "Codex planning prompt" });
    await expect(codexPlanGroup).toBeVisible();
    const codexPlanningReadiness = codexPlanGroup.getByRole("group", { name: "Codex planning readiness" });
    await expect(codexPlanningReadiness).toContainText(
      "1 open-question blocker; load the plan for context, then resolve blockers before execution."
    );
    await expect(codexPlanningReadiness).toContainText(
      "Codex planning can use native codebase scan context."
    );
    await expect(codexPlanningReadiness).toContainText(
      "Provider and session checks are clear here; start real execution from Current run setup after the workspace path is set."
    );
    await expect(codexPlanningReadiness).toContainText(
      "Load plan to generate the bounded Codex prompt for this task."
    );
    await pressButton(page, codexPlanGroup.getByRole("button", { name: "Load plan" }));
    await expect(codexPlanGroup).toContainText("Native codebase scan has 1 scanned code nodes.");
    await expect(codexPlanGroup).toContainText("Some code links are inferred or ambiguous");
    await expect(codexPlanGroup).toContainText("npm run build / npm run test");
    await expect(codexPlanGroup).toContainText("You are Codex working from OpenAgentGraph product graph context.");
    expect(codexPlanRequests).toEqual(["/product-graph/codex-plan/task%3Acheckout-status-panel"]);
    await pressButton(page, codexPlanGroup.getByRole("button", { name: "Accept plan" }));
    await expect.poll(() => acceptCodexPlanRequests.length).toBe(1);
    expect(acceptCodexPlanRequests[0].path).toBe("/product-graph/codex-plan/task%3Acheckout-status-panel/accept");
    expect(acceptCodexPlanRequests[0].body.promptHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(page.getByLabel("Intent kind filter")).toHaveValue("plan");
    await expect(page.getByRole("button", { name: /Codex plan for Wire checkout status panel/ }).first()).toBeVisible();
    await page.getByLabel("Intent kind filter").selectOption("task");
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    await pressButton(page, codexPlanGroup.getByRole("button", { name: /Load plan|Refresh plan/ }));
    await expect.poll(() => codexPlanRequests.length).toBe(2);
    expect(codexPlanRequests[1]).toBe("/product-graph/codex-plan/task%3Acheckout-status-panel");
    await expect(codexPlanGroup).toContainText("Retry context");
    await expect(codexPlanGroup).toContainText("Reconcile the accepted plan with the completed run trace.");
    await pressButton(page, codexPlanGroup.getByRole("button", { name: "Accept plan" }));
    await expect.poll(() => acceptCodexPlanRequests.length).toBe(2);
    expect(acceptCodexPlanRequests[1].path).toBe("/product-graph/codex-plan/task%3Acheckout-status-panel/accept");
    expect(acceptCodexPlanRequests[1].body.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(acceptCodexPlanRequests[1].body.promptHash).not.toBe(acceptCodexPlanRequests[0].body.promptHash);
    await expect(page.getByLabel("Intent kind filter")).toHaveValue("plan");
    await expect(
      page.getByRole("button", { name: /Retry Codex plan for Wire checkout status panel/ }).first()
    ).toBeVisible();
    await page.getByLabel("Intent kind filter").selectOption("task");
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    const traceabilityGroup = page.getByRole("group", { name: "Traceability" });
    await expect(traceabilityGroup).toBeVisible();
    await pressButton(page, traceabilityGroup.getByRole("button", { name: "Load trace" }));
    await expect(traceabilityGroup).toContainText("5 nodes");
    await expect(traceabilityGroup).toContainText("4 links");
    await expect(traceabilityGroup).toContainText("2 code");
    await expect(traceabilityGroup).toContainText("1 evidence");
    await expect(traceabilityGroup).toContainText("CheckoutController");
    await expect(traceabilityGroup).toContainText("Checkout proof run");
    await expect(traceabilityGroup).toContainText("Checkout proof run evidence");
    await expect(traceabilityGroup).toContainText("packages/frontend/src/CheckoutStatus.tsx");
    expect(traceRequests).toEqual(["/product-graph/trace/task%3Acheckout-status-panel"]);
    await pressButton(page, traceabilityGroup.getByRole("button", { name: /CheckoutController/ }));
    await expect(page.getByText("Selected code")).toBeVisible();
    await expect(page.getByRole("group", { name: "Code scan details" })).toContainText("src/checkout.ts:42");
    await page.getByLabel("Intent kind filter").selectOption("task");
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    const codeAreaGroup = page.getByRole("group", { name: "Likely code areas" });
    await expect(codeAreaGroup).toBeVisible();
    await expect(codeAreaGroup).toContainText("CheckoutController");
    await expect(codeAreaGroup).toContainText("ambiguous");
    await pressButton(page, codeAreaGroup.getByRole("button", { name: /CheckoutController/ }));
    await expect(page.getByText("Selected code")).toBeVisible();
    await expect(page.getByRole("group", { name: "Code scan details" })).toContainText("src/checkout.ts:42");
    await page.getByLabel("Intent kind filter").selectOption("task");
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    const blockerGroup = page.getByRole("group", { name: "Open question blockers" });
    await expect(blockerGroup).toBeVisible();
    await expect(blockerGroup).toContainText("Blocked by open questions");
    await expect(blockerGroup).toContainText("Who owns payment copy?");
    await expect(blockerGroup).toContainText("proposed");
    const runLinkGroup = page.getByRole("form", { name: "Run linking" });
    await expect(runLinkGroup).toBeVisible();
    await expect(runLinkGroup.getByLabel("Completed run")).toHaveValue("graph:checkout-proof");
    await pressButton(page, runLinkGroup.getByRole("button", { name: "Link run" }));
    await expect(runLinkGroup).toContainText("Run linked.");
    await expect.poll(() => [...traceRequests]).toEqual([
      "/product-graph/trace/task%3Acheckout-status-panel",
      "/product-graph/trace/task%3Acheckout-status-panel",
    ]);
    const refreshedTraceabilityGroup = page.getByRole("group", { name: "Traceability" });
    await expectMultipleAcceptedPlanRunTrace(refreshedTraceabilityGroup);
    const productHealthGroupAfterRunLink = page.getByRole("group", { name: "Product health" });
    await expect(productHealthGroupAfterRunLink).toContainText("Code map gaps");
    await expect(productHealthGroupAfterRunLink).toContainText(
      "1 run-touched code node changed after the latest codebase scan."
    );
    await expect(productHealthGroupAfterRunLink).toContainText(
      "Codex planning may use stale code relationship context until the codebase scan is refreshed."
    );
    const codeMapFreshnessGroup = page.getByRole("group", { name: "Code map freshness gaps" });
    await expect(codeMapFreshnessGroup).toContainText("packages/frontend/src/CheckoutStatus.tsx");
    await expect(codeMapFreshnessGroup).toContainText("Changed after Codebase scan");
    await pressButton(
      page,
      codeMapFreshnessGroup.getByRole("button", {
        name: /packages\/frontend\/src\/CheckoutStatus\.tsx/,
      })
    );
    await expect(page.getByLabel("Intent kind filter")).toHaveValue("code_file");
    await expect(page.getByText("Selected code")).toBeVisible();
    await expect(page.getByRole("group", { name: "Code scan details" })).toContainText(
      "packages/frontend/src/CheckoutStatus.tsx"
    );
    await page.getByLabel("Intent kind filter").selectOption("task");
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    const linkedRunFilesGroup = page.getByRole("group", { name: "Linked run files" });
    await expect(linkedRunFilesGroup).toBeVisible();
    await expect(linkedRunFilesGroup).toContainText("packages/frontend/src/CheckoutStatus.tsx");
    await expect(linkedRunFilesGroup).toContainText("Checkout proof run - Run changed file");
    await pressButton(
      page,
      linkedRunFilesGroup.getByRole("button", { name: /packages\/frontend\/src\/CheckoutStatus\.tsx/ })
    );
    await expect(page.getByText("Selected code")).toBeVisible();
    await expect(page.getByRole("group", { name: "Code scan details" })).toContainText(
      "packages/frontend/src/CheckoutStatus.tsx"
    );
    await page.getByLabel("Intent kind filter").selectOption("task");
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    await pressButton(page, refreshedTraceabilityGroup.getByRole("button", { name: "Focus Checkout proof run trace node" }));
    await expect(page.getByText("Selected run")).toBeVisible();
    const runDetailsGroup = page.getByRole("group", { name: "OpenAgentGraph run details" });
    await expect(runDetailsGroup).toContainText("graph:checkout-proof");
    await expect(runDetailsGroup).toContainText("100%");
    await expect(runDetailsGroup).toContainText("75%");
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    await pressButton(page, refreshedTraceabilityGroup.getByRole("button", { name: "Focus Checkout proof run evidence trace node" }));
    await expect(page.getByText("Selected evidence")).toBeVisible();
    const evidenceDetailsGroup = page.getByRole("group", { name: "Run evidence details" });
    await expect(evidenceDetailsGroup).toContainText("Changed files");
    await expect(evidenceDetailsGroup).toContainText("Commands");
    await expect(evidenceDetailsGroup).toContainText("Test commands");
    await expect(evidenceDetailsGroup).toContainText("100%");
    await expect(evidenceDetailsGroup).toContainText("75%");
    await page.getByLabel("Intent kind filter").selectOption("task");
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Create feature bundle")).toBeVisible();
    await expect(page.getByText("Add intent node")).toBeVisible();
    await expect(page.getByText("Add relationship")).toBeVisible();

    await page.getByLabel("Bundle feature title").fill("Bundle roadmap");
    await page.getByLabel("Bundle feature summary").fill("Create a complete feature plan in one write.");
    await page.getByLabel("Bundle user story title 1").fill("Operator drafts a complete bundle");
    await pressButton(page, page.getByRole("button", { name: "Add story" }));
    await page.getByLabel("Bundle user story title 2").fill("Reviewer sees complete scope");
    await page.getByLabel("Bundle acceptance criterion title 1").fill("The bundle appears with linked planning nodes");
    await pressButton(page, page.getByRole("button", { name: "Add criterion" }));
    await page.getByLabel("Bundle acceptance criterion title 2").fill("The bundle keeps all children atomic");
    await page.getByLabel("Bundle task title 1").fill("Wire bundle creation UI");
    await pressButton(page, page.getByRole("button", { name: "Add task" }));
    await page.getByLabel("Bundle task title 2").fill("Cover bundle failure paths");
    await pressButton(page, page.getByRole("button", { name: "Create bundle" }));

    await expect(page.getByText("Feature bundle created.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Bundle roadmap/ }).first()).toBeVisible();

    await page.getByLabel("Node kind").selectOption("task");
    await page.getByLabel("Node title").fill("Manual follow-up");
    await page.getByLabel("Node summary").fill("Document the first manual intent node.");
    await pressButton(page, page.getByRole("button", { name: "Create node" }));

    await expect(page.getByText("Node created.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Manual follow-up/ }).first()).toBeVisible();
    await expect(page.getByRole("form", { name: "Run linking" })).not.toContainText("Run linked.");
    await page.getByLabel("Edge source").selectOption("task:manual-follow-up");
    await page.getByLabel("Edge target").selectOption("story:operator-sees-checkout");
    await page.getByLabel("Edge kind").selectOption("implements");
    await page.getByLabel("Edge label").fill("Implements story");
    await page.getByPlaceholder("Search intent, tasks, questions...").fill("payment copy");
    await pressButton(page, page.getByRole("button", { name: "Create relationship" }));

    await expect(page.getByText("Relationship created.")).toBeVisible();
    await expect(page.getByPlaceholder("Search intent, tasks, questions...")).toHaveValue("");
    await expect(page.getByRole("button", { name: /Manual follow-up/ }).first()).toBeVisible();
    await expect(page.getByText("Implements story").first()).toBeVisible();
    expect(createNodeRequests).toEqual([
      {
        kind: "task",
        status: "planned",
        title: "Manual follow-up",
        summary: "Document the first manual intent node.",
      },
    ]);
    expect(createEdgeRequests).toEqual([
      {
        sourceNodeId: "task:manual-follow-up",
        targetNodeId: "story:operator-sees-checkout",
        kind: "implements",
        label: "Implements story",
      },
    ]);
    expect(createBundleRequests).toEqual([
      {
        feature: {
          title: "Bundle roadmap",
          summary: "Create a complete feature plan in one write.",
        },
        userStories: [{ title: "Operator drafts a complete bundle" }, { title: "Reviewer sees complete scope" }],
        acceptanceCriteria: [
          { title: "The bundle appears with linked planning nodes" },
          { title: "The bundle keeps all children atomic" },
        ],
        tasks: [{ title: "Wire bundle creation UI" }, { title: "Cover bundle failure paths" }],
      },
    ]);
    expect(linkRunRequests).toEqual([
      {
        path: "/product-graph/runs/graph%3Acheckout-proof/link",
        payload: {
          taskNodeId: "task:checkout-status-panel",
        },
      },
    ]);
  });

  test("imports Spec Kit artifacts from the Intent graph and refreshes the browser projection", async ({ page }) => {
    const initialProductGraph = makeProductGraphProjection();
    const importedProductGraph = makeProductGraphProjection();
    importedProductGraph.nodes.push({
      id: "feature:spec-kit-checkout",
      kind: "feature",
      title: "Spec Kit checkout recovery",
      summary: "Imported from specs/checkout/spec.md.",
      status: "planned",
      tags: ["spec-kit"],
      source: {
        kind: "spec_kit",
        label: "Spec Kit",
        path: "specs/checkout/spec.md",
      },
      createdAt: now(),
      updatedAt: now(),
      incomingEdgeIds: [],
      outgoingEdgeIds: [],
      blockedByNodeIds: [],
    } as (typeof importedProductGraph.nodes)[number]);
    importedProductGraph.summary.nodeCount = importedProductGraph.nodes.length;
    importedProductGraph.summary.nodesByKind.feature = 2;

    let productGraphReads = 0;
    const specKitImportRequests: Array<{ method: string; actorId: string | undefined }> = [];

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "Actor auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "dev_header",
            authRequiredForProtectedActions: false,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphReads > 1 ? importedProductGraph : initialProductGraph),
        });
      },
      "/product-graph/spec-kit/import": (route) => {
        specKitImportRequests.push({
          method: route.request().method(),
          actorId: route.request().headers()["x-openagentgraph-actor-id"],
        });
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "imported",
            message: "Spec Kit artifacts imported into the Product Graph.",
            imported: {
              nodeCount: 8,
              edgeCount: 6,
              constitutionCount: 1,
              specFileCount: 1,
              featureCount: 1,
              userStoryCount: 1,
              requirementCount: 1,
              acceptanceCriterionCount: 1,
              openQuestionCount: 0,
              contractFileCount: 1,
              contractCount: 1,
              planFileCount: 0,
              planCount: 0,
              quickstartFileCount: 0,
              quickstartScenarioCount: 0,
              taskFileCount: 1,
              taskCount: 1,
              skippedSpecFileCount: 0,
              skippedContractFileCount: 0,
              skippedPlanFileCount: 0,
              skippedQuickstartFileCount: 0,
              skippedTaskFileCount: 0,
            },
            artifactRoot: ".",
            artifacts: [
              { key: "constitution", relativePath: ".specify/memory/constitution.md", kind: "file", present: true },
              { key: "specs", relativePath: "specs", kind: "specs", present: true },
            ],
            presentArtifacts: ["constitution", "specs"],
            missingArtifacts: [],
          }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    const specKitImportGroup = page.getByRole("group", { name: "Spec Kit import" });
    await expect(specKitImportGroup.getByRole("button", { name: "Import Spec Kit" })).toBeEnabled();

    await specKitImportGroup.getByRole("button", { name: "Import Spec Kit" }).click();

    await expect(specKitImportGroup).toContainText(
      "Spec Kit artifacts imported into the Product Graph. 8 nodes, 6 links, 1 spec, 1 task file, 1 contract file."
    );
    await expect(page.getByRole("button", { name: /Spec Kit checkout recovery/ })).toBeVisible();
    expect(specKitImportRequests).toEqual([{ method: "POST", actorId: "operator-1" }]);
    await expect.poll(() => productGraphReads).toBe(2);
  });

  test("surfaces Spec Kit import errors without refreshing the browser projection", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    let productGraphReads = 0;
    const specKitImportRequests: Array<{
      method: string;
      actorId: string | undefined;
      body: string | null;
      contentType: string | undefined;
    }> = [];

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "Actor auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "dev_header",
            authRequiredForProtectedActions: false,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        });
      },
      "/product-graph/spec-kit/import": (route) => {
        specKitImportRequests.push({
          method: route.request().method(),
          actorId: route.request().headers()["x-openagentgraph-actor-id"],
          body: route.request().postData(),
          contentType: route.request().headers()["content-type"],
        });
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Spec Kit artifacts are missing. Add Spec Kit files under specs/ and try again.",
          }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    const specKitImportGroup = page.getByRole("group", { name: "Spec Kit import" });
    await expect(specKitImportGroup.getByRole("button", { name: "Import Spec Kit" })).toBeEnabled();
    await expect.poll(() => productGraphReads).toBe(1);

    await specKitImportGroup.getByRole("button", { name: "Import Spec Kit" }).click();

    await expect(specKitImportGroup).toContainText(
      "Spec Kit artifacts are missing. Add Spec Kit files under specs/ and try again."
    );
    await expect(specKitImportGroup).not.toContainText("Spec Kit artifacts imported into the Product Graph.");
    await expect(specKitImportGroup.getByRole("button", { name: "Import Spec Kit" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Checkout visibility/ }).first()).toBeVisible();
    expect(specKitImportRequests).toEqual([
      { method: "POST", actorId: "operator-1", body: null, contentType: undefined },
    ]);
    expect(productGraphReads).toBe(1);
  });

  test("shows codebase scan feedback after a successful scan", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    let productGraphReads = 0;
    const codeScanRequests: Array<{
      method: string;
      actorId: string | undefined;
      body: string | null;
      contentType: string | undefined;
    }> = [];

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "Actor auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "dev_header",
            authRequiredForProtectedActions: false,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        });
      },
      "/product-graph/codebase/scan": (route) => {
        codeScanRequests.push({
          method: route.request().method(),
          actorId: route.request().headers()["x-openagentgraph-actor-id"],
          body: route.request().postData(),
          contentType: route.request().headers()["content-type"],
        });
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "scanned",
            message: "Codebase scan completed.",
            scanId: "scan-1",
            scannedAt: now(),
            scanned: {
              fileCount: 1,
              symbolCount: 2,
              edgeCount: 2,
              skippedFileCount: 1,
              skippedDirectoryCount: 0,
              archivedNodeCount: 0,
              archivedEdgeCount: 0,
              durationMs: 12,
              partial: true,
            },
          }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    const codeScanGroup = page.getByRole("group", { name: "Codebase scan", exact: true });
    await expect(codeScanGroup.getByRole("button", { name: "Scan Codebase" })).toBeEnabled();
    await expect.poll(() => productGraphReads).toBe(1);

    await codeScanGroup.getByRole("button", { name: "Scan Codebase" }).click();

    await expect(codeScanGroup).toContainText(
      "Codebase scan completed. 1 file, 2 symbols, 2 links, 1 skipped file, partial scan."
    );
    await expect(codeScanGroup).toContainText(
      "The scan reached a configured safety cap, so some files were skipped."
    );
    await expect(page.getByRole("button", { name: /Checkout visibility/ }).first()).toBeVisible();
    expect(codeScanRequests).toEqual([
      { method: "POST", actorId: "operator-1", body: null, contentType: undefined },
    ]);
    await expect.poll(() => productGraphReads).toBe(2);
  });

  test("surfaces Codebase scan errors without refreshing the browser projection", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    let productGraphReads = 0;
    const codeScanRequests: Array<{
      method: string;
      actorId: string | undefined;
      body: string | null;
      contentType: string | undefined;
    }> = [];

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "Actor auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "dev_header",
            authRequiredForProtectedActions: false,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        });
      },
      "/product-graph/codebase/scan": (route) => {
        codeScanRequests.push({
          method: route.request().method(),
          actorId: route.request().headers()["x-openagentgraph-actor-id"],
          body: route.request().postData(),
          contentType: route.request().headers()["content-type"],
        });
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            message:
              "Codebase scan could not be completed.",
          }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    const codeScanGroup = page.getByRole("group", { name: "Codebase scan", exact: true });
    await expect(codeScanGroup).toContainText(
      "Run Scan Codebase from the manager tools in this sidebar to refresh the native Product Graph code map."
    );
    await expect(codeScanGroup.getByRole("button", { name: "Scan Codebase" })).toBeEnabled();
    await expect.poll(() => productGraphReads).toBe(1);

    await codeScanGroup.getByRole("button", { name: "Scan Codebase" }).click();

    await expect(codeScanGroup).toContainText(
      "Codebase scan could not be completed."
    );
    await expect(codeScanGroup).not.toContainText("Codebase scan completed.");
    await expect(codeScanGroup.getByRole("button", { name: "Scan Codebase" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Checkout visibility/ }).first()).toBeVisible();
    expect(codeScanRequests).toEqual([
      { method: "POST", actorId: "operator-1", body: null, contentType: undefined },
    ]);
    expect(productGraphReads).toBe(1);
  });

  test("surfaces execution drift for completed intent tasks without linked run evidence", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    completeCheckoutTaskWithoutRun(productGraphProjection);

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        }),
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();

    const productHealthGroup = page.getByRole("group", { name: "Product health" });
    await expect(productHealthGroup).toContainText("1 of 1 completed task needs run evidence.");
    const healthDriftGroup = page.getByRole("group", { name: "Execution drift gaps" });
    await expect(healthDriftGroup).toBeVisible();
    await expect(healthDriftGroup).toContainText("No linked run");
    await pressButton(
      page,
      healthDriftGroup.getByRole("button", { name: "Focus Wire checkout status panel task with execution drift" })
    );
    const driftGroup = page.getByRole("group", { name: "Execution drift", exact: true });
    await expect(driftGroup).toBeVisible();
    await expect(driftGroup).toContainText("Runs");
    await expect(driftGroup).toContainText("Evidence");
    await expect(driftGroup).toContainText("Files");
    await expect(driftGroup).toContainText("Completed task has no linked OpenAgentGraph run.");
    await expect(driftGroup).toContainText(
      "Link a completed OpenAgentGraph run with evidence before treating this task as verified."
    );
  });

  test("keeps automatic trace refresh scoped to the selected intent graph task", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    const linkRunRequests: unknown[] = [];
    const traceRequests: string[] = [];
    let productGraphReads = 0;
    let linkRunAttempts = 0;
    let releaseFirstRunLink!: () => void;
    const firstRunLinkCanFinish = new Promise<void>((resolve) => {
      releaseFirstRunLink = resolve;
    });

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [
              makeDashboardItem({
                graphId: "graph:checkout-proof",
                goalTitle: "Checkout proof run",
                lifecycleBucket: "completed_recent",
                graphStatus: "completed",
                runControlState: "idle",
                attentionLabel: "low",
                attentionScore: 15,
              }),
            ],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 1,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        });
      },
      "/product-graph/trace/*": (route) => {
        const url = new URL(route.request().url());
        traceRequests.push(url.pathname);
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "trace refresh unavailable" }),
        });
      },
      "/product-graph/runs/*": async (route) => {
        const url = new URL(route.request().url());
        const payload = route.request().postDataJSON();
        linkRunAttempts += 1;
        linkRunRequests.push({ path: url.pathname, payload });
        if (linkRunAttempts === 1) {
          await firstRunLinkCanFinish;
        }
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            node: {
              id: "run:checkout-proof",
              kind: "agent_run",
              title: "Checkout proof run",
              status: "completed",
              createdAt: now(),
              updatedAt: now(),
            },
            edge: {
              id: `edge-task-run-${linkRunAttempts}`,
              sourceNodeId: payload.taskNodeId,
              targetNodeId: "run:checkout-proof",
              kind: "produced_by",
              trust: "manual",
              createdAt: now(),
              updatedAt: now(),
            },
            evidenceNode: {
              id: "evidence:checkout-proof",
              kind: "evidence",
              title: "Checkout proof run evidence",
              status: "completed",
              createdAt: now(),
              updatedAt: now(),
            },
            evidenceEdge: {
              id: `edge-run-evidence-${linkRunAttempts}`,
              sourceNodeId: "evidence:checkout-proof",
              targetNodeId: "run:checkout-proof",
              kind: "produced_by",
              trust: "manual",
              createdAt: now(),
              updatedAt: now(),
            },
            fileNodes: [],
            fileEdges: [],
          }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    await page.getByLabel("Intent kind filter").selectOption({ label: "All intent" });
    const checkoutTaskCard = page.getByRole("button", { name: /Wire checkout status panel/ }).first();
    const featureCard = page.getByRole("button", { name: /Checkout visibility/ }).first();
    await expect(checkoutTaskCard).toBeVisible();
    await expect(featureCard).toBeVisible();

    await pressButton(page, checkoutTaskCard);
    await pressButton(page, page.getByRole("form", { name: "Run linking" }).getByRole("button", { name: "Link run" }));
    await page.getByLabel("Intent kind filter").selectOption({ label: "All intent" });
    await expect(featureCard).toBeVisible();
    await pressButton(page, featureCard);
    releaseFirstRunLink();
    await expect.poll(() => productGraphReads).toBe(2);
    await page.waitForLoadState("networkidle");
    expect(traceRequests).toEqual([]);
    await expect(page.getByRole("form", { name: "Run linking" })).toHaveCount(0);

    await pressButton(page, checkoutTaskCard);
    const runLinkGroup = page.getByRole("form", { name: "Run linking" });
    await pressButton(page, runLinkGroup.getByRole("button", { name: "Link run" }));
    await expect(runLinkGroup).toContainText("Run linked.");
    await expect.poll(() => [...traceRequests]).toEqual(["/product-graph/trace/task%3Acheckout-status-panel"]);
    await expect(page.getByRole("group", { name: "Traceability" })).toContainText("trace refresh unavailable");
    expect(linkRunRequests).toEqual([
      {
        path: "/product-graph/runs/graph%3Acheckout-proof/link",
        payload: {
          taskNodeId: "task:checkout-status-panel",
        },
      },
      {
        path: "/product-graph/runs/graph%3Acheckout-proof/link",
        payload: {
          taskNodeId: "task:checkout-status-panel",
        },
      },
    ]);
  });

  test("surfaces manual node creation refresh failures in the intent graph form", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    const createNodeRequests: unknown[] = [];
    let productGraphReads = 0;

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        if (productGraphReads > 1) {
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "refresh unavailable" }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        });
      },
      "/product-graph/nodes": async (route) => {
        const payload = route.request().postDataJSON();
        createNodeRequests.push(payload);
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "task:manual-follow-up",
            kind: payload.kind,
            title: payload.title,
            summary: payload.summary,
            status: payload.status,
            createdAt: now(),
            updatedAt: now(),
          }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    await expect(page.getByText("Add intent node")).toBeVisible();

    await page.getByLabel("Node kind").selectOption("task");
    await page.getByLabel("Node title").fill("Manual follow-up");
    await page.getByLabel("Node summary").fill("Document the first manual intent node.");
    await page.getByRole("button", { name: "Create node" }).click();

    await expect(
      page.getByText("Product graph node was created, but the graph could not be refreshed. refresh unavailable").first()
    ).toBeVisible();
    await expect(page.getByText("Node created.")).toHaveCount(0);
    expect(productGraphReads).toBe(2);
    expect(createNodeRequests).toEqual([
      {
        kind: "task",
        status: "planned",
        title: "Manual follow-up",
        summary: "Document the first manual intent node.",
      },
    ]);
  });

  test("surfaces intent bundle refresh failures in the intent graph form", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    const createBundleRequests: unknown[] = [];
    let productGraphReads = 0;

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        if (productGraphReads > 1) {
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "refresh unavailable" }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        });
      },
      "/product-graph/intent-bundles": async (route) => {
        const payload = route.request().postDataJSON();
        createBundleRequests.push(payload);
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            nodes: [
              {
                id: "feature:bundle-roadmap",
                kind: "feature",
                title: payload.feature.title,
                summary: payload.feature.summary,
                status: "planned",
                createdAt: now(),
                updatedAt: now(),
              },
            ],
            edges: [],
          }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    await expect(page.getByText("Create feature bundle")).toBeVisible();

    await page.getByLabel("Bundle feature title").fill("Bundle roadmap");
    await page.getByLabel("Bundle feature summary").fill("Create a complete feature plan in one write.");
    await page.getByLabel("Bundle user story title 1").fill("Operator drafts a complete bundle");
    await page.getByLabel("Bundle acceptance criterion title 1").fill("The bundle appears with linked planning nodes");
    await page.getByLabel("Bundle task title 1").fill("Wire bundle creation UI");
    await page.getByRole("button", { name: "Create bundle" }).click();

    await expect(
      page.getByText("Product graph intent bundle was created, but the graph could not be refreshed. refresh unavailable").first()
    ).toBeVisible();
    await expect(page.getByText("Feature bundle created.")).toHaveCount(0);
    expect(productGraphReads).toBe(2);
    expect(createBundleRequests).toEqual([
      {
        feature: {
          title: "Bundle roadmap",
          summary: "Create a complete feature plan in one write.",
        },
        userStories: [{ title: "Operator drafts a complete bundle" }],
        acceptanceCriteria: [{ title: "The bundle appears with linked planning nodes" }],
        tasks: [{ title: "Wire bundle creation UI" }],
      },
    ]);
  });

  test("surfaces intent bundle create failures without clearing the form", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    const createBundleRequests: unknown[] = [];
    let productGraphReads = 0;

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        });
      },
      "/product-graph/intent-bundles": async (route) => {
        createBundleRequests.push(route.request().postDataJSON());
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "userStories[1]: title is required." }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    await expect(page.getByText("Create feature bundle")).toBeVisible();

    await page.getByLabel("Bundle feature title").fill("Bundle roadmap");
    await page.getByLabel("Bundle feature summary").fill("Create a complete feature plan in one write.");
    await page.getByLabel("Bundle user story title 1").fill("Operator drafts a complete bundle");
    await page.getByRole("button", { name: "Add story" }).click();
    await page.getByLabel("Bundle user story title 2").fill("Reviewer sees complete scope");
    await page.getByLabel("Bundle acceptance criterion title 1").fill("The bundle appears with linked planning nodes");
    await page.getByLabel("Bundle task title 1").fill("Wire bundle creation UI");
    await page.getByRole("button", { name: "Create bundle" }).click();

    await expect(page.getByText("userStories[1]: title is required.").first()).toBeVisible();
    await expect(page.getByText("Feature bundle created.")).toHaveCount(0);
    await expect(page.getByLabel("Bundle feature title")).toHaveValue("Bundle roadmap");
    await expect(page.getByLabel("Bundle user story title 2")).toHaveValue("Reviewer sees complete scope");
    expect(productGraphReads).toBe(1);
    expect(createBundleRequests).toEqual([
      {
        feature: {
          title: "Bundle roadmap",
          summary: "Create a complete feature plan in one write.",
        },
        userStories: [{ title: "Operator drafts a complete bundle" }, { title: "Reviewer sees complete scope" }],
        acceptanceCriteria: [{ title: "The bundle appears with linked planning nodes" }],
        tasks: [{ title: "Wire bundle creation UI" }],
      },
    ]);
  });

  test("surfaces manual edge creation refresh failures in the intent graph form", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    const createEdgeRequests: unknown[] = [];
    let productGraphReads = 0;

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        if (productGraphReads > 1) {
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "refresh unavailable" }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        });
      },
      "/product-graph/edges": async (route) => {
        const payload = route.request().postDataJSON();
        createEdgeRequests.push(payload);
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "edge-manual-implements",
            sourceNodeId: payload.sourceNodeId,
            targetNodeId: payload.targetNodeId,
            kind: payload.kind,
            label: payload.label,
            trust: "manual",
            createdAt: now(),
            updatedAt: now(),
          }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    await expect(page.getByText("Add relationship")).toBeVisible();

    await page.getByLabel("Edge source").selectOption("story:operator-sees-checkout");
    await page.getByLabel("Edge target").selectOption("question:payment-owner");
    await page.getByLabel("Edge kind").selectOption("depends_on");
    await page.getByLabel("Edge label").fill("Needs answer from");
    await page.getByRole("button", { name: "Create relationship" }).click();

    await expect(
      page.getByText("Product graph edge was created, but the graph could not be refreshed. refresh unavailable").first()
    ).toBeVisible();
    await expect(page.getByText("Relationship created.")).toHaveCount(0);
    expect(productGraphReads).toBe(2);
    expect(createEdgeRequests).toEqual([
      {
        sourceNodeId: "story:operator-sees-checkout",
        targetNodeId: "question:payment-owner",
        kind: "depends_on",
        label: "Needs answer from",
      },
    ]);
  });

  test("surfaces stale Codex plan accept errors without hiding the loaded prompt", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    addAcceptanceEvidenceGap(productGraphProjection);
    const codexPlanRequests: string[] = [];
    const acceptCodexPlanRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
    let productGraphReads = 0;

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        });
      },
      "/product-graph/codex-plan/*": (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === "POST" && url.pathname.endsWith("/accept")) {
          acceptCodexPlanRequests.push({
            path: url.pathname,
            body: route.request().postDataJSON() as Record<string, unknown>,
          });
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: "Codex planning prompt changed. Reload the plan before accepting it." }),
          });
        }

        codexPlanRequests.push(url.pathname);
        const taskNode = productGraphProjection.nodes.find((node) => node.id === "task:checkout-status-panel")!;
        const featureNode = productGraphProjection.nodes.find((node) => node.id === "feature:checkout-visibility")!;
        const criterionNode = productGraphProjection.nodes.find((node) => node.id === "criterion:tax-copy-approved")!;
        const questionNode = productGraphProjection.nodes.find((node) => node.id === "question:payment-owner")!;
        const codeNode = productGraphProjection.nodes.find((node) => node.id === "symbol:checkout-controller")!;
        const codeEdge = productGraphProjection.edges.find((item) => item.id === "edge-task-symbol")!;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            taskNode,
            intentNodes: [featureNode],
            acceptanceCriteria: [criterionNode],
            likelyCodeAreas: [{ node: codeNode, edge: codeEdge }],
            openQuestions: [questionNode],
            risks: ["Some code links are inferred or ambiguous; confirm them before editing."],
            verificationCommands: ["npm run build", "npm run test"],
            codeMapSummary: "Native codebase scan has 1 scanned code nodes.",
            prompt:
              "You are Codex working from OpenAgentGraph product graph context.\n## Current task\n- [task] Wire checkout status panel (task:checkout-status-panel)",
          }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    await page.getByLabel("Intent kind filter").selectOption("task");
    const checkoutTaskCard = page.getByRole("button", { name: /Wire checkout status panel/ }).first();
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    const codexPlanGroup = page.getByRole("group", { name: "Codex planning prompt" });
    await pressButton(page, codexPlanGroup.getByRole("button", { name: "Load plan" }));

    await expect(codexPlanGroup).toContainText("You are Codex working from OpenAgentGraph product graph context.");
    await pressButton(page, codexPlanGroup.getByRole("button", { name: "Accept plan" }));

    await expect.poll(() => acceptCodexPlanRequests.length).toBe(1);
    expect(codexPlanRequests).toEqual(["/product-graph/codex-plan/task%3Acheckout-status-panel"]);
    expect(acceptCodexPlanRequests[0].path).toBe("/product-graph/codex-plan/task%3Acheckout-status-panel/accept");
    expect(acceptCodexPlanRequests[0].body.promptHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(codexPlanGroup).toContainText("Codex planning prompt changed. Reload the plan before accepting it.");
    await expect(codexPlanGroup).toContainText("You are Codex working from OpenAgentGraph product graph context.");
    await expect(codexPlanGroup.getByRole("button", { name: "Refresh plan" })).toBeEnabled();
    expect(productGraphReads).toBe(1);
  });

  test("keeps the current intent selection when Codex plan accept finishes late", async ({ page }) => {
    const productGraphProjection = makeProductGraphProjection();
    addAcceptanceEvidenceGap(productGraphProjection);
    const acceptCodexPlanRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
    let productGraphReads = 0;
    let resolveAcceptResponse: () => void = () => {};
    const acceptResponseReady = new Promise<void>((resolve) => {
      resolveAcceptResponse = resolve;
    });

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/product-graph": (route) => {
        productGraphReads += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(productGraphProjection),
        });
      },
      "/product-graph/codex-plan/*": async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === "POST" && url.pathname.endsWith("/accept")) {
          const body = route.request().postDataJSON() as Record<string, unknown>;
          acceptCodexPlanRequests.push({ path: url.pathname, body });
          await acceptResponseReady;
          const acceptedPlanNode = {
            id: "plan:codex:checkout-status-panel",
            kind: "plan",
            title: "Codex plan for Wire checkout status panel",
            summary: "Accepted Codex planning prompt for Wire checkout status panel.",
            body:
              "You are Codex working from OpenAgentGraph product graph context.\n## Current task\n- [task] Wire checkout status panel (task:checkout-status-panel)",
            status: "planned",
            tags: ["codex", "planning"],
            metadata: {
              taskNodeId: "task:checkout-status-panel",
              promptHash: body.promptHash,
            },
            createdAt: now(),
            updatedAt: now(),
          };
          const acceptedPlanEdge = {
            id: "edge-codex-plan-checkout-status-panel",
            sourceNodeId: acceptedPlanNode.id,
            targetNodeId: "task:checkout-status-panel",
            kind: "derived_from",
            trust: "manual",
            label: "Plan derived from task",
            createdAt: now(),
            updatedAt: now(),
          };
          productGraphProjection.nodes.push({
            ...acceptedPlanNode,
            incomingEdgeIds: [],
            outgoingEdgeIds: [acceptedPlanEdge.id],
            blockedByNodeIds: [],
          } as (typeof productGraphProjection.nodes)[number]);
          productGraphProjection.edges.push(acceptedPlanEdge as (typeof productGraphProjection.edges)[number]);
          productGraphProjection.summary = {
            ...productGraphProjection.summary,
            nodeCount: productGraphProjection.nodes.length,
            edgeCount: productGraphProjection.edges.length,
            nodesByKind: {
              ...productGraphProjection.summary.nodesByKind,
              plan: 1,
            },
            edgesByKind: {
              ...productGraphProjection.summary.edgesByKind,
              derived_from: 1,
            },
          };
          return route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({ node: acceptedPlanNode, edge: acceptedPlanEdge }),
          });
        }

        const taskNode = productGraphProjection.nodes.find((node) => node.id === "task:checkout-status-panel")!;
        const featureNode = productGraphProjection.nodes.find((node) => node.id === "feature:checkout-visibility")!;
        const criterionNode = productGraphProjection.nodes.find((node) => node.id === "criterion:tax-copy-approved")!;
        const questionNode = productGraphProjection.nodes.find((node) => node.id === "question:payment-owner")!;
        const codeNode = productGraphProjection.nodes.find((node) => node.id === "symbol:checkout-controller")!;
        const codeEdge = productGraphProjection.edges.find((item) => item.id === "edge-task-symbol")!;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            taskNode,
            intentNodes: [featureNode],
            acceptanceCriteria: [criterionNode],
            likelyCodeAreas: [{ node: codeNode, edge: codeEdge }],
            openQuestions: [questionNode],
            risks: ["Some code links are inferred or ambiguous; confirm them before editing."],
            verificationCommands: ["npm run build", "npm run test"],
            codeMapSummary: "Native codebase scan has 1 scanned code nodes.",
            prompt:
              "You are Codex working from OpenAgentGraph product graph context.\n## Current task\n- [task] Wire checkout status panel (task:checkout-status-panel)",
          }),
        });
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Intent graph" }).click();
    await page.getByLabel("Intent kind filter").selectOption("task");
    const checkoutTaskCard = page.getByRole("button", { name: /Wire checkout status panel/ }).first();
    await checkoutTaskCard.focus();
    await page.keyboard.press("Enter");
    const codexPlanGroup = page.getByRole("group", { name: "Codex planning prompt" });
    await pressButton(page, codexPlanGroup.getByRole("button", { name: "Load plan" }));
    await expect(codexPlanGroup).toContainText("You are Codex working from OpenAgentGraph product graph context.");

    await pressButton(page, codexPlanGroup.getByRole("button", { name: "Accept plan" }));
    await expect.poll(() => acceptCodexPlanRequests.length).toBe(1);
    await page.getByLabel("Intent kind filter").selectOption("open_question");
    const paymentOwnerQuestion = page.getByRole("button", { name: /Who owns payment copy/ }).first();
    await paymentOwnerQuestion.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("aside").filter({ hasText: "Selected intent" })).toContainText("Who owns payment copy?");

    resolveAcceptResponse();

    await expect.poll(() => productGraphReads).toBe(2);
    expect(acceptCodexPlanRequests[0].path).toBe("/product-graph/codex-plan/task%3Acheckout-status-panel/accept");
    expect(acceptCodexPlanRequests[0].body.promptHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(page.getByLabel("Intent kind filter")).toHaveValue("open_question");
    await expect(page.locator("aside").filter({ hasText: "Selected intent" })).toContainText("Who owns payment copy?");

    await page.getByLabel("Intent kind filter").selectOption("plan");
    const acceptedPlanCard = page.getByRole("button", { name: /Codex plan for Wire checkout status panel/ }).first();
    await expect(acceptedPlanCard).toBeVisible();
    await acceptedPlanCard.focus();
    await page.keyboard.press("Enter");
    const selectedPlanAside = page.locator("aside").filter({ hasText: "Selected plan" });
    await expect(selectedPlanAside).toContainText("Codex plan for Wire checkout status panel");
    await expect(selectedPlanAside).toContainText("You are Codex working from OpenAgentGraph product graph context.");
    await expect(selectedPlanAside).toContainText("Task node");
    await expect(selectedPlanAside).toContainText("task:checkout-status-panel");
    await expect(selectedPlanAside).toContainText("Prompt hash");
    await expect(selectedPlanAside).toContainText(String(acceptCodexPlanRequests[0].body.promptHash));
  });

  test("keeps the empty state safe when the backend is unreachable", async ({ page }) => {
    await routeApi(page, {
      "/ready": (route) => route.abort("failed"),
      "/auth/session": (route) => route.abort("failed"),
      "/graphs": (route) => route.abort("failed"),
    });

    await page.goto("/");

    await expect(page.getByText("Backend unavailable")).toBeVisible();
    await expect(page.locator("text=The OpenAgentGraph backend could not be reached.").first()).toBeVisible();
  });

  test("recovers from an expired session and keeps large-graph/report flows usable", async ({ page }) => {
    await installEventSourceStub(page);

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) => {
        const authHeader = route.request().headers()["authorization"];
        if (authHeader === "Bearer replacement.token.value") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              authMode: "jwt",
              authRequiredForProtectedActions: true,
              status: "authenticated",
              actor: {
                actorId: "operator-1",
                displayName: "Priya Operator",
                role: "operator",
              },
              message: "Signed in as Priya Operator.",
            }),
          });
        }

        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "expired",
            message: "Your session has expired. Add a new token to continue.",
          }),
        });
      },
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [
              makeDashboardItem({
                graphId: "graph-launch",
                goalTitle: "Launch graph",
                latestNotificationSummary: "Large graph validation is ready.",
                plannedNodeCount: 181,
                completedNodeCount: 19,
              }),
            ],
            summary: {
              urgentRunCount: 1,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 1,
              archivedRunCount: 0,
            },
          }),
        }),
      "/graphs/graph-launch": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makeProjection()),
        }),
      "/graphs/graph-launch/report": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            graphId: "graph-launch",
            projection: makeProjection(),
            summary: "Launch graph report",
          }),
        }),
    });

    await page.goto("/");

    await expect(page.locator("text=Session expired").first()).toBeVisible();
    await expect(page.locator("text=Your session has expired. Add a new token to continue.").first()).toBeVisible();

    await page.getByPlaceholder("Paste bearer token...").fill("replacement.token.value");
    await page.getByRole("button", { name: "Add token" }).click();

    await expect(page.locator("text=Large graph mode is active to keep this run responsive.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Show full detail" })).toBeVisible();

    await page.getByRole("button", { name: "Show full detail" }).click();
    await expect(page.getByRole("button", { name: "Return to large-graph mode" })).toBeVisible();
    await expect(page.getByText("Threshold: 180+ nodes (full detail override)")).toBeVisible();

    await page.getByRole("button", { name: "Copy report" }).click();
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("Goal: Validate the launch graph.");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download JSON" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Launch graph-report.json");
  });

  test("refreshes provider readiness from the Current run setup controls", async ({ page }) => {
    const projection = {
      ...makeControlProjection(),
      runControlState: "idle" as const,
      canPause: false,
      canResume: false,
      canStop: false,
      latestNotificationSummary: "The run is waiting for provider readiness.",
    };
    const workspaceRoot = "C:\\OpenAgentGraph\\e2e-workspace";
    const runStartRequests: unknown[] = [];
    let readyRequests = 0;

    await routeApi(page, {
      "/ready": (route) => {
        const providerReady = readyRequests > 0;
        readyRequests += 1;

        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: providerReady ? "ok" : "degraded",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: providerReady
                ? { status: "ok", message: "OpenAI provider is configured." }
                : {
                    status: "degraded",
                    message: "OpenAI provider is not configured; goal execution is unavailable.",
                    details: [
                      "Set OPENAI_API_KEY in the backend environment.",
                      "Restart the backend process so it can read the updated provider configuration.",
                      "Refresh provider status in OpenAgentGraph before starting the goal run.",
                    ],
                  },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        });
      },
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [makeDashboardItemFromProjection(projection)],
            summary: {
              urgentRunCount: 0,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 0,
              archivedRunCount: 0,
            },
          }),
        }),
      "/graphs/graph-control": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(projection),
        }),
      "/graphs/graph-control/runs": async (route) => {
        runStartRequests.push(route.request().postDataJSON());
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ message: "Run started", graphId: "graph-control" }),
        });
      },
    });

    await page.goto("/");

    const runButton = page.getByRole("button", { name: /^Run$/ });
    await expect(runButton).toBeDisabled();
    await expect(page.getByText("Add a workspace path and configure the AI provider before running this goal.")).toBeVisible();

    await page.getByLabel("Workspace path").fill(workspaceRoot);
    await expect(page.getByText("Configure the AI provider before running this goal.")).toBeVisible();

    await page.getByRole("button", { name: "Refresh provider status" }).click();

    await expect(page.getByText("AI provider is configured. Run is ready.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh provider status" })).toHaveCount(0);
    await expect(runButton).toBeEnabled();
    await runButton.click();
    expect(readyRequests).toBe(2);
    await expect.poll(() => runStartRequests).toEqual([{ workspaceRoot }]);
  });

  test("supports replay stepping plus pause, stop, approval, reject, continue, and annotation flows in the browser UI", async ({
    page,
  }) => {
    const state = {
      projection: makeControlProjection(),
      posts: [] as string[],
    };

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [makeDashboardItemFromProjection(state.projection)],
            summary: {
              urgentRunCount: 1,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 1,
              archivedRunCount: 0,
            },
          }),
        }),
      "/graphs/graph-control": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(state.projection),
        }),
      "/graphs/graph-control/pause": (route) => {
        state.posts.push("pause");
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
      "/graphs/graph-control/stop": (route) => {
        state.posts.push("stop");
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
      "/graphs/graph-control/approval-request": (route) => {
        state.posts.push("approval-request");
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
      "/graphs/graph-control/reject": (route) => {
        state.posts.push("reject");
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
      "/graphs/graph-control/continue": (route) => {
        state.posts.push("continue");
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
      "/graphs/graph-control/annotations": async (route) => {
        state.posts.push("annotate");
        const body = route.request().postDataJSON() as { text?: string };
        expect(body.text).toBe("Operator note from browser");
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
    });

    await page.goto("/");

    await expect(page.getByRole("button", { name: "Pause run" })).toBeVisible();
    await expect(page.getByText("Step 4 of 4")).toBeVisible();

    await page.getByRole("button", { name: "First" }).click();
    await expect(page.getByText("Step 0 of 4")).toBeVisible();
    await expect(page.getByText("The replay is at the very beginning. No steps have been added yet.")).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Step 1 of 4")).toBeVisible();

    await page.getByRole("button", { name: "Latest" }).click();
    await expect(page.getByText("Step 4 of 4")).toBeVisible();

    await page.getByRole("button", { name: "Pause run" }).click();

    await page.getByRole("button", { name: "Stop after this step" }).click();

    await page.getByRole("button", { name: "Request approval" }).click();

    await page.getByRole("button", { name: "Reject" }).click();

    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByPlaceholder("Add a run note...").fill("Operator note from browser");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByPlaceholder("Add a run note...")).toHaveValue("");

    expect(state.posts).toEqual([
      "pause",
      "stop",
      "approval-request",
      "reject",
      "continue",
      "annotate",
    ]);
  });

  test("supports resume from a paused run in the browser UI", async ({ page }) => {
    const projection = {
      ...makeControlProjection(),
      runControlState: "paused" as const,
      canPause: false,
      canResume: true,
      latestNotificationSummary: "The run is paused and waiting to resume.",
    };
    const posts: string[] = [];

    await routeApi(page, {
      "/ready": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            checks: {
              database: { status: "ok", message: "Database schema is initialized." },
              provider: { status: "ok", message: "OpenAI provider is configured." },
              workspace: { status: "ok", message: "Workspace root is available." },
              frontend: { status: "ok", message: "Frontend origin policy is configured." },
              auth: { status: "ok", message: "JWT auth mode is configured safely." },
            },
            timestamp: now(),
          }),
        }),
      "/auth/session": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authMode: "jwt",
            authRequiredForProtectedActions: true,
            status: "authenticated",
            actor: {
              actorId: "operator-1",
              displayName: "Priya Operator",
              role: "operator",
            },
            message: "Signed in as Priya Operator.",
          }),
        }),
      "/graphs": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schemaVersion: "1",
            items: [makeDashboardItemFromProjection(projection)],
            summary: {
              urgentRunCount: 1,
              needsReviewCount: 0,
              blockedRunCount: 0,
              activeRunCount: 1,
              archivedRunCount: 0,
            },
          }),
        }),
      "/graphs/graph-control": (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(projection),
        }),
      "/graphs/graph-control/resume": (route) => {
        posts.push("resume");
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
    });

    await page.goto("/");

    await expect(page.getByRole("button", { name: "Resume run" })).toBeVisible();
    await page.getByRole("button", { name: "Resume run" }).click();
    expect(posts).toEqual(["resume"]);
  });
});
