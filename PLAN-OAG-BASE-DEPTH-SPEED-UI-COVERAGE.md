# OpenAgentGraph Base Depth + Speed + UI + Coverage Plan

Target repo:
`C:\Users\yashm\Desktop\promptvector`

Hard boundary:
Do not read, edit, copy from, commit, or push anything under:

- `C:\Users\yashm\Desktop\OpenAgentGraphPro`
- `C:\Users\yashm\Desktop\OpenAgentGraphPro-*`
- Any Pro/export/scratch folder

Role split:

- Grok implements locally only.
- Grok must not commit, push, tag, publish, or touch GitHub.
- Codex reviews, verifies, commits, and pushes after independent review.

Goal:
Finish the next four base gaps after Phase 7:

1. `graph:update` incremental scan
2. Deeper semantic analysis outside TS/JS, starting with C# Roslyn
3. Dashboard lens/fusion UI
4. Long-tail ecosystem coverage, one language at a time

## Phase 8 - graph:update Incremental Scan

Objective:
Add fast daily-use updates so users do not need a full graph scan/export every time.

Required work:

- Add root script: `npm run graph:update`.
- Add backend CLI: `packages/backend/src/cli/graphUpdate.ts`.
- Load existing `<workspace>/.oag/graph.json`.
- Detect changed, added, and deleted files using mtime, size, content hash, and scanner metadata.
- Re-scan only changed files and affected dependency neighborhoods when safe.
- Fall back to full scan when scanner version, ignore rules, workspace profile, or graph schema changed.
- Preserve deterministic output and do not persist source bodies.
- Update `.oag/graph.json`, `.oag/wiki/index.md`, and optionally `GRAPH_REPORT.md` only when requested.
- Add `--refresh` to force full scan, `--dry-run`, `--json`, and `--report`.

Acceptance:

- Small edits update graph substantially faster than full export.
- Deleted files are archived/removed from graph output.
- Changed dependency edges are refreshed.
- Unsafe incremental cases fall back clearly with diagnostics.

Tests:

- Add fixture tests for add/edit/delete.
- Add stale cache/schema fallback test.
- Add ignored generated file change test.
- Run `npm run verify:graph` and `npm run verify:ci`.

## Phase 9 - C# Roslyn Semantic Edges

Objective:
Make C#/.NET competitive for real dependency-aware navigation.

Required work:

- Keep current TypeScript structural scanner as fallback.
- Add optional Roslyn helper, likely out-of-process, under backend scanner tooling.
- It must be optional: if `dotnet`/Roslyn is unavailable, T0 structural scan still succeeds with a warning.
- Resolve solution/project references, namespaces, using aliases, type declarations, inheritance, interface implementation, method calls, property references, constructor calls, and test-to-SUT relationships.
- Emit semantic edges only when both endpoints are known graph nodes.
- No dangling guessed edges.
- Bound helper runtime, files, bytes, and output size.
- Never return or persist source bodies.
- Add clear scanner registry status:
  - C# structural: available
  - C# semantic: enabled / unavailable / failed with reason

Acceptance:

- C# fixture gets real semantic `uses`, `calls`, `extends`, `implements`, `tests` edges.
- WPF View to ViewModel and code-behind edges remain.
- External framework types do not create dangling nodes.
- Failure to start Roslyn does not fail the scan.

Tests:

- C# semantic fixture with project references and method calls.
- Invalid solution fallback test.
- No dangling semantic edge test.
- Runtime/output bound test.

## Phase 10 - Dashboard Lens + Fusion UI

Objective:
Surface existing shared `graphLenses`, `graphFusion`, and code context in the browser dashboard.

Required work:

- Add frontend API/store types for unified graph release gates, fusion checks, lenses, and code context.
- Product Graph/Code Map should use shared lens IDs instead of only local task-scope logic.
- Add a dense operational panel:
  - Lens selector
  - Fusion checks summary
  - Read-these-first panel
  - God-node / community warnings
  - Query/path/explain entry points if data exists
- Keep graph rendering scoped and bounded.
- No marketing page, no new UI library, no source body rendering.
- Provider keys must remain unnecessary for graph/lens/fusion features.
- Empty states must explain whether data is missing because no graph export exists, no scan ran, or lens has no matches.

Acceptance:

- User can open dashboard and understand graph health without CLI.
- Lens selection changes visible nodes/cards without deleting data.
- Fusion hard warnings appear in UI.
- Agent context / read-first guidance appears in a compact panel.

Tests:

- Frontend tests for lens selector, empty states, fusion warnings, and no source body rendering.
- Typecheck frontend.
- Full `npm run verify:ci`.

## Phase 11 - Long-Tail Ecosystem Coverage

Objective:
Move important T2/T3 ecosystems upward, one at a time, without pretending support is deeper than it is.

Order:

1. Java/Kotlin T1
2. Ruby T1
3. PHP T1
4. Swift T1
5. C/C++ T1
6. Unity/Godot/Unreal T1/T2
7. Solidity/Web3 T1

Rules:

- One ecosystem per PR/phase.
- Add scanner registry entry, fixture, `verify:graph` expectations, handoff warning text, query benchmark if useful.
- Honest tier labels:
  - T0 = semantic/AST where real
  - T1 = structural symbols/imports
  - T2 = file/config/asset map
  - T3 = detected unsupported with useful diagnostics
- Remove extensions from `UNSUPPORTED_SOURCE_EXTENSIONS` only when scanner support exists.
- Never introduce broad untested regex that creates noisy false edges.

Acceptance per ecosystem:

- Detect project markers.
- Index useful files.
- Extract basic symbols safely.
- Skip build/dependency output.
- Handoff says exactly what is supported and what is not.

## Global Verification Required After Each Phase

Run:

- `npm run verify:graph`
- `npm run verify:ci`
- `git diff --check`
- `git status --short`

Also run focused tests for touched packages:

- Backend scanner/CLI tests for Phases 8, 9, 11.
- Frontend component/store tests for Phase 10.
- Shared graph tests for shared contract changes.

## Reporting Format For Grok

After each phase, report:

- Files changed
- Commands run
- Pass/fail results
- Known gaps
- Any behavior that changed
- Confirmation that OpenAgentGraphPro was not touched
- Confirmation that no commit/push was made

Recommended implementation order:

1. Phase 8 `graph:update`
2. Phase 9 C# Roslyn semantic edges
3. Phase 10 Dashboard lens/fusion UI
4. Phase 11 long-tail ecosystems, one language at a time

## Planning Skills Used

- `typescript-pro` - TypeScript/shared contracts and scanner architecture planning.
- `backend-dev-guidelines` - CLI/scanner/release-gate reliability planning.
- `frontend-dev-guidelines` - dashboard/lens UI planning.

Work completed: 100% planning only.
