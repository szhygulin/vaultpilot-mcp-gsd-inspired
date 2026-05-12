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
import { homedir } from "node:os";
import { join } from "node:path";

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
