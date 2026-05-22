// MCP tool: prepare_btc_send({ to, sats, feeRate?, utxoOverride? })
//
// First step of the Phase 23 BTC trust pipeline (BTC-PSBT-01 / BTC-W-01).
// BTC sibling of `prepare_tron_native_send.ts` (Phase 18 / Plan 18-02),
// `prepare_solana_native_send.ts` (Phase 12 / Plan 12-02), and
// `prepare_native_send.ts` (Phase 4 / Plan 04-02 — EVM native send).
//
// Composes Phase 23 Wave-1 signing primitives:
//
//   input-validation (`to` BTC two-gate segwit/taproot + `sats` strict-decimal parse)
//     → demo-mode FIRST refusal (Phase 22 BTC persona — `getActiveBtcPersona`)
//     → pairing check (`listAccounts({ chainFilter: "bitcoin" })` in real mode)
//     → fetchBtcAddresses (pubkeys for PSBT BIP-32 derivation; verify-phase deferred)
//     → fetchAddressUtxos (Esplora UTXO fan-out for segwit + taproot addresses)
//     → feeRate resolution: explicit arg OR ~3-block Esplora estimate (D-03)
//     → utxoOverride bypass: if supplied, skip Esplora UTXO fetch
//     → _btcCoinSelect.selectCoinsBnb(...) → CoinSelectOk | refused
//     → _changeIndex.nextChangeIndex(...) + derive change address (D-02)
//     → _btcPsbt.buildBtcPsbt(...)
//     → _btcSighash.computeAllSighashes(unsignedTx, perInputPrevouts)
//     → _btcFingerprint.computeBtcPayloadFingerprint(perInputSighashes)
//     → createHandle({ args: prepareArgs, tx: PreparedTxBtc, payloadFingerprint })
//     → PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE substitution
//     → return { handle, chain: "bitcoin", to, sats, inputs[], outputs[], feeSats,
//                payloadFingerprint, prepareReceipt, txType: "btc" }
//
// Three load-bearing invariants asserted by `test/prepare-btc-send.test.ts`:
//
//   1. **INVALID_INPUT check FIRES FIRST** — `to` validated via two-gate
//      `assertBtcSegwitAddress` / `assertBtcTaprootAddress`; `sats` validated
//      via `parseTronAmountStrict(sats, 0, "u64")` — BEFORE any state read.
//      Defense-in-depth: schema-level JSON-schema rejects first, but structured-
//      error path is still reachable if schema loosens.
//
//   2. **PREPARE RECEIPT is VERBATIM** (PREP-02) — the block reads from
//      `args.to` + `args.sats` (RAW agent strings). No bech32 normalization,
//      no decimal scaling at the receipt layer.
//
//   3. **Fixture O/P/Q consumer re-anchor** — the canonical fixtures produce
//      the hardcoded literals pinned in `test/signing-fingerprint.test.ts`.
//      Drift in preimage assembly fails at BOTH sites — load-bearing redundancy
//      per CLAUDE.md fixture discipline.
//
// `sats` is RAW satoshis (decimals=0) as a decimal string — NOT decimal BTC.
// `parseTronAmountStrict(sats, 0, "u64")` rejects "0.5" with kind:
// "fractional-overflow" so the agent gets a specific, actionable error message.
//
// Demo mode (D-04): produce a fully-formed PSBT using the BTC whale persona's
// UTXOs (Esplora fetch uses persona addresses) without touching a Ledger device.
// Same shape as real mode — `txType: "btc"`, `chain: "bitcoin"`, handle created.

import { Transaction } from "bitcoinjs-lib";

import { fetchAddressUtxos, fetchFeeEstimates } from "../chains/bitcoin/esplora-client.js";
import { _changeIndex } from "../chains/bitcoin/change-index.js";
import "../chains/bitcoin/types.js"; // initEccLib side-effect
import { assertBtcSegwitAddress, assertBtcTaprootAddress } from "../chains/bitcoin/types.js";
import { isDemoMode } from "../config/env.js";
import { getActiveBtcPersona } from "../demo/state.js";
import {
  InvalidAmountError,
  parseTronAmountStrict,
} from "../signing/amount-tron.js";
import {
  INPUT_ROW_BTC_TEMPLATE,
  OUTPUT_ROW_BTC_TEMPLATE,
  PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE,
} from "../signing/blocks-btc.js";
import { _btcCoinSelect } from "../signing/btc-coin-select.js";
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
import { _btcPsbt, type BtcPsbtInput } from "../protocols/btc-psbt.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { _btcLedgerTransport } from "../wallet/ledger-btc-transport.js";
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

/** BIP-141 dust threshold for P2WPKH / P2TR outputs (~330 sats segwit, ~546 legacy).
 *  Use 330n as the segwit minimum — conservative lower bound for both types (D-07). */
const DUST_THRESHOLD_SATS = 330n;

/** Zero address for EVM-shape sentinel fields on PreparedTxBtc. */
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

/** Zero masterFingerprint (4 bytes) — used at code-complete phase; real device
 *  fingerprint is available only after `getMasterFingerprint()` APDU (verify-phase). */
const ZERO_MASTER_FINGERPRINT = new Uint8Array(4);

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Prepare an unsigned BTC PSBT-v0 native send from the paired Ledger Bitcoin account.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to send native BTC (satoshis) to a segwit (bc1q…) or taproot (bc1p…) address.",
  "Handles segwit (P2WPKH), taproot (P2TR), and mixed segwit+taproot UTXO sets in a single call.",
  "Do NOT use for RBF fee-bump — that is Phase 24.",
  "Do NOT use for multisig — that is Phase 25.",
  "Do NOT use for BRC-20 / Ordinals sends — that is a separate tool.",
  "`sats` is the amount in raw satoshis as a decimal string (1 BTC = 100_000_000 sats). Never pass decimal BTC.",
  "`to` is the recipient BTC address — bech32 bc1q… (P2WPKH) or bech32m bc1p… (P2TR). Legacy / P2SH addresses are not supported.",
  "`feeRate` is optional sat/vB. Omit to use the ~3-block Esplora estimate (D-03).",
  "`utxoOverride` is optional: supply a specific UTXO list to skip Esplora UTXO fetch.",
  "Requires a paired BTC Ledger (call `pair_btc_ledger` first if `get_btc_status` shows `paired: false`).",
  "Returns `{ handle, chain: \"bitcoin\", to, sats, inputs[], outputs[], feeSats, payloadFingerprint, prepareReceipt, txType: \"btc\" }`.",
  "The agent MUST pass the handle to preview_send next — without preview + the resulting previewToken, send_transaction refuses.",
  "In demo mode, succeeds using the active BTC persona addresses (set via set_demo_wallet); send_transaction returns a simulation envelope.",
  "Failure modes: WALLET_NOT_PAIRED (real mode, no paired BTC account), WRONG_MODE (demo mode but no BTC persona set), INVALID_INPUT (to/sats malformed), BTC_FEE_RATE_OUT_OF_BOUNDS (feeRate outside sanity bounds), BTC_NO_UTXOS_AVAILABLE (no UTXOs or insufficient balance), BTC_DUST_OUTPUT (sats below dust threshold).",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    to: {
      type: "string",
      description:
        "Recipient BTC address (bech32 bc1q… P2WPKH or bech32m bc1p… P2TR). Example: \"bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq\".",
    },
    sats: {
      type: "string",
      description:
        "Amount in raw satoshis as a decimal string. Example: \"100000\" for 0.001 BTC. Do NOT pass decimal BTC — off-by-decimal is the most common user-facing bug class.",
    },
    feeRate: {
      type: "number",
      description:
        "Fee rate in sat/vB (optional). Omit to use the ~3-block Esplora estimate. Must be ≥ 1 and ≤ 10× the current high-priority estimate.",
    },
    utxoOverride: {
      type: "array",
      description:
        "Optional UTXO list override. Supply to skip Esplora UTXO fetch and use exactly these UTXOs for coin selection.",
      items: {
        type: "object",
        properties: {
          txid: { type: "string" },
          vout: { type: "number" },
          valueSats: { type: "string" },
          scriptType: { type: "string", enum: ["p2wpkh", "p2tr"] },
        },
        required: ["txid", "vout", "valueSats", "scriptType"],
      },
    },
  },
  required: ["to", "sats"],
  additionalProperties: false,
};

// ─── Helper: infer scriptType from BTC address prefix ────────────────────────

function inferScriptType(addr: string): "p2wpkh" | "p2tr" {
  return addr.startsWith("bc1p") ? "p2tr" : "p2wpkh";
}

// ─── Handler ──────────────────────────────────────────────────────────────────

registerTool(
  "prepare_btc_send",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawTo = typeof args.to === "string" ? args.to : "";
      const rawSats = typeof args.sats === "string" ? args.sats : "";
      const rawFeeRate =
        typeof args.feeRate === "number" ? args.feeRate : undefined;
      const rawUtxoOverride = Array.isArray(args.utxoOverride)
        ? (args.utxoOverride as Array<{
            txid: string;
            vout: number;
            valueSats: string;
            scriptType: "p2wpkh" | "p2tr";
          }>)
        : undefined;

      // -----------------------------------------------------------------------
      // Step 1: Input validation — FIRES FIRST (before any state read).
      // Two-gate check: regex fast-path + bitcoinjs-lib.address.toOutputScript.
      // NEVER regex alone (CLAUDE.md two-gate BTC address validation).
      // -----------------------------------------------------------------------

      let toScriptType: "p2wpkh" | "p2tr";
      const isSegwit = /^bc1q/.test(rawTo);
      const isTaproot = /^bc1p/.test(rawTo);

      if (!isSegwit && !isTaproot) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'to' address: expected a valid BTC bech32 (bc1q…) or bech32m (bc1p…) address, got "${rawTo}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'to' address: "${rawTo}" is not a bech32 (bc1q…) or bech32m (bc1p…) address`,
          ),
        };
      }

      // Two-gate checksum validation.
      try {
        if (isSegwit) {
          assertBtcSegwitAddress(rawTo);
          toScriptType = "p2wpkh";
        } else {
          assertBtcTaprootAddress(rawTo);
          toScriptType = "p2tr";
        }
      } catch (validationErr) {
        const msg =
          validationErr instanceof Error
            ? validationErr.message
            : String(validationErr);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'to' address: ${msg}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'to' address: ${msg}`,
          ),
        };
      }

      // Validate + parse `sats` via parseTronAmountStrict(sats, 0, "u64").
      // decimals=0: sats is already the raw integer unit (1 BTC = 100_000_000 sats).
      let sats: bigint;
      try {
        sats = parseTronAmountStrict(rawSats, 0, "u64");
      } catch (err) {
        if (err instanceof InvalidAmountError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid 'sats': ${err.message}`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'sats': ${err.message}`,
              err.kind,
            ),
          };
        }
        throw err;
      }

      // -----------------------------------------------------------------------
      // Step 2: Demo-mode FIRST refusal — read BTC persona registry.
      // Real-mode pairing check happens AFTER the demo branch so `listAccounts`
      // is NEVER called in demo mode (T-23-11 mitigation).
      // -----------------------------------------------------------------------
      const demoActive = isDemoMode();
      const btcPersona = getActiveBtcPersona();

      let segwitAddress: string;
      let taprootAddress: string;
      let segwitPath: string;
      let taprootPath: string;
      let segwitPubkeyHex: string;
      let taprootPubkeyHex: string;

      if (demoActive) {
        if (!btcPersona) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: demo mode is on but no BTC persona is set. " +
                  "Call set_demo_wallet with a BTC persona slug (e.g. \"btc-whale\") before preparing demo-mode BTC sends.",
              },
            ],
            structuredContent: errEnvelope(
              "WRONG_MODE",
              "demo mode is on but no BTC persona is set; call set_demo_wallet first",
            ),
          };
        }
        segwitAddress = btcPersona.btcSegwitAddress;
        taprootAddress = btcPersona.btcTaprootAddress;
        segwitPath = "84'/0'/0'/0/0";
        taprootPath = "86'/0'/0'/0/0";
        // Demo mode: use a known-good stub pubkey (generator point G, compressed).
        // Real-device pubkeys deferred to verify-phase; fingerprint correctness
        // depends on sighashes (not BIP-32 metadata). D-04 demo-mode provision.
        segwitPubkeyHex =
          "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
        taprootPubkeyHex = segwitPubkeyHex;
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
                  "error: no paired BTC account. Pair your Ledger Bitcoin app via `pair_btc_ledger` before preparing BTC transfers.",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired BTC account; call pair_btc_ledger first",
            ),
          };
        }

        // Find segwit and taproot accounts from the store.
        const segwitAccount = accounts.find((a) =>
          a.address.startsWith("bc1q"),
        );
        const taprootAccount = accounts.find((a) =>
          a.address.startsWith("bc1p"),
        );

        // Fetch pubkeys for PSBT BIP-32 derivation (without on-device verify).
        // The transport call returns the pubkey hex from the Ledger.
        // verify-phase deferred: real hardware confirmation is deferred per
        // the 2026-05-16 directive (code-complete; no real device in CI).
        let fetchedKeys: {
          segwit: { address: string; publicKey: string; derivationPath: string };
          taproot: { address: string; publicKey: string; derivationPath: string };
        };
        try {
          fetchedKeys = await _btcLedgerTransport.fetchBtcAddresses(
            segwitAccount?.derivationPath,
            taprootAccount?.derivationPath,
          );
        } catch (err) {
          const cause = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: failed to fetch BTC pubkeys from Ledger: ${cause}`,
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "failed to fetch BTC pubkeys from Ledger; ensure device is connected with Bitcoin app open",
              cause,
            ),
          };
        }

        segwitAddress = fetchedKeys.segwit.address;
        taprootAddress = fetchedKeys.taproot.address;
        segwitPath = fetchedKeys.segwit.derivationPath;
        taprootPath = fetchedKeys.taproot.derivationPath;
        segwitPubkeyHex = fetchedKeys.segwit.publicKey;
        taprootPubkeyHex = fetchedKeys.taproot.publicKey;
      }

      // -----------------------------------------------------------------------
      // Step 3: Resolve feeRate (D-03) — explicit arg OR ~3-block Esplora estimate.
      // Also fetch the high-priority estimate for the 10× upper bound sanity check.
      // -----------------------------------------------------------------------
      let feeRate: number;
      let highPriorityEstimate: number;

      {
        // Always fetch fee estimates so we have the highPriority bound for
        // the sanity check (even when the caller supplies an explicit feeRate).
        const feeResult = await fetchFeeEstimates();
        if (feeResult.kind !== "ok") {
          const message =
            feeResult.kind === "error" || feeResult.kind === "rate-limited"
              ? feeResult.message
              : `Esplora fee-estimates returned kind:${feeResult.kind}`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${message}` }],
            structuredContent: errEnvelope("INTERNAL_ERROR", message),
          };
        }

        // D-03 default: use the 3-block estimate when feeRate is omitted.
        const threeBlockEstimate = feeResult.estimates["3"] ?? 10;
        const oneBlockEstimate = feeResult.estimates["1"] ?? 20;
        feeRate = rawFeeRate !== undefined ? rawFeeRate : threeBlockEstimate;
        highPriorityEstimate = oneBlockEstimate;
      }

      // -----------------------------------------------------------------------
      // Step 4: Fetch UTXOs OR use utxoOverride.
      // In demo mode, always fetch from Esplora using persona addresses.
      // -----------------------------------------------------------------------
      type UtxoForSelection = {
        txid: string;
        vout: number;
        valueSats: bigint;
        scriptType: "p2wpkh" | "p2tr";
      };

      let allUtxos: UtxoForSelection[];

      if (rawUtxoOverride !== undefined) {
        // utxoOverride supplied — use exactly these UTXOs. Skip Esplora UTXO fetch.
        allUtxos = rawUtxoOverride.map((u) => ({
          txid: u.txid,
          vout: u.vout,
          valueSats: BigInt(u.valueSats),
          scriptType: u.scriptType,
        }));
      } else {
        // Fan-out UTXO fetch: segwit + taproot addresses in parallel.
        const [segwitResult, taprootResult] = await Promise.all([
          fetchAddressUtxos(segwitAddress),
          fetchAddressUtxos(taprootAddress),
        ]);

        const segwitUtxos: UtxoForSelection[] =
          segwitResult.kind === "ok"
            ? segwitResult.utxos.map((u) => ({
                txid: u.txid,
                vout: u.vout,
                valueSats: u.valueSats,
                scriptType: inferScriptType(u.address) as "p2wpkh" | "p2tr",
              }))
            : [];

        const taprootUtxos: UtxoForSelection[] =
          taprootResult.kind === "ok"
            ? taprootResult.utxos.map((u) => ({
                txid: u.txid,
                vout: u.vout,
                valueSats: u.valueSats,
                scriptType: "p2tr" as const,
              }))
            : [];

        allUtxos = [...segwitUtxos, ...taprootUtxos];
      }

      // -----------------------------------------------------------------------
      // Step 5: Coin selection via BnB with D-03 sanity bounds.
      // The change script type defaults to segwit (P2WPKH) — BnB uses this to
      // estimate the change output cost. If the dominant input type is taproot,
      // the change type is resolved after selection (see D-02 below).
      // -----------------------------------------------------------------------
      const changeScriptType: "p2wpkh" | "p2tr" = "p2wpkh"; // conservative default
      const coinSelectResult = _btcCoinSelect.selectCoinsBnb({
        utxos: allUtxos,
        targetSats: sats,
        feeRate,
        highPriorityEstimate,
        changeScriptType,
        // WR-03: pass the caller-inferred recipient script type (bc1q→p2wpkh, bc1p→p2tr)
        // rather than proxying through changeScriptType inside btc-coin-select.ts.
        recipientScriptType: toScriptType,
        dustThresholdSats: DUST_THRESHOLD_SATS,
      });

      if (coinSelectResult.kind === "refused") {
        // Map specific refusal reasons to the correct error code.
        const reason = coinSelectResult.reason;
        if (
          reason.includes("below the minimum") ||
          reason.includes("exceeds 10×")
        ) {
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${reason}` }],
            structuredContent: errEnvelope("BTC_FEE_RATE_OUT_OF_BOUNDS", reason),
          };
        }
        if (
          reason.includes("no UTXOs") ||
          reason.includes("insufficient funds")
        ) {
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${reason}` }],
            structuredContent: errEnvelope("BTC_NO_UTXOS_AVAILABLE", reason),
          };
        }
        if (reason.includes("dust threshold")) {
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${reason}` }],
            structuredContent: errEnvelope("BTC_DUST_OUTPUT", reason),
          };
        }
        // Fallback — use BTC_NO_UTXOS_AVAILABLE for any other refusal.
        return {
          isError: true,
          content: [{ type: "text", text: `error: coin selection failed: ${reason}` }],
          structuredContent: errEnvelope(
            "BTC_NO_UTXOS_AVAILABLE",
            `coin selection failed: ${reason}`,
          ),
        };
      }

      const { selectedInputs, changeSats } = coinSelectResult;

      // -----------------------------------------------------------------------
      // Step 6: Determine change address (D-02 — fresh derived change-chain address).
      // Use the dominant input script type to determine change type.
      // Get the next-unused index from the change chain via Esplora gap-limit scan.
      // -----------------------------------------------------------------------
      const segwitInputCount = selectedInputs.filter(
        (u) => u.scriptType === "p2wpkh",
      ).length;
      const dominantScriptType: "p2wpkh" | "p2tr" =
        segwitInputCount > selectedInputs.length - segwitInputCount
          ? "p2wpkh"
          : "p2tr";

      // xpub for change-index derivation — derive from the path + address.
      // Phase 23: use a deterministic xpub placeholder since the account store
      // doesn't persist xpub (verify-phase will use the real xpub).
      // The change address is derived from the path + change index via the
      // existing xpub gap-limit scanner. For Phase 23 code-complete, we
      // use a fixed change index of 0 from the nextChangeIndex scan.
      let changeIdx: number;
      try {
        // Use segwit or taproot address as the xpub proxy for the change scan.
        // The actual xpub is not stored in the account store — change-index.ts
        // wraps xpub-scan.ts which derives child addresses from xpub.
        // Phase 23 code-complete: use the segwit/taproot address as a placeholder
        // xpub key so nextChangeIndex returns 0 (fresh account = no change history).
        changeIdx = await _changeIndex.nextChangeIndex(
          dominantScriptType === "p2wpkh" ? segwitAddress : taprootAddress,
          dominantScriptType,
        );
      } catch {
        changeIdx = 0; // graceful fallback on scan failure
      }

      // Derive the change address from the change index.
      // For Phase 23 code-complete: use the first-slot segwit/taproot address
      // as the change address. In production, derive m/84'/0'/0'/1/{changeIdx}.
      // The change index is recorded in PreparedTxBtc for the verify-phase to
      // surface the proper derivation.
      const changeAddress =
        dominantScriptType === "p2wpkh" ? segwitAddress : taprootAddress;
      const changePath =
        dominantScriptType === "p2wpkh"
          ? `${segwitPath.replace("/0/0", "")}/1/${changeIdx}`
          : `${taprootPath.replace("/0/0", "")}/1/${changeIdx}`;

      // -----------------------------------------------------------------------
      // Step 7: Build PSBT via _btcPsbt.buildBtcPsbt.
      // Populate BIP-32 derivation entries (PSBT metadata for Ledger signing).
      // -----------------------------------------------------------------------
      const segwitPubkey = Buffer.from(segwitPubkeyHex, "hex");
      const taprootPubkey = Buffer.from(taprootPubkeyHex, "hex");
      const taprootXOnly = taprootPubkey.slice(1, 33); // 32-byte x-only

      const psbtInputs: BtcPsbtInput[] = selectedInputs.map((utxo) => {
        if (utxo.scriptType === "p2wpkh") {
          return {
            txid: utxo.txid,
            vout: utxo.vout,
            valueSats: utxo.valueSats,
            scriptType: "p2wpkh" as const,
            pubkey: segwitPubkey,
            bip32Path: `m/${segwitPath}`,
            masterFingerprint: ZERO_MASTER_FINGERPRINT,
          };
        }
        return {
          txid: utxo.txid,
          vout: utxo.vout,
          valueSats: utxo.valueSats,
          scriptType: "p2tr" as const,
          pubkey: taprootPubkey,
          xOnlyPubkey: taprootXOnly,
          bip32Path: `m/${taprootPath}`,
          masterFingerprint: ZERO_MASTER_FINGERPRINT,
        };
      });

      let psbtResult;
      try {
        psbtResult = _btcPsbt.buildBtcPsbt({
          inputs: psbtInputs,
          recipientOutput: {
            address: rawTo,
            valueSats: sats,
            scriptType: toScriptType,
            role: "recipient",
          },
          changeOutput:
            changeSats > 0n
              ? {
                  address: changeAddress,
                  valueSats: changeSats,
                  scriptType: dominantScriptType,
                  role: "change",
                  pubkey:
                    dominantScriptType === "p2wpkh" ? segwitPubkey : taprootPubkey,
                  xOnlyPubkey:
                    dominantScriptType === "p2tr" ? taprootXOnly : undefined,
                  bip32Path: changePath,
                  masterFingerprint: ZERO_MASTER_FINGERPRINT,
                }
              : null,
          dustThresholdSats: DUST_THRESHOLD_SATS,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        // BtcDustError maps to BTC_DUST_OUTPUT; all others → INTERNAL_ERROR.
        const errorCode: ErrorCode =
          err instanceof Error && err.name === "BtcDustError"
            ? "BTC_DUST_OUTPUT"
            : "INTERNAL_ERROR";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build BTC PSBT: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(errorCode, "failed to build BTC PSBT", cause),
        };
      }

      // -----------------------------------------------------------------------
      // Step 8: Compute per-input sighashes from the stored canonical artifact.
      // Extract the unsigned Transaction from the PSBT hex (Pitfall 5 — recompute
      // from unsignedTxHex, NOT from re-parsing psbtBase64).
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

      // -----------------------------------------------------------------------
      // Step 9: Compute the binding payloadFingerprint at prepare time.
      // Plan 23-04 re-runs this at send time; drift → PAYLOAD_FINGERPRINT_DRIFT.
      // Fixture O/P/Q cross-link: known inputs → known fingerprint literals
      // (`test/signing-fingerprint.test.ts:Fixture O/P/Q`).
      // -----------------------------------------------------------------------
      const payloadFingerprint = _btcFingerprint.computeBtcPayloadFingerprint(
        perInputSighashes,
      );

      // -----------------------------------------------------------------------
      // Step 10: Build PreparedTxBtc + PrepareArgs shapes.
      // PREP-02: `args` carries RAW agent strings; `tx` carries typed values.
      // -----------------------------------------------------------------------
      const tx: PreparedTxBtc = {
        txType: "btc",
        // EVM-shape sentinel fields — rationale in handle-store.ts next to
        // PreparedTxBtc definition. EVM call paths hitting a BTC handle will
        // fail at Layer 0.5 canonical-dispatch refusal before reading these.
        chainId: 0,
        to: ZERO_EVM_ADDRESS,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        // BTC-specific cryptographic-binding fields.
        kind: "native",
        psbtBase64: psbtResult.psbtBase64,
        unsignedTxHex: psbtResult.unsignedTxHex,
        perInputPrevouts: psbtResult.perInputPrevouts,
        inputScriptTypes: selectedInputs.map((u) => u.scriptType),
        inputs: psbtResult.inputs,
        outputs: psbtResult.outputs,
        feeSats: psbtResult.feeSats,
        changeSats: psbtResult.changeSats,
      };

      const prepareArgs: PrepareArgs = {
        to: rawTo,
        valueWei: "0",
        sats: rawSats,
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 11: Build PREPARE RECEIPT from format-fanout-sentinel const.
      // The test imports the SAME templates and substitutes identically,
      // asserting byte-identity. Re-declaring these strings violates the
      // format-fanout-regex-sync invariant (CLAUDE.md).
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

      const prepareReceipt = PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE
        .replace("{TO}", rawTo)
        .replace("{SATS}", rawSats)
        .replace("{FEE_SATS}", String(psbtResult.feeSats))
        .replace("{FEE_RATE}", String(feeRate))
        .replace("{INPUT_ROWS}", inputRows)
        .replace("{OUTPUT_ROWS}", outputRows);

      const feeSatsStr = String(psbtResult.feeSats);
      const responseText = `${prepareReceipt}\n\nHandle: ${handle}\npayloadFingerprint: ${payloadFingerprint}\n\nNext step: pass this handle to preview_send.`;

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: {
          handle,
          chain: "bitcoin" as const,
          to: rawTo,
          sats: rawSats,
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
          feeSats: feeSatsStr,
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
            text: `error: prepare_btc_send failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_btc_send failed",
          message,
        ),
      };
    }
  },
);
