import {
  buildGraphAgentContextPack,
  renderGraphAgentContextMarkdown,
} from "@openagentgraph/shared";
import { buildHarnessContextNoiseDiagnostics, loadHarnessWorkspaceMetadata } from "./graphHarnessMetadata.js";
import { detectWorkspaceKernelProfile } from "../scanner/kernel/workspaceDetection.js";
import {
  loadWorkspaceUnifiedGraph,
  normalizeGraphCliText,
  parseGraphWorkspaceArgv,
  readHandoffFreshness,
  requireWorkspaceOption,
  warnIgnoredGraphCliOptions,
} from "./graphWorkspace.js";

interface GraphContextCliOptions {
  goal?: string;
  redactRoot: boolean;
  includeVerification: boolean;
}

function parseGraphContextArgv(argv: string[]) {
  const contextOptions: GraphContextCliOptions = { redactRoot: false, includeVerification: false };
  const stripped: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--goal") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--goal requires a value.");
      }
      contextOptions.goal = normalizeGraphCliText(value);
      index += 1;
    } else if (arg === "--redact-root") {
      contextOptions.redactRoot = true;
    } else if (arg === "--include-verification") {
      contextOptions.includeVerification = true;
    } else {
      stripped.push(arg);
    }
  }

  const parsed = parseGraphWorkspaceArgv(stripped, "context");
  if (parsed.positionals.length > 0) {
    throw new Error(`Unknown graph:context arguments: ${parsed.positionals.join(" ")}`);
  }

  return { graphOptions: parsed.options, contextOptions };
}

export async function runGraphContextCli(argv = process.argv.slice(2)) {
  const { graphOptions, contextOptions } = parseGraphContextArgv(argv);
  if (!graphOptions.json) warnIgnoredGraphCliOptions("context", graphOptions);
  const workspaceRoot = requireWorkspaceOption(graphOptions.workspace);
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: graphOptions.refresh });
  const kernelProfile = loaded.kernelProfile ?? await detectWorkspaceKernelProfile(workspaceRoot);
  const handoffFreshness = await readHandoffFreshness(workspaceRoot, loaded.graph.generatedAt);

  const harnessMetadata = loadHarnessWorkspaceMetadata(workspaceRoot);
  const pack = buildGraphAgentContextPack(loaded.graph, {
    goal: contextOptions.goal,
    queryMode: graphOptions.queryMode,
    lens: graphOptions.lens,
    budget: graphOptions.budget !== 40 ? graphOptions.budget : 12_000,
    workspaceRoot,
    redactRoot: contextOptions.redactRoot,
    kernelProfile,
    handoffFreshness,
    includeVerification: contextOptions.includeVerification,
    harnessMetadata: contextOptions.includeVerification ? harnessMetadata : undefined,
    contextNoiseDiagnostics: buildHarnessContextNoiseDiagnostics(workspaceRoot, loaded.graph, {
      metadata: harnessMetadata,
      kernelProfile,
    }),
  });

  const payload = {
    ...pack,
    fromCache: loaded.fromCache,
    status: pack.status,
  };

  if (graphOptions.json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(renderGraphAgentContextMarkdown(payload));
  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphContext\.(?:ts|js)$/.test(invokedPath)) {
  runGraphContextCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
