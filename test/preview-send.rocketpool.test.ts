// preview_send Rocket Pool tests — Phase 31 Plan 31-03.
//
// (tx.to, selector) tuple-dispatch correctness anchor for Pitfall 1 + Pitfall 2:
//
//   T1: (tx.to = RocketDepositPool, selector = 0xd0e30db0) → Rocket Pool
//       stake DECODED ARGS arm + LEDGER NOTICE emitted (Rocket Pool template).
//   T2: (tx.to = WETH9, selector = 0xd0e30db0) — Pitfall 1 — does NOT route
//       to Rocket Pool; LEDGER NOTICE (Rocket Pool template) NOT emitted;
//       DECODED ARGS does NOT contain "Rocket Pool".
//   T3: (tx.to = rETH, selector = 0x42966c68) → Rocket Pool burn DECODED ARGS
//       arm + LEDGER NOTICE emitted.
//   T4: (tx.to = arbitrary ERC-20 with OZ Burnable, selector = 0x42966c68)
//       — Pitfall 2 — does NOT route to Rocket Pool; no LEDGER NOTICE
//       (Rocket Pool template).
//   T5: (tx.to = StrategyManager, selector = 0xe7a050aa) → EigenLayer deposit
//       DECODED ARGS arm + EigenLayer LEDGER NOTICE emitted.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import type { FourbyteResult } from "../src/clients/fourbyte.js";

const {
  getStatusSpy,
  getTransactionCountSpy,
  estimateFeesPerGasSpy,
  estimateGasSpy,
  callSpy,
  lookupSelectorSpy,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getTransactionCountSpy: vi.fn(),
  estimateFeesPerGasSpy: vi.fn(),
  estimateGasSpy: vi.fn(),
  callSpy: vi.fn(),
  lookupSelectorSpy: vi.fn<[Hex | null], Promise<FourbyteResult>>(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from preview_send.rocketpool tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    getTransactionCount: (...args: Parameters<typeof actual.getTransactionCount>) =>
      getTransactionCountSpy(...args),
    estimateFeesPerGas: (...args: Parameters<typeof actual.estimateFeesPerGas>) =>
      estimateFeesPerGasSpy(...args),
    estimateGas: (...args: Parameters<typeof actual.estimateGas>) => estimateGasSpy(...args),
    call: (...args: Parameters<typeof actual.call>) => callSpy(...args),
  };
});

vi.mock("../src/clients/fourbyte.js", async () => {
  const actual = await vi.importActual<typeof import("../src/clients/fourbyte.js")>(
    "../src/clients/fourbyte.js",
  );
  return {
    ...actual,
    lookupSelector: (selector: Hex | null) => lookupSelectorSpy(selector),
  };
});

import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  getRocketPoolDepositPoolAddress,
  getRocketPoolRethAddress,
  getEigenLayerStrategyManagerAddress,
  getEigenLayerStrategyAddress,
  getEigenLayerLstTokenAddress,
  getWethAddress,
} from "../src/config/contracts.js";
import {
  encodeRocketPoolDeposit,
  encodeRocketPoolBurn,
} from "../src/protocols/rocketpool.js";
import { encodeDepositIntoStrategy } from "../src/protocols/eigenlayer.js";
import {
  LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE,
  LEDGER_NOTICE_ROCKETPOOL_TEMPLATE,
} from "../src/signing/blocks.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
} from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

const SENDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [SENDER as `0x${string}`],
  activeAccount: SENDER as `0x${string}`,
  address: SENDER as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

// Allowlisted ERC-20 that is NOT rETH (Pitfall 2 negative case). USDC is in
// the canonical-dispatch allowlist (TOKEN_CONTRACTS / BRIDGED_VARIANTS) and
// passes Layer 0.5; the preview_send tuple-dispatch decision is what we're
// asserting on. (USDC doesn't actually implement burn on-chain, but
// preview_send dispatches at the calldata level — it doesn't simulate the
// burn behavior here.)
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;

const FIXTURE_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;

function seedHandle(to: Address, valueWei: bigint, data: Hex): string {
  return createHandle({
    args: { to: "", valueWei: valueWei.toString(), tokenAddress: to, amount: "1.0" },
    tx: { chainId: 1, to, valueWei, data },
    payloadFingerprint: FIXTURE_FINGERPRINT,
  });
}

function scriptStdMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(7);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  });
  estimateGasSpy.mockResolvedValue(100_000n);
  callSpy.mockResolvedValue({ data: "0x" as Hex });
  lookupSelectorSpy.mockResolvedValue({
    status: "ok" as const,
    selector: null,
    matchCount: 0,
    matchedAbi: null,
    primary: null,
    candidates: [],
  });
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  callSpy.mockReset();
  lookupSelectorSpy.mockReset();
});

afterEach(() => {
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

// ---------------------------------------------------------------------------
// T1: Rocket Pool stake — (RocketDepositPool, 0xd0e30db0) → Rocket Pool arm + NOTICE
// ---------------------------------------------------------------------------
describe("preview_send Rocket Pool — T1 stake arm (Pitfall 1 mitigation, positive case)", () => {
  it("(tx.to=RocketDepositPool, selector=0xd0e30db0) → Rocket Pool stake DECODED ARGS + LEDGER NOTICE", async () => {
    scriptStdMocks();
    const depositPool = getRocketPoolDepositPoolAddress(1)!;
    const data = encodeRocketPoolDeposit();
    const handle = seedHandle(depositPool, 1_000_000_000_000_000_000n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    // DECODED ARGS arm is Rocket Pool stake.
    expect(text).toContain("DECODED ARGS");
    expect(text).toContain("Rocket Pool stake");
    expect(text).toContain(depositPool);
    // LEDGER NOTICE Rocket Pool template emitted.
    expect(text).toContain("LEDGER NOTICE");
    expect(text).toContain("Rocket Pool deposit/burn is NOT covered");

    // structuredContent surfaces decoded args + ledger notice tag.
    const sc = result.structuredContent as {
      decodedArgs: { kind: string; contractAddress: string; valueWei: string };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).toBe("rocketpool-stake");
    expect(sc.decodedArgs.contractAddress).toBe(depositPool);
    expect(sc.decodedArgs.valueWei).toBe("1000000000000000000");
    expect(sc.ledgerNotice).toBe("rocketpool-blind-sign");
  });
});

// ---------------------------------------------------------------------------
// T2: WETH9.deposit collision — same selector, different tx.to (Pitfall 1)
// ---------------------------------------------------------------------------
describe("preview_send Rocket Pool — T2 WETH9.deposit collision (Pitfall 1, negative case)", () => {
  it("(tx.to=WETH9, selector=0xd0e30db0) does NOT route to Rocket Pool arm; no Rocket Pool LEDGER NOTICE", async () => {
    scriptStdMocks();
    const weth = getWethAddress(1);
    const data = encodeRocketPoolDeposit(); // same calldata as WETH9.deposit()
    const handle = seedHandle(weth, 1_000_000_000_000_000_000n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    // DECODED ARGS arm is NOT Rocket Pool.
    expect(text).not.toContain("Rocket Pool stake");
    // No Rocket Pool LEDGER NOTICE (the disambiguating tx.to is WETH9).
    expect(text).not.toContain("Rocket Pool deposit/burn is NOT covered");

    const sc = result.structuredContent as {
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).not.toBe("rocketpool-stake");
    expect(sc.ledgerNotice).not.toBe("rocketpool-blind-sign");
  });
});

// ---------------------------------------------------------------------------
// T3: Rocket Pool burn — (rETH, 0x42966c68) → Rocket Pool arm + NOTICE
// ---------------------------------------------------------------------------
describe("preview_send Rocket Pool — T3 burn arm (Pitfall 2 mitigation, positive case)", () => {
  it("(tx.to=rETH, selector=0x42966c68) → Rocket Pool burn DECODED ARGS + LEDGER NOTICE", async () => {
    scriptStdMocks();
    const reth = getRocketPoolRethAddress(1)!;
    const data = encodeRocketPoolBurn(1_000_000_000_000_000_000n);
    const handle = seedHandle(reth, 0n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("Rocket Pool unstake (burn)");
    expect(text).toContain(reth);
    expect(text).toContain(LEDGER_NOTICE_ROCKETPOOL_TEMPLATE);

    const sc = result.structuredContent as {
      decodedArgs: { kind: string; contractAddress: string; amountWei: string };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).toBe("rocketpool-burn");
    expect(sc.decodedArgs.contractAddress).toBe(reth);
    expect(sc.decodedArgs.amountWei).toBe("1000000000000000000");
    expect(sc.ledgerNotice).toBe("rocketpool-blind-sign");
  });
});

// ---------------------------------------------------------------------------
// T4: Generic ERC-20 burn — same selector, different tx.to (Pitfall 2)
// ---------------------------------------------------------------------------
describe("preview_send Rocket Pool — T4 generic ERC-20 burn collision (Pitfall 2, negative case)", () => {
  it("(tx.to=USDC ERC-20, selector=0x42966c68) does NOT route to Rocket Pool arm; no Rocket Pool LEDGER NOTICE", async () => {
    scriptStdMocks();
    const data = encodeRocketPoolBurn(1_000_000_000_000_000_000n);
    const handle = seedHandle(USDC_ETH, 0n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).not.toContain("Rocket Pool unstake");
    expect(text).not.toContain(LEDGER_NOTICE_ROCKETPOOL_TEMPLATE);

    const sc = result.structuredContent as {
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).not.toBe("rocketpool-burn");
    expect(sc.ledgerNotice).not.toBe("rocketpool-blind-sign");
  });
});

// ---------------------------------------------------------------------------
// T5: EigenLayer deposit — (StrategyManager, 0xe7a050aa) → EigenLayer arm + NOTICE
// ---------------------------------------------------------------------------
describe("preview_send EigenLayer — T5 deposit arm (selector-dispatch into Plan 31-02 EigenLayer block)", () => {
  it("(tx.to=StrategyManager, selector=0xe7a050aa) → EigenLayer DECODED ARGS + EigenLayer LEDGER NOTICE", async () => {
    scriptStdMocks();
    const sm = getEigenLayerStrategyManagerAddress(1)!;
    const strategy = getEigenLayerStrategyAddress(1, "stETH")!;
    const lstToken = getEigenLayerLstTokenAddress(1, "stETH")!;
    const data = encodeDepositIntoStrategy(strategy, lstToken, 1_000_000_000_000_000_000n);
    const handle = seedHandle(sm, 0n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("EigenLayer");
    expect(text).toContain(strategy);
    expect(text).toContain(LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE);

    const sc = result.structuredContent as {
      decodedArgs: { kind: string; strategyManager: string; lstSymbol: string };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).toBe("eigenlayer-deposit");
    expect(sc.decodedArgs.strategyManager).toBe(sm);
    expect(sc.decodedArgs.lstSymbol).toBe("stETH");
    expect(sc.ledgerNotice).toBe("eigenlayer-deposit-blind-sign");
  });
});
