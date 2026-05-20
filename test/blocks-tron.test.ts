// test/blocks-tron.test.ts — Phase 18 Plan 18-01.
//
// Substitution + slot-pin regression for the 7 TRON template constants in
// `src/signing/blocks-tron.ts`. Mirrors the shape of `test/blocks-solana.test.ts`.
//
// Two regression axes per template:
//   1. Substitution: every slot is replaced with a sentinel string; the result
//      contains the sentinel verbatim.
//   2. Format-fanout-sentinel anti-inline: asserts the template header string
//      is present in `blocks-tron.ts` itself (canonical location) and NOT in
//      any other source file (catches copy-paste inlining at consumer sites).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  KNOWN_SPENDER_LABEL_TRON_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE,
  LEDGER_NOTICE_TRON_TEMPLATE,
  NO_SIMULATION_AVAILABLE_TRON_TEMPLATE,
  PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE,
  PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE,
  PREPARE_RECEIPT_TRON_TRC20_TEMPLATE,
  SIMULATION_BLOCK_TRON_TEMPLATE,
  UNLIMITED_APPROVAL_TRON_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
} from "../src/signing/blocks-tron.js";

// ============================================================================
// Helper: assert the given header string appears in the canonical file and
// NOT in other source files (format-fanout-sentinel discipline).
// ============================================================================

const WT_ROOT = join(import.meta.url.replace("file://", ""), "../..");
// Resolve relative to the test file location (test/ → project root)
const PROJECT_ROOT = join(
  new URL(import.meta.url).pathname,
  "..",
  "..",
);

function readSourceFile(relPath: string): string {
  return readFileSync(join(PROJECT_ROOT, relPath), "utf8");
}

const CANONICAL_FILE = readSourceFile("src/signing/blocks-tron.ts");

// Source files to check for inlining (exclude the canonical file itself and tests).
// We check a representative subset of likely consumer sites from Plans 18-02..18-04.
const CONSUMER_FILES_TO_CHECK = [
  "src/tools/preview_send.ts",
  "src/tools/send_transaction.ts",
  "src/tools/get_tx_verification.ts",
];

function assertNotInlinedInConsumerFiles(headerSubstring: string): void {
  for (const relPath of CONSUMER_FILES_TO_CHECK) {
    let content: string;
    try {
      content = readSourceFile(relPath);
    } catch {
      // File may not exist yet (Plans 18-02..18-04 ship it); skip if absent.
      continue;
    }
    if (content.includes(headerSubstring)) {
      throw new Error(
        `Format-fanout violation: header "${headerSubstring}" found inlined in ${relPath}. ` +
          "Consumers must import from blocks-tron.ts and substitute slots at call time.",
      );
    }
  }
}

// ============================================================================
// Template 1 — PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE
// ============================================================================
describe("PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE", () => {
  it("substitution: all slots replaced with sentinels produce expected output", () => {
    const result = PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE
      .replace("{TO}", "<TO-SENTINEL>")
      .replace("{SUN}", "<SUN-SENTINEL>")
      .replace("{REF_BLOCK_BYTES}", "<REF_BLOCK_BYTES-SENTINEL>")
      .replace("{REF_BLOCK_HASH}", "<REF_BLOCK_HASH-SENTINEL>")
      .replace("{EXPIRATION}", "<EXPIRATION-SENTINEL>");

    expect(result).toContain("<TO-SENTINEL>");
    expect(result).toContain("<SUN-SENTINEL>");
    expect(result).toContain("<REF_BLOCK_BYTES-SENTINEL>");
    expect(result).toContain("<REF_BLOCK_HASH-SENTINEL>");
    expect(result).toContain("<EXPIRATION-SENTINEL>");
    expect(result).toContain("PREPARE RECEIPT (TRON — native transfer)");
    expect(result).toContain("TRON mainnet");
  });

  it("slot-pin: all expected slots are present in the template", () => {
    expect(PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE).toContain("{TO}");
    expect(PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE).toContain("{SUN}");
    expect(PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE).toContain("{REF_BLOCK_BYTES}");
    expect(PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE).toContain("{REF_BLOCK_HASH}");
    expect(PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE).toContain("{EXPIRATION}");
  });

  it("format-fanout-sentinel: header present in canonical file", () => {
    expect(CANONICAL_FILE).toContain(
      "PREPARE RECEIPT (TRON — native transfer)",
    );
  });

  it("format-fanout-sentinel: header NOT inlined in consumer source files", () => {
    assertNotInlinedInConsumerFiles("PREPARE RECEIPT (TRON — native transfer)");
  });
});

// ============================================================================
// Template 2 — PREPARE_RECEIPT_TRON_TRC20_TEMPLATE
// ============================================================================
describe("PREPARE_RECEIPT_TRON_TRC20_TEMPLATE", () => {
  it("substitution: all slots replaced with sentinels produce expected output", () => {
    const result = PREPARE_RECEIPT_TRON_TRC20_TEMPLATE
      .replace("{TO}", "<TO-SENTINEL>")
      .replace("{TOKEN_ADDRESS}", "<TOKEN_ADDRESS-SENTINEL>")
      .replace("{AMOUNT}", "<AMOUNT-SENTINEL>")
      .replace("{REF_BLOCK_BYTES}", "<REF_BLOCK_BYTES-SENTINEL>")
      .replace("{REF_BLOCK_HASH}", "<REF_BLOCK_HASH-SENTINEL>")
      .replace("{EXPIRATION}", "<EXPIRATION-SENTINEL>");

    expect(result).toContain("<TO-SENTINEL>");
    expect(result).toContain("<TOKEN_ADDRESS-SENTINEL>");
    expect(result).toContain("<AMOUNT-SENTINEL>");
    expect(result).toContain("<REF_BLOCK_BYTES-SENTINEL>");
    expect(result).toContain("<REF_BLOCK_HASH-SENTINEL>");
    expect(result).toContain("<EXPIRATION-SENTINEL>");
    expect(result).toContain("PREPARE RECEIPT (TRON — TRC-20 transfer)");
  });

  it("slot-pin: all expected slots present", () => {
    expect(PREPARE_RECEIPT_TRON_TRC20_TEMPLATE).toContain("{TO}");
    expect(PREPARE_RECEIPT_TRON_TRC20_TEMPLATE).toContain("{TOKEN_ADDRESS}");
    expect(PREPARE_RECEIPT_TRON_TRC20_TEMPLATE).toContain("{AMOUNT}");
    expect(PREPARE_RECEIPT_TRON_TRC20_TEMPLATE).toContain("{REF_BLOCK_BYTES}");
    expect(PREPARE_RECEIPT_TRON_TRC20_TEMPLATE).toContain("{REF_BLOCK_HASH}");
    expect(PREPARE_RECEIPT_TRON_TRC20_TEMPLATE).toContain("{EXPIRATION}");
  });

  it("format-fanout-sentinel: header present in canonical file", () => {
    expect(CANONICAL_FILE).toContain("PREPARE RECEIPT (TRON — TRC-20 transfer)");
  });

  it("format-fanout-sentinel: header NOT inlined in consumer source files", () => {
    assertNotInlinedInConsumerFiles("PREPARE RECEIPT (TRON — TRC-20 transfer)");
  });
});

// ============================================================================
// Template 3 — LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE
// ============================================================================
describe("LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE", () => {
  it("substitution: slots replaced produce expected output", () => {
    const result = LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE
      .replace("{HASH_FULL_64HEX}", "<HASH_FULL_SENTINEL>")
      .replace("{HASH_CHUNKED_4_CHAR_GROUPS}", "<HASH_CHUNKED_SENTINEL>");

    expect(result).toContain("<HASH_FULL_SENTINEL>");
    expect(result).toContain("<HASH_CHUNKED_SENTINEL>");
    expect(result).toContain("LEDGER BLIND-SIGN HASH (TRON)");
    expect(result).toContain("Transaction ID");
    expect(result).toContain("SHA-256");
  });

  it("slot-pin: both hash slots present", () => {
    expect(LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE).toContain("{HASH_FULL_64HEX}");
    expect(LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE).toContain("{HASH_CHUNKED_4_CHAR_GROUPS}");
  });

  it("format-fanout-sentinel: header present in canonical file", () => {
    expect(CANONICAL_FILE).toContain("LEDGER BLIND-SIGN HASH (TRON)");
  });

  it("format-fanout-sentinel: header NOT inlined in consumer source files", () => {
    assertNotInlinedInConsumerFiles("LEDGER BLIND-SIGN HASH (TRON)");
  });
});

// ============================================================================
// Template 4 — LEDGER_NOTICE_TRON_TEMPLATE
// ============================================================================
describe("LEDGER_NOTICE_TRON_TEMPLATE", () => {
  it("substitution: slots replaced produce expected output", () => {
    const result = LEDGER_NOTICE_TRON_TEMPLATE
      .replace("{INSTRUCTION_NAME}", "<INSTRUCTION_SENTINEL>")
      .replace("{REGISTRY_STATUS}", "<REGISTRY_STATUS_SENTINEL>");

    expect(result).toContain("<INSTRUCTION_SENTINEL>");
    expect(result).toContain("<REGISTRY_STATUS_SENTINEL>");
    expect(result).toContain("LEDGER NOTICE (TRON)");
    expect(result).toContain("Blind signing");
  });

  it("slot-pin: both slots present", () => {
    expect(LEDGER_NOTICE_TRON_TEMPLATE).toContain("{INSTRUCTION_NAME}");
    expect(LEDGER_NOTICE_TRON_TEMPLATE).toContain("{REGISTRY_STATUS}");
  });

  it("format-fanout-sentinel: header present in canonical file", () => {
    expect(CANONICAL_FILE).toContain("LEDGER NOTICE (TRON)");
  });

  it("format-fanout-sentinel: header NOT inlined in consumer source files", () => {
    assertNotInlinedInConsumerFiles("LEDGER NOTICE (TRON)");
  });
});

// ============================================================================
// Template 5 — SIMULATION_BLOCK_TRON_TEMPLATE
// ============================================================================
describe("SIMULATION_BLOCK_TRON_TEMPLATE", () => {
  it("substitution: slots replaced produce expected output", () => {
    const result = SIMULATION_BLOCK_TRON_TEMPLATE
      .replace("{STATUS}", "<STATUS-SENTINEL>")
      .replace("{REVERT_REASON}", "<REVERT_REASON-SENTINEL>")
      .replace("{ENERGY_USED}", "<ENERGY_USED-SENTINEL>")
      .replace("{CONSTANT_RESULT_PREVIEW}", "<CONSTANT_RESULT-SENTINEL>");

    expect(result).toContain("<STATUS-SENTINEL>");
    expect(result).toContain("<REVERT_REASON-SENTINEL>");
    expect(result).toContain("<ENERGY_USED-SENTINEL>");
    expect(result).toContain("<CONSTANT_RESULT-SENTINEL>");
    expect(result).toContain("CHECKS PERFORMED (TRON simulation — Layer 0.7)");
    expect(result).toContain("SIMULATION_REFUSED");
    expect(result).toContain("DF-3");
  });

  it("slot-pin: all expected slots present", () => {
    expect(SIMULATION_BLOCK_TRON_TEMPLATE).toContain("{STATUS}");
    expect(SIMULATION_BLOCK_TRON_TEMPLATE).toContain("{REVERT_REASON}");
    expect(SIMULATION_BLOCK_TRON_TEMPLATE).toContain("{ENERGY_USED}");
    expect(SIMULATION_BLOCK_TRON_TEMPLATE).toContain("{CONSTANT_RESULT_PREVIEW}");
  });

  it("format-fanout-sentinel: header present in canonical file", () => {
    expect(CANONICAL_FILE).toContain("CHECKS PERFORMED (TRON simulation — Layer 0.7)");
  });

  it("format-fanout-sentinel: header NOT inlined in consumer source files", () => {
    assertNotInlinedInConsumerFiles("CHECKS PERFORMED (TRON simulation — Layer 0.7)");
  });
});

// ============================================================================
// Template 6 — NO_SIMULATION_AVAILABLE_TRON_TEMPLATE
// ============================================================================
describe("NO_SIMULATION_AVAILABLE_TRON_TEMPLATE", () => {
  it("is a constant-prose template with no slots", () => {
    // No substitution needed — pure informational block for native TRX.
    expect(NO_SIMULATION_AVAILABLE_TRON_TEMPLATE).not.toContain("{");
    expect(NO_SIMULATION_AVAILABLE_TRON_TEMPLATE).not.toContain("}");
    expect(NO_SIMULATION_AVAILABLE_TRON_TEMPLATE).toContain(
      "CHECKS PERFORMED (TRON — no simulation available)",
    );
    expect(NO_SIMULATION_AVAILABLE_TRON_TEMPLATE).toContain("TransferContract");
    expect(NO_SIMULATION_AVAILABLE_TRON_TEMPLATE).toContain("PREPARE RECEIPT");
    expect(NO_SIMULATION_AVAILABLE_TRON_TEMPLATE).toContain("LEDGER BLIND-SIGN HASH");
  });

  it("format-fanout-sentinel: header present in canonical file", () => {
    expect(CANONICAL_FILE).toContain(
      "CHECKS PERFORMED (TRON — no simulation available)",
    );
  });

  it("format-fanout-sentinel: header NOT inlined in consumer source files", () => {
    assertNotInlinedInConsumerFiles("CHECKS PERFORMED (TRON — no simulation available)");
  });
});

// ============================================================================
// Template 7 — VERIFY_BEFORE_SIGNING_TRON_TEMPLATE
// ============================================================================
describe("VERIFY_BEFORE_SIGNING_TRON_TEMPLATE", () => {
  it("is a constant-prose template with no slots", () => {
    // No substitution needed — constant user guidance block.
    expect(VERIFY_BEFORE_SIGNING_TRON_TEMPLATE).not.toContain("{");
    expect(VERIFY_BEFORE_SIGNING_TRON_TEMPLATE).not.toContain("}");
    expect(VERIFY_BEFORE_SIGNING_TRON_TEMPLATE).toContain("VERIFY BEFORE SIGNING");
    expect(VERIFY_BEFORE_SIGNING_TRON_TEMPLATE).toContain("Network: TRON mainnet");
    expect(VERIFY_BEFORE_SIGNING_TRON_TEMPLATE).toContain("Transaction ID");
    expect(VERIFY_BEFORE_SIGNING_TRON_TEMPLATE).toContain("PREPARE RECEIPT");
    expect(VERIFY_BEFORE_SIGNING_TRON_TEMPLATE).toContain("LEDGER BLIND-SIGN HASH");
  });

  it("format-fanout-sentinel: header present in canonical file", () => {
    expect(CANONICAL_FILE).toContain("VERIFY BEFORE SIGNING");
  });

  it("format-fanout-sentinel: header NOT inlined in consumer source files", () => {
    assertNotInlinedInConsumerFiles("Network: TRON mainnet");
  });
});

// ============================================================================
// Cross-template distinctions
// ============================================================================
describe("Cross-template distinctness regression", () => {
  it("all 7 Phase 18 templates are distinct strings (no accidental duplication)", () => {
    const templates = [
      PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE,
      PREPARE_RECEIPT_TRON_TRC20_TEMPLATE,
      LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE,
      LEDGER_NOTICE_TRON_TEMPLATE,
      SIMULATION_BLOCK_TRON_TEMPLATE,
      NO_SIMULATION_AVAILABLE_TRON_TEMPLATE,
      VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
    ];
    const unique = new Set(templates);
    expect(unique.size).toBe(7);
  });
});

// ============================================================================
// Phase 19 Plan 19-01 — APPEND-ONLY templates
// ============================================================================

// ============================================================================
// Template 8 — PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE
// ============================================================================
describe("PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE — Phase 19 Plan 19-01", () => {
  it("substitution: all slots replaced with sentinels produce expected output", () => {
    const result = PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE
      .replace("{CHAIN}", "<CHAIN-SENTINEL>")
      .replace("{TOKEN}", "<TOKEN-SENTINEL>")
      .replace("{SPENDER}", "<SPENDER-SENTINEL>")
      .replace("{AMOUNT}", "<AMOUNT-SENTINEL>")
      .replace("{REF_BLOCK_BYTES}", "<REF_BLOCK_BYTES-SENTINEL>")
      .replace("{REF_BLOCK_HASH}", "<REF_BLOCK_HASH-SENTINEL>")
      .replace("{EXPIRATION}", "<EXPIRATION-SENTINEL>");

    expect(result).toContain("<CHAIN-SENTINEL>");
    expect(result).toContain("<TOKEN-SENTINEL>");
    expect(result).toContain("<SPENDER-SENTINEL>");
    expect(result).toContain("<AMOUNT-SENTINEL>");
    expect(result).toContain("<REF_BLOCK_BYTES-SENTINEL>");
    expect(result).toContain("<REF_BLOCK_HASH-SENTINEL>");
    expect(result).toContain("<EXPIRATION-SENTINEL>");
    expect(result).toContain("PREPARE RECEIPT (TRON — TRC-20 approve)");
  });

  it("slot-pin: all expected slots are present in the template", () => {
    expect(PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE).toContain("{CHAIN}");
    expect(PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE).toContain("{TOKEN}");
    expect(PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE).toContain("{SPENDER}");
    expect(PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE).toContain("{AMOUNT}");
    expect(PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE).toContain("{REF_BLOCK_BYTES}");
    expect(PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE).toContain("{REF_BLOCK_HASH}");
    expect(PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE).toContain("{EXPIRATION}");
  });

  it("slot naming: uses {TOKEN} and {SPENDER} (NOT {TOKEN_ADDRESS} or {TO})", () => {
    // The approve template uses {TOKEN}/{SPENDER} slot names, NOT {TOKEN_ADDRESS}/{TO}
    // (which are the TRC-20 transfer template's slot names). Regression anchor.
    expect(PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE).not.toContain("{TOKEN_ADDRESS}");
    expect(PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE).not.toContain("{TO}");
  });

  it("format-fanout-sentinel: header present in canonical file", () => {
    expect(CANONICAL_FILE).toContain("PREPARE RECEIPT (TRON — TRC-20 approve)");
  });

  it("format-fanout-sentinel: header NOT inlined in consumer source files", () => {
    assertNotInlinedInConsumerFiles("PREPARE RECEIPT (TRON — TRC-20 approve)");
  });
});

// ============================================================================
// Template 9 — UNLIMITED_APPROVAL_TRON_TEMPLATE
// ============================================================================
describe("UNLIMITED_APPROVAL_TRON_TEMPLATE — Phase 19 Plan 19-01", () => {
  it("substitution: slots replaced produce expected output", () => {
    const result = UNLIMITED_APPROVAL_TRON_TEMPLATE
      .replaceAll("{TOKEN}", "<TOKEN-SENTINEL>")
      .replaceAll("{SPENDER}", "<SPENDER-SENTINEL>");

    expect(result).toContain("<TOKEN-SENTINEL>");
    expect(result).toContain("<SPENDER-SENTINEL>");
    expect(result).toContain("⚠ UNLIMITED APPROVAL (TRON)");
    expect(result).toContain("prepare_tron_revoke_approval");
    expect(result).toContain("MAX_UINT256");
  });

  it("slot-pin: {TOKEN} and {SPENDER} slots present (used multiple times)", () => {
    expect(UNLIMITED_APPROVAL_TRON_TEMPLATE).toContain("{TOKEN}");
    expect(UNLIMITED_APPROVAL_TRON_TEMPLATE).toContain("{SPENDER}");
  });

  it("revoke hint present — directs user to prepare_tron_revoke_approval", () => {
    expect(UNLIMITED_APPROVAL_TRON_TEMPLATE).toContain("prepare_tron_revoke_approval");
  });

  it("format-fanout-sentinel: header present in canonical file", () => {
    expect(CANONICAL_FILE).toContain("⚠ UNLIMITED APPROVAL (TRON)");
  });

  it("format-fanout-sentinel: header NOT inlined in consumer source files", () => {
    assertNotInlinedInConsumerFiles("⚠ UNLIMITED APPROVAL (TRON)");
  });
});

// ============================================================================
// Template 10 — KNOWN_SPENDER_LABEL_TRON_TEMPLATE
// ============================================================================
describe("KNOWN_SPENDER_LABEL_TRON_TEMPLATE — Phase 19 Plan 19-01", () => {
  it("substitution: all slots replaced with sentinels produce expected output", () => {
    const result = KNOWN_SPENDER_LABEL_TRON_TEMPLATE
      .replace("{SPENDER}", "<SPENDER-SENTINEL>")
      .replace("{LABEL}", "<LABEL-SENTINEL>")
      .replace("{SOURCE}", "<SOURCE-SENTINEL>");

    expect(result).toContain("<SPENDER-SENTINEL>");
    expect(result).toContain("<LABEL-SENTINEL>");
    expect(result).toContain("<SOURCE-SENTINEL>");
    expect(result).toContain("SPENDER LABEL (TRON)");
  });

  it("slot-pin: all expected slots are present in the template", () => {
    expect(KNOWN_SPENDER_LABEL_TRON_TEMPLATE).toContain("{SPENDER}");
    expect(KNOWN_SPENDER_LABEL_TRON_TEMPLATE).toContain("{LABEL}");
    expect(KNOWN_SPENDER_LABEL_TRON_TEMPLATE).toContain("{SOURCE}");
  });

  it("format-fanout-sentinel: header present in canonical file", () => {
    expect(CANONICAL_FILE).toContain("SPENDER LABEL (TRON)");
  });

  it("format-fanout-sentinel: header NOT inlined in consumer source files", () => {
    assertNotInlinedInConsumerFiles("SPENDER LABEL (TRON)");
  });
});

// ============================================================================
// Phase 19 cross-template: all 10 templates are distinct
// ============================================================================
describe("All 10 templates (Phase 18 + Phase 19) distinctness", () => {
  it("all 10 templates are distinct strings", () => {
    const all = [
      PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE,
      PREPARE_RECEIPT_TRON_TRC20_TEMPLATE,
      LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE,
      LEDGER_NOTICE_TRON_TEMPLATE,
      SIMULATION_BLOCK_TRON_TEMPLATE,
      NO_SIMULATION_AVAILABLE_TRON_TEMPLATE,
      VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
      PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE,
      UNLIMITED_APPROVAL_TRON_TEMPLATE,
      KNOWN_SPENDER_LABEL_TRON_TEMPLATE,
    ];
    const unique = new Set(all);
    expect(unique.size).toBe(10);
  });
});
