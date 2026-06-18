import { describe, expect, it } from "vitest";
import { parseDartClassHeader, parseDartFile } from "./dartParsing.js";

describe("dart parsing", () => {
  it("parses imports, classes, widgets, and state classes", () => {
    const parsed = parseDartFile([
      "import 'package:flutter/material.dart';",
      "import '../services/api_service.dart';",
      "class HomeScreen extends StatefulWidget {",
      "  @override",
      "  State<HomeScreen> createState() => _HomeScreenState();",
      "}",
      "class _HomeScreenState extends State<HomeScreen> {",
      "  void buildBody() {}",
      "}",
    ].join("\n"), "lib/widgets/home_screen.dart");

    expect(parsed.imports).toEqual(expect.arrayContaining([
      "package:flutter/material.dart",
      "local:../services/api_service.dart",
    ]));
    expect(parsed.symbols.find((symbol) => symbol.name === "HomeScreen")).toMatchObject({
      kind: "stateful_widget",
    });
    expect(parsed.imports).toContain("widget_state:HomeScreen");
    expect(parsed.imports).toContain("extends:StatefulWidget");
  });

  it("splits extends and with clauses into separate relations", () => {
    const parsed = parseDartFile(
      "class Controller extends ChangeNotifier with WidgetsBindingObserver { }",
      "lib/controller.dart"
    );
    expect(parsed.imports).toEqual(expect.arrayContaining([
      "extends:ChangeNotifier",
      "with:WidgetsBindingObserver",
    ]));
    expect(parsed.imports.some((value) => value.includes(" with "))).toBe(false);
  });

  it("parents methods inside State<T> classes", () => {
    const parsed = parseDartFile([
      "class _HomeScreenState extends State<HomeScreen> {",
      "  void buildBody() {}",
      "}",
    ].join("\n"), "lib/widgets/home_screen.dart");
    expect(parsed.symbols.find((symbol) => symbol.name === "buildBody")).toMatchObject({
      kind: "method",
      parentType: "_HomeScreenState",
    });
  });

  it("parses implements clauses", () => {
    const parsed = parseDartFile(
      "class Runner implements Comparable, Runnable { }",
      "lib/runner.dart"
    );
    expect(parsed.imports).toEqual(expect.arrayContaining([
      "implements:Comparable",
      "implements:Runnable",
    ]));
  });

  it("parses class headers with mixed clauses", () => {
    expect(parseDartClassHeader(
      "class Runner extends Base with MixinA implements Comparable, Runnable {"
    )).toEqual({
      name: "Runner",
      extendsClause: "Base",
      withClause: "MixinA",
      implementsClause: "Comparable, Runnable",
      modifiers: [],
      isMixinClass: undefined,
    });
  });

  it("parses Dart 3 class modifiers", () => {
    const parsed = parseDartFile([
      "abstract class Service {",
      "  void run();",
      "}",
      "final class ApiClient {",
      "  void ping() {}",
      "}",
      "sealed class Result {",
      "  const Result();",
      "}",
    ].join("\n"), "lib/services.dart");

    expect(parsed.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual(
      expect.arrayContaining(["Service:class", "ApiClient:class", "Result:class"])
    );
    expect(parsed.symbols.find((symbol) => symbol.name === "ping")).toMatchObject({
      kind: "method",
      parentType: "ApiClient",
    });
  });

  it("parses generic class headers and relations", () => {
    const parsed = parseDartFile([
      "class Repository<T> extends Base<T> with Disposable implements Cache<T> {",
      "  void save() {}",
      "}",
    ].join("\n"), "lib/repository.dart");
    expect(parsed.symbols.find((symbol) => symbol.name === "Repository")).toMatchObject({
      kind: "class",
    });
    expect(parsed.imports).toEqual(expect.arrayContaining([
      "extends:Base",
      "with:Disposable",
      "implements:Cache",
    ]));
    expect(parsed.symbols.find((symbol) => symbol.name === "save")).toMatchObject({
      kind: "method",
      parentType: "Repository",
    });
  });

  it("parses mixin class declarations as classes, not mixins named class", () => {
    const parsed = parseDartFile([
      "mixin class Logger {",
      "  void log(String message) {}",
      "}",
      "mixin Disposable {",
      "  void dispose() {}",
      "}",
    ].join("\n"), "lib/logging.dart");

    expect(parsed.symbols.find((symbol) => symbol.name === "Logger")).toMatchObject({
      kind: "mixin_class",
    });
    expect(parsed.symbols.find((symbol) => symbol.name === "Disposable")).toMatchObject({
      kind: "mixin",
    });
    expect(parsed.symbols.find((symbol) => symbol.name === "log")).toMatchObject({
      kind: "method",
      parentType: "Logger",
    });
    expect(parsed.symbols.some((symbol) => symbol.name === "class")).toBe(false);
  });

  it("marks test files under test/", () => {
    const parsed = parseDartFile("void main() {}", "test/calculator_test.dart");
    expect(parsed.isTestFile).toBe(true);
  });
});