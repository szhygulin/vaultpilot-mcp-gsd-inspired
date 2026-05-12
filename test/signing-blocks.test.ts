import { describe, expect, it } from "vitest";

import {
  AGENT_TASK_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TEMPLATE,
  PREPARE_RECEIPT_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TEMPLATE,
  chunkHex,
} from "../src/signing/blocks.js";

describe("PREPARE_RECEIPT_TEMPLATE — verbatim substitution (PREP-02, T-PREP-RCPT-1)", () => {
  it("substitutes a LOWERCASE address verbatim — no checksum normalization", () => {
    const to = "0xabcdef0123456789abcdef0123456789abcdef01";
    const valueWei = "1000000000000000000";

    const output = PREPARE_RECEIPT_TEMPLATE.replace("{TO}", to).replace("{VALUE_WEI}", valueWei);

    expect(output).toContain("PREPARE RECEIPT");
    // Lowercase address preserved character-for-character (no normalization).
    expect(output).toContain("0xabcdef0123456789abcdef0123456789abcdef01");
    // Cross-line regex uses \s+ between tokens per the String-Template Test Pitfall rule.
    expect(output).toMatch(
      /PREPARE RECEIPT\s+to:\s+0xabcdef0123456789abcdef0123456789abcdef01\s+valueWei:\s+1000000000000000000/,
    );
    // Regression anchor: a future contributor inflating the block fails this.
    expect(output.split("\n").length).toBe(3);
  });
});

describe("LEDGER_BLIND_SIGN_HASH_TEMPLATE — A1 mitigation: emit BOTH forms", () => {
  it("contains both {HASH_FULL} and {HASH_CHUNKED} placeholders + safety prose", () => {
    const hashFull = "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85";
    const hashChunked = chunkHex(hashFull);

    const output = LEDGER_BLIND_SIGN_HASH_TEMPLATE.replace("{HASH_FULL}", hashFull).replace(
      "{HASH_CHUNKED}",
      hashChunked,
    );

    expect(output).toContain("Expected on-device hash (full):");
    expect(output).toContain("Expected on-device hash (chunked):");
    // Full hex on its own row (note the \s+ between label and hex).
    expect(output).toMatch(
      /Expected on-device hash \(full\):\s+0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85/,
    );
    // Chunked form on its own row.
    expect(output).toMatch(/Expected on-device hash \(chunked\):\s+b28e 4824/);
    expect(output).toContain("Match this hash CHARACTER-FOR-CHARACTER");
    // Phrase wraps across two lines ("do —\nnot approve…"); use \s+ between
    // tokens per the String-Template Test Pitfall rule.
    expect(output.toLowerCase()).toMatch(/do\s+not\s+approve\s+on\s+the\s+device/);
  });
});

describe("AGENT_TASK_TEMPLATE — verbatim substitution (PREP-05, T-AGENT-1)", () => {
  it("contains the four checks + CHECKS PERFORMED prose + halt-on-failure instruction", () => {
    const to = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const valueWei = "1000000000000000000";
    const presignHash = "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85";

    const output = AGENT_TASK_TEMPLATE.replace("{TO}", to)
      .replace("{VALUE_WEI}", valueWei)
      .replace("{PRESIGN_HASH}", presignHash);

    expect(output).toContain("[AGENT TASK — RUN THESE CHECKS NOW]");
    expect(output).toContain("viem.parseTransaction");
    expect(output).toContain("viem.serializeTransaction");
    expect(output).toContain("CHECKS PERFORMED");
    expect(output).toContain("halt and report the failure");
    // All three placeholders substituted — no `{` left over.
    expect(output.includes("{")).toBe(false);
  });
});

describe("VERIFY_BEFORE_SIGNING_TEMPLATE — constant prose summary", () => {
  it("contains all four cross-check artifacts + cancellation instruction", () => {
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toContain("VERIFY BEFORE SIGNING");
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toContain("PREPARE RECEIPT");
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toContain("LEDGER BLIND-SIGN HASH");
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toContain("CHECKS PERFORMED");
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toContain('userDecision: "cancel"');
  });
});

describe("chunkHex — splits 32-byte hex into 16 four-char groups", () => {
  it("Fixture C presign hash chunks into the expected 16-group form", () => {
    const out = chunkHex("0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85");
    expect(out).toBe("b28e 4824 7c13 2650 2944 59b3 1a5a d7e4 e9ad 187a bb0f 9843 8862 9b2c 29e2 7e85");
  });

  it("rejects wrong-length input", () => {
    expect(() => chunkHex(`0x${"00".repeat(31)}` as `0x${string}`)).toThrow(
      /32-byte 0x-prefixed hex/,
    );
  });

  it("rejects non-hex input", () => {
    expect(() =>
      chunkHex(`0xZZZZ${"00".repeat(30)}` as `0x${string}`),
    ).toThrow(/32-byte 0x-prefixed hex/);
  });
});
