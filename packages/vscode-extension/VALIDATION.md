# OpenAgentGraph VS Code Shell Validation

Use this lightweight checklist before publishing or sharing the VSIX.

## Build and package

1. Run `npm run vscode:build` from the repo root.
2. Run `npm run package --workspace=packages/vscode-extension`.

## Install into an isolated VS Code profile

1. Install the VSIX:
   `code --install-extension packages/vscode-extension/openagentgraph-vscode-extension-0.0.1.vsix --force --user-data-dir <temp-user-data-dir> --extensions-dir <temp-extensions-dir>`
2. Create `<temp-user-data-dir>/User/settings.json` with:

```json
{
  "openagentgraph.apiBaseUrl": "https://example.test/api"
}
```

## Real host smoke check

1. Launch VS Code against this repo using the same isolated `--user-data-dir` and `--extensions-dir`.
2. Run `OpenAgentGraph: Open Panel` from the command palette.
3. Verify the OpenAgentGraph panel opens as a webview tab.
4. Verify the frontend loads instead of the missing-build fallback message.
5. Verify the configured backend base URL is still `openagentgraph.apiBaseUrl`.
6. Verify external links open through VS Code instead of the browser renderer handling them directly.
7. Verify export/save uses the VS Code host save flow.

## What automated tests already cover

- Webview HTML generation rewrites built frontend assets for VS Code safely.
- The shell bridge is injected as `vscode_webview`.
- The configured API base URL is passed into the bridge.
- External-link and save-file shell handlers stay behind the narrow extension-host boundary.
