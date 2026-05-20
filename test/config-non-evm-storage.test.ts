// Phase 11 / Plan 11-01 — `src/config/non-evm-storage.ts` tests.
//
// Mirrors `test/config-wc-storage.test.ts` line-by-line (PAIR-NEV-06 +
// 0o700/0o600 perm discipline). All file-touching tests use a `tmpdir` path
// so the test never writes under `~/`.

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureStorageDirWithPerms,
  getNonEvmStorageDir,
  getNonEvmStorageMode,
  getNonEvmStoragePath,
} from "../src/config/non-evm-storage.js";

const ENV_KEY = "VAULTPILOT_NON_EVM_STORAGE";
let savedEnv: string | undefined;

let tmpRoot: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  tmpRoot = join(
    tmpdir(),
    `non-evm-storage-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("getNonEvmStorageMode — Q-STRICT env resolution", () => {
  it("Test 1: returns 'persist' when VAULTPILOT_NON_EVM_STORAGE is unset", () => {
    delete process.env[ENV_KEY];
    expect(getNonEvmStorageMode()).toBe("persist");
  });

  it("Test 1b: returns 'persist' when VAULTPILOT_NON_EVM_STORAGE is empty / whitespace-only", () => {
    process.env[ENV_KEY] = "";
    expect(getNonEvmStorageMode()).toBe("persist");
    process.env[ENV_KEY] = "   ";
    expect(getNonEvmStorageMode()).toBe("persist");
  });

  it("Test 2: returns 'memory' when VAULTPILOT_NON_EVM_STORAGE=memory", () => {
    process.env[ENV_KEY] = "memory";
    expect(getNonEvmStorageMode()).toBe("memory");
  });

  it("Test 3: returns 'persist' when VAULTPILOT_NON_EVM_STORAGE=persist", () => {
    process.env[ENV_KEY] = "persist";
    expect(getNonEvmStorageMode()).toBe("persist");
  });

  it("Test 4: refuses to boot on any other value (process.exit + stderr error naming env var + valid literals)", () => {
    process.env[ENV_KEY] = "nonsense";
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__test_exit__:${code ?? "noarg"}`);
    }) as never);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => getNonEvmStorageMode()).toThrow(/__test_exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrCalls).toMatch(/VAULTPILOT_NON_EVM_STORAGE/);
    expect(stderrCalls).toMatch(/memory/);
    expect(stderrCalls).toMatch(/persist/);
  });

  it("Test 4b: case-sensitive — 'Memory' / 'PERSIST' / '1' / 'true' all refuse to boot", () => {
    for (const bad of ["Memory", "PERSIST", "1", "true", "yes", "on"]) {
      process.env[ENV_KEY] = bad;
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`__test_exit__:${code ?? "noarg"}`);
      }) as never);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      expect(() => getNonEvmStorageMode()).toThrow(/__test_exit__:1/);
      exitSpy.mockRestore();
      vi.restoreAllMocks();
    }
  });
});

describe("getNonEvmStoragePath + getNonEvmStorageDir", () => {
  it("Test 5a: returns an absolute path ending in '/.vaultpilot-mcp/non-evm-accounts.json'", () => {
    const p = getNonEvmStoragePath();
    expect(p.startsWith("/")).toBe(true);
    expect(p.endsWith("/.vaultpilot-mcp/non-evm-accounts.json")).toBe(true);
  });

  it("Test 5b: dir helper returns the parent (sibling of wc-storage + config.json)", () => {
    const d = getNonEvmStorageDir();
    expect(d.startsWith("/")).toBe(true);
    expect(d.endsWith("/.vaultpilot-mcp")).toBe(true);
    // File is housed inside the dir — joining the two anchors the contract.
    expect(getNonEvmStoragePath().startsWith(d + "/")).toBe(true);
  });
});

describe("ensureStorageDirWithPerms", () => {
  it("Test 6a: creates the directory recursively with 0o700 perms when missing", () => {
    const path = join(tmpRoot!, ".vaultpilot-mcp");
    expect(existsSync(path)).toBe(false);
    ensureStorageDirWithPerms(path);
    expect(existsSync(path)).toBe(true);
    const st = statSync(path);
    expect(st.isDirectory()).toBe(true);
    expect(st.mode & 0o777).toBe(0o700);
  });

  it("Test 6b: subsequent call on an existing dir with correct perms is a silent no-op (no warn)", () => {
    const path = join(tmpRoot!, ".vaultpilot-mcp");
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    ensureStorageDirWithPerms(path);
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrCalls).not.toMatch(/perms/);
  });

  it("Test 6c: subsequent call on existing dir with drifted perms logs a stderr warning but does NOT throw and does NOT chmod", () => {
    const path = join(tmpRoot!, ".vaultpilot-mcp");
    mkdirSync(path, { recursive: true, mode: 0o755 });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => ensureStorageDirWithPerms(path)).not.toThrow();
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrCalls).toMatch(/\[warn\]/);
    expect(stderrCalls).toMatch(/perms/);
    expect(stderrCalls).toMatch(/0o755/);
    expect(stderrCalls).toMatch(/0o700/);
    const st = statSync(path);
    expect(st.mode & 0o777).toBe(0o755);
  });

  it("Test 6d: refuses to boot when the path exists but is a regular file (ENOTDIR-shaped)", () => {
    mkdirSync(tmpRoot!, { recursive: true });
    const filePath = join(tmpRoot!, ".vaultpilot-mcp");
    writeFileSync(filePath, "i am a file, not a directory");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__test_exit__:${code ?? "noarg"}`);
    }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => ensureStorageDirWithPerms(filePath)).toThrow(/__test_exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("Task 2: global hermeticity pin (test/setup.ts) + persist-branch override", () => {
  it("Test 14: without any per-test env setup, mode resolves to 'memory' (proves the global pin in test/setup.ts is wired)", () => {
    if (savedEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedEnv;
    expect(getNonEvmStorageMode()).toBe("memory");
  });

  it("Test 18: persist branch can be exercised in a single test by overriding the global pin", () => {
    process.env[ENV_KEY] = "persist";
    expect(getNonEvmStorageMode()).toBe("persist");
  });
});

// Suite-tail invariant — no tests above touched
// `~/.vaultpilot-mcp/non-evm-accounts.json` (Test 6a–6d use tmpRoot).
afterAll(() => {
  const path = join(process.env.HOME ?? "/nonexistent", ".vaultpilot-mcp", "non-evm-accounts.json");
  if (existsSync(path)) {
    process.stderr.write(
      `[warn] test/config-non-evm-storage.test.ts: ~/.vaultpilot-mcp/non-evm-accounts.json exists at suite end (${path}). ` +
        `This file's tests should not have written it. Investigate if reproducible.\n`,
    );
  }
});
