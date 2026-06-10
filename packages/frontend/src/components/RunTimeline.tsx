import { useMemo, useState } from "react";
import { useStore } from "../lib/store.js";
import { buildFrontendReplayFrame } from "../lib/replay.js";
import { getNodeDisplaySummary, getNodeStatusCopy } from "../lib/nodeSummary.js";

const KIND_COLOR: Record<string, string> = {
  "system.lineage_declared": "#7f9cf5",
  "node.lineage_bound": "#63b3ed",
  "run.started": "#63b3ed",
  "run.pause_requested": "#f6ad55",
  "run.paused": "#ed8936",
  "run.resume_requested": "#63b3ed",
  "run.resumed": "#4299e1",
  "run.stop_requested": "#fc8181",
  "run.stopped": "#e53e3e",
  "run.review_requested": "#f6ad55",
  "run.annotated": "#81e6d9",
  "node.annotated": "#4fd1c5",
  "run.approval_requested": "#f6e05e",
  "run.approved": "#68d391",
  "run.rejected": "#fc8181",
  "run.continue_requested": "#63b3ed",
  "node.planned": "#4a5568",
  "node.ready": "#3182ce",
  "node.executing": "#d69e2e",
  "node.completed": "#38a169",
  "node.summarized": "#81e6d9",
  "node.failed": "#e53e3e",
  "node.superseded": "#718096",
  "node.evaluated": "#f6e05e",
  "replan.branched": "#b794f4",
  "run.completed": "#38a169",
  "run.failed": "#e53e3e",
};

const BUTTON_STYLE: React.CSSProperties = {
  background: "#2d3748",
  color: "#e2e8f0",
  border: "1px solid #4a5568",
  borderRadius: 6,
  padding: "5px 9px",
  fontSize: 11,
  cursor: "pointer",
};

export function RunTimeline() {
  const { events, nodes, edges, graphs, activeGraphId, uiMode, frontierStatus, driftSummary, runControlState } = useStore();
  const [replayStep, setReplayStep] = useState<number | null>(null);
  const activeGraph = useMemo(
    () => graphs.find((graph) => graph.id === activeGraphId) ?? null,
    [graphs, activeGraphId]
  );

  const activeStep = replayStep ?? events.length;
  const frame = useMemo(
    () =>
      buildFrontendReplayFrame(
        events,
        nodes,
        edges,
        activeGraph?.status ?? null,
        runControlState,
        frontierStatus,
        driftSummary,
        activeStep
      ),
    [events, nodes, edges, activeGraph?.status, runControlState, frontierStatus, driftSummary, activeStep]
  );

  if (events.length === 0) return null;

  const currentEventColor = frame.event ? KIND_COLOR[frame.event.kind] ?? "#4a5568" : "#4a5568";
  const visibleNodes = frame.nodes.slice(-4);

  return (
    <div
      style={{
        height: 188,
        background: "#1a202c",
        borderTop: "1px solid #2d3748",
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        gap: 12,
        padding: "12px 16px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          background: "#0f1117",
          border: "1px solid #2d3748",
          borderRadius: 10,
          padding: "12px",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#90cdf4", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
              Replay
            </div>
            <div style={{ color: "#e2e8f0", fontSize: 12 }}>
              Step {frame.stepIndex} of {frame.totalSteps}
            </div>
          </div>
          <div style={{ color: currentEventColor, fontSize: 11, fontWeight: 700 }}>
            {frame.event?.kind ?? "baseline"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button style={BUTTON_STYLE} onClick={() => setReplayStep(0)}>
            First
          </button>
          <button
            style={BUTTON_STYLE}
            onClick={() => setReplayStep(Math.max(activeStep - 1, 0))}
          >
            Previous
          </button>
          <button
            style={BUTTON_STYLE}
            onClick={() => setReplayStep(Math.min(activeStep + 1, events.length))}
          >
            Next
          </button>
          <button style={BUTTON_STYLE} onClick={() => setReplayStep(events.length)}>
            Latest
          </button>
        </div>

        <div style={{ color: "#cbd5e0", fontSize: 12, lineHeight: 1.45 }}>
          {uiMode === "developer"
            ? frame.event
              ? `Applying ${frame.event.kind} at ${new Date(frame.event.ts).toLocaleTimeString()}.`
              : "Replay baseline: no events have been applied yet."
            : frame.plainEnglishSummary}
        </div>

        {uiMode === "developer" && frame.event ? (
          <div
            style={{
              background: "#111827",
              border: "1px solid #2d3748",
              borderRadius: 8,
              padding: "8px 10px",
              color: "#cbd5e0",
              fontSize: 10,
              whiteSpace: "pre-wrap",
              overflow: "auto",
              maxHeight: 72,
              fontFamily: "monospace",
            }}
          >
            {JSON.stringify(frame.event.payload, null, 2)}
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, color: "#a0aec0" }}>
          <div>Graph status: {frame.graphStatus}</div>
          <div>Run control: {frame.runControlState}</div>
          <div>Frontier: {frame.frontierStatus}</div>
          <div>Nodes visible: {frame.nodes.length}</div>
          <div>Edges visible: {frame.edges.length}</div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          overflowY: "hidden",
          alignItems: "stretch",
        }}
      >
        {visibleNodes.length === 0 ? (
          <div
            style={{
              minWidth: 280,
              background: "#0f1117",
              border: "1px dashed #2d3748",
              borderRadius: 10,
              padding: "12px",
              color: "#718096",
              fontSize: 12,
            }}
          >
            {uiMode === "developer"
              ? "Baseline replay state: the graph is empty and idle."
              : "The replay is at the very beginning. No steps have been added yet."}
          </div>
        ) : (
          visibleNodes.map((node) => (
            <div
              key={node.id}
              style={{
                minWidth: uiMode === "developer" ? 210 : 240,
                background: "#0f1117",
                border: `1px solid ${KIND_COLOR[frame.event?.kind ?? "node.planned"] ?? "#4a5568"}`,
                borderRadius: 10,
                padding: "10px 12px",
                display: "grid",
                gap: 5,
                flexShrink: 0,
              }}
            >
              <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 700 }}>{node.title}</div>
              <div style={{ color: "#90cdf4", fontSize: 10, textTransform: "uppercase", fontWeight: 700 }}>
                {getNodeStatusCopy(node)}
              </div>
              <div style={{ color: "#a0aec0", fontSize: 11, lineHeight: 1.35 }}>
                {uiMode === "developer"
                  ? `${node.kind}${node.branchId ? ` • ${node.branchId}` : ""}`
                  : node.lineageSummary || getNodeDisplaySummary(node)}
              </div>
              {uiMode === "developer" && frame.event?.nodeId === node.id ? (
                <div style={{ color: "#718096", fontSize: 10 }}>
                  Current event payload is available in the event log for this step.
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
