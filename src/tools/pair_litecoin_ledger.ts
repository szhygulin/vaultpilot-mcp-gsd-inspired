// MCP tool: pair_litecoin_ledger({}) — Phase 26 Plan 26-01 (LTC-PAIR-01).
//
// USB-HID pairing of a Ledger Litecoin app: opens the transport, reads
// BOTH legacy (L-prefix) AND segwit (ltc1q…) addresses from BIP-44 +
// BIP-84 paths in ONE device session, persists BOTH (chain, address,
// derivationPath, pairedAt) tuples to the non-EVM account store as TWO
// sibling records under `chain: "litecoin"`, and surfaces a DUAL-address
// VERIFY-ON-DEVICE block the user MUST cross-check against the
// on-device address screens.
//
// Mirror of `pair_btc_ledger.ts` with LTC-specific divergences:
//
//   1. **TWO addresses persisted per pair.** `saveAccount` upserts on
//      the `(chain, address)` tuple; two calls under `chain: "litecoin"`
//      produce two coexisting records.
//
//   2. **`buildLtcApp` via `_transport.buildLtcApp`** — routes to the
//      BtcOld legacy APDU path with `currency: "litecoin"`. The BTC app
//      is NOT opened.
//
//   3. **`getAppConfiguration()` gate** — must assert `config.name === "Litecoin"`.
//      Map wrong-app to `LedgerLtcAppNotOpenError` / `LITECOIN_APP_NOT_OPEN`.
//
//   4. **DUAL-address VERIFY-ON-DEVICE template.** Shows BOTH legacy
//      (L-prefix, BIP-44) AND segwit (ltc1q, BIP-84) addresses.
//
// Locked errorCode set (mirror of pair_btc_ledger.ts):
//   - DEMO_MODE_REFUSED      — demo mode active
//   - LEDGER_NOT_CONNECTED   — no USB-HID device enumerated
//   - LITECOIN_APP_NOT_OPEN  — transport opened but Litecoin app not active
//   - USER_REJECTED          — on-device rejection (APDU 0x6985)
//   - APPROVAL_TIMEOUT       — 60s budget exceeded
//   - INTERNAL_ERROR         — defensive catch-all

import { isDemoMode } from "../config/env.js";
import { saveAccount } from "../wallet/non-evm-account-store.js";
import {
  APPROVAL_TIMEOUT_MS,
  LedgerLtcAppNotOpenError,
  LedgerDeviceNotConnectedError,
  fetchLtcAddresses,
} from "../wallet/ledger-btc-transport.js";
import { registerTool } from "./index.js";

/**
 * Local timeout error class — distinct from the BTC / TRON / Solana paths;
 * each chain races its own 60s budget. Mirror of `BtcApprovalTimeoutError`
 * in `pair_btc_ledger.ts`.
 */
export class LtcPairApprovalTimeoutError extends Error {
  constructor() {
    super(
      "Ledger did not approve the LTC address fetch within 60 seconds. Re-call pair_litecoin_ledger to retry; ensure your Ledger is unlocked and the Litecoin app is open.",
    );
    this.name = "LtcPairApprovalTimeoutError";
  }
}

/**
 * Verbatim DUAL-address VERIFY-ON-DEVICE block for the LTC pairing flow
 * (LTC-PAIR-01). Source-of-truth for the on-device cross-check the user
 * reads against the Litecoin app's address-display screens on the Ledger
 * (TWO addresses shown in sequence — one legacy L-prefix, one ltc1q segwit
 * — per the `verify: true` opt-in on `getWalletPublicKey`).
 *
 * Two placeholders, substituted at runtime via plain
 * `String.prototype.replace`:
 *   - `{LEGACY_ADDRESS}`  — full L-prefix legacy address (BIP-44).
 *   - `{SEGWIT_ADDRESS}`  — full ltc1q bech32 segwit address (BIP-84).
 *
 * Format-fanout-regex-sync rule (global CLAUDE.md): tests import THIS
 * const, substitute placeholders the same way the handler does, and
 * assert the substituted block appears in `result.content[0].text`.
 */
export const VERIFY_ON_DEVICE_LTC_TEMPLATE: string = [
  "VERIFY ON DEVICE",
  "────────────────",
  "Legacy (BIP-44):  {LEGACY_ADDRESS}",
  "                  derivation: 44'/2'/0'/0/0",
  "Segwit (BIP-84):  {SEGWIT_ADDRESS}",
  "                  derivation: 84'/2'/0'/0/0",
  "",
  "Open the Litecoin app on your Ledger. The device will display TWO addresses",
  "in sequence — one legacy L-prefix, one ltc1q segwit. BOTH must match the",
  "values shown above byte-for-byte. If anything differs, do NOT approve.",
].join("\n");

const DESCRIPTION = [
  "Open the Ledger Litecoin app over USB-HID and return BOTH legacy (BIP-44, L-prefix) AND segwit (BIP-84, ltc1q…) mainnet addresses derived from the connected device in ONE device session.",
  "Persists both as sibling records under chain: 'litecoin' for cold-boot restore via the existing PAIR-NEV-* surface.",
  "Pairs ONCE per device session; subsequent reads consult the cached records.",
  "Use this when the user wants to read LTC balances or (in Phase 26+) sign LTC PSBT transactions.",
  "Do NOT use this in demo mode — refuses with DEMO_MODE_REFUSED.",
  "The device shows TWO addresses in sequence — the user MUST confirm BOTH on-device before approving.",
  "The persistent cache holds public-address + derivation-slot only; no key material crosses any boundary.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

/**
 * Heuristic: is the underlying error an on-device user rejection? Ledger
 * APDU error 0x6985 surfaces as a transport-error from `@ledgerhq/errors`
 * whose `.message` contains the literal `"0x6985"` or `"6985"`. Mirror
 * of `isUserRejection` in `pair_btc_ledger.ts` — module-local copy per
 * per-tool duplication convention.
 */
function isUserRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return msg.includes("0x6985") || msg.includes("6985");
}

registerTool("pair_litecoin_ledger", DESCRIPTION, INPUT_SCHEMA, async () => {
  // T-DEMO-1 mitigation: demo-mode check FIRST, BEFORE any USB-HID
  // transport open. The mocked `fetchLtcAddresses` spy must observe
  // zero invocations in this branch.
  if (isDemoMode()) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: pair_litecoin_ledger is not available in demo mode. Use `set_demo_wallet({ persona: <slug> })` to switch personas, or set `VAULTPILOT_DEMO=false` to pair a real Ledger.",
        },
      ],
      structuredContent: { errorCode: "DEMO_MODE_REFUSED" },
    };
  }

  try {
    // 60s budget race: fetchLtcAddresses against a timer. Mirrors the
    // pair_btc_ledger.ts shape.
    const result = await Promise.race<{
      legacy: { address: string; publicKey: string; chainCode: string; derivationPath: string };
      segwit: { address: string; publicKey: string; chainCode: string; derivationPath: string };
      appVersion: string;
    }>([
      fetchLtcAddresses(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new LtcPairApprovalTimeoutError()),
          APPROVAL_TIMEOUT_MS,
        );
      }),
    ]);

    const { legacy, segwit, appVersion } = result;
    const pairedAt = new Date().toISOString();

    // PAIR-NEV-03 multi-record-per-chain: TWO saveAccount calls under
    // `chain: "litecoin"` produce two coexisting records — the (chain,
    // address) upsert tuple is the discriminator.
    saveAccount({
      chain: "litecoin",
      address: legacy.address,
      derivationPath: legacy.derivationPath,
      pairedAt,
    });
    saveAccount({
      chain: "litecoin",
      address: segwit.address,
      derivationPath: segwit.derivationPath,
      pairedAt,
    });

    // Render the DUAL-address VERIFY-ON-DEVICE block. Two `.replace()`
    // calls — one per placeholder. Template is the SOT; tests import the
    // same const + run the same substitution to assert byte-identity.
    const verifyBlock = VERIFY_ON_DEVICE_LTC_TEMPLATE
      .replace("{LEGACY_ADDRESS}", legacy.address)
      .replace("{SEGWIT_ADDRESS}", segwit.address);

    return {
      content: [{ type: "text", text: verifyBlock }],
      structuredContent: {
        addresses: { legacy: legacy.address, segwit: segwit.address },
        derivationPaths: {
          legacy: legacy.derivationPath,
          segwit: segwit.derivationPath,
        },
        pairedAt,
        appVersion,
      },
    };
  } catch (err) {
    // Catch ladder ordered most-specific-first.

    if (err instanceof LedgerDeviceNotConnectedError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: No Ledger device detected over USB-HID. Connect your Ledger via USB, unlock it, and open the Litecoin app, then re-call pair_litecoin_ledger.",
          },
        ],
        structuredContent: { errorCode: "LEDGER_NOT_CONNECTED" },
      };
    }

    if (err instanceof LedgerLtcAppNotOpenError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Litecoin app is not the active app on the Ledger. Open the Litecoin app on the device, then re-call pair_litecoin_ledger.",
          },
        ],
        structuredContent: { errorCode: "LITECOIN_APP_NOT_OPEN" },
      };
    }

    if (err instanceof LtcPairApprovalTimeoutError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Ledger did not approve the LTC address fetch within 60 seconds. Re-call pair_litecoin_ledger to retry.",
          },
        ],
        structuredContent: { errorCode: "APPROVAL_TIMEOUT" },
      };
    }

    // APDU 0x6985 — user rejected on device.
    if (isUserRejection(err)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: user rejected the pairing on the Ledger device. Re-call pair_litecoin_ledger when ready to approve on the device.",
          },
        ],
        structuredContent: { errorCode: "USER_REJECTED" },
      };
    }

    // Defensive catch-all.
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: pair_litecoin_ledger failed: ${message}`,
        },
      ],
      structuredContent: { errorCode: "INTERNAL_ERROR" },
    };
  }
});
