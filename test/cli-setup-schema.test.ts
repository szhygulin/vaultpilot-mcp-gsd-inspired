// test/cli-setup-schema.test.ts — Phase 10 / Plan 10-03 (DIST-42).
//
// Single Source of Truth coverage for `src/cli/setup-schema.ts`. Both the
// interactive wizard (`setup-prompts.ts`) and the non-interactive JSON
// reader (`setup-non-interactive.ts`) MUST validate through this schema —
// T-WIZARD-SCHEMA-SOT-1 invariant. The cross-test below asserts both
// consumers actually import `SetupPayloadSchema` from this file.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  REDACTED_LITERAL,
  SetupPayloadSchema,
  redactForEnvelope,
  type SetupPayload,
} from "../src/cli/setup-schema.js";

describe("setup-schema — Zod SOT", () => {
  it("Test 1 — round-trips a valid payload byte-for-byte", () => {
    const valid: SetupPayload = {
      walletConnectProjectId: "abcdef12-3456-7890",
      rpcUrl: "https://eth-mainnet.example/v2/somekey",
      rpcProvider: "explicit",
      etherscanApiKey: "ABCDEFGHIJ1234567890",
      registerWith: ["claude-code", "cursor"],
      skipLedgerPairing: false,
    };
    expect(SetupPayloadSchema.parse(valid)).toEqual(valid);
  });

  it("Test 2 — rejects rpcUrl without https:// prefix", () => {
    const bad = { rpcUrl: "http://eth-mainnet.example" };
    expect(SetupPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("Test 3 — rejects rpcUrl that is not a valid URL", () => {
    const bad = { rpcUrl: "not-a-url" };
    expect(SetupPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it("Test 4 — rejects Etherscan key outside /^[A-Z0-9]{20,40}$/", () => {
    expect(
      SetupPayloadSchema.safeParse({ etherscanApiKey: "lowercase-key" }).success,
    ).toBe(false);
    expect(
      SetupPayloadSchema.safeParse({ etherscanApiKey: "TOOSHORT" }).success,
    ).toBe(false);
  });

  it("Test 5 — accepts an empty payload (every field optional)", () => {
    expect(SetupPayloadSchema.parse({})).toEqual({});
  });

  it("Test 6 — rejects unknown extra fields (strict mode)", () => {
    const withExtra = { rpcProvider: "infura", evilField: "x" };
    expect(SetupPayloadSchema.safeParse(withExtra).success).toBe(false);
  });

  it("Test 7 — rejects registerWith entries outside the enum", () => {
    expect(
      SetupPayloadSchema.safeParse({ registerWith: ["unknown-ide"] }).success,
    ).toBe(false);
  });
});

describe("setup-schema — redactForEnvelope (T-CONFIG-LEAK-1)", () => {
  it("Test 8 — replaces every secret-bearing field with ***REDACTED***", () => {
    const payload: SetupPayload = {
      walletConnectProjectId: "wc-secret-abcdef12",
      rpcUrl: "https://eth-mainnet.example/v2/rpc-secret-xyz",
      rpcApiKey: "rpc-secret-key-zzz",
      etherscanApiKey: "ETHERSCANSECRET12345",
      rpcProvider: "alchemy",
      registerWith: ["claude-desktop"],
      skipLedgerPairing: true,
    };
    const redacted = redactForEnvelope(payload);
    expect(redacted.walletConnectProjectId).toBe(REDACTED_LITERAL);
    expect(redacted.rpcUrl).toBe(REDACTED_LITERAL);
    expect(redacted.rpcApiKey).toBe(REDACTED_LITERAL);
    expect(redacted.etherscanApiKey).toBe(REDACTED_LITERAL);
    // Non-secret fields pass through
    expect(redacted.rpcProvider).toBe("alchemy");
    expect(redacted.registerWith).toEqual(["claude-desktop"]);
    expect(redacted.skipLedgerPairing).toBe(true);
  });

  it("Test 9 — undefined secret fields stay undefined after redaction", () => {
    const payload: SetupPayload = { rpcProvider: "publicnode" };
    const redacted = redactForEnvelope(payload);
    expect(redacted.walletConnectProjectId).toBeUndefined();
    expect(redacted.rpcUrl).toBeUndefined();
    expect(redacted.rpcApiKey).toBeUndefined();
    expect(redacted.etherscanApiKey).toBeUndefined();
    expect(redacted.rpcProvider).toBe("publicnode");
  });

  it("Test 10 — none of the original secret bytes appear in the redacted output", () => {
    const SENTINEL_1 = "wcsentineldonotleakABCD";
    const SENTINEL_2 = "rpc-sentinel-do-not-leak-2";
    const SENTINEL_3 = "ETHSCANSENTINELDONOTLEAK1";
    const payload: SetupPayload = {
      walletConnectProjectId: SENTINEL_1,
      rpcUrl: `https://example/v2/${SENTINEL_2}`,
      etherscanApiKey: SENTINEL_3,
    };
    const serialized = JSON.stringify(redactForEnvelope(payload));
    expect(serialized).not.toContain(SENTINEL_1);
    expect(serialized).not.toContain(SENTINEL_2);
    expect(serialized).not.toContain(SENTINEL_3);
    expect(serialized).toContain(REDACTED_LITERAL);
  });
});

describe("setup-schema — T-WIZARD-SCHEMA-SOT-1 cross-test", () => {
  // The interactive (`setup-prompts.ts`) and non-interactive
  // (`setup-non-interactive.ts`) paths MUST both import
  // `SetupPayloadSchema` from `setup-schema.ts`. Drift in either consumer's
  // schema-import path breaks this assertion. If a future refactor moves
  // either consumer to a different validation layer, surface that change
  // here — DO NOT just weaken this test.
  it("Test 11 — both wizard consumers import SetupPayloadSchema from setup-schema", () => {
    const promptsTs = readFileSync(
      join(process.cwd(), "src/cli/setup-prompts.ts"),
      "utf8",
    );
    const nonInteractiveTs = readFileSync(
      join(process.cwd(), "src/cli/setup-non-interactive.ts"),
      "utf8",
    );

    for (const source of [promptsTs, nonInteractiveTs]) {
      // Both consumers must reach the SOT — accept either named or bundled import.
      expect(source).toMatch(/SetupPayloadSchema/);
      expect(source).toMatch(/from\s+"\.\/setup-schema(?:\.js)?"/);
    }
  });
});
