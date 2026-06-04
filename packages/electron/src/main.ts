import path from "path";
import electron from "electron";
import fs from "fs/promises";
import { spawn, type ChildProcess } from "child_process";
import { resolveElectronShellRuntime } from "./runtime.js";

const { app, BrowserWindow, dialog, ipcMain } = electron;
const electronDistDir = __dirname;
const runtime = resolveElectronShellRuntime({
  electronDistDir,
  env: process.env,
});

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let backendProcess: ChildProcess | null = null;
const smokeTestMode = process.env.OPENAGENTGRAPH_ELECTRON_SMOKE_TEST === "true";

async function waitForBackend(backendUrl: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${backendUrl}/health`);
      if (response.ok) return;
    } catch {
      // Keep retrying until the shell timeout is reached.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function startBundledBackend() {
  if (!runtime.shouldSpawnBackend || backendProcess) return;
  backendProcess = spawn(runtime.nodeBinary, [runtime.backendEntryPath], {
    env: {
      ...process.env,
      PORT: new URL(runtime.backendUrl).port,
    },
    stdio: "inherit",
  });

  backendProcess.on("exit", () => {
    backendProcess = null;
  });
}

function registerShellIpc() {
  ipcMain.handle(
    "openagentgraph-shell:save-text-file",
    async (
      _event: unknown,
      input: { suggestedName: string; content: string; mimeType: string }
    ) => {
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, {
            defaultPath: input.suggestedName,
          })
        : await dialog.showSaveDialog({
            defaultPath: input.suggestedName,
          });
      if (result.canceled || !result.filePath) {
        return { saved: false };
      }
      await fs.writeFile(result.filePath, input.content, "utf8");
      return { saved: true };
    }
  );
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: runtime.preloadPath,
      additionalArguments: runtime.additionalArguments,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (runtime.rendererUrl) {
    await mainWindow.loadURL(runtime.rendererUrl);
  } else {
    await mainWindow.loadFile(runtime.frontendIndexPath);
  }

  if (smokeTestMode) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        app.quit();
      }, 250);
    });
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
}

app.whenReady().then(async () => {
  registerShellIpc();
  startBundledBackend();
  await waitForBackend(runtime.backendUrl);
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  backendProcess?.kill();
});
