import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  mcpOagCheck,
  mcpOagContext,
  mcpOagExplain,
  mcpOagExport,
  mcpOagPath,
  mcpOagQuery,
  mcpOagRetrieve,
} from "./oagTools.js";

const TOOL_DEFINITIONS = [
  {
    name: "oag_export",
    description: "Export or refresh OAG static graph artifacts (.oag/graph.json, graph.html, wiki, GRAPH_REPORT.md).",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Absolute workspace path." },
        offlineOnly: { type: "boolean", description: "Require offline-only export (default true)." },
        redactRoot: { type: "boolean", description: "Redact absolute workspace root in shareable artifacts." },
        refresh: { type: "boolean", description: "Force rescan even when cache exists." },
      },
      required: ["workspace"],
    },
  },
  {
    name: "oag_query",
    description: "Bounded BFS/DFS graph query over a workspace graph. No source bodies returned.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        query: { type: "string" },
        mode: { type: "string", enum: ["code", "docs", "balanced"] },
        lens: { type: "string" },
        budget: { type: "number" },
        refresh: { type: "boolean" },
      },
      required: ["workspace", "query"],
    },
  },
  {
    name: "oag_path",
    description: "Find a ranked path between two graph targets with provenance.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        mode: { type: "string", enum: ["semantic", "balanced", "structural"] },
        maxHops: { type: "number" },
        lens: { type: "string" },
        refresh: { type: "boolean" },
      },
      required: ["workspace", "from", "to"],
    },
  },
  {
    name: "oag_explain",
    description: "Explain a node or file: neighbors, community, warnings.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        target: { type: "string" },
        refresh: { type: "boolean" },
      },
      required: ["workspace", "target"],
    },
  },
  {
    name: "oag_check",
    description: "Run OAG fusion release checks, analyzer status, and support matrix.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        mode: { type: "string", enum: ["hard", "warn"] },
        refresh: { type: "boolean" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "oag_context",
    description: "Bounded agent context pack with read-first nodes, risks, and retrieval hints.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        goal: { type: "string" },
        mode: { type: "string", enum: ["code", "docs", "balanced"] },
        lens: { type: "string" },
        budget: { type: "number" },
        refresh: { type: "boolean" },
        redactRoot: { type: "boolean" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "oag_retrieve",
    description: "Retrieve deeper graph metadata by stable OAG retrieval id.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        id: { type: "string" },
        refresh: { type: "boolean" },
      },
      required: ["workspace", "id"],
    },
  },
] as const;

function formatToolError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createOagMcpServer() {
  const server = new Server(
    { name: "openagentgraph", version: "1.4.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      let result: unknown;

      switch (request.params.name) {
        case "oag_export":
          result = await mcpOagExport({
            workspace: String(args.workspace),
            offlineOnly: args.offlineOnly !== false,
            redactRoot: args.redactRoot !== false,
            refresh: Boolean(args.refresh),
          });
          break;
        case "oag_query":
          result = await mcpOagQuery({
            workspace: String(args.workspace),
            query: String(args.query),
            mode: args.mode !== undefined && args.mode !== null ? String(args.mode) : undefined,
            lens: typeof args.lens === "string" ? args.lens as never : undefined,
            budget: typeof args.budget === "number" ? args.budget : undefined,
            refresh: Boolean(args.refresh),
          });
          break;
        case "oag_path":
          result = await mcpOagPath({
            workspace: String(args.workspace),
            from: String(args.from),
            to: String(args.to),
            mode: args.mode !== undefined && args.mode !== null ? String(args.mode) : undefined,
            maxHops: typeof args.maxHops === "number" ? args.maxHops : undefined,
            lens: typeof args.lens === "string" ? args.lens as never : undefined,
            refresh: Boolean(args.refresh),
          });
          break;
        case "oag_explain":
          result = await mcpOagExplain({
            workspace: String(args.workspace),
            target: String(args.target),
            refresh: Boolean(args.refresh),
          });
          break;
        case "oag_check":
          result = await mcpOagCheck({
            workspace: String(args.workspace),
            mode: (args.mode as "hard" | "warn") ?? "hard",
            refresh: Boolean(args.refresh),
          });
          break;
        case "oag_context":
          result = await mcpOagContext({
            workspace: String(args.workspace),
            goal: typeof args.goal === "string" ? args.goal : undefined,
            mode: args.mode !== undefined && args.mode !== null ? String(args.mode) : undefined,
            lens: typeof args.lens === "string" ? args.lens as never : undefined,
            budget: typeof args.budget === "number" ? args.budget : undefined,
            refresh: Boolean(args.refresh),
            redactRoot: args.redactRoot !== false,
          });
          break;
        case "oag_retrieve":
          result = await mcpOagRetrieve({
            workspace: String(args.workspace),
            id: String(args.id),
            refresh: Boolean(args.refresh),
          });
          break;
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: formatToolError(error) }],
      };
    }
  });

  return server;
}

export async function runOagMcpServer() {
  const server = createOagMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (!process.env.VITEST && /\/(?:src|dist)\/mcp\/server\.(?:ts|js)$/.test(invokedPath)) {
  runOagMcpServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}