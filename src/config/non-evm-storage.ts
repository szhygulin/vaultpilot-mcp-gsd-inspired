// Non-EVM account-store storage-mode resolution + on-disk file management.
//
// Resolves `VAULTPILOT_NON_EVM_STORAGE` to `"memory"` (in-process cache only —
// fresh process = fresh pair) or `"persist"` (write the JSON cache to
// `~/.vaultpilot-mcp/non-evm-accounts.json` with `0o600` perms inside a
// `0o700` parent directory, so the user does not re-pair their Ledger every
// cold boot for Solana / TRON / BTC / LTC). Production default is
// `"persist"`; the test setup pins `"memory"` so the suite stays hermetic.
//
// File-vs-directory note (load-bearing — read before maintenance):
//   The non-EVM cache is a SINGLE JSON FILE (`non-evm-accounts.json`), NOT a
//   directory of keys-as-files. The dataset is small (4 chains max, a few
//   records each) and atomic-write via tempfile + `fs.renameSync` is enough.
//   This deliberately differs from WC's `wc-storage/` directory, which is
//   shaped by the WC SDK's fs-lite key-per-file driver. Here we own the
//   on-disk shape end-to-end, so a single JSON file is correct.
//
//   Parent dir `~/.vaultpilot-mcp/` is shared with `config.json` and the WC
//   storage directory; perms checks target the parent (0o700), not the
//   single file (0o600 enforced by `_storage.writeFileSync` on the writer
//   side in `src/wallet/non-evm-account-store.ts`).
//
// Q-STRICT lock (mirror of `src/config/wc-storage.ts::getWalletConnectStorageMode`):
//   `VAULTPILOT_NON_EVM_STORAGE` accepts ONLY the literal strings `"memory"`
//   and `"persist"`. Any other value (`"Memory"`, `"persistent"`, `"1"`, etc.)
//   triggers `log("error", ...) + process.exit(1)`. Fail-safe defaults:
//   uncertainty defaults to denial.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { log } from "../diagnostics/logger.js";

export type NonEvmStorageMode = "memory" | "persist";

function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Resolve the non-EVM storage mode from `VAULTPILOT_NON_EVM_STORAGE`.
 *
 * - Unset (or empty after trim) → `"persist"` (production default).
 * - `"memory"` → `"memory"` (opt-out for shared hosts / CI / ephemeral envs).
 * - `"persist"` → `"persist"` (explicit opt-in; same as default).
 * - Anything else → `log("error", ...) + process.exit(1)` per Q-STRICT.
 */
export function getNonEvmStorageMode(): NonEvmStorageMode {
  const raw = read("VAULTPILOT_NON_EVM_STORAGE");
  if (raw === undefined) return "persist";
  if (raw === "memory") return "memory";
  if (raw === "persist") return "persist";
  log(
    "error",
    `VAULTPILOT_NON_EVM_STORAGE must be literal "memory" or "persist"; got "${raw}". Refusing to boot.`,
  );
  process.exit(1);
}

/**
 * Absolute path to the parent directory housing the non-EVM cache + WC
 * persistent-storage subdirectory + `config.json`. The canonical VaultPilot
 * user-state home.
 */
export function getNonEvmStorageDir(): string {
  return join(homedir(), ".vaultpilot-mcp");
}

/**
 * Absolute path to the single JSON cache file. Sibling of `config.json` and
 * the `wc-storage/` directory under `~/.vaultpilot-mcp/`.
 *
 * Returns a FILE path, not a directory — see the top-of-file note on
 * file-vs-directory.
 */
export function getNonEvmStoragePath(): string {
  return join(getNonEvmStorageDir(), "non-evm-accounts.json");
}

/**
 * Ensure the parent storage directory exists with the expected `0o700`
 * perms.
 *
 * - If the path does NOT exist: create recursively with `mode: 0o700`.
 * - If the path EXISTS as a directory: stat it. If perms drift from `0o700`,
 *   `log("warn", ...)` — do NOT auto-chmod. The operator may have a
 *   legitimate reason for tightened or different perms; the WC equivalent at
 *   `wc-storage.ts::ensureStorageDirWithPerms` follows the same warn-only
 *   discipline.
 * - If the path exists but is NOT a directory (ENOTDIR-shaped state):
 *   `log("error", ...) + process.exit(1)`. The filesystem is in a state we
 *   cannot recover from; loud failure is correct.
 *
 * Sync — called from the eager-init path at server boot.
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
        `failed to create non-EVM storage directory at ${path}: ${cause}. Refusing to boot.`,
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
      `non-EVM storage path ${path} exists but cannot be stat'd: ${cause}. Refusing to boot.`,
    );
    process.exit(1);
  }
  if (!st.isDirectory()) {
    log(
      "error",
      `non-EVM storage path ${path} exists but is not a directory. Remove or rename it, or set VAULTPILOT_NON_EVM_STORAGE=memory. Refusing to boot.`,
    );
    process.exit(1);
  }

  const perms = st.mode & 0o777;
  if (perms !== 0o700) {
    const octal = perms.toString(8).padStart(3, "0");
    log(
      "warn",
      `non-EVM storage dir ${path} has perms 0o${octal}; expected 0o700. Tighten with: chmod 700 ${path}`,
    );
  }
}
