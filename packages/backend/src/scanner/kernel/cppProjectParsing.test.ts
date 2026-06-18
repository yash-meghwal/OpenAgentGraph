import { describe, expect, it } from "vitest";
import { inferCppTestTargetBaseName, parseCMakeLists, parseCompileCommands } from "./cppProjectParsing.js";

describe("cpp project parsing", () => {
  it("parses CMake targets and links", () => {
    const cmake = parseCMakeLists([
      "cmake_minimum_required(VERSION 3.16)",
      "project(DemoApp CXX)",
      "add_library(core src/service.cpp)",
      "add_executable(app src/main.cpp)",
      "target_link_libraries(app PRIVATE core)",
    ].join("\n"));
    expect(cmake.projectName).toBe("DemoApp");
    expect(cmake.targets.map((target) => target.name)).toEqual(expect.arrayContaining(["core", "app"]));
    expect(cmake.links).toEqual([{ source: "app", target: "core" }]);
  });

  it("parses hyphenated CMake targets and legacy target_link_libraries", () => {
    const cmake = parseCMakeLists([
      "project(media-core CXX)",
      "add_library(media-core src/core.cpp)",
      "add_executable(media-app src/main.cpp)",
      "target_link_libraries(media-app media-core)",
    ].join("\n"));
    expect(cmake.projectName).toBe("media-core");
    expect(cmake.targets.map((target) => target.name)).toEqual(
      expect.arrayContaining(["media-core", "media-app"])
    );
    expect(cmake.links).toEqual([{ source: "media-app", target: "media-core" }]);
  });

  it("parses compile_commands.json entries", () => {
    expect(parseCompileCommands(JSON.stringify([
      { directory: ".", file: "src/app.cpp", command: "g++ -c src/app.cpp" },
    ]))).toEqual([{ directory: ".", file: "src/app.cpp" }]);
  });

  it("infers cpp test target base names", () => {
    expect(inferCppTestTargetBaseName("tests/service_test.cpp")).toBe("service");
  });
});