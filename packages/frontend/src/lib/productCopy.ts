import type { FrontierStatus } from "@openagentgraph/shared";

export type RuntimeStatusView =
  | "connected"
  | "degraded"
  | "read_only"
  | "auth_required"
  | "unreachable";

export type SessionLifecycleView =
  | "signed_in"
  | "read_only"
  | "auth_required"
  | "invalid_session"
  | "expired_session";

export function formatRuntimeStatusLabel(status: RuntimeStatusView): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "degraded":
      return "Degraded";
    case "read_only":
      return "Read-only";
    case "auth_required":
      return "Auth required";
    case "unreachable":
      return "Backend unavailable";
  }
}

export function formatSessionLifecycleLabel(sessionLifecycle: SessionLifecycleView): string {
  switch (sessionLifecycle) {
    case "signed_in":
      return "Signed in";
    case "expired_session":
      return "Session expired";
    case "invalid_session":
      return "Auth required";
    case "auth_required":
      return "Auth required";
    case "read_only":
    default:
      return "Read-only";
  }
}

export function formatFrontierStatusLabel(status: FrontierStatus | null | undefined): string {
  switch (status) {
    case "on_track":
      return "On track";
    case "exploring":
      return "Exploring";
    case "drifting":
      return "Drifting";
    case "blocked":
      return "Blocked";
    default:
      return "On track";
  }
}

export function getRuntimeBannerTone(status: RuntimeStatusView) {
  switch (status) {
    case "connected":
      return {
        background: "#10261d",
        border: "#1f4b37",
        accent: "#9ae6b4",
      };
    case "degraded":
      return {
        background: "#1c2432",
        border: "#31405a",
        accent: "#90cdf4",
      };
    case "auth_required":
      return {
        background: "#342816",
        border: "#6b4f1f",
        accent: "#f6e05e",
      };
    case "read_only":
      return {
        background: "#1f2937",
        border: "#374151",
        accent: "#cbd5e0",
      };
    case "unreachable":
    default:
      return {
        background: "#351d1d",
        border: "#6b2b2b",
        accent: "#feb2b2",
      };
  }
}

export function getOnboardingState(input: {
  runtimeStatus: RuntimeStatusView;
  runtimeFallbackLikely: boolean;
  sessionLifecycle: SessionLifecycleView;
}) {
  if (input.runtimeStatus === "unreachable") {
    return {
      title: "Backend unavailable",
      body: "The OpenAgentGraph backend could not be reached.",
      nextSteps: [
        "Check that the backend is running and reachable from this browser.",
        "Once it reconnects, runs and runtime details will appear here.",
      ],
    };
  }

  if (input.runtimeStatus === "degraded") {
    return {
      title: "Backend connected with limits",
      body: input.runtimeFallbackLikely
        ? "Backend connected, but some AI features are currently using fallback behavior."
        : "Backend connected, but some features are currently limited.",
      nextSteps: [
        "You can still inspect runs and replay progress from the current projection state.",
        "Operator controls will become more useful once the backend is fully ready.",
      ],
    };
  }

  if (input.sessionLifecycle === "expired_session") {
    return {
      title: "Session expired",
      body: "Your session has expired. Add a new token to continue.",
      nextSteps: [
        "You can keep viewing runs while the session is refreshed.",
        "Protected actions will return once a valid session is available.",
      ],
    };
  }

  if (input.sessionLifecycle === "invalid_session") {
    return {
      title: "Auth required",
      body: "Your session is not valid for this action. Add a new token to continue.",
      nextSteps: [
        "You can keep viewing runs while you update the token.",
        "Protected actions will return once the session is valid again.",
      ],
    };
  }

  if (input.sessionLifecycle === "read_only") {
    return {
      title: "Read-only mode",
      body: "You can view this workspace, but protected actions require sign-in.",
      nextSteps: [
        "Runs will still appear here when the backend creates them.",
        "Sign in when you want to manage runs, approvals, or annotations.",
      ],
    };
  }

  return {
    title: "No runs yet",
    body: "No runs yet. OpenAgentGraph is ready to observe or manage runs once the backend has created them.",
    nextSteps: [
      "Runs appear here after the backend creates them for a workspace.",
      "Open a run to inspect the graph, evidence, replay, and human decisions.",
    ],
  };
}
