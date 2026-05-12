import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type CallToolResult,
  CallToolRequestSchema,
  ErrorCode,
  type ListToolsResult,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { log } from "./diagnostics/logger.js";
import { getRegisteredTool, listRegisteredTools } from "./tools/index.js";
import { registerAllTools } from "./tools/register-all.js";

const SERVER_NAME = "vaultpilot-mcp";
const SERVER_VERSION = "0.0.0";

const INSTRUCTIONS = [
  "VaultPilot MCP is a defensive security tool for self-custodial cryptocurrency portfolio management: read tools surface on-chain positions, prices, and metadata; prepare tools author unsigned transactions the user signs on a Ledger hardware wallet.",
  "The trust anchor is the Ledger screen — the user reads transaction details directly from the device and approves there, so this server, the host computer, and the calling agent are all treated as components that may behave incorrectly.",
  "See ./SECURITY.md for the full threat model, the prepare → preview → send pipeline invariants, and the documented residual risks.",
].join(" ");

export function buildServer(): Server {
  registerAllTools();

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: listRegisteredTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    const tool = getRegisteredTool(name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `unknown tool: ${name}`);
    }
    try {
      return await tool.handler(args ?? {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", `tool "${name}" handler threw: ${message}`);
      return {
        content: [{ type: "text", text: `error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", `${SERVER_NAME} ${SERVER_VERSION} listening on stdio`);
}
