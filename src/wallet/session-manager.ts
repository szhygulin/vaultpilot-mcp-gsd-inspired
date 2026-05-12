// WalletConnect session manager.
//
// Owns the "is there a paired Ledger right now?" question on behalf of the
// MCP tool layer. Wraps the lazy `SignClient` singleton from
// `walletconnect-client.ts` with:
//
//   - `pair({ force? })`: connect and race the WC `approval()` against a
//     60s timeout (PAIR-01). With an existing live session, returns the
//     cached one unless `force: true` (PAIR-05).
//   - `getStatus()`: derive `{ address, chainId, sessionTopicLast8 }` from
//     the WC session store, filtering by `expiry > now` (T-WC-EXP-1).
//   - `disconnect(topic)`: tear down the named session.
//
// Concurrency rules (research § Pitfall 3): only one in-flight `pair()`
// at a time. Second `pair()` while one is pending → `PendingPairingError`.
//
// Listener lifecycle: a single `session_delete` listener is registered on
// the SignClient the first time a session is observed. It clears the
// in-memory cache so a Ledger-side disconnect propagates back without
// requiring a poll. `_resetSessionManagerForTesting` clears the listener
// flag AND drops the cached session so test isolation works.

import type { SessionTypes } from "@walletconnect/types";
import { getSdkError } from "@walletconnect/utils";

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
  address: `0x${string}`;
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

// Module-scoped state. Cleared by `_resetSessionManagerForTesting`.
let inFlightApproval: Promise<PairResult> | undefined;
let cachedSessionTopic: string | undefined;
let sessionDeleteListenerRegistered = false;

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
    }
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
}

function findLiveSession(client: WalletConnectClient): SessionTypes.Struct | undefined {
  // Filter by `expiry > now()` per research § Pitfall 4 — WC's session
  // store can return disconnected/expired entries until the expirer fires
  // (monorepo issue #4484). The filter is authoritative, not the store.
  const nowSeconds = Math.floor(Date.now() / 1000);
  return client.session.getAll().find((s) => s.expiry > nowSeconds);
}

function sessionToStatus(session: SessionTypes.Struct): LedgerStatus {
  const accounts = session.namespaces.eip155?.accounts;
  if (!accounts || accounts.length === 0 || accounts[0] === undefined) {
    throw new Error(
      "paired session has no eip155 accounts; Ledger Live did not approve a wallet",
    );
  }
  const { chainId, address } = parseEvmAccountId(accounts[0]);
  return {
    paired: true,
    address,
    chainId,
    sessionTopicLast8: session.topic.slice(-8),
  };
}

async function ensureSessionDeleteListener(client: WalletConnectClient): Promise<void> {
  if (sessionDeleteListenerRegistered) return;
  client.on("session_delete", ({ topic }) => {
    log("info", `walletconnect session_delete event for topic=${topic.slice(-8)}`);
    if (cachedSessionTopic === topic) cachedSessionTopic = undefined;
  });
  sessionDeleteListenerRegistered = true;
}

export function _resetSessionManagerForTesting(): void {
  inFlightApproval = undefined;
  cachedSessionTopic = undefined;
  sessionDeleteListenerRegistered = false;
}
