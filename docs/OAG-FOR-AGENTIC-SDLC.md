# OAG For Agentic SDLC

OpenAgentGraph is the **deterministic harness, context, and verification layer** for agentic software development. It helps coding agents orient in a repo, avoid polluted context, and know how to verify changes — without running as the agent itself.

## The problem

Agentic engineering breaks when:

- Setup, test, and build commands are missing or contradictory across README, `AGENTS.md`, and docs
- Generated artifacts (`.oag`, build output, stale handoffs) pollute the context window
- The agent cannot tell what to read first or how to prove a change is safe
- Semantic claims exceed what the toolchain actually supports

OAG scores and surfaces these gaps deterministically. No provider key, no hosted platform, no autonomous edits.

## What OAG provides

| Layer | What you get |
| --- | --- |
| Graph export | File/symbol graph, communities, docs links, provenance, support tiers |
| Agentic harness | Nine-category readiness scorecard (graph, context, spec, verification, docs, tiers, provenance, update, install) |
| Context packs | Bounded `graph:context` output with noise scoring and optional verification plan |
| Verification map | Discovered build/test/check commands and gaps |
| Doctor | One-screen agentic readiness summary and next commands |
| Learn | Review-only harness improvement proposals from workspace state or agent logs |

## What OAG is not

- **Not a coding agent** — OAG does not write code, open PRs, or run your test suite autonomously.
- **Not a hosted agent platform** — scans and exports run locally; artifacts stay in your workspace.
- **Not a token compressor** — OAG bounds and ranks context; it does not replace your model or summarize source bodies into exports.

Base OAG installs from npm. No extra product folders or coordination tier required.

## 60-second npm path

```bash
npx @openagentgraph/cli@1.7.0 doctor --workspace .
npx @openagentgraph/cli@1.7.0 graph:export --workspace . --offline-only --redact-root
npx @openagentgraph/cli@1.7.0 graph:context --workspace . --goal "understand this repo" --include-verification --json
```

Then inspect `GRAPH_REPORT.md` and run harness checks:

```bash
npx @openagentgraph/cli@1.7.0 graph:check --workspace . --json
npx @openagentgraph/cli@1.7.0 graph:scorecard --workspace . --agentic-sdlc --json
```

## Recommended agent workflow

1. **Doctor** — confirm workspace access and agentic readiness summary.
2. **Export** — refresh `.oag/*` and `GRAPH_REPORT.md` (use `--redact-root` for share-safe paths).
3. **Context** — request a bounded pack for the task goal; include verification when planning changes.
4. **Check** — read harness report, context noise, and scorecard before editing.
5. **Navigate** — use `graph:query`, `graph:path`, `graph:explain`, and `graph:retrieve` before broad scans.
6. **Verify** — run commands from the verification map; do not trust readiness scores as proof the code is correct.
7. **Learn** — on failures, use `graph:learn` for review-only improvement proposals (never auto-applied).

## Key surfaces

- `doctor` — `agenticReadiness` in JSON; human summary with spec quality, verification map, context noise, docs health
- `graph:check --json` — `agentHarnessReport`, `contextNoise`, `agenticSdlcScorecard`, `harnessImprovementProposals`
- `graph:context --include-verification` — bounded pack plus verification plan
- `graph:learn --workspace .` — workspace harness proposals; add `--from-log <path>` to merge agent log findings
- `GRAPH_REPORT.md` — Agentic SDLC harness section after export

## Scorecard categories

See [AGENTIC-SDLC-HARNESS.md](AGENTIC-SDLC-HARNESS.md) for the full category table and fixture expectations.

Overall score is **readiness only**: a high score means the repo looks agent-ready, not that production code is correct.

## Privacy and trust

- Exports contain metadata (paths, labels, edges, tiers) — not source file bodies.
- Provider API keys are not required for scans, checks, scorecards, context packs, or learn proposals.
- Harness proposals are review-only (`safeForAgentAutoApply: false`).

## Further reading

- [AGENTIC-SDLC-HARNESS.md](AGENTIC-SDLC-HARNESS.md) — scorecard, commands, fixtures
- [GRAPH-CONTEXT.md](GRAPH-CONTEXT.md) — context pack contract
- [BENCHMARKS.md](BENCHMARKS.md) — reproducible public proof metrics
- [OPENAGENTGRAPH-FOR-LLMS.md](OPENAGENTGRAPH-FOR-LLMS.md) — first-open agent workflow