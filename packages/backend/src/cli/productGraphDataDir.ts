import fs from "fs/promises";
import path from "path";

const OPENAGENTGRAPH_DB_FILE_NAME = "openagentgraph.db";

export function readRequiredCliValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function resolvePackageWorkspaceRoot(startDirectory = process.cwd()) {
  let current = path.resolve(startDirectory);
  while (true) {
    try {
      const packageJson = JSON.parse(await fs.readFile(path.join(current, "package.json"), "utf8")) as {
        workspaces?: unknown;
      };
      if (packageJson.workspaces) return current;
    } catch {
      // Keep walking upward until a workspace package.json is found.
    }

    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDirectory);
    current = parent;
  }
}

export async function resolveProductGraphCliDataDir(input: {
  applicationRoot: string;
  explicitDataDir?: string;
  envDataDir?: string;
  cwd?: string;
  fileExists?: (filePath: string) => Promise<boolean>;
}) {
  const cwd = input.cwd ? path.resolve(input.cwd) : process.cwd();
  if (input.explicitDataDir) return path.resolve(cwd, input.explicitDataDir);
  if (input.envDataDir) return undefined;

  const exists = input.fileExists ?? fileExists;
  const backendDataDir = path.join(path.resolve(input.applicationRoot), "packages", "backend", "data");
  const backendDbPath = path.join(backendDataDir, OPENAGENTGRAPH_DB_FILE_NAME);
  return (await exists(backendDbPath)) ? backendDataDir : undefined;
}

export async function applyProductGraphCliDataDir(input: {
  explicitDataDir?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  applicationRoot?: string;
}) {
  const env = input.env ?? process.env;
  const applicationRoot = input.applicationRoot ?? await resolvePackageWorkspaceRoot(input.cwd);
  const dataDir = await resolveProductGraphCliDataDir({
    applicationRoot,
    explicitDataDir: input.explicitDataDir,
    envDataDir: env.DATA_DIR,
    cwd: input.cwd,
  });
  if (dataDir) {
    env.DATA_DIR = dataDir;
  }
  return dataDir;
}
