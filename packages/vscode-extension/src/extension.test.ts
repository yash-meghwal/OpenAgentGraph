import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    file: (filePath: string) => ({ fsPath: filePath }),
  },
}));

function createPanelSpy() {
  const postMessage = vi.fn().mockResolvedValue(undefined);
  return {
    panel: {
      webview: {
        postMessage,
      },
    },
    postMessage,
  };
}

describe("OpenAgentGraph VS Code shell actions", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("opens external links through the narrow shell handler", async () => {
    const { handleShellRequest } = await import("./extension.js");
    const { panel, postMessage } = createPanelSpy();
    const openExternal = vi.fn().mockResolvedValue(true);

    await handleShellRequest(
      {
        openExternal,
        showSaveDialog: vi.fn(),
        writeFile: vi.fn(),
        getWorkspaceFolderPath: () => "C:\\workspace",
      },
      panel as never,
      {
        requestId: "1",
        command: "openExternalLink",
        payload: { url: "https://example.com/docs" },
      }
    );

    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
    expect(postMessage).toHaveBeenCalledWith({
      channel: "openagentgraph-shell:response",
      requestId: "1",
      payload: { opened: true },
    });
  });

  it("saves exported text through the shell handler", async () => {
    const { handleShellRequest } = await import("./extension.js");
    const { panel, postMessage } = createPanelSpy();
    const showSaveDialog = vi
      .fn()
      .mockResolvedValue({ fsPath: "C:\\workspace\\openagentgraph-report.json" });
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await handleShellRequest(
      {
        openExternal: vi.fn(),
        showSaveDialog,
        writeFile,
        getWorkspaceFolderPath: () => "C:\\workspace",
      },
      panel as never,
      {
        requestId: "2",
        command: "saveTextFile",
        payload: {
          suggestedName: "openagentgraph-report.json",
          content: "{\"status\":\"ok\"}",
        },
      }
    );

    expect(showSaveDialog).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(
      "C:\\workspace\\openagentgraph-report.json",
      "{\"status\":\"ok\"}"
    );
    expect(postMessage).toHaveBeenCalledWith({
      channel: "openagentgraph-shell:response",
      requestId: "2",
      payload: { saved: true },
    });
  });
});
