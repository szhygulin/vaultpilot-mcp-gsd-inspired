// prepare_lido_wrap tests — Phase 30 Plan 30-03 (LIDO-05).
//
// 10 cases covering:
//   T1: Ethereum happy path — handle created; tx shape correct; PREPARE RECEIPT verbatim
//   T2: Fixture X fingerprint anchor (cross-link to test/signing-fingerprint.test.ts)
//       Fixture X is from-INDEPENDENT (stETH amount in calldata; no owner slot).
//   T3: Polygon refusal — CHAIN_ID_MISMATCH (15) (D-03)
//   T4: Insufficient allowance — INVALID_INPUT + hintTool: prepare_token_approve (D-05)
//       hintArgs.spender must be wstETH (NOT WithdrawalQueue)
//   T5: Malformed amount — INVALID_INPUT from parseAmountStrict
//   T6: NO LEDGER NOTICE in text content (D-12 — clear-sign confirmed)
//   T7: Fixture X from-independence (different `from` → same fingerprint)
//   T8: No NFT RECEIPT block (wrap does NOT produce NFT receipt)
//   T9: register-all wiring smoke

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
      throw new Error("pair should not be called from prepare_lido_wrap tests");
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

// readContract mock for allowance RPC read (wrap requires stETH approval for wstETH)
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
  getLidoWstethAddress,
} from "../src/config/contracts.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { LIDO_WRAP_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
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
await import("../src/tools/prepare_lido_wrap.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_lido_wrap");
  if (!tool) throw new Error("prepare_lido_wrap not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const ANVIL_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
const ANVIL_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [ANVIL_1],
  activeAccount: ANVIL_1,
  address: ANVIL_1,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [ANVIL_1] } as Record<number, `0x${string}`[]>,
};

// Fixture X — Phase 30 Plan 30-01 anchor (from test/signing-fingerprint.test.ts).
// WstETH.wrap(1e18) on Ethereum mainnet.
// Fixture X is from-INDEPENDENT — stETH amount in calldata, NO owner slot.
// Cross-link: this re-anchor proves the preimage assembly is byte-identical.
const FIXTURE_X_FINGERPRINT =
  "0x0f08b774cb218dd466b47f6df2eee97a76df67a1914ee28269ed328edac5eb20";
const FIXTURE_X_AMOUNT = "1.0";

// Lido contract addresses (EIP-55 checksummed from contracts.ts SOT)
const STETH_ADDR = getLidoStethAddress(1)!;
const WSTETH_ADDR = getLidoWstethAddress(1)!;
// wrap selector
const WRAP_SELECTOR = "0xea598cb0";

// Happy path mock: sufficient allowance = 2 ETH
const SUFFICIENT_ALLOWANCE = 2_000_000_000_000_000_000n;

function setupHappyPathMocks() {
  getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
  mockReadContract.mockResolvedValueOnce(SUFFICIENT_ALLOWANCE);
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
describe("prepare_lido_wrap — Ethereum happy path", () => {
  it("stethAmount: '1.0' → handle + correct tx shape + PREPARE RECEIPT", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_X_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      to: string;
      valueWei: string;
      data: string;
      payloadFingerprint: string;
      prepareReceipt: string;
    };

    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(WSTETH_ADDR);
    expect(sc.valueWei).toBe("0");
    expect(sc.data.slice(0, 10).toLowerCase()).toBe(WRAP_SELECTOR);
    expect(sc.data.length).toBe(74); // 36 bytes = 4 selector + 32 amount

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT");
    expect(text).toContain("operation:");
    expect(text).toContain("wstethContract:");
    expect(text).toContain(WSTETH_ADDR);
    expect(text).toContain(FIXTURE_X_AMOUNT);
  });
});

// ---------------------------------------------------------------------------
// T2: Fixture X fingerprint anchor (PREP-03 + T-BIND-1) — from-INDEPENDENT
// ---------------------------------------------------------------------------
describe("prepare_lido_wrap — Fixture X fingerprint anchor", () => {
  it("payloadFingerprint === Fixture X literal (cross-link to signing-fingerprint.test.ts)", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_X_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    // Byte-identity re-anchor — drift in preimage assembly breaks this assertion
    // AND the Fixture X test in test/signing-fingerprint.test.ts.
    expect(sc.payloadFingerprint).toBe(FIXTURE_X_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// T3: Polygon refusal — CHAIN_ID_MISMATCH (D-03)
// ---------------------------------------------------------------------------
describe("prepare_lido_wrap — Polygon refusal (D-03)", () => {
  it("chain: 'polygon' → CHAIN_ID_MISMATCH; createHandle NEVER called", async () => {
    const result = await callTool({ chain: "polygon", stethAmount: FIXTURE_X_AMOUNT });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "CHAIN_ID_MISMATCH",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
    expect(mockReadContract).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T4: Insufficient allowance — INVALID_INPUT + hintTool (D-05)
//     CRITICAL: spender must be wstETH (NOT WithdrawalQueue)
// ---------------------------------------------------------------------------
describe("prepare_lido_wrap — insufficient allowance (D-05)", () => {
  it("allowance < stethAmount → INVALID_INPUT + hintTool: prepare_token_approve + spender = wstETH", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // Allowance = 0.5 ETH, wrap request = 1.0 ETH → insufficient
    mockReadContract.mockResolvedValueOnce(500_000_000_000_000_000n);

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_X_AMOUNT });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      hintTool: string;
      hintArgs: { tokenAddress: string; spender: string; amount: string };
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(result.content[0]?.text ?? "").toMatch(/insufficient/i);
    expect(sc.hintTool).toBe("prepare_token_approve");
    // CRITICAL: spender for wrap = wstETH, NOT WithdrawalQueue (D-05 spec)
    expect(sc.hintArgs.tokenAddress).toBe(STETH_ADDR);
    expect(sc.hintArgs.spender).toBe(WSTETH_ADDR);
    // formatUnits(1e18, 18) === "1" (viem trims trailing zeros)
    expect(sc.hintArgs.amount).toBe("1");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("allowance === 0 → INVALID_INPUT with hint pointing to wstETH as spender", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockResolvedValueOnce(0n);

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_X_AMOUNT });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { hintTool: string; hintArgs: { spender: string } };
    expect(sc.hintTool).toBe("prepare_token_approve");
    expect(sc.hintArgs.spender).toBe(WSTETH_ADDR);
  });
});

// ---------------------------------------------------------------------------
// T5: Malformed amount — INVALID_INPUT from parseAmountStrict
// ---------------------------------------------------------------------------
describe("prepare_lido_wrap — malformed amount", () => {
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
// T6: NO LEDGER NOTICE in text content (D-12 — clear-sign confirmed)
// ---------------------------------------------------------------------------
describe("prepare_lido_wrap — NO LEDGER NOTICE (D-12)", () => {
  it("success response text does NOT contain 'LEDGER NOTICE' substring", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_X_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/LEDGER.?NOTICE/i);
  });
});

// ---------------------------------------------------------------------------
// T7: Fixture X from-independence
// ---------------------------------------------------------------------------
describe("prepare_lido_wrap — Fixture X from-independence", () => {
  it("payloadFingerprint is identical across different from addresses (X is from-INDEPENDENT)", async () => {
    // WstETH.wrap calldata does NOT embed the sender — only the stETH amount.
    // The preimage is chainId || to || valueWei || data — no `from` field.
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockResolvedValueOnce(SUFFICIENT_ALLOWANCE);
    const result1 = await callTool({ chain: "ethereum", stethAmount: FIXTURE_X_AMOUNT });
    const fp1 = (result1.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    _resetHandleStoreForTesting();

    // Different from address — same stethAmount → identical fingerprint
    const MULTI_ACCOUNT_STATUS = {
      ...PAIRED_STATUS,
      accounts: [ANVIL_1, ANVIL_0],
      accountsByChain: { 1: [ANVIL_1, ANVIL_0] } as Record<number, `0x${string}`[]>,
    };
    getStatusSpy.mockResolvedValueOnce(MULTI_ACCOUNT_STATUS);
    mockReadContract.mockResolvedValueOnce(SUFFICIENT_ALLOWANCE);
    const result2 = await callTool({
      chain: "ethereum",
      stethAmount: FIXTURE_X_AMOUNT,
      from: ANVIL_0,
    });
    const fp2 = (result2.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    expect(fp1).toBe(FIXTURE_X_FINGERPRINT);
    expect(fp2).toBe(FIXTURE_X_FINGERPRINT);
    expect(fp1).toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// T8: No NFT RECEIPT block (wrap does NOT produce an NFT receipt)
// ---------------------------------------------------------------------------
describe("prepare_lido_wrap — no NFT RECEIPT block", () => {
  it("success response does NOT contain '[NFT RECEIPT EXPECTED]' block", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_X_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("[NFT RECEIPT EXPECTED]");

    // structuredContent has no expectedTokenId or nftContract fields
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["expectedTokenId"]).toBeUndefined();
    expect(sc["nftContract"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T9: register-all wiring smoke
// ---------------------------------------------------------------------------
describe("prepare_lido_wrap — register-all wiring", () => {
  it("prepare_lido_wrap is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_lido_wrap");
  });

  it("inputSchema requires chain + stethAmount; chain enum is ['ethereum']", () => {
    const tool = getRegisteredTool("prepare_lido_wrap");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "stethAmount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum"],
    });
  });

  it("handle stored shape: tx.to === WSTETH_ADDR; valueWei === 0n; data starts with wrap selector", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_X_AMOUNT });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.tx.chainId).toBe(1);
    expect(record.tx.to).toBe(WSTETH_ADDR);
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(WRAP_SELECTOR);
    expect(record.tx.data.length).toBe(74);
    expect(record.payloadFingerprint).toBe(FIXTURE_X_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// PREPARE RECEIPT verbatim (PREP-02 / T-PREP-RCPT-1)
// ---------------------------------------------------------------------------
describe("prepare_lido_wrap — PREPARE RECEIPT verbatim", () => {
  it("receipt text matches LIDO_WRAP_PREPARE_RECEIPT_TEMPLATE byte-identically", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", stethAmount: FIXTURE_X_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = LIDO_WRAP_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{WSTETH_CONTRACT}", WSTETH_ADDR)
      .replace("{AMOUNT}", FIXTURE_X_AMOUNT);
    expect(text).toBe(expected);
  });
});
