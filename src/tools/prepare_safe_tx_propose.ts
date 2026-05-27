// MCP tool: prepare_safe_tx_propose({
//   chain, safeAddress, to, value, data, operation,
//   safeTxGas?, baseGas?, gasPrice?, gasToken?, refundReceiver?, from?
// })
//
// Phase 37 Plan 37-01 (SAFE-05) — the FIRST off-chain typed-data signing tool
// in the codebase. Builds the canonical EIP-712 SafeTx hash + the full
// typed-data structure the user signs on the Ledger ETH app via WalletConnect
// `eth_signTypedData_v4`. Returns a `PreparedTxSafeTypedData` handle; the
// agent then calls `submit_safe_tx_signature` (Plan 37-02) to publish the
// signature to the Safe Tx Service.
//
// Refusal pre-flights:
//   - on-chain Safe.VERSION() ∉ {"1.3.0", "1.4.1"} → UNSUPPORTED_SAFE_VERSION
//     (pre-v1.3.0 Safes have no chainId in domain → cross-chain replay risk).
//   - WC session absent → WALLET_NOT_PAIRED (matches every other prepare_* tool).
//   - resolved-from ∉ on-chain getOwners() → INVALID_INPUT.
//
// Cryptographic-binding chain (parallel to Phase 4-35):
//   1. safeTxHash = computeSafeTxHash (EIP-712 typed-data digest, viem.hashTypedData)
//   2. payloadFingerprint = computeSafeTxPayloadFingerprint
//      ("VaultPilot-safetx-v1:" tag preimage — DISTINCT from EVM tag)
//   3. typedDataStructure surfaced for agent inspection / second-LLM cross-verify.
//
// FROZEN cryptographic-binding chain UNTOUCHED for non-Safe handles:
//   - The standard `VaultPilot-txverify-v1:` EVM fingerprint path is unchanged.
//   - `send_transaction` does NOT broadcast PreparedTxSafeTypedData handles
//     (Plan 37-03 wires the WRONG_HANDLE_KIND structured-refusal arm).
//
// The handle's `safeTxHash` doubles as the txHash stamped onto the handle at
// `transitionToSent` time (Plan 12-05 widening of `record.txHash` to `string`
// accommodates non-EVM identifiers — Safe typed-data digests fit per
// RESEARCH §Open Question 1).
//
// LEDGER DISPLAY block surfaces BOTH possible on-device displays per CONTEXT
// lock §"Typed-data signing transport":
//   - Clear-sign (if CAL covers the Safe contract): field-by-field SafeTx
//     display + the 32-byte digest at the end.
//   - Blind-sign (CAL coverage missing): the 32-byte digest only. The user
//     visually confirms the digest matches `safeTxHash` from the response.
// Phase 37 does NOT detect CAL coverage server-side — no public Ledger API.

import {
  hashDomain,
  type Address,
  type Hex,
  type TypedData,
  getAddress,
} from "viem";

import { _safeChains } from "../chains/safe.js";
import { getChainClient } from "../chains/registry.js";
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
import {
  createHandle,
  type PreparedTxSafeTypedData,
} from "../signing/handle-store.js";
import { computeSafeTxPayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import {
  buildSafeEIP712TypedData,
  computeSafeTxHash,
  type SafeOperation,
  type SupportedSafeVersion,
} from "../signing/safe-tx-hash.js";
import {
  decodeEnableModuleCalldata,
  isEnableModuleCalldata,
} from "../protocols/safe.js";
import {
  HARD_TRIGGER_DELEGATECALL_TEMPLATE,
  HARD_TRIGGER_MODULE_ENABLE_TEMPLATE,
} from "../signing/blocks.js";
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
  "Use FIRST when initiating a Safe multisig transaction.",
  "Off-chain typed-data sign — does NOT broadcast on-chain. Returns a handle the user signs via Ledger ETH app over WalletConnect (eth_signTypedData_v4); the agent then calls submit_safe_tx_signature to publish the signature to the Safe Tx Service.",
  "Required args: chain, safeAddress, to (the Safe will call this address), value (decimal-wei string), data (raw hex calldata, or 0x for native send), operation ('call' or 'delegatecall').",
  "Optional args: safeTxGas / baseGas / gasPrice / gasToken / refundReceiver — defaults all-zero per Safe v1.3.0+ non-relayed convention; non-zero values surface in CHECKS PERFORMED as a WARN.",
  "Pass `from` to act from a non-default approved account; must be an owner of the Safe.",
  "Returns `{ handle, chain, chainId, from, safeAddress, safeVersion, safeTxHash, safeNonce, operation, to, value, data, payloadFingerprint, typedDataStructure }` plus PREPARE RECEIPT + CHECKS PERFORMED + LEDGER DISPLAY text blocks.",
  "Refuses pre-v1.3.0 Safes (UNSUPPORTED_SAFE_VERSION — pre-v1.3.0 EIP-712 domain has no chainId; cross-chain replay risk). Refuses if sender is not an owner of the Safe (INVALID_INPUT).",
  "Failure modes: UNSUPPORTED_SAFE_VERSION, WALLET_NOT_PAIRED, INVALID_INPUT (malformed args / sender not owner), WRONG_MODE, INTERNAL_ERROR.",
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
    to: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Target contract address the Safe will call/delegatecall when execTransaction lands.",
    },
    value: {
      type: "string",
      description:
        "Amount in WEI as a decimal string (use \"0\" for non-payable calls).",
    },
    data: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]*$",
      description:
        "Raw calldata (0x-prefixed hex) the Safe will execute; \"0x\" for native ETH transfer.",
    },
    operation: {
      type: "string",
      enum: ["call", "delegatecall"],
      description:
        "SafeTx operation discriminator. 'call' is the standard case; 'delegatecall' executes the target's code in the Safe's storage context — Phase 38 hard-triggers a second-LLM check via the [HARD-TRIGGER — DELEGATECALL] block. enableModule(...) calldata on the Safe itself hard-triggers via the [HARD-TRIGGER — MODULE ENABLE] block.",
    },
    safeTxGas: {
      type: "string",
      description:
        "Optional legacy gas-relay field (decimal string). Default \"0\" per Safe v1.3.0+ non-relayed convention.",
    },
    baseGas: {
      type: "string",
      description: "Optional legacy gas-relay field. Default \"0\".",
    },
    gasPrice: {
      type: "string",
      description: "Optional legacy gas-relay field. Default \"0\".",
    },
    gasToken: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional legacy gas-relay field. Default 0x000…0 per Safe v1.3.0+ non-relayed convention.",
    },
    refundReceiver: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "Optional legacy gas-relay field. Default 0x000…0.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender — must be an owner of the Safe AND one of the per-chain approved accounts.",
    },
  },
  required: ["chain", "safeAddress", "to", "value", "data", "operation"],
  additionalProperties: false,
};

function parseOptionalBigint(
  raw: unknown,
  fieldName: string,
): { ok: true; value: bigint } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: 0n };
  }
  if (typeof raw !== "string") {
    return { ok: false, message: `invalid '${fieldName}': expected decimal string, got ${typeof raw}` };
  }
  if (!/^[0-9]+$/.test(raw)) {
    return { ok: false, message: `invalid '${fieldName}': expected non-negative decimal string, got "${raw}"` };
  }
  try {
    return { ok: true, value: BigInt(raw) };
  } catch {
    return { ok: false, message: `invalid '${fieldName}': could not parse as bigint: "${raw}"` };
  }
}

function parseOptionalAddress(
  raw: unknown,
  fieldName: string,
): { ok: true; value: Address } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: ZERO_ADDRESS };
  }
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    return {
      ok: false,
      message: `invalid '${fieldName}': expected 0x-prefixed 20-byte hex, got "${String(raw)}"`,
    };
  }
  try {
    return { ok: true, value: getAddress(raw) as Address };
  } catch {
    return {
      ok: false,
      message: `invalid '${fieldName}': not a valid EIP-55 checksum address: "${raw}"`,
    };
  }
}

registerTool(
  "prepare_safe_tx_propose",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // Step 1 — Chain + chainId resolution.
      const chainName = args.chain as ChainName;
      const chainId: ChainId = chainIdFromName(chainName);

      // Step 2 — Shape validation defense-in-depth (the schema layer catches
      // most malformed input; this branch is reachable via direct test invocation).
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

      const rawTo = typeof args.to === "string" ? args.to : "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(rawTo)) {
        const msg = `invalid 'to': expected 0x-prefixed 20-byte hex, got "${rawTo}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const to = getAddress(rawTo) as Address;

      const rawData = typeof args.data === "string" ? args.data : "";
      if (!/^0x[0-9a-fA-F]*$/.test(rawData)) {
        const msg = `invalid 'data': expected 0x-prefixed hex, got "${rawData}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const data = rawData as Hex;

      // Phase 38 Plan 38-01 (Inv #12.5) — pre-flight: if the data prefix is
      // the enableModule selector, verify the argument decode succeeds BEFORE
      // we proceed (minting a handle for a SafeTx whose hard-trigger emission
      // would silently swallow a truncated-arg decode is a poor UX). The
      // selector match itself does NOT refuse — only a TRUNCATED arg refuses
      // with INVALID_INPUT per CONTEXT §"enableModule calldata parsing".
      // `to === safeAddress` gate is applied at the emission site below; this
      // pre-flight only catches malformed bytes.
      if (isEnableModuleCalldata(data)) {
        try {
          decodeEnableModuleCalldata(data);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const msg =
            "SafeTx data starts with enableModule selector but argument decode failed; bytes may be malformed";
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg} (${message})` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg, message),
          };
        }
      }

      const rawValue = typeof args.value === "string" ? args.value : "";
      const valueParse = parseOptionalBigint(rawValue, "value");
      if (!valueParse.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${valueParse.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", valueParse.message),
        };
      }
      const value = valueParse.value;

      // Step 3 — operation discriminator.
      const rawOperation =
        typeof args.operation === "string" ? args.operation : "";
      if (rawOperation !== "call" && rawOperation !== "delegatecall") {
        const msg = `invalid 'operation': expected 'call' or 'delegatecall', got "${rawOperation}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const operationStr: "call" | "delegatecall" = rawOperation;
      const operationInt: SafeOperation = operationStr === "call" ? 0 : 1;

      // Step 4 — optional gas-relay quintet (defaults to zero per Safe v1.3.0+
      // non-relayed convention — RESEARCH §Pitfall 7).
      const safeTxGasParse = parseOptionalBigint(args.safeTxGas, "safeTxGas");
      if (!safeTxGasParse.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${safeTxGasParse.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", safeTxGasParse.message),
        };
      }
      const baseGasParse = parseOptionalBigint(args.baseGas, "baseGas");
      if (!baseGasParse.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${baseGasParse.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", baseGasParse.message),
        };
      }
      const gasPriceParse = parseOptionalBigint(args.gasPrice, "gasPrice");
      if (!gasPriceParse.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${gasPriceParse.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", gasPriceParse.message),
        };
      }
      const gasTokenParse = parseOptionalAddress(args.gasToken, "gasToken");
      if (!gasTokenParse.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${gasTokenParse.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", gasTokenParse.message),
        };
      }
      const refundReceiverParse = parseOptionalAddress(
        args.refundReceiver,
        "refundReceiver",
      );
      if (!refundReceiverParse.ok) {
        return {
          isError: true,
          content: [
            { type: "text", text: `error: ${refundReceiverParse.message}` },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            refundReceiverParse.message,
          ),
        };
      }
      const safeTxGas = safeTxGasParse.value;
      const baseGas = baseGasParse.value;
      const gasPrice = gasPriceParse.value;
      const gasToken = gasTokenParse.value;
      const refundReceiver = refundReceiverParse.value;
      const anyGasRelayNonZero =
        safeTxGas !== 0n ||
        baseGas !== 0n ||
        gasPrice !== 0n ||
        gasToken !== ZERO_ADDRESS ||
        refundReceiver !== ZERO_ADDRESS;

      // Step 5 — Resolve sender (real mode pairs through WC; demo mode pulls
      // the active persona; mismatch refuses with WALLET_NOT_PAIRED / WRONG_MODE).
      const rawFrom = typeof args.from === "string" ? args.from : undefined;
      const fromResolution = await resolveFrom({ rawFrom, chainId });
      if (fromResolution.kind === "error") {
        return fromResolution.result;
      }
      const fromAddress: Address = fromResolution.fromAddress;

      // Step 6 — Prefetch on-chain SafeInfo + domainSeparator in parallel
      // (Phase 33 prepare_uniswap_v3_rebalance Promise.all pattern). The
      // `_safeChains` ESM-spy seam allows tests to stub these RPC calls.
      const client = getChainClient(chainId);
      let onchainInfo: Awaited<
        ReturnType<typeof _safeChains.getOnchainSafeInfo>
      >;
      let onchainDomain: Hex;
      try {
        [onchainInfo, onchainDomain] = await Promise.all([
          _safeChains.getOnchainSafeInfo(client, chainId, safeAddress),
          _safeChains.getOnchainDomainSeparator(client, chainId, safeAddress),
        ]);
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

      // Step 7 — Version refusal. Pre-v1.3.0 Safes have an EIP-712 domain
      // WITHOUT chainId → cross-chain replay risk. v2.5 explicitly refuses.
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
      const safeVersion: SupportedSafeVersion = versionMatch;

      // Step 8 — Owner check. The on-chain getOwners() is the access boundary
      // — the agent's `from` argument must resolve to one of the current owners.
      const lcOwners = new Set(
        onchainInfo.owners.map((o) => o.toLowerCase()),
      );
      if (!lcOwners.has(fromAddress.toLowerCase())) {
        const msg =
          `Sender ${fromAddress} is not an owner of Safe ${safeAddress}. ` +
          `Current owners: ${onchainInfo.owners.join(", ")}.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      // Step 9 — Compute safeTxHash + typedDataStructure + payloadFingerprint.
      const safeTxHashInput = {
        chain: chainId,
        safeAddress,
        safeVersion,
        to,
        value,
        data,
        operation: operationInt,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        nonce: onchainInfo.nonce,
      };
      const safeTxHash = computeSafeTxHash(safeTxHashInput);
      const typedDataStructure = buildSafeEIP712TypedData(safeTxHashInput);
      const payloadFingerprint = computeSafeTxPayloadFingerprint({
        chain: chainId,
        safeAddress,
        safeVersion,
        safeTxHash,
        nonce: onchainInfo.nonce,
        operation: operationInt,
        to,
        value,
        data,
      });

      // Step 10 — Domain-separator cross-check. Locally re-derive the EIP-712
      // domain hash from {chainId, verifyingContract} and compare against the
      // on-chain Safe.domainSeparator() value. Non-matching value is
      // INFORMATIONAL (the typed-data digest is correct by construction per
      // EIP-712 spec — client computes domain independently); surfaced in
      // CHECKS PERFORMED as a `domainSeparatorDrift` warning.
      // Cast through TypedData mirrors safe-tx-hash.ts::computeSafeTxHash —
      // viem's strict typing wants `chainId: bigint`; the codebase locks
      // `chainId: number` (RESEARCH §Pitfall 2). At runtime viem encodes both
      // equivalently as uint256.
      const localDomain = hashDomain({
        domain: typedDataStructure.domain,
        types: { EIP712Domain: typedDataStructure.types.EIP712Domain } as unknown as TypedData,
      });
      const domainMatches = localDomain.toLowerCase() === onchainDomain.toLowerCase();

      // Step 11 — Construct PreparedTxSafeTypedData handle. EVM-shape sentinel
      // fields populated per the union-narrowing rationale at the type
      // definition site (handle-store.ts PreparedTxSafeTypedData doc-comment).
      const tx: PreparedTxSafeTypedData = {
        txType: "safe-typed-data",
        // EVM sentinels.
        chainId: 0,
        to: ZERO_ADDRESS,
        valueWei: 0n,
        data: "0x",
        // Safe-specific cryptographic-binding fields.
        chain: chainId,
        safeAddress,
        safeVersion,
        safeTxHash,
        safeNonce: onchainInfo.nonce,
        operation: operationStr,
        safeTxTo: to,
        safeTxValue: value,
        safeTxData: data,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        typedDataStructure,
      };

      // Step 12 — Mint the handle. PREPARE RECEIPT carries verbatim agent
      // strings (rawValue, rawData) per CLAUDE.md T-PREP-RCPT-1 invariant.
      const handle = createHandle({
        args: {
          to: rawTo,
          valueWei: rawValue,
          data: rawData,
        },
        tx,
        payloadFingerprint,
      });

      // Step 13 — Compose response. Three text blocks joined by "\n\n":
      //   PREPARE RECEIPT  — verbatim agent args
      //   CHECKS PERFORMED — Safe version + on-chain owner match + nonce +
      //                       domainSeparator cross-verification + gas-relay
      //                       WARN
      //   LEDGER DISPLAY   — both clear-sign (if CAL) + blind-sign expectations
      const prepareReceipt = [
        "PREPARE RECEIPT",
        "  operation:        Safe multisig propose (off-chain typed-data sign)",
        `  chain:            ${chainName} (chainId ${chainId})`,
        `  safe:             ${rawSafeAddress}`,
        `  safeOperation:    ${operationStr}`,
        `  to:               ${rawTo}`,
        `  value:            ${rawValue}`,
        `  data:             ${rawData}`,
        ...(fromResolution.callerSupplied ? [`  from:             ${fromAddress}`] : []),
      ].join("\n");

      const checksPerformed = [
        "CHECKS PERFORMED",
        `  safeVersion:      v${safeVersion} (supported)`,
        `  ownerCheck:       sender ${fromAddress} is in on-chain getOwners()`,
        `  onchainNonce:     ${onchainInfo.nonce.toString()} (used as SafeTx nonce)`,
        `  onchainThreshold: ${onchainInfo.threshold.toString()} signatures required`,
        `  domainSeparator:  ${domainMatches ? "matches viem.hashDomain({chainId, verifyingContract})" : "DRIFT — on-chain " + onchainDomain + " ≠ local " + localDomain + " (informational; typed-data digest is correct by construction)"}`,
        ...(anyGasRelayNonZero
          ? [
              "  WARN gas-relay:   non-zero safeTxGas/baseGas/gasPrice/gasToken/refundReceiver — most Safe co-signers expect all-zero (Safe v1.3.0+ non-relayed convention). Confirm the values match what the other owners will sign.",
            ]
          : []),
      ].join("\n");

      const ledgerDisplay = [
        "LEDGER DISPLAY",
        "  The Ledger ETH app shows the typed-data signature one of two ways:",
        "",
        "  Clear-sign mode (if Ledger CAL/EIP-712 filter file covers this Safe contract):",
        "    field-by-field SafeTx display — \"To: " + rawTo + "\", \"Value: " + rawValue + " wei\", \"Operation: " + operationStr + "\", etc.",
        "    The 32-byte digest is shown at the end.",
        "",
        "  Blind-sign mode (CAL coverage missing — accepted residual at v1.x):",
        "    Sign Hash: " + safeTxHash,
        "",
        "  In EITHER mode, visually confirm the 32-byte digest on-device matches the safeTxHash above.",
      ].join("\n");

      // Phase 38 Plan 38-01 (Inv #12.5) — hard-trigger block composition.
      // Composite scenario emits BOTH in document order: MODULE ENABLE first
      // (narrower selector match; safe-on-self gate), DELEGATECALL second
      // (broader operation-discriminator match). Never combined — skill-side
      // Step 0.5 keys on titles independently.
      const hardTriggerBlocks: string[] = [];
      if (
        isEnableModuleCalldata(data) &&
        rawTo.toLowerCase() === rawSafeAddress.toLowerCase()
      ) {
        // The pre-flight above ensured this decode succeeds; safe to call.
        const moduleAddress = decodeEnableModuleCalldata(data).module;
        hardTriggerBlocks.push(
          HARD_TRIGGER_MODULE_ENABLE_TEMPLATE
            .replace("{MODULE_ADDRESS}", moduleAddress)
            .replace("{SAFE_ADDRESS}", rawSafeAddress)
            .replace("{HANDLE}", handle),
        );
      }
      if (operationStr === "delegatecall") {
        hardTriggerBlocks.push(
          HARD_TRIGGER_DELEGATECALL_TEMPLATE
            .replace("{SAFE_ADDRESS}", rawSafeAddress)
            .replace("{HANDLE}", handle),
        );
      }

      const text = [
        prepareReceipt,
        checksPerformed,
        ledgerDisplay,
        ...hardTriggerBlocks,
      ].join("\n\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          handle,
          chain: chainName,
          chainId,
          from: fromAddress,
          safeAddress: rawSafeAddress,
          safeVersion,
          safeTxHash,
          safeNonce: onchainInfo.nonce.toString(),
          operation: operationStr,
          to: rawTo,
          value: rawValue,
          data: rawData,
          payloadFingerprint,
          typedDataStructure,
          // Informational — surfaces the domainSeparator cross-check result
          // without requiring the agent to re-parse the CHECKS PERFORMED text.
          domainSeparatorMatches: domainMatches,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_safe_tx_propose failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_safe_tx_propose failed",
          message,
        ),
      };
    }
  },
);
