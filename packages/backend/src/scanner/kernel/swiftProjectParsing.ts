export interface SwiftPackageMetadata {
  packageName?: string;
  products: string[];
}

export function parseSwiftPackageManifest(body: string): SwiftPackageMetadata {
  const packageName = body.match(/name:\s*"([^"]+)"/)?.[1];
  const products = new Set<string>();
  for (const match of body.matchAll(/\.product\(name:\s*"([^"]+)"/g)) {
    products.add(match[1]!);
  }
  return {
    packageName,
    products: [...products].sort((left, right) => left.localeCompare(right)),
  };
}

export function inferSwiftSpecTargetBaseName(filePath: string) {
  const baseName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  return baseName
    .replace(/Tests\.swift$/i, "")
    .replace(/Test\.swift$/i, "")
    .replace(/\.swift$/i, "");
}