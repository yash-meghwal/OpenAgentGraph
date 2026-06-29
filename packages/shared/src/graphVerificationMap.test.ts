import { describe, expect, it } from "vitest";
import type { UnifiedCodeGraph } from "./codeGraph.js";
import { buildVerificationMap, formatGraphVerificationMapMarkdown } from "./graphVerificationMap.js";

function makeGraph(paths: string[]): UnifiedCodeGraph {
  return {
    schemaVersion: "1",
    workspaceRoot: "/workspace",
    generatedAt: "2026-06-26T00:00:00.000Z",
    activeScannerIds: ["typescript"],
    diagnostics: [],
    nodes: paths.map((filePath, index) => ({
      id: `file:${index}`,
      kind: filePath.endsWith(".json") || filePath.includes("workflows/") ? "config_file" : "code_file",
      label: filePath,
      path: filePath,
    })),
    edges: [],
  };
}

describe("graph verification map", () => {
  it("discovers script-defined and CI-observed commands without inventing extras", () => {
    const map = buildVerificationMap(makeGraph(["package.json", ".github/workflows/ci.yml", "src/index.ts"]), {
      packageScripts: {
        build: "tsc",
        test: "vitest run",
        lint: "eslint .",
        "verify:graph": "node scripts/verify-graph.js",
      },
      workflowTexts: {
        ".github/workflows/ci.yml": [
          "jobs:",
          "  test:",
          "    steps:",
          "      - run: npm test",
          "      - run: npm run build",
        ].join("\n"),
      },
    });

    expect(map.commands.some((entry) => entry.command === "npm run test" && entry.confidence === "script_defined")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "npm test" && entry.confidence === "ci_observed")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "npm run verify:graph")).toBe(true);
    expect(map.recommendedDefault.length).toBeGreaterThan(0);
    expect(map.commands.every((entry) => entry.command.length > 0)).toBe(true);
  });

  it("classifies risky script values before script names and excludes them from recommendedDefault", () => {
    const map = buildVerificationMap(makeGraph(["package.json"]), {
      packageScripts: {
        test: "rm -rf dist && vitest run",
        build: "del /s /q build && tsc --noEmit",
        lint: "eslint src",
      },
    });

    const riskyTest = map.commands.find((entry) => entry.command === "npm run test");
    const riskyBuild = map.commands.find((entry) => entry.command === "npm run build");
    expect(riskyTest?.category).toBe("risky");
    expect(riskyTest?.risky).toBe(true);
    expect(riskyBuild?.category).toBe("risky");
    expect(riskyBuild?.risky).toBe(true);
    expect(map.recommendedDefault).not.toContain("npm run test");
    expect(map.recommendedDefault).not.toContain("npm run build");
    expect(map.recommendedDefault).toContain("npm run lint");
  });

  it("extracts fenced README commands and multiline workflow run blocks", () => {
    const map = buildVerificationMap(makeGraph(["README.md", ".github/workflows/ci.yml"]), {
      readmeText: [
        "## Setup",
        "```bash",
        "npm ci",
        "npm run docs:check",
        "```",
      ].join("\n"),
      workflowTexts: {
        ".github/workflows/ci.yml": [
          "jobs:",
          "  verify:",
          "    steps:",
          "      - run: |",
          "          npm run lint",
          "          npm test",
        ].join("\n"),
      },
    });

    expect(map.commands.some((entry) => entry.command === "npm ci" && entry.category === "install")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "npm run docs:check" && entry.category === "docs_check")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "npm run lint" && entry.confidence === "ci_observed")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "npm test" && entry.confidence === "ci_observed")).toBe(true);
  });

  it("marks conflicting test commands and records gaps for sparse repos", () => {
    const map = buildVerificationMap(makeGraph(["package.json", "src/index.ts"]), {
      packageScripts: { test: "npm run test:integration" },
      readmeText: "Run `npm run test:unit` before opening a PR.",
    });

    expect(map.conflicts.some((conflict) => conflict.category === "unit_test")).toBe(true);
    expect(map.commands.filter((entry) => entry.category === "unit_test").some((entry) => entry.confidence === "conflicting")).toBe(true);
    expect(map.gaps).toContain("No build command discovered.");
  });

  it("discovers OAG verification scripts from root package metadata", () => {
    const map = buildVerificationMap(makeGraph(["package.json"]), {
      packageScripts: {
        "verify:graph": "node scripts/verify-graph.js",
        "verify:ci": "npm run verify && npm run verify:graph",
        "graph:check": "node scripts/graph-check.js",
      },
    });

    expect(map.commands.some((entry) => entry.command === "npm run verify:graph" && entry.category === "graph_verification")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "npm run verify:ci" && entry.category === "graph_verification")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "npm run graph:check" && entry.category === "graph_verification")).toBe(true);
    expect(map.taskHints.some((hint) => hint.task === "verify_graph_changes" && hint.commands.length > 0)).toBe(true);
  });

  it("discovers workspace package scripts and marks inferred ecosystem commands only when indexed", () => {
    const map = buildVerificationMap(makeGraph([
      "package.json",
      "packages/shared/package.json",
      "go.mod",
      "Cargo.toml",
      "src/main.go",
    ]), {
      packageScripts: { test: "vitest run" },
      workspacePackageScripts: {
        "packages/shared/package.json": { build: "tsc", test: "vitest run" },
      },
      goModTexts: { "go.mod": "module example.com/app\n\ngo 1.22\n" },
      cargoTomlTexts: { "Cargo.toml": "[package]\nname = \"app\"\n" },
    });

    expect(map.commands.some((entry) => entry.source === "packages/shared/package.json#scripts.build")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "go test ./..." && entry.confidence === "inferred")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "cargo test" && entry.confidence === "inferred")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "cargo build" && entry.confidence === "inferred")).toBe(true);
  });

  it("does not invent ecosystem commands when config files are absent from the graph", () => {
    const map = buildVerificationMap(makeGraph(["package.json", "src/index.ts"]), {
      goModTexts: { "go.mod": "module example.com/app\n" },
      cargoTomlTexts: { "Cargo.toml": "[package]\nname = \"app\"\n" },
    });

    expect(map.commands.some((entry) => entry.command === "go test ./...")).toBe(false);
    expect(map.commands.some((entry) => entry.command === "cargo test")).toBe(false);
  });

  it("infers dotnet, python, maven, and makefile commands from indexed configs", () => {
    const map = buildVerificationMap(makeGraph([
      "SampleMediaPlayer.sln",
      "SampleMediaPlayer.Tests/SampleMediaPlayer.Tests.csproj",
      "pyproject.toml",
      "pom.xml",
      "Makefile",
    ]), {
      slnTexts: { "SampleMediaPlayer.sln": "Microsoft Visual Studio Solution File" },
      csprojTexts: {
        "SampleMediaPlayer.Tests/SampleMediaPlayer.Tests.csproj": "<PackageReference Include=\"Microsoft.NET.Test.Sdk\" />",
      },
      pyprojectTexts: { "pyproject.toml": "[tool.pytest.ini_options]\n" },
      mavenTexts: { "pom.xml": "<project></project>" },
      makefileTexts: {
        Makefile: [
          "test:",
          "\tpytest -q",
          "clean:",
          "\trm -rf dist",
        ].join("\n"),
      },
    });

    expect(map.commands.some((entry) => entry.command === "dotnet test SampleMediaPlayer.sln" && entry.confidence === "inferred")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "pytest" && entry.confidence === "inferred")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "mvn test" && entry.confidence === "inferred")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "pytest -q" && entry.confidence === "script_defined")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "rm -rf dist" && entry.category === "risky")).toBe(true);
    expect(map.recommendedDefault).not.toContain("rm -rf dist");
  });

  it("formats verification map markdown with suggested and risky sections", () => {
    const map = buildVerificationMap(makeGraph(["package.json"]), {
      packageScripts: {
        test: "vitest run",
        build: "tsc",
        clean: "rm -rf dist",
        publish: "npm publish",
      },
    });
    const markdown = formatGraphVerificationMapMarkdown(map).join("\n");

    expect(markdown).toContain("## Verification map");
    expect(markdown).toContain("## Suggested commands before editing");
    expect(markdown).toContain("## Risky or release commands");
    expect(markdown).toMatch(/npm run clean/);
    expect(markdown).not.toMatch(/sk-|BEGIN .*KEY/);
  });

  it("keeps release and packaging commands out of suggested commands markdown", () => {
    const map = buildVerificationMap(makeGraph(["package.json"]), {
      packageScripts: {
        publish: "npm publish",
        release: "npm run release",
      },
    });
    const markdown = formatGraphVerificationMapMarkdown(map).join("\n");
    const suggestedSection = markdown.split("## Risky or release commands")[0];

    expect(map.recommendedDefault).toHaveLength(0);
    expect(markdown).toContain("## Risky or release commands");
    expect(markdown).toMatch(/npm run publish/);
    expect(markdown).toMatch(/npm run release/);
    expect(suggestedSection).not.toContain("## Suggested commands before editing");
    expect(suggestedSection).not.toMatch(/npm run publish/);
    expect(suggestedSection).not.toMatch(/npm run release/);
  });

  it("parses multiline tox.ini commands blocks and avoids false unit-test gaps", () => {
    const toxIni = [
      "[testenv]",
      "commands =",
      "    pytest",
      "    python -m pytest tests",
      "",
      "[testenv:lint]",
      "commands = ruff check .",
    ].join("\n");

    const map = buildVerificationMap(makeGraph(["tox.ini"]), {
      toxIniTexts: { "tox.ini": toxIni },
    });

    expect(map.commands.some((entry) => entry.command === "pytest" && entry.category === "unit_test")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "python -m pytest tests" && entry.category === "unit_test")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "ruff check ." && entry.category === "lint")).toBe(true);
    expect(map.gaps).not.toContain("No unit test command discovered.");
  });

  it("does not conflict across flutter and ctest unit_test families", () => {
    const map = buildVerificationMap(makeGraph([
      "pubspec.yaml",
      "CMakeLists.txt",
    ]), {
      pubspecTexts: { "pubspec.yaml": "name: demo\n" },
      cmakeListsTexts: {
        "CMakeLists.txt": "cmake_minimum_required(VERSION 3.16)\nenable_testing()\n",
      },
      workflowTexts: {
        ".github/workflows/ci.yml": [
          "jobs:",
          "  test:",
          "    steps:",
          "      - run: flutter test",
          "      - run: ctest --test-dir build",
        ].join("\n"),
      },
    });

    expect(map.commands.some((entry) => entry.command === "flutter test")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "ctest --test-dir build")).toBe(true);
    expect(map.conflicts).toHaveLength(0);
    expect(map.commands.filter((entry) => entry.category === "unit_test").every((entry) => entry.confidence !== "conflicting")).toBe(true);
  });

  it("parses makefile recipes with a leading @ before classification", () => {
    const map = buildVerificationMap(makeGraph(["Makefile"]), {
      makefileTexts: {
        Makefile: [
          "test:",
          "\t@pytest -q",
        ].join("\n"),
      },
    });

    expect(map.commands.some((entry) => entry.command === "pytest -q" && entry.category === "unit_test")).toBe(true);
    expect(map.commands.some((entry) => entry.command === "make test")).toBe(false);
  });
});