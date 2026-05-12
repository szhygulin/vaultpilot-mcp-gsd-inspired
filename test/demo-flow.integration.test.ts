// Plan 05-02 — DEMO FLOW INTEGRATION TEST (T-DEMO-PIPELINE-1).
//
// End-to-end assertion that the full prepare → preview → send chain works
// in demo mode against the active persona, while NEVER calling
// signClient.request (nothing signed, nothing broadcast). Mirror of Phase 4's
// `test/trust-pipeline.integration.test.ts` — same fixture anchors, same
// mock scaffolding, but exercises the demo arm of each tool.
//
// **Cryptographic-binding regression values** asserted here:
//
//   - Fixture A `payloadFingerprint`
//     `0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a`
//     — holds byte-identically across real-mode (trust-pipeline) and demo-
//     mode (this file) for the same `{ to, valueWei, chainId, data }`. PREP-03's
//     preimage is `chainId || to || valueWei || data` — `from` is NOT in it.
//     This is the load-bearing proof that the cryptographic-binding chain is
//     `from`-independent.
//
//   - Fixture C `presignHash`
//     `0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85`
//     — holds byte-identically across modes IFF the mocked RPC pins match
//     (nonce 7, gas 21000, maxFeePerGas 30 gwei, maxPriorityFeePerGas 1.5
//     gwei). The persona is the SENDER for `getTransactionCount` + `estimateGas`
//     in demo, but `from` is not in the EIP-1559 presign preimage either —
//     so under matched pins, the hash is identical.
//
// Persona under test: `whale` (vitalik.eth — `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`).
//
// DEMO-06 regression anchors: `pair_ledger_live` + `get_tx_verification`
// STILL refuse in demo mode (this plan touches neither tool). The last two
// tests in this file anchor that.
//
// **STOP-THE-LINE:** if Test 1 or Test 2 fails, the cryptographic-binding
// invariant is broken across modes. Treat as a release blocker.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

import {
  createMockPublicClient,
  type MockPublicClient,
} from "./helpers/mock-public-client.js";
import {
  createMockSignClient,
  type MockSignClient,
} from "./helpers/mock-sign-client.js";

// `vi.hoisted` declares the cross-mock-factory shared state.
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
      throw new Error("pair should not be called from demo-flow integration test");
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

import {
  _resetHandleStoreForTesting,
  lookup,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";

// Trigger side-effect registration for all tools.
await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Fixture A inputs — research § Code Example 1; Plan 04-01's
// `test/signing-fingerprint.test.ts` Test 1 anchors `0x7e1867b2...`.
const FIXTURE_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const FIXTURE_VALUE_WEI = "1000000000000000000";
const FIXTURE_PAYLOAD_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a";

// Fixture C inputs — research § Code Example 2; Plan 04-01's
// `test/signing-presign-hash.test.ts` Test 1 anchors `0xb28e4824...`.
const FIXTURE_NONCE = 7;
const FIXTURE_GAS = 21_000n;
const FIXTURE_MAX_FEE = 30_000_000_000n; // 30 gwei
const FIXTURE_MAX_PRIO = 1_500_000_000n; // 1.5 gwei
const FIXTURE_PRESIGN_HASH =
  "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85";

// Whale persona's address — Plan 05-01 `src/demo/personas.ts:48`.
const WHALE_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

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
  // Demo arm. The resolver's auto-demo seed runs ONLY when env is unset AND
  // config file is missing — we set env explicitly to "true" here, then
  // call setActivePersona explicitly per test. T-DEMO-FROM-LEAK-1: the
  // persona MUST be set explicitly so the test exercises the same code
  // path a user driving `set_demo_wallet` would.
  process.env[DEMO_KEY] = "true";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  // Pin RPC mocks to Fixture C values so presignHash anchors to Fixture C
  // byte-identically across demo and real-mode. T-PRESIGN-HASH-DRIFT-1.
  mockPublicHolder.current._setNonce(FIXTURE_NONCE);
  mockPublicHolder.current._setFees({
    maxFeePerGas: FIXTURE_MAX_FEE,
    maxPriorityFeePerGas: FIXTURE_MAX_PRIO,
  });
  mockPublicHolder.current._setGasEstimate(FIXTURE_GAS);
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
// LOAD-BEARING: demo prepare → preview → send walks the full pipeline; every
// fixture anchor holds byte-identically; signClient.request NEVER called.
// ---------------------------------------------------------------------------
describe("demo flow — prepare → preview → send simulation under whale persona (T-DEMO-PIPELINE-1)", () => {
  it("Test 1+2+3: full chain with Fixture A+C byte-identical anchors; signClient.request at 0 calls", async () => {
    // --- SETUP ---
    setActivePersona("whale");

    // --- ACT 1: prepare under demo mode ---
    const prepareResult = await callTool("prepare_native_send", {
      to: FIXTURE_TO,
      valueWei: FIXTURE_VALUE_WEI,
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      chainId: number;
      from: string;
      to: string;
      valueWei: string;
      payloadFingerprint: string;
    };
    const handle = prepareSc.handle;

    // --- ASSERT 1: persona address surfaces as `from`; payloadFingerprint
    // matches Fixture A (T-PERSONA-FINGERPRINT-DRIFT-1 / PREP-03
    // from-independence). ---
    expect(prepareSc.from).toBe(WHALE_ADDRESS);
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_PAYLOAD_FINGERPRINT);
    expect(prepareSc.chainId).toBe(1);
    expect(prepareSc.to).toBe(FIXTURE_TO);
    expect(prepareSc.valueWei).toBe(FIXTURE_VALUE_WEI);
    // Demo skips getStatus.
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    // Stored record carries the same fingerprint.
    const preparedLookup = lookup(handle);
    if (!preparedLookup.ok) throw new Error("post-prepare: handle not found");
    expect(preparedLookup.record.payloadFingerprint).toBe(FIXTURE_PAYLOAD_FINGERPRINT);
    expect(preparedLookup.record.status).toBe("prepared");

    // --- ACT 2: preview under demo mode ---
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

    // --- ASSERT 2: presignHash matches Fixture C byte-for-byte under
    // matched RPC pins; persona is the SENDER for getTransactionCount;
    // payloadFingerprint UNCHANGED across prepare → preview. ---
    expect(previewSc.presignHash).toBe(FIXTURE_PRESIGN_HASH);
    expect(previewSc.nonce).toBe(FIXTURE_NONCE);
    expect(previewSc.gas).toBe(FIXTURE_GAS.toString());
    expect(previewSc.maxFeePerGas).toBe(FIXTURE_MAX_FEE.toString());
    expect(previewSc.maxPriorityFeePerGas).toBe(FIXTURE_MAX_PRIO.toString());
    expect(previewSc.previewToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // T-DEMO-1: getStatus still 0 calls after preview (demo path skips it).
    expect(getStatusSpy).toHaveBeenCalledTimes(0);

    // T-PIN-1 / T-FROM-1: the persona address reached getTransactionCount
    // as the sender, NOT tx.to.
    const txCountCalls = mockPublicHolder.current!.__spies.getTransactionCount.mock.calls;
    expect(txCountCalls).toHaveLength(1);
    expect((txCountCalls[0]?.[1] as { address: string }).address).toBe(WHALE_ADDRESS);

    // estimateGas's `account` is also the persona's address.
    const gasCalls = mockPublicHolder.current!.__spies.estimateGas.mock.calls;
    expect(gasCalls).toHaveLength(1);
    expect((gasCalls[0]?.[1] as { account: string }).account).toBe(WHALE_ADDRESS);

    // Pinned + stored record state.
    const previewedLookup = lookup(handle);
    if (!previewedLookup.ok) throw new Error("post-preview: handle not found");
    expect(previewedLookup.record.status).toBe("previewed");
    expect(previewedLookup.record.pinned!.presignHash).toBe(FIXTURE_PRESIGN_HASH);
    expect(previewedLookup.record.pinned!.previewToken).toBe(previewToken);
    expect(previewedLookup.record.payloadFingerprint).toBe(FIXTURE_PAYLOAD_FINGERPRINT);

    // LEDGER BLIND-SIGN HASH block emitted in the response text.
    const previewText = previewResult.content[0]?.text ?? "";
    expect(previewText).toContain("LEDGER BLIND-SIGN");
    expect(previewText).toContain(FIXTURE_PRESIGN_HASH);

    // --- ACT 3: send under demo mode (simulation envelope) ---
    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });

    // --- ASSERT 3: simulation envelope; signClient.request NEVER called;
    // viem.call received `account: <whale>`; handle status stays
    // `previewed` (no real broadcast). ---
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as {
      simulated: boolean;
      simulationResult: string | null;
      simulatedAt: string;
      handle: string;
      chainId: number;
    };
    expect(sendSc.simulated).toBe(true);
    expect(sendSc.simulationResult).toBe("0x");
    expect(sendSc.simulatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sendSc.handle).toBe(handle);
    expect(sendSc.chainId).toBe(1);

    // T-DEMO-BROADCAST-1: NOTHING signed; NOTHING broadcast.
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(0);

    // Plan 05-02 load-bearing: viem.call received `account: <whale>` so
    // the simulation has a meaningful msg.sender.
    const callCalls = mockPublicHolder.current!.__spies.call.mock.calls;
    expect(callCalls).toHaveLength(1);
    expect((callCalls[0]?.[1] as { account: string }).account).toBe(WHALE_ADDRESS);

    // SIMULATION banner in the text content.
    expect(sendResult.content[0]?.text).toContain("SIMULATION (demo mode)");

    // Handle status stayed `previewed` — no real broadcast, no transition.
    const sentLookup = lookup(handle);
    if (!sentLookup.ok) throw new Error("post-send: handle not found");
    expect(sentLookup.record.status).toBe("previewed");

    // **Cryptographic-binding invariant**: from-independence holds. The
    // payloadFingerprint stored at prepare time matches Fixture A —
    // identical to the real-mode `trust-pipeline.integration.test.ts`
    // anchor — even though `from` is the persona address here vs. the
    // paired-Ledger address there. The presignHash is also byte-identical
    // under matched RPC pins.
    expect(sentLookup.record.payloadFingerprint).toBe(FIXTURE_PAYLOAD_FINGERPRINT);
    expect(sentLookup.record.pinned!.presignHash).toBe(FIXTURE_PRESIGN_HASH);
  });

  it("Test 4: cancel path under demo mode — handle transitions to cancelled; viem.call + signClient.request never called", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_native_send", {
      to: FIXTURE_TO,
      valueWei: FIXTURE_VALUE_WEI,
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;

    const previewResult = await callTool("preview_send", { handle });
    const previewToken = (previewResult.structuredContent as { previewToken: string }).previewToken;

    // Cancel — userDecision: "cancel" path. The cancel branch fires BEFORE
    // the demo simulation branch in send_transaction; viem.call must NOT
    // be invoked.
    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "cancel",
    });

    expect(sendResult.isError).toBeFalsy();
    const sc = sendResult.structuredContent as { userCancelled: boolean };
    expect(sc.userCancelled).toBe(true);

    // No simulation (viem.call), no broadcast (signClient.request).
    expect(mockPublicHolder.current!.__spies.call).not.toHaveBeenCalled();
    expect(mockSignClientHolder.current!.__requestSpy).not.toHaveBeenCalled();

    const cancelledLookup = lookup(handle);
    if (!cancelledLookup.ok) throw new Error("post-cancel: handle not found");
    expect(cancelledLookup.record.status).toBe("cancelled");
  });

  it("Test 5 (DEMO-06 regression): pair_ledger_live STILL refuses in demo mode (unchanged by Plan 05-02)", async () => {
    // Plan 05-02 does NOT touch pair_ledger_live. The demo-refusal at
    // `src/tools/pair_ledger_live.ts` stays intact — pairing is the entry
    // point of the real signing flow, and demo mode has no Ledger to pair.
    setActivePersona("whale");

    const result = await callTool("pair_ledger_live", { force: false });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DEMO_MODE_REFUSED");
    expect(result.content[0]?.text ?? "").toMatch(/demo mode/i);
  });

  it("Test 6 (DEMO-06 regression): get_tx_verification STILL refuses in demo mode (unchanged by Plan 05-02)", async () => {
    // Plan 05-02 does NOT touch get_tx_verification. Per research § DEMO-06:
    // re-emitting verification blocks would imply a real signing path; demo
    // has no real handle state worth re-emitting (the demo "wallet" doesn't
    // own real keys).
    setActivePersona("whale");

    // Seed a valid handle through the demo flow so get_tx_verification has
    // something to look up — though the demo branch refuses before lookup.
    const prepareResult = await callTool("prepare_native_send", {
      to: FIXTURE_TO,
      valueWei: FIXTURE_VALUE_WEI,
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;

    const result = await callTool("get_tx_verification", { handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DEMO_MODE_REFUSED");
  });
});
