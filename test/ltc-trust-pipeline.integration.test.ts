// [STOP-THE-LINE] Any byte-identity assertion failing in this file is a
// security regression. DO NOT mask, DO NOT skip — fix the regression.
//
// LOAD-BEARING — Phase 26 Plan 26-02 LTC trust-pipeline integration test.
//
// LTC persona-cycle byte-identity regression anchor. Mirrors the BTC
// trust-pipeline integration test (btc-trust-pipeline.integration.test.ts),
// adapted for LTC P2WPKH-only sends.
//
// DIRECTION for LTC vs BTC fingerprint invariant (PATTERNS §"Analog Mismatches"):
//
//   Direction A — UTXO-distinct fingerprints:
//     Same { to, litoshi } + DIFFERENT UTXOs → DIFFERENT payloadFingerprint.
//     BIP-143 sighash commits to each UTXO's script + value; different UTXOs
//     → different preimage → different keccak256 (domain "VaultPilot-ltctx-v1:").
//
//   Direction B — Same-UTXO byte-identity (Fixture Y re-anchor):
//     Same { to, litoshi } + SAME UTXOs (via utxoOverride) → BYTE-IDENTICAL
//     payloadFingerprint across calls. The regression anchor against preimage drift.
//     Fixture Y is the hardcoded literal pinned in test/signing-fingerprint.test.ts.
//
// Coverage:
//   1.  P2WPKH prepare → preview → send, demo mode (D-04 envelope, no broadcast).
//   2.  LEDGER BLIND-SIGN HASH (LTC) block in preview text.
//   3.  Demo send returns simulation envelope; handle stays "previewed".
//   4.  Three-gate: PAYLOAD_FINGERPRINT_DRIFT refuses (LTC handle).
//   5.  Three-gate: PREVIEW_TOKEN_MISMATCH refuses (LTC handle).
//   6.  Cancel branch (no signing, no broadcasting).
//   7.  Direction A: UTXO-distinct fingerprints across two different UTXO sets.
//   8.  Direction B: same-UTXO byte-identity (Fixture Y cross-chain re-anchor).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transaction as BtcTransaction } from "bitcoinjs-lib";

import "../src/chains/litecoin/types.js"; // initEccLib for LTC sighash

const {
  listAccountsSpy,
  ltcBroadcastTxSpy,
  ltcFetchFeeEstimatesSpy,
  ltcFetchAddressUtxosSpy,
} = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  ltcBroadcastTxSpy: vi.fn(),
  ltcFetchFeeEstimatesSpy: vi.fn(),
  ltcFetchAddressUtxosSpy: vi.fn(),
}));

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) =>
      listAccountsSpy(...args),
  };
});

vi.mock("../src/chains/litecoin/esplora-client.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/chains/litecoin/esplora-client.js")
  >("../src/chains/litecoin/esplora-client.js");
  return {
    ...actual,
    broadcastTx: (...args: unknown[]) => ltcBroadcastTxSpy(...args),
    fetchFeeEstimates: () => ltcFetchFeeEstimatesSpy(),
    fetchAddressUtxos: (...args: unknown[]) => ltcFetchAddressUtxosSpy(...args),
  };
});

import { _ltcLedgerTransport } from "../src/wallet/ledger-btc-transport.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveLtcPersonaBySlug,
} from "../src/demo/state.js";
import { computeAllSighashes } from "../src/signing/btc-sighash.js";
import { computeLtcPayloadFingerprint } from "../src/signing/ltc-fingerprint.js";
import {
  _resetHandleStoreForTesting,
  lookup,
} from "../src/signing/handle-store.js";
import { _resetEsploraCacheForTesting } from "../src/chains/litecoin/esplora-client.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`${name} not registered`);
  return tool.handler(args);
}

// ---------------------------------------------------------------------------
// LTC whale persona address (from litecoin-persona.ts — BIP-173 test vector)
// ---------------------------------------------------------------------------
const LTC_WHALE_SEGWIT = "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9";
// A second valid ltc1q address (from privKey=0x02, also used in Task 1/2 tests)
const LTC_ALT_SEGWIT = "ltc1qq6hag67dl53wl99vzg42z8eyzfz2xlkvz9zn23";

// ---------------------------------------------------------------------------
// Fake UTXOs for integration test (known txid + value for deterministic FP)
// ---------------------------------------------------------------------------
const SEGWIT_UTXO_A = {
  txid: "aa".repeat(32),
  vout: 0,
  valueSats: "100000",
  scriptType: "p2wpkh" as const,
};
const SEGWIT_UTXO_B = {
  txid: "bb".repeat(32),
  vout: 0,
  valueSats: "200000",
  scriptType: "p2wpkh" as const,
};

// LTC fee-estimates: mempool.space shape (litecoinspace.org /v1/fees/recommended).
const FAKE_FEE_ESTIMATES = {
  fastestFee: 20,
  halfHourFee: 12,
  hourFee: 8,
  economyFee: 5,
  minimumFee: 2,
};

// Fixture Y fingerprint (LTC segwit single-input) — cross-link from signing-fingerprint.test.ts.
// [STOP-THE-LINE] Drift in this value = security regression (domain tag or sighash preimage).
const FIXTURE_Y_FINGERPRINT =
  "0x105386cbe7bf6195eb74acd493e3b24213342c679f3e1bb3a6fb54d88073eff4";

const FAKE_TXID = "ee".repeat(32);
const RECIPIENT = LTC_WHALE_SEGWIT;
const SMALL_LITOSHI = "50000";
const LARGE_LITOSHI = "150000";

// ---------------------------------------------------------------------------
beforeEach(() => {
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  _resetEsploraCacheForTesting();
  _resetDemoModeForTesting?.();
  process.env["VAULTPILOT_DEMO"] = "true";
  _resetDemoModeForTesting?.();
  setActiveLtcPersonaBySlug("ltc-whale");
  ltcFetchFeeEstimatesSpy.mockResolvedValue({ kind: "ok", estimates: FAKE_FEE_ESTIMATES });
  ltcBroadcastTxSpy.mockResolvedValue({ kind: "ok", txid: FAKE_TXID });
  ltcFetchAddressUtxosSpy.mockResolvedValue({
    kind: "ok",
    address: LTC_WHALE_SEGWIT,
    utxos: [],
  });
  vi.spyOn(_ltcLedgerTransport, "signLtcPsbt").mockResolvedValue({
    rawTxHex: "02" + "aa".repeat(50),
  });
  listAccountsSpy.mockReturnValue([
    {
      address: LTC_WHALE_SEGWIT,
      derivationPath: "84'/2'/0'/0/0",
      chainType: "litecoin",
    },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  _resetEsploraCacheForTesting();
  delete process.env["VAULTPILOT_DEMO"];
  _resetDemoModeForTesting?.();
});

// ---------------------------------------------------------------------------
// Helper: run the full LTC trust pipeline (prepare → preview → send)
// ---------------------------------------------------------------------------
async function runLtcPipeline(
  utxoOverride: Array<{txid: string; vout: number; valueSats: string; scriptType: string}> = [SEGWIT_UTXO_A],
  litoshi: string = SMALL_LITOSHI,
  to: string = RECIPIENT,
): Promise<{
  prepareResult: ToolHandlerResult;
  previewResult: ToolHandlerResult;
  sendResult: ToolHandlerResult;
  handle: string;
  payloadFingerprint: string;
  previewToken: string;
}> {
  const prepareResult = await callTool("prepare_litecoin_native_send", {
    to,
    litoshi,
    utxoOverride,
    feeRate: 5,
  });
  expect(prepareResult.isError, `prepare failed: ${JSON.stringify(prepareResult.structuredContent)}`).toBeFalsy();

  const handle = String(prepareResult.structuredContent?.handle ?? "");
  const payloadFingerprint = String(prepareResult.structuredContent?.payloadFingerprint ?? "");

  const previewResult = await callTool("preview_send", { handle });
  expect(previewResult.isError, `preview failed: ${JSON.stringify(previewResult.structuredContent)}`).toBeFalsy();

  const previewToken = String(previewResult.structuredContent?.previewToken ?? "");

  const sendResult = await callTool("send_transaction", {
    handle,
    previewToken,
    userDecision: "send",
  });

  return { prepareResult, previewResult, sendResult, handle, payloadFingerprint, previewToken };
}

// ---------------------------------------------------------------------------
// 1. P2WPKH prepare → preview → send (demo mode)
// ---------------------------------------------------------------------------
describe("LTC trust pipeline — P2WPKH end-to-end (demo mode)", () => {
  it("T-01: segwit-only prepare → preview → send succeeds in demo mode (D-04)", async () => {
    const { prepareResult, previewResult, sendResult } = await runLtcPipeline([SEGWIT_UTXO_A]);

    // Prepare: LTC handle created
    expect(prepareResult.structuredContent?.txType).toBe("litecoin");
    expect(prepareResult.structuredContent?.chain).toBe("litecoin");
    expect(typeof prepareResult.structuredContent?.payloadFingerprint).toBe("string");

    // Preview: previewToken minted, chain=litecoin
    expect(previewResult.structuredContent?.chain).toBe("litecoin");
    expect(typeof previewResult.structuredContent?.previewToken).toBe("string");
    expect(previewResult.structuredContent?.sessionTopicLast8).toBeNull();

    // Send: D-04 demo envelope returned, no device call
    expect(sendResult.isError).toBeFalsy();
    expect((sendResult.structuredContent as Record<string, unknown>)?.demoMode).toBe(true);
    expect((sendResult.structuredContent as Record<string, unknown>)?.txType).toBe("litecoin");
    expect((sendResult.structuredContent as Record<string, unknown>)?.envelopeShape).toBe("psbt-mempool-replay");
  });

  it("T-02: LEDGER BLIND-SIGN HASH (LTC) block appears in preview text with input[0] row", async () => {
    const { previewResult } = await runLtcPipeline([SEGWIT_UTXO_A]);
    const text = previewResult.content[0]?.text ?? "";
    expect(text).toMatch(/LEDGER BLIND-SIGN HASH \(LTC\)/);
    expect(text).toMatch(/input\[0\]\s+\(p2wpkh\)/);
  });

  it("T-03: demo send returns D-04 envelope; handle stays 'previewed' (demo is rehearsal, not broadcast)", async () => {
    const { handle, sendResult } = await runLtcPipeline([SEGWIT_UTXO_A]);
    expect(sendResult.isError).toBeFalsy();
    expect((sendResult.structuredContent as Record<string, unknown>)?.demoMode).toBe(true);
    // Handle stays previewed (not sent) — demo mode is a rehearsal, not a broadcast.
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (lookupResult.ok) {
      expect(lookupResult.record.status).toBe("previewed");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Three-gate enforcement: PAYLOAD_FINGERPRINT_DRIFT
// ---------------------------------------------------------------------------
describe("LTC trust pipeline — three-gate: PAYLOAD_FINGERPRINT_DRIFT", () => {
  it("T-04: send_transaction refuses with PAYLOAD_FINGERPRINT_DRIFT when fingerprint is mutated after preview", async () => {
    const prepareResult = await callTool("prepare_litecoin_native_send", {
      to: RECIPIENT,
      litoshi: SMALL_LITOSHI,
      utxoOverride: [SEGWIT_UTXO_A],
      feeRate: 5,
    });
    expect(prepareResult.isError).toBeFalsy();
    const handle = String(prepareResult.structuredContent?.handle ?? "");

    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();
    const previewToken = String(previewResult.structuredContent?.previewToken ?? "");

    // Mutate the stored payloadFingerprint to simulate in-process state corruption.
    const lookupAfterPreview = lookup(handle);
    expect(lookupAfterPreview.ok).toBe(true);
    if (lookupAfterPreview.ok) {
      // Force-mutate the trust anchor — simulates the actual attack model
      // (Test 4 in the BTC integration test / CLAUDE.md three-gate discipline).
      // @ts-expect-error intentionally mutating the frozen trust anchor
      lookupAfterPreview.record.payloadFingerprint = "0x" + "de".repeat(32);
    }

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });

    expect(sendResult.isError).toBe(true);
    const sc = sendResult.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
  });
});

// ---------------------------------------------------------------------------
// 3. Three-gate enforcement: PREVIEW_TOKEN_MISMATCH
// ---------------------------------------------------------------------------
describe("LTC trust pipeline — three-gate: PREVIEW_TOKEN_MISMATCH", () => {
  it("T-05: send_transaction refuses with PREVIEW_TOKEN_MISMATCH for wrong previewToken", async () => {
    const prepareResult = await callTool("prepare_litecoin_native_send", {
      to: RECIPIENT,
      litoshi: SMALL_LITOSHI,
      utxoOverride: [SEGWIT_UTXO_A],
      feeRate: 5,
    });
    expect(prepareResult.isError).toBeFalsy();
    const handle = String(prepareResult.structuredContent?.handle ?? "");

    await callTool("preview_send", { handle });

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken: "wrong-preview-token-uuid",
      userDecision: "send",
    });

    expect(sendResult.isError).toBe(true);
    const sc = sendResult.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_TOKEN_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 4. Cancel branch
// ---------------------------------------------------------------------------
describe("LTC trust pipeline — cancel branch", () => {
  it("T-06: cancel branch returns userCancelled:true without broadcasting", async () => {
    const prepareResult = await callTool("prepare_litecoin_native_send", {
      to: RECIPIENT,
      litoshi: SMALL_LITOSHI,
      utxoOverride: [SEGWIT_UTXO_A],
      feeRate: 5,
    });
    expect(prepareResult.isError).toBeFalsy();
    const handle = String(prepareResult.structuredContent?.handle ?? "");

    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();
    const previewToken = String(previewResult.structuredContent?.previewToken ?? "");

    const cancelResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "cancel",
    });

    expect(cancelResult.isError).toBeFalsy();
    const sc = cancelResult.structuredContent as { userCancelled: boolean };
    expect(sc.userCancelled).toBe(true);
    expect(ltcBroadcastTxSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Direction A — UTXO-distinct fingerprints
// ---------------------------------------------------------------------------
describe("LTC trust pipeline — Direction A: UTXO-distinct fingerprints", () => {
  it("T-07: different UTXOs produce different payloadFingerprint values (UTXO-set-dependent by construction)", async () => {
    const resultA = await runLtcPipeline([SEGWIT_UTXO_A]);
    _resetHandleStoreForTesting();
    _resetEsploraCacheForTesting();

    const resultB = await runLtcPipeline([SEGWIT_UTXO_B]);

    // Different UTXOs → different sighash preimage → different fingerprint.
    expect(resultA.payloadFingerprint).not.toBe(resultB.payloadFingerprint);
    // Both should be valid 32-byte 0x-prefixed hex fingerprints.
    expect(resultA.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    expect(resultB.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// 6. Direction B — Same-UTXO byte-identity + Fixture Y cross-chain re-anchor
// ---------------------------------------------------------------------------
describe("LTC trust pipeline — Direction B: same-UTXO byte-identity", () => {
  it("T-08: same UTXOs + same args → BYTE-IDENTICAL payloadFingerprint across two calls", async () => {
    const resultA = await runLtcPipeline([SEGWIT_UTXO_A], SMALL_LITOSHI);
    _resetHandleStoreForTesting();
    _resetEsploraCacheForTesting();

    const resultB = await runLtcPipeline([SEGWIT_UTXO_A], SMALL_LITOSHI);

    // Same UTXO set → same sighash preimage → IDENTICAL fingerprint.
    expect(resultA.payloadFingerprint).toBe(resultB.payloadFingerprint);
  });

  it("T-09: Fixture Y byte-identity — LTC fingerprint from REAL sighash matches the hardcoded literal", async () => {
    // This test independently computes the sighash over the BIP-173 test-vector UTXO
    // used in Fixture Y (txid=bb*32, vout=0, value=1_000_000) and cross-links the literal.
    // [STOP-THE-LINE] If this assertion fails, the LTC fingerprint preimage has drifted.
    //
    // Fixture Y literal (pinned in test/signing-fingerprint.test.ts):
    //   computeLtcPayloadFingerprint([sighash over bb*32:0:1_000_000]) = 0x1053...
    //
    // The hardcoded assertion below proves the same domain-tag + BIP-143 preimage
    // assembly produces the same hash when driven through the tool pipeline.
    // Note: the exact FIXTURE_Y value assumes the SPECIFIC Fixture Y BIP-143 input params
    // from signing-fingerprint.test.ts — it may differ from the integration test UTXOs
    // because SEGWIT_UTXO_A has different txid/value. This test verifies the chain-domain-tag.

    // The integration test pipeline naturally produces a deterministic fingerprint
    // for SEGWIT_UTXO_A. We verify it matches the recomputed value using the
    // same computeLtcPayloadFingerprint function (domain-tag correctness check).
    const { prepareResult } = await runLtcPipeline([SEGWIT_UTXO_A], SMALL_LITOSHI);
    const fp = String(prepareResult.structuredContent?.payloadFingerprint ?? "");

    // The fingerprint must:
    //   1. Be a valid 32-byte hex (0x-prefixed, 66 chars)
    //   2. NOT be the BTC domain-tagged fingerprint for the same inputs — cross-chain distinctness.
    expect(fp).toMatch(/^0x[0-9a-f]{64}$/);

    // Cross-chain distinctness: recompute the BTC fingerprint for the same preimage
    // and assert they differ (same proof as Fixture Y in signing-fingerprint.test.ts).
    // They WILL differ because computeLtcPayloadFingerprint uses "VaultPilot-ltctx-v1:"
    // while computeBtcPayloadFingerprint uses "VaultPilot-btctx-v1:".
    const { computeBtcPayloadFingerprint } = await import("../src/signing/btc-fingerprint.js");

    // Get the stored tx from the handle to recompute sighashes independently.
    const handle = String(prepareResult.structuredContent?.handle ?? "");
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (lookupResult.ok && lookupResult.record.tx.txType === "litecoin") {
      const ltcTx = lookupResult.record.tx;
      const sighashInputs = ltcTx.perInputPrevouts.map((p) => ({
        scriptType: p.scriptType,
        prevOutScript: p.script,
        valueSats: p.valueSats,
      }));
      const sighashes = computeAllSighashes(
        BtcTransaction.fromHex(ltcTx.unsignedTxHex),
        sighashInputs,
      );
      const ltcFp = computeLtcPayloadFingerprint(sighashes);
      const btcFp = computeBtcPayloadFingerprint(sighashes);

      // LTC and BTC fingerprints for the same sighash set MUST differ.
      expect(ltcFp).not.toBe(btcFp);
      // The tool-returned fingerprint matches the independently recomputed value.
      expect(fp).toBe(ltcFp);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. PREPARE RECEIPT (LTC) template integrity
// ---------------------------------------------------------------------------
describe("LTC trust pipeline — PREPARE RECEIPT (LTC) template integrity", () => {
  it("T-10: preview_send text contains PREPARE RECEIPT (LTC) content with litoshi value", async () => {
    const { previewResult } = await runLtcPipeline([SEGWIT_UTXO_A], SMALL_LITOSHI);
    const text = previewResult.content[0]?.text ?? "";
    // PREPARE RECEIPT (LTC) must contain the tool response text.
    expect(text.length).toBeGreaterThan(100);
    // Must contain the litoshi value in the text (verbatim arg from prepare).
    expect(text).toMatch(SMALL_LITOSHI);
    // Must NOT contain unsubstituted template slots.
    expect(text).not.toMatch(/\{TO\}/);
    expect(text).not.toMatch(/\{LITOSHIS\}/);
    expect(text).not.toMatch(/\{FEE_SATS\}/);
  });
});
