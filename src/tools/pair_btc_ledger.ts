// MCP tool: pair_btc_ledger({}) — Phase 22 Plan 22-02 (BTC-PAIR-01).
//
// USB-HID pairing of a Ledger Bitcoin app: opens the transport, reads
// BOTH segwit (bc1q…) AND taproot (bc1p…) addresses from BIP-84 +
// BIP-86 paths in ONE device session, persists BOTH (chain, address,
// derivationPath, pairedAt) tuples to the non-EVM account store as TWO
// sibling records under `chain: "bitcoin"`, and surfaces a DUAL-address
// VERIFY-ON-DEVICE block the user MUST cross-check against the
// on-device address screens.
//
// Mirror of `pair_tron_ledger.ts` with THREE BTC-specific divergences:
//
//   1. **TWO addresses persisted per pair.** `saveAccount` upserts on
//      the `(chain, address)` tuple; two calls under `chain: "bitcoin"`
//      produce two coexisting records (PAIR-NEV-03 multi-record-per-
//      chain provision — REQUIREMENTS.md:144). NO schema change needed
//      — `non-evm-account-store.ts` is BYTE-UNTOUCHED.
//
//   2. **Two `getWalletPublicKey` calls in ONE transport open.** The
//      `fetchBtcAddresses()` helper does the sequential exchange + the
//      single `try/finally` close. Phase 22 has NO `derivationSlot`
//      arg widening (Phase 22 hardcodes slot 0; future widening per
//      RESEARCH § Plan 22-02 risks deferred to v2.2.x).
//
//   3. **DUAL-address VERIFY-ON-DEVICE template.** The block shows BOTH
//      addresses + BOTH derivation paths; the user verifies both
//      screens on the Ledger BTC app (which displays them in sequence
//      per the `verify: true` opt-in on `getWalletPublicKey`).
//
// Locked errorCode set (mirror of `pair_tron_ledger.ts:31-37`):
//   - DEMO_MODE_REFUSED      — demo mode active
//   - LEDGER_NOT_CONNECTED   — no USB-HID device enumerated
//   - BITCOIN_APP_NOT_OPEN   — transport opened but Bitcoin app not active
//   - USER_REJECTED          — on-device rejection (APDU 0x6985)
//   - APPROVAL_TIMEOUT       — 60s budget exceeded racing fetchBtcAddresses
//   - INTERNAL_ERROR         — defensive catch-all (NOT in locked-5 set)

import { isDemoMode } from "../config/env.js";
import { saveAccount } from "../wallet/non-evm-account-store.js";
import {
  APPROVAL_TIMEOUT_MS,
  LedgerBtcAppNotOpenError,
  LedgerDeviceNotConnectedError,
  fetchBtcAddresses,
} from "../wallet/ledger-btc-transport.js";
import { registerTool } from "./index.js";

/**
 * Local timeout error class — distinct from the EVM-WC / Solana / TRON
 * paths; each chain races its own 60s budget so a future divergence in
 * one chain's timing cannot silently shift the others. Mirror of
 * `TronApprovalTimeoutError` in `pair_tron_ledger.ts`.
 */
export class BtcApprovalTimeoutError extends Error {
  constructor() {
    super(
      "Ledger did not approve the BTC address fetch within 60 seconds. Re-call pair_btc_ledger to retry; ensure your Ledger is unlocked and the Bitcoin app is open.",
    );
    this.name = "BtcApprovalTimeoutError";
  }
}

/**
 * Verbatim DUAL-address VERIFY-ON-DEVICE block for the BTC pairing
 * flow (BTC-PAIR-01). Source-of-truth for the on-device cross-check the
 * user reads against the Bitcoin app's address-display screens on the
 * Ledger (TWO addresses shown in sequence — one for segwit, one for
 * taproot — per the `verify: true` opt-in on `getWalletPublicKey`).
 *
 * Two placeholders, substituted at runtime via plain
 * `String.prototype.replace`:
 *   - `{SEGWIT_ADDRESS}`   — full bech32 `bc1q…` address (segwit).
 *   - `{TAPROOT_ADDRESS}`  — full bech32m `bc1p…` address (taproot).
 *
 * Format-fanout-regex-sync rule (global CLAUDE.md): tests import THIS
 * const, substitute placeholders the same way the handler does, and
 * assert the substituted block appears in `result.content[0].text`. Do
 * NOT duplicate the string into the test file.
 */
export const VERIFY_ON_DEVICE_BTC_TEMPLATE: string = [
  "VERIFY ON DEVICE",
  "────────────────",
  "Segwit (BIP-84):  {SEGWIT_ADDRESS}",
  "                  derivation: 84'/0'/0'/0/0",
  "Taproot (BIP-86): {TAPROOT_ADDRESS}",
  "                  derivation: 86'/0'/0'/0/0",
  "",
  "Open the Bitcoin app on your Ledger. The device will display TWO addresses",
  "in sequence — one for segwit, one for taproot. BOTH must match the values",
  "shown above byte-for-byte. If anything differs, do NOT approve.",
].join("\n");

const DESCRIPTION = [
  "Open the Ledger Bitcoin app over USB-HID and return BOTH segwit (BIP-84, bc1q…) AND taproot (BIP-86, bc1p…) mainnet addresses derived from the connected device in ONE device session.",
  "Persists both as sibling records under chain: 'bitcoin' for cold-boot restore via the existing PAIR-NEV-* surface.",
  "Pairs ONCE per device session; subsequent reads consult the cache (inspect via get_btc_status).",
  "Use this when the user wants to read BTC balances or (in Phase 23+) sign BTC PSBT transactions.",
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
 * whose `.message` contains the literal `"0x6985"` or `"6985"`. We match
 * on substring rather than the typed error class because the Ledger SDK's
 * error shape varies across `@ledgerhq/errors` minors. Mirror of
 * `isUserRejection` in `pair_tron_ledger.ts:125-129` and the same helper
 * in `pair_solana_ledger.ts` — module-local copy follows the existing
 * per-tool duplication convention.
 */
function isUserRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return msg.includes("0x6985") || msg.includes("6985");
}

registerTool("pair_btc_ledger", DESCRIPTION, INPUT_SCHEMA, async () => {
  // T-DEMO-1 mitigation: demo-mode check FIRST, BEFORE any USB-HID
  // transport open. The mocked `fetchBtcAddresses` spy must observe
  // zero invocations in this branch.
  if (isDemoMode()) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: pair_btc_ledger is not available in demo mode. Use `set_demo_wallet({ persona: <slug> })` to switch personas, or set `VAULTPILOT_DEMO=false` to pair a real Ledger.",
        },
      ],
      structuredContent: { errorCode: "DEMO_MODE_REFUSED" },
    };
  }

  try {
    // 60s budget race: fetchBtcAddresses against a timer. Mirrors the
    // pair_tron_ledger.ts shape.
    const result = await Promise.race<{
      segwit: { address: string; publicKey: string; chainCode: string; derivationPath: string; xpub: string };
      taproot: { address: string; publicKey: string; chainCode: string; derivationPath: string; xpub: string };
      appVersion: string;
    }>([
      fetchBtcAddresses(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new BtcApprovalTimeoutError()),
          APPROVAL_TIMEOUT_MS,
        );
      }),
    ]);

    const { segwit, taproot, appVersion } = result;
    const pairedAt = new Date().toISOString();

    // PAIR-NEV-03 multi-record-per-chain: TWO saveAccount calls under
    // `chain: "bitcoin"` produce two coexisting records — the (chain,
    // address) upsert tuple is the discriminator.
    //
    // CR-02 / CR-03: also persist the account-level xpub fetched in the same
    // device session. `prepare_btc_send` uses it to derive fresh chain-1
    // change addresses (m/84'/0'/0'/1/k segwit, m/86'/0'/0'/1/k taproot)
    // without re-opening the Ledger transport.
    saveAccount({
      chain: "bitcoin",
      address: segwit.address,
      derivationPath: segwit.derivationPath,
      pairedAt,
      xpub: segwit.xpub,
    });
    saveAccount({
      chain: "bitcoin",
      address: taproot.address,
      derivationPath: taproot.derivationPath,
      pairedAt,
      xpub: taproot.xpub,
    });

    // Render the DUAL-address VERIFY-ON-DEVICE block. Two `.replace()`
    // calls — one per placeholder. Template is the SOT (single source
    // of truth); the tests import the same const + run the same
    // substitution to assert byte-identity.
    const verifyBlock = VERIFY_ON_DEVICE_BTC_TEMPLATE
      .replace("{SEGWIT_ADDRESS}", segwit.address)
      .replace("{TAPROOT_ADDRESS}", taproot.address);

    return {
      content: [{ type: "text", text: verifyBlock }],
      structuredContent: {
        addresses: { segwit: segwit.address, taproot: taproot.address },
        derivationPaths: {
          segwit: segwit.derivationPath,
          taproot: taproot.derivationPath,
        },
        pairedAt,
        appVersion,
      },
    };
  } catch (err) {
    // Catch ladder ordered most-specific-first. Each branch hard-codes
    // its user-facing text so a future tweak to the underlying error
    // class's `.message` cannot reshape the wire response.

    if (err instanceof LedgerDeviceNotConnectedError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: No Ledger device detected over USB-HID. Connect your Ledger via USB, unlock it, and open the Bitcoin app, then re-call pair_btc_ledger.",
          },
        ],
        structuredContent: { errorCode: "LEDGER_NOT_CONNECTED" },
      };
    }

    if (err instanceof LedgerBtcAppNotOpenError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Bitcoin app is not the active app on the Ledger. Open the Bitcoin app on the device, then re-call pair_btc_ledger.",
          },
        ],
        structuredContent: { errorCode: "BITCOIN_APP_NOT_OPEN" },
      };
    }

    if (err instanceof BtcApprovalTimeoutError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Ledger did not approve the BTC address fetch within 60 seconds. Re-call pair_btc_ledger to retry.",
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
              "error: user rejected the pairing on the Ledger device. Re-call pair_btc_ledger when ready to approve on the device.",
          },
        ],
        structuredContent: { errorCode: "USER_REJECTED" },
      };
    }

    // Defensive catch-all. NOT in the locked-5 errorCode set — this is
    // the unstructured fallback for unexpected Errors.
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: pair_btc_ledger failed: ${message}`,
        },
      ],
      structuredContent: { errorCode: "INTERNAL_ERROR" },
    };
  }
});
