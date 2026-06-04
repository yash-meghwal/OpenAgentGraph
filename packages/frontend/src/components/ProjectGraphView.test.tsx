import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import type { ProjectGraphResponse } from "@openagentgraph/shared";
import { useStore } from "../lib/store.js";
import { GRAPH_THEMES, GRAPH_THEME_STORAGE_KEY } from "../lib/graphTheme.js";
import { formatProjectGraphScanStatus, PROJECT_GRAPH_LAYOUT_CSS, ProjectGraphView } from "./ProjectGraphView.js";

vi.mock("react-force-graph-3d", () => ({
  default: ({ width, height }: { width?: number; height?: number }) => (
    <div data-height={height} data-testid="force-graph" data-width={width} />
  ),
}));

function makeProjectGraph(): ProjectGraphResponse {
  return {
    root: "C:/workspace/openagentgraph",
    generatedAt: "2026-06-02T00:00:00.000Z",
    nodes: [
      {
        id: "dir:.",
        label: "workspace",
        path: ".",
        kind: "directory",
        group: "workspace",
      },
      {
        id: "dir:src",
        label: "src",
        path: "src",
        kind: "directory",
        group: "src",
      },
      {
        id: "file:src/app.ts",
        label: "app.ts",
        path: "src/app.ts",
        kind: "source",
        group: "src",
        sizeBytes: 128,
        lineCount: 4,
        importCount: 1,
      },
    ],
    edges: [
      {
        id: "contains:dir:.->dir:src",
        sourceNodeId: "dir:.",
        targetNodeId: "dir:src",
        kind: "contains",
      },
      {
        id: "contains:dir:src->file:src/app.ts",
        sourceNodeId: "dir:src",
        targetNodeId: "file:src/app.ts",
        kind: "contains",
      },
    ],
    summary: {
      fileCount: 1,
      directoryCount: 2,
      importEdgeCount: 0,
      testEdgeCount: 0,
      referenceEdgeCount: 0,
      scannedFileCount: 1,
      skippedFileCount: 2,
      skippedDirectoryCount: 4,
      partial: false,
    },
    progress: {
      scanId: "project-scan-1",
      scope: "project_graph",
      phase: "completed",
      startedAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:01.000Z",
      filesScanned: 1,
      bytesScanned: 128,
      skippedFileCount: 2,
      skippedDirectoryCount: 4,
      filesPerSecond: 1,
      megabytesPerSecond: 0,
      breakers: {
        state: "ok",
        limits: {
          maxFiles: 20_000,
          maxTotalBytes: 200_000_000,
          maxFileBytes: 5_000_000,
          maxDepth: 40,
          maxDurationMs: 180_000,
        },
        hits: [],
        near: [],
      },
    },
  };
}

function renderedText(children: unknown): string {
  if (Array.isArray(children)) return children.map(renderedText).join("");
  return String(children ?? "");
}

function makeMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("ProjectGraphView", () => {
  beforeEach(() => {
    useStore.setState({
      projectGraph: makeProjectGraph(),
      projectGraphLoading: false,
      projectGraphError: "",
      loadProjectGraph: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("formats skipped generated folder status", () => {
    expect(formatProjectGraphScanStatus(makeProjectGraph())).toBe(
      "Scan summary: 1 scanned files, 2 skipped files, 4 skipped generated folders"
    );
  });

  it("renders skipped folder scan status", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ProjectGraphView />);
    });
    const markup = JSON.stringify(renderer!.toJSON());

    expect(markup).toContain("4 skipped generated folders");
    expect(markup).toContain("completed: 1 files");
    expect(markup).toContain('"role":"progressbar"');
    expect(markup).toContain('"aria-valuenow":3');
    expect(markup).toContain('"aria-label":"Project graph edge legend"');
    expect(markup).toContain('"className":"project-graph-shell"');
    expect(markup).toContain('"className":"project-graph-canvas-panel"');
    expect(markup).toContain('"data-width":720');
    expect(markup).toContain('"data-height":520');
    expect(markup).toContain("folder to child file/folder");
    expect(markup).toContain("source dependency, animated");
    expect(markup).toContain("test coverage link, animated");
    expect(markup).toContain("Hidden folders include generated, cache, dependency, build, database, and dev log output.");
  });

  it("lets users switch project graph color themes", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ProjectGraphView />);
    });

    const initialMarkup = JSON.stringify(renderer!.toJSON());
    expect(initialMarkup).toContain('"aria-label":"Project graph theme"');
    expect(initialMarkup).toContain("Signal");
    expect(initialMarkup).toContain("High contrast");
    expect(initialMarkup).toContain("Color-safe");

    const highContrastButton = renderer!.root
      .findAllByType("button")
      .find((button) => renderedText(button.props.children) === "High contrast");
    expect(highContrastButton).toBeTruthy();

    act(() => {
      highContrastButton!.props.onClick();
    });

    const switchedMarkup = JSON.stringify(renderer!.toJSON());
    expect(switchedMarkup).toContain(GRAPH_THEMES.highContrast.projectKind.source);
  });

  it("uses and updates the persisted project graph color theme", () => {
    const localStorage = makeMemoryStorage();
    localStorage.setItem(GRAPH_THEME_STORAGE_KEY, "colorSafe");
    vi.stubGlobal("window", {
      localStorage,
      innerWidth: 1200,
      innerHeight: 800,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ProjectGraphView />);
    });

    expect(JSON.stringify(renderer!.toJSON())).toContain(GRAPH_THEMES.colorSafe.projectKind.source);

    const highContrastButton = renderer!.root
      .findAllByType("button")
      .find((button) => renderedText(button.props.children) === "High contrast");
    expect(highContrastButton).toBeTruthy();

    act(() => {
      highContrastButton!.props.onClick();
    });

    expect(localStorage.getItem(GRAPH_THEME_STORAGE_KEY)).toBe("highContrast");
  });

  it("keeps the project graph canvas and sidebar responsive on narrow screens", () => {
    expect(PROJECT_GRAPH_LAYOUT_CSS).toContain("@media (max-width: 760px)");
    expect(PROJECT_GRAPH_LAYOUT_CSS).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(PROJECT_GRAPH_LAYOUT_CSS).toContain(".project-graph-canvas-panel");
    expect(PROJECT_GRAPH_LAYOUT_CSS).toContain("min-height: 520px");
  });

  it("explains empty project graph search results", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ProjectGraphView />);
    });

    const searchInput = renderer!.root.findByProps({ "aria-label": "Project graph search" });
    act(() => {
      searchInput.props.onChange({ target: { value: "missing-package" } });
    });
    const markup = JSON.stringify(renderer!.toJSON());

    expect(markup).toContain("No project graph matches");
    expect(markup).toContain('No files, folders, or packages match \\"missing-package\\".');
    expect(markup).toContain("Clear the search or switch the type filter back to All.");
  });
});
