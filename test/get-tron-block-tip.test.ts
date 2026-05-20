// test/get-tron-block-tip.test.ts — Phase 17 Plan 17-03 (TRON-READ-03).
//
// Diagnostic tool returning the current TRON chain tip. Three behaviors:
//   1. Happy path — block number + timestamp + blockHash passthrough.
//   2. RPC error → TRON_RPC_FAILED envelope.
//   3. Defensive zero-fields branch — the underlying tron-rpc-client
//      surfaces `{ number: 0, timestamp: 0, blockHash: "" }` on schema
//      drift; the tool passes those values through (no throw, no error
//      envelope).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _tronRegistry } from "../src/chains/tron/registry.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  void _resetRegistryForTesting;
});

async function callTool(): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_tron_block_tip");
  if (!tool) throw new Error("get_tron_block_tip not registered");
  return tool.handler({});
}

function makeStubTronWeb(blockShape: unknown): { tw: object } {
  const getCurrentBlock = vi.fn().mockResolvedValue(blockShape);
  return { tw: { trx: { getCurrentBlock } } };
}

describe("get_tron_block_tip (Phase 17 Plan 17-03 TRON-READ-03)", () => {
  it("happy path: returns { number, timestamp, blockHash } passthrough", async () => {
    const { tw } = makeStubTronWeb({
      block_header: {
        raw_data: {
          number: 82_866_526,
          timestamp: 1_779_268_134_000,
        },
      },
      blockID: "abc123def456",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool();

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      number: 82_866_526,
      timestamp: 1_779_268_134_000,
      blockHash: "abc123def456",
    });
    expect(result.content[0]?.text).toMatch(/82866526/);
    expect(result.content[0]?.text).toMatch(/abc123def456/);
  });

  it("RPC error → TRON_RPC_FAILED envelope", async () => {
    const getCurrentBlock = vi.fn().mockRejectedValue(new Error("trongrid down"));
    const tw = { trx: { getCurrentBlock } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      errorCode: "TRON_RPC_FAILED",
    });
    expect(result.content[0]?.text).toMatch(/trongrid down/);
  });

  it("defensive zero-fields branch (schema drift): { number: 0, timestamp: 0, blockHash: '' } passes through", async () => {
    // The underlying tron-rpc-client returns the zero-tuple when
    // block_header.raw_data is missing. The tool surfaces it as-is
    // (no throw, no errorCode).
    const { tw } = makeStubTronWeb({}); // no block_header at all
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool();

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      number: 0,
      timestamp: 0,
      blockHash: "",
    });
  });
});
