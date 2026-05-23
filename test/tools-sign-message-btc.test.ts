// `sign_message_btc` end-to-end regression. Phase 24 — Plan 24-02.
//
// BTC-W-03: BIP-137 message signing via the Ledger BTC app (direct sign, no
// prepare/preview/send pipeline, no handle, no broadcast).
//
// Load-bearing invariants:
//
//   1. **Fixture W consumer re-anchor** — the BIP-137 double-SHA256 message hash
//      for "Hello VaultPilot" (pinned in test/signing-bip137.test.ts) is
//      cross-linked HERE in the `messageHash` field assertion. Drift in the
//      preimage assembly fails at BOTH files — load-bearing redundancy per
//      CLAUDE.md fixture discipline.
//
//   2. **No double-prefix** — a test asserts the hex passed to the device spy
//      contains NO "Bitcoin Signed Message:\n" substring (T-24-08). The tool
//      sends raw message bytes only; the Ledger BTC app applies the magic
//      prefix internally.
//
//   3. **DEMO_MODE_REFUSED** — in demo mode (no device), the tool returns
//      DEMO_MODE_REFUSED (unlike prepare_btc_send which uses WRONG_MODE — a
//      direct-sign tool has no persona fallback).
//
//   4. **WALLET_NOT_PAIRED** — with no paired BTC account, the tool returns
//      WALLET_NOT_PAIRED.
//
//   5. **65-byte compact signature** — signatureBase64 decodes to exactly 65
//      bytes; header byte == v + 39 for P2WPKH bech32.
//
// Mocks:
//   - `listAccounts` mocked to control pairing state.
//   - `vi.spyOn(_btcLedgerTransport, "signBtcMessage")` for the device call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const { listAccountsSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
}));

// Mock non-evm-account-store's `listAccounts` (BTC pairing surface).
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

import { _btcLedgerTransport } from "../src/wallet/ledger-btc-transport.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// ─── Helper ───────────────────────────────────────────────────────────────────

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("sign_message_btc");
  if (!tool) throw new Error("sign_message_btc not registered");
  return tool.handler(args);
}

// ─── Fixture constants ────────────────────────────────────────────────────────

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Fixture W — BIP-137 double-SHA256 message hash for "Hello VaultPilot".
// Cross-link: pinned as a hardcoded literal in test/signing-bip137.test.ts.
// This assertion cross-anchors the messageHash field in the tool response.
const FIXTURE_W_MESSAGE_HASH =
  "0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e";
const FIXTURE_W_MESSAGE = "Hello VaultPilot";

// A canonical paired BTC segwit account (real-mode shape from pair_btc_ledger).
const PAIRED_BTC_SEGWIT_ACCOUNT = {
  chain: "bitcoin" as const,
  address: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
  derivationPath: "84'/0'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

// Stub Ledger signBtcMessage return value (v=0 recovery_id, 32-byte r and s).
const STUB_SIGN_RESULT = {
  v: 0,
  r: "aa".repeat(32), // 32 bytes hex
  s: "bb".repeat(32), // 32 bytes hex
};

// ─── Setup + teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  // Pin to real-mode deterministically. `delete` alone is insufficient
  // because the resolver falls through to readConfigFile() and, if no
  // ~/.vaultpilot-mcp/config.json exists, lands in `auto-demo` →
  // isDemoMode() returns true and the sign_message_btc guard refuses.
  // Tests that need demo mode flip this to "true" + _resetDemoModeForTesting.
  process.env[DEMO_KEY] = "false";
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

describe("sign_message_btc — BTC-W-03 BIP-137 message signing", () => {
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
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    const result = await callTool({
      wallet: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("empty message → structured INVALID_INPUT error", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    const result = await callTool({
      wallet: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
      message: "",
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
      wallet: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
      message: FIXTURE_W_MESSAGE,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("DEMO_MODE_REFUSED");
  });

  // --------------------------------------------------------------------------
  // WALLET_NOT_PAIRED: no paired BTC account
  // --------------------------------------------------------------------------
  it("no paired BTC accounts → WALLET_NOT_PAIRED", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      wallet: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
      message: FIXTURE_W_MESSAGE,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("WALLET_NOT_PAIRED");
  });

  it("wallet not matching any paired account → error (INVALID_INPUT or WALLET_NOT_PAIRED)", async () => {
    // Paired account has a different address than the requested wallet.
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);

    const result = await callTool({
      wallet: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", // different address
      message: FIXTURE_W_MESSAGE,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    // Either INVALID_INPUT or WALLET_NOT_PAIRED is acceptable per plan.
    expect(["INVALID_INPUT", "WALLET_NOT_PAIRED"]).toContain(sc["errorCode"]);
  });

  // --------------------------------------------------------------------------
  // Success path: paired account matches wallet, Ledger signs
  // --------------------------------------------------------------------------
  it("success: returns address, message, signatureBase64, messageHash, LEDGER BLIND-SIGN HASH block", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_btcLedgerTransport, "signBtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT,
    );

    const result = await callTool({
      wallet: PAIRED_BTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_W_MESSAGE,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["address"]).toBe(PAIRED_BTC_SEGWIT_ACCOUNT.address);
    expect(sc["message"]).toBe(FIXTURE_W_MESSAGE);
    expect(typeof sc["signatureBase64"]).toBe("string");
    expect(typeof sc["messageHash"]).toBe("string");

    // Content should include LEDGER BLIND-SIGN HASH block.
    const textContent = result.content
      .map((c: { type: string; text: string }) => c.text)
      .join("\n");
    expect(textContent).toMatch(/LEDGER BLIND-SIGN HASH/);
  });

  // --------------------------------------------------------------------------
  // Fixture W re-anchor: messageHash == double-SHA256 of BIP-137 preimage
  // Cross-link: pinned in test/signing-bip137.test.ts as the canonical literal.
  // --------------------------------------------------------------------------
  it("Fixture W re-anchor: messageHash for 'Hello VaultPilot' is 0xca329b... byte-for-byte", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_btcLedgerTransport, "signBtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT,
    );

    const result = await callTool({
      wallet: PAIRED_BTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_W_MESSAGE,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    // Hardcoded Fixture W — cross-link from signing-bip137.test.ts.
    expect(sc["messageHash"]).toBe(FIXTURE_W_MESSAGE_HASH);
  });

  // --------------------------------------------------------------------------
  // 65-byte compact signature: header byte == v + 39, correct r and s layout
  // --------------------------------------------------------------------------
  it("signatureBase64 decodes to exactly 65 bytes with correct header byte (v=0 → 39)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_btcLedgerTransport, "signBtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT, // v=0
    );

    const result = await callTool({
      wallet: PAIRED_BTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_W_MESSAGE,
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
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_btcLedgerTransport, "signBtcMessage").mockResolvedValue({
      v: 1, // recovery_id = 1
      r: "cc".repeat(32),
      s: "dd".repeat(32),
    });

    const result = await callTool({
      wallet: PAIRED_BTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_W_MESSAGE,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    const sigBytes = Buffer.from(sc["signatureBase64"] as string, "base64");
    // v=1 → header = 1 + 39 = 40
    expect(sigBytes[0]).toBe(40);
  });

  // --------------------------------------------------------------------------
  // T-24-08: No double-prefix — the hex passed to the device must NOT contain
  // "Bitcoin Signed Message:\n" as a substring.
  // The tool sends raw message bytes only; the Ledger BTC app applies the
  // magic prefix internally (RESEARCH §BIP-137 Verified Details Pitfall 3).
  // --------------------------------------------------------------------------
  it("T-24-08: no double-prefix — messageHex passed to device does NOT contain magic prefix bytes", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    const signSpy = vi
      .spyOn(_btcLedgerTransport, "signBtcMessage")
      .mockResolvedValue(STUB_SIGN_RESULT);

    await callTool({
      wallet: PAIRED_BTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_W_MESSAGE,
    });

    expect(signSpy).toHaveBeenCalledTimes(1);
    const [, calledMessageHex] = signSpy.mock.calls[0]!;

    // The magic prefix "Bitcoin Signed Message:\n" in hex would start with
    // "426974636f696e205369676e6564204d6573736167653a0a" — this must NOT
    // appear in the messageHex passed to the device.
    const magicHex = Buffer.from("Bitcoin Signed Message:\n", "utf8").toString("hex");
    expect(calledMessageHex).not.toContain(magicHex);

    // The messageHex SHOULD be the raw message bytes only.
    const expectedHex = Buffer.from(FIXTURE_W_MESSAGE, "utf8").toString("hex");
    expect(calledMessageHex).toBe(expectedHex);
  });

  // --------------------------------------------------------------------------
  // T-24-11: signBtcMessage is called with the paired account's derivation path
  // --------------------------------------------------------------------------
  it("T-24-11: signBtcMessage is called with the paired account derivation path", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    const signSpy = vi
      .spyOn(_btcLedgerTransport, "signBtcMessage")
      .mockResolvedValue(STUB_SIGN_RESULT);

    await callTool({
      wallet: PAIRED_BTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_W_MESSAGE,
    });

    expect(signSpy).toHaveBeenCalledTimes(1);
    const [calledPath] = signSpy.mock.calls[0]!;
    // The derivation path should match the paired account's path.
    expect(calledPath).toBe(PAIRED_BTC_SEGWIT_ACCOUNT.derivationPath);
  });

  // --------------------------------------------------------------------------
  // No handle created: sign_message_btc is a direct sign tool (BTC-W-03 scope).
  // --------------------------------------------------------------------------
  it("sign_message_btc creates no handle (direct sign — no prepare/preview/send pipeline)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_btcLedgerTransport, "signBtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT,
    );

    const result = await callTool({
      wallet: PAIRED_BTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_W_MESSAGE,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    // No handle field in structuredContent.
    expect(sc["handle"]).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Message text is surfaced in the LEDGER BLIND-SIGN HASH block
  // --------------------------------------------------------------------------
  it("LEDGER BLIND-SIGN HASH block contains the message text and message hash", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_btcLedgerTransport, "signBtcMessage").mockResolvedValue(
      STUB_SIGN_RESULT,
    );

    const result = await callTool({
      wallet: PAIRED_BTC_SEGWIT_ACCOUNT.address,
      message: FIXTURE_W_MESSAGE,
    });

    const textContent = result.content
      .map((c: { type: string; text: string }) => c.text)
      .join("\n");

    expect(textContent).toMatch(/LEDGER BLIND-SIGN HASH/);
    expect(textContent).toContain(FIXTURE_W_MESSAGE);
    expect(textContent).toContain(FIXTURE_W_MESSAGE_HASH);
  });
});
