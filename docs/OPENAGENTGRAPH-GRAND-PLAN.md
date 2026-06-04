# OpenAgentGraph Grand Plan

OpenAgentGraph connects product intent, specifications, code structure, execution runs, and verification evidence into one Product Graph.

## Core Layers
- Product intent: ideas, features, stories, requirements, acceptance criteria, tasks, and decisions.
- Spec Kit import: local specification files and contracts become Product Graph context.
- Native codebase scan: local TypeScript and JavaScript files become code map nodes without external artifacts.
- Execution memory: completed OpenAgentGraph runs link implementation evidence to tasks and touched code.
- CI quality gate: Product Graph drift checks enforce traceability quality.

## Native Codebase Scan
- Route: `POST /product-graph/codebase/scan`.
- Trigger: manual Scan Codebase action in Product Graph manager tools.
- Nodes: `code_file` and top-level `code_symbol`.
- Edges: `belongs_to` from symbols to files.
- Metadata: scanner version, scan id, scan timestamp, source path, line, symbol kind/name, file size, and content hash.
- Safety: no source bodies persisted; traversal is bounded by file count, file size, total bytes, and depth.
- Stale handling: scan-owned nodes and edges absent from the latest scan are archived.

## Codex Planning
Codex planning prompts include:
- Current task and status.
- Linked product intent and acceptance criteria.
- Likely code areas.
- Native code-scan summary.
- Risks and blockers.
- Verification commands.
- Required handoff fields.

## CI Gate
The gate reports hard gaps for:
- Missing product intent for run-touched code.
- Missing execution evidence.
- Missing test evidence.
- Missing acceptance evidence.
- Missing native codebase scan.
- Stale native codebase scan.

Empty Product Graph data can pass with `--allow-empty` so fresh CI environments can bootstrap without hiding real gaps once data exists.
