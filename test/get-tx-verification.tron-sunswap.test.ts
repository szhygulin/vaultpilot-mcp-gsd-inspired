// `get_tx_verification` TRON SunSwap V2 swap arm regression. Phase 20 — Plan 20-01.
//
// Load-bearing invariants:
//
//   1. Prepared sunswap-swap handle → prepared-status structuredContent
//      with kind="sunswap-swap", txType="tron", dispatchCheckResult.
//   2. Previewed sunswap-swap handle → LEDGER BLIND-SIGN HASH block + PREPARE RECEIPT.
//   3. dispatchCheckResult uses checkTronSmartContractDispatchTarget (router allowlist),
//      not checkTronDispatchTarget (stablecoin allowlist). Allowed for router address.
//   4. Sent sunswap-swap handle → BROADCAST CONFIRMATION block.
//   5. PREPARE RECEIPT header "PREPARE RECEIPT (TRON — SunSwap V2 swap)" in text body.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { computeTronPayloadFingerprint } from "../src/signing/payload-fingerprint-tron.js";
import { _canonicalDispatchTron, SUNSWAP_V2_ROUTER_TRON_ADDRESS } from "../src/security/canonical-dispatch-tron.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  transitionToPreviewed,
  transitionToSent,
  type PreparedTxTron,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callGetTxVerification(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_tx_verification");
  if (!tool) throw new Error("get_tx_verification not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const WTRX = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";

const SWAP_RAW_DATA_HEX = "bb".repeat(60);
const SWAP_EXPIRATION = Date.now() + 900_000;

function buildSwapHandle() {
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
      ref_block_bytes: "00bb",
      ref_block_hash: "beefcafebeefcafe",
      expiration: SWAP_EXPIRATION,
    },
    refBlockBytes: "00bb",
    refBlockHash: "beefcafebeefcafe",
    expiration: SWAP_EXPIRATION,
    contractAddress: SUNSWAP_V2_ROUTER_TRON_ADDRESS,
    instructionSummary: [
      {
        kind: "sunswap-swap" as const,
        from: TRON_WHALE_ADDR,
        inputToken: USDT_TRC20,
        outputToken: WTRX,
        inAmount: 1_000_000n,
        outAmount: 950_000n,
        amountOutMin: 945_250n,
        path: [USDT_TRC20, WTRX],
        priceImpactBps: 30,
        slippageBps: 50,
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
      to: WTRX,
      valueWei: "0",
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: "50",
      refBlockBytes: "00bb",
      refBlockHash: "beefcafebeefcafe",
      expiration: String(SWAP_EXPIRATION),
    },
    payloadFingerprint,
  });
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  vi.restoreAllMocks();
});

// ============================================================================
// Test 1: Prepared status
// ============================================================================

describe("get_tx_verification TRON SunSwap V2 — prepared status", () => {
  it("Test 1: prepared sunswap-swap handle → structuredContent with kind + dispatchCheckResult", async () => {
    const handle = buildSwapHandle();
    const result = await callGetTxVerification({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.status).toBe("prepared");
    expect(sc.txType).toBe("tron");
    expect(sc.kind).toBe("sunswap-swap");
    expect(sc.payloadFingerprint).toBeTruthy();
    expect(sc.blockHeader).toBeDefined();
    expect(sc.rawDataHex).toBe(SWAP_RAW_DATA_HEX);

    // dispatchCheckResult uses checkTronSmartContractDispatchTarget (router allowlist)
    const dr = sc.dispatchCheckResult as { kind: string };
    expect(dr.kind).toBe("allowed");
  });

  it("Test 2: response text contains PREPARE RECEIPT (TRON — SunSwap V2 swap) header", async () => {
    const handle = buildSwapHandle();
    const result = await callGetTxVerification({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT (TRON — SunSwap V2 swap)");
    expect(text).toContain(USDT_TRC20);
    expect(text).toContain(WTRX);
  });
});

// ============================================================================
// Test 3: Previewed status
// ============================================================================

describe("get_tx_verification TRON SunSwap V2 — previewed status", () => {
  it("Test 3: previewed handle → LEDGER BLIND-SIGN HASH block in text", async () => {
    const handle = buildSwapHandle();
    // Transition to previewed
    const rawDataBytes = new Uint8Array(Buffer.from(SWAP_RAW_DATA_HEX, "hex"));
    const presignHash = "0x" + createHash("sha256").update(rawDataBytes).digest("hex");
    transitionToPreviewed(handle, {
      nonce: 0,
      gas: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      previewToken: "test-preview-token",
      presignHash,
      selector: "0x38ed1739",
    });

    const result = await callGetTxVerification({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.status).toBe("previewed");
    expect(sc.presignHash).toBe(presignHash);
    expect(sc.previewToken).toBe("test-preview-token");

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("LEDGER BLIND-SIGN HASH (TRON)");
    expect(text).toContain("PREPARE RECEIPT (TRON — SunSwap V2 swap)");
  });
});

// ============================================================================
// Test 4: Sent status
// ============================================================================

describe("get_tx_verification TRON SunSwap V2 — sent status", () => {
  it("Test 4: sent handle → BROADCAST CONFIRMATION block in text", async () => {
    const handle = buildSwapHandle();
    const rawDataBytes = new Uint8Array(Buffer.from(SWAP_RAW_DATA_HEX, "hex"));
    const presignHash = "0x" + createHash("sha256").update(rawDataBytes).digest("hex");
    transitionToPreviewed(handle, {
      nonce: 0,
      gas: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      previewToken: "test-preview-token",
      presignHash,
      selector: "0x38ed1739",
    });
    transitionToSent(handle, "deadbeefdeadbeef1234567890abcdef");

    const result = await callGetTxVerification({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.status).toBe("sent");

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("BROADCAST CONFIRMATION");
    expect(text).toContain("deadbeefdeadbeef1234567890abcdef");
  });
});
