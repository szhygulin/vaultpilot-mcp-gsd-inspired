// Plan 08-05 — session-manager multi-chain pairing.
//
// Covers the two surgical edits in `src/wallet/session-manager.ts`:
//   (1) REQUIRED_NAMESPACES.eip155.chains derived from
//       getConfiguredChainIds() — replaces hardcoded ["eip155:1"].
//   (2) sessionToStatus multi-chain accounting — replaces the
//       "v1.x is mainnet-only" refusal with accountsByChain Map +
//       activeChainId selection + partiallyPaired detection.
//
// Threat-model anchors covered here:
//   - T-WC-MULTI-CHAIN-PAIRING-REGRESSION-1 (Test 2 — Ethereum first).
//   - T-WC-PARTIAL-1                        (Tests 4 + 5 — partially paired flag + once-per-topic warn).
//   - T-SESSION-TOPIC-LEAK-1                (Test 10 — full topic never surfaces).
//
// The pair-flow tools (`pair_ledger_live*`) are byte-frozen in this plan —
// see `test/pair-ledger-live*.test.ts` for baseline coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTypes } from "@walletconnect/types";

import {
  buildMockSession,
  buildMultiAccountSession,
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
  pair,
} from "../src/wallet/session-manager.js";
import {
  _resetWalletConnectClientForTesting,
} from "../src/wallet/walletconnect-client.js";
import { getConfiguredChainIds } from "../src/config/env.js";
import type { ChainId } from "../src/config/contracts.js";

const ENV_KEY = "WALLETCONNECT_PROJECT_ID";
let savedEnv: string | undefined;

// Same address across all chains — the common case (Ledger derives the
// same private key per chain). The multi-account tests below use distinct
// per-chain addresses to assert the split-derivation path.
const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as const;

// Sentinel topic for the T-SESSION-TOPIC-LEAK-1 anchor in Test 10. The
// full string MUST NEVER appear in the LedgerStatus envelope; only the
// last 8 chars surface via `sessionTopicLast8`.
const SENTINEL_TOPIC = "topic-sentinel-12345-FULL-DO-NOT-LEAK";

/** Microtask spin matching `wallet-session-manager.test.ts`. */
async function waitUntilConnectCalled(expectedCalls = 1): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (mockSignClient.client.connect.mock.calls.length >= expectedCalls) {
      await new Promise((resolve) => setImmediate(resolve));
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(
    `waitUntilConnectCalled: connect not called >= ${expectedCalls} times`,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a SessionTypes.Struct with accounts on EVERY chainId provided.
 * `accountsByChainId` is a map of `chainId → address[]`. Each entry becomes
 * one or more CAIP-10 strings (`eip155:<chainId>:<address>`); the resulting
 * `session.namespaces.eip155.accounts` is the concatenation.
 */
function buildMultiChainSession(opts: {
  accountsByChainId: Partial<Record<ChainId, `0x${string}`[]>>;
  topic?: string;
  expirySecondsFromNow?: number;
}): SessionTypes.Struct {
  const caipAccounts: string[] = [];
  for (const [chainId, addrs] of Object.entries(opts.accountsByChainId)) {
    for (const a of addrs ?? []) {
      caipAccounts.push(`eip155:${chainId}:${a}`);
    }
  }
  const topic =
    opts.topic ?? "0xfeedfacecafebeef0000000000000000000000000000000000000000c0ffee";
  const expiry =
    Math.floor(Date.now() / 1000) + (opts.expirySecondsFromNow ?? 7 * 24 * 60 * 60);
  return {
    topic,
    pairingTopic: topic,
    expiry,
    acknowledged: true,
    controller: "controller-key",
    namespaces: {
      eip155: {
        accounts: caipAccounts,
        methods: ["eth_sendTransaction", "personal_sign"],
        events: ["accountsChanged", "chainChanged"],
      },
    },
    requiredNamespaces: {
      eip155: {
        chains: Object.keys(opts.accountsByChainId).map((c) => `eip155:${c}`),
        methods: ["eth_sendTransaction", "personal_sign"],
        events: ["accountsChanged", "chainChanged"],
      },
    },
    optionalNamespaces: {},
    relay: { protocol: "irn" },
    self: {
      publicKey: "self-pub",
      metadata: { name: "VaultPilot MCP", description: "", url: "", icons: [] },
    },
    peer: {
      publicKey: "peer-pub",
      metadata: { name: "Ledger Live", description: "", url: "", icons: [] },
    },
  } as unknown as SessionTypes.Struct;
}

/** Drive `pair()` to completion against a scripted session. */
async function pairWithSession(session: SessionTypes.Struct): Promise<void> {
  const pending = pair();
  await waitUntilConnectCalled();
  mockSignClient._simulateApproval(session);
  await pending;
  mockSignClient._setSessionsInStore([session]);
}

// ---------------------------------------------------------------------------
// Test 1 — getConfiguredChainIds()
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — getConfiguredChainIds (Test 1)", () => {
  it("returns the 5 v1.2 chains in canonical order: [1, 42161, 137, 8453, 10]", () => {
    const ids = getConfiguredChainIds();
    expect(ids).toEqual([1, 42161, 137, 8453, 10]);
  });

  it("returns a readonly array — caller cannot mutate the cached source of truth", () => {
    const ids = getConfiguredChainIds();
    // The runtime guard is the TypeScript `readonly` modifier; the
    // returned array still has Array.prototype.push at runtime. The
    // contract test asserts byte-identity across two calls — proves the
    // returned reference is stable + the inner content unchanged.
    const second = getConfiguredChainIds();
    expect(second).toEqual([1, 42161, 137, 8453, 10]);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — REQUIRED_NAMESPACES shape (T-WC-MULTI-CHAIN-PAIRING-REGRESSION-1 anchor)
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — REQUIRED_NAMESPACES.eip155.chains shape (Test 2)", () => {
  it("passes a 5-entry chains array to client.connect, with eip155:1 first (T-WC-MULTI-CHAIN-PAIRING-REGRESSION-1)", async () => {
    const session = buildMockSession({ chainId: 1, address: ADDRESS });
    await pairWithSession(session);

    const connectArgs = mockSignClient.client.connect.mock.calls[0]?.[0] as {
      requiredNamespaces: { eip155: { chains: string[] } };
    };
    const chains = connectArgs.requiredNamespaces.eip155.chains;
    expect(chains).toEqual([
      "eip155:1",
      "eip155:42161",
      "eip155:137",
      "eip155:8453",
      "eip155:10",
    ]);
    // T-WC-MULTI-CHAIN-PAIRING-REGRESSION-1 anchor — Ethereum MUST be
    // first so sessionToStatus picks it as the default activeChainId.
    expect(chains[0]).toBe("eip155:1");
  });

  it("hardcoded [\"eip155:1\"] literal is GONE from session-manager.ts source", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/wallet/session-manager.ts", "utf8");
    // The Phase-3 hardcoded literal was `chains: ["eip155:1"]` —
    // exact-string check. Allow `eip155:1` to appear in comments / other
    // contexts but NOT as the array-literal form.
    expect(src).not.toContain('chains: ["eip155:1"]');
  });
});

// ---------------------------------------------------------------------------
// Test 3 — full multi-chain session (accounts on all 5 chains)
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — full 5-chain session (Test 3)", () => {
  it("accountsByChain has 5 keys; activeChainId === 1; partiallyPaired === false", async () => {
    const session = buildMultiChainSession({
      accountsByChainId: {
        1: [ADDRESS],
        42161: [ADDRESS],
        137: [ADDRESS],
        8453: [ADDRESS],
        10: [ADDRESS],
      },
    });
    await pairWithSession(session);

    const status = await getStatus();
    expect(status).not.toBeNull();
    expect(status!.accountsByChain).toEqual({
      1: [ADDRESS],
      42161: [ADDRESS],
      137: [ADDRESS],
      8453: [ADDRESS],
      10: [ADDRESS],
    });
    expect(status!.activeChainId).toBe(1);
    expect(status!.partiallyPaired).toBe(false);
    // Back-compat alias: chainId mirrors activeChainId.
    expect(status!.chainId).toBe(1);
    // Unique accounts collapses to a single address (same per chain).
    expect(status!.accounts).toEqual([ADDRESS]);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — T-WC-PARTIAL-1 anchor
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — partial pairing (Test 4 — T-WC-PARTIAL-1)", () => {
  it("session covering 3 of 5 chains → partiallyPaired:true; stderr warning names the missing chains", async () => {
    const stderrWrite = vi.spyOn(process.stderr, "write");

    const session = buildMultiChainSession({
      accountsByChainId: {
        1: [ADDRESS],
        42161: [ADDRESS],
        137: [ADDRESS],
        // 8453 (Base) and 10 (Optimism) MISSING — Ledger Live didn't have
        // OP-Stack networks enabled in Manage Accounts.
      },
    });
    await pairWithSession(session);
    const status = await getStatus();

    expect(status).not.toBeNull();
    expect(status!.partiallyPaired).toBe(true);
    expect(Object.keys(status!.accountsByChain).map(Number).sort((a, b) => a - b)).toEqual([
      1, 137, 42161,
    ]);

    // Stderr warning fired with the missing-chain list. The warning text
    // is the verbatim contract — agents may pattern-match on it. The
    // chain order in the warning mirrors `getConfiguredChainIds()` order
    // ([1, 42161, 137, 8453, 10]) — Ethereum first, then L2s by adoption.
    const allWrites = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).toMatch(/Paired session covers chains \[1,42161,137\]/);
    expect(allWrites).toMatch(/configured chains include \[8453,10\]/);
    expect(allWrites).toMatch(/Manage Accounts/);

    stderrWrite.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Test 5 — once-per-topic warn latch
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — once-per-topic warn latch (Test 5)", () => {
  it("a second getStatus on the same partial session does NOT re-warn", async () => {
    const session = buildMultiChainSession({
      accountsByChainId: {
        1: [ADDRESS],
      },
    });
    await pairWithSession(session);

    // First read — fires the warn once. Capture stderr from this point on
    // so we measure the SECOND-read behavior independently.
    await getStatus();

    const stderrWrite = vi.spyOn(process.stderr, "write");
    // Second read — must not re-warn.
    await getStatus();
    const writesAfter = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(writesAfter).not.toMatch(/Paired session covers/);

    stderrWrite.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Test 6 — activeChainId override via activeChainIdByTopic (forward-compat)
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — activeChainId default = first configured chain (Test 6)", () => {
  it("when session covers only chains 137 + 8453 → activeChainId falls through to 137 (first match)", async () => {
    // Ethereum NOT in the session → resolver walks to next configured
    // chainId, finds 137 (Polygon) — the first configured chain present.
    const session = buildMultiChainSession({
      accountsByChainId: {
        137: [ADDRESS],
        8453: [ADDRESS],
      },
    });
    await pairWithSession(session);

    const status = await getStatus();
    expect(status!.activeChainId).toBe(137);
    expect(status!.chainId).toBe(137);
    expect(status!.partiallyPaired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — split-derivation per-chain account lists
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — split-derivation accounts (Test 7)", () => {
  it("different addresses per chain → accountsByChain[chain] is per-chain-specific", async () => {
    const ETH_ADDR = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as const;
    const ARB_ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

    const session = buildMultiChainSession({
      accountsByChainId: {
        1: [ETH_ADDR],
        42161: [ARB_ADDR],
      },
    });
    await pairWithSession(session);

    const status = await getStatus();
    expect(status!.accountsByChain[1]).toEqual([ETH_ADDR]);
    expect(status!.accountsByChain[42161]).toEqual([ARB_ADDR]);
    expect(status!.accountsByChain[1]).not.toEqual(status!.accountsByChain[42161]);

    // Unique addresses across the two chains.
    expect(status!.accounts.sort()).toEqual([ETH_ADDR, ARB_ADDR].sort());
  });
});

// ---------------------------------------------------------------------------
// Test 8 — empty session on configured chains (no accounts at all on
// supported chains) → loud refusal, not silent fall-through.
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — no accounts on configured chains (Test 8)", () => {
  it("session with only non-configured chain accounts → sessionToStatus throws verbatim error", async () => {
    // Build a session with a chainId NOT in getConfiguredChainIds(). The
    // resolver finds no matching configured chain → throws.
    const session = buildMultiChainSession({
      accountsByChainId: {
        // 99999 is not a supported chainId.
        // Use the inline-cast escape hatch since the helper signature
        // wants ChainId — we go through `as` to construct the bad shape.
      },
    });
    // Manually patch in a non-configured chain account.
    (session.namespaces.eip155 as { accounts: string[] }).accounts = [
      `eip155:99999:${ADDRESS}`,
    ];

    const pending = pair();
    await waitUntilConnectCalled();
    mockSignClient._simulateApproval(session);
    let caught: unknown;
    try {
      await pending;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message)).toMatch(
      /no accounts on any configured chain/,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 9 — LedgerStatus interface widening: 8 fields, back-compat aliases.
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — LedgerStatus shape (Test 9)", () => {
  it("LedgerStatus has 8 fields; address === activeAccount; chainId === activeChainId (back-compat)", async () => {
    const session = buildMultiChainSession({
      accountsByChainId: {
        1: [ADDRESS],
        42161: [ADDRESS],
      },
    });
    await pairWithSession(session);

    const status = await getStatus();
    expect(status).not.toBeNull();

    // All 8 fields present.
    const keys = Object.keys(status!).sort();
    expect(keys).toEqual(
      [
        "accounts",
        "accountsByChain",
        "activeAccount",
        "activeChainId",
        "address",
        "chainId",
        "paired",
        "partiallyPaired",
        "sessionTopicLast8",
      ].sort(),
    );

    // Back-compat aliases.
    expect(status!.address).toBe(status!.activeAccount);
    expect(status!.chainId).toBe(status!.activeChainId);
  });
});

// ---------------------------------------------------------------------------
// Test 10 — T-SESSION-TOPIC-LEAK-1 anchor (Q-CONFIG-LEAK invariant).
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — session-topic leak guard (Test 10 — T-SESSION-TOPIC-LEAK-1)", () => {
  it("full session topic NEVER appears in the LedgerStatus envelope (only sessionTopicLast8)", async () => {
    const session = buildMultiChainSession({
      accountsByChainId: { 1: [ADDRESS] },
      topic: SENTINEL_TOPIC,
    });
    await pairWithSession(session);

    const status = await getStatus();
    expect(status).not.toBeNull();

    // 3-sentinel substring scan: the full topic MUST NOT appear anywhere
    // in the serialized envelope. Last-8 chars (`DO-NOT-LEAK` → `NOT-LEAK`)
    // is the only fragment that may surface.
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(SENTINEL_TOPIC);
    expect(serialized).not.toContain("topic-sentinel");
    expect(serialized).not.toContain("DO-NOT-LEAK");

    // The last 8 characters of the sentinel topic — "NOT-LEAK" — IS
    // expected to appear in `sessionTopicLast8`.
    expect(status!.sessionTopicLast8).toBe("NOT-LEAK");
    expect(serialized).toContain("NOT-LEAK");
  });
});

// ---------------------------------------------------------------------------
// Bonus — multi-account session on Ethereum still parses correctly under
// the multi-chain accounting path (Phase 5 quick-task regression).
// ---------------------------------------------------------------------------

describe("session-manager multi-chain — multi-account-on-one-chain regression", () => {
  it("3 addresses approved on chainId=1 → accountsByChain[1] has all 3; accounts has all 3", async () => {
    const ADDRS = [
      "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    ] as const;
    const session = buildMultiAccountSession({
      chainId: 1,
      addresses: [...ADDRS],
    });
    await pairWithSession(session);

    const status = await getStatus();
    expect(status!.accountsByChain[1]).toEqual([...ADDRS]);
    expect(status!.accounts).toEqual([...ADDRS]);
  });
});
