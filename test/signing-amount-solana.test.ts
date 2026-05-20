// `parseSolanaAmountStrict` regression. Phase 12 — Plan 12-02.
//
// Mirror of `test/parse-amount-strict.test.ts` (Phase 6 / Plan 06-01) — same
// accept/reject ladder + a Solana-specific u64-overflow case (lamports + SPL
// token amounts are u64 on-wire; the EVM `wei` field is uint256 and overflow
// is practically unrepresentable, so the EVM module lacks this gate).
//
// CRITICAL caller-side discipline (documented in `src/signing/amount-solana.ts`
// JSDoc + asserted here):
//
//   - `prepare_solana_native_send`: `lamports` is RAW LAMPORTS (decimals=0) —
//     fractional input like "1.5" rejects via fractional-overflow.
//   - `prepare_solana_spl_send`: `amount` is HUMAN UNITS — decimals come from
//     `getMintDecimals(mint)`.

import { describe, expect, it } from "vitest";

import {
  InvalidAmountError,
  parseSolanaAmountStrict,
} from "../src/signing/amount-solana.js";

describe("parseSolanaAmountStrict — accepted shapes (decimals=0 RAW LAMPORTS scaling)", () => {
  it("'1000000000' against decimals=0 → 1_000_000_000n (1 SOL in raw lamports — native send happy path)", () => {
    expect(parseSolanaAmountStrict("1000000000", 0)).toBe(1_000_000_000n);
  });

  it("'1' against decimals=0 → 1n (one lamport — Solana dust boundary)", () => {
    expect(parseSolanaAmountStrict("1", 0)).toBe(1n);
  });

  it("'0' against decimals=0 → 0n (zero is valid)", () => {
    expect(parseSolanaAmountStrict("0", 0)).toBe(0n);
  });

  it("u64-max boundary: '18446744073709551615' against decimals=0 → 2^64-1 (confirms bigint not number)", () => {
    // The largest representable u64. Returns successfully — overflow check
    // fires at `> U64_MAX`, not `>=`.
    const result = parseSolanaAmountStrict("18446744073709551615", 0);
    expect(result).toBe((1n << 64n) - 1n);
  });
});

describe("parseSolanaAmountStrict — accepted shapes (decimals=6 / decimals=9 — SPL human-units)", () => {
  it("'100.5' against decimals=6 → 100_500_000n (100.5 USDC at 6 decimals — SPL happy path)", () => {
    expect(parseSolanaAmountStrict("100.5", 6)).toBe(100_500_000n);
  });

  it("'1.123456' against decimals=6 (exact precision) → 1_123_456n", () => {
    expect(parseSolanaAmountStrict("1.123456", 6)).toBe(1_123_456n);
  });

  it("'1' against decimals=9 → 1_000_000_000n (1 SOL in decimal human-units, decimals=9)", () => {
    expect(parseSolanaAmountStrict("1", 9)).toBe(1_000_000_000n);
  });

  it("'0' against decimals=9 → 0n; '0.0' against decimals=9 → 0n (decimal-zero acceptance)", () => {
    expect(parseSolanaAmountStrict("0", 9)).toBe(0n);
    expect(parseSolanaAmountStrict("0.0", 9)).toBe(0n);
  });

  it("'100' against decimals=6 (integer-only against non-zero decimals) → 100_000_000n", () => {
    expect(parseSolanaAmountStrict("100", 6)).toBe(100_000_000n);
  });
});

describe("parseSolanaAmountStrict — REJECTED kind: 'empty'", () => {
  it("'' (empty string) → throws InvalidAmountError(kind: 'empty')", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("empty");
    expect((caught as InvalidAmountError).message).toMatch(/empty/i);
  });

  it("'   ' (whitespace-only) → throws kind: 'empty'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("   ", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("empty");
  });
});

describe("parseSolanaAmountStrict — REJECTED kind: 'format' (non-canonical shape)", () => {
  it("'abc' (alpha) → throws kind: 'format'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("abc", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("format");
  });

  it("'1.2.3' (multi-dot) → throws kind: 'format'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("1.2.3", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("format");
  });

  it("'0x1' (hex prefix) → throws kind: 'format'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("0x1", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("format");
  });

  it("'-1' (negative) → throws kind: 'format'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("-1", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("format");
  });

  it("'.5' (leading dot) → throws kind: 'format'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict(".5", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("format");
  });

  it("'100.' (trailing dot) → throws kind: 'format'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("100.", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("format");
  });

  it("'1e6' (scientific notation) → throws kind: 'format'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("1e6", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("format");
  });

  it("'1,000' (comma-grouped) → throws kind: 'format'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("1,000", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("format");
  });
});

describe("parseSolanaAmountStrict — REJECTED kind: 'fractional-overflow' (off-by-decimal guard)", () => {
  it("'1.5' against decimals=0 (RAW LAMPORTS — the canonical off-by-decimal case) → throws kind: 'fractional-overflow'", () => {
    // The motivating case: an agent sends "1.5" thinking SOL human-units, but
    // the prepare_solana_native_send tool's `lamports` arg is RAW LAMPORTS
    // (decimals=0). A naive parser would silently round to 1 lamport; we
    // reject explicitly so the user can self-correct.
    let caught: unknown;
    try {
      parseSolanaAmountStrict("1.5", 0);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("fractional-overflow");
  });

  it("'1.23456789012345' against decimals=9 → throws kind: 'fractional-overflow' (14 frac digits > 9)", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("1.23456789012345", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("fractional-overflow");
    // Message must name both counts so the agent can self-correct.
    expect((caught as InvalidAmountError).message).toContain("14");
    expect((caught as InvalidAmountError).message).toContain("9");
  });

  it("'1.1234567' against decimals=6 → throws kind: 'fractional-overflow' (7 frac digits > 6)", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("1.1234567", 6);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("fractional-overflow");
  });
});

describe("parseSolanaAmountStrict — REJECTED kind: 'u64-overflow' (Solana-specific)", () => {
  it("'18446744073709551616' against decimals=0 (u64-max + 1) → throws kind: 'u64-overflow'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("18446744073709551616", 0);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("u64-overflow");
    expect((caught as InvalidAmountError).message).toContain("u64 max");
  });

  it("decimals-induced overflow: '99999999999999999999' against decimals=0 → kind: 'u64-overflow'", () => {
    let caught: unknown;
    try {
      parseSolanaAmountStrict("99999999999999999999", 0);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("u64-overflow");
  });

  it("decimal-shifting overflow: '99999999999.999999999' against decimals=9 (large enough to overflow) → kind: 'u64-overflow'", () => {
    // 99_999_999_999 SOL × 10^9 lamports/SOL = ~10^20 lamports > 2^64
    let caught: unknown;
    try {
      parseSolanaAmountStrict("99999999999.999999999", 9);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
    expect((caught as InvalidAmountError).kind).toBe("u64-overflow");
  });
});

describe("InvalidAmountError instance shape (structured-envelope consumability)", () => {
  it("name === 'InvalidAmountError'; kind discriminator preserved; message is non-empty (consumable as `cause` in INVALID_INPUT envelope)", () => {
    try {
      parseSolanaAmountStrict("", 9);
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidAmountError);
      const err = e as InvalidAmountError;
      expect(err.name).toBe("InvalidAmountError");
      expect(err.kind).toBe("empty");
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it("kind values cover the locked union: 'empty' | 'format' | 'fractional-overflow' | 'u64-overflow'", () => {
    const cases: { input: string; decimals: number; kind: string }[] = [
      { input: "", decimals: 9, kind: "empty" },
      { input: "abc", decimals: 9, kind: "format" },
      { input: "1.5", decimals: 0, kind: "fractional-overflow" },
      { input: "18446744073709551616", decimals: 0, kind: "u64-overflow" },
    ];
    for (const c of cases) {
      try {
        parseSolanaAmountStrict(c.input, c.decimals);
      } catch (e) {
        expect((e as InvalidAmountError).kind).toBe(c.kind);
      }
    }
  });
});
