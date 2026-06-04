// prepare_solana_deactivate — Phase 15 Plan 15-01 Task 2 (SOL-W-18).
// NO-LIVE-RPC + FORCE demo=false. Fixture G anchor.

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
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
// Fixture G (deactivate) fingerprint.
const FIXTURE_G_FP = "0xa590954636de3bb04431f6737811886ad654aa3f6244281ff7e6ba902f0b7144";

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
  const tool = getRegisteredTool("prepare_solana_deactivate");
  if (!tool) throw new Error("prepare_solana_deactivate not registered");
  return tool.handler(args);
}

describe("prepare_solana_deactivate (SOL-W-18)", () => {
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

  it("handle + Fixture-G fingerprint + blind-sign NOTICE", async () => {
    const res = await callTool({ stakeAccount: STAKE_ACCT });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.payloadFingerprint).toBe(FIXTURE_G_FP);
    expect(sc.stakeAccount).toBe(STAKE_ACCT);
    expect(sc.blindSign).toBe(true);
    expect(sc.clearSign).toBe(false);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/LEDGER NOTICE/);
    // Open Q3 — deactivation cooldown NOTICE (informational, not a refusal).
    expect(text).toMatch(/cooldown/i);
  });

  it("PREPARE RECEIPT is verbatim from raw args (stakeAccount)", async () => {
    const res = await callTool({ stakeAccount: STAKE_ACCT });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(new RegExp(`stakeAccount:\\s+${STAKE_ACCT}`));
  });

  it("refuses INVALID_INPUT on malformed stakeAccount", async () => {
    const res = await callTool({ stakeAccount: "bad!!" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });

  it("refuses WALLET_NOT_PAIRED when no Solana account paired", async () => {
    listAccountsSpy.mockReturnValue([]);
    const res = await callTool({ stakeAccount: STAKE_ACCT });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("WALLET_NOT_PAIRED");
  });
});
