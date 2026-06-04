import path from "path";
import { describe, expect, it } from "vitest";
import {
  projectProductGraph,
  type ProductEvent,
  type ProductGraphEdge,
  type ProductGraphNode,
  type ProductSourceRef,
} from "@openagentgraph/shared";
import { evaluateProductGraphGate } from "./gate";
import { runGateCli } from "./gate";
import { resolveProductGraphCliDataDir } from "./productGraphDataDir";

const productGraphId = "default";
const now = "2026-06-01T00:00:00.000Z";

function node(input: {
  id: string;
  kind: ProductGraphNode["kind"];
  title: string;
  status?: ProductGraphNode["status"];
  sourceKind?: ProductSourceRef["kind"];
}): ProductGraphNode {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    status: input.status ?? "planned",
    createdAt: now,
    updatedAt: now,
    ...(input.sourceKind ? { source: { kind: input.sourceKind, label: input.sourceKind } } : {}),
  };
}

function edge(input: {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: ProductGraphEdge["kind"];
}): ProductGraphEdge {
  return {
    id: input.id,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    kind: input.kind,
    trust: "manual",
    createdAt: now,
    updatedAt: now,
  };
}

function projection(nodes: ProductGraphNode[], edges: ProductGraphEdge[] = []) {
  const events: ProductEvent[] = [
    ...nodes.map((value, index): ProductEvent<"product.node.upserted"> => ({
      id: `event-node-${value.id}`,
      productGraphId,
      kind: "product.node.upserted",
      nodeId: value.id,
      payload: { node: value },
      ts: now,
      seq: index + 1,
    })),
    ...edges.map((value, index): ProductEvent<"product.edge.upserted"> => ({
      id: `event-edge-${value.id}`,
      productGraphId,
      kind: "product.edge.upserted",
      edgeId: value.id,
      payload: { edge: value },
      ts: now,
      seq: nodes.length + index + 1,
    })),
  ];
  return projectProductGraph({ productGraphId, events });
}

describe("Product Graph quality gate", () => {
  it("uses the shared backend package data directory resolver for local CLI runs", async () => {
    const workspaceRoot = path.resolve("C:/workspace/openagentgraph");
    const backendDataDir = path.join(workspaceRoot, "packages", "backend", "data");
    const backendDbPath = path.join(backendDataDir, "openagentgraph.db");

    const resolved = await resolveProductGraphCliDataDir({
      applicationRoot: workspaceRoot,
      cwd: workspaceRoot,
      fileExists: async (filePath) => filePath === backendDbPath,
    });

    expect(resolved).toBe(backendDataDir);
  });

  it("does not override an explicit gate DATA_DIR environment value", async () => {
    const workspaceRoot = path.resolve("C:/workspace/openagentgraph");

    const resolved = await resolveProductGraphCliDataDir({
      applicationRoot: workspaceRoot,
      cwd: workspaceRoot,
      envDataDir: path.join(workspaceRoot, "data"),
      fileExists: async () => true,
    });

    expect(resolved).toBeUndefined();
  });

  it("fails fast when --data-dir is missing a value", async () => {
    await expect(runGateCli(["--data-dir"])).rejects.toThrow("--data-dir requires a value.");
    await expect(runGateCli(["--data-dir", "--json"])).rejects.toThrow("--data-dir requires a value.");
  });

  it("passes with a warning when the graph is empty and allow-empty is enabled", () => {
    const result = evaluateProductGraphGate(
      projectProductGraph({ productGraphId, events: [] }),
      { mode: "hard", allowEmpty: true }
    );

    expect(result.ok).toBe(true);
    expect(result.empty).toBe(true);
    expect(result.warnings[0]).toContain("has no data");
  });

  it("hard-fails empty graphs without claiming --allow-empty was used", () => {
    const result = evaluateProductGraphGate(
      projectProductGraph({ productGraphId, events: [] }),
      { mode: "hard", allowEmpty: false }
    );

    expect(result.ok).toBe(false);
    expect(result.failures[0].code).toBe("empty_product_graph");
    expect(result.failures[0].details[0]).toContain("run without --allow-empty only after");
    expect(result.failures[0].details[0]).not.toContain("passed because --allow-empty");
  });

  it("hard-fails code intent and code scan gaps", () => {
    const run = node({ id: "run-1", kind: "agent_run", title: "Run 1", status: "completed" });
    const code = node({ id: "code-1", kind: "code_file", title: "src/checkout.ts", sourceKind: "openagentgraph_run" });
    const result = evaluateProductGraphGate(
      projection([run, code], [
        edge({ id: "edge-run-code", sourceNodeId: run.id, targetNodeId: code.id, kind: "touches" }),
      ]),
      { mode: "hard", allowEmpty: true }
    );

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain("code_intent_drift");
    expect(result.failures.map((failure) => failure.code)).toContain("code_scan_missing");
  });

  it("hard-fails execution, test, and acceptance evidence gaps", () => {
    const taskNoRun = node({ id: "task-no-run", kind: "task", title: "Task without run", status: "completed" });
    const taskNoTests = node({ id: "task-no-tests", kind: "task", title: "Task without tests", status: "completed" });
    const run = node({ id: "run-1", kind: "agent_run", title: "Linked run", status: "completed" });
    const evidence = node({ id: "evidence-1", kind: "evidence", title: "Run evidence", status: "completed" });
    const feature = node({ id: "feature-1", kind: "feature", title: "Checkout", status: "planned" });
    const criterion = node({ id: "criterion-1", kind: "acceptance_criterion", title: "Shows status", status: "planned" });
    const result = evaluateProductGraphGate(
      projection([taskNoRun, taskNoTests, run, evidence, feature, criterion], [
        edge({ id: "edge-task-run", sourceNodeId: taskNoTests.id, targetNodeId: run.id, kind: "produced_by" }),
        edge({ id: "edge-evidence-run", sourceNodeId: evidence.id, targetNodeId: run.id, kind: "produced_by" }),
        edge({ id: "edge-criterion-feature", sourceNodeId: criterion.id, targetNodeId: feature.id, kind: "satisfies" }),
      ]),
      { mode: "hard", allowEmpty: true }
    );

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual(expect.arrayContaining([
      "execution_evidence_drift",
      "test_evidence_drift",
      "acceptance_evidence_gap",
    ]));
  });

  it("reports warnings without failing in warn mode", () => {
    const run = node({ id: "run-1", kind: "agent_run", title: "Run 1", status: "completed" });
    const code = node({ id: "code-1", kind: "code_file", title: "src/checkout.ts" });
    const result = evaluateProductGraphGate(
      projection([run, code], [
        edge({ id: "edge-run-code", sourceNodeId: run.id, targetNodeId: code.id, kind: "touches" }),
      ]),
      { mode: "warn", allowEmpty: true }
    );

    expect(result.ok).toBe(true);
    expect(result.failures.length).toBeGreaterThan(0);
  });
});
