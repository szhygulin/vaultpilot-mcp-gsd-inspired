import { describe, expect, it } from "vitest";
import type { Hex } from "viem";

import {
  AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE,
  AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE,
  AGENT_TASK_TEMPLATE,
  APPROVE_PREPARE_RECEIPT_TEMPLATE,
  CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE,
  COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE,
  COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE,
  COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE,
  COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE,
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
  it("contains both {HASH_FULL} and {HASH_CHUNKED} placeholders + post-send temporal-flow prose (issue #63)", () => {
    const hashFull = "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85";
    const hashChunked = chunkHex(hashFull);

    const output = LEDGER_BLIND_SIGN_HASH_TEMPLATE.replace("{HASH_FULL}", hashFull).replace(
      "{HASH_CHUNKED}",
      hashChunked,
    );

    // Issue #63: header reframes the block as a PREDICTION of what the
    // device will display AFTER send, not a hash to compare against the
    // dark-at-preview-time device screen.
    expect(output).toMatch(/EXPECTED LEDGER DEVICE DISPLAY \(after you say "send"\)/);
    expect(output).toContain("Predicted hash (full):");
    expect(output).toContain("Predicted hash (chunked):");
    // Full hex on its own row (note the \s+ between label and hex).
    expect(output).toMatch(
      /Predicted hash \(full\):\s+0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85/,
    );
    // Chunked form on its own row.
    expect(output).toMatch(/Predicted hash \(chunked\):\s+b28e 4824/);
    // The temporal-flow correction: device dark NOW, comparison is post-send.
    expect(output).toMatch(/device screen is dark\s+right now/);
    expect(output).toMatch(/until\s+send_transaction\s+fires/);
    // The 6-step sequence names the post-send on-device ritual.
    expect(output).toMatch(/1\.\s+You tell the agent "send"/);
    expect(output).toMatch(/2\.\s+send_transaction fires the WalletConnect request/);
    expect(output).toMatch(/3\.\s+Ledger Live wakes your hardware device/);
    expect(output).toMatch(/4\.\s+The device displays a hash/);
    expect(output).toMatch(/5\.\s+You compare the device screen/);
    expect(output).toMatch(/character-for-character/);
    expect(output).toMatch(/REJECT on the device \(tamper signal\)/);
    // Ledger Live vs Ledger device disambiguation — root cause of the
    // agent's "open Ledger Live" mistake.
    expect(output).toMatch(/DO NOT confuse Ledger Live.*with the Ledger\s+device/);
    expect(output).toMatch(/The hash to compare is on the\s+DEVICE, not in Ledger Live/);
  });
});

describe("AGENT_TASK_TEMPLATE — verbatim substitution (PREP-05, T-AGENT-1)", () => {
  it("contains the four checks + split CHECKS PERFORMED prose (pre-send agent / post-send user) + halt-on-failure instruction (issue #63)", () => {
    const to = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const valueWei = "1000000000000000000";
    const presignHash = "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85";

    const output = AGENT_TASK_TEMPLATE.replace("{TO}", to)
      .replace("{VALUE_WEI}", valueWei)
      .replace("{PRESIGN_HASH}", presignHash);

    expect(output).toContain("[AGENT TASK — RUN THESE CHECKS NOW]");
    expect(output).toContain("viem.parseTransaction");
    expect(output).toContain("viem.serializeTransaction");
    // Issue #63: CHECKS PERFORMED split into two sections.
    expect(output).toContain("CHECKS PERFORMED (pre-send, by agent)");
    expect(output).toContain("USER MUST PERFORM (post-send, on device)");
    // The post-send section instructs the user to compare device screen vs
    // PREDICTED hash above — the cryptographic-anchor ritual at the moment
    // it is operationally possible.
    expect(output).toMatch(/After saying "send", your Ledger device screen will display a hash\./);
    expect(output).toMatch(/Compare it to the PREDICTED hash above\./);
    expect(output).toMatch(/Approve only if they match\./);
    // The "matches LEDGER block" line is renamed to "matches predicted" so
    // pre-send agent checks do not claim to anchor against the device.
    expect(output).toMatch(/matches predicted:\s+<yes \/ no \/ error>/);
    expect(output).toContain("halt and report the failure");
    // All three placeholders substituted — no `{` left over.
    expect(output.includes("{")).toBe(false);
  });
});

describe("VERIFY_BEFORE_SIGNING_TEMPLATE — 6-step temporal sequence (issue #63)", () => {
  it("contains pre-send pre-flight + post-send on-device ritual + cancellation instruction", () => {
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toContain("VERIFY BEFORE SIGNING");
    // Pre-send pre-flight phase — the local checks the user does before
    // saying "send".
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toMatch(/Pre-send pre-flight/);
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toContain("PREPARE RECEIPT");
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toContain("CHECKS PERFORMED (pre-send, by agent)");
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toContain("EXPECTED LEDGER DEVICE DISPLAY");
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toContain('userDecision: "cancel"');
    // Post-send on-device ritual — the 6 numbered steps.
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toMatch(/Post-send on-device ritual/);
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toMatch(/1\.\s+You say "send"/);
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toMatch(/2\.\s+Ledger Live routes/);
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toMatch(/3\.\s+Your hardware device wakes/);
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toMatch(
      /4\.\s+You compare the device screen[\s\S]*character-for-character/,
    );
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toMatch(/5\.\s+If they match → approve on the device/);
    expect(VERIFY_BEFORE_SIGNING_TEMPLATE).toMatch(
      /6\.\s+If they differ → REJECT on the device\. This is a tamper signal/,
    );
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

// ---------------------------------------------------------------------------
// Phase 28 Plan 28-02 — COMPOUND_SUPPLY + COMPOUND_WITHDRAW RECEIPT templates.
// Two new templates (append-only); pre-existing templates byte-identical
// (asserted above). Plan 28-03 adds COMPOUND_BORROW + COMPOUND_REPAY; Plan
// 28-04 adds LEDGER_NOTICE_COMPOUND + DECODED ARGS templates.
// ---------------------------------------------------------------------------

describe("Phase 28 Plan 28-02 — COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE byte-identity", () => {
  it("4-slot template: chain + comet + asset + amount", () => {
    expect(COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("PREPARE RECEIPT");
    expect(COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("operation:    Compound V3 supply");
    expect(COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{COMET}");
    expect(COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{ASSET}");
    expect(COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{AMOUNT}");
  });

  it("verbatim substitution: all 4 slots replace cleanly with no remaining placeholders", () => {
    const out = COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{COMET}", "0xc3d688B66703497DAA19211EEdff47f25384cdc3")
      .replace("{ASSET}", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
      .replace("{AMOUNT}", "100");
    expect(out.includes("{")).toBe(false);
    expect(out).toContain("Compound V3 supply");
    expect(out).toContain("comet:        0xc3d688B66703497DAA19211EEdff47f25384cdc3");
    expect(out).toContain("amount:       100");
  });
});

describe("Phase 28 Plan 28-02 — COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE byte-identity", () => {
  it("4-slot template: chain + comet + asset + amount", () => {
    expect(COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE).toContain("PREPARE RECEIPT");
    expect(COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE).toContain(
      "operation:    Compound V3 withdraw",
    );
    expect(COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE).toContain("{COMET}");
    expect(COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE).toContain("{ASSET}");
    expect(COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE).toContain("{AMOUNT}");
  });

  it("\"max\" verbatim substitution: AMOUNT slot renders 'max' (NOT the resolved hex)", () => {
    const out = COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{COMET}", "0xc3d688B66703497DAA19211EEdff47f25384cdc3")
      .replace("{ASSET}", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
      .replace("{AMOUNT}", "max");
    expect(out).toContain("amount:       max");
    expect(out).not.toContain("ffffffff");
    expect(out.includes("{")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 28 Plan 28-03 — COMPOUND_BORROW + COMPOUND_REPAY RECEIPT templates.
// Two new templates (append-only); pre-existing Plan 28-02 templates byte-
// identical (asserted above). Plan 28-04 adds LEDGER_NOTICE_COMPOUND + DECODED
// ARGS templates.
// ---------------------------------------------------------------------------

describe("Phase 28 Plan 28-03 — COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE byte-identity", () => {
  it("4-slot template: chain + comet + asset + amount", () => {
    expect(COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE).toContain("PREPARE RECEIPT");
    expect(COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE).toContain("operation:    Compound V3 borrow");
    expect(COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE).toContain("{COMET}");
    expect(COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE).toContain("{ASSET}");
    expect(COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE).toContain("{AMOUNT}");
  });

  it("verbatim substitution: all 4 slots replace cleanly with no remaining placeholders", () => {
    const out = COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{COMET}", "0xc3d688B66703497DAA19211EEdff47f25384cdc3")
      .replace("{ASSET}", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
      .replace("{AMOUNT}", "50");
    expect(out.includes("{")).toBe(false);
    expect(out).toContain("Compound V3 borrow");
    expect(out).toContain("comet:        0xc3d688B66703497DAA19211EEdff47f25384cdc3");
    expect(out).toContain("amount:       50");
  });
});

describe("Phase 28 Plan 28-03 — COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE byte-identity", () => {
  it("4-slot template: chain + comet + asset + amount", () => {
    expect(COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE).toContain("PREPARE RECEIPT");
    expect(COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE).toContain("operation:    Compound V3 repay");
    expect(COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE).toContain("{COMET}");
    expect(COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE).toContain("{ASSET}");
    expect(COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE).toContain("{AMOUNT}");
  });

  it("\"max\" verbatim substitution: AMOUNT slot renders 'max' (NOT the resolved hex)", () => {
    const out = COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{COMET}", "0xc3d688B66703497DAA19211EEdff47f25384cdc3")
      .replace("{ASSET}", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
      .replace("{AMOUNT}", "max");
    expect(out).toContain("amount:       max");
    expect(out).not.toContain("ffffffff");
    expect(out.includes("{")).toBe(false);
  });

  it("decimal substitution: AMOUNT slot renders concrete decimal verbatim (non-max path)", () => {
    const out = COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{COMET}", "0xc3d688B66703497DAA19211EEdff47f25384cdc3")
      .replace("{ASSET}", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
      .replace("{AMOUNT}", "200.5");
    expect(out).toContain("amount:       200.5");
    expect(out).toContain("Compound V3 repay");
    expect(out.includes("{")).toBe(false);
  });
});
