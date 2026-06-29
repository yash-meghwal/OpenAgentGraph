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
oag doctor --workspace "<path>"
oag dogfood --workspace "<path>"
oag graph:export --workspace "<path>" --offline-only --redact-root
oag graph:query --workspace "<path>" --mode code "<query>"
oag graph:path --workspace "<path>" "<from>" "<to>"
oag graph:explain --workspace "<path>" "<node-or-file>"
oag graph:check --workspace "<path>"
oag graph:docs:check --workspace "<path>" --json --suggest
oag graph:context --workspace "<path>" --goal "<goal>" --include-verification --json
oag graph:scorecard --workspace "<path>" --agentic-sdlc --json
oag graph:learn --workspace "<path>" --json
oag graph:retrieve --workspace "<path>" --id "oag:node:<id>" --json
oag graph:update --workspace "<path>"
```

`graph:query --mode` accepts `code`, `docs`, or `balanced`. No provider key is required for any graph command.

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
