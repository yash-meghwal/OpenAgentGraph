import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GRAPH_THEME,
  DEFAULT_GRAPH_THEME_ID,
  GRAPH_THEMES,
  GRAPH_THEME_OPTIONS,
  GRAPH_THEME_STORAGE_KEY,
  parseGraphThemeId,
  readStoredGraphThemeId,
  writeStoredGraphThemeId,
} from "./graphTheme.js";

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

describe("graphTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes every selectable graph theme", () => {
    expect(GRAPH_THEMES[DEFAULT_GRAPH_THEME_ID]).toBe(DEFAULT_GRAPH_THEME);
    expect(GRAPH_THEME_OPTIONS.map((theme) => theme.id)).toEqual(["signal", "highContrast", "colorSafe"]);

    for (const option of GRAPH_THEME_OPTIONS) {
      expect(GRAPH_THEMES[option.id].label).toBe(option.label);
      expect(GRAPH_THEMES[option.id].description).toBe(option.description);
    }
  });

  it("keeps graph categories visually distinct inside each theme", () => {
    for (const theme of Object.values(GRAPH_THEMES)) {
      expect(new Set(Object.values(theme.projectKind)).size).toBe(Object.values(theme.projectKind).length);
      expect(theme.projectEdge.imports).not.toBe(theme.projectEdge.contains);
      expect(theme.codeMap.dependencies).not.toBe(theme.codeMap.semantic);
      expect(theme.codeMap.uncertain).not.toBe(theme.codeMap.files);
    }
  });

  it("covers product graph tones used by status, edge, and trust labels", () => {
    expect(DEFAULT_GRAPH_THEME.productStatus.completed).toBeTruthy();
    expect(DEFAULT_GRAPH_THEME.productStatus.blocked).toBeTruthy();
    expect(DEFAULT_GRAPH_THEME.productEdge.depends_on).toBeTruthy();
    expect(DEFAULT_GRAPH_THEME.productEdge.implements).toBeTruthy();
    expect(DEFAULT_GRAPH_THEME.trust.extracted.border).toBeTruthy();
    expect(DEFAULT_GRAPH_THEME.trust.ambiguous.background).toBeTruthy();
  });

  it("parses and persists graph theme preferences defensively", () => {
    const localStorage = makeMemoryStorage();
    vi.stubGlobal("window", { localStorage });

    expect(parseGraphThemeId("colorSafe")).toBe("colorSafe");
    expect(parseGraphThemeId("missing")).toBeNull();
    expect(readStoredGraphThemeId()).toBe(DEFAULT_GRAPH_THEME_ID);

    localStorage.setItem(GRAPH_THEME_STORAGE_KEY, "colorSafe");
    expect(readStoredGraphThemeId()).toBe("colorSafe");

    localStorage.setItem(GRAPH_THEME_STORAGE_KEY, "missing");
    expect(readStoredGraphThemeId()).toBe(DEFAULT_GRAPH_THEME_ID);

    writeStoredGraphThemeId("highContrast");
    expect(localStorage.getItem(GRAPH_THEME_STORAGE_KEY)).toBe("highContrast");
  });

  it("keeps rendering when browser storage rejects theme persistence", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });

    expect(readStoredGraphThemeId()).toBe(DEFAULT_GRAPH_THEME_ID);
    expect(() => writeStoredGraphThemeId("colorSafe")).not.toThrow();
  });
});
