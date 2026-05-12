// Lazy-singleton WalletConnect SignClient.
//
// Mirrors the shape of `src/chains/ethereum.ts` but with an async init
// (SignClient.init returns a Promise). Two non-negotiables, both pinned in
// `SignClient.init` options and asserted by tests:
//
//   1. `storageOptions: { database: ":memory:" }` — keeps the WC store off
//      disk so a fresh process always starts with a fresh pair (per the
//      security model: "fresh process = fresh pair"). Also prevents a
//      `walletconnect.db` file from appearing in `process.cwd()` of
//      whichever shell the user launched their MCP client from.
//   2. `logger: "error"` — pino's default level for some WC versions writes
//      to stdout, which corrupts the MCP protocol. Pin it explicitly.
//
// Note on `:memory:` plumbing: the public TS surface for
// `KeyValueStorageOptions` is `{ database?: string; table?: string }`. The
// internal storage constructor reads `opts.database || opts.table ||
// "walletconnect.db"` and passes that string as `dbName` to its inner Db
// (which is what triggers the `:memory:` sentinel branch). Therefore the
// dapp-side opt-in is `storageOptions: { database: ":memory:" }` — NOT
// `{ dbName: ":memory:" }` as some external WC sketches suggest (that
// shape silently falls through to the default `walletconnect.db` file).
// [Source: `@walletconnect/keyvaluestorage@2.x` runtime + type defs;
// confirmed against installed package 2.x via grep on the dist bundle.]

import { SignClient } from "@walletconnect/sign-client";

// The exported `SignClient` is a class — `InstanceType<typeof SignClient>`
// is its instance type (what `SignClient.init()` resolves to). We use this
// alias throughout so module mocks in tests (which substitute `init` with
// a `vi.fn` returning a mock) can be typed against the same interface.
type SignClientType = InstanceType<typeof SignClient>;

import { getWalletConnectProjectId } from "../config/env.js";
import { log } from "../diagnostics/logger.js";

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
    log("info", "initializing WalletConnect sign-client (in-memory storage)");
    const client = await SignClient.init({
      projectId,
      metadata: METADATA,
      logger: "error",
      // See top-of-file note on `:memory:` plumbing. `database` is the
      // public-type field; the SDK internally resolves it to `dbName` for
      // the `:memory:` sentinel check.
      storageOptions: { database: ":memory:" },
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

export function _resetWalletConnectClientForTesting(): void {
  cachedClient = undefined;
  initInFlight = undefined;
}
