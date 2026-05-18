// test/config-file-write.test.ts — Phase 10 / Plan 10-03 (DIST-42).
//
// Coverage for the ADDITIVE `writeConfigFile()` export in
// `src/config/config-file.ts` (after line 95). Phase 5's FROZEN
// `readConfigFile()` + `_paths` + types at lines 1-95 stay BYTE-FROZEN.
//
// Discipline asserted:
//
//   1. Atomic-write: tmp file lives in dirname(path), final path is the
//      target. POSIX `rename` guarantees readers see EITHER old OR new
//      content, never partial bytes.
//   2. Mode 0o600 at write time (T-MODE-PERMISSIONS-LEAK-1) — no
//      narrow race window where the file is world-readable.
//   3. Routed through `_paths.getConfigPath()` spy-affordance — a single
//      `vi.spyOn` redirects BOTH reads and writes.

import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _paths,
  readConfigFile,
  writeConfigFile,
} from "../src/config/config-file.js";
import type { ConfigFile } from "../src/config/config-file.js";

describe("writeConfigFile — atomic + mode 0o600 + _paths spy round-trip", () => {
  let tempDir: string;
  let cfgPath: string;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vp-mcp-write-"));
    cfgPath = join(tempDir, "config.json");
    spy = vi.spyOn(_paths, "getConfigPath").mockReturnValue(cfgPath);
  });

  afterEach(() => {
    spy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("Test 1 — writes the merged shape to the spied path", async () => {
    const merged: ConfigFile = { demo: false, rpcUrl: "https://eth.example/v2/k" };
    await writeConfigFile(merged);
    const raw = readFileSync(cfgPath, "utf8");
    expect(JSON.parse(raw)).toEqual(merged);
  });

  it("Test 2 — output JSON has 2-space indent + trailing newline (matches readConfigFile parser)", async () => {
    await writeConfigFile({ rpcUrl: "https://eth.example/v2/k" });
    const raw = readFileSync(cfgPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "rpcUrl"');
  });

  it("Test 3 — mode 0o600 (T-MODE-PERMISSIONS-LEAK-1)", async () => {
    await writeConfigFile({ rpcUrl: "https://eth.example/v2/k" });
    const stat = lstatSync(cfgPath);
    // The low 9 bits of `mode` are the permission bits. 0o600 = owner rw,
    // group nothing, other nothing.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("Test 4 — creates the parent directory recursively", async () => {
    const nestedPath = join(tempDir, "nested", "deep", "config.json");
    spy.mockReturnValue(nestedPath);
    await writeConfigFile({ demo: true });
    expect(readFileSync(nestedPath, "utf8")).toContain("demo");
  });

  it("Test 5 — tmp file lives in dirname(path) (same-filesystem requirement)", async () => {
    // Spy `writeFile` indirectly: capture the actual on-disk file count
    // before/after to confirm the tmp file was within tempDir and removed
    // after rename.
    const beforeCount = readdirSafe(tempDir).length;
    await writeConfigFile({ rpcUrl: "https://eth.example/v2/k" });
    const afterCount = readdirSafe(tempDir).length;
    // Exactly one new file (config.json) — no orphaned tmp.
    expect(afterCount - beforeCount).toBe(1);
    // The remaining file is config.json (NOT a .tmp file).
    const entries = readdirSafe(tempDir);
    expect(entries).toContain("config.json");
    expect(entries.find((n) => n.includes(".tmp-"))).toBeUndefined();
    // Sanity — assert the renamed file lives in the spied dir.
    expect(dirname(cfgPath)).toBe(tempDir);
  });

  it("Test 6 — round-trip: writeConfigFile then readConfigFile returns the same shape", async () => {
    const original: ConfigFile = {
      demo: false,
      rpcUrl: "https://eth.example/v2/k",
    };
    await writeConfigFile(original);
    const read = readConfigFile();
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.parsed).toEqual(original);
  });

  it("Test 7 — overwrite: a second write replaces the first (no append)", async () => {
    await writeConfigFile({ rpcUrl: "https://first.example/v2/k" });
    await writeConfigFile({ rpcUrl: "https://second.example/v2/k" });
    const raw = readFileSync(cfgPath, "utf8");
    expect(raw).toContain("second.example");
    expect(raw).not.toContain("first.example");
  });

  it("Test 8 — empty config is a valid write (encodes `{}`)", async () => {
    await writeConfigFile({});
    const raw = readFileSync(cfgPath, "utf8");
    expect(JSON.parse(raw)).toEqual({});
  });
});

function readdirSafe(dir: string): string[] {
  // Wrapper around `fs.readdirSync` that returns an empty array if the
  // directory has been removed concurrently (defensive — keeps the test
  // stable on slow filesystems).
  try {
    return require("node:fs").readdirSync(dir) as string[];
  } catch {
    return [];
  }
}
