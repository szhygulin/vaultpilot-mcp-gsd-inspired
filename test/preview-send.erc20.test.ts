// preview_send tests — ERC-20 selector-routed DECODED ARGS block + DF-1 LOCKED
// SIMULATION block. Phase 6 — Plan 06-02.
//
// Mocking strategy mirrors test/preview-send.test.ts; adds `callSpy` for the
// new SIMULATION code path. Native-send regression (Test 7) asserts Fixture C
// `presignHash = 0xb28e4824...` byte-identically — load-bearing "didn't break
// Phase 4" anchor.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import type { FourbyteResult } from "../src/clients/fourbyte.js";

const {
  getStatusSpy,
  getTransactionCountSpy,
  estimateFeesPerGasSpy,
  estimateGasSpy,
  callSpy,
  lookupSelectorSpy,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getTransactionCountSpy: vi.fn(),
  estimateFeesPerGasSpy: vi.fn(),
  estimateGasSpy: vi.fn(),
  callSpy: vi.fn(),
  lookupSelectorSpy: vi.fn<[Hex | null], Promise<FourbyteResult>>(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from preview_send tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    getTransactionCount: (
      ...args: Parameters<typeof actual.getTransactionCount>
    ) => getTransactionCountSpy(...args),
    estimateFeesPerGas: (
      ...args: Parameters<typeof actual.estimateFeesPerGas>
    ) => estimateFeesPerGasSpy(...args),
    estimateGas: (
      ...args: Parameters<typeof actual.estimateGas>
    ) => estimateGasSpy(...args),
    call: (...args: Parameters<typeof actual.call>) => callSpy(...args),
  };
});

vi.mock("../src/clients/fourbyte.js", async () => {
  const actual = await vi.importActual<typeof import("../src/clients/fourbyte.js")>(
    "../src/clients/fourbyte.js",
  );
  return {
    ...actual,
    lookupSelector: (selector: Hex | null) => lookupSelectorSpy(selector),
  };
});

import {
  _resetHandleStoreForTesting,
  createHandle,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Fixture C anchor — Phase 4 cryptographic-binding chain regression value.
const FIXTURE_C_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const FIXTURE_C_VALUE_WEI_BIGINT = 1_000_000_000_000_000_000n;
const FIXTURE_C_NONCE = 7;
const FIXTURE_C_GAS = 21_000n;
const FIXTURE_C_MAX_FEE = 30_000_000_000n; // 30 gwei
const FIXTURE_C_MAX_PRIO = 1_500_000_000n; // 1.5 gwei
const FIXTURE_C_PRESIGN_HASH =
  "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85";

// Fixture D inputs — USDC transfer.
const USDC_CHECKSUMMED = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const RECIPIENT_LOWER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const TRANSFER_DATA =
  "0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000005f5e100" as Hex;
const FIXTURE_D_FINGERPRINT =
  "0x52f396cfab6f8f4dfbf10b36734e7d22e944d54657a72dc2c8d67e91f8c49f85" as Hex;

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [FIXTURE_C_TO as `0x${string}`],
  activeAccount: FIXTURE_C_TO as `0x${string}`,
  address: FIXTURE_C_TO as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

function seedTransferHandle(): string {
  return createHandle({
    args: {
      to: RECIPIENT_LOWER,
      valueWei: "0",
      tokenAddress: USDC_CHECKSUMMED.toLowerCase(),
      amount: "100",
    },
    tx: {
      chainId: 1,
      to: USDC_CHECKSUMMED,
      valueWei: 0n,
      data: TRANSFER_DATA,
    },
    payloadFingerprint: FIXTURE_D_FINGERPRINT,
  });
}

function seedOffListTransferHandle(): string {
  const offList = "0xdeadbeef00000000000000000000000000000000" as Address;
  return createHandle({
    args: {
      to: RECIPIENT_LOWER,
      valueWei: "0",
      tokenAddress: offList.toLowerCase(),
      amount: "100",
    },
    tx: {
      chainId: 1,
      to: offList,
      valueWei: 0n,
      data: TRANSFER_DATA,
    },
    payloadFingerprint: FIXTURE_D_FINGERPRINT,
  });
}

function seedNativeHandle(): string {
  return createHandle({
    args: { to: FIXTURE_C_TO, valueWei: "1000000000000000000" },
    tx: {
      chainId: 1,
      to: FIXTURE_C_TO,
      valueWei: FIXTURE_C_VALUE_WEI_BIGINT,
      data: "0x" as Hex,
    },
    payloadFingerprint: FIXTURE_D_FINGERPRINT,
  });
}

function scriptFixtureCMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(FIXTURE_C_NONCE);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: FIXTURE_C_MAX_FEE,
    maxPriorityFeePerGas: FIXTURE_C_MAX_PRIO,
  });
  estimateGasSpy.mockResolvedValue(FIXTURE_C_GAS);
}

beforeEach(() => {
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  callSpy.mockReset();
  lookupSelectorSpy.mockReset();
  // Default: 4byte returns a generic "found" for transfer selector,
  // not-applicable for native sends. Override per-test as needed.
  lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });
  // Default: simulation succeeds with empty resultData.
  callSpy.mockResolvedValue({ data: "0x" });
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

describe("preview_send — DECODED ARGS block for transfer (PREP-21)", () => {
  it("block surfaces function/token/recipient/amount/amountWei from decoded calldata", async () => {
    const handle = seedTransferHandle();
    scriptFixtureCMocks();
    // 4byte returns a "found" for transfer selector.
    lookupSelectorSpy.mockResolvedValueOnce({
      kind: "found",
      textSignature: "transfer(address,uint256)",
    });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("DECODED ARGS");
    expect(text).toContain("function:  transfer");
    expect(text).toContain("token:     USDC"); // registry hit
    // Recipient surfaces as the decoded checksummed form (the decoder
    // returns it in canonical EIP-55).
    expect(text).toMatch(/recipient:\s+0x70997970C51812dc3A010C7d01b50e0d17dc79C8/);
    expect(text).toContain("amount:    100 USDC");
    expect(text).toContain("amountWei: 100000000");
  });

  it("structuredContent.decodedArgs has kind: transfer + bigint-serialized amount", async () => {
    const handle = seedTransferHandle();
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      decodedArgs: { kind: string; to?: string; amount?: string };
    };
    expect(sc.decodedArgs.kind).toBe("transfer");
    expect(sc.decodedArgs.amount).toBe("100000000");
    // The recipient comes from the decoder (NOT from args), surfaced in
    // EIP-55 checksum form.
    expect(sc.decodedArgs.to?.toLowerCase()).toBe(RECIPIENT_LOWER.toLowerCase());
  });
});

describe("preview_send — DECODED ARGS off-list token fallback", () => {
  it("emits raw bigint amount + (decimals unknown — call get_token_metadata) note", async () => {
    const handle = seedOffListTransferHandle();
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("DECODED ARGS");
    expect(text).toContain("(off-list token)");
    expect(text).toContain("decimals unknown");
    expect(text).toContain("get_token_metadata");
    // The raw bigint surfaces as the amountHuman fallback.
    expect(text).toContain("100000000");
  });
});

describe("preview_send — SIMULATION block (DF-1 LOCKED wide scope)", () => {
  it("status: ok when eth_call returns non-empty data", async () => {
    const handle = seedTransferHandle();
    scriptFixtureCMocks();
    callSpy.mockResolvedValueOnce({
      data: "0x0000000000000000000000000000000000000000000000000000000000000001",
    });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("SIMULATION (preview-time eth_call)");
    expect(text).toContain("status: ok");
    expect(text).toContain("result: 0x");

    const sc = result.structuredContent as {
      simulation: { status: string; resultData: string | null };
    };
    expect(sc.simulation.status).toBe("ok");
    expect(sc.simulation.resultData).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    );
  });

  it("status: revert is NON-BLOCKING — preview_send returns 200 + LEDGER block intact (T-SIMULATION-RPC-FAIL-1)", async () => {
    const handle = seedTransferHandle();
    scriptFixtureCMocks();
    callSpy.mockRejectedValueOnce(new Error("execution reverted: ERC20: insufficient balance"));

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    // LEDGER block intact — trust anchor preserved.
    expect(text).toContain("LEDGER BLIND-SIGN HASH");
    // AGENT TASK + 4byte present.
    expect(text).toContain("[AGENT TASK");
    expect(text).toContain("4BYTE CROSS-CHECK");
    // SIMULATION shows revert.
    expect(text).toContain("status: revert");
    expect(text).toContain("ERC20: insufficient balance");

    const sc = result.structuredContent as {
      simulation: { status: string; errorMessage: string | null };
    };
    expect(sc.simulation.status).toBe("revert");
  });

  it("status: error (non-revert) is NON-BLOCKING — RPC failure → preview_send returns 200", async () => {
    const handle = seedTransferHandle();
    scriptFixtureCMocks();
    callSpy.mockRejectedValueOnce(new Error("network timeout"));

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("LEDGER BLIND-SIGN HASH"); // trust anchor still present
    expect(text).toContain("status: error");
    expect(text).toContain("network timeout");

    const sc = result.structuredContent as {
      simulation: { status: string };
    };
    expect(sc.simulation.status).toBe("error");
  });
});

describe("preview_send — native-send regression (Phase 4 didn't break)", () => {
  it("data === '0x' → NO DECODED ARGS block; SIMULATION still emitted; presignHash === Fixture C", async () => {
    const handle = seedNativeHandle();
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      presignHash: string;
      selector: Hex | null;
      decodedArgs: { kind: string };
      simulation: { status: string };
    };
    // Fixture C byte-identical — the load-bearing cryptographic-binding
    // chain regression value.
    expect(sc.presignHash).toBe(FIXTURE_C_PRESIGN_HASH);
    expect(sc.selector).toBeNull();
    // decodedArgs surfaces { kind: "unknown" } for native sends.
    expect(sc.decodedArgs.kind).toBe("unknown");
    // SIMULATION still emitted — defense-in-depth uniform per research § Topic 9.
    expect(sc.simulation.status).toBe("ok");

    const text = result.content[0]?.text ?? "";
    // The DECODED ARGS block is FILTERED out (empty string from
    // buildDecodedArgsBlock(unknown, ...) — the text-array join drops it).
    expect(text).not.toMatch(/DECODED ARGS\s*\n\s*function:/);
    // SIMULATION block IS present (native sends ALSO simulate).
    expect(text).toContain("SIMULATION (preview-time eth_call)");
    // Phase 4 block contract still holds.
    expect(text).toContain("LEDGER BLIND-SIGN HASH");
    expect(text).toContain("[AGENT TASK");
    expect(text).toContain("4BYTE CROSS-CHECK");
  });
});

describe("preview_send — simulation called with sender + tx fields", () => {
  it("call() receives the sender as account + record.tx.to + valueWei + data verbatim", async () => {
    const handle = seedTransferHandle();
    scriptFixtureCMocks();

    await callTool({ handle });

    expect(callSpy).toHaveBeenCalledTimes(1);
    const callArgs = callSpy.mock.calls[0]?.[1] as {
      account: string;
      to: string;
      value: bigint;
      data: string;
    };
    expect(callArgs.account).toBe(PAIRED_STATUS.address);
    expect(callArgs.to).toBe(USDC_CHECKSUMMED);
    expect(callArgs.value).toBe(0n);
    expect(callArgs.data).toBe(TRANSFER_DATA);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — Plan 06-03: approve DECODED ARGS surfacing.
// ---------------------------------------------------------------------------

const WETH_CHECKSUMMED = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;
const UNI_V3_CHECKSUMMED = "0xE592427A0AEce92De3Edee1F18E0157C05861564" as Address;
const UNI_V3_LOWERCASE = UNI_V3_CHECKSUMMED.toLowerCase() as Address;
const UNKNOWN_SPENDER = "0xDeAdBeefdEAdbeefdeAdbEEFDeaDbEEFdeAdBEEf" as Address;
const FIXTURE_E_FINGERPRINT =
  "0x46e20ff806defcabda8eb090f6cba368cb5b84ad058ff9eefd08c662185a8f5a" as Hex;

// WETH approve(Uniswap V3, MAX_UINT256) — Fixture E calldata.
const APPROVE_MAX_DATA =
  "0x095ea7b3000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as Hex;

// WETH approve(Uniswap V3, MAX_UINT256 - 1n) — bounded (high amount, NOT the
// unlimited sentinel; STRICT-equality threshold per research § Topic 6).
const APPROVE_MAX_MINUS_ONE_DATA =
  "0x095ea7b3000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe" as Hex;

// USDC approve(Uniswap V3, 100_000_000n) — bounded, decimals=6 known.
const APPROVE_USDC_100_DATA =
  "0x095ea7b3000000000000000000000000e592427a0aece92de3edee1f18e0157c058615640000000000000000000000000000000000000000000000000000000005f5e100" as Hex;

// WETH approve(UNKNOWN_SPENDER, MAX_UINT256) — unknown-spender label
// fallback.
const APPROVE_UNKNOWN_SPENDER_DATA =
  "0x095ea7b3000000000000000000000000deadbeefdeadbeefdeadbeefdeadbeefdeadbeefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as Hex;

// WETH approve(uniswap-V3 LOWERCASE address, MAX_UINT256) — case-insensitive
// spender-label lookup. Same on-the-wire bytes; the test ensures the decoded
// `spender` (which viem checksums) routes to the known-spender table even
// when the agent passed the lowercase form.
const APPROVE_LOWERCASE_DATA = APPROVE_MAX_DATA; // identical calldata bytes

function seedApproveHandle(data: Hex, txTo: Address = WETH_CHECKSUMMED): string {
  return createHandle({
    args: {
      to: "",
      valueWei: "0",
      tokenAddress: txTo.toLowerCase(),
      spender: UNI_V3_LOWERCASE,
      amount: "max",
    },
    tx: {
      chainId: 1,
      to: txTo,
      valueWei: 0n,
      data,
    },
    payloadFingerprint: FIXTURE_E_FINGERPRINT,
  });
}

describe("preview_send — DECODED ARGS approve(spender, MAX_UINT256) — UNLIMITED (PREP-29)", () => {
  it("⚠ UNLIMITED APPROVAL label + revoke hint + known spender label surface byte-identically", async () => {
    const handle = seedApproveHandle(APPROVE_MAX_DATA);
    scriptFixtureCMocks();
    lookupSelectorSpy.mockResolvedValueOnce({
      kind: "found",
      textSignature: "approve(address,uint256)",
    });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("DECODED ARGS");
    expect(text).toContain("function:     approve");
    expect(text).toContain("token:        WETH");
    expect(text).toContain(`spender:      ${UNI_V3_CHECKSUMMED}`);
    expect(text).toContain("spenderLabel: Uniswap V3 SwapRouter");
    // Unlimited label — STRICT byte-identical assertion (no renaming
    // tolerated; T-UNLIMITED-THRESHOLD-DRIFT-1 + T-UNLIMITED-AGENT-DECEPTION-1
    // mitigation).
    expect(text).toContain("amount:       ⚠ UNLIMITED APPROVAL");
    expect(text).toContain(
      "amountWei:    115792089237316195423570985008687907853269984665640564039457584007913129639935",
    );
    // Revoke hint surfaces VERBATIM.
    expect(text).toContain(
      "(call prepare_revoke_approval with the same tokenAddress + spender to revoke)",
    );

    const sc = result.structuredContent as {
      decodedArgs: { kind: string; isUnlimited?: boolean };
    };
    expect(sc.decodedArgs.kind).toBe("approve");
    expect(sc.decodedArgs.isUnlimited).toBe(true);
  });
});

describe("preview_send — DECODED ARGS approve(spender, MAX_UINT256 - 1n) — bounded (T-UNLIMITED-THRESHOLD-DRIFT-1)", () => {
  it("max-minus-one → NO unlimited label; numeric amount surfaces; no revoke hint", async () => {
    const handle = seedApproveHandle(APPROVE_MAX_MINUS_ONE_DATA);
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("DECODED ARGS");
    expect(text).toContain("function:     approve");
    // STRICT-equality guard: max-minus-one is NOT the unlimited sentinel.
    expect(text).not.toContain("⚠ UNLIMITED APPROVAL");
    expect(text).not.toContain("prepare_revoke_approval with the same");
    // The bounded amount surfaces as a numeric (WETH decimals=18 from registry).
    expect(text).toContain("amount:       115792089237316195423570985008687907853269984665640564039457.584007913129639934 WETH");

    const sc = result.structuredContent as {
      decodedArgs: { kind: string; isUnlimited?: boolean };
    };
    expect(sc.decodedArgs.kind).toBe("approve");
    expect(sc.decodedArgs.isUnlimited).toBe(false);
  });
});

describe("preview_send — DECODED ARGS approve(USDC, Uniswap V3, 100) — bounded with token context", () => {
  it("known token (USDC, decimals=6) + known spender → formatted amount + label", async () => {
    const handle = seedApproveHandle(APPROVE_USDC_100_DATA, USDC_CHECKSUMMED);
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("function:     approve");
    expect(text).toContain("token:        USDC");
    expect(text).toContain("spenderLabel: Uniswap V3 SwapRouter");
    expect(text).toContain("amount:       100 USDC");
    expect(text).toContain("amountWei:    100000000");
    expect(text).not.toContain("⚠ UNLIMITED APPROVAL");
  });
});

describe("preview_send — DECODED ARGS unknown spender (PREP-30 fallback literal)", () => {
  it("unknown spender → fallback label `(unknown spender — no prior interaction recorded)` surfaces verbatim", async () => {
    const handle = seedApproveHandle(APPROVE_UNKNOWN_SPENDER_DATA);
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("function:     approve");
    expect(text).toContain("spenderLabel: (unknown spender — no prior interaction recorded)");
  });
});

describe("preview_send — DECODED ARGS case-insensitive spender lookup (T-SPENDER-CASE-1)", () => {
  it("lowercase Uniswap V3 router in calldata → label still surfaces (lookupSpender normalizes)", async () => {
    // viem.decodeFunctionData returns the spender in checksummed form
    // regardless of the calldata byte-order. The case-insensitivity is
    // enforced INSIDE lookupSpender (via getAddress); this test confirms
    // the integration path doesn't introduce a regression.
    const handle = seedApproveHandle(APPROVE_LOWERCASE_DATA);
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("spenderLabel: Uniswap V3 SwapRouter");
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — Plan 06-04: WETH9.withdraw DECODED ARGS + LEDGER NOTICE block +
// insufficient-WETH revert simulation.
// ---------------------------------------------------------------------------

// Fixture F calldata: WETH9.withdraw(1e18). Selector 0x2e1a7d4d + 32-byte
// left-padded amount (1e18 hex = 0xde0b6b3a7640000).
const WITHDRAW_FIXTURE_F_DATA =
  "0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000" as Hex;
const FIXTURE_F_FINGERPRINT =
  "0x81a70e4a703de01b67ad1aaff7d97be8dde3ae6703a652a462f7de9e30e36596" as Hex;

function seedWithdrawHandle(data: Hex = WITHDRAW_FIXTURE_F_DATA, txTo: Address = WETH_CHECKSUMMED): string {
  return createHandle({
    args: {
      to: "",
      valueWei: "0",
      tokenAddress: txTo,
      amount: "1.0",
    },
    tx: {
      chainId: 1,
      to: txTo,
      valueWei: 0n,
      data,
    },
    payloadFingerprint: FIXTURE_F_FINGERPRINT,
  });
}

describe("preview_send — Plan 06-04 — DECODED ARGS withdraw (PREP-29 replaces stub)", () => {
  it("withdraw branch surfaces function/token/amount/amountWei from WETH9 calldata", async () => {
    const handle = seedWithdrawHandle();
    scriptFixtureCMocks();
    lookupSelectorSpy.mockResolvedValueOnce({
      kind: "found",
      textSignature: "withdraw(uint256)",
    });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("DECODED ARGS");
    expect(text).toContain("function:  withdraw");
    expect(text).toContain(`token:     ${WETH_CHECKSUMMED} (WETH9 — canonical)`);
    expect(text).toContain("amount:    1 WETH");
    expect(text).toContain("amountWei: 1000000000000000000");

    const sc = result.structuredContent as {
      decodedArgs: { kind: string; amount?: string };
    };
    expect(sc.decodedArgs.kind).toBe("withdraw");
    expect(sc.decodedArgs.amount).toBe("1000000000000000000");
  });
});

describe("preview_send — Plan 06-04 — LEDGER NOTICE block (research § Topic 5 A2 mitigation)", () => {
  it("withdraw selector + canonical WETH9 tx.to → NOTICE block present AT THE TOP; structuredContent.ledgerNotice === 'weth-unwrap-blind-sign'", async () => {
    const handle = seedWithdrawHandle();
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    // The exact NOTICE prose is asserted verbatim — drift in the wording
    // breaks this test at PR-review time.
    expect(text).toContain("LEDGER NOTICE");
    expect(text).toContain(
      "WETH unwrap is NOT covered by the Ledger Ethereum app's ERC-20 clear-sign plugin.",
    );
    expect(text).toContain("Settings → Blind signing → Enabled");

    // NOTICE appears BEFORE the LEDGER BLIND-SIGN HASH block (top-of-response
    // discipline — actionable prerequisites precede artifacts to verify).
    const noticeIdx = text.indexOf("LEDGER NOTICE");
    const hashIdx = text.indexOf("LEDGER BLIND-SIGN HASH");
    expect(noticeIdx).toBeGreaterThanOrEqual(0);
    expect(hashIdx).toBeGreaterThan(noticeIdx);

    const sc = result.structuredContent as { ledgerNotice: string | null };
    expect(sc.ledgerNotice).toBe("weth-unwrap-blind-sign");
  });

  it("transfer handle → NOTICE block ABSENT; structuredContent.ledgerNotice === null", async () => {
    const handle = seedTransferHandle();
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("LEDGER NOTICE");

    const sc = result.structuredContent as { ledgerNotice: string | null };
    expect(sc.ledgerNotice).toBeNull();
  });

  it("approve handle → NOTICE block ABSENT; structuredContent.ledgerNotice === null", async () => {
    const handle = seedApproveHandle(APPROVE_MAX_DATA);
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("LEDGER NOTICE");

    const sc = result.structuredContent as { ledgerNotice: string | null };
    expect(sc.ledgerNotice).toBeNull();
  });

  it("native send handle → NOTICE block ABSENT; structuredContent.ledgerNotice === null", async () => {
    const handle = seedNativeHandle();
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("LEDGER NOTICE");

    const sc = result.structuredContent as { ledgerNotice: string | null };
    expect(sc.ledgerNotice).toBeNull();
  });
});

describe("preview_send — Plan 06-04 — insufficient-WETH revert simulation (T-INSUFFICIENT-WETH-NO-WARN-1)", () => {
  it("withdraw + viem.call reverts → SIMULATION status: revert; LEDGER + NOTICE blocks intact", async () => {
    const handle = seedWithdrawHandle();
    scriptFixtureCMocks();
    // Solidity 0.8+ underflow on uint256 subtraction surfaces via the
    // panic-code reason; viem's call() throws with the revert reason text
    // in the error message.
    callSpy.mockRejectedValueOnce(
      new Error(
        "execution reverted: 0x4e487b710000000000000000000000000000000000000000000000000000000000000011",
      ),
    );

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    // LEDGER block intact — trust anchor preserved.
    expect(text).toContain("LEDGER BLIND-SIGN HASH");
    // NOTICE block intact — actionable prerequisite preserved.
    expect(text).toContain("LEDGER NOTICE");
    // SIMULATION shows revert.
    expect(text).toContain("status: revert");

    const sc = result.structuredContent as {
      simulation: { status: string };
      ledgerNotice: string | null;
    };
    expect(sc.simulation.status).toBe("revert");
    expect(sc.ledgerNotice).toBe("weth-unwrap-blind-sign");
  });
});
