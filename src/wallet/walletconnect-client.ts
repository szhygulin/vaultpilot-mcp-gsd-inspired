// Lazy-singleton WalletConnect SignClient.
//
// Mirrors the shape of `src/chains/ethereum.ts` but with an async init
// (SignClient.init returns a Promise). Two non-negotiables, both pinned in
// `SignClient.init` options and asserted by tests:
//
//   1. `storageOptions: { database: <resolved> }` — selects the WC v2
//      session store. Default production mode is `"persist"`: an absolute
//      path under `~/.vaultpilot-mcp/wc-storage/` with `0o700` perms, so
//      the user does not re-pair Ledger Live every cold-boot. Opt-out
//      via `VAULTPILOT_WC_STORAGE=memory` restores the pre-v1.0.1
//      `:memory:` sentinel (fresh process = fresh pair). Mode is
//      selected once at SignClient.init and captured for the lifetime of
//      the singleton; a mode switch requires an MCP restart. The on-disk
//      path is a DIRECTORY (the SDK's fs-lite driver treats `database` as
//      a `{ base }` for one-key-per-file storage), not a single file —
//      see `src/config/wc-storage.ts` top-of-file for the SDK note.
//   2. `logger: "error"` — pino's default level for some WC versions writes
//      to stdout, which corrupts the MCP protocol. Pin it explicitly.

import { SignClient } from "@walletconnect/sign-client";

// The exported `SignClient` is a class — `InstanceType<typeof SignClient>`
// is its instance type (what `SignClient.init()` resolves to). We use this
// alias throughout so module mocks in tests (which substitute `init` with
// a `vi.fn` returning a mock) can be typed against the same interface.
type SignClientType = InstanceType<typeof SignClient>;

import { getWalletConnectProjectId } from "../config/env.js";
import {
  ensureStorageDirWithPerms,
  getWalletConnectStorageMode,
  getWalletConnectStoragePath,
} from "../config/wc-storage.js";
import { log } from "../diagnostics/logger.js";

/**
 * Spy-affordance indirection for the wc-storage helpers. Production code
 * calls `_wcStorage.ensureStorageDirWithPerms(...)` etc. instead of the
 * raw imports so `vi.spyOn(_wcStorage, "ensureStorageDirWithPerms")` works
 * across the ESM module boundary (same pattern as
 * `src/config/config-file.ts::_paths`).
 */
export const _wcStorage = {
  getWalletConnectStorageMode,
  getWalletConnectStoragePath,
  ensureStorageDirWithPerms,
};

const METADATA = {
  name: "VaultPilot MCP",
  description: "Self-custodial DeFi for AI agents",
  url: "https://github.com/szhygulin/vaultpilot-mcp",
  // Ledger Live tolerates empty icons; we deliberately don't host a public
  // icon URL in v1.x (one less dependency on a public CDN). Tracked as A4
  // in research § Assumptions Log; confirm at Phase 3 verify-phase.
  icons: [] as string[],
} as const;

let cachedClient: SignClientType | undefined;
let initInFlight: Promise<SignClientType> | undefined;

/**
 * Thrown when `WALLETCONNECT_PROJECT_ID` is unset or empty. We throw this
 * pre-state (i.e. BEFORE calling `SignClient.init`) so the second + any
 * subsequent calls get the same informative error rather than a cryptic
 * "client not initialized" surfaced from partial init state.
 *
 * The message names BOTH the env var AND the WC dashboard URL — tested by
 * `test/wallet-walletconnect-client.test.ts` to lock the contract.
 */
export class MissingProjectIdError extends Error {
  constructor() {
    super(
      "WALLETCONNECT_PROJECT_ID env var is not set. " +
        "Register a project at https://cloud.walletconnect.com to obtain one, then re-run with the env var set.",
    );
    this.name = "MissingProjectIdError";
  }
}

/**
 * Get the lazy-singleton `SignClient`. First call initializes; concurrent
 * first-calls share a single `initInFlight` Promise; subsequent calls after
 * resolution return the cached instance.
 *
 * Throws `MissingProjectIdError` when the env var is unset.
 */
export async function getWalletConnectClient(): Promise<SignClientType> {
  if (cachedClient) return cachedClient;
  if (initInFlight) return initInFlight;

  const projectId = getWalletConnectProjectId();
  if (!projectId) throw new MissingProjectIdError();

  initInFlight = (async () => {
    const storageMode = _wcStorage.getWalletConnectStorageMode();
    let database: string;
    if (storageMode === "memory") {
      database = ":memory:";
      log("info", "initializing WalletConnect sign-client (in-memory storage)");
    } else {
      database = _wcStorage.getWalletConnectStoragePath();
      _wcStorage.ensureStorageDirWithPerms(database);
      log(
        "info",
        `initializing WalletConnect sign-client (persistent storage at ${database})`,
      );
    }
    const client = await SignClient.init({
      projectId,
      metadata: METADATA,
      logger: "error",
      // `database` is the public-type field; the SDK resolves it to
      // `dbName` internally. `":memory:"` is the in-memory sentinel; any
      // other string is treated as a DIRECTORY path by the fs-lite driver.
      // See `src/config/wc-storage.ts` top-of-file for the SDK note.
      storageOptions: { database },
    });
    cachedClient = client;
    initInFlight = undefined;
    return client;
  })();

  return initInFlight;
}

/**
 * True iff the singleton has finished initializing at least once. Used by
 * the session-manager's `getStatus()` short-circuit so a status-read on an
 * unpaired session doesn't trigger a relay handshake.
 */
export function _isWalletConnectClientInitialized(): boolean {
  return cachedClient !== undefined;
}

/**
 * Synchronous accessor for the cached singleton. Returns `null` when init
 * has not yet completed (no `await` of `getWalletConnectClient()` has
 * resolved). Does NOT trigger initialization — read-only, side-effect-free.
 *
 * Used by `session-manager.getActiveSessionTopic()` (Plan 04-04 Q2 locked
 * decision) so the send-transaction handler can resolve the WC session
 * topic without re-entering the async init path. The async version
 * `getWalletConnectClient()` remains the canonical accessor for code that
 * needs to ensure the client is ready (e.g. `pair()`, `disconnect()`).
 */
export function getWalletConnectClientOrNull(): SignClientType | null {
  return cachedClient ?? null;
}

export function _resetWalletConnectClientForTesting(): void {
  cachedClient = undefined;
  initInFlight = undefined;
}
