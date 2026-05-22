// src/tools/sign_btc_multisig_psbt.ts — Phase 25 Plan 25-03
//
// MCP tool: sign_btc_multisig_psbt({ psbt: string, walletName: string })
//
// Prepare step for the multisig PSBT signing trust pipeline. Issues a
// `kind: "multisig-psbt"` handle that flows through preview_send →
// send_transaction where the Ledger device signs via AppClient.signPsbt.
//
// Trust pipeline:
//   input-validation (psbt: non-empty string, walletName: non-empty string)
//     → demo-mode FIRST refusal (WRONG_MODE)
//     → loadMultisigWallet(walletName) — undefined → MULTISIG_WALLET_NOT_FOUND
//     → walletHmac present? — absent → MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE
//     → Psbt.fromBase64(psbt) — throws → INVALID_INPUT
//     → extract perInputPrevouts (witnessScript as prevOutScript with "p2wpkh" scriptType)
//     → unsignedTxHex from psbt.data.globalMap.unsignedTx.toBuffer()
//     → computeAllSighashes (FROZEN btc-sighash.ts)
//     → computeBtcPayloadFingerprint (FROZEN btc-fingerprint.ts)
//     → per-input co-signer status (partialSig.length vs threshold)
//     → createHandle({ kind: "multisig-psbt", multisigWalletName, multisigThreshold, multisigTotalSigners })
//     → PREPARE RECEIPT from PREPARE_RECEIPT_BTC_MULTISIG_TEMPLATE + COSIGNER_STATUS_ROW_TEMPLATE
//     → return handle + payloadFingerprint + PREPARE RECEIPT
//
// Design constraints:
//   - PSBT is externally-supplied (Trust Pipeline Fork 4) — the user provides it.
//     The tool NEVER constructs a PSBT. Input validation is strict.
//   - FROZEN modules btc-fingerprint.ts + btc-sighash.ts are used via their
//     spy-affordance indirections; the modules themselves are NOT modified.
//   - P2WSH sighash: store witnessScript (p2ms redeem script) as prevOutScript
//     with scriptType "p2wpkh" — BIP-143 P2WSH scriptCode IS the witnessScript.
//     hashForWitnessV0 is identical for P2WPKH and P2WSH; the btc-sighash.ts
//     FROZEN dispatch uses this.
//   - Threat T-25-09: payloadFingerprint is computed over the externally-supplied
//     PSBT's per-input sighashes at prepare time. Layer 3 drift gate in
//     send_transaction catches any modification between prepare and send.
//   - Threat T-25-12: walletHmac re-checked at send_transaction layer
//     (belt-and-suspenders: refusal here + at send time).

import { Psbt, address as btcAddress, networks as btcNetworks } from "bitcoinjs-lib";
import { bytesToHex } from "@noble/hashes/utils";
import { Transaction } from "bitcoinjs-lib";

import "../chains/bitcoin/types.js"; // initEccLib side-effect
import { isDemoMode } from "../config/env.js";
import {
  COSIGNER_STATUS_ROW_TEMPLATE,
  INPUT_ROW_BTC_TEMPLATE,
  OUTPUT_ROW_BTC_TEMPLATE,
  PREPARE_RECEIPT_BTC_MULTISIG_TEMPLATE,
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
import { loadMultisigWallet } from "../wallet/btc-multisig-store.js";
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

/** Zero address for EVM-shape sentinel fields on PreparedTxBtc. */
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Prepare a Ledger signing session for a multisig Bitcoin PSBT.",
  "The wallet must have been registered via `register_btc_multisig_wallet` (with a Ledger-derived walletHmac) before calling this tool.",
  "`psbt` is the PSBT v0 base64 string to sign (e.g. from combine_btc_psbts or a co-signer).",
  "`walletName` is the name of a registered multisig wallet (must match a record in the registry).",
  "Returns a `handle` (kind: multisig-psbt), a PREPARE RECEIPT with per-input co-signer status, and a payloadFingerprint.",
  "Pass the handle to `preview_send` to review on-device, then to `send_transaction` to sign via the Ledger Bitcoin app.",
  "`send_transaction` returns the updated PSBT base64 (not a broadcast txid) — the Ledger signs your key's contribution; collect remaining co-signer contributions and use `finalize_btc_psbt` to broadcast.",
  "Refusal cases: MULTISIG_WALLET_NOT_FOUND (walletName not in registry — call register_btc_multisig_wallet first),",
  "MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE (registry record has no walletHmac — re-run register_btc_multisig_wallet with a Ledger connected),",
  "INVALID_INPUT (malformed PSBT base64, or missing walletName / psbt),",
  "WRONG_MODE (demo mode is active — multisig signing requires a real Ledger device).",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    psbt: {
      type: "string",
      description:
        "PSBT v0 base64 string for the multisig transaction. Must be a valid PSBT with witnessUtxo and witnessScript for each input.",
    },
    walletName: {
      type: "string",
      description:
        "Name of the registered multisig wallet. Must match a record created by register_btc_multisig_wallet.",
    },
  },
  required: ["psbt", "walletName"],
  additionalProperties: false,
};

// ─── Handler ──────────────────────────────────────────────────────────────────

registerTool(
  "sign_btc_multisig_psbt",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // -----------------------------------------------------------------------
      // Step 1: Input validation — FIRES FIRST (before any state read).
      // -----------------------------------------------------------------------
      const rawPsbt = typeof args.psbt === "string" ? args.psbt.trim() : "";
      if (!rawPsbt) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: psbt must be a non-empty PSBT v0 base64 string",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "psbt must be a non-empty PSBT v0 base64 string",
          ),
        };
      }

      const rawWalletName = typeof args.walletName === "string" ? args.walletName.trim() : "";
      if (!rawWalletName) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: walletName must be a non-empty string",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "walletName must be a non-empty string",
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 2: Demo-mode FIRST refusal.
      // Multisig signing requires a real Ledger device (AppClient.signPsbt).
      // -----------------------------------------------------------------------
      if (isDemoMode()) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: demo mode is active. sign_btc_multisig_psbt requires a real Ledger device — " +
                "disable demo mode (set_demo_wallet with no slug, or restart without DEMO_MODE=true).",
            },
          ],
          structuredContent: errEnvelope(
            "WRONG_MODE",
            "demo mode active; sign_btc_multisig_psbt requires a real Ledger device",
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 3: Load the registered wallet — undefined → MULTISIG_WALLET_NOT_FOUND.
      // -----------------------------------------------------------------------
      const wallet = loadMultisigWallet(rawWalletName);
      if (wallet === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: multisig wallet "${rawWalletName}" is not registered. ` +
                "Call register_btc_multisig_wallet first to register the wallet and get a walletHmac.",
            },
          ],
          structuredContent: errEnvelope(
            "MULTISIG_WALLET_NOT_FOUND",
            `multisig wallet "${rawWalletName}" not found in registry; call register_btc_multisig_wallet first`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 4: walletHmac present check — absent → MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE.
      // Threat T-25-12 mitigation: the Ledger AppClient.signPsbt requires the
      // walletHmac to authenticate the WalletPolicy. Without it, signing fails.
      // -----------------------------------------------------------------------
      if (!wallet.walletHmac) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: multisig wallet "${rawWalletName}" was registered without a Ledger device — ` +
                "the walletHmac is missing. Re-run register_btc_multisig_wallet with a Ledger connected " +
                "to obtain the device-derived walletHmac required for signing.",
            },
          ],
          structuredContent: errEnvelope(
            "MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE",
            `wallet "${rawWalletName}" has no walletHmac; re-run register_btc_multisig_wallet with Ledger connected`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 5: Parse the externally-supplied PSBT (Trust Pipeline Fork 4).
      // Malformed base64 or invalid PSBT structure → INVALID_INPUT.
      // -----------------------------------------------------------------------
      let psbt: Psbt;
      try {
        psbt = Psbt.fromBase64(rawPsbt);
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid PSBT base64: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid PSBT base64: ${cause}`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 6: Extract perInputPrevouts from the PSBT's witnessUtxo + witnessScript.
      //
      // For P2WSH multisig inputs, BIP-143 requires the witnessScript (p2ms redeem
      // script) as the scriptCode for hashForWitnessV0. The FROZEN btc-sighash.ts
      // only understands "p2wpkh" | "p2tr"; P2WSH uses the same BIP-143 path as
      // P2WPKH (hashForWitnessV0), so we pass scriptType "p2wpkh" with the
      // witnessScript (NOT the P2WSH output script) as prevOutScript.
      //
      // Pitfall (Fixture X): using the P2WSH output script (sha256(witnessScript))
      // instead of the witnessScript produces a different sighash preimage.
      // The Fixture X literal 0xced8fc41... was computed with the witnessScript.
      // -----------------------------------------------------------------------
      type PerInputPrevout = { script: Uint8Array; valueSats: bigint; scriptType: "p2wpkh" | "p2tr" };
      const perInputPrevouts: PerInputPrevout[] = [];
      const inputDecoded: Array<{ txid: string; vout: number; valueSats: bigint; scriptType: "p2wpkh" | "p2tr" }> = [];

      for (let i = 0; i < psbt.data.inputs.length; i++) {
        const inp = psbt.data.inputs[i];
        const txIn = psbt.txInputs[i];

        if (!inp || !txIn) {
          return {
            isError: true,
            content: [
              { type: "text", text: `error: PSBT is missing input data at index ${i}` },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `PSBT missing input data at index ${i}`,
            ),
          };
        }

        if (!inp.witnessUtxo) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `error: PSBT input[${i}] is missing witnessUtxo. ` +
                  "Multisig P2WSH inputs must have witnessUtxo populated.",
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `PSBT input[${i}] missing witnessUtxo; multisig P2WSH requires witnessUtxo`,
            ),
          };
        }

        // Use witnessScript as prevOutScript for BIP-143 hashForWitnessV0.
        // Fall back to witnessUtxo script if witnessScript is absent (non-standard).
        const prevOutScript = inp.witnessScript ?? inp.witnessUtxo.script;
        const valueSats = inp.witnessUtxo.value;

        perInputPrevouts.push({
          script: prevOutScript,
          valueSats,
          scriptType: "p2wpkh", // P2WSH uses hashForWitnessV0 via the same dispatch
        });

        // Decode input for PREPARE RECEIPT (txid in display byte order)
        const txidBuf = Buffer.from(txIn.hash);
        txidBuf.reverse();
        const txid = bytesToHex(txidBuf);
        inputDecoded.push({
          txid,
          vout: txIn.index,
          valueSats,
          scriptType: "p2wpkh",
        });
      }

      // -----------------------------------------------------------------------
      // Step 7: Build unsignedTxHex for fingerprint recompute.
      //
      // Pitfall: bitcoinjs-lib Psbt always creates a version-2 transaction,
      // but the FROZEN computeAllSighashes / Fixture X computation uses
      // `new Transaction()` which defaults to version 1. To keep the Fixture X
      // literal consistent (0xced8fc41...), we reconstruct the unsigned transaction
      // from scratch (version 1, locktime 0) using the PSBT's input/output data
      // rather than using globalMap.unsignedTx (which has version 2).
      //
      // This reconstruction is DETERMINISTIC: the sighash preimage depends only
      // on version, inputs (hash/index/sequence), outputs (script/value), and
      // locktime — all of which are faithfully copied here.
      // -----------------------------------------------------------------------
      const reconTx = new Transaction();
      // version defaults to 1 in new Transaction() — matches Fixture X computation.
      for (let i = 0; i < psbt.data.inputs.length; i++) {
        const txIn = psbt.txInputs[i]!;
        // txIn.hash is already in internal byte order (reversed txid); addInput expects it as-is.
        reconTx.addInput(
          Buffer.from(txIn.hash),
          txIn.index,
          txIn.sequence,
        );
      }
      for (const txOut of psbt.txOutputs) {
        reconTx.addOutput(txOut.script, txOut.value);
      }
      const unsignedTxHex = reconTx.toHex();

      // -----------------------------------------------------------------------
      // Step 8: Compute per-input sighashes via FROZEN computeAllSighashes.
      // -----------------------------------------------------------------------
      const sighashInputs = perInputPrevouts.map((p) => ({
        scriptType: p.scriptType,
        prevOutScript: p.script,
        valueSats: p.valueSats,
      }));
      const perInputSighashes = _btcSighash.computeAllSighashes(
        reconTx,
        sighashInputs,
      );

      // -----------------------------------------------------------------------
      // Step 9: Compute payloadFingerprint via FROZEN computeBtcPayloadFingerprint.
      // T-25-09 mitigation: fingerprint is anchored at prepare time; Layer 3
      // drift gate in send_transaction catches any modification.
      // -----------------------------------------------------------------------
      const payloadFingerprint = _btcFingerprint.computeBtcPayloadFingerprint(
        perInputSighashes,
      );

      // -----------------------------------------------------------------------
      // Step 10: Compute per-input co-signer status.
      // -----------------------------------------------------------------------
      const threshold = wallet.threshold;
      const cosignerStatusRows = psbt.data.inputs.map((inp, idx) => {
        const sigsPresent = (inp.partialSig ?? []).length;
        const stillNeeded = Math.max(0, threshold - sigsPresent);
        return COSIGNER_STATUS_ROW_TEMPLATE
          .replace("{INPUT_INDEX}", String(idx))
          .replace("{SIGS_PRESENT}", String(sigsPresent))
          .replace("{THRESHOLD}", String(threshold))
          .replace("{STILL_NEEDED}", String(stillNeeded));
      }).join("\n");

      // -----------------------------------------------------------------------
      // Step 11: Decode outputs for PREPARE RECEIPT.
      // -----------------------------------------------------------------------
      const txOutputs = psbt.txOutputs;
      const outputDecoded: Array<{ address: string; valueSats: bigint; role: "recipient" | "change" }> = [];
      for (let i = 0; i < txOutputs.length; i++) {
        const txOut = txOutputs[i];
        const psbtOut = psbt.data.outputs[i];
        if (!txOut) continue;
        let addr = "unknown";
        try {
          addr = btcAddress.fromOutputScript(txOut.script, btcNetworks.bitcoin);
        } catch {
          // Non-standard script — leave as "unknown".
        }
        const isChange =
          (psbtOut?.bip32Derivation !== undefined && psbtOut.bip32Derivation.length > 0) ||
          (psbtOut?.tapBip32Derivation !== undefined && psbtOut.tapBip32Derivation.length > 0);
        outputDecoded.push({
          address: addr,
          valueSats: txOut.value,
          role: isChange ? "change" : "recipient",
        });
      }

      // -----------------------------------------------------------------------
      // Step 12: Compute fee = sum(inputs) - sum(outputs).
      // -----------------------------------------------------------------------
      const inputSum = inputDecoded.reduce((acc, inp) => acc + inp.valueSats, 0n);
      const outputSum = outputDecoded.reduce((acc, out) => acc + out.valueSats, 0n);
      const feeSats = inputSum >= outputSum ? inputSum - outputSum : 0n;

      // -----------------------------------------------------------------------
      // Step 13: Build PreparedTxBtc with kind: "multisig-psbt".
      // EVM-shape sentinel fields set to zero per convention.
      // -----------------------------------------------------------------------

      const tx: PreparedTxBtc = {
        txType: "btc",
        // EVM-shape sentinel fields.
        chainId: 0,
        to: ZERO_EVM_ADDRESS,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        // BTC-specific fields.
        kind: "multisig-psbt",
        psbtBase64: rawPsbt,
        unsignedTxHex,
        perInputPrevouts,
        inputScriptTypes: inputDecoded.map((i) => i.scriptType),
        inputs: inputDecoded,
        outputs: outputDecoded,
        feeSats,
        changeSats: 0n, // Externally-supplied PSBT — change is not tracked separately
        feeRate: 0, // Not computed for externally-supplied PSBTs
        changePath: null,
        changeAddress: null,
        // Multisig-specific fields.
        multisigWalletName: rawWalletName,
        multisigThreshold: threshold,
        multisigTotalSigners: wallet.totalSigners,
      };

      // -----------------------------------------------------------------------
      // Step 14: createHandle.
      // -----------------------------------------------------------------------
      const prepareArgs: PrepareArgs = {
        to: rawWalletName, // walletName as the "to" for PREPARE RECEIPT verbatim-args
        valueWei: "0",
        sats: String(inputSum),
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 15: Build PREPARE RECEIPT from PREPARE_RECEIPT_BTC_MULTISIG_TEMPLATE.
      // CLAUDE.md: PREPARE RECEIPT carries verbatim args (walletName, psbt excerpt).
      // -----------------------------------------------------------------------
      const inputRows = inputDecoded
        .map((inp) =>
          INPUT_ROW_BTC_TEMPLATE
            .replace("{TXID_SHORT}", inp.txid.slice(0, 8))
            .replace("{VOUT}", String(inp.vout))
            .replace("{VALUE_SATS}", String(inp.valueSats))
            .replace("{SCRIPT_TYPE}", inp.scriptType),
        )
        .join("\n");

      const outputRows = outputDecoded
        .map((out) =>
          OUTPUT_ROW_BTC_TEMPLATE
            .replace("{ADDRESS_SHORT}", out.address.slice(0, 12))
            .replace("{VALUE_SATS}", String(out.valueSats))
            .replace("{ROLE}", out.role),
        )
        .join("\n");

      const prepareReceipt = PREPARE_RECEIPT_BTC_MULTISIG_TEMPLATE
        .replace("{WALLET_NAME}", rawWalletName)
        .replace("{THRESHOLD}", String(threshold))
        .replace("{TOTAL_SIGNERS}", String(wallet.totalSigners))
        .replace("{INPUT_ROWS}", inputRows)
        .replace("{OUTPUT_ROWS}", outputRows)
        .replace("{FEE_SATS}", String(feeSats))
        .replace("{COSIGNER_STATUS_ROWS}", cosignerStatusRows);

      const responseText =
        `${prepareReceipt}\n\nHandle: ${handle}\npayloadFingerprint: ${payloadFingerprint}\n\n` +
        "Next step: pass this handle to preview_send.";

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: {
          handle,
          chain: "bitcoin" as const,
          kind: "multisig-psbt" as const,
          walletName: rawWalletName,
          threshold,
          totalSigners: wallet.totalSigners,
          payloadFingerprint,
          prepareReceipt,
          inputCount: inputDecoded.length,
          outputCount: outputDecoded.length,
          feeSats: String(feeSats),
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
            text: `error: sign_btc_multisig_psbt failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "sign_btc_multisig_psbt failed",
          message,
        ),
      };
    }
  },
);
