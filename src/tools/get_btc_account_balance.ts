// src/tools/get_btc_account_balance.ts — Phase 22 Plan 22-03 Task 2
// (BTC-READ-03).
//
// MCP tool — aggregate BTC balance across all derived addresses under
// a BIP-84 segwit zpub OR BIP-86 taproot xpub via gap-limit-respecting
// scan. Calls `scanXpub` from the chain-shelf; the scan itself is
// rate-limit-defended (concurrency cap 5) + cached per-xpub (5-min
// TTL).
//
// Schema-level base58 prefix gate: `^(xpub|zpub)[1-9A-HJ-NP-Za-km-z]{107}$`
// — total 111 chars, matches mainnet xpub/zpub canonical length. NO
// `ypub` support (Phase 22 BIP-84 segwit + BIP-86 taproot only). The
// `scanXpub` call transparently swaps zpub→xpub version bytes; the
// derivation tree is identical.
//
// Locked errorCode set:
//   - INVALID_INPUT — missing wallet object or xpub field.
//   - INVALID_XPUB — `bip32.fromBase58` rejects the extended key (bad
//     checksum, unknown version bytes after normalization, etc).
//   - ESPLORA_RATE_LIMITED / ESPLORA_ERROR are absorbed by `scanXpub`
//     (treated as "empty" per address, conservatively stopping the
//     scan) — they do NOT surface here as separate envelopes. A
//     fully-rate-limited scan returns `{ totalConfirmedSats: 0,
//     addressesScanned: 20 }` which the agent can use as a "retry"
//     signal.
//
// CLAUDE.md compliance: NEVER expose private key material. The xpub is
// by construction public — `BIP32Interface` exposes only the public
// derivation tree (privateKey is undefined for neutered xpubs).

import { scanXpub } from "../chains/bitcoin/xpub-scan.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns the aggregate BTC balance across all derived addresses under a BIP-84 segwit OR BIP-86 taproot xpub via a gap-limit-respecting scan (BIP-44 standard: stop after 20 consecutive unused addresses in a row).",
  "Use this when the user provides an xpub-format account-level extended public key (BIP-84 `zpub` segwit or BIP-86 `xpub` taproot) and wants their full account-level balance.",
  "Per-xpub TTL cache 5min; concurrency capped at 5 parallel Esplora fetches.",
  "Note: advanced users with non-standard gap-limits should use `get_btc_balance` per-address instead. For a SINGLE address use `get_btc_balance`. For paired-wallet BOTH script types use `get_btc_balances`.",
  "Decimal-string sat amounts cross the boundary (bigint serialized as string per CLAUDE.md).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "object",
      description:
        "Account-level extended public key + optional script type. `xpub` REQUIRED — base58 prefix `xpub` (BIP-86 taproot) OR `zpub` (BIP-84 segwit), total 111 chars. `scriptType` defaults to 'p2wpkh' (segwit).",
      properties: {
        xpub: {
          type: "string",
          description:
            "Account-level extended public key. xpub (BIP-86 taproot) or zpub (BIP-84 segwit), mainnet.",
          pattern: "^(xpub|zpub)[1-9A-HJ-NP-Za-km-z]{107}$",
        },
        scriptType: {
          type: "string",
          enum: ["p2wpkh", "p2tr"],
          description:
            "Address script type. 'p2wpkh' for segwit (BIP-84 zpub); 'p2tr' for taproot (BIP-86 xpub). Default: 'p2wpkh'.",
        },
      },
      required: ["xpub"],
      additionalProperties: false,
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

registerTool(
  "get_btc_account_balance",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    const walletArg = args.wallet as
      | { xpub?: unknown; scriptType?: unknown }
      | undefined;

    if (!walletArg || typeof walletArg !== "object") {
      return {
        isError: true,
        content: [{ type: "text", text: "error: `wallet` is REQUIRED" }],
        structuredContent: {
          errorCode: "INVALID_INPUT",
          message: "`wallet` is REQUIRED — pass `{ xpub: ..., scriptType?: ... }`",
        },
      };
    }

    const xpub = walletArg.xpub;
    if (typeof xpub !== "string" || xpub.length === 0) {
      return {
        isError: true,
        content: [{ type: "text", text: "error: `wallet.xpub` is REQUIRED" }],
        structuredContent: {
          errorCode: "INVALID_INPUT",
          message: "`wallet.xpub` is REQUIRED — base58 xpub or zpub, mainnet",
        },
      };
    }

    const scriptType: "p2wpkh" | "p2tr" =
      walletArg.scriptType === "p2tr" ? "p2tr" : "p2wpkh";

    // Wrap the scan call — bip32.fromBase58 throws on bad checksum /
    // unknown version bytes. Map to INVALID_XPUB structured envelope
    // (mirrors the ESPLORA_RATE_LIMITED / ESPLORA_ERROR 5-arm
    // convention).
    let scan: Awaited<ReturnType<typeof scanXpub>>;
    try {
      scan = await scanXpub(xpub, scriptType);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid xpub — ${message}`,
          },
        ],
        structuredContent: { errorCode: "INVALID_XPUB", message },
      };
    }

    const activeJson = scan.activeAddresses.map((a) => ({
      index: a.index,
      address: a.address,
      confirmedBalanceSats: a.confirmedBalanceSats.toString(),
    }));

    return {
      content: [
        {
          type: "text",
          text: `xpub scan: ${scan.totalConfirmedSats.toString()} sats total across ${scan.activeAddresses.length} active address(es); scanned ${scan.addressesScanned} addresses (${scriptType})`,
        },
      ],
      structuredContent: {
        totalConfirmedSats: scan.totalConfirmedSats.toString(),
        addressesScanned: scan.addressesScanned,
        activeAddresses: activeJson,
        scriptType,
      },
    };
  },
);
