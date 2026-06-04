// prepare_solana_delegate — Phase 15 Plan 15-01 Task 2 (SOL-W-17).
//
// NO-LIVE-RPC: _solanaRegistry.getConnection() is spied (stub Connection with
// getLatestBlockhash + getVoteAccounts). FORCE demo mode false in beforeEach +
// restore (Phase-13 CI-failure-prevention pattern, test/prepare-marginfi-supply
// .test.ts:117). Fingerprint anchors: Fixture E (existing stake account) +
// Fixture F (create-on-absent bundle) from test/signing-fingerprint-solana.test.ts.

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
import { setActiveSolanaPersona, _resetActivePersonaForTesting } from "../src/demo/state.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// Pinned to Fixture E/F inputs (test/signing-fingerprint-solana.test.ts).
const FROM = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const STAKE_ACCT = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
const VOTE = "3m9y53V2QwBbrQxtv5WN4T8SA5zw7BpZ2ZBYpZZAu8MW";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
const DERIVED_STAKE = "HQhu6oCtrgVzSLmyhXYnqD3w3kBh4GNzhrtL76CYVnWE";
// Fixture E (delegate existing) + F (delegate-with-create) fingerprints.
const FIXTURE_E_FP = "0x6888db92d4e0528da9c26a3f493ed0c3e9b1c3424292730b3ad9669ad16aaa0c";
const FIXTURE_F_FP = "0xf297332e4be50c89334aa81e5350abe0291ba073012fd021b3f9ac823f1993ba";

const PAIRED = {
  chain: "solana" as const,
  address: FROM,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

function stubConnection(commission: number | null = 5): Connection {
  return {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: FIXED_BLOCKHASH, lastValidBlockHeight: 1 })),
    getVoteAccounts: vi.fn(async () => ({
      current: commission === null ? [] : [{ votePubkey: VOTE, commission, nodePubkey: "x", activatedStake: 0, epochVoteAccount: true, epochCredits: [], lastVote: 0, rootSlot: 0 }],
      delinquent: [],
    })),
  } as unknown as Connection;
}

let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_solana_delegate");
  if (!tool) throw new Error("prepare_solana_delegate not registered");
  return tool.handler(args);
}

describe("prepare_solana_delegate (SOL-W-17)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetHandleStoreForTesting();
    savedDemo = process.env.VAULTPILOT_DEMO;
    process.env.VAULTPILOT_DEMO = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReset();
    listAccountsSpy.mockReturnValue([PAIRED]);
    _resetActivePersonaForTesting();
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection());
  });

  afterEach(() => {
    if (savedDemo === undefined) delete process.env.VAULTPILOT_DEMO;
    else process.env.VAULTPILOT_DEMO = savedDemo;
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();
  });

  it("existing stake account → handle + Fixture-E fingerprint + blind-sign NOTICE", async () => {
    const res = await callTool({ voteAccount: VOTE, lamports: "1000000000", stakeAccount: STAKE_ACCT });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.payloadFingerprint).toBe(FIXTURE_E_FP);
    expect(sc.stakeAccount).toBe(STAKE_ACCT);
    expect(sc.createdStakeAccount).toBe(false);
    expect(sc.blindSign).toBe(true);
    expect(sc.clearSign).toBe(false);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/LEDGER NOTICE/);
    expect(text).toMatch(/blind/i);
  });

  it("no stake account → create-on-absent BUNDLE: Fixture-F fingerprint + derived stake address surfaced", async () => {
    const res = await callTool({ voteAccount: VOTE, lamports: "1000000000" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.payloadFingerprint).toBe(FIXTURE_F_FP);
    expect(sc.createdStakeAccount).toBe(true);
    expect(sc.stakeAccount).toBe(DERIVED_STAKE);
    const text = (res.content[0] as { text: string }).text;
    // The derived stake address is surfaced in the PREPARE RECEIPT NOTICE.
    expect(text).toMatch(new RegExp(DERIVED_STAKE));
    expect(text).toMatch(/createAccountWithSeed/);
  });

  it("PREPARE RECEIPT is verbatim from raw args (voteAccount + lamports)", async () => {
    const res = await callTool({ voteAccount: VOTE, lamports: "1000000000", stakeAccount: STAKE_ACCT });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(new RegExp(`voteAccount:\\s+${VOTE}`));
    expect(text).toMatch(/lamports:\s+1000000000/);
  });

  it("surfaces validator commission % in the NOTICE when resolvable (Open Q2)", async () => {
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection(7));
    const res = await callTool({ voteAccount: VOTE, lamports: "1000000000", stakeAccount: STAKE_ACCT });
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.validatorCommission).toBe(7);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/commission 7%/);
  });

  it("does NOT hard-refuse when commission is unresolvable (NOTICE degrades; Open Q2)", async () => {
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection(null));
    const res = await callTool({ voteAccount: VOTE, lamports: "1000000000", stakeAccount: STAKE_ACCT });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.validatorCommission).toBeNull();
  });

  it("refuses INVALID_INPUT on malformed voteAccount", async () => {
    const res = await callTool({ voteAccount: "not-base58!!", lamports: "1000000000" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });

  it("refuses INVALID_INPUT on a fractional lamports (off-by-decimal guard)", async () => {
    const res = await callTool({ voteAccount: VOTE, lamports: "1.5" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });

  it("refuses WALLET_NOT_PAIRED when no Solana account paired (real mode)", async () => {
    listAccountsSpy.mockReturnValue([]);
    const res = await callTool({ voteAccount: VOTE, lamports: "1000000000" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("WALLET_NOT_PAIRED");
  });

  it("demo mode (VAULTPILOT_DEMO=true) → uses the active persona as feePayer; same Fixture-E fingerprint", async () => {
    process.env.VAULTPILOT_DEMO = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersona({ slug: "test-whale", solanaAddress: FROM });
    const res = await callTool({ voteAccount: VOTE, lamports: "1000000000", stakeAccount: STAKE_ACCT });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    // The persona address == FROM (the Fixture-E feePayer) → identical fingerprint.
    expect(sc.payloadFingerprint).toBe(FIXTURE_E_FP);
    expect(sc.feePayer).toBe(FROM);
  });

  it("demo mode with NO persona → WRONG_MODE refusal", async () => {
    process.env.VAULTPILOT_DEMO = "true";
    _resetDemoModeForTesting();
    const res = await callTool({ voteAccount: VOTE, lamports: "1000000000", stakeAccount: STAKE_ACCT });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("WRONG_MODE");
  });

  it("BROADCAST_FAILED when getLatestBlockhash throws", async () => {
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue({
      getLatestBlockhash: vi.fn(async () => { throw new Error("rpc down"); }),
      getVoteAccounts: vi.fn(async () => ({ current: [], delinquent: [] })),
    } as unknown as Connection);
    const res = await callTool({ voteAccount: VOTE, lamports: "1000000000" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("BROADCAST_FAILED");
  });
});
