import { describe, expect, it } from "vitest";
import { buildFrontendRuntimeConfig } from "./runtime.js";

describe("frontend runtime config", () => {
  it("uses the local /api proxy in development by default", () => {
    expect(
      buildFrontendRuntimeConfig({
        MODE: "development",
      })
    ).toEqual({
      environmentMode: "development",
      apiBaseUrl: "/api",
      apiBaseDisplay: "/api",
      valid: true,
    });
  });

  it("falls back to same-origin deployment in production when no explicit API base is set", () => {
    expect(
      buildFrontendRuntimeConfig(
        {
          MODE: "production",
        },
        "https://app.example.com"
      )
    ).toEqual({
      environmentMode: "production",
      apiBaseUrl: "https://app.example.com",
      apiBaseDisplay: "https://app.example.com",
      valid: true,
    });
  });

  it("uses a shell-provided API base when running outside a browser origin", () => {
    expect(
      buildFrontendRuntimeConfig(
        {
          MODE: "production",
        },
        undefined,
        "http://127.0.0.1:3001"
      )
    ).toEqual({
      environmentMode: "production",
      apiBaseUrl: "http://127.0.0.1:3001",
      apiBaseDisplay: "http://127.0.0.1:3001",
      valid: true,
    });
  });

  it("rejects an invalid configured API base safely", () => {
    expect(
      buildFrontendRuntimeConfig({
        MODE: "production",
        VITE_OPENAGENTGRAPH_API_BASE_URL: "not a url",
      })
    ).toEqual({
      environmentMode: "production",
      apiBaseUrl: "not a url",
      apiBaseDisplay: "not a url",
      valid: false,
      message: "The OpenAgentGraph API base URL is invalid.",
    });
  });
});
