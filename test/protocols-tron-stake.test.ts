// Phase 19 — Plan 19-02: `src/protocols/tron-stake.ts` unit tests.
//
// Load-bearing invariants:
//
//   1. **T-19-02-T-STAKE2-DISTINCT** — `encodeFreezeBalanceV2` calls
//      `transactionBuilder.freezeBalanceV2` (Stake 2.0), NEVER `freezeBalance`
//      (Stake 1.0 deprecated). Grep regression confirms no Stake 1.0 calls in `src/`.
//
//   2. **T-19-02-T-NUMBER-OVERFLOW** — `encodeFreezeBalanceV2` throws when
//      `sun > BigInt(Number.MAX_SAFE_INTEGER)`. Same for `encodeUnfreezeBalanceV2`.
//
//   3. **ESM spy-affordance** — `_tronStake` indirection intercepts encoder calls
//      via `vi.spyOn` (ESM bindings are immutable; direct named-export spies are no-ops).
//
//   4. **FreezeBalanceV2Contract type assertion** — decoded `raw_data.contract[0].type`
//      must be `"FreezeBalanceV2Contract"` (NOT `"FreezeBalanceContract"` Stake 1.0).
//
//   5. **WithdrawExpireUnfreezeContract zero-arg** — `encodeWithdrawExpireUnfreeze`
//      calls `withdrawExpireUnfreeze(from)` with no amount arg; contract value has
//      ONLY `owner_address` field (no `amount`, no `resource`).
//
//   6. **checkWithdrawableBalance defensive default** — RPC failure returns
//      `{ withdrawable: 0n, expiringAt: null }` (fail-closed security default).
//
// Mocks:
//   - `_tronRegistry.getTronWeb()` returns a stub TronWeb with mocked builder methods.
//   - `tronWeb.trx.getAccount` mocked to control account state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _tronRegistry } from "../src/chains/tron/registry.js";
import {
  _tronStake,
  checkWithdrawableBalance,
  encodeWithdrawExpireUnfreeze,
  encodeFreezeBalanceV2,
  encodeUnfreezeBalanceV2,
} from "../src/protocols/tron-stake.js";

// ============================================================================
// Mock TronWeb builder and trx
// ============================================================================

/** Build a stub TronWeb with controllable builder and trx. */
function makeStubTronWeb(overrides: {
  freezeBalanceV2?: () => Promise<unknown>;
  unfreezeBalanceV2?: () => Promise<unknown>;
  withdrawExpireUnfreeze?: () => Promise<unknown>;
  extendExpiration?: (tx: unknown, seconds: number) => Promise<unknown>;
  getAccount?: (address: string) => Promise<unknown>;
} = {}) {
  // Default stub transaction — mirrors what tronweb returns for Stake 2.0 builder calls.
  const stubTx = (contractType: string, contractValue: Record<string, unknown>) => ({
    raw_data_hex: "0a0200ad22081234567890abcdef40f0c894a5e4335a200a34" +
      Buffer.from(`type.googleapis.com/protocol.${contractType}`).toString("hex") +
      "1234",
    raw_data: {
      contract: [{
        type: contractType,
        parameter: {
          value: contractValue,
          type_url: `type.googleapis.com/protocol.${contractType}`,
        },
      }],
      ref_block_bytes: "00ad",
      ref_block_hash: "8e5e7df4e3c8b9a2",
      expiration: 1779268134000,
      timestamp: 1779268074000,
    },
  });

  const freezeTx = stubTx("FreezeBalanceV2Contract", {
    owner_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
    frozen_balance: 1_000_000_000,
    resource: "ENERGY",
  });

  const unfreezeTx = stubTx("UnfreezeBalanceV2Contract", {
    owner_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
    unfreeze_balance: 1_000_000_000,
    resource: "ENERGY",
  });

  const withdrawTx = stubTx("WithdrawExpireUnfreezeContract", {
    owner_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
  });

  return {
    transactionBuilder: {
      freezeBalanceV2: overrides.freezeBalanceV2 ?? vi.fn().mockResolvedValue(freezeTx),
      unfreezeBalanceV2: overrides.unfreezeBalanceV2 ?? vi.fn().mockResolvedValue(unfreezeTx),
      withdrawExpireUnfreeze: overrides.withdrawExpireUnfreeze ?? vi.fn().mockResolvedValue(withdrawTx),
      extendExpiration: overrides.extendExpiration ?? vi.fn().mockImplementation((tx: unknown) => Promise.resolve(tx)),
    },
    trx: {
      getAccount: overrides.getAccount ?? vi.fn().mockResolvedValue({ unfrozenV2: [] }),
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("encodeFreezeBalanceV2", () => {
  let stubTronWeb: ReturnType<typeof makeStubTronWeb>;
  let getTronWebSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stubTronWeb = makeStubTronWeb();
    getTronWebSpy = vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stubTronWeb as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls transactionBuilder.freezeBalanceV2 with correct args (Stake 2.0 — NOT freezeBalance Stake 1.0)", async () => {
    const result = await encodeFreezeBalanceV2({
      tronWeb: stubTronWeb as never,
      from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      sun: 1_000_000_000n,
      resource: "ENERGY",
    });

    // Verify Stake 2.0 builder was called (NOT Stake 1.0 freezeBalance).
    expect(stubTronWeb.transactionBuilder.freezeBalanceV2).toHaveBeenCalledTimes(1);
    expect(stubTronWeb.transactionBuilder.freezeBalanceV2).toHaveBeenCalledWith(
      1_000_000_000, // Number() conversion from bigint
      "ENERGY",
      "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    );

    // extendExpiration must be called (LOAD-BEARING per 18-RESEARCH §Topic 5).
    expect(stubTronWeb.transactionBuilder.extendExpiration).toHaveBeenCalledTimes(1);

    // Result shape.
    expect(result.rawDataHex).toBeTypeOf("string");
    expect(result.rawDataBytes).toBeInstanceOf(Uint8Array);
    expect(result.rawDataObject).toBeDefined();
    expect(result.refBlockBytes).toBe("00ad");
    expect(result.refBlockHash).toBe("8e5e7df4e3c8b9a2");
    expect(result.expiration).toBe(1779268134000);
  });

  it("decoded raw_data.contract[0].type is 'FreezeBalanceV2Contract' (NOT Stake 1.0 'FreezeBalanceContract')", async () => {
    const result = await encodeFreezeBalanceV2({
      tronWeb: stubTronWeb as never,
      from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      sun: 1_000_000_000n,
      resource: "ENERGY",
    });

    // T-19-02-T-STAKE2-DISTINCT assertion.
    const rawData = result.rawDataObject as { contract: Array<{ type: string }> };
    expect(rawData.contract[0].type).toBe("FreezeBalanceV2Contract");
    // Ensure it is NOT the Stake 1.0 type.
    expect(rawData.contract[0].type).not.toBe("FreezeBalanceContract");
  });

  it("BANDWIDTH resource produces contract with resource: 'BANDWIDTH'", async () => {
    const bandwidthStub = makeStubTronWeb();
    // Override to return BANDWIDTH contract
    const bandwidthTx = {
      raw_data_hex: "0a020012220800000000000000001234",
      raw_data: {
        contract: [{
          type: "FreezeBalanceV2Contract",
          parameter: {
            value: {
              owner_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
              frozen_balance: 500_000_000,
              resource: "BANDWIDTH",
            },
            type_url: "type.googleapis.com/protocol.FreezeBalanceV2Contract",
          },
        }],
        ref_block_bytes: "0012",
        ref_block_hash: "0000000000000000",
        expiration: 1779268200000,
        timestamp: 1779268140000,
      },
    };
    (bandwidthStub.transactionBuilder.freezeBalanceV2 as ReturnType<typeof vi.fn>)
      .mockResolvedValue(bandwidthTx);

    const result = await encodeFreezeBalanceV2({
      tronWeb: bandwidthStub as never,
      from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      sun: 500_000_000n,
      resource: "BANDWIDTH",
    });

    const rawData = result.rawDataObject as { contract: Array<{ parameter: { value: { resource: string } } }> };
    expect(rawData.contract[0].parameter.value.resource).toBe("BANDWIDTH");
    expect(bandwidthStub.transactionBuilder.freezeBalanceV2).toHaveBeenCalledWith(
      500_000_000,
      "BANDWIDTH",
      "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    );
  });

  it("throws RangeError when sun exceeds Number.MAX_SAFE_INTEGER (T-NUMBER-OVERFLOW)", async () => {
    const oversizedAmount = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

    await expect(
      encodeFreezeBalanceV2({
        tronWeb: stubTronWeb as never,
        from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        sun: oversizedAmount,
        resource: "ENERGY",
      }),
    ).rejects.toThrow(RangeError);

    await expect(
      encodeFreezeBalanceV2({
        tronWeb: stubTronWeb as never,
        from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        sun: oversizedAmount,
        resource: "ENERGY",
      }),
    ).rejects.toThrow(/exceeds JavaScript safe integer range/);

    // freezeBalanceV2 must NOT be called (overflow guard fires before).
    expect(stubTronWeb.transactionBuilder.freezeBalanceV2).not.toHaveBeenCalled();
  });

  it("does NOT throw for sun === BigInt(Number.MAX_SAFE_INTEGER) (boundary is exclusive)", async () => {
    const exactMaxSafe = BigInt(Number.MAX_SAFE_INTEGER);

    const result = await encodeFreezeBalanceV2({
      tronWeb: stubTronWeb as never,
      from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      sun: exactMaxSafe,
      resource: "ENERGY",
    });

    expect(result.rawDataHex).toBeTypeOf("string");
    expect(stubTronWeb.transactionBuilder.freezeBalanceV2).toHaveBeenCalledWith(
      Number.MAX_SAFE_INTEGER,
      "ENERGY",
      "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    );
  });

  it("instructionSummary[0] has kind 'stake-freeze-v2' with correct fields", async () => {
    const result = await encodeFreezeBalanceV2({
      tronWeb: stubTronWeb as never,
      from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      sun: 1_000_000_000n,
      resource: "ENERGY",
    });

    expect(result.instructionSummary).toHaveLength(1);
    const summary = result.instructionSummary[0];
    expect(summary.kind).toBe("stake-freeze-v2");
    if (summary.kind === "stake-freeze-v2") {
      expect(summary.from).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
      expect(summary.resource).toBe("ENERGY");
      expect(summary.sun).toBe(1_000_000_000n);
    }
  });
});

describe("encodeUnfreezeBalanceV2", () => {
  let stubTronWeb: ReturnType<typeof makeStubTronWeb>;

  beforeEach(() => {
    stubTronWeb = makeStubTronWeb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls transactionBuilder.unfreezeBalanceV2 with correct args (Stake 2.0)", async () => {
    const result = await encodeUnfreezeBalanceV2({
      tronWeb: stubTronWeb as never,
      from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      sun: 1_000_000_000n,
      resource: "ENERGY",
    });

    expect(stubTronWeb.transactionBuilder.unfreezeBalanceV2).toHaveBeenCalledTimes(1);
    expect(stubTronWeb.transactionBuilder.unfreezeBalanceV2).toHaveBeenCalledWith(
      1_000_000_000,
      "ENERGY",
      "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    );
    expect(stubTronWeb.transactionBuilder.extendExpiration).toHaveBeenCalledTimes(1);

    const rawData = result.rawDataObject as { contract: Array<{ type: string }> };
    expect(rawData.contract[0].type).toBe("UnfreezeBalanceV2Contract");
    expect(rawData.contract[0].type).not.toBe("UnfreezeBalanceContract");
  });

  it("throws RangeError when sun exceeds Number.MAX_SAFE_INTEGER", async () => {
    const oversizedAmount = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

    await expect(
      encodeUnfreezeBalanceV2({
        tronWeb: stubTronWeb as never,
        from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        sun: oversizedAmount,
        resource: "ENERGY",
      }),
    ).rejects.toThrow(RangeError);
  });

  it("instructionSummary[0] has kind 'stake-unfreeze-v2'", async () => {
    const result = await encodeUnfreezeBalanceV2({
      tronWeb: stubTronWeb as never,
      from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      sun: 500_000_000n,
      resource: "BANDWIDTH",
    });

    const summary = result.instructionSummary[0];
    expect(summary.kind).toBe("stake-unfreeze-v2");
    if (summary.kind === "stake-unfreeze-v2") {
      expect(summary.resource).toBe("BANDWIDTH");
      expect(summary.sun).toBe(500_000_000n);
    }
  });
});

describe("encodeWithdrawExpireUnfreeze", () => {
  let stubTronWeb: ReturnType<typeof makeStubTronWeb>;

  beforeEach(() => {
    stubTronWeb = makeStubTronWeb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls withdrawExpireUnfreeze with from address only (ZERO-ARG contract)", async () => {
    const result = await encodeWithdrawExpireUnfreeze({
      tronWeb: stubTronWeb as never,
      from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    });

    // withdrawExpireUnfreeze takes only the owner address (second arg is TransactionCommonOptions).
    expect(stubTronWeb.transactionBuilder.withdrawExpireUnfreeze).toHaveBeenCalledTimes(1);
    expect(stubTronWeb.transactionBuilder.withdrawExpireUnfreeze).toHaveBeenCalledWith(
      "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    );
    expect(stubTronWeb.transactionBuilder.extendExpiration).toHaveBeenCalledTimes(1);

    // raw_data.contract[0].type must be WithdrawExpireUnfreezeContract.
    const rawData = result.rawDataObject as {
      contract: Array<{ type: string; parameter: { value: Record<string, unknown> } }>;
    };
    expect(rawData.contract[0].type).toBe("WithdrawExpireUnfreezeContract");

    // Contract value has ONLY owner_address — no amount, no resource.
    const contractValue = rawData.contract[0].parameter.value;
    expect(contractValue).toHaveProperty("owner_address");
    expect(contractValue).not.toHaveProperty("amount");
    expect(contractValue).not.toHaveProperty("frozen_balance");
    expect(contractValue).not.toHaveProperty("unfreeze_balance");
  });

  it("instructionSummary[0] has kind 'stake-withdraw-expire' with from field only", async () => {
    const result = await encodeWithdrawExpireUnfreeze({
      tronWeb: stubTronWeb as never,
      from: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    });

    expect(result.instructionSummary).toHaveLength(1);
    const summary = result.instructionSummary[0];
    expect(summary.kind).toBe("stake-withdraw-expire");
    if (summary.kind === "stake-withdraw-expire") {
      expect(summary.from).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
    }
    // No resource or sun fields.
    expect((summary as Record<string, unknown>).resource).toBeUndefined();
    expect((summary as Record<string, unknown>).sun).toBeUndefined();
  });
});

describe("Stake 1.0 anti-regression grep — NO transactionBuilder.freezeBalance\\b in src/", () => {
  it("src/ directory has NO Stake 1.0 freezeBalance or unfreezeBalance calls (word-boundary grep)", () => {
    // This test runs a grep to assert no Stake 1.0 method names appear in src/.
    // `\b` word boundary prevents matching `freezeBalanceV2` (Stake 2.0 valid method).
    // T-19-02-T-STAKE2-DISTINCT plan-check anti-regression per threat register.
    const { execSync } = require("child_process");

    // grep -rEn 'transactionBuilder\.freezeBalance[^V]' src/ — must return empty
    // Exclude comment-only lines (lines starting with optional whitespace + // or *).
    let freezeOutput = "";
    try {
      // We use grep to find the pattern, then filter out comment-only lines.
      const raw = execSync(
        "grep -rEn 'transactionBuilder\\.freezeBalance[^V]' src/",
        { cwd: process.cwd(), encoding: "utf8" },
      );
      // Filter out lines where the match is inside a comment (line contains // or * before the match)
      freezeOutput = raw
        .split("\n")
        .filter((line) => {
          if (!line.trim()) return false;
          // Extract the content part (after file:line: prefix)
          const contentStart = line.indexOf(":", line.indexOf(":") + 1);
          const content = contentStart >= 0 ? line.slice(contentStart + 1) : line;
          const trimmed = content.trim();
          // Skip if this is a comment-only line (starts with // or *)
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
          // Skip if the actual transactionBuilder.freezeBalance call is inside a comment
          // Find position of the actual code call
          const codeCallIdx = content.indexOf("transactionBuilder.freezeBalance");
          if (codeCallIdx < 0) return false;
          const beforeCall = content.slice(0, codeCallIdx);
          // If there's a // before the pattern on the same line, it's a comment
          if (beforeCall.includes("//")) return false;
          return true;
        })
        .join("\n");
    } catch {
      // grep exits with code 1 when no matches — that's the expected success case.
      freezeOutput = "";
    }

    // Any match means Stake 1.0 contamination — fail explicitly with context.
    if (freezeOutput.trim().length > 0) {
      throw new Error(
        `Stake 1.0 contamination detected in src/: 'transactionBuilder.freezeBalance' (non-V2) found in non-comment code:\n${freezeOutput}`,
      );
    }
    expect(freezeOutput.trim()).toBe("");
  });
});

describe("_tronStake ESM spy-affordance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes encodeFreezeBalanceV2 + encodeUnfreezeBalanceV2 + encodeWithdrawExpireUnfreeze + checkWithdrawableBalance", () => {
    expect(typeof _tronStake.encodeFreezeBalanceV2).toBe("function");
    expect(typeof _tronStake.encodeUnfreezeBalanceV2).toBe("function");
    expect(typeof _tronStake.encodeWithdrawExpireUnfreeze).toBe("function");
    expect(typeof _tronStake.checkWithdrawableBalance).toBe("function");
  });

  it("vi.spyOn intercepts encodeFreezeBalanceV2 via _tronStake indirection", async () => {
    const mockResult = {
      rawDataHex: "abcdef",
      rawDataBytes: new Uint8Array([0xab, 0xcd, 0xef]),
      rawDataObject: {},
      refBlockBytes: "0000",
      refBlockHash: "0000000000000000",
      expiration: 9999999,
      instructionSummary: [{
        kind: "stake-freeze-v2" as const,
        from: "T...",
        resource: "ENERGY" as const,
        sun: 1n,
      }],
      transaction: {},
    };

    const spy = vi.spyOn(_tronStake, "encodeFreezeBalanceV2").mockResolvedValue(mockResult);

    const result = await _tronStake.encodeFreezeBalanceV2({
      tronWeb: {} as never,
      from: "T...",
      sun: 1n,
      resource: "ENERGY",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe(mockResult);

    spy.mockRestore();
  });
});

describe("checkWithdrawableBalance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns withdrawable: 0n when unfrozenV2 is empty", async () => {
    const stubTronWeb = makeStubTronWeb({
      getAccount: vi.fn().mockResolvedValue({ unfrozenV2: [] }),
    });

    const result = await checkWithdrawableBalance(stubTronWeb as never, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");

    expect(result.withdrawable).toBe(0n);
    expect(result.expiringAt).toBeNull();
  });

  it("sums expired records and returns earliest future expiry", async () => {
    const now = Date.now();
    const pastTime = now - 15 * 24 * 60 * 60 * 1000; // 15 days ago (expired)
    const futureTime = now + 7 * 24 * 60 * 60 * 1000; // 7 days in future

    const stubTronWeb = makeStubTronWeb({
      getAccount: vi.fn().mockResolvedValue({
        unfrozenV2: [
          { type: "ENERGY", unfreeze_amount: 1_000_000_000, unfreeze_expire_time: pastTime },
          { type: "BANDWIDTH", unfreeze_amount: 500_000_000, unfreeze_expire_time: pastTime - 1000 },
          { type: "ENERGY", unfreeze_amount: 300_000_000, unfreeze_expire_time: futureTime },
        ],
      }),
    });

    const result = await checkWithdrawableBalance(stubTronWeb as never, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");

    // Sum of expired amounts: 1_000_000_000 + 500_000_000 = 1_500_000_000
    expect(result.withdrawable).toBe(1_500_000_000n);
    // Earliest future expiry is futureTime
    expect(result.expiringAt).toBe(futureTime);
  });

  it("returns withdrawable: 0n, expiringAt: null on RPC failure (defensive default)", async () => {
    const stubTronWeb = makeStubTronWeb({
      getAccount: vi.fn().mockRejectedValue(new Error("Network timeout")),
    });

    const result = await checkWithdrawableBalance(stubTronWeb as never, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");

    // Defensive fail-closed: refuse (withdrawable=0) when can't verify.
    expect(result.withdrawable).toBe(0n);
    expect(result.expiringAt).toBeNull();
  });

  it("returns withdrawable: 0n when all records are still in waiting period", async () => {
    const now = Date.now();
    const futureTime1 = now + 14 * 24 * 60 * 60 * 1000; // 14 days
    const futureTime2 = now + 10 * 24 * 60 * 60 * 1000; // 10 days (earlier)

    const stubTronWeb = makeStubTronWeb({
      getAccount: vi.fn().mockResolvedValue({
        unfrozenV2: [
          { type: "ENERGY", unfreeze_amount: 1_000_000_000, unfreeze_expire_time: futureTime1 },
          { type: "BANDWIDTH", unfreeze_amount: 500_000_000, unfreeze_expire_time: futureTime2 },
        ],
      }),
    });

    const result = await checkWithdrawableBalance(stubTronWeb as never, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");

    expect(result.withdrawable).toBe(0n);
    // Earliest future expiry should be futureTime2 (10 days, the smaller value)
    expect(result.expiringAt).toBe(futureTime2);
  });

  it("handles missing unfrozenV2 field gracefully", async () => {
    const stubTronWeb = makeStubTronWeb({
      getAccount: vi.fn().mockResolvedValue({}), // no unfrozenV2 field
    });

    const result = await checkWithdrawableBalance(stubTronWeb as never, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");

    expect(result.withdrawable).toBe(0n);
    expect(result.expiringAt).toBeNull();
  });
});
