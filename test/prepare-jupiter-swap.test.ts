// prepare_jupiter_swap — Phase 14 Plan 14-02 Task 1 (SOL-W-12 + SOL-W-13).
//
// NO-LIVE-HTTP / NO-LIVE-RPC: _jupiter.getQuote + _jupiter.getSwapTransaction
// are spied; the pinned legacy-tx b64 (the SINGLE shared fixture 14-01 owns) is
// fed verbatim — NEVER a live /swap call, NEVER a live Connection, NEVER a second
// copy of the base64. VAULTPILOT_DEMO is pinned in beforeEach + restored in
// afterEach (Pitfall 3 — the just-fixed Phase-13 CI-failure class).
//
// Cases: binding byte-identity (cross-link Fixture Z) · MEV refusal (>2% + no
// explicit slippage → SANDWICH_MEV_REFUSED, NO handle) · MEV pass (explicit
// slippage OR <2%) · size-overflow HARD refusal (NO v0 fallback) · CHECKS
// PERFORMED From/To/impact from the QUOTE · blind-sign LEDGER NOTICE +
// blindSign:true · demo-FIRST WRONG_MODE / real-mode WALLET_NOT_PAIRED.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy: vi.fn(),
}));
vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) =>
      listAccountsSpy(...args),
  };
});
vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (...args: Parameters<typeof actual.createHandle>) =>
      createHandleSpy(...args),
  };
});

import { Transaction } from "@solana/web3.js";

import { _jupiter } from "../src/clients/jupiter.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import { computeSolanaPayloadFingerprint } from "../src/signing/payload-fingerprint-solana.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { JUPITER_SWAP_LEGACY_B64 } from "./fixtures/jupiter-swap-legacy.b64.js";

await import("../src/tools/register-all.js");

const realHandleStore = await vi.importActual<
  typeof import("../src/signing/handle-store.js")
>("../src/signing/handle-store.js");

const WHALE = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const PAIRED = {
  chain: "solana" as const,
  address: WHALE,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

// Fixture Z fingerprint = computeSolanaPayloadFingerprint over the pinned swap
// message bytes (cross-link test/signing-fingerprint-solana.test.ts).
const EXPECTED_FP = computeSolanaPayloadFingerprint({
  messageBytes: new Uint8Array(
    Transaction.from(Buffer.from(JUPITER_SWAP_LEGACY_B64, "base64")).serializeMessage(),
  ),
});

function makeQuote(priceImpactPct: string) {
  return {
    inputMint: SOL_MINT,
    inAmount: "100000000",
    outputMint: USDC_MINT,
    outAmount: "17057460",
    otherAmountThreshold: "16886885",
    swapMode: "ExactIn",
    slippageBps: 50,
    priceImpactPct,
    routePlan: [
      {
        swapInfo: {
          ammKey: "amm1",
          label: "Orca",
          inputMint: SOL_MINT,
          outputMint: USDC_MINT,
          inAmount: "100000000",
          outAmount: "17057460",
          feeAmount: "100",
          feeMint: SOL_MINT,
        },
        percent: 100,
      },
    ],
    contextSlot: 0,
  };
}

const ARGS = { inputMint: SOL_MINT, outputMint: USDC_MINT, amount: "100000000" };

let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_jupiter_swap");
  if (!tool) throw new Error("prepare_jupiter_swap not registered");
  return tool.handler(args);
}

function stubOkSwap(impact: string) {
  vi.spyOn(_jupiter, "getQuote").mockResolvedValue({ kind: "ok", quote: makeQuote(impact) });
  vi.spyOn(_jupiter, "getSwapTransaction").mockResolvedValue({
    kind: "ok",
    swapTransaction: JUPITER_SWAP_LEGACY_B64,
  });
}

describe("prepare_jupiter_swap (SOL-W-12 + SOL-W-13)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetHandleStoreForTesting();
    savedDemo = process.env.VAULTPILOT_DEMO;
    process.env.VAULTPILOT_DEMO = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReset();
    createHandleSpy.mockClear();
    createHandleSpy.mockImplementation(realHandleStore.createHandle);
    listAccountsSpy.mockReturnValue([PAIRED]);
    _resetActivePersonaForTesting();
  });

  afterEach(() => {
    if (savedDemo === undefined) delete process.env.VAULTPILOT_DEMO;
    else process.env.VAULTPILOT_DEMO = savedDemo;
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();
  });

  it("binding byte-identity: payloadFingerprint == Fixture Z over the pinned swap message bytes", async () => {
    stubOkSwap("0.0001");
    const res = await callTool(ARGS);
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.payloadFingerprint).toBe(EXPECTED_FP);
    expect(sc.txType).toBe("solana");
    expect(typeof sc.handle).toBe("string");
  });

  it("MEV refusal (SOL-W-13): impact 2.5% + NO explicit slippage → SANDWICH_MEV_REFUSED, NO handle", async () => {
    vi.spyOn(_jupiter, "getQuote").mockResolvedValue({ kind: "ok", quote: makeQuote("0.025") });
    const swapSpy = vi.spyOn(_jupiter, "getSwapTransaction");
    createHandleSpy.mockClear();

    const res = await callTool(ARGS);
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("SANDWICH_MEV_REFUSED");
    // NO handle minted on the refusal; the /swap call is never made.
    expect(createHandleSpy).not.toHaveBeenCalled();
    expect(swapSpy).not.toHaveBeenCalled();
    expect(sc.handle).toBeUndefined();
  });

  it("MEV pass: impact 2.5% WITH explicit slippageBps → proceeds to a handle", async () => {
    vi.spyOn(_jupiter, "getQuote").mockResolvedValue({ kind: "ok", quote: makeQuote("0.025") });
    vi.spyOn(_jupiter, "getSwapTransaction").mockResolvedValue({
      kind: "ok",
      swapTransaction: JUPITER_SWAP_LEGACY_B64,
    });
    const res = await callTool({ ...ARGS, slippageBps: 300 });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as Record<string, unknown>).payloadFingerprint).toBe(EXPECTED_FP);
  });

  it("MEV pass: impact 0.1% + no slippage → proceeds (default 50-bps hint below threshold)", async () => {
    stubOkSwap("0.001");
    const res = await callTool(ARGS);
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as Record<string, unknown>).handle).toBeDefined();
  });

  it("size overflow (Pitfall 1): /swap returns a too-large error → HARD refusal, NO handle, NO v0 fallback", async () => {
    vi.spyOn(_jupiter, "getQuote").mockResolvedValue({ kind: "ok", quote: makeQuote("0.0001") });
    vi.spyOn(_jupiter, "getSwapTransaction").mockResolvedValue({
      kind: "error",
      message: "Transaction too large: 1305 > 1232 bytes",
    });
    createHandleSpy.mockClear();
    const res = await callTool(ARGS);
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown>;
    // A structured refusal — NOT a silent v0 fallback / NOT a thrown crash.
    expect(typeof sc.errorCode).toBe("string");
    expect(createHandleSpy).not.toHaveBeenCalled();
    expect(sc.handle).toBeUndefined();
  });

  it("CHECKS PERFORMED (SC #4): From/To/Price-impact sourced from the QUOTE, not the opaque tx", async () => {
    stubOkSwap("0.0001");
    const res = await callTool(ARGS);
    const text = (res.content[0] as { text: string }).text;
    // From/To amounts come from the quote envelope (inAmount/outAmount) + symbols.
    expect(text).toMatch(/From:/);
    expect(text).toMatch(/To:/);
    expect(text).toMatch(/Price impact:/i);
    // The quote's symbol (SOL/USDC via the registry) is surfaced.
    expect(text).toMatch(/SOL/);
    expect(text).toMatch(/USDC/);
  });

  it("blind-sign: response carries the LEDGER NOTICE blind-sign block + blindSign:true", async () => {
    stubOkSwap("0.0001");
    const res = await callTool(ARGS);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/LEDGER NOTICE/);
    expect((res.structuredContent as Record<string, unknown>).blindSign).toBe(true);
  });

  it("the prepared handle stores the top-level programIds for the Layer-0.5 dispatch gate", async () => {
    stubOkSwap("0.0001");
    await callTool(ARGS);
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
    const handleArg = createHandleSpy.mock.calls[0][0] as { tx: { programIds: string[] } };
    expect(handleArg.tx.programIds).toContain("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    expect(handleArg.tx.programIds.length).toBe(5);
  });

  it("demo-FIRST: demo on + no Solana persona → WRONG_MODE (no handle)", async () => {
    process.env.VAULTPILOT_DEMO = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();
    createHandleSpy.mockClear();
    const res = await callTool(ARGS);
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("WRONG_MODE");
    expect(createHandleSpy).not.toHaveBeenCalled();
  });

  it("real mode + no paired Solana account → WALLET_NOT_PAIRED (no handle)", async () => {
    listAccountsSpy.mockReturnValue([]);
    createHandleSpy.mockClear();
    const res = await callTool(ARGS);
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("WALLET_NOT_PAIRED");
    expect(createHandleSpy).not.toHaveBeenCalled();
  });

  it("refuses INVALID_INPUT on a malformed inputMint", async () => {
    const res = await callTool({ ...ARGS, inputMint: "not-base58!!" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });
});
