// preview_send Curve tests — Phase 34 Plan 34-03 Task 4 (CRV-02/CRV-03).
//
// (tx.to, selector) TUPLE dispatch correctness anchor for the Curve arm
// (T-34-03-C / T-34-03-SELECTOR-COLLISION) and decoded block emission.
// Tests:
//
//   T1: legacy stETH/ETH exchange (i=1,j=0 stETH→ETH) → [CURVE SWAP] block with pool name + abiVersion + dx/minDy
//   T2: stable_ng PayPool exchange (i=0,j=1 PYUSD→USDC) → [CURVE SWAP] block with receiver address surfaced
//   T3: stable_ng PayPool add_liquidity → [CURVE ADD LIQUIDITY] block with per-coin amounts + minMintAmount
//   T4: (tx.to=non-Curve, selector=0xddc1f59d) → NO [CURVE SWAP] block (LOAD-BEARING tuple dispatch regression)
//   T5: MEV doc line in [CURVE SWAP] block — literal "Sandwich-MEV gate: not applied to Curve ..."
//   T6: MEV doc line in [CURVE ADD LIQUIDITY] block — same literal
//   T7: Layer 0.5 canonical-dispatch integration — Curve pool address passes allowlist gate
//   T8: legacy stETH/ETH exchange ETH-in path (i=0,j=1 ETH→stETH) → isEthIn flag surfaced in block

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

import type { FourbyteResult } from "../src/clients/fourbyte.js";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
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
      throw new Error("pair should not be called from preview-send-curve tests");
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
} from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";
import {
  _curveProtocol,
  CURVE_SELECTORS,
} from "../src/protocols/curve.js";

await import("../src/tools/register-all.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SENDER: Address = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

// Pool addresses (from contracts.ts registry)
const STETH_ETH_POOL: Address = getAddress("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022"); // legacy
const PAY_POOL: Address      = getAddress("0x383E6b4437b59fff47B619CBA855CA29342A8559"); // stable_ng PYUSD/USDC
const NON_CURVE_ADDR: Address = getAddress("0x1111111111111111111111111111111111111111");

// Coin addresses
const ETH_SENTINEL: Address = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
const STETH_ADDR: Address   = getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84");
const PYUSD_ADDR: Address   = getAddress("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8");
const USDC_ADDR: Address    = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");

// Fingerprint (arbitrary — we're testing decoding, not signing)
const STUB_FP =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [SENDER as `0x${string}`],
  activeAccount: SENDER as `0x${string}`,
  address: SENDER as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function seedHandle(to: Address, valueWei: bigint, data: Hex): string {
  return createHandle({
    args: { to: "", valueWei: valueWei.toString() },
    tx: { chainId: 1, to, valueWei, data },
    payloadFingerprint: STUB_FP,
  });
}

function scriptStdMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(5);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: 20_000_000_000n,
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

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

beforeEach(() => {
  // Pin to real-mode deterministically (see commit c537628 / #140).
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
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
  if (savedDemo === undefined) {
    process.env[DEMO_KEY] = "false";
  } else {
    process.env[DEMO_KEY] = savedDemo;
  }
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

// ---------------------------------------------------------------------------
// Calldata builders (use encoder from protocols/curve.ts — same as prepare tools)
// ---------------------------------------------------------------------------
function buildLegacyExchangeStETHIn(): Hex {
  // stETH (i=1) → ETH (j=0); stETH-in: valueWei = 0n
  return _curveProtocol.encodeExchangeLegacy({
    i: 1,
    j: 0,
    dx: 1_000000000000000000n,
    minDy: 990000000000000000n,
  });
}

function buildLegacyExchangeEthIn(): Hex {
  // ETH (i=0) → stETH (j=1); ETH-in: valueWei = amountIn
  return _curveProtocol.encodeExchangeLegacy({
    i: 0,
    j: 1,
    dx: 500000000000000000n,
    minDy: 495000000000000000n,
  });
}

function buildStableNgExchange(): Hex {
  // PYUSD (i=0) → USDC (j=1); stable_ng: _receiver = SENDER
  return _curveProtocol.encodeExchangeStableNg({
    i: 0,
    j: 1,
    dx: 100_000000n,
    minDy: 99_000000n,
    receiver: SENDER,
  });
}

function buildStableNgAddLiquidity(): Hex {
  // add_liquidity([50_000000n PYUSD, 50_000000n USDC], minMint=99e18)
  return _curveProtocol.encodeAddLiquidityStableNg({
    amounts: [50_000000n, 50_000000n],
    minMintAmount: 99_000000000000000000n,
  });
}

// ===========================================================================
// T1: Legacy stETH/ETH exchange → [CURVE SWAP] block
// ===========================================================================
describe("preview_send — Curve legacy exchange arm", () => {
  it("T1: legacy stETH→ETH (i=1,j=0) → [CURVE SWAP] block emitted with pool name + abiVersion", async () => {
    scriptStdMocks();
    const data = buildLegacyExchangeStETHIn();
    const handle = seedHandle(STETH_ETH_POOL, 0n, data);

    const result = await callTool({ handle, userDecision: "preview" });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)
      .map(c => c.text)
      .join("\n");

    expect(text).toContain("[CURVE SWAP]");
    expect(text).toContain("stETH/ETH (legacy)");
    expect(text).toContain("legacy");
    // dx / minDy formatted (18 decimals)
    expect(text).toContain("1."); // 1.0 ETH-equiv
    expect(text).toContain("0.99"); // 0.99 min output
  });

  it("T8: legacy ETH-in path (i=0,j=1) → [CURVE SWAP] block surfaces isEthIn", async () => {
    scriptStdMocks();
    const data = buildLegacyExchangeEthIn();
    // ETH-in: valueWei = amountIn = 0.5 ETH
    const handle = seedHandle(STETH_ETH_POOL, 500000000000000000n, data);

    const result = await callTool({ handle, userDecision: "preview" });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)
      .map(c => c.text)
      .join("\n");

    expect(text).toContain("[CURVE SWAP]");
    expect(text).toContain("legacy");
    // isEthIn must be surfaced
    expect(text).toMatch(/isEthIn.*true|ETH-in.*true|true.*isEthIn/i);
  });
});

// ===========================================================================
// T2: stable_ng PayPool exchange → [CURVE SWAP] block with receiver
// ===========================================================================
describe("preview_send — Curve stable_ng exchange arm", () => {
  it("T2: stable_ng PYUSD→USDC exchange → [CURVE SWAP] block with receiver address", async () => {
    scriptStdMocks();
    const data = buildStableNgExchange();
    const handle = seedHandle(PAY_POOL, 0n, data);

    const result = await callTool({ handle, userDecision: "preview" });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)
      .map(c => c.text)
      .join("\n");

    expect(text).toContain("[CURVE SWAP]");
    expect(text).toContain("PYUSD/USDC (stable_ng)");
    expect(text).toContain("stable_ng");
    // receiver address must be surfaced for user on-device verification
    expect(text).toContain(SENDER.toLowerCase());
  });
});

// ===========================================================================
// T3: stable_ng add_liquidity → [CURVE ADD LIQUIDITY] block
// ===========================================================================
describe("preview_send — Curve stable_ng add_liquidity arm", () => {
  it("T3: stable_ng add_liquidity([50,50], min=99e18) → [CURVE ADD LIQUIDITY] block", async () => {
    scriptStdMocks();
    const data = buildStableNgAddLiquidity();
    const handle = seedHandle(PAY_POOL, 0n, data);

    const result = await callTool({ handle, userDecision: "preview" });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)
      .map(c => c.text)
      .join("\n");

    expect(text).toContain("[CURVE ADD LIQUIDITY]");
    expect(text).toContain("PYUSD/USDC (stable_ng)");
    expect(text).toContain("stable_ng");
    // per-coin amounts (6 dec): 50000000 wei = "50"
    expect(text).toContain("50");
    // minMintAmount (18 dec): 99e18 = "99"
    expect(text).toContain("99");
  });
});

// ===========================================================================
// T4: (tx.to=non-Curve, selector=0xddc1f59d) → NO decode (LOAD-BEARING tuple dispatch)
// ===========================================================================
describe("preview_send — Curve tuple dispatch regression (T-34-03-SELECTOR-COLLISION)", () => {
  it("T4: non-registry tx.to with stable_ng exchange selector does NOT emit [CURVE SWAP] block (LOAD-BEARING)", async () => {
    scriptStdMocks();
    // Encode calldata with Curve selector but point tx.to at a non-registry address
    const data = buildStableNgExchange(); // starts with 0xddc1f59d
    const handle = seedHandle(NON_CURVE_ADDR, 0n, data);

    // NOTE: canonical-dispatch (Layer 0.5) will refuse this as DISPATCH_TARGET_REFUSED.
    // We just assert NO [CURVE SWAP] block — either via refusal or via missing decode.
    const result = await callTool({ handle, userDecision: "preview" });
    const text = (result.content as Array<{ type: string; text: string }>)
      .map(c => c.text)
      .join("\n");

    expect(text).not.toContain("[CURVE SWAP]");
    expect(text).not.toContain("[CURVE ADD LIQUIDITY]");
  });
});

// ===========================================================================
// T5: MEV doc line in [CURVE SWAP] block
// ===========================================================================
describe("preview_send — Curve MEV documentation line in SWAP block", () => {
  it("T5: [CURVE SWAP] block contains literal MEV doc line", async () => {
    scriptStdMocks();
    const data = buildStableNgExchange();
    const handle = seedHandle(PAY_POOL, 0n, data);

    const result = await callTool({ handle, userDecision: "preview" });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)
      .map(c => c.text)
      .join("\n");

    expect(text).toContain("Sandwich-MEV gate: not applied to Curve (low MEV exposure on stable pools)");
  });
});

// ===========================================================================
// T6: MEV doc line in [CURVE ADD LIQUIDITY] block
// ===========================================================================
describe("preview_send — Curve MEV documentation line in ADD LIQUIDITY block", () => {
  it("T6: [CURVE ADD LIQUIDITY] block contains literal MEV doc line", async () => {
    scriptStdMocks();
    const data = buildStableNgAddLiquidity();
    const handle = seedHandle(PAY_POOL, 0n, data);

    const result = await callTool({ handle, userDecision: "preview" });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)
      .map(c => c.text)
      .join("\n");

    expect(text).toContain("Sandwich-MEV gate: not applied to Curve (low MEV exposure on stable pools)");
  });
});

// ===========================================================================
// T7: Layer 0.5 canonical-dispatch integration — Curve pool passes allowlist
// ===========================================================================
describe("preview_send — Layer 0.5 dispatch integration sanity", () => {
  it("T7: Curve PAY_POOL address passes dispatch gate (does not get DISPATCH_TARGET_REFUSED)", async () => {
    scriptStdMocks();
    const data = buildStableNgExchange();
    const handle = seedHandle(PAY_POOL, 0n, data);

    const result = await callTool({ handle, userDecision: "preview" });
    // Must NOT be a DISPATCH_TARGET_REFUSED refusal — the Curve pool IS in the allowlist
    if (result.isError) {
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc?.errorCode).not.toBe("DISPATCH_TARGET_REFUSED");
    }
    // If not an error at all — dispatch gate passed (what we want)
    // Either path is acceptable: success OR non-dispatch-refused error
    expect(
      !result.isError ||
      (result.structuredContent as Record<string, unknown>)?.errorCode !== "DISPATCH_TARGET_REFUSED"
    ).toBe(true);
  });
});

// ===========================================================================
// Sanity: [CURVE SWAP] selector coverage — both legacy + stable_ng selectors recognized
// ===========================================================================
describe("preview_send — Curve selector byte-coverage sanity", () => {
  it("SANITY: legacy exchange selector (0x3df02124) decoded from stETH/ETH pool", async () => {
    scriptStdMocks();
    const data = buildLegacyExchangeStETHIn();
    // Verify selector
    expect(data.slice(0, 10).toLowerCase()).toBe(CURVE_SELECTORS.exchangeLegacy);
    const handle = seedHandle(STETH_ETH_POOL, 0n, data);

    const result = await callTool({ handle, userDecision: "preview" });
    const text = (result.content as Array<{ type: string; text: string }>)
      .map(c => c.text)
      .join("\n");
    expect(text).toContain("[CURVE SWAP]");
  });

  it("SANITY: stable_ng exchange selector (0xddc1f59d) decoded from PAY_POOL", async () => {
    scriptStdMocks();
    const data = buildStableNgExchange();
    expect(data.slice(0, 10).toLowerCase()).toBe(CURVE_SELECTORS.exchangeNg);
    const handle = seedHandle(PAY_POOL, 0n, data);

    const result = await callTool({ handle, userDecision: "preview" });
    const text = (result.content as Array<{ type: string; text: string }>)
      .map(c => c.text)
      .join("\n");
    expect(text).toContain("[CURVE SWAP]");
  });

  it("SANITY: add_liquidity selector (0xb72df5de) decoded from PAY_POOL", async () => {
    scriptStdMocks();
    const data = buildStableNgAddLiquidity();
    expect(data.slice(0, 10).toLowerCase()).toBe(CURVE_SELECTORS.addLiquidityNg);
    const handle = seedHandle(PAY_POOL, 0n, data);

    const result = await callTool({ handle, userDecision: "preview" });
    const text = (result.content as Array<{ type: string; text: string }>)
      .map(c => c.text)
      .join("\n");
    expect(text).toContain("[CURVE ADD LIQUIDITY]");
  });
});
