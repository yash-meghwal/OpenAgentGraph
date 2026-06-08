import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  AgentActivityRecord,
  AgentContextPack,
  AgentPlanProposalRecord,
  GraphFrontierNodeSummary,
} from "@openagentgraph/shared";
import { useStore } from "../lib/store.js";
import { filterDashboardItems, findMostUrgentRun, sortDashboardItems } from "../lib/dashboard.js";
import {
  formatFrontierStatusLabel,
  formatRuntimeStatusLabel,
  getOnboardingState,
  getRuntimeBannerTone,
} from "../lib/productCopy.js";
import type { ProductGraphHandoffResult } from "../lib/productGraphApi.js";

const severityColor = {
  critical: "#fc8181",
  warning: "#f6ad55",
  info: "#63b3ed",
  none: "#4a5568",
} as const;

type ProviderSetupStatus = {
  configured: boolean;
  provider: ProviderSetupMode | "unset";
  source: "environment" | "runtime" | "unset";
  model?: string;
  baseUrl?: string;
  message: string;
};
type ProviderSetupMode = "openai" | "ollama" | "gemini" | "anthropic" | "openai-compatible";
type ProviderSetupInput = {
  provider: ProviderSetupMode;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

type AgentFrontierSummary = {
  runControlState: string;
  frontierStatus: string;
  readyCount: number;
  runningCount: number;
  blockedCount: number;
  openProposalCount: number;
  claimableReadyCount?: number;
  inProgressCount?: number;
  blockedActionCount?: number;
  deferredReadyCount?: number;
};

const PROVIDER_SETUP_LABELS: Record<ProviderSetupMode, string> = {
  openai: "OpenAI",
  ollama: "Ollama",
  gemini: "Gemini",
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI-compatible",
};

const PROVIDER_SETUP_DEFAULT_MODELS: Record<ProviderSetupMode, string> = {
  openai: "gpt-4o",
  ollama: "llama3.2",
  gemini: "gemini-3.5-flash",
  anthropic: "claude-sonnet-4-6",
  "openai-compatible": "",
};

const PROVIDER_SETUP_DEFAULT_BASE_URLS: Partial<Record<ProviderSetupMode, string>> = {
  ollama: "http://localhost:11434/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  anthropic: "https://api.anthropic.com/v1",
};

function setupTone(status: "done" | "warning" | "neutral") {
  switch (status) {
    case "done":
      return { border: "#276749", accent: "#68d391", background: "rgba(39, 103, 73, 0.18)" };
    case "warning":
      return { border: "#744210", accent: "#f6ad55", background: "rgba(116, 66, 16, 0.18)" };
    case "neutral":
    default:
      return { border: "#374151", accent: "#94a3b8", background: "rgba(31, 41, 55, 0.35)" };
  }
}

function DashboardSetupStrip({
  handoff,
  handoffLoading,
  handoffError,
  providerStatus,
}: {
  handoff: ProductGraphHandoffResult | null;
  handoffLoading: boolean;
  handoffError: string;
  providerStatus: ProviderSetupStatus;
}) {
  const workspaceStatus = handoff?.summary.workspaceRoot
    ? {
        label: "Workspace configured",
        status: "done" as const,
        detail: `${handoff.summary.workspaceRoot} (${handoff.summary.workspaceRootSource ?? "reported"})`,
      }
    : {
        label: "Workspace configured",
        status: "warning" as const,
        detail: handoffLoading
          ? "Checking handoff source..."
          : handoffError || "Generate a handoff to confirm the active workspace root.",
      };
  const scanStatus = handoff?.summary.codeFileCount
    ? {
        label: "Product Graph scan",
        status: handoff.summary.workspacePathCheck?.status === "mismatch" ? "warning" as const : "done" as const,
        detail: `${handoff.summary.latestCodeScanUpdatedAt ?? "Scan timestamp unknown"}; ${handoff.summary.codeFileCount} files, ${handoff.summary.codeSymbolCount} symbols.`,
      }
    : {
        label: "Product Graph scan",
        status: "warning" as const,
        detail: "Run Scan Codebase from Product Graph to populate Code Map context.",
      };
  const handoffStatus = handoff?.summary.handoffFile?.exists
    ? {
        label: "Handoff written",
        status: "done" as const,
        detail: `${handoff.summary.handoffFile.path ?? "GRAPH_REPORT.md"}${handoff.summary.handoffFile.updatedAt ? ` updated ${handoff.summary.handoffFile.updatedAt}` : " is present"}.`,
      }
    : {
        label: "Handoff written",
        status: "warning" as const,
        detail: "Write GRAPH_REPORT.md after scans or product intent changes.",
      };
  const providerStep = {
    label: "Provider optional",
    status: providerStatus.configured ? "done" as const : "neutral" as const,
    detail: providerStatus.configured
      ? `${PROVIDER_SETUP_LABELS[providerStatus.provider === "unset" ? "ollama" : providerStatus.provider]} configured for AI run execution.`
      : "Graph scans, Code Map, Project Graph, and GRAPH_REPORT.md work with no provider key.",
  };
  const steps = [workspaceStatus, scanStatus, handoffStatus, providerStep];

  return (
    <div
      role="group"
      aria-label="OpenAgentGraph setup status"
      style={{
        background: "#0f172a",
        border: "1px solid #263244",
        borderRadius: 14,
        padding: 12,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 900 }}>Start here</div>
        <div style={{ color: "#93c5fd", fontSize: 11, fontWeight: 800 }}>
          Provider keys are optional for graph and handoff workflows.
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 8 }}>
        {steps.map((step) => {
          const tone = setupTone(step.status);
          return (
            <div
              key={step.label}
              style={{
                background: tone.background,
                border: `1px solid ${tone.border}`,
                borderRadius: 10,
                padding: 9,
                display: "grid",
                gap: 4,
                minWidth: 0,
              }}
            >
              <div style={{ color: tone.accent, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                {step.label}
              </div>
              <div style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                {step.detail}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function attentionTone(label: "low" | "medium" | "high" | "urgent") {
  switch (label) {
    case "urgent":
      return "#fc8181";
    case "high":
      return "#f6ad55";
    case "medium":
      return "#f6e05e";
    case "low":
    default:
      return "#68d391";
  }
}

function ProviderSetupCard({
  providerStatus,
  providerConfigSaving,
  providerConfigMessage,
  canConfigure,
  onSave,
  onClear,
}: {
  providerStatus: ProviderSetupStatus;
  providerConfigSaving: boolean;
  providerConfigMessage: string;
  canConfigure: boolean;
  onSave: (input: ProviderSetupInput) => Promise<unknown>;
  onClear: () => Promise<unknown>;
}) {
  const [providerMode, setProviderMode] = useState<ProviderSetupMode>(
    providerStatus.provider !== "unset"
      ? providerStatus.provider
      : "ollama"
  );
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(providerStatus.model ?? PROVIDER_SETUP_DEFAULT_MODELS.ollama);
  const [baseUrl, setBaseUrl] = useState(providerStatus.baseUrl ?? PROVIDER_SETUP_DEFAULT_BASE_URLS.ollama ?? "");
  const [localMessage, setLocalMessage] = useState("");
  useEffect(() => {
    if (providerStatus.provider !== "unset") {
      setProviderMode(providerStatus.provider);
    }
    if (providerStatus.model) setModel(providerStatus.model);
    if (providerStatus.baseUrl) setBaseUrl(providerStatus.baseUrl);
  }, [providerStatus.baseUrl, providerStatus.model, providerStatus.provider]);
  const providerReady = providerStatus.configured;
  const canClearRuntimeProvider = canConfigure && providerStatus.source === "runtime";
  const message = providerConfigMessage || localMessage;
  const selectedProviderLabel = PROVIDER_SETUP_LABELS[providerMode];
  const baseUrlHelpText =
    providerMode === "openai-compatible"
      ? "Custom endpoints may omit an API key, but require a model and base URL. Remote endpoints must use https; http is only for localhost, 127.x.x.x, or loopback addresses."
      : "Ollama must use localhost or a loopback address; http is allowed only for localhost, 127.x.x.x, or loopback addresses.";
  const statusProviderLabel =
    providerStatus.provider === "unset"
      ? "AI"
      : PROVIDER_SETUP_LABELS[providerStatus.provider];
  const sourceLabel =
    providerStatus.source === "runtime"
      ? "Runtime config"
      : providerStatus.source === "environment"
        ? "Environment config"
        : providerReady
          ? "Configured"
          : "Not configured";
  const canSave =
    canConfigure &&
    !providerConfigSaving &&
    (providerMode === "ollama"
      ? Boolean(model.trim())
      : providerMode === "openai-compatible"
        ? Boolean(model.trim()) && Boolean(baseUrl.trim())
        : Boolean(apiKey.trim()));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalMessage("");
    try {
      const payload =
        providerMode === "ollama"
          ? {
              provider: providerMode,
              model: model.trim(),
              ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
            }
          : {
              provider: providerMode,
              ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
              ...(model.trim() ? { model: model.trim() } : {}),
              ...(providerMode === "openai-compatible" && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
            };
      await onSave(payload);
      setApiKey("");
    } catch (error) {
      setLocalMessage(error instanceof Error && error.message ? error.message : "AI provider configuration could not be saved.");
    }
  }

  async function handleClear() {
    setLocalMessage("");
    try {
      await onClear();
    } catch (error) {
      setLocalMessage(
        error instanceof Error && error.message ? error.message : "Runtime provider configuration could not be cleared."
      );
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      style={{
        background: "#111827",
        border: `1px solid ${providerReady ? "#276749" : "#744210"}`,
        borderRadius: 14,
        padding: 14,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ color: providerReady ? "#68d391" : "#f6ad55", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
            Provider setup
          </div>
          <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 800 }}>
            {providerReady ? `${statusProviderLabel} provider ready` : "Choose an AI provider"}
          </div>
        </div>
        <span style={{ color: providerReady ? "#68d391" : "#f6ad55", fontSize: 11, fontWeight: 800 }}>
          {sourceLabel}
        </span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ color: "#cbd5e0", display: "grid", gap: 4, fontSize: 11, fontWeight: 800 }}>
          Provider
          <select
            value={providerMode}
            onChange={(event) => {
              const nextProvider = event.target.value as ProviderSetupMode;
              setProviderMode(nextProvider);
              setModel(PROVIDER_SETUP_DEFAULT_MODELS[nextProvider]);
              setBaseUrl(PROVIDER_SETUP_DEFAULT_BASE_URLS[nextProvider] ?? "");
              setApiKey("");
            }}
            disabled={!canConfigure || providerConfigSaving}
            style={{
              background: "#0f172a",
              border: "1px solid #374151",
              borderRadius: 8,
              color: "#e2e8f0",
              fontSize: 12,
              padding: "8px 10px",
            }}
          >
            <option value="ollama">Ollama local - no API key</option>
            <option value="openai">OpenAI API key</option>
            <option value="gemini">Gemini API key</option>
            <option value="anthropic">Anthropic API key</option>
            <option value="openai-compatible">Custom OpenAI-compatible</option>
          </select>
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {providerMode === "openai" || providerMode === "gemini" || providerMode === "anthropic" ? (
            <>
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="API key"
                type="password"
                autoComplete="off"
                disabled={!canConfigure || providerConfigSaving}
                aria-label={`${selectedProviderLabel} API key`}
                style={{
                  background: "#0f172a",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  flex: "1 1 220px",
                  fontSize: 12,
                  padding: "8px 10px",
                }}
              />
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={PROVIDER_SETUP_DEFAULT_MODELS[providerMode] || "model name"}
                disabled={!canConfigure || providerConfigSaving}
                aria-label={`${selectedProviderLabel} model`}
                style={{
                  background: "#0f172a",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  flex: "1 1 180px",
                  fontSize: 12,
                  padding: "8px 10px",
                }}
              />
            </>
          ) : null}
          {providerMode === "ollama" || providerMode === "openai-compatible" ? (
            <>
              {providerMode === "openai-compatible" ? (
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="optional API key"
                  type="password"
                  autoComplete="off"
                  disabled={!canConfigure || providerConfigSaving}
                  aria-label={`${selectedProviderLabel} API key`}
                  style={{
                    background: "#0f172a",
                    border: "1px solid #374151",
                    borderRadius: 8,
                    color: "#e2e8f0",
                    flex: "1 1 220px",
                    fontSize: 12,
                    padding: "8px 10px",
                  }}
                />
              ) : null}
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={providerMode === "ollama" ? "llama3.2" : "model name"}
                disabled={!canConfigure || providerConfigSaving}
                aria-label={`${selectedProviderLabel} model`}
                style={{
                  background: "#0f172a",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  flex: "1 1 160px",
                  fontSize: 12,
                  padding: "8px 10px",
                }}
              />
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={providerMode === "ollama" ? "http://localhost:11434/v1" : "https://api.example.com/v1"}
                disabled={!canConfigure || providerConfigSaving}
                aria-label={`${selectedProviderLabel} base URL`}
                style={{
                  background: "#0f172a",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  flex: "1 1 240px",
                  fontSize: 12,
                  padding: "8px 10px",
                }}
              />
              <div style={{ color: "#94a3b8", flex: "1 1 100%", fontSize: 11, lineHeight: 1.45 }}>
                {baseUrlHelpText}
              </div>
            </>
          ) : null}
        <button
          type="submit"
          disabled={!canSave}
          style={{
            background: canSave ? "#2563eb" : "#1f2937",
            border: "none",
            borderRadius: 8,
            color: canSave ? "#fff" : "#64748b",
            cursor: canSave ? "pointer" : "not-allowed",
            fontSize: 12,
            fontWeight: 800,
            padding: "8px 12px",
            opacity: canSave ? 1 : 0.86,
          }}
        >
          {providerConfigSaving ? "Saving..." : `Save ${selectedProviderLabel}`}
        </button>
        {canClearRuntimeProvider ? (
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={providerConfigSaving}
            style={{
              background: "transparent",
              border: "1px solid #4b5563",
              borderRadius: 8,
              color: "#cbd5e0",
              cursor: providerConfigSaving ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 800,
              padding: "8px 12px",
            }}
          >
            Clear runtime provider
          </button>
        ) : null}
        </div>
      </div>
      <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>
        {canConfigure
          ? "Dashboard changes live only in backend memory for this running process. Graph scans, Code Map, Project Graph, and GRAPH_REPORT.md do not need a provider key."
          : "Switch to an operator or admin actor to configure provider execution."}
      </div>
      {message ? <div style={{ color: providerReady ? "#68d391" : "#f6ad55", fontSize: 12 }}>{message}</div> : null}
    </form>
  );
}

function AgentCollaborationCard({
  graphId,
  frontier,
  summary,
  activity,
  proposals,
  context,
  loading,
  error,
  message,
  canManage,
  onLoadContext,
  onAcceptProposal,
  onDismissProposal,
  onOpenGraph,
}: {
  graphId: string | null;
  frontier: GraphFrontierNodeSummary[];
  summary: AgentFrontierSummary | null;
  activity: AgentActivityRecord[];
  proposals: AgentPlanProposalRecord[];
  context: AgentContextPack | null;
  loading: boolean;
  error: string;
  message: string;
  canManage: boolean;
  onLoadContext: (graphId: string) => Promise<AgentContextPack>;
  onAcceptProposal: (graphId: string, proposalId: string) => Promise<void>;
  onDismissProposal: (graphId: string, proposalId: string, reason?: string) => Promise<void>;
  onOpenGraph: (graphId: string) => Promise<void>;
}) {
  const hasGraph = Boolean(graphId);
  const [dismissReasons, setDismissReasons] = useState<Record<string, string>>({});
  return (
    <section
      aria-label="Agent collaboration"
      style={{
        background: "#111827",
        border: "1px solid #263244",
        borderRadius: 14,
        padding: 14,
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ color: "#63b3ed", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Agent coordination
          </div>
          <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 800 }}>Agent-ready work</div>
          <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>
            External agents can read context, report evidence, and propose work without taking over the runner.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            disabled={!hasGraph || loading}
            onClick={() => graphId && void onLoadContext(graphId)}
            style={{
              background: hasGraph && !loading ? "#2563eb" : "#1f2937",
              color: "#f8fafc",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "7px 10px",
              cursor: hasGraph && !loading ? "pointer" : "not-allowed",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {loading ? "Loading..." : "Load context pack"}
          </button>
          <button
            disabled={!hasGraph}
            onClick={() => graphId && void onOpenGraph(graphId)}
            style={{
              background: "#0f172a",
              color: "#cbd5e1",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "7px 10px",
              cursor: hasGraph ? "pointer" : "not-allowed",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            Open run
          </button>
        </div>
      </div>

      {summary ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
          {[
            ["Ready", summary.readyCount],
            ["Running", summary.runningCount],
            ["Blocked", summary.blockedCount],
            ["Claimable", summary.claimableReadyCount ?? summary.readyCount],
            ["Deferred", summary.deferredReadyCount ?? 0],
            ["Proposals", summary.openProposalCount],
          ].map(([label, value]) => (
            <div key={label} style={{ border: "1px solid #263244", borderRadius: 8, padding: 10 }}>
              <div style={{ color: "#718096", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
              <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 800 }}>{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "#94a3b8", fontSize: 12 }}>No run frontier is loaded yet.</div>
      )}

      {frontier.length > 0 ? (
        <div style={{ display: "grid", gap: 6 }}>
          {frontier.slice(0, 4).map((node) => (
            <div key={node.nodeId} style={{ color: "#cbd5e1", fontSize: 12, display: "grid", gap: 2 }}>
              <strong style={{ color: "#e2e8f0" }}>{node.title}</strong>
              <span>
                {node.status} · {node.kind}
                {node.schedulingState ? ` · ${node.schedulingState.replace(/_/g, " ")} / ${node.agentAction ?? "none"}` : ""} ·{" "}
                {node.humanSummary}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {context ? (
        <div style={{ border: "1px solid #263244", borderRadius: 8, padding: 10, color: "#cbd5e1", fontSize: 12, lineHeight: 1.45 }}>
          Context pack ready: {context.frontier.length} frontier nodes, {context.recentAgentActivity.length} recent agent updates,{" "}
          {context.planProposals.length} open proposals.
        </div>
      ) : null}

      {proposals.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 800 }}>Open proposals</div>
          {proposals.slice(0, 3).map((proposal) => (
            <div key={proposal.proposalId} style={{ border: "1px solid #263244", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
              <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 800 }}>{proposal.title}</div>
              <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>{proposal.summary}</div>
              <label style={{ display: "grid", gap: 4, color: "#94a3b8", fontSize: 11, fontWeight: 700 }}>
                Dismiss reason
                <input
                  aria-label={`Dismiss reason for ${proposal.title}`}
                  disabled={!canManage || loading}
                  maxLength={500}
                  placeholder="Optional audit note"
                  value={dismissReasons[proposal.proposalId] ?? ""}
                  onChange={(event) =>
                    setDismissReasons((current) => ({
                      ...current,
                      [proposal.proposalId]: event.target.value,
                    }))
                  }
                  style={{
                    background: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    color: "#e2e8f0",
                    fontSize: 12,
                    minWidth: 0,
                    padding: "7px 9px",
                  }}
                />
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  disabled={!canManage || loading || !graphId}
                  onClick={() => graphId && void onAcceptProposal(graphId, proposal.proposalId)}
                  style={{
                    background: canManage && !loading ? "#065f46" : "#1f2937",
                    color: "#f8fafc",
                    border: "1px solid #276749",
                    borderRadius: 8,
                    padding: "6px 9px",
                    cursor: canManage && !loading ? "pointer" : "not-allowed",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  Accept proposal
                </button>
                <button
                  disabled={!canManage || loading || !graphId}
                  onClick={() => graphId && void onDismissProposal(graphId, proposal.proposalId, dismissReasons[proposal.proposalId])}
                  style={{
                    background: "#0f172a",
                    color: "#cbd5e1",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    padding: "6px 9px",
                    cursor: canManage && !loading ? "pointer" : "not-allowed",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {activity.length > 0 ? (
        <div style={{ display: "grid", gap: 4, color: "#94a3b8", fontSize: 12 }}>
          <strong style={{ color: "#e2e8f0" }}>Recent agent activity</strong>
          {activity.slice(0, 3).map((item) => (
            <span key={item.id}>{item.summary}</span>
          ))}
        </div>
      ) : null}
      {error ? <div style={{ color: "#f97316", fontSize: 12 }}>{error}</div> : null}
      {message ? <div style={{ color: "#34d399", fontSize: 12 }}>{message}</div> : null}
    </section>
  );
}

export function getDashboardEmptyState(input: Parameters<typeof getOnboardingState>[0]) {
  return getOnboardingState(input);
}

export function DashboardView() {
  const {
    authMode,
    sessionLifecycle,
    authMessage,
    currentActor,
    runtimeEnvironmentMode,
    apiBaseDisplay,
    runtimeStatus,
    runtimeMessage,
    runtimeHealthSummary,
    runtimeFallbackLikely,
    providerStatus,
    providerConfigSaving,
    providerConfigMessage,
    productGraphHandoff,
    productGraphHandoffLoading,
    productGraphHandoffError,
    agentFrontierGraphId,
    agentFrontier,
    agentFrontierSummary,
    agentActivity,
    agentPlanProposals,
    agentContext,
    agentCollaborationLoading,
    agentCollaborationError,
    agentCollaborationMessage,
    dashboardLoading,
    onboardingDismissed,
    dashboard,
    dashboardSummary,
    dashboardQuery,
    dashboardLifecycle,
    dashboardAttention,
    dashboardStatus,
    dashboardFilter,
    dashboardSort,
    fetchGraphs,
    setDashboardQuery,
    setDashboardLifecycle,
    setDashboardAttention,
    setDashboardStatus,
    setDashboardFilter,
    setDashboardSort,
    loadProviderStatus,
    loadProductGraphHandoff,
    loadAgentFrontier,
    loadAgentContext,
    acceptAgentPlanProposal,
    dismissAgentPlanProposal,
    configureProvider,
    clearRuntimeProviderConfig,
    dismissOnboarding,
    openGraph,
    loadSimilarRuns,
    similarRuns,
    similarRunsForGraphId,
    loadComparison,
    comparison,
    clearComparison,
    uiMode,
  } = useStore();

  useEffect(() => {
    void fetchGraphs();
  }, [fetchGraphs, dashboardQuery, dashboardLifecycle, dashboardAttention, dashboardStatus]);

  useEffect(() => {
    const canConfigureProvider = currentActor.role === "operator" || currentActor.role === "admin";
    if (!canConfigureProvider) return;
    void loadProviderStatus().catch(() => undefined);
  }, [currentActor.role, loadProviderStatus]);

  useEffect(() => {
    if (productGraphHandoff || productGraphHandoffLoading || productGraphHandoffError) return;
    void loadProductGraphHandoff().catch(() => undefined);
  }, [loadProductGraphHandoff, productGraphHandoff, productGraphHandoffError, productGraphHandoffLoading]);

  const presentedItems = useMemo(() => {
    const filtered = filterDashboardItems(dashboard, dashboardFilter);
    return sortDashboardItems(filtered, dashboardSort);
  }, [dashboard, dashboardFilter, dashboardSort]);

  const mostUrgentRun = useMemo(() => findMostUrgentRun(dashboard), [dashboard]);
  const emptyState = useMemo(
    () =>
      getDashboardEmptyState({
        runtimeStatus,
        runtimeFallbackLikely,
        sessionLifecycle,
      }),
    [runtimeStatus, runtimeFallbackLikely, sessionLifecycle]
  );
  const runtimeTone = getRuntimeBannerTone(runtimeStatus);
  const canConfigureProvider = currentActor.role === "operator" || currentActor.role === "admin";
  const agentHubGraphId = mostUrgentRun?.graphId ?? presentedItems[0]?.graphId ?? null;

  useEffect(() => {
    if (!agentHubGraphId || agentFrontierGraphId === agentHubGraphId || agentCollaborationLoading) return;
    void loadAgentFrontier(agentHubGraphId).catch(() => undefined);
  }, [agentCollaborationLoading, agentFrontierGraphId, agentHubGraphId, loadAgentFrontier]);

  if (dashboardLoading && dashboard.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          background: "#0f1117",
          overflow: "auto",
          padding: 20,
          display: "grid",
          gap: 16,
        }}
      >
        <div
          style={{
            background: "#111827",
            border: "1px solid #1f2937",
            borderRadius: 18,
            padding: 20,
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 800 }}>Loading workspace</div>
          <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
            OpenAgentGraph is checking runtime health, session state, and available runs.
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              style={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 14,
                padding: 14,
                minHeight: 88,
                opacity: 0.7,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (dashboard.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          background: "#0f1117",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 560,
            background: "#111827",
            border: `1px solid ${runtimeTone.border}`,
            borderRadius: 18,
            padding: 24,
            display: "grid",
            gap: 14,
            boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
          }}
        >
          {!onboardingDismissed ? (
            <div
              style={{
                background: runtimeTone.background,
                border: `1px solid ${runtimeTone.border}`,
                borderRadius: 14,
                padding: "14px 16px",
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div
                    style={{
                      color: runtimeTone.accent,
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    First run guide
                  </div>
                  <div style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 800 }}>
                    What you are seeing
                  </div>
                </div>
                <button
                  onClick={dismissOnboarding}
                  style={{
                    background: "transparent",
                    color: "#94a3b8",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Dismiss
                </button>
              </div>
              <div style={{ color: "#cbd5e0", fontSize: 13, lineHeight: 1.5 }}>
                OpenAgentGraph shows projection-derived run health, graph progress, evidence, and human decisions.
              </div>
              <div style={{ display: "grid", gap: 6, color: "#a0aec0", fontSize: 12, lineHeight: 1.45 }}>
                {emptyState.nextSteps.map((step) => (
                  <div key={step}>• {step}</div>
                ))}
              </div>
            </div>
          ) : null}
          <div style={{ color: "#e2e8f0", fontSize: 20, fontWeight: 800 }}>{emptyState.title}</div>
          <div style={{ color: "#cbd5e0", fontSize: 14, lineHeight: 1.5 }}>{emptyState.body}</div>
          <DashboardSetupStrip
            handoff={productGraphHandoff}
            handoffLoading={productGraphHandoffLoading}
            handoffError={productGraphHandoffError}
            providerStatus={providerStatus}
          />
          <ProviderSetupCard
            providerStatus={providerStatus}
            providerConfigSaving={providerConfigSaving}
            providerConfigMessage={providerConfigMessage}
            canConfigure={canConfigureProvider}
            onSave={configureProvider}
            onClear={clearRuntimeProviderConfig}
          />
          <div style={{ color: "#94a3b8", fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>Environment: {runtimeEnvironmentMode}</span>
            <span>API: {apiBaseDisplay}</span>
            <span>Runtime: {formatRuntimeStatusLabel(runtimeStatus)}</span>
            <span>{runtimeHealthSummary}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        background: "#0f1117",
        color: "#e2e8f0",
        overflow: "auto",
        padding: 20,
        display: "grid",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        {[
          { label: "Urgent runs", value: dashboardSummary.urgentRunCount, tone: "#fc8181" },
          { label: "Needs review", value: dashboardSummary.needsReviewCount, tone: "#f6ad55" },
          { label: "Blocked", value: dashboardSummary.blockedRunCount, tone: "#f6e05e" },
          { label: "Active", value: dashboardSummary.activeRunCount, tone: "#63b3ed" },
          { label: "Archived", value: dashboardSummary.archivedRunCount, tone: "#718096" },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 14,
              padding: 14,
              display: "grid",
              gap: 4,
              transition: "transform 160ms ease, border-color 160ms ease",
            }}
          >
            <div style={{ color: "#718096", fontSize: 11, textTransform: "uppercase", fontWeight: 700 }}>
              {item.label}
            </div>
            <div style={{ color: item.tone, fontSize: 24, fontWeight: 800 }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div style={{ color: "#94a3b8", fontSize: 12 }}>
        {authMode === "jwt"
          ? sessionLifecycle === "signed_in"
            ? `Signed in as ${currentActor.displayName} with ${currentActor.role} access.`
            : authMessage || "Read-only mode until a valid session is available."
          : `Local actor mode is active for ${currentActor.displayName}.`}
      </div>

      <div style={{ color: "#718096", fontSize: 11, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span>Environment: {runtimeEnvironmentMode}</span>
        <span>API: {apiBaseDisplay}</span>
        <span>Runtime: {formatRuntimeStatusLabel(runtimeStatus)}</span>
        <span>{runtimeHealthSummary}</span>
        {runtimeFallbackLikely ? <span>Using fallback behavior</span> : null}
      </div>

      <DashboardSetupStrip
        handoff={productGraphHandoff}
        handoffLoading={productGraphHandoffLoading}
        handoffError={productGraphHandoffError}
        providerStatus={providerStatus}
      />

      <ProviderSetupCard
        providerStatus={providerStatus}
        providerConfigSaving={providerConfigSaving}
        providerConfigMessage={providerConfigMessage}
        canConfigure={canConfigureProvider}
        onSave={configureProvider}
        onClear={clearRuntimeProviderConfig}
      />

      <AgentCollaborationCard
        graphId={agentHubGraphId}
        frontier={agentFrontier}
        summary={agentFrontierSummary}
        activity={agentActivity}
        proposals={agentPlanProposals}
        context={agentContext}
        loading={agentCollaborationLoading}
        error={agentCollaborationError}
        message={agentCollaborationMessage}
        canManage={canConfigureProvider}
        onLoadContext={loadAgentContext}
        onAcceptProposal={acceptAgentPlanProposal}
        onDismissProposal={dismissAgentPlanProposal}
        onOpenGraph={openGraph}
      />

      {runtimeMessage && runtimeStatus !== "connected" ? (
        <div
          style={{
            background: "#111827",
            border: "1px solid #374151",
            borderRadius: 12,
            padding: "10px 12px",
            color: "#e2e8f0",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          {runtimeMessage}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={dashboardQuery}
            onChange={(event) => setDashboardQuery(event.target.value)}
            placeholder="Search goals, drift, notifications, review reasons..."
            style={{
              background: "#111827",
              color: "#e2e8f0",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
              minWidth: 280,
            }}
          />
          <select
            value={dashboardLifecycle}
            onChange={(event) => setDashboardLifecycle(event.target.value as typeof dashboardLifecycle)}
            style={{
              background: "#111827",
              color: "#e2e8f0",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
            }}
          >
            <option value="all">All lifecycles</option>
            <option value="active">Active</option>
            <option value="needs_attention">Needs attention</option>
            <option value="completed_recent">Completed recent</option>
            <option value="archived">Archived</option>
          </select>
          <select
            value={dashboardAttention}
            onChange={(event) => setDashboardAttention(event.target.value as typeof dashboardAttention)}
            style={{
              background: "#111827",
              color: "#e2e8f0",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
            }}
          >
            <option value="all">All attention</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={dashboardStatus}
            onChange={(event) => setDashboardStatus(event.target.value as typeof dashboardStatus)}
            style={{
              background: "#111827",
              color: "#e2e8f0",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
            }}
          >
            <option value="all">All statuses</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="blocked">Blocked</option>
            <option value="stopped">Stopped</option>
            <option value="idle">Idle</option>
          </select>
          <select
            value={dashboardFilter}
            onChange={(event) => setDashboardFilter(event.target.value as typeof dashboardFilter)}
            style={{
              background: "#111827",
              color: "#e2e8f0",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
            }}
          >
            <option value="all">All runs</option>
            <option value="attention_first">Attention first</option>
            <option value="needs_review">Needs review</option>
            <option value="blocked">Blocked</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
          <select
            value={dashboardSort}
            onChange={(event) => setDashboardSort(event.target.value as typeof dashboardSort)}
            style={{
              background: "#111827",
              color: "#e2e8f0",
              border: "1px solid #374151",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
            }}
          >
            <option value="highest_attention">Highest attention</option>
            <option value="most_recent">Most recent</option>
            <option value="progress">Progress</option>
          </select>
        </div>

        <button
          onClick={() => mostUrgentRun && void openGraph(mostUrgentRun.graphId)}
          disabled={!mostUrgentRun}
          style={{
            background: "#1d4ed8",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 700,
            cursor: mostUrgentRun ? "pointer" : "not-allowed",
            opacity: mostUrgentRun ? 1 : 0.6,
          }}
        >
          Open most urgent run
        </button>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {presentedItems.map((item) => (
          <div
            key={item.graphId}
            onClick={() => void openGraph(item.graphId)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void openGraph(item.graphId);
              }
            }}
            role="button"
            tabIndex={0}
            style={{
              textAlign: "left",
              background: "#111827",
              border: `1px solid ${severityColor[item.highestAlertSeverity ?? "none"]}`,
              borderRadius: 16,
              padding: 16,
              display: "grid",
              gap: 10,
              cursor: "pointer",
              opacity: item.lifecycleBucket === "archived" ? 0.72 : 1,
              transition: "transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease",
              boxShadow: "0 10px 26px rgba(0,0,0,0.12)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 800 }}>{item.goalTitle}</div>
                <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.4 }}>
                  {item.latestNotificationSummary ||
                    item.lineageSummary ||
                    item.latestDecisionSummary ||
                    item.changesSinceLastViewed?.changesSinceLastViewedSummary ||
                    "No important updates right now."}
                </div>
              </div>
              <div
                style={{
                  color: attentionTone(item.attentionLabel),
                  fontSize: 11,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  display: "grid",
                  justifyItems: "end",
                  gap: 4,
                }}
              >
                <span>{item.attentionLabel}</span>
                <span style={{ color: "#94a3b8" }}>{item.lifecycleBucket.replace("_", " ")}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", color: "#cbd5e0", fontSize: 12 }}>
              <span>Status: {item.graphStatus}</span>
              <span>Run: {item.runControlState}</span>
              {item.waitingForApproval ? <span>Waiting for approval</span> : null}
              <span>
                Progress: {item.completedNodeCount}/{item.plannedNodeCount}
              </span>
              <span>Frontier: {formatFrontierStatusLabel(item.frontierStatus)}</span>
              {item.needsHumanReview ? <span>Needs review</span> : null}
            </div>

            {item.changesSinceLastViewed?.newEventCount ? (
              <div style={{ color: "#f6e05e", fontSize: 12, lineHeight: 1.4 }}>
                {item.changesSinceLastViewed.changesSinceLastViewedSummary}
              </div>
            ) : null}

            {item.latestCompletedNodeSummary ? (
              <div style={{ color: "#a0aec0", fontSize: 12, lineHeight: 1.4 }}>
                Latest completed step: {item.latestCompletedNodeSummary}
              </div>
            ) : null}

            {uiMode === "default" && item.lineageSummary ? (
              <div style={{ color: "#90cdf4", fontSize: 12, lineHeight: 1.4 }}>
                {item.lineageSummary}
              </div>
            ) : null}

            {item.searchSnippet && dashboardQuery.trim() ? (
              <div style={{ color: "#90cdf4", fontSize: 12, lineHeight: 1.4 }}>
                Match: {item.searchSnippet}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void loadSimilarRuns(item.graphId);
                }}
                style={{
                  background: "#1f2937",
                  color: "#e2e8f0",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Similar runs
              </button>
            </div>

            {uiMode === "developer" ? (
              <div style={{ color: "#718096", fontSize: 11, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span>Alerts: {item.alertCount}</span>
                <span>Pass rate: {(item.passRate * 100).toFixed(0)}%</span>
                <span>Revision rate: {(item.revisionRate * 100).toFixed(0)}%</span>
                <span>Evidence: {(item.evidenceCoverageRate * 100).toFixed(0)}%</span>
                <span>Attention: {item.attentionScore}</span>
                <span>Approval: {item.approvalState}</span>
                <span>Lineage: {item.lineageSummary ?? "(none)"}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {similarRunsForGraphId ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 800 }}>Similar past runs</div>
          {similarRuns.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 12 }}>
              No similar runs were found from the current projection-derived history.
            </div>
          ) : (
            similarRuns.slice(0, 6).map((item) => (
              <div
                key={item.graphId}
                style={{
                  background: "#111827",
                  border: "1px solid #1f2937",
                  borderRadius: 14,
                  padding: 14,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700 }}>{item.goalTitle}</div>
                    <div style={{ color: "#94a3b8", fontSize: 12 }}>
                      {item.latestNotificationSummary || item.lineageSummary || item.latestCompletedNodeSummary || "No important updates right now."}
                    </div>
                  </div>
                  <div style={{ color: "#90cdf4", fontSize: 12, fontWeight: 700 }}>
                    {(item.similarityScore * 100).toFixed(0)}% similar
                  </div>
                </div>
                <div style={{ color: "#a0aec0", fontSize: 11, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>{item.lifecycleBucket.replace("_", " ")}</span>
                  <span>{formatFrontierStatusLabel(item.frontierStatus)}</span>
                  {item.lineageSummary ? <span>{item.lineageSummary}</span> : null}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      void openGraph(item.graphId);
                    }}
                    style={{
                      background: "#1f2937",
                      color: "#e2e8f0",
                      border: "1px solid #374151",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Open run
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      void loadComparison(similarRunsForGraphId, item.graphId);
                    }}
                    style={{
                      background: "#1d4ed8",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Compare with similar run
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {comparison ? (
        <div
          style={{
            background: "#111827",
            border: "1px solid #1f2937",
            borderRadius: 16,
            padding: 16,
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <div style={{ color: "#90cdf4", fontSize: 10, textTransform: "uppercase", fontWeight: 700 }}>
                Comparison
              </div>
              <div style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 800 }}>{comparison.summary}</div>
            </div>
            <button
              onClick={clearComparison}
              style={{
                background: "#1f2937",
                color: "#e2e8f0",
                border: "1px solid #374151",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Close comparison
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            {[comparison.left, comparison.right].map((side) => (
              <div
                key={side.graphId}
                style={{
                  background: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: 14,
                  padding: 14,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 800 }}>{side.goalTitle}</div>
                <div style={{ color: "#a0aec0", fontSize: 12, display: "grid", gap: 4 }}>
                  <span>Status: {side.graphStatus}</span>
                  <span>Frontier: {formatFrontierStatusLabel(side.frontierStatus)}</span>
                  <span>Run: {side.runControlState}</span>
                  <span>Approval: {side.approvalState}</span>
                  {side.waitingForApproval ? <span>Waiting for approval</span> : null}
                  <span>
                    Progress: {side.completedNodeCount}/{side.plannedNodeCount}
                  </span>
                  <span>Pass rate: {(side.passRate * 100).toFixed(0)}%</span>
                  <span>Revision rate: {(side.revisionRate * 100).toFixed(0)}%</span>
                  <span>Evidence: {(side.evidenceCoverageRate * 100).toFixed(0)}%</span>
                  <span>Drift trend: {side.driftTrend}</span>
                  <span>{side.needsHumanReview ? "Needs review" : "No current review flag"}</span>
                  <span>{side.latestDecisionSummary || side.latestNotificationSummary || "No important updates right now."}</span>
                  <span>{side.lineageSummary || "Lineage information is not available."}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
