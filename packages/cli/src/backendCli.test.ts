import fs from "fs";
import { describe, expect, it } from "vitest";
import { OAG_CLI_COMMANDS, resolveBackendCliEntry } from "./backendCli.js";

describe("backendCli routing", () => {
  it("resolves a backend entry for every published command", () => {
    for (const command of OAG_CLI_COMMANDS) {
      const entry = resolveBackendCliEntry(command);
      expect(entry, command).toBeTruthy();
      expect(fs.existsSync(entry!), command).toBe(true);
    }
  });
});