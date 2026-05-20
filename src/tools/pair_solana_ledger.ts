// MCP tool: pair_solana_ledger({}) — Plan 11-04 (SOL-01).
//
// Single-shot USB-HID pairing of a Ledger Solana app: opens the transport,
// reads the base58 address from the default 3-level derivation path
// (`44'/501'/0'`), persists the (chain, address, derivationPath, pairedAt)
// tuple to the non-EVM account store, and surfaces a `VERIFY-ON-DEVICE`
// block the user MUST cross-check against the on-device address screen.
//
// Two non-negotiables (mirroring `pair_ledger_live.ts`):
//
//   1. **Demo-mode FIRST refusal.** `isDemoMode()` is checked BEFORE any
//      USB-HID transport open / store touch. T-DEMO-1 mitigation: the
//      mocked `fetchSolanaAddress` spy must observe zero invocations in
//      this branch.
//   2. **`VERIFY_ON_DEVICE_SOLANA_TEMPLATE` const** is the SINGLE SOURCE
//      OF TRUTH for the on-device cross-check block (SOL-01). Tests import
//      the const + substitute placeholders the same way the handler does
//      so the block can't drift between prod and test (format-fanout-
//      regex-sync rule). The slot index (`0` in `44'/501'/0'`) surfaces;
//      the FULL derivation path appears only inside the parenthesized
//      hint, never as a top-level field — defense against the
//      `list_paired_non_evm_accounts` shoulder-surfing surface.
//
// Locked errorCode set (mirror of `pair_ledger_live.ts:200-208`):
//   - DEMO_MODE_REFUSED      — demo mode active; route via set_demo_wallet
//   - LEDGER_NOT_CONNECTED   — no USB-HID device enumerated
//   - SOLANA_APP_NOT_OPEN    — transport opened but Solana app not active
//   - USER_REJECTED          — on-device rejection (APDU 0x6985)
//   - APPROVAL_TIMEOUT       — 60s budget exceeded racing fetchSolanaAddress
//   - INTERNAL_ERROR         — defensive catch-all (NOT in locked-5 set)

import { isDemoMode } from "../config/env.js";
import { saveAccount } from "../wallet/non-evm-account-store.js";
import {
  APPROVAL_TIMEOUT_MS,
  DEFAULT_SOLANA_DERIVATION_PATH,
  LedgerDeviceNotConnectedError,
  LedgerSolanaAppNotOpenError,
  fetchSolanaAddress,
} from "../wallet/ledger-solana-transport.js";
import { registerTool } from "./index.js";

/**
 * Local timeout error class — distinct from the session-manager's
 * `ApprovalTimeoutError` (EVM/WC path); the Solana path has its own
 * 60s race so a future divergence in the EVM budget can't accidentally
 * silently shift the Solana timing.
 */
export class SolanaApprovalTimeoutError extends Error {
  constructor() {
    super(
      "Ledger did not approve the Solana address fetch within 60 seconds. Re-call pair_solana_ledger to retry; ensure your Ledger is unlocked and the Solana app is open.",
    );
    this.name = "SolanaApprovalTimeoutError";
  }
}

/**
 * Verbatim `VERIFY-ON-DEVICE` block for the Solana pairing flow (SOL-01).
 * Source-of-truth for the on-device cross-check the user reads against
 * the Solana app's address-display screen on the Ledger.
 *
 * Two placeholders, substituted at runtime via plain
 * `String.prototype.replace`:
 *   - `{ADDRESS}`                    — full base58 address (load-bearing;
 *                                      this IS the byte-for-byte target).
 *   - `{DERIVATION_PATH_LAST_INDEX}` — the LAST hardened index from the
 *                                      derivation path (e.g. `0` for
 *                                      `"44'/501'/0'"`). Surfaces the
 *                                      "which slot" without leaking the
 *                                      full BIP44 string at the top of
 *                                      the block.
 *
 * Format-fanout-regex-sync rule (global CLAUDE.md): tests import THIS
 * const, substitute placeholders the same way the handler does, and
 * assert the substituted block appears in `result.content[0].text`. Do
 * NOT duplicate the string into the test file.
 */
export const VERIFY_ON_DEVICE_SOLANA_TEMPLATE: string = [
  "VERIFY ON DEVICE",
  "────────────────",
  "Address: {ADDRESS}",
  "Slot:    #{DERIVATION_PATH_LAST_INDEX}  (derivation path: 44'/501'/{DERIVATION_PATH_LAST_INDEX}')",
  "",
  "Open the Solana app on your Ledger. The address shown above MUST match",
  "the address displayed on the device screen byte-for-byte. If anything",
  "differs, do NOT approve.",
].join("\n");

const DESCRIPTION = [
  "Open the Ledger Solana app over USB-HID, fetch the Solana base58 address from the configured derivation slot (default 44'/501'/0' — Ledger Live default), and persist the pairing for restart-safe `get_solana_status` reads.",
  "Use this when the user wants to read or (in Phase 12+) sign Solana transactions.",
  "Do NOT use this in demo mode — refuses with DEMO_MODE_REFUSED.",
  "Returns the address verbatim plus a VERIFY-ON-DEVICE block the user MUST match against the Ledger screen byte-for-byte.",
  "The persistent cache holds public-address + derivation-slot only; no key material crosses any boundary.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

/**
 * Extract the last hardened index from a 3-level Solana derivation path.
 * `"44'/501'/0'"` → `"0"`. Defensive: if the shape ever drifts we fall
 * back to the literal path so the VERIFY block is still readable.
 */
function lastHardenedIndex(derivationPath: string): string {
  const segments = derivationPath.split("/");
  const last = segments[segments.length - 1];
  if (!last) return derivationPath;
  // Strip the trailing hardened apostrophe if present.
  return last.endsWith("'") ? last.slice(0, -1) : last;
}

/**
 * Heuristic: is the underlying error an on-device user rejection?
 * Ledger APDU error 0x6985 surfaces as a `transport-error` from
 * `@ledgerhq/errors` whose `.message` includes the literal `"0x6985"`
 * or `"6985"`. We match on substring rather than the typed error class
 * because the Ledger SDK's error shape varies across `@ledgerhq/errors`
 * minors. False positives are bounded — the substring `6985` does not
 * appear in any other APDU status code path we expose.
 */
function isUserRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return msg.includes("0x6985") || msg.includes("6985");
}

registerTool("pair_solana_ledger", DESCRIPTION, INPUT_SCHEMA, async () => {
  // T-DEMO-1 mitigation: demo-mode check FIRST, BEFORE any USB-HID
  // transport open. The mocked `fetchSolanaAddress` spy must observe
  // zero invocations in this branch.
  if (isDemoMode()) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: pair_solana_ledger is not available in demo mode. Use `set_demo_wallet({ persona: <slug> })` to switch personas, or set `VAULTPILOT_DEMO=false` to pair a real Ledger.",
        },
      ],
      structuredContent: { errorCode: "DEMO_MODE_REFUSED" },
    };
  }

  try {
    // 60s budget race: `fetchSolanaAddress` against a timer. Mirrors the
    // session-manager.pair() shape at session-manager.ts:396-399.
    const result = await Promise.race<
      { address: string; rawPubkey: Buffer; appVersion: string }
    >([
      fetchSolanaAddress(DEFAULT_SOLANA_DERIVATION_PATH),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new SolanaApprovalTimeoutError()),
          APPROVAL_TIMEOUT_MS,
        );
      }),
    ]);

    const { address, appVersion } = result;
    const pairedAt = new Date().toISOString();

    saveAccount({
      chain: "solana",
      address,
      derivationPath: DEFAULT_SOLANA_DERIVATION_PATH,
      pairedAt,
    });

    const slotIndex = lastHardenedIndex(DEFAULT_SOLANA_DERIVATION_PATH);
    const verifyBlock = VERIFY_ON_DEVICE_SOLANA_TEMPLATE
      .replace("{ADDRESS}", address)
      .replace(/\{DERIVATION_PATH_LAST_INDEX\}/g, slotIndex);

    return {
      content: [{ type: "text", text: verifyBlock }],
      structuredContent: {
        address,
        derivationPath: DEFAULT_SOLANA_DERIVATION_PATH,
        pairedAt,
        appVersion,
      },
    };
  } catch (err) {
    // Catch ladder ordered most-specific-first. Each branch hard-codes
    // its user-facing text so a future tweak to the underlying error
    // class's `.message` can't reshape the wire response.

    if (err instanceof LedgerDeviceNotConnectedError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: No Ledger device detected over USB-HID. Connect your Ledger via USB, unlock it, and open the Solana app, then re-call pair_solana_ledger.",
          },
        ],
        structuredContent: { errorCode: "LEDGER_NOT_CONNECTED" },
      };
    }

    if (err instanceof LedgerSolanaAppNotOpenError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Solana app is not the active app on the Ledger. Open the Solana app on the device, then re-call pair_solana_ledger.",
          },
        ],
        structuredContent: { errorCode: "SOLANA_APP_NOT_OPEN" },
      };
    }

    if (err instanceof SolanaApprovalTimeoutError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Ledger did not approve the Solana address fetch within 60 seconds. Re-call pair_solana_ledger to retry.",
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
              "error: user rejected the pairing on the Ledger device. Re-call pair_solana_ledger when ready to approve on the device.",
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
          text: `error: pair_solana_ledger failed: ${message}`,
        },
      ],
      structuredContent: { errorCode: "INTERNAL_ERROR" },
    };
  }
});
