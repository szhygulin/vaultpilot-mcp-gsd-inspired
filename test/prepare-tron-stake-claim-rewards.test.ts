// `prepare_tron_stake_claim_rewards` end-to-end regression. Phase 19 — Plan 19-03.
//
// Load-bearing invariants:
//
//   1. **Fixture Tron-19-D consumer re-anchor** — the canonical Fixture Tron-19-D
//      inputs produce the hardcoded literal fingerprint pinned in
//      `test/signing-fingerprint-tron-19.test.ts`. Drift in this tool's
//      preimage assembly surfaces HERE — load-bearing redundancy per CLAUDE.md
//      fixture discipline + CONTEXT D-08c.
//
//   2. **D-06c advisory estimate** — estimatedRewardSun is advisory; null is
//      valid and never blocks the prepare flow.
//
//   3. **kind = "stake-claim-rewards"** in PreparedTxTron — verified in structuredContent.
//
//   4. **WALLET_NOT_PAIRED + WRONG_MODE** gate before any RPC call.

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
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import {
  FIXTURE_TRON_19_D_FINGERPRINT,
  FIXTURE_TRON_19_D_FROM,
  FIXTURE_TRON_19_D_REF_BLOCK_BYTES,
  FIXTURE_TRON_19_D_REF_BLOCK_HASH,
  FIXTURE_TRON_19_D_EXPIRATION,
} from "./signing-fingerprint-tron-19.test.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_tron_stake_claim_rewards");
  if (!tool) throw new Error("prepare_tron_stake_claim_rewards not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// ============================================================================
// Fixture Tron-19-D — raw_data_hex for WithdrawBalanceContract
// ============================================================================

const FIXTURE_19_D_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a53080d124f0a34747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e576974686472617742616c616e6365436f6e747261637412170a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c7090f490a5e433";

const FIXTURE_19_D_OWNER_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";

// A canonical paired TRON account (real-mode shape).
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const PAIRED_TRON_ACCOUNT = {
  chain: "tron" as const,
  address: TRON_WHALE_ADDR,
  derivationPath: "44'/195'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

/**
 * Build a stub TronWeb returning the Fixture Tron-19-D tx structure
 * for WithdrawBalanceContract.
 */
function buildFixture19DTronWeb(rewardValue: number | null = null) {
  const baseTx = {
    raw_data_hex: FIXTURE_19_D_RAW_DATA_HEX,
    raw_data: {
      contract: [
        {
          type: "WithdrawBalanceContract",
          parameter: {
            value: {
              owner_address: FIXTURE_19_D_OWNER_HEX,
            },
            type_url: "type.googleapis.com/protocol.WithdrawBalanceContract",
          },
        },
      ],
      ref_block_bytes: FIXTURE_TRON_19_D_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_TRON_19_D_REF_BLOCK_HASH,
      expiration: FIXTURE_TRON_19_D_EXPIRATION,
    },
    visible: false,
    txID: "deadbeef19d",
  };

  const extendedTx = { ...baseTx };

  return {
    transactionBuilder: {
      withdrawBlockRewards: vi.fn().mockResolvedValue(baseTx),
      extendExpiration: vi.fn().mockResolvedValue(extendedTx),
    },
    trx: {
      getReward: rewardValue !== null
        ? vi.fn().mockResolvedValue(rewardValue)
        : vi.fn().mockRejectedValue(new Error("RPC getReward failed")),
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
// Test 1: Fixture Tron-19-D consumer re-anchor
// ============================================================================

describe("prepare_tron_stake_claim_rewards — Fixture Tron-19-D consumer re-anchor", () => {
  it("paired-account real mode produces FIXTURE_TRON_19_D_FINGERPRINT for canonical inputs", async () => {
    listAccountsSpy.mockReturnValue([{ ...PAIRED_TRON_ACCOUNT, address: FIXTURE_TRON_19_D_FROM }]);

    const stub = buildFixture19DTronWeb(5000000); // 5 TRX reward estimate
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stub as never);

    const result = await callTool({});

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    // Consumer re-anchor: must match Fixture Tron-19-D
    expect(sc.payloadFingerprint).toBe(FIXTURE_TRON_19_D_FINGERPRINT);
    expect(sc.kind).toBe("stake-claim-rewards");
    expect(sc.txType).toBe("tron");
    expect(sc.chain).toBe("tron");
    expect(sc.estimatedRewardSun).toBe("5000000"); // 5 TRX in SUN string
  });
});

// ============================================================================
// Test 2: D-06c advisory estimate — null when fetch fails
// ============================================================================

describe("prepare_tron_stake_claim_rewards — D-06c advisory estimate", () => {
  it("null estimatedRewardSun in structuredContent when getReward fails", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    const stub = buildFixture19DTronWeb(null); // RPC fails
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stub as never);

    const result = await callTool({});

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.estimatedRewardSun).toBeNull(); // D-06c: null is valid
    expect(sc.kind).toBe("stake-claim-rewards");
    expect(typeof sc.payloadFingerprint).toBe("string");
    expect((sc.payloadFingerprint as string)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("estimatedRewardSun string in structuredContent when getReward succeeds", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    const stub = buildFixture19DTronWeb(12345678); // 12.345678 TRX
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stub as never);

    const result = await callTool({});

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.estimatedRewardSun).toBe("12345678");
  });
});

// ============================================================================
// Test 3: WALLET_NOT_PAIRED in real mode
// ============================================================================

describe("prepare_tron_stake_claim_rewards — WALLET_NOT_PAIRED", () => {
  it("returns WALLET_NOT_PAIRED when no paired TRON accounts", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({});

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});

// ============================================================================
// Test 4: Demo mode — WRONG_MODE without persona
// ============================================================================

describe("prepare_tron_stake_claim_rewards — demo mode", () => {
  it("returns WRONG_MODE in demo mode without TRON persona", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool({});

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WRONG_MODE");
  });

  it("demo mode with valid TRON persona produces handle", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    setActiveTronPersonaBySlug("tron-whale");

    const stub = buildFixture19DTronWeb(null); // estimate fails — D-06c advisory null
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(stub as never);

    const result = await callTool({});

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("stake-claim-rewards");
    expect(typeof sc.handle).toBe("string");
  });
});
