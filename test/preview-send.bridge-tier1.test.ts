// test/preview-send.bridge-tier1.test.ts — Phase 39 Plan 39-03 (BRIDGE-T1-05, BRIDGE-T1-06).
//
// Integration tests for preview_send Layer 0.6 — Bridge Tier-1 Final-Recipient
// Assertion (Inv #6b EVM path).
//
// Behaviors covered:
//   - BRIDGE-T1-05: Mismatch refusal shape — [REFUSED — DECODED RECIPIENT DRIFT] naming
//     bridge, decoded, and supplied values; structuredContent.errorCode === "DECODED_RECIPIENT_DRIFT"
//   - BRIDGE-T1-05: Match passes — Layer 0.6 does not refuse when decoded === user-supplied
//   - BRIDGE-T1-06: Layer ordering — Layer 0.6 fires AFTER Layer 0.5 and BEFORE Layer 2
//   - BRIDGE-T1-06: DEX no-op — non-Tier-1 selector passes through Layer 0.6 silently
//   - T1-06: Malformed no-throw — truncated Tier-1 calldata returns isError:true (NEVER throws)
//   - ENCODING-AWARE: Solana base58 exact-match passes; lowercased-base58 refuses
//     (regression guard for T-BRIDGE-SOLANA-NORM-1 — proves case-sensitive base58 compare)
//
// This test mirrors test/preview-send.dispatch-allowlist.test.ts (vi.hoisted spies +
// vi.mock session-manager + viem/actions + fourbyte + bridge-decoders/index.js).
//
// NO beforeAll-snapshot per CLAUDE.md fixture discipline — all calldata literals are
// hardcoded verbatim from RESEARCH.md and Plan 39-02 test fixtures.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

import type { FourbyteResult } from "../src/clients/fourbyte.js";
import type { BridgeFacetDecodeResult } from "../src/protocols/bridge-decoders/index.js";

// ─── vi.hoisted spies ─────────────────────────────────────────────────────────

const {
  getStatusSpy,
  getTransactionCountSpy,
  estimateFeesPerGasSpy,
  estimateGasSpy,
  callSpy,
  lookupSelectorSpy,
  bridgeTier1DecoderSpy,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getTransactionCountSpy: vi.fn(),
  estimateFeesPerGasSpy: vi.fn(),
  estimateGasSpy: vi.fn(),
  callSpy: vi.fn(),
  lookupSelectorSpy: vi.fn<[Hex | null], Promise<FourbyteResult>>(),
  bridgeTier1DecoderSpy: vi.fn<[Hex], BridgeFacetDecodeResult>(),
}));

// ─── vi.mock: session-manager ─────────────────────────────────────────────────

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from these tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

// ─── vi.mock: viem/actions ────────────────────────────────────────────────────

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    getTransactionCount: (
      ...args: Parameters<typeof actual.getTransactionCount>
    ) => getTransactionCountSpy(...args),
    estimateFeesPerGas: (
      ...args: Parameters<typeof actual.estimateFeesPerGas>
    ) => estimateFeesPerGasSpy(...args),
    estimateGas: (...args: Parameters<typeof actual.estimateGas>) =>
      estimateGasSpy(...args),
    call: (...args: Parameters<typeof actual.call>) => callSpy(...args),
  };
});

// ─── vi.mock: fourbyte ────────────────────────────────────────────────────────

vi.mock("../src/clients/fourbyte.js", async () => {
  const actual = await vi.importActual<typeof import("../src/clients/fourbyte.js")>(
    "../src/clients/fourbyte.js",
  );
  return {
    ...actual,
    lookupSelector: (selector: Hex | null) => lookupSelectorSpy(selector),
  };
});

// ─── vi.mock: bridge-decoders/index.js (ESM seam for forced outcomes) ─────────
//
// We spread ...actual to keep the real registry available.
// Tests that need forced decoder outcomes (ordering, malformed, mismatch) use
// bridgeTier1DecoderSpy via this mock.
// Tests using real fixtures (DEX no-op, Solana encoding-aware) restore the spy
// to the real implementation via vi.spyOn(_bridgeTier1Decoders, ...).mockRestore()
// or reset it to undefined so the ...actual export falls through.

vi.mock("../src/protocols/bridge-decoders/index.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/protocols/bridge-decoders/index.js")
  >("../src/protocols/bridge-decoders/index.js");
  return {
    ...actual,
    _bridgeTier1Decoders: {
      decodeBridgeTier1FacetRecipient: (...args: [Hex]) => bridgeTier1DecoderSpy(...args),
    },
  };
});

// ─── Tool registration ────────────────────────────────────────────────────────

import {
  _resetHandleStoreForTesting,
  createHandle,
} from "../src/signing/handle-store.js";
import type { PreparedTxEvm } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function callPreview(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

const SENDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const FIXTURE_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [SENDER as `0x${string}`],
  activeAccount: SENDER as `0x${string}`,
  address: SENDER as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

// Aave V3 Pool Ethereum — in canonical dispatch allowlist. Used as the allowlisted
// bridge contract `tx.to` so Layer 0.5 passes and Layer 0.6 fires.
import { getAaveV3PoolAddress } from "../src/config/contracts.js";
import type { ChainId } from "../src/config/contracts.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

// Allowlisted `tx.to` for all Layer 0.6 tests (passes Layer 0.5 so Layer 0.6 can fire).
const ALLOWLISTED_TO = getAaveV3PoolAddress(1);

// LiFi Diamond — also allowlisted, for variety.
const LIFI_DIAMOND = getAddress("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE");

// Random EOA — NOT in any allowlist. Used for Layer-ordering tests.
const OFF_LIST_TO = getAddress("0xdEaDBeefDEaDbeefdEAdbEEFdEadbeeFDeAdbEEf");

// ─── Across V3 real fixture calldata ──────────────────────────────────────────
//
// Source: Ethereum mainnet tx 0xbdb62e8ece1ac5b8e0d16bd82f3c145d6b8ce8b840b8d5a8b59ea78997308560
// Function: depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)
// decoded recipient (args[1]) = 0x15528a195C4b9353D7645eBA48357a85324bb365
const ACROSS_V3_CALLDATA =
  ("0x7b939232" +
    "00000000000000000000000015528a195c4b9353d7645eba48357a85324bb365" +
    "00000000000000000000000015528a195c4b9353d7645eba48357a85324bb365" +
    "000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" +
    "00000000000000000000000082af49447d8a07e3bd95bd0d56f35241523fbab1" +
    "00000000000000000000000000000000000000000000000001118f178fb48000" +
    "000000000000000000000000000000000000000000000000011184362742503a" +
    "000000000000000000000000000000000000000000000000000000000000a4b1" +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "000000000000000000000000000000000000000000000000000000006a1861b7" +
    "000000000000000000000000000000000000000000000000000000006a187dd7" +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000180" +
    "0000000000000000000000000000000000000000000000000000000000000000") as Hex;

const ACROSS_V3_DECODED_RECIPIENT = getAddress("0x15528a195C4b9353D7645eBA48357a85324bb365");
const ACROSS_V3_MISMATCHED_RECIPIENT = getAddress("0x000000000000000000000000000000000000dEaD");

// ─── Wormhole Solana fixture calldata ─────────────────────────────────────────
//
// Constructed calldata: transferTokensWithPayload, recipientChain=1 (Solana),
// recipient bytes32 = 0x1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a
// → bs58.encode(full 32 bytes) = "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5"
// (confirmed in Plan 39-02 test/bridge-decoders-wormhole.test.ts)
const WORMHOLE_SOLANA_CALLDATA =
  ("0xc5a5ebda" +
    "000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7" +
    "0000000000000000000000000000000000000000000000000000000ba5850b00" +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a" +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "00000000000000000000000000000000000000000000000000000000000000c0" +
    "0000000000000000000000000000000000000000000000000000000000000000") as Hex;

// EXACT base58 encoding of the 32-byte Solana pubkey (case-sensitive).
// T-BRIDGE-SOLANA-NORM-1 regression guard.
const SOLANA_EXACT_BASE58 = "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5";
// Same string lowercased — would collide with EXACT if comparison were case-insensitive.
const SOLANA_LOWERCASED_BASE58 = SOLANA_EXACT_BASE58.toLowerCase();

// ─── Uniswap V3 DEX calldata (non-Tier-1 selector → no-match) ────────────────
// Uniswap V3 exactInputSingle selector 0x414bf389 — NOT in the Tier-1 bridge registry.
const UNISWAP_DEX_CALLDATA =
  ("0x414bf389" +
    "000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" +
    "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
    "0000000000000000000000000000000000000000000000000000000000000064" +
    "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" +
    "0000000000000000000000000000000000000000000000000000000067c584f7" +
    "0000000000000000000000000000000000000000000000000de0b6b3a7640000" +
    "0000000000000000000000000000000000000000000000000000000005f5e100" +
    "0000000000000000000000000000000000000000000000000000000000000000") as Hex;

// ─── Handle builder helpers ───────────────────────────────────────────────────

function buildBridgeTx(
  to: Address,
  data: Hex,
  toAddress?: string,
  chainId: ChainId = 1,
): PreparedTxEvm {
  return {
    txType: "evm",
    chainId,
    to,
    valueWei: 0n,
    data,
    ...(toAddress !== undefined ? { bridgeParams: { toAddress } } : {}),
  };
}

function seedBridgeHandle(
  to: Address,
  data: Hex,
  toAddress?: string,
  chainId: ChainId = 1,
): string {
  return createHandle({
    args: {
      to: to.toLowerCase(),
      valueWei: "0",
    },
    tx: buildBridgeTx(to, data, toAddress, chainId),
    payloadFingerprint: FIXTURE_FINGERPRINT,
  });
}

function scriptHappyMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(7);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
  });
  estimateGasSpy.mockResolvedValue(21_000n);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// ─── beforeEach / afterEach ───────────────────────────────────────────────────

beforeEach(() => {
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  callSpy.mockReset();
  lookupSelectorSpy.mockReset();
  bridgeTier1DecoderSpy.mockReset();
  lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });
  callSpy.mockResolvedValue({ data: "0x" });
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

// =============================================================================
// Test 1 — Mismatch refusal shape (BRIDGE-T1-05)
// =============================================================================
//
// A handle with Across V3 bridge selector calldata + allowlisted `to` +
// bridgeParams.toAddress that DIFFERS from the decoded finalRecipient
// → preview_send refuses with [REFUSED — DECODED RECIPIENT DRIFT] naming
//   bridge, decoded, and supplied values; errorCode === "DECODED_RECIPIENT_DRIFT".
// =============================================================================
describe("preview_send Layer 0.6 — mismatch refusal shape (BRIDGE-T1-05)", () => {
  it("(1) Tier-1 bridge calldata with mismatched toAddress → DECODED_RECIPIENT_DRIFT refusal naming bridge, decoded, supplied", async () => {
    // Force decoder to return ok with a known finalRecipient.
    bridgeTier1DecoderSpy.mockReturnValue({
      kind: "ok",
      bridge: "Across V3",
      finalRecipient: ACROSS_V3_DECODED_RECIPIENT,
    });

    // Handle has a DIFFERENT toAddress than what the decoder returns.
    const handle = seedBridgeHandle(
      ALLOWLISTED_TO,
      ACROSS_V3_CALLDATA,
      ACROSS_V3_MISMATCHED_RECIPIENT, // ← mismatch
    );

    const result = await callPreview({ handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("DECODED_RECIPIENT_DRIFT");
    expect(sc.message).toContain("[REFUSED — DECODED RECIPIENT DRIFT]");
    expect(sc.message).toContain("bridge=Across V3");
    expect(sc.message).toContain(`decoded=${ACROSS_V3_DECODED_RECIPIENT}`);
    expect(sc.message).toContain(`supplied=${ACROSS_V3_MISMATCHED_RECIPIENT}`);

    // Refusal text in content[0].text names bridge, decoded, supplied.
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/\[REFUSED — DECODED RECIPIENT DRIFT\]/);
    expect(text).toMatch(/bridge:\s+Across V3/);
    expect(text).toMatch(/decoded:\s+0x15528/);
    expect(text).toMatch(/supplied:\s+0x000000/);
  });

  it("(2) Tier-1 bridge calldata with empty toAddress (Pitfall 5) → DECODED_RECIPIENT_DRIFT (no silent pass)", async () => {
    // The user stored no toAddress — a Tier-1 selector matched but the handle
    // has no bridgeParams.toAddress. This is Pitfall 5 — must refuse.
    bridgeTier1DecoderSpy.mockReturnValue({
      kind: "ok",
      bridge: "Across V3",
      finalRecipient: ACROSS_V3_DECODED_RECIPIENT,
    });

    // No toAddress stored — bridgeParams absent.
    const handle = seedBridgeHandle(
      ALLOWLISTED_TO,
      ACROSS_V3_CALLDATA,
      undefined, // ← no toAddress
    );

    const result = await callPreview({ handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DECODED_RECIPIENT_DRIFT");
  });
});

// =============================================================================
// Test 2 — Match passes (BRIDGE-T1-05)
// =============================================================================
//
// Same handle but bridgeParams.toAddress === decoded finalRecipient →
// Layer 0.6 does NOT refuse (flow proceeds past Layer 0.6).
// =============================================================================
describe("preview_send Layer 0.6 — match passes (BRIDGE-T1-05)", () => {
  it("(3) Tier-1 bridge calldata with MATCHING toAddress → no DECODED_RECIPIENT_DRIFT", async () => {
    bridgeTier1DecoderSpy.mockReturnValue({
      kind: "ok",
      bridge: "Across V3",
      finalRecipient: ACROSS_V3_DECODED_RECIPIENT,
    });

    // toAddress MATCHES the decoded finalRecipient.
    const handle = seedBridgeHandle(
      ALLOWLISTED_TO,
      ACROSS_V3_CALLDATA,
      ACROSS_V3_DECODED_RECIPIENT, // ← match
    );
    scriptHappyMocks();

    const result = await callPreview({ handle });

    // Layer 0.6 did not refuse.
    const sc = result.structuredContent as { errorCode?: string };
    expect(sc.errorCode).not.toBe("DECODED_RECIPIENT_DRIFT");
  });
});

// =============================================================================
// Test 3 — Layer ordering (BRIDGE-T1-06)
// =============================================================================
//
// 3a. A handle triggering BOTH Layer 0.6 (mismatch) AND Layer 2 (chain mismatch)
//     → DECODED_RECIPIENT_DRIFT (Layer 0.6 fires BEFORE Layer 2).
//
// 3b. A handle triggering BOTH Layer 0.5 (non-allowlisted to) AND Layer 0.6
//     → DISPATCH_TARGET_REFUSED (Layer 0.5 fires BEFORE Layer 0.6).
// =============================================================================
describe("preview_send Layer ordering — Layer 0.5 → Layer 0.6 → Layer 2 (BRIDGE-T1-06)", () => {
  it("(4) [both Layer 0.6 + Layer 2] → DECODED_RECIPIENT_DRIFT wins (Layer 0.6 before Layer 2)", async () => {
    // Decoder returns mismatch.
    bridgeTier1DecoderSpy.mockReturnValue({
      kind: "ok",
      bridge: "Across V3",
      finalRecipient: ACROSS_V3_DECODED_RECIPIENT,
    });

    // Handle: chainId=1, tx.to is allowlisted, data is Tier-1 bridge calldata,
    // toAddress mismatches → Layer 0.6 fires.
    // Agent claims chain="polygon" (chainId=137) → Layer 2 would fire.
    // Layer 0.6 wins first.
    const handle = seedBridgeHandle(
      ALLOWLISTED_TO,
      ACROSS_V3_CALLDATA,
      ACROSS_V3_MISMATCHED_RECIPIENT,
      1, // handle prepared for chainId=1
    );

    const result = await callPreview({ handle, chain: "polygon" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DECODED_RECIPIENT_DRIFT");
    expect(sc.errorCode).not.toBe("CHAIN_ID_MISMATCH");
  });

  it("(5) [non-allowlisted tx.to + Layer 0.6 mismatch] → DISPATCH_TARGET_REFUSED wins (Layer 0.5 before Layer 0.6)", async () => {
    // Decoder would return a mismatch — but Layer 0.5 fires first.
    bridgeTier1DecoderSpy.mockReturnValue({
      kind: "ok",
      bridge: "Across V3",
      finalRecipient: ACROSS_V3_DECODED_RECIPIENT,
    });

    // tx.to is OFF-LIST — Layer 0.5 refuses.
    const handle = seedBridgeHandle(
      OFF_LIST_TO,     // ← not in canonical dispatch
      ACROSS_V3_CALLDATA,
      ACROSS_V3_MISMATCHED_RECIPIENT,
    );

    const result = await callPreview({ handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DISPATCH_TARGET_REFUSED");
    expect(sc.errorCode).not.toBe("DECODED_RECIPIENT_DRIFT");
  });
});

// =============================================================================
// Test 4 — DEX no-op (BRIDGE-T1-06)
// =============================================================================
//
// A Uniswap V3 exactInputSingle call (non-Tier-1 selector) →
// decodeBridgeTier1FacetRecipient returns { kind: "no-match" } → Layer 0.6
// passes through silently — no DECODED_RECIPIENT_DRIFT error.
// =============================================================================
describe("preview_send Layer 0.6 — DEX no-op (BRIDGE-T1-06)", () => {
  it("(6) Uniswap V3 DEX calldata (non-Tier-1 selector) → no DECODED_RECIPIENT_DRIFT (Layer 0.6 is a pass-through)", async () => {
    // Use the REAL decoder registry (not the spy) — the Uniswap selector 0x414bf389
    // is not in TIER1_DECODERS, so decodeBridgeTier1FacetRecipient returns no-match.
    // The vi.mock above wraps via bridgeTier1DecoderSpy; we need to pass through
    // to the actual implementation for this test by configuring the spy to call real.
    const { _bridgeTier1Decoders: realDecoders } = await vi.importActual<
      typeof import("../src/protocols/bridge-decoders/index.js")
    >("../src/protocols/bridge-decoders/index.js");
    bridgeTier1DecoderSpy.mockImplementation(
      (data: Hex) => realDecoders.decodeBridgeTier1FacetRecipient(data),
    );

    const handle = seedBridgeHandle(
      ALLOWLISTED_TO,
      UNISWAP_DEX_CALLDATA,
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // toAddress present but irrelevant
    );
    scriptHappyMocks();

    const result = await callPreview({ handle });

    // Layer 0.6 was a no-op; the flow proceeded (may succeed or fail for other
    // reasons, but NOT with DECODED_RECIPIENT_DRIFT).
    const sc = result.structuredContent as { errorCode?: string };
    expect(sc.errorCode).not.toBe("DECODED_RECIPIENT_DRIFT");
  });
});

// =============================================================================
// Test 5 — Malformed calldata no-throw
// =============================================================================
//
// A Tier-1 selector followed by truncated/malformed bytes → the decoder
// returns { kind: "error" } (WR-02 NEVER-throws) → preview_send returns
// isError:true with DECODED_RECIPIENT_DRIFT. Does NOT throw / crash the preview flow.
// =============================================================================
describe("preview_send Layer 0.6 — malformed calldata no-throw", () => {
  it("(7) Tier-1 selector + truncated calldata → isError:true, DECODED_RECIPIENT_DRIFT, no throw", async () => {
    // Force the decoder to return an error (simulates truncated calldata).
    bridgeTier1DecoderSpy.mockReturnValue({
      kind: "error",
      bridge: "Across V3",
      message: "ABI decode failed: data too short",
    });

    // Truncated Across V3 calldata — just the selector, no args.
    const TRUNCATED_CALLDATA = "0x7b939232" as Hex;
    const handle = seedBridgeHandle(
      ALLOWLISTED_TO,
      TRUNCATED_CALLDATA,
      ACROSS_V3_DECODED_RECIPIENT,
    );

    // Must return isError:true — must NOT throw or produce an unhandled rejection.
    let result: Awaited<ReturnType<typeof callPreview>>;
    await expect(async () => {
      result = await callPreview({ handle });
    }).not.toThrow();

    result = await callPreview({ handle });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("DECODED_RECIPIENT_DRIFT");
    expect(sc.message).toContain("bridge decode error");
  });
});

// =============================================================================
// Test 6 — Encoding-aware compare: Solana base58 case-sensitive (T-BRIDGE-SOLANA-NORM-1)
// =============================================================================
//
// Uses the REAL decoder registry against the Wormhole Solana calldata fixture.
// The decoder returns finalRecipient = "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5"
// (exact case-sensitive base58 encoding).
//
// Two sub-cases:
//   (a) bridgeParams.toAddress = EXACT base58 string → Layer 0.6 MATCHES (passes).
//   (b) bridgeParams.toAddress = same string lowercased → Layer 0.6 REFUSES.
//       This proves the compare is CASE-SENSITIVE for base58 — NOT a naive
//       both-sides-.toLowerCase() implementation. This is the regression guard
//       for T-BRIDGE-SOLANA-NORM-1 and the CONTEXT critical_correctness_constraint.
// =============================================================================
describe("preview_send Layer 0.6 — Solana base58 encoding-aware compare (T-BRIDGE-SOLANA-NORM-1)", () => {
  it("(8) Wormhole Solana Tier-1 calldata with EXACT base58 toAddress → Layer 0.6 MATCHES (no DECODED_RECIPIENT_DRIFT)", async () => {
    // Use the REAL decoder — it decodes the Wormhole Solana fixture and returns
    // finalRecipient = "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5" (exact base58).
    const { _bridgeTier1Decoders: realDecoders } = await vi.importActual<
      typeof import("../src/protocols/bridge-decoders/index.js")
    >("../src/protocols/bridge-decoders/index.js");
    bridgeTier1DecoderSpy.mockImplementation(
      (data: Hex) => realDecoders.decodeBridgeTier1FacetRecipient(data),
    );

    // Wormhole address is NOT in canonical dispatch allowlist as a direct entry;
    // we use LIFI_DIAMOND (allowlisted) as tx.to so Layer 0.5 passes.
    const handle = seedBridgeHandle(
      LIFI_DIAMOND,
      WORMHOLE_SOLANA_CALLDATA,
      SOLANA_EXACT_BASE58, // ← EXACT case-sensitive match
    );
    scriptHappyMocks();

    const result = await callPreview({ handle });

    // Layer 0.6 passed through — no DECODED_RECIPIENT_DRIFT.
    const sc = result.structuredContent as { errorCode?: string };
    expect(sc.errorCode).not.toBe("DECODED_RECIPIENT_DRIFT");
  });

  it("(9) Wormhole Solana Tier-1 calldata with LOWERCASED base58 toAddress → Layer 0.6 REFUSES (case-sensitive compare proven)", async () => {
    // REGRESSION GUARD (T-BRIDGE-SOLANA-NORM-1): if the compare used
    // .toLowerCase() on both sides, this test would INCORRECTLY pass.
    // The test MUST refuse because lowercased base58 ≠ canonical base58.
    // Lowercasing a base58 string changes the address — case IS significant.
    const { _bridgeTier1Decoders: realDecoders } = await vi.importActual<
      typeof import("../src/protocols/bridge-decoders/index.js")
    >("../src/protocols/bridge-decoders/index.js");
    bridgeTier1DecoderSpy.mockImplementation(
      (data: Hex) => realDecoders.decodeBridgeTier1FacetRecipient(data),
    );

    const handle = seedBridgeHandle(
      LIFI_DIAMOND,
      WORMHOLE_SOLANA_CALLDATA,
      SOLANA_LOWERCASED_BASE58, // ← lowercased — must MISMATCH the canonical base58
    );

    const result = await callPreview({ handle });

    // Must refuse with DECODED_RECIPIENT_DRIFT — proves case-sensitive compare.
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DECODED_RECIPIENT_DRIFT");
    // Verify the refusal text confirms the mismatch.
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/\[REFUSED — DECODED RECIPIENT DRIFT\]/);
  });
});
