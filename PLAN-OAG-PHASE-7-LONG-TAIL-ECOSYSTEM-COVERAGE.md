# OpenAgentGraph Phase 7 Long-Tail Ecosystem Coverage Plan

## Summary

Goal for Grok Composer: expand OpenAgentGraph base so it gives useful, honest, static-first graph coverage for more unknown repositories, while preserving the current no-provider-key workflow and the Phase 1-6 guarantees.

Phase 7 should focus on long-tail ecosystem coverage, not dashboard redesign or deeper semantic engines. The desired outcome is that users can point OAG at Ruby, PHP, and more Java/Kotlin variants and receive useful file, symbol, dependency, community, query, path, export, and handoff output without false confidence.

Treat every fixture as a universal benchmark. Do not optimize for one dogfood repo or one private project.

## Hard Scope Boundary

- Work only in OpenAgentGraph base at `C:\Users\yashm\Desktop\promptvector`.
- Do not read, edit, copy from, commit, push, or reference implementation from:
  - `C:\Users\yashm\Desktop\OpenAgentGraphPro`
  - `C:\Users\yashm\Desktop\promptvector\OpenAgentGraphPro`
  - `C:\Users\yashm\Desktop\promptvector\OpenAgentGraphPro-*`
  - `C:\Users\yashm\Desktop\promptvector\OpenAgentGraph-base-review`
  - any sibling scratch/export/import folders.
- Grok Composer implements locally only.
- Grok Composer must not commit, push, tag, publish, or touch GitHub.
- Codex reviews, verifies, stages, commits, and pushes after independent review.
- Keep AGPL/base package identity intact.
- Graph scans, CLI query/path/export/update/check, static HTML/wiki/report, and handoff must remain no-provider-key.
- Do not persist source bodies.
- Do not add an AI summarizer.
- Do not add unsupported semantic claims.

## Current Baseline

Already strong:

- Universal scanner kernel and ignore handling.
- TypeScript/JavaScript T0 semantic support via TypeScript compiler API.
- C#/.NET T0 structural support plus optional Roslyn semantic edges.
- Python, Go, Rust, Java/Kotlin, Terraform, docs, and scripts have some structural coverage.
- `graph:query`, `graph:path`, `graph:explain`, `graph:export`, `graph:update`, `graph:check`.
- Community detection, release gates, static `.oag/graph.html`, wiki, and `GRAPH_REPORT.md`.
- `npm run verify:ci` is green after Phase 6.

Still open:

- Ruby is still unsupported or too shallow.
- PHP is still unsupported or too shallow.
- Java/Kotlin T1 needs hardening for real Gradle/Maven layouts.
- Long-tail ecosystem health and support matrix should be more visible in static outputs.
- Release gates should include realistic long-tail fixtures and first-query benchmarks.

## Phase 7 Objective

Move important T2/T3 ecosystems upward one at a time with honest tiering:

- Ruby/Rails/Sinatra: T1 structural.
- PHP/Composer/Laravel/Symfony/WordPress: T1 structural.
- Java/Kotlin hardening: stronger T1 for Gradle/Maven multi-module repos.
- Static output and release gates: make support depth visible to agents and users.

Success means OAG can index these repos enough for first-open orientation, read-first guidance, graph query/path/explain, and static export navigation. It does not mean full compiler semantic resolution.

## Tier Definitions

- T0: compiler/AST-backed semantic support where real.
- T1: structural symbols/imports/config/tests with useful dependency edges.
- T2: file/config/asset map with project markers and honest warnings.
- T3: detected unsupported ecosystem with useful diagnostics.

Do not promote an ecosystem above the tier that tests prove.

## Phase 7A - Ruby T1 Scanner

### Required Work

- Add Ruby/Rails/Sinatra marker detection:
  - `Gemfile`
  - `*.gemspec`
  - `config/routes.rb`
  - `config/application.rb`
  - `Rakefile`
  - `app/models`, `app/controllers`, `app/services`, `app/jobs`
- Move `.rb`, `.rake`, and useful Ruby config files out of unsupported status only when T1 scanner support exists.
- Extract structural symbols:
  - modules
  - classes
  - methods
  - Rails controllers, models, jobs, mailers where path conventions are clear
- Extract relationships:
  - `require`
  - `require_relative`
  - class inheritance where both endpoints are in the workspace
  - Rails route to controller when safely inferred
  - test/spec file to source file where path conventions match
- Add scanner registry entry:
  - scanner id: `ruby`
  - tier: `T1`
  - capabilities: project detection, file discovery, symbols, dependencies, tests, handoff sections
  - semanticSupported: false
  - warning: "Ruby scanner is T1 structural; runtime/metaprogramming semantic edges are not enabled."

### Ruby Fixtures

Add fixtures under `tests/fixtures/graph/`:

- `fixture-ruby-rails`
  - `Gemfile`
  - `config/routes.rb`
  - `app/models/user.rb`
  - `app/controllers/users_controller.rb`
  - `app/services/user_exporter.rb`
  - `spec/models/user_spec.rb`
  - generated/cache folders that must be skipped
- `fixture-ruby-gem`
  - `*.gemspec`
  - `lib/<gem_name>.rb`
  - nested modules/classes
  - test/spec file

### Ruby Acceptance

- Rails fixture activates `ruby` scanner.
- Classes/modules/methods appear as symbols.
- Routes and controller files are visible.
- Spec-to-source relationships exist where convention is safe.
- `tmp/`, `log/`, `vendor/bundle/`, `.bundle/`, and generated output are skipped.
- Handoff/export says Ruby support is T1 structural.

## Phase 7B - PHP T1 Scanner

### Required Work

- Add PHP ecosystem marker detection:
  - `composer.json`
  - `composer.lock`
  - `artisan`
  - `public/index.php`
  - `wp-config.php`
  - `wp-content/plugins/*`
  - `symfony.lock`
- Move `.php`, `.phtml`, and useful PHP config files out of unsupported status only when T1 scanner support exists.
- Extract structural symbols:
  - namespaces
  - classes
  - interfaces
  - traits
  - functions
  - methods
  - WordPress hooks where simple call patterns are visible
- Extract relationships:
  - `use` imports
  - `require`, `require_once`, `include`, `include_once`
  - class inheritance and interface implementation when both endpoints are in the workspace
  - Laravel route to controller where safely inferred
  - PHPUnit test-to-source by path convention
- Add scanner registry entry:
  - scanner id: `php`
  - tier: `T1`
  - capabilities: project detection, file discovery, symbols, dependencies, tests, handoff sections
  - semanticSupported: false
  - warning: "PHP scanner is T1 structural; composer/runtime semantic edges are not enabled."

### PHP Fixtures

Add fixtures under `tests/fixtures/graph/`:

- `fixture-php-laravel`
  - `composer.json`
  - `artisan`
  - `routes/web.php`
  - `app/Models/User.php`
  - `app/Http/Controllers/UserController.php`
  - `tests/Feature/UserControllerTest.php`
- `fixture-php-wordpress-plugin`
  - plugin bootstrap file
  - namespaced class file
  - hook registration
  - test file if useful

### PHP Acceptance

- PHP fixtures activate `php` scanner.
- Composer/Laravel/WordPress markers appear in workspace profile.
- Namespaces/classes/functions/methods appear as symbols.
- `vendor/`, cache/build output, coverage, and generated artifacts are skipped.
- Handoff/export says PHP support is T1 structural.

## Phase 7C - Java/Kotlin T1 Hardening

### Required Work

- Improve Gradle and Maven multi-module detection:
  - root `settings.gradle`
  - root `settings.gradle.kts`
  - nested `build.gradle`
  - nested `build.gradle.kts`
  - parent/child `pom.xml`
- Improve source root detection:
  - `src/main/java`
  - `src/test/java`
  - `src/main/kotlin`
  - `src/test/kotlin`
  - Android-ish `app/src/main/java` and `app/src/main/kotlin` as T1/T2 where safe
- Improve dependency edges:
  - import to workspace class symbols
  - unresolved imports to external dependency nodes
  - test-to-SUT by package/class naming conventions
  - Gradle/Maven module dependencies where config is explicit
- Keep scanner tier honest:
  - no javac/kotlinc semantic claim
  - no guessed call graph

### Java/Kotlin Fixtures

Add or extend fixtures:

- `fixture-java-gradle-multimodule`
  - `settings.gradle`
  - `api/build.gradle`
  - `core/build.gradle`
  - project dependency from `api` to `core`
  - source and test files
- `fixture-kotlin-gradle`
  - `settings.gradle.kts`
  - `build.gradle.kts`
  - top-level functions
  - class methods
  - test file

### Java/Kotlin Acceptance

- Multi-module Gradle/Maven repos produce project/module communities.
- Imports resolve to workspace class symbols when possible.
- External imports produce explicit external dependency nodes instead of dangling edges.
- Top-level Kotlin functions are not parented to the previous class.
- `target/`, `build/`, `.gradle/`, and generated outputs are skipped.

## Phase 7D - Ecosystem Support Matrix

### Required Work

- Add a shared ecosystem support matrix that can be rendered in:
  - CLI diagnostics
  - `GRAPH_REPORT.md`
  - `.oag/wiki/index.md`
  - `.oag/graph.html` sidebar or risks area
  - `.oag/graph.json` export metadata
- Matrix fields:
  - ecosystem id
  - detected project type
  - active scanner id
  - support tier
  - semantic support yes/no
  - indexed file count
  - symbol count
  - relationship count
  - skipped/generated count
  - honest limitation text
- Keep copy ecosystem-neutral:
  - avoid TypeScript-specific warnings in non-TS repos
  - avoid implying T1 scanners are semantic
  - explain "structural" in user language

### Acceptance

- Mixed repos show one support row per active ecosystem.
- Docs-only repos show documentation mode, not "no code" as a failure.
- Unsupported repos show useful T3 diagnostics.
- `GRAPH_REPORT.md` helps an agent choose what to read first without overclaiming support depth.

## Phase 7E - Release Gates And Query Benchmarks

### Required Work

- Extend `verify:graph` fixture suite with Ruby, PHP, Java/Kotlin hardening fixtures.
- Add query benchmarks:
  - Rails controller/model route query
  - Ruby gem module/class query
  - Laravel controller/model route query
  - WordPress plugin hook/class query
  - Java Gradle module dependency query
  - Kotlin class/top-level function query
- Extend release gates:
  - no dangling edges
  - no generated/dependency output in read-first guidance
  - query success threshold remains at least 80 percent
  - misleading handoff rate remains 0 percent
  - scanner tier warning must appear for T1 ecosystems
- Add tests proving unsupported extensions are only removed after scanner support exists.

### Acceptance

- `npm run verify:graph` passes all old and new fixtures.
- `npm run verify:ci` passes.
- Query success remains at least 80 percent across the full fixture suite.
- Static exports stay safe:
  - no source bodies
  - script-safe JSON
  - no dangling explorer edges

## Expected Files To Touch

Likely shared:

- `packages/shared/src/sourceExtensions.ts`
- `packages/shared/src/codeGraph.ts`
- `packages/shared/src/graphEcosystemHealth.ts`
- `packages/shared/src/graphArtifacts.ts`
- `packages/shared/src/graphExportBundle.ts`
- `packages/shared/src/graphReleaseGates.ts`
- relevant shared tests

Likely backend:

- `packages/backend/src/scanner/scannerHygiene.ts`
- `packages/backend/src/scanner/kernel/ecosystemScanner.ts`
- `packages/backend/src/scanner/kernel/scannerRegistry.ts`
- `packages/backend/src/scanner/kernel/workspaceDetection.ts`
- `packages/backend/src/cli/verifyGraph.ts`
- relevant backend tests

Likely fixtures:

- `tests/fixtures/graph/fixture-ruby-rails`
- `tests/fixtures/graph/fixture-ruby-gem`
- `tests/fixtures/graph/fixture-php-laravel`
- `tests/fixtures/graph/fixture-php-wordpress-plugin`
- `tests/fixtures/graph/fixture-java-gradle-multimodule`
- `tests/fixtures/graph/fixture-kotlin-gradle`

Do not touch Pro folders.

## Verification Required

Run after each sub-phase:

```powershell
npm run build --workspace=packages/shared
npm run build --workspace=packages/backend
npm run verify:graph
git diff --check
```

Run before handoff:

```powershell
npm run verify:ci
```

For focused tests, run the relevant slices:

```powershell
npx vitest run packages/backend/src/scanner/kernel/ecosystemScanner.test.ts
npx vitest run packages/backend/src/scanner/scannerHygiene.test.ts
npx vitest run packages/backend/src/cli/verifyGraph.test.ts
npx vitest run packages/shared/src/graphReleaseGates.test.ts packages/shared/src/graphArtifacts.test.ts packages/shared/src/graphExportBundle.test.ts
```

## Handoff Requirements For Grok Composer

After each sub-phase, report:

- Files changed.
- What scanner tier changed and why.
- Fixtures added.
- Query benchmarks added.
- `npm run verify:graph` result.
- `npm run verify:ci` result when run.
- Any known gaps or intentionally deferred semantic work.

Do not say "semantic" unless compiler/AST-backed semantic behavior exists.
Do not say "done" unless verification commands were run and passed.
Do not commit or push.

## Completion Criteria

Phase 7 is complete only when:

- Ruby T1 structural support is implemented and fixture-gated.
- PHP T1 structural support is implemented and fixture-gated.
- Java/Kotlin T1 hardening is implemented and fixture-gated.
- Ecosystem support matrix appears in static outputs and/or graph export metadata.
- `verify:graph` includes the new long-tail fixtures.
- `verify:ci` passes.
- No Pro files or sibling scratch folders were touched.

## Deferred Work

These are not Phase 7:

- Full Ruby parser or runtime-aware Rails semantic graph.
- Full PHP parser or Composer autoload semantic graph.
- javac/kotlinc semantic analysis.
- Dashboard redesign.
- Native multi-agent scheduling.
- Provider/AI summarization.
- Any OpenAgentGraphPro feature merge.
