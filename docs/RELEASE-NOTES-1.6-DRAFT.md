# OpenAgentGraph v1.6 Release Notes (Draft)

Draft only. Version numbers remain at `1.5.0` until Codex approves the completed implementation.

## Highlights

- Explicit query intent modes (`code`, `docs`, `balanced`) with release-gated success floors.
- Semantic path directness and detour avoidance on the pinned release fixture suite.
- Unified agent start guidance across read-first, hubs, and god nodes.
- Non-mutating documentation repair suggestions via `graph:docs:check --suggest`.
- Dogfood/export performance telemetry, warm benchmarks, and duplicate-scan guards.
- Public npm CLI completion: `oag doctor`, `oag dogfood`, and clean-install packaging smoke.
- Expanded public scorecard and `verify:graph` release metrics.

## Agent relevance

- `graph:query --mode code` ranks code symbols/files first.
- `graph:query --mode docs` ranks documentation surfaces first.
- `graph:query --mode balanced` keeps mixed default ranking.
- Release floors: balanced query min 90%, code/docs modes min 95% on the fixture suite.

## Path quality

- Release path success remains 100% on the pinned suite.
- Path detour, directness, and endpoint fidelity failures must be 0 on release gates.
- Broader repositories may still require source inspection; benchmarks do not claim universal semantic correctness.

## Documentation repair

- `graph:docs:check --suggest` proposes safe repairs for broken links and anchors.
- Suggestions never mutate user-authored Markdown.
- Generated OAG artifacts must keep zero broken internal links outside intentional broken-link fixtures.

## Performance

- Stage timings are exposed in dogfood, export, update, and benchmark JSON output.
- Update benchmarks cover TypeScript, C#, mixed, docs-heavy, unchanged warm repeat, and generated-noop scenarios.
- Warm/cold ratios and duplicate kernel scan counts are release-gated; numbers are benchmark-specific.

## Public CLI

Install:

```bash
npm install -g @openagentgraph/cli
```

New or expanded commands:

```bash
oag doctor --workspace "<path>"
oag dogfood --workspace "<path>"
oag graph:query --workspace "<path>" --mode code "<query>"
```

No git clone is required for export, query, path, check, context, docs check, doctor, or dogfood.

Optional .NET SDK enables Roslyn-backed C# semantic edges; structural indexing remains available without it.

## Base vs Pro

These changes apply to OpenAgentGraph Base only. OpenAgentGraphPro coordination, hosted execution, and scratch export folders are out of scope.

## Verification

```bash
npm run verify:graph
npm run graph:scorecard -- --output docs/BENCHMARKS.md
npm test --workspace=packages/cli
npm run verify:ci
git diff --check
```

See `docs/BENCHMARKS.md` for measured gate values.

## Not included in this draft

- Version bump to `1.6.0`
- npm publish, git tag, or GitHub release (Codex/user-controlled after review)