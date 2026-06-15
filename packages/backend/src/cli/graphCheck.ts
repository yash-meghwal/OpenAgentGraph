import {
  evaluateOagFusionChecks,
} from "@openagentgraph/shared";
import { applyProductGraphCliDataDir, readRequiredCliValue } from "./productGraphDataDir.js";
import {
  loadWorkspaceUnifiedGraph,
  parseGraphWorkspaceArgv,
  readHandoffFreshness,
  readPreviousSymbolCount,
  requireWorkspaceOption,
} from "./graphWorkspace.js";
import { detectWorkspaceKernelProfile } from "../scanner/kernel/workspaceDetection.js";

type GraphCheckMode = "hard" | "warn";

interface GraphCheckCliOptions {
  mode: GraphCheckMode;
  productGraphId?: string;
  dataDir?: string;
}

function stripGraphCheckOnlyFlags(argv: string[]) {
  const stripped: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode" || arg === "--product-graph-id" || arg === "--data-dir") {
      index += 1;
      continue;
    }
    stripped.push(arg);
  }
  return stripped;
}

function parseGraphCheckArgv(argv: string[]) {
  const checkOptions: GraphCheckCliOptions = { mode: "hard" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      const mode = argv[index + 1];
      if (mode !== "hard" && mode !== "warn") {
        throw new Error("--mode must be hard or warn.");
      }
      checkOptions.mode = mode;
      index += 1;
    } else if (arg === "--product-graph-id") {
      checkOptions.productGraphId = readRequiredCliValue(argv, index, "--product-graph-id");
      index += 1;
    } else if (arg === "--data-dir") {
      checkOptions.dataDir = readRequiredCliValue(argv, index, "--data-dir");
      index += 1;
    }
  }

  const parsed = parseGraphWorkspaceArgv(stripGraphCheckOnlyFlags(argv));
  if (parsed.positionals.length > 0) {
    throw new Error(`Unknown graph:check arguments: ${parsed.positionals.join(" ")}`);
  }

  return { graphOptions: parsed.options, checkOptions };
}

export async function runGraphCheckCli(argv = process.argv.slice(2)) {
  const { graphOptions, checkOptions } = parseGraphCheckArgv(argv);
  const workspaceRoot = requireWorkspaceOption(graphOptions.workspace);
  const previousSymbolCount = graphOptions.refresh ? await readPreviousSymbolCount(workspaceRoot) : undefined;
  const loaded = await loadWorkspaceUnifiedGraph(workspaceRoot, { refresh: graphOptions.refresh });
  const kernelProfile = loaded.kernelProfile ?? await detectWorkspaceKernelProfile(workspaceRoot);
  const handoffFreshness = await readHandoffFreshness(workspaceRoot, loaded.graph.generatedAt);

  let productGraph;
  if (checkOptions.productGraphId) {
    await applyProductGraphCliDataDir({ explicitDataDir: checkOptions.dataDir });
    const [{ closeDb, initDb }, { getProductGraphProjection }] = await Promise.all([
      import("../db/client.js"),
      import("../db/productGraphRepo.js"),
    ]);
    initDb();
    try {
      productGraph = await getProductGraphProjection(checkOptions.productGraphId);
    } finally {
      closeDb();
    }
  }

  const fusion = evaluateOagFusionChecks({
    graph: loaded.graph,
    kernelProfile,
    handoffFreshness,
    productGraph,
    previousSymbolCount,
  });

  const payload = {
    status: fusion.ok ? "graph_check_passed" : "graph_check_failed",
    workspaceRoot,
    fromCache: loaded.fromCache,
    mode: checkOptions.mode,
    ok: fusion.ok,
    hardFailCount: fusion.hardFailCount,
    warnCount: fusion.warnCount,
    checks: fusion.checks,
    handoffFreshness,
    activeScannerIds: loaded.graph.activeScannerIds,
    symbolCount: loaded.graph.nodes.filter((node) => node.kind === "symbol").length,
  };

  if (graphOptions.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Workspace: ${workspaceRoot}`);
    console.log(`Mode: ${checkOptions.mode}`);
    console.log(`Checks: ${fusion.checks.length} (${fusion.hardFailCount} fail, ${fusion.warnCount} warn)`);
    for (const check of fusion.checks) {
      console.log(`- [${check.severity}] ${check.title}: ${check.detail}`);
    }
    console.log(`Handoff: ${handoffFreshness.detail}`);
    console.log(fusion.ok ? "Result: PASS" : "Result: FAIL");
  }

  if (!fusion.ok && checkOptions.mode === "hard") {
    process.exitCode = 1;
  }

  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/graphCheck\.(?:ts|js)$/.test(invokedPath)) {
  runGraphCheckCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
