// MCP tool: pair_bittensor_ledger({}) — Phase 46 Plan 46-02 (TAO-PAIR-01).
//
// Single-shot USB-HID pairing of a Ledger Polkadot Generic app coldkey for
// Bittensor: opens the transport, reads the SS58 address (PRE-ENCODED by
// the device under prefix 42) from the 5-level derivation path
// (`44'/354'/0'/0'/0'`), persists the (chain, address, derivationPath,
// pairedAt) tuple to the non-EVM account store under `chain:"bittensor"`,
// and surfaces a `VERIFY-ON-DEVICE` block the user MUST cross-check against
// the on-device address screen.
//
// KEY DIVERGENCE from pair_solana_ledger (RESEARCH §Pattern 2): Solana
// fetches a raw 32-byte pubkey and applies `bs58.encode` client-side.
// Bittensor's `getAddressEd25519` returns the SS58 address ALREADY encoded
// by the device — `fetchBittensorAddress` returns it verbatim, NO
// client-side encode in the pairing path.
//
// TAO-PAIR-01 — ed25519 coldkey statement: the DESCRIPTION and the success
// response BOTH state the account is an ed25519 coldkey, DISTINCT from a
// btcli-default sr25519 coldkey. The Ledger SE cannot sign sr25519, so the
// Ledger account IS the coldkey (milestone-locked; no sr25519-migration
// tooling).
//
// Two non-negotiables (mirroring pair_solana_ledger):
//
//   1. **Demo-mode FIRST refusal.** `isDemoMode()` is checked BEFORE any
//      USB-HID transport open / store touch. T-46-DEMO mitigation: the
//      mocked `_transport` spy must observe zero invocations in this branch.
//   2. **`VERIFY_ON_DEVICE_BITTENSOR_TEMPLATE` const** is the SINGLE SOURCE
//      OF TRUTH for the on-device cross-check block. Tests import the const
//      + substitute placeholders the same way the handler does so the block
//      can't drift between prod and test (format-fanout-regex-sync rule).
//      The slot index surfaces; the FULL derivation path appears only
//      inside the parenthesized hint, never as a top-level field — defense
//      against the `list_paired_non_evm_accounts` shoulder-surfing surface
//      (T-46-LEAK).
//
// Locked errorCode set (mirror of pair_solana_ledger):
//   - DEMO_MODE_REFUSED      — demo mode active; route via set_demo_wallet
//   - LEDGER_NOT_CONNECTED   — no USB-HID device enumerated
//   - BITTENSOR_APP_NOT_OPEN — transport opened but Polkadot Generic app
//                              not the active app
//   - USER_REJECTED          — on-device rejection (APDU 0x6985)
//   - APPROVAL_TIMEOUT       — 60s budget exceeded racing fetchBittensorAddress
//   - INTERNAL_ERROR         — defensive catch-all (NOT in locked set)

import { isDemoMode } from "../config/env.js";
import { saveAccount } from "../wallet/non-evm-account-store.js";
import { LedgerDeviceNotConnectedError } from "../wallet/ledger-solana-transport.js";
import {
  APPROVAL_TIMEOUT_MS,
  DEFAULT_BITTENSOR_DERIVATION_PATH,
  LedgerBittensorAppNotOpenError,
  fetchBittensorAddress,
} from "../wallet/ledger-bittensor-transport.js";
import { registerTool } from "./index.js";

/**
 * Local timeout error class — distinct from the session-manager's
 * `ApprovalTimeoutError` (EVM/WC path) and the Solana sibling; the
 * Bittensor path has its own 60s race so a future divergence in another
 * chain's budget can't accidentally shift the Bittensor timing.
 */
export class BittensorApprovalTimeoutError extends Error {
  constructor() {
    super(
      "Ledger did not approve the Bittensor address fetch within 60 seconds. Re-call pair_bittensor_ledger to retry; ensure your Ledger is unlocked and the Polkadot (Generic) app is open.",
    );
    this.name = "BittensorApprovalTimeoutError";
  }
}

/**
 * Verbatim `VERIFY-ON-DEVICE` block for the Bittensor pairing flow
 * (TAO-PAIR-01). Source-of-truth for the on-device cross-check the user
 * reads against the Polkadot Generic app's address-display screen on the
 * Ledger.
 *
 * Two placeholders, substituted at runtime via plain
 * `String.prototype.replace`:
 *   - `{ADDRESS}`                    — full SS58 address (load-bearing;
 *                                      this IS the byte-for-byte target).
 *   - `{DERIVATION_PATH_LAST_INDEX}` — the LAST hardened index from the
 *                                      5-level derivation path (`0` for
 *                                      `"44'/354'/0'/0'/0'"`). Surfaces the
 *                                      "which slot" without leaking the
 *                                      full BIP44 string at the top of the
 *                                      block.
 *
 * Format-fanout-regex-sync rule (global CLAUDE.md): tests import THIS const,
 * substitute placeholders the same way the handler does, and assert the
 * substituted block appears in `result.content[0].text`. Do NOT duplicate
 * the string into the test file.
 */
export const VERIFY_ON_DEVICE_BITTENSOR_TEMPLATE: string = [
  "VERIFY ON DEVICE",
  "────────────────",
  "Address: {ADDRESS}",
  "Slot:    #{DERIVATION_PATH_LAST_INDEX}  (derivation path: 44'/354'/0'/0'/{DERIVATION_PATH_LAST_INDEX}')",
  "",
  "This is an ed25519 coldkey (distinct from a btcli-default sr25519 coldkey —",
  "the Ledger signs ed25519, so this Ledger account IS your coldkey).",
  "",
  "Open the Polkadot (Generic) app on your Ledger. The address shown above",
  "MUST match the address displayed on the device screen byte-for-byte. If",
  "anything differs, do NOT approve.",
].join("\n");

const DESCRIPTION = [
  "Open the Ledger Polkadot Generic app over USB-HID, fetch the Bittensor SS58 address (prefix 42, pre-encoded by the device) from the 5-level derivation slot (44'/354'/0'/0'/0'), and persist the pairing for restart-safe get_bittensor_status reads.",
  "The paired account is an ed25519 coldkey — distinct from a btcli-default sr25519 coldkey. The Ledger secure element signs ed25519, so this Ledger account IS your Bittensor coldkey (no sr25519-migration tooling).",
  "Use this when the user wants to read or (in a later phase) stake/transfer TAO with a Ledger-secured coldkey.",
  "Do NOT use this in demo mode — refuses with DEMO_MODE_REFUSED.",
  "Returns the SS58 address verbatim plus a VERIFY-ON-DEVICE block the user MUST match against the Ledger screen byte-for-byte.",
  "The persistent cache holds public-address + derivation-slot only; no key material crosses any boundary.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

/**
 * Extract the last hardened index from the 5-level Bittensor derivation
 * path. `"44'/354'/0'/0'/0'"` → `"0"`. Defensive: if the shape ever drifts
 * we fall back to the literal path so the VERIFY block stays readable.
 */
function lastHardenedIndex(derivationPath: string): string {
  const segments = derivationPath.split("/");
  const last = segments[segments.length - 1];
  if (!last) return derivationPath;
  return last.endsWith("'") ? last.slice(0, -1) : last;
}

/**
 * Heuristic: is the underlying error an on-device user rejection? Ledger
 * APDU error 0x6985 surfaces as a `transport-error` whose `.message`
 * includes `"0x6985"` or `"6985"`. Substring match (not a typed class)
 * because the Ledger SDK's error shape varies across `@ledgerhq/errors`
 * minors. Mirror of the Solana sibling's `isUserRejection`.
 */
function isUserRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return msg.includes("0x6985") || msg.includes("6985");
}

registerTool("pair_bittensor_ledger", DESCRIPTION, INPUT_SCHEMA, async () => {
  // T-46-DEMO mitigation: demo-mode check FIRST, BEFORE any USB-HID
  // transport open. The mocked `_transport` spy must observe zero
  // invocations in this branch.
  if (isDemoMode()) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: pair_bittensor_ledger is not available in demo mode. Use `set_demo_wallet({ persona: <slug> })` to switch personas, or set `VAULTPILOT_DEMO=false` to pair a real Ledger.",
        },
      ],
      structuredContent: { errorCode: "DEMO_MODE_REFUSED" },
    };
  }

  try {
    // 60s budget race: `fetchBittensorAddress` against a timer. Mirrors the
    // Solana sibling's Promise.race shape.
    const result = await Promise.race<{ address: string; pubKey: string }>([
      fetchBittensorAddress(DEFAULT_BITTENSOR_DERIVATION_PATH),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new BittensorApprovalTimeoutError()),
          APPROVAL_TIMEOUT_MS,
        );
      }),
    ]);

    const { address } = result;
    const pairedAt = new Date().toISOString();

    saveAccount({
      chain: "bittensor",
      address,
      derivationPath: DEFAULT_BITTENSOR_DERIVATION_PATH,
      pairedAt,
    });

    const slotIndex = lastHardenedIndex(DEFAULT_BITTENSOR_DERIVATION_PATH);
    const verifyBlock = VERIFY_ON_DEVICE_BITTENSOR_TEMPLATE
      .replace("{ADDRESS}", address)
      .replace(/\{DERIVATION_PATH_LAST_INDEX\}/g, slotIndex);

    return {
      content: [{ type: "text", text: verifyBlock }],
      structuredContent: {
        address,
        derivationPath: DEFAULT_BITTENSOR_DERIVATION_PATH,
        pairedAt,
        keyType: "ed25519",
      },
    };
  } catch (err) {
    // Catch ladder ordered most-specific-first. Each branch hard-codes its
    // user-facing text so a future tweak to the underlying error class's
    // `.message` can't reshape the wire response.

    if (err instanceof LedgerDeviceNotConnectedError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: No Ledger device detected over USB-HID. Connect your Ledger via USB, unlock it, and open the Polkadot (Generic) app, then re-call pair_bittensor_ledger.",
          },
        ],
        structuredContent: { errorCode: "LEDGER_NOT_CONNECTED" },
      };
    }

    if (err instanceof LedgerBittensorAppNotOpenError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Polkadot (Generic) app is not the active app on the Ledger. Open the Polkadot (Generic) app on the device, then re-call pair_bittensor_ledger.",
          },
        ],
        structuredContent: { errorCode: "BITTENSOR_APP_NOT_OPEN" },
      };
    }

    if (err instanceof BittensorApprovalTimeoutError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Ledger did not approve the Bittensor address fetch within 60 seconds. Re-call pair_bittensor_ledger to retry.",
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
              "error: user rejected the pairing on the Ledger device. Re-call pair_bittensor_ledger when ready to approve on the device.",
          },
        ],
        structuredContent: { errorCode: "USER_REJECTED" },
      };
    }

    // Defensive catch-all. NOT in the locked errorCode set.
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: pair_bittensor_ledger failed: ${message}`,
        },
      ],
      structuredContent: { errorCode: "INTERNAL_ERROR" },
    };
  }
});
