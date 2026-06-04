import { describe, expect, it } from "vitest";
import {
  formatFrontierStatusLabel,
  formatRuntimeStatusLabel,
  formatSessionLifecycleLabel,
  getOnboardingState,
} from "./productCopy.js";

describe("productCopy", () => {
  it("keeps key runtime wording aligned across shared labels", () => {
    expect(formatRuntimeStatusLabel("connected")).toBe("Connected");
    expect(formatRuntimeStatusLabel("auth_required")).toBe("Auth required");
    expect(formatRuntimeStatusLabel("read_only")).toBe("Read-only");
    expect(formatRuntimeStatusLabel("unreachable")).toBe("Backend unavailable");
    expect(formatSessionLifecycleLabel("read_only")).toBe("Read-only");
    expect(formatSessionLifecycleLabel("invalid_session")).toBe("Auth required");
    expect(formatFrontierStatusLabel("on_track")).toBe("On track");
    expect(formatFrontierStatusLabel("exploring")).toBe("Exploring");
    expect(formatFrontierStatusLabel("drifting")).toBe("Drifting");
    expect(formatFrontierStatusLabel("blocked")).toBe("Blocked");
  });

  it("derives deterministic onboarding guidance from runtime state only", () => {
    expect(
      getOnboardingState({
        runtimeStatus: "unreachable",
        runtimeFallbackLikely: false,
        sessionLifecycle: "signed_in",
      })
    ).toEqual({
      title: "Backend unavailable",
      body: "The OpenAgentGraph backend could not be reached.",
      nextSteps: [
        "Check that the backend is running and reachable from this browser.",
        "Once it reconnects, runs and runtime details will appear here.",
      ],
    });
  });
});
