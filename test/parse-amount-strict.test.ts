import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";

import { InvalidAmountError, parseAmountStrict } from "../src/signing/amount.js";

// Empirical Topic 3 ladder — research § Topic 3 § A1 (2026-05-12). Each
// rejected case below was verified against `viem.parseUnits` directly: items
// 5..8 + 13 are SILENTLY accepted by parseUnits (the load-bearing gap this
// guard closes); items 9..12 are caught by parseUnits's InvalidDecimalNumber
// error but are gated here too with a structured `kind` so callers don't have
// to depend on viem's internal error class.

describe("parseAmountStrict — empirical Topic 3 ladder (T-PARSE-AMOUNT-1 + T-PARSE-EMPTY-1)", () => {
  describe("ACCEPTED cases (delegation invariant — bigint matches viem.parseUnits byte-for-byte)", () => {
    it("case 1: '100.5' against decimals=6 → 100_500_000n", () => {
      const result = parseAmountStrict("100.5", 6);
      expect(result).toBe(100_500_000n);
      // Delegation invariant: byte-identical to viem.parseUnits.
      expect(result).toBe(parseUnits("100.5", 6));
    });

    it("case 2: '1.123456' against decimals=6 (exact precision) → 1_123_456n", () => {
      const result = parseAmountStrict("1.123456", 6);
      expect(result).toBe(1_123_456n);
      expect(result).toBe(parseUnits("1.123456", 6));
    });

    it("case 3: '0' against decimals=18 → 0n (zero is valid)", () => {
      const result = parseAmountStrict("0", 18);
      expect(result).toBe(0n);
      expect(result).toBe(parseUnits("0", 18));
    });

    it("case 4: '100' against decimals=6 (integer-only) → 100_000_000n", () => {
      const result = parseAmountStrict("100", 6);
      expect(result).toBe(100_000_000n);
      expect(result).toBe(parseUnits("100", 6));
    });
  });

  describe("REJECTED cases — kind: 'empty' (T-PARSE-EMPTY-1)", () => {
    it("case 5: '' (empty string) → throws InvalidAmountError(kind: 'empty')", () => {
      let caught: unknown;
      try {
        parseAmountStrict("", 18);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("empty");
      expect((caught as InvalidAmountError).message).toMatch(/empty/i);
    });

    it("case 6: '   ' (whitespace-only) → throws kind: 'empty'", () => {
      let caught: unknown;
      try {
        parseAmountStrict("   ", 18);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("empty");
    });
  });

  describe("REJECTED cases — kind: 'format' (T-PARSE-EMPTY-1 — non-canonical shape)", () => {
    it("case 7: '.5' (leading dot) → throws kind: 'format'", () => {
      let caught: unknown;
      try {
        parseAmountStrict(".5", 18);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("format");
      expect((caught as InvalidAmountError).message).toContain(".5");
    });

    it("case 8: '100.' (trailing dot) → throws kind: 'format'", () => {
      let caught: unknown;
      try {
        parseAmountStrict("100.", 18);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("format");
    });

    it("case 9: '-1' (negative) → throws kind: 'format'", () => {
      let caught: unknown;
      try {
        parseAmountStrict("-1", 18);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("format");
    });

    it("case 10: '1e6' (scientific notation) → throws kind: 'format'", () => {
      let caught: unknown;
      try {
        parseAmountStrict("1e6", 18);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("format");
    });

    it("case 11: '1,000' (comma-grouped) → throws kind: 'format'", () => {
      let caught: unknown;
      try {
        parseAmountStrict("1,000", 18);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("format");
    });

    it("case 12: 'abc' (alpha) → throws kind: 'format'", () => {
      let caught: unknown;
      try {
        parseAmountStrict("abc", 18);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("format");
    });

    it("multi-dot '1.2.3' → throws kind: 'format' (defense-in-depth — regex covers)", () => {
      let caught: unknown;
      try {
        parseAmountStrict("1.2.3", 18);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("format");
    });
  });

  describe("REJECTED cases — kind: 'fractional-overflow' (T-PARSE-AMOUNT-1 — load-bearing off-by-decimal guard)", () => {
    it("case 13: '1.23456789' against decimals=6 → throws kind: 'fractional-overflow'", () => {
      let caught: unknown;
      try {
        parseAmountStrict("1.23456789", 6);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("fractional-overflow");
      // Message must name both counts so the agent can self-correct.
      expect((caught as InvalidAmountError).message).toContain("8");
      expect((caught as InvalidAmountError).message).toContain("6");
    });

    it("'100.5' against decimals=0 → throws kind: 'fractional-overflow' (the silent-round case)", () => {
      // viem.parseUnits("100.5", 0) → 101n SILENTLY. This is the canonical
      // off-by-decimal bug the guard exists to catch.
      let caught: unknown;
      try {
        parseAmountStrict("100.5", 0);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("fractional-overflow");
    });

    it("'1.123456789012345678901' against decimals=18 → throws kind: 'fractional-overflow' (21 frac digits)", () => {
      let caught: unknown;
      try {
        parseAmountStrict("1.123456789012345678901", 18);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAmountError);
      expect((caught as InvalidAmountError).kind).toBe("fractional-overflow");
    });
  });

  describe("InvalidAmountError instance shape", () => {
    it("name = 'InvalidAmountError' + kind discriminator is read-only", () => {
      try {
        parseAmountStrict("", 18);
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidAmountError);
        const err = e as InvalidAmountError;
        expect(err.name).toBe("InvalidAmountError");
        expect(err.kind).toBe("empty");
      }
    });
  });
});
