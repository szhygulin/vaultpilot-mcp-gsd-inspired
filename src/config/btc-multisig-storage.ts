// BTC multisig wallet registry storage-mode resolution + on-disk file management.
//
// Resolves `VAULTPILOT_BTC_MULTISIG_STORAGE` to `"memory"` (in-process cache
// only) or `"persist"` (write the JSON registry to
// `~/.vaultpilot-mcp/btc-multisig.json` with `0o600` perms inside a `0o700`
// parent directory). Production default is `"persist"`; the test setup pins
// `"memory"` so the suite stays hermetic.
//
// File-vs-directory note (load-bearing — read before maintenance):
//   The multisig registry is a SINGLE JSON FILE (`btc-multisig.json`), NOT a
//   directory of keys-as-files. The dataset is small (a few wallets) and
//   atomic-write via tempfile + `fs.renameSync` is enough.
//   This deliberately follows the same convention as `non-evm-accounts.json`.
//
//   Parent dir `~/.vaultpilot-mcp/` is shared with `config.json`, WC
//   storage, and the non-EVM accounts cache; perms checks target the parent
//   (0o700), not the single file (0o600 enforced by `writeFileSync` on the
//   writer side in `src/wallet/btc-multisig-store.ts`).
//
// Q-STRICT lock (mirror of `src/config/non-evm-storage.ts`):
//   `VAULTPILOT_BTC_MULTISIG_STORAGE` accepts ONLY the literal strings
//   `"memory"` and `"persist"`. Any other value triggers
//   `log("error", ...) + process.exit(1)`. Fail-safe defaults:
//   uncertainty defaults to denial.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { log } from "../diagnostics/logger.js";

export type BtcMultisigStorageMode = "memory" | "persist";

function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Resolve the BTC multisig storage mode from `VAULTPILOT_BTC_MULTISIG_STORAGE`.
 *
 * - Unset (or empty after trim) → `"persist"` (production default).
 * - `"memory"` → `"memory"` (opt-out for CI / ephemeral envs).
 * - `"persist"` → `"persist"` (explicit opt-in; same as default).
 * - Anything else → `log("error", ...) + process.exit(1)` per Q-STRICT.
 */
export function getBtcMultisigStorageMode(): BtcMultisigStorageMode {
  const raw = read("VAULTPILOT_BTC_MULTISIG_STORAGE");
  if (raw === undefined) return "persist";
  if (raw === "memory") return "memory";
  if (raw === "persist") return "persist";
  log(
    "error",
    `VAULTPILOT_BTC_MULTISIG_STORAGE must be literal "memory" or "persist"; got "${raw}". Refusing to boot.`,
  );
  process.exit(1);
}

/**
 * Absolute path to the parent directory housing the multisig registry + WC
 * persistent-storage subdirectory + `config.json`. The canonical VaultPilot
 * user-state home.
 */
export function getBtcMultisigStorageDir(): string {
  return join(homedir(), ".vaultpilot-mcp");
}

/**
 * Absolute path to the single JSON registry file. Sibling of `config.json`
 * and the `wc-storage/` directory under `~/.vaultpilot-mcp/`.
 *
 * Returns a FILE path, not a directory.
 */
export function getBtcMultisigStoragePath(): string {
  return join(getBtcMultisigStorageDir(), "btc-multisig.json");
}

/**
 * Ensure the parent storage directory exists with the expected `0o700` perms.
 *
 * - If the path does NOT exist: create recursively with `mode: 0o700`.
 * - If the path EXISTS as a directory: stat it. If perms drift from `0o700`,
 *   `log("warn", ...)` — do NOT auto-chmod (same warn-only discipline as the
 *   non-EVM storage analog).
 * - If the path exists but is NOT a directory:
 *   `log("error", ...) + process.exit(1)`.
 *
 * Sync — called from the write path before atomic writes.
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
        `failed to create BTC multisig storage directory at ${path}: ${cause}. Refusing to boot.`,
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
      `BTC multisig storage path ${path} exists but cannot be stat'd: ${cause}. Refusing to boot.`,
    );
    process.exit(1);
  }
  if (!st.isDirectory()) {
    log(
      "error",
      `BTC multisig storage path ${path} exists but is not a directory. Remove or rename it, or set VAULTPILOT_BTC_MULTISIG_STORAGE=memory. Refusing to boot.`,
    );
    process.exit(1);
  }

  const perms = st.mode & 0o777;
  if (perms !== 0o700) {
    const octal = perms.toString(8).padStart(3, "0");
    log(
      "warn",
      `BTC multisig storage dir ${path} has perms 0o${octal}; expected 0o700. Tighten with: chmod 700 ${path}`,
    );
  }
}
