// prepare_rocketpool_unstake tests — Phase 31 Plan 31-03 (RP-02 unstake).
//
// Cases:
//   T1: Ethereum happy path — handle + tx.to=rETH + tx.valueWei=0 + tx.data starts 0x42966c68
//   T2: Fixture AB-RP fingerprint anchor
//   T3: D-08 pool-empty refusal — INVALID_INPUT + hintTool request_capability + DEX swap message
//   T4: Polygon refusal — CHAIN_ID_MISMATCH
//   T5: Zero-value refusal — INVALID_INPUT
//   T6: LEDGER NOTICE verbatim emission (SHARED template — identical to stake)
//   T7: Pitfall 2 awareness — CHECKS PERFORMED documents the generic OZ Burnable selector
//   T8: Pitfall 5 residual disclosure in CHECKS PERFORMED
//   T9: register-all wiring smoke

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
      throw new Error("pair should not be called from prepare_rocketpool_unstake tests");
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
  getRocketPoolRethAddress,
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
await import("../src/tools/prepare_rocketpool_unstake.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_rocketpool_unstake");
  if (!tool) throw new Error("prepare_rocketpool_unstake not registered");
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

const FIXTURE_AB_RP_FINGERPRINT =
  "0xd12144239fb353612c20a3aa0a9dbcd9dd73de4141e1adce866ecf0974854edc";
const FIXTURE_AB_RP_AMOUNT = "1.0";
const FIXTURE_AB_RP_AMOUNT_WEI = "1000000000000000000";

const RETH = getRocketPoolRethAddress(1)!;
const BURN_SELECTOR = "0x42966c68";

// Default mock: pool has 10 ETH liquidity; 1 rETH burns to 1.1 ETH.
const POOL_BALANCE_10_ETH = 10_000_000_000_000_000_000n;
const ETH_EQUIVALENT_1_1 = 1_100_000_000_000_000_000n;

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
  mockReadContract.mockReset();
  mockReadContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === "getBalance") return POOL_BALANCE_10_ETH;
      if (functionName === "getEthValue") return ETH_EQUIVALENT_1_1;
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
// T1: happy path
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_unstake — Ethereum happy path", () => {
  it("rethAmount '1.0' → handle + tx.to=rETH + tx.valueWei=0 + tx.data starts 0x42966c68", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", rethAmount: FIXTURE_AB_RP_AMOUNT });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      to: string;
      valueWei: string;
      data: string;
      payloadFingerprint: string;
      rethAmountWei: string;
      ethEquivalentWei: string;
      poolBalanceWei: string;
    };

    expect(sc.handle).toMatch(/^[0-9a-f]{8}-/);
    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(RETH);
    expect(sc.valueWei).toBe("0");
    expect(sc.data.slice(0, 10).toLowerCase()).toBe(BURN_SELECTOR);
    expect(sc.data.length).toBe(74);
    expect(sc.rethAmountWei).toBe(FIXTURE_AB_RP_AMOUNT_WEI);
    expect(sc.ethEquivalentWei).toBe(ETH_EQUIVALENT_1_1.toString());
    expect(sc.poolBalanceWei).toBe(POOL_BALANCE_10_ETH.toString());

    const receiptText = result.content[0]?.text ?? "";
    expect(receiptText).toContain("PREPARE RECEIPT");
    expect(receiptText).toContain("Rocket Pool unstake");
    expect(receiptText).toContain(RETH);
    expect(receiptText).toContain(FIXTURE_AB_RP_AMOUNT);

    const checks = result.content[1]?.text ?? "";
    expect(checks).toContain("CHECKS PERFORMED");
    expect(checks).toContain("deposit-pool liquidity");

    const notice = result.content[2]?.text ?? "";
    expect(notice).toBe(LEDGER_NOTICE_ROCKETPOOL_TEMPLATE);
  });
});

// ---------------------------------------------------------------------------
// T2: Fixture AB-RP fingerprint cross-link
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_unstake — Fixture AB-RP fingerprint anchor", () => {
  it("payloadFingerprint === Fixture AB-RP literal", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({ chain: "ethereum", rethAmount: FIXTURE_AB_RP_AMOUNT });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_AB_RP_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// T3: D-08 pool-empty refusal
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_unstake — D-08 pool-empty refusal", () => {
  it("pool 0.5 ETH < burn need 1.1 ETH → INVALID_INPUT + hintTool request_capability + DEX swap text", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "getBalance") return 500_000_000_000_000_000n; // 0.5 ETH
      if (functionName === "getEthValue") return ETH_EQUIVALENT_1_1;
      return 0n;
    });

    const result = await callTool({ chain: "ethereum", rethAmount: "1.0" });
    expect(result.isError).toBe(true);

    const sc = result.structuredContent as {
      errorCode: string;
      hintTool?: string;
      hintArgs?: Record<string, unknown>;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("request_capability");
    expect(sc.hintArgs?.feature).toBe("Rocket Pool rETH/ETH DEX swap");

    const errMsg = result.content[0]?.text ?? "";
    expect(errMsg).toContain("Rocket Pool deposit pool empty");
    expect(errMsg).toContain("Swap rETH on a DEX");
    expect(errMsg).toMatch(/Uniswap V3, Curve/);
  });
});

// ---------------------------------------------------------------------------
// T4: Polygon refusal
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_unstake — Polygon refusal (D-03)", () => {
  it("chain 'polygon' → CHAIN_ID_MISMATCH; createHandle never called", async () => {
    const result = await callTool({ chain: "polygon", rethAmount: "1.0" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "CHAIN_ID_MISMATCH",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// T5: zero-value refusal
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_unstake — zero-value refusal", () => {
  it("rethAmount '0' → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({ chain: "ethereum", rethAmount: "0" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/must be > 0/);
  });
});

// ---------------------------------------------------------------------------
// T6: LEDGER NOTICE verbatim — SHARED template with stake
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_unstake — LEDGER NOTICE verbatim (SHARED template with stake)", () => {
  it("LEDGER NOTICE matches LEDGER_NOTICE_ROCKETPOOL_TEMPLATE byte-for-byte", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({ chain: "ethereum", rethAmount: "1.0" });
    expect(result.isError).toBeFalsy();
    const notice = result.content[2]?.text ?? "";
    expect(notice).toBe(LEDGER_NOTICE_ROCKETPOOL_TEMPLATE);
    // Verbatim content checks — drift in the template body fails here.
    expect(notice).toContain("LEDGER NOTICE");
    expect(notice).toContain("Rocket Pool deposit/burn is NOT covered");
    expect(notice).toContain("Blind signing");
  });
});

// ---------------------------------------------------------------------------
// T7: Pitfall 2 awareness in CHECKS PERFORMED
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_unstake — Pitfall 2 selector-collision awareness", () => {
  it("CHECKS PERFORMED documents the generic OZ ERC20Burnable selector and names the disambiguating tx.to", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({ chain: "ethereum", rethAmount: "1.0" });
    expect(result.isError).toBeFalsy();
    const checks = result.content[1]?.text ?? "";
    expect(checks).toMatch(/Pitfall 2/);
    expect(checks).toContain("0x42966c68");
    expect(checks).toMatch(/OpenZeppelin ERC20Burnable/i);
    expect(checks).toContain(RETH);
  });
});

// ---------------------------------------------------------------------------
// T8: Pitfall 5 residual disclosure
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_unstake — Pitfall 5 residual disclosure", () => {
  it("CHECKS PERFORMED documents the prepare-time pool-liquidity race window", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({ chain: "ethereum", rethAmount: "1.0" });
    expect(result.isError).toBeFalsy();
    const checks = result.content[1]?.text ?? "";
    expect(checks).toMatch(/Pitfall 5 residual/);
    expect(checks).toMatch(/may decrease before send/);
  });
});

// ---------------------------------------------------------------------------
// T9: register-all wiring smoke
// ---------------------------------------------------------------------------
describe("prepare_rocketpool_unstake — register-all wiring smoke", () => {
  it("tool is registered after import of register-all", () => {
    const tool = getRegisteredTool("prepare_rocketpool_unstake");
    expect(tool).toBeDefined();
  });
});
