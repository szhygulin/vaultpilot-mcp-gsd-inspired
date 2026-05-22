// MCP tool: prepare_btc_rbf_bump({ txid, newFeeRate })
//
// Phase 24 Plan 24-01 — BTC-W-02: BIP-125 Replace-By-Fee fee bumping.
//
// Allows the agent to bump the fee of a mempool-pending BTC transaction that
// originally signalled RBF (BIP-125 sequence < 0xfffffffe).
//
// Trust pipeline:
//   input-validation (txid format, newFeeRate bounds)
//     → demo-mode FIRST refusal (same as prepare_btc_send)
//     → pairing check (listAccounts bitcoin)
//     → fetchBtcTx(txid) — GET /tx/{txid} from Esplora (never-throws union)
//     → confirmed-tx refusal (BTC_TX_ALREADY_CONFIRMED) — T-24-01 mitigation
//     → RBF signal check (BTC_NOT_RBF_SIGNALLED) — T-24-02 mitigation
//     → fee arithmetic from Esplora data (server-computed — T-24-04 mitigation)
//     → Rule 4 bump check (BTC_RBF_INSUFFICIENT_FEE_RATE)
//     → identify change output by address match
//     → adjust change output (BTC_RBF_NO_CHANGE_OUTPUT / BTC_RBF_CANNOT_AFFORD)
//     → reconstruct exact original input set (BIP-125 Rule 2 — strict-same-inputs, T-24-03)
//     → _btcPsbt.buildBtcPsbt with sequenceOverride: RBF_ENABLED_SEQUENCE (0xfffffffd)
//     → _btcSighash.computeAllSighashes + _btcFingerprint.computeBtcPayloadFingerprint
//     → createHandle({ kind: "rbf", originalTxid, originalFeeSats, originalFeeRate })
//     → PREPARE_RECEIPT_BTC_RBF_TEMPLATE substitution
//
// Design constraints from CONTEXT.md D-rules:
//   - Strict-same-inputs ONLY (BIP-125 Rule 2) — no UTXO consolidation, no CPFP
//   - newFeeRate only (not newFeeSats) — rate abstraction is better UX
//   - Static 1 sat/vB minimum relay fee bump (Phase 24 — dynamic probe deferred)
//
// FROZEN modules: btc-fingerprint.ts + btc-sighash.ts are NOT modified.
// The same domain tag "VaultPilot-btctx-v1:" is used for RBF (no new tag needed).

import { Transaction } from "bitcoinjs-lib";

import { fetchBtcTx } from "../chains/bitcoin/esplora-client.js";
import "../chains/bitcoin/types.js"; // initEccLib side-effect
import { isDemoMode } from "../config/env.js";
import { getActiveBtcPersona } from "../demo/state.js";
import {
  INPUT_ROW_BTC_TEMPLATE,
  OUTPUT_ROW_BTC_TEMPLATE,
  PREPARE_RECEIPT_BTC_RBF_TEMPLATE,
} from "../signing/blocks-btc.js";
import { _btcFingerprint } from "../signing/btc-fingerprint.js";
import { _btcSighash } from "../signing/btc-sighash.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  type PrepareArgs,
  type PreparedTxBtc,
  createHandle,
} from "../signing/handle-store.js";
import { _btcPsbt, type BtcPsbtInput, type BtcPsbtOutput } from "../protocols/btc-psbt.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

// ─── Error envelope boundary cast ─────────────────────────────────────────────

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** BIP-141 dust threshold for P2WPKH / P2TR outputs. Same as prepare_btc_send. */
const DUST_THRESHOLD_SATS = 330n;

/** Zero address for EVM-shape sentinel fields on PreparedTxBtc. */
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

/** Zero masterFingerprint (4 bytes). */
const ZERO_MASTER_FINGERPRINT = new Uint8Array(4);

/**
 * BIP-125 RBF-enabled sequence value (conventional "RBF on" value).
 * Distinct from RBF_DISABLED_SEQUENCE (0xfffffffe) in btc-psbt.ts.
 * Using 0xfffffffd means the replacement is itself bumpable via another RBF.
 */
const RBF_ENABLED_SEQUENCE = 0xfffffffd;

/**
 * Minimum relay fee bump per BIP-125 Rule 4 (sat/vB).
 * Static for Phase 24 — per-mempool-policy probe deferred to future.
 */
const MIN_RELAY_FEE_BUMP_SATS_PER_VB = 1;

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Bump the fee of a mempool-pending BTC transaction via BIP-125 Replace-By-Fee.",
  "The original transaction must have signalled RBF (sequence < 0xfffffffe on at least one input).",
  "To create a RBF-signalling transaction, use prepare_btc_send with signalRbf: true.",
  "`txid` is the 64-character hex txid of the mempool-pending transaction to replace.",
  "`newFeeRate` is the new fee rate in sat/vB. Must exceed the original fee rate by at least 1 sat/vB (BIP-125 Rule 4).",
  "The replacement preserves the exact original input set (BIP-125 Rule 2 — strict-same-inputs).",
  "The fee increase is absorbed by reducing the change output.",
  "Refusal cases: BTC_TX_ALREADY_CONFIRMED (tx is confirmed — use CPFP instead),",
  "BTC_NOT_RBF_SIGNALLED (original tx did not signal RBF — all inputs have sequence >= 0xfffffffe),",
  "BTC_RBF_INSUFFICIENT_FEE_RATE (new rate must exceed original by >= 1 sat/vB),",
  "BTC_RBF_NO_CHANGE_OUTPUT (no change output matches a paired account address — cannot absorb fee delta),",
  "BTC_RBF_CANNOT_AFFORD (fee delta exceeds change output value — not enough change to absorb the bump).",
  "Returns `{ handle, chain: \"bitcoin\", kind: \"rbf\", txid, payloadFingerprint, prepareReceipt, txType: \"btc\" }`.",
  "Pass the returned handle to preview_send then send_transaction.",
  "In demo mode, uses the active BTC persona addresses (set via set_demo_wallet).",
  "Requires a paired BTC Ledger (call pair_btc_ledger first if get_btc_status shows paired: false).",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    txid: {
      type: "string",
      description:
        "64-character hex txid of the mempool-pending BTC transaction to fee-bump via RBF.",
    },
    newFeeRate: {
      type: "number",
      description:
        "New fee rate in sat/vB. Must exceed the original by at least 1 sat/vB (BIP-125 Rule 4). Minimum 1 sat/vB.",
    },
  },
  required: ["txid", "newFeeRate"],
  additionalProperties: false,
};

// ─── Handler ──────────────────────────────────────────────────────────────────

registerTool(
  "prepare_btc_rbf_bump",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawTxid = typeof args.txid === "string" ? args.txid : "";
      const rawNewFeeRate =
        typeof args.newFeeRate === "number" ? args.newFeeRate : undefined;

      // -----------------------------------------------------------------------
      // Step 1: Input validation — FIRES FIRST (before any state read).
      // -----------------------------------------------------------------------

      // txid: must be exactly 64 lowercase hex characters.
      if (!/^[0-9a-fA-F]{64}$/.test(rawTxid)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'txid': expected a 64-character hex string, got "${rawTxid}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'txid': expected 64 hex chars, got "${rawTxid.slice(0, 20)}${rawTxid.length > 20 ? "..." : ""}"`,
          ),
        };
      }

      if (rawNewFeeRate === undefined || rawNewFeeRate < 1) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'newFeeRate': must be >= 1 sat/vB, got ${rawNewFeeRate ?? "undefined"}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'newFeeRate': must be >= 1 sat/vB`,
          ),
        };
      }
      const newFeeRate = rawNewFeeRate;

      // -----------------------------------------------------------------------
      // Step 2: Demo-mode FIRST refusal — read BTC persona registry.
      // Real-mode pairing check happens AFTER the demo branch.
      // Mirror of prepare_btc_send Step 2 ordering (T-23-11 mitigation).
      // -----------------------------------------------------------------------
      const demoActive = isDemoMode();
      const btcPersona = getActiveBtcPersona();

      let knownAddresses: string[];
      let segwitPubkeyHex: string;

      if (demoActive) {
        if (!btcPersona) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: demo mode is on but no BTC persona is set. " +
                  "Call set_demo_wallet with a BTC persona slug (e.g. \"btc-whale\") before using prepare_btc_rbf_bump in demo mode.",
              },
            ],
            structuredContent: errEnvelope(
              "WRONG_MODE",
              "demo mode is on but no BTC persona is set; call set_demo_wallet first",
            ),
          };
        }
        // In demo mode, both persona addresses are "owned".
        knownAddresses = [btcPersona.btcSegwitAddress, btcPersona.btcTaprootAddress];
        // Demo mode: use known-good stub pubkey (generator point G, compressed).
        segwitPubkeyHex =
          "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      } else {
        // Real mode — consult the persistent non-EVM account store.
        const accounts = listAccounts({ chainFilter: "bitcoin" });
        if (accounts.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: no paired BTC account. Pair your Ledger Bitcoin app via `pair_btc_ledger` before using prepare_btc_rbf_bump.",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired BTC account; call pair_btc_ledger first",
            ),
          };
        }
        // All known BTC account addresses are candidates for the change output.
        knownAddresses = accounts.map((a) => a.address);
        // Real mode: use stub pubkey for PSBT BIP-32 metadata.
        // (Actual pubkey from Ledger is not required for the fee-bump PSBT structure —
        // the Ledger signing app resolves it from bip32Derivation at sign time.)
        segwitPubkeyHex =
          "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      }

      // -----------------------------------------------------------------------
      // Step 3: Fetch the original transaction from Esplora.
      // One fetch covers both the mempool check and the full tx data.
      // NO caching — mempool state can change between calls.
      // -----------------------------------------------------------------------
      const txResult = await fetchBtcTx(rawTxid);

      if (txResult.kind === "not-found") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: txid ${rawTxid} not found in Esplora — check that the transaction has been broadcast`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `txid ${rawTxid} not found in Esplora`,
          ),
        };
      }

      if (txResult.kind === "rate-limited" || txResult.kind === "error") {
        const message =
          txResult.kind === "rate-limited" ? txResult.message : txResult.message;
        return {
          isError: true,
          content: [{ type: "text", text: `error: Esplora fetch failed: ${message}` }],
          structuredContent: errEnvelope("INTERNAL_ERROR", message),
        };
      }

      if (txResult.kind === "not-applicable") {
        return {
          isError: true,
          content: [
            { type: "text", text: "error: Esplora is not configured" },
          ],
          structuredContent: errEnvelope("INTERNAL_ERROR", "Esplora not applicable"),
        };
      }

      const txData = txResult.tx;

      // -----------------------------------------------------------------------
      // Step 4: Confirmed-tx refusal (T-24-01 mitigation).
      // Server reads status.confirmed from Esplora — never trusts agent claim.
      // -----------------------------------------------------------------------
      if (txData.status.confirmed) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: txid ${rawTxid} is already confirmed and cannot be replaced via RBF. ` +
                "RBF is mempool-only. If you need to speed up a confirmed parent tx, " +
                "consider CPFP (Child-Pays-For-Parent) — a future VaultPilot feature.",
            },
          ],
          structuredContent: errEnvelope(
            "BTC_TX_ALREADY_CONFIRMED",
            `txid ${rawTxid} is already confirmed; RBF is mempool-only`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 5: RBF signal check (T-24-02 mitigation).
      // Server reads vin[].sequence from Esplora — never trusts agent claim.
      // BIP-125: any input with sequence < 0xfffffffe signals RBF.
      // -----------------------------------------------------------------------
      const rbfSignalled = txData.vin.some((inp) => inp.sequence < 0xfffffffe);
      if (!rbfSignalled) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: txid ${rawTxid} does not signal RBF. All inputs have sequence >= 0xfffffffe. ` +
                "To create future transactions that can be fee-bumped, use signalRbf: true on prepare_btc_send.",
            },
          ],
          structuredContent: errEnvelope(
            "BTC_NOT_RBF_SIGNALLED",
            `txid ${rawTxid} does not signal RBF (all inputs sequence >= 0xfffffffe); ` +
              "use signalRbf: true on prepare_btc_send for future bumpable txs",
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 6: Fee arithmetic from Esplora data (T-24-04 mitigation).
      // Server computes originalFeeRate independently — agent cannot influence.
      // -----------------------------------------------------------------------
      const originalInputSum = txData.vin.reduce(
        (acc, inp) => acc + BigInt(inp.prevout.value),
        0n,
      );
      const originalOutputSum = txData.vout.reduce(
        (acc, out) => acc + BigInt(out.value),
        0n,
      );
      const originalFeeSats = originalInputSum - originalOutputSum;
      const originalVsize = Math.ceil(txData.weight / 4);
      const originalFeeRate = Number(originalFeeSats) / originalVsize;

      // -----------------------------------------------------------------------
      // Step 7: BIP-125 Rule 4 check — new rate must exceed original by >= 1 sat/vB.
      // -----------------------------------------------------------------------
      if (newFeeRate <= originalFeeRate + MIN_RELAY_FEE_BUMP_SATS_PER_VB) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: newFeeRate (${newFeeRate} sat/vB) must exceed the original fee rate ` +
                `(${originalFeeRate.toFixed(2)} sat/vB) by at least ${MIN_RELAY_FEE_BUMP_SATS_PER_VB} sat/vB ` +
                `(BIP-125 Rule 4). Use newFeeRate >= ${Math.ceil(originalFeeRate + MIN_RELAY_FEE_BUMP_SATS_PER_VB + 1)}.`,
            },
          ],
          structuredContent: errEnvelope(
            "BTC_RBF_INSUFFICIENT_FEE_RATE",
            `newFeeRate ${newFeeRate} sat/vB must exceed original ${originalFeeRate.toFixed(2)} sat/vB by >= 1 sat/vB (BIP-125 Rule 4)`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 8: Compute new fee and adjust change output.
      // The vsize is assumed equal to the original (same input/output structure).
      // The fee increase comes ONLY from reducing the change output (T-24-03 mitigation).
      // -----------------------------------------------------------------------
      const estimatedVsize = originalVsize; // same input/output structure
      const newFeeSats = BigInt(Math.ceil(newFeeRate * estimatedVsize));
      const feeDelta = newFeeSats - originalFeeSats;

      // -----------------------------------------------------------------------
      // Step 9: Identify change output by matching scriptpubkey_address against
      // known account addresses (T-24-03 mitigation: never add new outputs).
      // -----------------------------------------------------------------------
      const changeVout = txData.vout.find((out) =>
        knownAddresses.includes(out.scriptpubkey_address),
      );

      if (changeVout === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: txid ${rawTxid} has no change output owned by the paired BTC account. ` +
                "Cannot absorb the fee delta without a change output to reduce.",
            },
          ],
          structuredContent: errEnvelope(
            "BTC_RBF_NO_CHANGE_OUTPUT",
            `txid ${rawTxid} has no change output matching a paired BTC account address`,
          ),
        };
      }

      const changeVoutIndex = txData.vout.indexOf(changeVout);
      const newChangeSats = BigInt(changeVout.value) - feeDelta;

      if (newChangeSats < 0n) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: fee delta (${feeDelta} sats) exceeds the change output value ` +
                `(${changeVout.value} sats). Cannot bump the fee without adding new inputs, ` +
                "which is forbidden by BIP-125 Rule 2 (strict-same-inputs).",
            },
          ],
          structuredContent: errEnvelope(
            "BTC_RBF_CANNOT_AFFORD",
            `fee delta ${feeDelta} sats exceeds change output value ${changeVout.value} sats`,
          ),
        };
      }

      // Fold dust change into fee rather than creating a dust output.
      const effectiveChangeSats = newChangeSats < DUST_THRESHOLD_SATS ? 0n : newChangeSats;

      // -----------------------------------------------------------------------
      // Step 10: Reconstruct BtcPsbtInput[] from vin[] — EXACT original input set.
      // BIP-125 Rule 2: the replacement MUST use the same UTXOs as the original.
      // No new inputs, no removed inputs. (T-24-03 mitigation)
      // -----------------------------------------------------------------------
      const segwitPubkey = Buffer.from(segwitPubkeyHex, "hex");

      const psbtInputs: BtcPsbtInput[] = txData.vin.map((vin) => {
        const scriptType: "p2wpkh" | "p2tr" =
          vin.prevout.scriptpubkey_type === "v1_p2tr" ? "p2tr" : "p2wpkh";

        if (scriptType === "p2tr") {
          const xOnly = segwitPubkey.slice(1, 33); // 32-byte x-only
          return {
            txid: vin.txid,
            vout: vin.vout,
            valueSats: BigInt(vin.prevout.value),
            scriptType: "p2tr" as const,
            pubkey: segwitPubkey,
            xOnlyPubkey: xOnly,
            bip32Path: "m/86'/0'/0'/0/0",
            masterFingerprint: ZERO_MASTER_FINGERPRINT,
          };
        }
        return {
          txid: vin.txid,
          vout: vin.vout,
          valueSats: BigInt(vin.prevout.value),
          scriptType: "p2wpkh" as const,
          pubkey: segwitPubkey,
          bip32Path: "m/84'/0'/0'/0/0",
          masterFingerprint: ZERO_MASTER_FINGERPRINT,
        };
      });

      // -----------------------------------------------------------------------
      // Step 11: Build recipient outputs and change output.
      // Recipient outputs are preserved byte-identically (T-24-03 mitigation).
      // Only the change output is reduced.
      //
      // CR-01 guard: multi-recipient originals are not supported in Phase 24.
      // buildBtcPsbt accepts a single recipientOutput; silently dropping extra
      // outputs would violate BIP-125 Rule 2 (T-24-03) and mislead the Ledger
      // screen. Refuse with a structured error — multi-output RBF is deferred.
      // -----------------------------------------------------------------------
      const recipientVouts = txData.vout.filter((_, idx) => idx !== changeVoutIndex);

      if (recipientVouts.length === 0) {
        // Degenerate case: all outputs are change? Surface as internal error.
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: could not identify a recipient output in txid ${rawTxid}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            `could not identify a recipient output in txid ${rawTxid}`,
          ),
        };
      }

      if (recipientVouts.length > 1) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: txid ${rawTxid} has ${recipientVouts.length} non-change outputs. ` +
                "prepare_btc_rbf_bump only supports single-recipient transactions in Phase 24. " +
                "Multi-output RBF fee bumping is deferred to a future phase.",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `txid ${rawTxid} has ${recipientVouts.length} non-change outputs; multi-output RBF deferred to Phase 25`,
          ),
        };
      }

      // recipientVouts.length === 1 is guaranteed at this point by the guards above.
      const recipientVout = recipientVouts[0]!;

      const recipientScriptType: "p2wpkh" | "p2tr" =
        recipientVout.scriptpubkey_type === "v1_p2tr" ? "p2tr" : "p2wpkh";

      const recipientOutput: BtcPsbtOutput = {
        address: recipientVout.scriptpubkey_address,
        valueSats: BigInt(recipientVout.value),
        scriptType: recipientScriptType,
        role: "recipient",
      };

      const changeOutput: BtcPsbtOutput | null =
        effectiveChangeSats > 0n
          ? {
              address: changeVout.scriptpubkey_address,
              valueSats: effectiveChangeSats,
              scriptType: changeVout.scriptpubkey_type === "v1_p2tr" ? "p2tr" : "p2wpkh",
              role: "change",
              pubkey: segwitPubkey,
              bip32Path: "m/84'/0'/0'/1/0",
              masterFingerprint: ZERO_MASTER_FINGERPRINT,
            }
          : null;

      // -----------------------------------------------------------------------
      // Step 12: Build replacement PSBT via _btcPsbt.buildBtcPsbt with
      // RBF-ENABLED sequence (0xfffffffd) — the key divergence from prepare_btc_send.
      // -----------------------------------------------------------------------
      let psbtResult;
      try {
        psbtResult = _btcPsbt.buildBtcPsbt({
          inputs: psbtInputs,
          recipientOutput,
          changeOutput,
          dustThresholdSats: DUST_THRESHOLD_SATS,
          sequenceOverride: RBF_ENABLED_SEQUENCE, // 0xfffffffd — signals RBF + is itself bumpable
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build RBF replacement PSBT: ${cause}`,
            },
          ],
          structuredContent: errEnvelope("INTERNAL_ERROR", "failed to build RBF PSBT", cause),
        };
      }

      // -----------------------------------------------------------------------
      // Step 13: Compute per-input sighashes from the canonical artifact.
      // Same fingerprint pipeline as Phase 23 (FROZEN modules untouched).
      // The RBF replacement has a DIFFERENT fingerprint from the original tx
      // because the sequence number changed — this is correct behavior.
      // -----------------------------------------------------------------------
      const unsignedTx = Transaction.fromHex(psbtResult.unsignedTxHex);
      const sighashInputs = psbtResult.perInputPrevouts.map((prevout) => ({
        scriptType: prevout.scriptType,
        prevOutScript: prevout.script,
        valueSats: prevout.valueSats,
      }));
      const perInputSighashes = _btcSighash.computeAllSighashes(
        unsignedTx,
        sighashInputs,
      );

      const payloadFingerprint = _btcFingerprint.computeBtcPayloadFingerprint(
        perInputSighashes,
      );

      // -----------------------------------------------------------------------
      // Step 14: Build PreparedTxBtc with kind: "rbf" + original tx metrics.
      // -----------------------------------------------------------------------
      const tx: PreparedTxBtc = {
        txType: "btc",
        // EVM-shape sentinel fields.
        chainId: 0,
        to: ZERO_EVM_ADDRESS,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        // BTC-specific fields.
        kind: "rbf",
        psbtBase64: psbtResult.psbtBase64,
        unsignedTxHex: psbtResult.unsignedTxHex,
        perInputPrevouts: psbtResult.perInputPrevouts,
        inputScriptTypes: psbtInputs.map((i) => i.scriptType),
        inputs: psbtResult.inputs,
        outputs: psbtResult.outputs,
        feeSats: psbtResult.feeSats,
        changeSats: psbtResult.changeSats,
        feeRate: newFeeRate,
        changePath: changeOutput !== null ? "m/84'/0'/0'/1/0" : null,
        changeAddress: changeOutput !== null ? changeOutput.address : null,
        // RBF-specific fields for CHECKS PERFORMED diff block at preview time.
        originalTxid: rawTxid,
        originalFeeSats,
        originalFeeRate,
      };

      const prepareArgs: PrepareArgs = {
        to: recipientOutput.address,
        valueWei: "0",
        sats: String(recipientOutput.valueSats),
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 15: Build PREPARE RECEIPT from format-fanout-sentinel const.
      // -----------------------------------------------------------------------
      const inputRows = psbtResult.inputs
        .map((inp) =>
          INPUT_ROW_BTC_TEMPLATE
            .replace("{TXID_SHORT}", inp.txid.slice(0, 8))
            .replace("{VOUT}", String(inp.vout))
            .replace("{VALUE_SATS}", String(inp.valueSats))
            .replace("{SCRIPT_TYPE}", inp.scriptType),
        )
        .join("\n");

      const outputRows = psbtResult.outputs
        .map((out) =>
          OUTPUT_ROW_BTC_TEMPLATE
            .replace("{ADDRESS_SHORT}", out.address.slice(0, 12))
            .replace("{VALUE_SATS}", String(out.valueSats))
            .replace("{ROLE}", out.role),
        )
        .join("\n");

      const feeDeltaSats = newFeeSats - originalFeeSats;

      const prepareReceipt = PREPARE_RECEIPT_BTC_RBF_TEMPLATE
        .replace("{ORIGINAL_TXID}", rawTxid)
        .replace("{NEW_FEE_RATE}", String(newFeeRate))
        .replace("{ORIGINAL_FEE_SATS}", String(originalFeeSats))
        .replace("{ORIGINAL_FEE_RATE}", originalFeeRate.toFixed(2))
        .replace("{NEW_FEE_SATS}", String(psbtResult.feeSats))
        .replace("{FEE_DELTA_SATS}", String(feeDeltaSats))
        .replace("{INPUT_ROWS}", inputRows)
        .replace("{OUTPUT_ROWS}", outputRows);

      const responseText =
        `${prepareReceipt}\n\nHandle: ${handle}\npayloadFingerprint: ${payloadFingerprint}\n\n` +
        "Next step: pass this handle to preview_send.";

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: {
          handle,
          chain: "bitcoin" as const,
          txid: rawTxid,
          kind: "rbf" as const,
          inputs: psbtResult.inputs.map((inp) => ({
            txid: inp.txid,
            vout: inp.vout,
            valueSats: String(inp.valueSats),
            scriptType: inp.scriptType,
          })),
          outputs: psbtResult.outputs.map((out) => ({
            address: out.address,
            valueSats: String(out.valueSats),
            role: out.role,
          })),
          originalFeeSats: String(originalFeeSats),
          originalFeeRate: originalFeeRate.toFixed(2),
          feeSats: String(psbtResult.feeSats),
          feeRate: String(newFeeRate),
          feeDeltaSats: String(feeDeltaSats),
          payloadFingerprint,
          prepareReceipt,
          txType: "btc" as const,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_btc_rbf_bump failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_btc_rbf_bump failed",
          message,
        ),
      };
    }
  },
);
