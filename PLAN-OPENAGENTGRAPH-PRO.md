# OpenAgentGraph Pro Agent Collaboration Layer

## Summary

OpenAgentGraph Pro is the advanced-agent edition built on top of the stable OpenAgentGraph V1 baseline. It should stay deterministic and provider-neutral for graph navigation, while adding collaboration surfaces for external workers such as Codex, Gemini, Grok, scripts, and future native agents.

The first implementation milestone is Agent Context + External Worker v1. External agents can read a bounded context pack, report progress, submit evidence, and propose next work without needing an AI provider key and without taking over the central runner.

The immediate goal is to make OpenAgentGraph Pro a shared coordination hub before adding heavier native scheduling features like claims, leases, heartbeats, and multi-agent execution.

## Baseline

- Start from OpenAgentGraph V1 commit `c7121b7 fix: stabilize CI smoke and switch to AGPL`.
- Keep V1 lightweight features intact: deterministic code scan, Product Graph, Project Graph, Code Map, task scope lenses, provider-neutral setup, handoff generation, quality gate, and AGPLv3 licensing.
- Do not make Pro changes in the V1 publish folder.

## Key Changes

### Shared Agent Collaboration Types

Add shared types:

- `OpenAgentGraphAgentIdentity`
- `AgentContextPack`
- `GraphFrontierNodeSummary`
- `AgentProgressSubmission`
- `AgentEvidenceSubmission`
- `AgentPlanProposal`

### Additive Graph Events

Add new event kinds:

- `agent.registered`
- `agent.progress_reported`
- `agent.evidence_submitted`
- `agent.plan_proposed`
- `agent.plan_accepted`

These events must not automatically mark runner nodes completed or failed.

### Backend Agent APIs

Add:

- `GET /graphs/:graphId/frontier`
- `GET /graphs/:graphId/agent-context`
- `POST /graphs/:graphId/agent/register`
- `POST /graphs/:graphId/agent/progress`
- `POST /graphs/:graphId/agent/evidence`
- `POST /graphs/:graphId/agent/plan-proposals`
- `POST /graphs/:graphId/agent/plan-proposals/:proposalId/accept`

Keep existing runner behavior unchanged:

- `activeRuns` serialization remains in place.
- External agents can advise, report, and propose.
- Only accepted proposals create executable graph work.

### SDK

Add SDK methods:

- `getFrontier()`
- `getAgentContext()`
- `registerAgent()`
- `reportProgress()`
- `submitEvidence()`
- `proposePlan()`

Keep `wrapOpenAI()` behavior unchanged.

### Frontend Pro Surfaces

Add:

- Dashboard card for agent-ready work.
- Recent external agent activity feed.
- Product Graph / Current Run panel for context-pack preview and copy.
- Operator/admin controls to accept or dismiss proposed plan items.

### Documentation

Update:

- `LLMS.md` with Pro agent-use rules.
- Add `docs/BUILDING-AGENTS-ON-OAG.md`.
- Add or update an OAG skill doc showing how Codex, Gemini, and Grok should read context, scope work, submit evidence, and propose next steps.
- Update generated `GRAPH_REPORT.md` behavior to mention the agent context API when available.

## Safety And Permissions

- Graph scans, handoff generation, context packs, and frontier reads remain no-key and deterministic.
- Read endpoints follow existing graph read permissions.
- Mutating agent endpoints require operator/admin authority in v1.
- `agentId` is metadata only and never grants permission.
- Payloads are bounded with validation.
- No API keys, source bodies, `.env` contents, or private file contents may be returned in context packs, events, reports, logs, or frontend UI.
- Plan proposals are inert until accepted by an operator/admin.

## Pro Roadmap

### Phase 0: Agent Context + External Worker v1

External agents can orient themselves, report progress, submit evidence, and propose work.

### Phase 1: Claims, Leases, And Heartbeats

Add `node.claimed`, `node.claim_heartbeat`, and `node.claim_released` events with TTL handling.

### Phase 2: Native Multi-Agent Execution

Allow controlled parallel workers once claims and safety are proven.

### Phase 3: Agent Marketplace / Skill Registry

Register agent capabilities and route work by task scope.

### Phase 4: Advanced Coordination UI

Add live agent lanes, workload heatmaps, conflict detection, and cross-agent replay.

## Test Plan

### Shared Tests

- Agent event types project correctly.
- Agent events do not alter node lifecycle status unless a proposal is accepted.
- Context packs exclude source bodies and secrets.

### Backend Tests

- Frontier/context routes work without provider configuration.
- Agent mutation routes reject viewer and unauthenticated actors.
- Payload bounds reject oversized evidence, metadata, and proposal content.
- Proposal acceptance appends executable graph work only for operator/admin.

### SDK Tests

- New client methods send correct bounded payloads.
- Non-2xx responses throw clear errors for explicit agent methods.
- Existing OpenAI/Ollama/Gemini/Anthropic wrapping behavior remains unchanged.

### Frontend Tests

- Agent-ready work panel renders empty, populated, and error states.
- Agent activity feed does not expose secrets or source bodies.
- Proposal accept/dismiss controls are role-gated.

## Verification

Run and fix until green:

```powershell
npx tsc --noEmit --pretty false -p packages/shared/tsconfig.json
npx tsc --noEmit --pretty false -p packages/backend/tsconfig.json
npx tsc --noEmit --pretty false -p packages/frontend/tsconfig.json
npm run test --workspaces --if-present
npm run build
npm run vscode:build
npm run gate:check -- --mode hard --allow-empty
git diff --check
```

## Assumptions

- Pro starts with external-agent coordination, not native parallel execution.
- No database migration is required if current event storage accepts new JSON event kinds.
- Existing Product Graph, Project Graph, Code Map, task lenses, handoff, and provider-neutral setup remain intact.
- AI provider keys are only for optional AI execution, not graph navigation or agent context.
- OpenAgentGraph V1 remains the lightweight public baseline.
