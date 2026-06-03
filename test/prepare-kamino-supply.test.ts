// prepare_kamino_supply — Phase 13 Plan 13-05 Task 3 (SOL-W-07).
//
// NO-LIVE-RPC: the chain indirection (`_kaminoChain.getKaminoObligationInfo`) +
// the registry Connection (blockhash) are spied. D-03 gate: Obligation absent →
// VP_S007, NO handle minted. Present → handle + receipt + blind-sign LEDGER
// NOTICE + a deterministic fingerprint that routes through the FROZEN binding
// (cross-checked against an independently-assembled refresh-ceremony vector —
// Fixture T cross-link: the tool uses the same _kamino builders + FROZEN
// computeSolanaPayloadFingerprint).
//
// Demo-mode isolation (CI auto-demo arm): VAULTPILOT_DEMO forced to "false".

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

import { _kaminoChain, type KaminoObligationInfo } from "../src/chains/solana/kamino.js";
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
const RESERVE = "8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36";
const MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";

const PAIRED = {
  chain: "solana" as const,
  address: WHALE,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

function stubConnection(): Connection {
  return {
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: FIXED_BLOCKHASH,
      lastValidBlockHeight: 1,
    })),
  } as unknown as Connection;
}

function presentObligation(): KaminoObligationInfo {
  return {
    pda: deriveKaminoObligationPda(getKaminoMainMarket(), WHALE),
    present: true,
    obligation: {
      market: getKaminoMainMarket(),
      owner: WHALE,
      elevationGroup: 0,
      stale: false,
      deposits: [{ reserve: RESERVE, depositedAmount: 1_000_000n }],
      borrows: [],
    },
    reserves: [
      {
        reserve: RESERVE,
        mint: MINT,
        mintDecimals: 6,
        loanToValueBps: 7_500n,
        liquidationThresholdBps: 8_000n,
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
      },
    ],
  };
}

function absentObligation(): KaminoObligationInfo {
  return {
    pda: deriveKaminoObligationPda(getKaminoMainMarket(), WHALE),
    present: false,
    obligation: null,
    reserves: [],
  };
}

let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_kamino_supply");
  if (!tool) throw new Error("prepare_kamino_supply not registered");
  return tool.handler(args);
}

describe("prepare_kamino_supply (SOL-W-07, D-01 + refresh ceremony + D-03)", () => {
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

  it("Obligation present → handle + blind-sign NOTICE + refresh ceremony; dispatch passes", async () => {
    vi.spyOn(_kaminoChain, "getKaminoObligationInfo").mockResolvedValue(presentObligation());

    const res = await callTool({ reserve: RESERVE, amount: "1.5" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.reserve).toBe(RESERVE);
    expect(sc.mint).toBe(MINT);
    expect(sc.decimals).toBe(6);
    expect(sc.blindSign).toBe(true);
    expect(sc.clearSign).toBe(false);
    expect(typeof sc.payloadFingerprint).toBe("string");
    expect((sc.payloadFingerprint as string)).toMatch(/^0x[0-9a-f]{64}$/);

    // every touched programId passes the dispatch allowlist (Pitfall 5).
    const programIds = sc.programIds as string[];
    expect(checkSolanaDispatchTarget(programIds)).toEqual({ kind: "allowed" });

    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/LEDGER NOTICE/);
    expect(text).not.toMatch(/clear-?signs? this/i);
  });

  it("fingerprint is deterministic across two identical prepares (FROZEN binding)", async () => {
    vi.spyOn(_kaminoChain, "getKaminoObligationInfo").mockResolvedValue(presentObligation());
    const a = (await callTool({ reserve: RESERVE, amount: "1.5" })).structuredContent as Record<string, unknown>;
    const b = (await callTool({ reserve: RESERVE, amount: "1.5" })).structuredContent as Record<string, unknown>;
    expect(a.payloadFingerprint).toBe(b.payloadFingerprint);
  });

  it("amount change → different fingerprint (binding embeds the amount)", async () => {
    vi.spyOn(_kaminoChain, "getKaminoObligationInfo").mockResolvedValue(presentObligation());
    const a = (await callTool({ reserve: RESERVE, amount: "1.5" })).structuredContent as Record<string, unknown>;
    const b = (await callTool({ reserve: RESERVE, amount: "2.5" })).structuredContent as Record<string, unknown>;
    expect(a.payloadFingerprint).not.toBe(b.payloadFingerprint);
  });

  it("D-03: Obligation absent → refuse VP_S007, NO handle minted", async () => {
    vi.spyOn(_kaminoChain, "getKaminoObligationInfo").mockResolvedValue(absentObligation());
    createHandleSpy.mockClear();

    const res = await callTool({ reserve: RESERVE, amount: "1.5" });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.solanaErrorCode).toBe("VP_S007");
    expect((res.content[0] as { text: string }).text).toMatch(
      /prepare_kamino_obligation_init first/,
    );
    expect(createHandleSpy).not.toHaveBeenCalled();
    expect(sc.handle).toBeUndefined();
  });

  it("refuses INVALID_INPUT on malformed reserve pubkey", async () => {
    const res = await callTool({ reserve: "not-base58!!", amount: "1" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });

  it("refuses INVALID_INPUT on malformed amount", async () => {
    vi.spyOn(_kaminoChain, "getKaminoObligationInfo").mockResolvedValue(presentObligation());
    const res = await callTool({ reserve: RESERVE, amount: "abc" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });
});
