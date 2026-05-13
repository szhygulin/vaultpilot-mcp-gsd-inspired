import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMockSession,
  buildMultiAccountSession,
  createMockSignClient,
  type MockSignClient,
} from "./helpers/mock-sign-client.js";

// Per-test handle on the SignClient.init spy + the mock instance. The
// outer closure-captured `mockSignClient` ref means production code that
// resolves the singleton sees the SAME mock the test scripts.
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
  AccountNotInSessionError,
  ApprovalTimeoutError,
  InvalidPairingHandleError,
  NotPairedError,
  PendingPairingError,
  UserRejectedPairingError,
  _resetSessionManagerForTesting,
  _storage,
  disconnect,
  getActiveSessionTopic,
  getStatus,
  pair,
  pairStart,
  pairWait,
  setActiveAccount,
} from "../src/wallet/session-manager.js";
import {
  _resetWalletConnectClientForTesting,
} from "../src/wallet/walletconnect-client.js";
import { parseEvmAccountId } from "../src/wallet/caip.js";

const ENV_KEY = "WALLETCONNECT_PROJECT_ID";
let savedEnv: string | undefined;

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as const;
// Topic ends in "00c0ffee" (last 8 chars) — used by status assertions.
const TOPIC = "0xfeedfacecafebeef0000000000000000000000000000000000000000c0ffee";

/**
 * Wait until production code has reached the `approval()` race — that is,
 * the mock's connect() spy has been called AT LEAST `expectedCalls` times.
 * Once connect() has been awaited, the mock has captured the deferred
 * resolver, so the test can call `_simulateApproval` / `_simulateRejection`.
 *
 * Using a microtask spin (rather than a fixed `await Promise.resolve()`
 * count) is resilient to depth changes in the production async stack.
 *
 * Real-timers only; for fake-timer tests use `vi.advanceTimersByTimeAsync`.
 */
async function waitUntilConnectCalled(expectedCalls = 1): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (mockSignClient.client.connect.mock.calls.length >= expectedCalls) {
      // One more flush so the connect()-returning Promise resolves and
      // approval() has been invoked, capturing the deferred.
      await new Promise((resolve) => setImmediate(resolve));
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(
    `waitUntilConnectCalled: connect not called >= ${expectedCalls} times after 50 microtask flushes`,
  );
}

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  process.env[ENV_KEY] = "test-project-id";
  _resetWalletConnectClientForTesting();
  _resetSessionManagerForTesting();
  mockSignClient = createMockSignClient();
  initSpy = vi.fn(async () => mockSignClient.client);
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
  _resetWalletConnectClientForTesting();
  _resetSessionManagerForTesting();
  vi.useRealTimers();
});

describe("session-manager.pair() — happy path + status (PAIR-01, PAIR-02)", () => {
  it("returns wcUri + LedgerStatus after approval (03-01-03)", async () => {
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    const result = await pending;
    expect(result.wcUri).toBe(mockSignClient._wcUri);
    expect(result.status).toEqual({
      paired: true,
      accounts: [ADDRESS],
      activeAccount: ADDRESS,
      address: ADDRESS,
      chainId: 1,
      sessionTopicLast8: "00c0ffee",
    });
  });

  it("returns ApprovalTimeoutError after 60s with no approval (03-01-04)", async () => {
    vi.useFakeTimers();
    const pending = pair();
    // Attach a catch handler immediately so the eventual rejection is
    // never seen by Node as "unhandled" — even though we will `await
    // expect(pending).rejects.…` below, that await binding happens AFTER
    // the rejection has already fired under fake timers.
    const settled = pending.catch((err) => err);
    // `advanceTimersByTimeAsync` flushes microtasks between ticks, so
    // connect() resolves and the 60s setTimeout is scheduled inside the
    // advancement; the same advancement then fires the timer.
    await vi.advanceTimersByTimeAsync(60_001);
    const err = await settled;
    expect(err).toBeInstanceOf(ApprovalTimeoutError);
  });

  it("wraps WC user-rejected error in UserRejectedPairingError (preserves cause)", async () => {
    const wcError = { code: 5000, message: "User rejected." };
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateRejection(wcError);
    let caught: unknown;
    try {
      await pending;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UserRejectedPairingError);
    expect((caught as UserRejectedPairingError).cause).toEqual(wcError);
  });

  it("getStatus returns the LedgerStatus after pair, parsed via parseEvmAccountId (03-01-05 paired)", async () => {
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;

    // Once paired, the WC session store should surface the session for
    // subsequent getStatus reads.
    mockSignClient._setSessionsInStore([session]);
    const status = await getStatus();
    expect(status).toEqual({
      paired: true,
      accounts: [ADDRESS],
      activeAccount: ADDRESS,
      address: ADDRESS,
      chainId: 1,
      sessionTopicLast8: "00c0ffee",
    });

    // Asserts parseEvmAccountId is the parse path — caip.ts wraps
    // parseAccountId from @walletconnect/utils; the manager's output
    // matches a direct call to parseEvmAccountId on the same CAIP-10 input.
    const parsed = parseEvmAccountId(`eip155:1:${ADDRESS}`);
    expect(status?.address).toBe(parsed.address);
    expect(status?.chainId).toBe(parsed.chainId);
  });

  it("getStatus returns null before pair, without triggering init (03-01-05 unpaired)", async () => {
    const status = await getStatus();
    expect(status).toBeNull();
    // The isClientInitialized() short-circuit fires before getWalletConnectClient
    // is invoked — so SignClient.init must NOT have been called.
    expect(initSpy).not.toHaveBeenCalled();
  });
});

describe("session-manager.pair() — cache + force (PAIR-05)", () => {
  it("reuses cached live session on second pair() without force (03-01-06)", async () => {
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;
    expect(mockSignClient.client.connect).toHaveBeenCalledTimes(1);

    // Subsequent pair() with the session in the store returns cached
    // without re-connecting; wcUri is empty per Pattern 2 sketch.
    mockSignClient._setSessionsInStore([session]);
    const result = await pair();
    expect(result.wcUri).toBe("");
    expect(result.status.address).toBe(ADDRESS);
    expect(mockSignClient.client.connect).toHaveBeenCalledTimes(1);
  });

  it("force=true disconnects existing BEFORE connecting new (03-01-07)", async () => {
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    // Seed first pair so the manager has a cached topic and the store
    // has the session.
    const first = pair();
    await waitUntilConnectCalled(1);
    mockSignClient._simulateApproval(session);
    await first;
    mockSignClient._setSessionsInStore([session]);
    expect(mockSignClient.client.connect).toHaveBeenCalledTimes(1);

    // Now force a re-pair. The fresh approval delivers a new session;
    // disconnect MUST be called before connect.
    const newSession = buildMockSession({
      chainId: 1,
      address: ADDRESS,
      topic: "0xaaaa000000000000000000000000000000000000000000000000000000feed99",
    });
    const second = pair({ force: true });
    await waitUntilConnectCalled(2);
    mockSignClient._simulateApproval(newSession);
    await second;

    // Call-order assertion: disconnect spy invoked before the SECOND
    // connect call. invocationCallOrder is global; lower number = earlier.
    const disconnectOrder = mockSignClient.client.disconnect.mock.invocationCallOrder[0];
    const connectOrders = mockSignClient.client.connect.mock.invocationCallOrder;
    expect(connectOrders).toHaveLength(2);
    expect(disconnectOrder).toBeDefined();
    expect(disconnectOrder!).toBeGreaterThan(connectOrders[0]!);
    expect(disconnectOrder!).toBeLessThan(connectOrders[1]!);

    // The disconnect call must carry the old topic + USER_DISCONNECTED.
    expect(mockSignClient.client.disconnect).toHaveBeenCalledWith({
      topic: session.topic,
      reason: expect.objectContaining({ code: 6000 }),
    });
  });
});

describe("session-manager.pair() — concurrency + lifecycle", () => {
  it("rejects a concurrent second pair() with PendingPairingError", async () => {
    const first = pair();
    // Wait until the first pair() has actually reached connect() and
    // staked inFlightApproval. Then a second concurrent call must refuse.
    await waitUntilConnectCalled();
    const second = pair();
    await expect(second).rejects.toBeInstanceOf(PendingPairingError);

    // Clean up the first so afterEach doesn't see a dangling Promise.
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    mockSignClient._simulateApproval(session);
    await first;
  });

  it("session_delete event drops the cached session (03-01-08)", async () => {
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;

    // Emit session_delete for the current topic AND clear the store —
    // the listener clears the cached topic; the store filter handles the
    // live-session check.
    mockSignClient._simulateSessionDelete(session.topic);
    mockSignClient._setSessionsInStore([]);
    const status = await getStatus();
    expect(status).toBeNull();
  });

  it("treats expired sessions in the store as unpaired (T-WC-EXP-1)", async () => {
    // Pair once so the singleton is initialized; immediately swap the
    // store to an expired session to force the filter to drop it.
    const liveSession = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(liveSession);
    await pending;

    const expired = buildMockSession({
      chainId: 1,
      address: ADDRESS,
      topic: TOPIC,
      expirySecondsFromNow: -10,
    });
    mockSignClient._setSessionsInStore([expired]);
    const status = await getStatus();
    expect(status).toBeNull();
  });

  it("disconnect(topic) tears down the session + clears the cache", async () => {
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;

    await disconnect(session.topic);
    expect(mockSignClient.client.disconnect).toHaveBeenCalledWith({
      topic: session.topic,
      reason: expect.objectContaining({ code: 6000 }),
    });

    mockSignClient._setSessionsInStore([]);
    const status = await getStatus();
    expect(status).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getActiveSessionTopic — Plan 04-04 Q2 locked decision (sync accessor for
// the send-transaction handler). Short-circuits on uninitialized state,
// returns the topic of the live session after pair, returns null after
// session_delete.
// ---------------------------------------------------------------------------
describe("session-manager.getActiveSessionTopic() — Plan 04-04 Q2", () => {
  it("returns null when the SignClient singleton has not been initialized", () => {
    // No prior `pair()` call — `_isWalletConnectClientInitialized()` is
    // false. The accessor must short-circuit WITHOUT triggering init,
    // otherwise a read on an unpaired session would burn a relay handshake.
    expect(getActiveSessionTopic()).toBeNull();
    // The init spy MUST NOT have fired — proves the short-circuit.
    expect(initSpy).not.toHaveBeenCalled();
  });

  it("returns the topic of the live session after a successful pair", async () => {
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;

    // After pair, the session is in the store with `expiry > now`. The
    // accessor walks the same `findLiveSession(client)` path `getStatus`
    // uses, returning the topic verbatim.
    mockSignClient._setSessionsInStore([session]);
    expect(getActiveSessionTopic()).toBe(TOPIC);
  });

  it("returns null after session_delete clears the store", async () => {
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;

    // Simulate Ledger-side disconnect — emit session_delete + drain the
    // store. The accessor's `findLiveSession` filter returns undefined;
    // accessor returns null.
    mockSignClient._simulateSessionDelete(session.topic);
    mockSignClient._setSessionsInStore([]);
    expect(getActiveSessionTopic()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pairStart + pairWait — two-phase pairing flow (bug fix for WC URI deadlock)
//
// Root cause: pair() awaits approval() before returning anything, meaning the
// wcUri that must reach the user is trapped until the 60s race resolves.
// Fix: pairStart() calls client.connect(), emits wcUri immediately, parks
// the approval promise under a handle. pairWait(handle) retrieves + races
// the parked promise against a timeout.
// ---------------------------------------------------------------------------
describe("session-manager.pairStart() — URI returned immediately, handle parked", () => {
  it("returns wcUri + a non-empty handle BEFORE approval fires", async () => {
    // pairStart MUST return before the approval deferred is resolved.
    // We DON'T call _simulateApproval before awaiting pairStart — if the
    // implementation awaited approval() inside pairStart, this would hang.
    const startPromise = pairStart();
    // Wait for connect() to be called so the mock captures the deferred.
    await waitUntilConnectCalled();
    const startResult = await startPromise;

    expect(startResult.wcUri).toBe(mockSignClient._wcUri);
    expect(startResult.pairingHandle).toMatch(/^wch-\d+-\d+$/);
    // connect() fired exactly once.
    expect(mockSignClient.client.connect).toHaveBeenCalledTimes(1);
  });

  it("pairWait(handle) returns LedgerStatus after approval", async () => {
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });

    const startPromise = pairStart();
    await waitUntilConnectCalled();
    const { pairingHandle } = await startPromise;

    // Approval fires AFTER pairStart returns — simulating the user pasting
    // the URI into Ledger Live and approving.
    const waitPromise = pairWait(pairingHandle);
    mockSignClient._simulateApproval(session);

    const status = await waitPromise;
    expect(status).toEqual({
      paired: true,
      accounts: [ADDRESS],
      activeAccount: ADDRESS,
      address: ADDRESS,
      chainId: 1,
      sessionTopicLast8: "00c0ffee",
    });
  });

  it("pairWait throws InvalidPairingHandleError for an unknown handle", async () => {
    await expect(pairWait("wch-0-bogus")).rejects.toBeInstanceOf(InvalidPairingHandleError);
  });

  it("pairWait throws ApprovalTimeoutError when budget elapses with no approval", async () => {
    // Use fake timers. pairStart itself calls client.connect() which is an
    // async mock — it resolves via a microtask (not a timer), so
    // advanceTimersByTimeAsync will flush it before the 60s timer fires.
    // We do NOT use waitUntilConnectCalled here because setImmediate is
    // also mocked under fake timers; advanceTimersByTimeAsync drives both.
    vi.useFakeTimers();

    const startPromise = pairStart();
    // Advance enough for connect() to resolve (microtask) and for pairStart
    // to return. A tiny advancement flushes microtasks.
    await vi.advanceTimersByTimeAsync(1);
    const { pairingHandle } = await startPromise;

    const waitPromise = pairWait(pairingHandle, 60_000);
    // Attach catch so the rejection doesn't surface as unhandled while we
    // advance fake timers.
    const settled = waitPromise.catch((err) => err);
    await vi.advanceTimersByTimeAsync(60_001);

    const err = await settled;
    expect(err).toBeInstanceOf(ApprovalTimeoutError);
  });

  it("pairWait wraps WC user-rejected in UserRejectedPairingError", async () => {
    const wcError = { code: 5000, message: "User rejected." };

    const startPromise = pairStart();
    await waitUntilConnectCalled();
    const { pairingHandle } = await startPromise;

    const waitPromise = pairWait(pairingHandle);
    mockSignClient._simulateRejection(wcError);

    let caught: unknown;
    try {
      await waitPromise;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UserRejectedPairingError);
    expect((caught as UserRejectedPairingError).cause).toEqual(wcError);
  });

  it("pairStart reuses cached live session, returns wcUri '' + handle 'cached'", async () => {
    // Warm up the WalletConnect client by completing a real pair() first
    // (no session in store yet — pair() will call connect()).
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const first = pair();
    await waitUntilConnectCalled(1);
    mockSignClient._simulateApproval(session);
    await first;

    // Now seed the session store so findLiveSession() returns it.
    mockSignClient._setSessionsInStore([session]);

    // Reset connect spy count so the assertion below is relative to this
    // pairStart() call only.
    mockSignClient.client.connect.mockClear();

    // pairStart() should see the live session and short-circuit.
    const result = await pairStart();
    expect(result.wcUri).toBe("");
    expect(result.pairingHandle).toBe("cached");
    // connect() must NOT be called when returning cached session.
    expect(mockSignClient.client.connect).toHaveBeenCalledTimes(0);
  });

  it("second pairStart() while one is in flight throws PendingPairingError", async () => {
    const first = pairStart();
    await waitUntilConnectCalled();
    await expect(pairStart()).rejects.toBeInstanceOf(PendingPairingError);

    // Clean up.
    const { pairingHandle } = await first;
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const waitPromise = pairWait(pairingHandle);
    mockSignClient._simulateApproval(session);
    await waitPromise;
  });

  it("force:true on pairStart clears stale handle before re-connecting", async () => {
    // Start phase-1. Do NOT resolve the approval — we want a stale handle.
    const firstStartPromise = pairStart();
    await waitUntilConnectCalled(1);
    const { pairingHandle: oldHandle } = await firstStartPromise;

    // Force a new pairStart. This clears pendingHandles and reconnects.
    // The inFlightApproval is also held by the first start's pairResultProxy,
    // but force: true bypasses the pending check and calls disconnect first.
    const freshStart = pairStart({ force: true });
    await waitUntilConnectCalled(2);
    const { pairingHandle: newHandle } = await freshStart;

    // Old handle should be gone.
    await expect(pairWait(oldHandle)).rejects.toBeInstanceOf(InvalidPairingHandleError);

    // New handle resolves normally.
    const newSession = buildMockSession({
      chainId: 1,
      address: ADDRESS,
      topic: "0xaaaa000000000000000000000000000000000000000000000000000000feed99",
    });
    const waitNew = pairWait(newHandle);
    mockSignClient._simulateApproval(newSession);
    const status = await waitNew;
    expect(status.paired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-account session parsing + setActiveAccount — fix for the bug where
// `sessionToStatus` only surfaced `accounts[0]` and there was no way to
// switch which approved address `prepare_*` uses without re-pairing.
// ---------------------------------------------------------------------------
const MULTI_ACCOUNTS = [
  "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
] as const;

describe("session-manager — multi-account session parsing", () => {
  it("(a) parsed `accounts` contains all three approved addresses in order", async () => {
    const session = buildMultiAccountSession({
      chainId: 1,
      addresses: [...MULTI_ACCOUNTS],
      topic: TOPIC,
    });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    const result = await pending;
    expect(result.status.accounts).toEqual([...MULTI_ACCOUNTS]);
  });

  it("(b) `activeAccount === accounts[0]` by default", async () => {
    const session = buildMultiAccountSession({
      chainId: 1,
      addresses: [...MULTI_ACCOUNTS],
      topic: TOPIC,
    });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    const result = await pending;
    expect(result.status.activeAccount).toBe(MULTI_ACCOUNTS[0]);
    expect(result.status.address).toBe(MULTI_ACCOUNTS[0]);
  });
});

describe("session-manager.setActiveAccount() — happy path + error classes", () => {
  it("(c) happy path: switching to a non-first address persists across getStatus()", async () => {
    const session = buildMultiAccountSession({
      chainId: 1,
      addresses: [...MULTI_ACCOUNTS],
      topic: TOPIC,
    });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;
    mockSignClient._setSessionsInStore([session]);

    const switched = await setActiveAccount(MULTI_ACCOUNTS[1]);
    expect(switched.activeAccount).toBe(MULTI_ACCOUNTS[1]);
    expect(switched.address).toBe(MULTI_ACCOUNTS[1]); // alias mirrors active
    expect(switched.accounts).toEqual([...MULTI_ACCOUNTS]);

    // Persistence: a subsequent getStatus() returns the same active account.
    const re = await getStatus();
    expect(re?.activeAccount).toBe(MULTI_ACCOUNTS[1]);
  });

  it("(c2) accepts lowercase / checksum-insensitive input", async () => {
    const session = buildMultiAccountSession({
      chainId: 1,
      addresses: [...MULTI_ACCOUNTS],
      topic: TOPIC,
    });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;
    mockSignClient._setSessionsInStore([session]);

    const lowered = MULTI_ACCOUNTS[1].toLowerCase() as `0x${string}`;
    const switched = await setActiveAccount(lowered);
    // Normalized back to checksummed form.
    expect(switched.activeAccount).toBe(MULTI_ACCOUNTS[1]);
  });

  it("(d) unknown address throws AccountNotInSessionError carrying the in-session list", async () => {
    const session = buildMultiAccountSession({
      chainId: 1,
      addresses: [...MULTI_ACCOUNTS],
      topic: TOPIC,
    });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;
    mockSignClient._setSessionsInStore([session]);

    const stranger = "0x0000000000000000000000000000000000000001";
    let caught: unknown;
    try {
      await setActiveAccount(stranger);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AccountNotInSessionError);
    expect((caught as AccountNotInSessionError).requested).toBe(stranger);
    expect((caught as AccountNotInSessionError).accounts).toEqual([
      ...MULTI_ACCOUNTS,
    ]);
  });

  it("throws NotPairedError when no live session exists", async () => {
    // No prior pair() — the session store is empty. setActiveAccount
    // surfaces NotPairedError so the tool layer can map to WALLET_NOT_PAIRED.
    mockSignClient._setSessionsInStore([]);
    await expect(setActiveAccount(MULTI_ACCOUNTS[0])).rejects.toBeInstanceOf(
      NotPairedError,
    );
  });

  it("(e) _resetSessionManagerForTesting clears activeAccountByTopic", async () => {
    const session = buildMultiAccountSession({
      chainId: 1,
      addresses: [...MULTI_ACCOUNTS],
      topic: TOPIC,
    });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;
    mockSignClient._setSessionsInStore([session]);

    await setActiveAccount(MULTI_ACCOUNTS[2]);
    let status = await getStatus();
    expect(status?.activeAccount).toBe(MULTI_ACCOUNTS[2]);

    // Reset clears the selector map; a fresh getStatus against the same
    // session falls back to accounts[0].
    _resetSessionManagerForTesting();
    // Re-seed the store after reset (the reset clears caching state but
    // the mock's session store is independent).
    mockSignClient._setSessionsInStore([session]);
    status = await getStatus();
    expect(status?.activeAccount).toBe(MULTI_ACCOUNTS[0]);
  });

  it("session_delete listener clears the active-account selection", async () => {
    const session = buildMultiAccountSession({
      chainId: 1,
      addresses: [...MULTI_ACCOUNTS],
      topic: TOPIC,
    });
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;
    mockSignClient._setSessionsInStore([session]);

    await setActiveAccount(MULTI_ACCOUNTS[1]);
    expect((await getStatus())?.activeAccount).toBe(MULTI_ACCOUNTS[1]);

    // Simulate the wallet dropping the session. The store filter handles
    // the live-session check, but our cleanup must drop the selection so
    // a future re-pair on the same topic doesn't surface a stale active.
    mockSignClient._simulateSessionDelete(session.topic);
    // Re-seed the store with the SAME session (acting as a fresh re-pair
    // before the wallet has re-emitted via approval). The selection must
    // have been cleared so we read accounts[0] again.
    mockSignClient._setSessionsInStore([session]);
    const status = await getStatus();
    expect(status?.activeAccount).toBe(MULTI_ACCOUNTS[0]);
  });
});

// ---------------------------------------------------------------------------
// Quick-260513-c8e — force-re-pair MUST clear the on-disk persisted store
// (issue #25 acceptance #5). The aggressive read: `force: true` always calls
// clearPersistedStorage, irrespective of whether a live `existing` session
// is present. Both pair() and pairStart() force branches participate.
// ---------------------------------------------------------------------------
describe("session-manager.pair({ force: true }) — clears persisted on-disk store", () => {
  it("Test 11: calls clearPersistedStorage BEFORE client.disconnect when an existing live session is present", async () => {
    // Seed an existing live session.
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const first = pair();
    await waitUntilConnectCalled(1);
    mockSignClient._simulateApproval(session);
    await first;
    mockSignClient._setSessionsInStore([session]);

    // Spy on the production storage indirection so we can assert the call
    // shape AND the call-order against client.disconnect.
    const clearSpy = vi.spyOn(_storage, "clearPersistedStorage").mockResolvedValue();

    // Force a re-pair.
    const newSession = buildMockSession({
      chainId: 1,
      address: ADDRESS,
      topic: "0xaaaa000000000000000000000000000000000000000000000000000000feed99",
    });
    const second = pair({ force: true });
    await waitUntilConnectCalled(2);
    mockSignClient._simulateApproval(newSession);
    await second;

    // clearPersistedStorage was invoked exactly once.
    expect(clearSpy).toHaveBeenCalledTimes(1);
    // …and BEFORE client.disconnect — invocationCallOrder is a global
    // monotonic counter; lower index = earlier call.
    const clearOrder = clearSpy.mock.invocationCallOrder[0]!;
    const disconnectOrder =
      mockSignClient.client.disconnect.mock.invocationCallOrder[0]!;
    expect(clearOrder).toBeLessThan(disconnectOrder);
  });

  it("Test 12: pairStart({ force: true }) calls clearPersistedStorage BEFORE client.disconnect", async () => {
    // Seed an existing live session (via pair() so the singleton is warm).
    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const first = pair();
    await waitUntilConnectCalled(1);
    mockSignClient._simulateApproval(session);
    await first;
    mockSignClient._setSessionsInStore([session]);

    const clearSpy = vi.spyOn(_storage, "clearPersistedStorage").mockResolvedValue();

    // Force a phase-1 re-start. We do NOT need to resolve the approval —
    // pairStart returns once connect() resolves. The clear / disconnect
    // both fire in the force branch BEFORE connect().
    const startPromise = pairStart({ force: true });
    await waitUntilConnectCalled(2);
    await startPromise;

    expect(clearSpy).toHaveBeenCalledTimes(1);
    const clearOrder = clearSpy.mock.invocationCallOrder[0]!;
    const disconnectOrder =
      mockSignClient.client.disconnect.mock.invocationCallOrder[0]!;
    expect(clearOrder).toBeLessThan(disconnectOrder);
  });

  it("Test 13: pair({ force: true }) does NOT throw when no live session exists (clearPersistedStorage no-op arm)", async () => {
    // No prior pair — store is empty. clearPersistedStorage's `rm({ force: true })`
    // makes the directory-does-not-exist case a silent no-op.
    const clearSpy = vi.spyOn(_storage, "clearPersistedStorage").mockResolvedValue();

    const session = buildMockSession({ chainId: 1, address: ADDRESS, topic: TOPIC });
    const pending = pair({ force: true });
    await waitUntilConnectCalled(1);
    mockSignClient._simulateApproval(session);
    await expect(pending).resolves.toBeDefined();

    // Even without `existing`, the unconditional-clear branch fires.
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Quick-260513-c8e — post-restart resume (issue #25 acceptance #1 + #2).
// A fresh process whose SignClient deserializes a live session from the WC
// store must return paired:true via getStatus() WITHOUT a pair() call. And
// activeAccount === accounts[0] regardless of pre-restart selection
// (activeAccountByTopic is an in-memory map — cold-boot starts empty).
// ---------------------------------------------------------------------------
describe("session-manager — post-restart resume (#25 acceptance #1 + #2)", () => {
  it("Test 16: getStatus returns paired:true + activeAccount===accounts[0] for a session arriving from the (mocked) store without a prior pair()", async () => {
    // Simulate "the persisted WC store deserialized into a live session at
    // boot": warm the SignClient singleton WITHOUT going through pair(), by
    // calling getActiveSessionTopic which short-circuits when uninitialized
    // and so won't help. Instead, prime via a single pair() — _resetSessionManagerForTesting
    // clears activeAccountByTopic but DOES NOT clear the SignClient singleton.
    // Then drop the in-memory selector via _resetSessionManagerForTesting to
    // simulate the cold-boot state, and re-seed the store with the live session.
    const session = buildMultiAccountSession({
      chainId: 1,
      addresses: [...MULTI_ACCOUNTS],
      topic: TOPIC,
    });

    // Phase A: warm pair() so the singleton is initialized.
    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    await pending;

    // Phase B: pre-restart selection — user switched to a non-default account.
    mockSignClient._setSessionsInStore([session]);
    await setActiveAccount(MULTI_ACCOUNTS[2]);
    expect((await getStatus())?.activeAccount).toBe(MULTI_ACCOUNTS[2]);

    // Phase C: simulate process restart by clearing the session-manager
    // module state. The WC client singleton (and the mocked session store)
    // survive — they're the analogue of "persisted state deserialized at
    // boot."
    _resetSessionManagerForTesting();
    mockSignClient._setSessionsInStore([session]);

    // Phase D: a fresh getStatus() call after "cold boot" — activeAccount
    // falls back to accounts[0] because activeAccountByTopic is empty.
    const status = await getStatus();
    expect(status).not.toBeNull();
    expect(status?.paired).toBe(true);
    expect(status?.accounts).toEqual([...MULTI_ACCOUNTS]);
    expect(status?.activeAccount).toBe(MULTI_ACCOUNTS[0]);
  });
});
