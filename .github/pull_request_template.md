## Summary


## Verification

- [ ] `npm run test --workspaces --if-present`
- [ ] `npm run build`
- [ ] `npm run vscode:build`
- [ ] `npm run gate:check -- --mode hard --allow-empty`
- [ ] `git diff --check`

## Safety checklist

- [ ] No API keys, bearer tokens, `.env` values, or secrets are committed.
- [ ] No source bodies are added to reports, graph scans, or public docs.
- [ ] Workspace writes stay path-safe and inside the configured workspace root.
- [ ] Provider-key-free graph, Code Map, Project Graph, and handoff workflows still work.
