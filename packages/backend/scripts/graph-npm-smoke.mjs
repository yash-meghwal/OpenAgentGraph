import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const workspaceRoot = process.argv[2];
const useNpmForwarding = process.argv.includes("--npm");

if (!workspaceRoot) {
  console.error("graph-npm-smoke.mjs requires a workspace path argument.");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const graphQueryEntry = path.join(repoRoot, "packages", "backend", "dist", "cli", "graphQuery.js");
const queryArgs = ["--workspace", workspaceRoot, "--json", "MainViewModel"];
const spawnOptions = {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
};

function resolveNpmSpawnArgs() {
  const npmArgs = ["run", "graph:query", "--", ...queryArgs];
  if (process.platform === "win32") {
    // npm.cmd cannot be spawned without shell:true on Windows (EINVAL); invoke npm-cli.js via node instead.
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    return { command: process.execPath, args: [npmCli, ...npmArgs] };
  }
  return { command: "npm", args: npmArgs };
}

const spawnTarget = useNpmForwarding
  ? resolveNpmSpawnArgs()
  : { command: process.execPath, args: [graphQueryEntry, ...queryArgs] };

const result = spawnSync(spawnTarget.command, spawnTarget.args, spawnOptions);

if (result.status !== 0) {
  process.stderr.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  process.exit(result.status ?? 1);
}

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const jsonStart = output.indexOf("{");
if (jsonStart < 0) {
  process.stderr.write(output);
  process.exit(1);
}

const payload = JSON.parse(output.slice(jsonStart));
process.stdout.write(JSON.stringify({ workspaceRoot: payload.workspaceRoot }));