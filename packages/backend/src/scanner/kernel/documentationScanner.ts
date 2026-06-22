import path from "path";
import type { ProductGraphEdge, ProductGraphNode, ProductMetadataValue } from "@openagentgraph/shared";

export const DOCUMENTATION_SCANNER_VERSION = "1.0";
export const DOCUMENTATION_SPECIAL_FILE_NAMES = new Set(["llms.txt"]);

export interface DocSectionDraft {
  heading: string;
  level: number;
  line: number;
  slug: string;
  parentHeading?: string;
  parentSlug?: string;
}

export interface DocLinkDraft {
  kind: "markdown_link" | "wikilink";
  target: string;
  anchor?: string;
  line: number;
  sourceSectionSlug?: string;
  raw: string;
}

export interface DocCodeReferenceDraft {
  reference: string;
  line: number;
  sourceSectionSlug?: string;
}

export interface DocumentationFileIndex {
  sections: DocSectionDraft[];
  links: DocLinkDraft[];
  codeReferences: DocCodeReferenceDraft[];
  tags: string[];
  headings: string[];
}

export function slugifyDocHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function assignUniqueDocSectionSlugs(sections: Array<Pick<DocSectionDraft, "heading">>) {
  const slugCounts = new Map<string, number>();
  return sections.map((section) => {
    const baseSlug = slugifyDocHeading(section.heading) || "section";
    const seen = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, seen + 1);
    return seen === 0 ? baseSlug : `${baseSlug}-${seen}`;
  });
}

export function stripMarkdownCodeFences(body: string) {
  return body.replace(/```[\s\S]*?```/g, "\n");
}

export function parseYamlFrontMatterTags(body: string): { tags: string[]; body: string; lineOffset: number } {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { tags: [], body, lineOffset: 0 };
  const tags: string[] = [];
  const frontMatter = match[1]!;
  const inlineTags = frontMatter.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inlineTags) {
    for (const entry of inlineTags[1]!.split(",")) {
      const cleaned = entry.trim().replace(/^['"]|['"]$/g, "");
      if (cleaned) tags.push(cleaned);
    }
  }
  let inTagsList = false;
  for (const rawLine of frontMatter.split("\n")) {
    const line = rawLine.trim();
    if (/^tags:\s*$/.test(line)) {
      inTagsList = true;
      continue;
    }
    if (inTagsList) {
      const listItem = line.match(/^-\s+(.+)$/);
      if (listItem) {
        tags.push(listItem[1]!.trim().replace(/^['"]|['"]$/g, ""));
        continue;
      }
      if (line.length > 0 && !line.startsWith("-")) inTagsList = false;
    }
  }
  const lineOffset = (match[0].match(/\r?\n/g) ?? []).length;
  return { tags: [...new Set(tags)], body: body.slice(match[0].length), lineOffset };
}

function activeSectionSlugAtLine(sections: DocSectionDraft[], line: number) {
  let active: DocSectionDraft | undefined;
  for (const section of sections) {
    if (section.line <= line) active = section;
    else break;
  }
  return active?.slug;
}

function parseMarkdownLinkTarget(rawTarget: string) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("#")) {
    return { target: "", anchor: trimmed.slice(1) };
  }
  if (/^(?:https?:|mailto:)/i.test(trimmed)) {
    return undefined;
  }
  const hashIndex = trimmed.indexOf("#");
  const target = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const anchor = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : undefined;
  return { target, anchor };
}

export function isDocumentationScannerFilePath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const extension = path.extname(normalized).toLowerCase();
  const fileName = path.posix.basename(normalized).toLowerCase();
  return extension === ".md" || extension === ".rst" || DOCUMENTATION_SPECIAL_FILE_NAMES.has(fileName);
}

function parseWikilinkTarget(inner: string) {
  const pipeIndex = inner.indexOf("|");
  const targetPart = pipeIndex >= 0 ? inner.slice(0, pipeIndex).trim() : inner;
  if (targetPart.startsWith("#")) {
    return { target: "", anchor: targetPart.slice(1) };
  }
  const hashIndex = targetPart.indexOf("#");
  const target = hashIndex >= 0 ? targetPart.slice(0, hashIndex) : targetPart;
  const anchor = hashIndex >= 0 ? targetPart.slice(hashIndex + 1) : undefined;
  return { target, anchor };
}

export function parseDocumentationFile(body: string, filePath: string): DocumentationFileIndex {
  const { tags, body: strippedBody, lineOffset } = parseYamlFrontMatterTags(body);
  const sectionDrafts: Array<{
    heading: string;
    level: number;
    line: number;
    parentHeading?: string;
  }> = [];
  const parentStack: Array<{ level: number; heading: string }> = [];

  for (const [index, rawLine] of strippedBody.split("\n").entries()) {
    const line = index + 1 + lineOffset;
    const headingMatch = rawLine.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (!headingMatch) continue;
    const level = headingMatch[1]!.length;
    const heading = headingMatch[2]!.trim();
    while (parentStack.length > 0 && parentStack[parentStack.length - 1]!.level >= level) {
      parentStack.pop();
    }
    sectionDrafts.push({
      heading,
      level,
      line,
      parentHeading: parentStack[parentStack.length - 1]?.heading,
    });
    parentStack.push({ level, heading });
  }

  const uniqueSlugs = assignUniqueDocSectionSlugs(sectionDrafts);
  const parentSlugStack: Array<{ level: number; slug: string }> = [];
  const sections: DocSectionDraft[] = sectionDrafts.map((draft, index) => {
    while (parentSlugStack.length > 0 && parentSlugStack[parentSlugStack.length - 1]!.level >= draft.level) {
      parentSlugStack.pop();
    }
    const parentSlug = parentSlugStack[parentSlugStack.length - 1]?.slug;
    const slug = uniqueSlugs[index]!;
    parentSlugStack.push({ level: draft.level, slug });
    return {
      ...draft,
      slug,
      parentSlug,
    };
  });

  const searchableBody = stripMarkdownCodeFences(strippedBody);
  const links: DocLinkDraft[] = [];
  const codeReferences: DocCodeReferenceDraft[] = [];

  for (const [index, rawLine] of searchableBody.split("\n").entries()) {
    const line = index + 1 + lineOffset;
    const sectionSlug = activeSectionSlugAtLine(sections, line);

    const markdownRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let markdownMatch: RegExpExecArray | null;
    while ((markdownMatch = markdownRegex.exec(rawLine)) !== null) {
      const parsedTarget = parseMarkdownLinkTarget(markdownMatch[2]!);
      if (!parsedTarget) continue;
      links.push({
        kind: "markdown_link",
        target: parsedTarget.target,
        anchor: parsedTarget.anchor,
        line,
        sourceSectionSlug: sectionSlug,
        raw: markdownMatch[0]!,
      });
    }

    const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
    let wikilinkMatch: RegExpExecArray | null;
    while ((wikilinkMatch = wikilinkRegex.exec(rawLine)) !== null) {
      const parsedTarget = parseWikilinkTarget(wikilinkMatch[1]!.trim());
      links.push({
        kind: "wikilink",
        target: parsedTarget.target,
        anchor: parsedTarget.anchor,
        line,
        sourceSectionSlug: sectionSlug,
        raw: wikilinkMatch[0]!,
      });
    }

    const backtickRegex = /`([^`]+)`/g;
    let backtickMatch: RegExpExecArray | null;
    while ((backtickMatch = backtickRegex.exec(rawLine)) !== null) {
      const reference = backtickMatch[1]!.trim();
      if (!reference || reference.length > 120) continue;
      if (/^(?:npm run|git |cd |curl )/i.test(reference)) continue;
      codeReferences.push({
        reference,
        line,
        sourceSectionSlug: sectionSlug,
      });
    }
  }

  return {
    sections: sections.slice(0, 48),
    links: links.slice(0, 48),
    codeReferences: codeReferences.slice(0, 48),
    tags: tags.slice(0, 12),
    headings: sections.map((section) => section.heading).slice(0, 12),
  };
}

function normalizeDocLinkTarget(sourceFilePath: string, target: string) {
  const normalizedSourceDir = path.posix.dirname(sourceFilePath.replace(/\\/g, "/"));
  const sourceDir = normalizedSourceDir === "." ? "" : normalizedSourceDir;
  const cleaned = target.replace(/\\/g, "/").trim();
  if (!cleaned || cleaned.startsWith("/")) return cleaned.replace(/^\//, "");
  if (cleaned.startsWith("./")) {
    return path.posix.normalize(path.posix.join(sourceDir, cleaned.slice(2)));
  }
  return path.posix.normalize(path.posix.join(sourceDir, cleaned));
}

function resolveDocFileCandidates(sourceFilePath: string, target: string) {
  const normalized = normalizeDocLinkTarget(sourceFilePath, target);
  const normalizedSourceDir = path.posix.dirname(sourceFilePath.replace(/\\/g, "/"));
  const sourceDir = normalizedSourceDir === "." ? "" : normalizedSourceDir;
  const cleaned = target.replace(/\\/g, "/").trim();
  const isBareExtensionlessTarget = Boolean(cleaned)
    && !cleaned.startsWith("/")
    && !cleaned.startsWith("./")
    && !cleaned.includes("/")
    && !/\.[a-z0-9]+$/i.test(cleaned);
  const candidates = new Set<string>([normalized]);
  if (!/\.[a-z0-9]+$/i.test(normalized)) {
    candidates.add(`${normalized}.md`);
    candidates.add(path.posix.join(normalized, "README.md"));
  }
  if (isBareExtensionlessTarget) {
    candidates.add(path.posix.join(sourceDir, "docs", cleaned));
    candidates.add(path.posix.join(sourceDir, "docs", `${cleaned}.md`));
    candidates.add(path.posix.join("docs", normalized));
    candidates.add(path.posix.join("docs", `${normalized}.md`));
  }
  return [...candidates];
}

function resolveDocSectionNodeId(input: {
  filePath: string;
  anchor?: string;
  docSectionNodeIdsByKey: Map<string, string>;
  localSectionSlugs?: Map<string, string>;
}) {
  if (!input.anchor) return undefined;
  const slug = slugifyDocHeading(decodeURIComponent(input.anchor));
  if (input.localSectionSlugs?.has(slug)) {
    return input.localSectionSlugs.get(slug);
  }
  return input.docSectionNodeIdsByKey.get(`${input.filePath}|${slug}`);
}

function appendDocLinkEdge(input: {
  edges: ProductGraphEdge[];
  sourceNodeId: string;
  link: DocLinkDraft;
  targetNodeId: string;
  resolvedPath: string;
  trust?: ProductGraphEdge["trust"];
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxEdgeLabelLength: number;
  scannedAt: string;
  edgeIdSuffix: string;
}) {
  input.edges.push({
    id: input.stableId("code-scan:edge", `${input.sourceNodeId}|${input.link.kind}|${input.link.raw}|${input.edgeIdSuffix}`),
    kind: "uses",
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    label: (input.link.anchor ? `#${input.link.anchor}` : input.link.target).slice(0, input.maxEdgeLabelLength),
    trust: input.trust ?? "extracted",
    metadata: input.compactMetadata({
      scannerRelation: input.link.kind === "wikilink" ? "doc_wikilink" : "doc_link",
      scannerLanguage: "documentation",
      scannerDocLinkTarget: input.resolvedPath,
      scannerDocLinkAnchor: input.link.anchor,
      edgeDerivationSource: "docs",
    }),
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  });
}

function resolveDocFileNodeId(
  sourceFilePath: string,
  target: string,
  fileNodeIdsByPath: Map<string, string>
) {
  for (const candidate of resolveDocFileCandidates(sourceFilePath, target)) {
    const nodeId = fileNodeIdsByPath.get(candidate);
    if (nodeId) return { nodeId, resolvedPath: candidate };
  }
  return undefined;
}

function classifyCodeReference(reference: string) {
  if (/\.[a-z0-9]{1,8}$/i.test(reference) || reference.includes("/")) {
    return "file" as const;
  }
  if (/^[A-Z][A-Za-z0-9_]*$/.test(reference) || /^[a-z][A-Za-z0-9_]*$/.test(reference)) {
    return "symbol" as const;
  }
  return "ambiguous" as const;
}

export function indexDocumentationFile(input: {
  filePath: string;
  body: string;
  fileNodeId: string;
  scanId: string;
  scannedAt: string;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  sourceRef: (projectPath: string, line?: number) => ProductGraphNode["source"];
  maxTitleLength: number;
  maxEdgeLabelLength: number;
  fileNodeIdsByPath?: Map<string, string>;
  docSectionNodeIdsByKey?: Map<string, string>;
  symbolNodeIdsBySimpleName?: Map<string, string[]>;
}): {
  symbolNodes: ProductGraphNode[];
  edges: ProductGraphEdge[];
  fileMetadata: Record<string, ProductMetadataValue>;
  docSectionNodeIdsByKey: Map<string, string>;
} {
  const parsed = parseDocumentationFile(input.body, input.filePath);
  const symbolNodes: ProductGraphNode[] = [];
  const edges: ProductGraphEdge[] = [];
  const docSectionNodeIdsByKey = new Map(input.docSectionNodeIdsByKey ?? []);
  const sectionNodeIdBySlug = new Map<string, string>();

  for (const section of parsed.sections) {
    const rawId = `${input.filePath}|doc_section|${section.slug}`;
    const sectionNodeId = input.stableId("code-scan:symbol", rawId);
    const title = `${section.heading} (doc_section)`;
    sectionNodeIdBySlug.set(section.slug, sectionNodeId);
    docSectionNodeIdsByKey.set(`${input.filePath}|${section.slug}`, sectionNodeId);
    symbolNodes.push({
      id: sectionNodeId,
      kind: "code_symbol",
      title: title.slice(0, input.maxTitleLength),
      status: "planned",
      tags: ["code", "code-scan", "documentation", "ecosystem-t1", "doc-section"],
      source: input.sourceRef(input.filePath, section.line),
      metadata: input.compactMetadata({
        scannerEcosystemVersion: DOCUMENTATION_SCANNER_VERSION,
        scanId: input.scanId,
        scannedAt: input.scannedAt,
        scannerSourceFile: input.filePath,
        scannerSymbolKind: "doc_section",
        scannerSymbolName: section.heading,
        scannerDocSectionSlug: section.slug,
        scannerDocSectionLevel: section.level,
        scannerDocSectionParent: section.parentHeading,
        scannerLanguage: "documentation",
        scannerIndexingMode: "t1",
        edgeDerivationSource: "docs",
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
    edges.push({
      id: input.stableId("code-scan:edge", `${sectionNodeId}->${input.fileNodeId}|doc_section`),
      kind: "belongs_to",
      sourceNodeId: sectionNodeId,
      targetNodeId: input.fileNodeId,
      label: "doc_section".slice(0, input.maxEdgeLabelLength),
      trust: "extracted",
      metadata: input.compactMetadata({
        scannerRelation: "doc_section",
        scannerLanguage: "documentation",
        edgeDerivationSource: "docs",
      }),
      createdAt: input.scannedAt,
      updatedAt: input.scannedAt,
    });
    if (section.parentSlug) {
      const parentNodeId = sectionNodeIdBySlug.get(section.parentSlug);
      if (parentNodeId) {
        edges.push({
          id: input.stableId("code-scan:edge", `${sectionNodeId}->${parentNodeId}|doc_section_parent`),
          kind: "belongs_to",
          sourceNodeId: sectionNodeId,
          targetNodeId: parentNodeId,
          label: "nested_section".slice(0, input.maxEdgeLabelLength),
          trust: "extracted",
          metadata: input.compactMetadata({
            scannerRelation: "doc_section_parent",
            scannerLanguage: "documentation",
            edgeDerivationSource: "docs",
          }),
          createdAt: input.scannedAt,
          updatedAt: input.scannedAt,
        });
      }
    }
  }

  if (input.fileNodeIdsByPath) {
    for (const link of parsed.links) {
      const sourceNodeId = link.sourceSectionSlug
        ? sectionNodeIdBySlug.get(link.sourceSectionSlug) ?? input.fileNodeId
        : input.fileNodeId;
      if (!link.target && link.anchor) {
        const targetNodeId = resolveDocSectionNodeId({
          filePath: input.filePath,
          anchor: link.anchor,
          docSectionNodeIdsByKey,
          localSectionSlugs: sectionNodeIdBySlug,
        });
        if (!targetNodeId) continue;
        appendDocLinkEdge({
          edges,
          sourceNodeId,
          link,
          targetNodeId,
          resolvedPath: input.filePath,
          stableId: input.stableId,
          compactMetadata: input.compactMetadata,
          maxEdgeLabelLength: input.maxEdgeLabelLength,
          scannedAt: input.scannedAt,
          edgeIdSuffix: `${input.filePath}|anchor|${link.anchor}`,
        });
        continue;
      }
      const resolved = resolveDocFileNodeId(input.filePath, link.target, input.fileNodeIdsByPath);
      if (!resolved) continue;
      const targetNodeId = resolveDocSectionNodeId({
        filePath: resolved.resolvedPath,
        anchor: link.anchor,
        docSectionNodeIdsByKey,
        localSectionSlugs: resolved.resolvedPath === input.filePath ? sectionNodeIdBySlug : undefined,
      }) ?? resolved.nodeId;
      appendDocLinkEdge({
        edges,
        sourceNodeId,
        link,
        targetNodeId,
        resolvedPath: resolved.resolvedPath,
        trust: link.anchor && targetNodeId === resolved.nodeId ? "ambiguous" : "extracted",
        stableId: input.stableId,
        compactMetadata: input.compactMetadata,
        maxEdgeLabelLength: input.maxEdgeLabelLength,
        scannedAt: input.scannedAt,
        edgeIdSuffix: resolved.resolvedPath,
      });
    }
  }

  if (input.symbolNodeIdsBySimpleName) {
    for (const codeRef of parsed.codeReferences) {
      const sourceNodeId = codeRef.sourceSectionSlug
        ? sectionNodeIdBySlug.get(codeRef.sourceSectionSlug) ?? input.fileNodeId
        : input.fileNodeId;
      const refKind = classifyCodeReference(codeRef.reference);
      let targetNodeId: string | undefined;
      let resolution: "symbol" | "file" | "missing" = "missing";
      if (refKind === "file" && input.fileNodeIdsByPath) {
        const fileCandidates = [
          codeRef.reference,
          codeRef.reference.replace(/^\.\//, ""),
        ];
        for (const candidate of fileCandidates) {
          const nodeId = input.fileNodeIdsByPath.get(candidate.replace(/\\/g, "/"));
          if (nodeId) {
            targetNodeId = nodeId;
            resolution = "file";
            break;
          }
        }
      } else {
        const symbolIds = input.symbolNodeIdsBySimpleName.get(codeRef.reference);
        if (symbolIds?.length === 1) {
          targetNodeId = symbolIds[0];
          resolution = "symbol";
        } else if (symbolIds && symbolIds.length > 1) {
          targetNodeId = symbolIds[0];
          resolution = "symbol";
        }
      }
      if (!targetNodeId) continue;
      edges.push({
        id: input.stableId("code-scan:edge", `${sourceNodeId}|doc_code_ref|${codeRef.reference}`),
        kind: "uses",
        sourceNodeId,
        targetNodeId,
        label: codeRef.reference.slice(0, input.maxEdgeLabelLength),
        trust: resolution === "symbol" && refKind === "symbol" ? "inferred" : "ambiguous",
        metadata: input.compactMetadata({
          scannerRelation: "doc_code_ref",
          scannerLanguage: "documentation",
          scannerDocCodeReference: codeRef.reference,
          scannerDocCodeRefKind: refKind,
          scannerDocCodeRefResolution: resolution,
          edgeDerivationSource: "docs",
        }),
        createdAt: input.scannedAt,
        updatedAt: input.scannedAt,
      });
    }
  }

  const fileMetadata: Record<string, ProductMetadataValue> = {
    scannerLanguage: "documentation",
    scannerIndexingMode: "t1",
    scannerSemanticSupported: false,
    scannerDocSectionCount: parsed.sections.length,
    scannerDocLinkCount: parsed.links.length,
    scannerDocCodeRefCount: parsed.codeReferences.length,
  };
  if (parsed.headings.length > 0) fileMetadata.scannerHeadings = parsed.headings.join(" | ");
  if (parsed.tags.length > 0) fileMetadata.scannerDocTags = parsed.tags.join(", ");

  return { symbolNodes, edges, fileMetadata, docSectionNodeIdsByKey };
}

export function augmentDocumentationWorkspaceGraph(input: {
  scanId: string;
  scannedAt: string;
  files: Array<{ relativePath: string; body: string }>;
  fileNodeIdsByPath: Map<string, string>;
  docSectionNodeIdsByKey: Map<string, string>;
  symbolNodeIdsBySimpleName: Map<string, string[]>;
  stableId: (prefix: string, raw: string) => string;
  compactMetadata: (values: Record<string, ProductMetadataValue | undefined>) => Record<string, ProductMetadataValue> | undefined;
  maxEdgeLabelLength: number;
}) {
  const edges: ProductGraphEdge[] = [];
  const diagnostics: string[] = [];

  for (const file of input.files) {
    if (!isDocumentationScannerFilePath(file.relativePath)) continue;
    const sourceFileNodeId = input.fileNodeIdsByPath.get(file.relativePath);
    if (!sourceFileNodeId) continue;
    const parsed = parseDocumentationFile(file.body, file.relativePath);
    const sectionSlugToNodeId = new Map<string, string>();
    for (const section of parsed.sections) {
      const nodeId = input.docSectionNodeIdsByKey.get(`${file.relativePath}|${section.slug}`);
      if (nodeId) sectionSlugToNodeId.set(section.slug, nodeId);
    }

    for (const link of parsed.links) {
      const sourceNodeId = link.sourceSectionSlug
        ? sectionSlugToNodeId.get(link.sourceSectionSlug) ?? sourceFileNodeId
        : sourceFileNodeId;
      if (!link.target && link.anchor) {
        const targetNodeId = resolveDocSectionNodeId({
          filePath: file.relativePath,
          anchor: link.anchor,
          docSectionNodeIdsByKey: input.docSectionNodeIdsByKey,
          localSectionSlugs: sectionSlugToNodeId,
        });
        if (!targetNodeId) {
          diagnostics.push(`Broken doc anchor in ${file.relativePath}:${link.line}: ${link.raw}`);
          continue;
        }
        appendDocLinkEdge({
          edges,
          sourceNodeId,
          link,
          targetNodeId,
          resolvedPath: file.relativePath,
          stableId: input.stableId,
          compactMetadata: input.compactMetadata,
          maxEdgeLabelLength: input.maxEdgeLabelLength,
          scannedAt: input.scannedAt,
          edgeIdSuffix: `workspace-${file.relativePath}|anchor|${link.anchor}`,
        });
        continue;
      }
      const resolved = resolveDocFileNodeId(file.relativePath, link.target, input.fileNodeIdsByPath);
      if (!resolved) {
        const symbolTargetNodeId = link.kind === "wikilink"
          ? input.symbolNodeIdsBySimpleName.get(link.target)?.[0]
          : undefined;
        if (symbolTargetNodeId) {
          edges.push({
            id: input.stableId("code-scan:edge", `${sourceNodeId}|workspace-doc_wikilink_symbol|${link.target}`),
            kind: "uses",
            sourceNodeId,
            targetNodeId: symbolTargetNodeId,
            label: link.target.slice(0, input.maxEdgeLabelLength),
            trust: "inferred",
            metadata: input.compactMetadata({
              scannerRelation: "doc_code_ref",
              scannerLanguage: "documentation",
              scannerDocCodeReference: link.target,
              scannerDocCodeRefKind: "symbol",
              scannerDocCodeRefResolution: "symbol",
              scannerDocLinkSyntax: "wikilink",
              edgeDerivationSource: "docs",
            }),
            createdAt: input.scannedAt,
            updatedAt: input.scannedAt,
          });
          continue;
        }
        diagnostics.push(`Broken doc link in ${file.relativePath}:${link.line}: ${link.raw}`);
        continue;
      }
      const anchoredSectionId = link.anchor
        ? resolveDocSectionNodeId({
          filePath: resolved.resolvedPath,
          anchor: link.anchor,
          docSectionNodeIdsByKey: input.docSectionNodeIdsByKey,
          localSectionSlugs: resolved.resolvedPath === file.relativePath ? sectionSlugToNodeId : undefined,
        })
        : undefined;
      const targetNodeId = anchoredSectionId ?? resolved.nodeId;
      appendDocLinkEdge({
        edges,
        sourceNodeId,
        link,
        targetNodeId,
        resolvedPath: resolved.resolvedPath,
        trust: link.anchor && !anchoredSectionId ? "ambiguous" : "extracted",
        stableId: input.stableId,
        compactMetadata: input.compactMetadata,
        maxEdgeLabelLength: input.maxEdgeLabelLength,
        scannedAt: input.scannedAt,
        edgeIdSuffix: `workspace-${resolved.resolvedPath}`,
      });
    }

    for (const codeRef of parsed.codeReferences) {
      const sourceNodeId = codeRef.sourceSectionSlug
        ? sectionSlugToNodeId.get(codeRef.sourceSectionSlug) ?? sourceFileNodeId
        : sourceFileNodeId;
      const refKind = classifyCodeReference(codeRef.reference);
      let targetNodeId: string | undefined;
      let resolution: "symbol" | "file" | "missing" = "missing";
      if (refKind === "file") {
        for (const candidate of [codeRef.reference, codeRef.reference.replace(/^\.\//, "")]) {
          const nodeId = input.fileNodeIdsByPath.get(candidate.replace(/\\/g, "/"));
          if (nodeId) {
            targetNodeId = nodeId;
            resolution = "file";
            break;
          }
        }
      } else {
        const symbolIds = input.symbolNodeIdsBySimpleName.get(codeRef.reference);
        if (symbolIds?.length) {
          targetNodeId = symbolIds[0];
          resolution = "symbol";
        }
      }
      if (!targetNodeId) continue;
      edges.push({
        id: input.stableId("code-scan:edge", `${sourceNodeId}|workspace-doc_code_ref|${codeRef.reference}`),
        kind: "uses",
        sourceNodeId,
        targetNodeId,
        label: codeRef.reference.slice(0, input.maxEdgeLabelLength),
        trust: resolution === "symbol" ? "inferred" : "ambiguous",
        metadata: input.compactMetadata({
          scannerRelation: "doc_code_ref",
          scannerLanguage: "documentation",
          scannerDocCodeReference: codeRef.reference,
          scannerDocCodeRefKind: refKind,
          scannerDocCodeRefResolution: resolution,
          edgeDerivationSource: "docs",
        }),
        createdAt: input.scannedAt,
        updatedAt: input.scannedAt,
      });
    }
  }

  return { edges, diagnostics: [...new Set(diagnostics)].slice(0, 24) };
}
