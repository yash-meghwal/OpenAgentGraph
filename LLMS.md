# OpenAgentGraph Guide For LLM Agents

Read this first when Codex, Gemini, or another coding agent opens this repository.

Start with [`llms.txt`](llms.txt) for the compact agent orientation contract, then this file for workflow detail.

If `GRAPH_REPORT.md` exists in the repo root, read it before broad codebase exploration. It is the deterministic OpenAgentGraph handoff report for fast first-open orientation.
`GRAPH_REPORT.md` is generated per workspace and ignored by git. On a fresh clone, generate static artifacts with `npm run graph:export -- --workspace . --offline-only --redact-root`; use `npm run handoff:write` only when you specifically need the Product Graph DB-backed handoff.

## Canonical Agent Docs

- `GRAPH_REPORT.md`: compact generated orientation for the current workspace.
- `llms.txt`: compact model-facing orientation contract.
- `docs/AGENT-ACCESS-LAYER.md`: CLI/MCP/context access overview.
- `docs/GRAPH-CONTEXT.md`: bounded `graph:context` pack contract.
- `docs/MCP.md`: stdio MCP server setup and tool list.
- `docs/OPENAGENTGRAPH-FOR-LLMS.md`: first-time agent workflow and adoption checklist.
- `docs/OPENAGENTGRAPH-FUNCTIONS.md`: functions, endpoints, commands, roles, and provider boundaries.
- `skills/openagentgraph/SKILL.md`: repo-distributed Codex skill for agents that support skills.

## What This Project Is

OpenAgentGraph is an event-sourced execution and product graph for supervised autonomous software work.

The important local surfaces are:
- Backend API: `http://127.0.0.1:3001`
- Frontend app: `http://localhost:5173`
- Product Graph / Code Map: deterministic codebase scanner, file and symbol graph, dependency edges, architecture health, and explorer views
- Run graph: event-sourced agent planning, execution, evidence, approvals, replay, and diagnostics
- External agent coordination: no-provider-key context packs (`/agent-context`), frontier summaries (`/frontier`), progress/evidence reporting, and inert plan proposals that operators can accept

## Start The App

From the repo root:

```powershell
cd <repo-root>
npm run dev
```

Then open:

```text
http://localhost:5173
```

The frontend proxies `/api` requests to the backend on port `3001`.

## Scan The Current Repository

Open the app, use an `operator` or `admin` actor, then run **Scan Codebase** in the Product Graph / Code Map view.

You can also trigger it from PowerShell:

```powershell
Invoke-WebRequest `
  -Uri http://127.0.0.1:3001/product-graph/codebase/scan `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" } `
  -ContentType "application/json" `
  -Body "{}"
```

Then inspect the graph:

```powershell
$g = Invoke-RestMethod http://127.0.0.1:3001/product-graph
$g.summary | ConvertTo-Json -Depth 6
```

## Dogfood An External Workspace

No model provider or API key is required. This scans the target workspace, stores graph data under `.tmp-dogfood-data/<workspace-hash>` inside the OpenAgentGraph repo, and writes `GRAPH_REPORT.md` into the target workspace root.

```powershell
npm run dogfood -- --workspace "C:\path with spaces\your-project"
```

From the published npm CLI:

```powershell
oag doctor --workspace "C:\path with spaces\your-project"
oag dogfood --workspace "C:\path with spaces\your-project"
```

Read `GRAPH_REPORT.md` first. Trust indexed areas, but inspect source directly when support tiers or analyzer warnings say a language is structural-only, semantic-lite, unavailable, or partial.

## Query And Path Modes

- `graph:query --mode code` ranks code symbols/files first.
- `graph:query --mode docs` ranks documentation surfaces first.
- `graph:query --mode balanced` keeps the default mixed intent ranking.
- `graph:path --mode balanced|semantic|structural` changes how routes are scored; release path floors are measured on the pinned fixture suite only.
- `graph:docs:check --suggest` reports safe repair proposals but never edits user-authored Markdown.

## Generate The Compact Handoff

No model provider or API key is required for the handoff report.

For the current workspace without needing the backend server or Product Graph DB:

```powershell
npm run graph:export -- --workspace . --offline-only --redact-root
npm run graph:context -- --workspace . --goal "orient me" --json
```

From the Dashboard Product Graph view, use:
- **Generate Handoff** to preview the deterministic Markdown.
- **Write GRAPH_REPORT.md** to save the report in the configured workspace root.

From PowerShell:

```powershell
npm run handoff:print
npm run handoff:write
```

If a separate database directory is in use, pass it explicitly:

```powershell
npm run handoff:print -- --data-dir packages/backend/data
```

The Product Graph quality gate uses the same default database selection. If a separate database directory is in use, pass it explicitly:

```powershell
npm run gate:check -- --mode hard --allow-empty --data-dir packages/backend/data
```

Backend API:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/product-graph/handoff
Invoke-WebRequest `
  -Uri http://127.0.0.1:3001/product-graph/handoff/write `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" }
```

## Scan Another Project

Stop the dev server, then restart with a workspace root:

```powershell
$env:OPENAGENTGRAPH_WORKSPACE_ROOT="C:\Path\To\Other\Project"
$env:DATA_DIR="C:\Users\yashm\Desktop\openagentgraph-dogfood-data"
npm run dev
```

Run **Scan Codebase** again. `DATA_DIR` keeps dogfood graph data separate from normal local data.

## Use OAG As A Navigation Aid

Prefer the Product Graph when broad codebase navigation is needed:

```powershell
$g = Invoke-RestMethod http://127.0.0.1:3001/product-graph
$g.nodes | Group-Object kind | Sort-Object Count -Descending
$g.edges | Group-Object kind | Sort-Object Count -Descending
```

Find a file:

```powershell
$file = $g.nodes | Where-Object {
  $_.kind -eq "code_file" -and $_.title -like "*ProductGraphView.tsx"
} | Select-Object -First 1
$file | ConvertTo-Json -Depth 6
```

Find dependencies from that file:

```powershell
$g.edges |
  Where-Object { $_.kind -eq "depends_on" -and $_.sourceNodeId -eq $file.id } |
  ForEach-Object {
    $edge = $_
    $target = $g.nodes | Where-Object { $_.id -eq $edge.targetNodeId } | Select-Object -First 1
    [pscustomobject]@{
      target = $target.title
      relation = $edge.metadata.scannerRelation
      resolution = $edge.metadata.scannerResolution
    }
  }
```

Find symbols in that file:

```powershell
$g.edges |
  Where-Object {
    $_.kind -eq "belongs_to" -and
    $_.targetNodeId -eq $file.id -and
    $_.metadata.scannerRelation -eq "source_file"
  } |
  ForEach-Object {
    $edge = $_
    $g.nodes | Where-Object { $_.id -eq $edge.sourceNodeId } | Select-Object -First 1
  } |
  Select-Object title,kind,metadata
```

Use this graph as a map, then confirm important facts in source files before editing.

## External Agent Coordination

External agents (Codex, Gemini, Grok, custom scripts, CI workers, etc.) can coordinate with OAG runs using dedicated no-provider-key surfaces for context and proposals. These let agents stay in sync with the live Run Graph and Product Graph without needing an AI provider key for reads. No-provider-key does not mean public unauthenticated access: anonymous reads are for localhost development only; JWT or production deployments require a valid viewer-or-better actor.

Read a bounded live context pack (recommended starting point for an external agent):

```powershell
Invoke-RestMethod http://127.0.0.1:3001/graphs/<graphId>/agent-context
```

Read the current run frontier (ready work + status):

```powershell
Invoke-RestMethod http://127.0.0.1:3001/graphs/<graphId>/frontier
```

Submit progress or evidence (requires operator/admin actor):

```powershell
Invoke-WebRequest `
  -Uri http://127.0.0.1:3001/graphs/<graphId>/agent/progress `
  -Method Post `
  -Headers @{ "x-openagentgraph-actor-id" = "operator" } `
  -ContentType "application/json" `
  -Body '{"agent":{"agentId":"codex","displayName":"Codex","kind":"codex"},"status":"progress","summary":"Reviewed the current frontier."}'
```

Rules for external agents:
- Context packs and frontier are deterministic projections.
- Progress and evidence submissions are recorded as graph events.
- Plan proposals are inert until an operator or admin explicitly accepts them (accepted proposals become normal executable nodes).
- Never include source bodies, secrets, or private content in submissions.
- Always cross-check important facts in source files. OAG surfaces are navigation aids.
- For repositories with Markdown docs, run `graph:docs:check` on the target workspace or read the broken-link section in `GRAPH_REPORT.md` before trusting doc paths. This repository includes intentionally broken-link fixtures, so use `npm run verify:graph` for release proof here.

### Graph Navigation Rules For Agents

- Read `GRAPH_REPORT.md` first when it exists; it is the compact deterministic handoff.
- Use Product Graph / Code Map for semantic work: source files, symbols, dependency edges, semantic relationships, architecture health, and code communities.
- Use Code Map task lenses before broad exploration. Pick the task area first: Frontend, Backend/runtime, Extension, Tests, Provider/AI, or Handoff/docs.
- Use Project Graph for broad workspace structure: folders, file groups, imports, and tests.
- Scope graph queries to the task area before editing. Start from recommended reads, nearby dependencies, and task-linked code nodes rather than scanning the whole graph manually.
- Treat `runtime`, runner, provider, DB, and app lifecycle modules as backend/runtime source. They are not generated noise; inspect them when the task concerns execution or backend behavior.
- Ignore generated, cache, dependency, build, and test-result output unless the task explicitly concerns those artifacts.
- Verify source files before editing. OAG is navigation context, not a substitute for reading code.
- Do not raise scanner breakers blindly. If a breaker hits, first inspect skipped folders/files and narrow generated output; only recommend higher limits when the operator approves.

### Scanner Breakers And Progress

OpenAgentGraph scans broadly by default, but the backend enforces emergency breakers to protect the machine from pathological repositories. The Dashboard shows phase, files/sec, MB/sec, skipped generated folders, and breaker status during scans.

Default lightweight scan breakers:
- `OPENAGENTGRAPH_SCAN_MAX_FILES=20000`
- `OPENAGENTGRAPH_SCAN_MAX_TOTAL_BYTES=200000000`
- `OPENAGENTGRAPH_SCAN_MAX_FILE_BYTES=5000000`
- `OPENAGENTGRAPH_SCAN_MAX_DEPTH=40`
- `OPENAGENTGRAPH_SCAN_MAX_DURATION_MS=180000`

Default semantic scan breakers:
- `OPENAGENTGRAPH_SEMANTIC_MAX_FILES=5000`
- `OPENAGENTGRAPH_SEMANTIC_MAX_TOTAL_BYTES=50000000`
- `OPENAGENTGRAPH_SEMANTIC_MAX_FILE_BYTES=5000000`
- `OPENAGENTGRAPH_SEMANTIC_MAX_DEPTH=40`
- `OPENAGENTGRAPH_SEMANTIC_MAX_DURATION_MS=30000`

`OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_FILES`, `OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_TOTAL_BYTES`, and `OPENAGENTGRAPH_SEMANTIC_ANALYSIS_MAX_DURATION_MS` remain supported legacy aliases.

## AI Provider Rules

No key is needed for:
- Codebase scanning
- Code Map file/symbol/dependency graph
- Architecture explorer
- Product Graph inspection
- Codex handoff generation and `GRAPH_REPORT.md` writing

An AI provider is needed for run execution, planning, embeddings, and summaries.

Preferred local setup:
- Use **Dashboard -> Provider setup**.
- Choose `Ollama local - no API key` with model `llama3.2` and base URL `http://localhost:11434/v1`, or choose OpenAI, Gemini, Anthropic, or a custom OpenAI-compatible endpoint.
- Dashboard provider config is sent to the backend and kept only in backend process memory.
- Provider keys are not stored in browser local storage, graph events, logs, metrics, or docs.
- Restarting the backend clears Dashboard runtime provider config.

Before choosing Ollama in the Dashboard, confirm it is running:

```powershell
ollama list
Invoke-RestMethod http://localhost:11434/v1/models
```

Ollama environment setup:

```powershell
$env:OPENAGENTGRAPH_AI_PROVIDER="ollama"
$env:OPENAGENTGRAPH_AI_MODEL="llama3.2"
$env:OPENAGENTGRAPH_OLLAMA_BASE_URL="http://localhost:11434/v1"
npm run dev
```

OpenAI environment setup:

```powershell
$env:OPENAGENTGRAPH_AI_PROVIDER="openai"
$env:OPENAI_API_KEY="sk-your-key"
npm run dev
```

Gemini environment setup:

```powershell
$env:OPENAGENTGRAPH_AI_PROVIDER="gemini"
$env:GEMINI_API_KEY="your-gemini-key"
$env:OPENAGENTGRAPH_AI_MODEL="gemini-3.5-flash"
npm run dev
```

Anthropic environment setup:

```powershell
$env:OPENAGENTGRAPH_AI_PROVIDER="anthropic"
$env:ANTHROPIC_API_KEY="your-anthropic-key"
$env:OPENAGENTGRAPH_AI_MODEL="claude-sonnet-4-6"
npm run dev
```

Custom OpenAI-compatible environment setup:

```powershell
$env:OPENAGENTGRAPH_AI_PROVIDER="openai-compatible"
$env:OPENAGENTGRAPH_AI_MODEL="your-model-name"
$env:OPENAGENTGRAPH_AI_BASE_URL="https://gateway.example.com/v1"
$env:OPENAGENTGRAPH_AI_API_KEY="optional-provider-key"
npm run dev
```

Gemini and Anthropic are supported through their documented OpenAI-compatible paths. Anthropic support is compatibility-mode support, not full native Claude API feature coverage.

Do not commit secrets. Do not paste real keys into tests, docs, git history, screenshots, or chat logs.

## Useful Checks

```powershell
npm run test --workspaces --if-present
npm run build
npm run vscode:build
npm run gate:check -- --mode hard --allow-empty
git diff --check
```

## Current Practical Limits

- TypeScript semantic analysis may fall back if setup exceeds its time budget.
- The deterministic scanner still provides file, symbol, community, and dependency graph data without OpenAI.
- The 3D graph vendor chunk is intentionally isolated behind lazy graph views and budgeted in Vite config.
