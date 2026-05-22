// MCP tool: prepare_litecoin_native_send({ to, litoshi, feeRate?, utxoOverride? })
//
// First step of the Phase 26 LTC trust pipeline (LTC-W-01).
// LTC sibling of `prepare_btc_send.ts` (Phase 23 / Plan 23-03 / BTC-W-01).
//
// Composes Phase 26 Wave-2 signing primitives:
//
//   input-validation (`to` LTC segwit ltc1q + `litoshi` strict-integer parse)
//     → demo-mode FIRST refusal (Phase 26 LTC persona — `getActiveLtcPersona`)
//     → pairing check (`listAccounts({ chainFilter: "litecoin" })` in real mode)
//     → fetchLtcAddresses (pubkeys for PSBT BIP-32 derivation; real mode only)
//     → fetchAddressUtxos (LTC Esplora UTXO fetch)
//     → feeRate resolution: explicit arg OR litecoinspace.org estimate (D-03)
//     → utxoOverride bypass: if supplied, skip Esplora UTXO fetch
//     → _btcCoinSelect.selectCoinsBnb(...) → CoinSelectOk | refused
//       (coin-selection is BTC/LTC agnostic — UTXO weight model identical for P2WPKH)
//     → _btcPsbt.buildBtcPsbt({ network: LTC_NETWORK })
//       CRITICAL: LTC_NETWORK must be passed — omitting defaults to Bitcoin mainnet
//       and silently produces bc1q addresses (RESEARCH Pitfall 2 / T-26-09).
//     → _btcSighash.computeAllSighashes (BIP-143 — identical for LTC and BTC)
//     → _ltcFingerprint.computeLtcPayloadFingerprint(perInputSighashes)
//       Domain tag "VaultPilot-ltctx-v1:" — cross-chain distinct from BTC (T-26-05)
//     → createHandle({ args: prepareArgs, tx: PreparedTxLtc, payloadFingerprint })
//     → PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE substitution
//     → return { handle, chain: "litecoin", to, litoshi, inputs[], outputs[],
//                feeSats, payloadFingerprint, prepareReceipt, txType: "litecoin" }
//
// LTC-only simplifications vs BTC analog:
//   - Only P2WPKH segwit (ltc1q…) — no taproot in Phase 26
//   - No `signalRbf` (BIP-125 RBF is BTC-specific; LTC handles later)
//   - Amount param is `litoshi` (not `sats`) — same decimals=0, same validator
//   - Change derivation folded into fee when no xpub (demo mode / legacy record)
//   - No multisig kind (Phase 26 native-only)
//
// FROZEN surfaces reused from BTC (byte-identical for LTC):
//   - `btc-sighash.ts`: BIP-143 sighash is chain-agnostic for P2WPKH
//   - `btc-coin-select.ts`: UTXO weight model is chain-agnostic for P2WPKH
//   - `btc-psbt.ts` (parameterized): now accepts `network` arg (Plan 26-02)

import { Transaction } from "bitcoinjs-lib";

import {
  fetchAddressUtxos,
  fetchFeeEstimates,
} from "../chains/litecoin/esplora-client.js";
import "../chains/litecoin/types.js"; // initEccLib side-effect
import { assertLtcSegwitAddress, LTC_NETWORK } from "../chains/litecoin/types.js";
import { isDemoMode } from "../config/env.js";
import { getActiveLtcPersona } from "../demo/state.js";
import {
  InvalidAmountError,
  parseTronAmountStrict,
} from "../signing/amount-tron.js";
import {
  INPUT_ROW_BTC_TEMPLATE,
  OUTPUT_ROW_BTC_TEMPLATE,
  PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE,
} from "../signing/blocks-btc.js";
import { _btcCoinSelect } from "../signing/btc-coin-select.js";
import { _ltcFingerprint } from "../signing/ltc-fingerprint.js";
import { _btcSighash } from "../signing/btc-sighash.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  type PrepareArgs,
  type PreparedTxLtc,
  createHandle,
} from "../signing/handle-store.js";
import { _btcPsbt, type BtcPsbtInput } from "../protocols/btc-psbt.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { _ltcLedgerTransport } from "../wallet/ledger-btc-transport.js";
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

/** BIP-141 dust threshold for P2WPKH outputs (~330 litoshis). Same as BTC. */
const DUST_THRESHOLD_SATS = 330n;

/** Zero address for EVM-shape sentinel fields on PreparedTxLtc. */
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

/** Zero masterFingerprint (4 bytes). */
const ZERO_MASTER_FINGERPRINT = new Uint8Array(4);

/** Default stub pubkey — generator point G, compressed.
 *  Used in demo mode; real pubkeys deferred to verify-phase. D-04 provision. */
const DEMO_PUBKEY_HEX =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

/** LTC BIP-84 segwit derivation path (coin_type=2). */
const DEFAULT_SEGWIT_PATH = "84'/2'/0'/0/0";

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Prepare an unsigned LTC PSBT-v0 native send from the paired Ledger Litecoin account.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to send native LTC (litoshis) to a segwit ltc1q… address.",
  "Only P2WPKH segwit (ltc1q…) inputs and outputs are supported in Phase 26.",
  "`litoshi` is the amount in raw litoshis as a decimal string (1 LTC = 100_000_000 litoshis). Never pass decimal LTC.",
  "`to` is the recipient LTC address — bech32 ltc1q… (P2WPKH). Legacy L-prefix addresses are not supported for sending in Phase 26.",
  "`feeRate` is optional sat/vB. Omit to use the litecoinspace.org /v1/fees/recommended estimate.",
  "`utxoOverride` is optional: supply a specific UTXO list to skip Esplora UTXO fetch.",
  "Requires a paired LTC Ledger (call `pair_litecoin_ledger` first if not paired).",
  "Returns `{ handle, chain: \"litecoin\", to, litoshi, inputs[], outputs[], feeSats, payloadFingerprint, prepareReceipt, txType: \"litecoin\" }`.",
  "The agent MUST pass the handle to preview_send next — without preview + the resulting previewToken, send_transaction refuses.",
  "In demo mode, succeeds using the active LTC persona addresses (set via set_demo_wallet); send_transaction returns a simulation envelope.",
  "Failure modes: WALLET_NOT_PAIRED (real mode, no paired LTC account), WRONG_MODE (demo mode but no LTC persona set), INVALID_INPUT (to/litoshi malformed), BTC_FEE_RATE_OUT_OF_BOUNDS (feeRate outside sanity bounds), BTC_NO_UTXOS_AVAILABLE (no UTXOs or insufficient balance), BTC_DUST_OUTPUT (litoshi below dust threshold).",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    to: {
      type: "string",
      description:
        "Recipient LTC ltc1q… bech32 segwit address (P2WPKH). Example: \"ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9\".",
    },
    litoshi: {
      type: "string",
      description:
        "Amount in raw litoshis as a decimal string. Example: \"100000\" for 0.001 LTC. Do NOT pass decimal LTC — off-by-decimal is the most common user-facing bug class.",
    },
    feeRate: {
      type: "number",
      description:
        "Fee rate in sat/vB (optional). Omit to use the litecoinspace.org recommend estimate. Must be ≥ 1 and ≤ 10× the current high-priority estimate.",
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
          scriptType: { type: "string", enum: ["p2wpkh"] },
        },
        required: ["txid", "vout", "valueSats", "scriptType"],
      },
    },
  },
  required: ["to", "litoshi"],
  additionalProperties: false,
};

// ─── Handler ──────────────────────────────────────────────────────────────────

registerTool(
  "prepare_litecoin_native_send",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawTo = typeof args.to === "string" ? args.to : "";
      const rawLitoshi = typeof args.litoshi === "string" ? args.litoshi : "";
      const rawFeeRate =
        typeof args.feeRate === "number" ? args.feeRate : undefined;
      const rawUtxoOverride = Array.isArray(args.utxoOverride)
        ? (args.utxoOverride as Array<{
            txid: string;
            vout: number;
            valueSats: string;
            scriptType: "p2wpkh";
          }>)
        : undefined;

      // -----------------------------------------------------------------------
      // Step 1: Input validation — FIRES FIRST (before any state read).
      // LTC: only ltc1q segwit addresses supported in Phase 26.
      // Two-gate check: regex fast-path via assertLtcSegwitAddress which internally
      // calls bitcoinjs-lib.address.toOutputScript(addr, LTC_NETWORK).
      // -----------------------------------------------------------------------

      if (!rawTo.startsWith("ltc1q")) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'to' address: expected a valid LTC bech32 segwit (ltc1q…) address, got "${rawTo}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'to' address: "${rawTo}" is not a ltc1q… address`,
          ),
        };
      }

      // Two-gate checksum validation (regex + bitcoinjs-lib bech32 checksum with LTC_NETWORK).
      try {
        assertLtcSegwitAddress(rawTo);
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

      // Validate + parse `litoshi` via parseTronAmountStrict(litoshi, 0, "u64").
      // decimals=0: litoshi is the raw integer unit (1 LTC = 100_000_000 litoshis).
      let litoshi: bigint;
      try {
        litoshi = parseTronAmountStrict(rawLitoshi, 0, "u64");
      } catch (err) {
        if (err instanceof InvalidAmountError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid 'litoshi': ${err.message}`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'litoshi': ${err.message}`,
              err.kind,
            ),
          };
        }
        throw err;
      }

      // -----------------------------------------------------------------------
      // Step 2: Demo-mode FIRST refusal — read LTC persona registry.
      // Real-mode pairing check happens AFTER the demo branch so `listAccounts`
      // is NEVER called in demo mode (T-26-07 mitigation — mirrors T-23-11).
      // -----------------------------------------------------------------------
      const demoActive = isDemoMode();
      const ltcPersona = getActiveLtcPersona();

      let segwitAddress: string;
      let segwitPath: string;
      let segwitPubkeyHex: string;

      if (demoActive) {
        if (!ltcPersona) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: demo mode is on but no LTC persona is set. " +
                  "Call set_demo_wallet with an LTC persona slug (e.g. \"ltc-whale\") before preparing demo-mode LTC sends.",
              },
            ],
            structuredContent: errEnvelope(
              "WRONG_MODE",
              "demo mode is on but no LTC persona is set; call set_demo_wallet first",
            ),
          };
        }
        segwitAddress = ltcPersona.ltcSegwitAddress;
        segwitPath = DEFAULT_SEGWIT_PATH;
        // Demo mode: use a known-good stub pubkey. D-04 provision.
        segwitPubkeyHex = DEMO_PUBKEY_HEX;
      } else {
        // Real mode — consult the persistent non-EVM account store.
        const accounts = listAccounts({ chainFilter: "litecoin" });
        if (accounts.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: no paired LTC account. Pair your Ledger Litecoin app via `pair_litecoin_ledger` before preparing LTC transfers.",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired LTC account; call pair_litecoin_ledger first",
            ),
          };
        }

        // Find the segwit account.
        const segwitAccount = accounts.find((a) =>
          a.address.startsWith("ltc1q"),
        );

        // WR-05: refuse at prepare time rather than silently falling through to
        // a default derivation path that causes a confusing Ledger rejection.
        if (!segwitAccount) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "error: no segwit LTC account found — re-run pair_litecoin_ledger",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no segwit LTC account found — re-run pair_litecoin_ledger",
            ),
          };
        }

        // Fetch pubkeys for PSBT BIP-32 derivation via Ledger LTC transport.
        let fetchedKeys: {
          segwit: { address: string; publicKey: string; derivationPath: string };
          appVersion: string;
        };
        try {
          const result = await _ltcLedgerTransport.fetchLtcAddresses(
            segwitAccount.derivationPath,
          );
          fetchedKeys = {
            segwit: result.segwit,
            appVersion: result.appVersion,
          };
        } catch (err) {
          const cause = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: failed to fetch LTC pubkeys from Ledger: ${cause}`,
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "failed to fetch LTC pubkeys from Ledger; ensure device is connected with Litecoin app open",
              cause,
            ),
          };
        }

        segwitAddress = fetchedKeys.segwit.address;
        segwitPath = fetchedKeys.segwit.derivationPath;
        segwitPubkeyHex = fetchedKeys.segwit.publicKey;
      }

      // -----------------------------------------------------------------------
      // Step 3: Resolve feeRate (D-03) — explicit arg OR litecoinspace.org estimate.
      // -----------------------------------------------------------------------
      let feeRate: number;
      let highPriorityEstimate: number;

      {
        const feeResult = await fetchFeeEstimates();
        if (feeResult.kind !== "ok") {
          const message =
            feeResult.kind === "error" || feeResult.kind === "rate-limited"
              ? feeResult.message
              : `LTC Esplora fee-estimates returned kind:${feeResult.kind}`;
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
      // -----------------------------------------------------------------------
      type UtxoForSelection = {
        txid: string;
        vout: number;
        valueSats: bigint;
        scriptType: "p2wpkh";
      };

      let allUtxos: UtxoForSelection[];

      if (rawUtxoOverride !== undefined) {
        // utxoOverride supplied — use exactly these UTXOs.
        allUtxos = rawUtxoOverride.map((u) => ({
          txid: u.txid,
          vout: u.vout,
          valueSats: BigInt(u.valueSats),
          scriptType: "p2wpkh" as const,
        }));
      } else {
        // Fetch from LTC Esplora (litecoinspace.org).
        const utxoResult = await fetchAddressUtxos(segwitAddress);

        // WR-01 mirror: only confirmed UTXOs eligible for coin selection.
        const segwitUtxos: UtxoForSelection[] =
          utxoResult.kind === "ok"
            ? utxoResult.utxos
                .filter((u) => u.confirmed)
                .map((u) => ({
                  txid: u.txid,
                  vout: u.vout,
                  valueSats: u.valueSats,
                  scriptType: "p2wpkh" as const,
                }))
            : [];

        allUtxos = segwitUtxos;

        if (allUtxos.length === 0) {
          const totalFetched =
            utxoResult.kind === "ok" ? utxoResult.utxos.length : 0;
          const reason =
            totalFetched > 0
              ? `no confirmed LTC UTXOs available (${totalFetched} unconfirmed UTXO(s) exist — wait for on-chain confirmation before spending)`
              : "no UTXOs found for the paired LTC address";
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${reason}` }],
            structuredContent: errEnvelope("BTC_NO_UTXOS_AVAILABLE", reason),
          };
        }
      }

      // -----------------------------------------------------------------------
      // Step 5: Coin selection via BnB. LTC P2WPKH — identical weight model.
      // -----------------------------------------------------------------------
      const coinSelectResult = _btcCoinSelect.selectCoinsBnb({
        utxos: allUtxos,
        targetSats: litoshi,
        feeRate,
        highPriorityEstimate,
        changeScriptType: "p2wpkh", // LTC only has segwit in Phase 26
        recipientScriptType: "p2wpkh",
        dustThresholdSats: DUST_THRESHOLD_SATS,
      });

      if (coinSelectResult.kind === "refused") {
        const reason = coinSelectResult.reason;
        if (reason.includes("below the minimum") || reason.includes("exceeds 10×")) {
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${reason}` }],
            structuredContent: errEnvelope("BTC_FEE_RATE_OUT_OF_BOUNDS", reason),
          };
        }
        if (reason.includes("no UTXOs") || reason.includes("insufficient funds")) {
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
        return {
          isError: true,
          content: [{ type: "text", text: `error: coin selection failed: ${reason}` }],
          structuredContent: errEnvelope("BTC_NO_UTXOS_AVAILABLE", `coin selection failed: ${reason}`),
        };
      }

      const { selectedInputs, changeSats } = coinSelectResult;

      // -----------------------------------------------------------------------
      // Step 6: Change address.
      // LTC Phase 26: no xpub support yet — fold change into fee (changeSats=0)
      // when no change derivation is available. The persona/real-mode change
      // address support is deferred to a future phase (same pattern as BTC demo mode).
      //
      // WR-04: refuse when changeSats > 10_000 litoshi to prevent silent large
      // forfeitures (e.g. a 1 LTC UTXO sending 0.001 LTC silently forfeiting ~0.999 LTC).
      // Below the threshold, the change is folded into the miner fee and disclosed
      // in the PREPARE RECEIPT block.
      // -----------------------------------------------------------------------
      const CHANGE_FORFEIT_REFUSE_THRESHOLD = 10_000n; // litoshi (WR-04)
      if (changeSats > CHANGE_FORFEIT_REFUSE_THRESHOLD) {
        const message =
          `LTC change would be forfeited: ${changeSats} litoshi exceeds the ` +
          `${CHANGE_FORFEIT_REFUSE_THRESHOLD}-litoshi threshold. ` +
          `xpub change-address support is not yet available. ` +
          `Size the send to the UTXO amount (${selectedInputs.reduce((s, u) => s + u.valueSats, 0n)} litoshi) ` +
          `minus the estimated fee, or send the full UTXO balance.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", message),
        };
      }

      // In demo mode and real mode without xpub: no change output.
      const changeAddress: string | null = null;
      const changePath: string | null = null;
      const hasChangeOutput = changeSats > 0n && changeAddress !== null;

      // -----------------------------------------------------------------------
      // Step 7: Build PSBT via _btcPsbt.buildBtcPsbt({ network: LTC_NETWORK }).
      // CRITICAL: LTC_NETWORK MUST be passed — missing it silently produces
      // bc1q addresses (RESEARCH Pitfall 2 / T-26-09 mitigation).
      // -----------------------------------------------------------------------
      const segwitPubkey = Buffer.from(segwitPubkeyHex, "hex");

      const psbtInputs: BtcPsbtInput[] = selectedInputs.map((utxo) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        valueSats: utxo.valueSats,
        scriptType: "p2wpkh" as const,
        pubkey: segwitPubkey,
        bip32Path: `m/${segwitPath}`,
        masterFingerprint: ZERO_MASTER_FINGERPRINT,
      }));

      let psbtResult;
      try {
        psbtResult = _btcPsbt.buildBtcPsbt({
          inputs: psbtInputs,
          recipientOutput: {
            address: rawTo,
            valueSats: litoshi,
            scriptType: "p2wpkh",
            role: "recipient",
          },
          changeOutput: null, // Phase 26: fold change into fee
          dustThresholdSats: DUST_THRESHOLD_SATS,
          network: LTC_NETWORK, // CRITICAL: T-26-09 / Pitfall 2 mitigation
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        const errorCode: ErrorCode =
          err instanceof Error && err.name === "BtcDustError"
            ? "BTC_DUST_OUTPUT"
            : "INTERNAL_ERROR";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build LTC PSBT: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(errorCode, "failed to build LTC PSBT", cause),
        };
      }

      // -----------------------------------------------------------------------
      // Step 8: Compute per-input sighashes from the stored canonical artifact.
      // BIP-143 is byte-identical for LTC and BTC — reuse btc-sighash (FROZEN).
      // Extract the unsigned Transaction from psbtResult.unsignedTxHex (Pitfall 5).
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
      // Domain tag "VaultPilot-ltctx-v1:" — cross-chain distinct from BTC (T-26-05).
      // Fixture Y anchor: single-input P2WPKH LTC send → 0x105386…
      // (pinned in test/signing-fingerprint.test.ts).
      // -----------------------------------------------------------------------
      const payloadFingerprint = _ltcFingerprint.computeLtcPayloadFingerprint(
        perInputSighashes,
      );

      // -----------------------------------------------------------------------
      // Step 10: Build PreparedTxLtc + PrepareArgs shapes.
      // -----------------------------------------------------------------------
      const tx: PreparedTxLtc = {
        txType: "litecoin",
        // EVM-shape sentinel fields.
        chainId: 0,
        to: ZERO_EVM_ADDRESS,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        // LTC-specific cryptographic-binding fields.
        kind: "native",
        psbtBase64: psbtResult.psbtBase64,
        unsignedTxHex: psbtResult.unsignedTxHex,
        perInputPrevouts: psbtResult.perInputPrevouts as readonly {
          script: Uint8Array;
          valueSats: bigint;
          scriptType: "p2wpkh";
        }[],
        inputScriptTypes: selectedInputs.map(() => "p2wpkh" as const),
        inputs: psbtResult.inputs as readonly {
          txid: string;
          vout: number;
          valueSats: bigint;
          scriptType: "p2wpkh";
        }[],
        outputs: psbtResult.outputs,
        feeSats: psbtResult.feeSats,
        changeSats: psbtResult.changeSats,
        feeRate,
        changePath: hasChangeOutput ? changePath : null,
        changeAddress: hasChangeOutput ? changeAddress : null,
      };

      const prepareArgs: PrepareArgs = {
        to: rawTo,
        valueWei: "0",
        litoshi: rawLitoshi,
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 11: Build PREPARE RECEIPT.
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

      let prepareReceipt = PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE
        .replace("{TO}", rawTo)
        .replace("{LITOSHIS}", rawLitoshi)
        .replace("{FEE_SATS}", String(psbtResult.feeSats))
        .replace("{FEE_RATE}", String(feeRate))
        .replace("{INPUT_ROWS}", inputRows)
        .replace("{OUTPUT_ROWS}", outputRows);

      // WR-04: disclose forfeited change in the PREPARE RECEIPT block.
      if (psbtResult.changeSats > 0n) {
        prepareReceipt +=
          `\nCHANGE FORFEITED: ${psbtResult.changeSats} litoshi (xpub change-address support deferred)`;
      }

      const feeSatsStr = String(psbtResult.feeSats);
      const responseText = `${prepareReceipt}\n\nHandle: ${handle}\npayloadFingerprint: ${payloadFingerprint}\n\nNext step: pass this handle to preview_send.`;

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: {
          handle,
          chain: "litecoin" as const,
          to: rawTo,
          litoshi: rawLitoshi,
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
          txType: "litecoin" as const,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_litecoin_native_send failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_litecoin_native_send failed",
          message,
        ),
      };
    }
  },
);
