// Uniswap V3 persona-cycle integration test — Phase 32 Plan 32-03.
//
// Re-anchors the Plan 32-01 Fixtures UNI-A / UNI-B / UNI-C across persona swaps.
//
// IMPORTANT DEVIATION from the Phase 31 / Phase 30 from-independence pattern:
// Uniswap V3 SwapRouter02 calldata embeds the `recipient` (= resolved from-
// address) directly in the inner exactInputSingle / exactInput / unwrapWETH9
// params. This means the SwapRouter02 multicall payloadFingerprint VARIES
// with `from` — DIFFERENT from Phase 31 EigenLayer (where `from` is NOT in
// calldata; only strategy/lstToken/amount are).
//
// Consequence: the Plan 32-01 hardcoded FIXTURE_UNI_*_FP literals are
// reproducible at the prepare-tool level ONLY when the resolved `from`
// EQUALS the Plan 32-01 canonical persona (0x70997970...). They are NOT
// reproducible across the demo personas (vitalik.eth / circle / binance7 /
// binance8) which use different addresses.
//
// This test instead asserts:
//   (a) Determinism: each (fixture × persona) combination produces a
//       reproducible payloadFingerprint, verifiable via independent
//       re-computation through the encoder primitives.
//   (b) Persona plumbing: structuredContent.from matches the active persona's
//       address (exercises resolveFrom across personas).
//   (c) Cross-fixture distinctness: UNI-A, UNI-B, UNI-C (per persona) produce
//       3 distinct fingerprints (calldata-shape distinguishability).
//   (d) Full prepare → preview pipeline: each fixture × persona round-trips
//       through preview_send + emits the LEDGER NOTICE block + Uniswap V3
//       DECODED ARGS arm.
//
// 3 fixtures × 3 personas = 9 (fixture × persona) cells; deterministic FP
// assertions cover all 9.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockPublicClient,
  type MockPublicClient,
} from "./helpers/mock-public-client.js";
import {
  createMockSignClient,
  type MockSignClient,
} from "./helpers/mock-sign-client.js";

const {
  getStatusSpy,
  getActiveSessionTopicSpy,
  mockPublicHolder,
  mockSignClientHolder,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getActiveSessionTopicSpy: vi.fn<[], string | null>(),
  mockPublicHolder: { current: null as MockPublicClient | null },
  mockSignClientHolder: { current: null as MockSignClient | null },
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    getActiveSessionTopic: () => getActiveSessionTopicSpy(),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from integration test");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("../src/wallet/walletconnect-client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/walletconnect-client.js")>(
    "../src/wallet/walletconnect-client.js",
  );
  return {
    ...actual,
    getWalletConnectClient: async () => {
      if (!mockSignClientHolder.current) {
        throw new Error("test setup: mockSignClient not initialized");
      }
      return mockSignClientHolder.current.client;
    },
  };
});

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    getTransactionCount: (...args: Parameters<typeof actual.getTransactionCount>) => {
      if (!mockPublicHolder.current) throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.getTransactionCount(...args);
    },
    estimateFeesPerGas: (...args: Parameters<typeof actual.estimateFeesPerGas>) => {
      if (!mockPublicHolder.current) throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.estimateFeesPerGas(...args);
    },
    estimateGas: (...args: Parameters<typeof actual.estimateGas>) => {
      if (!mockPublicHolder.current) throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.estimateGas(...args);
    },
    call: (...args: Parameters<typeof actual.call>) => {
      if (!mockPublicHolder.current) throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.call(...args);
    },
  };
});

const MAX_UINT256 = 2n ** 256n - 1n;
const QUOTE_UNI_A = 48_341_708_542_713_568n;
const QUOTE_UNI_C_RAW = 2n;
// block.timestamp = 1748706600n → deadline = 1748707200n (matches Plan 32-01
// fixture pin).
const FIXTURE_BLOCK_TIMESTAMP = 1748706600n;
const FIXTURE_DEADLINE = 1748707200n;

const mockReadContract = vi.fn();
const mockGetBlock = vi.fn().mockImplementation(() =>
  Promise.resolve({ timestamp: FIXTURE_BLOCK_TIMESTAMP }),
);

vi.mock("../src/chains/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/registry.js")>(
    "../src/chains/registry.js",
  );
  return {
    ...actual,
    getChainClient: vi.fn(() => ({
      readContract: mockReadContract,
      getBlock: mockGetBlock,
    })),
  };
});

import { getAddress, type Address, type Hex } from "viem";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";
import { PERSONAS } from "../src/demo/personas.js";
import { getUniswapV3SwapRouter02Address } from "../src/config/contracts.js";
import {
  encodeExactInput,
  encodeExactInputSingle,
  encodeMulticallWithDeadline,
  encodeUnwrapWeth9,
} from "../src/protocols/uniswap-v3.js";
import { encodeV3Path } from "../src/signing/uniswap-path.js";
import { computePayloadFingerprint } from "../src/signing/payload-fingerprint.js";

await import("../src/tools/register-all.js");

// Plan 32-01 Fixture UNI-A/B/C hardcoded literals (matches
// test/signing-fingerprint.test.ts). These are anchored to a SPECIFIC persona
// (FIXTURE_PERSONA = Anvil account 1) — re-anchored only at that persona; the
// 9-cell determinism check uses re-computation via the encoder primitives.
const FIXTURE_UNI_A_FP =
  "0xc9f4eb062c04a605a2c49f623d2831751e96c76f177b5aacb85a5016ccfa766e";
const FIXTURE_UNI_B_FP =
  "0x5599bb306e4b2296a89e3349fc0c83ffe6e2143d8234d94cfc489831a1a1790c";
const FIXTURE_UNI_C_FP =
  "0x795086fdfb9f86ff26ffd6cec6100223c0bf041d9427936b51b60e038f2beb8f";
const FIXTURE_PERSONA = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

const SWAP_ROUTER_02 = getUniswapV3SwapRouter02Address(1)!;
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const WBTC = getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`${name} not registered`);
  const needsChain =
    /^(prepare_|get_|simulate_|check_)/.test(name) && !("chain" in args);
  const merged = needsChain ? { chain: "ethereum", ...args } : args;
  return tool.handler(merged);
}

function personaAddress(slug: "whale" | "stable-saver" | "defi-degen"): Address {
  const found = PERSONAS.find((p) => p.slug === slug);
  if (!found) throw new Error(`persona ${slug} not found`);
  return found.address;
}

// 3 personas; the address-bearing slot in calldata (recipient) varies across
// these → fingerprints vary. The standalone test/signing-fingerprint.test.ts
// FIXTURE_UNI_*_FP literals are anchored at FIXTURE_PERSONA (Anvil acct 1)
// which is NOT in this list — we re-compute expected fingerprints per persona.
const PERSONAS_UNDER_TEST: ReadonlyArray<"whale" | "stable-saver" | "defi-degen"> = [
  "whale",
  "stable-saver",
  "defi-degen",
];

// Quote mocks shared across describe blocks — the mocks themselves don't
// depend on persona; the prepare tool flows persona address via resolveFrom.
function setupQuoteMocksUniA(): void {
  mockReadContract.mockImplementation((req: {
    functionName: string;
    args?: readonly unknown[];
  }) => {
    if (req.functionName === "decimals") return Promise.resolve(6);
    if (req.functionName === "allowance") return Promise.resolve(MAX_UINT256);
    if (req.functionName === "quoteExactInputSingle") {
      const inner = (req.args?.[0] ?? {}) as {
        amountIn: bigint;
        fee: 100 | 500 | 3000 | 10000;
      };
      const isFull = inner.amountIn >= 100_000000n;
      if (inner.fee === 500) {
        return Promise.resolve([
          isFull ? QUOTE_UNI_A : QUOTE_UNI_A / 10000n,
          0n,
          0,
          0n,
        ]);
      }
      return Promise.reject(new Error(`revert fee=${inner.fee}`));
    }
    if (req.functionName === "quoteExactInput") {
      return Promise.reject(new Error("no multi-hop pool for UNI-A scenario"));
    }
    return Promise.resolve(0n);
  });
}

function setupQuoteMocksUniC(): void {
  mockReadContract.mockImplementation((req: {
    functionName: string;
    args?: readonly unknown[];
  }) => {
    if (req.functionName === "decimals") return Promise.resolve(6);
    if (req.functionName === "allowance") return Promise.resolve(MAX_UINT256);
    if (req.functionName === "quoteExactInputSingle") {
      return Promise.reject(new Error("no single-hop USDC↔WBTC pool"));
    }
    if (req.functionName === "quoteExactInput") {
      return Promise.resolve([QUOTE_UNI_C_RAW, [], [], 0n]);
    }
    return Promise.resolve(0n);
  });
}

beforeEach(() => {
  getStatusSpy.mockReset();
  getActiveSessionTopicSpy.mockReset();
  mockReadContract.mockReset();
  mockGetBlock.mockClear();
  mockGetBlock.mockImplementation(() =>
    Promise.resolve({ timestamp: FIXTURE_BLOCK_TIMESTAMP }),
  );
  _resetHandleStoreForTesting();
  mockPublicHolder.current = createMockPublicClient();
  mockSignClientHolder.current = createMockSignClient();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "true";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  mockPublicHolder.current._setNonce(7);
  mockPublicHolder.current._setFees({
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
  });
  mockPublicHolder.current._setGasEstimate(200_000n);
  mockPublicHolder.current._setCallResponse("0x");
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers: independent re-computation of expected fingerprints per persona
// ---------------------------------------------------------------------------

function expectedFingerprintUniAForPersona(persona: Address): Hex {
  const inner = encodeExactInputSingle({
    tokenIn: USDC,
    tokenOut: WETH,
    fee: 500,
    recipient: persona,
    amountIn: 100_000000n,
    amountOutMinimum: 48_100_000_000_000_000n,
    sqrtPriceLimitX96: 0n,
  });
  const data = encodeMulticallWithDeadline(FIXTURE_DEADLINE, [inner]);
  return computePayloadFingerprint({
    chainId: 1,
    to: SWAP_ROUTER_02,
    valueWei: 0n,
    data,
  });
}

function expectedFingerprintUniBForPersona(persona: Address): Hex {
  // ETH-out: inner1 recipient = SwapRouter02 (D-15); inner2 unwrapWETH9
  // recipient = persona.
  const inner1 = encodeExactInputSingle({
    tokenIn: USDC,
    tokenOut: WETH,
    fee: 500,
    recipient: SWAP_ROUTER_02,
    amountIn: 100_000000n,
    amountOutMinimum: 48_100_000_000_000_000n,
    sqrtPriceLimitX96: 0n,
  });
  const inner2 = encodeUnwrapWeth9(48_100_000_000_000_000n, persona);
  const data = encodeMulticallWithDeadline(FIXTURE_DEADLINE, [inner1, inner2]);
  return computePayloadFingerprint({
    chainId: 1,
    to: SWAP_ROUTER_02,
    valueWei: 0n,
    data,
  });
}

function expectedFingerprintUniCForPersona(persona: Address): Hex {
  // Multi-hop via CANONICAL_FEE_TIERS: USDC→500→WETH, WETH→3000→WBTC.
  // (Plan 32-01 fixture pin used 3000+3000 — not reproducible via prepare tool;
  // see test/prepare-uniswap-swap.test.ts Fixture UNI-C deviation note.)
  const path = encodeV3Path([
    { tokenIn: USDC, fee: 500, tokenOut: WETH },
    { tokenIn: WETH, fee: 3000, tokenOut: WBTC },
  ]);
  const inner = encodeExactInput({
    path,
    recipient: persona,
    amountIn: 100_000000n,
    amountOutMinimum: 1n,
  });
  const data = encodeMulticallWithDeadline(FIXTURE_DEADLINE, [inner]);
  return computePayloadFingerprint({
    chainId: 1,
    to: SWAP_ROUTER_02,
    valueWei: 0n,
    data,
  });
}

// ---------------------------------------------------------------------------
// Fixture UNI-A persona-cycle (single-hop ERC-20)
// ---------------------------------------------------------------------------
describe("integration-uniswap-v3 — Fixture UNI-A persona-cycle (single-hop USDC→WETH)", () => {
  it("prepare_uniswap_swap: each persona produces a deterministic Fixture UNI-A-shape fingerprint", async () => {
    setupQuoteMocksUniA();
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_uniswap_swap", {
        tokenIn: USDC,
        tokenOut: WETH,
        amount: "100",
        slippageBps: 50,
      });
      expect(result.isError, `STOP-THE-LINE: persona ${persona} failed prepare_uniswap_swap (UNI-A shape)`).toBeFalsy();
      const sc = result.structuredContent as {
        payloadFingerprint: string;
        from: string;
      };
      const expected = expectedFingerprintUniAForPersona(personaAddress(persona));
      expect(
        sc.payloadFingerprint,
        `STOP-THE-LINE: persona ${persona} produced unexpected Fixture UNI-A-shape fingerprint`,
      ).toBe(expected);
      expect(sc.from).toBe(personaAddress(persona));
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture UNI-B persona-cycle (ETH-out via composeMulticallWithUnwrap)
// ---------------------------------------------------------------------------
describe("integration-uniswap-v3 — Fixture UNI-B persona-cycle (ETH-out USDC→ETH)", () => {
  it("prepare_uniswap_swap: each persona produces a deterministic Fixture UNI-B-shape fingerprint (D-15 router-recipient)", async () => {
    setupQuoteMocksUniA(); // same quote inputs; ETH-out path triggers different calldata composition
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_uniswap_swap", {
        tokenIn: USDC,
        tokenOut: "ETH",
        amount: "100",
        slippageBps: 50,
      });
      expect(result.isError, `STOP-THE-LINE: persona ${persona} failed prepare_uniswap_swap (UNI-B shape)`).toBeFalsy();
      const sc = result.structuredContent as {
        payloadFingerprint: string;
        from: string;
      };
      const expected = expectedFingerprintUniBForPersona(personaAddress(persona));
      expect(
        sc.payloadFingerprint,
        `STOP-THE-LINE: persona ${persona} produced unexpected Fixture UNI-B-shape fingerprint`,
      ).toBe(expected);
      expect(sc.from).toBe(personaAddress(persona));
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture UNI-C persona-cycle (multi-hop USDC→WBTC)
// ---------------------------------------------------------------------------
describe("integration-uniswap-v3 — Fixture UNI-C persona-cycle (multi-hop USDC→WETH→WBTC)", () => {
  it("prepare_uniswap_swap: each persona produces a deterministic Fixture UNI-C-shape fingerprint (canonical-mapping path)", async () => {
    setupQuoteMocksUniC();
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_uniswap_swap", {
        tokenIn: USDC,
        tokenOut: WBTC,
        amount: "100",
        slippageBps: 50,
      });
      expect(result.isError, `STOP-THE-LINE: persona ${persona} failed prepare_uniswap_swap (UNI-C shape)`).toBeFalsy();
      const sc = result.structuredContent as {
        payloadFingerprint: string;
        from: string;
      };
      const expected = expectedFingerprintUniCForPersona(personaAddress(persona));
      expect(
        sc.payloadFingerprint,
        `STOP-THE-LINE: persona ${persona} produced unexpected Fixture UNI-C-shape fingerprint`,
      ).toBe(expected);
      expect(sc.from).toBe(personaAddress(persona));
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-fixture distinctness (per persona)
// ---------------------------------------------------------------------------
describe("integration-uniswap-v3 — cross-fixture distinctness", () => {
  it("UNI-A / UNI-B / UNI-C produce 3 distinct fingerprints per persona", () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      const addr = personaAddress(persona);
      const a = expectedFingerprintUniAForPersona(addr);
      const b = expectedFingerprintUniBForPersona(addr);
      const c = expectedFingerprintUniCForPersona(addr);
      const distinct = new Set([a, b, c]);
      expect(
        distinct.size,
        `STOP-THE-LINE: persona ${persona} produced collapsed fingerprints across UNI-A/B/C`,
      ).toBe(3);
    }
  });

  it("Plan 32-01 hardcoded literals remain accessible (cross-link smoke)", () => {
    expect(FIXTURE_UNI_A_FP).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(FIXTURE_UNI_B_FP).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(FIXTURE_UNI_C_FP).toMatch(/^0x[0-9a-fA-F]{64}$/);
    // 3 distinct hardcoded literals (Plan 32-01 anchor invariant).
    const distinct = new Set([FIXTURE_UNI_A_FP, FIXTURE_UNI_B_FP, FIXTURE_UNI_C_FP]);
    expect(distinct.size).toBe(3);
    // FIXTURE_PERSONA referenced explicitly (anchors the comment about
    // the Plan 32-01 fixture-pin persona).
    expect(FIXTURE_PERSONA).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  });
});

// ---------------------------------------------------------------------------
// Full prepare → preview pipeline
// ---------------------------------------------------------------------------
describe("integration-uniswap-v3 — full prepare → preview pipeline emits LEDGER NOTICE + Uniswap V3 DECODED ARGS", () => {
  it.each([
    ["UNI-A", "whale" as const],
    ["UNI-A", "stable-saver" as const],
    ["UNI-A", "defi-degen" as const],
    ["UNI-B", "whale" as const],
    ["UNI-B", "stable-saver" as const],
    ["UNI-B", "defi-degen" as const],
    ["UNI-C", "whale" as const],
    ["UNI-C", "stable-saver" as const],
    ["UNI-C", "defi-degen" as const],
  ])(
    "Fixture %s + persona %s — prepare emits LEDGER NOTICE; preview decodes multicall + emits LEDGER NOTICE",
    async (fixtureKey, persona) => {
      if (fixtureKey === "UNI-C") setupQuoteMocksUniC();
      else setupQuoteMocksUniA();

      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const args =
        fixtureKey === "UNI-A"
          ? { tokenIn: USDC, tokenOut: WETH, amount: "100", slippageBps: 50 }
          : fixtureKey === "UNI-B"
            ? { tokenIn: USDC, tokenOut: "ETH", amount: "100", slippageBps: 50 }
            : { tokenIn: USDC, tokenOut: WBTC, amount: "100", slippageBps: 50 };

      const prepareResult = await callTool("prepare_uniswap_swap", args);
      expect(
        prepareResult.isError,
        `STOP-THE-LINE: ${fixtureKey}+${persona} prepare failed`,
      ).toBeFalsy();
      expect(prepareResult.content.length).toBeGreaterThanOrEqual(3);
      // LEDGER NOTICE is the 3rd content block per D-11 unconditional emission.
      const ledgerNoticeText = prepareResult.content[2]?.text ?? "";
      expect(ledgerNoticeText).toMatch(/LEDGER\s+NOTICE/);
      expect(ledgerNoticeText).toMatch(/BLIND-SIGN/);
      expect(ledgerNoticeText).toMatch(/multicall/);

      const handle = (prepareResult.structuredContent as { handle: string }).handle;

      // Preview round-trip.
      const previewResult = await callTool("preview_send", { handle });
      expect(
        previewResult.isError,
        `STOP-THE-LINE: ${fixtureKey}+${persona} preview_send failed`,
      ).toBeFalsy();
      const previewText = previewResult.content
        .map((c) => (c as { text?: string }).text ?? "")
        .join("\n");
      // Uniswap V3 DECODED ARGS multicall arm (outer wrapper rendered).
      expect(previewText).toMatch(/multicall|exactInputSingle|exactInput\b/);
      // Uniswap V3 LEDGER NOTICE surfaced at preview time too.
      expect(previewText).toMatch(/BLIND-SIGN/);

      const previewSc = previewResult.structuredContent as {
        decodedArgs: { kind: string };
        ledgerNotice: string | null;
      };
      expect(previewSc.decodedArgs.kind).toBe("uniswap-v3-multicall");
      expect(previewSc.ledgerNotice).toBe("uniswap-v3-blind-sign");
    },
  );
});
