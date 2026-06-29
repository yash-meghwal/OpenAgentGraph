import { spawn } from "child_process";
import { constants as fsConstants, readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";
import {
  buildAgentHarnessReport,
  buildDoctorAgenticReadinessSummary,
  CODE_GRAPH_SCHEMA_VERSION,
  evaluateContextNoise,
  formatDoctorAgenticReadinessHuman,
  type DoctorAgenticReadinessSummary,
  type GraphContextNoiseSummary,
  type GraphIncrementalManifest,
} from "@openagentgraph/shared";
import {
  buildHarnessContextNoiseDiagnostics,
  loadHarnessWorkspaceMetadata,
} from "./graphHarnessMetadata.js";
import {
  GRAPH_EXPORT_DIR_NAME,
  readGraphWorkspaceCliValue,
  readHandoffFreshness,
  tryLoadCachedGraphManifest,
  tryLoadCachedWorkspaceGraph,
} from "./graphWorkspace.js";
import { detectWorkspaceKernelProfile } from "../scanner/kernel/workspaceDetection.js";
import {
  ensureRoslynHelperPrepared,
  findRoslynHelperDllPath,
  probeDotNetSdkAvailability,
} from "../scanner/kernel/roslynHelperPreparation.js";

const backendRequire = createRequire(__filename);
const GRAPH_MANIFEST_SCHEMA_VERSION = "1";

const PROVIDER_KEY_ENV_NAMES = [
  "OPENAGENTGRAPH_AI_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

const DOTNET_VERSION_PROBE_TIMEOUT_MS = 5_000;

interface DoctorCliOptions {
  workspace?: string;
  json: boolean;
}

function readRequiredCliValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseDoctorArgv(argv: string[]): DoctorCliOptions {
  const options: DoctorCliOptions = { json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      options.workspace = readGraphWorkspaceCliValue(argv, index);
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown doctor option: ${arg}`);
    }
  }

  return options;
}

function resolvePackageJsonPath(packageName: string) {
  try {
    return backendRequire.resolve(`${packageName}/package.json`);
  } catch {
    const monorepoFallbacks: Record<string, string> = {
      "@openagentgraph/backend": path.resolve(__dirname, "../../package.json"),
      "@openagentgraph/shared": path.resolve(__dirname, "../../../shared/package.json"),
      "@openagentgraph/cli": path.resolve(__dirname, "../../../cli/package.json"),
    };
    const fallback = monorepoFallbacks[packageName];
    if (fallback) {
      readFileSync(fallback);
      return fallback;
    }
    throw new Error(`Unable to resolve ${packageName}/package.json`);
  }
}

function tryReadPackageVersion(packageName: string) {
  try {
    const packageJsonPath = resolvePackageJsonPath(packageName);
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

function readCliNodeEngineRequirement() {
  try {
    const cliPackageJsonPath = resolvePackageJsonPath("@openagentgraph/cli");
    const pkg = JSON.parse(readFileSync(cliPackageJsonPath, "utf8")) as { engines?: { node?: string } };
    return pkg.engines?.node ?? ">=20.19.0";
  } catch {
    return ">=20.19.0";
  }
}

function parseSemverTriplet(version: string) {
  const match = version.replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function satisfiesMinimumNodeVersion(required: string, actualVersion: string) {
  const minimum = required.startsWith(">=") ? required.slice(2) : required;
  const actual = parseSemverTriplet(actualVersion);
  const minimumParsed = parseSemverTriplet(minimum);
  if (!actual || !minimumParsed) return false;
  if (actual.major !== minimumParsed.major) return actual.major > minimumParsed.major;
  if (actual.minor !== minimumParsed.minor) return actual.minor > minimumParsed.minor;
  return actual.patch >= minimumParsed.patch;
}

async function pathExists(directoryPath: string) {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function probeDotNetVersion() {
  const dotnet = await probeDotNetSdkAvailability();
  if (!dotnet.available) {
    return { available: false as const, reason: dotnet.reason ?? "dotnet CLI unavailable." };
  }

  return new Promise<{ available: true; version?: string }>((resolve) => {
    const child = spawn("dotnet", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let settled = false;
    const finish = (result: { available: true; version?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ available: true });
    }, DOTNET_VERSION_PROBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", () => finish({ available: true }));
    child.on("close", (code) => {
      if (code === 0) {
        finish({ available: true, version: stdout.trim() || undefined });
      } else {
        finish({ available: true });
      }
    });
  });
}

async function checkOagWriteAccess(workspaceRoot: string) {
  const oagDir = path.join(workspaceRoot, GRAPH_EXPORT_DIR_NAME);
  const probeFile = path.join(oagDir, ".doctor-write-probe");
  try {
    await fs.mkdir(oagDir, { recursive: true });
    await fs.writeFile(probeFile, "ok", "utf8");
    await fs.rm(probeFile, { force: true });
    return true;
  } catch {
    try {
      await fs.rm(probeFile, { force: true });
    } catch {
      // ignore cleanup failure
    }
    return false;
  }
}

function listConfiguredProviderKeyNames(env: NodeJS.ProcessEnv = process.env) {
  return PROVIDER_KEY_ENV_NAMES.filter((name) => Boolean(env[name]?.trim()));
}

function validateGraphManifest(manifest: GraphIncrementalManifest) {
  if (manifest.schemaVersion !== GRAPH_MANIFEST_SCHEMA_VERSION) {
    return {
      valid: false,
      reason: `Unsupported manifest schema version: ${manifest.schemaVersion}`,
    };
  }
  if (manifest.graphSchemaVersion !== CODE_GRAPH_SCHEMA_VERSION) {
    return {
      valid: false,
      reason: `Cached graph schema is ${manifest.graphSchemaVersion}; expected ${CODE_GRAPH_SCHEMA_VERSION}.`,
    };
  }
  return { valid: true as const };
}

function buildNextCommands(workspaceRoot: string, input: {
  graphPresent: boolean;
  graphValid: boolean;
  primaryType?: string;
}) {
  const quotedWorkspace = `"${workspaceRoot}"`;
  const commands = [
    `oag graph:export --workspace ${quotedWorkspace} --offline-only --redact-root`,
    `oag graph:check --workspace ${quotedWorkspace} --json`,
    `oag graph:docs:check --workspace ${quotedWorkspace} --json --suggest`,
    `oag graph:context --workspace ${quotedWorkspace} --goal "understand this repo" --include-verification --json`,
  ];

  if (input.graphPresent && input.graphValid) {
    commands.push(`oag graph:query --workspace ${quotedWorkspace} --mode code "entry point"`);
    commands.push(`oag graph:path --workspace ${quotedWorkspace} "source" "target"`);
    commands.push(`oag dogfood --workspace ${quotedWorkspace}`);
  }

  return commands;
}

export async function runDoctorCli(argv = process.argv.slice(2)) {
  const options = parseDoctorArgv(argv);
  if (!options.workspace) {
    throw new Error('doctor requires --workspace "<path>".');
  }

  const workspaceRoot = path.resolve(options.workspace);
  const errors: string[] = [];
  const warnings: string[] = [];

  const versions = {
    cli: tryReadPackageVersion("@openagentgraph/cli"),
    backend: tryReadPackageVersion("@openagentgraph/backend"),
    shared: tryReadPackageVersion("@openagentgraph/shared"),
  };

  const nodeRequirement = readCliNodeEngineRequirement();
  const nodeVersion = process.version;
  const nodeCompatible = satisfiesMinimumNodeVersion(nodeRequirement, nodeVersion);
  if (!nodeCompatible) {
    errors.push(`Node ${nodeVersion} does not satisfy required engine ${nodeRequirement}.`);
  }

  const workspaceAccessible = await pathExists(workspaceRoot);
  if (!workspaceAccessible) {
    errors.push(`Workspace path does not exist or is not a directory: ${workspaceRoot}`);
  }

  let workspaceReadable = false;
  let oagWriteAccess = false;
  if (workspaceAccessible) {
    try {
      await fs.access(workspaceRoot, fsConstants.R_OK);
      workspaceReadable = true;
    } catch {
      errors.push(`Workspace is not readable: ${workspaceRoot}`);
    }
    oagWriteAccess = await checkOagWriteAccess(workspaceRoot);
    if (!oagWriteAccess) {
      errors.push(`Cannot write graph artifacts under ${path.join(workspaceRoot, GRAPH_EXPORT_DIR_NAME)}.`);
    }
  }

  const dotnet = await probeDotNetVersion();
  const roslynPrepared = await ensureRoslynHelperPrepared({ autoBuild: false });
  const roslynDllPath = await findRoslynHelperDllPath();
  if (dotnet.available && roslynPrepared.availability.status !== "enabled" && !roslynDllPath) {
    warnings.push("Roslyn helper is not built; C# semantic edges remain optional and may fall back to structural indexing.");
  }

  let graphCache:
    | {
        manifestPresent: boolean;
        manifestValid: boolean;
        manifestReason?: string;
        graphPresent: boolean;
        graphValid: boolean;
        graphReason?: string;
        schemaVersion?: string;
        fileCount?: number;
      }
    | undefined;

  let workspaceProbe:
    | {
        primaryType: string;
        activeScannerIds: string[];
        detectedProjectTypes: string[];
      }
    | undefined;

  let agentHarnessReport;
  let agenticReadiness: DoctorAgenticReadinessSummary | undefined;
  let contextNoise: GraphContextNoiseSummary | undefined;
  let cachedGraph;

  if (workspaceAccessible) {
    const manifest = await tryLoadCachedGraphManifest(workspaceRoot);
    cachedGraph = await tryLoadCachedWorkspaceGraph(workspaceRoot);
    const manifestValidation = manifest ? validateGraphManifest(manifest) : undefined;

    graphCache = {
      manifestPresent: Boolean(manifest),
      manifestValid: manifestValidation?.valid ?? false,
      manifestReason: manifestValidation && !manifestValidation.valid ? manifestValidation.reason : undefined,
      graphPresent: Boolean(cachedGraph),
      graphValid: Boolean(cachedGraph),
      graphReason: cachedGraph ? undefined : "graph.json missing or invalid for this workspace.",
      schemaVersion: cachedGraph?.schemaVersion ?? manifest?.graphSchemaVersion,
      fileCount: manifest?.files.length,
    };

    if (manifest && !manifestValidation?.valid) {
      warnings.push(manifestValidation?.reason ?? "Cached graph manifest is invalid.");
    }
    if (!cachedGraph) {
      warnings.push("No cached graph export found. Run graph:export or dogfood to create .oag/graph.json.");
    }

    try {
      const kernelProfile = await detectWorkspaceKernelProfile(workspaceRoot);
      workspaceProbe = {
        primaryType: kernelProfile.primaryType,
        activeScannerIds: kernelProfile.activeScannerIds,
        detectedProjectTypes: [
          kernelProfile.primaryType,
          ...kernelProfile.secondaryTypes,
        ],
      };
      if (cachedGraph) {
        const harnessMetadata = loadHarnessWorkspaceMetadata(workspaceRoot);
        const handoffFreshness = await readHandoffFreshness(workspaceRoot, cachedGraph.generatedAt);
        const contextNoiseDiagnostics = buildHarnessContextNoiseDiagnostics(workspaceRoot, cachedGraph, {
          metadata: harnessMetadata,
          kernelProfile,
        });
        contextNoise = evaluateContextNoise(cachedGraph, contextNoiseDiagnostics);
        agentHarnessReport = buildAgentHarnessReport({
          graph: cachedGraph,
          kernelProfile,
          metadata: harnessMetadata,
          handoffFreshness,
          contextNoise,
          contextNoiseDiagnostics,
        });
        agenticReadiness = buildDoctorAgenticReadinessSummary({
          workspaceRoot,
          graph: cachedGraph,
          metadata: harnessMetadata,
          kernelProfile,
          handoffFreshness,
          contextNoise,
        });
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  const configuredProviderKeys = listConfiguredProviderKeyNames();
  const nextCommands = buildNextCommands(workspaceRoot, {
    graphPresent: graphCache?.graphPresent ?? false,
    graphValid: graphCache?.graphValid ?? false,
    primaryType: workspaceProbe?.primaryType,
  });

  const ok = errors.length === 0;
  const payload = {
    status: ok ? "doctor_ok" : "doctor_failed",
    ok,
    versions,
    node: {
      version: nodeVersion,
      compatible: nodeCompatible,
      required: nodeRequirement,
    },
    workspace: {
      path: workspaceRoot,
      accessible: workspaceAccessible,
      readable: workspaceReadable,
      oagWriteAccess,
    },
    dotnet: {
      available: dotnet.available,
      version: "version" in dotnet ? dotnet.version : undefined,
      reason: "reason" in dotnet ? dotnet.reason : undefined,
    },
    roslynHelper: {
      status: roslynPrepared.availability.status,
      dllPath: roslynDllPath,
      fallbackReason: roslynPrepared.availability.fallbackReason,
    },
    graphCache,
    workspaceProbe,
    providerKey: {
      requiredForGraphCommands: false,
      configuredProviderKeys,
    },
    nextCommands,
    agentHarnessReport,
    agenticReadiness,
    contextNoise,
    warnings,
    errors,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    if (!ok) {
      process.exitCode = 1;
    }
    return payload;
  }

  console.log("OpenAgentGraph doctor");
  console.log(`CLI ${versions.cli} | backend ${versions.backend} | shared ${versions.shared}`);
  console.log(`Node ${nodeVersion} (${nodeCompatible ? "compatible" : "incompatible"} with ${nodeRequirement})`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Accessible: ${workspaceAccessible ? "yes" : "no"} | Readable: ${workspaceReadable ? "yes" : "no"} | .oag write: ${oagWriteAccess ? "yes" : "no"}`);
  console.log(
    `dotnet SDK: ${dotnet.available ? "available" : "unavailable"}${"version" in dotnet && dotnet.version ? ` (${dotnet.version})` : ""}`
  );
  console.log(`Roslyn helper: ${roslynPrepared.availability.status}${roslynDllPath ? ` (${roslynDllPath})` : ""}`);
  if (graphCache) {
    console.log(
      `Graph cache: manifest=${graphCache.manifestPresent ? (graphCache.manifestValid ? "valid" : "invalid") : "missing"} | graph.json=${graphCache.graphPresent ? (graphCache.graphValid ? "valid" : "invalid") : "missing"}`
    );
  }
  if (workspaceProbe) {
    console.log(
      `Workspace probe: primary=${workspaceProbe.primaryType} | scanners=${workspaceProbe.activeScannerIds.join(", ") || "generic"}`
    );
  }
  console.log("Provider key for graph commands: not required");
  if (agenticReadiness) {
    for (const line of formatDoctorAgenticReadinessHuman(agenticReadiness)) {
      console.log(line);
    }
    if (agenticReadiness.supportTiers.structuralOnlyCount > 0) {
      console.log(`Support tiers: ${agenticReadiness.supportTiers.summary}`);
    }
  } else if (cachedGraph) {
    console.log("Agentic readiness: unavailable (cached graph could not be summarized)");
  } else {
    console.log("Agentic readiness: unavailable (run graph:export to score harness readiness)");
  }
  if (nextCommands.length > 0) {
    console.log(`Next: ${nextCommands[0]}`);
  }
  if (configuredProviderKeys.length > 0) {
    console.log(`Configured provider keys (names only): ${configuredProviderKeys.join(", ")}`);
  }
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
  if (errors.length > 0) {
    console.log("Errors:");
    for (const error of errors) {
      console.log(`- ${error}`);
    }
  }
  if (nextCommands.length > 1) {
    console.log("More commands:");
    for (const command of nextCommands.slice(1)) {
      console.log(`- ${command}`);
    }
  }

  if (!ok) {
    process.exitCode = 1;
  }
  return payload;
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/cli\/doctor\.(?:ts|js)$/.test(invokedPath)) {
  runDoctorCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}