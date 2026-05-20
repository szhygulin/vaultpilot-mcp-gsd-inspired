// src/chains/tron/tron-rpc-client.ts — thin RPC wrapper around
// `TronWeb.trx.getBalance` + `getCurrentBlock` + contract `balanceOf`
// (Phase 17 Plan 17-01).
//
// Coverage:
//   1-5. `formatSunToTrx` boundary cases — 6-decimal pad (NOT 9 like
//        SOL), trailing-zero trim, large whole.
//   6. **REGRESSION ANCHOR per research Pitfall 1**: bigint widening at
//      the TronGrid boundary. Stub `tw.trx.getBalance` returning
//      `9_007_199_254_740_993` (a JS number > Number.MAX_SAFE_INTEGER);
//      assert returned `sun` is exactly `9007199254740993n`. If the
//      implementation drops the `BigInt(...)` widening, the
//      number-precision drift surfaces here.
//   7. `getBlockTip()` extracts `block_header.raw_data.number / .timestamp`
//      + `blockID`; mock return shape matches RESEARCH § Example 3.
//   8. `getTrc20Balance` returns bigint from BigNumber-like
//      `.toString()` boundary conversion.
//   9. Error envelope wrapping: any throw in `getNativeBalance` becomes
//      `TronRpcError` with `errorCode === "TRON_RPC_FAILED"`.
//  10. `getBlockTip` defensive on schema drift: missing `block_header`
//      returns the zero-tuple, NOT a throw.

import type { TronWeb } from "tronweb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _tronRegistry } from "../src/chains/tron/registry.js";
import {
  TronRpcError,
  _trxRpcInternals,
  getBlockTip,
  getNativeBalance,
  getTrc20Balance,
} from "../src/chains/tron/tron-rpc-client.js";

const FIXTURE_WALLET = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const FIXTURE_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("src/chains/tron/tron-rpc-client.ts — formatSunToTrx (6-decimal pad)", () => {
  it("Test 1 — formatSunToTrx(0n) → '0'", () => {
    expect(_trxRpcInternals.formatSunToTrx(0n)).toBe("0");
  });

  it("Test 2 — formatSunToTrx(1n) → '0.000001' (6-decimal pad)", () => {
    expect(_trxRpcInternals.formatSunToTrx(1n)).toBe("0.000001");
  });

  it("Test 3 — formatSunToTrx(1_000_000n) → '1' (whole TRX, no fractional)", () => {
    expect(_trxRpcInternals.formatSunToTrx(1_000_000n)).toBe("1");
  });

  it("Test 4 — formatSunToTrx(1_500_000n) → '1.5' (trailing-zero trim)", () => {
    expect(_trxRpcInternals.formatSunToTrx(1_500_000n)).toBe("1.5");
  });

  it("Test 5 — formatSunToTrx(141_200_000_000_000n) → '141200000' (large whole — Demo whale fixture order of magnitude)", () => {
    expect(_trxRpcInternals.formatSunToTrx(141_200_000_000_000n)).toBe(
      "141200000",
    );
  });

  it("Test 5b — SUN_PER_TRX literal is 1_000_000n (6 decimals, NOT 9 like SOL)", () => {
    expect(_trxRpcInternals.SUN_PER_TRX).toBe(1_000_000n);
    // Belt-and-braces: explicit anchor against the SOL drift mode.
    expect(_trxRpcInternals.SUN_PER_TRX).not.toBe(1_000_000_000n);
  });

  it("Test 5c — formatSunToTrx boundary cases (sub-TRX, multi-digit fractional)", () => {
    expect(_trxRpcInternals.formatSunToTrx(123_456n)).toBe("0.123456");
    expect(_trxRpcInternals.formatSunToTrx(1_000_001n)).toBe("1.000001");
    expect(_trxRpcInternals.formatSunToTrx(10n)).toBe("0.00001");
  });
});

describe("src/chains/tron/tron-rpc-client.ts — getNativeBalance", () => {
  it("Test 6 — REGRESSION ANCHOR (research Pitfall 1): bigint widening at boundary; returned `sun` is always typeof bigint, not number", async () => {
    // Real TronGrid returns `number`. The wrapper's `BigInt(sunNumber)`
    // widens at the boundary so downstream math doesn't risk
    // precision loss. The bug mode (dropping `BigInt(...)` and passing
    // `number` through) surfaces here as `typeof result.sun === 'number'`.
    //
    // We use a Number.MAX_SAFE_INTEGER fixture: that's the largest int
    // a JS `number` can hold without precision loss. Above this, the
    // input ITSELF would round on parse, so the test would assert a
    // rounded value (not the widening per se). At MAX_SAFE_INTEGER the
    // input is exact; the widening preserves it; and the type check
    // proves bigint flowed through.
    const sunNumber = Number.MAX_SAFE_INTEGER; // 9_007_199_254_740_991
    const stubTronWeb = {
      trx: {
        getBalance: vi.fn().mockResolvedValue(sunNumber),
      },
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    const result = await getNativeBalance(FIXTURE_WALLET);
    // The widening: `number` MUST NOT leak; the result is bigint.
    expect(typeof result.sun).toBe("bigint");
    expect(result.sun).toBe(9_007_199_254_740_991n);
    expect(typeof result.trx).toBe("string");
  });

  it("Test 6 (cont.) — REGRESSION ANCHOR: bigint widening means subsequent arithmetic preserves precision (the actual hazard)", async () => {
    // The downstream hazard the bigint widening protects against:
    // arithmetic on the `sun` field. If `sun` were a `number`, then
    // `sun + 1n` would TypeError ("Cannot mix BigInt and other types"),
    // OR — worse — code that converts via `Number(sun) + 1` would
    // silently round at > MAX_SAFE_INTEGER. With `sun: bigint`,
    // arithmetic stays exact at any size.
    const stubTronWeb = {
      trx: {
        getBalance: vi.fn().mockResolvedValue(1_000_000),
      },
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    const result = await getNativeBalance(FIXTURE_WALLET);
    // bigint arithmetic — proves the type is right for downstream math.
    expect(result.sun + 1n).toBe(1_000_001n);
  });

  it("Test 6b — small native balance: 2_500_000 sun → { sun: 2_500_000n, trx: '2.5' }", async () => {
    const stubTronWeb = {
      trx: {
        getBalance: vi.fn().mockResolvedValue(2_500_000),
      },
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    const result = await getNativeBalance(FIXTURE_WALLET);
    expect(result).toEqual({ sun: 2_500_000n, trx: "2.5" });
    expect((stubTronWeb.trx.getBalance as unknown as ReturnType<typeof vi.fn>))
      .toHaveBeenCalledTimes(1);
  });

  it("Test 6c — zero balance: 0 sun → { sun: 0n, trx: '0' }", async () => {
    const stubTronWeb = {
      trx: {
        getBalance: vi.fn().mockResolvedValue(0),
      },
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    const result = await getNativeBalance(FIXTURE_WALLET);
    expect(result).toEqual({ sun: 0n, trx: "0" });
  });
});

describe("src/chains/tron/tron-rpc-client.ts — getBlockTip", () => {
  it("Test 7 — extracts { number, timestamp, blockHash } from block_header.raw_data + blockID", async () => {
    const stubBlock = {
      blockID:
        "0000000004f0d6de00000000000000000000000000000000000000000000abcd",
      block_header: {
        raw_data: {
          number: 82866526,
          timestamp: 1779268134000,
          txTrieRoot: "...",
          witness_address: "...",
          parentHash: "...",
          version: 31,
        },
        witness_signature: "...",
      },
    };
    const stubTronWeb = {
      trx: {
        getCurrentBlock: vi.fn().mockResolvedValue(stubBlock),
      },
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    const tip = await getBlockTip();
    expect(tip).toEqual({
      number: 82866526,
      timestamp: 1779268134000,
      blockHash:
        "0000000004f0d6de00000000000000000000000000000000000000000000abcd",
    });
  });

  it("Test 10 — defensive on schema drift: missing block_header.raw_data returns { number: 0, timestamp: 0, blockHash: '' } — NO throw", async () => {
    const stubTronWeb = {
      trx: {
        getCurrentBlock: vi.fn().mockResolvedValue({}),
      },
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    const tip = await getBlockTip();
    expect(tip).toEqual({ number: 0, timestamp: 0, blockHash: "" });
  });
});

describe("src/chains/tron/tron-rpc-client.ts — getTrc20Balance", () => {
  it("Test 8 — returns bigint from BigNumber-like `.toString()` boundary conversion", async () => {
    const stubCall = vi.fn().mockResolvedValue({
      toString: () => "1000000",
    });
    const stubContract = {
      methods: {
        balanceOf: vi.fn().mockReturnValue({ call: stubCall }),
      },
    };
    const stubTronWeb = {
      contract: vi.fn().mockResolvedValue(stubContract),
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    const balance = await getTrc20Balance(FIXTURE_WALLET, FIXTURE_TRC20);
    expect(balance).toBe(1_000_000n);
    expect(typeof balance).toBe("bigint");
  });

  it("Test 8b — large TRC-20 balance retains precision via toString boundary", async () => {
    // USDT-TRC20 has 6 decimals; a 1-billion-USDT balance is
    // 1_000_000_000_000_000n raw — fits in JS number, but the SDK's
    // BigNumber-like shape returns string-of-decimal, so we go via
    // `.toString()` → `BigInt(...)` for the boundary.
    const stubCall = vi.fn().mockResolvedValue({
      toString: () => "1000000000000000",
    });
    const stubContract = {
      methods: {
        balanceOf: vi.fn().mockReturnValue({ call: stubCall }),
      },
    };
    const stubTronWeb = {
      contract: vi.fn().mockResolvedValue(stubContract),
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    const balance = await getTrc20Balance(FIXTURE_WALLET, FIXTURE_TRC20);
    expect(balance).toBe(1_000_000_000_000_000n);
  });
});

describe("src/chains/tron/tron-rpc-client.ts — error envelope (TronRpcError)", () => {
  it("Test 9 — stub getBalance throws Error('network') → getNativeBalance rethrows as TronRpcError with errorCode TRON_RPC_FAILED", async () => {
    const stubTronWeb = {
      trx: {
        getBalance: vi.fn().mockRejectedValue(new Error("network")),
      },
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    await expect(getNativeBalance(FIXTURE_WALLET)).rejects.toBeInstanceOf(
      TronRpcError,
    );
    try {
      await getNativeBalance(FIXTURE_WALLET);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TronRpcError);
      expect((e as TronRpcError).errorCode).toBe("TRON_RPC_FAILED");
      expect((e as TronRpcError).message).toMatch(/network/);
      expect((e as TronRpcError).cause).toBeInstanceOf(Error);
    }
  });

  it("Test 9b — getBlockTip RPC failure rethrows as TronRpcError", async () => {
    const stubTronWeb = {
      trx: {
        getCurrentBlock: vi.fn().mockRejectedValue(new Error("getCurrentBlock fail")),
      },
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    await expect(getBlockTip()).rejects.toBeInstanceOf(TronRpcError);
  });

  it("Test 9c — getTrc20Balance RPC failure rethrows as TronRpcError", async () => {
    const stubTronWeb = {
      contract: vi.fn().mockRejectedValue(new Error("contract load fail")),
    } as unknown as TronWeb;
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb);

    await expect(
      getTrc20Balance(FIXTURE_WALLET, FIXTURE_TRC20),
    ).rejects.toBeInstanceOf(TronRpcError);
  });
});
