// src/chains/solana/sol-rpc-client.ts — thin RPC wrapper around
// `Connection.getBalance` + UNPARSED `getTokenAccountsByOwner` +
// `getMint` (Phase 11 Plan 11-02).
//
// Coverage:
//   1. getNativeBalance: stub Connection.getBalance returning 2_500_000_000
//      lamports → `{ lamports: 2500000000n, sol: "2.5" }`.
//   2. getNativeBalance lamports MUST be `bigint` (decimal-string-at-the-
//      boundary regression — `number` types must not leak).
//   2b. formatLamportsToSol behavior across boundary cases.
//   3. getSplTokenAccounts UNPARSED PATH (D-7 LOAD-BEARING): stub returns
//      one base64-encoded `AccountLayout`-shaped row; assert mint + amount
//      decode correctly. Asserts the stub was called as
//      `getTokenAccountsByOwner` (NOT `getParsedTokenAccountsByOwner`).
//   4. account.data shape robustness: feed both the `[base64, "base64"]`
//      tuple shape (live RPC response, research § Topic 6) AND the raw
//      Buffer shape; both decode cleanly.
//   5. getMintDecimals: stub Connection.getAccountInfo (the path `getMint`
//      uses internally) returning a 82-byte Mint-shaped buffer with
//      decimals=6; assert return value is 6.
//   6. Error envelope: stub getBalance to throw `Error("network error")`;
//      assert getNativeBalance rethrows as `SolanaRpcError` with
//      errorCode `SOLANA_RPC_FAILED`.
//   7. PublicKey validation: invalid base58 → SolanaRpcError (the
//      PublicKey constructor throws on malformed input; our wrapper
//      catches it).

import {
  ACCOUNT_SIZE,
  AccountLayout,
  MintLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import {
  SolanaRpcError,
  _solRpcInternals,
  getMintDecimals,
  getNativeBalance,
  getSplTokenAccounts,
} from "../src/chains/solana/sol-rpc-client.js";

// Known-valid base58 fixtures used across tests.
const FIXTURE_WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const FIXTURE_MINT_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FIXTURE_DUMMY_PUBKEY = "11111111111111111111111111111111";

/**
 * Build a base64-encoded SPL Token Account buffer (165 bytes) decoded
 * cleanly by `AccountLayout.decode`. Mirrors the real RPC's `account.data`
 * row content.
 */
function encodeTokenAccountBase64(mint: string, amount: bigint): string {
  const buf = Buffer.alloc(ACCOUNT_SIZE);
  const dummy = new PublicKey(FIXTURE_DUMMY_PUBKEY);
  AccountLayout.encode(
    {
      mint: new PublicKey(mint),
      owner: dummy,
      amount,
      delegateOption: 0,
      delegate: dummy,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: dummy,
    },
    buf,
  );
  return buf.toString("base64");
}

/** Build a Mint-shaped 82-byte buffer (RawMint layout) for `getMint`. */
function encodeMintBuffer(decimals: number): Buffer {
  const buf = Buffer.alloc(MintLayout.span);
  const dummy = new PublicKey(FIXTURE_DUMMY_PUBKEY);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: dummy,
      supply: 1_000_000_000n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: dummy,
    },
    buf,
  );
  return buf;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("src/chains/solana/sol-rpc-client.ts — getNativeBalance", () => {
  it("Test 1 — stub Connection.getBalance returning 2_500_000_000 lamports → `{ lamports: 2500000000n, sol: '2.5' }`", async () => {
    const stubConnection = {
      getBalance: vi.fn().mockResolvedValue(2_500_000_000),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const result = await getNativeBalance(FIXTURE_WALLET);
    expect(result).toEqual({ lamports: 2_500_000_000n, sol: "2.5" });
    expect(stubConnection.getBalance).toHaveBeenCalledTimes(1);
  });

  it("Test 2 — lamports return type is bigint (decimal-string-at-the-boundary regression — `number` must NOT leak)", async () => {
    const stubConnection = {
      getBalance: vi.fn().mockResolvedValue(1_000_000_000),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const result = await getNativeBalance(FIXTURE_WALLET);
    expect(typeof result.lamports).toBe("bigint");
    expect(result.lamports).toBe(1_000_000_000n);
    expect(typeof result.sol).toBe("string");
  });

  it("Test 2b — formatLamportsToSol boundary cases (0, exact, sub-SOL, large)", () => {
    const { formatLamportsToSol, LAMPORTS_PER_SOL } = _solRpcInternals;
    expect(LAMPORTS_PER_SOL).toBe(1_000_000_000n);
    expect(formatLamportsToSol(0n)).toBe("0");
    expect(formatLamportsToSol(1_000_000_000n)).toBe("1");
    expect(formatLamportsToSol(2_500_000_000n)).toBe("2.5");
    expect(formatLamportsToSol(1n)).toBe("0.000000001");
    expect(formatLamportsToSol(123_456_789n)).toBe("0.123456789");
    expect(formatLamportsToSol(1_000_000_001n)).toBe("1.000000001");
    expect(formatLamportsToSol(100_000_000_000n)).toBe("100");
  });
});

describe("src/chains/solana/sol-rpc-client.ts — getSplTokenAccounts (UNPARSED — D-7 LOAD-BEARING)", () => {
  it("Test 3 — UNPARSED PATH: stub returns one base64 AccountLayout row; result has `mint: <fixture>` + `amount: 1_000_000n`; called via `getTokenAccountsByOwner` (NOT parsed)", async () => {
    const dataBase64 = encodeTokenAccountBase64(FIXTURE_MINT_USDC, 1_000_000n);
    const stubResp = {
      context: { slot: 420935432 },
      value: [
        {
          pubkey: new PublicKey(FIXTURE_DUMMY_PUBKEY),
          account: {
            data: [dataBase64, "base64"] as [string, "base64"],
            executable: false,
            lamports: 2039280,
            owner: TOKEN_PROGRAM_ID,
            rentEpoch: 0,
          },
        },
      ],
    };
    const getTokenAccountsByOwnerStub = vi.fn().mockResolvedValue(stubResp);
    const getParsedTokenAccountsByOwnerStub = vi.fn();
    const stubConnection = {
      getTokenAccountsByOwner: getTokenAccountsByOwnerStub,
      // Track that the parsed variant is NEVER called — D-7 lock.
      getParsedTokenAccountsByOwner: getParsedTokenAccountsByOwnerStub,
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const rows = await getSplTokenAccounts(FIXTURE_WALLET);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.mint).toBe(FIXTURE_MINT_USDC);
    expect(rows[0]?.amount).toBe(1_000_000n);
    expect(typeof rows[0]?.amount).toBe("bigint");
    expect(Buffer.isBuffer(rows[0]?.rawAccount)).toBe(true);

    // D-7 regression: the UNPARSED path was used; the parsed path NEVER
    // called. If a future maintainer "fixes" this back to the parsed
    // method, this assertion fires.
    expect(getTokenAccountsByOwnerStub).toHaveBeenCalledTimes(1);
    expect(getParsedTokenAccountsByOwnerStub).not.toHaveBeenCalled();

    // The owner-arg shape: `{ programId: TOKEN_PROGRAM_ID }`.
    const filterArg = getTokenAccountsByOwnerStub.mock.calls[0]?.[1] as {
      programId: PublicKey;
    };
    expect(filterArg.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("Test 4 — decode robustness: feed account.data as a raw Buffer (alt SDK shape) — decoder handles both Buffer and [base64, 'base64'] tuple", async () => {
    const dataBase64 = encodeTokenAccountBase64(FIXTURE_MINT_USDC, 42n);
    const dataBuffer = Buffer.from(dataBase64, "base64");
    const stubResp = {
      context: { slot: 420935432 },
      value: [
        {
          pubkey: new PublicKey(FIXTURE_DUMMY_PUBKEY),
          account: {
            data: dataBuffer, // Buffer shape (alt SDK path).
            executable: false,
            lamports: 2039280,
            owner: TOKEN_PROGRAM_ID,
            rentEpoch: 0,
          },
        },
      ],
    };
    const stubConnection = {
      getTokenAccountsByOwner: vi.fn().mockResolvedValue(stubResp),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const rows = await getSplTokenAccounts(FIXTURE_WALLET);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mint).toBe(FIXTURE_MINT_USDC);
    expect(rows[0]?.amount).toBe(42n);
  });

  it("Test 4b — multiple accounts decode in order", async () => {
    const stubResp = {
      context: { slot: 420935432 },
      value: [
        {
          pubkey: new PublicKey(FIXTURE_DUMMY_PUBKEY),
          account: {
            data: [encodeTokenAccountBase64(FIXTURE_MINT_USDC, 1n), "base64"] as [string, "base64"],
            executable: false,
            lamports: 2039280,
            owner: TOKEN_PROGRAM_ID,
            rentEpoch: 0,
          },
        },
        {
          pubkey: new PublicKey(FIXTURE_DUMMY_PUBKEY),
          account: {
            data: [
              encodeTokenAccountBase64(
                "So11111111111111111111111111111111111111112",
                2n,
              ),
              "base64",
            ] as [string, "base64"],
            executable: false,
            lamports: 2039280,
            owner: TOKEN_PROGRAM_ID,
            rentEpoch: 0,
          },
        },
      ],
    };
    const stubConnection = {
      getTokenAccountsByOwner: vi.fn().mockResolvedValue(stubResp),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const rows = await getSplTokenAccounts(FIXTURE_WALLET);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.mint).toBe(FIXTURE_MINT_USDC);
    expect(rows[0]?.amount).toBe(1n);
    expect(rows[1]?.mint).toBe("So11111111111111111111111111111111111111112");
    expect(rows[1]?.amount).toBe(2n);
  });
});

describe("src/chains/solana/sol-rpc-client.ts — getMintDecimals", () => {
  it("Test 5 — stub getAccountInfo returning a Mint-shaped buffer with decimals=6; getMintDecimals returns 6", async () => {
    // `getMint` from @solana/spl-token calls `connection.getAccountInfo`
    // under the hood and decodes the data via MintLayout. Stub the
    // underlying call.
    const mintBuf = encodeMintBuffer(6);
    const stubConnection = {
      getAccountInfo: vi.fn().mockResolvedValue({
        data: mintBuf,
        executable: false,
        lamports: 1461600,
        owner: TOKEN_PROGRAM_ID,
        rentEpoch: 0,
      }),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const decimals = await getMintDecimals(FIXTURE_MINT_USDC);
    expect(decimals).toBe(6);
  });

  it("Test 5b — variable decimals values flow through (0, 9 boundary)", async () => {
    for (const dec of [0, 9, 18]) {
      vi.restoreAllMocks();
      const mintBuf = encodeMintBuffer(dec);
      const stubConnection = {
        getAccountInfo: vi.fn().mockResolvedValue({
          data: mintBuf,
          executable: false,
          lamports: 1461600,
          owner: TOKEN_PROGRAM_ID,
          rentEpoch: 0,
        }),
      } as unknown as Connection;
      vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

      const decimals = await getMintDecimals(FIXTURE_MINT_USDC);
      expect(decimals).toBe(dec);
    }
  });
});

describe("src/chains/solana/sol-rpc-client.ts — error envelope", () => {
  it("Test 6 — stub getBalance throws Error('network error') → getNativeBalance rethrows as SolanaRpcError with errorCode SOLANA_RPC_FAILED", async () => {
    const stubConnection = {
      getBalance: vi.fn().mockRejectedValue(new Error("network error")),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    await expect(getNativeBalance(FIXTURE_WALLET)).rejects.toBeInstanceOf(
      SolanaRpcError,
    );
    try {
      await getNativeBalance(FIXTURE_WALLET);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SolanaRpcError);
      expect((e as SolanaRpcError).errorCode).toBe("SOLANA_RPC_FAILED");
      expect((e as SolanaRpcError).message).toMatch(/network error/);
    }
  });

  it("Test 6b — getSplTokenAccounts RPC failure rethrows as SolanaRpcError", async () => {
    const stubConnection = {
      getTokenAccountsByOwner: vi
        .fn()
        .mockRejectedValue(new Error("getTokenAccountsByOwner RPC fail")),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    await expect(getSplTokenAccounts(FIXTURE_WALLET)).rejects.toBeInstanceOf(
      SolanaRpcError,
    );
  });

  it("Test 6c — getMintDecimals RPC failure rethrows as SolanaRpcError", async () => {
    const stubConnection = {
      getAccountInfo: vi.fn().mockRejectedValue(new Error("getMint fail")),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    await expect(getMintDecimals(FIXTURE_MINT_USDC)).rejects.toBeInstanceOf(
      SolanaRpcError,
    );
  });

  it("Test 7 — invalid base58 wallet string → SolanaRpcError (PublicKey constructor throws on malformed input; wrapper catches)", async () => {
    // `_solanaRegistry.getConnection` is NOT stubbed — the PublicKey
    // constructor throws synchronously before any RPC call, so the live
    // resolver returning a public-fallback Connection is fine. The wrapper
    // catches the synchronous throw and rethrows as SolanaRpcError.
    const stubConnection = {
      getBalance: vi.fn(),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    await expect(getNativeBalance("not-valid-base58-!!!")).rejects.toBeInstanceOf(
      SolanaRpcError,
    );
    // The RPC was never called — the throw came from PublicKey construction.
    expect(stubConnection.getBalance).not.toHaveBeenCalled();
  });
});
