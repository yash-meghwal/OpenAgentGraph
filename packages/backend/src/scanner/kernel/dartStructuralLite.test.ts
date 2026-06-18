import { describe, expect, it } from "vitest";
import { augmentDartStructuralLite } from "./dartStructuralLite.js";

const stableId = (prefix: string, raw: string) => `${prefix}:${raw}`;
const compactMetadata = (values: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));

describe("dart structural-lite", () => {
  it("emits import, pubspec dependency, widget_state, and test edges", () => {
    const files = [
      {
        relativePath: "pubspec.yaml",
        body: [
          "name: demo_app",
          "dependencies:",
          "  flutter:",
          "    sdk: flutter",
          "  http: ^1.2.0",
        ].join("\n"),
      },
      {
        relativePath: "lib/main.dart",
        body: [
          "import 'package:demo_app/widgets/home_screen.dart';",
          "void main() {}",
        ].join("\n"),
      },
      {
        relativePath: "lib/widgets/home_screen.dart",
        body: [
          "class HomeScreen extends StatefulWidget {",
          "  State<HomeScreen> createState() => _HomeScreenState();",
          "}",
          "class _HomeScreenState extends State<HomeScreen> {}",
        ].join("\n"),
      },
      {
        relativePath: "test/widget_test.dart",
        body: "import 'package:demo_app/widgets/home_screen.dart';\nvoid main() {}\n",
      },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentDartStructuralLite({
      scanId: "scan-dart",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    expect(semantic.result.active).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "package_dependency")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerImportPath === "package:demo_app/widgets/home_screen.dart")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "widget_state")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "tests")).toBe(true);
  });

  it("emits separate extends, with, and implements edges", () => {
    const files = [
      { relativePath: "lib/mixins.dart", body: "mixin WidgetsBindingObserver {}\n" },
      {
        relativePath: "lib/controller.dart",
        body: "class Controller extends ChangeNotifier with WidgetsBindingObserver implements Runnable { }",
      },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentDartStructuralLite({
      scanId: "scan-dart",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "extends" && edge.metadata?.scannerRelatedType === "ChangeNotifier")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "with" && edge.metadata?.scannerRelatedType === "WidgetsBindingObserver")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "implements" && edge.metadata?.scannerRelatedType === "Runnable")).toBe(true);
  });
});