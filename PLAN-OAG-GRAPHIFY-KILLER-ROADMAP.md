# OpenAgentGraph Base: Graphify-Killer Roadmap

## Mission
Make OpenAgentGraph base beat Graphify as a universal project-orientation tool while keeping OAG's extra strengths: live graphs, deterministic handoffs, run evidence, agent context, gates, and no-provider-key scans.

Target repo only: `C:\Users\yashm\Desktop\promptvector`.
Do not touch `OpenAgentGraphPro`, `OpenAgentGraphPro-*`, export folders, or Pro plans.
Grok implements locally only. Codex reviews, verifies, commits, and pushes.

## Current State
V1.2 already covers the first dogfood pain:
- `npm run dogfood -- --workspace "<path>"`
- generated folder skips: `bin`, `obj`, `.vs`, `.tmp-dogfood-data`, etc.
- C#/.NET file and top-level symbol indexing
- honest "file-level only" warnings
- empty scan POST body support
- improved `GRAPH_REPORT.md` trust/coverage notes

Do not redo that work. Build forward from it.

## Phase 1 - Universal Scanner Kernel
Goal: replace ad hoc extension lists with a real scanner platform.

Key work:
- Add a scanner registry with declared capabilities: project detection, file discovery, symbols, deps, tests, semantic support, handoff sections.
- Centralize ignore handling: global skips + `.gitignore` + `.dockerignore` + optional `.oagignore`.
- Add diagnostics explaining why files were skipped: global, gitignore, breaker, unsupported, too large.
- Add workspace detection for wrapper layouts: detect nested real roots via `.sln`, `package.json`, `Cargo.toml`, `pyproject.toml`, etc.
- Add a unified code graph model that every scanner emits into: workspace, project, package, file, symbol, test, asset, route, command, community, god-node.
- Add `npm run verify:graph -- --fixtures tests/fixtures/graph`.

Acceptance:
- OAG never silently produces misleading handoffs.
- Ignored/generated files do not dominate reports.
- Mixed repos can activate multiple scanners.

## Phase 2 - C#/.NET T0 Scanner
Goal: beat Graphify on SampleMediaPlayer-style C# repos.

Key work:
- Add a Roslyn-backed scanner or safe out-of-process `.NET` scanner helper.
- Index solution/project topology: `.sln`, `.csproj`, project references, target frameworks.
- Index namespaces, classes, interfaces, records, structs, enums, methods, properties, events.
- Add WPF/XAML relationships: XAML file to code-behind, View to ViewModel naming links.
- Add `using`, project-reference, test, entrypoint, service, and command edges.
- Add SampleMediaPlayer fixture/dogfood acceptance.

Acceptance:
- Dogfood on SampleMediaPlayer shows `MainViewModel`, `SampleMediaPlayer.Core`, app/test projects.
- Zero `bin/Debug/libvlc` paths in "read first."
- C# symbol coverage is at least 90% of Graphify's useful symbol coverage.

## Phase 3 - Graphify-Parity CLI And Exports
Goal: agents can query OAG like they used Graphify.

Add commands:
- `npm run graph:query -- "how does auth work?"`
- `npm run graph:path -- "frontend button to backend route"`
- `npm run graph:explain -- <node-or-file>`
- `npm run graph:export -- --json --html --wiki`

Outputs:
- `<workspace>/.oag/graph.json`
- `<workspace>/.oag/graph.html`
- `<workspace>/.oag/wiki/index.md`
- `<workspace>/GRAPH_REPORT.md`

Handoff must include:
- source trust
- project type and language coverage
- read-these-first
- communities/god-nodes
- dependency health
- tests/entrypoints/commands
- warnings when support is partial

## Phase 4 - Ecosystem Coverage Matrix
Goal: every project type gets at least honest T3 support, important types get T0/T1.

Tier rules:
- T0: AST/semantic symbols, deps, tests, communities, query.
- T1: file/coarse symbols/imports/communities.
- T2: file/config/asset map with useful warnings.
- T3: detect type and produce honest unsupported handoff.

Implement by priority:
- TS/JS monorepos, React/Next/Vue/Angular/Svelte, Node/Fastify/Express
- Python, Django, FastAPI, ML notebooks
- Go modules
- Rust crates/workspaces
- Java/Kotlin/Android
- Swift/iOS/macOS
- Flutter and React Native
- PHP WordPress/Laravel
- C/C++/embedded
- Unity/Unreal/Godot
- Solidity/Web3
- Terraform/Pulumi/K8s/Docker/Ansible
- Shell/PowerShell automation
- SQL/database projects
- Docs-only knowledge repos
- Design/media asset repos
- Mixed polyglot and empty/greenfield repos

## Phase 5 - Task Lenses And Visualization
Goal: broad graph underneath, task-specific orientation on top.

Add deterministic lenses:
- frontend
- backend/runtime
- tests
- provider/AI
- docs/handoff
- infra
- database
- desktop/mobile
- game/assets
- security

Improve UI:
- community cards
- god-node summaries
- filter by project type/language/lens
- graph health badges
- query/path/explain panels
- progress and skipped-file diagnostics visible without noise

Keep base operational and dense. No Pro supervisor wizard.

## Phase 6 - OAG-Only Advantage
Goal: beat Graphify, not just clone it.

Connect code graph to:
- run graph evidence
- current/previous agent work
- accepted plans
- failed commands
- test evidence
- Product Graph quality gates
- agent context/frontier APIs

Add checks:
- stale handoff warning
- code intent drift
- missing test evidence
- source graph coverage regression
- unsupported-language risk

## Phase 7 - Benchmarks And Release Gates
Create fixture suite:
- `fixture-csharp-media-player`
- `fixture-csharp-wpf`
- `fixture-next-app`
- `fixture-python-django`
- `fixture-go-module`
- `fixture-rust-workspace`
- `fixture-terraform`
- `fixture-mixed-polyglot`
- `fixture-docs-only`
- `fixture-empty`

Success metrics:
- misleading handoff rate: 0%
- generated/build junk in read-first: 0
- dogfood setup: under 5 minutes on Windows
- agent first-query success: 80%+ without grep
- SampleMediaPlayer C# useful symbol coverage: 90%+ of Graphify
- all graph fixture tests green in CI

## Grok Work Protocol
1. Read all three `OAGimprovement/*.md` files first.
2. Read current scanner, project graph, handoff, dogfood CLI, and docs.
3. Implement one phase at a time.
4. Start with Phase 1 only.
5. Do not commit, push, tag, publish, or touch Pro.
6. Run:
   - `npm run verify:ci`
   - focused scanner tests
   - `git diff --check`
   - `git status --short`
7. Report changed files, commands run, pass/fail output, and remaining gaps.

## Skills Used For Planning
- `typescript-pro` - scanner/plugin/type architecture planning.
- `backend-dev-guidelines` - backend CLI/API/scanner reliability planning.
- `frontend-dev-guidelines` - graph UI/lens/visualization planning.

Work completed: 100% planning only.
