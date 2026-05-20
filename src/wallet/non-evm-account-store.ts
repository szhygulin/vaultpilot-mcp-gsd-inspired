// Persistent non-EVM account store.
//
// Owns the "which non-EVM accounts (Solana / TRON / BTC / LTC) has this user
// paired?" question for the MCP tool layer. JSON-backed cache at
// `~/.vaultpilot-mcp/non-evm-accounts.json` (file, 0o600) inside a 0o700
// parent. Atomic write via tempfile (`<path>.tmp.<pid>`) + `fs.renameSync`
// to keep a same-filesystem rename and prevent partial-write corruption on
// crash.
//
// What lives in the cache:
//
//   { chain: "solana" | "tron" | "bitcoin" | "litecoin",
//     address: string,           // base58 (Solana) / base58check (TRON/BTC/LTC)
//     derivationPath: string,    // e.g. "44'/501'/0'"
//     pairedAt: string,          // ISO-8601 UTC
//     displayName?: string }     // optional user label
//
//   Uniqueness key: (chain, address) tuple. Multiple addresses per chain
//   supported.
//
// What does NOT live in the cache: NO private key material, NO signed data,
// NO secrets. Worst-case loss is a re-pair round-trip.
//
// Eager-init at server boot (`eagerInitNonEvmStoreIfPersist`) loads the
// cache BEFORE `server.connect(transport)` so the first `get_solana_status`
// after a cold boot returns paired-from-cache rather than re-pair-required.
// Same pattern as PR #61 for the WC SignClient singleton.
//
// ESM spy-affordance (`_storage` indirection) per CLAUDE.md convention —
// internal cross-export calls go through `_storage.X` so tests can spy
// across the ESM module boundary (named-export bindings are immutable).

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { log } from "../diagnostics/logger.js";
import {
  ensureStorageDirWithPerms,
  getNonEvmStorageDir,
  getNonEvmStorageMode,
  getNonEvmStoragePath,
} from "../config/non-evm-storage.js";

export type NonEvmChain = "solana" | "tron" | "bitcoin" | "litecoin";

const VALID_CHAINS: ReadonlySet<NonEvmChain> = new Set<NonEvmChain>([
  "solana",
  "tron",
  "bitcoin",
  "litecoin",
]);

export interface NonEvmAccountRecord {
  chain: NonEvmChain;
  address: string;
  derivationPath: string;
  pairedAt: string;
  displayName?: string;
}

/**
 * Read-path view of a record — adds the `staleAccountWarning` flag for
 * records with `pairedAt` older than 30 days. The flag is informational; we
 * never auto-expire a record (a stale Ledger pairing is still
 * cryptographically valid — the warning surfaces the operational hygiene
 * concern so the agent can prompt the user to re-pair if they want a fresh
 * `pairedAt`).
 */
export type NonEvmAccountView = NonEvmAccountRecord & {
  staleAccountWarning?: true;
};

const STALE_THRESHOLD_MS = 30 * 24 * 3600 * 1000;

/**
 * Spy-affordance indirection for the fs helpers + dir-perms enforcement.
 * Production code calls `_storage.readFileSync(...)` etc. instead of the
 * raw imports so `vi.spyOn(_storage, "readFileSync")` works across the ESM
 * module boundary. Same pattern as `_wcStorage` in
 * `walletconnect-client.ts` and `_storage` in `session-manager.ts`.
 */
export const _storage = {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  ensureStorageDirWithPerms,
};

// Module-scoped state. Cleared by `_resetNonEvmStoreForTesting`.
let inMemoryStore: NonEvmAccountRecord[] = [];
let loaded = false;

/**
 * Parse + validate a single record loaded from disk. Returns the record if
 * valid; logs a stderr warning + returns null if invalid. Invalid records
 * are dropped — we never throw on a corrupt entry (a single bad row should
 * not block the rest of the cache from loading).
 */
function validateRecord(raw: unknown): NonEvmAccountRecord | null {
  if (raw === null || typeof raw !== "object") {
    log("warn", `non-evm-account-store: dropping non-object record: ${JSON.stringify(raw)}`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.chain !== "string" || !VALID_CHAINS.has(r.chain as NonEvmChain)) {
    log("warn", `non-evm-account-store: dropping record with invalid chain: ${JSON.stringify(r.chain)}`);
    return null;
  }
  if (typeof r.address !== "string" || r.address.length === 0) {
    log("warn", `non-evm-account-store: dropping record with invalid address: ${JSON.stringify(r.address)}`);
    return null;
  }
  if (typeof r.derivationPath !== "string" || r.derivationPath.length === 0) {
    log("warn", `non-evm-account-store: dropping record with invalid derivationPath`);
    return null;
  }
  if (typeof r.pairedAt !== "string") {
    log("warn", `non-evm-account-store: dropping record with non-string pairedAt`);
    return null;
  }
  // ISO-8601 sanity — Date.parse on a malformed string returns NaN.
  if (Number.isNaN(Date.parse(r.pairedAt))) {
    log("warn", `non-evm-account-store: dropping record with unparseable pairedAt: ${r.pairedAt}`);
    return null;
  }
  const out: NonEvmAccountRecord = {
    chain: r.chain as NonEvmChain,
    address: r.address,
    derivationPath: r.derivationPath,
    pairedAt: r.pairedAt,
  };
  if (typeof r.displayName === "string") {
    out.displayName = r.displayName;
  }
  return out;
}

function writeAtomic(records: NonEvmAccountRecord[]): void {
  const path = getNonEvmStoragePath();
  const tmp = `${path}.tmp.${process.pid}`;
  const json = JSON.stringify(records, null, 2);
  // 0o600: owner read/write only. Same discipline as
  // `~/.vaultpilot-mcp/config.json` (config-file.ts) — the cache holds no
  // key material but the derivation-path field leaks the BIP44 account
  // index, which is a weak shoulder-surfing signal we keep tight.
  _storage.writeFileSync(tmp, json, { mode: 0o600 });
  _storage.renameSync(tmp, path);
}

/**
 * Return the in-memory store. Lazily loads from disk on first call when the
 * store has not yet been eager-initialized. Subsequent calls return the
 * cached array.
 *
 * Production code path is: `eagerInitNonEvmStoreIfPersist()` at boot →
 * `loaded = true` → every subsequent `loadAccounts()` is a no-op short-circuit.
 * The lazy-load arm here is defense-in-depth for tools that fire before
 * eager-init resolves (shouldn't happen given the `startServer` ordering,
 * but the contract holds either way).
 */
export function loadAccounts(): NonEvmAccountRecord[] {
  if (loaded) return inMemoryStore;
  // Lazy-load via the same gates as eagerInit, but synchronous since this is
  // the read path. We accept the duplicated gate logic for one reason: the
  // eager-init function is async (mirrors `eagerInitWalletConnectIfPersist`
  // for consistency with the server boot sequence); load-on-read must be
  // sync because tool handlers iterate the store inline.
  loadFromDisk();
  return inMemoryStore;
}

function loadFromDisk(): void {
  if (loaded) return;
  loaded = true;

  const mode = getNonEvmStorageMode();
  if (mode === "memory") {
    // Memory mode → no disk touch; in-memory store stays empty on cold boot.
    return;
  }

  const path = getNonEvmStoragePath();
  if (!_storage.existsSync(path)) {
    // Fresh install — file does not exist yet. The first saveAccount will
    // create the parent dir + write the file.
    return;
  }

  let contents: string;
  try {
    contents = _storage.readFileSync(path, "utf-8") as string;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    log(
      "warn",
      `non-evm-account-store: failed to read ${path}: ${cause}. Continuing with empty store; re-pair to rebuild.`,
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
      `non-evm-account-store: malformed JSON in ${path}: ${cause}. Continuing with empty store; file NOT deleted (forensic recovery option).`,
    );
    return;
  }

  if (!Array.isArray(parsed)) {
    log(
      "warn",
      `non-evm-account-store: expected JSON array in ${path}; got ${typeof parsed}. Continuing with empty store.`,
    );
    return;
  }

  const validated: NonEvmAccountRecord[] = [];
  for (const entry of parsed) {
    const v = validateRecord(entry);
    if (v) validated.push(v);
  }
  inMemoryStore = validated;
}

/**
 * Upsert a record. Key is the `(chain, address)` tuple — same chain+address
 * replaces (e.g. re-pair refreshes `pairedAt`); same chain different address
 * appends (multiple addresses per chain supported per PAIR-NEV-03).
 *
 * Persists synchronously via atomic write. When storage mode is `"memory"`,
 * the in-memory store is updated but no disk write happens.
 *
 * Triggers a lazy-load if not yet loaded — so a `saveAccount` call before
 * `eagerInitNonEvmStoreIfPersist` resolves cannot truncate the cache by
 * over-writing an unloaded store.
 */
export function saveAccount(record: NonEvmAccountRecord): void {
  loadFromDisk();
  const filtered = inMemoryStore.filter(
    (r) => !(r.chain === record.chain && r.address === record.address),
  );
  filtered.push(record);
  inMemoryStore = filtered;

  if (getNonEvmStorageMode() === "memory") return;
  _storage.ensureStorageDirWithPerms(getNonEvmStorageDir());
  writeAtomic(inMemoryStore);
}

/**
 * Remove the record matching `(chain, address)`. Idempotent — returns
 * `{ removed: false }` when no matching record exists, never throws.
 * Mirrors the shape of `session-manager.disconnect`'s
 * idempotent-clear contract.
 */
export function removeAccount(
  chain: NonEvmChain,
  address: string,
): { removed: boolean } {
  loadFromDisk();
  const before = inMemoryStore.length;
  const filtered = inMemoryStore.filter(
    (r) => !(r.chain === chain && r.address === address),
  );
  if (filtered.length === before) {
    return { removed: false };
  }
  inMemoryStore = filtered;
  if (getNonEvmStorageMode() === "memory") return { removed: true };
  _storage.ensureStorageDirWithPerms(getNonEvmStorageDir());
  writeAtomic(inMemoryStore);
  return { removed: true };
}

/**
 * List records, optionally filtered by chain. Returns a copy with
 * `staleAccountWarning: true` set on records whose `pairedAt` is more than
 * 30 days old (PAIR-NEV-04). Records are never auto-expired — the flag is
 * advisory.
 */
export function listAccounts(
  filter: { chainFilter?: NonEvmChain } = {},
): NonEvmAccountView[] {
  loadFromDisk();
  const now = Date.now();
  const filtered = filter.chainFilter
    ? inMemoryStore.filter((r) => r.chain === filter.chainFilter)
    : inMemoryStore;
  return filtered.map((r) => {
    const ageMs = now - Date.parse(r.pairedAt);
    if (ageMs > STALE_THRESHOLD_MS) {
      return { ...r, staleAccountWarning: true as const };
    }
    return { ...r };
  });
}

/**
 * Eagerly load the cache at server boot, BEFORE `server.connect(transport)`.
 * Mirrors `eagerInitWalletConnectIfPersist` shape from
 * `walletconnect-client.ts` — silent skip when mode is `"memory"` or the
 * file does not exist; stderr `warn` on disk error; MUST NOT throw (the
 * server must still serve read-only tools when the cache is unreachable —
 * worst case is the user re-pairs once).
 *
 * Safe to call multiple times; subsequent calls short-circuit via the
 * `loaded` flag.
 */
export async function eagerInitNonEvmStoreIfPersist(): Promise<void> {
  if (loaded) return;
  if (getNonEvmStorageMode() !== "persist") return;
  try {
    loadFromDisk();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(
      "warn",
      `eager non-EVM account-store init failed (will retry on first read): ${message}`,
    );
  }
}

/**
 * Test-only reset. Clears the in-memory store and the `loaded` flag so the
 * next read re-loads from disk. Mirrors `_resetSessionManagerForTesting` in
 * `session-manager.ts`.
 */
export function _resetNonEvmStoreForTesting(): void {
  inMemoryStore = [];
  loaded = false;
}
