import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

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
  DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY,
  DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW,
  DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT,
  DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE,
  DECODED_ARGS_TEMPLATE_UNISWAP_MULTICALL,
  DECODED_ARGS_TEMPLATE_UNISWAP_UNWRAP_WETH9,
  UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE,
  buildUniswapV3DecodedArgsBlock,
  DECODED_ARGS_TEMPLATE_MORPHO_BORROW,
  DECODED_ARGS_TEMPLATE_MORPHO_REPAY,
  DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY,
  DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY_COLLATERAL,
  DECODED_ARGS_TEMPLATE_MORPHO_WITHDRAW,
  DECODED_ARGS_TEMPLATE_MORPHO_WITHDRAW_COLLATERAL,
  ERC20_PREPARE_RECEIPT_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TEMPLATE,
  LEDGER_NOTICE_COMPOUND_TEMPLATE,
  LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE,
  LEDGER_NOTICE_UNISWAP_V3_TEMPLATE,
  MORPHO_BORROW_PREPARE_RECEIPT_TEMPLATE,
  MORPHO_REPAY_PREPARE_RECEIPT_TEMPLATE,
  MORPHO_SUPPLY_COLLATERAL_PREPARE_RECEIPT_TEMPLATE,
  MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE,
  MORPHO_WITHDRAW_COLLATERAL_PREPARE_RECEIPT_TEMPLATE,
  MORPHO_WITHDRAW_PREPARE_RECEIPT_TEMPLATE,
  PREPARE_RECEIPT_TEMPLATE,
  SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TEMPLATE,
  WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE,
  build4byteBlock,
  buildCompoundDecodedArgsBlock,
  buildMorphoDecodedArgsBlock,
  chunkHex,
} from "../src/signing/blocks.js";
import { SANDWICH_MEV_REFUSAL_TRON_TEMPLATE } from "../src/signing/blocks-tron.js";
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

// ---------------------------------------------------------------------------
// Phase 28 Plan 28-04 — LEDGER_NOTICE_COMPOUND_TEMPLATE + DECODED_ARGS
// COMPOUND_SUPPLY + COMPOUND_WITHDRAW templates. All 3 new templates byte-
// identity asserted. Plans 28-02 / 28-03 templates above remain byte-identical.
// ---------------------------------------------------------------------------

describe("Phase 28 Plan 28-04 — LEDGER_NOTICE_COMPOUND_TEMPLATE byte-identity (research § Topic 8)", () => {
  it("template carries the LEDGER NOTICE header + Compound-specific prose", () => {
    expect(LEDGER_NOTICE_COMPOUND_TEMPLATE).toContain("LEDGER NOTICE");
    expect(LEDGER_NOTICE_COMPOUND_TEMPLATE).toContain(
      "Compound V3 supply / withdraw is NOT covered by the Ledger Ethereum app's ERC-7730 clear-sign registry.",
    );
    expect(LEDGER_NOTICE_COMPOUND_TEMPLATE).toContain("BLIND-SIGN");
    expect(LEDGER_NOTICE_COMPOUND_TEMPLATE).toContain("Settings → Blind signing → Enabled");
    expect(LEDGER_NOTICE_COMPOUND_TEMPLATE).toContain("cryptographic anchor");
  });

  it("template is byte-identical to research § Topic 8 — no inline substitution slots", () => {
    // The Compound NOTICE is a fixed-text block — no {SLOT} placeholders.
    expect(LEDGER_NOTICE_COMPOUND_TEMPLATE.includes("{")).toBe(false);
  });

  it("template parallels LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE shape (Phase 6 precedent)", () => {
    // Same structural sections — header + protocol-specific warning + numbered
    // remediation steps + closing cryptographic-anchor reference.
    const lines = LEDGER_NOTICE_COMPOUND_TEMPLATE.split("\n");
    expect(lines[0]).toBe("LEDGER NOTICE");
    // Numbered remediation steps survive substitution.
    expect(LEDGER_NOTICE_COMPOUND_TEMPLATE).toMatch(/1\.\s+Open the Ethereum app/);
    expect(LEDGER_NOTICE_COMPOUND_TEMPLATE).toMatch(/2\.\s+Settings → Blind signing → Enabled/);
    expect(LEDGER_NOTICE_COMPOUND_TEMPLATE).toMatch(/3\.\s+Retry send_transaction/);
  });
});

describe("Phase 28 Plan 28-04 — DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY byte-identity", () => {
  it("6-slot template: comet + asset + asset_label + amount_human + amount_wei + intent_label", () => {
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY).toContain("DECODED ARGS");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY).toContain("function:  supply");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY).toContain("{COMET}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY).toContain("{ASSET}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY).toContain("{ASSET_LABEL}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY).toContain("{AMOUNT_HUMAN}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY).toContain("{AMOUNT_WEI}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY).toContain("{INTENT_LABEL}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY).toContain("Compound V3 — canonical");
  });

  it("verbatim substitution: all 6 slots replace cleanly with no remaining placeholders", () => {
    const out = DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY
      .replace("{COMET}", "0xc3d688B66703497DAA19211EEdff47f25384cdc3")
      .replace("{ASSET}", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
      .replace("{ASSET_LABEL}", "(USDC)")
      .replace("{AMOUNT_HUMAN}", "100")
      .replace("{AMOUNT_WEI}", "100000000")
      .replace("{INTENT_LABEL}", "supply-collateral");
    expect(out.includes("{")).toBe(false);
    expect(out).toContain("comet:     0xc3d688B66703497DAA19211EEdff47f25384cdc3");
    expect(out).toContain("asset:     0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (USDC)");
    expect(out).toContain("amount:    100");
    expect(out).toContain("amountWei: 100000000");
    expect(out).toContain("intent:    supply-collateral");
  });
});

describe("Phase 28 Plan 28-04 — DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW byte-identity", () => {
  it("6-slot template: comet + asset + asset_label + amount_human + amount_wei + intent_label", () => {
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW).toContain("DECODED ARGS");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW).toContain("function:  withdraw");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW).toContain("{COMET}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW).toContain("{ASSET}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW).toContain("{ASSET_LABEL}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW).toContain("{AMOUNT_HUMAN}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW).toContain("{AMOUNT_WEI}");
    expect(DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW).toContain("{INTENT_LABEL}");
  });

  it("intent label renders verbatim — `borrow` reverse-intent on the withdraw selector", () => {
    const out = DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW
      .replace("{COMET}", "0xc3d688B66703497DAA19211EEdff47f25384cdc3")
      .replace("{ASSET}", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
      .replace("{ASSET_LABEL}", "(USDC)")
      .replace("{AMOUNT_HUMAN}", "50")
      .replace("{AMOUNT_WEI}", "50000000")
      .replace("{INTENT_LABEL}", "borrow");
    expect(out.includes("{")).toBe(false);
    expect(out).toContain("intent:    borrow");
  });
});

describe("Phase 28 Plan 28-04 — buildCompoundDecodedArgsBlock helper", () => {
  const COMET = "0xc3d688B66703497DAA19211EEdff47f25384cdc3" as Address;
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;

  it("supply branch: renders amount via formatUnits with tokenContext decimals", () => {
    const out = buildCompoundDecodedArgsBlock(
      { kind: "compound-supply", asset: USDC, amount: 100_000_000n, isMax: false },
      { symbol: "USDC", decimals: 6 },
      COMET,
      "supply-collateral",
    );
    expect(out).toContain("function:  supply");
    expect(out).toContain(`comet:     ${COMET} (Compound V3 — canonical)`);
    expect(out).toContain(`asset:     ${USDC} (USDC)`);
    expect(out).toContain("amount:    100");
    expect(out).toContain("amountWei: 100000000");
    expect(out).toContain("intent:    supply-collateral");
  });

  it("withdraw branch with isMax: renders ENTIRE BALANCE (uint256.max)", () => {
    const MAX_UINT256 = 2n ** 256n - 1n;
    const out = buildCompoundDecodedArgsBlock(
      { kind: "compound-withdraw", asset: USDC, amount: MAX_UINT256, isMax: true },
      { symbol: "USDC", decimals: 6 },
      COMET,
      "withdraw-collateral",
    );
    expect(out).toContain("amount:    ENTIRE BALANCE (uint256.max)");
    expect(out).toContain("intent:    withdraw-collateral");
  });

  it("off-list asset: surfaces '(unknown asset — no registry match)' label", () => {
    const out = buildCompoundDecodedArgsBlock(
      { kind: "compound-supply", asset: USDC, amount: 100n, isMax: false },
      null,
      COMET,
      "supply-collateral",
    );
    expect(out).toContain("(unknown asset — no registry match)");
  });
});

// ---------------------------------------------------------------------------
// Phase 29 Plan 29-03 — Morpho Blue template byte-identity (12 templates).
//
// 6 PREPARE RECEIPT (one per tool) + 6 DECODED ARGS (one per Morpho function).
// Each test asserts: slot placeholders are correct, no shape drift, no
// accidental overlap with Compound / Aave templates.
// ---------------------------------------------------------------------------

describe("Phase 29 Plan 29-03 — MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE byte-identity", () => {
  it("contains all expected slots + operation label", () => {
    expect(MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("PREPARE RECEIPT");
    expect(MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain(
      "operation:    Morpho Blue supply (lender position)",
    );
    expect(MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{MARKET_ID}");
    expect(MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{MARKET_LABEL}");
    expect(MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{ASSET} (must be loanToken)");
    expect(MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{AMOUNT}");
    expect(MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE).toContain("{ONBEHALF}");
  });
});

describe("Phase 29 Plan 29-03 — MORPHO_WITHDRAW_PREPARE_RECEIPT_TEMPLATE byte-identity", () => {
  it("contains receiver slot (withdraw has receiver)", () => {
    expect(MORPHO_WITHDRAW_PREPARE_RECEIPT_TEMPLATE).toContain(
      "operation:    Morpho Blue withdraw (lender position close)",
    );
    expect(MORPHO_WITHDRAW_PREPARE_RECEIPT_TEMPLATE).toContain("{RECEIVER}");
    expect(MORPHO_WITHDRAW_PREPARE_RECEIPT_TEMPLATE).toContain("(must be loanToken)");
  });
});

describe("Phase 29 Plan 29-03 — MORPHO_SUPPLY_COLLATERAL_PREPARE_RECEIPT_TEMPLATE byte-identity", () => {
  it("asset annotation is collateralToken (NOT loanToken)", () => {
    expect(MORPHO_SUPPLY_COLLATERAL_PREPARE_RECEIPT_TEMPLATE).toContain(
      "operation:    Morpho Blue supplyCollateral (post collateral to enable borrowing)",
    );
    expect(MORPHO_SUPPLY_COLLATERAL_PREPARE_RECEIPT_TEMPLATE).toContain(
      "(must be collateralToken)",
    );
    // No receiver — supplyCollateral has no receiver arg.
    expect(MORPHO_SUPPLY_COLLATERAL_PREPARE_RECEIPT_TEMPLATE).not.toContain("{RECEIVER}");
  });
});

describe("Phase 29 Plan 29-03 — MORPHO_WITHDRAW_COLLATERAL_PREPARE_RECEIPT_TEMPLATE byte-identity", () => {
  it("collateralToken annotation + receiver slot", () => {
    expect(MORPHO_WITHDRAW_COLLATERAL_PREPARE_RECEIPT_TEMPLATE).toContain(
      "operation:    Morpho Blue withdrawCollateral (collateral release)",
    );
    expect(MORPHO_WITHDRAW_COLLATERAL_PREPARE_RECEIPT_TEMPLATE).toContain(
      "(must be collateralToken)",
    );
    expect(MORPHO_WITHDRAW_COLLATERAL_PREPARE_RECEIPT_TEMPLATE).toContain("{RECEIVER}");
  });
});

describe("Phase 29 Plan 29-03 — MORPHO_BORROW_PREPARE_RECEIPT_TEMPLATE byte-identity", () => {
  it("loanToken annotation + receiver slot", () => {
    expect(MORPHO_BORROW_PREPARE_RECEIPT_TEMPLATE).toContain(
      "operation:    Morpho Blue borrow (debt position)",
    );
    expect(MORPHO_BORROW_PREPARE_RECEIPT_TEMPLATE).toContain("(must be loanToken)");
    expect(MORPHO_BORROW_PREPARE_RECEIPT_TEMPLATE).toContain("{RECEIVER}");
  });
});

describe("Phase 29 Plan 29-03 — MORPHO_REPAY_PREPARE_RECEIPT_TEMPLATE byte-identity", () => {
  it("loanToken annotation + NO receiver (repay has no receiver arg)", () => {
    expect(MORPHO_REPAY_PREPARE_RECEIPT_TEMPLATE).toContain("operation:    Morpho Blue repay");
    expect(MORPHO_REPAY_PREPARE_RECEIPT_TEMPLATE).toContain("(must be loanToken)");
    expect(MORPHO_REPAY_PREPARE_RECEIPT_TEMPLATE).not.toContain("{RECEIVER}");
  });

  it("supports verbatim 'max' substitution (CLAUDE.md verbatim discipline)", () => {
    const out = MORPHO_REPAY_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum")
      .replace("{MARKET_ID}", "0xabcd")
      .replace("{MARKET_LABEL}", "USDC/wstETH")
      .replace("{ASSET}", "0xA0b8")
      .replace("{AMOUNT}", "max")
      .replace("{ONBEHALF}", "0xdead");
    expect(out).toContain("amount:       max");
    expect(out).not.toContain("{AMOUNT}");
  });
});

describe("Phase 29 Plan 29-03 — DECODED_ARGS_TEMPLATE_MORPHO_* byte-identity (6 templates)", () => {
  it("MORPHO_SUPPLY: function: supply + assets + shares + encoding + onBehalf (no receiver)", () => {
    expect(DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY).toContain("function:     supply");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY).toContain("{ASSETS}");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY).toContain("{SHARES}");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY).toContain("{IS_SHARE_BASED}");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY).not.toContain("{RECEIVER}");
  });

  it("MORPHO_WITHDRAW: function: withdraw + receiver slot", () => {
    expect(DECODED_ARGS_TEMPLATE_MORPHO_WITHDRAW).toContain("function:     withdraw");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_WITHDRAW).toContain("{RECEIVER}");
  });

  it("MORPHO_SUPPLY_COLLATERAL: function: supplyCollateral + NO shares + NO encoding (asset-only)", () => {
    expect(DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY_COLLATERAL).toContain(
      "function:     supplyCollateral",
    );
    expect(DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY_COLLATERAL).not.toContain("{SHARES}");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY_COLLATERAL).not.toContain("{IS_SHARE_BASED}");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_SUPPLY_COLLATERAL).not.toContain("{RECEIVER}");
  });

  it("MORPHO_WITHDRAW_COLLATERAL: function: withdrawCollateral + receiver + NO shares", () => {
    expect(DECODED_ARGS_TEMPLATE_MORPHO_WITHDRAW_COLLATERAL).toContain(
      "function:     withdrawCollateral",
    );
    expect(DECODED_ARGS_TEMPLATE_MORPHO_WITHDRAW_COLLATERAL).toContain("{RECEIVER}");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_WITHDRAW_COLLATERAL).not.toContain("{SHARES}");
  });

  it("MORPHO_BORROW: function: borrow + receiver + shares + encoding", () => {
    expect(DECODED_ARGS_TEMPLATE_MORPHO_BORROW).toContain("function:     borrow");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_BORROW).toContain("{RECEIVER}");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_BORROW).toContain("{IS_SHARE_BASED}");
  });

  it("MORPHO_REPAY: function: repay + NO receiver (repay has no receiver arg) + shares + encoding", () => {
    expect(DECODED_ARGS_TEMPLATE_MORPHO_REPAY).toContain("function:     repay");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_REPAY).not.toContain("{RECEIVER}");
    expect(DECODED_ARGS_TEMPLATE_MORPHO_REPAY).toContain("{IS_SHARE_BASED}");
  });
});

describe("Phase 29 Plan 29-03 — buildMorphoDecodedArgsBlock dispatch", () => {
  const PARAMS = {
    loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`,
    collateralToken: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as `0x${string}`,
    lltv: 860000000000000000n,
  };
  const ONBEHALF = "0x000000000000000000000000000000000000dEaD" as `0x${string}`;
  const RECEIVER = "0x000000000000000000000000000000000000bEEF" as `0x${string}`;
  const MARKET_ID = "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc" as `0x${string}`;

  it("supply arm: renders share-based vs asset-based encoding annotation", () => {
    const out = buildMorphoDecodedArgsBlock(
      {
        kind: "morpho-supply",
        marketId: MARKET_ID,
        marketParams: PARAMS,
        assets: 100_000_000n,
        shares: 0n,
        onBehalf: ONBEHALF,
        data: "0x",
        isShareBased: false,
      },
      { symbol: "USDC", decimals: 6 },
      { symbol: "wstETH", decimals: 18 },
    );
    expect(out).toContain("function:     supply");
    expect(out).toContain("encoding:     asset-based");
    expect(out).toContain("(USDC)");
    expect(out).toContain("(wstETH)");
  });

  it("repay-max arm: share-based encoding annotation", () => {
    const out = buildMorphoDecodedArgsBlock(
      {
        kind: "morpho-repay",
        marketId: MARKET_ID,
        marketParams: PARAMS,
        assets: 0n,
        shares: 1_000_000_000n,
        onBehalf: ONBEHALF,
        data: "0x",
        isShareBased: true,
      },
      { symbol: "USDC", decimals: 6 },
      { symbol: "wstETH", decimals: 18 },
    );
    expect(out).toContain("encoding:     share-based");
    expect(out).toContain("shares:       1000000000");
  });

  it("supplyCollateral arm: asset-only (no shares / encoding lines)", () => {
    const out = buildMorphoDecodedArgsBlock(
      {
        kind: "morpho-supply-collateral",
        marketId: MARKET_ID,
        marketParams: PARAMS,
        assets: 1_000_000_000_000_000_000n,
        onBehalf: ONBEHALF,
        data: "0x",
      },
      { symbol: "USDC", decimals: 6 },
      { symbol: "wstETH", decimals: 18 },
    );
    expect(out).toContain("function:     supplyCollateral");
    expect(out).not.toContain("encoding:");
    expect(out).not.toContain("shares:");
  });

  it("withdrawCollateral arm: receiver surfaces", () => {
    const out = buildMorphoDecodedArgsBlock(
      {
        kind: "morpho-withdraw-collateral",
        marketId: MARKET_ID,
        marketParams: PARAMS,
        assets: 500_000_000_000_000_000n,
        onBehalf: ONBEHALF,
        receiver: RECEIVER,
      },
      { symbol: "USDC", decimals: 6 },
      { symbol: "wstETH", decimals: 18 },
    );
    expect(out).toContain(`receiver:     ${RECEIVER}`);
  });

  it("off-list tokens: fallback labels surface", () => {
    const out = buildMorphoDecodedArgsBlock(
      {
        kind: "morpho-supply",
        marketId: MARKET_ID,
        marketParams: PARAMS,
        assets: 100n,
        shares: 0n,
        onBehalf: ONBEHALF,
        data: "0x",
        isShareBased: false,
      },
      null,
      null,
    );
    expect(out).toContain("(unknown loanToken — no registry match)");
    expect(out).toContain("(unknown collateralToken — no registry match)");
  });
});

// =============================================================================
// Phase 32 Plan 32-01 — Uniswap V3 LEDGER NOTICE + Sandwich-MEV refusal templates
// =============================================================================
//
// Light-touch byte-identity + key-phrase coverage on the two APPEND-ONLY
// constants added to src/signing/blocks.ts at Phase 32. Full per-line
// assertions live in the future Plan 32-03 prepare-tool test (this block
// guards the constants exist + carry their load-bearing phrases).

describe("src/signing/blocks.ts — Phase 32 additive templates", () => {
  it("LEDGER_NOTICE_UNISWAP_V3_TEMPLATE contains key phrases (multicall + BLIND-SIGN + Settings)", () => {
    // Use \s+ between words per ~/.claude/CLAUDE.md String-Template Test Pitfalls
    // rule when matching across potential line breaks.
    expect(LEDGER_NOTICE_UNISWAP_V3_TEMPLATE).toMatch(/LEDGER\s+NOTICE/);
    expect(LEDGER_NOTICE_UNISWAP_V3_TEMPLATE).toMatch(/BLIND-SIGN/);
    expect(LEDGER_NOTICE_UNISWAP_V3_TEMPLATE).toMatch(/multicall/);
    expect(LEDGER_NOTICE_UNISWAP_V3_TEMPLATE).toMatch(/Blind\s+signing/);
    expect(LEDGER_NOTICE_UNISWAP_V3_TEMPLATE).toMatch(/Settings/);
    expect(LEDGER_NOTICE_UNISWAP_V3_TEMPLATE).toMatch(
      /on-device\s+match\s+is\s+the\s+cryptographic\s+anchor/,
    );
  });

  it("SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE contains key phrases and placeholders", () => {
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).toMatch(/SANDWICH-MEV\s+DEFENSE/);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).toMatch(/Uniswap\s+V3/);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).toMatch(/Ethereum\s+mainnet/);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).toMatch(/MEV/);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).toMatch(/get_uniswap_quote/);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).toMatch(/prepare_uniswap_swap/);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).toMatch(/\{PRICE_IMPACT_BPS\}/);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).toMatch(/\{THRESHOLD_BPS\}/);
  });

  it("SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE does NOT contain TRON-specific phrases", () => {
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).not.toMatch(/TRON/);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).not.toMatch(/get_sunswap_quote/);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).not.toMatch(/prepare_sunswap_swap/);
  });

  it("Both Phase 32 templates are non-empty strings (substantive content)", () => {
    expect(LEDGER_NOTICE_UNISWAP_V3_TEMPLATE.length).toBeGreaterThan(100);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE.length).toBeGreaterThan(100);
  });

  it("APPEND-ONLY discipline — pre-existing templates remain accessible by name", () => {
    // Regression catches accidental deletion / symbol rename. Import 3
    // pre-existing constants — one Phase 28, one Phase 31, one cross-chain
    // (Phase 20 TRON template — the SANDWICH_MEV_REFUSAL_TRON_TEMPLATE the
    // Phase 32 Ethereum template clones from).
    expect(LEDGER_NOTICE_COMPOUND_TEMPLATE.length).toBeGreaterThan(50);
    expect(LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE.length).toBeGreaterThan(50);
    expect(SANDWICH_MEV_REFUSAL_TRON_TEMPLATE.length).toBeGreaterThan(50);
    // Cross-template byte-identity sanity: the Ethereum clone preserves the
    // structural layout (header line + indented body) but the copy is distinct
    // — they must NOT be the exact same string.
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE).not.toBe(SANDWICH_MEV_REFUSAL_TRON_TEMPLATE);
  });
});

// =============================================================================
// Phase 33 Plan 33-01 — APPEND-ONLY LEDGER NOTICE template for NPM blind-sign.
// =============================================================================

describe("src/signing/blocks.ts — Phase 33 LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE", () => {
  it("LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE export exists and carries key blind-sign phrases", async () => {
    const blocks = await import("../src/signing/blocks.js");
    const t = blocks.LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE;
    expect(typeof t).toBe("string");
    expect(t.length).toBeGreaterThan(100);
    expect(t).toMatch(/LEDGER\s+NOTICE/);
    expect(t).toMatch(/Uniswap\s+V3\s+LP\s+operations\s+blind-sign\s+on\s+device/);
    expect(t).toMatch(/ERC-7730/);
    expect(t).toMatch(/NonfungiblePositionManager/);
    expect(t).toMatch(/LEDGER\s+BLIND-SIGN\s+HASH/);
    expect(t).toMatch(/clear-signing-erc7730-registry/);
  });

  it("LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE is structurally distinct from Phase 32 swap template", async () => {
    // Phase 32 LEDGER_NOTICE_UNISWAP_V3_TEMPLATE describes the multicall outer-
    // selector blind-sign for swaps. Phase 33 template describes the NPM-wide
    // blind-sign for LP verbs — different copy, different surface.
    const blocks = await import("../src/signing/blocks.js");
    expect(blocks.LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE).not.toBe(
      blocks.LEDGER_NOTICE_UNISWAP_V3_TEMPLATE,
    );
  });
});

// =============================================================================
// Phase 32 Plan 32-03 — Uniswap V3 PREPARE RECEIPT + 4 DECODED ARGS templates
// =============================================================================
//
// APPEND-ONLY additive surface for the `prepare_uniswap_swap` (Plan 32-03)
// tool's PREPARE RECEIPT block + the `preview_send` (to, selector) tuple-
// dispatch DECODED ARGS arms. The 5 new constants + 1 new helper:
//   - UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE (10 placeholder slots — D-09)
//   - DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE (7 slots)
//   - DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT (4 slots)
//   - DECODED_ARGS_TEMPLATE_UNISWAP_MULTICALL (3 slots — outer wrapper)
//   - DECODED_ARGS_TEMPLATE_UNISWAP_UNWRAP_WETH9 (2 slots)
//   - buildUniswapV3DecodedArgsBlock(decoded: UniswapV3Decoded) — 4-arm switch
//     with recursive multicall sub-call rendering.

describe("src/signing/blocks.ts — Phase 32 Plan 32-03 additive templates", () => {
  it("UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE contains all 10 placeholder slots", () => {
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(/\{CHAIN\}/);
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(/\{SWAP_ROUTER\}/);
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(/\{TOKEN_IN\}/);
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(/\{TOKEN_OUT\}/);
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(/\{AMOUNT_IN\}/);
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(/\{AMOUNT_OUT_MIN\}/);
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(/\{FEE_TIER_OR_PATH\}/);
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(/\{PRICE_IMPACT_BPS\}/);
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(/\{SLIPPAGE_BPS\}/);
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(/\{DEADLINE\}/);
    expect(UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE).toMatch(
      /PREPARE\s+RECEIPT\s+—\s+Uniswap\s+V3\s+swap/,
    );
  });

  it("DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE contains 7 slots", () => {
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE).toMatch(/\{TOKEN_IN\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE).toMatch(/\{TOKEN_OUT\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE).toMatch(/\{FEE\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE).toMatch(/\{RECIPIENT\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE).toMatch(/\{AMOUNT_IN\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE).toMatch(/\{AMOUNT_OUT_MIN\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE).toMatch(/\{SQRT_PRICE_LIMIT\}/);
  });

  it("DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT contains 4 slots", () => {
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT).toMatch(/\{PATH_DECODED\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT).toMatch(/\{RECIPIENT\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT).toMatch(/\{AMOUNT_IN\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT).toMatch(/\{AMOUNT_OUT_MIN\}/);
  });

  it("DECODED_ARGS_TEMPLATE_UNISWAP_MULTICALL contains 3 slots", () => {
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_MULTICALL).toMatch(/\{DEADLINE_ISO\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_MULTICALL).toMatch(/\{SUB_CALL_COUNT\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_MULTICALL).toMatch(/\{SUB_CALLS_RENDERED\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_MULTICALL).toMatch(/multicall/);
  });

  it("DECODED_ARGS_TEMPLATE_UNISWAP_UNWRAP_WETH9 contains 2 slots", () => {
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_UNWRAP_WETH9).toMatch(/\{AMOUNT_MINIMUM\}/);
    expect(DECODED_ARGS_TEMPLATE_UNISWAP_UNWRAP_WETH9).toMatch(/\{RECIPIENT\}/);
  });

  it("buildUniswapV3DecodedArgsBlock — exactInputSingle case renders all 7 fields", () => {
    const out = buildUniswapV3DecodedArgsBlock({
      kind: "exactInputSingle",
      tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
      tokenOut: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
      fee: 500,
      recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
      amountIn: 100_000000n,
      amountOutMinimum: 48_100_000_000_000_000n,
      sqrtPriceLimitX96: 0n,
    });
    // All 7 fields render — no raw {PLACEHOLDER} remains.
    expect(out).not.toMatch(/\{[A-Z_]+\}/);
    expect(out).toContain("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    expect(out).toContain("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
    expect(out).toContain("500");
    expect(out).toContain("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(out).toContain("100000000");
    expect(out).toContain("48100000000000000");
    expect(out).toMatch(/sqrtPriceLimitX96:\s+0/);
  });

  it("buildUniswapV3DecodedArgsBlock — exactInput case renders pre-formatted path", () => {
    const out = buildUniswapV3DecodedArgsBlock({
      kind: "exactInput",
      pathDecoded: "USDC → 0.30% → WETH → 0.30% → WBTC",
      recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
      amountIn: 100_000000n,
      amountOutMinimum: 1n,
    });
    expect(out).not.toMatch(/\{[A-Z_]+\}/);
    expect(out).toContain("USDC → 0.30% → WETH → 0.30% → WBTC");
    expect(out).toContain("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  });

  it("buildUniswapV3DecodedArgsBlock — multicall case recurses sub-calls with 2-space indent", () => {
    const out = buildUniswapV3DecodedArgsBlock({
      kind: "multicall",
      deadline: 1748707200n,
      subCalls: [
        {
          kind: "exactInputSingle",
          tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
          tokenOut: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
          fee: 500,
          recipient: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as Address,
          amountIn: 100_000000n,
          amountOutMinimum: 48_100_000_000_000_000n,
          sqrtPriceLimitX96: 0n,
        },
        {
          kind: "unwrapWETH9",
          amountMinimum: 48_100_000_000_000_000n,
          recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
        },
      ],
    });
    // Outer wrapper rendered + both sub-call blocks present.
    expect(out).toContain("multicall");
    expect(out).toContain("exactInputSingle");
    expect(out).toContain("unwrapWETH9");
    // 2-space indent prefixes the inner sub-call lines (separate from the
    // outer template's "  amountIn:" prefix — inner blocks compose to 4-space
    // when nested under outer's "  inner calls:" header).
    expect(out).toMatch(/\n {2}DECODED ARGS — exactInputSingle/);
    expect(out).toMatch(/\n {2}DECODED ARGS — unwrapWETH9/);
    // sub-call count surfaces.
    expect(out).toMatch(/sub-call count:\s+2/);
  });

  it("buildUniswapV3DecodedArgsBlock — multicall renders deadline as ISO timestamp", () => {
    const out = buildUniswapV3DecodedArgsBlock({
      kind: "multicall",
      deadline: 1748707200n,
      subCalls: [],
    });
    // 1748707200 * 1000 = 1748707200000ms; ISO = 2025-05-31T16:00:00.000Z
    // (Plan 32-01 fixture comment said "12:00 UTC" — off-by-4-hours from actual UTC).
    expect(out).toContain("2025-05-31T16:00:00.000Z");
  });

  it("buildUniswapV3DecodedArgsBlock — unwrapWETH9 case renders amountMinimum + recipient", () => {
    const out = buildUniswapV3DecodedArgsBlock({
      kind: "unwrapWETH9",
      amountMinimum: 48_100_000_000_000_000n,
      recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
    });
    expect(out).not.toMatch(/\{[A-Z_]+\}/);
    expect(out).toContain("48100000000000000");
    expect(out).toContain("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  });

  it("APPEND-ONLY discipline — Plan 32-01 templates remain accessible by name", () => {
    expect(LEDGER_NOTICE_UNISWAP_V3_TEMPLATE.length).toBeGreaterThan(100);
    expect(SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE.length).toBeGreaterThan(100);
  });
});
