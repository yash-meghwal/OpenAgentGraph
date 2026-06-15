import { describe, expect, it } from "vitest";
import { joinGraphCliPositionals, normalizeGraphCliText } from "./graphWorkspace.js";

describe("graph workspace cli text normalization", () => {
  it("strips cmd.exe caret markers from quoted Windows argv fragments", () => {
    expect(normalizeGraphCliText("^MainViewModel^ playback^")).toBe("MainViewModel playback");
    expect(joinGraphCliPositionals(["^MainViewModel^", "playback^"])).toBe("MainViewModel playback");
  });

  it("leaves clean argv unchanged", () => {
    expect(normalizeGraphCliText("MainViewModel playback")).toBe("MainViewModel playback");
    expect(joinGraphCliPositionals(["MainViewModel", "playback"])).toBe("MainViewModel playback");
    expect(joinGraphCliPositionals(["MainViewModel playback"])).toBe("MainViewModel playback");
  });
});