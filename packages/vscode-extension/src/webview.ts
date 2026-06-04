import fs from "fs";
import path from "path";

export interface FrontendAssetManifest {
  styleBlock: string;
  modulePreloads: string[];
  mainScript: string;
}

export interface WebviewAssetResolver {
  cspSource: string;
  asWebviewUri: (relativePath: string) => string;
}

export interface OpenAgentGraphWebviewConfig {
  apiBaseUrl: string;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function parseFrontendAssetManifest(indexHtml: string): FrontendAssetManifest {
  const styleBlockMatch = indexHtml.match(/<style>([\s\S]*?)<\/style>/i);
  const mainScriptMatch = indexHtml.match(
    /<script[^>]+type="module"[^>]+src="([^"]+)"[^>]*><\/script>/i
  );
  const modulePreloads = [...indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/gi)].map(
    (match) => match[1]
  );

  if (!mainScriptMatch) {
    throw new Error("OpenAgentGraph frontend build is missing its main module script.");
  }

  return {
    styleBlock: styleBlockMatch?.[1]?.trim() ?? "",
    modulePreloads,
    mainScript: mainScriptMatch[1],
  };
}

export function buildOpenAgentGraphWebviewHtml(
  assets: FrontendAssetManifest,
  resolver: WebviewAssetResolver,
  config: OpenAgentGraphWebviewConfig,
  nonce: string
): string {
  const preloadLinks = assets.modulePreloads
    .map(
      (href) =>
        `<link rel="modulepreload" crossorigin href="${escapeAttribute(
          resolver.asWebviewUri(href)
        )}">`
    )
    .join("\n    ");

  const bridgeScript = `
      (function () {
        const vscode = acquireVsCodeApi();
        let nextRequestId = 0;
        const pending = new Map();

        function invoke(command, payload) {
          return new Promise((resolve) => {
            const requestId = String(++nextRequestId);
            pending.set(requestId, resolve);
            vscode.postMessage({
              channel: "openagentgraph-shell:request",
              requestId,
              command,
              payload
            });
          });
        }

        window.addEventListener("message", (event) => {
          const message = event.data;
          if (!message || message.channel !== "openagentgraph-shell:response") {
            return;
          }
          const resolve = pending.get(message.requestId);
          if (!resolve) {
            return;
          }
          pending.delete(message.requestId);
          resolve(message.payload);
        });

        window.openagentgraphShell = {
          kind: "vscode_webview",
          platform: "webview",
          apiBaseUrl: '${escapeScriptString(config.apiBaseUrl)}',
          saveTextFile(input) {
            return invoke("saveTextFile", input);
          },
          openExternalLink(url) {
            return invoke("openExternalLink", { url });
          }
        };
      })();
    `.trim();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${resolver.cspSource} https: data:; style-src ${resolver.cspSource} 'unsafe-inline'; script-src ${resolver.cspSource} 'nonce-${nonce}'; font-src ${resolver.cspSource}; connect-src ${resolver.cspSource} https: http:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenAgentGraph</title>
    <style>
      ${assets.styleBlock}
    </style>
    ${preloadLinks}
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      ${bridgeScript}
    </script>
    <script
      nonce="${nonce}"
      type="module"
      crossorigin
      src="${escapeAttribute(resolver.asWebviewUri(assets.mainScript))}"
    ></script>
  </body>
</html>`;
}

export function loadFrontendAssetManifest(frontendDistDir: string): FrontendAssetManifest {
  const indexHtmlPath = path.join(frontendDistDir, "index.html");
  const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
  return parseFrontendAssetManifest(indexHtml);
}
