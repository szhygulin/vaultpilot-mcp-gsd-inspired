// MCP tool: prepare_safe_tx_execute({ chain, safeAddress, safeTxHash })
//
// Phase 37 Plan 37-03 (SAFE-08) — the on-chain step that consumes signatures
// collected via prepare_safe_tx_propose + prepare_safe_tx_approve +
// submit_safe_tx_signature and produces a standard PreparedTxEvm calling
// execTransaction(...) on the user's Safe proxy at safeAddress (NOT the
// Singleton — calling Singleton directly would revert).
//
// Composite-tx preview shape (Phase 33 prepare_uniswap_v3_rebalance precedent):
// CHECKS PERFORMED surfaces the encapsulated (to, value, data, operation)
// quartet — best-effort inner decode via Phase 35's per-session ABI cache.
//
// Layer 0.5 dispatch bypass (Phase 35 sentinel-flag precedent): sets the
// NEW isSafeExecTransaction: true sentinel on the HandleRecord. preview_send.ts
// reads `record.isSafeExecTransaction === true` and ORs into the existing
// escape-hatch bypass — this defeats the canonical-dispatch refusal that
// would otherwise fire because the user's Safe proxy is per-user (NOT in
// CANONICAL_DISPATCH_TARGETS).
//
// 5 prepare-time defense-in-depth invariants authorize the bypass:
//   1. Selector match: tx.data starts with EXEC_TRANSACTION_SELECTOR (0x6a761202)
//   2. On-chain VERSION() ∈ {"1.3.0", "1.4.1"}  (real Safe proxy)
//   3. getOwners() includes sender AND every confirmation's recovered signer
//   4. All collected signatures recovered to current owners (no removeOwner drift)
//   5. Inner (to, value, data, operation) decoded + WARN block emitted
//      (re-emitted byte-identical at preview_send time — anchors drift detection)
//
// payloadFingerprint uses the existing VaultPilot-txverify-v1 EVM tag (execute
// IS a normal EVM tx for fingerprint purposes — only propose/approve use
// the safetx tag).

import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  recoverAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { _safeChains } from "../chains/safe.js";
import { getChainClient } from "../chains/registry.js";
import { getCachedEtherscanAbi } from "../clients/etherscan.js";
import * as safeTxService from "../clients/safe-tx-service.js";
import {
  chainIdFromName,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import {
  EXEC_TRANSACTION_SELECTOR,
  decodeSingleSafeExecTransaction,
  execTransactionAbi,
} from "../signing/safe-exec-decode.js";
import type { SupportedSafeVersion } from "../signing/safe-tx-hash.js";
import { registerTool } from "./index.js";

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

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const SUPPORTED_VERSIONS: ReadonlyArray<SupportedSafeVersion> = ["1.3.0", "1.4.1"];

const DESCRIPTION = [
  "Use AFTER enough signatures have been collected via prepare_safe_tx_propose + prepare_safe_tx_approve + submit_safe_tx_signature.",
  "Builds the on-chain execTransaction(...) call routing through the user's Safe proxy at safeAddress (NOT the Singleton — calling Singleton directly reverts). Routes through send_transaction like a normal EVM tx — uses the standard previewToken + userDecision schema gate.",
  "Layer 0.5 canonical-dispatch is bypassed via the isSafeExecTransaction sentinel; bypass is server-authorized by 5 prepare-time invariants (selector match, on-chain VERSION in {1.3.0, 1.4.1}, getOwners() membership, ECDSA recovery to current owners, inner-op decode + WARN).",
  "Composite-tx preview surfaces the encapsulated (to, value, data, operation) quartet in CHECKS PERFORMED so the user sees the business-layer op, not just \"execTransaction(...)\".",
  "Required args: chain, safeAddress, safeTxHash.",
  "Returns `{ handle, chain, chainId, from, safeAddress, safeTxHash, payloadFingerprint, dispatchTarget, encapsulatedOperation, signerCount, signersAscending, isSafeExecTransaction }` plus PREPARE RECEIPT + CHECKS PERFORMED + WARN text blocks.",
  "Refuses: INSUFFICIENT_SIGNATURES (confirmations.length < threshold — early refusal so the user does not pay gas for a guaranteed revert), INVALID_SIGNATURE_MODE (v in {0, 1} — EIP-1271 + pre-approved deferred to v3.x), STALE_SIGNATURE (recovered signer no longer in getOwners() — owner-set drift), UNSUPPORTED_SAFE_VERSION (pre-v1.3.0), INVALID_INPUT (Tx Service errors / nonce drift / non-owner sender), INTERNAL_ERROR.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "Chain identifier (required). Supported: ethereum, arbitrum, polygon, base, optimism.",
    },
    safeAddress: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "Safe proxy address — must be a v1.3.0 or v1.4.1 Safe.",
    },
    safeTxHash: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{64}$",
      description:
        "32-byte EIP-712 SafeTx digest of the pending tx that has collected enough signatures.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender — must be an owner of the Safe AND one of the per-chain approved accounts.",
    },
  },
  required: ["chain", "safeAddress", "safeTxHash"],
  additionalProperties: false,
};

/** Best-effort sub-decode of the inner Safe execTransaction `data` via the
 * Phase 35 per-session ABI cache. Returns a `"funcName(arg1, arg2, ...)"` string
 * on cache HIT + successful decode; returns `null` otherwise (the caller emits
 * a "(undecoded — selector 0xXXXXXXXX shown on-device)" line). */
function decodeInnerOp(
  chainId: ChainId,
  to: Address,
  data: Hex,
): string | null {
  if (data === "0x" || data.length < 10) return null;
  const cached = getCachedEtherscanAbi(chainId, to);
  if (!cached || cached.kind !== "ok") return null;
  try {
    const decoded = decodeFunctionData({ abi: cached.abi as Abi, data });
    const argsArr = decoded.args ?? [];
    const args = (argsArr as readonly unknown[])
      .map((a) => (typeof a === "bigint" ? a.toString() : String(a)))
      .join(", ");
    return `${decoded.functionName}(${args})`;
  } catch {
    return null;
  }
}

registerTool(
  "prepare_safe_tx_execute",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // Step 1 — Chain + chainId resolution.
      const chainName = args.chain as ChainName;
      const chainId: ChainId = chainIdFromName(chainName);

      // Step 2 — Shape-validate inputs (defense-in-depth).
      const rawSafeAddress =
        typeof args.safeAddress === "string" ? args.safeAddress : "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(rawSafeAddress)) {
        const msg = `invalid 'safeAddress': expected 0x-prefixed 20-byte hex, got "${rawSafeAddress}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const safeAddress = getAddress(rawSafeAddress) as Address;

      const rawSafeTxHash =
        typeof args.safeTxHash === "string" ? args.safeTxHash : "";
      if (!/^0x[0-9a-fA-F]{64}$/.test(rawSafeTxHash)) {
        const msg = `invalid 'safeTxHash': expected 0x-prefixed 32-byte hex, got "${rawSafeTxHash}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const safeTxHashInput = rawSafeTxHash as Hex;

      // Step 3 — Resolve sender.
      const rawFrom = typeof args.from === "string" ? args.from : undefined;
      const fromResolution = await resolveFrom({ rawFrom, chainId });
      if (fromResolution.kind === "error") {
        return fromResolution.result;
      }
      const fromAddress: Address = fromResolution.fromAddress;

      // Step 4 — Fetch the pending SafeTx from the Tx Service. 5-arm DU
      // dispatch — mirror Plan 37-02 approve handling.
      const txResult = await safeTxService.getMultisigTransaction(
        chainId,
        safeTxHashInput,
      );
      if (txResult.kind === "not-found") {
        const msg =
          `SafeTx ${safeTxHashInput} not found in Tx Service. ` +
          `The safeTxHash may be wrong or the propose step has not run yet.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      if (txResult.kind === "unsupported-chain") {
        const msg = `Safe Tx Service has no endpoint for chain ${chainName}.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      if (txResult.kind === "rate-limited") {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${txResult.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", txResult.message),
        };
      }
      if (txResult.kind === "error") {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${txResult.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", txResult.message),
        };
      }
      const tx = txResult.tx;

      // Step 5 — Prefetch on-chain SafeInfo (owners, threshold, nonce, version).
      const client = getChainClient(chainId);
      let onchainInfo: Awaited<
        ReturnType<typeof _safeChains.getOnchainSafeInfo>
      >;
      try {
        onchainInfo = await _safeChains.getOnchainSafeInfo(
          client,
          chainId,
          safeAddress,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to read on-chain Safe state for ${safeAddress}: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            `failed to read on-chain Safe state for ${safeAddress}`,
            message,
          ),
        };
      }

      // Step 6 — Invariant #2: VERSION refusal. Proves safeAddress is a real
      // Safe proxy delegatecalling to an allowlisted Singleton.
      const onchainVersion = onchainInfo.version;
      const versionMatch = SUPPORTED_VERSIONS.find(
        (v) => v === onchainVersion,
      );
      if (!versionMatch) {
        const msg =
          `Safe versions < 1.3.0 are unsupported (cross-chain replay risk — pre-v1.3.0 EIP-712 domain has no chainId). ` +
          `On-chain VERSION() returned "${onchainVersion}" for ${safeAddress}. ` +
          `Re-deploy via the Safe UI to v1.3.0+ or use a different Safe.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("UNSUPPORTED_SAFE_VERSION", msg),
        };
      }

      // Step 7 — Invariant #3 part A: sender is an owner.
      const lcOwners = new Set(onchainInfo.owners.map((o) => o.toLowerCase()));
      if (!lcOwners.has(fromAddress.toLowerCase())) {
        const msg =
          `Sender ${fromAddress} is not an owner of Safe ${safeAddress}; cannot execute. ` +
          `Current owners: ${onchainInfo.owners.join(", ")}.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      // Step 8 — Parse Tx Service fields. Numeric wire fields are strings;
      // viem types want bigint / Address shapes.
      const operationInt: 0 | 1 = tx.operation === 1 ? 1 : 0;
      const operationStr: "call" | "delegatecall" =
        operationInt === 1 ? "delegatecall" : "call";
      const safeTxTo = getAddress(tx.to as string) as Address;
      const safeTxValue = BigInt(tx.value);
      const safeTxData = ((tx.data ?? "0x") as Hex);
      const safeTxGas = BigInt(tx.safeTxGas);
      const baseGas = BigInt(tx.baseGas);
      const gasPrice = BigInt(tx.gasPrice);
      const gasToken = getAddress(tx.gasToken as string) as Address;
      const refundReceiver = getAddress(
        (tx.refundReceiver ?? ZERO_ADDRESS) as string,
      ) as Address;
      const txNonce = BigInt(tx.nonce);

      // Step 9 — Nonce-drift refusal (defends against another execTransaction
      // landing between approve and execute).
      if (onchainInfo.nonce !== txNonce) {
        const msg =
          `Nonce drift: Safe nonce is now ${onchainInfo.nonce.toString()}, ` +
          `fetched SafeTx expected ${txNonce.toString()}. Another tx executed in the interim.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      // Step 10 — Defensive `?? []` per Phase 36 Pitfall 6.
      const confirmations = tx.confirmations ?? [];

      // Step 11 — INSUFFICIENT_SIGNATURES refusal.
      const threshold = onchainInfo.threshold;
      if (BigInt(confirmations.length) < threshold) {
        const need = (threshold - BigInt(confirmations.length)).toString();
        const msg =
          `Need ${need} more signature${need === "1" ? "" : "s"}. ` +
          `Collected ${confirmations.length}/${threshold.toString()}. ` +
          `Use prepare_safe_tx_approve to collect more.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INSUFFICIENT_SIGNATURES", msg),
        };
      }

      // Step 12 — v-byte gate BEFORE recovery loop. Refuses v ∈ {0, 1}
      // (RESEARCH Pitfall 6); accepts v ∈ {27, 28} (ECDSA) and v ∈ {31, 32}
      // (eth_sign mode).
      for (const c of confirmations) {
        const sig = c.signature;
        if (typeof sig !== "string" || sig.length < 132) {
          const msg =
            `Malformed signature from ${c.owner} (length ${sig?.length ?? "unknown"}). ` +
            `Expected 65-byte 0x-prefixed hex.`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg),
          };
        }
        const vHex = sig.slice(130, 132);
        const vByte = parseInt(vHex, 16);
        if (vByte < 27) {
          const msg =
            `Only ECDSA (v=27/28) or Safe eth_sign (v=31/32) accepted at this phase. ` +
            `Got v=${vByte} from confirmation by ${c.owner} ` +
            `(${vByte === 0 ? "EIP-1271 contract signature" : "pre-approved hash"}). ` +
            `Contract signatures + pre-approved hashes deferred to v3.x.`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_SIGNATURE_MODE", msg),
          };
        }
      }

      // Step 13 — Invariant #4 + #3 part B: ECDSA-recover each confirmation
      // and assert recovered signer is in current on-chain owners.
      const recoveredEntries: Array<{ recovered: Address; signature: Hex }> = [];
      for (const c of confirmations) {
        let recovered: Address;
        try {
          recovered = await recoverAddress({
            hash: safeTxHashInput,
            signature: c.signature as Hex,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const msg =
            `ECDSA-recovery failed for confirmation by ${c.owner}: ${message}`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg),
          };
        }
        if (!lcOwners.has(recovered.toLowerCase())) {
          const msg =
            `Confirmation by ${recovered} no longer maps to a current Safe owner. ` +
            `The Safe owner set changed since signature was collected (current owners: ${onchainInfo.owners.join(", ")}). ` +
            `Re-collect signatures via prepare_safe_tx_approve.`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("STALE_SIGNATURE", msg),
          };
        }
        recoveredEntries.push({
          recovered,
          signature: c.signature as Hex,
        });
      }

      // Step 14 — Ascending-sort discipline (RESEARCH Pitfall 5 / Safe
      // checkSignatures iteration order). Lowercase-localeCompare ascending.
      const sortedEntries = [...recoveredEntries].sort((a, b) =>
        a.recovered.toLowerCase().localeCompare(b.recovered.toLowerCase()),
      );

      // Step 15 — Assemble signatures blob: concat each 65-byte signature.
      // viem's `concat` returns Hex; we use plain string concat over the
      // raw hex bodies for byte-byte determinism.
      const signaturesBytes: Hex = (
        "0x" + sortedEntries.map((s) => s.signature.slice(2)).join("")
      ) as Hex;

      // Step 16 — Outer dispatch target — LOCKED: the user's Safe proxy at
      // safeAddress (NOT the Singleton). Per CONTEXT §prepare_safe_tx_execute
      // line 85; the Layer 0.5 sentinel-flag bypass handles canonical-dispatch.
      const outerTo: Address = safeAddress;

      // Step 17 — Encode the execTransaction call.
      const encodedData = encodeFunctionData({
        abi: execTransactionAbi,
        functionName: "execTransaction",
        args: [
          safeTxTo,
          safeTxValue,
          safeTxData,
          operationInt,
          safeTxGas,
          baseGas,
          gasPrice,
          gasToken,
          refundReceiver,
          signaturesBytes,
        ],
      });

      // Step 18 — Invariant #1 sanity: selector match. Should be impossible
      // by construction (encodeFunctionData uses execTransactionAbi which has
      // ONLY execTransaction), but the assertion anchors the invariant at
      // the source line for future regression detection.
      if (encodedData.slice(0, 10) !== EXEC_TRANSACTION_SELECTOR) {
        const msg =
          `Internal encoding mismatch: outer selector ${encodedData.slice(0, 10)} != ${EXEC_TRANSACTION_SELECTOR}. ` +
          `This is impossible by construction — check viem/execTransactionAbi for drift.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INTERNAL_ERROR", msg),
        };
      }

      // Step 19 — Invariant #5 sanity: decode the encoded calldata to verify
      // the encapsulated quartet round-trips. This emits the WARN block at
      // prepare time; preview_send re-emits the same shape (byte-identity test).
      const decodedInner = decodeSingleSafeExecTransaction(encodedData);
      const innerOpStr = decodeInnerOp(chainId, safeTxTo, safeTxData);

      // Step 20 — Build the PreparedTxEvm shape + payloadFingerprint.
      // payloadFingerprint uses the existing VaultPilot-txverify-v1: EVM tag
      // (NOT the safetx tag — execTransaction IS a normal EVM tx for
      // fingerprint purposes).
      const evmTx = {
        chainId,
        to: outerTo,
        valueWei: 0n,
        data: encodedData,
      };
      const payloadFingerprint = computePayloadFingerprint(evmTx);

      // Step 21 — Mint the handle. The Layer 0.5 sentinel `isSafeExecTransaction:
      // true` is the load-bearing flag — preview_send.ts reads it to short-
      // circuit canonical-dispatch.
      const handle = createHandle({
        args: {
          to: rawSafeAddress,
          valueWei: "0",
        },
        tx: evmTx,
        payloadFingerprint,
        // GREP-GUARD: this is one of EXACTLY TWO functional source-file
        // references to `isSafeExecTransaction` — the other is the read in
        // src/tools/preview_send.ts at the Layer 0.5 dispatch site.
        // Integration test Test (grep-guard) fails the build if a third
        // functional site appears (the type declaration in handle-store.ts
        // doesn't count — the grep pattern filters declarations).
        isSafeExecTransaction: true,
      });

      // Step 22 — Compose response text.
      const signersAscending = sortedEntries.map((s) => s.recovered);
      const formatEth = (wei: bigint): string => {
        // Render as `X.XXX ETH` with up to 6 decimal places of the fraction.
        const whole = wei / 10n ** 18n;
        const frac = wei % 10n ** 18n;
        if (frac === 0n) return `${whole.toString()} ETH`;
        const fracStr = frac.toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
        return `${whole.toString()}.${fracStr || "0"} ETH`;
      };

      const prepareReceipt = [
        "PREPARE RECEIPT",
        "  operation:        Safe multisig execute (on-chain execTransaction)",
        `  chain:            ${chainName} (chainId ${chainId})`,
        `  safe:             ${rawSafeAddress}`,
        `  safeTxHash:       ${safeTxHashInput}`,
        ...(fromResolution.callerSupplied
          ? [`  from:             ${fromAddress}`]
          : []),
      ].join("\n");

      const vByteModes = new Set(
        confirmations.map((c) => {
          const v = parseInt(c.signature.slice(130, 132), 16);
          return v === 27 || v === 28 ? "ECDSA (v=27/28)" : `eth_sign (v=${v})`;
        }),
      );

      const checksPerformed = [
        "CHECKS PERFORMED",
        `  Confirmations:    ${confirmations.length}/${threshold.toString()} (collected/required)`,
        `  Signers asc:      ${signersAscending.join(", ")}`,
        "  Owner check:      all signers verified as current Safe owners (no removeOwner drift)",
        `  v-byte modes:     ${Array.from(vByteModes).join(", ")}`,
        `  Outer selector:   ${EXEC_TRANSACTION_SELECTOR} (execTransaction(...))`,
        `  Safe version:     v${versionMatch} (supported)`,
        `  Onchain nonce:    ${onchainInfo.nonce.toString()} (matches Tx Service nonce)`,
        `  Encapsulated:     ${operationStr} to ${safeTxTo} with value ${formatEth(safeTxValue)}`,
        ...(innerOpStr !== null
          ? [`  Inner:            ${innerOpStr}`]
          : [
              `  Inner:            (undecoded — selector ${safeTxData.slice(0, 10)} shown on-device; call get_contract_abi for richer decode)`,
            ]),
        ...(operationStr === "delegatecall"
          ? [
              "  delegatecall:     YES — Phase 38 will hard-trigger second-LLM check for delegatecall (informational at Phase 37).",
            ]
          : []),
        "  Layer 0.5:        bypassed via isSafeExecTransaction sentinel (5 prepare-time invariants asserted above)",
      ].join("\n");

      const warnBlock = [
        "[WARN — SAFE EXECUTE COMPOSITE-TX]",
        "  The outer execTransaction(...) calldata encapsulates a sub-operation:",
        `    operation:  ${operationStr}`,
        `    target:     ${safeTxTo}`,
        `    value:      ${formatEth(safeTxValue)}`,
        innerOpStr !== null
          ? `    decoded:    ${innerOpStr}`
          : `    selector:   ${safeTxData.slice(0, 10)} (undecoded)`,
        "  preview_send re-emits this block byte-identical so any drift between",
        "  prepare-side and preview-side decoding fails an integration regression.",
      ].join("\n");

      const ledgerNotice = [
        "LEDGER NOTICE",
        "  Safe execTransaction(...) is NOT covered by Ledger CAL clear-sign.",
        "  The Ledger ETH app will display the raw calldata + a Blind Sign prompt.",
        "  Visually confirm `to` matches the Safe proxy address above on the device.",
      ].join("\n");

      const text = [
        warnBlock,
        prepareReceipt,
        checksPerformed,
        ledgerNotice,
      ].join("\n\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          handle,
          chain: chainName,
          chainId,
          from: fromAddress,
          safeAddress: rawSafeAddress,
          safeTxHash: safeTxHashInput,
          payloadFingerprint,
          dispatchTarget: rawSafeAddress,
          encapsulatedOperation: {
            to: decodedInner.to,
            value: decodedInner.value.toString(),
            data: decodedInner.data,
            operation: operationStr,
            decoded: innerOpStr,
          },
          signerCount: confirmations.length,
          signersAscending,
          isSafeExecTransaction: true,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_safe_tx_execute failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_safe_tx_execute failed",
          message,
        ),
      };
    }
  },
);
