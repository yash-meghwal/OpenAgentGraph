import path from "path";

export interface ElectronShellRuntime {
  rendererUrl?: string;
  backendUrl: string;
  shouldSpawnBackend: boolean;
  nodeBinary: string;
  preloadPath: string;
  frontendIndexPath: string;
  backendEntryPath: string;
  additionalArguments: string[];
}

export function resolveElectronShellRuntime(input: {
  electronDistDir: string;
  env: NodeJS.ProcessEnv;
}): ElectronShellRuntime {
  const rendererUrl = input.env.OPENAGENTGRAPH_ELECTRON_RENDERER_URL?.trim() || undefined;
  const backendUrl =
    input.env.OPENAGENTGRAPH_ELECTRON_BACKEND_URL?.trim() ||
    `http://127.0.0.1:${input.env.PORT ?? "3001"}`;
  const shouldSpawnBackend = !rendererUrl && !input.env.OPENAGENTGRAPH_ELECTRON_BACKEND_URL;
  const nodeBinary =
    input.env.OPENAGENTGRAPH_NODE_BINARY?.trim() ||
    input.env.npm_node_execpath?.trim() ||
    "node";

  const preloadPath = path.resolve(input.electronDistDir, "preload.js");
  const frontendIndexPath = path.resolve(
    input.electronDistDir,
    "../../frontend/dist/index.html"
  );
  const backendEntryPath = path.resolve(
    input.electronDistDir,
    "../../backend/dist/index.js"
  );

  return {
    rendererUrl,
    backendUrl,
    shouldSpawnBackend,
    nodeBinary,
    preloadPath,
    frontendIndexPath,
    backendEntryPath,
    additionalArguments: [`--openagentgraph-backend-url=${backendUrl}`],
  };
}
