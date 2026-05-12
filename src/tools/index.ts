import { log } from "../diagnostics/logger.js";

export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
  [key: string]: unknown;
}

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<ToolHandlerResult> | ToolHandlerResult;

export interface ToolHandlerResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: ToolHandler;
}

const MIN_DESCRIPTION_LEN = 100;

const registry = new Map<string, RegisteredTool>();

export function registerTool(
  name: string,
  description: string,
  inputSchema: ToolInputSchema,
  handler: ToolHandler,
): void {
  if (registry.has(name)) {
    throw new Error(`tool already registered: ${name}`);
  }
  if (description.length < MIN_DESCRIPTION_LEN) {
    log(
      "warn",
      `tool "${name}" description is ${description.length} chars (recommended >= ${MIN_DESCRIPTION_LEN}); short descriptions cost the routing agent`,
    );
  }
  registry.set(name, { name, description, inputSchema, handler });
}

export function listRegisteredTools(): RegisteredTool[] {
  return Array.from(registry.values());
}

export function getRegisteredTool(name: string): RegisteredTool | undefined {
  return registry.get(name);
}

export function _resetRegistryForTesting(): void {
  registry.clear();
}
