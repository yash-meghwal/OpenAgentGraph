# Example: TypeScript app with strong agentic readiness

**Fixture:** `tests/fixtures/graph/fixture-agentic-harness-good`  
**Profile:** Small TypeScript/npm app with README setup/test/build docs, `AGENTS.md`, `llms.txt`, architecture doc, and CI workflow.  
**Snapshot date:** 2026-06-29 (reproduce locally to refresh)

## Commands

From the OpenAgentGraph repo root:

```bash
npx @openagentgraph/cli@1.7.0 doctor --workspace tests/fixtures/graph/fixture-agentic-harness-good
npx @openagentgraph/cli@1.7.0 graph:export --workspace tests/fixtures/graph/fixture-agentic-harness-good --offline-only --redact-root
npx @openagentgraph/cli@1.7.0 graph:scorecard --workspace tests/fixtures/graph/fixture-agentic-harness-good --agentic-sdlc --json
npx @openagentgraph/cli@1.7.0 graph:check --workspace tests/fixtures/graph/fixture-agentic-harness-good --json
npx @openagentgraph/cli@1.7.0 graph:context --workspace tests/fixtures/graph/fixture-agentic-harness-good --goal "add a feature" --include-verification --json
```

Monorepo equivalents:

```bash
npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-good --agentic-sdlc --json
npm run graph:check -- --workspace tests/fixtures/graph/fixture-agentic-harness-good --json
```

## Sanitized scorecard excerpt

```json
{
  "overallScore": 88,
  "ok": true,
  "categories": [
    { "id": "spec_readiness", "score": 90, "status": "good" },
    { "id": "verification_readiness", "score": 90, "status": "good" },
    { "id": "context_readiness", "score": 87, "status": "good" },
    { "id": "docs_health", "score": 100, "status": "good" },
    { "id": "update_readiness", "score": 50, "status": "needs_attention" }
  ]
}
```

Public benchmark value: **88/100** agentic SDLC readiness · **100/100** context noise.

## What OAG found

- **Project type:** Node/TypeScript (`typescript` scanner active).
- **Spec surfaces:** `README.md`, `AGENTS.md`, `llms.txt`, `docs/architecture.md`.
- **Verification map (discovered, not executed):**
  - `npm ci` — install (`script_defined`)
  - `npm run build` — build (`script_defined`)
  - `npm test` — unit_test (`script_defined`)
  - `npm run lint` — lint (`script_defined`)
  - CI workflow observes `npm test` (`ci_observed`)
- **Graph:** File/symbol edges for `src/index.ts`, package scripts, and docs links.

## What OAG warned about

- `GRAPH_REPORT.md` missing before first export (update/context readiness gap until `graph:export`).
- Minor spec gaps: no `CONTRIBUTING.md`, CI workflow not classified as a first-class spec signal in every category.
- Support tier disclosure: `generic (T3)` honesty entry for mixed/generic layouts.

## Agent workflow snippet

After export, `graph:context --include-verification` returns a bounded pack plus a deterministic verification plan listing the mapped commands above. OAG ranks README and agent instruction files as read-first surfaces; it does **not** copy source file bodies into exports or JSON output.

## Reproduce proof

```bash
npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-good --agentic-sdlc --json
npm run verify:graph
```

See [BENCHMARKS.md](../BENCHMARKS.md) for the pinned public scorecard row.