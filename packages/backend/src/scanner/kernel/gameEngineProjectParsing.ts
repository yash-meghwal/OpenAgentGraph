export interface AsmdefMetadata {
  name?: string;
  references: string[];
}

export interface GodotProjectMetadata {
  projectName?: string;
  mainScene?: string;
  autoloads: Array<{ name: string; path: string }>;
}

export interface UnrealProjectMetadata {
  projectName?: string;
  modules: string[];
}

function extractIniSection(body: string, sectionName: string) {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${sectionName}]`);
  if (start < 0) return "";
  const sectionLines: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\[[^\]]+\]/.test(line.trim())) break;
    sectionLines.push(line);
  }
  return sectionLines.join("\n");
}

export function parseAsmdef(body: string): AsmdefMetadata {
  try {
    const parsed = JSON.parse(body) as { name?: string; references?: string[] };
    return {
      name: parsed.name,
      references: Array.isArray(parsed.references) ? parsed.references : [],
    };
  } catch {
    return { references: [] };
  }
}

export function parseGodotProject(body: string): GodotProjectMetadata {
  const projectName = body.match(/^config\/name="([^"]+)"/m)?.[1];
  const mainScene = body.match(/^run\/main_scene="([^"]+)"/m)?.[1];
  const autoloads: Array<{ name: string; path: string }> = [];
  for (const line of extractIniSection(body, "autoload").split("\n")) {
    const match = line.trim().match(/^([A-Za-z_]\w*)="\*?(res:\/\/[^"]+)"/);
    if (match) autoloads.push({ name: match[1]!, path: match[2]! });
  }
  return { projectName, mainScene, autoloads };
}

export function parseUnrealProject(body: string): UnrealProjectMetadata {
  try {
    const parsed = JSON.parse(body) as {
      Name?: string;
      Description?: string;
      Modules?: Array<{ Name?: string }>;
    };
    const modules = Array.isArray(parsed.Modules)
      ? parsed.Modules.map((module) => module.Name).filter((name): name is string => Boolean(name))
      : [];
    return {
      projectName: parsed.Name ?? parsed.Description,
      modules,
    };
  } catch {
    return { modules: [] };
  }
}

export function parseUnrealBuildCs(body: string) {
  const moduleName = body.match(/class\s+(\w+)\s*:\s*ModuleRules/)?.[1];
  const dependencies = new Set<string>();
  for (const match of body.matchAll(/PublicDependencyModuleNames\.Add\(\s*"([^"]+)"/g)) {
    dependencies.add(match[1]!);
  }
  for (const block of body.matchAll(/PublicDependencyModuleNames\.AddRange\(([\s\S]*?)\);/g)) {
    for (const match of block[1]!.matchAll(/"([^"]+)"/g)) {
      dependencies.add(match[1]!);
    }
  }
  return { moduleName, dependencies: [...dependencies] };
}