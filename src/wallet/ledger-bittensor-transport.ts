// USB-HID transport + Ledger Polkadot Generic app wrapper (Phase 46 Plan
// 46-02). Mirror of `ledger-solana-transport.ts` with the Substrate
// divergences documented below.
//
// Per-call transport (NOT a singleton): the underlying `node-hid` device
// handle MUST be closed after every APDU exchange. Holding the handle open
// across calls makes the next `TransportNodeHid.open()` fail with "device
// busy" (same invariant as the Solana / TRON / BTC transports).
//
// KEY DIVERGENCE from Solana (RESEARCH §Pattern 2):
//   - Solana `getAddress()` returns `{ address: Buffer }` (raw 32-byte
//     pubkey) → requires `bs58.encode`.
//   - Bittensor `getAddressEd25519(path, ss58prefix, showInDevice?)`
//     returns `{ address: string (SS58 PRE-ENCODED by the device),
//     pubKey: hex }`. The device returns the SS58 address ready to use —
//     NO client-side encode in the pairing path. The `pubKey` hex is
//     retained for the test-vector anchor + persona DOA.
//   - `PolkadotGenericApp` is a CLASS — `new PolkadotGenericApp(transport)`.
//     There is NO `newSubstrateApp` factory in 2.3.4 (RESEARCH §State of
//     the Art correction). `ss58prefix` (42) is a REQUIRED positional.
//
// App-not-open detection: the generic app's first APDU is `GET_VERSION`
// (INS 0). `BaseApp.getVersion()` (from @zondax/ledger-js) exchanges it;
// a throw means the active app on the device is not the Polkadot Generic
// app → map to `LedgerBittensorAppNotOpenError` (mirror of the Solana
// `getAppConfiguration()`-throws diagnosis).
//
// NodeNext + ESM default-export drift: the Ledger transport package's
// `.d.ts` declares `default` only; the `(Module as any).default ?? Module`
// shim picks the right runtime constructor. `@zondax/ledger-substrate` is
// CJS — both `import pkg from` (then `pkg.PolkadotGenericApp`) and
// `import { PolkadotGenericApp }` work under NodeNext; we use the default
// import + destructure to match the existing transport-file idiom.

import TransportNodeHidModule from "@ledgerhq/hw-transport-node-hid";
import LedgerSubstrateModule from "@zondax/ledger-substrate";

import { log } from "../diagnostics/logger.js";
import { LedgerDeviceNotConnectedError } from "./ledger-solana-transport.js";

// `(Module as any).default ?? Module` — NodeNext + ESM default-export
// drift (see top-of-file note). The transport package declares a `default`
// class export only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TransportNodeHid: any =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (TransportNodeHidModule as any).default ?? TransportNodeHidModule;

// @zondax/ledger-substrate is CJS; `PolkadotGenericApp` is exposed on the
// default export AND as a named export. Destructure from the default
// (matches the transport-file default-import idiom).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LedgerSubstrate: any =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (LedgerSubstrateModule as any).default ?? LedgerSubstrateModule;
const PolkadotGenericApp = LedgerSubstrate.PolkadotGenericApp;

/**
 * Bittensor's BIP44 derivation path — a 5-LEVEL string (SLIP-44 coin type
 * 354, generic Substrate). NOT Solana's 3-level shape: the Polkadot
 * Generic app declares `requiredPathLengths: [5]` (verified in the SDK
 * dist), so a 3-level path is rejected with "Invalid path length"
 * (Pitfall 1). The const is the single source of truth.
 */
export const DEFAULT_BITTENSOR_DERIVATION_PATH = "44'/354'/0'/0'/0'";

/**
 * SS58 network prefix for Bittensor coldkeys (milestone-locked). Passed as
 * the REQUIRED positional `ss58prefix` arg to `getAddressEd25519`.
 */
export const BITTENSOR_SS58_PREFIX = 42;

/**
 * Time budget for an on-device approval (consumed by the pair handler when
 * racing `fetchBittensorAddress` against a timer). Mirrors the Solana
 * `APPROVAL_TIMEOUT_MS`.
 */
export const APPROVAL_TIMEOUT_MS = 60_000;

/**
 * Thrown when the transport opens but the active app on the device is not
 * the Polkadot Generic app. Diagnosed by `getVersion()` throwing — the
 * generic app's GET_VERSION APDU fails before the address fetch. Mirror of
 * `LedgerSolanaAppNotOpenError`.
 */
export class LedgerBittensorAppNotOpenError extends Error {
  constructor() {
    super(
      "Polkadot Generic app is not the active app on the Ledger. Open the Polkadot (Generic) app on the device, then retry.",
    );
    this.name = "LedgerBittensorAppNotOpenError";
  }
}

interface TransportLike {
  close: () => Promise<void>;
  disconnected?: boolean;
}

/**
 * Spy-affordance indirection for the Ledger SDK statics + the generic-app
 * version-probe. Production code calls `_transport.isSupported()` /
 * `.list()` / `.open()` / `.buildGenericApp(t)` / `.getVersionViaApp(app)`
 * instead of the raw class methods so `vi.spyOn(_transport, …)` works
 * across the ESM module boundary. CLAUDE.md "Add the indirection at write
 * time" — direct spies on the immutable named-export bindings silently
 * no-op.
 */
export const _transport = {
  isSupported: (): Promise<boolean> => TransportNodeHid.isSupported(),
  list: (): Promise<readonly unknown[]> => TransportNodeHid.list(),
  open: (path: string | null): Promise<unknown> => TransportNodeHid.open(path),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildGenericApp: (t: unknown): any => new PolkadotGenericApp(t),
  // The GET_VERSION APDU exchange — the app-not-open probe. Routed through
  // the indirection so tests can spy the per-call seam.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getVersionViaApp: (app: any): Promise<unknown> => app.getVersion(),
  // The address fetch. `getAddressEd25519(path, ss58prefix)` returns
  // `{ address: SS58-string (pre-encoded), pubKey: hex }`.
  getAddressEd25519ViaApp: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app: any,
    derivationPath: string,
    ss58prefix: number,
  ): Promise<{ address: string; pubKey: string }> =>
    app.getAddressEd25519(derivationPath, ss58prefix),
};

/**
 * Open a fresh USB-HID transport to the first available Ledger.
 *
 * Throws `LedgerDeviceNotConnectedError` (reused from the Solana transport
 * — the device-absence condition is chain-agnostic) when the platform
 * lacks node-hid support (`isSupported() === false`) or when no devices
 * are enumerated (`list() === []`). The transport is NEVER opened in
 * either no-device branch.
 *
 * NOT a singleton: every call yields a fresh transport. Callers MUST call
 * `transport.close()` (via `try/finally`) before the next call.
 */
export async function openTransport(): Promise<TransportLike> {
  const supported = await _transport.isSupported();
  if (!supported) throw new LedgerDeviceNotConnectedError();
  const devices = await _transport.list();
  if (!devices || devices.length === 0) {
    throw new LedgerDeviceNotConnectedError();
  }
  log("info", "opening USB-HID transport to Ledger device (Bittensor)");
  return (await _transport.open(null)) as TransportLike;
}

/**
 * Fetch a Bittensor SS58 address from the Ledger Polkadot Generic app.
 *
 * Returns `{ address, pubKey }`:
 *   - `address`: the SS58-encoded coldkey, PRE-ENCODED by the device under
 *     prefix 42. Used verbatim — NO client-side bs58/encodeAddress here
 *     (the divergence from Solana's raw-pubkey path).
 *   - `pubKey`: the ed25519 public key hex (retained for the test-vector
 *     anchor + persona DOA).
 *
 * Probes `getVersion()` first — a throw maps to
 * `LedgerBittensorAppNotOpenError` (the active app is not the generic app).
 *
 * `transport.close()` is invoked unconditionally in `finally` — both the
 * happy path and every error path release the USB-HID handle.
 */
export async function fetchBittensorAddress(
  derivationPath: string = DEFAULT_BITTENSOR_DERIVATION_PATH,
): Promise<{ address: string; pubKey: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildGenericApp(transport);
    // GET_VERSION APDU — confirms the active app is the Polkadot Generic
    // app. A throw means the active app is something else.
    try {
      await _transport.getVersionViaApp(app);
    } catch {
      throw new LedgerBittensorAppNotOpenError();
    }
    // The device returns the SS58 address pre-encoded under prefix 42 —
    // returned verbatim, no client-side re-encode.
    const { address, pubKey } = await _transport.getAddressEd25519ViaApp(
      app,
      derivationPath,
      BITTENSOR_SS58_PREFIX,
    );
    return { address, pubKey };
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
 * Test-only reset. The transport is per-call (no singleton state to clear);
 * the function exists for parity with the Solana / TRON / BTC transports so
 * test suites can call it uniformly in `beforeEach`.
 */
export function _resetLedgerBittensorTransportForTesting(): void {
  // No singleton state — intentional no-op.
}
