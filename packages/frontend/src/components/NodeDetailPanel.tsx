import { useMemo, useState } from "react";
import { toPlainEnglishFailureSummary, toPlainEnglishSummary } from "@openagentgraph/shared";
import { useStore } from "../lib/store.js";
import { getNodeDisplaySummary, getNodeStatusCopy } from "../lib/viewMode.js";

const PANEL: React.CSSProperties = {
  width: 380,
  background: "#1a202c",
  borderLeft: "1px solid #2d3748",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const SECTION_TITLE: React.CSSProperties = {
  color: "#718096",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 6,
};

const CARD: React.CSSProperties = {
  background: "#0f1117",
  border: "1px solid #2d3748",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 12,
  color: "#e2e8f0",
  lineHeight: 1.5,
};

const CODE_BLOCK: React.CSSProperties = {
  ...CARD,
  whiteSpace: "pre-wrap",
  overflowY: "auto",
  maxHeight: 220,
  fontFamily: "monospace",
};

const BADGE: (color: string) => React.CSSProperties = (color) => ({
  display: "inline-block",
  background: color,
  color: "#fff",
  borderRadius: 999,
  padding: "3px 8px",
  fontSize: 10,
  fontWeight: 700,
});

export function NodeDetailPanel() {
  const {
    nodes,
    edges,
    selectedNodeId,
    activeGraphId,
    events,
    agentContext,
    agentCollaborationLoading,
    agentCollaborationError,
    agentCollaborationMessage,
    currentActor,
    capabilities,
    loadAgentContext,
    retryNode,
    replanNode,
    annotateNode,
    uiMode,
    needsHumanReview,
    humanReviewReason,
    waitingForApproval,
    latestDecisionSummary,
    lineageSummary,
    lineageDescriptors,
  } = useStore();
  const [replanGoal, setReplanGoal] = useState("");
  const [replanReason, setReplanReason] = useState("");
  const [annotationText, setAnnotationText] = useState("");
  const [tab, setTab] = useState<"summary" | "developer">("summary");
  const [agentContextCopyMessage, setAgentContextCopyMessage] = useState("");

  const node = nodes.find((candidate) => candidate.id === selectedNodeId);

  const ancestry = useMemo(() => {
    if (!node) return null;
    const parent = node.parentNodeId ? nodes.find((candidate) => candidate.id === node.parentNodeId) : null;
    const children = nodes.filter((candidate) => candidate.parentNodeId === node.id);
    const relatedEdges = edges.filter(
      (edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id
    );
    const nodeEvents = events.filter((event) => event.nodeId === node.id);
    return { parent, children, relatedEdges, nodeEvents };
  }, [node, nodes, edges, events]);

  if (!node || !ancestry) {
    return (
      <div style={{ ...PANEL, alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#4a5568", fontSize: 13 }}>Select a step to inspect.</p>
      </div>
    );
  }

  const defaultSummary = getNodeDisplaySummary(node);
  const statusCopy = getNodeStatusCopy(node);
  const selectedAgentContext =
    agentContext?.graphId === activeGraphId && agentContext.selectedNode?.nodeId === node.id
      ? agentContext
      : null;
  const agentContextJson = selectedAgentContext ? JSON.stringify(selectedAgentContext, null, 2) : "";
  const evaluation = node.evaluation;
  const failureSummary =
    toPlainEnglishFailureSummary(
      evaluation?.humanSummary?.trim() ||
        node.evidenceSummary?.trim() ||
        node.humanSummary?.trim(),
      "This step didn't complete as expected. The system is deciding what to do next."
    );

  const renderDefaultMode = () => (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <p style={SECTION_TITLE}>What This Step Means</p>
        <div style={CARD}>{defaultSummary}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <p style={SECTION_TITLE}>Status</p>
          <div style={CARD}>{statusCopy}</div>
        </div>
        <div>
          <p style={SECTION_TITLE}>Expected Outcome</p>
          <div style={CARD}>{node.contract.expectedArtifact}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <p style={SECTION_TITLE}>Confidence</p>
          <div style={CARD}>{node.confidenceBadge ? node.confidenceBadge.toUpperCase() : "MEDIUM"}</div>
        </div>
        <div>
          <p style={SECTION_TITLE}>Evidence Strength</p>
          <div style={CARD}>{node.evidenceCoverage ?? "Partial"}</div>
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Why It Exists</p>
        <div style={CARD}>{toPlainEnglishSummary(node.intent, "This step explains part of the current plan.")}</div>
      </div>

      {needsHumanReview ? (
        <div>
          <p style={SECTION_TITLE}>Review Signal</p>
          <div style={CARD}>{humanReviewReason || "This run may need a human decision before it continues."}</div>
        </div>
      ) : null}

      {waitingForApproval || latestDecisionSummary ? (
        <div>
          <p style={SECTION_TITLE}>Decision State</p>
          <div style={CARD}>
            {latestDecisionSummary || "This run is waiting for a human decision before it continues."}
          </div>
        </div>
      ) : null}

      {node.lineageSummary || lineageSummary ? (
        <div>
          <p style={SECTION_TITLE}>System Lineage</p>
          <div style={CARD}>{node.lineageSummary || lineageSummary}</div>
        </div>
      ) : null}

      {node.status === "failed" || evaluation?.passed === false ? (
        <div>
          <p style={SECTION_TITLE}>What Happened</p>
          <div style={CARD}>{failureSummary}</div>
        </div>
      ) : null}

      <div>
        <p style={SECTION_TITLE}>Latest Step Summary</p>
        <div style={CARD}>
          {toPlainEnglishSummary(
            node.semanticSummary || node.humanSummary,
            "This step is waiting for a concrete summary."
          )}
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Evidence</p>
        <div style={CARD}>
          {toPlainEnglishSummary(
            node.evidenceSummary,
            "A plain-English evidence summary is not available for this step yet."
          )}
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Agent Context Pack</p>
        <div style={{ ...CARD, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={async () => {
                if (!activeGraphId) return;
                setAgentContextCopyMessage("");
                await loadAgentContext(activeGraphId, node.id);
              }}
              disabled={!activeGraphId || agentCollaborationLoading}
              style={{
                background: activeGraphId && !agentCollaborationLoading ? "#2d3748" : "#1f2937",
                color: "#e2e8f0",
                border: "1px solid #4a5568",
                borderRadius: 6,
                padding: "7px 10px",
                cursor: activeGraphId && !agentCollaborationLoading ? "pointer" : "not-allowed",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {agentCollaborationLoading ? "Loading..." : "Load context"}
            </button>
            <button
              onClick={async () => {
                if (!agentContextJson) return;
                if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
                  setAgentContextCopyMessage("Clipboard is unavailable.");
                  return;
                }
                await navigator.clipboard.writeText(agentContextJson);
                setAgentContextCopyMessage("Context JSON copied.");
              }}
              disabled={!agentContextJson}
              style={{
                background: agentContextJson ? "#0f172a" : "#1f2937",
                color: "#e2e8f0",
                border: "1px solid #4a5568",
                borderRadius: 6,
                padding: "7px 10px",
                cursor: agentContextJson ? "pointer" : "not-allowed",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Copy JSON
            </button>
          </div>
          {selectedAgentContext ? (
            <>
              <div style={{ color: "#a0aec0", fontSize: 11 }}>
                {selectedAgentContext.frontier.length} frontier nodes ·{" "}
                {selectedAgentContext.recentAgentActivity.length} agent updates ·{" "}
                {selectedAgentContext.planProposals.length} open proposals
              </div>
              <div style={CODE_BLOCK}>{agentContextJson}</div>
            </>
          ) : (
            <div style={{ color: "#718096", fontSize: 12 }}>
              {activeGraphId ? "No context pack loaded for this step." : "Open a run to load context."}
            </div>
          )}
          {agentCollaborationError ? <div style={{ color: "#f97316", fontSize: 12 }}>{agentCollaborationError}</div> : null}
          {agentContextCopyMessage || agentCollaborationMessage ? (
            <div style={{ color: "#34d399", fontSize: 12 }}>{agentContextCopyMessage || agentCollaborationMessage}</div>
          ) : null}
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Annotations</p>
        <div style={{ display: "grid", gap: 8 }}>
          {node.annotations?.length ? (
            node.annotations
              .slice()
              .reverse()
              .map((annotation) => (
                <div key={annotation.annotationId} style={CARD}>
                  <div style={{ color: "#90cdf4", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                    {annotation.kind} by {annotation.authorLabel}
                  </div>
                  <div>{annotation.text}</div>
                </div>
              ))
          ) : (
            <div style={CARD}>No human notes have been added to this step yet.</div>
          )}
          <div style={CARD}>Signed in as {currentActor.displayName} ({currentActor.role})</div>
          <textarea
            value={annotationText}
            onChange={(event) => setAnnotationText(event.target.value)}
            placeholder="Add a plain-English note for this step..."
            rows={3}
            style={{
              width: "100%",
              background: "#0f1117",
              border: "1px solid #2d3748",
              borderRadius: 6,
              padding: "8px 10px",
              color: "#e2e8f0",
              fontSize: 12,
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={async () => {
              if (!annotationText.trim()) return;
              await annotateNode(node.id, {
                text: annotationText.trim(),
                kind: "note",
              });
              setAnnotationText("");
            }}
            disabled={!capabilities?.canAnnotate}
            style={{
              background: capabilities?.canAnnotate ? "#2d3748" : "#1f2937",
              color: "#e2e8f0",
              border: "1px solid #4a5568",
              borderRadius: 6,
              padding: "8px 12px",
              cursor: capabilities?.canAnnotate ? "pointer" : "not-allowed",
              fontSize: 12,
            }}
          >
            Add note to this step
          </button>
          {!capabilities?.canAnnotate ? (
            <div style={{ ...CARD, fontSize: 11, color: "#a0aec0" }}>
              This action requires operator access.
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Next Control</p>
        <div style={{ display: "grid", gap: 8 }}>
          <button
            onClick={() => retryNode(node.id)}
            style={{
              background: "#2d3748",
              color: "#e2e8f0",
              border: "1px solid #4a5568",
              borderRadius: 6,
              padding: "8px 12px",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Retry this step
          </button>
          <div style={{ ...CARD, fontSize: 11, color: "#a0aec0" }}>
            Replanning keeps the original branch visible and starts a new route from here.
          </div>
          <input
            value={replanGoal}
            onChange={(event) => setReplanGoal(event.target.value)}
            placeholder="New goal..."
            style={{
              width: "100%",
              background: "#0f1117",
              border: "1px solid #2d3748",
              borderRadius: 6,
              padding: "8px 10px",
              color: "#e2e8f0",
              fontSize: 12,
            }}
          />
          <input
            value={replanReason}
            onChange={(event) => setReplanReason(event.target.value)}
            placeholder="Why change direction?"
            style={{
              width: "100%",
              background: "#0f1117",
              border: "1px solid #2d3748",
              borderRadius: 6,
              padding: "8px 10px",
              color: "#e2e8f0",
              fontSize: 12,
            }}
          />
          <button
            onClick={() => {
              if (replanGoal && replanReason) {
                replanNode(node.id, replanGoal, replanReason);
                setReplanGoal("");
                setReplanReason("");
              }
            }}
            style={{
              background: "#553c9a",
              color: "#e2e8f0",
              border: "none",
              borderRadius: 6,
              padding: "8px 12px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Branch from this step
          </button>
        </div>
      </div>
    </div>
  );

  const renderDeveloperMode = () => (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={BADGE(node.kind === "revision" ? "#dd6b20" : node.branchId ? "#805ad5" : "#4a5568")}>
          {node.kind}
        </span>
        <span style={BADGE(node.status === "completed" ? "#38a169" : node.status === "failed" ? "#e53e3e" : "#4a5568")}>
          {node.status}
        </span>
        {node.branchId ? <span style={BADGE("#805ad5")}>{node.branchId}</span> : null}
      </div>

      <div>
        <p style={SECTION_TITLE}>Constructed Prompt</p>
        <div style={CODE_BLOCK}>{node.prompt ?? "(not yet set)"}</div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Input Context</p>
        <div style={CODE_BLOCK}>{node.inputContext ?? "(none)"}</div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Output</p>
        <div style={CODE_BLOCK}>{node.output ?? "(not yet produced)"}</div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Semantic Summary</p>
        <div style={CARD}>{node.semanticSummary ?? "(not yet summarized)"}</div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Evaluation</p>
        <div style={CARD}>
          {evaluation ? (
            <>
              <div>LLM passed: {String(evaluation.llmPassed)}</div>
              <div>Deterministic passed: {String(evaluation.deterministicPassed)}</div>
              <div>Passed: {String(evaluation.passed)}</div>
              <div>Drift score: {evaluation.driftScore.toFixed(2)}</div>
              <div>Baseline drift: {evaluation.baselineDriftScore.toFixed(2)}</div>
              <div>Direction: {evaluation.direction}</div>
              <div>Suggested action: {evaluation.suggestedAction}</div>
              <div>Evidence coverage: {node.evidenceCoverage ?? "none"}</div>
              <div>Confidence badge: {node.confidenceBadge ?? "low"}</div>
              <div style={{ marginTop: 8 }}>{evaluation.humanSummary}</div>
            </>
          ) : (
            "(no evaluation yet)"
          )}
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Tool Call Log</p>
        <div style={CODE_BLOCK}>
          {node.evidence?.toolCallLog.length
            ? node.evidence.toolCallLog
                .map(
                  (toolCall) =>
                    `[${toolCall.tool}] ${toolCall.completedAt ?? toolCall.startedAt}\ninput=${JSON.stringify(toolCall.input)}\noutput=${toolCall.output ?? toolCall.error ?? "(none)"}`
                )
                .join("\n\n")
            : "(no tool calls captured)"}
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>File Diffs</p>
        <div style={CODE_BLOCK}>
          {node.evidence?.fileDiffs.length
            ? node.evidence.fileDiffs
                .map(
                  (diff) =>
                    `${diff.changeType.toUpperCase()} ${diff.path}\n${diff.summary}\nbeforeChecksum=${diff.beforeChecksum ?? "(none)"}${diff.beforeTruncated ? " truncated=true" : ""}\nafterChecksum=${diff.afterChecksum ?? "(none)"}${diff.afterTruncated ? " truncated=true" : ""}`
                )
                .join("\n\n")
            : "(no file diffs captured)"}
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Command Outputs</p>
        <div style={CODE_BLOCK}>
          {node.evidence?.commandResults.length
            ? node.evidence.commandResults
                .map(
                  (result) =>
                    `${result.command} ${result.args.join(" ")}\ncwd=${result.cwd}\nexit=${result.exitCode}\ntimedOut=${String(result.timedOut)}\nstartedAt=${result.startedAt}\nfinishedAt=${result.finishedAt}\nstdout:\n${result.stdout || "(empty)"}\nstderr:\n${result.stderr || "(empty)"}`
                )
                .join("\n\n")
            : "(no commands captured)"}
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Workspace Trace</p>
        <div style={CARD}>
          <div>Changed workspace state: {String(node.workspaceStateChanged ?? false)}</div>
          <div>Checksum before: {node.evidence?.workspaceChecksumBefore ?? "(none)"}</div>
          <div>Checksum after: {node.evidence?.workspaceChecksumAfter ?? "(none)"}</div>
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Lineage</p>
        <div style={CARD}>
          <div>Node lineage: {node.lineageSummary ?? "(not yet bound)"}</div>
          <div style={{ marginTop: 8 }}>
            {node.lineageBindings?.length
              ? node.lineageBindings
                  .map((binding) => {
                    const descriptor = lineageDescriptors.find((item) => item.lineageId === binding.lineageId);
                    return descriptor
                      ? `${binding.kind}: ${descriptor.label} ${descriptor.version} (${descriptor.contentHash.slice(0, 10)})${descriptor.fallbackUsed ? " fallback" : ""}`
                      : `${binding.kind}: ${binding.lineageId}`;
                  })
                  .join("\n")
              : "(no lineage bindings yet)"}
          </div>
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Branch Metadata</p>
        <div style={CARD}>
          <div>Parent node: {node.parentNodeId ?? "(none)"}</div>
          <div>Branch: {node.branchId ?? "(mainline)"}</div>
          <div>Depends on: {node.dependsOnNodeIds.join(", ") || "(none)"}</div>
          <div>Related edges: {ancestry.relatedEdges.map((edge) => edge.kind).join(", ") || "(none)"}</div>
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Event Timeline</p>
        <div style={CODE_BLOCK}>
          {ancestry.nodeEvents.length
            ? ancestry.nodeEvents
                .map((event) => `${new Date(event.ts).toLocaleTimeString()} — ${event.kind}`)
                .join("\n")
            : "(no events yet)"}
        </div>
      </div>

      <div>
        <p style={SECTION_TITLE}>Annotations</p>
        <div style={CODE_BLOCK}>
          {node.annotations?.length
            ? node.annotations
                .map(
                  (annotation) =>
                    `${annotation.createdAt} [${annotation.kind}] ${annotation.authorLabel}${
                      annotation.actor
                        ? `\nactorId=${annotation.actor.actorId}\ndisplayName=${annotation.actor.displayName}\nrole=${annotation.actor.role}`
                        : ""
                    }\n${annotation.text}`
                )
                .join("\n\n")
            : "(no node annotations)"}
        </div>
      </div>
    </div>
  );

  return (
    <div style={PANEL}>
      <div style={{ padding: "16px", borderBottom: "1px solid #2d3748" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <span style={BADGE("#4a5568")}>{node.kind}</span>
          <span style={BADGE(node.status === "completed" ? "#38a169" : node.status === "failed" ? "#e53e3e" : "#2b6cb0")}>
            {statusCopy}
          </span>
        </div>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{node.title}</h2>
        <p style={{ fontSize: 12, color: "#a0aec0", margin: 0 }}>{node.intent}</p>
        {uiMode === "developer" ? (
          <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
            {(["summary", "developer"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  background: tab === key ? "#2d3748" : "transparent",
                  color: tab === key ? "#e2e8f0" : "#718096",
                  border: "none",
                  padding: "6px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {key === "summary" ? "Summary" : "Developer detail"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {uiMode === "developer" && tab === "developer" ? renderDeveloperMode() : renderDefaultMode()}
      </div>
    </div>
  );
}
