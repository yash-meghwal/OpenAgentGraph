import { useMemo } from "react";
import { useStore } from "../lib/store.js";
import { formatSessionLifecycleLabel, formatRuntimeStatusLabel, getRuntimeBannerTone } from "../lib/productCopy.js";

const severityColor = {
  critical: "#fc8181",
  warning: "#f6ad55",
  info: "#63b3ed",
} as const;

export function ActivityPanel() {
  const {
    authMode,
    sessionLifecycle,
    authMessage,
    runtimeStatus,
    runtimeMessage,
    runtimeHealthSummary,
    runtimeFallbackLikely,
    activeGraphId,
    alerts,
    latestNotificationSummary,
    latestDecisionSummary,
    latestAnnotationSummary,
    peopleSummary,
    lineageSummary,
    changesSinceLastViewed,
    activityOpen,
    setActivityOpen,
    markGraphViewed,
    uiMode,
  } = useStore();

  const orderedAlerts = useMemo(() => alerts, [alerts]);
  const runtimeTone = getRuntimeBannerTone(runtimeStatus);

  if (!activityOpen) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 60,
        right: 16,
        width: 360,
        maxHeight: 520,
        overflowY: "auto",
        background: "rgba(15, 17, 23, 0.98)",
        border: "1px solid #2d3748",
        borderRadius: 14,
        boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
        padding: 14,
        zIndex: 40,
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: "#90cdf4", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>Activity</div>
          <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700 }}>Operator inbox</div>
        </div>
        <button
          onClick={() => setActivityOpen(false)}
          style={{ background: "transparent", border: "none", color: "#718096", cursor: "pointer", fontSize: 18 }}
        >
          ×
        </button>
      </div>

      {changesSinceLastViewed?.newEventCount ? (
        <div style={{ background: "#111827", border: "1px solid #2d3748", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ color: "#f6e05e", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
            Since last viewed
          </div>
          <div style={{ color: "#e2e8f0", fontSize: 12, lineHeight: 1.45 }}>
            {changesSinceLastViewed.changesSinceLastViewedSummary}
          </div>
        </div>
      ) : null}

      {authMode === "jwt" && sessionLifecycle !== "signed_in" ? (
        <div style={{ background: "#111827", border: "1px solid #744210", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ color: "#f6e05e", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
            {formatSessionLifecycleLabel(sessionLifecycle)}
          </div>
          <div style={{ color: "#e2e8f0", fontSize: 12, lineHeight: 1.45 }}>
            {authMessage ||
              (sessionLifecycle === "expired_session"
                ? "Your session has expired. Add a new token to continue."
                : "This environment allows viewing, but protected actions require sign-in.")}
          </div>
        </div>
      ) : null}

      {runtimeMessage && runtimeStatus !== "connected" ? (
        <div style={{ background: "#111827", border: `1px solid ${runtimeTone.border}`, borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ color: runtimeTone.accent, fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
            {formatRuntimeStatusLabel(runtimeStatus)}
          </div>
          <div style={{ color: "#e2e8f0", fontSize: 12, lineHeight: 1.45 }}>
            {runtimeMessage}
          </div>
        </div>
      ) : null}

      {runtimeHealthSummary ? (
        <div style={{ background: "#111827", border: "1px solid #2d3748", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ color: "#81e6d9", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
            Runtime health
          </div>
          <div style={{ color: "#e2e8f0", fontSize: 12, lineHeight: 1.45 }}>
            {runtimeHealthSummary}
          </div>
          {runtimeFallbackLikely ? (
            <div style={{ color: "#f6e05e", fontSize: 11, lineHeight: 1.45, marginTop: 6 }}>
              AI features are using fallback behavior.
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => activeGraphId && markGraphViewed(activeGraphId)}
          style={{
            background: "#2d3748",
            color: "#e2e8f0",
            border: "1px solid #4a5568",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 11,
            cursor: activeGraphId ? "pointer" : "not-allowed",
            opacity: activeGraphId ? 1 : 0.6,
          }}
        >
          Mark as viewed
        </button>
      </div>

      {orderedAlerts.length === 0 && !(changesSinceLastViewed?.newEventCount) && !latestDecisionSummary && !latestAnnotationSummary && !latestNotificationSummary && !lineageSummary && !peopleSummary ? (
        <div style={{ color: "#a0aec0", fontSize: 12, lineHeight: 1.5 }}>
          No important updates right now. This inbox will surface runtime changes, review signals, and human decisions for the current run.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {latestNotificationSummary ? (
            <div style={{ color: "#cbd5e0", fontSize: 12, lineHeight: 1.4 }}>
              {latestNotificationSummary}
            </div>
          ) : null}
          {latestDecisionSummary ? (
            <div style={{ color: "#fbd38d", fontSize: 12, lineHeight: 1.4 }}>
              {latestDecisionSummary}
            </div>
          ) : null}
          {latestAnnotationSummary ? (
            <div style={{ color: "#a0aec0", fontSize: 12, lineHeight: 1.4 }}>
              {latestAnnotationSummary}
            </div>
          ) : null}
          {peopleSummary ? (
            <div style={{ color: "#e2e8f0", fontSize: 12, lineHeight: 1.4 }}>
              {peopleSummary}
            </div>
          ) : null}
          {lineageSummary ? (
            <div style={{ color: "#90cdf4", fontSize: 12, lineHeight: 1.4 }}>
              {lineageSummary}
            </div>
          ) : null}
          {orderedAlerts.map((alert) => (
            <div
              key={alert.id}
              style={{
                background: "#111827",
                border: `1px solid ${severityColor[alert.severity]}`,
                borderRadius: 10,
                padding: "10px 12px",
                display: "grid",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ color: severityColor[alert.severity], fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                  {alert.severity}
                </div>
                <div style={{ color: "#718096", fontSize: 10 }}>
                  {new Date(alert.createdAt).toLocaleTimeString()}
                </div>
              </div>
              <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 700 }}>{alert.title}</div>
              <div style={{ color: "#cbd5e0", fontSize: 12, lineHeight: 1.4 }}>{alert.message}</div>
              {uiMode === "developer" && (alert.relatedNodeId || alert.relatedEventSequence) ? (
                <div style={{ color: "#718096", fontSize: 10 }}>
                  {alert.relatedNodeId ? `node ${alert.relatedNodeId}` : ""}
                  {alert.relatedNodeId && alert.relatedEventSequence ? " • " : ""}
                  {alert.relatedEventSequence ? `event #${alert.relatedEventSequence}` : ""}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
