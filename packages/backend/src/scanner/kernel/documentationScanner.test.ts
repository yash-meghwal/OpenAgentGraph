import { describe, expect, it } from "vitest";
import {
  assignUniqueDocSectionSlugs,
  augmentDocumentationWorkspaceGraph,
  indexDocumentationFile,
  parseDocumentationFile,
  slugifyDocHeading,
} from "./documentationScanner.js";

const stableId = (prefix: string, raw: string) => `${prefix}:${raw}`;
const compactMetadata = (values: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<string, string>;
const sourceRef = (projectPath: string, line?: number) => ({ kind: "code_scan" as const, label: projectPath, path: projectPath, line });

describe("documentationScanner", () => {
  it("parses headings, links, wikilinks, tags, and code references", () => {
    const body = [
      "---",
      "tags: [architecture, onboarding]",
      "---",
      "",
      "# Architecture",
      "",
      "## Components",
      "",
      "See [guide](./guide.md) and [[architecture#Components]].",
      "",
      "Uses `CheckoutService` and `src/service.ts`.",
      "",
      "```ts",
      "const ignored = `NotARef`;",
      "```",
    ].join("\n");
    const parsed = parseDocumentationFile(body, "docs/architecture.md");
    expect(parsed.tags).toEqual(["architecture", "onboarding"]);
    expect(parsed.sections.map((section) => section.heading)).toEqual(["Architecture", "Components"]);
    expect(parsed.links).toHaveLength(2);
    expect(parsed.codeReferences.map((ref) => ref.reference)).toEqual(["CheckoutService", "src/service.ts"]);
    expect(slugifyDocHeading("Getting Started")).toBe("getting-started");
  });

  it("emits doc_section nodes with provenance metadata", () => {
    const indexed = indexDocumentationFile({
      filePath: "docs/guide.md",
      body: "# Guide\n\n## Getting started\n",
      fileNodeId: "file:docs/guide.md",
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      stableId,
      compactMetadata,
      sourceRef,
      maxTitleLength: 180,
      maxEdgeLabelLength: 180,
    });
    expect(indexed.symbolNodes).toHaveLength(2);
    expect(indexed.symbolNodes.every((node) => node.metadata?.scannerSymbolKind === "doc_section")).toBe(true);
    expect(indexed.edges.some((edge) => edge.metadata?.scannerRelation === "doc_section")).toBe(true);
    expect(indexed.fileMetadata.scannerDocSectionCount).toBe(2);
  });

  it("resolves workspace doc links and code references", () => {
    const fileNodeIdsByPath = new Map<string, string>([
      ["docs/architecture.md", "file:docs/architecture.md"],
      ["docs/guide.md", "file:docs/guide.md"],
      ["src/service.ts", "file:src/service.ts"],
    ]);
    const docSectionNodeIdsByKey = new Map<string, string>([
      ["docs/architecture.md|components", "section:components"],
    ]);
    const symbolNodeIdsBySimpleName = new Map<string, string[]>([
      ["CheckoutService", ["symbol:checkout"]],
    ]);

    const augmented = augmentDocumentationWorkspaceGraph({
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      files: [
        {
          relativePath: "docs/architecture.md",
          body: "# Architecture\n\nSee [guide](./guide.md).\n\nUses `CheckoutService`.\n",
        },
      ],
      fileNodeIdsByPath,
      docSectionNodeIdsByKey,
      symbolNodeIdsBySimpleName,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 180,
    });

    expect(augmented.edges.some((edge) => edge.metadata?.scannerRelation === "doc_link")).toBe(true);
    expect(augmented.edges.some((edge) => edge.metadata?.scannerRelation === "doc_code_ref")).toBe(true);
    expect(augmented.diagnostics).toHaveLength(0);
  });

  it("resolves links to llms.txt as first-class documentation", () => {
    const augmented = augmentDocumentationWorkspaceGraph({
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      files: [
        { relativePath: "README.md", body: "Read [llms](llms.txt).\n" },
        { relativePath: "llms.txt", body: "# OpenAgentGraph\n" },
      ],
      fileNodeIdsByPath: new Map([
        ["README.md", "file:README.md"],
        ["llms.txt", "file:llms.txt"],
      ]),
      docSectionNodeIdsByKey: new Map(),
      symbolNodeIdsBySimpleName: new Map(),
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 180,
    });
    expect(augmented.diagnostics).toHaveLength(0);
    expect(augmented.edges.some((edge) => edge.metadata?.scannerRelation === "doc_link")).toBe(true);
  });

  it("resolves bare wikilinks relative to the source documentation folder", () => {
    const augmented = augmentDocumentationWorkspaceGraph({
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      files: [
        { relativePath: "fixtures/docs/README.md", body: "Jump to [[guide]].\n" },
        { relativePath: "fixtures/docs/docs/guide.md", body: "# Guide\n" },
        { relativePath: "fixtures/docs/docs/architecture.md", body: "# Architecture\n\n## Components\n\nSee [[architecture#Components]].\n" },
      ],
      fileNodeIdsByPath: new Map([
        ["fixtures/docs/README.md", "file:fixtures/docs/README.md"],
        ["fixtures/docs/docs/guide.md", "file:fixtures/docs/docs/guide.md"],
        ["fixtures/docs/docs/architecture.md", "file:fixtures/docs/docs/architecture.md"],
      ]),
      docSectionNodeIdsByKey: new Map([
        ["fixtures/docs/docs/architecture.md|architecture", "section:architecture"],
        ["fixtures/docs/docs/architecture.md|components", "section:components"],
      ]),
      symbolNodeIdsBySimpleName: new Map(),
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 180,
    });
    expect(augmented.diagnostics).toHaveLength(0);
    expect(augmented.edges.filter((edge) => edge.metadata?.scannerRelation === "doc_wikilink")).toHaveLength(2);
  });

  it("resolves wikilinks to workspace symbols before reporting broken docs", () => {
    const augmented = augmentDocumentationWorkspaceGraph({
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      files: [{ relativePath: "docs/playback.md", body: "Start at [[MainViewModel]].\n" }],
      fileNodeIdsByPath: new Map([["docs/playback.md", "file:docs/playback.md"]]),
      docSectionNodeIdsByKey: new Map(),
      symbolNodeIdsBySimpleName: new Map([["MainViewModel", ["symbol:MainViewModel"]]]),
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 180,
    });
    expect(augmented.diagnostics).toHaveLength(0);
    const symbolEdge = augmented.edges.find((edge) => edge.targetNodeId === "symbol:MainViewModel");
    expect(symbolEdge?.metadata?.scannerRelation).toBe("doc_code_ref");
    expect(symbolEdge?.metadata?.scannerDocLinkSyntax).toBe("wikilink");
  });

  it("assigns unique slugs for duplicate headings in one file", () => {
    const parsed = parseDocumentationFile("## Setup\n\nA\n\n## Setup\n\nB\n", "docs/guide.md");
    expect(parsed.sections.map((section) => section.slug)).toEqual(["setup", "setup-1"]);
    expect(assignUniqueDocSectionSlugs([{ heading: "Setup" }, { heading: "Setup" }, { heading: "Setup" }])).toEqual([
      "setup",
      "setup-1",
      "setup-2",
    ]);

    const indexed = indexDocumentationFile({
      filePath: "docs/guide.md",
      body: "## Setup\n\nA\n\n## Setup\n\nB\n",
      fileNodeId: "file:docs/guide.md",
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      stableId,
      compactMetadata,
      sourceRef,
      maxTitleLength: 180,
      maxEdgeLabelLength: 180,
    });
    expect(indexed.symbolNodes).toHaveLength(2);
    expect(new Set(indexed.symbolNodes.map((node) => node.id)).size).toBe(2);
    expect(indexed.symbolNodes.map((node) => node.metadata?.scannerDocSectionSlug)).toEqual(["setup", "setup-1"]);
  });

  it("resolves same-file anchor links to doc_section nodes", () => {
    const indexed = indexDocumentationFile({
      filePath: "docs/api.md",
      body: "# API\n\nDetails.\n\nJump to [summary](#api).\n",
      fileNodeId: "file:docs/api.md",
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      stableId,
      compactMetadata,
      sourceRef,
      maxTitleLength: 180,
      maxEdgeLabelLength: 180,
      fileNodeIdsByPath: new Map([["docs/api.md", "file:docs/api.md"]]),
    });
    const anchorEdge = indexed.edges.find((edge) => edge.metadata?.scannerDocLinkAnchor === "api");
    expect(anchorEdge?.metadata?.scannerRelation).toBe("doc_link");
    expect(anchorEdge?.targetNodeId).toBe(indexed.symbolNodes[0]?.id);
  });

  it("applies front-matter line offsets to section source lines", () => {
    const body = ["---", "tags: [docs]", "---", "", "# Architecture"].join("\n");
    const parsed = parseDocumentationFile(body, "docs/architecture.md");
    expect(parsed.sections[0]?.line).toBe(5);
    const indexed = indexDocumentationFile({
      filePath: "docs/architecture.md",
      body,
      fileNodeId: "file:docs/architecture.md",
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      stableId,
      compactMetadata,
      sourceRef,
      maxTitleLength: 180,
      maxEdgeLabelLength: 180,
    });
    expect(indexed.symbolNodes[0]?.source?.line).toBe(5);
  });

  it("records broken link diagnostics honestly", () => {
    const augmented = augmentDocumentationWorkspaceGraph({
      scanId: "scan-1",
      scannedAt: "2026-06-18T00:00:00.000Z",
      files: [{ relativePath: "README.md", body: "See [missing](./nowhere.md).\n" }],
      fileNodeIdsByPath: new Map([["README.md", "file:README.md"]]),
      docSectionNodeIdsByKey: new Map(),
      symbolNodeIdsBySimpleName: new Map(),
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 180,
    });
    expect(augmented.edges).toHaveLength(0);
    expect(augmented.diagnostics[0]).toMatch(/Broken doc link in README\.md:1:/);
  });
});
