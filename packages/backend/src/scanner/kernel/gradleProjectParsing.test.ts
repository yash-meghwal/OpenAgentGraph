import { describe, expect, it } from "vitest";
import {
  gradleModuleNameToDirectory,
  normalizeGradleModuleName,
  parseGradleSettingsIncludes,
} from "./gradleProjectParsing.js";

describe("gradle project parsing", () => {
  it("parses quoted, colon-prefixed, and nested Gradle includes", () => {
    const includes = parseGradleSettingsIncludes([
      "rootProject.name = 'demo'",
      "include ':app', ':feature-checkout'",
      'include("feature:payments")',
    ].join("\n"));

    expect(includes).toEqual(expect.arrayContaining(["app", "feature-checkout", "feature:payments"]));
  });

  it("parses multiline Kotlin DSL include blocks", () => {
    const includes = parseGradleSettingsIncludes([
      "rootProject.name = \"demo\"",
      "include(",
      '  ":app",',
      '  ":feature:checkout"',
      ")",
    ].join("\n"));

    expect(includes).toEqual(expect.arrayContaining(["app", "feature:checkout"]));
    expect(includes).toHaveLength(2);
  });

  it("maps Gradle module names to filesystem directories", () => {
    expect(normalizeGradleModuleName(":app")).toBe("app");
    expect(gradleModuleNameToDirectory("feature:payments")).toBe("feature/payments");
  });
});