# OAG MCP Server

The OAG MCP server exposes deterministic graph navigation to MCP clients over stdio.

## Start

```bash
npm run oag:mcp
```

## Claude Desktop example

```json
{
  "mcpServers": {
    "openagentgraph": {
      "command": "npm",
      "args": ["run", "oag:mcp"],
      "cwd": "/absolute/path/to/openagentgraph"
    }
  }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `oag_export` | Export or refresh `.oag/*` and `GRAPH_REPORT.md` |
| `oag_query` | Bounded graph query |
| `oag_path` | Ranked path between targets |
| `oag_explain` | Node/file explanation |
| `oag_check` | Fusion gates and support matrix |
| `oag_context` | Bounded agent context pack |
| `oag_retrieve` | Lookup by `oag:*` retrieval id |

## Safety

- Workspace paths must resolve to a local directory; export artifact writes are constrained to that workspace root
- Responses are bounded and never include source bodies
- `oag_export` is the only tool that writes files (into `.oag/` and `GRAPH_REPORT.md`)
- Missing `.oag/graph.json` responses suggest running `oag_export`
