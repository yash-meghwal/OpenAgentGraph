#!/usr/bin/env node
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OAG_CLI_COMMANDS, renderOagCliHelp, resolveBackendCliEntry } from "./backendCli.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(renderOagCliHelp());
    return;
  }

  if (command === "--version" || command === "-v") {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { version: string };
    console.log(pkg.version);
    return;
  }

  if (!OAG_CLI_COMMANDS.includes(command as typeof OAG_CLI_COMMANDS[number])) {
    console.error(`Unknown command: ${command}`);
    console.error(renderOagCliHelp());
    process.exitCode = 1;
    return;
  }

  const entry = resolveBackendCliEntry(command);
  if (!entry) {
    console.error(`Failed to resolve backend entry for ${command}.`);
    process.exitCode = 1;
    return;
  }

  const childEnv = { ...process.env };
  delete childEnv.VITEST;
  const child = spawnSync(process.execPath, [entry, ...argv.slice(1)], {
    stdio: "inherit",
    env: childEnv,
  });
  if (child.error) {
    console.error(child.error.message);
    process.exitCode = 1;
    return;
  }
  process.exitCode = child.status ?? 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});