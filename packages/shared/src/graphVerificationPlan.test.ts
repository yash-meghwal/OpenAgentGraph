import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import {
  buildTaskVerificationPlan,
  classifyGoalTaskIntent,
} from "./graphVerificationPlan.js";
import { buildVerificationMap, type GraphVerificationMap } from "./graphVerificationMap.js";
import type { GraphTaskVerificationSummary } from "./graphVerificationPlan.js";

function expectOnlyDiscoveredCommands(
  plan: GraphTaskVerificationSummary,
  verificationMap: GraphVerificationMap
) {
  const discovered = new Set(verificationMap.commands.map((entry) => entry.command));
  const emitted = [
    ...plan.suggestedCommands,
    ...plan.verificationPlan.beforeEditing,
    ...plan.verificationPlan.afterEditing,
    ...plan.verificationPlan.fallback,
  ];
  expect(emitted.every((command) => discovered.has(command))).toBe(true);
}

function expectNoInventedWorkspaceCommands(plan: GraphTaskVerificationSummary, scope: string) {
  const invented = [
    `npm test --workspace=${scope}`,
    `npm run test --workspace=${scope}`,
  ];
  const emitted = [
    ...plan.suggestedCommands,
    ...plan.verificationPlan.beforeEditing,
    ...plan.verificationPlan.afterEditing,
    ...plan.verificationPlan.fallback,
  ];
  expect(emitted.some((command) => invented.includes(command))).toBe(false);
}

function makeGraph(paths: string[]): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-29T00:00:00.000Z",
    activeScannerIds: ["typescript"],
    diagnostics: [],
    nodes: paths.map((filePath, index) => {
      const kind = filePath.endsWith(".md")
        ? "doc_file"
        : /tests?|spec/i.test(filePath)
          ? "test"
          : filePath.includes("workflows/")
            ? "config_file"
            : "code_file";
      return {
        id: `node:${index}`,
        kind,
        label: filePath.split("/").pop() ?? filePath,
        path: filePath,
      };
    }),
    edges: [],
  };
}

describe("graphVerificationPlan", () => {
  it("classifies docs and graph goals deterministically", () => {
    expect(classifyGoalTaskIntent("update architecture docs", "balanced")).toBe("docs");
    expect(classifyGoalTaskIntent("refresh graph export path", "balanced")).toBe("graph");
    expect(classifyGoalTaskIntent("fix backend login service", "code")).toBe("backend");
  });

  it("recommends graph checks for graph goals without inventing commands", () => {
    const graph = makeGraph(["package.json", "src/index.ts"]);
    const metadata = {
      packageScripts: {
        test: "vitest run",
        "verify:graph": "node scripts/verify-graph.js",
        "graph:check": "node scripts/graph-check.js",
      },
    };
    const verificationMap = buildVerificationMap(graph, metadata);
    const plan = buildTaskVerificationPlan({
      graph,
      goal: "verify graph export",
      queryMode: "balanced",
      metadata,
      verificationMap,
    });

    expect(plan.goalIntent).toBe("graph");
    expect(plan.verificationPlan.beforeEditing.some((command) => /graph|verify/i.test(command))).toBe(true);
    expectOnlyDiscoveredCommands(plan, verificationMap);
    expect(plan.verificationPlan.confidence).not.toBe("low");
  });

  it("recommends docs checks for documentation goals", () => {
    const graph = makeGraph(["README.md", "docs/architecture.md", "package.json"]);
    const metadata = {
      packageScripts: { "graph:docs:check": "node scripts/docs-check.js", test: "vitest run" },
      readmeText: "Run `npm run graph:docs:check` before editing docs.",
    };
    const verificationMap = buildVerificationMap(graph, metadata);
    const plan = buildTaskVerificationPlan({
      graph,
      goal: "fix broken architecture docs",
      queryMode: "docs",
      metadata,
      verificationMap,
      relevantDocPaths: ["docs/architecture.md", "README.md"],
    });

    expect(plan.goalIntent).toBe("docs");
    expect(plan.docsToCheck).toContain("docs/architecture.md");
    expect(plan.verificationPlan.beforeEditing.concat(plan.verificationPlan.afterEditing).some((command) => /docs:check/i.test(command))).toBe(true);
  });

  it("scopes backend goals toward matching test files and workspace hints", () => {
    const graph = makeGraph([
      "packages/backend/src/auth.ts",
      "packages/backend/tests/auth.test.ts",
      "package.json",
    ]);
    const metadata = {
      packageScripts: { test: "vitest run root" },
      workspacePackageScripts: {
        "packages/backend/package.json": { "test:unit": "vitest run src" },
      },
    };
    const verificationMap = buildVerificationMap(graph, metadata);
    const plan = buildTaskVerificationPlan({
      graph,
      goal: "fix backend auth redirect",
      queryMode: "code",
      metadata,
      verificationMap,
      readFirstPaths: ["packages/backend/src/auth.ts"],
    });

    expect(plan.goalIntent).toBe("backend");
    expect(plan.likelyFiles.some((path) => path.includes("packages/backend"))).toBe(true);
    expect(plan.likelyTests.some((path) => /test/i.test(path))).toBe(true);
    const workspaceTest = verificationMap.commands.find((entry) =>
      entry.command === "npm run test:unit"
      && entry.source.includes("packages/backend/package.json")
    );
    expect(workspaceTest).toBeDefined();
    expect(plan.verificationPlan.afterEditing).toContain("npm run test:unit");
    expectOnlyDiscoveredCommands(plan, verificationMap);
    expect(plan.unsupportedAssumptions.some((note) => note.includes("packages/backend"))).toBe(true);
  });

  it("does not invent workspace npm commands when only root scripts exist", () => {
    const graph = makeGraph(["packages/backend/src/auth.ts", "package.json"]);
    const metadata = {
      packageScripts: { test: "vitest run" },
    };
    const verificationMap = buildVerificationMap(graph, metadata);
    const plan = buildTaskVerificationPlan({
      graph,
      goal: "fix packages/backend auth redirect",
      queryMode: "code",
      metadata,
      verificationMap,
      readFirstPaths: ["packages/backend/src/auth.ts"],
    });

    expectNoInventedWorkspaceCommands(plan, "packages/backend");
    expectOnlyDiscoveredCommands(plan, verificationMap);
    expect(plan.unsupportedAssumptions).toContain(
      "A workspace-scoped npm command may be needed, but no discovered command was found."
    );
  });

  it("emits only verification-map commands across the full plan", () => {
    const graph = makeGraph(["package.json", "README.md", "src/index.ts"]);
    const metadata = {
      packageScripts: {
        build: "tsc --noEmit",
        test: "vitest run",
        lint: "eslint src",
        "verify:graph": "node scripts/verify-graph.js",
      },
      readmeText: "Run `npm run verify:graph` before editing.",
    };
    const verificationMap = buildVerificationMap(graph, metadata);
    const plan = buildTaskVerificationPlan({
      graph,
      goal: "fix login redirect bug",
      metadata,
      verificationMap,
    });

    expectOnlyDiscoveredCommands(plan, verificationMap);
    expect(plan.suggestedCommands.length).toBeGreaterThan(0);
  });

  it("prefers discovered workspace package scripts by source over root scripts", () => {
    const graph = makeGraph(["packages/backend/src/auth.ts", "package.json"]);
    const metadata = {
      packageScripts: { test: "vitest run root", lint: "eslint ." },
      workspacePackageScripts: {
        "packages/backend/package.json": { "test:unit": "vitest run backend" },
      },
    };
    const verificationMap = buildVerificationMap(graph, metadata);
    const workspaceTest = verificationMap.commands.find((entry) =>
      entry.command === "npm run test:unit"
      && entry.source.includes("packages/backend/package.json")
    );
    expect(workspaceTest).toBeDefined();

    const plan = buildTaskVerificationPlan({
      graph,
      goal: "fix backend auth redirect",
      metadata,
      verificationMap,
      readFirstPaths: ["packages/backend/src/auth.ts"],
    });

    expect(plan.verificationPlan.afterEditing).toContain("npm run test:unit");
    expect(plan.verificationPlan.afterEditing).not.toContain("npm run test");
    expectOnlyDiscoveredCommands(plan, verificationMap);
  });

  it("marks low-confidence plans when no commands are discovered", () => {
    const graph = makeGraph(["src/index.ts"]);
    const verificationMap = buildVerificationMap(graph, {});
    const plan = buildTaskVerificationPlan({
      graph,
      goal: "fix login",
      verificationMap,
    });

    expect(plan.verificationPlan.fallback.length).toBe(0);
    expect(plan.verificationPlan.confidence).toBe("low");
    expect(plan.riskNotes.some((note) => /No focused after-editing/i.test(note))).toBe(true);
  });
});