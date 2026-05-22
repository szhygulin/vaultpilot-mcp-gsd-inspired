// USB-HID transport + Ledger Bitcoin app wrapper.
//
// Per-call transport (NOT a singleton): the underlying `node-hid` device
// handle MUST be closed after every APDU exchange. The next call to
// `pair_btc_ledger` opens a fresh transport. Holding the handle open
// across calls makes the next `TransportNodeHid.open()` fail with
// "device busy"; once `transport.disconnected` flips to true, every
// subsequent APDU throws `DisconnectedDevice` from `@ledgerhq/errors`.
//
// **REGRESSION ANCHOR (research § Pitfall 7 — address-format mismatch):**
// `getWalletPublicKey(path, { format })` returns the address in WHATEVER
// format the caller asks for, regardless of whether `path` agrees with
// `format`. The BIP-84 path → `format: "bech32"` mapping and the BIP-86
// path → `format: "bech32m"` mapping are HARDCODED at module scope.
// NEVER accept format as agent input. The accompanying test pins the
// `bc1q…` / `bc1p…` prefix invariants so a future contributor can't
// silently mutate the format → path mapping.
//
// **REGRESSION ANCHOR (research § Pitfall 2 — APDU table overlap with
// Litecoin):** `getAppConfiguration()` is the canonical "is BTC app open"
// gate. Without this gate, calling `getWalletPublicKey` while the Ledger
// has Litecoin (or any other BTC-fork app) open silently returns an
// LTC address (`ltc1q…` / `M…` prefix), not a BTC one. Map the throw to
// `LedgerBtcAppNotOpenError` exactly like `LedgerTronAppNotOpenError`.
//
// **REGRESSION ANCHOR (Meta-Decision 2 — 5-level BIP-44 paths):** Phase
// 22 uses 5-level paths (`m/84'/0'/0'/0/0` + `m/86'/0'/0'/0/0`) —
// purpose / coin_type / account / change / address_index. Same shape as
// TRON's `m/44'/195'/0'/0/0`. **Distinct from Solana's 3-level**
// `m/44'/501'/0'`. A `lastHardenedIndex` helper copy-pasted from Solana
// would return `0` (the address-index, last segment) for every slot.
// The companion test exercises segment-by-segment shape so copy-paste
// regression fails at a specific line, not silently.
//
// **REGRESSION ANCHOR (research § Pitfall 5 — transport handle leak):**
// TWO sequential `getWalletPublicKey` calls means TWO ways to throw;
// the `finally` block MUST cover both. ONE `try` wraps BOTH
// `getWalletPublicKey` calls; ONE `finally` calls `transport.close()`.
//
// NodeNext + ESM default-export drift: the Ledger packages' `lib-es/.d.ts`
// declares `default` only. Under TS5+ NodeNext the typed default class
// occasionally fails the runtime `new X(...)` check (the value at the
// `.default` property differs from the type's declared default). The
// `(Module as any).default ?? Module` shim at module scope picks the
// right runtime constructor without leaking `any` through the rest of
// the file. Same shape as `ledger-tron-transport.ts` and
// `ledger-solana-transport.ts`.
//
// **Phase 23 — signBtcPsbt (RESEARCH Pattern 3 — two-pass mixed-input signing):**
// `signPsbtBuffer` (the v10 descriptor-wallet PSBT workflow) rejects a PSBT
// whose internal inputs span more than one script type ("Mixed input types
// detected"). For mixed segwit + taproot PSBTs, `signBtcPsbt` partitions by
// script type, calls `signPsbtBuffer` once per group, then `Psbt.combine()`
// the partials → `finalizeAllInputs()` → `extractTransaction().toHex()`.
// `knownAddressDerivations` is REQUIRED on every call (Pitfall 6 — without the
// change address in it, the device displays change as a send).

import TransportNodeHidModule from "@ledgerhq/hw-transport-node-hid";
import BtcAppModule from "@ledgerhq/hw-app-btc";
import AppClientModule, { WalletPolicy as WalletPolicyNamed } from "@ledgerhq/ledger-bitcoin";
import { Psbt } from "bitcoinjs-lib";

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
const BtcApp: any =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BtcAppModule as any).default ?? BtcAppModule;
// NodeNext ESM default-export drift shim for @ledgerhq/ledger-bitcoin.
// AppClient is the default export (class). WalletPolicy is a named export.
// Under CJS-interop / NodeNext the namespace object carries both `.default`
// (AppClient class) and named exports (WalletPolicy, etc.). Using the
// `(Module as any).default ?? Module` shim picks the right runtime constructor
// without leaking `any` through the rest of the file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AppClient: any = (AppClientModule as any).default ?? AppClientModule;
// Resolve WalletPolicy — three lookup paths for CJS-interop + ESM namespace variance:
//   1. Named import `WalletPolicyNamed` (works when bundler resolves named exports correctly).
//   2. `(AppClientModule as any).WalletPolicy` (namespace object carries named exports under CJS).
//   3. `(AppClientModule as any).default?.WalletPolicy` (rare: default object carries WalletPolicy).
// If all three are undefined the package has a breaking export change; callers throw on first use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WalletPolicy: any =
  (WalletPolicyNamed as unknown) ??
  (AppClientModule as any).WalletPolicy ??
  (AppClientModule as any).default?.WalletPolicy;

/**
 * Ledger Live's default BTC segwit derivation path — 5-level BIP-44,
 * BIP-84 standard. P2WPKH → `bc1q…` prefix. Mirror of TRON's 5-level
 * shape (`44'/195'/0'/0/0`); distinct from Solana's 3-level
 * `"44'/501'/0'"` — do not confuse the two.
 */
export const DEFAULT_BTC_SEGWIT_PATH = "84'/0'/0'/0/0";

/**
 * Ledger Live's default BTC taproot derivation path — 5-level BIP-44,
 * BIP-86 standard. P2TR → `bc1p…` prefix.
 */
export const DEFAULT_BTC_TAPROOT_PATH = "86'/0'/0'/0/0";

/**
 * Time budget for an on-device approval (consumed by Plan 22-02's pair
 * handler when racing `fetchBtcAddresses` against a timer). Mirrors
 * `APPROVAL_TIMEOUT_MS` in `ledger-tron-transport.ts` +
 * `ledger-solana-transport.ts` + `session-manager.ts`.
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
      "No Ledger device detected over USB-HID. Connect your Ledger via USB, unlock it, and open the Bitcoin app, then retry.",
    );
    this.name = "LedgerDeviceNotConnectedError";
  }
}

/**
 * Thrown when the transport opens but the active app on the device is
 * not Bitcoin (typically Litecoin / Bitcoin-clone fork — the BTC app's
 * APDU table overlaps with these derivative apps; `getAppConfiguration`
 * is the canonical gate to discriminate).
 */
export class LedgerBtcAppNotOpenError extends Error {
  constructor() {
    super(
      "Bitcoin app is not the active app on the Ledger. Open the Bitcoin app on the device, then retry.",
    );
    this.name = "LedgerBtcAppNotOpenError";
  }
}

/**
 * Thrown when the device's BTC app version is too old to support
 * multisig wallet-policy registration (requires BTC app v2.1+).
 * The `registerWallet` APDU is only available from v2.1 onward.
 *
 * T-25-13 mitigation: `registerBtcMultisigWallet` version-gates via
 * `getAppConfiguration()` before any APDU exchange.
 */
export class LedgerBtcAppVersionTooOldError extends Error {
  constructor() {
    super(
      "Ledger Bitcoin app version too old for multisig wallet policies. " +
        "Update Ledger Live to install Bitcoin app 2.1+ on your device, then retry.",
    );
    this.name = "LedgerBtcAppVersionTooOldError";
  }
}

/**
 * Spy-affordance indirection for the Ledger SDK statics. Production
 * code calls `_transport.isSupported()` / `.list()` / `.open()` /
 * `.buildBtcApp(t)` instead of the raw class methods so
 * `vi.spyOn(_transport, "open")` works across the ESM module
 * boundary. CLAUDE.md "Add the indirection at write time" — direct
 * spies on the immutable named-export bindings silently no-op.
 *
 * `buildBtcApp` hardcodes `currency: "bitcoin"` (RESEARCH A6 — named-arg
 * ctor; Phase 26 LTC sharing decision deferred). Single point of change
 * when LTC scaffolding lands.
 */
export const _transport = {
  isSupported: (): Promise<boolean> => TransportNodeHid.isSupported(),
  list: (): Promise<readonly unknown[]> => TransportNodeHid.list(),
  open: (path: string | null): Promise<unknown> => TransportNodeHid.open(path),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildBtcApp: (t: unknown): any => new BtcApp({ transport: t, currency: "bitcoin" }),
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
 * Fetch BOTH segwit AND taproot addresses from the Ledger in ONE
 * device session.
 *
 * Returns `{ segwit, taproot, appVersion }`:
 *   - `segwit`: BIP-84 (`m/84'/0'/0'/0/0`) → `bc1q…` (P2WPKH).
 *   - `taproot`: BIP-86 (`m/86'/0'/0'/0/0`) → `bc1p…` (P2TR).
 *   - Each address-record carries `{ address, publicKey, chainCode,
 *     derivationPath }`. The `address` field is **already encoded** in
 *     the requested format by the Ledger BTC app — NO client-side
 *     bech32 / bech32m step (Pitfall 7).
 *   - `appVersion`: the BTC app version string from
 *     `getAppConfiguration()` (useful in diagnostics + status-tool
 *     responses).
 *
 * `getAppConfiguration()` runs FIRST inside the `try` block — if it
 * throws (typical when LTC / BTC-fork app is open), we map to
 * `LedgerBtcAppNotOpenError` (Pitfall 2). The two `getWalletPublicKey`
 * calls are wrapped in the SAME `try/finally` so `transport.close()`
 * runs unconditionally on BOTH error paths AND the happy path (Pitfall
 * 5 — single transport-open wraps both APDU exchanges).
 *
 * `verify: true` is passed on both `getWalletPublicKey` calls — this
 * forces the device to display each address on-screen and await user
 * confirmation (RESEARCH § Plan 22-02 risks — pair-time on-device
 * confirm is the whole point of pairing).
 */
/**
 * xpub mainnet version bytes (0x0488B21E = 76067358). Passed to
 * `getWalletXpub({ path, xpubVersion })` so the Ledger BTC app returns an
 * `xpub…`-encoded extended public key (not zpub / ypub). This is the form
 * bip32@^5.0.1 accepts directly without normalization.
 *
 * CR-02 / CR-03: the account-level xpub (m/84'/0'/0' segwit, m/86'/0'/0'
 * taproot) is fetched in the SAME device session as the address exchange and
 * persisted to the non-EVM account store at pair time. `prepare_btc_send`
 * then derives fresh chain-1 change addresses from the stored xpub without
 * opening a second transport session.
 */
export const XPUB_VERSION_MAINNET = 0x0488b21e;

export async function fetchBtcAddresses(
  segwitPath: string = DEFAULT_BTC_SEGWIT_PATH,
  taprootPath: string = DEFAULT_BTC_TAPROOT_PATH,
): Promise<{
  segwit: { address: string; publicKey: string; chainCode: string; derivationPath: string; xpub: string };
  taproot: { address: string; publicKey: string; chainCode: string; derivationPath: string; xpub: string };
  appVersion: string;
}> {
  const transport = await openTransport();
  try {
    const app = _transport.buildBtcApp(transport);
    let cfg: { version?: string };
    try {
      cfg = await app.getAppConfiguration();
    } catch {
      throw new LedgerBtcAppNotOpenError();
    }
    // Address exchanges (2 APDU calls).
    // Format / path mapping is HARDCODED — never agent-input (Pitfall 7).
    // BIP-84 → bech32 (`bc1q…`); BIP-86 → bech32m (`bc1p…`).
    const segwit = await app.getWalletPublicKey(segwitPath, { format: "bech32", verify: true });
    const taproot = await app.getWalletPublicKey(taprootPath, { format: "bech32m", verify: true });

    // CR-02 / CR-03: fetch account-level xpubs for change-chain derivation.
    // `getWalletXpub` takes the ACCOUNT path (3 levels) — strip the two trailing
    // `/change/index` segments from the 5-level address paths. For the defaults
    // that is `84'/0'/0'` and `86'/0'/0'`.
    // `xpubVersion: 0x0488B21E` → mainnet xpub encoding (bip32@^5.0.1 compatible).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const segwitXpub: string = await app.getWalletXpub({
      path: "84'/0'/0'",
      xpubVersion: XPUB_VERSION_MAINNET,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const taprootXpub: string = await app.getWalletXpub({
      path: "86'/0'/0'",
      xpubVersion: XPUB_VERSION_MAINNET,
    });

    return {
      segwit: {
        address: segwit.bitcoinAddress,
        publicKey: segwit.publicKey,
        chainCode: segwit.chainCode,
        derivationPath: segwitPath,
        xpub: segwitXpub,
      },
      taproot: {
        address: taproot.bitcoinAddress,
        publicKey: taproot.publicKey,
        chainCode: taproot.chainCode,
        derivationPath: taprootPath,
        xpub: taprootXpub,
      },
      appVersion: cfg.version ?? "unknown",
    };
  } finally {
    try {
      await transport.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("warn", `transport.close() failed during cleanup: ${message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 23 Plan 23-04 — signBtcPsbt (RESEARCH Pattern 3)
// ---------------------------------------------------------------------------

/**
 * Per-input descriptor for the `signBtcPsbt` call. Each entry pairs the
 * input's script type with its BIP-32 derivation metadata, used to build
 * per-group PSBTs for the two-pass split.
 */
export interface BtcPsbtSignInput {
  /** 0-based index of this input in the PSBT's input vector. */
  readonly index: number;
  readonly scriptType: "p2wpkh" | "p2tr";
  /** BIP-32 derivation path, e.g. "m/84'/0'/0'/0/0". */
  readonly bip32Path: string;
  /** 33-byte compressed public key (for segwit) or 32-byte x-only key (for taproot). */
  readonly pubkey: Uint8Array;
  /** 4-byte master fingerprint. */
  readonly masterFingerprint: Uint8Array;
}

/**
 * Known address derivation for `knownAddressDerivations` REQUIRED by
 * `signPsbtBuffer`. Maps a scriptPubKey hash hex to a pubkey + path pair.
 * The change address MUST be included (Pitfall 6 — without it the device
 * renders change as a send).
 */
export interface KnownAddressDerivation {
  readonly scriptPubKeyHashHex: string;
  readonly pubkey: Uint8Array;
  readonly path: string;
}

/**
 * Sign a BTC PSBT via the Ledger BTC app over USB-HID.
 *
 * Implements the two-pass mixed-input split (RESEARCH Pattern 3):
 *   1. Partition inputs by script type (segwit vs taproot).
 *   2. For each non-empty group, build a group-PSBT with BIP-32 derivation
 *      populated ONLY on that group's inputs (so the device skips the others).
 *   3. Call `signPsbtBuffer` once per group with the matching `accountPath`
 *      + `addressFormat`.
 *   4. `Psbt.combine()` the partial results → `finalizeAllInputs()` →
 *      `extractTransaction().toHex()`.
 *
 * For a single-script-type PSBT the split degenerates to one call.
 *
 * `knownAddressDerivations` MUST include the change address (load-bearing for
 * D-02: the BTC app marks the change output "change" only if it appears in
 * this map).
 *
 * Throws `LedgerDeviceNotConnectedError` if no device found.
 * Throws `LedgerBtcAppNotOpenError` if the BTC app is not active.
 * Other errors (user rejection, combine failure) propagate to the caller.
 *
 * @param psbtBase64           — the unsigned PSBT-v0 in base64.
 * @param inputs               — per-input descriptors in PSBT input order.
 * @param knownAddressDerivations — change + receive address map (REQUIRED).
 */
export async function signBtcPsbt(
  psbtBase64: string,
  inputs: readonly BtcPsbtSignInput[],
  knownAddressDerivations: readonly KnownAddressDerivation[],
): Promise<{ rawTxHex: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildBtcApp(transport);

    // Guard: BTC app must be open (mirrors fetchBtcAddresses).
    try {
      await app.getAppConfiguration();
    } catch {
      throw new LedgerBtcAppNotOpenError();
    }

    // Partition inputs by script type.
    const segwitInputs = inputs.filter((i) => i.scriptType === "p2wpkh");
    const taprootInputs = inputs.filter((i) => i.scriptType === "p2tr");

    const signedParts: Psbt[] = [];

    // Helper: build a group PSBT from the full base64 PSBT but with BIP-32
    // derivation populated ONLY on the group's inputs. All other inputs have
    // their bip32Derivation / tapBip32Derivation cleared so the device skips
    // them (belongsToSigner === false → not counted in script-type consistency).
    function buildGroupPsbt(
      groupInputs: readonly BtcPsbtSignInput[],
    ): Uint8Array {
      const psbt = Psbt.fromBase64(psbtBase64);
      const inputCount = psbt.data.inputs.length;

      // Build a set of this group's indices for O(1) lookup.
      const groupIndexSet = new Set(groupInputs.map((i) => i.index));

      for (let idx = 0; idx < inputCount; idx++) {
        const pInput = psbt.data.inputs[idx];
        if (!pInput) continue;

        if (groupIndexSet.has(idx)) {
          // Keep derivation for this group's inputs — the device will sign them.
          // No mutation needed; they already have derivation from buildBtcPsbt.
        } else {
          // Clear derivation so the device does NOT try to sign these inputs
          // (belongsToSigner = false → validateScriptTypeConsistency skips them).
          // Use empty arrays (not undefined) — bip174's keyValsFromMap encodes
          // an empty array as zero key-value pairs (safe; undefined causes a
          // "Cannot read property pubkey" error when the serializer iterates).
          pInput.bip32Derivation = [];
          pInput.tapBip32Derivation = [];
        }
      }
      return psbt.toBuffer();
    }

    // Build the knownAddressDerivations Map for signPsbtBuffer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const knownMap = new Map<string, { pubkey: Uint8Array; path: string }>();
    for (const kd of knownAddressDerivations) {
      knownMap.set(kd.scriptPubKeyHashHex, {
        pubkey: kd.pubkey,
        path: kd.path,
      });
    }

    // Pass 1: segwit inputs (m/84'/0'/0', bech32).
    if (segwitInputs.length > 0) {
      const groupBuffer = buildGroupPsbt(segwitInputs);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const { psbt: signedBuffer } = await app.signPsbtBuffer(groupBuffer, {
        finalizePsbt: false,
        accountPath: "m/84'/0'/0'",
        addressFormat: "bech32",
        knownAddressDerivations: knownMap,
      });
      signedParts.push(Psbt.fromBuffer(Buffer.from(signedBuffer)));
    }

    // Pass 2: taproot inputs (m/86'/0'/0', bech32m).
    if (taprootInputs.length > 0) {
      const groupBuffer = buildGroupPsbt(taprootInputs);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const { psbt: signedBuffer } = await app.signPsbtBuffer(groupBuffer, {
        finalizePsbt: false,
        accountPath: "m/86'/0'/0'",
        addressFormat: "bech32m",
        knownAddressDerivations: knownMap,
      });
      signedParts.push(Psbt.fromBuffer(Buffer.from(signedBuffer)));
    }

    if (signedParts.length === 0) {
      throw new Error("signBtcPsbt: no inputs to sign (empty input set)");
    }

    // Combine partial signatures.
    const combined = signedParts[0]!;
    for (let i = 1; i < signedParts.length; i++) {
      combined.combine(signedParts[i]!);
    }

    // Finalize and extract.
    // For each input: if the device already set finalScriptWitness (finalizePsbt:
    // true path or pre-finalized mock in tests), skip re-finalization. Otherwise
    // call finalizeInput() to convert partialSig → witness (finalizePsbt: false path).
    for (let idx = 0; idx < combined.data.inputs.length; idx++) {
      const inp = combined.data.inputs[idx];
      if (!inp?.finalScriptWitness && !inp?.finalScriptSig) {
        combined.finalizeInput(idx);
      }
    }
    const rawTxHex = combined.extractTransaction().toHex();
    return { rawTxHex };
  } finally {
    try {
      await transport.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("warn", `transport.close() failed during signBtcPsbt cleanup: ${message}`);
    }
  }
}

// ─── Phase 24 Plan 24-02 — BIP-137 message signing ───────────────────────────

/**
 * Sign a raw message via the Ledger BTC app using the BIP-137 compact-signature
 * protocol.
 *
 * **IMPORTANT — no double-prefix:** pass the raw UTF-8 message bytes hex-encoded.
 * The Ledger BTC app v2.1+ applies the `"Bitcoin Signed Message:\n"` magic
 * prefix INTERNALLY before hashing and signing. Passing a pre-prefixed message
 * would double-prefix and produce an invalid BIP-137 signature (RESEARCH
 * §BIP-137 Verified Details Pitfall 3).
 *
 * @param path       — BIP-32 derivation path (e.g. `"84'/0'/0'/0/0"`).
 * @param messageHex — raw message bytes, hex-encoded (NOT the magic-prefixed form).
 * @returns `{ v, r, s }` where `v` is the raw recovery_id (0 or 1); the BtcNew
 *          SDK already strips the `27+4` offset (BtcNew.js line 294).
 */
export async function signBtcMessage(
  path: string,
  messageHex: string,
): Promise<{ v: number; r: string; s: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildBtcApp(transport);

    // Guard: BTC app must be open (mirrors fetchBtcAddresses + signBtcPsbt).
    try {
      await app.getAppConfiguration();
    } catch {
      throw new LedgerBtcAppNotOpenError();
    }

    // Call with POSITIONAL args — the Btc wrapper class (returned by buildBtcApp)
    // uses the positional-arg interface `signMessage(path, messageHex)`. It routes
    // to BtcNew.signMessage({ path, messageHex }) internally (currency: "bitcoin"
    // guaranteed by buildBtcApp hardcoding — RESEARCH §State of the Art).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = await app.signMessage(path, messageHex);
    return result as { v: number; r: string; s: string };
  } finally {
    try {
      await transport.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(
        "warn",
        `transport.close() failed during signBtcMessage cleanup: ${message}`,
      );
    }
  }
}

// ─── Phase 25 Plan 25-03 — Ledger multisig wallet-policy functions ───────────

/**
 * Register a multisig wallet policy on the Ledger device (BTC app v2.1+).
 *
 * Calls `AppClient.registerWallet(walletPolicy)` from `@ledgerhq/ledger-bitcoin`.
 * The device displays the wallet name + policy on-screen and requires user approval.
 * Returns the 32-byte HMAC (hex-encoded) that must be stored in the registry and
 * passed on every subsequent `signBtcMultisigPsbt` call.
 *
 * Security gates (T-25-13 mitigation):
 *   - `getAppConfiguration()` version-check: BTC app < 2.1.0 → throws
 *     `LedgerBtcAppVersionTooOldError`.
 *   - `getAppConfiguration()` open-check: non-BTC app → throws
 *     `LedgerBtcAppNotOpenError`.
 *
 * @param walletName        — wallet policy name (max 16 ASCII chars).
 * @param descriptorTemplate — e.g. `"wsh(sortedmulti(2,@0/**,@1/**,@2/**))"`.
 * @param keys              — key expressions from the descriptor.
 * @returns `{ walletHmacHex }` — 32-byte hex HMAC string.
 */
export async function registerBtcMultisigWallet(
  walletName: string,
  descriptorTemplate: string,
  keys: readonly string[],
): Promise<{ walletHmacHex: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildBtcApp(transport);

    // Gate 1: BTC app open check (non-BTC app throws here)
    let appVersion: string;
    try {
      const cfg = await app.getAppConfiguration();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      appVersion = (cfg?.version as string) ?? "0.0.0";
    } catch {
      throw new LedgerBtcAppNotOpenError();
    }

    // Gate 2: version check — BTC app v2.1.0+ required for registerWallet APDU
    const parts = appVersion.split(".").map((p) => parseInt(p, 10));
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    if (major < 2 || (major === 2 && minor < 1)) {
      throw new LedgerBtcAppVersionTooOldError();
    }

    // Build AppClient from @ledgerhq/ledger-bitcoin using the same transport.
    // Defensive assertion: if all three WalletPolicy lookup paths failed at module
    // load time, surface a clear diagnostic here rather than a confusing
    // "WalletPolicy is not a constructor" error.
    if (!WalletPolicy) {
      throw new Error(
        "@ledgerhq/ledger-bitcoin: WalletPolicy export not found — check package version",
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const appClient = new AppClient(transport);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const walletPolicy = new WalletPolicy(walletName, descriptorTemplate, keys);

    // registerWallet returns [walletId, walletHmac: Buffer(32)]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const [, walletHmac] = await appClient.registerWallet(walletPolicy);
    const walletHmacHex = Buffer.from(walletHmac as Uint8Array).toString("hex");

    return { walletHmacHex };
  } finally {
    try {
      await transport.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("warn", `transport.close() failed during registerBtcMultisigWallet cleanup: ${message}`);
    }
  }
}

/**
 * Sign a multisig PSBT using the Ledger BTC app v2.1+'s wallet-policy APDU.
 *
 * Calls `AppClient.signPsbt(psbtBase64, walletPolicy, walletHmac)` from
 * `@ledgerhq/ledger-bitcoin`. Returns the updated PSBT base64 with the device's
 * partial signatures inserted into `psbt.data.inputs[i].partialSig`.
 *
 * The Ledger device displays the multisig policy name + transaction outputs on
 * screen for user approval. The caller must have stored `walletHmac` from a
 * prior `registerBtcMultisigWallet` call.
 *
 * Security gate (T-25-13 mitigation): version-checks BTC app ≥ 2.1 before
 * the APDU exchange, same as `registerBtcMultisigWallet`.
 *
 * DOES NOT broadcast — returns the updated PSBT for further co-signing or
 * finalization. The Ledger does not have authority to finalize unilaterally.
 *
 * @param psbtBase64         — PSBT in base64 (externally supplied, co-signer assembled).
 * @param walletName         — registered wallet name (max 16 ASCII chars).
 * @param descriptorTemplate — e.g. `"wsh(sortedmulti(2,@0/**,@1/**,@2/**))"`.
 * @param keys               — key expressions from the descriptor.
 * @param walletHmacHex      — 32-byte hex HMAC from `registerBtcMultisigWallet`.
 * @returns `{ updatedPsbtBase64 }` with the device's partial signatures inserted.
 */
export async function signBtcMultisigPsbt(
  psbtBase64: string,
  walletName: string,
  descriptorTemplate: string,
  keys: readonly string[],
  walletHmacHex: string,
): Promise<{ updatedPsbtBase64: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildBtcApp(transport);

    // Gate 1: BTC app open check
    let appVersion: string;
    try {
      const cfg = await app.getAppConfiguration();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      appVersion = (cfg?.version as string) ?? "0.0.0";
    } catch {
      throw new LedgerBtcAppNotOpenError();
    }

    // Gate 2: version check
    const parts = appVersion.split(".").map((p) => parseInt(p, 10));
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    if (major < 2 || (major === 2 && minor < 1)) {
      throw new LedgerBtcAppVersionTooOldError();
    }

    // Build AppClient + WalletPolicy from @ledgerhq/ledger-bitcoin
    if (!WalletPolicy) {
      throw new Error(
        "@ledgerhq/ledger-bitcoin: WalletPolicy export not found — check package version",
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const appClient = new AppClient(transport);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const walletPolicy = new WalletPolicy(walletName, descriptorTemplate, keys);
    const walletHmac = Buffer.from(walletHmacHex, "hex");

    // signPsbt returns Map<inputIndex, PartialSignature> or an Array
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const sigs: Map<number, { pubkey: Buffer; signature: Buffer }> | Array<[number, { pubkey: Buffer; signature: Buffer }]> =
      await appClient.signPsbt(psbtBase64, walletPolicy, walletHmac);

    // Insert signatures into PSBT.data.inputs[i].partialSig
    const psbt = Psbt.fromBase64(psbtBase64);
    const sigEntries: [number, { pubkey: Buffer; signature: Buffer }][] =
      sigs instanceof Map ? [...sigs.entries()] : (sigs as [number, { pubkey: Buffer; signature: Buffer }][]);

    for (const [inputIndex, partialSig] of sigEntries) {
      const input = psbt.data.inputs[inputIndex];
      if (!input) continue;
      input.partialSig ??= [];
      input.partialSig.push({
        pubkey: partialSig.pubkey,
        signature: partialSig.signature,
      });
    }

    return { updatedPsbtBase64: psbt.toBase64() };
  } finally {
    try {
      await transport.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("warn", `transport.close() failed during signBtcMultisigPsbt cleanup: ${message}`);
    }
  }
}

/**
 * ESM spy-affordance for the BTC address-probe path. Plan 22-04
 * `get_btc_status` (deferred to Phase 27 for the lazy-probe diagnostic;
 * Phase 22 status surface relies on the cached records) can spy on
 * `_btcLedgerTransport.fetchBtcAddresses` without monkey-patching the
 * named exports (ESM bindings are immutable). NARROWER than the TRON
 * analog — Phase 22 has no signing surface yet; Phase 23 will widen
 * with `signPsbtBuffer`.
 *
 * Phase 24 Plan 24-02: adds `signBtcMessage` for BIP-137 message signing.
 */
export const _btcLedgerTransport = {
  fetchBtcAddresses: (
    segwitPath?: string,
    taprootPath?: string,
  ): Promise<{
    segwit: { address: string; publicKey: string; chainCode: string; derivationPath: string; xpub: string };
    taproot: { address: string; publicKey: string; chainCode: string; derivationPath: string; xpub: string };
    appVersion: string;
  }> => fetchBtcAddresses(segwitPath, taprootPath),
  signBtcPsbt: (
    psbtBase64: string,
    inputs: readonly BtcPsbtSignInput[],
    knownAddressDerivations: readonly KnownAddressDerivation[],
  ): Promise<{ rawTxHex: string }> =>
    signBtcPsbt(psbtBase64, inputs, knownAddressDerivations),
  // Phase 24 Plan 24-02: BIP-137 message signing via the Ledger BTC app.
  signBtcMessage: (
    path: string,
    messageHex: string,
  ): Promise<{ v: number; r: string; s: string }> =>
    signBtcMessage(path, messageHex),
  // Phase 25 Plan 25-03: multisig wallet-policy registration + signing.
  registerBtcMultisigWallet: (
    walletName: string,
    descriptorTemplate: string,
    keys: readonly string[],
  ): Promise<{ walletHmacHex: string }> =>
    registerBtcMultisigWallet(walletName, descriptorTemplate, keys),
  signBtcMultisigPsbt: (
    psbtBase64: string,
    walletName: string,
    descriptorTemplate: string,
    keys: readonly string[],
    walletHmacHex: string,
  ): Promise<{ updatedPsbtBase64: string }> =>
    signBtcMultisigPsbt(psbtBase64, walletName, descriptorTemplate, keys, walletHmacHex),
};

/**
 * Test-only reset. The transport is per-call (no singleton state to
 * clear); the function exists for parity with
 * `_resetLedgerTronTransportForTesting` so test suites can call it
 * uniformly in `beforeEach`.
 */
export function _resetLedgerBtcTransportForTesting(): void {
  // No singleton state — intentional no-op.
}
