// MCP tool: prepare_safe_tx_approve({ chain, safeAddress, safeTxHash })
//
// Phase 37 Plan 37-02 (SAFE-06) — the "another owner already proposed this
// SafeTx; I want to add my signature" entry point. Off-chain typed-data sign;
// does NOT broadcast on-chain. Fetches the pending SafeTx via Phase 36's Tx
// Service client + re-derives the EIP-712 typed-data structure from on-chain
// Safe state (defends against Tx Service drift), returns a
// `PreparedTxSafeTypedData` handle. Agent then calls `submit_safe_tx_signature`
// (Plan 37-02 Task 3) to publish the signature.
//
// Trust-source discipline (T-37-10 mitigation): the SafeTx hash is
// LOCALLY RECOMPUTED from on-chain Safe.VERSION() + on-chain nonce + the Tx
// Service-reported SafeTx fields. The Tx Service-reported `safeTxHash` is
// NEVER trusted directly — it's cross-checked against the local recompute,
// and a mismatch produces a `txServiceDrift` structured refusal.
//
// On-chain domainSeparator() is informational only (the local typed-data
// digest is correct by construction per EIP-712 spec); a drift produces a
// CHECKS PERFORMED warning but does NOT refuse.
//
// Refusal pre-flights (mirror of prepare_safe_tx_propose):
//   - Tx Service kind != "ok" → INVALID_INPUT with mapped hint
//   - on-chain Safe.VERSION() ∉ {"1.3.0", "1.4.1"} → UNSUPPORTED_SAFE_VERSION
//   - WC session absent → WALLET_NOT_PAIRED
//   - resolved-from ∉ on-chain getOwners() → INVALID_INPUT
//   - recomputed safeTxHash !== input safeTxHash → INVALID_INPUT + txServiceDrift hint
//
// Informational surfaces (not refusals):
//   - duplicateSignWarning when resolved-from is in confirmations[]
//   - domainSeparatorDrift when on-chain domain doesn't match local hashDomain

import {
  hashDomain,
  type Address,
  type Hex,
  type TypedData,
  getAddress,
} from "viem";

import { _safeChains } from "../chains/safe.js";
import { getChainClient } from "../chains/registry.js";
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
  "Use when ANOTHER owner proposed a Safe tx and the user wants to co-sign.",
  "Off-chain typed-data sign — does NOT broadcast on-chain. Fetches the pending SafeTx from the Safe Tx Service, re-derives the EIP-712 typed-data structure from on-chain Safe state (defends against Tx Service drift), returns a handle the user signs via Ledger ETH app over WalletConnect (eth_signTypedData_v4); agent then calls submit_safe_tx_signature to publish the signature.",
  "Required args: chain, safeAddress, safeTxHash.",
  "Returns `{ handle, chain, chainId, from, safeAddress, safeVersion, safeTxHash, safeNonce, operation, to, value, data, payloadFingerprint, typedDataStructure, domainSeparatorMatches, duplicateSignWarning, handleNotFound }` plus PREPARE RECEIPT + CHECKS PERFORMED + LEDGER DISPLAY text blocks.",
  "Refuses pre-v1.3.0 Safes (UNSUPPORTED_SAFE_VERSION). Refuses if the Tx Service-reported safeTxHash diverges from the local recompute (INVALID_INPUT + txServiceDrift — defends against compromised Tx Service serving a wrong pending SafeTx).",
  "Failure modes: UNSUPPORTED_SAFE_VERSION, WALLET_NOT_PAIRED, INVALID_INPUT (Tx Service not-found / unsupported-chain / rate-limited / error / txServiceDrift / sender-not-owner), WRONG_MODE, INTERNAL_ERROR.",
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
        "32-byte EIP-712 SafeTx digest of the pending tx (typically surfaced by `get_safe_positions` or `get_safe_transaction`).",
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

registerTool(
  "prepare_safe_tx_approve",
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

      // Step 3 — Resolve sender (real mode pairs through WC; demo mode pulls
      // the active persona; mismatch refuses with WALLET_NOT_PAIRED / WRONG_MODE).
      const rawFrom = typeof args.from === "string" ? args.from : undefined;
      const fromResolution = await resolveFrom({ rawFrom, chainId });
      if (fromResolution.kind === "error") {
        return fromResolution.result;
      }
      const fromAddress: Address = fromResolution.fromAddress;

      // Step 4 — Fetch the pending SafeTx from the Tx Service. 5-arm DU
      // dispatch — non-`ok` arms map to structured refusals.
      const txResult = await safeTxService.getMultisigTransaction(
        chainId,
        safeTxHashInput,
      );
      if (txResult.kind === "not-found") {
        const msg =
          `SafeTx ${safeTxHashInput} not found in Tx Service. ` +
          `Either the safeTxHash is wrong or the propose step has not run yet.`;
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

      // Step 5 — Prefetch on-chain SafeInfo + domainSeparator in parallel.
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

      // Step 6 — Version refusal (same gate as propose).
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

      // Step 7 — Owner check.
      const lcOwners = new Set(onchainInfo.owners.map((o) => o.toLowerCase()));
      if (!lcOwners.has(fromAddress.toLowerCase())) {
        const msg =
          `Sender ${fromAddress} is not an owner of Safe ${safeAddress}; cannot co-sign. ` +
          `Current owners: ${onchainInfo.owners.join(", ")}.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      // Step 8 — Map Tx Service-reported fields to viem types + map
      // operation 0/1 → "call"/"delegatecall" (mirror of get_safe_transaction).
      const operationInt: SafeOperation = tx.operation === 1 ? 1 : 0;
      const operationStr: "call" | "delegatecall" =
        operationInt === 1 ? "delegatecall" : "call";
      const to = getAddress(tx.to as string) as Address;
      // Pitfall 3 — value / nonce / gas fields are wire STRINGS; parse via BigInt.
      const value = BigInt(tx.value);
      const data = ((tx.data ?? "0x") as Hex);
      const safeTxGas = BigInt(tx.safeTxGas);
      const baseGas = BigInt(tx.baseGas);
      const gasPrice = BigInt(tx.gasPrice);
      const gasToken = getAddress(tx.gasToken as string) as Address;
      const refundReceiver = getAddress(
        (tx.refundReceiver ?? ZERO_ADDRESS) as string,
      ) as Address;
      const nonce = BigInt(tx.nonce);

      // Phase 38 Plan 38-01 (Inv #12.5) — pre-flight: if the Tx Service-
      // reported data starts with the enableModule selector, verify the
      // argument decode succeeds BEFORE recompute / handle minting. A
      // compromised Tx Service feeding malformed enableModule bytes is the
      // INVALID_INPUT refusal arm per CONTEXT §"enableModule calldata parsing".
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

      // Step 9 — Recompute SafeTx hash from on-chain VERSION + Tx Service fields.
      // T-37-10 mitigation: a compromised Tx Service serving a wrong pending
      // SafeTx (e.g. mutated value / data / to) produces a recomputed digest
      // that diverges from the Tx Service-reported safeTxHash — we refuse here
      // BEFORE the agent ever sees the typed-data structure for signing.
      const computeInput = {
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
        nonce,
      };
      const recomputedSafeTxHash = computeSafeTxHash(computeInput);
      if (
        recomputedSafeTxHash.toLowerCase() !== safeTxHashInput.toLowerCase()
      ) {
        const msg =
          `txServiceDrift: recomputed safeTxHash ${recomputedSafeTxHash} differs from Tx Service record ${safeTxHashInput}. ` +
          `The Tx Service may be compromised or stale. Cross-check via get_safe_transaction or refuse.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      // Step 10 — Build typed-data structure + payloadFingerprint.
      const typedDataStructure = buildSafeEIP712TypedData(computeInput);
      const payloadFingerprint = computeSafeTxPayloadFingerprint({
        chain: chainId,
        safeAddress,
        safeVersion,
        safeTxHash: recomputedSafeTxHash,
        nonce,
        operation: operationInt,
        to,
        value,
        data,
      });

      // Step 11 — Domain-separator cross-check (informational; does NOT refuse).
      const localDomain = hashDomain({
        domain: typedDataStructure.domain,
        types: { EIP712Domain: typedDataStructure.types.EIP712Domain } as unknown as TypedData,
      });
      const domainMatches =
        localDomain.toLowerCase() === onchainDomain.toLowerCase();

      // Step 12 — Duplicate-sign cross-check (Pitfall 6: confirmations is
      // OPTIONAL on the wire — defensive `?? []`).
      const existingConfirmations = tx.confirmations ?? [];
      const duplicateSignWarning = existingConfirmations.some(
        (c) => c.owner.toLowerCase() === fromAddress.toLowerCase(),
      );

      // Step 13 — Construct PreparedTxSafeTypedData handle (same shape as
      // propose; the discriminator is identical).
      const handleTx: PreparedTxSafeTypedData = {
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
        safeTxHash: recomputedSafeTxHash,
        safeNonce: nonce,
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

      // Step 14 — Mint the handle. PREPARE RECEIPT carries verbatim agent
      // input (chain / safeAddress / safeTxHash) per CLAUDE.md T-PREP-RCPT-1.
      const handle = createHandle({
        args: {
          to: tx.to as string,
          valueWei: tx.value,
        },
        tx: handleTx,
        payloadFingerprint,
      });

      // Step 15 — Compose response.
      const prepareReceipt = [
        "PREPARE RECEIPT",
        "  operation:        Safe multisig approve (off-chain typed-data co-sign)",
        `  chain:            ${chainName} (chainId ${chainId})`,
        `  safe:             ${rawSafeAddress}`,
        `  safeTxHash:       ${safeTxHashInput}`,
        ...(fromResolution.callerSupplied
          ? [`  from:             ${fromAddress}`]
          : []),
      ].join("\n");

      // best-effort decode is deferred to a future phase — the agent can call
      // `get_safe_transaction` (Phase 36) for a decoded view that consults the
      // Phase 35 ABI cache.
      const checksPerformed = [
        "CHECKS PERFORMED",
        `  safeVersion:      v${safeVersion} (supported)`,
        `  ownerCheck:       sender ${fromAddress} is in on-chain getOwners()`,
        "  safeTxHashCheck:  Tx Service hash matches recomputed digest (no txServiceDrift)",
        `  onchainNonce:     ${nonce.toString()} (matches Tx Service nonce)`,
        `  onchainThreshold: ${onchainInfo.threshold.toString()} signatures required`,
        `  safeOperation:    ${operationStr}`,
        `  domainSeparator:  ${domainMatches ? "matches viem.hashDomain({chainId, verifyingContract})" : "DRIFT — on-chain " + onchainDomain + " ≠ local " + localDomain + " (informational; typed-data digest is correct by construction)"}`,
        ...(duplicateSignWarning
          ? [
              "  duplicateSignWarning: YES — wallet has already signed this SafeTx; re-submission is a no-op via postSignature's 200/duplicate arm.",
            ]
          : []),
      ].join("\n");

      const ledgerDisplay = [
        "LEDGER DISPLAY",
        "  The Ledger ETH app shows the typed-data signature one of two ways:",
        "",
        "  Clear-sign mode (if Ledger CAL/EIP-712 filter file covers this Safe contract):",
        `    field-by-field SafeTx display — \"To: ${to}\", \"Value: ${value.toString()} wei\", \"Operation: ${operationStr}\", etc.`,
        "    The 32-byte digest is shown at the end.",
        "",
        "  Blind-sign mode (CAL coverage missing — accepted residual at v1.x):",
        `    Sign Hash: ${recomputedSafeTxHash}`,
        "",
        "  In EITHER mode, visually confirm the 32-byte digest on-device matches the safeTxHash above.",
      ].join("\n");

      // Phase 38 Plan 38-01 (Inv #12.5) — hard-trigger block composition.
      // Composite scenario emits BOTH in document order: MODULE ENABLE first,
      // DELEGATECALL second. Data + to come from the Tx Service fetched at
      // Step 4; safe-on-self gate uses lowercased compare for case-insensitive
      // address equivalence.
      const hardTriggerBlocks: string[] = [];
      if (
        isEnableModuleCalldata(data) &&
        to.toLowerCase() === rawSafeAddress.toLowerCase()
      ) {
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
          safeTxHash: recomputedSafeTxHash,
          safeNonce: nonce.toString(),
          operation: operationStr,
          to,
          value: value.toString(),
          data,
          payloadFingerprint,
          typedDataStructure,
          domainSeparatorMatches: domainMatches,
          duplicateSignWarning,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_safe_tx_approve failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_safe_tx_approve failed",
          message,
        ),
      };
    }
  },
);
