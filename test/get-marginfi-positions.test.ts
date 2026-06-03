// MarginFi account decoder + position read (D-02) + get_marginfi_positions
// tool. Phase 13 — Plan 13-02 Tasks 2 + 3.
//
// NO-LIVE-RPC (milestone #1 hang failure mode — web3.js Connection sockets hang
// ~25min in-sandbox): every test mocks the RPC boundary. The decoder's RPC read
// routes through `_marginfiChain.getRawAccountInfo`, spied via
// `vi.spyOn(_marginfiChain, "getRawAccountInfo")` to return a canned account
// buffer (or null for the PDA-absent arm). NEVER open a live Connection.
//
// The canned MarginfiAccount buffer is built once from the SDK IDL via the
// Anchor BorshCoder account layout (snake_case fields — the Anchor-0.30 decode
// path; the SDK's own decodeAccountRaw is incompatible with the vendored IDL
// name-casing, so the decoder decodes Anchor-direct — see src/chains/solana/
// marginfi.ts header). WrappedI80F48 (16-byte LE i128 / 2^48) shares convert to
// bigint at the decoder seam (no BN/Number leak — Pitfall 6).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";
import BN from "bn.js";
import { MARGINFI_IDL } from "@mrgnlabs/marginfi-client-v2";

import {
  _marginfiChain,
  decodeMarginfiAccount,
  getMarginfiAccountInfo,
} from "../src/chains/solana/marginfi.js";
import {
  getMarginfiGroup,
  deriveMarginfiAccountPda,
} from "../src/config/contracts.js";

const AUTHORITY = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const BANK_SOL = "So11111111111111111111111111111111111111112";
const BANK_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ---------------------------------------------------------------------------
// Build a canned MarginfiAccount buffer (snake_case layout — the working Anchor
// 0.30 path). WrappedI80F48 stores value = units × 2^48 in 16-byte LE i128.
// ---------------------------------------------------------------------------
const coder = new BorshCoder(MARGINFI_IDL as never);
const typeByName: Record<string, { type: { kind: string; fields?: { name: string; type: unknown }[]; variants?: { name: string }[] } }> =
  Object.fromEntries(
    (MARGINFI_IDL as { types: { name: string; type: unknown }[] }).types.map(
      (t) => [t.name, t as never],
    ),
  );

function i80(units: number): { value: number[] } {
  let v = BigInt(units) * (1n << 48n);
  const b: number[] = [];
  for (let i = 0; i < 16; i++) {
    b.push(Number(v & 0xffn));
    v >>= 8n;
  }
  return { value: b };
}

function zero(typeRef: unknown): unknown {
  if (typeof typeRef === "string") {
    if (["u8", "u16", "u32", "i8", "i16", "i32"].includes(typeRef)) return 0;
    if (["u64", "u128", "i64", "i128"].includes(typeRef)) return new BN(0);
    if (typeRef === "bool") return false;
    if (typeRef === "pubkey") return PublicKey.default;
    return 0;
  }
  const ref = typeRef as {
    array?: [unknown, number];
    option?: unknown;
    defined?: { name?: string } | string;
  };
  if (ref.array) {
    const [el, len] = ref.array;
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) out.push(zero(el));
    return out;
  }
  if (ref.option) return null;
  if (ref.defined) {
    const nm =
      typeof ref.defined === "string" ? ref.defined : ref.defined.name ?? "";
    const t = typeByName[nm];
    if (t?.type.kind === "struct") {
      const o: Record<string, unknown> = {};
      for (const f of t.type.fields!) o[f.name] = zero(f.type);
      return o;
    }
    if (t?.type.kind === "enum") return { [t.type.variants![0]!.name]: {} };
  }
  return 0;
}

/**
 * Build a full 2312-byte MarginfiAccount buffer with the given balances.
 * `balances` is an array of `{ bank, asset, liability }` (native units).
 */
function buildAccountBuffer(
  authority: string,
  balances: Array<{ bank: string; asset: number; liability: number }>,
): Buffer {
  const def = typeByName["MarginfiAccount"]!;
  const acct: Record<string, unknown> = {};
  for (const f of def.type.fields!) acct[f.name] = zero(f.type);
  acct.group = new PublicKey(getMarginfiGroup());
  acct.authority = new PublicKey(authority);
  const la = acct.lending_account as { balances: Record<string, unknown>[] };
  balances.forEach((bal, idx) => {
    const slot = la.balances[idx]!;
    slot.active = 1;
    slot.bank_pk = new PublicKey(bal.bank);
    slot.asset_shares = i80(bal.asset);
    slot.liability_shares = i80(bal.liability);
  });
  // Internal layout access — encode with a 4096 scratch (default 1000 is too
  // small for the 2312-byte account).
  const accountsCoder = coder.accounts as unknown as {
    accountLayouts: Map<string, { encode: (o: unknown, b: Buffer) => number }>;
    accountDiscriminator: (n: string) => Buffer;
  };
  const layout = accountsCoder.accountLayouts.get("MarginfiAccount")!;
  const disc = accountsCoder.accountDiscriminator("MarginfiAccount");
  const scratch = Buffer.alloc(4096);
  const len = layout.encode(acct, scratch);
  return Buffer.concat([disc, scratch.subarray(0, len)]);
}

// ---------------------------------------------------------------------------
// Test 1 — decodeMarginfiAccount: buffer → bank-keyed bigint positions.
// ---------------------------------------------------------------------------
describe("decodeMarginfiAccount — bank-keyed bigint positions (D-02, Pitfall 6)", () => {
  it("decodes a canned buffer to bank-keyed { bank, supplied, borrowed } as bigint", () => {
    const buf = buildAccountBuffer(AUTHORITY, [
      { bank: BANK_SOL, asset: 1000, liability: 0 },
      { bank: BANK_USDC, asset: 0, liability: 400 },
    ]);
    const decoded = decodeMarginfiAccount(buf);
    expect(decoded.authority).toBe(AUTHORITY);
    expect(decoded.group).toBe(getMarginfiGroup());
    expect(decoded.balances).toHaveLength(2);

    const sol = decoded.balances.find((b) => b.bank === BANK_SOL)!;
    expect(sol.supplied).toBe(1000n);
    expect(sol.borrowed).toBe(0n);
    expect(typeof sol.supplied).toBe("bigint");

    const usdc = decoded.balances.find((b) => b.bank === BANK_USDC)!;
    expect(usdc.supplied).toBe(0n);
    expect(usdc.borrowed).toBe(400n);
    expect(typeof usdc.borrowed).toBe("bigint");
  });

  it("skips inactive balance slots (active === 0)", () => {
    // One active balance; the remaining 15 slots are inactive defaults.
    const buf = buildAccountBuffer(AUTHORITY, [
      { bank: BANK_SOL, asset: 500, liability: 0 },
    ]);
    const decoded = decodeMarginfiAccount(buf);
    expect(decoded.balances).toHaveLength(1);
    expect(decoded.balances[0]!.bank).toBe(BANK_SOL);
  });

  it("no Number/BN leak — supplied/borrowed are bigint on every balance", () => {
    const buf = buildAccountBuffer(AUTHORITY, [
      { bank: BANK_SOL, asset: 1000, liability: 200 },
    ]);
    const decoded = decodeMarginfiAccount(buf);
    for (const b of decoded.balances) {
      expect(typeof b.supplied).toBe("bigint");
      expect(typeof b.borrowed).toBe("bigint");
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2 — getMarginfiAccountInfo: PDA-presence read (consumed by 13-03 D-03).
// ---------------------------------------------------------------------------
describe("getMarginfiAccountInfo — PDA-presence read (D-04, no live RPC)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports present + decoded positions when the PDA account exists", async () => {
    const buf = buildAccountBuffer(AUTHORITY, [
      { bank: BANK_SOL, asset: 1000, liability: 400 },
    ]);
    const spy = vi
      .spyOn(_marginfiChain, "getRawAccountInfo")
      .mockResolvedValue({ data: buf });

    const info = await getMarginfiAccountInfo(AUTHORITY);
    expect(info.present).toBe(true);
    expect(info.pda).toBe(deriveMarginfiAccountPda(AUTHORITY, 0));
    expect(info.account).not.toBeNull();
    expect(info.account!.balances[0]!.bank).toBe(BANK_SOL);
    expect(info.account!.balances[0]!.supplied).toBe(1000n);
    // The read targeted the derived PDA (no live Connection).
    expect(spy).toHaveBeenCalledWith(deriveMarginfiAccountPda(AUTHORITY, 0));
  });

  it("reports absent (present:false, account:null) when getRawAccountInfo returns null (D-03 driver)", async () => {
    vi.spyOn(_marginfiChain, "getRawAccountInfo").mockResolvedValue(null);
    const info = await getMarginfiAccountInfo(AUTHORITY);
    expect(info.present).toBe(false);
    expect(info.account).toBeNull();
    expect(info.pda).toBe(deriveMarginfiAccountPda(AUTHORITY, 0));
  });
});
