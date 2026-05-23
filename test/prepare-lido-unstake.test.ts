// prepare_lido_unstake tests — Phase 30 Plan 30-03 (LIDO-03).
//
// 11 cases covering:
//   T1: Ethereum happy path — handle created; tx shape correct; PREPARE RECEIPT + NFT RECEIPT EXPECTED
//   T2: Fixture W fingerprint anchor (cross-link to test/signing-fingerprint.test.ts)
//       Fixture W is persona-DEPENDENT (owner=fromAddress flows into calldata).
//   T3: Polygon refusal — CHAIN_ID_MISMATCH (15) (D-03)
//   T4: Insufficient allowance — INVALID_INPUT + hintTool: prepare_token_approve (D-05)
//   T5: Amount below MIN (100 wei) — INVALID_INPUT (T-LIDO-WITHDRAWAL-AMOUNT-BOUNDS)
//   T6: Amount above MAX (1000 ETH + 1 wei) — INVALID_INPUT (T-LIDO-WITHDRAWAL-AMOUNT-BOUNDS)
//   T7: Malformed amount — INVALID_INPUT from parseAmountStrict
//   T8: NO LEDGER NOTICE in text content (D-12 — clear-sign confirmed)
//   T9: NFT RECEIPT EXPECTED block present with expectedTokenId and requestor
//   T10: expectedTokenId = getLastRequestId() + 1
//   T11: register-all wiring smoke

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getStatusSpy, createHandleSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  createHandleSpy: vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_lido_unstake tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<typeof import("../src/signing/handle-store.js")>(
    "../src/signing/handle-store.js",
  );
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (...args: Parameters<typeof actual.createHandle>) => createHandleSpy(...args),
  };
});

// readContract mock for allowance + getLastRequestId RPC reads
const mockReadContract = vi.fn();

vi.mock("../src/chains/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/registry.js")>(
    "../src/chains/registry.js",
  );
  return {
    ...actual,
    getChainClient: vi.fn(() => ({ readContract: mockReadContract })),
  };
});

import {
  getLidoStethAddress,
  getLidoWithdrawalQueueAddress,
} from "../src/config/contracts.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { LIDO_UNSTAKE_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
} from "../src/demo/state.js";

await import("../src/tools/register-all.js");
// Direct import to trigger tool registration (register-all.ts adds this in Task 3;
// until then, direct import ensures the tool is registered in this test file).
await import("../src/tools/prepare_lido_unstake.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_lido_unstake");
  if (!tool) throw new Error("prepare_lido_unstake not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const ANVIL_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [ANVIL_1],
  activeAccount: ANVIL_1,
  address: ANVIL_1,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [ANVIL_1] } as Record<number, `0x${string}`[]>,
};

// Fixture W — Phase 30 Plan 30-01 anchor (from test/signing-fingerprint.test.ts).
// WithdrawalQueue.requestWithdrawals([1e18], owner=ANVIL_1) on Ethereum mainnet.
// Fixture W is persona-DEPENDENT: owner address flows into calldata.
// Cross-link: this re-anchor proves the preimage assembly is byte-identical.
const FIXTURE_W_FINGERPRINT =
  "0x5f7514882e11ddb46f07aa0b8c3d30df017941c7b4c81e66471c15c31c4a8caa";
const FIXTURE_W_AMOUNT = "1.0";
const FIXTURE_W_AMOUNT_WEI = 1_000_000_000_000_000_000n; // 1e18

// Lido contract addresses (EIP-55 checksummed from contracts.ts SOT)
const STETH_ADDR = getLidoStethAddress(1)!;
const WQ_ADDR = getLidoWithdrawalQueueAddress(1)!;
// requestWithdrawals selector
const REQUEST_WITHDRAWALS_SELECTOR = "0xd6681042";

// Happy path mock values
// allowance = 2 ETH (sufficient for 1 ETH withdrawal)
const SUFFICIENT_ALLOWANCE = 2_000_000_000_000_000_000n;
// getLastRequestId returns 42 → expectedTokenId = "43"
const LAST_REQUEST_ID = 42n;
const EXPECTED_TOKEN_ID = "43";

function setupHappyPathMocks() {
  getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
  // readContract called twice: 1st = allowance, 2nd = getLastRequestId
  mockReadContract
    .mockResolvedValueOnce(SUFFICIENT_ALLOWANCE)
    .mockResolvedValueOnce(LAST_REQUEST_ID);
}

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
  mockReadContract.mockReset();
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

// ---------------------------------------------------------------------------
// T1: Ethereum happy path
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — Ethereum happy path", () => {
  it("stethAmount: '1.0' → handle + correct tx shape + PREPARE RECEIPT + NFT block", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_W_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      to: string;
      valueWei: string;
      data: string;
      payloadFingerprint: string;
      expectedTokenId: string;
      nftContract: string;
      prepareReceipt: string;
    };

    // UUID handle
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(WQ_ADDR);
    expect(sc.valueWei).toBe("0");
    expect(sc.data.slice(0, 10).toLowerCase()).toBe(REQUEST_WITHDRAWALS_SELECTOR);
    // 132 bytes = 4 selector + 32 offset + 32 owner + 32 array.length + 32 array[0]
    // (empirically verified in Plan 30-01 — plan's "100 bytes" was an arithmetic error)
    expect(sc.data.length).toBe(266);
    expect(sc.expectedTokenId).toBe(EXPECTED_TOKEN_ID);
    expect(sc.nftContract).toBe(WQ_ADDR);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT");
    expect(text).toContain(WQ_ADDR);
    expect(text).toContain(FIXTURE_W_AMOUNT);
    expect(text).toContain("NFT RECEIPT EXPECTED");
  });
});

// ---------------------------------------------------------------------------
// T2: Fixture W fingerprint anchor (PREP-03 + T-BIND-1) — persona-DEPENDENT
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — Fixture W fingerprint anchor", () => {
  it("payloadFingerprint === Fixture W literal when owner === ANVIL_1 (cross-link to signing-fingerprint.test.ts)", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_W_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    // Byte-identity re-anchor — drift in preimage assembly breaks this assertion
    // AND the Fixture W test in test/signing-fingerprint.test.ts.
    // NOTE: Fixture W is persona-DEPENDENT — owner=ANVIL_1 flows into calldata.
    // A different `from` address produces a DIFFERENT fingerprint (by design).
    expect(sc.payloadFingerprint).toBe(FIXTURE_W_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// T3: Polygon refusal — CHAIN_ID_MISMATCH (D-03)
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — Polygon refusal (D-03)", () => {
  it("chain: 'polygon' → CHAIN_ID_MISMATCH; createHandle NEVER called", async () => {
    const result = await callTool({ chain: "polygon", stethAmount: FIXTURE_W_AMOUNT });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "CHAIN_ID_MISMATCH",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
    // No RPC reads should occur before the chain gate
    expect(mockReadContract).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T4: Insufficient allowance — INVALID_INPUT + hintTool (D-05)
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — insufficient allowance (D-05)", () => {
  it("allowance < stethAmount → INVALID_INPUT + hintTool: prepare_token_approve + correct spender", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // Allowance = 0.5 ETH, request = 1.0 ETH → insufficient
    mockReadContract.mockResolvedValueOnce(500_000_000_000_000_000n);

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_W_AMOUNT });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      hintTool: string;
      hintArgs: { tokenAddress: string; spender: string; amount: string };
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(result.content[0]?.text ?? "").toMatch(/insufficient/i);
    // D-05: hintTool must point to prepare_token_approve
    expect(sc.hintTool).toBe("prepare_token_approve");
    // hintArgs must carry the correct spender = WithdrawalQueue (NOT wstETH)
    expect(sc.hintArgs.tokenAddress).toBe(STETH_ADDR);
    expect(sc.hintArgs.spender).toBe(WQ_ADDR);
    // formatUnits(1e18, 18) === "1" (viem trims trailing zeros)
    expect(sc.hintArgs.amount).toBe("1");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("allowance === 0 → INVALID_INPUT with hint (D-05 edge case)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockResolvedValueOnce(0n);

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_W_AMOUNT });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
    const sc = result.structuredContent as { hintTool: string };
    expect(sc.hintTool).toBe("prepare_token_approve");
  });
});

// ---------------------------------------------------------------------------
// T5: Amount below MIN (100 wei) — INVALID_INPUT (T-LIDO-WITHDRAWAL-AMOUNT-BOUNDS)
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — amount below minimum (T-LIDO-WITHDRAWAL-AMOUNT-BOUNDS)", () => {
  it("stethAmount < 100 wei (0.000...001) → INVALID_INPUT; no RPC reads; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    // 1 wei = "0.000000000000000001"
    const result = await callTool({ chain: "ethereum", stethAmount: "0.000000000000000001" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(result.content[0]?.text ?? "").toMatch(/bounds/i);
    // Bounds check fires BEFORE RPC reads
    expect(mockReadContract).not.toHaveBeenCalled();
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// T6: Amount above MAX (1000 ETH + 1 wei) — INVALID_INPUT
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — amount above maximum (T-LIDO-WITHDRAWAL-AMOUNT-BOUNDS)", () => {
  it("stethAmount > 1000 ETH → INVALID_INPUT; no RPC reads; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    // 1000.000000000000000001 ETH = MAX + 1 wei
    const result = await callTool({ chain: "ethereum", stethAmount: "1000.000000000000000001" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(result.content[0]?.text ?? "").toMatch(/bounds/i);
    expect(mockReadContract).not.toHaveBeenCalled();
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// T7: Malformed amount — INVALID_INPUT from parseAmountStrict
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — malformed amount", () => {
  it("stethAmount: 'abc' → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", stethAmount: "abc" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("stethAmount: '1.12345678901234567890' (19 frac digits) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", stethAmount: "1.12345678901234567890" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// T8: NO LEDGER NOTICE in text content (D-12 — clear-sign confirmed)
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — NO LEDGER NOTICE (D-12)", () => {
  it("success response text does NOT contain 'LEDGER NOTICE' substring", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_W_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/LEDGER.?NOTICE/i);
  });
});

// ---------------------------------------------------------------------------
// T9: NFT RECEIPT EXPECTED block present with expectedTokenId and requestor
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — NFT RECEIPT EXPECTED block (D-04)", () => {
  it("response includes [NFT RECEIPT EXPECTED] block with expectedTokenId and requestor address", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_W_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    // Block header
    expect(text).toContain("[NFT RECEIPT EXPECTED]");
    // Expected tokenId = getLastRequestId() + 1 = 42 + 1 = 43
    expect(text).toMatch(/43/);
    // Requestor = the resolved from address
    expect(text).toContain(ANVIL_1);
    // NFT contract = WithdrawalQueue
    expect(text).toContain(WQ_ADDR);
  });
});

// ---------------------------------------------------------------------------
// T10: expectedTokenId = getLastRequestId() + 1
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — expectedTokenId derivation (D-04)", () => {
  it("structuredContent.expectedTokenId === getLastRequestId() + 1 as string", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // Use a different last request ID to verify the +1 arithmetic
    mockReadContract
      .mockResolvedValueOnce(SUFFICIENT_ALLOWANCE)
      .mockResolvedValueOnce(99n); // getLastRequestId = 99 → expected = "100"

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_W_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { expectedTokenId: string };
    expect(sc.expectedTokenId).toBe("100");
  });
});

// ---------------------------------------------------------------------------
// T11: register-all wiring smoke
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — register-all wiring", () => {
  it("prepare_lido_unstake is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_lido_unstake");
  });

  it("inputSchema requires chain + stethAmount; chain enum is ['ethereum']", () => {
    const tool = getRegisteredTool("prepare_lido_unstake");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "stethAmount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum"],
    });
  });

  it("handle stored shape: tx.to === WQ_ADDR; valueWei === 0n; data starts with requestWithdrawals selector", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_W_AMOUNT });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.tx.chainId).toBe(1);
    expect(record.tx.to).toBe(WQ_ADDR);
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(REQUEST_WITHDRAWALS_SELECTOR);
    // 132 bytes = 266 hex chars including 0x prefix
    expect(record.tx.data.length).toBe(266);
    expect(record.payloadFingerprint).toBe(FIXTURE_W_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// PREPARE RECEIPT verbatim (PREP-02 / T-PREP-RCPT-1)
// ---------------------------------------------------------------------------
describe("prepare_lido_unstake — PREPARE RECEIPT verbatim", () => {
  it("receipt text starts with LIDO_UNSTAKE_PREPARE_RECEIPT_TEMPLATE slots filled", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_W_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expectedReceipt = LIDO_UNSTAKE_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{WQ_CONTRACT}", WQ_ADDR)
      .replace("{AMOUNT}", FIXTURE_W_AMOUNT);
    // PREPARE RECEIPT is the first block; NFT block follows after \n\n
    expect(text).toContain(expectedReceipt);
    expect(text.indexOf(expectedReceipt)).toBe(0);
  });
});
