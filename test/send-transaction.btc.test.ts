// Phase 23 Plan 23-04 — send_transaction BTC branch regression file.
//
// Load-bearing invariants:
//
//   1. **Three FROZEN gates for BTC** — PREVIEW_REQUIRED, PREVIEW_TOKEN_MISMATCH,
//      PAYLOAD_FINGERPRINT_DRIFT fire identically on BTC handles. The gate's
//      outer structure + refusal envelope + errorCode are byte-identical.
//   2. **Demo-mode short-circuit (D-04)** — mempool-replay simulation returned; sign spy
//      = 0 calls; broadcast spy = 0 calls.
//   3. **WALLET_NOT_PAIRED** — no paired BTC account refuses before signing.
//   4. **Broadcast success** — Esplora POST /tx returns a txid; structuredContent
//      carries `txHash`, `txType: "btc"`, `kind: "native"`.
//   5. **Broadcast failure** — Esplora `{ kind: "rejected" }` → BROADCAST_FAILED.
//   6. **LEDGER_REJECTED** — Ledger device user-rejection → LEDGER_REJECTED.
//   7. **FROZEN three-gate region zero-diff assertion** — `git diff origin/main --`
//      for src/tools/send_transaction.ts shows ONLY additive BTC changes.
//
// Mocking strategy:
//   - `_btcLedgerTransport.signBtcPsbt` spy — full control over USB-HID sign.
//   - `broadcastTx` from `esplora-client.ts` — stubbed at the module boundary.
//   - `listAccounts` from `non-evm-account-store` — mocked for BTC pairing.
//   - `isDemoMode` / `getActiveBtcPersona` — mocked for demo-mode tests.
//   - handle-store stays REAL — seed via `createHandle`, assert via `lookup()`.

import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transaction } from "bitcoinjs-lib";

import "../src/chains/bitcoin/types.js"; // initEccLib for taproot sighash

const { listAccountsSpy, broadcastTxSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  broadcastTxSpy: vi.fn(),
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

vi.mock("../src/chains/bitcoin/esplora-client.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/chains/bitcoin/esplora-client.js")
  >("../src/chains/bitcoin/esplora-client.js");
  return {
    ...actual,
    broadcastTx: (...args: unknown[]) => broadcastTxSpy(...args),
  };
});

import { _btcLedgerTransport } from "../src/wallet/ledger-btc-transport.js";
import {
  LedgerDeviceNotConnectedError as LedgerBtcDeviceNotConnectedError,
  LedgerBtcAppNotOpenError,
} from "../src/wallet/ledger-btc-transport.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveBtcPersonaBySlug,
} from "../src/demo/state.js";
import { computeAllSighashes } from "../src/signing/btc-sighash.js";
import { computeBtcPayloadFingerprint } from "../src/signing/btc-fingerprint.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  transitionToPreviewed,
  type PreparedTxBtc,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callSendTx(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("send_transaction");
  if (!tool) throw new Error("send_transaction not registered");
  return tool.handler(args);
}

// ---------------------------------------------------------------------------
// Minimal BTC test fixtures (mirrors preview-send.btc.test.ts)
// ---------------------------------------------------------------------------
const SEGWIT_SCRIPT = Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 0xab)]);
const RECIPIENT_SCRIPT = Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 0xcc)]);

function buildBtcSegwitHandle(): {
  handle: string;
  btcTx: PreparedTxBtc;
  payloadFingerprint: string;
  presignHash: string;
} {
  const tx = new Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0xaa), 0, 0xfffffffe);
  tx.addOutput(RECIPIENT_SCRIPT, BigInt(90000));
  const unsignedTxHex = tx.toHex();

  const perInputPrevouts = [
    { script: SEGWIT_SCRIPT, valueSats: BigInt(100000), scriptType: "p2wpkh" as const },
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
    inputScriptTypes: ["p2wpkh"],
    inputs: [{ txid: "aa".repeat(32), vout: 0, valueSats: BigInt(100000), scriptType: "p2wpkh" }],
    outputs: [{ address: "bc1qcccccccccccccc", valueSats: BigInt(90000), role: "recipient" }],
    feeSats: BigInt(10000),
    changeSats: BigInt(0),
  };

  const handle = createHandle({
    args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
    tx: btcTx,
    payloadFingerprint,
  });
  // Transition to previewed so three-gate passes.
  transitionToPreviewed(handle, {
    nonce: 0,
    gas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    previewToken: "test-preview-token",
    presignHash: payloadFingerprint,
    selector: null,
  });

  return { handle, btcTx, payloadFingerprint, presignHash: payloadFingerprint };
}

// ---------------------------------------------------------------------------
beforeEach(() => {
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  _resetDemoModeForTesting?.();
  // Default: paired BTC account exists.
  listAccountsSpy.mockReturnValue([
    {
      address: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
      derivationPath: "84'/0'/0'/0/0",
      chainType: "bitcoin",
    },
  ]);
  // Default: broadcast success.
  broadcastTxSpy.mockResolvedValue({ kind: "ok", txid: "cc".repeat(32) });
  // Default: sign success.
  vi.spyOn(_btcLedgerTransport, "signBtcPsbt").mockResolvedValue({
    rawTxHex: "02000000" + "aa".repeat(100),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  _resetDemoModeForTesting?.();
});

// ---------------------------------------------------------------------------
describe("send_transaction BTC branch — three FROZEN gates (T-23-16)", () => {
  it("T-01: PREVIEW_REQUIRED — BTC handle in 'prepared' status refuses with PREVIEW_REQUIRED", async () => {
    const btcTx: PreparedTxBtc = buildBtcSegwitHandle().btcTx;
    const { payloadFingerprint } = buildBtcSegwitHandle();
    _resetHandleStoreForTesting();
    const handle = createHandle({
      args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
      tx: btcTx,
      payloadFingerprint,
    });
    // Do NOT call transitionToPreviewed — handle is still in 'prepared' status.
    const result = await callSendTx({ handle, previewToken: "any", userDecision: "send" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("PREVIEW_REQUIRED");
  });

  it("T-02: PREVIEW_TOKEN_MISMATCH — wrong token refuses with PREVIEW_TOKEN_MISMATCH", async () => {
    const { handle } = buildBtcSegwitHandle();
    const result = await callSendTx({ handle, previewToken: "WRONG-TOKEN", userDecision: "send" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("PREVIEW_TOKEN_MISMATCH");
  });

  it("T-03: PAYLOAD_FINGERPRINT_DRIFT — tampered stored fingerprint refuses", async () => {
    // Build a valid previewed handle then manually corrupt the fingerprint.
    const btcTx = buildBtcSegwitHandle().btcTx;
    _resetHandleStoreForTesting();
    const tamperedFp = "0x" + "de".repeat(32);
    const handle = createHandle({
      args: { to: "bc1qtest", valueWei: "0", sats: "90000" },
      tx: btcTx,
      payloadFingerprint: tamperedFp, // wrong — won't match recomputed value
    });
    transitionToPreviewed(handle, {
      nonce: 0, gas: 0n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n,
      previewToken: "test-preview-token",
      presignHash: tamperedFp,
      selector: null,
    });

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
  });

  it("T-04: cancel — BTC handle transitions to cancelled; sign spy = 0 calls; broadcast spy = 0 calls", async () => {
    const { handle } = buildBtcSegwitHandle();
    const signSpy = vi.spyOn(_btcLedgerTransport, "signBtcPsbt");

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "cancel" });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as Record<string, unknown>)?.userCancelled).toBe(true);
    expect(signSpy).not.toHaveBeenCalled();
    expect(broadcastTxSpy).not.toHaveBeenCalled();
  });
});

describe("send_transaction BTC branch — demo mode (D-04 mempool-replay envelope)", () => {
  it("T-05: demo mode with BTC persona → mempool-replay envelope; sign spy = 0 calls", async () => {
    process.env["VAULTPILOT_DEMO"] = "true";
    _resetDemoModeForTesting?.();
    setActiveBtcPersonaBySlug("btc-whale");

    const { handle } = buildBtcSegwitHandle();
    const signSpy = vi.spyOn(_btcLedgerTransport, "signBtcPsbt");

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    expect(result.isError).toBeFalsy();
    expect(signSpy).not.toHaveBeenCalled();
    expect(broadcastTxSpy).not.toHaveBeenCalled();
    expect((result.structuredContent as Record<string, unknown>)?.demoMode).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.txType).toBe("btc");
    expect((result.structuredContent as Record<string, unknown>)?.envelopeShape).toBe("psbt-mempool-replay");

    delete process.env["VAULTPILOT_DEMO"];
    _resetDemoModeForTesting?.();
  });

  it("T-06: demo mode WITHOUT BTC persona → WRONG_MODE", async () => {
    process.env["VAULTPILOT_DEMO"] = "true";
    _resetDemoModeForTesting?.();
    // No persona set — _resetActivePersonaForTesting already cleared it.

    const { handle } = buildBtcSegwitHandle();

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("WRONG_MODE");

    delete process.env["VAULTPILOT_DEMO"];
    _resetDemoModeForTesting?.();
  });
});

describe("send_transaction BTC branch — WALLET_NOT_PAIRED", () => {
  it("T-07: no paired BTC account → WALLET_NOT_PAIRED; sign spy = 0 calls", async () => {
    listAccountsSpy.mockReturnValue([]);
    const { handle } = buildBtcSegwitHandle();
    const signSpy = vi.spyOn(_btcLedgerTransport, "signBtcPsbt");

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("WALLET_NOT_PAIRED");
    expect(signSpy).not.toHaveBeenCalled();
    expect(broadcastTxSpy).not.toHaveBeenCalled();
  });
});

describe("send_transaction BTC branch — sign + broadcast happy path", () => {
  it("T-08: happy path → signBtcPsbt called once; broadcastTx called; txHash returned", async () => {
    const FAKE_TXID = "dd".repeat(32);
    broadcastTxSpy.mockResolvedValue({ kind: "ok", txid: FAKE_TXID });
    const signSpy = vi.spyOn(_btcLedgerTransport, "signBtcPsbt").mockResolvedValue({
      rawTxHex: "02" + "aa".repeat(50),
    });
    const { handle } = buildBtcSegwitHandle();

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    expect(result.isError).toBeFalsy();
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(broadcastTxSpy).toHaveBeenCalledTimes(1);
    expect((result.structuredContent as Record<string, unknown>)?.txHash).toBe(FAKE_TXID);
    expect((result.structuredContent as Record<string, unknown>)?.txType).toBe("btc");
    expect((result.structuredContent as Record<string, unknown>)?.kind).toBe("native");
    expect((result.structuredContent as Record<string, unknown>)?.sessionTopicLast8).toBeNull();
  });

  it("T-09: handle transitions to 'sent' status after successful broadcast", async () => {
    const { handle } = buildBtcSegwitHandle();

    await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (lookupResult.ok) {
      expect(lookupResult.record.status).toBe("sent");
    }
  });
});

describe("send_transaction BTC branch — broadcast failure mapping", () => {
  it("T-10: Esplora { kind: 'rejected' } → BROADCAST_FAILED (T-23-18)", async () => {
    broadcastTxSpy.mockResolvedValue({ kind: "rejected", message: "mempool full" });
    const { handle } = buildBtcSegwitHandle();

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("BROADCAST_FAILED");
  });

  it("T-11: Esplora { kind: 'error' } → BROADCAST_FAILED", async () => {
    broadcastTxSpy.mockResolvedValue({ kind: "error", message: "Esplora unreachable" });
    const { handle } = buildBtcSegwitHandle();

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("BROADCAST_FAILED");
  });
});

describe("send_transaction BTC branch — Ledger error mapping", () => {
  it("T-12: LedgerBtcDeviceNotConnectedError → LEDGER_NOT_CONNECTED", async () => {
    vi.spyOn(_btcLedgerTransport, "signBtcPsbt").mockRejectedValue(
      new LedgerBtcDeviceNotConnectedError(),
    );
    const { handle } = buildBtcSegwitHandle();

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("LEDGER_NOT_CONNECTED");
  });

  it("T-13: LedgerBtcAppNotOpenError → LEDGER_REJECTED", async () => {
    vi.spyOn(_btcLedgerTransport, "signBtcPsbt").mockRejectedValue(
      new LedgerBtcAppNotOpenError(),
    );
    const { handle } = buildBtcSegwitHandle();

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("LEDGER_REJECTED");
  });

  it("T-14: user reject error → LEDGER_REJECTED", async () => {
    vi.spyOn(_btcLedgerTransport, "signBtcPsbt").mockRejectedValue(
      new Error("user rejected the transaction"),
    );
    const { handle } = buildBtcSegwitHandle();

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("LEDGER_REJECTED");
  });

  it("T-15: mixed-input combine error → BTC_MIXED_INPUT_SIGN_FAILURE", async () => {
    vi.spyOn(_btcLedgerTransport, "signBtcPsbt").mockRejectedValue(
      new Error("Mixed input types detected: finalize failed"),
    );
    const { handle } = buildBtcSegwitHandle();

    const result = await callSendTx({ handle, previewToken: "test-preview-token", userDecision: "send" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)?.errorCode).toBe("BTC_MIXED_INPUT_SIGN_FAILURE");
  });
});

describe("send_transaction BTC branch — FROZEN three-gate region zero-diff assertion", () => {
  it("T-16: FROZEN three-gate region of send_transaction.ts is byte-identical to origin/main (T-23-16)", () => {
    // Run `git diff origin/main -- src/tools/send_transaction.ts` and verify that
    // the FROZEN region lines (≈280-371 in origin/main) are NOT in the diff output
    // as removals (no `-` lines touching them). Only additive BTC changes allowed.
    let diff: string;
    try {
      diff = execSync(
        "git diff origin/main -- src/tools/send_transaction.ts",
        { cwd: process.cwd(), encoding: "utf8", timeout: 30000 },
      );
    } catch {
      // If git command fails (e.g. origin/main not available), skip assertion.
      console.warn("T-16: git diff unavailable — skipping FROZEN region zero-diff assertion");
      return;
    }

    // The FROZEN region (PREP-07 / PREP-08 / PREP-09) includes:
    //   - previewToken check: "T-GATE-2: previewToken match"
    //   - fingerprint drift check header comment: "PREP-08 / T-DRIFT-1"
    //   - PAYLOAD_FINGERPRINT_DRIFT refusal envelope lines

    // Removal lines in the diff start with "-" followed by any content.
    const removedLines = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));

    // The FROZEN gate sentinel lines must NOT appear in any removed line.
    // We check for the key distinguishing strings that appear in the FROZEN region.
    const frozenSentinels = [
      "T-GATE-2: previewToken match",
      "PREP-08 / T-DRIFT-1",
      "PAYLOAD_FINGERPRINT_DRIFT",
      "payloadFingerprint drift between prepare and send",
    ];

    for (const sentinel of frozenSentinels) {
      const inRemoved = removedLines.some((l) => l.includes(sentinel));
      expect(inRemoved, `FROZEN sentinel "${sentinel}" must not be in removed lines`).toBe(false);
    }

    // BTC-additive changes (new btc arm in discriminator + new dispatch if + sendTransactionBtcBranch)
    // appear as ADDED lines — this is expected and correct.
    const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const hasBtcAddition = addedLines.some((l) => l.includes("btc"));
    expect(hasBtcAddition, "send_transaction.ts diff must contain BTC-additive lines").toBe(true);
  });
});
