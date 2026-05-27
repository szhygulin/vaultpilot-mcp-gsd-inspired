// Template-shape + literal-title byte-identity regression for the Phase 38
// Inv #12.5 hard-trigger block templates.
//
// Phase 38 — Plan 38-01 (SAFE-09). Anchors:
//   - The block titles `[HARD-TRIGGER — MODULE ENABLE]` and `[HARD-TRIGGER —
//     DELEGATECALL]` are LOAD-BEARING format-fanout-sentinels — the
//     `vaultpilot-preflight` v1.4 Step 0.5 skill-side scan keys on these
//     literals. Drift (em-dash → ASCII hyphen, case change, spacing change)
//     breaks Inv #12.5 enforcement coupling.
//   - The {MODULE_ADDRESS} / {SAFE_ADDRESS} / {HANDLE} placeholder slots
//     substitute cleanly at the emission site — zero `{` characters survive
//     a fully-populated emission.
//   - The PASTEABLE_BLOCK_TEMPLATE_SAFE template (A1 resolution — for
//     PreparedTxSafeTypedData handles) carries Safe-shape slots NOT the
//     EVM-sentinel slots; the `>>>>` / `<<<<` markers are preserved (skill-
//     side `markers preserved` requirement).
//
// Format-fanout-sentinel discipline cross-check: each block title literal
// appears exactly ONCE in src/signing/blocks.ts (filtered to exclude
// comment lines).

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  HARD_TRIGGER_DELEGATECALL_TEMPLATE,
  HARD_TRIGGER_MODULE_ENABLE_TEMPLATE,
  PASTEABLE_BLOCK_TEMPLATE_SAFE,
} from "../src/signing/blocks.js";

const execFile = promisify(execFileCallback);

describe("HARD_TRIGGER_MODULE_ENABLE_TEMPLATE — literal-title byte-identity", () => {
  it("contains the literal block title '[HARD-TRIGGER — MODULE ENABLE]' (em-dash, not ASCII hyphen)", () => {
    expect(HARD_TRIGGER_MODULE_ENABLE_TEMPLATE).toContain(
      "[HARD-TRIGGER — MODULE ENABLE]",
    );
  });

  it("contains placeholder slots {MODULE_ADDRESS}, {SAFE_ADDRESS}, {HANDLE} exactly once each", () => {
    const count = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;
    expect(count(HARD_TRIGGER_MODULE_ENABLE_TEMPLATE, "{MODULE_ADDRESS}")).toBe(
      1,
    );
    expect(count(HARD_TRIGGER_MODULE_ENABLE_TEMPLATE, "{SAFE_ADDRESS}")).toBe(
      1,
    );
    expect(count(HARD_TRIGGER_MODULE_ENABLE_TEMPLATE, "{HANDLE}")).toBe(1);
  });

  it("post-substitution emit contains zero remaining UPPERCASE-placeholder sentinels (drift means we missed a slot)", () => {
    const emitted = HARD_TRIGGER_MODULE_ENABLE_TEMPLATE
      .replace("{MODULE_ADDRESS}", "0xcafe0000000000000000000000000000cafe0001")
      .replace("{SAFE_ADDRESS}", "0xdead0000000000000000000000000000dead0001")
      .replace("{HANDLE}", "01234567-89ab-cdef-0123-456789abcdef");
    // Placeholder sentinels are ALL-CAPS-underscored — the prose can contain
    // literal "{ handle: ..." JS-object syntax (lowercase) which is NOT a
    // placeholder. Assert only the all-caps pattern is fully substituted.
    expect(/\{[A-Z_]+\}/.test(emitted)).toBe(false);
  });
});

describe("HARD_TRIGGER_DELEGATECALL_TEMPLATE — literal-title byte-identity", () => {
  it("contains the literal block title '[HARD-TRIGGER — DELEGATECALL]' (em-dash, not ASCII hyphen)", () => {
    expect(HARD_TRIGGER_DELEGATECALL_TEMPLATE).toContain(
      "[HARD-TRIGGER — DELEGATECALL]",
    );
  });

  it("contains placeholder slots {SAFE_ADDRESS} + {HANDLE} exactly once each; does NOT contain {MODULE_ADDRESS}", () => {
    const count = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;
    expect(count(HARD_TRIGGER_DELEGATECALL_TEMPLATE, "{SAFE_ADDRESS}")).toBe(1);
    expect(count(HARD_TRIGGER_DELEGATECALL_TEMPLATE, "{HANDLE}")).toBe(1);
    expect(HARD_TRIGGER_DELEGATECALL_TEMPLATE.includes("{MODULE_ADDRESS}")).toBe(
      false,
    );
  });

  it("post-substitution emit contains zero remaining UPPERCASE-placeholder sentinels (drift means we missed a slot)", () => {
    const emitted = HARD_TRIGGER_DELEGATECALL_TEMPLATE
      .replace("{SAFE_ADDRESS}", "0xdead0000000000000000000000000000dead0001")
      .replace("{HANDLE}", "01234567-89ab-cdef-0123-456789abcdef");
    expect(/\{[A-Z_]+\}/.test(emitted)).toBe(false);
  });
});

describe("PASTEABLE_BLOCK_TEMPLATE_SAFE — A1 resolution (Safe-shape paste-able block)", () => {
  it("contains all 8 Safe-shape placeholder slots exactly once each", () => {
    const count = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;
    expect(count(PASTEABLE_BLOCK_TEMPLATE_SAFE, "{CHAIN_ID}")).toBe(1);
    expect(count(PASTEABLE_BLOCK_TEMPLATE_SAFE, "{SAFE_ADDRESS}")).toBe(1);
    expect(count(PASTEABLE_BLOCK_TEMPLATE_SAFE, "{SAFE_TX_TO}")).toBe(1);
    expect(count(PASTEABLE_BLOCK_TEMPLATE_SAFE, "{SAFE_TX_VALUE}")).toBe(1);
    expect(count(PASTEABLE_BLOCK_TEMPLATE_SAFE, "{SAFE_TX_DATA}")).toBe(1);
    expect(count(PASTEABLE_BLOCK_TEMPLATE_SAFE, "{OPERATION}")).toBe(1);
    expect(count(PASTEABLE_BLOCK_TEMPLATE_SAFE, "{SAFE_TX_HASH}")).toBe(1);
    expect(count(PASTEABLE_BLOCK_TEMPLATE_SAFE, "{PAYLOAD_FINGERPRINT}")).toBe(
      1,
    );
  });

  it("preserves the '>>>>' open + '<<<<' close marker shape (load-bearing for the skill-side 'markers preserved' requirement)", () => {
    expect(PASTEABLE_BLOCK_TEMPLATE_SAFE).toMatch(/>>>>+/);
    expect(PASTEABLE_BLOCK_TEMPLATE_SAFE).toMatch(/<<<<+/);
  });

  it("does NOT contain the EVM-sentinel slot names {TO} / {VALUE_WEI} / {DATA} (Safe template MUST surface real Safe fields, not EVM sentinels)", () => {
    // Use exact-token matches (boundary-checked) so the substring "{TO}" in
    // "{SAFE_TX_TO}" doesn't false-positive.
    expect(/\{TO\}/.test(PASTEABLE_BLOCK_TEMPLATE_SAFE)).toBe(false);
    expect(/\{VALUE_WEI\}/.test(PASTEABLE_BLOCK_TEMPLATE_SAFE)).toBe(false);
    expect(/\{DATA\}/.test(PASTEABLE_BLOCK_TEMPLATE_SAFE)).toBe(false);
  });
});

describe("HARD_TRIGGER block titles — format-fanout-sentinel SOT discipline", () => {
  // We count occurrences of the literal title inside ACTUAL string-literal
  // emission (a `"` quote precedes the `[`). JSDoc + line comments use
  // backticks around the title (e.g. `[HARD-TRIGGER — MODULE ENABLE]`) and
  // are excluded. The string-literal occurrence is the load-bearing one —
  // that's what the skill-side scan reads from the response text.
  it("'[HARD-TRIGGER — MODULE ENABLE]' string-literal emission appears exactly once in src/signing/blocks.ts", async () => {
    const { stdout } = await execFile("grep", [
      "-cE",
      '"\\[HARD-TRIGGER — MODULE ENABLE\\]"',
      "src/signing/blocks.ts",
    ]);
    expect(parseInt(stdout.trim(), 10)).toBe(1);
  });

  it("'[HARD-TRIGGER — DELEGATECALL]' string-literal emission appears exactly once in src/signing/blocks.ts", async () => {
    const { stdout } = await execFile("grep", [
      "-cE",
      '"\\[HARD-TRIGGER — DELEGATECALL\\]"',
      "src/signing/blocks.ts",
    ]);
    expect(parseInt(stdout.trim(), 10)).toBe(1);
  });
});
