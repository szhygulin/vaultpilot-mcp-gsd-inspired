// prepare_marinade_immediate_unstake — Phase 15 Plan 15-02 Task 2 (SOL-W-15).
//
// NO-LIVE-RPC: _solanaRegistry.getConnection + _marinadeChain
// .resolveMarinadeAccounts + readImmediateUnstakeFee + getAssociatedTokenAddress
// mocked. FORCE demo=false. Fixture AA anchor. The VARIABLE fee is surfaced
// VERBATIM in CHECKS PERFORMED (SOL-W-15 load-bearing requirement).

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

import { _marinadeChain } from "../src/chains/solana/marinade.js";
import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// Pinned to Fixture AA inputs (test/signing-fingerprint-solana.test.ts).
const FROM = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const STATE = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";
const MSOL_MINT = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const A1 = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
const A2 = "3m9y53V2QwBbrQxtv5WN4T8SA5zw7BpZ2ZBYpZZAu8MW";
const A6 = "HRk9CMrpq7Jn9sh7mzxE8CChHG8dneX9p475QKz4Fsfc";
const MSOL_FROM = "3wvJdyFnGvaMWpbq93NU91SggiVRveULUXL6iX5VZDGP";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
// Fixture AA (liquidUnstake, msolAmount 500_000_000) fingerprint.
const FIXTURE_AA_FP = "0x23652c7c68c0a3740e7975611c9f89cdc6a25d223162ab4c30c33817ba239887";

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

function mockResolved(): void {
  vi.spyOn(_marinadeChain, "resolveMarinadeAccounts").mockResolvedValue({
    state: new PublicKey(STATE),
    msolMint: new PublicKey(MSOL_MINT),
    liqPoolSolLegPda: new PublicKey(A1),
    liqPoolMsolLeg: new PublicKey(A2),
    liqPoolMsolLegAuthority: new PublicKey(A1),
    reservePda: new PublicKey(A1),
    msolMintAuthority: new PublicKey(A1),
    treasuryMsolAccount: new PublicKey(A6),
  });
}

let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_marinade_immediate_unstake");
  if (!tool) throw new Error("prepare_marinade_immediate_unstake not registered");
  return tool.handler(args);
}

describe("prepare_marinade_immediate_unstake (SOL-W-15)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetHandleStoreForTesting();
    savedDemo = process.env.VAULTPILOT_DEMO;
    process.env.VAULTPILOT_DEMO = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReset();
    listAccountsSpy.mockReturnValue([PAIRED]);
    getAtaSpy.mockReset();
    getAtaSpy.mockResolvedValue(new PublicKey(MSOL_FROM));
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection());
    mockResolved();
    // VARIABLE fee read — mocked at the helper boundary (NO live RPC).
    vi.spyOn(_marinadeChain, "readImmediateUnstakeFee").mockResolvedValue({
      feeBp: 165,
      feeLamports: 8_250_000n, // 500_000_000 * 165 / 10000
      lpMinFeeBp: 30,
      lpMaxFeeBp: 300,
      lpLiquidityTarget: 10_000_000_000n,
      lamportsAvailable: 10_000_000_000n,
    });
  });

  afterEach(() => {
    if (savedDemo === undefined) delete process.env.VAULTPILOT_DEMO;
    else process.env.VAULTPILOT_DEMO = savedDemo;
    _resetDemoModeForTesting();
  });

  it("handle + Fixture-AA fingerprint + blind-sign NOTICE", async () => {
    const res = await callTool({ msolAmount: "500000000" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.payloadFingerprint).toBe(FIXTURE_AA_FP);
    expect(sc.blindSign).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/LEDGER NOTICE/);
  });

  it("surfaces the VARIABLE fee VERBATIM in CHECKS PERFORMED (SOL-W-15)", async () => {
    const res = await callTool({ msolAmount: "500000000" });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/CHECKS PERFORMED/);
    // feeBp + feeLamports + the lpMin/lpMax/lpLiquidityTarget inputs verbatim.
    expect(text).toMatch(/feeBp:\s+165/);
    expect(text).toMatch(/feeLamports:\s+8250000/);
    expect(text).toMatch(/lpMinFeeBp:\s+30/);
    expect(text).toMatch(/lpMaxFeeBp:\s+300/);
    expect(text).toMatch(/lpLiquidityTarget:\s+10000000000/);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.feeBp).toBe(165);
    expect(sc.feeLamports).toBe("8250000");
  });

  it("the fee read is over the requested msolAmount (interpolation input)", async () => {
    const spy = vi.spyOn(_marinadeChain, "readImmediateUnstakeFee");
    await callTool({ msolAmount: "500000000" });
    expect(spy).toHaveBeenCalledWith(500_000_000n);
  });

  it("PREPARE RECEIPT is verbatim from raw args (msolAmount)", async () => {
    const res = await callTool({ msolAmount: "500000000" });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/msolAmount:\s+500000000/);
  });

  it("refuses INVALID_INPUT on a fractional msolAmount", async () => {
    const res = await callTool({ msolAmount: "1.5" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("INVALID_INPUT");
  });

  it("refuses WALLET_NOT_PAIRED when no Solana account paired", async () => {
    listAccountsSpy.mockReturnValue([]);
    const res = await callTool({ msolAmount: "500000000" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("WALLET_NOT_PAIRED");
  });

  it("BROADCAST_FAILED when the fee read throws", async () => {
    vi.spyOn(_marinadeChain, "readImmediateUnstakeFee").mockRejectedValue(new Error("state read failed"));
    const res = await callTool({ msolAmount: "500000000" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("BROADCAST_FAILED");
  });
});
