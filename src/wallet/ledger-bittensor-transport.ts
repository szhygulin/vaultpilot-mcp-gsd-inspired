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

/**
 * Thrown when the user rejects the signing prompt on the Ledger device (the
 * Polkadot Generic app returns the user-reject APDU — `0x6986` /
 * "Transaction rejected"). Mirror of `LedgerSolanaUserRejectedError`. Mapped
 * by the Plan 47-04 `send_transaction` Bittensor arm to a `LEDGER_REJECTED`
 * envelope.
 */
export class LedgerBittensorUserRejectedError extends Error {
  constructor(cause?: string) {
    super(
      cause
        ? `User rejected the transaction on the Ledger device: ${cause}`
        : "User rejected the transaction on the Ledger device.",
    );
    this.name = "LedgerBittensorUserRejectedError";
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
  // The detached-signature sign (Phase 47 — Plan 47-04 / TAO-PREP-03). The
  // NON-deprecated `*Ed25519` variant — `signWithMetadata` (non-suffixed) is
  // `@deprecated` in 2.3.4 (RESEARCH §State of the Art). `txBlob` MUST be the
  // SAME `signableBlob` that fed the payloadFingerprint + the blake2-256
  // presign (T-47-11 — the device signs the fingerprint preimage). The device
  // returns ONLY the detached 64-byte ed25519 signature — NO private key
  // material crosses this seam. Routed through the indirection so tests spy
  // the per-call seam with a synthetic 64-byte vector.
  signWithMetadataEd25519ViaApp: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app: any,
    path: string,
    txBlob: Uint8Array,
    txMetadata: Uint8Array,
  ): Promise<{ signature: Buffer }> =>
    app.signWithMetadataEd25519(path, txBlob, txMetadata),
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
 * Fetch the on-device coldkey SS58 address + the Polkadot Generic app version
 * in a SINGLE transport open (Phase 49 Plan 49-01 / TAO-DIAG-01 — Option 1,
 * the RESEARCH-recommended single-open shape; mirror of TRON's bundled-version
 * `fetchTronAddress` precedent). `get_bittensor_setup_status` bundles ARM B
 * (on-device address) + ARM C (app version) behind ONE device approval rather
 * than two transport opens.
 *
 * Returns `{ address, pubKey, appVersion }`:
 *   - `address`: the SS58-encoded coldkey, PRE-ENCODED by the device under
 *     prefix 42 (returned verbatim, like `fetchBittensorAddress`).
 *   - `pubKey`: the ed25519 public key hex (retained for parity; the diagnostic
 *     does NOT surface it — on-device address is the trust anchor).
 *   - `appVersion`: `${major}.${minor}.${patch}` CAPTURED from the GET_VERSION
 *     probe (which `fetchBittensorAddress` discards). The device returns the
 *     version struct; we cast to `{ major, minor, patch }` per the
 *     `_transport.getVersionViaApp` shape (a shape mismatch yields a malformed
 *     string, but the diagnostic arm demotes both device fields to null on any
 *     throw — fail-safe).
 *
 * Diagnosis order MATCHES `fetchBittensorAddress`: GET_VERSION first — a throw
 * maps to `LedgerBittensorAppNotOpenError` (active app is not the generic app),
 * which the diagnostic classifies as `polkadot-app-closed`. A device-absent
 * condition surfaces as `LedgerDeviceNotConnectedError` from `openTransport`.
 *
 * `transport.close()` runs unconditionally in `finally` — both the happy path
 * and every error path release the USB-HID handle.
 */
export async function fetchBittensorSetup(
  derivationPath: string = DEFAULT_BITTENSOR_DERIVATION_PATH,
): Promise<{ address: string; pubKey: string; appVersion: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildGenericApp(transport);
    // GET_VERSION APDU — confirms the active app is the Polkadot Generic app
    // AND captures the version (the divergence from fetchBittensorAddress,
    // which discards the version result).
    let appVersion: string;
    try {
      const v = (await _transport.getVersionViaApp(app)) as {
        major: number;
        minor: number;
        patch: number;
      };
      appVersion = `${v.major}.${v.minor}.${v.patch}`;
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
    return { address, pubKey, appVersion };
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
 * Sign a Bittensor (Substrate) unsigned-extrinsic signable blob on the Ledger
 * Polkadot Generic app, returning the detached 64-byte ed25519 signature.
 * Phase 47 — Plan 47-04 (TAO-PREP-03).
 *
 * Opens a fresh transport (reuse `openTransport`), builds the generic app,
 * probes `getVersion()` (a throw → `LedgerBittensorAppNotOpenError`), then
 * calls `_transport.signWithMetadataEd25519ViaApp(app, path, signableBlob,
 * txMetadata)`. `transport.close()` is invoked unconditionally in `finally`.
 *
 * CRITICAL (T-47-11 / RESEARCH §Pattern 2 note): `signableBlob` is passed to
 * the device VERBATIM — it MUST equal the bytes that fed
 * `computeBittensorPayloadFingerprint` + the blake2-256 presign. The device
 * firmware re-derives the signing payload from this blob (blake2-256-
 * pre-hashing internally for >256-byte blobs); the SDK passes it raw.
 *
 * NO private key material — the device returns ONLY the detached signature.
 *
 * A device user-reject (APDU `0x6986` / a `/reject/i` message) maps to
 * `LedgerBittensorUserRejectedError`. The device-absent condition surfaces as
 * `LedgerDeviceNotConnectedError` (from `openTransport`).
 */
export async function signBittensorTransaction(input: {
  signableBlob: Uint8Array;
  txMetadata: Uint8Array;
  derivationPath?: string;
}): Promise<{ signature: Buffer }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildGenericApp(transport);
    // GET_VERSION APDU — confirms the active app is the Polkadot Generic app.
    try {
      await _transport.getVersionViaApp(app);
    } catch {
      throw new LedgerBittensorAppNotOpenError();
    }
    try {
      const { signature } = await _transport.signWithMetadataEd25519ViaApp(
        app,
        input.derivationPath ?? DEFAULT_BITTENSOR_DERIVATION_PATH,
        input.signableBlob,
        input.txMetadata,
      );
      return { signature };
    } catch (err) {
      // Re-throw the app-not-open class untouched (could surface from the
      // sign APDU on some firmware). User-reject → the dedicated class.
      if (err instanceof LedgerBittensorAppNotOpenError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (/reject/i.test(message) || /0x6986/.test(message)) {
        throw new LedgerBittensorUserRejectedError(message);
      }
      throw err;
    }
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
