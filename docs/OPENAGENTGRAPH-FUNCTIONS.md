# OpenAgentGraph Functions Reference

This reference lists what OpenAgentGraph can do today and which surfaces expose each function.

## Local Surfaces

| Surface | Default | Purpose |
| --- | --- | --- |
| Frontend Dashboard | `http://localhost:5173` | Main operator UI |
| Backend API | `http://127.0.0.1:3001` | Graph, scan, auth, provider, readiness APIs |
| VS Code webview | `OpenAgentGraph: Open Panel` | IDE shell around the same frontend |
| Electron shell | package workspace | Desktop wrapper path |
| `GRAPH_REPORT.md` | repo/workspace root | Deterministic first-open handoff |

## Core Functions

| Function | Key UI/API/CLI | Provider needed |
| --- | --- | --- |
| Health check | `GET /health` | No |
| Readiness check | `GET /ready` | No |
| Safe session summary | `GET /auth/session` | No |
| Runtime provider setup | Dashboard Provider setup, `/provider/config` | Provider config itself |
| Project Graph scan | Dashboard Project Graph, `GET /project-graph`, scan job APIs | No |
| Product Graph projection | `GET /product-graph` | No |
| Product codebase scan | `POST /product-graph/codebase/scan`, scan job APIs | No |
| Code Map task lenses | Product Graph dashboard | No |
| Semantic TypeScript edges | Product codebase scan | No |
| Handoff preview | `GET /product-graph/handoff`, Dashboard Generate Handoff | No |
| Handoff write | `POST /product-graph/handoff/write`, `npm run handoff:write` | No |
| Product quality gate | `npm run gate:check -- --mode hard --allow-empty` | No |
| Agent context pack | `GET /graphs/:graphId/agent-context` | No |
| Agent frontier | `GET /graphs/:graphId/frontier` | No |
| External agent progress/evidence/proposals | `/graphs/:graphId/agent/*` | No for OAG, provider depends on the external agent |
| Goal/run execution | Run Graph/dashboard execution controls | Yes |
| SDK instrumentation | `@openagentgraph/sdk` | No for ingestion, yes for the observed model call |
| Optional OpenTelemetry export | env-gated backend exporter | No |

## Product Graph Functions

The Product Graph is the main code-intelligence surface.

It can show:

- product intent nodes
- task and acceptance evidence gaps
- code file nodes
- code symbol nodes
- code community nodes
- dependency edges
- semantic symbol edges
- architecture health
- dependency cycles
- external/unresolved dependencies
- scan progress and breaker diagnostics
- task scope lenses
- compact handoff sections

Use it when the task asks "what source matters for this change?"

## Project Graph Functions

The Project Graph is the broad workspace map.

It can show:

- folders
- files
- imports
- tests
- skipped generated folders
- structural scan counts
- scan progress and breaker diagnostics

Use it when the task asks "what is in this workspace?"

## Run Graph Functions

The Run Graph captures supervised agent execution.

It can show:

- graph events
- planned and executing nodes
- completed and failed nodes
- approvals and pauses
- evidence
- replay context
- runtime diagnostics

Use it when the task asks "what did the agent do, and what evidence exists?"

## External Agent Coordination Functions

OpenAgentGraph provides dedicated surfaces so external agents can coordinate through OAG without replacing the central runner.

It can show or accept:

- bounded live context packs
- current frontier nodes
- recent external-agent activity
- progress reports
- evidence summaries
- inert plan proposals
- operator/admin proposal acceptance into normal planned nodes

Use it when Codex, Gemini, Grok, local scripts, or future workers need a shared task board and evidence trail. External agent events do not complete or fail runner nodes by themselves.

## Common Commands

```powershell
npm run dev
npm run build
npm run test --workspaces --if-present
npm run vscode:build
npm run handoff:print
npm run handoff:write
npm run gate:check -- --mode hard --allow-empty
git diff --check
```

Use explicit graph data when needed:

```powershell
npm run handoff:print -- --data-dir packages/backend/data
npm run gate:check -- --mode hard --allow-empty --data-dir packages/backend/data
```

## AI Provider Modes

Provider setup is needed only for run execution, planning, embeddings, and AI summaries. Scans, Code Map, Project Graph, handoff generation, and gates remain deterministic and no-key.

Supported runtime provider modes:

- `ollama`: local/no key, default model `llama3.2`, default base URL `http://localhost:11434/v1`.
- `openai`: hosted/key required, default model `gpt-4o`.
- `gemini`: hosted/key required, default model `gemini-3.5-flash`, OpenAI-compatible base URL `https://generativelanguage.googleapis.com/v1beta/openai`.
- `anthropic`: hosted/key required, default model `claude-sonnet-4-6`, OpenAI SDK compatibility-mode base URL `https://api.anthropic.com/v1`.
- `openai-compatible`: custom endpoint, model and base URL required, API key optional.

Custom base URLs must not include credentials. Remote endpoints must use HTTPS; HTTP is accepted only for localhost and loopback URLs.

## Core API Endpoints

| Endpoint | Method | Purpose | Access |
| --- | --- | --- | --- |
| `/health` | GET | backend liveness | any |
| `/ready` | GET | readiness, provider, workspace, auth, scanner breaker status | any |
| `/auth/session` | GET | safe current actor/session summary | any |
| `/metrics` | GET | safe operational metrics | deployment/network protected surface |
| `/provider/config` | GET/POST/DELETE | runtime provider status and setup | operator/admin |
| `/project-graph` | GET | structural workspace graph | dashboard read |
| `/project-graph/scan-jobs` | POST | start Project Graph scan job | operator/admin |
| `/project-graph/scan-jobs/:jobId` | GET | scan job status | dashboard read |
| `/project-graph/scan-jobs/:jobId/events` | GET | SSE scan progress | dashboard read |
| `/product-graph` | GET | Product Graph projection | dashboard read |
| `/product-graph/codebase/scan` | POST | synchronous Product Graph scan | operator/admin |
| `/product-graph/codebase/scan-jobs` | POST | start Product Graph scan job | operator/admin |
| `/product-graph/codebase/scan-jobs/:jobId` | GET | scan job status | dashboard read |
| `/product-graph/codebase/scan-jobs/:jobId/events` | GET | SSE scan progress | dashboard read |
| `/product-graph/handoff` | GET | deterministic Markdown handoff preview | dashboard read |
| `/product-graph/handoff/write` | POST | path-safe `GRAPH_REPORT.md` write | operator/admin |
| `/graphs/:graphId/frontier` | GET | sanitized frontier plus recent agent activity and scheduling hints | local-dev anonymous; viewer+ in JWT/production |
| `/graphs/:graphId/agent-context` | GET | sanitized bounded context pack for external agents | local-dev anonymous; viewer+ in JWT/production |
| `/graphs/:graphId/agent/register` | POST | register an external agent identity | operator/admin |
| `/graphs/:graphId/agent/progress` | POST | submit external-agent progress | operator/admin |
| `/graphs/:graphId/agent/evidence` | POST | submit bounded external-agent evidence | operator/admin |
| `/graphs/:graphId/agent/plan-proposals` | POST | submit an inert proposed plan | operator/admin |
| `/graphs/:graphId/agent/plan-proposals/:proposalId/accept` | POST | accept a proposal into normal planned nodes | operator/admin |
| `/graphs/:graphId/agent/plan-proposals/:proposalId/dismiss` | POST | dismiss an inert proposal without creating runner work | operator/admin |

## Scan Breaker Variables

Lightweight scanner:

- `OPENAGENTGRAPH_SCAN_MAX_FILES`
- `OPENAGENTGRAPH_SCAN_MAX_TOTAL_BYTES`
- `OPENAGENTGRAPH_SCAN_MAX_FILE_BYTES`
- `OPENAGENTGRAPH_SCAN_MAX_DEPTH`
- `OPENAGENTGRAPH_SCAN_MAX_DURATION_MS`

Semantic TypeScript scan:

- `OPENAGENTGRAPH_SEMANTIC_MAX_FILES`
- `OPENAGENTGRAPH_SEMANTIC_MAX_TOTAL_BYTES`
- `OPENAGENTGRAPH_SEMANTIC_MAX_FILE_BYTES`
- `OPENAGENTGRAPH_SEMANTIC_MAX_DEPTH`
- `OPENAGENTGRAPH_SEMANTIC_MAX_DURATION_MS`

Treat breaker hits as diagnostics. Do not silently ignore them and do not raise limits without an operator decision.

## Auth And Roles

Local development commonly uses actor headers. Protected write actions require `operator` or `admin`.

Agent coordination permissions are split from Product Graph administration:

- `agent_read`: `viewer`, `reviewer`, `operator`, and `admin`.
- `agent_report`: `operator` and `admin`.
- `agent_propose`: `operator` and `admin`.
- `agent_admin`: `operator` and `admin` for register, accept, and dismiss actions.

PowerShell example:

```powershell
Invoke-WebRequest `
  -Uri http://127.0.0.1:3001/product-graph/handoff/write `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" }
```

Production should use JWT auth with explicit role mapping.

## Safe Defaults

- Generated, cache, dependency, build, and test-result folders are excluded from scans.
- Source bodies are not persisted into handoff reports.
- Provider keys are not stored in browser local storage, graph events, logs, metrics, or docs.
- Runtime provider config lives only in backend process memory.
- OpenTelemetry export is optional and cannot break graph event commits.
