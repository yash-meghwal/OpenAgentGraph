import electron from "electron";

console.log(
  JSON.stringify({
    kind: "esm",
    execPath: process.execPath,
    electronVersion: process.versions.electron ?? null,
    electronType: typeof electron,
    electronValue:
      typeof electron === "string"
        ? electron
        : Object.keys(electron).slice(0, 10),
    hasApp: typeof electron?.app,
    hasWhenReady: typeof electron?.app?.whenReady,
  })
);

if (electron?.app?.whenReady) {
  electron.app.whenReady().then(() => {
    console.log("esm-when-ready");
    electron.app.quit();
  });
}
