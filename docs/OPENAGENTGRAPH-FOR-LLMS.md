# OpenAgentGraph For LLM Agents

This guide is for Codex, Gemini, Claude, local agents, and human operators who are opening OpenAgentGraph for the first time.

## First-Open Order

1. Read `GRAPH_REPORT.md` if it exists.
2. Read `llms.txt`, then `LLMS.md`.
3. If the graph artifacts are missing or stale, run `npm run graph:export -- --workspace . --offline-only --redact-root`.
4. Run `npm run graph:context -- --workspace . --goal "<task>" --json` for a bounded task pack.
5. Use `graph:query`, `graph:path`, `graph:explain`, and `graph:retrieve` before broad manual exploration.
6. Confirm important facts in the source files before editing.
7. Refresh `GRAPH_REPORT.md` after a meaningful scan or graph update.

OpenAgentGraph is navigation context. It is not a replacement for reading code.

## Mental Model

OpenAgentGraph has three main graph surfaces:

- Product Graph: product intent, tasks, code files, symbols, dependency edges, semantic edges, test/evidence gaps, and Code Map task lenses.
- Project Graph: broad workspace structure, folders, files, imports, tests, and skipped generated folders.
- Run Graph: agent runs, execution steps, approvals, evidence, replay, and diagnostics.
- External agent coordination: context packs, frontier summaries, external-agent activity, evidence submissions, and inert plan proposals.
- Agent Access Layer: static exports, bounded context packs, retrieval IDs, MCP tools, and copyable wrapper instructions.

Use static exports and `graph:context` for the first pass in any repository. Use the Product Graph for focused app/runtime code intelligence. Use the Project Graph for rough structure. Use `GRAPH_REPORT.md` for fast first-open orientation.

## No-Key Features

These do not need any model provider:

- Dashboard loading
- Static workspace export (`graph:export --offline-only`)
- Bounded context packs (`graph:context`)
- Retrieval by `oag:*` id (`graph:retrieve`)
- Query/path/explain/check/scorecard CLIs
- MCP graph tools
- Project Graph scan
- Product Graph codebase scan
- Code Map file, symbol, dependency, semantic, and community views
- Code Map task lenses
- Architecture explorer
- Scan progress and breaker diagnostics
- Deterministic handoff preview
- `GRAPH_REPORT.md` writing
- External agent context (`/agent-context`) and frontier (`/frontier`) reads
- External-agent progress, evidence, and plan proposals
- Product Graph quality gate

AI provider features are separate. Planning, run execution, embeddings, and AI summaries need a configured provider such as Ollama, OpenAI, Gemini, Anthropic, or a custom OpenAI-compatible endpoint.

No-key graph access means no AI provider key. It does not mean public unauthenticated network access: anonymous `agent-context` and `frontier` reads are for localhost development only. JWT or production deployments require a viewer-or-better actor, and returned text is sanitized for secrets and absolute paths before it is safe to put into model context.

## Task Scope Lenses

Use the lens that matches the task before reading widely:

- Frontend: React, renderer, UI, browser, dashboard, webview source.
- Backend/runtime: backend API, runtime, runner, database, scanner, routes, provider lifecycle, execution paths.
- Extension: VS Code extension host, webview bridge, extension packaging.
- Tests: unit, integration, e2e, smoke, and component tests.
- Provider/AI: OpenAI, Ollama, Gemini, Anthropic, custom OpenAI-compatible endpoints, embeddings, LLM provider, SDK, MCP, AI integration.
- Handoff/docs: docs, handoff builder, `GRAPH_REPORT.md`, `LLMS.md`, gate and CLI guidance.
- All: full Code Map when the task genuinely crosses scopes.

Runtime is real source. Do not call it noise. Inspect it for backend, provider, execution, and lifecycle work.

## Common Agent Workflows

### Orient from a folder only

1. Run:

```powershell
npm run graph:export -- --workspace . --offline-only --redact-root
npm run graph:context -- --workspace . --goal "orient me" --json
```

2. Read `GRAPH_REPORT.md`, `.oag/wiki/index.md`, and `.oag/graph.html`.
3. Use retrieval IDs from the context pack with `npm run graph:retrieve -- --workspace . --id "oag:node:<id>" --json`.
4. Inspect source files before editing.

### Coordinate with external agents

1. Read `GRAPH_REPORT.md`.
2. Fetch `GET /graphs/<graphId>/agent-context`.
3. Use frontier nodes and their `schedulingState` / `agentAction` hints to scope work.
4. Submit progress/evidence as bounded summaries.
5. Propose follow-up work instead of silently expanding scope.

Plan proposals are advisory until an operator/admin accepts or dismisses them. Agent progress and evidence do not complete or fail runner nodes.

### Understand the repo quickly

1. Read `GRAPH_REPORT.md`.
2. Open the Product Graph Code Map.
3. Choose the task lens that matches the request.
4. Start from "Read These First" and the task scope guide.
5. Read source files before editing.

### Scan current workspace

Use the Dashboard Product Graph controls or run:

```powershell
Invoke-WebRequest `
  -Uri http://127.0.0.1:3001/product-graph/codebase/scan `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" } `
  -ContentType "application/json" `
  -Body "{}"
```

### Write a fresh handoff

```powershell
npm run graph:export -- --workspace . --offline-only --redact-root
npm run handoff:write
```

Use `graph:export` for a static kernel-only handoff. Use Dashboard -> Product Graph -> Write `GRAPH_REPORT.md` or `npm run handoff:write` when you specifically need the Product Graph DB-backed handoff.

### Check quality gates

```powershell
npm run gate:check -- --mode hard --allow-empty
```

Use `--data-dir packages/backend/data` when you intentionally want a specific local graph DB.

## Breaker Rules

OpenAgentGraph scans broadly by default, but emergency breakers protect the machine from huge generated output, recursive layouts, giant files, and expensive semantic setup.

Agents may recommend narrower scopes or higher limits, but should not raise breakers blindly. If a breaker hits:

1. Inspect skipped folders/files and diagnostics.
2. Confirm generated output is excluded.
3. Prefer a narrower workspace or task lens.
4. Ask the operator before increasing limits.

## Provider Rules

No provider is needed for scanning and handoff. If a run needs AI:

- Use Ollama for no-key local execution.
- Use OpenAI, Gemini, or Anthropic when hosted model quality is required.
- Use a custom OpenAI-compatible endpoint for gateways, proxies, or compatible local servers.
- Treat Anthropic support as OpenAI SDK compatibility-mode support in v1, not full native Claude API feature coverage.
- Never commit, log, or document real keys.
- Dashboard runtime provider config is process-memory only and is cleared by backend restart.

## Adoption Checklist

For a new agent or teammate:

- Read `GRAPH_REPORT.md`.
- Read `LLMS.md`.
- Read `docs/AGENT-ACCESS-LAYER.md`, `docs/GRAPH-CONTEXT.md`, and `docs/MCP.md` for the 1.4 agent access surfaces.
- Read `docs/OPENAGENTGRAPH-FUNCTIONS.md`.
- Read `docs/BUILDING-AGENTS-ON-OAG.md` only when building an external worker or script that will coordinate with OAG.
- If the agent supports repo skills, load `skills/openagentgraph/SKILL.md`.
- For Codex local skill discovery, install the whole `skills/openagentgraph` folder at `%USERPROFILE%\.codex\skills\openagentgraph`, then start a fresh session and use `openagentgraph`.
- If the agent does not support skills, read `skills/openagentgraph/SKILL.md` as a plain workflow.
- Run `npm run graph:export -- --workspace . --offline-only --redact-root`.
- Run `npm run graph:context -- --workspace . --goal "orient me" --json`.
- Start the app with `npm run dev` only when you need the dashboard or live Run/Product Graph APIs.
