// Test helper for mocking `~/.vaultpilot-mcp/config.json`.
//
// Plan 05-01 Wave 0. Production code's `getConfigPath()` is monkey-patched
// via `vi.spyOn` to point at a per-test temp directory; tests NEVER touch
// the real `~/.vaultpilot-mcp/config.json`. Format-fanout-regex-sync rule:
// the config-file path literal lives ONLY in `src/config/config-file.ts`
// — this helper redirects via the exported function, not a parallel
// literal.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import { _paths } from "../../src/config/config-file.js";

export type ConfigFileScenario =
  | { kind: "missing" }
  | { kind: "malformed" }
  | { kind: "valid"; content: Record<string, unknown> };

export interface MockConfigFile {
  /** Returns the temp directory containing the (possibly absent) config.json. */
  tempDir: string;
  /** Path the spy now returns for `getConfigPath()`. */
  path: string;
  /** Restore the spy + remove the temp directory. */
  restore: () => void;
}

/**
 * Mock the config-file path resolution. Three scenarios:
 *   - `missing`:   temp dir exists but no `config.json` file in it
 *   - `malformed`: temp dir contains `config.json` with invalid JSON
 *   - `valid`:     temp dir contains `config.json` with the given object
 *
 * Returns `{ restore }` — the caller MUST invoke `restore()` in
 * `afterEach` to remove the spy and clean up the temp dir.
 *
 * Sanity assertion: the temp path matches `/tmp/` or `/var/folders/`
 * (macOS), proving the helper NEVER writes to the user's real
 * `~/.vaultpilot-mcp/` directory.
 */
export function mockConfigFile(scenario: ConfigFileScenario): MockConfigFile {
  const tempDir = mkdtempSync(join(tmpdir(), "vaultpilot-mock-config-"));
  const path = join(tempDir, "config.json");

  // Sanity: confirm we're inside an OS-supplied temp area.
  if (!path.startsWith("/tmp/") && !path.startsWith("/var/folders/") && !path.startsWith("/private/var/folders/")) {
    throw new Error(`mockConfigFile: temp path outside OS tmp: ${path}`);
  }

  if (scenario.kind === "malformed") {
    writeFileSync(path, "{ broken json", "utf8");
  } else if (scenario.kind === "valid") {
    writeFileSync(path, JSON.stringify(scenario.content), "utf8");
  }
  // "missing" — no file written; only the empty temp dir exists.

  // Spy on the `_paths` indirection object that `readConfigFile()` and
  // `checkConfigFile()` route through internally — see
  // `src/config/config-file.ts` for the rationale (ESM binding semantics).
  const spy = vi.spyOn(_paths, "getConfigPath").mockReturnValue(path);

  return {
    tempDir,
    path,
    restore: () => {
      spy.mockRestore();
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup — test isolation already guaranteed
        // by the unique mkdtemp suffix
      }
    },
  };
}
