# AI Provider Setup

OpenAgentGraph can open dashboards, scan code, inspect graphs, generate the compact Codex handoff, and write `GRAPH_REPORT.md` without any model provider. Goal execution, planning, summaries, and semantic retrieval need an AI provider.

You can use these paths:

- **Ollama local:** no API key. Run a local model through Ollama at `http://localhost:11434/v1`.
- **OpenAI:** paste a runtime API key in the Dashboard or set `OPENAI_API_KEY` in the backend environment.
- **Gemini:** paste a runtime Gemini key or set `GEMINI_API_KEY`. OAG uses Gemini's OpenAI-compatible endpoint.
- **Anthropic:** paste a runtime Anthropic key or set `ANTHROPIC_API_KEY`. OAG v1 uses Anthropic's OpenAI SDK compatibility mode, not every native Claude API feature.
- **Custom OpenAI-compatible:** provide a model, base URL, and optional key for gateways or local compatible servers.

## Dashboard Setup

1. Start OpenAgentGraph.
2. Open the Dashboard.
3. Use `Provider setup`.
4. Choose `Ollama local - no API key`, `OpenAI API key`, `Gemini API key`, `Anthropic API key`, or `Custom OpenAI-compatible`.
5. Save as an `operator` or `admin` actor.
6. Use `Refresh provider status` from the Current run toolbar before starting a run.

Dashboard changes are kept only in backend process memory. Provider keys are not stored in browser local storage, graph events, logs, metrics, or docs. Restarting the backend clears runtime provider config.

If you save the wrong runtime provider, use `Clear runtime provider`. OpenAgentGraph then falls back to environment provider settings if present, or returns to unconfigured fallback mode.

## Ollama Local Setup

Install and start Ollama, then pull a chat model:

```powershell
ollama pull llama3.2
```

Confirm the local OpenAI-compatible endpoint is answering before saving it in the Dashboard:

```powershell
Invoke-RestMethod http://localhost:11434/v1/models
```

Use these Dashboard values:

```text
Provider: Ollama local - no API key
Model: llama3.2
Base URL: http://localhost:11434/v1
```

Ollama mode is intentionally local-only. If you need a remote gateway or hosted OpenAI-compatible endpoint, choose `Custom OpenAI-compatible` instead.

Environment startup example:

```powershell
$env:OPENAGENTGRAPH_AI_PROVIDER="ollama"
$env:OPENAGENTGRAPH_AI_MODEL="llama3.2"
$env:OPENAGENTGRAPH_OLLAMA_BASE_URL="http://localhost:11434/v1"
npm run dev
```

## OpenAI Setup

Use this path when you want hosted OpenAI execution.

Dashboard setup:

```text
Provider: OpenAI API key
API key: your-openai-api-key
```

Environment startup example:

```powershell
$env:OPENAGENTGRAPH_AI_PROVIDER="openai"
$env:OPENAI_API_KEY="your-openai-api-key"
$env:OPENAGENTGRAPH_AI_MODEL="gpt-4o"
npm run dev
```

Use your real key locally. Do not commit `.env`, paste the key into tests, or place the key in frontend environment files.

## Gemini Setup

Use this path when you want hosted Gemini execution through Google's OpenAI-compatible endpoint.

Dashboard setup:

```text
Provider: Gemini API key
API key: your-gemini-key
Model: gemini-3.5-flash
```

Environment startup example:

```powershell
$env:OPENAGENTGRAPH_AI_PROVIDER="gemini"
$env:GEMINI_API_KEY="your-gemini-key"
$env:OPENAGENTGRAPH_AI_MODEL="gemini-3.5-flash"
npm run dev
```

Reference: [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).

## Anthropic Setup

Use this path when you want hosted Anthropic execution through Anthropic's OpenAI SDK compatibility layer. This is compatibility-mode support in OAG v1; native Claude-only features are not modeled yet.

Dashboard setup:

```text
Provider: Anthropic API key
API key: your-anthropic-key
Model: claude-sonnet-4-6
```

Environment startup example:

```powershell
$env:OPENAGENTGRAPH_AI_PROVIDER="anthropic"
$env:ANTHROPIC_API_KEY="your-anthropic-key"
$env:OPENAGENTGRAPH_AI_MODEL="claude-sonnet-4-6"
npm run dev
```

Reference: [Anthropic OpenAI SDK compatibility](https://docs.anthropic.com/en/api/openai-sdk).

## Custom OpenAI-Compatible Setup

Use this path for gateways, proxies, or local servers that speak the OpenAI-compatible chat completions API.

Dashboard setup:

```text
Provider: Custom OpenAI-compatible
Model: your-model-name
Base URL: https://gateway.example.com/v1
API key: optional-provider-key
```

Environment startup example:

```powershell
$env:OPENAGENTGRAPH_AI_PROVIDER="openai-compatible"
$env:OPENAGENTGRAPH_AI_MODEL="your-model-name"
$env:OPENAGENTGRAPH_AI_BASE_URL="https://gateway.example.com/v1"
$env:OPENAGENTGRAPH_AI_API_KEY="optional-provider-key"
npm run dev
```

Custom base URLs must not include credentials. Remote endpoints must use HTTPS; HTTP is accepted only for localhost or loopback addresses.

## Confirm Readiness

After saving through the Dashboard or restarting the backend with environment provider settings, check readiness:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/ready
```

The provider check should report the selected provider as configured, such as `Ollama provider is configured (...)`, `Gemini provider is configured (...)`, or `OpenAI-compatible provider is configured (...)`, instead of `AI provider is not configured; goal execution is unavailable.`

## If It Still Looks Blocked

- Make sure you saved provider setup as an `operator` or `admin`.
- If a stale Dashboard provider is active, clear the runtime provider and save the correct provider again.
- If using environment settings, restart the backend process after changing provider env vars.
- Make sure Ollama is running before choosing the Ollama provider.
- Make sure hosted provider keys are set only in the backend environment or Dashboard runtime setup.
- Make sure custom base URLs do not include credentials and use HTTPS unless they are local loopback URLs.
- Make sure the frontend is connected to the same backend process you restarted.
- Check the backend terminal output for startup configuration warnings.
