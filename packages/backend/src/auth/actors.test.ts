import crypto from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadAppConfig, setAppConfigForTests } from "../config.js";
import { __testUtils, buildAuthSession, resolveAuth } from "./actors.js";

function createJwt(payload: Record<string, unknown>, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

afterEach(() => {
  setAppConfigForTests(undefined);
});

describe("actor resolution", () => {
  it("resolves a valid jwt into the normalized actor shape", () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "production",
        OPENAGENTGRAPH_AUTH_MODE: "jwt",
        OPENAGENTGRAPH_JWT_SECRET: "super-secret",
      })
    );
    const token = createJwt(
      {
        sub: "user-123",
        name: "Priya Reviewer",
        email: "priya@example.com",
        role: "reviewer",
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      "super-secret"
    );

    const resolution = resolveAuth({
      headers: { authorization: `Bearer ${token}` },
    } as any);

    expect(resolution).toEqual({
      authMode: "jwt",
      status: "authenticated",
      actor: {
        actorId: "user-123",
        displayName: "Priya Reviewer",
        role: "reviewer",
      },
      message: "Signed in as Priya Reviewer.",
    });
  });

  it("rejects malformed bearer tokens safely", () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "production",
        OPENAGENTGRAPH_AUTH_MODE: "jwt",
        OPENAGENTGRAPH_JWT_SECRET: "super-secret",
      })
    );

    const resolution = resolveAuth({
      headers: { authorization: "Bearer not-a-real-token" },
    } as any);

    expect(resolution).toEqual({
      authMode: "jwt",
      status: "invalid",
      message: "Your session is not valid for this action.",
    });
  });

  it("marks expired jwt sessions distinctly for the frontend recovery flow", () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "production",
        OPENAGENTGRAPH_AUTH_MODE: "jwt",
        OPENAGENTGRAPH_JWT_SECRET: "super-secret",
      })
    );
    const token = createJwt(
      {
        sub: "user-123",
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      "super-secret"
    );

    const resolution = resolveAuth({
      headers: { authorization: `Bearer ${token}` },
    } as any);

    expect(resolution).toEqual({
      authMode: "jwt",
      status: "expired",
      message: "Your session has expired. Add a new token to continue.",
    });
  });

  it("maps roles deterministically from claim, email allowlist, domain allowlist, then viewer fallback", () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "production",
        OPENAGENTGRAPH_AUTH_MODE: "jwt",
        OPENAGENTGRAPH_JWT_SECRET: "super-secret",
        OPENAGENTGRAPH_AUTH_OPERATOR_EMAILS: "ops@example.com",
        OPENAGENTGRAPH_AUTH_REVIEWER_DOMAINS: "review.example.com",
        OPENAGENTGRAPH_AUTH_ADMIN_EMAILS: "admin@example.com",
      })
    );
    const { mapRoleFromVerifiedIdentity } = __testUtils();

    expect(
      mapRoleFromVerifiedIdentity({ role: "operator", email: "admin@example.com" } as any)
    ).toBe("operator");
    expect(mapRoleFromVerifiedIdentity({ email: "admin@example.com" } as any)).toBe("admin");
    expect(mapRoleFromVerifiedIdentity({ email: "someone@review.example.com" } as any)).toBe("reviewer");
    expect(mapRoleFromVerifiedIdentity({ email: "unknown@example.com" } as any)).toBe("viewer");
  });

  it("keeps dev-header auth disabled unless the mode is explicitly enabled", () => {
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "production",
        OPENAGENTGRAPH_AUTH_MODE: "jwt",
        OPENAGENTGRAPH_JWT_SECRET: "super-secret",
      })
    );

    const session = buildAuthSession({
      headers: {
        "x-openagentgraph-actor-id": "admin",
      },
    } as any);

    expect(session).toEqual({
      authMode: "jwt",
      authRequiredForProtectedActions: true,
      status: "anonymous",
      actor: undefined,
      message: "This environment allows viewing, but protected actions require sign-in.",
    });
  });
});
