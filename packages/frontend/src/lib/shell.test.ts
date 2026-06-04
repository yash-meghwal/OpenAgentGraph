import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRuntimeShell } from "./shell.js";

describe("runtime shell bridge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to a safe browser shell when no desktop shell is present", async () => {
    const createObjectURL = vi.fn(() => "blob:report");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    const open = vi.fn();

    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });
    vi.stubGlobal("window", {
      open,
    });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ click })),
    });

    const shell = resolveRuntimeShell(undefined);
    const result = await shell.saveTextFile({
      suggestedName: "report.json",
      content: "{\"ok\":true}",
      mimeType: "application/json",
    });

    expect(shell.kind).toBe("browser");
    expect(result).toEqual({ saved: true });
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:report");

    const opened = await shell.openExternalLink("https://openagentgraph.dev");
    expect(opened).toEqual({ opened: true });
    expect(open).toHaveBeenCalledWith(
      "https://openagentgraph.dev",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("preserves a narrow electron shell contract when one is provided", async () => {
    const saveTextFile = vi.fn().mockResolvedValue({ saved: true });

    const shell = resolveRuntimeShell({
      kind: "electron",
      platform: "desktop",
      apiBaseUrl: "http://127.0.0.1:3001",
      saveTextFile,
    });

    const result = await shell.saveTextFile({
      suggestedName: "report.json",
      content: "{}",
      mimeType: "application/json",
    });

    expect(shell.kind).toBe("electron");
    expect(shell.apiBaseUrl).toBe("http://127.0.0.1:3001");
    expect(result).toEqual({ saved: true });
    expect(saveTextFile).toHaveBeenCalledTimes(1);
  });

  it("preserves a narrow vscode webview shell contract when one is provided", async () => {
    const openExternalLink = vi.fn().mockResolvedValue({ opened: true });

    const shell = resolveRuntimeShell({
      kind: "vscode_webview",
      platform: "webview",
      apiBaseUrl: "http://127.0.0.1:3001",
      openExternalLink,
    });

    const result = await shell.openExternalLink("https://openagentgraph.dev/docs");

    expect(shell.kind).toBe("vscode_webview");
    expect(shell.platform).toBe("webview");
    expect(shell.apiBaseUrl).toBe("http://127.0.0.1:3001");
    expect(result).toEqual({ opened: true });
    expect(openExternalLink).toHaveBeenCalledWith("https://openagentgraph.dev/docs");
  });
});
