import { useMemo } from "react";
import type { GraphTaskLensId, WorkspaceGraphOperationalContext } from "@openagentgraph/shared";
import {
  dashboardLensOptions,
  fusionCheckTone,
  hardFusionChecks,
  healthBadgeTone,
  unavailableReasonLabel,
  warnFusionChecks,
  workspaceGraphEmptyMessage,
} from "../lib/graphOperational.js";

export function GraphOperationalPanel({
  context,
  selectedLens,
  loading,
  error,
  onSelectLens,
  onRefresh,
}: {
  context: WorkspaceGraphOperationalContext | null;
  selectedLens: GraphTaskLensId;
  loading: boolean;
  error: string;
  onSelectLens: (lens: GraphTaskLensId) => void;
  onRefresh: () => void;
}) {
  const lensOptions = useMemo(() => dashboardLensOptions(context), [context]);
  const emptyMessage = workspaceGraphEmptyMessage(context);
  const hardChecks = hardFusionChecks(context);
  const warnChecks = warnFusionChecks(context);
  const readTheseFirst = context?.readTheseFirst ?? [];
  const godNodes = context?.godNodes ?? [];

  return (
    <section
      aria-label="Graph operational panel"
      style={{
        background: "#0f172a",
        border: "1px solid #263244",
        borderRadius: 14,
        padding: 12,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ color: "#63b3ed", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Code graph health
          </div>
          <div style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 800 }}>Lens, fusion, and read-first guidance</div>
          <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>
            Uses exported .oag/graph.json when present. No provider key required.
          </div>
        </div>
        <button
          type="button"
          aria-label="Refresh graph operational context"
          disabled={loading}
          onClick={onRefresh}
          style={{
            background: loading ? "#1f2937" : "#2563eb",
            color: "#f8fafc",
            border: "1px solid #334155",
            borderRadius: 8,
            padding: "7px 10px",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <div style={{ color: "#f97316", fontSize: 12 }}>{error}</div> : null}

      {!context?.available && !loading ? (
        <div
          role="status"
          aria-label="Graph operational empty state"
          style={{ border: "1px solid #334155", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}
        >
          <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 900 }}>
            {unavailableReasonLabel(context?.unavailableReason)}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.45 }}>{emptyMessage}</div>
          {context?.unavailableDetail ? (
            <div style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.4 }}>{context.unavailableDetail}</div>
          ) : null}
        </div>
      ) : null}

      {context?.available ? (
        <>
          <div
            role="group"
            aria-label="Graph lens selector"
            style={{ display: "grid", gap: 6, border: "1px solid #263244", borderRadius: 10, padding: 9 }}
          >
            <div style={{ color: "#c4b5fd", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>Lens selector</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {lensOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-label={`Show ${option.label} graph lens`}
                  aria-pressed={selectedLens === option.id}
                  title={option.description}
                  onClick={() => onSelectLens(option.id)}
                  style={{
                    background: selectedLens === option.id ? "#1e3a5f" : "transparent",
                    border: `1px solid ${selectedLens === option.id ? "#8b5cf6" : "#263244"}`,
                    borderRadius: 8,
                    color: option.count > 0 || option.id === "all" ? "#cbd5e1" : "#64748b",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "6px 8px",
                  }}
                >
                  {option.label} ({option.count})
                </button>
              ))}
            </div>
            {context.unavailableReason === "lens_no_matches" ? (
              <div style={{ color: "#f6ad55", fontSize: 11, lineHeight: 1.4 }}>{emptyMessage}</div>
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 11 }}>
                Scoped view: {context.scopedNodeCount ?? 0} nodes, {context.scopedEdgeCount ?? 0} edges
                {context.primaryLens ? ` · recommended lens: ${context.primaryLens}` : ""}
              </div>
            )}
          </div>

          {context.health ? (
            <div
              role="group"
              aria-label="Graph health badges"
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}
            >
              {context.health.badges.map((badge) => {
                const tone = healthBadgeTone(badge.tone);
                return (
                  <div
                    key={badge.label}
                    style={{
                      border: `1px solid ${tone.border}`,
                      borderRadius: 8,
                      padding: 8,
                      display: "grid",
                      gap: 3,
                    }}
                  >
                    <div style={{ color: tone.accent, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>{badge.label}</div>
                    <div style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.35 }}>{badge.detail}</div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {(hardChecks.length > 0 || warnChecks.length > 0) ? (
            <div
              role="group"
              aria-label="Fusion checks summary"
              style={{ border: "1px solid #263244", borderRadius: 10, padding: 9, display: "grid", gap: 6 }}
            >
              <div style={{ color: "#f6ad55", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>Fusion checks</div>
              {[...hardChecks, ...warnChecks].slice(0, 6).map((check) => {
                const tone = fusionCheckTone(check.severity);
                return (
                  <div
                    key={check.code}
                    style={{
                      border: `1px solid ${tone.border}`,
                      background: tone.background,
                      borderRadius: 8,
                      padding: 8,
                      display: "grid",
                      gap: 3,
                    }}
                  >
                    <div style={{ color: tone.accent, fontSize: 11, fontWeight: 900 }}>
                      [{check.severity}] {check.title}
                    </div>
                    <div style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.35 }}>{check.detail}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: "#68d391", fontSize: 11 }}>No fusion hard warnings detected.</div>
          )}

          <div
            role="group"
            aria-label="Read these first"
            style={{ border: "1px solid #263244", borderRadius: 10, padding: 9, display: "grid", gap: 6 }}
          >
            <div style={{ color: "#86efac", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>Read these first</div>
            {readTheseFirst.length > 0 ? (
              readTheseFirst.slice(0, 6).map((node) => (
                <div key={node.id} style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.35 }}>
                  <strong style={{ color: "#e2e8f0" }}>{node.label}</strong>
                  {node.path ? ` · ${node.path}` : ""} ({node.kind})
                </div>
              ))
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 11 }}>No read-first nodes yet. Export the graph after scanning.</div>
            )}
          </div>

          {godNodes.length > 0 ? (
            <div
              role="group"
              aria-label="God node warnings"
              style={{ border: "1px solid #263244", borderRadius: 10, padding: 9, display: "grid", gap: 6 }}
            >
              <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>Community hubs</div>
              {godNodes.slice(0, 4).map((godNode) => (
                <div key={godNode.id} style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.35 }}>
                  <strong style={{ color: "#e2e8f0" }}>{godNode.label}</strong> — {godNode.summary}
                </div>
              ))}
            </div>
          ) : null}

          {context.queryEntryPoints ? (
            <div
              role="group"
              aria-label="Graph query entry points"
              style={{ border: "1px solid #263244", borderRadius: 10, padding: 9, display: "grid", gap: 4 }}
            >
              <div style={{ color: "#93c5fd", fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>CLI graph tools</div>
              <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.4, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {context.queryEntryPoints.queryHint}
              </div>
              <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.4, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {context.queryEntryPoints.pathHint}
              </div>
              <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.4, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {context.queryEntryPoints.explainHint}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}