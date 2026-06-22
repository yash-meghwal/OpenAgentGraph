# @openagentgraph/cli

Public npm CLI facade for OpenAgentGraph static graph workflows.

## Requirements

- Node.js >= 20.19.0
- Optional .NET SDK for Roslyn-backed C# symbol extraction
- No provider key required

## Install

```bash
npm install -g @openagentgraph/cli
```

## Commands

```bash
oag graph:export --workspace "<path>" --offline-only --redact-root
oag graph:query --workspace "<path>" "<query>"
oag graph:path --workspace "<path>" "<from>" "<to>"
oag graph:explain --workspace "<path>" "<node-or-file>"
oag graph:check --workspace "<path>"
oag graph:docs:check --workspace "<path>" --json
oag graph:context --workspace "<path>" --goal "<goal>"
```

## Local development

From the monorepo root:

```bash
npm run build --workspace=packages/shared
npm run build --workspace=packages/backend
npm run build --workspace=packages/cli
node packages/cli/dist/bin.js --help
```

## Packaging status

`npm pack --dry-run` and clean-install smoke tests are covered by the package test suite. The CLI depends on the matching `@openagentgraph/backend` and `@openagentgraph/shared` package versions.
