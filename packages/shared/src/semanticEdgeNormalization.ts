import type { UnifiedCodeGraphEdgeKind } from "./codeGraph.js";

export const SEMANTIC_EDGE_RELATIONS = [
  "imports",
  "extends",
  "implements",
  "calls",
  "uses",
  "tests",
  "route_to_handler",
  "asset_references",
] as const;

export type SemanticEdgeRelation = (typeof SEMANTIC_EDGE_RELATIONS)[number];

const RELATION_ALIASES: Record<string, SemanticEdgeRelation> = {
  import: "imports",
  inheritance: "extends",
  test_target: "tests",
  rails_route: "route_to_handler",
  laravel_route: "route_to_handler",
  external_import: "imports",
  external_using: "imports",
};

export function normalizeScannerRelation(relation: string | undefined): SemanticEdgeRelation | undefined {
  if (!relation) return undefined;
  const trimmed = relation.trim().toLowerCase();
  const alias = RELATION_ALIASES[trimmed];
  if (alias) return alias;
  if ((SEMANTIC_EDGE_RELATIONS as readonly string[]).includes(trimmed)) {
    return trimmed as SemanticEdgeRelation;
  }
  return undefined;
}

export function mapSemanticRelationToEdgeKind(relation: SemanticEdgeRelation): UnifiedCodeGraphEdgeKind {
  switch (relation) {
    case "extends":
      return "inherits";
    case "implements":
      return "implements";
    case "tests":
      return "tests";
    case "imports":
    case "calls":
    case "uses":
    case "route_to_handler":
    case "asset_references":
    default:
      return "depends_on";
  }
}

export function isSemanticResolutionEdge(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return false;
  const resolution = metadata.scannerResolution ?? metadata.scannerImportResolution;
  return resolution === "semantic" || resolution === "semantic-lite";
}

export function edgeRequiresExplicitEndpoints(metadata: Record<string, unknown> | undefined) {
  const relation = normalizeScannerRelation(
    typeof metadata?.scannerRelation === "string" ? metadata.scannerRelation : undefined
  );
  if (!relation) return false;
  return relation === "imports"
    || relation === "extends"
    || relation === "implements"
    || relation === "calls"
    || relation === "uses"
    || relation === "tests"
    || relation === "route_to_handler";
}