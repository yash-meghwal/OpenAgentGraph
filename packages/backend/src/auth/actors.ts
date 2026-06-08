import crypto from "crypto";
import type { FastifyRequest } from "fastify";
import type {
  ActorIdentity,
  ActorRole,
  AuthMode,
  AuthSessionResponse,
  GraphCapabilities,
  GraphProjection,
} from "@openagentgraph/shared";
import { getAppConfig } from "../config.js";

export type ProtectedAction =
  | "annotate"
  | "request_review"
  | "pause"
  | "resume"
  | "stop"
  | "request_approval"
  | "approve"
  | "reject"
  | "continue"
  | "manage_product_graph"
  | "agent_read"
  | "agent_report"
  | "agent_propose"
  | "agent_admin";

type VerifiedJwtClaims = {
  sub?: string;
  name?: string;
  email?: string;
  role?: unknown;
  exp?: number;
  nbf?: number;
};

export interface AuthResolution {
  actor?: ActorIdentity;
  authMode: AuthMode;
  status: "authenticated" | "missing" | "invalid" | "expired";
  message: string;
}

const ACTION_MESSAGES: Record<ProtectedAction, string> = {
  annotate: "This action requires operator access.",
  request_review: "This action requires operator access.",
  pause: "This action requires operator access.",
  resume: "This action requires operator access.",
  stop: "This action requires operator access.",
  request_approval: "This action requires operator access.",
  approve: "You do not have permission to approve this run.",
  reject: "You do not have permission to reject this run.",
  continue: "You do not have permission to continue this run.",
  manage_product_graph: "This action requires operator access.",
  agent_read: "This action requires signed-in viewer access.",
  agent_report: "This action requires operator access.",
  agent_propose: "This action requires operator access.",
  agent_admin: "This action requires operator access.",
};

function configuredActors(): Record<string, ActorIdentity> {
  return getAppConfig().auth.configuredActors;
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function parseJwt(token: string): { header: { alg?: string }; claims: VerifiedJwtClaims } | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;

  try {
    return {
      header: JSON.parse(decodeBase64Url(parts[0])) as { alg?: string },
      claims: JSON.parse(decodeBase64Url(parts[1])) as VerifiedJwtClaims,
    };
  } catch {
    return undefined;
  }
}

function verifyJwtSignature(token: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function verifyJwtToken(token: string): { claims?: VerifiedJwtClaims; message?: string } {
  const config = getAppConfig();
  if (!config.auth.jwtSecret) {
    return { message: "JWT auth is not configured correctly." };
  }

  const parsed = parseJwt(token);
  if (!parsed) {
    return { message: "Your session is not valid for this action." };
  }
  if (parsed.header.alg !== "HS256") {
    return { message: "Your session is not valid for this action." };
  }
  if (!verifyJwtSignature(token, config.auth.jwtSecret)) {
    return { message: "Your session is not valid for this action." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof parsed.claims.nbf === "number" && now < parsed.claims.nbf) {
    return { message: "Your session is not valid for this action." };
  }
  if (typeof parsed.claims.exp === "number" && now >= parsed.claims.exp) {
    return { message: "Your session has expired. Add a new token to continue." };
  }

  return { claims: parsed.claims };
}

function normalizeDisplayName(claims: VerifiedJwtClaims, actorId: string): string {
  if (typeof claims.name === "string" && claims.name.trim()) {
    return claims.name.trim();
  }
  if (typeof claims.email === "string" && claims.email.trim()) {
    return claims.email.trim();
  }
  return actorId;
}

function mapRoleFromVerifiedIdentity(claims: VerifiedJwtClaims): ActorRole {
  const config = getAppConfig();
  const roleClaim = typeof claims.role === "string" ? claims.role : undefined;
  if (roleClaim === "viewer" || roleClaim === "operator" || roleClaim === "reviewer" || roleClaim === "admin") {
    return roleClaim;
  }

  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : undefined;
  const domain = email?.includes("@") ? email.split("@")[1] : undefined;

  // Precedence is strict and centralized:
  // 1. Valid explicit token role claim
  // 2. Exact email allowlists
  // 3. Email-domain allowlists
  // 4. Safe fallback to viewer
  if (email && config.auth.roleMapping.adminEmails.includes(email)) return "admin";
  if (email && config.auth.roleMapping.reviewerEmails.includes(email)) return "reviewer";
  if (email && config.auth.roleMapping.operatorEmails.includes(email)) return "operator";
  if (domain && config.auth.roleMapping.adminDomains.includes(domain)) return "admin";
  if (domain && config.auth.roleMapping.reviewerDomains.includes(domain)) return "reviewer";
  if (domain && config.auth.roleMapping.operatorDomains.includes(domain)) return "operator";
  return "viewer";
}

function actorFromClaims(claims: VerifiedJwtClaims): ActorIdentity | undefined {
  const actorId =
    (typeof claims.sub === "string" && claims.sub.trim()) ||
    (typeof claims.email === "string" && claims.email.trim()) ||
    (typeof claims.name === "string" && claims.name.trim());

  if (!actorId) return undefined;

  return {
    actorId,
    displayName: normalizeDisplayName(claims, actorId),
    role: mapRoleFromVerifiedIdentity(claims),
  };
}

export function getAvailableActors(): ActorIdentity[] {
  return Object.values(configuredActors()).sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function resolveAuth(request: FastifyRequest): AuthResolution {
  const config = getAppConfig();

  if (config.auth.mode === "jwt") {
    const authorization = request.headers.authorization;
    if (!authorization) {
      return {
        authMode: "jwt",
        status: "missing",
        message: "This action requires a signed-in operator.",
      };
    }
    const [scheme, token] = authorization.split(" ");
    if (scheme !== "Bearer" || !token) {
      return {
        authMode: "jwt",
        status: "invalid",
        message: "Your session is not valid for this action.",
      };
    }
    const verified = verifyJwtToken(token);
    if (!verified.claims) {
      return {
        authMode: "jwt",
        status: verified.message?.includes("expired") ? "expired" : "invalid",
        message: verified.message ?? "Your session is not valid for this action.",
      };
    }
    const actor = actorFromClaims(verified.claims);
    if (!actor) {
      return {
        authMode: "jwt",
        status: "invalid",
        message: "Your session is not valid for this action.",
      };
    }
    return {
      authMode: "jwt",
      status: "authenticated",
      actor,
      message: `Signed in as ${actor.displayName}.`,
    };
  }

  if (!config.auth.allowActorHeaders) {
    return {
      authMode: "dev_header",
      status: "missing",
      message: "This action requires a signed-in operator.",
    };
  }
  const actorIdHeader = request.headers["x-openagentgraph-actor-id"];
  const actorId = Array.isArray(actorIdHeader) ? actorIdHeader[0] : actorIdHeader;
  if (!actorId) {
    return {
      authMode: "dev_header",
      status: "missing",
      message: "This action requires a signed-in operator.",
    };
  }

  const actor = configuredActors()[actorId];
  if (!actor) {
    return {
      authMode: "dev_header",
      status: "invalid",
      message: "Your session is not valid for this action.",
    };
  }

  return {
    authMode: "dev_header",
    status: "authenticated",
    actor,
    message: `Signed in as ${actor.displayName}.`,
  };
}

export function resolveActor(request: FastifyRequest): ActorIdentity | undefined {
  return resolveAuth(request).actor;
}

export function buildAuthSession(request: FastifyRequest): AuthSessionResponse {
  const resolution = resolveAuth(request);
  return {
    authMode: resolution.authMode,
    authRequiredForProtectedActions: true,
    status:
      resolution.status === "missing"
        ? "anonymous"
        : resolution.status,
    actor: resolution.actor,
    message:
      resolution.status === "authenticated"
        ? resolution.message
        : resolution.status === "expired"
          ? "Your session has expired. Add a new token to continue."
        : resolution.status === "missing" && resolution.authMode === "jwt"
          ? "This environment allows viewing, but protected actions require sign-in."
        : resolution.authMode === "jwt"
          ? "Please sign in again to continue."
          : "Development auth is using local actor headers.",
  };
}

export function canActorPerform(actor: ActorIdentity | undefined, action: ProtectedAction): boolean {
  if (!actor) return false;

  switch (actor.role) {
    case "admin":
      return true;
    case "reviewer":
      return ![
        "request_approval",
        "manage_product_graph",
        "agent_report",
        "agent_propose",
        "agent_admin",
      ].includes(action);
    case "operator":
      return [
        "annotate",
        "request_review",
        "pause",
        "resume",
        "stop",
        "request_approval",
        "manage_product_graph",
        "agent_read",
        "agent_report",
        "agent_propose",
        "agent_admin",
      ].includes(action);
    case "viewer":
      return action === "agent_read";
  }
}

export function permissionMessage(action: ProtectedAction): string {
  return ACTION_MESSAGES[action];
}

export function deriveCapabilities(
  actor: ActorIdentity | undefined,
  projection: Pick<
    GraphProjection,
    "canPause" | "canResume" | "canStop" | "approvalState" | "waitingForApproval"
  >
): GraphCapabilities {
  return {
    canAnnotate: canActorPerform(actor, "annotate"),
    canRequestReview: canActorPerform(actor, "request_review"),
    canPause: canActorPerform(actor, "pause") && projection.canPause,
    canResume: canActorPerform(actor, "resume") && projection.canResume,
    canStop: canActorPerform(actor, "stop") && projection.canStop,
    canRequestApproval: canActorPerform(actor, "request_approval"),
    canApprove: canActorPerform(actor, "approve"),
    canReject: canActorPerform(actor, "reject"),
    canContinue: canActorPerform(actor, "continue"),
  };
}

export function __testUtils() {
  return {
    verifyJwtToken,
    mapRoleFromVerifiedIdentity,
    actorFromClaims,
  };
}
