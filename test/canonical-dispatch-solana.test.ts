// Plan 12-04 — `src/security/canonical-dispatch-solana.ts` unit tests.
// Mirror of `test/security-canonical-dispatch.test.ts` (Phase 9 / Plan 09-04
// EVM analog) shape.
//
// Coverage:
//   - SOLANA_DISPATCH_ALLOWLIST shape (Phase 12 base: System + SPL Token +
//     Associated Token Program; Phase 13 Plan 13-01 ADDS MarginFi + Kamino
//     lending program IDs from the contracts SOT — D-06/SOL-W-09) + base58
//     correctness for each entry.
//   - checkSolanaDispatchTarget 2-arm coverage (allowed happy path with
//     System / Token / Associated / MarginFi / Kamino combos + refused with
//     verbatim offenders).
//   - Mixed-input rejection (allowed entries do NOT rescue refusals).
//   - Unknown program ID canaries: Jupiter v6 (Phase 14, still deferred) +
//     a non-canonical MarginFi-shaped base58 (a wrong program ID still refuses
//     — only the SOT-resolved program ID is allowed).
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
import {
  getKaminoLendProgram,
  getKaminoPythReceiverProgram,
  getKaminoScopeProgram,
  getKaminoSwitchboardProgram,
  getMarginfiProgramId,
} from "../src/config/contracts.js";

// Canonical program IDs (re-derived inline so the test does not depend on
// the production import for membership assertions).
const SYSTEM_PROGRAM = SystemProgram.programId.toBase58();
const TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();
const ASSOCIATED_TOKEN_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();

// Phase 13 Plan 13-01 (D-06) — lending program IDs now in the allowlist. Read
// through the SOT getters (the no-inline sentinel forbids inlining the base58
// in src/; tests are exempt but consuming the getter keeps drift impossible).
const MARGINFI_PROGRAM = getMarginfiProgramId();
const KAMINO_LEND_PROGRAM = getKaminoLendProgram();
// Phase 13 Plan 13-05 — auxiliary refresh-ceremony oracle programs (Scope /
// Pyth receiver / Switchboard). Read through the SOT getters (no-inline sentinel).
const KAMINO_SCOPE = getKaminoScopeProgram();
const KAMINO_PYTH = getKaminoPythReceiverProgram();
const KAMINO_SWITCHBOARD = getKaminoSwitchboardProgram();

// Phase 12 base count (System + Token + Associated) + Phase 13 additions
// (MarginFi + Kamino lending) + Phase 13 Plan 13-05 auxiliary oracle programs
// (Scope + Pyth receiver + Switchboard — the Kamino refresh ceremony touches
// these via CPI, Pitfall 5).
const EXPECTED_ALLOWLIST_SIZE = 8;

// Canary program IDs that remain DEFERRED / refused.
//   - Jupiter v6 swap aggregator (Phase 14 widening target) — still deferred.
//   - A non-canonical MarginFi-shaped base58 (NOT the SOT program ID) — proves
//     only the exact SOT-resolved program ID is allowed; a typo/wrong variant
//     still refuses at Layer 0.5.
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const MARGINFI_WRONG_VARIANT = "MFv2hWf31Z9kbCa1snEPYctwafyJfftfPqwXrjBpjpa9";

// ---------------------------------------------------------------------------
// Test 1 — SOLANA_DISPATCH_ALLOWLIST membership (Phase 12 base + Phase 13 lending).
// ---------------------------------------------------------------------------
describe("SOLANA_DISPATCH_ALLOWLIST — membership (Phase 12 base + Phase 13 lending)", () => {
  it(`contains exactly ${EXPECTED_ALLOWLIST_SIZE} entries (3 base + MarginFi + Kamino)`, () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.size).toBe(EXPECTED_ALLOWLIST_SIZE);
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

  it("contains the MarginFi v2 program ID (Phase 13 — from the SOT)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(MARGINFI_PROGRAM)).toBe(true);
  });

  it("contains the Kamino klend program ID (Phase 13 — from the SOT)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(KAMINO_LEND_PROGRAM)).toBe(true);
  });

  it("contains the Kamino Scope oracle program (Phase 13 13-05 refresh ceremony)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(KAMINO_SCOPE)).toBe(true);
  });

  it("contains the Pyth receiver program (Phase 13 13-05 refresh ceremony)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(KAMINO_PYTH)).toBe(true);
  });

  it("contains the Switchboard program (Phase 13 13-05 refresh ceremony)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(KAMINO_SWITCHBOARD)).toBe(true);
  });

  it("does NOT contain Jupiter v6 (Phase 14 deferral)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(JUPITER_V6)).toBe(false);
  });

  it("does NOT contain a non-canonical MarginFi-shaped base58 (only the exact SOT ID allowed)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(MARGINFI_WRONG_VARIANT)).toBe(false);
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

  it("MarginFi program only → allowed (Phase 13 lending write shape)", () => {
    expect(checkSolanaDispatchTarget([MARGINFI_PROGRAM])).toEqual({
      kind: "allowed",
    });
  });

  it("Kamino klend program only → allowed (Phase 13 lending write shape)", () => {
    expect(checkSolanaDispatchTarget([KAMINO_LEND_PROGRAM])).toEqual({
      kind: "allowed",
    });
  });

  it("all base + lending entries together → allowed (defensive coverage)", () => {
    expect(
      checkSolanaDispatchTarget([
        SYSTEM_PROGRAM,
        TOKEN_PROGRAM,
        ASSOCIATED_TOKEN_PROGRAM,
        MARGINFI_PROGRAM,
        KAMINO_LEND_PROGRAM,
      ]),
    ).toEqual({ kind: "allowed" });
  });

  it("empty programIds → allowed (no offenders by construction)", () => {
    expect(checkSolanaDispatchTarget([])).toEqual({ kind: "allowed" });
  });

  it("full Kamino write vector (lending + Scope + Pyth + Switchboard) → allowed (Pitfall 5)", () => {
    // The touched-program set a built Kamino borrow/withdraw tx carries: the
    // lending program (op + refresh ix) + the three refresh-ceremony oracle
    // programs. ALL must be allowlisted or preview falsely refuses at Layer 0.5.
    expect(
      checkSolanaDispatchTarget([
        KAMINO_LEND_PROGRAM,
        KAMINO_SCOPE,
        KAMINO_PYTH,
        KAMINO_SWITCHBOARD,
      ]),
    ).toEqual({ kind: "allowed" });
  });
});

// ---------------------------------------------------------------------------
// Test 2b — a Kamino tx missing one auxiliary program from the allowlist proves
// the allowlist is over the FULL touched set, not just the lending program.
// (Simulated by checking a program NOT in the allowlist alongside the allowed
// set — but here we prove the inverse: removing an aux program from the
// allowlist would name it as an offender. We assert each aux program is
// individually required by checking a tampered/unknown oracle is refused.)
// ---------------------------------------------------------------------------
describe("checkSolanaDispatchTarget — auxiliary-program enforcement (Pitfall 5)", () => {
  it("a Kamino vector with an UNKNOWN oracle (e.g. wrong Switchboard variant) names it as an offender", () => {
    const WRONG_SWITCHBOARD = "SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt640"; // off-by-one
    const result = checkSolanaDispatchTarget([
      KAMINO_LEND_PROGRAM,
      KAMINO_SCOPE,
      KAMINO_PYTH,
      WRONG_SWITCHBOARD,
    ]);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.offenders).toEqual([WRONG_SWITCHBOARD]);
      // the legitimately-allowed entries do NOT rescue the refusal.
      expect(result.offenders).not.toContain(KAMINO_LEND_PROGRAM);
    }
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
    // Allowlist surfaces the verbatim entry list for self-correction.
    expect(result.allowlist).toHaveLength(EXPECTED_ALLOWLIST_SIZE);
    expect(result.allowlist).toContain(SYSTEM_PROGRAM);
    expect(result.allowlist).toContain(TOKEN_PROGRAM);
    expect(result.allowlist).toContain(ASSOCIATED_TOKEN_PROGRAM);
    expect(result.allowlist).toContain(MARGINFI_PROGRAM);
    expect(result.allowlist).toContain(KAMINO_LEND_PROGRAM);
  });

  it("non-canonical MarginFi variant → refused (only the exact SOT ID allowed)", () => {
    const result = checkSolanaDispatchTarget([MARGINFI_WRONG_VARIANT]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([MARGINFI_WRONG_VARIANT]);
  });

  it("System + Jupiter mixed → refused; allowed entry does NOT rescue refusal", () => {
    const result = checkSolanaDispatchTarget([SYSTEM_PROGRAM, JUPITER_V6]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([JUPITER_V6]);
  });

  it("MarginFi + Jupiter mixed → refused; allowed lending entry does NOT rescue", () => {
    const result = checkSolanaDispatchTarget([MARGINFI_PROGRAM, JUPITER_V6]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([JUPITER_V6]);
    expect(result.offenders).not.toContain(MARGINFI_PROGRAM);
  });

  it("Token + Jupiter + wrong-MarginFi mixed → refused; offenders contains BOTH unknowns", () => {
    const result = checkSolanaDispatchTarget([
      TOKEN_PROGRAM,
      JUPITER_V6,
      MARGINFI_WRONG_VARIANT,
    ]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toHaveLength(2);
    expect(result.offenders).toContain(JUPITER_V6);
    expect(result.offenders).toContain(MARGINFI_WRONG_VARIANT);
    // TOKEN is allowed → must NOT be in offenders.
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
