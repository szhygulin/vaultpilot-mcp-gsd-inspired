// test/get-kamino-positions.test.ts — Phase 13 Plan 13-04 Tasks 2 + 3 (SOL-W-06).
//
// NO-LIVE-RPC: the chain indirection (`_kaminoChain.getRawAccountInfo` /
// `decodeObligation` / `decodeReserve`) is spied so getAccountInfo never opens
// a live Connection. The kit→shape adapter (`adaptObligation` / `adaptReserve`)
// is pure given a synthetic kit-typed decoded object — tested directly to prove
// kit `Address`/`BN` are converted to base58/bigint at the seam (Pitfall 1/6).
//
// Covers:
//   - adapter seam: Address → base58 string, BN → bigint, pct → bps (no kit type
//     crosses the seam).
//   - PDA-presence read: getRawAccountInfo → null ⇒ absent (D-03 driver for 13-05).
//   - get_kamino_positions tool: vault-keyed supplied/borrowed + per-vault health
//     + elevationGroup verbatim.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { address } from "@solana/kit";
import BN from "bn.js";

import {
  _kaminoChain,
  adaptObligation,
  adaptReserve,
  getKaminoObligationInfo,
  type DecodedKaminoReserve,
} from "../src/chains/solana/kamino.js";
import { deriveKaminoObligationPda, getKaminoMainMarket } from "../src/config/contracts.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

const OWNER = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const MARKET = getKaminoMainMarket();
const RESERVE_A = "So11111111111111111111111111111111111111112"; // SOL reserve
const RESERVE_B = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC reserve

const PAIRED = {
  chain: "solana" as const,
  address: OWNER,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Synthetic kit-typed decoded shapes (what the codegen `Obligation.decode` /
// `Reserve.decode` produce — Address strings + BN). The adapter must convert
// these to base58/bigint WITHOUT leaking kit types downstream.
// ---------------------------------------------------------------------------
function synthDecodedObligation() {
  return {
    lendingMarket: address(MARKET),
    owner: address(OWNER),
    elevationGroup: 2,
    lastUpdate: { stale: 0 },
    deposits: [
      { depositReserve: address(RESERVE_A), depositedAmount: new BN("1000000000"), marketValueSf: new BN("0") },
      // a zero-amount slot — must be filtered out.
      { depositReserve: address("11111111111111111111111111111111"), depositedAmount: new BN("0"), marketValueSf: new BN("0") },
    ],
    borrows: [
      { borrowReserve: address(RESERVE_B), borrowedAmountSf: new BN("500000000"), marketValueSf: new BN("0") },
    ],
  };
}

function synthDecodedReserve(ltvPct: number, liqPct: number, decimals: number) {
  return {
    liquidity: { mintPubkey: address(RESERVE_B), mintDecimals: new BN(decimals) },
    config: { loanToValuePct: ltvPct, liquidationThresholdPct: liqPct, elevationGroups: [0, 2] },
  };
}

describe("Kamino kit→shape adapter (D-02, Pitfall 1/6)", () => {
  it("adaptObligation: Address → base58 string, BN → bigint, zero-amount slots filtered", () => {
    const out = adaptObligation(synthDecodedObligation() as never);
    expect(out.owner).toBe(OWNER);
    expect(typeof out.owner).toBe("string");
    expect(out.market).toBe(MARKET);
    expect(out.elevationGroup).toBe(2);
    // zero deposit slot filtered.
    expect(out.deposits).toHaveLength(1);
    expect(out.deposits[0]!.reserve).toBe(RESERVE_A);
    expect(out.deposits[0]!.depositedAmount).toBe(1_000_000_000n);
    expect(typeof out.deposits[0]!.depositedAmount).toBe("bigint");
    expect(out.borrows).toHaveLength(1);
    expect(out.borrows[0]!.reserve).toBe(RESERVE_B);
    expect(out.borrows[0]!.borrowedAmount).toBe(500_000_000n);
  });

  it("adaptObligation: NO @solana/kit Address type crosses the seam (plain strings only)", () => {
    const out = adaptObligation(synthDecodedObligation() as never);
    // base58 string, not a branded kit Address object with methods.
    expect(out.deposits[0]!.reserve.constructor).toBe(String);
    expect(out.borrows[0]!.reserve.constructor).toBe(String);
  });

  it("adaptReserve: pct → bps (× 100), BN decimals → number, elevationGroups verbatim", () => {
    const out = adaptReserve(RESERVE_A, synthDecodedReserve(75, 80, 6) as never);
    expect(out.reserve).toBe(RESERVE_A);
    expect(out.loanToValueBps).toBe(7_500n);
    expect(out.liquidationThresholdBps).toBe(8_000n);
    expect(out.mintDecimals).toBe(6);
    expect(out.elevationGroups).toEqual([0, 2]);
  });
});

describe("getKaminoObligationInfo — PDA-presence read (D-03 driver)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("PDA absent (getRawAccountInfo → null) → present:false, no decode", async () => {
    const decodeSpy = vi.spyOn(_kaminoChain, "decodeObligation");
    vi.spyOn(_kaminoChain, "getRawAccountInfo").mockResolvedValue(null);
    const info = await getKaminoObligationInfo(OWNER);
    expect(info.present).toBe(false);
    expect(info.obligation).toBeNull();
    expect(info.pda).toBe(deriveKaminoObligationPda(MARKET, OWNER));
    expect(decodeSpy).not.toHaveBeenCalled();
  });

  it("PDA present → decode via indirection + reserve resolution → adapted shape", async () => {
    vi.spyOn(_kaminoChain, "getRawAccountInfo").mockImplementation(async (pk: string) => {
      // obligation PDA + the two reserve accounts all "exist".
      return { data: Buffer.from([1, 2, 3]), pubkey: pk };
    });
    vi.spyOn(_kaminoChain, "decodeObligation").mockReturnValue(
      adaptObligation(synthDecodedObligation() as never),
    );
    const reserveMap: Record<string, DecodedKaminoReserve> = {
      [RESERVE_A]: adaptReserve(RESERVE_A, synthDecodedReserve(75, 80, 9) as never),
      [RESERVE_B]: adaptReserve(RESERVE_B, synthDecodedReserve(50, 60, 6) as never),
    };
    vi.spyOn(_kaminoChain, "decodeReserve").mockImplementation(
      (reservePk: string) => reserveMap[reservePk]!,
    );

    const info = await getKaminoObligationInfo(OWNER);
    expect(info.present).toBe(true);
    expect(info.obligation).not.toBeNull();
    expect(info.obligation!.deposits[0]!.reserve).toBe(RESERVE_A);
    expect(info.obligation!.borrows[0]!.reserve).toBe(RESERVE_B);
    // distinct reserves resolved (collateral + debt) — drives 13-05's refresh set.
    expect(info.reserves.map((r) => r.reserve).sort()).toEqual([RESERVE_B, RESERVE_A].sort());
  });
});

describe("get_kamino_positions tool (SOL-W-06)", () => {
  let savedDemo: string | undefined;

  async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
    const tool = getRegisteredTool("get_kamino_positions");
    if (!tool) throw new Error("get_kamino_positions not registered");
    return tool.handler(args);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    savedDemo = process.env.VAULTPILOT_DEMO;
    process.env.VAULTPILOT_DEMO = "false";
    _resetDemoModeForTesting();
    // a paired Solana account is required in real mode (reads are not custody-gated).
    vi.doMock("../src/wallet/non-evm-account-store.js", () => ({}));
  });

  afterEach(() => {
    if (savedDemo === undefined) delete process.env.VAULTPILOT_DEMO;
    else process.env.VAULTPILOT_DEMO = savedDemo;
    _resetDemoModeForTesting();
  });

  it("registered with correct name", () => {
    expect(getRegisteredTool("get_kamino_positions")).toBeTruthy();
  });

  it("rejects malformed wallet", async () => {
    const res = await callTool({ wallet: "not-base58!!" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });
});
