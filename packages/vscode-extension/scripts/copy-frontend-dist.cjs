const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const sourceDir = path.resolve(packageRoot, "..", "frontend", "dist");
const targetDir = path.resolve(packageRoot, "webview-dist");
const textAssetExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt"]);

function copyFile(sourcePath, targetPath) {
  if (!textAssetExtensions.has(path.extname(sourcePath).toLowerCase())) {
    fs.copyFileSync(sourcePath, targetPath);
    return;
  }

  const content = fs.readFileSync(sourcePath, "utf8").replace(/\r+\n/g, "\n").replace(/\r/g, "\n");
  fs.writeFileSync(targetPath, content, "utf8");
}

function copyDirectory(sourcePath, targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    const sourceEntryPath = path.join(sourcePath, entry.name);
    const targetEntryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourceEntryPath, targetEntryPath);
      continue;
    }
    copyFile(sourceEntryPath, targetEntryPath);
  }
}

if (!fs.existsSync(sourceDir)) {
  throw new Error(
    `OpenAgentGraph frontend build not found at ${sourceDir}. Run "npm run build --workspace=packages/frontend" first.`
  );
}

fs.rmSync(targetDir, { recursive: true, force: true });
copyDirectory(sourceDir, targetDir);
console.log(`Copied frontend webview assets to ${targetDir}`);
