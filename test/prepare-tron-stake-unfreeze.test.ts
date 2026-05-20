// `prepare_tron_stake_unfreeze` end-to-end regression. Phase 19 — Plan 19-02.
//
// Load-bearing invariants:
//
//   1. **STAKE_WAITING_PERIOD_TRON_TEMPLATE assertion** — the response text
//      includes the 14-day waiting period advisory block. This is the
//      mandatory D-04a advisory at prepare time (distinct from the D-04b
//      Layer 0.7 mandatory refusal at preview time for withdraw-expire).
//
//   2. **kind = "stake-unfreeze"** in structuredContent.
//
//   3. **INVALID_INPUT FIRST** — `resource` strict enum + `amount` validation.
//
//   4. **waitingPeriodDays = 14** in structuredContent.

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
import {
  PREPARE_RECEIPT_TRON_STAKE_UNFREEZE_TEMPLATE,
  STAKE_WAITING_PERIOD_TRON_TEMPLATE,
} from "../src/signing/blocks-tron.js";
import {
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_tron_stake_unfreeze");
  if (!tool) throw new Error("prepare_tron_stake_unfreeze not registered");
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

function buildUnfreezeStub(resource: "ENERGY" | "BANDWIDTH" = "ENERGY", sun = 500_000_000n) {
  vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({} as never);
  vi.spyOn(_tronStake, "encodeUnfreezeBalanceV2").mockResolvedValue({
    transaction: {},
    rawDataHex: "aabbccdd",
    rawDataBytes: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]),
    rawDataObject: {},
    refBlockBytes: "00ff",
    refBlockHash: "aabbccddeeff0011",
    expiration: 1779268134000,
    instructionSummary: [
      {
        kind: "stake-unfreeze-v2" as const,
        from: TRON_WHALE_ADDR,
        resource,
        sun,
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

describe("prepare_tron_stake_unfreeze — STAKE_WAITING_PERIOD_TRON_TEMPLATE assertion", () => {
  it("response text includes STAKE_WAITING_PERIOD_TRON_TEMPLATE (D-04a advisory)", async () => {
    buildUnfreezeStub("ENERGY");

    const result = await callTool({ amount: "500", resource: "ENERGY" });
    expect(result.isError).toBeFalsy();

    const text = (result.content[0] as { type: "text"; text: string }).text;

    // STAKE_WAITING_PERIOD_TRON_TEMPLATE must appear verbatim (no partial match).
    // Check key phrases from the template.
    expect(text).toMatch(/Stake 2\.0 waiting period/);
    expect(text).toMatch(/14 days/);
    expect(text).toMatch(/prepare_tron_withdraw_expire_unfreeze/);
  });

  it("structuredContent has kind='stake-unfreeze' and waitingPeriodDays=14", async () => {
    buildUnfreezeStub("ENERGY");

    const result = await callTool({ amount: "500", resource: "ENERGY" });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("stake-unfreeze");
    expect(sc.waitingPeriodDays).toBe(14);
  });

  it("BANDWIDTH unfreeze: response includes resource=BANDWIDTH + waiting period", async () => {
    buildUnfreezeStub("BANDWIDTH", 200_000_000n);

    const result = await callTool({ amount: "200", resource: "BANDWIDTH" });
    expect(result.isError).toBeFalsy();

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/resource:\s+BANDWIDTH/);
    expect(text).toMatch(/14 days/);
  });
});

describe("prepare_tron_stake_unfreeze — input validation (FIRES FIRST)", () => {
  it("invalid resource 'ENERGY_V2' → INVALID_INPUT (fires before pairing check)", async () => {
    // No mock for listAccounts — should never be called.
    const result = await callTool({ amount: "100", resource: "ENERGY_V2" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    // listAccounts never called (enum check fired first)
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("too-many fractional digits → INVALID_INPUT (7 digits > 6 TRX decimals)", async () => {
    // parseTronAmountStrict("100.1234567", 6, "u64") → fractional-overflow
    const result = await callTool({ amount: "100.1234567", resource: "BANDWIDTH" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("empty amount → INVALID_INPUT", async () => {
    const result = await callTool({ amount: "", resource: "ENERGY" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_tron_stake_unfreeze — pairing + demo mode", () => {
  it("no paired account → WALLET_NOT_PAIRED", async () => {
    listAccountsSpy.mockReturnValue([]);
    const result = await callTool({ amount: "100", resource: "ENERGY" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });

  it("demo mode + no persona → WRONG_MODE", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    const result = await callTool({ amount: "100", resource: "ENERGY" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WRONG_MODE");
  });

  it("demo mode + TRON persona → success with waiting period advisory", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({} as never);
    vi.spyOn(_tronStake, "encodeUnfreezeBalanceV2").mockResolvedValue({
      transaction: {},
      rawDataHex: "cafebabe",
      rawDataBytes: new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
      rawDataObject: {},
      refBlockBytes: "00aa",
      refBlockHash: "0011223344556677",
      expiration: 1779268134000,
      instructionSummary: [
        {
          kind: "stake-unfreeze-v2" as const,
          from: TRON_WHALE_ADDR,
          resource: "ENERGY" as const,
          sun: 100_000_000n,
        },
      ],
    });

    const result = await callTool({ amount: "100", resource: "ENERGY" });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/14 days/);
  });
});

describe("prepare_tron_stake_unfreeze — template slot substitution", () => {
  it("no leftover template slots in response text", async () => {
    buildUnfreezeStub("ENERGY");

    const result = await callTool({ amount: "500", resource: "ENERGY" });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).not.toContain("{RESOURCE}");
    expect(text).not.toContain("{SUN}");
    expect(text).not.toContain("{REF_BLOCK_BYTES}");
    expect(text).not.toContain("{REF_BLOCK_HASH}");
    expect(text).not.toContain("{EXPIRATION}");
    expect(text).not.toContain("{RESOURCE_DESCRIPTION}");
  });
});
