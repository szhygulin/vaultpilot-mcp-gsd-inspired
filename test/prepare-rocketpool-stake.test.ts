// prepare_rocketpool_stake tests — Phase 31 Plan 31-03 (RP-02 stake).
//
// Cases:
//   T1: Ethereum happy path — handle + tx shape + PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE
//   T2: Fixture AA-RP fingerprint anchor (cross-link to test/signing-fingerprint.test.ts)
//   T3: D-07 below-minimum refusal — INVALID_INPUT + hintTool "request_capability" + min text
//   T4: D-07 RPC-failure fallback — refusal uses fallback constant + CHECKS PERFORMED labels fallback source
//   T5: Polygon refusal — CHAIN_ID_MISMATCH
//   T6: Zero-value refusal — INVALID_INPUT
//   T7: LEDGER NOTICE verbatim emitted (SHARED template with unstake — symmetric blind-sign UX)
//   T8: Pitfall 1 awareness — CHECKS PERFORMED documents selector collision with WETH9.deposit
//   T9: register-all wiring smoke — tool is registered post-import

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getStatusSpy, createHandleSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  createHandleSpy: vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_rocketpool_stake tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<typeof import("../src/signing/handle-store.js")>(
    "../src/signing/handle-store.js",
  );
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (...args: Parameters<typeof actual.createHandle>) => createHandleSpy(...args),
  };
});

// Mock chain registry — prepare_rocketpool_stake reads minimumDeposit live.
const mockReadContract = vi.fn();
vi.mock("../src/chains/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/registry.js")>(
    "../src/chains/registry.js",
  );
  return {
    ...actual,
    getChainClient: vi.fn(() => ({ readContract: mockReadContract })),
  };
});

import {
  getRocketPoolDepositPoolAddress,
} from "../src/config/contracts.js";
import {
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { LEDGER_NOTICE_ROCKETPOOL_TEMPLATE } from "../src/signing/blocks.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
} from "../src/demo/state.js";

await import("../src/tools/register-all.js");
// Direct import to ensure the tool is registered in this test file regardless
// of register-all ordering (mirror of prepare_lido_stake.test.ts pattern).
await import("../src/tools/prepare_rocketpool_stake.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_rocketpool_stake");
  if (!tool) throw new Error("prepare_rocketpool_stake not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const ANVIL_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [ANVIL_1],
  activeAccount: ANVIL_1,
  address: ANVIL_1,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [ANVIL_1] } as Record<number, `0x${string}`[]>,
};

// Fixture AA-RP — Phase 31 Plan 31-03 anchor.
// RocketDepositPool.deposit() value=1e18 on Ethereum mainnet.
const FIXTURE_AA_RP_FINGERPRINT =
  "0x615683fb4b0cf540d1e5ba8f12c0766e542825557f769e60e83aa2cc76be0ca3";
const FIXTURE_AA_RP_AMOUNT = "1.0";
const FIXTURE_AA_RP_AMOUNT_WEI = "1000000000000000000";

const DEPOSIT_POOL = getRocketPoolDepositPoolAddress(1)!;
const DEPOSIT_SELECTOR = "0xd0e30db0";

// Default mock: minimumDeposit = 0.01 ETH (matches the on-chain Rocket Pool min).
const DEFAULT_MIN_DEPOSIT = 10_000_000_000_000_000n;

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
  mockReadContract.mockReset();
  mockReadContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === "getMinimumDeposit") return DEFAULT_MIN_DEPOSIT;
      return 0n;
    },
  );
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
});

// ---------------------------------------------------------------------------
// T1: Ethereum happy path
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_stake — Ethereum happy path", () => {
  it("amount '1.0' → handle + tx.to=depositPool + tx.valueWei=1e18 + tx.data=0xd0e30db0", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", amount: FIXTURE_AA_RP_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      to: string;
      valueWei: string;
      data: string;
      payloadFingerprint: string;
      checksPerformed: string;
      ledgerNotice: string;
      minimumDeposit: string;
      minimumDepositSource: string;
    };

    expect(sc.handle).toMatch(/^[0-9a-f]{8}-/);
    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(DEPOSIT_POOL);
    expect(sc.valueWei).toBe(FIXTURE_AA_RP_AMOUNT_WEI);
    expect(sc.data).toBe(DEPOSIT_SELECTOR);
    expect(sc.minimumDeposit).toBe(DEFAULT_MIN_DEPOSIT.toString());
    expect(sc.minimumDepositSource).toBe("rpc");

    // PREPARE RECEIPT
    const receiptText = result.content[0]?.text ?? "";
    expect(receiptText).toContain("PREPARE RECEIPT");
    expect(receiptText).toContain("Rocket Pool stake");
    expect(receiptText).toContain(DEPOSIT_POOL);
    expect(receiptText).toContain(FIXTURE_AA_RP_AMOUNT);

    // CHECKS PERFORMED block (content[1])
    const checks = result.content[1]?.text ?? "";
    expect(checks).toContain("CHECKS PERFORMED");
    expect(checks).toContain("minimum-deposit (D-07)");
    expect(checks).toContain("decimal-strict amount parse");

    // LEDGER NOTICE block (content[2])
    const notice = result.content[2]?.text ?? "";
    expect(notice).toBe(LEDGER_NOTICE_ROCKETPOOL_TEMPLATE);
  });
});

// ---------------------------------------------------------------------------
// T2: Fixture AA-RP fingerprint cross-link
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_stake — Fixture AA-RP fingerprint anchor", () => {
  it("payloadFingerprint === Fixture AA-RP literal (cross-link to signing-fingerprint.test.ts)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({ chain: "ethereum", amount: FIXTURE_AA_RP_AMOUNT });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_AA_RP_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// T3: D-07 below-minimum refusal
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_stake — D-07 below-minimum refusal", () => {
  it("amount 0.001 ETH < 0.01 ETH min → INVALID_INPUT + hintTool request_capability", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // 0.01 ETH min in mock
    mockReadContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "getMinimumDeposit") return 10_000_000_000_000_000n;
      return 0n;
    });

    const result = await callTool({ chain: "ethereum", amount: "0.001" });
    expect(result.isError).toBe(true);

    const sc = result.structuredContent as {
      errorCode: string;
      hintTool?: string;
      hintArgs?: Record<string, unknown>;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("request_capability");
    expect(sc.hintArgs?.feature).toBe("Rocket Pool minimum deposit context");

    const errMsg = result.content[0]?.text ?? "";
    expect(errMsg).toMatch(/Rocket Pool minimum deposit is/);
    expect(errMsg).toContain("0.001");
  });
});

// ---------------------------------------------------------------------------
// T4: D-07 RPC-failure fallback
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_stake — D-07 RPC-failure fallback (ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI)", () => {
  it("getMinimumDeposit throws → uses 0.01 ETH fallback + CHECKS PERFORMED labels fallback source", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "getMinimumDeposit") {
        throw new Error("simulated RPC failure");
      }
      return 0n;
    });

    // Use a value above the fallback (0.01) to succeed and surface the fallback source.
    const result = await callTool({ chain: "ethereum", amount: "0.5" });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as { minimumDepositSource: string };
    expect(sc.minimumDepositSource).toBe("fallback");

    const checks = result.content[1]?.text ?? "";
    expect(checks).toMatch(/fallback/i);
    expect(checks).toMatch(/RPC read failed/i);
  });

  it("fallback path also refuses sub-minimum amounts (0.005 < 0.01 fallback)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "getMinimumDeposit") {
        throw new Error("simulated RPC failure");
      }
      return 0n;
    });

    const result = await callTool({ chain: "ethereum", amount: "0.005" });
    expect(result.isError).toBe(true);
    const errMsg = result.content[0]?.text ?? "";
    expect(errMsg).toMatch(/hardcoded fallback/);
  });
});

// ---------------------------------------------------------------------------
// T5: Polygon refusal
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_stake — Polygon refusal (D-03)", () => {
  it("chain 'polygon' → CHAIN_ID_MISMATCH; createHandle never called", async () => {
    const result = await callTool({ chain: "polygon", amount: "1.0" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "CHAIN_ID_MISMATCH",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// T6: Zero-value refusal
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_stake — zero-value refusal", () => {
  it("amount '0' → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({ chain: "ethereum", amount: "0" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/must be > 0/);
  });
});

// ---------------------------------------------------------------------------
// T7: LEDGER NOTICE verbatim
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_stake — LEDGER NOTICE verbatim emission (D-13)", () => {
  it("LEDGER NOTICE block matches LEDGER_NOTICE_ROCKETPOOL_TEMPLATE byte-for-byte", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({ chain: "ethereum", amount: "1.0" });
    expect(result.isError).toBeFalsy();

    const notice = result.content[2]?.text ?? "";
    expect(notice).toBe(LEDGER_NOTICE_ROCKETPOOL_TEMPLATE);
    expect(notice).toContain("LEDGER NOTICE");
    expect(notice).toContain("Rocket Pool deposit/burn is NOT covered");
    expect(notice).toContain("Blind signing");
  });
});

// ---------------------------------------------------------------------------
// T8: Pitfall 1 awareness in CHECKS PERFORMED
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_stake — Pitfall 1 selector-collision awareness in CHECKS PERFORMED", () => {
  it("CHECKS PERFORMED documents the 0xd0e30db0 ↔ WETH9.deposit collision and names the disambiguating tx.to", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({ chain: "ethereum", amount: "1.0" });
    expect(result.isError).toBeFalsy();
    const checks = result.content[1]?.text ?? "";
    expect(checks).toMatch(/Pitfall 1/);
    expect(checks).toContain("0xd0e30db0");
    expect(checks).toContain("WETH9.deposit");
    expect(checks).toContain(DEPOSIT_POOL);
  });
});

// ---------------------------------------------------------------------------
// T9: register-all wiring smoke
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_stake — register-all wiring smoke", () => {
  it("tool is registered after import of register-all", () => {
    const tool = getRegisteredTool("prepare_rocketpool_stake");
    expect(tool).toBeDefined();
  });
});
