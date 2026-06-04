# OpenAgentGraph Enterprise Observability

OpenAgentGraph now has a first-pass observability and quality layer for SDK instrumentation, optional OpenTelemetry export, evidence compaction, and Product Graph CI gates.

## SDK Instrumentation

Use `@openagentgraph/sdk` to wrap an OpenAI client. The wrapper observes `chat.completions.create`, measures latency and token usage, then sends one bounded telemetry record to OpenAgentGraph.

```ts
import OpenAI from "openai";
import { createOpenAgentGraphClient, wrapOpenAI } from "@openagentgraph/sdk";

const openAgentGraph = createOpenAgentGraphClient({
  baseUrl: "http://127.0.0.1:3001",
  graphId: "graph-id",
  actorHeaders: { "x-openagentgraph-actor-id": "operator" },
  captureContent: false,
  onError: console.warn,
});

const openai = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
  openAgentGraph,
  label: "checkout evaluator",
});
```

Content capture is off by default. If `captureContent` is enabled, use a `redact(value)` callback to remove secrets before previews are sent.

## OpenTelemetry Export

OpenTelemetry export is disabled by default and never blocks event persistence. Enable it only when an OTLP HTTP collector is ready:

```env
OPENAGENTGRAPH_OTEL_ENABLED=true
OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.example.com/v1/traces
OPENAGENTGRAPH_OTEL_EXPORTER_OTLP_HEADERS=x-api-key=replace-with-collector-key
```

OpenAgentGraph maps committed `node.executing`, `node.completed`, and `node.failed` events into LLM-style spans with OpenInference attributes when available.

## Tail-Based Sampling

Healthy `node.completed` evidence is compacted before storage when the call is fast, successful, and not pinned. OpenAgentGraph keeps metadata, checksums, command exit codes, and token counts, but strips heavy command output, tool output, and file diff bodies.

```env
OPENAGENTGRAPH_SAMPLING_ENABLED=true
OPENAGENTGRAPH_SAMPLING_HEALTHY_DURATION_MS=800
```

Set evidence metadata `samplingPinned: true` to preserve full evidence for a completion.

## CI Quality Gate

Run the Product Graph gate locally or in CI:

```bash
npm run gate:check -- --mode hard --allow-empty
```

For local dogfood data outside the default root `data` directory, pass the database directory explicitly:

```bash
npm run gate:check -- --mode hard --allow-empty --data-dir packages/backend/data
```

The gate fails for real Product Graph gaps: unspec'd run-touched code, missing execution evidence, missing test evidence, acceptance criteria without proof, and stale or missing native codebase scans. An empty Product Graph passes with a warning when `--allow-empty` is set so fresh CI environments can bootstrap safely.
