// `prepare_tron_stake_vote` end-to-end regression. Phase 19 — Plan 19-03.
//
// Load-bearing invariants:
//
//   1. **Fixture Tron-19-C consumer re-anchor** — the canonical Fixture Tron-19-C
//      inputs produce the hardcoded literal fingerprint pinned in
//      `test/signing-fingerprint-tron-19.test.ts`. Drift in this tool's
//      preimage assembly surfaces HERE — load-bearing redundancy per CLAUDE.md
//      fixture discipline + CONTEXT D-08c.
//
//   2. **INVALID_INPUT FIRST** — empty votes array and duplicate srAddress
//      both surface as INVALID_INPUT before any state read.
//
//   3. **kind = "stake-vote"** in PreparedTxTron — verified in structuredContent.
//
//   4. **D-05c advisory labels** — SR labels from registry are advisory;
//      on-device vote_address is the trust anchor (not tested here — label
//      content is advisory-only in structuredContent.votes[*].label).
//
//   5. **srSource surfaces in structuredContent** — per D-05b.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy, createHandleSpy, _actualCreateHandleHolder } = vi.hoisted(() => {
  // _actualCreateHandleHolder is a mutable container so vi.mock factory can populate it
  // and beforeEach can re-apply after vi.restoreAllMocks() clears the spy implementation.
  const _actualCreateHandleHolder = { fn: undefined as typeof import("../src/signing/handle-store.js").createHandle | undefined };
  return {
    listAccountsSpy: vi.fn(),
    createHandleSpy: vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
    _actualCreateHandleHolder,
  };
});

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) =>
      listAccountsSpy(...args),
  };
});

vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  _actualCreateHandleHolder.fn = actual.createHandle;
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (...args: Parameters<typeof actual.createHandle>) =>
      createHandleSpy(...args),
  };
});

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveTronPersonaBySlug,
} from "../src/demo/state.js";
import { _tronVote } from "../src/protocols/tron-vote.js";
import { _tronSrRegistry } from "../src/protocols/tron-sr-registry.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import {
  FIXTURE_TRON_19_C_FINGERPRINT,
  FIXTURE_TRON_19_C_FROM,
  FIXTURE_TRON_19_C_SR1,
  FIXTURE_TRON_19_C_SR2,
  FIXTURE_TRON_19_C_REF_BLOCK_BYTES,
  FIXTURE_TRON_19_C_REF_BLOCK_HASH,
  FIXTURE_TRON_19_C_EXPIRATION,
} from "./signing-fingerprint-tron-19.test.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_tron_stake_vote");
  if (!tool) throw new Error("prepare_tron_stake_vote not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// ============================================================================
// Fixture Tron-19-C — raw_data_hex for VoteWitnessContract
// ============================================================================

const FIXTURE_19_C_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a870108041282010a30747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e566f74655769746e657373436f6e7472616374124e0a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c12190a154178c842ee63b253f8f0d2955bbc582c661a078c9d1064121a0a15412d7bdb9846499a2e5e6c5a7e6fb05731c83107c710c8017090f490a5e433";

const FIXTURE_19_C_OWNER_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const SR1_HEX = "4178c842ee63b253f8f0d2955bbc582c661a078c9d";
const SR2_HEX = "412d7bdb9846499a2e5e6c5a7e6fb05731c83107c7";

// A canonical paired TRON account (real-mode shape).
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const PAIRED_TRON_ACCOUNT = {
  chain: "tron" as const,
  address: TRON_WHALE_ADDR,
  derivationPath: "44'/195'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

/**
 * Build a stub TronWeb returning the Fixture Tron-19-C tx structure
 * for VoteWitnessContract.
 */
function buildFixture19CTronWeb() {
  const baseTx = {
    raw_data_hex: FIXTURE_19_C_RAW_DATA_HEX,
    raw_data: {
      contract: [
        {
          type: "VoteWitnessContract",
          parameter: {
            value: {
              owner_address: FIXTURE_19_C_OWNER_HEX,
              votes: [
                { vote_address: SR1_HEX, vote_count: 100 },
                { vote_address: SR2_HEX, vote_count: 200 },
              ],
            },
            type_url: "type.googleapis.com/protocol.VoteWitnessContract",
          },
        },
      ],
      ref_block_bytes: FIXTURE_TRON_19_C_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_TRON_19_C_REF_BLOCK_HASH,
      expiration: FIXTURE_TRON_19_C_EXPIRATION,
    },
    visible: false,
    txID: "deadbeef19c",
  };

  const extendedTx = { ...baseTx };

  return {
    transactionBuilder: {
      vote: vi.fn().mockResolvedValue(baseTx),
      extendExpiration: vi.fn().mockResolvedValue(extendedTx),
    },
  };
}

beforeEach(async () => {
  listAccountsSpy.mockReset();
  // Re-apply actual implementation after vi.restoreAllMocks() may have cleared it in afterEach.
  if (_actualCreateHandleHolder.fn) {
    createHandleSpy.mockImplementation(_actualCreateHandleHolder.fn);
  }
  _resetHandleStoreForTesting();

  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false"; // explicit false, not deletion — isDemoMode() resolves correctly
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo !== undefined) {
    process.env[DEMO_KEY] = savedDemo;
  } else {
    delete process.env[DEMO_KEY];
  }
  vi.restoreAllMocks();
});

// ============================================================================
// Test 1: Fixture Tron-19-C consumer re-anchor
// ============================================================================

describe("prepare_tron_stake_vote — Fixture Tron-19-C consumer re-anchor", () => {
  it("paired-account real mode produces FIXTURE_TRON_19_C_FINGERPRINT for canonical inputs", async () => {
    listAccountsSpy.mockReturnValue([{ ...PAIRED_TRON_ACCOUNT, address: FIXTURE_TRON_19_C_FROM }]);

    const stub = buildFixture19CTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stub as never);

    // Mock SR registry to return snapshot-fallback (no RPC needed for registry in this test)
    vi.spyOn(_tronSrRegistry, "loadSrRegistry").mockResolvedValue({
      source: "snapshot-fallback",
      srs: [
        { address: FIXTURE_TRON_19_C_SR1, name: "Binance Staking", rank: 1, voteCount: 13541690766, url: "https://www.binance.com" },
        { address: FIXTURE_TRON_19_C_SR2, name: "Huobi", rank: 2, voteCount: 9654321000, url: "https://www.huobi.com" },
      ],
    });

    const result = await callTool({
      votes: [
        { srAddress: FIXTURE_TRON_19_C_SR1, count: 100 },
        { srAddress: FIXTURE_TRON_19_C_SR2, count: 200 },
      ],
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    // Consumer re-anchor: must match Fixture Tron-19-C
    expect(sc.payloadFingerprint).toBe(FIXTURE_TRON_19_C_FINGERPRINT);
    expect(sc.kind).toBe("stake-vote");
    expect(sc.txType).toBe("tron");
    expect(sc.chain).toBe("tron");
    expect(sc.totalCount).toBe(300); // 100 + 200
    expect(sc.srSource).toBe("snapshot-fallback");
  });
});

// ============================================================================
// Test 2: INVALID_INPUT — empty votes
// ============================================================================

describe("prepare_tron_stake_vote — INVALID_INPUT validation", () => {
  it("returns INVALID_INPUT for empty votes array", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    const result = await callTool({ votes: [] });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT for duplicate srAddress in votes", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    const result = await callTool({
      votes: [
        { srAddress: FIXTURE_TRON_19_C_SR1, count: 100 },
        { srAddress: FIXTURE_TRON_19_C_SR1, count: 50 },
      ],
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

// ============================================================================
// Test 3: WALLET_NOT_PAIRED in real mode
// ============================================================================

describe("prepare_tron_stake_vote — WALLET_NOT_PAIRED", () => {
  it("returns WALLET_NOT_PAIRED when no paired TRON accounts", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      votes: [{ srAddress: FIXTURE_TRON_19_C_SR1, count: 100 }],
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});

// ============================================================================
// Test 4: Demo mode — WRONG_MODE without persona
// ============================================================================

describe("prepare_tron_stake_vote — demo mode", () => {
  it("returns WRONG_MODE in demo mode without TRON persona", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool({
      votes: [{ srAddress: FIXTURE_TRON_19_C_SR1, count: 100 }],
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WRONG_MODE");
  });

  it("demo mode with valid TRON persona produces handle", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    // Set a TRON persona that has a tronAddress
    setActiveTronPersonaBySlug("tron-whale");

    const stub = {
      transactionBuilder: {
        vote: vi.fn().mockResolvedValue({
          raw_data_hex: FIXTURE_19_C_RAW_DATA_HEX,
          raw_data: {
            contract: [{ type: "VoteWitnessContract", parameter: { value: { owner_address: FIXTURE_19_C_OWNER_HEX, votes: [] }, type_url: "type.googleapis.com/protocol.VoteWitnessContract" } }],
            ref_block_bytes: FIXTURE_TRON_19_C_REF_BLOCK_BYTES,
            ref_block_hash: FIXTURE_TRON_19_C_REF_BLOCK_HASH,
            expiration: FIXTURE_TRON_19_C_EXPIRATION,
          },
          visible: false,
          txID: "demo-txid",
        }),
        extendExpiration: vi.fn().mockImplementation((tx: unknown) => Promise.resolve(tx)),
      },
    };
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stub as never);
    vi.spyOn(_tronSrRegistry, "loadSrRegistry").mockResolvedValue({
      source: "snapshot-fallback",
      srs: [],
    });

    const result = await callTool({
      votes: [{ srAddress: FIXTURE_TRON_19_C_SR1, count: 100 }],
    });

    // Should succeed — demo mode with persona
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("stake-vote");
    expect(typeof sc.handle).toBe("string");
  });
});
