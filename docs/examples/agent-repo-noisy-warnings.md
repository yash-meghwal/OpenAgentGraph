# Example: Agent repo with noise and harness warnings

**Fixture:** `tests/fixtures/graph/fixture-agentic-harness-noisy`  
**Profile:** Sparse docs, tracked generated output, stale root plan file, broken doc link — common agent-context pollution patterns.  
**Snapshot date:** 2026-06-29 (reproduce locally to refresh)

Related regression fixture for **conflicting instructions** (not duplicated here): `tests/fixtures/graph/fixture-agentic-harness-conflicting` (`AGENTS.md` says vitest, `CLAUDE.md` says jest).

## Commands

```bash
npx @openagentgraph/cli@1.7.0 graph:check --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --json
npx @openagentgraph/cli@1.7.0 graph:scorecard --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --agentic-sdlc --json
npx @openagentgraph/cli@1.7.0 graph:learn --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --json
```

Monorepo equivalents:

```bash
npm run graph:check -- --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --json
npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --agentic-sdlc --json
npm run graph:learn -- --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --json
```

`graph:learn` writes `OAG-LEARN-PROPOSAL.md` to the workspace root by default (override with `--output <path>`). The file contains **review-only** proposals — OAG does not apply them to README, agent instruction files, or source.

## Sanitized check excerpt

```json
{
  "agenticSdlcScorecard": { "overallScore": 67, "ok": false },
  "contextNoise": {
    "score": 76,
    "noiseItems": [
      { "kind": "generated_artifact", "detail": "Tracked or indexed generated artifact likely to pollute agent context." },
      { "kind": "stale_plan", "detail": "Stale plan/report file at repo root can mislead agents." },
      { "kind": "broken_doc_link", "detail": "1 broken documentation link(s) detected." }
    ]
  }
}
```

Public benchmark values: **67/100** agentic readiness · **76/100** context noise (vs **100/100** on the good fixture).

## What OAG found

- **Indexed noise targets:** `generated-output.js`, `PLAN-STALE-1.5.md`, README link to a missing architecture doc.
- **Package scripts:** Only `npm run build` (`tsc --noEmit`) — no test or setup script in `package.json`.
- **Docs link diagnostic:** Broken relative link surfaced in graph diagnostics (line-level docs check available via `graph:docs:check`).

## What OAG warned about

| Warning | Harness signal |
| --- | --- |
| Generated artifact in tree | Context noise — likely to pollute agent prompts |
| Stale `PLAN-*.md` at repo root | Context noise — outdated handoff risk |
| Broken doc link in README | Docs health / spec risk |
| No `AGENTS.md` / `llms.txt` | Spec + harness readiness gaps |
| No focused test command | Verification map gap |

### Review-only learn proposals (`graph:learn`)

OAG emits proposals such as:

- Missing setup command
- Missing focused test command
- Missing agent instructions

All proposals are **review-only** (`safeForAgentAutoApply: false`). OAG does not edit README, `AGENTS.md`, or source.

## Conflicting-instructions companion

For the **conflicting** fixture:

```bash
npm run graph:check -- --workspace tests/fixtures/graph/fixture-agentic-harness-conflicting --json
```

Expected harness signals:

- `test_command` conflict between README/CI and agent instruction files
- `agent_instructions` conflict between `AGENTS.md` and `CLAUDE.md`
- Overall score **67/100** (public benchmark snapshot)

## Reproduce proof

```bash
npm run graph:check -- --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --json
npm run verify:graph
```

See [BENCHMARKS.md](../BENCHMARKS.md) for pinned noisy/good/context-noise rows.