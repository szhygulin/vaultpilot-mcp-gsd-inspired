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

import { isAutoDemo } from "./config/env.js";
import { log } from "./diagnostics/logger.js";
import { consumeAutoDemoNotice } from "./diagnostics/notice.js";
import { runUpdateCheckOnce } from "./diagnostics/update-check.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolInputSchema,
} from "./tools/index.js";
import { registerAllTools } from "./tools/register-all.js";

const SERVER_NAME = "vaultpilot-mcp";
const SERVER_VERSION = "0.0.0";

// Plan 05-03 / DIAG-03: INSTRUCTIONS rewrite post-Phase-4-shipping. Names
// the actual v1.0 trust pipeline (`payloadFingerprint` + `LEDGER BLIND-SIGN
// HASH` + `PREPARE RECEIPT` + `previewToken` + `userDecision`), demo-mode
// behavior, the Phase 5 diagnostics surface, and SECURITY.md.
const INSTRUCTIONS = [
  "VaultPilot MCP is a self-custodial DeFi tool for AI agents: read tools surface on-chain positions, prices, and metadata; prepare/preview/send tools author unsigned Ethereum transactions for the user to sign on a Ledger hardware wallet via WalletConnect.",
  "The trust anchor is the Ledger screen — every byte the device signs is cryptographically bound across the agent → MCP → transport → device chain via `payloadFingerprint` (PREP-03), `LEDGER BLIND-SIGN HASH` (PREP-04), `PREPARE RECEIPT` (PREP-02), `previewToken` + `userDecision` gates (PREP-07/08).",
  "Demo mode: a brand-new install (no config + no env) boots into demo with curated personas; read tools work against real RPC, signing tools simulate via eth_call. Use `set_demo_wallet` to switch personas; `get_vaultpilot_config_status` to inspect state.",
  "See ./SECURITY.md for the full threat model, the prepare → preview → send pipeline invariants, and the documented residual risks (compromised-MCP threat closed in v1.3 via companion `vaultpilot-preflight` skill).",
].join(" ");

// Plan 05-03 / DIAG-04: read package.json once at module load. Top-level
// await is allowed in ESM modules (Node 14.8+); the project requires
// ≥ 18.17. Same dynamic-import-with-JSON-attribute pattern as
// `src/diagnostics/check.ts::readPackageVersion()` — keeps `tsc`'s
// `rootDir: "src"` happy while still reading package.json at runtime.
async function readPackageMetadata(): Promise<{ name: string; version: string }> {
  try {
    const pkg = (await import("../package.json", { with: { type: "json" } })) as {
      default: { name: string; version: string };
    };
    return { name: pkg.default.name, version: pkg.default.version };
  } catch {
    return { name: SERVER_NAME, version: SERVER_VERSION };
  }
}

const { name: packageName, version: packageVersion } = await readPackageMetadata();

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
    // Plan 05-03 / DIAG-04: fire-and-forget update check on FIRST tool
    // dispatch (NOT on `initialize` — research § Pitfall 3: blocking the
    // initialize handshake is observable to the client). The function is
    // void-returning + self-guarded (once-per-process via module-scoped
    // flag); subsequent dispatches are no-ops at near-zero cost.
    runUpdateCheckOnce(packageVersion, packageName);

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

    let result: CallToolResult;
    try {
      result = await tool.handler(args ?? {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", `tool "${name}" handler threw: ${message}`);
      result = {
        content: [{ type: "text", text: `error: ${message}` }],
        isError: true,
      };
    }

    // Plan 05-03 / DEMO-07: prepend the AUTO_DEMO NOTICE block on the
    // FIRST tool response of the session IFF the resolver picked the
    // auto-detect arm. `isAutoDemo()` — NOT `isDemoMode()` — gates this:
    // explicit env/config demo NEVER triggers the NOTICE because the user
    // already knows they're in demo mode. T-NOTICE-OVERREACH-1 mitigation.
    //
    // The NOTICE is prepended as a SEPARATE text-content entry (not
    // concatenated into the first content[0].text) so a structured-content
    // parser doesn't choke on the prepend. The race-defense lives inside
    // `consumeAutoDemoNotice`: it sets the flag BEFORE returning the
    // template, so two concurrent dispatches don't both emit.
    if (isAutoDemo()) {
      const notice = consumeAutoDemoNotice();
      if (notice !== null) {
        return {
          ...result,
          content: [{ type: "text" as const, text: notice }, ...result.content],
        };
      }
    }
    return result;
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", `${SERVER_NAME} ${SERVER_VERSION} listening on stdio`);
}
