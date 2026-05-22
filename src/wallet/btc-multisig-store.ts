// Persistent BTC multisig wallet registry.
//
// Owns the "which multisig wallets has this user registered?" question for
// the MCP tool layer. JSON-backed registry at
// `~/.vaultpilot-mcp/btc-multisig.json` (file, 0o600) inside a 0o700
// parent. Atomic write via tempfile (`<path>.tmp.<pid>`) + `fs.renameSync`
// to keep a same-filesystem rename and prevent partial-write corruption on
// crash.
//
// What lives in the registry:
//
//   BtcMultisigWalletRecord { name, descriptor, threshold, totalSigners,
//     keyFingerprints[], firstAddresses[], registeredAt, walletHmac? }
//
//   Primary key: `name` (user-assigned wallet label, max 16 ASCII chars per
//   Ledger APDU limit).
//
// What does NOT live in the registry: NO private key material, NO signed
// data. `walletHmac` (from Ledger `registerWallet`) is stored here because
// it is required for subsequent `signPsbt` calls — it is NOT a secret (the
// HMAC is device-derived; knowing it without the device is useless).
//
// Descriptor parsing + BIP-67 address derivation also live here:
//   - `parseWshSortedMulti(descriptor)` → `{ m, keys[] } | null`
//   - `extractXpubFromKeyExpr(keyExpr)` → `{ masterFingerprint, xpub }`
//   - `deriveMultisigAddress(xpubs, m, index)` → bech32 P2WSH address
//
// ESM spy-affordance (`_btcMultisigStorage` indirection) per CLAUDE.md
// convention — internal cross-export calls go through `_btcMultisigStorage.X`
// so tests can spy across the ESM module boundary (named-export bindings
// are immutable).
//
// Pitfall 6 (RESEARCH.md): Only the `/**` key expression suffix is accepted.
// Descriptors with `/*` or `/0/*` are rejected by `parseWshSortedMulti`.
// Pitfall 7: Address derivation ALWAYS uses `payments.p2wsh({ redeem: p2ms })` —
// never hand-rolling the SHA256 witnessScript hash.
// Anti-pattern (RESEARCH): BIP-67 sort is on DERIVED CHILD pubkeys, NOT on
// the descriptor xpubs.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { BIP32Factory } from "bip32";
import { networks, payments } from "bitcoinjs-lib";
import * as tinySecp256k1 from "tiny-secp256k1";

import { log } from "../diagnostics/logger.js";
import {
  ensureStorageDirWithPerms,
  getBtcMultisigStorageDir,
  getBtcMultisigStorageMode,
  getBtcMultisigStoragePath,
} from "../config/btc-multisig-storage.js";

// Initialize BIP32 factory with the project-standard secp256k1 implementation
const bip32 = BIP32Factory(tinySecp256k1);

// ─── Registry record interface ────────────────────────────────────────────────

/**
 * One registered multisig wallet in the registry. Persisted as JSON to
 * `~/.vaultpilot-mcp/btc-multisig.json`.
 */
export interface BtcMultisigWalletRecord {
  /** User-assigned wallet name (max 16 ASCII chars per Ledger APDU limit). */
  name: string;
  /** Full `wsh(sortedmulti(M, ...))` descriptor string as provided. */
  descriptor: string;
  /** M — the signing threshold (pre-validated for fast reads). */
  threshold: number;
  /** N — total number of keys. */
  totalSigners: number;
  /** 8-hex-char master fingerprints extracted from key expressions (null entry for bare xpubs). */
  keyFingerprints: (string | null)[];
  /** First 5 derived P2WSH receive addresses (change=0, index 0..4) for user verification. */
  firstAddresses: string[];
  /** ISO-8601 UTC timestamp of when this wallet was registered. */
  registeredAt: string;
  /**
   * 32-byte hex from Ledger `registerWallet`. Absent when the Ledger device
   * was not connected at registration time — `sign_btc_multisig_psbt` will
   * refuse with MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE if absent (Plan 25-03).
   */
  walletHmac?: string;
}

// ─── ESM spy-affordance ───────────────────────────────────────────────────────

/**
 * Spy-affordance indirection for the fs helpers + dir-perms enforcement.
 * Production code calls `_btcMultisigStorage.writeFileSync(...)` etc. instead
 * of the raw imports so `vi.spyOn(_btcMultisigStorage, "writeFileSync")` works
 * across the ESM module boundary. Same pattern as `_storage` in
 * `non-evm-account-store.ts`.
 */
export const _btcMultisigStorage = {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  ensureStorageDirWithPerms,
};

// ─── Module-scoped state ──────────────────────────────────────────────────────

let inMemoryStore: BtcMultisigWalletRecord[] = [];
let loaded = false;

// ─── Record validation ────────────────────────────────────────────────────────

/**
 * Parse + validate a single record loaded from disk. Returns the record if
 * valid; logs a stderr warning + returns null if invalid. Invalid records
 * are dropped — we never throw on a corrupt entry.
 */
function validateRecord(raw: unknown): BtcMultisigWalletRecord | null {
  if (raw === null || typeof raw !== "object") {
    log("warn", `btc-multisig-store: dropping non-object record: ${JSON.stringify(raw)}`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.length === 0) {
    log("warn", `btc-multisig-store: dropping record with invalid name: ${JSON.stringify(r.name)}`);
    return null;
  }
  if (typeof r.descriptor !== "string" || r.descriptor.length === 0) {
    log("warn", `btc-multisig-store: dropping record with invalid descriptor`);
    return null;
  }
  if (typeof r.threshold !== "number" || r.threshold < 1) {
    log("warn", `btc-multisig-store: dropping record with invalid threshold: ${JSON.stringify(r.threshold)}`);
    return null;
  }
  if (typeof r.totalSigners !== "number" || r.totalSigners < 1) {
    log("warn", `btc-multisig-store: dropping record with invalid totalSigners: ${JSON.stringify(r.totalSigners)}`);
    return null;
  }
  if (!Array.isArray(r.keyFingerprints)) {
    log("warn", `btc-multisig-store: dropping record with non-array keyFingerprints`);
    return null;
  }
  if (!Array.isArray(r.firstAddresses)) {
    log("warn", `btc-multisig-store: dropping record with non-array firstAddresses`);
    return null;
  }
  if (typeof r.registeredAt !== "string") {
    log("warn", `btc-multisig-store: dropping record with non-string registeredAt`);
    return null;
  }
  if (Number.isNaN(Date.parse(r.registeredAt))) {
    log("warn", `btc-multisig-store: dropping record with unparseable registeredAt: ${r.registeredAt}`);
    return null;
  }
  const out: BtcMultisigWalletRecord = {
    name: r.name,
    descriptor: r.descriptor,
    threshold: r.threshold,
    totalSigners: r.totalSigners,
    keyFingerprints: r.keyFingerprints as (string | null)[],
    firstAddresses: r.firstAddresses as string[],
    registeredAt: r.registeredAt,
  };
  if (typeof r.walletHmac === "string" && r.walletHmac.length > 0) {
    out.walletHmac = r.walletHmac;
  }
  return out;
}

// ─── Atomic write ─────────────────────────────────────────────────────────────

function writeAtomic(records: BtcMultisigWalletRecord[]): void {
  const path = getBtcMultisigStoragePath();
  const tmp = `${path}.tmp.${process.pid}`;
  const json = JSON.stringify(records, null, 2);
  // 0o600: owner read/write only. The registry holds no key material but
  // the descriptor and keyFingerprints expose multisig wallet structure —
  // keep tight per T-25-03 (Information Disclosure mitigate).
  _btcMultisigStorage.writeFileSync(tmp, json, { mode: 0o600 });
  _btcMultisigStorage.renameSync(tmp, path);
}

// ─── Load from disk ───────────────────────────────────────────────────────────

function loadFromDisk(): void {
  if (loaded) return;
  loaded = true;

  const mode = getBtcMultisigStorageMode();
  if (mode === "memory") {
    // Memory mode → no disk touch; in-memory store stays empty on cold boot.
    return;
  }

  const path = getBtcMultisigStoragePath();
  if (!_btcMultisigStorage.existsSync(path)) {
    // Fresh install — file does not exist yet. The first saveMultisigWallet
    // will create the parent dir + write the file.
    return;
  }

  let contents: string;
  try {
    contents = _btcMultisigStorage.readFileSync(path, "utf-8") as string;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    log(
      "warn",
      `btc-multisig-store: failed to read ${path}: ${cause}. Continuing with empty store; re-register wallets to rebuild.`,
    );
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    log(
      "warn",
      `btc-multisig-store: malformed JSON in ${path}: ${cause}. Continuing with empty store; file NOT deleted (forensic recovery option).`,
    );
    return;
  }

  if (!Array.isArray(parsed)) {
    log(
      "warn",
      `btc-multisig-store: expected JSON array in ${path}; got ${typeof parsed}. Continuing with empty store.`,
    );
    return;
  }

  const validated: BtcMultisigWalletRecord[] = [];
  for (const entry of parsed) {
    const v = validateRecord(entry);
    if (v) validated.push(v);
  }
  inMemoryStore = validated;
}

// ─── Public CRUD ──────────────────────────────────────────────────────────────

/**
 * Upsert a multisig wallet record. Key is `name` — same name replaces the
 * existing record (e.g. re-register updates walletHmac). Persists
 * synchronously via atomic write. When storage mode is `"memory"`, the
 * in-memory store is updated but no disk write happens.
 */
export function saveMultisigWallet(record: BtcMultisigWalletRecord): void {
  loadFromDisk();
  const filtered = inMemoryStore.filter((r) => r.name !== record.name);
  filtered.push(record);
  inMemoryStore = filtered;

  if (getBtcMultisigStorageMode() === "memory") return;
  _btcMultisigStorage.ensureStorageDirWithPerms(getBtcMultisigStorageDir());
  writeAtomic(inMemoryStore);
}

/**
 * Look up a registered multisig wallet by name. Returns `undefined` if not
 * found. Triggers a lazy-load if not yet initialized.
 */
export function loadMultisigWallet(name: string): BtcMultisigWalletRecord | undefined {
  loadFromDisk();
  return inMemoryStore.find((r) => r.name === name);
}

/**
 * Return all registered multisig wallets. Returns a copy. Triggers a
 * lazy-load if not yet initialized.
 */
export function loadAllMultisigWallets(): BtcMultisigWalletRecord[] {
  loadFromDisk();
  return [...inMemoryStore];
}

/**
 * Test-only reset. Clears the in-memory store and the `loaded` flag so the
 * next read re-loads from disk. Mirrors `_resetNonEvmStoreForTesting` in
 * `non-evm-account-store.ts`.
 */
export function _resetBtcMultisigStoreForTesting(): void {
  inMemoryStore = [];
  loaded = false;
}

// ─── Descriptor parsing ───────────────────────────────────────────────────────

/**
 * Parse a `wsh(sortedmulti(M, k1, k2, ..., kN))` descriptor string.
 *
 * Returns `{ m, keys }` where `keys` is the array of raw key expressions
 * (e.g. `"[deadbeef/84'/0'/0']xpub.../**"`), or null on any validation
 * failure.
 *
 * Validation rules (per RESEARCH.md Pitfall 6):
 *   - Descriptor MUST be exactly `wsh(sortedmulti(...))` form.
 *   - ALL key expressions MUST end with `/**` (account-level, change+index).
 *   - `/*` and `/0/*` forms are REFUSED.
 *   - 1 ≤ M ≤ N (threshold must be positive and not exceed signer count).
 */
export function parseWshSortedMulti(
  descriptor: string,
): { m: number; keys: string[] } | null {
  if (!descriptor) return null;

  // Match the outer wsh(sortedmulti(...)) shell
  const match = descriptor.match(/^wsh\(sortedmulti\((\d+),([\s\S]+)\)\)$/);
  if (!match) return null;

  const m = parseInt(match[1]!, 10);
  const keyExpStr = match[2]!;

  // Split on commas. Key expressions like [fp/path]xpub/**
  // do NOT contain commas in the key material itself, so simple
  // split is safe here.
  const keys = keyExpStr.split(",").map((k) => k.trim()).filter((k) => k.length > 0);

  // Validate M bounds
  if (m < 1 || m > keys.length) return null;

  // Pitfall 6: ALL key expressions must end with /** (double-wildcard).
  // Refuse /* (single-wildcard) and /0/* (change-hardcoded single-wildcard).
  // The //** pattern specifically catches the double slash variants too.
  for (const key of keys) {
    // Must end with /** — the exact 3 characters: slash, star, star
    if (!key.endsWith("/**")) {
      return null;
    }
  }

  return { m, keys };
}

/**
 * Extract the master fingerprint and xpub from a single key expression.
 *
 * Handles two forms:
 *   - `[deadbeef/84'/0'/0']xpub.../**` → `{ masterFingerprint: "deadbeef", xpub: "xpub..." }`
 *   - `xpub.../**` → `{ masterFingerprint: null, xpub: "xpub..." }`
 *
 * Throws on unrecognized key expression format.
 */
export function extractXpubFromKeyExpr(
  keyExpr: string,
): { masterFingerprint: string | null; xpub: string } {
  // Bracketed form: [8hexchars/path]xpub/**
  const withFp = keyExpr.match(/^\[([0-9a-fA-F]{8})(?:[/\d'hH]+)?\]([A-Za-z0-9]+)\/\*\*$/);
  if (withFp) {
    return {
      masterFingerprint: withFp[1]!.toLowerCase(),
      xpub: withFp[2]!,
    };
  }

  // Bare form: xpub/**
  const bare = keyExpr.match(/^([A-Za-z0-9]+)\/\*\*$/);
  if (bare) {
    return { masterFingerprint: null, xpub: bare[1]! };
  }

  throw new Error(`btc-multisig-store: unrecognized key expression: ${keyExpr}`);
}

// ─── BIP-67 P2WSH address derivation ─────────────────────────────────────────

/**
 * Derive the P2WSH address for a `sortedmulti` descriptor at a given
 * derivation index.
 *
 * BIP-67: keys MUST be sorted lexicographically by compressed 33-byte child
 * pubkey AFTER deriving change=0/index — NOT by the descriptor xpub order.
 * Uses `payments.p2ms({ m, pubkeys: sorted }) + payments.p2wsh` to compute
 * the SHA256(witnessScript) correctly (Pitfall 7 — never hand-roll the hash).
 *
 * @param xpubs Account-level xpubs parsed from the descriptor
 * @param m     The M threshold (used in p2ms construction)
 * @param index The receive index (change=0 is hardcoded per BIP-380 /** convention)
 */
export function deriveMultisigAddress(
  xpubs: string[],
  m: number,
  index: number,
): string {
  // Derive child pubkeys at change=0, receive index for each xpub
  const pubkeys = xpubs.map((xpub) => {
    const node = bip32.fromBase58(xpub, networks.bitcoin);
    const child = node.derive(0).derive(index); // change=0 (receive), then index
    return Buffer.from(child.publicKey);
  });

  // BIP-67: sort pubkeys lexicographically by compressed 33-byte value.
  // Sorting happens on DERIVED CHILD pubkeys, not on the xpubs themselves.
  const sorted = [...pubkeys].sort(Buffer.compare);

  // Build witnessScript: OP_M <pk1> ... <pkN> OP_N OP_CHECKMULTISIG
  // bitcoinjs-lib handles OP encoding; we pass sorted pubkeys + m threshold.
  const p2msPayment = payments.p2ms({
    m,
    pubkeys: sorted,
    network: networks.bitcoin,
  });

  // Wrap in P2WSH: SHA256(witnessScript) → 32-byte witness program.
  // payments.p2wsh handles SHA256 internally (Pitfall 7 — never hand-roll).
  const p2wshPayment = payments.p2wsh({
    redeem: p2msPayment,
    network: networks.bitcoin,
  });

  if (!p2wshPayment.address) {
    throw new Error(
      `btc-multisig-store: failed to derive P2WSH address at index ${index}`,
    );
  }

  return p2wshPayment.address;
}
