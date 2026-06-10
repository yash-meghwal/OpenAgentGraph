import { describe, expect, it } from "vitest";
import type { Node } from "@openagentgraph/shared";
import { getNodeDisplaySummary } from "./nodeSummary.js";

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: "node-1",
    graphId: "graph-1",
    kind: "work",
    title: "Build dashboard",
    intent: "Build the dashboard surface",
    humanSummary: "Build the dashboard surface in plain English.",
    status: "completed",
    contract: {
      expectedArtifact: "Dashboard implementation",
      allowedTools: ["readFile"],
      acceptanceCriteria: ["Artifact exists"],
      humanSummary: "Build the dashboard",
    },
    baselineGoalVersionId: "goal-1",
    activeGoalVersionId: "goal-1",
    dependsOnNodeIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("default-mode node summaries", () => {
  it("prefers evaluation human summaries for failed or non-passing nodes", () => {
    const summary = getNodeDisplaySummary(
      makeNode({
        status: "failed",
        evaluation: {
          llmPassed: false,
          deterministicPassed: false,
          passed: false,
          driftScore: 0.4,
          baselineDriftScore: 0.4,
          direction: "drifting",
          humanSummary: "The step failed because the evidence did not support the requested outcome.",
          suggestedAction: "revise",
          findings: [],
          ruleViolations: [],
        },
      })
    );

    expect(summary).toBe(
      "The step failed because the evidence did not support the requested outcome."
    );
  });

  it("falls back to the exact safe failure text when no summaries are available", () => {
    const summary = getNodeDisplaySummary(
      makeNode({
        status: "failed",
        humanSummary: "",
        evaluation: {
          llmPassed: false,
          deterministicPassed: false,
          passed: false,
          driftScore: 0.2,
          baselineDriftScore: 0.2,
          direction: "drifting",
          humanSummary: "",
          suggestedAction: "replan",
          findings: [],
          ruleViolations: [],
        },
      })
    );

    expect(summary).toBe(
      "This step didn't complete as expected. The system is deciding what to do next."
    );
  });

  it("sanitizes path-heavy missing-file failures into calm plain-English copy", () => {
    const summary = getNodeDisplaySummary(
      makeNode({
        status: "failed",
        evaluation: {
          llmPassed: false,
          deterministicPassed: false,
          passed: false,
          driftScore: 0.2,
          baselineDriftScore: 0.2,
          direction: "drifting",
          humanSummary:
            "ENOENT: no such file or directory, open 'C:\\Users\\yashm\\AppData\\Local\\Temp\\openagentgraph\\missing.txt'",
          suggestedAction: "replan",
          findings: [],
          ruleViolations: [],
        },
      })
    );

    expect(summary).toBe("A required file could not be found in the workspace.");
  });
});
