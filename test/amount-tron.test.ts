// test/amount-tron.test.ts — Phase 18 Plan 18-01.
// Mirrors `test/signing-amount-solana.test.ts` shape with TRON-specific
// additions: u256 overflow guard + `overflowBound` discriminator.

import { describe, expect, it } from "vitest";

import {
  InvalidAmountError,
  U64_MAX,
  U256_MAX,
  parseTronAmountStrict,
} from "../src/signing/amount-tron.js";

// ============================================================================
// U64_MAX / U256_MAX constant anchors
// ============================================================================
describe("Constants", () => {
  it("U64_MAX is 2^64 - 1", () => {
    expect(U64_MAX).toBe(18_446_744_073_709_551_615n);
  });

  it("U256_MAX is 2^256 - 1", () => {
    // Just check it's the right bit-width — the full literal would be very long.
    expect(U256_MAX).toBe((1n << 256n) - 1n);
    // Cross-check bit length.
    expect(U256_MAX.toString(2).length).toBe(256);
  });
});

// ============================================================================
// Rejection ladder — common to both overflowBound paths
// ============================================================================
describe("parseTronAmountStrict — rejection ladder (both overflowBound paths)", () => {
  it("Step 1 — empty string throws kind: empty", () => {
    expect(() => parseTronAmountStrict("", 6, "u64")).toThrow(InvalidAmountError);
    try {
      parseTronAmountStrict("", 6, "u64");
    } catch (e) {
      expect(e instanceof InvalidAmountError).toBe(true);
      expect((e as InvalidAmountError).kind).toBe("empty");
    }
  });

  it("Step 1 — whitespace-only string throws kind: empty", () => {
    expect(() => parseTronAmountStrict("   ", 6, "u64")).toThrow(InvalidAmountError);
    const e = (() => {
      try { parseTronAmountStrict("   ", 6, "u64"); } catch (x) { return x; }
    })() as InvalidAmountError;
    expect(e.kind).toBe("empty");
  });

  it("Step 2 — leading dot throws kind: format", () => {
    const e = (() => {
      try { parseTronAmountStrict(".5", 6, "u64"); } catch (x) { return x; }
    })() as InvalidAmountError;
    expect(e instanceof InvalidAmountError).toBe(true);
    expect(e.kind).toBe("format");
  });

  it("Step 2 — trailing dot throws kind: format", () => {
    const e = (() => {
      try { parseTronAmountStrict("100.", 6, "u64"); } catch (x) { return x; }
    })() as InvalidAmountError;
    expect(e.kind).toBe("format");
  });

  it("Step 2 — negative throws kind: format", () => {
    const e = (() => {
      try { parseTronAmountStrict("-1", 6, "u64"); } catch (x) { return x; }
    })() as InvalidAmountError;
    expect(e.kind).toBe("format");
  });

  it("Step 2 — scientific notation throws kind: format", () => {
    const e = (() => {
      try { parseTronAmountStrict("1e6", 6, "u64"); } catch (x) { return x; }
    })() as InvalidAmountError;
    expect(e.kind).toBe("format");
  });

  it("Step 3 — fractional-overflow throws kind: fractional-overflow", () => {
    // 7 fractional digits exceed 6-decimal TRX.
    const e = (() => {
      try { parseTronAmountStrict("1.0000001", 6, "u64"); } catch (x) { return x; }
    })() as InvalidAmountError;
    expect(e instanceof InvalidAmountError).toBe(true);
    expect(e.kind).toBe("fractional-overflow");
  });
});

// ============================================================================
// Native TRX path — u64 overflow bound
// ============================================================================
describe("parseTronAmountStrict — native TRX path (decimals=0 or decimals=6, overflowBound: 'u64')", () => {
  it("'1' at decimals=6 → 1_000_000n (1 TRX in sun)", () => {
    expect(parseTronAmountStrict("1", 6, "u64")).toBe(1_000_000n);
  });

  it("'1.5' at decimals=6 → 1_500_000n", () => {
    expect(parseTronAmountStrict("1.5", 6, "u64")).toBe(1_500_000n);
  });

  it("'0' at decimals=6 → 0n", () => {
    expect(parseTronAmountStrict("0", 6, "u64")).toBe(0n);
  });

  it("'0.000001' at decimals=6 → 1n (minimum representable sun)", () => {
    expect(parseTronAmountStrict("0.000001", 6, "u64")).toBe(1n);
  });

  it("sun amount raw (decimals=0) '1000000' → 1_000_000n", () => {
    expect(parseTronAmountStrict("1000000", 0, "u64")).toBe(1_000_000n);
  });

  it("u64-overflow: amount > U64_MAX throws kind: u64-overflow", () => {
    // 18446744073709.551616 TRX at 6 decimals = 18_446_744_073_709_551_616 sun > U64_MAX
    const e = (() => {
      try { parseTronAmountStrict("18446744073709.551616", 6, "u64"); } catch (x) { return x; }
    })() as InvalidAmountError;
    expect(e instanceof InvalidAmountError).toBe(true);
    expect(e.kind).toBe("u64-overflow");
  });

  it("u64-max boundary: U64_MAX sun as raw integer string does NOT throw", () => {
    // U64_MAX = 18446744073709551615 at decimals=0 is valid
    expect(parseTronAmountStrict("18446744073709551615", 0, "u64")).toBe(U64_MAX);
  });
});

// ============================================================================
// TRC-20 path — u256 overflow bound
// ============================================================================
describe("parseTronAmountStrict — TRC-20 path (overflowBound: 'u256')", () => {
  it("'100' at decimals=6 → 100_000_000n (100 USDT)", () => {
    expect(parseTronAmountStrict("100", 6, "u256")).toBe(100_000_000n);
  });

  it("'100.5' at decimals=6 → 100_500_000n", () => {
    expect(parseTronAmountStrict("100.5", 6, "u256")).toBe(100_500_000n);
  });

  it("'1' at decimals=18 (USDD/TUSD) → 1_000_000_000_000_000_000n", () => {
    expect(parseTronAmountStrict("1", 18, "u256")).toBe(
      1_000_000_000_000_000_000n,
    );
  });

  it("large amount within u256 is accepted (u64 overflow is NOT applicable on u256 path)", () => {
    // 2^64 (one above U64_MAX) should be ACCEPTED when overflowBound is "u256"
    const bigAmount = U64_MAX + 1n;
    const bigAmountStr = bigAmount.toString(); // very large integer
    // decimals=0 so the scaled value is bigAmountStr itself
    expect(parseTronAmountStrict(bigAmountStr, 0, "u256")).toBe(bigAmount);
  });

  it("u256-overflow: amount above U256_MAX throws kind: u256-overflow", () => {
    // (U256_MAX + 1) as a decimal string at decimals=0
    const overflowStr = (U256_MAX + 1n).toString();
    const e = (() => {
      try { parseTronAmountStrict(overflowStr, 0, "u256"); } catch (x) { return x; }
    })() as InvalidAmountError;
    expect(e instanceof InvalidAmountError).toBe(true);
    expect(e.kind).toBe("u256-overflow");
  });
});

// ============================================================================
// InvalidAmountError shape
// ============================================================================
describe("InvalidAmountError shape", () => {
  it("name === 'InvalidAmountError'", () => {
    const e = (() => {
      try { parseTronAmountStrict("", 6, "u64"); } catch (x) { return x; }
    })() as InvalidAmountError;
    expect(e.name).toBe("InvalidAmountError");
  });

  it("instanceof Error + instanceof InvalidAmountError", () => {
    const e = (() => {
      try { parseTronAmountStrict("", 6, "u64"); } catch (x) { return x; }
    })();
    expect(e instanceof Error).toBe(true);
    expect(e instanceof InvalidAmountError).toBe(true);
  });

  it("all five kind values are representable", () => {
    const kinds: Array<InvalidAmountError["kind"]> = [
      "empty",
      "format",
      "fractional-overflow",
      "u64-overflow",
      "u256-overflow",
    ];
    for (const kind of kinds) {
      const err = new InvalidAmountError(`test: ${kind}`, kind);
      expect(err.kind).toBe(kind);
      expect(err.name).toBe("InvalidAmountError");
    }
  });
});
