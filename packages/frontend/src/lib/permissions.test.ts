import { describe, expect, it } from "vitest";
import { getPermissionNotice } from "./permissions.js";

describe("permission notices", () => {
  it("shows a read-only notice for viewers", () => {
    expect(
      getPermissionNotice(
        {
          actorId: "viewer",
          displayName: "Viewer",
          role: "viewer",
        },
        {
          canAnnotate: false,
          canRequestReview: false,
          canPause: false,
          canResume: false,
          canStop: false,
          canRequestApproval: false,
          canApprove: false,
          canReject: false,
          canContinue: false,
        }
      )
    ).toBe("Viewer access is read-only.");
  });

  it("shows operator guidance when a protected write action is unavailable", () => {
    expect(
      getPermissionNotice(
        {
          actorId: "operator",
          displayName: "Operator",
          role: "operator",
        },
        {
          canAnnotate: false,
          canRequestReview: true,
          canPause: true,
          canResume: false,
          canStop: true,
          canRequestApproval: true,
          canApprove: false,
          canReject: false,
          canContinue: false,
        }
      )
    ).toBe("This action requires operator access.");
  });
});
