// Plan 04-04 — TRUST PIPELINE INTEGRATION TEST (T-PIPELINE-1).
//
// This is the project's LOAD-BEARING end-to-end assertion that the entire
// prepare → preview → send pipeline holds: every byte the mock device
// "signs" matches the byte the mock MCP prepared. Research § Q12 + Code
// Examples 1 + 2 anchor the fixtures.
//
// Fixture A (research § Code Example 1, asserted in
// test/signing-fingerprint.test.ts):
//   - to: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
//   - valueWei: 1 ETH = 1_000_000_000_000_000_000n
//   - chainId: 1, data: "0x"
//   - payloadFingerprint: 0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a
//
// Fixture C (research § Code Example 2, asserted in
// test/signing-presign-hash.test.ts):
//   - nonce: 7, gas: 21000n, maxFeePerGas: 30 gwei, maxPriorityFeePerGas: 1.5 gwei
//   - presignHash: 0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85
//
// Mock-broadcasted txHash anchor: 0x00..bee5 (chosen fixed value — stays
// stable across runs so the assertion doesn't depend on the WC SDK's
// hash semantics).
//
// The cryptographic-binding invariant asserted here: prepare-time
// payloadFingerprint == send-time recomputed fingerprint; preview-time
// presignHash == device's expected blind-sign hash; signClient.request
// called with EXACT pinned tuple (no re-fetch at send time).
//
// **STOP-THE-LINE:** if this test fails, the trust pipeline is broken.
// Treat any failure as a release blocker.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

import {
  createMockPublicClient,
  type MockPublicClient,
} from "./helpers/mock-public-client.js";
import {
  buildMockSession,
  createMockSignClient,
  type MockSignClient,
} from "./helpers/mock-sign-client.js";

// `vi.hoisted` declares the cross-mock-factory shared state. Spies +
// holder references for the three mocked modules.
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
      throw new Error("pair should not be called from trust-pipeline integration test");
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

// 4byte client — for native sends (data === "0x"), `lookupSelector(null)`
// returns `{ kind: "not-applicable" }` synchronously without a network
// call (per Plan 04-05). We let the real client run (no mock here) — the
// short-circuit fires before any HTTP.

import {
  _resetHandleStoreForTesting,
  lookup,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

// Trigger side-effect registration for all tools.
await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const FIXTURE_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const FIXTURE_VALUE_WEI = "1000000000000000000";
const FIXTURE_PAYLOAD_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a";
const FIXTURE_PRESIGN_HASH =
  "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85";
const FIXTURE_TX_HASH =
  "0x000000000000000000000000000000000000000000000000000000000000bee5" as Hex;
const FIXTURE_TOPIC =
  "0xfeedfacecafebeef0000000000000000000000000000000000000000c0ffee";
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [FIXTURE_TO as `0x${string}`],
  activeAccount: FIXTURE_TO as `0x${string}`,
  address: FIXTURE_TO as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "00c0ffee",
};

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`${name} not registered`);
  return tool.handler(args);
}

beforeEach(() => {
  getStatusSpy.mockReset();
  getActiveSessionTopicSpy.mockReset();
  _resetHandleStoreForTesting();
  mockPublicHolder.current = createMockPublicClient();
  mockSignClientHolder.current = createMockSignClient();
  savedDemo = process.env[DEMO_KEY];
  // Phase 5 / Plan 05-01: pin to "false" so the resolver picks
  // real-mode deterministically; reset cache so each test starts clean.
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// LOAD-BEARING: end-to-end prepare → preview → send with byte-identical
// anchors at every transition. If this fails, the trust pipeline is broken.
// ---------------------------------------------------------------------------
describe("trust pipeline — prepare → preview → send with Fixture A+C byte-identical anchors (T-PIPELINE-1)", () => {
  it("walks the full pipeline; cryptographic-binding invariant holds end-to-end", async () => {
    // --- ARRANGE ---
    // viem-side pin script (Fixture C): nonce 7, fees 30/1.5 gwei, gas 21k.
    mockPublicHolder.current!._setNonce(7);
    mockPublicHolder.current!._setFees({
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
    });
    mockPublicHolder.current!._setGasEstimate(21_000n);

    // WC-side: script the mock-broadcasted txHash. Also seed the session
    // store so `findLiveSession` (transitively touched by getStatus in
    // production code) returns a live session — but here we mock getStatus
    // directly so this is documentation-only.
    mockSignClientHolder.current!._setRequestResponse(
      "eth_sendTransaction",
      FIXTURE_TX_HASH,
    );
    mockSignClientHolder.current!._setSessionsInStore([
      buildMockSession({ chainId: 1, address: FIXTURE_TO, topic: FIXTURE_TOPIC }),
    ]);

    // Session-manager mocks: paired status + topic.
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    getActiveSessionTopicSpy.mockReturnValue(FIXTURE_TOPIC);

    // --- ACT 1: prepare ---
    const prepareResult = await callTool("prepare_native_send", {
      to: FIXTURE_TO,
      valueWei: FIXTURE_VALUE_WEI,
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      chainId: number;
      to: string;
      valueWei: string;
      payloadFingerprint: string;
    };
    const handle = prepareSc.handle;

    // --- ASSERT 1: payloadFingerprint matches Fixture A ---
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_PAYLOAD_FINGERPRINT);
    const preparedLookup = lookup(handle);
    if (!preparedLookup.ok) throw new Error("post-prepare: handle not found");
    expect(preparedLookup.record.payloadFingerprint).toBe(FIXTURE_PAYLOAD_FINGERPRINT);
    expect(preparedLookup.record.status).toBe("prepared");

    // --- ACT 2: preview ---
    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();
    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      presignHash: string;
      chainId: number;
      nonce: number;
      gas: string;
      maxFeePerGas: string;
      maxPriorityFeePerGas: string;
    };
    const previewToken = previewSc.previewToken;

    // --- ASSERT 2: presign hash matches Fixture C; pinned values match the
    // scripted mock; payloadFingerprint UNCHANGED between prepare and preview.
    expect(previewSc.presignHash).toBe(FIXTURE_PRESIGN_HASH);
    expect(previewSc.nonce).toBe(7);
    expect(previewSc.gas).toBe("21000");
    expect(previewSc.maxFeePerGas).toBe("30000000000");
    expect(previewSc.maxPriorityFeePerGas).toBe("1500000000");
    const previewedLookup = lookup(handle);
    if (!previewedLookup.ok) throw new Error("post-preview: handle not found");
    const previewedRecord = previewedLookup.record;
    expect(previewedRecord.status).toBe("previewed");
    expect(previewedRecord.pinned!.presignHash).toBe(FIXTURE_PRESIGN_HASH);
    expect(previewedRecord.pinned!.previewToken).toBe(previewToken);
    expect(previewedRecord.payloadFingerprint).toBe(preparedLookup.record.payloadFingerprint);

    // --- ACT 3: send ---
    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });

    // --- ASSERT 3: WC request received EXACT pinned params; no re-fetch at
    // send time; txHash echoed; handle status `sent`.
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as {
      txHash: string;
      broadcastedAt: string;
      handle: string;
      chainId: number;
    };
    expect(sendSc.txHash).toBe(FIXTURE_TX_HASH);
    expect(sendSc.broadcastedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sendSc.handle).toBe(handle);
    expect(sendSc.chainId).toBe(1);

    // Load-bearing assertion: signClient.request received the EXACT pinned
    // tuple. Any contributor that re-fetches nonce/fees/gas at send time
    // (or re-constructs params from agent args) would diverge here.
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(1);
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledWith({
      topic: FIXTURE_TOPIC,
      chainId: "eip155:1",
      request: {
        method: "eth_sendTransaction",
        params: [
          {
            from: FIXTURE_TO,
            to: FIXTURE_TO,
            value: "0xde0b6b3a7640000",
            gas: "0x5208",
            maxFeePerGas: "0x6fc23ac00",
            maxPriorityFeePerGas: "0x59682f00",
            nonce: "0x7",
            data: "0x",
          },
        ],
      },
    });

    // "No re-fetch at send time" — the three viem read spies are at their
    // preview-time call count (exactly ONE each). A regression that
    // re-resolves nonce/fees at send time would push these to TWO and
    // break the trust binding (the bytes the user verified against the
    // LEDGER BLIND-SIGN HASH would no longer match the bytes the device
    // receives).
    expect(mockPublicHolder.current!.__spies.getTransactionCount).toHaveBeenCalledTimes(1);
    expect(mockPublicHolder.current!.__spies.estimateFeesPerGas).toHaveBeenCalledTimes(1);
    expect(mockPublicHolder.current!.__spies.estimateGas).toHaveBeenCalledTimes(1);

    // Final state: handle transitioned to `sent` with the broadcasted hash.
    const sentLookup = lookup(handle);
    if (!sentLookup.ok) throw new Error("post-send: handle not found");
    const sentRecord = sentLookup.record;
    expect(sentRecord.status).toBe("sent");
    expect(sentRecord.txHash).toBe(FIXTURE_TX_HASH);

    // **Cryptographic-binding invariant**: every byte the mock device
    // "signed" matches the byte the mock MCP prepared. The fingerprint
    // never drifts across the three transitions; the presign hash matches
    // the EIP-1559 envelope; the WC params match the preview-pinned
    // values verbatim.
    expect(sentRecord.payloadFingerprint).toBe(preparedLookup.record.payloadFingerprint);
    expect(sentRecord.pinned!.presignHash).toBe(previewedRecord.pinned!.presignHash);
  });

  it("send without preview refuses with PREVIEW_REQUIRED; signClient.request never called", async () => {
    // Mocks set up but preview is SKIPPED.
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    getActiveSessionTopicSpy.mockReturnValue(FIXTURE_TOPIC);

    const prepareResult = await callTool("prepare_native_send", {
      to: FIXTURE_TO,
      valueWei: FIXTURE_VALUE_WEI,
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;

    // Jump straight to send — no preview run.
    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken: "fabricated-token-uuid",
      userDecision: "send",
    });
    expect(sendResult.isError).toBe(true);
    const sc = sendResult.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_REQUIRED");
    expect(mockSignClientHolder.current!.__requestSpy).not.toHaveBeenCalled();
  });

  it("cancel path — prepare → preview → cancel returns userCancelled; no broadcast", async () => {
    mockPublicHolder.current!._setNonce(7);
    mockPublicHolder.current!._setFees({
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
    });
    mockPublicHolder.current!._setGasEstimate(21_000n);
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    getActiveSessionTopicSpy.mockReturnValue(FIXTURE_TOPIC);

    const prepareResult = await callTool("prepare_native_send", {
      to: FIXTURE_TO,
      valueWei: FIXTURE_VALUE_WEI,
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    const previewResult = await callTool("preview_send", { handle });
    const previewToken = (previewResult.structuredContent as { previewToken: string }).previewToken;

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "cancel",
    });

    expect(sendResult.isError).toBeFalsy();
    const sc = sendResult.structuredContent as { userCancelled: boolean };
    expect(sc.userCancelled).toBe(true);
    expect(mockSignClientHolder.current!.__requestSpy).not.toHaveBeenCalled();
    const cancelledLookup = lookup(handle);
    if (!cancelledLookup.ok) throw new Error("post-cancel: handle not found");
    expect(cancelledLookup.record.status).toBe("cancelled");
  });
});
