# OpenAgentGraph

OpenAgentGraph is an event-sourced execution graph for supervised autonomous work. Replay, reports, alerts, lineage, and operational views are all derived from append-only graph events rather than mutable graph-state tables.

## Quick Start

Agents should read `GRAPH_REPORT.md` first when it exists, then `LLMS.md` for the shortest local navigation and dogfooding guide. For fuller onboarding, read `docs/OPENAGENTGRAPH-FOR-LLMS.md` and `docs/OPENAGENTGRAPH-FUNCTIONS.md`. Agents that support repo skills can read `skills/openagentgraph/SKILL.md`; Codex users can install it by placing the whole `skills/openagentgraph` folder at `%USERPROFILE%\.codex\skills\openagentgraph`.
`GRAPH_REPORT.md` is a local generated handoff and is ignored by git; regenerate it with `npm run handoff:write` for the workspace you are actually using.

1. Copy `.env.example` to `.env` and fill in the values you actually want to use.
2. If you are running the frontend separately, copy `packages/frontend/.env.example` to `packages/frontend/.env`.
3. Install dependencies with `npm ci`.
4. Start local development with `npm run dev`.

Local startup commands:
- Backend dev: `npm run dev --workspace=packages/backend`
- Frontend dev: `npm run dev --workspace=packages/frontend`
- Backend prod-like start: `npm run start:prod`
- Frontend prod-like preview: `npm run start:frontend`
- Print deterministic handoff: `npm run handoff:print`
- Write deterministic handoff: `npm run handoff:write`
- Dogfood an external workspace (no provider key): `npm run dogfood -- --workspace "<absolute path>"`
- Handoff DB override when needed: `npm run handoff:print -- --data-dir packages/backend/data`
- Gate DB override when needed: `npm run gate:check -- --mode hard --allow-empty --data-dir packages/backend/data`
- Agent context pack: `GET /graphs/:graphId/agent-context`
- Agent-ready frontier: `GET /graphs/:graphId/frontier`

Local frontend/backend integration:
- Frontend development now talks to the backend through the Vite `/api` proxy.
- In normal local development, you can leave `VITE_OPENAGENTGRAPH_API_BASE_URL` unset.
- In split staging/production deployments, set `VITE_OPENAGENTGRAPH_API_BASE_URL` to the public backend URL, for example `https://api.example.com`.

Electron shell integration:
- The Electron shell is a thin desktop wrapper around the same frontend and backend.
- The shell package is intentionally separate so the React app stays reusable for a future VS Code webview shell.
- Shell-only capabilities stay behind a narrow renderer bridge so the React app stays reusable for a future VS Code webview shell.

VS Code shell integration:
- The VS Code extension is a separate webview shell around the same built frontend.
- The React app still talks only to the narrow `openagentgraphShell` bridge.
- VS Code-specific behavior stays in the extension host and webview bootstrap, not in the core product logic.
- `packages/vscode-extension/webview-dist/` is generated and ignored by git; regenerate it with `npm run vscode:build` before packaging or manually validating the VS Code extension.

## Environment Configuration

Required or feature-shaping variables:
- `OPENAGENTGRAPH_AI_PROVIDER`: Optional AI provider for execution, planning, summaries, and retrieval. Use `ollama`, `openai`, `gemini`, `anthropic`, or `openai-compatible`.
- `OPENAGENTGRAPH_AI_MODEL`: Optional model name. Defaults to `llama3.2`, `gpt-4o`, `gemini-3.5-flash`, or `claude-sonnet-4-6` depending on provider.
- `OPENAGENTGRAPH_AI_BASE_URL`: Optional OpenAI-compatible base URL for custom gateways or hosted compatibility endpoints. Remote HTTP is rejected; use HTTPS outside localhost.
- `OPENAGENTGRAPH_AI_API_KEY`: Optional generic provider key used before provider-specific fallbacks.
- `OPENAGENTGRAPH_AI_EMBEDDING_MODEL`: Optional embedding model. Gemini, Anthropic, and custom providers use deterministic retrieval fallback unless this is set.
- `OPENAGENTGRAPH_OLLAMA_BASE_URL`: Optional Ollama OpenAI-compatible base URL. Defaults to `http://localhost:11434/v1`.
- `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`: Optional startup key fallbacks. You can also paste runtime keys into Dashboard provider setup. Not needed for Ollama or no-key graph/handoff features.
- `NODE_ENV`: Optional. Use `production` for real deployments.
- `PORT`: Optional backend port. Defaults to `3001`.
- `DATA_DIR`: Optional SQLite storage directory. Defaults to `./data`.
- `OPENAGENTGRAPH_PUBLIC_BASE_URL`: Optional public backend URL used for diagnostics and same-origin deployment assumptions.
- `OPENAGENTGRAPH_ALLOWED_ORIGINS`: Optional comma-separated browser origins allowed by backend CORS. Use explicit origins for split frontend/backend deployments.
- `OPENAGENTGRAPH_WORKSPACE_ROOT`: Optional workspace root for execution features.
- `OPENAGENTGRAPH_LOG_LEVEL`: Optional structured log level: `debug`, `info`, `warn`, or `error`.
- `OPENAGENTGRAPH_SCAN_MAX_FILES`, `OPENAGENTGRAPH_SCAN_MAX_TOTAL_BYTES`, `OPENAGENTGRAPH_SCAN_MAX_FILE_BYTES`, `OPENAGENTGRAPH_SCAN_MAX_DEPTH`, `OPENAGENTGRAPH_SCAN_MAX_DURATION_MS`: Optional deterministic scanner emergency breakers. Defaults are `20000`, `200000000`, `5000000`, `40`, and `180000`.
- `OPENAGENTGRAPH_SEMANTIC_MAX_FILES`, `OPENAGENTGRAPH_SEMANTIC_MAX_TOTAL_BYTES`, `OPENAGENTGRAPH_SEMANTIC_MAX_FILE_BYTES`, `OPENAGENTGRAPH_SEMANTIC_MAX_DEPTH`, `OPENAGENTGRAPH_SEMANTIC_MAX_DURATION_MS`: Optional TypeScript semantic scan breakers. Defaults are `5000`, `50000000`, `5000000`, `40`, and `30000`. Legacy `OPENAGENTGRAPH_SEMANTIC_ANALYSIS_*` aliases for files, total bytes, and duration still work.
- `VITE_OPENAGENTGRAPH_API_BASE_URL`: Frontend runtime API base. Leave unset for the local `/api` proxy, or set it explicitly when the frontend is hosted separately.

Development-only auth variables:
- `OPENAGENTGRAPH_AUTH_MODE`: `dev_header` for local actor headers or `jwt` for verified bearer tokens.
- `OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS`: Development actor-header shim. Unsafe for production unless you explicitly opt in.
- `OPENAGENTGRAPH_ALLOW_UNSAFE_DEV_AUTH_IN_PRODUCTION`: Explicit production override for actor-header auth. Leave this `false` for normal deployments.
- `OPENAGENTGRAPH_ACTORS`: Optional JSON array of actor definitions.
- `OPENAGENTGRAPH_JWT_SECRET`: Required when `OPENAGENTGRAPH_AUTH_MODE=jwt`.
- `OPENAGENTGRAPH_AUTH_OPERATOR_EMAILS`, `OPENAGENTGRAPH_AUTH_REVIEWER_EMAILS`, `OPENAGENTGRAPH_AUTH_ADMIN_EMAILS`: Optional exact-email role mapping fallbacks.
- `OPENAGENTGRAPH_AUTH_OPERATOR_DOMAINS`, `OPENAGENTGRAPH_AUTH_REVIEWER_DOMAINS`, `OPENAGENTGRAPH_AUTH_ADMIN_DOMAINS`: Optional domain-based role mapping fallbacks.

Role mapping precedence for verified JWTs:
1. Valid OpenAgentGraph role claim from the token.
2. Exact email allowlists.
3. Email-domain allowlists.
4. Safe fallback to `viewer`.

## Diagnostics

- `GET /health`: Basic liveness only. It answers whether the backend process is running.
- `GET /ready`: Readiness summary for database initialization, provider configuration, workspace availability, and auth-mode safety.
- `GET /auth/session`: Safe current-session summary for the frontend and operator UI.
- `GET /metrics`: Operational metrics for scraping and monitoring. It is for runtime telemetry, not product-state truth.

Readiness statuses:
- `ok`: Core features are ready.
- `degraded`: The service is running, but optional or execution-related features are limited.
- `error`: Startup or readiness found a blocking issue.

Degraded readiness commonly means:
- AI provider is not configured, so execution and semantic summaries use fallback mode.
- Workspace root is invalid, so execution features are unavailable.
- Frontend origin policy is missing or too permissive for the chosen deployment mode.
- Production auth settings were explicitly allowed but are not ideal.
- JWT auth mode is selected but the verification secret is missing.

## Operator Notes

Startup logs now include a concise summary of:
- environment mode
- auth mode
- workspace status
- database path status
- provider status

OpenAgentGraph does not surface secrets in startup logs, readiness responses, reports, or default-mode UI.
OpenAgentGraph also does not store raw bearer tokens in events, logs, metrics, replay, or reports.

The compact Codex handoff (`GET /product-graph/handoff`, Dashboard **Generate Handoff**, and `npm run handoff:write`) is deterministic Product Graph output. It does not call OpenAI, Ollama, or any model provider.
When no `DATA_DIR` is set, the root handoff and gate scripts reuse `packages/backend/data` if its OpenAgentGraph database exists, so they match the local dashboard/dev backend by default.

External agents can coordinate using provider-neutral surfaces: `GET /graphs/:graphId/agent-context` (bounded context pack), `GET /graphs/:graphId/frontier` (ready work), plus endpoints to report progress/evidence and submit inert plan proposals. These reads do not need an AI provider key, but JWT and production deployments require viewer-or-better auth; anonymous reads are local-dev only. Mutating agent endpoints require operator/admin authority; proposals only become executable work when explicitly accepted.

The frontend runtime stays backend-authoritative:
- `/auth/session` remains the source of session truth.
- `/ready` remains the source of runtime/degraded truth.
- Frontend runtime config only decides where the browser connects; it does not decide permissions.

## License

OpenAgentGraph is licensed under AGPL-3.0-only. See `LICENSE` for the full license text.

When running OpenAgentGraph as a network service, make the corresponding source available to users as required by AGPLv3 section 13. The canonical public source repository is [yash-meghwal/OpenAgentGraph](https://github.com/yash-meghwal/OpenAgentGraph).

Renderer shell boundary:
- Browser mode uses a safe built-in shell fallback.
- Electron provides the same narrow shell contract through preload rather than exposing raw Node or Electron APIs in React.
- The current shell bridge only covers runtime API base resolution and native save-file export.
- This keeps a clean path for a future VS Code webview shell without turning the product into Electron-only code.

## Monitoring

`GET /metrics` exports safe Prometheus-style text metrics for backend/runtime monitoring.

What metrics are for:
- operational request and runtime health signals
- repeated fallback detection
- permission-denial monitoring
- readiness and degraded-mode visibility

What metrics are not for:
- graph truth
- replay truth
- reports, dashboards, or product-state derivation

Useful metrics to watch:
- `openagentgraph_http_requests_total`
- `openagentgraph_http_requests_by_route_total`
- `openagentgraph_permission_denials_total`
- `openagentgraph_run_loops_started_total`
- `openagentgraph_run_loops_completed_total`
- `openagentgraph_run_loops_paused_total`
- `openagentgraph_run_loops_stopped_total`
- `openagentgraph_provider_fallback_total`
- `openagentgraph_tool_execution_failures_total`
- `openagentgraph_active_run_loops`
- `openagentgraph_readiness_status`
- `openagentgraph_startup_degraded`

Operational hints:
- Repeated `openagentgraph_provider_fallback_total` increases usually mean missing provider config or repeated embedding/summary degradation.
- Repeated `openagentgraph_permission_denials_total` increases usually mean a role mismatch or actor-auth setup issue.
- `openagentgraph_startup_degraded 1` means startup/config validation is currently degraded or invalid.
- `openagentgraph_readiness_status{status="degraded"} 1` should agree with `GET /ready` returning `degraded`.

Endpoint differences:
- `/health` answers "is the process alive?"
- `/ready` answers "is the service ready for core features?"
- `/metrics` answers "what is the backend doing operationally over time?"

## Safe Deployment Path

The repository includes a simple backend-oriented Docker path for staging or prod-like use.

Build the image:
```bash
npm run docker:build
```

Run the container with explicit environment injection:
```bash
docker run --rm -p 3001:3001 --env-file .env openagentgraph-backend
```

Container diagnostics:
- Docker health check uses `GET /health`
- External readiness checks should use `GET /ready`

The frontend remains a separate static build:
```bash
npm run build --workspace=packages/frontend
npm run preview --workspace=packages/frontend
```

For split deployments:
- set `VITE_OPENAGENTGRAPH_API_BASE_URL` in the frontend environment
- set `OPENAGENTGRAPH_ALLOWED_ORIGINS` on the backend to the frontend origin
- optionally set `OPENAGENTGRAPH_PUBLIC_BASE_URL` so readiness/startup summaries reflect the public backend address

For same-origin or reverse-proxy deployments:
- keep the frontend pointed at the backend origin
- leave `OPENAGENTGRAPH_ALLOWED_ORIGINS` empty if the browser reaches the backend through the same origin
- keep `/health`, `/ready`, `/auth/session`, and `/metrics` reachable on the backend origin

Electron desktop path:
- `npm run electron:build` compiles the shell package alongside the existing web/backend builds.
- The current workspace includes the shell adapter boundary and Electron shell scaffolding, but launch validation on this Windows environment is still blocked by Electron's module-loader behavior at startup.
- The current Electron slice is intentionally not producing an installer package yet.

VS Code extension path:
- `npm run vscode:build` builds the frontend bundle and the VS Code extension package.
- Open this repo in VS Code and run the `OpenAgentGraph: Open Panel` command from an Extension Development Host.
- The extension loads `packages/frontend/dist` into a webview and passes a safe runtime bridge with:
  - backend API base URL
  - external-link open requests
  - text export save requests
- Configure the backend base URL with the `openagentgraph.apiBaseUrl` setting when the backend is not on `http://127.0.0.1:3001`.
- See `packages/vscode-extension/VALIDATION.md` for the lightweight manual host-validation checklist used before packaging.

## Common Recovery Steps

If readiness is degraded or startup fails:

- Invalid workspace root:
  Set `OPENAGENTGRAPH_WORKSPACE_ROOT` to a writable directory, or remove it if you do not need execution features.
- Missing provider config:
  Choose Ollama local in Dashboard provider setup for a no-key AI path, or choose OpenAI, Gemini, Anthropic, or a custom OpenAI-compatible endpoint. Without a provider, OpenAgentGraph still scans graphs and writes handoff reports in fallback mode.
- Database path/init issue:
  Check that `DATA_DIR` exists or can be created and is writable by the backend process.
- Auth mode misconfiguration:
  In production, prefer `OPENAGENTGRAPH_AUTH_MODE=jwt` with a real `OPENAGENTGRAPH_JWT_SECRET`. Disable `OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS` unless you explicitly and intentionally opt in with `OPENAGENTGRAPH_ALLOW_UNSAFE_DEV_AUTH_IN_PRODUCTION=true`.
- Backend unreachable:
  Check that the backend is running, that the browser can reach the configured API base, and that local development is using the `/api` proxy.
- Bad API base URL:
  Fix `VITE_OPENAGENTGRAPH_API_BASE_URL` or remove it for local development so the frontend can fall back to the built-in proxy.
- Bad origin config:
  Set `OPENAGENTGRAPH_ALLOWED_ORIGINS` to the real frontend origin for split deployments, or remove cross-origin settings when using a same-origin front door.
- Invalid token:
  The backend will respond with safe copy such as "Your session is not valid for this action." or "Please sign in again to continue." Provide a fresh bearer token and retry.
- Missing JWT secret:
  If `OPENAGENTGRAPH_AUTH_MODE=jwt`, set `OPENAGENTGRAPH_JWT_SECRET` or startup/readiness will report auth misconfiguration.
- Role mapping fallback to viewer:
  If a verified token does not contain a recognized OpenAgentGraph role and does not match any configured email/domain mapping, the actor safely falls back to `viewer`.

## Verification

Run the fast local release checks before shipping changes:
```bash
npm run verify
```

Run the full CI-equivalent path, including the Playwright smoke, before release tagging:
```bash
npm run verify:ci
```
