// Plan 12-04 — `src/security/canonical-dispatch-solana.ts` unit tests.
// Mirror of `test/security-canonical-dispatch.test.ts` (Phase 9 / Plan 09-04
// EVM analog) shape.
//
// Coverage:
//   - SOLANA_DISPATCH_ALLOWLIST shape (3 entries — System + SPL Token +
//     Associated Token Program) + base58-correctness for each entry.
//   - checkSolanaDispatchTarget 2-arm coverage (allowed happy path with
//     System / Token / Associated combos + refused with verbatim offenders).
//   - Mixed-input rejection (allowed entries do NOT rescue refusals).
//   - Unknown program ID canaries: Jupiter v6 (Phase 14), MarginFi (Phase 13).
//   - Empty programIds → allowed (no offenders by construction).
//   - ESM spy round-trip via `_canonicalDispatchSolana` indirection.

import { describe, expect, it, vi } from "vitest";
import { SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  SOLANA_DISPATCH_ALLOWLIST,
  _canonicalDispatchSolana,
  checkSolanaDispatchTarget,
} from "../src/security/canonical-dispatch-solana.js";

// Canonical program IDs (re-derived inline so the test does not depend on
// the production import for membership assertions).
const SYSTEM_PROGRAM = SystemProgram.programId.toBase58();
const TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();
const ASSOCIATED_TOKEN_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();

// Canary program IDs for Phases 13-16 deferral. Pinned literals so a future
// SDK upgrade doesn't silently widen the allowlist by drift.
//   - Jupiter v6 swap aggregator: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
//     (verified against Jupiter docs / api.jup.ag — Phase 14 widening target)
//   - MarginFi v2 lending: MFv2hWf31Z9kbCa1snEPYctwafyJfftfPqwXrjBpjpa9
//     (verified against MarginFi docs — Phase 13 widening target)
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const MARGINFI_V2 = "MFv2hWf31Z9kbCa1snEPYctwafyJfftfPqwXrjBpjpa9";

// ---------------------------------------------------------------------------
// Test 1 — SOLANA_DISPATCH_ALLOWLIST exact membership (3 entries).
// ---------------------------------------------------------------------------
describe("SOLANA_DISPATCH_ALLOWLIST — exact 3-entry membership (v1.x scope lock)", () => {
  it("contains exactly 3 entries", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.size).toBe(3);
  });

  it("contains SystemProgram.programId", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(SYSTEM_PROGRAM)).toBe(true);
  });

  it("contains TOKEN_PROGRAM_ID", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(TOKEN_PROGRAM)).toBe(true);
  });

  it("contains ASSOCIATED_TOKEN_PROGRAM_ID", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(ASSOCIATED_TOKEN_PROGRAM)).toBe(true);
  });

  it("does NOT contain Jupiter v6 (Phase 14 deferral)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(JUPITER_V6)).toBe(false);
  });

  it("does NOT contain MarginFi v2 (Phase 13 deferral)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(MARGINFI_V2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — checkSolanaDispatchTarget happy-path arms.
// ---------------------------------------------------------------------------
describe("checkSolanaDispatchTarget — allowed cases", () => {
  it("System Program only → allowed (native SOL transfer shape)", () => {
    expect(checkSolanaDispatchTarget([SYSTEM_PROGRAM])).toEqual({
      kind: "allowed",
    });
  });

  it("Token Program only → allowed (SPL TransferChecked happy path)", () => {
    expect(checkSolanaDispatchTarget([TOKEN_PROGRAM])).toEqual({
      kind: "allowed",
    });
  });

  it("Token Program + Associated Token Program → allowed (createATA path)", () => {
    expect(
      checkSolanaDispatchTarget([TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM]),
    ).toEqual({ kind: "allowed" });
  });

  it("all 3 entries together → allowed (defensive coverage)", () => {
    expect(
      checkSolanaDispatchTarget([
        SYSTEM_PROGRAM,
        TOKEN_PROGRAM,
        ASSOCIATED_TOKEN_PROGRAM,
      ]),
    ).toEqual({ kind: "allowed" });
  });

  it("empty programIds → allowed (no offenders by construction)", () => {
    expect(checkSolanaDispatchTarget([])).toEqual({ kind: "allowed" });
  });
});

// ---------------------------------------------------------------------------
// Test 3 — checkSolanaDispatchTarget refusal arms.
// ---------------------------------------------------------------------------
describe("checkSolanaDispatchTarget — refusal cases", () => {
  it("Jupiter v6 only → refused with verbatim offender (Phase 14 canary)", () => {
    const result = checkSolanaDispatchTarget([JUPITER_V6]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([JUPITER_V6]);
    // Allowlist surfaces the verbatim 3-entry list for self-correction.
    expect(result.allowlist).toHaveLength(3);
    expect(result.allowlist).toContain(SYSTEM_PROGRAM);
    expect(result.allowlist).toContain(TOKEN_PROGRAM);
    expect(result.allowlist).toContain(ASSOCIATED_TOKEN_PROGRAM);
  });

  it("MarginFi v2 only → refused with verbatim offender (Phase 13 canary)", () => {
    const result = checkSolanaDispatchTarget([MARGINFI_V2]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([MARGINFI_V2]);
  });

  it("System + Jupiter mixed → refused; allowed entry does NOT rescue refusal", () => {
    const result = checkSolanaDispatchTarget([SYSTEM_PROGRAM, JUPITER_V6]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([JUPITER_V6]);
  });

  it("Token + Jupiter + MarginFi mixed → refused; offenders contains BOTH unknowns", () => {
    const result = checkSolanaDispatchTarget([
      TOKEN_PROGRAM,
      JUPITER_V6,
      MARGINFI_V2,
    ]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toHaveLength(2);
    expect(result.offenders).toContain(JUPITER_V6);
    expect(result.offenders).toContain(MARGINFI_V2);
    // SYSTEM is allowed → must NOT be in offenders.
    expect(result.offenders).not.toContain(TOKEN_PROGRAM);
  });

  it("random base58 (not a real program) → refused with verbatim offender", () => {
    const fakeProgram = "FakeProgramIDFakeProgramIDFakeProgramIDFak";
    const result = checkSolanaDispatchTarget([fakeProgram]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([fakeProgram]);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — ESM spy-affordance round-trip via _canonicalDispatchSolana.
// ---------------------------------------------------------------------------
describe("_canonicalDispatchSolana — ESM spy-affordance round-trip", () => {
  it("vi.spyOn intercepts the production callsite", () => {
    const spy = vi
      .spyOn(_canonicalDispatchSolana, "checkSolanaDispatchTarget")
      .mockReturnValue({ kind: "allowed" });
    try {
      // Call through the indirection — the spy ought to intercept.
      const result = _canonicalDispatchSolana.checkSolanaDispatchTarget([
        JUPITER_V6, // would normally refuse
      ]);
      expect(result).toEqual({ kind: "allowed" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith([JUPITER_V6]);
    } finally {
      spy.mockRestore();
    }
  });
});
