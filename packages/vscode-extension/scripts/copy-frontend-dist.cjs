const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const sourceDir = path.resolve(packageRoot, "..", "frontend", "dist");
const targetDir = path.resolve(packageRoot, "webview-dist");

function copyDirectory(sourcePath, targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    const sourceEntryPath = path.join(sourcePath, entry.name);
    const targetEntryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourceEntryPath, targetEntryPath);
      continue;
    }
    fs.copyFileSync(sourceEntryPath, targetEntryPath);
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
