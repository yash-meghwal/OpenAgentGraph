export interface RubyGemfileMetadata {
  gems: string[];
}

export interface RubyGemspecMetadata {
  packageName?: string;
  dependencies: string[];
}

export function parseGemfile(body: string): RubyGemfileMetadata {
  const gems = new Set<string>();
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^gem\s+['"]([^'"]+)['"]/);
    if (match) gems.add(match[1]!);
  }
  return { gems: [...gems].sort((left, right) => left.localeCompare(right)) };
}

export function parseGemspec(body: string): RubyGemspecMetadata {
  const packageName = body.match(/s\.name\s*=\s*['"]([^'"]+)['"]/)?.[1];
  const dependencies = new Set<string>();
  for (const match of body.matchAll(/add_(?:(?:runtime|development)_)?dependency\s+['"]([^'"]+)['"]/g)) {
    dependencies.add(match[1]!);
  }
  return {
    packageName,
    dependencies: [...dependencies].sort((left, right) => left.localeCompare(right)),
  };
}

export interface RailsRouteTarget {
  controllerName: string;
  actionName?: string;
  resource?: string;
}

export function railsControllerPath(controllerName: string) {
  const normalized = controllerName.includes("_")
    ? controllerName
    : `${controllerName}_controller`;
  return `app/controllers/${normalized}.rb`;
}

export function parseRailsRouteTargets(body: string): RailsRouteTarget[] {
  const targets: RailsRouteTarget[] = [];
  const seen = new Set<string>();

  const record = (controllerName: string, actionName: string | undefined, resource?: string) => {
    const key = `${controllerName}|${actionName ?? ""}|${resource ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ controllerName, actionName, resource });
  };

  for (const match of body.matchAll(/to:\s*['"](\w+)#(\w+)['"]/g)) {
    record(match[1]!, match[2]!);
  }

  for (const match of body.matchAll(/resources\s+:(\w+)/g)) {
    const resource = match[1]!;
    record(resource, "index", resource);
  }

  return targets;
}