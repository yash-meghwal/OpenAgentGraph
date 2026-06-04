# OpenAgentGraph Grand Plan: Spec Kit Brain + Native Codebase Map + Execution Memory

OpenAgentGraph is the traceability layer that connects product intent, specifications, code structure, agent runs, evidence, and CI quality gates.

## Current Architecture
- Spec Kit artifacts describe product intent and acceptance criteria.
- Native codebase scanning maps local TypeScript and JavaScript files into `code_file` and top-level `code_symbol` Product Graph nodes.
- Completed OpenAgentGraph runs link implementation evidence back to tasks and touched code.
- CI quality gates fail when Product Graph evidence, test proof, acceptance proof, or code-scan freshness is missing.

## Native Codebase Scanner
- Backend route: `POST /product-graph/codebase/scan`.
- Access: operator/admin only through existing Product Graph write permissions.
- Scope: bounded workspace traversal from server-side configuration.
- Output: file nodes, top-level exported symbol nodes, and `belongs_to` edges.
- Safety: no source body persistence, bounded file/byte/depth limits, skipped generated output, source-path metadata only.
- Staleness: scans archive stale scan-owned nodes and relationships that are no longer observed.

## Product Graph Experience
- Manager tools expose a manual Scan Codebase action.
- Product health reports missing or stale code-scan context for run-touched code.
- Codex planning prompts include a bounded `codeMapSummary` derived from the current Product Graph.
- Run linking reuses existing scanned code-file nodes when paths match.

## Quality Gate
- `code_intent_drift`: run-touched code lacks linked product intent.
- `execution_evidence_drift`: completed tasks lack linked run/evidence.
- `test_evidence_drift`: completed tasks with run evidence lack test evidence.
- `acceptance_evidence_gap`: acceptance criteria lack verification evidence.
- `code_scan_missing`: run-touched code exists before a native codebase scan.
- `code_scan_stale`: run-touched code changed after the latest codebase scan.

## Verification Expectations
- Shared/backend/frontend typechecks pass.
- Focused route, shared helper, store/API, component, and e2e tests pass.
- `npm run gate:check -- --mode hard --allow-empty` passes or reports real Product Graph gaps.
- Tracked source/docs contain only OpenAgentGraph native scan terminology.
