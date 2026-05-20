// chains/compound-v3 tests — Phase 28 Plan 28-02 (partial surface).
// Anchors:
//   - readBaseToken / readBorrowBalance / readBaseBalance — per-helper
//     readContract shape (vi.spyOn on mock client)
//   - deriveIntent 4-arm exhaustiveness across 6 scenarios (supply/non-base,
//     supply/base/no-debt, supply/base/with-debt, withdraw/non-base,
//     withdraw/base/no-supply, withdraw/base/with-supply)
//   - _compoundChains ESM spy referential equality (CLAUDE.md spy hygiene)
//
// Plan 28-04 extends this file with getCometState + getAllCometStates
// multicall tests.

import type { Address, PublicClient } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _compoundChains,
  deriveIntent,
  readBaseBalance,
  readBaseToken,
  readBorrowBalance,
} from "../src/chains/compound-v3.js";
import {
  getCompoundCometAddress,
} from "../src/config/contracts.js";
import { COMPOUND_V3_COMET_ABI } from "../src/protocols/compound-v3.js";

const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WBTC: Address = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const cUSDCv3 = getCompoundCometAddress(1, "USDC")!;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chains/compound-v3::readBaseToken — readContract shape (T-COMPOUND-COMET-ADDR-INLINE-1)", () => {
  it("calls readContract with { address: comet, abi: COMPOUND_V3_COMET_ABI, functionName: 'baseToken' } and bubbles return", async () => {
    const readContract = vi.fn().mockResolvedValue(USDC);
    const mockClient = { readContract } as unknown as PublicClient;

    const result = await readBaseToken(mockClient, cUSDCv3);

    expect(readContract).toHaveBeenCalledOnce();
    const call = readContract.mock.calls[0]?.[0] as {
      address: Address;
      abi: typeof COMPOUND_V3_COMET_ABI;
      functionName: string;
    };
    expect(call.address).toBe(cUSDCv3);
    expect(call.abi).toBe(COMPOUND_V3_COMET_ABI);
    expect(call.functionName).toBe("baseToken");
    expect(result).toBe(USDC);
  });
});

describe("chains/compound-v3::readBorrowBalance — readContract shape", () => {
  it("calls readContract with functionName: 'borrowBalanceOf', args: [user] and bubbles bigint return", async () => {
    const readContract = vi.fn().mockResolvedValue(123_456_789n);
    const mockClient = { readContract } as unknown as PublicClient;

    const result = await readBorrowBalance(mockClient, cUSDCv3, WALLET);

    expect(readContract).toHaveBeenCalledOnce();
    const call = readContract.mock.calls[0]?.[0] as {
      address: Address;
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.address).toBe(cUSDCv3);
    expect(call.functionName).toBe("borrowBalanceOf");
    expect(call.args).toEqual([WALLET]);
    expect(result).toBe(123_456_789n);
  });
});

describe("chains/compound-v3::readBaseBalance — readContract shape", () => {
  it("calls readContract with functionName: 'balanceOf', args: [user] and bubbles bigint return", async () => {
    const readContract = vi.fn().mockResolvedValue(999_999n);
    const mockClient = { readContract } as unknown as PublicClient;

    const result = await readBaseBalance(mockClient, cUSDCv3, WALLET);

    expect(readContract).toHaveBeenCalledOnce();
    const call = readContract.mock.calls[0]?.[0] as {
      address: Address;
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.address).toBe(cUSDCv3);
    expect(call.functionName).toBe("balanceOf");
    expect(call.args).toEqual([WALLET]);
    expect(result).toBe(999_999n);
  });
});

// ---------------------------------------------------------------------------
// deriveIntent — 4-arm × 6-scenario exhaustiveness. The mock client returns
// different values depending on the functionName so a single test can exercise
// the routing logic. We assert BOTH the returned label AND the call-count
// shape (the cheap-path arms must NOT make user-position reads).
// ---------------------------------------------------------------------------

function makeMockClient(reads: {
  baseToken: Address;
  borrowBalance?: bigint;
  baseBalance?: bigint;
}): { client: PublicClient; readContract: ReturnType<typeof vi.fn> } {
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case "baseToken":
        return reads.baseToken;
      case "borrowBalanceOf":
        if (reads.borrowBalance === undefined) {
          throw new Error("borrowBalance not seeded");
        }
        return reads.borrowBalance;
      case "balanceOf":
        if (reads.baseBalance === undefined) {
          throw new Error("baseBalance not seeded");
        }
        return reads.baseBalance;
      default:
        throw new Error(`unexpected readContract call: ${functionName}`);
    }
  });
  const client = { readContract } as unknown as PublicClient;
  return { client, readContract };
}

describe("chains/compound-v3::deriveIntent — 4-arm exhaustiveness (research § Topic 3 lock)", () => {
  it("supply + asset !== baseToken → 'supply-collateral' (cheap path; no borrowBalance call)", async () => {
    const { client, readContract } = makeMockClient({ baseToken: USDC });
    const intent = await deriveIntent(client, cUSDCv3, WALLET, "supply", WBTC);

    expect(intent).toBe("supply-collateral");
    // Single readContract call — only baseToken; the cheap path does NOT
    // fetch borrowBalance.
    expect(readContract).toHaveBeenCalledOnce();
    expect(readContract.mock.calls[0]?.[0]).toMatchObject({ functionName: "baseToken" });
  });

  it("supply + asset === baseToken + borrowBalance === 0n → 'supply-collateral' (lender position)", async () => {
    const { client, readContract } = makeMockClient({ baseToken: USDC, borrowBalance: 0n });
    const intent = await deriveIntent(client, cUSDCv3, WALLET, "supply", USDC);

    expect(intent).toBe("supply-collateral");
    // 2 readContract calls — baseToken + borrowBalanceOf.
    expect(readContract).toHaveBeenCalledTimes(2);
    expect(readContract.mock.calls[1]?.[0]).toMatchObject({
      functionName: "borrowBalanceOf",
      args: [WALLET],
    });
  });

  it("supply + asset === baseToken + borrowBalance > 0n → 'repay-debt' (intent-gate refusal candidate)", async () => {
    const { client, readContract } = makeMockClient({
      baseToken: USDC,
      borrowBalance: 200_000_000n,
    });
    const intent = await deriveIntent(client, cUSDCv3, WALLET, "supply", USDC);

    expect(intent).toBe("repay-debt");
    expect(readContract).toHaveBeenCalledTimes(2);
  });

  it("withdraw + asset !== baseToken → 'withdraw-collateral' (cheap path; no baseBalance call)", async () => {
    const { client, readContract } = makeMockClient({ baseToken: USDC });
    const intent = await deriveIntent(client, cUSDCv3, WALLET, "withdraw", WBTC);

    expect(intent).toBe("withdraw-collateral");
    expect(readContract).toHaveBeenCalledOnce();
    expect(readContract.mock.calls[0]?.[0]).toMatchObject({ functionName: "baseToken" });
  });

  it("withdraw + asset === baseToken + baseBalance === 0n → 'borrow' (intent-gate refusal candidate)", async () => {
    const { client, readContract } = makeMockClient({ baseToken: USDC, baseBalance: 0n });
    const intent = await deriveIntent(client, cUSDCv3, WALLET, "withdraw", USDC);

    expect(intent).toBe("borrow");
    expect(readContract).toHaveBeenCalledTimes(2);
    expect(readContract.mock.calls[1]?.[0]).toMatchObject({
      functionName: "balanceOf",
      args: [WALLET],
    });
  });

  it("withdraw + asset === baseToken + baseBalance > 0n → 'withdraw-collateral' (base-asset unwind)", async () => {
    const { client, readContract } = makeMockClient({
      baseToken: USDC,
      baseBalance: 100_000_000n,
    });
    const intent = await deriveIntent(client, cUSDCv3, WALLET, "withdraw", USDC);

    expect(intent).toBe("withdraw-collateral");
    expect(readContract).toHaveBeenCalledTimes(2);
  });

  it("EIP-55 case-insensitivity — mixed-case asset arg compares against baseToken via getAddress normalization", async () => {
    // baseToken returns lowercase; asset is mixed-case; getAddress normalizes
    // both before equality. The discriminator MUST hit the `isBase === true`
    // branch and dispatch the user-position read.
    const lowercaseUsdc = USDC.toLowerCase() as Address;
    const { client, readContract } = makeMockClient({
      baseToken: lowercaseUsdc,
      borrowBalance: 0n,
    });
    const intent = await deriveIntent(client, cUSDCv3, WALLET, "supply", USDC);

    expect(intent).toBe("supply-collateral");
    // Confirms the user-position read fired (not short-circuited as the
    // non-base cheap path).
    expect(readContract).toHaveBeenCalledTimes(2);
  });
});

describe("chains/compound-v3::deriveIntent — routes through _compoundChains spy (CLAUDE.md indirection)", () => {
  it("spy on _compoundChains.readBaseToken intercepts the read", async () => {
    const readContract = vi.fn().mockResolvedValue(WBTC);
    const mockClient = { readContract } as unknown as PublicClient;

    const spy = vi
      .spyOn(_compoundChains, "readBaseToken")
      .mockResolvedValueOnce(USDC);

    // asset !== baseToken (USDC vs WBTC arg) — cheap path; no user-position
    // read.
    const intent = await deriveIntent(mockClient, cUSDCv3, WALLET, "supply", WBTC);

    expect(intent).toBe("supply-collateral");
    expect(spy).toHaveBeenCalledOnce();
    // Underlying readContract NOT called — the spy short-circuited.
    expect(readContract).not.toHaveBeenCalled();
  });
});

describe("chains/compound-v3::_compoundChains — ESM spy referential equality (CLAUDE.md hygiene)", () => {
  it("_compoundChains exposes the 4 helpers by referential equality (guards against accidental rebinding)", () => {
    expect(_compoundChains.readBaseToken).toBe(readBaseToken);
    expect(_compoundChains.readBorrowBalance).toBe(readBorrowBalance);
    expect(_compoundChains.readBaseBalance).toBe(readBaseBalance);
    expect(_compoundChains.deriveIntent).toBe(deriveIntent);
  });
});
