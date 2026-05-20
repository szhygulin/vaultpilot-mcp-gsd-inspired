// Solana block-template slot-pin + substitution regression. Phase 12 — Plan 12-01.
// Sibling of `test/signing-blocks.test.ts` (EVM). Format-fanout-sentinel
// discipline — every Solana block rendered from `src/signing/blocks-solana.ts`;
// the substitution sites in `prepare_solana_*` / `preview_send` / `send_transaction`
// (Waves 2-5) import these constants and call `.replace("{SLOT}", value)`.
//
// What this file proves at Plan 12-01:
//   1. Each template carries the slot markers the downstream substitution
//      sites will rely on (count = 1 per slot — drift = test fail).
//   2. Headers are byte-identical to the SOT (`PREPARE RECEIPT (Solana — …)`,
//      `LEDGER BLIND-SIGN HASH (Solana)`, etc.) so a regex-based agent /
//      preflight skill parser can stably extract the block.
//   3. The Solana-specific surfaces (`Network: Solana mainnet-beta`,
//      `"Message Hash"` on-device label) are present where they belong.

import { describe, expect, it } from "vitest";

import {
  LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE,
  LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE,
  PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE,
  PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE,
  SIMULATION_BLOCK_SOLANA_TEMPLATE,
  VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE,
} from "../src/signing/blocks-solana.js";

/**
 * Helper — count exact-string occurrences of `needle` in `haystack`.
 * Uses split rather than regex to avoid escape pitfalls with `{` / `}`.
 */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE — slot-pin + substitution (Plan 12-02)", () => {
  it("contains {TO}, {LAMPORTS}, {RECENT_BLOCKHASH} slots exactly once each", () => {
    expect(countOccurrences(PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE, "{TO}")).toBe(1);
    expect(countOccurrences(PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE, "{LAMPORTS}")).toBe(1);
    expect(countOccurrences(PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE, "{RECENT_BLOCKHASH}")).toBe(1);
  });

  it("header matches the SOT exactly: `PREPARE RECEIPT (Solana — native transfer)`", () => {
    expect(PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE).toContain(
      "PREPARE RECEIPT (Solana — native transfer)",
    );
  });

  it("substitution: lowercase base58 / decimal-lamports / blockhash preserved verbatim (PREP-02 invariant)", () => {
    const output = PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE
      .replace("{TO}", "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9")
      .replace("{LAMPORTS}", "1000000000")
      .replace("{RECENT_BLOCKHASH}", "5jhJqZxQbcRcWoCMzCx5GqK5Vp9aE3X6oMVZZBjcKB9j");

    // Cross-line regex uses \s+ per the CLAUDE.md String-Template Test Pitfall rule.
    expect(output).toMatch(
      /PREPARE RECEIPT \(Solana — native transfer\)\s+chain:\s+solana mainnet-beta\s+to:\s+AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9\s+lamports:\s+1000000000\s+recentBlockhash:\s+5jhJqZxQbcRcWoCMzCx5GqK5Vp9aE3X6oMVZZBjcKB9j/,
    );
  });
});

describe("PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE — slot-pin + substitution (Plan 12-03)", () => {
  it("contains {TO}, {MINT}, {AMOUNT}, {RECENT_BLOCKHASH}, {ATA_NOTICE} slots exactly once each", () => {
    expect(countOccurrences(PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE, "{TO}")).toBe(1);
    expect(countOccurrences(PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE, "{MINT}")).toBe(1);
    expect(countOccurrences(PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE, "{AMOUNT}")).toBe(1);
    expect(countOccurrences(PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE, "{RECENT_BLOCKHASH}")).toBe(1);
    expect(countOccurrences(PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE, "{ATA_NOTICE}")).toBe(1);
  });

  it("header matches the SOT exactly: `PREPARE RECEIPT (Solana — SPL transfer)`", () => {
    expect(PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE).toContain(
      "PREPARE RECEIPT (Solana — SPL transfer)",
    );
  });
});

describe("LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE — slot-pin + substitution (Plan 12-04 — DF-2 surface)", () => {
  it("contains {HASH_FULL_64HEX} + {HASH_CHUNKED_4_CHAR_GROUPS} slots exactly once each", () => {
    expect(
      countOccurrences(LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE, "{HASH_FULL_64HEX}"),
    ).toBe(1);
    expect(
      countOccurrences(
        LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE,
        "{HASH_CHUNKED_4_CHAR_GROUPS}",
      ),
    ).toBe(1);
  });

  it("header matches the SOT: `LEDGER BLIND-SIGN HASH (Solana)`", () => {
    expect(LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE).toContain("LEDGER BLIND-SIGN HASH (Solana)");
  });

  it("body names the SOL app `Message Hash` label (DF-2 device-display anchor)", () => {
    expect(LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE).toContain('"Message Hash"');
  });

  it("body names the SOL app v1.4+ clear-sign coverage line", () => {
    expect(LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE).toContain(
      "SOL app v1.4+ clear-signs native + SPL transfers",
    );
  });
});

describe("LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE — slot-pin + substitution (Plan 12-04)", () => {
  it("contains {INSTRUCTION_NAME} slot exactly once", () => {
    expect(
      countOccurrences(LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE, "{INSTRUCTION_NAME}"),
    ).toBe(1);
  });

  it("header is byte-identical to the SOT: `LEDGER NOTICE (Solana)` (distinct from EVM LEDGER NOTICE)", () => {
    // First line MUST be the Solana-labeled NOTICE header so a downstream
    // parser distinguishes the chain-flavor.
    expect(LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE.split("\n")[0]).toBe(
      "LEDGER NOTICE (Solana)",
    );
  });

  it("body names the SOL app Settings → Blind signing → Enabled navigation path (A2-mitigation precedent)", () => {
    expect(LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE).toMatch(
      /Settings\s*→\s*Blind signing\s*→\s*Enabled/,
    );
  });
});

describe("SIMULATION_BLOCK_SOLANA_TEMPLATE — slot-pin + DF-4 prose (Plan 12-04)", () => {
  it("contains the five slots — STATUS / ERR / UNITS_CONSUMED / LOG_COUNT / LOG_PREVIEW_LINES — exactly once each", () => {
    expect(countOccurrences(SIMULATION_BLOCK_SOLANA_TEMPLATE, "{STATUS}")).toBe(1);
    expect(countOccurrences(SIMULATION_BLOCK_SOLANA_TEMPLATE, "{ERR}")).toBe(1);
    expect(countOccurrences(SIMULATION_BLOCK_SOLANA_TEMPLATE, "{UNITS_CONSUMED}")).toBe(1);
    expect(countOccurrences(SIMULATION_BLOCK_SOLANA_TEMPLATE, "{LOG_COUNT}")).toBe(1);
    expect(
      countOccurrences(SIMULATION_BLOCK_SOLANA_TEMPLATE, "{LOG_PREVIEW_LINES}"),
    ).toBe(1);
  });

  it("header names Layer 0.7 explicitly (distinguishes from EVM advisory simulation)", () => {
    expect(SIMULATION_BLOCK_SOLANA_TEMPLATE).toContain(
      "CHECKS PERFORMED (Solana simulation — Layer 0.7)",
    );
  });

  it("body names the SIMULATION_REFUSED policy explicitly (DF-4 mandatory refusal)", () => {
    expect(SIMULATION_BLOCK_SOLANA_TEMPLATE).toContain("SIMULATION_REFUSED");
    expect(SIMULATION_BLOCK_SOLANA_TEMPLATE).toMatch(/non-ok status refuses preview/i);
  });
});

describe("VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE — substitution-free block (Plan 12-04 + 12-05)", () => {
  it("carries `Network: Solana mainnet-beta` literal (NOT `Network: Ethereum`)", () => {
    expect(VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE).toContain("Network: Solana mainnet-beta");
    expect(VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE).not.toContain("Network: Ethereum");
  });

  it("includes the 6-step post-send temporal sequence (issue #63 temporal-flow correction)", () => {
    expect(VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE).toMatch(/1\.\s+You say "send"/);
    expect(VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE).toMatch(/6\.\s+If they differ → REJECT/);
  });

  it("names `Message Hash` as the on-device label (matches LEDGER BLIND-SIGN HASH block — DF-2)", () => {
    expect(VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE).toContain('"Message Hash"');
  });

  it("substitution-free: no leftover {SLOT} placeholders", () => {
    expect(VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE).not.toMatch(/\{[A-Z_]+\}/);
  });
});
