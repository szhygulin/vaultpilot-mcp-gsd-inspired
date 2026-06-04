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
import { ComputeBudgetProgram, SystemProgram, Transaction } from "@solana/web3.js";
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
  getJupiterV6Program,
  getKaminoLendProgram,
  getKaminoPythReceiverProgram,
  getKaminoScopeProgram,
  getKaminoSwitchboardProgram,
  getMarginfiProgramId,
  getNativeStakeProgram,
  getMarinadeProgram,
  getSplStakePoolProgram,
} from "../src/config/contracts.js";
// Phase 14 Plan 14-01 — the SINGLE pinned Jupiter swap legacy-tx fixture this
// plan OWNS. Decoded ONCE here to enumerate the dispatch allowlist; 14-02 imports
// the identical literal (never a second copy).
import { JUPITER_SWAP_LEGACY_B64 } from "./fixtures/jupiter-swap-legacy.b64.js";

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

// Phase 14 Plan 14-01 — Jupiter v6 program + ComputeBudget (Open-Q1 enumeration).
const JUPITER_V6 = getJupiterV6Program();
const COMPUTE_BUDGET = ComputeBudgetProgram.programId.toBase58();

// Phase 15 Plan 15-01 — native Stake Program (native arm of SOL-W-20).
const NATIVE_STAKE = getNativeStakeProgram();
// Phase 15 Plan 15-02 — Marinade program (Marinade arm of SOL-W-14/15).
const MARINADE_PROGRAM = getMarinadeProgram();
// Phase 15 Plan 15-03 — SPL Stake Pool program (Jito arm of SOL-W-16/20).
const SPL_STAKE_POOL_PROGRAM = getSplStakePoolProgram();

// Phase 12 base count (System + Token + Associated) + Phase 13 additions
// (MarginFi + Kamino lending) + Phase 13 Plan 13-05 auxiliary oracle programs
// (Scope + Pyth receiver + Switchboard) + Phase 14 Plan 14-01 (Jupiter v6 +
// ComputeBudget — the wrapAndUnwrapSol legacy swap top-level set enumerated from
// the single owned fixture decode) + Phase 15 Plan 15-01 (native Stake Program)
// + Phase 15 Plan 15-02 (Marinade program) + Phase 15 Plan 15-03 (SPL Stake Pool).
const EXPECTED_ALLOWLIST_SIZE = 13;

// Canary program IDs that remain refused.
//   - A non-canonical MarginFi-shaped base58 (NOT the SOT program ID) — proves
//     only the exact SOT-resolved program ID is allowed; a typo/wrong variant
//     still refuses at Layer 0.5.
const MARGINFI_WRONG_VARIANT = "MFv2hWf31Z9kbCa1snEPYctwafyJfftfPqwXrjBpjpa9";

// ---------------------------------------------------------------------------
// Test 1 — SOLANA_DISPATCH_ALLOWLIST membership (Phase 12 base + Phase 13 lending).
// ---------------------------------------------------------------------------
describe("SOLANA_DISPATCH_ALLOWLIST — membership (Phase 12 base + Phase 13 lending + Phase 14 Jupiter)", () => {
  it(`contains exactly ${EXPECTED_ALLOWLIST_SIZE} entries (3 base + MarginFi + Kamino×4 + Jupiter + ComputeBudget)`, () => {
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

  it("contains the Jupiter v6 aggregator program ID (Phase 14 — from the SOT)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(JUPITER_V6)).toBe(true);
  });

  it("contains the ComputeBudget program (Phase 14 — Open-Q1 enumeration: top-level in the swap fixture)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(COMPUTE_BUDGET)).toBe(true);
  });

  it("contains the native Stake Program ID (Phase 15 Plan 15-01 — from the SOT)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(NATIVE_STAKE)).toBe(true);
  });

  it("contains the Marinade program ID (Phase 15 Plan 15-02 — from the SOT)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(MARINADE_PROGRAM)).toBe(true);
  });

  it("contains the SPL Stake Pool program ID (Phase 15 Plan 15-03 Jito — from the SOT)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(SPL_STAKE_POOL_PROGRAM)).toBe(true);
  });

  it("does NOT contain a non-canonical MarginFi-shaped base58 (only the exact SOT ID allowed)", () => {
    expect(SOLANA_DISPATCH_ALLOWLIST.has(MARGINFI_WRONG_VARIANT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 15 Plan 15-01 — native Stake Program dispatch arm (SOL-W-20 native).
// The delegate-with-create bundle's programIds = {System, Stake}; BOTH must
// pass. An unknown program in a stake-shaped array still refuses.
// ---------------------------------------------------------------------------
describe("checkSolanaDispatchTarget — native Stake arm (Phase 15 Plan 15-01)", () => {
  it("native Stake Program only → allowed (delegate/deactivate/withdraw shape)", () => {
    expect(checkSolanaDispatchTarget([NATIVE_STAKE])).toEqual({ kind: "allowed" });
  });

  it("delegate-with-create bundle programIds {System, Stake} → both allowed", () => {
    expect(checkSolanaDispatchTarget([SYSTEM_PROGRAM, NATIVE_STAKE])).toEqual({
      kind: "allowed",
    });
  });

  it("an UNKNOWN program alongside the Stake bundle still refuses, naming the offender", () => {
    const UNKNOWN = "EvilProgram1111111111111111111111111111111";
    const result = checkSolanaDispatchTarget([SYSTEM_PROGRAM, NATIVE_STAKE, UNKNOWN]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([UNKNOWN]);
    expect(result.offenders).not.toContain(NATIVE_STAKE);
  });
});

// ---------------------------------------------------------------------------
// Phase 15 Plan 15-02 — Marinade dispatch arm (SOL-W-14/15). The deposit /
// liquidUnstake programIds = {Marinade, System, Token}; ALL must pass. An unknown
// program in a Marinade-shaped array still refuses.
// ---------------------------------------------------------------------------
describe("checkSolanaDispatchTarget — Marinade arm (Phase 15 Plan 15-02)", () => {
  it("Marinade program only → allowed (deposit/liquidUnstake shape)", () => {
    expect(checkSolanaDispatchTarget([MARINADE_PROGRAM])).toEqual({ kind: "allowed" });
  });

  it("Marinade deposit/liquidUnstake programIds {Marinade, System, Token} → all allowed", () => {
    expect(
      checkSolanaDispatchTarget([MARINADE_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM]),
    ).toEqual({ kind: "allowed" });
  });

  it("an UNKNOWN program alongside the Marinade set still refuses, naming the offender", () => {
    const UNKNOWN = "EvilProgram1111111111111111111111111111111";
    const result = checkSolanaDispatchTarget([MARINADE_PROGRAM, TOKEN_PROGRAM, UNKNOWN]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([UNKNOWN]);
    expect(result.offenders).not.toContain(MARINADE_PROGRAM);
  });
});

// ---------------------------------------------------------------------------
// Phase 15 Plan 15-03 — Jito (SPL Stake Pool) dispatch arm (SOL-W-16/20). The
// DepositSol programIds = {SPL Stake Pool, System, Token}; ALL must pass. An
// unknown program in a Jito-shaped array still refuses.
// ---------------------------------------------------------------------------
describe("checkSolanaDispatchTarget — Jito (SPL Stake Pool) arm (Phase 15 Plan 15-03)", () => {
  it("SPL Stake Pool program only → allowed (DepositSol shape)", () => {
    expect(checkSolanaDispatchTarget([SPL_STAKE_POOL_PROGRAM])).toEqual({ kind: "allowed" });
  });

  it("DepositSol programIds {SPL Stake Pool, System, Token} → all allowed", () => {
    expect(
      checkSolanaDispatchTarget([SPL_STAKE_POOL_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM]),
    ).toEqual({ kind: "allowed" });
  });

  it("an UNKNOWN program alongside the Jito set still refuses, naming the offender", () => {
    const UNKNOWN = "EvilProgram1111111111111111111111111111111";
    const result = checkSolanaDispatchTarget([SPL_STAKE_POOL_PROGRAM, TOKEN_PROGRAM, UNKNOWN]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([UNKNOWN]);
    expect(result.offenders).not.toContain(SPL_STAKE_POOL_PROGRAM);
  });
});

// ---------------------------------------------------------------------------
// Test 1b — Phase 14 Open-Q1: derive the top-level program set FROM the single
// pinned decode this plan OWNS (NOT guessed). The enumerated wrap/unwrap set the
// fixture emits MUST be `allowed`; an unknown program ID still refuses.
// ---------------------------------------------------------------------------
describe("SOLANA_DISPATCH_ALLOWLIST — Phase 14 Jupiter swap fixture enumeration (Open Q1)", () => {
  // Decode the SINGLE owned fixture ONCE; derive the top-level program set.
  const decoded = Transaction.from(Buffer.from(JUPITER_SWAP_LEGACY_B64, "base64"));
  const topLevelPrograms = [
    ...new Set(decoded.instructions.map((ix) => ix.programId.toBase58())),
  ];

  it("the decoded top-level set is exactly { ComputeBudget, ATA, System, Token, Jupiter v6 }", () => {
    expect(new Set(topLevelPrograms)).toEqual(
      new Set([
        COMPUTE_BUDGET,
        ASSOCIATED_TOKEN_PROGRAM,
        SYSTEM_PROGRAM,
        TOKEN_PROGRAM,
        JUPITER_V6,
      ]),
    );
  });

  it("the full enumerated wrap/unwrap top-level set is allowed (no false refusal at preview)", () => {
    expect(checkSolanaDispatchTarget(topLevelPrograms)).toEqual({
      kind: "allowed",
    });
  });

  it("checkSolanaDispatchTarget([Jupiter v6]) → allowed", () => {
    expect(checkSolanaDispatchTarget([JUPITER_V6])).toEqual({ kind: "allowed" });
  });

  it("an unknown program ID alongside the enumerated set still refuses (with that pid in offenders)", () => {
    const UNKNOWN = "EvilProgram1111111111111111111111111111111";
    const result = checkSolanaDispatchTarget([...topLevelPrograms, UNKNOWN]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([UNKNOWN]);
    expect(result.offenders).not.toContain(JUPITER_V6);
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

  it("Jupiter v6 only → allowed (Phase 14 swap write shape)", () => {
    expect(checkSolanaDispatchTarget([JUPITER_V6])).toEqual({
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
  // Phase 14: Jupiter v6 is now ALLOWED — the unknown-program canary is a
  // genuinely-unknown program ID (NOT a real protocol target).
  const UNKNOWN_PROGRAM = "EvilProgram1111111111111111111111111111111";

  it("unknown program only → refused with verbatim offender (Layer 0.5 canary)", () => {
    const result = checkSolanaDispatchTarget([UNKNOWN_PROGRAM]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([UNKNOWN_PROGRAM]);
    // Allowlist surfaces the verbatim entry list for self-correction.
    expect(result.allowlist).toHaveLength(EXPECTED_ALLOWLIST_SIZE);
    expect(result.allowlist).toContain(SYSTEM_PROGRAM);
    expect(result.allowlist).toContain(TOKEN_PROGRAM);
    expect(result.allowlist).toContain(ASSOCIATED_TOKEN_PROGRAM);
    expect(result.allowlist).toContain(MARGINFI_PROGRAM);
    expect(result.allowlist).toContain(KAMINO_LEND_PROGRAM);
    expect(result.allowlist).toContain(JUPITER_V6);
    expect(result.allowlist).toContain(COMPUTE_BUDGET);
  });

  it("non-canonical MarginFi variant → refused (only the exact SOT ID allowed)", () => {
    const result = checkSolanaDispatchTarget([MARGINFI_WRONG_VARIANT]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([MARGINFI_WRONG_VARIANT]);
  });

  it("System + unknown mixed → refused; allowed entry does NOT rescue refusal", () => {
    const result = checkSolanaDispatchTarget([SYSTEM_PROGRAM, UNKNOWN_PROGRAM]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([UNKNOWN_PROGRAM]);
  });

  it("Jupiter + unknown mixed → refused; allowed Jupiter entry does NOT rescue", () => {
    const result = checkSolanaDispatchTarget([JUPITER_V6, UNKNOWN_PROGRAM]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toEqual([UNKNOWN_PROGRAM]);
    expect(result.offenders).not.toContain(JUPITER_V6);
  });

  it("Token + unknown + wrong-MarginFi mixed → refused; offenders contains BOTH unknowns", () => {
    const result = checkSolanaDispatchTarget([
      TOKEN_PROGRAM,
      UNKNOWN_PROGRAM,
      MARGINFI_WRONG_VARIANT,
    ]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.offenders).toHaveLength(2);
    expect(result.offenders).toContain(UNKNOWN_PROGRAM);
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
      const UNKNOWN = "EvilProgram1111111111111111111111111111111";
      const result = _canonicalDispatchSolana.checkSolanaDispatchTarget([
        UNKNOWN, // would normally refuse
      ]);
      expect(result).toEqual({ kind: "allowed" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith([UNKNOWN]);
    } finally {
      spy.mockRestore();
    }
  });
});
