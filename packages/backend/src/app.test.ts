import fs from "fs";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, logStartupDiagnostics } from "./app.js";
import { buildStartupSummary, loadAppConfig, setAppConfigForTests, validateStartupConfig } from "./config.js";
import { setStructuredLogSink } from "./observability/logger.js";
import { renderMetricsText, resetMetricsForTests } from "./observability/metrics.js";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openagentgraph-backend-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  setAppConfigForTests(undefined);
  setStructuredLogSink(undefined);
  resetMetricsForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("backend diagnostics", () => {
  it("returns liveness without leaking secrets", async () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      OPENAI_API_KEY: "super-secret-key",
      DATA_DIR: makeTempDir(),
    });
    const app = await buildApp(config);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      checks: {
        service: {
          status: "ok",
          message: "Backend process is running.",
        },
      },
      timestamp: expect.any(String),
    });
    expect(response.body).not.toContain("super-secret-key");
    await app.close();
  });

  it("exposes the default product graph projection", async () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
    });
    const app = await buildApp(config);

    const response = await app.inject({
      method: "GET",
      url: "/product-graph",
    });

    expect(response.statusCode).toBe(200);
    const projection = response.json();
    expect(projection.schemaVersion).toBe("1");
    expect(projection.productGraphId).toBe("default");
    expect(Array.isArray(projection.nodes)).toBe(true);
    expect(Array.isArray(projection.edges)).toBe(true);
    expect(Array.isArray(projection.events)).toBe(true);
    expect(projection.summary.nodeCount).toBe(projection.nodes.length);
    expect(projection.summary.edgeCount).toBe(projection.edges.length);
    expect(projection.summary.unresolvedOpenQuestionCount).toEqual(expect.any(Number));
    expect(projection.summary.blockedTaskCount).toEqual(expect.any(Number));
    await app.close();
  });

  it("accepts empty scan job POST requests without Content-Type through buildApp()", async () => {
    const workspaceRoot = makeTempDir();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "app.ts"), "export const app = true;\n");
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_WORKSPACE_ROOT: workspaceRoot,
    });
    const app = await buildApp(config);
    const operatorHeaders = { "x-openagentgraph-actor-id": "operator" };

    try {
      for (const url of ["/project-graph/scan-jobs", "/product-graph/codebase/scan-jobs"]) {
        const response = await app.inject({
          method: "POST",
          url,
          headers: operatorHeaders,
          payload: "",
        });

        expect(response.statusCode).toBe(202);
        expect(response.headers["content-type"]).toMatch(/application\/json/);
        expect(response.json()).toMatchObject({
          status: expect.stringMatching(/^(queued|running)$/),
        });
      }
    } finally {
      const [{ resetProjectGraphScanStateForTests }, { codebaseScanState }] = await Promise.all([
        import("./routes/projectGraph.js"),
        import("./routes/productGraphRouteHelpers.js"),
      ]);
      resetProjectGraphScanStateForTests();
      codebaseScanState.inProgress = false;
      await app.close();
    }
  });

  it("exports safe metrics and keeps readiness gauges aligned with /ready", async () => {
    const workspaceRoot = makeTempDir();
    const config = loadAppConfig({
      NODE_ENV: "test",
      OPENAI_API_KEY: "super-secret-key",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_WORKSPACE_ROOT: workspaceRoot,
    });
    const app = await buildApp(config);

    const readyResponse = await app.inject({
      method: "GET",
      url: "/ready",
    });
    await app.inject({
      method: "POST",
      url: "/graphs/graph-secret/pause",
      payload: {},
    });
    const metricsResponse = await app.inject({
      method: "GET",
      url: "/metrics",
    });

    expect(readyResponse.json().status).toBe("ok");
    expect(readyResponse.json().checks.scanner).toMatchObject({
      status: "ok",
      message: "Scanner emergency breakers are configured.",
      details: expect.arrayContaining([
        expect.stringContaining("Lightweight: 20000 files"),
        expect.stringContaining("Semantic: 5000 files"),
      ]),
    });
    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.headers["content-type"]).toContain("text/plain");
    expect(metricsResponse.body).toContain('openagentgraph_readiness_status{status="ok"} 1');
    expect(metricsResponse.body).toContain("openagentgraph_startup_degraded 0");
    expect(metricsResponse.body).toContain("openagentgraph_http_requests_total 2");
    expect(metricsResponse.body).toContain(
      'openagentgraph_http_requests_by_route_total{method="POST",route_group="/graphs/:graphId/pause",status_class="4xx"} 1'
    );
    expect(metricsResponse.body).toContain(
      'openagentgraph_http_request_duration_ms_count{method="POST",route_group="/graphs/:graphId/pause",status_class="4xx"} 1'
    );
    expect(metricsResponse.body).toContain(
      'openagentgraph_failure_events_total{category="auth_missing",component="routes.graphs",outcome="hard"} 1'
    );
    expect(metricsResponse.body).not.toContain("super-secret-key");
    expect(metricsResponse.body).not.toContain(workspaceRoot);
    expect(metricsResponse.body).not.toContain("graph-secret");
    await app.close();
  });

  it("applies configured CORS policy to graph event streams", async () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_ALLOWED_ORIGINS: "http://localhost:5173",
    });
    const app = await buildApp(config);

    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address() as AddressInfo;
      const controller = new AbortController();
      const response = await fetch(`http://127.0.0.1:${address.port}/graphs/graph-1/events`, {
        headers: {
          Origin: "http://localhost:5173",
        },
        signal: controller.signal,
      });

      try {
        expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
        expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
      } finally {
        await response.body?.cancel().catch(() => undefined);
        controller.abort();
      }
    } finally {
      await app.close();
    }
  });

  it("reports degraded readiness deterministically when optional features are unavailable", async () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_WORKSPACE_ROOT: path.join(makeTempDir(), "missing-workspace"),
      OPENAGENTGRAPH_ALLOWED_ORIGINS: "http://localhost:5173",
    });
    const app = await buildApp(config);

    const response = await app.inject({
      method: "GET",
      url: "/ready",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "degraded",
      checks: {
        database: {
          status: "ok",
          message: "Database schema is initialized.",
        },
        provider: {
          status: "degraded",
          message: "AI provider is not configured; goal execution is unavailable.",
          details: [
            "Use Dashboard Provider setup to choose Ollama local, OpenAI, Gemini, Anthropic, or a custom OpenAI-compatible endpoint.",
            "Provider keys are kept only in backend process memory when pasted through the Dashboard.",
            "Graph scans, Project Graph, Code Map, and GRAPH_REPORT.md do not require any provider key.",
            "Ollama can run locally without an API key at http://localhost:11434/v1.",
            "Refresh provider status in OpenAgentGraph before starting the goal run.",
          ],
        },
        workspace: {
          status: "degraded",
          message: "Workspace root is invalid; execution features are unavailable.",
        },
        frontend: {
          status: "ok",
          message: "Frontend origin policy is configured for cross-origin browser access.",
        },
        auth: {
          status: "ok",
          message: "Actor auth mode is configured safely.",
        },
        scanner: {
          status: "ok",
          message: "Scanner emergency breakers are configured.",
          details: expect.arrayContaining([
            expect.stringContaining("Lightweight: 20000 files"),
            expect.stringContaining("Semantic: 5000 files"),
          ]),
        },
      },
      timestamp: expect.any(String),
    });
    const metricsResponse = await app.inject({
      method: "GET",
      url: "/metrics",
    });
    expect(metricsResponse.body).toContain('openagentgraph_readiness_status{status="degraded"} 1');
    expect(metricsResponse.body).toContain("openagentgraph_startup_degraded 1");
    await app.close();
  });

  it("reports degraded frontend readiness when production origin policy is missing", async () => {
    const config = loadAppConfig({
      NODE_ENV: "production",
      OPENAGENTGRAPH_AUTH_MODE: "jwt",
      OPENAGENTGRAPH_JWT_SECRET: "super-secret",
      DATA_DIR: makeTempDir(),
    });
    const app = await buildApp(config);

    const response = await app.inject({
      method: "GET",
      url: "/ready",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "degraded",
      checks: {
        database: {
          status: "ok",
          message: "Database schema is initialized.",
        },
        provider: {
          status: "degraded",
          message: "AI provider is not configured; goal execution is unavailable.",
          details: [
            "Use Dashboard Provider setup to choose Ollama local, OpenAI, Gemini, Anthropic, or a custom OpenAI-compatible endpoint.",
            "Provider keys are kept only in backend process memory when pasted through the Dashboard.",
            "Graph scans, Project Graph, Code Map, and GRAPH_REPORT.md do not require any provider key.",
            "Ollama can run locally without an API key at http://localhost:11434/v1.",
            "Refresh provider status in OpenAgentGraph before starting the goal run.",
          ],
        },
        workspace: {
          status: "ok",
          message: "Workspace root is optional and not configured.",
        },
        frontend: {
          status: "degraded",
          message: "Frontend origin policy is not configured for production deployments.",
        },
        auth: {
          status: "ok",
          message: "JWT auth mode is configured safely.",
        },
        scanner: {
          status: "ok",
          message: "Scanner emergency breakers are configured.",
          details: expect.arrayContaining([
            expect.stringContaining("Lightweight: 20000 files"),
            expect.stringContaining("Semantic: 5000 files"),
          ]),
        },
      },
      timestamp: expect.any(String),
    });
    await app.close();
  });

  it("lets operators configure an OpenAI provider for the running backend process without echoing the key", async () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_ALLOWED_ORIGINS: "http://localhost:5173",
    });
    const app = await buildApp(config);
    const apiKey = "sk-test_runtime_provider_key_123456789";

    const response = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
        "content-type": "application/json",
      },
      payload: { provider: "openai", apiKey },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      configured: true,
      provider: "openai",
      source: "runtime",
      model: "gpt-4o",
      message: "OpenAI provider is configured for this backend process (gpt-4o).",
    });
    expect(response.body).not.toContain(apiKey);

    const statusResponse = await app.inject({
      method: "GET",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
      },
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({
      configured: true,
      provider: "openai",
      source: "runtime",
      model: "gpt-4o",
      message: "OpenAI provider is configured for this backend process (gpt-4o).",
    });
    expect(statusResponse.body).not.toContain(apiKey);

    const readyResponse = await app.inject({
      method: "GET",
      url: "/ready",
    });
    expect(readyResponse.json().checks.provider).toEqual({
      status: "ok",
      message: "OpenAI provider is configured for this backend process (gpt-4o).",
    });

    await app.close();
  });

  it("lets operators configure Ollama without an API key", async () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_ALLOWED_ORIGINS: "http://localhost:5173",
    });
    const app = await buildApp(config);

    const response = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
        "content-type": "application/json",
      },
      payload: {
        provider: "ollama",
        model: "llama3.2",
        baseUrl: "http://localhost:11434/v1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      configured: true,
      provider: "ollama",
      source: "runtime",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1",
      message: "Ollama provider is configured for this backend process (llama3.2).",
    });
    expect(response.body).not.toContain("sk-");

    const readyResponse = await app.inject({
      method: "GET",
      url: "/ready",
    });
    expect(readyResponse.json().checks.provider).toEqual({
      status: "ok",
      message: "Ollama provider is configured for this backend process (llama3.2).",
    });

    await app.close();
  });

  it("lets operators configure Gemini, Anthropic, and custom OpenAI-compatible providers without echoing keys", async () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_ALLOWED_ORIGINS: "http://localhost:5173",
    });
    const app = await buildApp(config);

    const geminiKey = "gemini-test-runtime-key-123456789";
    const geminiResponse = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
        "content-type": "application/json",
      },
      payload: { provider: "gemini", apiKey: geminiKey },
    });
    expect(geminiResponse.statusCode).toBe(200);
    expect(geminiResponse.json()).toEqual({
      configured: true,
      provider: "gemini",
      source: "runtime",
      model: "gemini-3.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      message: "Gemini provider is configured for this backend process (gemini-3.5-flash).",
    });
    expect(geminiResponse.body).not.toContain(geminiKey);

    const anthropicKey = "sk-ant-test-runtime-key-123456789";
    const anthropicResponse = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
        "content-type": "application/json",
      },
      payload: { provider: "anthropic", apiKey: anthropicKey },
    });
    expect(anthropicResponse.statusCode).toBe(200);
    expect(anthropicResponse.json()).toEqual({
      configured: true,
      provider: "anthropic",
      source: "runtime",
      model: "claude-sonnet-4-6",
      baseUrl: "https://api.anthropic.com/v1",
      message: "Anthropic provider is configured for this backend process (claude-sonnet-4-6).",
    });
    expect(anthropicResponse.body).not.toContain(anthropicKey);

    const customKey = "custom-runtime-key-123456789";
    const customResponse = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
        "content-type": "application/json",
      },
      payload: {
        provider: "openai-compatible",
        apiKey: customKey,
        model: "custom-model",
        baseUrl: "https://gateway.example.com/v1",
      },
    });
    expect(customResponse.statusCode).toBe(200);
    expect(customResponse.json()).toEqual({
      configured: true,
      provider: "openai-compatible",
      source: "runtime",
      model: "custom-model",
      baseUrl: "https://gateway.example.com/v1",
      message: "OpenAI-compatible provider is configured for this backend process (custom-model).",
    });
    expect(customResponse.body).not.toContain(customKey);

    await app.close();
  });

  it("protects runtime provider setup from unauthenticated and viewer callers", async () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
    });
    const app = await buildApp(config);

    const missingActorStatusResponse = await app.inject({
      method: "GET",
      url: "/provider/config",
    });
    const viewerStatusResponse = await app.inject({
      method: "GET",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "viewer",
      },
    });
    const missingActorResponse = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "content-type": "application/json",
      },
      payload: { provider: "openai", apiKey: "sk-test_runtime_provider_key_123456789" },
    });
    const viewerResponse = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "viewer",
        "content-type": "application/json",
      },
      payload: { provider: "openai", apiKey: "sk-test_runtime_provider_key_123456789" },
    });
    const invalidKeyResponse = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
        "content-type": "application/json",
      },
      payload: { provider: "openai", apiKey: "bad key" },
    });
    const invalidOllamaBaseUrlResponse = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
        "content-type": "application/json",
      },
      payload: {
        provider: "ollama",
        model: "llama3.2",
        baseUrl: "https://example.com/v1",
      },
    });
    const credentialedOllamaBaseUrlResponse = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
        "content-type": "application/json",
      },
      payload: {
        provider: "ollama",
        model: "llama3.2",
        baseUrl: "http://user:pass@localhost:11434/v1",
      },
    });
    const invalidCustomHttpResponse = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
        "content-type": "application/json",
      },
      payload: {
        provider: "openai-compatible",
        model: "custom-model",
        baseUrl: "http://example.com/v1",
      },
    });
    const missingHostedKeyResponse = await app.inject({
      method: "POST",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "operator",
        "content-type": "application/json",
      },
      payload: {
        provider: "gemini",
      },
    });
    const viewerClearResponse = await app.inject({
      method: "DELETE",
      url: "/provider/config",
      headers: {
        "x-openagentgraph-actor-id": "viewer",
      },
    });

    expect(missingActorStatusResponse.statusCode).toBe(401);
    expect(viewerStatusResponse.statusCode).toBe(403);
    expect(missingActorResponse.statusCode).toBe(401);
    expect(viewerResponse.statusCode).toBe(403);
    expect(viewerClearResponse.statusCode).toBe(403);
    expect(invalidKeyResponse.statusCode).toBe(400);
    expect(invalidOllamaBaseUrlResponse.statusCode).toBe(400);
    expect(credentialedOllamaBaseUrlResponse.statusCode).toBe(400);
    expect(invalidCustomHttpResponse.statusCode).toBe(400);
    expect(missingHostedKeyResponse.statusCode).toBe(400);
    expect(invalidOllamaBaseUrlResponse.json()).toEqual({
      error: "Base URL must be a valid http/https URL without credentials; http is allowed only for localhost or loopback addresses.",
    });
    expect(credentialedOllamaBaseUrlResponse.json()).toEqual({
      error: "Base URL must be a valid http/https URL without credentials; http is allowed only for localhost or loopback addresses.",
    });
    expect(invalidCustomHttpResponse.json()).toEqual({
      error: "Base URL must be a valid http/https URL without credentials; http is allowed only for localhost or loopback addresses.",
    });
    expect(missingHostedKeyResponse.json()).toEqual({
      error: "Gemini API key is required for this provider.",
    });
    expect(invalidKeyResponse.body).not.toContain("sk-test_runtime_provider_key_123456789");

    await app.close();
  });

  it("rejects credentialed Ollama URLs from environment startup config", () => {
    expect(() =>
      loadAppConfig({
        NODE_ENV: "test",
        DATA_DIR: makeTempDir(),
        OPENAGENTGRAPH_AI_PROVIDER: "ollama",
        OPENAGENTGRAPH_AI_MODEL: "llama3.2",
        OPENAGENTGRAPH_OLLAMA_BASE_URL: "http://user:pass@localhost:11434/v1",
      })
    ).toThrow("OPENAGENTGRAPH_OLLAMA_BASE_URL must not include credentials.");

    expect(() =>
      loadAppConfig({
        NODE_ENV: "test",
        DATA_DIR: makeTempDir(),
        OPENAGENTGRAPH_AI_PROVIDER: "ollama",
        OPENAGENTGRAPH_AI_MODEL: "llama3.2",
        OPENAGENTGRAPH_OLLAMA_BASE_URL: "https://example.com/v1",
      })
    ).toThrow("OPENAGENTGRAPH_OLLAMA_BASE_URL must use localhost or a loopback address.");
  });

  it("loads provider-neutral environment config modes and keys", () => {
    const geminiConfig = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      GEMINI_API_KEY: "gemini-test-environment-key-123456789",
    });
    expect(geminiConfig.provider).toMatchObject({
      mode: "gemini",
      configured: true,
      model: "gemini-3.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      source: "environment",
    });
    expect(geminiConfig.provider.apiKey).toBe("gemini-test-environment-key-123456789");

    const anthropicConfig = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant-test-environment-key-123456789",
    });
    expect(anthropicConfig.provider).toMatchObject({
      mode: "anthropic",
      configured: true,
      model: "claude-sonnet-4-6",
      baseUrl: "https://api.anthropic.com/v1",
      source: "environment",
    });

    const customConfig = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_AI_PROVIDER: "openai-compatible",
      OPENAGENTGRAPH_AI_MODEL: "custom-model",
      OPENAGENTGRAPH_AI_BASE_URL: "https://gateway.example.com/v1",
      OPENAGENTGRAPH_AI_API_KEY: "generic-key-wins-123456789",
      OPENAI_API_KEY: "sk-test-openai-fallback-123456789",
    });
    expect(customConfig.provider).toMatchObject({
      mode: "openai-compatible",
      configured: true,
      model: "custom-model",
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "generic-key-wins-123456789",
      source: "environment",
    });

    const noKeyLocalCompatibleConfig = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_AI_PROVIDER: "openai-compatible",
      OPENAGENTGRAPH_AI_MODEL: "local-compatible-model",
      OPENAGENTGRAPH_AI_BASE_URL: "http://127.0.0.2:11434/v1",
    });
    expect(noKeyLocalCompatibleConfig.provider).toMatchObject({
      mode: "openai-compatible",
      configured: true,
      model: "local-compatible-model",
      baseUrl: "http://127.0.0.2:11434/v1",
      source: "environment",
    });
    expect(noKeyLocalCompatibleConfig.provider.apiKey).toBeUndefined();
  });

  it("loads semantic scanner budgets from environment config", () => {
    const defaultConfig = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
    });
    expect(defaultConfig.scanner.scanLimits).toEqual({
      maxFiles: 20_000,
      maxTotalBytes: 200_000_000,
      maxFileBytes: 5_000_000,
      maxDepth: 40,
      maxDurationMs: 180_000,
    });
    expect(defaultConfig.scanner.semanticScanLimits).toEqual({
      maxFiles: 5000,
      maxTotalBytes: 50_000_000,
      maxFileBytes: 5_000_000,
      maxDepth: 40,
      maxDurationMs: 30_000,
    });
    expect(defaultConfig.scanner.semanticAnalysisBudget).toEqual({
      maxFiles: 5000,
      maxTotalBytes: 50_000_000,
      maxDurationMs: 30_000,
    });

    const tunedConfig = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_SCAN_MAX_FILES: "30000",
      OPENAGENTGRAPH_SCAN_MAX_TOTAL_BYTES: "300000000",
      OPENAGENTGRAPH_SCAN_MAX_FILE_BYTES: "7000000",
      OPENAGENTGRAPH_SCAN_MAX_DEPTH: "60",
      OPENAGENTGRAPH_SCAN_MAX_DURATION_MS: "240000",
      OPENAGENTGRAPH_SEMANTIC_MAX_FILES: "8000",
      OPENAGENTGRAPH_SEMANTIC_MAX_TOTAL_BYTES: "120000000",
      OPENAGENTGRAPH_SEMANTIC_MAX_FILE_BYTES: "6000000",
      OPENAGENTGRAPH_SEMANTIC_MAX_DEPTH: "50",
      OPENAGENTGRAPH_SEMANTIC_MAX_DURATION_MS: "90000",
    });
    expect(tunedConfig.scanner.scanLimits).toEqual({
      maxFiles: 30_000,
      maxTotalBytes: 300_000_000,
      maxFileBytes: 7_000_000,
      maxDepth: 60,
      maxDurationMs: 240_000,
    });
    expect(tunedConfig.scanner.semanticScanLimits).toEqual({
      maxFiles: 8000,
      maxTotalBytes: 120_000_000,
      maxFileBytes: 6_000_000,
      maxDepth: 50,
      maxDurationMs: 90_000,
    });
    expect(tunedConfig.scanner.semanticAnalysisBudget).toEqual({
      maxFiles: 8000,
      maxTotalBytes: 120_000_000,
      maxDurationMs: 90_000,
    });
  });

  it("clears a runtime provider config and falls back to the environment key when present", async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test_environment_provider_key_123456789";
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    });
    const app = await buildApp(config);
    const runtimeKey = "sk-test_runtime_provider_key_123456789";

    try {
      const configureResponse = await app.inject({
        method: "POST",
        url: "/provider/config",
        headers: {
          "x-openagentgraph-actor-id": "admin",
          "content-type": "application/json",
        },
        payload: { provider: "openai", apiKey: runtimeKey },
      });
      const clearResponse = await app.inject({
        method: "DELETE",
        url: "/provider/config",
        headers: {
          "x-openagentgraph-actor-id": "admin",
        },
      });

      expect(configureResponse.statusCode).toBe(200);
      expect(clearResponse.statusCode).toBe(200);
      expect(clearResponse.json()).toEqual({
        configured: true,
        provider: "openai",
        source: "environment",
        model: "gpt-4o",
        message: "OpenAI provider is configured (gpt-4o).",
      });
      expect(clearResponse.body).not.toContain(runtimeKey);
      expect(clearResponse.body).not.toContain(process.env.OPENAI_API_KEY);
    } finally {
      await app.close();
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
    }
  });

  it("applies the configured origin policy to browser requests", async () => {
    const config = loadAppConfig({
      NODE_ENV: "production",
      OPENAGENTGRAPH_AUTH_MODE: "jwt",
      OPENAGENTGRAPH_JWT_SECRET: "super-secret",
      OPENAGENTGRAPH_ALLOWED_ORIGINS: "https://app.example.com",
      DATA_DIR: makeTempDir(),
    });
    const app = await buildApp(config);

    const allowedResponse = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "https://app.example.com",
      },
    });
    const blockedResponse = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "https://unexpected.example.com",
      },
    });

    expect(allowedResponse.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(blockedResponse.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("flags unsafe production auth combinations during startup validation", () => {
    const config = loadAppConfig({
      NODE_ENV: "production",
      OPENAGENTGRAPH_AUTH_MODE: "dev_header",
      OPENAGENTGRAPH_ALLOW_ACTOR_HEADERS: "true",
      DATA_DIR: makeTempDir(),
    });

    expect(validateStartupConfig(config)).toEqual({
      errors: ["Development actor-header auth is enabled in production without explicit opt-in."],
      warnings: [
        "AI provider is not configured; goal execution is unavailable.",
        "Frontend origin policy is not configured for production deployments.",
      ],
    });
  });

  it("requires a jwt secret when production jwt auth is enabled", () => {
    const config = loadAppConfig({
      NODE_ENV: "production",
      OPENAGENTGRAPH_AUTH_MODE: "jwt",
      DATA_DIR: makeTempDir(),
    });

    expect(validateStartupConfig(config)).toEqual({
      errors: ["JWT auth mode requires OPENAGENTGRAPH_JWT_SECRET."],
      warnings: [
        "AI provider is not configured; goal execution is unavailable.",
        "Frontend origin policy is not configured for production deployments.",
      ],
    });
  });

  it("returns a safe auth session summary for jwt mode", async () => {
    const config = loadAppConfig({
      NODE_ENV: "production",
      OPENAGENTGRAPH_AUTH_MODE: "jwt",
      OPENAGENTGRAPH_JWT_SECRET: "super-secret",
      DATA_DIR: makeTempDir(),
    });
    const app = await buildApp(config);

    const response = await app.inject({
      method: "GET",
      url: "/auth/session",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authMode: "jwt",
      authRequiredForProtectedActions: true,
      status: "anonymous",
      message: "This environment allows viewing, but protected actions require sign-in.",
    });
    await app.close();
  });

  it("emits startup summary and degraded warnings that match the real config state", () => {
    const entries: Array<Record<string, unknown>> = [];
    setStructuredLogSink((entry) => {
      entries.push(entry as unknown as Record<string, unknown>);
    });

    const config = loadAppConfig({
      NODE_ENV: "test",
      DATA_DIR: makeTempDir(),
      OPENAGENTGRAPH_WORKSPACE_ROOT: path.join(makeTempDir(), "missing-workspace"),
    });

    expect(buildStartupSummary(config)).toEqual({
      environmentMode: "test",
      authMode: "development actor headers with default dev actors",
      workspaceStatus: "workspace root invalid",
      databaseStatus: expect.stringContaining("openagentgraph.db"),
      providerStatus: "AI provider unavailable for goal execution",
      frontendStatus: "frontend origin policy not configured",
      degraded: true,
      summaryLine:
        "Startup summary: test mode, development actor headers with default dev actors, workspace root invalid, AI provider unavailable for goal execution, frontend origin policy not configured.",
    });

    logStartupDiagnostics(config);

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "startup",
          message:
            "Startup summary: test mode, development actor headers with default dev actors, workspace root invalid, AI provider unavailable for goal execution, frontend origin policy not configured.",
        }),
        expect.objectContaining({
          component: "startup",
          message: "Startup is running with degraded or invalid configuration.",
          errorCode: "STARTUP_DEGRADED_WARNING",
        }),
        expect.objectContaining({
          component: "startup",
          message: "Workspace root is invalid; execution features are unavailable.",
          errorCode: "STARTUP_WARNING",
        }),
      ])
    );
    const metrics = renderMetricsText();
    expect(metrics).toContain(
      'openagentgraph_failure_events_total{category="startup_degraded",component="startup",outcome="recovered"} 1'
    );
    expect(metrics).toContain(
      'openagentgraph_failure_events_total{category="workspace_invalid",component="startup",outcome="recovered"} 1'
    );
  });
});
