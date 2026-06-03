// prepare_marginfi_borrow — Phase 13 Plan 13-03 Task 3 (SOL-W-04).
//
// NO-LIVE-RPC: the chain indirection (`_marginfiChain.getMarginfiAccountInfo`,
// `getBankInfo`, `deriveTokenAccount`) + the registry Connection are spied. The
// canned bank/token-account/PDA values match Fixture O exactly so the tool's
// preimage produces the byte-identical Fixture-Q fingerprint.
//
// D-03 gate: PDA absent → refuse with VP_S006, NO handle minted. PDA present →
// handle + receipt + fingerprint (Fixture Q) + blind-sign LEDGER NOTICE. Vault-authority shape carries the bank_liquidity_vault_authority[PDA].

import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.hoisted — `vi.mock` factories are hoisted above all module code; the
// referenced spies must be hoisted too (else "Cannot access before init").
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

import { type Connection } from "@solana/web3.js";

import { _marginfiChain } from "../src/chains/solana/marginfi.js";
import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { deriveMarginfiAccountPda } from "../src/config/contracts.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// Capture the REAL createHandle so beforeEach can re-establish the spy's
// implementation after `vi.restoreAllMocks()` (which wipes vi.fn impls).
const realHandleStore = await vi.importActual<
  typeof import("../src/signing/handle-store.js")
>("../src/signing/handle-store.js");

const WHALE = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const WHALE_PDA = "3m9y53V2QwBbrQxtv5WN4T8SA5zw7BpZ2ZBYpZZAu8MW";
const BANK = "CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh";
const TOKEN_ACCT = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
const LIQ_VAULT = "7uYDwDDvFvKsHnvjt9D8gj2Gfd9Xzn4QYsf8KXrXrJsy";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
// Fixture Q fingerprint (signing-fingerprint-solana.test.ts) — amount 25_000_000.
const FIXTURE_Q_FP =
  "0xc98fd6c6903d05a7858d5472b7aa2e10669e5ff98561723d7fe27df30d5a7626";

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

function mockPresentAccount(): void {
  vi.spyOn(_marginfiChain, "getMarginfiAccountInfo").mockResolvedValue({
    pda: deriveMarginfiAccountPda(WHALE, 0),
    present: true,
    account: { authority: WHALE, group: "4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8", balances: [] },
  });
  vi.spyOn(_marginfiChain, "getBankInfo").mockResolvedValue({
    mint: MINT,
    mintDecimals: 6,
    group: "4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8",
    liquidityVault: LIQ_VAULT,
    liquidityVaultAuthority: "D9z5pxYZ7tqkQ6oFwvQyZ4QyhRjuw6JtVefdT4U6kx2y",
  });
  vi.spyOn(_marginfiChain, "deriveTokenAccount").mockResolvedValue(TOKEN_ACCT);
}

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_marginfi_borrow");
  if (!tool) throw new Error("prepare_marginfi_borrow not registered");
  return tool.handler(args);
}

describe("prepare_marginfi_borrow (SOL-W-04, D-01 + D-03, vault-authority)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetHandleStoreForTesting();
    _resetDemoModeForTesting();
    listAccountsSpy.mockReset();
    createHandleSpy.mockClear();
    // restoreAllMocks wipes vi.fn impls — re-establish the real createHandle.
    createHandleSpy.mockImplementation(realHandleStore.createHandle);
    listAccountsSpy.mockReturnValue([PAIRED]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection());
  });

  it("PDA present → handle + Fixture-Q fingerprint + blind-sign NOTICE; vault-authority PDA in tx", async () => {
    mockPresentAccount();
    // WHALE_PDA must equal the derived PDA (cross-check fixture pubkey).
    expect(WHALE_PDA).toBe(deriveMarginfiAccountPda(WHALE, 0));

    const res = await callTool({ bank: BANK, amount: "25" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.payloadFingerprint).toBe(FIXTURE_Q_FP);
    expect(sc.mint).toBe(MINT);
    expect(sc.decimals).toBe(6);
    expect(sc.marginfiAccountPda).toBe(WHALE_PDA);
    expect(sc.blindSign).toBe(true);
    expect(sc.clearSign).toBe(false);

    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/LEDGER NOTICE/);
    expect(text).not.toMatch(/clear-?signs? this/i);
  });

  it("D-03: PDA absent → refuse VP_S006, NO handle minted (createHandle not reached)", async () => {
    vi.spyOn(_marginfiChain, "getMarginfiAccountInfo").mockResolvedValue({
      pda: deriveMarginfiAccountPda(WHALE, 0),
      present: false,
      account: null,
    });
    createHandleSpy.mockClear();

    const res = await callTool({ bank: BANK, amount: "100" });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.solanaErrorCode).toBe("VP_S006");
    expect((res.content[0] as { text: string }).text).toMatch(
      /prepare_marginfi_account_init first/,
    );
    // NO handle minted on the refusal.
    expect(createHandleSpy).not.toHaveBeenCalled();
    expect(sc.handle).toBeUndefined();
  });

  it("refuses INVALID_INPUT on malformed bank pubkey", async () => {
    const res = await callTool({ bank: "not-base58!!", amount: "100" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("refuses INVALID_INPUT when the bank is not found on-chain", async () => {
    vi.spyOn(_marginfiChain, "getMarginfiAccountInfo").mockResolvedValue({
      pda: deriveMarginfiAccountPda(WHALE, 0),
      present: true,
      account: { authority: WHALE, group: "g", balances: [] },
    });
    vi.spyOn(_marginfiChain, "getBankInfo").mockResolvedValue(null);
    const res = await callTool({ bank: BANK, amount: "100" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("refuses INVALID_INPUT on a malformed amount", async () => {
    mockPresentAccount();
    const res = await callTool({ bank: BANK, amount: "abc" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe(
      "INVALID_INPUT",
    );
  });
});
