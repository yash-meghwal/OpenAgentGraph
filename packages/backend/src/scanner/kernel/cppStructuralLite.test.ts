import { describe, expect, it } from "vitest";
import {
  augmentCppStructuralLite,
  resolveCppLocalInclude,
} from "./cppStructuralLite.js";
import { resolveCompileCommandFilePath } from "./cppProjectParsing.js";

const stableId = (prefix: string, raw: string) => `${prefix}:${raw}`;
const compactMetadata = (values: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));

describe("cpp structural-lite", () => {
  it("resolves local include paths to workspace files", () => {
    const fileNodeIdsByPath = new Map([
      ["include/service.h", stableId("file", "include/service.h")],
    ]);
    const resolved = resolveCppLocalInclude(
      "local:service.h",
      "src/main.cpp",
      fileNodeIdsByPath
    );
    expect(resolved?.targetNodeId).toBe(stableId("file", "include/service.h"));
  });

  it("emits include, cmake link, compile unit, and test edges", () => {
    const files = [
      {
        relativePath: "CMakeLists.txt",
        body: [
          "project(DemoApp CXX)",
          "add_library(core src/service.cpp)",
          "add_executable(app src/main.cpp)",
          "target_link_libraries(app PRIVATE core)",
        ].join("\n"),
      },
      { relativePath: "include/service.h", body: "#pragma once\nint run_service();\n" },
      { relativePath: "src/service.cpp", body: '#include "service.h"\nint run_service() { return 0; }\n' },
      { relativePath: "src/main.cpp", body: '#include "service.h"\nint main() { return run_service(); }\n' },
      { relativePath: "tests/service_test.cpp", body: '#include "service.h"\nint test_service() { return run_service(); }\n' },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentCppStructuralLite({
      scanId: "scan-cpp",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    expect(semantic.result.active).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerImportPath === "local:service.h")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "cmake_link")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "tests")).toBe(true);
  });

  it("resolves absolute compile_commands paths to workspace files", () => {
    const workspacePaths = ["src/app.cpp", "include/app.h"];
    expect(resolveCompileCommandFilePath(
      { directory: "/tmp/build", file: "/home/user/proj/src/app.cpp" },
      workspacePaths
    )).toBe("src/app.cpp");
  });

  it("emits compile_unit edges instead of include for compile databases", () => {
    const files = [
      {
        relativePath: "compile_commands.json",
        body: JSON.stringify([
          {
            directory: "/tmp/build",
            file: "/home/user/proj/src/app.cpp",
            command: "g++ -c /home/user/proj/src/app.cpp",
          },
        ]),
      },
      { relativePath: "src/app.cpp", body: "int main() { return 0; }\n" },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentCppStructuralLite({
      scanId: "scan-cpp",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "compile_unit")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "include"
      && edge.metadata?.scannerCompileDirectory)).toBe(false);
  });
});