import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMockSession,
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
  ApprovalTimeoutError,
  PendingPairingError,
  UserRejectedPairingError,
  _resetSessionManagerForTesting,
  disconnect,
  getStatus,
  pair,
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
