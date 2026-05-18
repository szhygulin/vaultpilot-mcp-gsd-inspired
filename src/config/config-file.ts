// Single source of truth for `~/.vaultpilot-mcp/config.json` resolution.
//
// Format-fanout-regex-sync rule (global CLAUDE.md): config-file path
// resolution lives here ONLY. Prior to Phase 5, `src/diagnostics/check.ts`
// inlined the `homedir() + join + readFileSync + JSON.parse` block; that
// duplication is now collapsed into `getConfigPath()` + `readConfigFile()`,
// which both `src/diagnostics/check.ts::checkConfigFile()` and
// `src/config/env.ts::resolveDemoMode()` consume.
//
// Pure I/O + parse — NO `process.exit` here. The caller decides whether
// `malformed` is fatal (the resolver in env.ts) or merely a warning (the
// `--check` doctor pass in check.ts).

import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * v1.0 `~/.vaultpilot-mcp/config.json` shape. Forward-compatible — fields
 * not enumerated here are tolerated at parse time but ignored at this
 * layer. Phase 10's wizard populates `rpcUrl`; Plan 05-01 reads `demo`.
 *
 * Q-CONFIG-NO-KEY lock (research § A2): a config file that EXISTS but has
 * NO `demo` key resolves to real-mode — the user took the trouble to write
 * a config, so we respect their implicit opt-out of auto-demo.
 */
export interface ConfigFile {
  demo?: boolean;
  rpcUrl?: string;
}

/**
 * Discriminated result for `readConfigFile()`. The resolver in
 * `src/config/env.ts` maps each branch:
 *   - `ok: true`        → consume `parsed.demo`
 *   - `ok: false, reason: "missing"`   → auto-demo arm (DEMO-07 / INST-05)
 *   - `ok: false, reason: "malformed"` → stderr + `process.exit(1)` per
 *                                        T-CONFIG-MALFORMED-1 mitigation
 *
 * `cause` carries the underlying JSON.parse error message verbatim so the
 * operator sees `"Unexpected token } in JSON at position 17"` in stderr
 * and can fix the file.
 */
export type ConfigFileResult =
  | { ok: true; parsed: ConfigFile }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "malformed"; cause: string };

/**
 * Canonical config-file path. Exported so test code can `vi.spyOn` it and
 * redirect reads to a temp directory (see `test/helpers/mock-config-file.ts`)
 * WITHOUT leaking a test-only env var into production code.
 */
export function getConfigPath(): string {
  return join(homedir(), ".vaultpilot-mcp", "config.json");
}

/**
 * Read + parse the config file. Sync I/O at module load is acceptable —
 * the file is < 1 KB and read once per process (the resolver caches).
 *
 * Errors are classified by KIND, not by message — file-missing errors
 * (ENOENT and friends) become `missing`; JSON.parse failures become
 * `malformed`. Other read errors (permission denied, disk failure) are
 * treated as `missing` for safety — surfacing them as `malformed` would
 * cause `process.exit(1)` for transient OS conditions, which is too
 * aggressive. The doctor pass (`--check`) is the right place to surface
 * permission-denied to the operator.
 *
 * Implementation note: `getConfigPath` is invoked via the `_paths`
 * indirection object so that `vi.spyOn(_paths, "getConfigPath")` in
 * tests can redirect reads to a temp directory. A direct
 * `getConfigPath()` call would bind to the import-time function
 * reference and bypass the spy (ESM binding semantics). Format-fanout-
 * regex-sync rule: only `getConfigPath()` knows where the file lives.
 */
export const _paths = { getConfigPath };

export function readConfigFile(): ConfigFileResult {
  const path = _paths.getConfigPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ok: false, reason: "missing" };
  }

  try {
    const parsed = JSON.parse(raw) as ConfigFile;
    return { ok: true, parsed };
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "malformed", cause };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 10 / Plan 10-03 (DIST-42) — ADDITIVE writeConfigFile()
//
// Companion to FROZEN `readConfigFile()` (lines 1-95). Persists the merged
// config shape produced by `vaultpilot-mcp setup`. Lines 1-95 are BYTE-
// FROZEN; this is the only addition in Plan 10-03.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Atomic-write a config shape to `~/.vaultpilot-mcp/config.json` (or the
 * path returned by the `_paths.getConfigPath()` spy in tests).
 *
 * Discipline:
 *
 *   1. **Atomic replacement.** Write to a tmp file in the SAME directory
 *      (`dirname(path)`), then `rename()` over the destination. POSIX
 *      `rename` is atomic within a single filesystem — readers see EITHER
 *      the old config OR the new config, never partial bytes. Using
 *      `os.tmpdir()` instead of `dirname(path)` would EXDEV-fail when
 *      `/tmp` and `~/.vaultpilot-mcp/` live on different filesystems
 *      (`/tmp` is tmpfs on many distros).
 *
 *   2. **Mode 0o600 at write time.** Owner-only read/write per the
 *      `~/.netrc` / `~/.aws/credentials` / ssh-private-key convention.
 *      The mode is passed to `writeFile` directly — NO post-write `chmod`
 *      that would leave a narrow race window where the file is world-
 *      readable. Pre-existing files with a broader mode keep that mode
 *      until the next wizard write; the rename replaces the inode, so
 *      the new file's mode wins.
 *
 *   3. **Spy-affordance via `_paths.getConfigPath()`.** Test helpers
 *      (`test/helpers/mock-config-file.ts`) redirect BOTH reads and writes
 *      via a single `vi.spyOn(_paths, "getConfigPath")` invocation.
 *
 *   4. **Parent-directory creation.** `mkdir(..., { recursive: true })` is
 *      idempotent — safe to call when `~/.vaultpilot-mcp/` already exists.
 */
export async function writeConfigFile(merged: ConfigFile): Promise<void> {
  const path = _paths.getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(merged, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(tmpPath, path);
}
