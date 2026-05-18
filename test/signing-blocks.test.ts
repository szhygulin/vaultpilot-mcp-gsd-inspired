import { describe, expect, it } from "vitest";
import type { Hex } from "viem";

import {
  AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE,
  AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE,
  AGENT_TASK_TEMPLATE,
  APPROVE_PREPARE_RECEIPT_TEMPLATE,
  CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE,
  ERC20_PREPARE_RECEIPT_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TEMPLATE,
  PREPARE_RECEIPT_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TEMPLATE,
  WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE,
  build4byteBlock,
  chunkHex,
} from "../src/signing/blocks.js";
import type { FourbyteResult } from "../src/clients/fourbyte.js";

describe("PREPARE_RECEIPT_TEMPLATE — verbatim substitution (PREP-02, T-PREP-RCPT-1)", () => {
  it("substitutes a LOWERCASE address verbatim — no checksum normalization (Plan 08-02: {CHAIN} slot added)", () => {
    const to = "0xabcdef0123456789abcdef0123456789abcdef01";
    const valueWei = "1000000000000000000";

    const output = PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{TO}", to)
      .replace("{VALUE_WEI}", valueWei);

    expect(output).toContain("PREPARE RECEIPT");
    // Lowercase address preserved character-for-character (no normalization).
    expect(output).toContain("0xabcdef0123456789abcdef0123456789abcdef01");
    // Cross-line regex uses \s+ between tokens per the String-Template Test Pitfall rule.
    expect(output).toMatch(
      /PREPARE RECEIPT\s+chain:\s+ethereum \(chainId 1\)\s+to:\s+0xabcdef0123456789abcdef0123456789abcdef01\s+valueWei:\s+1000000000000000000/,
    );
    // Regression anchor: 4 lines post-Plan-08-02 (was 3; Plan 08-02 adds the
    // `chain:` slot). A future contributor inflating beyond the {CHAIN} slot fails.
    expect(output.split("\n").length).toBe(4);
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

describe("build4byteBlock — renders the four FourbyteResult kinds verbatim", () => {
  it("kind: 'not-applicable' (selector === null, native send) — block shows not-applicable", () => {
    const result: FourbyteResult = { kind: "not-applicable" };
    const block = build4byteBlock(null, result);

    expect(block).toContain("4BYTE CROSS-CHECK");
    expect(block).toContain("not-applicable");
    // Native sends have no selector — the block names that condition
    // explicitly so the user understands why no decode is shown.
    expect(block.toLowerCase()).toMatch(/no\s+function\s+call\s+data|data\s+is\s+0x|native/);
  });

  it("kind: 'found' — block shows selector + verbatim text_signature", () => {
    const selector = "0xa9059cbb" as Hex;
    const result: FourbyteResult = {
      kind: "found",
      textSignature: "transfer(address,uint256)",
    };
    const block = build4byteBlock(selector, result);

    expect(block).toContain("4BYTE CROSS-CHECK");
    expect(block).toContain("0xa9059cbb");
    expect(block).toContain("transfer(address,uint256)");
  });

  it("kind: 'not-found' — block shows selector + 'no signature found' note", () => {
    const selector = "0xdeadbeef" as Hex;
    const result: FourbyteResult = { kind: "not-found" };
    const block = build4byteBlock(selector, result);

    expect(block).toContain("4BYTE CROSS-CHECK");
    expect(block).toContain("0xdeadbeef");
    expect(block.toLowerCase()).toMatch(/no\s+(known\s+)?signature|not\s+found/);
  });

  it("kind: 'error' — block shows the verbatim error message (PREP-06 no silent fallback)", () => {
    const selector = "0xa9059cbb" as Hex;
    const result: FourbyteResult = {
      kind: "error",
      message: "4byte.directory unreachable (timeout 1.5s)",
    };
    const block = build4byteBlock(selector, result);

    expect(block).toContain("4BYTE CROSS-CHECK");
    expect(block).toContain("0xa9059cbb");
    // Verbatim error message ships through to the user — never masked.
    expect(block).toContain("4byte.directory unreachable (timeout 1.5s)");
  });

  it("adversarial text_signature surfaces verbatim — never re-parsed (T-4BYTE-1)", () => {
    const selector = "0xa9059cbb" as Hex;
    const adversarial = "transfer(address,uint256) /* OWNED */";
    const result: FourbyteResult = { kind: "found", textSignature: adversarial };
    const block = build4byteBlock(selector, result);

    expect(block).toContain(adversarial);
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — Plan 08-02 additions.
// ---------------------------------------------------------------------------

describe("Plan 08-02 — PREPARE_RECEIPT templates carry {CHAIN} slot (uniform across 6 prepares)", () => {
  it("all 6 receipt templates contain a {CHAIN} slot", () => {
    expect(PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(ERC20_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(APPROVE_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
  });

  it("native PREPARE_RECEIPT_TEMPLATE substitutes {CHAIN} with chain-name verbatim", () => {
    const out = PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "polygon (chainId 137)")
      .replace("{TO}", "0x0000000000000000000000000000000000000000")
      .replace("{VALUE_WEI}", "0");
    expect(out).toMatch(/chain:\s+polygon \(chainId 137\)/);
  });
});

describe("Plan 08-02 — CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE shape", () => {
  it("carries CHAIN ID MISMATCH header + 3 substitution slots + refusal prose", () => {
    expect(CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE).toContain("CHAIN ID MISMATCH");
    expect(CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE).toContain("{REQUESTED_CHAIN}");
    expect(CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE).toContain("{STORED_CHAIN}");
    expect(CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE).toContain("{STORED_CHAIN_ID}");
    expect(CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE).toContain("refusal:");
    expect(CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE).toContain("re-call prepare_*");
  });

  it("substitutes {REQUESTED_CHAIN} + {STORED_CHAIN} + {STORED_CHAIN_ID} verbatim", () => {
    const out = CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE
      .replace("{REQUESTED_CHAIN}", "polygon (chainId 137)")
      .replace("{STORED_CHAIN}", "ethereum")
      .replace("{STORED_CHAIN_ID}", "1");
    expect(out).toContain("agent requested:  polygon (chainId 137)");
    expect(out).toContain("handle prepared:  ethereum (chainId 1)");
    expect(out.includes("{")).toBe(false);
  });
});
