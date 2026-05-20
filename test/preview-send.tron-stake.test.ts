// preview_send TRON Stake 2.0 branch regression. Phase 19 — Plan 19-02.
//
// LOAD-BEARING: Asymmetric Layer 0.7 assertions.
//
//   1. **stake-freeze advisory** — preview succeeds; NO_SIMULATION_AVAILABLE emitted;
//      previewToken minted; presignHash = SHA-256(rawDataBytes); structuredContent.kind="stake-freeze".
//
//   2. **stake-unfreeze advisory** — same shape as stake-freeze; kind="stake-unfreeze".
//      STAKE_WAITING_PERIOD_TRON_TEMPLATE text surfaces in response.
//
//   3. **stake-withdraw-expire MANDATORY refusal (D-04b)** — `checkWithdrawableBalance`
//      returns `withdrawable === 0n` → `SIMULATION_REFUSED`; handle stays at `prepared`.
//
//   4. **stake-withdraw-expire PASS** — `checkWithdrawableBalance` returns `withdrawable > 0n`
//      → preview succeeds; WITHDRAWABLE_BALANCE_TRON_TEMPLATE text surfaces; previewToken minted.
//
//   5. **Layer 0.5 is NOT called for any stake kind** — `checkTronDispatchTarget` spy
//      receives zero calls for stake-freeze / stake-unfreeze / stake-withdraw-expire handles.
//
//   6. **LEDGER_NOTICE_TRON_TEMPLATE unconditionally emitted for all stake kinds** —
//      every stake kind is Protobuf-native (distinct from TriggerSmartContract);
//      blind-sign only.
//
// Mocking strategy:
//   - `_tronStake.checkWithdrawableBalance` — controls Layer 0.7 for withdraw-expire.
//   - `_canonicalDispatchTron.checkTronDispatchTarget` — spy only; must not be called.
//   - `_tronRegistry.getTronWeb` — returns minimal stub.
//   - handle-store stays REAL — seed via createHandle, assert via lookup().

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

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

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _canonicalDispatchTron } from "../src/security/canonical-dispatch-tron.js";
import { _tronStake } from "../src/protocols/tron-stake.js";
import {
  NO_SIMULATION_AVAILABLE_TRON_TEMPLATE,
  STAKE_WAITING_PERIOD_TRON_TEMPLATE,
  WITHDRAWABLE_BALANCE_TRON_TEMPLATE,
} from "../src/signing/blocks-tron.js";
import { computeTronPayloadFingerprint } from "../src/signing/payload-fingerprint-tron.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
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
const STAKE_FREEZE_RAW_DATA_HEX = "aa".repeat(20);
const STAKE_UNFREEZE_RAW_DATA_HEX = "bb".repeat(20);
const STAKE_WITHDRAW_RAW_DATA_HEX = "cc".repeat(20);

// ============================================================================
// Handle builders for each stake kind
// ============================================================================

function buildStakeFreezeHandle() {
  const rawDataHex = STAKE_FREEZE_RAW_DATA_HEX;
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "stake-freeze",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000",
    valueWei: 0n,
    data: "0x",
    rawDataHex,
    rawDataObject: {},
    refBlockBytes: "00aa",
    refBlockHash: "aabb112233445566",
    expiration: Date.now() + 900_000,
    instructionSummary: [
      {
        kind: "stake-freeze-v2" as const,
        from: TRON_WHALE_ADDR,
        resource: "ENERGY" as const,
        sun: 500_000_000n,
      },
    ],
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(rawDataHex, "hex")),
  });
  return createHandle({ tx: tronTx, args: { to: "", valueWei: "0", amount: "500" }, payloadFingerprint });
}

function buildStakeUnfreezeHandle() {
  const rawDataHex = STAKE_UNFREEZE_RAW_DATA_HEX;
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "stake-unfreeze",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000",
    valueWei: 0n,
    data: "0x",
    rawDataHex,
    rawDataObject: {},
    refBlockBytes: "00bb",
    refBlockHash: "bbcc223344556677",
    expiration: Date.now() + 900_000,
    instructionSummary: [
      {
        kind: "stake-unfreeze-v2" as const,
        from: TRON_WHALE_ADDR,
        resource: "BANDWIDTH" as const,
        sun: 200_000_000n,
      },
    ],
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(rawDataHex, "hex")),
  });
  return createHandle({ tx: tronTx, args: { to: "", valueWei: "0", amount: "200" }, payloadFingerprint });
}

function buildStakeWithdrawHandle() {
  const rawDataHex = STAKE_WITHDRAW_RAW_DATA_HEX;
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "stake-withdraw-expire",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000",
    valueWei: 0n,
    data: "0x",
    rawDataHex,
    rawDataObject: {},
    refBlockBytes: "00cc",
    refBlockHash: "ccddeeff11223344",
    expiration: Date.now() + 900_000,
    instructionSummary: [
      {
        kind: "stake-withdraw-expire" as const,
        from: TRON_WHALE_ADDR,
      },
    ],
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(rawDataHex, "hex")),
  });
  return createHandle({ tx: tronTx, args: { to: "", valueWei: "0", amount: "0" }, payloadFingerprint });
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  listAccountsSpy.mockReset();
  listAccountsSpy.mockReturnValue([
    {
      chain: "tron",
      address: TRON_WHALE_ADDR,
      derivationPath: "44'/195'/0'/0/0",
      pairedAt: new Date().toISOString(),
    },
  ]);
  vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// 1. stake-freeze — advisory Layer 0.7
// ============================================================================

describe("preview_send TRON Stake 2.0 — stake-freeze advisory Layer 0.7", () => {
  it("stake-freeze: previewToken minted; presignHash = SHA-256(rawDataBytes)", async () => {
    const handle = buildStakeFreezeHandle();

    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.previewToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // presignHash = SHA-256(rawDataBytes)
    const expected = "0x" + createHash("sha256")
      .update(Buffer.from(STAKE_FREEZE_RAW_DATA_HEX, "hex"))
      .digest("hex");
    expect(sc.presignHash).toBe(expected);

    expect(sc.kind).toBe("stake-freeze");
    expect(sc.chain).toBe("tron");
  });

  it("stake-freeze: NO_SIMULATION_AVAILABLE advisory in response (NOT a refusal)", async () => {
    const handle = buildStakeFreezeHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content[0] as { type: "text"; text: string }).text;
    // NO_SIMULATION_AVAILABLE_TRON_TEMPLATE key phrase
    expect(text).toMatch(/no simulation available/i);
    // Stake kinds have no simulation API
    expect(text).not.toMatch(/SIMULATION_REFUSED/i);
  });

  it("stake-freeze: LEDGER_NOTICE_TRON_TEMPLATE emitted (blind-sign only for Protobuf-native)", async () => {
    const handle = buildStakeFreezeHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content[0] as { type: "text"; text: string }).text;
    // LEDGER_NOTICE emits the instructionName
    expect(text).toMatch(/FreezeBalanceV2Contract/);
  });

  it("stake-freeze: handle transitions to previewed", async () => {
    const handle = buildStakeFreezeHandle();
    await callPreviewSend({ handle });
    const rec = lookup(handle);
    expect(rec.ok).toBe(true);
    if (rec.ok) {
      expect(rec.record.status).toBe("previewed");
    }
  });

  it("stake-freeze: Layer 0.5 checkTronDispatchTarget is NOT called", async () => {
    const spy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildStakeFreezeHandle();
    await callPreviewSend({ handle });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 2. stake-unfreeze — advisory Layer 0.7
// ============================================================================

describe("preview_send TRON Stake 2.0 — stake-unfreeze advisory Layer 0.7", () => {
  it("stake-unfreeze: previewToken minted; kind='stake-unfreeze'", async () => {
    const handle = buildStakeUnfreezeHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("stake-unfreeze");
    expect(sc.previewToken).toBeTruthy();
  });

  it("stake-unfreeze: STAKE_WAITING_PERIOD_TRON_TEMPLATE text in response", async () => {
    const handle = buildStakeUnfreezeHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content[0] as { type: "text"; text: string }).text;
    // STAKE_WAITING_PERIOD_TRON_TEMPLATE key phrases
    expect(text).toMatch(/14 days/);
    expect(text).toMatch(/prepare_tron_withdraw_expire_unfreeze/);
  });

  it("stake-unfreeze: Layer 0.5 checkTronDispatchTarget is NOT called", async () => {
    const spy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildStakeUnfreezeHandle();
    await callPreviewSend({ handle });
    expect(spy).not.toHaveBeenCalled();
  });

  it("stake-unfreeze: LEDGER_NOTICE emitted with UnfreezeBalanceV2Contract name", async () => {
    const handle = buildStakeUnfreezeHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/UnfreezeBalanceV2Contract/);
  });
});

// ============================================================================
// 3. stake-withdraw-expire — MANDATORY Layer 0.7 refusal when withdrawable === 0n
// ============================================================================

describe("preview_send TRON Stake 2.0 — stake-withdraw-expire MANDATORY D-04b gate", () => {
  it("withdrawable === 0n → SIMULATION_REFUSED; handle stays at 'prepared'", async () => {
    // D-04b: mandatory refusal when no expired unfreeze records.
    vi.spyOn(_tronStake, "checkWithdrawableBalance").mockResolvedValue({
      withdrawable: 0n,
      expiringAt: null,
    });

    const handle = buildStakeWithdrawHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("SIMULATION_REFUSED");
    expect(sc.message as string).toMatch(/no expired unfreeze records/i);

    // Handle must stay at 'prepared' — NOT transitioned to 'previewed'.
    const rec = lookup(handle);
    expect(rec.ok).toBe(true);
    if (rec.ok) {
      expect(rec.record.status).toBe("prepared");
    }
  });

  it("withdrawable === 0n refusal: checkTronDispatchTarget NOT called", async () => {
    vi.spyOn(_tronStake, "checkWithdrawableBalance").mockResolvedValue({
      withdrawable: 0n,
      expiringAt: null,
    });
    const spy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildStakeWithdrawHandle();
    await callPreviewSend({ handle });
    expect(spy).not.toHaveBeenCalled();
  });

  it("RPC error during checkWithdrawableBalance → fail-closed (SIMULATION_REFUSED)", async () => {
    // Fail-closed per D-04b: if RPC check throws, treat as 0.
    vi.spyOn(_tronStake, "checkWithdrawableBalance").mockRejectedValue(
      new Error("RPC timeout"),
    );

    const handle = buildStakeWithdrawHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("SIMULATION_REFUSED");
  });
});

// ============================================================================
// 4. stake-withdraw-expire — PASS when withdrawable > 0n
// ============================================================================

describe("preview_send TRON Stake 2.0 — stake-withdraw-expire PASS (withdrawable > 0n)", () => {
  it("withdrawable > 0n → preview succeeds; previewToken minted", async () => {
    vi.spyOn(_tronStake, "checkWithdrawableBalance").mockResolvedValue({
      withdrawable: 500_000_000n,
      expiringAt: 1779268134000,
    });

    const handle = buildStakeWithdrawHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.previewToken).toBeTruthy();
    expect(sc.kind).toBe("stake-withdraw-expire");
  });

  it("withdrawable > 0n → WITHDRAWABLE_BALANCE_TRON_TEMPLATE in response", async () => {
    vi.spyOn(_tronStake, "checkWithdrawableBalance").mockResolvedValue({
      withdrawable: 500_000_000n,
      expiringAt: 1779268134000,
    });

    const handle = buildStakeWithdrawHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content[0] as { type: "text"; text: string }).text;
    // WITHDRAWABLE_BALANCE_TRON_TEMPLATE key phrases
    expect(text).toMatch(/withdrawable balance found/i);
    expect(text).toMatch(/500000000/);
    expect(text).toMatch(/D-04b Layer 0\.7 PASS/);
  });

  it("withdrawable > 0n → LEDGER_NOTICE emitted (WithdrawExpireUnfreezeContract)", async () => {
    vi.spyOn(_tronStake, "checkWithdrawableBalance").mockResolvedValue({
      withdrawable: 1_000_000_000n,
      expiringAt: null,
    });

    const handle = buildStakeWithdrawHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/WithdrawExpireUnfreezeContract/);
  });

  it("withdrawable > 0n → structuredContent.withdrawableSun present", async () => {
    vi.spyOn(_tronStake, "checkWithdrawableBalance").mockResolvedValue({
      withdrawable: 750_000_000n,
      expiringAt: 1779268134000,
    });

    const handle = buildStakeWithdrawHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.withdrawableSun).toBe("750000000");
  });

  it("withdrawable > 0n → handle transitions to previewed", async () => {
    vi.spyOn(_tronStake, "checkWithdrawableBalance").mockResolvedValue({
      withdrawable: 1_000_000n,
      expiringAt: null,
    });

    const handle = buildStakeWithdrawHandle();
    await callPreviewSend({ handle });
    const rec = lookup(handle);
    expect(rec.ok).toBe(true);
    if (rec.ok) {
      expect(rec.record.status).toBe("previewed");
    }
  });
});

// ============================================================================
// 5. Layer 0.5 is NOT called for any stake kind
// ============================================================================

describe("preview_send TRON Stake 2.0 — Layer 0.5 skipped for all stake kinds", () => {
  it("stake-freeze: checkTronDispatchTarget spy has zero calls", async () => {
    const spy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildStakeFreezeHandle();
    await callPreviewSend({ handle });
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("stake-unfreeze: checkTronDispatchTarget spy has zero calls", async () => {
    const spy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildStakeUnfreezeHandle();
    await callPreviewSend({ handle });
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("stake-withdraw-expire (PASS): checkTronDispatchTarget spy has zero calls", async () => {
    vi.spyOn(_tronStake, "checkWithdrawableBalance").mockResolvedValue({
      withdrawable: 100_000_000n,
      expiringAt: null,
    });
    const spy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildStakeWithdrawHandle();
    await callPreviewSend({ handle });
    expect(spy).toHaveBeenCalledTimes(0);
  });
});
