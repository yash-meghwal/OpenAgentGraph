import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { GoalPacket, NodePlannedPayload } from "@openagentgraph/shared";

let tempDir = "";
let closeDb: (() => void) | undefined;
let createGraphWithGoalPacket: typeof import("./graphRepo.js").createGraphWithGoalPacket;
let appendGraphEvent: typeof import("./graphRepo.js").appendGraphEvent;
let getGraphProjection: typeof import("./graphRepo.js").getGraphProjection;

function makeGoalPacket(): GoalPacket {
  return {
    id: "goal-1",
    version: 1,
    originalText: "Build the dashboard",
    successCriteria: ["Ship a real dashboard artifact"],
    forbiddenScope: [],
    embedding: [1, 0],
    criteriaEmbeddings: [[1, 0]],
    createdAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openagentgraph-db-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const clientModule = await import("./client.js");
  clientModule.initDb();
  closeDb = clientModule.closeDb;

  const graphRepoModule = await import("./graphRepo.js");
  createGraphWithGoalPacket = graphRepoModule.createGraphWithGoalPacket;
  appendGraphEvent = graphRepoModule.appendGraphEvent;
  getGraphProjection = graphRepoModule.getGraphProjection;
});

afterAll(async () => {
  closeDb?.();
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  delete process.env.DATA_DIR;
});

describe("graphRepo integration", () => {
  it("replays a real event-sourced node with evidence, checksums, and semantic summary", async () => {
    const graph = await createGraphWithGoalPacket(
      {
        title: "Integration graph",
        goal: "Build the dashboard",
      },
      makeGoalPacket()
    );

    await appendGraphEvent({
      graphId: graph.id,
      kind: "node.planned",
      nodeId: "node-1",
      payload: {
        kind: "work",
        title: "Inspect workspace",
        intent: "Inspect the workspace before touching the dashboard files.",
        humanSummary: "Inspect the workspace before making changes.",
        contract: {
          expectedArtifact: "Workspace inspection summary",
          allowedTools: ["listDirectory"],
          acceptanceCriteria: ["Workspace listing captured"],
          humanSummary: "Inspect the workspace",
        },
        baselineGoalVersionId: "goal-1",
        activeGoalVersionId: "goal-1",
        dependsOnNodeIds: [],
      } satisfies NodePlannedPayload,
    });

    await appendGraphEvent({
      graphId: graph.id,
      kind: "node.executing",
      nodeId: "node-1",
      payload: {
        prompt: "Inspect the workspace now.",
        workspaceRoot: "C:\\workspace",
      },
    });

    await appendGraphEvent({
      graphId: graph.id,
      kind: "node.completed",
      nodeId: "node-1",
      payload: {
        output: "Inspected the workspace and found the dashboard entrypoint.",
        confidence: 0.82,
        evidence: {
          fileDiffs: [
            {
              path: "src/dashboard.tsx",
              changeType: "updated",
              summary: "Updated the dashboard entrypoint file.",
              before: "export const dashboard = null;",
              after: "export const dashboard = 'ready';",
              beforeChecksum: "before-hash",
              afterChecksum: "after-hash",
            },
          ],
          commandResults: [
            {
              command: "npm",
              args: ["test"],
              cwd: "C:\\workspace",
              stdout: "tests passed",
              stderr: "",
              exitCode: 0,
              timedOut: false,
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
            },
          ],
          toolCallLog: [
            {
              id: "tool-1",
              nodeId: "node-1",
              tool: "listDirectory",
              input: { path: "." },
              output: "src\npackage.json",
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            },
          ],
          workspaceChecksum: "after-workspace",
          workspaceChecksumBefore: "before-workspace",
          workspaceChecksumAfter: "after-workspace",
        },
      },
    });

    await appendGraphEvent({
      graphId: graph.id,
      kind: "node.summarized",
      nodeId: "node-1",
      payload: {
        summary: "Inspected the workspace to confirm where dashboard work should continue.",
        embedding: [0.9, 0.1],
        summaryGeneratedAt: new Date().toISOString(),
      },
    });

    const projection = await getGraphProjection(graph.id);
    const node = projection.nodes.find((candidate) => candidate.id === "node-1");

    expect(node).toBeDefined();
    expect(node?.status).toBe("completed");
    expect(node?.semanticSummary).toContain("dashboard work should continue");
    expect(node?.evidence?.toolCallLog).toHaveLength(1);
    expect(node?.evidence?.workspaceChecksumBefore).toBe("before-workspace");
    expect(node?.evidence?.workspaceChecksumAfter).toBe("after-workspace");
    expect(node?.workspaceStateChanged).toBe(true);
  });

  it("commits graph events even when OpenTelemetry export fails after append", async () => {
    const otel = await import("../observability/otel.js");
    const config = await import("../config.js");
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    otel.resetOpenTelemetryForTests();
    otel.setOpenTelemetryFetchForTests(fetchMock);
    otel.initOpenTelemetryExporter(config.loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: tempDir,
      OPENAGENTGRAPH_OTEL_ENABLED: "true",
      OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com/v1/traces",
    }));

    const graph = await createGraphWithGoalPacket(
      {
        title: "OTel graph",
        goal: "Prove committed events survive telemetry errors",
      },
      makeGoalPacket()
    );

    await expect(appendGraphEvent({
      graphId: graph.id,
      kind: "node.completed",
      nodeId: "node-otel",
      payload: {
        output: "completed",
        evidence: {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [],
          workspaceChecksum: "",
          workspaceChecksumBefore: "",
          workspaceChecksumAfter: "",
          metadata: {
            durationMs: 10,
          },
        },
      },
    })).resolves.toMatchObject({
      kind: "node.completed",
      nodeId: "node-otel",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledOnce();
    const events = await import("./graphRepo.js").then((module) => module.getGraphEvents(graph.id));
    expect(events.some((event) => event.nodeId === "node-otel" && event.kind === "node.completed")).toBe(true);
    otel.resetOpenTelemetryForTests();
  });
});
