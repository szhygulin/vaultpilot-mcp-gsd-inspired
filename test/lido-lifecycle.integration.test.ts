// Lido lifecycle integration test — Phase 30 Plan 30-03.
//
// Full prepare → preview_send pipeline for all 4 Lido write tools, asserting:
//   - Fixtures V/X/Y are persona-INDEPENDENT (from address NOT in calldata)
//   - Fixture W is persona-DEPENDENT (owner=fromAddress flows into calldata)
//   - preview_send renders DECODED ARGS for each Lido selector (lido-stake / lido-unstake / lido-wrap / lido-unwrap)
//   - NO LEDGER NOTICE block in preview_send response for any Lido selector (D-12)
//   - send_transaction simulation succeeds (demo mode — no hardware; T-DEMO-BROADCAST-1)
//   - ledgerNotice field is null for all Lido tools
//
// Analogs: test/aave-v3-lifecycle.integration.test.ts (exact shape).
//
// Cryptographic-binding regression values anchored here (plan 30-01):
//   Fixture V = "0xab550a2883eb494493169aeff633b77af8f5d458ed0f406b49ce9513b2fe7ed1"
//     (Lido.submit, referral=address(0), value=1e18 — from-INDEPENDENT)
//   Fixture W = "0x5f7514882e11ddb46f07aa0b8c3d30df017941c7b4c81e66471c15c31c4a8caa"
//     (requestWithdrawals([1e18], owner=ANVIL_1) — persona-DEPENDENT)
//   Fixture X = "0x0f08b774cb218dd466b47f6df2eee97a76df67a1914ee28269ed328edac5eb20"
//     (WstETH.wrap(1e18) — from-INDEPENDENT)
//   Fixture Y = "0x6d0dff107199edaf752aa542f219edbf26db1319f206aec4dc4027b368476089"
//     (WstETH.unwrap(1e18) — from-INDEPENDENT)
//
// STOP-THE-LINE: any change to preimage assembly that breaks these literals
// is a cryptographic-binding regression. Release blocker.

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
      throw new Error("pair should not be called from lido-lifecycle integration test");
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

// Mock viem/actions: covers getTransactionCount / estimateFeesPerGas / estimateGas / call
// for preview_send + send_transaction. readContract is NOT intercepted here because
// viem PublicClient methods are bound at client creation time — see registry mock below.
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

// Mock chains/registry: inject a readContract mock for Lido on-chain reads.
// prepare_lido_unstake + prepare_lido_wrap call client.readContract for allowance +
// getLastRequestId. viem PublicClient methods are bound at creation time so mocking
// viem/actions.readContract is insufficient — we must mock at the registry boundary.
// Per PATTERNS.md § test/lido-lifecycle.integration.test.ts mock pattern.
const mockReadContract = vi.fn().mockImplementation(
  async ({ functionName }: { functionName: string }) => {
    if (functionName === "allowance") return 2_000_000_000_000_000_000n; // > 1e18 → sufficient
    if (functionName === "getLastRequestId") return 42n;
    if (functionName === "balanceOf") return 1_000_000_000_000_000_000n;
    if (functionName === "sharesOf") return 950_000_000_000_000_000n;
    if (functionName === "stEthPerToken") return 1_050_000_000_000_000_000n;
    return 0n;
  },
);

vi.mock("../src/chains/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/registry.js")>(
    "../src/chains/registry.js",
  );
  return {
    ...actual,
    getChainClient: vi.fn(() => ({ readContract: mockReadContract })),
  };
});

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

// Trigger side-effect registration for all tools.
await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Fixture V/W/X/Y — hardcoded from test/signing-fingerprint.test.ts (Phase 30 Plan 30-01).
// Re-anchored here for byte-identity assurance at the integration level.
const FIXTURE_V_FP = "0xab550a2883eb494493169aeff633b77af8f5d458ed0f406b49ce9513b2fe7ed1";
const FIXTURE_X_FP = "0x0f08b774cb218dd466b47f6df2eee97a76df67a1914ee28269ed328edac5eb20";
const FIXTURE_Y_FP = "0x6d0dff107199edaf752aa542f219edbf26db1319f206aec4dc4027b368476089";
// Fixture W is persona-DEPENDENT — anchored in unit test prepare-lido-unstake.test.ts
// with owner=ANVIL_1. Here we verify persona-dependence (distinct FPs across personas).

const FIXTURE_NONCE = 7;
const FIXTURE_GAS = 100_000n;
const FIXTURE_MAX_FEE = 30_000_000_000n;
const FIXTURE_MAX_PRIO = 1_500_000_000n;

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`${name} not registered`);
  const needsChain =
    /^(prepare_|get_|simulate_|check_)/.test(name) && !("chain" in args);
  const merged = needsChain ? { chain: "ethereum", ...args } : args;
  return tool.handler(merged);
}

function personaAddress(slug: "whale" | "stable-saver" | "defi-degen"): string {
  const found = PERSONAS.find((p) => p.slug === slug);
  if (!found) throw new Error(`persona ${slug} not found`);
  return found.address;
}

const PERSONAS_UNDER_TEST: ReadonlyArray<"whale" | "stable-saver" | "defi-degen"> = [
  "whale",
  "stable-saver",
  "defi-degen",
];

beforeEach(() => {
  getStatusSpy.mockReset();
  getActiveSessionTopicSpy.mockReset();
  _resetHandleStoreForTesting();
  mockPublicHolder.current = createMockPublicClient();
  mockSignClientHolder.current = createMockSignClient();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "true";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
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
// Fixture V persona-independence — Lido.submit is from-INDEPENDENT
// ---------------------------------------------------------------------------
describe("Lido lifecycle — Fixture V persona-independence (stake)", () => {
  it("prepare_lido_stake: all 3 personas produce Fixture V fingerprint (V is from-INDEPENDENT)", async () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_lido_stake", { amount: "1.0" });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string; from: string };
      // Fixture V is from-INDEPENDENT — all personas produce the same fingerprint
      // (Lido.submit calldata does not embed the sender).
      expect(
        sc.payloadFingerprint,
        `STOP-THE-LINE: persona ${persona} produced wrong Fixture V fingerprint — RELEASE BLOCKER`,
      ).toBe(FIXTURE_V_FP);
      expect(sc.from).toBe(personaAddress(persona));
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture X persona-independence — WstETH.wrap is from-INDEPENDENT
// ---------------------------------------------------------------------------
describe("Lido lifecycle — Fixture X persona-independence (wrap)", () => {
  it("prepare_lido_wrap: all 3 personas produce Fixture X fingerprint (X is from-INDEPENDENT)", async () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_lido_wrap", { stethAmount: "1.0" });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string; from: string };
      // Fixture X is from-INDEPENDENT — wrap calldata carries only stethAmount, no owner slot.
      expect(
        sc.payloadFingerprint,
        `STOP-THE-LINE: persona ${persona} produced wrong Fixture X fingerprint — RELEASE BLOCKER`,
      ).toBe(FIXTURE_X_FP);
      expect(sc.from).toBe(personaAddress(persona));
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture Y persona-independence — WstETH.unwrap is from-INDEPENDENT
// ---------------------------------------------------------------------------
describe("Lido lifecycle — Fixture Y persona-independence (unwrap)", () => {
  it("prepare_lido_unwrap: all 3 personas produce Fixture Y fingerprint (Y is from-INDEPENDENT)", async () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_lido_unwrap", { wstethAmount: "1.0" });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string; from: string };
      // Fixture Y is from-INDEPENDENT — unwrap calldata carries only wstethAmount, no owner.
      expect(
        sc.payloadFingerprint,
        `STOP-THE-LINE: persona ${persona} produced wrong Fixture Y fingerprint — RELEASE BLOCKER`,
      ).toBe(FIXTURE_Y_FP);
      expect(sc.from).toBe(personaAddress(persona));
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture W persona-dependence — requestWithdrawals is persona-DEPENDENT
// ---------------------------------------------------------------------------
describe("Lido lifecycle — Fixture W persona-dependence (unstake)", () => {
  it("prepare_lido_unstake: each persona produces a distinct fingerprint (W is persona-DEPENDENT)", async () => {
    const fingerprintByPersona = new Map<string, string>();

    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_lido_unstake", { stethAmount: "1.0" });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string; from: string };
      expect(sc.from).toBe(personaAddress(persona));
      fingerprintByPersona.set(persona, sc.payloadFingerprint);
    }

    // All 3 fingerprints must be DISTINCT (owner=fromAddress flows into calldata).
    // If any two are equal, the persona address is NOT flowing into calldata — RELEASE BLOCKER.
    const distinctFPs = new Set(fingerprintByPersona.values());
    expect(
      distinctFPs.size,
      "STOP-THE-LINE: requestWithdrawals produced identical fingerprints across personas — owner NOT in calldata. RELEASE BLOCKER.",
    ).toBe(PERSONAS_UNDER_TEST.length);

    // Each fingerprint is a valid 32-byte hex.
    for (const [persona, fp] of fingerprintByPersona) {
      expect(fp, `persona ${persona}: invalid fingerprint format`).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("prepare_lido_unstake: same persona is deterministic across repeated calls", async () => {
    setActivePersona("whale");

    const a = await callTool("prepare_lido_unstake", { stethAmount: "1.0" });
    expect(a.isError).toBeFalsy();
    const fpA = (a.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    _resetHandleStoreForTesting();

    const b = await callTool("prepare_lido_unstake", { stethAmount: "1.0" });
    expect(b.isError).toBeFalsy();
    const fpB = (b.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    expect(
      fpA,
      "STOP-THE-LINE: prepare_lido_unstake is non-deterministic for same persona — RELEASE BLOCKER",
    ).toBe(fpB);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: prepare_lido_stake → preview_send → send_transaction (demo)
// ---------------------------------------------------------------------------
describe("Lido lifecycle — full pipeline: stake → preview → send (whale persona)", () => {
  it("prepare_lido_stake → preview_send (DECODED ARGS lido-stake + NO LEDGER NOTICE) → send_transaction simulation", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_lido_stake", { amount: "1.0" });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    // Fixture V persona-independence re-anchor at integration level.
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_V_FP);

    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";

    // D-12: NO LEDGER NOTICE for Lido.submit (ERC-7730 clear-sign confirmed).
    expect(previewText).not.toMatch(/LEDGER.?NOTICE/i);

    // DECODED ARGS block present.
    expect(previewText).toContain("DECODED ARGS");
    expect(previewText).toMatch(/operation:\s+Lido stake/);

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("lido-stake");
    expect(previewSc.ledgerNotice).toBeNull();

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as { simulated: boolean };
    expect(sendSc.simulated).toBe(true);

    // T-DEMO-BROADCAST-1: NOTHING signed; NOTHING broadcast.
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: prepare_lido_unstake → preview_send → send_transaction (demo)
// ---------------------------------------------------------------------------
describe("Lido lifecycle — full pipeline: unstake → preview → send (whale persona)", () => {
  it("prepare_lido_unstake → preview_send (DECODED ARGS lido-unstake + NO LEDGER NOTICE) → send_transaction simulation", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_lido_unstake", { stethAmount: "1.0" });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
      expectedTokenId: string;
      nftContract: string;
    };
    expect(prepareSc.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    // D-04: NFT fields present.
    expect(prepareSc.expectedTokenId).toBe("43"); // getLastRequestId=42 → 43
    expect(prepareSc.nftContract).toBeDefined();

    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";

    expect(previewText).not.toMatch(/LEDGER.?NOTICE/i);
    expect(previewText).toContain("DECODED ARGS");
    expect(previewText).toMatch(/operation:\s+Lido unstake/);

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("lido-unstake");
    expect(previewSc.ledgerNotice).toBeNull();

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as { simulated: boolean };
    expect(sendSc.simulated).toBe(true);
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: prepare_lido_wrap → preview_send → send_transaction (demo)
// ---------------------------------------------------------------------------
describe("Lido lifecycle — full pipeline: wrap → preview → send (whale persona)", () => {
  it("prepare_lido_wrap → preview_send (DECODED ARGS lido-wrap + NO LEDGER NOTICE) → send_transaction simulation", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_lido_wrap", { stethAmount: "1.0" });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    // Fixture X persona-independence re-anchor at integration level.
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_X_FP);

    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";

    expect(previewText).not.toMatch(/LEDGER.?NOTICE/i);
    expect(previewText).toContain("DECODED ARGS");
    expect(previewText).toMatch(/operation:\s+Lido wrap/);

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("lido-wrap");
    expect(previewSc.ledgerNotice).toBeNull();

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as { simulated: boolean };
    expect(sendSc.simulated).toBe(true);
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: prepare_lido_unwrap → preview_send → send_transaction (demo)
// ---------------------------------------------------------------------------
describe("Lido lifecycle — full pipeline: unwrap → preview → send (whale persona)", () => {
  it("prepare_lido_unwrap → preview_send (DECODED ARGS lido-unwrap + NO LEDGER NOTICE) → send_transaction simulation", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_lido_unwrap", { wstethAmount: "1.0" });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    // Fixture Y persona-independence re-anchor at integration level.
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_Y_FP);

    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";

    expect(previewText).not.toMatch(/LEDGER.?NOTICE/i);
    expect(previewText).toContain("DECODED ARGS");
    expect(previewText).toMatch(/operation:\s+Lido unwrap/);

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("lido-unwrap");
    expect(previewSc.ledgerNotice).toBeNull();

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as { simulated: boolean };
    expect(sendSc.simulated).toBe(true);
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(0);
  });
});
