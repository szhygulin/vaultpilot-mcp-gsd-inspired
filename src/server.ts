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
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type {
  JsonSchemaType,
  JsonSchemaValidator,
} from "@modelcontextprotocol/sdk/validation/types";

import { log } from "./diagnostics/logger.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolInputSchema,
} from "./tools/index.js";
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

  // PREP-07 (Plan 04-04 T-GATE-1): schema-level enforcement of every tool's
  // declared `inputSchema` BEFORE the per-tool handler runs. The low-level
  // `Server` in the MCP SDK validates only the request envelope shape (zod
  // `CallToolRequestSchema`); it does NOT cross-check `params.arguments`
  // against the tool's inputSchema (that's a feature of the higher-level
  // `McpServer` we don't use). We add the gate here so PREP-07's
  // "schema-level gate, NOT a soft check" contract holds at the actual
  // protocol boundary — the per-tool handler is unreachable when the
  // arguments violate the declared schema. Validators are compiled lazily
  // on first dispatch per tool and cached for the life of the server.
  const schemaProvider = new AjvJsonSchemaValidator();
  const validatorCache = new Map<string, JsonSchemaValidator<unknown>>();
  const getValidator = (
    name: string,
    schema: ToolInputSchema,
  ): JsonSchemaValidator<unknown> => {
    const cached = validatorCache.get(name);
    if (cached) return cached;
    const compiled = schemaProvider.getValidator<unknown>(schema as unknown as JsonSchemaType);
    validatorCache.set(name, compiled);
    return compiled;
  };

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

    // PREP-07 gate. `McpError(InvalidParams, ...)` surfaces as a JSON-RPC
    // error envelope with `code: -32602`. The per-tool handler is never
    // entered on a validation failure — locked-in by
    // `test/send-transaction.test.ts` Test 1a (handler-spy
    // `toHaveBeenCalledTimes(0)`).
    const validator = getValidator(name, tool.inputSchema);
    const validation = validator(args ?? {});
    if (!validation.valid) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for tool ${name}: ${validation.errorMessage}`,
      );
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
