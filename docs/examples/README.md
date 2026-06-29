# OAG Public Demo Examples

Sanitized adoption examples for OpenAgentGraph 1.7 agentic SDLC harness. Each page uses a **public benchmark fixture** in this repository — no copied source bodies, no private paths, no provider keys.

Reproduce any example from the repo root after `npm ci` and a backend build:

```bash
npm run build --workspace=packages/shared --silent
npm run build --workspace=packages/backend --silent
```

Or use the published CLI (same commands, `oag` instead of `node packages/backend/dist/cli/...`):

```bash
npx @openagentgraph/cli@1.7.0 doctor --workspace tests/fixtures/graph/<fixture>
```

## Examples

| Example | Fixture | What it demonstrates |
| --- | --- | --- |
| [TypeScript app with strong agentic readiness](typescript-agentic-harness-good.md) | `fixture-agentic-harness-good` | High harness score, verification map, low context noise |
| [.NET WPF app with graph + verification discovery](dotnet-wpf-app.md) | `fixture-csharp-wpf` | C# structural graph, inferred `dotnet` commands, sparse agent docs |
| [Agent repo with noise and harness warnings](agent-repo-noisy-warnings.md) | `fixture-agentic-harness-noisy` | Generated-artifact noise, broken docs, missing agent instructions |

## Related docs

- [OAG for agentic SDLC](../OAG-FOR-AGENTIC-SDLC.md)
- [Agentic SDLC harness](../AGENTIC-SDLC-HARNESS.md)
- [Public benchmarks](../BENCHMARKS.md)

## Generated artifacts you may see

Some example commands write **local generated outputs** (not edits to your source or hand-authored docs):

| Path | Written by | Notes |
| --- | --- | --- |
| `.oag/` | `graph:export`, `graph:update` | Graph cache, HTML explorer, wiki index |
| `GRAPH_REPORT.md` | `graph:export` | Deterministic handoff report (gitignored in most workspaces) |
| `OAG-LEARN-PROPOSAL.md` | `graph:learn` (default `--output`) | Review-only harness proposals |

Treat these as generated artifacts. They are safe to delete or gitignore; OAG does not auto-edit `README.md`, `AGENTS.md`, `LLMS.md`, or source files.

## Snapshot policy

Scores and excerpts in these pages are **reproducible snapshots** from `npm run verify:graph` / `npm run graph:scorecard`. Re-run the commands on each page to refresh values locally. OAG does not run your tests or edit user-authored source/docs automatically. Some commands write generated, gitignored artifacts such as `.oag/*`, `GRAPH_REPORT.md`, and `OAG-LEARN-PROPOSAL.md`.