// preview_send Compound V3 tests — Phase 28 Plan 28-04.
//
// Anchors:
//   - 4-arm intent re-derivation matrix at PREVIEW TIME (not just prepare time):
//     supply/non-base → supply-collateral
//     supply/base/no-debt → supply-collateral
//     supply/base/with-debt → repay-debt
//     withdraw/non-base → withdraw-collateral
//     withdraw/base/no-supply → borrow
//     withdraw/base/with-supply → withdraw-collateral
//   - tokenContext resolved from decoded.asset (T-COMPOUND-TX-TO-CONFUSION-1)
//   - LEDGER NOTICE emitted IMMEDIATELY ABOVE the LEDGER BLIND-SIGN HASH block
//   - DECODED ARGS shows the DERIVED intent label
//   - LEDGER NOTICE NOT emitted on non-Comet tx.to even with Compound calldata
//     (defensive — only canonical Comets get the notice)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

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
      throw new Error("pair should not be called from preview_send.compound tests");
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

import { _compoundChains } from "../src/chains/compound-v3.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import { getCompoundCometAddress } from "../src/config/contracts.js";
import { _canonicalDispatch } from "../src/security/canonical-dispatch.js";
import { LEDGER_NOTICE_COMPOUND_TEMPLATE } from "../src/signing/blocks.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

const SENDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [SENDER as `0x${string}`],
  activeAccount: SENDER as `0x${string}`,
  address: SENDER as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" as Address;
const cUSDCv3 = getCompoundCometAddress(1, "USDC")!;
const OFF_LIST_COMET = getAddress("0xdEaDBeefDEaDbeefdEAdbEEFdEadbeeFDeAdbEEf");

// Compound V3 supply(USDC, 100 USDC) calldata. Selector 0xf2b9fdb8 + asset + amount.
const COMPOUND_SUPPLY_USDC =
  ("0xf2b9fdb8" +
    "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
    "0000000000000000000000000000000000000000000000000000000005f5e100") as Hex;

// Compound V3 supply(WBTC, 1 WBTC) — non-base; intent should be supply-collateral.
const COMPOUND_SUPPLY_WBTC =
  ("0xf2b9fdb8" +
    "0000000000000000000000002260fac5e5542a773aa44fbcfedf7c193bc2c599" +
    "0000000000000000000000000000000000000000000000000000000005f5e100") as Hex;

// Compound V3 withdraw(USDC, 100 USDC). Selector 0xf3fef3a3 + asset + amount.
const COMPOUND_WITHDRAW_USDC =
  ("0xf3fef3a3" +
    "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
    "0000000000000000000000000000000000000000000000000000000005f5e100") as Hex;

// Compound V3 withdraw(WBTC, 1 WBTC).
const COMPOUND_WITHDRAW_WBTC =
  ("0xf3fef3a3" +
    "0000000000000000000000002260fac5e5542a773aa44fbcfedf7c193bc2c599" +
    "0000000000000000000000000000000000000000000000000000000005f5e100") as Hex;

const FIXTURE_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;

function seedHandle(
  data: Hex,
  txTo: Address = cUSDCv3,
  asset: Address = USDC,
): string {
  return createHandle({
    args: { to: "", valueWei: "0", tokenAddress: asset, amount: "100" },
    tx: {
      chainId: 1,
      to: txTo,
      valueWei: 0n,
      data,
    },
    payloadFingerprint: FIXTURE_FINGERPRINT,
  });
}

function scriptStdMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(7);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
  });
  estimateGasSpy.mockResolvedValue(21_000n);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

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
  // Phase 9 Plan 09-04: stub Layer 0.5 dispatch-target allowlist to OK so the
  // Compound preview tests don't hit the Layer 0.5 refusal gate on the
  // off-list-comet scenario.
  vi.spyOn(_canonicalDispatch, "checkDispatchTarget").mockReturnValue({ kind: "ok" });
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 4-arm intent re-derivation matrix at PREVIEW TIME (defense-in-depth).
// ---------------------------------------------------------------------------

describe("preview_send Compound — 4-arm intent re-derivation matrix (defense-in-depth)", () => {
  it("supply/non-base → DECODED ARGS shows intent: supply-collateral", async () => {
    const handle = seedHandle(COMPOUND_SUPPLY_WBTC, cUSDCv3, WBTC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("supply-collateral");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("DECODED ARGS");
    expect(text).toContain("intent:    supply-collateral");
  });

  it("supply/base/no-debt → intent: supply-collateral (lender position)", async () => {
    const handle = seedHandle(COMPOUND_SUPPLY_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("supply-collateral");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("intent:    supply-collateral");
  });

  it("supply/base/with-debt → intent: repay-debt (T-COMPOUND-INTENT-DRIFT-1 anchor)", async () => {
    const handle = seedHandle(COMPOUND_SUPPLY_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("repay-debt");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("intent:    repay-debt");
    // The derived intent surfaces in the DECODED ARGS block — NOT the agent's
    // claimed tool name. If the agent claimed "prepare_compound_supply" but
    // the on-chain state revealed outstanding debt, the user sees the actual
    // semantics on the device.
  });

  it("withdraw/non-base → intent: withdraw-collateral", async () => {
    const handle = seedHandle(COMPOUND_WITHDRAW_WBTC, cUSDCv3, WBTC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("intent:    withdraw-collateral");
  });

  it("withdraw/base/no-supply → intent: borrow (zero-supply unwind IS the borrow op)", async () => {
    const handle = seedHandle(COMPOUND_WITHDRAW_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("borrow");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("intent:    borrow");
  });

  it("withdraw/base/with-supply → intent: withdraw-collateral (base-asset unwind)", async () => {
    const handle = seedHandle(COMPOUND_WITHDRAW_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("intent:    withdraw-collateral");
  });
});

// ---------------------------------------------------------------------------
// T-COMPOUND-TX-TO-CONFUSION-1 anchor: tokenContext from decoded.asset.
// ---------------------------------------------------------------------------

describe("preview_send Compound — tokenContext from decoded.asset (T-COMPOUND-TX-TO-CONFUSION-1)", () => {
  it("supply DECODED ARGS surfaces USDC (asset) — NOT a lookup of record.tx.to (Comet contract)", async () => {
    const handle = seedHandle(COMPOUND_SUPPLY_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("supply-collateral");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    // The asset label must surface USDC (decoded from calldata), NOT
    // "(off-list token)" or "(unknown asset)" — proving the lookup uses
    // decoded.asset rather than record.tx.to (the Comet).
    expect(text).toContain("(USDC)");
    expect(text).not.toContain("(unknown asset");
  });
});

// ---------------------------------------------------------------------------
// LEDGER NOTICE block emission + positioning.
// ---------------------------------------------------------------------------

describe("preview_send Compound — LEDGER NOTICE block (research § Topic 8)", () => {
  it("Compound supply selector + canonical Comet tx.to → NOTICE block present AT THE TOP; structuredContent.ledgerNotice === 'compound-v3-blind-sign'", async () => {
    const handle = seedHandle(COMPOUND_SUPPLY_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("supply-collateral");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    // The verbatim NOTICE prose surfaces — drift in the wording breaks this
    // test at PR-review time.
    expect(text).toContain("LEDGER NOTICE");
    expect(text).toContain(
      "Compound V3 supply / withdraw is NOT covered by the Ledger Ethereum app's ERC-7730 clear-sign registry.",
    );
    expect(text).toContain("Settings → Blind signing → Enabled");
    expect(text).toContain("cryptographic anchor");

    // NOTICE appears BEFORE the EXPECTED LEDGER DEVICE DISPLAY block (top-of-
    // response discipline — actionable prerequisites precede artifacts to
    // verify). Same shape as the Phase 6 WETH unwrap precedent.
    const noticeIdx = text.indexOf("LEDGER NOTICE");
    const hashIdx = text.indexOf("EXPECTED LEDGER DEVICE DISPLAY");
    expect(noticeIdx).toBeGreaterThanOrEqual(0);
    expect(hashIdx).toBeGreaterThan(noticeIdx);

    const sc = result.structuredContent as { ledgerNotice: string | null };
    expect(sc.ledgerNotice).toBe("compound-v3-blind-sign");
  });

  it("Compound withdraw selector + canonical Comet tx.to → NOTICE block present", async () => {
    const handle = seedHandle(COMPOUND_WITHDRAW_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("LEDGER NOTICE");

    const sc = result.structuredContent as { ledgerNotice: string | null };
    expect(sc.ledgerNotice).toBe("compound-v3-blind-sign");
  });

  it("Compound calldata on OFF-LIST Comet address → NOTICE block ABSENT (defensive — only canonical Comets)", async () => {
    // The dispatch-allowlist stub (beforeEach) returns ok so the gate isn't
    // hit; the LEDGER NOTICE condition independently checks the Comets set.
    const handle = seedHandle(COMPOUND_SUPPLY_USDC, OFF_LIST_COMET, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("supply-collateral");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("LEDGER NOTICE");

    const sc = result.structuredContent as { ledgerNotice: string | null };
    expect(sc.ledgerNotice).toBeNull();
  });

  it("LEDGER_NOTICE_COMPOUND_TEMPLATE byte-identity: handler emits the template verbatim", async () => {
    const handle = seedHandle(COMPOUND_SUPPLY_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("supply-collateral");

    const result = await callTool({ handle });
    const text = result.content[0]?.text ?? "";
    // The template lands verbatim in the response — drift surfaces here.
    expect(text).toContain(LEDGER_NOTICE_COMPOUND_TEMPLATE);
  });
});

// ---------------------------------------------------------------------------
// Defense-in-depth: deriveIntent helper consumed at preview time.
// ---------------------------------------------------------------------------

describe("preview_send Compound — deriveIntent helper consumed at preview (defense-in-depth)", () => {
  it("_compoundChains.deriveIntent spy is called with the right args during preview", async () => {
    const handle = seedHandle(COMPOUND_SUPPLY_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    const spy = vi
      .spyOn(_compoundChains, "deriveIntent")
      .mockResolvedValueOnce("repay-debt");

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(1);
    // (client, comet, user, selector, asset) — Plan 28-02 helper signature.
    expect(spy.mock.calls[0]?.[1]).toBe(cUSDCv3);
    expect(spy.mock.calls[0]?.[2]).toBe(SENDER);
    expect(spy.mock.calls[0]?.[3]).toBe("supply");
    expect(spy.mock.calls[0]?.[4]).toBe(USDC);
  });

  it("RPC failure during deriveIntent → falls back to sentinel label (preview still succeeds)", async () => {
    const handle = seedHandle(COMPOUND_SUPPLY_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockRejectedValueOnce(new Error("RPC down"));

    const result = await callTool({ handle });
    // Preview MUST succeed even if intent-derivation fails — the LEDGER
    // BLIND-SIGN HASH match is the trust anchor; the intent label is UX.
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    // Sentinel label surfaces so the user sees something.
    expect(text).toMatch(/intent:\s+supply-collateral\?/);
  });
});

// ---------------------------------------------------------------------------
// structuredContent.decodedArgs surface.
// ---------------------------------------------------------------------------

describe("preview_send Compound — structuredContent.decodedArgs surface", () => {
  it("structuredContent.decodedArgs.kind === 'compound-supply' + asset + amount + intent", async () => {
    const handle = seedHandle(COMPOUND_SUPPLY_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("supply-collateral");

    const result = await callTool({ handle });
    const sc = result.structuredContent as {
      decodedArgs: {
        kind: string;
        asset?: string;
        amount?: string;
        isMax?: boolean;
        intent?: string;
      };
    };
    expect(sc.decodedArgs.kind).toBe("compound-supply");
    expect(sc.decodedArgs.asset?.toLowerCase()).toBe(USDC.toLowerCase());
    expect(sc.decodedArgs.amount).toBe("100000000");
    expect(sc.decodedArgs.isMax).toBe(false);
    expect(sc.decodedArgs.intent).toBe("supply-collateral");
  });

  it("structuredContent.decodedArgs.kind === 'compound-withdraw' for withdraw selector", async () => {
    const handle = seedHandle(COMPOUND_WITHDRAW_USDC, cUSDCv3, USDC);
    scriptStdMocks();
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("borrow");

    const result = await callTool({ handle });
    const sc = result.structuredContent as {
      decodedArgs: { kind: string; intent?: string };
    };
    expect(sc.decodedArgs.kind).toBe("compound-withdraw");
    expect(sc.decodedArgs.intent).toBe("borrow");
  });
});
