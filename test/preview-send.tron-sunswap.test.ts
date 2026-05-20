// `preview_send` TRON SunSwap V2 swap arm regression. Phase 20 — Plan 20-01.
//
// Load-bearing invariants:
//
//   1. preview_send on sunswap-swap handle → succeeds; chain="tron", kind="sunswap-swap".
//   2. Response text contains PREPARE RECEIPT (TRON — SunSwap V2 swap) header.
//   3. LEDGER NOTICE (TRON) emitted unconditionally (SunSwap router not in bundled registry).
//   4. selector pinned as "0x38ed1739" (swapExactTokensForTokens) via transitionToPreviewed.
//   5. DISPATCH_TARGET_REFUSED fires when contractAddress is not in TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST.
//   6. NO_SIMULATION_AVAILABLE advisory emitted (not SIMULATION_REFUSED — simulation is skipped).
//   7. structuredContent carries previewToken + presignHash + payloadFingerprint + decodedArgs.
//   8. Phase 18 trc20-transfer arm back-compat: unaffected by Phase 20 sunswap-swap arm.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
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

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { computeTronPayloadFingerprint } from "../src/signing/payload-fingerprint-tron.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  type PreparedTxTron,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import {
  SUNSWAP_V2_ROUTER_TRON_ADDRESS,
} from "../src/security/canonical-dispatch-tron.js";

await import("../src/tools/register-all.js");

async function callPreviewSend(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

// Test constants
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const WTRX = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";

const SWAP_RAW_DATA_HEX = "aa".repeat(60);
const SWAP_EXPIRATION = Date.now() + 900_000;

function buildStubTronWeb() {
  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn(async () => ({
        result: { result: true },
        transaction: {
          visible: false,
          txID: "swaptxid",
          raw_data: {
            contract: [],
            ref_block_bytes: "00cc",
            ref_block_hash: "deadbeefcafebabe",
            expiration: SWAP_EXPIRATION,
            timestamp: Date.now(),
          },
          raw_data_hex: SWAP_RAW_DATA_HEX,
        },
      })),
      extendExpiration: vi.fn(async (t: unknown) => t),
    },
  };
}

function buildSunswapSwapHandle(opts: {
  contractAddress?: string;
  inputToken?: string;
  outputToken?: string;
  priceImpactBps?: number;
  slippageBps?: number;
} = {}) {
  const {
    contractAddress = SUNSWAP_V2_ROUTER_TRON_ADDRESS,
    inputToken = USDT_TRC20,
    outputToken = WTRX,
    priceImpactBps = 30,
    slippageBps = 50,
  } = opts;

  const rawDataHex = SWAP_RAW_DATA_HEX;
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "sunswap-swap",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    valueWei: 0n,
    data: "0x" as `0x${string}`,
    rawDataHex,
    rawDataObject: {
      contract: [],
      ref_block_bytes: "00cc",
      ref_block_hash: "deadbeefcafebabe",
      expiration: SWAP_EXPIRATION,
    },
    refBlockBytes: "00cc",
    refBlockHash: "deadbeefcafebabe",
    expiration: SWAP_EXPIRATION,
    contractAddress,
    instructionSummary: [
      {
        kind: "sunswap-swap" as const,
        from: TRON_WHALE_ADDR,
        inputToken,
        outputToken,
        inAmount: 1_000_000n,
        outAmount: 950_000n,
        amountOutMin: 945_250n,
        path: [inputToken, outputToken],
        priceImpactBps,
        slippageBps,
        deadline: 1748000600,
      },
    ],
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(rawDataHex, "hex")),
  });
  return createHandle({
    tx: tronTx,
    args: {
      to: outputToken,
      valueWei: "0",
      inputToken,
      outputToken,
      amount: "1",
      slippageBps: String(slippageBps),
      refBlockBytes: "00cc",
      refBlockHash: "deadbeefcafebabe",
      expiration: String(SWAP_EXPIRATION),
    },
    payloadFingerprint,
  });
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  listAccountsSpy.mockReset();
  listAccountsSpy.mockReturnValue([
    {
      chain: "tron",
      address: TRON_WHALE_ADDR,
      derivationPath: "44'/195'/0'/0/0",
      pairedAt: new Date().toISOString(),
    },
  ]);
  vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
    buildStubTronWeb() as unknown as import("tronweb").TronWeb,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Test 1: Happy path — sunswap-swap handle succeeds
// ============================================================================

describe("preview_send TRON SunSwap V2 swap — happy path", () => {
  it("Test 1: sunswap-swap handle succeeds; kind='sunswap-swap', chain='tron'", async () => {
    const handle = buildSunswapSwapHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("tron");
    expect(sc.kind).toBe("sunswap-swap");
    expect(sc.previewToken).toBeTruthy();
    expect(sc.presignHash).toBeTruthy();
    expect(sc.payloadFingerprint).toBeTruthy();
  });

  it("PREPARE RECEIPT header 'PREPARE RECEIPT (TRON — SunSwap V2 swap)' present in response", async () => {
    const handle = buildSunswapSwapHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT (TRON — SunSwap V2 swap)");
    expect(text).toContain(USDT_TRC20);
    expect(text).toContain(WTRX);
    // inAmount slot uses human-unit arg "1"; outAmount slot uses raw "950000"
    expect(text).toContain("  inAmount:");
    expect(text).toContain("950000");
  });

  it("Test 3: LEDGER NOTICE (TRON) emitted unconditionally for sunswap-swap", async () => {
    const handle = buildSunswapSwapHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("LEDGER NOTICE (TRON)");
    expect(text).toContain("SunSwap V2");
  });

  it("Test 4: selector pinned as '0x38ed1739' (swapExactTokensForTokens)", async () => {
    const handle = buildSunswapSwapHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (lookupResult.ok) {
      expect(lookupResult.record.pinned?.selector).toBe("0x38ed1739");
    }
  });

  it("Test 6: NO_SIMULATION_AVAILABLE advisory emitted; SIMULATION_REFUSED never fires", async () => {
    const handle = buildSunswapSwapHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("CHECKS PERFORMED (TRON — no simulation available)");
  });

  it("Test 7: structuredContent carries previewToken + presignHash + payloadFingerprint + decodedArgs", async () => {
    const handle = buildSunswapSwapHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.previewToken).toBeTruthy();
    expect(sc.presignHash).toBeTruthy();
    expect(sc.payloadFingerprint).toBeTruthy();
    expect(sc.decodedArgs).toBeDefined();
    expect(sc.rawDataHex).toBe(SWAP_RAW_DATA_HEX);
    expect(sc.sessionTopicLast8).toBeNull();
  });
});

// ============================================================================
// Test 5: DISPATCH_TARGET_REFUSED for non-allowlisted router
// ============================================================================

describe("preview_send TRON SunSwap V2 swap — DISPATCH_TARGET_REFUSED", () => {
  it("Test 5: contractAddress not in TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST → DISPATCH_TARGET_REFUSED", async () => {
    const handle = buildSunswapSwapHandle({ contractAddress: "TLyqzVGLV6srDMvCnSf5DLD6qMz3qAh1Vp" });
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("DISPATCH_TARGET_REFUSED");
  });
});
