# OpenAgentGraph v1.2.1 Universal Repo Readiness Plan

## Summary

Goal for Grok Composer: make OpenAgentGraph base more reliable for **any repository a user points it at**, not just the current dogfood workspace.

The dogfood report at `C:\Users\yashm\Desktop\Video Player\OAG-REDOGFOOD-LIVING-REPORT.md` exposed universal product gaps:

- CLI commands must work with Windows paths containing spaces.
- Optional analyzers must prepare/probe/fallback cleanly.
- Health and handoff copy must be ecosystem-neutral, not TypeScript-centric.
- `graph:path` must prefer meaningful code relationships over workspace/root bridge nodes.
- Communities must become useful modules/neighborhoods across project types.
- Static outputs must be strong enough for agents without a running dashboard.

Treat the dogfood repo as a benchmark only. Do **not** hardcode project-specific names, paths, files, or assumptions. Every fix must generalize to arbitrary repos.

## Scope Guardrails

- Work only in OpenAgentGraph **base** at `C:\Users\yashm\Desktop\promptvector`.
- Do **not** touch:
  - `C:\Users\yashm\Desktop\OpenAgentGraphPro`
  - `C:\Users\yashm\Desktop\promptvector\OpenAgentGraphPro`
  - `C:\Users\yashm\Desktop\promptvector\OpenAgentGraphPro-*`
  - `C:\Users\yashm\Desktop\promptvector\OpenAgentGraph-base-review`
  - any sibling scratch copies.
- Do not stage or commit scratch files unless explicitly asked.
- Keep AGPL/base package identity intact.
- No provider/API key requirement for graph scans, handoff, CLI query/path/export/update/check, or static outputs.
- Do not optimize for one repo. Fix classes of bugs.
- Preserve existing green behavior: `npm run verify:ci` must pass before handoff.

## Current Baseline

OpenAgentGraph v1.2.0 is published and CI-green.

Strong areas:

- Universal scanner kernel and ignore handling.
- C#/.NET structural indexing plus optional Roslyn semantic support.
- T1/T2 ecosystem coverage for TypeScript/JS, Python, Go, Rust, Java/Kotlin, Terraform, docs, scripts, shell, and generic repos.
- `graph:query`, `graph:path`, `graph:explain`, `graph:export`, `graph:update`, `graph:check`.
- Release gates and fixture suite.
- Handoff quality is now useful for first-open agent orientation.

Open gaps:

- NPM script path forwarding is fragile on Windows paths with spaces.
- Some analyzers require manual preparation before dogfood.
- Handoff health can still sound TypeScript-specific in non-TS repos.
- `graph:path` can choose meaningless bridge/root paths.
- Communities are too coarse for large repos.
- Static output and docs/wiki exports need stronger navigation affordances.

## Phase 1 - Universal CLI Robustness

### Objective

All graph commands must work from npm scripts, direct node invocation, PowerShell, cmd, bash, Windows paths with spaces, and cwd variations.

### Required Work

- Audit all root scripts that forward CLI args:
  - `dogfood`
  - `graph:query`
  - `graph:path`
  - `graph:explain`
  - `graph:export`
  - `graph:update`
  - `graph:check`
  - `graph:lens`
  - `handoff:print`
  - `handoff:write`
- Fix argument parsing so `--workspace "C:\Users\...\Video Player\repo"` works via `npm run ... -- --workspace "..."`
- Normalize and validate workspace paths without mangling quotes, spaces, drive letters, or UNC-style roots.
- Add tests for:
  - workspace path with spaces
  - Windows drive path
  - relative workspace path
  - direct node invocation parity
  - missing workspace error clarity
- Ensure errors print the original user-facing path safely, without leaking secrets.

### Acceptance Criteria

- `npm run dogfood -- --workspace "C:\Users\yashm\Desktop\Video Player\openviewplayer"` works.
- Equivalent direct `node packages/backend/dist/cli/dogfood.js --workspace "..."`
  produces the same workspace resolution.
- No project-specific path logic.

## Phase 2 - Analyzer Self-Preparation

### Objective

Optional analyzers should never feel like hidden setup. They should auto-prepare when safe, or produce precise fallback diagnostics.

### Required Work

- Add a shared analyzer availability contract:
  - analyzer id
  - required runtime
  - build/probe command
  - enabled/disabled/unavailable status
  - fallback reason
  - safe auto-build capability
- Apply first to Roslyn helper:
  - Detect helper DLL.
  - If missing and .NET SDK is available, build helper automatically during `dogfood` and graph commands that need C# semantic analysis.
  - If build fails, continue structural scan and report exact fallback reason.
- Keep helper build bounded:
  - timeout
  - no recursive repo scan of helper build output
  - no generated `bin/` or `obj/` tracked files
- Make analyzer setup visible in:
  - CLI output
  - `GRAPH_REPORT.md`
  - `.oag/graph.json` metadata
  - `graph:check`

### Acceptance Criteria

- First-time dogfood on a C# repo does not require manually running `npm run build:roslyn-helper`.
- If .NET is absent, scan still succeeds structurally and states why semantic C# is unavailable.
- Analyzer setup pattern is reusable for future Java, Python, Ruby, PHP, C/C++, mobile, or game analyzers.

## Phase 3 - Ecosystem-Neutral Health And Handoff

### Objective

OAG must never sound confused when scanning non-TypeScript repos.

### Required Work

- Replace TS-centric health text with ecosystem-aware sections:
  - TypeScript/JavaScript project config
  - .NET solution/project and Roslyn status
  - Java/Kotlin Maven/Gradle status
  - Python project markers and import/index status
  - Go module status
  - Rust cargo/workspace status
  - Terraform module status
  - docs-only corpus status
  - generic/unknown fallback status
- Update `GRAPH_REPORT.md` and CLI diagnostics to show:
  - active scanners
  - scanner tiers
  - semantic/analyzer status by ecosystem
  - skipped folders by reason
  - unsupported source-like files
  - partial/breaker status
- Add tests proving .NET-only, docs-only, Java, Python, and generic repos do not mention irrelevant TypeScript config failures.

### Acceptance Criteria

- A .NET-only repo says `.NET solution/project detected`, not `No TypeScript project config`.
- A docs-only repo reports documentation corpus mode honestly.
- Mixed-polyglot repos show multiple scanner health blocks.

## Phase 4 - Meaningful `graph:path`

### Objective

`graph:path` should find architecture-relevant paths between concepts, files, and symbols.

### Required Work

- Review current path scoring.
- Penalize or filter low-value bridge nodes:
  - workspace root
  - fake/helper/test-only bridge nodes unless query asks for tests
  - generic package/root folders
  - generated artifacts
- Prefer edges with stronger provenance:
  - semantic/extracted
  - project references
  - imports/using relationships
  - XAML/code-behind/viewmodel links
  - test-to-SUT edges when task lens is tests
- Support path mode options:
  - `--lens backend|frontend|tests|docs|infra|all`
  - `--max-hops`
  - `--explain-ranking`
  - `--json`
- Add “why this path” explanation:
  - seed resolution
  - node kinds
  - edge kinds
  - dropped/penalized alternatives
- Add cross-language fixture tests:
  - C# viewmodel to service
  - Java service to model
  - TypeScript page/component to API/client
  - Python route to service/module
  - Terraform module to resource

### Acceptance Criteria

- `graph:path` no longer routes through workspace-root when a meaningful code path exists.
- Path output is explainable and useful to an agent before editing source.
- Graphify-style path navigation is matched or beaten on representative fixtures.

## Phase 5 - Universal Community Detection

### Objective

Large repos need meaningful neighborhoods, not a handful of huge blobs.

### Required Work

- Build community segmentation from combined signals:
  - folder/package/module boundaries
  - namespaces
  - project files
  - imports/using edges
  - semantic edges
  - docs proximity
  - tests proximity
  - task lenses
- Split oversized communities deterministically.
- Merge tiny fragments when they share strong boundaries.
- Label communities with useful names:
  - project/package/module name
  - namespace/package
  - dominant file group
  - task lens
- Add community summaries to:
  - `GRAPH_REPORT.md`
  - `.oag/wiki/index.md`
  - `.oag/graph.html`
  - `graph:query` context
  - `graph:explain`
- Add release gate:
  - no generated/build community dominates read-first output
  - large repos produce multiple meaningful communities
  - community names are not all generic

### Acceptance Criteria

- Representative large fixture produces many meaningful communities, not a single coarse blob.
- Community count alone is not the goal; useful module boundaries are.
- Static outputs help agents choose where to read first.

## Phase 6 - Static-First Export Improvements

### Objective

OAG should be useful even when a user only shares `.oag/` outputs and `GRAPH_REPORT.md`.

### Required Work

- Strengthen `.oag/graph.html`:
  - search
  - task lens filtering
  - community navigation
  - node explain panel
  - path query preview when possible
- Strengthen `.oag/wiki/index.md`:
  - top communities
  - read-first by lens
  - known risks/gaps
  - commands to refresh
- Ensure `.oag/graph.json` includes enough metadata for offline agents:
  - scanner profile
  - analyzer status
  - communities
  - provenance
  - graph version
- Keep source bodies out of every export.

### Acceptance Criteria

- A user can zip/share `.oag/` + `GRAPH_REPORT.md` and an agent can orient without running OAG.
- Static export is not just a dump; it is a navigation product.

## Phase 7 - Ecosystem Expansion Policy

### Objective

Expand coverage based on real user value while keeping tier honesty.

### Priority Order

1. Ruby/Rails T1
2. PHP/Laravel/WordPress T1
3. C/C++/CMake T1
4. Swift/iOS/macOS T1
5. Kotlin/Android deeper T1/T2
6. Flutter/Dart T1
7. Unity C# project overlays
8. Unreal C++/Blueprint metadata
9. Godot/GDScript
10. Solidity/Foundry/Hardhat

### Rules

- Every ecosystem must include:
  - fixture
  - scanner tier declaration
  - honest diagnostics
  - unsupported-file behavior
  - generated/build skip rules
  - query benchmark
  - handoff output
- Do not call regex indexing “semantic.”
- Prefer T1 structural value before expensive T0 semantic work.

## Verification Plan

Run and fix until green:

```powershell
npm run verify:ci
npm run verify:graph
git diff --check
git status --short
```

Add targeted tests for every touched area:

- backend CLI parser tests
- graph command integration tests
- scanner/analyzer tests
- graph path ranking tests
- graph artifact tests
- fixture release gates

For Windows path fixes, include direct PowerShell command examples in tests or documented manual verification.

## Grok Handoff Requirements

When Grok finishes each phase, report:

- exact files changed
- commands run
- test results
- any new failing CI/local behavior
- known gaps deferred
- whether any Pro or scratch folder was touched
- whether the change is universal or benchmark-specific

Do not claim done unless `npm run verify:ci` passes or the blocker is clearly documented.

## Recommended First Phase

Start with **Phase 1 - Universal CLI Robustness**.

Reason:

- It is user-visible.
- It affects every repo type.
- It removes the first-run footgun exposed by dogfood.
- It creates a safer foundation for all later graph commands.

Do not start Phase 2 until Phase 1 is implemented, tested, and verified.
