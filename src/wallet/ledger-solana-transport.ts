// USB-HID transport + Ledger Solana app wrapper.
//
// Per-call transport (NOT a singleton): the underlying `node-hid` device
// handle MUST be closed after every APDU exchange. The next call to
// `pair_solana_ledger` opens a fresh transport. Holding the handle open
// across calls makes the next `TransportNodeHid.open()` fail with
// "device busy"; once `transport.disconnected` flips to true, every
// subsequent APDU throws `DisconnectedDevice` from `@ledgerhq/errors`.
//
// `getAddress()` returns `{ address: Buffer }` — a 32-byte raw Ed25519
// public key, NOT a base58 string. This module is the single place that
// applies `bs58.encode(buf)`; downstream callers see only the encoded
// string. Doc-strings on the Ledger SDK use the word "address" without
// distinguishing the Buffer vs. base58 form, so don't trust them blindly
// — the typed signature in `@ledgerhq/hw-app-solana/Solana.d.ts` is
// authoritative.
//
// NodeNext + ESM default-export drift: the Ledger packages' `lib-es/.d.ts`
// declares `default` only. Under TS5+ NodeNext the typed default class
// occasionally fails the runtime `new X(...)` check (the value at the
// `.default` property differs from the type's declared default). The
// `(Module as any).default ?? Module` shim at module scope picks the
// right runtime constructor without leaking `any` through the rest of
// the file.

import TransportNodeHidModule from "@ledgerhq/hw-transport-node-hid";
import SolanaAppModule from "@ledgerhq/hw-app-solana";
import bs58 from "bs58";

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
const SolanaApp: any =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (SolanaAppModule as any).default ?? SolanaAppModule;

/**
 * Ledger Live's default Solana derivation path — 3 levels, account
 * index hardened. Phantom-compat 4-level `"44'/501'/<acct>'/0'"` is
 * deferred to v2.0.x (additive `path?` arg on `pair_solana_ledger`).
 *
 * CITED: LedgerHQ/ledger-live PR #10351 — mode `solanaBip44` (3-level)
 * is Ledger Live's default; mode `solanaBip44Change` (4-level) is the
 * Phantom-compat opt-in.
 */
export const DEFAULT_SOLANA_DERIVATION_PATH = "44'/501'/0'";

/**
 * Time budget for an on-device approval (consumed by Plan 11-04's pair
 * handler when racing `fetchSolanaAddress` against a timer). Mirrors
 * `APPROVAL_TIMEOUT_MS` in `session-manager.ts`.
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
      "No Ledger device detected over USB-HID. Connect your Ledger via USB, unlock it, and open the Solana app, then retry.",
    );
    this.name = "LedgerDeviceNotConnectedError";
  }
}

/**
 * Thrown when the transport opens but the active app on the device is
 * not Solana. Diagnosed by `getAppConfiguration()` throwing — the
 * Solana app's APDU table doesn't overlap with other apps, so the
 * exchange fails before the version byte is read.
 */
export class LedgerSolanaAppNotOpenError extends Error {
  constructor() {
    super(
      "Solana app is not the active app on the Ledger. Open the Solana app on the device, then retry.",
    );
    this.name = "LedgerSolanaAppNotOpenError";
  }
}

/**
 * Spy-affordance indirection for the Ledger SDK statics. Production
 * code calls `_transport.isSupported()` / `.list()` / `.open()` /
 * `.buildSolanaApp(t)` instead of the raw class methods so
 * `vi.spyOn(_transport, "open")` works across the ESM module
 * boundary. CLAUDE.md "Add the indirection at write time" — direct
 * spies on the immutable named-export bindings silently no-op.
 */
export const _transport = {
  isSupported: (): Promise<boolean> => TransportNodeHid.isSupported(),
  list: (): Promise<readonly unknown[]> => TransportNodeHid.list(),
  open: (path: string | null): Promise<unknown> => TransportNodeHid.open(path),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildSolanaApp: (t: unknown): any => new SolanaApp(t),
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
 * Fetch a Solana address from the Ledger.
 *
 * Returns `{ address, rawPubkey, appVersion }`:
 *   - `address`: base58-encoded public key (the Solana on-chain
 *     identifier).
 *   - `rawPubkey`: the 32-byte Ed25519 public key Buffer as the
 *     device returned it — preserved for downstream callers that
 *     need byte-level access (signing flows in Phase 12).
 *   - `appVersion`: the Solana app version string from
 *     `getAppConfiguration()` (useful in diagnostics + status-tool
 *     responses).
 *
 * `transport.close()` is invoked unconditionally in `finally` — both
 * the happy path and every error path release the USB-HID handle.
 */
export async function fetchSolanaAddress(
  derivationPath: string = DEFAULT_SOLANA_DERIVATION_PATH,
): Promise<{ address: string; rawPubkey: Buffer; appVersion: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildSolanaApp(transport);
    let cfg: { version?: string };
    try {
      cfg = await app.getAppConfiguration();
    } catch {
      throw new LedgerSolanaAppNotOpenError();
    }
    const { address: rawPubkey } = await app.getAddress(derivationPath);
    const address = bs58.encode(rawPubkey);
    return { address, rawPubkey, appVersion: cfg.version ?? "unknown" };
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
 * `_resetWalletConnectClientForTesting` + `_resetSessionManagerForTesting`
 * so test suites can call it uniformly in `beforeEach`.
 */
export function _resetLedgerSolanaTransportForTesting(): void {
  // No singleton state — intentional no-op.
}
