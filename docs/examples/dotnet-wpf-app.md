# Example: .NET WPF app with graph and verification discovery

**Fixture:** `tests/fixtures/graph/fixture-csharp-wpf`  
**Profile:** Small WPF solution (`SampleMediaPlayer.sln`) with App, Core, and Tests projects — code graph without agent harness docs.  
**Snapshot date:** 2026-06-29 (reproduce locally to refresh)

## Commands

```bash
npx @openagentgraph/cli@1.7.0 doctor --workspace tests/fixtures/graph/fixture-csharp-wpf
npx @openagentgraph/cli@1.7.0 graph:export --workspace tests/fixtures/graph/fixture-csharp-wpf --offline-only --redact-root
npx @openagentgraph/cli@1.7.0 graph:scorecard --workspace tests/fixtures/graph/fixture-csharp-wpf --agentic-sdlc --json
npx @openagentgraph/cli@1.7.0 graph:path --workspace tests/fixtures/graph/fixture-csharp-wpf "MainViewModel" "PlaybackService" --mode balanced
```

Monorepo equivalents:

```bash
npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-csharp-wpf --agentic-sdlc --json
npm run graph:path -- --workspace tests/fixtures/graph/fixture-csharp-wpf "MainViewModel" "PlaybackService"
```

Optional: .NET SDK enables richer C# symbol edges; structural indexing works without Roslyn.

## Sanitized scorecard excerpt

```json
{
  "overallScore": 64,
  "ok": false,
  "graph_quality": { "score": 92, "status": "good" },
  "verification_readiness": {
    "score": 80,
    "status": "good",
    "detail": "2 command(s) mapped; 0 recommended default(s)."
  }
}
```

## What OAG found

- **Project type:** .NET / WPF (`dotnet` scanner active).
- **Graph symbols:** View models, views, and services (e.g. path targets `MainViewModel` → `PlaybackService` are routable).
- **Verification map (inferred from project layout):**
  - `dotnet build` on the solution — build (`inferred`)
  - `dotnet test` on the test project — unit_test (`inferred`)
- **Provenance:** Edge metadata present on dependency relationships.

## What OAG warned about

- **Agentic readiness below threshold** (64/100): no `AGENTS.md`, `llms.txt`, or setup/test prose aimed at coding agents.
- **Spec readiness gaps:** README/setup instructions for agent onboarding are sparse compared to the TypeScript harness-good fixture.
- **Handoff freshness:** `GRAPH_REPORT.md` absent until export — same pattern as other fixtures before first `graph:export`.
- **Support tier honesty:** Structural .NET coverage disclosed; semantic depth depends on optional Roslyn helper.

## Why this example matters

OAG still delivers value on traditional codebases without agent docs: deterministic graph navigation, path finding, and inferred build/test commands. The agentic SDLC scorecard separates **graph quality** (high) from **harness readiness** (lower), so teams know what to add before agentic workflows.

## Reproduce proof

```bash
npm run graph:scorecard -- --workspace tests/fixtures/graph/fixture-csharp-wpf --agentic-sdlc --json
npm run verify:graph
```