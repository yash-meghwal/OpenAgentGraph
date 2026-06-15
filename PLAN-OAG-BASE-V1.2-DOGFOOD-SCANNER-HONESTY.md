# OpenAgentGraph Base v1.2 Dogfood + Scanner Honesty Patch

## Summary
Grok Composer should implement this only in the base repo at `C:\Users\yashm\Desktop\promptvector`. Codex will supervise by reviewing diffs, running verification, fixing any release blockers, and handling any commit/push. This patch makes base OAG more useful on real non-TS projects without merging Pro features.

Primary outcome: OAG base should honestly detect project type, skip generated noise, index C#/.NET files at file/symbol level, and provide a one-command dogfood path that writes a trustworthy `GRAPH_REPORT.md`.

## Grok Composer Rules
- Work only in `C:\Users\yashm\Desktop\promptvector`.
- Do not read, edit, copy from, commit, or reference `C:\Users\yashm\Desktop\OpenAgentGraphPro` or any `OpenAgentGraphPro*` folder.
- Do not commit, push, tag, publish, or create GitHub releases.
- Treat `OAGimprovement/` as planning input only; do not commit it unless explicitly asked.
- Keep base lightweight: no Pro wizard, no Pro launcher UI, no V2 scheduling, no agent marketplace, no provider-key requirement.
- Start by reading `OAGimprovement/*.md`, `README.md`, `LLMS.md`, the Product Graph scanner, and Project Graph route.

## Key Changes
- Add a shared scanner hygiene/profile layer:
  - Centralize generated-directory skipping for Product Graph and Project Graph.
  - Add skips for common real-project output folders: `bin`, `obj`, `.vs`, `vendor`, `Pods`, `DerivedData`, `.gradle`, `target`, `graphify-out`, and similar cache/build outputs.
  - Detect workspace markers such as `.sln`, `.csproj`, `package.json`, and `tsconfig*.json`.
  - Expose scan diagnostics: detected project types, marker paths, source extension counts, skipped folder counts, and coverage warnings.

- Improve base scanner coverage without adding heavy language engines:
  - Product Graph should index `.cs`, `.csproj`, `.sln`, `.xaml`, `.props`, and `.targets` as file/config graph nodes.
  - Extract basic C# top-level symbols with a lightweight bounded parser or regex: class, interface, enum, struct, record.
  - Do not persist source bodies.
  - TypeScript/JavaScript semantic analysis remains unchanged.
  - For C#/.NET, report "file-level indexing only; semantic edges unsupported in base v1.2."

- Improve Project Graph usefulness:
  - Include C#/.NET files in structural graph output.
  - Classify `.cs` and `.xaml` as source-like files, and `.sln`, `.csproj`, `.props`, `.targets` as config/project files.
  - Ensure `bin`/`obj` and generated folders do not dominate graph counts.
  - Make scan POST endpoints tolerate an empty body and missing `Content-Type`.

- Add base dogfood command:
  - Add `npm run dogfood -- --workspace "<absolute path>"`.
  - Implement it as a backend CLI, not a Pro UI feature.
  - Use isolated OAG data under the base repo, for example `.tmp-dogfood-data/<workspace-hash>`, and add that folder to `.gitignore`.
  - Run a Product Graph scan for the target workspace, print counts/diagnostics, and write `GRAPH_REPORT.md` into the target workspace root.
  - Handle Windows paths with spaces.

- Update handoff/reporting/docs:
  - `GRAPH_REPORT.md` should include workspace profile, scanner coverage, skipped generated folders, and honest warnings for unsupported semantic languages.
  - `README.md`, `LLMS.md`, and function docs should explain that graph scans and handoff are no-key, deterministic, and honest about coverage.
  - Agents should be instructed to trust OAG for indexed areas, but inspect source directly when the report says coverage is partial or file-level only.

## Test Plan
- Scanner tests:
  - Generated folders like `bin`, `obj`, and `graphify-out` are skipped.
  - `.sln`, `.csproj`, `.cs`, `.xaml`, `.props`, `.targets` are detected.
  - Basic C# symbols are extracted without persisting source bodies.
  - TypeScript/JavaScript scanner behavior remains unchanged.
  - C# projects produce clear "file-level only" diagnostics, not semantic failures.

- Project Graph tests:
  - C#/.NET files appear in structural graph output.
  - Build/output folders do not create noisy graph nodes.
  - Empty scan POST requests work without requiring `Content-Type`.

- Handoff and CLI tests:
  - Handoff includes language coverage warnings and skipped-folder counts.
  - Handoff never includes source bodies or secrets.
  - `npm run dogfood -- --workspace "<path with spaces>"` writes `GRAPH_REPORT.md` to the target workspace and uses isolated local data.
  - Dogfood fails clearly when workspace path is missing or invalid.

- Verification Grok must run before handing back:
  - `npx vitest run packages/backend/src/scanner/codeScanner.test.ts packages/backend/src/routes/projectGraph.test.ts packages/shared/src/productGraph.test.ts`
  - `npx tsc --noEmit --pretty false -p packages/backend/tsconfig.json`
  - `npm run verify:ci`
  - `git diff --check`
  - `git status --short`

## Codex Supervision
- Codex will review Grok's diff as senior developer:
  - Confirm no `OpenAgentGraphPro` files were touched.
  - Confirm no generated dogfood data, `GRAPH_REPORT.md`, secrets, `.db`, `.env`, or scratch files are staged.
  - Run `npm run verify:ci` independently.
  - Run targeted searches for Pro leakage and legacy/static-tool wording if needed.
  - Fix only real blockers or small polish issues.
  - Commit/push only after the review is clean.

## Assumptions
- This is base OAG v1.2 work, not Pro.
- Full C# semantic/Roslyn support is out of scope for this patch.
- No AI provider key is required.
- OAG remains deterministic and lightweight.
- Grok implements locally; Codex owns final review and GitHub actions.
- Skills used: `typescript-pro`, `backend-dev-guidelines`.
- Work completed: 100% planning only.
