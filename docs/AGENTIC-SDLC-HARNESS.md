# Agentic SDLC Harness

OpenAgentGraph 1.7 adds a deterministic, local **agentic SDLC harness** layer on top of the existing graph export. OAG does not run your tests, rewrite your repo, or call an AI provider to produce these scores.

For positioning and the recommended npm-first workflow, see [OAG-FOR-AGENTIC-SDLC.md](OAG-FOR-AGENTIC-SDLC.md).

For sanitized adoption walkthroughs, see [examples/](examples/README.md).

## What it measures

The harness answers whether an agent can work safely in a repo:

- What to read before coding
- How to verify a change
- Which commands are available or risky
- Whether setup/test/agent instructions exist or conflict
- Whether generated artifacts or stale handoff exports will pollute context

## Scorecard categories

`graph:check --json` and `graph:scorecard --agentic-sdlc --json` expose nine deterministic categories (0–100 each):

| Category | What it reflects |
| --- | --- |
| Graph quality | Fusion checks, symbol coverage, graph gate warnings |
| Context readiness | Context noise score and `GRAPH_REPORT.md` / `.oag` handoff freshness |
| Spec readiness | README, setup/test/build docs, agent instructions, conflicts |
| Verification readiness | Discovered build/test/graph-check commands and map gaps |
| Docs health | Broken documentation links and architecture/setup doc presence |
| Support tier honesty | Disclosure of structural-only (T2/T3) ecosystems |
| Provenance coverage | Edge provenance and confidence metadata |
| Update readiness | Handoff freshness and optional update benchmark posture |
| Install/package readiness | Install/setup signals and package-script coverage |

The overall score is the average of these categories. It is **readiness only**: a high score means the repo harness looks agent-ready, not that the code is correct.

## Commands

Workspace scorecard:

```bash
npx @openagentgraph/cli@1.7.0 graph:scorecard --workspace . --agentic-sdlc --json
npx @openagentgraph/cli@1.7.0 graph:check --workspace . --json
npx @openagentgraph/cli@1.7.0 graph:learn --workspace . --json
```

Public benchmark scorecard (includes harness fixture samples):

```bash
npm run graph:scorecard
```

Reproduce harness fixture scores:

```bash
npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-good --agentic-sdlc --json
npm run graph:check -- --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --json
```

## Surfaces

- `doctor` — `agenticReadiness` summary, context noise, next commands
- `graph:check` — `agentHarnessReport`, `contextNoise`, `agenticSdlcScorecard`, `harnessImprovementProposals`
- `graph:context` — bounded context pack with noise and optional verification plan (`--include-verification`)
- `graph:learn` — review-only harness improvement proposals from workspace and/or agent logs
- `GRAPH_REPORT.md` — Agentic SDLC harness section
- `docs/BENCHMARKS.md` — public proof metrics including harness fixture samples

## Fixture expectations

Dedicated harness fixtures under `tests/fixtures/graph/` provide regression anchors:

- `fixture-agentic-harness-good` — high readiness
- `fixture-agentic-harness-missing` — sparse instructions, lower spec/verification scores
- `fixture-agentic-harness-conflicting` — conflicting test/agent guidance
- `fixture-agentic-harness-noisy` — generated-artifact and doc-noise penalties

These fixtures are scanned locally during `npm run verify:graph` and `npm run graph:scorecard`.

## Non-goals

- OAG is not a coding agent or hosted agent platform.
- Harness output is suggestions and scoring only unless a future release adds an explicit apply command.
- Provider API keys are not required for scans, checks, scorecards, or context packs.