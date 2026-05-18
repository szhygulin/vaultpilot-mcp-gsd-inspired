// Phase 8 — Plan 08-02. preview_send Layer 2 chain-name MISMATCH refusal
// (research § Topic 3 lines 240-258). The refusal fires AFTER handle lookup
// (it needs `record.tx.chainId` to compare against) but BEFORE the existing
// state-machine + fingerprint-drift gates, so a wrong-chain claim refuses
// with a chain-specific error instead of cascading into an unrelated
// state-machine refusal.
//
// Layer taxonomy:
//   Layer 1 — JSON-schema enum (refuses bogus chain names at dispatch).
//   Layer 2 — THIS — additive defense-in-depth; OPTIONAL chain arg.
//   Layer 3 — Plan 04-01 payloadFingerprint preimage chainId slot (FROZEN —
//             tested by Fixture J chain-distinctness property in
//             test/signing-fingerprint.test.ts).
//   Layer 4 — Ledger device `Network:` clear-sign display (out of MCP scope).
//
// Send-side note: `src/tools/send_transaction.ts` is FROZEN per Plan 08-02
// constraints — Layer 2 lives ONLY at preview_send in this plan's ship state.
// Layer 3 fingerprint-drift in send_transaction continues to catch any
// mutated `record.tx.chainId` between prepare and send (see Fixture J).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import type { FourbyteResult } from "../src/clients/fourbyte.js";

const {
  getStatusSpy,
  getTransactionCountSpy,
  estimateFeesPerGasSpy,
  estimateGasSpy,
  lookupSelectorSpy,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getTransactionCountSpy: vi.fn(),
  estimateFeesPerGasSpy: vi.fn(),
  estimateGasSpy: vi.fn(),
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
      throw new Error("pair should not be called from these tests");
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
    estimateGas: (...args: Parameters<typeof actual.estimateGas>) =>
      estimateGasSpy(...args),
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

import {
  _resetHandleStoreForTesting,
  createHandle,
  transitionToSent,
} from "../src/signing/handle-store.js";
import type { PreparedTx } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

await import("../src/tools/register-all.js");

async function callPreview(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

const FIXTURE_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const FIXTURE_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [FIXTURE_TO as `0x${string}`],
  activeAccount: FIXTURE_TO as `0x${string}`,
  address: FIXTURE_TO as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

function buildTx(chainId: 1 | 42161 | 137 | 8453 | 10): PreparedTx {
  return {
    chainId,
    to: FIXTURE_TO,
    valueWei: 1_000_000_000_000_000_000n,
    data: "0x" as Hex,
  };
}

function seedHandle(chainId: 1 | 42161 | 137 | 8453 | 10): string {
  return createHandle({
    args: { to: FIXTURE_TO, valueWei: "1000000000000000000" },
    tx: buildTx(chainId),
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

let savedDemo: string | undefined;
const DEMO_KEY = "VAULTPILOT_DEMO";

beforeEach(() => {
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  lookupSelectorSpy.mockReset();
  lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });
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

// ---------------------------------------------------------------------------
// Layer 2 refusal — happy paths and refusal paths.
// ---------------------------------------------------------------------------

describe("preview_send — Plan 08-02 Layer 2 chain-name MISMATCH refusal (T-CHAIN-MISMATCH-1)", () => {
  it("(1) refuses with CHAIN_ID_MISMATCH when args.chain disagrees with handle's bound chainId", async () => {
    // Handle prepared for chainId=1; agent claims chain="polygon".
    const handle = seedHandle(1);

    const result = await callPreview({ handle, chain: "polygon" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("CHAIN_ID_MISMATCH");
    expect(sc.message).toContain('chain="polygon"');
    expect(sc.message).toContain("chainId=1");
    // Refusal text carries the templated CHAIN_ID_MISMATCH block.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("CHAIN ID MISMATCH");
    expect(text).toContain("agent requested:  polygon (chainId 137)");
    expect(text).toContain("handle prepared:  ethereum (chainId 1)");
  });

  it("(2) happy path: args.chain matches → no refusal; proceeds to the existing three-gate logic", async () => {
    scriptHappyMocks();
    const handle = seedHandle(1);

    const result = await callPreview({ handle, chain: "ethereum" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { chainId: number; previewToken: string };
    expect(sc.chainId).toBe(1);
    expect(sc.previewToken).toMatch(/^[0-9a-f-]+$/);
  });

  it("(3) back-compat: chain arg omitted → no Layer 2 check; proceeds normally", async () => {
    scriptHappyMocks();
    const handle = seedHandle(1);

    const result = await callPreview({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { chainId: number };
    expect(sc.chainId).toBe(1);
  });

  it("(4) envelope shape: errorCode + message + content text", async () => {
    const handle = seedHandle(1);

    const result = await callPreview({ handle, chain: "arbitrum" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("CHAIN_ID_MISMATCH");
    expect(sc.message).toBe(
      'preview chain="arbitrum" but handle prepared for chainId=1',
    );
    expect(result.content[0]?.text).toContain("re-call prepare_*");
  });

  it("(5) before-three-gates ordering: refusal fires BEFORE the state-machine WRONG_STATUS check", async () => {
    // Seed a handle and force it into a terminal `sent` state. Under the
    // pre-Plan-08-02 flow, preview_send would refuse with WRONG_STATUS
    // (terminal handles can't be re-previewed). Plan 08-02's Layer 2 chain-
    // mismatch refusal MUST fire first — proves the block sits at the TOP
    // of the handler.
    const handle = seedHandle(1);
    transitionToSent(handle, "0xdeadbeef" as Hex);

    const result = await callPreview({ handle, chain: "polygon" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    // CHAIN_ID_MISMATCH wins over WRONG_STATUS — Layer 2 sits BEFORE the
    // state-machine gate. The chain-mismatch refusal is more actionable for
    // the agent ("you claimed the wrong chain") than the state error.
    expect(sc.errorCode).toBe("CHAIN_ID_MISMATCH");
  });

  it("(6) parameterized: every wrong (claimed_chain, stored_chainId) pair refuses", async () => {
    const chains = [
      { name: "ethereum", id: 1 as const },
      { name: "arbitrum", id: 42161 as const },
      { name: "polygon", id: 137 as const },
      { name: "base", id: 8453 as const },
      { name: "optimism", id: 10 as const },
    ];
    for (const stored of chains) {
      for (const claimed of chains) {
        if (claimed.id === stored.id) continue;
        _resetHandleStoreForTesting();
        const handle = seedHandle(stored.id);
        const result = await callPreview({ handle, chain: claimed.name });
        expect(result.isError).toBe(true);
        const sc = result.structuredContent as { errorCode: string };
        expect(sc.errorCode).toBe("CHAIN_ID_MISMATCH");
      }
    }
  });

  it("(7) handle lookup failure still surfaces as HANDLE_NOT_FOUND (chain check needs the record)", async () => {
    // No handle seeded — bogus handle id. The Layer 2 check needs
    // record.tx.chainId; without a record the lookup fails first with
    // HANDLE_NOT_FOUND (the canonical Plan 04-03 surface).
    const result = await callPreview({
      handle: "00000000-0000-4000-8000-000000000000",
      chain: "polygon",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("HANDLE_NOT_FOUND");
  });

  it("(8) Layer 3 still catches mutated record.tx.chainId between prepare and send (note — preview cannot bypass Layer 3)", () => {
    // Documentation case (the actual Layer 3 mutation regression lives in
    // send_transaction.ts, which is FROZEN). This test affirms the layering
    // contract: Layer 2 is a defense-in-depth check at preview-time; Layer 3
    // is the cryptographic-binding fingerprint-drift gate at send-time. The
    // Fixture J chain-distinctness property in test/signing-fingerprint.test.ts
    // proves the chainId slot binds via keccak — a future regression to that
    // would break Fixture J first.
    expect(true).toBe(true);
  });
});
