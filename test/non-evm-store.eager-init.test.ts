// Phase 11 / Plan 11-01 — end-to-end regression anchor for the eager-init
// contract on the non-EVM account store.
//
// Mirror of `test/wallet-session-manager.eager-init.test.ts` (PR #61's
// regression anchor for the WC SignClient). The pattern locks the same
// "first tool dispatch after cold boot returns paired-from-cache" contract,
// applied to the JSON-backed cache instead of the WC SDK's keyvaluestorage.
//
// PAIR-NEV-02: `eagerInitNonEvmStoreIfPersist` MUST run BEFORE
// `server.connect(transport)` so the first `get_solana_status` (or any
// other downstream consumer) reads a primed store rather than an empty one
// that would lazy-load on first read.
//
// We assert two layers:
//   1. Unit-level eager-init behavior (gates, idempotency, error handling)
//   2. Order-of-operations: `startServer()` invokes the eager-init BEFORE
//      `server.connect(transport)`. This is the load-bearing regression
//      assertion — moving the call AFTER `connect()` would silently break
//      the cold-boot UX and only surface as a manual-test bug.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetNonEvmStoreForTesting,
  _storage,
  eagerInitNonEvmStoreIfPersist,
  listAccounts,
  type NonEvmAccountRecord,
} from "../src/wallet/non-evm-account-store.js";

const ENV_KEY = "VAULTPILOT_NON_EVM_STORAGE";
let savedEnv: string | undefined;
let savedHome: string | undefined;
let tmpRoot: string | undefined;

const SOLANA_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const DERIVATION = "44'/501'/0'";

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  savedHome = process.env.HOME;
  tmpRoot = join(
    tmpdir(),
    `non-evm-eager-init-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("eagerInitNonEvmStoreIfPersist — gates", () => {
  it("(skip-arm-1) memory mode: returns silently; no file read; in-memory store stays empty", async () => {
    process.env[ENV_KEY] = "memory";
    const readSpy = vi.spyOn(_storage, "readFileSync");
    const existsSpy = vi.spyOn(_storage, "existsSync");
    await eagerInitNonEvmStoreIfPersist();
    expect(readSpy).not.toHaveBeenCalled();
    // existsSync may also not be reached — gate short-circuits BEFORE the
    // file-existence check.
    expect(existsSpy).not.toHaveBeenCalled();
    expect(listAccounts()).toEqual([]);
  });

  it("(skip-arm-2) persist mode + file missing: returns silently; no stderr; store stays empty", async () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await eagerInitNonEvmStoreIfPersist();
    expect(listAccounts()).toEqual([]);
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrCalls).not.toMatch(/error|warn/i);
  });

  it("(active) persist mode + valid file: returns; loadAccounts returns the persisted record", async () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    const dirPath = join(tmpRoot!, ".vaultpilot-mcp");
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    const filePath = join(dirPath, "non-evm-accounts.json");
    const rec: NonEvmAccountRecord = {
      chain: "solana",
      address: SOLANA_ADDR,
      derivationPath: DERIVATION,
      pairedAt: "2026-05-01T00:00:00.000Z",
    };
    writeFileSync(filePath, JSON.stringify([rec]), { mode: 0o600 });

    await eagerInitNonEvmStoreIfPersist();
    const all = listAccounts();
    expect(all).toHaveLength(1);
    expect(all[0]?.address).toBe(SOLANA_ADDR);
  });

  it("(malformed JSON) stderr warn + empty store + file NOT deleted (forensic recovery option)", async () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    const dirPath = join(tmpRoot!, ".vaultpilot-mcp");
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    const filePath = join(dirPath, "non-evm-accounts.json");
    writeFileSync(filePath, "not-valid-json{{{", { mode: 0o600 });

    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await eagerInitNonEvmStoreIfPersist();
    expect(listAccounts()).toEqual([]);
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrCalls).toMatch(/malformed JSON/);
    // File NOT deleted — operator may want to forensic-recover.
    expect(existsSync(filePath)).toBe(true);
  });

  it("(EACCES) readFileSync throws EACCES → stderr warn + returns; no abort; store empty", async () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    vi.spyOn(_storage, "existsSync").mockReturnValue(true);
    vi.spyOn(_storage, "readFileSync").mockImplementation(() => {
      const err = new Error("EACCES: permission denied") as Error & { code: string };
      err.code = "EACCES";
      throw err;
    });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(eagerInitNonEvmStoreIfPersist()).resolves.toBeUndefined();
    expect(listAccounts()).toEqual([]);
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrCalls).toMatch(/failed to read/);
  });

  it("(idempotent) safe to call multiple times — subsequent calls are no-op short-circuits", async () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    const dirPath = join(tmpRoot!, ".vaultpilot-mcp");
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    const filePath = join(dirPath, "non-evm-accounts.json");
    writeFileSync(filePath, JSON.stringify([{
      chain: "solana", address: SOLANA_ADDR, derivationPath: DERIVATION, pairedAt: "2026-05-01T00:00:00.000Z",
    }]), { mode: 0o600 });

    const readSpy = vi.spyOn(_storage, "readFileSync");

    await eagerInitNonEvmStoreIfPersist();
    await eagerInitNonEvmStoreIfPersist();
    await eagerInitNonEvmStoreIfPersist();

    // Only the first call reaches readFileSync; subsequent calls short-circuit
    // on the `loaded` flag.
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it("(Phase 22 — dual bitcoin record cold-boot restore) two `chain: \"bitcoin\"` records restore via eager-init", async () => {
    // PAIR-NEV-02 race-defense for dual-record-per-chain: a cold-booted
    // server with TWO `chain: "bitcoin"` records on disk (segwit +
    // taproot) loads BOTH on the first listAccounts({ chainFilter:
    // "bitcoin" }) call. No new init code needed — the existing eager-
    // init contract handles multi-record-per-chain for free.
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    const dirPath = join(tmpRoot!, ".vaultpilot-mcp");
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    const filePath = join(dirPath, "non-evm-accounts.json");
    const segwit: NonEvmAccountRecord = {
      chain: "bitcoin",
      address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      derivationPath: "84'/0'/0'/0/0",
      pairedAt: "2026-05-01T00:00:00.000Z",
    };
    const taproot: NonEvmAccountRecord = {
      chain: "bitcoin",
      address: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
      derivationPath: "86'/0'/0'/0/0",
      pairedAt: "2026-05-01T00:00:00.000Z",
    };
    writeFileSync(filePath, JSON.stringify([segwit, taproot]), { mode: 0o600 });

    await eagerInitNonEvmStoreIfPersist();

    const view = listAccounts({ chainFilter: "bitcoin" });
    expect(view).toHaveLength(2);
    const addrs = view.map((r) => r.address).sort();
    expect(addrs).toEqual([segwit.address, taproot.address].sort());
  });

  it("(cold-boot restore) saveAccount → reset → eager-init re-populates the store from disk", async () => {
    process.env[ENV_KEY] = "persist";
    process.env.HOME = tmpRoot!;
    // Use the real saveAccount path (no mocks) to write a file.
    const { saveAccount } = await import("../src/wallet/non-evm-account-store.js");
    const rec: NonEvmAccountRecord = {
      chain: "solana",
      address: SOLANA_ADDR,
      derivationPath: DERIVATION,
      pairedAt: "2026-05-01T00:00:00.000Z",
    };
    saveAccount(rec);
    expect(listAccounts()).toHaveLength(1);

    // Simulate a fresh process by resetting module state. The disk file
    // still exists; the in-memory store is now empty + unloaded.
    _resetNonEvmStoreForTesting();

    // Spy AFTER reset so we observe the eager-init's file read, not the
    // earlier write-side activity.
    const readSpy = vi.spyOn(_storage, "readFileSync");
    await eagerInitNonEvmStoreIfPersist();
    expect(readSpy).toHaveBeenCalled();

    expect(listAccounts()).toEqual([rec]);
  });
});

// PAIR-NEV-02 — order-of-operations regression anchor.
//
// `startServer()` must call `eagerInitNonEvmStoreIfPersist` BEFORE
// `server.connect(transport)`. The fix mirrors PR #61 for the WC client.
// Without this assertion, a future contributor could refactor the boot
// sequence (e.g. by moving eager-inits into the request handler) and
// silently break the cold-boot UX — the bug only surfaces as "first tool
// call returns not-paired even though a record is on disk."
//
// We assert the contract by spying on both functions, mocking the transport
// so `server.connect` is observable, calling `startServer`, and asserting
// the invocation order.
describe("order-of-operations regression — eager-init runs BEFORE server.connect", () => {
  it("(PAIR-NEV-02) startServer invokes eagerInitNonEvmStoreIfPersist BEFORE server.connect(transport)", async () => {
    // We track the call order through a shared sequencer. Each spy
    // appends its own marker on call; the final array tells the story.
    const callOrder: string[] = [];

    // Mock the transport class — `new StdioServerTransport()` returns an
    // object whose `.connect()` we don't care about; the assertion is on
    // `server.connect(transport)`, which is the Server method.
    vi.doMock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
      StdioServerTransport: vi.fn().mockImplementation(() => ({})),
    }));

    // Mock the Server class so `server.connect(transport)` is observable.
    vi.doMock("@modelcontextprotocol/sdk/server/index.js", () => ({
      Server: vi.fn().mockImplementation(() => ({
        connect: vi.fn(async () => {
          callOrder.push("server.connect");
        }),
        setRequestHandler: vi.fn(),
      })),
    }));

    // Mock the two eager-init functions to record their call order. The
    // module under test (`server.ts`) reads them by name; we patch the
    // export bindings via vi.doMock.
    vi.doMock("../src/wallet/walletconnect-client.js", async () => {
      const actual = await vi.importActual<typeof import("../src/wallet/walletconnect-client.js")>(
        "../src/wallet/walletconnect-client.js",
      );
      return {
        ...actual,
        eagerInitWalletConnectIfPersist: vi.fn(async () => {
          callOrder.push("eagerInitWalletConnect");
        }),
      };
    });
    vi.doMock("../src/wallet/non-evm-account-store.js", async () => {
      const actual = await vi.importActual<typeof import("../src/wallet/non-evm-account-store.js")>(
        "../src/wallet/non-evm-account-store.js",
      );
      return {
        ...actual,
        eagerInitNonEvmStoreIfPersist: vi.fn(async () => {
          callOrder.push("eagerInitNonEvm");
        }),
      };
    });

    // Import the module under test AFTER the mocks are in place so the
    // mocked dependencies bind.
    const { startServer } = await import("../src/server.js");

    await startServer();

    // The load-bearing assertions:
    expect(callOrder).toContain("eagerInitNonEvm");
    expect(callOrder).toContain("server.connect");
    const nonEvmIdx = callOrder.indexOf("eagerInitNonEvm");
    const connectIdx = callOrder.indexOf("server.connect");
    expect(nonEvmIdx).toBeLessThan(connectIdx);

    // Bonus assertion: both eager-inits run before connect.
    const wcIdx = callOrder.indexOf("eagerInitWalletConnect");
    expect(wcIdx).toBeLessThan(connectIdx);

    vi.doUnmock("../src/wallet/walletconnect-client.js");
    vi.doUnmock("../src/wallet/non-evm-account-store.js");
    vi.doUnmock("@modelcontextprotocol/sdk/server/index.js");
    vi.doUnmock("@modelcontextprotocol/sdk/server/stdio.js");
  });
});
