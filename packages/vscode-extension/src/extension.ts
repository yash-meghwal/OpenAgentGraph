import fs from "fs/promises";
import crypto from "crypto";
import path from "path";
import * as vscode from "vscode";
import {
  buildOpenAgentGraphWebviewHtml,
  loadFrontendAssetManifest,
} from "./webview.js";

const PANEL_ID = "openagentgraph.panel";
let currentPanel: vscode.WebviewPanel | undefined;

interface ShellRequestMessage {
  requestId: string;
  command: string;
  payload?: unknown;
}

interface ShellMessageContext {
  openExternal: (url: string) => Thenable<boolean>;
  showSaveDialog: (options: vscode.SaveDialogOptions) => Thenable<vscode.Uri | undefined>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  getWorkspaceFolderPath: () => string;
}

function getApiBaseUrl(): string {
  return vscode.workspace
    .getConfiguration("openagentgraph")
    .get<string>("apiBaseUrl", "http://127.0.0.1:3001")
    .trim();
}

function getFrontendDistPath(extensionUri: vscode.Uri): string {
  return path.resolve(extensionUri.fsPath, "webview-dist");
}

function createNonce(): string {
  return crypto.randomBytes(16).toString("base64").replace(/[^a-zA-Z0-9]/g, "");
}

export async function handleShellRequest(
  context: ShellMessageContext,
  panel: vscode.WebviewPanel,
  message: ShellRequestMessage
) {
  const respond = async (payload: unknown) => {
    await panel.webview.postMessage({
      channel: "openagentgraph-shell:response",
      requestId: message.requestId,
      payload,
    });
  };

  if (message.command === "openExternalLink") {
    const url =
      message.payload &&
      typeof message.payload === "object" &&
      "url" in message.payload &&
      typeof message.payload.url === "string"
        ? message.payload.url
        : "";

    if (!url) {
      await respond({ opened: false });
      return;
    }

    await context.openExternal(url);
    await respond({ opened: true });
    return;
  }

  if (message.command === "saveTextFile") {
    const payload = message.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      !("suggestedName" in payload) ||
      !("content" in payload)
    ) {
      await respond({ saved: false });
      return;
    }

    const suggestedName =
      typeof payload.suggestedName === "string" ? payload.suggestedName : "openagentgraph-export.txt";
    const content = typeof payload.content === "string" ? payload.content : "";
    const workspaceFolder = context.getWorkspaceFolderPath();

    const fileUri = await context.showSaveDialog({
      saveLabel: "Save OpenAgentGraph Export",
      defaultUri: vscode.Uri.file(path.join(workspaceFolder, suggestedName)),
      filters: {
        JSON: ["json"],
        Text: ["txt", "md"],
      },
    });

    if (!fileUri) {
      await respond({ saved: false });
      return;
    }

    await context.writeFile(fileUri.fsPath, content);
    await respond({ saved: true });
    return;
  }

  await respond({ opened: false, saved: false });
}

function createShellMessageContext(): ShellMessageContext {
  return {
    openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
    showSaveDialog: (options) => vscode.window.showSaveDialog(options),
    writeFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    getWorkspaceFolderPath: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
  };
}

async function renderOpenAgentGraphPanel(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel
) {
  const frontendDistPath = getFrontendDistPath(context.extensionUri);
  let indexExists = true;
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(path.join(frontendDistPath, "index.html")));
  } catch {
    indexExists = false;
  }

  if (!indexExists) {
    panel.webview.html = `<!doctype html>
<html lang="en">
  <body style="font-family: sans-serif; padding: 24px; color: #e2e8f0; background: #0f1117;">
    <h2 style="margin: 0 0 12px;">OpenAgentGraph</h2>
    <p style="margin: 0 0 8px;">The frontend build was not found for the VS Code shell.</p>
    <p style="margin: 0;">Run <code>npm run vscode:build</code> from the repo root, then reopen the panel.</p>
  </body>
</html>`;
    return;
  }

  const assets = loadFrontendAssetManifest(frontendDistPath);
  const nonce = createNonce();
  panel.webview.html = buildOpenAgentGraphWebviewHtml(
    assets,
    {
      cspSource: panel.webview.cspSource,
      asWebviewUri: (relativePath) =>
        panel.webview
          .asWebviewUri(vscode.Uri.file(path.join(frontendDistPath, relativePath.replace(/^\//, ""))))
          .toString(),
    },
    {
      apiBaseUrl: getApiBaseUrl(),
    },
    nonce
  );
}

async function openOpenAgentGraphPanel(context: vscode.ExtensionContext) {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    await renderOpenAgentGraphPanel(context, currentPanel);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    PANEL_ID,
    "OpenAgentGraph",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(getFrontendDistPath(context.extensionUri)),
      ],
    }
  );

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  });

  currentPanel.webview.onDidReceiveMessage(async (message) => {
    if (
      !message ||
      typeof message !== "object" ||
      !("channel" in message) ||
      message.channel !== "openagentgraph-shell:request" ||
      !("requestId" in message) ||
      typeof message.requestId !== "string" ||
      !("command" in message) ||
      typeof message.command !== "string"
    ) {
      return;
    }

    await handleShellRequest(createShellMessageContext(), currentPanel!, {
      requestId: message.requestId,
      command: message.command,
      payload: "payload" in message ? message.payload : undefined,
    });
  });

  await renderOpenAgentGraphPanel(context, currentPanel);
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("openagentgraph.openPanel", async () => {
      await openOpenAgentGraphPanel(context);
    })
  );
}

export function deactivate() {
  currentPanel = undefined;
}
