import { describe, expect, it } from "vitest";
import { parseComposerProject } from "./composerProjectParsing.js";
import {
  augmentPhpSemanticLite,
  buildPhpImportAliasMap,
  buildPhpWorkspaceIndex,
  mapPhpSemanticLiteRelationToProductEdgeKind,
  parseLaravelRouteTargets,
  resolvePhpQualifiedType,
} from "./phpSemanticLite.js";

const stableId = (prefix: string, raw: string) => `${prefix}:${raw}`;
const compactMetadata = (values: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));

describe("php semantic-lite", () => {
  it("maps semantic-lite relations to product edge kinds", () => {
    expect(mapPhpSemanticLiteRelationToProductEdgeKind("extends")).toBe("extends");
    expect(mapPhpSemanticLiteRelationToProductEdgeKind("implements")).toBe("implements");
    expect(mapPhpSemanticLiteRelationToProductEdgeKind("import")).toBe("depends_on");
    expect(mapPhpSemanticLiteRelationToProductEdgeKind("laravel_route")).toBe("uses");
    expect(mapPhpSemanticLiteRelationToProductEdgeKind("wordpress_hook")).toBe("uses");
    expect(mapPhpSemanticLiteRelationToProductEdgeKind("composer_dependency")).toBe("depends_on");
  });

  it("resolves PSR-4 qualified types through composer autoload mappings", () => {
    const composer = parseComposerProject(JSON.stringify({
      autoload: { "psr-4": { "App\\": "app/" } },
    }));
    const files = [
      {
        relativePath: "app/Models/User.php",
        body: "<?php\nnamespace App\\Models;\nclass User {}",
      },
      {
        relativePath: "app/Http/Controllers/UserController.php",
        body: [
          "<?php",
          "namespace App\\Http\\Controllers;",
          "use App\\Models\\User;",
          "class UserController extends Controller { public function index() {} }",
        ].join("\n"),
      },
    ];
    const index = buildPhpWorkspaceIndex({
      files,
      autoloadMappings: composer!.autoloadMappings,
    });
    const parsedController = files[1]!;
    expect(resolvePhpQualifiedType({
      simpleOrQualified: "User",
      namespaceName: "App\\Http\\Controllers",
      imports: ["App\\Models\\User"],
      index,
    })).toBe("App\\Models\\User");
  });

  it("resolves use ... as Alias imports before local namespace fallback", () => {
    const composer = parseComposerProject(JSON.stringify({
      autoload: { "psr-4": { "App\\": ["src/", "lib/"] } },
    }));
    const files = [
      {
        relativePath: "src/Domain/User.php",
        body: "<?php\nnamespace App\\Domain;\nclass User {}",
      },
      {
        relativePath: "src/Application/UserService.php",
        body: [
          "<?php",
          "namespace App\\Application;",
          "use App\\Domain\\User as DomainUser;",
          "class UserService { public function create(): DomainUser { return new DomainUser(); } }",
        ].join("\n"),
      },
    ];
    const index = buildPhpWorkspaceIndex({
      files,
      autoloadMappings: composer!.autoloadMappings,
    });
    const imports = ["App\\Domain\\User as DomainUser"];
    const aliasMap = buildPhpImportAliasMap(imports);

    expect(resolvePhpQualifiedType({
      simpleOrQualified: "DomainUser",
      namespaceName: "App\\Application",
      imports,
      index,
      aliasMap,
    })).toBe("App\\Domain\\User");
    expect(resolvePhpQualifiedType({
      simpleOrQualified: "DomainUser",
      namespaceName: "App\\Http",
      imports,
      index,
      aliasMap,
    })).toBe("App\\Domain\\User");
  });

  it("emits PSR-4 import, inheritance, Laravel route, and composer dependency edges", () => {
    const files = [
      {
        relativePath: "composer.json",
        body: JSON.stringify({
          name: "fixture/laravel-app",
          require: { "laravel/framework": "^11.0" },
          autoload: { "psr-4": { "App\\": "app/" } },
        }),
      },
      {
        relativePath: "app/Models/User.php",
        body: "<?php\nnamespace App\\Models;\nclass User {}",
      },
      {
        relativePath: "app/Http/Controllers/UserController.php",
        body: [
          "<?php",
          "namespace App\\Http\\Controllers;",
          "use App\\Models\\User;",
          "class UserController extends Controller { public function index() { return User::all(); } }",
        ].join("\n"),
      },
      {
        relativePath: "routes/web.php",
        body: [
          "<?php",
          "use App\\Http\\Controllers\\UserController;",
          "Route::get('/users', [UserController::class, 'index']);",
        ].join("\n"),
      },
    ];
    const fileNodeIdsByPath = new Map(
      files.map((file) => [file.relativePath, stableId("file", file.relativePath)])
    );
    const semantic = augmentPhpSemanticLite({
      scanId: "scan-1",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });

    expect(semantic.result.active).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "import")).toBe(true);
    expect(semantic.edges.some((edge) => edge.kind === "extends")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "laravel_route")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "composer_dependency")).toBe(true);
    expect(semantic.externalNodes.some((node) => node.title.includes("laravel/framework"))).toBe(true);

    const indexMethodNodeId = stableId(
      "code-scan:symbol",
      "app/Http/Controllers/UserController.php|UserController|method|index"
    );
    const routeEdge = semantic.edges.find((edge) => edge.metadata?.scannerRelation === "laravel_route");
    expect(routeEdge?.targetNodeId).toBe(indexMethodNodeId);
    expect(routeEdge?.metadata?.scannerImportResolution).toBe("symbol");
    expect(routeEdge?.metadata?.scannerResolution).toBe("semantic-lite");
  });

  it("resolves aliased Laravel route controllers and array-autoload classes", () => {
    const files = [
      {
        relativePath: "composer.json",
        body: JSON.stringify({
          autoload: { "psr-4": { "App\\": ["src/", "lib/"] } },
        }),
      },
      {
        relativePath: "src/Http/Controllers/UserController.php",
        body: "<?php\nnamespace App\\Http\\Controllers;\nclass UserController { public function index() {} }",
      },
      {
        relativePath: "routes/web.php",
        body: [
          "<?php",
          "use App\\Http\\Controllers\\UserController as Users;",
          "Route::get('/users', [Users::class, 'index']);",
        ].join("\n"),
      },
    ];
    const fileNodeIdsByPath = new Map(
      files.map((file) => [file.relativePath, stableId("file", file.relativePath)])
    );
    const semantic = augmentPhpSemanticLite({
      scanId: "scan-alias-route",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });

    const routeEdge = semantic.edges.find((edge) => edge.metadata?.scannerRelation === "laravel_route");
    expect(routeEdge?.metadata?.scannerRouteController).toBe("App\\Http\\Controllers\\UserController");
    expect(routeEdge?.targetNodeId).toBe(
      stableId("code-scan:symbol", "src/Http/Controllers/UserController.php|UserController|method|index")
    );
  });

  it("parses string-action and invokable Laravel routes", () => {
    expect(parseLaravelRouteTargets([
      "Route::get('/users', 'UserController@index');",
      "Route::post('/users', 'App\\Http\\Controllers\\UserController@store');",
      "Route::get('/dashboard', ShowDashboard::class);",
      "Route::get('/profile', [ProfileController::class]);",
    ].join("\n"))).toEqual(expect.arrayContaining([
      { controllerRef: "UserController", methodName: "index" },
      { controllerRef: "App\\Http\\Controllers\\UserController", methodName: "store" },
      { controllerRef: "ShowDashboard::class", methodName: "__invoke" },
      { controllerRef: "ProfileController::class", methodName: "__invoke" },
    ]));
    expect(parseLaravelRouteTargets([
      "Route::get('/users', 'UserController@index');",
      "Route::post('/users', 'App\\Http\\Controllers\\UserController@store');",
      "Route::get('/dashboard', ShowDashboard::class);",
      "Route::get('/profile', [ProfileController::class]);",
    ].join("\n"))).toHaveLength(4);
  });

  it("emits Laravel route edges for string actions and invokable controllers", () => {
    const files = [
      {
        relativePath: "composer.json",
        body: JSON.stringify({
          autoload: { "psr-4": { "App\\": "app/" } },
        }),
      },
      {
        relativePath: "app/Http/Controllers/UserController.php",
        body: "<?php\nnamespace App\\Http\\Controllers;\nclass UserController { public function index() {} }",
      },
      {
        relativePath: "app/Http/Controllers/ShowDashboard.php",
        body: "<?php\nnamespace App\\Http\\Controllers;\nclass ShowDashboard { public function __invoke() {} }",
      },
      {
        relativePath: "routes/web.php",
        body: [
          "<?php",
          "use App\\Http\\Controllers\\ShowDashboard;",
          "Route::get('/users', 'UserController@index');",
          "Route::get('/dashboard', ShowDashboard::class);",
        ].join("\n"),
      },
    ];
    const fileNodeIdsByPath = new Map(
      files.map((file) => [file.relativePath, stableId("file", file.relativePath)])
    );
    const semantic = augmentPhpSemanticLite({
      scanId: "scan-string-route",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });

    const stringRoute = semantic.edges.find(
      (edge) => edge.metadata?.scannerRouteSyntax === "string" && edge.metadata?.scannerRouteAction === "index"
    );
    expect(stringRoute?.targetNodeId).toBe(
      stableId("code-scan:symbol", "app/Http/Controllers/UserController.php|UserController|method|index")
    );

    const invokableRoute = semantic.edges.find(
      (edge) => edge.metadata?.scannerRouteSyntax === "invokable"
    );
    expect(invokableRoute?.targetNodeId).toBe(
      stableId("code-scan:symbol", "app/Http/Controllers/ShowDashboard.php|ShowDashboard|method|__invoke")
    );
  });

  it("emits WordPress hook callback edges for function and method handlers", () => {
    const files = [
      {
        relativePath: "composer.json",
        body: JSON.stringify({
          autoload: { "psr-4": { "FixturePlugin\\": "includes/" } },
        }),
      },
      {
        relativePath: "my-plugin.php",
        body: [
          "<?php",
          "add_action('init', 'fixture_plugin_bootstrap');",
          "function fixture_plugin_bootstrap() { new FixturePlugin\\Handler(); }",
        ].join("\n"),
      },
      {
        relativePath: "includes/class-handler.php",
        body: [
          "<?php",
          "namespace FixturePlugin;",
          "class Handler {",
          "  public function register(): void { add_filter('the_content', [$this, 'append_notice']); }",
          "  public function append_notice(string $content): string { return $content; }",
          "}",
        ].join("\n"),
      },
    ];
    const fileNodeIdsByPath = new Map(
      files.map((file) => [file.relativePath, stableId("file", file.relativePath)])
    );
    const semantic = augmentPhpSemanticLite({
      scanId: "scan-2",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });

    const hookEdges = semantic.edges.filter((edge) => edge.metadata?.scannerRelation === "wordpress_hook");
    expect(hookEdges.length).toBeGreaterThanOrEqual(2);
    expect(hookEdges.some((edge) => edge.label.includes("init"))).toBe(true);
    expect(hookEdges.some((edge) => edge.label.includes("the_content"))).toBe(true);
  });
});