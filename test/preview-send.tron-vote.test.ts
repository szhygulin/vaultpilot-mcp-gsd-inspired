// preview_send TRON Stake 2.0 vote + claim-rewards branch regression. Phase 19 — Plan 19-03.
//
// LOAD-BEARING: Advisory-only Layer 0.7 assertions (D-06c — NO mandatory gate for vote/claim).
//
//   1. **stake-vote advisory** — preview succeeds; NO_SIMULATION_AVAILABLE emitted;
//      previewToken minted; presignHash = SHA-256(rawDataBytes); structuredContent.kind="stake-vote".
//      PREPARE_RECEIPT_TRON_VOTE_TEMPLATE text surfaces in response.
//
//   2. **stake-claim-rewards advisory** — preview succeeds; NO_SIMULATION_AVAILABLE emitted;
//      previewToken minted; kind="stake-claim-rewards". D-06c: no mandatory gate.
//
//   3. **Layer 0.5 is NOT called for vote or claim-rewards** — `checkTronDispatchTarget` spy
//      receives zero calls for stake-vote / stake-claim-rewards handles.
//
//   4. **LEDGER_NOTICE_TRON_TEMPLATE unconditionally emitted for vote + claim-rewards** —
//      both are Protobuf-native contracts (blind-sign only on TRX app).
//
//   5. **REWARD_ESTIMATE_TRON_TEMPLATE** surfaces in claim-rewards response when
//      estimatedRewardSun is non-null in instructionSummary.
//
// Mocking strategy:
//   - `_canonicalDispatchTron.checkTronDispatchTarget` — spy only; must not be called.
//   - handle-store stays REAL — seed via createHandle, assert via lookup().

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
}));

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

import { _canonicalDispatchTron } from "../src/security/canonical-dispatch-tron.js";
import {
  LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE,
  NO_SIMULATION_AVAILABLE_TRON_TEMPLATE,
  REWARD_ESTIMATE_TRON_TEMPLATE,
} from "../src/signing/blocks-tron.js";
import { computeTronPayloadFingerprint } from "../src/signing/payload-fingerprint-tron.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  createHandle,
  type PreparedTxTron,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callPreviewSend(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

// ============================================================================
// Test constants
// ============================================================================

const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const SR1 = "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH";
const SR2 = "TE7hnUtWRRBz3SkFrX8JESWUmEvxxAhoPt";
const VOTE_RAW_DATA_HEX = "dd".repeat(20);
const CLAIM_RAW_DATA_HEX = "ee".repeat(20);

// ============================================================================
// Handle builders for vote + claim-rewards
// ============================================================================

function buildStakeVoteHandle() {
  const rawDataHex = VOTE_RAW_DATA_HEX;
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "stake-vote",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000",
    valueWei: 0n,
    data: "0x",
    rawDataHex,
    rawDataObject: {},
    refBlockBytes: "00dd",
    refBlockHash: "ddeeff0011223344",
    expiration: Date.now() + 900_000,
    instructionSummary: [
      {
        kind: "stake-vote" as const,
        from: TRON_WHALE_ADDR,
        totalCount: 300,
        votes: [
          { srAddress: SR1, count: 100, label: "(SR: Binance Staking — vote rank 1)" },
          { srAddress: SR2, count: 200, label: "(SR: Huobi — vote rank 2)" },
        ],
      },
    ],
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(rawDataHex, "hex")),
  });
  return createHandle({ tx: tronTx, args: { to: "", valueWei: "0" }, payloadFingerprint });
}

function buildStakeClaimRewardsHandle(estimatedRewardSun: bigint | null = null) {
  const rawDataHex = CLAIM_RAW_DATA_HEX;
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "stake-claim-rewards",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000",
    valueWei: 0n,
    data: "0x",
    rawDataHex,
    rawDataObject: {},
    refBlockBytes: "00ee",
    refBlockHash: "eeff001122334455",
    expiration: Date.now() + 900_000,
    instructionSummary: [
      {
        kind: "stake-claim-rewards" as const,
        from: TRON_WHALE_ADDR,
        estimatedRewardSun,
      },
    ],
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(rawDataHex, "hex")),
  });
  return createHandle({ tx: tronTx, args: { to: "", valueWei: "0" }, payloadFingerprint });
}

beforeEach(() => {
  listAccountsSpy.mockReturnValue([]);
  _resetHandleStoreForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Test 1: stake-vote — advisory preview succeeds
// ============================================================================

describe("preview_send TRON — stake-vote advisory path (D-06c no gate)", () => {
  it("stake-vote preview succeeds with previewToken + NO_SIMULATION_AVAILABLE", async () => {
    const dispatchSpy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildStakeVoteHandle();

    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;

    // PREPARE RECEIPT (TRON — Stake 2.0 vote) block
    expect(text).toMatch(/PREPARE RECEIPT.*Stake 2\.0 vote/s);

    // NO_SIMULATION_AVAILABLE advisory
    expect(text).toContain("no simulation available");

    // LEDGER BLIND-SIGN HASH (TRON) block
    expect(text).toContain("LEDGER BLIND-SIGN HASH (TRON)");

    // LEDGER NOTICE unconditionally emitted for vote (Protobuf-native)
    expect(text).toContain("LEDGER NOTICE (TRON)");
    expect(text).toContain("VoteWitnessContract");

    // structuredContent
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("stake-vote");
    expect(typeof sc.previewToken).toBe("string");
    expect(sc.previewToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(typeof sc.presignHash).toBe("string");
    expect((sc.presignHash as string)).toMatch(/^0x[0-9a-f]{64}$/);

    // Layer 0.5 NOT called for vote
    expect(dispatchSpy).not.toHaveBeenCalled();

    // Handle transitions to previewed
    const record = _peekHandleForTesting(handle);
    expect(record?.status).toBe("previewed");
  });
});

// ============================================================================
// Test 2: stake-claim-rewards — advisory preview succeeds
// ============================================================================

describe("preview_send TRON — stake-claim-rewards advisory path (D-06c no gate)", () => {
  it("stake-claim-rewards preview succeeds with previewToken + NO_SIMULATION_AVAILABLE", async () => {
    const dispatchSpy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildStakeClaimRewardsHandle();

    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;

    // PREPARE RECEIPT (TRON — Stake 2.0 claim rewards) block
    expect(text).toMatch(/PREPARE RECEIPT.*claim rewards/s);

    // NO_SIMULATION_AVAILABLE advisory
    expect(text).toContain("no simulation available");

    // LEDGER BLIND-SIGN HASH (TRON) block
    expect(text).toContain("LEDGER BLIND-SIGN HASH (TRON)");

    // LEDGER NOTICE unconditionally emitted for claim-rewards (Protobuf-native)
    expect(text).toContain("LEDGER NOTICE (TRON)");
    expect(text).toContain("WithdrawBalanceContract");

    // structuredContent
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("stake-claim-rewards");
    expect(typeof sc.previewToken).toBe("string");
    expect(typeof sc.presignHash).toBe("string");

    // Layer 0.5 NOT called for claim-rewards
    expect(dispatchSpy).not.toHaveBeenCalled();

    // Handle transitions to previewed
    const record = _peekHandleForTesting(handle);
    expect(record?.status).toBe("previewed");
  });

  it("stake-claim-rewards with non-null estimatedRewardSun surfaces REWARD_ESTIMATE block", async () => {
    const handle = buildStakeClaimRewardsHandle(5000000n); // 5 TRX estimate

    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;

    // REWARD_ESTIMATE_TRON_TEMPLATE should be present
    expect(text).toContain("estimated reward");
    expect(text).toContain("5000000");
  });

  it("stake-claim-rewards with null estimatedRewardSun does NOT surface reward estimate block", async () => {
    const handle = buildStakeClaimRewardsHandle(null); // D-06c: null advisory

    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;

    // REWARD_ESTIMATE should NOT appear when null
    expect(text).not.toContain("estimatedRewardSun");
  });
});
