import {
  findProductGraphAcceptanceEvidenceGaps,
  summarizeProductGraphCodeIntentDrift,
  summarizeProductGraphCodeScanFreshness,
  summarizeProductGraphExecutionDrift,
  summarizeProductGraphExecutionTestEvidence,
  type ProductGraphProjection,
} from "@openagentgraph/shared";
import { applyProductGraphCliDataDir, readRequiredCliValue } from "./productGraphDataDir.js";

export type GateMode = "hard" | "warn";
const DEFAULT_PRODUCT_GRAPH_ID = "default";

export interface GateOptions {
  mode: GateMode;
  allowEmpty: boolean;
}

export interface GateFailure {
  code: string;
  title: string;
  count: number;
  details: string[];
}

export interface GateResult {
  ok: boolean;
  empty: boolean;
  mode: GateMode;
  productGraphId: string;
  failures: GateFailure[];
  warnings: string[];
}

function detailLimit(values: string[], limit = 5) {
  return values.slice(0, limit);
}

export function evaluateProductGraphGate(
  projection: ProductGraphProjection,
  options: GateOptions,
  productGraphId = projection.productGraphId
): GateResult {
  const failures: GateFailure[] = [];
  const warnings: string[] = [];
  const empty = projection.events.length === 0 || projection.summary.nodeCount === 0;

  if (empty) {
    const warning = `Product Graph '${productGraphId}' has no data; CI gate passed because --allow-empty is enabled.`;
    const failureDetail = `Product Graph '${productGraphId}' has no data; run without --allow-empty only after Product Graph data has been imported.`;
    if (options.allowEmpty) {
      return { ok: true, empty, mode: options.mode, productGraphId, failures, warnings: [warning] };
    }
    failures.push({
      code: "empty_product_graph",
      title: "Product Graph data is required",
      count: 1,
      details: [failureDetail],
    });
    return { ok: options.mode === "warn", empty, mode: options.mode, productGraphId, failures, warnings };
  }

  const codeIntent = summarizeProductGraphCodeIntentDrift(projection);
  if (codeIntent.codeNodesMissingIntentCount > 0) {
    failures.push({
      code: "code_intent_drift",
      title: "Run-touched code lacks linked product intent",
      count: codeIntent.codeNodesMissingIntentCount,
      details: detailLimit(codeIntent.codeGaps.map(({ codeNode }) => codeNode.title)),
    });
  }

  const executionDrift = summarizeProductGraphExecutionDrift(projection);
  if (executionDrift.tasksWithDriftCount > 0) {
    failures.push({
      code: "execution_evidence_drift",
      title: "Completed tasks lack linked run/evidence",
      count: executionDrift.tasksWithDriftCount,
      details: detailLimit(executionDrift.taskGaps.map(({ task }) => task.title)),
    });
  }

  const testEvidence = summarizeProductGraphExecutionTestEvidence(projection);
  if (testEvidence.tasksMissingTestEvidenceCount > 0) {
    failures.push({
      code: "test_evidence_drift",
      title: "Completed tasks with run evidence lack test evidence",
      count: testEvidence.tasksMissingTestEvidenceCount,
      details: detailLimit(testEvidence.taskGaps.map(({ task }) => task.title)),
    });
  }

  const acceptanceGaps = findProductGraphAcceptanceEvidenceGaps(projection);
  if (acceptanceGaps.length > 0) {
    const missingCriteriaCount = acceptanceGaps.reduce((total, gap) => total + gap.criteria.length, 0);
    failures.push({
      code: "acceptance_evidence_gap",
      title: "Acceptance criteria lack verification evidence",
      count: missingCriteriaCount,
      details: detailLimit(acceptanceGaps.flatMap((gap) => gap.criteria.map((criterion) => `${gap.feature.title}: ${criterion.title}`))),
    });
  }

  const codeMapFreshness = summarizeProductGraphCodeScanFreshness(projection);
  if (codeMapFreshness.isCodeMapMissing || codeMapFreshness.isCodeMapStale) {
    failures.push({
      code: codeMapFreshness.isCodeMapMissing ? "code_scan_missing" : "code_scan_stale",
      title: codeMapFreshness.isCodeMapMissing
        ? "Run-touched code lacks a native codebase scan"
        : "Run-touched code changed after the latest codebase scan",
      count: Math.max(codeMapFreshness.runTouchedCodeNodeCount, codeMapFreshness.codeNodesChangedAfterCodeScanCount),
      details: detailLimit(codeMapFreshness.codeGaps.map(({ codeNode }) => codeNode.title)),
    });
  }

  const hardFailure = failures.length > 0 && options.mode === "hard";
  return {
    ok: !hardFailure,
    empty,
    mode: options.mode,
    productGraphId,
    failures,
    warnings,
  };
}

function parseArgs(argv: string[]) {
  const options = {
    productGraphId: DEFAULT_PRODUCT_GRAPH_ID,
    mode: "hard" as GateMode,
    allowEmpty: false,
    json: false,
    dataDir: undefined as string | undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--product-graph-id") {
      options.productGraphId = argv[index + 1] ?? options.productGraphId;
      index += 1;
    } else if (arg === "--mode") {
      const mode = argv[index + 1];
      if (mode !== "hard" && mode !== "warn") {
        throw new Error("--mode must be hard or warn.");
      }
      options.mode = mode;
      index += 1;
    } else if (arg === "--allow-empty") {
      options.allowEmpty = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--data-dir") {
      options.dataDir = readRequiredCliValue(argv, index, "--data-dir");
      index += 1;
    } else {
      throw new Error(`Unknown gate option: ${arg}`);
    }
  }

  return options;
}

function printHuman(result: GateResult) {
  for (const warning of result.warnings) {
    console.warn(`WARNING: ${warning}`);
  }

  if (result.failures.length === 0) {
    console.log(`GATING SUCCESS: Product Graph '${result.productGraphId}' passed quality checks.`);
    return;
  }

  const prefix = result.mode === "hard" ? "GATING FAILURE" : "GATING WARNING";
  console.error(`${prefix}: Product Graph '${result.productGraphId}' has ${result.failures.length} quality gap group(s).`);
  for (const failure of result.failures) {
    console.error(`- ${failure.title}: ${failure.count}`);
    for (const detail of failure.details) {
      console.error(`  - ${detail}`);
    }
  }
}

export async function runGateCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  await applyProductGraphCliDataDir({ explicitDataDir: parsed.dataDir });

  const [{ closeDb, initDb }, { getProductGraphProjection }] = await Promise.all([
    import("../db/client.js"),
    import("../db/productGraphRepo.js"),
  ]);

  initDb();
  try {
    const projection = await getProductGraphProjection(parsed.productGraphId);
    const result = evaluateProductGraphGate(
      projection,
      { mode: parsed.mode, allowEmpty: parsed.allowEmpty },
      parsed.productGraphId
    );

    if (parsed.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }

    process.exitCode = result.ok ? 0 : 1;
  } finally {
    closeDb();
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/gate\.(?:ts|js)$/.test(invokedPath)) {
  runGateCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
