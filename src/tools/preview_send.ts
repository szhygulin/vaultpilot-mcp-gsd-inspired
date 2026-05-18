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

import { getChainClient } from "../chains/registry.js";
import { lookupSelector } from "../clients/fourbyte.js";
import {
  chainIdFromName,
  chainNameFromId,
  getAaveV3PoolAddress,
  getWethAddress,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona } from "../demo/state.js";
import { _aaveProtocols, type AaveV3Decoded } from "../protocols/aave-v3.js";
import { _protocols, type Erc20Decoded } from "../protocols/erc20.js";
import { WETH9_SELECTORS } from "../protocols/weth9.js";
import {
  AGENT_TASK_TEMPLATE,
  CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TEMPLATE,
  LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TEMPLATE,
  build4byteBlock,
  buildAaveDecodedArgsBlock,
  buildDecodedArgsBlock,
  buildSimulationBlock,
  chunkHex,
} from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { lookup, transitionToPreviewed } from "../signing/handle-store.js";
import { computePresignHash } from "../signing/presign-hash.js";
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
  "Read the LEDGER BLIND-SIGN HASH block to the user; perform the four checks in the AGENT TASK block; emit your results in a `CHECKS PERFORMED` block before asking the user to confirm send.",
  "Do NOT skip preview_send and call send_transaction directly — send_transaction's schema-level gate refuses without a valid previewToken (which only this tool mints).",
  "Returns `{ previewToken, presignHash, chainId, nonce, gas, maxFeePerGas, maxPriorityFeePerGas, selector, fourbyte }` plus the three-block text payload (LEDGER BLIND-SIGN HASH, AGENT TASK, 4BYTE CROSS-CHECK) and a VERIFY BEFORE SIGNING summary.",
  "Idempotent re-preview (Q4): calling preview_send twice on the same handle re-pins fresh nonce/gas/fees and INVALIDATES the prior previewToken. Only the most recent token matches at send time — call again after a long pause to freshen the pin.",
  "In demo mode, succeeds against the active persona's address as the SENDER for nonce/gas/fees resolution; the LEDGER BLIND-SIGN HASH block is emitted unchanged so the rehearsal exercises the same verification ritual the real flow uses.",
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

    // Phase 7 — Plan 07-03: two-tier selector dispatch. If the ERC-20 decoder
    // returned `kind: "unknown"`, try the Aave V3 decoder. ERC-20 selectors
    // (transfer / approve / WETH9.withdraw) take precedence — the ABI dispatch
    // tables are disjoint, so a clean fall-through is sufficient.
    let aaveDecoded: AaveV3Decoded | null = null;
    if (decodedArgs.kind === "unknown") {
      const aave = _aaveProtocols.decodeAaveV3Call(record.tx.data);
      if (aave.kind !== "unknown") aaveDecoded = aave;
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
    } else if (decodedArgs.kind === "transfer" || decodedArgs.kind === "approve") {
      const registry = loadTokenRegistry(record.tx.chainId as ChainId);
      const entry = registry.find((e) => e.address === record.tx.to);
      tokenContext = entry
        ? { symbol: entry.symbol, decimals: entry.decimals }
        : null;
    }

    // Decoded-args block selection — the Aave path uses the parallel helper
    // (separate from the ERC-20 helper to keep both byte-frozen against
    // template drift).
    const decodedArgsBlock =
      aaveDecoded !== null
        ? buildAaveDecodedArgsBlock(
            aaveDecoded,
            tokenContext,
            getAaveV3PoolAddress(record.tx.chainId as ChainId),
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
    const ledgerNoticeBlock: string | null = isWethUnwrap
      ? LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE
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
        // Plan 06-04: tag for forward-looking get_tx_verification re-emit
        // (Plan 04-05 re-emit will need to pick up this branch in Phase 9).
        // `null` when not a WETH unwrap; canonical tag string when emitted.
        ledgerNotice: isWethUnwrap ? ("weth-unwrap-blind-sign" as const) : null,
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
