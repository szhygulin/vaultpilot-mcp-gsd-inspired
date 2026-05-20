// test/get-solana-token-balance.test.ts — Phase 11 Plan 11-05 (SOL-04).
//
// Mirrors test/get-token-balance.test.ts shape. Stubs:
//   - `_solanaRegistry.getConnection` returns a Connection with our
//     `getTokenAccountsByOwner` mock + a `getParsedTokenAccountsByOwner`
//     mock that MUST stay uncalled (D-7 regression).
//   - `fetch` stubbed for DefiLlama `solana:<mint>` keying.
//
// D-7 LOAD-BEARING regression: assert the UNPARSED RPC method is the one
// called, not the parsed variant.

import {
  ACCOUNT_SIZE,
  AccountLayout,
  MintLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetPriceCacheForTesting } from "../src/pricing/defillama.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const FIXTURE_WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const UNKNOWN_MINT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"; // SAMO — not in our top-50
const DUMMY_PUBKEY = "11111111111111111111111111111111";

function encodeTokenAccountBase64(mint: string, amount: bigint): string {
  const buf = Buffer.alloc(ACCOUNT_SIZE);
  const dummy = new PublicKey(DUMMY_PUBKEY);
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

function encodeMintBuffer(decimals: number): Buffer {
  const buf = Buffer.alloc(MintLayout.span);
  const dummy = new PublicKey(DUMMY_PUBKEY);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: dummy,
      supply: 1_000_000_000_000n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: dummy,
    },
    buf,
  );
  return buf;
}

interface MockConnectionState {
  /** SPL accounts owned by the wallet. */
  splAccounts: Array<{ mint: string; amount: bigint }>;
  /** Mint → decimals lookup for on-demand `getMint`. */
  mintDecimals: Record<string, number>;
}

function makeStubConnection(state: MockConnectionState): {
  connection: Connection;
  getTokenAccountsByOwner: ReturnType<typeof vi.fn>;
  getParsedTokenAccountsByOwner: ReturnType<typeof vi.fn>;
} {
  const getTokenAccountsByOwner = vi.fn(async () => ({
    context: { slot: 1 },
    value: state.splAccounts.map((a) => ({
      pubkey: new PublicKey(DUMMY_PUBKEY),
      account: {
        data: [encodeTokenAccountBase64(a.mint, a.amount), "base64"] as [string, "base64"],
        executable: false,
        lamports: 2039280,
        owner: TOKEN_PROGRAM_ID,
        rentEpoch: 0,
      },
    })),
  }));
  const getParsedTokenAccountsByOwner = vi.fn();
  // getMint internally calls getAccountInfo on the mint pubkey.
  const getAccountInfo = vi.fn(async (mintPk: PublicKey) => {
    const mintStr = mintPk.toBase58();
    const decimals = state.mintDecimals[mintStr];
    if (decimals === undefined) {
      // getMint surfaces null → TokenAccountNotFoundError; pass null so a
      // missing entry triggers a structured error.
      return null;
    }
    return {
      data: encodeMintBuffer(decimals),
      executable: false,
      lamports: 1461600,
      owner: TOKEN_PROGRAM_ID,
      rentEpoch: 0,
    };
  });
  const connection = {
    getTokenAccountsByOwner,
    getParsedTokenAccountsByOwner,
    getAccountInfo,
  } as unknown as Connection;
  return { connection, getTokenAccountsByOwner, getParsedTokenAccountsByOwner };
}

function makeSolanaFetch(prices: Record<string, number>): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      coins: Object.fromEntries(
        Object.entries(prices).map(([mint, price]) => [`solana:${mint}`, { price }]),
      ),
    }),
  }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  _resetPriceCacheForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_solana_token_balance");
  if (!tool) throw new Error("get_solana_token_balance not registered");
  return tool.handler(args);
}

describe("get_solana_token_balance tool (Phase 11 Plan 11-05 SOL-04)", () => {
  it("happy path (USDC mint in registry, priced via DefiLlama): balance='1.5', decimals=6, symbol='USDC', balanceUsd='1.50'", async () => {
    const stub = makeStubConnection({
      splAccounts: [{ mint: USDC_MINT, amount: 1_500_000n }],
      mintDecimals: {},
    });
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stub.connection);
    vi.stubGlobal("fetch", makeSolanaFetch({ [USDC_MINT]: 1.0 }));

    const result = await callTool({ wallet: FIXTURE_WALLET, mint: USDC_MINT });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      wallet: FIXTURE_WALLET,
      mint: USDC_MINT,
      balance: "1.5",
      decimals: 6,
      symbol: "USDC",
      balanceUsd: "1.50",
    });
  });

  it("D-7 LOAD-BEARING regression: UNPARSED `getTokenAccountsByOwner` is called; parsed variant NEVER called", async () => {
    const stub = makeStubConnection({
      splAccounts: [{ mint: USDC_MINT, amount: 1_000_000n }],
      mintDecimals: {},
    });
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stub.connection);
    vi.stubGlobal("fetch", makeSolanaFetch({ [USDC_MINT]: 1.0 }));

    await callTool({ wallet: FIXTURE_WALLET, mint: USDC_MINT });
    expect(stub.getTokenAccountsByOwner).toHaveBeenCalledTimes(1);
    expect(stub.getParsedTokenAccountsByOwner).not.toHaveBeenCalled();
  });

  it("unknown mint (off-registry) → symbolUnknown=true + on-demand decimals via getMint", async () => {
    const stub = makeStubConnection({
      splAccounts: [{ mint: UNKNOWN_MINT, amount: 12_345_678n }],
      mintDecimals: { [UNKNOWN_MINT]: 8 },
    });
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stub.connection);
    vi.stubGlobal("fetch", makeSolanaFetch({})); // no price

    const result = await callTool({ wallet: FIXTURE_WALLET, mint: UNKNOWN_MINT });
    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      symbolUnknown?: true;
      decimals: number;
      symbol: string;
      priceUnknown?: true;
    };
    expect(out.symbolUnknown).toBe(true);
    expect(out.decimals).toBe(8);
    expect(out.symbol).toMatch(/^.{4}\.{3}.{4}$/); // "9xQe...VFin"
    expect(out.priceUnknown).toBe(true);
  });

  it("wallet has no token account for the requested mint → balance='0', decimals from registry, no error", async () => {
    const stub = makeStubConnection({
      splAccounts: [], // no SPL accounts
      mintDecimals: {},
    });
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stub.connection);
    vi.stubGlobal("fetch", makeSolanaFetch({ [USDC_MINT]: 1.0 }));

    const result = await callTool({ wallet: FIXTURE_WALLET, mint: USDC_MINT });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      balance: "0",
      decimals: 6,
      symbol: "USDC",
    });
  });

  it("DefiLlama price miss → priceUnknown=true; no balanceUsd field", async () => {
    const stub = makeStubConnection({
      splAccounts: [{ mint: USDC_MINT, amount: 1_000_000n }],
      mintDecimals: {},
    });
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stub.connection);
    vi.stubGlobal("fetch", makeSolanaFetch({})); // empty price set

    const result = await callTool({ wallet: FIXTURE_WALLET, mint: USDC_MINT });
    const out = result.structuredContent as { priceUnknown?: true; balanceUsd?: string };
    expect(out.priceUnknown).toBe(true);
    expect(out.balanceUsd).toBeUndefined();
  });

  it("RPC error on SPL discovery → SOLANA_RPC_FAILED envelope", async () => {
    const getTokenAccountsByOwner = vi.fn().mockRejectedValue(new Error("rpc down"));
    const connection = {
      getTokenAccountsByOwner,
      getParsedTokenAccountsByOwner: vi.fn(),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(connection);

    const result = await callTool({ wallet: FIXTURE_WALLET, mint: USDC_MINT });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ errorCode: "SOLANA_RPC_FAILED" });
  });

  it("invalid mint (empty string) → INVALID_INPUT envelope", async () => {
    const result = await callTool({ wallet: FIXTURE_WALLET, mint: "" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ errorCode: "INVALID_INPUT" });
  });

  it("DefiLlama price keyed by `solana:<mint>` (NOT `solana:<mint-lower>`)", async () => {
    const stub = makeStubConnection({
      splAccounts: [{ mint: USDC_MINT, amount: 1_000_000n }],
      mintDecimals: {},
    });
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stub.connection);
    const fetchStub = makeSolanaFetch({ [USDC_MINT]: 1.0 });
    vi.stubGlobal("fetch", fetchStub);

    await callTool({ wallet: FIXTURE_WALLET, mint: USDC_MINT });
    // Solana base58 is case-sensitive — wire URL must preserve case.
    const callUrl = fetchStub.mock.calls[0]?.[0] as string | undefined;
    expect(callUrl).toMatch(new RegExp(`solana:${USDC_MINT}`));
  });
});
