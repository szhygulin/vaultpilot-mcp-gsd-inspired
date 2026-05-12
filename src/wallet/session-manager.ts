// WalletConnect session manager.
//
// Owns the "is there a paired Ledger right now?" question on behalf of the
// MCP tool layer. Wraps the lazy `SignClient` singleton from
// `walletconnect-client.ts` with:
//
//   - `pair({ force? })`: connect and race the WC `approval()` against a
//     60s timeout (PAIR-01). With an existing live session, returns the
//     cached one unless `force: true` (PAIR-05).
//   - `pairStart({ force? })`: phase-1 of the two-phase pairing flow —
//     calls `client.connect()`, surfaces the WC URI immediately, parks the
//     `approval` promise under a generated handle. Returns immediately.
//   - `pairWait(handle, timeoutMs?)`: phase-2 — retrieves the parked
//     `approval` promise and races it against a timeout. Returns
//     `LedgerStatus` once the user approves in Ledger Live.
//   - `getStatus()`: derive `{ address, chainId, sessionTopicLast8 }` from
//     the WC session store, filtering by `expiry > now` (T-WC-EXP-1).
//   - `disconnect(topic)`: tear down the named session.
//
// Concurrency rules (research § Pitfall 3): only one in-flight `pair()`
// at a time. Second `pair()` while one is pending → `PendingPairingError`.
// The two-phase flow (`pairStart`/`pairWait`) shares the same in-flight
// guard: a `pairStart` while one is already started but not yet resolved
// also throws `PendingPairingError`.
//
// Listener lifecycle: a single `session_delete` listener is registered on
// the SignClient the first time a session is observed. It clears the
// in-memory cache so a Ledger-side disconnect propagates back without
// requiring a poll. `_resetSessionManagerForTesting` clears the listener
// flag AND drops the cached session so test isolation works.

import type { SessionTypes } from "@walletconnect/types";
import { getSdkError } from "@walletconnect/utils";
import { type Address, getAddress } from "viem";

import { log } from "../diagnostics/logger.js";
import { parseEvmAccountId } from "./caip.js";
import { isUserRejectedError } from "./wc-errors.js";
import {
  _isWalletConnectClientInitialized,
  getWalletConnectClient,
  getWalletConnectClientOrNull,
} from "./walletconnect-client.js";

// Required namespaces declared on every pairing. Phase 4 inherits these
// methods without re-pairing. Phase 8 fans `eip155.chains` to a per-config
// list; until then mainnet-only is correct (the security model is
// "vertical-slice MVP: one chain, one signing flow, full security
// skeleton end-to-end").
// Note: NOT `as const` — the SDK's `ProposalTypes.RequiredNamespaces` index
// signature wants mutable `string[]` arrays. The constant is module-scoped
// and never mutated; the lack of `as const` here is a TS-strict
// concession, not an invitation to edit at runtime.
const REQUIRED_NAMESPACES: {
  eip155: { chains: string[]; methods: string[]; events: string[] };
} = {
  eip155: {
    chains: ["eip155:1"],
    methods: ["eth_sendTransaction", "personal_sign"],
    events: ["accountsChanged", "chainChanged"],
  },
};

const APPROVAL_TIMEOUT_MS = 60_000;

export interface LedgerStatus {
  paired: true;
  /**
   * Every approved account in the WC session, in the order the wallet
   * returned them. Default `activeAccount = accounts[0]` until
   * `setActiveAccount` swaps it.
   */
  accounts: Address[];
  /**
   * The account `prepare_*` uses as `from`. Equal to `accounts[0]` by
   * default; switched via `setActiveAccount(address)`. The Ledger screen
   * remains the trust anchor — this is a server-side convenience selector.
   */
  activeAccount: Address;
  /**
   * Alias for `activeAccount`. Retained so existing call sites compile
   * unchanged in Task 1; every internal read migrates to `activeAccount`
   * in Task 5.
   */
  address: Address;
  chainId: number;
  sessionTopicLast8: string;
}

export interface PairResult {
  /**
   * The pairing URI to surface to the user (paste into Ledger Live →
   * Settings → WalletConnect → Connect). Empty string when a cached live
   * session is returned without re-connecting.
   */
  wcUri: string;
  status: LedgerStatus;
}

/**
 * Result of `pairStart()`. The `wcUri` is surfaced to the agent immediately
 * so the user can paste it into Ledger Live. The `pairingHandle` is an
 * opaque token passed to `pairWait()` to collect the session once the user
 * approves.
 */
export interface PairStartResult {
  wcUri: string;
  pairingHandle: string;
}

export class ApprovalTimeoutError extends Error {
  constructor() {
    super(
      `Ledger Live did not approve the pairing within ${APPROVAL_TIMEOUT_MS / 1000}s. ` +
        "Re-call pair_ledger_live to retry; ensure Ledger Live is open and your Ledger app is unlocked.",
    );
    this.name = "ApprovalTimeoutError";
  }
}

export class UserRejectedPairingError extends Error {
  // We preserve the underlying WC error for downstream telemetry. `cause`
  // is the standard Error-chain field as of ES2022 and works under
  // TS strict mode without bespoke typing.
  public override readonly cause: unknown;
  constructor(cause: unknown) {
    super(
      "Pairing was rejected from Ledger Live. " +
        "Re-call pair_ledger_live to retry; ensure your Ledger app is open.",
    );
    this.name = "UserRejectedPairingError";
    this.cause = cause;
  }
}

export class PendingPairingError extends Error {
  constructor() {
    super(
      "A pairing approval is already in flight. " +
        "Wait for it to resolve/timeout, or call pair_ledger_live with { force: true } to cancel and restart.",
    );
    this.name = "PendingPairingError";
  }
}

/**
 * Thrown by `pairWait()` when the supplied handle is not found in the
 * in-flight store — either it was never created, it already resolved/timed
 * out, or `force: true` cleared it.
 */
export class InvalidPairingHandleError extends Error {
  constructor(handle: string) {
    super(
      `Pairing handle "${handle}" is not active. ` +
        "Call pair_ledger_live_start to obtain a fresh handle, then pair_ledger_live_wait with that handle.",
    );
    this.name = "InvalidPairingHandleError";
  }
}

// Module-scoped state. Cleared by `_resetSessionManagerForTesting`.
let inFlightApproval: Promise<PairResult> | undefined;
let cachedSessionTopic: string | undefined;
let sessionDeleteListenerRegistered = false;
/**
 * Active-account selector, keyed by WC session topic. `sessionToStatus`
 * consults this map and falls back to `accounts[0]` when unset. Entries
 * are cleared by `_resetSessionManagerForTesting` and by the
 * `session_delete` listener so a re-pair starts at the default again.
 */
const activeAccountByTopic = new Map<string, Address>();

/**
 * In-flight store for two-phase pairing. Maps pairingHandle → approval
 * settlement promise. A handle is added by `pairStart()` and removed once
 * `pairWait()` consumes it (success or error) or when `force: true` clears
 * state in a subsequent `pairStart()` / `pair()`.
 *
 * Invariant: at most ONE entry at a time (same single-in-flight constraint
 * as `inFlightApproval`). The guard is the shared `inFlightApproval` slot —
 * while a handle is parked, `inFlightApproval` is set; a second `pairStart`
 * will see a non-null `inFlightApproval` and throw `PendingPairingError`.
 */
const pendingHandles = new Map<string, Promise<LedgerStatus>>();

// Simple monotonic counter for handle generation. Prefixed with "wch-" so
// tests can assert the shape without pattern-matching raw hex or UUIDs.
let handleCounter = 0;

function generateHandle(): string {
  handleCounter += 1;
  return `wch-${handleCounter}-${Date.now()}`;
}

type WalletConnectClient = Awaited<ReturnType<typeof getWalletConnectClient>>;

/**
 * Initiate a pairing handshake with Ledger Live. Returns the WC pairing
 * URI plus the resulting `LedgerStatus` once approved.
 *
 * - `force: false` (default): if a live session already exists, return it
 *   immediately with an empty `wcUri`. Otherwise connect anew.
 * - `force: true`: disconnect any existing session first, then connect.
 *
 * Throws:
 * - `MissingProjectIdError` (from `getWalletConnectClient`) when
 *   `WALLETCONNECT_PROJECT_ID` is unset.
 * - `PendingPairingError` when a previous `pair()` is still awaiting
 *   approval.
 * - `ApprovalTimeoutError` after 60s without approval.
 * - `UserRejectedPairingError` when Ledger Live signals user rejection.
 */
export async function pair(
  { force = false }: { force?: boolean } = {},
): Promise<PairResult> {
  // Pending-approval check FIRST — even before client init. A second pair()
  // call while one is in flight should refuse immediately rather than
  // racing to init.
  if (!force && inFlightApproval) {
    throw new PendingPairingError();
  }

  const client = await getWalletConnectClient();
  await ensureSessionDeleteListener(client);

  if (force) {
    const existing = findLiveSession(client);
    if (existing) {
      await client.disconnect({
        topic: existing.topic,
        reason: getSdkError("USER_DISCONNECTED"),
      });
      if (cachedSessionTopic === existing.topic) cachedSessionTopic = undefined;
      activeAccountByTopic.delete(existing.topic);
    }
    // Clear any parked two-phase handle so a subsequent pairWait with a
    // stale handle gets InvalidPairingHandleError rather than resolving
    // against a disconnected approval promise.
    pendingHandles.clear();
  } else {
    const existing = findLiveSession(client);
    if (existing) {
      const status = sessionToStatus(existing);
      cachedSessionTopic = existing.topic;
      return { wcUri: "", status };
    }
  }

  // Stake the in-flight slot so a concurrent caller is refused with
  // PendingPairingError. We MUST set it before awaiting connect() so the
  // window during which a second call would slip through is closed.
  const operation = (async (): Promise<PairResult> => {
    const { uri, approval } = await client.connect({
      requiredNamespaces: REQUIRED_NAMESPACES,
    });
    if (!uri) {
      throw new Error("WalletConnect returned no URI; relay unreachable?");
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ApprovalTimeoutError()), APPROVAL_TIMEOUT_MS);
    });

    let session: SessionTypes.Struct;
    try {
      session = await Promise.race([approval(), timeoutPromise]);
    } catch (err) {
      // Wrap WC's user-rejected error in our domain error. The WC SDK
      // surfaces `{ code: 5000, message: "User rejected." }` per
      // SDK_ERRORS.USER_REJECTED (verified against
      // @walletconnect/utils@2.23.9 dist).
      if (isUserRejectedError(err)) {
        throw new UserRejectedPairingError(err);
      }
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const status = sessionToStatus(session);
    cachedSessionTopic = session.topic;
    return { wcUri: uri, status };
  })();

  inFlightApproval = operation;
  try {
    return await operation;
  } finally {
    inFlightApproval = undefined;
  }
}

/**
 * Phase-1 of the two-phase pairing flow.
 *
 * Calls `client.connect()` to obtain the WC pairing URI immediately, parks
 * the `approval` promise in the pending-handles store, and returns
 * `{ wcUri, pairingHandle }` without waiting for approval. The agent surfaces
 * `wcUri` to the user who pastes it into Ledger Live → Settings →
 * WalletConnect → Connect. The agent then calls `pairWait(pairingHandle)` to
 * block until the user approves.
 *
 * Guards:
 * - `force: false` (default): cached live session → returned with empty `wcUri`
 *   and a sentinel handle `"cached"`. `pairWait("cached")` will still
 *   produce `InvalidPairingHandleError`; the caller should use
 *   `get_ledger_status` instead when `wcUri` is empty (agent routing hint
 *   in the tool description).
 * - `force: true`: disconnects any existing session first, clears stale
 *   handles.
 * - Concurrent `pairStart` while an approval is in flight →
 *   `PendingPairingError`.
 *
 * Throws: `MissingProjectIdError`, `PendingPairingError`.
 */
export async function pairStart(
  { force = false }: { force?: boolean } = {},
): Promise<PairStartResult> {
  // Same in-flight guard as pair() — one approval at a time.
  if (!force && inFlightApproval) {
    throw new PendingPairingError();
  }

  const client = await getWalletConnectClient();
  await ensureSessionDeleteListener(client);

  if (force) {
    const existing = findLiveSession(client);
    if (existing) {
      await client.disconnect({
        topic: existing.topic,
        reason: getSdkError("USER_DISCONNECTED"),
      });
      if (cachedSessionTopic === existing.topic) cachedSessionTopic = undefined;
      activeAccountByTopic.delete(existing.topic);
    }
    pendingHandles.clear();
  } else {
    const existing = findLiveSession(client);
    if (existing) {
      const status = sessionToStatus(existing);
      cachedSessionTopic = existing.topic;
      // Return the cached-session sentinel so the tool layer can detect
      // "already paired" without a separate getStatus() round-trip.
      return { wcUri: "", pairingHandle: "cached" };
    }
  }

  // Call connect() — this does one relay round-trip and returns uri +
  // approval() immediately. The URI is available NOW; we must NOT await
  // approval() here.
  const { uri, approval } = await client.connect({
    requiredNamespaces: REQUIRED_NAMESPACES,
  });
  if (!uri) {
    throw new Error("WalletConnect returned no URI; relay unreachable?");
  }

  const handle = generateHandle();

  // Build the settlement promise and park it. The promise wraps approval()
  // with user-rejected detection and updates session state on success. It
  // does NOT apply its own timeout — the timeout belongs to pairWait() so
  // the agent controls the budget per call.
  const settlementPromise: Promise<LedgerStatus> = (async () => {
    let session: SessionTypes.Struct;
    try {
      session = await approval();
    } catch (err) {
      if (isUserRejectedError(err)) {
        throw new UserRejectedPairingError(err);
      }
      throw err;
    } finally {
      // Always clean up the handle so pairWait with a resolved/rejected
      // handle gets InvalidPairingHandleError on a second call.
      pendingHandles.delete(handle);
    }
    const status = sessionToStatus(session);
    cachedSessionTopic = session.topic;
    return status;
  })();

  // Suppress unhandled-rejection tracking on `settlementPromise` and on
  // the derived `pairResultProxy`. Both are stored but never directly
  // awaited by callers — callers go through `pairWait()` which races the
  // settlement promise. Without these noop catches, any rejection that fires
  // before `pairWait` is called (or after a timeout) becomes a Node.js
  // unhandled rejection even though the error will propagate correctly once
  // `pairWait` runs. Errors still reach callers through the race result.
  void settlementPromise.catch(() => {
    // Intentional noop — rejection surfaces via pairWait().
  });

  pendingHandles.set(handle, settlementPromise);

  // Stake the in-flight slot. It is released when settlementPromise settles.
  // `pairResultProxy` is only checked for truthiness (concurrent-call guard);
  // it is never awaited, so we suppress its rejection too.
  const pairResultProxy: Promise<PairResult> = settlementPromise.then(
    (status) => ({ wcUri: uri, status }),
  );
  void pairResultProxy.catch(() => {
    // Intentional noop — rejection surfaces via pairWait().
  });
  inFlightApproval = pairResultProxy;
  void settlementPromise.finally(() => {
    if (inFlightApproval === pairResultProxy) {
      inFlightApproval = undefined;
    }
  }).catch(() => {
    // Intentional noop — suppresses unhandled-rejection on the finally-derived promise.
  });

  log("info", `pairStart: URI obtained, handle=${handle}, awaiting user approval in Ledger Live`);

  return { wcUri: uri, pairingHandle: handle };
}

/**
 * Phase-2 of the two-phase pairing flow.
 *
 * Retrieves the parked `approval` promise for `handle` and races it against
 * a timeout (default: `APPROVAL_TIMEOUT_MS = 60s`). Returns `LedgerStatus`
 * once the user approves in Ledger Live.
 *
 * Throws:
 * - `InvalidPairingHandleError` if `handle` is not found (stale, already
 *   resolved, or never created).
 * - `ApprovalTimeoutError` if the user does not approve within `timeoutMs`.
 * - `UserRejectedPairingError` if the user rejects in Ledger Live.
 */
export async function pairWait(
  handle: string,
  timeoutMs: number = APPROVAL_TIMEOUT_MS,
): Promise<LedgerStatus> {
  const settlementPromise = pendingHandles.get(handle);
  if (!settlementPromise) {
    throw new InvalidPairingHandleError(handle);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApprovalTimeoutError()), timeoutMs);
  });

  try {
    return await Promise.race([settlementPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Return the current `LedgerStatus`, or `null` when no live session
 * exists. Returns `null` synchronously (well — via a resolved Promise)
 * WITHOUT triggering SignClient init when the client hasn't been
 * initialized yet — a status read for an unpaired session shouldn't
 * spend a relay round-trip.
 */
export async function getStatus(): Promise<LedgerStatus | null> {
  if (!_isWalletConnectClientInitialized()) return null;
  const client = await getWalletConnectClient();
  const live = findLiveSession(client);
  if (!live) return null;
  cachedSessionTopic = live.topic;
  return sessionToStatus(live);
}

/**
 * Return the topic of the currently-live WC session, or `null` when no
 * session OR when the SignClient singleton has not been initialized yet.
 *
 * Sync (no Promise wrapper) and side-effect-free: does NOT trigger
 * `SignClient.init` — short-circuits to `null` on uninitialized state, the
 * same shape `getStatus()` uses to avoid spending a relay handshake on a
 * pre-pair status read. The sync surface lets Plan 04-04's
 * `send_transaction` handler resolve the topic for `signClient.request`
 * without re-entering the async init path (which would race against the
 * already-running pair flow in concurrent-call scenarios).
 *
 * Q2 locked decision (research § Open Questions).
 */
export function getActiveSessionTopic(): string | null {
  if (!_isWalletConnectClientInitialized()) return null;
  const client = getWalletConnectClientOrNull();
  if (!client) return null;
  const session = findLiveSession(client);
  return session?.topic ?? null;
}

/**
 * Disconnect the named session and clear the in-memory cache. Idempotent
 * on the cache side; the underlying WC SDK may throw on no-such-topic but
 * we let that propagate to the caller (Phase 4's signing flow needs to
 * surface that as a structured error, not eat it).
 */
export async function disconnect(topic: string): Promise<void> {
  const client = await getWalletConnectClient();
  await client.disconnect({ topic, reason: getSdkError("USER_DISCONNECTED") });
  if (cachedSessionTopic === topic) cachedSessionTopic = undefined;
  activeAccountByTopic.delete(topic);
}

function findLiveSession(client: WalletConnectClient): SessionTypes.Struct | undefined {
  // Filter by `expiry > now()` per research § Pitfall 4 — WC's session
  // store can return disconnected/expired entries until the expirer fires
  // (monorepo issue #4484). The filter is authoritative, not the store.
  const nowSeconds = Math.floor(Date.now() / 1000);
  return client.session.getAll().find((s) => s.expiry > nowSeconds);
}

function sessionToStatus(session: SessionTypes.Struct): LedgerStatus {
  const caipAccounts = session.namespaces.eip155?.accounts;
  if (!caipAccounts || caipAccounts.length === 0 || caipAccounts[0] === undefined) {
    throw new Error(
      "paired session has no eip155 accounts; Ledger Live did not approve a wallet",
    );
  }
  // Parse every CAIP-10 entry and enforce a single chainId across them.
  // A multi-chain session would require Phase 8's chain-registry; v1.x is
  // mainnet-only and a mixed-chain session here is a sign that the
  // namespace negotiation is wrong.
  const parsed = caipAccounts.map((c) => parseEvmAccountId(c));
  const chainId = parsed[0]!.chainId;
  for (const entry of parsed) {
    if (entry.chainId !== chainId) {
      throw new Error(
        `paired session has accounts on multiple eip155 chains (${chainId} and ${entry.chainId}); v1.x is mainnet-only`,
      );
    }
  }
  const accounts = parsed.map((p) => p.address);
  const activeAccount =
    activeAccountByTopic.get(session.topic) ?? accounts[0]!;
  return {
    paired: true,
    accounts,
    activeAccount,
    // `address` is an alias for `activeAccount` retained for back-compat
    // through Task 5; remove once all callers migrate.
    address: activeAccount,
    chainId,
    sessionTopicLast8: session.topic.slice(-8),
  };
}

async function ensureSessionDeleteListener(client: WalletConnectClient): Promise<void> {
  if (sessionDeleteListenerRegistered) return;
  client.on("session_delete", ({ topic }) => {
    log("info", `walletconnect session_delete event for topic=${topic.slice(-8)}`);
    if (cachedSessionTopic === topic) cachedSessionTopic = undefined;
    activeAccountByTopic.delete(topic);
  });
  sessionDeleteListenerRegistered = true;
}

export function _resetSessionManagerForTesting(): void {
  inFlightApproval = undefined;
  cachedSessionTopic = undefined;
  sessionDeleteListenerRegistered = false;
  pendingHandles.clear();
  handleCounter = 0;
  activeAccountByTopic.clear();
}
