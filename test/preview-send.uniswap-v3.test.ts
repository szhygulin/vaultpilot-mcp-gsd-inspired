// preview_send Uniswap V3 tests — Phase 32 Plan 32-03 (UNI-02).
//
// (tx.to, selector) tuple-dispatch correctness anchor for Pitfall 4
// (0x5ae401dc collision with UniversalRouter multicall) and the 4 Uniswap V3
// selector arms. Tests:
//
//   T1: (tx.to=SwapRouter02, selector=0x5ae401dc multicall) with inner
//       exactInputSingle → DECODED ARGS multicall arm + recursive inner +
//       LEDGER NOTICE
//   T2: multicall with [exactInputSingle, unwrapWETH9] (ETH-out shape) →
//       multicall arm renders BOTH inner sub-calls
//   T3: standalone exactInputSingle (bare — no multicall wrapper) on
//       SwapRouter02 → exactInputSingle DECODED ARGS arm + LEDGER NOTICE
//   T4: multi-hop multicall(deadline, [exactInput]) → path decodes to
//       arrow-separated route with token symbols + fee tiers
//   T5: standalone unwrapWETH9 on SwapRouter02 → unwrapWETH9 arm
//   T6: DEFENSE — (tx.to != SwapRouter02, selector=0x5ae401dc) does NOT
//       route to Uniswap V3 arm (Pitfall 4 mitigation)
//   T7: LEDGER NOTICE emitted unconditionally for any SwapRouter02-targeted
//       Uniswap V3 selector
//   T8: regression — Phase 31 Rocket Pool dispatch arms unaffected

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
      throw new Error("pair should not be called from preview_send.uniswap-v3 tests");
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
import { getAddress } from "viem";
import {
  getUniswapV3SwapRouter02Address,
  getRocketPoolDepositPoolAddress,
} from "../src/config/contracts.js";
import {
  encodeExactInput,
  encodeExactInputSingle,
  encodeMulticallWithDeadline,
  encodeUnwrapWeth9,
  UNISWAP_V3_SELECTORS,
} from "../src/protocols/uniswap-v3.js";
import { encodeRocketPoolDeposit } from "../src/protocols/rocketpool.js";
import { encodeV3Path } from "../src/signing/uniswap-path.js";
import {
  LEDGER_NOTICE_UNISWAP_V3_TEMPLATE,
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

const SWAP_ROUTER_02 = getUniswapV3SwapRouter02Address(1)!;
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const WBTC = getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599");

const FIXTURE_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;
const FIXTURE_DEADLINE = 1748707200n;

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
  estimateGasSpy.mockResolvedValue(200_000n);
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

// Canonical Fixture UNI-A inner sub-call for the test.
function buildFixtureASingleHopMulticall(): Hex {
  const inner = encodeExactInputSingle({
    tokenIn: USDC,
    tokenOut: WETH,
    fee: 500,
    recipient: SENDER,
    amountIn: 100_000000n,
    amountOutMinimum: 48_100_000_000_000_000n,
    sqrtPriceLimitX96: 0n,
  });
  return encodeMulticallWithDeadline(FIXTURE_DEADLINE, [inner]);
}

// Canonical Fixture UNI-B (ETH-out — [exactInputSingle(router-recipient), unwrapWETH9(persona)]).
function buildFixtureBEthOutMulticall(): Hex {
  const inner1 = encodeExactInputSingle({
    tokenIn: USDC,
    tokenOut: WETH,
    fee: 500,
    recipient: SWAP_ROUTER_02, // D-15 router-recipient
    amountIn: 100_000000n,
    amountOutMinimum: 48_100_000_000_000_000n,
    sqrtPriceLimitX96: 0n,
  });
  const inner2 = encodeUnwrapWeth9(48_100_000_000_000_000n, SENDER);
  return encodeMulticallWithDeadline(FIXTURE_DEADLINE, [inner1, inner2]);
}

// Multi-hop USDC→WETH→WBTC inner.
function buildMultiHopMulticall(): Hex {
  const path = encodeV3Path([
    { tokenIn: USDC, fee: 500, tokenOut: WETH },
    { tokenIn: WETH, fee: 3000, tokenOut: WBTC },
  ]);
  const inner = encodeExactInput({
    path,
    recipient: SENDER,
    amountIn: 100_000000n,
    amountOutMinimum: 1n,
  });
  return encodeMulticallWithDeadline(FIXTURE_DEADLINE, [inner]);
}

// ---------------------------------------------------------------------------
// T1: (SwapRouter02, multicall) → multicall arm + LEDGER NOTICE
// ---------------------------------------------------------------------------
describe("preview_send Uniswap V3 — T1 multicall arm (positive case)", () => {
  it("(tx.to=SwapRouter02, selector=0x5ae401dc) → multicall DECODED ARGS + LEDGER NOTICE", async () => {
    scriptStdMocks();
    const data = buildFixtureASingleHopMulticall();
    const handle = seedHandle(SWAP_ROUTER_02, 0n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toMatch(/DECODED\s+ARGS\s+—\s+multicall/);
    expect(text).toContain("exactInputSingle"); // inner sub-call header
    expect(text).toMatch(/sub-call\s+count:\s+1/);
    expect(text).toMatch(/LEDGER\s+NOTICE/);
    expect(text).toContain("BLIND-SIGN");
    expect(text).toContain("multicall");

    const sc = result.structuredContent as {
      decodedArgs: { kind: string; deadline: string; subCalls: unknown[] };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).toBe("uniswap-v3-multicall");
    expect(sc.decodedArgs.deadline).toBe(FIXTURE_DEADLINE.toString());
    expect(sc.decodedArgs.subCalls.length).toBe(1);
    expect(sc.ledgerNotice).toBe("uniswap-v3-blind-sign");
  });
});

// ---------------------------------------------------------------------------
// T2: ETH-out — multicall with 2 inner sub-calls
// ---------------------------------------------------------------------------
describe("preview_send Uniswap V3 — T2 ETH-out multicall (2 inner sub-calls)", () => {
  it("multicall(deadline, [exactInputSingle, unwrapWETH9]) — recursive decoder renders both inner blocks", async () => {
    scriptStdMocks();
    const data = buildFixtureBEthOutMulticall();
    const handle = seedHandle(SWAP_ROUTER_02, 0n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toMatch(/sub-call\s+count:\s+2/);
    expect(text).toContain("exactInputSingle");
    expect(text).toContain("unwrapWETH9");

    const sc = result.structuredContent as {
      decodedArgs: {
        kind: string;
        subCalls: Array<{ kind: string }>;
      };
    };
    expect(sc.decodedArgs.kind).toBe("uniswap-v3-multicall");
    expect(sc.decodedArgs.subCalls.length).toBe(2);
    expect(sc.decodedArgs.subCalls[0]!.kind).toBe("uniswap-v3-exact-input-single");
    expect(sc.decodedArgs.subCalls[1]!.kind).toBe("uniswap-v3-unwrap-weth9");
  });
});

// ---------------------------------------------------------------------------
// T3: Standalone exactInputSingle on SwapRouter02
// ---------------------------------------------------------------------------
describe("preview_send Uniswap V3 — T3 bare exactInputSingle arm", () => {
  it("standalone exactInputSingle on SwapRouter02 → exactInputSingle DECODED ARGS + LEDGER NOTICE", async () => {
    scriptStdMocks();
    const data = encodeExactInputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      fee: 500,
      recipient: SENDER,
      amountIn: 100_000000n,
      amountOutMinimum: 48_100_000_000_000_000n,
      sqrtPriceLimitX96: 0n,
    });
    const handle = seedHandle(SWAP_ROUTER_02, 0n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toMatch(/DECODED\s+ARGS\s+—\s+exactInputSingle/);
    expect(text).toMatch(/LEDGER\s+NOTICE/);

    const sc = result.structuredContent as { decodedArgs: { kind: string } };
    expect(sc.decodedArgs.kind).toBe("uniswap-v3-exact-input-single");
  });
});

// ---------------------------------------------------------------------------
// T4: Multi-hop exactInput — path decoded to arrow route
// ---------------------------------------------------------------------------
describe("preview_send Uniswap V3 — T4 multi-hop exactInput arm", () => {
  it("multicall(deadline, [exactInput]) — path decodes to USDC → 0.05% → WETH → 0.30% → WBTC", async () => {
    scriptStdMocks();
    const data = buildMultiHopMulticall();
    const handle = seedHandle(SWAP_ROUTER_02, 0n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("USDC");
    expect(text).toContain("WETH");
    expect(text).toContain("WBTC");
    expect(text).toContain("0.05%");
    expect(text).toContain("0.30%");
    expect(text).toContain("→");

    const sc = result.structuredContent as {
      decodedArgs: {
        kind: string;
        subCalls: Array<{ kind: string; pathDecoded?: string }>;
      };
    };
    expect(sc.decodedArgs.kind).toBe("uniswap-v3-multicall");
    expect(sc.decodedArgs.subCalls[0]!.kind).toBe("uniswap-v3-exact-input");
    expect(sc.decodedArgs.subCalls[0]!.pathDecoded).toMatch(/USDC.*WETH.*WBTC/);
  });
});

// ---------------------------------------------------------------------------
// T5: Standalone unwrapWETH9 on SwapRouter02
// ---------------------------------------------------------------------------
describe("preview_send Uniswap V3 — T5 bare unwrapWETH9 arm", () => {
  it("standalone unwrapWETH9 on SwapRouter02 → unwrapWETH9 DECODED ARGS + LEDGER NOTICE", async () => {
    scriptStdMocks();
    const data = encodeUnwrapWeth9(48_100_000_000_000_000n, SENDER);
    const handle = seedHandle(SWAP_ROUTER_02, 0n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toMatch(/DECODED\s+ARGS\s+—\s+unwrapWETH9/);
    expect(text).toMatch(/LEDGER\s+NOTICE/);

    const sc = result.structuredContent as { decodedArgs: { kind: string } };
    expect(sc.decodedArgs.kind).toBe("uniswap-v3-unwrap-weth9");
  });
});

// ---------------------------------------------------------------------------
// T6: DEFENSE — Pitfall 4 (multicall selector collision)
// ---------------------------------------------------------------------------
describe("preview_send Uniswap V3 — T6 (tx.to != SwapRouter02, selector=0x5ae401dc) defense (Pitfall 4)", () => {
  it("multicall selector on non-SwapRouter02 address does NOT route to Uniswap V3 arm", async () => {
    scriptStdMocks();
    const data = buildFixtureASingleHopMulticall();
    // tx.to = RocketDepositPool (canonical allowlist; just not the SwapRouter02).
    const wrongTo = getRocketPoolDepositPoolAddress(1)!;
    const handle = seedHandle(wrongTo, 0n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    // DECODED ARGS arm is NOT Uniswap V3 (the (to, selector) tuple gate failed).
    expect(text).not.toContain("DECODED ARGS — multicall(uint256 deadline, bytes[] data) (Uniswap V3 outer wrapper)");
    // No Uniswap V3 LEDGER NOTICE — the (to, selector) gate is upstream.
    expect(text).not.toContain(
      "Uniswap V3 swaps are submitted as a multicall(uint256 deadline, bytes[]) wrapper.",
    );

    const sc = result.structuredContent as {
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).not.toBe("uniswap-v3-multicall");
    expect(sc.ledgerNotice).not.toBe("uniswap-v3-blind-sign");
  });
});

// ---------------------------------------------------------------------------
// T7: LEDGER NOTICE template byte-identity assertion
// ---------------------------------------------------------------------------
describe("preview_send Uniswap V3 — T7 LEDGER NOTICE byte-identity (D-11)", () => {
  it("LEDGER_NOTICE_UNISWAP_V3_TEMPLATE emitted verbatim", async () => {
    scriptStdMocks();
    const data = buildFixtureASingleHopMulticall();
    const handle = seedHandle(SWAP_ROUTER_02, 0n, data);

    const result = await callTool({ handle });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    // Every line of LEDGER_NOTICE_UNISWAP_V3_TEMPLATE appears in the rendered text.
    const noticeLines = LEDGER_NOTICE_UNISWAP_V3_TEMPLATE.split("\n").filter(
      (line) => line.trim().length > 0,
    );
    for (const line of noticeLines) {
      expect(text).toContain(line);
    }
  });
});

// ---------------------------------------------------------------------------
// T8: regression — Phase 31 Rocket Pool dispatch arms unaffected
// ---------------------------------------------------------------------------
describe("preview_send Uniswap V3 — T8 regression: Phase 31 Rocket Pool dispatch unaffected", () => {
  it("(tx.to=RocketDepositPool, selector=0xd0e30db0) still routes to Rocket Pool arm + Rocket Pool LEDGER NOTICE", async () => {
    scriptStdMocks();
    const depositPool = getRocketPoolDepositPoolAddress(1)!;
    const data = encodeRocketPoolDeposit();
    const handle = seedHandle(depositPool, 1_000_000_000_000_000_000n, data);

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("Rocket Pool stake");
    expect(text).toContain(LEDGER_NOTICE_ROCKETPOOL_TEMPLATE.split("\n")[1]!); // "  Rocket Pool deposit/burn is NOT covered..."

    const sc = result.structuredContent as {
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).toBe("rocketpool-stake");
    expect(sc.ledgerNotice).toBe("rocketpool-blind-sign");
  });
});
