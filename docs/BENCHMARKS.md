# OAG Public Benchmark Scorecard

Generated: 2026-06-29T03:41:12.361Z

Reproduce with `npm run graph:scorecard`. Source bodies and private paths are intentionally omitted.

| Metric | Value | Reproduce |
| --- | --- | --- |
| Release benchmark fixtures | 41 | `npm run verify:graph` |
| Release gate status | PASS | `npm run verify:graph` |
| Balanced query success rate | 90% (min 90%) | `npm run verify:graph` |
| Code-mode query success rate | 100% (min 95%) | `npm run verify:graph` |
| Docs-mode query success rate | 100% (min 95%) | `npm run verify:graph` |
| Path success rate | 100% (min 95%) | `npm run verify:graph` |
| Path detour failures | 0 | `npm run verify:graph` |
| Path directness failures | 0 | `npm run verify:graph` |
| Path endpoint fidelity failures | 0 | `npm run verify:graph` |
| Guidance consistency failures | 0 | `npm run verify:graph` |
| Read-first failures | 0 | `npm run verify:graph` |
| Hub-start failures | 0 | `npm run verify:graph` |
| Docs repair suggestion coverage | 100% | `npm run graph:docs:check -- --suggest` |
| Generated artifact broken links | 0 | `npm run verify:graph` |
| Duplicate kernel scans (max per workflow) | 0 | `npm run graph:benchmark:update` |
| Warm/cold performance ratio | not_measured | `npm run graph:benchmark:update` |
| CLI clean-install smoke | not_run | `npm test --workspace=packages/cli` |
| Misleading handoff rate | 0% | `npm run verify:graph` |
| Provenance coverage | 100% | `npm run graph:scorecard` |
| External benchmark categories | 0/10 | `npm run graph:benchmark:external -- --catalog --report` |
| Update benchmark status | not_run | `npm run graph:benchmark:update` |
| Harness context noise (good fixture) | 100/100 | `npm run graph:check -- --workspace tests/fixtures/graph/fixture-agentic-harness-good --json` |
| Harness context noise (noisy fixture) | 76/100 | `npm run graph:check -- --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --json` |
| Agentic SDLC readiness (good fixture) | 88/100 | `npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-good --agentic-sdlc --json` |
| Agentic SDLC readiness (missing fixture) | 62/100 | `npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-missing --agentic-sdlc --json` |
| Agentic SDLC readiness (conflicting fixture) | 67/100 | `npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-conflicting --agentic-sdlc --json` |
| Agentic SDLC readiness (noisy fixture) | 67/100 | `npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-agentic-harness-noisy --agentic-sdlc --json` |

## Active scanners (fixture sample)

- generic: seen in 30 fixture scan(s)
- java: seen in 8 fixture scan(s)
- dotnet: seen in 5 fixture scan(s)
- cpp: seen in 5 fixture scan(s)
- ruby: seen in 4 fixture scan(s)
- php: seen in 4 fixture scan(s)
- typescript: seen in 3 fixture scan(s)
- swift: seen in 3 fixture scan(s)
- flutter: seen in 3 fixture scan(s)
- godot: seen in 2 fixture scan(s)
- python: seen in 1 fixture scan(s)
- go: seen in 1 fixture scan(s)
- rust: seen in 1 fixture scan(s)
- terraform: seen in 1 fixture scan(s)
- unity: seen in 1 fixture scan(s)
- unreal: seen in 1 fixture scan(s)
