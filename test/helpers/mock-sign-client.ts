// Mock for `@walletconnect/sign-client` used across Phase 3 unit tests.
//
// This helper is the SINGLE SOURCE OF TRUTH for WalletConnect SDK mocking
// in Phase 3 — `test/wallet-walletconnect-client.test.ts`,
// `test/wallet-session-manager.test.ts`, `test/pair-ledger-live.test.ts`,
// and `test/get-ledger-status.test.ts` all consume it. Each test file
// declares its own `vi.mock("@walletconnect/sign-client", ...)` call (so a
// test can opt-out — e.g. a unit testing `parseEvmAccountId` directly
// doesn't need any SDK mocking) and uses `createMockSignClient()` from
// here to script the scenario.
//
// Mocking strategy reference: see 03-RESEARCH.md § Validation Architecture
// (line 440) — "vitest module-level mocking via vi.mock(...); the
// MockSignClient should expose a `_simulateApproval(session)` /
// `_simulateRejection(error)` / `_simulateTimeout()` API so each test
// scripts its scenario explicitly — avoids fragile timing."
//
// The mock never opens a real WSS connection; the `connect()` shim returns
// a Promise-of-deferred-Promise so the test drives approval resolution/
// rejection/timeout explicitly via the `_simulate*` methods.

import { vi } from "vitest";
import type { SessionTypes } from "@walletconnect/types";
import type { Hex } from "viem";

/**
 * A mocked `SignClient` instance plus a scenario-control API.
 *
 * Pass `client` as the resolved value of the mocked `SignClient.init` (in
 * each test file's `vi.mock("@walletconnect/sign-client", ...)`). Call
 * `_simulate*` BEFORE awaiting the operation under test — the approval
 * Promise returned from `connect()` will be resolved/rejected by whichever
 * `_simulate*` method was last called.
 *
 * Plan 04-01 extension (additive — Phase 3 API preserved verbatim): the
 * `client.request(...)` shim consults `_setRequestResponse(method, hash)` /
 * `_setRequestRejection(method, err)` maps so Phase 4's `send_transaction`
 * forwarding tests can script `eth_sendTransaction` responses without a
 * real WalletConnect relay. Every invocation is captured on `__requestSpy`
 * for call-arg assertions.
 */
export interface MockSignClient {
  /** Pretends to be a `SignClient` for the session-manager + walletconnect-client. */
  client: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    session: { getAll: ReturnType<typeof vi.fn> };
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
  };

  /** Resolve the pending `approval()` Promise with the given session. */
  _simulateApproval: (session: SessionTypes.Struct) => void;
  /** Reject the pending `approval()` Promise with the given error. */
  _simulateRejection: (err: { code?: number; message: string } | Error) => void;
  /**
   * Leave the pending `approval()` Promise pending forever. The production
   * `Promise.race` against a 60s budget (in `session-manager.pair()`) will
   * fire its timeout under vitest fake timers.
   */
  _simulateTimeout: () => void;
  /** Invoke any registered `session_delete` handler with `{ topic }`. */
  _simulateSessionDelete: (topic: string) => void;
  /** Replace the array returned by `client.session.getAll()`. */
  _setSessionsInStore: (sessions: SessionTypes.Struct[]) => void;

  // ----- Plan 04-01 extension (Phase 4 eth_sendTransaction scripting) -----

  /**
   * Script the value `signClient.request({ request: { method, ... } })`
   * resolves to. Resolution priority: rejection map > response map > default
   * "no scripted response" reject. Last-write wins for the same method.
   */
  _setRequestResponse: (method: string, hash: Hex) => void;
  /**
   * Script the error `signClient.request({ request: { method, ... } })`
   * rejects with. Wins over `_setRequestResponse` for the same method.
   */
  _setRequestRejection: (method: string, err: { code?: number; message: string }) => void;
  /** Spy capturing every `signClient.request(...)` invocation (for call-arg assertions). */
  __requestSpy: ReturnType<typeof vi.fn>;

  /**
   * The pairing URI returned from `connect()`. Defaults to a fixed test
   * value; override if a test needs to assert a custom URI shape.
   */
  _wcUri: string;
}

/**
 * Build a fresh `MockSignClient`. Each call returns a brand-new instance
 * with brand-new `vi.fn()` spies — call once per test file (or per
 * `beforeEach` if test cross-contamination is a concern).
 */
export function createMockSignClient(): MockSignClient {
  let sessionsInStore: SessionTypes.Struct[] = [];
  let resolveApproval: ((session: SessionTypes.Struct) => void) | undefined;
  let rejectApproval: ((err: unknown) => void) | undefined;
  const sessionDeleteHandlers: Array<(args: { topic: string }) => void> = [];

  // Plan 04-01 extension: per-method response/rejection maps for
  // `signClient.request(...)` scripting. Resolution priority on each call:
  //   1. rejection map (wins if set for the method)
  //   2. response map (returns the scripted hash)
  //   3. default reject so a missing setup fails loudly
  const requestResponses = new Map<string, Hex>();
  const requestRejections = new Map<string, { code?: number; message: string }>();
  const requestSpy = vi.fn(async (params: { topic: string; chainId: string; request: { method: string; params: unknown } }) => {
    const method = params?.request?.method;
    if (typeof method !== "string") {
      throw new Error("MockSignClient: signClient.request called without request.method");
    }
    const rejection = requestRejections.get(method);
    if (rejection) {
      throw rejection;
    }
    const response = requestResponses.get(method);
    if (response !== undefined) {
      return response;
    }
    throw new Error(`MockSignClient: no scripted response for method ${method}`);
  });

  const mock: MockSignClient = {
    client: {
      // Each connect() call hands back a fresh approval-Deferred so a single
      // mock can be used across multiple pair() invocations in one test
      // (e.g. the force: true disconnect-then-connect path). The deferred
      // is allocated on connect() invocation (not on approval() call) so
      // tests can drive resolution as soon as `pair()` has reached the
      // post-connect await — even if approval() hasn't been invoked yet,
      // resolveApproval/rejectApproval are stable references.
      connect: vi.fn(async (_opts: unknown) => {
        const approvalPromise = new Promise<SessionTypes.Struct>((resolve, reject) => {
          resolveApproval = resolve;
          rejectApproval = reject;
        });
        return {
          uri: mock._wcUri,
          approval: () => approvalPromise,
        };
      }),
      disconnect: vi.fn(async (_opts: unknown) => undefined),
      session: {
        getAll: vi.fn(() => sessionsInStore),
      },
      on: vi.fn((event: string, handler: (args: { topic: string }) => void) => {
        if (event === "session_delete") sessionDeleteHandlers.push(handler);
        return mock.client;
      }),
      off: vi.fn((event: string, handler: (args: { topic: string }) => void) => {
        if (event === "session_delete") {
          const idx = sessionDeleteHandlers.indexOf(handler);
          if (idx >= 0) sessionDeleteHandlers.splice(idx, 1);
        }
        return mock.client;
      }),
      request: requestSpy,
    },
    _simulateApproval: (session) => {
      if (!resolveApproval) {
        throw new Error(
          "_simulateApproval called before connect() — call pair() (or connect()) first, then simulate",
        );
      }
      resolveApproval(session);
      resolveApproval = undefined;
      rejectApproval = undefined;
    },
    _simulateRejection: (err) => {
      if (!rejectApproval) {
        throw new Error(
          "_simulateRejection called before connect() — call pair() (or connect()) first, then simulate",
        );
      }
      rejectApproval(err);
      resolveApproval = undefined;
      rejectApproval = undefined;
    },
    _simulateTimeout: () => {
      // Intentionally a no-op: the production code's Promise.race against a
      // 60s setTimeout fires the timeout under vitest fake timers. We leave
      // the approval Promise pending so the timer-side branch wins.
    },
    _simulateSessionDelete: (topic) => {
      for (const handler of sessionDeleteHandlers) handler({ topic });
    },
    _setSessionsInStore: (sessions) => {
      sessionsInStore = sessions;
    },
    _setRequestResponse: (method, hash) => {
      requestResponses.set(method, hash);
    },
    _setRequestRejection: (method, err) => {
      requestRejections.set(method, err);
    },
    __requestSpy: requestSpy,
    _wcUri: "wc:test-uri@2?relay-protocol=irn&symKey=deadbeef",
  };

  return mock;
}

/**
 * Build a minimal `SessionTypes.Struct` fixture with sane defaults. Override
 * any field via `opts`. Use this in tests that need a session payload to
 * pass to `_simulateApproval` or `_setSessionsInStore`.
 */
export function buildMockSession(opts: {
  chainId?: number;
  address?: `0x${string}`;
  topic?: string;
  expirySecondsFromNow?: number;
}): SessionTypes.Struct {
  return buildMultiAccountSession({
    chainId: opts.chainId,
    addresses: opts.address ? [opts.address] : undefined,
    topic: opts.topic,
    expirySecondsFromNow: opts.expirySecondsFromNow,
  });
}

/**
 * Build a `SessionTypes.Struct` with multiple eip155 accounts approved.
 * Used by `setActiveAccount` tests and any tool-layer test that needs to
 * exercise the multi-account-session code path (e.g. the `accounts`
 * surfacing in read tools, the active-account switching in `prepare_*`).
 *
 * Accounts default to three test addresses; override `addresses` for a
 * single-account fixture or for a different set.
 */
export function buildMultiAccountSession(opts: {
  chainId?: number;
  addresses?: `0x${string}`[];
  topic?: string;
  expirySecondsFromNow?: number;
} = {}): SessionTypes.Struct {
  const chainId = opts.chainId ?? 1;
  const addresses = opts.addresses ?? [
    "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  ];
  const topic = opts.topic ?? "0xfeedfacecafebeef0000000000000000000000000000000000000000c0ffee";
  const expiry = Math.floor(Date.now() / 1000) + (opts.expirySecondsFromNow ?? 7 * 24 * 60 * 60);
  return {
    topic,
    pairingTopic: topic,
    expiry,
    acknowledged: true,
    controller: "controller-key",
    namespaces: {
      eip155: {
        accounts: addresses.map((a) => `eip155:${chainId}:${a}`),
        methods: ["eth_sendTransaction", "personal_sign"],
        events: ["accountsChanged", "chainChanged"],
      },
    },
    requiredNamespaces: {
      eip155: {
        chains: [`eip155:${chainId}`],
        methods: ["eth_sendTransaction", "personal_sign"],
        events: ["accountsChanged", "chainChanged"],
      },
    },
    optionalNamespaces: {},
    relay: { protocol: "irn" },
    self: { publicKey: "self-pub", metadata: { name: "VaultPilot MCP", description: "", url: "", icons: [] } },
    peer: { publicKey: "peer-pub", metadata: { name: "Ledger Live", description: "", url: "", icons: [] } },
  } as unknown as SessionTypes.Struct;
}
