import electron from "electron";

const { contextBridge, ipcRenderer } = electron;

function readBackendUrl(): string | undefined {
  const prefix = "--openagentgraph-backend-url=";
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

contextBridge.exposeInMainWorld("openagentgraphShell", {
  kind: "electron",
  platform: "desktop",
  apiBaseUrl: readBackendUrl(),
  saveTextFile: (input: {
    suggestedName: string;
    content: string;
    mimeType: string;
  }) => ipcRenderer.invoke("openagentgraph-shell:save-text-file", input),
  openExternalLink: async () => ({ opened: false }),
});
