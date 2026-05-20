// test/get-portfolio-summary.solana.test.ts — Phase 11 Plan 11-05 (SOL-05).
//
// Mirror of test/get-portfolio-summary.cross-chain.test.ts but for the
// Solana leg in the multi-chain fan-out. Coverage:
//   1. Real-mode resolution — paired record present → Solana leg fans out.
//   2. Demo-mode fallback — no paired record + isDemoMode + active Solana
//      persona → Solana leg uses persona address (FLAG-3 regression).
//   3. Real-mode preference over demo persona — paired wins when both.
//   4. Silent skip when neither source applies (no chainErrors entry).
//   5. includeSolana=false suppresses leg even when address resolvable.
//   6. Per-row chain="solana" discriminator on fungibleBalances + native.
//   7. UNPARSED PATH regression — getTokenAccountsByOwner is the one called.
//   8. NATIVE_PRICING_PROXY.solana = wSOL mint; DefiLlama keyed as
//      `solana:So111...1112` for native SOL pricing.
//   9. Back-compat regression — 5 EVM rows emit BOTH erc20Balances AND
//      fungibleBalances; content byte-identical.
//  10. Discriminated-union widening — Solana fungibleBalances rows carry
//      base58 (not 0x) tokenAddress + chain="solana".

import {
  ACCOUNT_SIZE,
  AccountLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURE_PAIRED_SOL_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const FIXTURE_PERSONA_SOL_ADDR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const DUMMY_PUBKEY = "11111111111111111111111111111111";

// ---- Mock the EVM registry: make every EVM leg return 0 balance + no
// erc20 rows so the test focuses on Solana behaviour.
type ChainId = 1 | 42161 | 137 | 8453 | 10;
const evmState: Record<ChainId, { nativeBalance: bigint; erc20: never[] }> = {
  1: { nativeBalance: 0n, erc20: [] },
  42161: { nativeBalance: 0n, erc20: [] },
  137: { nativeBalance: 0n, erc20: [] },
  8453: { nativeBalance: 0n, erc20: [] },
  10: { nativeBalance: 0n, erc20: [] },
};

vi.mock("../src/chains/registry.js", () => ({
  getChainClient: (chainId: ChainId) => ({
    getBalance: vi.fn(async () => evmState[chainId].nativeBalance),
  }),
  isPublicNodeFallback: () => false,
  _resetChainRegistryForTesting: () => {},
  PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
}));

vi.mock("../src/chains/erc20-scanner.js", async () => {
  const real = await vi.importActual<typeof import("../src/chains/erc20-scanner.js")>(
    "../src/chains/erc20-scanner.js",
  );
  return {
    ...real,
    scanErc20Balances: vi.fn(async () => []),
  };
});

// Mock the non-evm-account-store to control the paired-record source.
const accountStoreState: { paired: Array<{ chain: string; address: string }> } = { paired: [] };
vi.mock("../src/wallet/non-evm-account-store.js", () => ({
  listAccounts: vi.fn((filter?: { chainFilter?: string }) => {
    if (filter?.chainFilter) {
      return accountStoreState.paired.filter((a) => a.chain === filter.chainFilter);
    }
    return accountStoreState.paired;
  }),
}));

// Mock demo state — control isDemoMode + getActiveSolanaPersona.
const demoState: {
  isDemo: boolean;
  solanaPersona: { solanaAddress: string; slug: string } | null;
} = { isDemo: false, solanaPersona: null };
vi.mock("../src/config/env.js", async () => {
  const real = await vi.importActual<typeof import("../src/config/env.js")>("../src/config/env.js");
  return {
    ...real,
    isDemoMode: () => demoState.isDemo,
  };
});
vi.mock("../src/demo/state.js", async () => {
  const real = await vi.importActual<typeof import("../src/demo/state.js")>("../src/demo/state.js");
  return {
    ...real,
    getActiveSolanaPersona: () => demoState.solanaPersona,
  };
});

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetPriceCacheForTesting } from "../src/pricing/defillama.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const EVM_WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

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

/**
 * Build a Solana stub Connection. Returns a `getBalance` and
 * `getTokenAccountsByOwner` mock; the test asserts these are the methods
 * called (D-7 — `getParsedTokenAccountsByOwner` MUST stay uncalled).
 */
function makeSolanaConnection(
  lamports: number,
  splAccounts: Array<{ mint: string; amount: bigint }>,
): {
  connection: Connection;
  getBalance: ReturnType<typeof vi.fn>;
  getTokenAccountsByOwner: ReturnType<typeof vi.fn>;
  getParsedTokenAccountsByOwner: ReturnType<typeof vi.fn>;
} {
  const getBalance = vi.fn(async () => lamports);
  const getTokenAccountsByOwner = vi.fn(async () => ({
    context: { slot: 1 },
    value: splAccounts.map((a) => ({
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
  const connection = {
    getBalance,
    getTokenAccountsByOwner,
    getParsedTokenAccountsByOwner,
  } as unknown as Connection;
  return { connection, getBalance, getTokenAccountsByOwner, getParsedTokenAccountsByOwner };
}

/** Build a fetch mock that handles BOTH EVM and Solana DefiLlama keys. */
function makeMixedFetch(
  evmPrices: Record<string, number>,
  solanaPrices: Record<string, number>,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const coins: Record<string, { price: number }> = {};
    // EVM keys: lowercase the address part.
    for (const [key, price] of Object.entries(evmPrices)) {
      const [chain, addr] = key.split(":");
      coins[`${chain}:${addr!.toLowerCase()}`] = { price };
    }
    // Solana keys: case-preserved.
    for (const [mint, price] of Object.entries(solanaPrices)) {
      coins[`solana:${mint}`] = { price };
    }
    // Filter to keys present in the requested URL.
    const matched: Record<string, { price: number }> = {};
    for (const [k, v] of Object.entries(coins)) {
      if (url.includes(k)) matched[k] = v;
    }
    return { ok: true, json: async () => ({ coins: matched }) };
  });
}

beforeEach(() => {
  accountStoreState.paired = [];
  demoState.isDemo = false;
  demoState.solanaPersona = null;
  for (const id of [1, 42161, 137, 8453, 10] as ChainId[]) {
    evmState[id] = { nativeBalance: 0n, erc20: [] };
  }
  _resetPriceCacheForTesting();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_portfolio_summary");
  if (!tool) throw new Error("get_portfolio_summary not registered");
  return tool.handler(args);
}

describe("get_portfolio_summary Solana leg (Phase 11 Plan 11-05 SOL-05)", () => {
  it("Test 1: real-mode address resolution — paired Solana record routes fan-out to that address", async () => {
    accountStoreState.paired = [{ chain: "solana", address: FIXTURE_PAIRED_SOL_ADDR }];
    const sol = makeSolanaConnection(1_500_000_000, [{ mint: USDC_MINT, amount: 2_000_000n }]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(sol.connection);
    vi.stubGlobal(
      "fetch",
      makeMixedFetch({}, { [WSOL_MINT]: 100, [USDC_MINT]: 1.0 }),
    );

    const result = await callTool({ wallet: EVM_WALLET });
    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      perChain: Record<string, { chain: string; totalUsd: string; fungibleBalances: unknown[] }>;
      chainErrors: Array<{ chain: string; reason: string }>;
    };
    // Solana leg present.
    expect(out.perChain.solana).toBeDefined();
    expect(out.perChain.solana?.chain).toBe("solana");
    // getBalance called against the PAIRED address (not persona, not EVM wallet).
    const balanceCallArg = sol.getBalance.mock.calls[0]?.[0] as PublicKey | undefined;
    expect(balanceCallArg?.toBase58()).toBe(FIXTURE_PAIRED_SOL_ADDR);
  });

  it("Test 2: demo-mode FALLBACK (FLAG-3 regression) — no paired record + isDemoMode=true + active persona → Solana leg uses persona address", async () => {
    accountStoreState.paired = []; // no paired record
    demoState.isDemo = true;
    demoState.solanaPersona = {
      slug: "sol-whale",
      solanaAddress: FIXTURE_PERSONA_SOL_ADDR,
    };
    const sol = makeSolanaConnection(2_000_000_000, []);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(sol.connection);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WSOL_MINT]: 100 }));

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: Record<string, { chain: string } | undefined>;
    };
    expect(out.perChain.solana).toBeDefined();
    expect(out.perChain.solana?.chain).toBe("solana");
    // getBalance called against the PERSONA address.
    const balanceCallArg = sol.getBalance.mock.calls[0]?.[0] as PublicKey | undefined;
    expect(balanceCallArg?.toBase58()).toBe(FIXTURE_PERSONA_SOL_ADDR);
  });

  it("Test 3: silent skip — no paired record AND not in demo mode → no Solana leg, no chainErrors entry", async () => {
    accountStoreState.paired = [];
    demoState.isDemo = false;
    vi.stubGlobal("fetch", makeMixedFetch({}, {}));

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: Record<string, unknown>;
      chainErrors: Array<{ chain: string; reason: string }>;
    };
    expect(out.perChain.solana).toBeUndefined();
    // No solana entry in chainErrors (silent skip, not failure).
    expect(out.chainErrors.find((e) => e.chain === "solana")).toBeUndefined();
  });

  it("Test 4: real-mode preference — paired record AND demo persona BOTH present → paired wins", async () => {
    accountStoreState.paired = [{ chain: "solana", address: FIXTURE_PAIRED_SOL_ADDR }];
    demoState.isDemo = true;
    demoState.solanaPersona = {
      slug: "sol-whale",
      solanaAddress: FIXTURE_PERSONA_SOL_ADDR,
    };
    const sol = makeSolanaConnection(1_000_000_000, []);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(sol.connection);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WSOL_MINT]: 100 }));

    await callTool({ wallet: EVM_WALLET });
    const balanceCallArg = sol.getBalance.mock.calls[0]?.[0] as PublicKey | undefined;
    // Paired address used, NOT persona.
    expect(balanceCallArg?.toBase58()).toBe(FIXTURE_PAIRED_SOL_ADDR);
    expect(balanceCallArg?.toBase58()).not.toBe(FIXTURE_PERSONA_SOL_ADDR);
  });

  it("Test 5: includeSolana=false suppresses Solana leg even with paired record present", async () => {
    accountStoreState.paired = [{ chain: "solana", address: FIXTURE_PAIRED_SOL_ADDR }];
    const sol = makeSolanaConnection(1_000_000_000, []);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(sol.connection);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WSOL_MINT]: 100 }));

    const result = await callTool({ wallet: EVM_WALLET, includeSolana: false });
    const out = result.structuredContent as {
      perChain: Record<string, unknown>;
    };
    expect(out.perChain.solana).toBeUndefined();
    // Solana RPC was never touched.
    expect(sol.getBalance).not.toHaveBeenCalled();
  });

  it("Test 6: per-row chain='solana' discriminator on nativeBalance + each fungibleBalances row", async () => {
    accountStoreState.paired = [{ chain: "solana", address: FIXTURE_PAIRED_SOL_ADDR }];
    const sol = makeSolanaConnection(
      1_000_000_000,
      [{ mint: USDC_MINT, amount: 5_000_000n }],
    );
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(sol.connection);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WSOL_MINT]: 100, [USDC_MINT]: 1.0 }));

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: Record<
        string,
        {
          chain: string;
          nativeBalance: { chain: string };
          fungibleBalances: Array<{ chain: string; tokenAddress: string }>;
        }
      >;
    };
    const solPortfolio = out.perChain.solana!;
    expect(solPortfolio.chain).toBe("solana");
    expect(solPortfolio.nativeBalance.chain).toBe("solana");
    for (const row of solPortfolio.fungibleBalances) {
      expect(row.chain).toBe("solana");
    }
  });

  it("Test 7: UNPARSED PATH regression — getTokenAccountsByOwner called; parsed variant NEVER called", async () => {
    accountStoreState.paired = [{ chain: "solana", address: FIXTURE_PAIRED_SOL_ADDR }];
    const sol = makeSolanaConnection(0, [{ mint: USDC_MINT, amount: 1_000_000n }]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(sol.connection);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WSOL_MINT]: 100, [USDC_MINT]: 1.0 }));

    await callTool({ wallet: EVM_WALLET });
    expect(sol.getTokenAccountsByOwner).toHaveBeenCalledTimes(1);
    expect(sol.getParsedTokenAccountsByOwner).not.toHaveBeenCalled();
  });

  it("Test 8: NATIVE_PRICING_PROXY.solana = wSOL — DefiLlama keyed as `solana:So111...1112` for native SOL", async () => {
    accountStoreState.paired = [{ chain: "solana", address: FIXTURE_PAIRED_SOL_ADDR }];
    const sol = makeSolanaConnection(1_000_000_000, []);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(sol.connection);
    const fetchStub = makeMixedFetch({}, { [WSOL_MINT]: 100 });
    vi.stubGlobal("fetch", fetchStub);

    await callTool({ wallet: EVM_WALLET });
    // Find the Solana-keyed DefiLlama URL.
    const solanaCallUrl = fetchStub.mock.calls
      .map((c) => c[0] as string)
      .find((u) => u.includes("solana:"));
    expect(solanaCallUrl).toBeDefined();
    expect(solanaCallUrl).toMatch(new RegExp(`solana:${WSOL_MINT}`));
  });

  it("Test 9: back-compat — EVM rows continue emitting BOTH erc20Balances AND fungibleBalances with byte-identical content", async () => {
    // Give Ethereum a non-zero native + a USDC row.
    evmState[1].nativeBalance = 1_000_000_000_000_000_000n; // 1 ETH
    accountStoreState.paired = []; // no Solana → focus on EVM back-compat
    const erc20Scanner = await import("../src/chains/erc20-scanner.js");
    (erc20Scanner.scanErc20Balances as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_w: Address, _t: unknown, chainId?: ChainId) => {
        if (chainId === 1) {
          return [
            {
              token: {
                address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
                symbol: "USDC",
                decimals: 6,
                name: "USD Coin",
              },
              balance: 100_000_000n,
            },
          ];
        }
        return [];
      },
    );
    vi.stubGlobal(
      "fetch",
      makeMixedFetch(
        {
          "ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": 3000,
          "ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 1.0,
        },
        {},
      ),
    );

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: {
        ethereum?: {
          erc20Balances: Array<Record<string, unknown>>;
          fungibleBalances: Array<Record<string, unknown>>;
        };
      };
    };
    const eth = out.perChain.ethereum!;
    expect(eth.erc20Balances).toBeDefined();
    expect(eth.fungibleBalances).toBeDefined();
    expect(eth.erc20Balances.length).toBe(eth.fungibleBalances.length);
    expect(eth.erc20Balances.length).toBeGreaterThan(0);
    // Byte-identical content: same tokenAddress, symbol, decimals, balance.
    for (let i = 0; i < eth.erc20Balances.length; i++) {
      const a = eth.erc20Balances[i]!;
      const b = eth.fungibleBalances[i]!;
      expect(b.tokenAddress).toBe(a.tokenAddress);
      expect(b.symbol).toBe(a.symbol);
      expect(b.decimals).toBe(a.decimals);
      expect(b.balance).toBe(a.balance);
    }
  });

  it("Test 10: discriminated-union widening — Solana fungibleBalances rows carry base58 tokenAddress (NOT 0x-hex)", async () => {
    accountStoreState.paired = [{ chain: "solana", address: FIXTURE_PAIRED_SOL_ADDR }];
    const sol = makeSolanaConnection(0, [{ mint: USDC_MINT, amount: 1_000_000n }]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(sol.connection);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WSOL_MINT]: 100, [USDC_MINT]: 1.0 }));

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: {
        solana?: { fungibleBalances: Array<{ chain: string; tokenAddress: string }> };
      };
    };
    const row = out.perChain.solana!.fungibleBalances[0]!;
    expect(row.chain).toBe("solana");
    expect(row.tokenAddress).toBe(USDC_MINT);
    // NOT 0x-hex-prefixed.
    expect(row.tokenAddress.startsWith("0x")).toBe(false);
  });
});
