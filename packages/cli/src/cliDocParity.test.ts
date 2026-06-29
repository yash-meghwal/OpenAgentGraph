import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { OAG_CLI_COMMANDS } from "./backendCli.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

const PUBLIC_DOC_PATHS = [
  "README.md",
  "llms.txt",
  "LLMS.md",
  path.join("packages", "cli", "README.md"),
];

const IGNORED_OAG_TOKENS = new Set(["--help", "--version", "-h", "-v", "help"]);

const NPX_CLI_PATTERN = /npx\s+@openagentgraph\/cli@[\w.-]+\s+([^\s]+)/g;
const OAG_CLI_PATTERN = /\boag\s+([a-z][a-z0-9:]*)/g;
const LLMS_TABLE_COMMAND_PATTERN = /^\|\s*`([^`]+)`\s*\|/gm;

function listDocFiles(): string[] {
  const docsDir = path.join(repoRoot, "docs");
  const docFiles = fs.readdirSync(docsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join("docs", name));
  return [...PUBLIC_DOC_PATHS, ...docFiles].map((relativePath) => path.join(repoRoot, relativePath));
}

function extractNpxAndOagCommands(content: string): string[] {
  const commands: string[] = [];
  for (const match of content.matchAll(NPX_CLI_PATTERN)) {
    commands.push(match[1]!);
  }
  for (const match of content.matchAll(OAG_CLI_PATTERN)) {
    const command = match[1]!;
    if (!IGNORED_OAG_TOKENS.has(command)) {
      commands.push(command);
    }
  }
  return commands;
}

function extractLlmsTableCommands(content: string): string[] {
  const commands: string[] = [];
  let inCliTable = false;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("## CLI commands")) {
      inCliTable = true;
      continue;
    }
    if (inCliTable && line.startsWith("## ")) {
      break;
    }
    if (!inCliTable) continue;
    const match = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match) {
      commands.push(match[1]!);
    }
  }
  return commands;
}

describe("public docs CLI parity", () => {
  it("routes every npx/oag command advertised in public docs", () => {
    const advertised = new Set<string>();
    const missingByFile = new Map<string, string[]>();

    for (const filePath of listDocFiles()) {
      const content = fs.readFileSync(filePath, "utf8");
      const commands = extractNpxAndOagCommands(content);
      const unknown = commands.filter((command) => !OAG_CLI_COMMANDS.includes(command as typeof OAG_CLI_COMMANDS[number]));
      if (unknown.length > 0) {
        missingByFile.set(path.relative(repoRoot, filePath), unknown);
      }
      for (const command of commands) {
        advertised.add(command);
      }
    }

    expect(missingByFile.size, JSON.stringify(Object.fromEntries(missingByFile), null, 2)).toBe(0);
    expect(advertised.size).toBeGreaterThan(0);
  });

  it("routes every llms.txt published CLI table command", () => {
    const llmsPath = path.join(repoRoot, "llms.txt");
    const tableCommands = extractLlmsTableCommands(fs.readFileSync(llmsPath, "utf8"));
    expect(tableCommands.length).toBeGreaterThan(0);

    const unknown = tableCommands.filter((command) => !OAG_CLI_COMMANDS.includes(command as typeof OAG_CLI_COMMANDS[number]));
    expect(unknown).toEqual([]);
  });
});