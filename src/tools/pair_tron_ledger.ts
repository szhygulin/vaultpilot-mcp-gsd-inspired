// MCP tool: pair_tron_ledger({}) — Phase 17 Plan 17-03 (TRON-PAIR-01).
//
// USB-HID pairing of a Ledger TRON app: opens the transport, reads the
// base58check T-prefixed address from the default 5-level BIP-44 derivation
// path (`44'/195'/0'/0/0`), persists the (chain, address, derivationPath,
// pairedAt) tuple to the non-EVM account store, and surfaces a
// VERIFY-ON-DEVICE block the user MUST cross-check against the on-device
// address screen.
//
// Mirror of `pair_solana_ledger.ts` with two TRON-specific divergences
// flagged in research § Topic 3 + § Topic 4:
//
//   1. **TRON uses a 5-level BIP-44 path** (`m/44'/195'/<account>'/0/0`).
//      The "slot" the user reads on the device screen is the ACCOUNT INDEX
//      (third segment), NOT the LAST segment. The `accountIndex(path)`
//      helper from `src/chains/tron/address.ts` extracts segments[2]. Using
//      `lastHardenedIndex` from `pair_solana_ledger.ts` would return the
//      address-index (`0` for the canonical `/0/0` suffix) for EVERY
//      account slot — wrong display, wrong cross-check, wrong shipped
//      product. **REGRESSION ANCHOR per research § Pitfall 6** — there is a
//      grep gate in the test file that asserts NO `lastHardenedIndex`
//      reference here.
//
//   2. **The Ledger TRON app returns the base58check address ALREADY
//      ENCODED.** Unlike Solana (where the app surfaces a raw 32-byte
//      pubkey we bs58-encode client-side), the TRON app does the
//      SHA-256-double + checksum-truncate + base58 encode on-device. The
//      `address` field is the verbatim T-prefixed string. NO client-side
//      encode step (see `ledger-tron-transport.ts` top-of-file note).
//
// Locked errorCode set (mirror of `pair_solana_ledger.ts:25-31`):
//   - DEMO_MODE_REFUSED      — demo mode active; route via set_demo_wallet
//   - LEDGER_NOT_CONNECTED   — no USB-HID device enumerated
//   - TRON_APP_NOT_OPEN      — transport opened but TRON app not active
//   - USER_REJECTED          — on-device rejection (APDU 0x6985)
//   - APPROVAL_TIMEOUT       — 60s budget exceeded racing fetchTronAddress
//   - INTERNAL_ERROR         — defensive catch-all (NOT in locked-5 set)

import { accountIndex } from "../chains/tron/address.js";
import { isDemoMode } from "../config/env.js";
import { saveAccount } from "../wallet/non-evm-account-store.js";
import {
  APPROVAL_TIMEOUT_MS,
  DEFAULT_TRON_DERIVATION_PATH,
  LedgerDeviceNotConnectedError,
  LedgerTronAppNotOpenError,
  fetchTronAddress,
} from "../wallet/ledger-tron-transport.js";
import { registerTool } from "./index.js";

/**
 * Local timeout error class — distinct from the EVM-WC and Solana paths;
 * each chain races its own 60s budget so a future divergence in one chain's
 * timing cannot silently shift the others. Mirror of
 * `SolanaApprovalTimeoutError` in `pair_solana_ledger.ts`.
 */
export class TronApprovalTimeoutError extends Error {
  constructor() {
    super(
      "Ledger did not approve the TRON address fetch within 60 seconds. Re-call pair_tron_ledger to retry; ensure your Ledger is unlocked and the TRON app is open.",
    );
    this.name = "TronApprovalTimeoutError";
  }
}

/**
 * Verbatim VERIFY-ON-DEVICE block for the TRON pairing flow (TRON-PAIR-01).
 * Source-of-truth for the on-device cross-check the user reads against the
 * TRON app's address-display screen on the Ledger.
 *
 * Two placeholders, substituted at runtime via plain
 * `String.prototype.replace`:
 *   - `{ADDRESS}`        — full base58check T-prefixed address (load-bearing;
 *                          this IS the byte-for-byte target).
 *   - `{ACCOUNT_INDEX}`  — the ACCOUNT slot (third segment) from a 5-level
 *                          BIP-44 path. Appears TWICE — once in the Slot:
 *                          label, once embedded in the derivation-path
 *                          text. Global-replace handles both positions.
 *
 * Format-fanout-regex-sync rule (global CLAUDE.md): tests import THIS const,
 * substitute placeholders the same way the handler does, and assert the
 * substituted block appears in `result.content[0].text`. Do NOT duplicate
 * the string into the test file.
 */
export const VERIFY_ON_DEVICE_TRON_TEMPLATE: string = [
  "VERIFY ON DEVICE",
  "────────────────",
  "Address: {ADDRESS}",
  "Slot:    #{ACCOUNT_INDEX}  (derivation path: 44'/195'/{ACCOUNT_INDEX}'/0/0)",
  "",
  "Open the TRON app on your Ledger. The address shown above MUST match",
  "the address displayed on the device screen byte-for-byte. If anything",
  "differs, do NOT approve.",
].join("\n");

const DESCRIPTION = [
  "Open the Ledger TRON app over USB-HID, fetch the base58check T-prefixed TRON address from the configured derivation slot (default 44'/195'/0'/0/0 — Ledger Live default), and persist the pairing for restart-safe `get_tron_status` reads.",
  "Use this when the user wants to read TRON balances or (in Phase 18+) sign TRX / TRC-20 transactions.",
  "Do NOT use this in demo mode — refuses with DEMO_MODE_REFUSED.",
  "Returns the base58check (T-prefixed) address verbatim plus a VERIFY-ON-DEVICE block the user MUST match against the Ledger screen byte-for-byte.",
  "The persistent cache holds public-address + derivation-slot only; no key material crosses any boundary.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    derivationSlot: {
      type: "integer",
      minimum: 0,
      description:
        "Optional account slot (0 by default). Widens the derivation path to 44'/195'/<slot>'/0/0 for users with multiple TRON accounts on the same device.",
    },
  },
  additionalProperties: false,
};

/**
 * Heuristic: is the underlying error an on-device user rejection? Ledger
 * APDU error 0x6985 surfaces as a transport-error from `@ledgerhq/errors`
 * whose `.message` contains the literal `"0x6985"` or `"6985"`. We match
 * on substring rather than the typed error class because the Ledger SDK's
 * error shape varies across `@ledgerhq/errors` minors. Mirror of
 * `isUserRejection` in `pair_solana_ledger.ts`.
 */
function isUserRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return msg.includes("0x6985") || msg.includes("6985");
}

registerTool("pair_tron_ledger", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // T-DEMO-1 mitigation: demo-mode check FIRST, BEFORE any USB-HID
  // transport open. The mocked `fetchTronAddress` spy must observe zero
  // invocations in this branch.
  if (isDemoMode()) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: pair_tron_ledger is not available in demo mode. Use `set_demo_wallet({ persona: <slug> })` to switch personas, or set `VAULTPILOT_DEMO=false` to pair a real Ledger.",
        },
      ],
      structuredContent: { errorCode: "DEMO_MODE_REFUSED" },
    };
  }

  // Resolve the derivation path. Default is `44'/195'/0'/0/0`; optional
  // `derivationSlot` override widens to `44'/195'/<slot>'/0/0`. The slot
  // is the THIRD segment (account index), NOT the last segment.
  const slotRaw = args.derivationSlot;
  let derivationPath: string;
  if (slotRaw === undefined) {
    derivationPath = DEFAULT_TRON_DERIVATION_PATH;
  } else if (
    typeof slotRaw === "number" &&
    Number.isInteger(slotRaw) &&
    slotRaw >= 0
  ) {
    derivationPath = `44'/195'/${slotRaw}'/0/0`;
  } else {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: derivationSlot must be a non-negative integer; got ${JSON.stringify(slotRaw)}`,
        },
      ],
      structuredContent: { errorCode: "INVALID_INPUT" },
    };
  }

  try {
    // 60s budget race: fetchTronAddress against a timer. Mirrors the
    // pair_solana_ledger.ts:152-163 shape.
    const result = await Promise.race<
      { address: string; publicKey: string; appVersion: string }
    >([
      fetchTronAddress(derivationPath),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new TronApprovalTimeoutError()),
          APPROVAL_TIMEOUT_MS,
        );
      }),
    ]);

    const { address, appVersion } = result;
    const pairedAt = new Date().toISOString();

    saveAccount({
      chain: "tron",
      address,
      derivationPath,
      pairedAt,
    });

    // Render the VERIFY-ON-DEVICE block. Global-replace on `{ACCOUNT_INDEX}`
    // — the placeholder appears twice (Slot: label + derivation-path text).
    const slotIndex = accountIndex(derivationPath);
    const verifyBlock = VERIFY_ON_DEVICE_TRON_TEMPLATE
      .replace("{ADDRESS}", address)
      .replace(/\{ACCOUNT_INDEX\}/g, slotIndex);

    return {
      content: [{ type: "text", text: verifyBlock }],
      structuredContent: {
        address,
        derivationPath,
        pairedAt,
        appVersion,
      },
    };
  } catch (err) {
    // Catch ladder ordered most-specific-first. Each branch hard-codes its
    // user-facing text so a future tweak to the underlying error class's
    // `.message` cannot reshape the wire response.

    if (err instanceof LedgerDeviceNotConnectedError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: No Ledger device detected over USB-HID. Connect your Ledger via USB, unlock it, and open the TRON app, then re-call pair_tron_ledger.",
          },
        ],
        structuredContent: { errorCode: "LEDGER_NOT_CONNECTED" },
      };
    }

    if (err instanceof LedgerTronAppNotOpenError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: TRON app is not the active app on the Ledger. Open the TRON app on the device, then re-call pair_tron_ledger.",
          },
        ],
        structuredContent: { errorCode: "TRON_APP_NOT_OPEN" },
      };
    }

    if (err instanceof TronApprovalTimeoutError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Ledger did not approve the TRON address fetch within 60 seconds. Re-call pair_tron_ledger to retry.",
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
              "error: user rejected the pairing on the Ledger device. Re-call pair_tron_ledger when ready to approve on the device.",
          },
        ],
        structuredContent: { errorCode: "USER_REJECTED" },
      };
    }

    // Defensive catch-all. NOT in the locked-5 errorCode set — this is the
    // unstructured fallback for unexpected Errors.
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: pair_tron_ledger failed: ${message}`,
        },
      ],
      structuredContent: { errorCode: "INTERNAL_ERROR" },
    };
  }
});
