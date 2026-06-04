export type OpenAgentGraphShellKind = "browser" | "electron" | "vscode_webview";
export type OpenAgentGraphShellPlatform = "web" | "desktop" | "webview";

export interface SaveTextFileInput {
  suggestedName: string;
  content: string;
  mimeType: string;
}

export interface SaveTextFileResult {
  saved: boolean;
}

export interface OpenExternalLinkResult {
  opened: boolean;
}

export interface OpenAgentGraphShellBridge {
  kind: OpenAgentGraphShellKind;
  platform: OpenAgentGraphShellPlatform;
  apiBaseUrl?: string;
  saveTextFile: (input: SaveTextFileInput) => Promise<SaveTextFileResult>;
  openExternalLink: (url: string) => Promise<OpenExternalLinkResult>;
}

function buildBrowserShellBridge(): OpenAgentGraphShellBridge {
  return {
    kind: "browser",
    platform: "web",
    apiBaseUrl: undefined,
    saveTextFile: async ({ suggestedName, content, mimeType }) => {
      if (typeof document === "undefined" || typeof URL === "undefined") {
        return { saved: false };
      }
      const blob = new Blob([content], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = suggestedName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      return { saved: true };
    },
    openExternalLink: async (url) => {
      if (typeof window === "undefined") {
        return { opened: false };
      }
      window.open(url, "_blank", "noopener,noreferrer");
      return { opened: true };
    },
  };
}

export function resolveRuntimeShell(
  candidate?: Partial<OpenAgentGraphShellBridge> | undefined
): OpenAgentGraphShellBridge {
  const browserShell = buildBrowserShellBridge();
  if (
    !candidate ||
    (candidate.kind !== "electron" && candidate.kind !== "vscode_webview")
  ) {
    return browserShell;
  }

  return {
    kind: candidate.kind,
    platform: candidate.platform ?? "desktop",
    apiBaseUrl: candidate.apiBaseUrl,
    saveTextFile: candidate.saveTextFile ?? browserShell.saveTextFile,
    openExternalLink: candidate.openExternalLink ?? browserShell.openExternalLink,
  };
}

const shellCandidate =
  typeof window !== "undefined" ? window.openagentgraphShell : undefined;

export const runtimeShell = resolveRuntimeShell(shellCandidate);

declare global {
  interface Window {
    openagentgraphShell?: OpenAgentGraphShellBridge;
  }
}
