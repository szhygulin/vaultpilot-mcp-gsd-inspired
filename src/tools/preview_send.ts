// MCP tool: preview_send({ handle })
//
// Second step of the Phase 4 trust pipeline (PREP-04 / PREP-05 / PREP-06).
// Reads a prepared handle, resolves and pins nonce / gas / EIP-1559 fees AT
// PREVIEW TIME (research § Anti-Patterns line 416 — pinning at prepare time
// would widen the staleness window the user is asked to approve), recomputes
// the EIP-1559 pre-sign hash via Plan 04-01's pure `computePresignHash`,
// mints a fresh UUID `previewToken`, calls Plan 04-05's `lookupSelector` for
// the 4byte cross-check, and emits four plain-text blocks:
//
//   LEDGER BLIND-SIGN HASH   — full hex + chunked hex (A1 mitigation)
//   [AGENT TASK — ...]       — the four local checks the agent runs (PREP-05)
//   4BYTE CROSS-CHECK        — verbatim selector decode (PREP-06)
//   VERIFY BEFORE SIGNING    — user-facing pre-confirm summary
//
// Three non-negotiable invariants asserted by `test/preview-send.test.ts`:
//
//   1. **SENDER address from `getStatus().address`** (real mode) OR
//      `getActivePersona().address` (demo mode per Q-CONTRADICTION-PREP
//      Option B / Plan 05-02). `getTransactionCount` reads the SENDER's
//      nonce, NOT `tx.to`'s nonce. Research § Code Example 3 line 666 names
//      this explicitly as the anti-foot-gun. Test 1 asserts the mock spy is
//      called with the paired address from `getStatus()`; Plan 05-02 demo
//      test asserts it is called with the persona's address. Under matched
//      RPC pins, Fixture C `0xb28e4824...` holds across both modes (the
//      cryptographic-binding chain regression value).
//
//   2. **`presignHash` matches Fixture C byte-for-byte** (T-PRESIGN-1) — for
//      the documented inputs (chainId 1, nonce 7, gas 21000, maxFeePerGas
//      30 gwei, maxPriorityFeePerGas 1.5 gwei, value 1 ETH, data "0x",
//      to 0x70997970…), the keccak is
//      `0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85`.
//      Test 2 asserts byte-identity. If the device displays a different
//      hash the user's verification ritual is meaningless — this is the
//      load-bearing anchor.
//
//   3. **Idempotent re-preview (Q4 locked decision)** — a second call on
//      an already-`previewed` handle re-resolves fresh nonce/gas/fees,
//      re-pins via `transitionToPreviewed` (which OVERWRITES per Plan
//      04-01), and mints a FRESH `previewToken`. The PRIOR token is no
//      longer valid; only `record.pinned.previewToken` matches at send
//      time (Plan 04-04's send-time check). Rationale: gas/nonce/fees go
//      stale over minutes; re-prepare would change the
//      `payloadFingerprint` and break the trust binding, but re-preview
//      keeps the binding while freshening the pin.
//
// The 4byte block is rendered via `build4byteBlock` imported from
// `src/signing/blocks.ts` (Plan 04-05) — NOT inlined here. Format-fanout-
// sentinel: one helper, one home.

import { erc20Abi, type Address, type Hex } from "viem";
import { estimateFeesPerGas, estimateGas, getTransactionCount } from "viem/actions";
import { Message, Transaction } from "@solana/web3.js";
import { Transaction as BtcTransaction } from "bitcoinjs-lib";

import { _compoundChains } from "../chains/compound-v3.js";
import { getChainClient } from "../chains/registry.js";
import { _solanaRegistry } from "../chains/solana/registry.js";
import { _tronRegistry } from "../chains/tron/registry.js";
import { lookupSelector } from "../clients/fourbyte.js";
import {
  chainIdFromName,
  chainNameFromId,
  getAaveV3PoolAddress,
  getAllCompoundCometsForChain,
  getWethAddress,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona } from "../demo/state.js";
import { _aaveProtocols, type AaveV3Decoded } from "../protocols/aave-v3.js";
import {
  _compoundProtocols,
  COMPOUND_V3_SELECTORS,
  type CompoundV3Decoded,
} from "../protocols/compound-v3.js";
import { _protocols, type Erc20Decoded } from "../protocols/erc20.js";
import { _solanaSpl } from "../protocols/solana-spl.js";
import { _solanaSystem } from "../protocols/solana-system.js";
import { _tronStake } from "../protocols/tron-stake.js";
import { WETH9_SELECTORS } from "../protocols/weth9.js";
import { _canonicalDispatch } from "../security/canonical-dispatch.js";
import { _canonicalDispatchSolana } from "../security/canonical-dispatch-solana.js";
import { SUNSWAP_V2_ROUTER_TRON_ADDRESS, _canonicalDispatchTron } from "../security/canonical-dispatch-tron.js";
import {
  AGENT_TASK_TEMPLATE,
  CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE,
  DISPATCH_TARGET_REFUSAL_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TEMPLATE,
  LEDGER_NOTICE_COMPOUND_TEMPLATE,
  LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TEMPLATE,
  build4byteBlock,
  buildAaveDecodedArgsBlock,
  buildCompoundDecodedArgsBlock,
  buildDecodedArgsBlock,
  buildSimulationBlock,
  chunkHex,
} from "../signing/blocks.js";
import "../chains/bitcoin/types.js"; // ensure initEccLib(tinySecp256k1) fires
import {
  LEDGER_BLIND_SIGN_HASH_BTC_TEMPLATE,
  INPUT_SIGHASH_ROW_BTC_TEMPLATE,
  PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE,
  INPUT_ROW_BTC_TEMPLATE,
  OUTPUT_ROW_BTC_TEMPLATE,
} from "../signing/blocks-btc.js";
import { _btcFingerprint } from "../signing/btc-fingerprint.js";
import { _btcSighash } from "../signing/btc-sighash.js";
import {
  LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE,
  PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE,
  PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE,
  SIMULATION_BLOCK_SOLANA_TEMPLATE,
  VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE,
} from "../signing/blocks-solana.js";
import {
  KNOWN_SPENDER_LABEL_TRON_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE,
  LEDGER_NOTICE_TRON_TEMPLATE,
  NO_SIMULATION_AVAILABLE_TRON_TEMPLATE,
  PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE,
  PREPARE_RECEIPT_TRON_CLAIM_REWARDS_TEMPLATE,
  PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE,
  PREPARE_RECEIPT_TRON_STAKE_FREEZE_TEMPLATE,
  PREPARE_RECEIPT_TRON_STAKE_UNFREEZE_TEMPLATE,
  PREPARE_RECEIPT_TRON_SUNSWAP_TEMPLATE,
  PREPARE_RECEIPT_TRON_VOTE_TEMPLATE,
  PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE,
  PREPARE_RECEIPT_TRON_TRC20_TEMPLATE,
  REWARD_ESTIMATE_TRON_TEMPLATE,
  SIMULATION_BLOCK_TRON_TEMPLATE,
  SR_LABEL_TRON_TEMPLATE,
  STAKE_RESOURCE_TRON_TEMPLATE,
  STAKE_WAITING_PERIOD_TRON_TEMPLATE,
  UNLIMITED_APPROVAL_TRON_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
  WITHDRAWABLE_BALANCE_TRON_TEMPLATE,
} from "../signing/blocks-tron.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  lookup,
  transitionToPreviewed,
  type HandleRecord,
  type PreparedTxBtc,
  type PreparedTxSolana,
  type PreparedTxTron,
  type SolanaInstructionSummary,
} from "../signing/handle-store.js";
import { _tronPresign } from "../signing/presign-hash-tron.js";
import { _solanaPresign } from "../signing/presign-hash-solana.js";
import { computePresignHash } from "../signing/presign-hash.js";
import { _simulationSolana } from "../signing/simulation-solana.js";
import { _simulationTron, type TronSimulationResult } from "../signing/simulation-tron.js";
import { _simulation } from "../signing/simulation.js";
import { loadTokenRegistry } from "../tokens/registry.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

// `ToolHandlerResult.structuredContent` is typed as
// `Record<string, unknown>`; Plan 04-01's `StructuredError` is an explicit
// interface without an index signature. Cast at the boundary so
// `makeStructuredError(...)` stays the canonical envelope constructor
// without modifying Phase 1's tool-handler contract OR Plan 04-01's error-
// codes module. Same wrapper shape Plan 04-02's `prepare_native_send` uses.
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}

const DESCRIPTION = [
  "Resolve and pin nonce + gas + EIP-1559 fees onto a prepared handle; recompute the EIP-1559 pre-sign hash; emit the LEDGER BLIND-SIGN HASH + AGENT TASK + 4byte cross-check blocks.",
  "Use AFTER prepare_native_send (or any other prepare_* tool) and BEFORE send_transaction. The handle returned by prepare_* must be passed here verbatim.",
  'Relay the EXPECTED LEDGER DEVICE DISPLAY block to the user verbatim, then perform the agent-side checks in the AGENT TASK block; emit a `CHECKS PERFORMED (pre-send, by agent)` block before asking the user to confirm send. The on-device hash comparison happens AFTER send_transaction fires — the device screen is dark at preview time.',
  'Do NOT instruct the user to "open Ledger Live" or to navigate any UI to view the hash at preview time. The device prompt fires automatically once send_transaction transmits the WalletConnect request; until then the device is dark and there is nothing on its screen to compare against. The user\'s on-device comparison is step 5 of the 6-step sequence the block describes — post-send, on the device itself, not in Ledger Live.',
  "Do NOT skip preview_send and call send_transaction directly — send_transaction's schema-level gate refuses without a valid previewToken (which only this tool mints).",
  "Returns `{ previewToken, presignHash, chainId, nonce, gas, maxFeePerGas, maxPriorityFeePerGas, selector, fourbyte }` plus the three-block text payload (EXPECTED LEDGER DEVICE DISPLAY, AGENT TASK, 4BYTE CROSS-CHECK) and a VERIFY BEFORE SIGNING summary.",
  "Idempotent re-preview (Q4): calling preview_send twice on the same handle re-pins fresh nonce/gas/fees and INVALIDATES the prior previewToken. Only the most recent token matches at send time — call again after a long pause to freshen the pin.",
  "In demo mode, succeeds against the active persona's address as the SENDER for nonce/gas/fees resolution; the EXPECTED LEDGER DEVICE DISPLAY block is emitted unchanged so the rehearsal teaches the same temporal sequence the real flow uses.",
  "Optional `chain` arg (Phase 8 — Plan 08-02 Layer 2 defense-in-depth): when provided, the server asserts `chainIdFromName(chain) === record.tx.chainId` BEFORE the existing three gates; mismatch refuses with CHAIN_ID_MISMATCH. Omitting falls back to Layer 3 fingerprint-drift + Layer 4 on-device Network display as the sole chain-consistency defense.",
  "Failure modes: HANDLE_NOT_FOUND if the handle is unknown, HANDLE_EXPIRED past 15-min TTL, WRONG_STATUS on already-sent or cancelled handles, WALLET_NOT_PAIRED if the WalletConnect session has dropped (real mode), WRONG_MODE if demo mode is on but no persona is set, CHAIN_ID_MISMATCH if the optional `chain` arg disagrees with the prepared handle's chainId.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    handle: {
      type: "string",
      description: "Handle returned by prepare_native_send (or any other prepare_* tool).",
    },
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "Optional defense-in-depth chain assertion. When provided, refuses if the stored handle's chainId does not match.",
    },
  },
  required: ["handle"],
  additionalProperties: false,
};

registerTool("preview_send", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const handleArg = typeof args.handle === "string" ? args.handle : "";

    // Lookup the handle. `HANDLE_NOT_FOUND` and `HANDLE_EXPIRED` (15-min
    // TTL via lazy eviction) are the two failure modes — surface both
    // unchanged from Plan 04-01's typed return.
    const lookupResult = lookup(handleArg);
    if (!lookupResult.ok) {
      const message =
        lookupResult.errorCode === "HANDLE_NOT_FOUND"
          ? "error: handle not found; call prepare_native_send first to mint a handle"
          : "error: handle expired (>15min from prepare); call prepare_native_send to mint a fresh handle";
      return {
        isError: true,
        content: [{ type: "text", text: message }],
        structuredContent: errEnvelope(lookupResult.errorCode, message.replace(/^error: /, "")),
      };
    }
    const record = lookupResult.record;

    // Phase 12 — Plan 12-04 — dispatch on txType discriminator. EVM branch
    // (the Phase 4-9 byte-identical FROZEN region below) handles every
    // existing handle (txType absent OR "evm"). Solana branch routes to the
    // sibling pipeline (Layer 0.5 canonical-dispatch-solana + Layer 0.7
    // mandatory simulation gate per DF-4). The discriminator-dispatch block
    // here is the ONLY edit inside the FROZEN region; extracted Solana
    // branch lives at the bottom of this file.
    const txType = record.tx.txType ?? "evm";
    if (txType === "solana") {
      return await previewSendSolanaBranch(record);
    }
    if (txType === "tron") {
      return await previewSendTronBranch(record as HandleRecord & { tx: PreparedTxTron });
    }
    if (txType === "btc") {
      return await previewSendBtcBranch(record as HandleRecord & { tx: PreparedTxBtc });
    }

    // Phase 9 — Plan 09-04. Layer 0.5 outer dispatch-target allowlist
    // refusal (SEC-35). Fires AFTER handle lookup (needs record.tx.chainId
    // + record.tx.to) and BEFORE the Phase 8 Layer 2 chain-name MISMATCH
    // check below. Only applies to contract calls (data !== "0x"); native
    // sends bypass — any `to` is valid for a value transfer per RESEARCH
    // § Topic 6 lines 539-541 lock.
    //
    // The escape hatch (v2.4 prepare_custom_call with
    // acknowledgeNonProtocolTarget: true) is OUT OF SCOPE for v1.3 —
    // protocol-routed prepare_* tools only. Long-tail tokens NOT in
    // BRIDGED_VARIANTS hit the refusal; user routes via resolve_token /
    // get_token_metadata to find the canonical address (which lives in
    // BRIDGED_VARIANTS by design).
    //
    // Layer order rationale: dispatch-target is a SECURITY GATE — must
    // fire first. Chain-mismatch (Layer 2 below) is a STATE CONSISTENCY
    // check. A refusal that triggers BOTH surfaces DISPATCH_TARGET_REFUSED
    // (the more fundamental issue) — per RESEARCH § Topic 10 layer table.
    if (record.tx.data !== "0x") {
      const dispatchCheck = _canonicalDispatch.checkDispatchTarget(
        record.tx.chainId as ChainId,
        record.tx.to,
      );
      if (dispatchCheck.kind === "refused") {
        const chainLabel = `${chainNameFromId(
          record.tx.chainId as ChainId,
        )} (chainId ${record.tx.chainId})`;
        const refusalText = DISPATCH_TARGET_REFUSAL_TEMPLATE
          .replace("{CHAIN}", chainLabel)
          .replace("{TO}", dispatchCheck.to)
          .replace("{ALLOWLIST}", dispatchCheck.allowlist.join("\n    "));
        return {
          isError: true,
          content: [{ type: "text", text: refusalText }],
          structuredContent: errEnvelope(
            "DISPATCH_TARGET_REFUSED",
            `tx.to ${dispatchCheck.to} is not in the v1.3 canonical dispatch allowlist for chain ${record.tx.chainId}`,
          ),
        };
      }
    }

    // Phase 8 — Plan 08-02. Layer 2 defense-in-depth chain-name MISMATCH
    // refusal. Fires AFTER handle lookup (needs record.tx.chainId) but
    // BEFORE the state-machine + fingerprint-drift gates, so a wrong-chain
    // claim refuses with a chain-specific error instead of cascading into
    // an unrelated state-machine refusal. Layer 3 (payloadFingerprint
    // drift in send_transaction) already byte-binds chainId; this Layer 2
    // catches the case where the agent's natural-language story ("this is
    // an Ethereum tx") diverges from the bytes ("record.tx.chainId === 137")
    // at preview time, so the user sees a structured refusal instead of an
    // on-device Network mismatch surprise.
    //
    // GUARD: only fires when `args.chain` is provided (back-compat — Phase
    // 4-7 callers don't pass it). The JSON-schema enum at the dispatch
    // boundary already refuses bogus chain names; runtime-side this check
    // narrows via `chainIdFromName(... as ChainName)`.
    if (typeof args.chain === "string") {
      const claimedChainName = args.chain as ChainName;
      const claimedChainId = chainIdFromName(claimedChainName);
      if (claimedChainId !== record.tx.chainId) {
        const storedChainName = chainNameFromId(record.tx.chainId as ChainId);
        const refusalText = CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE
          .replace("{REQUESTED_CHAIN}", `${claimedChainName} (chainId ${claimedChainId})`)
          .replace("{STORED_CHAIN}", storedChainName)
          .replace("{STORED_CHAIN_ID}", String(record.tx.chainId));
        return {
          isError: true,
          content: [{ type: "text", text: refusalText }],
          structuredContent: errEnvelope(
            "CHAIN_ID_MISMATCH",
            `preview chain="${claimedChainName}" but handle prepared for chainId=${record.tx.chainId}`,
          ),
        };
      }
    }

    // T-STATE-3: refuse re-preview on a `sent` or `cancelled` handle.
    // `transitionToPreviewed` would return `WRONG_STATUS` for these states
    // anyway, but checking here short-circuits the viem reads (cheaper +
    // gives a clearer error).
    if (record.status === "sent" || record.status === "cancelled") {
      const text = `error: handle is in status "${record.status}"; preview_send only legal from "prepared" or "previewed"`;
      return {
        isError: true,
        content: [{ type: "text", text }],
        structuredContent: errEnvelope(
          "WRONG_STATUS",
          `handle in status ${record.status}; cannot re-preview`,
        ),
      };
    }

    // SENDER resolution (Plan 05-02 / Q-CONTRADICTION-PREP Option B):
    // In demo mode, the active persona's address is the SENDER for
    // `getTransactionCount` + `estimateGas`; in real mode, the paired
    // Ledger's address is the SENDER. T-DEMO-1 + T-NULL-PERSONA-1
    // mitigation: demo branch SKIPS `getStatus()` (no WC pairing in demo)
    // so the `getStatus` spy observes zero calls in the demo arm.
    //
    // T-PIN-1 / T-FROM-1: SENDER is NEVER `record.tx.to`. Research §
    // Code Example 3 line 666 explicit anti-foot-gun: a contributor who
    // reads `tx.to` would compute the recipient's nonce, not the sender's
    // — leading to a transaction the network would reject. Test 1 asserts
    // the address passed to `getTransactionCount` matches the resolved
    // sender; Plan 05-02 demo test asserts the same against persona.
    let senderAddress: Address;
    // Plan 09-05 (SEC-36) — captured here so the success-path structuredContent
    // can surface `sessionTopicLast8` for user cross-check against Ledger Live
    // → Settings → Connected Apps. `null` in demo mode (no WC session) and
    // unreachable on the WALLET_NOT_PAIRED refusal path (which short-circuits
    // above before this assignment fires).
    let sessionTopicLast8: string | null = null;
    if (isDemoMode()) {
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
      senderAddress = persona.address;
    } else {
      // T-PAIR-1 defense-in-depth: confirm pairing AT PREVIEW TIME. The
      // session may have dropped between prepare and preview (Ledger app
      // closed, Live disconnected, WC relay timeout). Surface as
      // WALLET_NOT_PAIRED — the user re-pairs and re-calls preview_send.
      const status = await getStatus();
      if (status === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: no live Ledger session. Call `pair_ledger_live` to re-pair via WalletConnect, then retry preview_send.",
            },
          ],
          structuredContent: errEnvelope(
            "WALLET_NOT_PAIRED",
            "no live Ledger session at preview time",
          ),
        };
      }
      senderAddress = status.activeAccount;
      sessionTopicLast8 = status.sessionTopicLast8;
    }

    // Resolve nonce / fees / gas concurrently. Pin AT PREVIEW TIME
    // (research § Anti-Patterns line 416). RPC errors here are
    // operational — surface as `INTERNAL_ERROR` with the underlying
    // message; the user retries.
    //
    // Phase 8 — Plan 08-02: per-chain client. The handle's bound chainId
    // (cryptographically pinned via payloadFingerprint Layer 3) drives the
    // RPC target; an attacker who flips `record.tx.chainId` post-prepare
    // would also break the recomputed fingerprint at send time.
    const client = getChainClient(record.tx.chainId as ChainId);
    let pendingNonce: number;
    let fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
    let gasEstimate: bigint;
    try {
      [pendingNonce, fees, gasEstimate] = await Promise.all([
        getTransactionCount(client, { address: senderAddress, blockTag: "pending" }),
        // `chain: null` defers to the client's configured chain (mainnet
        // per src/chains/ethereum.ts). viem 2.48's `PublicClient` generic
        // is `chain extends Chain | undefined`, which forces an explicit
        // `chain` param when the function-level chain inference can't
        // narrow — passing null is the canonical "use client's chain"
        // signal (research § Code Example 3 line 666).
        estimateFeesPerGas(client, { type: "eip1559", chain: null }),
        estimateGas(client, {
          account: senderAddress,
          to: record.tx.to,
          value: record.tx.valueWei,
          data: record.tx.data,
        }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          { type: "text", text: `error: RPC pin failed: ${message}` },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "RPC pin (nonce/fees/gas) failed",
          message,
        ),
      };
    }

    // Selector = first 4 bytes of data (8 hex chars + "0x" prefix).
    // Native sends have `data === "0x"` → `selector === null`, and the
    // 4byte block shows "not-applicable" verbatim.
    const selector: Hex | null =
      record.tx.data === "0x" ? null : (record.tx.data.slice(0, 10) as Hex);

    // Idempotent re-preview per locked decision Q4 (research § Open Questions).
    // Rationale: gas/nonce/fees go stale over time. If the user pauses 10 min
    // after reading the LEDGER BLIND-SIGN HASH, the agent can call preview_send
    // again to freshen the pin without forcing a re-prepare (which would
    // change the payloadFingerprint and break the trust binding).
    // Caveat: a fresh previewToken INVALIDATES the prior one. The handle's
    // pinned state is the SOT — only the most-recently-minted token matches
    // at send time (Plan 04-04's PREVIEW_TOKEN_MISMATCH gate).
    const previewToken = crypto.randomUUID();

    const { presignHash } = computePresignHash({
      chainId: record.tx.chainId,
      nonce: pendingNonce,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      maxFeePerGas: fees.maxFeePerGas,
      gas: gasEstimate,
      to: record.tx.to,
      value: record.tx.valueWei,
      data: record.tx.data,
    });

    // Pin onto handle. `transitionToPreviewed` overwrites `record.pinned`
    // on re-preview (Plan 04-01 invariant — last-write wins). `WRONG_STATUS`
    // here is theoretically reachable as a race (handle TTL'd or was
    // transitioned to sent between our lookup and our transition); surface
    // as the underlying errorCode.
    const trans = transitionToPreviewed(handleArg, {
      nonce: pendingNonce,
      gas: gasEstimate,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      previewToken,
      presignHash,
      selector,
    });
    if (!trans.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: handle state changed during preview (${trans.errorCode})`,
          },
        ],
        structuredContent: errEnvelope(
          trans.errorCode,
          `handle transition failed: ${trans.errorCode}`,
        ),
      };
    }

    // PREP-06: best-effort 4byte cross-check. NEVER throws (Plan 04-05's
    // contract — errors return as `{ kind: "error", message: <verbatim> }`).
    // Verbatim upstream error message ships through to the cross-check
    // block; the user sees the failure mode, not a fake "no match".
    const fourbyte = await lookupSelector(selector);

    // Phase 6 — Plan 06-02: selector-routed ABI decode for the DECODED ARGS
    // block. `decodeErc20Call` returns a discriminated union; the unknown
    // branch fires for native sends (data === "0x") AND for unrecognized
    // selectors. T-DECODE-LIE-1 mitigation: viem's `decodeFunctionData` is
    // ABI-driven (the on-chain function signature hash is SOT — never trusts
    // the agent). _protocols indirection for ESM spy-affordance.
    const decodedArgs: Erc20Decoded = _protocols.decodeErc20Call(record.tx.data);

    // Phase 7 — Plan 07-03 + Phase 28 — Plan 28-04: THREE-tier selector
    // dispatch. If the ERC-20 decoder returned `kind: "unknown"`, try the Aave
    // V3 decoder; if Aave also returns unknown, try the Compound V3 decoder.
    // ERC-20 selectors (transfer / approve / WETH9.withdraw) take precedence
    // — the ABI dispatch tables are disjoint, so a clean fall-through is
    // sufficient.
    let aaveDecoded: AaveV3Decoded | null = null;
    let compoundDecoded: Exclude<CompoundV3Decoded, { kind: "unknown" }> | null = null;
    if (decodedArgs.kind === "unknown") {
      const aave = _aaveProtocols.decodeAaveV3Call(record.tx.data);
      if (aave.kind !== "unknown") {
        aaveDecoded = aave;
      } else {
        const compound = _compoundProtocols.decodeCompoundV3Call(record.tx.data);
        if (compound.kind !== "unknown") compoundDecoded = compound;
      }
    }

    // Resolve token-decimals context for the DECODED ARGS block. Two paths:
    //
    //   - ERC-20 (transfer / approve): `record.tx.to` is the TOKEN CONTRACT
    //     (NOT the recipient) — the registry lookup is against that.
    //   - Aave (supply / withdraw): the asset address lives on
    //     `aaveDecoded.asset` (record.tx.to is the Pool address — looking it
    //     up in the token registry would mask the actual asset and produce
    //     "off-list token" for every Aave call). T-AAVE-TX-TO-CONFUSION-1
    //     mitigation: explicit `decoded.asset` lookup. Long-tail Aave reserves
    //     (not in the top-50 registry) fall back to live RPC for
    //     `decimals()` + `symbol()` — failure leaves tokenContext null and the
    //     block surfaces an "(unknown asset)" label verbatim.
    let tokenContext: { symbol: string; decimals: number } | null = null;
    if (aaveDecoded !== null) {
      const registry = loadTokenRegistry(record.tx.chainId as ChainId);
      const entry = registry.find((e) => e.address === aaveDecoded!.asset);
      tokenContext = entry ? { symbol: entry.symbol, decimals: entry.decimals } : null;
      if (tokenContext === null) {
        try {
          const [d, sym] = await Promise.all([
            client.readContract({
              address: aaveDecoded.asset,
              abi: erc20Abi,
              functionName: "decimals",
            }),
            client.readContract({
              address: aaveDecoded.asset,
              abi: erc20Abi,
              functionName: "symbol",
            }),
          ]);
          tokenContext = { decimals: Number(d), symbol: String(sym) };
        } catch {
          // Best-effort. tokenContext stays null.
        }
      }
    } else if (compoundDecoded !== null) {
      // Phase 28 Plan 28-04: T-COMPOUND-TX-TO-CONFUSION-1 mitigation. Token
      // context resolves against `compoundDecoded.asset` — NOT `record.tx.to`
      // (the Comet contract). Registry-first; RPC fallback for long-tail
      // assets that aren't in the top-50 registry.
      const registry = loadTokenRegistry(record.tx.chainId as ChainId);
      const entry = registry.find((e) => e.address === compoundDecoded!.asset);
      tokenContext = entry ? { symbol: entry.symbol, decimals: entry.decimals } : null;
      if (tokenContext === null) {
        try {
          const [d, sym] = await Promise.all([
            client.readContract({
              address: compoundDecoded.asset,
              abi: erc20Abi,
              functionName: "decimals",
            }),
            client.readContract({
              address: compoundDecoded.asset,
              abi: erc20Abi,
              functionName: "symbol",
            }),
          ]);
          tokenContext = { decimals: Number(d), symbol: String(sym) };
        } catch {
          // Best-effort. tokenContext stays null.
        }
      }
    } else if (decodedArgs.kind === "transfer" || decodedArgs.kind === "approve") {
      const registry = loadTokenRegistry(record.tx.chainId as ChainId);
      const entry = registry.find((e) => e.address === record.tx.to);
      tokenContext = entry
        ? { symbol: entry.symbol, decimals: entry.decimals }
        : null;
    }

    // Phase 28 Plan 28-04 — preview-time intent re-derivation (defense-in-
    // depth). The same `deriveIntent` helper Plans 28-02 + 28-03 consume at
    // prepare time runs again at preview time. If the on-chain state has
    // drifted between prepare and preview (e.g. debt was repaid by a separate
    // tx in the gap), the re-derivation labels the new reality. The user
    // signing on the device sees the actual operation regardless of what label
    // the agent claimed at prepare time.
    //
    // Surfaces in the DECODED ARGS block as the `intent:` line. Best-effort —
    // RPC failure during re-derivation falls back to the raw selector label
    // (compound-supply / compound-withdraw) rather than refusing.
    let compoundIntentLabel: string = "";
    if (compoundDecoded !== null) {
      const selector =
        compoundDecoded.kind === "compound-supply" ? "supply" : "withdraw";
      try {
        compoundIntentLabel = await _compoundChains.deriveIntent(
          client,
          record.tx.to,
          senderAddress,
          selector,
          compoundDecoded.asset,
        );
      } catch {
        // RPC failure — surface the raw selector kind so the user sees
        // something rather than a missing line. Defensive only; the LEDGER
        // BLIND-SIGN HASH match remains the trust anchor.
        compoundIntentLabel =
          compoundDecoded.kind === "compound-supply" ? "supply-collateral?" : "withdraw-collateral?";
      }
    }

    // Decoded-args block selection — the Aave path uses a parallel helper, the
    // Compound path uses ITS parallel helper (separate from ERC-20 + Aave to
    // keep all three byte-frozen against template drift).
    const decodedArgsBlock =
      aaveDecoded !== null
        ? buildAaveDecodedArgsBlock(
            aaveDecoded,
            tokenContext,
            getAaveV3PoolAddress(record.tx.chainId as ChainId),
          )
        : compoundDecoded !== null
          ? buildCompoundDecodedArgsBlock(
              compoundDecoded,
              tokenContext,
              record.tx.to,
              compoundIntentLabel,
            )
          : buildDecodedArgsBlock(decodedArgs, tokenContext, record.tx.to);

    // Phase 6 — Plan 06-02: wide eth_call simulation. DF-1 LOCKED. Runs for
    // ALL tx shapes including native sends (defense-in-depth uniform per
    // research § Topic 9). _simulation indirection for ESM spy-affordance.
    // T-SIMULATION-RPC-FAIL-1 mitigation: runPreviewSimulation NEVER throws —
    // RPC failures demote to `status: "error"` and remain non-blocking.
    const simulationResult = await _simulation.runPreviewSimulation({
      client,
      sender: senderAddress,
      tx: { to: record.tx.to, valueWei: record.tx.valueWei, data: record.tx.data },
    });
    const simulationBlock = buildSimulationBlock(simulationResult);

    // PREP-04 + A1 mitigation: LEDGER block carries BOTH the unbroken
    // 0x-prefixed hex AND the 16-group chunked form. The device may
    // chunk/truncate the display; the user can match either way.
    const ledgerBlock = LEDGER_BLIND_SIGN_HASH_TEMPLATE
      .replace("{HASH_FULL}", presignHash)
      .replace("{HASH_CHUNKED}", chunkHex(presignHash));

    // PREP-05: agent-task block carries VERBATIM agent strings (from
    // `record.args` — not re-typed from `record.tx`). The prepare-time
    // PrepareArgs field types are `string` (not Address/bigint) so the
    // type system itself blocks normalization at the storage boundary.
    const agentBlock = AGENT_TASK_TEMPLATE
      .replace("{TO}", record.args.to)
      .replace("{VALUE_WEI}", record.args.valueWei)
      .replace("{PRESIGN_HASH}", presignHash);

    // PREP-06: 4byte block — verbatim upstream surface, no masking
    // (T-4BYTE-MASK-1). Helper lives in src/signing/blocks.ts (Plan 04-05)
    // so a single SOT covers both this tool AND get_tx_verification's
    // re-emit.
    const fourbyteBlock = build4byteBlock(selector, fourbyte);

    // Phase 6 — Plan 06-04: LEDGER NOTICE block. Research § Topic 5 (A2
    // mitigation). Emitted ABOVE the LEDGER BLIND-SIGN HASH for the
    // WETH9.withdraw selector — the device's ERC-20 clear-sign plugin does
    // NOT cover withdraw, and most devices ship with blind-sign disabled.
    // The block surfaces the exact Ledger UI navigation path so the user
    // can enable the setting without leaving the rehearsal.
    //
    // The condition is two-pronged: the selector must match WETH9.withdraw
    // AND tx.to must be the canonical WETH9 contract from src/config/
    // contracts.ts (defense against an unrelated contract that happens to
    // expose a withdraw(uint256) selector — only the SOT-canonical WETH9
    // gets the NOTICE).
    const isWethUnwrap =
      selector === WETH9_SELECTORS.withdraw &&
      record.tx.to === getWethAddress(record.tx.chainId as ChainId);

    // Phase 28 Plan 28-04: LEDGER NOTICE for Compound V3. Research § Topic 8
    // — Compound NOT in the LedgerHQ ERC-7730 clear-signing registry as of
    // 2026-05-20; the device WILL blind-sign every Compound V3 transaction.
    // Conditional emission: tx.chainId === 1 (Phase 28 mainnet-only) AND
    // tx.to is in the canonical Comets set AND the selector matches one of
    // the 2 Compound selectors. Defense against an unrelated contract that
    // happens to expose a matching selector — only the SOT-canonical Comets
    // get the NOTICE.
    const isCompoundComet =
      compoundDecoded !== null &&
      record.tx.chainId === 1 &&
      (selector === COMPOUND_V3_SELECTORS.supply ||
        selector === COMPOUND_V3_SELECTORS.withdraw) &&
      getAllCompoundCometsForChain(1).includes(record.tx.to);

    const ledgerNoticeBlock: string | null = isWethUnwrap
      ? LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE
      : isCompoundComet
        ? LEDGER_NOTICE_COMPOUND_TEMPLATE
        : null;

    // Filter empty decoded-args block (unknown-kind / native sends) so the
    // text-array join doesn't emit a stray empty block alongside the 4byte
    // not-applicable surface. The LEDGER NOTICE block (when emitted) goes
    // AT THE TOP so the user reads it BEFORE the hash — actionable
    // prerequisites precede artifacts to verify.
    const blocks: (string | null)[] = [
      ...(ledgerNoticeBlock !== null ? [ledgerNoticeBlock, ""] : []),
      ledgerBlock,
      "",
      agentBlock,
      "",
      fourbyteBlock,
      ...(decodedArgsBlock !== "" ? ["", decodedArgsBlock] : []),
      "",
      simulationBlock,
      "",
      VERIFY_BEFORE_SIGNING_TEMPLATE,
    ];
    const text = blocks.filter((b): b is string => b !== null).join("\n");

    // Serialize decodedArgs for structuredContent — bigints → strings for
    // JSON safety. Mirror the `gas: gasEstimate.toString()` convention.
    // Phase 7 — Plan 07-03: the union widens to include `aave-supply` and
    // `aave-withdraw` shapes when the Aave decoder returned a non-`unknown`
    // result.
    const decodedArgsForJson =
      aaveDecoded !== null
        ? aaveDecoded.kind === "aave-supply"
          ? {
              kind: "aave-supply" as const,
              asset: aaveDecoded.asset,
              amount: aaveDecoded.amount.toString(),
              onBehalfOf: aaveDecoded.onBehalfOf,
              referralCode: aaveDecoded.referralCode,
            }
          : {
              kind: "aave-withdraw" as const,
              asset: aaveDecoded.asset,
              amount: aaveDecoded.amount.toString(),
              to: aaveDecoded.to,
              isMax: aaveDecoded.isMax,
            }
        : compoundDecoded !== null
          ? compoundDecoded.kind === "compound-supply"
            ? {
                kind: "compound-supply" as const,
                asset: compoundDecoded.asset,
                amount: compoundDecoded.amount.toString(),
                isMax: compoundDecoded.isMax,
                intent: compoundIntentLabel,
              }
            : {
                kind: "compound-withdraw" as const,
                asset: compoundDecoded.asset,
                amount: compoundDecoded.amount.toString(),
                isMax: compoundDecoded.isMax,
                intent: compoundIntentLabel,
              }
          : decodedArgs.kind === "transfer"
            ? { kind: "transfer" as const, to: decodedArgs.to, amount: decodedArgs.amount.toString() }
            : decodedArgs.kind === "approve"
              ? {
                  kind: "approve" as const,
                  spender: decodedArgs.spender,
                  amount: decodedArgs.amount.toString(),
                  isUnlimited: decodedArgs.isUnlimited,
                }
              : decodedArgs.kind === "withdraw"
                ? { kind: "withdraw" as const, amount: decodedArgs.amount.toString() }
                : { kind: "unknown" as const, selector: decodedArgs.selector };

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        previewToken,
        presignHash,
        chainId: record.tx.chainId,
        nonce: pendingNonce,
        // bigint → string for JSON safety. Same convention as
        // get_tx_verification's structured re-emit.
        gas: gasEstimate.toString(),
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
        selector,
        fourbyte,
        decodedArgs: decodedArgsForJson,
        simulation: {
          status: simulationResult.status,
          resultData: simulationResult.resultData,
          errorMessage: simulationResult.errorMessage,
        },
        // Plan 06-04 + Plan 28-04: tag for forward-looking get_tx_verification
        // re-emit. `null` when no NOTICE; canonical tag string when emitted.
        // Two tag values: `"weth-unwrap-blind-sign"` (Phase 6); `"compound-v3-
        // blind-sign"` (Phase 28).
        ledgerNotice: isCompoundComet
          ? ("compound-v3-blind-sign" as const)
          : isWethUnwrap
            ? ("weth-unwrap-blind-sign" as const)
            : null,
        // Plan 09-05 (SEC-36) — WC session topic surface for user cross-check
        // against Ledger Live → Settings → Connected Apps. `null` in demo
        // mode (no WC session); real-mode carries the last-8-chars of the WC
        // session topic. T-SESSION-TOPIC-DRIFT-1: drift across preview /
        // send / pair surfaces indicates session-rotation between calls.
        sessionTopicLast8,
      },
    };
  } catch (err) {
    // Defensive catch-all — the explicit refusal paths above should cover
    // all expected failures. INTERNAL_ERROR is the unstructured fallback
    // (matches Plan 04-02 precedent).
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: preview_send failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "preview_send failed",
        message,
      ),
    };
  }
});

// ===========================================================================
// Phase 12 — Plan 12-04 — Solana branch (additive; outside the EVM FROZEN
// region above). Dispatcher in the main handler reads `record.tx.txType` and
// routes here for `"solana"` handles. The EVM branch above stays byte-
// identical to Phase 4-9.
//
// Layer order in this branch (mirrors EVM but with Solana-specific gates):
//   0.5  canonical-dispatch-solana — refuse on non-allowlisted programIds.
//   0.7  MANDATORY simulation gate — refuse on `sim.status !== "ok"` per DF-4
//         (NOT advisory like EVM `eth_call`; logs surfaced verbatim).
//   1.   handle-state machine — `transitionToPreviewed` overwrites pinned
//         (Q4 invariant; sentinel zeros for EVM-specific fields).
//
// EVM equivalents skipped:
//   - Layer 2 chain-name mismatch: Solana has no `chainId` concept; the
//     discriminator-dispatch already routed to the Solana arm.
//   - Layer 3 fingerprint drift: fires in `send_transaction` (Plan 12-05),
//     NOT at preview. Preview is informational + simulation-gated; drift
//     detection at send is the canonical PREP-08 invariant.
// ===========================================================================

/**
 * Chunk a 32-byte hex digest into 16 groups of 4 hex chars for readable
 * on-device comparison. Mirrors `chunkHex` from `blocks.ts` but specialized
 * for SHA-256 64-hex output (no 0x prefix in chunks; insert single spaces).
 * Stays inline here to keep `blocks-solana.ts` byte-frozen (Wave 1 lock).
 */
function chunkSolanaHash(hashFull64Hex: string): string {
  // Strip `0x` prefix if present.
  const raw = hashFull64Hex.startsWith("0x") ? hashFull64Hex.slice(2) : hashFull64Hex;
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += 4) {
    groups.push(raw.slice(i, i + 4));
  }
  return groups.join(" ");
}

/**
 * Render the DECODED ARGS block for a Solana preview. Dispatcher on
 * `instructionSummary[0].kind`:
 *   - `native-transfer`     → System Program Transfer decoded args.
 *   - `spl-transfer-checked` → SPL TransferChecked decoded args.
 *
 * Reads from the pre-decoded `instructionSummary` on the handle (Plans
 * 12-02 / 12-03 populate this at prepare time).
 */
function buildSolanaDecodedArgsBlock(
  instructionSummary: SolanaInstructionSummary[] | undefined,
): string {
  if (!instructionSummary || instructionSummary.length === 0) {
    return [
      "DECODED ARGS (Solana — unknown)",
      "  No decoded instruction summary on the handle.",
    ].join("\n");
  }
  const first = instructionSummary[0];
  if (!first) {
    return [
      "DECODED ARGS (Solana — unknown)",
      "  Empty instruction summary on the handle.",
    ].join("\n");
  }
  if (first.kind === "native-transfer") {
    return [
      "DECODED ARGS (Solana — native transfer)",
      `  from:     ${first.from}`,
      `  to:       ${first.to}`,
      `  lamports: ${first.lamports.toString()}`,
    ].join("\n");
  }
  // spl-transfer-checked
  return [
    "DECODED ARGS (Solana — SPL TransferChecked)",
    `  mint:           ${first.mint}`,
    `  sourceAta:      ${first.sourceAta}`,
    `  destAta:        ${first.destAta}`,
    `  destOwner:      ${first.destOwner}`,
    `  amount (raw):   ${first.amount.toString()}`,
    `  decimals:       ${first.decimals}`,
  ].join("\n");
}

/**
 * Render the SIMULATION_BLOCK_SOLANA template with status + err + log
 * preview. `logPreview` joins the first 3 log lines with 4-space indent so
 * the substitution lands inside the template's `{LOG_PREVIEW_LINES}` slot
 * uniformly.
 */
function renderSimulationBlockSolana(input: {
  status: string;
  err: string | null;
  unitsConsumed: number | null;
  logs: string[];
}): string {
  const logPreview = input.logs
    .slice(0, 3)
    .map((line) => `    ${line}`)
    .join("\n");
  return SIMULATION_BLOCK_SOLANA_TEMPLATE
    .replace("{STATUS}", input.status)
    .replace("{ERR}", input.err ?? "")
    .replace(
      "{UNITS_CONSUMED}",
      input.unitsConsumed === null ? "n/a" : input.unitsConsumed.toString(),
    )
    .replace("{LOG_COUNT}", input.logs.length.toString())
    .replace("{LOG_PREVIEW_LINES}", logPreview);
}

/**
 * Render the PREPARE RECEIPT block dispatcher on `instructionSummary[0].kind`.
 * Reads verbatim agent strings from `record.args` per PREP-02.
 */
function buildPrepareReceiptForSolana(record: HandleRecord): string {
  const args = record.args;
  const instructionSummary = (record.tx as PreparedTxSolana).instructionSummary;
  const first = instructionSummary && instructionSummary[0];
  if (first && first.kind === "spl-transfer-checked") {
    return PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE
      .replace("{TO}", args.to)
      .replace("{MINT}", args.mint ?? first.mint)
      .replace("{AMOUNT}", args.amount ?? "")
      .replace("{RECENT_BLOCKHASH}", args.recentBlockhash ?? "")
      .replace("{ATA_NOTICE}", "");
  }
  // Native transfer (default).
  return PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE
    .replace("{TO}", args.to)
    .replace("{LAMPORTS}", args.lamports ?? "")
    .replace("{RECENT_BLOCKHASH}", args.recentBlockhash ?? "");
}

/**
 * Preview a Solana-typed handle. EVM body (above) stays byte-identical;
 * this branch is the additive Plan 12-04 surface. Performs:
 *
 *   1. Layer 0.5 canonical-dispatch-solana refusal on non-allowlisted
 *      programIds (`DISPATCH_TARGET_REFUSED`).
 *   2. Reconstruct the legacy `Transaction` from `record.tx.messageBytes`
 *      via `Transaction.populate(Message.from(messageBytes))` — the
 *      canonical SDK helper for round-tripping serialized messages.
 *   3. Layer 0.7 MANDATORY simulation gate via
 *      `_simulationSolana.runSolanaPreviewSimulation` — refuses
 *      (`SIMULATION_REFUSED`) on any `status !== "ok"` per DF-4.
 *   4. Recompute `presignHash` (SHA-256 of messageBytes) via
 *      `_solanaPresign.computeSolanaPresignHash`.
 *   5. Mint a fresh `previewToken` UUID.
 *   6. Pin via `transitionToPreviewed(handle, { ...sentinel-zeros,
 *      previewToken, presignHash })`.
 *   7. Render the 5-block text response: PREPARE RECEIPT + DECODED ARGS +
 *      LEDGER BLIND-SIGN HASH + CHECKS PERFORMED (Solana sim) + VERIFY
 *      BEFORE SIGNING.
 */
async function previewSendSolanaBranch(record: HandleRecord) {
  const solTx = record.tx as PreparedTxSolana;

  // ---- Layer 0.5 — canonical-dispatch-solana allowlist refusal --------
  const dispatchCheck = _canonicalDispatchSolana.checkSolanaDispatchTarget(
    solTx.programIds,
  );
  if (dispatchCheck.kind === "refused") {
    const message = `Solana program(s) not in v1.x allowlist: ${dispatchCheck.offenders.join(
      ", ",
    )}. v1.x scope = System Program + SPL Token Program + Associated Token Program. MarginFi / Kamino / Jupiter / Marinade defer to Phases 13-15.`;
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `error: ${message}\n\nallowlist:\n  ${dispatchCheck.allowlist.join(
            "\n  ",
          )}`,
        },
      ],
      structuredContent: errEnvelope("DISPATCH_TARGET_REFUSED", message),
    };
  }

  // ---- Reconstruct legacy Transaction from messageBytes ---------------
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
          type: "text" as const,
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

  // ---- Layer 0.7 — MANDATORY simulation gate (DF-4) -------------------
  // EVM simulation stayed advisory because stale-nonce / flaky-RPC false
  // reverts are common; Solana `simulateTransaction.err` is high-fidelity
  // (RPC re-executes against current state) so refusal is the correct
  // posture. ANY non-`ok` status refuses with `SIMULATION_REFUSED`. logs
  // surfaced verbatim in `structuredContent.simulation.logs`.
  const connection = _solanaRegistry.getConnection();
  const sim = await _simulationSolana.runSolanaPreviewSimulation({
    connection,
    transaction: tx,
  });
  if (sim.status !== "ok") {
    const causeMessage =
      sim.err ?? sim.rpcError ?? `simulation status: ${sim.status}`;
    const simBlock = renderSimulationBlockSolana({
      status: sim.status.toUpperCase(),
      err: causeMessage,
      unitsConsumed: sim.unitsConsumed,
      logs: sim.logs,
    });
    const message = `Solana preview simulation refused: ${causeMessage}. Re-run prepare_solana_* to refresh the blockhash + re-derive ATAs.`;
    return {
      isError: true,
      content: [{ type: "text" as const, text: simBlock }],
      structuredContent: {
        ...(errEnvelope("SIMULATION_REFUSED", message, causeMessage) as Record<
          string,
          unknown
        >),
        simulation: {
          status: sim.status,
          err: sim.err,
          unitsConsumed: sim.unitsConsumed,
          logCount: sim.logs.length,
          logs: sim.logs,
          rpcError: sim.rpcError ?? null,
        },
      },
    };
  }

  // ---- Mint previewToken + recompute presignHash ---------------------
  const previewToken = crypto.randomUUID();
  const { presignHash } = _solanaPresign.computeSolanaPresignHash({
    messageBytes: solTx.messageBytes,
  });

  // ---- Pin onto handle. Sentinel zeros for EVM-specific fields keep
  // PreviewPinned type-stable. selector is null (Solana programs addressed
  // by program ID, not by 4-byte selector).
  const trans = transitionToPreviewed(record.handle, {
    nonce: 0,
    gas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    previewToken,
    presignHash,
    selector: null,
  });
  if (!trans.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `error: handle state changed during preview (${trans.errorCode})`,
        },
      ],
      structuredContent: errEnvelope(
        trans.errorCode,
        `handle transition failed: ${trans.errorCode}`,
      ),
    };
  }

  // ---- Render text blocks ---------------------------------------------
  const prepareReceiptBlock = buildPrepareReceiptForSolana(record);
  const decodedArgsBlock = buildSolanaDecodedArgsBlock(solTx.instructionSummary);
  const ledgerBlock = LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE
    .replace("{HASH_FULL_64HEX}", presignHash)
    .replace("{HASH_CHUNKED_4_CHAR_GROUPS}", chunkSolanaHash(presignHash));
  const simBlock = renderSimulationBlockSolana({
    status: "OK",
    err: null,
    unitsConsumed: sim.unitsConsumed,
    logs: sim.logs,
  });
  const text = [
    prepareReceiptBlock,
    "",
    decodedArgsBlock,
    "",
    ledgerBlock,
    "",
    simBlock,
    "",
    VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE,
  ].join("\n");

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      handle: record.handle,
      previewToken,
      presignHash,
      payloadFingerprint: record.payloadFingerprint,
      txType: "solana" as const,
      simulation: {
        status: sim.status,
        unitsConsumed: sim.unitsConsumed,
        logCount: sim.logs.length,
        logs: sim.logs,
      },
      // Serialize instructionSummary for JSON safety — bigint → string.
      decodedArgs: (solTx.instructionSummary ?? []).map((s) =>
        s.kind === "native-transfer"
          ? {
              kind: "native-transfer" as const,
              from: s.from,
              to: s.to,
              lamports: s.lamports.toString(),
            }
          : {
              kind: "spl-transfer-checked" as const,
              mint: s.mint,
              sourceAta: s.sourceAta,
              destAta: s.destAta,
              destOwner: s.destOwner,
              amount: s.amount.toString(),
              decimals: s.decimals,
            },
      ),
      // Phase 12: Solana branch has no WC session topic (the trust pipeline
      // bypasses WC entirely on send via USB-HID — Plan 12-05). null surfaces
      // for cross-chain agent symmetry.
      sessionTopicLast8: null,
    },
  };
}

// Keep decoder indirection objects referenced (Plan 12-05 send-time branch
// will dispatch to them; this plan only consumes via instructionSummary so
// the import-warn rule sees them as unused).
void _solanaSystem;
void _solanaSpl;

// ===========================================================================
// Phase 18 — Plan 18-04 — TRON branch (additive; lives OUTSIDE the FROZEN
// three-gate region above). Dispatcher in the main handler reads
// `record.tx.txType` and routes here for `"tron"` handles. The EVM + Solana
// branches above stay byte-frozen.
//
// TRON branch layers (per CONTEXT D-03 + D-11):
//   Layer 0.5 — canonical-dispatch-tron (TRC-20 only; native skips)
//   Layer 0.7 — TRC-20 mandatory `triggerconstantcontract` refusal
//              native: emitNoSimulationAvailable() advisory (NOT refusal)
//   Layer 1   — handle lookup (done at dispatcher; passed in as `record`)
//   Layer 3   — fingerprint drift caught at `send_transaction.ts` PAYLOAD_FINGERPRINT_DRIFT gate
// ===========================================================================

/**
 * Chunk a 32-byte hex digest into 16 groups of 4 hex chars for readable
 * on-device comparison. Mirrors `chunkSolanaHash` from the Solana branch.
 * Stays inline here to keep `blocks-tron.ts` byte-frozen.
 */
function chunkTronHash(hashFull64Hex: string): string {
  const raw = hashFull64Hex.startsWith("0x") ? hashFull64Hex.slice(2) : hashFull64Hex;
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += 4) {
    groups.push(raw.slice(i, i + 4));
  }
  return groups.join(" ");
}

/**
 * Phase 18 — LEDGER_NOTICE_TRON_TEMPLATE emit predicate.
 * Phase 18 set (USDT/USDC/USDD/TUSD + native TRX) is fully bundled-registry
 * covered, so this predicate returns `emit: false` for all Phase 18 cases.
 * Phase 19+ extends the predicate:
 *   - TRC-20 approve (`approve(spender, amount)`) — distinct ABI from
 *     `transfer`, NOT in bundled registry → `emit: true`.
 *   - Stake 2.0 (FreezeBalanceV2Contract / VoteWitnessContract / etc.) —
 *     distinct Protobuf shape from TriggerSmartContract, blind-sign only
 *     → `emit: true`.
 *   - SunSwap router calls (Phase 20) — TriggerSmartContract to non-
 *     allowlist contracts → `emit: true`.
 */
function shouldEmitTronLedgerNotice(tx: PreparedTxTron):
  | { emit: false; reason: string }
  | { emit: true; instructionName: string; reason: string } {
  if (tx.kind === "native") {
    return { emit: false, reason: "native TransferContract clear-signs unconditionally on TRX app v0.5+" };
  }
  // tx.kind === "trc20" — all Phase 18 stablecoins in bundled registry
  // Phase 19+ widens: switch on `tx.kind` for approve/stake/swap variants
  const summary0Kind = tx.instructionSummary?.[0]?.kind;
  if (summary0Kind === "trc20-approve") {
    // Phase 19: approve ABI is distinct from transfer; not in TRX-app bundled clear-sign registry.
    return {
      emit: true,
      instructionName: "TRC-20 approve",
      reason: "approve ABI distinct from transfer — not in TRX app v0.5+ bundled clear-sign registry",
    };
  }
  if (summary0Kind === "trc20-revoke") {
    // Phase 19: revoke is approve(spender, 0) — same ABI; not in bundled clear-sign registry.
    return {
      emit: true,
      instructionName: "TRC-20 revoke",
      reason: "approve ABI distinct from transfer — not in TRX app v0.5+ bundled clear-sign registry",
    };
  }
  // Phase 19-02: Stake 2.0 kinds are Protobuf-native — distinct shape from TriggerSmartContract;
  // blind-sign only. LEDGER NOTICE is UNCONDITIONALLY emitted for all stake kinds.
  if (tx.kind === "stake-freeze") {
    return {
      emit: true,
      instructionName: "TRON Stake 2.0 freeze (FreezeBalanceV2Contract)",
      reason: "Protobuf-native contract distinct from TriggerSmartContract — blind-sign only on TRX app",
    };
  }
  if (tx.kind === "stake-unfreeze") {
    return {
      emit: true,
      instructionName: "TRON Stake 2.0 unfreeze (UnfreezeBalanceV2Contract)",
      reason: "Protobuf-native contract distinct from TriggerSmartContract — blind-sign only on TRX app",
    };
  }
  if (tx.kind === "stake-withdraw-expire") {
    return {
      emit: true,
      instructionName: "TRON Stake 2.0 withdraw expired unfreeze (WithdrawExpireUnfreezeContract)",
      reason: "Protobuf-native contract distinct from TriggerSmartContract — blind-sign only on TRX app",
    };
  }
  // Phase 19-03: vote + claim-rewards are also Protobuf-native.
  if (tx.kind === "stake-vote") {
    return {
      emit: true,
      instructionName: "TRON Stake 2.0 vote (VoteWitnessContract)",
      reason: "Protobuf-native contract distinct from TriggerSmartContract — blind-sign only on TRX app",
    };
  }
  if (tx.kind === "stake-claim-rewards") {
    return {
      emit: true,
      instructionName: "TRON Stake 2.0 claim rewards (WithdrawBalanceContract)",
      reason: "Protobuf-native contract distinct from TriggerSmartContract — blind-sign only on TRX app",
    };
  }
  // Phase 20: SunSwap V2 router TriggerSmartContract — NOT in TRX app bundled clear-sign registry.
  if (tx.kind === "sunswap-swap") {
    return {
      emit: true,
      instructionName: "TRON SunSwap V2 swap (TriggerSmartContract — swapExactTokensForTokens)",
      reason: "SunSwap V2 router not in TRX app v0.5+ bundled clear-sign registry — blind-sign only",
    };
  }
  return { emit: false, reason: "Phase 18 TRC-20 set in TRX app v0.5+ bundled registry" };
}

/**
 * Preview a TRON-typed handle. EVM + Solana bodies (above) stay byte-identical;
 * this branch is the additive Plan 18-04 surface. Performs:
 *
 *   1. Layer 0.5 canonical-dispatch-tron refusal on non-allowlisted TRC-20
 *      contracts (`DISPATCH_TARGET_REFUSED`). Native TRX skips.
 *   2. Layer 0.7 MANDATORY simulation gate for TRC-20 via
 *      `_simulationTron.runTronPreviewSimulation` — refuses
 *      (`SIMULATION_REFUSED`) on any `status !== "ok"`.
 *      Native TRX: `emitNoSimulationAvailable()` advisory (NOT refusal).
 *   3. Recompute `presignHash` (SHA-256 of rawDataBytes) via
 *      `_tronPresign.computeTronPresignHash`.
 *   4. Mint a fresh `previewToken` UUID.
 *   5. Pin via `transitionToPreviewed(handle, { ...sentinel-zeros,
 *      previewToken, presignHash })`.
 *   6. Render text response: PREPARE RECEIPT + LEDGER NOTICE (conditional) +
 *      LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE + CHECKS PERFORMED + VERIFY BEFORE SIGNING.
 */
async function previewSendTronBranch(
  record: HandleRecord & { tx: PreparedTxTron },
): Promise<{
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
}> {
  const tronTx = record.tx;

  // ---- Phase 19-02 — Stake 2.0 arms (EARLY RETURN before Layer 0.5 + Layer 0.7) ----
  // Placement is LOAD-BEARING: fires BEFORE the approve/revoke arm and BEFORE the
  // trc20-transfer-only Layer 0.5 stablecoin allowlist.
  //
  // stake-freeze / stake-unfreeze: advisory Layer 0.7 (NO_SIMULATION_AVAILABLE).
  // stake-withdraw-expire: MANDATORY Layer 0.7 refusal if checkWithdrawableBalance === 0n
  //   (D-04b asymmetric gate — prevents broadcasting a no-op tx).
  //
  // No Layer 0.5 (canonical-dispatch-tron) call for any stake kind — Protobuf-native
  // contracts have no contract_address field (caller-side skip per D-11a ADDITIVE).
  if (tronTx.kind === "stake-freeze" || tronTx.kind === "stake-unfreeze" || tronTx.kind === "stake-withdraw-expire" || tronTx.kind === "stake-vote" || tronTx.kind === "stake-claim-rewards") {
    // ---- Step 1: Layer 0.7 gate (asymmetric per D-04b) -------------------
    let stakeSimulation: import("../signing/simulation-tron.js").TronSimulationResult;

    if (tronTx.kind === "stake-withdraw-expire") {
      // MANDATORY refusal gate for withdraw-expire: check on-chain withdrawable balance.
      const tronWebStake = _tronRegistry.getTronWeb();
      const summary0Stake = tronTx.instructionSummary?.[0];
      const ownerAddr = summary0Stake && "from" in summary0Stake ? summary0Stake.from : "";
      let withdrawableCheck: { withdrawable: bigint; expiringAt: number | null };
      try {
        withdrawableCheck = await _tronStake.checkWithdrawableBalance(tronWebStake, ownerAddr);
      } catch (_checkErr) {
        // Fail-closed per D-04b: if RPC check fails, treat as 0 (refuse).
        withdrawableCheck = { withdrawable: 0n, expiringAt: null };
      }
      if (withdrawableCheck.withdrawable === 0n) {
        const message =
          "TRON Stake 2.0 withdraw-expire refused: no expired unfreeze records found " +
          "(Layer 0.7 mandatory refusal — D-04b). " +
          "Wait 14 days from the unfreeze transaction before calling preview_send. " +
          "Current on-chain withdrawable balance: 0 SUN.";
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${message}` }],
          structuredContent: {
            ...(errEnvelope("SIMULATION_REFUSED", message) as Record<string, unknown>),
            simulation: { status: "refused", revertReason: "no expired unfreeze records", rpcError: null, energyUsed: null, constantResult: [] },
          },
        };
      }
      // PASS: withdrawable > 0n — emit WITHDRAWABLE_BALANCE_TRON_TEMPLATE advisory.
      const expiryIso = withdrawableCheck.expiringAt
        ? new Date(withdrawableCheck.expiringAt).toISOString()
        : "n/a";
      const withdrawableBlock = WITHDRAWABLE_BALANCE_TRON_TEMPLATE
        .replace("{WITHDRAWABLE_SUN}", withdrawableCheck.withdrawable.toString())
        .replace("{EARLIEST_EXPIRY_ISO}", expiryIso);
      stakeSimulation = _simulationTron.emitNoSimulationAvailable();
      // We'll inject the withdrawableBlock below.

      // ---- Step 2: Recompute presignHash -----------------------------------
      const rawDataBytesStakeW = Buffer.from(tronTx.rawDataHex, "hex");
      const { presignHash: presignHashStakeW } = _tronPresign.computeTronPresignHash({
        rawDataBytes: new Uint8Array(rawDataBytesStakeW),
      });

      // ---- Step 3: Mint previewToken + pin ----------------------------------
      const previewTokenStakeW = crypto.randomUUID();
      const transStakeW = transitionToPreviewed(record.handle, {
        nonce: 0,
        gas: 0n,
        maxFeePerGas: 0n,
        maxPriorityFeePerGas: 0n,
        previewToken: previewTokenStakeW,
        presignHash: presignHashStakeW,
        selector: null,
      });
      if (!transStakeW.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: handle state changed during preview (${transStakeW.errorCode})` }],
          structuredContent: errEnvelope(transStakeW.errorCode, `handle transition failed: ${transStakeW.errorCode}`) as Record<string, unknown>,
        };
      }

      // ---- Step 4: Render blocks --------------------------------------------
      const prepareReceiptStakeW = PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE
        .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
        .replace("{EXPIRATION}", String(tronTx.expiration));

      const blindSignHashBlockStakeW = LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE
        .replace("{HASH_FULL_64HEX}", presignHashStakeW)
        .replace("{HASH_CHUNKED_4_CHAR_GROUPS}", chunkTronHash(presignHashStakeW));

      const noticeDecisionStakeW = shouldEmitTronLedgerNotice(tronTx);
      const ledgerNoticeBlockStakeW = noticeDecisionStakeW.emit
        ? LEDGER_NOTICE_TRON_TEMPLATE
            .replace("{INSTRUCTION_NAME}", noticeDecisionStakeW.instructionName)
            .replace("{REGISTRY_STATUS}", noticeDecisionStakeW.reason)
        : "";

      const responseTextPartsStakeW = [
        prepareReceiptStakeW,
        withdrawableBlock,
        ...(ledgerNoticeBlockStakeW ? [ledgerNoticeBlockStakeW] : []),
        blindSignHashBlockStakeW,
        VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
        `\nPreview token: ${previewTokenStakeW}`,
        `\nNext step: send_transaction({ handle: "${record.handle}", previewToken: "${previewTokenStakeW}", userDecision: "send" })`,
      ];

      return {
        content: [{ type: "text", text: responseTextPartsStakeW.filter(Boolean).join("\n\n") }],
        structuredContent: {
          handle: record.handle,
          chain: "tron",
          kind: tronTx.kind,
          previewToken: previewTokenStakeW,
          presignHash: presignHashStakeW,
          simulation: stakeSimulation,
          withdrawableSun: withdrawableCheck.withdrawable.toString(),
          payloadFingerprint: record.payloadFingerprint,
          decodedArgs: tronTx.instructionSummary,
          blockHeader: {
            refBlockBytes: tronTx.refBlockBytes,
            refBlockHash: tronTx.refBlockHash,
            expiration: tronTx.expiration,
          },
          rawDataHex: tronTx.rawDataHex,
          sessionTopicLast8: null,
        },
      };
    }

    // stake-freeze or stake-unfreeze: advisory path (NO_SIMULATION_AVAILABLE).
    stakeSimulation = _simulationTron.emitNoSimulationAvailable();

    // ---- Step 2: Recompute presignHash -----------------------------------
    const rawDataBytesStake = Buffer.from(tronTx.rawDataHex, "hex");
    const { presignHash: presignHashStake } = _tronPresign.computeTronPresignHash({
      rawDataBytes: new Uint8Array(rawDataBytesStake),
    });

    // ---- Step 3: Mint previewToken + pin ----------------------------------
    const previewTokenStake = crypto.randomUUID();
    const transStake = transitionToPreviewed(record.handle, {
      nonce: 0,
      gas: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      previewToken: previewTokenStake,
      presignHash: presignHashStake,
      selector: null,
    });
    if (!transStake.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: handle state changed during preview (${transStake.errorCode})` }],
        structuredContent: errEnvelope(transStake.errorCode, `handle transition failed: ${transStake.errorCode}`) as Record<string, unknown>,
      };
    }

    // ---- Step 4: Render blocks --------------------------------------------
    const summary0Stake = tronTx.instructionSummary?.[0];

    // Build prepare receipt per kind.
    let prepareReceiptStake: string;
    if (tronTx.kind === "stake-freeze") {
      prepareReceiptStake = PREPARE_RECEIPT_TRON_STAKE_FREEZE_TEMPLATE
        .replace("{RESOURCE}", summary0Stake && "resource" in summary0Stake ? summary0Stake.resource : "")
        .replace("{SUN}", summary0Stake && "sun" in summary0Stake ? (summary0Stake.sun as bigint).toString() : "")
        .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
        .replace("{EXPIRATION}", String(tronTx.expiration));
    } else if (tronTx.kind === "stake-unfreeze") {
      prepareReceiptStake = PREPARE_RECEIPT_TRON_STAKE_UNFREEZE_TEMPLATE
        .replace("{RESOURCE}", summary0Stake && "resource" in summary0Stake ? summary0Stake.resource : "")
        .replace("{SUN}", summary0Stake && "sun" in summary0Stake ? (summary0Stake.sun as bigint).toString() : "")
        .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
        .replace("{EXPIRATION}", String(tronTx.expiration));
    } else if (tronTx.kind === "stake-vote") {
      // Phase 19-03: VoteWitnessContract — per-SR label rows embedded in {VOTE_ROWS}.
      const voteRows = (summary0Stake && "votes" in summary0Stake ? summary0Stake.votes : []).map(
        (v: { srAddress: string; count: number; label: string }) =>
          SR_LABEL_TRON_TEMPLATE
            .replace("{SR_RANK}", "?")
            .replace("{SR_ADDRESS}", v.srAddress)
            .replace("{SR_LABEL}", v.label)
            .replace("{SR_COUNT}", String(v.count)),
      ).join("\n");
      const totalCountStake = summary0Stake && "totalCount" in summary0Stake ? (summary0Stake as { totalCount: number }).totalCount : 0;
      prepareReceiptStake = PREPARE_RECEIPT_TRON_VOTE_TEMPLATE
        .replace("{TOTAL_COUNT}", String(totalCountStake))
        .replace("{SR_SOURCE}", "live") // advisory; tool prepares with actual source at prepare time
        .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
        .replace("{EXPIRATION}", String(tronTx.expiration))
        .replace("{VOTE_ROWS}", voteRows);
    } else {
      // stake-claim-rewards: WithdrawBalanceContract — no resource/amount args.
      prepareReceiptStake = PREPARE_RECEIPT_TRON_CLAIM_REWARDS_TEMPLATE
        .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
        .replace("{EXPIRATION}", String(tronTx.expiration));
    }

    const resourceBlockStake = summary0Stake && "resource" in summary0Stake
      ? STAKE_RESOURCE_TRON_TEMPLATE
          .replace("{RESOURCE}", summary0Stake.resource)
          .replace(
            "{RESOURCE_DESCRIPTION}",
            summary0Stake.resource === "ENERGY"
              ? "ENERGY (consumed by TRC-20 transfers + contract calls — reduces gas costs)"
              : "BANDWIDTH (consumed by tx broadcast — reduces transaction fees)",
          )
      : "";

    // STAKE_WAITING_PERIOD_TRON_TEMPLATE only for unfreeze.
    const waitingPeriodBlockStake = tronTx.kind === "stake-unfreeze"
      ? STAKE_WAITING_PERIOD_TRON_TEMPLATE
      : "";

    // Advisory reward estimate block — only for stake-claim-rewards when estimatedRewardSun present.
    const rewardEstimateBlockStake = (tronTx.kind === "stake-claim-rewards" && summary0Stake && "estimatedRewardSun" in summary0Stake && summary0Stake.estimatedRewardSun !== null)
      ? REWARD_ESTIMATE_TRON_TEMPLATE.replace("{ESTIMATED_REWARD_SUN}", String((summary0Stake as { estimatedRewardSun: bigint | null }).estimatedRewardSun))
      : "";

    const blindSignHashBlockStake = LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE
      .replace("{HASH_FULL_64HEX}", presignHashStake)
      .replace("{HASH_CHUNKED_4_CHAR_GROUPS}", chunkTronHash(presignHashStake));

    const noticeDecisionStake = shouldEmitTronLedgerNotice(tronTx);
    const ledgerNoticeBlockStake = noticeDecisionStake.emit
      ? LEDGER_NOTICE_TRON_TEMPLATE
          .replace("{INSTRUCTION_NAME}", noticeDecisionStake.instructionName)
          .replace("{REGISTRY_STATUS}", noticeDecisionStake.reason)
      : "";

    const responseTextPartsStake = [
      prepareReceiptStake,
      ...(resourceBlockStake ? [resourceBlockStake] : []),
      ...(waitingPeriodBlockStake ? [waitingPeriodBlockStake] : []),
      ...(rewardEstimateBlockStake ? [rewardEstimateBlockStake] : []),
      ...(ledgerNoticeBlockStake ? [ledgerNoticeBlockStake] : []),
      blindSignHashBlockStake,
      NO_SIMULATION_AVAILABLE_TRON_TEMPLATE,
      VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
      `\nPreview token: ${previewTokenStake}`,
      `\nNext step: send_transaction({ handle: "${record.handle}", previewToken: "${previewTokenStake}", userDecision: "send" })`,
    ];

    return {
      content: [{ type: "text", text: responseTextPartsStake.filter(Boolean).join("\n\n") }],
      structuredContent: {
        handle: record.handle,
        chain: "tron",
        kind: tronTx.kind,
        previewToken: previewTokenStake,
        presignHash: presignHashStake,
        simulation: stakeSimulation,
        payloadFingerprint: record.payloadFingerprint,
        decodedArgs: tronTx.instructionSummary,
        blockHeader: {
          refBlockBytes: tronTx.refBlockBytes,
          refBlockHash: tronTx.refBlockHash,
          expiration: tronTx.expiration,
        },
        rawDataHex: tronTx.rawDataHex,
        sessionTopicLast8: null,
      },
    };
  }
  // End Phase 19-02 stake arms — fall through to approve/revoke + trc20-transfer + native arms.

  // ---- Phase 19 — approve/revoke arm (EARLY RETURN before Layer 0.5 + Layer 0.7) ----
  // Placement is LOAD-BEARING: fires BEFORE the trc20-transfer-only Layer 0.5 stablecoin
  // allowlist and BEFORE the Layer 0.7 `summary.kind !== "trc20-transfer"` guard.
  // Approve/revoke handles bypass both guards and early-return with the correct PREPARE
  // RECEIPT template + selector (0x095ea7b3) + LEDGER NOTICE + no simulation advisory.
  // The existing trc20-transfer + native arms below are BYTE-IDENTICAL (skipped via this
  // early-return; NOT modified). T-PREVIEW-APPROVE-MISROUTE mitigation per threat register.
  const summary0 = tronTx.instructionSummary?.[0];
  if (
    tronTx.kind === "trc20" &&
    (summary0?.kind === "trc20-approve" || summary0?.kind === "trc20-revoke")
  ) {
    // 1. Skip Layer 0.5 (stablecoin allowlist guards transfer counterparties, not approve).
    // 2. Skip Layer 0.7 simulation (approve is intent-only; no on-chain balance to simulate).
    const simulationResultApprove = _simulationTron.emitNoSimulationAvailable();

    // 3. Recompute presignHash (SHA-256 of rawDataBytes) — identical to transfer arm.
    const rawDataBytesApprove = Buffer.from(tronTx.rawDataHex, "hex");
    const { presignHash: presignHashApprove } = _tronPresign.computeTronPresignHash({
      rawDataBytes: new Uint8Array(rawDataBytesApprove),
    });

    // 4. Mint fresh previewToken.
    const previewTokenApprove = crypto.randomUUID();

    // 5. Pin via transitionToPreviewed — selector 0x095ea7b3 (LOAD-BEARING: approve, not transfer).
    const transApprove = transitionToPreviewed(record.handle, {
      nonce: 0,
      gas: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      previewToken: previewTokenApprove,
      presignHash: presignHashApprove,
      selector: "0x095ea7b3",
    });
    if (!transApprove.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: handle state changed during preview (${transApprove.errorCode})`,
          },
        ],
        structuredContent: errEnvelope(
          transApprove.errorCode,
          `handle transition failed: ${transApprove.errorCode}`,
        ) as Record<string, unknown>,
      };
    }

    // 6. Render PREPARE RECEIPT from approve template.
    const prepareReceiptApprove = PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE
      .replace("{CHAIN}", "TRON mainnet")
      .replace("{TOKEN}", record.args.tokenAddress!)
      .replace("{SPENDER}", record.args.spender!)
      .replace("{AMOUNT}", record.args.amount!)
      .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
      .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
      .replace("{EXPIRATION}", String(tronTx.expiration));

    // 7. Render KNOWN_SPENDER_LABEL_TRON_TEMPLATE.
    const spenderLabelBlockApprove = KNOWN_SPENDER_LABEL_TRON_TEMPLATE
      .replace("{SPENDER}", record.args.spender!)
      .replace("{LABEL}", (summary0 as { spenderLabel?: string }).spenderLabel ?? "(unknown)")
      .replace("{SOURCE}", "KNOWN_SPENDERS_TRON sub-table (src/config/contracts.ts)");

    // 8. Render LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE.
    const blindSignHashBlockApprove = LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE
      .replace("{HASH_FULL_64HEX}", presignHashApprove)
      .replace("{HASH_CHUNKED_4_CHAR_GROUPS}", chunkTronHash(presignHashApprove));

    // 9. NO_SIMULATION_AVAILABLE_TRON_TEMPLATE advisory (approve is intent-only; no simulation).
    const simulationBlockApprove = NO_SIMULATION_AVAILABLE_TRON_TEMPLATE;

    // 10. Conditionally render UNLIMITED_APPROVAL_TRON_TEMPLATE (only for approve + amountIsMax).
    const unlimitedBlockApprove =
      summary0.kind === "trc20-approve" && (summary0 as { amountIsMax?: boolean }).amountIsMax === true
        ? UNLIMITED_APPROVAL_TRON_TEMPLATE
            .replaceAll("{TOKEN}", record.args.tokenAddress!)
            .replaceAll("{SPENDER}", record.args.spender!)
        : "";

    // 11. Render LEDGER_NOTICE_TRON_TEMPLATE UNCONDITIONALLY (approve/revoke blind-sign UX defense).
    const noticeDecisionApprove = shouldEmitTronLedgerNotice(tronTx);
    const ledgerNoticeBlockApprove = noticeDecisionApprove.emit
      ? LEDGER_NOTICE_TRON_TEMPLATE
          .replace("{INSTRUCTION_NAME}", noticeDecisionApprove.instructionName)
          .replace("{REGISTRY_STATUS}", noticeDecisionApprove.reason)
      : "";

    // 12. Render VERIFY_BEFORE_SIGNING_TRON_TEMPLATE (constant prose).
    // 13. Concatenate with "\n\n" separator.
    const responseTextPartsApprove = [
      prepareReceiptApprove,
      spenderLabelBlockApprove,
      ...(unlimitedBlockApprove ? [unlimitedBlockApprove] : []),
      ...(ledgerNoticeBlockApprove ? [ledgerNoticeBlockApprove] : []),
      blindSignHashBlockApprove,
      simulationBlockApprove,
      VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
      `\nPreview token: ${previewTokenApprove}`,
      `\nNext step: send_transaction({ handle: "${record.handle}", previewToken: "${previewTokenApprove}", userDecision: "send" })`,
    ];
    const responseTextApprove = responseTextPartsApprove.filter(Boolean).join("\n\n");

    // 14. Return same structuredContent shape as the transfer arm.
    return {
      content: [{ type: "text", text: responseTextApprove }],
      structuredContent: {
        handle: record.handle,
        chain: "tron",
        kind: tronTx.kind,
        previewToken: previewTokenApprove,
        presignHash: presignHashApprove,
        simulation: simulationResultApprove,
        payloadFingerprint: record.payloadFingerprint,
        decodedArgs: tronTx.instructionSummary,
        blockHeader: {
          refBlockBytes: tronTx.refBlockBytes,
          refBlockHash: tronTx.refBlockHash,
          expiration: tronTx.expiration,
        },
        rawDataHex: tronTx.rawDataHex,
        sessionTopicLast8: null,
      },
    };
  }
  // End Phase 19 approve/revoke arm — fall through to Phase 20 sunswap-swap arm.

  // ---- Phase 20 — SunSwap V2 swap arm (EARLY RETURN before Layer 0.5 + Layer 0.7) ----
  // Placement is LOAD-BEARING: fires BEFORE the trc20-transfer-only Layer 0.5 stablecoin
  // allowlist (checkTronDispatchTarget uses a different allowlist than the router check).
  // Layer 0.5 for sunswap-swap uses checkTronSmartContractDispatchTarget (router allowlist),
  // NOT checkTronDispatchTarget (stablecoin allowlist) — run inline here.
  // Layer 0.7 simulation: NO_SIMULATION_AVAILABLE_TRON_TEMPLATE advisory (not a refusal).
  if (tronTx.kind === "sunswap-swap") {
    // 1. Layer 0.5 — SmartContract dispatch allowlist (router, not stablecoin set).
    const routerCheck = _canonicalDispatchTron.checkTronSmartContractDispatchTarget([
      tronTx.contractAddress ?? SUNSWAP_V2_ROUTER_TRON_ADDRESS,
    ]);
    if (routerCheck.kind === "refused") {
      const message = `SunSwap swap contract ${tronTx.contractAddress} is not in the TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST (1-entry router set per Phase 20). Expected: ${SUNSWAP_V2_ROUTER_TRON_ADDRESS}.`;
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${message}` }],
        structuredContent: errEnvelope(
          "DISPATCH_TARGET_REFUSED",
          message,
        ) as Record<string, unknown>,
      };
    }

    // 2. Layer 0.7 simulation: advisory (NO_SIMULATION_AVAILABLE) — not a refusal.
    const simulationResultSwap = _simulationTron.emitNoSimulationAvailable();

    // 3. Recompute presignHash (SHA-256 of rawDataBytes).
    const rawDataBytesSwap = Buffer.from(tronTx.rawDataHex, "hex");
    const { presignHash: presignHashSwap } = _tronPresign.computeTronPresignHash({
      rawDataBytes: new Uint8Array(rawDataBytesSwap),
    });

    // 4. Mint fresh previewToken.
    const previewTokenSwap = crypto.randomUUID();

    // 5. Pin via transitionToPreviewed — selector 0x38ed1739 (swapExactTokensForTokens).
    const transSwap = transitionToPreviewed(record.handle, {
      nonce: 0,
      gas: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      previewToken: previewTokenSwap,
      presignHash: presignHashSwap,
      selector: "0x38ed1739",
    });
    if (!transSwap.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: handle state changed during preview (${transSwap.errorCode})`,
          },
        ],
        structuredContent: errEnvelope(
          transSwap.errorCode,
          `handle transition failed: ${transSwap.errorCode}`,
        ) as Record<string, unknown>,
      };
    }

    // 6. Render PREPARE RECEIPT from sunswap template.
    const summarySwap = tronTx.instructionSummary?.[0];
    const prepareReceiptSwap = PREPARE_RECEIPT_TRON_SUNSWAP_TEMPLATE
      .replace("{CHAIN}", "TRON mainnet")
      .replace("{INPUT_TOKEN}", record.args.inputToken ?? "")
      .replace("{OUTPUT_TOKEN}", record.args.outputToken ?? "")
      .replace("{IN_AMOUNT}", record.args.amount ?? "")
      .replace("{OUT_AMOUNT}", summarySwap && "outAmount" in summarySwap ? String(summarySwap.outAmount) : "")
      .replace("{PRICE_IMPACT_BPS}", summarySwap && "priceImpactBps" in summarySwap ? String(summarySwap.priceImpactBps) : "")
      .replace("{SLIPPAGE_BPS}", record.args.slippageBps ?? "")
      .replace("{PATH}", summarySwap && "path" in summarySwap ? (summarySwap.path as string[]).join(" → ") : "")
      .replace("{DEADLINE}", summarySwap && "deadline" in summarySwap ? String(summarySwap.deadline) : "")
      .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
      .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
      .replace("{EXPIRATION}", String(tronTx.expiration));

    // 7. Render LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE.
    const blindSignHashBlockSwap = LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE
      .replace("{HASH_FULL_64HEX}", presignHashSwap)
      .replace("{HASH_CHUNKED_4_CHAR_GROUPS}", chunkTronHash(presignHashSwap));

    // 8. NO_SIMULATION_AVAILABLE_TRON_TEMPLATE advisory.
    const simulationBlockSwap = NO_SIMULATION_AVAILABLE_TRON_TEMPLATE;

    // 9. LEDGER_NOTICE_TRON_TEMPLATE — UNCONDITIONALLY emitted for sunswap-swap.
    const noticeDecisionSwap = shouldEmitTronLedgerNotice(tronTx);
    const ledgerNoticeBlockSwap = noticeDecisionSwap.emit
      ? LEDGER_NOTICE_TRON_TEMPLATE
          .replace("{INSTRUCTION_NAME}", noticeDecisionSwap.instructionName)
          .replace("{REGISTRY_STATUS}", noticeDecisionSwap.reason)
      : "";

    // 10. Concatenate response text.
    const responseTextPartsSwap = [
      prepareReceiptSwap,
      ...(ledgerNoticeBlockSwap ? [ledgerNoticeBlockSwap] : []),
      blindSignHashBlockSwap,
      simulationBlockSwap,
      VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
      `\nPreview token: ${previewTokenSwap}`,
      `\nNext step: send_transaction({ handle: "${record.handle}", previewToken: "${previewTokenSwap}", userDecision: "send" })`,
    ];
    const responseTextSwap = responseTextPartsSwap.filter(Boolean).join("\n\n");

    return {
      content: [{ type: "text", text: responseTextSwap }],
      structuredContent: {
        handle: record.handle,
        chain: "tron",
        kind: tronTx.kind,
        previewToken: previewTokenSwap,
        presignHash: presignHashSwap,
        simulation: simulationResultSwap,
        payloadFingerprint: record.payloadFingerprint,
        decodedArgs: tronTx.instructionSummary,
        blockHeader: {
          refBlockBytes: tronTx.refBlockBytes,
          refBlockHash: tronTx.refBlockHash,
          expiration: tronTx.expiration,
        },
        rawDataHex: tronTx.rawDataHex,
        sessionTopicLast8: null,
      },
    };
  }
  // End Phase 20 sunswap-swap arm — fall through to Phase 18 trc20-transfer + native arms.

  // ---- Layer 0.5 — canonical-dispatch-tron (TRC-20 only) ---------------
  if (tronTx.kind === "trc20") {
    const result = _canonicalDispatchTron.checkTronDispatchTarget([
      tronTx.contractAddress!,
    ]);
    if (result.kind === "refused") {
      const message = `TRC-20 contract ${tronTx.contractAddress} is not in the canonical-dispatch-tron allowlist (4-entry stablecoin set per Phase 18 / TRON-PREP-02). Use one of: ${result.allowlist.join(", ")}. Non-allowlist tokens land at Phase 19+.`;
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${message}` }],
        structuredContent: errEnvelope(
          "DISPATCH_TARGET_REFUSED",
          message,
        ) as Record<string, unknown>,
      };
    }
  }
  // Native TRX skips Layer 0.5 per CONTEXT D-11a.

  // ---- Layer 0.7 — TRC-20 mandatory simulation gate; native advisory -----
  let simulationResult: TronSimulationResult;
  if (tronTx.kind === "trc20") {
    const tronWeb = _tronRegistry.getTronWeb();
    const summary = tronTx.instructionSummary![0];
    if (!summary || summary.kind !== "trc20-transfer") {
      return {
        isError: true,
        content: [{ type: "text", text: "error: Handle's instructionSummary kind mismatch — expected 'trc20-transfer'" }],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "Handle's instructionSummary kind mismatch — expected 'trc20-transfer'",
        ) as Record<string, unknown>,
      };
    }
    simulationResult = await _simulationTron.runTronPreviewSimulation({
      tronWeb,
      contractAddress: tronTx.contractAddress!,
      functionSelector: "transfer(address,uint256)",
      parameters: [
        { type: "address", value: summary.to },
        { type: "uint256", value: summary.amount.toString() },
      ],
      ownerAddress: summary.from,
    });
    if (simulationResult.status !== "ok") {
      const causeStr = simulationResult.revertReason
        ? ` (reason: ${simulationResult.revertReason})`
        : simulationResult.rpcError
          ? ` (rpcError: ${simulationResult.rpcError})`
          : "";
      const message = `TRC-20 preview simulation refused: ${simulationResult.status}${causeStr}`;
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${message}` }],
        structuredContent: {
          ...(errEnvelope("SIMULATION_REFUSED", message) as Record<string, unknown>),
          simulation: simulationResult,
        },
      };
    }
  } else {
    simulationResult = _simulationTron.emitNoSimulationAvailable();
    // status: "not-applicable" — NOT a refusal. Per CONTEXT D-03b.
  }

  // ---- Recompute presignHash for LEDGER BLIND-SIGN HASH block -----------
  const rawDataBytes = Buffer.from(tronTx.rawDataHex, "hex");
  const { presignHash } = _tronPresign.computeTronPresignHash({
    rawDataBytes: new Uint8Array(rawDataBytes),
  });

  // ---- Mint previewToken + pin -------------------------------------------
  const previewToken = crypto.randomUUID();
  const trans = transitionToPreviewed(record.handle, {
    nonce: 0,             // sentinel (TRON has no EVM nonce)
    gas: 0n,              // sentinel
    maxFeePerGas: 0n,     // sentinel
    maxPriorityFeePerGas: 0n, // sentinel
    previewToken,
    presignHash,
    selector: tronTx.kind === "trc20" ? "0xa9059cbb" : null,
  });
  if (!trans.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: handle state changed during preview (${trans.errorCode})`,
        },
      ],
      structuredContent: errEnvelope(
        trans.errorCode,
        `handle transition failed: ${trans.errorCode}`,
      ) as Record<string, unknown>,
    };
  }

  // ---- Render text blocks ------------------------------------------------
  const prepareReceipt = tronTx.kind === "native"
    ? PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE
        .replace("{TO}", record.args.to)
        .replace("{SUN}", record.args.sun!)
        .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
        .replace("{EXPIRATION}", String(tronTx.expiration))
    : PREPARE_RECEIPT_TRON_TRC20_TEMPLATE
        .replace("{TO}", record.args.to)
        .replace("{TOKEN_ADDRESS}", record.args.tokenAddress!)
        .replace("{AMOUNT}", record.args.amount!)
        .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
        .replace("{EXPIRATION}", String(tronTx.expiration));

  const blindSignHashBlock = LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE
    .replace("{HASH_FULL_64HEX}", presignHash)
    .replace("{HASH_CHUNKED_4_CHAR_GROUPS}", chunkTronHash(presignHash));

  const simulationBlock = tronTx.kind === "trc20"
    ? SIMULATION_BLOCK_TRON_TEMPLATE
        .replace("{STATUS}", simulationResult.status)
        .replace("{REVERT_REASON}", simulationResult.revertReason ?? "n/a")
        .replace("{ENERGY_USED}", simulationResult.energyUsed?.toString() ?? "n/a")
        .replace("{CONSTANT_RESULT_PREVIEW}", simulationResult.constantResult.slice(0, 1).join("") || "n/a")
    : NO_SIMULATION_AVAILABLE_TRON_TEMPLATE;

  const noticeDecision = shouldEmitTronLedgerNotice(tronTx);
  const ledgerNoticeBlock = noticeDecision.emit
    ? LEDGER_NOTICE_TRON_TEMPLATE
        .replace("{INSTRUCTION_NAME}", noticeDecision.instructionName)
        .replace("{REGISTRY_STATUS}", noticeDecision.reason)
    : "";

  const responseTextParts = [
    prepareReceipt,
    ...(ledgerNoticeBlock ? [ledgerNoticeBlock] : []),
    blindSignHashBlock,
    simulationBlock,
    VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
    `\nPreview token: ${previewToken}`,
    `\nNext step: send_transaction({ handle: "${record.handle}", previewToken: "${previewToken}", userDecision: "send" })`,
  ];
  const responseText = responseTextParts.filter(Boolean).join("\n\n");

  return {
    content: [{ type: "text", text: responseText }],
    structuredContent: {
      handle: record.handle,
      chain: "tron",
      kind: tronTx.kind,
      previewToken,
      presignHash,
      simulation: simulationResult,
      payloadFingerprint: record.payloadFingerprint,
      decodedArgs: tronTx.instructionSummary,
      blockHeader: {
        refBlockBytes: tronTx.refBlockBytes,
        refBlockHash: tronTx.refBlockHash,
        expiration: tronTx.expiration,
      },
      rawDataHex: tronTx.rawDataHex,
      // Phase 18 — no WC session topic for TRON (USB-HID bypasses WC).
      sessionTopicLast8: null,
    },
  };
}

// ===========================================================================
// Phase 23 — Plan 23-04 — BTC branch (additive; lives OUTSIDE the FROZEN
// three-gate region). Dispatcher reads `record.tx.txType === "btc"` and
// routes here. The EVM / Solana / TRON branches above stay byte-identical.
//
// BTC preview divergence from TRON/Solana:
//   - No RPC pin (no chain client; UTXO model, no nonce/gas).
//   - Layer 1 fingerprint recompute from the CANONICAL ARTIFACT:
//     `unsignedTxHex + perInputPrevouts` (NOT a re-parsed PSBT — Pitfall 5).
//   - N per-input sighash rows in LEDGER BLIND-SIGN HASH (BTC) block.
//   - `presignHash` = payloadFingerprint (BTC has no separate presign hash).
//   - `sessionTopicLast8 = null` (BTC uses USB-HID + Esplora, not WC).
// ===========================================================================

/**
 * Chunk a 64-hex BTC sighash (no 0x prefix) into 8 groups of 8 chars for
 * readable on-device comparison. Stays inline here (not in blocks-btc.ts
 * which is format-fanout-frozen).
 */
function chunkBtcHash(hashFull: string): string {
  const raw = hashFull.startsWith("0x") ? hashFull.slice(2) : hashFull;
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += 8) {
    groups.push(raw.slice(i, i + 8));
  }
  return groups.join(" ");
}

/**
 * Preview a BTC-typed handle. EVM/Solana/TRON bodies stay byte-identical;
 * this branch is the additive Plan 23-04 surface.
 *
 * Steps:
 *   1. Recompute payloadFingerprint from `unsignedTxHex + perInputPrevouts`
 *      (canonical artifact — NOT re-parsed PSBT). Refuse on drift.
 *   2. Mint a fresh previewToken UUID.
 *   3. Pin via `transitionToPreviewed` (sentinel zeros for EVM-only fields;
 *      presignHash = payloadFingerprint for BTC).
 *   4. Render PREPARE RECEIPT (BTC) + LEDGER BLIND-SIGN HASH (BTC, N rows).
 *   5. Return structuredContent with chain:"bitcoin", previewToken, etc.
 */
async function previewSendBtcBranch(
  record: HandleRecord & { tx: PreparedTxBtc },
): Promise<{
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
}> {
  const btcTx = record.tx;

  // ---- Layer 1: fingerprint recompute from CANONICAL ARTIFACT (Pitfall 5) ----
  // Do NOT re-parse the PSBT — use unsignedTxHex + perInputPrevouts.
  const sighashInputs = btcTx.perInputPrevouts.map((p) => ({
    scriptType: p.scriptType,
    prevOutScript: p.script,
    valueSats: p.valueSats,
  }));
  const perInputSighashes = _btcSighash.computeAllSighashes(
    BtcTransaction.fromHex(btcTx.unsignedTxHex),
    sighashInputs,
  );
  const recomputed = _btcFingerprint.computeBtcPayloadFingerprint(perInputSighashes);

  if (recomputed !== record.payloadFingerprint) {
    const message =
      "error: payloadFingerprint drift detected between prepare and preview; abort and re-run prepare_btc_send";
    return {
      isError: true,
      content: [{ type: "text", text: message }],
      structuredContent: errEnvelope(
        "PAYLOAD_FINGERPRINT_DRIFT",
        "payloadFingerprint drift (BTC preview) — re-run prepare_btc_send",
      ),
    };
  }

  // ---- Mint previewToken + pin via transitionToPreviewed ------------------
  const previewToken = crypto.randomUUID();
  // BTC has no separate presign hash — the payloadFingerprint IS the binding value.
  const presignHash = record.payloadFingerprint;

  const trans = transitionToPreviewed(record.handle, {
    nonce: 0,
    gas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    previewToken,
    presignHash,
    selector: null,
  });
  if (!trans.ok) {
    const message = `error: handle state changed during BTC preview (${trans.errorCode})`;
    return {
      isError: true,
      content: [{ type: "text", text: message }],
      structuredContent: errEnvelope(trans.errorCode, `handle transition failed: ${trans.errorCode}`),
    };
  }

  // ---- Render PREPARE RECEIPT (BTC) ---------------------------------------
  const inputRows = btcTx.inputs
    .map((inp) =>
      INPUT_ROW_BTC_TEMPLATE
        .replace("{TXID_SHORT}", inp.txid.slice(0, 8))
        .replace("{VOUT}", String(inp.vout))
        .replace("{VALUE_SATS}", inp.valueSats.toString())
        .replace("{SCRIPT_TYPE}", inp.scriptType),
    )
    .join("\n");

  const outputRows = btcTx.outputs
    .map((out) =>
      OUTPUT_ROW_BTC_TEMPLATE
        .replace("{ADDRESS_SHORT}", out.address.slice(0, 12))
        .replace("{VALUE_SATS}", out.valueSats.toString())
        .replace("{ROLE}", out.role),
    )
    .join("\n");

  const prepareReceiptBlock = PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE
    .replace("{TO}", record.args.to)
    .replace("{SATS}", record.args.sats ?? btcTx.outputs[0]?.valueSats.toString() ?? "0")
    .replace("{FEE_SATS}", btcTx.feeSats.toString())
    .replace("{FEE_RATE}", "auto")
    .replace("{INPUT_ROWS}", inputRows)
    .replace("{OUTPUT_ROWS}", outputRows);

  // ---- Render LEDGER BLIND-SIGN HASH (BTC) — N rows, one per input --------
  const sighashRows = perInputSighashes
    .map((sh, idx) => {
      const shHex = "0x" + Buffer.from(sh).toString("hex");
      const scriptType = btcTx.perInputPrevouts[idx]?.scriptType ?? "p2wpkh";
      return INPUT_SIGHASH_ROW_BTC_TEMPLATE
        .replace("{INPUT_INDEX}", String(idx))
        .replace("{SCRIPT_TYPE}", scriptType)
        .replace("{SIGHASH_HEX}", shHex);
    })
    .join("\n");

  const blindSignHashBlock = LEDGER_BLIND_SIGN_HASH_BTC_TEMPLATE
    .replace("{INPUT_COUNT}", String(btcTx.inputs.length))
    .replace("{FEE_SATS}", btcTx.feeSats.toString())
    .replace("{INPUT_SIGHASH_ROWS}", sighashRows);

  // ---- Assemble response text ---------------------------------------------
  const nextStepLine = `Next step: send_transaction({ handle: "${record.handle}", previewToken: "${previewToken}", userDecision: "send" })`;

  const text = [
    prepareReceiptBlock,
    "",
    blindSignHashBlock,
    "",
    nextStepLine,
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      handle: record.handle,
      chain: "bitcoin",
      kind: btcTx.kind,
      previewToken,
      presignHash,
      payloadFingerprint: record.payloadFingerprint,
      feeSats: btcTx.feeSats.toString(),
      inputCount: btcTx.inputs.length,
      outputCount: btcTx.outputs.length,
      // Phase 23 — BTC uses USB-HID Ledger + Esplora direct broadcast (no WC relay).
      sessionTopicLast8: null,
    },
  };
}
