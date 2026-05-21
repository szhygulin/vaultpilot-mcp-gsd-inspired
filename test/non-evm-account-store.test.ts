// Phase 11 / Plan 11-01 — `src/wallet/non-evm-account-store.ts` tests.
//
// Mirrors `test/wallet-session-manager.test.ts` shape:
// - `_storage` spy-affordance (CLAUDE.md non-negotiable; direct `vi.spyOn`
//   on the bare `fs` import silently no-ops in ESM)
// - `_resetNonEvmStoreForTesting` between tests
// - tmpdir + HOME-override for the one happy-path file test that needs to
//   touch the real `getNonEvmStoragePath` shape

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetNonEvmStoreForTesting,
  _storage,
  eagerInitNonEvmStoreIfPersist,
  listAccounts,
  loadAccounts,
  removeAccount,
  saveAccount,
  type NonEvmAccountRecord,
} from "../src/wallet/non-evm-account-store.js";

const ENV_KEY = "VAULTPILOT_NON_EVM_STORAGE";
let savedEnv: string | undefined;
let savedHome: string | undefined;
let tmpRoot: string | undefined;

const SOLANA_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const SOLANA_ADDR_2 = "GgRrn3oHQbDpxnXobzn7zSXY5jiVDbV3iv5UfddXt6Sw";
const TRON_ADDR = "TYukBQZ2XXCcRCReAUguyXncCWNY9CEiDQ";
const DERIVATION = "44'/501'/0'";

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  savedHome = process.env.HOME;
  process.env[ENV_KEY] = "memory";
  tmpRoot = join(
    tmpdir(),
    `non-evm-store-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  _resetNonEvmStoreForTesting();
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  _resetNonEvmStoreForTesting();
  vi.restoreAllMocks();
});

describe("loadAccounts — fresh install / memory mode", () => {
  it("Test 1: returns [] on fresh install in memory mode", () => {
    expect(loadAccounts()).toEqual([]);
  });

  it("Test 1b: returns [] on fresh install in persist mode when file is missing", () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    expect(loadAccounts()).toEqual([]);
  });
});

describe("saveAccount — upsert by (chain, address) tuple", () => {
  it("Test 2: persists in memory mode; loadAccounts returns the record", () => {
    const rec: NonEvmAccountRecord = {
      chain: "solana",
      address: SOLANA_ADDR,
      derivationPath: DERIVATION,
      pairedAt: new Date().toISOString(),
    };
    saveAccount(rec);
    expect(loadAccounts()).toEqual([rec]);
  });

  it("Test 3a: upsert — same chain+address REPLACES", () => {
    const t1 = "2026-01-01T00:00:00.000Z";
    const t2 = "2026-01-02T00:00:00.000Z";
    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: t1 });
    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: t2 });
    const all = loadAccounts();
    expect(all).toHaveLength(1);
    expect(all[0]?.pairedAt).toBe(t2);
  });

  it("Test 3b: same chain DIFFERENT address APPENDS (multiple addresses per chain — PAIR-NEV-03)", () => {
    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: "44'/501'/0'", pairedAt: new Date().toISOString() });
    saveAccount({ chain: "solana", address: SOLANA_ADDR_2, derivationPath: "44'/501'/1'", pairedAt: new Date().toISOString() });
    const all = loadAccounts();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.address).sort()).toEqual([SOLANA_ADDR, SOLANA_ADDR_2].sort());
  });

  it("Test 3c: different chain SAME-looking address APPENDS (uniqueness is by tuple, not by address alone)", () => {
    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: new Date().toISOString() });
    saveAccount({ chain: "tron", address: TRON_ADDR, derivationPath: "44'/195'/0'/0/0", pairedAt: new Date().toISOString() });
    expect(loadAccounts()).toHaveLength(2);
  });
});

describe("removeAccount — idempotent", () => {
  it("Test 4: removes the matching record", () => {
    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: new Date().toISOString() });
    expect(loadAccounts()).toHaveLength(1);
    const result = removeAccount("solana", SOLANA_ADDR);
    expect(result).toEqual({ removed: true });
    expect(loadAccounts()).toEqual([]);
  });

  it("Test 5: idempotent removal on non-existent record returns { removed: false } — does NOT throw", () => {
    expect(() => removeAccount("solana", SOLANA_ADDR)).not.toThrow();
    const result = removeAccount("solana", SOLANA_ADDR);
    expect(result).toEqual({ removed: false });
  });

  it("Test 5b: removing one record leaves the other untouched", () => {
    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: new Date().toISOString() });
    saveAccount({ chain: "solana", address: SOLANA_ADDR_2, derivationPath: "44'/501'/1'", pairedAt: new Date().toISOString() });
    removeAccount("solana", SOLANA_ADDR);
    const remaining = loadAccounts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.address).toBe(SOLANA_ADDR_2);
  });
});

describe("Atomic-write contract — tempfile + rename + 0o600 mode (persist mode)", () => {
  it("Test 6: writeFileSync called with tempfile path; renameSync called from tmp to final", () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    // Stub the dir-perm guard so the test never touches a real parent dir
    // — we only care about the write path here.
    const ensureSpy = vi
      .spyOn(_storage, "ensureStorageDirWithPerms")
      .mockImplementation(() => undefined);
    const writeSpy = vi.spyOn(_storage, "writeFileSync").mockImplementation(() => undefined);
    const renameSpy = vi.spyOn(_storage, "renameSync").mockImplementation(() => undefined);

    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: new Date().toISOString() });

    expect(ensureSpy).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [tmpPath, json, opts] = writeSpy.mock.calls[0]!;
    expect(typeof tmpPath).toBe("string");
    expect(String(tmpPath)).toMatch(new RegExp(`non-evm-accounts\\.json\\.tmp\\.${process.pid}$`));
    expect(typeof json).toBe("string");
    // The final path is NEVER passed to writeFileSync — only the tmp path.
    expect(String(tmpPath).endsWith(".json")).toBe(false);

    expect(renameSpy).toHaveBeenCalledTimes(1);
    const [renameFrom, renameTo] = renameSpy.mock.calls[0]!;
    expect(String(renameFrom)).toBe(String(tmpPath));
    expect(String(renameTo).endsWith("/.vaultpilot-mcp/non-evm-accounts.json")).toBe(true);

    // File mode 0o600 (owner read+write only).
    expect(opts).toEqual({ mode: 0o600 });
  });

  it("Test 7: end-to-end persist round-trip — writes a real file with 0o600 perms; re-read returns same record", () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    const rec: NonEvmAccountRecord = {
      chain: "solana",
      address: SOLANA_ADDR,
      derivationPath: DERIVATION,
      pairedAt: "2026-05-20T00:00:00.000Z",
    };
    saveAccount(rec);

    const filePath = join(tmpRoot!, ".vaultpilot-mcp", "non-evm-accounts.json");
    expect(existsSync(filePath)).toBe(true);
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
    // Parent dir 0o700.
    const dirMode = statSync(join(tmpRoot!, ".vaultpilot-mcp")).mode & 0o777;
    expect(dirMode).toBe(0o700);

    // Fresh load via a new "process" — reset module state then read.
    _resetNonEvmStoreForTesting();
    expect(loadAccounts()).toEqual([rec]);
  });
});

describe("Stale-session detection (PAIR-NEV-04)", () => {
  it("Test 8a: record older than 30 days surfaces staleAccountWarning: true", () => {
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: old });
    const view = listAccounts({ chainFilter: "solana" });
    expect(view).toHaveLength(1);
    expect(view[0]?.staleAccountWarning).toBe(true);
  });

  it("Test 8b: record younger than 30 days does NOT have the flag", () => {
    const recent = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: recent });
    const view = listAccounts({ chainFilter: "solana" });
    expect(view).toHaveLength(1);
    expect(view[0]?.staleAccountWarning).toBeUndefined();
  });
});

describe("listAccounts — chain filter", () => {
  it("Test 9: chainFilter='solana' filters to solana records", () => {
    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: new Date().toISOString() });
    saveAccount({ chain: "tron", address: TRON_ADDR, derivationPath: "44'/195'/0'/0/0", pairedAt: new Date().toISOString() });
    const solOnly = listAccounts({ chainFilter: "solana" });
    expect(solOnly).toHaveLength(1);
    expect(solOnly[0]?.chain).toBe("solana");
    const tronOnly = listAccounts({ chainFilter: "tron" });
    expect(tronOnly).toHaveLength(1);
    expect(tronOnly[0]?.chain).toBe("tron");
    // No filter — both records.
    expect(listAccounts()).toHaveLength(2);
  });
});

describe("Schema-invalid records dropped on load (warn + continue)", () => {
  it("Test 10: invalid `chain` literal dropped; stderr warn fires; valid records kept", () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    // Write a corrupt file directly to disk.
    const dirPath = join(tmpRoot!, ".vaultpilot-mcp");
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    const filePath = join(dirPath, "non-evm-accounts.json");
    const payload = JSON.stringify([
      { chain: "ethereum", address: "0xdead", derivationPath: "x", pairedAt: "2026-01-01T00:00:00.000Z" },
      { chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    // Use the real fs write — we want a real file on disk for this.
    // We import dynamically to avoid forcing the test to mock writeFileSync.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(filePath, payload, { mode: 0o600 });

    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    _resetNonEvmStoreForTesting();
    const all = loadAccounts();
    expect(all).toHaveLength(1);
    expect(all[0]?.chain).toBe("solana");
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrCalls).toMatch(/invalid chain/);
  });
});

describe("Phase 22 — dual-record-per-chain (bitcoin segwit + taproot coexist)", () => {
  // PAIR-NEV-03 / Meta-Decision 1 (Phase 22 PATTERNS): the (chain, address)
  // upsert tuple lets a single chain hold multiple records — `chain:
  // "bitcoin"` holds one segwit (`bc1q…`) AND one taproot (`bc1p…`) record
  // per paired device. The schema is BYTE-UNTOUCHED.
  const BTC_SEGWIT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
  const BTC_TAPROOT =
    "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

  it("two `chain: \"bitcoin\"` saveAccount calls with distinct addresses produce TWO coexisting records", () => {
    const pairedAt = new Date().toISOString();
    saveAccount({ chain: "bitcoin", address: BTC_SEGWIT, derivationPath: "84'/0'/0'/0/0", pairedAt });
    saveAccount({ chain: "bitcoin", address: BTC_TAPROOT, derivationPath: "86'/0'/0'/0/0", pairedAt });

    const view = listAccounts({ chainFilter: "bitcoin" });
    expect(view).toHaveLength(2);
    const addrs = view.map((r) => r.address).sort();
    expect(addrs).toEqual([BTC_SEGWIT, BTC_TAPROOT].sort());
  });

  it("calling pair twice (4 saveAccount calls) produces EXACTLY 2 records (idempotent upsert on tuple)", () => {
    // Regression anchor for PAIR-NEV-03 multi-record-per-chain under
    // dual-pair: re-pair must NOT produce duplicate records. The upsert
    // key is (chain, address); same chain+address replaces (refreshes
    // pairedAt).
    const t1 = "2026-05-01T00:00:00.000Z";
    const t2 = "2026-05-02T00:00:00.000Z";
    saveAccount({ chain: "bitcoin", address: BTC_SEGWIT, derivationPath: "84'/0'/0'/0/0", pairedAt: t1 });
    saveAccount({ chain: "bitcoin", address: BTC_TAPROOT, derivationPath: "86'/0'/0'/0/0", pairedAt: t1 });
    // Second pair call — same addresses, fresher pairedAt.
    saveAccount({ chain: "bitcoin", address: BTC_SEGWIT, derivationPath: "84'/0'/0'/0/0", pairedAt: t2 });
    saveAccount({ chain: "bitcoin", address: BTC_TAPROOT, derivationPath: "86'/0'/0'/0/0", pairedAt: t2 });

    const view = listAccounts({ chainFilter: "bitcoin" });
    expect(view).toHaveLength(2);
    // pairedAt refreshed to t2 on both records.
    expect(view.every((r) => r.pairedAt === t2)).toBe(true);
  });

  it("per-record aging — staleAccountWarning fires per (chain, address) tuple, not per pair", () => {
    // Phase 22 Plan 22-02 acceptance: segwit and taproot age independently
    // under chain: "bitcoin". A stale segwit record does NOT mark the
    // sibling taproot record as stale.
    const stale = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
    const fresh = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    saveAccount({ chain: "bitcoin", address: BTC_SEGWIT, derivationPath: "84'/0'/0'/0/0", pairedAt: stale });
    saveAccount({ chain: "bitcoin", address: BTC_TAPROOT, derivationPath: "86'/0'/0'/0/0", pairedAt: fresh });

    const view = listAccounts({ chainFilter: "bitcoin" });
    expect(view).toHaveLength(2);
    const segwitView = view.find((r) => r.address === BTC_SEGWIT);
    const taprootView = view.find((r) => r.address === BTC_TAPROOT);
    expect(segwitView?.staleAccountWarning).toBe(true);
    expect(taprootView?.staleAccountWarning).toBeUndefined();
  });

  it("removeAccount on one bitcoin record leaves the sibling intact", () => {
    const pairedAt = new Date().toISOString();
    saveAccount({ chain: "bitcoin", address: BTC_SEGWIT, derivationPath: "84'/0'/0'/0/0", pairedAt });
    saveAccount({ chain: "bitcoin", address: BTC_TAPROOT, derivationPath: "86'/0'/0'/0/0", pairedAt });

    const result = removeAccount("bitcoin", BTC_SEGWIT);
    expect(result).toEqual({ removed: true });

    const view = listAccounts({ chainFilter: "bitcoin" });
    expect(view).toHaveLength(1);
    expect(view[0]?.address).toBe(BTC_TAPROOT);
  });

  it("`bitcoin` is in the NonEvmChain literal-union (zero schema change required for Phase 22)", () => {
    // The compile-time check is enforced via the type system; this
    // runtime assertion is the trace — saveAccount accepts `chain:
    // "bitcoin"` without throwing.
    expect(() =>
      saveAccount({
        chain: "bitcoin",
        address: BTC_SEGWIT,
        derivationPath: "84'/0'/0'/0/0",
        pairedAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});

describe("`_storage` ESM spy-affordance regression (CLAUDE.md non-negotiable)", () => {
  it("Test 11: vi.spyOn(_storage, 'readFileSync') intercepts internal calls (proves indirection works)", async () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    // existsSync routed through _storage so the spy sees the call. We
    // stub it to return true so loadFromDisk proceeds to readFileSync.
    vi.spyOn(_storage, "existsSync").mockReturnValue(true);
    const readSpy = vi
      .spyOn(_storage, "readFileSync")
      .mockReturnValue(JSON.stringify([
        { chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: "2026-05-01T00:00:00.000Z" },
      ]));

    _resetNonEvmStoreForTesting();
    await eagerInitNonEvmStoreIfPersist();

    expect(readSpy).toHaveBeenCalled();
    expect(loadAccounts()).toEqual([
      { chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: "2026-05-01T00:00:00.000Z" },
    ]);
  });

  it("Test 12: _resetNonEvmStoreForTesting clears in-memory store + loaded flag", () => {
    saveAccount({ chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: new Date().toISOString() });
    expect(loadAccounts()).toHaveLength(1);
    _resetNonEvmStoreForTesting();
    expect(loadAccounts()).toEqual([]);
  });
});
