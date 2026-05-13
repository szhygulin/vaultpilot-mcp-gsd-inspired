// preview_send Aave tests — Phase 7 / Plan 07-03.
//
// Anchors:
//   - Aave supply DECODED ARGS surfacing (Fixture G calldata + USDC token
//     context from decodedArgs.asset, NOT record.tx.to)
//   - Aave withdraw DECODED ARGS surfacing (Fixture H)
//   - T-AAVE-TX-TO-CONFUSION-1: tokenContext resolved against decodedArgs.asset
//   - Long-tail asset (off-list, RPC fallback fails) → "(unknown asset)" label
//   - NO LEDGER NOTICE for Aave (T-AAVE-LEDGER-NOTICE-PREEMPTIVE-1 negative
//     anchor: response text does NOT contain "LEDGER NOTICE" for Aave;
//     Fixture F WETH unwrap still emits NOTICE — Phase 6 unchanged)
//   - Two-tier dispatch ordering: ERC-20 selectors NOT routed to Aave decoder
//   - Unknown selector falls through to generic 4byte cross-check

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
      throw new Error("pair should not be called from preview_send.aave tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    getTransactionCount: (...args: Parameters<typeof actual.getTransactionCount>) =>
      getTransactionCountSpy(...args),
    estimateFeesPerGas: (...args: Parameters<typeof actual.estimateFeesPerGas>) =>
      estimateFeesPerGasSpy(...args),
    estimateGas: (...args: Parameters<typeof actual.estimateGas>) => estimateGasSpy(...args),
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

import { getAaveV3PoolAddress } from "../src/config/contracts.js";
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

const SENDER_ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [SENDER_ADDR as `0x${string}`],
  activeAccount: SENDER_ADDR as `0x${string}`,
  address: SENDER_ADDR as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

const FIXTURE_NONCE = 7;
const FIXTURE_GAS = 21_000n;
const FIXTURE_MAX_FEE = 30_000_000_000n;
const FIXTURE_MAX_PRIO = 1_500_000_000n;

const USDC_CHECKSUMMED = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const WETH_CHECKSUMMED = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;

const FIXTURE_G_DATA =
  ("0x617ba037" +
    "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
    "0000000000000000000000000000000000000000000000000000000005f5e100" +
    "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" +
    "0000000000000000000000000000000000000000000000000000000000000000") as Hex;
const FIXTURE_G_FINGERPRINT =
  "0x67314a7f021fa9ba6d901ba555800a51d9f0e006f4e59489f69b486d009fce59" as Hex;

const FIXTURE_H_DATA =
  ("0x69328dec" +
    "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
    "0000000000000000000000000000000000000000000000000000000005f5e100" +
    "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8") as Hex;
const FIXTURE_H_FINGERPRINT =
  "0x782dd9aa096d47a4036b2023c01c1306d3b325fbbbbd4da8a1a5cd3ce42be40d" as Hex;

const FIXTURE_F_DATA =
  "0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000" as Hex;
const FIXTURE_F_FINGERPRINT =
  "0x81a70e4a703de01b67ad1aaff7d97be8dde3ae6703a652a462f7de9e30e36596" as Hex;

const TRANSFER_DATA =
  "0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000005f5e100" as Hex;
const FIXTURE_D_FINGERPRINT =
  "0x52f396cfab6f8f4dfbf10b36734e7d22e944d54657a72dc2c8d67e91f8c49f85" as Hex;

function seedAaveSupplyHandle(data: Hex = FIXTURE_G_DATA, asset: string = USDC_CHECKSUMMED): string {
  return createHandle({
    args: { to: "", valueWei: "0", tokenAddress: asset, amount: "100" },
    tx: {
      chainId: 1,
      to: getAaveV3PoolAddress(1),
      valueWei: 0n,
      data,
    },
    payloadFingerprint: FIXTURE_G_FINGERPRINT,
  });
}

function seedAaveWithdrawHandle(): string {
  return createHandle({
    args: { to: "", valueWei: "0", tokenAddress: USDC_CHECKSUMMED, amount: "100" },
    tx: {
      chainId: 1,
      to: getAaveV3PoolAddress(1),
      valueWei: 0n,
      data: FIXTURE_H_DATA,
    },
    payloadFingerprint: FIXTURE_H_FINGERPRINT,
  });
}

function seedWethWithdrawHandle(): string {
  return createHandle({
    args: { to: "", valueWei: "0", tokenAddress: WETH_CHECKSUMMED, amount: "1.0" },
    tx: {
      chainId: 1,
      to: WETH_CHECKSUMMED,
      valueWei: 0n,
      data: FIXTURE_F_DATA,
    },
    payloadFingerprint: FIXTURE_F_FINGERPRINT,
  });
}

function seedTransferHandle(): string {
  return createHandle({
    args: {
      to: SENDER_ADDR,
      valueWei: "0",
      tokenAddress: USDC_CHECKSUMMED,
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

function seedUnknownSelectorHandle(): string {
  const unknownData =
    "0xdeadbeef0000000000000000000000000000000000000000000000000000000000000000" as Hex;
  return createHandle({
    args: { to: "", valueWei: "0" },
    tx: {
      chainId: 1,
      to: "0x1111111111111111111111111111111111111111" as Address,
      valueWei: 0n,
      data: unknownData,
    },
    payloadFingerprint: FIXTURE_D_FINGERPRINT,
  });
}

function scriptStdMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(FIXTURE_NONCE);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: FIXTURE_MAX_FEE,
    maxPriorityFeePerGas: FIXTURE_MAX_PRIO,
  });
  estimateGasSpy.mockResolvedValue(FIXTURE_GAS);
}

beforeEach(() => {
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  callSpy.mockReset();
  lookupSelectorSpy.mockReset();
  lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });
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

describe("preview_send — Aave supply DECODED ARGS surfacing (Plan 07-03)", () => {
  it("Fixture G handle → DECODED ARGS block with pool/asset/amount/onBehalfOf/referralCode", async () => {
    const handle = seedAaveSupplyHandle();
    scriptStdMocks();
    lookupSelectorSpy.mockResolvedValueOnce({
      kind: "found",
      textSignature: "supply(address,uint256,address,uint16)",
    });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("DECODED ARGS");
    expect(text).toContain("function:     supply");
    expect(text).toContain(`pool:         ${getAaveV3PoolAddress(1)} (Aave V3 Pool — canonical)`);
    expect(text).toContain(`asset:        ${USDC_CHECKSUMMED} (USDC)`);
    expect(text).toContain("amount:       100");
    expect(text).toContain("amountWei:    100000000");
    expect(text).toContain(`onBehalfOf:   ${SENDER_ADDR}`);
    expect(text).toContain("referralCode: 0");

    const sc = result.structuredContent as {
      decodedArgs: { kind: string; asset?: string; onBehalfOf?: string; referralCode?: number };
    };
    expect(sc.decodedArgs.kind).toBe("aave-supply");
    expect(sc.decodedArgs.asset?.toLowerCase()).toBe(USDC_CHECKSUMMED.toLowerCase());
    expect(sc.decodedArgs.onBehalfOf?.toLowerCase()).toBe(SENDER_ADDR.toLowerCase());
    expect(sc.decodedArgs.referralCode).toBe(0);
  });
});

describe("preview_send — Aave withdraw DECODED ARGS surfacing", () => {
  it("Fixture H handle → DECODED ARGS block with pool/asset/amount/to", async () => {
    const handle = seedAaveWithdrawHandle();
    scriptStdMocks();
    lookupSelectorSpy.mockResolvedValueOnce({
      kind: "found",
      textSignature: "withdraw(address,uint256,address)",
    });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("DECODED ARGS");
    expect(text).toContain("function:  withdraw");
    expect(text).toContain(`pool:      ${getAaveV3PoolAddress(1)} (Aave V3 Pool — canonical)`);
    expect(text).toContain(`asset:     ${USDC_CHECKSUMMED} (USDC)`);
    expect(text).toContain("amount:    100");
    expect(text).toContain("amountWei: 100000000");
    expect(text).toContain(`to:        ${SENDER_ADDR}`);

    const sc = result.structuredContent as {
      decodedArgs: { kind: string; asset?: string; to?: string; isMax?: boolean };
    };
    expect(sc.decodedArgs.kind).toBe("aave-withdraw");
    expect(sc.decodedArgs.isMax).toBe(false);
  });
});

describe("preview_send — tokenContext resolved from decodedArgs.asset (T-AAVE-TX-TO-CONFUSION-1)", () => {
  it("supply DECODED ARGS surfaces USDC (asset) — NOT a lookup of record.tx.to (Pool)", async () => {
    const handle = seedAaveSupplyHandle();
    scriptStdMocks();

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    // The asset label must surface USDC (the asset, decoded from calldata),
    // not e.g. "(off-list token)" or some hypothetical "Aave V3 Pool" label.
    expect(text).toContain("(USDC)");
    expect(text).not.toContain("(off-list token)");
    expect(text).not.toContain("(unknown asset");
  });
});

describe("preview_send — long-tail asset (not in registry) falls back to unknown-asset label", () => {
  it("Fixture G with a fictional asset → (unknown asset — no registry match) when RPC fallback fails", async () => {
    // Construct supply calldata for a fictional asset.
    const fakeAsset = "0x1111111111111111111111111111111111111111";
    const data = ("0x617ba037" +
      "0000000000000000000000001111111111111111111111111111111111111111" +
      "0000000000000000000000000000000000000000000000000000000005f5e100" +
      "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" +
      "0000000000000000000000000000000000000000000000000000000000000000") as Hex;
    const handle = createHandle({
      args: { to: "", valueWei: "0", tokenAddress: fakeAsset, amount: "100" },
      tx: { chainId: 1, to: getAaveV3PoolAddress(1), valueWei: 0n, data },
      payloadFingerprint: FIXTURE_G_FINGERPRINT,
    });

    scriptStdMocks();

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    // The fictional asset is NOT in the top-50 registry; live RPC for
    // decimals()/symbol() is attempted against the real ethereum client
    // (which our test setup doesn't mock — the readContract calls will
    // throw or return junk). Best-effort: the catch block keeps
    // tokenContext null and the block surfaces the unknown-asset label.
    expect(text).toContain("(unknown asset");
  });
});

describe("preview_send — NO LEDGER NOTICE for Aave (T-AAVE-LEDGER-NOTICE-PREEMPTIVE-1 negative anchor)", () => {
  it("Fixture G (Aave supply) → response text does NOT contain LEDGER NOTICE; structuredContent.ledgerNotice === null", async () => {
    const handle = seedAaveSupplyHandle();
    scriptStdMocks();

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    // T-AAVE-LEDGER-NOTICE-PREEMPTIVE-1: Aave V3 supply IS covered by
    // Ledger's ERC-7730 calldata registry; the device clear-signs the call.
    // No NOTICE block is emitted.
    expect(text).not.toContain("LEDGER NOTICE");

    const sc = result.structuredContent as { ledgerNotice: string | null };
    expect(sc.ledgerNotice).toBeNull();
  });

  it("Fixture H (Aave withdraw) → response text does NOT contain LEDGER NOTICE", async () => {
    const handle = seedAaveWithdrawHandle();
    scriptStdMocks();

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("LEDGER NOTICE");

    const sc = result.structuredContent as { ledgerNotice: string | null };
    expect(sc.ledgerNotice).toBeNull();
  });

  it("Phase 6 unchanged: Fixture F (WETH unwrap) → response text DOES contain LEDGER NOTICE", async () => {
    const handle = seedWethWithdrawHandle();
    scriptStdMocks();

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    // Phase 6 WETH9 NOTICE conditional is byte-unchanged in preview_send.ts.
    // The Aave extension does NOT regress this — WETH unwrap still emits.
    expect(text).toContain("LEDGER NOTICE");
    expect(text).toContain("Settings → Blind signing → Enabled");

    const sc = result.structuredContent as { ledgerNotice: string | null };
    expect(sc.ledgerNotice).toBe("weth-unwrap-blind-sign");
  });
});

describe("preview_send — two-tier dispatch: ERC-20 selectors NOT routed to Aave decoder", () => {
  it("Fixture D (USDC transfer) → ERC-20 DECODED ARGS surfaces; decodedArgs.kind === 'transfer'", async () => {
    const handle = seedTransferHandle();
    scriptStdMocks();
    lookupSelectorSpy.mockResolvedValueOnce({
      kind: "found",
      textSignature: "transfer(address,uint256)",
    });

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    // ERC-20 dispatcher wins; Aave decoder is NOT consulted.
    expect(text).toContain("function:  transfer");
    expect(text).not.toContain("function:     supply");

    const sc = result.structuredContent as { decodedArgs: { kind: string } };
    expect(sc.decodedArgs.kind).toBe("transfer");
  });
});

describe("preview_send — unknown selector falls through to generic 4byte cross-check", () => {
  it("0xdeadbeef selector → decodedArgs.kind === 'unknown'; no DECODED ARGS block", async () => {
    const handle = seedUnknownSelectorHandle();
    scriptStdMocks();
    lookupSelectorSpy.mockResolvedValueOnce({ kind: "not-found" });

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { decodedArgs: { kind: string } };
    expect(sc.decodedArgs.kind).toBe("unknown");

    const text = result.content[0]?.text ?? "";
    // The Aave DECODED ARGS block is NOT emitted for unknown selectors.
    expect(text).not.toMatch(/DECODED ARGS\s*\n\s*function:\s+(supply|withdraw)/);
  });
});
