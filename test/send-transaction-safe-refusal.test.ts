// send_transaction WRONG_HANDLE_KIND refusal arm — Phase 37 Plan 37-03 (SAFE-08).
//
// Anchors:
//   - PreparedTxSafeTypedData handle → send_transaction returns WRONG_HANDLE_KIND
//     with hint pointing to submit_safe_tx_signature (off-chain typed-data
//     handles do NOT broadcast).
//   - The refusal happens BEFORE WC signClient.request — assert via mock
//     that WC is NOT called.
//   - The refusal happens BEFORE any state-machine transition — the handle
//     stays in its current state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, PublicClient } from "viem";

import { createMockSignClient, type MockSignClient } from "./helpers/mock-sign-client.js";

vi.mock("../src/chains/registry.js", () => ({
  getChainClient: (_chainId: number) =>
    ({
      multicall: vi.fn(),
      readContract: vi.fn(),
    }) as unknown as PublicClient,
  isPublicNodeFallback: () => false,
  _resetChainRegistryForTesting: () => {},
  PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
}));

const {
  getStatusSpy,
  getActiveSessionTopicSpy,
  mockSignClientHolder,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getActiveSessionTopicSpy: vi.fn<[], string | null>(),
  mockSignClientHolder: { current: null as MockSignClient | null },
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
      "../src/wallet/session-manager.js",
    );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) =>
      getStatusSpy(...args),
    getActiveSessionTopic: () => getActiveSessionTopicSpy(),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("../src/wallet/walletconnect-client.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/wallet/walletconnect-client.js")>(
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

import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  createHandle,
  type PreparedTxSafeTypedData,
} from "../src/signing/handle-store.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

const SAFE_ADDR: Address = "0x1234567890123456789012345678901234567890";
const TO_ADDR: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SIGNER_ADDR: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SAFE_TX_HASH: Hex =
  "0xf5073f5eabcb7ff540becf339c3bbe2b5f41b5f9fec8ae1e42847d9a25fedf0a";

function mintSafeTypedDataHandle(): string {
  const tx: PreparedTxSafeTypedData = {
    txType: "safe-typed-data",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000",
    valueWei: 0n,
    data: "0x",
    chain: 1,
    safeAddress: SAFE_ADDR,
    safeVersion: "1.3.0",
    safeTxHash: SAFE_TX_HASH,
    safeNonce: 42n,
    operation: "call",
    safeTxTo: TO_ADDR,
    safeTxValue: 1_000_000_000_000_000_000n,
    safeTxData: "0x",
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: "0x0000000000000000000000000000000000000000",
    refundReceiver: "0x0000000000000000000000000000000000000000",
    typedDataStructure: {
      domain: { chainId: 1, verifyingContract: SAFE_ADDR },
      types: {} as never,
      primaryType: "SafeTx",
      message: {} as never,
    },
  };
  return createHandle({
    args: { to: SAFE_ADDR, valueWei: "0" },
    tx,
    payloadFingerprint:
      "0xbd55bd01d22779249cb10b8ecea6f87c85f511a024175b7dc0aa3ac1c7dad71b" as Hex,
  });
}

async function callSendTransaction(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("send_transaction");
  if (!tool) throw new Error("send_transaction not registered");
  return tool.handler(args);
}

beforeEach(() => {
  getStatusSpy.mockReset();
  getActiveSessionTopicSpy.mockReset();
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  delete process.env["VAULTPILOT_DEMO"];
  _resetDemoModeForTesting();
  mockSignClientHolder.current = createMockSignClient();
  getStatusSpy.mockResolvedValue({
    paired: true,
    accounts: [SIGNER_ADDR],
    activeAccount: SIGNER_ADDR,
    address: SIGNER_ADDR,
    chainId: 1,
    sessionTopicLast8: "deadbeef",
    accountsByChain: { 1: [SIGNER_ADDR] },
    activeChainId: 1,
    partiallyPaired: false,
  });
  getActiveSessionTopicSpy.mockReturnValue("topic-deadbeef");
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetActivePersonaForTesting();
  _resetDemoModeForTesting();
  mockSignClientHolder.current = null;
});

describe("send_transaction — WRONG_HANDLE_KIND refusal for safe-typed-data handles", () => {
  it("refuses with WRONG_HANDLE_KIND when handle.tx.txType === 'safe-typed-data'", async () => {
    const handle = mintSafeTypedDataHandle();
    const result = await callSendTransaction({
      handle,
      previewToken: "any-token",
      userDecision: "send",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WRONG_HANDLE_KIND");
    expect(String(sc.message)).toMatch(/submit_safe_tx_signature/);
  });

  it("does NOT invoke WalletConnect signClient.request in the refusal path", async () => {
    const handle = mintSafeTypedDataHandle();
    await callSendTransaction({
      handle,
      previewToken: "any-token",
      userDecision: "send",
    });
    const wc = mockSignClientHolder.current!.client;
    // `request` is a vi.fn — assert it was never called.
    expect(wc.request).not.toHaveBeenCalled();
  });

  it("does NOT transition the handle state (stays 'prepared')", async () => {
    const handle = mintSafeTypedDataHandle();
    const beforeRecord = _peekHandleForTesting(handle);
    expect(beforeRecord?.status).toBe("prepared");
    await callSendTransaction({
      handle,
      previewToken: "any-token",
      userDecision: "send",
    });
    const afterRecord = _peekHandleForTesting(handle);
    expect(afterRecord?.status).toBe("prepared");
  });
});
