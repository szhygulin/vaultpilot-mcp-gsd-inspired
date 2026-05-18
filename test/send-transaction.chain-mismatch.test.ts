// Phase 8 — Plan 08-02. send_transaction chain-binding regression.
//
// `src/tools/send_transaction.ts` is FROZEN under Plan 08-02 constraints —
// the THREE-GATE logic (PREVIEW_TOKEN_MISMATCH + WRONG_STATUS +
// PAYLOAD_FINGERPRINT_DRIFT) is byte-identical to the Phase 4 baseline.
// Layer 2 chain-name MISMATCH refusal lives ONLY at preview_send in this
// plan's ship state.
//
// This test pins the Layer 3 cryptographic-binding gate: when
// `record.tx.chainId` is mutated in-memory between prepare and send
// (simulating handle-store state corruption), send_transaction's
// fingerprint-drift gate fires with PAYLOAD_FINGERPRINT_DRIFT — proves
// chainId is byte-bound into the payloadFingerprint preimage and the
// gate catches the divergence. The complementary Fixture J property test
// in test/signing-fingerprint.test.ts proves the function IS chain-distinct.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

const { getStatusSpy, getActiveSessionTopicSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getActiveSessionTopicSpy: vi.fn(),
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
      throw new Error("pair should not be called from these tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("../src/wallet/walletconnect-client.js", () => ({
  getWalletConnectClient: vi.fn(async () => ({
    request: vi.fn(async () => {
      throw new Error("signClient.request must not be called when a gate fires");
    }),
  })),
}));

import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  createHandle,
  transitionToPreviewed,
} from "../src/signing/handle-store.js";
import { computePayloadFingerprint } from "../src/signing/payload-fingerprint.js";
import { computePresignHash } from "../src/signing/presign-hash.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

await import("../src/tools/register-all.js");

async function callSend(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("send_transaction");
  if (!tool) throw new Error("send_transaction not registered");
  return tool.handler(args);
}

const FIXTURE_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

let savedDemo: string | undefined;
const DEMO_KEY = "VAULTPILOT_DEMO";

beforeEach(() => {
  getStatusSpy.mockReset();
  getActiveSessionTopicSpy.mockReset();
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
});

describe("send_transaction — Plan 08-02 chain-binding regression (Layer 3 still BYTE-FROZEN)", () => {
  it("(1) Layer 3 fingerprint-drift catches mutated record.tx.chainId between prepare and send", async () => {
    // Seed a handle for chainId=1 with a valid fingerprint over the original
    // tx. Transition to `previewed` so the state gate passes.
    const tx = {
      chainId: 1 as const,
      to: FIXTURE_TO,
      valueWei: 1_000_000_000_000_000_000n,
      data: "0x" as Hex,
    };
    const originalFingerprint = computePayloadFingerprint(tx);
    const handle = createHandle({
      args: { to: FIXTURE_TO, valueWei: "1000000000000000000" },
      tx,
      payloadFingerprint: originalFingerprint,
    });
    const { presignHash } = computePresignHash({
      chainId: 1,
      nonce: 7,
      maxPriorityFeePerGas: 1_500_000_000n,
      maxFeePerGas: 30_000_000_000n,
      gas: 21_000n,
      to: tx.to,
      value: tx.valueWei,
      data: tx.data,
    });
    const previewToken = "test-preview-token-deadbeef";
    transitionToPreviewed(handle, {
      nonce: 7,
      gas: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
      previewToken,
      presignHash,
      selector: null,
    });

    // Tamper with the stored handle's chainId in-memory: flip chainId 1 →
    // 137 (polygon) while leaving the stored fingerprint untouched. The
    // recomputed fingerprint over the MUTATED tx will differ from the
    // stored value, and Layer 3 PAYLOAD_FINGERPRINT_DRIFT fires.
    const record = _peekHandleForTesting(handle);
    if (!record) throw new Error("handle not found");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (record.tx as any).chainId = 137;

    const result = await callSend({
      handle,
      previewToken,
      userDecision: "send",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
    // signClient.request was never called — the gate fired BEFORE the WC
    // forward attempt.
    expect(getActiveSessionTopicSpy).not.toHaveBeenCalled();
  });

  it("(2) Layer 3 baseline: untampered record proceeds past fingerprint check (gates fall through correctly)", async () => {
    // Same setup as Test 1 but without the chainId mutation. The fingerprint
    // recheck passes; without WC pairing the next gate (WALLET_NOT_PAIRED)
    // fires — proves the three gates remain BYTE-FROZEN as a sequence.
    const tx = {
      chainId: 1 as const,
      to: FIXTURE_TO,
      valueWei: 1_000_000_000_000_000_000n,
      data: "0x" as Hex,
    };
    const originalFingerprint = computePayloadFingerprint(tx);
    const handle = createHandle({
      args: { to: FIXTURE_TO, valueWei: "1000000000000000000" },
      tx,
      payloadFingerprint: originalFingerprint,
    });
    const { presignHash } = computePresignHash({
      chainId: 1,
      nonce: 7,
      maxPriorityFeePerGas: 1_500_000_000n,
      maxFeePerGas: 30_000_000_000n,
      gas: 21_000n,
      to: tx.to,
      value: tx.valueWei,
      data: tx.data,
    });
    const previewToken = "test-preview-token-baseline";
    transitionToPreviewed(handle, {
      nonce: 7,
      gas: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
      previewToken,
      presignHash,
      selector: null,
    });

    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callSend({
      handle,
      previewToken,
      userDecision: "send",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    // Reaches the WALLET_NOT_PAIRED gate (the next gate AFTER fingerprint
    // drift in the FROZEN three-gate sequence). Proves the drift gate
    // passed cleanly when the stored chainId is intact.
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});
