// prepare_marinade_stake — Phase 15 Plan 15-02 Task 2 (SOL-W-14).
//
// NO-LIVE-RPC: _solanaRegistry.getConnection (getLatestBlockhash + getAccountInfo
// for the mSOL ATA presence check) + _marinadeChain.resolveMarinadeAccounts +
// getAssociatedTokenAddress are mocked. FORCE demo=false. Fixture I anchor.
// The resolved accounts + mSOL ATA are pinned to the Fixture-I literals so the
// tool's deposit preimage produces the byte-identical Fixture-I fingerprint.

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
import { setActiveSolanaPersona, _resetActivePersonaForTesting } from "../src/demo/state.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// Pinned to Fixture I inputs (test/signing-fingerprint-solana.test.ts).
const FROM = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const STATE = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";
const MSOL_MINT = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const A1 = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
const A2 = "3m9y53V2QwBbrQxtv5WN4T8SA5zw7BpZ2ZBYpZZAu8MW";
const A3 = "7uYDwDDvFvKsHnvjt9D8gj2Gfd9Xzn4QYsf8KXrXrJsy";
const A4 = "D9z5pxYZ7tqkQ6oFwvQyZ4QyhRjuw6JtVefdT4U6kx2y";
const A5 = "CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh";
const A6 = "HRk9CMrpq7Jn9sh7mzxE8CChHG8dneX9p475QKz4Fsfc";
const MINT_TO = "FzbcyEZ9m8xjtergWgWDq7mfPoHEbboBF791B6cTpzbq";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
// Fixture I (deposit, lamports 1_000_000_000) fingerprint.
const FIXTURE_I_FP = "0xa08f6970cbeb286e14da3612423f79e89fe7c2d116ae684c643b436ebadb6ebc";

const PAIRED = {
  chain: "solana" as const,
  address: FROM,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

// A Connection stub: getLatestBlockhash fixed; getAccountInfo returns a non-null
// object (ATA present → no createATA prepend → matches the single-ix Fixture I).
function stubConnection(ataPresent = true): Connection {
  return {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: FIXED_BLOCKHASH, lastValidBlockHeight: 1 })),
    getAccountInfo: vi.fn(async () => (ataPresent ? { data: Buffer.alloc(165), lamports: 1, owner: new PublicKey(MSOL_MINT), executable: false } : null)),
  } as unknown as Connection;
}

function mockResolved(): void {
  vi.spyOn(_marinadeChain, "resolveMarinadeAccounts").mockResolvedValue({
    state: new PublicKey(STATE),
    msolMint: new PublicKey(MSOL_MINT),
    liqPoolSolLegPda: new PublicKey(A1),
    liqPoolMsolLeg: new PublicKey(A2),
    liqPoolMsolLegAuthority: new PublicKey(A3),
    reservePda: new PublicKey(A4),
    msolMintAuthority: new PublicKey(A5),
    treasuryMsolAccount: new PublicKey(A6),
  });
}

let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_marinade_stake");
  if (!tool) throw new Error("prepare_marinade_stake not registered");
  return tool.handler(args);
}

describe("prepare_marinade_stake (SOL-W-14)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetHandleStoreForTesting();
    savedDemo = process.env.VAULTPILOT_DEMO;
    process.env.VAULTPILOT_DEMO = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReset();
    listAccountsSpy.mockReturnValue([PAIRED]);
    getAtaSpy.mockReset();
    getAtaSpy.mockResolvedValue(new PublicKey(MINT_TO));
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

  it("ATA present → handle + Fixture-I fingerprint + blind-sign NOTICE", async () => {
    const res = await callTool({ lamports: "1000000000" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.payloadFingerprint).toBe(FIXTURE_I_FP);
    expect(sc.msolMint).toBe(MSOL_MINT);
    expect(sc.msolAta).toBe(MINT_TO);
    expect(sc.createMsolAta).toBe(false);
    expect(sc.blindSign).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/LEDGER NOTICE/);
  });

  it("ATA absent → createATA NOTICE; createMsolAta true; fingerprint differs from Fixture I", async () => {
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection(false));
    const res = await callTool({ lamports: "1000000000" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.createMsolAta).toBe(true);
    expect(sc.payloadFingerprint).not.toBe(FIXTURE_I_FP);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/create your mSOL token account/);
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

  it("demo mode (VAULTPILOT_DEMO=true) → uses the active persona as feePayer; same Fixture-I fingerprint", async () => {
    process.env.VAULTPILOT_DEMO = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersona({ slug: "test-whale", solanaAddress: FROM });
    const res = await callTool({ lamports: "1000000000" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.payloadFingerprint).toBe(FIXTURE_I_FP);
    expect(sc.feePayer).toBe(FROM);
  });

  it("BROADCAST_FAILED when getLatestBlockhash throws", async () => {
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue({
      getLatestBlockhash: vi.fn(async () => { throw new Error("rpc down"); }),
      getAccountInfo: vi.fn(async () => null),
    } as unknown as Connection);
    const res = await callTool({ lamports: "1000000000" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("BROADCAST_FAILED");
  });
});
