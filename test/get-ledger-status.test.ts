import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session-manager's `getStatus` export. Other exports stay real
// (the `pair_ledger_live` tool — imported transitively via register-all
// in the wiring-smoke test below — imports the error classes from the
// same module, so we preserve them).
const getStatusSpy = vi.fn();

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from get_ledger_status tests");
    }),
    pairStart: vi.fn(async () => {
      throw new Error("pairStart should not be called from get_ledger_status tests");
    }),
    pairWait: vi.fn(async () => {
      throw new Error("pairWait should not be called from get_ledger_status tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Trigger the side-effect registration. Pulling in `register-all.js` here
// (instead of just `get_ledger_status.js`) also exercises the wiring-smoke
// assertion below: `pair_ledger_live` AND `get_ledger_status` must BOTH
// be in the registry after `register-all` is imported.
await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_ledger_status");
  if (!tool) throw new Error("get_ledger_status not registered");
  return tool.handler(args);
}

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as const;
const SESSION_TOPIC_LAST8 = "deadbeef";

beforeEach(() => {
  getStatusSpy.mockReset();
});

describe("get_ledger_status tool — paired + unpaired branches (PAIR-02)", () => {
  it("returns structuredContent: { paired: false } when getStatus resolves to null (unpaired)", async () => {
    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ paired: false });
    expect(result.content[0]?.text ?? "").toMatch(/paired:\s+false/);
  });

  it("returns full status envelope when getStatus resolves to a LedgerStatus (paired)", async () => {
    getStatusSpy.mockResolvedValueOnce({
      paired: true,
      address: ADDRESS,
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      paired: true,
      address: ADDRESS,
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/paired:\s+true/);
    expect(text).toContain(ADDRESS);
    expect(text).toMatch(/chainId:\s+1/);
    expect(text).toMatch(/sessionTopicLast8:\s+deadbeef/);
  });
});

describe("get_ledger_status tool — handler shape", () => {
  it("accepts an empty args object and an undefined-args call; handler ignores args", async () => {
    getStatusSpy.mockResolvedValue(null);

    const fromEmpty = await callTool({});
    const fromMissing = await (
      getRegisteredTool("get_ledger_status")!.handler({} as Record<string, unknown>)
    );

    expect(fromEmpty.structuredContent).toEqual({ paired: false });
    expect(fromMissing.structuredContent).toEqual({ paired: false });
  });

  it("registers with no required input properties (inputSchema.required is undefined)", async () => {
    const tool = getRegisteredTool("get_ledger_status");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toBeUndefined();
    expect(tool!.inputSchema.properties).toEqual({});
  });
});

describe("register-all.ts wiring — Phase 3 tools registered (smoke)", () => {
  it("pair_ledger_live, pair_ledger_live_start, pair_ledger_live_wait, get_ledger_status all present after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("pair_ledger_live");
    expect(names).toContain("pair_ledger_live_start");
    expect(names).toContain("pair_ledger_live_wait");
    expect(names).toContain("get_ledger_status");
  });
});
