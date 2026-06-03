// prepare_marginfi_account_init — Phase 13 Plan 13-03 Task 2 (SOL-W-05).
//
// NO-LIVE-RPC: the registry Connection is spied to return a canned blockhash;
// no live socket. account_init does NOT gate on PDA-presence (it CREATES the
// PDA). Asserts: handle + PREPARE RECEIPT + payloadFingerprint (Fixture S
// cross-link) + blind-sign LEDGER NOTICE that does NOT claim clear-sign (V11).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const listAccountsSpy = vi.fn();
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

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { deriveMarginfiAccountPda } from "../src/config/contracts.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

const SOLANA_WHALE = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
const PAIRED = {
  chain: "solana" as const,
  address: SOLANA_WHALE,
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

let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_marginfi_account_init");
  if (!tool) throw new Error("prepare_marginfi_account_init not registered");
  return tool.handler(args);
}

describe("prepare_marginfi_account_init (SOL-W-05)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetHandleStoreForTesting();
    savedDemo = process.env.VAULTPILOT_DEMO;
    process.env.VAULTPILOT_DEMO = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReset();
  });

  afterEach(() => {
    if (savedDemo === undefined) delete process.env.VAULTPILOT_DEMO;
    else process.env.VAULTPILOT_DEMO = savedDemo;
    _resetDemoModeForTesting();
  });

  it("mints a handle + PREPARE RECEIPT + Fixture-S fingerprint + blind-sign NOTICE (no PDA gate)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection());

    const res = await callTool({});
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.marginfiAccountPda).toBe(deriveMarginfiAccountPda(SOLANA_WHALE, 0));
    // Fixture S anchor cross-link (signing-fingerprint-solana.test.ts).
    expect(sc.payloadFingerprint).toBe(
      "0x535aab49143386e1adcbffb6713b1c1c6b494df9706cb4393fc4523b4a5b2710",
    );
    expect(sc.txType).toBe("solana");
    expect(sc.blindSign).toBe(true);
    expect(sc.clearSign).toBe(false);

    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/LEDGER NOTICE/);
    expect(text).toMatch(/BLIND-SIGN/i);
    // Must NOT claim clear-sign coverage (V11/SC-7).
    expect(text).not.toMatch(/clear-?signs? this/i);
  });

  it("refuses WALLET_NOT_PAIRED when no Solana account is paired (real mode)", async () => {
    listAccountsSpy.mockReturnValue([]);
    const res = await callTool({});
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
  });

  it("surfaces BROADCAST_FAILED when getLatestBlockhash throws", async () => {
    listAccountsSpy.mockReturnValue([PAIRED]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue({
      getLatestBlockhash: vi.fn(async () => {
        throw new Error("RPC down");
      }),
    } as unknown as Connection);
    const res = await callTool({});
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe(
      "BROADCAST_FAILED",
    );
  });
});
