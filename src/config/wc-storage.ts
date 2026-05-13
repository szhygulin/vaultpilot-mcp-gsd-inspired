// WalletConnect storage-mode resolution + on-disk directory management.
//
// Resolves `VAULTPILOT_WC_STORAGE` to `"memory"` (the pre-v1.0.1 default —
// `:memory:` sentinel for the WC keyvaluestorage SDK) or `"persist"`
// (write the WC v2 session under `~/.vaultpilot-mcp/wc-storage/` with
// `0o700` perms so the user does not re-pair Ledger Live every cold-boot).
// Production default is `"persist"`; the test setup pins `"memory"` so the
// suite stays hermetic.
//
// Directory-vs-file note (load-bearing — read before maintenance):
//   The WC `@walletconnect/keyvaluestorage` SDK reads
//   `storageOptions = { database?: string; table?: string }`. Its constructor
//   resolves `dbName = database || table || "walletconnect.db"`, treats
//   the literal `":memory:"` as the in-memory sentinel, and passes ANY
//   OTHER string to `unstorage/drivers/fs-lite` as `{ base: dbName }`.
//   `fs-lite` treats `base` as a DIRECTORY: each key becomes a file inside
//   that directory. So `wc-storage` (no `.db` extension) is the correct
//   mental model — a directory under `~/.vaultpilot-mcp/` containing the
//   WC keys-as-files. Don't append `.db`; don't expect a single file.
//   [Source: node_modules/@walletconnect/keyvaluestorage/dist/index.cjs.js;
//   load-bearing — re-verify after any WC SDK bump.]
//
// Q-STRICT lock (mirror of `src/config/env.ts::resolveDemoMode`):
//   `VAULTPILOT_WC_STORAGE` accepts ONLY the literal strings `"memory"` and
//   `"persist"`. Any other value (`"Memory"`, `"persistent"`, `"1"`, etc.)
//   triggers `log("error", ...) + process.exit(1)`. Fail-safe defaults:
//   uncertainty defaults to denial.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { log } from "../diagnostics/logger.js";

export type WalletConnectStorageMode = "memory" | "persist";

function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Resolve the WC storage mode from `VAULTPILOT_WC_STORAGE`.
 *
 * - Unset (or empty after trim) → `"persist"` (production default).
 * - `"memory"` → `"memory"` (opt-out for shared hosts / CI / ephemeral envs).
 * - `"persist"` → `"persist"` (explicit opt-in; same as default).
 * - Anything else → `log("error", ...) + process.exit(1)` per Q-STRICT.
 *
 * NOT cached — called once at `getWalletConnectClient()` init AND once per
 * `get_vaultpilot_config_status` invocation; both are cheap.
 */
export function getWalletConnectStorageMode(): WalletConnectStorageMode {
  const raw = read("VAULTPILOT_WC_STORAGE");
  if (raw === undefined) return "persist";
  if (raw === "memory") return "memory";
  if (raw === "persist") return "persist";
  log(
    "error",
    `VAULTPILOT_WC_STORAGE must be literal "memory" or "persist"; got "${raw}". Refusing to boot.`,
  );
  process.exit(1);
}

/**
 * Absolute path to the WC persistent-storage directory. Sibling of
 * `~/.vaultpilot-mcp/config.json` (the canonical VaultPilot user-state home).
 *
 * Returns a DIRECTORY path, not a single file — see the top-of-file
 * directory-vs-file note.
 */
export function getWalletConnectStoragePath(): string {
  return join(homedir(), ".vaultpilot-mcp", "wc-storage");
}

/**
 * Ensure the WC storage directory exists with the expected `0o700` perms.
 *
 * - If the path does NOT exist: create recursively with `mode: 0o700`.
 * - If the path EXISTS as a directory: stat it. If perms drift from `0o700`,
 *   `log("warn", ...)` — do NOT auto-chmod. Acceptance #6 (warn-only on
 *   drift for subsequent opens) is explicit; the operator may have a
 *   legitimate reason for tightened or different perms.
 * - If the path exists but is NOT a directory (ENOTDIR-shaped state — a
 *   regular file at the expected directory path): `log("error", ...) +
 *   process.exit(1)`. The filesystem is in a state the SDK cannot recover
 *   from; loud failure is correct.
 *
 * Sync — called from the (async) init path inside `getWalletConnectClient`
 * once at first SignClient.init. Bootstrap-time only.
 */
export function ensureStorageDirWithPerms(path: string): void {
  if (!existsSync(path)) {
    try {
      mkdirSync(path, { recursive: true, mode: 0o700 });
      return;
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      log(
        "error",
        `failed to create WC storage directory at ${path}: ${cause}. Refusing to boot.`,
      );
      process.exit(1);
    }
  }

  // Path exists — confirm it's a directory and check perms.
  let st;
  try {
    st = statSync(path);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    log(
      "error",
      `WC storage path ${path} exists but cannot be stat'd: ${cause}. Refusing to boot.`,
    );
    process.exit(1);
  }
  if (!st.isDirectory()) {
    log(
      "error",
      `WC storage path ${path} exists but is not a directory. Remove or rename it, or set VAULTPILOT_WC_STORAGE=memory. Refusing to boot.`,
    );
    process.exit(1);
  }

  const perms = st.mode & 0o777;
  if (perms !== 0o700) {
    const octal = perms.toString(8).padStart(3, "0");
    log(
      "warn",
      `WC storage dir ${path} has perms 0o${octal}; expected 0o700. Tighten with: chmod 700 ${path}`,
    );
  }
}

/**
 * Recursively delete the WC persistent-storage directory.
 *
 * Used by `pair({ force: true })` / `pairStart({ force: true })` to ensure
 * a force re-pair does NOT leave a prior session resurrectable on the next
 * cold boot. `rm` is called with `force: true` so ENOENT (directory does
 * not exist — e.g. mode is `memory`, or this is a first-ever boot) is a
 * silent no-op.
 *
 * Force-re-pair must remain robust even when the on-disk side is in a
 * weird state. On EACCES or any other I/O error, log a warning and return
 * — do NOT throw. The Ledger trust anchor is not on disk; failure here
 * cannot affect the live pair flow.
 */
export async function clearPersistedStorage(): Promise<void> {
  const path = getWalletConnectStoragePath();
  try {
    await rm(path, { recursive: true, force: true });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    log(
      "warn",
      `failed to clear WC storage directory at ${path}: ${cause}. Continuing — force re-pair will not resurrect prior session via in-memory state but on-disk artifacts may persist.`,
    );
  }
}
