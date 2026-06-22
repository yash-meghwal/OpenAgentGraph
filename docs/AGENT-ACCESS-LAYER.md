# OpenAgentGraph 1.4 Agent Access Layer

OpenAgentGraph 1.4 adds adoption surfaces on top of the existing deterministic graph kernel. It does not replace the scanner, graph model, or static export architecture.

## Adoption paths

1. **Static artifacts** — `.oag/graph.json`, `.oag/graph.html`, `.oag/wiki/index.md`, `GRAPH_REPORT.md`
2. **CLI** — `graph:context`, `graph:query`, `graph:path`, `graph:explain`, `graph:check`, `graph:retrieve`, `graph:scorecard`
3. **MCP** — `npm run oag:mcp` exposes `oag_*` tools for Claude Desktop, Cursor, Codex, and other MCP clients
4. **Wrapper** — `npm run oag:wrap -- --goal "<task>" --workspace "<path>" --print`
5. **llms.txt** — compact agent orientation at repo root

## Guarantees

- No provider key for scans, exports, navigation, or gates
- No source bodies in CLI, MCP, or context outputs
- Redacted roots by default in shareable fields (`--redact-root`)
- Support tier honesty and provenance in every context pack
- Learn proposals are review-only (`graph:learn` never auto-edits instructions)

## Local memory contract

Agents may share these local artifacts without granting permissions:

- Context pack reads (`graph:context` / `oag_context`)
- Retrieval ids (`oag:node:*`, `oag:community:*`, `oag:doc:*`)
- Evidence and next-work proposals remain operator-gated in the base API

No leases, heartbeats, claims, or hosted coordination are added in 1.4.

## Verification

```bash
npm run verify:graph
npm run graph:scorecard -- --output docs/BENCHMARKS.md
npm run verify:ci
```