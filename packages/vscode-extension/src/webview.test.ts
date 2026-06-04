import { describe, expect, it } from "vitest";
import {
  buildOpenAgentGraphWebviewHtml,
  parseFrontendAssetManifest,
} from "./webview.js";

describe("OpenAgentGraph VS Code webview host", () => {
  it("parses the built frontend asset manifest from index html", () => {
    const assets = parseFrontendAssetManifest(`<!doctype html>
<html>
  <head>
    <style>body { background: #0f1117; }</style>
    <link rel="modulepreload" crossorigin href="/assets/three.js">
    <script type="module" crossorigin src="/assets/index.js"></script>
  </head>
</html>`);

    expect(assets).toEqual({
      styleBlock: "body { background: #0f1117; }",
      modulePreloads: ["/assets/three.js"],
      mainScript: "/assets/index.js",
    });
  });

  it("builds a webview-safe html shell with a vscode bridge and rewritten asset uris", () => {
    const html = buildOpenAgentGraphWebviewHtml(
      {
        styleBlock: "body { background: #0f1117; }",
        modulePreloads: ["/assets/three.js"],
        mainScript: "/assets/index.js",
      },
      {
        cspSource: "vscode-webview-resource://openagentgraph",
        asWebviewUri: (relativePath) => `vscode-webview-resource://openagentgraph${relativePath}`,
      },
      {
        apiBaseUrl: "http://127.0.0.1:3001",
      },
      "nonce123"
    );

    expect(html).toContain(`window.openagentgraphShell = {`);
    expect(html).toContain(`kind: "vscode_webview"`);
    expect(html).toContain(`apiBaseUrl: 'http://127.0.0.1:3001'`);
    expect(html).toContain(`vscode-webview-resource://openagentgraph/assets/index.js`);
    expect(html).toContain(`vscode-webview-resource://openagentgraph/assets/three.js`);
    expect(html).toContain(`script-src vscode-webview-resource://openagentgraph 'nonce-nonce123'`);
  });
});
