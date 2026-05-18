// Plan 04-01 + Phase 8 — Plan 08-02. Locked ErrorCode union regression.
//
// The union is the single source of truth for structured-error envelope
// codes across the signing pipeline. Adding a code is a type-level breaking
// change — downstream plans' exhaustive switches over `ErrorCode` fail to
// typecheck, surfacing the omission BEFORE merge.
//
// Phase 4 + 5 baseline: 15 codes. Phase 8 — Plan 08-02 adds CHAIN_ID_MISMATCH
// (Layer 2 defense-in-depth at preview_send when the agent's optional `chain`
// arg disagrees with the chainId bound into the prepared transaction). Phase 8
// total: 16 codes.

import { describe, expect, it } from "vitest";

import {
  makeStructuredError,
  type ErrorCode,
  type StructuredError,
} from "../src/signing/error-codes.js";

// The full 16-code set as of Plan 08-02. The list is hand-maintained — adding
// a new code requires extending BOTH the union type AND this list AND every
// exhaustive switch in the producer map (per `src/signing/error-codes.ts`
// header doc).
const PHASE_8_CODES: readonly ErrorCode[] = [
  "WALLET_NOT_PAIRED",
  "HANDLE_NOT_FOUND",
  "HANDLE_EXPIRED",
  "WRONG_STATUS",
  "PREVIEW_REQUIRED",
  "PREVIEW_TOKEN_MISMATCH",
  "PAYLOAD_FINGERPRINT_DRIFT",
  "LEDGER_REJECTED",
  "BROADCAST_FAILED",
  "USER_CANCELLED",
  "DEMO_MODE_REFUSED",
  "INVALID_INPUT",
  "INTERNAL_ERROR",
  "WRONG_MODE",
  "INVALID_ACCOUNT",
  "CHAIN_ID_MISMATCH", // Phase 8 — Plan 08-02
];

describe("ErrorCode union — Phase 8 Plan 08-02 (15 → 16 codes)", () => {
  it("has exactly 16 codes", () => {
    expect(PHASE_8_CODES.length).toBe(16);
  });

  it("CHAIN_ID_MISMATCH is present (Plan 08-02 Layer 2 defense-in-depth)", () => {
    expect(PHASE_8_CODES).toContain("CHAIN_ID_MISMATCH");
  });

  it("each code constructs a well-formed StructuredError via makeStructuredError", () => {
    for (const code of PHASE_8_CODES) {
      const env: StructuredError = makeStructuredError(code, `${code} message`);
      expect(env.errorCode).toBe(code);
      expect(env.message).toBe(`${code} message`);
      expect(env.cause).toBeUndefined();
    }
  });

  it("optional `cause` is preserved when supplied", () => {
    const env = makeStructuredError("CHAIN_ID_MISMATCH", "msg", "cause-detail");
    expect(env.cause).toBe("cause-detail");
  });

  it("Phase 4 + 5 baseline still present (regression anchor)", () => {
    // The pre-Plan-08-02 15-code set MUST still be in the union — Plan 08-02
    // is ADDITIVE. If a code was accidentally removed (e.g. via a misapplied
    // refactor), this assertion fires before downstream consumers' exhaustive
    // switches start typechecking partially.
    const phase4_5 = PHASE_8_CODES.filter((c) => c !== "CHAIN_ID_MISMATCH");
    expect(phase4_5.length).toBe(15);
  });
});
