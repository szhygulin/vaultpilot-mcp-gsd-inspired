// src/protocols/bridge-decoders/lifi-btc.ts — Phase 26 Plan 26-03 (BTC-LIFI-01).
//
// PSBT output extractor for LiFi BTC bridge transactions.
// First file in the new `bridge-decoders/` directory.
//
// The LiFi BTC quote returns a PSBT in `transactionRequest.data`. The PSBT is:
//   - Constructed by LiFi (Chainflip / NearIntents routing aggregator) — NOT by VaultPilot.
//   - Structured as 3 outputs: deposit (vault address), OP_RETURN (tracking memo), change.
//   - Output order is LOAD-BEARING (Chainflip has no manual recovery if outputs are reordered
//     or the OP_RETURN is dropped) — see RESEARCH Pitfall 6.
//
// This module decodes the PSBT for HUMAN-READABLE DISPLAY ONLY. It NEVER reconstructs
// or reorders the PSBT. The `psbtHex` field in the returned summary is the verbatim
// input — byte-for-byte unchanged.
//
// Why BTC network here, not LTC:
//   The PSBT came from LiFi and encodes a BTC-chain transaction (depositing BTC to a
//   bridge vault). Even though the *destination* may be Ethereum or Solana, the PSBT
//   itself is a Bitcoin mainnet transaction and must be decoded with `networks.bitcoin`.
//
// Inv#6b note (RESEARCH Pattern 5):
//   The final recipient is NOT in the PSBT — the OP_RETURN is a binary tracking memo
//   (starts with "=|lifi" bytes), not a human-readable address. The Inv#6b assertion
//   (quote.action.toAddress === params.toAddress) lives in prepare_btc_lifi_swap.ts,
//   NOT here. This decoder only extracts vault address, amount, OP_RETURN presence.

import "../../../src/chains/bitcoin/types.js"; // ensure initEccLib(tinySecp256k1) fires
import { Psbt, networks, payments } from "bitcoinjs-lib";
import { log } from "../../diagnostics/logger.js";

// ─── Exported types ───────────────────────────────────────────────────────────

/**
 * Decoded summary of a LiFi BTC bridge PSBT — for display in the PREPARE RECEIPT
 * block and the preview_send LEDGER BLIND-SIGN HASH block.
 *
 * CRITICAL: `psbtHex` is verbatim from the LiFi response. Output order is load-bearing.
 * This struct is for DISPLAY ONLY — do NOT use it to reconstruct a new PSBT.
 */
export interface LifiPsbtSummary {
  /** Bridge vault BTC deposit address (first P2WPKH / P2PKH output). */
  readonly vaultAddress: string;
  /** Amount in satoshi (from the deposit output). */
  readonly amountSats: bigint;
  /** True if the PSBT contains an OP_RETURN output (LiFi tracking memo). */
  readonly hasOpReturn: boolean;
  /** Total number of outputs in the PSBT. */
  readonly outputCount: number;
  /**
   * Verbatim PSBT hex from the LiFi response — byte-for-byte unchanged.
   * Output order is load-bearing (RESEARCH Pitfall 6). NEVER reconstruct.
   */
  readonly psbtHex: string;
}

// ─── decodeLifiPsbt ──────────────────────────────────────────────────────────

/**
 * Decode a LiFi BTC bridge PSBT for human-readable display.
 * DISPLAY ONLY — does NOT reconstruct or reorder. The returned `psbtHex`
 * equals the input verbatim (output order is load-bearing for Chainflip).
 *
 * The PSBT is expected to have at minimum:
 *   - Output 0: P2WPKH / P2PKH deposit output (vault address + amount)
 *   - Output 1: OP_RETURN (binary LiFi tracking memo — NOT a human-readable address)
 *   - Output 2: Change output (optional)
 *
 * Throws if the hex is not a valid PSBT.
 */
export function decodeLifiPsbt(psbtHex: string): LifiPsbtSummary {
  // Decode with BTC network — this is a Bitcoin mainnet transaction.
  const psbt = Psbt.fromHex(psbtHex, { network: networks.bitcoin });

  const outputs = psbt.txOutputs;
  const outputCount = outputs.length;

  // Extract vault address from first output (deposit destination).
  // LiFi always puts the vault address first.
  let vaultAddress = "unknown";
  let amountSats = 0n;
  let hasOpReturn = false;

  if (outputs.length > 0) {
    const firstOutput = outputs[0]!;
    amountSats = BigInt(firstOutput.value);
    try {
      // Try to decode the address from the output script.
      vaultAddress = firstOutput.address ?? _scriptToAddress(firstOutput.script);
    } catch {
      // Fall back to hex if address decoding fails.
      vaultAddress = `script:${Buffer.from(firstOutput.script).toString("hex").slice(0, 20)}...`;
    }
  }

  // Scan all outputs for OP_RETURN presence.
  for (const output of outputs) {
    // OP_RETURN script starts with 0x6a (OP_RETURN opcode).
    if (output.script.length > 0 && output.script[0] === 0x6a) {
      hasOpReturn = true;
      break;
    }
  }

  log(
    "debug",
    `decodeLifiPsbt: outputCount=${outputCount} vaultAddress=${vaultAddress} amountSats=${amountSats} hasOpReturn=${hasOpReturn}`,
  );

  return {
    vaultAddress,
    amountSats,
    hasOpReturn,
    outputCount,
    psbtHex, // VERBATIM — byte-for-byte unchanged (RESEARCH Pitfall 6)
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Attempt to convert an output script to a readable Bitcoin address.
 * Tries P2PKH, P2WPKH, P2SH, and P2WSH.
 * Throws if the script type is not recognized.
 */
function _scriptToAddress(script: Uint8Array): string {
  const scriptBuf = Buffer.from(script);
  const network = networks.bitcoin;

  // Try P2WPKH (OP_0 0x14 <20-byte hash>)
  if (scriptBuf.length === 22 && scriptBuf[0] === 0x00 && scriptBuf[1] === 0x14) {
    const p = payments.p2wpkh({ output: scriptBuf, network });
    if (p.address) return p.address;
  }

  // Try P2PKH (OP_DUP OP_HASH160 0x14 <20-byte hash> OP_EQUALVERIFY OP_CHECKSIG)
  if (
    scriptBuf.length === 25 &&
    scriptBuf[0] === 0x76 &&
    scriptBuf[1] === 0xa9 &&
    scriptBuf[2] === 0x14
  ) {
    const p = payments.p2pkh({ output: scriptBuf, network });
    if (p.address) return p.address;
  }

  // Try P2SH (OP_HASH160 0x14 <20-byte hash> OP_EQUAL)
  if (
    scriptBuf.length === 23 &&
    scriptBuf[0] === 0xa9 &&
    scriptBuf[1] === 0x14
  ) {
    const p = payments.p2sh({ output: scriptBuf, network });
    if (p.address) return p.address;
  }

  // Try P2WSH (OP_0 0x20 <32-byte hash>)
  if (scriptBuf.length === 34 && scriptBuf[0] === 0x00 && scriptBuf[1] === 0x20) {
    const p = payments.p2wsh({ output: scriptBuf, network });
    if (p.address) return p.address;
  }

  throw new Error(`Unknown output script type: ${scriptBuf.toString("hex").slice(0, 20)}...`);
}
