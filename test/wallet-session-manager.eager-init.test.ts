// End-to-end regression anchor for the eager-init bug fix.
//
// Bug: `.planning/debug/wc-session-persist-restart.md`. With persist mode,
// the user paired Ledger Live, restarted, and the first `get_ledger_status`
// returned "not paired" even though a session was on disk. Root cause: the
// session-manager's `getStatus()` short-circuits to `null` when
// `_isWalletConnectClientInitialized()` is `false` — the lazy-singleton
// hasn't been initialized yet on a cold boot, so the persisted session in
// SDK store is invisible until something else (typically `pair_ledger_live`)
// triggers init via `getWalletConnectClient()`.
//
// Fix: `startServer()` awaits `eagerInitWalletConnectIfPersist()` BEFORE
// connecting the transport. Under persist mode + projectId set, this loads
// the SignClient into memory at boot. The first `getStatus()` after eager
// init does NOT short-circuit — it walks `findLiveSession(client)` against
// the SDK store, returning the persisted session as expected.
//
// This file is the ANCHOR test — it threads eager-init → getStatus → paired
// to lock the user-facing bug behavior end-to-end. The
// `wallet-walletconnect-client.test.ts` file anchors the unit-level contract
// of `eagerInitWalletConnectIfPersist` (gates, idempotency, error handling).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMockSession,
  createMockSignClient,
  type MockSignClient,
} from "./helpers/mock-sign-client.js";

let mockSignClient: MockSignClient;
let initSpy: ReturnType<typeof vi.fn>;

vi.mock("@walletconnect/sign-client", () => {
  return {
    SignClient: {
      init: (...args: unknown[]) => initSpy(...args),
    },
  };
});

import {
  _resetSessionManagerForTesting,
  getStatus,
} from "../src/wallet/session-manager.js";
import {
  _isWalletConnectClientInitialized,
  _resetWalletConnectClientForTesting,
  _wcStorage,
  eagerInitWalletConnectIfPersist,
} from "../src/wallet/walletconnect-client.js";

const ENV_KEY = "WALLETCONNECT_PROJECT_ID";
const STORAGE_KEY = "VAULTPILOT_WC_STORAGE";
let savedEnv: string | undefined;
let savedStorageEnv: string | undefined;

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as const;
const TOPIC = "0xfeedfacecafebeef0000000000000000000000000000000000000000c0ffee";

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  savedStorageEnv = process.env[STORAGE_KEY];
  _resetWalletConnectClientForTesting();
  _resetSessionManagerForTesting();
  mockSignClient = createMockSignClient();
  initSpy = vi.fn(async () => mockSignClient.client);
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
  if (savedStorageEnv === undefined) delete process.env[STORAGE_KEY];
  else process.env[STORAGE_KEY] = savedStorageEnv;
  _resetWalletConnectClientForTesting();
  _resetSessionManagerForTesting();
  vi.restoreAllMocks();
});

describe("eager-init → getStatus visibility (end-to-end regression anchor)", () => {
  it("BUG REGRESSION: getStatus returns the persisted session WITHOUT a prior pair() call after eager-init runs", async () => {
    // Simulate the user's scenario:
    //   1. Prior MCP process paired Ledger Live → session persisted on disk.
    //   2. Current process boots; the WC SDK's init loads the persisted
    //      session into the in-memory store (the mock here pre-seeds it
    //      via _setSessionsInStore, mirroring what the real SDK does at
    //      init when fs-lite reads the persisted JSON).
    //   3. eagerInitWalletConnectIfPersist runs at startServer time.
    //   4. The FIRST tool call (e.g. get_ledger_status) calls getStatus().
    process.env[ENV_KEY] = "test-project-id";
    process.env[STORAGE_KEY] = "persist";
    vi.spyOn(_wcStorage, "ensureStorageDirWithPerms").mockImplementation(() => {
      /* no-op — keep the test off the user's home directory. */
    });
    // Seed the mock SDK's in-memory store with a session — this stands in
    // for the real SDK loading a persisted session from disk at init time.
    const persistedSession = buildMockSession({
      chainId: 1,
      address: ADDRESS,
      topic: TOPIC,
    });
    mockSignClient._setSessionsInStore([persistedSession]);

    // Pre-state: nothing has touched the SignClient singleton — the gate
    // would have short-circuited getStatus to null without the fix.
    expect(_isWalletConnectClientInitialized()).toBe(false);

    // The fix: eager init at boot.
    await eagerInitWalletConnectIfPersist();

    // Post-eager: client is initialized; getStatus walks the SDK store.
    expect(_isWalletConnectClientInitialized()).toBe(true);

    // The load-bearing assertion: getStatus returns the persisted session
    // WITHOUT any pair() call having been made. This is the bug fix.
    const status = await getStatus();
    expect(status).not.toBeNull();
    expect(status?.paired).toBe(true);
    expect(status?.address).toBe(ADDRESS);
    expect(status?.chainId).toBe(1);
    expect(status?.sessionTopicLast8).toBe(TOPIC.slice(-8));
  });

  it("BUG REGRESSION (counterfactual): without eager-init, getStatus short-circuits to null even when the SDK store has a session", async () => {
    // This counterfactual locks the bug's origin: even when the SDK store
    // contains the session, getStatus returns null because the
    // _isWalletConnectClientInitialized() short-circuit fires first. The
    // fix is to make sure the gate has flipped before the first status read
    // by eagerly initializing the client at boot.
    process.env[ENV_KEY] = "test-project-id";
    process.env[STORAGE_KEY] = "persist";
    const persistedSession = buildMockSession({
      chainId: 1,
      address: ADDRESS,
      topic: TOPIC,
    });
    mockSignClient._setSessionsInStore([persistedSession]);

    // Crucially, do NOT call eagerInitWalletConnectIfPersist here.

    expect(_isWalletConnectClientInitialized()).toBe(false);
    const status = await getStatus();
    // The short-circuit fires → null — even though a session is in the
    // store. This is the pre-fix behavior; the fix above replaces this
    // outcome with the paired status.
    expect(status).toBeNull();
    expect(initSpy).not.toHaveBeenCalled();
  });

  it("under memory mode, eager-init is a no-op + getStatus still short-circuits (correct lazy behavior preserved)", async () => {
    // Memory mode has no on-disk state to recover, so the lazy gate is
    // still correct. Eager-init skips memory mode silently; nothing breaks.
    process.env[ENV_KEY] = "test-project-id";
    process.env[STORAGE_KEY] = "memory";

    await eagerInitWalletConnectIfPersist();

    expect(initSpy).not.toHaveBeenCalled();
    expect(_isWalletConnectClientInitialized()).toBe(false);
    const status = await getStatus();
    expect(status).toBeNull();
  });

  it("without WALLETCONNECT_PROJECT_ID, eager-init is a no-op + does NOT throw at boot", async () => {
    // The auto-demo or no-Ledger user path. Eager init MUST NOT crash the
    // server when the user hasn't configured a project ID — they're using
    // demo personas + read-only tools and never reach the pair flow.
    process.env[STORAGE_KEY] = "persist";
    delete process.env[ENV_KEY];

    await expect(eagerInitWalletConnectIfPersist()).resolves.toBeUndefined();
    expect(initSpy).not.toHaveBeenCalled();
    expect(_isWalletConnectClientInitialized()).toBe(false);
  });
});
