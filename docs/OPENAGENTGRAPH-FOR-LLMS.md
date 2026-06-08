# OpenAgentGraph For LLM Agents

This guide is for Codex, Gemini, Claude, local agents, and human operators who are opening OpenAgentGraph for the first time.

## First-Open Order

1. Read `GRAPH_REPORT.md` if it exists.
2. Read `LLMS.md` for local startup and graph navigation shortcuts.
3. Use Product Graph task lenses before broad source exploration.
4. Confirm important facts in the source files before editing.
5. Refresh `GRAPH_REPORT.md` after a meaningful scan or graph update.

OpenAgentGraph is navigation context. It is not a replacement for reading code.

## Mental Model

OpenAgentGraph has three main graph surfaces:

- Product Graph: product intent, tasks, code files, symbols, dependency edges, semantic edges, test/evidence gaps, and Code Map task lenses.
- Project Graph: broad workspace structure, folders, files, imports, tests, and skipped generated folders.
- Run Graph: agent runs, execution steps, approvals, evidence, replay, and diagnostics.
- External agent coordination: context packs, frontier summaries, external-agent activity, evidence submissions, and inert plan proposals.

Use the Product Graph for focused code intelligence. Use the Project Graph for rough structure. Use `GRAPH_REPORT.md` for fast first-open orientation.

## No-Key Features

These do not need any model provider:

- Dashboard loading
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
npm run handoff:write
```

Or use Dashboard -> Product Graph -> Write `GRAPH_REPORT.md`.

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
- Read `docs/OPENAGENTGRAPH-FUNCTIONS.md`.
- Read `docs/BUILDING-AGENTS-ON-OAG.md` only when building an external worker or script that will coordinate with OAG.
- If the agent supports repo skills, load `skills/openagentgraph/SKILL.md`.
- For Codex local skill discovery, install the whole `skills/openagentgraph` folder at `%USERPROFILE%\.codex\skills\openagentgraph`, then start a fresh session and use `openagentgraph`.
- If the agent does not support skills, read `skills/openagentgraph/SKILL.md` as a plain workflow.
- Run `npm run dev`.
- Confirm `http://127.0.0.1:3001/ready`.
- Open `http://localhost:5173`.
- Run a Product Graph scan.
- Generate or write `GRAPH_REPORT.md`.
