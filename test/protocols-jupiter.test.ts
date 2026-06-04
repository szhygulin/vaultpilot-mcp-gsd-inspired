// Plan 14-02 Task 1 (Wave 0) — src/protocols/jupiter.ts legacy-tx deserialize +
// top-level program enumeration.
//
// Imports the SHARED JUPITER_SWAP_LEGACY_B64 fixture 14-01 OWNS (never a second
// copy of the base64) — re-asserts against the IDENTICAL bytes 14-01 enumerated
// the allowlist from. NO live /swap call, NO live Connection. Cases:
//   (a) Transaction.from → serializeMessage() bytes are deterministic
//   (b) top-level programIds equals the EXACT set 14-01-SUMMARY recorded
//       (Jupiter v6 + System + SPL-Token + Associated-Token + ComputeBudget),
//       asserted against the SOT getters / web3.js constants (NOT inlined base58)
//   (c) a v0/VersionedTransaction base64 → the decoder REFUSES (typed error),
//       never silently produces v0 message bytes (anti-pattern guard)

import { describe, expect, it } from "vitest";
import { ComputeBudgetProgram, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { deserializeJupiterSwapTx } from "../src/protocols/jupiter.js";
import { getJupiterV6Program } from "../src/config/contracts.js";
import {
  JUPITER_SWAP_LEGACY_B64,
  JUPITER_SWAP_V0_B64,
} from "./fixtures/jupiter-swap-legacy.b64.js";

describe("src/protocols/jupiter.ts — legacy-tx deserialize + top-level enumeration", () => {
  it("(a) Transaction.from → serializeMessage() bytes are deterministic", () => {
    const a = deserializeJupiterSwapTx(JUPITER_SWAP_LEGACY_B64);
    const b = deserializeJupiterSwapTx(JUPITER_SWAP_LEGACY_B64);
    expect(a.messageBytes).toEqual(b.messageBytes);
    // The bytes equal the canonical serializeMessage() of the pinned tx — the
    // EXACT preimage the FROZEN binding hashes (no mutation before serialize).
    const ref = Transaction.from(Buffer.from(JUPITER_SWAP_LEGACY_B64, "base64"));
    expect([...a.messageBytes]).toEqual([...new Uint8Array(ref.serializeMessage())]);
    expect(a.messageBytes.length).toBe(447);
  });

  it("(b) top-level programIds equals the 14-01-SUMMARY recorded set (SOT getters, no inlined base58)", () => {
    const { programIds } = deserializeJupiterSwapTx(JUPITER_SWAP_LEGACY_B64);
    expect(new Set(programIds)).toEqual(
      new Set([
        getJupiterV6Program(),
        SystemProgram.programId.toBase58(),
        TOKEN_PROGRAM_ID.toBase58(),
        ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
        ComputeBudgetProgram.programId.toBase58(),
      ]),
    );
    // Top-level ONLY — inner CPI DEX hops are NOT enumerated (de-duped set).
    expect(programIds.length).toBe(new Set(programIds).size);
  });

  it("(b2) instructionSummary carries kind:'jupiter' entries (program enumeration for the handle)", () => {
    const { instructionSummary } = deserializeJupiterSwapTx(JUPITER_SWAP_LEGACY_B64);
    expect(instructionSummary.length).toBeGreaterThan(0);
    for (const s of instructionSummary) {
      expect(s.kind).toBe("jupiter");
      expect(typeof s.programId).toBe("string");
    }
    // The Jupiter program ix is present in the summary.
    expect(instructionSummary.some((s) => s.programId === getJupiterV6Program())).toBe(true);
  });

  it("(c) a v0/VersionedTransaction base64 → typed refusal (anti-pattern guard; never silent v0 bytes)", () => {
    expect(() => deserializeJupiterSwapTx(JUPITER_SWAP_V0_B64)).toThrow();
    // The error is typed/identifiable so the caller emits a structured refusal.
    try {
      deserializeJupiterSwapTx(JUPITER_SWAP_V0_B64);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/v0|versioned|legacy/i);
    }
  });

  it("(c2) garbage base64 → throws (never returns malformed message bytes)", () => {
    expect(() => deserializeJupiterSwapTx("not-valid-base64-tx==")).toThrow();
  });
});
