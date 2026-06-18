import { describe, expect, it } from "vitest";
import {
  parseComposerProject,
  resolveComposerClassPath,
} from "./composerProjectParsing.js";

describe("composer project parsing", () => {
  it("parses PSR-4 autoload mappings and dependencies", () => {
    const project = parseComposerProject(JSON.stringify({
      name: "fixture/demo",
      require: {
        "laravel/framework": "^11.0",
        "symfony/console": "^7.0",
      },
      "require-dev": {
        phpunit: "^11.0",
      },
      autoload: {
        "psr-4": {
          "App\\": "app/",
          "FixturePlugin\\": "includes/",
        },
      },
      "autoload-dev": {
        "psr-4": {
          "Tests\\": "tests/",
        },
      },
    }));

    expect(project?.packageName).toBe("fixture/demo");
    expect(project?.dependencies).toEqual(["laravel/framework", "symfony/console"]);
    expect(project?.devDependencies).toEqual(["phpunit"]);
    expect(project?.autoloadMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: "App\\", directory: "app", standard: "psr-4", isDev: false }),
        expect.objectContaining({ prefix: "FixturePlugin\\", directory: "includes", standard: "psr-4", isDev: false }),
        expect.objectContaining({ prefix: "Tests\\", directory: "tests", standard: "psr-4", isDev: true }),
      ])
    );
  });

  it("resolves qualified class names through PSR-4 mappings", () => {
    const project = parseComposerProject(JSON.stringify({
      autoload: {
        "psr-4": {
          "App\\": "app/",
        },
      },
    }));
    expect(resolveComposerClassPath("App\\Http\\Controllers\\UserController", project!.autoloadMappings))
      .toBe("app/Http/Controllers/UserController.php");
  });

  it("flattens PSR-4 array directory mappings and prefers existing paths", () => {
    const project = parseComposerProject(JSON.stringify({
      autoload: {
        "psr-4": {
          "App\\": ["lib/", "src/"],
        },
      },
    }));

    expect(project?.autoloadMappings).toEqual([
      expect.objectContaining({ prefix: "App\\", directory: "lib", standard: "psr-4" }),
      expect.objectContaining({ prefix: "App\\", directory: "src", standard: "psr-4" }),
    ]);
    expect(resolveComposerClassPath("App\\Domain\\User", project!.autoloadMappings))
      .toBe("lib/Domain/User.php");
    expect(
      resolveComposerClassPath(
        "App\\Domain\\User",
        project!.autoloadMappings,
        new Set(["src/Domain/User.php"])
      )
    ).toBe("src/Domain/User.php");
  });

  it("flattens PSR-0 array directory mappings and prefers existing paths", () => {
    const project = parseComposerProject(JSON.stringify({
      autoload: {
        "psr-0": {
          "Legacy\\": ["lib/", "src/"],
        },
      },
    }));

    expect(project?.autoloadMappings).toEqual([
      expect.objectContaining({ prefix: "Legacy\\", directory: "lib", standard: "psr-0" }),
      expect.objectContaining({ prefix: "Legacy\\", directory: "src", standard: "psr-0" }),
    ]);
    expect(resolveComposerClassPath("Legacy\\Foo_Bar", project!.autoloadMappings))
      .toBe("lib/Foo/Bar.php");
    expect(
      resolveComposerClassPath(
        "Legacy\\Foo_Bar",
        project!.autoloadMappings,
        new Set(["src/Foo/Bar.php"])
      )
    ).toBe("src/Foo/Bar.php");
  });
});