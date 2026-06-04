const electron = require("electron");

console.log(JSON.stringify({
  kind: "cjs",
  execPath: process.execPath,
  electronVersion: process.versions.electron ?? null,
  electronType: typeof electron,
  electronValue:
    typeof electron === "string"
      ? electron
      : Object.keys(electron).slice(0, 10),
  hasApp: typeof electron?.app,
  hasWhenReady: typeof electron?.app?.whenReady,
}));

if (electron?.app?.whenReady) {
  electron.app.whenReady().then(() => {
    console.log("cjs-when-ready");
    electron.app.quit();
  });
}
