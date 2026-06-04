// prepare_solana_withdraw — Phase 15 Plan 15-01 Task 2 (SOL-W-19).
// NO-LIVE-RPC + FORCE demo=false. Fixture H anchor.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { listAccountsSpy } = vi.hoisted(() => ({ listAccountsSpy: vi.fn() }));
vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) => listAccountsSpy(...args),
  };
});

import { type Connection } from "@solana/web3.js";

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

const FROM = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const STAKE_ACCT = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
const TO = "7uYDwDDvFvKsHnvjt9D8gj2Gfd9Xzn4QYsf8KXrXrJsy";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
// Fixture H (withdraw, lamports 1_000_000_000) fingerprint.
const FIXTURE_H_FP = "0x91b04458188f414dedb90b092b52cb17e4c80320d9220a2f544a9f1500056545";

const PAIRED = {
  chain: "solana" as const,
  address: FROM,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

function stubConnection(): Connection {
  return {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: FIXED_BLOCKHASH, lastValidBlockHeight: 1 })),
  } as unknown as Connection;
}

let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_solana_withdraw");
  if (!tool) throw new Error("prepare_solana_withdraw not registered");
  return tool.handler(args);
}

describe("prepare_solana_withdraw (SOL-W-19)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetHandleStoreForTesting();
    savedDemo = process.env.VAULTPILOT_DEMO;
    process.env.VAULTPILOT_DEMO = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReset();
    listAccountsSpy.mockReturnValue([PAIRED]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection());
  });

  afterEach(() => {
    if (savedDemo === undefined) delete process.env.VAULTPILOT_DEMO;
    else process.env.VAULTPILOT_DEMO = savedDemo;
    _resetDemoModeForTesting();
  });

  it("handle + Fixture-H fingerprint + blind-sign NOTICE + deactivation-window NOTICE (Open Q3)", async () => {
    const res = await callTool({ stakeAccount: STAKE_ACCT, to: TO, lamports: "1000000000" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.payloadFingerprint).toBe(FIXTURE_H_FP);
    expect(sc.stakeAccount).toBe(STAKE_ACCT);
    expect(sc.to).toBe(TO);
    expect(sc.lamports).toBe("1000000000");
    expect(sc.blindSign).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/LEDGER NOTICE/);
    expect(text).toMatch(/deactivation/i);
  });

  it("PREPARE RECEIPT is verbatim from raw args (stakeAccount + to + lamports)", async () => {
    const res = await callTool({ stakeAccount: STAKE_ACCT, to: TO, lamports: "1000000000" });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(new RegExp(`stakeAccount:\\s+${STAKE_ACCT}`));
    expect(text).toMatch(new RegExp(`to:\\s+${TO}`));
    expect(text).toMatch(/lamports:\s+1000000000/);
  });

  it("refuses INVALID_INPUT on malformed 'to'", async () => {
    const res = await callTool({ stakeAccount: STAKE_ACCT, to: "bad!!", lamports: "1000000000" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });

  it("refuses INVALID_INPUT on a fractional lamports", async () => {
    const res = await callTool({ stakeAccount: STAKE_ACCT, to: TO, lamports: "1.5" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });

  it("refuses WALLET_NOT_PAIRED when no Solana account paired", async () => {
    listAccountsSpy.mockReturnValue([]);
    const res = await callTool({ stakeAccount: STAKE_ACCT, to: TO, lamports: "1000000000" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("WALLET_NOT_PAIRED");
  });
});
