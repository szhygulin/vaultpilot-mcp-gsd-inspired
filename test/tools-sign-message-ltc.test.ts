// `sign_message_ltc` end-to-end regression. Phase 26 — Plan 26-02.
//
// LTC-W-02: BIP-137 message signing via the Ledger LTC app (direct sign, no
// prepare/preview/send pipeline, no handle, no broadcast).
//
// Load-bearing invariants:
//
//   1. **Fixture Z consumer re-anchor** — the LTC BIP-137 double-SHA256 message
//      hash for "Hello VaultPilot" (pinned in test/signing-bip137-ltc.test.ts) is
//      cross-linked HERE in the `messageHash` field assertion. Drift in the LTC
//      preimage assembly fails at BOTH files — load-bearing redundancy per
//      CLAUDE.md fixture discipline.
//
//   2. **No double-prefix** — a test asserts the hex passed to the device spy
//      contains NO "Litecoin Signed Message:\n" substring. The tool sends raw
//      message bytes only; the Ledger LTC app applies the magic prefix internally
//      (Pitfall 3 mirror for LTC).
//
//   3. **DEMO_MODE_REFUSED** — in demo mode (no device), the tool returns
//      DEMO_MODE_REFUSED (direct-sign tool, no persona fallback).
//
//   4. **WALLET_NOT_PAIRED** — with no paired LTC account, the tool returns
//      WALLET_NOT_PAIRED.
//
//   5. **65-byte compact signature** — signatureBase64 decodes to exactly 65
//      bytes; header byte == v + 39 for P2WPKH bech32 (ltc1q…).
//
//   6. **Cross-chain distinctness** — Fixture Z (LTC) differs from Fixture W
//      (BTC) for the same message — the LTC magic varint 0x19 (25 bytes) vs
//      BTC varint 0x18 (24 bytes) ensures non-replayability.
//
// Mocks:
//   - `listAccounts` mocked to control pairing state.
//   - `vi.spyOn(_ltcLedgerTransport, "signLtcMessage")` for the device call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const { listAccountsSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
}));

// Mock non-evm-account-store's `listAccounts` (LTC pairing surface).
vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (
      ...args: Parameters<typeof actual.listAccounts>
    ) => listAccountsSpy(...args),
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { _ltcLedgerTransport } from "../src/wallet/ledger-btc-transport.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// ─── Helper ───────────────────────────────────────────────────────────────────

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("sign_message_ltc");
  if (!tool) throw new Error("sign_message_ltc not registered");
  return tool.handler(args);
}

// ─── Fixture constants ────────────────────────────────────────────────────────

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Fixture Z — LTC BIP-137 double-SHA256 message hash for "Hello VaultPilot".
// Cross-link: pinned as a hardcoded literal in test/signing-bip137-ltc.test.ts.
// This assertion cross-anchors the messageHash field in the tool response.
const FIXTURE_Z_MESSAGE_HASH =
  "0xa36092f90d13deb6c7c45317bfdefd101325fc919e40d46cf0532f7e99e4b676";

// Fixture W — BTC Fixture for cross-chain distinctness assertion.
// Cross-link: pinned in test/signing-bip137.test.ts.
const FIXTURE_W_MESSAGE_HASH =
  "0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e";

const FIXTURE_Z_MESSAGE = "Hello VaultPilot";

// A canonical paired LTC segwit account (real-mode shape from pair_litecoin_ledger).
// Address: ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9
// Generated from compressed pubkey of privKey=[0x00…01] via P2WPKH + LTC_NETWORK.
// Passes both LTC_SEGWIT_RE regex AND bitcoinjs bech32 checksum validation.
const PAIRED_LTC_SEGWIT_ACCOUNT = {
  chain: "litecoin" as const,
  address: "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9",
  derivationPath: "84'/2'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

// Stub Ledger signLtcMessage return value (v=0 recovery_id, 32-byte r and s).
const STUB_SIGN_RESULT = {
  v: 0,
  r: "aa".repeat(32), // 32 bytes hex
  s: "bb".repeat(32), // 32 bytes hex
};

// ─── Setup + teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  delete process.env[DEMO_KEY];
  _resetDemoModeForTesting();
  listAccountsSpy.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  if (savedDemo !== undefined) {
    process.env[DEMO_KEY] = savedDemo;
  } else {
    delete process.env[DEMO_KEY];
  }
  _resetDemoModeForTesting();
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sign_message_ltc — LTC-W-02 BIP-137 message signing", () => {
  // --------------------------------------------------------------------------
  // INVALID_INPUT: missing wallet or message
  // --------------------------------------------------------------------------
  it("missing wallet → structured INVALID_INPUT error", async () => {
    listAccountsSpy.mockReturnValue([]);
    const result = await callTool({ message: "test" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("missing message → structured INVALID_INPUT error", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("empty message → structured INVALID_INPUT error", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: "",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("BTC address instead of LTC address → INVALID_INPUT (wrong chain)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    const result = await callTool({
      wallet: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h", // BTC address
      message: FIXTURE_Z_MESSAGE,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  // --------------------------------------------------------------------------
  // DEMO_MODE_REFUSED: demo mode active → direct-sign tools refuse
  // --------------------------------------------------------------------------
  it("demo mode active → DEMO_MODE_REFUSED (no device available in demo)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("DEMO_MODE_REFUSED");
  });

  // --------------------------------------------------------------------------
  // WALLET_NOT_PAIRED: no paired LTC account
  // --------------------------------------------------------------------------
  it("no paired LTC accounts → WALLET_NOT_PAIRED", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("WALLET_NOT_PAIRED");
  });

  it("wallet not matching any paired account → INVALID_INPUT", async () => {
    // Paired account has a different address than the requested wallet.
    // Second address: ltc1qq6hag67dl53wl99vzg42z8eyzfz2xlkvz9zn23
    // (generated from privKey=[0x00…02], valid bech32 checksum)
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);

    const result = await callTool({
      wallet: "ltc1qq6hag67dl53wl99vzg42z8eyzfz2xlkvz9zn23", // different valid address
      message: FIXTURE_Z_MESSAGE,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(["INVALID_INPUT", "WALLET_NOT_PAIRED"]).toContain(sc["errorCode"]);
  });

  // --------------------------------------------------------------------------
  // Success path: paired account matches wallet, Ledger signs
  // --------------------------------------------------------------------------
  it("success: returns address, message, signatureBase64, messageHash, LEDGER BLIND-SIGN HASH block", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "signLtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT,
    );

    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["address"]).toBe(PAIRED_LTC_SEGWIT_ACCOUNT.address);
    expect(sc["message"]).toBe(FIXTURE_Z_MESSAGE);
    expect(typeof sc["signatureBase64"]).toBe("string");
    expect(typeof sc["messageHash"]).toBe("string");

    // Content should include LEDGER BLIND-SIGN HASH block.
    const textContent = result.content
      .map((c: { type: string; text: string }) => c.text)
      .join("\n");
    expect(textContent).toMatch(/LEDGER BLIND-SIGN HASH/);
  });

  // --------------------------------------------------------------------------
  // Fixture Z re-anchor: messageHash == double-SHA256 of LTC BIP-137 preimage
  // Cross-link: pinned in test/signing-bip137-ltc.test.ts as the canonical literal.
  // --------------------------------------------------------------------------
  it("Fixture Z re-anchor: messageHash for 'Hello VaultPilot' is 0xa36092... byte-for-byte (LTC magic 0x19)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "signLtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT,
    );

    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    // Hardcoded Fixture Z — cross-link from signing-bip137-ltc.test.ts.
    expect(sc["messageHash"]).toBe(FIXTURE_Z_MESSAGE_HASH);
  });

  // --------------------------------------------------------------------------
  // Cross-chain distinctness: Fixture Z (LTC) != Fixture W (BTC) for same message.
  // T-26-05 signing variant: LTC magic (0x19) produces a different hash than
  // BTC magic (0x18) for the same plaintext message.
  // --------------------------------------------------------------------------
  it("cross-chain distinctness: LTC messageHash (Fixture Z) differs from BTC messageHash (Fixture W)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "signLtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT,
    );

    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE, // same message as Fixture W
    });

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["messageHash"]).not.toBe(FIXTURE_W_MESSAGE_HASH);
    expect(sc["messageHash"]).toBe(FIXTURE_Z_MESSAGE_HASH);
  });

  // --------------------------------------------------------------------------
  // 65-byte compact signature: header byte == v + 39, correct r and s layout
  // --------------------------------------------------------------------------
  it("signatureBase64 decodes to exactly 65 bytes with correct header byte (v=0 → 39)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "signLtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT, // v=0
    );

    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    const sigBytes = Buffer.from(sc["signatureBase64"] as string, "base64");

    expect(sigBytes.length).toBe(65);
    // v=0 → header = 0 + 39 = 39
    expect(sigBytes[0]).toBe(39);
    // r bytes (32 bytes from index 1..32)
    expect(sigBytes.slice(1, 33).toString("hex")).toBe("aa".repeat(32));
    // s bytes (32 bytes from index 33..64)
    expect(sigBytes.slice(33, 65).toString("hex")).toBe("bb".repeat(32));
  });

  it("signatureBase64 header byte for v=1 → 40", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "signLtcMessage").mockResolvedValue({
      v: 1, // recovery_id = 1
      r: "cc".repeat(32),
      s: "dd".repeat(32),
    });

    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    const sigBytes = Buffer.from(sc["signatureBase64"] as string, "base64");
    // v=1 → header = 1 + 39 = 40
    expect(sigBytes[0]).toBe(40);
  });

  // --------------------------------------------------------------------------
  // No double-prefix — the hex passed to the device must NOT contain
  // "Litecoin Signed Message:\n" as a substring.
  // The tool sends raw message bytes only; the Ledger LTC app applies the
  // magic prefix internally (Pitfall 3 mirror for LTC).
  // --------------------------------------------------------------------------
  it("no double-prefix — messageHex passed to device does NOT contain LTC magic prefix bytes", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    const signSpy = vi
      .spyOn(_ltcLedgerTransport, "signLtcMessage")
      .mockResolvedValue(STUB_SIGN_RESULT);

    await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE,
    });

    expect(signSpy).toHaveBeenCalledTimes(1);
    const [, calledMessageHex] = signSpy.mock.calls[0]!;

    // The magic prefix "Litecoin Signed Message:\n" in hex would start with
    // "4c697465636f696e205369676e6564204d6573736167653a0a"
    // This must NOT appear in the messageHex passed to the device.
    const magicHex = Buffer.from("Litecoin Signed Message:\n", "utf8").toString("hex");
    expect(calledMessageHex).not.toContain(magicHex);

    // The messageHex SHOULD be the raw message bytes only.
    const expectedHex = Buffer.from(FIXTURE_Z_MESSAGE, "utf8").toString("hex");
    expect(calledMessageHex).toBe(expectedHex);
  });

  // --------------------------------------------------------------------------
  // signLtcMessage is called with the paired account's derivation path
  // --------------------------------------------------------------------------
  it("signLtcMessage is called with the paired account derivation path", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    const signSpy = vi
      .spyOn(_ltcLedgerTransport, "signLtcMessage")
      .mockResolvedValue(STUB_SIGN_RESULT);

    await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE,
    });

    expect(signSpy).toHaveBeenCalledTimes(1);
    const [calledPath] = signSpy.mock.calls[0]!;
    // The derivation path should match the paired account's path.
    expect(calledPath).toBe(PAIRED_LTC_SEGWIT_ACCOUNT.derivationPath);
  });

  // --------------------------------------------------------------------------
  // No handle created: sign_message_ltc is a direct sign tool (LTC-W-02 scope).
  // --------------------------------------------------------------------------
  it("sign_message_ltc creates no handle (direct sign — no prepare/preview/send pipeline)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "signLtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT,
    );

    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    // No handle field in structuredContent.
    expect(sc["handle"]).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Message text is surfaced in the LEDGER BLIND-SIGN HASH block
  // --------------------------------------------------------------------------
  it("LEDGER BLIND-SIGN HASH block contains the LTC label, message text, and message hash", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "signLtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT,
    );

    const result = await callTool({
      wallet: PAIRED_LTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_Z_MESSAGE,
    });

    const textContent = result.content
      .map((c: { type: string; text: string }) => c.text)
      .join("\n");

    expect(textContent).toMatch(/LEDGER BLIND-SIGN HASH/);
    expect(textContent).toMatch(/LTC/);
    expect(textContent).toContain(FIXTURE_Z_MESSAGE);
    expect(textContent).toContain(FIXTURE_Z_MESSAGE_HASH);
  });
});
