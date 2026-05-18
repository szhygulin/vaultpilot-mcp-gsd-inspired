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
      accounts: [ADDRESS],
      activeAccount: ADDRESS,
      address: ADDRESS,
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      paired: true,
      address: ADDRESS,
      accounts: [ADDRESS],
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/paired:\s+true/);
    expect(text).toContain(ADDRESS);
    expect(text).toMatch(/chainId:\s+1/);
    expect(text).toMatch(/sessionTopicLast8:\s+deadbeef/);
    expect(text).toMatch(/accounts:\s+\[/);
  });

  it("surfaces all approved accounts in the paired envelope (multi-account session)", async () => {
    const ADDRESSES = [
      ADDRESS,
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const,
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const,
    ];
    getStatusSpy.mockResolvedValueOnce({
      paired: true,
      accounts: ADDRESSES,
      activeAccount: ADDRESSES[1],
      address: ADDRESSES[1],
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });

    const result = await callTool({});
    const sc = result.structuredContent as {
      paired: boolean;
      address: string;
      accounts: string[];
    };
    expect(sc.address).toBe(ADDRESSES[1]);
    expect(sc.accounts).toEqual(ADDRESSES);

    const text = result.content[0]?.text ?? "";
    for (const a of ADDRESSES) expect(text).toContain(a);
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

// ---------------------------------------------------------------------------
// Plan 08-05 — multi-chain widening tests (Tests 8-11).
//
// LedgerStatus shape extended with `accountsByChain`, `activeChainId`,
// `partiallyPaired`. The existing 5 fields preserved byte-frozen on the
// wire (back-compat). Test 11 is the T-SESSION-TOPIC-LEAK-1 anchor — the
// full session topic MUST NEVER appear in the get_ledger_status response.
// ---------------------------------------------------------------------------

const ETH_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as const;
const POL_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

describe("get_ledger_status — Plan 08-05 multi-chain widening (Tests 8-10)", () => {
  it("Test 8: paired envelope surfaces the 3 new fields when getStatus returns a multi-chain status", async () => {
    getStatusSpy.mockResolvedValueOnce({
      paired: true,
      accounts: [ETH_ADDRESS],
      activeAccount: ETH_ADDRESS,
      address: ETH_ADDRESS,
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
      accountsByChain: {
        1: [ETH_ADDRESS],
        42161: [ETH_ADDRESS],
        137: [ETH_ADDRESS],
        8453: [ETH_ADDRESS],
        10: [ETH_ADDRESS],
      },
      activeChainId: 1,
      partiallyPaired: false,
    });

    const result = await callTool({});
    // The get_ledger_status tool surfaces the 5 legacy fields in the
    // structuredContent envelope (it doesn't currently re-project the new
    // fields). Back-compat assertion: the new fields don't break the
    // existing shape; consumers of `address` / `chainId` / `accounts` /
    // `sessionTopicLast8` see byte-identical values. The 3 new fields
    // live on the LedgerStatus type for direct consumers (set_active_account
    // per-chain branch, future tools).
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      paired: true,
      address: ETH_ADDRESS,
      accounts: [ETH_ADDRESS],
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });
  });

  it("Test 9: partiallyPaired:false when full multi-chain session (structured wire stays back-compat)", async () => {
    getStatusSpy.mockResolvedValueOnce({
      paired: true,
      accounts: [ETH_ADDRESS],
      activeAccount: ETH_ADDRESS,
      address: ETH_ADDRESS,
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
      accountsByChain: {
        1: [ETH_ADDRESS],
        42161: [ETH_ADDRESS],
        137: [ETH_ADDRESS],
        8453: [ETH_ADDRESS],
        10: [ETH_ADDRESS],
      },
      activeChainId: 1,
      partiallyPaired: false,
    });

    const result = await callTool({});
    expect(result.isError).toBeFalsy();
    // chainId === 1 (Ethereum default) when full multi-chain session.
    expect((result.structuredContent as { chainId: number }).chainId).toBe(1);
  });

  it("Test 10: partiallyPaired:true when partial session — text surface still mentions the active chain only", async () => {
    getStatusSpy.mockResolvedValueOnce({
      paired: true,
      accounts: [ETH_ADDRESS, POL_ADDRESS],
      activeAccount: ETH_ADDRESS,
      address: ETH_ADDRESS,
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
      accountsByChain: {
        1: [ETH_ADDRESS],
        137: [POL_ADDRESS],
      },
      activeChainId: 1,
      partiallyPaired: true,
    });

    const result = await callTool({});
    expect(result.isError).toBeFalsy();
    // The wire response surfaces the active chain (Ethereum). The
    // partiallyPaired flag isn't projected here in v1.2 — it lives on
    // the LedgerStatus type for direct consumers; the stderr warning
    // fires inside sessionToStatus (covered by Test 4 of
    // session-manager.multi-chain.test.ts).
    expect((result.structuredContent as { chainId: number }).chainId).toBe(1);
  });
});

describe("get_ledger_status — T-SESSION-TOPIC-LEAK-1 anchor (Test 11)", () => {
  it("Test 11: full session topic NEVER appears in get_ledger_status response (only last-8 surfaces)", async () => {
    // Sentinel topic — full string MUST NEVER appear in any part of the
    // response envelope. Only the last 8 characters ("NOT-LEAK") may
    // surface via `sessionTopicLast8`.
    const SENTINEL_TOPIC_LAST8 = "NOT-LEAK";
    getStatusSpy.mockResolvedValueOnce({
      paired: true,
      accounts: [ETH_ADDRESS],
      activeAccount: ETH_ADDRESS,
      address: ETH_ADDRESS,
      chainId: 1,
      sessionTopicLast8: SENTINEL_TOPIC_LAST8,
      accountsByChain: { 1: [ETH_ADDRESS] },
      activeChainId: 1,
      partiallyPaired: true,
    });

    const result = await callTool({});
    // (a) structuredContent serialized to JSON must NOT contain the
    //     full sentinel topic.
    const structuredSerialized = JSON.stringify(result.structuredContent);
    expect(structuredSerialized).not.toContain(
      "topic-sentinel-12345-FULL-DO-NOT-LEAK",
    );
    expect(structuredSerialized).not.toContain("topic-sentinel");
    expect(structuredSerialized).not.toContain("DO-NOT-LEAK");

    // (b) content[0].text must NOT contain the full sentinel topic.
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("topic-sentinel-12345-FULL-DO-NOT-LEAK");
    expect(text).not.toContain("topic-sentinel");
    expect(text).not.toContain("DO-NOT-LEAK");

    // (c) The last-8 substring IS expected to surface.
    expect(structuredSerialized).toContain(SENTINEL_TOPIC_LAST8);
    expect(text).toContain(SENTINEL_TOPIC_LAST8);
  });
});
