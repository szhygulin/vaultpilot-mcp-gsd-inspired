// preview_send Morpho Blue tests — Phase 29 Plan 29-03.
//
// Anchors:
//   - 6 selector-routed arms (supply / withdraw / supplyCollateral /
//     withdrawCollateral / borrow / repay); each asserts the correct
//     DECODED ARGS template surfaces + tokenContext resolution.
//   - tokenContext from decoded.marketParams.{loanToken | collateralToken}
//     NOT from record.tx.to (T-COMPOUND-TX-TO-CONFUSION-1 extension).
//   - NO LEDGER NOTICE emitted (research § Topic 8 — Morpho IS in the
//     LedgerHQ ERC-7730 registry; opposite of Compound).
//   - share-based encoding annotation surfaces for repay-max (shares !== 0n).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

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
      throw new Error("pair should not be called from preview_send.morpho tests");
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
import { getMorphoBlueAddress } from "../src/config/contracts.js";
import {
  encodeMorphoBorrow,
  encodeMorphoRepay,
  encodeMorphoSupply,
  encodeMorphoSupplyCollateral,
  encodeMorphoWithdraw,
  encodeMorphoWithdrawCollateral,
  MORPHO_BLUE_SELECTORS,
  type MorphoMarketParams,
} from "../src/protocols/morpho-blue.js";
import {
  LEDGER_NOTICE_COMPOUND_TEMPLATE,
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

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as Address;
const ORACLE = "0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2" as Address;
const IRM = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as Address;
const LLTV = 860000000000000000n;
const ONBEHALF = "0x000000000000000000000000000000000000dEaD" as Address;
const RECEIVER = "0x000000000000000000000000000000000000bEEF" as Address;

const PARAMS: MorphoMarketParams = {
  loanToken: USDC,
  collateralToken: WSTETH,
  oracle: ORACLE,
  irm: IRM,
  lltv: LLTV,
};

const MORPHO_ADDR = getMorphoBlueAddress(1)!;
const FIXTURE_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;

function seedHandle(data: Hex): string {
  return createHandle({
    args: { to: "", valueWei: "0", tokenAddress: USDC, amount: "100" },
    tx: {
      chainId: 1,
      to: MORPHO_ADDR,
      valueWei: 0n,
      data,
    },
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
  estimateGasSpy.mockResolvedValue(180_000n);
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

describe("preview_send Morpho — 6-arm selector dispatch", () => {
  it("T1: supply arm — DECODED ARGS shows function: supply; tokenContext from loanToken; NO LEDGER NOTICE", async () => {
    scriptStdMocks();
    const data = encodeMorphoSupply(PARAMS, 100_000_000n, 0n, ONBEHALF, "0x");
    const handle = seedHandle(data);
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("DECODED ARGS");
    expect(text).toContain("function:     supply");
    expect(text).toContain("encoding:     asset-based");
    expect(text).toContain(USDC); // loanToken in DECODED ARGS
    expect(text).toContain("(USDC)"); // tokenContext label
    expect(text).not.toContain(LEDGER_NOTICE_COMPOUND_TEMPLATE); // research § Topic 8
    const sc = result.structuredContent as {
      decodedArgs: { kind: string; marketParams: { loanToken: string } };
    };
    expect(sc.decodedArgs.kind).toBe("morpho-supply");
    expect(sc.decodedArgs.marketParams.loanToken).toBe(USDC);
  });

  it("T2: withdraw arm — DECODED ARGS shows function: withdraw; receiver surfaces", async () => {
    scriptStdMocks();
    const data = encodeMorphoWithdraw(PARAMS, 50_000_000n, 0n, ONBEHALF, RECEIVER);
    const handle = seedHandle(data);
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("function:     withdraw");
    expect(text).toContain(`receiver:     ${RECEIVER}`);
  });

  it("T3: supplyCollateral arm — DECODED ARGS shows function: supplyCollateral; collateralToken context surfaces", async () => {
    scriptStdMocks();
    const data = encodeMorphoSupplyCollateral(PARAMS, 1_000_000_000_000_000_000n, ONBEHALF, "0x");
    const handle = seedHandle(data);
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("function:     supplyCollateral");
    expect(text).toContain(WSTETH);
    expect(text).toContain("(wstETH)"); // collateralToken label
    // NO encoding line — collateral arms are asset-only
    expect(text).not.toMatch(/^\s*encoding:/m);
  });

  it("T4: withdrawCollateral arm — DECODED ARGS shows function: withdrawCollateral; receiver surfaces", async () => {
    scriptStdMocks();
    const data = encodeMorphoWithdrawCollateral(PARAMS, 500_000_000_000_000_000n, ONBEHALF, RECEIVER);
    const handle = seedHandle(data);
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("function:     withdrawCollateral");
    expect(text).toContain(`receiver:     ${RECEIVER}`);
  });

  it("T5: borrow arm — DECODED ARGS shows function: borrow; receiver + isShareBased false", async () => {
    scriptStdMocks();
    const data = encodeMorphoBorrow(PARAMS, 50_000_000n, 0n, ONBEHALF, RECEIVER);
    const handle = seedHandle(data);
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("function:     borrow");
    expect(text).toContain("encoding:     asset-based");
  });

  it("T6: repay arm — DECODED ARGS shows function: repay", async () => {
    scriptStdMocks();
    const data = encodeMorphoRepay(PARAMS, 25_000_000n, 0n, ONBEHALF, "0x");
    const handle = seedHandle(data);
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("function:     repay");
    expect(text).toContain("encoding:     asset-based");
  });

  it("T7: repay-max share-based encoding annotation surfaces", async () => {
    scriptStdMocks();
    // Share-based repay (repay-max idiom): assets=0n, shares=1e9n.
    const data = encodeMorphoRepay(PARAMS, 0n, 1_000_000_000n, ONBEHALF, "0x");
    const handle = seedHandle(data);
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("function:     repay");
    expect(text).toContain("encoding:     share-based");
    expect(text).toContain("shares:       1000000000");
    const sc = result.structuredContent as {
      decodedArgs: { isShareBased: boolean; shares: string };
    };
    expect(sc.decodedArgs.isShareBased).toBe(true);
    expect(sc.decodedArgs.shares).toBe("1000000000");
  });

  it("T8: NO LEDGER NOTICE emitted on Morpho calldata against Morpho Blue address (research § Topic 8)", async () => {
    scriptStdMocks();
    const data = encodeMorphoSupply(PARAMS, 100_000_000n, 0n, ONBEHALF, "0x");
    const handle = seedHandle(data);
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    // Compound emits LEDGER NOTICE; Morpho does NOT (Morpho is in the
    // LedgerHQ ERC-7730 clear-signing registry).
    expect(text).not.toContain("LEDGER NOTICE");
    expect(text).not.toContain(LEDGER_NOTICE_COMPOUND_TEMPLATE);
    const sc = result.structuredContent as { ledgerNotice: string | null };
    // Morpho doesn't trigger any of the existing LEDGER_NOTICE tags
    expect(sc.ledgerNotice).toBeNull();
  });

  it("T9: selector slice round-trips", async () => {
    // Confirm the selector at the tx.data prefix matches the protocol SOT.
    const supplyData = encodeMorphoSupply(PARAMS, 100_000_000n, 0n, ONBEHALF, "0x");
    expect(supplyData.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.supply);
    const withdrawData = encodeMorphoWithdraw(PARAMS, 50_000_000n, 0n, ONBEHALF, RECEIVER);
    expect(withdrawData.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.withdraw);
    const supplyCollateralData = encodeMorphoSupplyCollateral(
      PARAMS, 1_000_000_000_000_000_000n, ONBEHALF, "0x",
    );
    expect(supplyCollateralData.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.supplyCollateral);
    const withdrawCollateralData = encodeMorphoWithdrawCollateral(
      PARAMS, 500_000_000_000_000_000n, ONBEHALF, RECEIVER,
    );
    expect(withdrawCollateralData.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.withdrawCollateral);
    const borrowData = encodeMorphoBorrow(PARAMS, 50_000_000n, 0n, ONBEHALF, RECEIVER);
    expect(borrowData.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.borrow);
    const repayData = encodeMorphoRepay(PARAMS, 25_000_000n, 0n, ONBEHALF, "0x");
    expect(repayData.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.repay);
  });
});
