// prepare_kamino_borrow — Phase 13 Plan 13-05 Task 4 (SOL-W-07).
//
// NO-LIVE-RPC. Multi-reserve refresh ceremony (refreshReserve for EACH distinct
// collateral+debt reserve + refreshObligation before the borrow — Pattern 2).
// D-03 gate (VP_S007). Present → handle + receipt + blind-sign NOTICE + FROZEN
// fingerprint (Fixture V cross-link). Demo-mode isolation: VAULTPILOT_DEMO=false.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { createHandleSpy, listAccountsSpy } = vi.hoisted(() => ({
  createHandleSpy: vi.fn(),
  listAccountsSpy: vi.fn(),
}));
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

import { type Connection } from "@solana/web3.js";

import { _kaminoChain, type KaminoObligationInfo, type DecodedKaminoReserve } from "../src/chains/solana/kamino.js";
import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { deriveKaminoObligationPda, getKaminoMainMarket } from "../src/config/contracts.js";
import { checkSolanaDispatchTarget } from "../src/security/canonical-dispatch-solana.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

const realHandleStore = await vi.importActual<
  typeof import("../src/signing/handle-store.js")
>("../src/signing/handle-store.js");

const WHALE = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const RES_C = "8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36"; // collateral reserve
const RES_B = "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q"; // borrow reserve
const MINT_B = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";

const PAIRED = {
  chain: "solana" as const,
  address: WHALE,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

function stubConnection(): Connection {
  return {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: FIXED_BLOCKHASH, lastValidBlockHeight: 1 })),
  } as unknown as Connection;
}

function reserve(pubkey: string, mint: string): DecodedKaminoReserve {
  return {
    reserve: pubkey,
    mint,
    mintDecimals: 6,
    loanToValueBps: 5_000n,
    liquidationThresholdBps: 6_000n,
    elevationGroups: [0],
    liquiditySupplyVault: "FxteHmLwG9nk1eL4pjNve3Eub2goGkkz6g6TLvdmDyq5",
    liquidityFeeVault: "HRk9CMrpq7Jn9sh7mzxE8CChHG8dneX9p475QKz4Fsfc",
    collateralMint: "Gf6JxqgL3MwxAm7AmqsTNFGz7c2EFXY7g7CqJZBfHWqV",
    collateralSupplyVault: "D9z5pxYZ7tqkQ6oFwvQyZ4QyhRjuw6JtVefdT4U6kx2y",
    oracleAccounts: {
      pythOracle: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
      switchboardPriceOracle: "So11111111111111111111111111111111111111112",
      switchboardTwapOracle: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      scopePrices: "3NJYftD5sjVfxSnUdZ1wVML8f3aC6mp1CXCL6L7TnU8C",
    },
  };
}

// Multi-reserve obligation: collateral (RES_C) + debt (RES_B).
function presentObligation(): KaminoObligationInfo {
  return {
    pda: deriveKaminoObligationPda(getKaminoMainMarket(), WHALE),
    present: true,
    obligation: {
      market: getKaminoMainMarket(),
      owner: WHALE,
      elevationGroup: 0,
      stale: false,
      deposits: [{ reserve: RES_C, depositedAmount: 1_000_000n }],
      borrows: [{ reserve: RES_B, borrowedAmount: 100_000n }],
    },
    reserves: [reserve(RES_C, "So11111111111111111111111111111111111111112"), reserve(RES_B, MINT_B)],
  };
}

let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_kamino_borrow");
  if (!tool) throw new Error("prepare_kamino_borrow not registered");
  return tool.handler(args);
}

describe("prepare_kamino_borrow (SOL-W-07, D-01 + MULTI-RESERVE refresh + D-03)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetHandleStoreForTesting();
    savedDemo = process.env.VAULTPILOT_DEMO;
    process.env.VAULTPILOT_DEMO = "false";
    _resetDemoModeForTesting();
    createHandleSpy.mockClear();
    createHandleSpy.mockImplementation(realHandleStore.createHandle);
    listAccountsSpy.mockReset();
    listAccountsSpy.mockReturnValue([PAIRED]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection());
  });

  afterEach(() => {
    if (savedDemo === undefined) delete process.env.VAULTPILOT_DEMO;
    else process.env.VAULTPILOT_DEMO = savedDemo;
    _resetDemoModeForTesting();
  });

  it("present, multi-reserve → handle + blind-sign NOTICE; all touched programs allowlisted", async () => {
    vi.spyOn(_kaminoChain, "getKaminoObligationInfo").mockResolvedValue(presentObligation());
    const res = await callTool({ reserve: RES_B, amount: "0.25" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.reserve).toBe(RES_B);
    expect(sc.blindSign).toBe(true);
    // the multi-reserve refresh ceremony touches lending + Scope + Pyth +
    // Switchboard — all must pass (Pitfall 5).
    expect(checkSolanaDispatchTarget(sc.programIds as string[])).toEqual({ kind: "allowed" });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/LEDGER NOTICE/);
  });

  it("amount change → different fingerprint (binding embeds amount across the full vector)", async () => {
    vi.spyOn(_kaminoChain, "getKaminoObligationInfo").mockResolvedValue(presentObligation());
    const a = (await callTool({ reserve: RES_B, amount: "0.25" })).structuredContent as Record<string, unknown>;
    const b = (await callTool({ reserve: RES_B, amount: "0.26" })).structuredContent as Record<string, unknown>;
    expect(a.payloadFingerprint).not.toBe(b.payloadFingerprint);
  });

  it("D-03: Obligation absent → refuse VP_S007, NO handle minted", async () => {
    vi.spyOn(_kaminoChain, "getKaminoObligationInfo").mockResolvedValue({
      pda: deriveKaminoObligationPda(getKaminoMainMarket(), WHALE),
      present: false,
      obligation: null,
      reserves: [],
    });
    createHandleSpy.mockClear();
    const res = await callTool({ reserve: RES_B, amount: "0.25" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).solanaErrorCode).toBe("VP_S007");
    expect(createHandleSpy).not.toHaveBeenCalled();
  });
});
