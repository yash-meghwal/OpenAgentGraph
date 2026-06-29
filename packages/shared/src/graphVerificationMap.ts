import type { UnifiedCodeGraph } from "./codeGraph.js";
import type { HarnessWorkspaceMetadata } from "./graphHarnessReadiness.js";

export type VerificationCommandCategory =
  | "install"
  | "build"
  | "typecheck"
  | "lint"
  | "unit_test"
  | "integration_test"
  | "graph_verification"
  | "docs_check"
  | "packaging"
  | "release"
  | "risky";

export type VerificationCommandConfidence =
  | "script_defined"
  | "ci_observed"
  | "doc_mentioned"
  | "inferred"
  | "conflicting";

export interface GraphVerificationCommand {
  command: string;
  category: VerificationCommandCategory;
  confidence: VerificationCommandConfidence;
  source: string;
  risky?: boolean;
}

export interface GraphVerificationTaskHint {
  task: string;
  commands: string[];
}

export interface GraphVerificationConflict {
  category: VerificationCommandCategory;
  detail: string;
  commands: string[];
}

export interface GraphVerificationMap {
  commands: GraphVerificationCommand[];
  recommendedDefault: string[];
  taskHints: GraphVerificationTaskHint[];
  conflicts: GraphVerificationConflict[];
  gaps: string[];
}

const SCRIPT_CATEGORY_BY_NAME: Record<string, VerificationCommandCategory> = {
  postinstall: "install",
  preinstall: "install",
  install: "install",
  prepare: "install",
  build: "build",
  typecheck: "typecheck",
  "type-check": "typecheck",
  lint: "lint",
  test: "unit_test",
  "test:unit": "unit_test",
  "test:integration": "integration_test",
  "test:e2e": "integration_test",
  "verify:graph": "graph_verification",
  "verify:ci": "graph_verification",
  "graph:check": "graph_verification",
  "graph:docs:check": "docs_check",
  "docs:check": "docs_check",
  pack: "packaging",
  prepublishOnly: "packaging",
  release: "release",
  publish: "release",
  clean: "risky",
  destroy: "risky",
};

const RISKY_SCRIPT_PATTERN = /(?:clean|destroy|reset|drop|purge|rm -rf|del \/s)/i;

const RECOMMENDED_CATEGORIES = new Set<VerificationCommandCategory>([
  "install",
  "build",
  "unit_test",
  "lint",
  "graph_verification",
]);

const MAKEFILE_TARGET_CATEGORIES: Record<string, VerificationCommandCategory> = {
  install: "install",
  setup: "install",
  build: "build",
  test: "unit_test",
  lint: "lint",
  check: "typecheck",
  clean: "risky",
  distclean: "risky",
  release: "release",
  package: "packaging",
};

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

function collectIndexedPaths(graph: UnifiedCodeGraph) {
  const paths = new Set<string>();
  for (const node of graph.nodes) {
    const candidate = node.path ?? node.label;
    if (!candidate) continue;
    if (!["code_file", "config_file", "doc_file", "test", "command"].includes(node.kind)) continue;
    paths.add(normalizePath(candidate));
  }
  return paths;
}

function hasIndexedPath(paths: Set<string>, matcher: RegExp) {
  return [...paths].some((path) => matcher.test(path));
}

function isRiskyScript(scriptName: string, scriptValue: string) {
  return RISKY_SCRIPT_PATTERN.test(scriptValue) || RISKY_SCRIPT_PATTERN.test(scriptName);
}

function classifyScriptName(scriptName: string, scriptValue: string): VerificationCommandCategory {
  if (isRiskyScript(scriptName, scriptValue)) return "risky";
  if (SCRIPT_CATEGORY_BY_NAME[scriptName]) return SCRIPT_CATEGORY_BY_NAME[scriptName];
  if (/test|spec/i.test(scriptName)) {
    return /integration|e2e/i.test(scriptName) ? "integration_test" : "unit_test";
  }
  if (/graph:|verify:/i.test(scriptValue)) return "graph_verification";
  if (/docs:check/i.test(scriptValue)) return "docs_check";
  return "build";
}

function classifyShellCommand(command: string): VerificationCommandCategory {
  if (RISKY_SCRIPT_PATTERN.test(command)) return "risky";
  if (/npm (?:ci|install)|pnpm install|yarn install|pip install/i.test(command)) return "install";
  if (/npm (?:run )?test|vitest|jest|pytest|go test|cargo test|dotnet test|dart test|flutter test|mvn test|gradle test|ctest/i.test(command)) {
    return /integration|e2e/i.test(command) ? "integration_test" : "unit_test";
  }
  if (/npm run (?:build|compile)|cargo build|dotnet build|go build|cmake --build|make\b|mvn package|gradle build/i.test(command)) {
    return "build";
  }
  if (/npm run lint|eslint\b|ruff check|clippy/i.test(command)) return "lint";
  if (/verify:graph|graph:check|verify:ci/i.test(command)) return "graph_verification";
  if (/graph:docs:check|docs:check/i.test(command)) return "docs_check";
  if (/mvn deploy|npm publish|cargo publish|dotnet publish/i.test(command)) return "release";
  return "build";
}

function npmRunCommand(scriptName: string) {
  return `npm run ${scriptName}`;
}

function makeCommand(
  command: string,
  category: VerificationCommandCategory,
  confidence: VerificationCommandConfidence,
  source: string
): GraphVerificationCommand {
  return {
    command,
    category,
    confidence,
    source,
    risky: category === "risky",
  };
}

function commandsFromPackageScripts(
  scripts: Record<string, string>,
  sourcePrefix: string
): GraphVerificationCommand[] {
  return Object.entries(scripts).map(([name, value]) => {
    const category = classifyScriptName(name, value);
    return makeCommand(npmRunCommand(name), category, "script_defined", `${sourcePrefix}#scripts.${name}`);
  });
}

function extractWorkflowRunCommands(text: string) {
  const commands: string[] = [];

  for (const match of text.matchAll(/^\s*-?\s*run:\s*(.+)$/gim)) {
    const value = match[1].trim();
    if (!value || value === "|" || value === ">") continue;
    commands.push(value);
  }

  for (const match of text.matchAll(/run:\s*\|\s*\r?\n((?:[ \t]+.+(?:\r?\n|$))+)/gi)) {
    for (const line of match[1].split(/\r?\n/)) {
      const command = line.trim().replace(/^-\s+/, "");
      if (!command || command.startsWith("#")) continue;
      commands.push(command);
    }
  }

  return commands;
}

function commandsFromWorkflowTexts(workflowTexts: Record<string, string>): GraphVerificationCommand[] {
  const commands: GraphVerificationCommand[] = [];
  for (const [workflowPath, text] of Object.entries(workflowTexts)) {
    for (const command of extractWorkflowRunCommands(text)) {
      const category = classifyShellCommand(command);
      commands.push(makeCommand(command, category, "ci_observed", workflowPath));
    }
  }
  return commands;
}

function extractDocCommands(text: string) {
  const commands: string[] = [];

  for (const match of text.matchAll(/`([^`]+)`/g)) {
    commands.push(match[1].trim());
  }

  for (const match of text.matchAll(/```(?:bash|sh|shell|console|text)?\s*\r?\n([\s\S]*?)```/gi)) {
    for (const line of match[1].split(/\r?\n/)) {
      const command = line.trim().replace(/^-\s+/, "");
      if (command) commands.push(command);
    }
  }

  return commands.filter((command) =>
    /^(npm|pnpm|yarn|npx|cargo|go|dotnet|make|mvn|gradle|pytest|python|dart|flutter)\b/.test(command)
  );
}

function commandsFromDocTexts(docTexts: Record<string, string> | undefined, sourceLabel = "README.md") {
  if (!docTexts) return [] as GraphVerificationCommand[];
  const commands: GraphVerificationCommand[] = [];
  for (const [docPath, text] of Object.entries(docTexts)) {
    for (const command of extractDocCommands(text)) {
      const category = classifyShellCommand(command);
      commands.push(makeCommand(command, category, "doc_mentioned", docPath || sourceLabel));
    }
  }
  return commands;
}

function extractToxCommands(text: string) {
  const commands: string[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*commands\s*=\s*(.*)$/i);
    if (!match) continue;

    const remainder = match[1].trim();
    if (remainder) {
      commands.push(remainder);
      continue;
    }

    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      if (/^\s*$/.test(next)) {
        index += 1;
        break;
      }
      if (/^\[/.test(next)) break;
      if (/^\S/.test(next)) break;
      if (/^\s+\S/.test(next)) {
        index += 1;
        const command = next.trim();
        if (command && !command.startsWith("#")) commands.push(command);
        continue;
      }
      break;
    }
  }

  return commands;
}

function commandsFromToxIniTexts(toxIniTexts: Record<string, string> | undefined) {
  if (!toxIniTexts) return [] as GraphVerificationCommand[];
  const commands: GraphVerificationCommand[] = [];
  for (const [filePath, text] of Object.entries(toxIniTexts)) {
    for (const command of extractToxCommands(text)) {
      const category = classifyShellCommand(command);
      commands.push(makeCommand(command, category, "script_defined", filePath));
    }
  }
  return commands;
}

function extractMakefileTargets(text: string) {
  const commands: GraphVerificationCommand[] = [];
  const blocks = text.split(/\r?\n(?=[A-Za-z0-9_.-]+:)/);
  for (const block of blocks) {
    const headerMatch = block.match(/^([A-Za-z0-9_.-]+):/);
    if (!headerMatch) continue;
    const target = headerMatch[1];
    const category = MAKEFILE_TARGET_CATEGORIES[target] ?? (/test/i.test(target) ? "unit_test" : "build");
    const recipeLines = block.split(/\r?\n/).slice(1)
      .map((line) => line.replace(/^\t+/, "").trim().replace(/^@+/, "").trim())
      .filter((line) => line && !line.startsWith("#"));
    const recipe = recipeLines[0];
    if (recipe && !recipe.startsWith("$")) {
      commands.push(makeCommand(recipe, classifyShellCommand(recipe), "script_defined", `Makefile#${target}`));
    } else {
      commands.push(makeCommand(`make ${target}`, category, "inferred", `Makefile#${target}`));
    }
  }
  return commands;
}

function commandsFromMakefileTexts(makefileTexts: Record<string, string> | undefined) {
  if (!makefileTexts) return [] as GraphVerificationCommand[];
  return Object.entries(makefileTexts).flatMap(([, text]) => extractMakefileTargets(text));
}

function inferEcosystemCommands(
  paths: Set<string>,
  metadata: HarnessWorkspaceMetadata
): GraphVerificationCommand[] {
  const commands: GraphVerificationCommand[] = [];

  if (hasIndexedPath(paths, /(?:^|\/)go\.mod$/i)) {
    const source = Object.keys(metadata.goModTexts ?? {})[0] ?? "go.mod";
    commands.push(makeCommand("go test ./...", "unit_test", "inferred", source));
    commands.push(makeCommand("go build ./...", "build", "inferred", source));
  }

  if (hasIndexedPath(paths, /(?:^|\/)Cargo\.toml$/i)) {
    const source = Object.keys(metadata.cargoTomlTexts ?? {})[0] ?? "Cargo.toml";
    commands.push(makeCommand("cargo test", "unit_test", "inferred", source));
    commands.push(makeCommand("cargo build", "build", "inferred", source));
  }

  if (hasIndexedPath(paths, /(?:^|\/)[^/]+\.sln$/i)) {
    const source = Object.keys(metadata.slnTexts ?? {})[0] ?? "solution.sln";
    commands.push(makeCommand(`dotnet build ${source}`, "build", "inferred", source));
    commands.push(makeCommand(`dotnet test ${source}`, "unit_test", "inferred", source));
  } else if (hasIndexedPath(paths, /(?:^|\/)[^/]+\.csproj$/i)) {
    const source = Object.keys(metadata.csprojTexts ?? {})[0] ?? "project.csproj";
    const hasTestSdk = Object.values(metadata.csprojTexts ?? {}).some((text) => /Microsoft\.NET\.Test\.Sdk/i.test(text));
    commands.push(makeCommand(`dotnet build ${source}`, "build", "inferred", source));
    if (hasTestSdk) {
      commands.push(makeCommand(`dotnet test ${source}`, "unit_test", "inferred", source));
    }
  }

  if (hasIndexedPath(paths, /(?:^|\/)pyproject\.toml$/i) || hasIndexedPath(paths, /(?:^|\/)pytest\.ini$/i)) {
    const source = Object.keys(metadata.pyprojectTexts ?? {})[0]
      ?? Object.keys(metadata.pytestIniTexts ?? {})[0]
      ?? "pyproject.toml";
    commands.push(makeCommand("pytest", "unit_test", "inferred", source));
  }

  if (hasIndexedPath(paths, /(?:^|\/)pubspec\.yaml$/i)) {
    const source = Object.keys(metadata.pubspecTexts ?? {})[0] ?? "pubspec.yaml";
    const text = metadata.pubspecTexts?.[source] ?? "";
    const command = /flutter:/i.test(text) ? "flutter test" : "dart test";
    commands.push(makeCommand(command, "unit_test", "inferred", source));
    commands.push(makeCommand(/flutter:/i.test(text) ? "flutter build" : "dart pub get", "build", "inferred", source));
  }

  if (hasIndexedPath(paths, /(?:^|\/)build\.gradle(?:\.kts)?$/i)) {
    const source = Object.keys(metadata.gradleTexts ?? {})[0] ?? "build.gradle";
    commands.push(makeCommand("./gradlew test", "unit_test", "inferred", source));
    commands.push(makeCommand("./gradlew build", "build", "inferred", source));
  }

  if (hasIndexedPath(paths, /(?:^|\/)pom\.xml$/i)) {
    const source = Object.keys(metadata.mavenTexts ?? {})[0] ?? "pom.xml";
    commands.push(makeCommand("mvn test", "unit_test", "inferred", source));
    commands.push(makeCommand("mvn package", "build", "inferred", source));
  }

  if (hasIndexedPath(paths, /(?:^|\/)CMakeLists\.txt$/i)) {
    const source = Object.keys(metadata.cmakeListsTexts ?? {})[0] ?? "CMakeLists.txt";
    const text = metadata.cmakeListsTexts?.[source] ?? "";
    commands.push(makeCommand("cmake --build build", "build", "inferred", source));
    if (/enable_testing\s*\(/i.test(text)) {
      commands.push(makeCommand("ctest --test-dir build", "unit_test", "inferred", source));
    }
  }

  return commands;
}

function dedupeCommands(commands: GraphVerificationCommand[]) {
  const seen = new Set<string>();
  return commands.filter((entry) => {
    const key = `${entry.category}::${entry.command.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeComparableCommand(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized === "npm test") return "npm run test";
  return normalized;
}

function commandFamily(command: string) {
  const normalized = normalizeComparableCommand(command);
  if (/^(npm run |npm test|npm ci|pnpm |yarn |npx )/.test(normalized)) return "npm";
  if (/^go /.test(normalized)) return "go";
  if (/^cargo /.test(normalized)) return "cargo";
  if (/^dotnet /.test(normalized)) return "dotnet";
  if (/^pytest/.test(normalized) || /^python -m pytest/.test(normalized)) return "pytest";
  if (/^mvn /.test(normalized)) return "maven";
  if (/^make /.test(normalized)) return "make";
  if (/^cmake /.test(normalized)) return "cmake";
  if (/^ctest\b/.test(normalized)) return "ctest";
  if (/^flutter /.test(normalized)) return "flutter";
  if (/^dart /.test(normalized)) return "dart";
  if (/^ruff /.test(normalized) || /^python -m ruff/.test(normalized)) return "ruff";
  if (/^python -m (flake8|pylint|mypy)/.test(normalized)) return "python-lint";
  if (/^\.\/gradlew|^gradle /.test(normalized)) return "gradle";
  return "other";
}

function detectConflicts(commands: GraphVerificationCommand[]): GraphVerificationConflict[] {
  const conflicts: GraphVerificationConflict[] = [];
  const byCategoryFamily = new Map<string, GraphVerificationCommand[]>();
  for (const command of commands) {
    if (command.category === "risky" || command.risky || command.confidence === "inferred") continue;
    const key = `${command.category}::${commandFamily(command.command)}`;
    const bucket = byCategoryFamily.get(key) ?? [];
    bucket.push(command);
    byCategoryFamily.set(key, bucket);
  }

  for (const [key, entries] of byCategoryFamily) {
    const category = key.split("::")[0] as VerificationCommandCategory;
    if (category !== "unit_test" && category !== "build") continue;
    const normalized = new Set(entries.map((entry) => normalizeComparableCommand(entry.command)));
    if (normalized.size <= 1) continue;
    conflicts.push({
      category,
      detail: `Multiple ${category.replace(/_/g, " ")} commands were discovered with different values.`,
      commands: entries.map((entry) => entry.command),
    });
    for (const entry of entries) {
      entry.confidence = "conflicting";
    }
  }

  return conflicts;
}

function isRecommendable(command: GraphVerificationCommand) {
  return !command.risky
    && command.category !== "risky"
    && (command.confidence === "script_defined" || command.confidence === "ci_observed")
    && RECOMMENDED_CATEGORIES.has(command.category);
}

const NON_SUGGESTED_CATEGORIES = new Set<VerificationCommandCategory>([
  "risky",
  "release",
  "packaging",
]);

function isSuggestableCommand(command: GraphVerificationCommand) {
  return !command.risky && !NON_SUGGESTED_CATEGORIES.has(command.category);
}

function resolveSuggestedCommands(map: GraphVerificationMap) {
  if (map.recommendedDefault.length > 0) {
    return map.recommendedDefault
      .map((command) => map.commands.find((entry) => entry.command === command))
      .filter((entry): entry is GraphVerificationCommand => Boolean(entry && isSuggestableCommand(entry)))
      .map((entry) => entry.command);
  }

  return map.commands
    .filter((entry) => isSuggestableCommand(entry))
    .slice(0, 6)
    .map((entry) => entry.command);
}

export function formatGraphVerificationMapMarkdown(map: GraphVerificationMap): string[] {
  const lines = [
    "## Verification map",
    "",
    `- Commands discovered: ${map.commands.length}`,
    `- Recommended defaults: ${map.recommendedDefault.length}`,
    `- Conflicts: ${map.conflicts.length}`,
    `- Gaps: ${map.gaps.length}`,
    "",
  ];

  const suggested = resolveSuggestedCommands(map);

  if (suggested.length > 0) {
    lines.push("## Suggested commands before editing", "");
    for (const command of suggested.slice(0, 8)) {
      const entry = map.commands.find((item) => item.command === command);
      const confidence = entry?.confidence ?? "inferred";
      lines.push(`- \`${command}\` (${confidence})`);
    }
    lines.push("");
  }

  const riskyCommands = map.commands.filter((entry) => entry.risky || entry.category === "risky");
  const releaseCommands = map.commands.filter((entry) =>
    entry.category === "release" || entry.category === "packaging"
  );
  const guardrailCommands = [...new Map(
    [...riskyCommands, ...releaseCommands].map((entry) => [entry.command, entry])
  ).values()];

  if (guardrailCommands.length > 0) {
    lines.push("## Risky or release commands", "");
    for (const entry of guardrailCommands.slice(0, 8)) {
      lines.push(`- \`${entry.command}\` (${entry.category}, ${entry.confidence})`);
    }
    lines.push("");
  }

  if (map.taskHints.length > 0) {
    lines.push("### Task hints", "");
    for (const hint of map.taskHints.slice(0, 6)) {
      lines.push(`- ${hint.task}: ${hint.commands.map((command) => `\`${command}\``).join(", ")}`);
    }
    lines.push("");
  }

  if (map.conflicts.length > 0) {
    lines.push("### Conflicts", "");
    for (const conflict of map.conflicts.slice(0, 6)) {
      lines.push(`- ${conflict.detail}`);
      for (const command of conflict.commands.slice(0, 4)) {
        lines.push(`  - \`${command}\``);
      }
    }
    lines.push("");
  }

  if (map.gaps.length > 0) {
    lines.push("### Gaps", "");
    for (const gap of map.gaps.slice(0, 6)) {
      lines.push(`- ${gap}`);
    }
    lines.push("");
  }

  return lines;
}

export function buildVerificationMap(
  graph: UnifiedCodeGraph,
  metadata: HarnessWorkspaceMetadata = {}
): GraphVerificationMap {
  const paths = collectIndexedPaths(graph);
  const readmeDocs = metadata.readmeText ? { "README.md": metadata.readmeText } : undefined;
  const commands = dedupeCommands([
    ...commandsFromPackageScripts(metadata.packageScripts ?? {}, "package.json"),
    ...Object.entries(metadata.workspacePackageScripts ?? {}).flatMap(([packagePath, scripts]) =>
      commandsFromPackageScripts(scripts, packagePath)
    ),
    ...commandsFromWorkflowTexts(metadata.workflowTexts ?? {}),
    ...commandsFromDocTexts(readmeDocs),
    ...commandsFromDocTexts(metadata.docTexts),
    ...commandsFromToxIniTexts(metadata.toxIniTexts),
    ...commandsFromMakefileTexts(metadata.makefileTexts),
    ...inferEcosystemCommands(paths, metadata),
  ]);

  const conflicts = detectConflicts(commands);
  const gaps: string[] = [];
  const categoriesPresent = new Set(
    commands.filter((entry) => !entry.risky && entry.category !== "risky").map((entry) => entry.category)
  );

  if (!categoriesPresent.has("install") && hasIndexedPath(paths, /package\.json$/i)) {
    gaps.push("No install/setup command discovered.");
  }
  if (!categoriesPresent.has("unit_test")) gaps.push("No unit test command discovered.");
  if (!categoriesPresent.has("build")) gaps.push("No build command discovered.");
  if (!categoriesPresent.has("graph_verification") && hasIndexedPath(paths, /(?:^|\/)package\.json$/i)) {
    gaps.push("No graph/OAG verification command discovered.");
  }

  const recommendedDefault = commands
    .filter((entry) => isRecommendable(entry))
    .slice(0, 6)
    .map((entry) => entry.command);

  const taskHints: GraphVerificationTaskHint[] = [
    {
      task: "verify_graph_changes",
      commands: commands.filter((entry) => entry.category === "graph_verification" && !entry.risky).map((entry) => entry.command),
    },
    {
      task: "run_unit_tests",
      commands: commands.filter((entry) => entry.category === "unit_test" && !entry.risky).map((entry) => entry.command),
    },
    {
      task: "check_docs",
      commands: commands.filter((entry) => entry.category === "docs_check" && !entry.risky).map((entry) => entry.command),
    },
  ].filter((hint) => hint.commands.length > 0);

  return {
    commands,
    recommendedDefault,
    taskHints,
    conflicts,
    gaps,
  };
}