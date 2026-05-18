import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Holder for the current mock client. Each test installs its own; the
// vi.mock factory below reads from this binding when the scanner asks for
// a client. Wired this way because ESM exports are immutable — we cannot
// vi.spyOn the named getEthereumClient export directly.
let currentMockClient: PublicClient | undefined;

// Phase 8 — Plan 08-02: src/chains/erc20-scanner.ts migrated from the
// `getEthereumClient()` singleton to `getChainClient(chainId)`. Mock the
// registry — the scanner accepts an optional `chainId` arg (defaults to 1
// for back-compat with the existing Phase 2 caller `get_portfolio_summary`).
vi.mock("../src/chains/registry.js", () => ({
  getChainClient: () => {
    if (!currentMockClient) {
      throw new Error("test bug: no mock client installed for scanErc20Balances");
    }
    return currentMockClient;
  },
  isPublicNodeFallback: () => false,
  _resetChainRegistryForTesting: () => {
    currentMockClient = undefined;
  },
  PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
}));

import {
  filterDust,
  formatTokenBalance,
  scanErc20Balances,
  type TokenBalance,
} from "../src/chains/erc20-scanner.js";
import { _resetRegistryCacheForTesting, type Token } from "../src/tokens/registry.js";

// Canonical multicall3 deployment used by viem's `multicall` action.
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const WALLET: Address = "0x0000000000000000000000000000000000000B0b";

const USDC: Token = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  decimals: 6,
  name: "USD Coin",
};

const DAI: Token = {
  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  symbol: "DAI",
  decimals: 18,
  name: "Dai Stablecoin",
};

const MULTICALL3_AGGREGATE_ABI = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);

const BALANCE_OF_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

interface CapturedRequest {
  readonly method: string;
  readonly params: readonly unknown[];
}

interface MockClientCtx {
  readonly client: PublicClient;
  readonly requests: CapturedRequest[];
}

/**
 * Builds a viem PublicClient backed by a mock EIP-1193 transport.
 *
 * `respond` is invoked for `eth_call` and returns the hex string the
 * "contract" should return. `eth_chainId` is stubbed automatically; any
 * other RPC method throws so the test surfaces the unexpected call.
 */
function buildMockClient(
  respond: (callData: `0x${string}`) => `0x${string}`,
): MockClientCtx {
  const requests: CapturedRequest[] = [];
  const transport = custom({
    request: async ({
      method,
      params,
    }: {
      method: string;
      params?: readonly unknown[];
    }) => {
      requests.push({ method, params: params ?? [] });
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_call") {
        const call = (params?.[0] ?? {}) as { to?: string; data?: `0x${string}` };
        if (!call.data) {
          throw new Error("eth_call missing data");
        }
        return respond(call.data);
      }
      throw new Error(`unmocked RPC method: ${method}`);
    },
  });
  const client = createPublicClient({ chain: mainnet, transport }) as unknown as PublicClient;
  return { client, requests };
}

beforeEach(() => {
  currentMockClient = undefined;
  _resetRegistryCacheForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
  currentMockClient = undefined;
  _resetRegistryCacheForTesting();
});

describe("scanErc20Balances", () => {
  it("returns an empty array when given an empty token list", async () => {
    // No mock needed — empty list short-circuits before touching the RPC.
    const result = await scanErc20Balances(WALLET, []);
    expect(result).toEqual([]);
  });

  it("returns one populated entry for a single non-zero token balance", async () => {
    const expectedBalance = 1_234_567n; // 1.234567 USDC

    const mock = buildMockClient(() => {
      const balanceReturn = encodeFunctionResult({
        abi: BALANCE_OF_ABI,
        functionName: "balanceOf",
        result: expectedBalance,
      });
      return encodeFunctionResult({
        abi: MULTICALL3_AGGREGATE_ABI,
        functionName: "aggregate3",
        result: [{ success: true, returnData: balanceReturn }],
      });
    });
    currentMockClient = mock.client;

    const result = await scanErc20Balances(WALLET, [USDC]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeDefined();
    expect(result[0]!.token).toEqual(USDC);
    expect(result[0]!.balance).toBe(expectedBalance);
    expect(result[0]!.error).toBeUndefined();
  });

  it("dispatches a single multicall3 eth_call when scanning multiple tokens", async () => {
    const balances: Record<string, bigint> = {
      [USDC.address.toLowerCase()]: 5_000_000n,
      [DAI.address.toLowerCase()]: 7_500_000_000_000_000_000n,
    };

    const mock = buildMockClient((callData) => {
      const decoded = decodeFunctionData({
        abi: MULTICALL3_AGGREGATE_ABI,
        data: callData,
      });
      const calls = decoded.args[0];
      const returnTuples = calls.map((c) => {
        const balance = balances[c.target.toLowerCase()] ?? 0n;
        return {
          success: true,
          returnData: encodeFunctionResult({
            abi: BALANCE_OF_ABI,
            functionName: "balanceOf",
            result: balance,
          }),
        };
      });
      return encodeFunctionResult({
        abi: MULTICALL3_AGGREGATE_ABI,
        functionName: "aggregate3",
        result: returnTuples,
      });
    });
    currentMockClient = mock.client;

    const result = await scanErc20Balances(WALLET, [USDC, DAI]);

    // Multicall payload shape: exactly one eth_call to the canonical
    // multicall3 address — the whole point of multicall is one round-trip
    // per scan, regardless of token count.
    const ethCalls = mock.requests.filter((r) => r.method === "eth_call");
    expect(ethCalls).toHaveLength(1);
    const callParams = ethCalls[0]!.params[0] as { to?: string; data?: `0x${string}` };
    expect(callParams.to?.toLowerCase()).toBe(MULTICALL3_ADDRESS.toLowerCase());

    expect(result).toHaveLength(2);
    expect(result[0]!.token.symbol).toBe("USDC");
    expect(result[0]!.balance).toBe(balances[USDC.address.toLowerCase()]);
    expect(result[1]!.token.symbol).toBe("DAI");
    expect(result[1]!.balance).toBe(balances[DAI.address.toLowerCase()]);
  });

  it("defaults to the top-50 registry when tokens are omitted", async () => {
    let observedCallCount = 0;

    const mock = buildMockClient((callData) => {
      const decoded = decodeFunctionData({
        abi: MULTICALL3_AGGREGATE_ABI,
        data: callData,
      });
      const calls = decoded.args[0];
      observedCallCount = calls.length;
      const returnTuples = calls.map(() => ({
        success: true,
        returnData: encodeAbiParameters([{ type: "uint256" }], [0n]),
      }));
      return encodeFunctionResult({
        abi: MULTICALL3_AGGREGATE_ABI,
        functionName: "aggregate3",
        result: returnTuples,
      });
    });
    currentMockClient = mock.client;

    const result = await scanErc20Balances(WALLET);
    expect(result).toHaveLength(50);
    expect(observedCallCount).toBe(50);
    expect(result.every((r) => r.balance === 0n && r.error === undefined)).toBe(true);
  });
});

describe("formatTokenBalance", () => {
  it("formats with the token's decimals", () => {
    expect(formatTokenBalance(1_234_567n, 6)).toBe("1.234567");
    expect(formatTokenBalance(1_500_000_000_000_000_000n, 18)).toBe("1.5");
    expect(formatTokenBalance(0n, 18)).toBe("0");
    // GUSD has 2 decimals — common off-by-decimal pitfall.
    expect(formatTokenBalance(150n, 2)).toBe("1.5");
  });
});

describe("filterDust", () => {
  const rows: TokenBalance[] = [
    { token: USDC, balance: 0n },
    { token: DAI, balance: 1_000_000_000_000_000_000n },
    { token: { ...USDC, symbol: "FOO" }, balance: 10n, error: "boom" },
  ];

  it("strips zero-balance rows when threshold is 0n", () => {
    const out = filterDust(rows);
    expect(out.map((r) => r.token.symbol)).toEqual(["DAI", "FOO"]);
  });

  it("strips rows below threshold and keeps rows with errors", () => {
    const out = filterDust(rows, 2n);
    // Error row preserved regardless of balance; DAI well above threshold.
    expect(out.map((r) => r.token.symbol).sort()).toEqual(["DAI", "FOO"]);
  });

  it("keeps rows whose balance equals or exceeds the threshold", () => {
    const out = filterDust(rows, 1_000_000_000_000_000_000n);
    expect(out.find((r) => r.token.symbol === "DAI")).toBeDefined();
  });
});
