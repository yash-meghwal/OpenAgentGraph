export function normalizeGradleModuleName(raw: string) {
  const trimmed = raw.trim();
  return trimmed.startsWith(":") ? trimmed.slice(1) : trimmed;
}

export function gradleModuleNameToDirectory(moduleName: string) {
  return moduleName.replace(/:/g, "/");
}

function collectGradleModuleNames(moduleNames: Set<string>, text: string) {
  for (const match of text.matchAll(/['"]:?([^'"]+)['"]/g)) {
    const normalized = normalizeGradleModuleName(match[1]!);
    if (normalized) moduleNames.add(normalized);
  }
}

export function parseGradleSettingsIncludes(body: string) {
  const moduleNames = new Set<string>();

  for (const block of body.matchAll(/include\s*\(([\s\S]*?)\)/g)) {
    collectGradleModuleNames(moduleNames, block[1]!);
  }

  for (const includeLine of body.match(/^include\b(?!\s*\()[^\n]*$/gm) ?? []) {
    collectGradleModuleNames(moduleNames, includeLine);
  }

  return [...moduleNames];
}