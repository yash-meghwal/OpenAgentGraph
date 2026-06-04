import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAppConfig, setAppConfigForTests } from "../config.js";
import { renderMetricsText, resetMetricsForTests } from "./metrics.js";
import {
  exportGraphEventToOpenTelemetry,
  initOpenTelemetryExporter,
  resetOpenTelemetryForTests,
  setOpenTelemetryExportTimeoutForTests,
  setOpenTelemetryFetchForTests,
} from "./otel.js";

describe("OpenTelemetry event export", () => {
  afterEach(() => {
    resetOpenTelemetryForTests();
    resetMetricsForTests();
    setAppConfigForTests(undefined);
  });

  it("exports committed node spans as OTLP JSON", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    setOpenTelemetryFetchForTests(fetchMock);
    const config = loadAppConfig({
      NODE_ENV: "test",
      OPENAGENTGRAPH_OTEL_ENABLED: "true",
      OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com",
    });
    setAppConfigForTests(config);
    initOpenTelemetryExporter(config);

    await exportGraphEventToOpenTelemetry({
      id: "evt-1",
      graphId: "graph-1",
      kind: "node.executing",
      nodeId: "node-1",
      payload: { prompt: "Hello", workspaceRoot: "/workspace" },
      ts: "2026-06-01T00:00:00.000Z",
      seq: 1,
    });
    await exportGraphEventToOpenTelemetry({
      id: "evt-2",
      graphId: "graph-1",
      kind: "node.completed",
      nodeId: "node-1",
      payload: {
        output: "World",
        evidence: {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [],
          workspaceChecksum: "",
          workspaceChecksumBefore: "",
          workspaceChecksumAfter: "",
          metadata: {
            durationMs: 42,
            promptTokens: 3,
            completionTokens: 4,
            provider: "openai",
            model: "gpt-test",
            operation: "chat.completions.create",
          },
        },
      },
      ts: "2026-06-01T00:00:01.000Z",
      seq: 2,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://collector.example.com/v1/traces",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
      })
    );
    const body = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body);
    const attributes = body.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    expect(JSON.stringify(attributes)).toContain("openinference.span.kind");
    expect(JSON.stringify(attributes)).toContain("llm.token_count.prompt");
    expect(JSON.stringify(attributes)).toContain("World");
  });

  it("records export failures without throwing", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    setOpenTelemetryFetchForTests(fetchMock);
    const config = loadAppConfig({
      NODE_ENV: "test",
      OPENAGENTGRAPH_OTEL_ENABLED: "true",
      OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com/v1/traces",
    });
    setAppConfigForTests(config);
    initOpenTelemetryExporter(config);

    await expect(exportGraphEventToOpenTelemetry({
      id: "evt-1",
      graphId: "graph-1",
      kind: "node.failed",
      nodeId: "node-1",
      payload: { reason: "failed" },
      ts: "2026-06-01T00:00:00.000Z",
      seq: 1,
    })).resolves.toBeUndefined();

    expect(renderMetricsText()).toContain("openagentgraph_otel_export_failures_total 1");
  });

  it("times out stalled exports without hanging the event append path", async () => {
    const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      signal?.addEventListener("abort", () => reject(new Error("export aborted")));
    })) as unknown as typeof fetch;
    setOpenTelemetryFetchForTests(fetchMock);
    setOpenTelemetryExportTimeoutForTests(5);
    const config = loadAppConfig({
      NODE_ENV: "test",
      OPENAGENTGRAPH_OTEL_ENABLED: "true",
      OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com/v1/traces",
    });
    setAppConfigForTests(config);
    initOpenTelemetryExporter(config);

    await expect(exportGraphEventToOpenTelemetry({
      id: "evt-1",
      graphId: "graph-1",
      kind: "node.failed",
      nodeId: "node-1",
      payload: { reason: "failed" },
      ts: "2026-06-01T00:00:00.000Z",
      seq: 1,
    })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalled();
    expect(renderMetricsText()).toContain("openagentgraph_otel_export_failures_total 1");
  });

  it("cleans active spans after failed completion exports", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 }) as unknown as typeof fetch;
    setOpenTelemetryFetchForTests(fetchMock);
    const config = loadAppConfig({
      NODE_ENV: "test",
      OPENAGENTGRAPH_OTEL_ENABLED: "true",
      OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com",
    });
    setAppConfigForTests(config);
    initOpenTelemetryExporter(config);

    await exportGraphEventToOpenTelemetry({
      id: "evt-1",
      graphId: "graph-1",
      kind: "node.executing",
      nodeId: "node-1",
      payload: { prompt: "Hello", workspaceRoot: "/workspace" },
      ts: "2026-06-01T00:00:00.000Z",
      seq: 1,
    });
    await exportGraphEventToOpenTelemetry({
      id: "evt-2",
      graphId: "graph-1",
      kind: "node.completed",
      nodeId: "node-1",
      payload: {
        output: "failed export",
        evidence: {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [],
          workspaceChecksum: "",
          workspaceChecksumBefore: "",
          workspaceChecksumAfter: "",
          metadata: { durationMs: 42 },
        },
      },
      ts: "2026-06-01T00:00:01.000Z",
      seq: 2,
    });
    await exportGraphEventToOpenTelemetry({
      id: "evt-3",
      graphId: "graph-1",
      kind: "node.completed",
      nodeId: "node-1",
      payload: {
        output: "fallback span",
        evidence: {
          fileDiffs: [],
          commandResults: [],
          toolCallLog: [],
          workspaceChecksum: "",
          workspaceChecksumBefore: "",
          workspaceChecksumAfter: "",
          metadata: { durationMs: 43 },
        },
      },
      ts: "2026-06-01T00:00:02.000Z",
      seq: 3,
    });

    const secondBody = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[1][1].body);
    const span = secondBody.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.startTimeUnixNano).toBe(String(BigInt(Date.parse("2026-06-01T00:00:02.000Z")) * 1_000_000n));
  });

  it("exports failed node metadata as LLM attributes", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    setOpenTelemetryFetchForTests(fetchMock);
    const config = loadAppConfig({
      NODE_ENV: "test",
      OPENAGENTGRAPH_OTEL_ENABLED: "true",
      OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com",
    });
    setAppConfigForTests(config);
    initOpenTelemetryExporter(config);

    await exportGraphEventToOpenTelemetry({
      id: "evt-1",
      graphId: "graph-1",
      kind: "node.failed",
      nodeId: "node-1",
      payload: {
        reason: "failed",
        metadata: {
          durationMs: 77,
          promptTokens: 11,
          completionTokens: 0,
          provider: "openai",
          model: "gpt-test",
          operation: "chat.completions.create",
        },
      },
      ts: "2026-06-01T00:00:00.000Z",
      seq: 1,
    });

    const body = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body);
    const attributes = JSON.stringify(body.resourceSpans[0].scopeSpans[0].spans[0].attributes);
    expect(attributes).toContain("gpt-test");
    expect(attributes).toContain("llm.token_count.prompt");
    expect(attributes).toContain("openagentgraph.duration_ms");
  });
});
