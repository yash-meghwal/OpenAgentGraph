import { describe, expect, it } from "vitest";
import { parseGraphScorecardArgv } from "./graphScorecard.js";

describe("graph scorecard cli", () => {
  it("defaults CLI clean-install smoke status to not_run", () => {
    const options = parseGraphScorecardArgv(["--no-external", "--no-update", "--json"]);
    expect(options.cliSmokeStatus).toBe("not_run");
  });

  it("accepts explicit CLI clean-install smoke status values", () => {
    expect(parseGraphScorecardArgv(["--cli-smoke-status", "pass"]).cliSmokeStatus).toBe("pass");
    expect(parseGraphScorecardArgv(["--cli-smoke-status", "fail"]).cliSmokeStatus).toBe("fail");
    expect(parseGraphScorecardArgv(["--cli-smoke-status", "not_run"]).cliSmokeStatus).toBe("not_run");
  });

  it("rejects invalid CLI clean-install smoke status values", () => {
    expect(() => parseGraphScorecardArgv(["--cli-smoke-status", "maybe"])).toThrow(/Invalid --cli-smoke-status/);
  });
});