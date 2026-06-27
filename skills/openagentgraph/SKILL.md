---
name: openagentgraph
description: Use when working with OpenAgentGraph/OAG repositories, dashboards, Product Graphs, Project Graphs, Code Map scans, GRAPH_REPORT.md handoffs, task scope lenses, gate checks, provider setup, or when an agent needs to orient itself using OAG before editing code.
---

# OpenAgentGraph Skill

Use this skill to operate, inspect, or dogfood OpenAgentGraph.

## Installing This Skill

In this repository, the skill lives at `skills/openagentgraph`.

For Codex local skill discovery, install the whole folder at `%USERPROFILE%\.codex\skills\openagentgraph`, then start a fresh session and ask to use `openagentgraph`.

## First Steps

1. Read `GRAPH_REPORT.md` if it exists.
2. If `GRAPH_REPORT.md` is missing or stale, generate static artifacts first:
   `npm run graph:export -- --workspace . --offline-only --redact-root`.
3. For a bounded task pack, run:
   `npm run graph:context -- --workspace . --goal "<task>" --json`.
4. Read `llms.txt`, then `LLMS.md`.
5. Read `docs/AGENT-ACCESS-LAYER.md`, `docs/GRAPH-CONTEXT.md`, and `docs/MCP.md` when using CLI/MCP access.
6. Read `docs/OPENAGENTGRAPH-FOR-LLMS.md` for the fuller agent workflow.
7. Read `docs/OPENAGENTGRAPH-FUNCTIONS.md` when you need exact commands, endpoints, roles, or feature boundaries.
8. Use OAG as navigation context, then verify source files before editing.

## What OAG Is

OpenAgentGraph is an event-sourced graph system for supervised autonomous software work.

The practical surfaces are:

- Static graph export: `.oag/graph.json`, `.oag/graph.html`, `.oag/wiki/index.md`, and `GRAPH_REPORT.md`.
- Agent Access Layer: `graph:context`, `graph:retrieve`, `graph:query`, `graph:path`, `graph:explain`, `graph:check`, `oag:wrap`, and MCP tools.
- Product Graph: code intelligence, product intent, evidence gaps, Code Map, semantic edges, task lenses.
- Project Graph: broad workspace structure, files, folders, imports, tests, skipped generated folders.
- Run Graph: planning, execution, approvals, evidence, replay, diagnostics.
- External agent coordination: no-key context packs, frontier summaries, progress/evidence reporting, and inert plan proposals (accepted by operators).
- Handoff report: deterministic `GRAPH_REPORT.md` for first-open orientation.

## Local Startup

From the repo root:

```powershell
npm run dev
```

Open:

```text
http://localhost:5173
```

Backend defaults to:

```text
http://127.0.0.1:3001
```

Check readiness:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/ready
```

## No-Key Workflows

No AI provider is needed for:

- Static workspace exports (`graph:export --offline-only`)
- Bounded agent context packs (`graph:context`)
- Retrieval by `oag:*` id (`graph:retrieve`)
- Graph doctor/dogfood/query/path/explain/check/docs/scorecard CLIs
- MCP graph tools
- Project Graph scans
- Product Graph codebase scans
- External agent context (`/agent-context`) and frontier (`/frontier`) reads
- Code Map task lenses
- semantic TypeScript dependency edges
- architecture explorer
- handoff preview
- `GRAPH_REPORT.md` writing
- Product Graph gate checks

Use AI providers only for run execution, planning, embeddings, and AI summaries.

Supported provider modes:

- Ollama local: no key, OpenAI-compatible local endpoint.
- OpenAI: hosted key required.
- Gemini: hosted key required, OpenAI-compatible endpoint.
- Anthropic: hosted key required, OpenAI SDK compatibility mode.
- Custom OpenAI-compatible: model and base URL required, key optional.

## Scan And Handoff

For agents opening any repository, prefer the static export first:

```powershell
oag doctor --workspace .
npm run graph:export -- --workspace . --offline-only --redact-root
npm run graph:context -- --workspace . --goal "orient me" --json
```

Query intent modes:

- `--mode code` for implementation entry points
- `--mode docs` for documentation/runbook entry points
- `--mode balanced` for mixed orientation

Docs repair guidance from `graph:docs:check --suggest` is proposal-only. Do not auto-apply edits to user Markdown.

That writes `.oag/*` plus `GRAPH_REPORT.md` without a backend server, SQLite product graph DB, AI provider key, or source-body persistence.

Start a Product Graph scan:

```powershell
Invoke-WebRequest `
  -Uri http://127.0.0.1:3001/product-graph/codebase/scan `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" } `
  -ContentType "application/json" `
  -Body "{}"
```

Write the handoff report:

```powershell
npm run handoff:write
```

Print the handoff report:

```powershell
npm run handoff:print
```

Check quality gates:

```powershell
npm run gate:check -- --mode hard --allow-empty
```

## External Agent Coordination

Use these surfaces when Codex, Gemini, Grok, a script, or another worker needs to stay coordinated with a live OAG graph without taking over the central runner.

Read a context pack:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/graphs/<graphId>/agent-context
```

Read the active frontier (what work is ready):

```powershell
Invoke-RestMethod http://127.0.0.1:3001/graphs/<graphId>/frontier
```

Report progress (as operator/admin):

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:3001/graphs/<graphId>/agent/progress `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" } `
  -ContentType "application/json" `
  -Body '{"agent":{"agentId":"codex","displayName":"Codex","kind":"codex"},"status":"progress","summary":"Loaded context and scoped the next edit."}'
```

Rules:
- Progress and evidence are recorded as collaboration events.
- Plan proposals stay inert until an operator/admin accepts them.
- `agentId` is just metadata — it does not grant permissions.
- Never submit source bodies, secrets, or private content.
- For building a reusable external worker, see the coordination guidance in the main docs.

Use explicit data dir when the local dashboard is using a specific DB:

```powershell
npm run handoff:print -- --data-dir packages/backend/data
npm run gate:check -- --mode hard --allow-empty --data-dir packages/backend/data
```

## Task Lens Rules

Choose a Code Map task lens before broad exploration:

- Frontend: React, renderer, UI, browser, dashboard, webview.
- Backend/runtime: backend API, runtime, runner, DB, scanner, routes, execution lifecycle.
- Extension: VS Code extension host and webview bridge.
- Tests: unit, integration, e2e, smoke, component tests.
- Provider/AI: OpenAI, Ollama, Gemini, Anthropic, custom OpenAI-compatible endpoints, embeddings, LLM provider, SDK, MCP.
- Handoff/docs: docs, handoff builder, reports, gate, CLI guidance.
- All: cross-scope tasks only.

Runtime is source, not noise. Read runtime for backend or execution tasks. Avoid it for unrelated frontend tasks by using lenses.

## Breaker Rules

If scan breakers hit:

1. Inspect diagnostics.
2. Confirm generated/build/cache/dependency output is excluded.
3. Prefer narrower workspace or task scope.
4. Ask before raising breaker limits.

Do not raise limits blindly.

## Verification Rules

Before saying OAG works after code changes, run the checks that match the change:

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

For docs-only changes, `git diff --check` is the minimum hygiene check.

## Safety Rules

- Never commit secrets.
- Never paste real API keys into docs, tests, screenshots, or chat logs.
- Treat `GRAPH_REPORT.md` as navigation context, not source truth.
- Confirm facts in source files before editing.
- Do not hide real source directories globally just because they are large.
- Do not delete user changes or dirty worktree files unless explicitly asked.
