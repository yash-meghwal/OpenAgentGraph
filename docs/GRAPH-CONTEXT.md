# graph:context

`graph:context` produces a bounded, agent-ready context pack from a workspace.

## Usage

```bash
npm run graph:context -- --workspace "<path>" --goal "fix auth bug" --lens backend-runtime --budget 12000 --json
```

## Output includes

- Workspace summary and support matrix
- Analyzer status and graph freshness
- Read-first nodes with retrieval ids
- Community hubs and relevant docs
- Suggested `graph:query` and `graph:path` commands
- Provenance/trust summary and risks
- Retrieval hints for deeper lookups

## Safety

- No source bodies
- Bounded lists enforced by `--budget` (default 12000 characters)
- `--redact-root` hides absolute workspace paths in shareable fields
- Uses cached `.oag/graph.json` when available; pass `--refresh` to rescan

## Related

- `graph:retrieve --id oag:node:<id>` for deeper neighborhoods
- `oag_context` MCP tool for the same pack in MCP clients