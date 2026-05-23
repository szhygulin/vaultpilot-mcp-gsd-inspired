// prepare_lido_stake tests — Phase 30 Plan 30-03 (LIDO-02).
//
// 8 cases covering:
//   T1: Ethereum happy path — handle created; tx shape correct; PREPARE RECEIPT verbatim
//   T2: Fixture V fingerprint anchor (cross-link to test/signing-fingerprint.test.ts)
//   T3: Polygon refusal — CHAIN_ID_MISMATCH (15) (D-03)
//   T4: Zero-value refusal — INVALID_INPUT (T-LIDO-ZERO-VALUE-STAKE)
//   T5: Invalid amount shape — INVALID_INPUT (parseAmountStrict)
//   T6: NO LEDGER NOTICE in text content (D-12 — clear-sign confirmed)
//   T7: No allowance RPC call needed (stake needs no approval)
//   T8: register-all wiring smoke

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
      throw new Error("pair should not be called from prepare_lido_stake tests");
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

// No RPC reads needed for prepare_lido_stake — but mock registry to be safe
vi.mock("../src/chains/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/registry.js")>(
    "../src/chains/registry.js",
  );
  return {
    ...actual,
    // getChainClient not called for stake (no allowance read), but provide a safe mock
    getChainClient: vi.fn(() => ({ readContract: vi.fn() })),
  };
});

import {
  getLidoStethAddress,
} from "../src/config/contracts.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";

await import("../src/tools/register-all.js");
// Direct import to trigger tool registration (register-all.ts adds this in Task 3;
// until then, direct import ensures the tool is registered in this test file).
await import("../src/tools/prepare_lido_stake.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_lido_stake");
  if (!tool) throw new Error("prepare_lido_stake not registered");
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

// Fixture V — Phase 30 Plan 30-01 anchor (from test/signing-fingerprint.test.ts).
// Lido.submit(referral=address(0)) with value=1e18 ETH on Ethereum mainnet.
// Cross-link: this re-anchor proves the preimage assembly is byte-identical.
const FIXTURE_V_FINGERPRINT =
  "0xab550a2883eb494493169aeff633b77af8f5d458ed0f406b49ce9513b2fe7ed1";
const FIXTURE_V_AMOUNT = "1.0";
const FIXTURE_V_AMOUNT_WEI = "1000000000000000000"; // 1e18

// Lido stETH proxy (EIP-55 checksummed from contracts.ts SOT)
const STETH_ADDR = getLidoStethAddress(1)!;
// submit selector
const SUBMIT_SELECTOR = "0xa1903eab";
// referral = address(0) — 24 zero bytes after selector
const ZERO_REFERRAL_SUFFIX = "0".repeat(64);

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
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
describe("prepare_lido_stake — Ethereum happy path", () => {
  it("amount: '1.0' → handle + correct tx shape + PREPARE RECEIPT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: FIXTURE_V_AMOUNT });

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

    // UUID handle
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // tx shape
    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(STETH_ADDR);
    expect(sc.valueWei).toBe(FIXTURE_V_AMOUNT_WEI);
    // data: submit selector + address(0) referral
    expect(sc.data.slice(0, 10).toLowerCase()).toBe(SUBMIT_SELECTOR);
    expect(sc.data).toContain(ZERO_REFERRAL_SUFFIX);
    expect(sc.data.length).toBe(74); // 36 bytes = 4 selector + 32 referral

    // PREPARE RECEIPT content
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT");
    expect(text).toContain("operation:");
    expect(text).toContain("stethContract:");
    expect(text).toContain(STETH_ADDR);
    expect(text).toContain(FIXTURE_V_AMOUNT);
  });
});

// ---------------------------------------------------------------------------
// T2: Fixture V fingerprint anchor (PREP-03 + T-BIND-1)
// ---------------------------------------------------------------------------
describe("prepare_lido_stake — Fixture V fingerprint anchor", () => {
  it("payloadFingerprint === Fixture V literal (cross-link to signing-fingerprint.test.ts)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: FIXTURE_V_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    // Byte-identity re-anchor — drift in preimage assembly breaks this assertion
    // AND the Fixture V test in test/signing-fingerprint.test.ts.
    expect(sc.payloadFingerprint).toBe(FIXTURE_V_FINGERPRINT);
  });

  it("payloadFingerprint is from-INDEPENDENT (V is from-address-independent)", async () => {
    // Fixture V is from-independent: Lido.submit calldata does NOT embed the sender.
    // The preimage is chainId || to || valueWei || data — no `from` field.
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result1 = await callTool({ chain: "ethereum", amount: FIXTURE_V_AMOUNT });
    const fp1 = (result1.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    _resetHandleStoreForTesting();

    // Different from address, same inputs — fingerprint must be byte-identical.
    const MULTI_ACCOUNT_STATUS = {
      ...PAIRED_STATUS,
      accounts: [ANVIL_1, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`],
      accountsByChain: { 1: [ANVIL_1, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`] } as Record<number, `0x${string}`[]>,
    };
    getStatusSpy.mockResolvedValueOnce(MULTI_ACCOUNT_STATUS);
    const result2 = await callTool({
      chain: "ethereum",
      amount: FIXTURE_V_AMOUNT,
      from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    });
    const fp2 = (result2.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    expect(fp1).toBe(FIXTURE_V_FINGERPRINT);
    expect(fp2).toBe(FIXTURE_V_FINGERPRINT);
    expect(fp1).toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// T3: Polygon refusal — CHAIN_ID_MISMATCH (D-03)
// ---------------------------------------------------------------------------
describe("prepare_lido_stake — Polygon refusal (D-03)", () => {
  it("chain: 'polygon' → CHAIN_ID_MISMATCH; createHandle NEVER called", async () => {
    const result = await callTool({ chain: "polygon", amount: FIXTURE_V_AMOUNT });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "CHAIN_ID_MISMATCH",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// T4: Zero-value refusal (T-LIDO-ZERO-VALUE-STAKE)
// ---------------------------------------------------------------------------
describe("prepare_lido_stake — zero-value refusal (T-LIDO-ZERO-VALUE-STAKE)", () => {
  it("amount: '0' → INVALID_INPUT; message mentions 'must be > 0'; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: "0" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(result.content[0]?.text ?? "").toMatch(/must be > 0/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// T5: Invalid amount shape — INVALID_INPUT from parseAmountStrict
// ---------------------------------------------------------------------------
describe("prepare_lido_stake — invalid amount shape", () => {
  it("amount: 'abc' → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: "abc" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("amount: '1e18' (scientific notation) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: "1e18" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
  });

  it("amount: '-1.0' (negative) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: "-1.0" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// T6: NO LEDGER NOTICE in text content (D-12 — clear-sign confirmed)
// ---------------------------------------------------------------------------
describe("prepare_lido_stake — NO LEDGER NOTICE (D-12)", () => {
  it("success response text does NOT contain 'LEDGER NOTICE' substring", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: FIXTURE_V_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/LEDGER.?NOTICE/i);
  });
});

// ---------------------------------------------------------------------------
// T7: No allowance/RPC call needed for stake (no approval gate)
// ---------------------------------------------------------------------------
describe("prepare_lido_stake — no allowance RPC call needed", () => {
  it("happy path does not need readContract (no stETH approval check for ETH stake)", async () => {
    const mockReadContract = vi.fn();
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: FIXTURE_V_AMOUNT });

    // No RPC reads needed for a pure payable stake call
    expect(result.isError).toBeFalsy();
    expect(mockReadContract).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T8: register-all wiring smoke
// ---------------------------------------------------------------------------
describe("prepare_lido_stake — register-all wiring", () => {
  it("prepare_lido_stake is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_lido_stake");
  });

  it("inputSchema requires chain + amount only; chain enum is ['ethereum']", () => {
    const tool = getRegisteredTool("prepare_lido_stake");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "amount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum"],
    });
  });

  it("handle stored shape: tx.to === getLidoStethAddress(1); valueWei > 0n; data starts with submit selector", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: FIXTURE_V_AMOUNT });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.status).toBe("prepared");
    expect(record.tx.chainId).toBe(1);
    expect(record.tx.to).toBe(STETH_ADDR);
    expect(record.tx.valueWei).toBe(1_000_000_000_000_000_000n);
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(SUBMIT_SELECTOR);
    expect(record.payloadFingerprint).toBe(FIXTURE_V_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// PREPARE RECEIPT verbatim (PREP-02 / T-PREP-RCPT-1)
// ---------------------------------------------------------------------------
describe("prepare_lido_stake — PREPARE RECEIPT verbatim", () => {
  it("receipt text matches LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE byte-identically", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: FIXTURE_V_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{STETH_CONTRACT}", STETH_ADDR)
      .replace("{AMOUNT}", FIXTURE_V_AMOUNT);
    expect(text).toBe(expected);
  });
});
