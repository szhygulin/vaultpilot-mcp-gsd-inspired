// MCP tool: send_transaction({ handle, previewToken, userDecision })
//
// Third and final step of the Phase 4 trust pipeline (PREP-07 / PREP-08 /
// PREP-09). The handler enforces three gates in order:
//
//   1. SCHEMA gate (PREP-07 / T-GATE-1) — `userDecision` is constrained to
//      `["send", "cancel"]` via the inputSchema enum. The MCP boundary
//      (src/server.ts, Plan 04-04 addition) compiles + runs the schema via
//      ajv BEFORE this handler is invoked. Anything other than the two
//      legal values rejects at the protocol boundary with InvalidParams
//      (-32602); the handler is never entered.
//
//   2. STATE-MACHINE gate (T-STATE-4 / T-PREVIEW-CONSUMED-1) — the handle
//      must be in `previewed` status. `prepared` → PREVIEW_REQUIRED,
//      `sent` / `cancelled` → WRONG_STATUS. The `previewToken` value must
//      match `record.pinned.previewToken` (T-GATE-2 — single-use per pin).
//
//   3. PAYLOAD-FINGERPRINT DRIFT gate (PREP-08 / T-DRIFT-1) — load-bearing
//      defense against in-process state corruption between prepare and
//      send. Recompute the fingerprint over `record.tx`; if the recomputed
//      value differs from `record.payloadFingerprint` (stored at prepare
//      time), refuse with PAYLOAD_FINGERPRINT_DRIFT. The STORED value is
//      the trust anchor — Test 4 mutates the stored value directly to
//      prove the re-check fires when stored state is corrupted, NOT by
//      substituting `computePayloadFingerprint` (which would prove the
//      wrong thing).
//
// After all three gates pass, the handler resolves the SignClient + the
// active session topic, constructs `eth_sendTransaction` params ENTIRELY
// from `record.tx` + `record.pinned` (NEVER from agent-supplied args at
// send time — re-fetching would change the bytes the user verified against
// the LEDGER BLIND-SIGN HASH at preview), and forwards via
// `signClient.request<Hex>({ topic, chainId: "eip155:1", request: {...} })`.
// Ledger Live signs AND broadcasts internally, returning the broadcasted
// txHash (research § A3 — we do NOT call `viem.sendRawTransaction`).
//
// Cancel path (T-CANCEL-1 / Q1 locked): `userDecision: "cancel"` →
// `transitionToCancelled` → return `{ userCancelled: true }` non-error.
// No broadcast. The handle is NOT immediately evicted; lazy TTL reclaims
// it at the 15-min mark.
//
// Demo mode (DEMO-05 — Plan 05-02 wired): `userDecision: "send"` in demo
// mode passes the active persona's address as `account` to viem.call so
// the simulation has a meaningful msg.sender. NOTHING is signed; NOTHING
// is broadcast. The simulation envelope shape is locked HERE (Phase 4
// 04-04); Plan 05-02 only added the `account` field to the viem.call and
// the persona-null defense (refuses with WRONG_MODE if isDemoMode is true
// but getActivePersona() is null — the explicit-demo-without-set_demo_wallet
// path). Q-CONTRADICTION-PREP Option B: under this plan, `prepare_native_send`
// + `preview_send` ALSO succeed in demo (against persona address); the demo
// pipeline is rehearsable end-to-end through the actual tool surface.

import { type Hex, toHex } from "viem";
import { call } from "viem/actions";
import { u8aToHex } from "@polkadot/util";
import { Message, PublicKey, Transaction } from "@solana/web3.js";
import { Transaction as BtcTransaction, address as btcAddressLib, networks as btcNetworks } from "bitcoinjs-lib";

import { getEthereumClient } from "../chains/ethereum.js";
import "../chains/bitcoin/types.js"; // ensure initEccLib(tinySecp256k1) fires
import { broadcastTx as esploraBroadcastTx } from "../chains/bitcoin/esplora-client.js";
import "../chains/litecoin/types.js"; // ensure initEccLib fires for LTC address derivation
import { LTC_NETWORK } from "../chains/litecoin/types.js";
import { broadcastTx as ltcEsploraBroadcastTx } from "../chains/litecoin/esplora-client.js";
import { _solanaRegistry } from "../chains/solana/registry.js";
import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona, getActiveBtcPersona, getActiveLtcPersona, getActiveSolanaPersona, getActiveTronPersona } from "../demo/state.js";
// Phase 47 — Plan 47-04 additive import (kept on its own line so the existing
// demo-state import above stays byte-identical — the send_transaction FROZEN
// zero-deletion invariant, test/signing-fingerprint-bittensor.test.ts).
import { getActiveBittensorPersona } from "../demo/state.js";
import { computeBtcPayloadFingerprint } from "../signing/btc-fingerprint.js";
import { _btcLifiFingerprint } from "../signing/btc-lifi-fingerprint.js";
import { computeLtcPayloadFingerprint } from "../signing/ltc-fingerprint.js";
import { _btcSighash } from "../signing/btc-sighash.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  lookup,
  transitionToCancelled,
  transitionToSent,
  type HandleRecord,
  type PreparedTxBtc,
  type PreparedTxBtcLifi,
  type PreparedTxLtc,
  type PreparedTxSolana,
  type PreparedTxTron,
  type PreparedTxBittensor,
} from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { computeSolanaPayloadFingerprint } from "../signing/payload-fingerprint-solana.js";
import { computeTronPayloadFingerprint } from "../signing/payload-fingerprint-tron.js";
import { computeBittensorPayloadFingerprint } from "../signing/payload-fingerprint-bittensor.js";
import { _simulationSolana } from "../signing/simulation-solana.js";
import { _simulationTron } from "../signing/simulation-tron.js";
import {
  LedgerDeviceNotConnectedError,
  LedgerSolanaAppNotOpenError,
  LedgerSolanaUserRejectedError,
  signSolanaTransaction,
} from "../wallet/ledger-solana-transport.js";
import {
  LedgerDeviceNotConnectedError as LedgerTronDeviceNotConnectedError,
  LedgerTronAppNotOpenError,
  _tronLedgerTransport,
} from "../wallet/ledger-tron-transport.js";
import {
  LedgerDeviceNotConnectedError as LedgerBtcDeviceNotConnectedError,
  LedgerBtcAppNotOpenError,
  LedgerBtcAppVersionTooOldError,
  LedgerLtcAppNotOpenError,
  _btcLedgerTransport,
  _ltcLedgerTransport,
  type BtcPsbtSignInput,
  type KnownAddressDerivation,
} from "../wallet/ledger-btc-transport.js";
import {
  LedgerBittensorAppNotOpenError,
  LedgerBittensorUserRejectedError,
  signBittensorTransaction,
} from "../wallet/ledger-bittensor-transport.js";
import { _bittensorRegistry } from "../chains/bittensor/registry.js";
import {
  loadMultisigWallet,
  parseWshSortedMulti,
} from "../wallet/btc-multisig-store.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import {
  getActiveSessionTopic,
  getStatus,
} from "../wallet/session-manager.js";
import { getWalletConnectClient } from "../wallet/walletconnect-client.js";
import { isUserRejectedError } from "../wallet/wc-errors.js";
import {
  type ToolHandler,
  type ToolHandlerResult,
  type ToolInputSchema,
  registerTool,
} from "./index.js";

// The shared `ToolHandlerResult.structuredContent` is typed as
// `Record<string, unknown>`; Plan 04-01's `StructuredError` is an explicit
// interface without an index signature. Wrap at the boundary so
// `makeStructuredError(...)` stays the canonical envelope constructor —
// same shape as Plans 04-02 + 04-03 use.
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}

/**
 * Build the SIMULATION text block emitted by demo-mode `userDecision: "send"`.
 * Verbatim shape locked here so Phase 5's persona-aware evolution doesn't
 * reshape the block.
 */
function buildSimulationText(
  toAddr: string,
  valueWei: bigint,
  simulationResult: Hex | null,
  simulationError: string | null,
): string {
  const lines = [
    "SIMULATION (demo mode)",
    `  to: ${toAddr}`,
    `  value: ${valueWei.toString()} wei`,
    simulationError !== null
      ? `  result: REVERT — ${simulationError}`
      : `  result: ${simulationResult ?? "0x"} (no broadcast performed)`,
  ];
  return lines.join("\n");
}

const DESCRIPTION = [
  "Forward a previewed transaction to Ledger Live via WalletConnect for on-device signing and broadcast. Returns `{ txHash, broadcastedAt }` on success.",
  "Use ONLY after preview_send has minted a previewToken AND the user has read the LEDGER BLIND-SIGN HASH block + the agent's CHECKS PERFORMED block AND confirmed they want to send.",
  "Three required fields — `handle`, `previewToken`, `userDecision`. `userDecision` MUST be exactly \"send\" to broadcast or \"cancel\" for a clean exit. ANY other value (including \"yes\", \"approve\", \"confirm\") is rejected at the MCP boundary — this is a schema-level gate, NOT a soft check.",
  "`userDecision: \"cancel\"` returns `userCancelled: true` and transitions the handle to terminal cancelled. No broadcast occurs.",
  "Ledger Live signs AND broadcasts internally — this MCP does NOT call sendRawTransaction. Successful response is the broadcasted txHash, NOT signed bytes.",
  "The handler re-checks payloadFingerprint against the prepare-time value. Drift (in-process state corruption between prepare and send) refuses with PAYLOAD_FINGERPRINT_DRIFT.",
  "Failure modes: PREVIEW_REQUIRED / PREVIEW_TOKEN_MISMATCH / WRONG_STATUS / WALLET_NOT_PAIRED / PAYLOAD_FINGERPRINT_DRIFT / LEDGER_REJECTED / BROADCAST_FAILED. In demo mode, returns a simulation envelope (DEMO-05) instead of broadcasting.",
].join(" ");

const INPUT_SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    handle: {
      type: "string",
      description: "Handle returned by prepare_native_send (or any other prepare_* tool).",
    },
    previewToken: {
      type: "string",
      description: "previewToken returned by preview_send; single-use per pin.",
    },
    userDecision: {
      type: "string",
      enum: ["send", "cancel"],
      description:
        "Must be exactly \"send\" to broadcast, or \"cancel\" for a clean exit (handle transitions to terminal cancelled state).",
    },
  },
  required: ["handle", "previewToken", "userDecision"],
  additionalProperties: false,
};

/**
 * Re-export for `test/send-transaction.test.ts` Test 1b (standalone ajv
 * re-validation — regression anchor on schema-as-written). Production
 * code should NOT import this — it imports through the registry instead.
 */
export const INPUT_SCHEMA_FOR_TESTING = INPUT_SCHEMA;

/**
 * Narrowed input shape. Once the schema gate has run, every field is
 * present and typed. Re-exported so Test 1c (TypeScript narrowing
 * assertion — compile-time defense) can pin the literal-union shape of
 * `userDecision`; widening the schema to `type: "string"` without `enum`
 * would force `userDecision: string` here and break the type assertion.
 */
export interface SendTransactionArgs {
  handle: string;
  previewToken: string;
  userDecision: "send" | "cancel";
}

export const sendTransactionHandler: ToolHandler = async (args): Promise<ToolHandlerResult> => {
  try {
    // Type-narrowing is defense in depth — the schema gate at src/server.ts
    // already rejected anything that doesn't match the shape above. We
    // re-read defensively so the handler doesn't crash if invoked directly
    // (test-only path; production goes through the SDK gate).
    const handleArg = typeof args.handle === "string" ? args.handle : "";
    const previewTokenArg = typeof args.previewToken === "string" ? args.previewToken : "";
    const userDecision = args.userDecision === "cancel" ? "cancel" : "send";

    // Lookup the handle. HANDLE_NOT_FOUND / HANDLE_EXPIRED (15-min TTL).
    const lookupResult = lookup(handleArg);
    if (!lookupResult.ok) {
      const text =
        lookupResult.errorCode === "HANDLE_NOT_FOUND"
          ? "error: handle not found; call prepare_native_send + preview_send first"
          : "error: handle expired (>15min from prepare); call prepare_native_send to mint a fresh handle";
      return {
        isError: true,
        content: [{ type: "text", text }],
        structuredContent: errEnvelope(lookupResult.errorCode, text.replace(/^error: /, "")),
      };
    }
    const record = lookupResult.record;

    // Phase 37 Plan 37-03 (SAFE-08) — handle-shape gate. Refuses
    // PreparedTxSafeTypedData handles with WRONG_HANDLE_KIND BEFORE the
    // state-machine gate (PREVIEW_REQUIRED / WRONG_STATUS) — type-level
    // mis-routing is impossible-by-construction (the discriminant gate at the
    // top of preview_send.ts also fires), but the runtime defense-in-depth
    // arm catches direct send_transaction invocation on a typed-data handle.
    // Off-chain typed-data signatures do NOT broadcast — the agent must call
    // submit_safe_tx_signature to publish the signature to the Safe Tx Service.
    //
    // Additive-arms-only invariant (CONTEXT §FROZEN-area lines 132-141): this
    // is the ONLY Phase-37 modification of this file. The existing EVM /
    // Solana / TRON / BTC / LTC / BTC-LiFi dispatch arms below stay BYTE-
    // IDENTICAL. The git-diff acceptance gate in Plan 37-03 Task 3 enforces
    // additive-only — `git diff origin/main -- src/tools/send_transaction.ts`
    // contains no deletion markers (^-(?!--)).
    if (record.tx.txType === "safe-typed-data") {
      const refusalMsg =
        "send_transaction does not handle Safe typed-data handles. " +
        "Use submit_safe_tx_signature to publish your signature to the " +
        "Safe Tx Service. send_transaction is for on-chain EVM broadcasts only.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${refusalMsg}` }],
        structuredContent: errEnvelope("WRONG_HANDLE_KIND", refusalMsg),
      };
    }

    // STATE-MACHINE gate (T-STATE-4 / T-PREVIEW-CONSUMED-1). Terminal
    // states refuse with WRONG_STATUS; `prepared` refuses with
    // PREVIEW_REQUIRED to give a more actionable error than
    // "wrong status".
    if (record.status === "prepared") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: handle has not been previewed; call preview_send before send_transaction",
          },
        ],
        structuredContent: errEnvelope(
          "PREVIEW_REQUIRED",
          "call preview_send before send_transaction",
        ),
      };
    }
    if (record.status === "sent" || record.status === "cancelled") {
      const text = `error: handle is in terminal state: ${record.status}`;
      return {
        isError: true,
        content: [{ type: "text", text }],
        structuredContent: errEnvelope("WRONG_STATUS", text.replace(/^error: /, "")),
      };
    }
    // record.status === "previewed" — narrow `record.pinned` from optional.
    if (!record.pinned) {
      return {
        isError: true,
        content: [
          { type: "text", text: "error: previewed handle missing pinned state" },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "previewed handle missing pinned state",
        ),
      };
    }
    const pinned = record.pinned;

    // T-CANCEL-1 / Q1 locked. The cancel branch fires BEFORE previewToken
    // matching or fingerprint re-check — cancel is a flow exit (no
    // verification needed) and the agent may legitimately invoke it with
    // any token value.
    if (userDecision === "cancel") {
      const trans = transitionToCancelled(handleArg);
      if (!trans.ok) {
        return {
          isError: true,
          content: [
            { type: "text", text: `error: state transition failed: ${trans.errorCode}` },
          ],
          structuredContent: errEnvelope(trans.errorCode, `cancel failed: ${trans.errorCode}`),
        };
      }
      const cancelledAt = new Date().toISOString();
      return {
        content: [
          {
            type: "text",
            text: `cancelled (handle ${handleArg.slice(0, 8)}…); no broadcast occurred`,
          },
        ],
        structuredContent: {
          userCancelled: true,
          handle: handleArg,
          chainId: record.tx.chainId,
          cancelledAt,
        },
      };
    }

    // T-GATE-2: previewToken match. Wrong token → PREVIEW_TOKEN_MISMATCH;
    // signClient.request NEVER called (asserted by Test 2).
    if (previewTokenArg !== pinned.previewToken) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: previewToken does not match the one minted by preview_send. Did preview_send run again? Re-call preview_send to get the current token.",
          },
        ],
        structuredContent: errEnvelope(
          "PREVIEW_TOKEN_MISMATCH",
          "previewToken mismatch — preview_send may have re-pinned",
        ),
      };
    }

    // PREP-08 / T-DRIFT-1: recompute payloadFingerprint over the STORED
    // tx; compare with the STORED fingerprint. The stored value is the
    // trust anchor (computed once at prepare time). Any drift indicates
    // in-process state corruption between prepare and send — the
    // recompute fires the refusal. Test 4 mutates the STORED value
    // directly to prove this gate works against the actual attack model.
    //
    // Phase 12 — Plan 12-05 widening: discriminator dispatch on
    // `record.tx.txType ?? "evm"`. Solana handles recompute over the
    // serialized messageBytes via Plan 12-01's
    // `computeSolanaPayloadFingerprint`; EVM handles keep the byte-frozen
    // `computePayloadFingerprint(...)` call. The gate's outer structure +
    // refusal envelope + error message + errorCode stay BYTE-IDENTICAL for
    // BOTH branches — only the inner compute differs (RESEARCH Topic 9 lock).
    const txType = record.tx.txType ?? "evm";
    const recomputed =
      txType === "solana"
        ? computeSolanaPayloadFingerprint({
            messageBytes: (record.tx as PreparedTxSolana).messageBytes,
          })
        : txType === "tron"
          ? computeTronPayloadFingerprint({
              rawDataBytes: new Uint8Array(Buffer.from((record.tx as PreparedTxTron).rawDataHex, "hex")),
            })
          : txType === "btc"
            ? computeBtcPayloadFingerprint(
                _btcSighash.computeAllSighashes(
                  BtcTransaction.fromHex((record.tx as PreparedTxBtc).unsignedTxHex),
                  (record.tx as PreparedTxBtc).perInputPrevouts.map((p) => ({
                    scriptType: p.scriptType,
                    prevOutScript: p.script,
                    valueSats: p.valueSats,
                  })),
                ),
              )
            : txType === "litecoin"
              ? computeLtcPayloadFingerprint(
                  _btcSighash.computeAllSighashes(
                    BtcTransaction.fromHex((record.tx as PreparedTxLtc).unsignedTxHex),
                    (record.tx as PreparedTxLtc).perInputPrevouts.map((p) => ({
                      scriptType: p.scriptType,
                      prevOutScript: p.script,
                      valueSats: p.valueSats,
                    })),
                  ),
                )
              : txType === "btc-lifi"
                ? _btcLifiFingerprint.computeBtcLifiPayloadFingerprint(
                    Buffer.from((record.tx as PreparedTxBtcLifi).psbtHex, "hex"),
                  )
              : txType === "bittensor"
                ? computeBittensorPayloadFingerprint({
                    signableBytes: (record.tx as PreparedTxBittensor).signableBlob,
                  })
              : computePayloadFingerprint({
                chainId: record.tx.chainId,
                to: record.tx.to,
                valueWei: record.tx.valueWei,
                data: record.tx.data,
              });
    if (recomputed !== record.payloadFingerprint) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: payloadFingerprint drift detected between prepare and send; abort and re-run prepare_native_send",
          },
        ],
        structuredContent: errEnvelope(
          "PAYLOAD_FINGERPRINT_DRIFT",
          "payloadFingerprint drift — handle state corrupted; re-run prepare_native_send",
        ),
      };
    }

    // Phase 12 — Plan 12-05 — Solana branch dispatch. The three FROZEN
    // gates above (PREVIEW_REQUIRED, WRONG_STATUS, PREVIEW_TOKEN_MISMATCH,
    // PAYLOAD_FINGERPRINT_DRIFT) and the cancel branch fired identically
    // for both branches — only the transport call differs. EVM branch
    // (FROZEN — DEMO-05 + WC routing below) is byte-identical to v1.0-1.3.
    if (txType === "solana") {
      return await sendTransactionSolanaBranch(record, handleArg);
    }
    if (txType === "tron") {
      return await sendTransactionTronBranch(
        record as HandleRecord & { tx: PreparedTxTron },
        handleArg,
      );
    }
    if (txType === "btc") {
      return await sendTransactionBtcBranch(
        record as HandleRecord & { tx: PreparedTxBtc },
        handleArg,
      );
    }
    if (txType === "litecoin") {
      return await sendTransactionLtcBranch(
        record as HandleRecord & { tx: PreparedTxLtc },
        handleArg,
      );
    }
    if (txType === "btc-lifi") {
      return await sendTransactionBtcLifiBranch(
        record as HandleRecord & { tx: PreparedTxBtcLifi },
        handleArg,
      );
    }
    if (txType === "bittensor") {
      return await sendTransactionBittensorBranch(
        record as HandleRecord & { tx: PreparedTxBittensor },
        handleArg,
      );
    }
    // ===== EVM branch (FROZEN — DEMO-05 + WC routing unchanged) =====

    // DEMO-05 (Plan 05-02 wired): demo-mode `userDecision: "send"` runs the
    // unsigned tx through eth_call for revert detection. NOTHING signed;
    // NOTHING broadcast. The simulation envelope shape is locked here
    // (Phase 4 — T-DEMO-1 mitigation; `signClient.request` spy observes
    // ZERO calls in this branch). Plan 05-02 added `account: persona.address`
    // so the simulation has a meaningful msg.sender (defense against reverts
    // that depend on caller — common for token approval / staking flows).
    if (isDemoMode()) {
      // T-NULL-PERSONA-1: explicit `VAULTPILOT_DEMO=true` without prior
      // `set_demo_wallet` → `getActivePersona()` is null. viem accepts
      // `account: undefined` (msg.sender defaults to 0x0) but the
      // simulation result becomes meaningless for caller-dependent reverts.
      // Refuse explicitly so the agent sees a clear signal to call
      // `set_demo_wallet` first.
      const persona = getActivePersona();
      if (persona === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: demo mode is active but no persona set. Call `set_demo_wallet({ persona: \"whale\" | \"defi-degen\" | \"stable-saver\" | \"staking-maxi\" })` first.",
            },
          ],
          structuredContent: errEnvelope(
            "WRONG_MODE",
            "demo mode active but no persona set; call set_demo_wallet first",
          ),
        };
      }
      const client = getEthereumClient();
      let simulationResult: Hex | null = null;
      let simulationError: string | null = null;
      try {
        const callResult = await call(client, {
          account: persona.address,
          to: record.tx.to,
          value: record.tx.valueWei,
          data: record.tx.data,
        });
        simulationResult = callResult.data ?? ("0x" as Hex);
      } catch (err) {
        simulationError = err instanceof Error ? err.message : String(err);
      }
      const simulatedAt = new Date().toISOString();
      return {
        content: [
          {
            type: "text",
            text: buildSimulationText(
              record.tx.to,
              record.tx.valueWei,
              simulationResult,
              simulationError,
            ),
          },
        ],
        structuredContent: {
          simulated: true,
          simulationResult,
          simulationError,
          simulatedAt,
          handle: handleArg,
          chainId: record.tx.chainId,
          nonce: pinned.nonce,
          gas: pinned.gas.toString(),
          maxFeePerGas: pinned.maxFeePerGas.toString(),
          maxPriorityFeePerGas: pinned.maxPriorityFeePerGas.toString(),
        },
      };
    }

    // T-PAIR-1: confirm pairing. `getStatus()` returns null if no live
    // session; `getActiveSessionTopic()` returns null if the WC client
    // hasn't been initialized OR no session in the store. Both → refuse
    // with WALLET_NOT_PAIRED.
    const status = await getStatus();
    if (status === null) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: no live Ledger session. Call `pair_ledger_live` to re-pair via WalletConnect, then retry.",
          },
        ],
        structuredContent: errEnvelope(
          "WALLET_NOT_PAIRED",
          "no live Ledger session at send time",
        ),
      };
    }
    const topic = getActiveSessionTopic();
    if (!topic) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: WalletConnect session topic gone; call `pair_ledger_live` to re-pair.",
          },
        ],
        structuredContent: errEnvelope(
          "WALLET_NOT_PAIRED",
          "WC session topic missing — session may have dropped between preview and send",
        ),
      };
    }

    // T-WC-FWD-1: txParams built ENTIRELY from `record.tx` + `record.pinned`
    // (server state). Agent args (`handle`, `previewToken`, `userDecision`)
    // were consumed above; they NEVER influence the tx envelope. All numeric
    // fields are 0x-prefixed hex strings per JSON-RPC convention — bigints
    // are not JSON-safe.
    const txParams = [
      {
        from: status.activeAccount,
        to: record.tx.to,
        value: toHex(record.tx.valueWei),
        gas: toHex(pinned.gas),
        maxFeePerGas: toHex(pinned.maxFeePerGas),
        maxPriorityFeePerGas: toHex(pinned.maxPriorityFeePerGas),
        nonce: toHex(pinned.nonce),
        data: record.tx.data,
      },
    ];

    const signClient = await getWalletConnectClient();
    let txHash: Hex;
    try {
      txHash = await signClient.request<Hex>({
        topic,
        chainId: `eip155:${record.tx.chainId}`,
        request: {
          method: "eth_sendTransaction",
          params: txParams,
        },
      });
    } catch (err) {
      // The WC SDK throws plain `{ code, message }` objects (matches
      // SDK_ERRORS shape from `@walletconnect/utils`), NOT Error
      // instances. `instanceof Error` returns false for those, so we
      // duck-type the `.message` field as a fallback before falling
      // back to `String(err)`.
      let cause: string;
      if (err instanceof Error) {
        cause = err.message;
      } else if (
        err !== null &&
        typeof err === "object" &&
        typeof (err as { message?: unknown }).message === "string"
      ) {
        cause = (err as { message: string }).message;
      } else {
        cause = String(err);
      }
      if (isUserRejectedError(err)) {
        return {
          isError: true,
          content: [
            { type: "text", text: `error: user rejected on Ledger device: ${cause}` },
          ],
          structuredContent: errEnvelope(
            "LEDGER_REJECTED",
            "user rejected on Ledger device",
            cause,
          ),
        };
      }
      return {
        isError: true,
        content: [{ type: "text", text: `error: broadcast failed: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "broadcast failed", cause),
      };
    }

    // Successful broadcast — transition handle to `sent` (T-PREVIEW-
    // CONSUMED-1: second send_transaction on the same handle now refuses
    // with WRONG_STATUS).
    const trans = transitionToSent(handleArg, txHash);
    if (!trans.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: state transition failed after broadcast: ${trans.errorCode}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `state transition failed after broadcast: ${trans.errorCode}`,
        ),
      };
    }
    const broadcastedAt = new Date().toISOString();
    return {
      content: [
        {
          type: "text",
          text: `broadcast OK\n  txHash: ${txHash}\n  broadcastedAt: ${broadcastedAt}`,
        },
      ],
      structuredContent: {
        txHash,
        broadcastedAt,
        handle: handleArg,
        chainId: record.tx.chainId,
        // Plan 09-05 (SEC-36) — WC session topic surface (last 8 chars) for
        // user cross-check against Ledger Live → Settings → Connected Apps.
        // Additive surface OUTSIDE the FROZEN three-gate region (PREP-07
        // schema gate + PREP-08 fingerprint re-check + userDecision check
        // live earlier in the handler at the validation boundary). `status`
        // is the LedgerStatus resolved upstream from `getStatus()`; the
        // demo-mode + cancel + LEDGER_REJECTED + BROADCAST_FAILED paths
        // return earlier and never reach this success-path block.
        sessionTopicLast8: status.sessionTopicLast8,
      },
    };
  } catch (err) {
    // Defensive catch-all — the explicit refusal paths above cover all
    // expected failures. INTERNAL_ERROR is the unstructured fallback
    // (matches Plan 04-02 + 04-03 precedent).
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: send_transaction failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "send_transaction failed",
        message,
      ),
    };
  }
};

registerTool("send_transaction", DESCRIPTION, INPUT_SCHEMA, sendTransactionHandler);

// ===========================================================================
// Phase 12 — Plan 12-05 — Solana branch (additive; lives OUTSIDE the FROZEN
// three-gate region above). Dispatcher in the main handler reads
// `record.tx.txType` and routes here for `"solana"` handles. The three FROZEN
// gates (PREVIEW_REQUIRED, WRONG_STATUS, PREVIEW_TOKEN_MISMATCH,
// PAYLOAD_FINGERPRINT_DRIFT) and the cancel branch fired identically before
// this dispatch — only the transport differs:
//
//   - EVM:    WC `signClient.request("eth_sendTransaction", ...)` (Ledger Live
//             signs + broadcasts internally).
//   - Solana: USB-HID `signSolanaTransaction(...)` returns a 64-byte Ed25519
//             signature; MCP attaches the signature via `tx.addSignature` and
//             broadcasts directly via `connection.sendRawTransaction(...)`.
//             No WC relay; no Ledger Live equivalent.
//
// Demo-mode mirror (DEMO-05 — `_simulationSolana.runSolanaPreviewSimulation`
// against the persona address): NOTHING signed; NOTHING broadcast.
// `_transport.signTransactionViaApp` spy = 0 calls; `connection.sendRawTransaction`
// spy = 0 calls. Locked invariant — the "nothing leaves MCP in demo mode" promise.
//
// Locked errorCode set: WALLET_NOT_PAIRED, LEDGER_NOT_CONNECTED,
// SOLANA_APP_NOT_OPEN, LEDGER_REJECTED, BROADCAST_FAILED, INTERNAL_ERROR.
// NO new errorCode introduced — Plan 12-01 added SIMULATION_REFUSED
// (preview-only); BROADCAST_FAILED reused for sendRawTransaction failures per
// RESEARCH OQ-3.
// ===========================================================================

/**
 * Build the SIMULATION text block emitted by demo-mode Solana
 * `userDecision: "send"`. Surfaces the `simulateTransaction` envelope
 * verbatim — status + err + first 3 log lines. Mirrors the EVM
 * `buildSimulationText` shape but with Solana-specific fields.
 */
function buildSolanaSimulationText(input: {
  status: string;
  err: string | null;
  unitsConsumed: number | null;
  logCount: number;
  logs: string[];
}): string {
  const logPreview = input.logs
    .slice(0, 3)
    .map((line) => `    ${line}`)
    .join("\n");
  const lines = [
    "SIMULATION (Solana — demo mode)",
    `  status:         ${input.status.toUpperCase()}`,
    `  err:            ${input.err ?? "(none)"}`,
    `  unitsConsumed:  ${input.unitsConsumed === null ? "n/a" : input.unitsConsumed.toString()}`,
    `  log count:      ${input.logCount}`,
    "  log preview (first 3 lines; full list in structuredContent.simulationLogs):",
    logPreview,
  ];
  return lines.join("\n");
}

/**
 * Solana branch of `send_transaction`. Dispatched by the main handler when
 * `record.tx.txType === "solana"`. Performs:
 *
 *   1. **Demo-mode short-circuit** (DEMO-05 mirror) — simulates against the
 *      Solana persona; returns a simulation envelope; NOTHING signed; NOTHING
 *      broadcast.
 *   2. **Pairing check** — Solana uses the persistent non-EVM account store
 *      (NOT WC `getStatus()`). Refuses `WALLET_NOT_PAIRED` if no Solana
 *      account paired.
 *   3. **Persona-swap defense** — assert
 *      `accounts[0].address === record.tx.feePayer` (sender-DEPENDENT
 *      fingerprint per RESEARCH Topic 3). Mid-flow re-pair to a different
 *      account → `INTERNAL_ERROR` refusal.
 *   4. **Reconstruct Transaction** from `record.tx.messageBytes` via
 *      `Transaction.populate(Message.from(...))`.
 *   5. **Sign via USB-HID Ledger** — `signSolanaTransaction({ messageBytes,
 *      userInputType: "sol" })` returns `{ signature: Uint8Array }` (64-byte
 *      Ed25519). Per-call transport open/close.
 *   6. **Attach signature + serialize** — `tx.addSignature(feePayer,
 *      Buffer.from(signature))`; `tx.serialize()` produces the wire bytes.
 *   7. **Broadcast** — `connection.sendRawTransaction(serializedSignedTx)`
 *      returns base58 signature.
 *   8. **State transition** — `transitionToSent(handle, txSignature)`.
 *   9. **Return** — BOTH `txHash` (API symmetry with EVM) AND `txSignature`
 *      (canonical Solana name); same base58 value under both keys.
 */
async function sendTransactionSolanaBranch(
  record: HandleRecord,
  handleArg: string,
): Promise<ToolHandlerResult> {
  const solTx = record.tx as PreparedTxSolana;

  // ---- Demo-mode short-circuit (DEMO-05 Solana mirror) ----------------
  if (isDemoMode()) {
    // T-NULL-PERSONA-1 mirror — explicit demo without `set_demo_wallet`
    // (Solana persona). Surface WRONG_MODE so the agent prompts the user
    // for a Solana persona before retrying.
    const solPersona = getActiveSolanaPersona();
    if (solPersona === null) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: demo mode is active but no Solana persona set. Call `set_demo_wallet` with a Solana persona slug (e.g. \"solana-whale\") first.",
          },
        ],
        structuredContent: errEnvelope(
          "WRONG_MODE",
          "demo mode active but no Solana persona set; call set_demo_wallet first",
        ),
      };
    }

    // Reconstruct Transaction from messageBytes for the simulation call.
    // `_simulationSolana.runSolanaPreviewSimulation` NEVER throws — RPC
    // failures demote to `status: "error"`. Demo mode does NOT refuse on
    // non-ok simulation (preview already enforced DF-4); the envelope is
    // surfaced informationally.
    let tx: Transaction;
    try {
      const message = Message.from(Buffer.from(solTx.messageBytes));
      tx = Transaction.populate(message);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to reconstruct Solana transaction from messageBytes: ${cause}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "failed to reconstruct Solana transaction from messageBytes",
          cause,
        ),
      };
    }
    const connection = _solanaRegistry.getConnection();
    const sim = await _simulationSolana.runSolanaPreviewSimulation({
      connection,
      transaction: tx,
    });
    const simulatedAt = new Date().toISOString();
    return {
      content: [
        {
          type: "text",
          text: buildSolanaSimulationText({
            status: sim.status,
            err: sim.err,
            unitsConsumed: sim.unitsConsumed,
            logCount: sim.logs.length,
            logs: sim.logs,
          }),
        },
      ],
      structuredContent: {
        simulated: true,
        simulationResult: sim.status,
        simulationLogs: sim.logs,
        simulationError: sim.err,
        simulatedAt,
        handle: handleArg,
        txType: "solana" as const,
      },
    };
  }

  // ---- Pairing check (Solana — persistent non-EVM account store) ------
  const accounts = listAccounts({ chainFilter: "solana" });
  if (accounts.length === 0) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: no paired Solana account. Call `pair_solana_ledger` first to pair your Solana Ledger account, then retry.",
        },
      ],
      structuredContent: errEnvelope(
        "WALLET_NOT_PAIRED",
        "no paired Solana account; call pair_solana_ledger first",
      ),
    };
  }
  // Single-account scope per v1.x (mirror `prepare_solana_native_send.ts`).
  const account = accounts[0];
  if (!account) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "error: no paired Solana account (unreachable narrowing).",
        },
      ],
      structuredContent: errEnvelope(
        "WALLET_NOT_PAIRED",
        "no paired Solana account (unreachable narrowing)",
      ),
    };
  }

  // Persona-swap defense (RESEARCH Topic 3 + Solana fingerprint sender-
  // DEPENDENCE). The fingerprint already binds feePayer via the message
  // bytes; this check surfaces a clearer error than a downstream device-
  // rejection ("Wrong derivation path") when the paired account changed
  // between prepare and send. The PAYLOAD_FINGERPRINT_DRIFT gate above
  // would ALSO catch any messageBytes mutation; this is a higher-fidelity
  // diagnostic for the specific persona-swap case (feePayer matches the
  // pinned messageBytes but the paired account doesn't).
  if (account.address !== solTx.feePayer) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `error: paired Solana account changed since prepare. Prepared for feePayer=${solTx.feePayer}, currently paired to ${account.address}. Re-run prepare_solana_native_send (or prepare_solana_spl_send) to mint a fresh handle against the active account.`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "paired Solana account changed since prepare; re-run prepare_solana_*",
      ),
    };
  }

  // ---- Reconstruct Transaction from messageBytes ----------------------
  let tx: Transaction;
  let feePayerPubkey: PublicKey;
  try {
    const message = Message.from(Buffer.from(solTx.messageBytes));
    tx = Transaction.populate(message);
    feePayerPubkey = new PublicKey(solTx.feePayer);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: failed to reconstruct Solana transaction from messageBytes: ${cause}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "failed to reconstruct Solana transaction from messageBytes",
        cause,
      ),
    };
  }

  // ---- Sign via Ledger USB-HID (per-call transport) -------------------
  let signature: Uint8Array;
  try {
    const result = await signSolanaTransaction({
      messageBytes: solTx.messageBytes,
      // Plan 12-04 lock — `"sol"` clear-signs the user-entered wallet
      // address, NOT the server-derived ATA (LedgerHQ/ledger-live PR #12199).
      userInputType: "sol",
    });
    signature = result.signature;
  } catch (err) {
    if (err instanceof LedgerDeviceNotConnectedError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope(
          "LEDGER_NOT_CONNECTED",
          err.message,
        ),
      };
    }
    if (err instanceof LedgerSolanaAppNotOpenError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope(
          "SOLANA_APP_NOT_OPEN",
          err.message,
        ),
      };
    }
    if (err instanceof LedgerSolanaUserRejectedError) {
      const cause = err.message;
      return {
        isError: true,
        content: [
          { type: "text", text: `error: user rejected on Ledger device: ${cause}` },
        ],
        structuredContent: errEnvelope(
          "LEDGER_REJECTED",
          "user rejected on Ledger device",
          cause,
        ),
      };
    }
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: Ledger sign failure: ${cause}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "Ledger sign failure",
        cause,
      ),
    };
  }

  // ---- Attach signature + serialize ------------------------------------
  // `tx.addSignature(feePayer, Buffer.from(signature))` writes the signature
  // into the right `account_keys[0]` slot. After this, `tx.serialize()` with
  // `verifySignatures: false` produces the wire bytes WITHOUT a server-side
  // Ed25519 verify pass — the trust anchor is the on-device Ledger approval
  // (the user verified the message hash on-screen), and the cluster verifies
  // signatures at broadcast time anyway. `requireAllSignatures: true` keeps
  // the all-signatures-attached invariant (account_keys[0] slot must be
  // populated, which `addSignature` did above).
  let signedSerialized: Buffer;
  try {
    tx.addSignature(feePayerPubkey, Buffer.from(signature));
    signedSerialized = tx.serialize({
      requireAllSignatures: true,
      verifySignatures: false,
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: failed to attach signature: ${cause}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "failed to attach signature to Solana transaction",
        cause,
      ),
    };
  }

  // ---- Broadcast via direct sendRawTransaction (no LL bridge) ---------
  // RESEARCH Topic 7 — Solana has no WalletConnect-mediated broadcast.
  // The MCP calls `connection.sendRawTransaction` directly; the broadcast
  // trust boundary collapses from "relay + RPC + device" (EVM) to "RPC +
  // device" (Solana). Documented in SECURITY.md § Solana Trust Pipeline.
  let txSignature: string;
  try {
    const connection = _solanaRegistry.getConnection();
    txSignature = await connection.sendRawTransaction(signedSerialized);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: Solana broadcast failed: ${cause}` },
      ],
      structuredContent: errEnvelope(
        "BROADCAST_FAILED",
        "Solana broadcast failed",
        cause,
      ),
    };
  }

  // ---- State transition + return ---------------------------------------
  const trans = transitionToSent(handleArg, txSignature);
  if (!trans.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: state transition failed after broadcast: ${trans.errorCode}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        `state transition failed after broadcast: ${trans.errorCode}`,
      ),
    };
  }
  const broadcastedAt = new Date().toISOString();
  return {
    content: [
      {
        type: "text",
        text: `broadcast OK (Solana)\n  txSignature: ${txSignature}\n  broadcastedAt: ${broadcastedAt}\n  handle: ${handleArg.slice(0, 8)}…`,
      },
    ],
    structuredContent: {
      // API symmetry — existing agent prompts + tests read `txHash` (per
      // orchestrator override). Carries the base58 signature value.
      txHash: txSignature,
      // Canonical Solana nomenclature (RESEARCH Topic 7). SAME base58 value
      // surfaced under both keys.
      txSignature,
      broadcastedAt,
      handle: handleArg,
      txType: "solana" as const,
      // Phase 12 — no WC session topic for Solana (USB-HID bypasses WC
      // entirely). `null` surfaces for cross-chain agent symmetry.
      sessionTopicLast8: null,
    },
  };
}

// ===========================================================================
// Phase 18 — Plan 18-04 — TRON branch (additive; lives OUTSIDE the FROZEN
// three-gate region above). Dispatcher in the main handler reads
// `record.tx.txType` and routes here for `"tron"` handles. The three FROZEN
// gates (PREVIEW_REQUIRED, WRONG_STATUS, PREVIEW_TOKEN_MISMATCH,
// PAYLOAD_FINGERPRINT_DRIFT) and the cancel branch fired identically before
// this dispatch — only the transport call differs.
//
// TRON broadcast path:
//   1. Demo-mode short-circuit (DEMO-05 mirror)
//   2. Pairing check — persistent non-EVM account store (chainFilter: "tron")
//   3. Sign via Ledger TRX app over USB-HID via `_tronLedgerTransport.signTransaction`
//   4. Wrap signature into outer Transaction envelope (signature[] field)
//   5. Broadcast via `tronweb.trx.sendRawTransaction(signedTransaction)`
//   6. State transition via `transitionToSent`
//
// Error envelope mapping (RESEARCH §Topic 7):
//   - SIGERROR → LEDGER_REJECTED (signature didn't verify)
//   - TRANSACTION_EXPIRATION_ERROR / BANDWITH_ERROR / CONTRACT_VALIDATE_ERROR → BROADCAST_FAILED
//
// FLAG-1.5 inline-fix: `txID` field = `record.pinned!.presignHash.slice(2)` (SHA-256 of raw_data
// = TRON consensus tx-id), NOT `record.payloadFingerprint.slice(2)` (keccak256 binding hash).
// ===========================================================================

/**
 * Build the demo-mode simulation envelope for a TRON `userDecision: "send"`.
 * Surfaces simulation result for TRC-20 (via `emitNoSimulationAvailable` shape)
 * or the no-simulation advisory for native TRX. NOTHING signed; NOTHING broadcast.
 */
async function buildTronDemoSimulationResponse(
  record: HandleRecord & { tx: PreparedTxTron },
  handleArg: string,
): Promise<ToolHandlerResult> {
  const tronTx = record.tx;
  // For demo mode, just run simulation if TRC-20 (informational only) or skip for native.
  let simResult;
  if (tronTx.kind === "trc20" && tronTx.instructionSummary && tronTx.instructionSummary[0]) {
    const tronWeb = _tronRegistry.getTronWeb();
    const summary = tronTx.instructionSummary[0];
    if (summary.kind === "trc20-transfer") {
      simResult = await _simulationTron.runTronPreviewSimulation({
        tronWeb,
        contractAddress: tronTx.contractAddress!,
        functionSelector: "transfer(address,uint256)",
        parameters: [
          { type: "address", value: summary.to },
          { type: "uint256", value: summary.amount.toString() },
        ],
        ownerAddress: summary.from,
      });
    } else {
      simResult = _simulationTron.emitNoSimulationAvailable();
    }
  } else {
    simResult = _simulationTron.emitNoSimulationAvailable();
  }
  const simulatedAt = new Date().toISOString();
  const kindLabel = tronTx.kind === "native" ? "native TRX" : tronTx.kind === "sunswap-swap" ? "SunSwap V2 swap" : "TRC-20";
  const text = [
    `SIMULATION (TRON — demo mode)`,
    `  kind:   ${kindLabel}`,
    `  status: ${simResult.status.toUpperCase()}`,
    ...(simResult.revertReason ? [`  revert: ${simResult.revertReason}`] : []),
    `  (no broadcast performed)`,
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      simulated: true,
      demoMode: true,
      simulationResult: simResult.status,
      simulationError: simResult.revertReason ?? simResult.rpcError ?? null,
      simulatedAt,
      handle: handleArg,
      txType: "tron" as const,
      kind: tronTx.kind,
    },
  };
}

/**
 * TRON branch of `send_transaction`. Dispatched by the main handler when
 * `record.tx.txType === "tron"`. All three FROZEN gates (PREVIEW_REQUIRED,
 * PREVIEW_TOKEN_MISMATCH, PAYLOAD_FINGERPRINT_DRIFT) and the cancel branch
 * fired identically before reaching this function.
 */
async function sendTransactionTronBranch(
  record: HandleRecord & { tx: PreparedTxTron },
  handleArg: string,
): Promise<ToolHandlerResult> {
  const tronTx = record.tx;
  const pinned = record.pinned!;

  // ---- Demo-mode short-circuit (DEMO-05 TRON mirror) --------------------
  if (isDemoMode()) {
    const tronPersona = getActiveTronPersona();
    if (tronPersona === null) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "error: demo mode is active but no TRON persona set. Call `set_demo_wallet` with a TRON persona slug first.",
          },
        ],
        structuredContent: errEnvelope(
          "WRONG_MODE",
          "demo mode active but no TRON persona set; call set_demo_wallet first",
        ),
      };
    }
    return buildTronDemoSimulationResponse(record, handleArg);
  }

  // ---- Pairing check (TRON — persistent non-EVM account store) ----------
  const accounts = listAccounts({ chainFilter: "tron" });
  if (accounts.length === 0) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "error: no paired TRON account. Call `pair_tron_ledger` first to pair your TRON Ledger account, then retry.",
        },
      ],
      structuredContent: errEnvelope(
        "WALLET_NOT_PAIRED",
        "no paired TRON account; call pair_tron_ledger first",
      ),
    };
  }
  const account = accounts[0];
  if (!account) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: no paired TRON account (unreachable narrowing)." }],
      structuredContent: errEnvelope("WALLET_NOT_PAIRED", "no paired TRON account (unreachable narrowing)"),
    };
  }

  // ---- Sign via Ledger TRX app (USB-HID, per-call) ----------------------
  let signature: string;
  try {
    signature = await _tronLedgerTransport.signTransaction({
      path: account.derivationPath,
      rawTxHex: tronTx.rawDataHex,
      tokenSignatures: [], // Phase 18 — bundled token registry covers Phase 18 set
    });
  } catch (err) {
    if (err instanceof LedgerTronDeviceNotConnectedError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope("LEDGER_NOT_CONNECTED", err.message),
      };
    }
    if (err instanceof LedgerTronAppNotOpenError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope(
          "LEDGER_REJECTED",
          "Ledger TRX app not open. Open the TRX app on the device and retry.",
          err.message,
        ),
      };
    }
    if (err instanceof Error && /reject/i.test(err.message)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: user rejected on Ledger device: ${err.message}` }],
        structuredContent: errEnvelope("LEDGER_REJECTED", "user rejected on Ledger device", err.message),
      };
    }
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: TRON Ledger signing failed: ${cause}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "TRON Ledger signing failed", cause),
    };
  }

  // ---- Wrap signature into outer broadcast envelope ----------------------
  // CRITICAL FLAG-1.5 inline-fix: `txID` field MUST be
  // `record.pinned.presignHash.slice(2)` (SHA-256 of raw_data = TRON consensus
  // tx-id), NOT `record.payloadFingerprint.slice(2)` (keccak256 binding fingerprint).
  // See RESEARCH §Topic 4 for the hash-function-per-layer rationale.
  const signedTransaction = {
    visible: true,
    txID: pinned.presignHash.slice(2), // strip 0x prefix; TRON tx-id == SHA-256(raw_data) hex
    raw_data: tronTx.rawDataObject,
    raw_data_hex: tronTx.rawDataHex,
    signature: [signature],
  };

  // ---- Broadcast via tronweb ---------------------------------------------
  const tronWeb = _tronRegistry.getTronWeb();
  let broadcastResult: { result: unknown; code?: string; message?: string; txid?: string };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    broadcastResult = await (tronWeb.trx.sendRawTransaction as any)(signedTransaction);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: TronGrid broadcast call failed: ${cause}` }],
      structuredContent: errEnvelope("BROADCAST_FAILED", "TronGrid broadcast call failed", cause),
    };
  }

  // Defensive: handle both flat `{ result: true }` and nested `{ result: { result: true } }` shapes.
  const topResult = broadcastResult.result;
  const resultBool =
    topResult === true ||
    (topResult !== null && typeof topResult === "object" && (topResult as Record<string, unknown>).result === true);
  if (!resultBool) {
    // Flatten code from top-level or nested
    const code =
      broadcastResult.code ??
      (topResult !== null && typeof topResult === "object"
        ? (topResult as Record<string, unknown>).code as string | undefined
        : undefined) ??
      "UNKNOWN_CODE";
    if (code === "SIGERROR") {
      return {
        isError: true,
        content: [{ type: "text", text: "error: Signature did not verify against the public key — transport corruption suspected" }],
        structuredContent: errEnvelope(
          "LEDGER_REJECTED",
          "Signature did not verify against the public key — transport corruption suspected",
          broadcastResult.message,
        ),
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `error: TronGrid refused broadcast: ${code}` }],
      structuredContent: errEnvelope(
        "BROADCAST_FAILED",
        `TronGrid refused broadcast: ${code}`,
        broadcastResult.message,
      ),
    };
  }

  // ---- Success — stamp handle, return tx hash ---------------------------
  // `broadcastResult.txid` is the TRON transaction ID (hex string, no 0x prefix).
  const txHash = broadcastResult.txid ?? pinned.presignHash.slice(2);
  const trans = transitionToSent(handleArg, txHash);
  if (!trans.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: state transition failed after broadcast: ${trans.errorCode}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        `state transition failed after broadcast: ${trans.errorCode}`,
      ),
    };
  }
  const broadcastedAt = new Date().toISOString();
  return {
    content: [
      {
        type: "text",
        text: `broadcast OK (TRON)\n  txID: ${txHash}\n  broadcastedAt: ${broadcastedAt}\n\nView on TronScan: https://tronscan.org/#/transaction/${txHash}`,
      },
    ],
    structuredContent: {
      txHash,
      txID: txHash, // alias for TRON convention
      broadcastedAt,
      handle: handleArg,
      txType: "tron" as const,
      kind: tronTx.kind,
      // Phase 18 — no WC session topic for TRON (USB-HID bypasses WC).
      sessionTopicLast8: null,
    },
  };
}

// ===========================================================================
// Phase 23 — Plan 23-04 — BTC branch (additive; lives OUTSIDE the FROZEN
// three-gate region above). Dispatcher reads `record.tx.txType === "btc"`.
//
// BTC broadcast path:
//   1. Demo-mode short-circuit (D-04) — mempool-replay envelope; NOTHING signed.
//   2. Pairing check — non-EVM account store (chainFilter: "bitcoin").
//   3. Build BtcPsbtSignInput[] from inputScriptTypes.
//   4. Sign via Ledger BTC app over USB-HID (`_btcLedgerTransport.signBtcPsbt`).
//   5. Broadcast via Esplora POST /tx (`esploraBroadcastTx`).
//   6. State transition via `transitionToSent`.
//
// Error mapping:
//   LedgerBtcDeviceNotConnectedError → LEDGER_NOT_CONNECTED
//   LedgerBtcAppNotOpenError         → LEDGER_REJECTED
//   /reject/i                        → LEDGER_REJECTED
//   /combine|finalize|mixed/i        → BTC_MIXED_INPUT_SIGN_FAILURE
//   Esplora { kind: "rejected" | "error" } → BROADCAST_FAILED
// ===========================================================================

/**
 * Build the demo-mode simulation envelope for a BTC `userDecision: "send"`.
 * Returns a mempool-replay envelope (D-04 shape). NOTHING signed; NOTHING broadcast.
 */
async function buildBtcDemoSimulationResponse(
  record: HandleRecord & { tx: PreparedTxBtc },
  handleArg: string,
): Promise<ToolHandlerResult> {
  const btcTx = record.tx;
  const simulatedAt = new Date().toISOString();
  const text = [
    "SIMULATION (BTC — demo mode)",
    `  kind:              ${btcTx.kind}`,
    `  inputs:            ${btcTx.inputs.length}`,
    `  outputs:           ${btcTx.outputs.length}`,
    `  feeSats:           ${btcTx.feeSats.toString()}`,
    `  psbtBase64:        ${btcTx.psbtBase64.slice(0, 24)}…`,
    `  envelopeShape:     psbt-mempool-replay`,
    `  (no device call; no broadcast performed)`,
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      simulated: true,
      demoMode: true,
      simulationResult: "ok",
      simulatedAt,
      handle: handleArg,
      txType: "btc" as const,
      kind: btcTx.kind,
      envelopeShape: "psbt-mempool-replay",
      sessionTopicLast8: null,
    },
  };
}

/**
 * BTC branch of `send_transaction`. Dispatched by the main handler when
 * `record.tx.txType === "btc"`. All three FROZEN gates and the cancel branch
 * fired identically before reaching this function.
 */
async function sendTransactionBtcBranch(
  record: HandleRecord & { tx: PreparedTxBtc },
  handleArg: string,
): Promise<ToolHandlerResult> {
  const btcTx = record.tx;

  // ---- Demo-mode short-circuit (D-04 — mempool-replay) --------------------
  if (isDemoMode()) {
    const btcPersona = getActiveBtcPersona();
    if (btcPersona === null) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: demo mode is active but no BTC persona set. Call `set_demo_wallet` with a BTC persona slug (e.g. \"btc-whale\") first.",
          },
        ],
        structuredContent: errEnvelope(
          "WRONG_MODE",
          "demo mode active but no BTC persona set; call set_demo_wallet first",
        ),
      };
    }
    return buildBtcDemoSimulationResponse(record, handleArg);
  }

  // ---- Pairing check (BTC — persistent non-EVM account store) ------------
  // Skip for multisig-psbt handles: those use the multisig registry (btc-multisig-store)
  // rather than the single-key paired account store (pair_btc_ledger).
  const accounts = btcTx.kind === "multisig-psbt" ? [] : listAccounts({ chainFilter: "bitcoin" });
  if (btcTx.kind !== "multisig-psbt" && accounts.length === 0) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: no paired BTC account. Call `pair_btc_ledger` first to pair your Bitcoin Ledger account, then retry.",
        },
      ],
      structuredContent: errEnvelope(
        "WALLET_NOT_PAIRED",
        "no paired BTC account; call pair_btc_ledger first",
      ),
    };
  }
  const account = accounts[0];
  if (btcTx.kind !== "multisig-psbt" && !account) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: no paired BTC account (unreachable narrowing)." }],
      structuredContent: errEnvelope("WALLET_NOT_PAIRED", "no paired BTC account (unreachable narrowing)"),
    };
  }

  // ---- Build BtcPsbtSignInput[] from inputScriptTypes (single-key only) ---
  // Placeholder pubkey (33 bytes) and masterFingerprint (4 bytes) — the Ledger
  // BTC app uses the PSBT's bip32Derivation to determine the signing key;
  // the derivation path + masterFp in BtcPsbtSignInput tells it which key to use.
  // Phase 23 v1: we derive the path from account.derivationPath.
  // Note: skipped for multisig-psbt — those dispatch early via the kind check below.
  const placeholderPubkey = new Uint8Array(33); // Ledger fills in from derivation
  const PLACEHOLDER_MASTER_FP = new Uint8Array(4); // 00000000 — Ledger uses its own fp

  // Defer signInputs construction for non-multisig paths only.
  // account is undefined for multisig-psbt (accounts=[] above); that branch
  // returns early in the "Dispatch on kind" block below.
  const signInputs: BtcPsbtSignInput[] =
    btcTx.kind !== "multisig-psbt"
      ? btcTx.inputScriptTypes.map((scriptType, idx) => ({
          index: idx,
          scriptType,
          bip32Path: account!.derivationPath,
          pubkey: placeholderPubkey,
          masterFingerprint: PLACEHOLDER_MASTER_FP,
        }))
      : [];

  // ---- Build knownAddressDerivations for change output (CR-01 / Pitfall 6) ---
  // Without the change address in knownAddressDerivations, the Ledger BTC app
  // displays the change output as a second send recipient rather than "your change".
  // The map key is the scriptPubKey hash hex (20 bytes for P2WPKH, 32 bytes for P2TR)
  // extracted from the change address's output script (same approach as the
  // @ledgerhq/psbtv2 `extractHashFromScriptPubKey` function used internally).
  const knownDerivations: KnownAddressDerivation[] = [];
  if (btcTx.changeAddress !== null && btcTx.changePath !== null) {
    try {
      const changeScript = btcAddressLib.toOutputScript(btcTx.changeAddress, btcNetworks.bitcoin);
      // Extract the hash: P2WPKH = bytes[2..22] (20-byte hash160), P2TR = bytes[2..34] (32-byte x-only)
      let hashHex: string | undefined;
      if (changeScript.length === 22 && changeScript[0] === 0x00 && changeScript[1] === 0x14) {
        // P2WPKH: OP_0 OP_PUSHDATA(20) <hash160>
        hashHex = Buffer.from(changeScript.subarray(2, 22)).toString("hex");
      } else if (changeScript.length === 34 && changeScript[0] === 0x51 && changeScript[1] === 0x20) {
        // P2TR: OP_1 OP_PUSHDATA(32) <x-only-tweaked-key>
        hashHex = Buffer.from(changeScript.subarray(2, 34)).toString("hex");
      }
      if (hashHex !== undefined) {
        knownDerivations.push({
          scriptPubKeyHashHex: hashHex,
          pubkey: placeholderPubkey, // Ledger resolves from its own derivation tree
          path: btcTx.changePath,
        });
      }
    } catch {
      // If the change address is not parseable, proceed without it — the
      // worst case is the Ledger displays it as a send rather than change.
      // This is recoverable: the user sees it on-device and can reject.
    }
  }

  // ---- Dispatch on kind: multisig-psbt vs native/rbf -----------------------

  if (btcTx.kind === "multisig-psbt") {
    // ---- Multisig PSBT path (Phase 25 Plan 25-03) ---------------------------
    // Load wallet registry — walletHmac is re-checked here (belt-and-suspenders;
    // also catches registry revocation between prepare and send).
    const walletName = btcTx.multisigWalletName;
    if (!walletName) {
      return {
        isError: true,
        content: [{ type: "text", text: "error: multisig-psbt handle missing multisigWalletName (internal error)" }],
        structuredContent: errEnvelope("INTERNAL_ERROR", "multisig-psbt handle missing multisigWalletName"),
      };
    }

    const wallet = loadMultisigWallet(walletName);
    if (!wallet) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: multisig wallet "${walletName}" not found in registry at send time` }],
        structuredContent: errEnvelope("MULTISIG_WALLET_NOT_FOUND", `wallet "${walletName}" not found at send time`),
      };
    }

    if (!wallet.walletHmac) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `error: multisig wallet "${walletName}" has no walletHmac at send time — ` +
              "re-run register_btc_multisig_wallet with a Ledger connected to obtain the device-derived walletHmac.",
          },
        ],
        structuredContent: errEnvelope(
          "MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE",
          `wallet "${walletName}" has no walletHmac at send time; re-run register_btc_multisig_wallet`,
        ),
      };
    }

    // Build descriptorTemplate and keys from the stored descriptor.
    const parsed = parseWshSortedMulti(wallet.descriptor);
    if (!parsed) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: could not parse wallet descriptor for "${walletName}"` }],
        structuredContent: errEnvelope("INTERNAL_ERROR", `could not parse wallet descriptor for "${walletName}"`),
      };
    }
    const { m, keys } = parsed;
    const descriptorTemplate = `wsh(sortedmulti(${m},${keys.map((_, i) => `@${i}/**`).join(",")}))`;

    // Sign via Ledger AppClient.signPsbt (no broadcast — multisig partial sign).
    let updatedPsbtBase64: string;
    try {
      const result = await _btcLedgerTransport.signBtcMultisigPsbt(
        btcTx.psbtBase64,
        walletName,
        descriptorTemplate,
        keys,
        wallet.walletHmac,
      );
      updatedPsbtBase64 = result.updatedPsbtBase64;
    } catch (err) {
      if (err instanceof LedgerBtcDeviceNotConnectedError) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${err.message}` }],
          structuredContent: errEnvelope("LEDGER_NOT_CONNECTED", err.message),
        };
      }
      if (err instanceof LedgerBtcAppNotOpenError) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${err.message}` }],
          structuredContent: errEnvelope(
            "BTC_APP_NOT_OPEN",
            "Bitcoin app is not the active app on the Ledger. Open the Bitcoin app on the device and retry.",
          ),
        };
      }
      if (err instanceof LedgerBtcAppVersionTooOldError) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${err.message}` }],
          structuredContent: errEnvelope(
            "LEDGER_BTC_APP_VERSION_TOO_OLD",
            "Ledger Bitcoin app is too old for multisig wallet-policy signing. Update via Ledger Live.",
          ),
        };
      }
      const cause = err instanceof Error ? err.message : String(err);
      if (/reject/i.test(cause)) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: user rejected on Ledger device: ${cause}` }],
          structuredContent: errEnvelope("LEDGER_REJECTED", "user rejected on Ledger device", cause),
        };
      }
      return {
        isError: true,
        content: [{ type: "text", text: `error: BTC multisig Ledger signing failed: ${cause}` }],
        structuredContent: errEnvelope("INTERNAL_ERROR", "BTC multisig Ledger signing failed", cause),
      };
    }

    // Stamp handle as sent. Use a synthetic "txHash" = "multisig-partial:<walletName>"
    // since there is no broadcast txid — the Ledger contributed one partial signature.
    const partialSignedMarker = `multisig-partial:${walletName}`;
    const trans = transitionToSent(handleArg, partialSignedMarker);
    if (!trans.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: state transition failed after multisig sign: ${trans.errorCode}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `state transition failed after multisig sign: ${trans.errorCode}`,
        ),
      };
    }

    return {
      content: [
        {
          type: "text",
          text:
            `Ledger multisig signature added (BTC — ${walletName})\n` +
            `  updatedPsbtBase64: ${updatedPsbtBase64}\n\n` +
            "Share the updated PSBT with remaining co-signers, then call finalize_btc_psbt when all signatures are collected.",
        },
      ],
      structuredContent: {
        updatedPsbtBase64,
        handle: handleArg,
        txType: "btc" as const,
        kind: "multisig-psbt" as const,
        walletName,
        sessionTopicLast8: null,
      },
    };
  }

  // ---- Single-key native/rbf path (Phase 23/24) ----------------------------

  // ---- Sign via Ledger BTC app (USB-HID) ----------------------------------
  let rawTxHex: string;
  try {
    const result = await _btcLedgerTransport.signBtcPsbt(
      btcTx.psbtBase64,
      signInputs,
      knownDerivations,
    );
    rawTxHex = result.rawTxHex;
  } catch (err) {
    if (err instanceof LedgerBtcDeviceNotConnectedError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope("LEDGER_NOT_CONNECTED", err.message),
      };
    }
    if (err instanceof LedgerBtcAppNotOpenError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope(
          "BTC_APP_NOT_OPEN",
          "Bitcoin app is not the active app on the Ledger. Open the Bitcoin app on the device and retry.",
        ),
      };
    }
    const cause = err instanceof Error ? err.message : String(err);
    if (/reject/i.test(cause)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: user rejected on Ledger device: ${cause}` }],
        structuredContent: errEnvelope("LEDGER_REJECTED", "user rejected on Ledger device", cause),
      };
    }
    if (/combine|finalize|mixed/i.test(cause)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: BTC mixed-input signing failed: ${cause}` }],
        structuredContent: errEnvelope("BTC_MIXED_INPUT_SIGN_FAILURE", "BTC mixed-input PSBT signing failed", cause),
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `error: BTC Ledger signing failed: ${cause}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "BTC Ledger signing failed", cause),
    };
  }

  // ---- Broadcast via Esplora POST /tx (direct — no WC relay) -------------
  const broadcastResult = await esploraBroadcastTx(rawTxHex);
  if (broadcastResult.kind !== "ok") {
    const cause = "message" in broadcastResult ? broadcastResult.message : String(broadcastResult);
    return {
      isError: true,
      content: [{ type: "text", text: `error: BTC broadcast failed: ${cause}` }],
      structuredContent: errEnvelope("BROADCAST_FAILED", "BTC broadcast failed", cause),
    };
  }

  // ---- Success — stamp handle, return txHash ------------------------------
  const txHash = broadcastResult.txid;
  const trans = transitionToSent(handleArg, txHash);
  if (!trans.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: state transition failed after BTC broadcast: ${trans.errorCode}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        `state transition failed after BTC broadcast: ${trans.errorCode}`,
      ),
    };
  }
  const broadcastedAt = new Date().toISOString();
  return {
    content: [
      {
        type: "text",
        text: `broadcast OK (BTC)\n  txHash: ${txHash}\n  broadcastedAt: ${broadcastedAt}\n\nView on mempool.space: https://mempool.space/tx/${txHash}`,
      },
    ],
    structuredContent: {
      txHash,
      broadcastedAt,
      handle: handleArg,
      txType: "btc" as const,
      kind: btcTx.kind,
      // WR-04: include originalTxid for RBF handles so callers can link the
      // replacement tx to the original mempool tx (plan 24-01 Task 2 requirement).
      ...(btcTx.kind === "rbf" ? { originalTxid: btcTx.originalTxid } : {}),
      // Phase 23 — BTC uses Esplora direct broadcast (no WC relay).
      sessionTopicLast8: null,
    },
  };
}

// ===========================================================================
// Phase 26 — Plan 26-02 — LTC branch (additive; lives OUTSIDE the FROZEN
// three-gate region). Dispatcher in the main handler reads
// `record.tx.txType === "litecoin"` and routes here. All three FROZEN gates
// (previewToken + userDecision + payloadFingerprint drift) fire identically
// before reaching this function.
// ===========================================================================

/**
 * Demo-mode simulation response for LTC handles (mirrors buildBtcDemoSimulationResponse).
 * No device call; no broadcast. Returns a simulation envelope.
 */
async function buildLtcDemoSimulationResponse(
  record: HandleRecord & { tx: PreparedTxLtc },
  handleArg: string,
): Promise<ToolHandlerResult> {
  const ltcTx = record.tx;
  const simulatedAt = new Date().toISOString();
  const text = [
    "SIMULATION (LTC — demo mode)",
    `  kind:              ${ltcTx.kind}`,
    `  inputs:            ${ltcTx.inputs.length}`,
    `  outputs:           ${ltcTx.outputs.length}`,
    `  feeSats:           ${ltcTx.feeSats.toString()}`,
    `  psbtBase64:        ${ltcTx.psbtBase64.slice(0, 24)}…`,
    `  envelopeShape:     psbt-mempool-replay`,
    `  (no device call; no broadcast performed)`,
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      simulated: true,
      demoMode: true,
      simulationResult: "ok",
      simulatedAt,
      handle: handleArg,
      txType: "litecoin" as const,
      kind: ltcTx.kind,
      envelopeShape: "psbt-mempool-replay",
      sessionTopicLast8: null,
    },
  };
}

/**
 * LTC branch of `send_transaction`. Dispatched by the main handler when
 * `record.tx.txType === "litecoin"`. All three FROZEN gates and the cancel branch
 * fired identically before reaching this function.
 *
 * Phase 26 Plan 26-02 (LTC-W-01): P2WPKH-only segwit send via Ledger Litecoin app.
 * Demo-mode short-circuit returns a simulation envelope (no device call, no broadcast).
 */
async function sendTransactionLtcBranch(
  record: HandleRecord & { tx: PreparedTxLtc },
  handleArg: string,
): Promise<ToolHandlerResult> {
  const ltcTx = record.tx;

  // ---- Demo-mode short-circuit (mirrors BTC D-04) --------------------------
  if (isDemoMode()) {
    const ltcPersona = getActiveLtcPersona();
    if (ltcPersona === null) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: demo mode is active but no LTC persona set. Call `set_demo_wallet` with an LTC persona slug (e.g. \"ltc-whale\") first.",
          },
        ],
        structuredContent: errEnvelope(
          "WRONG_MODE",
          "demo mode active but no LTC persona set; call set_demo_wallet first",
        ),
      };
    }
    return buildLtcDemoSimulationResponse(record, handleArg);
  }

  // ---- Pairing check (LTC — persistent non-EVM account store) -------------
  const accounts = listAccounts({ chainFilter: "litecoin" });
  if (accounts.length === 0) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: no paired LTC account. Call `pair_litecoin_ledger` first to pair your Litecoin Ledger account, then retry.",
        },
      ],
      structuredContent: errEnvelope(
        "WALLET_NOT_PAIRED",
        "no paired LTC account; call pair_litecoin_ledger first",
      ),
    };
  }
  const account = accounts[0]!;

  // ---- Build BtcPsbtSignInput[] for P2WPKH (LTC Phase 26 — no taproot) ----
  const placeholderPubkey = new Uint8Array(33);
  const PLACEHOLDER_MASTER_FP = new Uint8Array(4);

  const signInputs: BtcPsbtSignInput[] = ltcTx.inputScriptTypes.map((scriptType, idx) => ({
    index: idx,
    scriptType,
    bip32Path: account.derivationPath,
    pubkey: placeholderPubkey,
    masterFingerprint: PLACEHOLDER_MASTER_FP,
  }));

  // ---- Build knownAddressDerivations for LTC change output (CR-01 mirror) --
  const knownDerivations: KnownAddressDerivation[] = [];
  if (ltcTx.changeAddress !== null && ltcTx.changePath !== null) {
    try {
      const changeScript = btcAddressLib.toOutputScript(ltcTx.changeAddress, LTC_NETWORK);
      let hashHex: string | undefined;
      if (changeScript.length === 22 && changeScript[0] === 0x00 && changeScript[1] === 0x14) {
        hashHex = Buffer.from(changeScript.subarray(2, 22)).toString("hex");
      }
      if (hashHex !== undefined) {
        knownDerivations.push({
          scriptPubKeyHashHex: hashHex,
          pubkey: placeholderPubkey,
          path: ltcTx.changePath,
        });
      }
    } catch {
      // Non-parseable change address — proceed; worst case Ledger displays it as a send.
    }
  }

  // ---- Sign via Ledger Litecoin app (USB-HID) -----------------------------
  let rawTxHex: string;
  try {
    const result = await _ltcLedgerTransport.signLtcPsbt(
      ltcTx.psbtBase64,
      signInputs,
      knownDerivations,
    );
    rawTxHex = result.rawTxHex;
  } catch (err) {
    if (err instanceof LedgerBtcDeviceNotConnectedError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope("LEDGER_NOT_CONNECTED", err.message),
      };
    }
    if (err instanceof LedgerLtcAppNotOpenError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope(
          "BTC_APP_NOT_OPEN",
          "Litecoin app is not the active app on the Ledger. Open the Litecoin app on the device and retry.",
        ),
      };
    }
    const cause = err instanceof Error ? err.message : String(err);
    if (/reject/i.test(cause)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: user rejected on Ledger device: ${cause}` }],
        structuredContent: errEnvelope("LEDGER_REJECTED", "user rejected on Ledger device", cause),
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `error: LTC Ledger signing failed: ${cause}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "LTC Ledger signing failed", cause),
    };
  }

  // ---- Broadcast via LTC Esplora POST /tx (direct — no WC relay) ----------
  const broadcastResult = await ltcEsploraBroadcastTx(rawTxHex);
  if (broadcastResult.kind !== "ok") {
    const cause = "message" in broadcastResult ? broadcastResult.message : String(broadcastResult);
    return {
      isError: true,
      content: [{ type: "text", text: `error: LTC broadcast failed: ${cause}` }],
      structuredContent: errEnvelope("BROADCAST_FAILED", "LTC broadcast failed", cause),
    };
  }

  // ---- Success — stamp handle, return txHash ------------------------------
  const txHash = broadcastResult.txid;
  const trans = transitionToSent(handleArg, txHash);
  if (!trans.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: state transition failed after LTC broadcast: ${trans.errorCode}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        `state transition failed after LTC broadcast: ${trans.errorCode}`,
      ),
    };
  }
  const broadcastedAt = new Date().toISOString();
  return {
    content: [
      {
        type: "text",
        text: `broadcast OK (LTC)\n  txHash: ${txHash}\n  broadcastedAt: ${broadcastedAt}\n\nView on litecoinspace.org: https://litecoinspace.org/tx/${txHash}`,
      },
    ],
    structuredContent: {
      txHash,
      broadcastedAt,
      handle: handleArg,
      txType: "litecoin" as const,
      kind: ltcTx.kind,
      // Phase 26 — LTC uses Esplora direct broadcast (no WC relay).
      sessionTopicLast8: null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 26 Plan 26-03 — BTC LiFi bridge send branch (BTC-LIFI-01).
//
// Signs the LiFi-supplied PSBT via Ledger Bitcoin app and broadcasts via
// BTC Esplora. Mirrors sendTransactionBtcBranch but uses the LiFi PSBT
// (no per-input sighash assembly — psbtHex is verbatim from LiFi).
//
// Demo-mode: simulation envelope (no device call, no broadcast).
// Real mode: Ledger BTC app PSBT-sign → Esplora POST /tx broadcast.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BTC LiFi bridge send branch of `send_transaction`.
 * Dispatched by the main handler when `record.tx.txType === "btc-lifi"`.
 * All three FROZEN gates fired identically before reaching this function.
 *
 * Phase 26 Plan 26-03 (BTC-LIFI-01).
 */
async function sendTransactionBtcLifiBranch(
  record: HandleRecord & { tx: PreparedTxBtcLifi },
  handleArg: string,
): Promise<ToolHandlerResult> {
  const btcLifiTx = record.tx;

  // ---- Demo-mode short-circuit -----------------------------------------------
  if (isDemoMode()) {
    const simulatedAt = new Date().toISOString();
    const psbtPreview = btcLifiTx.psbtHex.slice(0, 24);
    const text = [
      "SIMULATION (BTC LiFi — demo mode)",
      `  txType:            btc-lifi`,
      `  toChain:           ${btcLifiTx.toChain}`,
      `  toToken:           ${btcLifiTx.toToken}`,
      `  toAddress:         ${btcLifiTx.toAddress}`,
      `  vaultAddress:      ${btcLifiTx.vaultAddress}`,
      `  amountSats:        ${btcLifiTx.amountSats.toString()}`,
      `  psbtHex (preview): ${psbtPreview}…`,
      `  envelopeShape:     lifi-psbt-bridge`,
      `  (no device call; no broadcast performed)`,
    ].join("\n");
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        simulated: true,
        demoMode: true,
        simulationResult: "ok",
        simulatedAt,
        handle: handleArg,
        txType: "btc-lifi" as const,
        toChain: btcLifiTx.toChain,
        toToken: btcLifiTx.toToken,
        toAddress: btcLifiTx.toAddress,
        envelopeShape: "lifi-psbt-bridge",
        sessionTopicLast8: null,
      },
    };
  }

  // ---- Pairing check (BTC — persistent non-EVM account store) ---------------
  const accounts = listAccounts({ chainFilter: "bitcoin" });
  if (accounts.length === 0) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: no paired BTC account. Call `pair_btc_ledger` first to pair your Bitcoin Ledger account, then retry.",
        },
      ],
      structuredContent: errEnvelope(
        "WALLET_NOT_PAIRED",
        "no paired BTC account; call pair_btc_ledger first",
      ),
    };
  }
  const account = accounts.find((a) => a.address.startsWith("bc1q")) ?? accounts[0]!;

  // ---- Parse PSBT + build sign inputs for Ledger BTC app --------------------
  // LiFi PSBT is verbatim — do NOT reconstruct. Parse for Ledger signing inputs.
  let signInputs: BtcPsbtSignInput[];
  let psbtBase64: string;
  try {
    const { Psbt: BtcPsbt } = await import("bitcoinjs-lib");
    const psbtBytes = Buffer.from(btcLifiTx.psbtHex, "hex");
    const psbt = BtcPsbt.fromBuffer(psbtBytes);
    psbtBase64 = psbtBytes.toString("base64");

    const placeholderPubkey = new Uint8Array(33);
    const PLACEHOLDER_MASTER_FP = new Uint8Array(4);

    signInputs = psbt.data.inputs.map((_, idx) => ({
      index: idx,
      scriptType: "p2wpkh" as const, // LiFi BTC bridge uses P2WPKH segwit inputs
      bip32Path: account.derivationPath,
      pubkey: placeholderPubkey,
      masterFingerprint: PLACEHOLDER_MASTER_FP,
    }));
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: LiFi PSBT parse failed: ${cause}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "LiFi PSBT parse failed", cause),
    };
  }

  // ---- Sign via Ledger Bitcoin app (USB-HID) ---------------------------------
  let rawTxHex: string;
  try {
    const result = await _btcLedgerTransport.signBtcPsbt(
      psbtBase64,
      signInputs,
      [], // no known address derivations for LiFi bridge PSBT change output
    );
    rawTxHex = result.rawTxHex;
  } catch (err) {
    if (err instanceof LedgerBtcDeviceNotConnectedError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope("LEDGER_NOT_CONNECTED", err.message),
      };
    }
    if (err instanceof LedgerBtcAppNotOpenError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope(
          "BTC_APP_NOT_OPEN",
          "Bitcoin app is not the active app on the Ledger. Open the Bitcoin app on the device and retry.",
        ),
      };
    }
    const cause = err instanceof Error ? err.message : String(err);
    if (/reject/i.test(cause)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: user rejected on Ledger device: ${cause}` }],
        structuredContent: errEnvelope("LEDGER_REJECTED", "user rejected on Ledger device", cause),
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `error: BTC LiFi Ledger signing failed: ${cause}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "BTC LiFi Ledger signing failed", cause),
    };
  }

  // ---- Broadcast via BTC Esplora POST /tx ------------------------------------
  const broadcastResult = await esploraBroadcastTx(rawTxHex);
  if (broadcastResult.kind !== "ok") {
    const cause = "message" in broadcastResult ? broadcastResult.message : String(broadcastResult);
    return {
      isError: true,
      content: [{ type: "text", text: `error: BTC LiFi broadcast failed: ${cause}` }],
      structuredContent: errEnvelope("BROADCAST_FAILED", "BTC LiFi broadcast failed", cause),
    };
  }

  // ---- Success — stamp handle, return txHash ----------------------------------
  const txHash = broadcastResult.txid;
  const trans = transitionToSent(handleArg, txHash);
  if (!trans.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: state transition failed after BTC LiFi broadcast: ${trans.errorCode}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        `state transition failed after BTC LiFi broadcast: ${trans.errorCode}`,
      ),
    };
  }
  const broadcastedAt = new Date().toISOString();
  return {
    content: [
      {
        type: "text",
        text: `broadcast OK (BTC LiFi bridge)\n  txHash: ${txHash}\n  broadcastedAt: ${broadcastedAt}\n\nView on mempool.space: https://mempool.space/tx/${txHash}`,
      },
    ],
    structuredContent: {
      txHash,
      broadcastedAt,
      handle: handleArg,
      txType: "btc-lifi" as const,
      toChain: btcLifiTx.toChain,
      toToken: btcLifiTx.toToken,
      toAddress: btcLifiTx.toAddress,
      vaultAddress: btcLifiTx.vaultAddress,
      // Phase 26 — BTC LiFi uses Esplora direct broadcast (no WC relay).
      sessionTopicLast8: null,
    },
  };
}

// ===========================================================================
// Phase 47 — Plan 47-04 — Bittensor (subtensor) branch (additive; lives
// OUTSIDE the FROZEN three-gate region above). Dispatched by the main handler
// when `record.tx.txType === "bittensor"`. All three FROZEN gates
// (PREVIEW_REQUIRED, WRONG_STATUS, PREVIEW_TOKEN_MISMATCH,
// PAYLOAD_FINGERPRINT_DRIFT — the latter recomputed over the STORED
// signableBlob) and the cancel branch fired identically before reaching here.
//
// Bittensor broadcast path (TAO-PREP-03 — RESEARCH §Pattern 2):
//   1. Demo-mode short-circuit (DEMO-05 mirror) — advisory dry-run envelope;
//      NOTHING signed; NOTHING broadcast.
//   2. Pairing check — persistent non-EVM account store (chainFilter: "bittensor").
//   3. Rebuild the SubmittableExtrinsic from the pinned `signerPayloadJSON.method`
//      (the SCALE call hex) via `api.tx(methodHex)` — byte-identical call.
//   4. Sign the STORED `signableBlob` via the Ledger Polkadot Generic app
//      (`signBittensorTransaction`) → detached 64-byte ed25519 signature. The
//      device signs the SAME bytes the fingerprint + presign bound (T-47-11).
//   5. Assemble: `sigHex = "0x00" + u8aToHex(signature).slice(2)`  ('0x00' =
//      MultiSignature::Ed25519 variant byte); `tx.addSignature(ss58Address,
//      sigHex, payload)` where `payload` is the pinned SignerPayloadJSON
//      (ExtrinsicPayloadValue form — A5 resolution below).
//   6. Broadcast via `api.rpc.author.submitExtrinsic(signedTx.toHex())`.
//   7. State transition via `transitionToSent(handle, extrinsicHash)`.
//
// A5 RESOLVED (addSignature payload-arg form): `addSignature`'s `payload` arg
// accepts `ExtrinsicPayloadValue | Uint8Array | HexString`. We pass the pinned
// `signerPayloadJSON` object (the `ExtrinsicPayloadValue` form) — it carries
// the exact era/nonce/tip/mode/metadataHash the `signableBlob` was built from,
// so `addSignature` re-derives the byte-identical signed envelope. The arg
// form is wrapped in a try/catch: if the object form throws (a future SDK
// shape change), fall back to the raw `signableBlob` hex (the `HexString` /
// `Uint8Array` form). FALSIFIER: a wrong form yields a `BadProof` rejection at
// broadcast — surfaced as BROADCAST_FAILED, never silently swallowed.
//
// NO private key material crosses this codebase — the device returns ONLY the
// detached signature; `addSignature` assembles; `submitExtrinsic` broadcasts.
// ===========================================================================

/** Defensive api surface — `tx(...)` rebuild, `addSignature`, `submitExtrinsic`. */
interface SubtensorSendApi {
  tx(extrinsic: string): {
    addSignature(
      signer: string,
      signature: string,
      payload: unknown,
    ): { toHex(): string };
  };
  rpc: {
    author: {
      submitExtrinsic(extrinsicHex: string): Promise<{ toHex(): string }>;
    };
  };
}

/**
 * Bittensor branch of `send_transaction`. Dispatched by the main handler when
 * `record.tx.txType === "bittensor"`. The three FROZEN gates and the cancel
 * branch fired identically before reaching this function.
 */
async function sendTransactionBittensorBranch(
  record: HandleRecord & { tx: PreparedTxBittensor },
  handleArg: string,
): Promise<ToolHandlerResult> {
  const taoTx = record.tx;

  // ---- Demo-mode short-circuit (DEMO-05 Bittensor mirror) ---------------
  if (isDemoMode()) {
    const persona = getActiveBittensorPersona();
    if (persona === null) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "error: demo mode is active but no Bittensor persona set. Call `set_demo_wallet` with a Bittensor persona slug first.",
          },
        ],
        structuredContent: errEnvelope(
          "WRONG_MODE",
          "demo mode active but no Bittensor persona set; call set_demo_wallet first",
        ),
      };
    }
    const simulatedAt = new Date().toISOString();
    const text = [
      "SIMULATION (Bittensor — demo mode)",
      `  call:   ${taoTx.section}.${taoTx.method}`,
      `  signer: ${persona.ss58Address}`,
      "  (no signature requested; no broadcast performed)",
    ].join("\n");
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        simulated: true,
        demoMode: true,
        simulatedAt,
        handle: handleArg,
        txType: "bittensor" as const,
        section: taoTx.section,
        method: taoTx.method,
      },
    };
  }

  // ---- Pairing check (Bittensor — persistent non-EVM account store) -----
  const accounts = listAccounts({ chainFilter: "bittensor" });
  if (accounts.length === 0 || !accounts[0]) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "error: no paired Bittensor account. Call `pair_bittensor_ledger` first to pair your Bittensor Ledger coldkey, then retry.",
        },
      ],
      structuredContent: errEnvelope(
        "WALLET_NOT_PAIRED",
        "no paired Bittensor account; call pair_bittensor_ledger first",
      ),
    };
  }
  const account = accounts[0];

  // ---- Resolve api + rebuild the SubmittableExtrinsic from the pinned call -
  // The pinned `signerPayloadJSON.method` is the SCALE call hex; `api.tx(hex)`
  // rebuilds the byte-identical SubmittableExtrinsic (no re-fetch of nonce/era
  // — those live in the pinned payload, supplied to addSignature below).
  const payloadJSON = taoTx.signerPayloadJSON as { method?: unknown } | null;
  const methodHex =
    payloadJSON && typeof payloadJSON.method === "string"
      ? payloadJSON.method
      : null;
  if (methodHex === null) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "error: prepared Bittensor handle is missing the pinned call hex; re-run the prepare tool.",
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "prepared Bittensor handle missing pinned call hex",
      ),
    };
  }

  let api: SubtensorSendApi;
  try {
    api = (await _bittensorRegistry.getApi()) as unknown as SubtensorSendApi;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: subtensor RPC unavailable: ${cause}` },
      ],
      structuredContent: errEnvelope(
        "BROADCAST_FAILED",
        "subtensor RPC unavailable",
        cause,
      ),
    };
  }

  // ---- Sign the STORED signableBlob on the Ledger (USB-HID, per-call) ---
  // CRITICAL (T-47-11): the device signs `taoTx.signableBlob` VERBATIM — the
  // SAME bytes the fingerprint (re-checked above) + the blake2-256 presign
  // bound. mode:0 (CheckMetadataHash disabled) → no metadata digest is needed;
  // pass an empty txMetadata (the device clear-signs the raw blob).
  const txMetadata =
    taoTx.mode === 1 && taoTx.metadataHash !== null
      ? new Uint8Array(Buffer.from(taoTx.metadataHash.replace(/^0x/, ""), "hex"))
      : new Uint8Array(0);
  let signature: Buffer;
  try {
    const result = await signBittensorTransaction({
      signableBlob: taoTx.signableBlob,
      txMetadata,
      derivationPath: account.derivationPath,
    });
    signature = result.signature;
  } catch (err) {
    if (err instanceof LedgerDeviceNotConnectedError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope("LEDGER_NOT_CONNECTED", err.message),
      };
    }
    if (err instanceof LedgerBittensorAppNotOpenError) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${err.message}` }],
        structuredContent: errEnvelope(
          "LEDGER_REJECTED",
          "Polkadot Generic app not open. Open it on the device and retry.",
          err.message,
        ),
      };
    }
    if (err instanceof LedgerBittensorUserRejectedError) {
      return {
        isError: true,
        content: [
          { type: "text", text: `error: ${err.message}` },
        ],
        structuredContent: errEnvelope(
          "LEDGER_REJECTED",
          "user rejected on Ledger device",
          err.message,
        ),
      };
    }
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: Bittensor Ledger signing failed: ${cause}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "Bittensor Ledger signing failed",
        cause,
      ),
    };
  }

  // Defensive: the device must return a 64-byte ed25519 signature.
  if (signature.length !== 64) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: expected a 64-byte ed25519 signature from the device, got ${signature.length} bytes`,
        },
      ],
      structuredContent: errEnvelope(
        "LEDGER_REJECTED",
        `expected a 64-byte ed25519 signature, got ${signature.length} bytes`,
      ),
    };
  }

  // ---- Assemble the signed extrinsic ------------------------------------
  // '0x00' = MultiSignature::Ed25519 variant byte; the 64-byte sig follows
  // → 65-byte MultiSignature. The pinned SignerPayloadJSON is the
  // ExtrinsicPayloadValue `payload` arg (A5 — carries the exact
  // era/nonce/tip/mode the blob was built from).
  const sigHex = "0x00" + u8aToHex(signature).slice(2);
  let signedHex: string;
  try {
    const tx = api.tx(methodHex);
    let signedTx: { toHex(): string };
    try {
      signedTx = tx.addSignature(taoTx.ss58Address, sigHex, taoTx.signerPayloadJSON);
    } catch {
      // A5 fallback — if the ExtrinsicPayloadValue object form throws, use the
      // raw signable-blob bytes (the Uint8Array / HexString accepted form).
      signedTx = tx.addSignature(taoTx.ss58Address, sigHex, taoTx.signableBlob);
    }
    signedHex = signedTx.toHex();
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: failed to assemble the signed extrinsic: ${cause}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "failed to assemble the signed Bittensor extrinsic",
        cause,
      ),
    };
  }

  // ---- Broadcast via author.submitExtrinsic -----------------------------
  let extrinsicHash: string;
  try {
    const hashCodec = await api.rpc.author.submitExtrinsic(signedHex);
    extrinsicHash = hashCodec.toHex();
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: subtensor broadcast failed: ${cause}` },
      ],
      structuredContent: errEnvelope(
        "BROADCAST_FAILED",
        "subtensor broadcast failed",
        cause,
      ),
    };
  }

  // ---- State transition + return ----------------------------------------
  const trans = transitionToSent(handleArg, extrinsicHash);
  if (!trans.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: state transition failed after broadcast: ${trans.errorCode}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        `state transition failed after broadcast: ${trans.errorCode}`,
      ),
    };
  }
  const broadcastedAt = new Date().toISOString();
  return {
    content: [
      {
        type: "text",
        text: `broadcast OK (Bittensor)\n  extrinsicHash: ${extrinsicHash}\n  call: ${taoTx.section}.${taoTx.method}\n  broadcastedAt: ${broadcastedAt}\n\nView on Taostats: https://taostats.io/extrinsic/${extrinsicHash}`,
      },
    ],
    structuredContent: {
      // API symmetry — existing agent prompts + tests read `txHash`. Carries
      // the extrinsic hash (the Substrate identifier; the field is string-
      // widened for non-EVM identifiers).
      txHash: extrinsicHash,
      extrinsicHash,
      broadcastedAt,
      handle: handleArg,
      txType: "bittensor" as const,
      section: taoTx.section,
      method: taoTx.method,
      // Phase 47 — no WC session topic for Bittensor (USB-HID bypasses WC).
      sessionTopicLast8: null,
    },
  };
}
