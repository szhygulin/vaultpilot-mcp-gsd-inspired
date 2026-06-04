// prepare_jito_stake_pool_deposit — Phase 15 Plan 15-03 Task 2 (SOL-W-16).
//
// NO-LIVE-RPC: _solanaRegistry.getConnection + _jitoChain.resolveJitoAccounts +
// getAssociatedTokenAddress mocked. FORCE demo=false. Fixture AB anchor. The
// unstake-not-supported NOTICE is asserted present on every successful prepare.
//
// PHASE-FINAL GATE: a register-all smoke check asserts ALL six Phase-15 tools are
// registered.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PublicKey } from "@solana/web3.js";

const { listAccountsSpy, getAtaSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  getAtaSpy: vi.fn(),
}));
vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) => listAccountsSpy(...args),
  };
});
vi.mock("@solana/spl-token", async () => {
  const actual = await vi.importActual<typeof import("@solana/spl-token")>("@solana/spl-token");
  return {
    ...actual,
    getAssociatedTokenAddress: (...args: unknown[]) => getAtaSpy(...args),
  };
});

import { type Connection } from "@solana/web3.js";

import { _jitoChain } from "../src/chains/solana/jito-stake-pool.js";
import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { setActiveSolanaPersona, _resetActivePersonaForTesting } from "../src/demo/state.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// Pinned to Fixture AB inputs (test/signing-fingerprint-solana.test.ts).
const FROM = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const POOL = "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb";
const WITHDRAW_AUTH = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9"; // A1
const RESERVE = "3m9y53V2QwBbrQxtv5WN4T8SA5zw7BpZ2ZBYpZZAu8MW"; // A2
const MGR_FEE = "7uYDwDDvFvKsHnvjt9D8gj2Gfd9Xzn4QYsf8KXrXrJsy"; // A3
const POOLMINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const DEST = "FzbcyEZ9m8xjtergWgWDq7mfPoHEbboBF791B6cTpzbq";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
// Fixture AB (DepositSol, lamports 1_000_000_000, referral == dest) fingerprint.
const FIXTURE_AB_FP = "0xe305d3967bb08b8a14dfdac336d2ee3f8c5e0739d854634883834ad98504109c";

const PAIRED = {
  chain: "solana" as const,
  address: FROM,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

// The tool defaults referralPoolAccount to the destination ATA (no-referral
// deposit). Fixture AB was pinned with referral == dest to match the tool, so the
// mocked resolved accounts + dest ATA reproduce the Fixture-AB fingerprint.
function stubConnection(ataPresent = true): Connection {
  return {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: FIXED_BLOCKHASH, lastValidBlockHeight: 1 })),
    getAccountInfo: vi.fn(async () => (ataPresent ? { data: Buffer.alloc(165), lamports: 1, owner: new PublicKey(POOLMINT), executable: false } : null)),
  } as unknown as Connection;
}

function mockResolved(): void {
  vi.spyOn(_jitoChain, "resolveJitoAccounts").mockResolvedValue({
    stakePool: new PublicKey(POOL),
    withdrawAuthority: new PublicKey(WITHDRAW_AUTH),
    reserveStake: new PublicKey(RESERVE),
    managerFeeAccount: new PublicKey(MGR_FEE),
    poolMint: new PublicKey(POOLMINT),
  });
}

let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_jito_stake_pool_deposit");
  if (!tool) throw new Error("prepare_jito_stake_pool_deposit not registered");
  return tool.handler(args);
}

describe("prepare_jito_stake_pool_deposit (SOL-W-16)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetHandleStoreForTesting();
    savedDemo = process.env.VAULTPILOT_DEMO;
    process.env.VAULTPILOT_DEMO = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReset();
    listAccountsSpy.mockReturnValue([PAIRED]);
    getAtaSpy.mockReset();
    getAtaSpy.mockResolvedValue(new PublicKey(DEST));
    _resetActivePersonaForTesting();
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection(true));
    mockResolved();
  });

  afterEach(() => {
    if (savedDemo === undefined) delete process.env.VAULTPILOT_DEMO;
    else process.env.VAULTPILOT_DEMO = savedDemo;
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();
  });

  it("ATA present → handle + Fixture-AB fingerprint + blind-sign NOTICE + unstake NOTICE", async () => {
    const res = await callTool({ lamports: "1000000000" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.payloadFingerprint).toBe(FIXTURE_AB_FP);
    expect(sc.jitoSolMint).toBe(POOLMINT);
    expect(sc.jitoSolAta).toBe(DEST);
    expect(sc.createJitoSolAta).toBe(false);
    expect(sc.unstakeSupported).toBe(false);
    expect(sc.blindSign).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/LEDGER NOTICE/);
    // The unstake-not-supported NOTICE is unmissable.
    expect(text).toMatch(/\[NOTICE — Jito stake-pool unstake not yet supported\]/);
  });

  it("ATA absent → createATA NOTICE; createJitoSolAta true; fingerprint differs from Fixture AB; unstake NOTICE still present", async () => {
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection(false));
    const res = await callTool({ lamports: "1000000000" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.createJitoSolAta).toBe(true);
    expect(sc.payloadFingerprint).not.toBe(FIXTURE_AB_FP);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/create your jitoSOL token account/);
    expect(text).toMatch(/\[NOTICE — Jito stake-pool unstake not yet supported\]/);
  });

  it("PREPARE RECEIPT is verbatim from raw args (lamports)", async () => {
    const res = await callTool({ lamports: "1000000000" });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/lamports:\s+1000000000/);
  });

  it("refuses INVALID_INPUT on a fractional lamports", async () => {
    const res = await callTool({ lamports: "1.5" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });

  it("refuses WALLET_NOT_PAIRED when no Solana account paired", async () => {
    listAccountsSpy.mockReturnValue([]);
    const res = await callTool({ lamports: "1000000000" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("WALLET_NOT_PAIRED");
  });

  it("demo mode (VAULTPILOT_DEMO=true) → uses the active persona as feePayer; same Fixture-AB fingerprint", async () => {
    process.env.VAULTPILOT_DEMO = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersona({ slug: "test-whale", solanaAddress: FROM });
    const res = await callTool({ lamports: "1000000000" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.payloadFingerprint).toBe(FIXTURE_AB_FP);
    expect(sc.feePayer).toBe(FROM);
  });

  it("BROADCAST_FAILED when the Jito pool resolve throws", async () => {
    vi.spyOn(_jitoChain, "resolveJitoAccounts").mockRejectedValue(new Error("pool not found"));
    const res = await callTool({ lamports: "1000000000" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("BROADCAST_FAILED");
  });
});

// PHASE-FINAL GATE — all six Phase-15 tools registered (register-all smoke check).
describe("Phase 15 register-all smoke check (all six tools registered)", () => {
  const PHASE_15_TOOLS = [
    "prepare_solana_delegate",
    "prepare_solana_deactivate",
    "prepare_solana_withdraw",
    "prepare_marinade_stake",
    "prepare_marinade_immediate_unstake",
    "prepare_jito_stake_pool_deposit",
  ];
  for (const name of PHASE_15_TOOLS) {
    it(`${name} is registered`, () => {
      expect(getRegisteredTool(name)).toBeDefined();
    });
  }
});
