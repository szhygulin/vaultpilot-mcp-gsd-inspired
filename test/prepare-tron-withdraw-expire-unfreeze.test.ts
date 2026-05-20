// `prepare_tron_withdraw_expire_unfreeze` end-to-end regression. Phase 19 — Plan 19-02.
//
// Load-bearing invariants:
//
//   1. **Zero-arg tool** — no `amount`, no `resource` in request or PREPARE RECEIPT.
//      PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE has only ref-block fields.
//
//   2. **kind = "stake-withdraw-expire"** in structuredContent.
//
//   3. **No resource/sun slots** in response text — withdrawal is all-expired-records,
//      no per-resource amount argument.
//
//   4. **Preview-time gate advisory** — response text mentions that preview_send
//      will check on-chain withdrawable balance (D-04b mandatory gate).
//
//   5. **Pairing + demo mode** coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy:
    vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
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

vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
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
import { _tronStake } from "../src/protocols/tron-stake.js";
import { PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE } from "../src/signing/blocks-tron.js";
import {
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_tron_withdraw_expire_unfreeze");
  if (!tool) throw new Error("prepare_tron_withdraw_expire_unfreeze not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const PAIRED_TRON_ACCOUNT = {
  chain: "tron" as const,
  address: TRON_WHALE_ADDR,
  derivationPath: "44'/195'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

function buildWithdrawStub() {
  vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({} as never);
  vi.spyOn(_tronStake, "encodeWithdrawExpireUnfreeze").mockResolvedValue({
    transaction: {},
    rawDataHex: "deadbeef",
    rawDataBytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    rawDataObject: {},
    refBlockBytes: "00ee",
    refBlockHash: "aabb112233445566",
    expiration: 1779268134000,
    instructionSummary: [
      {
        kind: "stake-withdraw-expire" as const,
        from: TRON_WHALE_ADDR,
      },
    ],
  });
  listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
}

beforeEach(async () => {
  listAccountsSpy.mockReset();
  createHandleSpy.mockClear();
  const realHandleStore = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(realHandleStore.createHandle);
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe("prepare_tron_withdraw_expire_unfreeze — zero-arg tool", () => {
  it("succeeds with no arguments (zero-arg tool)", async () => {
    buildWithdrawStub();
    const result = await callTool({});
    expect(result.isError).toBeFalsy();
  });

  it("kind = 'stake-withdraw-expire' in structuredContent", async () => {
    buildWithdrawStub();
    const result = await callTool({});
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("stake-withdraw-expire");
    expect(sc.chain).toBe("tron");
  });

  it("PREPARE RECEIPT has no resource or sun slots", async () => {
    buildWithdrawStub();
    const result = await callTool({});
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: "text"; text: string }).text;

    // Template header: "PREPARE RECEIPT (TRON — Stake 2.0 withdraw expired unfreeze)"
    expect(text).toMatch(/PREPARE RECEIPT.*TRON.*withdraw expired unfreeze/);

    // NO resource slot, NO sun slot — zero-arg contract
    expect(text).not.toMatch(/resource:\s+\w/);
    expect(text).not.toMatch(/sun:\s+\d/);

    // ref-block fields ARE present
    expect(text).toMatch(/refBlockBytes:\s+00ee/);
    expect(text).toMatch(/refBlockHash:\s+aabb112233445566/);
  });

  it("response text mentions preview_send D-04b gate", async () => {
    buildWithdrawStub();
    const result = await callTool({});
    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Must mention that preview will check withdrawable balance.
    expect(text).toMatch(/preview_send|on-chain withdrawable/i);
  });

  it("no leftover template slots in response", async () => {
    buildWithdrawStub();
    const result = await callTool({});
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).not.toContain("{REF_BLOCK_BYTES}");
    expect(text).not.toContain("{REF_BLOCK_HASH}");
    expect(text).not.toContain("{EXPIRATION}");
    expect(text).not.toContain("{RESOURCE}");
    expect(text).not.toContain("{SUN}");
  });

  it("structuredContent has refBlockBytes + refBlockHash + expiration", async () => {
    buildWithdrawStub();
    const result = await callTool({});
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.refBlockBytes).toBe("00ee");
    expect(sc.refBlockHash).toBe("aabb112233445566");
    expect(sc.expiration).toBe(1779268134000);
  });
});

describe("prepare_tron_withdraw_expire_unfreeze — WITHDRAW_EXPIRE_TEMPLATE (no resource/sun)", () => {
  it("PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE has no {RESOURCE} or {SUN} slots", () => {
    // Template-level regression: verify the template itself never contains resource/sun slots.
    expect(PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE).not.toContain("{RESOURCE}");
    expect(PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE).not.toContain("{SUN}");
    expect(PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE).toContain("{REF_BLOCK_BYTES}");
    expect(PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE).toContain("{REF_BLOCK_HASH}");
    expect(PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE).toContain("{EXPIRATION}");
  });
});

describe("prepare_tron_withdraw_expire_unfreeze — pairing + demo mode", () => {
  it("no paired account → WALLET_NOT_PAIRED", async () => {
    listAccountsSpy.mockReturnValue([]);
    const result = await callTool({});
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });

  it("demo mode + no persona → WRONG_MODE", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    const result = await callTool({});
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WRONG_MODE");
  });

  it("demo mode + TRON persona → success", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({} as never);
    vi.spyOn(_tronStake, "encodeWithdrawExpireUnfreeze").mockResolvedValue({
      transaction: {},
      rawDataHex: "01020304",
      rawDataBytes: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
      rawDataObject: {},
      refBlockBytes: "00cc",
      refBlockHash: "aabbccdd11223344",
      expiration: 9999999999999,
      instructionSummary: [
        {
          kind: "stake-withdraw-expire" as const,
          from: TRON_WHALE_ADDR,
        },
      ],
    });

    const result = await callTool({});
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("stake-withdraw-expire");
  });

  it("encoder throws generic error → INTERNAL_ERROR envelope", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({} as never);
    vi.spyOn(_tronStake, "encodeWithdrawExpireUnfreeze").mockRejectedValue(
      new Error("RPC timeout"),
    );

    const result = await callTool({});
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
    expect(sc.message as string).toContain("WithdrawExpireUnfreezeContract");
  });
});
