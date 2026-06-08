# Building External Agents on OpenAgentGraph

OpenAgentGraph includes dedicated surfaces for external agents to coordinate with runs. Codex, Gemini, Grok, scripts, CI workers, and other tools can read bounded graph context, report progress, submit evidence, and propose follow-up work without needing an AI provider key and without taking over the central runner.

These features are part of the current release. They are advisory/coordination only: proposals remain inert until an operator explicitly accepts them.

This document is for agent authors and operators who want to make another worker cooperate with OAG.

## Mental Model

External agent coordination in OpenAgentGraph is advisory by default:

- Context and frontier reads are deterministic graph projections.
- Agent progress and evidence are graph events, not runner lifecycle changes.
- Plan proposals are inert until an operator/admin accepts or dismisses them.
- Accepted proposals create normal executable graph work.
- The existing runner serialization and `activeRuns` behavior remain authoritative.

The safest pattern is:

1. Read `GRAPH_REPORT.md` when it exists.
2. Read `GET /graphs/:graphId/agent-context`.
3. Work only on the requested scope.
4. Submit progress and evidence as bounded summaries.
5. Propose next work instead of silently expanding scope.
6. Let an operator/admin decide whether to accept the proposal.

## No-Key Contract

These external agent coordination APIs do not require an AI provider key. No-key does not mean public unauthenticated network access: anonymous reads are for localhost development only. In JWT mode, and in production actor-header deployments, frontier and context reads require a valid viewer-or-better actor.

- `GET /graphs/:graphId/frontier`
- `GET /graphs/:graphId/agent-context`
- `POST /graphs/:graphId/agent/register`
- `POST /graphs/:graphId/agent/progress`
- `POST /graphs/:graphId/agent/evidence`
- `POST /graphs/:graphId/agent/plan-proposals`
- `POST /graphs/:graphId/agent/plan-proposals/:proposalId/accept`
- `POST /graphs/:graphId/agent/plan-proposals/:proposalId/dismiss`

Normal OAG auth still applies. In v1, mutating agent endpoints require operator/admin authority. `agentId` is metadata only and never grants permission.

## Context Pack

Use the context pack when an external worker starts or resumes a task:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/graphs/<graphId>/agent-context
```

Optional query parameters:

- `nodeId`: include a selected frontier node summary.
- `frontierLimit`: cap frontier nodes returned.
- `activityLimit`: cap recent agent activity returned.
- `proposalLimit`: cap open proposals returned.

The context pack intentionally contains summaries, statuses, evidence coverage, and instructions. It must not contain source bodies, API keys, `.env` contents, or private file contents.

## Frontier

Use the frontier endpoint when a worker only needs the current ready/running/blocked work:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/graphs/<graphId>/frontier
```

The frontier response includes:

- run control and frontier status
- ready/running/blocked counts
- read-only scheduling hints such as `claimableReadyCount`, `schedulingState`, and `agentAction`
- bounded frontier node summaries
- recent external agent activity
- open plan proposals

In V1.1, `deferredReadyCount` is a lifecycle-derived count of `pending` nodes. It is not a claim/lease backlog and should not be interpreted as Pro-style scheduling state.

## Register An Agent

Registration is optional but useful for activity feeds and audit trails:

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:3001/graphs/<graphId>/agent/register `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" } `
  -ContentType "application/json" `
  -Body '{"agent":{"agentId":"codex-local","displayName":"Codex","kind":"codex","capabilities":["typescript","tests"]}}'
```

Supported agent kinds are `human`, `codex`, `gemini`, `grok`, `script`, `runner`, and `unknown`.

## Report Progress

Progress is for coordination. It does not mark a runner node completed or failed:

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:3001/graphs/<graphId>/agent/progress `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" } `
  -ContentType "application/json" `
  -Body '{"agent":{"agentId":"codex-local","displayName":"Codex","kind":"codex"},"nodeId":"node-123","status":"progress","summary":"Read the route and added focused tests."}'
```

Use short summaries. Put details in evidence only when they help another agent verify the work.

## Submit Evidence

Evidence should be bounded and source-safe:

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:3001/graphs/<graphId>/agent/evidence `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" } `
  -ContentType "application/json" `
  -Body '{"agent":{"agentId":"codex-local","displayName":"Codex","kind":"codex"},"nodeId":"node-123","summary":"Focused route tests passed.","files":["packages/backend/src/routes/graphs.test.ts"],"commands":["npx vitest run packages/backend/src/routes/graphs.test.ts -t agent"],"confidence":0.9}'
```

Do not include source bodies, secrets, raw `.env` values, or long command output.

## Propose Work

Proposals let agents suggest follow-up work without silently changing the run:

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:3001/graphs/<graphId>/agent/plan-proposals `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" } `
  -ContentType "application/json" `
  -Body '{"agent":{"agentId":"gemini-review","displayName":"Gemini","kind":"gemini"},"title":"Add SDK examples","summary":"External SDK users need a minimal agent-context example.","nodes":[{"title":"Document SDK agent context usage","intent":"Add a short SDK example for reading frontier and submitting evidence.","acceptanceCriteria":["Docs include getAgentContext","Docs include submitEvidence"]}]}'
```

Proposal dependencies must point to existing graph node IDs. OAG does not create guessed dependencies.

## Accept A Proposal

Only an operator/admin should accept a proposal:

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:3001/graphs/<graphId>/agent/plan-proposals/<proposalId>/accept `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" }
```

Acceptance appends normal `node.planned` events for the proposal nodes, then appends `agent.plan_accepted`. It does not automatically start a run.

## Dismiss A Proposal

Dismiss proposals that are out of scope, already handled, or not useful for the current run:

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:3001/graphs/<graphId>/agent/plan-proposals/<proposalId>/dismiss `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" } `
  -ContentType "application/json" `
  -Body '{"reason":"Out of scope for this run."}'
```

Dismissal records `agent.plan_dismissed` and removes the proposal from open proposal lists. It does not create or alter runner work.

## SDK Usage

The `@openagentgraph/sdk` client exposes the same v1 agent methods:

```ts
import { createOpenAgentGraphClient } from "@openagentgraph/sdk";

const oag = createOpenAgentGraphClient({
  baseUrl: "http://127.0.0.1:3001",
  graphId: "graph-id",
  actorHeaders: { "x-openagentgraph-actor-id": "operator" },
});

const context = await oag.getAgentContext({ frontierLimit: 5 });
await oag.reportProgress({
  agent: { agentId: "script-worker", displayName: "Script worker", kind: "script" },
  status: "progress",
  summary: `Loaded ${context.frontier.length} frontier nodes.`,
});

await oag.acceptPlanProposal("proposal-id");
await oag.dismissPlanProposal("proposal-id", "Out of scope for this run.");
```

`wrapOpenAI()` is unchanged. SDK telemetry failures for OpenAI wrapping remain non-fatal to the user request.

## Safety Checklist

Before integrating a new worker:

- Confirm the worker reads `GRAPH_REPORT.md` first when present.
- Confirm it uses `agent-context` or `frontier` before broad source scanning.
- Confirm it never treats `agent.progress_reported` as runner completion.
- Confirm it never sends API keys, bearer tokens, `.env` contents, source bodies, or private file contents.
- Confirm it proposes out-of-scope work instead of editing it directly.
- Confirm tests cover non-2xx errors and payload bounds.

## Roadmap Boundaries

This coordination layer is external-agent advisory only. Full claims, leases, native parallel workers, and live multi-agent scheduling are future work.
