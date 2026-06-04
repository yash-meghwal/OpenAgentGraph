import type { ActorIdentity, GraphCapabilities } from "@openagentgraph/shared";

export function getPermissionNotice(
  actor: ActorIdentity,
  capabilities: GraphCapabilities | null | undefined
): string | null {
  if (actor.role === "viewer") {
    return "Viewer access is read-only.";
  }

  if (!capabilities?.canAnnotate) {
    return "This action requires operator access.";
  }

  return null;
}
