import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockSignClient, type MockSignClient } from "./helpers/mock-sign-client.js";

// Per-test handle on the SignClient.init spy + the mock instance it
// returns. Re-bound in `beforeEach` so each test gets fresh state.
let mockSignClient: MockSignClient;
let initSpy: ReturnType<typeof vi.fn>;

// vi.mock is hoisted. We expose the per-test state via the closure-captured
// `initSpy` / `mockSignClient` accessors so tests can swap their behavior.
vi.mock("@walletconnect/sign-client", () => {
  return {
    SignClient: {
      init: (...args: unknown[]) => initSpy(...args),
    },
  };
});

import {
  MissingProjectIdError,
  _env,
  _resetWalletConnectClientForTesting,
  _isWalletConnectClientInitialized,
  _wcStorage,
  eagerInitWalletConnectIfPersist,
  getWalletConnectClient,
} from "../src/wallet/walletconnect-client.js";
import { parseEvmAccountId } from "../src/wallet/caip.js";

const ENV_KEY = "WALLETCONNECT_PROJECT_ID";
const STORAGE_KEY = "VAULTPILOT_WC_STORAGE";
let savedEnv: string | undefined;
let savedStorageEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  savedStorageEnv = process.env[STORAGE_KEY];
  delete process.env[ENV_KEY];
  // The global test setup pins VAULTPILOT_WC_STORAGE=memory. Individual
  // tests that need the persist branch override in their own beforeEach
  // (see "persist mode" describe block below).
  _resetWalletConnectClientForTesting();
  mockSignClient = createMockSignClient();
  initSpy = vi.fn(async () => mockSignClient.client);
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
  if (savedStorageEnv === undefined) delete process.env[STORAGE_KEY];
  else process.env[STORAGE_KEY] = savedStorageEnv;
  _resetWalletConnectClientForTesting();
  vi.restoreAllMocks();
});

describe("getWalletConnectClient", () => {
  it("throws MissingProjectIdError when WALLETCONNECT_PROJECT_ID is unset", async () => {
    await expect(getWalletConnectClient()).rejects.toBeInstanceOf(MissingProjectIdError);
    await expect(getWalletConnectClient()).rejects.toThrow(/WALLETCONNECT_PROJECT_ID/);
    await expect(getWalletConnectClient()).rejects.toThrow(/cloud\.walletconnect\.com/);
    // Pre-state check: init spy never invoked when env is unset.
    expect(initSpy).not.toHaveBeenCalled();
  });

  it("Test 8: under memory mode, calls SignClient.init with database=':memory:' + the log message names in-memory storage", async () => {
    process.env[ENV_KEY] = "test-project-id";
    process.env[STORAGE_KEY] = "memory";
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await getWalletConnectClient();
    expect(initSpy).toHaveBeenCalledTimes(1);
    // Asserts the pinned init options — these are the load-bearing
    // mitigations for T-WC-INIT-2 (stdout pollution) and the memory-mode
    // "fresh process = fresh pair" invariant.
    expect(initSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "test-project-id",
        logger: "error",
      }),
    );
    const opts = initSpy.mock.calls[0]?.[0] as { storageOptions: unknown };
    // toEqual on the storageOptions sub-object so a stray extra field
    // would fail the assertion (defends the storageOptions contract).
    expect(opts.storageOptions).toEqual({ database: ":memory:" });

    // Test 10 (memory arm): boot-log names the mode.
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrCalls).toMatch(/in-memory storage/);
  });

  it("Test 9 + Test 10 (persist arm): under persist mode, init receives an absolute path + ensureStorageDirWithPerms runs BEFORE init + log names persistent storage", async () => {
    process.env[ENV_KEY] = "test-project-id";
    process.env[STORAGE_KEY] = "persist";
    const ensureSpy = vi
      .spyOn(_wcStorage, "ensureStorageDirWithPerms")
      .mockImplementation(() => {
        /* no-op — do NOT actually mkdir under ~/. The test only needs the
         * call-order assertion. */
      });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await getWalletConnectClient();

    expect(initSpy).toHaveBeenCalledTimes(1);
    const opts = initSpy.mock.calls[0]?.[0] as { storageOptions: { database: string } };
    expect(opts.storageOptions.database).toMatch(/\/\.vaultpilot-mcp\/wc-storage$/);

    // ensureStorageDirWithPerms MUST have been called with the same path
    // BEFORE SignClient.init (vi.spyOn captures invocationCallOrder on the
    // mocked function; we assert ordering via the index property).
    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(ensureSpy).toHaveBeenCalledWith(opts.storageOptions.database);
    const ensureOrder = ensureSpy.mock.invocationCallOrder[0]!;
    const initOrder = initSpy.mock.invocationCallOrder[0]!;
    expect(ensureOrder).toBeLessThan(initOrder);

    // Test 10 (persist arm): boot-log names the path.
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrCalls).toMatch(/persistent storage at .*\.vaultpilot-mcp\/wc-storage/);
  });

  it("dedupes concurrent first-init calls into a single SignClient.init", async () => {
    process.env[ENV_KEY] = "test-project-id";
    const [a, b] = await Promise.all([getWalletConnectClient(), getWalletConnectClient()]);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("returns the cached instance on subsequent calls", async () => {
    process.env[ENV_KEY] = "test-project-id";
    const first = await getWalletConnectClient();
    const second = await getWalletConnectClient();
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(_isWalletConnectClientInitialized()).toBe(true);
  });
});

describe("eagerInitWalletConnectIfPersist — boot-time eager-init contract", () => {
  // Regression anchor for `.planning/debug/wc-session-persist-restart.md`.
  // Without eager-init, the lazy-singleton + getStatus() short-circuit
  // combination makes persisted sessions invisible to cold-boot status
  // reads until something else (typically pair_ledger_live) triggers
  // SignClient.init. These tests lock the eager-init contract end-to-end.

  it("(skip-arm-1) skips when WALLETCONNECT_PROJECT_ID is unset — does NOT call SignClient.init", async () => {
    // Default beforeEach already deletes the env var. No projectId → no
    // eager init, no MissingProjectIdError surfaced at the boot path
    // (lazy init still throws on the first pair_*; correct surface).
    await eagerInitWalletConnectIfPersist();
    expect(initSpy).not.toHaveBeenCalled();
    expect(_isWalletConnectClientInitialized()).toBe(false);
  });

  it("(skip-arm-2) skips when storage mode is 'memory' — does NOT call SignClient.init", async () => {
    process.env[ENV_KEY] = "test-project-id";
    process.env[STORAGE_KEY] = "memory";
    await eagerInitWalletConnectIfPersist();
    expect(initSpy).not.toHaveBeenCalled();
    expect(_isWalletConnectClientInitialized()).toBe(false);
  });

  it("(active) under persist mode with projectId set: calls SignClient.init eagerly", async () => {
    process.env[ENV_KEY] = "test-project-id";
    process.env[STORAGE_KEY] = "persist";
    vi.spyOn(_wcStorage, "ensureStorageDirWithPerms").mockImplementation(() => {
      /* no-op — keep the test off the user's home directory. */
    });

    await eagerInitWalletConnectIfPersist();

    expect(initSpy).toHaveBeenCalledTimes(1);
    // Critical regression assertion: after eager-init, the
    // `_isWalletConnectClientInitialized()` gate returns true. This is the
    // pre-state that makes getStatus()'s short-circuit fall through to a
    // real findLiveSession lookup, exposing persisted sessions to cold-boot
    // status reads. The `wallet-session-manager.eager-init.test.ts` file
    // anchors the end-to-end flow.
    expect(_isWalletConnectClientInitialized()).toBe(true);
  });

  it("(robustness) init failure during eager-init is caught — does NOT throw, logs warning", async () => {
    process.env[ENV_KEY] = "test-project-id";
    process.env[STORAGE_KEY] = "persist";
    vi.spyOn(_wcStorage, "ensureStorageDirWithPerms").mockImplementation(() => {
      /* no-op. */
    });
    initSpy = vi.fn(async () => {
      throw new Error("relay unreachable");
    });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // MUST NOT throw — server startup must continue even when WC backend
    // is unreachable. Lazy-init on first pair_* surfaces the real error.
    await expect(eagerInitWalletConnectIfPersist()).resolves.toBeUndefined();

    // Warning logged to stderr; the message names the failure mode so the
    // operator can diagnose without re-running with verbose logging.
    const stderrCalls = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrCalls).toMatch(/eager WalletConnect init failed/);
    expect(stderrCalls).toMatch(/relay unreachable/);
    expect(_isWalletConnectClientInitialized()).toBe(false);
  });

  it("(idempotent) safe to call multiple times — subsequent calls re-use cached client", async () => {
    process.env[ENV_KEY] = "test-project-id";
    process.env[STORAGE_KEY] = "persist";
    vi.spyOn(_wcStorage, "ensureStorageDirWithPerms").mockImplementation(() => {
      /* no-op. */
    });

    await eagerInitWalletConnectIfPersist();
    await eagerInitWalletConnectIfPersist();
    await eagerInitWalletConnectIfPersist();

    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it("(env-indirection) projectId resolved via the _env indirection — spies work across the ESM module boundary", async () => {
    // Lock the spy-affordance contract: production code reads projectId
    // through `_env.getWalletConnectProjectId()` (NOT the raw import).
    // Without this indirection, `vi.spyOn(_env, ...)` would be a no-op
    // because the imported binding is immutable (the canonical ESM
    // limitation — same shape as _wcStorage / _paths / _storage).
    process.env[STORAGE_KEY] = "persist";
    const envSpy = vi
      .spyOn(_env, "getWalletConnectProjectId")
      .mockReturnValue("spy-project-id");
    vi.spyOn(_wcStorage, "ensureStorageDirWithPerms").mockImplementation(() => {
      /* no-op. */
    });

    await eagerInitWalletConnectIfPersist();

    expect(envSpy).toHaveBeenCalled();
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(initSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "spy-project-id" }),
    );
  });
});

describe("parseEvmAccountId", () => {
  it("parses an eip155:1 account into numeric chainId + 0x address", () => {
    const result = parseEvmAccountId("eip155:1:0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D");
    expect(result).toEqual({
      chainId: 1,
      address: "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D",
    });
  });

  it("refuses non-eip155 namespaces with a message naming the unsupported prefix", () => {
    expect(() =>
      parseEvmAccountId("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:somepubkey"),
    ).toThrowError(/solana/i);
    expect(() =>
      parseEvmAccountId("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:somepubkey"),
    ).toThrowError(/eip155/i);
  });

  it("handles multi-digit chainIds (regression anchor for Phase 8 fan-out)", () => {
    // Arbitrum One — confirms `Number(chainId.split(':')[1])` handles
    // multi-digit chain ids. A future contributor who silently swaps to
    // `.slice(9, 10)` (single-char) would break this case.
    const result = parseEvmAccountId(
      "eip155:42161:0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D",
    );
    expect(result).toEqual({
      chainId: 42161,
      address: "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D",
    });
  });
});
