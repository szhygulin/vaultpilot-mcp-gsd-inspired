// USB-HID transport + Ledger TRON app wrapper.
//
// Per-call transport (NOT a singleton): the underlying `node-hid` device
// handle MUST be closed after every APDU exchange. The next call to
// `pair_tron_ledger` opens a fresh transport. Holding the handle open
// across calls makes the next `TransportNodeHid.open()` fail with
// "device busy"; once `transport.disconnected` flips to true, every
// subsequent APDU throws `DisconnectedDevice` from `@ledgerhq/errors`.
//
// **REGRESSION ANCHOR (research § Topic 2, Pitfall 2):** unlike the
// Solana transport, `getAddress()` on `@ledgerhq/hw-app-trx` returns
// `{ address: string; publicKey: string; chainCode?: string }` where
// `address` is ALREADY the base58check T-prefixed TRON address — the
// Ledger TRON app does the SHA-256-double + checksum-truncate + base58
// encode on-device. This module MUST return that field VERBATIM. A
// `bs58.encode(...)` step here (copy-pasted from `ledger-solana-transport.ts`)
// would double-encode the already-encoded string and produce a garbled
// non-TRON value. The accompanying test pins a hardcoded
// `"TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb"` literal so this regression
// fails at a specific line. The typed signature in
// `@ledgerhq/hw-app-trx/lib-es/Trx.d.ts` is authoritative — read it
// before "fixing" anything here.
//
// NodeNext + ESM default-export drift: the Ledger packages' `lib-es/.d.ts`
// declares `default` only. Under TS5+ NodeNext the typed default class
// occasionally fails the runtime `new X(...)` check (the value at the
// `.default` property differs from the type's declared default). The
// `(Module as any).default ?? Module` shim at module scope picks the
// right runtime constructor without leaking `any` through the rest of
// the file. Same shape as `ledger-solana-transport.ts`.

import TransportNodeHidModule from "@ledgerhq/hw-transport-node-hid";
import TrxAppModule from "@ledgerhq/hw-app-trx";

import { log } from "../diagnostics/logger.js";

// `(Module as any).default ?? Module` — see top-of-file note on NodeNext
// + ESM default-export drift. Both Ledger packages declare a `default`
// class export only; the namespace import resolves to a namespace object
// whose `.default` IS the runtime class. Widening through `any` here
// keeps the rest of the file typed normally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TransportNodeHid: any =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (TransportNodeHidModule as any).default ?? TransportNodeHidModule;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TrxApp: any =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (TrxAppModule as any).default ?? TrxAppModule;

/**
 * Ledger Live's default TRON derivation path — 5-level BIP-44, account
 * index hardened. This is the canonical TronLink/Klever/Math wallet
 * shape and matches the doc examples in `@ledgerhq/hw-app-trx`
 * (`Trx.d.ts` uses `"44'/195'/0'/0/0"` throughout). Distinct from
 * Solana's 3-level `"44'/501'/0'"` — do not confuse the two. See
 * research § Topic 3 for the citation chain.
 */
export const DEFAULT_TRON_DERIVATION_PATH = "44'/195'/0'/0/0";

/**
 * Time budget for an on-device approval (consumed by Plan 17-03's pair
 * handler when racing `fetchTronAddress` against a timer). Mirrors
 * `APPROVAL_TIMEOUT_MS` in `ledger-solana-transport.ts` + `session-manager.ts`.
 */
export const APPROVAL_TIMEOUT_MS = 60_000;

/**
 * Thrown when no Ledger device is reachable over USB-HID — either the
 * platform lacks node-hid support, or `Transport.list()` returns empty.
 * Message names the recovery action so the agent can relay it verbatim.
 */
export class LedgerDeviceNotConnectedError extends Error {
  constructor() {
    super(
      "No Ledger device detected over USB-HID. Connect your Ledger via USB, unlock it, and open the TRON app, then retry.",
    );
    this.name = "LedgerDeviceNotConnectedError";
  }
}

/**
 * Thrown when the transport opens but the active app on the device is
 * not TRON. Diagnosed by `getAppConfiguration()` throwing — the TRON
 * app's APDU table doesn't overlap with other apps, so the exchange
 * fails before the version byte is read.
 */
export class LedgerTronAppNotOpenError extends Error {
  constructor() {
    super(
      "TRON app is not the active app on the Ledger. Open the TRON app on the device, then retry.",
    );
    this.name = "LedgerTronAppNotOpenError";
  }
}

/**
 * Spy-affordance indirection for the Ledger SDK statics. Production
 * code calls `_transport.isSupported()` / `.list()` / `.open()` /
 * `.buildTrxApp(t)` instead of the raw class methods so
 * `vi.spyOn(_transport, "open")` works across the ESM module
 * boundary. CLAUDE.md "Add the indirection at write time" — direct
 * spies on the immutable named-export bindings silently no-op.
 */
export const _transport = {
  isSupported: (): Promise<boolean> => TransportNodeHid.isSupported(),
  list: (): Promise<readonly unknown[]> => TransportNodeHid.list(),
  open: (path: string | null): Promise<unknown> => TransportNodeHid.open(path),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildTrxApp: (t: unknown): any => new TrxApp(t),
};

interface TransportLike {
  close: () => Promise<void>;
  disconnected?: boolean;
}

/**
 * Open a fresh USB-HID transport to the first available Ledger.
 *
 * Throws `LedgerDeviceNotConnectedError` when the platform lacks
 * node-hid support (`isSupported() === false`) or when no devices are
 * enumerated (`list() === []`). The thrown error names the recovery
 * action; the agent forwards it to the user.
 *
 * NOT a singleton: every call yields a fresh transport. Callers MUST
 * call `transport.close()` (typically via `try/finally`) before the
 * next call, or the device handle leaks and subsequent opens fail.
 */
export async function openTransport(): Promise<TransportLike> {
  const supported = await _transport.isSupported();
  if (!supported) throw new LedgerDeviceNotConnectedError();
  const devices = await _transport.list();
  if (!devices || devices.length === 0) {
    throw new LedgerDeviceNotConnectedError();
  }
  log("info", "opening USB-HID transport to Ledger device");
  return (await _transport.open(null)) as TransportLike;
}

/**
 * Fetch a TRON address from the Ledger.
 *
 * Returns `{ address, publicKey, appVersion }`:
 *   - `address`: base58check T-prefixed TRON address, **returned by
 *     the Ledger TRON app already encoded** (see top-of-file REGRESSION
 *     ANCHOR — unlike Solana, NO `bs58.encode` step here).
 *   - `publicKey`: the secp256k1 public key as a hex string (the
 *     uncompressed `04...` shape — Phase 18 signing flows consume this).
 *   - `appVersion`: the TRON app version string from
 *     `getAppConfiguration()` (useful in diagnostics + status-tool
 *     responses).
 *
 * `transport.close()` is invoked unconditionally in `finally` — both
 * the happy path and every error path release the USB-HID handle.
 */
export async function fetchTronAddress(
  derivationPath: string = DEFAULT_TRON_DERIVATION_PATH,
): Promise<{ address: string; publicKey: string; appVersion: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildTrxApp(transport);
    let cfg: { version?: string };
    try {
      cfg = await app.getAppConfiguration();
    } catch {
      throw new LedgerTronAppNotOpenError();
    }
    // CRITICAL: `address` field returned by the Ledger TRX app is
    // ALREADY base58check T-prefixed string. NO `bs58.encode` step
    // (unlike Solana — see top-of-file REGRESSION ANCHOR).
    const { address, publicKey } = await app.getAddress(derivationPath);
    return { address, publicKey, appVersion: cfg.version ?? "unknown" };
  } finally {
    try {
      await transport.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("warn", `transport.close() failed during cleanup: ${message}`);
    }
  }
}

/**
 * Test-only reset. The transport is per-call (no singleton state to
 * clear); the function exists for parity with
 * `_resetLedgerSolanaTransportForTesting` so test suites can call it
 * uniformly in `beforeEach`.
 */
export function _resetLedgerTronTransportForTesting(): void {
  // No singleton state — intentional no-op.
}
