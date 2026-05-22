// Phase 23 Plan 23-04 — preview_send BTC branch regression file.
//
// Load-bearing invariants:
//
//   1. **BTC branch dispatch** — handles with txType="btc" route to
//      `previewSendBtcBranch`; EVM/Solana/TRON handles still route correctly.
//   2. **Layer 1 fingerprint recompute** — recomputes payloadFingerprint from the
//      STORED CANONICAL ARTIFACT (unsignedTxHex + perInputPrevouts), NOT from a
//      re-parsed PSBT (Pitfall 5). Asserts MATCH on a clean handle.
//   3. **PAYLOAD_FINGERPRINT_DRIFT** — tampered stored fingerprint refuses.
//   4. **LEDGER BLIND-SIGN HASH (BTC) block** — emitted with one sighash row per input.
//      Multi-input → multi-row (one per UTXO being spent).
//   5. **PREPARE RECEIPT block** — emitted with inputs / outputs / feeSats.
//   6. **previewToken minted** — structuredContent carries previewToken, handle transitions
//      to `previewed` status.
//   7. **Multi-input: one sighash row per input** — the LEDGER BLIND-SIGN HASH block
//      contains exactly N rows for an N-input BTC handle.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transaction } from "bitcoinjs-lib";

import "../src/chains/bitcoin/types.js"; // initEccLib for taproot sighash
import {
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  type PreparedTxBtc,
} from "../src/signing/handle-store.js";
import { computeAllSighashes } from "../src/signing/btc-sighash.js";
import { computeBtcPayloadFingerprint } from "../src/signing/btc-fingerprint.js";
import {
  LEDGER_BLIND_SIGN_HASH_BTC_TEMPLATE,
  PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE,
} from "../src/signing/blocks-btc.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callPreviewSend(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

// ---------------------------------------------------------------------------
// Minimal BTC test fixtures
// ---------------------------------------------------------------------------

// A valid minimal unsigned tx: version=2, 1 segwit input (P2WPKH), 1 output, locktime=0.
// Built via Bitcoin hex encoding (SIGHASH-free segwit tx stripped of segwit marker).
// We use real bitcoinjs-lib hashForWitnessV0 inputs in the fixture so the sighash
// computation produces a consistent and verifiable output.
const SEGWIT_PUBKEY = Buffer.from("03" + "ab".repeat(32), "hex");
const SEGWIT_SCRIPT = Buffer.concat([
  Buffer.from([0x00, 0x14]),
  Buffer.alloc(20, 0xab), // P2WPKH scriptPubKey (OP_0 <20-byte-hash>)
]);
const RECIPIENT_SCRIPT = Buffer.concat([
  Buffer.from([0x00, 0x14]),
  Buffer.alloc(20, 0xcc),
]);

/**
 * Build a minimal unsigned BTC tx and the perInputPrevouts + unsignedTxHex for the
 * PreparedTxBtc fixture.
 */
function buildBtcSegwitFixture() {
  // Minimal raw serialized unsigned tx (version=2, 1 input, 1 output, locktime=0).
  // No segwit marker — `Transaction.fromHex` handles non-witness serialization.
  // txid = 'aa'.repeat(32), vout = 0.
  const tx = new Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0xaa), 0, 0xfffffffe);
  tx.addOutput(RECIPIENT_SCRIPT, BigInt(90000));
  const unsignedTxHex = tx.toHex();

  const prevout = {
    script: SEGWIT_SCRIPT,
    valueSats: BigInt(100000),
    scriptType: "p2wpkh" as const,
  };
  const perInputPrevouts = [prevout];

  // Compute the canonical fingerprint.
  const sighashInputs = perInputPrevouts.map((p) => ({
    scriptType: p.scriptType,
    prevOutScript: p.script,
    valueSats: p.valueSats,
  }));
  const perInputSighashes = computeAllSighashes(Transaction.fromHex(unsignedTxHex), sighashInputs);
  const payloadFingerprint = computeBtcPayloadFingerprint(perInputSighashes);

  const btcTx: PreparedTxBtc = {
    txType: "btc",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000",
    valueWei: 0n,
    data: "0x",
    kind: "native",
    psbtBase64: "AAAA", // placeholder — not used in fingerprint path
    unsignedTxHex,
    perInputPrevouts,
    inputScriptTypes: ["p2wpkh"],
    inputs: [
      {
        txid: "aa".repeat(32),
        vout: 0,
        valueSats: BigInt(100000),
        scriptType: "p2wpkh",
      },
    ],
    outputs: [
      {
        address: "bc1qcccccccccccccc",
        valueSats: BigInt(90000),
        role: "recipient",
      },
    ],
    feeSats: BigInt(10000),
    changeSats: BigInt(0),
  };

  return { btcTx, payloadFingerprint, perInputSighashes };
}

/**
 * Build a 2-input mixed fixture (segwit + taproot) for multi-row tests.
 */
function buildBtcMixedFixture() {
  const TAPROOT_SCRIPT = Buffer.concat([
    Buffer.from([0x51, 0x20]),
    Buffer.alloc(32, 0xbb),
  ]);

  const tx = new Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0xaa), 0, 0xfffffffe);
  tx.addInput(Buffer.alloc(32, 0xbb), 0, 0xfffffffe);
  tx.addOutput(RECIPIENT_SCRIPT, BigInt(180000));
  const unsignedTxHex = tx.toHex();

  const perInputPrevouts = [
    {
      script: SEGWIT_SCRIPT,
      valueSats: BigInt(100000),
      scriptType: "p2wpkh" as const,
    },
    {
      script: TAPROOT_SCRIPT,
      valueSats: BigInt(100000),
      scriptType: "p2tr" as const,
    },
  ];

  const sighashInputs = perInputPrevouts.map((p) => ({
    scriptType: p.scriptType,
    prevOutScript: p.script,
    valueSats: p.valueSats,
  }));
  const perInputSighashes = computeAllSighashes(Transaction.fromHex(unsignedTxHex), sighashInputs);
  const payloadFingerprint = computeBtcPayloadFingerprint(perInputSighashes);

  const btcTx: PreparedTxBtc = {
    txType: "btc",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000",
    valueWei: 0n,
    data: "0x",
    kind: "native",
    psbtBase64: "AAAA",
    unsignedTxHex,
    perInputPrevouts,
    inputScriptTypes: ["p2wpkh", "p2tr"],
    inputs: [
      { txid: "aa".repeat(32), vout: 0, valueSats: BigInt(100000), scriptType: "p2wpkh" },
      { txid: "bb".repeat(32), vout: 0, valueSats: BigInt(100000), scriptType: "p2tr" },
    ],
    outputs: [
      { address: "bc1qcccccccccccccc", valueSats: BigInt(180000), role: "recipient" },
    ],
    feeSats: BigInt(20000),
    changeSats: BigInt(0),
  };

  return { btcTx, payloadFingerprint, perInputSighashes };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetHandleStoreForTesting();
});
afterEach(() => {
  vi.restoreAllMocks();
  _resetHandleStoreForTesting();
});

describe("preview_send BTC branch — Phase 23 Plan 23-04", () => {
  it("T-01: routes txType='btc' handle to BTC branch and returns previewToken (chain='bitcoin')", async () => {
    const { btcTx, payloadFingerprint } = buildBtcSegwitFixture();
    const handle = createHandle({
      args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
      tx: btcTx,
      payloadFingerprint,
    });

    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      chain: "bitcoin",
      kind: "native",
      handle,
    });
    expect(typeof result.structuredContent?.previewToken).toBe("string");
    expect((result.structuredContent?.previewToken as string).length).toBeGreaterThan(0);

    // Handle transitions to 'previewed'.
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (lookupResult.ok) {
      expect(lookupResult.record.status).toBe("previewed");
    }
  });

  it("T-02: emits PREPARE RECEIPT (BTC) block in response text", async () => {
    const { btcTx, payloadFingerprint } = buildBtcSegwitFixture();
    const handle = createHandle({
      args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
      tx: btcTx,
      payloadFingerprint,
    });

    const result = await callPreviewSend({ handle });
    const text = result.content[0]?.text ?? "";

    // PREPARE RECEIPT header line
    expect(text).toMatch(/PREPARE RECEIPT \(BTC — native send\)/);
    // feeSats present
    expect(text).toMatch(/feeSats:\s*10000/);
    // input row with script type
    expect(text).toMatch(/p2wpkh/);
  });

  it("T-03: emits LEDGER BLIND-SIGN HASH (BTC) block with one sighash row for segwit-only input", async () => {
    const { btcTx, payloadFingerprint } = buildBtcSegwitFixture();
    const handle = createHandle({
      args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
      tx: btcTx,
      payloadFingerprint,
    });

    const result = await callPreviewSend({ handle });
    const text = result.content[0]?.text ?? "";

    // LEDGER BLIND-SIGN HASH block header
    expect(text).toMatch(/LEDGER BLIND-SIGN HASH \(BTC\)/);
    // One input row: input[0] (p2wpkh)
    expect(text).toMatch(/input\[0\]\s+\(p2wpkh\)/);
    // Exactly one sighash row (not two).
    const rowMatches = (text.match(/input\[\d+\]/g) ?? []);
    expect(rowMatches.length).toBe(1);
  });

  it("T-04: multi-input (mixed) → LEDGER BLIND-SIGN HASH block has one row per input (BTC-PREP-02)", async () => {
    const { btcTx, payloadFingerprint } = buildBtcMixedFixture();
    const handle = createHandle({
      args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
      tx: btcTx,
      payloadFingerprint,
    });

    const result = await callPreviewSend({ handle });
    const text = result.content[0]?.text ?? "";

    // Two input rows in the LEDGER BLIND-SIGN HASH block.
    const rowMatches = (text.match(/input\[\d+\]/g) ?? []);
    expect(rowMatches.length).toBe(2);
    expect(text).toMatch(/input\[0\]\s+\(p2wpkh\)/);
    expect(text).toMatch(/input\[1\]\s+\(p2tr\)/);
  });

  it("T-05: Layer 1 fingerprint MATCH → no PAYLOAD_FINGERPRINT_DRIFT (clean handle)", async () => {
    const { btcTx, payloadFingerprint } = buildBtcSegwitFixture();
    const handle = createHandle({
      args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
      tx: btcTx,
      payloadFingerprint,
    });

    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    // structuredContent must have payloadFingerprint matching what we computed.
    expect(result.structuredContent?.payloadFingerprint).toBe(payloadFingerprint);
  });

  it("T-06: PAYLOAD_FINGERPRINT_DRIFT — tampered stored fingerprint refuses (T-23-13)", async () => {
    const { btcTx } = buildBtcSegwitFixture();
    // Use a deliberately WRONG fingerprint that doesn't match the canonical artifact.
    const tamperedFingerprint = "0x" + "de".repeat(32); // wrong value
    const handle = createHandle({
      args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
      tx: btcTx,
      payloadFingerprint: tamperedFingerprint,
    });

    const result = await callPreviewSend({ handle });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
    expect(result.content[0]?.text).toMatch(/payloadFingerprint drift/);
    // Handle must NOT have transitioned to 'previewed'.
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (lookupResult.ok) {
      expect(lookupResult.record.status).toBe("prepared");
    }
  });

  it("T-07: Next-step instruction in response text contains the handle and previewToken", async () => {
    const { btcTx, payloadFingerprint } = buildBtcSegwitFixture();
    const handle = createHandle({
      args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
      tx: btcTx,
      payloadFingerprint,
    });

    const result = await callPreviewSend({ handle });
    const text = result.content[0]?.text ?? "";
    const previewToken = (result.structuredContent?.previewToken as string) ?? "";

    expect(text).toMatch(/send_transaction/);
    expect(text).toContain(handle);
    expect(text).toContain(previewToken);
  });

  it("T-08: structuredContent.sessionTopicLast8 is null (BTC uses USB-HID + Esplora, not WC)", async () => {
    const { btcTx, payloadFingerprint } = buildBtcSegwitFixture();
    const handle = createHandle({
      args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
      tx: btcTx,
      payloadFingerprint,
    });

    const result = await callPreviewSend({ handle });
    expect(result.structuredContent?.sessionTopicLast8).toBeNull();
  });

  it("T-09: EVM handle still routes to EVM branch after BTC dispatch added (back-compat)", async () => {
    // Minimal EVM handle — no txType field, so txType defaults to "evm".
    // EVM branch will try to resolve fees/nonce — it'll fail in test (no real RPC).
    // We just need to confirm it does NOT route to the BTC branch (errorCode != PAYLOAD_FINGERPRINT_DRIFT).
    const evmTx = {
      chainId: 1,
      to: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as `0x${string}`,
      valueWei: 1000000000000000000n,
      data: "0x" as `0x${string}`,
    };
    const handle = createHandle({
      args: { to: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", valueWei: "1000000000000000000" },
      tx: evmTx,
      payloadFingerprint: "0x" + "ff".repeat(32),
    });

    const result = await callPreviewSend({ handle });
    // EVM branch will fail (no WC session), but NOT with BTC-specific errors.
    const errorCode = (result.structuredContent as Record<string, unknown>)?.errorCode;
    expect(errorCode).not.toBe("PAYLOAD_FINGERPRINT_DRIFT");
  });
});
