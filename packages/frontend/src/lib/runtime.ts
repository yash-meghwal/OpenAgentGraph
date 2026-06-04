/// <reference types="vite/client" />

import { runtimeShell } from "./shell.js";

export interface FrontendRuntimeConfig {
  environmentMode: string;
  apiBaseUrl: string;
  apiBaseDisplay: string;
  valid: boolean;
  message?: string;
}

function normalizeBaseUrl(raw: string): string {
  if (!raw) return "";
  if (raw === "/api") return raw;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export function buildFrontendRuntimeConfig(
  env: Record<string, string | boolean | undefined>,
  browserOrigin?: string,
  shellApiBaseUrl?: string
): FrontendRuntimeConfig {
  const environmentMode = String(env.MODE ?? env.NODE_ENV ?? "development");
  const usesLocalProxy = environmentMode === "development" || environmentMode === "test";
  const configuredBase = String(env.VITE_OPENAGENTGRAPH_API_BASE_URL ?? "").trim();
  const shellBase = String(shellApiBaseUrl ?? "").trim();
  const fallbackBase =
    usesLocalProxy
      ? "/api"
      : browserOrigin
        ? `${browserOrigin.replace(/\/$/, "")}`
        : "";
  const candidate = normalizeBaseUrl(configuredBase || shellBase || fallbackBase);

  if (!candidate) {
    return {
      environmentMode,
      apiBaseUrl: "",
      apiBaseDisplay: "(not configured)",
      valid: false,
      message: "The OpenAgentGraph API base URL is not configured.",
    };
  }

  if (candidate.startsWith("/")) {
    return {
      environmentMode,
      apiBaseUrl: candidate,
      apiBaseDisplay: candidate,
      valid: true,
    };
  }

  try {
    const parsed = new URL(candidate);
    return {
      environmentMode,
      apiBaseUrl: parsed.toString().replace(/\/$/, ""),
      apiBaseDisplay: parsed.origin,
      valid: true,
    };
  } catch {
    return {
      environmentMode,
      apiBaseUrl: candidate,
      apiBaseDisplay: candidate,
      valid: false,
      message: "The OpenAgentGraph API base URL is invalid.",
    };
  }
}

const browserOrigin =
  typeof window !== "undefined" && window.location?.origin ? window.location.origin : undefined;

export const frontendRuntimeConfig = buildFrontendRuntimeConfig(
  import.meta.env as Record<string, string | boolean | undefined>,
  browserOrigin,
  runtimeShell.apiBaseUrl
);

export function apiUrl(path: string): string {
  const base = frontendRuntimeConfig.apiBaseUrl;
  if (!base) return path;
  if (base.startsWith("/")) {
    return `${base}${path}`;
  }
  return `${base}${path}`;
}
